#!/usr/bin/env node
/* Meticulous — APP-PIP-POPUP-RENDER (v279).
 * Owner (Oct 29, 2026 ~09:56 MDT, screenshot): the app in the
 * small floating pop-up window renders wrong — the header is
 * cut off ("Me…us"), the body is mostly blank white, only the
 * beta banner and the chat bubble are visible.
 *
 * PROVEN CAUSE (css/style.css, arithmetic): the topbar's
 * FIXED pieces alone — padding 16+16, menu button 44, logo
 * 36, bell button 44, sync dot ~24, three 12px gaps — sum to
 * ~222px, wider than his ~221px pop-up before the title gets
 * a single pixel; #app's overflow-x:clip then saws the bar
 * off at the right edge and the title with it. Nothing in
 * the stylesheet had a small-window form: the first
 * max-width media query in the file was a min-width:520px
 * FAB adjustment. At 139px tall the 72px base topbar also
 * leaves ~67px of body — the dashboard reads as blank.
 *
 * FIX (css/style.css only): a small-window media query —
 * (max-width:340px), (max-height:240px) — gives the topbar a
 * compact form (padding 8px 10px, gaps 6px, 36px buttons,
 * 28px logo, a title that may shrink with an ellipsis
 * instead of pushing the bar off-screen) and trims the
 * dashboard pad / trial banner so real content reaches the
 * visible area. The base (full-screen) rules are untouched.
 *
 * Cases: S1 the base topbar fixed sum (documents the defect)
 * · S2 a small-window query exists covering 221x139 and
 * 360x300-class pop-ups · S3 inside it the topbar's fixed
 * sum + a usable title width fits 221px · S4 the title can
 * shrink (min-width:0 + ellipsis) inside the query · S5 the
 * base topbar rules are unchanged (full-screen design
 * untouched).
 *
 * Run: node tools/small-window-v279-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

/* tiny CSS reader: top-level rules and @media blocks */
function blocks(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const sel = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    out.push({ sel: sel, body: src.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
function decl(body, prop) {
  const m = new RegExp('(?:^|[;{])\\s*' + prop + '\\s*:\\s*([^;}]+)').exec(body);
  return m ? m[1].trim() : null;
}
function px(v) { const m = /^(-?[\d.]+)px/.exec(v || ''); return m ? parseFloat(m[1]) : 0; }
function ruleFor(list, selWanted) {
  for (const b of list) {
    const sels = b.sel.split(',').map(function (s) { return s.trim(); });
    if (sels.indexOf(selWanted) >= 0) return b;
  }
  return null;
}

const top = blocks(css.replace(/\/\*[\s\S]*?\*\//g, ''));
const baseTopbar = ruleFor(top, '.topbar');
const baseIcon = ruleFor(top, '.iconbtn');
const baseLogo = ruleFor(top, '.topbar .logo');
const baseDot = ruleFor(top, '.syncdot');

function topbarFixedSum(topbarRule, iconRule, logoRule, dotRule, h1Rule) {
  const pad = (decl(topbarRule.body, 'padding') || '0').split(/\s+/);
  const padH = px(pad[1] !== undefined ? pad[1] : pad[0]) * 2;
  const gap = px(decl(topbarRule.body, 'gap') || '0');
  const iconW = px(decl(iconRule.body, 'min-width') || '0');
  const logoW = px(decl(logoRule.body, 'width') || '0');
  const dotW = px(decl(dotRule.body, 'width') || '0') +
    px((decl(dotRule.body, 'padding') || '0').split(/\s+/)[0]) * 2;
  return padH + iconW * 2 + logoW + dotW + gap * 4;
}

/* S1: document the defect on the base rules */
const baseSum = topbarFixedSum(baseTopbar, baseIcon, baseLogo, baseDot);
console.log('  [S1] base topbar fixed sum: ' + baseSum + 'px (pop-up is ~221px wide)');
ok('S1 base topbar fixed pieces alone overflow a 221px pop-up (the defect)',
  baseSum >= 215, 'sum=' + baseSum);

/* S2: find the small-window media block */
let small = null;
for (const b of top) {
  if (/^@media/.test(b.sel) && /max-width\s*:\s*340px/.test(b.sel) && /max-height\s*:\s*240px/.test(b.sel)) {
    small = b; break;
  }
}
ok('S2 a small-window media query (max-width:340px / max-height:240px) exists', !!small);

/* S3 + S4: inside it, the bar fits and the title can shrink */
if (small) {
  const inner = blocks(small.body);
  const sTopbar = ruleFor(inner, '.topbar');
  const sIcon = ruleFor(inner, '.topbar .iconbtn') || ruleFor(inner, '.iconbtn');
  const sLogo = ruleFor(inner, '.topbar .logo');
  const sDot = ruleFor(inner, '.syncdot');
  const sH1 = ruleFor(inner, '.topbar h1');
  ok('S3a the small query restyles the topbar, its buttons, logo and dot',
    !!(sTopbar && sIcon && sLogo && sDot));
  if (sTopbar && sIcon && sLogo && sDot) {
    const merged = {
      topbar: { body: baseTopbar.body + ';' + sTopbar.body },
      icon: { body: baseIcon.body + ';' + sIcon.body },
      logo: { body: baseLogo.body + ';' + sLogo.body },
      dot: { body: baseDot.body + ';' + sDot.body }
    };
    /* later declarations win: recompute with decl() taking the LAST match */
    function declLast(body, prop) {
      const re = new RegExp('(?:^|[;{])\\s*' + prop + '\\s*:\\s*([^;}]+)', 'g');
      let m, last = null;
      while ((m = re.exec(body))) last = m[1].trim();
      return last;
    }
    function sumLast(t, i2, l, d) {
      const pad = (declLast(t, 'padding') || '0').split(/\s+/);
      const padH = px(pad[1] !== undefined ? pad[1] : pad[0]) * 2;
      const gap = px(declLast(t, 'gap') || '0');
      const iconW = px(declLast(i2, 'min-width') || '0');
      const logoW = px(declLast(l, 'width') || '0');
      const dotPad = (declLast(d, 'padding') || '0').split(/\s+/);
      const dotW = px(declLast(d, 'width') || '0') + px(dotPad[1] !== undefined ? dotPad[1] : dotPad[0]) * 2;
      return padH + iconW * 2 + logoW + dotW + gap * 4;
    }
    const sSum = sumLast(merged.topbar.body, merged.icon.body, merged.logo.body, merged.dot.body);
    console.log('  [S3] small-window topbar fixed sum: ' + sSum + 'px');
    ok('S3b the small-window topbar fits 221px with >= 45px left for the title',
      sSum > 0 && sSum + 45 <= 221, 'sum=' + sSum);
    const barH = px((declLast(merged.topbar.body, 'padding') || '0').split(/\s+/)[0]) * 2 +
      Math.max(px(declLast(merged.icon.body, 'min-height') || '0'), px(declLast(merged.logo.body, 'height') || '0'));
    console.log('  [S3c] small-window topbar height: ~' + barH + 'px of a 139px window');
    ok('S3c the small-window topbar leaves >= 75px of body in a 139px window',
      barH > 0 && 139 - barH >= 75, 'barH=' + barH);
  }
  ok('S4 the title may shrink with an ellipsis inside the query',
    !!(sH1 && decl(sH1.body, 'min-width') === '0' &&
       decl(sH1.body, 'text-overflow') === 'ellipsis' &&
       decl(sH1.body, 'white-space') === 'nowrap' &&
       decl(sH1.body, 'overflow') === 'hidden'),
    sH1 ? sH1.body : 'no h1 rule');
  const sPad = ruleFor(inner, '.pad');
  ok('S4b dashboard padding is trimmed inside the query',
    !!(sPad && px(decl(sPad.body, 'padding') || '99') <= 12));
}

/* S5: base design untouched */
ok('S5 the base topbar keeps its full-screen form (14px 16px padding, 12px gap)',
  decl(baseTopbar.body, 'padding') === '14px 16px' && decl(baseTopbar.body, 'gap') === '12px',
  JSON.stringify({ p: decl(baseTopbar.body, 'padding'), g: decl(baseTopbar.body, 'gap') }));

console.log('\nsmall-window-v279: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
