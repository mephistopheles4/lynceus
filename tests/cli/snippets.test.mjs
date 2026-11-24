import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ValidationError } from '../../src/collector/config.mjs';
import {
  DEFAULT_TOOL_REF,
  PINNED_ACTIONS_CHECKOUT,
  PINNED_ACTIONS_SETUP_NODE,
  generateScheduleSnippet
} from '../../src/cli/snippets.mjs';

const SHA_A = 'a'.repeat(40);
const isWin = process.platform === 'win32';

function withTempDir(fn) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'lynceus-snip-'));
  try {
    return fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function baseWinOpts(overrides = {}) {
  return {
    target: 'task-scheduler',
    owner: 'octo',
    platform: 'win32',
    cwd: 'C:\\Work\\repo',
    repoDir: '.',
    configPath: './lynceus.json',
    binPath: 'C:\\Tools\\lynceus\\bin\\lynceus.mjs',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    env: { LOCALAPPDATA: 'C:\\Users\\octo\\AppData\\Local' },
    homedir: 'C:\\Users\\octo',
    tmpdir: 'C:\\Users\\octo\\AppData\\Local\\Temp',
    realpathSyncFn: (p) => p,
    existsSyncFn: () => false,
    ...overrides
  };
}

function basePosixOpts(overrides = {}) {
  return {
    target: 'cron',
    owner: 'octo',
    platform: 'linux',
    cwd: '/home/octo/repo',
    repoDir: '.',
    configPath: './lynceus.json',
    binPath: '/usr/local/lib/lynceus/bin/lynceus.mjs',
    nodePath: '/usr/local/bin/node',
    env: { XDG_STATE_HOME: '/home/octo/.local/state', HOME: '/home/octo' },
    homedir: '/home/octo',
    tmpdir: '/tmp',
    realpathSyncFn: (p) => p,
    existsSyncFn: () => false,
    ...overrides
  };
}

function baseActionsOpts(overrides = {}) {
  return {
    target: 'actions',
    owner: 'octo',
    toolRef: SHA_A,
    ...overrides
  };
}

test('pinned Actions SHAs and pre-publish DEFAULT_TOOL_REF contract', () => {
  assert.match(PINNED_ACTIONS_CHECKOUT, /^[0-9a-f]{40}$/);
  assert.match(PINNED_ACTIONS_SETUP_NODE, /^[0-9a-f]{40}$/);
  assert.equal(DEFAULT_TOOL_REF, null);
});

test('blank or whitespace scriptPath is treated as omitted before path.resolve() across targets', () => {
  for (const blank of ['', '   ', '\t']) {
    const ps = generateScheduleSnippet(baseWinOpts({ scriptPath: blank }));
    assert.equal(ps.scriptPath, 'C:\\Users\\octo\\AppData\\Local\\lynceus\\lynceus-refresh.ps1');
    assert.equal(ps.filename, 'lynceus-refresh.ps1');

    const sh = generateScheduleSnippet(basePosixOpts({ scriptPath: blank }));
    assert.equal(sh.scriptPath, '/home/octo/.local/state/lynceus/lynceus-refresh.sh');
    assert.equal(sh.filename, 'lynceus-refresh.sh');

    const yml = generateScheduleSnippet(baseActionsOpts({ scriptPath: blank }));
    assert.equal(yml.filename, 'lynceus.yml');
  }
});

test('default private scriptPath picks sibling to non-repo non-temp config, else state dir', () => {
  const siblingPs = generateScheduleSnippet(baseWinOpts({
    configPath: 'D:\\Private\\lynceus-private.json'
  }));
  assert.equal(siblingPs.scriptPath, 'D:\\Private\\lynceus-refresh.ps1');

  const fallbackWinCase = generateScheduleSnippet(baseWinOpts({
    cwd: 'C:\\Work\\Repo',
    configPath: 'c:\\work\\repo\\sub\\lynceus.json'
  }));
  assert.equal(fallbackWinCase.scriptPath, 'C:\\Users\\octo\\AppData\\Local\\lynceus\\lynceus-refresh.ps1');

  const siblingSh = generateScheduleSnippet(basePosixOpts({
    configPath: '/home/octo/private/lynceus.json'
  }));
  assert.equal(siblingSh.scriptPath, '/home/octo/private/lynceus-refresh.sh');

  const fallbackPosixTempCfg = generateScheduleSnippet(basePosixOpts({
    configPath: '/tmp/lynceus.json'
  }));
  assert.equal(fallbackPosixTempCfg.scriptPath, '/home/octo/.local/state/lynceus/lynceus-refresh.sh');
});

test('Finding 11: rejects scriptPath inside repoDir, os.tmpdir, /tmp, /private/tmp, /var/tmp, and symlinked ancestors', () => {
  for (const bad of [
    'C:\\Work\\repo\\refresh.ps1',
    'c:\\work\\repo\\sub\\refresh.ps1',
    'C:\\Users\\octo\\AppData\\Local\\Temp\\refresh.ps1'
  ]) {
    assert.throws(
      () => generateScheduleSnippet(baseWinOpts({ scriptPath: bad })),
      (e) => e instanceof ValidationError && e.exitCode === 2,
      bad
    );
  }

  // Simulated macOS /tmp -> /private/tmp and /var/tmp -> /private/var/tmp aliases
  const darwinOpts = (extra = {}) => basePosixOpts({
    platform: 'darwin',
    tmpdir: '/var/folders/xx/T',
    realpathSyncFn: (p) => {
      if (p === '/tmp') return '/private/tmp';
      if (p === '/var/tmp') return '/private/var/tmp';
      if (p === '/var/folders/xx/T') return '/private/var/folders/xx/T';
      if (p === '/private/tmp') return '/private/tmp';
      if (p === '/private/var/tmp') return '/private/var/tmp';
      if (p === '/home/octo/repo') return '/home/octo/repo';
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    },
    ...extra
  });

  for (const bad of [
    '/tmp/lynceus.sh',
    '/private/tmp/lynceus.sh',
    '/private/tmp/nested/new-sub/lynceus.sh',
    '/var/tmp/lynceus.sh',
    '/private/var/tmp/lynceus.sh',
    '/private/var/folders/xx/T/lynceus.sh'
  ]) {
    assert.throws(
      () => generateScheduleSnippet(darwinOpts({ scriptPath: bad })),
      (e) => e instanceof ValidationError && e.exitCode === 2,
      bad
    );
  }

  // Real filesystem symlinked ancestor test with deepest existing ancestor realpathSync
  withTempDir((base) => {
    const repoDir = path.join(base, 'repo');
    const linkDir = path.join(base, 'link-to-repo');
    mkdirSync(repoDir);
    symlinkSync(repoDir, linkDir, 'junction');
    assert.throws(
      () => generateScheduleSnippet({
        target: 'task-scheduler',
        owner: 'octo',
        cwd: base,
        repoDir,
        configPath: path.join(repoDir, 'lynceus.json'),
        scriptPath: path.join(linkDir, 'missing-child', 'deep', 'refresh.ps1')
      }),
      (e) => e instanceof ValidationError && e.exitCode === 2
    );
  });

  // Config with symlinked ancestor resolving into repo must NOT become sibling scriptPath
  const symlinkCfgRes = generateScheduleSnippet(basePosixOpts({
    existsSyncFn: (p) => ['/home/octo/alias-dir', '/home/octo/repo', '/tmp', '/var/tmp'].includes(p),
    realpathSyncFn: (p) => {
      if (p === '/home/octo/alias-dir') return '/home/octo/repo';
      if (p === '/home/octo/repo') return '/home/octo/repo';
      if (p === '/tmp' || p === '/var/tmp') return p;
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    },
    configPath: '/home/octo/alias-dir/nonexistent/lynceus.json'
  }));
  assert.equal(symlinkCfgRes.scriptPath, '/home/octo/.local/state/lynceus/lynceus-refresh.sh');
});

test('Finding 12: POSIX cron escapes single quotes in <abs-sh-path> across crontab, chmod 600, and script', () => {
  const shPath = "/home/o'connor/lynceus-private/bot's-refresh.sh";
  const res = generateScheduleSnippet(basePosixOpts({
    scriptPath: shPath,
    includePrivate: true
  }));

  const expectedQuoted = "'/home/o'\\''connor/lynceus-private/bot'\\''s-refresh.sh'";
  assert.ok(res.instructions.includes(`chmod 600 ${expectedQuoted}`), res.instructions);
  assert.ok(res.instructions.includes(`0 6 * * * /bin/sh ${expectedQuoted}`), res.instructions);
  assert.ok(res.snippet.startsWith('#!/bin/sh\n'));
  assert.ok(res.snippet.includes('mkdir -p -- '));
  assert.ok(res.snippet.includes('cp -- '));
  assert.ok(res.snippet.includes('rm -rf -- '));
  assert.ok(res.snippet.includes("'--include-private'"));
  assert.match(res.privacyNotice, /--include-private/);

  // Verify crontab line itself has zero % characters
  const cronLine = res.instructions.split('\n').find((l) => l.includes('/bin/sh'));
  assert.ok(cronLine && !cronLine.includes('%'));
});

test('strict character, metacharacter, leading-dash, trailing-backslash, and cron-% rejections', () => {
  // Leading dash on path inputs across all targets
  for (const field of ['configPath', 'repoDir', 'outDir', 'scriptPath']) {
    assert.throws(
      () => generateScheduleSnippet(baseWinOpts({ [field]: '-evil' })),
      ValidationError,
      `win32 ${field}`
    );
  }
  for (const field of ['configPath', 'repoDir', 'outDir']) {
    assert.throws(
      () => generateScheduleSnippet(baseActionsOpts({ [field]: '-evil' })),
      ValidationError,
      `actions ${field}`
    );
  }

  // Trailing backslash on PowerShell scriptPath
  assert.throws(
    () => generateScheduleSnippet(baseWinOpts({ scriptPath: 'D:\\Private\\refresh.ps1\\' })),
    ValidationError
  );

  // Forbidden chars across params and resolved paths (post-resolve)
  const badChars = ['a\rb', 'a\nb', 'a\u0085b', 'a\u2028b', 'a\u2029b', 'a\u2018b', 'a\u201Cb', 'a"b', 'a$b', 'a`b', 'a;b', 'a|b', 'a<b', 'a>b', 'a&b'];
  for (const ch of badChars) {
    assert.throws(() => generateScheduleSnippet(baseWinOpts({ outDir: `D:\\Safe\\${ch}` })), ValidationError);
    assert.throws(() => generateScheduleSnippet(baseWinOpts({ cwd: `C:\\Repo\\${ch}`, binPath: 'C:\\Tools\\bin.mjs' })), ValidationError);
    assert.throws(() => generateScheduleSnippet(baseWinOpts({ binPath: `C:\\Tools\\${ch}.mjs` })), ValidationError);
    assert.throws(() => generateScheduleSnippet(baseWinOpts({ nodePath: `C:\\Node\\${ch}.exe` })), ValidationError);
  }

  // cron % rejections across all resolved local paths and gitEmail
  for (const field of ['cwd', 'repoDir', 'configPath', 'outDir', 'scriptPath', 'binPath', 'nodePath']) {
    const val = field === 'repoDir' ? '/home/octo/100%repo' : '/home/octo/100%dir/item';
    assert.throws(() => generateScheduleSnippet(basePosixOpts({ [field]: val })), ValidationError, `cron % ${field}`);
  }
  assert.throws(() => generateScheduleSnippet(basePosixOpts({ gitEmail: 'a%b@example.com' })), ValidationError);

  // Branch, subpath, packagePin, toolRef, conflict validations
  for (const badBranch of ['main', 'master', 'HEAD', 'refs/heads/gen', 'heads/gen', 'tags/v1', 'remotes/origin/gen']) {
    assert.throws(() => generateScheduleSnippet(baseWinOpts({ branch: badBranch })), ValidationError);
  }
  for (const badSub of ['../x', 'a/.git', 'a/.']) {
    assert.throws(() => generateScheduleSnippet(baseWinOpts({ subpath: badSub })), ValidationError);
  }
  for (const badPin of ['@scope/lynceus@0.1.0', 'other-pkg@0.1.0', 'lynceus@latest', 'lynceus']) {
    assert.throws(() => generateScheduleSnippet(baseActionsOpts({ toolRef: undefined, packagePin: badPin })), ValidationError);
  }
  assert.throws(
    () => generateScheduleSnippet(baseActionsOpts({ toolRef: SHA_A, packagePin: 'lynceus@0.1.0' })),
    ValidationError
  );
  assert.throws(
    () => generateScheduleSnippet(baseActionsOpts({ scriptPath: 's.sh' })),
    ValidationError
  );
  assert.throws(
    () => generateScheduleSnippet(baseActionsOpts({ includePrivate: true })),
    ValidationError
  );
});

test('actions YAML pre-publish gating, defaultToolRef seam, relative path rules, and security invariants', () => {
  // Pre-publish: defaultToolRef === null without toolRef/packagePin fails
  assert.throws(
    () => generateScheduleSnippet({ target: 'actions', owner: 'octo' }),
    ValidationError
  );

  // Injectable defaultToolRef resolves cleanly
  const yml = generateScheduleSnippet({
    target: 'actions',
    owner: 'octo',
    defaultToolRef: SHA_A,
    configPath: './lynceus.json',
    outDir: 'dist/svgs'
  });
  assert.equal(yml.privacyNotice, '');
  assert.match(yml.snippet, /on:\n {2}schedule:\n {4}- cron: '0 6 \* \* \*'\n {2}workflow_dispatch: \{\}/);
  assert.match(yml.snippet, /permissions:\n {2}contents: write/);
  assert.ok(yml.snippet.includes(`uses: actions/checkout@${PINNED_ACTIONS_CHECKOUT}`));
  assert.ok(yml.snippet.includes(`uses: actions/setup-node@${PINNED_ACTIONS_SETUP_NODE}`));
  assert.ok(yml.snippet.includes("node-version: '24'"));
  assert.ok(yml.snippet.includes("repository: 'mephistopheles4/lynceus'"));
  assert.ok(yml.snippet.includes(`ref: '${SHA_A}'`));
  assert.ok(yml.snippet.includes("path: '.lynceus-tool'"));
  assert.ok(yml.snippet.includes('persist-credentials: false'));
  assert.ok(yml.snippet.includes("LYNCEUS_CONFIG_PATH: 'lynceus.json'"));
  assert.ok(yml.snippet.includes("LYNCEUS_OUT_DIR: 'dist/svgs'"));
  assert.ok(yml.snippet.includes('--public-only'));

  // Zero ${{ }} inside run:
  const runSection = yml.snippet.split('run: |')[1];
  assert.ok(runSection && !runSection.includes('${{'));

  // packagePin post-publish mode
  const pkgYml = generateScheduleSnippet({
    target: 'actions',
    owner: 'octo',
    packagePin: 'lynceus@0.1.0'
  });
  assert.ok(pkgYml.snippet.includes("LYNCEUS_PACKAGE_PIN: 'lynceus@0.1.0'"));
  assert.ok(pkgYml.snippet.includes('npm install -g -- "$LYNCEUS_PACKAGE_PIN" --ignore-scripts'));
  assert.ok(!pkgYml.snippet.includes('.lynceus-tool'));

  // Reject dot-segments, .git, leading /, backslashes on actions configPath / outDir
  for (const bad of ['./other.json', '../lynceus.json', '.git/config', 'a/.git/b', '/etc/lynceus.json', 'a\\b.json']) {
    assert.throws(() => generateScheduleSnippet(baseActionsOpts({ configPath: bad })), ValidationError, `cfg ${bad}`);
    assert.throws(() => generateScheduleSnippet(baseActionsOpts({ outDir: bad })), ValidationError, `out ${bad}`);
  }
});

test('PowerShell .ps1 generation, quoting, cleanup isolation, and real PowerShell AST parse', { skip: !isWin }, () => {
  const variants = [
    generateScheduleSnippet(baseWinOpts({ scriptPath: "D:\\O'Connor\\lynceus-refresh.ps1" })),
    generateScheduleSnippet(baseWinOpts({ outDir: 'D:\\Explicit\\Out', includePrivate: true, subpath: '' })),
    generateScheduleSnippet(baseWinOpts({ packagePin: 'lynceus@0.1.0', gitName: 'Lynceus Bot' }))
  ];

  // Verify PowerShell AST parser reports 0 syntax errors on every variant
  const psCheck = [
    "$code = [Console]::In.ReadToEnd()",
    '$tokens = $null; $errors = $null',
    '[void][System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$tokens, [ref]$errors)',
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }'
  ].join('; ');

  for (const v of variants) {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCheck], {
      input: v.snippet,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }

  // Verify specific contract strings
  const [apostropheRes, explicitOutRes, pkgRes] = variants;
  assert.ok(apostropheRes.snippet.includes("& 'node' 'C:\\Tools\\lynceus\\bin\\lynceus.mjs' 'build'"));
  assert.ok(apostropheRes.snippet.includes('$CleanupOutDir = $true'));
  assert.ok(
    apostropheRes.instructions.includes(
      "New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"D:\\O''Connor\\lynceus-refresh.ps1\"'"
    )
  );
  assert.equal(apostropheRes.privacyNotice, '');

  assert.ok(explicitOutRes.snippet.includes('$CleanupOutDir = $false'));
  assert.ok(explicitOutRes.snippet.includes("'--include-private'"));
  assert.ok(explicitOutRes.snippet.includes("'./*.svg'"));
  assert.match(explicitOutRes.privacyNotice, /--include-private/);

  assert.ok(pkgRes.snippet.includes("& 'lynceus' 'build'"));
});

