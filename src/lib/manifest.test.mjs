// Regression test: every icon path in public/manifest.json must point at
// a real file in public/. The live console-error
//   "Error while trying to use the following icon from the Manifest:
//    https://play.matgrind.com/icons/icon-192.webp (Download error or
//    resource isn't a valid image)"
// surfaced because the manifest referenced ../icons/*.webp which never
// existed in the deploy. This test pins the contract so any future
// manifest edit that breaks the icon paths fails CI before deploy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/lib/ -> ../../public
const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');

function loadManifest() {
  return JSON.parse(readFileSync(join(PUBLIC_DIR, 'manifest.json'), 'utf8'));
}

test('manifest icons exist on disk', () => {
  const m = loadManifest();
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0, 'manifest must declare icons');
  for (const icon of m.icons) {
    assert.equal(typeof icon.src, 'string', 'icon.src must be a string');
    // Resolve against the public/ root for absolute paths (/icon-192.png)
    // and against public/ for relative paths.
    const relPath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
    const abs = resolve(PUBLIC_DIR, relPath);
    // Forbid any path that escapes public/ - the original bug used
    // ../icons/* which Vite ignores at build time but produces a 404
    // in the deploy.
    assert.ok(
      abs.startsWith(resolve(PUBLIC_DIR)),
      `icon path ${icon.src} escapes public/ - manifest icons must live inside public/`,
    );
    assert.ok(
      existsSync(abs),
      `icon ${icon.src} (resolved ${abs}) does not exist on disk`,
    );
    assert.ok(statSync(abs).size > 0, `icon ${icon.src} is empty`);
  }
});

test('manifest icon types match file extensions', () => {
  const m = loadManifest();
  for (const icon of m.icons) {
    if (!icon.type) continue;
    const ext = icon.src.split('.').pop()?.toLowerCase();
    const expectedExt = icon.type === 'image/png' ? 'png'
      : icon.type === 'image/webp' ? 'webp'
      : icon.type === 'image/svg+xml' ? 'svg'
      : null;
    if (expectedExt) {
      assert.equal(ext, expectedExt,
        `icon ${icon.src} has type=${icon.type} but extension=${ext}`);
    }
  }
});

test('manifest declares at least one 192x192 icon (Lighthouse PWA requirement)', () => {
  const m = loadManifest();
  const has192 = m.icons.some(i => i.sizes === '192x192');
  assert.ok(has192, 'manifest must include a 192x192 icon');
});

test('manifest declares at least one 512x512 icon (Lighthouse PWA requirement)', () => {
  const m = loadManifest();
  const has512 = m.icons.some(i => i.sizes === '512x512');
  assert.ok(has512, 'manifest must include a 512x512 icon');
});
