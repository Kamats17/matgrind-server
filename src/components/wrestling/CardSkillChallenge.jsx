import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  getMechanicForCard,
  MECHANIC_TYPES,
  getMissResult,
} from '@/lib/cardArchetypeMechanics';
import ChargeMechanic from './skillMechanics/ChargeMechanic';
import ReactionMechanic from './skillMechanics/ReactionMechanic';
import TraceMechanic from './skillMechanics/TraceMechanic';
import BurstMechanic from './skillMechanics/BurstMechanic';
import PathMechanic from './skillMechanics/PathMechanic';

// Top-level dispatcher rendered as an overlay after a card is committed.
// Picks the right mechanic based on card.category and resolves with
// { tier, bonus, narrowRng, rngRange } via onResolve.
//
// Online (server-authoritative): pass `serverParams` (from
// state_update.preGeneratedChallenges[cardId].params) and `onInput` so
// the mechanic uses server-issued randomness and streams events back
// for tier computation. Local `onResolve` is still called for visual
// completion but its tier is ignored - server's challenge_resolved drives
// the actual outcome.
export default function CardSkillChallenge({
  card,
  onResolve,
  serverParams = null,
  onInput = null,
  // Reaction-specific: when online, the parent feeds the current
  // server-driven phase ('waiting'|'fake'|'go'|'done') so red/green
  // visuals match what the server scheduled. The phase value can lag
  // behind the first render (e.g. parent batches setPendingChallenge +
  // setServerReactionPhase), so we don't gate serverDriven on the phase
  // being non-null. Instead we use the explicit isOnline flag below.
  serverReactionPhase = null,
  // True when the parent (WrestlingGame) is in online mode. Drives
  // serverDriven for ReactionMechanic deterministically, independent of
  // when serverReactionPhase first becomes truthy.
  isOnline = false,
}) {
  const mechanic = getMechanicForCard(card);
  // Reaction is the only mechanic with server-secret timing. In online
  // mode we ALWAYS run server-driven (no local timers / local fake-out
  // randomization). serverPhase starts null and is updated by the parent
  // on challenge_prompt; ReactionMechanic falls back to 'waiting' when
  // null in serverDriven mode.
  const reactionServerDriven = mechanic === MECHANIC_TYPES.REACTION && isOnline;

  // Always-current onResolve ref - the NONE-mechanic auto-resolve below only
  // runs on mechanic change, so it can otherwise capture a stale handler.
  const onResolveRef = useRef(onResolve);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);

  // Setup cards (and any unmapped category): no skill layer - resolve
  // immediately with MISS (no bonus, default ±10 RNG). useEffect ensures we
  // don't call onResolve during render. Transitions now use the PATH mechanic
  // (polyline trace), so they no longer fall through here.
  useEffect(() => {
    if (mechanic === MECHANIC_TYPES.NONE) {
      onResolveRef.current(getMissResult());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mechanic]);

  if (mechanic === MECHANIC_TYPES.NONE) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center px-4"
      style={{
        touchAction: 'none',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={card?.name ? `Skill challenge: ${card.name}` : 'Skill challenge'}
    >
      {/* Backdrop dims + blurs the match screen and absorbs taps so the card
          grid behind cannot be touched. No dismiss handler by design - the
          card is already committed; each mechanic owns an idle-timeout MISS
          if the player does nothing. */}
      <motion.div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      />

      {/* Opaque panel, bottom-anchored (not centered) to keep the action area
          low and thumb-reachable. Panel height tracks the mechanic content;
          there is no reserved-height slot, so tap-target Y is only roughly
          stable between mechanics, not pixel-exact. */}
      <motion.div
        className="relative z-10 w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex flex-col items-center gap-4">
          {card?.name && (
            <div className="text-base font-bold tracking-wide text-zinc-100">
              {card.name}
            </div>
          )}
          {mechanic === MECHANIC_TYPES.CHARGE   && <ChargeMechanic onResolve={onResolve} tuningOverride={serverParams} onInput={onInput} />}
          {mechanic === MECHANIC_TYPES.REACTION && <ReactionMechanic onResolve={onResolve} tuningOverride={serverParams} onInput={onInput} serverDriven={reactionServerDriven} serverPhase={serverReactionPhase} />}
          {mechanic === MECHANIC_TYPES.TRACE    && <TraceMechanic onResolve={onResolve} tuningOverride={serverParams} onInput={onInput} />}
          {mechanic === MECHANIC_TYPES.BURST    && <BurstMechanic onResolve={onResolve} tuningOverride={serverParams} onInput={onInput} />}
          {mechanic === MECHANIC_TYPES.PATH     && <PathMechanic onResolve={onResolve} tuningOverride={serverParams} onInput={onInput} />}
        </div>
      </motion.div>
    </div>
  );
}
