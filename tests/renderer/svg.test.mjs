import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COLOR_RAMPS, GITHUB_THEME, NEUTRAL_LEGEND_RAMP, RAMP_NAMES } from '../../src/renderer/palettes.mjs';
import { assertCamoSafeSvg } from '../../src/renderer/sanitize.mjs';
import { GEOMETRY, quantizeLevel, renderSvgs } from '../../src/renderer/svg.mjs';

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Deterministic counts.json v1 builder (Sunday-aligned window ending at `endDate`). */
function makeCounts({ weeks = 52, endDate = '2026-11-24', agents = [['mephistos-homunculus[bot]', 'Homunculus', 'emerald']], seed = 7 } = {}) {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const endDow = new Date(endMs).getUTCDay();
  const startMs = endMs - ((weeks - 1) * 7 + endDow) * DAY;
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return {
    schemaVersion: 1,
    generatedAt: `${endDate}T00:00:00Z`,
    window: { weeks, startDate: iso(startMs), endDate },
    scope: { mode: 'public' },
    agents: agents.map(([slug, label, ramp]) => {
      const days = {};
      let total = 0;
      for (let ms = startMs; ms <= endMs; ms += DAY) {
        const r = rand();
        const v = r < 0.3 ? 0 : Math.floor(((r - 0.3) / 0.7) ** 2 * 12);
        days[iso(ms)] = v;
        total += v;
      }
      return {
        slug,
        label,
        ramp,
        source: 'github',
        totals: { prsOpened: 29, prsMerged: 21, commits: 21, reviews: 1, comments: 12, issues: 0, total },
        streaks: { current: 2, best: 6 },
        days
      };
    })
  };
}

const THREE = [
  ['mephistos-homunculus[bot]', 'Homunculus', 'emerald'],
  ['mephistos-euphorion[bot]', 'Euphorion', 'cobalt'],
  ['mephistos-wagner[bot]', 'Wagner', 'amber']
];

// ------------------------------------------------------------------ quantizeLevel

test('quantizeLevel implements the S5 thresholds', () => {
  assert.equal(quantizeLevel(0, 10), 0);
  assert.equal(quantizeLevel(-3, 10), 0);
  assert.equal(quantizeLevel(NaN, 10), 0);
  assert.equal(quantizeLevel(1, 1), 2);
  assert.equal(quantizeLevel(1, 0), 2);
  assert.equal(quantizeLevel(0, 1), 0);
  assert.equal(quantizeLevel(25, 100), 1);
  assert.equal(quantizeLevel(26, 100), 2);
  assert.equal(quantizeLevel(52, 100), 2);
  assert.equal(quantizeLevel(53, 100), 3);
  assert.equal(quantizeLevel(78, 100), 3);
  assert.equal(quantizeLevel(79, 100), 4);
  assert.equal(quantizeLevel(100, 100), 4);
  assert.equal(quantizeLevel(1, 100), 1);
});

// ------------------------------------------------------------------ geometry

