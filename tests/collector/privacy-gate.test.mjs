import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../../src/collector/config.mjs';
import { PrivacyGateError, assertStrictCountsOnly, assertValidDiscoverResult, redactSecrets } from '../../src/collector/privacy-gate.mjs';
import { CANARY_STRINGS } from '../fixtures/github-mocks.mjs';

function makeCounts() {
  const days = {};
  for (let d = '2025-11-30'; d <= '2026-11-24'; d = addDays(d, 1)) days[d] = 0;
  days['2026-11-23'] = 2;
  days['2026-11-24'] = 3;
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-24T00:00:00Z',
    window: { weeks: 52, startDate: '2025-11-30', endDate: '2026-11-24' },
    scope: { mode: 'public' },
    agents: [{
      slug: 'mephistos-homunculus[bot]',
      label: 'Homunculus',
      ramp: 'emerald',
      source: 'github',
      totals: { prsOpened: 2, prsMerged: 1, commits: 2, reviews: 0, comments: 0, issues: 0, total: 5 },
      streaks: { current: 2, best: 2 },
      days
    }]
  };
}
const rejects = (fn) => assert.throws(fn, (e) => e instanceof PrivacyGateError);
const mutated = (fn) => {
  const counts = makeCounts();
  fn(counts);
  return counts;
};

test('redactSecrets scrubs the active token, Bearer values and GitHub token prefixes', () => {
  const out = redactSecrets(`failed Authorization: Bearer abc.def-123 token=${CANARY_STRINGS.token} ghs_AbCdEf123 gho_x1 ghu_y2 ghr_z3 github_pat_11AAA_bbb`, CANARY_STRINGS.token);
  for (const secret of [CANARY_STRINGS.token, 'abc.def-123', 'ghs_AbCdEf123', 'gho_x1', 'ghu_y2', 'ghr_z3', 'github_pat_11AAA_bbb']) assert.ok(!out.includes(secret), secret);
  assert.ok(out.includes('[REDACTED]'));
  assert.equal(redactSecrets('plain text', 'x'), 'plain text');
  assert.equal(redactSecrets('has abc in it', 'abc'), 'has abc in it', 'tokens shorter than 6 chars are not scrubbed');
  assert.equal(redactSecrets('a.b*c+d?e', 'a.b*c+d?e'), '[REDACTED]', 'token is matched literally, not as a regex');
  assert.equal(redactSecrets(undefined), '');
});

test('assertValidDiscoverResult enforces the closed { slug, eventEstimate } shape', () => {
  const ok = [{ slug: 'a[bot]', eventEstimate: 3 }];
  assert.equal(assertValidDiscoverResult(ok), ok);
  assert.deepEqual(assertValidDiscoverResult([]), []);
  for (const bad of [
    'x', null, [{ slug: 'a[bot]' }], [{ eventEstimate: 1 }], [{ slug: 'a[bot]', eventEstimate: 1, repo: CANARY_STRINGS.repoName }],
    [{ slug: 'a', eventEstimate: 1 }], [{ slug: 'a[bot]', eventEstimate: 0 }], [{ slug: 'a[bot]', eventEstimate: -1 }],
    [{ slug: 'a[bot]', eventEstimate: 1.5 }], [{ slug: 'a[bot]', eventEstimate: Number.MAX_SAFE_INTEGER + 1 }], [{ slug: 'a[bot]', eventEstimate: '3' }], [null]
  ]) {
    rejects(() => assertValidDiscoverResult(bad));
  }
});

test('assertStrictCountsOnly accepts a valid document and returns it', () => {
  const counts = makeCounts();
  assert.equal(assertStrictCountsOnly(counts), counts);
  assertStrictCountsOnly(mutated((c) => { c.scope.mode = 'public+private'; }));
  assertStrictCountsOnly(mutated((c) => { c.agents[0].label = "Example's Bot 🚀"; }));
});

