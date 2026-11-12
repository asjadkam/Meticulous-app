#!/usr/bin/env node
/* Meticulous — NAV-TRUCK-CORE v435 suite (owner's ruling,
 * Nov 12, 2026, ~12:06 CST: "not everybody has access to
 * repair this application. How can anyone trust this GPS if
 * this is not navigating on truck route — that's the most
 * important part."). The audit behind this suite (record:
 * hidden_files/nav-truck-core-nov12.md) established that the
 * routing CORE already enforces truck legality from data by
 * default — full loaded-truck costing on every request, and
 * a server graph with Calgary's truck network baked in
 * (designated / hgv=no / hazmat / maxaxles translations of
 * the City layer + OSM dimension tags). The one street the
 * data itself gets wrong is 48 Avenue NE: the City layer
 * calls it Unrestricted, its 50% load ban lives only on the
 * posted sign and a PDF map, so the driver-reported table is
 * its only guard — and the v433 table's geometry was
 * defective (west end of the main run missing; a second
 * line guarding Aviation Boulevard NE, a different street).
 * v435 rebuilds that geometry from the street's own OSM
 * shape in the routing build extract.
 *
 * This suite loads the REAL NAVPURE region and proves:
 *  (1) THE REQUEST IS THE FULL LOADED TRUCK (audit pin):
 *      buildRouteRequest's default profile sends weight
 *      24.3 t, height 3.9, width 2.6, length 9.0, axle_load
 *      10, axle_count 3, hazmat false, use_truck_route 1.0
 *      and hgv_no_access_penalty 100000 — the costing the
 *      server's baked-in legality data is enforced through.
 *  (2) TABLE SHAPE: the main line now spans the whole
 *      street — Barlow Trail end (lon <= -114.0015) to the
 *      bend top (lat >= 51.108); NO table point sits on the
 *      Aviation Boulevard stretch the v433 line guarded
 *      (lon -114.034..-114.028 at 48 Ave latitude); the
 *      street's three west fragments are present as their
 *      own lines (no invented connector across the airport).
 *  (3) THE REAL ENGINE LINE DOWN 48 AVE (recorded live from
 *      the production server, Nov 12, 2026 — the server
 *      routes a loaded truck straight down the street
 *      because its data calls the street designated):
 *      the NEW table flags it end to end (reported >= 1500 m
 *      of the 1.55 km line), strictly more than the v434
 *      table fixture embedded below.
 *  (4) THE WEST-END HOLE IS CLOSED: the first 200 m of that
 *      same real line (the stretch west of -113.9985) does
 *      NOT flag under the v434 table (100 m < the 150 m bar)
 *      and DOES flag under the new table.
 *  (5) AVIATION BOULEVARD: on the real engine line along
 *      the airport roads, the new table's reported metres
 *      drop vs the v434 table (the wrong-street line is
 *      gone). It does not reach zero: the street's genuine
 *      190 m west fragment runs within the screen's 30 m
 *      tolerance of Aviation Blvd for ~150 m — a measured
 *      resolution limit, recorded, not hidden.
 *  (6) THE AECON PAIR LINE (the owner's daily job->dump
 *      run, recorded live): the line's southbound leg rides
 *      the named street's north leg (OSM + Nominatim both
 *      name that pavement 48 Avenue NE — the street bends
 *      90 degrees into the 36 Street corridor), so it flags
 *      'reported' under BOTH tables. Routing itself is
 *      never refused by the screen — 433's design (re-ask
 *      once, else warn) is untouched by this suite's change.
 * Run: node tools/nav-truck-core-v435-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
function loadRegion(file, beginMark, endMark) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a < 0 || b < 0 || b <= a) throw new Error('region not found in ' + file);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b + 2), ctx);
  return ctx;
}
const NAV = loadRegion(path.join(ROOT, 'modules/navigator.js'), 'NAVPURE-BEGIN', 'NAVPURE-END');
const REP = NAV.REPORTED_RESTRICTIONS;

/* The v433/v434 table, embedded verbatim as the A/B fixture. */
const OLD_REP = [{ name: '48 Avenue NE', note: '50% weight limit', reportedAt: '2026-11-12', lines: [[[51.09598, -113.99853], [51.09599, -113.99676], [51.09599, -113.99561], [51.09599, -113.99498], [51.09605, -113.99405], [51.09604, -113.99327], [51.09602, -113.98995], [51.09603, -113.98969], [51.09605, -113.98952], [51.09608, -113.98931], [51.09613, -113.98903], [51.09619, -113.98882], [51.09633, -113.98847], [51.0965, -113.98816], [51.09665, -113.98798], [51.09683, -113.98781], [51.09718, -113.98758], [51.09759, -113.9874], [51.09804, -113.98718], [51.0984, -113.98704], [51.09886, -113.98684], [51.09947, -113.98656], [51.09966, -113.98646], [51.09985, -113.98631], [51.09999, -113.98619], [51.10019, -113.98596], [51.10044, -113.98552], [51.10064, -113.98503], [51.1008, -113.98456], [51.10101, -113.98399], [51.1012, -113.98356], [51.10139, -113.98326], [51.10161, -113.983], [51.10177, -113.98285], [51.10199, -113.98274], [51.10225, -113.98264], [51.10256, -113.98259], [51.10319, -113.98255], [51.10365, -113.98251], [51.10518, -113.98238], [51.10575, -113.98234]], [[51.0962, -114.0368], [51.09617, -114.03333], [51.09617, -114.0319], [51.0961, -114.02941]]] }];

