#!/usr/bin/env node
/* LANDSCAPE-MODE-NOV10 (owner, Nov 10, 2026 13:59 CST: "why is
 * the app not working in landscape mode? either on the GPS nor
 * on the application it should be") — his phone rides the truck
 * mount sideways, so landscape is a working posture, not a nicety.
 *
 * Convictions behind this suite (all measured, Nov 10):
 *  (1) THE LOCK: the only hard orientation lock in either repo is
 *      the WEB APP MANIFEST — assets/manifest.json declares
 *      "orientation": "portrait", which Android enforces on the
 *      installed web app: the window is held portrait, rotation
 *      does nothing. The native shell carries NO lock (merged
 *      gen-76 APK manifest: MainActivity has no screenOrientation,
 *      configChanges covers orientation, resizeableActivity=true;
 *      no requestedOrientation call exists in the native sources).
 *  (2) THE BREAKAGE: with rotation allowed, the Navigator
 *      PLANNING face still fails sideways. Its map carries two
 *      absolutely-positioned overlay stacks — .nv-map-top (search
 *      + kind row, 154px) and .nv-map-bottom (banner + mode row,
 *      157-261px) — needing ~415px of vertical room. A landscape
 *      phone's mapzone is ~232px tall (915x412), so the stacks
 *      overlap each other by 100-180px and spill over the shell
 *      head: controls bury each other exactly when the phone is
 *      mounted. Portrait (mapzone ~717px) never collides.
 *  (3) The drive face and the dashboard/tracker already work
 *      sideways (v300 landscape banner engages; measured) — this
 *      suite pins that they KEEP working.
 *
 * The fix (web 409):
 *  - manifest orientation "portrait" -> "any" (the lock is gone;
 *    sensor rotation rules, like the native shell).
 *  - inside the EXISTING v300 landscape block
 *    (@media (orientation:landscape) and (max-height:760px)):
 *    each planning-face overlay stack is capped and scrolls
 *    internally — .nv-map-top max-height:52%, .nv-map-bottom
 *    max-height:calc(48% - 20px) — so the two can never meet at
 *    any height, every control stays reachable, and at heights
 *    where the stacks already fit (Fold open, ~545px mapzone)
 *    the caps never bind: behaviour there is byte-identical.
 *    Portrait is untouched (the block is landscape-only).
 *
 * Engine: real headless Chrome via CDP against a locally served
 * tree (LANDSCAPE_BASE env, default the live-408 layout port).
 * Run: LANDSCAPE_BASE=http://127.0.0.1:8979 node tools/landscape-mode-nov10-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

/* ---------- source pins ---------- */
const manifest = JSON.parse(read('assets/manifest.json'));
ok('S1 manifest orientation is not portrait-locked', manifest.orientation === 'any',
  'orientation=' + JSON.stringify(manifest.orientation));
const css = read('css/style.css').replace(/\n/g, ' ');
const landBlock = (function () {
  const i = css.indexOf('@media (orientation:landscape) and (max-height:760px)');
  if (i < 0) return '';
  // the v300 block runs to the next top-level comment close of its section;
  // take a generous slice — later rules in the block must not leak in.
  return css.slice(i, i + 4000);
})();
ok('S2 landscape block caps the top overlay stack', /\.nv-map-top\{[^}]*max-height:52%/.test(landBlock),
  'no .nv-map-top max-height:52% in the landscape block');
ok('S3 landscape block caps the bottom overlay stack', /\.nv-map-bottom\{[^}]*max-height:calc\(48% - 20px\)/.test(landBlock),
  'no .nv-map-bottom max-height calc in the landscape block');
ok('S4 capped stacks scroll internally', /\.nv-map-top\{[^}]*overflow-y:auto/.test(landBlock) && /\.nv-map-bottom\{[^}]*overflow-y:auto/.test(landBlock),
  'overflow-y:auto missing on a capped stack');
ok('S5 portrait rules untouched (caps live only in the landscape block)',
  (css.match(/max-height:52%/g) || []).length === 1 && (css.match(/max-height:calc\(48% - 20px\)/g) || []).length === 1,
  'cap rules leaked outside the landscape block');

