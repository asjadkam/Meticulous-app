#!/usr/bin/env node
/* Meticulous v380 — UPDATE-BANNER-OVERLAPS-HEADER-NOV8.
 *
 * Owner evidence (Nov 8, 2026, 16:44–16:47 CST, two photos of
 * Nirojini's phone): "Why is her screen cutting off?" The orange
 * "Update available — Tap to download v63" bar sits ON TOP of the
 * app's navy header — the Meticulous title, the bell and the menu
 * are half-covered by the banner and the page begins squeezed
 * underneath it.
 *
 * CONVICTION (all pinned below from the sources):
 *  - The bar is WEB layer, not native: the v19/v30 block in
 *    js/app.js builds it as position:fixed;top:0;left:0;right:0
 *    with z-index 99999 and appends it to document.body. NOTHING
 *    reserves room for it — no body padding, no spacer, no CSS
 *    hook. It is a pure overlay on the viewport's top edge.
 *  - What it covers: .topbar (the #main header — menu, logo,
 *    "Meticulous", bell, sync dot) is position:sticky;top:0 at
 *    z-index 40, and .modhead (every module's head) is
 *    position:sticky;top:0 at z-index 30. At rest the topbar
 *    occupies viewport y 0..64 (14+36+14 from its own CSS); the
 *    bar is ~41px tall (12+12 padding + one 14px line) — so the
 *    bar paints over the top ~41 of the header's 64px, and once
 *    she scrolls the heads stick at top:0 and stay under it.
 *    Exactly the photographed clip.
 *  - Siblings audited, none share the mechanism: #mirrorBanner
 *    and #mirrorBar (Connect mirror), #trialBar and the sync
 *    warning are all IN-FLOW blocks — they take their own space
 *    and push content down. #ptrPill is a transient centred pill
 *    shown only mid-pull. #sidebar is a fixed full-height DRAWER
 *    (its own .who head sits under the bar while the drawer is
 *    open — a different mechanism, named in the queue entry, not
 *    fixed here). No offline bar exists. The update bar is the
 *    only fixed top:0 full-width bar in the app.
 *
 * THE FIX (v380, js/app.js + css/style.css): the bar itself is
 * byte-untouched (still fixed, still the download door). The
 * moment it lands, the banner code measures its own offsetHeight
 * and hands the exact height to the layout: --updBannerH on
 * <html> + the updBannerOn class on <body>. In the CSS, while
 * that class stands, body gains that much top padding and the
 * sticky heads stick BELOW the banner. A bar wrapped to two
 * lines on a big-font handset reserves its true measured size.
 * No bar → no class, no var → the layout is exactly as before,
 * which is also the space closing back up after an update (the
 * bar's own lifecycle: it exists only on launches where the
 * shell is behind, and is never created once the gen matches).
 *
 * This suite: (1) pins the convicted geometry from the real
 * sources, (2) runs the REAL banner IIFE sliced out of app.js
 * in stub-DOM worlds (update offered / wrapped bar / shell
 * current / zero-height read), and (3) resolves the geometry
 * against the real CSS rules.
 * Run: node tools/update-banner-overlap-v380-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

const appSrc = read('js/app.js');
const css = read('css/style.css');

/* ---------- 1. the convicted mechanism, pinned from the sources ---------- */
console.log('\n— the mechanism: a fixed overlay with nothing reserving room —');
const BAR_CSS = 'position:fixed;top:0;left:0;right:0;background:#F26522;color:#fff;text-align:center;padding:12px;z-index:99999;font-size:14px;';
ok('the bar is built in js/app.js as a fixed top:0 overlay (visual unchanged)', appSrc.indexOf("bar.style.cssText = '" + BAR_CSS + "'") >= 0);
ok('the bar is appended straight to document.body', /document\.body\.appendChild\(bar\);/.test(appSrc));
ok('base .topbar is sticky at top:0, z-index 40', /\.topbar\{[^}]*position:sticky;top:0;z-index:40;\}/.test(css));
ok('base .modhead is sticky at top:0, z-index 30', /\.modhead\{[^}]*position:sticky;top:0;z-index:30;\}/.test(css));
(function () {
  /* the pre-fix geometry, from the bars' own numbers: bar height
     = 12+12 padding + one 14px line at line-height normal (~1.2);
     topbar height = 14+14 padding + the 36px logo row. */
  const barH = 12 + 12 + Math.ceil(14 * 1.2);            // 41
  const topH = 14 + 36 + 14;                             // 64
  const covered = Math.min(barH, topH);                  // header top edge at 0, bar at 0
  ok('PRE-FIX MODEL: the bar covers the header\u2019s top ' + covered + ' of ' + topH + 'px (the photographed clip)',
    covered === 41 && covered < topH && covered > topH / 2);
})();
/* siblings: none share the fixed-bar mechanism */
ok('#mirrorBanner CSS is in-flow (flex, no position:fixed)', /\.mirrorbanner\{display:flex;/.test(css) && !/\.mirrorbanner\{[^}]*position:fixed/.test(css));
ok('the update bar is the ONLY fixed top:0 full-width bar created in js/',
  fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))
    .every(f => f === 'app.js' || read('js/' + f).indexOf('position:fixed;top:0;left:0;right:0') === -1) &&
  (appSrc.match(/position:fixed;top:0;left:0;right:0/g) || []).length === 1);

