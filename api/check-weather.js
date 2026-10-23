
import { timingSafeEqual } from 'node:crypto';
import {
  db,
  amsterdamNow,
  getWeekInfo,
  getTokensByPlayer,
  tokensOf,
  sendToTokens
} from '../lib/padel.js';

const CRON_SECRET = process.env.CRON_SECRET;
const RAIN_THRESHOLD = 60;

const BASE_PLAYERS = [
  'Marcel',
  'Mark',
  'Ronald',
  'Sander',
  'Dennis',
  'Robert'
];

const DUTCH_DAYS = {
  Mon: 'maandag',
  Tue: 'dinsdag',
  Wed: 'woensdag',
  Thu: 'donderdag',
  Fri: 'vrijdag',
  Sat: 'zaterdag',
  Sun: 'zondag'
};

function isAuthorized(req) {
  const supplied = req.headers['x-cron-secret'];

  if (
    !CRON_SECRET ||
    typeof supplied !== 'string' ||
    supplied.length !== CRON_SECRET.length
  ) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(CRON_SECRET)
    );
  } catch {
    return false;
  }
}

function getActiveSlots(weekData, todayName) {
  return ['dinsdag', 'donderdag'].filter(slot => {
    const slotOverride = weekData[slot];

    // Een expliciet geannuleerde speeldag telt niet mee.
    if (
      slotOverride &&
      typeof slotOverride === 'object' &&
      slotOverride.cancelled === true
    ) {
      return false;
    }

    const customDayKey =
      slot === 'dinsdag' ? 'customDinsdag' : 'customDonderdag';

    // Gebruik de verplaatste dag, indien ingesteld.
    const scheduledDay = weekData[customDayKey] || slot;

    return scheduledDay === todayName;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      error: 'Methode niet toegestaan.'
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: 'Niet geautoriseerd.'
    });
  }

  try {
    const nl = amsterdamNow();
    const todayName = DUTCH_DAYS[nl.weekday];

    if (!todayName) {
      return res.status(500).json({
        error: 'Kon de Nederlandse weekdag niet bepalen.'
      });
    }

    const week = getWeekInfo(nl.year, nl.month, nl.day);

    const weekSnap = await db
      .ref(`padelData/scheduleOverrides/${week.key}`)
      .once('value');

    const weekData = weekSnap.val() || {};

    // Controleer beide speelslots, ook als ze naar dezelfde
    // of een andere dag van de week zijn verplaatst.
    const activeSlots = getActiveSlots(weekData, todayName);

    if (activeSlots.length === 0) {
      return res.status(200).json({
        status: 'Geen actieve speeldag vandaag.',
        dag: todayName
      });
    }

    const weatherUrl =
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=51.6833' +
      '&longitude=5.0708' +
      '&hourly=precipitation_probability,precipitation' +
      '&models=knmi_seamless' +
      '&timezone=Europe%2FAmsterdam' +
      '&forecast_days=2';

    const weatherResponse = await fetch(weatherUrl);

    if (!weatherResponse.ok) {
      throw new Error(
        `Weerbericht ophalen mislukt: HTTP ${weatherResponse.status}`
      );
    }

    const weather = await weatherResponse.json();

    if (
      !weather.hourly ||
      !Array.isArray(weather.hourly.time) ||
      !Array.isArray(weather.hourly.precipitation_probability)
    ) {
      throw new Error('Het weerbericht bevat geen geldige uurgegevens.');
    }

    const targetTime = `${nl.dateKey}T18:00`;
    const hourIndex = weather.hourly.time.indexOf(targetTime);

    if (hourIndex === -1) {
      return res.status(200).json({
        status: 'Geen weergegevens beschikbaar voor 18:00.',
        datum: nl.dateKey
      });
    }

    const rainProbability =
      weather.hourly.precipitation_probability[hourIndex];

    const precipitation =
      Array.isArray(weather.hourly.precipitation)
        ? weather.hourly.precipitation[hourIndex]
        : null;

    if (
      typeof rainProbability !== 'number' ||
      !Number.isFinite(rainProbability)
    ) {
      throw new Error('De neerslagkans is ongeldig.');
    }

    if (rainProbability < RAIN_THRESHOLD) {
      return res.status(200).json({
        status: 'Geen regenmelding nodig.',
        dag: todayName,
        neerslagkans: rainProbability,
        grenswaarde: RAIN_THRESHOLD
      });
    }

    const lockRef = db.ref(
      `padelData/sentWeatherPushes/${nl.dateKey}`
    );

    // Eén proces mag de melding per kalenderdag afhandelen.
    const lockResult = await lockRef.transaction(current => {
      const now = Date.now();

      if (current && current.status === 'sent') {
        return;
      }

      if (
        current &&
        current.status === 'sending' &&
        now - Number(current.timestamp || 0) < 10 * 60 * 1000
      ) {
        return;
      }

      return {
        status: 'sending',
        timestamp: now,
        dag: todayName
      };
    });

    if (!lockResult.committed) {
      return res.status(200).json({
        status: 'Regenmelding voor vandaag al afgehandeld of bezig.',
        datum: nl.dateKey
      });
    }

    try {
      const tokensData = await getTokensByPlayer();
      const tokens = tokensOf(tokensData, BASE_PLAYERS);

      if (tokens.length === 0) {
        await lockRef.remove();

        return res.status(200).json({
          status: 'Geen geregistreerde pushapparaten.',
          dag: todayName
        });
      }

      const rainText =
        typeof precipitation === 'number'
          ? ` Verwachte neerslag: ${precipitation} mm.`
          : '';

      const result = await sendToTokens(tokens, {
        title: '🌧️ Regenwaarschuwing padel',
        body:
          `Vandaag (${todayName}) staat er padel gepland. ` +
          `De verwachte neerslagkans rond 18:00 is ${rainProbability}%.` +
          rainText,
        tag: `padel-regen-${nl.dateKey}`
      });

      if (result.successCount === 0) {
        await lockRef.remove();

        return res.status(502).json({
          error: 'De pushmelding is niet bij een apparaat afgeleverd.',
          successCount: result.successCount,
          failureCount: result.failureCount
        });
      }

      await lockRef.set({
        status: 'sent',
        timestamp: Date.now(),
        dag: todayName,
        rainProbability,
        precipitation,
        successCount: result.successCount,
        failureCount: result.failureCount
      });

      return res.status(200).json({
        status: 'Regenmelding verzonden.',
        dag: todayName,
        neerslagkans: rainProbability,
        successCount: result.successCount,
        failureCount: result.failureCount
      });
    } catch (error) {
      // Geef een mislukte verzending de kans om later opnieuw te proberen.
      await lockRef.remove();
      throw error;
    }
  } catch (error) {
    console.error('Fout in cron-weather:', error);

    return res.status(500).json({
      error: 'Er ging iets mis bij het controleren van de regenmelding.'
    });
  }
}
