import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthError } from '../../src/collector/auth.mjs';
import { ValidationError } from '../../src/collector/config.mjs';
import { discoverBots, validateBotSlug } from '../../src/collector/discover.mjs';
import { CANARY_STRINGS, makeDiscoverPage } from '../fixtures/github-mocks.mjs';
import { createMockApi, reply } from './mock-api.mjs';

const bot = (login) => ({ __typename: 'Bot', login });
const user = (login) => ({ __typename: 'User', login });
const issue = (author, comments = []) => ({ __typename: 'Issue', author, comments: { nodes: comments.map((a) => ({ author: a })) } });
const pr = (author, reviews = [], comments = []) => ({
  __typename: 'PullRequest',
  author,
  reviews: { nodes: reviews.map((a) => ({ author: a })) },
  comments: { nodes: comments.map((a) => ({ author: a })) }
});
const base = { owner: 'mephistopheles4', scopeType: 'user', token: 'ghp_discoverTestToken123456', endDate: '2026-11-24' };
const invalidInputs = [
  { owner: 'bad owner' }, { owner: undefined }, { scopeType: 'team' }, { scopeType: undefined }, { includePrivate: 'yes' }, { includePrivate: 1 }, { includePrivate: null },
  { windowWeeks: 30 }, { windowWeeks: '52' }, { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: '5' }, { endDate: '2026-02-30' }
];

test('discoverBots builds the exact bound query, tallies Bot actors and sorts by estimate then slug', async () => {
  const api = createMockApi({
    graphql: () => makeDiscoverPage({
      nodes: [
        issue(bot('dependabot'), [bot('renovate'), user('human'), user('spoof[bot]'), null]),
        pr(bot('renovate'), [bot('dependabot'), bot('alpha[bot]')], [user('x'), bot('dependabot')]),
        pr(user('human'), [bot('alpha[bot]')], []),
        pr(bot('bad_name'), [], [{ author: null }]),
        null,
        { __typename: 'Issue' }
      ]
    })
  });
  const items = await discoverBots({ ...base, fetchFn: api.fetchFn });
  assert.deepEqual(items, [
    { slug: 'dependabot[bot]', eventEstimate: 3 },
    { slug: 'alpha[bot]', eventEstimate: 2 },
    { slug: 'renovate[bot]', eventEstimate: 2 }
  ]);
  assert.equal(api.calls.length, 1);
  const { query, variables } = api.calls[0].body;
  assert.deepEqual(variables, { q: 'user:mephistopheles4 updated:>=2025-11-30 is:public sort:updated-desc', after: null });
  assert.match(query, /\$q: String!/);
  assert.match(query, /\$after: String/);
  assert.match(query, /\.\.\. on Issue/);
  assert.match(query, /\.\.\. on PullRequest/);
  assert.match(query, /first: 100/);
  assert.ok(!query.includes('mephistopheles4'), 'owner is bound via the variable, never interpolated');
});

test('includePrivate === true omits is:public; org scope and 26w window are honored', async () => {
  const api = createMockApi({ graphql: () => makeDiscoverPage() });
  await discoverBots({ ...base, scopeType: 'org', includePrivate: true, windowWeeks: 26, fetchFn: api.fetchFn });
  assert.equal(api.calls[0].body.variables.q, 'org:mephistopheles4 updated:>=2026-05-31 sort:updated-desc');
});

test('paginates with $after for at most 3 pages and truncates to limit', async () => {
  let page = 0;
  const api = createMockApi({
    graphql: (_q, vars) => {
      page += 1;
      assert.equal(vars.after, page === 1 ? null : `c${page - 1}`);
      return makeDiscoverPage({ nodes: [issue(bot(`bot${page}`), [bot('shared')])], hasNextPage: true, endCursor: `c${page}` });
    }
  });
  const items = await discoverBots({ ...base, limit: 2, fetchFn: api.fetchFn });
  assert.equal(api.calls.length, 3);
  assert.deepEqual(items[0], { slug: 'shared[bot]', eventEstimate: 3 });
  assert.equal(items.length, 2);

  const stop = createMockApi({ graphql: () => makeDiscoverPage({ nodes: [], hasNextPage: false }) });
  await discoverBots({ ...base, fetchFn: stop.fetchFn });
  assert.equal(stop.calls.length, 1);
});

