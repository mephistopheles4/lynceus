import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addDays, normalizeConfig as collectorNormalizeConfig, ValidationError } from '../../src/collector/config.mjs';
import { PrivacyGateError } from '../../src/collector/privacy-gate.mjs';
import { CLI_VERSION, EXIT_CODES, UsageError, formatHelpText, parseCliArgs } from '../../src/cli/args.mjs';
import * as cliConfig from '../../src/cli/config.mjs';
import { FsSafeError } from '../../src/cli/fs-safe.mjs';

const usageError = (argv, pattern) =>
  assert.throws(
    () => parseCliArgs(argv),
    (e) => e instanceof UsageError && e.exitCode === 2 && e.code === 'USAGE' && (!pattern || pattern.test(e.message)),
    `expected UsageError for ${JSON.stringify(argv)}`
  );

test('exit code constants and UsageError', () => {
  assert.deepEqual({ ...EXIT_CODES }, { OK: 0, USAGE: 2, AUTH: 3, API: 4, FS: 5 });
  assert.ok(Object.isFrozen(EXIT_CODES));
  const err = new UsageError('boom');
  assert.equal(err.exitCode, 2);
  assert.ok(err instanceof Error);
  assert.match(CLI_VERSION, /^\d+\.\d+\.\d+/);
});

test('default command is init, with or without leading flags', () => {
  assert.deepEqual(parseCliArgs([]), { command: 'init', options: { noOpen: false, includePrivate: false } });
  assert.deepEqual(parseCliArgs(['--no-open', '--port', '0']).options, { noOpen: true, includePrivate: false, port: 0 });
  assert.equal(parseCliArgs(['init']).command, 'init');
  assert.equal(parseCliArgs(['--config=./a.json', '--include-private']).options.includePrivate, true);
});

test('--help/-h and --version/-v short-circuit to help/version', () => {
  for (const argv of [['--help'], ['-h'], ['collect', '--help'], ['render', '-h', '--layout', 'separate']]) {
    assert.equal(parseCliArgs(argv).command, 'help');
  }
  for (const argv of [['--version'], ['-v'], ['build', '--version']]) {
    assert.equal(parseCliArgs(argv).command, 'version');
  }
});

test('collect flags, both --flag value and --flag=value forms', () => {
  const a = parseCliArgs(['collect', '--config', 'c.json', '--out', 'o.json', '--include-private', '--date', '2026-11-24', '--quiet']);
  const b = parseCliArgs(['collect', '--config=c.json', '--out=o.json', '--include-private', '--date=2026-11-24', '--quiet']);
  assert.deepEqual(a, b);
  assert.deepEqual(a, {
    command: 'collect',
    options: { includePrivate: true, publicOnly: false, quiet: true, config: 'c.json', out: 'o.json', date: '2026-11-24' }
  });
  assert.equal(parseCliArgs(['collect']).options.quiet, false);
  assert.equal(parseCliArgs(['collect', '--public-only']).options.publicOnly, true);
});

test('render flags are validated and camelCased', () => {
  const { command, options } = parseCliArgs([
    'render', '--counts', 'c.json', '--out-dir', 'o', '--owner', 'octo', '--scope-type', 'org', '--layout', 'separate',
    '--detail', 'minimal', '--mark-style', 'magnitude', '--label-mode', 'raw', '--branch', 'generated',
    '--subpath', 'agent-activity', '--markdown-base', 'relative', '--quiet'
  ]);
  assert.equal(command, 'render');
  assert.deepEqual(options, {
    quiet: true, counts: 'c.json', outDir: 'o', owner: 'octo', scopeType: 'org', layout: 'separate', detail: 'minimal',
    markStyle: 'magnitude', labelMode: 'raw', branch: 'generated', subpath: 'agent-activity', markdownBase: 'relative'
  });
  assert.equal(parseCliArgs(['render', '--subpath=']).options.subpath, '', 'empty subpath means branch root');
});

test('build and schedule flags', () => {
  assert.deepEqual(parseCliArgs(['build', '--counts-out', 'x.json', '--out-dir=o', '--public-only']).options, {
    includePrivate: false, publicOnly: true, quiet: false, countsOut: 'x.json', outDir: 'o'
  });
  const { options } = parseCliArgs([
    'schedule', '--config', 'c.json', '--target', 'cron', '--repo-dir', '.', '--owner', 'octo', '--branch', 'generated',
    '--subpath', 'a/b', '--tool-ref', 'a'.repeat(40), '--git-name', 'bot', '--git-email', 'b@example.com',
    '--task-name', 'T', '--script-path', 's.sh', '--out-dir', 'o', '--public-only'
  ]);
  assert.equal(options.target, 'cron');
  assert.equal(options.toolRef, 'a'.repeat(40));
  assert.equal(options.scriptPath, 's.sh');
  assert.equal(options.taskName, 'T');
  assert.equal(options.publicOnly, true);
  assert.equal(parseCliArgs(['schedule', '--package-pin', 'lynceus@0.1.0']).options.packagePin, 'lynceus@0.1.0');
});

