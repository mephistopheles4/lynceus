import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runBuild, runSchedule } from '../../src/cli/commands.mjs';
import { generateScheduleSnippet } from '../../src/cli/snippets.mjs';
import { normalizeConfig } from '../../src/collector/config.mjs';
import { PrivacyGateError } from '../../src/collector/privacy-gate.mjs';
import { assertCamoSafeSvg } from '../../src/renderer/sanitize.mjs';
import {
  CANARY_STRINGS,
  makeJsonResponse,
  makeProfileAgentsConfig,
  makeRestCommitSearchPage,
  makeSearchPage
} from '../fixtures/github-mocks.mjs';

const isWin = process.platform === 'win32';

async function withTempDirAsync(fn) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'lynceus-c12-'));
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

function createCanaryProfileFetchMock(queriesSeen) {
  const botByAppBase = {
    'mephistos-homunculus': { login: 'mephistos-homunculus[bot]', count: 2 },
    'mephistos-euphorion': { login: 'mephistos-euphorion[bot]', count: 1 },
    'mephistos-wagner': { login: 'mephistos-wagner[bot]', count: 3 }
  };

  const resolveBot = (q) => {
    for (const [base, info] of Object.entries(botByAppBase)) {
      if (q.includes(`app/${base}`) || q.includes(`author:${info.login}`)) {
        return { base, ...info };
      }
    }
    throw new Error(`Unexpected query bot: ${q}`);
  };

  return async (href, init = {}) => {
    if (href === 'https://api.github.com/graphql') {
      const payload = JSON.parse(init.body);
      const q = payload.variables?.q ?? '';
      queriesSeen.push(q);
      assert.equal(q.includes('is:public'), false, `Private query must omit is:public: ${q}`);
      assert.ok(q.includes('user:mephistopheles4'), `Expected user:mephistopheles4 scope in ${q}`);

      const bot = resolveBot(q);
      const actor = { __typename: 'Bot', login: bot.base };

      if (q.startsWith('is:pr is:merged')) {
        return makeJsonResponse(
          makeSearchPage({
            issueCount: 1,
            nodes: [{
              __typename: 'PullRequest',
              id: `${CANARY_STRINGS.nodeId}_merged_${bot.base}`,
              title: CANARY_STRINGS.prTitle,
              url: CANARY_STRINGS.url,
              repository: { nameWithOwner: CANARY_STRINGS.repoName },
              createdAt: '2026-11-23T10:00:00Z',
              mergedAt: '2026-11-24T09:00:00Z',
              author: actor
            }]
          }),
          { headers: { 'x-oauth-scopes': 'repo' } }
        );
      }

      if (q.startsWith('is:pr reviewed-by:')) {
        return makeJsonResponse(
          makeSearchPage({
            issueCount: 1,
            nodes: [{
              __typename: 'PullRequest',
              id: `${CANARY_STRINGS.nodeId}_rev_${bot.base}`,
              title: CANARY_STRINGS.prTitle,
              url: CANARY_STRINGS.url,
              repository: { nameWithOwner: CANARY_STRINGS.repoName },
              reviews: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{
                  id: `PRR_${bot.base}_1`,
                  createdAt: '2026-11-24T11:00:00Z',
                  author: actor
                }]
              }
            }]
          }),
          { headers: { 'x-oauth-scopes': 'repo' } }
        );
      }

      if (q.startsWith('commenter:')) {
        return makeJsonResponse(
          makeSearchPage({
            issueCount: 1,
            nodes: [{
              __typename: 'Issue',
              id: `${CANARY_STRINGS.nodeId}_cmt_${bot.base}`,
              title: CANARY_STRINGS.prTitle,
              url: CANARY_STRINGS.url,
              repository: { nameWithOwner: CANARY_STRINGS.repoName },
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{
                  id: `IC_${bot.base}_1`,
                  createdAt: '2026-11-24T11:30:00Z',
                  author: actor
                }]
              }
            }]
          }),
          { headers: { 'x-oauth-scopes': 'repo' } }
        );
      }

      if (q.startsWith('is:issue')) {
        return makeJsonResponse(
          makeSearchPage({
            issueCount: 1,
            nodes: [{
              __typename: 'Issue',
              id: `${CANARY_STRINGS.nodeId}_iss_${bot.base}`,
              title: CANARY_STRINGS.prTitle,
              url: CANARY_STRINGS.url,
              repository: { nameWithOwner: CANARY_STRINGS.repoName },
              createdAt: '2026-11-22T08:00:00Z',
              author: actor
            }]
          }),
          { headers: { 'x-oauth-scopes': 'repo' } }
        );
      }

      // prsOpened
      return makeJsonResponse(
        makeSearchPage({
          issueCount: bot.count,
          nodes: Array.from({ length: bot.count }, (_, idx) => ({
            __typename: 'PullRequest',
            id: `${CANARY_STRINGS.nodeId}_pr_${bot.base}_${idx}`,
            title: CANARY_STRINGS.prTitle,
            url: CANARY_STRINGS.url,
            repository: { nameWithOwner: CANARY_STRINGS.repoName },
            createdAt: '2026-11-24T08:00:00Z',
            mergedAt: null,
            author: actor
          }))
        }),
        { headers: { 'x-oauth-scopes': 'repo' } }
      );
    }

    const url = new URL(href);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(url.pathname, '/search/commits');
    const q = url.searchParams.get('q') ?? '';
    queriesSeen.push(q);
    assert.equal(q.includes('is:public'), false, `Private commit query must omit is:public: ${q}`);
    const bot = resolveBot(q);

    return makeJsonResponse(
      makeRestCommitSearchPage({
        totalCount: 1,
        items: [{
          sha: `${CANARY_STRINGS.sha.slice(0, 32)}${bot.base.slice(0, 8)}`,
          html_url: CANARY_STRINGS.url,
          repository: { full_name: CANARY_STRINGS.repoName },
          commit: {
            message: CANARY_STRINGS.prTitle,
            author: { date: '2026-11-24T12:00:00Z' }
          }
        }]
      }),
      { headers: { 'x-oauth-scopes': 'repo' } }
    );
  };
}

