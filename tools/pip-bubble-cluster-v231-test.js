/* pip-bubble-cluster-v231-test.js — PIP-FACE-DESIGN-V41 + PIP-DOUBLE-FACE.
 *
 * Asjad, Fri Oct 23 2026 10:50 MDT, screenshot + words: TWO faces
 * float at once over his home screen — (1) the widget-style face
 * top-centre ("METICULOUS / Working… / 00:32:06 / 0 loads ·
 * Miles (live): 0.1 km" + Start/Pause/Stop) and (2) a BIG DARK
 * RECTANGLE mid-screen ("Working… / 00:32:06 / 0 loads"). His
 * design, verbatim: "Sis is not a buble. I thought [it would be]
 * a big green buble on the left and smaller red buble on its
 * right bottom and a timer going on under it... With the load
 * tracker." Refined by his hand drawing (10:53): BIG GREEN bubble
 * top-LEFT; SMALLER RED bubble to its RIGHT, set LOWER (~4–5
 * o'clock, slightly overlapping); UNDER BOTH, one WIDE rounded
 * pill bar carrying the TIMER and the LOAD TRACKER (+1/−1 with
 * the count, his standing correction law). Refined again (10:54):
 * "all the space between them are see through! Not on a card." —
 * the gaps between bubbles and bar are TRANSPARENT; only the
 * bubbles and the bar are solid.
 *
 * REPRODUCTION-FIRST on his exact state: a session RUNNING,
 * timer 00:32:06 (1926 s), 0 loads. Before the fix this suite is
 * RED: the web face stacks inside system PiP next to the shell
 * face, the faces are dark rectangles/cards, the running bubble
 * paints the PAUSE colour, the widget never stands down.
 *
 * Parts:
 *  A — behaviour (vm, the REAL js/app.js bubble block + the REAL
 *      js/shifttrack.js over a Capacitor plugin stub):
 *      shell-drawn face present => the web face STANDS DOWN in
 *      system PiP (one float), the fact mirror still feeds the
 *      shell face every tick, the Back-dock face still floats,
 *      state colours follow the law (green working / yellow
 *      paused); old shell (no bubbleState) keeps the web face.
 *  B — web cluster statics: index.html cluster markup + the
 *      style.css cluster contract (round bubbles, red smaller at
 *      the green's right-bottom, wide pill bar, TRANSPARENT
 *      container + gaps, no card chrome, +1 green / −1 red).
 *  C — native statics: PipFaceView draws the transparent cluster
 *      (circles + pill, named size fractions, state colours,
 *      glyphs), MainActivity makes the PiP window see-through
 *      behind the cluster + stands the widget down, the widget
 *      renders a stood-down tile while the float is up.
 *  D — release pins: web v231 / APK_VERSION 41 (native float code
 *      changed => native v41).
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

/* ================= element stub (house pattern) ================= */
function el(id) {
  const e = {
    id: id || '', style: {}, dataset: {}, children: {}, childNodes: [],
    textContent: '', innerHTML: '', value: '', _classes: new Set(),
    offsetWidth: 200, offsetHeight: 100, clientWidth: 200,
    classList: null, parentNode: null,
    addEventListener: function () {}, removeEventListener: function () {},
    appendChild: function (c) { e.childNodes.push(c); if (c) c.parentNode = e; return c; },
    remove: function () {}, focus: function () {}, click: function () {},
    querySelector: function (sel) { return e.children[sel] || (e.children[sel] = el()); },
    querySelectorAll: function () { return []; },
    getContext: function () { return null; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 380, height: 700 }; },
    setAttribute: function () {}, getAttribute: function () { return null; },
    closest: function () { return null; }
  };
  e.classList = {
    add: function () { for (const c of arguments) e._classes.add(c); },
    remove: function () { for (const c of arguments) e._classes.delete(c); },
    contains: function (c) { return e._classes.has(c); },
    toggle: function (c, force) {
      if (force === undefined) force = !e._classes.has(c);
      if (force) e._classes.add(c); else e._classes.delete(c);
      return force;
    }
  };
  return e;
}
function makeLocal() {
  const mem = {};
  return { getItem: k => (k in mem) ? mem[k] : null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
}

/* A world with the REAL shifttrack.js + the REAL app.js bubble
 * block. shellFace=true gives the plugin stub the v227 bubbleState
 * method (the shell draws its own face); false = an old shell. */
function makeWorld(shellFace) {
  const storeData = {};
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['bubbleFace', 'bubClock', 'bubStatus', 'bubLoads', 'bubPlay', 'bubPlus', 'bubMinus', 'bubStop'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(id); });
  reg.bubbleFace.classList.add('hidden');
  const pushed = [];
  const listeners = {};
  const pluginStub = {
    start: function () { return Promise.resolve({ started: true }); },
    stop: function () { return Promise.resolve({ stopped: true }); },
    status: function () { return Promise.resolve({ available: true, sessionActive: false }); },
    readCrumbs: function () { return Promise.resolve({ crumbs: [], more: false }); },
    ack: function () { return Promise.resolve({ deleted: 0 }); },
    setDriving: function () { return Promise.resolve({}); },
    setSession: function () { return Promise.resolve({}); },
    enterPip: function () { return Promise.resolve({ ok: true }); },
    addListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); return Promise.resolve({}); }
  };
  if (shellFace) {
    pluginStub.bubbleState = function (s) { pushed.push(s); return Promise.resolve({}); };
    pluginStub.takePipAction = function () { return Promise.resolve({ action: '' }); };
  }
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
    window: null, localStorage: makeLocal(),
    document: {
      hidden: false, visibilityState: 'visible',
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return el(); },
      getElementById: function (id) { return reg[id] || null; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } }
    },
    Capacitor: { Plugins: { ShiftTrack: pluginStub } },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      tracker: { status: 'running' },
      _pip: false, _docked: false, _pipLine: '',
      _authLocked: function () { return false; },
      trackerToggle: function () {}, trackerStop: function () {},
      trackerStopPrompt: function () {}, showDashboard: function () {},
      openModule: function () {}
    },
    sessionActive: function () { return true; },
    trackerElapsedSec: function () { return 1926; },
    fmtClock: function (s) {
      s = Math.max(0, Math.floor(s || 0));
      function p(n) { return (n < 10 ? '0' : '') + n; }
      return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
    },
    loadsGlance: function () { return '🚛 0 loads'; },
    trackerAddLoadTap: function () { return {}; },
    trackerCutLoadTap: function () { return {}; },
    trackerPaint: function () {},
    el: function () { return null; }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(read('js/shifttrack.js'), world, { filename: 'shifttrack.js' });
  const appjs = read('js/app.js');
  const i0 = appjs.indexOf('App._bubble = false;');
  const i1 = appjs.indexOf('/* v220 (WIDGET-CONTROLS)');
  if (i0 < 0 || i1 < 0 || i1 <= i0) throw new Error('bubble block markers missing');
  vm.runInContext(appjs.slice(i0, i1), world, { filename: 'appjs-bubble-block' });
  return { world: world, reg: reg, pushed: pushed };
}
function refresh(w) {
  if (typeof w.world.refreshBubbleFace !== 'function') throw new Error('refreshBubbleFace not exposed by the block');
  w.world.refreshBubbleFace();
}
function paint(w, sec) {
  if (typeof w.world.paintBubble !== 'function') throw new Error('paintBubble not exposed by the block');
  w.world.paintBubble(sec);
}

