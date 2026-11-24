import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RENDERER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer');
const files = readdirSync(RENDERER_DIR).filter((f) => f.endsWith('.mjs'));

test('src/renderer contains the expected modules', () => {
  for (const f of ['palettes.mjs', 'sanitize.mjs', 'svg.mjs', 'markdown.mjs']) {
    assert.ok(files.includes(f), f);
  }
});

test('src/renderer/*.mjs has ZERO node:* imports and only relative imports (browser-safe)', () => {
  for (const file of files) {
    const src = readFileSync(path.join(RENDERER_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/node:/.test(src), false, `${file} mentions node:`);
    assert.equal(/\brequire\s*\(/.test(src), false, `${file} uses require()`);
    assert.equal(/\bprocess\./.test(src), false, `${file} touches process`);
    assert.equal(/\bBuffer\b/.test(src), false, `${file} touches Buffer`);

    const specifiers = [
      ...src.matchAll(/\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g),
      ...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...src.matchAll(/\bexport\s+[^'"();]*?\s+from\s+['"]([^'"]+)['"]/g)
    ].map((m) => m[1]);
    for (const spec of specifiers) {
      assert.match(spec, /^\.\/[a-z-]+\.mjs$/, `${file} imports ${spec}`);
    }
  }
});

test('src/renderer modules load via plain import() and expose the shared contract', async () => {
  const palettes = await import('../../src/renderer/palettes.mjs');
  const sanitize = await import('../../src/renderer/sanitize.mjs');
  const svg = await import('../../src/renderer/svg.mjs');
  const markdown = await import('../../src/renderer/markdown.mjs');
  for (const name of ['GITHUB_THEME', 'COLOR_RAMPS', 'NEUTRAL_LEGEND_RAMP', 'RAMP_NAMES', 'getTheme', 'getRamp']) {
    assert.ok(name in palettes, name);
  }
  for (const name of ['stripControlChars', 'escapeXml', 'assertCamoSafeSvg']) assert.equal(typeof sanitize[name], 'function', name);
  for (const name of ['quantizeLevel', 'renderSvgs']) assert.equal(typeof svg[name], 'function', name);
  assert.equal(typeof markdown.renderMarkdownSnippet, 'function');
});
