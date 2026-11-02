export default async function handler(req, res) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Niet geautoriseerd' });
    }

    try {
        // Check of het exact 1 uur na afloop is en of de uitslag nog ontbreekt
        const isEenUurNaAfloopEnUitslagOntbreekt = false; 

        if (!isEenUurNaAfloopEnUitslagOntbreekt) {
            return res.status(200).json({ status: 'Geen actie vereist voor uitslag herinnering.' });
        }

        // Hier komt de logica voor de melding:
        // "⚠️ De wedstrijd van [tijd] uur is inmiddels afgelopen. Vergeet niet om de uitslag in te voeren in het speelschema!"

        return res.status(200).json({ status: 'Uitslag herinnering verzonden.' });
    } catch (error) {
        console.error("Fout:", error);
        return res.status(500).json({ error: 'Interne serverfout' });
    }
}