/* ================= PART A — behaviour ================= */
console.log('PART A — one float only (his state: running, 00:32:06, 0 loads)');
{
  /* the v227+ shell: it draws its own PiP face. */
  const w = makeWorld(true);
  w.world.App._pip = true;
  refresh(w);
  ok('A1 in system PiP with a shell-drawn face, the web face STANDS DOWN (hidden) — one float, not two',
    w.reg.bubbleFace.classList.contains('hidden'));
  paint(w, 1926);
  const last = w.pushed[w.pushed.length - 1] || {};
  ok('A2 the fact mirror still feeds the shell face while the web face is down (status/primary/secondary live)',
    last.status === 'Working…' && last.primary === '00:32:06' && last.secondary === '🚛 0 loads',
    JSON.stringify(last));
  w.world.App._pip = false;
  w.world.App.setDriveDocked(true);
  ok('A3 Back-dock still floats the web face over the dashboard (bub-dock posture, visible)',
    !w.reg.bubbleFace.classList.contains('hidden') && w.reg.bubbleFace.classList.contains('bub-dock'));
  ok('A4 the docked face paints his live facts (timer 00:32:06 + load tracker)',
    w.reg.bubClock.textContent === '00:32:06' && w.reg.bubLoads.textContent === '🚛 0 loads',
    w.reg.bubClock.textContent + ' / ' + w.reg.bubLoads.textContent);
  ok('A5 WORKING paints the big bubble GREEN with the pause glyph (colour law: green = working)',
    w.reg.bubPlay.classList.contains('bub-go') && !w.reg.bubPlay.classList.contains('bub-pause') && w.reg.bubPlay.textContent === '⏸',
    'go=' + w.reg.bubPlay.classList.contains('bub-go') + ' pause=' + w.reg.bubPlay.classList.contains('bub-pause') + ' glyph=' + w.reg.bubPlay.textContent);
  w.world.App.tracker.status = 'paused';
  paint(w, 1926);
  ok('A6 PAUSED paints the big bubble YELLOW with the play glyph (colour law: yellow = pause)',
    w.reg.bubPlay.classList.contains('bub-pause') && !w.reg.bubPlay.classList.contains('bub-go') && w.reg.bubPlay.textContent === '▶',
    'go=' + w.reg.bubPlay.classList.contains('bub-go') + ' pause=' + w.reg.bubPlay.classList.contains('bub-pause') + ' glyph=' + w.reg.bubPlay.textContent);
  w.world.App.tracker.status = 'running';
}
{
  /* an old shell with no bubbleState: the web face is the ONLY
     float there is — it must keep showing in PiP. */
  const w = makeWorld(false);
  w.world.App._pip = true;
  refresh(w);
  ok('A7 old shell (no shell-drawn face): the web bubble face still shows in PiP — the fallback is not broken',
    !w.reg.bubbleFace.classList.contains('hidden'));
}

