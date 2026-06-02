// ─── Tournament State Machine ────────────────────────────────────────────────
import { generateBracket, generateOpponent } from './tournamentOpponents.js';
import { genderForStyle } from './namePools.js';

const STORAGE_KEY = 'matgrind_tournament';
const EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

// ─── Bracket Structure Builder ───────────────────────────────────────────────

/**
 * Build match structure and round metadata for any bracket size.
 * Supports 8, 16, 24, 32, 64, 128.  24 uses a play-in round with 8 byes.
 *
 * Returns { matches, roundRanges, totalRounds, playerRoundsToWin }
 *   matches[i] = { bracketSlots: [seedA, seedB], winner, p1Score, p2Score, winMethod, feedsInto }
 *   roundRanges[r] = { label, key, start, end }   (start/end are inclusive match indices)
 */
export function buildBracketStructure(bracketSize) {
  if (bracketSize === 24) return buildBracket24();

  // Only the explicit power-of-2 sizes have a builder. Any other size
  // (e.g. NCAA's IRL 33, a typo, or a future schedule entry) would silently
  // produce a malformed bracket: Math.log2 returns a non-integer, the
  // matches-per-round loop overshoots and creates matches whose seeds
  // exceed bracketSize-1, leaving the player with an undefined opponent
  // ("TBD") that never resolves. Reject up front so the data error surfaces
  // immediately instead of as a stuck tournament. (Mason 2026-05-05.)
  const SUPPORTED_POWER_OF_TWO = new Set([8, 16, 32, 64, 128]);
  if (!SUPPORTED_POWER_OF_TWO.has(bracketSize)) {
    throw new Error(`Unsupported bracketSize: ${bracketSize}. Supported sizes: 8, 16, 24, 32, 64, 128.`);
  }

  // Power-of-2 brackets (8, 16, 32, 64, 128)
  const rounds = Math.log2(bracketSize);
  const roundLabels = buildRoundLabels(rounds);
  const matches = [];
  const roundRanges = [];
  let matchIndex = 0;

  // Build round by round
  for (let r = 0; r < rounds; r++) {
    const matchesInRound = bracketSize / Math.pow(2, r + 1);
    const start = matchIndex;

    for (let m = 0; m < matchesInRound; m++) {
      const match = {
        bracketSlots: r === 0
          ? [m * 2, m * 2 + 1]        // first round: seed pairings
          : [null, null],               // later rounds: filled by propagation
        winner: null,
        p1Score: null,
        p2Score: null,
        winMethod: null,
        feedsInto: null,                // set below
      };
      matches.push(match);
      matchIndex++;
    }

    const end = matchIndex - 1;
    roundRanges.push({
      label: roundLabels[r],
      key: getRoundKey(roundLabels[r]),
      start,
      end,
    });
  }

  // Wire feedsInto: winner of match i feeds into the next round
  for (let r = 0; r < rounds - 1; r++) {
    const { start, end } = roundRanges[r];
    const nextStart = roundRanges[r + 1].start;
    for (let i = start; i <= end; i++) {
      const posInRound = i - start;
      const targetMatch = nextStart + Math.floor(posInRound / 2);
      const targetSlot = posInRound % 2;
      matches[i].feedsInto = { matchIndex: targetMatch, slot: targetSlot };
    }
  }

  // Player is seed 0, enters round 0 match 0
  const playerRoundsToWin = rounds;

  return { matches, roundRanges, totalRounds: rounds, playerRoundsToWin };
}

/**
 * 24-wrestler bracket: seeds 0-7 get byes to R16, seeds 8-23 play 8 play-in matches.
 */
function buildBracket24() {
  const matches = [];
  const roundRanges = [];
  let idx = 0;

  // Play-in round: 8 matches (seeds 8-23)
  // Pairings: 8v23, 9v22, 10v21, 11v20, 12v19, 13v18, 14v17, 15v16
  const playInStart = idx;
  for (let m = 0; m < 8; m++) {
    matches.push({
      bracketSlots: [8 + m, 23 - m],
      winner: null, p1Score: null, p2Score: null, winMethod: null,
      feedsInto: null, // set below
    });
    idx++;
  }
  roundRanges.push({ label: 'Play-in', key: 'r32', start: playInStart, end: idx - 1 });

  // R16: 8 matches. Top 8 seeds vs play-in winners.
  // Seed 0 vs winner of play-in 0, seed 1 vs winner of play-in 1, etc.
  const r16Start = idx;
  for (let m = 0; m < 8; m++) {
    matches.push({
      bracketSlots: [m, null], // slot 1 filled by play-in winner propagation
      winner: null, p1Score: null, p2Score: null, winMethod: null,
      feedsInto: null,
    });
    idx++;
  }
  roundRanges.push({ label: 'Round of 16', key: 'r16', start: r16Start, end: idx - 1 });

  // Wire play-in → R16
  for (let m = 0; m < 8; m++) {
    matches[playInStart + m].feedsInto = { matchIndex: r16Start + m, slot: 1 };
  }

  // QF: 4 matches
  const qfStart = idx;
  for (let m = 0; m < 4; m++) {
    matches.push({
      bracketSlots: [null, null],
      winner: null, p1Score: null, p2Score: null, winMethod: null,
      feedsInto: null,
    });
    idx++;
  }
  roundRanges.push({ label: 'Quarterfinals', key: 'qf', start: qfStart, end: idx - 1 });

  // Wire R16 → QF
  for (let m = 0; m < 8; m++) {
    matches[r16Start + m].feedsInto = { matchIndex: qfStart + Math.floor(m / 2), slot: m % 2 };
  }

  // SF: 2 matches
  const sfStart = idx;
  for (let m = 0; m < 2; m++) {
    matches.push({
      bracketSlots: [null, null],
      winner: null, p1Score: null, p2Score: null, winMethod: null,
      feedsInto: null,
    });
    idx++;
  }
  roundRanges.push({ label: 'Semifinals', key: 'sf', start: sfStart, end: idx - 1 });

  // Wire QF → SF
  for (let m = 0; m < 4; m++) {
    matches[qfStart + m].feedsInto = { matchIndex: sfStart + Math.floor(m / 2), slot: m % 2 };
  }

  // Finals: 1 match
  const finalsStart = idx;
  matches.push({
    bracketSlots: [null, null],
    winner: null, p1Score: null, p2Score: null, winMethod: null,
    feedsInto: null,
  });
  idx++;
  roundRanges.push({ label: 'Finals', key: 'finals', start: finalsStart, end: idx - 1 });

  // Wire SF → Finals
  for (let m = 0; m < 2; m++) {
    matches[sfStart + m].feedsInto = { matchIndex: finalsStart, slot: m };
  }

  // Player (seed 0) has a bye - enters at R16, needs 4 wins
  return { matches, roundRanges, totalRounds: 5, playerRoundsToWin: 4 };
}