test('assertStrictCountsOnly rejects unexpected or missing keys at every level', () => {
  const mutations = [
    (c) => { c.extra = 1; },
    (c) => { c.window.extra = 1; },
    (c) => { c.scope.extra = 1; },
    (c) => { c.agents[0].repo = CANARY_STRINGS.repoName; },
    (c) => { c.agents[0].totals.extra = 1; },
    (c) => { c.agents[0].streaks.extra = 1; },
    (c) => { c.agents[0].days['2026-11-24x'] = 1; },
    (c) => { delete c.agents[0].source; },
    (c) => { delete c.agents[0].totals.issues; },
    (c) => { delete c.generatedAt; },
    (c) => { c.agents[0].url = CANARY_STRINGS.url; }
  ];
  for (const m of mutations) rejects(() => assertStrictCountsOnly(mutated(m)));
});

test('assertStrictCountsOnly validates scalars, window, agents, totals, streaks and days', () => {
  const mutations = [
    (c) => { c.schemaVersion = 2; },
    (c) => { c.generatedAt = '2026-11-24T00:00:00.000Z'; },
    (c) => { c.generatedAt = '2026-11-24T00:00:00+00:00'; },
    (c) => { c.generatedAt = '2026-13-24T00:00:00Z'; },
    (c) => { c.generatedAt = '2026-11-24T25:00:00Z'; },
    (c) => { c.window.weeks = 30; },
    (c) => { c.window.weeks = 26; },
    (c) => { c.window.startDate = '2025-12-01'; },
    (c) => { c.window.endDate = '2026-11-25'; },
    (c) => { c.window.endDate = '2026-02-30'; },
    (c) => { c.scope.mode = 'private'; },
    (c) => { c.agents = []; },
    (c) => { c.agents = Array.from({ length: 13 }, (_, i) => ({ ...structuredClone(c.agents[0]), slug: `b${i}[bot]` })); },
    (c) => { c.agents.push(structuredClone(c.agents[0])); c.agents[1].slug = 'MEPHISTOS-HOMUNCULUS[BOT]'; },
    (c) => { c.agents[0].slug = 'nobot'; },
    (c) => { c.agents[0].label = 'a\u202Eb'; },
    (c) => { c.agents[0].label = ''; },
    (c) => { c.agents[0].ramp = 'pink'; },
    (c) => { c.agents[0].source = 'linear'; },
    (c) => { c.agents[0].totals.commits = -1; },
    (c) => { c.agents[0].totals.commits = 1.5; },
    (c) => { c.agents[0].totals.commits = Number.MAX_SAFE_INTEGER + 1; },
    (c) => { c.agents[0].totals.commits = '2'; },
    (c) => { c.agents[0].totals.total = 6; },
    (c) => { c.agents[0].streaks.current = 3; c.agents[0].streaks.best = 2; },
    (c) => { c.agents[0].streaks.best = -1; },
    (c) => { delete c.agents[0].days['2026-11-24']; },
    (c) => { delete c.agents[0].days['2025-11-30']; c.agents[0].days['2025-11-29'] = 0; },
    (c) => { c.agents[0].days['2026-11-24'] = -3; c.agents[0].totals.total = 0; },
    (c) => { c.agents[0].days['2026-11-24'] = 3.5; },
    (c) => { c.agents[0].days['2026-11-24'] = '3'; }
  ];
  for (const m of mutations) rejects(() => assertStrictCountsOnly(mutated(m)));
  for (const bad of [null, undefined, [], 'x', 5]) rejects(() => assertStrictCountsOnly(bad));
});

test('assertStrictCountsOnly accepts a 26-week window and does not echo offending values', () => {
  const days = {};
  for (let d = '2026-05-31'; d <= '2026-11-24'; d = addDays(d, 1)) days[d] = 0;
  const counts = makeCounts();
  counts.window = { weeks: 26, startDate: '2026-05-31', endDate: '2026-11-24' };
  counts.agents[0].days = days;
  counts.agents[0].totals = { prsOpened: 0, prsMerged: 0, commits: 0, reviews: 0, comments: 0, issues: 0, total: 0 };
  counts.agents[0].streaks = { current: 0, best: 0 };
  assertStrictCountsOnly(counts);

  const leaky = makeCounts();
  leaky.agents[0].label = `${CANARY_STRINGS.repoName}\u0000`;
  try {
    assertStrictCountsOnly(leaky);
    assert.fail('expected rejection');
  } catch (err) {
    assert.ok(err instanceof PrivacyGateError);
    assert.ok(!err.message.includes(CANARY_STRINGS.repoName));
  }
});
