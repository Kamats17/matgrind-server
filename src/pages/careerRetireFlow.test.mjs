// Source-level invariants for the career retire flow.
//
// Bug history (two bugs, one fix):
//
//   1. CareerOffseasonScreen.jsx + CareerDashboard.jsx (HomeTab) called
//      `onRetire?.()` directly from the Retire button. No confirmation step,
//      no Cancel option. One tap = career retired. Three sibling components
//      (CareerRecruitingScreen, CareerSeniorStyleChoice, CareerSlotPicker)
//      had already standardized a `confirmRetire` (or `confirmClear`) modal
//      pattern; these two drifted off-pattern.
//
//   2. WrestlingGame.jsx's handleCareerRetire ran an async archive/save/
//      clearSlot chain and then called setActiveCareer(null) +
//      setScreen('career_slot_picker'). The Career Retired splash at the
//      dashboard's `activeCareer.phase === 'retired'` fork rendered for the
//      duration of the async chain (~1.5s) and then disappeared before the
//      user could click Hall of Fame / Free This Slot / Pick a Career.
//
// Fix:
//   - Add the same confirm-modal pattern to CareerOffseasonScreen +
//     CareerDashboard so all 5 retire-bearing components match.
//   - Strip the auto-redirect tail from handleCareerRetire. Keep the
//     archive + save + clearLocalCareer hygiene. The Career Retired splash
//     now stays up until the user picks an explicit navigation button.
//
// Run: node --test src/pages/careerRetireFlow.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_DIR = join(__dirname, '..', 'components', 'career');
const read = (file) => readFileSync(file, 'utf8');

describe('career retire flow - source invariants', () => {
  test('all 5 retire-bearing components use the confirm-modal useState pattern', () => {
    // CareerSlotPicker.jsx uses the variable name `confirmClear` (slot-clear
    // semantics) while the other four use `confirmRetire`. Accept either.
    const retireBearing = [
      'CareerOffseasonScreen.jsx',
      'CareerDashboard.jsx',
      'CareerRecruitingScreen.jsx',
      'CareerSeniorStyleChoice.jsx',
      'CareerSlotPicker.jsx',
    ];
    for (const f of retireBearing) {
      const src = read(join(COMPONENTS_DIR, f));
      const hasState = /confirmRetire|confirmClear/.test(src);
      const hasSetter = /setConfirmRetire|setConfirmClear/.test(src);
      assert.ok(
        hasState && hasSetter,
        `${f} must use the confirm-modal useState pattern (confirmRetire or confirmClear). Bare onClick={() => onRetire?.()} re-introduces the accidental-retire bug.`,
      );
    }
  });

  test('all 5 retire-bearing components render a Cancel button', () => {
    // The confirm-modal must offer a Cancel option so users do not
    // automatically get rid of their career.
    const retireBearing = [
      'CareerOffseasonScreen.jsx',
      'CareerDashboard.jsx',
      'CareerRecruitingScreen.jsx',
      'CareerSeniorStyleChoice.jsx',
      'CareerSlotPicker.jsx',
    ];
    for (const f of retireBearing) {
      const src = read(join(COMPONENTS_DIR, f));
      // Match multi-line JSX: `>\n  Cancel\n</button>` or single-line
      // `>Cancel</button>`. Loose whitespace tolerance.
      assert.ok(
        />\s*Cancel\s*</.test(src),
        `${f} must render a Cancel button in its confirm-modal`,
      );
    }
  });

  test('handleCareerRetire body has bidirectional invariants', () => {
    // Scope the regex to the function body so the assertion is not a false
    // positive against the many unrelated setScreen / setActiveCareer(null) /
    // clearLocalCareer / clearSlot calls elsewhere in WrestlingGame.jsx
    // (slot picker, dashboard exit, delete-career handler, etc.). Capture
    // the function body between `useCallback(async () => {` and `}, [<deps>]);`.
    const src = read(join(__dirname, 'WrestlingGame.jsx'));
    const bodyMatch = src.match(
      /const handleCareerRetire = useCallback\(async \(\) => \{([\s\S]*?)\}, \[[^\]]*\]\);/,
    );
    assert.ok(bodyMatch, 'handleCareerRetire must remain a useCallback function');
    const body = bodyMatch[1];

    // Positive: the function must still do the right things.
    assert.ok(
      /retireCareer\(/.test(body),
      'handleCareerRetire body must call retireCareer to flip phase to retired.',
    );
    assert.ok(
      /setActiveCareer\(next\)/.test(body),
      'handleCareerRetire body must call setActiveCareer(next) so the splash renders the retired snapshot.',
    );
    assert.ok(
      /saveCareer\(/.test(body),
      'handleCareerRetire body must persist via saveCareer so a reload reflects retirement.',
    );
    assert.ok(
      /archiveCareer\(/.test(body),
      'handleCareerRetire body must archive Hall of Fame via archiveCareer.',
    );

    // Negative: the function must not re-introduce auto-redirect or local-
    // mirror clear. Each of these would resurrect a known bug.
    assert.equal(
      /setScreen\(/.test(body),
      false,
      'handleCareerRetire body must NOT call setScreen - the splash handles navigation. Re-introducing setScreen here brings back the 1.5s flash + auto-redirect bug.',
    );
    assert.equal(
      /setActiveCareer\(null\)/.test(body),
      false,
      'handleCareerRetire body must NOT null out activeCareer - the splash needs activeCareer to render. Nulling it out brings back the auto-redirect bug.',
    );
    assert.equal(
      /clearLocalCareer\(/.test(body),
      false,
      'handleCareerRetire body must NOT clearLocalCareer - saveCareer just wrote the retired phase to localStorage; clearing it immediately weakens the offline-survivable retired splash. Local-mirror cleanup belongs in the splash buttons.',
    );
    assert.equal(
      /clearSlot\(/.test(body),
      false,
      'handleCareerRetire body must NOT clearSlot - the splash Free This Slot button handles slot-clearing explicitly. Inline clearSlot here unfreezes the slot before the user has decided what to do.',
    );
  });
});