function buildRoundLabels(totalRounds) {
  // Build from finals backward
  const labels = [];
  const reverseLabels = ['Finals', 'Semifinals', 'Quarterfinals', 'Round of 16', 'Round of 32', 'Round of 64', 'Round of 128'];
  for (let r = 0; r < totalRounds; r++) {
    labels.push(reverseLabels[totalRounds - 1 - r] || `Round ${r + 1}`);
  }
  return labels;
}

function getRoundKey(label) {
  const map = {
    'Play-in':       'r32',
    'Round of 128':  'r128',
    'Round of 64':   'r64',
    'Round of 32':   'r32',
    'Round of 16':   'r16',
    'Quarterfinals': 'qf',
    'Semifinals':    'sf',
    'Finals':        'finals',
  };
  return map[label] || 'qf';
}

/**
 * Get round label for a given match index.
 */
export function getRoundLabel(tournament, matchIndex) {
  const { roundRanges } = tournament;
  if (!roundRanges) {
    // Legacy 8-bracket fallback
    if (matchIndex < 4) return 'Quarterfinals';
    if (matchIndex < 6) return 'Semifinals';
    return 'Finals';
  }
  for (const range of roundRanges) {
    if (matchIndex >= range.start && matchIndex <= range.end) return range.label;
  }
  return 'Unknown';
}

/**
 * Get round key (for stat scaling) for a given match index.
 */
function getRoundKeyForMatch(tournament, matchIndex) {
  const { roundRanges } = tournament;
  if (!roundRanges) {
    if (matchIndex < 4) return 'qf';
    if (matchIndex < 6) return 'sf';
    return 'finals';
  }
  for (const range of roundRanges) {
    if (matchIndex >= range.start && matchIndex <= range.end) return range.key;
  }
  return 'qf';
}

// ─── Propagation ─────────────────────────────────────────────────────────────

/**
 * Propagate winners into downstream match bracket slots.
 */
export function propagateWinners(tournament) {
  const { matches } = tournament;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (match.winner === null) continue;
    if (!match.feedsInto) continue;
    const { matchIndex: target, slot } = match.feedsInto;
    if (target < matches.length) {
      matches[target].bracketSlots[slot] = match.winner;
    }
  }
}

// ─── Tournament Creation ─────────────────────────────────────────────────────

/**
 * Create a new tournament state.
 * @param {{ username: string, stats: object, appearance: object|null }} playerProfile
 * @param {'easy'|'medium'|'hard'|'expert'} difficulty
 * @param {string} wrestlingStyle
 * @param {8|16|24|32|64|128} bracketSize
 * @param {'single'|'consolation'|'double_elim'} format
 * @param {object} [opts]
 * @param {Array<object>} [opts.preSeededBracket]  Career mode: pre-built bracket field, top-down by seed.
 * @param {number} [opts.preSeededPlayerSeed]      Career mode: player's index in the seeded bracket.
 * @returns {object} tournament state
 */
export function createTournament(playerProfile, difficulty, wrestlingStyle, bracketSize = 8, format = 'consolation', opts = {}) {
  const usePreSeeded = Array.isArray(opts.preSeededBracket) && opts.preSeededBracket.length === bracketSize;
  const bracket = usePreSeeded
    ? opts.preSeededBracket
    : generateBracket(
        playerProfile.username,
        playerProfile.stats,
        playerProfile.appearance,
        difficulty,
        bracketSize,
        { gender: genderForStyle(wrestlingStyle) },
      );

  const { matches, roundRanges, totalRounds, playerRoundsToWin } = buildBracketStructure(bracketSize);

  // ── Random draw: shuffle seed positions in first-round matchups ──
  // Career-mode pre-seeded brackets skip the shuffle entirely so seed 1 (top
  // overall) plays seed N (bottom) in round 1, matching real-life seeding.
  if (!usePreSeeded) {
    const firstRound = roundRanges[0];
    const allSeeds = [];
    for (let i = firstRound.start; i <= firstRound.end; i++) {
      allSeeds.push(...matches[i].bracketSlots.filter(s => s !== null));
    }
    // Fisher-Yates shuffle
    for (let i = allSeeds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allSeeds[i], allSeeds[j]] = [allSeeds[j], allSeeds[i]];
    }
    // Write shuffled seeds back into first-round matches
    let seedIdx = 0;
    for (let i = firstRound.start; i <= firstRound.end; i++) {
      for (let s = 0; s < matches[i].bracketSlots.length; s++) {
        if (matches[i].bracketSlots[s] !== null) {
          matches[i].bracketSlots[s] = allSeeds[seedIdx++];
        }
      }
    }
  }
  // For 24-bracket, also shuffle the R16 bye seeds (slot 0 of each R16 match)
  if (bracketSize === 24 && !usePreSeeded) {
    const r16Range = roundRanges[1];
    const byeSeeds = [];
    for (let i = r16Range.start; i <= r16Range.end; i++) {
      if (matches[i].bracketSlots[0] !== null) byeSeeds.push(matches[i].bracketSlots[0]);
    }
    for (let i = byeSeeds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [byeSeeds[i], byeSeeds[j]] = [byeSeeds[j], byeSeeds[i]];
    }
    let bIdx = 0;
    for (let i = r16Range.start; i <= r16Range.end; i++) {
      if (matches[i].bracketSlots[0] !== null) {
        matches[i].bracketSlots[0] = byeSeeds[bIdx++];
      }
    }
  }

  // Player position in the bracket. For random draws the player always
  // starts at index 0 (generateBracket convention). For career pre-seeded
  // brackets the player slot is determined by their state rank - see
  // careerBrackets.buildSeededBracket. Either way it identifies the
  // wrestler in `bracket` who is the human player.
  const playerSeed = usePreSeeded ? (opts.preSeededPlayerSeed ?? 0) : 0;

  const tournament = {
    bracket,
    matches,
    roundRanges,
    totalRounds,
    bracketSize,
    tournamentFormat: format,
    phase: 'bracket',
    difficulty,
    wrestlingStyle,
    playerSeed,
    playerEliminated: false,
    playerRoundsToWin,
    roundsWon: 0,
    createdAt: Date.now(),
    // Consolation
    consolationMatch: null,
    inConsolation: false,
    // Double elimination
    losersMatches: [],
    losersRoundRanges: [],
    playerLosses: 0,
    trueFinalsMatch: null,
  };

  // Build loser bracket for consolation or double elimination (both are double elim in wrestling)
  if (format === 'consolation' || format === 'double_elim') {
    buildLoserBracket(tournament);
  }

  // Don't auto-resolve on creation - player wrestles first (match 0),
  // then remaining matches in the round simulate sequentially after.
  // Set phase to 'bracket' so player sees the empty bracket and starts their match.
  propagateWinners(tournament);

  saveTournament(tournament);
  return tournament;
}

