const admin = require('firebase-admin');

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

// Voorbeeld: Functie om de regenkans op te halen (vervang dit met je echte weer-API logica, bijv. Buienradar of OpenWeatherMap)
async function getRainChance() {
    // Hier schrijf je de fetch naar je weer-provider voor vandaag/vanavond
    // Return het percentage als een getাল (bijv. 65)
    return 65; 
}

module.exports = async (req, res) => {
    try {
        const now = new Date();

        const optionsHour = { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false };
        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', optionsHour).format(now), 10);

        // Controleer of het exact 18:00 uur is in Nederland
        if (currentHour !== 18) {
            return res.status(200).json({ 
                status: `Geen actie check-weather: Het is nu ${currentHour}:00 uur (vereist: 18:00).` 
            });
        }

        // Haal de regenkans op
        const rainChance = await getRainChance();

        // Als de regenkans lager is dan 60%, onderneem geen actie
        if (rainChance < 60) {
            return res.status(200).json({ 
                status: `Geen actie: Regenkans is ${rainChance}% (onder de drempel van 60%).` 
            });
        }

        // Regenkans is 60% of hoger! Haal alle tokens op om iedereen te waarschuwen
        const tokensSnap = await db.ref('padelData/tokens').once('value');
        const tokensData = tokensSnap.val() || {};

        let targetTokens = [];
        Object.keys(tokensData).forEach(player => {
            const playerTokens = Object.keys(tokensData[player]);
            targetTokens.push(...playerTokens);
        });

        if (targetTokens.length === 0) {
            return res.status(200).json({ status: "Regenkans >= 60%, maar geen actieve tokens gevonden om te notifiëren." });
        }

        const messagePayload = {
            notification: {
                title: "🌧️ Padel Weeralarm",
                body: `Let op! De regenkans vanavond is ${rainChance}%. Houd het weer in de gaten!`
            },
            tokens: targetTokens
        };

        const response = await admin.messaging().sendEachForMulticast(messagePayload);

        return res.status(200).json({
            success: true,
            rainChance: rainChance,
            successCount: response.successCount
        });

    } catch (error)  {
        console.error("Fout bij weerscheck:", error);
        return res.status(500).json({ error: error.message });
    }
};
