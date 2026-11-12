// offline.js — de app werkt ook zonder internet (sinds 9.04). Zie CLAUDE.md, "Zonder internet".
// 1. Zolang de app online is, bewaart dit bestand een kopie van de gegevens op het toestel (localStorage 'padel_offline'),
//    zonder foto's en bijlagen. De servicemedewerker (firebase-messaging-sw.js) bewaart de bestanden van de app zelf.
// 2. Opent iemand de app zonder internet, dan tekent offlineStart() alles uit die kopie, zonder in te loggen.
// 3. Zonder internet staat bovenin een balk en houdt offline.js wijzigingen tegen (melding in plaats van stil wachten).
// Gebruikt uit de hoofdcode: db, renderAll, renderChat, renderStatuses, toonMelding, gebruikerIsBezig en de
// variabelen met de gegevens (liveOverrides, matchResults, ...). Eigen namen beginnen met "offline".

const OFFLINE_SLEUTEL = 'padel_offline';
const OFFLINE_PADEN = {
    scheduleOverrides: 'padelData/scheduleOverrides',
    matchResults: 'padelData/matchResults',
    cyclusWinnaars: 'padelData/cyclusWinnaars',
    absence: 'padelData/absence',
    invallers: 'padelData/invallers',
    baanBoekingenList: 'padelData/baanBoekingenList',
    lastSeen: 'padelData/lastSeen',
    bbqBorrel: 'padelData/bbqBorrel',
    bbqBorrelMaand: 'padelData/settings/bbqBorrelMaand',
    pushGloballyEnabled: 'padelData/settings/pushGloballyEnabled',
    gezien: 'padelData/gezien'
};
const OFFLINE_MELDING = 'Geen internet: dit kan nu niet. Probeer het opnieuw als je weer verbinding hebt.';

let offlineKopie = null;
let offlineBewaarTimer = null;
let offlineModus = false;          // true = de app is zonder internet geopend en draait op de bewaarde kopie
let offlineVerbonden = null;       // laatste stand van Firebase (.info/connected), null = nog onbekend
let offlineVerbrokenSinds = 0;
let offlineOoitVerbonden = false;

function offlineLees() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_SLEUTEL) || 'null'); } catch (e) { return null; }
}

function offlineBewaar() {
    clearTimeout(offlineBewaarTimer);
    offlineBewaarTimer = setTimeout(() => {
        if (!offlineKopie) return;
        offlineKopie.tijd = Date.now();
        try {
            localStorage.setItem(OFFLINE_SLEUTEL, JSON.stringify(offlineKopie));
        } catch (e) {
            // Te groot voor het toestel: dan zonder chat bewaren, de rest is belangrijker
            try {
                const zonderChat = { ...offlineKopie, data: { ...offlineKopie.data, messages: [] } };
                localStorage.setItem(OFFLINE_SLEUTEL, JSON.stringify(zonderChat));
            } catch (e2) { /* niets aan te doen */ }
        }
    }, 1000);
}

// Vanuit startApp (online en ingelogd): dezelfde plekken volgen als de hoofdcode en een kopie bewaren.
// Firebase haalt elke plek maar één keer op, ook als er twee luisteraars op zitten.
function startOffline() {
    offlineKopie = offlineLees() || {};
    if (!offlineKopie.data || typeof offlineKopie.data !== 'object') offlineKopie.data = {};
    Object.entries(OFFLINE_PADEN).forEach(([naam, pad]) => {
        db.ref(pad).on('value', (snap) => { offlineKopie.data[naam] = snap.val(); offlineBewaar(); }, () => {});
    });
    db.ref('padelData/messages').limitToLast(MAX_CHAT_MESSAGES).on('value', (snap) => {
        const lijst = [];
        snap.forEach((kind) => {
            const v = kind.val();
            if (!v || typeof v !== 'object') return;
            const bericht = { key: kind.key, ...v };
            if (bericht.fileUrl) { delete bericht.fileUrl; bericht.offlineBijlage = true; }
            lijst.push(bericht);
        });
        offlineKopie.data.messages = lijst;
        offlineBewaar();
    }, () => {});
    db.ref('.info/connected').on('value', (snap) => {
        offlineVerbonden = snap.val() === true;
        if (offlineVerbonden) {
            offlineOoitVerbonden = true;
            offlineKopie.verbonden = Date.now();
            offlineBewaar();
        } else {
            offlineVerbrokenSinds = Date.now();
            setTimeout(offlineWerkBalkBij, 4500); // pas na een paar seconden zonder verbinding de balk tonen
        }
        offlineWerkBalkBij();
    });
    // Zolang er verbinding is elke minuut onthouden "tot wanneer" de gegevens kloppen
    setInterval(() => {
        if (offlineVerbonden && offlineKopie) { offlineKopie.verbonden = Date.now(); offlineBewaar(); }
    }, 60000);
}

function offlineKanStarten() {
    const k = offlineLees();
    return !!(k && k.data && k.data.scheduleOverrides !== undefined && (k.verbonden || k.tijd));
}

