import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AuthError } from '../../src/collector/auth.mjs';
import { collectActivity } from '../../src/collector/collect.mjs';
import { addDays } from '../../src/collector/config.mjs';
import { ApiError } from '../../src/collector/github-client.mjs';
import { CLI_VERSION } from '../../src/cli/args.mjs';
import { runCli } from '../../src/cli/commands.mjs';

const BIN_PATH = fileURLToPath(new URL('../../bin/lynceus.mjs', import.meta.url));
const isWin = process.platform === 'win32';

function withTempDir(fn) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'lynceus-cmd-'));
  try {
    return fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

async function withTempDirAsync(fn) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'lynceus-cmd-'));
  try {
    return await fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function makeIo() {
  let out = '';
  let err = '';
  return {
    stdout: { write(chunk) { out += chunk; } },
    stderr: { write(chunk) { err += chunk; } },
    getOut: () => out,
    getErr: () => err
  };
}

function makeConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    owner: 'octo',
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
    metrics: {
      prsOpened: true,
      prsMerged: true,
      commits: true,
      reviews: true,
      comments: true,
      issues: true
    },
    agents: [{ slug: 'octo-helper[bot]', label: 'Helper', ramp: 'emerald' }],
    ...overrides
  };
}

function makeCounts(mode = 'public', overrides = {}) {
  const days = {};
  for (let d = '2025-11-30'; d <= '2026-11-24'; d = addDays(d, 1)) days[d] = 0;
  days['2026-11-24'] = 3;
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-24T00:00:00Z',
    window: { weeks: 52, startDate: '2025-11-30', endDate: '2026-11-24' },
    scope: { mode },
    agents: [{
      slug: 'octo-helper[bot]',
      label: 'Helper',
      ramp: 'emerald',
      source: 'github',
      totals: { prsOpened: 3, prsMerged: 0, commits: 0, reviews: 0, comments: 0, issues: 0, total: 3 },
      streaks: { current: 1, best: 1 },
      days,
      ...(overrides.agent ?? {})
    }]
  };
}

// ---- bin/lynceus.mjs ----

test('bin/lynceus.mjs exits 2 on Node < 24 before dynamically importing commands.mjs', () => {
  const binUrl = pathToFileURL(BIN_PATH).href;
  const script = `
    Object.defineProperty(process.versions, 'node', { value: '22.12.0', configurable: true });
    await import(${JSON.stringify(binUrl)});
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8'
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Node\.js >= 24/);
  assert.equal(res.stderr.trim().split(/\r?\n/).length, 1);
});

test('bin/lynceus.mjs resolves assets via import.meta.url when invoked off-CWD', () => {
  withTempDir((offCwd) => {
    const ver = execFileSync(process.execPath, [BIN_PATH, '--version'], { cwd: offCwd, encoding: 'utf8' });
    assert.equal(ver.trim(), `lynceus ${CLI_VERSION}`);

    const help = execFileSync(process.execPath, [BIN_PATH, '--help'], { cwd: offCwd, encoding: 'utf8' });
    assert.match(help, /--include-private SVGs persist visible daily totals in public repository history/);
  });
});

// ---- init ----

test('init: port 4173 default, busy fallback to 0, explicit --port bind fail exits 5', async () => {
  await withTempDirAsync(async (base) => {
    // 1. Default 4173 succeeds
    const io1 = makeIo();
    const seenPorts1 = [];
    const code1 = await runCli(['init', '--no-open'], {
      cwd: base,
      ...io1,
      startServerFn: async ({ port }) => {
        seenPorts1.push(port);
        return { port, url: `http://127.0.0.1:${port}` };
      }
    });
    assert.equal(code1, 0);
    assert.deepEqual(seenPorts1, [4173]);
    assert.match(io1.getOut(), /http:\/\/127\.0\.0\.1:4173/);

    // 2. Default 4173 EADDRINUSE falls back to 0
    const io2 = makeIo();
    const seenPorts2 = [];
    const code2 = await runCli(['init', '--no-open'], {
      cwd: base,
      ...io2,
      startServerFn: async ({ port }) => {
        seenPorts2.push(port);
        if (port === 4173) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' });
        return { port: 51234, url: 'http://127.0.0.1:51234' };
      }
    });
    assert.equal(code2, 0);
    assert.deepEqual(seenPorts2, [4173, 0]);
    assert.match(io2.getOut(), /http:\/\/127\.0\.0\.1:51234/);

    // 3. Explicit --port bind failure exits 5
    const io3 = makeIo();
    const code3 = await runCli(['init', '--port', '4173', '--no-open'], {
      cwd: base,
      ...io3,
      startServerFn: async () => { throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' }); }
    });
    assert.equal(code3, 5);
  });
});

