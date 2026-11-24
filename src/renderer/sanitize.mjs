// XML/Markdown sanitizers, option validators and the camo-safety gate (SPEC S3/S5).
// Pure browser + Node ESM: no node:* imports.

const SVG_NS_URL = 'http://www.w3.org/2000/svg';
const ROOT_XMLNS = `xmlns="${SVG_NS_URL}"`;

/** C0, C1, directional marks/overrides/isolates. */
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

/** Characters that must never appear in an emitted SVG (invalid XML chars + BiDi controls). */
const FORBIDDEN_SVG_CHARS_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;

/**
 * Drop unpaired UTF-16 surrogates (manual loop: works in engines without
 * `String.prototype.isWellFormed` and without regex lookbehind). Valid pairs are kept.
 * @param {string} s
 */
function dropLoneSurrogates(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
    } else if (c < 0xdc00 || c > 0xdfff) {
      out += s[i];
    }
  }
  return out;
}

function isWellFormedString(s) {
  return typeof s.isWellFormed === 'function' ? s.isWellFormed() : dropLoneSurrogates(s) === s;
}

/**
 * Remove C0/C1 controls, directional marks/overrides/isolates and unpaired surrogates.
 * Valid non-BMP characters (emoji) are preserved.
 * @param {unknown} s
 * @returns {string}
 */
export function stripControlChars(s) {
  const str = typeof s === 'string' ? s : String(s ?? '');
  const wellFormed = isWellFormedString(str) ? str : dropLoneSurrogates(str);
  return wellFormed.replace(STRIP_RE, '');
}

const XML_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
});

/**
 * Escape exactly the five predefined XML entities (never numeric references).
 * @param {unknown} s
 * @returns {string}
 */
export function escapeXml(s) {
  const str = typeof s === 'string' ? s : String(s ?? '');
  return str.replace(/[&<>"']/g, (ch) => XML_ENTITIES[ch]);
}

export class CamoSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CamoSafetyError';
  }
}

function reject(reason) {
  throw new CamoSafetyError(`Unsafe SVG: ${reason}`);
}

/** Quote-aware end-of-tag search. Returns index of the closing `>`. */
function findTagEnd(svg, start) {
  let quote = null;
  for (let j = start + 1; j < svg.length; j++) {
    const c = svg[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j;
    }
  }
  return -1;
}

const WS_RE = /\s/;

/**
 * Strictly parse one start tag, validating every attribute.
 * Attribute values must be quoted (and contain no `<`); names are checked, never values.
 * @param {string} tag full `<name ... >` text
 */
function checkStartTag(tag) {
  const nameMatch = /^<([A-Za-z_][A-Za-z0-9_.-]*)/.exec(tag);
  if (!nameMatch) reject('malformed element name (prefixed or invalid element names are not allowed)');
  let end = tag.length - 1; // index of '>'
  if (tag[end - 1] === '/') end--;
  let p = nameMatch[0].length;
  if (p < end && !WS_RE.test(tag[p])) reject('malformed tag');
  for (;;) {
    while (p < end && WS_RE.test(tag[p])) p++;
    if (p >= end) break;
    let q = p;
    while (q < end && !WS_RE.test(tag[q]) && !'="\'<>/'.includes(tag[q])) q++;
    const attrName = tag.slice(p, q);
    if (!attrName) reject('malformed attribute name');
    p = q;
    while (p < end && WS_RE.test(tag[p])) p++;
    if (tag[p] !== '=') reject('attribute without a quoted value');
    p++;
    while (p < end && WS_RE.test(tag[p])) p++;
    const quote = tag[p];
    if (quote !== '"' && quote !== "'") reject('unquoted attribute value');
    const close = tag.indexOf(quote, p + 1);
    if (close === -1 || close > end) reject('unterminated attribute value');
    if (tag.slice(p + 1, close).includes('<')) reject('"<" inside attribute value');
    p = close + 1;
    if (p < end && !WS_RE.test(tag[p])) reject('attributes must be whitespace separated');
    const lower = attrName.toLowerCase();
    if (/^on/.test(lower)) reject(`event handler attribute "${attrName}"`);
    if (lower === 'style') reject('inline style attribute');
    if (lower.startsWith('xmlns')) reject('namespace declaration');
    if (/href$/.test(lower)) reject('href attribute');
    if (attrName.includes(':') && !lower.startsWith('xml:')) reject(`prefixed attribute "${attrName}"`);
  }
}

/**
 * Assert an SVG string is safe to be served through GitHub's camo image proxy: no active
 * content, no external references, no secondary namespaces, no event handlers.
 * Throws {@link CamoSafetyError}; returns the input on success.
 * @param {string} svg
 * @returns {string}
 */