// ─── Bye Round Resolution ───────────────────────────────────────────────────

/**
 * Resolve all rounds before the player's first match.
 * In a 24-bracket, the player has a bye past the play-in round, so those
 * play-in matches need to be resolved before the player can wrestle.
 */
export function resolveByeRounds(tournament) {
  const { matches, playerSeed, roundRanges } = tournament;

  // Find which round the player first appears in
  let playerRoundIdx = -1;
  for (let r = 0; r < roundRanges.length; r++) {
    const { start, end } = roundRanges[r];
    for (let i = start; i <= end; i++) {
      const [s1, s2] = matches[i].bracketSlots;
      if (s1 === playerSeed || s2 === playerSeed) {
        playerRoundIdx = r;
        break;
      }
    }
    if (playerRoundIdx >= 0) break;
  }

  if (playerRoundIdx <= 0) return tournament; // player is in first round, no byes

  // Track whether anything actually resolved. If the caller invoked us in a
  // state where every prior round already has winners (e.g. the dead-button
  // bug where the post-finals UI accidentally routes here), we want a
  // breadcrumb in the console rather than a silently no-op state-update.
  let anyResolved = false;

  // Resolve all rounds before the player's round
  for (let r = 0; r < playerRoundIdx; r++) {
    const { start, end } = roundRanges[r];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = start; i <= end; i++) {
        const match = matches[i];
        if (match.winner !== null) continue;
        const [s1, s2] = match.bracketSlots;
        if (s1 === null || s2 === null) continue;
        resolveMatch(match, s1, s2);
        propagateWinners(tournament);
        changed = true;
        anyResolved = true;
      }
    }
  }

  if (!anyResolved) {
    console.warn('[Tournament] resolveByeRounds: no work to do - caller is invoking the start-of-tournament path from a stale state');
  }

  saveTournament(tournament);
  return tournament;
}

// ─── Auto Resolution ─────────────────────────────────────────────────────────

/**
 * Auto-resolve all non-player matches that are ready.
 */
function autoResolveNonPlayerMatches(tournament) {
  const { matches, playerSeed } = tournament;

  propagateWinners(tournament);

  let resolved = true;
  while (resolved) {
    resolved = false;
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (match.winner !== null) continue;
      const [s1, s2] = match.bracketSlots;
      if (s1 === null || s2 === null) continue;
      if (s1 === playerSeed || s2 === playerSeed) continue;

      resolveMatch(match, s1, s2);
      resolved = true;
      propagateWinners(tournament);
    }
  }
}

/**
 * Auto-resolve all non-player matches in the same round as the given match index.
 * Called immediately after the player finishes their match so the whole round
 * completes at once.
 */
function autoResolveCurrentRound(tournament, playerMatchIndex) {
  const { matches, playerSeed, roundRanges } = tournament;

  // Find which round the player's match belongs to
  let roundStart = 0, roundEnd = matches.length - 1;
  if (roundRanges) {
    for (const range of roundRanges) {
      if (playerMatchIndex >= range.start && playerMatchIndex <= range.end) {
        roundStart = range.start;
        roundEnd = range.end;
        break;
      }
    }
  }

  // Resolve all non-player matches in this round
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = roundStart; i <= roundEnd; i++) {
      const match = matches[i];
      if (match.winner !== null) continue;
      const [s1, s2] = match.bracketSlots;
      if (s1 === null || s2 === null) continue;
      if (s1 === playerSeed || s2 === playerSeed) continue;

      resolveMatch(match, s1, s2);
      propagateWinners(tournament);
      changed = true;
    }
  }
}

/**
 * Resolve a single match with random outcome.
 * Win method is determined by score margin:
 *   Pin:            ~20% - match ends by fall
 *   Tech fall:      ~10% - 15+ point margin
 *   Major decision: ~20% - 8-14 point margin
 *   Decision:       ~50% - 1-7 point margin
 */
