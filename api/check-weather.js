import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';

// Firebase Admin initialiseren
if (!getApps().length) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL: "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app"
    });
}

const db = getDatabase();
const messaging = getMessaging();

export default async function handler(req, res) {
    // Beveiliging: Vercel cronjobs sturen een specifieke header mee
    const authHeader = req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const now = new Date();

        // 1. Controleer de dag én het uur in de juiste tijdzone (Europe/Amsterdam)
        const optionsDay = { timeZone: 'Europe/Amsterdam', weekday: 'short' };
        const optionsHour = { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false };

        const currentDay = new Intl.DateTimeFormat('en-US', optionsDay).format(now); // 'Tue' of 'Thu'
        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', optionsHour).format(now), 10); // getal 0 t/m 23

        // 2. Strenge check: Het MOET dinsdag of donderdag zijn, én het MOET exact 18:00 uur zijn
        if ((currentDay !== 'Tue' && currentDay !== 'Thu') || currentHour !== 18) {
            return res.status(200).json({ 
                message: `Geen actie: Vandaag is ${currentDay} en het is ${currentHour}:00 uur (vereist: di of do om 18:00).` 
            });
        }

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const dayNum = String(now.getDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${dayNum}`;
        const dayName = currentDay === 'Tue' ? 'dinsdag' : 'donderdag';

        // 3. Controleer of er voor VANDAAG al een melding is gestuurd om dubbele notificaties te voorkomen
        const notificationRef = db.ref(`padelData/sentWeatherNotifications/${dateKey}`);
        const snapshot = await notificationRef.once('value');
        if (snapshot.exists()) {
            return res.status(200).json({ message: `Melding voor ${dayName} (${dateKey}) is al verzonden.` });
        }

        // 4. Haal het weer op via Open-Meteo voor VANDAAG om 18:00 uur
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=51.6833&longitude=5.0708&hourly=precipitation_probability&start_date=${dateKey}&end_date=${dateKey}&timezone=Europe/Amsterdam`;
        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();

        if (!weatherData || !weatherData.hourly || !weatherData.hourly.precipitation_probability) {
            return res.status(500).json({ error: 'Kon weerdata niet ophalen' });
        }

        // Zoek de index op voor 18:00 uur (uur 18 in de array van die dag)
        const rainChance = weatherData.hourly.precipitation_probability[18] || 0;

        // 5. Als de regenkans vandaag om 18:00 uur 60% of hoger is, stuur de notificatie
        if (rainChance >= 60) {
            const tokensSnapshot = await db.ref('padelData/tokens').once('value');
            const tokensData = tokensSnapshot.val() || {};

            let allTokens = [];
            Object.values(tokensData).forEach(userTokens => {
                if (userTokens) {
                    allTokens.push(...Object.keys(userTokens));
                }
            });

            if (allTokens.length > 0) {
                const message = {
                    notification: {
                        title: "⚠️ Padel Weerwaarschuwing",
                        body: `Let op! Er is ${rainChance}% kans op regen om 18:00 uur vanavond (${dayName})!`
                    },
                    tokens: allTokens
                };

                await messaging.sendEachForMulticast(message);
            }

            // Sla op dat de melding voor deze datum is verzonden
            await notificationRef.set(true);

            return res.status(200).json({ success: true, message: `Weerwaarschuwing verstuurd voor ${dayName} (${rainChance}% neerslag).` });
        }

        return res.status(200).json({ success: true, message: `Neerslagkans voor ${dayName} is ${rainChance}%, geen melding nodig.` });

    } catch (error) {
        console.error("Fout in cronjob:", error);
        return res.status(500).json({ error: error.message });
    }
}