test('init: resets includePrivate to false on ./lynceus.json and explicit --config unless CLI --include-private is passed', async () => {
  await withTempDirAsync(async (base) => {
    const defaultCfgPath = path.join(base, 'lynceus.json');
    const customCfgPath = path.join(base, 'custom.json');
    writeFileSync(defaultCfgPath, JSON.stringify(makeConfig({ includePrivate: true })));
    writeFileSync(customCfgPath, JSON.stringify(makeConfig({ includePrivate: true })));

    let received;
    const serverStub = async (opts) => {
      received = opts;
      return { port: opts.port, url: `http://127.0.0.1:${opts.port}` };
    };

    // Auto-loaded ./lynceus.json without --include-private -> reset to false
    assert.equal(await runCli(['init', '--no-open'], { cwd: base, ...makeIo(), startServerFn: serverStub }), 0);
    assert.equal(received.config.includePrivate, false);
    assert.equal(received.allowIncludePrivate, false);

    // Explicit --config without --include-private -> reset to false
    assert.equal(await runCli(['init', '--config', customCfgPath, '--no-open'], { cwd: base, ...makeIo(), startServerFn: serverStub }), 0);
    assert.equal(received.config.includePrivate, false);
    assert.equal(received.allowIncludePrivate, false);

    // Explicit --config WITH --include-private -> preserved true
    assert.equal(
      await runCli(['init', '--config', customCfgPath, '--include-private', '--no-open'], { cwd: base, ...makeIo(), startServerFn: serverStub }),
      0
    );
    assert.equal(received.config.includePrivate, true);
    assert.equal(received.allowIncludePrivate, true);

    // Missing explicit --config -> exit 5; malformed -> exit 2
    assert.equal(await runCli(['init', '--config', path.join(base, 'missing.json'), '--no-open'], { cwd: base, ...makeIo(), startServerFn: serverStub }), 5);
    writeFileSync(path.join(base, 'bad.json'), '{not json');
    assert.equal(await runCli(['init', '--config', path.join(base, 'bad.json'), '--no-open'], { cwd: base, ...makeIo(), startServerFn: serverStub }), 2);
  });
});

test('init: safe browser launch ignores planted ./rundll32.exe and ./xdg-open, uses cwd: tmpdir, falls back cleanly', async () => {
  await withTempDirAsync(async (base) => {
    // Plant decoy binaries in cwd
    writeFileSync(path.join(base, 'rundll32.exe'), 'evil');
    writeFileSync(path.join(base, 'xdg-open'), 'evil');

    const spawns = [];
    const spawnStub = (cmd, args, opts) => {
      spawns.push({ cmd, args, opts });
      return { on() {}, unref() {} };
    };
    const serverStub = async () => ({ port: 4173, url: 'http://127.0.0.1:4173' });

    // win32: SystemRoot\System32\rundll32.exe
    const winCode = await runCli(['init'], {
      cwd: base,
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      tmpdir: 'C:\\Temp',
      statSyncFn: (p) => ({ isFile: () => p === 'C:\\Windows\\System32\\rundll32.exe' }),
      spawnFn: spawnStub,
      startServerFn: serverStub,
      ...makeIo()
    });
    assert.equal(winCode, 0);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].cmd, 'C:\\Windows\\System32\\rundll32.exe');
    assert.deepEqual(spawns[0].args, ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4173']);
    assert.equal(spawns[0].opts.shell, false);
    assert.equal(spawns[0].opts.cwd, 'C:\\Temp');

    // linux: ignores relative/cwd PATH entries, uses absolute PATH xdg-open
    spawns.length = 0;
    const posixCode = await runCli(['init'], {
      cwd: base,
      platform: 'linux',
      env: { PATH: '.:./planted:/usr/bin' },
      tmpdir: '/tmp',
      statSyncFn: (p) => {
        if (p.includes('xdg-open')) return { isFile: () => true, mode: 0o755 };
        throw new Error('ENOENT');
      },
      spawnFn: spawnStub,
      startServerFn: serverStub,
      ...makeIo()
    });
    assert.equal(posixCode, 0);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].cmd, path.join('/usr/bin', 'xdg-open'));
    assert.deepEqual(spawns[0].args, ['http://127.0.0.1:4173']);
    assert.equal(spawns[0].opts.shell, false);
    assert.equal(spawns[0].opts.cwd, '/tmp');

    // Missing opener / spawn failure still exits 0 and logs URL safely
    const ioFallback = makeIo();
    const fallbackCode = await runCli(['init'], {
      cwd: base,
      platform: 'win32',
      systemRoot: '',
      spawnFn: () => { throw new Error('should not spawn'); },
      startServerFn: serverStub,
      ...ioFallback
    });
    assert.equal(fallbackCode, 0);
    assert.match(ioFallback.getErr(), /http:\/\/127\.0\.0\.1:4173/);
  });
});

