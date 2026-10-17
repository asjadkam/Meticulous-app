'use strict';
/* Meticulous v128 — NAVIGATOR PLACES: THE DETAIL AT THE TAP.
 *
 * Owner recording (Oct 17, 2026 10:27 MDT): he tapped "Ivor
 * East Pond" in the places list and the detail — coords, visit
 * count, Navigate — rendered at the BOTTOM of the entire list;
 * he had to scroll down to find the Navigate button. His words:
 * "When clicked on the site! Navigate should pop up right
 * there, user shouldn't have to scroll down the page to find
 * it!" The same recording showed the Butterfly row's subtitle
 * printing raw coordinates ("dump site · Yours · 50.9519460,
 * -114.0273550") because that favorite stores its pin AS its
 * address text.
 *
 * v128: the ONE detail panel MOVES directly under the tapped
 * row (accordion-style), Navigate first inside it; tapping
 * another place collapses the expansion to that row; every
 * list repaint first brings the panel home so a repaint can
 * never strand it inside the list it replaces; and a row
 * subtitle never carries a raw coordinate pair (coordinates
 * live only inside the expanded detail).
 *
 * This suite drives the REAL modules/navigation.js render on a
 * small ordered DOM (real parent/child/sibling structure, a
 * real innerHTML parser), because the defect IS DOM order —
 * the older stubs keep no child order and cannot see it.
 * "Reachable without scrolling" is pinned at the strongest
 * level a DOM can state: the tapped row was on screen (the
 * user tapped it), the expansion opens IMMEDIATELY after it —
 * not at the list's end — and Navigate is the expansion's one
 * primary button. On glass, adjacency to a just-tapped,
 * on-screen row is what puts the button under the thumb.
 *
 * Run: node tools/navigator-v128-test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

/* ================= a small ordered DOM ================= */
function TextNode(t) { this.nodeType = 3; this.text = t; this.parentNode = null; }
const VOID_TAGS = { INPUT: 1, BR: 1, IMG: 1, HR: 1, META: 1, LINK: 1 };
function decodeEnt(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
function encodeEnt(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function parseStyleAttr(s) {
  const o = {};
  String(s).split(';').forEach(function (kv) {
    const i = kv.indexOf(':');
    if (i > 0) o[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return o;
}
function serializeNode(n) {
  if (n.nodeType === 3) return encodeEnt(n.text);
  let s = '<' + n.tagName.toLowerCase();
  for (const k in n.attributes) s += ' ' + k + '="' + encodeEnt(n.attributes[k]).replace(/"/g, '&quot;') + '"';
  s += '>';
  if (VOID_TAGS[n.tagName]) return s;
  return s + n.children.map(serializeNode).join('') + '</' + n.tagName.toLowerCase() + '>';
}
function parseInto(root, html) {
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<[^>]+>|[^<]+/g;
  let m;
  while ((m = re.exec(html))) {
    const tok = m[0];
    const top = stack[stack.length - 1];
    if (tok.charAt(0) !== '<') { const t = new TextNode(decodeEnt(tok)); t.parentNode = top; top.children.push(t); continue; }
    if (tok.indexOf('<!--') === 0) continue;
    if (tok.charAt(1) === '/') {
      const name = tok.slice(2, -1).trim().toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) { if (stack[i].tagName === name) { stack.length = i; break; } }
      continue;
    }
    const selfClose = /\/>$/.test(tok);
    const inner = tok.slice(1, tok.length - (selfClose ? 2 : 1));
    const sp = inner.search(/\s/);
    const name = (sp === -1 ? inner : inner.slice(0, sp)).toUpperCase();
    const attrStr = sp === -1 ? '' : inner.slice(sp + 1);
    const el = new El(name);
    const are = /([a-zA-Z-]+)(?:\s*=\s*"([^"]*)")?/g;
    let am;
    while ((am = are.exec(attrStr))) el.attributes[am[1]] = am[2] === undefined ? '' : decodeEnt(am[2]);
    if (el.attributes.style) el.style = parseStyleAttr(el.attributes.style);
    if (el.attributes.value !== undefined) el.value = el.attributes.value;
    el.parentNode = top;
    top.children.push(el);
    if (!VOID_TAGS[name] && !selfClose) stack.push(el);
  }
}
function matchesSel(el, sel) {
  if (el.nodeType !== 1) return false;
  if (sel.charAt(0) === '#') return el.attributes.id === sel.slice(1);
  if (sel.charAt(0) === '.') return (el.attributes.class || '').split(/\s+/).indexOf(sel.slice(1)) >= 0;
  if (sel.charAt(0) === '[') {
    const mm = /^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!mm) return false;
    if (!(mm[1] in el.attributes)) return false;
    return mm[2] === undefined || el.attributes[mm[1]] === mm[2];
  }
  return el.tagName === sel.toUpperCase();
}
function El(tag) {
  this.nodeType = 1;
  this.tagName = String(tag).toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.attributes = {};
  this.style = {};
  this.value = '';
  this.onclick = null;
  this._listeners = {};
}
Object.defineProperty(El.prototype, 'id', {
  get: function () { return this.attributes.id || ''; },
  set: function (v) { this.attributes.id = String(v); }
});
Object.defineProperty(El.prototype, 'childElements', {
  get: function () { return this.children.filter(function (c) { return c.nodeType === 1; }); }
});
Object.defineProperty(El.prototype, 'nextSibling', {
  get: function () {
    if (!this.parentNode) return null;
    const s = this.parentNode.children, i = s.indexOf(this);
    return i >= 0 && i + 1 < s.length ? s[i + 1] : null;
  }
});
Object.defineProperty(El.prototype, 'previousSibling', {
  get: function () {
    if (!this.parentNode) return null;
    const s = this.parentNode.children, i = s.indexOf(this);
    return i > 0 ? s[i - 1] : null;
  }
});
El.prototype.appendChild = function (c) {
  if (c.parentNode) c.parentNode.removeChild(c);
  c.parentNode = this; this.children.push(c); return c;
};
El.prototype.insertBefore = function (node, ref) {
  if (node === ref) return node;
  if (node.parentNode) node.parentNode.removeChild(node);
  node.parentNode = this;
  if (!ref) { this.children.push(node); return node; }
  const i = this.children.indexOf(ref);
  if (i === -1) this.children.push(node); else this.children.splice(i, 0, node);
  return node;
};
El.prototype.removeChild = function (c) {
  const i = this.children.indexOf(c);
  if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
  return c;
};
El.prototype.getAttribute = function (n) { return (n in this.attributes) ? this.attributes[n] : null; };
El.prototype.setAttribute = function (n, v) { this.attributes[n] = String(v); };
El.prototype.addEventListener = function (ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
El.prototype.fire = function (ev) { const s = this; (this._listeners[ev] || []).slice().forEach(function (f) { f({ target: s }); }); };
El.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
El.prototype.scrollIntoView = function () {};
El.prototype.querySelectorAll = function (sel) {
  const out = [];
  (function walk(n) {
    n.children.forEach(function (c) {
      if (c.nodeType !== 1) return;
      if (matchesSel(c, sel)) out.push(c);
      walk(c);
    });
  })(this);
  return out;
};
El.prototype.querySelector = function (sel) {
  const r = this.querySelectorAll(sel);
  return r.length ? r[0] : null;
};
Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    let s = '';
    (function rec(n) { n.children.forEach(function (c) { if (c.nodeType === 3) s += c.text; else rec(c); }); })(this);
    return s;
  },
  set: function (v) {
    this.children.forEach(function (c) { c.parentNode = null; });
    this.children = [];
    if (v) { const t = new TextNode(String(v)); t.parentNode = this; this.children.push(t); }
  }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this.children.map(serializeNode).join(''); },
  set: function (v) {
    this.children.forEach(function (c) { c.parentNode = null; });
    this.children = [];
    parseInto(this, String(v));
    if (this.tagName === 'SELECT') {
      const opts = this.childElements.filter(function (c) { return c.tagName === 'OPTION'; });
      const chosen = opts.filter(function (o) { return 'selected' in o.attributes; })[0] || opts[0];
      this.value = chosen ? (chosen.attributes.value !== undefined ? chosen.attributes.value : chosen.textContent) : '';
    }
  }
});

