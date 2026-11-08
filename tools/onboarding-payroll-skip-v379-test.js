/* onboarding-payroll-skip-v379-test.js — proof for
 * ONBOARDING-COMPANY-DETAILS-FOR-PAYROLL-NOV8 (owner Nov 8, 2026):
 * a payroll employee has no company, no GST/HST number and issues
 * no invoices, so the wizard must never walk her through "Company
 * details" — yet Nirojini, onboarding as a payroll school-bus
 * driver, was photographed on "Step 8 of 12: Company details".
 *
 * The payroll fact is onboarding.employment === 'Payroll' (the
 * "How are you paid?" step, key 'employment', opts Contract /
 * Payroll) — the same fact the Invoice module branches on for its
 * pay-stub face. The wizard's ONE visibility law (onbStepVisible,
 * through which the renderer, Next/Back/Skip, the snap and the
 * "Step X of Y" counter all run) consulted only userRole. The fix
 * adds the payroll arm: employment 'Payroll' hides the 'company'
 * step. Contract keeps every step exactly as before.
 *
 * Run:  node tools/onboarding-payroll-skip-v379-test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm');
const ROOT = __dirname + '/..';
let pass = 0, fail = 0; const fails = [];
function ok(c, m) { if (c) { pass++; } else { fail++; fails.push(m); console.log('  FAIL - ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function region(file, begin, end) {
  const src = fs.readFileSync(ROOT + '/' + file, 'utf8');
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error('region not found in ' + file);
  return src.slice(i, j);
}

/* ---------- the wizard's step table + visibility law ---------- */
const box = {};
vm.runInNewContext(
  region('js/app.js', '  var ONB_STEPS = [', '  /* v76 (F8): the company step collects') +
  '\nthis.__W = { steps: ONB_STEPS, vis: onbStepVisible, next: onbNextVisible, prev: onbPrevVisible,' +
  ' count: onbVisibleCount, pos: onbVisiblePos };', box);
const W = box.__W;
ok(!!W && Array.isArray(W.steps), 'wizard region extracted (steps + visibility law)');
eq(W.steps.length, 12, 'the wizard still has its 12 steps');
eq(W.steps.map(function (s) { return s.key; }).join(','),
  'name,accountType,userRole,driverKind,employment,pay,base,company,truck,odometer,safety,done',
  'step order unchanged');
const IDX = {}; W.steps.forEach(function (s, i) { IDX[s.key] = i; });

/* ---------- the payroll field: exact name + value ---------- */
const empStep = W.steps[IDX.employment];
eq(empStep.key, 'employment', 'the pay question stores on the employment key');
eq(empStep.title, 'How are you paid?', 'the pay question is the employment step');
eq(empStep.opts.map(function (o) { return o[0]; }).join(','), 'Contract,Payroll',
  "the employment options are exactly 'Contract' and 'Payroll' (the stored payroll value is 'Payroll')");

/* ---------- pre-fix reproduction (the legacy office-only law) ---------- */
function legacyVisible(idx, o) { // the law as it stood: userRole only
  var st = W.steps[idx];
  if (!st) return false;
  if (o && o.userRole === 'office' && ['base', 'truck', 'odometer', 'safety', 'driverKind'].indexOf(st.key) >= 0) return false;
  return true;
}
function legacyCount(o) { var n = 0; W.steps.forEach(function (s, i) { if (legacyVisible(i, o)) n++; }); return n; }
function legacyPos(idx, o) { var n = 0; for (var j = 0; j <= idx; j++) { if (legacyVisible(j, o)) n++; } return n; }
const NIRO = { accountType: 'Driver', userRole: 'driver', driverKind: 'school-bus', workPattern: 'split', employment: 'Payroll' };
ok(legacyVisible(IDX.company, NIRO), 'PRE-FIX: the legacy law shows Company details to a payroll driver');
eq(legacyPos(IDX.company, NIRO), 8, 'PRE-FIX: company is her step 8');
eq(legacyCount(NIRO), 12, 'PRE-FIX: her counter reads "of 12" — the photographed screen, reproduced');

/* ---------- Niro's walk: payroll, school bus ---------- */
function walkKeys(o) {
  var keys = [], i = 0;
  while (i >= 0 && !W.vis(i, o)) i = W.next(i, o); // the renderer's snap off a hidden step
  while (i >= 0) { keys.push(W.steps[i].key); i = W.next(i, o); }
  return keys;
}
const niroWalk = walkKeys(NIRO);
eq(niroWalk.join(','), 'name,accountType,userRole,driverKind,employment,pay,base,truck,odometer,safety,done',
  'payroll walk: every one of her steps, company nowhere in it');