function resolveMatch(match, s1, s2) {
  const winner = Math.random() < 0.5 ? s1 : s2;
  match.winner = winner;

  const roll = Math.random();
  let winScore, loseScore;

  if (roll < 0.20) {
    // Pin - match ends early
    match.winMethod = 'pin';
    winScore = Math.floor(Math.random() * 10) + 2;
    loseScore = Math.floor(Math.random() * Math.min(winScore, 5));
  } else if (roll < 0.30) {
    // Tech fall - 15+ point margin
    match.winMethod = 'tech_fall';
    winScore = Math.floor(Math.random() * 6) + 15; // 15-20
    loseScore = Math.floor(Math.random() * (winScore - 14)); // 0 to (winScore-15)
  } else if (roll < 0.50) {
    // Major decision - 8-14 point margin
    match.winMethod = 'major_decision';
    const margin = Math.floor(Math.random() * 7) + 8; // 8-14
    loseScore = Math.floor(Math.random() * 6); // 0-5
    winScore = loseScore + margin;
  } else {
    // Decision - 1-7 point margin
    match.winMethod = 'decision';
    const margin = Math.floor(Math.random() * 7) + 1; // 1-7
    loseScore = Math.floor(Math.random() * 8); // 0-7
    winScore = loseScore + margin;
  }

  match.p1Score = winner === s1 ? winScore : loseScore;
  match.p2Score = winner === s1 ? loseScore : winScore;
}

// ─── Sequential Simulation ───────────────────────────────────────────────────

/**
 * Resolve exactly ONE non-player match that is ready.
 * Returns match result info or null if no matches to resolve.
 */
export function resolveNextNonPlayerMatch(tournament) {
  const { matches, bracket, playerSeed } = tournament;

  propagateWinners(tournament);

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (match.winner !== null) continue;
    const [s1, s2] = match.bracketSlots;
    if (s1 === null || s2 === null) continue;
    if (s1 === playerSeed || s2 === playerSeed) continue;

    resolveMatch(match, s1, s2);
    propagateWinners(tournament);
    saveTournament(tournament);

    return {
      matchIndex: i,
      winnerName: bracket[match.winner]?.name,
      loserName: bracket[match.winner === s1 ? s2 : s1]?.name,
      p1Score: match.p1Score,
      p2Score: match.p2Score,
      winMethod: match.winMethod,
    };
  }

  return null;
}

// ─── Match Navigation ────────────────────────────────────────────────────────

/**
 * Get the player's next match info.
 */
export function getNextMatch(tournament) {
  const { matches, bracket, playerSeed } = tournament;

  // MIRROR: keep in sync with TournamentBracket.findPlayerNextMatch.
  const isElimFormat = tournament.tournamentFormat === 'double_elim' || tournament.tournamentFormat === 'consolation';

  // Player slot must exist - generateOpponent reads bracket[playerSeed].name
  // and would throw on undefined. A missing player slot means the bracket
  // itself is corrupted; skip to a null return so the caller can recover.
  if (!bracket?.[playerSeed]) return null;

  // Loser bracket (consolation / double-elim) is only relevant after one loss.
  if (isElimFormat && tournament.playerLosses === 1) {
    for (let i = 0; i < tournament.losersMatches.length; i++) {
      const match = tournament.losersMatches[i];
      if (match.winner !== null) continue;
      const [s1, s2] = match.bracketSlots;
      if (s1 === playerSeed || s2 === playerSeed) {
        const opponentSeed = s1 === playerSeed ? s2 : s1;
        if (opponentSeed === null) continue;
        const opponent = bracket[opponentSeed];
        if (!opponent) continue;
        const scaledOpponent = generateOpponent('sf', tournament.difficulty, new Set([bracket[playerSeed].name]), []);
        return {
          matchIndex: `losers_${i}`,
          opponent: { ...opponent, stats: scaledOpponent.stats },
          round: `Losers Round ${i + 1}`,
          roundKey: 'sf',
        };
      }
    }
  }

  // True finals can be the player's next match for either side - the WB
  // champion (playerLosses=0, set by setupTrueFinals after winning the WB
  // final) or the LB champion (playerLosses=1, after winning the LB final).
  // The previous version nested this inside the playerLosses===1 block,
  // which left the WB champion stranded with no nextMatch and a dead
  // "Begin!" button on the bracket screen.
  if (isElimFormat && tournament.trueFinalsMatch && tournament.trueFinalsMatch.winner === null) {
    const tf = tournament.trueFinalsMatch;
    const [s1, s2] = tf.bracketSlots;
    if (s1 === playerSeed || s2 === playerSeed) {
      const opponentSeed = s1 === playerSeed ? s2 : s1;
      if (opponentSeed !== null) {
        const opponent = bracket[opponentSeed];
        if (opponent) {
          const scaledOpponent = generateOpponent('finals', tournament.difficulty, new Set([bracket[playerSeed].name]), []);
          return {
            matchIndex: 'true_finals',
            opponent: { ...opponent, stats: scaledOpponent.stats },
            round: 'True Finals',
            roundKey: 'finals',
          };
        }
      }
    }
  }

  // Standard winner bracket
  for (let i = 0; i < matches.length; i++) {
    const [s1, s2] = matches[i].bracketSlots;
    if (matches[i].winner !== null) continue;
    if (s1 === playerSeed || s2 === playerSeed) {
      const opponentSeed = s1 === playerSeed ? s2 : s1;
      if (opponentSeed === null) continue;
      const opponent = bracket[opponentSeed];
      if (!opponent) continue;

      const roundKey = getRoundKeyForMatch(tournament, i);
      const roundLabel = getRoundLabel(tournament, i);

      const scaledOpponent = generateOpponent(
        roundKey,
        tournament.difficulty,
        new Set([bracket[playerSeed].name]),
        []
      );

      return {
        matchIndex: i,
        opponent: { ...opponent, stats: scaledOpponent.stats },
        round: roundLabel,
        roundKey,
      };
    }
  }

  return null;
}

/**
 * Find the player's next unresolved match WITHOUT applying difficulty
 * scaling. Used by the TournamentBracket UI for "Next: [Round] vs [Name]"
 * preview. Mirrors getNextMatch's traversal but returns the raw bracket
 * entry as `opponent` so the bracket UI can read appearance + name without
 * triggering a generateOpponent call.
 *
 * Returns null when no playable next match exists.
 */
/**
 * True when the player has not yet had any bracket match resolved (i.e.,
 * the upcoming or just-finished match is the player's FIRST in this
 * tournament). Used by saveMatchResult to credit the Bracket Regular
 * achievement exactly once per tournament run, regardless of bracket size.
 *
 * Counts only resolved matches (`winner !== null`). At save-time the
 * just-finished match's winner is set on matchState but NOT yet propagated
 * to tournament.matches via advanceMatch, so a count of zero uniquely
 * identifies the entry round.
 *
 * Returns false on missing/malformed input so the caller can short-circuit
 * without try/catch noise.
 */
