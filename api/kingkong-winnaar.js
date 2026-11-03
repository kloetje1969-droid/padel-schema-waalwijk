import admin from 'firebase-admin';
import {
  db,
  isCronAuthorized,
  getTokensByPlayer,
  sendToTokens
} from '../lib/padel.js';
import '../padel-regels.js'; // telregels en podium: één gedeeld bestand voor app én server

// Maakt het KingKong-podium bekend, ook als niemand de app open heeft.
// Dezelfde regels als in de app:
//  - alle (niet afgelaste) wedstrijden van de cyclus zijn ingevuld
//  - 30 minuten na de laatste uitslag komt het podium in de chat, met een pushmelding
//  - vangnet: is een cyclus 3 dagen na afloop nog niet volledig, dan wordt hij toch bekendgemaakt
// Wie het eerst is (de app of deze server) doet de bekendmaking; er komt nooit een dubbel bericht.

const R = globalThis.PadelRegels;
const { WACHTTIJD_MS, VANGNET_MS, leesMatchId, berekenTellingen, isCyclusVolledigIngevuld, bouwPodium, cyclusEindeMs } = R;
const MAX_PUSH_TEKENS = 400;

function amsterdamTijd(nowMs) {
  return new Date(nowMs).toLocaleTimeString('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function verwerkCycli(nowMs) {
  const [resultsSnap, overridesSnap, winnersSnap] = await Promise.all([
    db.ref('padelData/matchResults').once('value'),
    db.ref('padelData/scheduleOverrides').once('value'),
    db.ref('padelData/cyclusWinnaars').once('value')
  ]);
  const matchResults = resultsSnap.val() || {};
  const overrides = overridesSnap.val() || {};
  const winnaars = winnersSnap.val() || {};

  // Alleen cycli waar al uitslagen van zijn
  const cycli = new Set();
  for (const matchId in matchResults) {
    const m = leesMatchId(matchId);
    if (m && m.cyclus >= 0) cycli.add(m.cyclus);
  }

  const uitkomst = [];

  for (const cyclusIdx of [...cycli].sort((a, b) => a - b)) {
    const status = { cyclus: cyclusIdx + 1 };
    const bestaand = winnaars[cyclusIdx];

    if (bestaand && bestaand.winner) {
      status.status = 'Al bekendgemaakt.';
      uitkomst.push(status);
      continue;
    }

    const cyclusRef = db.ref(`padelData/cyclusWinnaars/${cyclusIdx}`);
    const heeftWachttijd = !!(bestaand && bestaand.claimAt);
    let tijdVoorbij = heeftWachttijd && nowMs >= bestaand.claimAt;

    // Alles is ingevuld maar de wachttijd van 30 minuten is nog niet gestart: start hem nu
    if (!tijdVoorbij && !heeftWachttijd && isCyclusVolledigIngevuld(cyclusIdx, matchResults, overrides)) {
      await cyclusRef.update({ claimAt: nowMs + WACHTTIJD_MS, lastMatchSavedAt: nowMs });
      status.status = 'Alle wedstrijden ingevuld: wachttijd van 30 minuten gestart.';
      uitkomst.push(status);
      continue;
    }

    // Vangnet: cyclus is ruim 3 dagen afgelopen maar nooit volledig ingevuld
    if (!tijdVoorbij) {
      const cyclusEinde = cyclusEindeMs(cyclusIdx);
      if (nowMs > cyclusEinde + VANGNET_MS) tijdVoorbij = true;
    }

    if (!tijdVoorbij) {
      status.status = heeftWachttijd ? 'Wacht op het einde van de wachttijd.' : 'Cyclus is nog niet volledig ingevuld.';
      uitkomst.push(status);
      continue;
    }

    const { gameCounts, matchCounts } = berekenTellingen(matchResults, cyclusIdx);
    const podium = bouwPodium(gameCounts, matchCounts);
    if (!podium) {
      status.status = 'Nog geen games gespeeld, niets bekendgemaakt.';
      uitkomst.push(status);
      continue;
    }

    // Vastleggen: lukt dit niet, dan was de app (of een eerdere run) ons voor
    const tx = await cyclusRef.transaction(current => {
      if (current && current.winner) return;
      return {
        winner: podium.winnerText,
        games: podium.maxGames,
        podium: { first: podium.first, second: podium.second, third: podium.third },
        scores: gameCounts,
        matches: matchCounts,
        timestamp: nowMs,
        bekendgemaaktDoorServer: true
      };
    });

    if (!tx.committed) {
      status.status = 'Al bekendgemaakt (door de app).';
      uitkomst.push(status);
      continue;
    }

    const tekst = `🏆 Uitslag KingKong podium Cyclus ${cyclusIdx + 1}\n${podium.regels.join('\n')}`;
    status.status = 'Podium bekendgemaakt.';
    status.winnaar = podium.winnerText;

    // Chatbericht
    let berichtKey = null;
    try {
      const msgRef = db.ref('padelData/messages').push();
      await msgRef.set({
        author: 'Systeem',
        text: tekst,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        tijd: amsterdamTijd(nowMs),
        type: 'system'
      });
      berichtKey = msgRef.key;
      status.chatbericht = true;
    } catch (err) {
      console.error('KINGKONG: chatbericht plaatsen mislukt', err);
      status.chatbericht = false;
    }

    // Pushmelding (niet als Robert de pushmeldingen heeft uitgezet)
    try {
      const pushSnap = await db.ref('padelData/settings/pushGloballyEnabled').once('value');
      if (pushSnap.val() === false) {
        status.push = 'Push staat uit, geen melding verstuurd.';
      } else {
        const tokensData = await getTokensByPlayer();
        const tokens = Object.keys(tokensData).flatMap(speler => Object.keys(tokensData[speler] || {}));
        if (tokens.length === 0) {
          status.push = 'Geen tokens gevonden.';
        } else {
          const body = tekst.length > MAX_PUSH_TEKENS ? tekst.slice(0, MAX_PUSH_TEKENS - 3) + '...' : tekst;
          const result = await sendToTokens(tokens, {
            title: '🔔 Padel update',
            body,
            tag: berichtKey || `kingkong-${cyclusIdx}`
          });
          status.push = { gelukt: result.successCount, mislukt: result.failureCount };
        }
      }
    } catch (err) {
      console.error('KINGKONG: pushmelding mislukt', err);
      status.push = 'Pushmelding mislukt.';
    }

    uitkomst.push(status);
  }

  return { cycli: uitkomst };
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
    const resultaat = await verwerkCycli(Date.now());
    return res.status(200).json(resultaat);
  } catch (error) {
    console.error('Fout bij KingKong-bekendmaking:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij het controleren van de KingKong-uitslag.' });
  }
}
