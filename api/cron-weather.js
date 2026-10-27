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

const DAGEN = {
  Mon: 'maandag',
  Tue: 'dinsdag',
  Wed: 'woensdag',
  Thu: 'donderdag',
  Fri: 'vrijdag',
  Sat: 'zaterdag',
  Sun: 'zondag'
};

const DAY_ALIASES = {
  maandag: 'maandag', monday: 'maandag', mon: 'maandag',
  dinsdag: 'dinsdag', tuesday: 'dinsdag', tue: 'dinsdag',
  woensdag: 'woensdag', wednesday: 'woensdag', wed: 'woensdag',
  donderdag: 'donderdag', thursday: 'donderdag', thu: 'donderdag',
  vrijdag: 'vrijdag', friday: 'vrijdag', fri: 'vrijdag',
  zaterdag: 'zaterdag', saturday: 'zaterdag', sat: 'zaterdag',
  zondag: 'zondag', sunday: 'zondag', sun: 'zondag'
};

function authorized(req) {
  const supplied = String(req.headers['x-cron-secret'] || '');
  if (!CRON_SECRET || !supplied) return false;
  const sBuf = Buffer.from(supplied);
  const eBuf = Buffer.from(CRON_SECRET);
  if (sBuf.length !== eBuf.length) return false;
  return timingSafeEqual(sBuf, eBuf);
}

function normalizeDay(value) {
  if (!value) return null;
  return DAY_ALIASES[String(value).trim().toLowerCase()] || null;
}

function parseTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return { hour: 18, minute: 30 };
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m)) return { hour: h, minute: m };
  }
  return { hour: 18, minute: 30 };
}

async function getRainForecast(dateKey, targetHour) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', '51.682');
  url.searchParams.set('longitude', '5.070');
  url.searchParams.set('hourly', 'precipitation_probability,precipitation');
  url.searchParams.set('models', 'knmi_seamless');
  url.searchParams.set('timezone', 'Europe/Amsterdam');
  url.searchParams.set('forecast_days', '2');

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Weerservice gaf HTTP ${response.status}`);
  const weather = await response.json();
  const hourly = weather.hourly;

  const targetTime = `${dateKey}T${String(targetHour).padStart(2, '0')}:00`;
  const index = hourly.time.indexOf(targetTime);
  if (index === -1) throw new Error(`Geen weersverwachting gevonden voor ${targetTime}`);

  return {
    probability: Number(hourly.precipitation_probability[index] ?? 0),
    precipitation: Number(hourly.precipitation?.[index] ?? 0)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ status: 'Methode niet toegestaan' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ status: 'Niet geautoriseerd' });
  }

  let lockRef = null;
  let lockClaimed = false;

  try {
    const nl = amsterdamNow();
    const vandaag = DAGEN[nl.weekday];
    if (!vandaag) return res.status(500).json({ status: 'Onbekende weekdag' });

    const week = getWeekInfo(nl.year, nl.month, nl.day);
    const weekSnap = await db.ref(`padelData/scheduleOverrides/${week.key}`).once('value');
    const weekOverride = weekSnap.val() || {};

    const possibleSlots = ['dinsdag', 'donderdag', 'maandag', 'woensdag', 'vrijdag', 'zaterdag', 'zondag'];
    let actieveSlotInfo = null;

    for (const slot of possibleSlots) {
      const override = weekOverride[slot];
      if (override && typeof override === 'object' && !Array.isArray(override) && override.cancelled === true) {
        continue;
      }

      const customKey = `custom${slot.charAt(0).toUpperCase() + slot.slice(1)}`;
      const specificTimeKey = weekOverride[`${slot}Tijd`] ? `${slot}Tijd` : `custom${slot.charAt(0).toUpperCase() + slot.slice(1)}Tijd`;
      const scheduledDay = normalizeDay(weekOverride[customKey]) || normalizeDay(override?.day) || slot;

      if (scheduledDay === vandaag) {
        const timeString = weekOverride[specificTimeKey] || override?.time || '18:30';
        const { hour, minute } = parseTime(timeString);

        let players = ['Marcel', 'Mark', 'Ronald', 'Sander', 'Dennis', 'Robert'];
        if (override && override.players && Array.isArray(override.players)) {
          players = override.players;
        } else {
          const matchSnap = await db.ref(`padelData/matches/${week.key}/${slot}`).once('value');
          const matchData = matchSnap.val();
          if (matchData && matchData.players) {
            players = Array.isArray(matchData.players) ? matchData.players : Object.values(matchData.players);
          }
        }

        actieveSlotInfo = { slot, timeString, hour, minute, players, override };
        break;
      }
    }

    if (!actieveSlotInfo) {
      return res.status(200).json({ status: 'Geen actieve speeldag vandaag', date: nl.dateKey });
    }

    // Weerscheck moet precies 30 minuten vóór aanvang draaien
    let checkHour = actieveSlotInfo.hour;
    let checkMinute = actieveSlotInfo.minute - 30;
    if (checkMinute < 0) {
      checkMinute += 60;
      checkHour -= 1;
    }

    const currentH = Number(nl.hour || 0);
    const currentM = Number(nl.minute || 0);
    const targetTotalMins = checkHour * 60 + checkMinute;
    const currentTotalMins = currentH * 60 + currentM;

    if (Math.abs(currentTotalMins - targetTotalMins) > 30) {
      return res.status(200).json({
        status: 'Niet het juiste tijdstip voor de weerscheck',
        doelTijd: `${String(checkHour).padStart(2, '0')}:${String(checkMinute).padStart(2, '0')}`,
        huidigeTijd: `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`
      });
    }

    const forecast = await getRainForecast(nl.dateKey, actieveSlotInfo.hour);

    if (forecast.probability < RAIN_THRESHOLD || forecast.precipitation <= PRECIPITATION_THRESHOLD) {
      return res.status(200).json({ status: 'Geen weerpush nodig (onder drempel)', probability: forecast.probability, precipitation: forecast.precipitation });
    }

    const tokensData = await getTokensByPlayer();
    const tokens = tokensOf(tokensData, actieveSlotInfo.players);
    if (tokens.length === 0) {
      return res.status(200).json({ status: 'Geen pushtokens gevonden' });
    }

    lockRef = db.ref(`padelData/sentWeatherPushes/${nl.dateKey}`);
    const claim = await lockRef.transaction(current => (current !== null ? undefined : { status: 'sending', startedAt: Date.now() }));
    if (!claim.committed) {
      return res.status(200).json({ status: 'Weerpush vandaag al verstuurd' });
    }
    lockClaimed = true;

    const result = await sendToTokens(tokens, {
      title: '🌧️ Kans op regen tijdens padel',
      body: `Vanavond om ${actieveSlotInfo.timeString} uur padel. Regenkans ${forecast.probability}% (${forecast.precipitation} mm).`,
      tag: `padel-weather-${nl.dateKey}`
    });

    if (Number(result?.successCount || 0) > 0) {
      await lockRef.update({ status: 'sent', sentAt: Date.now(), successCount: result.successCount });
      return res.status(200).json({ status: 'Weerpush verstuurd', successCount: result.successCount });
    }

    await lockRef.remove();
    return res.status(502).json({ status: 'Geen push afgeleverd' });
  } catch (error) {
    console.error('Cron weather error:', error);
    if (lockClaimed && lockRef) await lockRef.remove();
    return res.status(500).json({ status: 'Fout bij weercontrole', error: String(error?.message || error) });
  }
}
