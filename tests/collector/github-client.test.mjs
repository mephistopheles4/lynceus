import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthError } from '../../src/collector/auth.mjs';
import { ApiError, createGitHubClient } from '../../src/collector/github-client.mjs';
import { CANARY_STRINGS, makeJsonResponse } from '../fixtures/github-mocks.mjs';
import { createClock } from './mock-api.mjs';

const TOKEN = CANARY_STRINGS.token;

/** Client whose fetch replays `responses` (a response, or a function) in order. */
function setup(responses, options = {}) {
  const clock = createClock();
  const calls = [];
  const queue = [...responses];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, at: clock.time });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const out = typeof next === 'function' ? next() : next;
    if (out instanceof Error) throw out;
    return out;
  };
  const client = createGitHubClient({ token: TOKEN, fetchFn, sleepFn: clock.sleepFn, nowFn: clock.nowFn, ...options });
  return { client, calls, clock };
}
const ok = (body = { data: { search: {} } }, headers = {}) => makeJsonResponse(body, { headers });
const status = (code, headers = {}, body = { message: `${CANARY_STRINGS.repoName} ${CANARY_STRINGS.url}` }) => makeJsonResponse(body, { status: code, headers });
const noLeak = (err) => {
  const dump = [err.message, err.stack, String(err.cause ?? ''), JSON.stringify(err), Object.values(err).join('|')].join('\n');
  for (const canary of Object.values(CANARY_STRINGS)) assert.ok(!dump.includes(canary), `leaked ${canary}`);
  assert.equal(err.cause, undefined);
};

test('requires a clean token', () => {
  assert.throws(() => createGitHubClient({ token: '' }), AuthError);
  assert.throws(() => createGitHubClient({}), AuthError);
  assert.throws(() => createGitHubClient({ token: 'abc\ndef' }), AuthError);
});

test('sends the required options and headers to the exact allowlisted URLs', async () => {
  const { client, calls } = setup([ok({ data: { x: 1 } }), ok({ items: [] }, { link: '<u>; rel="next"' }), ok({ login: 'a[bot]' })]);
  const gql = await client.graphql('query Q($q: String!) { x }', { q: 'is:pr' });
  assert.deepEqual(gql.data, { x: 1 });
  const rest = await client.searchCommits({ q: 'author:a[bot] user:o', per_page: '100', page: '1' });
  assert.equal(rest.link, '<u>; rel="next"');
  const user = await client.getUser('a[bot]');
  assert.deepEqual(user, { status: 200, data: { login: 'a[bot]' } });

  assert.equal(calls[0].url, 'https://api.github.com/graphql');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'query Q($q: String!) { x }', variables: { q: 'is:pr' } });
  const url = new URL(calls[1].url);
  assert.equal(url.origin + url.pathname, 'https://api.github.com/search/commits');
  assert.equal(url.searchParams.get('q'), 'author:a[bot] user:o');
  assert.equal(calls[2].url, `https://api.github.com/users/${encodeURIComponent('a[bot]')}`);
  for (const call of calls) {
    assert.equal(call.init.redirect, 'error');
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.init.headers['User-Agent'], 'lynceus/1.0');
    assert.equal(call.init.headers.Accept, 'application/vnd.github+json');
    assert.equal(call.init.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  }
});

test('users lookup refuses slugs that would escape the /users/<slug> path', async () => {
  const { client, calls } = setup([ok({})]);
  for (const slug of ['..', '.', 'a/b', '', '../graphql']) await assert.rejects(() => client.getUser(slug), ApiError);
  assert.equal(calls.length, 0);
});

test('getUser maps 404 to { status: 404 }, 401 to AuthError', async () => {
  assert.deepEqual(await setup([status(404)]).client.getUser('a[bot]'), { status: 404, data: null });
  await assert.rejects(() => setup([status(401)]).client.getUser('a[bot]'), (e) => e instanceof AuthError && e.exitCode === 3);
  await assert.rejects(() => setup([status(404)]).client.graphql('q', {}), (e) => e.code === 'API_NOT_FOUND' && e.exitCode === 4);
});

