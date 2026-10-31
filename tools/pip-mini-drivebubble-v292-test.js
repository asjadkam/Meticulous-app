'use strict';
/* v292 — PIP-MAP-COVERED-BY-DIRECTIONS + BUBBLE-FLOAT-ABSENT
 * (Oct 31, 2026, owner screen recording, pre-session drive):
 *   dashboard "Ready to work", START not pressed, dispatch Aecon
 *   Inf. He opens Navigator, picks Remington, navigates (satellite
 *   full-screen), presses Back -> dashboard; the screen-in-screen
 *   float DOES appear now, but a black directions card
 *   ("40 m · Turn right onto Cornerstone Boulevard NE.") covers
 *   most of the mini map. He leaves the app entirely (Home) -> NO
 *   floating bubble at all (only the home widget and Google Maps'
 *   own PiP visible).
 *
 * PROVEN ROOT CAUSES (code + frames, Oct 31):
 *   Item 1: .nv-drive-pip-line is a centered, wrapping pill
 *   (max-width:94%, white-space:normal, 13px, 6px/12px padding)
 *   inherited unchanged by the compact mini (min(47vw,340px)
 *   wide, 4/3 -> ~145px tall on his phone). The 47-char turn
 *   line wraps to ~4 lines at his font scale, i.e. ~60-70% of
 *   the mini's height: the card IS the mini. The compact-posture
 *   hide list (.nv-pip) also omits the v262/v280 transient
 *   pills .nv-drive-traffic and .nv-drive-offer, which can bury
 *   the small map the same way.
 *   Item 2: MainActivity.onUserLeaveHint's drive branch calls
 *   enterPipNow() and DISCARDS the result. In his recording
 *   Google Maps' own PiP window is already on screen in every
 *   frame; with another app's PiP active the system entry is
 *   refused, and the refusal raises NOTHING: no PiP, and no
 *   bubble either — the bubble branch is session-only, and the
 *   overlay's refresh() auto-hides against an idle record, so
 *   even a session bubble could never exist for this
 *   pre-session drive. The path has no fallback: a silent dead
 *   end, the same family as every prior BUBBLE-FLOAT-ABSENT
 *   verdict. A refused entry also leaves the web layer believing
 *   it is in PiP (onPipWillEnter fired, no pipChanged(false)).
 *
 * FIX SHAPE (kept inside these two items only):
 *   Item 1: under .nv-mini ONLY, the pip line becomes a slim
 *   single-line caption strip pinned to the mini's bottom edge
 *   (left:0/right:0/bottom:0, 11.5px, nowrap + ellipsis) — the
 *   map stays clearly visible; the system-PiP posture keeps the
 *   v273 wrapping pill untouched. Traffic/offer join the .nv-pip
 *   hide set.
 *   Item 2: the drive branch captures enterPipNow()'s result;
 *   on refusal it fires pipChanged(false) to the web (chrome
 *   restored; the parked-mini guard keeps a parked mini's
 *   posture) and raises BubbleOverlay in a DRIVE posture: a
 *   green NAV-arrow button + one caption line ("Navigation —
 *   tap to return", or the last direction line if pushed), no
 *   timer/loads/stop controls (there is no session to control).
 *   Its tap routes the existing FaceActions channel with a new
 *   word 'nav'; the web applyPipAction handles 'nav' by
 *   reopening the Navigator (render restores a parked drive
 *   full-screen). Drive dismissal is its own key, cleared when
 *   the drive disarms and when a new drive arms; the session
 *   dismissal (DISMISSAL_EPOCH 63) is untouched.
 *
 * Run: node tools/pip-mini-drivebubble-v292-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const NAT = path.resolve(ROOT, '..', 'meticulous-native');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function readNat(p) { return fs.readFileSync(path.join(NAT, p), 'utf8'); }
/* rule body for a selector: the text between "sel{" and the next "}" */
function ruleBody(css, sel) {
  const i = css.indexOf(sel + '{');
  if (i < 0) return null;
  const j = css.indexOf('}', i);
  return j < 0 ? null : css.slice(i + sel.length + 1, j);
}
function hasProp(body, prop, val) {
  if (body === null) return false;
  const m = body.match(new RegExp(prop + '\\s*:\\s*([^;]+)', 'i'));
  return !!m && m[1].trim() === val;
}

/* ---------------- Part 1: the mini map must show the MAP -------- */
console.log('Part 1 — PIP-MAP-COVERED-BY-DIRECTIONS (real css/style.css)');
const css = read('css/style.css');
const baseLine = ruleBody(css, '.nv-drive-pip-line');
check('base pip line rule still exists', baseLine !== null);
check('system-PiP posture keeps the v273 wrapping pill (white-space:normal on base)',
  baseLine !== null && hasProp(baseLine, 'white-space', 'normal'));