export function isPlayerFirstBracketMatch(tournament) {
  if (!tournament || !Array.isArray(tournament.matches)) return false;
  const playerSeed = tournament.playerSeed ?? 0;
  for (const m of tournament.matches) {
    if (Array.isArray(m.bracketSlots)
        && m.bracketSlots.includes(playerSeed)
        && m.winner !== null) {
      return false;
    }
  }
  return true;
}

export function findPlayerNextMatch(tournament) {
  const { matches, bracket, playerSeed } = tournament;

  // Consolation match (3rd-place / placement bracket).
  if (tournament.inConsolation && tournament.consolationMatch && !tournament.consolationMatch.winner) {
    const cm = tournament.consolationMatch;
    const [s1, s2] = cm.bracketSlots;
    const opponentSeed = s1 === playerSeed ? s2 : s1;
    // Guard bracket[opponentSeed] in addition to opponentSeed: a stale or
    // partially-rebuilt bracket can leave a hole that would otherwise flow
    // through as `opponent: undefined` and crash the UI on `.name`.
    if (opponentSeed !== null && bracket[opponentSeed]) {
      return {
        matchIndex: 'consolation',
        opponent: bracket[opponentSeed],
        round: '3rd Place',
      };
    }
  }

  // MIRROR: keep in sync with getNextMatch.
  const isElimFormat = tournament.tournamentFormat === 'double_elim' || tournament.tournamentFormat === 'consolation';

  // Loser bracket only matters after one loss.
  if (isElimFormat && tournament.playerLosses === 1 && tournament.losersMatches) {
    for (let i = 0; i < tournament.losersMatches.length; i++) {
      const match = tournament.losersMatches[i];
      if (match.winner !== null) continue;
      const [s1, s2] = match.bracketSlots;
      if (s1 === playerSeed || s2 === playerSeed) {
        const opponentSeed = s1 === playerSeed ? s2 : s1;
        if (opponentSeed === null) continue;
        if (!bracket[opponentSeed]) continue;
        return {
          matchIndex: `losers_${i}`,
          opponent: bracket[opponentSeed],
          round: `Losers Round ${i + 1}`,
        };
      }
    }
  }

  // True finals can be the player's next match for either side - WB champ
  // (playerLosses=0) or LB champ (playerLosses=1).
  if (isElimFormat && tournament.trueFinalsMatch && tournament.trueFinalsMatch.winner === null) {
    const tf = tournament.trueFinalsMatch;
    const [s1, s2] = tf.bracketSlots;
    if (s1 === playerSeed || s2 === playerSeed) {
      const opponentSeed = s1 === playerSeed ? s2 : s1;
      if (opponentSeed !== null && bracket[opponentSeed]) {
        return {
          matchIndex: 'true_finals',
          opponent: bracket[opponentSeed],
          round: 'True Finals',
        };
      }
    }
  }

  // Standard winner bracket
  for (let i = 0; i < matches.length; i++) {
    const [s1, s2] = matches[i].bracketSlots;
    if (matches[i].winner !== null) continue;
    if (s1 === playerSeed || s2 === playerSeed) {
      const opponentSeed = s1 === playerSeed ? s2 : s1;
      if (opponentSeed === null) continue;
      if (!bracket[opponentSeed]) continue;
      const roundLabel = getRoundLabel(tournament, i);
      return {
        matchIndex: i,
        opponent: bracket[opponentSeed],
        round: roundLabel,
      };
    }
  }
  return null;
}

// ─── Match Advancement ───────────────────────────────────────────────────────

/**
 * Record the result of the player's match and advance the bracket.
 */
export function advanceMatch(tournament, result) {
  const nextMatch = getNextMatch(tournament);
  if (!nextMatch) return tournament;

  const { matchIndex } = nextMatch;

  // Handle consolation match
  if (matchIndex === 'consolation') {
    return advanceConsolation(tournament, result);
  }

  // Handle loser bracket match
  if (typeof matchIndex === 'string' && matchIndex.startsWith('losers_')) {
    return advanceLoserMatch(tournament, result, matchIndex);
  }

  // Handle true finals
  if (matchIndex === 'true_finals') {
    return advanceTrueFinals(tournament, result);
  }

  // Standard winner bracket match
  const match = tournament.matches[matchIndex];
  const [s1, s2] = match.bracketSlots;
  const playerIsS1 = s1 === tournament.playerSeed;

  if (result.playerWon) {
    match.winner = tournament.playerSeed;
    match.p1Score = playerIsS1 ? result.p1Score : result.p2Score;
    match.p2Score = playerIsS1 ? result.p2Score : result.p1Score;
    match.winMethod = result.winMethod;
    tournament.roundsWon++;
  } else {
    const opponentSeed = playerIsS1 ? s2 : s1;
    match.winner = opponentSeed;
    match.p1Score = playerIsS1 ? result.p1Score : result.p2Score;
    match.p2Score = playerIsS1 ? result.p2Score : result.p1Score;
    match.winMethod = result.winMethod;

    // Consolation and double elimination both use losers bracket
    // First loss → losers bracket, second loss → eliminated
    // Auto-resolve remaining matches in the same round
    propagateWinners(tournament);
    autoResolveCurrentRound(tournament, matchIndex);
    propagateWinners(tournament);

    if ((tournament.tournamentFormat === 'consolation' || tournament.tournamentFormat === 'double_elim') && tournament.playerLosses === 0) {
      tournament.playerLosses = 1;
      routeToLoserBracket(tournament, matchIndex);
      autoResolveLBNonPlayerMatches(tournament);
      tournament.phase = 'bracket';
      saveTournament(tournament);
      return tournament;
    }

    tournament.playerEliminated = true;
    tournament.phase = 'simulating';
    saveTournament(tournament);
    return tournament;
  }

  // Auto-resolve remaining matches in the same round instantly
  propagateWinners(tournament);
  autoResolveCurrentRound(tournament, matchIndex);
  propagateWinners(tournament);

  // Check if tournament is complete (won finals)
  const finalsIndex = tournament.matches.length - 1;
  if (matchIndex === finalsIndex && result.playerWon) {
    if (tournament.tournamentFormat === 'double_elim' || tournament.tournamentFormat === 'consolation') {
      // Winner bracket champion needs an LB champion to face in true finals.
      // If the player went undefeated, no loss ever routed a wrestler into
      // the LB and the skeleton is still empty - that left the tournament
      // stuck with no nextMatch and phase 'bracket'. Seed every WB loser
      // into the LB and auto-resolve it before staging true finals so the
      // LB champion exists when setupTrueFinals runs.
      if (tournament.playerLosses === 0) {
        populateAllWBLosersToLB(tournament);
        autoResolveLBNonPlayerMatches(tournament);
      }
      setupTrueFinals(tournament);
    } else {
      tournament.phase = 'complete';
    }
  } else {
    tournament.phase = 'bracket';
  }

  saveTournament(tournament);
  return tournament;
}