/* ================= the world ================= */
function makeWorld() {
  const mem = {
    nav_places_migrated: 91,
    nav_data: {
      work: [
        { id: 'fav-alpha', name: 'Alpha Pit', address: '100 Alpha Rd SE, Calgary', type: 'pit', lat: 51.01, lng: -114.01, visits: 3, lastVisit: 3000 },
        { id: 'fav-butterfly', name: 'Butterfly', address: '50.9519460, -114.0273550', type: 'dump site', lat: 50.951946, lng: -114.027355, visits: 2, lastVisit: 2000 },
        { id: 'fav-charlie', name: 'Charlie Yard', address: '', type: 'yard pickup', lat: 51.02, lng: -114.02, visits: 1, lastVisit: 1000 }
      ],
      personal: [], recent: []
    }
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const opened = [];
  const sandbox = {
    console: console, setTimeout: setTimeout,
    alert: function () {}, confirm: function () { return true; },
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      _today: function () { return '2026-10-17'; },
      openModule: function (id) { opened.push(id); }
    },
    Meticulous: { modules: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(navSrc, sandbox, { filename: 'modules/navigation.js' });
  return { api: sandbox.Meticulous.modules.navigation, opened: opened };
}
function countById(root, id) {
  let n = 0;
  (function walk(el) {
    el.children.forEach(function (c) {
      if (c.nodeType !== 1) return;
      if (c.attributes.id === id) n++;
      walk(c);
    });
  })(root);
  return n;
}

console.log('— v128: the detail expands at the tap —');
{
  const w = makeWorld();
  const body = new El('div');
  w.api.render(body);
  const resEl = body.querySelector('#nv_results');
  const detailEl = body.querySelector('#nv_detail');
  const qEl = body.querySelector('#nv_q');
  const homeParent = detailEl.parentNode; /* the Places card — the panel's home slot lives under the list, inside it */
  check('the render lands: results list + one detail panel at its home slot under the list',
    !!resEl && !!detailEl && !!homeParent && detailEl.parentNode === homeParent && countById(body, 'nv_detail') === 1);
  check('the detail starts unselected ("Pick a place above.")', detailEl.textContent.indexOf('Pick a place above.') >= 0);

  const rows0 = resEl.querySelectorAll('[data-pid]');
  check('the recents view paints the three visited favorites, most recent first',
    rows0.length === 3 && rows0[0].getAttribute('data-pid') === 'fav-alpha' &&
    rows0[1].getAttribute('data-pid') === 'fav-butterfly' && rows0[2].getAttribute('data-pid') === 'fav-charlie',
    rows0.map(function (r) { return r.getAttribute('data-pid'); }).join(','));

  console.log('— v128: row subtitles carry no raw coordinates —');
  check('NO row prints the raw coordinate pair (the Butterfly address is its pin)',
    rows0.every(function (r) { return r.innerHTML.indexOf('50.9519460') === -1 && r.innerHTML.indexOf('-114.0273550') === -1; }),
    rows0[1] && rows0[1].innerHTML);
  check('the Butterfly row still reads as a place (name, type, Yours)',
    rows0[1].innerHTML.indexOf('Butterfly') >= 0 && rows0[1].innerHTML.indexOf('dump site') >= 0 && rows0[1].innerHTML.indexOf('Yours') >= 0);
  check('a real street address still shows in its row (the gate is coordinates-only)',
    rows0[0].innerHTML.indexOf('100 Alpha Rd SE, Calgary') >= 0, rows0[0].innerHTML);
  const apiRows = w.api.pickerEntries('work', '').rows;
  const bfEntry = apiRows.filter(function (e) { return e.place.id === 'fav-butterfly'; })[0];
  check('unit: pickerRowHTML for a coordinates-address place contains no coordinate text',
    w.api.pickerRowHTML(bfEntry, null).indexOf('50.9519460') === -1 &&
    w.api.pickerRowHTML(bfEntry, null).indexOf('-114.0273550') === -1);

  console.log('— v128: tap → the expansion opens under THAT row —');
  const rowsBefore = resEl.querySelectorAll('[data-pid]');
  rowsBefore[1].click(); /* tap Butterfly */
  check('the tap rule stands: the search box now holds the place name', qEl.value === 'Butterfly', qEl.value);
  check('the ✓ moved IN PLACE (same row elements, no repaint, ✓ on the tapped row)',
    resEl.querySelectorAll('[data-pid]').every(function (r, i) { return r === rowsBefore[i]; }) &&
    rowsBefore[1].innerHTML.indexOf('✓') >= 0);
  const kids1 = resEl.childElements;
  check('the detail now lives INSIDE the results list', detailEl.parentNode === resEl);
  check('the detail sits IMMEDIATELY after the tapped row (adjacency — Navigate is at the tap, no scrolling)',
    kids1.indexOf(detailEl) === kids1.indexOf(rowsBefore[1]) + 1,
    'detail idx ' + kids1.indexOf(detailEl) + ', row idx ' + kids1.indexOf(rowsBefore[1]));
  check('the detail is NOT at the bottom of the list (a row still follows it)',
    kids1.indexOf(rowsBefore[2]) > kids1.indexOf(detailEl));
  check('there is still exactly ONE detail panel in the whole screen', countById(body, 'nv_detail') === 1);
  const goBtn = detailEl.querySelector('#nv_go');
  check('Navigate is the expansion\'s one primary button, wired', !!goBtn && typeof goBtn.onclick === 'function' &&
    goBtn.textContent.indexOf('Navigate') >= 0);
  check('the coordinates live inside the expanded detail (their one allowed home)',
    detailEl.innerHTML.indexOf('50.951946') >= 0 && detailEl.innerHTML.indexOf('-114.027355') >= 0,
    detailEl.innerHTML);

  console.log('— v128: tapping another place collapses the expansion to that row —');
  rowsBefore[2].click(); /* tap Charlie Yard */
  const kids2 = resEl.childElements;
  check('the expansion moved under the newly tapped row',
    detailEl.parentNode === resEl && kids2.indexOf(detailEl) === kids2.indexOf(rowsBefore[2]) + 1 &&
    detailEl.textContent.indexOf('Charlie Yard') >= 0);
  check('still exactly one panel, and the first expansion is gone (no duplicate left behind)',
    countById(body, 'nv_detail') === 1 && kids2.indexOf(detailEl) !== kids2.indexOf(rowsBefore[1]) + 1);
  rowsBefore[0].click(); /* tap Alpha Pit */
  const kids3 = resEl.childElements;
  check('the expansion follows to the first row too',
    kids3.indexOf(detailEl) === kids3.indexOf(rowsBefore[0]) + 1 && detailEl.textContent.indexOf('Alpha Pit') >= 0);

  console.log('— v128: repaints never strand the panel —');
  qEl.value = 'butt';
  qEl.fire('input'); /* filter repaint while Alpha is selected */
  const rowsF = resEl.querySelectorAll('[data-pid]');
  check('the filter repaint paints its matches (Butterfly only)', rowsF.length === 1 && rowsF[0].getAttribute('data-pid') === 'fav-butterfly');
  check('with the selected place filtered out, the panel waits at its home slot (not stranded, not destroyed)',
    detailEl.parentNode === homeParent && countById(body, 'nv_detail') === 1);
  rowsF[0].click(); /* tap the freshly painted Butterfly row */
  const kids4 = resEl.childElements;
  check('tapping a row from the repainted list expands under THAT row',
    detailEl.parentNode === resEl && kids4.indexOf(detailEl) === kids4.indexOf(rowsF[0]) + 1 &&
    detailEl.textContent.indexOf('Butterfly') >= 0);
  qEl.value = 'zzzz';
  qEl.fire('input'); /* a filter with no matches at all */
  check('an empty repaint leaves the panel whole at home', detailEl.parentNode === homeParent && countById(body, 'nv_detail') === 1);
}

console.log('\nnavigator-v128: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