const miniLine = ruleBody(css, '.nv-drive.nv-mini .nv-drive-pip-line');
check('mini override rule exists (.nv-drive.nv-mini .nv-drive-pip-line)', miniLine !== null);
if (miniLine !== null) {
  check('mini strip: single line (white-space:nowrap)', hasProp(miniLine, 'white-space', 'nowrap'));
  check('mini strip: pinned to the bottom edge (bottom:0)', hasProp(miniLine, 'bottom', '0'));
  check('mini strip: full width (left:0)', hasProp(miniLine, 'left', '0'));
  check('mini strip: full width (right:0)', hasProp(miniLine, 'right', '0'));
  check('mini strip: no centering transform (transform:none)', hasProp(miniLine, 'transform', 'none'));
  check('mini strip: overflow clipped (overflow:hidden)', hasProp(miniLine, 'overflow', 'hidden'));
  check('mini strip: ellipsis (text-overflow:ellipsis)', hasProp(miniLine, 'text-overflow', 'ellipsis'));
  /* geometry at his phone: mini min(47vw,340px) at 411px viewport
     -> 193px wide, 4/3 -> 145px tall. Strip: 11.5px * 1.3 line
     + 5px + 5px padding = ~25px = 17% of the mini, against the
     pre-fix wrapping pill's ~4 lines (~66px + padding = ~45%+). */
  const fsPx = parseFloat((miniLine.match(/font-size\s*:\s*([\d.]+)px/) || [])[1] || '0');
  const lh = parseFloat((miniLine.match(/line-height\s*:\s*([\d.]+)/) || [])[1] || '1');
  const pad = miniLine.match(/padding\s*:\s*([\d.]+)px/);
  const stripH = fsPx * lh + 2 * (pad ? parseFloat(pad[1]) : 0);
  const cover = stripH / 145;
  check('mini strip covers < 30% of the mini height (' + Math.round(cover * 100) + '%)',
    stripH > 0 && cover < 0.30, 'stripH=' + stripH.toFixed(1));
}
const pipHide = (function () {
  /* the .nv-pip hide list is a multi-selector rule; find the rule
     whose selector text mentions .nv-drive-top and read its body */
  const idx = css.indexOf('.nv-drive.nv-pip .nv-drive-top');
  if (idx < 0) return null;
  const brace = css.indexOf('{', idx);
  const end = css.indexOf('}', brace);
  return css.slice(brace + 1, end);
})();
check('compact-posture hide list exists', pipHide !== null);
if (pipHide !== null) {
  check('traffic pill hidden in compact posture (.nv-drive-traffic in hide list)',
    css.indexOf('.nv-drive.nv-pip .nv-drive-traffic') >= 0);
  check('offer pill hidden in compact posture (.nv-drive-offer in hide list)',
    css.indexOf('.nv-drive.nv-pip .nv-drive-offer') >= 0);
}

/* ---------------- Part 2: the leave chain ------------------------ */
console.log('Part 2 — BUBBLE-FLOAT-ABSENT (real Java + real app.js slice)');
const mainAct = readNat('android/app/src/main/java/com/meticuloustechnologies/app/MainActivity.java');
const plugin = readNat('android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackPlugin.java');
const overlay = readNat('android/app/src/main/java/com/meticuloustechnologies/app/BubbleOverlay.java');
const faceActions = readNat('android/app/src/main/java/com/meticuloustechnologies/app/FaceActions.java');
const bubBtn = readNat('android/app/src/main/java/com/meticuloustechnologies/app/BubbleButtonView.java');
const nav = read('modules/navigator.js');
const appJs = read('js/app.js');

check('MainActivity: enterPipNow result is captured (not discarded)',
  /boolean\s+\w+\s*=\s*enterPipNow\(\)/.test(mainAct));
check('MainActivity: a refused drive PiP falls back (not a silent nothing)',
  /onDrivePipRefused/.test(mainAct));
