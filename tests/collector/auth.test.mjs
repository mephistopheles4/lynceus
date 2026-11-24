import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuthError, resolveSafeExecutable, resolveToken } from '../../src/collector/auth.mjs';

const isWin = process.platform === 'win32';
const GH = isWin ? 'gh.exe' : 'gh';
const TOKEN = 'ghp_FakeTokenForAuthTests1234567890';

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'lynceus-auth-'));
}
function plantGh(dir, mode = 0o755) {
  const file = path.join(dir, GH);
  writeFileSync(file, 'fake');
  if (!isWin) chmodSync(file, mode);
  return file;
}
const noExec = () => assert.fail('gh must not be executed');

test('AuthError carries exit code 3 and AUTH_REQUIRED', () => {
  const err = new AuthError();
  assert.equal(err.exitCode, 3);
  assert.equal(err.code, 'AUTH_REQUIRED');
});

test('GITHUB_TOKEN wins over GH_TOKEN; GH_TOKEN is the fallback; values are trimmed', () => {
  assert.deepEqual(resolveToken({ env: { GITHUB_TOKEN: ` ${TOKEN}\n`, GH_TOKEN: 'other-token-value' }, execFileSyncFn: noExec }), { token: TOKEN, sourceLabel: 'env' });
  assert.deepEqual(resolveToken({ env: { GITHUB_TOKEN: '   ', GH_TOKEN: 'fallback-token-value' }, execFileSyncFn: noExec }), { token: 'fallback-token-value', sourceLabel: 'env' });
});

test('env tokens with CR/LF/control characters or whitespace are rejected', () => {
  for (const bad of ['abc\ndef', 'abc\rdef', 'abc\u0000def', 'abc\u001bdef', 'abc def', 'abc\u007fdef']) {
    assert.throws(() => resolveToken({ env: { GITHUB_TOKEN: bad }, execFileSyncFn: noExec }), AuthError);
    assert.throws(() => resolveToken({ env: { GH_TOKEN: bad }, execFileSyncFn: noExec }), AuthError);
  }
});

test('resolveSafeExecutable skips empty, "." and relative PATH entries', () => {
  const dir = tempDir();
  try {
    plantGh(dir);
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const sep = isWin ? ';' : ':';
      for (const PATH of ['', '.', `${sep}${sep}`, `.${sep}bin`, `bin${sep}${sep}.`, `..`]) {
        assert.equal(resolveSafeExecutable([GH], { PATH }), null, `PATH=${JSON.stringify(PATH)}`);
      }
      assert.equal(resolveSafeExecutable([GH], {}), null);
    } finally {
      process.chdir(previous);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a planted ./gh(.exe) in the current directory is ignored by resolveToken', () => {
  const dir = tempDir();
  try {
    plantGh(dir);
    const previous = process.cwd();
    process.chdir(dir);
    try {
      assert.equal(resolveToken({ env: { PATH: '' }, execFileSyncFn: noExec }), null);
      assert.equal(resolveToken({ env: { PATH: '.' }, execFileSyncFn: noExec }), null);
    } finally {
      process.chdir(previous);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSafeExecutable finds an absolute-PATH file but not a directory', () => {
  const root = tempDir();
  try {
    const withDir = path.join(root, 'a');
    const withFile = path.join(root, 'b');
    mkdirSync(path.join(withDir, GH), { recursive: true });
    mkdirSync(withFile);
    const file = plantGh(withFile);
    const sep = isWin ? ';' : ':';
    assert.equal(resolveSafeExecutable([GH], { PATH: `${withDir}${sep}${withFile}` }), file);
    assert.equal(resolveSafeExecutable(GH, { PATH: withDir }), null);
    assert.equal(resolveSafeExecutable([GH], { Path: withFile }), isWin || process.platform !== 'win32' ? file : null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('on POSIX a non-executable candidate is skipped', { skip: isWin }, () => {
  const dir = tempDir();
  try {
    plantGh(dir, 0o644);
    assert.equal(resolveSafeExecutable([GH], { PATH: dir }), null);
    chmodSync(path.join(dir, GH), 0o755);
    assert.equal(resolveSafeExecutable([GH], { PATH: dir }), path.join(dir, GH));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gh is executed with the exact safe options and its trimmed stdout is the token', () => {
  const dir = tempDir();
  try {
    const gh = plantGh(dir);
    const calls = [];
    const execFileSyncFn = (file, args, options) => {
      calls.push({ file, args, options });
      return `${TOKEN}\n`;
    };
    assert.deepEqual(resolveToken({ env: { PATH: dir }, execFileSyncFn }), { token: TOKEN, sourceLabel: 'gh' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, gh);
    assert.deepEqual(calls[0].args, ['auth', 'token']);
    assert.deepEqual(calls[0].options, { shell: false, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gh failure returns null and scrubs stdout/stderr/output from the error', () => {
  const dir = tempDir();
  try {
    plantGh(dir);
    const err = Object.assign(new Error('Command failed'), { stdout: Buffer.from(TOKEN), stderr: Buffer.from(TOKEN), output: [null, Buffer.from(TOKEN)], status: 1 });
    assert.equal(resolveToken({ env: { PATH: dir }, execFileSyncFn: () => { throw err; } }), null);
    assert.equal('stdout' in err, false);
    assert.equal('stderr' in err, false);
    assert.equal('output' in err, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gh stdout with control characters is rejected; empty stdout yields null; no gh yields null', () => {
  const dir = tempDir();
  try {
    plantGh(dir);
    assert.throws(() => resolveToken({ env: { PATH: dir }, execFileSyncFn: () => 'abc\ndef\n' }), AuthError);
    assert.throws(() => resolveToken({ env: { PATH: dir }, execFileSyncFn: () => 'abc\u001bdef' }), AuthError);
    assert.equal(resolveToken({ env: { PATH: dir }, execFileSyncFn: () => '  \n' }), null);
    assert.equal(resolveToken({ env: { PATH: path.join(dir, 'missing') }, execFileSyncFn: noExec }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
