import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError, addDays, dayNumber } from '../../src/collector/config.mjs';
import { collectActivity, computeStreaks, computeWindow } from '../../src/collector/collect.mjs';
import { assertStrictCountsOnly } from '../../src/collector/privacy-gate.mjs';
import { makeProfileAgentsConfig } from '../fixtures/github-mocks.mjs';
import { NOW, createClock, createMockApi, createWorldApi, reply } from './mock-api.mjs';

const END = '2026-11-24';
const START = '2025-11-30';
const SLUG = 'mephistos-homunculus[bot]';
const BASE = 'mephistos-homunculus';
const botA = { __typename: 'Bot', login: BASE };

function config(overrides = {}) {
  const cfg = makeProfileAgentsConfig();
  cfg.includePrivate = false;
  cfg.agents = [cfg.agents[0]];
  return { ...cfg, ...overrides };
}

async function run(world, { cfg = config(), clock = createClock(), ...options } = {}) {
  const api = createWorldApi(world, { clock });
  const result = await collectActivity({ config: cfg, endDate: END, token: 'ghp_collectTestToken123', fetchFn: api.fetchFn, sleepFn: clock.sleepFn, nowFn: clock.nowFn, ...options });
  return { ...result, api, clock, agent: result.counts.agents[0] };
}

const baseWorld = () => ({
  prsOpened: [{ id: 'p1', createdAt: '2026-11-24T01:00:00Z' }, { id: 'p2', createdAt: '2026-11-24T05:00:00Z' }, { id: 'p3', createdAt: '2026-11-23T10:00:00Z' }],
  prsMerged: [{ id: 'm1', mergedAt: '2026-11-23T08:00:00Z' }],
  issues: [{ id: 'i1', createdAt: '2026-11-20T08:00:00Z' }],
  reviews: [{
    id: 'r1',
    updated: '2026-11-24',
    reviews: [
      { id: 'rv1', createdAt: '2026-11-22T10:00:00Z', author: botA },
      { id: 'rv2', createdAt: '2026-11-22T11:00:00Z', author: { __typename: 'User', login: BASE } },
      { id: 'rv3', createdAt: '2026-11-22T12:00:00Z', author: { __typename: 'Bot', login: 'other-bot' } },
      { id: 'rv4', createdAt: '2025-11-01T12:00:00Z', author: botA }
    ]
  }],
  comments: [{ id: 'c1', updated: '2026-11-21', comments: [{ id: 'cm1', createdAt: '2026-11-21T10:00:00Z', author: { __typename: 'Bot', login: SLUG.toUpperCase() } }, { id: 'cm2', createdAt: '2026-11-21T10:00:00Z', author: null }] }],
  commits: [
    { sha: 'sha1', date: '2026-11-24T00:30:00Z' },
    { sha: 'sha2', date: '2026-11-24T10:30:00Z' },
    { sha: 'sha3', date: '2026-11-23T23:30:00-05:00' }
  ]
});

test('computeWindow: Sunday-aligned UTC window for 52/26 weeks, validation', () => {
  assert.deepEqual(computeWindow(52, END), { startDate: START, endDate: END });
  assert.deepEqual(computeWindow(26, END), { startDate: '2026-05-31', endDate: END });
  assert.deepEqual(computeWindow(52, '2026-11-22'), { startDate: START, endDate: '2026-11-22' });
  assert.equal(new Date(`${computeWindow(26, '2024-02-29').startDate}T00:00:00Z`).getUTCDay(), 0);
  assert.match(computeWindow(52).endDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => computeWindow(30, END), ValidationError);
  assert.throws(() => computeWindow(52, '2026-02-30'), ValidationError);
  assert.throws(() => computeWindow(52, 'yesterday'), ValidationError);
});

