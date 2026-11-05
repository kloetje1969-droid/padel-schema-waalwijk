import { db, TZ, isCronAuthorized } from '../lib/padel.js';

// Wekelijkse back-up van alle gegevens (cron-job.org roept dit aan).
// 1. De back-up komt in Firebase onder "backups/<datum>" (alleen voor de server leesbaar). De laatste 8 blijven bewaard.
// 2. Staan BACKUP_GITHUB_TOKEN en BACKUP_GITHUB_REPO in Vercel, dan komt er ook een kopie in die (PRIVÉ) GitHub-repository.
// Foto's en bijlagen uit de chat, pushgegevens en aanwezigheidsgegevens worden niet meegenomen.

const BEWAAR_AANTAL = 8;
const FOUTLOG_DAGEN = 30;
const DAG_MS = 24 * 60 * 60 * 1000;

export function sleutelNu(now = new Date()) {
  const delen = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const p = Object.fromEntries(delen.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

export function schoonDataOp(data) {
  const kopie = JSON.parse(JSON.stringify(data || {}));
  delete kopie.tokens;
  delete kopie.presence;
  delete kopie.lastSeen;
  delete kopie.foutlog;
  if (kopie.messages && typeof kopie.messages === 'object') {
    for (const m of Object.values(kopie.messages)) {
      if (m && m.fileUrl) m.fileUrl = '[bijlage niet meegenomen]';
    }
  }
  return kopie;
}

async function kopieNaarGithub(sleutel, json) {
  const token = process.env.BACKUP_GITHUB_TOKEN;
  const repo = process.env.BACKUP_GITHUB_REPO;
  if (!token || !repo) return { gedaan: false, reden: 'niet ingesteld' };
  const branch = process.env.BACKUP_GITHUB_BRANCH || 'main';
  try {
    const resp = await fetch(`https://api.github.com/repos/${repo}/contents/padel-backup-${sleutel}.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'padelschema-backup',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        message: `Back-up ${sleutel}`,
        content: Buffer.from(json, 'utf-8').toString('base64'),
        branch
      })
    });
    if (resp.status === 200 || resp.status === 201) return { gedaan: true };
    return { gedaan: false, reden: `GitHub antwoordde met ${resp.status}` };
  } catch (e) {
    return { gedaan: false, reden: e.message || 'onbekende fout' };
  }
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
    const snap = await db.ref('padelData').once('value');
    const data = schoonDataOp(snap.val());
    const json = JSON.stringify(data);
    const sleutel = sleutelNu();

    await db.ref(`backups/${sleutel}`).set({ gemaakt: Date.now(), data });
    await db.ref(`backupIndex/${sleutel}`).set(true);

    // Alleen de laatste BEWAAR_AANTAL back-ups houden
    const indexSnap = await db.ref('backupIndex').once('value');
    const sleutels = Object.keys(indexSnap.val() || {}).sort();
    const weg = sleutels.slice(0, Math.max(0, sleutels.length - BEWAAR_AANTAL));
    for (const k of weg) {
      await db.ref(`backups/${k}`).remove();
      await db.ref(`backupIndex/${k}`).remove();
    }

    const github = await kopieNaarGithub(sleutel, json);
    const kb = Math.round(json.length / 1024);
    await db.ref('padelData/settings/laatsteBackup').set({ tijd: Date.now(), kb, sleutel, github: github.gedaan === true });

    // Oude foutmeldingen uit de foutenlog opruimen
    let opgeruimd = 0;
    try {
      const grens = Date.now() - FOUTLOG_DAGEN * DAG_MS;
      const log = (await db.ref('padelData/foutlog').once('value')).val() || {};
      const oud = Object.keys(log).filter(k => !log[k] || !(log[k].tijd > grens));
      if (oud.length) {
        const upd = {};
        oud.forEach(k => { upd[k] = null; });
        await db.ref('padelData/foutlog').update(upd);
        opgeruimd = oud.length;
      }
    } catch (e) {
      console.error('Foutenlog opruimen mislukt:', e);
    }

    console.log('BACKUP', JSON.stringify({ sleutel, kb, bewaard: sleutels.length - weg.length, verwijderd: weg.length, github: github.gedaan, opgeruimd }));
    return res.status(200).json({ status: 'Back-up gemaakt', sleutel, kb, bewaard: sleutels.length - weg.length, verwijderd: weg.length, github, foutmeldingenOpgeruimd: opgeruimd });
  } catch (error) {
    console.error('Fout bij back-up:', error);
    return res.status(500).json({ error: 'De back-up is mislukt.' });
  }
}
