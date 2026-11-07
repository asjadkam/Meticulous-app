#!/usr/bin/env node
/* Meticulous v362 — TAP-A-MAPS-LINK-OPENS-OUR-NAVIGATOR tests.
 *
 * Owner (Nov 7, 2026 08:45): "Is there a way for us to just click
 * on the link like we click on for it to open Google Maps? But
 * it opens our navigation instead."
 *
 * What v362 (web) + v72 (native) builds:
 *  (1) NATIVE (meticulous-native): MainActivity gains plain
 *      VIEW intent filters (DEFAULT + BROWSABLE) for the Google
 *      Maps link patterns — maps.app.goo.gl, goo.gl/maps,
 *      maps.google.com, google.com/.ca /maps — plus the geo:
 *      scheme. NO autoVerify: those are Google's domains and can
 *      never be this app's verified App Links, so Android's app
 *      chooser is the honest route ("Always" makes it one tap).
 *  (2) WEB (js/deeplink.js): the tapped URL arrives through the
 *      Capacitor App plugin — getLaunchUrl once per page load
 *      (cold start), appUrlOpen (warm start) — deduped by a
 *      seen-marker so one tap is handled exactly once; it waits
 *      in the store (survives process death + sign-out) until
 *      the app is signed in and Navigation is up, then runs
 *      PinLinks into Navigation.navigateToPin — the dispatch
 *      pin's own hand-off. Unresolvable links degrade honestly:
 *      the Navigator opens with the link preserved in its
 *      sent-pin box (modules/navigator.js consumes
 *      'maplink_link') under a plain note — never a fake pin.
 *  (3) js/app.js drains the inbox beside its widget collects
 *      (init, visibility return, PiP exit).
 *
 * ACCEPTANCE (the owner's real Nov 7 dispatch pins): a tapped
 * full link for Aecon's Go Empty To must land 51.1252302,
 * -113.9828043 in the Navigator; the Hauling To pin
 * 51.3078892,-114.0369748 likewise, in full-link, short-link
 * (resolver landing), and geo: forms.
 *
 * Run: node tools/taplink-v362-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NATIVE = path.resolve(ROOT, '..', 'meticulous-native');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pinSrc = read('js/pinlinks.js');
const dlSrc = read('js/deeplink.js');
const appSrc = read('js/app.js');
const navSrc = read('modules/navigator.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));
const manifest = fs.readFileSync(path.join(NATIVE, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const gradle = fs.readFileSync(path.join(NATIVE, 'android/app/build.gradle'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

const PIN1 = { lat: 51.1252302, lng: -113.9828043 };   // Go Empty To
const PIN2 = { lat: 51.3078892, lng: -114.0369748 };   // Hauling To
const FULL1 = 'https://www.google.com/maps/place/Aecon+Trans/@51.1252302,-113.9828043,17z';
const FULL2 = 'https://www.google.com/maps/@51.3078892,-114.0369748,17z';
const SHORT1 = 'https://maps.app.goo.gl/AbC123xYz';
const SHORT2 = 'https://maps.app.goo.gl/DeF456uVw';

/* ---------------- the sandbox world ----------------
   The REAL store sliced from js/app.js (the v358 harness
   pattern) over a Map-backed localStorage — share the backing
   between two worlds to replay a process death. Scriptable
   fetch + a scriptable Capacitor App plugin. */
function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}
function makeBacking() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); }
  };
}
let fetchPlan = () => Promise.reject(new Error('no plan'));

