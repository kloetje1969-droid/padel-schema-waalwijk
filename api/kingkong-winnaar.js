import admin from 'firebase-admin';

// Vangnet om te zorgen dat Firebase Admin niet dubbel wordt gestart
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
      }),
      databaseURL: "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app"
    });
  } catch (e) {
    console.error('Firebase Admin init error:', e);
  }
}

const db = admin.database();

export default async function handler(req, res) {
  try {
    // 1. Beveiligingscontrole via de cron-secret
    const secret = req.headers['x-cron-secret'] || req.query.secret;
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Niet geautoriseerd' });
    }

    // 2. Bepaal de *zojuist afgeronde* cyclus
    // We trekken een aantal dagen af of kijken naar de vorige cyclusindex, 
    // zodat het script pas triggert voor een cyclus die helemaal voorbij is.
    const now = new Date();
    const referenceMonday = new Date(Date.UTC(2026, 8, 21)); // 21 sep 2026
    const currentMonday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const diffWeeks = Math.round((currentMonday.getTime() - referenceMonday.getTime()) / (7 * 86400000));
    
    // We nemen de huidige cyclusindex, maar we willen de *vorige* (afgeronde) cyclus berekenen.
    // Of we controleren of we ons in de 6e week van de cyclus bevinden. 
    // Simpelste manier: pak de cyclus op basis van (diffWeeks - 1) zodat het pas na 6 weken wordt vastgelegd.
    const targetCyclusIndex = Math.floor((diffWeeks - 1) / 6);
    
    if (targetCyclusIndex < 0) {
      return res.status(200).json({ success: true, message: 'Geen afgeronde cyclus gevonden om te verwerken.' });
    }

    // 3. Haal gegevens op uit Firebase
    const snap = await db.ref('padelData').once('value');
    const data = snap.val() || {};
    const matchResults = data.matchResults || {};
    const basePlayers = ["Marcel", "Mark", "Ronald", "Sander", "Dennis", "Robert"];

    // 4. Bereken de games per speler voor die specifieke afgeronde cyclus
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
      
      // We kijken nu streng naar de doelcyclus
      if (matchCyclus !== targetCyclusIndex) continue;

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

    // 5. Bepaal de winnaar van deze afgeronde cyclus
    const uniqueScoresDesc = [...new Set(basePlayers.map(p => gameCounts[p] || 0))].sort((a, b) => b - a);
    const maxGames = uniqueScoresDesc[0] || 0;
    
    // Als er helemaal geen games zijn gespeeld in die cyclus, slaan we niets op
    if (maxGames === 0) {
      return res.status(200).json({ success: true, message: `Cyclus ${targetCyclusIndex + 1} heeft nog geen gespeelde wedstrijden, niets opgeslagen.` });
    }

    const firstPlayers = basePlayers.filter(p => (gameCounts[p] || 0) === maxGames);
    const winnerText = firstPlayers.join(', ');

    // 6. Sla definitief op in Firebase onder de juiste cyclus
    await db.ref(`padelData/cyclusWinnaars/${targetCyclusIndex}`).update({
      winner: winnerText,
      games: maxGames,
      scores: gameCounts,
      timestamp: Date.now(),
      bekendgemaaktDoorServer: true
    });

    return res.status(200).json({ 
      success: true, 
      message: `KingKong winnaar voor afgeronde cyclus ${targetCyclusIndex + 1} (${winnerText}) succesvol vastgelegd!` 
    });

  } catch (error) {
    console.error('Fout in kingkong-winnaar script:', error);
    return res.status(500).json({ error: error.message });
  }
}
