import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdownSnippet } from '../../src/renderer/markdown.mjs';

const AGENTS = [
  { slug: 'mephistos-homunculus[bot]', label: 'Homunculus' },
  { slug: 'mephistos-euphorion[bot]', label: 'Euphorion' }
];

const RAW = 'https://raw.githubusercontent.com/mephistopheles4/mephistopheles4/generated/agent-activity';

test('empty agents returns "" for unified and separate (even without an owner)', () => {
  assert.equal(renderMarkdownSnippet({ owner: 'mephistopheles4', agents: [] }), '');
  assert.equal(renderMarkdownSnippet({ owner: 'mephistopheles4', layout: 'separate', agents: [] }), '');
  assert.equal(renderMarkdownSnippet({}), '');
  assert.equal(renderMarkdownSnippet(), '');
});

test('unified user snippet is a single <picture> with raw URLs', () => {
  const md = renderMarkdownSnippet({ owner: 'mephistopheles4', agents: AGENTS });
  assert.equal(
    md,
    [
      '<picture>',
      `  <source media="(prefers-color-scheme: dark)" srcset="${RAW}/unified-52w-dark.svg">`,
      `  <source media="(prefers-color-scheme: light)" srcset="${RAW}/unified-52w-light.svg">`,
      `  <img alt="Agent activity for Homunculus, Euphorion over the last 52 weeks" src="${RAW}/unified-52w-light.svg">`,
      '</picture>',
      ''
    ].join('\n')
  );
});

test('separate layout emits one <picture> per agent with slug-derived filenames', () => {
  const md = renderMarkdownSnippet({ owner: 'mephistopheles4', layout: 'separate', windowWeeks: 26, agents: AGENTS });
  assert.equal(md.match(/<picture>/g).length, 2);
  assert.ok(md.includes(`${RAW}/mephistos-homunculus-26w-dark.svg`));
  assert.ok(md.includes(`${RAW}/mephistos-euphorion-26w-light.svg`));
  assert.ok(md.includes('alt="Homunculus activity over the last 26 weeks"'));
  assert.equal(md.includes('unified'), false);
});

test('org scope resolves <owner>/.github; user scope resolves <owner>/<owner>', () => {
  const org = renderMarkdownSnippet({ owner: 'acme', scopeType: 'org', agents: AGENTS });
  assert.ok(org.includes('https://raw.githubusercontent.com/acme/.github/generated/agent-activity/unified-52w-dark.svg'));
  const user = renderMarkdownSnippet({ owner: 'acme', scopeType: 'user', agents: AGENTS });
  assert.ok(user.includes('https://raw.githubusercontent.com/acme/acme/generated/agent-activity/unified-52w-dark.svg'));
});

test('custom branch, nested subpath and root subpath', () => {
  const nested = renderMarkdownSnippet({ owner: 'acme', branch: 'art/gen', subpath: 'a/b', agents: AGENTS });
  assert.ok(nested.includes('https://raw.githubusercontent.com/acme/acme/art/gen/a/b/unified-52w-dark.svg'));
  const root = renderMarkdownSnippet({ owner: 'acme', subpath: '', agents: AGENTS });
  assert.ok(root.includes('https://raw.githubusercontent.com/acme/acme/generated/unified-52w-dark.svg'));
});

test('relative markdownBase', () => {
  const rel = renderMarkdownSnippet({ owner: 'acme', markdownBase: 'relative', agents: AGENTS });
  assert.ok(rel.includes('srcset="./agent-activity/unified-52w-dark.svg"'));
  assert.ok(rel.includes('src="./agent-activity/unified-52w-light.svg"'));
  assert.equal(rel.includes('raw.githubusercontent.com'), false);
  const relRoot = renderMarkdownSnippet({ markdownBase: 'relative', subpath: '', agents: AGENTS });
  assert.ok(relRoot.includes('srcset="./unified-52w-dark.svg"'));
});

test('raw labelMode uses slugs in alt text', () => {
  const md = renderMarkdownSnippet({ owner: 'acme', labelMode: 'raw', agents: AGENTS });
  assert.ok(md.includes('alt="Agent activity for mephistos-homunculus[bot], mephistos-euphorion[bot] over'));
});