// De app is zonder internet geopend: alles tekenen uit de bewaarde kopie, zonder in te loggen
function offlineStart() {
    const k = offlineLees();
    if (!k || !k.data) return false;
    offlineModus = true;
    offlineKopie = k;
    const d = k.data;
    liveOverrides = d.scheduleOverrides || {};
    overridesLoaded = true;
    matchResults = d.matchResults || {};
    cyclusWinnaars = d.cyclusWinnaars || {};
    absences = d.absence || {};
    invallers = d.invallers || {};
    allLastSeen = d.lastSeen || {};
    allStatuses = {};
    const boekingen = d.baanBoekingenList || {};
    baanBoekingenList = Object.keys(boekingen).map(id => ({ id, ...boekingen[id] }))
        .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    messages = (Array.isArray(d.messages) ? d.messages : []).map(m => (m.offlineBijlage && !m.text)
        ? { ...m, text: '📎 Bijlage (zonder internet niet te zien)' } : m);
    isInitialMessageLoad = false;
    globalPushEnabled = d.pushGloballyEnabled !== false;
    const bbq = d.bbqBorrel || {};
    bbqAntwoorden = bbq.antwoorden || {};
    bbqGemeld = typeof bbq.gemeld === 'string' ? bbq.gemeld : '';
    bbqGekozen = (typeof bbq.gekozen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bbq.gekozen)) ? bbq.gekozen : '';
    bbqStartMaand = (typeof d.bbqBorrelMaand === 'string' && /^\d{4}-\d{2}$/.test(d.bbqBorrelMaand)) ? d.bbqBorrelMaand : '';
    bbqGeladen.antwoorden = true;
    bbqGeladen.maand = true;
    if (typeof uitgGezien !== 'undefined') { uitgGezien = d.gezien || {}; uitgGeladen = true; } // blok "Gewijzigd" (uitgelicht.js)

    const pin = document.getElementById('pinOverlay');
    if (pin) pin.style.display = 'none';
    try { initUserSelect(); } catch (e) {}
    try { firebaseConnected = false; updateConnectionIndicator(); } catch (e) {} // bovenin "Verbroken" in plaats van "Live verbonden"
    try { renderAll(); } catch (e) { console.warn('Offline tekenen mislukt:', e); }
    try { renderChat(); renderStatuses(); updateAlertUI(); } catch (e) {}
    offlineWerkBalkBij();

    // Is er weer internet, dan opnieuw laden: dan logt de app gewoon in en wordt alles weer live
    window.addEventListener('online', function offlineProbeerTerug() {
        const balk = document.getElementById('offlineBalk');
        if (balk) balk.textContent = '🔄 Weer verbonden: de app wordt zo opnieuw geladen.';
        // Wacht zolang iemand typt of een venster open heeft (gebruikerIsBezig), zodat er niets verloren gaat
        if (typeof gebruikerIsBezig === 'function' && gebruikerIsBezig()) { setTimeout(offlineProbeerTerug, 3000); return; }
        location.reload();
    });
    return true;
}

function offlineIsOffline() {
    if (offlineModus) return true;
    if (navigator.onLine === false) return true;
    return offlineOoitVerbonden && offlineVerbonden === false && Date.now() - offlineVerbrokenSinds > 4000;
}

function offlineTijdTekst(ms) {
    if (!ms) return 'eerder';
    const d = new Date(ms);
    const tijd = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const vandaag = new Date();
    if (d.toDateString() === vandaag.toDateString()) return `vandaag ${tijd}`;
    const gisteren = new Date(vandaag); gisteren.setDate(vandaag.getDate() - 1);
    if (d.toDateString() === gisteren.toDateString()) return `gisteren ${tijd}`;
    return `${d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })} ${tijd}`;
}

// De balk bovenin: "📴 Geen internet: je ziet de stand van vandaag 13:09."
function offlineWerkBalkBij() {
    let balk = document.getElementById('offlineBalk');
    if (offlineModus && navigator.onLine !== false && balk) return; // "Weer verbonden": de pagina laadt zo opnieuw
    if (!offlineIsOffline()) { if (balk) balk.remove(); return; }
    if (!balk) {
        balk = document.createElement('div');
        balk.id = 'offlineBalk';
        balk.setAttribute('role', 'status');
        document.body.prepend(balk);
    }
    const k = offlineKopie || offlineLees() || {};
    const moment = offlineModus ? (k.verbonden || k.tijd) : (offlineVerbrokenSinds || k.verbonden || k.tijd);
    balk.textContent = `📴 Geen internet: je ziet de stand van ${offlineTijdTekst(moment)}.`;
}

window.addEventListener('online', offlineWerkBalkBij);
window.addEventListener('offline', offlineWerkBalkBij);

// Zonder internet wijzigingen tegenhouden: een melding in plaats van een knop die blijft hangen.
// Open- en dichtklappen, de filters van Alle wedstrijden, foto's bekijken en de vensters zelf blijven werken.
function offlineMagWel(el) {
    return !!el.closest('summary, .collapsible-header, .aw-filters, #bevestigModal, #imageModal, #globalChatAlertBtn');
}

document.addEventListener('click', (e) => {
    if (!offlineIsOffline()) return;
    const doel = e.target.closest('button, [onclick]');
    if (!doel || doel.tagName === 'SELECT' || offlineMagWel(doel)) return;
    if (doel.tagName === 'IMG') return;
    e.preventDefault();
    e.stopPropagation();
    toonMelding(OFFLINE_MELDING, '📴 Geen internet');
}, true);

document.addEventListener('change', (e) => {
    if (!offlineIsOffline()) return;
    const doel = e.target;
    if (!doel || doel.tagName !== 'SELECT' || offlineMagWel(doel)) return;
    e.stopPropagation();
    try { renderAll(); initUserSelect(); } catch (err) {}
    toonMelding(OFFLINE_MELDING, '📴 Geen internet');
}, true);

document.addEventListener('keydown', (e) => {
    if (!offlineIsOffline()) return;
    if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'chatInput') {
        e.preventDefault();
        e.stopPropagation();
        toonMelding(OFFLINE_MELDING, '📴 Geen internet');
    }
}, true);
