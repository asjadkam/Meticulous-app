#!/usr/bin/env node
/* Meticulous — NAV-TTS-NE suite (owner, Fri Nov 13, 2026, on
 * the drive to work: "Métis and all the NE is still saying
 * N E not north east — it's better than A but still not
 * northeast").
 *
 * The defect, proven against the 447 code: the engine's verbal
 * lines spell the quadrant out ("Glenmore Trail South East")
 * so the voice can SAY it, but cleanInstructionText's DISPLAY
 * abbreviation ("Trail South East" -> "Trail SE") was applied
 * to the verbal fields too, and the turn-onto lines embed the
 * raw street name ("Turn left onto Métis Trail NE.") — every
 * TTS engine reads a bare "NE" as letters. speak() passed the
 * text to both engines verbatim; no layer ever expanded a
 * quadrant for the ear.
 *
 * This suite loads the REAL NAVPURE region of
 * modules/navigator.js into a vm world and proves:
 *   (1) speechText expands every realistic Calgary quadrant
 *       string to the exact spoken words;
 *   (2) speechText leaves ordinary sentences, highway lines,
 *       distances and words containing those letters
 *       byte-identical (no collateral rewrites);
 *   (3) maneuverPlan keeps the engine's spelled quadrant in
 *       verbalPre/verbalPost while the DISPLAY instruction
 *       still abbreviates (the v300 contract, now split by
 *       audience: eye vs ear);
 *   (4) the composed line a driver actually hears — verbalPre
 *       through speechText — never contains a bare quadrant
 *       token, for raw-name lines and spelled lines alike;
 *   (5) structural: speak() runs speechText before either
 *       engine, and maneuverPlan passes keepSpelled for the
 *       verbal fields only.
 * Run: node tools/nav-tts-ne-v448-test.js
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
const region = extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END');
const world = {};
vm.createContext(world);
vm.runInContext(region + '\n;this.__np = { speechText: speechText, cleanInstructionText: cleanInstructionText, maneuverPlan: maneuverPlan };', world);
const NP = world.__np;
const st = NP.speechText;

/* ---- (1) realistic Calgary strings -> exact spoken text ---- */
const CASES = [
  ['Turn left onto Métis Trail NE.', 'Turn left onto Métis Trail North East.'],
  ['Turn right onto 36 Street NE.', 'Turn right onto 36 Street North East.'],
  ['Head north on 36 Street NE toward Country Hills Boulevard NE.', 'Head north on 36 Street North East toward Country Hills Boulevard North East.'],
  ['Turn left onto Country Hills Boulevard NE.', 'Turn left onto Country Hills Boulevard North East.'],
  ['Continue on Deerfoot Trail SE.', 'Continue on Deerfoot Trail South East.'],
  ['Take the ramp onto Stoney Trail NE.', 'Take the ramp onto Stoney Trail North East.'],
  ['Turn right onto 80 Avenue NE.', 'Turn right onto 80 Avenue North East.'],
  ['Head west on 16 Avenue NW toward Sarcee Trail NW.', 'Head west on 16 Avenue North West toward Sarcee Trail North West.'],
  ['Merge onto Glenmore Trail SE.', 'Merge onto Glenmore Trail South East.'],
  ['Turn left onto Barlow Trail NE', 'Turn left onto Barlow Trail North East'],
  ['Your destination is on 48 Avenue NE.', 'Your destination is on 48 Avenue North East.'],
  ['Warning. This route uses a weight-restricted street, 48 Avenue NE. A loaded truck must not use it.',
   'Warning. This route uses a weight-restricted street, 48 Avenue North East. A loaded truck must not use it.'],
  ['Turn left onto Centre Street N.', 'Turn left onto Centre Street North.'],
  ['Continue on 1 Street SW.', 'Continue on 1 Street South West.'],
  ['Turn onto Falconridge Boulevard N.E.', 'Turn onto Falconridge Boulevard North East.'],
  ['On Métis Trail NE', 'On Métis Trail North East'],
  ['In 300 metres, turn left onto Métis Trail NE.', 'In 300 metres, turn left onto Métis Trail North East.']
];
CASES.forEach(function (c, i) {
  check('(1.' + (i + 1) + ') spoken: "' + c[0] + '"', st(c[0]) === c[1], 'got "' + st(c[0]) + '"');
});

