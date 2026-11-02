import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
    initializeApp();
}
const db = getFirestore();

export default async function handler(req, res) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Niet geautoriseerd' });
    }

    try {
        const nu = new Date();
        const vandaagDatumStr = nu.toISOString().split('T')[0]; // Bijv. '2026-06-06'
        const huidigeTijdUrenMin = nu.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false });

        // 1. Haal het schema op voor vandaag uit Firebase
        const snapshot = await db.collection('speelschema').where('datum', '==', vandaagDatumStr).get();

        if (snapshot.empty) {
            return res.status(200).json({ status: 'Geen speeldag vandaag, geen weerwaarschuwing nodig.' });
        }

        let waarschuwingVerzonden = false;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const startTijd = data.tijd; // Bijv. "18:30"

            // Bereken de tijd die exact 30 minuten vóór de starttijd ligt
            const [uren, minuten] = startTijd.split(':').map(Number);
            const startDatumObj = new Date();
            startDatumObj.setHours(uren, minuten - 30, 0, 0);
            
            const targetTijdUrenMin = startDatumObj.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false });

            // 2. Controleer of het nu exact 30 minuten voor de wedstrijd is
            if (huidigeTijdUrenMin === targetTijdUrenMin) {
                
                // 3. Haal weerdata op (gebruik hier jouw KNMI- of weer-API logica)
                // Voorbeeldvariabelen (vervang dit met je werkelijke weer-data ophaalfunctie):
                const neerslagKans = 65;      //percentage (moet >= 60 zijn)
                const millimeterRegen = 1.2; //mm (moet >= 1 zijn)

                // 4. Toets aan jouw criteria
                if (neerslagKans >= 60 && millimeterRegen >= 1.0) {
                    // Verstuur de pushmelding:
                    // const bericht = `🌧️ Weerwaarschuwing: Voor de wedstrijd van ${startTijd} uur wordt ${neerslagKans}% neerslagkans en ${millimeterRegen} mm regen voorspeld.`;
                    // await verstuurPushNotificatie(bericht);

                    waarschuwingVerzonden = true;
                }
            }
        }

        if (!waarschuwingVerzonden) {
            return res.status(200).json({ status: 'Geen weerwaarschuwing vereist op dit moment.' });
        }

        return res.status(200).json({ status: 'Weerwaarschuwing succesvol verzonden.' });
    } catch (error) {
        console.error("Fout in weerwaarschuwing cron:", error);
        return res.status(500).json({ error: 'Interne serverfout' });
    }
}