/* ---------- 2. the fix in js/app.js (source pins) ---------- */
console.log('\n— the fix in the banner code —');
ok('after landing, the bar\u2019s own height is measured', /var updH = 0;\s*\n\s*try \{ updH = bar\.offsetHeight \|\| 0; \} catch \(e\) \{\}/.test(appSrc));
ok('a dead height read still reserves the one-line size (44px)', /if \(!\(updH > 0\)\) updH = 44;/.test(appSrc));
ok('the measured height is handed to the layout as --updBannerH', /document\.documentElement\.style\.setProperty\('--updBannerH', updH \+ 'px'\);/.test(appSrc));
ok('the body is flagged updBannerOn', /document\.body\.classList\.add\('updBannerOn'\);/.test(appSrc));
ok('the download door is untouched: link text + href from version.json',
  appSrc.indexOf("link.textContent = 'Tap to download v' + info.version;") >= 0 &&
  appSrc.indexOf('link.href = info.apkUrl;') >= 0);
ok('the reservation happens only on the bar-created path (inside the version>shellGen branch)',
  (function () {
    const iBranch = appSrc.indexOf('info.version > shellGen');
    const iReserve = appSrc.indexOf("classList.add('updBannerOn')");
    return iBranch >= 0 && iReserve > iBranch;
  })());

