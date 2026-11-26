#!/usr/bin/env node
// The Lynceus brand files, written as self-contained SVG from one source.
//
//   node scripts/brand.mjs
//
// Writes, under docs/brand/:
//   lynceus/lynceus-mark.svg        the mark, 40px and up
//   lynceus/lynceus-mark-solid.svg  the mark, 32px and below
//   lynceus/favicon.svg             the mark, 16px
//   lynceus-card.svg                the README banner and social card, 1280 by 640
//   lynceus-how-it-works.svg        one refresh, end to end (README figure)
//
// The README art follows the Aviation design system's tool marks (athanor,
// grimoire): an ink square, paper linework, and the deck's amber spent once,
// on the one heatmap cell the loupe has found. The Builder UI keeps its own
// star-atlas design (docs/DESIGN.md); none of this touches it.
//
// IBM Plex Mono is inlined from docs/brand/fonts/ so each file renders the same
// in a README, a browser and a link preview, and fetches nothing. The social
// preview GitHub accepts is a PNG, rendered from lynceus-card.svg at 2x
// (docs/brand/README.md says how).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_DIR = path.join(ROOT_DIR, 'docs', 'brand');

const INK = '#22262B';
const PAPER = '#FAFAF7';
const AMBER = '#B45309';
const alpha = (a) => `rgb(34 38 43 / ${a})`;
const SURFACE = 'rgb(250 250 247 / 0.72)';

const n = (v) => String(+v.toFixed(2));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------------------------------------------------------- marks */

/* A heatmap strip with a loupe over its lower right. The lens clears every
 * cell it touches and holds one amber cell: the bot's day GitHub never draws.
 * Each size redraws the strip with fewer, larger cells rather than scaling. */
const MARKS = {
  'lynceus-mark': {
    inset: 0.8, cols: 6, rows: 4, cell: 2.0, pitch: 2.9, x0: 3.2, y0: 3.6,
    lens: { cx: 14.6, cy: 13.4, r: 4.0, sw: 1.6, clear: 5.3, amber: 2.2 },
    handle: { x1: 17.6, y1: 16.4, x2: 20.4, y2: 19.2, sw: 2.4 },
  },
  'lynceus-mark-solid': {
    inset: 0, cols: 4, rows: 3, cell: 2.8, pitch: 3.8, x0: 3.0, y0: 3.4,
    lens: { cx: 14.8, cy: 14.0, r: 4.3, sw: 2.0, clear: 5.8, amber: 2.8 },
    handle: { x1: 18.1, y1: 17.3, x2: 21.0, y2: 20.2, sw: 2.8 },
  },
  favicon: {
    inset: 0, cols: 3, rows: 2, cell: 3.6, pitch: 4.9, x0: 2.6, y0: 3.0,
    lens: { cx: 14.6, cy: 14.2, r: 4.6, sw: 2.4, clear: 6.3, amber: 3.2 },
    handle: { x1: 18.2, y1: 17.8, x2: 21.2, y2: 20.8, sw: 3.2 },
  },
};

/** Does a cell's nearest point fall within `r` of the lens centre? */
function touches(m, c, r) {
  const x = m.x0 + c * m.pitch;
  const y = m.y0 + r * m.pitch;
  const dx = Math.max(x - m.lens.cx, 0, m.lens.cx - x - m.cell);
  const dy = Math.max(y - m.lens.cy, 0, m.lens.cy - y - m.cell);
  return Math.hypot(dx, dy) < m.lens.clear;
}

/** The mark's drawing in a 24-unit box, without the root element. */
function markBody(m) {
  const side = 24 - 2 * m.inset;
  const out = [`<rect x="${n(m.inset)}" y="${n(m.inset)}" width="${n(side)}" height="${n(side)}" fill="${INK}"/>`];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      if (touches(m, c, r)) continue;
      out.push(`<rect x="${n(m.x0 + c * m.pitch)}" y="${n(m.y0 + r * m.pitch)}" width="${n(m.cell)}" height="${n(m.cell)}" fill="${PAPER}"/>`);
    }
  }
  const { cx, cy, r, sw, amber } = m.lens;
  const h = m.handle;
  out.push(`<path d="M${n(h.x1)} ${n(h.y1)}L${n(h.x2)} ${n(h.y2)}" stroke="${PAPER}" stroke-width="${n(h.sw)}"/>`);
  out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${INK}" stroke="${PAPER}" stroke-width="${n(sw)}"/>`);
  out.push(`<rect x="${n(cx - amber / 2)}" y="${n(cy - amber / 2)}" width="${n(amber)}" height="${n(amber)}" fill="${AMBER}"/>`);
  return out.join('\n  ');
}

