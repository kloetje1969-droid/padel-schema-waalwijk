// Controle van de telregels en het schema (padel-regels.js). Draait met: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

await import('./padel-regels.js');
const R = globalThis.PadelRegels;

const resultaat = (spelers, s1, s2, s3 = [0, 0]) => ({
  players: spelers, t1s1: s1[0], t2s1: s1[1], t1s2: s2[0], t2s2: s2[1], t1s3: s3[0], t2s3: s3[1]
});

test('de zes vaste spelers', () => {
  assert.deepEqual([...R.BASE_PLAYERS].sort(), ['Dennis', 'Marcel', 'Mark', 'Robert', 'Ronald', 'Sander']);
});

test('het schema heeft 6 weken en elke wedstrijd vier verschillende vaste spelers', () => {
  assert.equal(R.DEFAULT_TEMPLATE.length, 6);
  for (const week of R.DEFAULT_TEMPLATE) {
    for (const slot of ['dinsdag', 'donderdag']) {
      assert.equal(week[slot].length, 4);
      assert.equal(new Set(week[slot]).size, 4);
      for (const n of week[slot]) assert.ok(R.BASE_PLAYERS.includes(n), `${n} is geen vaste speler`);
    }
  }
});

test('in 6 weken speelt iedereen even vaak', () => {
  const tel = Object.fromEntries(R.BASE_PLAYERS.map(p => [p, 0]));
  for (const week of R.DEFAULT_TEMPLATE) for (const slot of ['dinsdag', 'donderdag']) for (const n of week[slot]) tel[n]++;
  assert.equal(new Set(Object.values(tel)).size, 1, JSON.stringify(tel));
});

test('week en cyclus kloppen, ook over de jaarwisseling (2026 heeft een week 53)', () => {
  const info = (y, m, d) => R.weekInfoVanDatum(y, m, d);
  assert.deepEqual(info(2026, 9, 21), { key: '2026_w39', weekNum: 39, cyclus: 0, templateIndex: 0 });
  assert.deepEqual(info(2026, 11, 2), { key: '2026_w45', weekNum: 45, cyclus: 1, templateIndex: 0 });
  assert.deepEqual(info(2026, 11, 5), { key: '2026_w45', weekNum: 45, cyclus: 1, templateIndex: 0 }); // donderdag, zelfde week
  assert.deepEqual(info(2026, 12, 13), { key: '2026_w50', weekNum: 50, cyclus: 1, templateIndex: 5 }); // zondag: nog cyclus 2
  assert.deepEqual(info(2026, 12, 14), { key: '2026_w51', weekNum: 51, cyclus: 2, templateIndex: 0 });
  assert.deepEqual(info(2026, 12, 28), { key: '2026_w53', weekNum: 53, cyclus: 2, templateIndex: 2 });
  assert.deepEqual(info(2027, 1, 4), { key: '2027_w1', weekNum: 1, cyclus: 2, templateIndex: 3 });
  assert.deepEqual(info(2027, 1, 24), { key: '2027_w3', weekNum: 3, cyclus: 2, templateIndex: 5 });
  assert.deepEqual(info(2027, 1, 25), { key: '2027_w4', weekNum: 4, cyclus: 3, templateIndex: 0 });
});

test('een wedstrijd-id wordt goed gelezen (met en zonder voorloopnul)', () => {
  assert.deepEqual(R.leesMatchId('2026_w45_dinsdag'), { slot: 'dinsdag', diffWeeks: 6, cyclus: 1, templateIndex: 0 });
  assert.deepEqual(R.leesMatchId('2026_w53_dinsdag'), { slot: 'dinsdag', diffWeeks: 14, cyclus: 2, templateIndex: 2 });
  assert.deepEqual(R.leesMatchId('2027_w1_donderdag'), R.leesMatchId('2027_w01_donderdag'));
  assert.equal(R.leesMatchId('rommel'), null);
});