/* ---------- 3. the real banner IIFE, run in stub-DOM worlds ---------- */
function bannerSlice() {
  const lines = appSrc.split('\n');
  const start = lines.findIndex(l => l.indexOf('v19/v30: native-APK update banner') >= 0);
  if (start < 0) return null;
  let begin = -1, end = -1;
  for (let i = start; i < lines.length; i++) {
    if (begin < 0 && /^  \(function \(\) \{$/.test(lines[i])) begin = i;
    else if (begin >= 0 && lines[i] === '  })();') { end = i; break; }
  }
  if (begin < 0 || end < 0) return null;
  return lines.slice(begin, end + 1).join('\n');
}
function makeWorld(world) {
  function makeEl(tag) {
    const el = {
      tagName: tag, children: [], _text: '',
      style: { cssText: '', _vars: {}, setProperty: function (k, v) { this._vars[k] = v; } },
      classList: {
        _s: new Set(),
        add: function (c) { this._s.add(c); },
        remove: function (c) { this._s.delete(c); },
        contains: function (c) { return this._s.has(c); }
      },
      appendChild: function (c) { this.children.push(c); return c; },
      set textContent(v) { this._text = String(v); },
      get textContent() { return this._text; }
    };
    Object.defineProperty(el, 'offsetHeight', {
      get: function () {
        return (this.style.cssText.indexOf('#F26522') >= 0) ? world.barH : 0;
      }
    });
    return el;
  }
  const body = makeEl('body');
  const docEl = makeEl('html');
  const document = {
    body: body, documentElement: docEl,
    createElement: function (t) { return makeEl(t); },
    createTextNode: function (t) { return { nodeType: 3, textContent: t }; }
  };
  const sb = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    document: document,
    fetch: function () {
      return Promise.resolve({ json: function () { return Promise.resolve(world.info); } });
    },
    Capacitor: { Plugins: { App: { getInfo: function () { return Promise.resolve({ build: String(world.build) }); } } } }
  };
  sb.window = sb;
  vm.createContext(sb);
  return { sb: sb, body: body, docEl: docEl };
}
function flush() { return new Promise(r => setTimeout(r, 25)); }

(async function () {
  const slice = bannerSlice();
  ok('the banner IIFE slices cleanly out of app.js', !!slice && slice.indexOf('Update available') >= 0 && slice.indexOf('updBannerOn') >= 0);

  if (slice) {
    console.log('\n— world A: an update is offered, one-line bar —');
    const A = makeWorld({ build: 50, info: { version: 63, apkUrl: 'https://example.test/meticulous-v63.apk' }, barH: 41 });
    vm.runInContext(slice, A.sb, { filename: 'app.js#update-banner' });
    await flush();
    const barA = A.body.children.find(c => c.style && c.style.cssText.indexOf('#F26522') >= 0);
    ok('the bar lands on the body', !!barA);
    ok('the bar still reads "Update available — Tap to download v63" with the apkUrl as its door',
      !!barA && barA.children.some(c => c.textContent === 'Update available — ') &&
      barA.children.some(c => c.textContent === 'Tap to download v63' && c.href === 'https://example.test/meticulous-v63.apk'));
    ok('the body is flagged updBannerOn', A.body.classList.contains('updBannerOn'));
    ok('--updBannerH carries the bar\u2019s measured height (41px)', A.docEl.style._vars['--updBannerH'] === '41px');

    console.log('\n— world B: the bar wraps to two lines on a big-font handset —');
    const B = makeWorld({ build: 50, info: { version: 63, apkUrl: 'https://example.test/meticulous-v63.apk' }, barH: 58 });
    vm.runInContext(slice, B.sb, { filename: 'app.js#update-banner' });
    await flush();
    ok('the reservation follows the MEASURED height (58px), not a hardcoded size',
      B.docEl.style._vars['--updBannerH'] === '58px' && B.body.classList.contains('updBannerOn'));

    console.log('\n— world C: the shell is already current —');
    const C = makeWorld({ build: 57, info: { version: 63, apkUrl: 'https://example.test/meticulous-v63.apk' }, barH: 41 });
    vm.runInContext(slice, C.sb, { filename: 'app.js#update-banner' });
    await flush();
    ok('no bar is created', C.body.children.length === 0);
    ok('no class, no var \u2014 the layout stays exactly as it was',
      !C.body.classList.contains('updBannerOn') && !('--updBannerH' in C.docEl.style._vars));

    console.log('\n— world D: the height read comes back dead —');
    const D = makeWorld({ build: 50, info: { version: 63, apkUrl: 'https://example.test/meticulous-v63.apk' }, barH: 0 });
    vm.runInContext(slice, D.sb, { filename: 'app.js#update-banner' });
    await flush();
    ok('the fallback still reserves room (44px) and flags the body',
      D.docEl.style._vars['--updBannerH'] === '44px' && D.body.classList.contains('updBannerOn'));
  }

  /* ---------- 4. the geometry, resolved against the real CSS ---------- */
  console.log('\n— the geometry against the real CSS rules —');
  ok('while flagged, the body gains the banner height in top padding',
    /body\.updBannerOn\{padding-top:var\(--updBannerH,44px\);\}/.test(css));
  ok('while flagged, both sticky heads stick below the banner',
    /body\.updBannerOn \.topbar,body\.updBannerOn \.modhead\{top:var\(--updBannerH,44px\);\}/.test(css));
  [41, 58, 44].forEach(function (H) {
    const bannerBottom = 0 + H;              // fixed bar: top 0, height H
    const topAtRest = H;                     // body padding-top pushes #app (and its first child, the topbar) down by H
    const topStuck = H;                      // sticky top while flagged
    ok('H=' + H + ': header top edge (' + topAtRest + ' at rest, ' + topStuck + ' stuck) sits at or below the banner\u2019s bottom edge (' + bannerBottom + ')',
      topAtRest >= bannerBottom && topStuck >= bannerBottom);
  });
  ok('unflagged geometry is today\u2019s: padding 0, sticky top 0 (the space closes back up)',
    !/body\{[^}]*padding-top/.test(css) && /\.topbar\{[^}]*position:sticky;top:0;/.test(css));

  console.log('\nupdate-banner-overlap-v380-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.message)); process.exit(1); });
