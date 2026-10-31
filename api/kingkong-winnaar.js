import admin from 'firebase-admin';
import {
  db,
  defaultTemplate,
  getWeekInfo,
  isCronAuthorized,
  getTokensByPlayer,
  sendToTokens
} from '../lib/padel.js';

// Maakt het KingKong-podium bekend, ook als niemand de app open heeft.
// Dezelfde regels als in de app:
//  - alle (niet afgelaste) wedstrijden van de cyclus zijn ingevuld
//  - 30 minuten na de laatste uitslag komt het podium in de chat, met een pushmelding
//  - vangnet: is een cyclus 3 dagen na afloop nog niet volledig, dan wordt hij toch bekendgemaakt
// Wie het eerst is (de app of deze server) doet de bekendmaking; er komt nooit een dubbel bericht.

const BASE_PLAYERS = ['Marcel', 'Mark', 'Ronald', 'Sander', 'Dennis', 'Robert'];
const REF_MONDAY_UTC = Date.UTC(2026, 8, 21); // maandag 21 september 2026
const WEEK_MS = 7 * 86400000;
const WACHTTIJD_MS = 30 * 60 * 1000;
const VANGNET_MS = 3 * 86400000;
const MAX_PUSH_TEKENS = 400;

// Het schema van week 1 zoals dat in cyclus 1 is gespeeld (daarna is het standaardschema gewijzigd)
const SCHEMA_WEEK1_CYCLUS1 = {
  dinsdag: ['Mark', 'Robert', 'Ronald', 'Sander'],
  donderdag: ['Sander', 'Robert', 'Marcel', 'Dennis']
};

function isoWeekMondayUtc(year, week) {
  const jan4 = Date.UTC(year, 0, 4);
  const dag = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - dag * 86400000 + (week - 1) * WEEK_MS;
}

// '2026_w39_dinsdag' -> in welke cyclus en welke week van de cyclus die wedstrijd valt
function leesMatchId(matchId) {
  const parts = String(matchId).split('_');
  if (parts.length < 3) return null;
  const year = parseInt(parts[0], 10);
  const week = parseInt(parts[1].replace('w', ''), 10);
  const slot = parts[2];
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;

  const maandag = isoWeekMondayUtc(year, week);
  const diffWeeks = Math.round((maandag - REF_MONDAY_UTC) / WEEK_MS);
  return {
    slot,
    diffWeeks,
    cyclus: Math.floor(diffWeeks / 6),
    templateIndex: ((diffWeeks % 6) + 6) % 6
  };
}

// Games en wedstrijden per vaste speler in een cyclus (zelfde telling als het KingKong-klassement)
function berekenTellingen(matchResults, cyclusIndex) {
  const gameCounts = {};
  const matchCounts = {};
  BASE_PLAYERS.forEach(p => {
    gameCounts[p] = 0;
    matchCounts[p] = 0;
  });

  for (const matchId in matchResults) {
    const m = leesMatchId(matchId);
    if (!m || m.cyclus !== cyclusIndex) continue;

    const res = matchResults[matchId];
    if (!res || !Array.isArray(res.players) || res.players.length !== 4) continue;

    let tpl = defaultTemplate[m.templateIndex];
    if (cyclusIndex === 0 && m.templateIndex === 0) tpl = SCHEMA_WEEK1_CYCLUS1;
    const defaultSlotPlayers = (tpl && tpl[m.slot]) || [];

    const t1Games = (Number(res.t1s1) || 0) + (Number(res.t1s2) || 0) + (Number(res.t1s3) || 0);
    const t2Games = (Number(res.t2s1) || 0) + (Number(res.t2s2) || 0) + (Number(res.t2s3) || 0);

    const scores = [
      { player: res.players[0], games: t1Games },
      { player: res.players[1], games: t1Games },
      { player: res.players[2], games: t2Games },
      { player: res.players[3], games: t2Games }
    ];

    scores.forEach(item => {
      const p = item.player;
      if (!p) return;
      if (defaultSlotPlayers.includes(p) && BASE_PLAYERS.includes(p)) {
        gameCounts[p] = (gameCounts[p] || 0) + item.games;
        matchCounts[p] = (matchCounts[p] || 0) + 1;
      }
    });
  }

  return { gameCounts, matchCounts };
}

// Zijn alle wedstrijden van de cyclus ingevuld? Afgelaste wedstrijden tellen niet mee.
function isCyclusVolledigIngevuld(cyclusIndex, matchResults, overrides) {
  let totaal = 0;
  let ingevuld = 0;

  for (let w = 0; w < 6; w++) {
    const maandag = new Date(REF_MONDAY_UTC + (cyclusIndex * 6 + w) * WEEK_MS);
    const info = getWeekInfo(maandag.getUTCFullYear(), maandag.getUTCMonth() + 1, maandag.getUTCDate());
    const weekOverride = overrides[info.key] || {};

    ['dinsdag', 'donderdag'].forEach(slot => {
      const raw = weekOverride[slot];
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.cancelled === true) return;
      totaal++;
      if (matchResults[`${info.key}_${slot}`]) ingevuld++;
    });
  }

  return totaal > 0 && ingevuld >= totaal;
}

function bouwPodiumRegels(eerste, tweede, derde, gamesVan, wedstrijdenVan) {
  const regel = (medaille, plaats, naam) =>
    `${medaille} ${plaats}e plaats: ${naam} (${gamesVan(naam)} games, ${wedstrijdenVan(naam)} Wedstr)`;
  return [
    ...eerste.map(n => regel('🥇', 1, n)),
    ...tweede.map(n => regel('🥈', 2, n)),
    ...derde.map(n => regel('🥉', 3, n))
  ];
}

function bouwPodium(gameCounts, matchCounts) {
  const uniqueScoresDesc = [...new Set(BASE_PLAYERS.map(p => gameCounts[p] || 0))].sort((a, b) => b - a);
  const maxGames = uniqueScoresDesc[0] || 0;
  if (maxGames === 0) return null;

  const goudScore = uniqueScoresDesc[0] !== undefined ? uniqueScoresDesc[0] : null;
  const zilverScore = uniqueScoresDesc[1] !== undefined ? uniqueScoresDesc[1] : null;
  const bronsScore = uniqueScoresDesc[2] !== undefined ? uniqueScoresDesc[2] : null;

  const first = goudScore !== null ? BASE_PLAYERS.filter(p => (gameCounts[p] || 0) === goudScore) : [];
  const second = zilverScore !== null ? BASE_PLAYERS.filter(p => (gameCounts[p] || 0) === zilverScore) : [];
  const third = bronsScore !== null ? BASE_PLAYERS.filter(p => (gameCounts[p] || 0) === bronsScore) : [];

  const regels = bouwPodiumRegels(
    first,
    second,
    third,
    naam => gameCounts[naam] || 0,
    naam => matchCounts[naam] || 0
  );

  return { maxGames, first, second, third, winnerText: first.join(', '), regels };
}

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
      const cyclusEinde = REF_MONDAY_UTC + (cyclusIdx + 1) * 6 * WEEK_MS;
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
            title: '🎾 Padel update',
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
