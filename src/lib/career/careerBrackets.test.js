import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSeededBracket } from './careerBrackets.js';

function npc(id, scope, overall, name) {
  return { id, scope, overall, name: name || `${scope}-${id}`, school: 'Test HS' };
}

function makeCareer({ rankings = {}, pool = [] } = {}) {
  return {
    wrestler: {
      name: 'Player',
      stats: { str: 70, spd: 70, tec: 70, end: 70, grt: 70 },
      appearance: { primaryColor: 'emerald' },
    },
    rankings,
    rankingPool: pool,
  };
}

describe('buildSeededBracket - scope filtering', () => {
  const pool = [
    npc('c1', 'conference', 90),
    npc('c2', 'conference', 85),
    npc('c3', 'conference', 80),
    npc('c4', 'conference', 75),
    npc('c5', 'conference', 70),
    npc('c6', 'conference', 65),
    npc('c7', 'conference', 60),
    npc('s1', 'section', 95),
    npc('s2', 'section', 88),
    npc('s3', 'section', 82),
    npc('st1', 'state', 99),
    npc('st2', 'state', 92),
    npc('st3', 'state', 86),
  ];

  test('Conference Championships use only conference-scoped NPCs', () => {
    const career = makeCareer({ rankings: { conference: 1, section: 5, state: 12 }, pool });
    const { bracket } = buildSeededBracket(career, 8, 'conference');
    const npcEntries = bracket.filter(e => !e.isPlayer);
    assert.equal(npcEntries.length, 7);
    for (const e of npcEntries) {
      const matched = pool.find(p => p.id === e.rankPoolId);
      assert.equal(matched?.scope, 'conference');
    }
  });

  test('State events draw from the full pool sorted by overall', () => {
    // State rank is computed against the entire field, so the State
    // Championship bracket pulls the strongest wrestlers regardless of
    // their conference/section/state tag. Mirrors careerRankings.js.
    const wide = pool.concat([
      npc('st4', 'state', 50), npc('st5', 'state', 45),
    ]);
    const career = makeCareer({ rankings: { state: 3 }, pool: wide });
    const { bracket } = buildSeededBracket(career, 8, 'state');
    const npcEntries = bracket.filter(e => !e.isPlayer);
    // Expect the top 7 by overall. Highest-overall wrestlers in our
    // fixture are st1 (99), s1 (95), st2 (92), c1 (90), s2 (88), st3 (86),
    // c2 (85). Verify all are pulled from the full pool, not state-only.
    const ids = npcEntries.map(e => e.rankPoolId).sort();
    assert.deepEqual(ids, ['c1', 'c2', 's1', 's2', 'st1', 'st2', 'st3']);
  });

  test('Regional events draw from conference + section pool combined', () => {
    // 7 conference + 3 section = 10 entries match the section predicate;
    // bracketSize 8 needs 7 NPCs, so the scoped pool is sufficient and
    // we should NOT fall back to state-tagged entries.
    const career = makeCareer({ rankings: { section: 2 }, pool });
    const { bracket } = buildSeededBracket(career, 8, 'regional');
    assert.equal(bracket.length, 8);
    const npcEntries = bracket.filter(e => !e.isPlayer);
    assert.equal(npcEntries.length, 7);
    for (const e of npcEntries) {
      const matched = pool.find(p => p.id === e.rankPoolId);
      assert.ok(matched?.scope === 'conference' || matched?.scope === 'section',
        `expected conference or section, got ${matched?.scope}`);
    }
  });

  test('falls back to full pool if scope pool is too small', () => {
    const slim = [
      npc('c1', 'conference', 90),
      npc('c2', 'conference', 85),
      npc('c3', 'conference', 80),
      npc('s1', 'section', 70),
      npc('s2', 'section', 65),
      npc('s3', 'section', 60),
      npc('st1', 'state', 55),
      npc('st2', 'state', 50),
    ];
    const career = makeCareer({ rankings: { conference: 1 }, pool: slim });
    const { bracket } = buildSeededBracket(career, 8, 'conference');
    assert.equal(bracket.filter(e => !e.isPlayer).length, 7);
  });
});

