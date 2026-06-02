// --- Career Mode - Event Simulation -----------------------------------------
// Probabilistic resolvers used by the "Simulate Week" button on the career
// dashboard, and by the forfeit path when a tournament is left half-played.
//
// We don't run the actual match engine here - that would be slow, and the
// engine assumes interactive card play. Instead we roll a plausible result
// from stat differential using a logistic curve and reasonable per-method
// weights. This matches what scripts/simCareer.mjs already does for its
// 500-run sweeps.
//
// Determinism: every helper accepts an `rng` parameter (defaults to
// Math.random). Tests pass a seeded RNG so the same inputs produce the same
// outputs across runs.

import { computePlacement } from '../tournamentScoring.js';
import { getWeightsForTier } from './careerWeights.js';

/** Average a wrestler's 5 core stats. Returns a 0-100 overall figure. */
export function avgStats(stats) {
  if (!stats) return 60;
  const { str = 60, spd = 60, tec = 60, end = 60, grt = 60 } = stats;
  return Math.round((str + spd + tec + end + grt) / 5);
}

/**
 * Roll a single match outcome between two wrestlers with given overall
 * ratings. Returns { playerWon, p1Score, p2Score, winMethod }.
 *
 * Win probability follows a logistic curve on the OA delta:
 *   delta=0  -> 50%
 *   delta=10 -> ~73%
 *   delta=20 -> ~88%
 *   delta=30 -> ~95%
 *
 * Method bias scales with margin: bigger gaps tilt toward pin / tech-fall.
 */
export function rollMatchOutcome(playerOA, opponentOA, rng = Math.random) {
  const delta = playerOA - opponentOA;
  const winProb = 1 / (1 + Math.exp(-delta / 8));
  const playerWon = rng() < winProb;

  // Method weights bias toward decisive finishes when the gap is large.
  const margin = Math.abs(delta);
  let winMethod;
  if (margin > 25) {
    const r = rng();
    winMethod = r < 0.4 ? 'pin' : r < 0.7 ? 'tech_fall' : 'major_decision';
  } else if (margin > 15) {
    const r = rng();
    winMethod = r < 0.2 ? 'pin' : r < 0.45 ? 'tech_fall' : r < 0.7 ? 'major_decision' : 'decision';
  } else if (margin > 8) {
    const r = rng();
    winMethod = r < 0.15 ? 'major_decision' : 'decision';
  } else {
    winMethod = 'decision';
  }

  // Approximate scores. For folkstyle these match typical box-score ranges;
  // the values feed the result modal + history log only - they don't drive
  // any downstream logic that needs precise points.
  let winScore;
  let loseScore;
  if (winMethod === 'pin') {
    winScore = 0; // pins end the match before scoring resolves; the engine
                  //   uses (0,0) on pin too. Keep parity.
    loseScore = 0;
  } else if (winMethod === 'tech_fall') {
    winScore = 16;
    loseScore = winScore - 15;
  } else if (winMethod === 'major_decision') {
    winScore = 8 + Math.floor(rng() * 4);     // 8-11
    loseScore = Math.max(0, winScore - 8);
  } else {
    winScore = 4 + Math.floor(rng() * 5);     // 4-8
    loseScore = Math.max(0, winScore - 1 - Math.floor(rng() * 3));
  }

  return {
    playerWon,
    p1Score: playerWon ? winScore : loseScore,
    p2Score: playerWon ? loseScore : winScore,
    winMethod,
  };
}

/**
 * Simulate a single dual / exhibition / individual-style event. Returns the
 * result shape that recordEventResult expects for non-tournament events.
 *
 *   { playerWon, p1Score, p2Score, winMethod }
 */
export function simulateDualEvent(career, event, rng = Math.random) {
  const playerOA = avgStats(career?.wrestler?.stats);
  const opponentOA = (typeof event?.opponent?.overall === 'number')
    ? event.opponent.overall
    : avgStats(event?.opponent?.stats);
  return rollMatchOutcome(playerOA, opponentOA, rng);
}

/**
 * Simulate a full team dual_meet without launching the dual UI. Used by the
 * "Simulate Week" button. Returns a synthetic dual snapshot ready to feed
 * recordCareerDualMeetResult: it has bouts.length / weights / teamScore /
 * heroIdx / lineupChoice 'simulated' set, and every bout is resolved.
 *
 * The hero-bout outcome is the canonical W/L for the player (recorded into
 * career.record by recordEventResult). Other bouts contribute only to team
 * score, which the caller stores on the schedule event as dualSummary.
 *
 * @param {object} career
 * @param {object} event - the dual_meet schedule event
 * @param {() => number} [rng]
 */
