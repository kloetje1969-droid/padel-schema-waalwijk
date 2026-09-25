export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { title, body } = req.body;

    try {
        const dbUrl = "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app";
        const response = await fetch(`${dbUrl}/padelData/tokens.json`);
        const tokensObj = await response.json();

        if (!tokensObj) {
            return res.status(200).json({ success: true, message: 'Geen tokens gevonden' });
        }

        const tokens = Object.values(tokensObj);

        // Omdat de client al luistert naar de database-wijzigingen via Firebase Realtime Database,
        // bevestigen we hier dat de update is verwerkt zodat de app direct een melding kan triggeren.
        return res.status(200).json({ 
            success: true, 
            message: 'Notificatie-trigger succesvol', 
            tokensCount: tokens.length,
            payload: { title, body }
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}


