import { db, getTokensByPlayer, sendToTokens } from '../lib/padel.js';

// De app roept dit aan nadat er een chatbericht of systeembericht (afmelding, schemawijziging,
// baanboeking) is opgeslagen. De server leest dat bericht zelf uit de database en stuurt een
// pushmelding naar de anderen. Er gaat nooit meer dan 1 melding per bericht uit.
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Alleen POST.' });
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

    // Alleen berichten van de laatste 2 minuten (geen oude berichten opnieuw versturen)
    if (!m.timestamp || Date.now() - m.timestamp > 2 * 60 * 1000) {
      return res.status(200).json({ status: 'Bericht is te oud, geen melding verstuurd.' });
    }

    // Maximaal 1x per bericht
    const claim = await db.ref(`padelData/notified/${key}`).transaction(cur => (cur ? undefined : true));
    if (!claim.committed) {
      return res.status(200).json({ status: 'Voor dit bericht is al een melding verstuurd.' });
    }

    const isSystem = (m.type === 'system' || m.author === 'Systeem');

    let title;
    let text;
    if (isSystem) {
      title = '🔔 Padel update';
      text = String(m.text || 'Er is iets gewijzigd in de app.');
    } else {
      title = `💬 ${m.author || 'Padel chat'}`;
      if (m.text) {
        text = String(m.text);
      } else if (m.fileUrl) {
        text = (m.fileType && m.fileType.includes('image')) ? '📷 Foto' : '📎 Bestand';
      } else {
        text = 'Nieuw bericht';
      }
    }
    if (text.length > 120) text = text.slice(0, 117) + '...';

    const tokensData = await getTokensByPlayer();
    // Iedereen krijgt de melding, ook degene die het bericht of de wijziging zelf deed
    const recipients = Object.keys(tokensData);
    const tokens = recipients.flatMap(player => Object.keys(tokensData[player] || {}));

    if (tokens.length === 0) {
      console.log('NOTIFY: geen tokens gevonden', JSON.stringify({ key, spelersMetToken: Object.keys(tokensData) }));
      await db.ref(`padelData/notified/${key}`).remove();
      return res.status(200).json({ status: 'Geen tokens gevonden om te notificeren.' });
    }

    const result = await sendToTokens(tokens, { title, body: text });

    // Dit verschijnt in het Vercel-logboek (Logs, klik op de regel, onder "Messages")
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
    return res.status(500).json({ error: error.message });
  }
}
