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

// Herinnering om de uitslag in te vullen.
// Een wedstrijd duurt WEDSTRIJD_DUUR_MIN minuten; daarna wachten we NA_EINDE_MIN minuten.
// Dus: starttijd + 60 + 60 = 2 uur na aanvang (bijv. start 18:30 -> melding rond 20:30).
const WEDSTRIJD_DUUR_MIN = 60;
const NA_EINDE_MIN = 60;
const HERINNERING_NA_START_MIN = WEDSTRIJD_DUUR_MIN + NA_EINDE_MIN;
const WINDOW_MIN = 30;           // mag maximaal 30 minuten na het doeltijdstip draaien
const NAAR_ALLE_SPELERS = false; // false = alleen de spelers van die wedstrijd, true = iedereen met een token

async function weekOverrideVan(weekKey, cache) {
  if (!cache[weekKey]) {
    const snap = await db.ref(`padelData/scheduleOverrides/${weekKey}`).once('value');
    cache[weekKey] = snap.val() || {};
  }
  return cache[weekKey];
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
    const nl = amsterdamNow();
    const gisteren = amsterdamNow(new Date(Date.now() - 24 * 60 * 60 * 1000));

    // Pushmeldingen kunnen door Robert zijn uitgezet
    const pushSnap = await db.ref('padelData/settings/pushGloballyEnabled').once('value');
    if (pushSnap.val() === false) {
      return res.status(200).json({ status: 'Push staat uit, geen herinneringen verstuurd.', date: nl.dateKey });
    }

    const [absenceSnap, resultsSnap] = await Promise.all([
      db.ref('padelData/absence').once('value'),
      db.ref('padelData/matchResults').once('value')
    ]);
    const absences = absenceSnap.val() || {};
    const matchResults = resultsSnap.val() || {};
    const cache = {};
    const results = [];

    // Wedstrijden van vandaag (melding vóór middernacht) en van gisteren (melding na middernacht)
    for (const dag of [{ ref: nl, offset: 0, label: 'vandaag' }, { ref: gisteren, offset: 1440, label: 'gisteren' }]) {
      const week = getWeekInfo(dag.ref.year, dag.ref.month, dag.ref.day);
      const weekOverride = await weekOverrideVan(week.key, cache);
      const matches = getTodaysMatches(dag.ref, week, weekOverride);

      for (const match of matches) {
        const start = match.hour * 60 + match.minute;
        const doel = start + HERINNERING_NA_START_MIN - dag.offset; // minuten sinds middernacht van vandaag
        const info = { slot: match.slot, dag: dag.label, start: match.timeString };

        // Gisteren alleen als het doeltijdstip na middernacht valt, vandaag alleen als het nog vóór middernacht valt
        if ((dag.offset === 0 && doel >= 1440) || (dag.offset === 1440 && doel < 0)) continue;

        if (!inWindow(nl, doel, WINDOW_MIN)) {
          results.push({
            ...info,
            status: 'Niet het juiste tijdstip voor de uitslag-herinnering.',
            doelTijd: `${pad2(Math.floor(doel / 60))}:${pad2(doel % 60)}`,
            huidigeTijd: `${pad2(nl.hour)}:${pad2(nl.minute)}`
          });
          continue;
        }

        const matchId = `${week.key}_${match.slot}`;

        // Al een uitslag ingevuld: geen herinnering nodig
        if (matchResults[matchId]) {
          results.push({ ...info, status: 'Uitslag is al ingevuld.' });
          continue;
        }

        // Maximaal 1x per wedstrijd
        const flagRef = db.ref(`padelData/sentResultReminders/${matchId}`);
        const claim = await flagRef.transaction(cur => (cur ? undefined : true));
        if (!claim.committed) {
          results.push({ ...info, status: 'Herinnering is al verzonden.' });
          continue;
        }

        try {
          const tokensData = await getTokensByPlayer();
          let ontvangers;
          let tokens;
          if (NAAR_ALLE_SPELERS) {
            ontvangers = Object.keys(tokensData);
            tokens = tokensOf(tokensData, ontvangers);
          } else {
            ontvangers = [...new Set(match.players)].filter(
              p => !(absences[p] && absences[p][`${week.key}_${match.slot}`])
            );
            tokens = tokensOf(tokensData, ontvangers);
          }

          if (tokens.length === 0) {
            await flagRef.remove();
            results.push({ ...info, status: 'Geen tokens gevonden voor de ontvangers.', ontvangers });
            continue;
          }

          const wanneer = dag.label === 'gisteren' ? 'van gisteren' : 'van vandaag';
          const result = await sendToTokens(tokens, {
            title: '📝 Uitslag invullen',
            body: `De padelwedstrijd ${wanneer} (${match.timeString} uur) is afgelopen. Vul je de uitslag in?`,
            tag: `padel-uitslag-${matchId}`
          });

          if (result.successCount === 0) {
            await flagRef.remove();
          }

          results.push({
            ...info,
            status: result.successCount > 0 ? 'Herinnering verstuurd.' : 'Geen push afgeleverd.',
            notifiedPlayers: ontvangers,
            successCount: result.successCount,
            errorCodes: result.errorCodes
          });
        } catch (err) {
          await flagRef.remove();
          throw err;
        }
      }
    }

    if (results.length === 0) {
      return res.status(200).json({ status: 'Geen wedstrijd voor een uitslag-herinnering.', date: nl.dateKey });
    }
    return res.status(200).json({ date: nl.dateKey, results });
  } catch (error) {
    console.error('Fout bij versturen uitslag-herinnering:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij het versturen van de uitslag-herinnering.' });
  }
}
