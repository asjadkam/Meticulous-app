# Meticulous OTA (over-the-air) updates — v30+

Beta testers get **web updates without reinstalling the APK**. Only native
changes need a fresh install.

## How it works

- The web app is deployed to Firebase Hosting: https://meticulous-dd570.web.app
- `js/ota.js` runs before anything else **inside the native app only**.
  On launch it fetches `/version.json` (6s timeout):
  - Hosted `webVersion` > local → downloads only files whose sha256 changed
    into the app-private `ota-web` folder, hash-verifies each file, then
    redirects the WebView to that copy via `Capacitor.convertFileSrc()`.
    Origin stays `https://localhost`, so localStorage / Firebase Auth /
    cloud sync all keep working.
  - Offline or any failure → boots the newest **local** copy (downloaded
    OTA copy if present, else the APK-bundled `www/`).
  - Interrupted downloads self-heal: `ota-web/version.json` is written last,
    so the next launch re-diffs and finishes.
- On the plain website / desktop browser, `js/ota.js` is a no-op.

## version.json fields

| field | meaning |
|---|---|
| `version` | latest **native** release number (for the APK banner) |
| `apkUrl` | download URL of the newest APK; empty = no native update pending |
| `webVersion` | latest **web** release number (for OTA) |
| `files` | `{ "path": "sha256hex" }` manifest of the web release |
| `notes` | human-readable note |

## Releasing

**Web-only change** (HTML/JS/CSS/modules — no new plugin/permission):
1. Bump `webVersion` in `version.json`.
2. Push `Meticulous-app` main → GitHub Actions runs `node tools/build-ota.js`
   (refreshes the sha256 manifest) and `firebase deploy --only hosting`.
3. Testers get it automatically on next app launch (or via
   Preferences > Advanced > "Check for updates"). No reinstall.

**Native change** (new Capacitor plugin, permission, AndroidManifest edit,
Capacitor upgrade):
1. Make the native change in `Meticulous-native`, bump `APK_VERSION` in
   `js/app.js`, bump `version` in `version.json`.
2. Build the APK (push `Meticulous-native` main), upload it somewhere
   (e.g. a GitHub release), put the URL in `version.json:apkUrl`.
3. Push `Meticulous-app` main (deploys the new version.json).
4. Testers see an orange "Update available — Tap to download" banner and
   reinstall once.

## Files

- `js/ota.js` — the updater (runs first, gates `App.init` via `OTA.ready()`).
- `tools/build-ota.js` — manifest builder (`--bump` also bumps webVersion).
- `.github/workflows/deploy.yml` — CI: build manifest → deploy hosting.
- `modules/preferences.js` — Advanced > "Check for updates" (manual).

## Constraints

- All in-app asset references must be **relative** (`js/app.js`, not
  `/js/app.js`) so the downloaded copy works from its `_capacitor_file_`
  sub-path. The two `Notification` icons were converted too.
- `js/ota.js` needs `@capacitor/filesystem` (native, added in v30) and
  `Capacitor.convertFileSrc`. If either is missing (old APK), OTA is skipped
  silently and the old APK banner still works.
- Never break the offline path: any OTA failure must resolve `OTA.ready()`
  and boot the local copy.
