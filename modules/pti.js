/* Pre-Trip Inspection module — v162 (owner, Oct 18, 2026, 20:49 MDT:
 * "I wanna do my pti on this app tomorrow... So make sure it's up and
 * ready by then!"). The Alberta NSC Standard 13 / Schedule 1 daily
 * vehicle inspection, as a module of its own on the DRIVER face:
 *
 *  - Pre-filled from Preferences: carrier (contracting company first,
 *    else his own company) + address, truck unit #, plate if on file,
 *    the driver's printed name; date/time is the real now — a filing
 *    is stamped when it is filed, never backdated.
 *  - THE ODOMETER IS CAPTURED INSIDE THE INSPECTION, off the dash
 *    photo, through the app's ONE shared photo pipeline
 *    (App._wirePhotoOCR — the v142 fast path: the cloud Power Read
 *    starts the moment the photo is taken and races the on-device
 *    read, ~20 s ceiling; the first confident answer fills the
 *    field, the cloud answer corrects an untouched value or waits
 *    as a tap-to-use chip). A read NEVER writes the master by
 *    itself here: it lands in the form, the driver confirms it by
 *    signing & filing, and ONLY the filing commits it — through
 *    App._bumpOdometer(v, 'pti'), the same write every capture
 *    point uses, so the confirmed reading becomes the inspection's
 *    odometer, the dated odo_readings entry the manifest reads as
 *    the day's start boundary, today's session startOdo where one
 *    is missing, and the master odometer everything else
 *    (Maintenance reminders, fuel distance) reads live. No parallel
 *    odometer store exists.
 *  - The checklist is Schedule 1 itself — the 23 systems, each OK
 *    or Defect, one thumb. "No defects found" marks all OK in one
 *    tap. A defect REQUIRES a severity (minor/major) and a note;
 *    a photo is optional. A MAJOR defect is painted so it cannot
 *    be missed — on the filed report, in the history, in the PDF,
 *    and on the connected boss's copy.
 *  - Sign-off: the driver's printed name + the attestation tap
 *    ("Sign & file inspection") carrying the Schedule 1 statement.
 *  - CONNECT: a filed report publishes with the driver's shared
 *    records (js/connectpipe.js CP.sharedPti — facts only, photo
 *    bytes never cross) and paints on the boss's side inside his
 *    connected-driver records block (modules/pnl.js), majors first
 *    in red. No office-face card: the office face is untouched.
 *  - Schedule 1 ONLY (truck/tractor). Trailers (Schedule 2) come
 *    later, per the owner's order.
 *
 * Store keys: pti_reports (filed reports), pti_draft (the
 * in-progress inspection — leaving mid-checklist loses nothing).
 */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('pti_' + k, d); };
  var W = function (k, v) { App._store.set('pti_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  /* ---------------- Schedule 1 (NSC Standard 13) ----------------
     The 23 systems of Schedule 1 — trucks, tractors and trailers
     drawn by them; this module files the TRUCK side. minor/major
     are the Schedule's own defect columns, condensed to roadside
     words; they print as the guidance inside a defect entry. */
  var SCHED1 = [
    { id: 'airbrake', name: 'Air Brake System', minor: 'Audible air leak · slow air pressure build-up', major: 'Pushrod stroke over the adjustment limit · air loss rate over the limit · tractor protection or low-air warning failed · service, parking or emergency brake not working' },
    { id: 'cab', name: 'Cab', minor: 'Occupant door fails to open', major: 'Any cab or sleeper door fails to close securely' },
    { id: 'cargo', name: 'Cargo Securement', minor: 'Insecure or improper load covering', major: 'Insecure cargo · absence, failure or deterioration of a required securement device or covering' },
    { id: 'coupling', name: 'Coupling Devices', minor: 'Coupler or mounting has a loose or missing fastener', major: 'Coupler insecure or movement over the limit · coupling/locking mechanism damaged or fails to lock · defective, incorrect or missing safety chain or cable' },
    { id: 'dg', name: 'Dangerous Goods', minor: '', major: 'Dangerous goods requirements not met' },
    { id: 'controls', name: 'Driver Controls', minor: 'Accelerator pedal, clutch, gauges, audible/visual indicators or instruments fail to function properly', major: '' },
    { id: 'seat', name: 'Driver Seat', minor: 'Seat is damaged or fails to remain in set position', major: 'Seatbelt or tether belt is insecure, missing or malfunctions' },
    { id: 'ebrake', name: 'Electric Brake System', minor: 'Loose or insecure wiring or electrical connection', major: 'Inoperative breakaway device · inoperative brake' },
    { id: 'emergency', name: 'Emergency Equipment and Safety Devices', minor: 'Emergency equipment is missing, damaged or defective', major: '' },
    { id: 'exhaust', name: 'Exhaust System', minor: 'Exhaust leak', major: 'A leak that causes exhaust gas to enter the occupant compartment' },
    { id: 'frame', name: 'Frame and Cargo Body', minor: 'Damaged frame or cargo body', major: 'Visibly shifted, cracked, collapsing or sagging frame member' },
    { id: 'fuel', name: 'Fuel System', minor: 'Missing fuel tank cap', major: 'Insecure fuel tank · dripping fuel leak' },
    { id: 'general', name: 'General', minor: '', major: 'Serious damage or deterioration that is noticeable and may affect the vehicle’s safe operation' },
    { id: 'glass', name: 'Glass and Mirrors', minor: 'Required mirror or window glass fails to provide the required view (cracked, broken, damaged, missing or maladjusted) · broken or damaged attachments', major: '' },
    { id: 'heater', name: 'Heater / Defroster', minor: 'Control or system failure', major: 'Defroster fails to provide an unobstructed view through the windshield' },
    { id: 'horn', name: 'Horn', minor: 'Vehicle has no operative horn', major: '' },
    { id: 'hydbrake', name: 'Hydraulic Brake System', minor: 'Brake fluid level below the indicated minimum · parking brake inoperative', major: 'Brake boost or power assist not operative · brake fluid leak · pedal fade or insufficient reserve · activated (non-ABS) warning device · reservoir less than ¼ full' },
    { id: 'lamps', name: 'Lamps and Reflectors', minor: 'A required lamp does not function as intended · a required reflector is missing or partially missing', major: 'When lamps are required: both low-beam headlamps or both rearmost tail lamps fail · at all times: a rearmost turn-indicator lamp, or both rearmost brake lamps, fail' },
    { id: 'steering', name: 'Steering', minor: 'Steering wheel lash (free-play) greater than normal', major: 'Steering wheel is insecure or does not respond normally · lash exceeds the prescribed limit' },
    { id: 'suspension', name: 'Suspension System', minor: 'Air leak in the air suspension · a broken spring leaf · a suspension fastener loose, missing or broken', major: 'Damaged or deflated air bag · cracked or broken main spring leaf, or more than one broken leaf · part of a leaf or the suspension missing, shifted or touching another component · loose U-bolt' },
    { id: 'tires', name: 'Tires', minor: 'Damaged tread or sidewall · tire leaking', major: 'Flat tire · tread depth less than the wear limit · tire touching another tire or a vehicle component · exposed cords · tire marked “Not for highway use”' },
    { id: 'wheels', name: 'Wheels, Hubs and Fasteners', minor: 'Hub oil below minimum (sight glass) · leaking wheel seal', major: 'Loose, missing or ineffective wheel fastener · damaged, cracked or broken wheel, rim or attaching part · evidence of imminent wheel, hub or bearing failure' },
    { id: 'wipers', name: 'Windshield Wiper / Washer', minor: 'Control or system malfunction · wiper blade damaged, missing or fails to adequately clear the driver’s field of vision', major: 'When wipers/washer are required: fails to adequately clear the driver’s field of vision on the driver’s side' }
  ];
  var ITEM_BY_ID = {};
  SCHED1.forEach(function (it) { ITEM_BY_ID[it.id] = it; });

  var ATTESTATION = 'I inspected this vehicle in accordance with Schedule 1 of the National Safety Code Standard 13, and this report is true and complete in substance.';
  var NO_DEFECTS_STATEMENT = 'No major or minor defects were found during this inspection.';

  /* ---------------- data ---------------- */

  function reports() {
    var r = S('reports', []);
    return Array.isArray(r) ? r : [];
  }
  function profile() {
    var o = {};
    try { o = App._store.get('onboarding', {}) || {}; } catch (e) {}
    return {
      carrier: o.contractingCo || o.companyName || '',
      carrierAddr: o.contractingAddr || o.companyAddr || '',
      unit: o.truckNo || '',
      plate: o.plate || o.plateNo || '',
      driverName: ((o.firstName || '') + ' ' + (o.lastName || '')).trim()
    };
  }
  function blankDraft() {
    return { items: {}, odo: '', carrier: null, carrierAddr: null, unit: null, plate: null, loc: '', driver: null, lat: null, lng: null, kind: 'pre', sig: '' };
  }
  /* v170: the signature pad's fixed canvas geometry — the drawn
     signature (a JPEG data URL) rides the filed report at this
     size and prints on the PDF at the same aspect. */
  var SIG_W = 660, SIG_H = 220;
  /* v165: an inspection is a PRE-TRIP or a POST-TRIP (owner,
     Oct 18, 2026 21:48 MDT) — the choice lives in the form,
     defaults to Pre-trip, and rides the filed report. */
  function kindOf(r) { return (r && r.kind === 'post') ? 'post' : 'pre'; }
  function kindLabel(r) { return kindOf(r) === 'post' ? 'Post-trip' : 'Pre-trip'; }
  /* v165: a report is SIGNED when the driver attested it. Filing
     through Sign & file signs by construction (the attestation
     tap IS the signature); reports that predate the field (or
     arrive unsigned) stay unsigned until the driver signs them —
     the dashboard badge counts them and the module keeps asking. */
  function isSigned(r) { return !!(r && r.signed); }
  function draft() {
    var d = S('draft', null);
    if (!d || typeof d !== 'object') d = blankDraft();
    if (!d.items || typeof d.items !== 'object') d.items = {};
    return d;
  }
  function saveDraft(d) { W('draft', d); }
  /* A draft field: what the driver typed wins; until he types, the
     Preferences profile fills it. null on the draft = untouched. */
  function dVal(d, prof, key) {
    return (d[key] !== null && d[key] !== undefined) ? d[key] : (prof[key] || '');
  }

  function defectsOf(items) {
    var out = [];
    SCHED1.forEach(function (it) {
      var e = items && items[it.id];
      if (e && e.r === 'defect') {
        out.push({ id: it.id, item: it.name, severity: e.sev === 'major' ? 'major' : 'minor', note: String(e.note || ''), hasPhoto: !!e.photo });
      }
    });
    return out;
  }
  function resultOf(defects) {
    var major = false, minor = false;
    (defects || []).forEach(function (d) { if (d.severity === 'major') major = true; else minor = true; });
    return major ? 'major' : (minor ? 'minor' : 'pass');
  }
  function checkedCount(items) {
    var n = 0;
    SCHED1.forEach(function (it) { var e = items && items[it.id]; if (e && (e.r === 'ok' || e.r === 'defect')) n++; });
    return n;
  }

  /* The filing rules, in one place (the form's error line and the
     tests read the same words): the odometer must be captured,
     every Schedule 1 system must be answered, and every defect
     needs its severity and a note — a defect without them is not
     a report an officer (or a boss) can act on. */
  function validateDraft(d) {
    var odo = parseFloat(d && d.odo);
    if (!(odo > 0)) return 'Snap the dash photo to capture the odometer first — the inspection needs its reading.';
    var n = checkedCount(d.items);
    if (n < SCHED1.length) return 'Every item needs an answer — ' + n + ' of ' + SCHED1.length + ' checked so far. (One tap on “No defects found” answers them all.)';
    var bad = null;
    SCHED1.forEach(function (it) {
      var e = d.items[it.id];
      if (e && e.r === 'defect') {
        if (e.sev !== 'minor' && e.sev !== 'major' && !bad) bad = it.name + ': pick Minor or Major.';
        else if (!String(e.note || '').trim() && !bad) bad = it.name + ': a defect needs a note — what did you find?';
      }
    });
    if (bad) return bad;
    if (!String(d.driverNameEffective || '').trim()) return 'Your printed name is needed to sign the inspection.';
    /* v170 (owner, Oct 19, 2026 06:55 MDT — the Motive Sign Logs
       model): signing takes the DRAWN signature too, not just
       the printed name — no drawing, no filing. */
    if (!String(d.sig || '').trim()) return 'Draw your signature in the box — signing needs your drawn signature.';
    return '';
  }

  /* One filed report, built from the confirmed draft at the real
     filing moment. Pure: the caller stamps nothing else onto it. */
  function buildReport(d, nowMs) {
    var ts = (typeof nowMs === 'number' && isFinite(nowMs) && nowMs > 0) ? nowMs : Date.now();
    var dt = new Date(ts);
    function z(n) { return ('0' + n).slice(-2); }
    var date = dt.getFullYear() + '-' + z(dt.getMonth() + 1) + '-' + z(dt.getDate());
    var defects = defectsOf(d.items);
    var items = {};
    SCHED1.forEach(function (it) {
      var e = d.items[it.id] || {};
      items[it.id] = (e.r === 'defect')
        ? { r: 'defect', sev: e.sev === 'major' ? 'major' : 'minor', note: String(e.note || ''), photo: e.photo || '' }
        : { r: 'ok' };
    });
    return {
      id: 'pti' + ts,
      schedule: 'Schedule 1',
      kind: (d.kind === 'post') ? 'post' : 'pre',
      /* filed through the attestation tap = signed at filing;
         v170: the drawn signature rides the report */
      signed: true, signedAt: ts, signedName: String(d.driverNameEffective || ''),
      signature: String(d.sig || ''),
      filedAt: ts,
      date: date,
      carrier: String(d.carrier || ''), carrierAddr: String(d.carrierAddr || ''),
      unit: String(d.unit || ''), plate: String(d.plate || ''),
      location: String(d.loc || ''),
      lat: (typeof d.lat === 'number') ? d.lat : null,
      lng: (typeof d.lng === 'number') ? d.lng : null,
      odometer: parseFloat(d.odo) || 0,
      items: items,
      defects: defects,
      result: resultOf(defects),
      driverName: String(d.driverNameEffective || ''),
      attestation: ATTESTATION
    };
  }

  /* The printed report as typed lines for the app's PDF engine
     (MetPdf — the same line vocabulary the Manifest prints with).
     Every field the law asks a daily inspection report to carry:
     carrier name + address, plate, unit, date + time, location,
     the inspector's printed name, the odometer, the defects (or
     the no-defects statement), and the signed attestation. */
  function reportLines(r) {
    var lines = [];
    lines.push({ k: 'title', a: 'DAILY VEHICLE INSPECTION REPORT — SCHEDULE 1 (TRUCK / TRACTOR) · ' + (kindOf(r) === 'post' ? 'POST-TRIP' : 'PRE-TRIP') });
    lines.push({ k: 'note', a: 'National Safety Code Standard 13 · Schedule 1 daily inspection' });
    lines.push({ k: 'rule' });
    lines.push({ k: 'kv', a: 'Carrier', b: r.carrier || '—' });
    if (r.carrierAddr) lines.push({ k: 'kv', a: 'Carrier address', b: r.carrierAddr });
    lines.push({ k: 'kv', a: 'Date & time', b: new Date(r.filedAt).toLocaleString('en-CA') });
    lines.push({ k: 'kv', a: 'Location', b: r.location || '—' });
    lines.push({ k: 'kv', a: 'Truck unit #', b: r.unit || '—' });
    lines.push({ k: 'kv', a: 'Licence plate', b: r.plate || '—' });
    lines.push({ k: 'kv', a: 'Odometer', b: r.odometer ? Number(r.odometer).toLocaleString('en-CA') + ' km' : '—' });
    lines.push({ k: 'kv', a: 'Inspected by', b: r.driverName || '—' });
    lines.push({ k: 'rule' });
    if (r.result === 'major') {
      lines.push({ k: 'title', a: '⚠ MAJOR DEFECT FOUND — THIS VEHICLE MUST NOT BE OPERATED UNTIL THE DEFECT IS REPAIRED' });
      lines.push({ k: 'rule' });
    }
    lines.push({ k: 'h', a: 'Inspection results' });
    SCHED1.forEach(function (it) {
      var e = (r.items || {})[it.id];
      if (e && e.r === 'defect') {
        lines.push({ k: 'kv', a: it.name, b: (e.sev === 'major' ? '⛔ MAJOR DEFECT' : '⚠ Minor defect') + (e.note ? ' — ' + e.note : '') });
      } else {
        lines.push({ k: 'kv', a: it.name, b: '✓ OK' });
      }
    });
    lines.push({ k: 'rule' });
    if (r.defects && r.defects.length) {
      lines.push({ k: 'h', a: 'Defects found (' + r.defects.length + ')' });
      r.defects.forEach(function (d) {
        lines.push({ k: 'note', a: (d.severity === 'major' ? '⛔ MAJOR' : '⚠ Minor') + ' — ' + d.item + ': ' + d.note });
      });
    } else {
      lines.push({ k: 'note', a: NO_DEFECTS_STATEMENT });
    }
    lines.push({ k: 'rule' });
    lines.push({ k: 'note', a: r.attestation || ATTESTATION });
    lines.push({ k: 'kv', a: 'Signed', b: isSigned(r)
      ? (r.signedName || r.driverName || '') + ' · ' + new Date(r.signedAt || r.filedAt).toLocaleString('en-CA')
      : 'NOT SIGNED' });
    /* v170: the drawn signature prints on the PDF (MetPdf
       'sigimg' — a JPEG XObject). A pre-pad report (signed by
       name + attestation before the pad existed) prints without
       one, exactly as it was filed. */
    if (r.signature && String(r.signature).indexOf('base64,') !== -1) {
      lines.push({ k: 'sigimg', img: { b64: String(r.signature).split('base64,')[1], iw: SIG_W, ih: SIG_H } });
    }
    return lines;
  }

  /* ---------------- view state ---------------- */
  var view = { mode: 'form', id: null };   // 'form' | 'report' | 'dot'
  var formErr = '';
  var dotErr = '';
  var lastOdoNote = '';   // the filing moment's odometer-commit note (confirmation line only, never stored on the report)

  /* ---------------- v165: DOT INSPECTION MODE ----------------
     The officer-facing locked view (owner, Oct 18, 2026 21:48
     MDT; the model is the Motive roadside view from his own
     screenshots): hand the phone over and the officer sees the
     filed PTIs from the LAST 14 DAYS ONLY — nothing else. The
     state persists in the store (pti_dot) so a repaint or a
     restart cannot slip out of it, and the SHELL honors it:
     App.openModule / App.showDashboard route everything back
     here while it is active. Leaving takes the driver's PIN
     (set the first time he enters); the hash is a screen lock,
     not a vault — a light FNV-1a, never the PIN itself. */
  function dotState() {
    var s = S('dot', null);
    return (s && typeof s === 'object') ? s : { active: false, pinHash: '' };
  }
  function dotActive() { return !!dotState().active; }
  function pinHash(pin) {
    var h = 0x811c9dc5;
    var s = 'pti-dot:' + String(pin || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return 'h' + h.toString(16);
  }
  /* The officer's window: filed reports from the last 14 days
     (today + the 13 before), newest first. */
  function dotReports() {
    var cut = Date.now() - 13 * 86400000;
    var startDay = new Date(cut);
    startDay = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate()).getTime();
    return reports()
      .filter(function (r) { return (r.filedAt || 0) >= startDay; })
      .sort(function (a, b) { return (b.filedAt || 0) - (a.filedAt || 0); });
  }
  /* Compliance counts for the dashboard badge: unsigned reports,
     and days in the last 14 (before today) with no PRE-trip on
     file — an inspection regime is judged on its pre-trips. */
  function compliance() {
    var reps = reports();
    var unsigned = reps.filter(function (r) { return !isSigned(r); }).length;
    if (!reps.length) return { unsigned: 0, gaps: 0 };
    var preDays = {}, firstDate = null;
    reps.forEach(function (r) {
      if (kindOf(r) === 'pre' && r.date) preDays[r.date] = true;
      if (r.date && (!firstDate || r.date < firstDate)) firstDate = r.date;
    });
    /* gap days count only back to his FIRST filing — days before
       he ever filed (or before the app) aren't held against him */
    var gaps = 0;
    for (var i = 1; i <= 14; i++) {
      var d = new Date(Date.now() - i * 86400000);
      var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      if (firstDate && ds < firstDate) continue;
      if (!preDays[ds]) gaps++;
    }
    return { unsigned: unsigned, gaps: gaps };
  }

  function renderDot(body) {
    var list = dotReports();
    var h = '<div class="card" style="border:2px solid var(--navy)"><h3 style="margin-top:0">🛂 Vehicle Inspection Reports</h3>' +
      '<p class="note" style="margin-top:0">For the inspecting officer: this driver’s filed pre-trip and post-trip inspections from the last 14 days. Tap a report to view it in full.</p>' +
      (list.length ? list.map(function (r) {
        return '<div class="listitem" data-pti-open="' + esc(r.id) + '" style="cursor:pointer">' +
          '<div class="a">' + esc(r.date) + ' · ' + esc(kindLabel(r)) + ' · ' + esc(fmtWhen(r.filedAt)) + (r.unit ? ' · Unit ' + esc(r.unit) : '') + '</div>' +
          '<div class="b">' + (r.odometer ? 'Odometer ' + Number(r.odometer).toLocaleString('en-CA') + ' km · ' : '') + resultBadge(r) +
          (isSigned(r) ? '' : ' · <b style="color:#b91c1c">Not signed</b>') + '</div></div>';
      }).join('') : '<div class="empty">No inspections filed in the last 14 days.</div>') +
      '</div>';
    h += '<div class="card"><h3 style="margin-top:0">🔒 Driver only</h3>' +
      '<label class="f">Your PIN</label>' +
      '<input id="pti_dot_pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">' +
      (dotErr ? '<div style="color:#c2410c;font-weight:600;margin:8px 0">⚠️ ' + esc(dotErr) + '</div>' : '') +
      '<button type="button" class="btn primary" id="pti_dot_exit" style="width:100%">Unlock &amp; exit Inspection Mode</button>' +
      '<p class="note">The rest of the app stays locked until the driver unlocks it.</p></div>';
    body.innerHTML = h;
    body.querySelectorAll('[data-pti-open]').forEach(function (row) {
      row.onclick = function () { view = { mode: 'report', id: row.getAttribute('data-pti-open'), fromDot: true }; Meticulous.modules.pti.render(body); };
    });
    var ex = body.querySelector('#pti_dot_exit');
    if (ex) ex.onclick = function () {
      var pinEl = body.querySelector('#pti_dot_pin');
      var pin = pinEl ? String(pinEl.value || '') : '';
      var st = dotState();
      if (!pin || pinHash(pin) !== st.pinHash) { dotErr = 'That PIN doesn’t match — the app stays locked.'; renderDot(body); return; }
      dotErr = '';
      st.active = false; W('dot', st);
      view = { mode: 'form', id: null };
      Meticulous.modules.pti.render(body);
    };
  }

  function todayStr() {
    try { return App._today(); } catch (e) {}
    var d = new Date();
    function z(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function fmtWhen(ts) {
    try { return new Date(ts).toLocaleString('en-CA'); } catch (e) { return ''; }
  }
  function resultBadge(r) {
    if (r.result === 'major') return '<span style="background:#b91c1c;color:#fff;font-weight:800;padding:2px 8px;border-radius:8px;">🚨 MAJOR DEFECT</span>';
    if (r.result === 'minor') return '<span style="background:#fef3c7;color:#92400e;font-weight:700;padding:2px 8px;border-radius:8px;">⚠ Minor defect' + (r.defects.length === 1 ? '' : 's') + '</span>';
    return '<span style="background:#dcfce7;color:#166534;font-weight:700;padding:2px 8px;border-radius:8px;">✓ No defects</span>';
  }
  function majorBanner() {
    return '<div style="background:#b91c1c;color:#fff;border-radius:12px;padding:14px;margin-bottom:12px">' +
      '<div style="font-size:19px;font-weight:800">🚨 MAJOR DEFECT FOUND</div>' +
      '<div style="font-size:14px;margin-top:2px">This vehicle must NOT be operated until the defect is repaired.</div></div>';
  }

  /* ---------------- the form ---------------- */

  function itemRowHtml(it, e) {
    e = e || {};
    var isOk = e.r === 'ok', isDef = e.r === 'defect';
    var h = '<div style="padding:10px 0;border-bottom:1px solid #eef1f6">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<div style="flex:1;font-weight:600;color:var(--navy)">' + esc(it.name) + '</div>' +
      '<button type="button" class="btn small ' + (isOk ? 'primary' : 'ghost') + '" data-pti-ok="' + it.id + '" style="min-width:64px">✓ OK</button>' +
      '<button type="button" class="btn small ' + (isDef ? 'primary' : 'ghost') + '" data-pti-def="' + it.id + '" style="min-width:76px;' + (isDef ? 'background:#c2410c;border-color:#c2410c' : '') + '">⚠ Defect</button>' +
      '</div>';
    if (isDef) {
      var sev = e.sev === 'major' ? 'major' : (e.sev === 'minor' ? 'minor' : '');
      h += '<div style="margin-top:8px;padding:10px;border:1px solid ' + (sev === 'major' ? '#b91c1c' : '#f59e0b') + ';border-radius:10px;background:' + (sev === 'major' ? '#fef2f2' : '#fffbeb') + '">' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
        '<button type="button" class="btn small ' + (sev === 'minor' ? 'primary' : 'ghost') + '" data-pti-sev="minor:' + it.id + '" style="flex:1">Minor</button>' +
        '<button type="button" class="btn small ' + (sev === 'major' ? 'primary' : 'ghost') + '" data-pti-sev="major:' + it.id + '" style="flex:1;' + (sev === 'major' ? 'background:#b91c1c;border-color:#b91c1c' : '') + '">⛔ Major</button></div>' +
        (it.minor ? '<div class="note" style="margin:0 0 2px"><b>Minor:</b> ' + esc(it.minor) + '</div>' : '') +
        (it.major ? '<div class="note" style="margin:0 0 6px"><b>Major:</b> ' + esc(it.major) + '</div>' : '') +
        '<label class="f">What did you find? (required)</label>' +
        '<textarea id="pti_note_' + it.id + '" placeholder="Describe the defect…" rows="2">' + esc(e.note || '') + '</textarea>' +
        '<label class="f">📷 Photo of the defect (optional)</label>' +
        '<input type="file" id="pti_ph_' + it.id + '" accept="image/*" capture="environment">' +
        (e.photo ? '<img src="' + e.photo + '" style="width:100%;border-radius:8px;margin-top:6px">' +
          (App._photoDl ? App._photoDl(e.photo, 'pti-defect') : '') +
          '<button type="button" class="btn small ghost" data-pti-phdel="' + it.id + '">Remove photo</button>' : '') +
        '</div>';
    }
    return h + '</div>';
  }

  /* ---------------- v170: the finger signature pad ----------------
     Draw-to-sign, the Motive Sign Logs shape (owner, Oct 19,
     2026 06:55 MDT): the attestation words, a drawable box, a
     Clear button. Strokes land on a white canvas (so the JPEG
     export is black-on-white), pointer events drive it (finger
     or mouse), touch-action:none keeps the page from scrolling
     mid-stroke, and every stroke's end commits the drawing as a
     JPEG data URL through onChange. An existing drawing repaints
     into the box on open. All canvas work is guarded — a surface
     without a 2d context simply keeps the printed-name path
     visible (validation still asks for the drawing, so such a
     surface says so instead of silently passing). */
  function sigPadHtml(prefix) {
    return '<label class="f">Your signature — draw it with your finger</label>' +
      '<canvas id="' + prefix + '_sig" width="' + SIG_W + '" height="' + SIG_H + '" ' +
      'style="width:100%;height:150px;border:2px solid var(--navy);border-radius:10px;background:#fff;touch-action:none;display:block"></canvas>' +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn small ghost" id="' + prefix + '_sig_clear">Clear signature</button>' +
      '<span class="note" id="' + prefix + '_sig_note"></span></div>';
  }
  function wireSigPad(body, prefix, initial, onChange) {
    var cv = body.querySelector('#' + prefix + '_sig');
    var note = body.querySelector('#' + prefix + '_sig_note');
    var clearBtn = body.querySelector('#' + prefix + '_sig_clear');
    if (!cv || !cv.getContext) return;
    var ctx = null;
    try { ctx = cv.getContext('2d'); } catch (e) {}
    if (!ctx) return;
    function blank() {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, SIG_W, SIG_H);
    }
    blank();
    if (initial) {
      try {
        var img = new Image();
        img.onload = function () { try { ctx.drawImage(img, 0, 0, SIG_W, SIG_H); } catch (e) {} };
        img.src = initial;
      } catch (e) {}
      if (note) note.textContent = 'Signed — draw again to redo it, or Clear.';
    }
    var drawing = false, last = null;
    function pos(ev) {
      var r = cv.getBoundingClientRect();
      var cx = (ev.clientX !== undefined) ? ev.clientX : (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
      var cy = (ev.clientY !== undefined) ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0);
      return { x: (cx - r.left) * (SIG_W / (r.width || SIG_W)), y: (cy - r.top) * (SIG_H / (r.height || SIG_H)) };
    }
    function commit() {
      try { onChange(cv.toDataURL('image/jpeg', 0.85)); } catch (e) {}
      if (note) note.textContent = 'Signed — draw again to redo it, or Clear.';
    }
    function start(ev) {
      drawing = true; last = pos(ev);
      if (ev.preventDefault) ev.preventDefault();
      try { if (cv.setPointerCapture && ev.pointerId !== undefined) cv.setPointerCapture(ev.pointerId); } catch (e) {}
    }
    function move(ev) {
      if (!drawing) return;
      var p = pos(ev);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      if (ev.preventDefault) ev.preventDefault();
    }
    function end() { if (drawing) { drawing = false; commit(); } }
    if (window.PointerEvent || cv.addEventListener) {
      cv.addEventListener('pointerdown', start);
      cv.addEventListener('pointermove', move);
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    }
    if (clearBtn) clearBtn.onclick = function () {
      blank();
      onChange('');
      if (note) note.textContent = '';
    };
  }

  function renderForm(body) {
    var prof = profile();
    var d = draft();
    var reps = reports();
    var today = todayStr();
    var todays = reps.filter(function (r) { return r.date === today; })
      .sort(function (a, b) { return (a.filedAt || 0) - (b.filedAt || 0); });
    var n = checkedCount(d.items);
    var comp = compliance();

    var h = '';
    /* v165: unsigned reports keep asking to be signed until they
       are — the prompt lives here AND on the dashboard badge. */
    var unsignedReps = reps.filter(function (r) { return !isSigned(r); });
    if (unsignedReps.length) {
      h += '<div class="card" style="border:2px solid #f59e0b;background:#fffbeb"><h3 style="margin-top:0">✍️ ' +
        unsignedReps.length + ' inspection' + (unsignedReps.length === 1 ? ' is' : 's are') + ' not signed yet</h3>' +
        unsignedReps.slice(0, 5).map(function (r) {
          return '<div class="listitem" data-pti-open="' + esc(r.id) + '" style="cursor:pointer"><div class="a">' +
            esc(r.date) + ' · ' + esc(kindLabel(r)) + '</div><div class="b">Tap to open and sign it.</div></div>';
        }).join('') + '</div>';
    }
    if (todays.length) {
      h += '<div class="card" style="border:2px solid #16a34a;background:#f0fdf4"><h3 style="margin-top:0">✅ Today’s inspection' + (todays.length === 1 ? ' is' : 's are') + ' filed</h3>' +
        todays.map(function (r) {
          return '<div class="kv"><span>' + esc(kindLabel(r)) + ' · ' + esc(fmtWhen(r.filedAt)) + '</span><b>' + (r.odometer ? Number(r.odometer).toLocaleString('en-CA') + ' km' : '') + '</b></div>' +
            '<div style="margin:6px 0">' + resultBadge(r) + (isSigned(r) ? '' : ' <b style="color:#b91c1c">· Not signed</b>') + '</div>';
        }).join('') +
        '<button type="button" class="btn small navy" id="pti_view_today">View the latest report</button>' +
        '<p class="note">The form below starts a NEW inspection.</p></div>';
    }

    h += '<div class="card"><h3 style="margin-top:0">🚛 Inspection — Schedule 1</h3>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<button type="button" class="btn ' + (kindOf(d) !== 'post' ? 'primary' : 'ghost') + '" data-pti-kind="pre" style="flex:1">🌅 Pre-trip</button>' +
      '<button type="button" class="btn ' + (kindOf(d) === 'post' ? 'primary' : 'ghost') + '" data-pti-kind="post" style="flex:1">🌇 Post-trip</button></div>' +
      '<label class="f">Carrier</label><input id="pti_carrier" value="' + esc(dVal(d, prof, 'carrier')) + '">' +
      '<label class="f">Carrier address</label><input id="pti_caddr" value="' + esc(dVal(d, prof, 'carrierAddr')) + '">' +
      '<div class="row"><div><label class="f">Truck unit #</label><input id="pti_unit" value="' + esc(dVal(d, prof, 'unit')) + '"></div>' +
      '<div><label class="f">Licence plate</label><input id="pti_plate" value="' + esc(dVal(d, prof, 'plate')) + '" placeholder="If on file"></div></div>' +
      '<div class="kv"><span>Date & time</span><b>' + esc(new Date().toLocaleString('en-CA')) + '</b></div>' +
      '<label class="f">Location</label><input id="pti_loc" value="' + esc(d.loc || '') + '" placeholder="Where are you inspecting?">' +
      '<div style="margin-top:6px"><button type="button" class="btn small ghost" id="pti_gps">📍 Use my location</button> <span class="note" id="pti_gps_note">' +
      (typeof d.lat === 'number' ? 'GPS: ' + d.lat.toFixed(5) + ', ' + d.lng.toFixed(5) : '') + '</span></div>' +
      '</div>';

    /* The odometer door — the shared pipeline's element contract
       (prefix pti_odo: the field, _cam/_pick buttons, _cam_in/_in
       file inputs, _prev preview, _status line). */
    h += '<div class="card"><h3 style="margin-top:0">📸 Odometer</h3>' +
      '<label class="f" for="pti_odo">Odometer (km)</label>' +
      '<input id="pti_odo" type="number" inputmode="numeric" min="0" placeholder="Snap the dash — it fills itself" value="' + esc(d.odo || '') + '">' +
      '<input type="file" id="pti_odo_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
      '<input type="file" id="pti_odo_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
      '<div class="row" style="margin-top:8px"><button type="button" class="btn secondary" id="pti_odo_cam" style="flex:1;">📷 Snap the dash</button>' +
      '<button type="button" class="btn secondary" id="pti_odo_pick" style="flex:1;">📁 Choose file</button></div>' +
      '<div id="pti_odo_prev"></div><div id="pti_odo_status" class="note" style="margin-top:6px"></div>' +
      '<p class="note">The read takes seconds — keep inspecting while it lands; nothing is saved until you sign &amp; file below. Filing makes this reading the day’s start odometer and updates the truck’s odometer everywhere (service reminders included).</p></div>';

    h += '<div class="card"><h3 style="margin-top:0">📋 Schedule 1 checklist</h3>' +
      '<button type="button" class="btn primary" id="pti_allok" style="width:100%;margin-bottom:6px">✓ No defects found — mark everything OK</button>' +
      '<p class="note" id="pti_prog">' + n + ' of ' + SCHED1.length + ' checked</p>' +
      SCHED1.map(function (it) { return itemRowHtml(it, d.items[it.id]); }).join('') +
      '</div>';

    h += '<div class="card"><h3 style="margin-top:0">✍️ Sign &amp; file</h3>' +
      '<div style="border:1px solid #d7dce6;border-radius:10px;padding:10px;background:#f8fafc;font-size:14px">' + esc(ATTESTATION) + '</div>' +
      '<label class="f">Your printed name</label><input id="pti_driver" value="' + esc(dVal(d, prof, 'driverName')) + '">' +
      sigPadHtml('pti') +
      (formErr ? '<div id="pti_err" style="color:#c2410c;font-weight:600;margin:8px 0">⚠️ ' + esc(formErr) + '</div>' : '<div id="pti_err"></div>') +
      '<button type="button" class="btn primary" id="pti_file" style="width:100%">✍️ Sign &amp; file inspection</button>' +
      '<p class="note">Filed with the real time you tap — an inspection is never backdated. A copy reaches your connected boss/dispatcher by itself.</p></div>';

    /* v165: the DOT Inspection Mode door — the officer gets the
       last 14 days and nothing else; the driver gets back in
       with his PIN. First entry sets the PIN. */
    var dot = dotState();
    h += '<div class="card"><h3 style="margin-top:0">🛂 DOT Inspection Mode</h3>' +
      '<p class="note" style="margin-top:0">Hand the phone to an officer: they see only your filed inspections from the last 14 days. The rest of the app stays locked until you unlock it with your PIN.</p>' +
      (dot.pinHash
        ? '<button type="button" class="btn navy" id="pti_dot_enter" style="width:100%">🛂 Enter Inspection Mode</button>'
        : /* v177 (D8, owner Oct 20, 2026 — his words: "What's this
             pin?"): the field itself must say it in one look —
             YOU pick this number now; it locks everything else
             while the officer looks; you type it to get back in. */
          '<p class="note" style="margin:0 0 6px"><b>Pick a PIN you will remember.</b> When an officer checks your inspections, this PIN locks the rest of the app — the officer sees only your last 14 days of PTIs. When he hands the phone back, you type this same PIN to unlock the app.</p>' +
          '<label class="f">Your new PIN (4+ numbers)</label>' +
          '<input id="pti_dot_newpin" type="password" inputmode="numeric" autocomplete="off" placeholder="Type a PIN you choose">' +
          '<input id="pti_dot_newpin2" type="password" inputmode="numeric" autocomplete="off" placeholder="Type the same PIN again" style="margin-top:6px">' +
          '<div id="pti_dot_seterr"></div>' +
          '<button type="button" class="btn navy" id="pti_dot_set" style="width:100%;margin-top:8px">Set PIN &amp; enter Inspection Mode</button>') +
      (comp.gaps ? '<p class="note" style="margin-top:8px">⚠️ ' + comp.gaps + ' day' + (comp.gaps === 1 ? '' : 's') + ' in the last 14 had no pre-trip inspection on file.</p>' : '') +
      '</div>';

    h += historyHtml(reps);
    body.innerHTML = h;
    wireForm(body);
  }

  function historyHtml(reps) {
    var list = reps.slice().sort(function (a, b) { return (b.filedAt || 0) - (a.filedAt || 0); });
    var h = '<div class="card"><h3 style="margin-top:0">📁 Past inspections</h3>';
    if (!list.length) return h + '<div class="empty">No inspections filed yet.</div></div>';
    h += list.slice(0, 30).map(function (r) {
      return '<div class="listitem" data-pti-open="' + esc(r.id) + '" style="cursor:pointer">' +
        '<div class="a">' + esc(r.date) + ' · ' + esc(kindLabel(r)) + ' · ' + esc(fmtWhen(r.filedAt)) + (r.unit ? ' · Unit ' + esc(r.unit) : '') + '</div>' +
        '<div class="b">' + (r.odometer ? 'Odometer ' + Number(r.odometer).toLocaleString('en-CA') + ' km · ' : '') + resultBadge(r) +
        (isSigned(r) ? '' : ' <b style="color:#b91c1c">· Not signed — tap to sign</b>') +
        (r.defects && r.defects.length ? '<br>' + r.defects.map(function (df) { return esc((df.severity === 'major' ? '⛔ ' : '') + df.item + ': ' + df.note); }).join('<br>') : '') +
        '</div></div>';
    }).join('');
    if (list.length > 30) h += '<p class="note">Showing the newest 30 of ' + list.length + '.</p>';
    return h + '</div>';
  }

  function wireForm(body) {
    var d = draft();
    function bindText(id, key) {
      var elx = body.querySelector('#' + id);
      if (!elx) return;
      elx.addEventListener('input', function () { var dd = draft(); dd[key] = elx.value; saveDraft(dd); });
    }
    bindText('pti_carrier', 'carrier'); bindText('pti_caddr', 'carrierAddr');
    bindText('pti_unit', 'unit'); bindText('pti_plate', 'plate');
    bindText('pti_loc', 'loc'); bindText('pti_driver', 'driverName');
    var odoEl = body.querySelector('#pti_odo');
    if (odoEl) odoEl.addEventListener('input', function () { var dd = draft(); dd.odo = odoEl.value; saveDraft(dd); });

    /* v170: the signature pad — every finished stroke saves the
       drawing onto the draft; Clear wipes it. */
    try {
      wireSigPad(body, 'pti', d.sig || '', function (url) {
        var dd = draft(); dd.sig = url; saveDraft(dd);
      });
    } catch (e) {}

    /* The dash photo — the shared fast pipeline (v142 race:
       cloud starts at capture, ~20 s ceiling). Fill-only into the
       form (the persist records the pipeline-confirmed value on
       the DRAFT, never the master); Sign & file is the confirm. */
    try {
      if (App._wirePhotoOCR) {
        App._wirePhotoOCR('pti_odo', 'odometer', function (kind, v) {
          var dd = draft(); dd.odo = String(v); saveDraft(dd);
        }, { origin: { module: 'pti', label: 'Pre-Trip Inspection' } });
      }
    } catch (e) {}

    var gpsBtn = body.querySelector('#pti_gps');
    if (gpsBtn) gpsBtn.onclick = function () {
      var note = body.querySelector('#pti_gps_note');
      if (!window.MeticulousGeo || !MeticulousGeo.getCurrent) { if (note) note.textContent = 'Location isn’t available on this device — type it above.'; return; }
      if (note) note.textContent = 'Finding you…';
      MeticulousGeo.getCurrent(10000).then(function (fix) {
        if (!fix) { if (note) note.textContent = 'Couldn’t get a fix — type the location above.'; return; }
        var dd = draft(); dd.lat = fix.latitude; dd.lng = fix.longitude;
        if (!String(dd.loc || '').trim()) {
          dd.loc = 'GPS ' + Number(fix.latitude).toFixed(5) + ', ' + Number(fix.longitude).toFixed(5);
          var locEl = body.querySelector('#pti_loc'); if (locEl) locEl.value = dd.loc;
        }
        saveDraft(dd);
        /* v169: a last-known fix is labelled as one — it is still
           his position for the report, never silently "fresh" */
        if (note) note.textContent = (fix.stale ? 'Last known position: ' : 'GPS: ') +
          Number(fix.latitude).toFixed(5) + ', ' + Number(fix.longitude).toFixed(5);
      }).catch(function () { if (note) note.textContent = 'Couldn’t get a fix — type the location above.'; });
    };

    var vt = body.querySelector('#pti_view_today');
    if (vt) vt.onclick = function () {
      var t = todayStr(), reps = reports(), r = null;
      reps.forEach(function (x) { if (x.date === t && (!r || (x.filedAt || 0) > (r.filedAt || 0))) r = x; });
      if (r) { view = { mode: 'report', id: r.id }; Meticulous.modules.pti.render(body); }
    };

    /* v165: Pre-trip / Post-trip choice (default Pre-trip) */
    body.querySelectorAll('[data-pti-kind]').forEach(function (b) {
      b.onclick = function () {
        var dd = draft(); dd.kind = b.getAttribute('data-pti-kind') === 'post' ? 'post' : 'pre'; saveDraft(dd);
        Meticulous.modules.pti.render(body);
      };
    });

    /* v165: DOT Inspection Mode doors */
    var dotEnter = body.querySelector('#pti_dot_enter');
    if (dotEnter) dotEnter.onclick = function () {
      var st = dotState(); st.active = true; W('dot', st); dotErr = '';
      view = { mode: 'dot', id: null };
      Meticulous.modules.pti.render(body);
    };
    var dotSet = body.querySelector('#pti_dot_set');
    if (dotSet) dotSet.onclick = function () {
      var p1 = body.querySelector('#pti_dot_newpin'), p2 = body.querySelector('#pti_dot_newpin2');
      var e1 = body.querySelector('#pti_dot_seterr');
      var a = p1 ? String(p1.value || '') : '', b2 = p2 ? String(p2.value || '') : '';
      function bad(m) { if (e1) e1.innerHTML = '<div style="color:#c2410c;font-weight:600;margin-top:6px">⚠️ ' + m + '</div>'; }
      if (!/^\d{4,}$/.test(a)) { bad('The PIN needs at least 4 numbers.'); return; }
      if (a !== b2) { bad('The two PINs don’t match — try again.'); return; }
      W('dot', { active: true, pinHash: pinHash(a) });
      dotErr = ''; view = { mode: 'dot', id: null };
      Meticulous.modules.pti.render(body);
    };

    var allOk = body.querySelector('#pti_allok');
    if (allOk) allOk.onclick = function () {
      var dd = draft();
      SCHED1.forEach(function (it) { dd.items[it.id] = { r: 'ok' }; });
      saveDraft(dd); formErr = '';
      Meticulous.modules.pti.render(body);
    };

    body.querySelectorAll('[data-pti-ok]').forEach(function (b) {
      b.onclick = function () {
        var dd = draft(); dd.items[b.getAttribute('data-pti-ok')] = { r: 'ok' }; saveDraft(dd);
        Meticulous.modules.pti.render(body);
      };
    });
    body.querySelectorAll('[data-pti-def]').forEach(function (b) {
      b.onclick = function () {
        var dd = draft();
        var id = b.getAttribute('data-pti-def');
        var cur = dd.items[id] || {};
        dd.items[id] = { r: 'defect', sev: cur.sev || '', note: cur.note || '', photo: cur.photo || '' };
        saveDraft(dd);
        Meticulous.modules.pti.render(body);
      };
    });
    body.querySelectorAll('[data-pti-sev]').forEach(function (b) {
      b.onclick = function () {
        var parts = b.getAttribute('data-pti-sev').split(':');
        var dd = draft();
        var e = dd.items[parts[1]] || { r: 'defect' };
        e.r = 'defect'; e.sev = parts[0];
        dd.items[parts[1]] = e; saveDraft(dd);
        Meticulous.modules.pti.render(body);
      };
    });
    SCHED1.forEach(function (it) {
      var ta = body.querySelector('#pti_note_' + it.id);
      if (ta) ta.addEventListener('input', function () {
        var dd = draft(); var e = dd.items[it.id] || { r: 'defect' };
        e.r = 'defect'; e.note = ta.value; dd.items[it.id] = e; saveDraft(dd);
      });
      var ph = body.querySelector('#pti_ph_' + it.id);
      if (ph) ph.onchange = function () {
        var f = ph.files && ph.files[0];
        if (!f) return;
        var keep = function (url) {
          var dd = draft(); var e = dd.items[it.id] || { r: 'defect' };
          e.r = 'defect'; e.photo = url; dd.items[it.id] = e; saveDraft(dd);
          Meticulous.modules.pti.render(body);
        };
        var raw = new FileReader();
        raw.onload = function () {
          /* share-size rendition when the pipe's downscaler is
             around (a full-res photo would bloat the record);
             the raw frame otherwise. */
          if (window.ConnectPipe && ConnectPipe._rendition) {
            ConnectPipe._rendition(raw.result).then(function (u) { keep(u || raw.result); });
          } else keep(raw.result);
        };
        raw.readAsDataURL(f);
      };
    });
    body.querySelectorAll('[data-pti-phdel]').forEach(function (b) {
      b.onclick = function () {
        var dd = draft(); var e = dd.items[b.getAttribute('data-pti-phdel')];
        if (e) { e.photo = ''; saveDraft(dd); }
        Meticulous.modules.pti.render(body);
      };
    });
    body.querySelectorAll('[data-pti-open]').forEach(function (row) {
      row.onclick = function () { view = { mode: 'report', id: row.getAttribute('data-pti-open') }; Meticulous.modules.pti.render(body); };
    });

    var fileBtn = body.querySelector('#pti_file');
    if (fileBtn) fileBtn.onclick = function () { fileInspection(body); };
  }

  /* Sign & file: validate → build the report at the real now →
     save → commit the odometer through the ONE master path →
     publish to connected peers → show the filed report. */
  function fileInspection(body) {
    var prof = profile();
    var d = draft();
    /* fold the live form into the draft (the field values are the
       confirm — including a dash reading that landed while he
       worked the checklist) */
    function gv(id) { var e = body.querySelector('#' + id); return e ? e.value : null; }
    var v;
    if ((v = gv('pti_odo')) !== null) d.odo = v;
    if ((v = gv('pti_carrier')) !== null) d.carrier = v;
    if ((v = gv('pti_caddr')) !== null) d.carrierAddr = v;
    if ((v = gv('pti_unit')) !== null) d.unit = v;
    if ((v = gv('pti_plate')) !== null) d.plate = v;
    if ((v = gv('pti_loc')) !== null) d.loc = v;
    if ((v = gv('pti_driver')) !== null) d.driverName = v;
    d.driverNameEffective = String((d.driverName !== null && d.driverName !== undefined && String(d.driverName).trim()) ? d.driverName : prof.driverName).trim();
    saveDraft(d);

    var err = validateDraft(d);
    if (err) {
      formErr = err;
      Meticulous.modules.pti.render(body);
      return;
    }
    formErr = '';
    var rep = buildReport({
      items: d.items, odo: d.odo, kind: d.kind, sig: d.sig,
      carrier: d.carrier || '', carrierAddr: d.carrierAddr || '',
      unit: d.unit || '', plate: d.plate || '',
      loc: d.loc || '', lat: d.lat, lng: d.lng,
      driverNameEffective: d.driverNameEffective
    }, Date.now());

    var reps = reports();
    reps.push(rep);
    if (reps.length > 400) reps = reps.slice(reps.length - 400);
    W('reports', reps);
    try { if (window.FB && FB.saveDoc) { var c = Object.assign({}, rep); FB.saveDoc('pti', rep.id, c); } } catch (e) {}
    /* v187 (PTI-DASH): the standing dashboard banner repaints the
       moment a PTI lands — filing is the event it was waiting for. */
    try { if (App.paintPtiFlag) App.paintPtiFlag(); } catch (e) {}

    /* THE ODOMETER COMMIT — one write, three effects, all through
       the app's existing paths: App._bumpOdometer raises the
       master (mt_odo) and appends the dated odo_readings entry
       (source 'pti') the manifest reads as the day's start
       boundary; a running session for today that never got a
       start reading takes this one as its startOdo. Maintenance
       reminders and fuel distance read the master live — nothing
       else to update, and no second odometer store is created. */
    var odoNote = '';
    try {
      if (App._bumpOdometer) {
        var bump = App._bumpOdometer(rep.odometer, 'pti');
        if (bump && bump.refused === 'jump') odoNote = ' The reading is far past the truck’s recorded odometer, so the master odometer was left unchanged — check the number if that was real.';
      }
      var ss = App._store.get('sessions', []);
      if (Array.isArray(ss)) {
        var changed = false, t = todayStr();
        ss.forEach(function (s) {
          if (s && s.date === t && !(parseFloat(s.startOdo) > 0)) { s.startOdo = rep.odometer; changed = true; }
        });
        if (changed) App._store.set('sessions', ss);
      }
    } catch (e) {}
    lastOdoNote = odoNote;

    W('draft', blankDraft());
    /* the filed report reaches connected owners/dispatchers with
       the shared records (the pipe's publish cycle) */
    try { if (window.ConnectPipe && ConnectPipe.publishRecords) ConnectPipe.publishRecords(); } catch (e) {}

    view = { mode: 'report', id: rep.id, justFiled: true };
    Meticulous.modules.pti.render(body);
  }

  /* ---------------- the filed report ---------------- */

  function renderReport(body, id) {
    var reps = reports(), r = null;
    reps.forEach(function (x) { if (x.id === id) r = x; });
    if (!r) { view = { mode: 'form', id: null }; renderForm(body); return; }
    var h = '';
    if (view.justFiled) {
      h += '<div class="card" style="border:2px solid #16a34a;background:#f0fdf4"><b>✅ Filed</b> — ' + esc(fmtWhen(r.filedAt)) +
        '. Your odometer now reads <b>' + Number(r.odometer).toLocaleString('en-CA') + ' km</b> everywhere in the app.' +
        (lastOdoNote ? esc(lastOdoNote) : '') + '</div>';
    }
    if (r.result === 'major') h += majorBanner();
    h += '<div class="card"><h3 style="margin-top:0">Daily Vehicle Inspection Report — ' + esc(kindLabel(r)) + '</h3>' +
      '<div class="kv"><span>Carrier</span><b>' + esc(r.carrier || '—') + '</b></div>' +
      (r.carrierAddr ? '<div class="kv"><span>Carrier address</span><b>' + esc(r.carrierAddr) + '</b></div>' : '') +
      '<div class="kv"><span>Date & time</span><b>' + esc(fmtWhen(r.filedAt)) + '</b></div>' +
      '<div class="kv"><span>Location</span><b>' + esc(r.location || '—') + '</b></div>' +
      '<div class="kv"><span>Truck unit #</span><b>' + esc(r.unit || '—') + '</b></div>' +
      '<div class="kv"><span>Licence plate</span><b>' + esc(r.plate || '—') + '</b></div>' +
      '<div class="kv"><span>Odometer</span><b>' + (r.odometer ? Number(r.odometer).toLocaleString('en-CA') + ' km' : '—') + '</b></div>' +
      '<div class="kv"><span>Result</span><b>' + resultBadge(r) + '</b></div>' +
      '<h3>Schedule 1 results</h3>' +
      SCHED1.map(function (it) {
        var e = (r.items || {})[it.id];
        if (e && e.r === 'defect') {
          return '<div style="padding:8px 0;border-bottom:1px solid #eef1f6">' +
            '<div><b>' + esc(it.name) + '</b> — ' + (e.sev === 'major'
              ? '<span style="color:#b91c1c;font-weight:800">⛔ MAJOR DEFECT</span>'
              : '<span style="color:#92400e;font-weight:700">⚠ Minor defect</span>') + '</div>' +
            (e.note ? '<div class="note" style="margin:2px 0">' + esc(e.note) + '</div>' : '') +
            (e.photo ? '<img src="' + e.photo + '" style="width:100%;border-radius:8px;margin-top:4px">' +
              (App._photoDl ? App._photoDl(e.photo, 'pti-defect') : '') : '') +
            '</div>';
        }
        return '<div class="kv"><span>' + esc(it.name) + '</span><b>✓ OK</b></div>';
      }).join('') +
      (r.defects && r.defects.length ? '' : '<p style="margin-top:10px">' + esc(NO_DEFECTS_STATEMENT) + '</p>') +
      '<div style="border:1px solid #d7dce6;border-radius:10px;padding:10px;background:#f8fafc;font-size:14px;margin-top:12px">' + esc(r.attestation || ATTESTATION) + '</div>' +
      (isSigned(r)
        ? '<div class="kv" style="margin-top:8px"><span>Signed</span><b>' + esc(r.signedName || r.driverName || '') + ' · ' + esc(fmtWhen(r.signedAt || r.filedAt)) + '</b></div>'
        : '<div class="kv" style="margin-top:8px"><span>Signed</span><b style="color:#b91c1c">NOT SIGNED</b></div>') +
      /* v170: the drawn signature, on the report face */
      (r.signature ? '<img src="' + r.signature + '" alt="Driver signature" style="width:220px;max-width:70%;border:1px solid #d7dce6;border-radius:8px;margin-top:6px;background:#fff">' : '') +
      '<div class="row" style="margin-top:12px"><button type="button" class="btn navy" id="pti_print" style="flex:1">🖨 Print / PDF</button>' +
      '<button type="button" class="btn ghost" id="pti_back" style="flex:1">← Back</button></div>' +
      '<div id="pti_print_note" class="note" style="margin-top:6px"></div>' +
      '</div>';
    /* v165: an unsigned report carries its sign card — the
       attestation + printed name, signed with the REAL time. */
    if (!isSigned(r) && !view.fromDot) {
      h += '<div class="card" style="border:2px solid #f59e0b;background:#fffbeb"><h3 style="margin-top:0">✍️ Sign this inspection</h3>' +
        '<label class="f">Your printed name</label><input id="pti_sign_name" value="' + esc(r.driverName || profile().driverName || '') + '">' +
        sigPadHtml('pti2') +
        '<div id="pti_sign_err"></div>' +
        '<button type="button" class="btn primary" id="pti_sign" style="width:100%;margin-top:8px">✍️ Sign inspection</button>' +
        '<p class="note">Signing stamps the real time — it can’t be backdated.</p></div>';
    }
    body.innerHTML = h;
    /* v170: the signing prompt opens the pad — the drawn
       signature is what signs (with the printed name). */
    var signSig = '';
    try {
      wireSigPad(body, 'pti2', '', function (url) { signSig = url; });
    } catch (e) {}
    var signBtn = body.querySelector('#pti_sign');
    if (signBtn) signBtn.onclick = function () {
      var nmEl = body.querySelector('#pti_sign_name');
      var nm = nmEl ? String(nmEl.value || '').trim() : '';
      var eEl = body.querySelector('#pti_sign_err');
      if (!nm) { if (eEl) eEl.innerHTML = '<div style="color:#c2410c;font-weight:600;margin:8px 0">⚠️ Your printed name is needed to sign.</div>'; return; }
      if (!signSig) { if (eEl) eEl.innerHTML = '<div style="color:#c2410c;font-weight:600;margin:8px 0">⚠️ Draw your signature in the box — signing needs your drawn signature.</div>'; return; }
      var reps2 = reports();
      for (var i = 0; i < reps2.length; i++) {
        if (reps2[i].id === r.id) {
          reps2[i].signed = true; reps2[i].signedAt = Date.now(); reps2[i].signedName = nm;
          reps2[i].signature = signSig;
          if (!reps2[i].driverName) reps2[i].driverName = nm;
          r = reps2[i];
        }
      }
      W('reports', reps2);
      try { if (window.FB && FB.saveDoc) FB.saveDoc('pti', r.id, Object.assign({}, r)); } catch (e) {}
      try { if (window.ConnectPipe && ConnectPipe.publishRecords) ConnectPipe.publishRecords(); } catch (e) {}
      Meticulous.modules.pti.render(body);
    };
    var pb = body.querySelector('#pti_print');
    if (pb) pb.onclick = function () {
      var note = body.querySelector('#pti_print_note');
      function say(m) { if (note) note.textContent = m; }
      if (window.MetPdf && typeof MetPdf.savePdf === 'function') {
        say('Making your PDF…');
        MetPdf.savePdf({ title: 'Pre-Trip Inspection — ' + r.date, lines: reportLines(r) }, 'pti-' + r.date + '.pdf').then(
          function (res) { say(res && res.message ? res.message : 'PDF saved.'); },
          function () { say('The PDF could not be saved. Try again.'); });
      } else {
        say('PDF tools are still loading — close and reopen the app, then try again.');
      }
    };
    var bk = body.querySelector('#pti_back');
    if (bk) bk.onclick = function () {
      /* in Inspection Mode, Back returns to the officer's list —
         never to the driver's form */
      view = view.fromDot ? { mode: 'dot', id: null } : { mode: 'form', id: null, justFiled: false };
      Meticulous.modules.pti.render(body);
    };
  }

  /* v187 (PTI-DASH, owner Oct 21, 2026 07:19 MDT — video
     evidence: PTI filed 06:51 yet the dashboard tracker banner
     still read "⚠ No PTI filed today" while this module's own
     card read filed): THE filed-state source. One derivation —
     the first PRE-trip report filed for the date — read by the
     dashboard card (status below), by the app shell's standing
     banner (App.ptiFiledFor delegates here), and by the tests.
     The banner and the card can never disagree again, because
     there is only one place that decides. */
  function filedFor(dateStr) {
    var reps = reports(), out = null;
    reps.forEach(function (r) { if (r.date === dateStr && kindOf(r) === 'pre' && !out) out = r; });
    return out;
  }

  /* v213 (PTI-ROLE-SPLIT, owner Oct 21, 2026 14:09 MDT): the
     office-only user's PTI surface — VIEW-ONLY. One shared row
     per report, painted from the facts the driver's shared
     record carries (CP.sharedPti — the same facts, the same
     painting the P&L crew block used): a MAJOR defect cannot
     be missed. Read-only by construction — no buttons, no
     doors, nothing to file, nothing to sign. */
  function officePtiRowHtml(r) {
    var isMajor = r.result === 'major';
    var h = '<div class="kv"><span>' + esc(r.date) +
      ' · ' + (r.kind === 'post' ? 'Post-trip' : 'Pre-trip') +
      (r.unit ? ' · Unit ' + esc(r.unit) : '') +
      (r.odometer ? ' · odo ' + Number(r.odometer).toLocaleString('en-CA') + ' km' : '') +
      '</span><b>' + (isMajor
        ? '<span style="color:#b91c1c">🚨 MAJOR DEFECT</span>'
        : (r.result === 'minor' ? '<span style="color:#92400e">⚠ Minor defect(s)</span>' : '✓ No defects')) + '</b></div>';
    (r.defects || []).forEach(function (df) {
      var maj = df && df.severity === 'major';
      h += '<div style="padding-left:14px;margin:1px 0;' + (maj ? 'color:#b91c1c;font-weight:700' : 'color:#555') + '">' +
        (maj ? '⛔ MAJOR — ' : '⚠ Minor — ') + esc((df && df.item) || '') + (df && df.note ? ': ' + esc(df.note) : '') + '</div>';
    });
    h += '<div class="note" style="margin:0 0 6px">' + (r.signed ? 'Signed by ' + esc(r.driverName || 'the driver') : 'Not signed yet') + (r.location ? ' · ' + esc(r.location) : '') + '</div>';
    return h;
  }
  function renderOfficePti(body) {
    body.innerHTML =
      '<div class="card"><h3>🔍 Drivers\' PTI reports</h3>' +
      '<p class="note" style="margin-top:0">You don\'t fill these out — a PTI is the driver\'s own inspection. These are the reports your connected drivers filed and shared with you.</p>' +
      '<div id="pti_office_wrap"><p class="note">Loading…</p></div></div>';
    var wrap = null;
    try { wrap = body.querySelector('#pti_office_wrap'); } catch (e) {}
    if (!wrap) return;
    if (!window.ConnectPipe || !ConnectPipe.fetchRecords) {
      wrap.innerHTML = '<div class="empty">No PTI reports shared with you yet.</div>';
      return;
    }
    ConnectPipe.fetchRecords().then(function (out) {
      var recs = (out && out.records) || {};
      var uids = Object.keys(recs).filter(function (u) { return recs[u] && Array.isArray(recs[u].pti) && recs[u].pti.length; });
      if (!uids.length) {
        wrap.innerHTML = '<div class="empty">No PTI reports shared with you yet. When a connected driver files a PTI — and PTI is ticked on your connection — it shows here.</div>';
        return;
      }
      var h = '';
      uids.forEach(function (uid) {
        var rec = recs[uid];
        var nm = rec.driverName || rec.driverBusiness || '';
        if (!nm) { try { if (ConnectPipe.peerNames) nm = (ConnectPipe.peerNames(uid) || [])[0] || ''; } catch (e) {} }
        h += '<div style="margin:10px 0 2px;font-weight:700">' + esc(nm || 'Driver') + '</div>';
        rec.pti.forEach(function (r) { h += officePtiRowHtml(r); });
      });
      wrap.innerHTML = h;
    }).catch(function () {
      wrap.innerHTML = '<div class="empty">The reports could not be loaded — check your connection and reopen.</div>';
    });
  }

  /* ---------------- the module ---------------- */

  var lastBody = null;
  Meticulous.modules.pti = {
    /* the shell's banner reads the same source as the card */
    filedFor: filedFor,
    /* v165: the dashboard card is the compliance badge — today's
       state, then what is owed: unsigned inspections and days in
       the last 14 with no pre-trip on file. */
    status: function () {
      /* v213 (PTI-ROLE-SPLIT): an office-only user's PTI card is
         the VIEWER's line — he files nothing, so a driver
         framing ("not filed yet") is never said to him. */
      try { if (App.userRole && App.userRole() === 'office') return 'Your drivers\' filed inspections'; } catch (e) {}
      var t = todayStr(), filed = filedFor(t);
      var base;
      if (!filed) base = 'Today: not filed yet';
      else if (filed.result === 'major') base = 'Today: 🚨 MAJOR DEFECT';
      else if (filed.result === 'minor') base = 'Today: filed · minor defect';
      else base = 'Today: filed ✓ no defects';
      var c = compliance();
      var extra = [];
      if (c.unsigned) extra.push('⚠ ' + c.unsigned + ' unsigned');
      if (c.gaps) extra.push(c.gaps + ' day' + (c.gaps === 1 ? '' : 's') + ' without a pre-trip (14d)');
      return extra.length ? base + ' · ' + extra.join(' · ') : base;
    },
    resetView: function () { view = { mode: 'form', id: null, justFiled: false }; },
    back: function () {
      if (view.mode === 'report' && view.id) {
        view = view.fromDot ? { mode: 'dot', id: null } : { mode: 'form', id: null, justFiled: false };
        if (lastBody) Meticulous.modules.pti.render(lastBody);
        return true;
      }
      return false;
    },
    render: function (body) {
      lastBody = body;
      /* v213 (PTI-ROLE-SPLIT, owner Oct 21, 2026 14:09 MDT):
         office-only users (owners, fleet managers, office staff
         who do NOT drive) never fill out a PTI — their surface
         is view-only: their connected drivers' reports. The
         branch sits above EVERY other view (form, report,
         Inspection Mode) so no path can hand an office user the
         filing form. Drivers and owner-drivers ('both') fall
         through to the full module, exactly as before. */
      var roleNow = '';
      try { roleNow = (App.userRole && App.userRole()) || ''; } catch (e) {}
      if (roleNow === 'office') { renderOfficePti(body); return; }
      if (view.mode === 'report' && view.id) { renderReport(body, view.id); return; }
      /* Inspection Mode outranks every other view — while it is
         active the module can only ever paint the officer's list */
      if (dotActive()) { renderDot(body); return; }
      renderForm(body);
    },
    /* test hooks (the pnl _calc convention) */
    _sched1: SCHED1,
    _attestation: ATTESTATION,
    _validate: validateDraft,
    _buildReport: buildReport,
    _reportLines: reportLines,
    _resultOf: resultOf,
    _defectsOf: defectsOf,
    _kindOf: kindOf,
    _isSigned: isSigned,
    _filedFor: filedFor,
    _dotReports: dotReports,
    _dotActive: dotActive,
    _pinHash: pinHash,
    _compliance: compliance
  };
})();
