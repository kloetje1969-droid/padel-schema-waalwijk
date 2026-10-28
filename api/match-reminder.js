import {
  db,
  amsterdamNow,
  getWeekInfo,
  getTodaysMatches,
  inWindow,
  pad2,
  isCronAuthorized,
  getTokensByPlayer,
  tokensOf,
  sendToTokens
} from '../lib/padel.js';

const REMIND_BEFORE_START_MIN = 60; // herinnering 1 uur voor aanvang
const WINDOW_MIN = 30;              // mag maximaal 30 minuten na het doeltijdstip draaien

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Methode niet toegestaan.' });
  }
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Niet geautoriseerd.' });
  }

  try {
    const nl = amsterdamNow();
    const week = getWeekInfo(nl.year, nl.month, nl.day);

    const [weekSnap, absenceSnap] = await Promise.all([
      db.ref(`padelData/scheduleOverrides/${week.key}`).once('value'),
      db.ref('padelData/absence').once('value')
    ]);
    const weekOverride = weekSnap.val() || {};
    const absences = absenceSnap.val() || {};

    const matches = getTodaysMatches(nl, week, weekOverride);
    if (matches.length === 0) {
      return res.status(200).json({ status: 'Geen actieve speeldag/wedstrijd vandaag.', date: nl.dateKey });
    }

    const results = [];

    for (const match of matches) {
      const target = match.hour * 60 + match.minute - REMIND_BEFORE_START_MIN;
      const info = { slot: match.slot, start: match.timeString };

      if (!inWindow(nl, target, WINDOW_MIN)) {
        results.push({
          ...info,
          status: 'Niet het juiste tijdstip voor de match reminder.',
          doelTijd: `${pad2(Math.floor(target / 60))}:${pad2(target % 60)}`,
          huidigeTijd: `${pad2(nl.hour)}:${pad2(nl.minute)}`
        });
        continue;
      }

      // Maximaal 1x per wedstrijd per dag
      const flagRef = db.ref(`padelData/sentMatchReminders/${nl.dateKey}_${match.slot}`);
      const claim = await flagRef.transaction(cur => (cur ? undefined : true));
      if (!claim.committed) {
        results.push({ ...info, status: 'Herinnering is al verzonden.' });
        continue;
      }

      try {
        const activePlayers = [...new Set(match.players)].filter(
          p => !(absences[p] && absences[p][`${week.key}_${match.slot}`])
        );
        const tokens = tokensOf(await getTokensByPlayer(), activePlayers);

        if (tokens.length === 0) {
          await flagRef.remove();
          results.push({ ...info, status: 'Geen tokens gevonden voor de spelers.', spelers: activePlayers });
          continue;
        }

        const result = await sendToTokens(tokens, {
          title: '🏓 Padel Reminder',
          body: `Over ongeveer een uur (${match.timeString} uur) staat de padelwedstrijd gepland!`,
          tag: `padel-reminder-${nl.dateKey}-${match.slot}`
        });

        if (result.successCount === 0) {
          await flagRef.remove();
        }

        results.push({
          ...info,
          status: result.successCount > 0 ? 'Herinnering verstuurd.' : 'Geen push afgeleverd.',
          notifiedPlayers: activePlayers,
          successCount: result.successCount,
          errorCodes: result.errorCodes
        });
      } catch (err) {
        await flagRef.remove();
        throw err;
      }
    }

    return res.status(200).json({ date: nl.dateKey, results });
  } catch (error) {
    console.error('Fout bij versturen match reminder:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij het versturen van de herinnering.' });
  }
}
