// Balk onderin (sinds 9.14, keuze van de eigenaar): alleen op telefoon en tablet (onder 1000 pixels).
// Vijf knoppen: Afwezig, BBQ, Boeken, Stand en Chat. Een knop opent het bijbehorende blok als venster
// over de pagina (boven de balk); sluiten met ✕ of nog een keer op dezelfde knop.
// De blokken zelf (inhoud, id's, database) blijven ongewijzigd; dit bestand verandert alleen wat zichtbaar is.
// Op breed scherm doet dit bestand niets: daar blijft de indeling met twee kolommen.

const TB_SMAL = window.matchMedia('(max-width: 999px)');
let tbOpenPaneel = null; // id van het open blok, of null

function tbIsSmal() {
    return TB_SMAL.matches;
}

function tbPanelen() {
    return Array.from(document.querySelectorAll('#tabBalk .tb-knop')).map(k => document.getElementById(k.dataset.paneel)).filter(Boolean);
}

// De kop die het blok normaal open- en dichtklapt (in het venster doet die niets)
function tbBovensteKop(paneel) {
    const details = paneel.querySelector(':scope > details');
    if (details) return details.querySelector(':scope > summary');
    return paneel.querySelector(':scope > .card-header');
}

function tbOpen(id) {
    if (!tbIsSmal()) return;
    if (tbOpenPaneel === id) { tbSluit(); return; }
    tbSluit(true);
    const paneel = document.getElementById(id);
    if (!paneel) return;

    // Het blok staat in het venster altijd open
    const details = paneel.querySelector(':scope > details');
    if (details && !details.open) details.open = true;
    if (id === 'baanBoekenCard') {
        const body = document.getElementById('baanBoekingenBody');
        if (body && body.style.display !== 'flex' && typeof toggleBaanBoekingMenu === 'function') toggleBaanBoekingMenu();
    }

    paneel.classList.add('tb-open');
    document.body.classList.add('tb-paneel-open');
    tbOpenPaneel = id;
    document.querySelectorAll('#tabBalk .tb-knop').forEach(k => {
        const actief = k.dataset.paneel === id;
        k.classList.toggle('actief', actief);
        k.setAttribute('aria-pressed', actief ? 'true' : 'false');
    });

    if (id === 'chatCardSection') {
        tbChatGelezen();
        const venster = document.getElementById('chatWindow');
        requestAnimationFrame(() => { if (venster) venster.scrollTop = venster.scrollHeight; });
        paneel.scrollTop = 0;
    } else {
        paneel.scrollTop = 0;
    }
    tbVensterMaat();
}

