/**
 * Static GitHub Pages demo bundle builder & leak scanner (S7, C10).
 * Copies `src/builder-ui/public/*` and `src/renderer/*.mjs` to `dist-pages/`
 * and fails non-zero if any forbidden localhost/API/token/workstation/real-config markers appear.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertStrictCountsOnly } from '../src/collector/privacy-gate.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'src', 'builder-ui', 'public');
const RENDERER_DIR = path.join(ROOT_DIR, 'src', 'renderer');
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'dist-pages');

const REQUIRED_ASSETS = [
  'index.html',
  'favicon.ico',
  'styles.css',
  'app.js',
  'demo-data.js',
  'renderer/palettes.mjs',
  'renderer/sanitize.mjs',
  'renderer/svg.mjs',
  'renderer/markdown.mjs'
];

const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md']);

const FORBIDDEN_PATTERNS = [
  { name: 'loopback IP (127.0.0.1)', re: /127\.0\.0\.1/ },
  { name: 'GitHub API origin (api.github.com)', re: /api\.github\.com/i },
  { name: 'GITHUB_TOKEN identifier', re: /GITHUB_TOKEN/ },
  { name: 'Windows C:\\Users path', re: /C:[\\/]+Users/i },
  { name: 'Windows H:\\src path', re: /H:[\\/]+src/i },
  { name: 'POSIX /Users/ path', re: /\/Users\// },
  { name: 'POSIX /home/ path', re: /\/home\// },
  { name: 'real profile owner marker', re: /mephistopheles4|mephistos-/i },
  { name: 'private scope marker', re: /public\+private/ },
  { name: 'GitHub token prefix', re: /(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{10,}/ },
  { name: 'external Google Fonts', re: /fonts\.googleapis\.com|fonts\.gstatic\.com/i }
];

function collectFiles(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Build `dist-pages/` and run the mandatory static leak/hygiene verification.
 * @param {{ outDir?: string, publicDir?: string }} [options]
 * @returns {Promise<{ outDir: string, fileCount: number }>}
 */
export async function buildPages({ outDir = DEFAULT_OUT_DIR, publicDir = PUBLIC_DIR } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(publicDir, outDir, { recursive: true });
  const rendererOut = path.join(outDir, 'renderer');
  mkdirSync(rendererOut, { recursive: true });
  for (const entry of readdirSync(RENDERER_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      cpSync(path.join(RENDERER_DIR, entry.name), path.join(rendererOut, entry.name));
    }
  }

  for (const rel of REQUIRED_ASSETS) {
    const target = path.join(outDir, rel);
    if (!existsSync(target) || statSync(target).size === 0) {
      throw new Error(`Pages build missing or empty required asset: ${rel}`);
    }
  }

  // Ensure no real lynceus.json or counts.json slipped into dist-pages/
  const files = collectFiles(outDir);
  for (const file of files) {
    const base = path.basename(file).toLowerCase();
    if (base === 'lynceus.json' || base === 'counts.json') {
      throw new Error(`Pages build leak check failed: unexpected ${base} in dist-pages`);
    }
  }

  // Scan every emitted text file
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(outDir, file).replace(/\\/g, '/');

    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.re.test(text)) {
        throw new Error(`Pages build leak check failed in ${rel}: matched ${rule.name}`);
      }
    }

    if (rel === 'index.html') {
      if (!text.includes('<!-- LYNCEUS_BOOTSTRAP -->')) {
        throw new Error('Pages build failed: dist-pages/index.html missing <!-- LYNCEUS_BOOTSTRAP -->');
      }
      if (text.includes('window.__LYNCEUS_BOOTSTRAP__')) {
        throw new Error('Pages build leak check failed: bootstrap script injected into dist-pages/index.html');
      }
      if (/(?:href|src)=["']\/(?!\/)/.test(text)) {
        throw new Error('Pages build failed: absolute root-relative asset URL found in dist-pages/index.html');
      }
    }
  }

  // Verify demo-data.js presets pass assertStrictCountsOnly
  const demoMod = await import(`${pathToFileURL(path.join(outDir, 'demo-data.js')).href}?v=${Date.now()}`);
  assertStrictCountsOnly(demoMod.DEMO_COUNTS_52W);
  assertStrictCountsOnly(demoMod.DEMO_COUNTS_26W);

  return { outDir, fileCount: files.length };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const result = await buildPages();
  console.log(`Built GitHub Pages bundle (${result.fileCount} files verified) at ${result.outDir}`);
}