test('invalid inputs throw ValidationError before any network call', async () => {
  const api = createMockApi({ graphql: () => makeDiscoverPage() });
  for (const override of invalidInputs) {
    await assert.rejects(() => discoverBots({ ...base, ...override, fetchFn: api.fetchFn }), ValidationError, JSON.stringify(override));
  }
  assert.equal(api.calls.length, 0);
});

test('missing token is AUTH_REQUIRED; 401 maps to AuthError; no repo data can leak into results', async () => {
  await assert.rejects(() => discoverBots({ ...base, token: undefined }), (e) => e instanceof AuthError && e.exitCode === 3);
  const unauthorized = createMockApi({ graphql: () => reply({ message: 'Bad credentials' }, { status: 401 }) });
  await assert.rejects(() => discoverBots({ ...base, fetchFn: unauthorized.fetchFn }), AuthError);

  const leaky = createMockApi({
    graphql: () => makeDiscoverPage({ nodes: [{ ...issue(bot('a'), []), title: CANARY_STRINGS.prTitle, url: CANARY_STRINGS.url, repository: { name: CANARY_STRINGS.repoName } }] })
  });
  const items = await discoverBots({ ...base, fetchFn: leaky.fetchFn });
  assert.deepEqual(items, [{ slug: 'a[bot]', eventEstimate: 1 }]);
  assert.ok(!JSON.stringify(items).includes('canary'));
});

test('malformed search payloads fail with a typed error', async () => {
  const api = createMockApi({ graphql: () => ({ data: { search: null } }) });
  await assert.rejects(() => discoverBots({ ...base, fetchFn: api.fetchFn }), (e) => e.code === 'GRAPHQL_ERROR');
});

test('validateBotSlug rejects malformed slugs pre-network', async () => {
  const api = createMockApi({ user: () => ({ type: 'Bot' }) });
  for (const slug of ['plain', 'a[bot', '-a[bot]', 'a/b[bot]', '', undefined, 42, '../x[bot]', 'a[bot]/x']) {
    assert.deepEqual(await validateBotSlug(slug, { token: 'ghp_x123456', fetchFn: api.fetchFn }), { valid: false, slug });
  }
  assert.equal(api.calls.length, 0);
});

test('validateBotSlug maps 404 -> invalid, Bot -> valid (canonical login), non-Bot -> invalid, 401 -> AuthError', async () => {
  const slug = 'mephistos-homunculus[bot]';
  const run = (handler) => createMockApi({ user: handler });
  const notFound = run(() => reply({ message: 'Not Found' }, { status: 404 }));
  assert.deepEqual(await validateBotSlug(slug, { token: 'ghp_x123456', fetchFn: notFound.fetchFn }), { valid: false, slug });
  assert.equal(notFound.calls[0].url, `https://api.github.com/users/${encodeURIComponent(slug)}`);

  const isBot = run(() => ({ type: 'Bot', login: 'Mephistos-Homunculus[bot]' }));
  assert.deepEqual(await validateBotSlug(slug, { token: 'ghp_x123456', fetchFn: isBot.fetchFn }), { valid: true, slug: 'Mephistos-Homunculus[bot]' });

  const noLogin = run(() => ({ type: 'Bot', login: 'bad login' }));
  assert.deepEqual(await validateBotSlug(slug, { token: 'ghp_x123456', fetchFn: noLogin.fetchFn }), { valid: true, slug });

  const human = run(() => ({ type: 'User', login: 'someone' }));
  assert.deepEqual(await validateBotSlug(slug, { token: 'ghp_x123456', fetchFn: human.fetchFn }), { valid: false, slug });

  const unauthorized = run(() => reply({}, { status: 401 }));
  await assert.rejects(() => validateBotSlug(slug, { token: 'ghp_x123456', fetchFn: unauthorized.fetchFn }), AuthError);
  await assert.rejects(() => validateBotSlug(slug, { token: undefined }), AuthError);
});