function tbSluit(stil) {
    if (!tbOpenPaneel) return;
    const paneel = document.getElementById(tbOpenPaneel);
    if (paneel) paneel.classList.remove('tb-open');
    tbOpenPaneel = null;
    document.body.classList.remove('tb-paneel-open');
    document.querySelectorAll('#tabBalk .tb-knop').forEach(k => {
        k.classList.remove('actief');
        k.setAttribute('aria-pressed', 'false');
    });
    if (!stil && document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// Chat gelezen: dezelfde markering als de oude knop "Team Chat bekijken"
function tbChatGelezen() {
    try {
        lastSeenMessageKey = messages.length ? messages[messages.length - 1].key : '';
        localStorage.setItem('padel_last_seen_key', lastSeenMessageKey);
    } catch (e) {}
    if (typeof updateAlertUI === 'function') updateAlertUI();
}

// Rood getal op de Chat-knop: volgt het getal van de oude chatknop
function tbWerkGetalBij() {
    const bron = document.getElementById('alertBadgeCount');
    const doel = document.getElementById('tbChatGetal');
    if (!bron || !doel) return;
    const n = parseInt(bron.innerText, 10) || 0;
    doel.textContent = n > 99 ? '99+' : String(n);
    doel.style.display = n > 0 ? 'block' : 'none';
}

// Stip op de BBQ-knop: dezelfde kleur als de stip naast de titel van BBQ en Borrel
function tbWerkStipBij() {
    const bron = document.getElementById('bbqStip');
    const doel = document.getElementById('tbBbqStip');
    if (!bron || !doel) return;
    doel.className = 'tb-stip ' + Array.from(bron.classList).filter(c => c !== 'bbq-stip').join(' ');
    doel.style.display = bron.style.display === 'none' ? 'none' : 'block';
}

// Met het toetsenbord in beeld: de balk weg en het venster precies zo groot als het zichtbare deel
function tbIsTypveld(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return !/^(checkbox|radio|file|button|submit|date|datetime-local|time|month|week|color|range)$/i.test(el.type || '');
}

function tbVensterMaat() {
    const vv = window.visualViewport;
    const b = document.body.style;
    if (vv && document.body.classList.contains('tb-typen')) {
        b.setProperty('--tb-top', vv.offsetTop + 'px');
        b.setProperty('--tb-vh', vv.height + 'px');
    } else {
        b.removeProperty('--tb-top');
        b.removeProperty('--tb-vh');
    }
    const balk = document.getElementById('tabBalk');
    if (balk && tbIsSmal()) document.body.style.setProperty('--tb-onder', balk.offsetHeight + 'px');
}

function tbBreedteVeranderd() {
    document.body.classList.toggle('tb-aan', tbIsSmal());
    if (!tbIsSmal()) tbSluit(true);
    tbVensterMaat();
}

function tbStart() {
    const balk = document.getElementById('tabBalk');
    if (!balk) return;

    balk.addEventListener('click', (e) => {
        const knop = e.target.closest('.tb-knop');
        if (knop) tbOpen(knop.dataset.paneel);
    });

    // In elk blok een ✕ in de kop; de kop zelf klapt in het venster niet dicht
    tbPanelen().forEach(paneel => {
        const kop = paneel.id === 'chatCardSection' ? paneel.querySelector(':scope > .card-header') : tbBovensteKop(paneel);
        if (!kop) return;
        const sluit = document.createElement('button');
        sluit.type = 'button';
        sluit.className = 'tb-sluit';
        sluit.setAttribute('aria-label', 'Sluiten');
        sluit.textContent = '✕';
        kop.appendChild(sluit);
        sluit.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); tbSluit(); });

        if (paneel.id === 'chatCardSection') return;
        paneel.addEventListener('click', (e) => {
            if (!tbIsSmal() || !paneel.classList.contains('tb-open')) return;
            if (e.target.closest('.tb-sluit')) return;
            const geklikt = e.target.closest('summary, .card-header');
            if (geklikt !== kop) return; // de blokken binnen Uitslagen en Stand klappen gewoon
            e.preventDefault();
            e.stopPropagation();
        }, true);
    });

    // De oude chatknop bovenaan (alleen nog op breed scherm verborgen aanwezig) opent op de telefoon het venster
    const origScroll = window.scrollToChat;
    window.scrollToChat = function () {
        if (tbIsSmal()) { tbOpen('chatCardSection'); return; }
        if (typeof origScroll === 'function') origScroll();
    };

    // Is de chat open, dan telt een nieuw bericht meteen als gelezen (zoals op breed scherm)
    const origAlert = window.updateAlertUI;
    if (typeof origAlert === 'function') {
        window.updateAlertUI = function () {
            if (tbOpenPaneel === 'chatCardSection' && document.visibilityState === 'visible') {
                try {
                    if (messages.length) {
                        const laatste = messages[messages.length - 1].key;
                        if (laatste !== lastSeenMessageKey) {
                            lastSeenMessageKey = laatste;
                            localStorage.setItem('padel_last_seen_key', laatste);
                        }
                    }
                } catch (e) {}
            }
            origAlert();
            tbWerkGetalBij();
        };
    }

    const badge = document.getElementById('alertBadgeCount');
    if (badge) new MutationObserver(tbWerkGetalBij).observe(badge, { childList: true, characterData: true, subtree: true, attributes: true });
    const stip = document.getElementById('bbqStip');
    if (stip) new MutationObserver(tbWerkStipBij).observe(stip, { attributes: true });
    tbWerkGetalBij();
    tbWerkStipBij();

    document.addEventListener('focusin', (e) => {
        if (!tbIsSmal() || !tbIsTypveld(e.target)) return;
        document.body.classList.add('tb-typen');
        tbVensterMaat();
    });
    document.addEventListener('focusout', () => {
        setTimeout(() => {
            if (tbIsTypveld(document.activeElement)) return;
            document.body.classList.remove('tb-typen');
            tbVensterMaat();
        }, 50);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', tbVensterMaat);
        window.visualViewport.addEventListener('scroll', tbVensterMaat);
    }

    if (TB_SMAL.addEventListener) TB_SMAL.addEventListener('change', tbBreedteVeranderd);
    else if (TB_SMAL.addListener) TB_SMAL.addListener(tbBreedteVeranderd);
    window.addEventListener('resize', tbVensterMaat);
    tbBreedteVeranderd();
}

tbStart();
