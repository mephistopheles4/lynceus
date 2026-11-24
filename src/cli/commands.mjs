/**
 * CLI command orchestrators (`init`, `collect`, `render`, `build`, `schedule`) and `runCli` (S6).
 * Enforces private-activity gates, safe browser launches, bounded JSON reads, atomic writes,
 * and secret-scrubbed stderr reporting across exit codes 0, 2, 3, 4, and 5.
 */
import { execFileSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthError, resolveSafeExecutable, resolveToken } from '../collector/auth.mjs';
import { collectActivity } from '../collector/collect.mjs';
import { ValidationError } from '../collector/config.mjs';
import { discoverBots, validateBotSlug } from '../collector/discover.mjs';
import { PrivacyGateError, redactSecrets } from '../collector/privacy-gate.mjs';
import { renderMarkdownSnippet } from '../renderer/markdown.mjs';
import { CamoSafetyError } from '../renderer/sanitize.mjs';
import { renderSvgs } from '../renderer/svg.mjs';
import { CLI_VERSION, EXIT_CODES, UsageError, formatHelpText, parseCliArgs } from './args.mjs';
import { loadConfigFile, loadCountsFile } from './config.mjs';
import { FsSafeError, writeSvgArtifact, writeVerifiedJson } from './fs-safe.mjs';
import { generateScheduleSnippet } from './snippets.mjs';

const DEFAULT_CONFIG_FILE = './lynceus.json';
const DEFAULT_COUNTS_FILE = './counts.json';
const DEFAULT_OUT_DIR = './agent-activity';
const DEFAULT_PORT = 4173;

function getDeps(deps = {}) {
  const env = deps.env ?? process.env;
  return {
    cwd: deps.cwd ?? process.cwd(),
    env,
    platform: deps.platform ?? process.platform,
    tmpdir: deps.tmpdir ?? os.tmpdir(),
    homedir: deps.homedir ?? os.homedir(),
    systemRoot: deps.systemRoot ?? env?.SystemRoot ?? process.env.SystemRoot,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    fsOps: deps.fsOps,
    statSyncFn: deps.statSyncFn ?? statSync,
    execFileSyncFn: deps.execFileSyncFn ?? execFileSync,
    spawnFn: deps.spawnFn ?? spawn,
    startServerFn: deps.startServerFn,
    resolveTokenFn: deps.resolveTokenFn ?? resolveToken,
    discoverBotsFn: deps.discoverBotsFn ?? discoverBots,
    validateBotSlugFn: deps.validateBotSlugFn ?? validateBotSlug,
    collectActivityFn: deps.collectActivityFn ?? collectActivity,
    fetchFn: deps.fetchFn,
    sleepFn: deps.sleepFn,
    nowFn: deps.nowFn,
    defaultToolRef: deps.defaultToolRef,
    binPath: deps.binPath,
    nodePath: deps.nodePath,
    realpathSyncFn: deps.realpathSyncFn,
    existsSyncFn: deps.existsSyncFn
  };
}

function resolvePrivateGate(configIncludePrivate, options, { actionsTarget = false } = {}) {
  if (options.includePrivate && options.publicOnly) {
    throw new UsageError('--include-private and --public-only cannot be used together');
  }
  if (actionsTarget) {
    if (options.includePrivate) {
      throw new PrivacyGateError('--target actions only supports public activity (--public-only)');
    }
    if (configIncludePrivate === true && !options.publicOnly) {
      throw new PrivacyGateError('Config enables includePrivate: true; pass --public-only for --target actions');
    }
    return false;
  }
  if (options.publicOnly) return false;
  if (options.includePrivate) return true;
  if (configIncludePrivate === true) {
    throw new PrivacyGateError(
      'Config enables includePrivate: true; pass --include-private to confirm or --public-only to scan public activity only'
    );
  }
  return false;
}

function requireToken(d) {
  const auth = d.resolveTokenFn({ env: d.env, execFileSyncFn: d.execFileSyncFn });
  if (!auth || typeof auth.token !== 'string' || auth.token === '') {
    throw new AuthError('GitHub authentication is required (set GITHUB_TOKEN/GH_TOKEN or run gh auth login)');
  }
  return auth;
}

function emitWarnings(warnings, d, activeToken) {
  if (!Array.isArray(warnings)) return;
  for (const w of warnings) {
    const code = w?.code ?? 'WARNING';
    const detail = redactSecrets(w?.detail ?? '', activeToken);
    d.stderr.write(`Warning [${code}]: ${detail}\n`);
  }
}

