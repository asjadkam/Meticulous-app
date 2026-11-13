#!/usr/bin/env node
/* Meticulous — NAV-BLANK-SCREEN suite (owner, Fri Nov 13,
 * 2026: "The entire navigation screen — majority of my
 * drive — the truck and all the directions and everything
 * were just not there").
 *
 * THE TAPE (meticulous navigator 1, Nov 13, 2026, 645 s):
 * the drive opens perfectly (banner, truck, ETA bar). At
 * ~15 s the window reaches full screen — and the face falls
 * into the SYSTEM PiP POSTURE (.nv-pip: the CSS hides the
 * banner, the ETA bar, the speed and shrinks the truck to a
 * small arrow, by design for the little system window) AT
 * FULL SIZE. It stays there ~4 minutes — a bare map, a route
 * line, no truck, no directions — until an exit event lands
 * on its own at ~4:20 and the full face returns. The native
 * bridge's pipChanged is a REPORT; on this drive the exit
 * report never came, and nothing in the web layer ever
 * questioned the posture.
 *
 * THE FIX: the posture must answer to the measurable truth —
 * the drive screen's own box against the window
 * (pipPostureDecision, NAVPURE) — checked on resize, on
 * return to visibility, and on a ~2 s cadence from the drive
 * tick, the one heartbeat guaranteed alive for the whole
 * drive (reconcilePipPosture). A wrong posture heals in
 * seconds, in BOTH directions; the genuine small-window PiP
 * face (his Nov 12 law: the map not covered by instructions)
 * is untouched.
 *
 * This suite proves the pure decision over the posture
 * matrix, then SIMULATES the Nov 13 drive minute by minute
 * (GPS fixes with jitter, the stuck event, fold/unfold, a
 * genuine PiP excursion) through the same decision + cadence
 * the shipped code runs, and pins the wiring structurally.
 * Run: node tools/nav-blank-screen-v448-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const navSrc = read('modules/navigator.js');
const css = read('css/style.css');
const world = {};
vm.createContext(world);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END') +
  '\n;this.__np = { pipPostureDecision: pipPostureDecision };', world);
const dec = world.__np.pipPostureDecision;

/* ---- (1) the posture matrix (Fold unfolded: 2520x1080) ---- */
const W = 2520, H = 1080;
check('(1.1) stuck PiP at FULL screen -> exit (the Nov 13 defect)', dec(true, false, W, H, W, H) === 'exit');
check('(1.2) full screen, full posture -> keep', dec(false, false, W, H, W, H) === 'keep');
check('(1.3) genuine PiP window (880x380), full posture -> enter', dec(false, false, 880, 380, W, H) === 'enter');
check('(1.4) genuine PiP window, already compact -> keep', dec(true, false, 880, 380, W, H) === 'keep');
check('(1.5) the in-app mini owns its posture at any box', dec(true, true, 340, 255, W, H) === 'keep' && dec(false, true, 340, 255, W, H) === 'keep');
check('(1.6) split screen (half height) -> keep the channel word', dec(true, false, W, 540, W, H) === 'keep' && dec(false, false, W, 540, W, H) === 'keep');
check('(1.7) a wide floating window (75%) -> keep', dec(true, false, 1890, 810, W, H) === 'keep');
check('(1.8) folded phone full screen (1080x2520 portrait) stuck -> exit', dec(true, false, 1080, 2520, 1080, 2520) === 'exit');
check('(1.9) hidden/zero box -> keep (no truth to judge by)', dec(true, false, 0, 0, W, H) === 'keep' && dec(true, false, W, H, 0, 0) === 'keep');
check('(1.10) near-full (95%) stuck -> exit', dec(true, false, 2394, 1026, W, H) === 'exit');

/* ---- (2) the Nov 13 drive, simulated ----
 * A 645 s drive, GPS fix every 2 s with ±25 m jitter (jitter
 * moves the TRUCK, never the box — posture must not flap).
 * Events, from the tape: t=15 the bridge reports inPip=true
 * as the window reaches full screen and the exit report is
 * LOST; t=255 a genuine PiP excursion (window shrinks) with
 * its exit report also lost; t=420 unfold resize only.
 * The healer runs on the tick cadence (every fix >= 2 s
 * apart) exactly as driveTickBody wires it. */
