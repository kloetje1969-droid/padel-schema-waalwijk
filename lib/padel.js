import admin from 'firebase-admin';

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
  { dinsdag: ["Mark", "Robert", "Ronald", "Sander"], donderdag: ["Marcel", "Robert", "Sander", "Dennis"] },
  { dinsdag: ["Marcel", "Mark", "Ronald", "Robert"], donderdag: ["Mark", "Sander", "Ronald", "Dennis"] },
  { dinsdag: ["Marcel", "Robert", "Mark", "Dennis"], donderdag: ["Marcel", "Ronald", "Sander", "Robert"] },
  { dinsdag: ["Marcel", "Sander", "Mark", "Dennis"], donderdag: ["Mark", "Ronald", "Dennis", "Robert"] },
  { dinsdag: ["Marcel", "Dennis", "Ronald", "Sander"], donderdag: ["Marcel", "Sander", "Mark", "Robert"] },
  { dinsdag: ["Ronald", "Robert", "Sander", "Dennis"], donderdag: ["Marcel", "Dennis", "Mark", "Ronald"] }
];

const REFERENCE_MONDAY_UTC = Date.UTC(2026, 8, 21);
const ICON = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3d3.png';

// Datum/tijd zoals die nu in Nederland is (server draait in UTC)
export function amsterdamNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return {
    weekday: p.weekday,
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24,
    dateKey: `${p.year}-${p.month}-${p.day}`
  };
}

// Weeksleutel (ISO-jaar + weeknummer) en template-index voor een kalenderdatum
export function getWeekInfo(y, m, d) {
  const date = Date.UTC(y, m - 1, d);
  const dow = (new Date(date).getUTCDay() + 6) % 7; // ma = 0
  const monday = date - dow * 86400000;
// Verstuurt een melding, ruimt ongeldige tokens op en geeft foutcodes terug (handig bij debuggen)
export async function sendToTokens(tokens, { title, body }) {
  const unique = [...new Set(tokens)];
  let successCount = 0;
  const errorCodes = [];
  const stale = new Set();

  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const message = {
      tokens: batch,
      notification: { title, body },
      webpush: {
        headers: { Urgency: 'high', TTL: '7200' },
        notification: { icon: ICON },
        ...(process.env.APP_URL ? { fcmOptions: { link: process.env.APP_URL } } : {})
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
