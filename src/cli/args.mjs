/**
 * Dependency-free CLI argument parsing (S6). Pure: no I/O besides reading package.json once.
 *
 * `parseCliArgs(argv)` returns `{ command, options }` where `command` is one of
 * `help | version | init | collect | render | build | schedule` and `options` holds ONLY the
 * flags the user passed (camelCased) plus `false` for every boolean flag the command accepts.
 * Defaults that depend on config/platform (e.g. `--target`) are applied by the callers.
 */
import { readFileSync } from 'node:fs';
import { isValidIsoDate, validateBranch, validateOwner, validateSubpath } from '../collector/config.mjs';

export const EXIT_CODES = Object.freeze({ OK: 0, USAGE: 2, AUTH: 3, API: 4, FS: 5 });

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.code = 'USAGE';
    this.exitCode = EXIT_CODES.USAGE;
  }
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    if (typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version)) return pkg.version;
  } catch {
    // fall through to the pinned default
  }
  return '0.1.0';
}

export const CLI_VERSION = readVersion();

const SUBCOMMANDS = ['init', 'collect', 'render', 'build', 'schedule'];

const ENUMS = Object.freeze({
  'scope-type': ['user', 'org'],
  layout: ['unified', 'separate'],
  detail: ['breakdown', 'minimal'],
  'mark-style': ['squares', 'magnitude'],
  'label-mode': ['friendly', 'raw'],
  'markdown-base': ['raw', 'relative'],
  target: ['task-scheduler', 'cron', 'actions']
});

const BOOLEAN_FLAGS = ['no-open', 'include-private', 'public-only', 'quiet'];
const VALUE_FLAGS = [
  'config', 'port', 'out', 'date', 'counts', 'out-dir', 'owner', 'scope-type', 'layout', 'detail',
  'mark-style', 'label-mode', 'branch', 'subpath', 'markdown-base', 'counts-out', 'script-path',
  'target', 'repo-dir', 'tool-ref', 'package-pin', 'git-name', 'git-email', 'task-name'
];

const COMMAND_FLAGS = Object.freeze({
  init: ['config', 'port', 'no-open', 'include-private'],
  collect: ['config', 'out', 'include-private', 'public-only', 'date', 'quiet'],
  render: [
    'counts', 'config', 'out-dir', 'owner', 'scope-type', 'layout', 'detail', 'mark-style',
    'label-mode', 'branch', 'subpath', 'markdown-base', 'quiet'
  ],
  build: ['config', 'out-dir', 'counts-out', 'include-private', 'public-only', 'date', 'quiet'],
  schedule: [
    'config', 'out-dir', 'script-path', 'target', 'repo-dir', 'owner', 'branch', 'subpath',
    'include-private', 'public-only', 'tool-ref', 'package-pin', 'git-name', 'git-email', 'task-name'
  ]
});

const camel = (flag) => flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const printable = (s) => String(s).replace(/[^\x20-\x7E]/g, '?').slice(0, 40);

function wrapValidator(flag, fn, value) {
  try {
    return fn(value);
  } catch (err) {
    if (err && err.exitCode === EXIT_CODES.USAGE) throw new UsageError(`Invalid value for --${flag}`);
    throw err;
  }
}

function validateValue(flag, value) {
  if (flag === 'port') {
    const port = /^\d{1,5}$/.test(value) ? Number(value) : -1;
    if (!(port >= 0 && port <= 65535)) throw new UsageError('--port must be an integer between 0 and 65535');
    return port;
  }
  if (flag === 'date') {
    if (!isValidIsoDate(value)) throw new UsageError('--date must be a valid UTC calendar date (YYYY-MM-DD)');
    return value;
  }
  if (Object.hasOwn(ENUMS, flag)) {
    if (!ENUMS[flag].includes(value)) throw new UsageError(`--${flag} must be one of: ${ENUMS[flag].join(', ')}`);
    return value;
  }
  if (flag === 'owner') return wrapValidator(flag, validateOwner, value);
  if (flag === 'branch') return wrapValidator(flag, validateBranch, value);
  if (flag === 'subpath') return wrapValidator(flag, validateSubpath, value);
  return value;
}

/**
 * Parse `process.argv.slice(2)`-style input. Never reads the environment or the filesystem state
 * beyond the module-level version lookup.
 * @param {string[]} argv
 * @returns {{ command: string, options: Record<string, string | number | boolean> }}
 */