export function simulateDualMeetEvent(career, event, rng = Math.random) {
  const tier = career?.wrestler?.tier || 'hs';
  const style = event?.style || career?.wrestler?.style || 'folkstyle';
  const gender = career?.wrestler?.gender || 'male';
  const weights = getWeightsForTier(tier, style, gender);
  const heroWeight = career?.wrestler?.weightClass;
  let heroIdx = weights.indexOf(heroWeight);
  if (heroIdx < 0) heroIdx = Math.floor(weights.length / 2);

  const playerOA = avgStats(career?.wrestler?.stats);
  // Opponent OA scales lightly per bout so the dual isn't perfectly uniform.
  // Centre on the schedule event's opponent overall when available; otherwise
  // anchor at the player's OA so the simulation reads as competitive.
  const opponentBaseOA = (typeof event?.opponent?.overall === 'number')
    ? event.opponent.overall
    : playerOA;

  let teamPlayer = 0;
  let teamOpponent = 0;
  const bouts = weights.map((weight, i) => {
    // Hero bout uses the player's own OA; non-hero bouts roll a teammate
    // OA in the player's stat band (-/+ 8).
    const isHero = i === heroIdx;
    const p1OA = isHero ? playerOA : clampOA(playerOA + Math.floor((rng() - 0.5) * 16));
    const p2OA = clampOA(opponentBaseOA + Math.floor((rng() - 0.5) * 16));
    const r = rollMatchOutcome(p1OA, p2OA, rng);
    const teamPoints = scoreSimulatedBout(r);
    teamPlayer += teamPoints.player;
    teamOpponent += teamPoints.opponent;
    return {
      weight,
      playerWrestler: { weight, name: isHero ? (career?.wrestler?.name || 'You') : `Teammate ${i + 1}`, stats: { str: p1OA, spd: p1OA, tec: p1OA, end: p1OA, grt: p1OA }, isHero },
      opponentWrestler: { weight, name: `Opponent ${i + 1}`, stats: { str: p2OA, spd: p2OA, tec: p2OA, end: p2OA, grt: p2OA } },
      result: {
        playerWon: !!r.playerWon,
        winMethod: r.winMethod,
        p1Score: r.p1Score,
        p2Score: r.p2Score,
      },
      teamPointsAwarded: teamPoints,
    };
  });

  return {
    phase: 'complete',
    mode: 'cpu',
    difficulty: 'medium',
    wrestlingStyle: style,
    weights,
    heroWeightClass: weights[heroIdx],
    heroIdx,
    lineupChoice: 'simulated',
    careerEventId: event?.id || null,
    playerTeam: bouts.map(b => b.playerWrestler),
    opponentTeam: bouts.map(b => b.opponentWrestler),
    bouts,
    currentBoutIndex: bouts.length,
    teamScore: { player: teamPlayer, opponent: teamOpponent },
    createdAt: Date.now(),
    savedAt: Date.now(),
  };
}

function clampOA(n) {
  if (!Number.isFinite(n)) return 60;
  return Math.max(40, Math.min(99, Math.round(n)));
}

// Inline copy of scoreFolkstyleBout's mapping used only by simulation. Mirrors
// dualMeetState.FOLKSTYLE_DUAL_POINTS so a behavior change there propagates
// to simulated duals via dualMeetState.scoreFolkstyleBout (preferred) - but
// rollMatchOutcome emits 'major_decision' not 'major', so we must normalize
// the same way scoreFolkstyleBout now does.
function scoreSimulatedBout(r) {
  // Normalize aliases: rollMatchOutcome emits 'major_decision' (matches engine
  // when the engine emits a wide decision) and 'tech_fall'.
  let method = r.winMethod;
  if (method === 'major_decision') method = 'major';
  if (method === 'tech') method = 'tech_fall';
  const pts = {
    decision: { winner: 3, loser: 0 },
    major:    { winner: 4, loser: 0 },
    tech_fall:{ winner: 5, loser: 0 },
    pin:      { winner: 6, loser: 0 },
    forfeit:  { winner: 6, loser: 0 },
    dq:       { winner: 6, loser: 0 },
    draw:     { winner: 2, loser: 2 },
  }[method] || { winner: 3, loser: 0 };
  if (method === 'draw') return { player: pts.winner, opponent: pts.loser, method: 'draw' };
  if (r.playerWon) return { player: pts.winner, opponent: pts.loser, method };
  return { player: pts.loser, opponent: pts.winner, method };
}

