#!/usr/bin/env node
/* Meticulous v83 — MANIFEST TIMES ARE HIS, NOT THE APP'S.
 *
 * Owner evidence (Oct 15, 2026): the manifest for 2026-10-15
 * printed Start 8:00:01 AM / End 6:02:43 PM — the tracker
 * session's stamps — while his foreman card #21314 said start
 * 8:00, finish 6:30 PM, and he worked to the card. His words:
 * "Should be what my actual close time and start time was! Not
 * what the app thought!"
 *
 * Loads the REAL collect() out of modules/manifest.js (file head
 * through collect's end) plus the REAL js/ticket-ocr.js, and
 * proves the confirmed-source priority: ticket clocks -> dispatch
 * scheduled/started -> card finish derived as scheduled start +
 * foreman hours -> his own close tap (endedAt) -> tracker session
 * (labelled via startSrc/endSrc, never unlabelled again).
 * Run: node tools/manifest-times-test.js
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

const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const head = manSrc.slice(0, manSrc.indexOf('function toggles()'));

function localMs(y, mo, d, h, mi, s) { return new Date(y, mo - 1, d, h, mi || 0, s || 0).getTime(); }
function localISO(y, mo, d, h, mi, s) { return new Date(y, mo - 1, d, h, mi || 0, s || 0).toISOString(); }

function world(mem, tracker) {
  const store = {
    get: (k, d) => (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d,
    set: (k, v) => { mem[k] = v; }
  };
  const sb = {
    console: console,
    App: { _store: store, _esc: s => String(s == null ? '' : s), _today: () => '2026-10-15', tracker: tracker || null }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(head + '\n__collectRef = collect;\n})();', sb);
  return sb.__collectRef;
}

const D = '2026-10-15';
/* the session the tracker saved on Oct 15: 10.045h ending 6:02:43 PM */
const SESSION = { date: D, seconds: 36162, endedAt: localISO(2026, 10, 15, 18, 2, 43) };

console.log('\n— the Oct 15 day: card #21314, 8:00 start, 10.5 foreman hours —');
{
  const collect = world({
    /* saved the evening BEFORE (raw date = Oct 14) for Oct 15 —
       matched by its scheduledAt, like the rest of the app files it */
    dsp_list: [{
      date: '2026-10-14', scheduledAt: '2026-10-15T08:00', status: 'completed',
      endedAt: localMs(2026, 10, 15, 19, 4, 0),
      tickets: [{ ocrType: 'haul_card', cardNumber: '21314', foremanHours: '10.5', loads: '7' }]
    }],
    sessions: [SESSION], rev_entries: [], rev_extras: [], onboarding: {}
  });
  const c = collect(D);
  eq('Start is the dispatch’s 8:00 AM (no seconds, no session)', c.startT, '8:00 AM');
  eq('Start source is the dispatch', c.startSrc, 'dispatch');
  eq('End is the card finish 6:30 PM (8:00 + 10.5h)', c.endT, '6:30 PM');
  eq('End source is the card (derived)', c.endSrc, 'card');
  eq('Loads still read from the same day record (v82 regression)', c.loads + '/' + c.loadsSrc, '7/tickets');
}

console.log('\n— ticket clocks win outright —');
{
  const collect = world({
    dsp_list: [{
      date: D, scheduledAt: '2026-10-15T08:00', status: 'completed', endedAt: localMs(2026, 10, 15, 19, 4, 0),
      tickets: [{ ocrType: 'haul_card', foremanHours: '10.5', startTime: '8:00 AM', finishTime: '6:30 PM' }]
    }],
    sessions: [SESSION], rev_entries: [], rev_extras: [], onboarding: {}
  });
  const c = collect(D);
  eq('Start from the ticket clock', c.startT + '/' + c.startSrc, '8:00 AM/card');
  eq('End from the ticket clock', c.endT + '/' + c.endSrc, '6:30 PM/card');
}

console.log('\n— completed without tickets: his close tap is the end —');
{
  const collect = world({
    dsp_list: [{ date: D, scheduledAt: '2026-10-15T08:00', status: 'completed', endedAt: localMs(2026, 10, 15, 18, 45, 30), tickets: [] }],
    sessions: [SESSION], rev_entries: [], rev_extras: [], onboarding: {}
  });
  const c = collect(D);
  eq('End is his endedAt, minute-clean', c.endT, '6:45 PM');
  eq('End source is the dispatch', c.endSrc, 'dispatch');
  eq('Start still the dispatch’s', c.startT + '/' + c.startSrc, '8:00 AM/dispatch');
}

console.log('\n— no dispatch: tracker times survive, LABELLED —');
{
  const collect = world({ dsp_list: [], sessions: [SESSION], rev_entries: [], rev_extras: [], onboarding: {} });
  const c = collect(D);
  eq('Start source is the tracker', c.startSrc, 'tracker');
  eq('End source is the tracker', c.endSrc, 'tracker');
  ok('Start is the session-derived stamp (not a confirmed 8:00 AM)', c.startT !== '8:00 AM' && c.startT !== '—', c.startT);
  ok('manifest PDF lines carry the tracker label note',
    manSrc.includes("times are' : ' time is') + ' from the tracker — no confirmed dispatch time for this day.'") ||
    manSrc.includes('from the tracker — no confirmed dispatch time for this day.'));
}

console.log('\n— a day still running: dispatch start wins, end stays open —');
{
  const now = Date.now();
  const collect = world({
    dsp_list: [{ date: D, scheduledAt: '2026-10-15T08:00', status: 'active', startedAt: now - 7200000, tickets: [] }],
    sessions: [], rev_entries: [], rev_extras: [], onboarding: {}
  }, { status: 'running', startTs: now - 7200000, elapsed: 0 });
  const c = collect(D);
  eq('Start is the dispatch’s 8:00 AM, not the live session start', c.startT, '8:00 AM');
  eq('End stays honestly open', c.endT, 'Still working');
}

console.log('\n— no records at all —');
{
  const collect = world({ dsp_list: [], sessions: [], rev_entries: [], rev_extras: [], onboarding: {} });
  const c = collect(D);
  eq('Start is —', c.startT, '—');
  eq('End is —', c.endT, '—');
  eq('no source claimed', c.startSrc + '/' + c.endSrc, '/');
}

console.log('\nmanifest-times test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
