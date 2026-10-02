/* The data cartridge: one tape in 3D (a frosted QIC-style cartridge you drag to turn, its spools wound
   by the session's length) and the deck that plays it, alt/5's screen, tape, keys and speed knob,
   all reading one tape position. Shared by tapes-cartridge-02.html and landing.html; the markup is in
   each page. Needs cart3d.js (the models), window.THREE (assets/vendor/three.min.js) and window.parseTape (../shared/parse-tape.js).
   Options, on the #stage element:
     data-demo="orbit-watch"   the tape it starts with (default: the first demo)
     data-keys="deck"          keyboard only while focus is in the deck (default: page-wide)
     data-fit="tight"          frame the cartridge's face, not its full turn, so it reads bigger */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), cv = $('cv'), playBtn = $('playBtn');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // [id, title, lines, size, label colour, session length in seconds, as the player measures it (alt/shared/parse-tape.js)]
  const DEMOS = [
    ['platform-game', 'Retro platformer game', 487, '1.5MB', '--orange', 9302],
    ['crush-game', 'Match-3 phone game', 520, '6.8MB', '--c-write', 2289],
    ['git-visor', 'Git archaeology visualizer', 692, '4.7MB', '--c-bash', 1929],
    ['marginalia-links', 'Link library & feed reader', 875, '1.4MB', '--c-read', 1962],
    ['orbit-watch', 'Real-time ISS tracker', 982, '5.9MB', '--c-text', 2922],
  ];
  const C3 = window.VCRCart3D;
  const SHUTTLE_MS = 3500;                      // end to end while REW / FF is held
  const SPEEDS = [1, 4, 10, 30, 60, 120];        // the knob's detents, as on alt/5
  let speedIdx = 3;                              // 30×
  const speed = () => SPEEDS[speedIdx];
  const fmtDur = C3.fmtDur;
  const fmtTC = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60, p = (n) => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : p(m)) + ':' + p(s); };

  // the demo shelf: small flat cartridges, rewound (all tape on the left spool), as in the big one (cart3d.js draws them)
  const picker = $('picker');   // optional (tapes-cartridge-02.html has one, the landing hero doesn't)
  if (picker) picker.innerHTML = DEMOS.map(([id, name, lines, , c, sec], i) =>
    C3.miniCart({ name, sec, c: 'var(' + c + ')', foot: [id + '.jsonl', lines + ' lines'], attrs: 'data-i="' + i + '"' })).join('');

  const T = window.THREE;
  let renderer = null;
  try { renderer = T && new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { renderer = null; }
  if (!renderer) stage.classList.add('no-gl');

  // ---------------------------------------------------------------- tape state
  // played: share of the session on the right spool. It is the one source of truth: the spools, the screen and
  // the tape all read it. shuttle: -1 rewinding, +1 fast-forwarding. coast: tape inertia, in played per ms.
  const S = { i: 0, played: 0, playing: false, shuttle: 0, coast: 0, dragging: false, skip: false, last: 0, D: null, active: -2 };
  const sec = () => DEMOS[S.i][5];
  const DUR = () => (S.D ? S.D.DUR : sec() * 1000);
  const tNow = () => S.played * DUR();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const scr = $('scr'), scrMain = $('scrMain');
  function select(i) {
    S.i = i; S.played = 0; S.D = null; S.active = -2; S.shuttle = 0; S.coast = 0; setPlaying(false);
    const [id, , , , c] = DEMOS[i];
    document.documentElement.style.setProperty('--c', 'var(' + c + ')');
    if (picker) [...picker.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    if ($('go')) $('go').href = 'player.html?demo=' + id;   // the out-to-player key: not every page has one
    if (R) R.load(i);
    loadEvents(i);
  }
  function setPlaying(on) {
    S.playing = on; playBtn.classList.toggle('on', on); scr.classList.toggle('playing', on); document.querySelector('.deck').classList.toggle('playing', on);
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  }
  function seek(p) { S.played = clamp(p, 0, 1); }

  /* ---------------------------------------------------------------- alt/5's screen and tape
     Ported from alt/5/deck.js: the program screen (event, run line, dot-matrix output-token spectrum,
     session strip) and the tape you drag (sprockets, ruler, event lanes, inertia). Here they read and
     write S.played, so dragging the tape also turns the cartridge's spools. */
  const COL = { // canvas colours: the screen and tape are always dark hardware
    prompt: '#FF5B1F', text: '#5A86FF', tool: '#C6F432', thinking: '#8C8880', err: '#FF2E3A',
    ink: '#EFEDE6', dim: '#34322F', off: '#1A1A1B', tape: '#121212', leader: '#0A0A0A',
    sprocket: '#262626', rule: '#3A3835', label: '#77736B',
  };
  const BMS = 6000; // 6-second buckets for the spectrum
  const KIND_BY_P = [null, COL.thinking, COL.text, COL.tool, COL.prompt, COL.err];
  const ZOOMS = [2, 4, 10, 24, 60, 150]; // tape px per second
  let zoomIdx = 2;
  const ppm = () => ZOOMS[zoomIdx] / 1000; // px per ms
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function fmtClock(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + ':' + pad(m) + ':' + pad(s % 60) : pad(m) + ':' + pad(s % 60); }
  function fmtMs(ms) { if (ms == null) return '—'; if (ms < 1000) return Math.round(ms) + 'ms'; if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'; return Math.floor(ms / 60000) + 'm' + pad(Math.round((ms % 60000) / 1000)) + 's'; }
  const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function lastLE(arr, t) { let lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }

  function derive(tape) {
    const EV = tape.events, RS = tape.responses || [], DUR = Math.max(1, tape.duration), N = EV.length, NB = Math.ceil(DUR / BMS) + 1;
    EV.forEach((e, i) => { if (e.kind === 'thinking') { const nx = EV[i + 1]; e.span = nx ? nx.t - e.t : 0; } });
    const bOut = new Float32Array(NB), bKind = new Uint8Array(NB); // kind: 0 none, 1 think, 2 text, 3 tool, 4 prompt, 5 err
    for (const r of RS) bOut[Math.min(NB - 1, Math.floor(r.t / BMS))] += r.out;
    for (const e of EV) {
      const k = Math.min(NB - 1, Math.floor(e.t / BMS)), p = e.err ? 5 : e.kind === 'prompt' ? 4 : e.kind === 'tool' ? 3 : e.kind === 'text' ? 2 : 1;
      if (p > bKind[k]) bKind[k] = p;
    }
    let bMax = 1; for (let k = 0; k < NB; k++) bMax = Math.max(bMax, bOut[k]);
    return { EV, DUR, N, NB, bOut, bKind, bMaxLog: Math.log1p(bMax) };
  }
  async function loadEvents(i) {
    const id = DEMOS[i][0];
    try {
      const r = await fetch('../../tapes/' + id + '.jsonl');
      if (!r.ok) throw new Error(r.status);
      const tape = window.parseTape(await r.text(), id + '.jsonl'), D = derive(tape);
      D.tape = tape;   // the whole tape, for the page around the deck (the landing's "What's on the tape")
      if (S.i === i) { S.D = D; S.active = -2; }
    } catch (e) { if (S.i === i) { S.D = null; S.active = -2; } }
  }

  // ---------- canvases
  const mk = (el) => ({ el, ctx: el.getContext('2d'), w: 0, h: 0, dpr: 1 });
  const VIZ = mk($('viz')), TP = mk($('tape'));
  function sizeCanvas(c) {
    const r = c.el.getBoundingClientRect(), dpr = Math.min(2.5, devicePixelRatio || 1);
    c.w = r.width; c.h = r.height; c.dpr = dpr;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (c.el.width !== W || c.el.height !== H) { c.el.width = W; c.el.height = H; }
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(() => { sizeCanvas(VIZ); sizeCanvas(TP); }).observe($('scr'));
  new ResizeObserver(() => sizeCanvas(TP)).observe(TP.el);

  // Where the playhead sits on the tape and the spectrum: flush left at the start, then held at 30% while the
  // tape scrolls under it, then let go so the session's end meets the right edge. No empty leader at either end.
  // (It used to sit fixed in the middle, which left half the tape blank at 0:00.)  k: px per ms.
  const HEAD = 0.3, PAD = 6;
  function headX(w, k, t, d) {
    const start = PAD + t * k, end = w - PAD - (d - t) * k;
    if (d * k <= w - 2 * PAD) return start;   // the whole session fits: nothing to scroll
    return Math.max(Math.min(w * HEAD, start), end);
  }
  // dot-matrix output-token spectrum, scrolling past the playhead
  function drawViz(t) {
    const { ctx, w, h } = VIZ, D = S.D;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const P = w < 520 ? 6 : 7, DS = P - 2, rows = Math.max(4, Math.floor(h / P)), lvRows = rows - 2, cx = headX(w, P / BMS, t, DUR());
    const tb = t / BMS, kc = Math.floor(tb), kFrom = Math.floor(tb - cx / P) - 1, kTo = Math.ceil(tb + (w - cx) / P) + 1;
    const pOff = new Path2D(), pPast = new Path2D(), pPeak = new Path2D(), pCur = new Path2D(), pFut = new Path2D(), kindPaths = {};
    const yOff = h - rows * P;
    for (let k = kFrom; k <= kTo; k++) {
      const x = Math.round(cx + (k - tb) * P);
      if (x < -P || x > w) continue;
      const inside = D && k >= 0 && k < D.NB;
      if (!inside) continue;
      const v = D.bOut[k], lit = v > 0 ? Math.max(1, Math.round((Math.log1p(v) / D.bMaxLog) * lvRows)) : 0, past = k < kc, cur = k === kc;
      for (let r = 0; r < lvRows; r++) {
        const y = yOff + (lvRows - 1 - r) * P;
        if (r < lit) { if (cur) pCur.rect(x, y, DS, DS); else if (past) (r === lit - 1 ? pPeak : pPast).rect(x, y, DS, DS); else pFut.rect(x, y, DS, DS); }
        else pOff.rect(x, y, DS, DS);
      }
      const kp = D.bKind[k], y = yOff + (rows - 1) * P;
      if (kp) { const key = (k <= kc ? 'a' : 'f') + kp; (kindPaths[key] || (kindPaths[key] = new Path2D())).rect(x, y, DS, DS); }
      else pOff.rect(x, y, DS, DS);
    }
    ctx.fillStyle = COL.off; ctx.fill(pOff);
    ctx.fillStyle = COL.dim; ctx.fill(pFut);
    ctx.fillStyle = COL.ink; ctx.fill(pPast);
    ctx.fillStyle = '#FF9A6B'; ctx.fill(pPeak);
    ctx.fillStyle = COL.prompt; ctx.fill(pCur);
    for (const key in kindPaths) { ctx.globalAlpha = key[0] === 'a' ? 1 : 0.3; ctx.fillStyle = KIND_BY_P[+key.slice(1)]; ctx.fill(kindPaths[key]); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,91,31,.55)';
    ctx.fillRect(Math.round(cx + (kc - tb) * P) + DS + 0.5, yOff, 1, rows * P);
    if (vizHover) {                                              // the column under the pointer
      const hk = vizCol(vizHover.x), hx = Math.round(cx + (hk - tb) * P);
      ctx.strokeStyle = 'rgba(239,237,230,.7)'; ctx.lineWidth = 1; ctx.strokeRect(hx - 1.5, yOff - 1.5, DS + 3, rows * P + 1);
    }
    // what the dots are: a caption on the off dots, top left
    ctx.font = '700 8.5px "JetBrains Mono", ui-monospace, monospace'; ctx.textBaseline = 'top';
    const cap = 'OUTPUT TOKENS · 6 S PER COLUMN', cw = ctx.measureText(cap).width;
    ctx.fillStyle = 'rgba(14,14,15,.85)'; ctx.fillRect(0, 0, cw + 8, 13);
    ctx.fillStyle = COL.label; ctx.fillText(cap, 3, 2.5);
  }
  // the spectrum column (6 s bucket) under an x on the canvas, with the same geometry drawViz uses
  let vizHover = null;
  function vizCol(x) { const P = VIZ.w < 520 ? 6 : 7, cx = headX(VIZ.w, P / BMS, tNow(), DUR()); return Math.floor(tNow() / BMS + (x - cx) / P + 0.15); }
  const KLAB = { prompt: 'prompt', text: 'reply', thinking: 'thinking' };
  function updVizTip() {
    const tip = $('vizTip'), D = S.D;
    if (!vizHover || !D) { tip.hidden = true; return; }
    const k = vizCol(vizHover.x);
    if (k < 0 || k >= D.NB) { tip.hidden = true; return; }
    const t0 = k * BMS, t1 = t0 + BMS, kinds = new Map();
    for (let i = lastLE(D.EV, t0 - 1) + 1; i < D.N && D.EV[i].t < t1; i++) {
      const e = D.EV[i], name = e.kind === 'tool' ? e.tool + (e.err ? ' error' : '') : KLAB[e.kind];
      const col = e.err ? COL.err : COL[e.kind] || COL.thinking, cur = kinds.get(name);
      kinds.set(name, { n: cur ? cur.n + 1 : 1, col });
    }
    const tok = Math.round(D.bOut[k]);
    tip.innerHTML = '<b>' + fmtClock(t0) + '–' + fmtClock(t1) + '</b>' + (tok ? tok.toLocaleString() + ' output tokens' : 'no output') + '<br>' +
      (kinds.size ? [...kinds].map(([n, v]) => '<span class="k" style="--kc:' + v.col + '"><i></i>' + n + (v.n > 1 ? ' ×' + v.n : '') + '</span>').join('') : '<span class="k">idle</span>');
    const r = VIZ.el, x = clamp(vizHover.x, 90, VIZ.w - 90);
    tip.style.left = (r.offsetLeft + x) + 'px'; tip.style.top = r.offsetTop + 'px';
    tip.hidden = false;
  }
  VIZ.el.addEventListener('pointermove', (e) => { const r = VIZ.el.getBoundingClientRect(); vizHover = { x: e.clientX - r.left }; updVizTip(); });
  VIZ.el.addEventListener('pointerleave', () => { vizHover = null; updVizTip(); });


  // the tape you drag
  let tapeCx = 0;
  const playheadEl = document.querySelector('.d5-playhead');
  const RULE_STEPS = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000];
  function drawTape(t) {
    const { ctx, w, h } = TP, D = S.D, dur = DUR();
    if (!w) return;
    const k = ppm(), cx = headX(w, k, t, dur), t0 = t - cx / k, t1 = t + (w - cx) / k, X = (tt) => cx + (tt - t) * k;
    tapeCx = cx; if (playheadEl) playheadEl.style.left = cx + 'px';   // the orange head follows
    ctx.fillStyle = COL.tape; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COL.leader;                                  // leader before the start and after the end
    if (t0 < 0) ctx.fillRect(0, 0, X(0), h);
    if (t1 > dur) ctx.fillRect(X(dur), 0, w - X(dur), h);
    const SP = 16, phase = ((t * k) % SP + SP) % SP;               // sprocket holes travel with the tape
    ctx.fillStyle = COL.sprocket;
    for (let x = cx - phase - Math.ceil(cx / SP) * SP; x < w + SP; x += SP) { ctx.fillRect(x, 3, 7, 4); ctx.fillRect(x, h - 7, 7, 4); }
    let minor = RULE_STEPS[RULE_STEPS.length - 1], major = minor;
    for (const s of RULE_STEPS) if (s * k >= 7) { minor = s; break; }
    for (const s of RULE_STEPS) if (s * k >= 76 && s % minor === 0) { major = s; break; }
    ctx.fillStyle = COL.rule;
    const a = Math.max(0, Math.floor(t0 / minor) * minor), b = Math.min(dur, t1);
    for (let tt = a; tt <= b; tt += minor) ctx.fillRect(Math.round(X(tt)), 10, 1, tt % major === 0 ? 9 : 4);
    ctx.fillStyle = COL.label; ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace'; ctx.textBaseline = 'top';
    for (let tt = Math.max(0, Math.floor(t0 / major) * major); tt <= b; tt += major) ctx.fillText(fmtClock(tt), Math.round(X(tt)) + 3, 12);
    if (!D) {
      ctx.fillStyle = COL.label; ctx.textBaseline = 'middle'; ctx.font = '700 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(location.protocol === 'file:' ? 'NO SIGNAL · SERVE OVER HTTP TO READ THE TAPE' : 'READING THE TAPE…', cx + 12, h / 2 + 6);
      return;
    }
    const top = 27, bot = h - 11, laneH = bot - top, hText = Math.round(laneH * 0.3);
    const yText = top, yTool = top + hText + 3, hTool = Math.round(laneH * 0.42), yThink = yTool + hTool + 3, hThink = Math.max(3, bot - yThink);
    ctx.textBaseline = 'middle'; ctx.font = '700 9px "JetBrains Mono", ui-monospace, monospace';
    for (let i = Math.max(0, lastLE(D.EV, t0 - 180000)); i < D.N; i++) {
      const e = D.EV[i];
      if (e.t > t1) break;
      const x = X(e.t);
      if (e.kind === 'tool') {
        const ww = Math.max(3, (e.dur || 0) * k);
        if (x + ww < 0) continue;
        ctx.fillStyle = e.err ? COL.err : COL.tool; ctx.fillRect(x, yTool, ww, hTool);
        if (ww > 44) { ctx.fillStyle = '#111'; ctx.fillText(e.tool.toUpperCase(), x + 4, yTool + hTool / 2 + 0.5); }
      } else if (e.kind === 'text') { ctx.fillStyle = COL.text; ctx.fillRect(x, yText, 3, hText); }
      else if (e.kind === 'prompt') {
        ctx.fillStyle = COL.prompt; ctx.fillRect(x, top - 4, 4, laneH + 4); ctx.fillRect(x, top - 4, 34, 11);
        ctx.fillStyle = '#111'; ctx.fillText('YOU', x + 5, top + 1.5);
      } else { ctx.fillStyle = COL.thinking; ctx.fillRect(x, yThink, Math.max(2, Math.min(e.span || 0, 60000) * k), hThink); }
    }
    ctx.fillStyle = 'rgba(18,18,18,.5)'; ctx.fillRect(cx, top - 4, w - cx, laneH + 4);   // the future is dimmer than the past
  }

  // ---------- the program screen
  function eventTitle(e) { return e.kind === 'prompt' ? 'You' : e.kind === 'text' ? 'Claude' : e.kind === 'thinking' ? 'Thinking' : e.tool + (e.err ? ' · error' : ''); }
  function updScreen(i, animate) {
    const D = S.D, scrTitle = $('scrTitle'), scrBody = $('scrBody');
    if (!D) {
      scr.dataset.kind = 'none'; scr.dataset.err = '0';
      $('scrKind').textContent = 'NO TAPE'; $('scrIdx').textContent = '---/---';
      scrTitle.textContent = location.protocol === 'file:' ? 'No signal' : 'Reading the tape…';
      scrBody.className = 'd5-body'; scrBody.textContent = location.protocol === 'file:' ? 'Serve this page over http to read the tape.' : '';
      return;
    }
    const e = D.EV[i];
    scr.dataset.kind = e.kind; scr.dataset.err = e.err ? '1' : '0';
    $('scrKind').textContent = e.kind === 'tool' ? 'TOOL' : e.kind === 'thinking' ? 'THINK' : e.kind === 'text' ? 'TEXT' : 'PROMPT';
    $('scrIdx').textContent = pad(i + 1, 3) + '/' + D.N;
    scrTitle.textContent = eventTitle(e);
    if (e.kind === 'tool' || e.kind === 'thinking') { const d = document.createElement('span'); d.className = 'dur'; d.textContent = fmtMs(e.kind === 'tool' ? e.dur : e.span); scrTitle.appendChild(d); }
    scrBody.className = 'd5-body' + (e.kind === 'tool' ? ' mono' : '');
    if (e.kind === 'thinking') scrBody.innerHTML = '<span class="dim">reasoning</span> <span class="think-dots"><i></i><i></i><i></i></span>';
    else if (e.kind === 'tool') scrBody.textContent = (e.tool === 'Bash' ? '$ ' : '') + oneLine(e.input);
    else scrBody.textContent = oneLine(e.text) || '…';
    if (animate && !reduce) { scrMain.classList.remove('swap'); void scrMain.offsetWidth; scrMain.classList.add('swap'); }
  }
  let lastClock = -1, lastState = '';
  function renderDeck() {
    const t = tNow(), D = S.D;
    const a = D ? Math.max(0, lastLE(D.EV, t)) : -1;
    if (a !== S.active) { const prev = S.active; S.active = a; updScreen(a, prev >= 0); }
    if (D) {                                                     // run line: how far into this event's span
      const e = D.EV[a], len = e.kind === 'tool' ? e.dur : e.kind === 'thinking' ? e.span : 0;
      $('scrRun').style.transform = 'scaleX(' + (len ? clamp((t - e.t) / len, 0, 1) : 1) + ')';
    }
    const s = Math.floor(t / 1000);
    if (s !== lastClock) {
      lastClock = s; $('scrClock').textContent = fmtClock(t); $('scrTotal').textContent = '/' + fmtClock(DUR());
      TP.el.setAttribute('aria-valuenow', Math.round(S.played * 100)); TP.el.setAttribute('aria-valuetext', fmtClock(t));
    }
    // speed: the knob's, or how many session seconds pass per real second while shuttling
    const x = (ms) => Math.round(DUR() / ms) + '×';
    const st = S.shuttle < 0 ? '◀◀ ' + x(SHUTTLE_MS) : S.shuttle > 0 ? '▶▶ ' + x(SHUTTLE_MS) : S.played >= 1 && !S.playing ? 'END' : speed() + '×';
    if (st !== lastState) { lastState = st; $('scrState').textContent = st; }
    drawViz(t); drawTape(t);
    if (vizHover) updVizTip();
  }

  // ---------- the tape: drag with inertia, tap to seek (snapping to a nearby event), wheel to scroll
  (function tapeInput() {
    const el = TP.el;
    let x0 = 0, lastX = 0, moved = false, samples = [], pid = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      pid = e.pointerId; el.setPointerCapture(pid);
      S.dragging = true; moved = false; S.coast = 0; S.shuttle = 0;
      x0 = lastX = e.clientX; samples = [{ x: e.clientX, t: performance.now() }];
      el.classList.add('grabbing');
    });
    el.addEventListener('pointermove', (e) => {
      if (!S.dragging || e.pointerId !== pid) return;
      const dx = e.clientX - lastX; lastX = e.clientX;
      if (Math.abs(e.clientX - x0) > 4) moved = true;
      if (dx) seek(S.played - dx / ppm() / DUR());
      const now = performance.now();
      samples.push({ x: e.clientX, t: now });
      while (samples.length > 2 && now - samples[0].t > 90) samples.shift();
    });
    const end = (e, cancel) => {
      if (!S.dragging || e.pointerId !== pid) return;
      S.dragging = false; pid = null; el.classList.remove('grabbing');
      if (!moved && !cancel) {
        const r = el.getBoundingClientRect(), tt = tNow() + (e.clientX - r.left - tapeCx) / ppm(), snap = 10 / ppm();
        let best = -1, bd = Infinity;
        // snap only to an event within reach (the search starts at the last event before it, which can be far back)
        if (S.D) for (let i = Math.max(0, lastLE(S.D.EV, tt - snap)); i < S.D.N && S.D.EV[i].t <= tt + snap; i++) { const d = Math.abs(S.D.EV[i].t - tt); if (d <= snap && d < bd) { bd = d; best = i; } }
        seek((best >= 0 ? S.D.EV[best].t : tt) / DUR());
      } else if (!reduce && samples.length > 1) {
        const a = samples[0], b = samples[samples.length - 1], dtp = b.t - a.t;
        if (dtp > 0 && performance.now() - b.t < 80) { const vpx = (b.x - a.x) / dtp; if (Math.abs(vpx) > 0.15) S.coast = -vpx / ppm() / DUR(); }
      }
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { setZoom(zoomIdx + (e.deltaY < 0 ? 1 : -1)); return; }
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      S.coast = 0; seek(S.played + d / ppm() / DUR());
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      seek(S.played + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30000 : 5000) / DUR());
    });
  })();
  // zoom has no controls on screen; Ctrl/⌘ + scroll on the tape and the + / − keys still change it
  function setZoom(i) { zoomIdx = clamp(i, 0, ZOOMS.length - 1); }

  // ---------------------------------------------------------------- transport
  // tap REW / FF: previous / next event; hold: shuttle, the spools spin fast
  function stepEvent(dir) {
    S.coast = 0;
    if (!S.D) { seek(S.played + dir * 0.05); return; }
    const t = tNow(), ev = S.D.EV, i = lastLE(ev, t);
    // back: to the start of this event if we are well into it, otherwise the one before
    const j = dir > 0 ? Math.min(ev.length - 1, i + 1) : Math.max(0, i >= 0 && ev[i].t < t - 1500 ? i : i - 1);
    seek(ev[j].t / DUR());
  }
  function holdKey(btn, dir) {
    let timer = null, held = false;
    const down = (e) => {
      if (e.button > 0) return;
      if (e.pointerId != null) btn.setPointerCapture(e.pointerId);
      btn.classList.add('down'); held = false;
      timer = setTimeout(() => { held = true; S.coast = 0; S.shuttle = dir; }, 220);
    };
    const up = () => {
      if (timer == null) return;
      clearTimeout(timer); timer = null; btn.classList.remove('down');
      if (held) S.shuttle = 0; else stepEvent(dir);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stepEvent(dir); } });
  }
  holdKey($('rewBtn'), -1); holdKey($('ffBtn'), 1);
  const toEnd = (p) => { S.coast = 0; S.shuttle = 0; seek(p); if (p >= 1) setPlaying(false); };
  $('startBtn').addEventListener('click', () => toEnd(0));
  $('endBtn').addEventListener('click', () => toEnd(1));

  // ---------- speed: alt/5's knob (drag up or right to speed up, scroll, click for the next detent), or where
  // vertical room is short (the landing hero), a dropdown (#speedSel) or a − 10× + stepper. All read SPEEDS.
  const knob = $('knob'), knobCap = $('knobCap'), speedSel = $('speedSel'), KNOB_SWEEP = 260, knobLabelEls = [];
  const knobAngle = (i) => -KNOB_SWEEP / 2 + (KNOB_SWEEP * i) / (SPEEDS.length - 1);
  function setSpeed(i) {
    speedIdx = clamp(i, 0, SPEEDS.length - 1);
    if (knob) {
      knob.setAttribute('aria-valuenow', speed()); knob.setAttribute('aria-valuetext', speed() + ' times');
      knobCap.style.transform = 'rotate(' + knobAngle(speedIdx) + 'deg)';
      knobLabelEls.forEach((el, k) => el.classList.toggle('on', k === speedIdx));
    }
    if (speedSel) speedSel.value = String(speedIdx);
    if ($('speedBtnVal')) $('speedBtnVal').textContent = speed() + '×';   // the dropdown's button shows it too
    if (speedVal) {
      speedVal.textContent = speed() + '×';
      speedDown.disabled = speedIdx === 0; speedUp.disabled = speedIdx === SPEEDS.length - 1;
    }
  }
  if (speedSel) {
    speedSel.innerHTML = SPEEDS.map((sp, i) => '<option value="' + i + '">' + sp + '×</option>').join('');
    speedSel.addEventListener('change', () => setSpeed(+speedSel.value));
  }
  // or a stepper: − 10× + (#speedDown, #speedVal, #speedUp)
  const speedVal = $('speedVal'), speedDown = $('speedDown'), speedUp = $('speedUp');
  if (speedVal) {
    speedDown.addEventListener('click', () => setSpeed(speedIdx - 1));
    speedUp.addEventListener('click', () => setSpeed(speedIdx + 1));
  }
  if (!knob) setSpeed(speedIdx);
  if (knob) (function buildKnob() {
    SPEEDS.forEach((sp, i) => {
      const el = document.createElement('span'), a = (knobAngle(i) - 90) * Math.PI / 180, R = (knob.offsetWidth || 54) / 2 + 9;   // labels just outside the knob, whatever its size
      el.textContent = sp + '×';
      el.style.transform = 'translate(-50%, -50%) translate(' + (Math.cos(a) * R).toFixed(1) + 'px, ' + (Math.sin(a) * R).toFixed(1) + 'px)';
      $('knobLabels').appendChild(el); knobLabelEls.push(el);
    });
    let sx = 0, sy = 0, base = 0, moved = false, on = false;
    knob.addEventListener('pointerdown', (e) => { on = true; moved = false; sx = e.clientX; sy = e.clientY; base = speedIdx; knob.setPointerCapture(e.pointerId); });
    knob.addEventListener('pointermove', (e) => {
      if (!on) return;
      const d = (e.clientX - sx) - (e.clientY - sy);
      if (Math.abs(d) > 6) moved = true;
      const ni = clamp(base + Math.round(d / 22), 0, SPEEDS.length - 1);
      if (ni !== speedIdx) setSpeed(ni);
    });
    knob.addEventListener('pointerup', () => { if (!on) return; on = false; if (!moved) setSpeed((speedIdx + 1) % SPEEDS.length); });
    knob.addEventListener('pointercancel', () => { on = false; });
    knob.addEventListener('wheel', (e) => { e.preventDefault(); setSpeed(speedIdx + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    knob.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setSpeed(speedIdx + 1); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setSpeed(speedIdx - 1); }
    });
    setSpeed(speedIdx);
  })();
  playBtn.addEventListener('click', () => { if (S.played >= 1) S.played = 0; setPlaying(!S.playing); });
  // ---------- skip idle (alt/5's rule): while playing, when the next event is more than ~1.2 s of real time away
  // and the current one ended ~0.6 s ago, jump to just before the next. #skipBtn toggles it, where a page has one.
  function applySkip(nt) {
    if (!S.D) return nt;
    const ev = S.D.EV, a = lastLE(ev, nt), nx = ev[a + 1]; if (!nx) return nt;
    const cur = ev[a], sp = speed(), curEnd = cur ? cur.t + (cur.dur || 0) : 0;
    return (nx.t - nt) / sp > 1200 && (nt - curEnd) / sp > 600 ? nx.t - 300 * sp : nt;
  }
  const skipBtn = $('skipBtn');
  if (skipBtn) skipBtn.addEventListener('click', () => { S.skip = !S.skip; skipBtn.setAttribute('aria-pressed', String(S.skip)); });
  if (picker) C3.tiltShelf(picker);
  if (picker) picker.addEventListener('click', (e) => {
    const b = e.target.closest('.mc-pick'); if (!b) return;
    select(+b.dataset.i);
    // bring the big cartridge back into view with its new tape
    if (stage.getBoundingClientRect().bottom < 80) stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
  // keys: Space plays, ← / → shuttle while held, Home / End go to the ends, + / − zoom the tape.
  // On a page of its own the deck takes them page-wide; on a page that scrolls (data-keys="deck", the landing)
  // only while focus is in the deck, so Space, the arrows and Home / End still scroll the page.
  // (on the landing, the keys can also sit apart from the deck, in .cart-keys)
  const keyRoots = stage.dataset.keys === 'deck' ? [...document.querySelectorAll('.deck, .cart-keys')] : [document];
  const arrows = { ArrowLeft: -1, ArrowRight: 1 };
  keyRoots.forEach((root) => root.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Space presses a focused button, so it only plays when no control has focus; the other keys work anywhere
    // except while typing in a field
    const tg = e.target, onControl = tg.matches && tg.matches('input, textarea, select, button, a'), typing = tg.matches && tg.matches('input, textarea, select');
    if (typing) return;
    if (e.key === ' ' && !onControl) { e.preventDefault(); playBtn.click(); }
    else if (arrows[e.key]) { e.preventDefault(); S.coast = 0; S.shuttle = arrows[e.key]; (arrows[e.key] < 0 ? $('rewBtn') : $('ffBtn')).classList.add('down'); }
    else if (e.key === 'Home') { e.preventDefault(); toEnd(0); }
    else if (e.key === 'End') { e.preventDefault(); toEnd(1); }
    else if (e.key === '+' || e.key === '=') setZoom(zoomIdx + 1);
    else if (e.key === '-' || e.key === '_') setZoom(zoomIdx - 1);
  }));
  keyRoots.forEach((root) => root.addEventListener('keyup', (e) => { if (arrows[e.key]) { S.shuttle = 0; $('rewBtn').classList.remove('down'); $('ffBtn').classList.remove('down'); } }));

  let R = null;
  if (renderer) R = build3D();
  select(DEMOS.findIndex((d) => d[0] === stage.dataset.demo) >= 0 ? DEMOS.findIndex((d) => d[0] === stage.dataset.demo) : 0);   // data-demo: the tape it starts with
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- 3D
  function build3D() {
    const st = C3.stage(renderer), scene = st.scene, camera = st.camera;
    const model = C3.cartridge(), cart = model.group;
    st.onTheme(model.tintFrost);
    scene.add(cart);

    // ---- drag to turn, with a little inertia; double-click to face it again
    const pose = { x: -0.18, y: -0.42 }, vel = { x: 0, y: 0 }, REST = { x: -0.18, y: -0.42 };
    let drag = null, lastInput = -1e9;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      vel.y = (e.clientX - drag.x) * 0.008; vel.x = (e.clientY - drag.y) * 0.006;
      pose.y += vel.y; pose.x = Math.max(-1.3, Math.min(1.3, pose.x + vel.x));
      drag.x = e.clientX; drag.y = e.clientY; lastInput = performance.now();
    });
    const end = () => { drag = null; cv.classList.remove('drag'); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', () => { pose.y = REST.y + Math.round((pose.y - REST.y) / (Math.PI * 2)) * Math.PI * 2; pose.x = REST.x; vel.x = vel.y = 0; lastInput = -1e9; });

    function resize() {
      // The canvas may be larger than the stage (a bleed, so a turned cartridge isn't cut off at the stage's edge);
      // the renderer fills the canvas, but the framing targets the stage box, so the cartridge keeps its size.
      const cw = cv.clientWidth, ch = cv.clientHeight, sw = stage.clientWidth, sh = stage.clientHeight; if (!cw || !ch || !sw || !sh) return;
      renderer.setSize(cw, ch, false); camera.aspect = cw / ch;
      // keep the whole cartridge in frame at any width, with room to turn it
      const vf = T.MathUtils.degToRad(camera.fov), tv = Math.tan(vf / 2);
      // the shell's half-diagonal is 2.5, so at 2.5 it still fits when turned; data-fit="tight" frames the face
      // instead (a corner may leave the stage mid-turn, into the bleed), for a stage where the tape should read big
      const k = stage.dataset.fit === 'tight' ? [1.9, 2.3] : [2.5, 2.75];   // tight: a little inside the stage, a bleed for its turns
      // distance for the stage box, scaled by how much taller the canvas is, so on-screen size is the stage's
      camera.position.z = Math.max(k[0] / tv, k[1] / (tv * sw / sh)) * (ch / sh);
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(stage); resize();

    // the label: the demo's name, length and size, in its colour
    function load(i) {
      const [, name, lines, size, cVar, secs] = DEMOS[i];
      model.setLabel({ name, dur: fmtDur(secs), sub: lines + ' lines · ' + size + ' · sonnet 5', color: css(cVar) || '#FF5B1F' });
    }
    let prevI = -1;
    function frame(ts) {
      if (prevI !== S.i) { model.resetReel(); prevI = S.i; }
      model.setReel(sec(), S.played);
      if (!drag) {
        vel.x *= 0.92; vel.y *= 0.92;
        pose.y += vel.y; pose.x = Math.max(-1.3, Math.min(1.3, pose.x + vel.x));
        // after a few idle seconds, drift back toward the resting three-quarter view
        if (ts - lastInput > 4000) {
          const ty = REST.y + Math.round((pose.y - REST.y) / (Math.PI * 2)) * Math.PI * 2;
          pose.y += (ty + (reduce ? 0 : Math.sin(ts / 2600) * 0.12) - pose.y) * 0.02; pose.x += (REST.x - pose.x) * 0.02;
        }
      }
      cart.rotation.x += (pose.x - cart.rotation.x) * 0.18;
      cart.rotation.y += (pose.y - cart.rotation.y) * 0.18;
      cart.position.y = reduce ? 0 : Math.sin(ts / 1900) * 0.04;
      renderer.render(scene, camera);
    }
    return { load, frame, shell: model.shell, cart, L: model.L, R: model.R };
  }

  // One clock for the spools, the screen and the tape. The 3D renders only while the cartridge is on screen,
  // the deck only while the deck is.
  let stageOn = true, deckOn = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { stageOn = en.isIntersecting; }).observe(stage);
    new IntersectionObserver(([en]) => { deckOn = en.isIntersecting; }).observe(document.querySelector('.deck'));
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = S.last ? Math.min(50, ts - S.last) : 16; S.last = ts;
    if (S.shuttle) {
      seek(S.played + S.shuttle * dt / SHUTTLE_MS);
      if ((S.played <= 0 && S.shuttle < 0) || (S.played >= 1 && S.shuttle > 0)) S.shuttle = 0;
    } else if (S.coast && !S.dragging) {
      seek(S.played + S.coast * dt);
      S.coast *= Math.exp(-dt / 325);
      if (Math.abs(S.coast * DUR() * ppm()) < 0.02 || S.played <= 0 || S.played >= 1) S.coast = 0;
    } else if (S.playing && !S.dragging) {
      let nt = S.played * DUR() + dt * speed();
      if (S.skip) nt = applySkip(nt);
      seek(nt / DUR());
      if (S.played >= 1) setPlaying(false);
    }
    if (deckOn) renderDeck();
    if (R && stageOn) R.frame(ts);
    for (const h of frameHooks) h(ts);
  }
  // A handle for the page around the deck (landing-deck.js): the tape's state, seeking, and a call every frame.
  const frameHooks = [];
  window.VCRCartridge = { S, DUR, speed, seek: (p) => { S.coast = 0; seek(p); }, onFrame: (fn) => frameHooks.push(fn) };
})();