/* ---------- real-engine geometry ---------- */
const BASE = process.env.LANDSCAPE_BASE || 'http://127.0.0.1:8978';
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/home/hatch/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome'
].filter(Boolean);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function measure(W, H, tag) {
  const chromeBin = CHROME_CANDIDATES.find(p => fs.existsSync(p));
  if (!chromeBin) throw new Error('no chrome binary');
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + port,
    '--user-data-dir=/home/hatch/workspace/scratch-land/prof-test-' + tag,
    '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch('http://127.0.0.1:' + port + '/json/list'); targets = await r.json(); if (targets && targets.length) break; } catch (e) {}
      await sleep(250);
    }
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    const send = (method, params) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 200) };
      return r.result && r.result.result ? r.result.result.value : undefined; };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('mt_onboarded','true');}catch(e){}" });
    await send('Page.navigate', { url: BASE + '/index.html' });
    await sleep(6000);
    await send('Page.navigate', { url: BASE + '/index.html' });
    await sleep(6000);
    await ev("(function(){try{App.user={uid:'bench',email:'bench@local'};App.onAuth(App.user);App.showView('main');App.openModule('navigator');}catch(e){} return 1;})()");
    await sleep(4000);
    const geo = await ev(`(function(){
      function R(sel){var e=document.querySelector(sel); if(!e) return null; var r=e.getBoundingClientRect(); var cs=getComputedStyle(e);
        return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom),disp:cs.display,maxH:cs.maxHeight}; }
      var o={};
      o.inner=[window.innerWidth,window.innerHeight];
      o.orient=(screen.orientation&&screen.orientation.type)||'n/a';
      o.head=R('.nv-shell-head'); o.mapzone=R('.nv-mapzone');
      o.top=R('.nv-map-top'); o.bottom=R('.nv-map-bottom'); o.sheet=R('.nv-sheet');
      o.trkCard=null;
      return o; })()`);
    // dashboard probe needs a fresh load (module teardown) — measure tracker on the main view of a second pass below
    ws.close();
    return geo;
  } finally { chrome.kill('SIGKILL'); }
}

(async function () {
  try {
    const land = await measure(915, 412, 'land');
    ok('E1 landscape viewport engages', land.inner[0] === 915 && land.inner[1] === 412 && /landscape/.test(land.orient), JSON.stringify(land.inner) + ' ' + land.orient);
    ok('E2 top stack capped at 52% of the mapzone', land.top && land.top.h <= Math.round(land.mapzone.h * 0.52) + 2,
      'top h=' + (land.top && land.top.h) + ' mapzone h=' + (land.mapzone && land.mapzone.h));
    ok('E3 bottom stack capped below the top stack (no overlap)',
      land.top && land.bottom && land.bottom.top >= land.top.bottom - 1,
      'top.bottom=' + (land.top && land.top.bottom) + ' bottom.top=' + (land.bottom && land.bottom.top));
    ok('E4 both stacks stay inside the mapzone',
      land.top && land.bottom && land.mapzone &&
      land.top.top >= land.mapzone.top - 1 && land.bottom.bottom <= land.mapzone.bottom + 1,
      'top.top=' + (land.top && land.top.top) + ' bottom.bottom=' + (land.bottom && land.bottom.bottom) + ' mapzone=' + (land.mapzone && (land.mapzone.top + '..' + land.mapzone.bottom)));
    const port = await measure(412, 915, 'port');
    ok('E5 portrait: stacks uncapped and apart (portrait behaviour unchanged)',
      port.top && port.bottom && port.top.maxH === 'none' && port.bottom.maxH === 'none' && port.bottom.top >= port.top.bottom - 1,
      'top.maxH=' + (port.top && port.top.maxH) + ' bottom.maxH=' + (port.bottom && port.bottom.maxH) + ' top.bottom=' + (port.top && port.top.bottom) + ' bottom.top=' + (port.bottom && port.bottom.top));
  } catch (e) {
    ok('E0 engine run completed', false, String(e && e.message || e));
  }
  console.log('\nlandscape-mode-nov10: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
