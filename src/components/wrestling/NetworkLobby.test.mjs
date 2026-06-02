// Source-level invariants for the NetworkLobby style selector.
// React isn't rendered (no jsdom in test stack); we verify by reading
// the JSX text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'NetworkLobby.jsx'), 'utf8');

test('NetworkLobby MODES includes all four styles (women\'s freestyle still available online)', () => {
  // The MainMenu front page removed Women's Freestyle from its 3-button
  // toggle, but the online lobby keeps the full 4-style list - women's
  // freestyle stays available for online matchmaking.
  const modesIdx = SRC.indexOf('const MODES =');
  assert.ok(modesIdx > 0, 'MODES constant must exist');
  const line = SRC.slice(modesIdx, SRC.indexOf('\n', modesIdx));
  assert.ok(line.includes('folkstyle'));
  assert.ok(line.includes('freestyle'));
  assert.ok(line.includes('greco'));
  assert.ok(line.includes('womens_freestyle'),
    'online lobby keeps womens_freestyle even though main menu removed it');
});

test('NetworkLobby styleLabel uses full names, not abbreviations', () => {
  // The earlier abbreviated labels ('Free', 'Greco', 'WFS') only made
  // sense in a 4-up flex row that needed every pixel. With the layout
  // switched to a 2x2 grid, full names fit and read better.
  const labelStart = SRC.indexOf('const styleLabel =');
  assert.ok(labelStart > 0, 'styleLabel must exist');
  const labelBlock = SRC.slice(labelStart, labelStart + 500);

  assert.match(labelBlock, /['"]Freestyle['"]/,
    "styleLabel('freestyle') must be 'Freestyle'");
  assert.match(labelBlock, /['"]Greco-Roman['"]/,
    "styleLabel('greco') must be 'Greco-Roman'");
  assert.match(labelBlock, /['"]Folkstyle['"]/,
    "styleLabel('folkstyle') must be 'Folkstyle'");
  assert.match(labelBlock, /Women's Freestyle/,
    "styleLabel('womens_freestyle') must be \"Women's Freestyle\"");

  // Old 4-char abbreviations must be gone.
  assert.equal(/['"]Free['"]/.test(labelBlock), false,
    "old abbreviation 'Free' must be removed");
  assert.equal(/['"]Greco['"](?!-)/.test(labelBlock), false,
    "old abbreviation 'Greco' (without -Roman) must be removed");
  assert.equal(/['"]Folk['"]/.test(labelBlock), false,
    "old abbreviation 'Folk' must be removed");
  assert.equal(/['"]WFS['"]/.test(labelBlock), false,
    "old abbreviation 'WFS' must be removed");
});

test('NetworkLobby style selector uses 2x2 grid (so full labels fit four buttons)', () => {
  // Four styles with full names - "Women's Freestyle" is 17 chars and
  // doesn't fit a 4-up flex row at text-xs. 2x2 grid gives each button
  // ~half the row width, plenty of room for the longest label.
  const labelStart = SRC.indexOf('const styleLabel =');
  // Slice forward to the JSX that maps MODES.
  const region = SRC.slice(labelStart, labelStart + 1500);
  const mapsModesIdx = region.indexOf('MODES.map');
  assert.ok(mapsModesIdx > 0, 'MODES.map render must exist near styleLabel');
  // Look at the wrapping div above MODES.map - should be grid-cols-2.
  const wrapStart = region.lastIndexOf('<div', mapsModesIdx);
  const wrapBlock = region.slice(wrapStart, mapsModesIdx);
  assert.match(wrapBlock, /grid-cols-2/,
    'style selector wrapper must use grid-cols-2 to fit full labels');
});
