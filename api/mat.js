export default async function handler(req, res) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Niet geautoriseerd' });
    }

    try {
        // TODO: Bouw hier je database-check (of het exact 30 minuten voor de speeltijd is)
        const isExactDertigMinutenVoorStart = false; 

        if (!isExactDertigMinutenVoorStart) {
            return res.status(200).json({ status: 'Geen herinnering nodig op dit moment.' });
        }

        // Hier komt straks de logica om de pushmelding te versturen:
        // "⏰ Herinnering: De padelwedstrijd begint over een half uur (om [tijd] uur) op [Baan X]!"

        return res.status(200).json({ status: 'Padel herinnering succesvol verzonden.' });
    } catch (error) {
        console.error("Fout:", error);
        return res.status(500).json({ error: 'Interne serverfout' });
    }
}
