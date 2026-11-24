/**
 * Hybrid GraphQL + REST activity collector (S4). Produces strictly anonymous daily integer
 * counts; node IDs, SHAs and every other identifying value live only inside this call stack.
 */
import { ValidationError, addDays, dayNumber, dayOfWeek, isValidIsoDate, normalizeConfig } from './config.mjs';
import { ApiError, createGitHubClient } from './github-client.mjs';
import { assertStrictCountsOnly } from './privacy-gate.mjs';

const CAP = 1000;
const BACKOFF_MS = [2000, 4000, 8000];
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';
const ACTOR_NODES = `${PAGE_INFO} nodes { id createdAt author { __typename login } }`;
const SEARCH_HEAD = 'search(query: $q, type: ISSUE, first: 100, after: $after)';
const CREATED_QUERY = `query CollectCreated($q: String!, $after: String) {
  ${SEARCH_HEAD} { issueCount ${PAGE_INFO}
    nodes { __typename ... on PullRequest { id createdAt mergedAt author { __typename login } } ... on Issue { id createdAt author { __typename login } } } }
}`;
const REVIEWS_QUERY = `query CollectReviews($q: String!, $after: String) {
  ${SEARCH_HEAD} { issueCount ${PAGE_INFO}
    nodes { __typename ... on PullRequest { id reviews(first: 100) { ${ACTOR_NODES} } } } }
}`;
const COMMENTS_QUERY = `query CollectComments($q: String!, $after: String) {
  ${SEARCH_HEAD} { issueCount ${PAGE_INFO}
    nodes { __typename ... on PullRequest { id comments(first: 100) { ${ACTOR_NODES} } } ... on Issue { id comments(first: 100) { ${ACTOR_NODES} } } } }
}`;
const NODE_REVIEWS_QUERY = `query NodeReviews($nodeId: ID!, $after: String) {
  node(id: $nodeId) { __typename ... on PullRequest { reviews(first: 100, after: $after) { ${ACTOR_NODES} } } }
}`;
const NODE_COMMENTS_QUERY = `query NodeComments($nodeId: ID!, $after: String) {
  node(id: $nodeId) { __typename ... on PullRequest { comments(first: 100, after: $after) { ${ACTOR_NODES} } } ... on Issue { comments(first: 100, after: $after) { ${ACTOR_NODES} } } }
}`;

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dateOf = (v) => (typeof v === 'string' ? v.slice(0, 10) : null);

/** UTC Sunday-aligned window ending at `endDate` (default: today UTC). */
export function computeWindow(windowWeeks, endDate) {
  if (windowWeeks !== 26 && windowWeeks !== 52) throw new ValidationError('windowWeeks must be 26 or 52');
  const end = endDate ?? utcDay(Date.now());
  if (!isValidIsoDate(end)) throw new ValidationError('endDate must be a valid YYYY-MM-DD date');
  return { startDate: addDays(end, -(dayOfWeek(end) + (windowWeeks - 1) * 7)), endDate: end };
}

