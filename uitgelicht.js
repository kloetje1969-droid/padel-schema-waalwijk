// uitgelicht.js — blok "Gewijzigd" onder de huidige week (sinds 9.08, vervangt het rode stipje van 9.03).
// Zie CLAUDE.md, "Gewijzigde wedstrijden onder de huidige week".
// 1. Is in een wedstrijd van de vijf volgende weken iets anders dan normaal (afgelast, andere dag of tijd, andere
//    opstelling, afgemeld zonder invalvraag of regen), dan staat een kopie van die wedstrijdkaart onder de huidige week.
//    Per speler (sinds 9.09): tikt iemand op "Gezien", dan verdwijnt hij bij hem; bij wie nog niet tikte blijft hij
//    staan. Verandert er daarna weer iets, dan komt hij bij iedereen terug.
// 2. Een open invalvraag houdt de wedstrijd daar altijd, ook als iedereen hem gezien heeft. Tikt iemand op
//    "Ik kan invallen", dan is het opgelost: de wissel zelf laat de wedstrijd niet opnieuw verschijnen.
// 3. Wie wat gezien heeft staat in padelData/gezien/<wedstrijd>/<naam> = code van de wijzigingen.
// De kaart zelf maakt renderSchedule in index.html (kopie zonder sets, id's met "uitg_"); dit bestand kiest welke
// wedstrijden er staan en tekent het blok eromheen. Gebruikt uit de hoofdcode: db, currentUserName, basePlayers,
// esc, showToast, invallers, checkPlayerAbsent, invalvraagActief, matchStartMs, renderSchedule en STANDAARD_TIJD.
// Eigen namen beginnen met "uitg".

let uitgGezien = {};          // padelData/gezien
let uitgGeladen = false;
let uitgOpgeruimd = false;

// Korte, vaste code van een tekst (zelfde tekst = zelfde code op elk toestel)
function uitgCode(tekst) {
    let h = 5381;
    for (let i = 0; i < tekst.length; i++) h = ((h * 33) ^ tekst.charCodeAt(i)) >>> 0;
    return 'v' + h.toString(36);
}

