// Unit tests for Deck Builder - validateDeck rules, starter integrity,
// deckToCardIdSet correctness.
// Run with: node --test src/lib/deckService.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  DECK_SIZE,
  CATEGORY_MINIMUMS,
  STARTER_DECKS,
  STARTER_KEYS,
  validateDeck,
  deckCategoryCounts,
  deckCardCount,
  deckToCardIdSet,
  newEmptyDeck,
  cloneStarter,
} = await import('./deckService.js');

const { CARDS } = await import('./wrestlingCards.js');

// Tiny helper - picks N folkstyle card ids from a given category.
function pickFolkFromCategory(cat, n) {
  const out = [];
  for (const [id, c] of Object.entries(CARDS)) {
    if (c.category !== cat) continue;
    if (!(c.styles || []).includes('folkstyle')) continue;
    if (!out.includes(id)) out.push(id);
    if (out.length === n) break;
  }
  return out;
}

// Assemble a minimally-valid 24-card folkstyle deck programmatically.
function buildValidDeck(name = 'TestDeck') {
  const cards = [];
  for (const [cat, min] of Object.entries(CATEGORY_MINIMUMS)) {
    cards.push(...pickFolkFromCategory(cat, min));
  }
  // Top off to 24 with any remaining folkstyle cards.
  const have = new Set(cards);
  for (const [id, c] of Object.entries(CARDS)) {
    if (cards.length >= DECK_SIZE) break;
    if (have.has(id)) continue;
    if (!(c.styles || []).includes('folkstyle')) continue;
    cards.push(id);
    have.add(id);
  }
  return { id: 'd_test', name, cards };
}

// ─── happy path ────────────────────────────────────────────────────────

test('validateDeck accepts a valid folkstyle deck', () => {
  const deck = buildValidDeck();
  const result = validateDeck(deck);
  assert.equal(result.ok, true, `errors: ${result.errors.join(', ')}`);
  assert.deepEqual(result.errors, []);
});

test('all three starter decks pass validateDeck', () => {
  for (const key of STARTER_KEYS) {
    const preset = STARTER_DECKS[key];
    const deck = { id: key, name: preset.name, cards: preset.cards };
    const result = validateDeck(deck);
    assert.equal(
      result.ok,
      true,
      `starter "${key}" failed: ${result.errors.join('; ')}`,
    );
  }
});

// ─── failure cases ─────────────────────────────────────────────────────

test('validateDeck rejects null / non-object', () => {
  assert.equal(validateDeck(null).ok, false);
  assert.equal(validateDeck(undefined).ok, false);
  assert.equal(validateDeck('nope').ok, false);
});

test('validateDeck rejects missing name', () => {
  const deck = buildValidDeck('');
  const result = validateDeck(deck);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /name/i.test(e)));
});

test('validateDeck rejects wrong size', () => {
  const deck = buildValidDeck();
  deck.cards = deck.cards.slice(0, 23);
  const result = validateDeck(deck);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /exactly 24/i.test(e)));
});

test('validateDeck rejects unknown card ids', () => {
  const deck = buildValidDeck();
  deck.cards[0] = 'not_a_real_card';
  const result = validateDeck(deck);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /unknown/i.test(e)));
});

test('validateDeck rejects duplicates (singleton rule)', () => {
  const deck = buildValidDeck();
  deck.cards[1] = deck.cards[0];
  const result = validateDeck(deck);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /duplicate/i.test(e)));
});

test('validateDeck rejects decks below a category minimum', () => {
  const deck = buildValidDeck();
  // Replace all neutral_attack cards with extra transitions - breaks the min.
  const trans = pickFolkFromCategory('transition', 10);
  const filtered = deck.cards.filter(id => CARDS[id].category !== 'neutral_attack');
  const extras = trans.filter(id => !filtered.includes(id))
    .slice(0, DECK_SIZE - filtered.length);
  deck.cards = [...filtered, ...extras];
  // Pad to 24 with bottom cards if still short.
  if (deck.cards.length < DECK_SIZE) {
    const pad = pickFolkFromCategory('bottom', 20)
      .filter(id => !deck.cards.includes(id));
    deck.cards = deck.cards.concat(pad).slice(0, DECK_SIZE);
  }
  const result = validateDeck(deck);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /neutral attack/i.test(e)));
});