describe('buildSeededBracket - player seed by scope rank', () => {
  const pool = [];
  for (let i = 0; i < 20; i++) pool.push(npc(`c${i}`, 'conference', 90 - i));

  test('uses conference rank for conference events', () => {
    const career = makeCareer({ rankings: { conference: 4, state: 18 }, pool });
    const { playerSeed } = buildSeededBracket(career, 16, 'conference');
    assert.equal(playerSeed, 3);
  });

  test('uses state rank for state events', () => {
    const statePool = [];
    for (let i = 0; i < 20; i++) statePool.push(npc(`st${i}`, 'state', 90 - i));
    const career = makeCareer({ rankings: { conference: 1, state: 12 }, pool: statePool });
    const { playerSeed } = buildSeededBracket(career, 16, 'state');
    assert.equal(playerSeed, 11);
  });

  test('clamps seed to bracket size when player is unranked', () => {
    const career = makeCareer({ rankings: {}, pool });
    const { playerSeed } = buildSeededBracket(career, 8, 'conference');
    assert.equal(playerSeed, 7);
  });

  test('default stakes (no arg) uses state rank', () => {
    const career = makeCareer({ rankings: { state: 5 }, pool });
    const { playerSeed } = buildSeededBracket(career, 16);
    assert.equal(playerSeed, 4);
  });
});

describe('buildSeededBracket - structure', () => {
  test('returns bracket of bracketSize length with player at the seeded slot', () => {
    const pool = [];
    for (let i = 0; i < 20; i++) pool.push(npc(`c${i}`, 'conference', 90 - i));
    const career = makeCareer({ rankings: { conference: 2 }, pool });
    const { bracket, playerSeed } = buildSeededBracket(career, 8, 'conference');
    assert.equal(bracket.length, 8);
    assert.equal(bracket[playerSeed].isPlayer, true);
    assert.equal(bracket.filter(e => e.isPlayer).length, 1);
  });

  test('signals skipShuffle to the tournament factory', () => {
    const pool = [npc('c1', 'conference', 90)];
    const career = makeCareer({ rankings: { conference: 1 }, pool });
    const { skipShuffle } = buildSeededBracket(career, 4, 'conference');
    assert.equal(skipShuffle, true);
  });
});

// ─── v6: cap same-last-name duplicates at 2 per bracket ────────────────────
//
// Player feedback: "in a 64 man bracket there are 4+ edwards, 3+ carters,
// 3+ larsens." buildSeededBracket now walks the overall-sorted pool and
// skips an entry whose last name already has 2 representatives in the
// bracket, falling through to the next-best NPC.

describe('buildSeededBracket - v6 last-name cap', () => {
  // Synthetic pool: 8 wrestlers all named "X Edwards" with descending overalls.
  // Plus 6 with diverse last names so the bracket can fill.
  const pool = [];
  for (let i = 0; i < 8; i++) pool.push(npc(`e${i}`, 'conference', 90 - i, `Aiden Edwards`));
  pool.push(npc('a', 'conference', 81, 'Bob Smith'));
  pool.push(npc('b', 'conference', 80, 'Cole Brown'));
  pool.push(npc('c', 'conference', 79, 'Dean Carter'));
  pool.push(npc('d', 'conference', 78, 'Evan Davis'));
  pool.push(npc('e', 'conference', 77, 'Finn Garcia'));
  pool.push(npc('f', 'conference', 76, 'Gus Harris'));

  test('caps Edwards at 2 in an 8-bracket', () => {
    const career = makeCareer({ rankings: { conference: 5 }, pool });
    const { bracket } = buildSeededBracket(career, 8, 'conference');
    const edwardsCount = bracket.filter(e => !e.isPlayer && e.name?.endsWith('Edwards')).length;
    assert.ok(edwardsCount <= 2, `should be at most 2 Edwards in bracket, got ${edwardsCount}`);
  });

  test('caps duplicate first names at 2 (v6.1 - "two Hunters" bug)', () => {
    // Pool: 5 wrestlers named "Hunter X" with different last names + 6 mixed.
    const huntPool = [];
    for (let i = 0; i < 5; i++) huntPool.push(npc(`h${i}`, 'conference', 90 - i, `Hunter Last${i}`));
    huntPool.push(npc('a', 'conference', 81, 'Bob Smith'));
    huntPool.push(npc('b', 'conference', 80, 'Cole Brown'));
    huntPool.push(npc('c', 'conference', 79, 'Dean Carter'));
    huntPool.push(npc('d', 'conference', 78, 'Evan Davis'));
    huntPool.push(npc('e', 'conference', 77, 'Finn Garcia'));
    huntPool.push(npc('f', 'conference', 76, 'Gus Harris'));
    const career = makeCareer({ rankings: { conference: 5 }, pool: huntPool });
    const { bracket } = buildSeededBracket(career, 8, 'conference');
    const hunterCount = bracket.filter(e => !e.isPlayer && e.name?.startsWith('Hunter ')).length;
    assert.ok(hunterCount <= 2, `should be at most 2 Hunters, got ${hunterCount}`);
  });

  test('falls back to overflow if cap leaves bracket short', () => {
    // Tiny pool: 8 identically-named Edwards + 1 Smith. The full-name-dedup
    // rule keeps only one "Aiden Edwards"; the bracket still fills its 8
    // slots (player + 7) - short slots fall through to synthetic wrestlers.
    const slim = [];
    for (let i = 0; i < 8; i++) slim.push(npc(`e${i}`, 'conference', 90 - i, `Aiden Edwards`));
    slim.push(npc('s', 'conference', 70, 'Bob Smith'));
    const career = makeCareer({ rankings: { conference: 5 }, pool: slim });
    const { bracket } = buildSeededBracket(career, 8, 'conference');
    // The bracket has 8 slots; player + 7 entries fills it.
    assert.equal(bracket.filter(e => !e.isPlayer).length, 7);
  });
});