check('plugin: onDrivePipRefused notifies the web pipChanged(false)',
  /onDrivePipRefused/.test(plugin) && /"pipChanged"/.test(plugin) && /inPip",\s*false/.test(plugin));
check('plugin: refusal raises the drive bubble',
  /onDrivePipRefused[\s\S]{0,600}onLeaveHintForDrive/.test(plugin));
check('plugin: drive end retires the drive bubble + clears its dismissal',
  /onDriveEnded/.test(plugin) && /clearDriveDismissal/.test(plugin));
check('plugin: setDriving wires the drive-bubble lifecycle',
  /setDriving[\s\S]{0,800}onDriveEnded/.test(plugin));
check('overlay: onLeaveHintForDrive entry exists', /onLeaveHintForDrive/.test(overlay));
check('overlay: drive dismissal is its own key (dismissed_drive)',
  /dismissed_drive/.test(overlay));
check('overlay: drive posture paints BEFORE the idle-record auto-hide',
  (function () {
    const r = overlay.indexOf('private void refresh()');
    const dm = overlay.indexOf('driveMode', r);
    const idle = overlay.indexOf('SessionRecord.IDLE', r);
    return r >= 0 && dm >= 0 && idle >= 0 && dm < idle;
  })());
check('overlay: close button dispatches by posture (drive -> dismissDrive)',
  /dismissDrive/.test(overlay));
check('overlay: main button dispatches by posture (drive -> nav)',
  /driveMode\s*\?\s*"nav"/.test(overlay));
check('overlay: session dismissal epoch untouched (63, drive key is separate)',
  /DISMISSAL_EPOCH\s*=\s*63/.test(overlay));
check('BubbleButtonView: GLYPH_NAV exists', /GLYPH_NAV/.test(bubBtn));
check('FaceActions: "nav" word routes through openAppWithPipAction',
  /"nav"[\s\S]{0,500}openAppWithPipAction\(app, "nav"\)/.test(faceActions));
check('navigator: hasLiveDrive accessor exists', /hasLiveDrive/.test(nav));

/* the REAL applyPipAction slice from js/app.js, driven against stubs */
(function () {
  const start = appJs.indexOf('function applyPipAction(a) {');
  let depth = 0, end = -1;
  for (let i = start; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  check('app.js: applyPipAction slice extracted', start >= 0 && end > start);
  if (start < 0 || end <= start) return;
  const src = appJs.slice(start, end);
  check('app.js: applyPipAction handles the "nav" word', src.indexOf("'nav'") >= 0);
  const sandbox = {
    window: {}, App: {}, console: console,
    collectSessionRecord: function () { sandbox._adopted = true; },
    applyWidgetAction: function (a) { sandbox._widget = a; },
  };
  sandbox.window.Meticulous = { modules: { navigator: { hasLiveDrive: function () { return true; } } } };
  sandbox.Meticulous = sandbox.window.Meticulous;
  sandbox.window.App = sandbox.App;
  sandbox.App.openModule = function (k) { sandbox._opened = k; };
  vm.createContext(sandbox);
  try {
    vm.runInContext(src + '\napplyPipAction("nav");', sandbox);
    check('web: "nav" word reopens the Navigator (drive live)',
      sandbox._opened === 'navigator', 'opened=' + sandbox._opened);
  } catch (e) {
    check('web: "nav" word reopens the Navigator (drive live)', false, String(e));
  }
  /* stale word: no live drive -> no module open */
  sandbox._opened = undefined;
  sandbox.window.Meticulous.modules.navigator.hasLiveDrive = function () { return false; };
  try {
    vm.runInContext('applyPipAction("nav");', sandbox);
    check('web: stale "nav" word (no live drive) opens nothing', sandbox._opened === undefined);
  } catch (e) {
    check('web: stale "nav" word (no live drive) opens nothing', false, String(e));
  }
})();

/* model of the leave chain, mirroring the Java branch order exactly */
function leaveChain(st) {
  /* st: {navDriving, sessionArmed, pipAccepted, grant, driveDismissed, sessionDismissed} */
  if (st.navDriving) {
    /* onPipWillEnter fires; then the (now captured) enterPipNow result */
    if (st.pipAccepted) return { raised: 'pip', webPipChanged: null };
    /* refused: fallback */
    if (!st.grant) return { raised: 'grant-screen', webPipChanged: false };
    if (st.driveDismissed) return { raised: null, webPipChanged: false };
    return { raised: 'drive-bubble', webPipChanged: false };
  }
  if (st.sessionArmed) {
    if (!st.grant) return { raised: 'grant-screen', webPipChanged: null };
    if (st.sessionDismissed) return { raised: null, webPipChanged: null };
    return { raised: 'session-bubble', webPipChanged: null };
  }
  return { raised: null, webPipChanged: null };
}
const repro = leaveChain({ navDriving: true, sessionArmed: false, pipAccepted: false, grant: true, driveDismissed: false, sessionDismissed: false });
check('model: HIS repro (drive live, no session, PiP refused) raises the DRIVE bubble',
  repro.raised === 'drive-bubble', 'raised=' + repro.raised);
check('model: refused PiP tells the web pipChanged(false)',
  repro.webPipChanged === false);
check('model: PiP accepted -> PiP only, no bubble',
  leaveChain({ navDriving: true, sessionArmed: false, pipAccepted: true, grant: true }).raised === 'pip');
check('model: session-only leave -> session bubble, unchanged',
  leaveChain({ navDriving: false, sessionArmed: true, pipAccepted: false, grant: true, sessionDismissed: false }).raised === 'session-bubble');
check('model: drive bubble dismissed -> next leave raises nothing',
  leaveChain({ navDriving: true, sessionArmed: false, pipAccepted: false, grant: true, driveDismissed: true }).raised === null);

/* ---------------- Part 3: ship pins ------------------------------- */
console.log('Part 3 — ship pins');
const vj = JSON.parse(read('version.json'));
check('webVersion 292', vj.webVersion === 292, 'webVersion=' + vj.webVersion);
check('native version 46', vj.version === 46, 'version=' + vj.version);
check('apkUrl points at the v46 APK', typeof vj.apkUrl === 'string' && vj.apkUrl.indexOf('meticulous-v46.apk') >= 0);
check('APK_VERSION 46 in js/app.js', /var APK_VERSION\s*=\s*46/.test(appJs));
const gradle = readNat('android/app/build.gradle');
check('gradle versionCode 39', /versionCode\s+39/.test(gradle));
check('gradle versionName 1.37', /versionName\s+"1\.37"/.test(gradle));
check('native DISMISSAL_EPOCH still 63 (session semantics untouched)',
  /DISMISSAL_EPOCH\s*=\s*63/.test(overlay));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
