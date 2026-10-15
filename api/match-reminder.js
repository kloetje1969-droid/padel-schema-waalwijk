import { db, amsterdamNow, getWeekInfo, defaultTemplate, getTokensByPlayer, tokensOf, sendToTokens } from '../lib/padel.js';

// Aanroepen via cron (bijv. elk uur of elke 10 min). Doet alleen iets op di/do tussen 17:00 en 17:59 NL-tijd.
export default async function handler(req, res) {
  try {
    const nl = amsterdamNow();
    if ((nl.weekday !== 'Tue' && nl.weekday !== 'Thu') || nl.hour !== 17) {
      return res.status(200).json({ status: `Geen actie: ${nl.weekday} ${nl.hour}:xx NL-tijd (vereist: di of do, 17 uur).` });
    }

    const dayKey = nl.weekday === 'Tue' ? 'dinsdag' : 'donderdag';

    // Atomair "claimen" zodat dubbele cron-aanroepen geen dubbele meldingen geven
    const flagRef = db.ref(`padelData/sentMatchReminders/${nl.dateKey}`);
    const claim = await flagRef.transaction(cur => (cur ? undefined : true));
    if (!claim.committed) {
      return res.status(200).json({ status: `Herinnering voor ${nl.dateKey} is al verzonden.` });
    }

    try {
      const week = getWeekInfo(nl.year, nl.month, nl.day);
      const [overridesSnap, absenceSnap, tokensData] = await Promise.all([
        db.ref(`padelData/scheduleOverrides/${week.key}/${dayKey}`).once('value'),
        db.ref('padelData/absence').once('value'),
        getTokensByPlayer()
      ]);

      const override = overridesSnap.val();
      const players = (Array.isArray(override) && override.length === 4) ? override : defaultTemplate[week.templateIndex][dayKey];
      const absences = absenceSnap.val() || {};

      const active = players.filter(p => !(absences[p] && absences[p][`${week.key}_${dayKey}`]));
      const tokens = tokensOf(tokensData, active);

      if (tokens.length === 0) {
        await flagRef.remove();
        return res.status(200).json({ status: 'Geen tokens gevonden voor de spelers van vanavond.', players: active });
      }

      const result = await sendToTokens(tokens, {
        title: '🎾 Padel Reminder',
        body: 'Vanavond is het weer zover! Vergeet niet dat je vanavond de baan op moet.'
      });

      if (result.successCount === 0) await flagRef.remove(); // volgende cron-aanroep mag opnieuw proberen

      return res.status(200).json({ success: result.successCount > 0, notifiedPlayers: active, ...result });
    } catch (err) {
      await flagRef.remove();
      throw err;
    }
  } catch (error) {
    console.error('Fout bij versturen match reminder:', error);
    return res.status(500).json({ error: error.message });
  }
}