/**
 * Simulate an entire tournament bracket from the player's perspective.
 *
 * The non-player matches resolve themselves in the background - we only roll
 * for the player's path. Each round the "field" is one tier stronger
 * (+3 OA per advance), reflecting that surviving wrestlers tend to be the
 * better seeds.
 *
 * Returns the result shape recordEventResult expects for tournament events:
 *   { playerWon, placement, matchesWon, matchesLost,
 *     pinsInTournament, techsInTournament, majorsInTournament, winMethod }
 */
export function simulateTournamentEvent(career, event, rng = Math.random) {
  const playerOA = avgStats(career?.wrestler?.stats);
  const bracketSize = event?.bracketSize || 8;
  const playerRoundsToWin = Math.ceil(Math.log2(bracketSize));
  // fieldStrength is optional - if absent we anchor at the player's own
  // overall so tier-appropriate fields still get scored sensibly.
  const fieldBase = (typeof event?.fieldStrength === 'number')
    ? event.fieldStrength
    : playerOA;

  let roundsWon = 0;
  let matchesLost = 0;
  let pins = 0;
  let techs = 0;
  let majors = 0;

  while (roundsWon < playerRoundsToWin) {
    const opponentOA = fieldBase + roundsWon * 3;
    const r = rollMatchOutcome(playerOA, opponentOA, rng);
    if (r.playerWon) {
      roundsWon += 1;
      if (r.winMethod === 'pin') pins += 1;
      else if (r.winMethod === 'tech_fall') techs += 1;
      else if (r.winMethod === 'major_decision') majors += 1;
    } else {
      matchesLost = 1;
      break;
    }
  }

  const playerEliminated = matchesLost > 0;
  const placement = computePlacement({
    playerEliminated,
    roundsWon,
    playerRoundsToWin,
    bracketSize,
  });

  return {
    playerWon: roundsWon === playerRoundsToWin,
    p1Score: 0,
    p2Score: 0,
    winMethod: roundsWon === playerRoundsToWin ? 'champion' : 'decision',
    placement,
    matchesWon: roundsWon,
    matchesLost,
    pinsInTournament: pins,
    techsInTournament: techs,
    majorsInTournament: majors,
  };
}

/**
 * Wrap up a tournament that the player started but didn't finish. Reads the
 * actual bracket state - counts the wins/losses they earned, computes the
 * placement they'd get at the round they bailed on, and returns the result
 * shape recordEventResult expects.
 *
 * Used by:
 *   - "Quit Tournament" button (forfeit-on-quit)
 *   - "Simulate Remaining" when a bracket is half-played
 *
 * Distinct from simulateTournamentEvent because this preserves whatever the
 * player actually did - no rolling for already-played matches.
 */
export function summarizeForfeitedTournament(tournamentState) {
  const ts = tournamentState;
  if (!ts) {
    return {
      playerWon: false,
      p1Score: 0,
      p2Score: 0,
      winMethod: 'decision',
      placement: null,
      matchesWon: 0,
      matchesLost: 1,
      pinsInTournament: 0,
      techsInTournament: 0,
      majorsInTournament: 0,
    };
  }

  const playerSeed = ts.playerSeed;
  const allMatches = [
    ...(ts.matches || []),
    ...(ts.losersMatches || []),
    ...(ts.trueFinals ? [ts.trueFinals] : []),
    ...(ts.consolationMatch ? [ts.consolationMatch] : []),
  ];

  let matchesWon = 0;
  let matchesLost = 0;
  let pins = 0;
  let techs = 0;
  let majors = 0;
  for (const m of allMatches) {
    if (!m || m.winner === null || m.winner === undefined) continue;
    const inMatch = (m.bracketSlots?.[0] === playerSeed)
      || (m.bracketSlots?.[1] === playerSeed);
    if (!inMatch) continue;
    if (m.winner === playerSeed) {
      matchesWon += 1;
      if (m.winMethod === 'pin') pins += 1;
      else if (m.winMethod === 'tech_fall' || m.winMethod === 'tech') techs += 1;
      else if (m.winMethod === 'major_decision' || m.winMethod === 'major') majors += 1;
    } else {
      matchesLost += 1;
    }
  }

  // If the user bailed before ever playing a match, count it as a round-1
  // forfeit (matchesLost = 1) so placement formula returns last-place.
  if (matchesLost === 0 && matchesWon === 0) {
    matchesLost = 1;
  }

  const bracketSize = ts.bracket?.length || 8;
  const placement = computePlacement({
    playerEliminated: true,
    roundsWon: matchesWon,
    playerRoundsToWin: ts.playerRoundsToWin,
    bracketSize,
  });

  return {
    playerWon: false,
    p1Score: 0,
    p2Score: 0,
    winMethod: 'decision',
    placement,
    matchesWon,
    matchesLost,
    pinsInTournament: pins,
    techsInTournament: techs,
    majorsInTournament: majors,
  };
}
