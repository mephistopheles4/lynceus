import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOT_SLUG_RE,
  BRANCH_RE,
  OWNER_RE,
  SUBPATH_RE,
  VALID_RAMPS,
  ValidationError,
  normalizeConfig,
  validateBotSlugFormat,
  validateBranch,
  validateLabel,
  validateOwner,
  validateSubpath
} from '../../src/collector/config.mjs';
import { makeProfileAgentsConfig } from '../fixtures/github-mocks.mjs';

const valid = () => makeProfileAgentsConfig();
const rejects = (fn) => assert.throws(fn, (e) => e instanceof ValidationError && e.exitCode === 2);

test('exports the shared constants', () => {
  assert.deepEqual([...VALID_RAMPS], ['emerald', 'cobalt', 'amber', 'violet', 'rose', 'teal']);
  assert.ok(BOT_SLUG_RE.test('a[bot]') && OWNER_RE.test('a') && BRANCH_RE.test('generated') && SUBPATH_RE.test('agent-activity'));
});

test('normalizeConfig accepts the profile fixture and applies optional defaults', () => {
  const cfg = normalizeConfig(valid());
  assert.equal(cfg.agents.length, 3);
  const raw = valid();
  delete raw.branch;
  delete raw.subpath;
  delete raw.markdownBase;
  const defaults = normalizeConfig(raw);
  assert.equal(defaults.branch, 'generated');
  assert.equal(defaults.subpath, 'agent-activity');
  assert.equal(defaults.markdownBase, 'raw');
  assert.equal(normalizeConfig({ ...valid(), subpath: '' }).subpath, '');
  assert.equal(normalizeConfig({ ...valid(), markdownBase: 'relative' }).markdownBase, 'relative');
});

test('normalizeConfig does not mutate its input and returns a copy', () => {
  const raw = valid();
  const snapshot = structuredClone(raw);
  const cfg = normalizeConfig(raw);
  cfg.agents[0].label = 'changed';
  assert.deepEqual(raw, snapshot);
});

test('closed schema: unknown keys rejected at root, metrics and agents[]', () => {
  rejects(() => normalizeConfig({ ...valid(), extra: 1 }));
  rejects(() => normalizeConfig({ ...valid(), metrics: { ...valid().metrics, extra: true } }));
  const raw = valid();
  raw.agents[0].extra = 'x';
  rejects(() => normalizeConfig(raw));
  rejects(() => normalizeConfig(JSON.parse(`${JSON.stringify(valid()).slice(0, -1)},"__proto__":{"x":1}}`)));
});

test('required fields, types and enums', () => {
  for (const key of ['schemaVersion', 'owner', 'scopeType', 'includePrivate', 'windowWeeks', 'layout', 'detail', 'markStyle', 'labelMode', 'metrics', 'agents']) {
    const raw = valid();
    delete raw[key];
    rejects(() => normalizeConfig(raw));
  }
  for (const [k, v] of [['schemaVersion', 2], ['scopeType', 'team'], ['includePrivate', 'true'], ['includePrivate', 1], ['windowWeeks', 30], ['windowWeeks', '52'],
    ['layout', 'grid'], ['detail', 'full'], ['markStyle', 'dots'], ['labelMode', 'pretty'], ['markdownBase', 'abs'], ['branch', 'main'], ['subpath', '../x'], ['owner', 'bad owner']]) {
    rejects(() => normalizeConfig({ ...valid(), [k]: v }));
  }
  for (const bad of [null, undefined, [], 'x', 5]) rejects(() => normalizeConfig(bad));
});

test('metrics: all six booleans, at least one true', () => {
  const metrics = { ...valid().metrics };
  rejects(() => normalizeConfig({ ...valid(), metrics: Object.fromEntries(Object.keys(metrics).map((k) => [k, false])) }));
  const missing = { ...metrics };
  delete missing.issues;
  rejects(() => normalizeConfig({ ...valid(), metrics: missing }));
  rejects(() => normalizeConfig({ ...valid(), metrics: { ...metrics, commits: 'yes' } }));
  assert.equal(normalizeConfig({ ...valid(), metrics: { ...metrics, commits: false } }).metrics.commits, false);
});