test('HTTP 401 maps to AuthError (AUTH_REQUIRED, exit 3) without retry or leaks', async () => {
  const { client, calls } = setup([status(401)]);
  await assert.rejects(() => client.graphql('q', {}), (e) => {
    noLeak(e);
    return e instanceof AuthError && e.code === 'AUTH_REQUIRED' && e.exitCode === 3;
  });
  assert.equal(calls.length, 1);
});

test('GraphQL errors: UNAUTHORIZED -> AuthError(3), others -> ApiError GRAPHQL_ERROR(4) with no message/path leak', async () => {
  const unauthorized = { errors: [{ type: 'UNAUTHORIZED', message: CANARY_STRINGS.repoName }] };
  await assert.rejects(() => setup([ok(unauthorized)]).client.graphql('q', {}), (e) => {
    noLeak(e);
    return e instanceof AuthError && e.exitCode === 3;
  });
  const other = { data: null, errors: [{ type: 'NOT_FOUND', path: ['repository', CANARY_STRINGS.repoName], message: `Could not resolve ${CANARY_STRINGS.url}` }] };
  await assert.rejects(() => setup([ok(other)]).client.graphql('q', {}), (e) => {
    noLeak(e);
    return e instanceof ApiError && e.code === 'GRAPHQL_ERROR' && e.exitCode === 4;
  });
  await assert.rejects(() => setup([ok({ data: null })]).client.graphql('q', {}), (e) => e.code === 'GRAPHQL_ERROR');
  await assert.rejects(() => setup([ok({ errors: 'boom', data: {} })]).client.graphql('q', {}), (e) => e.code === 'GRAPHQL_ERROR');
  assert.deepEqual((await setup([ok({ data: { a: 1 }, errors: [] })]).client.graphql('q', {})).data, { a: 1 });
});

test('403 with X-GitHub-SSO fails immediately with zero retries and never exposes the header', async () => {
  const sso = `required; url=https://github.com/orgs/${CANARY_STRINGS.ssoSlug}/sso?authorization_request=abc`;
  const { client, calls, clock } = setup([status(403, { 'x-github-sso': sso })]);
  await assert.rejects(() => client.graphql('q', {}), (e) => {
    noLeak(e);
    assert.ok(!e.message.includes('required;'));
    return e instanceof ApiError && e.code === 'AUTH_FORBIDDEN' && e.exitCode === 4 && e.status === 403;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(clock.sleeps, []);

  // The header value must not be read at all (only `has` is allowed).
  const headers = { has: (n) => n === 'x-github-sso', get: (n) => { assert.notEqual(n, 'x-github-sso'); return null; } };
  const guarded = createGitHubClient({ token: TOKEN, fetchFn: async () => ({ ok: false, status: 403, headers }), sleepFn: async () => {} });
  await assert.rejects(() => guarded.graphql('q', {}), (e) => e.code === 'AUTH_FORBIDDEN');
});

test('Retry-After <= 60 s waits then retries; > 60 s aborts with API_RATE_LIMIT', async () => {
  const { client, calls, clock } = setup([status(429, { 'retry-after': '7' }), status(403, { 'retry-after': '60' }), ok()]);
  await client.graphql('q', {});
  assert.equal(calls.length, 3);
  assert.deepEqual(clock.sleeps, [7000, 60_000]);

  const slow = setup([status(429, { 'retry-after': '61' }), ok()]);
  await assert.rejects(() => slow.client.graphql('q', {}), (e) => {
    noLeak(e);
    return e.code === 'API_RATE_LIMIT' && e.exitCode === 4;
  });
  assert.equal(slow.calls.length, 1);
  assert.deepEqual(slow.clock.sleeps, []);
});

test('x-ratelimit-reset (remaining 0) waits until reset when <= 60 s, aborts when later', async () => {
  const nowSec = Math.floor(Date.parse('2026-11-24T12:00:00Z') / 1000);
  const soon = setup([status(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(nowSec + 30) }), ok()]);
  await soon.client.graphql('q', {});
  assert.deepEqual(soon.clock.sleeps, [30_000]);

  const late = setup([status(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(nowSec + 3600) }), ok()]);
  await assert.rejects(() => late.client.graphql('q', {}), (e) => e.code === 'API_RATE_LIMIT');
  assert.equal(late.calls.length, 1);
});

