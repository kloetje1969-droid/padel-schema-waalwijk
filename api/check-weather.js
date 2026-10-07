import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const db = admin.database();

async function getRainChance() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=51.6833&longitude=5.0708&hourly=precipitation_probability&timezone=Europe/Amsterdam&forecast_days=1';
  const res = await fetch(url);
  const data = await res.json();
  const idx = data.hourly.time.findIndex(t => t.endsWith('T18:00'));
  return idx >= 0 ? data.hourly.precipitation_probability[idx] : 0;
}

export default async (req, res) => {
  try {
    const now = new Date();

    const currentDayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short' }).format(now);
    if (currentDayName !== 'Tue' && currentDayName !== 'Thu') {
      return res.status(200).json({ status: `Geen actie check-weather: Vandaag (${currentDayName}) is geen speeldag.` });
    }

    const currentHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false }).format(now), 10);
    if (currentHour !== 18) {
      return res.status(200).json({ status: `Geen actie check-weather: Het is nu ${currentHour}:00 uur (vereist: 18:00).` });
    }

    const rainChance = await getRainChance();
    if (rainChance < 60) {
      return res.status(200).json({ status: `Geen actie: Regenkans is ${rainChance}% (onder de drempel van 60%).` });
    }

    const tokensSnap = await db.ref('padelData/tokens').once('value');
    const tokensData = tokensSnap.val() || {};
    const targetTokens = [];
    Object.keys(tokensData).forEach(player => {
      targetTokens.push(...Object.keys(tokensData[player]));
    });

    if (targetTokens.length === 0) {
      return res.status(200).json({ status: 'Regenkans >= 60%, maar geen tokens gevonden.' });
    }

    const response = await admin.messaging().sendEachForMulticast({
      notification: {
        title: '🌧️ Padel Weeralarm',
        body: `Let op! De regenkans vanavond is ${rainChance}%. Houd het weer in de gaten!`
      },
      tokens: targetTokens
    });

    return res.status(200).json({ success: true, rainChance, successCount: response.successCount });
  } catch (error) {
    console.error('Fout bij weerscheck:', error);
    return res.status(500).json({ error: error.message });
  }
};
