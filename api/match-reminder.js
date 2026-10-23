
import { timingSafeEqual } from 'node:crypto';
import {
  db,
  amsterdamNow,
  getWeekInfo,
  defaultTemplate,
  getTokensByPlayer,
  tokensOf,
  sendToTokens
} from '../lib/padel.js';

const CRON_SECRET = process.env.CRON_SECRET;

const DAGEN = {
  Mon: 'maandag',
  Tue: 'dinsdag',
  Wed: 'woensdag',
  Thu: 'donderdag',
  Fri: 'vrijdag',
  Sat: 'zaterdag',
  Sun: 'zondag'
};

function isAuthorized(req) {
  if (!CRON_SECRET) {
    console.error('CRON_SECRET ontbreekt.');
    return false;
  }

  const supplied = req.headers['x-cron-secret'];
  if (typeof supplied !== 'string') return false;

  const expectedBuffer = Buffer.from(CRON_SECRET);
  const suppliedBuffer = Buffer.from(supplied);

  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Methode niet toegestaan.' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Niet geautoriseerd.' });
  }

  try {
    const nl = amsterdamNow();

    if (nl.hour !== 17) {
      return res.status(200).json({
        status: `Geen actie: ${nl.weekday} ${nl.hour}:xx NL-tijd (vereist: 17 uur).`
      });
    }

    const vandaag = DAGEN[nl.weekday];
    const week = getWeekInfo(nl.year, nl.month, nl.day);

    const weekSnap = await db
      .ref(`padelData/scheduleOverrides/${week.key}`)
      .once('value');

    const weekOverride = weekSnap.val() || {};

    const vandaagSlots = ['dinsdag', 'donderdag'].filter(slot => {
      const gekozenDag =
        slot === 'dinsdag'
          ? weekOverride.customDinsdag
          : weekOverride.customDonderdag;

      return (gekozenDag || slot) === vandaag;
    });

    if (vandaagSlots.length === 0) {
      return res.status(200).json({
        status: `Geen wedstrijd op ${vandaag}.`
      });
    }

    const isAfgelast = slot => {
      const o = weekOverride[slot];
      return !!o &&
        typeof o === 'object' &&
        !Array.isArray(o) &&
        o.cancelled === true;
    };

    const doorgaandeSlots = vandaagSlots.filter(slot => !isAfgelast(slot));

    if (doorgaandeSlots.length === 0) {
      return res.status(200).json({
        status: 'De wedstrijd van vandaag is afgelast, geen herinnering verstuurd.'
      });
    }

    const flagRef = db.ref(`padelData/sentMatchReminders/${nl.dateKey}`);

    const claim = await flagRef.transaction(cur => cur ? undefined : true);

    if (!claim.committed) {
      return res.status(200).json({
        status: `Herinnering voor ${nl.dateKey} is al verzonden.`
      });
    }

    try {
      const [absenceSnap, tokensData] = await Promise.all([
        db.ref('padelData/absence').once('value'),
        getTokensByPlayer()
      ]);

      const absences = absenceSnap.val() || {};
      const active = new Set();

      for (const slot of doorgaandeSlots) {
        const override = weekOverride[slot];

        const players =
          Array.isArray(override) && override.length === 4
            ? override
            : defaultTemplate[week.templateIndex][slot];

        players.forEach(player => {
          if (!(absences[player] &&
                absences[player][`${week.key}_${slot}`])) {
            active.add(player);
          }
        });
      }

      const activeList = [...active];
      const tokens = tokensOf(tokensData, activeList);

      if (tokens.length === 0) {
        await flagRef.remove();

        return res.status(200).json({
          status: 'Geen tokens gevonden voor de spelers van vanavond.',
          players: activeList
        });
      }

      const result = await sendToTokens(tokens, {
        title: '🎾 Padel Reminder',
        body: 'Vanavond is het weer zover! Vergeet niet dat je vanavond de baan op moet.'
      });

      if (result.successCount === 0) {
        await flagRef.remove();
      }

      return res.status(200).json({
        success: result.successCount > 0,
        notifiedPlayers: activeList,
        ...result
      });
    } catch (err) {
      await flagRef.remove();
      throw err;
    }
  } catch (error) {
    console.error('Fout bij versturen match reminder:', error);

    return res.status(500).json({
      error: 'Er ging iets mis bij het versturen van de herinnering.'
    });
  }
}
