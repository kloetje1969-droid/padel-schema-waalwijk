
import { timingSafeEqual } from 'node:crypto';
import { getTokensByPlayer, tokensOf, sendToTokens } from '../lib/padel.js';

const ALLOWED_PLAYERS = [
  'Marcel',
  'Mark',
  'Ronald',
  'Sander',
  'Dennis',
  'Robert'
];

function isAuthorized(req) {
  const secret = process.env.PUSH_TEST_SECRET;
  const supplied = req.headers['x-push-test-secret'];

  if (!secret || typeof supplied !== 'string') return false;

  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);

  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Gebruik POST.' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Niet geautoriseerd.' });
  }

  const name = req.body?.name;

  if (typeof name !== 'string' || !ALLOWED_PLAYERS.includes(name)) {
    return res.status(400).json({
      error: 'Kies precies één geldige speler via name.'
    });
  }

  try {
    const tokensData = await getTokensByPlayer();
    const tokens = tokensOf(tokensData, [name]);

    if (tokens.length === 0) {
      return res.status(200).json({
        status: 'Geen push-token gevonden voor deze speler.',
        speler: name
      });
    }

    const result = await sendToTokens(tokens, {
      title: '🎾 Testmelding padelapp',
      body: 'Als je dit ziet, werkt de pushmelding!'
    });

    return res.status(200).json({
      speler: name,
      tokensGevonden: tokens.length,
      ...result
    });
  } catch (error) {
    console.error('Fout bij testmelding:', error);
    return res.status(500).json({
      error: 'Testmelding versturen is mislukt.'
    });
  }
}