/** Best and current UTC-calendar streaks of days with a positive count. */
export function computeStreaks(days, startDate, endDate) {
  const total = dayNumber(endDate) - dayNumber(startDate) + 1;
  let best = 0;
  let run = 0;
  for (let i = 0; i < total; i++) {
    run = (days[addDays(startDate, i)] ?? 0) > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const trailing = (last) => {
    let n = 0;
    for (let d = last; d >= startDate && (days[d] ?? 0) > 0; d = addDays(d, -1)) n++;
    return n;
  };
  const current = trailing(endDate) > 0 ? trailing(endDate) : trailing(addDays(endDate, -1));
  return { current, best };
}

function isAgentActor(actor, agent) {
  if (actor?.__typename !== 'Bot' || typeof actor.login !== 'string') return false;
  const login = actor.login.toLowerCase();
  return login === agent.base || login === agent.slugLower;
}

function warn(ctx, code, agent, metric, detail, date) {
  ctx.warnings.push(date === undefined ? { code, agent, metric, detail } : { code, agent, metric, date, detail });
}

function noteScopes(ctx, scopes) {
  if (!ctx.priv || ctx.scopeWarned || typeof scopes !== 'string') return;
  if (scopes.split(',').map((s) => s.trim()).includes('repo')) return;
  ctx.scopeWarned = true;
  warn(ctx, 'SCOPE_CAVEAT', null, null, 'Token may lack repo scope; fine-grained PATs omit scope headers');
}

function makeAccumulator(win) {
  const days = {};
  for (let d = win.startDate; d <= win.endDate; d = addDays(d, 1)) days[d] = 0;
  const totals = { prsOpened: 0, prsMerged: 0, commits: 0, reviews: 0, comments: 0, issues: 0 };
  return {
    days,
    totals,
    add(metric, date) {
      if (date === null || !Object.hasOwn(days, date)) return;
      days[date] += 1;
      totals[metric] += 1;
    }
  };
}

async function graphql(ctx, query, variables) {
  const { data, oauthScopes } = await ctx.client.graphql(query, variables);
  noteScopes(ctx, oauthScopes);
  return data;
}

function splitWindow(a, b) {
  const mid = addDays(a, Math.floor((dayNumber(b) - dayNumber(a)) / 2));
  return [[a, mid], [addDays(mid, 1), b]];
}

/** Page one search window (bisecting when it holds more than 1,000 results). */
async function walkSearch(ctx, o, a, b) {
  const q = o.makeQ(a, b);
  let after = null;
  let seen = 0;
  for (let first = true; ; first = false) {
    const search = (await graphql(ctx, o.query, { q, after })).search;
    if (!search || !Array.isArray(search.nodes)) throw new ApiError('GRAPHQL_ERROR');
    if (first && search.issueCount > CAP) {
      if (a < b) {
        for (const [x, y] of splitWindow(a, b)) await walkSearch(ctx, o, x, y);
        return;
      }
      warn(ctx, 'TRUNCATED_1000', o.agent.slug, o.metric, 'Single-day results capped at 1000', a);
    }
    for (const node of search.nodes) {
      if (seen++ >= CAP) return;
      await o.onNode(node);
    }
    const info = search.pageInfo;
    if (!info?.hasNextPage || !info.endCursor || seen >= CAP || info.endCursor === after) return;
    after = info.endCursor;
  }
}

const createdBy = (field) => (ctx, agent, acc, metric, seen) => (node) => {
  if (!node?.id || seen.has(node.id)) return;
  if (node.author != null && !isAgentActor(node.author, agent)) return;
  seen.add(node.id);
  acc.add(metric, dateOf(node[field]));
};

/** Reviews/comments: consume the nested connection, following node(id) pages past 100 items. */
function nestedBy(field, nodeQuery) {
  return (ctx, agent, acc, metric, seen) => {
    const consume = (conn) => {
      for (const item of Array.isArray(conn?.nodes) ? conn.nodes : []) {
        if (!item?.id || seen.has(item.id) || !isAgentActor(item.author, agent)) continue;
        seen.add(item.id);
        acc.add(metric, dateOf(item.createdAt));
      }
    };
    return async (node) => {
      if (!node?.id || seen.has(`node:${node.id}`)) return;
      seen.add(`node:${node.id}`);
      let conn = node[field];
      consume(conn);
      let cursor = null;
      while (conn?.pageInfo?.hasNextPage && conn.pageInfo.endCursor && conn.pageInfo.endCursor !== cursor) {
        cursor = conn.pageInfo.endCursor;
        conn = (await graphql(ctx, nodeQuery, { nodeId: node.id, after: cursor })).node?.[field];
        consume(conn);
      }
    };
  };
}

const SEARCH_METRICS = {
  prsOpened: { query: CREATED_QUERY, updated: false, filter: (b) => `is:pr author:app/${b}`, qualifier: 'created', handler: createdBy('createdAt') },
  prsMerged: { query: CREATED_QUERY, updated: false, filter: (b) => `is:pr is:merged author:app/${b}`, qualifier: 'merged', handler: createdBy('mergedAt') },
  issues: { query: CREATED_QUERY, updated: false, filter: (b) => `is:issue author:app/${b}`, qualifier: 'created', handler: createdBy('createdAt') },
  reviews: { query: REVIEWS_QUERY, updated: true, filter: (b) => `is:pr reviewed-by:app/${b}`, handler: nestedBy('reviews', NODE_REVIEWS_QUERY) },
  comments: { query: COMMENTS_QUERY, updated: true, filter: (b) => `commenter:app/${b}`, handler: nestedBy('comments', NODE_COMMENTS_QUERY) }
};

async function collectSearchMetric(ctx, agent, acc, metric) {
  const spec = SEARCH_METRICS[metric];
  const { startDate, endDate } = ctx.win;
  const top = spec.updated ? ctx.upper : endDate;
  const makeQ = (a, b) => {
    const range = spec.updated
      ? (b === ctx.upper ? `updated:>=${a}` : `updated:${a}..${b}`)
      : `${spec.qualifier}:${a}..${b}`;
    return `${spec.filter(agent.base)} ${ctx.scope}${ctx.pub} ${range}`;
  };
  const onNode = spec.handler(ctx, agent, acc, metric, new Set());
  await walkSearch(ctx, { query: spec.query, makeQ, onNode, agent, metric }, startDate, top);
}

const hasNextLink = (link) => typeof link === 'string' && /;\s*rel="?next"?/i.test(link);

async function collectCommits(ctx, agent, acc) {
  const seen = new Set();
  const walk = async (a, b) => {
    let attempt = 0;
    let warned = false;
    for (let page = 1; ; ) {
      const params = new URLSearchParams({ q: `author:${agent.slug} ${ctx.scope}${ctx.pub} author-date:${a}..${b}`, per_page: '100', page: String(page) });
      const { body, link, oauthScopes } = await ctx.client.searchCommits(params);
      noteScopes(ctx, oauthScopes);
      const total = Number.isSafeInteger(body?.total_count) ? body.total_count : 0;
      const items = Array.isArray(body?.items) ? body.items : [];
      const incomplete = body?.incomplete_results === true;
      if (page === 1 && a < b && (total > CAP || incomplete)) {
        for (const [x, y] of splitWindow(a, b)) await walk(x, y);
        return;
      }
      if (a === b && incomplete && attempt < BACKOFF_MS.length) {
        await ctx.sleep(BACKOFF_MS[attempt++]);
        continue;
      }
      if (a === b && !warned && (incomplete || total > CAP)) {
        warned = true;
        if (incomplete) warn(ctx, 'INCOMPLETE_RESULTS', agent.slug, 'commits', 'GitHub reported incomplete search results', a);
        if (total > CAP) warn(ctx, 'TRUNCATED_1000', agent.slug, 'commits', 'Single-day results capped at 1000', a);
      }
      for (const item of items) {
        if (typeof item?.sha !== 'string' || seen.has(item.sha)) continue;
        seen.add(item.sha);
        const when = new Date(item?.commit?.author?.date);
        if (!Number.isNaN(when.getTime())) acc.add('commits', utcDay(when.getTime()));
      }
      if (items.length < 100 || page * 100 >= Math.min(total, CAP) || !hasNextLink(link)) return;
      page += 1;
    }
  };
  await walk(ctx.win.startDate, ctx.win.endDate);
}

/**
 * @returns {Promise<{ counts: object, warnings: Array<{ code: string, agent: string|null, metric: string|null, detail: string }> }>}
 */
export async function collectActivity({ config, includePrivate, endDate, token, client, fetchFn, sleepFn, nowFn = Date.now } = {}) {
  const cfg = normalizeConfig(config);
  const priv = includePrivate === undefined ? cfg.includePrivate : includePrivate;
  if (typeof priv !== 'boolean') throw new ValidationError('includePrivate must be a boolean');
  const win = computeWindow(cfg.windowWeeks, endDate ?? utcDay(nowFn()));
  const today = utcDay(nowFn());
  const ctx = {
    client: client ?? createGitHubClient({ token, fetchFn, sleepFn, nowFn }),
    sleep: sleepFn ?? defaultSleep,
    win,
    priv,
    upper: today > win.endDate ? today : win.endDate,
    scope: `${cfg.scopeType}:${cfg.owner}`,
    pub: priv ? '' : ' is:public',
    warnings: [],
    scopeWarned: false
  };

  const agents = [];
  for (const entry of cfg.agents) {
    const agent = { slug: entry.slug, slugLower: entry.slug.toLowerCase(), base: entry.slug.replace(/\[bot\]$/i, '').toLowerCase() };
    const acc = makeAccumulator(win);
    for (const metric of Object.keys(SEARCH_METRICS)) {
      if (cfg.metrics[metric]) await collectSearchMetric(ctx, agent, acc, metric);
    }
    if (cfg.metrics.commits) await collectCommits(ctx, agent, acc);
    const total = Object.values(acc.days).reduce((sum, n) => sum + n, 0);
    agents.push({
      slug: entry.slug,
      label: entry.label,
      ramp: entry.ramp,
      source: 'github',
      totals: { ...acc.totals, total },
      streaks: computeStreaks(acc.days, win.startDate, win.endDate),
      days: acc.days
    });
  }

  const generatedAt = endDate == null ? new Date(nowFn()).toISOString().replace(/\.\d{3}Z$/, 'Z') : `${win.endDate}T00:00:00Z`;
  const counts = {
    schemaVersion: 1,
    generatedAt,
    window: { weeks: cfg.windowWeeks, startDate: win.startDate, endDate: win.endDate },
    scope: { mode: priv ? 'public+private' : 'public' },
    agents
  };
  assertStrictCountsOnly(counts);
  return { counts, warnings: ctx.warnings };
}
