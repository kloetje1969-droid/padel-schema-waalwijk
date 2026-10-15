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
  { dinsdag: ["Sander", "Mark", "Robert", "Dennis"],  donderdag: ["Marcel", "Ronald", "Robert", "Dennis"] },
  { dinsdag: ["Sander", "Dennis", "Mark", "Ronald"],  donderdag: ["Robert", "Marcel", "Mark", "Ronald"] },
  { dinsdag: ["Mark", "Marcel", "Robert", "Sander"],  donderdag: ["Ronald", "Dennis", "Robert", "Sander"] },
  { dinsdag: ["Ronald", "Sander", "Dennis", "Marcel"], donderdag: ["Robert", "Mark", "Dennis", "Marcel"] },
  { dinsdag: ["Robert", "Ronald", "Marcel", "Sander"], donderdag: ["Dennis", "Mark", "Marcel", "Sander"] },
  { dinsdag: ["Robert", "Dennis", "Mark", "Ronald"],  donderdag: ["Marcel", "Sander", "Mark", "Ronald"] }
];

const REFERENCE_MONDAY_UTC = Date.UTC(2026, 8, 21);
const ICON = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3d3.png';

// Datum/tijd zoals die nu in Nederland is (server draait in UTC)
export function amsterdamNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
