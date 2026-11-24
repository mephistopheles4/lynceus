/**
 * Strict output gates (S3/S4, threat boundary B1): secret redaction, discover-result allowlist,
 * and the closed `counts.json` v1 schema. Error messages never echo input values.
 */
import { BOT_SLUG_RE, VALID_RAMPS, addDays, dayNumber, dayOfWeek, isValidIsoDate, validateLabel } from './config.mjs';

export class PrivacyGateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrivacyGateError';
    this.code = 'PRIVACY_GATE';
    this.exitCode = 2;
  }
}

const SECRET_PATTERNS = [/Bearer\s+\S+/gi, /gh[pousr]_[A-Za-z0-9_]+/g, /github_pat_[A-Za-z0-9_]+/g];

export function redactSecrets(text, activeToken) {
  let out = String(text ?? '');
  if (typeof activeToken === 'string' && activeToken.length >= 6) {
    out = out.split(activeToken).join('[REDACTED]');
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

function fail(where, why) {
  throw new PrivacyGateError(`${where}: ${why}`);
}

function isPlain(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
}

function exact(o, keys, where) {
  if (!isPlain(o)) fail(where, 'must be an object');
  const actual = Object.keys(o);
  if (actual.length !== keys.length || !keys.every((k) => Object.hasOwn(o, k))) fail(where, 'unexpected or missing keys');
}

function nat(v, where) {
  if (!Number.isSafeInteger(v) || v < 0) fail(where, 'must be a non-negative safe integer');
}

export function assertValidDiscoverResult(items) {
  if (!Array.isArray(items)) fail('discover result', 'must be an array');
  items.forEach((item, i) => {
    const where = `discover result[${i}]`;
    exact(item, ['slug', 'eventEstimate'], where);
    if (typeof item.slug !== 'string' || !BOT_SLUG_RE.test(item.slug)) fail(where, 'invalid slug');
    if (!Number.isSafeInteger(item.eventEstimate) || item.eventEstimate <= 0) fail(where, 'invalid eventEstimate');
  });
  return items;
}

function checkWindow(w) {
  exact(w, ['weeks', 'startDate', 'endDate'], 'window');
  if (w.weeks !== 26 && w.weeks !== 52) fail('window', 'weeks must be 26 or 52');
  if (!isValidIsoDate(w.startDate) || !isValidIsoDate(w.endDate)) fail('window', 'invalid dates');
  const span = dayNumber(w.endDate) - dayNumber(w.startDate) + 1;
  if (dayOfWeek(w.startDate) !== 0 || span !== (w.weeks - 1) * 7 + dayOfWeek(w.endDate) + 1) {
    fail('window', 'dates are not an exact Sunday-aligned window');
  }
  return span;
}

function checkAgent(agent, i, w, span) {
  const where = `agents[${i}]`;
  exact(agent, ['slug', 'label', 'ramp', 'source', 'totals', 'streaks', 'days'], where);
  if (typeof agent.slug !== 'string' || !BOT_SLUG_RE.test(agent.slug)) fail(where, 'invalid slug');
  try {
    validateLabel(agent.label);
  } catch {
    fail(where, 'invalid label');
  }
  if (!VALID_RAMPS.includes(agent.ramp)) fail(where, 'invalid ramp');
  if (agent.source !== 'github') fail(where, 'invalid source');

  exact(agent.totals, ['prsOpened', 'prsMerged', 'commits', 'reviews', 'comments', 'issues', 'total'], `${where}.totals`);
  for (const [k, v] of Object.entries(agent.totals)) nat(v, `${where}.totals.${k}`);
  exact(agent.streaks, ['current', 'best'], `${where}.streaks`);
  nat(agent.streaks.current, `${where}.streaks.current`);
  nat(agent.streaks.best, `${where}.streaks.best`);
  if (agent.streaks.current > agent.streaks.best) fail(where, 'streaks.current exceeds streaks.best');

  if (!isPlain(agent.days) || Object.keys(agent.days).length !== span) fail(`${where}.days`, 'must cover the exact window');
  let sum = 0;
  for (let n = 0; n < span; n++) {
    const key = addDays(w.startDate, n);
    if (!Object.hasOwn(agent.days, key)) fail(`${where}.days`, 'must cover the exact window');
    nat(agent.days[key], `${where}.days`);
    sum += agent.days[key];
  }
  if (agent.totals.total !== sum) fail(`${where}.totals`, 'total does not match the sum of days');
}

/** Validate a counts.json v1 object against the closed schema; returns it unchanged on success. */
export function assertStrictCountsOnly(counts) {
  exact(counts, ['schemaVersion', 'generatedAt', 'window', 'scope', 'agents'], 'counts');
  if (counts.schemaVersion !== 1) fail('counts', 'schemaVersion must be 1');
  const g = counts.generatedAt;
  if (typeof g !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(g) || !Number.isFinite(Date.parse(g))
    || new Date(g).toISOString().replace('.000Z', 'Z') !== g) {
    fail('counts', 'invalid generatedAt');
  }
  const span = checkWindow(counts.window);
  exact(counts.scope, ['mode'], 'scope');
  if (counts.scope.mode !== 'public' && counts.scope.mode !== 'public+private') fail('scope', 'invalid mode');
  if (!Array.isArray(counts.agents) || counts.agents.length < 1 || counts.agents.length > 12) fail('agents', 'must contain 1..12 entries');
  const seen = new Set();
  counts.agents.forEach((agent, i) => {
    checkAgent(agent, i, counts.window, span);
    const key = agent.slug.toLowerCase();
    if (seen.has(key)) fail('agents', 'duplicate slug');
    seen.add(key);
  });
  return counts;
}