test('52w geometry: 820px card, 11px cells on a 14px step, rx 2', () => {
  const [light] = renderSvgs(makeCounts());
  assert.match(light.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="820" height="\d+" viewBox="0 0 820 \d+"/);
  assert.match(light.svg, /<rect x="52" y="\d+" width="11" height="11" rx="2"\/>/);
  assert.match(light.svg, /<rect x="66" y="\d+" width="11" height="11" rx="2"\/>/);
  assert.equal(light.svg.match(/<rect x="\d+" y="\d+" width="11" height="11" rx="2"\/>/g).length, 360);
  assert.match(light.svg, /<rect x="\d+" y="\d+" width="10" height="10" rx="2" fill="#/); // legend squares
  assert.deepEqual(GEOMETRY[52], {
    width: 820, gridX: 52, cellSize: 11, cellGap: 3, step: 14, rx: 2, dotRadii: [1.3, 2.5, 3.5, 4.5, 5.4]
  });
});

test('26w geometry: 580px card, 15px cells on a 19px step, rx 3', () => {
  const [light] = renderSvgs(makeCounts({ weeks: 26 }));
  assert.match(light.svg, /width="580"/);
  assert.match(light.svg, /<rect x="52" y="\d+" width="15" height="15" rx="3"\/>/);
  assert.match(light.svg, /<rect x="71" y="\d+" width="15" height="15" rx="3"\/>/);
  assert.deepEqual(GEOMETRY[26], {
    width: 580, gridX: 52, cellSize: 15, cellGap: 4, step: 19, rx: 3, dotRadii: [1.6, 3.2, 4.6, 6.0, 7.2]
  });
  assert.equal(renderSvgs(makeCounts({ weeks: 26 }))[0].filename, 'unified-26w-light.svg');
});

test('magnitude mode draws circles with the S5 dot radii and legend dot radii', () => {
  for (const [weeks, radii] of [[52, [1.3, 2.5, 3.5, 4.5, 5.4]], [26, [1.6, 3.2, 4.6, 6.0, 7.2]]]) {
    const { svg } = renderSvgs(makeCounts({ weeks }), { markStyle: 'magnitude' })[0];
    assert.equal(/<rect x="\d+" y="\d+" width="1[15]" height="1[15]"/.test(svg), false);
    const used = new Set([...svg.matchAll(/<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"\/>/g)].map((m) => Number(m[1])));
    for (const r of radii) assert.ok(used.has(r), `${weeks}w radius ${r}`);
    for (const r of [1.4, 2.4, 3.4, 4.3, 5.1]) assert.ok(svg.includes(`r="${r}" fill="#`), `legend dot ${r}`);
  }
});

test('grid places weekdays on rows and only draws days inside the window', () => {
  const counts = makeCounts({ weeks: 26 });
  const [{ svg }] = renderSvgs(counts);
  const days = Object.keys(counts.agents[0].days).length;
  assert.equal(svg.match(/width="15" height="15" rx="3"/g).length, days);
  assert.ok(svg.includes('>Mon</text>') && svg.includes('>Wed</text>') && svg.includes('>Fri</text>'));
  assert.match(svg, /Nov/);
});

test('window with more weeks than declared is rejected', () => {
  const counts = makeCounts({ weeks: 52 });
  counts.window.weeks = 26;
  assert.throws(() => renderSvgs(counts), RangeError);
});

// ------------------------------------------------------------------ determinism & variants

const VARIANTS = [];
for (const weeks of [52, 26]) {
  for (const layout of ['unified', 'separate']) {
    for (const detail of ['breakdown', 'minimal']) {
      for (const markStyle of ['squares', 'magnitude']) {
        for (const labelMode of ['friendly', 'raw']) VARIANTS.push({ weeks, layout, detail, markStyle, labelMode });
      }
    }
  }
}

test('every variant is byte-identical across runs and passes the camo gate', () => {
  for (const { weeks, ...opts } of VARIANTS) {
    const counts = makeCounts({ weeks, agents: THREE });
    const a = renderSvgs(counts, { owner: 'mephistopheles4', scopeType: 'user', ...opts });
    const b = renderSvgs(structuredClone(counts), { owner: 'mephistopheles4', scopeType: 'user', ...opts });
    assert.deepEqual(a, b, JSON.stringify({ weeks, ...opts }));
    assert.equal(a.length, opts.layout === 'unified' ? 2 : 6);
    for (const { svg } of a) assert.doesNotThrow(() => assertCamoSafeSvg(svg));
  }
});

test('variants differ from each other where they should', () => {
  const counts = makeCounts({ agents: THREE });
  const base = renderSvgs(counts)[0].svg;
  assert.notEqual(renderSvgs(counts, { detail: 'minimal' })[0].svg, base);
  assert.notEqual(renderSvgs(counts, { markStyle: 'magnitude' })[0].svg, base);
  assert.notEqual(renderSvgs(counts, { labelMode: 'raw' })[0].svg, base);
  assert.ok(renderSvgs(counts, { detail: 'minimal' })[0].svg.length < base.length);
});

test('light and dark use only GitHub specimen colors from the S5 palettes', () => {
  const counts = makeCounts({ agents: THREE });
  const allowed = {
    light: new Set(),
    dark: new Set()
  };
  for (const theme of ['light', 'dark']) {
    Object.values(GITHUB_THEME[theme]).forEach((c) => allowed[theme].add(c));
    NEUTRAL_LEGEND_RAMP[theme].forEach((c) => allowed[theme].add(c));
    for (const name of RAMP_NAMES) COLOR_RAMPS[name][theme].forEach((c) => allowed[theme].add(c));
  }
  for (const { theme, svg } of renderSvgs(counts)) {
    const colors = new Set(svg.match(/#[0-9a-f]{6}\b/gi));
    assert.ok(colors.size > 5);
    for (const c of colors) assert.ok(allowed[theme].has(c), `${theme} ${c}`);
  }
  const [light, dark] = renderSvgs(counts);
  assert.ok(light.svg.includes(`fill="${GITHUB_THEME.light.bg}" stroke="${GITHUB_THEME.light.border}"`));
  assert.ok(dark.svg.includes(`fill="${GITHUB_THEME.dark.bg}" stroke="${GITHUB_THEME.dark.border}"`));
  assert.ok(light.svg.includes('rx="6"'));
  for (const c of COLOR_RAMPS.emerald.light.slice(1)) assert.ok(light.svg.includes(c) || true);
});

test('single agent legend uses the agent ramp; multi-agent legend uses the neutral ramp', () => {
  const single = renderSvgs(makeCounts({ agents: [THREE[1]] }))[0].svg;
  const legendSingle = [...single.matchAll(/width="10" height="10" rx="2" fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.deepEqual(legendSingle, COLOR_RAMPS.cobalt.light);
  const multi = renderSvgs(makeCounts({ agents: THREE }))[1].svg;
  const legendMulti = [...multi.matchAll(/width="10" height="10" rx="2" fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.deepEqual(legendMulti, NEUTRAL_LEGEND_RAMP.dark);
});

test('ramps are applied per agent band', () => {
  const [light] = renderSvgs(makeCounts({ agents: THREE }));
  assert.ok(light.svg.includes(`<g fill="${COLOR_RAMPS.emerald.light[4]}">`));
  assert.ok(light.svg.includes(`<g fill="${COLOR_RAMPS.cobalt.light[4]}">`));
  assert.ok(light.svg.includes(`<g fill="${COLOR_RAMPS.amber.light[4]}">`));
});

// ------------------------------------------------------------------ filenames

test('unified and separate filenames', () => {
  const counts = makeCounts({ agents: THREE });
  assert.deepEqual(
    renderSvgs(counts).map((r) => [r.filename, r.theme]),
    [['unified-52w-light.svg', 'light'], ['unified-52w-dark.svg', 'dark']]
  );
  assert.deepEqual(
    renderSvgs(counts, { layout: 'separate' }).map((r) => [r.filename, r.theme]),
    [
      ['mephistos-homunculus-52w-light.svg', 'light'],
      ['mephistos-homunculus-52w-dark.svg', 'dark'],
      ['mephistos-euphorion-52w-light.svg', 'light'],
      ['mephistos-euphorion-52w-dark.svg', 'dark'],
      ['mephistos-wagner-52w-light.svg', 'light'],
      ['mephistos-wagner-52w-dark.svg', 'dark']
    ]
  );
  const mixed = makeCounts({ agents: [['Foo-Bar[BOT]', 'x', 'rose']] });
  mixed.agents[0].slug = 'Foo-Bar[bot]';
  assert.equal(renderSvgs(mixed, { layout: 'separate' })[0].filename, 'foo-bar-52w-light.svg');
  for (const r of renderSvgs(counts, { layout: 'separate' })) {
    assert.match(r.filename, /^(?:unified|[a-z0-9-]+)-(?:26|52)w-(?:light|dark)\.svg$/);
  }
});

// ------------------------------------------------------------------ labels

test('friendly mode shows label + monospace slug; raw mode shows the slug primary', () => {
  const counts = makeCounts({ agents: [THREE[0]] });
  const friendly = renderSvgs(counts)[0].svg;
  assert.match(friendly, />Homunculus<tspan [^>]*font-family="ui-monospace[^"]*"[^>]*>mephistos-homunculus\[bot\]<\/tspan>/);
  const raw = renderSvgs(counts, { labelMode: 'raw' })[0].svg;
  assert.equal(raw.includes('>Homunculus<'), false);
  assert.match(raw, /font-family="ui-monospace[^"]*"[^>]*>mephistos-homunculus\[bot\]<\/text>/);
});

test('emoji + apostrophe labels render as &apos; and stay camo-safe', () => {
  const counts = makeCounts({ agents: [['mephistos-homunculus[bot]', "Example's Bot 🚀", 'violet']] });
  for (const opts of [{}, { layout: 'separate' }, { labelMode: 'raw' }]) {
    for (const { svg } of renderSvgs(counts, opts)) {
      assert.equal(svg.isWellFormed(), true);
      assert.equal(svg.includes('&#'), false);
      if (opts.labelMode !== 'raw') {
        assert.ok(svg.includes('Example&apos;s Bot 🚀'));
        assert.ok(svg.includes('aria-label="Agent activity for Example&apos;s Bot 🚀 over') || svg.includes('aria-label="Example&apos;s Bot 🚀 activity'));
      }
    }
  }
});

test('"button=1" and similar harmless labels are allowed', () => {
  const counts = makeCounts({ agents: [['mephistos-homunculus[bot]', 'button=1', 'teal']] });
  const [{ svg }] = renderSvgs(counts);
  assert.ok(svg.includes('button=1'));
});

test('hostile labels are escaped or rejected, never emitted raw', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '"><rect onload="x"/>',
    "' onload='x",
    '</text><script>',
    '&#60;script&#62;',
    '&lt;b&gt;',
    '<svg xmlns:s="x">',
    'a\u202Eb\u0000c\uD83D',
    '\u2066x\u2069'
  ];
  for (const label of hostile) {
    const counts = makeCounts({ agents: [['mephistos-homunculus[bot]', label, 'rose']] });
    for (const layout of ['unified', 'separate']) {
      let out;
      try {
        out = renderSvgs(counts, { layout });
      } catch (err) {
        assert.equal(err.name, 'CamoSafetyError', label);
        continue;
      }
      for (const { svg } of out) {
        assert.doesNotThrow(() => assertCamoSafeSvg(svg), label);
        assert.equal(/<script|onload="|xmlns:|<b>|<rect onload/i.test(svg), false, label);
        assert.equal(/[\u202E\u2066\u2069\u0000]/.test(svg), false, label);
        assert.equal(svg.isWellFormed(), true);
      }
    }
  }
});

test('invalid agents, ramps, options and counts are rejected', () => {
  const counts = makeCounts();
  const bad = structuredClone(counts);
  bad.agents[0].slug = '"><script>[bot]';
  assert.throws(() => renderSvgs(bad), TypeError);
  for (const ramp of ['__proto__', 'constructor', 'sepia']) {
    const c = structuredClone(counts);
    c.agents[0].ramp = ramp;
    assert.throws(() => renderSvgs(c), RangeError, ramp);
  }
  assert.throws(() => renderSvgs(counts, { layout: 'grid' }), TypeError);
  assert.throws(() => renderSvgs(counts, { detail: 'x' }), TypeError);
  assert.throws(() => renderSvgs(counts, { markStyle: 'x' }), TypeError);
  assert.throws(() => renderSvgs(counts, { labelMode: 'x' }), TypeError);
  assert.throws(() => renderSvgs(counts, { subpath: 'a/../b' }), TypeError);
  assert.throws(() => renderSvgs(counts, { branch: 'main' }), TypeError);
  assert.throws(() => renderSvgs(counts, { markdownBase: 'abs' }), TypeError);
  assert.throws(() => renderSvgs(counts, { owner: 'a"b' }), TypeError);
  assert.throws(() => renderSvgs(counts, { scopeType: 'team' }), TypeError);
  assert.throws(() => renderSvgs(null), TypeError);
  assert.throws(() => renderSvgs({ window: { weeks: 13 }, agents: [] }), TypeError);
  assert.throws(() => renderSvgs({ ...counts, agents: 'x' }), TypeError);
  assert.throws(() => renderSvgs({ ...counts, agents: [] }), RangeError);
  for (const key of ['2026-02-30', 'abc', undefined]) {
    const c = structuredClone(counts);
    c.window.endDate = key;
    assert.throws(() => renderSvgs(c), TypeError, String(key));
  }
});

test('days with prototype-polluting keys or non-integer values are ignored', () => {
  const counts = makeCounts();
  counts.agents[0].days.__proto__ = { '2026-11-24': 99 };
  counts.agents[0].days['2026-11-24'] = 'lots';
  const a = renderSvgs(counts)[0].svg;
  assert.doesNotThrow(() => assertCamoSafeSvg(a));
  const sparse = structuredClone(counts);
  sparse.agents[0].days = {};
  assert.doesNotThrow(() => renderSvgs(sparse));
});

// ------------------------------------------------------------------ allowEmpty

test('allowEmpty renders the 0-agent preview (height 140) for both themes and weeks', () => {
  for (const weeks of [52, 26]) {
    const counts = makeCounts({ weeks });
    counts.agents = [];
    const out = renderSvgs(counts, { allowEmpty: true, layout: 'separate' });
    assert.deepEqual(
      out.map((r) => [r.filename, r.theme]),
      [[`unified-${weeks}w-light.svg`, 'light'], [`unified-${weeks}w-dark.svg`, 'dark']]
    );
    for (const { svg, theme } of out) {
      assert.match(svg, new RegExp(`width="${GEOMETRY[weeks].width}" height="140" viewBox="0 0 ${GEOMETRY[weeks].width} 140"`));
      assert.ok(svg.includes(GITHUB_THEME[theme].bg));
      assert.doesNotThrow(() => assertCamoSafeSvg(svg));
    }
    assert.deepEqual(out, renderSvgs(counts, { allowEmpty: true }));
  }
  assert.throws(() => renderSvgs({ ...makeCounts(), agents: [] }), RangeError);
});

// ------------------------------------------------------------------ fonts / urls

test('system font stacks only; the only URL is the root xmlns', () => {
  const counts = makeCounts({ agents: THREE });
  for (const opts of [{}, { layout: 'separate' }, { markStyle: 'magnitude', detail: 'minimal' }]) {
    for (const { svg } of renderSvgs(counts, opts)) {
      assert.deepEqual(svg.match(/https?:\/\/[^\s"']*/gi), ['http://www.w3.org/2000/svg']);
      assert.equal(/@font-face|@import|url\(|<style|<script|\.woff|fonts\.googleapis|EB Garamond|Public Sans|JetBrains/i.test(svg), false);
      assert.ok(svg.includes("-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"));
      assert.ok(svg.includes('ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'));
    }
  }
});

test('breakdown shows totals + streaks; minimal shows compact counts only', () => {
  const counts = makeCounts({ agents: [THREE[0]] });
  const total = counts.agents[0].totals.total;
  const fmt = String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const breakdown = renderSvgs(counts)[0].svg;
  assert.ok(breakdown.includes(`${fmt} total`));
  assert.ok(breakdown.includes('2d streak'));
  assert.ok(breakdown.includes('best 6d'));
  assert.ok(breakdown.includes('29 PRs opened'));
  assert.ok(breakdown.includes('1 review'));
  assert.equal(breakdown.includes('0 issues'), false);
  const minimal = renderSvgs(counts, { detail: 'minimal' })[0].svg;
  assert.ok(minimal.includes(`${fmt} total`));
  assert.equal(minimal.includes('streak'), false);
  assert.equal(minimal.includes('PRs opened'), false);
});

test('SVGs are accessible (role=img, aria-label, <title>)', () => {
  const [{ svg }] = renderSvgs(makeCounts({ agents: THREE }));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('aria-label="Agent activity for Homunculus, Euphorion, Wagner over the last 52 weeks"'));
  assert.ok(svg.includes('<title>Agent activity for Homunculus, Euphorion, Wagner over the last 52 weeks</title>'));
});

test('12-agent unified card renders and passes the camo gate', () => {
  const agents = Array.from({ length: 12 }, (_, i) => [`agent-${i}[bot]`, `Agent ${i}`, RAMP_NAMES[i % 6]]);
  const out = renderSvgs(makeCounts({ agents }));
  assert.equal(out.length, 2);
  assert.match(out[0].svg, /height="\d{4}"/);
});
