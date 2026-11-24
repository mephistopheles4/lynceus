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
  initApp,
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

  // Lynceus visual tokens & browser surface styling
  for (const token of ['#0A1021', '#111B33', '#090E1C', '#B9381D', '#E8A878', '#4ADE80', '#FCA5A5', '#0d1117', '#ffffff', '838px', '::selection', 'caret-color', ':focus-visible', 'tabular-nums']) {
    assert.ok(css.includes(token), `styles.css must include Lynceus token/rule: ${token}`);
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

    for (const badFile of ['lynceus.json', '.env', 'private-config.json']) {
      const cfgPublic = path.join(tmpRoot, `cfg-${badFile.replace(/[^a-z]/gi, '_')}`);
      cpSync(PUBLIC_DIR, cfgPublic, { recursive: true });
      writeFileSync(path.join(cfgPublic, badFile), '{}');
      await assert.rejects(
        () => buildPages({ outDir: path.join(tmpRoot, 'cfg-out'), publicDir: cfgPublic }),
        new RegExp(badFile.replace(/\./g, '\\.'))
      );
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('C10: initApp DOM wiring handles bootstrap, warnings, discover errors, schedule disabled fields, privacyNotice & Blob download', async () => {
  const html = readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const elements = new Map();
  const makeNode = (tag = 'div') => {
    const listeners = new Map();
    const classes = new Set();
    const node = {
      tagName: tag.toUpperCase(),
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      textContent: '',
      dataset: {},
      attributes: new Map(),
      children: [],
      style: {},
      classList: {
        add(...xs) { xs.forEach((x) => classes.add(x)); },
        remove(...xs) { xs.forEach((x) => classes.delete(x)); },
        toggle(x, f) { if (f === undefined ? !classes.has(x) : f) classes.add(x); else classes.delete(x); },
        contains(x) { return classes.has(x); }
      },
      setAttribute(k, v) { node.attributes.set(k, String(v)); },
      getAttribute(k) { return node.attributes.get(k) ?? null; },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      async dispatch(ev, extra = {}) {
        const event = { preventDefault() {}, target: node, ...extra };
        for (const fn of listeners.get(ev) ?? []) await fn(event);
      },
      appendChild(child) {
        node.children.push(child);
        return child;
      },
      append(...kids) {
        node.children.push(...kids);
      },
      querySelectorAll(sel) {
        if (sel === '[data-scope]') return scopeBtns;
        return [];
      },
      replaceChildren(...kids) { node.children = [...kids]; },
      click() { node._clicked = (node._clicked ?? 0) + 1; },
      remove() {}
    };
    return node;
  };
  for (const id of ids) {
    const n = makeNode(id.includes('checkbox') || id.includes('input') ? 'input' : 'div');
    n.id = id;
    elements.set(id, n);
  }
  elements.get('schedule-target-select').value = 'task-scheduler';
  elements.get('schedule-task-name').value = 'LynceusProfileRefresh';
  elements.get('schedule-repo-dir').value = '.';

  const makeSelectorGroup = (attr, values) => values.map((v) => {
    const n = makeNode('button');
    n.dataset[attr] = v;
    return n;
  });
  const scopeBtns = makeSelectorGroup('scope', ['user', 'org']);
  const optionBtns = [
    ...['unified', 'separate'].map((v) => Object.assign(makeNode('button'), { dataset: { option: 'layout', value: v } })),
    ...['52', '26'].map((v) => Object.assign(makeNode('button'), { dataset: { option: 'windowWeeks', value: v } })),
    ...['breakdown', 'minimal'].map((v) => Object.assign(makeNode('button'), { dataset: { option: 'detail', value: v } })),
    ...['squares', 'magnitude'].map((v) => Object.assign(makeNode('button'), { dataset: { option: 'markStyle', value: v } })),
    ...['friendly', 'raw'].map((v) => Object.assign(makeNode('button'), { dataset: { option: 'labelMode', value: v } }))
  ];
  const themeBtns = makeSelectorGroup('theme', ['both', 'dark', 'light']);
  const metricInputs = ['prsOpened', 'prsMerged', 'commits', 'reviews', 'comments', 'issues'].map((m) => {
    const n = makeNode('input');
    n.dataset.metric = m;
    n.checked = true;
    return n;
  });
  const tabBtns = ['config', 'markdown', 'counts', 'schedule'].map((t) => elements.get(`tab-btn-${t}`));

  const apiCalls = [];
  const downloads = [];
  const origWin = globalThis.window;
  const origDoc = globalThis.document;
  const origFetch = globalThis.fetch;
  const origURL = globalThis.URL;

  try {
    globalThis.window = { __LYNCEUS_BOOTSTRAP__: { mode: 'local', token: 'tok-123' } };
    globalThis.document = {
      body: makeNode('body'),
      createElement: (tag) => makeNode(tag),
      createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
      getElementById: (id) => elements.get(id) ?? null,
      querySelectorAll: (sel) => {
        if (sel === '[data-metric]') return metricInputs;
        if (sel === '.tab-btn') return tabBtns;
        if (sel === '[data-scope]') return scopeBtns;
        if (sel === '[data-option]') return optionBtns;
        if (sel === '[data-theme]') return themeBtns;
        return [];
      }
    };
    globalThis.URL = {
      createObjectURL(blob) {
        downloads.push(blob);
        return `blob:mock-${downloads.length}`;
      },
      revokeObjectURL() {}
    };
    globalThis.fetch = async (url, init) => {
      const payload = JSON.parse(init.body);
      apiCalls.push({ url, payload });
      if (url === '/api/status') return { ok: true, status: 200, json: async () => ({ authPresent: true, authSource: 'env' }) };
      if (url === '/api/config') return { ok: true, status: 200, json: async () => ({ hasConfig: false, config: null }) };
      if (url === '/api/preview') {
        const svgs = renderSvgs(DEMO_COUNTS_52W, payload.config);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            counts: DEMO_COUNTS_52W,
            svgs,
            markdownSnippet: '<picture/>',
            isSynthetic: true,
            warnings: [{ code: 'SCOPE_CAVEAT', detail: 'Token caveat' }]
          })
        };
      }
      if (url === '/api/discover') {
        return { ok: false, status: 502, json: async () => ({ error: 'API_ERROR', message: 'Upstream failed' }) };
      }
      if (url === '/api/schedule') {
        if (payload.target === 'actions' && payload.scriptPath !== undefined) {
          return { ok: false, status: 400, json: async () => ({ error: 'VALIDATION_ERROR', message: 'scriptPath rejected' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            filename: 'lynceus.yml',
            scriptPath: '.github/workflows/lynceus.yml',
            snippet: 'name: Lynceus',
            instructions: 'Commit workflow',
            privacyNotice: 'WARNING: private notice'
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    };

    initApp();
    await new Promise((r) => setTimeout(r, 25));

    // Bootstrap consumed & warnings rendered
    assert.equal(globalThis.window.__LYNCEUS_BOOTSTRAP__, undefined);
    assert.equal(elements.get('warnings-banner').hidden, false);
    assert.match(elements.get('warnings-banner').textContent, /SCOPE_CAVEAT/);

    // Switch Schedule target from task-scheduler (with scriptPath entered) -> actions: disabled scriptPath must be omitted
    elements.get('schedule-target-select').value = 'task-scheduler';
    await elements.get('schedule-target-select').dispatch('change');
    elements.get('schedule-script-path').value = 'D:\\Private\\refresh.ps1';
    elements.get('schedule-target-select').value = 'actions';
    await elements.get('schedule-target-select').dispatch('change');
    assert.equal(elements.get('schedule-script-path').disabled, true);
    elements.get('schedule-tool-ref').value = 'a'.repeat(40);
    await elements.get('schedule-form').dispatch('submit');

    const schedCall = apiCalls.find((c) => c.url === '/api/schedule');
    assert.ok(schedCall);
    assert.equal('scriptPath' in schedCall.payload && schedCall.payload.scriptPath !== undefined, false);
    assert.equal(elements.get('schedule-error-banner').hidden, true);
    assert.equal(elements.get('schedule-privacy-notice').textContent, 'WARNING: private notice');

    // Download script triggers Blob with standalone snippet only (not instructions)
    const beforeDownloads = downloads.length;
    await elements.get('download-schedule-btn').dispatch('click');
    assert.equal(downloads.length, beforeDownloads + 1);
    assert.equal(await downloads.at(-1).text(), 'name: Lynceus');

    // Discover error clears stale SVG stage
    await elements.get('discover-btn').dispatch('click');
    assert.equal(elements.get('global-error-banner').hidden, false);
    assert.match(elements.get('global-error-banner').textContent, /Upstream failed/);
    assert.equal(elements.get('stage-telemetry').textContent, 'CLEARED ON ERROR');
    assert.equal(elements.get('readme-stage-grid').children[0]?.className, 'empty-state');
  } finally {
    globalThis.window = origWin;
    globalThis.document = origDoc;
    globalThis.fetch = origFetch;
    globalThis.URL = origURL;
  }
});
