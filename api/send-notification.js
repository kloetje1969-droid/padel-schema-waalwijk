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
    const { token, title, body } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'FCM token is verplicht' });
    }

    const message = {
      token: token,
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

    const response = await admin.messaging().send(message);
    return res.status(200).json({ success: true, messageId: response });
  } catch (error) {
    console.error('Fout bij versturen notificatie:', error);
    return res.status(500).json({ error: error.message });
  }
}