// ---- collect / render / build / schedule ----

test('collect: enforces private gate, missing auth exit 3, scrubbed warnings, and atomic counts output', async () => {
  await withTempDirAsync(async (base) => {
    const cfgPath = path.join(base, 'lynceus.json');
    const outPath = path.join(base, 'counts.json');
    writeFileSync(cfgPath, JSON.stringify(makeConfig({ includePrivate: true })));

    // Missing --include-private / --public-only -> exit 2
    assert.equal(await runCli(['collect', '--config', cfgPath], { cwd: base, ...makeIo() }), 2);

    // Missing token -> exit 3
    assert.equal(
      await runCli(['collect', '--config', cfgPath, '--include-private'], {
        cwd: base,
        resolveTokenFn: () => null,
        ...makeIo()
      }),
      3
    );

    // Successful private collect with scrubbed warning
    const io = makeIo();
    const secret = 'ghp_SUPERSECRETTOKEN123456';
    const code = await runCli(['collect', '--config', cfgPath, '--out', outPath, '--include-private'], {
      cwd: base,
      resolveTokenFn: () => ({ token: secret, sourceLabel: 'env' }),
      collectActivityFn: async ({ includePrivate }) => {
        assert.equal(includePrivate, true);
        return {
          counts: makeCounts('public+private'),
          warnings: [{ code: 'SCOPE_CAVEAT', agent: null, metric: null, detail: `bad token ${secret}` }]
        };
      },
      ...io
    });
    assert.equal(code, 0);
    assert.ok(existsSync(outPath));
    if (!isWin) assert.equal(statSync(outPath).mode & 0o777, 0o600);
    assert.ok(!io.getErr().includes(secret));
    assert.ok(io.getErr().includes('[REDACTED]'));
  });
});

test('render: validates counts.json, supports CLI overrides without config, and writes SVGs + Markdown', async () => {
  await withTempDirAsync(async (base) => {
    const countsPath = path.join(base, 'counts.json');
    const outDir = path.join(base, 'svgs');
    writeFileSync(countsPath, JSON.stringify(makeCounts()));

    // Missing --owner for raw without config -> exit 2
    assert.equal(await runCli(['render', '--counts', countsPath, '--out-dir', outDir], { cwd: base, ...makeIo() }), 2);

    // Relative markdownBase without --owner succeeds
    const ioRel = makeIo();
    assert.equal(
      await runCli(['render', '--counts', countsPath, '--out-dir', outDir, '--markdown-base', 'relative'], { cwd: base, ...ioRel }),
      0
    );
    assert.match(ioRel.getOut(), /<picture>/);
    assert.ok(existsSync(path.join(outDir, 'unified-52w-light.svg')));
    assert.ok(existsSync(path.join(outDir, 'unified-52w-dark.svg')));

    // Invalid counts.json -> exit 2
    const badCounts = path.join(base, 'bad-counts.json');
    writeFileSync(badCounts, JSON.stringify({ schemaVersion: 1, bad: true }));
    assert.equal(
      await runCli(['render', '--counts', badCounts, '--owner', 'octo', '--out-dir', outDir], { cwd: base, ...makeIo() }),
      2
    );
  });
});

