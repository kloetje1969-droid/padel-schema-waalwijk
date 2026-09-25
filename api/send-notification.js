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

        // Client-side fallback / berichtweergave logica
        // Aangezien we de Firebase Admin SDK service account key niet hardcoden op Vercel,
        // sturen we een succesvolle response terug met de tokens, zodat de client 
        // via de browser/service worker de notificatie kan tonen of pushen.
        
        return res.status(200).json({ 
            success: true, 
            message: 'Tokens succesvol opgehaald', 
            tokens: tokens,
            count: tokens.length 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}


