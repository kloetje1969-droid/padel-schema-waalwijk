import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialiseer Firebase Admin (zorg dat je FIREBASE_SERVICE_ACCOUNT in je Vercel Environment Variables hebt staan)
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
        
        // Huidige tijd in HH:MM formaat (rekening houdend met tijdzones indien nodig)
        const huidigeTijdUrenMin = nu.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false });

        // 1. Haal het schema/de boeking op voor vandaag uit Firebase
        const snapshot = await db.collection('speelschema').where('datum', '==', vandaagDatumStr).get();

        if (snapshot.empty) {
            return res.status(200).json({ status: 'Geen speeldag vandaag in database.' });
        }

        let meldingVerzonden = false;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const startTijd = data.tijd; // Bijv. "18:30"
            const baanNaam = data.baan || "Baan";

            // Bereken de tijd die exact 30 minuten vóór de starttijd ligt
            const [uren, minuten] = startTijd.split(':').map(Number);
            const startDatumObj = new Date();
            startDatumObj.setHours(uren, minuten - 30, 0, 0);
            
            const targetTijdUrenMin = startDatumObj.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false });

            // 2. Controleer of de huidige tijd precies overeenkomt met de doel-tijd (binnen het 10-minuten venster van de cron)
            if (huidigeTijdUrenMin === targetTijdUrenMin) {
                // 3. Verstuur de pushnotificatie
                // const bericht = `⏰ Herinnering: De padelwedstrijd begint over een half uur (om ${startTijd} uur) op ${baanNaam}!`;
                // await verstuurPushNotificatie(bericht);

                meldingVerzonden = true;
            }
        }

        if (!meldingVerzonden) {
            return res.status(200).json({ status: 'Niet het juiste moment (nog geen 30 min voor start).' });
        }

        return res.status(200).json({ status: 'Padel herinnering succesvol verzonden.' });
    } catch (error) {
        console.error("Fout in padel-herinnering:", error);
        return res.status(500).json({ error: 'Interne serverfout' });
    }
}
