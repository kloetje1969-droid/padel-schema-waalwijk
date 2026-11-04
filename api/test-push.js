import { db, getTokensByPlayer, tokensOf, sendToTokens } from '../lib/padel.js';

// Testmelding alleen voor Robert: de melding gaat naar de eigen toestellen van Robert, nooit naar de groep.
// Werkt ook als de push voor de groep is uitgezet.

async function controleerRobert(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { status: 401, reden: 'geen inlogbewijs meegestuurd' };
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(token);
    if (decoded.robert !== true) return { status: 403, reden: 'alleen Robert' };
    return { status: 200 };
  } catch (e) {
    return { status: 401, reden: e.code || e.message };
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Alleen POST.' });
    }

    const inlog = await controleerRobert(req);
    if (inlog.status !== 200) {
      console.warn('TEST-PUSH geweigerd:', inlog.reden);
      return res.status(inlog.status).json({ error: inlog.status === 403 ? 'Alleen voor Robert.' : 'Niet ingelogd.' });
    }

    // Maximaal 1 testmelding per 5 seconden
    const nu = Date.now();
    const rem = await db.ref('testPush/last').transaction(cur => ((cur && nu - cur < 5000) ? undefined : nu));
    if (!rem.committed) {
      return res.status(429).json({ error: 'Even wachten met de volgende testmelding.' });
    }

    const tokensData = await getTokensByPlayer();
    const tokens = tokensOf(tokensData, ['Robert']);
    if (tokens.length === 0) {
      return res.status(200).json({ successCount: 0, failureCount: 0, status: 'Er is geen toestel van Robert gekoppeld. Zet de meldingen aan op je telefoon.' });
    }

    const result = await sendToTokens(tokens, {
      title: '🔔 Testmelding',
      body: 'Dit is een test. Alleen jouw eigen toestellen krijgen dit bericht.',
      tag: 'test-push'
    });
    console.log('TEST-PUSH', JSON.stringify({ tokens: tokens.length, gelukt: result.successCount, mislukt: result.failureCount }));
    return res.status(200).json(result);
  } catch (error) {
    console.error('Fout bij testmelding:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij het versturen van de testmelding.' });
  }
}
