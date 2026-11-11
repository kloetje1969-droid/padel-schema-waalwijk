// Controle van de bestanden zelf: syntaxis, versienummer, beveiliging van de serverfuncties en de databaseregels.
// Draait met: node --test regels.test.mjs structuur.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const lees = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const html = lees('index.html');
const foutlogJs = lees('foutlog.js');
const apiBestanden = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
const regels = JSON.parse(lees('firebase-rules.json')).rules;

// Eigen scriptbestanden die index.html laadt (niet die van Google/Firebase), bijvoorbeeld foutlog.js of een nieuwe functie
function eigenScripts(tekst) {
  return [...tekst.matchAll(/<script[^>]*\bsrc="([^":]+?\.js)(?:\?v=([^"]*))?"/g)].map(m => ({ bestand: m[1], versie: m[2] }));
}

function inlineScripts(tekst) {
  return [...tekst.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

test('index.html: de scripts hebben geen syntaxisfouten', () => {
  const scripts = inlineScripts(html);
  assert.ok(scripts.length >= 1);
  scripts.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code, { filename: `index.html (script ${i + 1})` })));
  assert.doesNotThrow(() => new vm.Script(foutlogJs, { filename: 'foutlog.js' }));
  // Elk eigen scriptbestand (ook een nieuw functiebestand) moet bestaan en mag geen syntaxisfouten hebben
  for (const { bestand } of eigenScripts(html)) {
    assert.ok(fs.existsSync(path.join(ROOT, bestand)), `index.html laadt ${bestand}, maar dat bestand bestaat niet`);
    assert.doesNotThrow(() => new vm.Script(lees(bestand), { filename: bestand }));
  }
});

test('padel-regels.js: geen syntaxisfouten', () => {
  assert.doesNotThrow(() => new vm.Script(lees('padel-regels.js'), { filename: 'padel-regels.js' }));
});

test('api/ en lib/: geen syntaxisfouten', () => {
  const bestanden = [...apiBestanden.map(f => `api/${f}`), 'lib/padel.js'];
  assert.ok(bestanden.length >= 8, 'de serverbestanden ontbreken');
  for (const b of bestanden) {
    const r = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: lees(b), encoding: 'utf-8' });
    assert.equal(r.status, 0, `${b}: ${r.stderr}`);
  }
});

test('versienummer: precies een plek, en nergens vastgetypt in titel of voettekst', () => {
  const treffers = html.match(/const APP_VERSION = "\d+\.\d+"/g) || [];
  assert.equal(treffers.length, 1, 'APP_VERSION moet precies een keer voorkomen');
    const versieIngetypt = html.replace(/const APP_VERSION = "\d+\.\d+"/, '').match(/\bV\d+\.\d+\b/g);
  assert.equal(versieIngetypt, null, `versienummer staat ook ergens anders: ${versieIngetypt}`);
  // Elk eigen scriptbestand krijgt ?v=<APP_VERSION>, zodat telefoons het bij een nieuwe versie verversen
  // (padel-regels.js is de enige uitzondering: dat wordt ook door de server geïmporteerd en zonder ?v= geladen)
  const versie = (html.match(/const APP_VERSION = "(\d+\.\d+)"/) || [])[1];
  for (const s of eigenScripts(html).filter(s => s.bestand !== 'padel-regels.js')) {
    assert.equal(s.versie, versie, `index.html moet ${s.bestand}?v=${versie} laden (hetzelfde nummer als APP_VERSION)`);
  }
});

test('stijl.css: bestaat, klopt (accolades) en index.html laadt hem met het huidige versienummer', () => {
  const css = lees('stijl.css');
  assert.ok(css.length > 20000, 'stijl.css ontbreekt of is veel te klein');
  const zonder = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
  const open = (zonder.match(/\{/g) || []).length;
  const dicht = (zonder.match(/\}/g) || []).length;
  assert.equal(open, dicht, `stijl.css: ${open} accolades openen en ${dicht} sluiten (bestand afgekapt?)`);
  const versie = (html.match(/const APP_VERSION = "(\d+\.\d+)"/) || [])[1];
  assert.ok(versie, 'APP_VERSION niet gevonden');
  assert.ok(html.includes(`<link rel="stylesheet" href="stijl.css?v=${versie}">`), `index.html moet stijl.css?v=${versie} laden (hetzelfde nummer als APP_VERSION)`);
  assert.equal(/<style[\s>]/.test(html), false, 'er staat nog een <style>-blok in index.html; de opmaak hoort in stijl.css');
});