function launchBrowser(url, d) {
  const fallbackNotice = () => d.stderr.write(`Open ${url} in your browser.\n`);
  let candidate = null;
  let args = [url];

  if (d.platform === 'win32') {
    if (typeof d.systemRoot !== 'string' || d.systemRoot === '' || !path.win32.isAbsolute(d.systemRoot)) {
      fallbackNotice();
      return;
    }
    const winCandidate = path.win32.join(d.systemRoot, 'System32', 'rundll32.exe');
    try {
      if (d.statSyncFn(winCandidate).isFile()) {
        candidate = winCandidate;
        args = ['url.dll,FileProtocolHandler', url];
      }
    } catch {
      candidate = null;
    }
  } else {
    const opener = d.platform === 'darwin' ? 'open' : 'xdg-open';
    candidate = resolveSafeExecutable([opener], d.env, { platform: d.platform, statSyncFn: d.statSyncFn });
  }

  if (candidate === null) {
    fallbackNotice();
    return;
  }

  try {
    const child = d.spawnFn(candidate, args, {
      shell: false,
      cwd: d.tmpdir,
      stdio: 'ignore',
      detached: true
    });
    child?.on?.('error', fallbackNotice);
    child?.unref?.();
  } catch {
    fallbackNotice();
  }
}

async function resolveStartServer(d) {
  if (typeof d.startServerFn === 'function') return d.startServerFn;
  const serverUrl = new URL('../builder-ui/server.mjs', import.meta.url).href;
  const mod = await import(serverUrl);
  return mod.startServer;
}

function loadOptionalConfig(configPath, explicit, fsOps) {
  try {
    return loadConfigFile(configPath, { fsOps });
  } catch (err) {
    if (!explicit && err instanceof FsSafeError && err.code === 'FS_NOT_FOUND') return null;
    throw err;
  }
}

