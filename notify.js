import { db, getTokensByPlayer, sendToTokens } from '../lib/padel.js';

// De app roept dit aan nadat er een chatbericht of systeembericht is opgeslagen.
const BLOKKEER_ZONDER_LOGIN = true;

async function controleerInlog(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { ok: false, reden: 'geen inlogbewijs meegestuurd' };
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(token);
    return { ok: true, uid: decoded.uid };
  } catch (e) {
    return { ok: false, reden: e.code || e.message };
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Alleen POST.' });
    }

    const inlog = await controleerInlog(req);
    if (inlog.ok) {
      console.log('NOTIFY login: ok');
    } else {
      console.warn('NOTIFY login: NIET geldig -', inlog.reden);
      if (BLOKKEER_ZONDER_LOGIN) {
        return res.status(401).json({ error: 'Niet ingelogd.' });
      }
    }

    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const { key } = body;

    if (!key || typeof key !== 'string' || /[.#$\[\]\/]/.test(key)) {
      return res.status(400).json({ error: 'Ongeldige sleutel.' });
    }

    const snap = await db.ref(`padelData/messages/${key}`).once('value');
    const m = snap.val();
    if (!m) {
      return res.status(404).json({ error: 'Bericht niet gevonden.' });
    }

    // Alleen berichten van de laatste 45 seconden mogen een melding geven
    if (!m.timestamp || Date.now() - m.timestamp > 45 * 1000) {
      return res.status(200).json({ status: 'Bericht is te oud of al verwerkt, geen melding verstuurd.' });
    }

    // Maximaal 1x per bericht via Firebase transactie
    const claim = await db.ref(`padelData/notified/${key}`).transaction(cur => (cur ? undefined : true));
    if (!claim.committed) {
      return res.status(200).json({ status: 'Voor dit bericht is al een melding verstuurd.' });
    }

    const isSystem = (m.type === 'system' || m.author === 'Systeem');

    let title;
    let text;
    
    if (isSystem) {
      // Zuivere systeemmelding of uitslag ZONDER weertekst
      title = '🔔 Padel update';
      text = String(m.text || 'Er is iets gewijzigd in de app.');
    } else {
      // Normaal chatbericht
      title = `💬 ${m.author || 'Padel chat'}`;
      if (m.text) {
        text = String(m.text);
      } else if (m.fileUrl) {
        text = (m.fileType && m.fileType.includes('image')) ? '📷 Foto' : '📎 Bestand';
      } else {
        text = 'Nieuw bericht';
      }
    }
    
    // Gewone meldingen worden afgekapt; het KingKong-podium krijgt meer ruimte zodat alle plaatsen te lezen zijn
    const isPodium = isSystem && text.startsWith('🏆 Uitslag KingKong podium');
    const maxLengte = isPodium ? 400 : 120;
    if (text.length > maxLengte) text = text.slice(0, maxLengte - 3) + '...';

    const tokensData = await getTokensByPlayer();
    const recipients = Object.keys(tokensData);
    const tokens = recipients.flatMap(player => Object.keys(tokensData[player] || {}));

    if (tokens.length === 0) {
      console.log('NOTIFY: geen tokens gevonden', JSON.stringify({ key, spelersMetToken: Object.keys(tokensData) }));
      await db.ref(`padelData/notified/${key}`).remove();
      return res.status(200).json({ status: 'Geen tokens gevonden om te notificeren.' });
    }

    const result = await sendToTokens(tokens, { title, body: text, tag: key });

    console.log('NOTIFY resultaat', JSON.stringify({
      soort: isSystem ? 'systeem' : 'chat',
      titel: title,
      naarSpelers: recipients,
      tokens: tokens.length,
      gelukt: result.successCount,
      mislukt: result.failureCount,
      foutcodes: result.errorCodes
    }));

    return res.status(200).json({ success: result.successCount > 0, ...result });
  } catch (error) {
    console.error('Fout bij versturen berichtmelding:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij het versturen van de melding.' });
  }
}
