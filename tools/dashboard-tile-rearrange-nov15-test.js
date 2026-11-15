#!/usr/bin/env node
/* Meticulous v458 — DASHBOARD TILE REARRANGE (TILE-REARRANGE-NOV15,
 * owner, Nov 15, 2026 01:17 CST): "All of these tile should be
 * adjustable... if a user long press any tile... All the tile
 * should start shaking (like tiles shake on iPhone when long
 * pressed) to signify that edit mode is on and then a user should
 * be able to adjust tiles based on preferences."
 *
 * What is pinned here:
 *  A. The pure doors of the TILE-ORDER region (sliced verbatim
 *     from js/app.js, driven over an in-memory store):
 *       - tileOrderApply: saved order permutes ONLY the visible
 *         set; unseen visible keys follow in role order; junk in
 *         the save (unknown keys, dupes, non-strings) is inert.
 *       - tileOrderNext: a drop saves this face's new order
 *         first, then the saved keys NOT on this face in their
 *         saved order — one face's arranging never erases
 *         another face's tiles.
 *       - tileInsertIndex: the drag geometry over synthetic
 *         rects (reading order: row below, or same band + right).
 *       - tileOrderLoad/Store: the round-trip through the one
 *         store key 'tile_order', garbage-tolerant.
 *  B. The behaviour, in jsdom, over a grid painted EXACTLY as
 *     buildDashboard paints it (same card markup, same onclick
 *     door, then wireTileEdit):
 *       - a short tap still opens the module, edit mode stays off;
 *       - a long-press (still finger) enters edit mode — grid
 *         .editing, EVERY card .jiggle, the Done pill shown —
 *         and the module does NOT open, not on the press and not
 *         on the click that trails its release;
 *       - a move before the hold lands cancels the press (a
 *         scroll never becomes an edit);
 *       - in edit mode a drag reorders the DOM live and the drop
 *         persists 'tile_order' at once; a drag to the very end
 *         lands last;
 *       - Done exits: shaking stops, pill hides, taps open again;
 *       - a fresh paint over the same store (the reload) shows
 *         the saved order.
 *  C. Source pins: buildDashboard applies the saved order and
 *     wires edit mode, the cards' onclick door is byte-unchanged,
 *     and the jiggle CSS ships.
 * Run: node tools/dashboard-tile-rearrange-nov15-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) { JSDOM = require('/home/hatch/workspace/ship-work/autostart447/node_modules/jsdom').JSDOM; }

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

function extract(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const region = extract(appSrc, 'TILE-ORDER-BEGIN', 'TILE-ORDER-END');
const EXPORTS = ';globalThis.__tile = { apply: tileOrderApply, next: tileOrderNext, ' +
  'insertIndex: tileInsertIndex, load: tileOrderLoad, store: tileOrderStore, ' +
  'enter: tileEditEnter, exit: tileEditExit, wire: wireTileEdit, state: tileEdit };';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  FAIL: ' + name); }
}
function eq(got, want, name) {
  ok(JSON.stringify(got) === JSON.stringify(want),
    name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* ================= A. the pure doors ================= */
