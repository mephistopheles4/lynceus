import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveToken } from '../../src/collector/auth.mjs';
import { collectActivity } from '../../src/collector/collect.mjs';
import { discoverBots } from '../../src/collector/discover.mjs';
import { redactSecrets } from '../../src/collector/privacy-gate.mjs';
import { CANARY_STRINGS, makeDiscoverPage, makeJsonResponse, makeProfileAgentsConfig } from '../fixtures/github-mocks.mjs';
import { createClock, createMockApi, createWorldApi } from './mock-api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '../../src/collector');
const ONLY_ALL = { prsOpened: true, prsMerged: true, commits: true, reviews: true, comments: true, issues: true };
const bot = { __typename: 'Bot', login: 'mephistos-homunculus' };

const dumpOf = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
function assertNoCanary(value, label) {
  const text = dumpOf(value);
  for (const [name, canary] of Object.entries(CANARY_STRINGS)) assert.ok(!text.includes(canary), `${label} leaked canary ${name}`);
}
function errorDump(err) {
  return [err.message, err.stack, String(err.cause), dumpOf({ ...err }), Object.getOwnPropertyNames(err).join()].join('\n');
}
function config(overrides = {}) {
  const cfg = makeProfileAgentsConfig();
  cfg.agents = [cfg.agents[0]];
  cfg.metrics = ONLY_ALL;
  return { ...cfg, ...overrides };
}
const canaryExtras = { title: CANARY_STRINGS.prTitle, url: CANARY_STRINGS.url, html_url: CANARY_STRINGS.url, repository: { name: CANARY_STRINGS.repoName, full_name: `canary-org/${CANARY_STRINGS.repoName}` }, email: 'secret@canary.example' };

test('C4: canary repo names, titles, URLs, node IDs and SHAs never reach counts.json or warnings', async () => {
  const world = {
    scopes: 'read:org',
    prsOpened: [{ id: CANARY_STRINGS.nodeId, createdAt: '2026-11-24T01:00:00Z', ...canaryExtras }],
    prsMerged: [{ id: `${CANARY_STRINGS.nodeId}-m`, mergedAt: '2026-11-23T01:00:00Z', ...canaryExtras }],
    issues: [{ id: `${CANARY_STRINGS.nodeId}-i`, createdAt: '2026-11-22T01:00:00Z', ...canaryExtras }],
    reviews: [{ id: `${CANARY_STRINGS.nodeId}-r`, updated: '2026-11-24', ...canaryExtras, reviews: [{ id: `${CANARY_STRINGS.nodeId}-rv`, createdAt: '2026-11-21T01:00:00Z', author: bot, body: CANARY_STRINGS.prTitle }] }],
    comments: [{ id: `${CANARY_STRINGS.nodeId}-c`, updated: '2026-11-24', ...canaryExtras, comments: [{ id: `${CANARY_STRINGS.nodeId}-cm`, createdAt: '2026-11-20T01:00:00Z', author: bot, body: CANARY_STRINGS.url }] }],
    commits: [{ sha: CANARY_STRINGS.sha, date: '2026-11-24T02:00:00Z', ...canaryExtras }]
  };
  const clock = createClock();
  const api = createWorldApi(world, { clock });
  const { counts, warnings } = await collectActivity({ config: config(), includePrivate: true, endDate: '2026-11-24', token: CANARY_STRINGS.token, fetchFn: api.fetchFn, sleepFn: clock.sleepFn, nowFn: clock.nowFn });
  assert.equal(counts.agents[0].totals.total, 6);
  assert.equal(warnings.length, 1);
  assertNoCanary(counts, 'counts.json');
  assertNoCanary(warnings, 'warnings');
  assert.ok(!JSON.stringify(counts).includes('secret@canary.example'));
  assert.deepEqual(Object.keys(counts).sort(), ['agents', 'generatedAt', 'schemaVersion', 'scope', 'window']);
});

test('C4: discover results never carry repo data even when nodes are laden with it', async () => {
  const api = createMockApi({
    graphql: () => makeDiscoverPage({ nodes: [{ __typename: 'Issue', author: { __typename: 'Bot', login: 'a' }, comments: { nodes: [] }, ...canaryExtras }] })
  });
  const items = await discoverBots({ owner: 'mephistopheles4', scopeType: 'user', token: CANARY_STRINGS.token, fetchFn: api.fetchFn, endDate: '2026-11-24' });
  assertNoCanary(items, 'discover result');
});