export function assertCamoSafeSvg(svg) {
  if (typeof svg !== 'string' || svg.length === 0) reject('empty or non-string document');
  if (!isWellFormedString(svg)) reject('unpaired UTF-16 surrogate');
  if (FORBIDDEN_SVG_CHARS_RE.test(svg)) reject('control or directional character');
  if (!svg.startsWith('<svg') || !/<\/svg>\s*$/.test(svg)) reject('document must be a single <svg> root');
  if ((svg.match(/<svg\b/gi) || []).length !== 1 || (svg.match(/<\/svg\s*>/gi) || []).length !== 1) {
    reject('exactly one <svg> root element is required');
  }

  const rootEnd = findTagEnd(svg, 0);
  if (rootEnd === -1) reject('unterminated <svg> tag');
  const rootTag = svg.slice(0, rootEnd + 1);
  const xmlnsAt = rootTag.indexOf(` ${ROOT_XMLNS}`);
  if (xmlnsAt === -1 || rootTag.indexOf(` ${ROOT_XMLNS}`, xmlnsAt + 1) !== -1) {
    reject(`root <svg> must declare exactly one ${ROOT_XMLNS}`);
  }

  if (/\bxmlns:/i.test(svg)) reject('secondary namespace declaration');
  if (/<!DOCTYPE\b/i.test(svg)) reject('DOCTYPE');
  if (/<!ENTITY\b/i.test(svg)) reject('ENTITY');
  if (
    /<(?:[a-z0-9_-]+:)?(?:script|foreignObject|style|use|image|animate[a-z]*|set|discard|feImage|iframe|embed|object|a)\b/i.test(
      svg
    )
  ) {
    reject('active or external-reference element');
  }
  if (/\b(?:xlink:)?href\s*=/i.test(svg)) reject('href');
  if (/javascript:/i.test(svg)) reject('javascript: URL');
  if (/vbscript:/i.test(svg)) reject('vbscript: URL');
  if (/data:/i.test(svg)) reject('data: URL');
  if (/@import\b/i.test(svg)) reject('@import');
  if (/url\(/i.test(svg)) reject('url()');
  if (/&#(?:x[0-9a-f]+|\d+)/i.test(svg)) reject('numeric character reference');
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(svg)) reject('undeclared or malformed entity reference');

  // Strip ONLY the verified root xmlns declaration; nothing else may mention a URL.
  const stripped = rootTag.replace(` ${ROOT_XMLNS}`, '') + svg.slice(rootEnd + 1);
  if (/https?:\/\//i.test(stripped)) reject('external URL');

  // Quote-aware walk over every tag.
  let i = 0;
  while ((i = stripped.indexOf('<', i)) !== -1) {
    const j = findTagEnd(stripped, i);
    if (j === -1) reject('unterminated tag');
    const tag = stripped.slice(i, j + 1);
    if (tag.startsWith('<!') || tag.startsWith('<?')) reject('comment, CDATA, or processing instruction');
    if (tag.startsWith('</')) {
      if (!/^<\/[A-Za-z_][A-Za-z0-9_.-]*\s*>$/.test(tag)) reject('malformed closing tag');
    } else {
      checkStartTag(tag);
    }
    i = j + 1;
  }
  return svg;
}

// ---------------------------------------------------------------------------------------
// Shared option validators (used by svg.mjs and markdown.mjs)
// ---------------------------------------------------------------------------------------

export const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
export const BOT_SLUG_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\[bot\]$/;
const PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/;

export function validateOwner(owner) {
  if (typeof owner !== 'string' || !OWNER_RE.test(owner)) throw new TypeError('Invalid owner');
  return owner;
}

export function validateScopeType(scopeType) {
  if (scopeType !== 'user' && scopeType !== 'org') throw new TypeError('Invalid scopeType');
  return scopeType;
}

export function validateBranch(branch) {
  if (typeof branch !== 'string' || !PATH_RE.test(branch)) throw new TypeError('Invalid branch');
  const lower = branch.toLowerCase();
  if (lower === 'main' || lower === 'master' || lower === 'head') throw new TypeError('Invalid branch');
  if (/^(?:refs|heads|tags|remotes)\//.test(lower)) throw new TypeError('Invalid branch');
  if (branch.includes('..') || branch.includes('//')) throw new TypeError('Invalid branch');
  if (branch.endsWith('.') || branch.endsWith('/')) throw new TypeError('Invalid branch');
  for (const seg of branch.split('/')) {
    if (seg.startsWith('.') || seg.toLowerCase().endsWith('.lock')) throw new TypeError('Invalid branch');
  }
  return branch;
}

export function validateSubpath(subpath) {
  if (subpath === '') return subpath;
  if (typeof subpath !== 'string' || !PATH_RE.test(subpath)) throw new TypeError('Invalid subpath');
  if (subpath.includes('..') || subpath.includes('//') || subpath.endsWith('/')) {
    throw new TypeError('Invalid subpath');
  }
  for (const seg of subpath.split('/')) {
    if (seg.startsWith('.')) throw new TypeError('Invalid subpath');
  }
  return subpath;
}

export function validateMarkdownBase(markdownBase) {
  if (markdownBase !== 'raw' && markdownBase !== 'relative') throw new TypeError('Invalid markdownBase');
  return markdownBase;
}

/**
 * Filename stem for an agent: `slug.replace(/\[bot\]$/i, '').toLowerCase()`.
 * @param {string} slug a valid `<name>[bot]` slug
 */
export function agentFileStem(slug) {
  if (typeof slug !== 'string' || !BOT_SLUG_RE.test(slug)) throw new TypeError('Invalid bot slug');
  return slug.replace(/\[bot\]$/i, '').toLowerCase();
}

/**
 * @param {string} stem `unified` or an {@link agentFileStem}
 * @param {26|52} weeks
 * @param {'light'|'dark'} theme
 */
export function svgFilename(stem, weeks, theme) {
  return `${stem}-${weeks}w-${theme}.svg`;
}