/**
 * Called when sequential simulation is complete.
 * Transitions from 'simulating' to 'bracket'.
 */
export function finishSimulation(tournament) {
  // For double-elim/consolation, populate LB with any WB losers that dropped
  // during this simulation cycle, then auto-sim non-player LB matches.
  if ((tournament.tournamentFormat === 'double_elim' || tournament.tournamentFormat === 'consolation')
      && tournament.playerLosses >= 1 && !tournament.playerEliminated) {
    populateAllWBLosersToLB(tournament);
    autoResolveLBNonPlayerMatches(tournament);
  }
  tournament.phase = tournament.playerEliminated ? 'complete' : 'bracket';
  saveTournament(tournament);
  return tournament;
}

// ─── Consolation ─────────────────────────────────────────────────────────────

function setupConsolation(tournament, lostMatchIndex) {
  // Find the other SF match and its loser
  const { roundRanges, matches, playerSeed } = tournament;
  const sfRange = roundRanges?.find(r => r.key === 'sf');
  if (!sfRange) {
    tournament.playerEliminated = true;
    tournament.phase = 'complete';
    saveTournament(tournament);
    return tournament;
  }

  let otherLoser = null;
  for (let i = sfRange.start; i <= sfRange.end; i++) {
    if (i === lostMatchIndex) continue;
    const m = matches[i];
    if (m.winner !== null) {
      const [s1, s2] = m.bracketSlots;
      otherLoser = m.winner === s1 ? s2 : s1;
    }
  }

  if (otherLoser === null) {
    // Other SF not resolved yet - will be resolved during simulation
    // Mark that consolation is pending
    tournament.inConsolation = true;
    tournament.consolationPending = true;
    tournament.consolationPlayerLostMatch = lostMatchIndex;
    tournament.phase = 'simulating';
    saveTournament(tournament);
    return tournament;
  }

  tournament.consolationMatch = {
    bracketSlots: [playerSeed, otherLoser],
    winner: null, p1Score: null, p2Score: null, winMethod: null,
  };
  tournament.inConsolation = true;
  tournament.phase = 'simulating';
  saveTournament(tournament);
  return tournament;
}

/**
 * Check and finalize consolation setup after simulation resolves remaining SF matches.
 */
export function checkConsolationSetup(tournament) {
  if (!tournament.consolationPending) return;
  const { roundRanges, matches, playerSeed } = tournament;
  const sfRange = roundRanges?.find(r => r.key === 'sf');
  if (!sfRange) return;

  const lostMatchIndex = tournament.consolationPlayerLostMatch;
  let otherLoser = null;
  for (let i = sfRange.start; i <= sfRange.end; i++) {
    if (i === lostMatchIndex) continue;
    const m = matches[i];
    if (m.winner !== null) {
      const [s1, s2] = m.bracketSlots;
      otherLoser = m.winner === s1 ? s2 : s1;
    }
  }

  if (otherLoser !== null) {
    tournament.consolationMatch = {
      bracketSlots: [playerSeed, otherLoser],
      winner: null, p1Score: null, p2Score: null, winMethod: null,
    };
    tournament.consolationPending = false;
    saveTournament(tournament);
  }
}

function advanceConsolation(tournament, result) {
  const cm = tournament.consolationMatch;
  const [s1, s2] = cm.bracketSlots;
  const playerIsS1 = s1 === tournament.playerSeed;

  if (result.playerWon) {
    cm.winner = tournament.playerSeed;
    tournament.roundsWon++;
  } else {
    cm.winner = playerIsS1 ? s2 : s1;
  }
  cm.p1Score = playerIsS1 ? result.p1Score : result.p2Score;
  cm.p2Score = playerIsS1 ? result.p2Score : result.p1Score;
  cm.winMethod = result.winMethod;

  tournament.phase = 'complete';
  saveTournament(tournament);
  return tournament;
}

// ─── Double Elimination ──────────────────────────────────────────────────────

