/**
 * Shared mock GitHub API for the collector tests (imported by sibling test files) plus a few
 * self-tests of the mock itself. Reuses tests/fixtures/github-mocks.mjs without modifying it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeJsonResponse, makeSearchPage } from '../fixtures/github-mocks.mjs';
import { addDays } from '../../src/collector/config.mjs';

export const NOW = Date.parse('2026-11-24T12:00:00Z');

/** Wrap a body with an explicit status/headers. */
export function reply(body, { status = 200, headers = {} } = {}) {
  return { __reply: true, body, status, headers };
}

/** Fake clock: sleepFn advances time and records the requested sleeps. */
export function createClock(start = NOW) {
  const clock = { time: start, sleeps: [] };
  clock.nowFn = () => clock.time;
  clock.sleepFn = async (ms) => {
    clock.sleeps.push(ms);
    clock.time += ms;
  };
  return clock;
}

/** Low-level router: handlers return a body (HTTP 200), `reply(...)`, or throw. */
export function createMockApi({ graphql, commits, user, clock } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const call = { url: String(url), pathname: u.pathname, init, params: u.searchParams, body, at: clock?.time ?? 0 };
    calls.push(call);
    let out;
    if (u.pathname === '/graphql') out = await graphql?.(body.query, body.variables, call);
    else if (u.pathname === '/search/commits') out = await commits?.(u.searchParams, call);
    else if (u.pathname.startsWith('/users/')) out = await user?.(decodeURIComponent(u.pathname.slice(7)), call);
    if (out === undefined) throw new Error(`unhandled mock request ${u.pathname}`);
    return out?.__reply ? makeJsonResponse(out.body, out) : makeJsonResponse(out);
  };
  return { fetchFn, calls };
}

const bot = (login) => ({ __typename: 'Bot', login });

function paginate(list, after, cap = 1000, size = 100) {
  const start = after ? Number(after) : 0;
  const end = Math.min(start + size, cap, list.length);
  return { slice: list.slice(start, end), hasNextPage: end < Math.min(list.length, cap), endCursor: String(end) };
}

function parseRange(q) {
  let m = /(created|merged):(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(q);
  if (m) return { from: m[2], to: m[3] };
  m = /updated:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(q);
  if (m) return { from: m[1], to: m[2] };
  m = /updated:>=(\d{4}-\d{2}-\d{2})/.exec(q);
  return { from: m[1], to: '9999-12-31' };
}

function metricOf(q) {
  if (q.includes('reviewed-by:')) return 'reviews';
  if (q.includes('commenter:')) return 'comments';
  if (q.includes('is:merged')) return 'prsMerged';
  if (q.includes('is:issue')) return 'issues';
  return 'prsOpened';
}

const DATE_FIELD = { prsOpened: 'createdAt', prsMerged: 'mergedAt', issues: 'createdAt', reviews: 'updated', comments: 'updated' };

/**
 * Stateful simulator of the GitHub search/node/commit endpoints over an in-memory `world`
 * (object, or `(base) => object`): { prsOpened, prsMerged, issues, reviews, comments, commits,
 * scopes, ignoreRange, incomplete(a, b, n) }. Extra item fields are passed through so tests can
 * plant canary values.
 */
export function createWorldApi(world, { clock } = {}) {
  const searches = [];
  const nodeCalls = [];
  const commitCalls = [];
  const dataFor = (base) => (typeof world === 'function' ? world(base) : world);
  const respond = (body) => (dataFor('x').scopes === undefined ? body : reply(body, { headers: { 'x-oauth-scopes': dataFor('x').scopes } }));

  function handleSearch(q, after) {
    const metric = metricOf(q);
    const base = /app\/(\S+)/.exec(q)[1];
    const data = dataFor(base);
    searches.push({ metric, q, after });
    const { from, to } = parseRange(q);
    const field = DATE_FIELD[metric];
    const items = (data[metric] ?? []).filter((it) => data.ignoreRange || (it[field].slice(0, 10) >= from && it[field].slice(0, 10) <= to));
    const { slice, hasNextPage, endCursor } = paginate(items, after);
    const nodes = slice.map((it) => {
      if (metric === 'reviews' || metric === 'comments') {
        const { updated, reviews, comments, ...rest } = it;
        const conn = paginate(it[metric === 'reviews' ? 'reviews' : 'comments'], null);
        return { __typename: 'PullRequest', ...rest, [metric]: { pageInfo: { hasNextPage: conn.hasNextPage, endCursor: conn.endCursor }, nodes: conn.slice } };
      }
      return { __typename: 'PullRequest', author: bot(base), ...it };
    });
    return respond(makeSearchPage({ issueCount: items.length, nodes, hasNextPage, endCursor }));
  }

  function handleNode(variables) {
    nodeCalls.push(variables);
    const all = ['reviews', 'comments'].flatMap((m) => (dataFor('x')[m] ?? []).map((it) => [m, it]));
    const [metric, item] = all.find(([, it]) => it.id === variables.nodeId);
    const conn = paginate(item[metric], variables.after);
    return respond({ data: { node: { __typename: 'PullRequest', [metric]: { pageInfo: { hasNextPage: conn.hasNextPage, endCursor: conn.endCursor }, nodes: conn.slice } } } });
  }

  function handleCommits(params, call) {
    const q = params.get('q');
    const [, from, to] = /author-date:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(q);
    const data = dataFor(/^author:(\S+)\[bot\]/.exec(q)[1].toLowerCase());
    const n = commitCalls.filter((c) => c.from === from && c.to === to).length;
    commitCalls.push({ q, from, to, page: Number(params.get('page')), at: call.at });
    const items = (data.commits ?? []).filter((c) => data.ignoreRange || (c.date.slice(0, 10) >= from && c.date.slice(0, 10) <= to));
    const page = Number(params.get('page'));
    const slice = items.slice((page - 1) * 100, page * 100).map(({ sha, date, ...rest }) => ({ sha, commit: { author: { date } }, ...rest }));
    const more = page * 100 < Math.min(items.length, 1000);
    const headers = { ...(data.scopes === undefined ? {} : { 'x-oauth-scopes': data.scopes }), ...(more ? { link: `<https://api.github.com/search/commits?page=${page + 1}>; rel="next"` } : {}) };
    const body = { total_count: items.length, incomplete_results: data.incomplete?.(from, to, n) === true, items: slice };
    return reply(body, { headers });
  }

  const api = createMockApi({
    clock,
    graphql: (query, variables) => (query.includes('node(id: $nodeId)') ? handleNode(variables) : handleSearch(variables.q, variables.after)),
    commits: handleCommits
  });
  return { ...api, searches, nodeCalls, commitCalls };
}

test('mock api routes graphql, commits and users and records calls', async () => {
  const api = createMockApi({ graphql: () => ({ data: { ok: true } }), commits: () => ({ items: [] }), user: (slug) => ({ login: slug }) });
  assert.deepEqual(await (await api.fetchFn('https://api.github.com/graphql', { method: 'POST', body: '{"query":"q","variables":{}}' })).json(), { data: { ok: true } });
  assert.deepEqual(await (await api.fetchFn('https://api.github.com/users/a%5Bbot%5D')).json(), { login: 'a[bot]' });
  assert.equal(api.calls.length, 2);
  assert.equal(addDays('2026-11-24', 1), '2026-11-25');
});