test('computeStreaks: best run, current through today or yesterday, else 0', () => {
  const days = (active) => {
    const out = {};
    for (let d = '2026-11-01'; d <= '2026-11-10'; d = addDays(d, 1)) out[d] = active.includes(d) ? 1 : 0;
    return out;
  };
  const s = (active) => computeStreaks(days(active), '2026-11-01', '2026-11-10');
  assert.deepEqual(s([]), { current: 0, best: 0 });
  assert.deepEqual(s(['2026-11-10']), { current: 1, best: 1 });
  assert.deepEqual(s(['2026-11-08', '2026-11-09', '2026-11-10']), { current: 3, best: 3 });
  assert.deepEqual(s(['2026-11-07', '2026-11-08', '2026-11-09']), { current: 3, best: 3 }, 'incomplete today does not wipe a streak through yesterday');
  assert.deepEqual(s(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-08']), { current: 0, best: 4 });
  assert.deepEqual(s(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10']), { current: 2, best: 3 });
  assert.deepEqual(s(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']), { current: 10, best: 10 });
});

test('collects all six metrics with exact queries, bot filtering, UTC commit dates and streaks', async () => {
  const { counts, warnings, api, agent } = await run(baseWorld());
  assert.deepEqual(warnings, []);
  assert.equal(counts.generatedAt, `${END}T00:00:00Z`);
  assert.deepEqual(counts.window, { weeks: 52, startDate: START, endDate: END });
  assert.deepEqual(counts.scope, { mode: 'public' });
  assert.deepEqual(agent.totals, { prsOpened: 3, prsMerged: 1, commits: 3, reviews: 1, comments: 1, issues: 1, total: 10 });
  assert.equal(agent.days['2026-11-24'], 5);
  assert.equal(agent.days['2026-11-23'], 2);
  assert.equal(agent.days['2026-11-22'], 1);
  assert.equal(agent.days['2026-11-21'], 1);
  assert.equal(agent.days['2026-11-20'], 1);
  assert.deepEqual(agent.streaks, { current: 5, best: 5 });
  assert.equal(agent.source, 'github');
  assertStrictCountsOnly(counts);

  const scope = 'user:mephistopheles4 is:public';
  assert.deepEqual(api.searches.map((s) => s.q), [
    `is:pr author:app/${BASE} ${scope} created:${START}..${END}`,
    `is:pr is:merged author:app/${BASE} ${scope} merged:${START}..${END}`,
    `is:issue author:app/${BASE} ${scope} created:${START}..${END}`,
    `is:pr reviewed-by:app/${BASE} ${scope} updated:>=${START}`,
    `commenter:app/${BASE} ${scope} updated:>=${START}`
  ]);
  assert.deepEqual(api.commitCalls.map((c) => c.q), [`author:${SLUG} ${scope} author-date:${START}..${END}`]);
});

test('GraphQL queries use $q/$after variables, never select incomplete_results, and never embed the query text', async () => {
  const { api } = await run(baseWorld());
  const gql = api.calls.filter((c) => c.pathname === '/graphql');
  assert.ok(gql.length >= 5);
  for (const call of gql) {
    assert.match(call.body.query, /\$q: String!, \$after: String/);
    assert.ok(!call.body.query.includes('incomplete_results'));
    assert.ok(!call.body.query.includes('mephistopheles4') && !call.body.query.includes(BASE));
    assert.deepEqual(Object.keys(call.body.variables), ['q', 'after']);
  }
  const reviews = gql.find((c) => c.body.variables.q.includes('reviewed-by'));
  assert.match(reviews.body.query, /reviews\(first: 100\)/);
  assert.match(reviews.body.query, /pageInfo \{ hasNextPage endCursor \}/);
  const rest = api.calls.find((c) => c.pathname === '/search/commits');
  assert.equal(rest.params.get('per_page'), '100');
  assert.equal(rest.params.get('page'), '1');
});

test('includePrivate: true omits is:public and reports public+private; override must be boolean', async () => {
  const { counts, api } = await run(baseWorld(), { includePrivate: true });
  assert.equal(counts.scope.mode, 'public+private');
  assert.ok(api.searches.every((s) => !s.q.includes('is:public')));
  assert.ok(api.commitCalls.every((c) => !c.q.includes('is:public')));
  const fromConfig = await run(baseWorld(), { cfg: config({ includePrivate: true }) });
  assert.equal(fromConfig.counts.scope.mode, 'public+private');
  await assert.rejects(() => run(baseWorld(), { includePrivate: 'true' }), ValidationError);
  await assert.rejects(() => run(baseWorld(), { includePrivate: 1 }), ValidationError);
  await assert.rejects(() => run(baseWorld(), { cfg: { ...config(), extra: true } }), ValidationError);
});

test('org scope and 26-week windows', async () => {
  const { counts, api } = await run(baseWorld(), { cfg: config({ scopeType: 'org', windowWeeks: 26 }) });
  assert.equal(counts.window.startDate, '2026-05-31');
  assert.ok(api.searches[0].q.includes('org:mephistopheles4 is:public created:2026-05-31..2026-11-24'));
});

test('disabled metrics are skipped entirely and recorded as 0', async () => {
  const metrics = { prsOpened: false, prsMerged: false, commits: true, reviews: false, comments: false, issues: false };
  const { agent, api } = await run(baseWorld(), { cfg: config({ metrics }) });
  assert.equal(api.searches.length, 0);
  assert.equal(api.calls.filter((c) => c.pathname === '/graphql').length, 0);
  assert.deepEqual(agent.totals, { prsOpened: 0, prsMerged: 0, commits: 3, reviews: 0, comments: 0, issues: 0, total: 3 });
  const noCommits = await run(baseWorld(), { cfg: config({ metrics: { ...metrics, commits: false, prsOpened: true } }) });
  assert.equal(noCommits.api.commitCalls.length, 0);
  assert.equal(noCommits.agent.totals.total, 3);
});

test('out-of-window events are dropped and malformed items are ignored', async () => {
  const world = {
    ignoreRange: true,
    prsOpened: [
      { id: 'a', createdAt: '2025-11-29T23:59:59Z' }, { id: 'b', createdAt: '2025-11-30T00:00:00Z' }, { id: 'c', createdAt: '2026-11-24T23:59:59Z' },
      { id: 'd', createdAt: '2026-11-25T00:00:00Z' }, { id: 'e', createdAt: null }, { id: 'f', createdAt: 'garbage' }, { createdAt: '2026-11-24T00:00:00Z' },
      { id: 'g', createdAt: '2026-11-24T00:00:00Z', author: { __typename: 'User', login: BASE } },
      { id: 'h_null', createdAt: '2026-11-24T00:00:00Z', author: null }
    ],
    commits: [
      { sha: 'x1', date: '2025-11-29T23:00:00Z' }, { sha: 'x2', date: '2025-11-30T00:00:00Z' }, { sha: 'x3', date: '2026-11-24T23:59:00Z' },
      { sha: 'x4', date: '2026-11-25T00:00:00Z' }, { sha: 'x5', date: 'not a date' }, { sha: 'x2', date: '2025-11-30T00:00:00Z' }, { date: '2026-11-24T00:00:00Z' }
    ]
  };
  const { agent } = await run(world, { cfg: config({ metrics: { prsOpened: true, prsMerged: false, commits: true, reviews: false, comments: false, issues: false } }) });
  assert.equal(agent.totals.prsOpened, 2);
  assert.equal(agent.days[START], 2, 'one PR + one commit on startDate (duplicate sha counted once)');
  assert.equal(agent.totals.commits, 2);
  assert.equal(agent.days[END], 2);
  assert.equal(agent.totals.total, 4);
  assert.deepEqual(Object.keys(agent.days).length, 360);
});

test('GraphQL search paginates with $after across pages (and dedupes by node id)', async () => {
  const prs = Array.from({ length: 250 }, (_, i) => ({ id: `pr${i}`, createdAt: `2026-11-${String(10 + (i % 10)).padStart(2, '0')}T10:00:00Z` }));
  const world = { prsOpened: [...prs, prs[0]] };
  const { agent, api } = await run(world, { cfg: config({ metrics: { prsOpened: true, prsMerged: false, commits: false, reviews: false, comments: false, issues: false } }) });
  assert.equal(agent.totals.prsOpened, 250);
  assert.deepEqual(api.searches.map((s) => s.after), [null, '100', '200']);
  assert.equal(api.searches.length, 3);
});

test('node(id) pagination collects reviews and comments beyond the first 100', async () => {
  const mk = (prefix, n, date) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, createdAt: `${date}T0${i % 10}:00:00Z`, author: botA }));
  const world = {
    reviews: [{ id: 'PR_big', updated: '2026-11-24', reviews: mk('rv', 250, '2026-11-20') }],
    comments: [{ id: 'IS_big', updated: '2026-11-24', comments: [...mk('cm', 130, '2026-11-19'), { id: 'cmx', createdAt: '2026-11-19T00:00:00Z', author: { __typename: 'User', login: 'h' } }] }]
  };
  const { agent, api } = await run(world, { cfg: config({ metrics: { prsOpened: false, prsMerged: false, commits: false, reviews: true, comments: true, issues: false } }) });
  assert.equal(agent.totals.reviews, 250);
  assert.equal(agent.totals.comments, 130);
  assert.deepEqual(api.nodeCalls, [
    { nodeId: 'PR_big', after: '100' }, { nodeId: 'PR_big', after: '200' }, { nodeId: 'IS_big', after: '100' }
  ]);
  const nodeQuery = api.calls.map((c) => c.body?.query).find((q) => q?.includes('node(id: $nodeId)'));
  assert.match(nodeQuery, /\$nodeId: ID!/);
});

test('created-window bisection splits when issueCount > 1000 without double counting', async () => {
  const prs = Array.from({ length: 1500 }, (_, i) => ({ id: `pr${i}`, createdAt: `${addDays(START, i % 360)}T12:00:00Z` }));
  const { agent, api } = await run({ prsOpened: prs }, { cfg: config({ metrics: { prsOpened: true, prsMerged: false, commits: false, reviews: false, comments: false, issues: false } }) });
  assert.equal(agent.totals.prsOpened, 1500);
  const windows = api.searches.map((s) => /created:(\S+)\.\.(\S+)/.exec(s.q).slice(1)).filter(([a, b], i, all) => all.findIndex(([x, y]) => x === a && y === b) === i);
  assert.deepEqual(windows[0], [START, END]);
  const mid = addDays(START, Math.floor((dayNumber(END) - dayNumber(START)) / 2));
  assert.deepEqual(windows[1], [START, mid]);
  assert.deepEqual(windows[2], [addDays(mid, 1), END]);
});

test('single-day results above 1000 are capped and reported with TRUNCATED_1000', async () => {
  const prs = Array.from({ length: 1200 }, (_, i) => ({ id: `pr${i}`, createdAt: '2026-11-20T09:00:00Z' }));
  const { agent, warnings } = await run({ prsOpened: prs }, { cfg: config({ metrics: { prsOpened: true, prsMerged: false, commits: false, reviews: false, comments: false, issues: false } }) });
  assert.equal(agent.days['2026-11-20'], 1000);
  assert.deepEqual(warnings, [{ code: 'TRUNCATED_1000', agent: SLUG, metric: 'prsOpened', date: '2026-11-20', detail: 'Single-day results capped at 1000' }]);
});

test('reviews/comments bisect up to max(utcToday, endDate) so --date in the past still sees later-edited PRs', async () => {
  const pastEnd = '2026-06-13';
  const { startDate } = computeWindow(52, pastEnd);
  const total = dayNumber(pastEnd) - dayNumber(startDate) + 1;
  // Plant > 1000 items updated AFTER pastEnd (2026-07-01..2026-11-24) so upper half past pastEnd must bisect too
  const lateUpdated = Array.from({ length: 1050 }, (_, i) => ({
    id: `pr_late_${i}`,
    updated: i < 525 ? '2026-08-15' : '2026-11-20',
    reviews: [{ id: `rv_late_${i}`, createdAt: `${addDays(startDate, i % total)}T10:00:00Z`, author: botA }]
  }));
  const earlyUpdated = Array.from({ length: 200 }, (_, i) => ({
    id: `pr_early_${i}`,
    updated: addDays(startDate, i % total),
    reviews: [{ id: `rv_early_${i}`, createdAt: `${addDays(startDate, i % total)}T10:00:00Z`, author: botA }]
  }));
  const reviews = [...earlyUpdated, ...lateUpdated];
  const { agent, api } = await run({ reviews }, { endDate: pastEnd, cfg: config({ metrics: { prsOpened: false, prsMerged: false, commits: false, reviews: true, comments: false, issues: false } }) });
  assert.equal(agent.totals.reviews, 1250);
  const queries = api.searches.map((s) => s.q);
  assert.ok(queries[0].endsWith(`updated:>=${startDate}`));
  const bounded = queries.map((q) => /updated:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(q)).filter(Boolean);
  assert.ok(bounded.length > 0, 'lower halves use closed ranges');
  for (const [, a, b] of bounded) assert.ok(a <= b, `inverted bounds ${a}..${b}`);
  assert.ok(bounded.some(([, , b]) => b > pastEnd), 'bisection splits across (pastEnd, utcToday]');
  assert.ok(queries.some((q) => /updated:>=\d{4}-\d{2}-\d{2}$/.test(q) && !q.endsWith(`updated:>=${startDate}`)), 'upper halves stay open-ended up to today');

  // Future endDate (> utcToday) uses endDate as bisect upper bound without inverted bounds
  const futureEnd = '2026-12-20';
  const futureWin = computeWindow(52, futureEnd);
  const futureReviews = Array.from({ length: 1100 }, (_, i) => ({
    id: `prf_${i}`,
    updated: i < 550 ? '2026-12-05' : '2026-12-18',
    reviews: [{ id: `rvf_${i}`, createdAt: '2026-12-05T10:00:00Z', author: botA }]
  }));
  const futureRes = await collectActivity({
    config: config({ metrics: { prsOpened: false, prsMerged: false, commits: false, reviews: true, comments: false, issues: false } }),
    endDate: futureEnd,
    token: 'ghp_collectTestToken123',
    fetchFn: createWorldApi({ reviews: futureReviews }).fetchFn,
    sleepFn: async () => {},
    nowFn: () => NOW
  });
  assert.equal(futureRes.counts.window.startDate, futureWin.startDate);
  assert.equal(futureRes.counts.agents[0].totals.reviews, 1100);
});

test('walkSearch and nestedBy reject cycling cursors and empty-page pagination loops', async () => {
  const runPrSearch = (fetchFn) => collectActivity({
    config: config({ metrics: { prsOpened: true, prsMerged: false, commits: false, reviews: false, comments: false, issues: false } }),
    endDate: END,
    token: 'ghp_collectTestToken123',
    fetchFn,
    sleepFn: async () => {},
    nowFn: () => NOW
  });

  // 1. Cycling non-empty search pages fail on page 3 via seenCursors (c1 -> c2 -> c1)
  let step = 0;
  const cyclicSearchApi = createMockApi({
    graphql: () => {
      step++;
      const cursor = step % 2 ? 'c1' : 'c2';
      return {
        data: {
          search: {
            issueCount: 10,
            pageInfo: { hasNextPage: true, endCursor: cursor },
            nodes: [{ id: `p_cyc_${step}`, createdAt: '2026-11-24T00:00:00Z', author: botA }]
          }
        }
      };
    }
  });
  await assert.rejects(() => runPrSearch(cyclicSearchApi.fetchFn), (e) => e?.code === 'GRAPHQL_ERROR');
  assert.equal(cyclicSearchApi.calls.length, 3);

  // 2. Empty search page with hasNextPage: true stops on page 1
  const emptySearchApi = createMockApi({
    graphql: () => ({ data: { search: { issueCount: 10, pageInfo: { hasNextPage: true, endCursor: 'c_empty' }, nodes: [] } } })
  });
  await assert.rejects(() => runPrSearch(emptySearchApi.fetchFn), (e) => e?.code === 'GRAPHQL_ERROR');
  assert.equal(emptySearchApi.calls.length, 1);

  // 3. Cycling node(id) pages fail within 4 calls via seenCursors (not pages > 100)
  let nodeStep = 0;
  const cyclicNodeApi = createMockApi({
    graphql: (q) => {
      if (q.includes('node(id: $nodeId)')) {
        nodeStep++;
        return {
          data: {
            node: {
              __typename: 'PullRequest',
              reviews: { pageInfo: { hasNextPage: true, endCursor: nodeStep % 2 ? 'nc1' : 'nc2' }, nodes: [{ id: `rv${nodeStep}`, createdAt: '2026-11-24T00:00:00Z', author: botA }] }
            }
          }
        };
      }
      return {
        data: {
          search: {
            issueCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{
              __typename: 'PullRequest',
              id: 'PR_loop',
              reviews: { pageInfo: { hasNextPage: true, endCursor: 'nc0' }, nodes: [{ id: 'rv0', createdAt: '2026-11-24T00:00:00Z', author: botA }] }
            }]
          }
        }
      };
    }
  });
  await assert.rejects(
    () => collectActivity({
      config: config({ metrics: { prsOpened: false, prsMerged: false, commits: false, reviews: true, comments: false, issues: false } }),
      endDate: END,
      token: 'ghp_collectTestToken123',
      fetchFn: cyclicNodeApi.fetchFn,
      sleepFn: async () => {},
      nowFn: () => NOW
    }),
    (e) => e?.code === 'GRAPHQL_ERROR'
  );
  assert.ok(cyclicNodeApi.calls.length <= 4, `expected seenCursors to break in <= 4 calls, got ${cyclicNodeApi.calls.length}`);

  // 4. Empty node(id) page with hasNextPage: true fails on first follow-up call
  const emptyNodeApi = createMockApi({
    graphql: (q) => {
      if (q.includes('node(id: $nodeId)')) {
        return { data: { node: { __typename: 'PullRequest', reviews: { pageInfo: { hasNextPage: true, endCursor: 'nc_next' }, nodes: [] } } } };
      }
      return {
        data: {
          search: {
            issueCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{
              __typename: 'PullRequest',
              id: 'PR_empty_node',
              reviews: { pageInfo: { hasNextPage: true, endCursor: 'nc_first' }, nodes: [{ id: 'rv_e', createdAt: '2026-11-24T00:00:00Z', author: botA }] }
            }]
          }
        }
      };
    }
  });
  await assert.rejects(
    () => collectActivity({
      config: config({ metrics: { prsOpened: false, prsMerged: false, commits: false, reviews: true, comments: false, issues: false } }),
      endDate: END,
      token: 'ghp_collectTestToken123',
      fetchFn: emptyNodeApi.fetchFn,
      sleepFn: async () => {},
      nowFn: () => NOW
    }),
    (e) => e?.code === 'GRAPHQL_ERROR'
  );
  assert.equal(emptyNodeApi.calls.length, 2);
});

test('REST commits: paginates with Link rel="next", clamps, and keeps >= 2100 ms between calls', async () => {
  const commits = Array.from({ length: 250 }, (_, i) => ({ sha: `s${i}`, date: '2026-11-20T10:00:00Z' }));
  const clock = createClock();
  const { agent, api } = await run({ commits }, { clock, cfg: config({ metrics: { prsOpened: false, prsMerged: false, commits: true, reviews: false, comments: false, issues: false } }) });
  assert.equal(agent.totals.commits, 250);
  assert.deepEqual(api.commitCalls.map((c) => c.page), [1, 2, 3]);
  const times = api.commitCalls.map((c) => c.at);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 2100, `gap ${times[i] - times[i - 1]}`);
});