export async function runInit(options = {}, deps = {}) {
  const d = getDeps(deps);
  const explicit = options.config !== undefined;
  const configPath = path.resolve(d.cwd, options.config ?? DEFAULT_CONFIG_FILE);
  let loadedConfig = loadOptionalConfig(configPath, explicit, d.fsOps);
  if (loadedConfig !== null) {
    loadedConfig = { ...loadedConfig, includePrivate: options.includePrivate === true };
  }

  const startServer = await resolveStartServer(d);
  const serverOpts = {
    config: loadedConfig,
    allowIncludePrivate: options.includePrivate === true,
    env: d.env,
    resolveTokenFn: d.resolveTokenFn,
    discoverBotsFn: d.discoverBotsFn,
    validateBotSlugFn: d.validateBotSlugFn,
    collectActivityFn: d.collectActivityFn,
    fetchFn: d.fetchFn,
    sleepFn: d.sleepFn,
    nowFn: d.nowFn,
    defaultToolRef: d.defaultToolRef,
    binPath: d.binPath,
    nodePath: d.nodePath,
    realpathSyncFn: d.realpathSyncFn,
    existsSyncFn: d.existsSyncFn
  };

  let serverInfo;
  try {
    if (options.port !== undefined) {
      serverInfo = await startServer({ ...serverOpts, port: options.port });
    } else {
      try {
        serverInfo = await startServer({ ...serverOpts, port: DEFAULT_PORT });
      } catch (err) {
        if (err?.code === 'EADDRINUSE') {
          serverInfo = await startServer({ ...serverOpts, port: 0 });
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    if (err instanceof FsSafeError) throw err;
    const code = typeof err?.code === 'string' ? err.code : 'BIND_ERROR';
    throw new FsSafeError(`Cannot start Builder UI server (${code})`, code);
  }

  const url = serverInfo?.url ?? `http://127.0.0.1:${serverInfo?.port ?? options.port ?? DEFAULT_PORT}`;
  d.stdout.write(`Lynceus Builder UI listening at ${url}\n`);
  if (!options.noOpen) launchBrowser(url, d);
  return EXIT_CODES.OK;
}

export async function runCollect(options = {}, deps = {}) {
  const d = getDeps(deps);
  const configPath = path.resolve(d.cwd, options.config ?? DEFAULT_CONFIG_FILE);
  const config = loadConfigFile(configPath, { fsOps: d.fsOps });
  const includePrivate = resolvePrivateGate(config.includePrivate, options);
  const auth = requireToken(d);
  if (deps._onToken) deps._onToken(auth.token);

  const { counts, warnings } = await d.collectActivityFn({
    config,
    includePrivate,
    endDate: options.date,
    token: auth.token,
    fetchFn: d.fetchFn,
    sleepFn: d.sleepFn,
    nowFn: d.nowFn
  });

  const outPath = path.resolve(d.cwd, options.out ?? DEFAULT_COUNTS_FILE);
  writeVerifiedJson(outPath, counts, { cwd: d.cwd, tmpdir: d.tmpdir, platform: d.platform, fsOps: d.fsOps });

  if (!options.quiet) {
    emitWarnings(warnings, d, auth.token);
    d.stdout.write(`Wrote ${outPath}\n`);
  }
  return EXIT_CODES.OK;
}

export async function runRender(options = {}, deps = {}) {
  const d = getDeps(deps);
  const countsPath = path.resolve(d.cwd, options.counts ?? DEFAULT_COUNTS_FILE);
  const counts = loadCountsFile(countsPath, { fsOps: d.fsOps });

  const explicitConfig = options.config !== undefined;
  const configPath = path.resolve(d.cwd, options.config ?? DEFAULT_CONFIG_FILE);
  const config = loadOptionalConfig(configPath, explicitConfig, d.fsOps);

  const renderOpts = {
    owner: options.owner ?? config?.owner,
    scopeType: options.scopeType ?? config?.scopeType ?? 'user',
    layout: options.layout ?? config?.layout ?? 'unified',
    detail: options.detail ?? config?.detail ?? 'breakdown',
    markStyle: options.markStyle ?? config?.markStyle ?? 'squares',
    labelMode: options.labelMode ?? config?.labelMode ?? 'friendly',
    branch: options.branch ?? config?.branch ?? 'generated',
    subpath: options.subpath ?? config?.subpath ?? 'agent-activity',
    markdownBase: options.markdownBase ?? config?.markdownBase ?? 'raw'
  };

  if (renderOpts.markdownBase === 'raw' && !renderOpts.owner) {
    throw new UsageError('--owner is required when --markdown-base is "raw" and no lynceus.json config is present');
  }

  const svgs = renderSvgs(counts, renderOpts);
  const markdown = renderMarkdownSnippet({
    ...renderOpts,
    windowWeeks: counts.window.weeks,
    agents: counts.agents
  });

  const outDir = path.resolve(d.cwd, options.outDir ?? DEFAULT_OUT_DIR);
  const fsCtx = { cwd: d.cwd, tmpdir: d.tmpdir, platform: d.platform, fsOps: d.fsOps };
  for (const { filename, svg } of svgs) {
    writeSvgArtifact(outDir, filename, svg, fsCtx);
  }

  if (!options.quiet) d.stdout.write(markdown);
  return EXIT_CODES.OK;
}

export async function runBuild(options = {}, deps = {}) {
  const d = getDeps(deps);
  const configPath = path.resolve(d.cwd, options.config ?? DEFAULT_CONFIG_FILE);
  const config = loadConfigFile(configPath, { fsOps: d.fsOps });
  const includePrivate = resolvePrivateGate(config.includePrivate, options);
  const auth = requireToken(d);
  if (deps._onToken) deps._onToken(auth.token);

  const { counts, warnings } = await d.collectActivityFn({
    config,
    includePrivate,
    endDate: options.date,
    token: auth.token,
    fetchFn: d.fetchFn,
    sleepFn: d.sleepFn,
    nowFn: d.nowFn
  });

  const svgs = renderSvgs(counts, config);
  const markdown = renderMarkdownSnippet({
    owner: config.owner,
    scopeType: config.scopeType,
    branch: config.branch,
    subpath: config.subpath,
    markdownBase: config.markdownBase,
    layout: config.layout,
    windowWeeks: counts.window.weeks,
    agents: counts.agents,
    labelMode: config.labelMode
  });

  const fsCtx = { cwd: d.cwd, tmpdir: d.tmpdir, platform: d.platform, fsOps: d.fsOps };
  const outDir = path.resolve(d.cwd, options.outDir ?? DEFAULT_OUT_DIR);
  for (const { filename, svg } of svgs) {
    writeSvgArtifact(outDir, filename, svg, fsCtx);
  }

  if (options.countsOut !== undefined) {
    writeVerifiedJson(path.resolve(d.cwd, options.countsOut), counts, fsCtx);
  }

  if (!options.quiet) {
    emitWarnings(warnings, d, auth.token);
    d.stdout.write(markdown);
  }
  return EXIT_CODES.OK;
}

export async function runSchedule(options = {}, deps = {}) {
  const d = getDeps(deps);
  for (const [name, val] of [
    ['--config', options.config],
    ['--repo-dir', options.repoDir],
    ['--out-dir', options.outDir],
    ['--script-path', options.scriptPath]
  ]) {
    if (typeof val === 'string' && val.startsWith('-')) {
      throw new ValidationError(`${name} must not start with "-"`);
    }
  }

  const configPath = path.resolve(d.cwd, options.config ?? DEFAULT_CONFIG_FILE);
  let config;
  try {
    config = loadConfigFile(configPath, { fsOps: d.fsOps });
  } catch (err) {
    if (err instanceof FsSafeError && err.code === 'FS_NOT_FOUND') {
      throw new ValidationError('lynceus schedule requires an existing lynceus.json config file');
    }
    throw err;
  }

  const target = options.target ?? (d.platform === 'win32' ? 'task-scheduler' : 'cron');
  const includePrivate = resolvePrivateGate(config.includePrivate, options, { actionsTarget: target === 'actions' });

  const result = generateScheduleSnippet({
    target,
    owner: options.owner ?? config.owner,
    scopeType: config.scopeType,
    branch: options.branch ?? config.branch,
    subpath: options.subpath ?? config.subpath,
    includePrivate,
    configPath: options.config ?? DEFAULT_CONFIG_FILE,
    repoDir: options.repoDir ?? '.',
    outDir: options.outDir,
    scriptPath: options.scriptPath,
    toolRef: options.toolRef,
    packagePin: options.packagePin,
    gitName: options.gitName,
    gitEmail: options.gitEmail,
    taskName: options.taskName,
    defaultToolRef: d.defaultToolRef,
    binPath: d.binPath,
    nodePath: d.nodePath,
    platform: d.platform,
    env: d.env,
    homedir: d.homedir,
    cwd: d.cwd,
    tmpdir: d.tmpdir,
    realpathSyncFn: d.realpathSyncFn,
    existsSyncFn: d.existsSyncFn
  });

  if (result.privacyNotice) {
    d.stdout.write(`${result.privacyNotice}\n\n`);
  }
  d.stdout.write(`# Target path: ${result.scriptPath}\n\n${result.snippet}\n# Instructions:\n${result.instructions}\n`);
  return EXIT_CODES.OK;
}

function resolveExitCode(err) {
  if (err instanceof UsageError || err instanceof ValidationError || err instanceof PrivacyGateError) return EXIT_CODES.USAGE;
  if (err instanceof CamoSafetyError || err?.name === 'CamoSafetyError') return EXIT_CODES.USAGE;
  if (err instanceof TypeError || err instanceof RangeError) return EXIT_CODES.USAGE;
  if (err instanceof AuthError) return EXIT_CODES.AUTH;
  if (err instanceof FsSafeError) return EXIT_CODES.FS;
  if (Number.isInteger(err?.exitCode) && err.exitCode >= 1) return err.exitCode;
  return EXIT_CODES.USAGE;
}

/**
 * Top-level CLI entrypoint invoked by `bin/lynceus.mjs`. Returns exit code `0|2|3|4|5`.
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function runCli(argv, deps = {}) {
  const d = getDeps(deps);
  let activeToken =
    (typeof d.env?.GITHUB_TOKEN === 'string' && d.env.GITHUB_TOKEN.trim()) ||
    (typeof d.env?.GH_TOKEN === 'string' && d.env.GH_TOKEN.trim()) ||
    null;

  try {
    const { command, options } = parseCliArgs(argv);
    if (command === 'help') {
      d.stdout.write(formatHelpText());
      return EXIT_CODES.OK;
    }
    if (command === 'version') {
      d.stdout.write(`lynceus ${CLI_VERSION}\n`);
      return EXIT_CODES.OK;
    }

    const trackedDeps = { ...deps, _onToken: (t) => { activeToken = t; } };
    if (command === 'init') return await runInit(options, trackedDeps);
    if (command === 'collect') return await runCollect(options, trackedDeps);
    if (command === 'render') return await runRender(options, trackedDeps);
    if (command === 'build') return await runBuild(options, trackedDeps);
    if (command === 'schedule') return await runSchedule(options, trackedDeps);
    throw new UsageError(`Unknown command "${command}"`);
  } catch (err) {
    const msg = redactSecrets(err?.message ?? 'Unexpected error', activeToken);
    d.stderr.write(`Error: ${msg}\n`);
    return resolveExitCode(err);
  }
}
