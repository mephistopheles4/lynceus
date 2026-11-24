// `<picture>` README snippet builder (SPEC S5). Pure browser + Node ESM: no node:* imports.

import {
  agentFileStem,
  escapeXml,
  stripControlChars,
  svgFilename,
  validateBranch,
  validateMarkdownBase,
  validateOwner,
  validateScopeType,
  validateSubpath
} from './sanitize.mjs';

const esc = (v) => escapeXml(stripControlChars(v));

/**
 * Resolve the profile repository slug: `<owner>/.github` for orgs, `<owner>/<owner>` for users.
 * @param {string} owner
 * @param {'user'|'org'} scopeType
 */
export function profileRepoSlug(owner, scopeType) {
  return scopeType === 'org' ? `${owner}/.github` : `${owner}/${owner}`;
}

/**
 * Build the Markdown (raw HTML `<picture>`) snippet embedding the rendered SVGs.
 * Returns `""` when `agents` is empty (0-agent preview).
 * @param {object} args
 * @returns {string}
 */
export function renderMarkdownSnippet({
  owner,
  scopeType = 'user',
  branch = 'generated',
  subpath = 'agent-activity',
  markdownBase = 'raw',
  layout = 'unified',
  windowWeeks = 52,
  agents = [],
  labelMode = 'friendly'
} = {}) {
  if (!Array.isArray(agents)) throw new TypeError('agents must be an array');
  if (agents.length === 0) return '';

  validateScopeType(scopeType);
  validateBranch(branch);
  validateSubpath(subpath);
  validateMarkdownBase(markdownBase);
  if (layout !== 'unified' && layout !== 'separate') throw new TypeError('Invalid layout');
  if (windowWeeks !== 26 && windowWeeks !== 52) throw new TypeError('Invalid windowWeeks');
  if (labelMode !== 'friendly' && labelMode !== 'raw') throw new TypeError('Invalid labelMode');
  if (markdownBase === 'raw' || owner !== undefined) validateOwner(owner);

  const entries = agents.map((agent) => {
    if (agent === null || typeof agent !== 'object') throw new TypeError('Invalid agent entry');
    const stem = agentFileStem(agent.slug);
    const slug = stripControlChars(agent.slug);
    const label = typeof agent.label === 'string' ? stripControlChars(agent.label).trim() : '';
    return { stem, name: labelMode === 'raw' ? slug : label || slug };
  });

  const base =
    markdownBase === 'raw'
      ? `https://raw.githubusercontent.com/${profileRepoSlug(owner, scopeType)}/${branch}${subpath ? `/${subpath}` : ''}/`
      : `./${subpath ? `${subpath}/` : ''}`;

  const picture = (stem, alt) => {
    const dark = esc(`${base}${svgFilename(stem, windowWeeks, 'dark')}`);
    const light = esc(`${base}${svgFilename(stem, windowWeeks, 'light')}`);
    return [
      '<picture>',
      `  <source media="(prefers-color-scheme: dark)" srcset="${dark}">`,
      `  <source media="(prefers-color-scheme: light)" srcset="${light}">`,
      `  <img alt="${esc(alt)}" src="${light}">`,
      '</picture>'
    ].join('\n');
  };

  if (layout === 'unified') {
    const alt = `Agent activity for ${entries.map((e) => e.name).join(', ')} over the last ${windowWeeks} weeks`;
    return `${picture('unified', alt)}\n`;
  }
  const blocks = entries.map((e) => picture(e.stem, `${e.name} activity over the last ${windowWeeks} weeks`));
  return `${blocks.join('\n\n')}\n`;
}