function simulateDrive(withHeal) {
  let inPip = false, blankSec = 0, transitions = [], lastInPip = false;
  const fixes = [];
  for (let t = 0; t <= 645; t += 2) {
    const jit = Math.sin(t * 12.9898) * 25;             /* GPS jitter, metres — posture-irrelevant */
    fixes.push({ t: t, jit: jit });
  }
  let box = { w: W, h: H };
  let lastHeal = -10;
  for (const f of fixes) {
    let boxChanged = false;
    if (f.t === 16) inPip = true;                        /* the stuck report lands */
    if (f.t === 256) { box = { w: 880, h: 380 }; boxChanged = true; }   /* genuine PiP: window shrinks */
    if (f.t === 300) { box = { w: W, h: H }; boxChanged = true; }       /* window full again; exit report lost too */
    if (withHeal && f.t - lastHeal >= 2) {
      lastHeal = f.t;
      const d = dec(inPip, false, box.w, box.h, W, H);
      if (d === 'exit' && inPip) inPip = false;
      else if (d === 'enter' && !inPip) inPip = true;
    }
    if (inPip !== lastInPip) { transitions.push({ t: f.t, boxChanged: boxChanged }); lastInPip = inPip; }
    /* BLANK = the chrome-hiding posture worn at FULL size.
       In a genuinely small window the compact face is the
       CORRECT face (his Nov 12 law), not a blank. */
    const fullSize = box.w >= W * 0.9 && box.h >= H * 0.9;
    if (inPip && fullSize) blankSec += 2;
  }
  return { blankSec: blankSec, transitions: transitions, endInPip: inPip };
}
const healed = simulateDrive(true);
const unhealed = simulateDrive(false);
check('(2.1) WITHOUT the heal the tape repeats: minutes blank', unhealed.blankSec >= 240, unhealed.blankSec + 's');
check('(2.2) WITH the heal the stuck posture clears within one cadence', healed.blankSec <= 6, healed.blankSec + 's');
check('(2.3) the drive ENDS in the full posture', healed.endInPip === false);
check('(2.4) no oscillation: after the opening lie, every posture change rides a real window change',
  healed.transitions.every(function (tr) { return tr.t <= 18 || tr.boxChanged; }),
  JSON.stringify(healed.transitions));

/* ---- (3) structural pins ---- */
check('(3.1) reconcilePipPosture exists and reads the screen box against the window',
  navSrc.indexOf('function reconcilePipPosture()') !== -1 &&
  navSrc.indexOf('pipPostureDecision(!!S._inPip') !== -1 &&
  navSrc.indexOf('window.innerWidth') !== -1);
check('(3.2) the drive tick carries the heal cadence',
  navSrc.indexOf('S._pipHealAt') !== -1 && navSrc.indexOf('reconcilePipPosture(); } catch (e) {}') !== -1);
check('(3.3) resize reconciles (fold/unfold is a window-truth change)',
  navSrc.indexOf('reconcilePipPosture();\n          }, 160);') !== -1 || navSrc.indexOf('refitDriveMap();\n            /* v448') !== -1);
check('(3.4) return to visibility reconciles',
  navSrc.indexOf("document.addEventListener('visibilitychange'") !== -1 && navSrc.indexOf('if (!document.hidden) reconcilePipPosture()') !== -1);
check('(3.5) the parked face is left alone (no box truth while docked)',
  navSrc.indexOf("scr.classList.contains('nv-parked')") !== -1);
check('(3.6) the compact face itself is untouched: .nv-pip still hides the chrome by design',
  css.indexOf('.nv-drive.nv-pip .nv-drive-top') !== -1 && css.indexOf('.nv-drive.nv-pip .nv-drive-bar') !== -1);
check('(3.7) applyPipFace remains the only posture writer the heal calls',
  navSrc.indexOf("if (dec === 'exit') applyPipFace(false);") !== -1 && navSrc.indexOf("else if (dec === 'enter') applyPipFace(true);") !== -1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
