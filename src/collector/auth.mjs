/**
 * Canonical GitHub token resolution (S4, threat boundary B4).
 * `gh` is only ever resolved from absolute PATH entries; the current directory is never searched.
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class AuthError extends Error {
  constructor(message = 'GitHub authentication is required', code = 'AUTH_REQUIRED') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.exitCode = 3;
  }
}

const CONTROL_RE = /[\u0000-\u001F\u007F]/;

function readPathVar(env) {
  if (typeof env?.PATH === 'string') return env.PATH;
  const key = Object.keys(env ?? {}).find((k) => k.toLowerCase() === 'path');
  return key && typeof env[key] === 'string' ? env[key] : '';
}

/**
 * Find the first regular (and, on POSIX, executable) file named one of `names` inside a
 * non-empty absolute PATH directory. Returns an absolute path or null.
 */
export function resolveSafeExecutable(names, env = process.env, { platform = process.platform, statSyncFn = statSync } = {}) {
  const list = (Array.isArray(names) ? names : [names]).filter((n) => typeof n === 'string' && n !== '');
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const rawDir of readPathVar(env).split(delimiter)) {
    const dir = platform === 'win32' ? rawDir.replace(/^"(.*)"$/, '$1') : rawDir;
    if (dir === '' || !path.isAbsolute(dir)) continue;
    for (const name of list) {
      const candidate = path.join(dir, name);
      try {
        const stat = statSyncFn(candidate);
        if (!stat.isFile()) continue;
        if (platform !== 'win32' && (stat.mode & 0o111) === 0) continue;
        return candidate;
      } catch {
        // Missing or unreadable candidate: keep looking.
      }
    }
  }
  return null;
}

function cleanToken(value, what) {
  const token = value.trim();
  if (CONTROL_RE.test(token) || /\s/.test(token)) throw new AuthError(`${what} contains invalid characters`);
  return token;
}

function scrubExecError(err) {
  if (err && typeof err === 'object') {
    for (const key of ['stdout', 'stderr', 'output']) {
      try {
        delete err[key];
      } catch {
        // Non-configurable property: nothing more we can do.
      }
    }
  }
}

/**
 * Resolve a GitHub token: GITHUB_TOKEN, GH_TOKEN, then `gh auth token`.
 * @returns {{ token: string, sourceLabel: 'env' | 'gh' } | null}
 */
export function resolveToken({ env = process.env, execFileSyncFn = execFileSync } = {}) {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    const value = env?.[name];
    if (typeof value !== 'string' || value.trim() === '') continue;
    return { token: cleanToken(value, `${name} environment variable`), sourceLabel: 'env' };
  }

  const ghPath = resolveSafeExecutable([process.platform === 'win32' ? 'gh.exe' : 'gh'], env);
  if (ghPath === null) return null;

  let stdout;
  try {
    stdout = execFileSyncFn(ghPath, ['auth', 'token'], {
      shell: false,
      cwd: os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      encoding: 'utf8'
    });
  } catch (err) {
    scrubExecError(err);
    return null;
  }
  const token = String(stdout ?? '').trim();
  if (token === '') return null;
  return { token: cleanToken(token, 'gh auth token output'), sourceLabel: 'gh' };
}
