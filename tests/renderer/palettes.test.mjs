import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COLOR_RAMPS,
  GITHUB_THEME,
  NEUTRAL_LEGEND_RAMP,
  RAMP_NAMES,
  getRamp,
  getTheme
} from '../../src/renderer/palettes.mjs';

test('GITHUB_THEME matches SPEC S5 exactly', () => {
  assert.deepEqual(GITHUB_THEME.light, {
    bg: '#ffffff',
    border: '#d1d9e0',
    divider: '#eaeef2',
    ink: '#1f2328',
    muted: '#59636e',
    badgeBg: '#f6f8fa',
    badgeText: '#59636e',
    empty: '#eff2f5'
  });
  assert.deepEqual(GITHUB_THEME.dark, {
    bg: '#0d1117',
    border: '#30363d',
    divider: '#21262d',
    ink: '#e6edf3',
    muted: '#8d96a0',
    badgeBg: '#161b22',
    badgeText: '#8d96a0',
    empty: '#161b22'
  });
});

test('COLOR_RAMPS matches SPEC S5 exactly for all six ramps', () => {
  const expected = {
    emerald: [
      ['#eff2f5', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
      ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
    ],
    cobalt: [
      ['#eff2f5', '#b6e3ff', '#54aeff', '#0969da', '#0550ae'],
      ['#161b22', '#0c2d6b', '#1158c7', '#388bfd', '#79c0ff']
    ],
    amber: [
      ['#eff2f5', '#ffd8b5', '#fb8f44', '#d44d2e', '#9a2f15'],
      ['#161b22', '#4a2010', '#8f3918', '#d44d2e', '#ff8b66']
    ],
    violet: [
      ['#eff2f5', '#e2c5ff', '#a371f7', '#8250df', '#5a32a3'],
      ['#161b22', '#271052', '#553098', '#8957e5', '#c297ff']
    ],
    rose: [
      ['#eff2f5', '#ffcecb', '#ff8182', '#cf222e', '#82071e'],
      ['#161b22', '#4c1118', '#8e1519', '#da3633', '#ff7b72']
    ],
    teal: [
      ['#eff2f5', '#a5f3fc', '#22d3ee', '#0e7490', '#164e63'],
      ['#161b22', '#0c3b45', '#155e75', '#0891b2', '#67e8f9']
    ]
  };
  assert.deepEqual([...RAMP_NAMES], ['emerald', 'cobalt', 'amber', 'violet', 'rose', 'teal']);
  assert.deepEqual(Object.keys(COLOR_RAMPS), Object.keys(expected));
  for (const [name, [light, dark]] of Object.entries(expected)) {
    assert.deepEqual(COLOR_RAMPS[name].light, light, `${name} light`);
    assert.deepEqual(COLOR_RAMPS[name].dark, dark, `${name} dark`);
  }
  assert.deepEqual(
    Object.values(COLOR_RAMPS).map((r) => r.label),
    ['Emerald', 'Cobalt', 'Star Amber', 'Violet', 'Crimson', 'Teal']
  );
});

test('NEUTRAL_LEGEND_RAMP matches SPEC S5', () => {
  assert.deepEqual(NEUTRAL_LEGEND_RAMP.light, ['#eff2f5', '#c8d1da', '#9aa6b2', '#68737f', '#3b434b']);
  assert.deepEqual(NEUTRAL_LEGEND_RAMP.dark, ['#161b22', '#30363d', '#545d68', '#8b949e', '#c9d1d9']);
});

test('level 0 of every ramp equals the theme empty color', () => {
  for (const ramp of Object.values(COLOR_RAMPS)) {
    assert.equal(ramp.light[0], GITHUB_THEME.light.empty);
    assert.equal(ramp.dark[0], GITHUB_THEME.dark.empty);
  }
});

test('palette tables are deeply frozen', () => {
  const trees = [GITHUB_THEME, COLOR_RAMPS, NEUTRAL_LEGEND_RAMP, RAMP_NAMES];
  const walk = (v) => {
    if (v !== null && typeof v === 'object') {
      assert.equal(Object.isFrozen(v), true);
      Object.values(v).forEach(walk);
    }
  };
  trees.forEach(walk);
  assert.throws(() => {
    'use strict';
    COLOR_RAMPS.emerald.light[1] = '#000000';
  }, TypeError);
  assert.throws(() => {
    'use strict';
    GITHUB_THEME.dark.bg = '#000000';
  }, TypeError);
});

test('getTheme/getRamp resolve known names and reject everything else', () => {
  assert.equal(getTheme('light'), GITHUB_THEME.light);
  assert.equal(getTheme('dark'), GITHUB_THEME.dark);
  for (const name of RAMP_NAMES) assert.equal(getRamp(name), COLOR_RAMPS[name]);

  // Prototype keys / unvalidated input must never resolve via bracket lookup.
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Emerald', '', 'sepia', undefined, null, 1, {}]) {
    assert.throws(() => getTheme(bad), RangeError, `getTheme(${String(bad)})`);
    assert.throws(() => getRamp(bad), RangeError, `getRamp(${String(bad)})`);
  }
});

test('palettes contain only GitHub specimen colors (no observatory shell tokens)', () => {
  const shell = ['#0a1021', '#111b33', '#1b2a44', '#090e1c', '#b9381d', '#e8a878', '#f2f2e9'];
  const all = JSON.stringify([GITHUB_THEME, COLOR_RAMPS, NEUTRAL_LEGEND_RAMP]).toLowerCase();
  for (const token of shell) assert.equal(all.includes(token), false, token);
});
