// Source-level invariants for the MainMenu wrestling-style selector.
// React isn't rendered (no jsdom in test stack); we read the JSX text and
// assert structural facts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'MainMenu.jsx'), 'utf8');

test('MainMenu does not render a womens_freestyle button in the style toggle', () => {
  // Locate the wrestlingStyle toggle array. The block is uniquely
  // delimited by the comment "Wrestling Style Toggle" above it.
  const blockStart = SRC.indexOf('Wrestling Style Toggle');
  assert.ok(blockStart > 0, 'wrestling style toggle block must exist');
  // The block ends right before the next labeled section. "Offline
  // banner" is the comment immediately following the style-toggle grid.
  // It used to be "Mode Selection" before the 1.2.5 cleanup removed the
  // mode-picker (Versus CPU / Local / Online) from Home.
  const blockEnd = SRC.indexOf('Offline banner', blockStart);
  assert.ok(blockEnd > blockStart, 'wrestling style toggle block must be bounded');
  const block = SRC.slice(blockStart, blockEnd);

  assert.equal(
    block.includes("id: 'womens_freestyle'"),
    false,
    'wrestling style toggle must not include a womens_freestyle entry',
  );
  // The block may still mention Women's Freestyle in a comment explaining
  // why it was removed - that's intentional historical context, not a
  // rendered button. Assert specifically on the label-prop pattern that
  // would only appear if a button-entry still existed:
  assert.equal(
    /label:\s*"Women's Freestyle"/.test(block),
    false,
    "no Women's Freestyle button entry (label prop)",
  );
});

test('MainMenu wrestling style toggle uses grid-cols-3 (3 buttons fit a single row cleanly)', () => {
  const blockStart = SRC.indexOf('Wrestling Style Toggle');
  // The block ends right before the next labeled section. "Offline
  // banner" is the comment immediately following the style-toggle grid.
  // It used to be "Mode Selection" before the 1.2.5 cleanup removed the
  // mode-picker (Versus CPU / Local / Online) from Home.
  const blockEnd = SRC.indexOf('Offline banner', blockStart);
  const block = SRC.slice(blockStart, blockEnd);

  // After removing the 4th style, the grid must be cols-3, not cols-2.
  // grid-cols-2 with 3 items leaves an orphan in the second row.
  assert.match(block, /grid-cols-3/,
    'three styles render cleanly only with grid-cols-3 - grid-cols-2 leaves an orphan');
  assert.equal(
    /grid-cols-2[^0-9]/.test(block), false,
    'grid-cols-2 is wrong for a 3-button toggle (would leave one orphaned)',
  );
});

test('MainMenu migrates a persisted womens_freestyle style to freestyle on load', () => {
  // A user who selected womens_freestyle before the button was removed
  // would still have it in localStorage. The init state must remap that
  // legacy value to a still-supported style instead of leaving the
  // selector with no active button.
  const initIdx = SRC.indexOf('const [wrestlingStyle, setWrestlingStyle] = useState(');
  assert.ok(initIdx > 0, 'wrestlingStyle useState declaration must exist');
  // Generous window covering the multi-line initializer body.
  const initBlock = SRC.slice(initIdx, initIdx + 800);
  assert.match(initBlock, /matgrind_default_style/,
    'initializer must read the persisted style key');
  // Migration: legacy 'womens_freestyle' must land on 'freestyle'.
  assert.match(
    initBlock,
    /['"]womens_freestyle['"][\s\S]{0,200}return\s+['"]freestyle['"]/,
    'legacy womens_freestyle must remap to freestyle',
  );
});