/* Real lines recorded from the production routing server on
   Nov 12, 2026 with the app's own request shape (truck,
   24.3 t): down 48 Avenue NE; along the airport roads
   (McKnight / Aviation); and the Aecon job->dump pair. */
const LINE_48 = [[51.09597, -114.0005], [51.09597, -114.00029], [51.09597, -113.99997], [51.09598, -113.99925], [51.09598, -113.99873], [51.09598, -113.99853], [51.09598, -113.99838], [51.09599, -113.99676], [51.09599, -113.99561], [51.09599, -113.99498], [51.09605, -113.99405], [51.09604, -113.99327], [51.09602, -113.98995], [51.09603, -113.98969], [51.09605, -113.98952], [51.09608, -113.98931], [51.09613, -113.98903], [51.09619, -113.98882], [51.09633, -113.98847], [51.0965, -113.98816], [51.09665, -113.98798], [51.09683, -113.98781], [51.09718, -113.98758], [51.09759, -113.9874], [51.09804, -113.98718], [51.0984, -113.98704], [51.09886, -113.98684], [51.09947, -113.98656], [51.09966, -113.98646], [51.09985, -113.98631], [51.09999, -113.98619], [51.10019, -113.98596], [51.10044, -113.98552], [51.10064, -113.98503], [51.1008, -113.98456], [51.10101, -113.98399], [51.1012, -113.98356], [51.10137, -113.98329]];
const LINE_AVIATION = [[51.0955, -114.04001], [51.0957, -114.04011], [51.09595, -114.04024], [51.09625, -114.0404], [51.09651, -114.04049], [51.09663, -114.04052], [51.09673, -114.04051], [51.09684, -114.04049], [51.09693, -114.04045], [51.097, -114.0404], [51.09707, -114.04031], [51.09713, -114.04021], [51.09719, -114.04009], [51.09723, -114.03996], [51.09726, -114.03985], [51.09727, -114.03971], [51.09726, -114.03957], [51.09725, -114.03945], [51.09721, -114.03933], [51.09717, -114.03921], [51.0971, -114.03908], [51.097, -114.03898], [51.09692, -114.03893], [51.09683, -114.03889], [51.09674, -114.03889], [51.09663, -114.03891], [51.09654, -114.03896], [51.09644, -114.03904], [51.09636, -114.03915], [51.09631, -114.03927], [51.09627, -114.0394], [51.09623, -114.03957], [51.0962, -114.03978], [51.09617, -114.0401], [51.09616, -114.04046], [51.09616, -114.04163], [51.09616, -114.04193], [51.09621, -114.04241], [51.09624, -114.04267], [51.09628, -114.04284], [51.09633, -114.04297], [51.09639, -114.04309], [51.09645, -114.04318], [51.09652, -114.04324], [51.09657, -114.04327], [51.09663, -114.0433], [51.09671, -114.0433], [51.09679, -114.04328], [51.09687, -114.04325], [51.09695, -114.04319], [51.097, -114.04311], [51.09705, -114.04303], [51.09709, -114.04293], [51.09712, -114.04284], [51.09714, -114.04275], [51.09715, -114.04264], [51.09714, -114.04253], [51.09713, -114.04244], [51.09711, -114.04232], [51.09707, -114.0422], [51.09701, -114.04209], [51.09692, -114.04197], [51.09681, -114.04185], [51.09662, -114.04162], [51.0961, -114.04128], [51.09595, -114.04117], [51.09577, -114.04113], [51.09561, -114.04112], [51.09551, -114.04112], [51.09543, -114.04112], [51.09535, -114.04116], [51.09527, -114.04121], [51.09523, -114.04127], [51.09519, -114.04135], [51.09515, -114.04143], [51.09512, -114.0415], [51.0951, -114.04161], [51.09508, -114.04173], [51.09508, -114.04181], [51.09509, -114.04194], [51.09512, -114.04206], [51.09515, -114.04215], [51.09519, -114.04223], [51.09524, -114.0423], [51.09529, -114.04237], [51.09534, -114.04241], [51.09543, -114.04244], [51.09552, -114.04246], [51.09558, -114.04246], [51.09564, -114.04244], [51.09569, -114.0424], [51.09576, -114.04234], [51.09582, -114.04225], [51.09587, -114.04215], [51.09592, -114.042], [51.09595, -114.04183], [51.09596, -114.04176], [51.09597, -114.04165], [51.09598, -114.0415], [51.09604, -114.0407], [51.09604, -114.04007], [51.09604, -114.03964], [51.09604, -114.03906], [51.09603, -114.03858], [51.09603, -114.03728], [51.09603, -114.03571], [51.09602, -114.03477], [51.09602, -114.03366], [51.09602, -114.03361], [51.09601, -114.03351], [51.09601, -114.03333], [51.09617, -114.03333], [51.09627, -114.03333], [51.09645, -114.03332], [51.09672, -114.0333], [51.09688, -114.03327], [51.09704, -114.03322], [51.09719, -114.03316], [51.09727, -114.03312], [51.09754, -114.03296], [51.09757, -114.03293], [51.0977, -114.03281], [51.09781, -114.0327], [51.09796, -114.03253], [51.09803, -114.03243], [51.09811, -114.03231], [51.09819, -114.03216], [51.09825, -114.03198], [51.0983, -114.03182], [51.09833, -114.03154], [51.09833, -114.03063], [51.09833, -114.02965], [51.09833, -114.0296], [51.09833, -114.02941], [51.09824, -114.02941], [51.09769, -114.0294], [51.09719, -114.02941], [51.09698, -114.02941], [51.0969, -114.02941], [51.09686, -114.02939], [51.09683, -114.02936], [51.0968, -114.0293], [51.09678, -114.02925], [51.09677, -114.02919], [51.09676, -114.02886], [51.09676, -114.02856], [51.09676, -114.02827], [51.09676, -114.02818], [51.09675, -114.02812], [51.09673, -114.02806], [51.0967, -114.02802], [51.09667, -114.02799], [51.09662, -114.02798], [51.09626, -114.02793], [51.0962, -114.0279], [51.09617, -114.02788], [51.09614, -114.02784], [51.09612, -114.02779], [51.0961, -114.02772], [51.09609, -114.02762], [51.09609, -114.02722], [51.09608, -114.02706], [51.09607, -114.02691], [51.09607, -114.02651], [51.09606, -114.02586], [51.09606, -114.02569], [51.09606, -114.02533], [51.09605, -114.02499], [51.09606, -114.02482], [51.09606, -114.02462], [51.09553, -114.02463], [51.09532, -114.02469], [51.09514, -114.02472], [51.09484, -114.02474], [51.09462, -114.02472], [51.09434, -114.02463], [51.09414, -114.02455], [51.09397, -114.02445], [51.09383, -114.02434], [51.09373, -114.02422], [51.09363, -114.02408], [51.09352, -114.02388], [51.09345, -114.02371], [51.0934, -114.02355], [51.09337, -114.02341], [51.09334, -114.02326], [51.09332, -114.02309], [51.09331, -114.02284], [51.09325, -114.02014], [51.0937, -114.02013], [51.0942, -114.0201], [51.0943, -114.01998], [51.09605, -114.01995]];
const LINE_AECON = [[51.1252, -113.9828], [51.12521, -113.98221], [51.12521, -113.98189], [51.12521, -113.98174], [51.12508, -113.98174], [51.12502, -113.98174], [51.12431, -113.98173], [51.12404, -113.98166], [51.1238, -113.98166], [51.12102, -113.98166], [51.12067, -113.98166], [51.11936, -113.98166], [51.11733, -113.98166], [51.11676, -113.98166], [51.11516, -113.98167], [51.11483, -113.98167], [51.11323, -113.9817], [51.11231, -113.98177], [51.11216, -113.9818], [51.11165, -113.98186], [51.11154, -113.98189], [51.11106, -113.98199], [51.11089, -113.98203], [51.11053, -113.98208], [51.11011, -113.98212], [51.10958, -113.98214], [51.10832, -113.98216], [51.10753, -113.98217], [51.10676, -113.98226], [51.10518, -113.98238], [51.10365, -113.98251], [51.10319, -113.98255], [51.10256, -113.98259], [51.10225, -113.98264], [51.10199, -113.98274], [51.10177, -113.98285], [51.10161, -113.983], [51.10139, -113.98326], [51.1012, -113.98356], [51.10101, -113.98399], [51.1008, -113.98456], [51.10064, -113.98503], [51.10044, -113.98552], [51.10019, -113.98596], [51.09999, -113.98619], [51.09985, -113.98631], [51.09966, -113.98646], [51.09947, -113.98656], [51.09886, -113.98684], [51.0984, -113.98704], [51.09804, -113.98718], [51.09759, -113.9874], [51.09718, -113.98758], [51.09683, -113.98781], [51.09665, -113.98798], [51.0965, -113.98816], [51.09633, -113.98847], [51.09619, -113.98882], [51.09613, -113.98903], [51.09608, -113.98931], [51.09605, -113.98952], [51.09603, -113.98969], [51.09602, -113.98995], [51.09604, -113.99327], [51.09605, -113.99405], [51.0961, -113.99497], [51.09609, -113.9956], [51.0961, -113.9979], [51.09609, -113.99839], [51.09609, -113.99851], [51.09609, -113.99877], [51.09609, -113.99956], [51.0961, -114.00027], [51.0961, -114.00108], [51.0962, -114.00139], [51.09625, -114.00147], [51.09631, -114.00156], [51.09842, -114.00158], [51.09869, -114.00157], [51.09917, -114.00151], [51.09967, -114.00135], [51.09999, -114.00121], [51.10017, -114.00113], [51.10048, -114.00093], [51.10068, -114.00078], [51.10084, -114.00065], [51.10106, -114.0005], [51.10125, -114.00039], [51.10137, -114.00037], [51.10148, -114.00037], [51.1016, -114.00041], [51.10171, -114.00046], [51.1018, -114.00049], [51.10186, -114.0005], [51.10191, -114.0005], [51.10196, -114.00048], [51.10201, -114.00044], [51.10209, -114.00037], [51.10211, -114.00035], [51.10214, -114.00032], [51.10218, -114.00031], [51.10225, -114.00029], [51.10231, -114.00027], [51.1025, -114.00026], [51.10265, -114.00026], [51.10288, -114.00028], [51.10316, -114.00032], [51.10347, -114.0004], [51.10374, -114.00049], [51.10386, -114.00055], [51.1041, -114.00066], [51.10434, -114.00079], [51.10467, -114.00102], [51.10504, -114.00128], [51.10533, -114.00144], [51.10549, -114.00152], [51.10563, -114.00157], [51.10581, -114.00164], [51.10597, -114.00169], [51.1069, -114.0017], [51.11011, -114.00167], [51.11062, -114.00167], [51.11065, -114.00167], [51.11382, -114.00171], [51.11446, -114.00171], [51.11484, -114.00171], [51.11502, -114.00169], [51.11516, -114.00167], [51.11529, -114.00163], [51.11542, -114.00159], [51.11555, -114.00154], [51.11567, -114.00148], [51.11578, -114.00141], [51.116, -114.00126], [51.11668, -114.00075], [51.11689, -114.00062], [51.1171, -114.00051], [51.11728, -114.00046], [51.11749, -114.00042], [51.11773, -114.0004], [51.11796, -114.00041], [51.11853, -114.0004], [51.11882, -114.00041], [51.11898, -114.00043], [51.11917, -114.00046], [51.11931, -114.0005], [51.11939, -114.00054], [51.11957, -114.0006], [51.11974, -114.0007], [51.1198, -114.00074], [51.12053, -114.00123], [51.12078, -114.00139], [51.12089, -114.00145], [51.1211, -114.00156], [51.12125, -114.00162], [51.12139, -114.00167], [51.1215, -114.00169], [51.12169, -114.00171], [51.12246, -114.00171], [51.12263, -114.00172], [51.12264, -114.00322], [51.12264, -114.00326], [51.12264, -114.00343], [51.12264, -114.00426], [51.12264, -114.00433], [51.12264, -114.00554], [51.12264, -114.0056], [51.12264, -114.00594], [51.12264, -114.00621], [51.12263, -114.00641], [51.12262, -114.00662], [51.12259, -114.00683], [51.12255, -114.00709], [51.12237, -114.0082], [51.12232, -114.00851], [51.12229, -114.00882], [51.12229, -114.00886], [51.12228, -114.00891], [51.12228, -114.00915], [51.12228, -114.0092], [51.12228, -114.0123], [51.1225, -114.0123], [51.1225, -114.01222]];