test('REST pagination stops when the Link header lacks rel="next"', async () => {
  const commits = Array.from({ length: 250 }, (_, i) => ({ sha: `s${i}`, date: '2026-11-20T10:00:00Z' }));
  const api = createWorldApi({ commits });
  const fetchFn = async (url, init) => {
    const res = await api.fetchFn(url, init);
    if (!url.includes('/search/commits')) return res;
    return { ...res, headers: new Headers({ link: '<https://api.github.com/x>; rel="prev"' }), json: res.json };
  };
  const { counts } = await collectActivity({ config: config({ metrics: { prsOpened: false, prsMerged: false, commits: true, reviews: false, comments: false, issues: false } }), endDate: END, token: 'ghp_collectTestToken123', fetchFn, sleepFn: async () => {} });
  assert.equal(counts.agents[0].totals.commits, 100);
  assert.equal(api.commitCalls.length, 1);
});

test('REST bisects when total_count > 1000 or incomplete_results on a multi-day window', async () => {
  const commits = Array.from({ length: 1500 }, (_, i) => ({ sha: `s${i}`, date: `${addDays(START, i % 360)}T10:00:00Z` }));
  const only = { prsOpened: false, prsMerged: false, commits: true, reviews: false, comments: false, issues: false };
  const big = await run({ commits }, { cfg: config({ metrics: only }) });
  assert.equal(big.agent.totals.commits, 1500);
  assert.ok(big.api.commitCalls.some((c) => c.from < c.to && c.from !== START));

  const few = Array.from({ length: 20 }, (_, i) => ({ sha: `f${i}`, date: `${addDays(START, i * 7)}T10:00:00Z` }));
  const inc = await run({ commits: few, incomplete: (a, b) => dayNumber(b) - dayNumber(a) >= 90 }, { cfg: config({ metrics: only }) });
  assert.equal(inc.agent.totals.commits, 20);
  assert.deepEqual(inc.warnings, []);
  assert.ok(inc.api.commitCalls.length > 2);
});

