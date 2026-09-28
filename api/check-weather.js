import admin from 'firebase-admin';

// Initialiseer Firebase Admin (zelfde als je andere API)
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
    // Vercel Cron beveiliging (optioneel maar handig)
    try {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 2 = Dinsdag, 4 = Donderdag

        // We controleren alleen op dinsdag (2) en donderdag (4)
        if (dayOfWeek !== 2 && dayOfWeek !== 4) {
            return res.status(200).json({ message: "Geen padeldag vandaag, geen actie vereist." });
        }

        const dateStr = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
        
        // Controleer in Firebase of we voor deze datum al een regenmelding hebben gestuurd (zodat we niet dubbel sturen)
        const sentRef = admin.database().ref(`padelData/rainNotified/${dateStr}`);
        const snapshot = await sentRef.once("value");
        if (snapshot.exists()) {
            return res.status(200).json({ message: "Regenmelding voor vandaag is al verstuurd." });
        }

        // Haal het weer op voor Waalwijk via Open-Meteo (lat: 51.68, lon: 5.07)
        const weatherRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=51.68&longitude=5.07&hourly=precipitation_probability&timezone=Europe%2FAmsterdam');
        const weatherData = await weatherRes.json();

        // Zoek het uur van 18:00 uur vandaag in de API data
        const hours = weatherData.hourly.time;
        const probabilities = weatherData.hourly.precipitation_probability;
        
        const targetHourStr = `${dateStr}T18:00`;
        const hourIndex = hours.findIndex(h => h.startsWith(targetHourStr));

        if (hourIndex === -1) {
            return res.status(400).json({ error: "Kon het weer voor 18:00 uur niet vinden." });
        }

        const rainChance = probabilities[hourIndex];

        // Als de kans op regen 60% of hoger is, stuur de notificatie!
        if (rainChance >= 60) {
            const tokensSnapshot = await admin.database().ref("padelData/tokens").once("value");
            const tokensData = tokensSnapshot.val();

            if (!tokensData) {
                return res.status(200).json({ message: "Geen tokens gevonden." });
            }

            let tokens = [];
            Object.values(tokensData).forEach(userTokens => {
                if (typeof userTokens === 'string') tokens.push(userTokens);
                else if (typeof userTokens === 'object' && userTokens !== null) tokens.push(...Object.keys(userTokens));
            });
            tokens = [...new Set(tokens)];

            if (tokens.length > 0) {
                const dayName = dayOfWeek === 2 ? "dinsdag" : "donderdag";
                const message = {
                    data: {
                        title: "⚠️ Padel Weerwaarschuwing",
                        body: `Let op! ${rainChance}% kans om te regenen vanavond om 18:00 uur!`,
                        click_action: "/"
                    },
                    tokens: tokens
                };

                await admin.messaging().sendEachForMulticast(message);
                
                // Sla in Firebase op dat we deze dag al een melding hebben gestuurd
                await sentRef.set(true);

                return res.status(200).json({ success: true, message: `Weerwaarschuwing (${rainChance}%) verzonden voor ${dateStr}.` });
            }
        }

        return res.status(200).json({ message: `Kans op regen is ${rainChance}%, geen melding nodig (< 60%).` });

    } catch (error) {
        console.error("Fout in weather cron:", error);
        return res.status(500).json({ error: error.message });
    }
}
