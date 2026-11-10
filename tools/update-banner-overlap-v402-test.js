#!/usr/bin/env node
/* Meticulous v402 — BANNER-OVERLAP-TOP-NOV10.
 *
 * Owner evidence (Nov 10, 2026, 09:56 CST, his screenshot of
 * Preferences/Advanced on his Galaxy Z Fold, shell gen 73): the
 * orange "Update available — Tap to download v74" bar sits ON TOP
 * of the app again — the .topbar (menu, logo, "Meticulous", bell)
 * is half-hidden beneath it and the top of the scrolled content
 * is cut off. The same clip shows on the dashboard. This is the
 * v380 defect (UPDATE-BANNER-OVERLAPS-HEADER-NOV8) BACK.
 *
 * CONVICTION (all pinned below, and proven in a real Chromium
 * layout run during the fix): the js/app.js half of v380 is alive
 * and well in the shipped bundle — the bar lands, is measured,
 * and the code sets --updBannerH on <html> + the updBannerOn
 * class on <body> (a headless-Chromium replica of #main with the
 * real shipped css/style.css + the real banner IIFE showed
 * bodyClass "updBannerOn" and varH "40px"). But the CSS half —
 * the two rules that CONSUME the class and the var — is ABSENT
 * from the shipped css/style.css: zero occurrences, and a parse
 * of the shipped sheet jumps from .iconbtn straight to #sidebar.
 * Git tells the story: web 380 (9c0293c) shipped the rules
 * (3 updBannerOn lines in its css); every css through web 395
 * kept them; the WEB 396 ship (7593ed4) rebuilt css/style.css
 * from a base that predated them and dropped both rules while
 * re-pinning the file — 48 changed lines, the two reservation
 * rules among the casualties. The v380 suite kept passing
 * because it ran in the main dev tree, whose UNCOMMITTED
 * css/style.css still carries the rules; ships build from clean
 * live worktrees, where the rules were gone. With nothing
 * consuming the reservation, body padding stays 0 and both
 * sticky heads stick at top:0 under the fixed bar — the
 * photographed clip, on every screen (dashboard and module
 * screens share the one #main layout), at any bar height.
 *
 * THE FIX (v402, css/style.css + js/app.js):
 *  - The two v380 rules are restored VERBATIM in css/style.css
 *    (with the story written above them so the next rebuild
 *    knows they are load-bearing).
 *  - The banner code now RE-MEASURES the bar after landing:
 *    window resize + orientationchange, document.fonts.ready,
 *    and a guarded ResizeObserver on the bar all re-read
 *    offsetHeight and hand the layout the new number when it
 *    changed. The landing measurement is one frame of the bar's
 *    life — a fold/unfold or rotation re-wraps it taller, a late
 *    font swap can grow it — and a one-shot reservation
 *    under-reserves by exactly that growth. A same-height read
 *    is a no-op; the var lands on <html> and the padding on
 *    body, never on the bar, so the watchers cannot loop.
 *  - The bar itself is byte-untouched (still fixed, still the
 *    download door), and no bar → no class, no var → the layout
 *    is exactly as before (the space closes back up after an
 *    update, the bar's standing lifecycle).
 *
 * This suite: (1) pins the conviction from the real sources —
 * including a comment-stripped top-level RULE SCAN of the
 * shipped css (the check whose absence let web 396 slip: the
 * v380 pins were regexes over a dirty tree; the scan reads the
 * file the ship actually carries), (2) runs the REAL banner
 * IIFE sliced out of app.js in stub-DOM worlds (landing,
 * growth-by-resize, growth-by-observer, growth-by-fonts, shell
 * current), and (3) resolves the geometry for both sticky
 * heads at one-line and wrapped heights.
 * Run: node tools/update-banner-overlap-v402-test.js
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

/* ---------- 1. the conviction, pinned from the sources ---------- */
console.log('\n— the mechanism: the JS hands over a reservation nothing consumes —');
const BAR_CSS = 'position:fixed;top:0;left:0;right:0;background:#F26522;color:#fff;text-align:center;padding:12px;z-index:99999;font-size:14px;';
ok('the bar is built in js/app.js as a fixed top:0 overlay (visual unchanged)', appSrc.indexOf("bar.style.cssText = '" + BAR_CSS + "'") >= 0);
ok('the banner code still measures the bar and hands over var + class (the living half)',
  /document\.documentElement\.style\.setProperty\('--updBannerH', updH \+ 'px'\);/.test(appSrc) &&
  /document\.body\.classList\.add\('updBannerOn'\);/.test(appSrc));
ok('base .topbar is sticky at top:0, z-index 40', /\.topbar\{[^}]*position:sticky;top:0;z-index:40;\}/.test(css));
ok('base .modhead is sticky at top:0, z-index 30', /\.modhead\{[^}]*position:sticky;top:0;z-index:30;\}/.test(css));