test('alt text escapes quotes, apostrophes, markup and strips control chars; emoji preserved', () => {
  const md = renderMarkdownSnippet({
    owner: 'acme',
    agents: [{ slug: 'a-bot[bot]', label: `Ex"ample's <b>Bot</b> & 🚀\u202E\u0000\uD83D` }]
  });
  assert.ok(md.includes('alt="Agent activity for Ex&quot;ample&apos;s &lt;b&gt;Bot&lt;/b&gt; &amp; 🚀 over the last 52 weeks"'));
  assert.equal(/[\u202E\u0000]/.test(md), false);
  assert.equal(md.isWellFormed(), true);
  assert.equal(md.includes('&#'), false);
  // Every attribute stays on its own quoted boundary.
  for (const attr of md.matchAll(/(alt|src|srcset|media)="([^"]*)"/g)) {
    assert.equal(/[<>"]/.test(attr[2]), false, attr[0]);
  }
});

test('empty/whitespace labels fall back to the slug', () => {
  const md = renderMarkdownSnippet({ owner: 'acme', agents: [{ slug: 'a-bot[bot]', label: '  \u200E ' }] });
  assert.ok(md.includes('alt="Agent activity for a-bot[bot] over'));
});

const BASE = { owner: 'acme', agents: AGENTS };

test('owner validation rejects breakouts', () => {
  for (const owner of ['a"b', "a'b", 'a b', 'a/b', '../x', 'a<b', '-a', 'a-', 'a'.repeat(40), '', undefined, null, 'a\nb', 'a%22']) {
    assert.throws(() => renderMarkdownSnippet({ ...BASE, owner }), TypeError, JSON.stringify(owner));
  }
  // relative base does not need an owner
  assert.doesNotThrow(() => renderMarkdownSnippet({ ...BASE, owner: undefined, markdownBase: 'relative' }));
  assert.throws(() => renderMarkdownSnippet({ ...BASE, owner: 'a"b', markdownBase: 'relative' }), TypeError);
});

test('branch validation rejects dot-segments, prefixes, protected names and breakouts', () => {
  for (const branch of [
    'main', 'master', 'HEAD', 'refs/heads/x', 'heads/x', 'tags/x', 'remotes/x', 'a..b', 'a//b', '.x', 'a/.x', 'a.', 'a/', 'x.lock',
    'a"onerror="x', 'a" srcset="x', "a' onerror='x", 'a>b', 'a<b', 'a b', 'a\nb', '', '../../etc'
  ]) {
    assert.throws(() => renderMarkdownSnippet({ ...BASE, branch }), TypeError, JSON.stringify(branch));
  }
});

test('subpath validation rejects dot-segments, traversal and attribute/Markdown breakouts', () => {
  for (const subpath of [
    '..', '../x', 'a/../b', 'a//b', '/abs', 'a/', 'a/.git', 'a/.', '.git', 'a:b', 'a"b', "a'b", 'a<b', 'a>b', 'a b', 'a\tb',
    'a"><img src=x onerror=alert(1)>', 'a)](javascript:alert(1))', 'a`b', 'a\\b', 'a?x=1', 'a#frag', 'a%2e%2e', 'x'.repeat(65)
  ]) {
    assert.throws(() => renderMarkdownSnippet({ ...BASE, subpath }), TypeError, JSON.stringify(subpath));
    assert.throws(() => renderMarkdownSnippet({ ...BASE, subpath, markdownBase: 'relative' }), TypeError, JSON.stringify(subpath));
  }
});

test('markdownBase, scopeType, layout, windowWeeks and agent slugs are validated', () => {
  for (const markdownBase of ['absolute', 'RAW', '', null, 1]) {
    assert.throws(() => renderMarkdownSnippet({ ...BASE, markdownBase }), TypeError, String(markdownBase));
  }
  for (const scopeType of ['team', 'USER', '', null]) {
    assert.throws(() => renderMarkdownSnippet({ ...BASE, scopeType }), TypeError, String(scopeType));
  }
  assert.throws(() => renderMarkdownSnippet({ ...BASE, layout: 'grid' }), TypeError);
  assert.throws(() => renderMarkdownSnippet({ ...BASE, windowWeeks: 13 }), TypeError);
  assert.throws(() => renderMarkdownSnippet({ ...BASE, windowWeeks: '52' }), TypeError);
  assert.throws(() => renderMarkdownSnippet({ ...BASE, agents: 'x' }), TypeError);
  assert.throws(() => renderMarkdownSnippet({ ...BASE, agents: [null] }), TypeError);
  for (const slug of ['x"><script>[bot]', 'plain', 'a b[bot]', '../x[bot]', '', undefined, 'a[bot]\n']) {
    assert.throws(() => renderMarkdownSnippet({ ...BASE, agents: [{ slug, label: 'x' }] }), TypeError, JSON.stringify(slug));
  }
});

test('fuzzed inputs either throw or yield a snippet whose attributes cannot break out', () => {
  const alphabet = ['a', 'b', '1', '-', '.', '/', '"', "'", '<', '>', '&', ' ', '\n', '\u202E', '`', ')', ']', '(', '[', '%', ':', '\\', '#', '?'];
  let state = 99;
  const rand = (n) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % n;
  };
  const gen = () => Array.from({ length: 1 + rand(14) }, () => alphabet[rand(alphabet.length)]).join('');
  let accepted = 0;
  for (let i = 0; i < 3000; i++) {
    const args = { owner: gen(), branch: gen(), subpath: gen(), markdownBase: i % 2 ? 'raw' : 'relative', agents: [{ slug: 'x-bot[bot]', label: gen() }] };
    let md;
    try {
      md = renderMarkdownSnippet(args);
    } catch (err) {
      assert.ok(err instanceof TypeError);
      continue;
    }
    accepted++;
    for (const attr of md.matchAll(/(alt|src|srcset|media)="([^"]*)"/g)) {
      assert.equal(/[<>"\n`]/.test(attr[2]), false, attr[0]);
    }
    assert.equal(md.split('\n').filter((l) => l.startsWith('<') || l.startsWith('  <')).length, md.trimEnd().split('\n').length);
    assert.equal(/\.\.|\/\//.test(md.replaceAll('https://', '')), false, md);
  }
  assert.ok(accepted >= 0);
});