// ─── allowedCardIds (career-mode gating) ───────────────────────────────

test('validateDeck with allowedCardIds accepts a deck whose cards are all unlocked', () => {
  const deck = buildValidDeck();
  const allowed = new Set(deck.cards);
  const result = validateDeck(deck, { allowedCardIds: allowed });
  assert.equal(result.ok, true, `errors: ${result.errors.join(', ')}`);
});

test('validateDeck with allowedCardIds rejects a locked card', () => {
  const deck = buildValidDeck();
  // Allow everything except the first card.
  const allowed = new Set(deck.cards.slice(1));
  const result = validateDeck(deck, { allowedCardIds: allowed });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /not yet unlocked/i.test(e)),
    `expected unlock error, got: ${result.errors.join(', ')}`);
});

test('validateDeck ignores allowedCardIds when null / undefined / empty Set', () => {
  const deck = buildValidDeck();
  assert.equal(validateDeck(deck).ok, true);
  assert.equal(validateDeck(deck, {}).ok, true);
  assert.equal(validateDeck(deck, { allowedCardIds: null }).ok, true);
  // Empty Set is treated as "unrestricted" (don't lock a user out of their own deck)
  assert.equal(validateDeck(deck, { allowedCardIds: new Set() }).ok, true);
});

test('validateDeck rejects non-folkstyle cards', () => {
  // Find a card that does NOT list folkstyle.
  let nonFolk = null;
  for (const [id, c] of Object.entries(CARDS)) {
    if (!(c.styles || []).includes('folkstyle')) { nonFolk = id; break; }
  }
  if (!nonFolk) return; // nothing to assert; all cards are folkstyle
  const deck = buildValidDeck();
  deck.cards[0] = nonFolk;
  const result = validateDeck(deck);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /folkstyle/i.test(e)));
});

// ─── helpers ───────────────────────────────────────────────────────────

test('deckCardCount returns cards.length or 0', () => {
  assert.equal(deckCardCount(null), 0);
  assert.equal(deckCardCount({}), 0);
  assert.equal(deckCardCount({ cards: ['a', 'b', 'c'] }), 3);
});

test('deckToCardIdSet returns the card ids as a Set', () => {
  const deck = { cards: ['a', 'b', 'c'] };
  const set = deckToCardIdSet(deck);
  assert.ok(set instanceof Set);
  assert.equal(set.size, 3);
  assert.ok(set.has('a'));
  assert.ok(set.has('b'));
  assert.ok(set.has('c'));
});

test('deckToCardIdSet handles malformed input', () => {
  assert.equal(deckToCardIdSet(null).size, 0);
  assert.equal(deckToCardIdSet({}).size, 0);
});

test('deckCategoryCounts tallies correctly and ignores unknown ids', () => {
  const deck = STARTER_DECKS.scrambler;
  const counts = deckCategoryCounts({ cards: deck.cards });
  for (const [cat, min] of Object.entries(CATEGORY_MINIMUMS)) {
    assert.ok((counts[cat] || 0) >= min, `starter short on ${cat}: ${counts[cat]}`);
  }
});

test('newEmptyDeck produces a fresh skeleton', () => {
  const a = newEmptyDeck('Alpha');
  const b = newEmptyDeck('Beta');
  assert.equal(a.name, 'Alpha');
  assert.equal(a.cards.length, 0);
  assert.notEqual(a.id, b.id, 'each deck gets a unique id');
});

test('cloneStarter returns a deep-ish copy with fresh id', () => {
  const clone = cloneStarter('scrambler', 'My Scrambler');
  assert.equal(clone.name, 'My Scrambler');
  assert.equal(clone.cards.length, DECK_SIZE);
  assert.notEqual(clone.id, 'scrambler');
  // Mutating the clone must not affect the preset.
  clone.cards.push('double_leg');
  assert.equal(STARTER_DECKS.scrambler.cards.length, DECK_SIZE);
});

test('cloneStarter throws on unknown key', () => {
  assert.throws(() => cloneStarter('not_a_deck'), /unknown starter/i);
});