test('unknown commands, unknown flags and positional arguments are usage errors', () => {
  usageError(['frobnicate'], /Unknown command/);
  usageError(['--bogus'], /Unknown flag/);
  usageError(['collect', '--bogus=1'], /Unknown flag/);
  usageError(['collect', '-x'], /Unknown flag/);
  usageError(['collect', 'extra'], /Unexpected argument/);
  usageError(['init', 'extra'], /Unexpected argument/);
  usageError(['collect', '-'], /Unexpected argument/);
  usageError(['collect', '--layout', 'separate'], /not valid for "collect"/);
  usageError(['init', '--out', 'x'], /not valid for "init"/);
  usageError(['render', '--public-only'], /not valid for "render"/);
  usageError(['init', '--quiet'], /not valid for "init"/);
});

test('value flags require a value; boolean flags reject one; duplicates rejected', () => {
  usageError(['collect', '--config'], /requires a value/);
  usageError(['collect', '--config='], /requires a value/);
  usageError(['collect', '--out', '--quiet'], /requires a value/);
  usageError(['init', '--port'], /requires a value/);
  usageError(['collect', '--quiet=yes'], /does not take a value/);
  usageError(['collect', '--quiet', '--quiet'], /more than once/);
  usageError(['collect', '--out', 'a', '--out=b'], /more than once/);
  // leading-dash values stay expressible via the = form so later validators can reject them
  assert.equal(parseCliArgs(['schedule', '--config=-evil']).options.config, '-evil');
});

test('--include-private with --public-only conflicts immediately', () => {
  for (const cmd of ['collect', 'build', 'schedule']) {
    usageError([cmd, '--include-private', '--public-only'], /cannot be used together/);
    usageError([cmd, '--public-only', '--include-private'], /cannot be used together/);
  }
  assert.equal(parseCliArgs(['schedule', '--public-only']).options.includePrivate, false);
});

test('--port validation', () => {
  for (const port of ['0', '1', '4173', '65535']) assert.equal(parseCliArgs(['init', '--port', port]).options.port, Number(port));
  for (const bad of ['-1', '65536', '1.5', 'abc', '1e3', '0x10', ' 80', '+80', '123456', '99999999999999999999']) {
    usageError(['init', `--port=${bad}`], /--port/);
  }
});

test('--date must be a real UTC calendar date', () => {
  assert.equal(parseCliArgs(['build', '--date', '2024-02-29']).options.date, '2024-02-29');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '20261124', 'today', '2026-11-24T00:00:00Z', '2025-02-29']) {
    usageError(['collect', `--date=${bad}`], /--date/);
    usageError(['build', `--date=${bad}`], /--date/);
  }
});

test('enum flags reject unknown values', () => {
  const cases = [
    ['render', '--scope-type', 'team'], ['render', '--layout', 'grid'], ['render', '--detail', 'full'],
    ['render', '--mark-style', 'circles'], ['render', '--label-mode', 'pretty'], ['render', '--markdown-base', 'abs'],
    ['schedule', '--target', 'systemd']
  ];
  for (const argv of cases) usageError(argv, new RegExp(argv[1]));
  usageError(['render', '--layout=UNIFIED'], /--layout/);
});

test('owner, branch and subpath use the shared collector validators', () => {
  usageError(['render', '--owner', 'bad owner'], /--owner/);
  usageError(['schedule', '--owner=-x'], /--owner/);
  usageError(['render', '--branch', 'main'], /--branch/);
  usageError(['schedule', '--branch=refs/heads/x'], /--branch/);
  usageError(['render', '--subpath=../x'], /--subpath/);
  usageError(['schedule', '--subpath=a/.git'], /--subpath/);
});

test('schedule: --tool-ref + --package-pin conflict and --script-path with actions', () => {
  usageError(['schedule', '--tool-ref', 'a'.repeat(40), '--package-pin', 'lynceus@0.1.0'], /--tool-ref and --package-pin/);
  usageError(['schedule', '--package-pin=lynceus@0.1.0', '--tool-ref=' + 'b'.repeat(40)], /--tool-ref and --package-pin/);
  usageError(['schedule', '--target', 'actions', '--script-path', 's.sh'], /--script-path/);
  usageError(['schedule', '--script-path=s.sh', '--target=actions'], /--script-path/);
  assert.equal(parseCliArgs(['schedule', '--target', 'actions']).options.target, 'actions');
  assert.equal(parseCliArgs(['schedule', '--target', 'cron', '--script-path', 's.sh']).options.scriptPath, 's.sh');
});

test('usage errors never echo flag values', () => {
  const secret = 'ghp_SUPERSECRETVALUE123456';
  for (const argv of [['render', `--layout=${secret}`], ['init', `--port=${secret}`], ['collect', `--date=${secret}`]]) {
    assert.throws(() => parseCliArgs(argv), (e) => !e.message.includes(secret));
  }
});

test('help text lists every command and carries the public-history caveat', () => {
  const help = formatHelpText();
  for (const word of ['init', 'collect', 'render', 'build', 'schedule', '--help', '--version', '--include-private', '--public-only', '--tool-ref', '--package-pin']) {
    assert.ok(help.includes(word), word);
  }
  assert.match(help, /pushed\s+--include-private SVGs persist visible daily totals in public repository history/);
  assert.ok(help.includes(CLI_VERSION));
});

