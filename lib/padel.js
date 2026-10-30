import admin from 'firebase-admin';
import { timingSafeEqual } from 'node:crypto';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

export const db = admin.database();
export const TZ = 'Europe/Amsterdam';

// LET OP: houd dit gelijk aan defaultTemplate in index.html
export const defaultTemplate = [
         { dinsdag: ["Sander", "Dennis", "Mark", "Robert"], donderdag: ["Marcel", "Ronald", "Sander", "Robert"] },
         { dinsdag: ["Marcel", "Mark", "Ronald", "Robert"], donderdag: ["Mark", "Sander", "Ronald", "Dennis"] },
         { dinsdag: ["Marcel", "Robert", "Mark", "Dennis"], donderdag: ["Marcel", "Ronald", "Sander", "Robert"] },
         { dinsdag: ["Marcel", "Sander", "Mark", "Dennis"], donderdag: ["Mark", "Ronald", "Dennis", "Robert"] },
         { dinsdag: ["Marcel", "Dennis", "Ronald", "Sander"], donderdag: ["Marcel", "Sander", "Mark", "Robert"] },
         { dinsdag: ["Dennis", "Robert", "Sander", "Ronald"], donderdag: ["Marcel", "Dennis", "Mark", "Ronald"] }
    ];

const REFERENCE_MONDAY_UTC = Date.UTC(2026, 8, 21);

// Datum/tijd zoals die nu in Nederland is (server draait in UTC)
export function amsterdamNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return {
    weekday: p.weekday,
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24,
    minute: +p.minute,
    dateKey: `${p.year}-${p.month}-${p.day}`
  };
}

// Weeksleutel (ISO-jaar + weeknummer) en template-index voor een kalenderdatum
export function getWeekInfo(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  
  // 1. Bepaal de maandag van de huidige week (ISO week start op maandag)
  const dayNum = date.getUTCDay() || 7; // Zondag = 7, Maandag = 1
  const mondayUtc = Date.UTC(y, m - 1, d) - (dayNum - 1) * 86400000;
  
  // 2. Bepaal de donderdag van deze week om het ISO-jaar te bepalen
  const thursday = new Date(mondayUtc + 3 * 86400000);
  const isoYear = thursday.getUTCFullYear();
  
  // 3. Eerste donderdag van het ISO-jaar
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstMondayUtc = Date.UTC(isoYear, 0, 4) - ((firstThursday.getUTCDay() || 7) - 1) * 86400000;
  
  // 4. ISO Weeknummer
  const weekNum = Math.round((mondayUtc - firstMondayUtc) / (7 * 86400000)) + 1;
  
  // 5. Verschil in weken t.o.v. de referentiemaandag voor het overgangsschema
  const diffWeeks = Math.round((mondayUtc - REFERENCE_MONDAY_UTC) / (7 * 86400000));
  
  return { 
    key: `${isoYear}_w${weekNum}`, 
    weekNum, 
    templateIndex: ((diffWeeks % 6) + 6) % 6 
  };
}
// ---- Gedeelde hulpfuncties voor de cron-bestanden ----

// Controleert de x-cron-secret of Authorization header
export function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET ontbreekt.');
    return false;
  }
  
  // Accepteer zowel x-cron-secret als een Authorization Bearer token
  let supplied = req.headers['x-cron-secret'];
  if (!supplied && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    if (authHeader.startsWith('Bearer ')) {
      supplied = authHeader.substring(7);
    }
  }

  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const DAGEN = {
  Mon: 'maandag', Tue: 'dinsdag', Wed: 'woensdag', Thu: 'donderdag',
  Fri: 'vrijdag', Sat: 'zaterdag', Sun: 'zondag'
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

const toArray = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);

// Alle wedstrijden van vandaag (dinsdag-slot en/of donderdag-slot, ook als die naar een andere dag zijn verplaatst).
// Afgelaste wedstrijden worden overgeslagen.
export function getTodaysMatches(nl, week, weekOverride) {
  const vandaag = DAGEN[nl.weekday];
  const matches = [];

  for (const slot of ['dinsdag', 'donderdag']) {
    const raw = weekOverride[slot];
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.cancelled === true) continue;

    const cap = slot.charAt(0).toUpperCase() + slot.slice(1);
    const scheduledDay = normalizeDay(weekOverride[`custom${cap}`]) || slot;
    if (scheduledDay !== vandaag) continue;

    const timeString = weekOverride[`${slot}Tijd`] || weekOverride[`custom${cap}Tijd`] || '18:30';
    const { hour, minute } = parseTime(timeString);

    let players;
    if (Array.isArray(raw)) {
      players = raw;
    } else if (raw && raw.players) {
      players = toArray(raw.players);
    } else {
      players = defaultTemplate[week.templateIndex][slot] || [];
    }

    matches.push({ slot, timeString, hour, minute, players });
  }

  return matches;
}

// Is het nu op of na het doeltijdstip, maar niet langer dan windowMin minuten later?
export function inWindow(nl, targetMinutesOfDay, windowMin = 30) {
  const nowMins = nl.hour * 60 + nl.minute;
  return nowMins >= targetMinutesOfDay && nowMins < targetMinutesOfDay + windowMin;
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export async function getTokensByPlayer() {
  const snap = await db.ref('padelData/tokens').once('value');
  return snap.val() || {};
}

export function tokensOf(tokensData, players) {
  const out = [];
  players.forEach(p => { if (tokensData[p]) out.push(...Object.keys(tokensData[p])); });
  return [...new Set(out)];
}

// Verstuurt een melding, ruimt ongeldige tokens op en geeft foutcodes terug (handig bij debuggen)
export async function sendToTokens(tokens, { title, body, tag }) {
  const unique = [...new Set(tokens)];
  let successCount = 0;
  const errorCodes = [];
  const stale = new Set();

  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    // Alleen een data-bericht: de service worker toont de melding zelf (precies 1x, geen dubbele)
    const data = { title: String(title), body: String(body) };
    if (tag) data.tag = String(tag);
    const message = {
      tokens: batch,
      data,
      webpush: {
        headers: { Urgency: 'high', TTL: '7200' }
      }
    };
    const resp = await admin.messaging().sendEachForMulticast(message);
    successCount += resp.successCount;
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        errorCodes.push(code);
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          stale.add(batch[idx]);
        }
      }
    });
  }

  if (stale.size > 0) {
    const tokensData = await getTokensByPlayer();
    const updates = {};
    Object.keys(tokensData).forEach(player => {
      Object.keys(tokensData[player] || {}).forEach(t => {
        if (stale.has(t)) updates[`padelData/tokens/${player}/${t}`] = null;
      });
    });
    if (Object.keys(updates).length) await db.ref().update(updates);
  }

  return { successCount, failureCount: unique.length - successCount, errorCodes };
}
