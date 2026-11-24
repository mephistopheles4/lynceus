/**
 * Safe refresh snippet generators for Windows Task Scheduler (.ps1), POSIX cron (.sh),
 * and GitHub Actions (.yml) (S6, threat boundaries B3/B5, Findings 11 & 12).
 */
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ValidationError,
  validateBranch,
  validateOwner,
  validateSubpath
} from '../collector/config.mjs';

export const PINNED_ACTIONS_CHECKOUT = '11bd71901bbe5b1630ceea73d27597364c9af683'; // v4.2.2
export const PINNED_ACTIONS_SETUP_NODE = '49933ea5288caeca8642d1e84afbd3f7d6820020'; // v4.4.0
export const DEFAULT_TOOL_REF = null;

const TARGETS = new Set(['task-scheduler', 'cron', 'actions']);
const SCOPE_TYPES = new Set(['user', 'org']);
const SHA40_RE = /^[0-9a-f]{40}$/i;
const PACKAGE_PIN_RE = /^lynceus@[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/;
const GIT_NAME_RE = /^[a-zA-Z0-9 ._-]{1,64}$/;
const GIT_EMAIL_RE = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const TASK_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ACTIONS_REL_PATH_RE = /^(?!-)[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/;
const FORBIDDEN_CHARS_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u2018-\u201B\u201C-\u201E"$;|<>`&]/;

const DEFAULT_BIN_PATH = fileURLToPath(new URL('../../bin/lynceus.mjs', import.meta.url));

const quotePs = (s) => `'${String(s).replace(/'/g, "''")}'`;
const quoteSh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const quoteYaml = (s) => `'${String(s).replace(/'/g, "''")}'`;

function fail(msg) {
  throw new ValidationError(msg);
}

function assertSafeChars(value, label, { disallowPercent = false } = {}) {
  if (typeof value !== 'string' || !value.isWellFormed() || FORBIDDEN_CHARS_RE.test(value)) {
    fail(`${label} contains forbidden characters`);
  }
  if (disallowPercent && value.includes('%')) {
    fail(`${label} must not contain % for cron`);
  }
}

function assertNoLeadingDash(value, label) {
  if (typeof value !== 'string' || value === '' || value.startsWith('-')) {
    fail(`${label} must not be empty or start with "-"`);
  }
}

function validateActionsRelPath(raw, label, { stripDefaultDotSlash = false } = {}) {
  assertNoLeadingDash(raw, label);
  const value = stripDefaultDotSlash && raw === './lynceus.json' ? 'lynceus.json' : raw;
  if (!ACTIONS_REL_PATH_RE.test(value)) {
    fail(`${label} must be a clean repo-relative POSIX path for actions`);
  }
  const segs = value.split('/');
  if (segs.some((s) => s === '.' || s === '..' || s.toLowerCase() === '.git')) {
    fail(`${label} must not contain ".", "..", or ".git" segments`);
  }
  assertSafeChars(value, label);
  return value;
}

function resolveLocal(pathMod, base, val) {
  if (pathMod.isAbsolute(val)) return pathMod.normalize(val);
  if (process.platform === 'win32' && path.win32.isAbsolute(val)) return val;
  return pathMod.resolve(base, val);
}

function createRealpathDeepest(pathMod, realpathSyncFn, existsSyncFn, hasCustomRealpath, hasCustomExists) {
  return function realpathDeepestExisting(targetPath) {
    let current = targetPath;
    const tail = [];
    for (;;) {
      const checkExists = hasCustomExists || !hasCustomRealpath;
      if (!checkExists || existsSyncFn(current)) {
        try {
          const resolved = realpathSyncFn(current);
          return tail.length === 0 ? resolved : pathMod.join(resolved, ...tail);
        } catch (err) {
          if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') throw err;
        }
      }
      const parent = pathMod.dirname(current);
      if (parent === current) {
        return tail.length === 0 ? current : pathMod.join(current, ...tail);
      }
      tail.unshift(pathMod.basename(current));
      current = parent;
    }
  };
}

function normalizeForCompare(p, pathMod, platform) {
  const parsed = pathMod.parse(p);
  let out = pathMod.normalize(p);
  if (out.length > parsed.root.length && out.endsWith(pathMod.sep)) {
    out = out.slice(0, -1);
  }
  return platform === 'win32' ? out.toLowerCase() : out;
}

function isInsideOrEqual(candidate, baseDir, pathMod, platform) {
  const normCandidate = normalizeForCompare(candidate, pathMod, platform);
  const normBase = normalizeForCompare(baseDir, pathMod, platform);
  const rel = pathMod.relative(normBase, normCandidate);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${pathMod.sep}`) && !pathMod.isAbsolute(rel);
}

function buildExcludedTempDirs(pathMod, platform, cwd, tmpdir, realpathSyncFn) {
  const dirs = [];
  const add = (p) => {
    if (typeof p === 'string' && p !== '') dirs.push(p);
  };
  const tryReal = (p) => {
    try {
      add(realpathSyncFn(p));
    } catch {
      // Optional OS path may not exist on this host.
    }
  };

  const resolvedTmp = resolveLocal(pathMod, cwd, tmpdir);
  add(resolvedTmp);
  tryReal(resolvedTmp);

  for (const posixTmp of ['/tmp', '/var/tmp']) {
    if (platform !== 'win32') {
      add(posixTmp);
      tryReal(posixTmp);
    } else {
      add(pathMod.resolve(cwd, posixTmp));
      tryReal(posixTmp);
    }
  }
  return dirs;
}

function normalizeOptions(options) {
  const platform = options.platform ?? process.platform;
  const target = options.target ?? (platform === 'win32' ? 'task-scheduler' : 'cron');
  if (!TARGETS.has(target)) fail('Invalid schedule target');

  const includePrivate = options.includePrivate ?? false;
  if (typeof includePrivate !== 'boolean') fail('includePrivate must be a boolean');
  if (target === 'actions' && includePrivate) {
    fail('--target actions only supports public activity (--public-only)');
  }

  let scriptPath = options.scriptPath;
  if (typeof scriptPath === 'string' && scriptPath.trim() === '') scriptPath = undefined;
  if (scriptPath === null) scriptPath = undefined;
  if (scriptPath !== undefined && typeof scriptPath !== 'string') fail('scriptPath must be a string');
  if (target === 'actions' && scriptPath !== undefined) {
    fail('--script-path is not valid with --target actions');
  }

  if (options.toolRef !== undefined && options.packagePin !== undefined) {
    fail('--tool-ref and --package-pin cannot be used together');
  }

  const owner = validateOwner(options.owner);
  const scopeType = options.scopeType ?? 'user';
  if (!SCOPE_TYPES.has(scopeType)) fail('scopeType must be "user" or "org"');
  const branch = validateBranch(options.branch ?? 'generated');
  const subpath = validateSubpath(options.subpath ?? 'agent-activity');

  const toolRef = options.toolRef;
  if (toolRef !== undefined && (typeof toolRef !== 'string' || !SHA40_RE.test(toolRef))) {
    fail('toolRef must be a 40-character hexadecimal commit SHA');
  }
  const defaultToolRef = options.defaultToolRef === undefined ? DEFAULT_TOOL_REF : options.defaultToolRef;
  if (defaultToolRef !== null && (typeof defaultToolRef !== 'string' || !SHA40_RE.test(defaultToolRef))) {
    fail('defaultToolRef must be null or a 40-character hexadecimal commit SHA');
  }
  const packagePin = options.packagePin;
  if (packagePin !== undefined && (typeof packagePin !== 'string' || !PACKAGE_PIN_RE.test(packagePin))) {
    fail('packagePin must match lynceus@<semver>');
  }

  const effectiveToolRef = toolRef ?? defaultToolRef ?? null;
  if (target === 'actions' && packagePin === undefined && effectiveToolRef === null) {
    fail('Actions workflow requires --tool-ref <40-hex-sha> or --package-pin <lynceus@version> before release');
  }

  const gitName = options.gitName ?? 'lynceus-bot';
  if (typeof gitName !== 'string' || !GIT_NAME_RE.test(gitName) || gitName.trim() === '') {
    fail('Invalid gitName');
  }
  const gitEmail = options.gitEmail ?? `${owner}@users.noreply.github.com`;
  if (typeof gitEmail !== 'string' || !GIT_EMAIL_RE.test(gitEmail)) {
    fail('Invalid gitEmail');
  }
  const taskName = options.taskName ?? 'LynceusProfileRefresh';
  if (typeof taskName !== 'string' || !TASK_NAME_RE.test(taskName)) {
    fail('Invalid taskName');
  }

  const rawConfig = options.configPath ?? './lynceus.json';
  const rawRepo = options.repoDir ?? '.';
  const rawOutDir = options.outDir;
  assertNoLeadingDash(rawConfig, 'configPath');
  assertNoLeadingDash(rawRepo, 'repoDir');
  if (rawOutDir !== undefined) assertNoLeadingDash(rawOutDir, 'outDir');
  if (scriptPath !== undefined) assertNoLeadingDash(scriptPath, 'scriptPath');

  for (const [k, v] of [
    ['owner', owner],
    ['branch', branch],
    ['subpath', subpath],
    ['gitName', gitName],
    ['gitEmail', gitEmail],
    ['taskName', taskName],
    ...(toolRef !== undefined ? [['toolRef', toolRef]] : []),
    ...(packagePin !== undefined ? [['packagePin', packagePin]] : [])
  ]) {
    assertSafeChars(v, k, { disallowPercent: target === 'cron' });
  }

  return {
    platform,
    target,
    includePrivate,
    owner,
    scopeType,
    branch,
    subpath,
    rawConfig,
    rawRepo,
    rawOutDir,
    scriptPath,
    packagePin,
    effectiveToolRef,
    gitName,
    gitEmail,
    taskName
  };
}

function buildPrivacyNotice(includePrivate) {
  return includePrivate
    ? 'WARNING: --include-private is enabled. Generated SVGs embed daily totals including private-repository activity and remain visible in public git history once pushed.'
    : '';
}

function buildPowerShellSnippet(cfg, paths) {
  const { resolvedRepo, resolvedConfig, resolvedOutDir, absScriptPath, resolvedBinPath } = paths;
  const modeFlag = cfg.includePrivate ? '--include-private' : '--public-only';
  const buildArgs = cfg.packagePin
    ? `& 'lynceus' 'build' '--config' $ConfigPath '--out-dir' $OutDir '${modeFlag}'`
    : `& 'node' ${quotePs(resolvedBinPath)} 'build' '--config' $ConfigPath '--out-dir' $OutDir '${modeFlag}'`;
  const addPattern = cfg.subpath ? `${cfg.subpath}/*.svg` : './*.svg';

  const outDirInit = resolvedOutDir
    ? `$OutDir = ${quotePs(resolvedOutDir)}\n$CleanupOutDir = $false\nNew-Item -ItemType Directory -Path $OutDir -Force | Out-Null`
    : `$OutDir = Join-Path $env:TEMP ('lynceus-' + [guid]::NewGuid().ToString('N'))\n$CleanupOutDir = $true\nNew-Item -ItemType Directory -Path $OutDir -Force | Out-Null`;

  const snippet = [
    "$ErrorActionPreference = 'Stop'",
    'Set-StrictMode -Version Latest',
    '',
    `$RepoDir = ${quotePs(resolvedRepo)}`,
    `$ConfigPath = ${quotePs(resolvedConfig)}`,
    `$TargetBranch = ${quotePs(cfg.branch)}`,
    `$Subpath = ${quotePs(cfg.subpath)}`,
    `$GitName = ${quotePs(cfg.gitName)}`,
    `$GitEmail = ${quotePs(cfg.gitEmail)}`,
    outDirInit,
    "$StageDir = Join-Path $env:TEMP ('lynceus-stage-' + [guid]::NewGuid().ToString('N'))",
    '',
    'try {',
    `  ${buildArgs}`,
    '  if ($LASTEXITCODE -ne 0) { throw "lynceus build failed with exit code $LASTEXITCODE" }',
    '',
    "  $SymrefLines = & 'git' '-C' $RepoDir 'ls-remote' '--symref' 'origin' 'HEAD'",
    "  if ($LASTEXITCODE -ne 0) { throw 'git ls-remote --symref origin HEAD failed' }",
    '  $DefaultBranch = $null',
    '  foreach ($line in $SymrefLines) {',
    "    if ($line -match '^ref:\\s+refs/heads/([^\\s]+)\\s+HEAD$') {",
    '      $DefaultBranch = $Matches[1]',
    '      break',
    '    }',
    '  }',
    "  if ([string]::IsNullOrEmpty($DefaultBranch)) { throw 'Could not resolve remote default branch from origin HEAD' }",
    '  if ($DefaultBranch.Equals($TargetBranch, [System.StringComparison]::OrdinalIgnoreCase)) {',
    '    throw "Refusing to push to remote default branch \'$DefaultBranch\'"',
    '  }',
    '',
    '  $BranchRef = "refs/heads/$TargetBranch"',
    "  $HeadLines = & 'git' '-C' $RepoDir 'ls-remote' '--heads' 'origin' $BranchRef",
    '  if ($LASTEXITCODE -ne 0) { throw "git ls-remote --heads failed for $BranchRef" }',
    '  $OldSha = $null',
    '  foreach ($line in $HeadLines) {',
    "    if ($line -match '^([0-9a-f]{40})\\s+') {",
    '      $OldSha = $Matches[1]',
    '      break',
    '    }',
    '  }',
    '',
    "  $OriginLines = @(& 'git' '-C' $RepoDir 'remote' 'get-url' 'origin')",
    "  if ($LASTEXITCODE -ne 0 -or $OriginLines.Count -eq 0 -or [string]::IsNullOrWhiteSpace($OriginLines[0])) { throw 'Failed to resolve origin remote URL' }",
    '  $OriginUrl = $OriginLines[0].Trim()',
    '',
    '  New-Item -ItemType Directory -Path $StageDir -Force | Out-Null',
    "  & 'git' '-C' $StageDir 'init' '-q'",
    "  if ($LASTEXITCODE -ne 0) { throw 'git init failed' }",
    "  & 'git' '-C' $StageDir 'remote' 'add' 'origin' $OriginUrl",
    "  if ($LASTEXITCODE -ne 0) { throw 'git remote add failed' }",
    '',
    '  $DestDir = if ($Subpath) { Join-Path $StageDir $Subpath } else { $StageDir }',
    '  New-Item -ItemType Directory -Path $DestDir -Force | Out-Null',
    "  $SvgFiles = @(Get-ChildItem -LiteralPath $OutDir -Filter '*.svg' -File)",
    "  if ($SvgFiles.Count -eq 0) { throw 'No SVG files produced by lynceus build' }",
    '  $SvgFiles | Copy-Item -Destination $DestDir -Force',
    '',
    `  & 'git' '-C' $StageDir 'add' '--' ${quotePs(addPattern)}`,
    "  if ($LASTEXITCODE -ne 0) { throw 'git add failed' }",
    "  $NewTreeLines = @(& 'git' '-C' $StageDir 'write-tree')",
    "  if ($LASTEXITCODE -ne 0 -or $NewTreeLines.Count -eq 0 -or [string]::IsNullOrWhiteSpace($NewTreeLines[0])) { throw 'git write-tree failed' }",
    '  $NewTree = $NewTreeLines[0].Trim()',
    '',
    '  if ($OldSha) {',
    "    & 'git' '-C' $StageDir 'fetch' '--depth=1' 'origin' $BranchRef",
    '    if ($LASTEXITCODE -ne 0) { throw "git fetch failed for $BranchRef" }',
    "    $OldTreeLines = @(& 'git' '-C' $StageDir 'rev-parse' 'FETCH_HEAD^{tree}')",
    '    if ($LASTEXITCODE -eq 0 -and $OldTreeLines.Count -gt 0 -and $OldTreeLines[0].Trim() -eq $NewTree) {',
    '      return',
    '    }',
    '  }',
    '',
    "  $UtcNow = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss+0000')",
    '  $env:GIT_AUTHOR_NAME = $GitName',
    '  $env:GIT_AUTHOR_EMAIL = $GitEmail',
    '  $env:GIT_AUTHOR_DATE = $UtcNow',
    '  $env:GIT_COMMITTER_NAME = $GitName',
    '  $env:GIT_COMMITTER_EMAIL = $GitEmail',
    '  $env:GIT_COMMITTER_DATE = $UtcNow',
    "  $CommitLines = @(& 'git' '-C' $StageDir '-c' \"user.name=$GitName\" '-c' \"user.email=$GitEmail\" '-c' 'commit.gpgsign=false' '-c' 'tag.gpgsign=false' 'commit-tree' $NewTree '-m' 'Update Lynceus bot activity SVGs')",
    "  if ($LASTEXITCODE -ne 0 -or $CommitLines.Count -eq 0 -or [string]::IsNullOrWhiteSpace($CommitLines[0])) { throw 'git commit-tree failed' }",
    '  $CommitSha = $CommitLines[0].Trim()',
    "  & 'git' '-C' $StageDir 'update-ref' 'HEAD' $CommitSha",
    "  if ($LASTEXITCODE -ne 0) { throw 'git update-ref failed' }",
    '',
    '  if ($OldSha) {',
    "    & 'git' '-C' $StageDir 'push' \"--force-with-lease=${BranchRef}:${OldSha}\" 'origin' \"HEAD:${BranchRef}\"",
    '  } else {',
    "    & 'git' '-C' $StageDir 'push' 'origin' \"HEAD:${BranchRef}\"",
    '  }',
    '  if ($LASTEXITCODE -ne 0) { throw "git push failed for $BranchRef" }',
    '} finally {',
    '  if ($CleanupOutDir -and (Test-Path -LiteralPath $OutDir)) {',
    '    Remove-Item -LiteralPath $OutDir -Recurse -Force -ErrorAction SilentlyContinue',
    '  }',
    '  if (Test-Path -LiteralPath $StageDir) {',
    '    Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue',
    '  }',
    '}',
    ''
  ].join('\n');

  const escapedArgPath = absScriptPath.replace(/'/g, "''");
  const actionLine = `New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${escapedArgPath}"'`;
  const instructions = [
    `1. Save this script to a user-private folder outside your git repository: ${absScriptPath}`,
    '   Ensure user-only ACL permissions on the script file (e.g. inherit disabled, current user full control only).',
    '2. Register the daily Task Scheduler job under your own Windows user session (with GITHUB_TOKEN/GH_TOKEN or gh auth configured):',
    `   $Action = ${actionLine}`,
    "   $Trigger = New-ScheduledTaskTrigger -Daily -At '06:00'",
    '   $Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable',
    `   Register-ScheduledTask -TaskName ${quotePs(cfg.taskName)} -Action $Action -Trigger $Trigger -Settings $Settings`
  ].join('\n');

  return {
    snippet,
    filename: paths.pathMod.basename(absScriptPath),
    scriptPath: absScriptPath,
    instructions,
    privacyNotice: buildPrivacyNotice(cfg.includePrivate)
  };
}

function buildCronSnippet(cfg, paths) {
  const { resolvedRepo, resolvedConfig, resolvedOutDir, absScriptPath, resolvedBinPath } = paths;
  const modeFlag = cfg.includePrivate ? '--include-private' : '--public-only';
  const buildCmd = cfg.packagePin
    ? `'lynceus' 'build' '--config' "$CONFIG_PATH" '--out-dir' "$OUT_DIR" '${modeFlag}'`
    : `'node' ${quoteSh(resolvedBinPath)} 'build' '--config' "$CONFIG_PATH" '--out-dir' "$OUT_DIR" '${modeFlag}'`;

  const outSetup = resolvedOutDir
    ? `OUT_DIR=${quoteSh(resolvedOutDir)}\nCLEANUP_OUT=0\nmkdir -p -- "$OUT_DIR"`
    : 'OUT_DIR=$(mktemp -d)\nCLEANUP_OUT=1';

  const snippet = [
    '#!/bin/sh',
    'set -eu',
    'umask 077',
    '',
    `REPO_DIR=${quoteSh(resolvedRepo)}`,
    `CONFIG_PATH=${quoteSh(resolvedConfig)}`,
    `TARGET_BRANCH=${quoteSh(cfg.branch)}`,
    `SUBPATH=${quoteSh(cfg.subpath)}`,
    `GIT_NAME=${quoteSh(cfg.gitName)}`,
    `GIT_EMAIL=${quoteSh(cfg.gitEmail)}`,
    outSetup,
    'STAGE_DIR=$(mktemp -d)',
    '',
    'cleanup() {',
    '  if [ "$CLEANUP_OUT" -eq 1 ]; then',
    '    rm -rf -- "$OUT_DIR"',
    '  fi',
    '  rm -rf -- "$STAGE_DIR"',
    '}',
    'trap cleanup EXIT HUP INT TERM',
    '',
    buildCmd,
    '',
    'SYMREF_OUT=$(git -C "$REPO_DIR" ls-remote --symref origin HEAD)',
    'DEFAULT_BRANCH=$(printf \'%s\\n\' "$SYMREF_OUT" | sed -n \'s/^ref: refs\\/heads\\/\\([^[:space:]]*\\)[[:space:]]*HEAD$/\\1/p\' | head -n 1)',
    '[ -n "$DEFAULT_BRANCH" ] || { printf \'%s\\n\' "Could not resolve remote default branch" >&2; exit 1; }',
    'DEFAULT_LOWER=$(printf \'%s\' "$DEFAULT_BRANCH" | tr \'[:upper:]\' \'[:lower:]\')',
    'TARGET_LOWER=$(printf \'%s\' "$TARGET_BRANCH" | tr \'[:upper:]\' \'[:lower:]\')',
    'if [ "$DEFAULT_LOWER" = "$TARGET_LOWER" ]; then',
    '  printf \'%s\\n\' "Refusing to push to remote default branch" >&2',
    '  exit 1',
    'fi',
    '',
    'BRANCH_REF="refs/heads/$TARGET_BRANCH"',
    'HEADS_OUT=$(git -C "$REPO_DIR" ls-remote --heads origin "$BRANCH_REF")',
    'OLD_SHA=$(printf \'%s\\n\' "$HEADS_OUT" | awk \'{print $1; exit}\')',
    'ORIGIN_URL=$(git -C "$REPO_DIR" remote get-url origin)',
    '[ -n "$ORIGIN_URL" ] || { printf \'%s\\n\' "Failed to resolve origin URL" >&2; exit 1; }',
    '',
    'git -C "$STAGE_DIR" init -q',
    'git -C "$STAGE_DIR" remote add origin "$ORIGIN_URL"',
    '',
    'if [ -n "$SUBPATH" ]; then',
    '  DEST_DIR="$STAGE_DIR/$SUBPATH"',
    'else',
    '  DEST_DIR="$STAGE_DIR"',
    'fi',
    'mkdir -p -- "$DEST_DIR"',
    'SVG_COUNT=0',
    'for svg in "$OUT_DIR"/*.svg; do',
    '  [ -f "$svg" ] || continue',
    '  cp -- "$svg" "$DEST_DIR/"',
    '  SVG_COUNT=$((SVG_COUNT + 1))',
    'done',
    '[ "$SVG_COUNT" -gt 0 ] || { printf \'%s\\n\' "No SVG files produced by lynceus build" >&2; exit 1; }',
    '',
    'if [ -n "$SUBPATH" ]; then',
    '  git -C "$STAGE_DIR" add -- "$SUBPATH"/*.svg',
    'else',
    '  git -C "$STAGE_DIR" add -- ./*.svg',
    'fi',
    '',
    'NEW_TREE=$(git -C "$STAGE_DIR" write-tree)',
    'if [ -n "$OLD_SHA" ]; then',
    '  git -C "$STAGE_DIR" fetch --depth=1 origin "$BRANCH_REF"',
    '  OLD_TREE=$(git -C "$STAGE_DIR" rev-parse \'FETCH_HEAD^{tree}\' 2>/dev/null || true)',
    '  if [ "$OLD_TREE" = "$NEW_TREE" ]; then',
    '    exit 0',
    '  fi',
    'fi',
    '',
    'UTC_NOW=$(date -u \'+%Y-%m-%dT%H:%M:%S+0000\')',
    'COMMIT_SHA=$(GIT_AUTHOR_NAME="$GIT_NAME" GIT_AUTHOR_EMAIL="$GIT_EMAIL" GIT_AUTHOR_DATE="$UTC_NOW" GIT_COMMITTER_NAME="$GIT_NAME" GIT_COMMITTER_EMAIL="$GIT_EMAIL" GIT_COMMITTER_DATE="$UTC_NOW" git -C "$STAGE_DIR" -c "user.name=$GIT_NAME" -c "user.email=$GIT_EMAIL" -c commit.gpgsign=false -c tag.gpgsign=false commit-tree "$NEW_TREE" -m \'Update Lynceus bot activity SVGs\')',
    'git -C "$STAGE_DIR" update-ref HEAD "$COMMIT_SHA"',
    '',
    'if [ -n "$OLD_SHA" ]; then',
    '  git -C "$STAGE_DIR" push "--force-with-lease=$BRANCH_REF:$OLD_SHA" origin "HEAD:$BRANCH_REF"',
    'else',
    '  git -C "$STAGE_DIR" push origin "HEAD:$BRANCH_REF"',
    'fi',
    ''
  ].join('\n');

  const quotedShPath = quoteSh(absScriptPath);
  const quotedParent = quoteSh(paths.pathMod.dirname(absScriptPath));
  const instructions = [
    `1. Save this script to a user-private path outside your git repository and lock permissions:`,
    `   mkdir -p -- ${quotedParent}`,
    `   chmod 600 ${quotedShPath}`,
    '2. Ensure your crontab defines PATH containing Node 24+ and git (e.g. PATH=/usr/local/bin:/usr/bin:/bin) plus GITHUB_TOKEN/GH_TOKEN or gh auth.',
    '3. Add this cron entry with `crontab -e`:',
    `   0 6 * * * /bin/sh ${quotedShPath}`
  ].join('\n');

  return {
    snippet,
    filename: paths.pathMod.basename(absScriptPath),
    scriptPath: absScriptPath,
    instructions,
    privacyNotice: buildPrivacyNotice(cfg.includePrivate)
  };
}

function buildActionsSnippet(cfg) {
  const normConfig = validateActionsRelPath(cfg.rawConfig, 'configPath', { stripDefaultDotSlash: true });
  const normOutDir = cfg.rawOutDir !== undefined ? validateActionsRelPath(cfg.rawOutDir, 'outDir') : '';

  const toolStep = cfg.packagePin
    ? [
        '      - name: Install Lynceus',
        '        env:',
        `          LYNCEUS_PACKAGE_PIN: ${quoteYaml(cfg.packagePin)}`,
        '        run: npm install -g -- "$LYNCEUS_PACKAGE_PIN" --ignore-scripts'
      ]
    : [
        '      - name: Checkout Lynceus tool',
        `        uses: actions/checkout@${PINNED_ACTIONS_CHECKOUT}`,
        '        with:',
        "          repository: 'mephistopheles4/lynceus'",
        `          ref: ${quoteYaml(cfg.effectiveToolRef)}`,
        "          path: '.lynceus-tool'",
        '          persist-credentials: false'
      ];

  const buildCmd = cfg.packagePin
    ? 'lynceus build --config "$LYNCEUS_CONFIG_PATH" --out-dir "$OUT_DIR" --public-only'
    : 'node .lynceus-tool/bin/lynceus.mjs build --config "$LYNCEUS_CONFIG_PATH" --out-dir "$OUT_DIR" --public-only';

  const snippet = [
    'name: Lynceus Activity Graph',
    '',
    'on:',
    '  schedule:',
    "    - cron: '0 6 * * *'",
    '  workflow_dispatch: {}',
    '',
    'permissions:',
    '  contents: write',
    '',
    'jobs:',
    '  update-activity:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Checkout repository',
    `        uses: actions/checkout@${PINNED_ACTIONS_CHECKOUT}`,
    '',
    '      - name: Setup Node.js',
    `        uses: actions/setup-node@${PINNED_ACTIONS_SETUP_NODE}`,
    '        with:',
    "          node-version: '24'",
    '',
    ...toolStep,
    '',
    '      - name: Build and push SVG activity graph',
    '        env:',
    '          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    `          LYNCEUS_CONFIG_PATH: ${quoteYaml(normConfig)}`,
    `          LYNCEUS_OUT_DIR: ${quoteYaml(normOutDir)}`,
    `          LYNCEUS_BRANCH: ${quoteYaml(cfg.branch)}`,
    `          LYNCEUS_SUBPATH: ${quoteYaml(cfg.subpath)}`,
    `          LYNCEUS_GIT_NAME: ${quoteYaml(cfg.gitName)}`,
    `          LYNCEUS_GIT_EMAIL: ${quoteYaml(cfg.gitEmail)}`,
    '        run: |',
    '          set -eu',
    '          umask 077',
    '          STAGE_DIR=$(mktemp -d)',
    '          if [ -n "$LYNCEUS_OUT_DIR" ]; then',
    '            OUT_DIR="$LYNCEUS_OUT_DIR"',
    '            CLEANUP_OUT=0',
    '            mkdir -p -- "$OUT_DIR"',
    '          else',
    '            OUT_DIR=$(mktemp -d)',
    '            CLEANUP_OUT=1',
    '          fi',
    '          cleanup() {',
    '            if [ "$CLEANUP_OUT" -eq 1 ]; then',
    '              rm -rf -- "$OUT_DIR"',
    '            fi',
    '            rm -rf -- "$STAGE_DIR"',
    '          }',
    '          trap cleanup EXIT HUP INT TERM',
    `          ${buildCmd}`,
    '          SYMREF_OUT=$(git ls-remote --symref origin HEAD)',
    '          DEFAULT_BRANCH=$(printf \'%s\\n\' "$SYMREF_OUT" | sed -n \'s/^ref: refs\\/heads\\/\\([^[:space:]]*\\)[[:space:]]*HEAD$/\\1/p\' | head -n 1)',
    '          [ -n "$DEFAULT_BRANCH" ] || { printf \'%s\\n\' "Could not resolve remote default branch" >&2; exit 1; }',
    '          DEFAULT_LOWER=$(printf \'%s\' "$DEFAULT_BRANCH" | tr \'[:upper:]\' \'[:lower:]\')',
    '          TARGET_LOWER=$(printf \'%s\' "$LYNCEUS_BRANCH" | tr \'[:upper:]\' \'[:lower:]\')',
    '          if [ "$DEFAULT_LOWER" = "$TARGET_LOWER" ]; then',
    '            printf \'%s\\n\' "Refusing to push to remote default branch" >&2',
    '            exit 1',
    '          fi',
    '          BRANCH_REF="refs/heads/$LYNCEUS_BRANCH"',
    '          HEADS_OUT=$(git ls-remote --heads origin "$BRANCH_REF")',
    '          OLD_SHA=$(printf \'%s\\n\' "$HEADS_OUT" | awk \'{print $1; exit}\')',
    '          ORIGIN_URL=$(git remote get-url origin)',
    '          git -C "$STAGE_DIR" init -q',
    '          git -C "$STAGE_DIR" remote add origin "$ORIGIN_URL"',
    '          if [ -n "$LYNCEUS_SUBPATH" ]; then',
    '            DEST_DIR="$STAGE_DIR/$LYNCEUS_SUBPATH"',
    '          else',
    '            DEST_DIR="$STAGE_DIR"',
    '          fi',
    '          mkdir -p -- "$DEST_DIR"',
    '          SVG_COUNT=0',
    '          for svg in "$OUT_DIR"/*.svg; do',
    '            [ -f "$svg" ] || continue',
    '            cp -- "$svg" "$DEST_DIR/"',
    '            SVG_COUNT=$((SVG_COUNT + 1))',
    '          done',
    '          [ "$SVG_COUNT" -gt 0 ] || { printf \'%s\\n\' "No SVG files produced by lynceus build" >&2; exit 1; }',
    '          if [ -n "$LYNCEUS_SUBPATH" ]; then',
    '            git -C "$STAGE_DIR" add -- "$LYNCEUS_SUBPATH"/*.svg',
    '          else',
    '            git -C "$STAGE_DIR" add -- ./*.svg',
    '          fi',
    '          NEW_TREE=$(git -C "$STAGE_DIR" write-tree)',
    '          if [ -n "$OLD_SHA" ]; then',
    '            git -C "$STAGE_DIR" fetch --depth=1 origin "$BRANCH_REF"',
    '            OLD_TREE=$(git -C "$STAGE_DIR" rev-parse \'FETCH_HEAD^{tree}\' 2>/dev/null || true)',
    '            if [ "$OLD_TREE" = "$NEW_TREE" ]; then',
    '              exit 0',
    '            fi',
    '          fi',
    '          UTC_NOW=$(date -u \'+%Y-%m-%dT%H:%M:%S+0000\')',
    '          COMMIT_SHA=$(GIT_AUTHOR_NAME="$LYNCEUS_GIT_NAME" GIT_AUTHOR_EMAIL="$LYNCEUS_GIT_EMAIL" GIT_AUTHOR_DATE="$UTC_NOW" GIT_COMMITTER_NAME="$LYNCEUS_GIT_NAME" GIT_COMMITTER_EMAIL="$LYNCEUS_GIT_EMAIL" GIT_COMMITTER_DATE="$UTC_NOW" git -C "$STAGE_DIR" -c "user.name=$LYNCEUS_GIT_NAME" -c "user.email=$LYNCEUS_GIT_EMAIL" -c commit.gpgsign=false -c tag.gpgsign=false commit-tree "$NEW_TREE" -m \'Update Lynceus bot activity SVGs\')',
    '          git -C "$STAGE_DIR" update-ref HEAD "$COMMIT_SHA"',
    '          if [ -n "$OLD_SHA" ]; then',
    '            git -C "$STAGE_DIR" push "--force-with-lease=$BRANCH_REF:$OLD_SHA" origin "HEAD:$BRANCH_REF"',
    '          else',
    '            git -C "$STAGE_DIR" push origin "HEAD:$BRANCH_REF"',
    '          fi',
    ''
  ].join('\n');

  const instructions = [
    '1. Save this workflow to .github/workflows/lynceus.yml and commit your public lynceus.json config.',
    '2. Note: The default GITHUB_TOKEN in GitHub Actions can only query the current repository (or public GitHub search within its permissions).',
    '   For organization-wide or multi-repository public scans, configure a read-only public-repo PAT secret if needed.',
    '3. Actions workflows always run with --public-only and never push counts.json.'
  ].join('\n');

  return {
    snippet,
    filename: 'lynceus.yml',
    scriptPath: '.github/workflows/lynceus.yml',
    instructions,
    privacyNotice: ''
  };
}

/**
 * Generate a safe refresh snippet and instructions for `task-scheduler`, `cron`, or `actions`.
 * @param {object} options
 * @returns {{ snippet: string, filename: string, scriptPath: string, instructions: string, privacyNotice: string }}
 */
export function generateScheduleSnippet(options = {}) {
  if (options === null || typeof options !== 'object') fail('Schedule options must be an object');
  const cfg = normalizeOptions(options);
  if (cfg.target === 'actions') return buildActionsSnippet(cfg);

  const pathMod = cfg.platform === 'win32' ? path.win32 : path.posix;
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const tmpdir = options.tmpdir ?? os.tmpdir();
  const hasCustomRealpath = typeof options.realpathSyncFn === 'function';
  const hasCustomExists = typeof options.existsSyncFn === 'function';
  const realpathSyncFn = options.realpathSyncFn ?? realpathSync;
  const existsSyncFn = options.existsSyncFn ?? existsSync;
  const realpathDeepestExisting = createRealpathDeepest(
    pathMod, realpathSyncFn, existsSyncFn, hasCustomRealpath, hasCustomExists
  );

  const resolvedCwd = resolveLocal(pathMod, cwd, cwd);
  const resolvedRepo = resolveLocal(pathMod, resolvedCwd, cfg.rawRepo);
  const resolvedConfig = resolveLocal(pathMod, resolvedCwd, cfg.rawConfig);
  const resolvedOutDir = cfg.rawOutDir !== undefined ? resolveLocal(pathMod, resolvedCwd, cfg.rawOutDir) : undefined;
  const resolvedBinPath = resolveLocal(pathMod, resolvedCwd, options.binPath ?? DEFAULT_BIN_PATH);
  const resolvedNodePath = resolveLocal(pathMod, resolvedCwd, options.nodePath ?? process.execPath);

  const realRepo = realpathDeepestExisting(resolvedRepo);
  const realConfig = realpathDeepestExisting(resolvedConfig);
  const excludedTempDirs = buildExcludedTempDirs(pathMod, cfg.platform, resolvedCwd, tmpdir, realpathSyncFn);

  let rawScriptPath = cfg.scriptPath;
  if (rawScriptPath === undefined) {
    const configOutsideRepo = !isInsideOrEqual(realConfig, realRepo, pathMod, cfg.platform);
    const configOutsideTemp = !excludedTempDirs.some((d) => isInsideOrEqual(realConfig, d, pathMod, cfg.platform));
    if (configOutsideRepo && configOutsideTemp) {
      const baseName = cfg.target === 'task-scheduler' ? 'lynceus-refresh.ps1' : 'lynceus-refresh.sh';
      rawScriptPath = pathMod.join(pathMod.dirname(resolvedConfig), baseName);
    } else if (cfg.target === 'task-scheduler') {
      const localAppData = typeof env?.LOCALAPPDATA === 'string' && env.LOCALAPPDATA.trim() !== ''
        ? env.LOCALAPPDATA
        : pathMod.join(homedir, 'AppData', 'Local');
      rawScriptPath = pathMod.join(localAppData, 'lynceus', 'lynceus-refresh.ps1');
    } else {
      const stateHome = typeof env?.XDG_STATE_HOME === 'string' && env.XDG_STATE_HOME.trim() !== ''
        ? env.XDG_STATE_HOME
        : pathMod.join(homedir, '.local', 'state');
      rawScriptPath = pathMod.join(stateHome, 'lynceus', 'lynceus-refresh.sh');
    }
  }

  const absScriptPath = resolveLocal(pathMod, resolvedCwd, rawScriptPath);
  const realScriptPath = realpathDeepestExisting(absScriptPath);

  if (isInsideOrEqual(realScriptPath, realRepo, pathMod, cfg.platform)) {
    fail('Schedule script path must be outside the repository directory');
  }
  if (excludedTempDirs.some((d) => isInsideOrEqual(realScriptPath, d, pathMod, cfg.platform))) {
    fail('Schedule script path must not be inside a shared temporary directory');
  }

  const disallowPercent = cfg.target === 'cron';
  const toCheck = [
    ['cwd', resolvedCwd],
    ['repoDir', resolvedRepo],
    ['configPath', resolvedConfig],
    ['scriptPath', absScriptPath],
    ['binPath', resolvedBinPath],
    ['nodePath', resolvedNodePath]
  ];
  if (resolvedOutDir !== undefined) toCheck.push(['outDir', resolvedOutDir]);
  for (const [label, val] of toCheck) {
    assertSafeChars(val, label, { disallowPercent });
  }
  if (cfg.target === 'task-scheduler' && absScriptPath.endsWith('\\')) {
    fail('PowerShell scriptPath must not end with a trailing backslash');
  }

  const paths = { pathMod, resolvedRepo, resolvedConfig, resolvedOutDir, absScriptPath, resolvedBinPath, resolvedNodePath };
  return cfg.target === 'task-scheduler' ? buildPowerShellSnippet(cfg, paths) : buildCronSnippet(cfg, paths);
}
