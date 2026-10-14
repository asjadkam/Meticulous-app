#!/usr/bin/env node
/* Meticulous OTA manifest builder.
 *
 * Regenerates version.json with a sha256 manifest of every deployable web
 * file. Run locally before cutting a native APK (so www/version.json matches
 * the bundled files), and in CI before `firebase deploy` (see
 * .github/workflows/deploy.yml).
 *
 *   node tools/build-ota.js          refresh manifest, keep webVersion
 *   node tools/build-ota.js --bump   refresh manifest AND webVersion+1
 *
 * Release flow: bump "webVersion" in version.json (or use --bump), push to
 * main -> CI rebuilds the manifest and deploys to Firebase Hosting. The app's
 * OTA bootstrap (js/ota.js) diffs the hosted manifest against its local copy
 * and downloads only changed files.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// Files/dirs that are part of the shipped web app (also the OTA payload).
const EXCLUDE_DIRS = new Set(['.git', '.github', 'node_modules', 'training-data', 'tools']);
const EXCLUDE_FILES = new Set(['firebase.json', '.firebaserc', 'firestore.rules', 'BUGS.md', 'PRODUCT_REQUIREMENTS.md', 'OTA.md', '.gitignore']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.nojekyll') {
      if (e.name === '.git' || e.name === '.github' || e.name === '.firebaserc') continue;
    }
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      if (EXCLUDE_FILES.has(e.name)) continue;
      if (e.name.endsWith('.md')) continue;
      if (rel === 'version.json') continue; // regenerated below
      out.push(rel);
    }
  }
  return out;
}

function sha256File(full) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(full));
  return h.digest('hex');
}

function main() {
  const bump = process.argv.includes('--bump');
  const tplPath = path.join(ROOT, 'version.json');
  let tpl = { version: 30, apkUrl: '', webVersion: 30, notes: '' };
  try { tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8')); } catch (e) { /* use defaults */ }

  const files = {};
  const list = walk(ROOT, []).sort();
  for (const rel of list) files[rel] = sha256File(path.join(ROOT, rel));

  const out = {
    version: tpl.version,
    apkUrl: tpl.apkUrl || '',
    webVersion: bump ? (tpl.webVersion || 30) + 1 : (tpl.webVersion || 30),
    notes: tpl.notes || 'OTA: web assets update in-app; native reinstall only when apkUrl points at a newer APK.',
    files: files
  };
  fs.writeFileSync(tplPath, JSON.stringify(out, null, 2) + '\n');
  console.log('version.json written: webVersion=' + out.webVersion + ', files=' + list.length);
}

main();
