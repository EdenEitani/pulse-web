// Static PWA checks: everything the app needs offline is precached, and all referenced files exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));
const shell = () => [...read('sw.js').matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((s) => /\.(js|css|html|png|webmanifest)$|^\.\/$/.test(s));

test('service worker precaches every file that exists in the shell list', () => {
  for (const f of shell()) assert.ok(f === './' || exists(f), `missing from disk: ${f}`);
});

test('every JS module reachable from app.js is precached', () => {
  const seen = new Set(), queue = ['js/app.js'];
  while (queue.length) {
    const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
    for (const m of read(f).matchAll(/from\s+'(\.\/[^']+)'/g)) queue.push('js/' + m[1].slice(2));
  }
  const cached = new Set(shell());
  for (const f of seen) assert.ok(cached.has(f), `${f} is imported but not in the service worker's SHELL list (it would break offline)`);
});

test('index.html links resolve, use relative paths (works under /pulse-web/), and register the manifest', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) { assert.ok(!m[1].startsWith('/'), `absolute path breaks sub-path hosting: ${m[1]}`); assert.ok(exists(m[1]), `missing: ${m[1]}`); }
  assert.match(html, /viewport-fit=cover/); assert.match(html, /name="theme-color"/);
});

test('manifest is installable: name, scope, standalone, 192 + 512 icons (one maskable), relative URLs', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(m.name && m.short_name && m.display === 'standalone');
  assert.ok(m.start_url.startsWith('./') && m.scope === './', 'start_url/scope must be relative for GitHub Pages sub-paths');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(exists(i.src), i.src);
  assert.equal(m.background_color, '#050709');
});

test('service worker has a version, install/activate/fetch handlers, and skips cross-origin', () => {
  const sw = read('sw.js');
  assert.match(sw, /const VERSION = 'pulse-v[\d.]+'/);
  for (const ev of ['install', 'activate', 'fetch']) assert.match(sw, new RegExp(`addEventListener\\('${ev}'`));
  assert.match(sw, /origin !== self\.location\.origin/);
});

test('app registers the service worker with a relative path', () => {
  assert.match(read('js/app.js'), /serviceWorker\.register\('sw\.js'\)/);
});
