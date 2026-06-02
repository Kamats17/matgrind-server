// ─── CareerDecisionScreen ───────────────────────────────────────────────────
// Modal shown when career.pendingDecision is set. Two choice cards;
// tap one to apply its effect via applyDecisionChoice. Risk effects
// resolve at apply time (so the result is shown after the tap).

import React, { useState } from 'react';
import NavBar from '../ui/NavBar.jsx';
import { applyDecisionChoice } from '../../lib/career/careerDecisions.js';

export default function CareerDecisionScreen({ career, decision, onResolve, onDefer }) {
  const [resolved, setResolved] = useState(null);

  if (!decision) {
    onDefer?.();
    return null;
  }

  function pick(choiceId) {
    const out = applyDecisionChoice(career, decision, choiceId);
    setResolved({ applied: out.applied, choiceId });
    // Brief delay so the user sees the outcome before the modal dismisses.
    setTimeout(() => {
      onResolve?.(out.career);
    }, 1400);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Decision" onBack={onDefer} />
      <div className="flex-1 px-4 py-5 max-w-md mx-auto w-full">
        <div className="text-xs uppercase tracking-widest text-emerald-400 mb-2">
          Between Events
        </div>
        <div className="text-2xl font-bold text-zinc-100 leading-tight mb-2">
          {decision.headline}
        </div>
        <div className="text-sm text-zinc-400 leading-relaxed mb-5">
          {decision.flavor}
        </div>

        <div className="space-y-3">
          {decision.choices.map(c => {
            const isPicked = resolved?.choiceId === c.id;
            const isDimmed = resolved && !isPicked;
            return (
              <button
                key={c.id}
                onClick={() => !resolved && pick(c.id)}
                disabled={!!resolved}
                className={`w-full text-left rounded-xl border-2 p-4 transition active:scale-[0.99] ${
                  isPicked
                    ? 'border-emerald-500 bg-emerald-950/40'
                    : isDimmed
                      ? 'border-zinc-800 bg-zinc-900/30 opacity-50'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-emerald-700'
                }`}
              >
                <div className="text-sm font-bold text-zinc-100">{c.label}</div>
                <div className="text-xs text-emerald-400 mt-1 font-semibold">{c.detail}</div>
              </button>
            );
          })}
        </div>

        {resolved && (
          <div className="mt-5 rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-4">
            <div className="text-xs uppercase tracking-widest text-emerald-300 mb-2">Result</div>
            {resolved.applied.length === 0 ? (
              <div className="text-sm text-zinc-300">No effect.</div>
            ) : (
              <ul className="text-sm text-zinc-100 space-y-1">
                {resolved.applied.map((a, i) => (
                  <li key={i}>· {a.summary}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!resolved && (
          <div className="mt-6 text-[11px] text-zinc-600 text-center">
            Tap a choice to commit. You can also skip from the back arrow.
          </div>
        )}
      </div>
    </div>
  );
}
