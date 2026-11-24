// Zero-JS GitHub Light/Dark heatmap SVG generator (SPEC S5).
// Pure browser + Node ESM: no node:* imports. System font stacks only; no external URLs.

import { getRamp, getTheme, NEUTRAL_LEGEND_RAMP } from './palettes.mjs';
import {
  agentFileStem,
  assertCamoSafeSvg,
  escapeXml,
  stripControlChars,
  svgFilename,
  validateBranch,
  validateMarkdownBase,
  validateOwner,
  validateScopeType,
  validateSubpath
} from './sanitize.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const SANS_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const deepFreezeGeometry = (g) => Object.freeze({ ...g, dotRadii: Object.freeze([...g.dotRadii]) });

/** Exact S5 geometry keyed by window weeks. */
export const GEOMETRY = Object.freeze({
  52: deepFreezeGeometry({
    width: 820,
    gridX: 52,
    cellSize: 11,
    cellGap: 3,
    step: 14,
    rx: 2,
    dotRadii: [1.3, 2.5, 3.5, 4.5, 5.4]
  }),
  26: deepFreezeGeometry({
    width: 580,
    gridX: 52,
    cellSize: 15,
    cellGap: 4,
    step: 19,
    rx: 3,
    dotRadii: [1.6, 3.2, 4.6, 6.0, 7.2]
  })
});

export const LEGEND_DOT_RADII = Object.freeze([1.4, 2.4, 3.4, 4.3, 5.1]);
const LEGEND_SQUARE = 10;
const LEGEND_GAP = 3;
const EMPTY_HEIGHT = 140;
const CARD_PAD = 16;
const CARD_TOP = 8;
const FOOTER_HEIGHT = 30;

const LAYOUTS = ['unified', 'separate'];
const DETAILS = ['breakdown', 'minimal'];
const MARK_STYLES = ['squares', 'magnitude'];
const LABEL_MODES = ['friendly', 'raw'];
const THEMES = ['light', 'dark'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const METRICS = [
  ['prsOpened', 'PR opened', 'PRs opened'],
  ['prsMerged', 'PR merged', 'PRs merged'],
  ['commits', 'commit', 'commits'],
  ['reviews', 'review', 'reviews'],
  ['comments', 'comment', 'comments'],
  ['issues', 'issue', 'issues']
];

/**
 * Map a daily count onto a 0-4 intensity level relative to the agent's busiest day.
 * @param {number} count
 * @param {number} maxCount
 * @returns {0|1|2|3|4}
 */
export function quantizeLevel(count, maxCount) {
  if (!(count > 0)) return 0;
  if (!(maxCount > 1)) return 2;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.52) return 2;
  if (ratio <= 0.78) return 3;
  return 4;
}

const esc = (v) => escapeXml(stripControlChars(v));

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new TypeError(`Invalid ${name}: expected ${allowed.join(' | ')}`);
  }
  return value;
}

function formatInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function safeInt(n) {
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function parseUtcDate(str, what) {
  const m = typeof str === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(str) : null;
  if (!m) throw new TypeError(`Invalid window.${what}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== str) throw new TypeError(`Invalid window.${what}`);
  return ms;
}

const DAY_MS = 86_400_000;

/** Pre-compute per-agent view model (shared by the light and dark renders). */
function buildAgentModel(agent, window, labelMode) {
  if (agent === null || typeof agent !== 'object') throw new TypeError('Invalid agent entry');
  const stem = agentFileStem(agent.slug);
  const rampName = typeof agent.ramp === 'string' ? agent.ramp : 'emerald';
  const ramp = getRamp(rampName);
  const days = agent.days !== null && typeof agent.days === 'object' ? agent.days : {};

  const startMs = parseUtcDate(window.startDate, 'startDate');
  const endMs = parseUtcDate(window.endDate, 'endDate');
  if (endMs < startMs) throw new RangeError('window.endDate precedes window.startDate');
  const dayCount = (endMs - startMs) / DAY_MS + 1;
  const startDow = new Date(startMs).getUTCDay();
  const columns = Math.floor((dayCount - 1 + startDow) / 7) + 1;
  if (columns > window.weeks) throw new RangeError('window spans more weeks than window.weeks');

  const values = new Array(dayCount);
  let max = 0;
  for (let i = 0; i < dayCount; i++) {
    const key = new Date(startMs + i * DAY_MS).toISOString().slice(0, 10);
    const v = Object.hasOwn(days, key) ? safeInt(days[key]) : 0;
    values[i] = v;
    if (v > max) max = v;
  }
  const cols = new Uint16Array(dayCount);
  const rows = new Uint8Array(dayCount);
  const levels = new Uint8Array(dayCount);
  for (let i = 0; i < dayCount; i++) {
    cols[i] = Math.floor((i + startDow) / 7);
    rows[i] = (i + startDow) % 7;
    levels[i] = quantizeLevel(values[i], max);
  }

  // Month labels: first column whose first day starts a new month.
  const candidates = [];
  let prevMonth = -1;
  for (let c = 0; c < columns; c++) {
    const firstIdx = Math.max(0, c * 7 - startDow);
    const month = new Date(startMs + firstIdx * DAY_MS).getUTCMonth();
    if (month !== prevMonth) candidates.push({ col: c, text: MONTHS[month] });
    prevMonth = month;
  }
  if (candidates.length > 1 && candidates[1].col - candidates[0].col < 3) candidates.shift();

  const totals = agent.totals !== null && typeof agent.totals === 'object' ? agent.totals : {};
  const streaks = agent.streaks !== null && typeof agent.streaks === 'object' ? agent.streaks : {};
  const slug = stripControlChars(agent.slug);
  const label = stripControlChars(typeof agent.label === 'string' ? agent.label : '').trim() || slug;

  const metrics = [];
  for (const [key, one, many] of METRICS) {
    const n = Object.hasOwn(totals, key) ? safeInt(totals[key]) : 0;
    if (n > 0) metrics.push(`${formatInt(n)} ${n === 1 ? one : many}`);
  }
  return {
    stem,
    slug,
    label,
    primary: labelMode === 'raw' ? slug : label,
    secondary: labelMode === 'raw' ? '' : slug,
    ramp,
    cols,
    rows,
    levels,
    columns,
    months: candidates,
    total: Object.hasOwn(totals, 'total') ? safeInt(totals.total) : values.reduce((a, b) => a + b, 0),
    current: Object.hasOwn(streaks, 'current') ? safeInt(streaks.current) : 0,
    best: Object.hasOwn(streaks, 'best') ? safeInt(streaks.best) : 0,
    metrics,
    startDate: window.startDate,
    endDate: window.endDate
  };
}

function truncate(text, max) {
  const cps = [...text];
  return cps.length <= max ? text : `${cps.slice(0, Math.max(1, max - 1)).join('')}\u2026`;
}

function fitHeader(primary, secondary, avail, primaryMono) {
  const pw = primaryMono ? 7.2 : 7.4;
  let pn = [...primary].length;
  let sn = [...secondary].length;
  const width = () => pn * pw + (sn ? 8 + sn * 6.6 : 0);
  while (width() > avail && sn > 10) sn--;
  while (width() > avail && pn > 6) pn--;
  return [truncate(primary, pn), secondary ? truncate(secondary, sn) : ''];
}

function gridMarkup(model, geo, gridY, rampColors, markStyle) {
  const buckets = [[], [], [], [], []];
  const { cellSize, step, gridX, rx, dotRadii } = geo;
  const half = cellSize / 2;
  for (let i = 0; i < model.levels.length; i++) {
    const x = gridX + model.cols[i] * step;
    const y = gridY + model.rows[i] * step;
    const level = model.levels[i];
    buckets[level].push(
      markStyle === 'magnitude'
        ? `<circle cx="${x + half}" cy="${y + half}" r="${dotRadii[level]}"/>`
        : `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${rx}"/>`
    );
  }
  let out = '';
  for (let level = 0; level < 5; level++) {
    if (buckets[level].length) out += `<g fill="${rampColors[level]}">${buckets[level].join('')}</g>\n`;
  }
  return out;
}

function gridHeight(geo) {
  return 6 * geo.step + geo.cellSize;
}

function headerHeight(detail) {
  return detail === 'breakdown' ? 72 : 50;
}

function bandHeight(geo, detail) {
  return headerHeight(detail) + gridHeight(geo) + 14;
}

