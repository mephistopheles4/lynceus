import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import { renderSvgs } from '../../src/renderer/svg.mjs';

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function makeCounts(agentCount, weeks = 52, endDate = '2026-11-24') {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const startMs = endMs - ((weeks - 1) * 7 + new Date(endMs).getUTCDay()) * DAY;
  const ramps = ['emerald', 'cobalt', 'amber', 'violet', 'rose', 'teal'];
  const agents = Array.from({ length: agentCount }, (_, a) => {
    const days = {};
    let total = 0;
    let i = 0;
    // Dense worst case: every day active with a spread of levels (all 5 buckets populated).
    for (let ms = startMs; ms <= endMs; ms += DAY, i++) {
      const v = (i * 7 + a * 3) % 13;
      days[iso(ms)] = v;
      total += v;
    }
    return {
      slug: `agent-${a}-with-a-fairly-long-name[bot]`,
      label: `Agent number ${a} with a long label`,
      ramp: ramps[a % 6],
      source: 'github',
      totals: { prsOpened: 29, prsMerged: 21, commits: 21, reviews: 14, comments: 12, issues: 3, total },
      streaks: { current: 12, best: 99 },
      days
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: `${endDate}T00:00:00Z`,
    window: { weeks, startDate: iso(startMs), endDate },
    scope: { mode: 'public' },
    agents
  };
}

const bytes = (s) => Buffer.byteLength(s, 'utf8');

test('unified 52w stays within 42 KB per agent band (and 125 KB at 3 agents)', () => {
  for (const markStyle of ['squares', 'magnitude']) {
    for (const detail of ['breakdown', 'minimal']) {
      for (const n of [1, 2, 3, 12]) {
        for (const { svg, filename } of renderSvgs(makeCounts(n), { markStyle, detail })) {
          assert.ok(bytes(svg) <= 42 * 1024 * n, `${filename} ${markStyle}/${detail} n=${n}: ${bytes(svg)}B`);
          if (n === 3) assert.ok(bytes(svg) <= 125 * 1024, `${filename} 3 agents ${bytes(svg)}B`);
        }
      }
    }
  }
});

test('separate SVGs are each <= 45 KB (52w and 26w)', () => {
  for (const weeks of [52, 26]) {
    for (const markStyle of ['squares', 'magnitude']) {
      for (const { svg, filename } of renderSvgs(makeCounts(3, weeks), { layout: 'separate', markStyle })) {
        assert.ok(bytes(svg) <= 45 * 1024, `${filename}: ${bytes(svg)}B`);
      }
    }
  }
});

test('renderSvgs renders 3 agents / 52w (both themes) in <= 50 ms', () => {
  const counts = makeCounts(3);
  for (let i = 0; i < 5; i++) renderSvgs(counts); // JIT warm-up
  const samples = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    renderSvgs(counts);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  assert.ok(median <= 50, `median ${median.toFixed(2)} ms (samples ${samples.map((s) => s.toFixed(1)).join(', ')})`);
  const separate = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    renderSvgs(counts, { layout: 'separate' });
    separate.push(performance.now() - t0);
  }
  separate.sort((a, b) => a - b);
  assert.ok(separate[4] <= 50, `separate median ${separate[4].toFixed(2)} ms`);
});