test('single-day incomplete_results retries with 2s/4s/8s backoff then warns INCOMPLETE_RESULTS', async () => {
  const only = { prsOpened: false, prsMerged: false, commits: true, reviews: false, comments: false, issues: false };
  const commits = [{ sha: 'a', date: `${END}T10:00:00Z` }];
  const day = (a, b) => a === b && a === END;
  const recovers = await run({ commits, incomplete: (a, b, n) => (dayNumber(b) - dayNumber(a) >= 0 && (a !== b || (a === END && n < 2))) }, { cfg: config({ metrics: only }) });
  assert.equal(recovers.agent.totals.commits, 1);
  assert.deepEqual(recovers.warnings, []);
  assert.deepEqual(recovers.clock.sleeps.filter((ms) => ms === 2000 || ms === 4000 || ms === 8000), [2000, 4000]);

  const stuck = await run({ commits, incomplete: (a, b) => a !== b || day(a, b) }, { cfg: config({ metrics: only }) });
  assert.deepEqual(stuck.clock.sleeps.filter((ms) => [2000, 4000, 8000].includes(ms)).slice(-3), [2000, 4000, 8000]);
  assert.deepEqual(stuck.warnings, [{ code: 'INCOMPLETE_RESULTS', agent: SLUG, metric: 'commits', date: END, detail: 'GitHub reported incomplete search results' }]);
  assert.equal(stuck.agent.totals.commits, 1);
});

