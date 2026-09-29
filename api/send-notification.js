import admin from 'firebase-admin';

// Initialiseer Firebase Admin met de service account die al in Vercel staat
if (!admin.apps.length) {
    let serviceAccount;
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
        serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app"
    });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { title, body, force } = req.body;

        if (!title || !body) {
            return res.status(400).json({ error: 'Titel en bericht (body) zijn verplicht.' });
        }

        // Bepaal de huidige datum in YYYY-MM-DD formaat om eenmalige verzending per dag te garanderen
        const today = new Date().toISOString().split('T')[0];
        const notifiedRef = admin.database().ref(`padelData/notified/${today}`);

        // Controleer of er vandaag al een melding is gestuurd (tenzij 'force' true is)
        if (!force) {
            const snapshot = await notifiedRef.once("value");
            if (snapshot.exists()) {
                return res.status(200).json({ 
                    success: false, 
                    message: "Er is vandaag al een melding verzonden." 
                });
            }
        }

        // 1. Haal alle tokens op uit de Firebase Database
        const tokensSnapshot = await admin.database().ref("padelData/tokens").once("value");
        const tokensData = tokensSnapshot.val();

        if (!tokensData) {
            return res.status(200).json({ message: "Geen tokens gevonden om te pushen." });
        }

        let tokens = [];

        // Loop door alle gebruikers heen in de tokens-map
        Object.values(tokensData).forEach(userTokens => {
            if (typeof userTokens === 'string') {
                tokens.push(userTokens);
            } else if (typeof userTokens === 'object' && userTokens !== null) {
                tokens.push(...Object.keys(userTokens));
            }
        });

        // Verwijder eventuele dubbele tokens uit de lijst
        tokens = [...new Set(tokens)];

        if (tokens.length === 0) {
            return res.status(200).json({ message: "Geen geldige tokens om naar te pushen." });
        }

        // 2. Stel de pushmelding samen met ALLEEN een data-payload
        const message = {
            data: {
                title: title,
                body: body,
                click_action: "/"
            },
            tokens: tokens
        };

        // 3. Verstuur de berichten via multicast naar alle tokens
        const response = await admin.messaging().sendEachForMulticast(message);

        // 4. Sla direct in Firebase op dat er vandaag een melding is verstuurd
        await notifiedRef.set({
            timestamp: Date.now(),
            title: title,
            successCount: response.successCount
        });

        return res.status(200).json({ 
            success: true, 
            successCount: response.successCount,
            failureCount: response.failureCount 
        });

    } catch (error) {
        console.error("Fout bij versturen pushmelding:", error);
        return res.status(500).json({ error: error.message });
    }
}
