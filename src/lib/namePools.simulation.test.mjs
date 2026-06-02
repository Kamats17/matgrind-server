// Cross-style simulation: drive the real tournament + dual-meet creation
// paths across every wrestling style and assert the centralized name
// generation never produces a duplicate full name, never repeats a first
// or last name within an event, never falls back to "Wrestler N" for
// normal event sizes, and routes Women's Freestyle through the women's pool.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTournament } from './tournamentState.js';
import { createDualMeet } from './dualMeetState.js';
import { MENS_FIRST_NAMES, WOMENS_FIRST_NAMES } from './namePools.js';

// createTournament persists a snapshot via localStorage, which the Node
// test environment lacks. An in-memory shim keeps the run output clean.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

const STYLES = ['folkstyle', 'freestyle', 'greco', 'womens_freestyle'];
const BRACKET_SIZES = [8, 16, 32, 64, 128];

// A player name that exists in NEITHER pool, so it can never be confused
// with a generated wrestler when checking pool membership.
const PLAYER = {
  username: 'Zztop Playerton',
  stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
  appearance: { primaryColor: 'emerald', accentColor: '#059669' },
};

const firstOf = (n) => String(n).split(' ')[0];
const lastOf = (n) => String(n).split(' ').slice(1).join(' ');
const isFallback = (n) => /^Wrestler \d+$/.test(String(n));

const womensFirstSet = new Set(WOMENS_FIRST_NAMES);
const mensFirstSet = new Set(MENS_FIRST_NAMES);
// Names exclusive to one pool. If a male-exclusive name shows up in a
// women's event, the male pool leaked in - that proves the gender PATH,
// not just that some text "looks" female (the pools share many names).
const MALE_EXCLUSIVE = new Set(MENS_FIRST_NAMES.filter(n => !womensFirstSet.has(n)));
const FEMALE_EXCLUSIVE = new Set(WOMENS_FIRST_NAMES.filter(n => !mensFirstSet.has(n)));

function dualConfig(style) {
  return {
    mode: 'cpu', difficulty: 'medium', heroWeightClass: 157,
    playerTeamName: 'Home', opponentTeamName: 'Away',
    lineupMode: 'random', style,
  };
}

test('tournaments: no duplicate full names, bounded first/last, no fallback', () => {
  for (const style of STYLES) {
    for (const size of BRACKET_SIZES) {
      for (let iter = 0; iter < 10; iter++) {
        const t = createTournament(PLAYER, 'medium', style, size, 'consolation');
        assert.equal(t.wrestlingStyle, style);
        const opponents = t.bracket.filter(e => !e.isPlayer);
        assert.equal(opponents.length, size - 1);
        const names = opponents.map(e => e.name);

        assert.equal(new Set(names).size, names.length,
          `${style}/${size}: duplicate full name`);
        assert.ok(!names.some(isFallback),
          `${style}/${size}: hit the Wrestler N fallback for a normal bracket size`);
        assert.equal(new Set(names.map(firstOf)).size, names.length,
          `${style}/${size}: a first name repeated within the bracket`);
        assert.equal(new Set(names.map(lastOf)).size, names.length,
          `${style}/${size}: a last name repeated within the bracket`);
      }
    }
  }
});

test('dual meets: no duplicate full names, bounded first/last across both teams', () => {
  for (const style of STYLES) {
    for (let iter = 0; iter < 25; iter++) {
      const dual = createDualMeet(PLAYER, dualConfig(style));
      assert.equal(dual.wrestlingStyle, style);
      const everyone = [...dual.playerTeam, ...dual.opponentTeam].map(w => w.name);

      assert.equal(new Set(everyone).size, everyone.length,
        `${style}: duplicate full name across the dual`);
      assert.ok(!everyone.some(isFallback),
        `${style}: dual hit the Wrestler N fallback`);

      // Generated wrestlers (the hero is the human player) - first and last
      // names are de-collided across BOTH teams via the shared trackers.
      const generated = [
        ...dual.playerTeam.filter(w => !w.isHero),
        ...dual.opponentTeam,
      ].map(w => w.name);
      assert.equal(new Set(generated.map(firstOf)).size, generated.length,
        `${style}: a first name repeated within the dual`);
      assert.equal(new Set(generated.map(lastOf)).size, generated.length,
        `${style}: a last name repeated within the dual`);
    }
  }
});

test("womens_freestyle tournaments use the women's name pool (path verified)", () => {
  let sawFemaleExclusive = false;
  for (let iter = 0; iter < 30; iter++) {
    const t = createTournament(PLAYER, 'medium', 'womens_freestyle', 64, 'consolation');
    const firsts = t.bracket
      .filter(e => !e.isPlayer && !isFallback(e.name))
      .map(e => firstOf(e.name));
    assert.ok(firsts.length > 0);
    for (const f of firsts) {
      assert.ok(womensFirstSet.has(f),
        `womens_freestyle tournament produced "${f}" - not in the women's pool`);
      assert.ok(!MALE_EXCLUSIVE.has(f),
        `male-exclusive first name "${f}" leaked into a women's tournament`);
    }
    if (firsts.some(f => FEMALE_EXCLUSIVE.has(f))) sawFemaleExclusive = true;
  }
  assert.ok(sawFemaleExclusive,
    "no female-exclusive first name ever appeared - the women's pool path may not be exercised");
});

test("womens_freestyle duals use the women's name pool (path verified)", () => {
  let sawFemaleExclusive = false;
  for (let iter = 0; iter < 25; iter++) {
    const dual = createDualMeet(PLAYER, dualConfig('womens_freestyle'));
    const cpuFirsts = dual.opponentTeam
      .filter(w => !isFallback(w.name))
      .map(w => firstOf(w.name));
    assert.ok(cpuFirsts.length > 0);
    for (const f of cpuFirsts) {
      assert.ok(womensFirstSet.has(f),
        `womens_freestyle dual produced "${f}" - not in the women's pool`);
      assert.ok(!MALE_EXCLUSIVE.has(f),
        `male-exclusive first name "${f}" leaked into a women's dual`);
    }
    if (cpuFirsts.some(f => FEMALE_EXCLUSIVE.has(f))) sawFemaleExclusive = true;
  }
  assert.ok(sawFemaleExclusive,
    "no female-exclusive first name ever appeared in women's duals");
});

test("men's styles never leak female-exclusive names into tournaments or duals", () => {
  for (const style of ['folkstyle', 'freestyle', 'greco']) {
    for (let iter = 0; iter < 15; iter++) {
      const t = createTournament(PLAYER, 'medium', style, 32, 'consolation');
      for (const e of t.bracket) {
        if (e.isPlayer || isFallback(e.name)) continue;
        assert.ok(mensFirstSet.has(firstOf(e.name)),
          `${style} tournament produced "${e.name}" - not in the men's pool`);
        assert.ok(!FEMALE_EXCLUSIVE.has(firstOf(e.name)),
          `female-exclusive name "${firstOf(e.name)}" leaked into a ${style} tournament`);
      }
      const dual = createDualMeet(PLAYER, dualConfig(style));
      for (const w of dual.opponentTeam) {
        if (isFallback(w.name)) continue;
        assert.ok(!FEMALE_EXCLUSIVE.has(firstOf(w.name)),
          `female-exclusive name "${firstOf(w.name)}" leaked into a ${style} dual`);
      }
    }
  }
});