function buildLoserBracket(tournament) {
  // Build a loser bracket sized to fully eliminate every WB loser down to
  // a single LB champion. Each WB match produces exactly one loser, so for
  // any WB shape (power-of-2 OR the 24-bracket play-in shape) the LB needs
  // (totalLosers - 1) elimination matches arranged in a halving ladder.
  //
  // The previous implementation hardcoded ladder sizes off `wbRounds` and
  // an arbitrary halving recipe. For 24-bracket it produced ~9 LB matches
  // (18 slots) which can't fit the 23 WB losers - populateAllWBLosersToLB
  // silently dropped the overflow and autoResolveLBNonPlayerMatches stalled
  // because winner-propagation couldn't find downstream null slots. The
  // bug surfaced as `phase = 'bracket'` with no nextMatch whenever a
  // 24-bracket consolation / double_elim player lost mid-bracket and tried
  // to climb the LB.
  //
  // The new layout is bracket-shape-agnostic: count losers, build matches
  // round-by-round halving until 1 LB champion. Slots stay [null, null]
  // until populateAllWBLosersToLB seeds them; autoResolveLBNonPlayerMatches
  // propagates winners to the next downstream null slot exactly as before.

  const { matches } = tournament;
  const totalLosers = matches.length; // 1 loser per WB match

  if (totalLosers < 2) {
    tournament.losersMatches = [];
    tournament.losersRoundRanges = [];
    return;
  }

  const losersMatches = [];
  const losersRoundRanges = [];
  let idx = 0;
  let entrants = totalLosers;
  let roundNum = 1;

  while (entrants > 1) {
    const matchesThisRound = Math.floor(entrants / 2);
    const byes = entrants % 2;
    const start = idx;
    for (let m = 0; m < matchesThisRound; m++) {
      losersMatches.push({
        bracketSlots: [null, null],
        winner: null, p1Score: null, p2Score: null, winMethod: null,
        feedsInto: null,
      });
      idx++;
    }
    const isFinals = (matchesThisRound + byes) === 1;
    losersRoundRanges.push({
      label: isFinals ? 'Losers Finals' : `Losers Round ${roundNum}`,
      key: isFinals ? 'finals' : 'sf',
      start,
      end: idx - 1,
    });
    entrants = matchesThisRound + byes;
    roundNum++;
  }

  tournament.losersMatches = losersMatches;
  tournament.losersRoundRanges = losersRoundRanges;
}

// ─── Loser Bracket Population Helpers ───────────────────────────────────────

function getLBSeeds(losersMatches) {
  const seeds = new Set();
  for (const m of losersMatches) {
    if (m.bracketSlots[0] !== null) seeds.add(m.bracketSlots[0]);
    if (m.bracketSlots[1] !== null) seeds.add(m.bracketSlots[1]);
  }
  return seeds;
}

/**
 * Collect every WB loser whose seed isn't already placed in the LB,
 * then fill them into available null LB slots in order.
 */
function populateAllWBLosersToLB(tournament) {
  const { matches, losersMatches } = tournament;
  if (!losersMatches?.length) return;

  const placed = getLBSeeds(losersMatches);
  const toPlace = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.winner === null) continue;
    const [s1, s2] = m.bracketSlots;
    const loser = m.winner === s1 ? s2 : s1;
    if (loser === null || placed.has(loser)) continue;
    toPlace.push(loser);
    placed.add(loser);
  }

  for (const seed of toPlace) {
    for (let i = 0; i < losersMatches.length; i++) {
      if (losersMatches[i].winner !== null) continue;
      const [s1, s2] = losersMatches[i].bracketSlots;
      if (s1 === null) { losersMatches[i].bracketSlots[0] = seed; break; }
      if (s2 === null) { losersMatches[i].bracketSlots[1] = seed; break; }
    }
  }
}

/**
 * Resolve any LB match where both slots are filled and neither is the player.
 * Propagates each winner to the next available LB slot and loops until stable.
 *
 * Only auto-resolves matches up to (and including) the player's current LB round.
 * This prevents pre-resolving future rounds before the player can advance there,
 * which would otherwise leave the player with no available match to play.
 */