function renderBand(model, geo, y0, theme, opts) {
  const { detail, markStyle } = opts;
  const rampColors = model.ramp[theme.name];
  const t = theme.colors;
  const gridY = y0 + headerHeight(detail);
  const W = geo.width;

  const badgeText =
    detail === 'breakdown'
      ? `${formatInt(model.total)} total \u00b7 ${model.current}d streak \u00b7 best ${model.best}d`
      : `${formatInt(model.total)} total`;
  const badgeW = Math.round(badgeText.length * 6.6 + 16);
  const badgeX = W - CARD_PAD - badgeW;
  const avail = W - CARD_PAD * 2 - badgeW - 12;
  const raw = opts.labelMode === 'raw';
  const [primary, secondary] = fitHeader(model.primary, model.secondary, avail, raw);

  let out = '';
  out += raw
    ? `<text x="${CARD_PAD}" y="${y0 + 22}" font-family="${MONO_FONT}" font-size="13" font-weight="600" fill="${t.ink}">${esc(primary)}</text>\n`
    : `<text x="${CARD_PAD}" y="${y0 + 22}" font-size="13" font-weight="600" fill="${t.ink}">${esc(primary)}<tspan dx="8" font-family="${MONO_FONT}" font-size="11" font-weight="400" fill="${t.muted}">${esc(secondary)}</tspan></text>\n`;
  out += `<rect x="${badgeX}" y="${y0 + 7}" width="${badgeW}" height="22" rx="3" fill="${t.badgeBg}" stroke="${t.border}"/>\n`;
  out += `<text x="${badgeX + badgeW / 2}" y="${y0 + 22}" text-anchor="middle" font-family="${MONO_FONT}" font-size="11" fill="${t.badgeText}">${esc(badgeText)}</text>\n`;

  if (detail === 'breakdown') {
    const line = model.metrics.length ? model.metrics.join(' \u00b7 ') : 'No activity in this window';
    out += `<text x="${CARD_PAD}" y="${y0 + 46}" font-size="11" fill="${t.muted}">${esc(line)}</text>\n`;
  }

  for (const m of model.months) {
    out += `<text x="${geo.gridX + m.col * geo.step}" y="${gridY - 6}" font-size="10" fill="${t.muted}">${m.text}</text>\n`;
  }
  for (const [row, name] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']]) {
    out += `<text x="${geo.gridX - 6}" y="${gridY + row * geo.step + geo.cellSize / 2 + 3}" text-anchor="end" font-size="9" fill="${t.muted}">${name}</text>\n`;
  }
  out += gridMarkup(model, geo, gridY, rampColors, markStyle);
  return out;
}

function legendMarkup(geo, y, theme, rampColors, markStyle) {
  const t = theme.colors;
  const right = geo.width - CARD_PAD;
  const squaresW = 5 * LEGEND_SQUARE + 4 * LEGEND_GAP;
  const moreX = right - 26;
  const sqStart = moreX - 8 - squaresW;
  let out = `<text x="${sqStart - 6}" y="${y + 9}" text-anchor="end" font-size="10" fill="${t.muted}">Less</text>\n`;
  for (let level = 0; level < 5; level++) {
    const x = sqStart + level * (LEGEND_SQUARE + LEGEND_GAP);
    out +=
      markStyle === 'magnitude'
        ? `<circle cx="${x + LEGEND_SQUARE / 2}" cy="${y + LEGEND_SQUARE / 2}" r="${LEGEND_DOT_RADII[level]}" fill="${rampColors[level]}"/>\n`
        : `<rect x="${x}" y="${y}" width="${LEGEND_SQUARE}" height="${LEGEND_SQUARE}" rx="2" fill="${rampColors[level]}"/>\n`;
  }
  out += `<text x="${moreX}" y="${y + 9}" font-size="10" fill="${t.muted}">More</text>\n`;
  return out;
}

function svgOpen(width, height, ariaLabel, theme) {
  const t = theme.colors;
  return (
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-label="${esc(ariaLabel)}" font-family="${SANS_FONT}">\n` +
    `<title>${esc(ariaLabel)}</title>\n` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>\n`
  );
}

function renderCard(models, weeks, theme, opts, ariaLabel) {
  const geo = GEOMETRY[weeks];
  const { detail, markStyle } = opts;
  const bh = bandHeight(geo, detail);
  const height = CARD_TOP + models.length * bh + FOOTER_HEIGHT;
  const t = theme.colors;

  let out = svgOpen(geo.width, height, ariaLabel, theme);
  models.forEach((model, i) => {
    const y0 = CARD_TOP + i * bh;
    out += renderBand(model, geo, y0, theme, opts);
    if (i < models.length - 1) {
      const ly = y0 + bh - 6;
      out += `<line x1="${CARD_PAD}" y1="${ly}" x2="${geo.width - CARD_PAD}" y2="${ly}" stroke="${t.divider}"/>\n`;
    }
  });
  const footerY = CARD_TOP + models.length * bh;
  const legendRamp = models.length === 1 ? models[0].ramp[theme.name] : NEUTRAL_LEGEND_RAMP[theme.name];
  out += `<text x="${CARD_PAD}" y="${footerY + 9}" font-family="${MONO_FONT}" font-size="10" fill="${t.muted}">${models[0].startDate} to ${models[0].endDate}</text>\n`;
  out += legendMarkup(geo, footerY, theme, legendRamp, markStyle);
  return `${out}</svg>\n`;
}