/* ---- (2) untouched text ---- */
const UNTOUCHED = [
  'Take exit 2',
  'Take the Highway 2 North ramp',
  'Head north on Deerfoot Trail.',
  'In 1.2 kilometres, keep right.',
  'You have arrived.',
  'Off route. Re-routing.',
  'Turn left onto New Street.',
  'Continue toward the northeast entrance.',   /* lowercase word, not a token */
  'Your usual route to Aecon Trans',
  'Warning. Low clearance ahead: 3.9 metres.'
];
UNTOUCHED.forEach(function (s, i) {
  check('(2.' + (i + 1) + ') untouched: "' + s + '"', st(s) === s, 'got "' + st(s) + '"');
});
check('(2.x) empty/null pass through', st('') === '' && st(null) === null && st(undefined) === undefined);

/* ---- (3) maneuverPlan: ear keeps spelled, eye abbreviates ---- */
const trip = { legs: [{ maneuvers: [
  { instruction: 'Turn left onto Glenmore Trail South East.', verbal_pre_transition_instruction: 'Turn left onto Glenmore Trail South East.', verbal_post_transition_instruction: 'Continue on Glenmore Trail South East.', street_names: ['Glenmore Trail SE'], length: 1.2, type: 15 },
  { instruction: 'Turn right onto Métis Trail NE.', verbal_pre_transition_instruction: 'Turn right onto Métis Trail NE.', verbal_post_transition_instruction: '', street_names: ['Métis Trail NE'], length: 0.8, type: 10 },
  { instruction: 'Head east on Peigan Trail SE', verbal_pre_transition_instruction: 'Head east on Peigan Trail Southeast', verbal_post_transition_instruction: '', street_names: ['Peigan Trail SE'], length: 1.15, type: 1 }
] }], summary: { length: 3.15, time: 300 } };
const plan = NP.maneuverPlan(trip);
check('(3.1) display instruction still abbreviates the pair', plan.maneuvers[0].instruction.indexOf('Glenmore Trail SE') !== -1, plan.maneuvers[0].instruction);
check('(3.2) verbalPre keeps the spelled pair', plan.maneuvers[0].verbalPre.indexOf('Glenmore Trail South East') !== -1, plan.maneuvers[0].verbalPre);
check('(3.3) verbalPost keeps the spelled pair', plan.maneuvers[0].verbalPost.indexOf('Glenmore Trail South East') !== -1, plan.maneuvers[0].verbalPost);

/* ---- (4) the line actually heard ---- */
plan.maneuvers.forEach(function (m, i) {
  const heard = st(m.verbalPre || m.instruction);
  check('(4.' + (i + 1) + ') heard line has no bare quadrant token', !/\b(NE|NW|SE|SW)\b/.test(heard), heard);
});
check('(4.x) spelled Southeast survives end to end', st(plan.maneuvers[2].verbalPre) === 'Head east on Peigan Trail Southeast', st(plan.maneuvers[2].verbalPre));
check('(4.y) raw-name turn line expands end to end', st(plan.maneuvers[1].verbalPre) === 'Turn right onto Métis Trail North East.', st(plan.maneuvers[1].verbalPre));

/* ---- (5) structural pins ---- */
const speakAt = navSrc.indexOf('function speak(text)');
const speakBody = speakAt === -1 ? '' : navSrc.slice(speakAt, speakAt + 4000);
check('(5.1) speak() normalizes through speechText before any engine call',
  speakAt !== -1 && speakBody.indexOf('text = speechText(text)') !== -1 &&
  speakBody.indexOf('speakNative') !== -1 &&
  speakBody.indexOf('text = speechText(text)') < speakBody.indexOf('speakNative'));
check('(5.2) maneuverPlan passes keepSpelled for verbalPre/verbalPost',
  navSrc.indexOf("verbal_pre_transition_instruction || '', true") !== -1 &&
  navSrc.indexOf("verbal_post_transition_instruction || '', true") !== -1);
check('(5.3) display instruction does NOT pass keepSpelled',
  navSrc.indexOf("instruction: cleanInstructionText(m.instruction || '')") !== -1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
