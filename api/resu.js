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
            return res.status(200).json({ status: 'Geen speeldag vandaag, uitslag herinnering niet nodig.' });
        }

        let meldingVerzonden = false;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const startTijd = data.tijd; // Bijv. "18:30"
            const uitslagIngevoerd = data.uitslag && data.uitslag !== ""; // Controleer of uitslag al bekend is

            // Wedstrijd duurt 1 uur, melding moet 1 uur na afloop komen = starttijd + 2 uur totaal
            const [uren, minuten] = startTijd.split(':').map(Number);
            const eindDatumObj = new Date();
            eindDatumObj.setHours(uren + 2, minuten, 0, 0);
            
            const targetTijdUrenMin = eindDatumObj.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false });

            // 2. Controleer of het nu exact het moment is én of de uitslag nog ontbreekt
            if (huidigeTijdUrenMin === targetTijdUrenMin && !uitslagIngevoerd) {
                // Verstuur de pushmelding:
                // const bericht = `⚠️ De wedstrijd van ${startTijd} uur is inmiddels afgelopen. Vergeet niet om de uitslag in te voeren in het speelschema!`;
                // await verstuurPushNotificatie(bericht);

                meldingVerzonden = true;
            }
        }

        if (!meldingVerzonden) {
            return res.status(200).json({ status: 'Geen uitslag herinnering vereist op dit moment.' });
        }

        return res.status(200).json({ status: 'Uitslag herinnering succesvol verzonden.' });
    } catch (error) {
        console.error("Fout in uitslag herinnering cron:", error);
        return res.status(500).json({ error: 'Interne serverfout' });
    }
}