// ─── No duplicate full names inside one bracket ────────────────────────────
//
// Requirement: a tournament/bracket must never contain two wrestlers with
// the identical full name. A career bracket pulls NPCs from the persistent
// ranking pool; if that pool ever holds a name collision (random-gen
// collision, or a special NPC name matching a generated one) the bracket
// builder must drop the duplicate rather than seat both.

describe('buildSeededBracket - no duplicate full names', () => {
  test('a bracket never seats two wrestlers with the identical full name', () => {
    // 10 distinct NPC ids all sharing the full name "Jake Stone", plus 6
    // genuinely distinct wrestlers. A clean 8-bracket (7 NPCs) is possible:
    // one Jake Stone + the 6 others.
    const pool = [];
    for (let i = 0; i < 10; i++) pool.push(npc(`d${i}`, 'conference', 90 - i, 'Jake Stone'));
    pool.push(npc('a', 'conference', 79, 'Cole Brown'));
    pool.push(npc('b', 'conference', 78, 'Dean Carter'));
    pool.push(npc('c', 'conference', 77, 'Evan Davis'));
    pool.push(npc('e', 'conference', 76, 'Finn Garcia'));
    pool.push(npc('f', 'conference', 75, 'Gus Harris'));
    pool.push(npc('g', 'conference', 74, 'Hank Ingram'));
    const career = makeCareer({ rankings: { conference: 5 }, pool });
    const { bracket } = buildSeededBracket(career, 8, 'conference');
    const npcNames = bracket.filter(e => !e.isPlayer).map(e => e.name);
    assert.equal(npcNames.length, 7);
    assert.equal(
      new Set(npcNames).size, npcNames.length,
      `duplicate full name in bracket: ${JSON.stringify(npcNames)}`,
    );
  });

  test('large bracket from a collision-heavy pool has all-unique full names', () => {
    // 30 "Jake Stone" + 30 "Cole Brown" + 40 distinct. A 32-bracket needs
    // 31 NPCs - far more than the 2 colliding names can supply uniquely, so
    // the rest fall through to synthetic wrestlers. Still: zero duplicates.
    const pool = [];
    for (let i = 0; i < 30; i++) pool.push(npc(`j${i}`, 'state', 99 - i, 'Jake Stone'));
    for (let i = 0; i < 30; i++) pool.push(npc(`c${i}`, 'state', 69 - i, 'Cole Brown'));
    for (let i = 0; i < 40; i++) pool.push(npc(`u${i}`, 'state', 40 - i * 0.1, `Uniq Name${i}`));
    const career = makeCareer({ rankings: { state: 8 }, pool });
    const { bracket } = buildSeededBracket(career, 32, 'state');
    const npcNames = bracket.filter(e => !e.isPlayer).map(e => e.name);
    assert.equal(npcNames.length, 31);
    assert.equal(
      new Set(npcNames).size, npcNames.length,
      `duplicate full name in bracket: ${JSON.stringify(npcNames)}`,
    );
  });
});

