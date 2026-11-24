// Synthetic counts.json v1 presets (52w & 26w) for Pages demo mode and initial preview (SPEC S3/S7).
// Pure browser + Node ESM: zero node:* imports, zero real user/private data.

const MS_PER_DAY = 86_400_000;
const METRIC_KEYS = ['prsOpened', 'prsMerged', 'commits', 'reviews', 'comments', 'issues'];
const METRIC_WEIGHTS = Object.freeze({
  prsOpened: 0.19,
  prsMerged: 0.15,
  commits: 0.34,
  reviews: 0.16,
  comments: 0.11,
  issues: 0.05
});

export const DEMO_DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  owner: 'atlas-demo',
  scopeType: 'user',
  includePrivate: false,
  windowWeeks: 52,
  layout: 'unified',
  detail: 'breakdown',
  markStyle: 'squares',
  labelMode: 'friendly',
  branch: 'generated',
  subpath: 'agent-activity',
  markdownBase: 'raw',
  metrics: Object.freeze({
    prsOpened: true,
    prsMerged: true,
    commits: true,
    reviews: true,
    comments: true,
    issues: true
  }),
  agents: Object.freeze([
    Object.freeze({ slug: 'dependapilot[bot]', label: 'Pilot', ramp: 'emerald' }),
    Object.freeze({ slug: 'ci-scribe[bot]', label: 'Scribe', ramp: 'cobalt' }),
    Object.freeze({ slug: 'doc-weaver[bot]', label: 'Weaver', ramp: 'amber' })
  ])
});

export const DEMO_DISCOVERED_BOTS = Object.freeze([
  Object.freeze({ slug: 'dependapilot[bot]', eventEstimate: 142 }),
  Object.freeze({ slug: 'ci-scribe[bot]', eventEstimate: 98 }),
  Object.freeze({ slug: 'doc-weaver[bot]', eventEstimate: 64 }),
  Object.freeze({ slug: 'release-steward[bot]', eventEstimate: 29 })
]);

function addDaysUtc(dateStr, offset) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + offset * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function computeStreaksFromDays(days, startDate, endDate) {
  const totalDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY) + 1;
  let best = 0;
  let run = 0;
  for (let i = 0; i < totalDays; i++) {
    const key = addDaysUtc(startDate, i);
    run = (days[key] ?? 0) > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  const trailing = (last) => {
    let n = 0;
    for (let d = last; d >= startDate && (days[d] ?? 0) > 0; d = addDaysUtc(d, -1)) n += 1;
    return n;
  };
  const endStreak = trailing(endDate);
  const current = endStreak > 0 ? endStreak : trailing(addDaysUtc(endDate, -1));
  return { current, best };
}

function buildPresetAgent(agent, startDate, endDate, seedOffset, metrics) {
  const enabled = METRIC_KEYS.filter((k) => !metrics || metrics[k] !== false);
  const activeMetrics = enabled.length > 0 ? enabled : ['commits'];
  const totalDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY) + 1;

  let seed = hashKey(`${agent.slug}:${startDate}:${endDate}:${seedOffset}`);
  const rand = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const metricFactor = activeMetrics.length / METRIC_KEYS.length;
  const days = {};
  let total = 0;

  for (let i = 0; i < totalDays; i++) {
    const key = addDaysUtc(startDate, i);
    const wave = 0.5 + 0.35 * Math.sin(i / 11 + seedOffset);
    const r = rand();
    let count = 0;
    if (r > 0.38 - wave * 0.14) {
      const raw = Math.ceil(Math.pow(rand(), 1.55) * 9 * metricFactor);
      count = Math.max(1, raw);
    }
    if (i >= totalDays - 3 && seedOffset === 0) {
      count = Math.max(count, 2);
    }
    days[key] = count;
    total += count;
  }

  const totals = {
    prsOpened: 0,
    prsMerged: 0,
    commits: 0,
    reviews: 0,
    comments: 0,
    issues: 0,
    total
  };

  const weightSum = activeMetrics.reduce((acc, k) => acc + METRIC_WEIGHTS[k], 0);
  let assigned = 0;
  for (let i = 0; i < activeMetrics.length; i++) {
    const key = activeMetrics[i];
    if (i === activeMetrics.length - 1) {
      totals[key] = Math.max(0, total - assigned);
    } else {
      const val = Math.min(total - assigned, Math.round((total * METRIC_WEIGHTS[key]) / weightSum));
      totals[key] = val;
      assigned += val;
    }
  }

  return {
    slug: agent.slug,
    label: agent.label,
    ramp: agent.ramp,
    source: 'github',
    totals,
    streaks: computeStreaksFromDays(days, startDate, endDate),
    days
  };
}

function buildPreset(weeks) {
  const endDate = '2026-11-24';
  const endDow = new Date(`${endDate}T00:00:00Z`).getUTCDay();
  const startDate = addDaysUtc(endDate, -(endDow + (weeks - 1) * 7));
  return {
    schemaVersion: 1,
    generatedAt: `${endDate}T00:00:00Z`,
    window: { weeks, startDate, endDate },
    scope: { mode: 'public' },
    agents: DEMO_DEFAULT_CONFIG.agents.map((a, idx) => buildPresetAgent(a, startDate, endDate, idx, DEMO_DEFAULT_CONFIG.metrics))
  };
}

export const DEMO_COUNTS_52W = buildPreset(52);
export const DEMO_COUNTS_26W = buildPreset(26);

export const DEMO_PRESETS = Object.freeze({
  52: DEMO_COUNTS_52W,
  26: DEMO_COUNTS_26W
});

/**
 * Project a synthetic counts.json v1 document from the pre-built 52w/26w presets while
 * preserving all user Configure edits (agents, labels, ramps, metrics, scope).
 */
export function buildDemoCountsForConfig(config, presets = DEMO_PRESETS) {
  const weeks = config?.windowWeeks === 26 ? 26 : 52;
  const base = presets[weeks] ?? DEMO_COUNTS_52W;
  const metrics = config?.metrics ?? DEMO_DEFAULT_CONFIG.metrics;
  const baseBySlug = new Map(base.agents.map((a) => [a.slug.toLowerCase(), a]));

  const agents = (config?.agents ?? []).map((agent, idx) => {
    const existing = baseBySlug.get(agent.slug.toLowerCase());
    if (existing && METRIC_KEYS.every((k) => metrics[k] === true)) {
      return {
        ...existing,
        slug: agent.slug,
        label: agent.label,
        ramp: agent.ramp
      };
    }
    return buildPresetAgent(agent, base.window.startDate, base.window.endDate, idx, metrics);
  });

  return {
    schemaVersion: 1,
    generatedAt: base.generatedAt,
    window: { ...base.window },
    scope: { mode: 'public' },
    agents
  };
}
