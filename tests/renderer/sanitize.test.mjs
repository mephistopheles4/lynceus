import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CamoSafetyError,
  assertCamoSafeSvg,
  escapeXml,
  stripControlChars,
  validateBranch,
  validateSubpath
} from '../../src/renderer/sanitize.mjs';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const wrap = (inner, rootExtra = '') => `<svg ${NS} width="10" height="10"${rootExtra}>${inner}</svg>`;

// ---------------------------------------------------------------- stripControlChars

test('stripControlChars removes C0/C1 controls and directional marks', () => {
  const noisy =
    'a\u0000b\u0007c\td\ne\u001Ff\u007Fg\u0080h\u009Fi\u200Ej\u200Fk\u061Cl\u202Am\u202Bn\u202Co\u202Dp\u202Eq\u2066r\u2067s\u2068t\u2069u';
  assert.equal(stripControlChars(noisy), 'abcdefghijklmnopqrstu');
});

test('stripControlChars removes unpaired surrogates but preserves valid non-BMP emoji', () => {
  assert.equal(stripControlChars('Bot \uD83D'), 'Bot ');
  assert.equal(stripControlChars('\uDE80 Bot'), ' Bot');
  assert.equal(stripControlChars('a\uD83Db'), 'ab');
  assert.equal(stripControlChars('\uD83D\uD83D\uDE80'), '\uD83D\uDE80');
  assert.equal(stripControlChars('Example\'s Bot 🚀'), "Example's Bot 🚀");
  assert.equal(stripControlChars('🚀🚀').isWellFormed(), true);
  assert.equal(stripControlChars('\uD83D\u0000\uDE80'), '');
  // A literal U+FFFD in the input is a real character and survives.
  assert.equal(stripControlChars('a\uFFFDb'), 'a\uFFFDb');
});

test('stripControlChars coerces non-strings safely', () => {
  assert.equal(stripControlChars(undefined), '');
  assert.equal(stripControlChars(null), '');
  assert.equal(stripControlChars(42), '42');
});

// ---------------------------------------------------------------- escapeXml

test('escapeXml maps only the five named entities (never numeric)', () => {
  assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
  assert.equal(escapeXml("Example's Bot 🚀"), 'Example&apos;s Bot 🚀');
  assert.equal(escapeXml('plain text 1=2'), 'plain text 1=2');
  assert.equal(escapeXml("it's").includes('&#'), false);
  assert.equal(escapeXml('&amp;'), '&amp;amp;');
  assert.equal(escapeXml(undefined), '');
});

// ---------------------------------------------------------------- assertCamoSafeSvg accepts

test('assertCamoSafeSvg accepts a minimal valid SVG, emoji + apostrophe labels and harmless "button=1"', () => {
  assert.doesNotThrow(() => assertCamoSafeSvg(wrap('<rect x="1" y="2" width="3" height="4" rx="2" fill="#fff"/>')));
  assert.doesNotThrow(() => assertCamoSafeSvg(`${wrap(`<text>${escapeXml("Example's Bot 🚀")}</text>`)}\n`));
  assert.doesNotThrow(() => assertCamoSafeSvg(wrap('<text>button=1 onclick=no style=x</text>')));
  assert.doesNotThrow(() => assertCamoSafeSvg(wrap('<text aria-label="button=1">x</text>')));
  assert.doesNotThrow(() => assertCamoSafeSvg(wrap('<g fill="#fff"><circle cx="1.5" cy="1.5" r="1.3"/></g><title>t</title>')));
  assert.equal(assertCamoSafeSvg(wrap('')), wrap(''));
});

// ---------------------------------------------------------------- assertCamoSafeSvg rejects