console.log('(A) TILE-ORDER pure doors');
function makeStore(mem) {
  return {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
}
function pureWorld(mem) {
  const sb = {
    console: console, Math: Math, Date: Date, JSON: JSON,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    App: {}, store: makeStore(mem)
  };
  vm.createContext(sb);
  vm.runInContext(region + EXPORTS, sb);
  return sb;
}
{
  const w = pureWorld({});
  const T = w.__tile;
  const ROLE = ['revenue', 'dispatch', 'fuel', 'navigator'];

  eq(T.apply([], ROLE), ROLE, 'A1 no save: role order stands');
  eq(T.apply(['navigator', 'revenue'], ROLE), ['navigator', 'revenue', 'dispatch', 'fuel'],
    'A2 saved keys lead in saved order, the rest follow in role order');
  eq(T.apply(['revenue', 'revenue', 'bogus', 42, null, 'fuel'], ROLE),
    ['revenue', 'fuel', 'dispatch', 'navigator'],
    'A3 dupes / unknown / non-string save entries are inert');
  eq(T.apply('not-an-array', ROLE), ROLE, 'A4 a corrupt save reads as no save');
  eq(T.apply(['revenue', 'navigator', 'dispatch'], ['dispatch', 'invoice', 'navigator']),
    ['navigator', 'dispatch', 'invoice'],
    'A5 a different face: only its own tiles permute, unseen ones keep face order');
  eq(T.apply(['pnl'], ROLE), ROLE, 'A6 a saved key that is gated off this face changes nothing');

  eq(T.next([], ['dispatch', 'revenue']), ['dispatch', 'revenue'], 'A7 next with no save is the face order');
  eq(T.next(['revenue', 'navigator', 'dispatch', 'invoice'], ['invoice', 'dispatch']),
    ['invoice', 'dispatch', 'revenue', 'navigator'],
    'A8 next: this face first, off-face keys keep their saved order behind');
  eq(T.next(['revenue'], ['fuel', 'fuel', 'revenue']), ['fuel', 'revenue'],
    'A9 next dedupes the face order it is handed');

  const C = [ // a 2x2 grid of centres, 160x120 cards
    { x: 96, y: 66, h: 120 }, { x: 272, y: 66, h: 120 },
    { x: 96, y: 202, h: 120 }, { x: 272, y: 202, h: 120 }
  ];
  eq(T.insertIndex(C, 10, 10), 0, 'A10 insert: top-left goes first');
  eq(T.insertIndex(C, 300, 60), 2, 'A11 insert: row 1, right of its last card -> before row 2');
  eq(T.insertIndex(C, 150, 130), 2, 'A12 insert: the gutter between rows -> before row 2');
  eq(T.insertIndex(C, 100, 200), 3, 'A13 insert: row 2 band, right of its first card -> before its second');
  eq(T.insertIndex(C, 50, 202), 2, 'A14 insert: row 2 band, left of its first card -> before it');
  eq(T.insertIndex(C, 300, 300), 4, 'A15 insert: below everything -> last');
  eq(T.insertIndex([], 50, 50), 0, 'A16 insert: no siblings -> 0');

  const mem = {};
  const w2 = pureWorld(mem);
  eq(w2.__tile.load(), [], 'A17 load with nothing saved is empty');
  w2.__tile.store(['navigator', 'revenue']);
  eq(mem.tile_order, ['navigator', 'revenue'], 'A18 store writes the one key tile_order');
  eq(w2.__tile.load(), ['navigator', 'revenue'], 'A19 load reads it back (the reload round-trip)');
  const memBad = { tile_order: 'junk' };
  eq(pureWorld(memBad).__tile.load(), [], 'A20 a junk save loads as empty, never throws');
  const memJunk = { tile_order: ['revenue', 7, '', 'revenue', null] };
  eq(pureWorld(memJunk).__tile.load(), ['revenue'], 'A21 a junk-filled save loads sanitized');

  eq(w.App._tileLongPressMs, 450, 'A22 the long-press hold is 450 ms by default');
}

/* ================= B. the behaviour in jsdom ================= */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function makeDom(mem) {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="dashView"><div class="modgrid" id="modGrid"></div></div></body>',
    { runScripts: 'outside-only', url: 'https://localhost/' });
  const win = dom.window;
  win.__opened = [];
  win.App = { openModule: function (k) { win.__opened.push(k); } };
  win.store = makeStore(mem);
  win.el = function (id) { return win.document.getElementById(id); };
  win.eval(region + EXPORTS.replace('globalThis.__tile', 'window.__tile'));
  win.App._tileLongPressMs = 40; // harness-shrunk hold
  return win;
}
/* Paints the grid the way buildDashboard does: role order run
   through the saved order, the same card markup, the same
   onclick door, then the edit wiring. Rects are stubbed to a
   2-column layout (160x120 cards, 16px gaps). */