test('telling: games tellen alleen op de eigen plek, een wedstrijd telt voor elke vaste speler die meedoet', () => {
  const uitslagen = {
    '2026_w45_dinsdag': resultaat(['Sander', 'Dennis', 'Mark', 'Robert'], [6, 1], [6, 2], [2, 3]),
    // donderdag: Mark valt in voor Marcel en Dennis voor Ronald (standaard: Marcel, Ronald, Sander, Robert)
    '2026_w45_donderdag': resultaat(['Mark', 'Dennis', 'Sander', 'Robert'], [6, 4], [3, 6], [6, 2])
  };
  const t = R.berekenTellingen(uitslagen, 1);
  assert.deepEqual(t.gameCounts, { Marcel: 0, Mark: 6, Ronald: 0, Sander: 26, Dennis: 14, Robert: 18 });
  assert.deepEqual(t.matchCounts, { Marcel: 0, Mark: 2, Ronald: 0, Sander: 2, Dennis: 2, Robert: 2 });
});

test('telling: een invaller die geen vaste speler is, telt nergens mee', () => {
  const uitslagen = { '2026_w45_dinsdag': resultaat(['Sander', 'Dennis', 'Gast', 'Robert'], [6, 1], [6, 2]) };
  const t = R.berekenTellingen(uitslagen, 1);
  assert.equal(t.gameCounts.Gast, undefined);
  assert.equal(t.matchCounts.Gast, undefined);
  assert.equal(t.matchCounts.Sander, 1);
});

test('telling: uitslagen van een andere cyclus tellen niet mee', () => {
  const uitslagen = { '2026_w45_dinsdag': resultaat(['Sander', 'Dennis', 'Mark', 'Robert'], [6, 1], [6, 2]) };
  const t = R.berekenTellingen(uitslagen, 2);
  assert.equal(Object.values(t.gameCounts).reduce((a, b) => a + b, 0), 0);
});

test('cyclus compleet: pas als alle niet-afgelaste wedstrijden een uitslag hebben', () => {
  // cyclus 2 (index 1) loopt van week 45 t/m week 50 (2026): 12 wedstrijden
  const sleutels = ['2026_w45', '2026_w46', '2026_w47', '2026_w48', '2026_w49', '2026_w50'];
  const alles = {};
  for (const k of sleutels) for (const s of ['dinsdag', 'donderdag']) alles[`${k}_${s}`] = resultaat(['Sander', 'Dennis', 'Mark', 'Robert'], [6, 1], [6, 1]);
  assert.equal(R.isCyclusVolledigIngevuld(1, alles, {}), true);
  const mist = { ...alles }; delete mist['2026_w50_donderdag'];
  assert.equal(R.isCyclusVolledigIngevuld(1, mist, {}), false);
  assert.equal(R.isCyclusVolledigIngevuld(1, mist, { '2026_w50': { donderdag: { cancelled: true, players: [] } } }), true, 'afgelaste wedstrijd telt niet mee');
  assert.equal(R.isCyclusVolledigIngevuld(1, mist, {}, '2026_w50_donderdag'), true, 'de uitslag die net wordt opgeslagen telt mee');
  assert.equal(R.isCyclusVolledigIngevuld(1, {}, {}), false);
});

test('podium: gelijke stand deelt de plaats en zonder games is er geen podium', () => {
  const games = { Marcel: 10, Mark: 20, Ronald: 20, Sander: 5, Dennis: 5, Robert: 0 };
  const wedstr = { Marcel: 2, Mark: 3, Ronald: 3, Sander: 1, Dennis: 1, Robert: 0 };
  const p = R.bouwPodium(games, wedstr);
  assert.deepEqual(p.first.sort(), ['Mark', 'Ronald']);
  assert.deepEqual(p.second, ['Marcel']);
  assert.deepEqual(p.third.sort(), ['Dennis', 'Sander']);
  assert.equal(p.maxGames, 20);
  assert.match(p.regels[0], /1e plaats/);
  assert.equal(R.bouwPodium({}, {}), null);
});

test('de wachttijd voor het podium (30 minuten) en het vangnet (3 dagen)', () => {
  assert.equal(R.WACHTTIJD_MS, 30 * 60 * 1000);
  assert.equal(R.VANGNET_MS, 3 * 24 * 60 * 60 * 1000);
});
