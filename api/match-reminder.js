import { db, amsterdamNow, getWeekInfo, defaultTemplate, getTokensByPlayer, tokensOf, sendToTokens } from '../lib/padel.js';

const DAGEN = { Mon: 'maandag', Tue: 'dinsdag', Wed: 'woensdag', Thu: 'donderdag', Fri: 'vrijdag', Sat: 'zaterdag', Sun: 'zondag' };

// Aanroepen via cron, elke dag. Doet alleen iets tussen 17:00 en 17:59 NL-tijd, en alleen op de dag
// waarop een wedstrijd is. Dat is di/do, of de dag waarnaar de wedstrijd in de app is verplaatst.
// Een afgelaste wedstrijd krijgt geen herinnering.
export default async function handler(req, res) {
  try {
    const nl = amsterdamNow();
    if (nl.hour !== 17) {
      return res.status(200).json({ status: `Geen actie: ${nl.weekday} ${nl.hour}:xx NL-tijd (vereist: 17 uur).` });
    }

    const vandaag = DAGEN[nl.weekday];
    const week = getWeekInfo(nl.year, nl.month, nl.day);
    const weekSnap = await db.ref(`padelData/scheduleOverrides/${week.key}`).once('value');
    const weekOverride = weekSnap.val() || {};

    // Welke wedstrijd(en) zijn vandaag? De dinsdag-wedstrijd kan verplaatst zijn, de donderdag-wedstrijd ook.
    const vandaagSlots = ['dinsdag', 'donderdag'].filter(slot => {
      const gekozenDag = slot === 'dinsdag' ? weekOverride.customDinsdag : weekOverride.customDonderdag;
      return (gekozenDag || slot) === vandaag;
    });
    if (vandaagSlots.length === 0) {
      return res.status(200).json({ status: `Geen wedstrijd op ${vandaag}.` });
    }

    // Afgelast = {cancelled: true, players: [...]} (zo slaat de app het op)
    const isAfgelast = slot => {
      const o = weekOverride[slot];
      return !!o && typeof o === 'object' && !Array.isArray(o) && o.cancelled === true;
    };
    const doorgaandeSlots = vandaagSlots.filter(slot => !isAfgelast(slot));
    if (doorgaandeSlots.length === 0) {
      return res.status(200).json({ status: 'De wedstrijd van vandaag is afgelast, geen herinnering verstuurd.' });
    }

    // Atomair "claimen" zodat dubbele cron-aanroepen geen dubbele meldingen geven
    const flagRef = db.ref(`padelData/sentMatchReminders/${nl.dateKey}`);
    const claim = await flagRef.transaction(cur => (cur ? undefined : true));
    if (!claim.committed) {
      return res.status(200).json({ status: `Herinnering voor ${nl.dateKey} is al verzonden.` });
    }

    try {
      const [absenceSnap, tokensData] = await Promise.all([
        db.ref('padelData/absence').once('value'),
        getTokensByPlayer()
      ]);
      const absences = absenceSnap.val() || {};

      // Spelers van vanavond: wie niet is afgemeld, van alle wedstrijden van vandaag (elke speler maar 1x)
      const active = new Set();
      for (const slot of doorgaandeSlots) {
        const override = weekOverride[slot];
        const players = (Array.isArray(override) && override.length === 4) ? override : defaultTemplate[week.templateIndex][slot];
        players.forEach(p => {
          if (!(absences[p] && absences[p][`${week.key}_${slot}`])) active.add(p);
        });
      }
      const activeList = [...active];
      const tokens = tokensOf(tokensData, activeList);

      if (tokens.length === 0) {
        await flagRef.remove();
        return res.status(200).json({ status: 'Geen tokens gevonden voor de spelers van vanavond.', players: activeList });
      }

      const result = await sendToTokens(tokens, {
        title: '🎾 Padel Reminder',
        body: 'Vanavond is het weer zover! Vergeet niet dat je vanavond de baan op moet.'
      });

      if (result.successCount === 0) await flagRef.remove(); // volgende cron-aanroep mag opnieuw proberen

      return res.status(200).json({ success: result.successCount > 0, notifiedPlayers: activeList, ...result });
    } catch (err) {
      await flagRef.remove();
      throw err;
    }
  } catch (error) {
    console.error('Fout bij versturen match reminder:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij het versturen van de herinnering.' });
  }
}
