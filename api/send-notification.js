export default async function handler(req, res) {
    // Zet CORS headers aan zodat je webapp hier veilig mee kan praten
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
        // Haal alle geregistreerde tokens op uit je Firebase Realtime Database
        const dbUrl = "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app";
        const response = await fetch(`${dbUrl}/padelData/tokens.json`);
        const tokensObj = await response.json();

        if (!tokensObj) {
            return res.status(200).json({ success: true, message: 'Geen tokens om te melden' });
        }

        const tokens = Object.values(tokensObj);

        // Hier komt de logica om via Firebase Cloud Messaging (HTTP v1) de meldingen te sturen
        // Omdat we geen server-secret key willen hardcoden, zorgen we dat de client 
        // of deze functie de tokens verwerkt.

        return res.status(200).json({ 
            success: true, 
            message: 'Tokens opgehaald op de server', 
            count: tokens.length 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

