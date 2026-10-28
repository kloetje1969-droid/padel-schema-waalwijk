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

const RAIN_THRESHOLD = 60;          // regenkans in %
const PRECIPITATION_THRESHOLD = 1.0; // neerslag in mm (1,0 of meer)
const CHECK_BEFORE_START_MIN = 30;   // weercheck 30 minuten voor aanvang
const WINDOW_MIN = 30;               // de check mag maximaal 30 minuten na het doeltijdstip draaien

async function getRainForecast(dateKey, targetHour) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', '51.682');
  url.searchParams.set('longitude', '5.070');
  url.searchParams.set('hourly', 'precipitation_probability,precipitation');
  url.searchParams.set('models', 'knmi_seamless');
  url.searchParams.set('timezone', 'Europe/Amsterdam');
  url.searchParams.set('forecast_days', '2');

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Weerservice gaf HTTP ${response.status}`);
  const weather = await response.json();
  const hourly = weather.hourly;

  const targetTime = `${dateKey}T${pad2(targetHour)}:00`;
  const index = hourly.time.indexOf(targetTime);
  if (index === -1) throw new Error(`Geen weersverwachting gevonden voor ${targetTime}`);

  return {
    probability: Number(hourly.precipitation_probability[index] ?? 0),
    precipitation: Number(hourly.precipitation?.[index] ?? 0)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ status: 'Methode niet toegestaan' });
  }
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ status: 'Niet geautoriseerd' });
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
      return res.status(200).json({ status: 'Geen speeldag/wedstrijd vandaag', date: nl.dateKey });
    }

    const results = [];

    for (const match of matches) {
      const target = match.hour * 60 + match.minute - CHECK_BEFORE_START_MIN;
      const info = { slot: match.slot, start: match.timeString };

      if (!inWindow(nl, target, WINDOW_MIN)) {
        results.push({
          ...info,
          status: 'Niet het juiste tijdstip voor de weerscheck',
          doelTijd: `${pad2(Math.floor(target / 60))}:${pad2(target % 60)}`,
          huidigeTijd: `${pad2(nl.hour)}:${pad2(nl.minute)}`
        });
        continue;
      }

      const forecast = await getRainForecast(nl.dateKey, match.hour);
      if (forecast.probability < RAIN_THRESHOLD || forecast.precipitation < PRECIPITATION_THRESHOLD) {
        results.push({ ...info, status: 'Geen weerpush nodig (onder drempel)', ...forecast });
        continue;
      }

      // Alleen spelers die niet afwezig zijn
      const activePlayers = match.players.filter(p => !(absences[p] && absences[p][`${week.key}_${match.slot}`]));
      const tokens = tokensOf(await getTokensByPlayer(), activePlayers);
      if (tokens.length === 0) {
        results.push({ ...info, status: 'Geen pushtokens gevonden', spelers: activePlayers });
        continue;
      }

      // Maximaal 1x per wedstrijd per dag
      const lockRef = db.ref(`padelData/sentWeatherPushes/${nl.dateKey}_${match.slot}`);
      const claim = await lockRef.transaction(cur => (cur !== null ? undefined : { status: 'sending', startedAt: Date.now() }));
      if (!claim.committed) {
        results.push({ ...info, status: 'Weerpush al verstuurd' });
        continue;
      }

      try {
        const result = await sendToTokens(tokens, {
          title: '🌧️ Kans op regen tijdens padel',
          body: `Vandaag om ${match.timeString} uur padel. Regenkans ${forecast.probability}% (${forecast.precipitation} mm).`,
          tag: `padel-weather-${nl.dateKey}-${match.slot}`
        });

        if (Number(result.successCount || 0) > 0) {
          await lockRef.update({ status: 'sent', sentAt: Date.now(), successCount: result.successCount });
          results.push({ ...info, status: 'Weerpush verstuurd', successCount: result.successCount, ...forecast });
        } else {
          await lockRef.remove();
          results.push({ ...info, status: 'Geen push afgeleverd', errorCodes: result.errorCodes });
        }
      } catch (err) {
        await lockRef.remove();
        throw err;
      }
    }

    return res.status(200).json({ date: nl.dateKey, results });
  } catch (error) {
    console.error('Cron weather error:', error);
    return res.status(500).json({ status: 'Fout bij weercontrole', error: String(error?.message || error) });
  }
}
