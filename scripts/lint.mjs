import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIRS = ['bin', 'src', 'scripts', 'tests'];

/**
 * Recursively collect all .mjs and .js files under a directory.
 * @param {string} dir
 * @param {string[]} out
 */
function collectJsFiles(dir, out) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath, out);
    } else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.js'))) {
      out.push(fullPath);
    }
  }
}

const files = [];
for (const relDir of TARGET_DIRS) {
  collectJsFiles(path.join(ROOT_DIR, relDir), files);
}

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Lint passed (${files.length} files checked).`);