test('SCOPE_CAVEAT is emitted at most once per call, only for private runs whose scopes lack repo', async () => {
  const cfg = makeProfileAgentsConfig();
  const world = { ...baseWorld(), scopes: 'read:org, gist' };
  const multi = await run(world, { cfg, includePrivate: true });
  assert.equal(multi.counts.agents.length, 3);
  assert.deepEqual(multi.warnings, [{ code: 'SCOPE_CAVEAT', agent: null, metric: null, detail: 'Token may lack repo scope; fine-grained PATs omit scope headers' }]);

  assert.deepEqual((await run({ ...baseWorld(), scopes: 'repo, read:org' }, { includePrivate: true })).warnings, []);
  assert.deepEqual((await run(world, { includePrivate: false })).warnings, []);
  assert.deepEqual((await run(baseWorld(), { includePrivate: true })).warnings, [], 'absent header (fine-grained PAT) is not flagged');
});

test('generatedAt: deterministic with endDate, from the clock without it; zero-activity window is valid', async () => {
  const { counts } = await run({});
  assert.equal(counts.generatedAt, '2026-11-24T00:00:00Z');
  assert.deepEqual(counts.agents[0].streaks, { current: 0, best: 0 });
  const api = createWorldApi({});
  const clock = createClock(Date.parse('2026-11-24T18:30:45.123Z'));
  const live = await collectActivity({ config: config(), token: 'ghp_collectTestToken123', fetchFn: api.fetchFn, sleepFn: clock.sleepFn, nowFn: clock.nowFn });
  assert.equal(live.counts.generatedAt, '2026-11-24T18:30:45Z');
  assert.equal(live.counts.window.endDate, '2026-11-24');
});