test('build: writes counts.json ONLY with --counts-out, preserves prior SVGs on failure', async () => {
  await withTempDirAsync(async (base) => {
    const cfgPath = path.join(base, 'lynceus.json');
    const outDir = path.join(base, 'agent-activity');
    writeFileSync(cfgPath, JSON.stringify(makeConfig()));

    // 1. Success without --counts-out: writes SVGs, does NOT write counts.json
    const io1 = makeIo();
    const code1 = await runCli(['build', '--config', cfgPath, '--out-dir', outDir], {
      cwd: base,
      resolveTokenFn: () => ({ token: 'ghp_TESTTOKEN123456', sourceLabel: 'env' }),
      collectActivityFn: async () => ({ counts: makeCounts(), warnings: [] }),
      ...io1
    });
    assert.equal(code1, 0);
    const lightPath = path.join(outDir, 'unified-52w-light.svg');
    const priorSvg = readFileSync(lightPath, 'utf8');
    assert.equal(existsSync(path.join(base, 'counts.json')), false);
    assert.match(io1.getOut(), /<picture>/);

    // 2. Collection failure (ApiError exit 4): prior SVGs untouched
    const codeErr = await runCli(['build', '--config', cfgPath, '--out-dir', outDir], {
      cwd: base,
      resolveTokenFn: () => ({ token: 'ghp_TESTTOKEN123456', sourceLabel: 'env' }),
      collectActivityFn: async () => { throw new ApiError('API_ERROR', { status: 503 }); },
      ...makeIo()
    });
    assert.equal(codeErr, 4);
    assert.equal(readFileSync(lightPath, 'utf8'), priorSvg);

    // 3. Render failure (CamoSafetyError exit 2): prior SVGs untouched
    const codeCamo = await runCli(['build', '--config', cfgPath, '--out-dir', outDir], {
      cwd: base,
      resolveTokenFn: () => ({ token: 'ghp_TESTTOKEN123456', sourceLabel: 'env' }),
      collectActivityFn: async () => ({
        counts: makeCounts('public', { agent: { label: 'http://evil.example/leak' } }),
        warnings: []
      }),
      ...makeIo()
    });
    assert.equal(codeCamo, 2);
    assert.equal(readFileSync(lightPath, 'utf8'), priorSvg);

    // 4. --counts-out writes validated counts.json
    const countsOut = path.join(base, 'out', 'counts.json');
    assert.equal(
      await runCli(['build', '--config', cfgPath, '--out-dir', outDir, '--counts-out', countsOut, '--quiet'], {
        cwd: base,
        resolveTokenFn: () => ({ token: 'ghp_TESTTOKEN123456', sourceLabel: 'env' }),
        collectActivityFn: async () => ({ counts: makeCounts(), warnings: [] }),
        ...makeIo()
      }),
      0
    );
    assert.equal(existsSync(countsOut), true);
  });
});

