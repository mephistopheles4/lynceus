/**
 * Unified repository contract check run locally (`npm run check`) and in CI (`check.yml`).
 * Verifies zero npm dependencies/lockfiles/npmrc, relative-or-builtin ES module imports,
 * fenced code block language tags in governance/root Markdown, then runs lint, test, and build:pages.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'dist-pages', 'node_modules']);
const FORBIDDEN_FILENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  '.npmrc',
  '.yarnrc.yml',
  'binding.gyp'
]);
const FORBIDDEN_DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const FORBIDDEN_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const CODE_DIRS = ['bin', 'src', 'scripts', 'tests'];
const GOVERNANCE_DOCS = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'AGENTS.md',
  'docs/security/scanners.md'
];

function fail(message) {
  console.error(`check.mjs failed: ${message}`);
  process.exit(1);
}

function checkPackageManifest() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  if (!existsSync(pkgPath)) fail('missing root package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  for (const field of FORBIDDEN_DEP_FIELDS) {
    const val = pkg[field];
    if (val !== undefined && (typeof val !== 'object' || val === null || Array.isArray(val) || Object.keys(val).length > 0)) {
      fail(`package.json "${field}" must be omitted or empty (zero dependencies allowed)`);
    }
  }

  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  for (const hook of FORBIDDEN_LIFECYCLE_SCRIPTS) {
    if (Object.hasOwn(scripts, hook)) {
      fail(`package.json scripts must not define "${hook}"`);
    }
  }
}

function checkForbiddenRepoFiles(dir = ROOT_DIR) {
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) checkForbiddenRepoFiles(full);
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (FORBIDDEN_FILENAMES.has(lower)) {
      fail(`forbidden file present: ${path.relative(ROOT_DIR, full).replace(/\\/g, '/')}`);
    }
  }
}

function collectJsFiles(dir, out) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.js'))) out.push(full);
  }
}

/**
 * Strip comments and string/template literal contents outside import/export specifiers
 * is overly complex; instead strip JS comments cleanly and scan static module import/export lines.
 */
function stripCommentsAndTemplates(src) {
  let out = '';
  let i = 0;
  let state = 'code'; // 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl'
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1] ?? '';
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        i += 2;
      } else if (ch === '/' && next === '*') {
        state = 'block';
        i += 2;
      } else if (ch === '`') {
        out += '`';
        state = 'tpl';
        i++;
      } else {
        out += ch;
        i++;
      }
    } else if (state === 'line') {
      if (ch === '\n') {
        out += '\n';
        state = 'code';
      }
      i++;
    } else if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
      } else {
        if (ch === '\n') out += '\n';
        i++;
      }
    } else if (state === 'tpl') {
      if (ch === '\\') {
        i += 2;
      } else if (ch === '`') {
        out += '`';
        state = 'code';
        i++;
      } else {
        if (ch === '\n') out += '\n';
        i++;
      }
    }
  }
  return out;
}

function checkModuleSpecifiers() {
  const files = [];
  for (const rel of CODE_DIRS) {
    collectJsFiles(path.join(ROOT_DIR, rel), files);
  }
  const importStmtRe = /(?:^|;|\n)\s*(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"]/g;

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const cleaned = stripCommentsAndTemplates(raw);
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    importStmtRe.lastIndex = 0;
    let m;
    while ((m = importStmtRe.exec(cleaned)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('node:')) {
        fail(`non-builtin bare/external import "${spec}" in ${rel}`);
      }
    }
  }
}

function checkFencedCodeLanguages() {
  for (const rel of GOVERNANCE_DOCS) {
    const full = path.join(ROOT_DIR, rel);
    if (!existsSync(full)) fail(`missing governance document: ${rel}`);
    const lines = readFileSync(full, 'utf8').split(/\r?\n/);
    let openFence = null; // { char, len }
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (openFence === null) {
        const openMatch = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
        if (openMatch) {
          const fence = openMatch[1];
          const info = openMatch[2].trim();
          if (info === '') {
            fail(`fenced code block without language tag in ${rel}:${idx + 1}`);
          }
          openFence = { char: fence[0], len: fence.length };
        }
      } else {
        const trimmed = line.trim();
        if (
          trimmed.length >= openFence.len &&
          [...trimmed].every((c) => c === openFence.char)
        ) {
          openFence = null;
        }
      }
    }
    if (openFence !== null) {
      fail(`unclosed fenced code block in ${rel}`);
    }
  }
}

function runNodeScript(relScript) {
  execFileSync(process.execPath, [path.join(ROOT_DIR, relScript)], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
}

checkPackageManifest();
checkForbiddenRepoFiles();
checkModuleSpecifiers();
checkFencedCodeLanguages();
runNodeScript('scripts/lint.mjs');
runNodeScript('scripts/test.mjs');
runNodeScript('scripts/build-pages.mjs');
console.log('All Lynceus checks passed.');