function makeWorld(opts) {
  opts = opts || {};
  const backing = opts.backing || makeBacking();
  const world = {
    navCalls: [], openCalls: [], launchUrlCalls: 0,
    listeners: {}, launchUrl: opts.launchUrl || null
  };
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, URLSearchParams,
    fetch: (url, init) => fetchPlan(String(url), init || {}),
    PowerRead: { APP_TOKEN: 'test-token-362' },
    localStorage: backing,
    document: { addEventListener() {}, visibilityState: 'visible' },
    navigator: {}, location: { search: '' }, history: { replaceState() {} }
  };
  sb.window = sb;
  sb.App = {
    _today: () => '2026-11-07',
    user: opts.signedIn === false ? null : { email: 'driver@example.com' },
    openModule: (m) => { world.openCalls.push(m); }
  };
  sb.FB = { auth: { currentUser: sb.App.user } };
  sb.Meticulous = { modules: { navigation: {
    navigateToPin: (name, lat, lng) => { world.navCalls.push({ name, lat, lng }); }
  } } };
  sb.Capacitor = { Plugins: { App: {
    addListener: (name, fn) => { (world.listeners[name] = world.listeners[name] || []).push(fn); },
    getLaunchUrl: () => { world.launchUrlCalls++; return Promise.resolve(world.launchUrl ? { url: world.launchUrl } : null); }
  } } };
  vm.createContext(sb);
  vm.runInContext(extractStore(appSrc) + '\n;App._store = store;', sb);
  if (opts.loadApp !== false) {
    vm.runInContext(pinSrc, sb);
    vm.runInContext(dlSrc, sb);
  }
  world.sb = sb;
  world.emit = (name, data) => { (world.listeners[name] || []).forEach((f) => f(data)); };
  world.store = sb.App._store;
  return world;
}