const REJECTED = {
  'empty string': '',
  'not a string': 42,
  'unpaired surrogate': wrap('<text>\uD83D</text>'),
  'no root xmlns': '<svg width="1"></svg>',
  'wrong xmlns value': '<svg xmlns="http://www.w3.org/1999/xhtml"></svg>',
  'single-quoted xmlns': `<svg xmlns='http://www.w3.org/2000/svg'></svg>`,
  'duplicate root xmlns': `<svg ${NS} ${NS}></svg>`,
  'xmlns outside root only': `<svg width="1"><g ${NS}/></svg>`,
  'missing closing tag': `<svg ${NS}><g/>`,
  'leading content': ` <svg ${NS}></svg>`,
  'xml declaration': `<?xml version="1.0"?><svg ${NS}></svg>`,
  'two roots': `<svg ${NS}></svg><svg ${NS}></svg>`,
  'nested svg': wrap('<svg></svg>'),
  'secondary xmlns:': wrap('<g xmlns:s="http://www.w3.org/2000/svg"/>'),
  'xmlns: on root': `<svg ${NS} xmlns:xlink="x"></svg>`,
  'prefixed script': wrap('<s:script>alert(1)</s:script>'),
  '<script>': wrap('<script>alert(1)</script>'),
  '<SCRIPT>': wrap('<SCRIPT>alert(1)</SCRIPT>'),
  DOCTYPE: `<!DOCTYPE svg><svg ${NS}></svg>`,
  'inner DOCTYPE': wrap('<!DOCTYPE x>'),
  ENTITY: wrap('<!ENTITY x "y">'),
  '<foreignObject>': wrap('<foreignObject><div/></foreignObject>'),
  '<style>': wrap('<style>rect{fill:red}</style>'),
  '<use>': wrap('<use x="1"/>'),
  '<image>': wrap('<image width="1"/>'),
  '<animate>': wrap('<animate attributeName="x"/>'),
  '<animateTransform>': wrap('<animateTransform attributeName="transform"/>'),
  '<animateMotion>': wrap('<animateMotion/>'),
  '<set>': wrap('<set attributeName="x"/>'),
  '<discard>': wrap('<discard/>'),
  '<feImage>': wrap('<filter><feImage/></filter>'),
  '<iframe>': wrap('<iframe/>'),
  '<embed>': wrap('<embed/>'),
  '<object>': wrap('<object/>'),
  '<a>': wrap('<a><text>x</text></a>'),
  'href=': wrap('<rect href="#x"/>'),
  'xlink:href=': wrap('<rect xlink:href="#x"/>'),
  'href with spaces': wrap('<rect HREF = "#x"/>'),
  'javascript: in text': wrap('<text>javascript:alert(1)</text>'),
  'vbscript:': wrap('<text>VBScript:x</text>'),
  'data: URL': wrap('<text>data:text/html,x</text>'),
  '@import': wrap('<text>@import</text>'),
  'url(': wrap('<rect fill="url(#x)"/>'),
  'numeric entity decimal': wrap('<text>&#60;script&#62;</text>'),
  'numeric entity hex': wrap('<text>&#x3c;</text>'),
  'semicolon-less &#60': wrap('<text>&#60script</text>'),
  'semicolon-less &#x3C': wrap('<text>&#x3Cscript</text>'),
  'undeclared named entity': wrap('<text>&nbsp;</text>'),
  'bare ampersand': wrap('<text>a & b</text>'),
  'external https URL': wrap('<text>https://evil.example/x.png</text>'),
  'external http URL': wrap('<text>http://evil.example</text>'),
  'uppercase HTTPS URL': wrap('<text>HTTPS://evil.example</text>'),
  'second svg namespace URL in text': wrap('<text>http://www.w3.org/2000/svg</text>'),
  'onload handler': wrap('<rect onload="alert(1)"/>'),
  'onclick with spaces': wrap('<rect onclick = "alert(1)"/>'),
  'ONMOUSEOVER': wrap('<rect ONMOUSEOVER="x"/>'),
  'onload on root': `<svg ${NS} onload="alert(1)"></svg>`,
  'style attribute': wrap('<rect style="fill:red"/>'),
  'escaped url in style': wrap('<rect style="fill:\\75rl(#x)"/>'),
  'STYLE attribute uppercase': wrap('<rect STYLE="x"/>'),
  '> inside double quotes then handler': wrap('<rect id=">" onload="alert(1)"/>'),
  '> inside single quotes then handler': wrap(`<rect id='>' onload='alert(1)'/>`),
  '> inside quotes then style': wrap('<rect id=">" style="x"/>'),
  '> inside quotes then href': wrap('<rect id=">" href="#x"/>'),
  'unquoted attribute value': wrap('<rect id=a onload=b/>'),
  'valueless attribute': wrap('<rect disabled onload/>'),
  'attribute glued after quote': wrap('<rect id="a"onload="b"/>'),
  '< inside attribute value': wrap('<rect id="<x"/>'),
  'unterminated tag': `<svg ${NS}><rect id="x`,
  'comment': wrap('<!-- hi -->'),
  'comment hiding handler': wrap('<!-- > --><rect onload="x"/>'),
  'CDATA': wrap('<![CDATA[x]]>'),
  'processing instruction': wrap('<?php x ?>'),
  'prefixed element': wrap('<s:rect/>'),
  'prefixed attribute': wrap('<rect s:fill="x"/>'),
  'NUL byte': wrap('<text>a\u0000b</text>'),
  'BiDi override': wrap('<text>a\u202Eb</text>'),
  'BiDi isolate': wrap('<text>a\u2066b</text>'),
  'malformed closing tag': wrap('<text>x</text onload="y">')
};

for (const [name, svg] of Object.entries(REJECTED)) {
  test(`assertCamoSafeSvg rejects: ${name}`, () => {
    assert.throws(() => assertCamoSafeSvg(svg), CamoSafetyError);
  });
}

// ---------------------------------------------------------------- option validators

test('validateBranch enforces S3 rules', () => {
  for (const ok of ['generated', 'gen/erated', 'a.b-c_d', 'v1.0', 'x']) assert.equal(validateBranch(ok), ok);
  const bad = [
    '', 'main', 'MASTER', 'Head', 'HEAD', 'refs/heads/x', 'Refs/x', 'heads/x', 'tags/x', 'remotes/x',
    'a..b', 'a//b', '.hidden', 'a/.b', 'a.', 'a/', 'a.lock', 'a/b.lock', '/a', '-a', 'a b', 'a"b', 'a<b', 'a>b',
    'a:b', "a'b", 'x'.repeat(65), 'a\nb', 'a%2eb', undefined, null, 1
  ];
  for (const b of bad) assert.throws(() => validateBranch(b), TypeError, JSON.stringify(b));
});

test('validateSubpath enforces S3 rules', () => {
  for (const ok of ['', 'agent-activity', 'a/b', 'a.b/c_d', 'x']) assert.equal(validateSubpath(ok), ok);
  const bad = [
    '..', 'a/..', '../a', 'a//b', '/a', 'a/', 'a/.git', 'a/.', '.git', 'a:b', 'a"b', "a'b", 'a<b', 'a>b', 'a b',
    'a\tb', 'a\\b', 'a?b', 'a#b', 'a%2e', 'x'.repeat(65), undefined, null, 5
  ];
  for (const s of bad) assert.throws(() => validateSubpath(s), TypeError, JSON.stringify(s));
});
