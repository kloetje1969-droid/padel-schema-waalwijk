import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { db } from '../lib/padel.js';

// De app stuurt hier de pincode naartoe. Klopt die, dan krijgt de app een Firebase-inlogbewijs
// met de rechten "lid" (en bij de Robert-code ook "robert"). De Firebase-regels letten daarop.
// De pincodes staan alleen in Vercel: APP_PIN en ROBERT_PIN.

const MAX_MISLUKT = 5;                 // aantal foute pogingen per apparaat/netwerk
const VENSTER_MS = 15 * 60 * 1000;     // ... binnen 15 minuten, daarna weer vrij

function hash(s) {
  return createHash('sha256').update(String(s)).digest();
}

function gelijk(a, b) {
  return timingSafeEqual(hash(a), hash(b));
}

function clientSleutel(req) {
  const h = req.headers || {};
  const ip = String(h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || 'onbekend')
    .split(',')[0].trim();
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Alleen POST.' });
    }

    const APP_PIN = process.env.APP_PIN;
    const ROBERT_PIN = process.env.ROBERT_PIN;
    if (!APP_PIN || !ROBERT_PIN) {
      console.error('LOGIN: APP_PIN of ROBERT_PIN ontbreekt in Vercel.');
      return res.status(500).json({ error: 'Server niet ingesteld.' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
    const wilRobert = body.robert === true;
    const deviceId = (typeof body.deviceId === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(body.deviceId))
      ? body.deviceId : null;

    if (pin.length < 1 || pin.length > 64) {
      return res.status(400).json({ error: 'Ongeldige invoer.' });
    }

    // Rem op raden: maximaal 5 foute pogingen per 15 minuten per apparaat/netwerk
    const ref = db.ref(`loginAttempts/${clientSleutel(req)}`);
    const nu = Date.now();
    const info = (await ref.once('value')).val();
    if (info && info.count >= MAX_MISLUKT && nu - info.since < VENSTER_MS) {
      const minuten = Math.ceil((VENSTER_MS - (nu - info.since)) / 60000);
      return res.status(429).json({ error: 'Te veel pogingen.', minuten });
    }

    // Beide codes altijd vergelijken, zodat de duur niets verraadt
    const appOk = gelijk(pin, APP_PIN);
    const robertOk = gelijk(pin, ROBERT_PIN);
    const geldig = wilRobert ? robertOk : appOk;

    if (!geldig) {
      await ref.transaction((cur) => {
        if (!cur || nu - cur.since >= VENSTER_MS) return { count: 1, since: nu };
        return { count: cur.count + 1, since: cur.since };
      });
      console.warn('LOGIN: onjuiste pincode', wilRobert ? '(robert)' : '(app)');
      return res.status(401).json({ error: 'Onjuiste pincode.' });
    }

    if (info) await ref.remove();

    const uid = deviceId ? `d_${deviceId}` : `speler_${randomUUID()}`;
    const claims = wilRobert ? { lid: true, robert: true } : { lid: true };
    const token = await getAuth().createCustomToken(uid, claims);
    console.log('LOGIN: ok', wilRobert ? '(robert)' : '(app)');
    return res.status(200).json({ token, robert: wilRobert });
  } catch (e) {
    console.error('LOGIN fout:', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'Inloggen mislukt.' });
  }
}