function autoResolveLBNonPlayerMatches(tournament) {
  const { losersMatches, playerSeed, losersRoundRanges } = tournament;
  if (!losersMatches?.length) return;

  // Find the player's current (unresolved) LB match index
  let playerLBMatchIdx = -1;
  for (let i = 0; i < losersMatches.length; i++) {
    const m = losersMatches[i];
    if (m.winner !== null) continue;
    const [s1, s2] = m.bracketSlots;
    if (s1 === playerSeed || s2 === playerSeed) {
      playerLBMatchIdx = i;
      break;
    }
  }

  // Determine the upper bound for auto-resolution.
  // When the player has an upcoming LB match, only resolve within that same round
  // so future rounds are never settled before the player can reach them.
  let autoResolveEnd = losersMatches.length - 1; // default: allow all
  if (playerLBMatchIdx >= 0 && losersRoundRanges?.length) {
    for (const range of losersRoundRanges) {
      if (playerLBMatchIdx >= range.start && playerLBMatchIdx <= range.end) {
        autoResolveEnd = range.end;
        break;
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i <= autoResolveEnd; i++) {
      const m = losersMatches[i];
      if (m.winner !== null) continue;
      const [s1, s2] = m.bracketSlots;
      if (s1 === null || s2 === null) continue;
      if (s1 === playerSeed || s2 === playerSeed) continue;

      resolveMatch(m, s1, s2);
      changed = true;

      // Propagate winner to first available slot in a later LB match
      for (let j = i + 1; j < losersMatches.length; j++) {
        const next = losersMatches[j];
        if (next.winner !== null) continue;
        if (next.bracketSlots[0] === m.winner || next.bracketSlots[1] === m.winner) break;
        if (next.bracketSlots[0] === null) { next.bracketSlots[0] = m.winner; break; }
        if (next.bracketSlots[1] === null) { next.bracketSlots[1] = m.winner; break; }
      }
    }
  }
}

function routeToLoserBracket(tournament, lostMatchIndex) {
  populateAllWBLosersToLB(tournament);
  // Player has dropped out of the WB. Auto-resolve every remaining WB
  // match now so a wbChamp exists by the time the LB climber wins the
  // loser bracket and `setupTrueFinals` runs. Without this, WB rounds
  // past the player's exit round never resolve, `matches[last].winner`
  // stays null, and the LB-climber gets stuck in phase='simulating'
  // -> 'bracket' with no nextMatch (the LB-climber mirror of the P1
  // bug fixed at advanceMatch line 855). Re-populate LB afterwards to
  // capture losers from the freshly-resolved WB rounds.
  autoResolveNonPlayerMatches(tournament);
  populateAllWBLosersToLB(tournament);
}

/**
 * Populate LB with any unplaced WB losers, then auto-sim non-player LB matches.
 * Export this for the "Advance to Match" button in the bracket UI.
 */
export function advanceToLBMatch(tournament) {
  populateAllWBLosersToLB(tournament);
  autoResolveLBNonPlayerMatches(tournament);
  saveTournament(tournament);
  return tournament;
}

function advanceLoserMatch(tournament, result, matchIndexStr) {
  const idx = parseInt(matchIndexStr.replace('losers_', ''), 10);
  const match = tournament.losersMatches[idx];
  const [s1, s2] = match.bracketSlots;
  const playerIsS1 = s1 === tournament.playerSeed;

  if (result.playerWon) {
    match.winner = tournament.playerSeed;
    match.p1Score = playerIsS1 ? result.p1Score : result.p2Score;
    match.p2Score = playerIsS1 ? result.p2Score : result.p1Score;
    match.winMethod = result.winMethod;
    tournament.roundsWon++;

    // Propagate player's LB win to the next LB match's empty slot
    let playerPlaced = false;
    for (let j = idx + 1; j < tournament.losersMatches.length; j++) {
      const next = tournament.losersMatches[j];
      if (next.winner !== null) continue;
      if (next.bracketSlots[0] === tournament.playerSeed || next.bracketSlots[1] === tournament.playerSeed) {
        playerPlaced = true; break;
      }
      if (next.bracketSlots[0] === null) { next.bracketSlots[0] = tournament.playerSeed; playerPlaced = true; break; }
      if (next.bracketSlots[1] === null) { next.bracketSlots[1] = tournament.playerSeed; playerPlaced = true; break; }
    }

    // Fallback: if the next match has both slots pre-filled by WB dropdowns (no null
    // slot available), claim the match anyway by placing player against one of them.
    // This can happen when buildLoserBracket creates fewer rounds than a full double-elim
    // requires and populateAllWBLosersToLB fills a future match before the player arrives.
    if (!playerPlaced) {
      for (let j = idx + 1; j < tournament.losersMatches.length; j++) {
        const next = tournament.losersMatches[j];
        const [ns1, ns2] = next.bracketSlots;
        const opponentSeed = (ns1 !== null && ns1 !== tournament.playerSeed) ? ns1
                           : (ns2 !== null && ns2 !== tournament.playerSeed) ? ns2 : null;
        if (opponentSeed !== null) {
          next.bracketSlots = [opponentSeed, tournament.playerSeed];
          next.winner = null;
          next.p1Score = null;
          next.p2Score = null;
          next.winMethod = null;
          playerPlaced = true;
          break;
        }
      }
    }

    // Check if won losers finals → setup true finals
    if (idx === tournament.losersMatches.length - 1) {
      setupTrueFinals(tournament);
    } else {
      tournament.phase = 'simulating';
    }
  } else {
    match.winner = playerIsS1 ? s2 : s1;
    match.p1Score = playerIsS1 ? result.p1Score : result.p2Score;
    match.p2Score = playerIsS1 ? result.p2Score : result.p1Score;
    match.winMethod = result.winMethod;
    tournament.playerLosses = 2;
    tournament.playerEliminated = true;
    tournament.phase = 'simulating';
  }

  saveTournament(tournament);
  return tournament;
}

function setupTrueFinals(tournament) {
  // WB champion vs LB champion
  const wbChamp = tournament.matches[tournament.matches.length - 1].winner;
  const lbChamp = tournament.losersMatches.length > 0
    ? tournament.losersMatches[tournament.losersMatches.length - 1].winner
    : null;

  if (wbChamp !== null && lbChamp !== null) {
    tournament.trueFinalsMatch = {
      bracketSlots: [wbChamp, lbChamp],
      winner: null, p1Score: null, p2Score: null, winMethod: null,
    };
    tournament.phase = 'bracket';
  } else {
    tournament.phase = 'simulating';
  }
  saveTournament(tournament);
}

function advanceTrueFinals(tournament, result) {
  const tf = tournament.trueFinalsMatch;
  const [s1, s2] = tf.bracketSlots;
  const playerIsS1 = s1 === tournament.playerSeed;

  if (result.playerWon) {
    tf.winner = tournament.playerSeed;
    tournament.roundsWon++;
  } else {
    tf.winner = playerIsS1 ? s2 : s1;
    // True finals is one decisive match in this codebase (no wrestling
    // bracket-reset semantics even though real double-elim allows one).
    // Whoever loses here is the placement-2 finalist regardless of which
    // side they came from (WB champ with playerLosses=0, or LB climber
    // with playerLosses=1). Always trip the eliminated flag so
    // computePlacement's `!playerEliminated -> placement 1` branch can't
    // award the championship to a finals-losing WB champ.
    tournament.playerLosses++;
    tournament.playerEliminated = true;
  }
  tf.p1Score = playerIsS1 ? result.p1Score : result.p2Score;
  tf.p2Score = playerIsS1 ? result.p2Score : result.p1Score;
  tf.winMethod = result.winMethod;

  tournament.phase = 'complete';
  saveTournament(tournament);
  return tournament;
}

// ─── Tournament Status ───────────────────────────────────────────────────────

/**
 * Check if the tournament is over.
 */
export function isTournamentOver(tournament) {
  return tournament.phase === 'complete';
}

/**
 * Calculate bonus XP for tournament performance.
 */
export function getTournamentXPBonus(tournament) {
  let bonus = tournament.roundsWon * 50;
  const isChampion = !tournament.playerEliminated &&
    tournament.roundsWon >= (tournament.playerRoundsToWin || 3);
  if (isChampion) {
    bonus += 200; // Champion bonus
  }
  return bonus;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function saveTournament(tournament) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...tournament,
      savedAt: Date.now(),
    }));
  } catch (e) {
    console.warn('[Tournament] Save error:', e);
  }
}

export function loadTournament() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - (data.savedAt || data.createdAt) > EXPIRY_MS) {
      clearTournament();
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

export function clearTournament() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

// ─── Legacy Compat ───────────────────────────────────────────────────────────
// Exported for backward compat - consumers should use getRoundLabel() instead
export const ROUND_LABELS = ['Quarterfinals', 'Quarterfinals', 'Quarterfinals', 'Quarterfinals',
                              'Semifinals', 'Semifinals', 'Finals'];
