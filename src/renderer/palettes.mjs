// Isolated GitHub Light/Dark specimen palettes and the six per-agent color ramps (SPEC S5).
// Pure browser + Node ESM: no node:* imports. Shell/observatory tokens must never appear here.

/**
 * Recursively freeze a plain object/array tree.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

export const GITHUB_THEME = deepFreeze({
  light: {
    bg: '#ffffff',
    border: '#d1d9e0',
    divider: '#eaeef2',
    ink: '#1f2328',
    muted: '#59636e',
    badgeBg: '#f6f8fa',
    badgeText: '#59636e',
    empty: '#eff2f5'
  },
  dark: {
    bg: '#0d1117',
    border: '#30363d',
    divider: '#21262d',
    ink: '#e6edf3',
    muted: '#8d96a0',
    badgeBg: '#161b22',
    badgeText: '#8d96a0',
    empty: '#161b22'
  }
});

/** Each ramp is `[level0, level1, level2, level3, level4]` per theme. */
export const COLOR_RAMPS = deepFreeze({
  emerald: {
    label: 'Emerald',
    light: ['#eff2f5', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    dark: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
  },
  cobalt: {
    label: 'Cobalt',
    light: ['#eff2f5', '#b6e3ff', '#54aeff', '#0969da', '#0550ae'],
    dark: ['#161b22', '#0c2d6b', '#1158c7', '#388bfd', '#79c0ff']
  },
  amber: {
    label: 'Star Amber',
    light: ['#eff2f5', '#ffd8b5', '#fb8f44', '#d44d2e', '#9a2f15'],
    dark: ['#161b22', '#4a2010', '#8f3918', '#d44d2e', '#ff8b66']
  },
  violet: {
    label: 'Violet',
    light: ['#eff2f5', '#e2c5ff', '#a371f7', '#8250df', '#5a32a3'],
    dark: ['#161b22', '#271052', '#553098', '#8957e5', '#c297ff']
  },
  rose: {
    label: 'Crimson',
    light: ['#eff2f5', '#ffcecb', '#ff8182', '#cf222e', '#82071e'],
    dark: ['#161b22', '#4c1118', '#8e1519', '#da3633', '#ff7b72']
  },
  teal: {
    label: 'Teal',
    light: ['#eff2f5', '#a5f3fc', '#22d3ee', '#0e7490', '#164e63'],
    dark: ['#161b22', '#0c3b45', '#155e75', '#0891b2', '#67e8f9']
  }
});

/** Neutral 5-step ramp for the multi-agent unified card legend. */
export const NEUTRAL_LEGEND_RAMP = deepFreeze({
  light: ['#eff2f5', '#c8d1da', '#9aa6b2', '#68737f', '#3b434b'],
  dark: ['#161b22', '#30363d', '#545d68', '#8b949e', '#c9d1d9']
});

export const RAMP_NAMES = Object.freeze(Object.keys(COLOR_RAMPS));

/**
 * @param {string} themeName `'light'` or `'dark'`
 * @returns {{bg:string,border:string,divider:string,ink:string,muted:string,badgeBg:string,badgeText:string,empty:string}}
 */
export function getTheme(themeName) {
  if (typeof themeName !== 'string' || !Object.hasOwn(GITHUB_THEME, themeName)) {
    throw new RangeError('Unknown theme: expected "light" or "dark"');
  }
  return GITHUB_THEME[themeName];
}

/**
 * @param {string} rampName one of {@link RAMP_NAMES}
 * @returns {{label:string,light:readonly string[],dark:readonly string[]}}
 */
export function getRamp(rampName) {
  if (typeof rampName !== 'string' || !Object.hasOwn(COLOR_RAMPS, rampName)) {
    throw new RangeError(`Unknown color ramp: expected one of ${RAMP_NAMES.join(', ')}`);
  }
  return COLOR_RAMPS[rampName];
}