function paintGrid(win, roleKeys) {
  const T = win.__tile;
  const keys = T.apply(T.load(), roleKeys);
  const g = win.document.getElementById('modGrid');
  g.innerHTML = keys.map(function (k) {
    return '<div class="modcard" data-mod="' + k + '"><div class="ic">X</div>' +
      '<div class="t">' + k + '</div><div class="s"></div></div>';
  }).join('');
  Array.prototype.forEach.call(g.querySelectorAll('.modcard'), function (c) {
    c.onclick = function () { win.App.openModule(c.getAttribute('data-mod')); };
  });
  T.wire(g);
  Array.prototype.forEach.call(g.querySelectorAll('.modcard'), function (c, i) {
    const left = 16 + (i % 2) * 176, top = 6 + Math.floor(i / 2) * 136;
    c.getBoundingClientRect = function () {
      return { left: left, top: top, width: 160, height: 120,
        right: left + 160, bottom: top + 120, x: left, y: top };
    };
  });
  return g;
}
function pev(win, type, x, y) {
  const e = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
}
function click(win, elm) {
  elm.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function domOrder(g) {
  return Array.prototype.map.call(g.querySelectorAll('.modcard'), function (c) {
    return c.getAttribute('data-mod');
  });
}
function cardAt(g, i) { return g.querySelectorAll('.modcard')[i]; }

(async function () {
  console.log('(B) TILE-ORDER behaviour (jsdom)');
  const ROLE4 = ['revenue', 'dispatch', 'fuel', 'navigator'];

  /* B1: a short tap still opens the module */
  {
    const mem = {};
    const win = makeDom(mem);
    const g = paintGrid(win, ROLE4);
    const a = cardAt(g, 0);
    a.dispatchEvent(pev(win, 'pointerdown', 96, 66));
    a.dispatchEvent(pev(win, 'pointerup', 96, 66));
    click(win, a);
    eq(win.__opened, ['revenue'], 'B1 a short tap opens the module');
    ok(!g.classList.contains('editing'), 'B1 a short tap never enters edit mode');
    eq(mem.tile_order, undefined, 'B1 a short tap writes no tile_order');
  }

  /* B2: a move before the hold lands cancels the press */
  {
    const mem = {};
    const win = makeDom(mem);
    const g = paintGrid(win, ROLE4);
    const a = cardAt(g, 0);
    a.dispatchEvent(pev(win, 'pointerdown', 96, 66));
    a.dispatchEvent(pev(win, 'pointermove', 96, 130)); // a scroll's move
    await sleep(90);
    ok(!g.classList.contains('editing'), 'B2 a moved press never enters edit mode');
    a.dispatchEvent(pev(win, 'pointerup', 96, 130));
    eq(mem.tile_order, undefined, 'B2 a cancelled press writes nothing');
  }

  /* B3-B6: long-press, gate, drag, Done — one continuous session */
  {
    const mem = {};
    const win = makeDom(mem);
    const g = paintGrid(win, ROLE4);
    const b = cardAt(g, 1); // dispatch
    b.dispatchEvent(pev(win, 'pointerdown', 272, 66));
    await sleep(90); // the hold lands while the finger is still down
    ok(g.classList.contains('editing'), 'B3 long-press enters edit mode');
    ok(Array.prototype.every.call(g.querySelectorAll('.modcard'), function (c) {
      return c.classList.contains('jiggle');
    }), 'B3 EVERY tile is jiggling');
    const done = win.document.getElementById('tileDone');
    ok(!!done && !done.classList.contains('hidden'), 'B3 the Done pill is shown');
    eq(win.__opened, [], 'B3 the long-press did NOT open the module');
    b.dispatchEvent(pev(win, 'pointerup', 272, 66));
    click(win, b); // the trailing click of the press itself
    eq(win.__opened, [], 'B4 the trailing click is swallowed — no module opens');
    click(win, cardAt(g, 0));
    eq(win.__opened, [], 'B4 taps in edit mode never open a module');

    /* drag navigator (index 3) to the front */
    const nav = cardAt(g, 3);
    nav.dispatchEvent(pev(win, 'pointerdown', 272, 202));
    nav.dispatchEvent(pev(win, 'pointermove', 40, 30));
    nav.dispatchEvent(pev(win, 'pointermove', 40, 28));
    nav.dispatchEvent(pev(win, 'pointerup', 40, 28));
    eq(domOrder(g), ['navigator', 'revenue', 'dispatch', 'fuel'],
      'B5 the drag reorders the grid live');
    eq(mem.tile_order, ['navigator', 'revenue', 'dispatch', 'fuel'],
      'B5 the drop persists tile_order at once');
    ok(nav.classList.contains('jiggle') && !nav.classList.contains('dragging'),
      'B5 after the drop the tile is back to jiggling, not dragging');
    eq(win.__opened, [], 'B5 the drag never opened a module');

    /* drag revenue (now index 1) to the very end */
    const rev = cardAt(g, 1);
    rev.dispatchEvent(pev(win, 'pointerdown', 96, 66));
    rev.dispatchEvent(pev(win, 'pointermove', 300, 300));
    rev.dispatchEvent(pev(win, 'pointerup', 300, 300));
    eq(domOrder(g), ['navigator', 'dispatch', 'fuel', 'revenue'],
      'B6 a drag past the last tile lands last');
    eq(mem.tile_order, ['navigator', 'dispatch', 'fuel', 'revenue'],
      'B6 the second drop persists too');

    /* Done exits; taps open again */
    click(win, done);
    ok(!g.classList.contains('editing'), 'B7 Done leaves edit mode');
    ok(!Array.prototype.some.call(g.querySelectorAll('.modcard'), function (c) {
      return c.classList.contains('jiggle');
    }), 'B7 Done stops every tile shaking');
    ok(done.classList.contains('hidden'), 'B7 Done hides its own pill');
    const first = cardAt(g, 0);
    first.dispatchEvent(pev(win, 'pointerdown', 96, 66));
    first.dispatchEvent(pev(win, 'pointerup', 96, 66));
    click(win, first);
    eq(win.__opened, ['navigator'], 'B7 after Done, a tap opens the module again');

    /* the reload: a fresh face over the same store shows the saved order */
    const win2 = makeDom(mem);
    const g2 = paintGrid(win2, ROLE4);
    eq(domOrder(g2), ['navigator', 'dispatch', 'fuel', 'revenue'],
      'B8 a fresh paint (reload) shows the saved order');
  }

  /* B9: the same hold flows straight into a drag (no second touch) */
  {
    const mem = {};
    const win = makeDom(mem);
    const g = paintGrid(win, ROLE4);
    const c = cardAt(g, 2); // fuel, centre (96, 202)
    c.dispatchEvent(pev(win, 'pointerdown', 96, 202));
    await sleep(90);
    ok(g.classList.contains('editing'), 'B9 the hold entered edit mode');
    c.dispatchEvent(pev(win, 'pointermove', 40, 30)); // still the same finger
    c.dispatchEvent(pev(win, 'pointerup', 40, 30));
    eq(domOrder(g), ['fuel', 'revenue', 'dispatch', 'navigator'],
      'B9 hold-then-move drags the pressed tile in one gesture');
    eq(mem.tile_order, ['fuel', 'revenue', 'dispatch', 'navigator'],
      'B9 that drop persists too');
  }

  /* ================= C. source pins ================= */
  console.log('(C) TILE-ORDER source pins');
  ok(appSrc.indexOf('tileOrderApply(tileOrderLoad(), dashKeys)') !== -1,
    'C1 buildDashboard paints the visible set through the saved order');
  ok(appSrc.indexOf('wireTileEdit(g);') !== -1,
    'C2 buildDashboard wires the edit mode on every paint');
  ok(appSrc.indexOf("c.onclick = function () { App.openModule(c.getAttribute('data-mod')); };") !== -1,
    'C3 the cards\u2019 tap door is byte-unchanged');
  ok(appSrc.indexOf("store.get('tile_order', null)") !== -1 &&
     appSrc.indexOf("store.set('tile_order',") !== -1,
    'C4 the order rides the one store, key tile_order');
  ok(cssSrc.indexOf('@keyframes tileJiggle') !== -1, 'C5 the jiggle keyframes ship');
  ok(cssSrc.indexOf('.modcard.jiggle') !== -1, 'C6 the jiggle class ships');
  ok(cssSrc.indexOf('.modgrid.editing .modcard') !== -1 &&
     cssSrc.indexOf('touch-action:none') !== -1,
    'C7 edit mode hands the gesture to the drag (touch-action:none)');
  ok(cssSrc.indexOf('.modcard.dragging') !== -1 && cssSrc.indexOf('.tilePh') !== -1 &&
     cssSrc.indexOf('.tileDone') !== -1,
    'C8 the dragging card, placeholder slot and Done pill styles ship');

  console.log('dashboard-tile-rearrange-nov15 test: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) console.log('FAILURES: ' + failures.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('  FAIL: suite threw: ' + (e && e.stack || e));
  console.log('dashboard-tile-rearrange-nov15 test: ' + pass + ' passed, ' + (fail + 1) + ' failed');
  process.exit(1);
});
