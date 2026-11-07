import { db, TZ, isCronAuthorized, getTokensByPlayer, tokensOf, sendToTokens } from '../lib/padel.js';

// Cron-job 6 (elke 5 minuten): meldt alleen aan Robert wie er online is geweest, hoe laat
// hij inlogde en hoe lang. De app schrijft per verbinding een record in onlineSessies
// ({ naam, sinds, laatst }, servertijd). Bezoeken die binnen 10 minuten op elkaar volgen
// tellen als één bezoek. Een bezoek wordt gemeld als er 10 minuten niets meer van kwam;
// daarna worden de records gewist. Staat de push voor de groep uit, dan wordt er niets
// verstuurd en ruimen we de afgeronde bezoeken stil op.

const STIL_MS = 10 * 60 * 1000;          // zo lang niets meer gehoord = bezoek afgelopen
const SAMEN_MS = 10 * 60 * 1000;         // terug binnen 10 minuten = hetzelfde bezoek
const SPELERS = ['Marcel', 'Mark', 'Ronald', 'Sander', 'Dennis'];

function tijd(ms) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

function dag(ms) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));
}

function duur(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} ${min === 1 ? 'minuut' : 'minuten'}`;
  const uur = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${uur} uur en ${rest} min` : `${uur} uur`;
}

// Records per speler samenvoegen tot bezoeken (los te testen: geen database nodig)
export function groepeerBezoeken(records) {
  const perSpeler = {};
  for (const r of records) (perSpeler[r.naam] = perSpeler[r.naam] || []).push(r);
  const bezoeken = [];
  for (const naam of Object.keys(perSpeler)) {
    const lijst = perSpeler[naam].sort((a, b) => a.sinds - b.sinds);
    let huidig = null;
    for (const r of lijst) {
      if (huidig && r.sinds <= huidig.laatst + SAMEN_MS) {
        huidig.laatst = Math.max(huidig.laatst, r.laatst);
        huidig.sleutels.push(r.sleutel);
      } else {
        huidig = { naam, sinds: r.sinds, laatst: r.laatst, sleutels: [r.sleutel] };
        bezoeken.push(huidig);
      }
    }
  }
  return bezoeken;
}

export function meldingTekst(bezoek, nu) {
  const vandaag = dag(nu) === dag(bezoek.sinds);
  const begin = vandaag ? tijd(bezoek.sinds) : `${dag(bezoek.sinds)} ${tijd(bezoek.sinds)}`;
  return {
    title: `👀 ${bezoek.naam} was online`,
    body: `Ingelogd om ${begin}, ${duur(bezoek.laatst - bezoek.sinds)} online (tot ${tijd(bezoek.laatst)})`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Methode niet toegestaan.' });
  }
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Niet geautoriseerd.' });
  }

  try {
    const nu = Date.now();
    const [sessieSnap, pushSnap] = await Promise.all([
      db.ref('onlineSessies').once('value'),
      db.ref('padelData/settings/pushGloballyEnabled').once('value')
    ]);
    const pushUit = pushSnap.val() === false;
    const ruwe = sessieSnap.val() || {};

    const wissen = {};
    const records = [];
    for (const [sleutel, r] of Object.entries(ruwe)) {
      const geldig = r && SPELERS.includes(r.naam) && typeof r.sinds === 'number' && typeof r.laatst === 'number';
      if (!geldig) { wissen[sleutel] = null; continue; } // onvolledig of van Robert: opruimen
      records.push({ sleutel, naam: r.naam, sinds: r.sinds, laatst: Math.max(r.sinds, r.laatst) });
    }

    const afgelopen = groepeerBezoeken(records).filter(b => nu - b.laatst >= STIL_MS);
    afgelopen.forEach(b => b.sleutels.forEach(k => { wissen[k] = null; }));

    // Eerst wissen, dan versturen: zo komt een bezoek nooit twee keer
    if (Object.keys(wissen).length) await db.ref('onlineSessies').update(wissen);

    if (pushUit || afgelopen.length === 0) {
      return res.status(200).json({ verstuurd: 0, opgeruimd: Object.keys(wissen).length, pushUit });
    }

    const tokens = tokensOf(await getTokensByPlayer(), ['Robert']);
    if (tokens.length === 0) {
      return res.status(200).json({ verstuurd: 0, status: 'Geen toestel van Robert gekoppeld.' });
    }

    let verstuurd = 0;
    for (const b of afgelopen) {
      const { title, body } = meldingTekst(b, nu);
      const r = await sendToTokens(tokens, { title, body, tag: `online-${b.naam}-${b.sinds}` });
      verstuurd += r.successCount > 0 ? 1 : 0;
    }
    console.log('ONLINE-MELDING', JSON.stringify({ bezoeken: afgelopen.length, verstuurd }));
    return res.status(200).json({ verstuurd, bezoeken: afgelopen.length });
  } catch (error) {
    console.error('Fout bij online-melding:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij de online-melding.' });
  }
}
