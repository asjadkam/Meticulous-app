#!/usr/bin/env node
/* Meticulous v103 — DISPATCH DELETE: THE IN-APP CONFIRM, DRIVEN.
 *
 * Field defect (Oct 16, 2026 evening): deleting a dispatch record
 * was gated behind the native confirm() dialog, which browser
 * automation auto-dismisses (= Cancel) — so deletion could not be
 * completed or verified end-to-end, and two shell records the
 * owner ordered deleted (the thin Oct 15 duplicate, the leftover
 * Oct 17 Maple Ridge shell) just sat there. v103 replaces the
 * native gate with the connect.js two-step pattern: Delete arms
 * an in-row strip with ONE clear red Delete + Cancel; only the
 * strip's Delete removes the record.
 *
 * This suite drives the REAL module's render in a stub DOM:
 * create a throwaway record beside a keeper, arm the confirm,
 * cancel it (record survives), re-arm, confirm (record gone),
 * and prove the deletion survives a reload-equivalent re-read
 * (a fresh vm world over the same store). The native confirm is
 * stubbed to record calls AND refuse — if the flow ever consulted
 * it, nothing would delete and the suite would fail twice.
 *
 * Run: node tools/dispatch-delete-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

/* ---------- stub DOM (nav-dropdown pattern, generalized) ---------- */
function makeEl() {
  const e = { style: {}, value: '', _html: '', textContent: '', onclick: null, _kids: {} };
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; },
    set: function (v) { e._html = String(v); }
  });
  e.addEventListener = function () {};
  e.querySelector = function (sel) { return e._kids[sel] || (e._kids[sel] = makeEl()); };
  e.querySelectorAll = function () { return []; };
  e.getAttribute = function () { return null; };
  e.setAttribute = function () {};
  return e;
}
function makeBody() {
  const body = makeEl();
  body._bySel = {};
  body.querySelector = function (sel) {
    return body._bySel[sel] || (body._bySel[sel] = makeEl());
  };
  /* buttons are parsed from the CURRENT html and CACHED per
     paint — the module wires its handlers onto the parsed rows,
     so a later query must hand back the same row objects until
     the next render repaints (the nav-dropdown makeResults
     pattern) */
  body._btnCache = {};
  body.querySelectorAll = function (sel) {
    const m = /^\[(data-[a-z]+)\]$/.exec(sel);
    if (!m) return [];
    const attr = m[1];
    const c = body._btnCache[attr];
    if (c && c.html === body._html) return c.btns;
    const out = [];
    const re = new RegExp(attr + '="([^"]*)"', 'g');
    let mm;
    while ((mm = re.exec(body._html))) {
      const v = mm[1];
      out.push({ onclick: null,
        getAttribute: function (n) { return n === attr ? v : null; },
        click: function () { if (this.onclick) this.onclick(); } });
    }
    body._btnCache[attr] = { html: body._html, btns: out };
    return out;
  };
  return body;
}

function makeWorld(mem, confirmCalls) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console, Promise: Promise, setTimeout: setTimeout,
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      _today: function () { return '2026-10-16'; },
      userRole: function () { return 'driver'; },
      openModule: function () {}
    },
    Meticulous: { modules: {} },
    confirm: function (msg) { confirmCalls.push(msg); return false; /* auto-Cancel, like the automation that exposed the defect */ },
    alert: function () {},
    prompt: function () { return null; }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dspSrc, sandbox, { filename: 'modules/dispatch.js' });
  return { api: sandbox.Meticulous.modules.dispatch };
}

function rec(id, site, status) {
  return { id: id, jobSite: site, date: '2026-10-16', scheduledAt: '2026-10-16T08:00',
    equipment: 'Tandem', material: '', ticketNo: '', amount: '', loads: '1', notes: '',
    driverId: '', driverName: '', tickets: [], photo: null, status: status };
}

(function () {
  console.log('— v103: in-app dispatch delete, driven end-to-end —');
  const confirmCalls = [];
  const mem = { dsp_list: [rec('d-throw', 'Throwaway Site', 'saved'), rec('d-keep', 'Keeper Site', 'completed')], dsp_active: null };
  const w = makeWorld(mem, confirmCalls);
  const body = makeBody();
  const btns = function (attr) { return body.querySelectorAll('[' + attr + ']'); };
  const byVal = function (attr, v) { return btns(attr).filter(function (b) { return b.getAttribute(attr) === v; })[0]; };

  w.api.render(body);
  check('history renders both records with Delete buttons', btns('data-del').length === 2 &&
    body._html.indexOf('Throwaway Site') >= 0 && body._html.indexOf('Keeper Site') >= 0,
    'del buttons: ' + btns('data-del').length);
  check('no confirm strip is open yet', body._html.indexOf('data-delconfirm') < 0);

  /* arm the throwaway's confirm (list index 0) */
  byVal('data-del', '0').click();
  check('Delete arms the in-app strip (Delete + Cancel, plain words)',
    body._html.indexOf('Delete this dispatch?') >= 0 && btns('data-delconfirm').length === 1 && btns('data-delcancel').length === 1);
  check('arming alone deletes NOTHING', mem.dsp_list.length === 2);
  check('the native confirm was never consulted', confirmCalls.length === 0, JSON.stringify(confirmCalls));

  /* cancel — the record survives */
  btns('data-delcancel')[0].click();
  check('Cancel closes the strip', body._html.indexOf('data-delconfirm') < 0);
  check('the record survives a cancel', mem.dsp_list.length === 2 && mem.dsp_list[0].id === 'd-throw');

  /* re-arm and confirm — the record goes */
  byVal('data-del', '0').click();
  btns('data-delconfirm')[0].click();
  check('the confirmed record is deleted from the store', mem.dsp_list.length === 1 && mem.dsp_list[0].id === 'd-keep',
    JSON.stringify(mem.dsp_list.map(function (d) { return d.id; })));
  check('the keeper record is untouched', mem.dsp_list[0].jobSite === 'Keeper Site' && mem.dsp_list[0].status === 'completed');
  check('the re-rendered history shows exactly the keeper', btns('data-del').length === 1 && body._html.indexOf('Throwaway Site') < 0);
  check('the native confirm was never consulted, start to finish', confirmCalls.length === 0);

  /* reload-equivalent: a fresh module world over the same store */
  const w2 = makeWorld(mem, confirmCalls);
  const body2 = makeBody();
  w2.api.render(body2);
  check('after a reload the throwaway is still gone (the deletion persisted)',
    mem.dsp_list.length === 1 && body2._html.indexOf('Throwaway Site') < 0 && body2._html.indexOf('Keeper Site') >= 0);

  console.log('— statics —');
  check('no native confirm gates dispatch deletion', !dspSrc.includes("confirm('Delete this dispatch?')"));
  check('the strip is armed by record id, not row index', dspSrc.includes('pendingDelId') && dspSrc.includes('d.id === pendingDelId'));
  check('the strip carries one clear Delete + Cancel', dspSrc.includes('data-delconfirm') && dspSrc.includes('data-delcancel'));

  console.log('\ndispatch-delete test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
