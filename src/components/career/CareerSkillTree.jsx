// ─── CareerSkillTree (modal UI) ─────────────────────────────────────────────
// Tab-based mobile UI. One branch visible at a time, tiers stacked vertically
// in a single column with full-width tiles. Tap a tile to see its detail in
// the bottom action panel; tap Unlock to spend.
//
// Branches: Scrambler · Rider · Technician · Gasser. Each branch shows
// unlocked-count progress in its tab. Locked tiles show what blocks them.

import React, { useMemo, useState } from 'react';
import {
  SKILL_TREE_NODES,
  BRANCHES,
  getNode,
  getNodesByBranch,
  isNodeUnlocked,
  canUnlockNode,
  tryUnlockNode,
} from '../../lib/career/careerSkillTree.js';
import { CARDS } from '../../lib/wrestlingCards.js';

const BRANCH_LABEL = {
  scrambler: 'Scrambler',
  rider:     'Rider',
  technician:'Technician',
  gasser:    'Gasser',
};

const BRANCH_BLURB = {
  scrambler:  'Counters, scrambles, and slick attacks.',
  rider:      'Top-position control and ride-time.',
  technician: 'Setups, attacks, and finishes.',
  gasser:     'Conditioning, pace, and 3rd-period grit.',
};

const BRANCH_ACCENT = {
  scrambler:  { text: 'text-emerald-300', border: 'border-emerald-700/60', bg: 'bg-emerald-950/30', solidBg: 'bg-emerald-700', dotBg: 'bg-emerald-500' },
  rider:      { text: 'text-amber-300',   border: 'border-amber-700/60',   bg: 'bg-amber-950/30',   solidBg: 'bg-amber-700',   dotBg: 'bg-amber-500' },
  technician: { text: 'text-purple-300',  border: 'border-purple-700/60',  bg: 'bg-purple-950/30',  solidBg: 'bg-purple-700',  dotBg: 'bg-purple-500' },
  gasser:     { text: 'text-sky-300',     border: 'border-sky-700/60',     bg: 'bg-sky-950/30',     solidBg: 'bg-sky-700',     dotBg: 'bg-sky-500' },
};