// ─── v9: new stakes routing (district + conference_d1) ──────────────────────
//
// scopeForStakes is private; verify via the pool predicate by feeding a
// pool that has ONLY the expected scope tag - if the mapping is wrong, the
// bracket falls back to fullPool (state-tagged) and we'd see state entries
// leak in. These tests would have caught the pre-fix bug where
// conference_d1 routed through default 'state'.

describe('buildSeededBracket - v9 stakes scope routing', () => {
  test('district stakes draws from section pool (conference + section)', () => {
    const pool = [];
    for (let i = 0; i < 8; i++) pool.push(npc(`c${i}`, 'conference', 90 - i));
    for (let i = 0; i < 24; i++) pool.push(npc(`s${i}`, 'section', 88 - i));
    // Throw in some state-tagged NPCs that would leak in if district
    // accidentally mapped to state.
    for (let i = 0; i < 8; i++) pool.push(npc(`st${i}`, 'state', 99 - i));
    const career = makeCareer({ rankings: { section: 5 }, pool });
    const { bracket } = buildSeededBracket(career, 32, 'district');
    const npcEntries = bracket.filter(e => !e.isPlayer);
    assert.equal(npcEntries.length, 31, '32-bracket has 31 NPCs');
    for (const e of npcEntries) {
      const matched = pool.find(p => p.id === e.rankPoolId);
      assert.ok(matched?.scope === 'conference' || matched?.scope === 'section',
        `district must pull from section predicate; got scope=${matched?.scope}`);
    }
  });

  test('conference_d1 stakes draws from conference pool only', () => {
    const pool = [];
    // 31 conference NPCs so the conference predicate alone fills the 32-bracket.
    for (let i = 0; i < 31; i++) pool.push(npc(`c${i}`, 'conference', 95 - i));
    // Section + state NPCs that would leak in on a mis-mapping.
    for (let i = 0; i < 16; i++) pool.push(npc(`s${i}`, 'section', 99 - i));
    for (let i = 0; i < 8; i++) pool.push(npc(`st${i}`, 'state', 99 - i));
    const career = makeCareer({ rankings: { conference: 4 }, pool });
    const { bracket } = buildSeededBracket(career, 32, 'conference_d1');
    const npcEntries = bracket.filter(e => !e.isPlayer);
    assert.equal(npcEntries.length, 31, '32-bracket has 31 NPCs');
    for (const e of npcEntries) {
      const matched = pool.find(p => p.id === e.rankPoolId);
      assert.equal(matched?.scope, 'conference',
        `conference_d1 must pull from conference predicate; got scope=${matched?.scope}`);
    }
  });

  test('128-bracket at state stakes builds without fallback', () => {
    // V9 HS State Championship + College NCAA + Senior Worlds all run 128.
    // Need 127 NPCs in the state pool; the production pool is 260+ at state.
    const pool = [];
    for (let i = 0; i < 200; i++) {
      pool.push(npc(`st${i}`, 'state', 99 - i * 0.3, `Wrestler State ${i}`));
    }
    const career = makeCareer({ rankings: { state: 64 }, pool });
    const { bracket, playerSeed } = buildSeededBracket(career, 128, 'state');
    assert.equal(bracket.length, 128, '128 slots');
    assert.equal(bracket.filter(e => e.isPlayer).length, 1, 'exactly 1 player slot');
    assert.equal(playerSeed, 63, 'player seed = state rank - 1 (clamped)');
    const npcEntries = bracket.filter(e => !e.isPlayer);
    assert.equal(npcEntries.length, 127, '127 NPCs');
    // No synthetic fallback wrestlers (those are "Wrestler N" without rankPoolId).
    const synthetic = npcEntries.filter(e => !e.rankPoolId);
    assert.equal(synthetic.length, 0, 'no synthetic wrestlers when pool is sufficient');
    // All NPC names must be unique (1st + last name dedup still applies).
    const names = npcEntries.map(e => e.name);
    assert.equal(new Set(names).size, names.length, 'no duplicate NPC names in 128-bracket');
  });
});
