// ─── CareerSlotPicker ───────────────────────────────────────────────────────
// 3 stacked career slots. Filled slot tap → switch to that career. Empty
// slot tap → start a new career in that slot. Long-press a filled slot to
// retire/clear it (asks for confirmation).

import React, { useEffect, useMemo, useState } from 'react';
import NavBar from '../ui/NavBar.jsx';
import { getCareerForSlot, getOrphanedCareers } from '../../lib/firestoreService.js';
import { hydrateCareer } from '../../lib/career/careerState.js';

const TIER_LABEL = { hs: 'HS', college: 'College', senior: 'Senior Intl' };

function SlotCard({ slot, summary, isActive, onTap, onLongPress }) {
  const longPressRef = React.useRef(null);

  const startPress = () => {
    if (!summary || !onLongPress) return;
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null;
      onLongPress();
    }, 600);
  };
  const cancelPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  if (!summary) {
    return (
      <button
        onClick={onTap}
        className="w-full rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/30 p-5 text-center hover:border-emerald-700 hover:bg-emerald-950/20 active:scale-[0.98] transition"
      >
        <div className="text-zinc-500 text-sm">+ New Career</div>
        <div className="text-[10px] text-zinc-600 mt-1 uppercase tracking-wider">{slot.slotId}</div>
      </button>
    );
  }

  const w = summary.wrestler;
  const r = summary.record || {};
  return (
    <button
      onClick={onTap}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => { e.preventDefault(); onLongPress?.(); }}
      className={`w-full text-left rounded-2xl border-2 p-4 active:scale-[0.99] transition ${
        isActive
          ? 'border-emerald-600 bg-emerald-950/30'
          : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className="text-base font-bold text-zinc-100 truncate">{w?.name || 'Wrestler'}</div>
            {isActive && (
              <span className="text-[9px] uppercase tracking-wider bg-emerald-900/60 text-emerald-200 border border-emerald-700 rounded px-1.5 py-px">
                Active
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">
            {TIER_LABEL[w?.tier] || 'HS'} Year {w?.year || 1} · {w?.weightClass || '-'} lbs
            {w?.state && <> · {w.state}</>}
          </div>
        </div>
        <div className="text-right text-[10px] text-zinc-500 flex-shrink-0">
          {slot.slotId.replace('slot', 'Slot ')}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs">
        <div>
          <span className="text-emerald-400 font-bold">{r.careerWins ?? 0}</span>
          <span className="text-zinc-600">-</span>
          <span className="text-red-400 font-bold">{r.careerLosses ?? 0}</span>
          <span className="text-zinc-500 ml-1">career</span>
        </div>
        <div className="text-zinc-500">·</div>
        <div className="text-amber-300">
          {r.titles?.length || 0} title{(r.titles?.length || 0) === 1 ? '' : 's'}
        </div>
        <div className="text-zinc-500">·</div>
        <div className="text-zinc-300">Lvl {w?.level || 1}</div>
      </div>
    </button>
  );
}

export default function CareerSlotPicker({
  uid,
  slots,
  slotsLoaded = true,  // parent has finished its initial getCareerSlots fetch
  activeCareerId,
  onSelectCareer,    // (career) => switch to this career
  onCreateInSlot,    // (slotId) => route to creation wizard with this slot
  onClearSlot,       // (slotId) => long-press to retire and free slot
  onRestoreCareer,   // (careerId) => re-attach orphaned career to first empty slot
  onBack,
}) {
  const [summaries, setSummaries] = useState({});
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [orphans, setOrphans] = useState([]);
  const [orphansLoading, setOrphansLoading] = useState(false);

  const hasEmptySlot = slots.some(s => !s.careerId);

  const openRestore = async () => {
    if (!uid) return;
    setRestoreOpen(true);
    setOrphansLoading(true);
    try {
      const found = await getOrphanedCareers(uid);
      setOrphans(found.map(c => hydrateCareer(c)));
    } finally {
      setOrphansLoading(false);
    }
  };

  // Memoized shape-stamp of the slots array. Re-fires the fetch effect only
  // when a careerId actually changes, not on every parent re-render's new
  // `slots` identity. Extracted out of the dep array so the linter can verify
  // the dependency statically (inline `slots.map(...).join(...)` triggers the
  // react-hooks/exhaustive-deps "complex expression" warning).
  const slotsKey = useMemo(
    () => slots.map(s => s.careerId || '').join(','),
    [slots]
  );

  // Wait until the parent has loaded the slot list from Firestore before
  // fetching individual career docs. Otherwise we'd fire one fetch on the
  // initial empty state and another after slots arrive, and the empty cards
  // would flash on screen.
  //
  // `slots` is intentionally tracked via `slotsKey` (above) to avoid re-running
  // on identity-only changes; the linter can't see that equivalence so we
  // suppress the missing-dep warning explicitly.
  useEffect(() => {
    if (!slotsLoaded) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const s of slots) {
        if (!s.careerId) continue;
        const c = await getCareerForSlot(uid, s);
        if (cancelled) return;
        if (c) map[s.slotId] = hydrateCareer(c);
      }
      if (!cancelled) {
        setSummaries(map);
        setSummariesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, slotsLoaded, slotsKey]);

  const loading = !slotsLoaded || summariesLoading;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Career Slots" onBack={onBack} />
      <div className="flex-1 px-4 py-5 max-w-md mx-auto w-full">
        <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Pick a career</div>
        <div className="text-[11px] text-zinc-600 mb-4">
          Up to 3 careers per account. Tap to switch · long-press a slot to retire it.
        </div>

        {loading && (
          <div className="text-zinc-500 text-sm text-center py-8">Loading…</div>
        )}

        {!loading && (
          <div className="space-y-3">
            {slots.map(s => (
              <SlotCard
                key={s.slotId}
                slot={s}
                summary={summaries[s.slotId] || null}
                isActive={!!summaries[s.slotId] && summaries[s.slotId].id === activeCareerId}
                onTap={() => {
                  const c = summaries[s.slotId];
                  if (c) onSelectCareer?.(c);
                  else onCreateInSlot?.(s.slotId);
                }}
                onLongPress={() => {
                  if (summaries[s.slotId]) setConfirmClear(s);
                }}
              />
            ))}
          </div>
        )}

        {!loading && hasEmptySlot && (
          // audit-allow: guarded-early-return - uid is gated by parent loading + hasEmptySlot conditions
          <button
            onClick={openRestore}
            className="mt-4 w-full text-center text-xs text-zinc-400 hover:text-emerald-300 underline underline-offset-4 decoration-dotted py-2"
          >
            Restore a previous career
          </button>
        )}
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-red-800/60 bg-zinc-950 p-5">
            <div className="text-red-300 text-xs font-black uppercase tracking-[0.2em] mb-2">⚠ Retire Career</div>
            <div className="text-white font-bold text-lg mb-1 break-words">
              Retire {summaries[confirmClear.slotId]?.wrestler?.name || 'this wrestler'}?
            </div>
            <div className="text-zinc-400 text-sm mb-4">
              The slot frees up so you can start a new career here. The retired wrestler is preserved in your Hall of Fame.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmClear(null)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const slotId = confirmClear.slotId;
                  setConfirmClear(null);
                  onClearSlot?.(slotId);
                }}
                className="flex-1 py-3 rounded-lg bg-red-700 hover:bg-red-600 text-white font-black"
              >
                Retire
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full max-h-[85vh] flex flex-col rounded-2xl border border-emerald-800/60 bg-zinc-950 p-5">
            <div className="text-emerald-300 text-xs font-black uppercase tracking-[0.2em] mb-2">↺ Restore Career</div>
            <div className="text-white font-bold text-lg mb-1">Previous Careers</div>
            <div className="text-zinc-400 text-sm mb-4">
              Tap one to attach it to your first empty slot. The career is restored exactly as you left it.
            </div>

            <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
              {orphansLoading && (
                <div className="text-zinc-500 text-sm text-center py-6">Loading…</div>
              )}
              {!orphansLoading && orphans.length === 0 && (
                <div className="text-zinc-500 text-sm text-center py-6">
                  No previous careers to restore.
                </div>
              )}
              {!orphansLoading && orphans.map(c => {
                const w = c.wrestler;
                const r = c.record || {};
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setRestoreOpen(false);
                      onRestoreCareer?.(c.id);
                    }}
                    className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-900/60 hover:border-emerald-700 hover:bg-emerald-950/20 p-3 active:scale-[0.99] transition"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-bold text-zinc-100 truncate">{w?.name || 'Wrestler'}</div>
                      <div className="text-[10px] text-zinc-500 flex-shrink-0">
                        {c.phase === 'retired' ? 'Retired' : 'Saved'}
                      </div>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {TIER_LABEL[w?.tier] || 'HS'} Year {w?.year || 1} · {w?.weightClass || '-'} lbs
                      {w?.state && <> · {w.state}</>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                      <span className="text-emerald-400 font-bold">{r.careerWins ?? 0}</span>
                      <span className="text-zinc-600">-</span>
                      <span className="text-red-400 font-bold">{r.careerLosses ?? 0}</span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-amber-300">
                        {r.titles?.length || 0} title{(r.titles?.length || 0) === 1 ? '' : 's'}
                      </span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-zinc-300">Lvl {w?.level || 1}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setRestoreOpen(false)}
              className="mt-4 w-full py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
