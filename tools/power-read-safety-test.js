#!/usr/bin/env node
/* Meticulous v107 — POWER READ: SAFETY STICKER FALLBACK (Stage 5
 * of the Oct 16 overnight program, app side).
 *
 * Field evidence: the owner's Alberta CVIP sticker CV8602807 is a
 * PUNCHED sticker (year 2027, month May → expiry May 31, 2027).
 * Punched holes defeat both the local reader and the vision model
 * (proven Oct 16 — the vision probes garbled it). The safety
 * branch of the shared photo pipeline never escalated at all and
 * its manual path was a bare date input under a "pick it
 * manually" line. Tonight:
 *  (a) a failed safety read ESCALATES (power read, 'text'
 *      transcription re-parsed by the same parseStickerExpiry);
 *  (b) MONTH/YEAR STEPPERS present immediately as the manual
 *      path, composing the expiry as the LAST day of the punched
 *      month through the ONE stickerExpiryISO both paths share;
 *  (c) the photo preview is never cleared by a failure path.
 * The server-side half of Stage 5 (the ai service's Origin
 * allowlist rejecting the phone's https://localhost origin with
 * 403) is the parent's box fix and is reported, not tested here.
 * Run: node tools/power-read-safety-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('fn not found: ' + name);
  let depth = 0, j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('fn unbalanced: ' + name);
}
const sb = { console: console };
sb.window = sb;
vm.createContext(sb);
const monthsLine = appSrc.match(/var _ONB_MONTHS = \{[^}]*\};/)[0];
vm.runInContext(monthsLine + '\n' +
  extractFn(appSrc, 'stickerExpiryISO') + '\n' +
  extractFn(appSrc, 'parseStickerExpiry') + '\n' +
  '__iso = stickerExpiryISO; __parse = parseStickerExpiry;', sb);

console.log('\n— the shared composition: last day of the punched month —');
eq("his sticker: May 2027 → 2027-05-31", sb.__iso(4, 2027), '2027-05-31');
eq('February in a leap year → 29th', sb.__iso(1, 2028), '2028-02-29');
eq('February in a plain year → 28th', sb.__iso(1, 2027), '2027-02-28');
eq('December 2026 → 31st', sb.__iso(11, 2026), '2026-12-31');
eq('an out-of-range year composes nothing', sb.__iso(4, 2050), null);
eq('no month composes nothing', sb.__iso(null, 2027), null);

console.log('\n— the printed-sticker parse rides the same composition —');
eq("parse 'MAY 2027'", sb.__parse('ALBERTA CVIP\nMAY 2027\nCV8602807'), '2027-05-31');
eq("parse a transcription 'Month punched: MAY\nYear: 2027'", sb.__parse('Month punched: MAY\nYear: 2027'), '2027-05-31');
eq("parse numeric '05/2027'", sb.__parse('EXP 05/2027'), '2027-05-31');
eq('garbage parses to nothing', sb.__parse('ONBNERREEEEARAL HH HHE'), null);

console.log('\n— statics: escalation + steppers wired into the shared pipeline —');
{
  ok('the safety branch escalates on failure',
    appSrc.indexOf('safetyPowerRead(prefix, file, token);') >= 0);
  ok('the safety branch presents the steppers on failure',
    (appSrc.match(/showSafetySteppers\(prefix\)/g) || []).length >= 3); // failure + definition-site + catch
  ok("the escalation reads a transcription ('text' reader) and re-parses it locally",
    appSrc.indexOf("reader: 'text', image: img") >= 0 &&
    appSrc.indexOf('parseStickerExpiry(res && res.fields && res.fields.rawText)') >= 0);
  ok('the steppers compose through the shared helper',
    appSrc.indexOf('var iso = stickerExpiryISO(st.mo, st.y);') >= 0);
  ok('a stepper choice persists through the host persist()',
    appSrc.indexOf('persist(kind, v);') >= 0);
  ok('a power-read hit persists only on tap (chip), never auto-applied',
    appSrc.indexOf("b.textContent = 'Expiry ' + iso;") >= 0);
  ok('the helpers are exposed for this test',
    appSrc.indexOf('App._stickerExpiryISO = stickerExpiryISO;') >= 0);
  ok('no failure path clears the photo preview',
    !/prevEl\.innerHTML = ''/.test(appSrc.slice(appSrc.indexOf("} else {"), appSrc.indexOf('function collectOnbInputs'))));
}

console.log('\npower-read-safety: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