ok(niroWalk.indexOf('company') < 0, 'payroll walk never lands on Company details');
ok(niroWalk.indexOf('driverKind') >= 0, 'payroll walk keeps the driver-kind step (her school-bus kind, v355)');
eq(W.count(NIRO), 11, 'payroll counter is honest: 11 steps, not 12');
eq(W.pos(IDX.truck, NIRO), 8, 'her truck step renders as "Step 8 of 11" — the counter renumbers over the skip');
eq(W.next(IDX.base, NIRO), IDX.truck, 'Next from Base steps OVER company to Truck');
eq(W.prev(IDX.truck, NIRO), IDX.base, 'Back from Truck steps back over company to Base');
eq(W.vis(IDX.company, NIRO), false, 'a session restored onto the company step snaps off it (renderer law)');
ok(niroWalk.indexOf('pay') >= 0 && niroWalk.indexOf('base') >= 0, 'pay standard + base still asked — a payroll driver is still paid and still parks somewhere');

/* ---------- owner walks: unchanged ---------- */
const OWNER = { accountType: 'Owner-Operator', userRole: 'both', employment: 'Contract' };
eq(walkKeys(OWNER).join(','), 'name,accountType,userRole,driverKind,employment,pay,base,company,truck,odometer,safety,done',
  'owner-operator on Contract walks all 12 steps exactly as today');
eq(W.pos(IDX.company, OWNER), 8, 'owner company step still renders as step 8');
eq(W.count(OWNER), 12, 'owner counter still reads 12');
const CONTRACT_DRIVER = { accountType: 'Driver', userRole: 'driver', employment: 'Contract' };
ok(W.vis(IDX.company, CONTRACT_DRIVER), 'a Contract driver still gets the company step (he invoices)');
const UNANSWERED = { accountType: 'Driver', userRole: 'driver' };
ok(W.vis(IDX.company, UNANSWERED), 'employment unanswered: company still shows — the law fires only on the stored Payroll answer');
const PAYROLL_OWNER = { accountType: 'Owner-Operator', userRole: 'both', employment: 'Payroll' };
eq(W.vis(IDX.company, PAYROLL_OWNER), false, 'employment is the whole law: even an Owner-Operator stored as Payroll skips company questions');

/* ---------- composition with the office law ---------- */
const PAYROLL_OFFICE = { accountType: 'Fleet Manager', userRole: 'office', employment: 'Payroll' };
eq(walkKeys(PAYROLL_OFFICE).join(','), 'name,accountType,userRole,employment,pay,done',
  'payroll + office: both skip laws compose (no driver homework, no company)');
const CONTRACT_OFFICE = { accountType: 'Fleet Manager', userRole: 'office', employment: 'Contract' };
ok(W.vis(IDX.company, CONTRACT_OFFICE), 'a Contract office user still gets the company step (the business invoices)');

/* ---------- finish/save safety (source pins) ---------- */
const appSrc = fs.readFileSync(ROOT + '/js/app.js', 'utf8');
function sliceFrom(src, marker, len) { const i = src.indexOf(marker); if (i < 0) throw new Error('marker missing: ' + marker); return src.slice(i, i + len); }
const collect = sliceFrom(appSrc, 'function collectOnbInputs() {', 1600);
ok(collect.indexOf("if (g('ob_cname')) o.companyName") >= 0, 'collect writes company name only when its field is on screen');
ok(collect.indexOf("if (g('ob_gst')) o.gst") >= 0, 'collect writes GST only when its field is on screen');
ok(collect.indexOf("if (g('ob_country')) o.country") >= 0, 'collect writes country only when its field is on screen — a skipped step preserves stored answers');
const fin = sliceFrom(appSrc, 'function finishOnboarding() {', 2600);
ok(fin.indexOf('ob_gst') < 0 && fin.indexOf('companyName') < 0, 'finish has NO company/GST wall — a payroll finish cannot be blocked by skipped owner fields');
ok(fin.indexOf('!isAccountType(o.accountType)') >= 0 && fin.indexOf('!isUserRole(o.userRole)') >= 0,
  "finish's only must-answer gates remain the account-type and role questions");

/* ---------- the fix's own source pins ---------- */
ok(appSrc.indexOf("var ONB_PAYROLL_SKIP = ['company'];") >= 0, 'ONB_PAYROLL_SKIP names the company step');
ok(appSrc.indexOf("o.employment === 'Payroll' && ONB_PAYROLL_SKIP.indexOf(st.key) >= 0") >= 0,
  'onbStepVisible carries the payroll arm on the stored employment fact');

console.log('onboarding-payroll-skip-v379: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
