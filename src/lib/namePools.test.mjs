import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MENS_FIRST_NAMES,
  MENS_LAST_NAMES,
  WOMENS_FIRST_NAMES,
  WOMENS_LAST_NAMES,
  WRESTLING_STYLES,
  genderForStyle,
  getNamePools,
  resolveStyle,
  generateEventNames,
} from './namePools.js';

// Deterministic LCG so name-generation tests are reproducible.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const firstOf = (full) => String(full).split(' ')[0];
const lastOf = (full) => String(full).split(' ').slice(1).join(' ');

test('namePools: pools are non-empty arrays', () => {
  for (const pool of [MENS_FIRST_NAMES, MENS_LAST_NAMES, WOMENS_FIRST_NAMES, WOMENS_LAST_NAMES]) {
    assert.ok(Array.isArray(pool) && pool.length > 0);
  }
  // Men's pools must be large enough that a 128-bracket (127 opponents) can
  // get unique first AND last names without the numbered fallback.
  assert.ok(new Set(MENS_FIRST_NAMES).size >= 127, 'enough distinct mens first names for a 128 bracket');
  assert.ok(new Set(MENS_LAST_NAMES).size >= 127, 'enough distinct mens last names for a 128 bracket');
  assert.ok(new Set(WOMENS_FIRST_NAMES).size >= 127, 'enough distinct womens first names for a 128 bracket');
  assert.ok(new Set(WOMENS_LAST_NAMES).size >= 127, 'enough distinct womens last names for a 128 bracket');
});

test('namePools: WOMENS_LAST_NAMES is a superset of MENS_LAST_NAMES', () => {
  const womens = new Set(WOMENS_LAST_NAMES);
  for (const last of MENS_LAST_NAMES) assert.ok(womens.has(last));
});

test('genderForStyle: only womens_freestyle maps to female', () => {
  assert.equal(genderForStyle('womens_freestyle'), 'female');
  assert.equal(genderForStyle('folkstyle'), 'male');
  assert.equal(genderForStyle('freestyle'), 'male');
  assert.equal(genderForStyle('greco'), 'male');
  assert.equal(genderForStyle(undefined), 'male');
  assert.equal(genderForStyle('nonsense'), 'male');
});

test('getNamePools: female -> womens pools, male -> mens pools (by identity)', () => {
  const f = getNamePools('female');
  assert.equal(f.firsts, WOMENS_FIRST_NAMES);
  assert.equal(f.lasts, WOMENS_LAST_NAMES);
  const m = getNamePools('male');
  assert.equal(m.firsts, MENS_FIRST_NAMES);
  assert.equal(m.lasts, MENS_LAST_NAMES);
  // Anything that isn't 'female' falls back to the men's pools.
  assert.equal(getNamePools(undefined).firsts, MENS_FIRST_NAMES);
});

test('WRESTLING_STYLES contains the four supported styles incl. womens_freestyle', () => {
  for (const id of ['folkstyle', 'freestyle', 'greco', 'womens_freestyle']) {
    assert.ok(WRESTLING_STYLES.some(s => s.id === id), `missing style ${id}`);
  }
});

test('resolveStyle: explicit event > career/save > stored default > folkstyle', () => {
  assert.equal(resolveStyle({ eventStyle: 'greco', careerStyle: 'freestyle', storedDefault: 'folkstyle' }), 'greco');
  assert.equal(resolveStyle({ careerStyle: 'freestyle', storedDefault: 'folkstyle' }), 'freestyle');
  assert.equal(resolveStyle({ storedDefault: 'womens_freestyle' }), 'womens_freestyle');
  assert.equal(resolveStyle({}), 'folkstyle');
  assert.equal(resolveStyle(), 'folkstyle');
});

test('generateEventNames: returns exactly `count` strings', () => {
  const names = generateEventNames({ count: 8, rng: seededRng(1) });
  assert.equal(names.length, 8);
  for (const n of names) assert.equal(typeof n, 'string');
  assert.deepEqual(generateEventNames({ count: 0 }), []);
});

test('generateEventNames: no duplicate full names within a batch', () => {
  for (const size of [8, 16, 32, 64, 128]) {
    const names = generateEventNames({ count: size, rng: seededRng(size * 7 + 1) });
    assert.equal(new Set(names).size, size, `size ${size} had a duplicate full name`);
  }
});