async function main() {
  /* ---------------- URL acceptance ---------------- */
  {
    const w = makeWorld();
    const DL = w.sb.window.DeepLink;
    ok('DeepLink registers', !!DL);
    const acc = (u) => DL._isMapsLinkUrl(u);
    ok('accepts maps.app.goo.gl short link', acc(SHORT1));
    ok('accepts goo.gl/maps', acc('https://goo.gl/maps/xyz789'));
    ok('accepts google.com/maps place link', acc(FULL1));
    ok('accepts google.ca/maps', acc('https://www.google.ca/maps/@51.1,-113.9,15z'));
    ok('accepts maps.google.com', acc('https://maps.google.com/?q=51.1,-113.9'));
    ok('accepts geo: pair URI', acc('geo:51.1252302,-113.9828043'));
    ok('accepts geo: q= URI', acc('geo:0,0?q=51.3078892,-114.0369748'));
    ok('rejects a non-maps URL', !acc('https://example.com/@51.1252302,-113.9828043'));
    ok('rejects the app\'s own APK link', !acc('https://asjadkam.github.io/Meticulous-app/meticulous-v53.apk'));
    ok('rejects a bare google search link', !acc('https://www.google.com/search?q=tim+hortons'));
    eq('name from /place/ segment', DL._nameFromUrl(FULL1), 'Aecon Trans');
    eq('q= words are a name', DL._nameFromUrl('geo:0,0?q=Tim+Hortons'), 'Tim Hortons');
    eq('q= pair is not a name', DL._nameFromUrl('https://www.google.com/maps?q=51.1252302,-113.9828043'), '');
  }

  /* ---------------- full-link tap: extraction -> hand-off ---------------- */
  {
    const w = makeWorld();
    w.emit('appUrlOpen', { url: FULL1 });
    await tick();
    eq('one tap on a full link = one navigateToPin', w.navCalls.length, 1);
    eq('the Go Empty To pin lands', w.navCalls[0] && { lat: w.navCalls[0].lat, lng: w.navCalls[0].lng }, PIN1);
    eq('the link\'s place name rides', w.navCalls[0] && w.navCalls[0].name, 'Aecon Trans');
    eq('inbox cleared after handling', w.store.get('maplink_inbox', null), null);
  }
  {
    const w = makeWorld();
    w.emit('appUrlOpen', { url: 'https://www.google.com/maps/data=!4m2!3d51.3078892!4d-114.0369748' });
    await tick();
    eq('!3d/!4d link lands the Hauling To pin', w.navCalls[0] && { lat: w.navCalls[0].lat, lng: w.navCalls[0].lng }, PIN2);
    eq('unnamed pin is a Sent pin', w.navCalls[0] && w.navCalls[0].name, 'Sent pin');
  }
  {
    const w = makeWorld();
    w.emit('appUrlOpen', { url: 'geo:51.1252302,-113.9828043' });
    await tick();
    eq('geo: pair lands', w.navCalls[0] && { lat: w.navCalls[0].lat, lng: w.navCalls[0].lng }, PIN1);
  }
  {
    const w = makeWorld();
    w.emit('appUrlOpen', { url: 'geo:0,0?q=51.3078892,-114.0369748' });
    await tick();
    eq('geo: 0,0?q=pair lands the q pin, never 0,0', w.navCalls[0] && { lat: w.navCalls[0].lat, lng: w.navCalls[0].lng }, PIN2);
  }

  /* ---------------- short links: follow, server door, degrade ---------------- */
  {
    fetchPlan = (url) => {
      if (url === SHORT1) return Promise.resolve({ url: FULL1, ok: true });
      return Promise.reject(new Error('CORS'));
    };
    const w = makeWorld();
    w.emit('appUrlOpen', { url: SHORT1 });
    await tick(30);
    eq('short link followed to its pin', w.navCalls[0] && { lat: w.navCalls[0].lat, lng: w.navCalls[0].lng }, PIN1);
  }
  {
    fetchPlan = (url) => {
      if (url.indexOf('https://2.31.47.19/ai/resolve') === 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ lat: PIN2.lat, lng: PIN2.lng }) });
      }
      return Promise.reject(new Error('CORS'));
    };
    const w = makeWorld();
    w.emit('appUrlOpen', { url: SHORT2 });
    await tick(30);
    eq('server door answers when the follow cannot', w.navCalls[0] && { lat: w.navCalls[0].lat, lng: w.navCalls[0].lng }, PIN2);
  }
  {
    fetchPlan = () => Promise.reject(new Error('CORS'));
    const w = makeWorld();
    w.emit('appUrlOpen', { url: SHORT1 });
    await tick(30);
    eq('unresolvable link navigates NOWHERE (no fake pin)', w.navCalls.length, 0);
    const kept = w.store.get('maplink_link', null);
    ok('unresolvable link is preserved for the Navigator', !!kept && kept.url === SHORT1, JSON.stringify(kept));
    eq('degradation opens the Navigator', w.openCalls, ['navigator']);
  }

  /* ---------------- exactly once per tap ---------------- */
  {
    fetchPlan = () => Promise.reject(new Error('unused'));
    const w = makeWorld({ launchUrl: FULL2 });
    await tick(30);  // wire() takes the launch read
    w.emit('appUrlOpen', { url: FULL2 });   // the same tap echoing through the listener
    w.emit('appUrlOpen', { url: FULL2 });   // and again
    await tick(30);
    eq('cold start: launch + appUrlOpen echoes = ONE handling', w.navCalls.length, 1);
    eq('the launch pin landed', w.navCalls[0] && { lat: w.navCalls[0].lat, lng: w.navCalls[0].lng }, PIN2);
    eq('launch URL read exactly once', w.launchUrlCalls, 1);
    w.emit('appStateChange', { isActive: true });
    w.emit('appStateChange', { isActive: true });
    await tick(30);
    eq('foreground returns never re-deliver the launch tap', w.navCalls.length, 1);
    /* a deliberate NEW tap on the same link after the dedupe window */
    const seen = w.store.get('maplink_seen', null);
    w.store.set('maplink_seen', { url: seen.url, ts: Date.now() - 31000 });
    w.emit('appUrlOpen', { url: FULL2 });
    await tick(30);
    eq('a fresh tap on the same link after the window IS honoured', w.navCalls.length, 2);
  }

  /* ---------------- cold-start survival: sign-out + process death ---------------- */
  {
    fetchPlan = () => Promise.reject(new Error('unused'));
    const backing = makeBacking();
    const dead = makeWorld({ backing, signedIn: false });
    dead.emit('appUrlOpen', { url: FULL1 });
    await tick(30);
    eq('signed out: no navigation attempted', dead.navCalls.length, 0);
    const held = dead.store.get('maplink_inbox', null);
    ok('signed out: the tap waits in the inbox', !!held && held.url === FULL1, JSON.stringify(held));
    /* the process dies; a fresh world rises over the same localStorage */
    const risen = makeWorld({ backing, signedIn: true });
    await tick(40);  // wire() drains on load
    eq('after relaunch + sign-in the held tap lands', risen.navCalls.length, 1);
    eq('…with the Go Empty To pin', risen.navCalls[0] && { lat: risen.navCalls[0].lat, lng: risen.navCalls[0].lng }, PIN1);
    eq('inbox empty after the held tap lands', risen.store.get('maplink_inbox', null), null);
  }

  /* ---------------- statics: wiring + ship shape ---------------- */
  ok('index.html loads deeplink.js?v=362', idxSrc.indexOf('js/deeplink.js?v=362') !== -1);
  ok('index.html bumps app.js to ?v=362', idxSrc.indexOf('js/app.js?v=362') !== -1);
  ok('index.html bumps navigator.js to ?v=362', idxSrc.indexOf('modules/navigator.js?v=362') !== -1);
  ok('deeplink.js loads AFTER app.js (the store must exist)',
    idxSrc.indexOf('js/deeplink.js?v=362') > idxSrc.indexOf('js/app.js?v=362'));
  ok('deeplink.js loads AFTER pinlinks.js (the link brain)',
    idxSrc.indexOf('js/deeplink.js?v=362') > idxSrc.indexOf('js/pinlinks.js'));
  eq('app.js drain hooks beside the collects', (appSrc.match(/DeepLink\.drain\(\)/g) || []).length, 3);
  ok('deeplink routes through Navigation.navigateToPin', dlSrc.indexOf('navigateToPin') !== -1);
  ok('deeplink never opens Google Maps', dlSrc.indexOf('window.open') === -1 && dlSrc.indexOf('location.href') === -1);
  ok('Navigator consumes maplink_link', navSrc.indexOf("App._store.get('maplink_link'") !== -1);
  ok('Navigator note is plain about the failure', navSrc.indexOf('could not read a pin from it') !== -1);
  eq('version.json webVersion', ver.webVersion, 362);
  eq('version.json generation (native v72 pointer)', ver.version, 53);
  ok('version.json apkUrl names the v72-era APK', /meticulous-v53\.apk$/.test(ver.apkUrl), ver.apkUrl);
  ok('deeplink.js is in the OTA manifest', !!ver.files['js/deeplink.js']);

  /* ---------------- statics: the native filters ---------------- */
  const hosts = ['maps.app.goo.gl', 'maps.google.com', 'www.google.com', 'google.com', 'www.google.ca', 'google.ca'];
  hosts.forEach((h) => ok('manifest registers host ' + h, manifest.indexOf('android:host="' + h + '"') !== -1));
  ok('goo.gl registered with the /maps prefix',
    /android:host="goo\.gl" android:pathPrefix="\/maps"/.test(manifest));
  ok('google hosts keep the /maps prefix',
    (manifest.match(/android:pathPrefix="\/maps"/g) || []).length >= 5);
  ok('geo: scheme registered', manifest.indexOf('android:scheme="geo"') !== -1);
  ok('https scheme on the maps filter', manifest.indexOf('android:scheme="https"') !== -1);
  ok('BROWSABLE + DEFAULT on the link filters',
    (manifest.match(/android.intent.category.BROWSABLE/g) || []).length >= 2 &&
    (manifest.match(/android.intent.category.DEFAULT/g) || []).length >= 2);
  ok('NO autoVerify attribute claimed (Google domains are not ours)', manifest.indexOf('android:autoVerify') === -1);
  ok('native versionCode 47', /versionCode 47/.test(gradle));
  ok('native versionName 1.45', /versionName "1\.45"/.test(gradle));

  console.log('\ntaplink-v362: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ERROR', e); process.exit(2); });
