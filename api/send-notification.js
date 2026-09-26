import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app"
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

    const db = admin.database();
    const tokensSnapshot = await db.ref('padelData/tokens').once('value');
    const tokensData = tokensSnapshot.val();

    if (!tokensData) {
      return res.status(200).json({ success: true, message: 'Geen actieve tokens gevonden.' });
    }

    const tokens = Object.values(tokensData);

    if (tokens.length === 0) {
      return res.status(200).json({ success: true, message: 'Geen tokens aanwezig.' });
    }

    // Aangepast naar 'data' zodat de Service Worker dit feilloos opvangt en forceert
    const message = {
      tokens: tokens,
      data: {
        title: title || 'Padel Update',
        body: body || 'Er is een wijziging in het padelschema!'
      },
      webpush: {
        headers: {
          'Urgency': 'high'
        },
        fcmOptions: {
          link: '/'
        }
      }
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`Notificatie verzonden. Succesvol: ${response.successCount}, Mislukt: ${response.failureCount}`);

    return res.status(200).json({ 
      success: true, 
      successCount: response.successCount, 
      failureCount: response.failureCount 
    });
  } catch (error) {
    console.error('Fout bij versturen notificatie:', error);
    return res.status(500).json({ error: error.message });
  }
}