test('C12: locked mephistopheles4/mephistopheles4 config matches S8 specification', () => {
  const raw = makeProfileAgentsConfig();
  const normalized = normalizeConfig(raw);

  assert.equal(normalized.owner, 'mephistopheles4');
  assert.equal(normalized.scopeType, 'user');
  assert.equal(normalized.includePrivate, true);
  assert.equal(normalized.layout, 'separate');
  assert.equal(normalized.windowWeeks, 52);
  assert.equal(normalized.detail, 'breakdown');
  assert.equal(normalized.markStyle, 'squares');
  assert.equal(normalized.labelMode, 'friendly');
  assert.equal(normalized.branch, 'generated');
  assert.equal(normalized.subpath, 'agent-activity');
  assert.equal(normalized.markdownBase, 'raw');
  assert.deepEqual(normalized.metrics, {
    prsOpened: true,
    prsMerged: true,
    commits: true,
    reviews: true,
    comments: true,
    issues: true
  });
  assert.deepEqual(normalized.agents, [
    { slug: 'mephistos-homunculus[bot]', label: 'Homunculus', ramp: 'emerald' },
    { slug: 'mephistos-euphorion[bot]', label: 'Euphorion', ramp: 'cobalt' },
    { slug: 'mephistos-wagner[bot]', label: 'Wagner', ramp: 'amber' }
  ]);
});