const markSvg = (m) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">\n  ${markBody(m)}\n</svg>\n`;

/* ---------------------------------------------------------------- shared */

function fontFaces() {
  const face = (weight, file) => {
    const b64 = readFileSync(path.join(BRAND_DIR, 'fonts', file)).toString('base64');
    return `@font-face{font-family:'IBM Plex Mono';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  };
  return [
    face(400, 'IBMPlexMono-Regular-Latin1.woff2'),
    face(600, 'IBMPlexMono-SemiBold-Latin1.woff2'),
    "text{font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace}",
  ].join('\n');
}

/** The réseau: one 13px cross every 120px at ink 30, anchored on (x, y). */
const reseau = (id, x, y) =>
  `<pattern id="${id}" x="${x}" y="${y}" width="120" height="120" patternUnits="userSpaceOnUse">` +
  `<path d="M54 60.5H67M60.5 54V67" fill="none" stroke="${INK}" stroke-opacity="0.3" stroke-width="1" shape-rendering="crispEdges"/></pattern>`;

/* ---------------------------------------------------------------- card */

/* The athanor card's layout on the zone border, at 1280 by 640: an eyebrow
 * line, the name and tagline on a framed sheet, the mark in zone B5, and a
 * three-cell title block. The footer names zone B5, so B and 5 are boxed. */
function card() {
  const W = 1280, H = 640, RULE = 2, BAND = 36, PAD = 36;
  const F = { x: RULE + BAND, y: RULE + BAND };
  F.w = W - 2 * F.x;
  F.h = H - 2 * F.y;
  const COLS = 5, ROWS = 3, LETTERS = 'ABC';
  const cw = F.w / COLS, rh = F.h / ROWS;
  const IN = { x: F.x + PAD, r: F.x + F.w - PAD };

  const band = [];
  const label = (x, y, t, boxed) => {
    const box = boxed
      ? `<rect x="${n(x - 15)}" y="${n(y - 15)}" width="30" height="30" fill="none" stroke="${INK}" stroke-width="2"/>`
      : '';
    return `${box}<text x="${n(x)}" y="${n(y)}" font-size="18" fill="${boxed ? INK : alpha(0.7)}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  };
  for (let i = 0; i < COLS; i++) {
    const x = F.x + cw * (i + 0.5);
    band.push(label(x, RULE + BAND / 2, i + 1, i === 4), label(x, H - RULE - BAND / 2, i + 1, i === 4));
    if (i) band.push(`<path d="M${n(F.x + cw * i)} ${RULE}V${F.y}M${n(F.x + cw * i)} ${F.y + F.h}V${H - RULE}" stroke="${alpha(0.3)}" stroke-width="1"/>`);
  }
  for (let i = 0; i < ROWS; i++) {
    const y = F.y + rh * (i + 0.5);
    band.push(label(RULE + BAND / 2, y, LETTERS[i], i === 1), label(W - RULE - BAND / 2, y, LETTERS[i], i === 1));
    if (i) band.push(`<path d="M${RULE} ${n(F.y + rh * i)}H${F.x}M${F.x + F.w} ${n(F.y + rh * i)}H${W - RULE}" stroke="${alpha(0.3)}" stroke-width="1"/>`);
  }

  // Zone B5 holds the mark; the title sheet shares its centre line.
  const MARK = 184;
  const midB = F.y + rh * 1.5;
  const markX = F.x + cw * 4.5 - MARK / 2;
  const markY = midB - MARK / 2;
  const sheet = { x: IN.x, y: midB - 101, w: markX - 44 - IN.x, h: 202 };
  const foot = { y: F.y + F.h - PAD - 74, h: 74 };
  const cellW = (IN.r - IN.x) / 3;
  const cells = [
    ['Package', 'lynceus'],
    ['Renders', 'Zero-JS Light/Dark SVG'],
    ['Mark', 'Zone B5'],
  ];
  const footCells = cells.map(([k, v], i) => {
    const x = IN.x + cellW * i;
    const rule = i ? `<path d="M${n(x)} ${foot.y}V${foot.y + foot.h}" stroke="${alpha(0.3)}" stroke-width="1"/>` : '';
    return `${rule}<text x="${n(x + 26)}" y="${foot.y + 27}" font-size="12" letter-spacing="2.4" fill="${alpha(0.7)}">${esc(k.toUpperCase())}</text>` +
      `<text x="${n(x + 26)}" y="${foot.y + 54}" font-size="17" fill="${INK}">${esc(v)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">Lynceus — your bots, seen. GitHub App and [bot] activity graphs for profile READMEs.</title>
<style>
${fontFaces()}
</style>
<defs>${reseau('reseau', F.x, F.y)}</defs>
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" fill="url(#reseau)" stroke="${alpha(0.3)}" stroke-width="1"/>
<rect x="${RULE / 2}" y="${RULE / 2}" width="${W - RULE}" height="${H - RULE}" fill="none" stroke="${INK}" stroke-width="${RULE}"/>
${band.join('\n')}
<rect x="${IN.x - 8}" y="${F.y + 34}" width="${IN.r - IN.x + 16}" height="40" fill="${SURFACE}"/>
<text x="${IN.x}" y="${F.y + 54}" font-size="18" letter-spacing="2.88" fill="${alpha(0.7)}" dominant-baseline="central">BOT ACTIVITY GRAPHS · NODE 24</text>
<text x="${IN.r}" y="${F.y + 54}" font-size="18" letter-spacing="2.88" fill="${alpha(0.7)}" text-anchor="end" dominant-baseline="central">MIT</text>
<rect x="${sheet.x + 1}" y="${sheet.y + 1}" width="${sheet.w - 2}" height="${sheet.h - 2}" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/>
<text x="${sheet.x + 38}" y="${sheet.y + 104}" font-size="68" font-weight="600" letter-spacing="8.16" fill="${INK}">LYNCEUS</text>
<text x="${sheet.x + 38}" y="${sheet.y + 160}" font-size="28" font-weight="600" letter-spacing="3.36" fill="${INK}">YOUR BOTS, SEEN.</text>
<svg x="${n(markX)}" y="${n(markY)}" width="${MARK}" height="${MARK}" viewBox="0 0 24 24">
  ${markBody(MARKS['lynceus-mark'])}
</svg>
<rect x="${IN.x + 1}" y="${foot.y + 1}" width="${IN.r - IN.x - 2}" height="${foot.h - 2}" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/>
${footCells.join('\n')}
</svg>
`;
}

/* ---------------------------------------------------------------- figure */

/* From your repos to your profile: five stations on a line, and the privacy gate
 * between collect and count, drawn as the one bold rule, where names, titles
 * and SHAs stop. Under the line, what each side holds. Ink only: nothing
 * here reports a condition, so nothing takes a mark. */
function howItWorks() {
  const W = 1280, H = 680, RULE = 2, M = 44;
  const IN = { x: M + 28, r: W - M - 28 };
  const STATIONS = [
    ['01', 'Find', ['lynceus init', 'opens a setup', 'page on your', 'computer and', 'lists the bots', 'in your repos']],
    ['02', 'Count', ['Tallies each', "bot's PRs,", 'merges, commits,', 'reviews, comments', 'and issues per', 'day. Public repos', 'by default.']],
    ['03', 'Save', ['counts.json', 'keeps a date', 'and a number', 'for each day,', 'and no repo', 'names.']],
    ['04', 'Draw', ['Draws each', "bot's heatmap", 'in light and', 'dark, with no', 'scripts, and', 'prints the', 'Markdown to paste']],
    ['05', 'Post', ['A scheduled', 'job pushes', 'only the', 'pictures to', 'your profile', 'repo.']],
  ];
  const GAP = 44;
  const boxW = (IN.r - IN.x - GAP * 4) / 5;
  const top = 196, boxH = 292;
  const parts = [];

  STATIONS.forEach(([num, name, lines], i) => {
    const x = IN.x + i * (boxW + GAP);
    parts.push(`<rect x="${n(x + 1)}" y="${top + 1}" width="${n(boxW - 2)}" height="${boxH - 2}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>`);
    parts.push(`<path d="M${n(x)} ${top + 48}H${n(x + boxW)}" stroke="${alpha(0.3)}" stroke-width="1"/>`);
    parts.push(`<text x="${n(x + 18)}" y="${top + 31}" font-size="14" fill="${alpha(0.7)}">${num}</text>`);
    parts.push(`<text x="${n(x + 56)}" y="${top + 31}" font-size="17" font-weight="600" letter-spacing="2.7" fill="${INK}">${esc(name.toUpperCase())}</text>`);
    lines.forEach((line, j) => {
      parts.push(`<text x="${n(x + 18)}" y="${top + 82 + j * 30}" font-size="16" fill="${alpha(0.8)}">${esc(line)}</text>`);
    });
    if (i < 4) {
      const ax = x + boxW + 8, bx = x + boxW + GAP - 8, ay = top + boxH / 2;
      {
        parts.push(`<path d="M${n(ax)} ${ay}H${n(bx)}" stroke="${INK}" stroke-width="1.5"/><path d="M${n(bx - 7)} ${ay - 5}L${n(bx)} ${ay}L${n(bx - 7)} ${ay + 5}" fill="none" stroke="${INK}" stroke-width="1.5"/>`);
      }
    }
  });

  // The privacy gate, centred in the gap between 02 and 03.
  const gx = IN.x + 2 * boxW + 1.5 * GAP;
  const ay = top + boxH / 2;
  parts.push(`<path d="M${n(gx)} ${top - 22}V${top + boxH + 34}" stroke="${INK}" stroke-width="3"/>`);
  parts.push(`<text x="${n(gx)}" y="${top - 58}" font-size="15" font-weight="600" letter-spacing="2.4" fill="${INK}" text-anchor="middle">PRIVACY GATE</text>`);
  parts.push(`<text x="${n(gx)}" y="${top - 34}" font-size="14" fill="${alpha(0.8)}" text-anchor="middle">only numbers pass</text>`);

  // What each side holds.
  const ly = top + boxH + 72;
  const left = { x: IN.x, r: gx - 20 };
  const right = { x: gx + 20, r: IN.r };
  const lane = (s, label, text) =>
    `<path d="M${n(s.x)} ${ly - 26}H${n(s.r)}" stroke="${alpha(0.55)}" stroke-width="1"/>` +
    `<path d="M${n(s.x)} ${ly - 32}V${ly - 20}M${n(s.r)} ${ly - 32}V${ly - 20}" stroke="${alpha(0.55)}" stroke-width="1"/>` +
    `<text x="${n(s.x)}" y="${ly + 4}" font-size="13" letter-spacing="2.1" fill="${alpha(0.7)}">${esc(label)}</text>` +
    `<text x="${n(s.x)}" y="${ly + 32}" font-size="16" fill="${INK}">${esc(text)}</text>`;
  parts.push(lane(left, 'USED, THEN FORGOTTEN', 'Repo names, titles, commit IDs, links'));
  parts.push(lane(right, 'SAVED AND SHARED', 'Dates and counts on your disk; only the pictures go online'));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">How Lynceus works: find your bots, count what they did each day, then a privacy gate that only numbers pass, then save, draw and post. Repo names, titles, commit IDs and links are used and forgotten; only dates and counts are saved, and only the pictures go online.</title>
<style>
${fontFaces()}
</style>
<defs>${reseau('reseau', M, M)}</defs>
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" fill="url(#reseau)" stroke="${alpha(0.22)}" stroke-width="1"/>
<rect x="${RULE / 2}" y="${RULE / 2}" width="${W - RULE}" height="${H - RULE}" fill="none" stroke="${INK}" stroke-width="${RULE}"/>
<rect x="${IN.x - 8}" y="${M + 18}" width="${IN.r - IN.x + 16}" height="34" fill="${SURFACE}"/>
<text x="${IN.x}" y="${M + 41}" font-size="16" letter-spacing="2.56" fill="${INK}">FIG. 01 · FROM YOUR REPOS TO YOUR PROFILE</text>
<text x="${IN.r}" y="${M + 41}" font-size="16" letter-spacing="2.56" fill="${alpha(0.7)}" text-anchor="end">LYNCEUS</text>
<rect x="${IN.x - 8}" y="${top + boxH + 30}" width="${IN.r - IN.x + 16}" height="84" fill="${SURFACE}"/>
<rect x="${n(gx - 84)}" y="${top - 80}" width="168" height="54" fill="${SURFACE}"/>
${parts.join('\n')}
</svg>
`;
}

/* ---------------------------------------------------------------- write */

/** Every brand file, keyed by its path under docs/brand/. */
export function buildBrand() {
  return {
    'lynceus/lynceus-mark.svg': markSvg(MARKS['lynceus-mark']),
    'lynceus/lynceus-mark-solid.svg': markSvg(MARKS['lynceus-mark-solid']),
    'lynceus/favicon.svg': markSvg(MARKS.favicon),
    'lynceus-card.svg': card(),
    'lynceus-how-it-works.svg': howItWorks(),
  };
}

export { BRAND_DIR };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [rel, svg] of Object.entries(buildBrand())) {
    writeFileSync(path.join(BRAND_DIR, rel), svg);
    console.log(`wrote docs/brand/${rel}`);
  }
}
