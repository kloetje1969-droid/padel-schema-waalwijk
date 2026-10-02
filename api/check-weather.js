module.exports = async (req, res) => {
    try {
        const now = new Date();

        // 1. Controleer eerst of het vandaag wel dinsdag ('Tue') of donderdag ('Thu') is in Nederland
        const optionsDay = { timeZone: 'Europe/Amsterdam', weekday: 'short' };
        const currentDayName = new Intl.DateTimeFormat('en-US', optionsDay).format(now);
        
        if (currentDayName !== 'Tue' && currentDayName !== 'Thu') {
            return res.status(200).json({ 
                status: `Geen actie check-weather: Vandaag (${currentDayName}) is geen speeldag.` 
            });
        }

        // 2. Controleer daarna of het exact 18:00 uur is (houdt automatisch rekening met zomer/wintertijd)
        const optionsHour = { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false };
        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', optionsHour).format(now), 10);

        if (currentHour !== 18) {
            return res.status(200).json({ 
                status: `Geen actie check-weather: Het is nu ${currentHour}:00 uur (vereist: 18:00).` 
            });
        }

        // 3. Als het wél dinsdag of donderdag is én exact 18:00 uur, haal dan de regenkans op:
        const rainChance = await getRainChance();

        if (rainChance < 60) {
            return res.status(200).json({ 
                status: `Geen actie: Regenkans is ${rainChance}% (onder de drempel van 60%).` 
            });
        }

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
test
