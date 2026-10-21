/* Meticulous v176 — NAVIGATOR OVERHAUL BATCH 1: GUIDANCE
   CORRECTNESS (owner, Oct 19, 2026 drive + Oct 20 token-reset
   order: "finish them all, ASAP").

   F1 "every turn announced, none skipped": on the Oct 19 drive
   the guidance jumped from the Beddington Trail exit straight
   to the next turn. Root cause: the maneuver index can JUMP
   past a short intermediate maneuver between two GPS fixes;
   drivePrompt only ever announces idx+1 and trackProgress spoke
   only the landing maneuver's line, so the crossed maneuver was
   never announced at all. The fix is a catch-up: skippedLines
   (pure) lists the strictly-between maneuvers in route order,
   and trackProgress speaks them combined with the landing line
   as ONE utterance, marking them said in the drive flag bag so
   drivePrompt never fires them late or out of sequence.

   F3 "never direct a U-turn": shipped in v135 (two layers —
   exclude_locations re-request + sanitizeTruckPlan rewrite);
   this suite RE-PINS that guarantee so the overhaul can never
   silently regress it.

   Run: node tools/navigator-v176-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
const navSrc = read('modules/navigator.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));

const sb = { console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);
const plan = sb.maneuverPlan(fixture.trip);

console.log('— F1: no turn is ever skipped —');
check('skippedLines exists in NAVPURE', typeof sb.skippedLines === 'function');
check('adjacent index step skips nothing', sb.skippedLines(plan, 2, 3).length === 0);
check('no jump, no lines', sb.skippedLines(plan, 4, 4).length === 0);
{
  const lines = sb.skippedLines(plan, 1, 5);
  check('a 1->5 jump returns the 3 strictly-between maneuvers in route order',
    lines.length === 3 &&
    lines[0] === (plan.maneuvers[2].instruction || plan.maneuvers[2].verbalPre) &&
    lines[2] === (plan.maneuvers[4].instruction || plan.maneuvers[4].verbalPre),
    JSON.stringify(lines));
}
check('skippedLines tolerates a null plan', Array.isArray(sb.skippedLines(null, 0, 3)) && sb.skippedLines(null, 0, 3).length === 0);
check('trackProgress speaks the catch-up (skipped lines + landing line, one utterance)',
  navSrc.indexOf('skippedLines(S.plan, oldIdx, idx)') >= 0 &&
  navSrc.indexOf("speak(skipped.join(' Then ')") >= 0);
check('catch-up marks skipped maneuvers said so drivePrompt never fires them late',
  navSrc.indexOf("S.drive.said['near:' + sj] = 1") >= 0);
check('drivePrompt still announces the next maneuver far then near (pinned behaviour kept)',
  (function () {
    const said = {};
    const far = sb.drivePrompt(plan, 0, 550, said);
    const near = sb.drivePrompt(plan, 0, 150, said);
    return far === (plan.maneuvers[1].verbalPre || plan.maneuvers[1].instruction) &&
      near === plan.maneuvers[1].instruction;
  })());

console.log('— F3: never direct a U-turn (v135 guarantee, re-pinned) —');
check('U-turn maneuvers are detected by type and by text',
  sb.isUturnManeuver({ type: 12, instruction: '' }) === true &&
  sb.isUturnManeuver({ type: 13, instruction: '' }) === true &&
  sb.isUturnManeuver({ type: 10, instruction: 'Make a U-turn' }) === true &&
  sb.isUturnManeuver({ type: 10, instruction: 'Turn left' }) === false);
{
  const dirty = { maneuvers: [
    { instruction: 'Head north', verbalPre: '', verbalPost: '', streets: ['A St'], lengthKm: 0.1, cumStartKm: 0, cumEndKm: 0.1, type: 2 },
    { instruction: 'Make a U-turn', verbalPre: 'Make a U-turn', verbalPost: '', streets: ['B St'], lengthKm: 0.05, cumStartKm: 0.1, cumEndKm: 0.15, type: 12 },
    { instruction: 'Arrive', verbalPre: '', verbalPost: '', streets: [], lengthKm: 0, cumStartKm: 0.15, cumEndKm: 0.15, type: 5 }
  ], totalKm: 0.15, totalMin: 1 };
  const clean = sb.sanitizeTruckPlan(dirty);
  check('sanitizeTruckPlan rewrites a U-turn to a continuation and strips its spoken lines',
    clean.maneuvers[1].instruction === 'Continue on B St' && clean.maneuvers[1].type === 8 &&
    clean.maneuvers[1].verbalPre === '' && clean.uturnsRemoved === 1 &&
    !/u[\s\-]?turn/i.test(clean.maneuvers.map(function (m) { return m.instruction + ' ' + m.verbalPre + ' ' + m.verbalPost; }).join(' ')));
  check('planUturns finds the U-turn index before sanitising', sb.planUturns(dirty).join(',') === '1');
}
check('doRoute re-requests around U-turn points (exclude_locations) before presenting a plan',
  navSrc.indexOf('exclude_locations') >= 0 && navSrc.indexOf('requestRoute(pts)') >= 0);

console.log('— ship pins —');
check('ships as webVersion 176, index.html loads the navigator at the 176 pin',
  ver.webVersion === 182 && idxSrc.indexOf('src="modules/navigator.js?v=182"') >= 0,
  'webVersion=' + ver.webVersion);

console.log('\nnavigator-v176: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