test('C12: mocked runBuild writes 6 Light/Dark SVGs, omits counts.json by default, emits 3 <picture> blocks, and leaks zero canaries', async () => {
  await withTempDirAsync(async (base) => {
    const cfgPath = path.join(base, 'lynceus-private.json');
    const outDir = path.join(base, 'agent-activity');
    writeFileSync(cfgPath, JSON.stringify(makeProfileAgentsConfig()), 'utf8');

    // Private config without --include-private is rejected before any GitHub API call
    await assert.rejects(
      () => runBuild({ config: cfgPath, outDir, date: '2026-11-24' }, { cwd: base, ...makeIo() }),
      (err) => err instanceof PrivacyGateError && err.exitCode === 2
    );

    const queriesSeen = [];
    const io = makeIo();
    const code = await runBuild(
      { config: cfgPath, outDir, includePrivate: true, date: '2026-11-24' },
      {
        cwd: base,
        env: { GITHUB_TOKEN: CANARY_STRINGS.token },
        fetchFn: createCanaryProfileFetchMock(queriesSeen),
        sleepFn: async () => {},
        nowFn: () => Date.parse('2026-11-24T12:00:00Z'),
        ...io
      }
    );

    assert.equal(code, 0);
    assert.ok(queriesSeen.length > 0);
    assert.equal(io.getErr(), '');

    // Zero counts.json written unless --counts-out is explicitly passed
    assert.equal(existsSync(path.join(base, 'counts.json')), false);
    assert.equal(existsSync(path.join(outDir, 'counts.json')), false);

    // Exactly 6 separate Light/Dark SVGs for the 3 bots
    const expectedAgents = [
      { stem: 'mephistos-homunculus', slug: 'mephistos-homunculus[bot]', label: 'Homunculus' },
      { stem: 'mephistos-euphorion', slug: 'mephistos-euphorion[bot]', label: 'Euphorion' },
      { stem: 'mephistos-wagner', slug: 'mephistos-wagner[bot]', label: 'Wagner' }
    ];

    const svgContents = [];
    for (const agent of expectedAgents) {
      for (const theme of ['light', 'dark']) {
        const filePath = path.join(outDir, `${agent.stem}-52w-${theme}.svg`);
        assert.equal(existsSync(filePath), true, `Missing SVG ${filePath}`);
        const svg = readFileSync(filePath, 'utf8');
        assertCamoSafeSvg(svg);
        assert.ok(svg.includes(agent.label), `Expected friendly label ${agent.label} in ${filePath}`);
        assert.ok(svg.includes(agent.slug), `Expected bot slug ${agent.slug} in ${filePath}`);
        assert.ok(Buffer.byteLength(svg, 'utf8') <= 45 * 1024, `SVG exceeds 45 KB budget: ${filePath}`);
        svgContents.push(svg);
      }
    }

    // Markdown output contains 3 <picture> blocks pointing to mephistopheles4/mephistopheles4/generated/agent-activity
    const md = io.getOut();
    const pictureMatches = md.match(/<picture>/g) ?? [];
    assert.equal(pictureMatches.length, 3);
    for (const agent of expectedAgents) {
      const darkUrl = `https://raw.githubusercontent.com/mephistopheles4/mephistopheles4/generated/agent-activity/${agent.stem}-52w-dark.svg`;
      const lightUrl = `https://raw.githubusercontent.com/mephistopheles4/mephistopheles4/generated/agent-activity/${agent.stem}-52w-light.svg`;
      assert.ok(md.includes(`media="(prefers-color-scheme: dark)" srcset="${darkUrl}"`), `Missing dark source for ${agent.stem}`);
      assert.ok(md.includes(`media="(prefers-color-scheme: light)" srcset="${lightUrl}"`), `Missing light source for ${agent.stem}`);
      assert.ok(md.includes(`alt="${agent.label} activity over the last 52 weeks"`), `Missing alt text for ${agent.label}`);
      assert.ok(md.includes(`src="${lightUrl}"`), `Missing img fallback for ${agent.stem}`);
    }

    // Zero canary private repo names, PR titles, URLs, node IDs, SHAs, or tokens in SVGs, stdout, or stderr
    const emitted = [...svgContents, md, io.getErr()].join('\n');
    for (const canary of [
      CANARY_STRINGS.repoName,
      CANARY_STRINGS.prTitle,
      CANARY_STRINGS.url,
      CANARY_STRINGS.nodeId,
      CANARY_STRINGS.sha.slice(0, 32),
      CANARY_STRINGS.token,
      CANARY_STRINGS.ssoSlug
    ]) {
      assert.ok(!emitted.includes(canary), `Leaked canary string: ${canary}`);
    }

    // Optional --counts-out persists validated public+private counts.json cleanly without leaks
    const countsOut = path.join(base, 'private-counts', 'counts.json');
    const codeWithCounts = await runBuild(
      { config: cfgPath, outDir, countsOut, includePrivate: true, date: '2026-11-24', quiet: true },
      {
        cwd: base,
        env: { GITHUB_TOKEN: CANARY_STRINGS.token },
        fetchFn: createCanaryProfileFetchMock([]),
        sleepFn: async () => {},
        nowFn: () => Date.parse('2026-11-24T12:00:00Z'),
        ...makeIo()
      }
    );
    assert.equal(codeWithCounts, 0);
    assert.equal(existsSync(countsOut), true);
    if (!isWin) assert.equal(statSync(countsOut).mode & 0o777, 0o600);
    const countsRaw = readFileSync(countsOut, 'utf8');
    const parsedCounts = JSON.parse(countsRaw);
    assert.equal(parsedCounts.scope.mode, 'public+private');
    assert.equal(parsedCounts.agents.length, 3);
    assert.ok(!countsRaw.includes(CANARY_STRINGS.repoName));
    assert.ok(!countsRaw.includes(CANARY_STRINGS.prTitle));
    assert.ok(!countsRaw.includes(CANARY_STRINGS.url));
  });
});

