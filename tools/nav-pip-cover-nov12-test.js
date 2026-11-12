'use strict';
/* v427 — NAV-PIP-COVER-NOV12 (owner Nov 12, 2026, driving):
 *   screenshot of the floating navigation window over his home
 *   screen (other apps in front, the drive running in system
 *   PiP): the small map carries the direction pill — "200 m ·
 *   Turn left onto Country Hills Boulevard NE." — wrapped ~4
 *   deep and covering most of the window. His order: "fix this
 *   screen — this screen should not be covered with
 *   instructions."
 *
 * PROVEN ROOT (code, this tree): in the system-PiP posture the
 *   drive screen wears .nv-pip (applyPipFace, on the shell's
 *   pipChanged); the .nv-pip hide list removes every other
 *   instruction element (top banner, turn inset, ETA bar,
 *   pills), leaving ONE: #nvd_pip_line, fed by the drive tick
 *   while S._inPip. That line still wore the BASE rule
 *   (.nv-drive-pip-line: centered, max-width:94%,
 *   white-space:normal — the v273 wrapping pill). v292
 *   (PIP-MAP-COVERED-BY-DIRECTIONS) fixed this exact defect for
 *   the in-app MINI posture only and deliberately left the
 *   system PiP posture on the wrapping pill; in the small
 *   system window the pill wraps ~4 lines at his font scale
 *   and IS a card over the map — today's screenshot, digit for
 *   digit the v292 diagnosis one posture over.
 *
 * FIX (css/style.css only): the .nv-pip posture gets the same
 *   slim single-line caption strip the mini got at v292 —
 *   pinned to the bottom edge (left:0/right:0/bottom:0), one
 *   line, nowrap + ellipsis, 11.5px — so during navigation in
 *   PiP the map stays visible and the direction rides as a
 *   caption strip on the bottom edge, never a card over the
 *   road. The full wording stays one tap away (the tap reopens
 *   full navigation; its banner carries the whole instruction)
 *   and the voice speaks it. Base rule and mini rule untouched;
 *   no JS changes — the tick already writes text only.
 *
 * Run: node tools/nav-pip-cover-nov12-test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
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

/* ------------- Part 1: the PiP line is a strip, not a card ------ */
console.log('Part 1 — NAV-PIP-COVER-NOV12 (real css/style.css)');
const css = read('css/style.css');
const baseLine = ruleBody(css, '.nv-drive-pip-line');
check('base pip line rule still exists', baseLine !== null);
const pipLine = ruleBody(css, '.nv-drive.nv-pip .nv-drive-pip-line');
check('system-PiP override rule exists (.nv-drive.nv-pip .nv-drive-pip-line)', pipLine !== null);
if (pipLine !== null) {
  check('pip strip: single line (white-space:nowrap)', hasProp(pipLine, 'white-space', 'nowrap'));
  check('pip strip: pinned to the bottom edge (bottom:0)', hasProp(pipLine, 'bottom', '0'));
  check('pip strip: full width (left:0)', hasProp(pipLine, 'left', '0'));
  check('pip strip: full width (right:0)', hasProp(pipLine, 'right', '0'));
  check('pip strip: no centering transform (transform:none)', hasProp(pipLine, 'transform', 'none'));
  check('pip strip: no width cap (max-width:none)', hasProp(pipLine, 'max-width', 'none'));
  check('pip strip: overflow clipped (overflow:hidden)', hasProp(pipLine, 'overflow', 'hidden'));
  check('pip strip: ellipsis (text-overflow:ellipsis)', hasProp(pipLine, 'text-overflow', 'ellipsis'));
  /* geometry at the small-window scale v292 measured on his
     phone (a ~145px-tall compact window): the strip is
     11.5px * 1.3 line-height + 5px + 5px padding = ~25px =
     ~17% of the window height, against the wrapping pill's
     ~4 lines (~66px + padding = ~45%+) that buried the map. */
  const fsPx = parseFloat((pipLine.match(/font-size\s*:\s*([\d.]+)px/) || [])[1] || '0');
  const lh = parseFloat((pipLine.match(/line-height\s*:\s*([\d.]+)/) || [])[1] || '1');
  const pad = pipLine.match(/padding\s*:\s*([\d.]+)px/);
  const stripH = fsPx * lh + 2 * (pad ? parseFloat(pad[1]) : 0);
  const cover = stripH / 145;
  check('pip strip covers < 30% of a 145px window height (' + Math.round(cover * 100) + '%)',
    stripH > 0 && cover < 0.30, 'stripH=' + stripH.toFixed(1));
  /* and the pre-fix shape it replaces, modelled on the same
     window from the base rule's own numbers: 13px font at his
     font scale wrapping the 47-char line ~4 deep (v292's
     measured count) + its padding — over 30% by a wide margin,
     i.e. the old bytes fail this bar and the new ones pass. */
  const baseFs = parseFloat((baseLine.match(/font-size\s*:\s*([\d.]+)px/) || [])[1] || '0');
  const baseLh = parseFloat((baseLine.match(/line-height\s*:\s*([\d.]+)/) || [])[1] || '1');
  const basePad = baseLine.match(/padding\s*:\s*([\d.]+)px/);
  const pillH = 4 * baseFs * baseLh + 2 * (basePad ? parseFloat(basePad[1]) : 0);
  check('pre-fix wrapping pill model covers > 30% of the same window (' +
    Math.round(pillH / 145 * 100) + '%) — the defect was real',
    pillH / 145 > 0.30, 'pillH=' + pillH.toFixed(1));
}
/* the mini strip (v292) is untouched by this change */
const miniLine = ruleBody(css, '.nv-drive.nv-mini .nv-drive-pip-line');
check('mini strip rule intact (v292 regression)', miniLine !== null &&
  hasProp(miniLine, 'white-space', 'nowrap') && hasProp(miniLine, 'bottom', '0'));
/* in .nv-pip the strip is the ONLY instruction element left over
   the map: the hide list still removes banner/inset/bar/pills */
check('compact-posture hide list still removes the top banner',
  css.indexOf('.nv-drive.nv-pip .nv-drive-top') >= 0);
check('compact-posture hide list still removes the turn inset',
  css.indexOf('.nv-drive.nv-pip .nv-drive-inset') >= 0);
check('compact-posture hide list still removes the ETA bar',
  css.indexOf('.nv-drive.nv-pip .nv-drive-bar') >= 0);

/* ------------- Part 2: the wiring the strip serves -------------- */
console.log('Part 2 — wiring (real modules/navigator.js)');
const nav = read('modules/navigator.js');
check('applyPipFace toggles .nv-pip on the drive screen',
  /classList\.toggle\('nv-pip', !!inPip\)/.test(nav));
check('applyPipFace unhides the pip line in PiP',
  /line\.classList\.toggle\('hidden', !inPip\)/.test(nav));
check('drive tick feeds the pip line TEXT only while in PiP (no inline geometry to fight the CSS)',
  /pipLineEl && S\._inPip/.test(nav) && /pipLineEl\.textContent = pipTxt/.test(nav));
check('drive screen markup still carries the pip line element',
  nav.indexOf('id="nvd_pip_line"') >= 0);

/* ------------- Part 3: ship pins -------------------------------- */
console.log('Part 3 — ship pins');
const vj = JSON.parse(read('version.json'));
check('webVersion 427', vj.webVersion === 427, 'webVersion=' + vj.webVersion);
const idx = read('index.html');
check('index.html pins css/style.css?v=427', idx.indexOf('css/style.css?v=427') >= 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
