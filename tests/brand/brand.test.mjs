import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildBrand, BRAND_DIR } from '../../scripts/brand.mjs';

const built = buildBrand();

test('brand: committed docs/brand SVGs match scripts/brand.mjs', () => {
  for (const [rel, svg] of Object.entries(built)) {
    const onDisk = readFileSync(path.join(BRAND_DIR, rel), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(onDisk, svg, `docs/brand/${rel} is stale: run node scripts/brand.mjs`);
  }
});

test('brand: README art runs nothing and fetches nothing', () => {
  for (const [rel, svg] of Object.entries(built)) {
    assert.doesNotMatch(svg, /<script|\son[a-z]+=|<foreignObject|<image|href=/i, `docs/brand/${rel} carries active content`);
    const urls = svg.match(/https?:\/\/[^\s"')]+/g) ?? [];
    assert.deepEqual([...new Set(urls)], ['http://www.w3.org/2000/svg'], `docs/brand/${rel} references an external URL`);
  }
});