function repOnly(rep, line) {
  return NAV.truckNetScreen(null, rep, line, null, { reportedOnly: true });
}
function firstM(line, m) {
  const out = [line[0]]; let acc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const d = NAV.haversineM(line[i], line[i + 1]);
    if (acc + d >= m) { const f = (m - acc) / d; out.push([line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f]); return out; }
    acc += d; out.push(line[i + 1]);
  }
  return out;
}

console.log('\n(1) the request is the full loaded truck');
{
  const req = NAV.buildRouteRequest([51.09, -114.0], [51.10, -113.98], NAV.navProfile(null), 'truck');
  const t = req.costing_options.truck;
  check('costing is truck', req.costing === 'truck');
  check('weight 24.3 t (loaded, licensed mass)', t.weight === 24.3, t.weight);
  check('height 3.9 / width 2.6 / length 9.0', t.height === 3.9 && t.width === 2.6 && t.length === 9.0, t);
  check('axle_load 10 / axle_count 3 / hazmat false', t.axle_load === 10 && t.axle_count === 3 && t.hazmat === false, t);
  check('designated-network pull use_truck_route 1.0', t.use_truck_route === 1.0, t.use_truck_route);
  check('restricted = heavy finite penalty 100000', t.hgv_no_access_penalty === 100000, t.hgv_no_access_penalty);
}

