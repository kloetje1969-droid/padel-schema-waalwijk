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
    try {
        const now = new Date();
        
        // Controleer of het vandaag daadwerkelijk dinsdag (2) of donderdag (4) is
        const dayOfWeek = now.getDay(); 
        if (dayOfWeek !== 2 && dayOfWeek !== 4) {
            return res.status(200).json({ success: true, message: "Vandaag is geen speeldag, geen actie." });
        }

        // 1. Haal actueel weer op voor Waalwijk via Open-Meteo
        const url = "https://api.open-meteo.com/v1/forecast?latitude=51.6833&longitude=5.0708&hourly=precipitation_probability";
        const response = await fetch(url);
        const data = await response.json();

        // Pak het uur van nu (18:00 uur)
        const currentHour = now.getHours(); 
        const precipitationChance = data.hourly.precipitation_probability[currentHour] || 0;

        console.log(`Weercheck Vandaag 18:00 uur - Neerslagkans: ${precipitationChance}%`);

        // 2. Alleen verzenden bij >= 60% kans op regen
        if (precipitationChance >= 60) {
            
            // 3. Haal alle tokens op uit de Firebase Database
            const tokensSnapshot = await admin.database().ref("padelData/tokens").once("value");
            const tokensData = tokensSnapshot.val();

            if (!tokensData) {
                return res.status(200).json({ message: "Geen tokens gevonden om te pushen." });
            }

            const tokens = Object.values(tokensData);

            // 4. Stel de pushmelding samen
            const message = {
                notification: {
                    title: "⚠️ Padel Weeralarm!",
                    body: `Let op: er is vandaag om 18:00 uur ${precipitationChance}% kans op regen.`
                },
                tokens: tokens
            };

            // 5. Verstuur via Firebase Messaging
            const responseFCM = await admin.messaging().sendEachForMulticast(message);
            
            return res.status(200).json({ 
                success: true, 
                message: "Melding voor de actuele speeldag verzonden!", 
                sentCount: responseFCM.successCount 
            });
        }

        return res.status(200).json({ success: true, message: "Neerslagkans onder 60% voor vandaag, geen melding nodig." });

    } catch (error) {
        console.error("Fout in weercheck:", error);
        return res.status(500).json({ error: error.message });
    }
}
