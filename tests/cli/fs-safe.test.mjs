import assert from 'node:assert/strict';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addDays, ValidationError } from '../../src/collector/config.mjs';
import { PrivacyGateError } from '../../src/collector/privacy-gate.mjs';
import {
  FsSafeError, assertNoSymlinkPath, readBoundedJsonFile, resolveTrustedAnchor, writeSvgArtifact, writeVerifiedJson
} from '../../src/cli/fs-safe.mjs';

const SVG = 'unified-52w-light.svg';
const isWin = process.platform === 'win32';

const fsError = (code) => (e) => e instanceof FsSafeError && e.exitCode === 5 && (!code || e.code === code);

function makeCounts(mode = 'public') {
  const days = {};
  for (let d = '2025-11-30'; d <= '2026-11-24'; d = addDays(d, 1)) days[d] = 0;
  days['2026-11-24'] = 3;
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-24T00:00:00Z',
    window: { weeks: 52, startDate: '2025-11-30', endDate: '2026-11-24' },
    scope: { mode },
    agents: [{
      slug: 'mephistos-homunculus[bot]', label: 'Homunculus', ramp: 'emerald', source: 'github',
      totals: { prsOpened: 3, prsMerged: 0, commits: 0, reviews: 0, comments: 0, issues: 0, total: 3 },
      streaks: { current: 1, best: 1 }, days
    }]
  };
}

function withTempDir(fn) {
  const base = mkdtempSync(path.join(tmpdir(), 'lynceus-fs-'));
  try {
    return fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** Directory symlink (junction on Windows, which needs no privilege). */
const dirLink = (target, linkPath) => symlinkSync(target, linkPath, 'junction');

/** File symlink, or null when the platform refuses (Windows without developer mode). */
function fileLink(target, linkPath) {
  try {
    symlinkSync(target, linkPath, 'file');
    return true;
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') return false;
    throw err;
  }
}

// ---- real filesystem: happy paths ----

test('writeSvgArtifact writes atomically into a real os.tmpdir() subtree, creating nested dirs', () => {
  withTempDir((base) => {
    const outDir = path.join(base, 'a', 'b', 'agent-activity');
    const target = writeSvgArtifact(outDir, SVG, '<svg/>');
    assert.equal(target, path.join(outDir, SVG));
    assert.equal(readFileSync(target, 'utf8'), '<svg/>');
    writeSvgArtifact(outDir, SVG, '<svg>2</svg>');
    assert.equal(readFileSync(target, 'utf8'), '<svg>2</svg>');
    assert.deepEqual(readdirSync(outDir), [SVG], 'no temp files left behind');
    if (!isWin) assert.equal(statSync(target).mode & 0o777, 0o644 & ~process.umask());
  });
});

test('writeSvgArtifact accepts the documented filenames only', () => {
  withTempDir((base) => {
    for (const name of ['unified-52w-dark.svg', 'unified-26w-light.svg', 'homunculus-52w-light.svg', 'a-b-1-26w-dark.svg']) {
      writeSvgArtifact(base, name, '<svg/>');
    }
    for (const bad of ['x.svg', 'unified-30w-light.svg', 'Unified-52w-light.svg', '../unified-52w-light.svg', 'a/b-52w-light.svg',
      'a\\b-52w-light.svg', 'unified-52w-light.svg\n', 'unified-52w-light.svg.tmp', '-52w-light.svg', '', null, 5]) {
      assert.throws(() => writeSvgArtifact(base, bad, '<svg/>'), (e) => e instanceof ValidationError && e.exitCode === 2, String(bad));
    }
    assert.throws(() => writeSvgArtifact(base, SVG, 42), ValidationError);
  });
});

test('writeVerifiedJson writes validated counts and creates missing parents', () => {
  withTempDir((base) => {
    const file = path.join(base, 'x', 'y', 'counts.json');
    assert.equal(writeVerifiedJson(file, makeCounts()), file);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), makeCounts());
    assert.ok(readFileSync(file, 'utf8').endsWith('\n'));
    if (!isWin) assert.equal(statSync(file).mode & 0o777, 0o644 & ~process.umask());
  });
});

