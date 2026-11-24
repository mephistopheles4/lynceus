import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(ROOT_DIR, 'tests');

/**
 * Recursively collect all *.test.mjs files under tests/.
 * @param {string} dir
 * @param {string[]} out
 */
function collectTestFiles(dir, out) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      out.push(fullPath);
    }
  }
}

const allTests = [];
collectTestFiles(TESTS_DIR, allTests);

const rawFilters = process.argv.slice(2).map((arg) =>
  arg.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
);

const selected = rawFilters.length === 0
  ? allTests
  : allTests.filter((filePath) => {
      const rel = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
      return rawFilters.some((f) => rel === f || rel.startsWith(`${f}/`) || rel.includes(f));
    });

if (selected.length === 0) {
  if (rawFilters.length > 0) {
    console.error(`No test files matched filter(s): ${rawFilters.join(', ')}`);
    process.exit(1);
  }
  console.log('No test files found yet.');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...selected], {
  cwd: ROOT_DIR,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