test('C4: 403 X-GitHub-SSO with canary org slug fails once, exit 4, and leaks nothing', async () => {
  const sso = `required; url=https://github.com/orgs/${CANARY_STRINGS.ssoSlug}/sso?authorization_request=${CANARY_STRINGS.token}`;
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return makeJsonResponse({ message: `Resource protected by organization SAML enforcement ${CANARY_STRINGS.repoName}`, documentation_url: CANARY_STRINGS.url }, { status: 403, headers: { 'x-github-sso': sso } });
  };
  await assert.rejects(
    () => collectActivity({ config: config(), endDate: '2026-11-24', token: CANARY_STRINGS.token, fetchFn, sleepFn: async () => {} }),
    (err) => {
      assertNoCanary(errorDump(err), 'error');
      assert.equal(err.code, 'AUTH_FORBIDDEN');
      assert.equal(err.exitCode, 4);
      assert.equal(err.cause, undefined);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('C4: GraphQL error messages/paths and undici-style causes are discarded', async () => {
  const graphqlErrors = createMockApi({
    graphql: () => ({ data: null, errors: [{ type: 'FORBIDDEN', message: `Resource not accessible ${CANARY_STRINGS.url}`, path: ['repository', CANARY_STRINGS.repoName], extensions: { saml_failure: true, org: CANARY_STRINGS.ssoSlug } }] })
  });
  await assert.rejects(
    () => collectActivity({ config: config(), endDate: '2026-11-24', token: CANARY_STRINGS.token, fetchFn: graphqlErrors.fetchFn }),
    (err) => {
      assertNoCanary(errorDump(err), 'graphql error');
      return err.code === 'GRAPHQL_ERROR' && err.exitCode === 4;
    }
  );

  const fetchFn = async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ECONNREFUSED ${CANARY_STRINGS.url} with ${CANARY_STRINGS.token}`), { code: 'ECONNREFUSED' }) });
  };
  await assert.rejects(
    () => collectActivity({ config: config(), endDate: '2026-11-24', token: CANARY_STRINGS.token, fetchFn }),
    (err) => {
      assertNoCanary(errorDump(err), 'network error');
      return err.cause === undefined && err.exitCode === 4;
    }
  );
});

test('C4: raw 4xx/5xx bodies are never embedded in errors', async () => {
  for (const code of [400, 404, 422, 500, 502, 503, 429, 403]) {
    const fetchFn = async () => makeJsonResponse({ message: `${CANARY_STRINGS.repoName} ${CANARY_STRINGS.prTitle}`, url: CANARY_STRINGS.url }, { status: code });
    await assert.rejects(
      () => collectActivity({ config: config(), endDate: '2026-11-24', token: CANARY_STRINGS.token, fetchFn, sleepFn: async () => {} }),
      (err) => {
        assertNoCanary(errorDump(err), `HTTP ${code}`);
        return true;
      }
    );
  }
});

test('C4: a gh subprocess failure never exposes the token via stdout/stderr/output', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lynceus-canary-'));
  try {
    writeFileSync(path.join(dir, process.platform === 'win32' ? 'gh.exe' : 'gh'), 'fake', { mode: 0o755 });
    const err = Object.assign(new Error('Command failed: gh auth token'), { status: 1, stdout: CANARY_STRINGS.token, stderr: `Bearer ${CANARY_STRINGS.token}`, output: [null, CANARY_STRINGS.token] });
    const execFileSyncFn = () => {
      throw err;
    };
    assert.equal(resolveToken({ env: { PATH: dir }, execFileSyncFn }), null);
    assertNoCanary({ ...err, message: err.message }, 'scrubbed error');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redactSecrets scrubs the canary token and Bearer headers from CLI-style stderr text', () => {
  const stderr = `request failed: Authorization: Bearer ${CANARY_STRINGS.token}\nraw token ${CANARY_STRINGS.token} ghp_AnotherLeakedToken99 github_pat_11ABC_xyz`;
  const out = redactSecrets(stderr, CANARY_STRINGS.token);
  assert.ok(!out.includes(CANARY_STRINGS.token));
  assert.ok(!out.includes('ghp_AnotherLeakedToken99'));
  assert.ok(!out.includes('github_pat_11ABC_xyz'));
});

test('collector modules and tests import nothing from src/cli (zero coupling)', () => {
  const files = [
    ...readdirSync(SRC_DIR).filter((f) => f.endsWith('.mjs')).map((f) => path.join(SRC_DIR, f)),
    ...readdirSync(HERE).filter((f) => f.endsWith('.mjs')).map((f) => path.join(HERE, f))
  ];
  assert.ok(files.length >= 12);
  const importCli = /(?:from|import)\s*\(?\s*['"][^'"]*(?:\/|\\)cli(?:\/|\\)/;
  for (const file of files) {
    assert.ok(!importCli.test(readFileSync(file, 'utf8')), `${path.basename(file)} imports from src/cli`);
  }
  assert.ok(readdirSync(SRC_DIR).includes('config.mjs'));
});

test('collector modules import only node: builtins and sibling collector modules', () => {
  for (const file of readdirSync(SRC_DIR).filter((f) => f.endsWith('.mjs'))) {
    const source = readFileSync(path.join(SRC_DIR, file), 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('node:') || /^\.\/[a-z-]+\.mjs$/.test(match[1]), `${file} imports ${match[1]}`);
    }
  }
});
