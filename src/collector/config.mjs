/**
 * Dependency-free closed `lynceus.json` v1 validation (S3) plus shared UTC date helpers.
 * Zero imports; the collector, privacy gate and CLI all build on this module.
 */

export const VALID_RAMPS = Object.freeze(['emerald', 'cobalt', 'amber', 'violet', 'rose', 'teal']);
export const BOT_SLUG_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\[bot\]$/;
export const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
export const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/;
export const SUBPATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/;

const METRIC_KEYS = Object.freeze(['prsOpened', 'prsMerged', 'commits', 'reviews', 'comments', 'issues']);
const REQUIRED_KEYS = ['schemaVersion', 'owner', 'scopeType', 'includePrivate', 'windowWeeks', 'layout', 'detail', 'markStyle', 'labelMode', 'metrics', 'agents'];
const OPTIONAL_KEYS = ['branch', 'subpath', 'markdownBase'];
const ENUMS = Object.freeze({
  scopeType: ['user', 'org'],
  layout: ['unified', 'separate'],
  detail: ['breakdown', 'minimal'],
  markStyle: ['squares', 'magnitude'],
  labelMode: ['friendly', 'raw'],
  markdownBase: ['raw', 'relative']
});
const LABEL_FORBIDDEN_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    this.exitCode = 2;
  }
}

function fail(message) {
  throw new ValidationError(message);
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// ---- UTC calendar helpers (shared with privacy-gate and collect) ----
export function isValidIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export function dayNumber(s) {
  return Date.parse(`${s}T00:00:00Z`) / MS_PER_DAY;
}
export function addDays(s, n) {
  return new Date((dayNumber(s) + n) * MS_PER_DAY).toISOString().slice(0, 10);
}
export function dayOfWeek(s) {
  return new Date(`${s}T00:00:00Z`).getUTCDay();
}

// ---- Field validators (throw ValidationError, return the normalized value) ----
export function validateBotSlugFormat(slug) {
  if (typeof slug !== 'string' || !BOT_SLUG_RE.test(slug)) fail('Invalid bot slug (expected "<name>[bot]")');
  return slug;
}

export function validateOwner(owner) {
  if (typeof owner !== 'string' || !OWNER_RE.test(owner)) fail('Invalid owner');
  return owner;
}

export function validateLabel(label) {
  if (typeof label !== 'string' || !label.isWellFormed()) fail('Invalid label');
  const trimmed = label.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > 40) fail('Label must be 1..40 characters');
  if (LABEL_FORBIDDEN_RE.test(trimmed)) fail('Label contains forbidden control or directional characters');
  return trimmed;
}

function segments(value) {
  return value.split('/');
}

export function validateBranch(branch) {
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) fail('Invalid branch');
  const lower = branch.toLowerCase();
  if (['main', 'master', 'head'].includes(lower)) fail('Branch name is not allowed');
  if (/^(?:refs|heads|tags|remotes)\//.test(lower)) fail('Branch must not use a ref-namespace prefix');
  if (branch.includes('..') || branch.includes('//')) fail('Invalid branch');
  if (branch.endsWith('.') || branch.endsWith('/')) fail('Invalid branch');
  if (segments(branch).some((s) => s.startsWith('.') || s.endsWith('.lock'))) fail('Invalid branch');
  return branch;
}

export function validateSubpath(subpath) {
  if (subpath === '') return subpath;
  if (typeof subpath !== 'string' || !SUBPATH_RE.test(subpath)) fail('Invalid subpath');
  if (subpath.includes('..') || subpath.includes('//') || subpath.endsWith('/')) fail('Invalid subpath');
  if (segments(subpath).some((s) => s.startsWith('.'))) fail('Invalid subpath');
  return subpath;
}

function checkKeys(obj, required, optional, where) {
  if (!isPlainObject(obj)) fail(`${where} must be an object`);
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) fail(`${where} contains an unknown property`);
  }
  for (const key of required) {
    if (!Object.hasOwn(obj, key)) fail(`${where}.${key} is required`);
  }
}

function checkEnum(name, value) {
  if (!ENUMS[name].includes(value)) fail(`${name} is invalid`);
  return value;
}

function normalizeMetrics(metrics) {
  checkKeys(metrics, METRIC_KEYS, [], 'metrics');
  const out = {};
  for (const key of METRIC_KEYS) {
    if (typeof metrics[key] !== 'boolean') fail(`metrics.${key} must be a boolean`);
    out[key] = metrics[key];
  }
  if (!METRIC_KEYS.some((k) => out[k])) fail('At least one metric must be enabled');
  return out;
}

function normalizeAgents(agents, allowEmpty) {
  if (!Array.isArray(agents)) fail('agents must be an array');
  const min = allowEmpty ? 0 : 1;
  if (agents.length < min || agents.length > 12) fail(`agents must contain ${min}..12 entries`);
  const seen = new Set();
  return agents.map((agent, i) => {
    checkKeys(agent, ['slug', 'label', 'ramp'], [], `agents[${i}]`);
    const slug = validateBotSlugFormat(agent.slug);
    if (seen.has(slug.toLowerCase())) fail('agents must be unique by slug (case-insensitive)');
    seen.add(slug.toLowerCase());
    if (!VALID_RAMPS.includes(agent.ramp)) fail(`agents[${i}].ramp is invalid`);
    return { slug, label: validateLabel(agent.label), ramp: agent.ramp };
  });
}

/**
 * Validate a raw lynceus.json object (closed schema v1) and return a normalized copy with
 * `branch`/`subpath`/`markdownBase` defaults applied.
 */
export function normalizeConfig(raw, { allowEmptyAgents = false } = {}) {
  checkKeys(raw, REQUIRED_KEYS, OPTIONAL_KEYS, 'config');
  if (raw.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (typeof raw.includePrivate !== 'boolean') fail('includePrivate must be a boolean');
  if (raw.windowWeeks !== 26 && raw.windowWeeks !== 52) fail('windowWeeks must be 26 or 52');
  return {
    schemaVersion: 1,
    owner: validateOwner(raw.owner),
    scopeType: checkEnum('scopeType', raw.scopeType),
    includePrivate: raw.includePrivate,
    windowWeeks: raw.windowWeeks,
    layout: checkEnum('layout', raw.layout),
    detail: checkEnum('detail', raw.detail),
    markStyle: checkEnum('markStyle', raw.markStyle),
    labelMode: checkEnum('labelMode', raw.labelMode),
    branch: Object.hasOwn(raw, 'branch') ? validateBranch(raw.branch) : 'generated',
    subpath: Object.hasOwn(raw, 'subpath') ? validateSubpath(raw.subpath) : 'agent-activity',
    markdownBase: Object.hasOwn(raw, 'markdownBase') ? checkEnum('markdownBase', raw.markdownBase) : 'raw',
    metrics: normalizeMetrics(raw.metrics),
    agents: normalizeAgents(raw.agents, allowEmptyAgents)
  };
}