test('writeVerifiedJson uses wx temp files, 0o600 for public+private and 0o644 otherwise', () => {
  withTempDir((base) => {
    const writes = [];
    const fsOps = {
      writeFileSync: (p, data, options) => {
        writes.push({ p, options });
        return writeFileSync(p, data, options);
      }
    };
    const priv = path.join(base, 'private.json');
    const pub = path.join(base, 'public.json');
    writeVerifiedJson(priv, makeCounts('public+private'), { fsOps });
    writeVerifiedJson(pub, makeCounts('public'), { fsOps });
    assert.equal(writes.length, 2);
    for (const w of writes) {
      assert.equal(w.options.flag, 'wx');
      assert.match(w.p, /\.tmp-\d+-[0-9a-f]{16}$/);
    }
    assert.ok(writes[0].p.startsWith(priv));
    assert.equal(writes[0].options.mode, 0o600);
    assert.equal(writes[1].options.mode, 0o644);
    if (!isWin) assert.equal(statSync(priv).mode & 0o777, 0o600);
  });
});

test('writeVerifiedJson replaces an existing 0o644 file with a 0o600 one for private counts', { skip: isWin }, () => {
  withTempDir((base) => {
    const file = path.join(base, 'counts.json');
    writeVerifiedJson(file, makeCounts('public'));
    writeVerifiedJson(file, makeCounts('public+private'));
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
});

test('writeVerifiedJson runs the privacy gate before touching the filesystem', () => {
  withTempDir((base) => {
    const bad = makeCounts();
    bad.agents[0].repoName = 'secret/private-repo';
    const dir = path.join(base, 'never');
    assert.throws(() => writeVerifiedJson(path.join(dir, 'counts.json'), bad), (e) => e instanceof PrivacyGateError && e.exitCode === 2);
    assert.equal(existsSync(dir), false);
    const calls = [];
    const fsOps = { mkdirSync: (...a) => calls.push(a), writeFileSync: (...a) => calls.push(a) };
    assert.throws(() => writeVerifiedJson(path.join(dir, 'c.json'), { nope: 1 }, { fsOps }), PrivacyGateError);
    assert.equal(calls.length, 0);
  });
});

test('writes cleanly remove the temp file and keep the prior artifact when rename fails', () => {
  withTempDir((base) => {
    writeSvgArtifact(base, SVG, '<svg>old</svg>');
    const fsOps = { renameSync: () => { throw Object.assign(new Error('nope /secret/path'), { code: 'EBUSY' }); } };
    assert.throws(() => writeSvgArtifact(base, SVG, '<svg>new</svg>', { fsOps }), (e) => fsError('EBUSY')(e) && !e.message.includes('/secret/path'));
    assert.deepEqual(readdirSync(base), [SVG]);
    assert.equal(readFileSync(path.join(base, SVG), 'utf8'), '<svg>old</svg>');
  });
});

test('wx temp collision fails closed instead of overwriting', () => {
  withTempDir((base) => {
    const fsOps = { writeFileSync: (p, d, o) => { writeFileSync(p, 'x', { flag: 'w' }); return writeFileSync(p, d, o); } };
    assert.throws(() => writeSvgArtifact(base, SVG, '<svg/>', { fsOps }), fsError('EEXIST'));
    assert.deepEqual(readdirSync(base), []);
  });
});

// ---- real filesystem: symlink confinement ----

test('rejects an out-dir that is itself a symlink before creating anything', () => {
  withTempDir((base) => {
    const real = path.join(base, 'real');
    mkdirSync(real);
    const link = path.join(base, 'link');
    dirLink(real, link);
    assert.throws(() => writeSvgArtifact(link, SVG, '<svg/>'), fsError('FS_SYMLINK'));
    assert.throws(() => writeVerifiedJson(path.join(link, 'counts.json'), makeCounts()), fsError('FS_SYMLINK'));
    assert.deepEqual(readdirSync(real), []);
  });
});

test('rejects a symlinked ancestor before mkdirSync creates missing children', () => {
  withTempDir((base) => {
    const real = path.join(base, 'real');
    mkdirSync(real);
    mkdirSync(path.join(base, 'a'));
    dirLink(real, path.join(base, 'a', 'link'));
    assert.throws(() => writeSvgArtifact(path.join(base, 'a', 'link', 'new', 'deep'), SVG, '<svg/>'), fsError('FS_SYMLINK'));
    assert.throws(() => writeVerifiedJson(path.join(base, 'a', 'link', 'sub', 'counts.json'), makeCounts()), fsError('FS_SYMLINK'));
    assert.deepEqual(readdirSync(real), [], 'nothing was created through the link');
  });
});

test('rejects a directory swapped for a symlink during mkdirSync (post-mkdir re-walk)', () => {
  withTempDir((base) => {
    const outside = path.join(base, 'outside');
    mkdirSync(outside);
    const fsOps = {
      mkdirSync: (dir, options) => {
        mkdirSync(dir, options);
        rmSync(dir, { recursive: true });
        dirLink(outside, dir);
      }
    };
    assert.throws(() => writeSvgArtifact(path.join(base, 'racy'), SVG, '<svg/>', { fsOps }), fsError('FS_SYMLINK'));
    assert.deepEqual(readdirSync(outside), []);
  });
});

test('rejects a post-mkdir realpath that escapes the trusted anchor', () => {
  withTempDir((base) => {
    const fsOps = { realpathSync: (p, ...rest) => (String(p).endsWith('esc') ? path.parse(base).root : realpathSync(p, ...rest)) };
    assert.throws(() => writeSvgArtifact(path.join(base, 'esc'), SVG, '<svg/>', { fsOps }), fsError('FS_CONFINEMENT'));
  });
});

test('rejects a symlink target file and a directory target', () => {
  withTempDir((base) => {
    const outside = path.join(base, 'outside.txt');
    writeFileSync(outside, 'keep');
    const out = path.join(base, 'out');
    mkdirSync(out);
    if (fileLink(outside, path.join(out, SVG))) {
      assert.throws(() => writeSvgArtifact(out, SVG, '<svg/>'), fsError('FS_SYMLINK'));
      assert.equal(readFileSync(outside, 'utf8'), 'keep');
      assert.throws(() => writeVerifiedJson(path.join(out, SVG), makeCounts()), fsError('FS_SYMLINK'));
    }
    mkdirSync(path.join(out, 'unified-26w-dark.svg'));
    assert.throws(() => writeSvgArtifact(out, 'unified-26w-dark.svg', '<svg/>'), fsError('FS_NOT_FILE'));
    mkdirSync(path.join(out, 'counts.json'));
    assert.throws(() => writeVerifiedJson(path.join(out, 'counts.json'), makeCounts()), fsError('FS_NOT_FILE'));
  });
});

test('a path component that is a regular file fails with exit 5', () => {
  withTempDir((base) => {
    writeFileSync(path.join(base, 'file'), 'x');
    assert.throws(() => writeSvgArtifact(path.join(base, 'file', 'sub'), SVG, '<svg/>'), (e) => e instanceof FsSafeError);
  });
});

test('a symlinked cwd is a trusted anchor, but symlinks below it are rejected', () => {
  withTempDir((base) => {
    const real = path.join(base, 'real');
    mkdirSync(real);
    const cwdLink = path.join(base, 'cwd-link');
    dirLink(real, cwdLink);
    const target = writeSvgArtifact('out', SVG, '<svg/>', { cwd: cwdLink });
    assert.equal(target, path.join(cwdLink, 'out', SVG));
    assert.equal(readFileSync(path.join(real, 'out', SVG), 'utf8'), '<svg/>');

    const elsewhere = path.join(base, 'elsewhere');
    mkdirSync(elsewhere);
    dirLink(elsewhere, path.join(real, 'child-link'));
    assert.throws(() => writeSvgArtifact('child-link/x', SVG, '<svg/>', { cwd: cwdLink }), fsError('FS_SYMLINK'));
    assert.deepEqual(readdirSync(elsewhere), []);
  });
});

test('resolveTrustedAnchor picks cwd, then tmpdir, then the filesystem root', () => {
  withTempDir((base) => {
    mkdirSync(path.join(base, 'cwd', 'sub'), { recursive: true });
    mkdirSync(path.join(base, 'tmp'));
    const cwd = path.join(base, 'cwd');
    const opts = { cwd, tmpdir: path.join(base, 'tmp') };
    const inCwd = resolveTrustedAnchor('sub/new.json', opts);
    assert.equal(inCwd.anchorKind, 'cwd');
    assert.equal(inCwd.anchorReal, realpathSync(cwd));
    assert.deepEqual(inCwd.segments, ['sub', 'new.json']);
    assert.equal(inCwd.existing, 1);
    const inTmp = resolveTrustedAnchor(path.join(base, 'tmp', 'x', 'y'), opts);
    assert.equal(inTmp.anchorKind, 'tmpdir');
    assert.equal(inTmp.anchorReal, realpathSync(path.join(base, 'tmp')));
    assert.equal(inTmp.existing, 0);
    const root = resolveTrustedAnchor(path.join(base, 'neither'), opts);
    assert.equal(root.anchorKind, 'root');
    assert.equal(root.anchorReal, path.parse(base).root);
    assert.equal(assertNoSymlinkPath(path.join(base, 'cwd', 'sub'), opts).anchorKind, 'cwd');
    assert.throws(() => resolveTrustedAnchor('', opts), fsError('FS_INVALID_PATH'));
    assert.throws(() => resolveTrustedAnchor('a\0b', opts), fsError('FS_INVALID_PATH'));
  });
});

test('.. traversal is normalised lexically and cannot launder a symlink', () => {
  withTempDir((base) => {
    const real = path.join(base, 'real');
    mkdirSync(real);
    mkdirSync(path.join(base, 'cwd'));
    dirLink(real, path.join(base, 'cwd', 'link'));
    // lexical normalisation turns "link/../out" into "out" inside cwd: allowed and never touches the link
    writeSvgArtifact('link/../out', SVG, '<svg/>', { cwd: path.join(base, 'cwd') });
    assert.ok(existsSync(path.join(base, 'cwd', 'out', SVG)));
    assert.deepEqual(readdirSync(real), []);
    assert.throws(() => writeSvgArtifact('link/sub/../x', SVG, '<svg/>', { cwd: path.join(base, 'cwd') }), fsError('FS_SYMLINK'));
  });
});

// ---- readBoundedJsonFile ----

test('readBoundedJsonFile parses UTF-8 JSON (with optional BOM) at exactly the byte limit', () => {
  withTempDir((base) => {
    const file = path.join(base, 'a.json');
    writeFileSync(file, '{"ok":true}');
    assert.deepEqual(readBoundedJsonFile(file, 11), { ok: true });
    writeFileSync(file, '\uFEFF{"ok":true}');
    assert.deepEqual(readBoundedJsonFile(file, 1000), { ok: true });
    writeFileSync(file, '{"k":"héllo 🚀"}');
    assert.deepEqual(readBoundedJsonFile(file, 1000), { k: 'héllo 🚀' });
  });
});

test('readBoundedJsonFile rejects oversize files with exit 2 before reading', () => {
  withTempDir((base) => {
    const file = path.join(base, 'big.json');
    writeFileSync(file, '{"a":"' + 'x'.repeat(100) + '"}');
    let read = false;
    const fsOps = { readFileSync: (...a) => { read = true; return readFileSync(...a); } };
    assert.throws(() => readBoundedJsonFile(file, 50, { fsOps }), (e) => e instanceof ValidationError && e.exitCode === 2);
    assert.equal(read, false);
    assert.throws(() => readBoundedJsonFile(file, 0), TypeError);
  });
});

test('readBoundedJsonFile wraps malformed JSON in an opaque error with zero content excerpts', () => {
  withTempDir((base) => {
    const canary = 'CANARY-PRIVATE-REPO-acme/secret-xyz';
    const file = path.join(base, 'bad.json');
    for (const content of [`{"repo": "${canary}", `, `${canary}`, `{"a": ${canary}}`, '']) {
      writeFileSync(file, content);
      assert.throws(() => readBoundedJsonFile(file, 10_000), (e) => {
        assert.ok(e instanceof ValidationError);
        assert.equal(e.exitCode, 2);
        assert.equal(e.cause, undefined);
        const blob = `${e.message}\n${e.stack}\n${JSON.stringify(e)}`;
        assert.ok(!blob.includes(canary) && !blob.includes('secret') && !blob.includes('repo'), blob);
        return true;
      });
    }
    writeFileSync(file, Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
    assert.throws(() => readBoundedJsonFile(file, 100), (e) => e instanceof ValidationError && e.exitCode === 2);
  });
});

test('readBoundedJsonFile rejects symlinked ancestors and targets with exit 5', () => {
  withTempDir((base) => {
    const real = path.join(base, 'real');
    mkdirSync(real);
    writeFileSync(path.join(real, 'c.json'), '{}');
    dirLink(real, path.join(base, 'dlink'));
    assert.throws(() => readBoundedJsonFile(path.join(base, 'dlink', 'c.json'), 100), fsError('FS_SYMLINK'));
    assert.throws(() => readBoundedJsonFile(path.join(base, 'dlink'), 100), fsError('FS_SYMLINK'));
    if (fileLink(path.join(real, 'c.json'), path.join(base, 'flink.json'))) {
      assert.throws(() => readBoundedJsonFile(path.join(base, 'flink.json'), 100), fsError('FS_SYMLINK'));
    }
    assert.deepEqual(readBoundedJsonFile(path.join(real, 'c.json'), 100), {});
  });
});

test('readBoundedJsonFile rejects directories and reports missing files with exit 5', () => {
  withTempDir((base) => {
    mkdirSync(path.join(base, 'dir'));
    assert.throws(() => readBoundedJsonFile(path.join(base, 'dir'), 100), fsError('FS_NOT_FILE'));
    assert.throws(() => readBoundedJsonFile(path.join(base, 'nope.json'), 100), fsError('FS_NOT_FOUND'));
    assert.throws(() => readBoundedJsonFile(path.join(base, 'nope', 'deeper.json'), 100), fsError('FS_NOT_FOUND'));
  });
});

// ---- simulated macOS /var -> /private/var and /tmp -> /private/tmp ----

function makeFakeFs(links, dirs) {
  const posix = path.posix;
  const entries = new Map([['/', { t: 'dir' }]]);
  const real = (p, followLast = true, depth = 0) => {
    if (depth > 20) throw Object.assign(new Error('ELOOP'), { code: 'ELOOP' });
    const segs = p.split('/').filter(Boolean);
    let cur = '/';
    segs.forEach((seg, i) => {
      const next = posix.join(cur, seg);
      const e = entries.get(next);
      cur = e?.t === 'link' && (i < segs.length - 1 || followLast) ? real(posix.resolve(posix.dirname(next), e.to), true, depth + 1) : next;
    });
    return cur;
  };
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const addDir = (k) => {
    let cur = '/';
    for (const seg of k.split('/').filter(Boolean)) {
      cur = posix.join(cur, seg);
      if (!entries.has(cur)) entries.set(cur, { t: 'dir' });
    }
  };
  dirs.forEach(addDir);
  for (const [from, to] of Object.entries(links)) {
    addDir(posix.dirname(from));
    entries.set(from, { t: 'link', to });
  }
  const stat = (e) => ({ isSymbolicLink: () => e.t === 'link', isFile: () => e.t === 'file', isDirectory: () => e.t === 'dir', size: e.data?.length ?? 0 });
  const fsOps = {
    lstatSync: (p) => {
      const e = entries.get(real(p, false));
      if (!e) throw enoent();
      return stat(e);
    },
    realpathSync: (p) => {
      const k = real(p, true);
      if (!entries.has(k)) throw enoent();
      return k;
    },
    mkdirSync: (p) => addDir(real(p, true)),
    writeFileSync: (p, data, options) => {
      const k = real(p, false);
      if (options.flag === 'wx' && entries.has(k)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      entries.set(k, { t: 'file', data: String(data), mode: options.mode });
    },
    renameSync: (a, b) => {
      const ka = real(a, false);
      entries.set(real(b, false), entries.get(ka));
      entries.delete(ka);
    },
    rmSync: (p) => entries.delete(real(p, false))
  };
  return { fsOps, entries, real };
}

const macOpts = (fake, platform = 'darwin') => ({
  platform, path: path.posix, cwd: '/Users/me/proj', tmpdir: '/var/folders/zz/T', fsOps: fake.fsOps
});
const macFake = () => makeFakeFs(
  { '/var': '/private/var', '/tmp': '/private/tmp' },
  ['/private/var/folders/zz/T', '/private/tmp', '/Users/me/proj']
);

test('simulated macOS: writes under a /var tmpdir succeed via the tmpdir anchor', () => {
  const fake = macFake();
  const opts = macOpts(fake);
  const target = writeSvgArtifact('/var/folders/zz/T/out/agent-activity', SVG, '<svg/>', opts);
  assert.equal(target, '/var/folders/zz/T/out/agent-activity/' + SVG);
  assert.equal(fake.entries.get('/private/var/folders/zz/T/out/agent-activity/' + SVG).data, '<svg/>');
  const info = resolveTrustedAnchor('/var/folders/zz/T/out', opts);
  assert.equal(info.anchorKind, 'tmpdir');
  assert.equal(info.anchorReal, '/private/var/folders/zz/T');
  const priv = writeVerifiedJson('/var/folders/zz/T/c/counts.json', makeCounts('public+private'), opts);
  assert.equal(fake.entries.get('/private/var/folders/zz/T/c/counts.json').mode, 0o600);
  assert.equal(priv, '/var/folders/zz/T/c/counts.json');
});

test('simulated macOS: /tmp and /var root aliases are skipped only on darwin', () => {
  const fake = macFake();
  const info = resolveTrustedAnchor('/tmp/lynceus/out', macOpts(fake));
  assert.equal(info.anchorKind, 'root');
  assert.equal(info.anchorReal, '/private/tmp');
  assert.deepEqual(info.segments, ['lynceus', 'out']);
  writeSvgArtifact('/tmp/lynceus/out', SVG, '<svg/>', macOpts(fake));
  assert.ok(fake.entries.has('/private/tmp/lynceus/out/' + SVG));
  writeSvgArtifact('/var/other/out', SVG, '<svg/>', macOpts(fake));
  assert.ok(fake.entries.has('/private/var/other/out/' + SVG));
  assert.throws(() => resolveTrustedAnchor('/tmp/lynceus/out', macOpts(fake, 'linux')), fsError('FS_SYMLINK'));
});

test('simulated macOS: alias skipping does not weaken child symlink checks', () => {
  const fake = makeFakeFs(
    { '/var': '/private/var', '/tmp': '/private/tmp', '/private/var/folders/zz/T/evil': '/private/tmp', '/private/tmp/evil2': '/Users' },
    ['/private/var/folders/zz/T', '/private/tmp', '/Users/me/proj']
  );
  const opts = macOpts(fake);
  assert.throws(() => writeSvgArtifact('/var/folders/zz/T/evil/out', SVG, '<svg/>', opts), fsError('FS_SYMLINK'));
  assert.throws(() => writeSvgArtifact('/tmp/evil2/out', SVG, '<svg/>', opts), fsError('FS_SYMLINK'));
  assert.throws(() => readBoundedJsonFile('/tmp/evil2/c.json', 100, opts), fsError('FS_SYMLINK'));
  assert.equal([...fake.entries.keys()].some((k) => k.startsWith('/private/tmp/out') || k.includes('/evil/out')), false);
});

test('simulated macOS: a fake /var that does not resolve to /private/var is not trusted', () => {
  const fake = makeFakeFs({ '/var': '/Users/attacker' }, ['/Users/attacker', '/private/var', '/Users/me/proj', '/private/var/folders/zz/T']);
  assert.throws(() => writeSvgArtifact('/var/x/out', SVG, '<svg/>', macOpts(fake)), fsError('FS_SYMLINK'));
});

test('simulated macOS: reads under /var tmpdir work through the realpath anchor', () => {
  const fake = macFake();
  const opts = macOpts(fake);
  fake.entries.set('/private/var/folders/zz/T/c.json', { t: 'file', data: '{"v":1}' });
  fake.fsOps.readFileSync = () => Buffer.from('{"v":1}');
  assert.deepEqual(readBoundedJsonFile('/var/folders/zz/T/c.json', 100, opts), { v: 1 });
});
