// Source-level invariants for DualSetupScreen. The repo has no JSDOM/Vitest
// setup, so we read the JSX text and assert on its shape - same approach as
// MainMenu.test.mjs and TournamentSetupScreen.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'DualSetupScreen.jsx'), 'utf8');

test('renders a wrestling style selector from the centralized name module', () => {
  // The style selector lets the player pick the format; Women's Freestyle
  // must route the AI teams through the women's name pool. The style list
  // is the single centralized source, namePools.js.
  assert.match(
    SRC,
    /import\s*\{[^}]*WRESTLING_STYLES[^}]*\}\s*from\s*['"]\.\.\/\.\.\/lib\/namePools\.js['"]/,
    'must import WRESTLING_STYLES from the centralized namePools module',
  );
  assert.match(SRC, /WRESTLING_STYLES\.map/, 'must render the style options');
});

test('includes the selected style in the config passed to onStart', () => {
  // createDualMeet derives the AI name-pool gender from cfg.style, so the
  // setup screen must put `style` in the config object it hands to onStart.
  assert.match(
    SRC,
    /onStart\(\{[\s\S]*?\bstyle\b[\s\S]*?\}\)/,
    'onStart config object must include the selected style',
  );
});