// ---- src/cli/config.mjs ----

function makeCounts() {
  const days = {};
  for (let d = '2025-11-30'; d <= '2026-11-24'; d = addDays(d, 1)) days[d] = 0;
  days['2026-11-24'] = 3;
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-24T00:00:00Z',
    window: { weeks: 52, startDate: '2025-11-30', endDate: '2026-11-24' },
    scope: { mode: 'public' },
    agents: [{
      slug: 'mephistos-homunculus[bot]', label: 'Homunculus', ramp: 'emerald', source: 'github',
      totals: { prsOpened: 3, prsMerged: 0, commits: 0, reviews: 0, comments: 0, issues: 0, total: 3 },
      streaks: { current: 1, best: 1 }, days
    }]
  };
}

const validConfig = () => ({
  schemaVersion: 1, owner: 'mephistopheles4', scopeType: 'user', includePrivate: false, windowWeeks: 52,
  layout: 'unified', detail: 'breakdown', markStyle: 'squares', labelMode: 'friendly',
  metrics: { prsOpened: true, prsMerged: true, commits: true, reviews: true, comments: true, issues: true },
  agents: [{ slug: 'mephistos-homunculus[bot]', label: 'Homunculus', ramp: 'emerald' }]
});

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lynceus-cfg-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('cli/config re-exports collector validators without duplicating them', () => {
  assert.equal(cliConfig.normalizeConfig, collectorNormalizeConfig);
  assert.equal(cliConfig.ValidationError, ValidationError);
  for (const name of ['validateBotSlugFormat', 'validateOwner', 'validateLabel', 'validateBranch', 'validateSubpath', 'VALID_RAMPS']) {
    assert.ok(name in cliConfig, name);
  }
  assert.equal(cliConfig.MAX_CONFIG_BYTES, 65_536);
  assert.equal(cliConfig.MAX_COUNTS_BYTES, 1_048_576);
});

test('loadConfigFile reads, validates and normalizes defaults', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'lynceus.json');
    writeFileSync(file, JSON.stringify(validConfig()));
    const config = cliConfig.loadConfigFile(file);
    assert.equal(config.branch, 'generated');
    assert.equal(config.subpath, 'agent-activity');
    assert.equal(config.markdownBase, 'raw');
    assert.equal(config.owner, 'mephistopheles4');
  });
});

test('loadConfigFile honors allowEmptyAgents and rejects invalid schema (exit 2)', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'lynceus.json');
    writeFileSync(file, JSON.stringify({ ...validConfig(), agents: [] }));
    assert.throws(() => cliConfig.loadConfigFile(file), (e) => e instanceof ValidationError && e.exitCode === 2);
    assert.deepEqual(cliConfig.loadConfigFile(file, { allowEmptyAgents: true }).agents, []);
    writeFileSync(file, JSON.stringify({ ...validConfig(), extra: 1 }));
    assert.throws(() => cliConfig.loadConfigFile(file), (e) => e instanceof ValidationError);
  });
});

test('loadConfigFile enforces the 64 KiB bound, missing files exit 5', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'lynceus.json');
    writeFileSync(file, ' '.repeat(65_537));
    assert.throws(() => cliConfig.loadConfigFile(file), (e) => e instanceof ValidationError && /exceeds/.test(e.message));
    assert.throws(
      () => cliConfig.loadConfigFile(path.join(dir, 'missing.json')),
      (e) => e instanceof FsSafeError && e.exitCode === 5 && e.code === 'FS_NOT_FOUND'
    );
  });
});

test('loadCountsFile validates strictly via the privacy gate', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'counts.json');
    writeFileSync(file, JSON.stringify(makeCounts()));
    assert.deepEqual(cliConfig.loadCountsFile(file), makeCounts());
    const bad = makeCounts();
    bad.agents[0].repo = 'private/repo';
    writeFileSync(file, JSON.stringify(bad));
    assert.throws(() => cliConfig.loadCountsFile(file), (e) => e instanceof PrivacyGateError && e.exitCode === 2);
    writeFileSync(file, ' '.repeat(1_048_577));
    assert.throws(() => cliConfig.loadCountsFile(file), (e) => e instanceof ValidationError && /exceeds/.test(e.message));
  });
});

test('loadConfigFile/loadCountsFile route through injected fsOps', () => {
  const calls = [];
  const fsOps = {
    lstatSync: () => ({ isSymbolicLink: () => false, isFile: () => true, size: 2 }),
    realpathSync: (p) => p,
    readFileSync: (p) => {
      calls.push(p);
      return Buffer.from('{}');
    }
  };
  assert.throws(() => cliConfig.loadConfigFile(path.join(tmpdir(), 'x.json'), { fsOps }), ValidationError);
  assert.throws(() => cliConfig.loadCountsFile(path.join(tmpdir(), 'y.json'), { fsOps }), PrivacyGateError);
  assert.equal(calls.length, 2);
});