function StateBadge({ state, cost }) {
  if (state === 'owned') {
    return (
      <span className="text-[10px] uppercase tracking-wider font-bold bg-emerald-900/60 text-emerald-300 border border-emerald-700 rounded px-1.5 py-0.5">
        ✓ Owned
      </span>
    );
  }
  if (state === 'available') {
    return (
      <span className="text-[10px] uppercase tracking-wider font-bold bg-zinc-800 text-zinc-100 border border-zinc-600 rounded px-1.5 py-0.5">
        {cost} pt{cost !== 1 ? 's' : ''}
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wider font-bold bg-zinc-900 text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">
      🔒 {cost}p
    </span>
  );
}

function NodeTile({ node, state, lockReason, onSelect, selected, accent }) {
  const cardNames = (node.unlocks || [])
    .map(id => CARDS[id]?.name)
    .filter(Boolean);

  let cls = 'border-zinc-800 bg-zinc-900/60';
  let textCls = 'text-zinc-200';
  if (state === 'owned') {
    cls = `${accent.border} ${accent.bg}`;
    textCls = accent.text;
  } else if (state === 'available') {
    cls = 'border-zinc-600 bg-zinc-900';
    textCls = 'text-zinc-100';
  } else {
    cls = 'border-zinc-900 bg-zinc-950';
    textCls = 'text-zinc-500';
  }
  const ring = selected ? 'ring-2 ring-emerald-500' : '';

  return (
    <button
      onClick={() => onSelect(node.id)}
      className={`w-full text-left rounded-xl border-2 p-3 transition active:scale-[0.99] ${cls} ${ring}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-bold ${textCls}`}>{node.label}</div>
          {cardNames.length > 0 && (
            <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
              Unlocks: {cardNames.join(' · ')}
            </div>
          )}
          {state === 'locked' && lockReason && (
            <div className="text-[11px] text-amber-500/80 mt-1">{lockReason}</div>
          )}
        </div>
        <StateBadge state={state} cost={node.cost} />
      </div>
    </button>
  );
}

function lockReasonLabel(reason, prereqLabels) {
  switch (reason) {
    case 'not_enough_points': return 'Need more skill points';
    case 'prereq_missing':    return prereqLabels?.length
      ? `Requires: ${prereqLabels.join(', ')}`
      : 'Prereq missing';
    case 'unknown_node':      return '';
    case 'already_unlocked':  return '';
    default:                  return '';
  }
}

function BranchView({ branch, wrestler, selectedId, onSelect }) {
  const accent = BRANCH_ACCENT[branch];
  const nodes = getNodesByBranch(branch);
  // Group by tier for neat row alignment.
  const byTier = nodes.reduce((acc, n) => {
    (acc[n.tier] = acc[n.tier] || []).push(n);
    return acc;
  }, {});
  const tiers = Object.keys(byTier).sort((a, b) => Number(a) - Number(b));

  return (
    <div>
      <div className={`rounded-xl border-2 ${accent.border} ${accent.bg} p-3 mb-4`}>
        <div className={`text-base font-bold ${accent.text}`}>{BRANCH_LABEL[branch]}</div>
        <div className="text-xs text-zinc-400 mt-0.5">{BRANCH_BLURB[branch]}</div>
      </div>

      <div className="space-y-4">
        {tiers.map((tier, ti) => (
          <div key={tier}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`h-1 w-8 rounded ${accent.dotBg}`} />
              <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">
                Tier {tier}
              </div>
            </div>
            <div className="space-y-2">
              {byTier[tier].map(node => {
                const owned = isNodeUnlocked(wrestler, node.id);
                const check = canUnlockNode(wrestler, node.id);
                const state = owned ? 'owned' : check.ok ? 'available' : 'locked';
                const prereqLabels = (node.requires || [])
                  .filter(id => !isNodeUnlocked(wrestler, id))
                  .map(id => getNode(id)?.label || id);
                return (
                  <NodeTile
                    key={node.id}
                    node={node}
                    state={state}
                    lockReason={lockReasonLabel(check.reason, prereqLabels)}
                    accent={accent}
                    onSelect={onSelect}
                    selected={selectedId === node.id}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.wrestler      career.wrestler
 * @param {(next: object) => void} props.onChange   called with updated wrestler
 * @param {() => void} props.onClose
 */
export default function CareerSkillTree({ wrestler, onChange, onClose }) {
  const [activeBranch, setActiveBranch] = useState(BRANCHES[0]);
  const [selectedId, setSelectedId] = useState(null);
  const [flash, setFlash] = useState(null);

  const selected = selectedId ? getNode(selectedId) : null;
  const check = selected ? canUnlockNode(wrestler, selectedId) : null;

  const summary = useMemo(() => {
    const owned = (wrestler?.skillTree?.unlockedNodes || []).length;
    const total = SKILL_TREE_NODES.length;
    return { owned, total };
  }, [wrestler?.skillTree?.unlockedNodes]);

  // Per-branch unlocked counts for the tab badges.
  // Narrow-key tracking: only re-memo when unlockedNodes changes; full wrestler
  // would re-fire on every stat tick during career progression.
  const branchProgress = useMemo(() => {
    const out = {};
    for (const b of BRANCHES) {
      const nodes = getNodesByBranch(b);
      const owned = nodes.filter(n => isNodeUnlocked(wrestler, n.id)).length;
      out[b] = { owned, total: nodes.length };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrestler?.skillTree?.unlockedNodes]);

  function handlePurchase() {
    if (!selectedId) return;
    const out = tryUnlockNode(wrestler, selectedId);
    if (out.ok) {
      onChange?.(out.wrestler);
      setFlash({ kind: 'ok', label: selected.label });
      setSelectedId(null);
    } else {
      setFlash({ kind: 'err', reason: out.reason });
    }
    setTimeout(() => setFlash(null), 1800);
  }

  const pts = wrestler?.skillTree?.pointsAvailable || 0;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      {/* Header */}
      <div
        className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between flex-shrink-0"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-zinc-500">Skill Tree</div>
          <div className="text-base font-bold text-zinc-100 truncate">
            {summary.owned} / {summary.total} unlocked
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Points</div>
            <div className={`text-lg font-bold ${pts > 0 ? 'text-emerald-300' : 'text-zinc-600'}`}>{pts}</div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 text-sm active:scale-95 transition"
          >
            Close
          </button>
        </div>
      </div>

      {/* Branch tabs */}
      <div className="flex border-b border-zinc-800 flex-shrink-0 overflow-x-auto">
        {BRANCHES.map(b => {
          const accent = BRANCH_ACCENT[b];
          const prog = branchProgress[b];
          const isActive = activeBranch === b;
          return (
            <button
              key={b}
              onClick={() => { setActiveBranch(b); setSelectedId(null); }}
              className={`flex-1 min-w-[80px] py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                isActive
                  ? `${accent.text} border-current`
                  : 'text-zinc-500 border-transparent hover:text-zinc-300'
              }`}
            >
              <div className="truncate">{BRANCH_LABEL[b]}</div>
              <div className="text-[9px] font-normal mt-0.5 text-zinc-500">
                {prog.owned}/{prog.total}
              </div>
            </button>
          );
        })}
      </div>

      {/* Active branch */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full">
        <BranchView
          branch={activeBranch}
          wrestler={wrestler}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Confirmation strip */}
      {selected && (
        <div className="border-t border-zinc-800 bg-zinc-950 p-4 flex-shrink-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="max-w-md mx-auto">
            <div className="text-sm text-zinc-200 font-bold">{selected.label}</div>
            {selected.description && (
              <div className="text-xs text-zinc-400 mt-1">{selected.description}</div>
            )}
            {selected.unlocks?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {selected.unlocks.map(cid => (
                  <span key={cid} className="text-[10px] bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-zinc-300">
                    {CARDS[cid]?.name || cid}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={handlePurchase}
                disabled={!check?.ok}
                className="flex-1 py-3 rounded-lg bg-emerald-700 text-white font-semibold active:scale-95 transition disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {check?.ok
                  ? `Unlock · ${selected.cost} pt${selected.cost !== 1 ? 's' : ''}`
                  : reasonLabel(check?.reason)}
              </button>
              <button
                onClick={() => setSelectedId(null)}
                className="px-4 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 text-sm active:scale-95 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {flash && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-bold z-[60] shadow-lg ${
          flash.kind === 'ok'
            ? 'bg-emerald-700 text-white'
            : 'bg-red-700 text-white'
        }`}>
          {flash.kind === 'ok' ? `Unlocked: ${flash.label}` : reasonLabel(flash.reason)}
        </div>
      )}
    </div>
  );
}

function reasonLabel(reason) {
  switch (reason) {
    case 'already_unlocked': return 'Already unlocked';
    case 'not_enough_points': return 'Not enough points';
    case 'prereq_missing': return 'Unlock a Tier 1 first';
    case 'unknown_node': return 'Unknown node';
    default: return 'Cannot unlock';
  }
}
