// Source-level invariant for career screen routing.
//
// Bug history: the slot-picker `onSelectCareer` callback and the
// retired-career restore handler both used to route by phase:
//     if (hydrated.phase === 'offseason') setScreen('career_offseason');
//     else setScreen('career_dashboard');
// but WrestlingGame.jsx had no top-level `if (screen === 'career_offseason')`
// render branch. The offseason render (`<CareerOffseasonScreen>`) lives
// nested INSIDE the `screen === 'career_dashboard'` block, gated on
// `activeCareer.phase === 'offseason'`. As a result, picking an
// offseason career stranded the user on the "Loading match..." fallback.
//
// Three sibling phase-driven sub-renders (`recruiting`, `tier_transition`,
// `senior_style_choice`) all use the canonical pattern: they live inside
// the dashboard block and are NEVER set as top-level screen names. The
// fix aligned offseason to the same pattern: always route to
// `career_dashboard` and let the nested phase fork dispatch the right
// sub-render.
//
// This test guards the routing invariant: `setScreen('career_offseason')`
// must not appear anywhere in the source. The literal `'career_offseason'`
// may still show up (e.g. ScreenTransition screenKey for animation), so we
// match the full `setScreen(...)` call pattern specifically.
//
// Pattern mirrors the existing source-inspection tests at
// MainMenu.test.mjs and TournamentBracket.test.mjs.
//
// Run: node --test src/pages/careerScreenRouting.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'WrestlingGame.jsx'), 'utf8');

describe('career screen routing - invariants', () => {
  test('no caller sets screen to the off-pattern "career_offseason" name', () => {
    // The slot-picker and restore-career flows must route through
    // setScreen('career_dashboard'); the nested phase fork at the render
    // layer dispatches CareerOffseasonScreen when phase === 'offseason'.
    // If a future change re-introduces setScreen('career_offseason'),
    // users will fall through to the "Loading match..." fallback again.
    const offPattern = /setScreen\(['"]career_offseason['"]\)/g;
    const matches = SRC.match(offPattern) || [];
    assert.equal(
      matches.length,
      0,
      `setScreen('career_offseason') re-introduced. Route to 'career_dashboard' and let the nested phase fork render CareerOffseasonScreen instead. Found ${matches.length} occurrences.`,
    );
  });

  test('canonical setScreen("career_dashboard") route is still present', () => {
    // Sanity check that we did not over-correct and remove the actual
    // route used by every career-mode load path.
    const canonical = /setScreen\(['"]career_dashboard['"]\)/g;
    const matches = SRC.match(canonical) || [];
    assert.ok(
      matches.length >= 1,
      'setScreen("career_dashboard") must be present in at least one caller',
    );
  });

  test('CareerOffseasonScreen is still rendered behind the phase fork', () => {
    // The nested render fork must remain in place; if a refactor moves
    // CareerOffseasonScreen out of the dashboard block, the offseason
    // routing pattern breaks even if the setScreen pattern is intact.
    assert.ok(
      /<CareerOffseasonScreen[\s>]/.test(SRC),
      'CareerOffseasonScreen must be rendered somewhere in WrestlingGame.jsx',
    );
    assert.ok(
      /activeCareer\.phase === 'offseason'/.test(SRC),
      "phase fork `activeCareer.phase === 'offseason'` must remain - it is what dispatches CareerOffseasonScreen from the dashboard block",
    );
  });

  test('sibling phase-driven screens use the same pattern (never set as top-level)', () => {
    // Regression guard for the three sibling phases. If any of these
    // were ever wired as top-level screen names, the same fallthrough bug
    // would recur.
    const siblingOffPatterns = [
      /setScreen\(['"]career_recruiting['"]\)/g,
      /setScreen\(['"]career_tier_transition['"]\)/g,
      /setScreen\(['"]career_senior_style['"]\)/g,
    ];
    for (const re of siblingOffPatterns) {
      const matches = SRC.match(re) || [];
      assert.equal(
        matches.length,
        0,
        `${re.source} must not be a top-level screen name. Route to 'career_dashboard' and let the phase fork dispatch the right sub-render.`,
      );
    }
  });
});
