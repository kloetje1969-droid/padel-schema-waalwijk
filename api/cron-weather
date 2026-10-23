import { db, getTokensByPlayer, sendToTokens } from '../lib/padel.js';

// Beveiliging tegen ongewenste aanroepen
const CRON_SECRET = process.env.CRON_SECRET || "padel-cron-secret-12345";

export default async function handler(req, res) {
  try {
    // 1. Controleer geheime sleutel (zodat cron-job.org wel mag aanroepen zonder Firebase-inlog)
    const { secret } = req.query;
    if (secret !== CRON_SECRET && req.headers['x-cron-secret'] !== CRON_SECRET) {
      return res.status(401).json({ error: 'Niet geautoriseerd.' });
    }

    // 2. Datum bepalen (bijv: "2026-10-23")
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    // 3. Check herhaalmechanisme (18:00, 18:10, 18:20): Is er vandaag al een push verzonden?
    const lockRef = db.ref(`padelData/sentWeatherPushes/${todayStr}`);
    const snapshot = await lockRef.once('value');
    if (snapshot.exists()) {
      console.log("Notificatie voor vandaag is al eerder succesvol verzonden. Geen actie vereist.");
      return res.status(200).send("Already sent today");
    }

    // 4. Haal KNMI-weer op via Open-Meteo voor Waalwijk om 18:00 uur
    const weatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=51.6833&longitude=5.0708&hourly=precipitation_probability,precipitation&models=knmi_seamless&timezone=Europe/Amsterdam&forecast_days=1";
    const weatherRes = await fetch(weatherUrl);
    const weatherData = await weatherRes.json();

    if (!weatherData || !weatherData.hourly) {
      return res.status(500).json({ error: 'Kon KNMI weerdata niet ophalen.' });
    }

    const targetTimeStr = `${todayStr}T18:00`;
    const timeIndex = weatherData.hourly.time.indexOf(targetTimeStr);

    let pop = 0;   // regenkans %
    let rain = 0;  // mm regen

    if (timeIndex !== -1) {
      pop = weatherData.hourly.precipitation_probability ? weatherData.hourly.precipitation_probability[timeIndex] : 0;
      rain = weatherData.hourly.precipitation ? weatherData.hourly.precipitation[timeIndex] : 0;
    }

    // 5. Controleer of het vandaag een speeldag is
    const scheduleSnap = await db.ref('padelData/scheduleOverrides').once('value');
    const overrides = scheduleSnap.val() || {};

    const getISOWeek = (d) => {
      let date = new Date(d.getTime());
      date.setHours(0,0,0,0);
      date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
      let week1 = new Date(date.getFullYear(), 0, 4);
      return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    };

    const currentWeekNum = getISOWeek(today);
    const uniqueWeekKey = `${year}_w${currentWeekNum}`;
    const dayNames = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    const currentDayName = dayNames[today.getDay()];

    const weekData = overrides[uniqueWeekKey] || {};
    const customDi = weekData.customDinsdag || 'dinsdag';
    const customDo = weekData.customDonderdag || 'donderdag';

    const isMatchToday = (currentDayName === customDi || currentDayName === customDo);
    const activeSlot = (currentDayName === customDi) ? 'dinsdag' : (currentDayName === customDo ? 'donderdag' : null);
    const isCancelled = activeSlot && weekData[activeSlot] && weekData[activeSlot].cancelled === true;

    // Is er géén wedstrijd of is hij afgelast? Stop dan.
    if (!isMatchToday || isCancelled) {
      return res.status(200).send("Geen actieve speeldag vandaag.");
    }

    // 6. Check of de regenkans >= 60% is
    if (pop >= 60) {
      const title = "🌧️ Regenbericht Padelschema";
      const body = `Er is vanavond ${pop}% kans op regen in Waalwijk (${rain} mm).`;

      const tokensData = await getTokensByPlayer();
      const recipients = Object.keys(tokensData);
      const tokens = recipients.flatMap(player => Object.keys(tokensData[player] || {}));

      if (tokens.length > 0) {
        await sendToTokens(tokens, { title, body, tag: `weather_${todayStr}` });
      }

      // Markeer in Firebase dat hij SUCCESVOL is verzonden (zodat 18:10 en 18:20 stoppen)
      await lockRef.set({
        sentAt: new Date().toISOString(),
        rain: rain,
        pop: pop
      });

      return res.status(200).send("Melding succesvol verzonden!");
    } else {
      return res.status(200).send(`Regenkans is ${pop}% (onder 60%), geen melding verzonden.`);
    }

  } catch (error) {
    console.error("Fout in weer-cronjob:", error);
    return res.status(500).json({ error: error.message });
  }
}
