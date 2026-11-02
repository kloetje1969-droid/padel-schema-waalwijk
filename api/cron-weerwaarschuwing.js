export default async function handler(req, res) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Niet geautoriseerd' });
    }

    try {
        const isDertigMinutenVoorStart = false; // Check of wedstrijd over 30 min begint
        const voldoetAanWeerCriteria = false; // Check of neerslagkans >= 60% en regen >= 1mm

        if (!isDertigMinutenVoorStart || !voldoetAanWeerCriteria) {
            return res.status(200).json({ status: 'Geen weerwaarschuwing vereist.' });
        }

        // Hier komt de logica voor de melding:
        // "🌧️ Weerwaarschuwing: Voor de wedstrijd van [tijd] uur wordt [X]% neerslagkans en [X] mm regen voorspeld."

        return res.status(200).json({ status: 'Weerwaarschuwing verzonden.' });
    } catch (error) {
        console.error("Fout:", error);
        return res.status(500).json({ error: 'Interne serverfout' });
    }
}