export function parseCliArgs(argv) {
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) throw new UsageError('Invalid argument vector');

  let command = 'init';
  let rest = argv;
  if (argv.length > 0 && !argv[0].startsWith('-')) {
    if (!SUBCOMMANDS.includes(argv[0])) throw new UsageError(`Unknown command "${printable(argv[0])}" (try --help)`);
    command = argv[0];
    rest = argv.slice(1);
  }

  const allowed = COMMAND_FLAGS[command];
  const options = {};
  for (const flag of allowed) if (BOOLEAN_FLAGS.includes(flag)) options[camel(flag)] = false;
  const seen = new Set();
  let help = false;
  let version = false;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--help' || token === '-h') { help = true; continue; }
    if (token === '--version' || token === '-v') { version = true; continue; }
    if (!token.startsWith('--')) {
      throw new UsageError(token.startsWith('-') && token.length > 1
        ? `Unknown flag "${printable(token)}" (try --help)`
        : `Unexpected argument "${printable(token)}" (try --help)`);
    }
    const eq = token.indexOf('=');
    const flag = token.slice(2, eq === -1 ? undefined : eq);
    const isBool = BOOLEAN_FLAGS.includes(flag);
    if (!(isBool || VALUE_FLAGS.includes(flag))) throw new UsageError(`Unknown flag "--${printable(flag)}" (try --help)`);
    if (!allowed.includes(flag)) throw new UsageError(`Flag --${flag} is not valid for "${command}" (try --help)`);
    if (seen.has(flag)) throw new UsageError(`Flag --${flag} was provided more than once`);
    seen.add(flag);

    if (isBool) {
      if (eq !== -1) throw new UsageError(`Flag --${flag} does not take a value`);
      options[camel(flag)] = true;
      continue;
    }

    let value;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      const next = rest[i + 1];
      // A following token that looks like a flag is never swallowed as a value; use --flag=<value>.
      if (next === undefined || (next.startsWith('-') && next.length > 1)) throw new UsageError(`Flag --${flag} requires a value`);
      value = next;
      i += 1;
    }
    if (value === '' && flag !== 'subpath') throw new UsageError(`Flag --${flag} requires a value`);
    options[camel(flag)] = validateValue(flag, value);
  }

  if (help) return { command: 'help', options: {} };
  if (version) return { command: 'version', options: {} };

  if (options.includePrivate && options.publicOnly) {
    throw new UsageError('--include-private and --public-only cannot be used together');
  }
  if (command === 'schedule') {
    if (options.toolRef !== undefined && options.packagePin !== undefined) {
      throw new UsageError('--tool-ref and --package-pin cannot be used together');
    }
    if (options.target === 'actions' && options.scriptPath !== undefined) {
      throw new UsageError('--script-path is not valid with --target actions');
    }
  }
  return { command, options };
}

export function formatHelpText() {
  return `lynceus ${CLI_VERSION} - GitHub App [bot] activity graphs

Usage:
  lynceus --help | --version
  lynceus [init]     [--config <path>] [--port <port>] [--no-open] [--include-private]
  lynceus collect    [--config <path>] [--out <counts.json>] [--include-private] [--public-only]
                     [--date <YYYY-MM-DD>] [--quiet]
  lynceus render     [--counts <counts.json>] [--config <path>] [--out-dir <dir>]
                     [--owner <slug>] [--scope-type <user|org>] [--layout <unified|separate>]
                     [--detail <breakdown|minimal>] [--mark-style <squares|magnitude>]
                     [--label-mode <friendly|raw>] [--branch <name>] [--subpath <path>]
                     [--markdown-base <raw|relative>] [--quiet]
  lynceus build      [--config <path>] [--out-dir <dir>] [--counts-out <path>] [--include-private]
                     [--public-only] [--date <YYYY-MM-DD>] [--quiet]
  lynceus schedule   [--config <path>] [--out-dir <dir>] [--script-path <path>]
                     [--target <task-scheduler|cron|actions>] [--repo-dir <path>] [--owner <slug>]
                     [--branch <name>] [--subpath <path>] [--include-private] [--public-only]
                     [--tool-ref <40-hex-sha>] [--package-pin <spec>] [--git-name <name>]
                     [--git-email <email>] [--task-name <name>]

Defaults:
  init              serves the builder UI on 127.0.0.1:4173 (falls back to an ephemeral port)
  --config          ./lynceus.json
  collect --out     ./counts.json
  render --counts   ./counts.json
  --out-dir         ./agent-activity

Exit codes:
  0 success | 2 usage/config/validation/private-gate | 3 auth | 4 GitHub API | 5 filesystem

Private activity:
  --include-private adds private-repository activity to daily totals. WARNING: pushed
  --include-private SVGs persist visible daily totals in public repository history and cannot be
  retracted. Pass --public-only to refuse private counts (always enforced with --target actions).
  --include-private and --public-only cannot be combined.
`;
}
