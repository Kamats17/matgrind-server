// ─── Career Mode - Dual Meet Bridge ─────────────────────────────────────────
// Wires the standalone Dual Meet machinery (`src/lib/dualMeetState.js`) into
// career mode for the new `dual_meet` event type. Three responsibilities:
//
//   1. Build a tier-appropriate dual snapshot from a career + schedule event,
//      respecting the player's chosen lineup mode (`my_match` | `full_dual`)
//      and the rivalry-dual hero-bout opponent.
//
//   2. Sim non-hero bouts when the player picks "Wrestle My Match" so the
//      team result is computed without launching the match engine for every
//      weight class.
//
//   3. Finalize the dual back into the career record by patching the
//      schedule event with team metadata, then handing the player's hero-bout
//      result to the existing `recordEventResult` so career W/L, rivals,
//      H2H, opponent-meeting tracking, ranking-pool sims, XP, and postseason
//      gating all flow through the same pipeline tournaments / single duals
//      already use.
//
// Schema impact: NONE. The career schema is `.passthrough()` and does not
// strictly validate `schedule.events[]`. New dual_meet events flow through
// `recordEventResult` exactly like single-match `dual` events; the metadata
// we stamp (`lineupChoice`, `dualSummary`) is opaque to the validator.

import { createDualMeet, advanceDualBout, scoreFolkstyleBout, getDualWinner } from '../dualMeetState.js';
import { getWeightsForTier, snapToValidWeight } from './careerWeights.js';
import { rollMatchOutcome, avgStats } from './simulateEvent.js';
import { recordEventResult } from './careerState.js';

/**
 * Build a fresh career dual-meet snapshot from a career and a `dual_meet`
 * schedule event. Does NOT persist it - callers are responsible for calling
 * `saveCareerDual(dual)` after attaching `careerEventId`.
 *
 * Throws a typed error if the wrestler's career weight class is not in the
 * tier's weight table. The bridge does not silently fall back to a default
 * weight - that would put the player in a dual at the wrong weight and is
 * the bug the de-NCAA-ification work was meant to prevent.
 *
 * @param {object} career
 * @param {object} event - `dual_meet` schedule event
 * @param {'my_match'|'full_dual'} lineupChoice
 * @param {object} [opts]
 * @param {string} [opts.profileName]            override the hero name
 * @param {object} [opts.profileAppearance]      override the hero appearance
 * @returns {object} dual snapshot (matches dualMeetState shape)
 */
export function createCareerDualMeet(career, event, lineupChoice, opts = {}) {
  if (!career?.wrestler) {
    throw new Error('createCareerDualMeet: career.wrestler missing');
  }
  if (!event || event.type !== 'dual_meet') {
    throw new Error('createCareerDualMeet: event must be type dual_meet');
  }
  if (lineupChoice !== 'my_match' && lineupChoice !== 'full_dual') {
    throw new Error(`createCareerDualMeet: invalid lineupChoice "${lineupChoice}"`);
  }

  const tier = career.wrestler.tier || 'hs';
  const style = event.style || career.wrestler.style || 'folkstyle';
  const gender = career.wrestler.gender || 'male';
  const weights = getWeightsForTier(tier, style, gender);
  // v9: senior dual_meet events at greco style use a different weight class
  // than wrestler.weightClass (which is the freestyle/display weight for men).
  // Trust the event's pre-resolved weightClass first (buildEventFromTemplate
  // at careerSchedule.js stamps per-style weight for senior events when the
  // wrestler.weights map is threaded through generateSeasonSchedule).
  // Fall back to wrestler.weightClass for HS/college (no per-style map) and
  // legacy senior events.
  let heroWeight = (event.weightClass != null && weights.includes(event.weightClass))
    ? event.weightClass
    : (career.wrestler.weights && Number.isFinite(career.wrestler.weights[style]))
      ? career.wrestler.weights[style]
      : career.wrestler.weightClass;
  let heroIdx = weights.indexOf(heroWeight);
  // Defensive recovery: if wrestler.weightClass isn't in the tier/gender table
  // (legacy save from before the buildCollegeFromOffer gender fix landed,
  // e.g. women's college careers stuck at men's NCAA 133), snap to the
  // nearest valid weight rather than throwing. The matching `hydrateCareer`
  // migration repairs the persisted state on next load; this guard keeps an
  // already-loaded career playable in the meantime.
  if (heroIdx < 0) {
    const snapped = snapToValidWeight(heroWeight, tier, style, gender);
    console.warn('[CareerDualMeet] weight-class snap fallback:', {
      tier, gender, requested: heroWeight, snappedTo: snapped,
    });
    heroWeight = snapped;
    heroIdx = weights.indexOf(heroWeight);
    if (heroIdx < 0) {
      // snapToValidWeight returns a value from the same tier/gender table,
      // so this should be unreachable. Fail loud if it ever happens.
      /** @type {Error & { code?: string }} */
      const err = new Error(
        `createCareerDualMeet: snap to ${snapped} still not in ${tier}/${gender} weight table`
      );
      err.code = 'CAREER_DUAL_WEIGHT_MISMATCH';
      throw err;
    }
  }

  const profile = {
    username: opts.profileName || career.wrestler.name || 'You',
    stats: career.wrestler.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
    appearance: opts.profileAppearance || career.wrestler.appearance || null,
  };

  const playerTeamName = career.wrestler.school?.name
    || career.wrestler.school
    || `${career.wrestler.state || ''} ${career.wrestler.name?.split(' ')[1] || career.wrestler.name || 'Wrestlers'}`.trim();

  const dual = createDualMeet(profile, {
    mode: 'cpu',
    difficulty: event.difficulty || (tier === 'hs' ? 'medium' : 'hard'),
    heroWeightClass: heroWeight,
    weights,
    style,
    playerTeamName,
    opponentTeamName: event.opponentTeamName || 'Visitors',
    lineupMode: 'random',
    gender,
  });

  // Rivalry-dual hero opponent injection. The schedule generator stamps
  // `event.opponent` with the rival wrestler shape on Rivalry Dual slots.
  // Replace the hero bout's CPU-generated opponent with that rival so
  // recordEventResult's H2H + opponent-meeting tracking finds them.
  if (event.opponentIsRival && event.opponent && event.opponent.id && event.opponent.stats) {
    dual.opponentTeam[heroIdx] = {
      ...dual.opponentTeam[heroIdx],
      name: event.opponent.name || dual.opponentTeam[heroIdx].name,
      stats: event.opponent.stats,
    };
    dual.bouts[heroIdx] = {
      ...dual.bouts[heroIdx],
      opponentWrestler: dual.opponentTeam[heroIdx],
    };
  }

  dual.careerEventId = event.id;
  dual.lineupChoice = lineupChoice;
  dual.heroIdx = heroIdx;
  return dual;
}