console.log('\n(2) table shape — the whole street, no wrong street');
{
  check('one reported street: 48 Avenue NE', REP.length === 1 && REP[0].name === '48 Avenue NE');
  const lines = REP[0].lines;
  check('four lines (main run + three west fragments)', lines.length === 4, lines.length);
  const main = lines[0];
  check('main run reaches the Barlow end (lon <= -114.0015)', Math.min.apply(null, main.map(p => p[1])) <= -114.0015, Math.min.apply(null, main.map(p => p[1])));
  check('main run reaches the bend top (lat >= 51.108)', Math.max.apply(null, main.map(p => p[0])) >= 51.108, Math.max.apply(null, main.map(p => p[0])));
  const onAviation = [];
  lines.forEach(L => L.forEach(p => { if (p[1] > -114.034 && p[1] < -114.028 && p[0] > 51.0953 && p[0] < 51.0966) onAviation.push(p); }));
  check('no table point guards the Aviation Boulevard stretch', onAviation.length === 0, onAviation.slice(0, 3));
  const west = lines.slice(1);
  check('west fragments present, west of the airport gap', west.length === 3 && west.every(L => Math.max.apply(null, L.map(p => p[1])) < -114.034), west.map(L => L.length));
}

console.log('\n(3) the real engine line down 48 Ave flags end to end');
{
  const sNew = repOnly(REP, LINE_48), sOld = repOnly(OLD_REP, LINE_48);
  check('new table flags the line as reported', sNew.flagged && sNew.worst && sNew.worst.kind === 'reported' && sNew.worst.name === '48 Avenue NE', sNew.worst);
  check('new table covers >= 1500 m of the 1.55 km street line', sNew.reportedM >= 1500, sNew.reportedM);
  check('new table covers strictly more than the v434 table', sNew.reportedM > sOld.reportedM, { newM: sNew.reportedM, oldM: sOld.reportedM });
}

