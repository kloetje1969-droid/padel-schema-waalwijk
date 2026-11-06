    // ---------- Foutenlog: fouten op telefoons worden vastgelegd, zodat Robert ze kan zien ----------
    const foutWachtrij = [];
    const foutGezien = new Set();
    let foutAantalDezeSessie = 0;
    let foutAanHetVersturen = false;

    function foutKort(t, n) { return String(t == null ? '' : t).slice(0, n); }

    function legFoutVast(bericht, bron, regel, stack) {
        try {
            const b = foutKort(bericht, 300);
            if (!b) return;
            // Onschuldig bericht van de browser over het opnieuw meten van blokken, geen echte fout
            if (/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(b)) return;
            const sleutel = b + '|' + foutKort(bron, 80) + '|' + regel;
            if (foutGezien.has(sleutel) || foutAantalDezeSessie >= 10) return;
            foutGezien.add(sleutel);
            foutAantalDezeSessie++;
            foutWachtrij.push({ tijd: Date.now(), bericht: b, bron: foutKort(bron, 200), regel: Number(regel) || 0, stack: foutKort(stack, 800), apparaat: foutKort(navigator.userAgent, 120) });
            stuurFoutWachtrij();
        } catch (e) { /* de foutenlog zelf mag nooit iets stukmaken */ }
    }

    function stuurFoutWachtrij() {
        try {
            if (foutAanHetVersturen || !foutWachtrij.length) return;
            if (typeof db === 'undefined' || typeof firebase === 'undefined' || !firebase.auth().currentUser) return;
            const item = foutWachtrij.shift();
            try { item.gebruiker = foutKort(currentUserName || '', 30); } catch (e) { item.gebruiker = ''; }
            try { item.versie = foutKort(APP_VERSION, 20); } catch (e) { item.versie = ''; }
            foutAanHetVersturen = true;
            db.ref('padelData/foutlog').push(item).catch(() => {}).then(() => {
                foutAanHetVersturen = false;
                if (foutWachtrij.length) stuurFoutWachtrij();
            });
        } catch (e) { foutAanHetVersturen = false; }
    }

    window.addEventListener('error', (e) => legFoutVast(e.message, e.filename, e.lineno, e.error && e.error.stack));
    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        legFoutVast(r && r.message ? r.message : r, '', 0, r && r.stack);
    });
    const _origineleConsoleError = console.error.bind(console);
    console.error = function (...args) {
        _origineleConsoleError(...args);
        try {
            const eerste = args[0];
            const fout = args.find(x => x && x.message);
            const tekst = foutKort(typeof eerste === 'string' ? eerste : (eerste && eerste.message) || '', 200) + (fout && fout !== eerste ? ' | ' + foutKort(fout.message, 100) : '');
            legFoutVast(tekst, 'console.error', 0, fout && fout.stack);
        } catch (e) { /* niets doen */ }
    };
    setInterval(stuurFoutWachtrij, 5000);
