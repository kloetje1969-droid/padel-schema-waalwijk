import { db, isCronAuthorized, amsterdamNow } from './padel.js';

export default async function handler(req, res) {
  try {
    // 1. Beveiligingscontrole via de cron-secret
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: 'Niet geautoriseerd' });
    }

    const nl = amsterdamNow();

    // 2. Bepaal de actieve cyclus
    const referenceMonday = new Date(Date.UTC(2026, 8, 21));
    const currentMonday = new Date(Date.UTC(nl.year, nl.month - 1, nl.day));
    const diffWeeks = Math.round((currentMonday.getTime() - referenceMonday.getTime()) / (7 * 86400000));
    const activeCyclusIndex = Math.max(0, Math.floor(diffWeeks / 6));

    // 3. Haal gegevens op uit Firebase
    const snap = await db.ref('padelData').once('value');
    const data = snap.val() || {};
    const matchResults = data.matchResults || {};
    const basePlayers = ["Marcel", "Mark", "Ronald", "Sander", "Dennis", "Robert"];

    // 4. Bereken de games per speler voor deze cyclus
    const gameCounts = {};
    basePlayers.forEach(p => gameCounts[p] = 0);

    for (const matchId in matchResults) {
      const parts = matchId.split('_');
      if (parts.length < 3) continue;
      const year = parseInt(parts[0], 10);
      const week = parseInt(parts[1].replace('w', ''), 10);
      if (!Number.isFinite(year) || !Number.isFinite(week)) continue;

      let d = new Date(Date.UTC(year, 0, 4));
      let dagVanWeek = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dagVanWeek + (week - 1) * 7);
      const matchWeekStart = d.getTime();

      const matchDiffWeeks = Math.round((matchWeekStart - referenceMonday.getTime()) / (7 * 86400000));
      const matchCyclus = Math.floor(matchDiffWeeks / 6);
      if (matchCyclus !== activeCyclusIndex) continue;

      const resData = matchResults[matchId];
      if (!resData || !Array.isArray(resData.players) || resData.players.length !== 4) continue;

      const t1Games = (Number(resData.t1s1) || 0) + (Number(resData.t1s2) || 0) + (Number(resData.t1s3) || 0);
      const t2Games = (Number(resData.t2s1) || 0) + (Number(resData.t2s2) || 0) + (Number(resData.t2s3) || 0);

      const matchPlayerScores = [
        { player: resData.players[0], games: t1Games },
        { player: resData.players[1], games: t1Games },
        { player: resData.players[2], games: t2Games },
        { player: resData.players[3], games: t2Games }
      ];

      matchPlayerScores.forEach(item => {
        if (item.player && basePlayers.includes(item.player)) {
          gameCounts[item.player] = (gameCounts[item.player] || 0) + item.games;
        }
      });
    }

    // 5. Bepaal de winnaar
    const uniqueScoresDesc = [...new Set(basePlayers.map(p => gameCounts[p] || 0))].sort((a, b) => b - a);
    const maxGames = uniqueScoresDesc[0] || 0;
    const firstPlayers = maxGames > 0 ? basePlayers.filter(p => (gameCounts[p] || 0) === maxGames) : [];
    const winnerText = firstPlayers.join(', ') || "Nog geen winnaar";

    // 6. Sla op in Firebase
    await db.ref(`padelData/cyclusWinnaars/${activeCyclusIndex}`).update({
      winner: winnerText,
      games: maxGames,
      scores: gameCounts,
      timestamp: Date.now(),
      bekendgemaaktDoorServer: true
    });

    return res.status(200).json({ 
      success: true, 
      message: `KingKong winnaar voor cyclus ${activeCyclusIndex + 1} (${winnerText}) succesvol vastgelegd!` 
    });

  } catch (error) {
    console.error('Fout in kingkong-winnaar script:', error);
    return res.status(500).json({ error: error.message });
  }
}
