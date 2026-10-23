
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

function isAuthorized(req) {
  if (!CRON_SECRET) {
    console.error('CRON_SECRET ontbreekt.');
    return false;
  }

  const supplied = req.headers['x-cron-secret'];
  if (typeof supplied !== 'string') return false;

  const expectedBuffer = Buffer.from(CRON_SECRET);
  const suppliedBuffer = Buffer.from(supplied);

  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Methode niet toegestaan.' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Niet geautoriseerd.' });
  }

  let lockRef = null;
  let ownsLock = false;

  try {
    const nl = amsterdamNow();
    const week = getWeekInfo(nl.year, nl.month, nl.day);

    const dayNames = {
      Mon: 'maandag', Tue: 'dinsdag', Wed: 'woensdag',
      Thu: 'donderdag', Fri: 'vrijdag',
      Sat: 'zaterdag', Sun: 'zondag'
    };

    const todayName = dayNames[nl.weekday];
    const weekSnap = await db
      .ref(`padelData/scheduleOverrides/${week.key}`)
      .once('value');
    const weekData = weekSnap.val() || {};

    const slotsToday = ['dinsdag', 'donderdag'].filter(slot => {
      const customDay =
        slot === 'dinsdag'
          ? weekData.customDinsdag
          : weekData.customDonderdag;
      return (customDay || slot) === todayName;
    });

    const activeSlots = slotsToday.filter(slot => {
      const override = weekData[slot];
      return !(
        override &&
        typeof override === 'object' &&
        !Array.isArray(override) &&
        override.cancelled === true
      );
    });

    if (activeSlots.length === 0) {
      return res.status(200).json({
        status: 'Geen actieve speeldag vandaag.'
      });
    }

    const weatherUrl =
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=51.6833&longitude=5.0708' +
      '&hourly=precipitation_probability,precipitation' +
      '&models=knmi_seamless' +
      '&timezone=Europe%2FAmsterdam&forecast_days=2';

    const weatherRes = await fetch(weatherUrl);
    if (!weatherRes.ok) {
      throw new Error(`Weerprovider HTTP ${weatherRes.status}.`);
    }

    const weatherData = await weatherRes.json();
    const hourly = weatherData?.hourly;

    if (
      !Array.isArray(hourly?.time) ||
      !Array.isArray(hourly?.precipitation_probability) ||
      !Array.isArray(hourly?.precipitation)
    ) {
      throw new Error('Ongeldige uurgegevens van de weerprovider.');
    }

    const targetTime = `${nl.dateKey}T18:00`;
    const timeIndex = hourly.time.indexOf(targetTime);

    if (timeIndex === -1) {
      throw new Error(`Geen weersverwachting gevonden voor ${targetTime}.`);
    }

    const pop = hourly.precipitation_probability[timeIndex];
    const rain = hourly.precipitation[timeIndex];

    if (!Number.isFinite(pop) || !Number.isFinite(rain)) {
      throw new Error('Ongeldige regenwaarden ontvangen.');
    }

    if (pop < RAIN_THRESHOLD) {
      return res.status(200).json({
        status: 'Regenkans onder de ingestelde grens.',
        precipitationProbability: pop,
        threshold: RAIN_THRESHOLD
      });
    }

    // Alle spelers met tokens krijgen de melding, ook bij afmelding.
    const tokensData = await getTokensByPlayer();
    const players = Object.keys(tokensData);
    const tokens = tokensOf(tokensData, players);

    if (tokens.length === 0) {
      return res.status(200).json({
        status: 'Geen geregistreerde push-tokens gevonden.',
        precipitationProbability: pop
      });
    }

    lockRef = db.ref(`padelData/sentWeatherPushes/${nl.dateKey}`);
    const nowMs = Date.now();

    const claim = await lockRef.transaction(current => {
      if (current?.status === 'sent') return;

      if (
        current?.status === 'sending' &&
        Number.isFinite(current.startedAt) &&
        nowMs - current.startedAt < 10 * 60 * 1000
      ) {
        return;
      }

      return {
        status: 'sending',
        startedAt: nowMs,
        precipitationProbability: pop,
        rain
      };
    });

    if (!claim.committed) {
      return res.status(200).json({
        status: 'Weermelding al verzonden of in behandeling.'
      });
    }

    ownsLock = true;

    const result = await sendToTokens(tokens, {
      title: '🌧️ Regenbericht Padelschema',
      body: `Er is vanavond ${pop}% kans op regen in Waalwijk (${rain} mm).`,
      tag: `weather_${nl.dateKey}`
    });

    if (result.successCount === 0) {
      await lockRef.remove();
      ownsLock = false;
      return res.status(502).json({
        error: 'Geen enkele melding succesvol afgeleverd.',
        ...result
      });
    }

    await lockRef.set({
      status: 'sent',
      sentAt: new Date().toISOString(),
      precipitationProbability: pop,
      rain,
      successCount: result.successCount,
      failureCount: result.failureCount
    });

    ownsLock = false;

    return res.status(200).json({
      success: true,
      status: 'Weermelding verwerkt.',
      recipients: players,
      precipitationProbability: pop,
      rain,
      ...result
    });
  } catch (error) {
    console.error('Fout in weer-cronjob:', error);

    if (lockRef && ownsLock) {
      try {
        await lockRef.remove();
      } catch {
        console.error('Kon de weermeldingsvergrendeling niet verwijderen.');
      }
    }

    return res.status(500).json({
      error: 'Er ging iets mis bij het ophalen of versturen van de weermelding.'
    });
  }
}
