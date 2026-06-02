import React, { useMemo, useState, useCallback } from 'react';
import { CARDS } from '../../lib/wrestlingCards.js';
import {
  DECK_SIZE,
  CATEGORY_MINIMUMS,
  TRACKED_CATEGORIES,
  STARTER_DECKS,
  STARTER_KEYS,
  newEmptyDeck,
  cloneStarter,
  validateDeck,
  deckCategoryCounts,
} from '../../lib/deckService.js';

/**
 * Decks screen - list / create / edit / activate user-owned 24-card
 * folkstyle decks. See src/lib/deckService.js for validation rules and
 * starter deck definitions. Save is disabled until validateDeck().ok so
 * bad decks never land in the profile.
 *
 * Props:
 *   profile         - user's wrestler profile (supplies decks + activeDeckId)
 *   onSave(decks, activeDeckId) - persist collection + active selection
 *   onBack          - return to previous screen
 *
 * The component keeps its own draft state (deck list + which one is being
 * edited) and only calls onSave on explicit user action. No auto-save -
 * we don't want a half-edited deck to overwrite Firestore mid-edit.
 */
export default function DecksScreen({ profile, onSave, onBack, allowedCardIds = null }) {
  const initialDecks = useMemo(() => Array.isArray(profile?.decks) ? profile.decks : [], [profile]);
  const [decks, setDecks] = useState(initialDecks);
  const [activeDeckId, setActiveDeckId] = useState(profile?.activeDeckId || null);
  const [editingId, setEditingId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Career mode passes the wrestler's unlockedCardIds. When present, we
  // treat it as a restriction: editor hides locked cards, validator
  // rejects them. Outside career mode it's null and everything is
  // unrestricted (preserving Quick Match deck-building behavior).
  const allowedSet = useMemo(() => {
    if (allowedCardIds instanceof Set) return allowedCardIds;
    if (Array.isArray(allowedCardIds) && allowedCardIds.length > 0) return new Set(allowedCardIds);
    return null;
  }, [allowedCardIds]);
  const restrict = allowedSet && allowedSet.size > 0;

  const editingDeck = decks.find(d => d.id === editingId) || null;
  const validation = editingDeck
    ? validateDeck(editingDeck, { allowedCardIds: allowedSet })
    : { ok: true, errors: [] };

  // When career restrictions are active, figure out which cards in the
  // editing deck are now locked. Happens when a legacy career's saved
  // deck contained cards the player hasn't unlocked under the new gating.
  // We surface a one-line banner nudging the player to swap them out
  // rather than silently mutating their deck.
  const lockedInDeck = useMemo(() => {
    if (!editingDeck || !restrict) return [];
    return editingDeck.cards.filter(cid => !allowedSet.has(cid));
  }, [editingDeck, restrict, allowedSet]);

  const markDirty = () => setDirty(true);

  const handleAddStarter = useCallback((key) => {
    const newDeck = cloneStarter(key);
    setDecks(ds => [...ds, newDeck]);
    setEditingId(newDeck.id);
    markDirty();
  }, []);

  const handleAddEmpty = useCallback(() => {
    const newDeck = newEmptyDeck(`Custom ${decks.length + 1}`);
    setDecks(ds => [...ds, newDeck]);
    setEditingId(newDeck.id);
    markDirty();
  }, [decks.length]);

  const handleDelete = useCallback((id) => {
    setDecks(ds => ds.filter(d => d.id !== id));
    if (activeDeckId === id) setActiveDeckId(null);
    if (editingId === id) setEditingId(null);
    markDirty();
  }, [activeDeckId, editingId]);

  const handleRename = useCallback((id, name) => {
    setDecks(ds => ds.map(d => d.id === id ? { ...d, name: name.slice(0, 40) } : d));
    markDirty();
  }, []);

  const handleToggleCard = useCallback((cardId) => {
    if (!editingDeck) return;
    setDecks(ds => ds.map(d => {
      if (d.id !== editingDeck.id) return d;
      const has = d.cards.includes(cardId);
      if (has) return { ...d, cards: d.cards.filter(c => c !== cardId) };
      if (d.cards.length >= DECK_SIZE) return d; // full - ignore adds
      return { ...d, cards: [...d.cards, cardId] };
    }));
    markDirty();
  }, [editingDeck]);

  const handleSetActive = useCallback((id) => {
    setActiveDeckId(id);
    markDirty();
  }, []);

  const handleSave = useCallback(async () => {
    // Only persist decks that validate. A freshly-created empty deck
    // without cards shouldn't be activatable, but we still keep it so
    // the user doesn't lose their name - they can fill it in later.
    setSaveError('');
    setSaving(true);
    try {
      let res;
      if (activeDeckId) {
        const active = decks.find(d => d.id === activeDeckId);
        if (active && !validateDeck(active, { allowedCardIds: allowedSet }).ok) {
          // Prevent saving an invalid deck as active - clear activation.
          res = await onSave(decks, null);
          setActiveDeckId(null);
        } else {
          res = await onSave(decks, activeDeckId);
        }
      } else {
        res = await onSave(decks, activeDeckId);
      }
      // onSave may return a withTimeout-style { ok, error } result, or
      // (for non-Firestore callers) undefined. Treat undefined as success.
      if (res && res.ok === false) {
        if (res.error === 'timeout') {
          setSaveError('Save timed out. Tap Save to try again.');
        } else {
          setSaveError('Save failed. Tap Save to try again.');
        }
        return;
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [decks, activeDeckId, onSave, allowedSet]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 text-sm font-semibold">
          ← Menu
        </button>
        <div className="text-center">
          <div className="text-amber-400 text-xs font-black uppercase tracking-[0.2em]">Decks</div>
          <div className="text-zinc-500 text-xs">{DECK_SIZE}-card folkstyle · singleton</div>
        </div>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
          {!editingDeck && (
            <>
              <DeckList
                decks={decks}
                activeDeckId={activeDeckId}
                onEdit={setEditingId}
                onDelete={handleDelete}
                onSetActive={handleSetActive}
              />

              <section>
                <label className="text-zinc-400 text-xs font-bold uppercase tracking-wider">Start from Preset</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {STARTER_KEYS.map(key => (
                    <StarterButton
                      key={key}
                      starter={STARTER_DECKS[key]}
                      onClick={() => handleAddStarter(key)}
                    />
                  ))}
                </div>
                <button
                  onClick={handleAddEmpty}
                  className="mt-2 w-full py-2 rounded-lg text-sm font-black bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                >
                  + Empty Deck
                </button>
              </section>
            </>
          )}

          {editingDeck && lockedInDeck.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-3 text-xs text-amber-100">
              <div className="flex items-start gap-2">
                <div className="text-base leading-none">🔒</div>
                <div className="flex-1">
                  <div className="font-bold text-amber-200">
                    {lockedInDeck.length} card{lockedInDeck.length === 1 ? '' : 's'} in this deck {lockedInDeck.length === 1 ? 'is' : 'are'} locked
                  </div>
                  <div className="mt-1 text-amber-200/80 leading-relaxed">
                    Unlock new cards from the <span className="font-semibold text-amber-100">Skill Tree</span> on the Skills tab
                    of your career dashboard. Level up (win matches, place in tournaments, finish seasons) to earn skill points,
                    then spend them on tree nodes that unlock cards.
                  </div>
                  <div className="mt-1 text-amber-300/60 text-[11px]">
                    Until then, remove the locked cards from this deck and swap in unlocked ones - the deck can't be played as-is.
                  </div>
                </div>
              </div>
            </div>
          )}

          {editingDeck && (
            <DeckEditor
              deck={editingDeck}
              validation={validation}
              onRename={(name) => handleRename(editingDeck.id, name)}
              onToggleCard={handleToggleCard}
              onClose={() => setEditingId(null)}
              allowedSet={allowedSet}
            />
          )}
        </div>
      </div>

      {saveError && (
        <div className="px-4 py-2 border-t border-zinc-800 bg-rose-950/40">
          <div className="max-w-lg mx-auto text-rose-200 text-xs font-bold">{saveError}</div>
        </div>
      )}
      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl"
        >
          Back
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 font-black py-3 rounded-xl"
        >
          {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
    </div>
  );
}

function DeckList({ decks, activeDeckId, onEdit, onDelete, onSetActive }) {
  if (decks.length === 0) {
    return (
      <section>
        <label className="text-zinc-400 text-xs font-bold uppercase tracking-wider">Your Decks</label>
        <div className="mt-3 bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-center text-zinc-500 text-sm">
          No decks yet. Clone a preset below to get started.
        </div>
      </section>
    );
  }
  return (
    <section>
      <label className="text-zinc-400 text-xs font-bold uppercase tracking-wider">Your Decks</label>
      <div className="mt-2 space-y-2">
        {decks.map(deck => {
          const v = validateDeck(deck);
          const isActive = deck.id === activeDeckId;
          return (
            <div
              key={deck.id}
              className={`bg-zinc-900 border rounded-xl p-3 ${
                isActive ? 'border-amber-500' : 'border-zinc-800'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-black truncate">{deck.name}</div>
                    {isActive && (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500 text-zinc-950 px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5 text-zinc-500">
                    {deck.cards.length}/{DECK_SIZE} cards
                    {!v.ok && <span className="text-red-400 ml-2">· invalid</span>}
                  </div>
                </div>
                <button
                  onClick={() => onEdit(deck.id)}
                  className="text-xs font-black bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg"
                >
                  Edit
                </button>
                <button
                  onClick={() => onSetActive(deck.id)}
                  disabled={!v.ok || isActive}
                  className="text-xs font-black bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-3 py-1.5 rounded-lg"
                >
                  Use
                </button>
                <button
                  onClick={() => onDelete(deck.id)}
                  className="text-xs font-black bg-red-900/50 hover:bg-red-800 text-red-200 px-3 py-1.5 rounded-lg"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StarterButton({ starter, onClick }) {
  return (
    <button
      onClick={onClick}
      className="p-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-amber-500 text-left"
    >
      <div className="font-black text-sm text-amber-300">{starter.name}</div>
      <div className="text-[10px] mt-0.5 text-zinc-500 leading-tight">{starter.description}</div>
    </button>
  );
}

function DeckEditor({ deck, validation, onRename, onToggleCard, onClose, allowedSet }) {
  const counts = deckCategoryCounts(deck);
  const total = deck.cards.length;
  const selected = useMemo(() => new Set(deck.cards), [deck.cards]);
  const restrict = allowedSet && allowedSet.size > 0;

  // Group CARDS by category for rendering, folkstyle-only. When career
  // gating is active, hide cards the wrestler hasn't unlocked - keeps the
  // editor focused on buildable options.
  const folkCardsByCat = useMemo(() => {
    const out = {};
    for (const [id, c] of Object.entries(CARDS)) {
      if (!(c.styles || []).includes('folkstyle')) continue;
      if (restrict && !allowedSet.has(id)) continue;
      (out[c.category] ||= []).push({ id, ...c });
    }
    for (const cat of Object.keys(out)) {
      out[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }, [restrict, allowedSet]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-sm font-semibold"
        >
          ← Back to Decks
        </button>
      </div>

      <div>
        <label className="text-zinc-400 text-xs font-bold uppercase tracking-wider">Deck Name</label>
        <input
          type="text"
          value={deck.name}
          onChange={(e) => onRename(e.target.value)}
          className="mt-2 w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          placeholder="My Deck"
        />
      </div>

      {(() => {
        // "not yet unlocked" errors are already surfaced by the top
        // banner with context + instructions; repeating them here
        // would just be noise. Only show the red "Validation errors"
        // block for structural issues (deck size, category minimums,
        // duplicates, non-folkstyle).
        const structural = validation.ok
          ? []
          : validation.errors.filter(e => !/ is not yet unlocked\./.test(e));
        const hasStructuralErrors = structural.length > 0;
        // If the only validation problems are locked cards, the deck
        // is "structurally OK" - we still show a neutral ready-state
        // header so the 24/24 count is visible, but skip the red alarm.
        return (
          <div className={`rounded-xl p-3 border ${
            hasStructuralErrors
              ? 'bg-red-900/20 border-red-700/50'
              : validation.ok
                ? 'bg-emerald-900/20 border-emerald-700/50'
                : 'bg-zinc-900/50 border-zinc-700/50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider">
                {hasStructuralErrors
                  ? 'Validation errors'
                  : validation.ok
                    ? 'Valid - ready to use'
                    : 'Deck shape OK - resolve locked cards to play'}
              </div>
              <div className={`text-sm font-black ${total === DECK_SIZE ? 'text-emerald-300' : 'text-amber-300'}`}>
                {total}/{DECK_SIZE}
              </div>
            </div>
            {hasStructuralErrors && (
              <ul className="mt-2 text-xs text-red-200 list-disc pl-5 space-y-0.5">
                {structural.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        );
      })()}

      {/* Category grid - each card a toggleable chip */}
      {TRACKED_CATEGORIES.map(cat => (
        <CategorySection
          key={cat}
          category={cat}
          cards={folkCardsByCat[cat] || []}
          selected={selected}
          current={counts[cat] || 0}
          min={CATEGORY_MINIMUMS[cat]}
          onToggle={onToggleCard}
          total={total}
        />
      ))}
    </section>
  );
}

const CATEGORY_LABELS = {
  neutral_attack: 'Neutral Attack',
  neutral_counter: 'Neutral Counter',
  transition: 'Transition',
  top_turns: 'Top Turns',
  bottom: 'Bottom',
};

function CategorySection({ category, cards, selected, current, min, onToggle, total }) {
  const meetsMin = current >= min;
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-zinc-400 text-xs font-bold uppercase tracking-wider">
          {CATEGORY_LABELS[category] || category}
        </label>
        <div className={`text-xs font-black ${meetsMin ? 'text-emerald-400' : 'text-amber-400'}`}>
          {current} / {min}+
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        {cards.map(card => {
          const isSelected = selected.has(card.id);
          const deckFull = total >= DECK_SIZE && !isSelected;
          return (
            <button
              key={card.id}
              onClick={() => onToggle(card.id)}
              disabled={deckFull}
              className={`p-2 rounded-lg border text-left transition-all ${
                isSelected
                  ? 'bg-amber-500/20 border-amber-500 text-amber-100'
                  : deckFull
                    ? 'bg-zinc-900/60 border-zinc-800 text-zinc-600 cursor-not-allowed'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              <div className="font-black text-xs truncate">{card.name}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                Pwr {card.basePower} · Sta {card.staminaCost}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