test('transient 403/429/502/503 back off 2s/4s/8s for at most 3 retries then fail typed', async () => {
  for (const [code, expected] of [[403, 'API_FORBIDDEN'], [429, 'API_ERROR'], [502, 'API_ERROR'], [503, 'API_ERROR']]) {
    const { client, calls, clock } = setup([status(code)]);
    await assert.rejects(() => client.graphql('q', {}), (e) => {
      noLeak(e);
      return e.code === expected && e.exitCode === 4 && e.status === code;
    });
    assert.equal(calls.length, 4, `HTTP ${code}`);
    assert.deepEqual(clock.sleeps, [2000, 4000, 8000]);
  }
  const recovers = setup([status(503), status(502), ok({ data: { a: 1 } })]);
  assert.deepEqual((await recovers.client.graphql('q', {})).data, { a: 1 });
  assert.deepEqual(recovers.clock.sleeps, [2000, 4000]);
});

test('other 4xx/5xx statuses fail immediately without reading the body', async () => {
  let bodyRead = false;
  const res = { ok: false, status: 500, headers: new Headers(), json: async () => { bodyRead = true; return {}; }, text: async () => { bodyRead = true; return ''; } };
  const { client, calls } = setup([res]);
  await assert.rejects(() => client.graphql('q', {}), (e) => e.code === 'API_ERROR' && e.status === 500);
  assert.equal(calls.length, 1);
  assert.equal(bodyRead, false);
  await assert.rejects(() => setup([status(422)]).client.graphql('q', {}), (e) => e.code === 'API_ERROR');
});

test('timeouts and network errors map to typed errors and never expose cause or token', async () => {
  const timeout = Object.assign(new Error(`timed out ${TOKEN}`), { name: 'TimeoutError', cause: new Error(CANARY_STRINGS.url) });
  await assert.rejects(() => setup([timeout]).client.graphql('q', {}), (e) => {
    noLeak(e);
    return e.code === 'API_TIMEOUT' && e.exitCode === 4;
  });
  const network = new TypeError('fetch failed', { cause: new Error(`ECONNRESET ${TOKEN} ${CANARY_STRINGS.repoName}`) });
  await assert.rejects(() => setup([network]).client.graphql('q', {}), (e) => {
    noLeak(e);
    return e.code === 'API_ERROR';
  });
});

test('invalid JSON bodies surface as a typed error', async () => {
  const bad = { ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError(`Unexpected ${CANARY_STRINGS.repoName}`); } };
  await assert.rejects(() => setup([bad]).client.graphql('q', {}), (e) => {
    noLeak(e);
    return e.code === 'API_ERROR';
  });
});

test('serialized REST search queue keeps >= 2100 ms between /search/commits calls (even concurrent)', async () => {
  const { client, calls } = setup([ok({ items: [] })]);
  await Promise.all([1, 2, 3, 4].map((page) => client.searchCommits({ q: 'x', page: String(page) })));
  const times = calls.map((c) => c.at);
  assert.equal(times.length, 4);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 2100, `gap ${times[i] - times[i - 1]}`);
  const pages = calls.map((c) => new URL(c.url).searchParams.get('page'));
  assert.deepEqual(pages, ['1', '2', '3', '4']);

  const custom = setup([ok({ items: [] })], { minRestIntervalMs: 500 });
  await custom.client.searchCommits({ q: 'x' });
  await custom.client.searchCommits({ q: 'x' });
  assert.equal(custom.calls[1].at - custom.calls[0].at, 500);
});

test('GraphQL calls are not paced by the REST queue', async () => {
  const { client, clock } = setup([ok({ data: { a: 1 } })]);
  await client.graphql('q', {});
  await client.graphql('q', {});
  assert.deepEqual(clock.sleeps, []);
});

test('retried REST calls also respect the pacing gap', async () => {
  const { client, calls } = setup([status(502), ok({ items: [] })]);
  await client.searchCommits({ q: 'x' });
  assert.ok(calls[1].at - calls[0].at >= 2100);
});