test('C4 cross-module canary: build SVG, counts.json, and stderr contain zero private repo names, titles, URLs, SSO slugs, or tokens', async () => {
  await withTempDirAsync(async (base) => {
    const CANARY_REPO = 'secret-org/canary-private-repo';
    const CANARY_TITLE = 'CANARY_PRIVATE_PR_TITLE_XYZ';
    const CANARY_URL = 'https://github.com/secret-org/canary-private-repo/pull/99';
    const CANARY_SSO = 'required; url=https://github.com/orgs/canary-sso-slug/sso';
    const CANARY_TOKEN = 'ghp_CanarySecretTokenValue987654321';

    const cfgPath = path.join(base, 'lynceus.json');
    const outDir = path.join(base, 'out-svgs');
    const countsOut = path.join(base, 'counts.json');
    writeFileSync(cfgPath, JSON.stringify(makeConfig({
      includePrivate: true,
      metrics: { prsOpened: true, prsMerged: false, commits: false, reviews: false, comments: false, issues: false }
    })));

    const fetchMock = async (href) => {
      assert.equal(href, 'https://api.github.com/graphql');
      return new Response(
        JSON.stringify({
          data: {
            search: {
              issueCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{
                __typename: 'PullRequest',
                id: 'PR_kwDO_CANARY_ID',
                title: CANARY_TITLE,
                url: CANARY_URL,
                repository: { nameWithOwner: CANARY_REPO },
                createdAt: '2026-11-24T10:00:00Z',
                author: { __typename: 'Bot', login: 'octo-helper' }
              }]
            }
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'read:user' } }
      );
    };

    const io = makeIo();
    const code = await runCli(
      ['build', '--config', cfgPath, '--out-dir', outDir, '--counts-out', countsOut, '--include-private', '--date', '2026-11-24'],
      {
        cwd: base,
        env: { GITHUB_TOKEN: CANARY_TOKEN },
        collectActivityFn: (opts) => collectActivity({ ...opts, fetchFn: fetchMock }),
        ...io
      }
    );
    assert.equal(code, 0);

    const artifacts = [
      readFileSync(path.join(outDir, 'unified-52w-light.svg'), 'utf8'),
      readFileSync(path.join(outDir, 'unified-52w-dark.svg'), 'utf8'),
      readFileSync(countsOut, 'utf8'),
      io.getOut(),
      io.getErr()
    ].join('\n');
    for (const canary of [CANARY_REPO, CANARY_TITLE, CANARY_URL, CANARY_SSO, CANARY_TOKEN, 'PR_kwDO_CANARY_ID']) {
      assert.ok(!artifacts.includes(canary), `Leaked canary: ${canary}`);
    }

    // Also verify 403 X-GitHub-SSO failure leaks zero SSO header values or tokens to stderr
    const ssoIo = makeIo();
    const ssoCode = await runCli(['build', '--config', cfgPath, '--out-dir', outDir, '--include-private'], {
      cwd: base,
      env: { GITHUB_TOKEN: CANARY_TOKEN },
      collectActivityFn: (opts) => collectActivity({
        ...opts,
        fetchFn: async () => new Response(`secret ${CANARY_TOKEN} ${CANARY_SSO}`, {
          status: 403,
          headers: { 'x-github-sso': CANARY_SSO }
        })
      }),
      ...ssoIo
    });
    assert.equal(ssoCode, 4);
    assert.ok(!ssoIo.getErr().includes(CANARY_SSO));
    assert.ok(!ssoIo.getErr().includes('canary-sso-slug'));
    assert.ok(!ssoIo.getErr().includes(CANARY_TOKEN));
  });
});

test('schedule: requires existing config (FS_NOT_FOUND -> exit 2), enforces private gates, and emits snippet', async () => {
  await withTempDirAsync(async (base) => {
    const missingCfg = path.join(base, 'missing.json');
    assert.equal(await runCli(['schedule', '--config', missingCfg], { cwd: base, ...makeIo() }), 2);

    const privCfg = path.join(base, 'private.json');
    writeFileSync(privCfg, JSON.stringify(makeConfig({ includePrivate: true })));

    // Missing --include-private on private config -> exit 2
    assert.equal(await runCli(['schedule', '--config', privCfg, '--target', 'task-scheduler'], { cwd: base, ...makeIo() }), 2);

    // --target actions rejects private config without --public-only, and rejects --include-private
    assert.equal(await runCli(['schedule', '--config', privCfg, '--target', 'actions', '--tool-ref', 'a'.repeat(40)], { cwd: base, ...makeIo() }), 2);
    assert.equal(await runCli(['schedule', '--config', privCfg, '--target', 'actions', '--include-private', '--tool-ref', 'a'.repeat(40)], { cwd: base, ...makeIo() }), 2);

    // Local private schedule succeeds when --include-private passed
    const ioPriv = makeIo();
    const codePriv = await runCli(
      ['schedule', '--config', privCfg, '--target', 'task-scheduler', '--include-private', '--repo-dir', base],
      {
        cwd: base,
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\octo\\AppData\\Local' },
        homedir: 'C:\\Users\\octo',
        tmpdir: 'C:\\Temp',
        ...ioPriv
      }
    );
    assert.equal(codePriv, 0);
    assert.match(ioPriv.getOut(), /--include-private/);
    assert.match(ioPriv.getOut(), /New-ScheduledTaskAction/);

    // Actions succeeds with --public-only and --tool-ref
    const ioAct = makeIo();
    const pubCfg = path.join(base, 'lynceus.json');
    writeFileSync(pubCfg, JSON.stringify(makeConfig({ includePrivate: false })));
    const codeAct = await runCli(
      ['schedule', '--config', 'lynceus.json', '--target', 'actions', '--tool-ref', 'b'.repeat(40)],
      { cwd: base, ...ioAct }
    );
    assert.equal(codeAct, 0);
    assert.match(ioAct.getOut(), /permissions:\n {2}contents: write/);
  });
});