/* ================= PART B — web cluster statics ================= */
console.log('PART B — the web cluster: bubbles + pill, gaps see-through');
const idx = read('index.html');
const css = read('css/style.css');
function rule(selector) {
  const i = css.indexOf(selector);
  if (i < 0) return '';
  const j = css.indexOf('}', i);
  return j < 0 ? '' : css.slice(i, j + 1);
}
{
  const f0 = idx.indexOf('id="bubbleFace"');
  const face = f0 < 0 ? '' : idx.slice(f0, f0 + 2600);
  const iBar = face.indexOf('bub-bar');
  const iClock = face.indexOf('id="bubClock"');
  const iPlus = face.indexOf('id="bubPlus"');
  const iLoads = face.indexOf('id="bubLoads"');
  const iMinus = face.indexOf('id="bubMinus"');
  const iPlay = face.indexOf('id="bubPlay"');
  const iStop = face.indexOf('id="bubStop"');
  ok('B1 #bubbleFace markup is the cluster: big bubble (bubPlay.bub-main), stop bubble (bubStop.bub-stopb), pill bar (bub-bar)',
    /id="bubPlay" class="[^"]*bub-main/.test(face) && /id="bubStop" class="[^"]*bub-stopb/.test(face) && iBar >= 0);
  ok('B2 the TIMER and the LOAD TRACKER (count with −1/+1) live INSIDE the pill bar, under the bubbles',
    iBar >= 0 && iClock > iBar && iMinus > iBar && iLoads > iBar && iPlus > iBar && iPlay >= 0 && iPlay < iBar && iStop >= 0 && iStop < iBar,
    'bar=' + iBar + ' clock=' + iClock + ' minus=' + iMinus + ' loads=' + iLoads + ' plus=' + iPlus + ' play=' + iPlay + ' stop=' + iStop);
  ok('B3 the status/direction line rides inside the bar too (bubStatus in the bar — no words float outside the shapes)',
    face.indexOf('id="bubStatus"') > iBar);
  const faceRule = rule('#bubbleFace{') + rule('#bubbleFace {');
  ok('B4 #bubbleFace itself is TRANSPARENT — no solid fill behind the cluster (his 10:54 rule)',
    !/#0C1424/i.test(faceRule) && !/background\s*:\s*#/.test(faceRule), faceRule);
  const dockRule = rule('.bub-dock{') + rule('.bub-dock {');
  ok('B5 the docked posture is NOT a card either: no background fill, no border, no card shadow on .bub-dock',
    !/background\s*:/.test(dockRule) && !/border\s*:/.test(dockRule) && !/box-shadow\s*:/.test(dockRule), dockRule);
  const mainRule = rule('.bub-main{') + rule('.bub-main {');
  const stopRule = rule('.bub-stopb{') + rule('.bub-stopb {');
  ok('B6 both bubbles are ROUND (border-radius:50%)',
    /border-radius\s*:\s*50%/.test(mainRule) && /border-radius\s*:\s*50%/.test(stopRule));
  const px = function (r, prop) { const m = r.match(new RegExp(prop + '\\s*:\\s*(\\d+)px')); return m ? +m[1] : 0; };
  ok('B7 the RED bubble is clearly SMALLER than the green, and sits RIGHT + LOWER (its 4–5 o\'clock)',
    px(stopRule, 'width') > 0 && px(stopRule, 'width') < px(mainRule, 'width') &&
    px(stopRule, 'left') > 0 && px(stopRule, 'top') > 0,
    'main w=' + px(mainRule, 'width') + ' stop w=' + px(stopRule, 'width') + ' left=' + px(stopRule, 'left') + ' top=' + px(stopRule, 'top'));
  const barRule = rule('.bub-bar{') + rule('.bub-bar {');
  ok('B8 the bar is a PILL (border-radius 999px) and is itself solid navy — the only solid besides the bubbles',
    /border-radius\s*:\s*999px/.test(barRule) && /background\s*:\s*#0C1424/i.test(barRule), barRule);
  ok('B9 load correction colours in the bar: +1 GREEN, −1 RED (his standing law)',
    /#bubPlus\s*\{[^}]*var\(--green\)/.test(css) && /#bubMinus\s*\{[^}]*var\(--red\)/.test(css));
  const clusterRule = rule('.bub-cluster{') + rule('.bub-bubbles{');
  ok('B10 the cluster wrappers carry NO background of their own — the gaps stay see-through',
    !/background\s*:/.test(clusterRule), clusterRule);
  ok('B11 the face container lets taps fall through the gaps (pointer-events:none on the container, auto on the shapes)',
    /pointer-events\s*:\s*none/.test(faceRule) && /pointer-events\s*:\s*auto/.test(css));
}

/* ================= PART C — native statics ================= */
console.log('PART C — the native float: transparent cluster + widget stand-down');
const NAT = path.join(ROOT, '..', 'meticulous-native', 'android', 'app', 'src', 'main');
const pip = fs.readFileSync(path.join(NAT, 'java', 'com', 'meticuloustechnologies', 'app', 'PipFaceView.java'), 'utf8');
const main = fs.readFileSync(path.join(NAT, 'java', 'com', 'meticuloustechnologies', 'app', 'MainActivity.java'), 'utf8');
const widget = fs.readFileSync(path.join(NAT, 'java', 'com', 'meticuloustechnologies', 'app', 'TrackerWidget.java'), 'utf8');
const plugin = fs.readFileSync(path.join(NAT, 'java', 'com', 'meticuloustechnologies', 'app', 'ShiftTrackPlugin.java'), 'utf8');
{
  const circles = (pip.match(/drawCircle\(/g) || []).length;
  ok('C1 the native face draws ROUND BUBBLES (drawCircle ×2+) and a rounded PILL bar (drawRoundRect with a real radius)',
    circles >= 2 && /drawRoundRect\([^,]+,\s*[a-zA-Z]/.test(pip), 'circles=' + circles);
  ok('C2 NO full-window opaque fill remains (the dark rectangle is gone): no 0-radius full fill, no canvas.drawRect',
    !/drawRoundRect\(rect,\s*0,\s*0/.test(pip) && !/canvas\.drawRect\(/.test(pip));
  const frac = function (name) { const m = pip.match(new RegExp(name + '\\s*=\\s*([0-9.]+)f')); return m ? parseFloat(m[1]) : 0; };
  const g = frac('GREEN_D_FRAC'), r = frac('RED_D_FRAC');
  ok('C3 named geometry: the green bubble DOMINATES (≥0.44 of the float) and the red is clearly smaller (≤0.36, < green)',
    g >= 0.44 && r > 0 && r <= 0.36 && r < g, 'green=' + g + ' red=' + r);
  ok('C4 state colours present: green 46,204,113 · red 231,76,60 · yellow 241,196,15',
    /Color\.rgb\(46,\s*204,\s*113\)/.test(pip) && /Color\.rgb\(231,\s*76,\s*60\)/.test(pip) && /Color\.rgb\(241,\s*196,\s*15\)/.test(pip));
  ok('C5 paused maps to the YELLOW bubble; glyphs are drawn shapes (play triangle / pause bars / stop square)',
    /"Paused"/.test(pip) && /amber/.test(pip) && (/drawPath\(/.test(pip) || /drawRect\(/.test(pip)));
  ok('C6 the load correction pair rides the bar in native too: + circle GREEN, − circle RED, count between them',
    /plusPaint/.test(pip) && /minusPaint/.test(pip) && /drawCircle/.test(pip));
  const showI = main.indexOf('showPipFace()');
  const showSlice = showI < 0 ? '' : main.slice(showI, showI + 4500);
  ok('C7 while the cluster is up, the WebView is INVISIBLE and the window background goes TRANSPARENT — the gaps show what is underneath',
    /INVISIBLE/.test(showSlice) && /TRANSPARENT/.test(showSlice));
  const hideI = main.indexOf('hidePipFace()');
  const hideSlice = hideI < 0 ? '' : main.slice(hideI, hideI + 3000);
  ok('C8 leaving the float restores the app face (WebView VISIBLE again, background restored)',
    /VISIBLE/.test(hideSlice));
  const pipModeI = main.indexOf('onPictureInPictureModeChanged');
  const pipModeSlice = pipModeI < 0 ? '' : main.slice(pipModeI, pipModeI + 1800);
  ok('C9 PiP enter/exit stands the home-screen widget down and back up (setFloatActive on the mode change + a literal-false restore in the native sources)',
    /setFloatActive/.test(pipModeSlice) && /setFloatActive\([^,]+,\s*false\)/.test(main + plugin));
  ok('C10 the widget builds a STOOD-DOWN tile while the float is up (quiet brand tile, no second face)',
    /float_active|isFloatActive/.test(widget) && /widget_tracker_down/.test(widget));
  const downPath = path.join(NAT, 'res', 'layout', 'widget_tracker_down.xml');
  const down = fs.existsSync(downPath) ? fs.readFileSync(downPath, 'utf8') : '';
  ok('C11 the stood-down tile exists: brand word only — no timer, no loads, no buttons (never a second face)',
    /METICULOUS/.test(down) && !/widget_primary|widget_secondary|widget_btn/.test(down));
  ok('C12 the shell face contract is untouched: bubbleState still stores status/primary/secondary/line',
    /bubStatus/.test(plugin) && /bubPrimary/.test(plugin) && /bubSecondary/.test(plugin) && /bubLine/.test(plugin));
  ok('C13 no web content rides the native face (shell-drawn only, per the v227 contract)',
    !/WebView|MapView|Leaflet|nv_drive|directions/i.test(pip));
}

/* ================= PART D — release pins ================= */
/* Pins as shipped in v231 (web 231 / APK 41); moved forward by
   the standing pin move since (v232 NAV-MAP-BLANK, v234
   PIP-HOME-SHOWS-FACE-NOT-MAP) — the D checks track the current
   pins, the v231 ship record lives in version.json history. */
console.log('PART D — release pins (shipped as APK v41 / web v231; pins since moved to v234 / v42)');
{
  const vj = JSON.parse(read('version.json'));
  ok('D1 version.json pins (current standing move)', vj.webVersion === 241 && vj.version === 42,
    'webVersion=' + vj.webVersion + ' version=' + vj.version);
  const app = read('js/app.js');
  ok('D2 APK_VERSION 42 in js/app.js (was 41 at the v231 ship)', /var APK_VERSION = 42;/.test(app));
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
if (fail) { console.log('FAILING: ' + fails.join(' | ')); process.exit(1); }
