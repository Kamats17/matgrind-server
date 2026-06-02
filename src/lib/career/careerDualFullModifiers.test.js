// Career Depth Pass v1 - full-dual hero-only stamina semantics.
//
// In `career_dual_full` mode the player launches every bout in the dual,
// but only the hero bout is actually them. Career modifiers (stat mods +
// staminaMultiplier) must apply ONLY to the hero bout - non-hero teammate
// bouts run with neutral inputs. The pre-fix bug applied staminaMultiplier
// to every bout because `isPlayerWrestlingThisBout` was true for full_dual.
//
// This test asserts the engine's staminaMultiplier wiring works as a pure
// function (1.5 -> buffed stamina, 1.0 -> default stamina). The WrestlingGame
// layer chooses the multiplier value per bout: hero bout passes the career
// mods' staminaMultiplier; non-hero bouts pass 1.0. As long as both engine
// behaviors hold here, the WrestlingGame layer's hero-bout gate produces
// the correct per-bout stamina.
//
// Run: node --test src/lib/career/careerDualFullModifiers.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialMatchState } from '../wrestlingEngine.js';

const sampleStats = { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };

test('engine applies p1StaminaMultiplier when set (hero bout in full_dual)', () => {
  const state = createInitialMatchState(
    'Hero', 'Opp', 'folkstyle', sampleStats, sampleStats, 'medium', null,
    { p1StaminaMultiplier: 1.5 }
  );
  // Base stamina = 200 + (60 - 50) * 0.2 = 202. With 1.5x: 303.
  assert.equal(Math.round(state.p1.stamina), 303);
  // Opponent untouched at 202.
  assert.equal(Math.round(state.p2.stamina), 202);
});

test('engine leaves stamina at default when p1StaminaMultiplier is 1.0 (non-hero bout)', () => {
  const state = createInitialMatchState(
    'Teammate', 'Opp', 'folkstyle', sampleStats, sampleStats, 'medium', null,
    { p1StaminaMultiplier: 1.0 }
  );
  // No buff: same base for both sides.
  assert.equal(Math.round(state.p1.stamina), 202);
  assert.equal(Math.round(state.p2.stamina), 202);
});

test('engine omitting opts defaults to 1.0 (legacy / non-career bout)', () => {
  const state = createInitialMatchState(
    'Teammate', 'Opp', 'folkstyle', sampleStats, sampleStats, 'medium', null
  );
  assert.equal(Math.round(state.p1.stamina), 202);
  assert.equal(Math.round(state.p2.stamina), 202);
});

test('hero vs non-hero stamina differ when career applies a 1.5x stamina buff', () => {
  // Models a full-dual where the player has a +50% stamina tempBuff. The
  // WrestlingGame layer launches each bout with p1StaminaMultiplier set
  // based on the hero-bout check; this asserts the two paths produce
  // different engine state, which is the load-bearing behavior the fix
  // restored.
  const hero = createInitialMatchState(
    'Hero', 'Opp', 'folkstyle', sampleStats, sampleStats, 'medium', null,
    { p1StaminaMultiplier: 1.5 }
  );
  const teammate = createInitialMatchState(
    'Teammate', 'Opp', 'folkstyle', sampleStats, sampleStats, 'medium', null,
    { p1StaminaMultiplier: 1.0 }
  );
  assert.notEqual(hero.p1.stamina, teammate.p1.stamina);
  assert.ok(hero.p1.stamina > teammate.p1.stamina);
});
