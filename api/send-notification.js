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
        const { title, body, senderToken } = req.body;

        if (!title || !body) {
            return res.status(400).json({ error: 'Titel en bericht (body) zijn verplicht.' });
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
                // Oud formaat: direct een string token
                tokens.push(userTokens);
            } else if (typeof userTokens === 'object' && userTokens !== null) {
                // Nieuw formaat: een object/lijst van tokens per apparaat (bijv. { tokenA: true, tokenB: true })
                tokens.push(...Object.keys(userTokens));
            }
        });

        // Verwijder eventuele dubbele tokens uit de lijst
        tokens = [...new Set(tokens)];

        // Zorg ervoor dat de afzender (indien meegeestuurd) ook in de lijst staat
        if (senderToken && !tokens.includes(senderToken)) {
            tokens.push(senderToken);
        }

        if (tokens.length === 0) {
            return res.status(200).json({ message: "Geen geldige tokens om naar te pushen." });
        }

        // 2. Stel de pushmelding samen
        const message = {
            notification: {
                title: title,
                body: body
            },
            tokens: tokens
        };

        // 3. Verstuur via Firebase Messaging (Multicast)
        const responseFCM = await admin.messaging().sendEachForMulticast(message);

        console.log(`Notificatie verzonden. Succesvol: ${responseFCM.successCount}, Mislukt: ${responseFCM.failureCount}`);

        return res.status(200).json({ 
            success: true, 
            message: "Notificatie succesvol verzonden!", 
            successCount: responseFCM.successCount,
            failureCount: responseFCM.failureCount
        });

    } catch (error) {
        console.error("Fout bij verzenden notificatie:", error);
        return res.status(500).json({ error: error.message });
    }
}