/**
 * Simulate the SINGLE bout currently queued at `dual.currentBoutIndex`.
 * Used by the "Simulate Bout" button on the career dual scoreboard so the
 * player can mix played + simulated bouts in a `full_dual` run (play 3-4,
 * then sim the rest to finish faster). Mutates `dual` via advanceDualBout
 * so phase/score/bout history stay coherent.
 *
 * Caller is responsible for `saveCareerDual(dual)` after this returns and
 * for routing UI state forward (between/bout/complete) per the new
 * `dual.phase`.
 *
 * Returns the same dual reference. No-op when phase is 'complete' or the
 * current bout already has a result recorded.
 */
export function simulateOneBout(dual, rng = Math.random) {
  if (!dual || dual.phase === 'complete') return dual;
  // Only sim when the dual is sitting on the between-bouts scoreboard. Other
  // phases ('bout' = engine-mid-match, 'lineup' = pre-start) should never see
  // a sim call - guards against double-resolving a bout the engine is still
  // playing.
  if (dual.phase !== 'between' && dual.phase !== 'bout') return dual;
  const idx = dual.currentBoutIndex;
  if (idx < 0 || idx >= dual.bouts.length) return dual;
  const bout = dual.bouts[idx];
  if (!bout || bout.result) return dual; // already resolved (defensive)
  const playerOA = avgStats(bout.playerWrestler?.stats);
  const opponentOA = avgStats(bout.opponentWrestler?.stats);
  const r = rollMatchOutcome(playerOA, opponentOA, rng);
  advanceDualBout(dual, r);
  return dual;
}

/**
 * Increment the private abort counter on `career.record` when a player
 * abandons a career dual mid-bout (force-close + Quit, in-match Quit, or
 * "Quit dual" on the result modal). The counter is intentionally hidden from
 * the UI; it exists only as private telemetry so we can identify players
 * who systematically retry losing matches via the no-loss quit path.
 *
 * Schema impact: NONE. `career.record` is part of the passthrough block;
 * `aborts` (number) and `abortLog` (array, capped at 200 entries) are new
 * additive fields. Existing careers without these fields read as 0 / [].
 *
 * Returns a new career object (does not mutate input). The caller is
 * responsible for `setActiveCareer(next)` + `saveCareer(uid, next)`.
 *
 * @param {object} career
 * @param {string|null} eventId   the schedule event id the player abandoned
 * @param {string|null} eventName the schedule event name (display only)
 * @param {string} [kind]         'dual_meet' (default) or other future kinds
 * @returns {object} next career (or input unchanged on bad input)
 */
export function recordCareerDualAbort(career, eventId, eventName, kind = 'dual_meet') {
  if (!career || typeof career !== 'object' || !career.record) return career;
  const prev = career.record.aborts || 0;
  const aborts = prev + 1;
  const log = Array.isArray(career.record.abortLog) ? career.record.abortLog : [];
  const entry = {
    at: Date.now(),
    eventId: eventId || null,
    eventName: eventName || null,
    kind,
  };
  // Cap log at 200 entries (FIFO) so a heavy abort spammer doesn't bloat
  // the career doc beyond Firestore's 1MB document size limit.
  const nextLog = [...log, entry].slice(-200);
  return {
    ...career,
    record: { ...career.record, aborts, abortLog: nextLog },
  };
}