console.log('\n(4) the west-end hole is closed');
{
  const sub = firstM(LINE_48, 200);
  const sNew = repOnly(REP, sub), sOld = repOnly(OLD_REP, sub);
  check('v434 table does NOT flag the western 200 m (the hole)', sOld.flagged === false && sOld.reportedM < 150, sOld.reportedM);
  check('new table flags the western 200 m', sNew.flagged && sNew.reportedM >= 150, sNew.reportedM);
}

console.log('\n(5) Aviation Boulevard — the wrong-street guard is gone');
{
  const sNew = repOnly(REP, LINE_AVIATION), sOld = repOnly(OLD_REP, LINE_AVIATION);
  check('v434 table reported >= 300 m on the airport line', sOld.reportedM >= 300, sOld.reportedM);
  check('new table reported metres drop (<= 175 m)', sNew.reportedM <= 175, sNew.reportedM);
  check('new table reports strictly less than the v434 table', sNew.reportedM < sOld.reportedM, { newM: sNew.reportedM, oldM: sOld.reportedM });
}

console.log('\n(6) the Aecon pair line rides the street\'s north leg — flagged under both tables');
{
  const sNew = repOnly(REP, LINE_AECON), sOld = repOnly(OLD_REP, LINE_AECON);
  check('new table flags it, worst = 48 Avenue NE (north leg)', sNew.flagged && sNew.worst && sNew.worst.name === '48 Avenue NE', sNew.worst);
  check('v434 table flags it too (no behaviour regression from 435)', sOld.flagged === true, sOld.reportedM);
}

console.log('\n(7) version pins');
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html pins navigator.js?v=435', idx.indexOf('modules/navigator.js?v=435') >= 0);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  check('version.json ships as 435', vj.webVersion === 435, vj.webVersion);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
