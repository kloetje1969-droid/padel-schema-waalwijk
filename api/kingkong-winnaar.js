import { db, isCronAuthorized, amsterdamNow } from './padel.js';

export default async function handler(req, res) {
  // 1. Controleer of de wekker (cron-job.org) wel bevoegd is
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }

  try {
    const nl = amsterdamNow();

    // 2. Bepaal de actieve cyclus op basis van de huidige datum
    const referenceMonday = new Date(Date.UTC(2026, 8, 21));
    const currentMonday = new Date(Date.UTC(nl.year, nl.month - 1, nl.day));
    // Eenvoudige weekberekening t.o.v. de referentiedatum
    const diffWeeks = Math.round((currentMonday.getTime() - referenceMonday.getTime()) / (7 * 86400000));
    const activeCyclusIndex = Math.max(0, Math.floor(diffWeeks / 6));

    // 3. Haal matchresultaten en cyclusgegevens op uit Firebase
    const snap = await db.ref('padelData').once('value');
    const data = snap.val() || {};
    const matchResults = data.matchResults || {};
    const basePlayers = ["Marcel", "Mark", "Ronald", "Sander", "Dennis", "Robert"];

    // 4. Bereken de games per speler voor deze cyclus (exact zoals in je frontend app)
    const gameCounts = {};
    basePlayers.forEach(p => gameCounts[p] = 0);

    for (const matchId in matchResults) {
      const parts = matchId.split('_');
      if (parts.length < 3) continue;
      const year = parseInt(parts[0], 10);
      const week = parseInt(parts[1].replace('w', ''), 10);
      if (!Number.isFinite(year) || !Number.isFinite(week)) continue;

      // Bereken de maandag van deze specifieke matchweek
      let d = new Date(Date.UTC(year, 0, 4));
      let dagVanWeek = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dagVanWeek + (week - 1) * 7);
      const matchWeekStart = d.getTime();

      const matchDiffWeeks = Math.round((matchWeekStart - referenceMonday.getTime()) / (7 * 86400000));
      const matchCyclus = Math.floor(matchDiffWeeks / 6);
      if (matchCyclus !== activeCyclusIndex) continue;

      const res = matchResults[matchId];
      if (!res || !Array.isArray(res.players) || res.players.length !== 4) continue;

      const t1Games = (Number(res.t1s1) || 0) + (Number(res.t1s2) || 0) + (Number(res.t1s3) || 0);
      const t2Games = (Number(res.t2s1) || 0) + (Number(res.t2s2) || 0) + (Number(res.t2s3) || 0);

      const matchPlayerScores = [
        { player: res.players[0], games: t1Games },
        { player: res.players[1], games: t1Games },
        { player: res.players[2], games: t2Games },
        { player: res.players[3], games: t2Games }
      ];

      matchPlayerScores.forEach(item => {
        if (item.player && basePlayers.includes(item.player)) {
          gameCounts[item.player] = (gameCounts[item.player] || 0) + item.games;
        }
      });
    }

    // 5. Zoek de winnaar(s) met de meeste games
    const uniqueScoresDesc = [...new Set(basePlayers.map(p => gameCounts[p] || 0))].sort((a, b) => b - a);
    const maxGames = uniqueScoresDesc[0] || 0;
    const firstPlayers = maxGames > 0 ? basePlayers.filter(p => (gameCounts[p] || 0) === maxGames) : [];
    const winnerText = firstPlayers.join(', ') || "Nog geen winnaar";

    // 6. Sla de officiële uitslag op in Firebase onder cyclusWinnaars
    await db.ref(`padelData/cyclusWinnaars/${activeCyclusIndex}`).update({
      winner: winnerText,
      games: maxGames,
      scores: gameCounts,
      timestamp: Date.now(),
      bekendgemaaktDoorServer: true
    });

    return res.status(200).json({ 
      success: true, 
      message: `KingKong winnaar voor cyclus ${activeCyclusIndex + 1} (${winnerText}) succesvol vastgelegd om ${nl.dateKey}!` 
    });

  } catch (error) {
    console.error('Fout bij automatisch berekenen King Kong winnaar:', error);
    return res.status(500).json({ error: error.message });
  }
}
