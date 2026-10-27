import { timingSafeEqual } from 'node:crypto';

import {
  db,
  amsterdamNow,
  getWeekInfo,
  getTokensByPlayer,
  tokensOf,
  sendToTokens
} from '../lib/padel.js';

const CRON_SECRET = process.env.CRON_SECRET || '';
const RAIN_THRESHOLD = 60;
const PRECIPITATION_THRESHOLD = 1.0; // in mm

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

const DAY_ALIASES = {
  maandag: 'maandag',
  monday: 'maandag',
  mon: 'maandag',
  dinsdag: 'dinsdag',
  tuesday: 'dinsdag',
  tue: 'dinsdag',
  woensdag: 'woensdag',
  wednesday: 'woensdag',
  wed: 'woensdag',
  donderdag: 'donderdag',
  thursday: 'donderdag',
  thu: 'donderdag',
  vrijdag: 'vrijdag',
  friday: 'vrijdag',
  fri: 'vrijdag',
  zaterdag: 'zaterdag',
  saturday: 'zaterdag',
  sat: 'zaterdag',
  zondag: 'zondag',
  sunday: 'zondag',
  sun: 'zondag'
};

function authorized(req) {
  const supplied = String(req.headers['x-cron-secret'] || '');

  if (!CRON_SECRET || !supplied) {
    return false;
  }

  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(CRON_SECRET);

  if (suppliedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function normalizeDay(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const day = String(value).trim().toLowerCase();

  return DAY_ALIASES[day] || null;
}

function getActiveSlots(weekData, todayName) {
  if (!weekData || typeof weekData !== 'object') {
    return [];
  }

  const slots = [
    {
      slot: 'dinsdag',
      customKey: 'customDinsdag',
      defaultDay: 'dinsdag'
    },
    {
      slot: 'donderdag',
      customKey: 'customDonderdag',
      defaultDay: 'donderdag'
    }
  ];

  return slots.filter(({ slot, customKey, defaultDay }) => {
    const override = weekData[slot];

    // Een expliciet geannuleerde speeldag overslaan.
    if (
      override &&
      typeof override === 'object' &&
      !Array.isArray(override) &&
      override.cancelled === true
    ) {
      return false;
    }

    // Een verplaatste speeldag gebruikt de aangepaste weekdag.
    const scheduledDay =
      normalizeDay(weekData[customKey]) || defaultDay;

    return scheduledDay === todayName;
  });
}

async function getRainForecast(dateKey) {
  const url = new URL(
    'https://api.open-meteo.com/v1/forecast'
  );

  url.searchParams.set('latitude', '51.682');
  url.searchParams.set('longitude', '5.070');
  url.searchParams.set(
    'hourly',
    'precipitation_probability,precipitation'
  );
  url.searchParams.set('models', 'knmi_seamless');
  url.searchParams.set('timezone', 'Europe/Amsterdam');
  url.searchParams.set('forecast_days', '2');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Weerservice gaf HTTP ${response.status}`
    );
  }

  const weather = await response.json();
  const hourly = weather.hourly;

  if (
    !hourly ||
    !Array.isArray(hourly.time) ||
    !Array.isArray(hourly.precipitation_probability)
  ) {
    throw new Error('Ongeldige weersverwachting ontvangen');
  }

  const targetTime = `${dateKey}T18:00`;
  const index = hourly.time.indexOf(targetTime);

  if (index === -1) {
    throw new Error(
      `Geen weersverwachting gevonden voor ${targetTime}`
    );
  }

  return {
    probability: Number(
      hourly.precipitation_probability[index] ?? 0
    ),
    precipitation: Number(
      hourly.precipitation?.[index] ?? 0
    )
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');

    return res.status(405).json({
      status: 'Methode niet toegestaan'
    });
  }

  if (!authorized(req)) {
    return res.status(401).json({
      status: 'Niet geautoriseerd'
    });
  }

  let lockRef = null;
  let lockClaimed = false;

  try {
    const nl = amsterdamNow();
    const todayName = DUTCH_DAYS[nl.weekday];

    if (!todayName) {
      return res.status(500).json({
        status: 'Onbekende Nederlandse weekdag'
      });
    }

    const week = getWeekInfo(
      nl.year,
      nl.month,
      nl.day
    );

    const weekRef = db.ref(
      `padelData/scheduleOverrides/${week.key}`
    );

    const weekSnapshot = await weekRef.once('value');
    const weekData = weekSnapshot.val() || {};

    const activeSlots = getActiveSlots(
      weekData,
      todayName
    );

    if (activeSlots.length === 0) {
      return res.status(200).json({
        status: 'Geen actieve speeldag vandaag',
        date: nl.dateKey
      });
    }

    const forecast = await getRainForecast(nl.dateKey);

    // Controleer zowel op regenkans (>= 60%) als neerslaghoeveelheid (> 1.0 mm)
    if (
      forecast.probability < RAIN_THRESHOLD ||
      forecast.precipitation <= PRECIPITATION_THRESHOLD
    ) {
      return res.status(200).json({
        status: 'Geen weerpush nodig (onder drempel voor kans of millimeters)',
        date: nl.dateKey,
        rainProbability: forecast.probability,
        precipitation: forecast.precipitation,
        rainThreshold: RAIN_THRESHOLD,
        precipitationThreshold: PRECIPITATION_THRESHOLD
      });
    }

    const tokensData = await getTokensByPlayer();
    const tokens = tokensOf(tokensData, BASE_PLAYERS);

    if (tokens.length === 0) {
      return res.status(200).json({
        status: 'Geen geregistreerde pushtokens',
        date: nl.dateKey
      });
    }

    lockRef = db.ref(
      `padelData/sentWeatherPushes/${nl.dateKey}`
    );

    const claim = await lockRef.transaction((current) => {
      if (current !== null) {
        return;
      }

      return {
        status: 'sending',
        startedAt: Date.now(),
        date: nl.dateKey
      };
    });

    if (!claim.committed) {
      return res.status(200).json({
        status: 'Weerpush vandaag al gestart of verstuurd',
        date: nl.dateKey
      });
    }

    lockClaimed = true;

    const result = await sendToTokens(tokens, {
      title: '🌧️ Kans op regen tijdens padel',
      body:
        `Voor vanavond is de regenkans ${forecast.probability}% (${forecast.precipitation} mm). ` +
        'Controleer het weer voordat je gaat spelen.',
      tag: `padel-weather-${nl.dateKey}`
    });

    const successCount = Number(result?.successCount || 0);
    const failureCount = Number(result?.failureCount || 0);

    if (successCount > 0) {
      await lockRef.update({
        status: 'sent',
        sentAt: Date.now(),
        date: nl.dateKey,
        rainProbability: forecast.probability,
        precipitation: forecast.precipitation,
        successCount,
        failureCount
      });

      return res.status(200).json({
        status: 'Weerpush verstuurd',
        date: nl.dateKey,
        successCount,
        failureCount
      });
    }

    await lockRef.remove();
    lockClaimed = false;

    return res.status(502).json({
      status: 'Geen push succesvol verstuurd; opnieuw proberen is mogelijk',
      date: nl.dateKey,
      successCount,
      failureCount
    });
  } catch (error) {
    console.error('Cron weather error:', error);

    return res.status(500).json({
      status: 'Fout bij de weercontrole',
      error: String(error?.message || error),
      retryBlocked:
        lockClaimed
          ? 'De dagregistratie blijft staan om dubbele meldingen te voorkomen.'
          : undefined
    });
  }
}
