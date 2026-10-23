
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
const STALE_LOCK_MS = 10 * 60 * 1000;

function isAuthorized(req) {
  if (!CRON_SECRET) {
    console.error('CRON_SECRET ontbreekt in de omgevingsvariabelen.');
    return false;
  }

  // Alleen een geheime header accepteren, niet een secret in de URL.
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
    // Alle datum- en weekberekeningen gebruiken Nederlandse tijd.
    const nl = amsterdamNow();
    const week = getWeekInfo(nl.year, nl.month, nl.day);

    const dayNames = {
      Mon: 'maandag',
      Tue: 'dinsdag',
      Wed: 'woensdag',
      Thu: 'donderdag',
      Fri: 'vrijdag',
      Sat: 'zaterdag',
      Sun: 'zondag'
    };

    const todayName = dayNames[nl.weekday];

    const weekRef = db.ref(`padelData/scheduleOverrides/${week.key}`);
    const weekSnap = await weekRef.once('value');
    const weekData = weekSnap.val() || {};

    // Houd rekening met eventueel verplaatste speeldagen.
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

    // Haal de regenverwachting voor 18:00 Nederlandse tijd op.
    const weatherUrl =
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=51.6833' +
      '&longitude=5.0708' +
      '&hourly=precipitation_probability,precipitation' +
      '&models=knmi_seamless' +
      '&timezone=Europe%2FAmsterdam' +
      '&forecast_days=2';

    const weatherRes = await fetch(weatherUrl);

    if (!weatherRes.ok) {
      throw new Error(`Weerprovider antwoordde met HTTP ${weatherRes.status}.`);
    }

    const weatherData = await weatherRes.json();

    if (
      !weatherData?.hourly?.time ||
      !Array.isArray(weatherData.hourly.time) ||
      !Array.isArray(weatherData.hourly.precipitation_probability) ||
      !Array.isArray(weatherData.hourly.precipitation)
    ) {
      throw new Error('De verwachte uurgegevens ontbreken in de weersvoorspelling.');
    }

    const targetTime = `${nl.dateKey}T18:00`;
    const timeIndex = weatherData.hourly.time.indexOf(targetTime);

    if (timeIndex === -1) {
      throw new Error(`Geen weersvoorspelling gevonden voor ${targetTime}.`);
    }

    const pop = weatherData.hourly.precipitation_probability[timeIndex];
    const rain = weatherData.hourly.precipitation[timeIndex];

    if (!Number.isFinite(pop) || !Number.isFinite(rain)) {
      throw new Error('De regenverwachting bevat ongeldige waarden.');
    }

    if (pop < RAIN_THRESHOLD) {
      return res.status(200).json({
        status: 'Regenkans onder de ingestelde grens.',
        precipitationProbability: pop,
        threshold: RAIN_THRESHOLD
      });
    }

    // Bewust alle geregistreerde spelers gebruiken:
    // afmeldingen sluiten niemand uit van een regenmelding.
    const tokensData = await getTokensByPlayer();

    const allPlayers = Object.keys(tokensData);
    const tokens = tokensOf(tokensData, allPlayers);

    if (tokens.length === 0) {
      return res.status(200).json({
        status: 'Geen geregistreerde push-tokens gevonden.',
        precipitationProbability: pop
      });
    }

    // Claim de melding atomair. Een recente verzending in uitvoering
    // en een reeds verzonden melding blokkeren dubbele verzendingen.
    lockRef = db.ref(`padelData/sentWeatherPushes/${nl.dateKey}`);

    const nowMs = Date.now();

    const claim = await lockRef.transaction(current => {
      if (current?.status === 'sent') return;

      if (
        current?.status === 'sending' &&
        Number.isFinite(current.startedAt) &&
        nowMs - current.startedAt < STALE_LOCK_MS
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
        status: 'Weermelding is al verzonden of wordt al verwerkt.'
      });
    }

    ownsLock = true;

    const result = await sendToTokens(tokens, {
      title: '🌧️ Regenbericht Padelschema',
      body: `Er is vanavond ${pop}% kans op regen in Waalwijk (${rain} mm).`,
      tag: `weather_${nl.dateKey}`
    });

    // Geen succesvolle aflevering? Geef een volgende poging de kans.
    if (result.successCount === 0) {
      await lockRef.remove();
      ownsLock = false;

      return res.status(502).json({
        error: 'De weermelding kon bij geen enkel apparaat worden afgeleverd.',
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
      recipients: allPlayers,
      precipitationProbability: pop,
      rain,
      ...result
    });
  } catch (error) {
    console.error('Fout in weer-cronjob:', error);

    if (lockRef && ownsLock) {
      try {
        await lockRef.remove();
      } catch (cleanupError) {
        console.error('Kon de weermeldingsvergrendeling niet verwijderen.');
      }
    }

    return res.status(500).json({
      error: 'Er ging iets mis bij het ophalen of versturen van de weermelding.'
    });
  }
}