test('agents: 1..12 unique case-insensitive; allowEmptyAgents permits 0..12', () => {
  const agent = (i) => ({ slug: `bot-${i}[bot]`, label: `Bot ${i}`, ramp: 'emerald' });
  rejects(() => normalizeConfig({ ...valid(), agents: [] }));
  assert.deepEqual(normalizeConfig({ ...valid(), agents: [] }, { allowEmptyAgents: true }).agents, []);
  assert.equal(normalizeConfig({ ...valid(), agents: Array.from({ length: 12 }, (_, i) => agent(i)) }).agents.length, 12);
  rejects(() => normalizeConfig({ ...valid(), agents: Array.from({ length: 13 }, (_, i) => agent(i)) }, { allowEmptyAgents: true }));
  rejects(() => normalizeConfig({ ...valid(), agents: [agent(1), { ...agent(1), slug: 'BOT-1[BOT]' }] }));
  rejects(() => normalizeConfig({ ...valid(), agents: [{ ...agent(1), slug: 'bot-1[bot]'.replace('[bot]', '') }] }));
  rejects(() => normalizeConfig({ ...valid(), agents: [{ ...agent(1), ramp: 'pink' }] }));
  rejects(() => normalizeConfig({ ...valid(), agents: 'nope' }));
});

test('label validation: code points, emoji, control/BiDi and surrogates', () => {
  assert.equal(validateLabel("  Example's Bot 🚀  "), "Example's Bot 🚀");
  assert.equal(validateLabel('🚀'.repeat(40)), '🚀'.repeat(40));
  rejects(() => validateLabel('🚀'.repeat(41)));
  rejects(() => validateLabel(''));
  rejects(() => validateLabel('   '));
  rejects(() => validateLabel(42));
  for (const bad of ['a\u0000b', 'a\tb', 'a\nb', 'a\u007Fb', 'a\u0085b', 'a\u009Fb', 'a\u200Eb', 'a\u200Fb', 'a\u061Cb', 'a\u202Ab', 'a\u202Eb', 'a\u2066b', 'a\u2069b', 'a\ud800b', 'a\udc00b', 'a\ud83d']) {
    rejects(() => validateLabel(bad));
  }
  assert.equal(validateLabel('button=1 <b>'), 'button=1 <b>');
});

test('slug and owner validation', () => {
  assert.equal(validateBotSlugFormat('mephistos-homunculus[bot]'), 'mephistos-homunculus[bot]');
  for (const bad of ['plain', 'a[bot', '-a[bot]', 'a-[bot]', 'a_b[bot]', '', 'x'.repeat(40) + '[bot]', 'a[bot]\n', 5, null]) rejects(() => validateBotSlugFormat(bad));
  assert.equal(validateOwner('mephistopheles4'), 'mephistopheles4');
  for (const bad of ['', '-a', 'a-', 'a b', 'a/b', 'x'.repeat(40), 7, undefined]) rejects(() => validateOwner(bad));
});

test('branch validation', () => {
  for (const ok of ['generated', 'gen/erated', 'a.b-c_d', 'v1.2']) assert.equal(validateBranch(ok), ok);
  for (const bad of ['main', 'Main', 'master', 'HEAD', 'head', 'refs/heads/x', 'Refs/x', 'heads/x', 'tags/x', 'remotes/x', 'a..b', 'a//b', '.hidden', 'a/.hidden',
    'trail.', 'trail/', 'x.lock', 'a/x.lock', '/lead', '-lead', 'a b', 'a:b', 'x'.repeat(65), '', 5]) {
    rejects(() => validateBranch(bad));
  }
});

test('subpath validation', () => {
  for (const ok of ['', 'agent-activity', 'a/b', 'a.b/c_d']) assert.equal(validateSubpath(ok), ok);
  for (const bad of ['..', 'a/..', 'a//b', '/a', 'a/', '.git', 'a/.git', 'a/.', '.a', 'a:b', 'a"b', "a'b", 'a<b', 'a>b', 'a b', 'a\tb', 'x'.repeat(65), 5, null]) {
    rejects(() => validateSubpath(bad));
  }
});