test('foutlog.js: wordt vóór de hoofdcode geladen met het huidige versienummer en staat niet dubbel in index.html', () => {
  assert.ok(foutlogJs.length > 1500, 'foutlog.js ontbreekt of is veel te klein');
  const versie = (html.match(/const APP_VERSION = "(\d+\.\d+)"/) || [])[1];
  const tag = `<script src="foutlog.js?v=${versie}"></script>`;
  assert.ok(html.includes(tag), `index.html moet ${tag} laden (hetzelfde nummer als APP_VERSION)`);
  assert.ok(html.indexOf(tag) < html.indexOf('const APP_VERSION'), 'foutlog.js moet vóór de hoofdcode worden geladen');
  for (const naam of ['function legFoutVast', 'function stuurFoutWachtrij', 'const foutWachtrij']) {
    assert.ok(foutlogJs.includes(naam), `foutlog.js mist ${naam}`);
    assert.equal(html.includes(naam), false, `${naam} staat nog in index.html (dubbel)`);
  }
});

test('index.html laadt de gedeelde regels en gebruikt geen browserpopups', () => {
  assert.match(html, /<script[^>]*src="padel-regels\.js"/);
  // Zonder internet (sinds 9.04): de servicemedewerker haalt eerst van internet en laat de server en de database met rust
  const sw = lees('firebase-messaging-sw.js');
  assert.match(sw, /addEventListener\('fetch'/, 'de servicemedewerker bewaart de app niet voor gebruik zonder internet');
  assert.match(sw, /fetch\(req\)\.then[\s\S]*\.catch\(\(\) => caches\.match/, 'de servicemedewerker moet eerst internet proberen en pas daarna de bewaarde kopie');
  assert.match(sw, /startsWith\('\/api\/'\)\) return/, '/api/ mag nooit uit de bewaarde kopie komen');
  assert.match(sw, /'push'/, 'de pushmeldingen in de servicemedewerker zijn verdwenen');
  const zonderTekstregels = inlineScripts(html).join('\n') + '\n' + foutlogJs;
  assert.equal(/(?<![A-Za-z_.$])(alert|confirm|prompt)\(/.test(zonderTekstregels), false, 'gebruik toonMelding of bevestigDialoog in plaats van alert/confirm');
});

test('de cron-jobs en de back-up controleren de geheime sleutel', () => {
  for (const f of ['match-reminder.js', 'cron-weather.js', 'result-reminder.js', 'kingkong-winnaar.js', 'backup.js', 'online-melding.js']) {
    assert.match(lees(`api/${f}`), /isCronAuthorized\(req\)/, `${f} controleert de x-cron-secret niet`);
  }
});

test('notify en test-push controleren het inlogbewijs van de aanvrager', () => {
  assert.match(lees('api/notify.js'), /verifyIdToken/);
  assert.match(lees('api/notify.js'), /decoded\.lid !== true/);
  assert.match(lees('api/test-push.js'), /verifyIdToken/);
  assert.match(lees('api/test-push.js'), /decoded\.robert !== true/);
});

test('geheimen staan nergens in de bestanden', () => {
  const alles = [html, foutlogJs, lees('stijl.css'), lees('padel-regels.js'), lees('firebase-rules.json'), ...apiBestanden.map(f => lees(`api/${f}`)), lees('lib/padel.js')].join('\n');
  assert.equal(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(alles), false, 'er staat een privésleutel in de bestanden');
  assert.equal(/\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/.test(alles), false, 'er staat een GitHub-token in de bestanden');
});

function alleRegels(knoop, pad = '', uit = []) {
  for (const [k, v] of Object.entries(knoop)) {
    if (typeof v === 'object' && v !== null) alleRegels(v, `${pad}/${k}`, uit);
    else if (k === '.read' || k === '.write' || k === '.validate') uit.push({ pad: `${pad}/${k}`, waarde: v });
  }
  return uit;
}

test('databaseregels: niets staat open voor iedereen', () => {
  assert.equal(regels['.read'], false);
  assert.equal(regels['.write'], false);
  for (const r of alleRegels(regels)) {
    if (r.pad.endsWith('/.read') || r.pad.endsWith('/.write')) assert.notEqual(r.waarde, true, `${r.pad} staat open`);
  }
  assert.match(regels.padelData['.read'], /auth\.token\.lid === true/);
});

test('databaseregels: schrijven vraagt een lidmaatschap en instellingen alleen Robert', () => {
  const schrijfRegels = alleRegels(regels).filter(r => r.pad.endsWith('/.write') && r.waarde !== false);
  assert.ok(schrijfRegels.length >= 10);
  for (const r of schrijfRegels) assert.match(String(r.waarde), /auth != null/, `${r.pad} controleert de inlog niet`);
  assert.match(regels.padelData.settings['.write'], /auth\.token\.robert === true/);
  assert.match(regels.padelData.foutlog['.write'], /auth\.token\.robert === true/);
  // Een bekendgemaakt podium kan alleen Robert nog wijzigen (de app en de server overschrijven het nooit)
  assert.equal(regels.padelData.cyclusWinnaars['.write'], undefined, 'cyclusWinnaars mag niet in zijn geheel beschrijfbaar zijn');
  assert.match(regels.padelData.cyclusWinnaars.$cyclusIdx['.write'], /!data\.child\('winner'\)\.exists\(\)/, 'een bestaand podium is niet beschermd');
});

test('databaseregels: de vormen van berichten, invalvragen en foutmeldingen zijn begrensd', () => {
  const tekst = JSON.stringify(regels.padelData.messages);
  assert.match(tekst, /2000/, 'chatberichten zijn niet tot 2000 tekens begrensd');
  const foutvelden = ['tijd', 'bericht', 'bron', 'regel', 'stack', 'apparaat', 'gebruiker', 'versie'];
  const toegestaan = Object.keys(regels.padelData.foutlog.$id).filter(k => !k.startsWith('.') && !k.startsWith('$'));
  for (const v of foutvelden) assert.ok(toegestaan.includes(v), `foutlog: veld ${v} wordt door de app gestuurd maar door de regels geweigerd`);
  assert.equal(regels.padelData.foutlog.$id.$other['.validate'], false);
  const invalvelden = ['status', 'createdAt', 'createdBy', 'takenBy', 'takenAt'];
  const invalToegestaan = Object.keys(regels.padelData.invallers.$matchKey.$speler).filter(k => !k.startsWith('.') && !k.startsWith('$'));
  for (const v of invalvelden) assert.ok(invalToegestaan.includes(v), `invallers: veld ${v} ontbreekt in de regels`);
});

test('databaseregels: BBQ en Borrel laat alleen de zes namen, een datum en ja of nee toe', () => {
  const bbq = regels.padelData.bbqBorrel;
  assert.ok(bbq, 'de regels voor bbqBorrel ontbreken');
  assert.equal(bbq['.write'], undefined, 'bbqBorrel mag niet in zijn geheel beschrijfbaar zijn');
  assert.match(bbq.antwoorden.$naam['.write'], /auth\.token\.lid === true/);
  for (const naam of ['Marcel', 'Mark', 'Ronald', 'Sander', 'Dennis', 'Robert']) {
    assert.ok(bbq.antwoorden.$naam['.validate'].includes(`'${naam}'`), `bbqBorrel: ${naam} ontbreekt in de regels`);
  }
  assert.match(bbq.antwoorden.$naam.$datum['.validate'], /'ja'.*'nee'/);
  assert.match(bbq.gemeld['.write'], /auth\.token\.lid === true/);
  assert.match(bbq.gemeld['.validate'], /\[MK\]:/, 'gemeld kent de stand K: (Robert kiest) niet');
  assert.match(bbq.gekozen['.write'], /auth\.token\.robert === true/, 'alleen Robert mag de BBQ-datum kiezen');
  assert.match(bbq.gekozen['.write'], /!newData\.exists\(\)/, 'leden mogen de gekozen datum alleen wissen');
  assert.equal(bbq.$other['.validate'], false);
  assert.ok(regels.padelData.settings.bbqBorrelMaand['.validate'], 'de maand van BBQ en Borrel wordt niet gecontroleerd');
  assert.ok(html.includes("padelData/settings/bbqBorrelMaand"), 'de app leest de maand niet uit settings/bbqBorrelMaand');
});

test('de app schrijft alleen naar plekken die de databaseregels kennen', () => {
  const toegestaan = Object.keys(regels.padelData).filter(k => !k.startsWith('.'));
  const gebruikt = new Set([...(html + '\n' + foutlogJs).matchAll(/padelData\/([A-Za-z]+)/g)].map(m => m[1]));
  for (const g of gebruikt) assert.ok(toegestaan.includes(g), `de app gebruikt padelData/${g}, maar de regels kennen die plek niet`);
  // plekken buiten padelData (alleen schrijven, lezen doet de server)
  const buiten = new Set([...html.matchAll(/db\.ref\('([A-Za-z]+)'\)/g)].map(m => m[1]).filter(k => k !== 'padelData'));
  for (const g of buiten) assert.ok(regels[g], `de app schrijft naar ${g}, maar de regels kennen die plek niet`);
});
