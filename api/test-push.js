import { getTokensByPlayer, tokensOf, sendToTokens } from '../lib/padel.js';

// Testen: https://<jouw-site>/api/test-push?secret=<PUSH_TEST_SECRET>&name=Robert
// Zet eerst PUSH_TEST_SECRET als environment variable in Vercel. Zonder name gaat het naar iedereen.
export default async function handler(req, res) {
  try {
    const secret = process.env.PUSH_TEST_SECRET;
    if (!secret || req.query.secret !== secret) {
      return res.status(403).json({ error: 'Niet toegestaan.' });
    }

    const tokensData = await getTokensByPlayer();
    const name = req.query.name;
    const tokens = name ? tokensOf(tokensData, [name]) : tokensOf(tokensData, Object.keys(tokensData));

    if (tokens.length === 0) {
      return res.status(200).json({ status: 'Geen tokens gevonden.', spelersMetToken: Object.keys(tokensData) });
    }

    const result = await sendToTokens(tokens, { title: '🎾 Test', body: 'Als je dit ziet, werken pushmeldingen!' });
    return res.status(200).json({ tokensGevonden: tokens.length, ...result });
  } catch (error) {
    console.error('Fout bij testmelding:', error);
    return res.status(500).json({ error: error.message });
  }
}
