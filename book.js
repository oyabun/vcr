/* VCR Deck Studio · Book layout
   alt/2's reading layout, in the Deck Studio's own look: the session told as a document that inks in as
   the tape plays. Contents on the left (a chapter per prompt, a section per reply), the reading column in
   the middle (prompts, replies, thinking, runs of tool calls), a margin of running stats on the right, a
   minimap down the edge to scrub, and a floating transport. It is a view on the player, not a second one:
   it reads the tape and the playhead from window.VCRDeckStudio and drives the player through it.
   B (or the STUDIO / BOOK switch in the top bar) flips layouts; the choice is remembered. */
(function () {
  'use strict';
  const P = window.VCRDeckStudio;
  if (!P) return;
  const { S, EV, RS, DUR, TAPE, fmtClock, fmtDur } = P;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const app = $('app'), book = $('book');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LAPSE_MS = 90000; // a gap this long between events gets a "12 min pass" marker
  const SPEEDS = [1, 10, 30, 60, 120, 240];
  const CVAR = { prompt: '--c-prompt', text: '--c-text', thinking: '--c-thinking', Bash: '--c-bash', Read: '--c-read', Write: '--c-write', Edit: '--c-edit', MultiEdit: '--c-edit', Skill: '--c-skill' };
  const kcol = (e) => (e.err ? '--err' : CVAR[e.kind === 'tool' ? e.tool : e.kind] || '--c-other');
  const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fmtCost = (c) => '$' + (c < 100 ? c.toFixed(2) : c.toFixed(0));
  const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)));
  const pad2 = (n) => String(n).padStart(2, '0');
  function lastLE(arr, t) { let lo = 0, hi = arr.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { a = m; lo = m + 1; } else hi = m - 1; } return a; }
  // light markdown: paragraphs, `code`, **bold**; everything else as text
  function prose(s) {
    return String(s || '').trim().split(/\n{2,}/).map((p) => esc(p).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')).join('</span><span class="para">');
  }
  function firstSentence(s, max) {
    const t = String(s || '').replace(/[`*#>]/g, '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.{12,}?[.!?])(\s|$)/);
    const f = m ? m[1] : t;
    return f.length > max ? f.slice(0, max - 1).trimEnd() + '…' : f;
  }
  const toolSummary = (e) => String((e.info && e.info.label) || e.input || '').replace(/\s+/g, ' ').slice(0, 90);

  // ---------------------------------------------------------------- precompute: money, tokens, chapters
  const cum = { cost: [], out: [], inp: [], cr: [], cw: [] };
  RS.reduce((a, r) => { a.c += r.cost || 0; a.o += r.out || 0; a.i += r.in || 0; a.r += r.cr || 0; a.w += r.cw || 0; cum.cost.push(a.c); cum.out.push(a.o); cum.inp.push(a.i); cum.cr.push(a.r); cum.cw.push(a.w); return a; }, { c: 0, o: 0, i: 0, r: 0, w: 0 });
  const NR = RS.length, TOTAL_COST = NR ? cum.cost[NR - 1] : 0, TOTAL_OUT = NR ? cum.out[NR - 1] : 0;
  const TOTAL_IN = NR ? cum.inp[NR - 1] + cum.cr[NR - 1] + cum.cw[NR - 1] : 0;
  const costBefore = (t) => { let k = -1, lo = 0, hi = NR - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (RS[m].t < t) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? 0 : cum.cost[k]; };
  const TOOLS = [], toolCum = {}, errCum = new Int32Array(EV.length);
  EV.forEach((e) => { if (e.kind === 'tool' && !TOOLS.includes(e.tool)) TOOLS.push(e.tool); });
  TOOLS.forEach((tn) => { toolCum[tn] = new Int32Array(EV.length); });
  { const cnt = {}; let errs = 0; EV.forEach((e, i) => { if (e.kind === 'tool') cnt[e.tool] = (cnt[e.tool] || 0) + 1; if (e.err) errs++; TOOLS.forEach((tn) => { toolCum[tn][i] = cnt[tn] || 0; }); errCum[i] = errs; }); }
  const TOOL_TOTAL = {}; TOOLS.forEach((tn) => { TOOL_TOTAL[tn] = EV.length ? toolCum[tn][EV.length - 1] : 0; });
  TOOLS.sort((a, b) => TOOL_TOTAL[b] - TOOL_TOTAL[a]);
  const ERRS = EV.map((e, i) => (e.err ? i : -1)).filter((i) => i >= 0);

  // a chapter per prompt, a section per reply ("beat") inside it
  const chapters = [], sections = [], secOf = new Int32Array(EV.length), chOf = new Int32Array(EV.length);
  {
    let ch = null, sec = null;
    EV.forEach((e, i) => {
      if (e.kind === 'prompt' || !ch) {
        ch = { i0: i, t0: e.t, secs: [], title: e.kind === 'prompt' ? firstSentence(e.text, 80) : 'Session' };
        chapters.push(ch); sec = null;
        if (e.kind === 'prompt') { chOf[i] = chapters.length - 1; secOf[i] = -1; return; }
      }
      if (!sec || (e.kind === 'text' && sec.hasText)) { sec = { i0: i, t0: e.t, ch: chapters.length - 1, hasText: false, title: '', err: false }; sections.push(sec); ch.secs.push(sections.length - 1); }
      if (e.kind === 'text' && !sec.hasText) { sec.hasText = true; sec.title = firstSentence(e.text, 72); }
      if (e.kind === 'tool' && !sec.title0) sec.title0 = e.tool + ': ' + toolSummary(e);
      if (e.err) sec.err = true;
      chOf[i] = chapters.length - 1; secOf[i] = sections.length - 1;
    });
    chapters.forEach((c, k) => { c.t1 = k + 1 < chapters.length ? chapters[k + 1].t0 : DUR; c.cost = costBefore(k + 1 < chapters.length ? c.t1 : Infinity) - costBefore(c.t0); });
    sections.forEach((s, k) => {
      const nx = sections[k + 1];
      s.t1 = nx && nx.ch === s.ch ? nx.t0 : chapters[s.ch].t1;
      s.cost = costBefore(!nx && s.ch === chapters.length - 1 ? Infinity : s.t1) - costBefore(s.t0);
      if (!s.title) s.title = s.title0 || 'Working';
    });
    EV.forEach((e, j) => { if (secOf[j] === -1) { const cs = chapters[chOf[j]].secs; secOf[j] = cs.length ? cs[0] : 0; } });
  }

  // ---------------------------------------------------------------- skeleton
  book.innerHTML =
    '<nav class="bk-outline panel" aria-label="Contents"><div class="bk-ol" id="bkOl"></div></nav>' +
    '<div class="bk-center">' +
      '<div class="bk-scroll" id="bkScroll"><div class="bk-col"><header class="bk-mast" id="bkMast"></header><article class="bk-doc" id="bkDoc"></article><footer class="bk-end" id="bkEnd"></footer></div></div>' +
      '<button class="bk-return" id="bkReturn" hidden><span>Return to the playhead</span><b class="dot" id="bkReturnT">00:00</b></button>' +
      '<div class="bk-pill" id="bkPill" role="toolbar" aria-label="Playback">' +
        '<button class="mini-key" id="bkPrev" aria-label="Previous event" title="Previous event (←)"><svg viewBox="0 0 24 24"><path d="M5 5h2.5v14H5zM19 5.5v13L9 12z"/></svg></button>' +
        '<button class="mini-key bk-play" id="bkPlay" aria-label="Play" title="Play / pause (Space)"><svg class="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg><svg class="i-pause" viewBox="0 0 24 24"><path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z"/></svg></button>' +
        '<button class="mini-key" id="bkNext" aria-label="Next event" title="Next event (→)"><svg viewBox="0 0 24 24"><path d="M16.5 5H19v14h-2.5zM5 5.5v13L15 12z"/></svg></button>' +
        '<span class="bk-time dot"><span id="bkNow">00:00</span><small>/' + fmtClock(DUR) + '</small></span>' +
        '<div class="seg bk-speed" id="bkSpeed" role="radiogroup" aria-label="Speed">' + SPEEDS.map((v) => '<button class="seg-btn" role="radio" data-speed="' + v + '">' + v + '×</button>').join('') + '</div>' +
        '<button class="tog-key" id="bkSkip" aria-pressed="false" title="Skip idle gaps (S)"><i class="led"></i>SKIP IDLE</button>' +
      '</div>' +
    '</div>' +
    '<aside class="bk-margin panel" aria-label="Session statistics" id="bkMargin">' +
      '<section><div class="bk-lbl">Spend</div><div class="bk-fig"><span class="dot" id="bkCost">$0.00</span><small>of ' + fmtCost(TOTAL_COST) + '</small></div><canvas class="bk-spark" data-h="40" id="spCost"></canvas></section>' +
      '<section><div class="bk-lbl">Input tokens <em>sent to the model</em></div><div class="bk-fig"><span class="dot" id="bkIn">0</span><small>of ' + fmtTok(TOTAL_IN) + '</small></div><div class="bk-split" id="bkSplit"></div></section>' +
      '<section><div class="bk-lbl">Output tokens <em>per response</em></div><div class="bk-fig"><span class="dot" id="bkOut">0</span><small>of ' + fmtTok(TOTAL_OUT) + '</small></div><canvas class="bk-spark" data-h="34" id="spOut"></canvas></section>' +
      '<section><div class="bk-lbl">Context <em>window in use</em></div><div class="bk-fig"><span class="dot" id="bkCtx">0</span><small id="bkCache">cache 0%</small></div><canvas class="bk-spark" data-h="34" id="spCtx"></canvas></section>' +
      '<section><div class="bk-lbl">Tools <em id="bkErrs"></em></div><div class="bk-tally" id="bkTally"></div></section>' +
      '<section class="bk-facts">' +
        '<div><span>Model</span><b>' + esc(TAPE.model || '—') + '</b></div><div><span>Source</span><b title="' + esc(TAPE.source) + '">' + esc(TAPE.source || '—') + '</b></div>' +
        '<div><span>Responses</span><b>' + NR + '</b></div><div><span>Events</span><b>' + EV.length + '</b></div>' +
      '</section>' +
    '</aside>' +
    '<div class="bk-mm" id="bkMm" role="slider" tabindex="0" aria-label="Session map: drag to seek" aria-valuemin="0" aria-valuemax="100"><canvas id="mmBase"></canvas><canvas id="mmOver"></canvas><div class="bk-mmtip" id="mmTip" hidden></div></div>';
  const scroller = $('bkScroll');

  // ---------------------------------------------------------------- masthead
  {
    const st = new Date(TAPE.start), nTools = EV.filter((e) => e.kind === 'tool').length;
    const date = isNaN(st) ? '' : st.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + st.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    $('bkMast').innerHTML =
      '<p class="bk-kicker"><span class="rec"></span>A session, replayed</p>' +
      '<h1>' + esc(TAPE.title || TAPE.source || 'Untitled session') + '</h1>' +
      '<p class="bk-dek">A <b>' + fmtDur(DUR) + '</b> working session with <b>' + esc(TAPE.model || 'an agent') + '</b>: ' + chapters.length + ' prompt' + (chapters.length === 1 ? '' : 's') + ', ' +
        sections.length + ' beats, ' + nTools + ' tool calls and <b>' + fmtCost(TOTAL_COST) + '</b> of tokens, in the order it happened.</p>' +
      '<p class="bk-by"><span>' + esc(date) + '</span><code>' + esc(TAPE.source || '') + '</code><code>' + esc(String(TAPE.cwd || '').replace(/^\/Users\/[^/]+/, '~')) + '</code></p>' +
      '<p class="bk-hint">Unread passages are ghosted; they ink in as the tape reaches them. <kbd>Space</kbd> plays, <kbd>←</kbd><kbd>→</kbd> step, <kbd>B</kbd> goes back to the studio.</p>';
    $('bkEnd').innerHTML = '<span class="dot">END OF TAPE</span> · ' + fmtDur(DUR) + ' · ' + fmtCost(TOTAL_COST);
  }

  // ---------------------------------------------------------------- the document
  const THINK = '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="9.5" cy="6.3" rx="5" ry="3.8"/><circle cx="4.5" cy="11.6" r="1.3"/><circle cx="2.3" cy="14.1" r=".85" class="f"/></svg>';
  const evEl = new Array(EV.length), blockEl = new Array(EV.length), runFirst = {};
  {
    const frag = document.createDocumentFragment();
    let chEl = null, run = null, chips = null;
    EV.forEach((e, i) => {
      const prev = EV[i - 1], c = chOf[i];
      if (!chEl || (e.kind === 'prompt' && chapters[c].i0 === i)) {
        const C = chapters[c];
        chEl = document.createElement('section'); chEl.className = 'bk-ch'; chEl.id = 'bk-ch-' + c;
        chEl.innerHTML = '<div class="bk-chhead"><span class="num dot">' + pad2(c + 1) + '</span><span class="lbl">Chapter</span><span class="meta">' + fmtClock(C.t0) + ' · ' + fmtDur(C.t1 - C.t0) + ' · ' + fmtCost(C.cost) + '</span></div>';
        frag.appendChild(chEl); run = null;
      }
      if (prev && e.kind !== 'prompt' && e.t - prev.t > LAPSE_MS) { const l = document.createElement('div'); l.className = 'bk-lapse'; l.textContent = fmtDur(e.t - prev.t) + ' pass'; chEl.appendChild(l); run = null; }
      const stamp = '<button class="bk-stamp" data-seek="' + i + '" tabindex="-1" title="Seek here">' + fmtClock(e.t) + '</button>';
      let node;
      if (e.kind === 'prompt') {
        node = document.createElement('blockquote'); node.className = 'bk-ev bk-prompt';
        node.innerHTML = stamp + '<span class="who">You asked</span><div class="body"><span class="para">' + prose(e.text) + '</span></div>' +
          (String(e.text || '').length > 280 ? '<button class="bk-more" data-more="' + i + '">Read the full prompt</button>' : '');
      } else if (e.kind === 'text') {
        node = document.createElement('div'); node.className = 'bk-ev bk-reply';
        node.innerHTML = stamp + '<div class="body"><span class="para">' + prose(e.text) + '</span></div>';
      } else if (e.kind === 'thinking') {
        const since = prev ? Math.max(0, e.t - (prev.t + (prev.dur || 0))) : e.t, has = !!String(e.text || '').trim();
        node = document.createElement('aside'); node.className = 'bk-ev bk-think';
        node.innerHTML = stamp + '<button class="t-btn" data-think="' + i + '">' + THINK + '<span>' + (since > 1500 ? 'Thought for ' + fmtDur(since) : 'A brief thought') + '</span><em>' + (has ? 'expand' : 'reasoning not logged') + '</em></button>' +
          '<div class="t-body">' + (has ? '<span class="para">' + prose(e.text) + '</span>' : '<em>The log records that the model reasoned here, but not what it thought.</em>') + '</div>';
      }
      if (node) { chEl.appendChild(node); run = null; blockEl[i] = node; }
      else {
        // tool calls in a row form a run of chips; click one for its input and result
        if (!run) { run = document.createElement('div'); run.className = 'bk-run'; run.innerHTML = stamp; chips = document.createElement('div'); chips.className = 'bk-chips'; run.appendChild(chips); chEl.appendChild(run); runFirst[i] = run; }
        node = document.createElement('button'); node.className = 'bk-ev bk-chip' + (e.err ? ' err' : '');
        node.style.setProperty('--k', 'var(' + kcol(e) + ')');
        node.innerHTML = '<i></i><span class="tn">' + esc(e.tool) + '</span><span class="ts">' + esc(toolSummary(e)) + '</span>' + (e.dur != null ? '<span class="td">' + fmtDur(e.dur) + '</span>' : '');
        node.dataset.chip = i; node.title = e.tool + (e.err ? ' (error)' : '') + ': click to see the call';
        chips.appendChild(node); blockEl[i] = run;
      }
      node.dataset.i = i; node.classList.add('fut'); evEl[i] = node;
    });
    $('bkDoc').appendChild(frag);
    for (const k in runFirst) runFirst[k].classList.add('fut-run');
  }

  // ---------------------------------------------------------------- contents
  const secBtn = [], secBar = [];
  {
    let h = '<div class="bk-oltitle"><span>Contents</span><span class="dot">' + fmtClock(DUR) + '</span></div>';
    chapters.forEach((C, c) => {
      h += '<div class="bk-olch"><button class="bk-olchbtn" data-ch="' + c + '"><span class="num dot">' + pad2(c + 1) + '</span><span class="ttl">' + esc(C.title) + '</span><span class="meta">' + fmtDur(C.t1 - C.t0) + ' · ' + fmtCost(C.cost) + '</span></button><ol>';
      C.secs.forEach((s) => { const Sx = sections[s]; h += '<li><button class="bk-olsec' + (Sx.err ? ' err' : '') + '" data-sec="' + s + '" title="' + esc(Sx.title) + '"><span class="ttl">' + esc(Sx.title) + '</span><span class="meta">' + fmtDur(Sx.t1 - Sx.t0) + '</span><i class="bar"></i></button></li>'; });
      h += '</ol></div>';
    });
    $('bkOl').innerHTML = h;
    $('bkOl').querySelectorAll('.bk-olsec').forEach((b) => { secBtn[+b.dataset.sec] = b; secBar[+b.dataset.sec] = b.querySelector('.bar'); });
  }
  // tool tally
  const tally = {};
  $('bkTally').innerHTML = TOOLS.map((tn) => '<div class="bk-trow" style="--k:var(' + (CVAR[tn] || '--c-other') + ')"><span>' + esc(tn) + '</span><span class="tb"><i data-t="' + esc(tn) + '"></i></span><span class="bk-tc" data-c="' + esc(tn) + '">0/' + TOOL_TOTAL[tn] + '</span></div>').join('');
  TOOLS.forEach((tn) => { tally[tn] = { bar: $('bkTally').querySelector('i[data-t="' + tn + '"]'), c: $('bkTally').querySelector('[data-c="' + tn + '"]') }; });

  // ---------------------------------------------------------------- cursor: ghost the future, mark now
  let cur = -2, lastSec = -1, follow = true, tops = null, scrollTarget = null;
  const measure = () => { const base = scroller.getBoundingClientRect().top - scroller.scrollTop; tops = evEl.map((n) => n.getBoundingClientRect().top - base); };
  const topOf = (i) => { if (!tops) measure(); return tops[i]; };
  function setCursor(n) {
    if (n === cur) return;
    const old = cur, a = Math.min(old, n), b = Math.max(old, n);
    for (let i = Math.max(a + 1, 0); i <= b; i++) { evEl[i].classList.toggle('fut', i > n); if (runFirst[i]) runFirst[i].classList.toggle('fut-run', i > n); }
    if (old >= 0 && evEl[old]) { evEl[old].classList.remove('now'); if (blockEl[old] !== evEl[old]) blockEl[old].classList.remove('now-run'); }
    cur = n;
    if (n >= 0) { evEl[n].classList.add('now'); if (blockEl[n] !== evEl[n]) blockEl[n].classList.add('now-run'); }
    // contents: done / current section
    const s = n >= 0 ? secOf[n] : -1;
    if (s !== lastSec) {
      for (let k = Math.max(Math.min(s, lastSec), 0); k <= Math.max(s, lastSec); k++) { if (!secBtn[k]) continue; secBtn[k].classList.toggle('done', k < s); secBtn[k].classList.toggle('on', k === s); if (k !== s) secBar[k].style.transform = 'scaleX(0)'; }
      lastSec = s;
      if (s >= 0 && secBtn[s]) keepVisible(secBtn[s]);
    }
    TOOLS.forEach((tn) => { const v = n >= 0 ? toolCum[tn][n] : 0; tally[tn].bar.style.transform = 'scaleX(' + (TOOL_TOTAL[tn] ? v / TOOL_TOTAL[tn] : 0) + ')'; tally[tn].c.textContent = v + '/' + TOOL_TOTAL[tn]; });
    const errs = n >= 0 ? errCum[n] : 0;
    $('bkErrs').textContent = errs ? errs + ' error' + (errs > 1 ? 's' : '') : '';
    if (follow) scrollToCursor();
    mmDirty = true;
  }
  function keepVisible(btn) {
    const box = $('bkOl'), bt = btn.offsetTop, bh = btn.offsetHeight, st = box.scrollTop, h = box.clientHeight;
    let target = null;
    if (bt < st + 50) target = bt - 60; else if (bt + bh > st + h - 50) target = bt - h * 0.4;
    if (target != null) box.scrollTo({ top: Math.max(0, target), behavior: reduced || (S.playing && S.base > 30) ? 'auto' : 'smooth' });
  }

  // ---------------------------------------------------------------- follow the playhead (and let go when you scroll)
  function scrollToCursor(instant) {
    if (cur < 0) { scrollTarget = 0; return; }
    const h = scroller.clientHeight;
    let y = topOf(cur) - h * (EV[cur].kind === 'prompt' ? 0.22 : 0.36);
    y = Math.max(0, Math.min(scroller.scrollHeight - h, y));
    if (instant || reduced) { scrollTarget = null; progScroll(y); } else scrollTarget = y;
  }
  let progScrolling = false;
  function progScroll(y) { progScrolling = true; scroller.scrollTop = y; }
  function stepScroll() {
    if (scrollTarget == null) return;
    const y = scroller.scrollTop, d = scrollTarget - y;
    if (Math.abs(d) < 1.2) { progScroll(scrollTarget); scrollTarget = null; return; }
    let s = d * 0.16; if (Math.abs(s) < 1) s = d > 0 ? 1 : -1;
    progScroll(y + s);
  }
  function setFollow(on) {
    follow = on; $('bkReturn').hidden = on;
    if (on) scrollToCursor(); else { scrollTarget = null; updReturn(); }
  }
  const userScrolled = () => { if (follow) setFollow(false); };
  scroller.addEventListener('wheel', userScrolled, { passive: true });
  scroller.addEventListener('touchmove', userScrolled, { passive: true });
  scroller.addEventListener('keydown', (e) => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown'].includes(e.key)) userScrolled(); });
  scroller.addEventListener('scroll', () => { if (progScrolling) progScrolling = false; mmView = true; updReturn(); }, { passive: true });
  function updReturn() {
    if (follow || cur < 0) return;
    $('bkReturn').classList.toggle('up', topOf(cur) - scroller.scrollTop < 0);
    $('bkReturnT').textContent = fmtClock(EV[cur].t);
  }
  $('bkReturn').addEventListener('click', () => setFollow(true));

  // ---------------------------------------------------------------- clicks in the document and the contents
  book.addEventListener('click', (e) => {
    const t = e.target.closest('[data-seek],[data-think],[data-more],[data-chip],[data-ch],[data-sec],[data-speed],#bkPrev,#bkPlay,#bkNext,#bkSkip');
    if (!t) return;
    const d = t.dataset;
    if (d.seek != null) { P.seek(EV[+d.seek].t, { idx: +d.seek }); setFollow(true); }
    else if (d.think != null) { t.parentNode.classList.toggle('open'); tops = null; }
    else if (d.more != null) { const q = t.parentNode; q.classList.toggle('full'); t.textContent = q.classList.contains('full') ? 'Show less' : 'Read the full prompt'; tops = null; }
    else if (d.chip != null) { openCall(+d.chip, t); }
    else if (d.ch != null) { P.seek(chapters[+d.ch].t0, { idx: chapters[+d.ch].i0 }); setFollow(true); }
    else if (d.sec != null) { const Sx = sections[+d.sec]; P.seek(Sx.t0, { idx: Sx.i0 }); setFollow(true); }
    else if (d.speed != null) P.setSpeed(+d.speed);
    else if (t.id === 'bkPrev') P.step(-1);
    else if (t.id === 'bkNext') P.step(1);
    else if (t.id === 'bkPlay') P.togglePlay();
    else if (t.id === 'bkSkip') P.setSkip(!S.skip);
  });
  // a tool call's input and result, opened under its run
  function openCall(i, chip) {
    const run = chip.closest('.bk-run'), open = run.querySelector('.bk-call');
    if (open && +open.dataset.i === i) { open.remove(); chip.classList.remove('open'); tops = null; return; }
    if (open) { open.remove(); run.querySelectorAll('.bk-chip.open').forEach((c) => c.classList.remove('open')); }
    const e = EV[i], card = document.createElement('div');
    card.className = 'bk-call' + (e.err ? ' err' : ''); card.dataset.i = i; card.style.setProperty('--k', 'var(' + kcol(e) + ')');
    card.innerHTML = '<div class="bk-callhead"><b>' + esc(e.tool) + '</b><span>' + fmtClock(e.t) + (e.dur != null ? ' · ' + fmtDur(e.dur) : '') + (e.err ? ' · error' : '') + '</span>' +
      '<button class="nano-key" data-seek="' + i + '" title="Seek here">▶</button></div>' +
      '<pre>' + esc((e.info && e.info.cmd) || e.input || '') + '</pre>' + (e.result ? '<div class="bk-lbl">Result</div><pre class="res">' + esc(e.result) + '</pre>' : '');
    run.appendChild(card); chip.classList.add('open'); tops = null;
  }

  // ---------------------------------------------------------------- margin: running figures and sparklines
  let respIdx = -2, lastNow = -1, sparkW = 0, lastSpark = -1, dpr = 1;
  const sparks = ['spCost', 'spOut', 'spCtx'].map($);
  const series = {
    spCost: RS.map((r, k) => cum.cost[k]),
    spOut: RS.map((r) => r.out || 0),
    spCtx: RS.map((r) => (r.in || 0) + (r.cr || 0) + (r.cw || 0)),
  };
  function sizeSparks() {
    dpr = Math.min(2, devicePixelRatio || 1);
    sparkW = sparks[0].parentNode.clientWidth;
    sparks.forEach((c) => { const h = +c.dataset.h; c.style.height = h + 'px'; c.width = Math.round(sparkW * dpr); c.height = Math.round(h * dpr); });
    lastSpark = -1;
  }
  function drawSparks() {
    if (!sparkW || !NR) return;
    const px = (S.t / DUR) * sparkW, ink = cssv('--ink-3'), acc = cssv('--orange');
    sparks.forEach((c) => {
      const g = c.getContext('2d'), h = +c.dataset.h, v = series[c.id], mx = Math.max(1, ...v), cumul = c.id === 'spCost';
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, sparkW, h);
      const pts = RS.map((r, k) => [(r.t / DUR) * sparkW, h - 2 - (v[k] / mx) * (h - 6)]);
      const path = (to) => { g.beginPath(); g.moveTo(0, h - 2); pts.forEach(([x, y], k) => { if (x > to) return; if (cumul) { g.lineTo(x, k ? pts[k - 1][1] : h - 2); g.lineTo(x, y); } else { g.moveTo(x, h - 2); g.lineTo(x, y); } }); };
      g.lineWidth = cumul ? 1.5 : 1.2;
      g.globalAlpha = 0.35; g.strokeStyle = ink; path(Infinity); g.stroke();
      g.globalAlpha = 1; g.strokeStyle = acc; path(px); g.stroke();
      g.fillStyle = acc; g.fillRect(Math.round(px) - 0.5, 0, 1, h);
    });
  }
  function renderFigures() {
    const ri = lastLE(RS, S.t);
    if (ri !== respIdx) {
      respIdx = ri;
      const c = ri >= 0 ? cum.cost[ri] : 0, o = ri >= 0 ? cum.out[ri] : 0, readAll = ri >= 0 ? cum.inp[ri] + cum.cr[ri] + cum.cw[ri] : 0;
      $('bkCost').textContent = fmtCost(c); $('bkOut').textContent = fmtTok(o); $('bkIn').textContent = fmtTok(readAll);
      $('bkCtx').textContent = fmtTok(ri >= 0 ? (RS[ri].in || 0) + (RS[ri].cr || 0) + (RS[ri].cw || 0) : 0);
      $('bkCache').textContent = 'cache hit ' + (readAll ? Math.round(cum.cr[ri] / readAll * 100) : 0) + '%';
      $('bkSplit').innerHTML = ri >= 0 ? '<span>fresh <b>' + fmtTok(cum.inp[ri]) + '</b></span><span>cache read <b>' + fmtTok(cum.cr[ri]) + '</b></span><span>cache write <b>' + fmtTok(cum.cw[ri]) + '</b></span>' : '';
    }
    const spx = Math.round((S.t / DUR) * sparkW);
    if (spx !== lastSpark) { lastSpark = spx; drawSparks(); }
  }

  // ---------------------------------------------------------------- minimap: the whole session down the edge
  const mm = $('bkMm'), mmBase = $('mmBase'), mmOver = $('mmOver'), MM_TOP = 30, MM_BOT = 26;
  let mmW = 0, mmH = 0, mmDirty = true, mmView = true, lastPlayY = -1, lastViewKey = '';
  const mmY = (t) => MM_TOP + (t / DUR) * (mmH - MM_TOP - MM_BOT);
  const mmT = (y) => Math.max(0, Math.min(DUR, ((y - MM_TOP) / (mmH - MM_TOP - MM_BOT)) * DUR));
  function sizeMinimap() {
    mmW = mm.clientWidth; mmH = mm.clientHeight;
    [mmBase, mmOver].forEach((c) => { c.width = Math.round(mmW * dpr); c.height = Math.round(mmH * dpr); });
    drawBase(); lastPlayY = -1; lastViewKey = ''; drawOverlay(true);
  }
  function drawBase() {
    const g = mmBase.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, mmW, mmH);
    const x0 = 8, x1 = mmW - 10, lane = x1 - x0;
    g.fillStyle = cssv('--hw-line-2');
    for (let m = 0; m * 60000 <= DUR; m += 5) g.fillRect(0, Math.round(mmY(m * 60000)), m % 10 === 0 ? 6 : 3, 1);
    // the output-token burn, as a thin bar on the right edge
    const nb = Math.ceil((mmH - MM_TOP - MM_BOT) / 3), sums = new Float64Array(nb); let mx = 0;
    RS.forEach((r) => { const b = Math.min(nb - 1, Math.floor((mmY(r.t) - MM_TOP) / 3)); sums[b] += r.out || 0; mx = Math.max(mx, sums[b]); });
    g.fillStyle = cssv('--orange'); g.globalAlpha = 0.55;
    for (let b = 0; b < nb; b++) if (sums[b]) { const w = Math.max(1, Math.sqrt(sums[b] / mx) * 6); g.fillRect(mmW - 2 - w, MM_TOP + b * 3, w, 2.5); }
    g.globalAlpha = 1;
    EV.forEach((e, i) => {
      const y = mmY(e.t);
      g.fillStyle = cssv(kcol(e));
      if (e.kind === 'prompt') g.fillRect(0, y - 1.5, mmW - 10, 3);
      else if (e.kind === 'text') g.fillRect(x0, y - 1, Math.max(4, lane * (0.3 + Math.min(0.6, String(e.text || '').length / 500))), 2);
      else if (e.kind === 'thinking') g.fillRect(x0 - 4, y - 1, 3, 2);
      else g.fillRect(x0 + lane * 0.28, y - 0.75, Math.max(3, Math.min(lane * 0.6, 3 + String(e.input || '').length / 8)), Math.max(1.5, ((e.dur || 0) / DUR) * (mmH - MM_TOP - MM_BOT)));
    });
  }
  function visibleRange() {
    if (!tops) measure();
    const top = scroller.scrollTop, bot = top + scroller.clientHeight;
    let first = EV.length - 1, last = 0;
    for (let lo = 0, hi = EV.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (tops[m] >= top) { first = m; hi = m - 1; } else lo = m + 1; }
    for (let lo = 0, hi = EV.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (tops[m] <= bot) { last = m; lo = m + 1; } else hi = m - 1; }
    if (last < first) { first = Math.max(0, first - 1); last = first; }
    return [EV[first] ? EV[first].t : 0, last + 1 < EV.length ? EV[last + 1].t : DUR];
  }
  function drawOverlay(force) {
    if (!mmW) return;
    const py = Math.round(mmY(S.t) * 2) / 2, vr = visibleRange(), key = Math.round(mmY(vr[0])) + ':' + Math.round(mmY(vr[1]));
    mmDirty = mmView = false;
    if (!force && py === lastPlayY && key === lastViewKey) return;
    lastPlayY = py; lastViewKey = key;
    const g = mmOver.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, mmW, mmH);
    g.fillStyle = 'rgba(12,12,13,.6)'; g.fillRect(0, py, mmW, mmH - py);                         // the unplayed future, veiled
    const y0 = mmY(vr[0]), y1 = Math.max(y0 + 6, mmY(vr[1]));                                      // what the column shows now
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(1, y0, mmW - 2, y1 - y0);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.strokeRect(1.5, y0 + 0.5, mmW - 3, y1 - y0 - 1);
    g.fillStyle = cssv('--err');
    ERRS.forEach((i) => { const ey = mmY(EV[i].t), ex = mmW - 6; g.beginPath(); g.moveTo(ex, ey - 4); g.lineTo(ex + 4, ey); g.lineTo(ex, ey + 4); g.lineTo(ex - 4, ey); g.closePath(); g.fill(); });
    g.fillStyle = cssv('--orange'); g.fillRect(0, py - 1, mmW, 2);
    g.beginPath(); g.moveTo(0, py - 5); g.lineTo(5, py); g.lineTo(0, py + 5); g.closePath(); g.fill();
    g.font = '700 9px "JetBrains Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.fillStyle = cssv('--hw-fg-3');
    g.fillText(fmtClock(S.t), mmW / 2, MM_TOP - 12); g.fillText(fmtClock(DUR), mmW / 2, mmH - 9); g.textAlign = 'start';
  }
  {
    let drag = false, was = false;
    const at = (ev) => { const r = mm.getBoundingClientRect(); P.seek(mmT(ev.clientY - r.top)); setFollow(true); };
    const tip = (ev) => {
      if (ev.pointerType === 'touch' && !drag) return;
      const r = mm.getBoundingClientRect(), y = ev.clientY - r.top, t = mmT(y), i = lastLE(EV, t), el = $('mmTip');
      el.innerHTML = '<b>' + fmtClock(t) + '</b>' + esc(i >= 0 ? (EV[i].kind === 'tool' ? EV[i].tool + ': ' + toolSummary(EV[i]) : firstSentence(EV[i].text, 60) || EV[i].kind) : 'Start of tape');
      el.style.top = Math.max(16, Math.min(mmH - 16, y)) + 'px'; el.hidden = false;
    };
    mm.addEventListener('pointerdown', (ev) => { drag = true; was = S.playing; if (was) P.pause(); mm.setPointerCapture(ev.pointerId); at(ev); tip(ev); ev.preventDefault(); });
    mm.addEventListener('pointermove', (ev) => { if (drag) at(ev); tip(ev); });
    const end = () => { if (!drag) return; drag = false; if (was) P.togglePlay(); };
    mm.addEventListener('pointerup', end); mm.addEventListener('pointercancel', end);
    mm.addEventListener('pointerleave', () => { if (!drag) $('mmTip').hidden = true; });
    mm.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); P.seek(S.t + (ev.key === 'ArrowUp' ? -1 : 1) * DUR / 100); setFollow(true); } });
  }

  // ---------------------------------------------------------------- the pill: play state, clock, speed, skip
  let lastPill = '';
  function renderPill() {
    const key = S.playing + '|' + S.base + '|' + S.skip;
    if (key !== lastPill) {
      lastPill = key;
      $('bkPlay').classList.toggle('on', S.playing); $('bkPlay').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
      $('bkSpeed').querySelectorAll('[data-speed]').forEach((b) => { const on = +b.dataset.speed === S.base; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      $('bkSkip').setAttribute('aria-pressed', String(!!S.skip));
    }
    const s = Math.floor(S.t / 1000);
    if (s !== lastNow) { lastNow = s; $('bkNow').textContent = fmtClock(S.t); mm.setAttribute('aria-valuenow', Math.round((S.t / DUR) * 100)); }
    // the current section's progress bar in the contents
    if (lastSec >= 0 && secBar[lastSec]) { const Sx = sections[lastSec]; secBar[lastSec].style.transform = 'scaleX(' + Math.max(0, Math.min(1, (S.t - Sx.t0) / Math.max(1, Sx.t1 - Sx.t0))).toFixed(3) + ')'; }
  }

  // ---------------------------------------------------------------- mode switch
  let on = false;
  const modeBtns = document.querySelectorAll('[data-mode]');
  function setMode(m) {
    on = m === 'book';
    app.classList.toggle('book-mode', on); book.hidden = !on;
    modeBtns.forEach((b) => { const sel = b.dataset.mode === m; b.classList.toggle('on', sel); b.setAttribute('aria-checked', String(sel)); });
    try { localStorage.setItem('vcr-ds-mode', m); } catch (e) {}
    if (on) {
      requestAnimationFrame(() => { sizeSparks(); sizeMinimap(); tops = null; cur = -2; setCursor(S.cur); scrollToCursor(true); renderFigures(); drawSparks(); });
    }
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target.matches && e.target.matches('input, textarea, select'))) return;
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setMode(on ? 'studio' : 'book'); }
    else if (on && (e.key === 'f' || e.key === 'F')) setFollow(true);   // in the book, F returns to the playhead
  });
  new ResizeObserver(() => { if (!on) return; sizeSparks(); sizeMinimap(); tops = null; if (follow) scrollToCursor(true); }).observe(book);

  // ---------------------------------------------------------------- every frame, while the book is showing
  P.onFrame(() => {
    if (!on) return;
    if (S.cur !== cur) setCursor(S.cur);
    renderPill(); renderFigures(); stepScroll();
    if (mmDirty || mmView || Math.round(mmY(S.t) * 2) / 2 !== lastPlayY) drawOverlay();
  });

  let saved = null; try { saved = localStorage.getItem('vcr-ds-mode'); } catch (e) {}
  setMode(saved === 'book' ? 'book' : 'studio');
})();
