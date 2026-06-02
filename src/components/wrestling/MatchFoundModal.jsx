import React, { useEffect, useRef, useState } from 'react';

/**
 * Interrupt modal shown when a background-queue match is found.
 *
 * Two flavours:
 *   - Casual (user is on menu / profile / etc.): shows a short "found!"
 *     splash and auto-accepts after a brief delay.
 *   - Interrupt (user is mid vs-AI match): shows a 15-second countdown
 *     with Join / Finish-AI options; auto-forfeits on expiry.
 *
 * Props:
 *   opponentName      - the other player's display name (for both flavours)
 *   interrupt         - boolean; true when mid-match and user must choose
 *   onAccept          - user chose to join the online match
 *   onDecline         - user chose to finish the current activity
 *   autoAcceptMs      - delay before auto-accepting in casual mode (default 1200ms)
 *   countdownSeconds  - decline timeout in interrupt mode (default 15s)
 */
export default function MatchFoundModal({
  opponentName = 'Opponent',
  interrupt = false,
  onAccept,
  onDecline,
  autoAcceptMs = 1200,
  countdownSeconds = 15,
}) {
  const [remaining, setRemaining] = useState(countdownSeconds);
  const decided = useRef(false);

  // Reset the decision latch whenever a new match is presented. Without
  // this, a rematch flow that re-renders the modal with a different
  // opponent (without unmounting first) inherits decided=true from the
  // previous match and the auto-accept timer no-ops.
  useEffect(() => {
    decided.current = false;
    setRemaining(countdownSeconds);
  }, [opponentName, interrupt, countdownSeconds]);

  // Casual mode: tick once then auto-accept.
  useEffect(() => {
    if (interrupt) return;
    const t = setTimeout(() => {
      if (decided.current) return;
      decided.current = true;
      onAccept?.();
    }, autoAcceptMs);
    return () => clearTimeout(t);
  }, [interrupt, onAccept, autoAcceptMs]);

  // Interrupt mode: 1Hz countdown, auto-decline on expiry.
  useEffect(() => {
    if (!interrupt) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          if (!decided.current) {
            decided.current = true;
            onDecline?.();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [interrupt, onDecline]);

  const accept = () => {
    if (decided.current) return;
    decided.current = true;
    onAccept?.();
  };

  const decline = () => {
    if (decided.current) return;
    decided.current = true;
    onDecline?.();
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-zinc-900 border-2 border-amber-500 rounded-2xl p-6 text-center shadow-2xl animate-[pulse_1.2s_ease-in-out_infinite]">
        <div className="text-amber-400 text-xs font-black uppercase tracking-[0.3em] mb-2">
          {interrupt ? 'Online Match Ready' : 'Opponent Found!'}
        </div>
        <div className="text-white text-2xl font-black mt-1">
          vs {opponentName}
        </div>
        {interrupt ? (
          <>
            <div className="mt-4 text-zinc-400 text-sm">
              Join now, or finish your current match first.<br />
              <span className="text-zinc-500 text-xs">
                Declining forfeits this online match.
              </span>
            </div>
            <div className="mt-4 text-amber-400 font-mono text-3xl font-black">
              {remaining}s
            </div>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={accept}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-black font-black tracking-wide transition-all"
              >
                JOIN ONLINE MATCH
              </button>
              <button
                onClick={decline}
                className="w-full py-2 rounded-xl border border-zinc-700 bg-zinc-950 hover:bg-zinc-800 active:scale-95 text-zinc-400 font-bold text-sm transition-all"
              >
                Finish current match
              </button>
            </div>
          </>
        ) : (
          <div className="mt-4 text-zinc-400 text-sm">
            Jumping in…
            <div className="mt-3 flex justify-center gap-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-amber-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
