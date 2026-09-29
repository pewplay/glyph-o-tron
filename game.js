/*
 * Glyph-O-Tron
 * Original game (c) 2015 Nathan Blenke - js13kGames 2015 ("Reversed"), MIT License.
 * Rebuilt for PewPlay: responsive layout, pointer/touch and keyboard input,
 * Web Audio sounds, pause-aware malfunction timer, in-page dialogs.
 */
(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var STORE = 'glyph-o-tron:';
    var MIN = 0;
    var MAX = 120;
    var VIEWBOX = '-6 -6 132 132';
    var COLORS = ['DeepPink', 'LawnGreen', 'Orange', 'Yellow', 'Cyan'];
    var REAL_GLYPHS = 5;
    var MAX_FAILS = 2;
    var POINTS = 50;

    var $ = function (id) { return document.getElementById(id); };
    var stage = $('stage');
    var board = $('board');
    var glyphBox = $('glyphs');
    var cardBox = $('cards');
    var scoreEl = $('scoreVal');
    var levelEl = $('levelVal');
    var triesEl = $('tries');
    var muteBtn = $('mute');
    var modal = $('modal');
    var mTitle = $('mTitle');
    var mText = $('mText');
    var mBest = $('mBest');
    var mBtn = $('mBtn');

    var level = 1;
    var score = 0;
    var fails = 0;
    var best = 0;
    var muted = false;
    var locked = true;      // input blocked (modal / transitions)
    var cards = [];         // { el, id } id = glyph index or null for decoys
    var modalAction = null;
    var levelTimer = null;

    // ---------- storage ----------
    function load(key, def) {
        try {
            var v = localStorage.getItem(STORE + key);
            return v === null ? def : v;
        } catch (e) {
            return def;
        }
    }
    function save(key, val) {
        try {
            localStorage.setItem(STORE + key, String(val));
        } catch (e) { /* storage unavailable */ }
    }
    best = parseInt(load('best', '0'), 10) || 0;
    muted = load('muted', '0') === '1';

    // ---------- audio ----------
    var SOUNDS = ['click', 'good', 'bad', 'new'];
    var actx = null;
    var buffers = {};

    function unlockAudio() {
        if (actx) {
            if (actx.state === 'suspended') { actx.resume(); }
            return;
        }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { return; }
        try {
            actx = new AC();
        } catch (e) {
            actx = null;
            return;
        }
        SOUNDS.forEach(function (name) {
            fetch('sounds/' + name + '.wav')
                .then(function (r) { return r.arrayBuffer(); })
                .then(function (data) {
                    return new Promise(function (res, rej) {
                        actx.decodeAudioData(data, res, rej);
                    });
                })
                .then(function (buf) { buffers[name] = buf; })
                .catch(function () { /* sound simply stays silent */ });
        });
    }

    function play(name) {
        if (muted || !actx || !buffers[name]) { return; }
        if (actx.state === 'suspended') { actx.resume(); }
        var src = actx.createBufferSource();
        var gain = actx.createGain();
        gain.gain.value = 0.7;
        src.buffer = buffers[name];
        src.connect(gain);
        gain.connect(actx.destination);
        src.start();
    }

    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);

    function setMuted(m) {
        muted = m;
        muteBtn.classList.toggle('off', muted);
        muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
        save('muted', muted ? '1' : '0');
    }
    muteBtn.addEventListener('click', function () {
        setMuted(!muted);
        play('click');
        muteBtn.blur();
    });
    setMuted(muted);

    // ---------- glyph generation (original algorithm) ----------
    function ra(i, a) {
        return Math.round(Math.random() * (a - i) + i);
    }

    function randPtStr() {
        var startX = ra(MIN, MAX),
            startY = ra(MIN, MAX),
            c = ',',
            s = ' ',
            f = '',
            j,
            ptLvl = level + 2,
            ptMax = ptLvl < 10 ? ptLvl : 10;

        if (ra(0, 1)) {
            // quadratic curve path: "M x y Q cx cy,x y M ..."
            f = 'M' + ra(MIN, MAX) + s + ra(MIN, MAX) + s +
                'Q' + s + ra(MIN, MAX) + s + ra(MIN, MAX) + c +
                ra(MIN, MAX) + s + ra(MIN, MAX);
            for (j = 0; j < ra(1, ptMax); j += 1) {
                f += 'M' + ra(MIN, MAX) + s + ra(MIN, MAX) + s +
                    'Q' + s + ra(MIN, MAX) + s + ra(MIN, MAX) + c +
                    ra(MIN, MAX) + s + ra(MIN, MAX);
            }
            return f + ' Z';
        }
        // closed polyline
        f = ra(MIN, MAX) + c + ra(MIN, MAX) + s;
        for (j = 0; j < ra(2, ptMax); j += 1) {
            f += ra(MIN, MAX) + c + ra(MIN, MAX) + s;
        }
        return startX + c + startY + s + f + startX + c + startY;
    }

    function makeSvg(shape, color) {
        var sv = document.createElementNS(SVG_NS, 'svg');
        var isPath = /M/.test(shape);
        var po = document.createElementNS(SVG_NS, isPath ? 'path' : 'polyline');
        po.setAttribute(isPath ? 'd' : 'points', shape);
        po.setAttribute('stroke', color);
        sv.setAttribute('viewBox', VIEWBOX);
        sv.setAttribute('aria-hidden', 'true');
        sv.appendChild(po);
        return sv;
    }

    // ---------- round setup ----------
    function buildLevel() {
        var decoys = 4,
            list = [],
            i,
            shape,
            ci = ra(0, COLORS.length - 1),
            // single colour mode every third level after the 6th
            scm = level > 6 && level % 3 === 0;

        if (level >= 7) {
            decoys = 6;
        }

        glyphBox.textContent = '';
        cardBox.textContent = '';
        cards = [];
        fails = 0;
        updateTries();
        levelEl.textContent = level;

        // the real blueprint parts
        for (i = 0; i < REAL_GLYPHS; i += 1) {
            ci = scm ? ci : (i >= COLORS.length - 1 ? ci : i);
            shape = randPtStr();
            glyphBox.appendChild(makeSvg(shape, COLORS[ci]));
            list.push({ shape: shape, color: COLORS[ci], id: i });
        }

        // decoys mixed in at random positions
        for (i = 0; i < decoys; i += 1) {
            ci = scm ? ci : (i >= COLORS.length - 1 ? ci : i);
            list.splice(ra(0, list.length), 0, { shape: randPtStr(), color: COLORS[ci], id: null });
        }

        // the original dropped the first entry; drop the first decoy instead so every
        // part of the blueprint always has a matching card
        for (i = 0; i < list.length; i += 1) {
            if (list[i].id === null) {
                list.splice(i, 1);
                break;
            }
        }

        list.forEach(function (item, idx) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'card enter';
            btn.style.animationDelay = (idx * 35) + 'ms';
            btn.setAttribute('aria-label', 'Glyph ' + (idx + 1));
            var key = document.createElement('span');
            key.className = 'key';
            key.textContent = idx < 9 ? String(idx + 1) : '0';
            btn.appendChild(key);
            btn.appendChild(makeSvg(item.shape, item.color));
            btn.addEventListener('pointerdown', function (ev) {
                if (ev.button !== 0) { return; }
                ev.preventDefault();
                pick(idx);
            });
            btn.addEventListener('click', function (ev) {
                // keyboard activation only (pointer handled on pointerdown)
                if (ev.detail === 0) { pick(idx); }
            });
            btn.addEventListener('animationend', function () {
                btn.classList.remove('enter');
                btn.style.animationDelay = '';
            });
            cardBox.appendChild(btn);
            cards.push({ el: btn, id: item.id, done: false });
        });

        layout();
    }

    function updateTries() {
        var pips = triesEl.children;
        for (var i = 0; i < pips.length; i += 1) {
            pips[i].classList.toggle('lost', i >= MAX_FAILS - fails);
        }
    }

    function setScore(v) {
        score = v;
        scoreEl.textContent = score;
        scoreEl.classList.remove('bump');
        void scoreEl.offsetWidth;
        if (score > 0) { scoreEl.classList.add('bump'); }
        if (score > best) {
            best = score;
            save('best', best);
        }
    }

    function restartAnim(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
    }

    // ---------- picking ----------
    function pick(idx) {
        var c = cards[idx];
        if (locked || !c || c.done) { return; }
        c.done = true;
        c.el.classList.add('done', 'press');
        setTimeout(function () { c.el.classList.remove('press'); }, 120);

        if (c.id === null) {
            // wrong part
            play('bad');
            fails += 1;
            c.el.classList.add('doh');
            restartAnim(stage, 'doh');
            updateTries();
            if (fails >= MAX_FAILS) {
                gameOver();
            }
            return;
        }

        // correct part
        play('good');
        setScore(score + POINTS);
        c.el.classList.add('yay');
        var g = glyphBox.children[c.id];
        if (g) {
            g.classList.add('bye');
            setTimeout(function () { g.classList.add('gone'); }, 900);
        }

        var remaining = cards.filter(function (k) { return k.id !== null && !k.done; }).length;
        if (remaining === 0) {
            levelComplete();
        }
    }

    function levelComplete() {
        locked = true;
        play('new');
        stopMalfunction();
        stage.classList.remove('doh');
        restartAnim(stage, 'yay');
        levelTimer = setTimeout(function () {
            level += 1;
            levelTime = 0;
            stage.classList.remove('yay');
            buildLevel();
            locked = false;
        }, 1000);
    }

    function gameOver() {
        locked = true;
        stopMalfunction();
        var isBest = score > 0 && score >= best;
        if (score > best) {
            best = score;
            save('best', best);
        }
        // show the parts the player missed
        setTimeout(function () {
            cards.forEach(function (k) {
                if (k.id !== null && !k.done) { k.el.classList.add('reveal'); }
            });
        }, 500);
        setTimeout(function () {
            showModal(
                'You have failed.<br>All is lost!',
                'Score <b>' + score + '</b> &nbsp;&middot;&nbsp; Level <b>' + level + '</b>',
                isBest ? 'New best score!' : 'Best: ' + best,
                'TRY AGAIN',
                newGame
            );
        }, 1700);
    }

    function newGame() {
        clearTimeout(levelTimer);
        stopMalfunction();
        malfCool = 0;
        levelTime = 0;
        level = 1;
        fails = 0;
        setScore(0);
        stage.classList.remove('yay', 'doh');
        buildLevel();
        locked = false;
    }

    // ---------- modal ----------
    function showModal(title, text, bestText, label, action) {
        mTitle.innerHTML = title;
        mText.innerHTML = text || '';
        mBest.textContent = bestText || '';
        mBtn.textContent = label;
        modalAction = action;
        modal.classList.add('show');
        locked = true;
        setTimeout(function () {
            try { mBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }, 50);
    }

    function closeModal() {
        if (!modal.classList.contains('show')) { return; }
        modal.classList.remove('show');
        mBtn.blur();
        play('click');
        var a = modalAction;
        modalAction = null;
        if (a) { a(); } else { locked = false; }
    }
    mBtn.addEventListener('click', closeModal);

    // ---------- keyboard ----------
    window.addEventListener('keydown', function (ev) {
        if (modal.classList.contains('show')) {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                closeModal();
            }
            return;
        }
        if (/^[0-9]$/.test(ev.key)) {
            var n = ev.key === '0' ? 9 : parseInt(ev.key, 10) - 1;
            pick(n);
        } else if (ev.key === 'm' || ev.key === 'M') {
            setMuted(!muted);
        }
    });

    // ---------- "device malfunction" effects (from level 3) ----------
    var FX = ['fx-bl', 'fx-gr', 'fx-in'];
    var malfFx = null;
    var malfLeft = 0;
    var malfCool = 0;
    var levelTime = 0;
    var flickerTimers = [];
    var lastTick = performance.now();

    function setFx(on) {
        FX.forEach(function (f) { board.classList.remove(f); });
        board.classList.toggle('malf', on);
        if (on && malfFx) { board.classList.add(malfFx); }
    }

    function startMalfunction() {
        malfFx = FX[ra(0, FX.length - 1)];
        malfLeft = level > 10 ? 10000 : 5000;
        malfCool = 60000;
        setFx(true);
        flickerTimers.push(setTimeout(function () { setFx(false); }, 300));
        flickerTimers.push(setTimeout(function () { if (malfLeft > 0) { setFx(true); } }, 900));
    }

    function stopMalfunction() {
        flickerTimers.forEach(clearTimeout);
        flickerTimers = [];
        malfLeft = 0;
        malfFx = null;
        setFx(false);
    }

    function tick() {
        var now = performance.now();
        var dt = Math.min(now - lastTick, 300);
        lastTick = now;
        if (document.hidden || locked) { return; }
        levelTime += dt;
        malfCool -= dt;
        if (malfLeft > 0) {
            malfLeft -= dt;
            if (malfLeft <= 0) { stopMalfunction(); }
        } else if (level > 2 && malfCool <= 0 && levelTime > 1200) {
            startMalfunction();
        }
    }
    setInterval(tick, 100);

    document.addEventListener('visibilitychange', function () {
        lastTick = performance.now();
        if (!document.hidden && actx && actx.state === 'suspended' && !muted) {
            actx.resume();
        }
    });

    // ---------- responsive layout ----------
    function bestGrid(n, w, h, gap, options) {
        var bestFit = null;
        options.forEach(function (cols) {
            var rows = Math.ceil(n / cols);
            var cw = (w - gap * (cols - 1)) / cols;
            var ch = (h - gap * (rows - 1)) / rows;
            var fit = Math.min(cw, ch);
            if (!bestFit || fit > bestFit.fit) {
                bestFit = { cols: cols, rows: rows, cw: cw, ch: ch, fit: fit };
            }
        });
        return bestFit;
    }

    function place(el, x, y, w, h) {
        el.style.left = Math.round(x) + 'px';
        el.style.top = Math.round(y) + 'px';
        el.style.width = Math.round(w) + 'px';
        el.style.height = Math.round(h) + 'px';
    }

    function layout() {
        var W = stage.clientWidth;
        var H = stage.clientHeight;
        if (!W || !H) { return; }
        var n = cards.length || 8;
        var pad = Math.round(Math.max(8, Math.min(20, Math.min(W, H) * 0.025)));
        var gap = Math.round(Math.max(6, Math.min(14, Math.min(W, H) * 0.018)));
        var aw = W - pad * 2;
        var ah = H - pad * 2;
        var g, cw, ch, gw, gh, bx, by, bw, bh, gx, gy;

        if (aw / ah > 1.2) {
            // landscape: blueprint on the left, parts on the right
            bw = Math.min(ah * 1.08, aw * 0.56);
            bh = ah;
            var rw = aw - bw - gap;
            g = bestGrid(n, rw, ah, gap, [2, n / 2, n]);
            cw = Math.min(g.cw, g.ch * 1.5);
            ch = Math.min(g.ch, cw * 1.2);
            gw = cw * g.cols + gap * (g.cols - 1);
            gh = ch * g.rows + gap * (g.rows - 1);
            var total = bw + gap + gw;
            bx = pad + (aw - total) / 2;
            by = pad;
            gx = bx + bw + gap;
            gy = pad + (ah - gh) / 2;
        } else {
            // portrait / square: blueprint on top, parts below
            g = bestGrid(n, aw, ah * 0.45, gap, [n / 2]);
            cw = g.cw;
            ch = Math.min(g.ch, cw * 1.05);
            gw = aw;
            gh = ch * g.rows + gap * (g.rows - 1);
            // very wide cards on tablets: keep the grid compact and centred
            if (cw > ch * 1.4) {
                cw = ch * 1.4;
                gw = cw * g.cols + gap * (g.cols - 1);
            }
            bw = aw;
            bh = ah - gh - gap;
            bx = pad;
            by = pad;
            gx = pad + (aw - gw) / 2;
            gy = by + bh + gap;
        }

        place(board, bx, by, bw, bh);
        place(cardBox, gx, gy, gw, gh);
        cardBox.style.gridTemplateColumns = 'repeat(' + g.cols + ', ' + Math.floor(cw) + 'px)';
        cardBox.style.gridAutoRows = Math.floor(ch) + 'px';
        cardBox.style.setProperty('--gap', gap + 'px');

        var gsize = Math.min(bw, bh - 30) * 0.74;
        board.style.setProperty('--gsize', Math.round(gsize) + 'px');
        board.style.setProperty('--blur', (gsize / 110).toFixed(1) + 'px');
        cardBox.style.setProperty('--csize', Math.round(Math.min(cw, ch) * 0.8) + 'px');
    }

    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 150); });
    if (window.ResizeObserver) {
        new ResizeObserver(layout).observe(stage);
    }

    // no context menu / long-press menu on the game
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // ---------- start ----------
    scoreEl.textContent = '0';
    buildLevel();
    mBest.textContent = best > 0 ? 'Best: ' + best : '';
    modalAction = function () { locked = false; };

    // hook for automated screenshots / testing (read-only helpers)
    window.glyphOTron = {
        state: function () {
            return { level: level, score: score, fails: fails, locked: locked };
        },
        answers: function () {
            return cards.map(function (k, i) { return k.id !== null ? i : -1; })
                .filter(function (i) { return i >= 0; });
        }
    };
}());
