/**
 * Filesystem confinement and atomic writes for the CLI (S6, threat boundary B5).
 *
 * Every path is resolved against a trusted anchor (cwd, then os.tmpdir(), then the filesystem
 * root) and each existing component below that anchor is `lstat`ed; any symlink is rejected
 * BEFORE mkdir / read / write. Writes go to an exclusive (`wx`) sibling temp file that is
 * renamed over the target. Error messages never echo file contents.
 *
 * Every function accepts `opts = { cwd, tmpdir, platform, path, fsOps }` so tests can inject
 * a fake filesystem or simulate macOS `/var` and `/tmp` aliases.
 */
import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { ValidationError } from '../collector/config.mjs';
import { assertStrictCountsOnly } from '../collector/privacy-gate.mjs';

export class FsSafeError extends Error {
  constructor(message, code = 'FS_ERROR') {
    super(message);
    this.name = 'FsSafeError';
    this.code = code;
    this.exitCode = 5;
  }
}

const SVG_FILENAME_RE = /^(?:unified|[a-z0-9-]+)-(?:26|52)w-(?:light|dark)\.svg$/;
const DARWIN_ALIASES = Object.freeze(['var', 'tmp']);

function makeContext(opts = {}) {
  const fs = {
    lstatSync: nodeFs.lstatSync,
    realpathSync: nodeFs.realpathSync,
    mkdirSync: nodeFs.mkdirSync,
    readFileSync: nodeFs.readFileSync,
    writeFileSync: nodeFs.writeFileSync,
    renameSync: nodeFs.renameSync,
    rmSync: nodeFs.rmSync,
    ...(opts.fsOps ?? {})
  };
  return {
    fs,
    p: opts.path ?? nodePath,
    platform: opts.platform ?? process.platform,
    cwd: opts.cwd ?? process.cwd(),
    tmpdir: opts.tmpdir ?? os.tmpdir()
  };
}

const clean = (s) => String(s).replace(/[\u0000-\u001F\u007F-\u009F]/g, '?');

function wrapFsError(err, what) {
  if (err instanceof FsSafeError || err instanceof ValidationError) return err;
  return new FsSafeError(`${what} (${typeof err?.code === 'string' ? err.code : 'error'})`, typeof err?.code === 'string' ? err.code : 'FS_ERROR');
}

function guarded(what, fn) {
  try {
    return fn();
  } catch (err) {
    throw wrapFsError(err, what);
  }
}

/** Path segments of `target` below `base`, or null when `target` is not lexically inside it. */
function segmentsBelow(c, base, target) {
  const rel = c.p.relative(base, target);
  if (rel === '') return [];
  if (rel === '..' || rel.startsWith(`..${c.p.sep}`) || c.p.isAbsolute(rel)) return null;
  return rel.split(c.p.sep);
}

function realAnchor(c, dir) {
  return guarded('Cannot resolve trusted anchor directory', () => c.fs.realpathSync(dir));
}

/** lstat every existing component below `anchorReal`, rejecting symlinks. */
function walk(c, anchorReal, segments, target) {
  let current = anchorReal;
  let existing = 0;
  for (const segment of segments) {
    current = c.p.join(current, segment);
    let st;
    try {
      st = c.fs.lstatSync(current);
    } catch (err) {
      if (err?.code === 'ENOENT') break;
      throw wrapFsError(err, 'Cannot inspect path component');
    }
    if (st.isSymbolicLink()) throw new FsSafeError(`Refusing to follow symlink in path: ${clean(target)}`, 'FS_SYMLINK');
    existing += 1;
  }
  return existing;
}

/**
 * Determine the trusted anchor for `targetPath` and walk every existing component below it.
 * @returns {{ target: string, anchorKind: 'cwd'|'tmpdir'|'root', anchorReal: string, segments: string[], existing: number }}
 */
export function resolveTrustedAnchor(targetPath, opts = {}) {
  if (typeof targetPath !== 'string' || targetPath === '' || targetPath.includes('\0')) {
    throw new FsSafeError('Invalid path', 'FS_INVALID_PATH');
  }
  const c = makeContext(opts);
  const target = c.p.resolve(c.cwd, targetPath);

  let anchorKind;
  let anchorReal;
  let segments = segmentsBelow(c, c.p.resolve(c.cwd), target);
  if (segments) {
    anchorKind = 'cwd';
    anchorReal = realAnchor(c, c.cwd);
  } else if ((segments = segmentsBelow(c, c.p.resolve(c.cwd, c.tmpdir), target))) {
    anchorKind = 'tmpdir';
    anchorReal = realAnchor(c, c.tmpdir);
  } else {
    anchorKind = 'root';
    const root = c.p.parse(target).root;
    segments = target.slice(root.length).split(c.p.sep).filter(Boolean);
    anchorReal = root;
    // macOS: skip ONLY the exact root OS aliases /var -> /private/var and /tmp -> /private/tmp.
    if (c.platform === 'darwin' && segments.length > 0 && DARWIN_ALIASES.includes(segments[0])) {
      const alias = c.p.join(root, segments[0]);
      let aliasReal;
      try {
        aliasReal = c.fs.realpathSync(alias);
      } catch {
        aliasReal = null;
      }
      if (aliasReal === c.p.join(root, 'private', segments[0])) {
        anchorReal = aliasReal;
        segments = segments.slice(1);
      }
    }
  }
  const existing = walk(c, anchorReal, segments, target);
  return { target, anchorKind, anchorReal, segments, existing };
}

