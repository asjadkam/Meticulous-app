#!/usr/bin/env node
/* Meticulous web 391 — LANGUAGES-IN-PREFERENCES-NOV9
 * (owner Nov 9, 2026 16:37 MST: "Add Portuguese to the
 * list" + "all the languages I am adding make sure they
 * make it to languages in preferences as well").
 *
 * The Preferences 🌐 Language card (v252 framework) is fed
 * by ONE data registry — LANGS + PACKS in js/i18n.js. His
 * channel list grew to 14 (English, Urdu, Punjabi, Hindi,
 * Arabic, Russian, Ukrainian, Spanish, French, Bosnian,
 * Chinese, Japanese, Tamil, Portuguese); the registry
 * carried 13 entries (his 12 minus Tamil/Portuguese, with
 * Punjabi in BOTH scripts per his Oct 23 "Both!" ruling).
 * This ship syncs the registry DATA ONLY: Tamil (ta) and
 * Portuguese (pt) join LANGS with full packs in the same
 * shape as the other 13. No rule, fallback, direction or
 * wiring changes; modules/preferences.js is untouched —
 * the picker is data-driven off Meticulous.i18n.langs().
 *
 * Named predecessor flips: tools/i18n-framework-v252-test.js
 * pins the v252 ship's list of 13 — its two list-shape
 * assertions ('13 languages', 'his order, Punjabi twice')
 * are superseded by this order and fail by design against
 * the synced registry (41 passed, 2 failed when re-run on
 * this tree); every other v252 assertion (fallback,
 * direction, persistence, seams, the options-render check)
 * passes unchanged.
 *
 * Run: node tools/i18n-lang-sync-v391-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

function i18nWorld() {
  const data = new Map();
  const store = {
    get: function (k, d) { return data.has(k) ? data.get(k) : d; },
    set: function (k, v) { data.set(k, v); }
  };
  const docEl = { attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } };
  const sb = { console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, parseFloat, parseInt, isFinite, isNaN };
  sb.window = sb;
  sb.document = { documentElement: docEl };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(read('js/i18n.js'), sb);
  return { sb, store, docEl, I: sb.Meticulous.i18n };
}

(async function main() {
  console.log('— the registry now carries his 14 (Punjabi twice) —');
  {
    const w = i18nWorld();
    const codes = w.I.langs().map(function (L) { return L.code; });
    eq('15 entries', codes.length, 15);
    eq('his order, Punjabi in both scripts, ta + pt last',
      JSON.stringify(codes),
      JSON.stringify(['en', 'ur', 'pa-sh', 'pa-gur', 'hi', 'ar', 'ru', 'uk', 'es', 'fr', 'bs', 'zh', 'ja', 'ta', 'pt']));
    const set14 = ['en', 'ur', 'pa', 'hi', 'ar', 'ru', 'uk', 'es', 'fr', 'bs', 'zh', 'ja', 'ta', 'pt'];
    set14.forEach(function (c) {
      if (c === 'pa') check('pa covered by pa-sh + pa-gur', codes.indexOf('pa-sh') !== -1 && codes.indexOf('pa-gur') !== -1);
      else check(c + ' present', codes.indexOf(c) !== -1);
    });
  }
  console.log('— the two newcomers carry full packs, in their own names —');
  {
    const w = i18nWorld();
    const byCode = {};
    w.I.langs().forEach(function (L) { byCode[L.code] = L; });
    eq('ta native name', byCode.ta.name, 'தமிழ்');
    eq('pt native name', byCode.pt.name, 'Português');
    eq('ta dir', byCode.ta.dir, 'ltr');
    eq('pt dir', byCode.pt.dir, 'ltr');
    const enKeys = Object.keys(w.I.pack('en'));
    ['ta', 'pt'].forEach(function (c) {
      const p = w.I.pack(c);
      const missing = enKeys.filter(function (k) { return !p[k]; });
      check(c + ' pack covers every surface key', missing.length === 0, missing.join(','));
    });
    eq('ta word for the card itself', w.I.pack('ta')['prefs.language'], 'மொழி');
    eq('pt word for the card itself', w.I.pack('pt')['prefs.language'], 'Idioma');
    eq('ta PTI stays PTI', w.I.pack('ta')['mod.pti'], 'PTI');
    eq('pt PTI stays PTI', w.I.pack('pt')['mod.pti'], 'PTI');
    eq('pt P&L stays P&L', w.I.pack('pt')['mod.pnl'], 'P&L');
  }
  console.log('— the newcomers are selectable: setLang accepts, persists, speaks —');
  {
    const w = i18nWorld();
    w.I.setLang('ta');
    eq('ta is the live language', w.I.lang(), 'ta');
    eq('ta persisted on app_lang', w.store.get('app_lang', ''), 'ta');
    eq('ta dir applied LTR', w.docEl.attrs.dir, 'ltr');
    eq('ta html lang', w.docEl.attrs.lang, 'ta');
    eq('ta fuel', w.I.t('mod.fuel'), 'எரிபொருள் மற்றும் செலவு');
    eq('ta unknown key still falls back, never blank', w.I.t('no.such.key', 'FB'), 'FB');
    w.I.setLang('pt');
    eq('pt is the live language', w.I.lang(), 'pt');
    eq('pt persisted on app_lang', w.store.get('app_lang', ''), 'pt');
    eq('pt fuel', w.I.t('mod.fuel'), 'Combustível e despesas');
    eq('pt paystub', w.I.t('mod.paystub'), 'Contracheque');
    w.I.setLang('ur');
    eq('the old guard is unmoved (ur still RTL)', w.docEl.attrs.dir, 'rtl');
  }
  console.log('— a stored ta/pt choice survives a cold start (storeGet pack gate) —');
  {
    const data = new Map([['app_lang', 'pt']]);
    const store = { get: function (k, d) { return data.has(k) ? data.get(k) : d; }, set: function (k, v) { data.set(k, v); } };
    const docEl = { attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } };
    const sb = { console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, parseFloat, parseInt, isFinite, isNaN };
    sb.window = sb;
    sb.document = { documentElement: docEl };
    sb.App = { _store: store };
    vm.createContext(sb);
    vm.runInContext(read('js/i18n.js'), sb);
    eq('cold start restores pt (not bounced to en)', sb.Meticulous.i18n.lang(), 'pt');
  }
  console.log('— wiring pins: picker stays data-driven; ship pins line up —');
  {
    const prefSrc = read('modules/preferences.js');
    check('preferences builds the picker from the registry', prefSrc.indexOf('Meticulous.i18n.langs()') !== -1 && prefSrc.indexOf('id="pf_lang"') !== -1);
    check('preferences carries no per-language hardcode for ta/pt', prefSrc.indexOf("'ta'") === -1 && prefSrc.indexOf("'pt'") === -1);
    const indexSrc = read('index.html');
    check('index.html pins i18n.js at this ship', indexSrc.indexOf('js/i18n.js?v=391') !== -1);
    const v = JSON.parse(read('version.json'));
    eq('webVersion bumped to 391', v.webVersion, 391);
    eq('native pointer preserved at 73', v.version, 73);
    eq('files map: js/i18n.js sha matches the shipped file', v.files['js/i18n.js'], sha('js/i18n.js'));
    eq('files map: index.html sha matches the shipped file', v.files['index.html'], sha('index.html'));
  }
  console.log('\ni18n-lang-sync-v391 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
