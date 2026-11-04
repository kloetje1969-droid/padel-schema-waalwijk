import { db, getTokensByPlayer, sendToTokens } from '../lib/padel.js';

// De app roept dit aan nadat er een chatbericht of systeembericht is opgeslagen.
const BLOKKEER_ZONDER_LOGIN = true;
// Alleen ingelogde spelers (met de pincode via api/login) mogen een melding laten sturen.
const VEREIS_LIDMAATSCHAP = true;

async function controleerInlog(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { ok: false, reden: 'geen inlogbewijs meegestuurd' };
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(token);
    if (VEREIS_LIDMAATSCHAP && decoded.lid !== true) {
      return { ok: false, reden: 'geen spelerslid (pincode niet gebruikt)' };
    }
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
    
    const isPodium = isSystem && text.startsWith('🏆 Uitslag KingKong podium');
    const maxLengte = isPodium ? 400 : 120;
    if (text.length > maxLengte) text = text.slice(0, maxLengte - 3) + '...';

    const tokensData = await getTokensByPlayer();
    const recipients = Object.keys(tokensData);
    
    // We bouwen een lijst op en onthouden tegelijk bij welke speler welk token hoort
    const tokenList = [];
    const tokenToPlayerMap = {};

    recipients.forEach(player => {
      const playerTokens = tokensData[player] || {};
      Object.keys(playerTokens).forEach(token => {
        tokenList.push(token);
        tokenToPlayerMap[token] = player;
      });
    });

    if (tokenList.length === 0) {
      console.log('NOTIFY: geen tokens gevonden', JSON.stringify({ key, spelersMetToken: recipients }));
      await db.ref(`padelData/notified/${key}`).remove();
      return res.status(200).json({ status: 'Geen tokens gevonden om te notificeren.' });
    }

    // Verstuur de melding via de helperfunctie (of direct via admin.messaging als je de details wilt uitlezen)
    // Omdat sendToTokens waarschijnlijk een multicast afhandelt, sturen we hier de tokens in.
    const result = await sendToTokens(tokenList, { title, body: text, tag: key });

    // Controleer of er tokens mislukt zijn om deze te koppelen aan spelersnamen en op te schonen
    const mislukteSpelers = new Set();
    const tokensOmTeVerwijderen = {};

    if (result && result.responses) {
      result.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const failedToken = tokenList[idx];
          const spelerNaam = tokenToPlayerMap[failedToken];
          if (spelerNaam) {
            mislukteSpelers.add(spelerNaam);
            tokensOmTeVerwijderen[`padelData/tokens/${spelerNaam}/${failedToken}`] = null;
          }
        }
      });
    }

    // Ruim ongeldige tokens direct op in de database
    if (Object.keys(tokensOmTeVerwijderen).length > 0) {
      await db.ref().update(tokensOmTeVerwijderen);
    }

    // Als er 1 of meer bezorgingen zijn mislukt, stuur een gerichte push naar ALLEEN Robert
    if (mislukteSpelers.size > 0) {
      const namenLijst = Array.from(mislukteSpelers).join(', ');
      console.log(`Pushnotificatie niet aangekomen bij: ${namenLijst}`);

      const robertTokensObj = tokensData['Robert'] || {};
      const robertTokenList = Object.keys(robertTokensObj);

      if (robertTokenList.length > 0) {
        const { getMessaging } = await import('firebase-admin/messaging');
        await getMessaging().sendEachForMulticast({
          tokens: robertTokenList,
          notification: {
            title: "⚠️ Padel App - Push mislukt",
            body: `Niet bezorgd bij: ${namenLijst}`
          },
          data: {
            url: "https://padel-app-b8362.web.app"
          }
        });
      }
    }

    console.log('NOTIFY resultaat', JSON.stringify({
      soort: isSystem ? 'systeem' : 'chat',
      titel: title,
      naarSpelers: recipients,
      tokens: tokenList.length,
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
