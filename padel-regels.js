/*
 * padel-regels.js — DE ENIGE PLEK voor het speelschema, de telregels en het podium.
 * Wordt gebruikt door de app (index.html) én door de server (lib/padel.js en api/kingkong-winnaar.js).
 * Past u hier iets aan, dan geldt het automatisch overal. Verhoog daarna APP_VERSION in index.html.
 * Dit bestand mag geen DOM, Firebase of andere afhankelijkheden gebruiken (alleen gewone JavaScript).
 */
(function (root) {
  'use strict';

  const BASE_PLAYERS = ['Marcel', 'Mark', 'Ronald', 'Sander', 'Dennis', 'Robert'];

  // Standaardschema: 6 weken per cyclus, elke cyclus begint opnieuw bij week 1
  const DEFAULT_TEMPLATE = [
    { dinsdag: ['Sander', 'Dennis', 'Mark', 'Robert'], donderdag: ['Marcel', 'Ronald', 'Sander', 'Robert'] },
    { dinsdag: ['Marcel', 'Mark', 'Ronald', 'Robert'], donderdag: ['Mark', 'Sander', 'Ronald', 'Dennis'] },
    { dinsdag: ['Marcel', 'Robert', 'Mark', 'Dennis'], donderdag: ['Marcel', 'Ronald', 'Sander', 'Robert'] },
    { dinsdag: ['Marcel', 'Sander', 'Mark', 'Dennis'], donderdag: ['Mark', 'Ronald', 'Dennis', 'Robert'] },
    { dinsdag: ['Marcel', 'Dennis', 'Ronald', 'Sander'], donderdag: ['Marcel', 'Sander', 'Mark', 'Robert'] },
    { dinsdag: ['Dennis', 'Robert', 'Sander', 'Ronald'], donderdag: ['Marcel', 'Dennis', 'Mark', 'Ronald'] }
  ];

  // Het schema van week 1 zoals dat in cyclus 1 is gespeeld (daarna is het standaardschema gewijzigd)
  const SCHEMA_WEEK1_CYCLUS1 = {
    dinsdag: ['Mark', 'Robert', 'Ronald', 'Sander'],
    donderdag: ['Sander', 'Robert', 'Marcel', 'Dennis']
  };

  // Start van cyclus 1: maandag 21 september 2026 (de enige plek waar deze datum staat)
  const REF_START = { jaar: 2026, maand: 9, dag: 21 };
  const REF_MONDAY_UTC = Date.UTC(REF_START.jaar, REF_START.maand - 1, REF_START.dag);
  const DAG_MS = 86400000;
  const WEEK_MS = 7 * DAG_MS;
  const WEKEN_PER_CYCLUS = 6;
  const WACHTTIJD_MS = 30 * 60 * 1000; // podium komt 30 minuten na de laatste uitslag
  const VANGNET_MS = 3 * DAG_MS;       // vangnet: 3 dagen na afloop van de cyclus

  // Maandag (UTC, middernacht) van ISO-week `week` in `year`
  function isoWeekMondayUtc(year, week) {
    const jan4 = Date.UTC(year, 0, 4);
    const dag = (new Date(jan4).getUTCDay() + 6) % 7;
    return jan4 - dag * DAG_MS + (week - 1) * WEEK_MS;
  }

  // Weeksleutel ('2026_w45'), weeknummer, cyclus en template-index voor een kalenderdatum (jaar, maand 1-12, dag)
  function weekInfoVanDatum(y, m, d) {
    const dagMs = Date.UTC(y, m - 1, d);
    const dagNr = new Date(dagMs).getUTCDay() || 7; // zondag = 7
    const maandag = dagMs - (dagNr - 1) * DAG_MS;
    const isoYear = new Date(maandag + 3 * DAG_MS).getUTCFullYear();
    const week1Maandag = isoWeekMondayUtc(isoYear, 1);
    const weekNum = Math.round((maandag - week1Maandag) / WEEK_MS) + 1;
    const diffWeeks = Math.round((maandag - REF_MONDAY_UTC) / WEEK_MS);
    return {
      key: `${isoYear}_w${weekNum}`,
      weekNum,
      cyclus: Math.floor(diffWeeks / WEKEN_PER_CYCLUS),
      templateIndex: ((diffWeeks % WEKEN_PER_CYCLUS) + WEKEN_PER_CYCLUS) % WEKEN_PER_CYCLUS
    };
  }

  // '2026_w45_dinsdag' -> in welke cyclus en welke week van de cyclus die wedstrijd valt
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
      cyclus: Math.floor(diffWeeks / WEKEN_PER_CYCLUS),
      templateIndex: ((diffWeeks % WEKEN_PER_CYCLUS) + WEKEN_PER_CYCLUS) % WEKEN_PER_CYCLUS
    };
  }

  // Einde van een cyclus (middernacht na de laatste dag) in ms
  function cyclusEindeMs(cyclusIndex) {
    return REF_MONDAY_UTC + (cyclusIndex + 1) * WEKEN_PER_CYCLUS * WEEK_MS;
  }

  // Games en wedstrijden per vaste speler in een cyclus (KingKong-klassement):
  //  - Invallers (niet in BASE_PLAYERS) tellen nergens mee.
  //  - Wedstrijd en games tellen alleen mee als de vaste speler op zijn eigen originele plek stond.
  //  - Een invaller (iemand die niet in de standaardopstelling van die wedstrijd staat) telt helemaal niet mee.
  function berekenTellingen(matchResults, cyclusIndex) {
    const gameCounts = {};
    const matchCounts = {};
    BASE_PLAYERS.forEach(p => { gameCounts[p] = 0; matchCounts[p] = 0; });

    for (const matchId in (matchResults || {})) {
      const m = leesMatchId(matchId);
      if (!m || m.cyclus !== cyclusIndex) continue;

      const res = matchResults[matchId];
      if (!res || !Array.isArray(res.players) || res.players.length !== 4) continue;

      let tpl = DEFAULT_TEMPLATE[m.templateIndex];
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
        if (!p || !BASE_PLAYERS.includes(p)) return;
        if (!defaultSlotPlayers.includes(p)) return; // invaller: de wedstrijd telt helemaal niet mee
        matchCounts[p] = (matchCounts[p] || 0) + 1;
        gameCounts[p] = (gameCounts[p] || 0) + item.games;
      });
    }
    return { gameCounts, matchCounts };
  }

  // Zijn alle (niet afgelaste) wedstrijden van de cyclus ingevuld?
  // extraMatchId: een wedstrijd die net wordt opgeslagen en als ingevuld telt
  function isCyclusVolledigIngevuld(cyclusIndex, matchResults, overrides, extraMatchId) {
    let totaal = 0;
    let ingevuld = 0;
    for (let w = 0; w < WEKEN_PER_CYCLUS; w++) {
      const maandag = new Date(REF_MONDAY_UTC + (cyclusIndex * WEKEN_PER_CYCLUS + w) * WEEK_MS);
      const key = weekInfoVanDatum(maandag.getUTCFullYear(), maandag.getUTCMonth() + 1, maandag.getUTCDate()).key;
      const weekOverride = (overrides && overrides[key]) || {};
      ['dinsdag', 'donderdag'].forEach(slot => {
        const raw = weekOverride[slot];
        const afgelast = raw === null || (raw !== undefined && typeof raw === 'object' && raw.cancelled === true);
        if (afgelast) return;
        totaal++;
        const id = `${key}_${slot}`;
        if ((matchResults && matchResults[id]) || id === extraMatchId) ingevuld++;
      });
    }
    return totaal > 0 && ingevuld >= totaal;
  }

  function bouwPodiumRijen(eerste, tweede, derde, gamesVan, wedstrijdenVan) {
    const rij = (medaille, plaats, naam) => ({
      links: `${medaille} ${plaats}e plaats: ${naam}`,
      rechts: `(${gamesVan(naam)} games, ${wedstrijdenVan(naam)} Wedstr)`
    });
    return [
      ...eerste.map(n => rij('🥇', 1, n)),
      ...tweede.map(n => rij('🥈', 2, n)),
      ...derde.map(n => rij('🥉', 3, n))
    ];
  }

  function bouwPodiumRegels(eerste, tweede, derde, gamesVan, wedstrijdenVan) {
    return bouwPodiumRijen(eerste, tweede, derde, gamesVan, wedstrijdenVan).map(r => `${r.links} ${r.rechts}`);
  }

  // Podium (goud/zilver/brons, bij gelijke stand delen spelers de plaats). null = nog geen games gespeeld.
  function bouwPodium(gameCounts, matchCounts) {
    const uniqueScoresDesc = [...new Set(BASE_PLAYERS.map(p => gameCounts[p] || 0))].sort((a, b) => b - a);
    const maxGames = uniqueScoresDesc[0] || 0;
    if (maxGames === 0) return null;

    const spelersMet = score => (score !== undefined ? BASE_PLAYERS.filter(p => (gameCounts[p] || 0) === score) : []);
    const first = spelersMet(uniqueScoresDesc[0]);
    const second = spelersMet(uniqueScoresDesc[1]);
    const third = spelersMet(uniqueScoresDesc[2]);

    const gamesVan = naam => gameCounts[naam] || 0;
    const wedstrijdenVan = naam => (matchCounts && matchCounts[naam]) || 0;
    return {
      maxGames, first, second, third,
      winnerText: first.join(', '),
      rijen: bouwPodiumRijen(first, second, third, gamesVan, wedstrijdenVan),
      regels: bouwPodiumRegels(first, second, third, gamesVan, wedstrijdenVan)
    };
  }

  root.PadelRegels = Object.freeze({
    BASE_PLAYERS, DEFAULT_TEMPLATE, SCHEMA_WEEK1_CYCLUS1,
    REF_START, REF_MONDAY_UTC, WEEK_MS, WEKEN_PER_CYCLUS, WACHTTIJD_MS, VANGNET_MS,
    isoWeekMondayUtc, weekInfoVanDatum, leesMatchId, cyclusEindeMs,
    berekenTellingen, isCyclusVolledigIngevuld,
    bouwPodiumRijen, bouwPodiumRegels, bouwPodium
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