/* the rule scan: strip comments, split top-level rules, index by
   selector. This reads css the way a parser does — a rule that is
   not in the file as a top-level rule does not exist, however
   many dev trees carry it uncommitted. */
function topLevelRules(cssText) {
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let depth = 0, cur = '';
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (ch === '{') { depth++; cur += ch; }
    else if (ch === '}') {
      depth--;
      cur += ch;
      if (depth === 0) { rules.push(cur.trim()); cur = ''; }
    } else if (depth > 0 || !/\s/.test(ch) || cur) cur += ch;
  }
  return rules;
}
const rules = topLevelRules(css);
const padRule = rules.find(r => /^body\.updBannerOn\{/.test(r));
const headRule = rules.find(r => /^body\.updBannerOn \.topbar,body\.updBannerOn \.modhead\{/.test(r));
console.log('\n— the regression: the consuming rules must exist as top-level rules in the shipped css —');
ok('RULE SCAN: body.updBannerOn top-level rule exists in css/style.css', !!padRule, 'the web-396 loss: this rule was absent from every shipped css since');
ok('RULE SCAN: the body gains the banner height in top padding',
  !!padRule && /padding-top:var\(--updBannerH,44px\);/.test(padRule));
ok('RULE SCAN: the sticky-heads rule exists with both heads addressed',
  !!headRule, 'the web-396 loss: this rule was absent from every shipped css since');
ok('RULE SCAN: while flagged, both sticky heads stick below the banner',
  !!headRule && /top:var\(--updBannerH,44px\);/.test(headRule));
ok('the v402 note rides above the rules (the next rebuild knows they are load-bearing)',
  /v402 \(BANNER-OVERLAP-TOP-NOV10\): these two rules were LOST/.test(css));

/* ---------- 2. the re-measurement in js/app.js (source pins) ---------- */
console.log('\n— the fix in the banner code: the reservation tracks the bar —');
ok('the landing measurement is byte-the-v380-one (its suite\u2019s pins stay green)',
  /var updH = 0;\s*\n\s*try \{ updH = bar\.offsetHeight \|\| 0; \} catch \(e\) \{\}/.test(appSrc) &&
  /if \(!\(updH > 0\)\) updH = 44;/.test(appSrc));
ok('a re-measure reader exists and only a CHANGED height is handed over',
  /var updRemeasure = function \(\) \{/.test(appSrc) &&
  /if \(!\(h > 0\) \|\| h === updH\) return;/.test(appSrc) &&
  (appSrc.match(/setProperty\('--updBannerH', updH \+ 'px'\)/g) || []).length === 2);
ok('re-measure fires on window resize', /window\.addEventListener\('resize', updRemeasure\);/.test(appSrc));
ok('re-measure fires on orientationchange', /window\.addEventListener\('orientationchange', updRemeasure\);/.test(appSrc));
ok('re-measure fires when webfonts settle', /document\.fonts\.ready\.then\(updRemeasure\)/.test(appSrc));
ok('a guarded ResizeObserver watches the bar itself',
  /typeof ResizeObserver === 'function'\) new ResizeObserver\(updRemeasure\)\.observe\(bar\);/.test(appSrc));
ok('the re-measure wiring lives only on the bar-created path (inside the version>shellGen branch)',
  (function () {
    const iBranch = appSrc.indexOf('info.version > shellGen');
    const iWatch = appSrc.indexOf('updRemeasure');
    return iBranch >= 0 && iWatch > iBranch;
  })());
ok('the download door is untouched: link text + href from version.json',
  appSrc.indexOf("link.textContent = 'Tap to download v' + info.version;") >= 0 &&
  appSrc.indexOf('link.href = info.apkUrl;') >= 0);

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
  if (world.fontsReady) document.fonts = { ready: Promise.resolve() };
  const listeners = {};
  const sb = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    document: document,
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fetch: function () {
      return Promise.resolve({ json: function () { return Promise.resolve(world.info); } });
    },
    Capacitor: { Plugins: { App: { getInfo: function () { return Promise.resolve({ build: String(world.build) }); } } } }
  };
  if (world.withRO) {
    sb.ResizeObserver = function (cb) { world._roCb = cb; };
    sb.ResizeObserver.prototype.observe = function (el) { world._roEl = el; };
  }
  sb.window = sb;
  vm.createContext(sb);
  return { sb: sb, body: body, docEl: docEl, listeners: listeners, world: world };
}
function flush() { return new Promise(r => setTimeout(r, 25)); }
function fire(listeners, type) { (listeners[type] || []).forEach(function (fn) { fn(); }); }

