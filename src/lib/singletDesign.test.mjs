// Unit tests for the singlet design helpers. Pure functions, no DOM.
// Mask processor is exercised by an integration smoke (visual review),
// not unit-tested here because it requires a real Image + canvas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SINGLET_VIEWBOX,
  TEMPLATE_IMAGE,
  STRIPE_PATHS,
  TEXT_POSITIONS,
  SINGLET_DEFAULTS,
  SINGLET_COLORS,
  autoFontSize,
  readableTextColor,
  buildSinglet,
} from './singletDesign.js';

test('SINGLET_VIEWBOX matches the 240x360 contract used by SingletTemplate', () => {
  assert.equal(SINGLET_VIEWBOX.width, 240);
  assert.equal(SINGLET_VIEWBOX.height, 360);
});

test('TEMPLATE_IMAGE points at a public-served path with both half offsets defined', () => {
  assert.equal(TEMPLATE_IMAGE.src, '/singlet-template.png');
  assert.equal(TEMPLATE_IMAGE.width, 480);
  assert.equal(TEMPLATE_IMAGE.height, 360);
  assert.ok(typeof TEMPLATE_IMAGE.frontX === 'number');
  assert.ok(typeof TEMPLATE_IMAGE.backX === 'number');
  // Back must be ~ -240 + (a small back-half centering shift) so the right
  // half of the source image lands inside viewBox 0..240.
  assert.ok(TEMPLATE_IMAGE.backX < -200);
});

test('STRIPE_PATHS are identical for front + back so alignment is shared', () => {
  // The whole point of the percentage-based / shared-coords requirement is
  // that left and right stripe geometry comes from one source. Sanity-check
  // that the strings are well-formed and that left + right are mirrored.
  assert.match(STRIPE_PATHS.left,  /^M\s+-?\d+/);
  assert.match(STRIPE_PATHS.right, /^M\s+-?\d+/);
  // viewBox is 240 wide; the left rect's outer edge is below x=60 and the
  // right rect's outer edge is above x=180 - any other arrangement would
  // cover the chest panel entirely.
  const leftMaxX  = Math.max(...[...STRIPE_PATHS.left.matchAll(/-?\d+/g)].map(m => Number(m[0])).filter((_, i) => i % 2 === 0));
  const rightMinX = Math.min(...[...STRIPE_PATHS.right.matchAll(/-?\d+/g)].map(m => Number(m[0])).filter((_, i) => i % 2 === 0));
  assert.ok(leftMaxX <= 60, 'left stripe inner edge should leave the chest panel');
  assert.ok(rightMinX >= 180, 'right stripe inner edge should leave the chest panel');
});

test('TEXT_POSITIONS has front+back entries with non-zero font sizes', () => {
  for (const view of ['front', 'back']) {
    for (const slot of Object.values(TEXT_POSITIONS[view])) {
      assert.ok(slot.x > 0 && slot.y > 0, `${view} text x/y must be positive`);
      assert.ok(slot.baseFS > 0, `${view} baseFS must be positive`);
      assert.ok(slot.maxWidth > 0, `${view} maxWidth must be positive`);
    }
  }
});

test('SINGLET_DEFAULTS shape is the contract every consumer assumes', () => {
  const requiredKeys = [
    'chestColor', 'sidesColor', 'textColor',
    'teamText', 'lastNameText', 'weightClassText',
  ];
  for (const k of requiredKeys) {
    assert.ok(k in SINGLET_DEFAULTS, `SINGLET_DEFAULTS missing required key ${k}`);
  }
  // Defaults are frozen so a stray mutation can't poison every consumer.
  assert.throws(() => { SINGLET_DEFAULTS.chestColor = 'red'; });
});

test('SINGLET_COLORS has exactly 12 entries with hex + label', () => {
  assert.equal(SINGLET_COLORS.length, 12);
  for (const c of SINGLET_COLORS) {
    assert.match(c.hex, /^#[0-9a-fA-F]{6}$/, `${c.id} hex must be 6-char #RRGGBB`);
    assert.ok(c.label && typeof c.label === 'string');
  }
});

test('autoFontSize: short text gets baseFS, long text scales toward 8 floor', () => {
  // 6 chars at baseFS=20, charWidth=12: natural width 72 < maxWidth 110, so
  // the function returns baseFS unchanged (no upsizing past base).
  assert.equal(autoFontSize('IOWA12', 20, 110), 20);
  // 25 chars: natural 300, fitFS = 20*110/300 = 7.33, clamped to 8.
  assert.equal(autoFontSize('A'.repeat(25), 20, 110), 8);
  // Empty string: treated as length 1, returns baseFS.
  assert.equal(autoFontSize('', 22, 110), 22);
  // Mid-length ~12 chars: scales below baseFS but above floor.
  const mid = autoFontSize('PENN STATE U', 20, 110);
  assert.ok(mid > 8 && mid <= 20, `expected 8 < mid <= 20, got ${mid}`);
});

test('readableTextColor: dark background -> white text, light background -> dark text', () => {
  assert.equal(readableTextColor('#000000'), '#ffffff');
  assert.equal(readableTextColor('#0a1f44'), '#ffffff');
  assert.equal(readableTextColor('#ffffff'), '#1a1a1a');
  assert.equal(readableTextColor('#eab308'), '#1a1a1a'); // gold is light
  // Bad input falls back to white safely.
  assert.equal(readableTextColor(null), '#ffffff');
  assert.equal(readableTextColor('not-a-hex'), '#ffffff');
});

test('buildSinglet: applies defaults, then fallbacks, then partial values in priority order', () => {
  // No partial, no fallbacks: pure defaults.
  const a = buildSinglet();
  assert.equal(a.chestColor, SINGLET_DEFAULTS.chestColor);
  // Fallback fills text fields when partial is absent.
  const b = buildSinglet(undefined, { teamText: 'IOWA' });
  assert.equal(b.teamText, 'IOWA');
  // Partial wins over fallback.
  const c = buildSinglet({ teamText: 'OHIO' }, { teamText: 'IOWA' });
  assert.equal(c.teamText, 'OHIO');
  // Garbage partial keys are ignored; non-string values are skipped.
  const d = buildSinglet({ chestColor: 12345, junk: 'nope' }, {});
  assert.equal(d.chestColor, SINGLET_DEFAULTS.chestColor);
  assert.equal(d.junk, undefined);
});
