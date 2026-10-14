/* eslint-disable @typescript-eslint/no-require-imports */
/* Run: npm run test:links */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

const { RESERVED_SLUGS, normalizeSlug, slugProblem, normalizeUrl, isActive } = require('../src/lib/link-rules.ts');

test('every top-level page and public folder is reserved', () => {
  const root = path.join(__dirname, '..');
  const appDirs = fs.readdirSync(path.join(root, 'src/app'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !/^[[(]/.test(d.name)).map((d) => d.name);
  const publicNames = fs.readdirSync(path.join(root, 'public'));
  const appFiles = ['favicon.ico', 'manifest.webmanifest'];
  for (const name of [...appDirs, ...publicNames, ...appFiles]) assert.ok(RESERVED_SLUGS.includes(name), `${name} should be reserved`);
});

test('slugs are cleaned and checked', () => {
  assert.equal(normalizeSlug('  /Formal Tickets '), 'formal-tickets');
  assert.equal(slugProblem('formal', []), null);
  assert.match(slugProblem('dashboard', []), /already a page/);
  assert.match(slugProblem('formal', ['formal']), /Another link/);
  for (const bad of ['-x', 'x-', 'a_b', 'a.b', '', 'x'.repeat(61)]) assert.ok(slugProblem(bad, []), bad);
});

test('addresses get https and must be web addresses', () => {
  assert.equal(normalizeUrl('example.com/a'), 'https://example.com/a');
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com/');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('localhost'), null);
  assert.equal(normalizeUrl('   '), null);
});

test('a link works through the end of its last day', () => {
  assert.equal(isActive({ expiresOn: null }, '2026-10-14'), true);
  assert.equal(isActive({ expiresOn: '2026-10-14' }, '2026-10-14'), true);
  assert.equal(isActive({ expiresOn: '2026-10-13' }, '2026-10-14'), false);
});

test('sheet rows import once, keeping order and dropping bad short links', () => {
  const { linksFromRows } = require('../src/lib/links.ts');
  const links = linksFromRows([
    ['Title', 'Shortlink', 'URL', 'Expiry'],
    ['Donate', 'Donate', 'giving.mit.edu/x', ''],
    ['Join', 'join', 'https://forms.gle/a', ''],
    ['Copy', 'donate', 'https://example.com', ''],
    ['', 'empty', 'https://example.com', ''],
    ['Bad url', 'bad', 'not a url', ''],
    ['Old', 'old', 'https://example.com/old', '2020-01-01'],
    ['Us date', '', 'example.com/us', '10/20/2026'],
  ], 1000);
  assert.deepEqual(links.map((l) => [l.title, l.slug, l.url, l.expiresOn, l.shown]), [
    ['Donate', 'donate', 'https://giving.mit.edu/x', null, true],
    ['Join', null, 'https://forms.gle/a', null, true],
    ['Copy', null, 'https://example.com/', null, true],
    ['Old', 'old', 'https://example.com/old', '2020-01-01', true],
    ['Us date', null, 'https://example.com/us', '2026-10-20', true],
  ]);
});
