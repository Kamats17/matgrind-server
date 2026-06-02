// Source-level + logic smoke tests for TournamentBracket.jsx rendering a
// 128-wrestler bracket. The repo has no jsdom + RTL setup, so we verify:
//   1. The JSX uses `roundRanges.length` to drive the grid (no hardcoded
//      column count that would break at 7 rounds).
//   2. The bracket data structure for a 128 bracket builds cleanly via
//      buildBracketStructure (the data the JSX renders).
//
// This catches the kind of regression where someone wires the bracket
// component to a fixed 3-column QF/SF/Finals layout that would never
// support 128 = 7 columns.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildBracketStructure } from '../../lib/tournamentState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'TournamentBracket.jsx'), 'utf8');

describe('TournamentBracket - 128 bracket source-level invariants', () => {
  test('grid column count is driven by roundRanges.length (dynamic, supports 7 columns)', () => {
    assert.ok(
      /gridTemplateColumns:\s*`repeat\(\$\{roundRanges\.length\}/.test(SRC),
      'gridTemplateColumns must read roundRanges.length, not a hardcoded number',
    );
  });

  test('horizontal scroll width scales with roundRanges.length (no hardcoded width)', () => {
    // For a 128 bracket = 7 rounds the minWidth must scale so the user can
    // horizontally scroll through all columns on mobile. Pattern:
    // `roundRanges.length > 3 ? roundRanges.length * 160 : undefined`.
    assert.ok(
      /roundRanges\.length\s*>\s*3\s*\?\s*`\$\{roundRanges\.length\s*\*\s*\d+}/.test(SRC),
      'minWidth must scale with roundRanges.length',
    );
  });

  test('bracketSize is read from tournament prop, not hardcoded', () => {
    // The bracket title row prints `${bracketSize}-man ...`. Confirms the
    // component does not hardcode 8 / 16 / 32 / 64 anywhere it would render
    // the wrong label at 128.
    assert.ok(
      /const\s+bracketSize\s*=\s*tournament\.bracketSize\s*\|\|\s*\d+/.test(SRC),
      'bracketSize must be derived from tournament.bracketSize',
    );
    // The header line should interpolate bracketSize, not a literal 8 / 64.
    assert.ok(
      /\{bracketSize\}-man\s/.test(SRC),
      'bracket title must use {bracketSize}-man, not a hardcoded number',
    );
  });

  test('round labels include "Round of 128" for a 128 bracket', () => {
    // Sanity check that the label table covers all the way up to 128.
    // Lives in tournamentState.js (buildRoundLabels), but the JSX renders
    // whatever label appears in roundRanges. If 128 were missing here, the
    // component would render the empty string and grids would shift.
    const stateSrc = readFileSync(
      join(__dirname, '..', '..', 'lib', 'tournamentState.js'),
      'utf8',
    );
    assert.ok(
      /Round of 128/.test(stateSrc),
      'buildRoundLabels must emit "Round of 128" for a 7-round bracket',
    );
  });
});

describe('TournamentBracket - 128 bracket data shape', () => {
  test('buildBracketStructure(128) returns 7 rounds + 127 total matches', () => {
    const { matches, roundRanges, totalRounds, playerRoundsToWin } = buildBracketStructure(128);
    assert.equal(totalRounds, 7, '128 = 7 rounds');
    assert.equal(roundRanges.length, 7, '7 column ranges drive the JSX grid');
    assert.equal(matches.length, 127, '128 single-elim = 127 matches');
    assert.equal(playerRoundsToWin, 7, 'player needs 7 wins to take the title');
  });

  test('128 bracket roundRanges cover every match (no gaps)', () => {
    const { matches, roundRanges } = buildBracketStructure(128);
    // start[0] must be 0, end[N-1] must be matches.length - 1, and each
    // round's start must equal previous end + 1.
    assert.equal(roundRanges[0].start, 0);
    assert.equal(roundRanges[roundRanges.length - 1].end, matches.length - 1);
    for (let i = 1; i < roundRanges.length; i++) {
      assert.equal(roundRanges[i].start, roundRanges[i - 1].end + 1,
        `round ${i} starts immediately after round ${i - 1} ends`);
    }
  });

  test('128 bracket first round has 64 matches (full first round)', () => {
    const { roundRanges } = buildBracketStructure(128);
    const firstRound = roundRanges[0];
    const firstRoundCount = firstRound.end - firstRound.start + 1;
    assert.equal(firstRoundCount, 64, 'first round = 64 matches for a 128 bracket');
  });

  test('128 bracket round labels are ordered Round of 128 -> Finals', () => {
    const { roundRanges } = buildBracketStructure(128);
    const labels = roundRanges.map(r => r.label);
    assert.deepEqual(labels, [
      'Round of 128',
      'Round of 64',
      'Round of 32',
      'Round of 16',
      'Quarterfinals',
      'Semifinals',
      'Finals',
    ]);
  });
});