test('C11 end-to-end bare-remote orphan push, no-op skip, force-replace, and default-branch guard', { skip: !isWin }, () => {
  withTempDir((base) => {
    const bare = path.join(base, 'remote.git');
    const work = path.join(base, 'work');
    const cfgDir = path.join(base, 'private-cfg');
    const outDir = path.join(base, 'private-out');
    const mockBin = path.join(base, 'mock-bin.mjs');
    mkdirSync(cfgDir);

    // Prepare mock CLI binary that writes SVGs AND a decoy counts.json (which must never be staged!)
    writeFileSync(
      mockBin,
      [
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import path from 'node:path';",
        "const args = process.argv.slice(2);",
        "const outIdx = args.indexOf('--out-dir');",
        "const outDir = args[outIdx + 1];",
        "const cfgIdx = args.indexOf('--config');",
        "const cfg = JSON.parse(readFileSync(args[cfgIdx + 1], 'utf8'));",
        "mkdirSync(outDir, { recursive: true });",
        "writeFileSync(path.join(outDir, 'unified-52w-light.svg'), `<svg>${cfg.marker}</svg>`);",
        "writeFileSync(path.join(outDir, 'unified-52w-dark.svg'), `<svg>${cfg.marker}-dark</svg>`);",
        "writeFileSync(path.join(outDir, 'counts.json'), JSON.stringify({ secret: true }));"
      ].join('\n')
    );

    const cfgPath = path.join(cfgDir, 'lynceus.json');
    writeFileSync(cfgPath, JSON.stringify({ marker: 'v1' }));

    // Init bare repo with main default branch and one commit on main
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'pipe' });
    execFileSync('git', ['clone', bare, work], { stdio: 'pipe' });
    execFileSync('git', ['-C', work, 'config', 'user.name', 'Init'], { stdio: 'pipe' });
    execFileSync('git', ['-C', work, 'config', 'user.email', 'init@example.com'], { stdio: 'pipe' });
    execFileSync('git', ['-C', work, 'config', 'commit.gpgsign', 'false'], { stdio: 'pipe' });
    writeFileSync(path.join(work, 'README.md'), '# Profile\n');
    execFileSync('git', ['-C', work, 'add', 'README.md'], { stdio: 'pipe' });
    execFileSync('git', ['-C', work, 'commit', '-m', 'Initial main commit'], { stdio: 'pipe' });
    execFileSync('git', ['-C', work, 'push', 'origin', 'main'], { stdio: 'pipe' });
    const mainShaBefore = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();

    // Note: pass tmpdir outside `base` so explicit scriptPath under `base/private-cfg` passes exclusion check
    const res = generateScheduleSnippet({
      target: 'task-scheduler',
      owner: 'octo',
      branch: 'generated',
      subpath: 'agent-activity',
      repoDir: work,
      configPath: cfgPath,
      outDir,
      binPath: mockBin,
      tmpdir: path.join(base, 'fake-tmp-not-used')
    });
    const ps1Path = res.scriptPath;
    writeFileSync(ps1Path, res.snippet, 'utf8');

    // 1. First run: creates single orphan commit on refs/heads/generated
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], {
      stdio: 'pipe'
    });
    const genSha1 = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/generated'], { encoding: 'utf8' }).trim();
    assert.match(genSha1, /^[0-9a-f]{40}$/);
    assert.equal(
      execFileSync('git', ['--git-dir', bare, 'rev-list', '--count', 'refs/heads/generated'], { encoding: 'utf8' }).trim(),
      '1'
    );
    assert.equal(
      execFileSync('git', ['--git-dir', bare, 'show', '-s', '--format=%P|%an|%ae|%ad|%G?', 'refs/heads/generated'], {
        encoding: 'utf8'
      }).trim().split('|')[0],
      ''
    );
    const meta = execFileSync('git', ['--git-dir', bare, 'show', '-s', '--format=%an|%ae|%ad|%G?', 'refs/heads/generated'], {
      encoding: 'utf8'
    }).trim();
    assert.match(meta, /^lynceus-bot\|octo@users\.noreply\.github\.com\|.*\+0000\|N$/);

    const treeFiles = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'refs/heads/generated'], {
      encoding: 'utf8'
    }).trim().split(/\r?\n/).sort();
    assert.deepEqual(treeFiles, ['agent-activity/unified-52w-dark.svg', 'agent-activity/unified-52w-light.svg']);
    assert.equal(
      execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim(),
      mainShaBefore
    );
    assert.equal(existsSync(path.join(outDir, 'unified-52w-light.svg')), true, 'explicit outDir preserved');

    // 2. Second run with identical SVGs: skips push cleanly (SHA unchanged)
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], {
      stdio: 'pipe'
    });
    const genSha2 = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/generated'], { encoding: 'utf8' }).trim();
    assert.equal(genSha2, genSha1);

    // 3. Third run with updated SVG: force-replaces orphan commit cleanly
    writeFileSync(cfgPath, JSON.stringify({ marker: 'v2' }));
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], {
      stdio: 'pipe'
    });
    const genSha3 = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/generated'], { encoding: 'utf8' }).trim();
    assert.notEqual(genSha3, genSha1);
    assert.equal(
      execFileSync('git', ['--git-dir', bare, 'rev-list', '--count', 'refs/heads/generated'], { encoding: 'utf8' }).trim(),
      '1'
    );
    assert.equal(
      execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim(),
      mainShaBefore
    );

    // 4. Non-main default branch ('trunk') guard rejects pushing to trunk
    const trunkBare = path.join(base, 'trunk-remote.git');
    const trunkWork = path.join(base, 'trunk-work');
    execFileSync('git', ['init', '--bare', '--initial-branch=trunk', trunkBare], { stdio: 'pipe' });
    execFileSync('git', ['clone', trunkBare, trunkWork], { stdio: 'pipe' });
    execFileSync('git', ['-C', trunkWork, 'config', 'user.name', 'Init'], { stdio: 'pipe' });
    execFileSync('git', ['-C', trunkWork, 'config', 'user.email', 'init@example.com'], { stdio: 'pipe' });
    execFileSync('git', ['-C', trunkWork, 'config', 'commit.gpgsign', 'false'], { stdio: 'pipe' });
    writeFileSync(path.join(trunkWork, 'README.md'), '# Trunk\n');
    execFileSync('git', ['-C', trunkWork, 'add', 'README.md'], { stdio: 'pipe' });
    execFileSync('git', ['-C', trunkWork, 'commit', '-m', 'Initial trunk commit'], { stdio: 'pipe' });
    execFileSync('git', ['-C', trunkWork, 'push', 'origin', 'trunk'], { stdio: 'pipe' });
    const trunkShaBefore = execFileSync('git', ['--git-dir', trunkBare, 'rev-parse', 'refs/heads/trunk'], { encoding: 'utf8' }).trim();

    const trunkRes = generateScheduleSnippet({
      target: 'task-scheduler',
      owner: 'octo',
      branch: 'trunk',
      repoDir: trunkWork,
      configPath: cfgPath,
      scriptPath: path.join(cfgDir, 'trunk-refresh.ps1'),
      binPath: mockBin,
      tmpdir: path.join(base, 'fake-tmp-not-used')
    });
    writeFileSync(trunkRes.scriptPath, trunkRes.snippet, 'utf8');
    assert.throws(
      () => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', trunkRes.scriptPath], {
        stdio: 'pipe'
      })
    );
    assert.equal(
      execFileSync('git', ['--git-dir', trunkBare, 'rev-parse', 'refs/heads/trunk'], { encoding: 'utf8' }).trim(),
      trunkShaBefore
    );
  });
});
