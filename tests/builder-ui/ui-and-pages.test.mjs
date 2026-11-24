import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPages } from '../../scripts/build-pages.mjs';
import {
  DEMO_COUNTS_26W,
  DEMO_COUNTS_52W,
  DEMO_DEFAULT_CONFIG,
  DEMO_PRESETS,
  buildDemoCountsForConfig
} from '../../src/builder-ui/public/demo-data.js';
import { assertStrictCountsOnly } from '../../src/collector/privacy-gate.mjs';
import { renderSvgs } from '../../src/renderer/svg.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'src', 'builder-ui', 'public');

const tmpAppDir = mkdtempSync(path.join(os.tmpdir(), 'lynceus-app-import-'));
await buildPages({ outDir: tmpAppDir });
const {
  applyScopedError,
  applyVisualOverridesToCounts,
  buildDataCacheKey,
  consumeBootstrap,
  normalizeBotSlugInput
} = await import(pathToFileURL(path.join(tmpAppDir, 'app.js')).href);

test.after(() => {
  rmSync(tmpAppDir, { recursive: true, force: true });
});

test('C10: public/* static hygiene — zero innerHTML, inline style=, localStorage, third-party fonts, or banned strings', () => {
  const html = readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const css = readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');
  const js = readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const demo = readFileSync(path.join(PUBLIC_DIR, 'demo-data.js'), 'utf8');

  for (const [name, content] of [
    ['index.html', html],
    ['styles.css', css],
    ['app.js', js],
    ['demo-data.js', demo]
  ]) {
    assert.ok(!/127\.0\.0\.1/.test(content), `${name} must not mention 127.0.0.1`);
    assert.ok(!/api\.github\.com/i.test(content), `${name} must not mention api.github.com`);
    assert.ok(!/GITHUB_TOKEN/.test(content), `${name} must not mention GITHUB_TOKEN`);
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(content), `${name} must not load Google Fonts`);
  }

  // Zero innerHTML, zero localStorage, zero inline style=
  assert.ok(!/\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b/.test(js));
  assert.ok(!/\blocalStorage\b|\bsessionStorage\b/.test(js));
  assert.ok(!/\.style\b|setAttribute\(\s*['"]style['"]/.test(js));
  assert.ok(!/\sstyle=/.test(html));
  assert.ok(!/<style[\s>]/i.test(html));

  // Relative ./ paths & bootstrap marker
  assert.ok(html.includes('<!-- LYNCEUS_BOOTSTRAP -->'));
  assert.ok(html.includes('href="./favicon.ico"'));
  assert.ok(html.includes('href="./styles.css"'));
  assert.ok(html.includes('src="./app.js"'));
  assert.ok(!/(?:href|src)=["']\/(?!\/)/.test(html));

  // Agent Atlas visual tokens & browser surface styling
  for (const token of ['#0A1021', '#111B33', '#090E1C', '#B9381D', '#E8A878', '#4ADE80', '#FCA5A5', '#0d1117', '#ffffff', '838px', '::selection', 'caret-color', ':focus-visible', 'tabular-nums']) {
    assert.ok(css.includes(token), `styles.css must include Agent Atlas token/rule: ${token}`);
  }
});

test('C10: consumeBootstrap captures & deletes window.__LYNCEUS_BOOTSTRAP__ and handles demo mode', () => {
  assert.deepEqual(consumeBootstrap({}), { mode: 'demo', token: null });
  assert.deepEqual(consumeBootstrap(undefined), { mode: 'demo', token: null });

  const mockWin = { __LYNCEUS_BOOTSTRAP__: { token: 'abc123token', mode: 'local' } };
  const captured = consumeBootstrap(mockWin);
  assert.deepEqual(captured, { mode: 'local', token: 'abc123token' });
  assert.equal(mockWin.__LYNCEUS_BOOTSTRAP__, undefined);
  assert.equal('__LYNCEUS_BOOTSTRAP__' in mockWin, false);
});

test('C10: demo-data.js presets pass strict counts.json v1 and preserve Configure edits across 52w <-> 26w', () => {
  assertStrictCountsOnly(DEMO_COUNTS_52W);
  assertStrictCountsOnly(DEMO_COUNTS_26W);

  const editedConfig = {
    ...DEMO_DEFAULT_CONFIG,
    owner: 'custom-org',
    scopeType: 'org',
    windowWeeks: 26,
    layout: 'separate',
    detail: 'minimal',
    markStyle: 'magnitude',
    labelMode: 'raw',
    metrics: { ...DEMO_DEFAULT_CONFIG.metrics, issues: false },
    agents: [
      { slug: 'dependapilot[bot]', label: 'Custom Pilot', ramp: 'violet' },
      { slug: 'new-agent[bot]', label: 'New Agent', ramp: 'teal' }
    ]
  };

  const counts26 = buildDemoCountsForConfig(editedConfig, DEMO_PRESETS);
  assertStrictCountsOnly(counts26);
  assert.equal(counts26.window.weeks, 26);
  assert.equal(counts26.agents.length, 2);
  assert.equal(counts26.agents[0].label, 'Custom Pilot');
  assert.equal(counts26.agents[0].ramp, 'violet');
  assert.equal(counts26.agents[1].slug, 'new-agent[bot]');
  assert.equal(counts26.agents[1].totals.issues, 0);

  const counts52 = buildDemoCountsForConfig({ ...editedConfig, windowWeeks: 52 }, DEMO_PRESETS);
  assertStrictCountsOnly(counts52);
  assert.equal(counts52.window.weeks, 52);
  assert.equal(counts52.agents[0].label, 'Custom Pilot');
  assert.equal(counts52.agents[0].ramp, 'violet');
  assert.equal(counts52.agents[1].slug, 'new-agent[bot]');
});

test('C10: decoupled render cache key excludes visual toggles and visual re-render stays < 25 ms', () => {
  const baseKey = buildDataCacheKey(DEMO_DEFAULT_CONFIG);
  const visualConfig = {
    ...DEMO_DEFAULT_CONFIG,
    layout: 'separate',
    detail: 'minimal',
    markStyle: 'magnitude',
    labelMode: 'raw',
    agents: DEMO_DEFAULT_CONFIG.agents.map((a) => ({ ...a, label: `${a.label} X`, ramp: 'rose' }))
  };
  assert.equal(buildDataCacheKey(visualConfig), baseKey);

  const changedWindowKey = buildDataCacheKey({ ...DEMO_DEFAULT_CONFIG, windowWeeks: 26 });
  assert.notEqual(changedWindowKey, baseKey);

  const projected = applyVisualOverridesToCounts(DEMO_COUNTS_52W, visualConfig);
  assert.equal(projected.agents[0].ramp, 'rose');

  // Warm JIT then measure visual-only re-render time
  renderSvgs(projected, visualConfig);
  const t0 = performance.now();
  const svgs = renderSvgs(projected, visualConfig);
  const elapsed = performance.now() - t0;
  assert.equal(svgs.length, 6);
  assert.ok(elapsed < 25, `Visual-only re-render took ${elapsed.toFixed(2)} ms (budget < 25 ms)`);
});

test('C10: normalizeBotSlugInput and scoped error clearing (schedule error keeps SVGs intact)', () => {
  assert.equal(normalizeBotSlugInput('my-helper'), 'my-helper[bot]');
  assert.equal(normalizeBotSlugInput('my-helper[BOT]'), 'my-helper[bot]');
  assert.equal(normalizeBotSlugInput('  '), '');

  const state = {
    fatalError: '',
    scheduleError: '',
    counts: DEMO_COUNTS_52W,
    svgs: [{ filename: 'unified-52w-dark.svg', theme: 'dark', svg: '<svg/>' }],
    markdownSnippet: '<picture>...</picture>',
    warnings: [{ code: 'W', detail: 'x' }],
    scheduleResult: { snippet: 'echo hi', filename: 'lynceus-refresh.sh' }
  };

  applyScopedError(state, 'schedule', 'Actions rejected');
  assert.equal(state.scheduleError, 'Actions rejected');
  assert.equal(state.scheduleResult, null);
  assert.equal(state.svgs.length, 1, 'Schedule error must keep valid Workbench SVGs intact');
  assert.ok(state.counts !== null);

  applyScopedError(state, 'preview', 'Preview failed');
  assert.equal(state.fatalError, 'Preview failed');
  assert.equal(state.svgs.length, 0, 'Preview error must clear stale SVG previews');
  assert.equal(state.counts, null);
});

test('C10: build-pages.mjs builds clean dist-pages/, passes subpath fetch check, and fails on leaks', async () => {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'lynceus-pages-test-'));
  try {
    const outDir = path.join(tmpRoot, 'dist-pages');
    const built = await buildPages({ outDir });
    assert.ok(built.fileCount >= 9);

    const distHtml = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.ok(distHtml.includes('<!-- LYNCEUS_BOOTSTRAP -->'));
    assert.ok(!distHtml.includes('window.__LYNCEUS_BOOTSTRAP__'));

    // Simulate static hosting under GitHub Pages /<repo>/ subpath
    const server = http.createServer((req, res) => {
      const urlPath = (req.url ?? '/').split('?')[0];
      if (!urlPath.startsWith('/lynceus/')) {
        res.writeHead(404).end('Not found');
        return;
      }
      const rel = urlPath.slice('/lynceus/'.length) || 'index.html';
      const filePath = path.join(outDir, rel);
      if (!existsSync(filePath)) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200).end(readFileSync(filePath));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      for (const rel of [
        'index.html',
        'favicon.ico',
        'styles.css',
        'app.js',
        'demo-data.js',
        'renderer/palettes.mjs',
        'renderer/sanitize.mjs',
        'renderer/svg.mjs',
        'renderer/markdown.mjs'
      ]) {
        const res = await fetch(`http://127.0.0.1:${port}/lynceus/${rel}`);
        assert.equal(res.status, 200, `Subpath asset /lynceus/${rel} must return 200`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    // Verify leak scanner fails non-zero on forbidden markers
    for (const marker of ['127.0.0.1', 'api.github.com', 'GITHUB_TOKEN', 'C:\\Users\\alice', 'H:\\src\\repo', '/Users/alice', '/home/bob', 'mephistopheles4']) {
      const dirtyPublic = path.join(tmpRoot, 'dirty-public');
      rmSync(dirtyPublic, { recursive: true, force: true });
      cpSync(PUBLIC_DIR, dirtyPublic, { recursive: true });
      writeFileSync(path.join(dirtyPublic, 'leak.js'), `export const x = ${JSON.stringify(marker)};\n`);
      await assert.rejects(() => buildPages({ outDir: path.join(tmpRoot, 'dirty-out'), publicDir: dirtyPublic }));
    }

    // Verify leak scanner fails when lynceus.json is present in publicDir
    const cfgPublic = path.join(tmpRoot, 'cfg-public');
    cpSync(PUBLIC_DIR, cfgPublic, { recursive: true });
    writeFileSync(path.join(cfgPublic, 'lynceus.json'), '{}');
    await assert.rejects(() => buildPages({ outDir: path.join(tmpRoot, 'cfg-out'), publicDir: cfgPublic }));
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