test('generateEventNames: enforceUniqueFirstLast bounds first AND last names to one each', () => {
  for (const size of [8, 16, 32, 64, 128]) {
    const names = generateEventNames({ count: size, rng: seededRng(size + 99) });
    const firsts = names.map(firstOf);
    const lasts = names.map(lastOf);
    assert.equal(new Set(firsts).size, size, `size ${size} repeated a first name`);
    assert.equal(new Set(lasts).size, size, `size ${size} repeated a last name`);
  }
});

test('generateEventNames: 8/16/32/64/128 events never hit the Wrestler N fallback', () => {
  for (const gender of ['male', 'female']) {
    for (const size of [8, 16, 32, 64, 128]) {
      const names = generateEventNames({ count: size, gender, rng: seededRng(size * 13 + 5) });
      const fallback = names.filter(n => /^Wrestler \d+$/.test(n));
      assert.equal(fallback.length, 0, `${gender} size ${size} fell back to Wrestler N`);
    }
  }
});

test('generateEventNames: reserved names are never produced', () => {
  const reserved = new Set(['Chase Kamats', 'Valerie Aikens']);
  const names = generateEventNames({ count: 120, reserved, rng: seededRng(404) });
  for (const r of reserved) assert.ok(!names.includes(r), `produced reserved name ${r}`);
});

test('generateEventNames: honors and mutates the passed `used` set', () => {
  const used = new Set(['Player One']);
  const names = generateEventNames({ count: 10, used, rng: seededRng(7) });
  assert.ok(!names.includes('Player One'));
  // The player name plus 10 generated names are all now tracked.
  assert.equal(used.size, 11);
  for (const n of names) assert.ok(used.has(n));
});

test('generateEventNames: pool exhaustion does not throw and still returns `count` unique names', () => {
  // Far more names than the distinct firsts*lasts combos -> forces the
  // deterministic Tier 2 scan and then the Tier 3 numbered fallback.
  const huge = MENS_FIRST_NAMES.length * MENS_LAST_NAMES.length + 50;
  const names = generateEventNames({ count: huge, rng: seededRng(2), enforceUniqueFirstLast: false });
  assert.equal(names.length, huge);
  assert.equal(new Set(names).size, huge, 'all names unique even past namespace exhaustion');
  assert.ok(names.some(n => /^Wrestler \d+$/.test(n)), 'numbered fallback engaged past exhaustion');
});

test('generateEventNames: enforceUniqueFirstLast=false still dedupes full names past the first-name pool size', () => {
  const count = MENS_FIRST_NAMES.length + 200;
  const names = generateEventNames({
    count,
    rng: seededRng(55),
    enforceUniqueFirstLast: false,
  });
  assert.equal(names.length, count);
  assert.equal(new Set(names).size, count, 'full names unique even when first names must repeat');
});

test('generateEventNames: deterministic under a seeded rng', () => {
  const a = generateEventNames({ count: 30, rng: seededRng(123) });
  const b = generateEventNames({ count: 30, rng: seededRng(123) });
  assert.deepEqual(a, b);
});

test("generateEventNames: female gender draws from the women's pool, never male-exclusive names", () => {
  // Prove the female PATH is used - not just that some text looks female.
  // Any first name exclusive to the men's pool appearing in female output
  // would mean the male pool leaked in.
  const womensFirst = new Set(WOMENS_FIRST_NAMES);
  const maleExclusiveFirst = MENS_FIRST_NAMES.filter(n => !womensFirst.has(n));
  assert.ok(maleExclusiveFirst.length > 0, 'sanity: men/women first pools differ');
  const maleExclusiveSet = new Set(maleExclusiveFirst);

  const names = generateEventNames({ count: 128, gender: 'female', rng: seededRng(8) });
  for (const n of names) {
    assert.ok(womensFirst.has(firstOf(n)), `first name ${firstOf(n)} not in womens pool`);
    assert.ok(!maleExclusiveSet.has(firstOf(n)), `male-exclusive name ${firstOf(n)} leaked into female output`);
  }
  // And at least one female-exclusive first name actually shows up.
  const womensFirstArr = WOMENS_FIRST_NAMES.filter(n => !new Set(MENS_FIRST_NAMES).has(n));
  const femaleExclusive = new Set(womensFirstArr);
  assert.ok(names.some(n => femaleExclusive.has(firstOf(n))), 'no female-exclusive name appeared');
});