/** Reject any symlink on the path (ancestors and target itself). Returns the anchor info. */
export function assertNoSymlinkPath(targetPath, opts = {}) {
  return resolveTrustedAnchor(targetPath, opts);
}

function assertConfined(c, dir, anchorReal) {
  const real = guarded('Cannot resolve output directory', () => c.fs.realpathSync(dir));
  if (segmentsBelow(c, anchorReal, real) === null) {
    throw new FsSafeError(`Output directory escapes its trusted anchor: ${clean(dir)}`, 'FS_CONFINEMENT');
  }
}

/** Symlink-checked mkdir -p with post-creation confinement; returns the anchor info. */
function ensureDir(dir, opts) {
  const c = makeContext(opts);
  resolveTrustedAnchor(dir, opts);
  const resolved = c.p.resolve(c.cwd, dir);
  guarded('Cannot create output directory', () => c.fs.mkdirSync(resolved, { recursive: true }));
  const post = resolveTrustedAnchor(resolved, opts);
  assertConfined(c, resolved, post.anchorReal);
  return post;
}

function assertTargetWritable(c, target) {
  let st;
  try {
    st = c.fs.lstatSync(target);
  } catch (err) {
    if (err?.code === 'ENOENT') return;
    throw wrapFsError(err, 'Cannot inspect output file');
  }
  if (st.isSymbolicLink()) throw new FsSafeError(`Refusing to overwrite symlink: ${clean(target)}`, 'FS_SYMLINK');
  if (!st.isFile()) throw new FsSafeError(`Output target is not a regular file: ${clean(target)}`, 'FS_NOT_FILE');
}

function atomicWrite(c, target, content, mode) {
  const temp = `${target}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  try {
    c.fs.writeFileSync(temp, content, { flag: 'wx', mode, encoding: 'utf8' });
    c.fs.renameSync(temp, target);
  } catch (err) {
    try {
      c.fs.rmSync(temp, { force: true });
    } catch {
      // best-effort cleanup
    }
    throw wrapFsError(err, 'Cannot write output file');
  }
}

function writeConfined(dir, name, content, mode, opts) {
  const c = makeContext(opts);
  ensureDir(dir, opts);
  const target = c.p.join(c.p.resolve(c.cwd, dir), name);
  assertTargetWritable(c, target);
  atomicWrite(c, target, content, mode);
  return target;
}

/**
 * Atomically write one generated SVG (`0o644`) into `outDir`. Returns the written path.
 */
export function writeSvgArtifact(outDir, filename, content, opts = {}) {
  if (typeof filename !== 'string' || !SVG_FILENAME_RE.test(filename)) throw new ValidationError('Invalid SVG artifact filename');
  if (typeof content !== 'string') throw new ValidationError('SVG content must be a string');
  return writeConfined(outDir, filename, content, 0o644, opts);
}

/**
 * Validate `countsObj` with the strict privacy gate, then atomically write it as JSON
 * (`0o600` when it contains private counts, else `0o644`). Returns the written path.
 */
export function writeVerifiedJson(filePath, countsObj, opts = {}) {
  assertStrictCountsOnly(countsObj);
  const c = makeContext(opts);
  const target = c.p.resolve(c.cwd, String(filePath));
  const mode = countsObj.scope.mode === 'public+private' ? 0o600 : 0o644;
  return writeConfined(c.p.dirname(target), c.p.basename(target), `${JSON.stringify(countsObj, null, 2)}\n`, mode, opts);
}

/**
 * Read a regular, non-symlink file of at most `maxBytes` and parse it as JSON. Parse failures
 * produce an opaque ValidationError that never includes file content.
 */
export function readBoundedJsonFile(filePath, maxBytes, opts = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('maxBytes must be a positive integer');
  const c = makeContext(opts);
  const { target } = resolveTrustedAnchor(filePath, opts);
  let st;
  try {
    st = c.fs.lstatSync(target);
  } catch (err) {
    if (err?.code === 'ENOENT') throw new FsSafeError(`File not found: ${clean(target)}`, 'FS_NOT_FOUND');
    throw wrapFsError(err, 'Cannot inspect input file');
  }
  if (st.isSymbolicLink()) throw new FsSafeError(`Refusing to read symlink: ${clean(target)}`, 'FS_SYMLINK');
  if (!st.isFile()) throw new FsSafeError(`Input is not a regular file: ${clean(target)}`, 'FS_NOT_FILE');
  if (st.size > maxBytes) throw new ValidationError(`Input file exceeds the ${maxBytes}-byte limit`);

  const data = guarded('Cannot read input file', () => c.fs.readFileSync(target));
  const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  if (size > maxBytes) throw new ValidationError(`Input file exceeds the ${maxBytes}-byte limit`);
  let text;
  try {
    text = typeof data === 'string' ? data : new TextDecoder('utf-8', { fatal: true }).decode(data);
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new ValidationError('Input file is not valid JSON');
  }
}