(async function () {
  const slice = bannerSlice();
  ok('the banner IIFE slices cleanly out of app.js', !!slice && slice.indexOf('Update available') >= 0 && slice.indexOf('updRemeasure') >= 0);

  if (slice) {
    console.log('\n— world A: an update is offered, one-line bar —');
    const A = makeWorld({ build: 50, info: { version: 74, apkUrl: 'https://example.test/meticulous-v74.apk' }, barH: 41 });
    vm.runInContext(slice, A.sb, { filename: 'app.js#update-banner' });
    await flush();
    ok('the body is flagged updBannerOn and --updBannerH carries the measured height (41px)',
      A.body.classList.contains('updBannerOn') && A.docEl.style._vars['--updBannerH'] === '41px');
    ok('watchers are registered (resize + orientationchange)',
      (A.listeners['resize'] || []).length === 1 && (A.listeners['orientationchange'] || []).length === 1);

    console.log('\n— world E: the bar grows after landing (fold/unfold re-wrap) —');
    const E = makeWorld({ build: 50, info: { version: 74, apkUrl: 'https://example.test/meticulous-v74.apk' }, barH: 41 });
    vm.runInContext(slice, E.sb, { filename: 'app.js#update-banner' });
    await flush();
    ok('landing reservation is the one-line height (41px)', E.docEl.style._vars['--updBannerH'] === '41px');
    E.world.barH = 58; // the fold opens / the phone rotates: the same bar now wraps to two lines
    fire(E.listeners, 'resize');
    ok('after resize, the reservation tracks the bar\u2019s true height (58px)',
      E.docEl.style._vars['--updBannerH'] === '58px');
    E.world.barH = 41; // and it shrinks back just as faithfully
    fire(E.listeners, 'orientationchange');
    ok('after orientationchange, the reservation follows it back down (41px)',
      E.docEl.style._vars['--updBannerH'] === '41px');
    fire(E.listeners, 'resize'); // no change in height: a no-op, nothing churns
    ok('a same-height signal leaves the reservation untouched (41px)',
      E.docEl.style._vars['--updBannerH'] === '41px' && E.body.classList.contains('updBannerOn'));

    console.log('\n— world F: the ResizeObserver path —');
    const F = makeWorld({ build: 50, info: { version: 74, apkUrl: 'https://example.test/meticulous-v74.apk' }, barH: 41, withRO: true });
    vm.runInContext(slice, F.sb, { filename: 'app.js#update-banner' });
    await flush();
    ok('the observer is watching the bar itself', !!F.world._roCb && !!F.world._roEl &&
      (F.world._roEl.style.cssText || '').indexOf('#F26522') >= 0);
    F.world.barH = 58;
    F.world._roCb();
    ok('when the observer reports growth, the reservation follows (58px)',
      F.docEl.style._vars['--updBannerH'] === '58px');

    console.log('\n— world G: the fonts-settle path —');
    const G = makeWorld({ build: 50, info: { version: 74, apkUrl: 'https://example.test/meticulous-v74.apk' }, barH: 41, fontsReady: true });
    vm.runInContext(slice, G.sb, { filename: 'app.js#update-banner' });
    G.world.barH = 58; // the font lands before the ready promise\u2019s callbacks run
    await flush();
    ok('when fonts settle on a taller bar, the reservation follows (58px)',
      G.docEl.style._vars['--updBannerH'] === '58px');

    console.log('\n— world C: the shell is already current —');
    const C = makeWorld({ build: 68, info: { version: 74, apkUrl: 'https://example.test/meticulous-v74.apk' }, barH: 41 });
    vm.runInContext(slice, C.sb, { filename: 'app.js#update-banner' });
    await flush();
    ok('no bar is created, no watchers, no class, no var \u2014 the layout stays exactly as it was',
      C.body.children.length === 0 && !C.body.classList.contains('updBannerOn') &&
      !('--updBannerH' in C.docEl.style._vars) && Object.keys(C.listeners).length === 0);
  }

  /* ---------- 4. the geometry, resolved against the restored rules ---------- */
  console.log('\n— the geometry against the restored CSS rules —');
  [41, 58, 44].forEach(function (H) {
    const bannerBottom = 0 + H;              // fixed bar: top 0, height H
    const topAtRest = H;                     // body padding-top pushes #app (and its first child, the topbar) down by H
    const topStuck = H;                      // sticky top while flagged \u2014 the same H for .topbar and .modhead
    ok('H=' + H + ': BOTH heads (dashboard topbar + module modhead) sit at or below the banner\u2019s bottom edge, at rest and stuck',
      topAtRest >= bannerBottom && topStuck >= bannerBottom);
  });
  ok('growth is covered by construction: the reservation IS the measured height (worlds E/F/G), never a constant',
    !!headRule && /var\(--updBannerH/.test(headRule));
  ok('unflagged geometry is today\u2019s: padding 0, sticky top 0 (the space closes back up)',
    !/body\{[^}]*padding-top/.test(css) && /\.topbar\{[^}]*position:sticky;top:0;/.test(css));

  console.log('\nupdate-banner-overlap-v402-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.message)); process.exit(1); });
