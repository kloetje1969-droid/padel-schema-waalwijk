import { db, amsterdamNow, getWeekInfo, getTokensByPlayer, sendToTokens } from '../lib/padel.js';

const DAGEN = { Mon: 'maandag', Tue: 'dinsdag', Wed: 'woensdag', Thu: 'donderdag', Fri: 'vrijdag', Sat: 'zaterdag', Sun: 'zondag' };

async function getRainChance() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=51.6833&longitude=5.0708&hourly=precipitation_probability&timezone=Europe/Amsterdam&forecast_days=1';
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo gaf status ${res.status}`);
  const data = await res.json();
  const idx = data.hourly.time.findIndex(t => t.endsWith('T18:00'));
  return idx >= 0 ? data.hourly.precipitation_probability[idx] : 0;
}

// Aanroepen via cron, elke dag. Doet alleen iets tussen 18:00 en 18:59 NL-tijd, en maximaal 1x per dag,
// op de dag waarop een wedstrijd is. Dat is di/do, of de dag waarnaar de wedstrijd in de app is verplaatst.
// Een afgelaste wedstrijd krijgt geen weeralarm.
export default async function handler(req, res) {
  try {
    const nl = amsterdamNow();
    if (nl.hour !== 18) {
      return res.status(200).json({ status: `Geen actie: het is ${nl.hour}:xx NL-tijd (vereist: 18 uur).` });
    }

    const vandaag = DAGEN[nl.weekday];
    const week = getWeekInfo(nl.year, nl.month, nl.day);
    const weekSnap = await db.ref(`padelData/scheduleOverrides/${week.key}`).once('value');
    const weekOverride = weekSnap.val() || {};

    // Welke wedstrijd(en) zijn vandaag? De dinsdag- en donderdag-wedstrijd kunnen verplaatst zijn.
    const vandaagSlots = ['dinsdag', 'donderdag'].filter(slot => {
      const gekozenDag = slot === 'dinsdag' ? weekOverride.customDinsdag : weekOverride.customDonderdag;
      return (gekozenDag || slot) === vandaag;
    });
    if (vandaagSlots.length === 0) {
      return res.status(200).json({ status: `Geen actie: er is geen wedstrijd op ${vandaag}.` });
    }

    // Afgelast = {cancelled: true, players: [...]} (zo slaat de app het op)
    const isAfgelast = slot => {
      const o = weekOverride[slot];
      return !!o && typeof o === 'object' && !Array.isArray(o) && o.cancelled === true;
    };
    if (vandaagSlots.every(isAfgelast)) {
      return res.status(200).json({ status: 'Geen actie: de wedstrijd van vandaag is afgelast.' });
    }

    const rainChance = await getRainChance();
    if (rainChance < 60) {
      return res.status(200).json({ status: `Geen actie: regenkans ${rainChance}% (drempel 60%).` });
    }

    const flagRef = db.ref(`padelData/sentWeatherAlerts/${nl.dateKey}`);
    const claim = await flagRef.transaction(cur => (cur ? undefined : true));
    if (!claim.committed) {
      return res.status(200).json({ status: `Weeralarm voor ${nl.dateKey} is al verzonden.` });
    }

    try {
      const tokensData = await getTokensByPlayer();
      const tokens = Object.values(tokensData).flatMap(t => Object.keys(t || {}));
      if (tokens.length === 0) {
        await flagRef.remove();
        return res.status(200).json({ status: 'Regenkans >= 60%, maar geen tokens gevonden.' });
      }

      const result = await sendToTokens(tokens, {
        title: '🌧️ Padel Weeralarm',
        body: `Let op! De regenkans vanavond is ${rainChance}%. Houd het weer in de gaten!`
      });
      if (result.successCount === 0) await flagRef.remove();

      return res.status(200).json({ success: result.successCount > 0, rainChance, ...result });
    } catch (err) {
      await flagRef.remove();
      throw err;
    }
  } catch (error) {
    console.error('Fout bij weerscheck:', error);
    return res.status(500).json({ error: 'Er ging iets mis bij de weerscheck.' });
  }
}