test('C12: generateScheduleSnippet and runSchedule produce hardened LynceusProfileRefresh Task Scheduler .ps1', async () => {
  const direct = generateScheduleSnippet({
    target: 'task-scheduler',
    owner: 'mephistopheles4',
    scopeType: 'user',
    branch: 'generated',
    subpath: 'agent-activity',
    includePrivate: true,
    taskName: 'LynceusProfileRefresh',
    platform: 'win32',
    cwd: 'C:\\Work\\mephistopheles4',
    repoDir: '.',
    configPath: 'C:\\Users\\mephistopheles4\\AppData\\Local\\lynceus\\lynceus.json',
    binPath: 'C:\\Tools\\lynceus\\bin\\lynceus.mjs',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    env: { LOCALAPPDATA: 'C:\\Users\\mephistopheles4\\AppData\\Local' },
    homedir: 'C:\\Users\\mephistopheles4',
    tmpdir: 'C:\\Users\\mephistopheles4\\AppData\\Local\\Temp',
    realpathSyncFn: (p) => p,
    existsSyncFn: () => false
  });

  // Non-repo private .ps1 path
  assert.equal(direct.filename, 'lynceus-refresh.ps1');
  assert.equal(direct.scriptPath, 'C:\\Users\\mephistopheles4\\AppData\\Local\\lynceus\\lynceus-refresh.ps1');
  assert.equal(direct.scriptPath.toLowerCase().startsWith('c:\\work\\mephistopheles4'), false);

  // & 'node' invocation, SVGs-only orphan generated push, zero counts.json staging
  assert.ok(direct.snippet.includes("& 'node' 'C:\\Tools\\lynceus\\bin\\lynceus.mjs' 'build' '--config' $ConfigPath '--out-dir' $OutDir '--include-private'"));
  assert.ok(direct.snippet.includes("$TargetBranch = 'generated'"));
  assert.ok(direct.snippet.includes("$Subpath = 'agent-activity'"));
  assert.ok(direct.snippet.includes("$GitName = 'lynceus-bot'"));
  assert.ok(direct.snippet.includes("$GitEmail = 'mephistopheles4@users.noreply.github.com'"));
  assert.ok(direct.snippet.includes("& 'git' '-C' $StageDir 'add' '--' 'agent-activity/*.svg'"));
  assert.ok(direct.snippet.includes('"--force-with-lease=${BranchRef}:${OldSha}"'));
  assert.ok(direct.snippet.includes("'commit-tree'"));
  assert.equal(direct.snippet.includes('counts.json'), false, 'Schedule script must never reference or stage counts.json');

  // Task Scheduler registration instructions
  assert.ok(direct.instructions.includes("Register-ScheduledTask -TaskName 'LynceusProfileRefresh'"));
  assert.ok(
    direct.instructions.includes(
      "New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:\\Users\\mephistopheles4\\AppData\\Local\\lynceus\\lynceus-refresh.ps1\"'"
    )
  );
  assert.match(direct.privacyNotice, /--include-private/);

  // Real PowerShell AST syntax verification on Windows
  if (isWin) {
    const psCheck = [
      '$code = [Console]::In.ReadToEnd()',
      '$tokens = $null; $errors = $null',
      '[void][System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$tokens, [ref]$errors)',
      'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }'
    ].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCheck], {
      input: direct.snippet,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }

  // Also verify runSchedule end-to-end against a serialized locked config
  await withTempDirAsync(async (base) => {
    const repoDir = path.join(base, 'profile-repo');
    const privateDir = path.join(base, 'private-lynceus');
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(privateDir, { recursive: true });

    const cfgPath = path.join(privateDir, 'lynceus.json');
    writeFileSync(cfgPath, JSON.stringify(makeProfileAgentsConfig()), 'utf8');

    // Gate: omitting --include-private on private config fails
    await assert.rejects(
      () => runSchedule(
        { config: cfgPath, target: 'task-scheduler', taskName: 'LynceusProfileRefresh', repoDir },
        { cwd: repoDir, platform: 'win32', ...makeIo() }
      ),
      (err) => err instanceof PrivacyGateError && err.exitCode === 2
    );

    // Gate: --target actions forbids --include-private
    await assert.rejects(
      () => runSchedule(
        { config: cfgPath, target: 'actions', includePrivate: true, toolRef: 'a'.repeat(40), repoDir },
        { cwd: repoDir, ...makeIo() }
      ),
      (err) => err instanceof PrivacyGateError && err.exitCode === 2
    );

    const io = makeIo();
    const code = await runSchedule(
      {
        config: cfgPath,
        target: 'task-scheduler',
        includePrivate: true,
        taskName: 'LynceusProfileRefresh',
        repoDir
      },
      {
        cwd: repoDir,
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\mephistopheles4\\AppData\\Local' },
        homedir: 'C:\\Users\\mephistopheles4',
        ...io
      }
    );

    assert.equal(code, 0);
    const out = io.getOut();
    assert.match(out, /WARNING: --include-private is enabled/);
    const expectedScriptPath = 'C:\\Users\\mephistopheles4\\AppData\\Local\\lynceus\\lynceus-refresh.ps1';
    assert.ok(out.includes(`# Target path: ${expectedScriptPath}`));
    assert.ok(out.includes("& 'node' "));
    assert.ok(out.includes("Register-ScheduledTask -TaskName 'LynceusProfileRefresh'"));
    assert.ok(
      out.includes(
        `New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${expectedScriptPath}"'`
      )
    );
    assert.ok(out.includes("& 'git' '-C' $StageDir 'add' '--' 'agent-activity/*.svg'"));
    assert.equal(out.includes('counts.json'), false);
  });
});

test('C12: README.md documents prerequisites, quickstart commands, and --include-private public-history caveat', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Node\.js\s*`?>=\s*24\.0\.0`?/);
  assert.match(readme, /GITHUB_TOKEN/);
  assert.match(readme, /GH_TOKEN/);
  assert.match(readme, /gh auth login/);
  for (const cmd of ['init', 'collect', 'render', 'build', 'schedule']) {
    assert.ok(readme.includes(cmd), `README.md missing subcommand ${cmd}`);
  }
  assert.match(readme, /--include-private/);
  assert.match(readme, /public repository git history/i);
  assert.match(readme, /counts\.json/);
  // No workstation-specific paths leaked into universal README
  for (const bad of ['C:\\Users', 'H:\\src', '/Users/', '/home/']) {
    assert.equal(readme.includes(bad), false, `README.md must not contain workstation path ${bad}`);
  }
});