test('init off-CWD serves live Builder UI assets via import.meta.url, plus collect --public-only, render defaults & spawn error fallback', async () => {
  await withTempDirAsync(async (offCwd) => {
    // 1. Live bin/lynceus.mjs init --port 0 --no-open from an arbitrary off-CWD directory
    const child = spawn(process.execPath, [BIN_PATH, 'init', '--port', '0', '--no-open'], {
      cwd: offCwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      const url = await new Promise((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error(`init off-CWD timed out; stdout=${buf}`)), 8000);
        child.stdout.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          const m = /http:\/\/127\.0\.0\.1:\d+/.exec(buf);
          if (m) {
            clearTimeout(timer);
            resolve(m[0]);
          }
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`init exited early with ${code}; stdout=${buf}`));
        });
      });
      const rootRes = await fetch(`${url}/`);
      assert.equal(rootRes.status, 200);
      assert.match(await rootRes.text(), /window\.__LYNCEUS_BOOTSTRAP__/);
      const cssRes = await fetch(`${url}/styles.css`);
      assert.equal(cssRes.status, 200);
      const svgModRes = await fetch(`${url}/renderer/svg.mjs`);
      assert.equal(svgModRes.status, 200);
    } finally {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }

    // 2. collect --public-only overrides private config without requiring --include-private
    writeFileSync(path.join(offCwd, 'lynceus.json'), JSON.stringify(makeConfig({ includePrivate: true })));
    const ioPub = makeIo();
    let seenPriv = null;
    const pubCode = await runCli(['collect', '--public-only'], {
      cwd: offCwd,
      resolveTokenFn: () => ({ token: 'ghp_pubTestToken123456', sourceLabel: 'env' }),
      collectActivityFn: async ({ includePrivate }) => {
        seenPriv = includePrivate;
        return { counts: makeCounts('public'), warnings: [] };
      },
      ...ioPub
    });
    assert.equal(pubCode, 0);
    assert.equal(seenPriv, false);
    assert.ok(existsSync(path.join(offCwd, 'counts.json')));

    // 3. render uses default ./counts.json and ./agent-activity when omitted
    const ioRender = makeIo();
    const renderCode = await runCli(['render', '--owner', 'octo'], { cwd: offCwd, ...ioRender });
    assert.equal(renderCode, 0);
    assert.ok(existsSync(path.join(offCwd, 'agent-activity', 'unified-52w-light.svg')));

    // 4. Async child.on('error') fallback logs URL safely without crashing
    const ioErr = makeIo();
    let errorCb = null;
    const initCode = await runCli(['init'], {
      cwd: offCwd,
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      statSyncFn: (p) => ({ isFile: () => p === path.join('/usr/bin', 'xdg-open'), mode: 0o100755 }),
      spawnFn: () => ({
        on(ev, fn) {
          if (ev === 'error') errorCb = fn;
        },
        unref() {}
      }),
      startServerFn: async ({ port }) => ({ port, url: `http://127.0.0.1:${port}` }),
      ...ioErr
    });
    assert.equal(initCode, 0);
    assert.equal(typeof errorCb, 'function');
    errorCb(new Error('ENOENT'));
    assert.match(ioErr.getErr(), /http:\/\/127\.0\.0\.1:4173/);
  });
});