function renderEmpty(weeks, theme) {
  const geo = GEOMETRY[weeks];
  const t = theme.colors;
  const label = `No agents selected - ${weeks} week activity preview`;
  let out = svgOpen(geo.width, EMPTY_HEIGHT, label, theme);
  out += `<text x="${geo.width / 2}" y="68" text-anchor="middle" font-size="14" font-weight="600" fill="${t.ink}">No agents selected</text>\n`;
  out += `<text x="${geo.width / 2}" y="90" text-anchor="middle" font-size="11" fill="${t.muted}">Add a GitHub App or bot account to preview its activity.</text>\n`;
  return `${out}</svg>\n`;
}

/**
 * Render deterministic zero-JS Light/Dark SVGs from a `counts.json` v1 document.
 * @param {object} counts strict counts.json v1 (or a synthetic 0-agent preview with `allowEmpty`)
 * @param {object} [options]
 * @returns {Array<{filename: string, theme: 'light'|'dark', svg: string}>}
 */
export function renderSvgs(counts, options = {}) {
  const {
    owner,
    scopeType,
    layout = 'unified',
    detail = 'breakdown',
    markStyle = 'squares',
    labelMode = 'friendly',
    branch = 'generated',
    subpath = 'agent-activity',
    markdownBase = 'raw',
    allowEmpty = false
  } = options ?? {};

  oneOf(layout, LAYOUTS, 'layout');
  oneOf(detail, DETAILS, 'detail');
  oneOf(markStyle, MARK_STYLES, 'markStyle');
  oneOf(labelMode, LABEL_MODES, 'labelMode');
  if (typeof allowEmpty !== 'boolean') throw new TypeError('Invalid allowEmpty');
  if (owner !== undefined) validateOwner(owner);
  if (scopeType !== undefined) validateScopeType(scopeType);
  validateBranch(branch);
  validateSubpath(subpath);
  validateMarkdownBase(markdownBase);

  if (counts === null || typeof counts !== 'object') throw new TypeError('counts must be an object');
  const window = counts.window;
  if (window === null || typeof window !== 'object' || !Object.hasOwn(GEOMETRY, window.weeks)) {
    throw new TypeError('counts.window.weeks must be 26 or 52');
  }
  const weeks = window.weeks;
  const agents = counts.agents;
  if (!Array.isArray(agents)) throw new TypeError('counts.agents must be an array');
  if (agents.length === 0 && !allowEmpty) {
    throw new RangeError('counts.agents is empty (pass allowEmpty: true for a preview)');
  }

  const opts = { detail, markStyle, labelMode };
  const themes = THEMES.map((name) => ({ name, colors: getTheme(name) }));
  const out = [];

  if (agents.length === 0) {
    for (const theme of themes) {
      out.push({
        filename: svgFilename('unified', weeks, theme.name),
        theme: theme.name,
        svg: assertCamoSafeSvg(renderEmpty(weeks, theme))
      });
    }
    return out;
  }

  const models = agents.map((a) => buildAgentModel(a, window, labelMode));
  if (layout === 'unified') {
    const ariaLabel = `Agent activity for ${models.map((m) => m.primary).join(', ')} over the last ${weeks} weeks`;
    for (const theme of themes) {
      out.push({
        filename: svgFilename('unified', weeks, theme.name),
        theme: theme.name,
        svg: assertCamoSafeSvg(renderCard(models, weeks, theme, opts, ariaLabel))
      });
    }
    return out;
  }

  for (const model of models) {
    const ariaLabel = `${model.primary} activity over the last ${weeks} weeks`;
    for (const theme of themes) {
      out.push({
        filename: svgFilename(model.stem, weeks, theme.name),
        theme: theme.name,
        svg: assertCamoSafeSvg(renderCard([model], weeks, theme, opts, ariaLabel))
      });
    }
  }
  return out;
}
