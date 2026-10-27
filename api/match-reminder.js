import { timingSafeEqual } from 'node:crypto';
import {
  db,
  amsterdamNow,
  getWeekInfo,
  defaultTemplate,
  getTokensByPlayer,
  tokensOf,
  sendToTokens
} from '../lib/padel.js';

const CRON_SECRET = process.env.CRON_SECRET;

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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Methode niet toegestaan.' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Niet geautoriseerd.' });
  }

  try {
    const nl = amsterdamNow();
    const vandaag = DAGEN[nl.weekday];
    if (!vandaag) {
      return res.status(500).json({ error: 'Onbekende weekdag.' });
    }

    const week = getWeekInfo(nl.year, nl.month, nl.day);
    const weekSnap = await db
      .ref(`padelData/scheduleOverrides/${week.key}`)
      .once('value');

    const weekOverride = weekSnap.val() || {};

    // Alle mogelijke dagen die als speeldag gebruikt kunnen worden
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

        actieveSlotInfo = { slot, timeString, hour, minute, override };
        break;
      }
    }

    if (!actieveSlotInfo) {
      return res.status(200).json({
        status: `Geen actieve speeldag/wedstrijd gepland op ${vandaag}.`
      });
    }

    // Match reminder moet exact 1 uur VÓÓR aanvangstijd draaien
    let targetHour = actieveSlotInfo.hour - 1;
    let targetMinute = actieveSlotInfo.minute;
    if (targetHour < 0) targetHour += 24;

    const currentH = Number(nl.hour || 0);
    const currentM = Number(nl.minute || 0);

    const targetTotalMins = targetHour * 60 + targetMinute;
    const currentTotalMins = currentH * 60 + currentM;

    // Marge van ca. 30 minuten om de cron-job de tijd te geven
    if (Math.abs(currentTotalMins - targetTotalMins) > 30) {
      return res.status(200).json({
        status: 'Niet het juiste tijdstip voor de match reminder.',
        doelTijd: `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}`,
        huidigeTijd: `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`
      });
    }

    const flagRef = db.ref(`padelData/sentMatchReminders/${nl.dateKey}`);
    const claim = await flagRef.transaction(cur => cur ? undefined : true);

    if (!claim.committed) {
      return res.status(200).json({
        status: `Herinnering voor ${nl.dateKey} is al verzonden.`
      });
    }

    try {
      const [absenceSnap, tokensData] = await Promise.all([
        db.ref('padelData/absence').once('value'),
        getTokensByPlayer()
      ]);

      const absences = absenceSnap.val() || {};
      const active = new Set();
      const slot = actieveSlotInfo.slot;
      const override = actieveSlotInfo.override;

      let players = [];
      if (Array.isArray(override) && override.length === 4) {
        players = override;
      } else if (override && override.players && Array.isArray(override.players)) {
        players = override.players;
      } else {
        const defaultSlot = (slot === 'dinsdag' || slot === 'donderdag') ? slot : 'dinsdag';
        players = defaultTemplate[week.templateIndex][defaultSlot] || [];
      }

      players.forEach(player => {
        if (!(absences[player] && absences[player][`${week.key}_${slot}`])) {
          active.add(player);
        }
      });

      const activeList = [...active];
      const tokens = tokensOf(tokensData, activeList);

      if (tokens.length === 0) {
        await flagRef.remove();
        return res.status(200).json({
          status: 'Geen tokens gevonden voor de spelers van vanavond.',
          players: activeList
        });
      }

      const result = await sendToTokens(tokens, {
        title: '🏓 Padel Reminder',
        body: `Over een uur (${actieveSlotInfo.timeString} uur) staat de padelwedstrijd gepland!`,
        tag: `padel-reminder-${nl.dateKey}`
      });

      if (result.successCount === 0) {
        await flagRef.remove();
      }

      return res.status(200).json({
        success: result.successCount > 0,
        notifiedPlayers: activeList,
        speelTijd: actieveSlotInfo.timeString,
        ...result
      });
    } catch (err) {
      await flagRef.remove();
      throw err;
    }
  } catch (error) {
    console.error('Fout bij versturen match reminder:', error);
    return res.status(500).json({
      error: 'Er ging iets mis bij het versturen van de herinnering.'
    });
  }
}