test('token errors propagate typed (401 -> AuthError exit 3)', async () => {
  const api = createMockApi({ graphql: () => reply({ message: 'Bad credentials' }, { status: 401 }) });
  await assert.rejects(() => collectActivity({ config: config(), endDate: END, token: 'ghp_collectTestToken123', fetchFn: api.fetchFn }), (e) => e.exitCode === 3);
  await assert.rejects(() => collectActivity({ config: config(), endDate: END }), (e) => e.exitCode === 3);
});

test('perf budget: mocked 12-agent / 52w run finishes in <= 500 ms and <= 128 MB RSS', async () => {
  const cfg = config();
  cfg.agents = Array.from({ length: 12 }, (_, i) => ({ slug: `agent-${i}[bot]`, label: `Agent ${i}`, ramp: 'emerald' }));
  const world = (base) => {
    const bot = { __typename: 'Bot', login: base };
    const day = (i) => addDays(START, (i * 7) % 360);
    return {
      prsOpened: Array.from({ length: 150 }, (_, i) => ({ id: `${base}-p${i}`, createdAt: `${day(i)}T10:00:00Z` })),
      prsMerged: Array.from({ length: 100 }, (_, i) => ({ id: `${base}-m${i}`, mergedAt: `${day(i)}T10:00:00Z` })),
      issues: Array.from({ length: 50 }, (_, i) => ({ id: `${base}-i${i}`, createdAt: `${day(i)}T10:00:00Z` })),
      reviews: Array.from({ length: 100 }, (_, i) => ({ id: `${base}-r${i}`, updated: day(i), reviews: [{ id: `${base}-rv${i}`, createdAt: `${day(i)}T10:00:00Z`, author: bot }] })),
      comments: Array.from({ length: 100 }, (_, i) => ({ id: `${base}-c${i}`, updated: day(i), comments: [{ id: `${base}-cm${i}`, createdAt: `${day(i)}T10:00:00Z`, author: bot }] })),
      commits: Array.from({ length: 150 }, (_, i) => ({ sha: `${base}-s${i}`, date: `${day(i)}T10:00:00Z` }))
    };
  };
  const clock = createClock(NOW);
  const api = createWorldApi(world, { clock });
  const started = performance.now();
  const { counts } = await collectActivity({ config: cfg, endDate: END, token: 'ghp_collectTestToken123', fetchFn: api.fetchFn, sleepFn: clock.sleepFn, nowFn: clock.nowFn });
  const elapsed = performance.now() - started;
  assert.equal(counts.agents.length, 12);
  assert.equal(counts.agents[0].totals.total, 650);
  assert.ok(elapsed <= 500, `elapsed ${elapsed.toFixed(0)} ms`);
  assert.ok(process.memoryUsage().rss <= 128 * 1024 * 1024, `rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
});
