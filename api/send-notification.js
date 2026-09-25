import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error('Fout bij initialiseren Firebase Admin:', error);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { title, body } = req.body;

    // Haal alle opgeslagen tokens op uit de Firebase Realtime Database
    const db = admin.database();
    const tokensSnapshot = await db.ref('padelData/tokens').once('value');
    const tokensData = tokensSnapshot.val();

    if (!tokensData) {
      return res.status(200).json({ success: true, message: 'Geen actieve tokens gevonden om naar te versturen.' });
    }

    // Verzamel alle losse tokens uit de objecten
    const tokens = Object.values(tokensData);

    if (tokens.length === 0) {
      return res.status(200).json({ success: true, message: 'Geen tokens aanwezig.' });
    }

    // Bouw het notificatiebericht voor multicast (naar meerdere apparaten tegelijk)
    const message = {
      tokens: tokens,
      notification: {
        title: title || 'Padel Update',
        body: body || 'Er is een wijziging in het padelschema!'
      },
      webpush: {
        fcmOptions: {
          link: '/'
        }
      }
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    return res.status(200).json({ success: true, successCount: response.successCount, failureCount: response.failureCount });
  } catch (error) {
    console.error('Fout bij versturen notificatie:', error);
    return res.status(500).json({ error: error.message });
  }
}