function uitgLijst(v) { return Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []); }
function uitgHoofdletter(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

// Wat er in een wedstrijd anders is dan normaal. delen = voor de code (wat iedereen moet zien),
// redenen = tekst voor in het blok, open = wie er een invaller zoekt.
function uitgWijzigingen(k) {
    const delen = [];
    const redenen = [];
    const spelers = uitgLijst(k.spelers);
    const standaard = uitgLijst(k.standaard);
    const vragen = invallers[`${k.weekKey}_${k.slot}`] || {};

    if (k.afgelast) { delen.push('afgelast'); redenen.push('Afgelast'); }
    if (k.dag !== k.slot) { delen.push(`dag=${k.dag}`); redenen.push(`Andere dag: ${uitgHoofdletter(k.dag)}`); }
    if (k.tijd !== STANDAARD_TIJD) { delen.push(`tijd=${k.tijd}`); redenen.push(`Andere tijd: ${k.tijd}`); }

    // Opstelling: een invaller voor een afgemelde speler telt niet (dat regelt de invalvraag), een andere wissel wel
    const anders = [];
    standaard.forEach((std, i) => {
        const nu = spelers[i];
        if (!nu || nu === std) return;
        const vraag = vragen[std];
        if (vraag && vraag.status === 'taken' && vraag.takenBy === nu) return;
        if (checkPlayerAbsent(std, k.weekKey, k.slot) && !spelers.includes(std)) return;
        anders.push(`${nu} voor ${std}`);
    });
    if (spelers.length !== standaard.length) anders.push(spelers.join(', '));
    if (anders.length) { delen.push(`spelers=${spelers.join(',')}`); redenen.push(`Andere opstelling: ${anders.join(', ')}`); }

    const open = [];
    if (!k.afgelast) {
        spelers.forEach(n => {
            if (!checkPlayerAbsent(n, k.weekKey, k.slot)) return;
            if (invalvraagActief(k.weekKey, k.slot, n)) { open.push(n); return; }
            delen.push(`afwezig=${n}`);
            redenen.push(`Afgemeld: ${n}`);
        });
        if (k.regen) { delen.push('regen'); redenen.push('Kans op regen'); }
    }
    open.forEach(n => redenen.push(`${n} zoekt een invaller`));
    return { code: delen.length ? uitgCode(`${k.matchId}|${delen.join('|')}`) : '', redenen, open };
}

// Vanuit renderSchedule: HTML van het blok (leeg als er niets te melden is)
function uitgelichtHtml(kandidaten) {
    if (!uitgGeladen) return ''; // eerst weten wie wat gezien heeft, anders flitst het blok even op
    const ik = currentUserName;
    const ikBenSpeler = !!ik && basePlayers.includes(ik);
    const items = [];
    (kandidaten || []).forEach(k => {
        if (Date.now() > matchStartMs(k.weekKey, k.slot)) return;
        const w = uitgWijzigingen(k);
        const gezienDoor = uitgGezien[k.matchId] || {};
        const nietGezien = w.code ? basePlayers.filter(n => gezienDoor[n] !== w.code) : [];
        // Per speler: wie zelf op Gezien tikte ziet hem niet meer (behalve bij een open invalvraag).
        // Zonder gekozen naam: zolang iemand hem nog niet gezien heeft.
        const voorMij = ikBenSpeler ? nietGezien.includes(ik) : nietGezien.length > 0;
        if (!w.open.length && !voorMij) return;

        let gezienHtml = '';
        if (w.code) {
            const tekst = nietGezien.length
                ? `Nog niet gezien: ${esc(nietGezien.join(', '))}`
                : 'Iedereen heeft het gezien';
            let knop = '';
            if (ikBenSpeler && nietGezien.includes(ik)) {
                knop = `<button class="btn-gezien" onclick="uitgMarkeerGezien('${k.matchId}', '${w.code}')">👍 Gezien</button>`;
            } else if (ikBenSpeler) {
                knop = '<span class="uitg-ik">✓ Jij hebt het gezien</span>';
            }
            gezienHtml = `<div class="uitg-gezien"><span class="uitg-wie">${tekst}</span>${knop}</div>`;
        }
        const slotClass = k.slot === 'dinsdag' ? 'slot-dinsdag' : 'slot-donderdag';
        items.push(`
            <div class="uitg-item">
                <div class="uitg-kop ${slotClass}">Week ${k.weekNr} · ${uitgHoofdletter(k.slot)}</div>
                <div class="uitg-redenen">${esc(w.redenen.join(' · '))}</div>
                ${k.kaart}
                ${gezienHtml}
            </div>`);
    });
    if (!items.length) return '';
    return `
        <div class="week-card uitgelicht">
            <div class="week-header">
                <span class="week-title-text">⚠️ Gewijzigd in de komende weken</span>
            </div>
            <div class="uitg-lijst">${items.join('')}</div>
        </div>`;
}

async function uitgMarkeerGezien(matchId, code) {
    if (!currentUserName || !basePlayers.includes(currentUserName)) {
        showToast('Kies eerst je naam', 'Kies bovenin de app je eigen naam.', true);
        return;
    }
    try {
        await db.ref(`padelData/gezien/${matchId}/${currentUserName}`).set(code);
    } catch (err) {
        console.error('Gezien opslaan mislukt:', err);
        showToast('Opslaan mislukt', 'Je "gezien" kon niet worden opgeslagen. Probeer het opnieuw.', true);
    }
}

// Oude wedstrijden (meer dan een week voorbij) uit padelData/gezien halen, één keer per bezoek
function uitgRuimOp() {
    if (uitgOpgeruimd || !uitgGeladen) return;
    uitgOpgeruimd = true;
    const weg = {};
    Object.keys(uitgGezien).forEach(id => {
        const m = id.match(/^(\d{4}_w\d{1,2})_(dinsdag|donderdag)$/);
        if (!m) return;
        const start = matchStartMs(m[1], m[2]);
        if (start && Date.now() - start > 7 * 24 * 3600 * 1000) weg[id] = null;
    });
    if (Object.keys(weg).length) db.ref('padelData/gezien').update(weg).catch(() => {});
}

// Vanuit initApp (ingelogd): luisteren naar wie wat gezien heeft
function startUitgelicht() {
    try { localStorage.removeItem('padel_weken_gezien'); } catch (e) {} // van het rode stipje (tot en met 9.07)
    db.ref('padelData/gezien').on('value', (snap) => {
        uitgGezien = snap.val() || {};
        uitgGeladen = true;
        if (typeof renderSchedule === 'function') renderSchedule();
        uitgRuimOp();
    }, () => {});
}