/**
 * Sim every non-hero bout up to and including the bout immediately before the
 * hero bout (or, after the hero bout has been played, sim through the rest).
 * Mutates `dual` in place (matches advanceDualBout's contract). No-op for
 * 'full_dual' mode (the player plays every bout).
 *
 * Walks `dual.currentBoutIndex` forward via `advanceDualBout` so phase, score,
 * and bout history all stay coherent with the standalone dual code path.
 */
export function simulateNonHeroBouts(dual, rng = Math.random) {
  if (!dual) return dual;
  if (dual.lineupChoice !== 'my_match') return dual;
  while (
    dual.phase !== 'complete'
    && dual.currentBoutIndex !== dual.heroIdx
    && dual.currentBoutIndex < dual.bouts.length
  ) {
    const bout = dual.bouts[dual.currentBoutIndex];
    const playerOA = avgStats(bout.playerWrestler?.stats);
    const opponentOA = avgStats(bout.opponentWrestler?.stats);
    const r = rollMatchOutcome(playerOA, opponentOA, rng);
    advanceDualBout(dual, r);
  }
  return dual;
}

/**
 * Finalize a completed (or forfeited) career dual-meet snapshot into the
 * career object. Patches the schedule event with team metadata FIRST so
 * recordEventResult's events.map preserves it via spread, then routes the
 * hero-bout outcome through recordEventResult so all downstream career
 * effects (W/L, XP, rivals, rankings, postseason gating) trigger normally.
 *
 * @param {object} career
 * @param {string} eventId
 * @param {object} dual - completed dual snapshot
 * @param {object} [opts]
 * @param {string[]} [opts.consumedBuffSourceIds] - Career Depth Pass v1:
 *   tempBuff sourceIds the player's hero bout consumed. Forwarded to
 *   recordEventResult under the strict-consumption contract. Omit on sim
 *   paths so unapplied buffs are not silently expired.
 * @returns {{ nextCareer: object, xpGained: number, teamWinner: 'player'|'opponent'|'draw' }}
 */
export function recordCareerDualMeetResult(career, eventId, dual, opts = {}) {
  if (!career || !eventId || !dual) {
    throw new Error('recordCareerDualMeetResult: missing arg');
  }
  if (!Array.isArray(career.schedule?.events)) {
    throw new Error('recordCareerDualMeetResult: career.schedule.events missing');
  }

  const heroIdx = typeof dual.heroIdx === 'number'
    ? dual.heroIdx
    : (Array.isArray(dual.weights) && typeof dual.heroWeightClass === 'number'
      ? dual.weights.indexOf(dual.heroWeightClass)
      : -1);
  const heroBout = heroIdx >= 0 ? dual.bouts?.[heroIdx] : null;

  // Defensive: if the hero bout never resolved (forfeit / mid-flow exit),
  // synthesize a loss-by-decision so the career record still ticks. Mirrors
  // the same defensive shape used for career-tournament forfeits.
  const heroResult = heroBout?.result || {
    playerWon: false,
    winMethod: 'decision',
    p1Score: 0,
    p2Score: 6,
  };

  const teamWinner = getDualWinner(dual);

  // Patch schedule events FIRST so recordEventResult's events.map preserves
  // lineupChoice + dualSummary via the (...e) spread before overlaying
  // status/result. If we called recordEventResult on the unpatched career,
  // the metadata would be lost.
  const patchedEvents = career.schedule.events.map(e => {
    if (e.id !== eventId) return e;
    return {
      ...e,
      lineupChoice: dual.lineupChoice || e.lineupChoice || null,
      dualSummary: {
        teamScore: { ...dual.teamScore },
        teamWinner,
        weights: Array.isArray(dual.weights) ? dual.weights.slice() : [],
        heroIdx,
        bouts: (dual.bouts || []).map(b => ({
          weight: b.weight,
          playerWon: b.result?.playerWon ?? null,
          winMethod: b.result?.winMethod ?? null,
          isHero: b.playerWrestler?.isHero === true,
        })),
      },
    };
  });
  const patchedCareer = {
    ...career,
    schedule: { ...career.schedule, events: patchedEvents },
  };

  const prevXp = patchedCareer.wrestler?.xp || 0;
  const recordPayload = {
    playerWon: !!heroResult.playerWon,
    p1Score: heroResult.p1Score ?? 0,
    p2Score: heroResult.p2Score ?? 0,
    winMethod: heroResult.winMethod || 'decision',
  };
  if (Array.isArray(opts.consumedBuffSourceIds)) {
    recordPayload.consumedBuffSourceIds = opts.consumedBuffSourceIds;
  }
  const nextCareer = recordEventResult(patchedCareer, eventId, recordPayload);
  const xpGained = Math.max(0, (nextCareer.wrestler?.xp || 0) - prevXp);

  return { nextCareer, xpGained, teamWinner };
}

/**
 * Compute the team-points contribution for a single bout result. Re-exposes
 * `scoreFolkstyleBout` so callers don't need to import dualMeetState directly.
 * Useful for UI previews and test assertions.
 */
export { scoreFolkstyleBout };
