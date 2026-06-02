// ─── Career Mode State Machine ──────────────────────────────────────────────
// Single-wrestler career from HS Freshman → College → Senior international.
// Phase A implements the HS vertical slice: create → preseason → in-season
// events → offseason advance → year 2 preseason. Skill tree, card unlocks,
// injuries, recruiting, and senior styles come in later phases (B-D).
//
// State is persisted to Firestore in the `users/{uid}/careers/{careerId}`
// subcollection so one career can grow large (12 seasons × ~20 events)
// without bloating the parent profile document.

import { getWeightsForTier, snapToValidWeight } from './careerWeights.js';
import { generateRivals, recordH2H, promoteToRival, RIVAL_PROMOTION_THRESHOLD, followRivalsToCollege, followRivalsToSenior, ensureChaseKamatsRival, feudLevel, FEUD_HOT } from './careerRivals.js';
import { generateSeasonSchedule, findNextEvent, summarizeSeason } from './careerSchedule.js';
import { CAREER_STARTER_DECK, WOMENS_CAREER_STARTER_ADD_ONS } from './careerStarterDeck.js';
import { xpForEventResult, seasonCompletionXp, applyXpToWrestler } from './careerLeveling.js';
import { generateExpandedRankingPool, updateRankingsWeekly, simWeekForPool, ensureSpecialAiWrestlers, ensureSpecialWomensAiWrestlers, SPECIAL_AI_WRESTLER_IDS } from './careerRankings.js';
import { PARTNERSHIP_ACTIVE as ELIJAH_PARTNERSHIP_ACTIVE } from './elijahJoles.js';
import { normalizeState, DEFAULT_STATE, getStatePrestige } from './careerStates.js';
import { rollDecisionEvent } from './careerDecisions.js';
import { generateCollegeOffers, makeWalkOnOffer, findCollegeById, pickRivalCollege } from './careerColleges.js';
import { recordSnapshot } from '../../../tools/bug-hunting/stateSnapshot.js';
import { validateCareer } from '../../../tools/bug-hunting/schemas/careerStateSchema.js';
import { repairCareer } from '../../../tools/bug-hunting/schemas/repair.js';
import { sanitizeTempBuffs, tickConsumedTempBuffs } from './careerMatchModifiers.js';
import { coachForTier, coachForCareerTier } from './careerCoach.js';
import { detectNewPrestigeBadges } from './careerTrophies.js';

// Career Depth Pass v1 (Step 5): "Giant Slayer" cut-off. An opponent counts
// as a giant when their overall ranks in the top 3 of the player's scope
// pool (sorted by overall, ties broken by first-appearance order).
const GIANT_SLAYER_RANK = 3;

const DEFAULT_STARTING_AGE = 14;
const MAX_SENIOR_YEARS = 8;

// Phases this client knows how to handle. Any phase outside this set is
// treated as forward-compat (a future client wrote a phase we don't
// recognize). UI surfaces an "Update required" banner instead of crashing.
export const KNOWN_PHASES = new Set([
  'preseason',
  'in_season',
  'offseason',
  'retired',
  'recruiting',
  'tier_transition',
  'senior_style_choice',
]);

// Stat caps and offseason base stat-point award by tier. HS wrestlers can't
// be 90+ overall - that's a college / senior-level athletic ceiling. Pool
// overall ranges in careerRankings.js are clamped to these same caps.
export const STAT_CAP_BY_TIER = { hs: 80, college: 90, senior: 99 };
// Bumped 3/2/1 -> 5/3/2 in the v5 stat-points round (Round 3, 2026-04-30)
// to give players more room to spec their wrestler. Pure constant change;
// applies to all future season transitions on new AND existing careers.
const OFFSEASON_BASE_BY_TIER = { hs: 5, college: 3, senior: 2 };

export function statCapForTier(tier) {
  return STAT_CAP_BY_TIER[tier] || 99;
}

// Add stat points without exceeding the wrestler's tier cap or producing
// negative pools. Returns `{ wrestler, granted }` so callers can show the
// actual amount granted (when capped, partial grant lands in the pool).
function addStatPoints(wrestler, amount) {
  if (!wrestler || !amount) return { wrestler, granted: 0 };
  const granted = Math.max(0, amount | 0);
  return {
    wrestler: { ...wrestler, statPointsAvailable: (wrestler.statPointsAvailable || 0) + granted },
    granted,
  };
}

/**
 * Player "overall" for ranking purposes - simple average of 5 stats.
 * Rankings compare player against a 24-wrestler NPC pool whose overalls
 * run 45-85, so this shares the same scale (stat baseline 55 → overall 55).
 */
function computePlayerOverall(stats) {
  if (!stats) return 55;
  const { str = 55, spd = 55, tec = 55, end = 55, grt = 55 } = stats;
  return Math.round((str + spd + tec + end + grt) / 5);
}

// ─── Creation ────────────────────────────────────────────────────────────────

/**
 * Create a fresh career. Called from the new-career wizard after the user
 * picks name + weight. Returns the full career object; caller is
 * responsible for persisting to Firestore (see firestoreService.saveCareer).
 *
 * Corner is intentionally not a career-level setting: it flips per match
 * like real wrestling (home vs away, bracket position), so it belongs on
 * the event/match, not the wrestler.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {number} opts.weightClass  // must be in HS_WEIGHTS
 * @param {string} [opts.state]      // 2-letter US state code (e.g. 'PA'); defaults to PA
 * @param {string} [opts.gender]     // 'male' | 'female'; defaults to 'male'
 * @param {object} [opts.appearance]
 * @param {object} [opts.stats]      // defaults to 55/55/55/55/55 (slightly below avg)
 * @param {() => number} [opts.rng]
 */
export function createCareer({ name, weightClass, state, gender = 'male', appearance = null, stats, rng = Math.random }) {
  recordSnapshot('career.create', { name, weightClass, state, gender, tier: 'hs', year: 1 });
  const isFemale = gender === 'female';
  const hsWeights = getWeightsForTier('hs', isFemale ? 'womens_freestyle' : 'folkstyle', gender);
  if (!hsWeights.includes(weightClass)) {
    throw new Error(`Invalid HS weight class: ${weightClass}. Valid: ${hsWeights.join(', ')}`);
  }

  const startingStats = stats || { str: 55, spd: 55, tec: 55, end: 55, grt: 55 };
  const id = `career_${Date.now()}_${Math.floor(rng() * 1e9).toString(36)}`;
  const now = Date.now();
  const stateCode = normalizeState(state);

  const wrestler = {
    name,
    appearance,
    gender,
    tier: 'hs',
    year: 1,
    age: DEFAULT_STARTING_AGE,
    weightClass,
    state: stateCode,
    stats: { ...startingStats },
    // v5 starting allocation: 10 unspent stat points so brand-new wrestlers
    // can pick up some early-spec choices before the first offseason award.
    // Existing careers receive the same +10 once via the v4->v5 hydrate
    // step in hydrateCareer below.
    statPointsAvailable: 10,
    // Phase B: career XP + level. Leveling up grants skill points spendable
    // on the skill tree to unlock new cards. See careerLeveling.js.
    xp: 0,
    level: 1,
    skillTree: {
      unlockedNodes: [],
      pointsAvailable: 0,
      focus: null,
    },
    // Phase B: card gating via starter deck + skill tree unlocks. Loaders
    // treat this as the player's full card pool - empty would lock them out.
    // v7: female careers also get the women's-specific signature cards
    // (gut wrench to leg lace, ankle pick, russian tie, bridge and turn,
    // belly-down defense). They stay dormant at HS/college (which wrestle
    // folkstyle) and surface at senior tier when style is womens_freestyle.
    unlockedCardIds: gender === 'female'
      ? [...CAREER_STARTER_DECK, ...WOMENS_CAREER_STARTER_ADD_ONS]
      : [...CAREER_STARTER_DECK],
    injuries: [],
    // Career Depth Pass v1: explicitly init tempBuffs so hydrate's v8
    // short-circuit returns a clean state without re-sanitizing.
    tempBuffs: [],
    school: null,
  };

  const rivals = generateRivals({ weightClass, tier: 'hs', style: 'folkstyle', gender, rng });
  const events = generateSeasonSchedule({
    tier: 'hs',
    seasonYear: 1,
    year: 1,
    weightClass,
    style: 'folkstyle',
    gender,
    rivals,
    rng,
    scheduleVersion: 1, // v9: new careers always get the expanded schedule.
  });

  // Seed the expanded ranking pool (~125 NPCs tagged by scope:
  // 'conference' | 'section' | 'state'). Player's conference/section/
  // state rank is computed exactly against this flat pool each week,
  // and the rankings detail screen renders top 25 / 50 / 100 views.
  // State difficulty modifier shifts pool overall ranges (PA = harder).
  // v7: gender threaded through so women's careers seed the women's
  // canonical pool (Valerie Aikens + close-behind 4 + women's first-name pool).
  const basePool = generateExpandedRankingPool({ weightClass, tier: 'hs', state: stateCode, gender, rng });

  // Inject rivals into the ranking pool so they have real season W-L from
  // the weekly sim and a real rank. Top 2 → section scope (so they sit
  // higher in the rivals snapshot UI), rest → conference scope. Skip any
  // rival whose id is already in basePool - the special-NPC injection
  // (Chase Kamats) lives in basePool with the same id as the Chase rival,
  // so without this dedup he'd show up twice in the pool.
  const basePoolIds = new Set(basePool.map(p => p?.id).filter(Boolean));
  const rivalsSorted = [...rivals].sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const rankingPool = [
    ...basePool,
    ...rivalsSorted
      .filter(r => !basePoolIds.has(r.id))
      .map((r, idx) => ({
        id: r.id,
        name: r.name,
        school: r.school,
        overall: r.overall,
        weightClass: r.weightClass,
        tier: r.tier,
        scope: idx < 2 ? 'section' : 'conference',
        isRival: true,
        wins: 0,
        losses: 0,
      })),
  ];
  const confPoolSize = rankingPool.filter(w => w.scope === 'conference').length || 24;
  const sectionPoolSize = rankingPool.filter(w => w.scope === 'conference' || w.scope === 'section').length || 60;
  const statePoolSize = rankingPool.length || 125;

  return {
    id,
    // CAREER_SHAPE_VERSION: keep new careers stamped at the current
    // version so they short-circuit hydrateCareer on first load. Without
    // this, a brand-new career stamped at v3 would route through the
    // v4 ranking-pool migration AND the v5 +10 stat-points backfill,
    // ending up with 20 unspent points instead of the intended 10.
    version: CAREER_SHAPE_VERSION,
    createdAt: now,
    updatedAt: now,
    wrestler,
    deck: {
      cardIds: [],     // Phase A: empty = use active deck / full pool
      history: [],
    },
    schedule: {
      seasonYear: 1,
      events,
      currentEventIdx: 0,
    },
    rivals,
    rankingPool,
    rankings: {
      conference: Math.ceil(confPoolSize / 2),
      section: Math.ceil(sectionPoolSize / 2),
      state: Math.ceil(statePoolSize / 2),
      asOfEventIdx: 0,
    },
    record: {
      seasonWins: 0,
      seasonLosses: 0,
      careerWins: 0,
      careerLosses: 0,
      pins: 0,
      techs: 0,
      majorDecs: 0,
      nearFalls: 0,
      titles: [],
    },
    // Career Depth Pass v1: per-season counters + badge eligibility.
    // New careers are immediately badge-eligible (this season). Hydrated
    // legacy careers get `currentSeasonYear + 1` so existing players
    // can't get a surprise badge mid-season.
    seasonMeta: {
      debuffEventCount: 0,
      pinsThisSeason: 0,
      giantSlayerWinsThisSeason: 0,
      badgeEligibleSeasonYear: 1,
      badgeEligibleFromVersion: CAREER_SHAPE_VERSION,
      scheduleVersion: 1, // v9: stamps the schedule template version that produced `events`.
    },
    prestigeBadges: [],
    coach: coachForTier('hs'),
    phase: 'preseason',
  };
}

// ─── Mutation helpers (all pure, return new career object) ──────────────────

export function startSeason(career) {
  recordSnapshot('career.startSeason', { tier: career?.wrestler?.tier, year: career?.wrestler?.year, season: career?.season });
  return { ...career, phase: 'in_season', updatedAt: Date.now() };
}

/**
 * Apply a SINGLE bracket match within a career-mode tournament. Used so
 * the player's overall W/L counter ticks up after every match instead of
 * waiting until the tournament event finalizes via recordEventResult.
 *
 * Increments season + career wins/losses, plus the per-method counters
 * (pins / techs / majorDecs). Stamps the schedule event with
 * `interimMatchesAccounted: true` so recordEventResult later skips
 * re-adding the aggregate W/L (which would double-count).
 *
 * @param {object} career
 * @param {string} eventId
 * @param {{ playerWon: boolean, winMethod?: string }} matchResult
 * @param {object} [opts]
 * @param {string|null} [opts.opponentNpcId]  Career Depth Pass v1: stable
 *   identity of the bracket-round opponent. When provided AND it matches a
 *   rival in career.rivals, recordH2H is called so per-round wins against
 *   rivals (the Phase C tournament path) finally update the H2H counters.
 * @returns {object} updated career (or the original ref if no change)
 */
export function applyInterimTournamentMatch(career, eventId, matchResult, opts = {}) {
  if (!career || !eventId || !matchResult) return career;
  const events = career.schedule?.events;
  if (!Array.isArray(events)) return career;
  const idx = events.findIndex(e => e.id === eventId);
  if (idx < 0) return career;

  const playerWon = !!matchResult.playerWon;
  const winMethod = matchResult.winMethod || 'decision';

  const record = { ...career.record };
  if (playerWon) {
    record.seasonWins = (record.seasonWins || 0) + 1;
    record.careerWins = (record.careerWins || 0) + 1;
    if (winMethod === 'pin') {
      record.pins = (record.pins || 0) + 1;
    } else if (winMethod === 'tech_fall' || winMethod === 'tech') {
      record.techs = (record.techs || 0) + 1;
    } else if (winMethod === 'major' || winMethod === 'major_decision') {
      record.majorDecs = (record.majorDecs || 0) + 1;
    }
  } else {
    record.seasonLosses = (record.seasonLosses || 0) + 1;
    record.careerLosses = (record.careerLosses || 0) + 1;
  }

  // Career Depth Pass v1: per-round H2H. When the caller threads the
  // bracket opponent's npcId AND it matches a tracked rival, fold the
  // round result into the rival's H2H. Backward-compatible: opts may be
  // omitted and the function behaves as before.
  let rivals = career.rivals;
  const opponentNpcId = opts.opponentNpcId || null;
  if (opponentNpcId && Array.isArray(rivals) && rivals.some(r => r.id === opponentNpcId)) {
    rivals = recordH2H(rivals, opponentNpcId, {
      playerWon,
      winMethod,
      eventId,
    });
  }

  // Career Depth Pass v1 (Step 5 fix): tournament Giant Slayer counter.
  // recordEventResult only counts duals via finishedEvent.opponent; tournament
  // rounds were invisible. When the round opponent is in the top GIANT_SLAYER_RANK
  // of the active pool, bump seasonMeta.giantSlayerWinsThisSeason now so the
  // badge can detect a tournament-route win at season-end.
  let nextSeasonMeta = career.seasonMeta;
  if (playerWon && opponentNpcId) {
    // Prefer per-style pool when available (senior men). Fall back to the
    // singular pool. We sort by overall (ties broken by current pool order).
    const event = events[idx];
    const eventStyle = event?.style;
    const dualPool = career.rankingPools && eventStyle ? career.rankingPools[eventStyle] : null;
    const pool = Array.isArray(dualPool) && dualPool.length > 0
      ? dualPool
      : (career.rankingPool || []);
    if (Array.isArray(pool) && pool.length > 0) {
      const sortedByOverall = pool.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0));
      const oppIdx = sortedByOverall.findIndex(p => p && p.id === opponentNpcId);
      if (oppIdx >= 0 && oppIdx < GIANT_SLAYER_RANK) {
        const prev = career.seasonMeta || {
          debuffEventCount: 0,
          pinsThisSeason: 0,
          giantSlayerWinsThisSeason: 0,
          badgeEligibleSeasonYear: career.schedule?.seasonYear || 1,
          badgeEligibleFromVersion: CAREER_SHAPE_VERSION,
        };
        nextSeasonMeta = {
          ...prev,
          giantSlayerWinsThisSeason: (prev.giantSlayerWinsThisSeason || 0) + 1,
        };
      }
    }
  }

  const nextEvent = { ...events[idx], interimMatchesAccounted: true };
  const nextEvents = [...events];
  nextEvents[idx] = nextEvent;

  return {
    ...career,
    record,
    rivals,
    schedule: { ...career.schedule, events: nextEvents },
    seasonMeta: nextSeasonMeta,
    updatedAt: Date.now(),
  };
}

/**
 * Record the result of a career event. Updates the event's status, H2H on
 * rival opponents, season/career W-L, and titles. Moves currentEventIdx
 * forward. If it was the final event, transitions phase to 'offseason'.
 *
 * @param {object} career
 * @param {string} eventId
 * @param {object} result
 * @param {boolean} result.playerWon
 * @param {number} result.p1Score
 * @param {number} result.p2Score
 * @param {string} result.winMethod  // 'decision'|'pin'|'tech'|'major'|'forfeit'
 * @param {number} [result.placement] // for tournaments/championships (1 = won)
 * @param {number} [result.matchesWon]  // tournament: total bracket matches won by player
 * @param {number} [result.matchesLost] // tournament: total bracket matches lost by player (1 if eliminated, 0 if champion)
 * @param {number} [result.pinsInTournament]  // tournament: pin wins count (per-match accumulated)
 * @param {number} [result.techsInTournament] // tournament: tech-fall wins count (per-match accumulated)
 * @param {number} [result.majorsInTournament] // tournament: major decision wins count
 * @param {() => number} [result.rng]  // optional rng for the rankings sim
 * @param {string[]} [result.consumedBuffSourceIds]  // Career Depth Pass v1: tempBuff sourceIds the match consumed
 */
export function recordEventResult(career, eventId, result) {
  recordSnapshot('career.recordEventResult', { eventId, placement: result?.placement });
  // Defensive guard: hydrate hardens schedule, but a non-hydrated career
  // (e.g. raw Firestore read passed straight in) can still arrive without
  // schedule.events. Throw a clear error instead of "Undefined is not an
  // object" so callers can surface a useful toast.
  if (!career?.schedule || !Array.isArray(career.schedule.events)) {
    throw new Error('recordEventResult: career.schedule.events missing - hydrate the career before recording results');
  }
  const rng = result?.rng || Math.random;
  let events = career.schedule.events.map(e => {
    if (e.id !== eventId) return e;
    return {
      ...e,
      status: result.playerWon ? 'won' : 'lost',
      result: {
        p1Score: result.p1Score,
        p2Score: result.p2Score,
        winMethod: result.winMethod,
        placement: result.placement ?? (result.playerWon ? 1 : null),
        playedAt: Date.now(),
      },
    };
  });

  // Conditional Worlds / Olympics insertion. If the just-finished event was
  // a Trials event AND the player won (placement === 1), append the
  // corresponding World Championship or Olympic Games event to the schedule.
  // Player only sees these when they earn them.
  const justFinished = events.find(e => e.id === eventId);
  const trialsWon = justFinished
    && result.placement === 1
    && (justFinished.stakes === 'world_trials' || justFinished.stakes === 'olympic_trials');
  if (trialsWon) {
    const isOlympic = justFinished.stakes === 'olympic_trials';
    const seasonYear = career.schedule?.seasonYear || justFinished.seasonYear || 1;
    // Per-style routing. Bug fix: prior versions hardcoded the wrestler.style
    // and built a styleless followupId. On dual-style men (v7+) where the
    // wrestler can win BOTH Freestyle Trials and Greco Trials, the styleless
    // id collided and the second Worlds append was silently dropped. Style
    // now derives from the Trials event itself and is encoded in the id.
    const eventStyle = justFinished.style || career.wrestler.style || 'freestyle';
    const followupId = `evt_y${seasonYear}_w26_${eventStyle}_${isOlympic ? 'intgames' : 'worlds'}`;
    // v9: Worlds/Olympics field expands to 128 when the schedule that
    // produced this Trials event was v9. V0 careers keep their 16-bracket
    // Worlds intact (forward-only contract).
    const scheduleVersion = career.seasonMeta?.scheduleVersion || 0;
    const followupBracket = scheduleVersion >= 1 ? 128 : 16;
    if (!events.some(e => e.id === followupId)) {
      // Per-style displayed name: "World Championships F" / "World Championships G"
      // for dual-style men, just "World Championships" for women / single-style.
      // Only attaches a suffix when the trials carried a per-style name (e.g.,
      // "Freestyle World Team Trials"). For legacy single-style careers, the
      // generic name is preserved.
      const isPerStyle = /Freestyle|Greco/.test(justFinished.name || '');
      let displayName;
      if (isOlympic) {
        displayName = isPerStyle
          ? `International Games ${eventStyle === 'greco' ? 'G' : 'F'}`
          : 'International Games';
      } else {
        displayName = isPerStyle
          ? `World Championships ${eventStyle === 'greco' ? 'G' : 'F'}`
          : 'World Championships';
      }
      // v9: per-style weight for the appended Worlds/Olympics event. Greco
      // Trials @ 77kg must append Greco Worlds @ 77kg, not freestyle 74kg.
      // Same resolution order as buildEventFromTemplate: per-style weights map
      // first, then trials event's own weightClass (already per-style after
      // the schedule fix), then career.wrestler.weightClass (legacy fallback).
      const perStyleWeight = (career.wrestler?.weights
                              && Number.isFinite(career.wrestler.weights[eventStyle]))
        ? career.wrestler.weights[eventStyle]
        : null;
      const followupWeight =
        perStyleWeight
        ?? (Number.isFinite(justFinished.weightClass) ? justFinished.weightClass : null)
        ?? career.wrestler.weightClass;
      events = [
        ...events,
        {
          id: followupId,
          seasonYear,
          year: justFinished.year || career.wrestler.year,
          week: 26,
          type: 'championship',
          name: displayName,
          weightClass: followupWeight,
          style: eventStyle,
          status: 'upcoming',
          result: null,
          bracketSize: followupBracket,
          stakes: isOlympic ? 'olympics' : 'world_championship',
          seededRivalIds: (career.rivals || []).slice(0, 2).map(r => r.id),
        },
      ];
    }
  }

  // HS qualification gating. Real HS wrestling: you only advance to Regionals
  // if you place top-4 at Conference, and only to State if you place top-4
  // at Regionals. The schedule template includes all three so the player can
  // SEE the full path, but unqualified advancement events get pruned here so
  // they don't generate.
  //
  // Threshold = 4 (top 4 advance). Same threshold for both gates - this
  // matches NFHS rules in most states.
  const QUALIFY_THRESHOLD = 4;
  const justFinishedEvent = events.find(e => e.id === eventId);
  if (justFinishedEvent && career.wrestler.tier === 'hs') {
    // Use the same fallback the schedule event itself uses (line ~329):
    // if no explicit placement was passed but the player won, treat as
    // 1st place. Without this, a caller that passes `playerWon: true`
    // without `placement` (the simulate-week dual path is one example,
    // and any future caller could repeat the omission) would silently
    // prune downstream postseason events because `(undefined || 99)`
    // evaluates to 99 > 4. The schedule's recorded result and the gate
    // must agree.
    const inferredPlacement = result.placement
      ?? (result.playerWon ? 1 : null);
    const didNotQualify = inferredPlacement === null
      || inferredPlacement > QUALIFY_THRESHOLD;
    // v9: 4-level postseason chain (Conference -> District -> Regional ->
    // State). District is the new intermediate level. V0 schedules have no
    // 'district' events, so the new branch is a no-op there. Order matters:
    // each branch only prunes events DOWNSTREAM of where the player failed.
    if (didNotQualify && justFinishedEvent.stakes === 'conference') {
      // Failed conference: drop district + regional + state.
      events = events.filter(e =>
        e.stakes !== 'district' && e.stakes !== 'regional' && e.stakes !== 'state');
    } else if (didNotQualify && justFinishedEvent.stakes === 'district') {
      // Failed district: drop regional + state.
      events = events.filter(e => e.stakes !== 'regional' && e.stakes !== 'state');
    } else if (didNotQualify && justFinishedEvent.stakes === 'regional') {
      // Failed regional: drop state.
      events = events.filter(e => e.stakes !== 'state');
    }
  }

  const currentIdx = events.findIndex(e => e.id === eventId);
  const nextIdx = currentIdx >= 0 ? currentIdx + 1 : career.schedule.currentEventIdx;
  const seasonOver = nextIdx >= events.length;

  // Update H2H on rival opponents (duals only; tournaments handle rivals
  // per-bracket-match in Phase C).
  const finishedEvent = career.schedule.events.find(e => e.id === eventId);
  let rivals = career.rivals;
  if (finishedEvent?.opponentIsRival && finishedEvent.opponent?.id) {
    rivals = recordH2H(rivals, finishedEvent.opponent.id, {
      playerWon: result.playerWon,
      winMethod: result.winMethod,
      eventId,
    });
  }

  // Per-opponent meeting tracking. Promote a non-rival opponent into a rival
  // after RIVAL_PROMOTION_THRESHOLD meetings if their H2H is even or losing
  // to the player - that pattern reads as a developing rivalry.
  const opponent = finishedEvent?.opponent;
  let opponentMeetings = { ...(career.opponentMeetings || {}) };
  // v7: senior dual-style careers (men) carry per-style ranking pools in
  // `career.rankingPools[style]`. The pool we sim and update for THIS
  // event is the per-style pool when the event has a style and the
  // career has the per-style map; otherwise the singular `rankingPool`.
  // After updating, we mirror the new pool back to both `rankingPool`
  // (singular fallback) AND `rankingPools[event.style]` so subsequent
  // brackets and weekly sims see the same data.
  const eventStyle = finishedEvent?.style;
  const hasDualPools = career.rankingPools && eventStyle && career.rankingPools[eventStyle];
  let pool = hasDualPools
    ? career.rankingPools[eventStyle]
    : (career.rankingPool || []);
  if (opponent?.id && !finishedEvent?.opponentIsRival) {
    const prev = opponentMeetings[opponent.id] || { count: 0, wins: 0, losses: 0, pins: 0 };
    const next = {
      count: prev.count + 1,
      wins:  prev.wins  + (result.playerWon ? 1 : 0),
      losses: prev.losses + (result.playerWon ? 0 : 1),
      pins:  prev.pins  + ((result.playerWon && result.winMethod === 'pin') ? 1 : 0),
      lastMeeting: { eventId, playerWon: !!result.playerWon, winMethod: result.winMethod || null, at: Date.now() },
    };
    opponentMeetings[opponent.id] = next;

    const playerLosingOrEven = next.losses >= next.wins;
    const alreadyRival = rivals.some(r => r.id === opponent.id);
    if (next.count >= RIVAL_PROMOTION_THRESHOLD && playerLosingOrEven && !alreadyRival) {
      const poolEntry = pool.find(p => p.id === opponent.id) || {
        id: opponent.id,
        name: opponent.name,
        school: opponent.school,
        weightClass: opponent.weightClass,
        tier: opponent.tier,
        stats: opponent.stats,
        overall: opponent.overall,
      };
      rivals = promoteToRival(rivals, poolEntry, {
        wins: next.wins,
        losses: next.losses,
        pins: next.pins,
        lastMeeting: next.lastMeeting,
      });
      // Tag the pool entry as a rival so the snapshot UI can show the badge.
      pool = pool.map(p => p.id === opponent.id ? { ...p, isRival: true } : p);
    }
  }

  const record = { ...career.record };
  // Tournament events count individual bracket matches in W-L. matchesWon /
  // matchesLost come from tournamentState's bracket history. If unspecified
  // (e.g. dual events), fall back to the legacy +1 per event behavior.
  const wins   = typeof result.matchesWon  === 'number' ? result.matchesWon  : (result.playerWon ? 1 : 0);
  const losses = typeof result.matchesLost === 'number' ? result.matchesLost : (result.playerWon ? 0 : 1);
  // Pin / tech / major counters: tournaments pre-aggregate per-match counts;
  // duals use winMethod from the single match.
  const pinsToAdd   = typeof result.pinsInTournament  === 'number' ? result.pinsInTournament  : (result.playerWon && result.winMethod === 'pin'   ? 1 : 0);
  const techsToAdd  = typeof result.techsInTournament === 'number' ? result.techsInTournament : (result.playerWon && (result.winMethod === 'tech' || result.winMethod === 'tech_fall') ? 1 : 0);
  const majorsToAdd = typeof result.majorsInTournament === 'number' ? result.majorsInTournament : (result.playerWon && (result.winMethod === 'major' || result.winMethod === 'major_decision') ? 1 : 0);
  // Interim-match path (career tournaments): per-match calls to
  // applyInterimTournamentMatch already credited W/L + per-method counters
  // as the bracket progressed. Skip the aggregate add here so the player's
  // record doesn't double-count. Other downstream uses of `wins`/`losses`
  // (rankings sim, season-end specialty bonuses) still see the correct
  // total because they read from `record.seasonWins/...` after the merge.
  const interimAccounted = !!finishedEvent?.interimMatchesAccounted;
  if (!interimAccounted) {
    record.seasonWins   += wins;
    record.careerWins   += wins;
    record.seasonLosses += losses;
    record.careerLosses += losses;
    record.pins      = (record.pins      || 0) + pinsToAdd;
    record.techs     = (record.techs     || 0) + techsToAdd;
    record.majorDecs = (record.majorDecs || 0) + majorsToAdd;
  }
  record.nearFalls = record.nearFalls || 0;
  // Championship titles (placement === 1) AND tournament wins. Prestige is
  // computed from the wrestler's state difficulty tier - state-tier S/A title
  // = 'gold', B = 'silver', C/D = null. Tournament wins are mid-season opens
  // and don't carry state prestige (they're not championships).
  const grantsTrophy =
    (finishedEvent?.type === 'championship' && result.placement === 1 && finishedEvent.stakes) ||
    (finishedEvent?.type === 'tournament'   && result.placement === 1);

  // Source 3 - title bonus stats are awarded immediately when the title
  // is won (paid alongside the trophy). Bonus scales with prestige of the
  // championship: HS state +3 (+4 for gold-prestige states), regional +2,
  // conference +1; college conference +2, NCAA +5; senior US Open +2,
  // Trials +3, Worlds +6, Olympics +8. Tournament wins don't grant stats -
  // they're too frequent and would inflate the curve.
  let titleStatBonus = 0;
  let freshTrophy = null; // Career Depth Pass v1: exposed via lastEventTrophy
  if (grantsTrophy) {
    const isChampionship = finishedEvent?.type === 'championship';
    const stateCode = career.wrestler?.state || DEFAULT_STATE;
    const stakes = finishedEvent.stakes || null;
    const trophyType = isChampionship ? (stakes || 'championship') : 'tournament';
    // Prestige is set explicitly on the trophy entry so the trophy case
    // colors render gold/silver/bronze without a separate lookup. State
    // titles inherit state-difficulty prestige; elite titles (NCAA, Worlds,
    // Olympics) are always gold.
    let prestige = null;
    if (isChampionship) {
      if (stakes === 'state') {
        prestige = getStatePrestige(stateCode);
      } else if (stakes === 'ncaa' || stakes === 'world_championship' || stakes === 'olympics') {
        prestige = 'gold';
      } else if (stakes === 'conference_d1' || stakes === 'us_open' ||
                 stakes === 'world_trials' || stakes === 'olympic_trials' ||
                 stakes === 'regional' || stakes === 'district') {
        // v9: district is the new HS intermediate (between conference and
        // regional). Silver prestige matches regional - both are qualifying
        // tournaments rather than terminal championships.
        prestige = 'silver';
      }
    }

    if (isChampionship) {
      // HS
      if (stakes === 'state')             titleStatBonus = prestige === 'gold' ? 4 : 3;
      else if (stakes === 'regional')     titleStatBonus = 2;
      else if (stakes === 'district')     titleStatBonus = 2; // v9: same as regional - qualifying tier
      else if (stakes === 'conference')   titleStatBonus = 1;
      // College
      else if (stakes === 'ncaa')         titleStatBonus = 5;
      else if (stakes === 'conference_d1') titleStatBonus = 2;
      // Senior International
      else if (stakes === 'olympics')          titleStatBonus = 8;
      else if (stakes === 'world_championship') titleStatBonus = 6;
      else if (stakes === 'olympic_trials')    titleStatBonus = 4;
      else if (stakes === 'world_trials')      titleStatBonus = 3;
      else if (stakes === 'us_open')           titleStatBonus = 2;
    }

    freshTrophy = {
      id: `${trophyType}_y${career.schedule.seasonYear}_${Date.now()}`,
      name: isChampionship
        ? `${finishedEvent.name} Champion, Year ${career.schedule.seasonYear}`
        : `${finishedEvent.name}, Year ${career.schedule.seasonYear}`,
      type: trophyType,                    // 'tournament' | 'conference' | 'regional' | 'state' | 'championship'
      stakes,                              // 'conference' | 'regional' | 'state' | null
      state: stateCode,
      prestige,                            // 'gold' | 'silver' | null
      season: career.schedule.seasonYear,
      tier: career.wrestler?.tier || 'hs',
      weightClass: career.wrestler?.weightClass,
      wonAt: Date.now(),
    };
    record.titles = [...record.titles, freshTrophy];
  }

  // Award XP from this event (base + pin/tech/major bonus + placement/title).
  // Elite-title XP multipliers: gold-prestige championship = 1.5x, silver = 1.25x.
  // Applied to state titles, NCAA, World Championship, and Olympic gold so the
  // big finishes feel meaningfully bigger than a regular event win.
  let xpGained = xpForEventResult(
    {
      playerWon: result.playerWon,
      winMethod: result.winMethod,
      placement: result.placement,
    },
    finishedEvent?.type,
  );
  if (
    finishedEvent?.type === 'championship' &&
    result.placement === 1
  ) {
    const stakes = finishedEvent.stakes;
    const goldStakes = ['ncaa', 'world_championship', 'olympics'];
    // v9: 'district' carries silver XP multiplier, same tier as regional.
    const silverStakes = ['conference_d1', 'us_open', 'world_trials', 'olympic_trials', 'district'];
    let prestige = null;
    if (stakes === 'state') {
      prestige = getStatePrestige(career.wrestler?.state || DEFAULT_STATE);
    } else if (goldStakes.includes(stakes)) {
      prestige = 'gold';
    } else if (silverStakes.includes(stakes)) {
      prestige = 'silver';
    }
    if (prestige === 'gold')   xpGained = Math.round(xpGained * 1.5);
    else if (prestige === 'silver') xpGained = Math.round(xpGained * 1.25);
  }
  // Career Depth Pass v1 - Rivalry Heat XP bonus.
  // Dual events only (plan: tournament rivalry XP deferred to v1.1). When
  // the player wins a dual against a rival with feudLevel >= FEUD_HOT,
  // scale this event's career XP by 1.25. The breakdown row labelled
  // 'Rivalry +25%' is appended to lastEventXp.breakdown so MatchResultModal
  // can render a chip distinct from any profile-XP banner.
  let rivalryXpBonus = 0;
  const isDualEvent = finishedEvent?.type === 'dual' || finishedEvent?.type === 'dual_meet';
  if (
    isDualEvent &&
    result.playerWon &&
    finishedEvent?.opponentIsRival &&
    finishedEvent.opponent?.id
  ) {
    const rival = (career.rivals || []).find(r => r.id === finishedEvent.opponent.id);
    if (rival && feudLevel(rival.h2h) >= FEUD_HOT) {
      rivalryXpBonus = Math.round(xpGained * 0.25);
      xpGained = xpGained + rivalryXpBonus;
    }
  }
  let xpOut = applyXpToWrestler(career.wrestler, xpGained);

  // Season-completion bonus (+150). Awarded on the final event of the
  // season so the offseason screen renders with correct lastSeasonBonus
  // and XP/level values already reflecting the bonus. Previously this
  // was fired by advanceToNextSeason, which meant the offseason screen
  // showed stale/undefined bonus data until the user advanced.
  let seasonBonus = null;
  let seasonStatBonus = 0;
  if (seasonOver) {
    const seasonXp = seasonCompletionXp();
    const seasonOutAfter = applyXpToWrestler(xpOut.wrestler, seasonXp);
    seasonBonus = {
      xpGained: seasonXp,
      leveledUp: seasonOutAfter.leveledUp,
      skillPointsGained: seasonOutAfter.skillPointsGained,
      newLevel: seasonOutAfter.wrestler.level,
    };
    // Merge event-level-up and season-level-up into a single xpOut so the
    // returned wrestler has cumulative skill points from both awards.
    xpOut = {
      wrestler: seasonOutAfter.wrestler,
      leveledUp: xpOut.leveledUp || seasonOutAfter.leveledUp,
      skillPointsGained: xpOut.skillPointsGained + seasonOutAfter.skillPointsGained,
    };

    // Source 2 - end-of-season win % bonus stat points.
    const seasonW = record.seasonWins || 0;
    const seasonL = record.seasonLosses || 0;
    const totalMatches = seasonW + seasonL;
    if (totalMatches > 0) {
      const winPct = seasonW / totalMatches;
      if (winPct >= 0.90)      seasonStatBonus += 5;
      else if (winPct >= 0.75) seasonStatBonus += 3;
      else if (winPct >= 0.50) seasonStatBonus += 1;
      // Undefeated extra +1.
      if (seasonL === 0)       seasonStatBonus += 1;
    }

    // Source 4 - method specialty bonuses (style commitment).
    if ((record.pins || 0) >= 10)  seasonStatBonus += 1; // STR
    if ((record.techs || 0) >= 5)  seasonStatBonus += 1; // TEC
    if ((record.majorDecs || 0) >= 8 && seasonL < 3) seasonStatBonus += 1; // GRT
    // Domination: average match resolution under ~3 minutes is approximated
    // by pins+techs accounting for >= 50% of season wins.
    const fastWins = (record.pins || 0) + (record.techs || 0);
    if (seasonW >= 8 && fastWins / Math.max(1, seasonW) >= 0.5) seasonStatBonus += 1; // SPD
  }

  // Source 6 (v5, 2026-04-30) - per-event bonuses on top of the existing
  // title-stakes scaling. The user-requested numbers are intentionally
  // additive to titleStatBonus (which already varies +1..+8 by event
  // prestige) so a state-title gold finish gives prestige-bonus PLUS the
  // flat +2 here.
  //
  // Idempotency: `finishedEvent` was looked up from career.schedule.events
  // BEFORE the .map() that flips status. Its status is whatever the event
  // had on input - 'upcoming' the first time the event is recorded,
  // 'won'/'lost' on any subsequent re-record. We only grant the bonus on
  // the first record so a replayed call (e.g. UI retry) doesn't double
  // up. recordEventResult is normally called exactly once per event by
  // the existing flow, but the guard makes the contract explicit.
  let v5EventBonus = 0;
  const isFirstRecord = finishedEvent?.status === 'upcoming';
  if (isFirstRecord) {
    if (finishedEvent?.type === 'championship') {
      if (result.placement === 1) v5EventBonus += 2;
      else if (result.placement === 2) v5EventBonus += 1;
    }
    // +1 every 10-win milestone (10, 20, 30, ...). Compare pre-update
    // careerWins to the just-incremented value.
    const prevCareerWins = career.record?.careerWins || 0;
    if (Math.floor(record.careerWins / 10) > Math.floor(prevCareerWins / 10)) {
      v5EventBonus += 1;
    }
  }

  // Apply title-immediate (Source 3), season-end (Source 2 + 4), and
  // v5 per-event bonuses (Source 6) in one go. Cap is enforced when the
  // user spends.
  const totalStatBonus = (titleStatBonus || 0) + (seasonStatBonus || 0) + v5EventBonus;
  if (totalStatBonus > 0) {
    const added = addStatPoints(xpOut.wrestler, totalStatBonus);
    xpOut = { ...xpOut, wrestler: added.wrestler };
  }

  // Decision events (Source 5) - roll a 40% chance to surface a between-event
  // decision. Skipped when the season is over or the event was a championship
  // (no narrative space for "stay after practice" right before state finals).
  // Also skipped if there's already a pending decision the user hasn't
  // resolved yet - never queue more than one.
  let pendingDecision = career.pendingDecision || null;
  if (
    !seasonOver &&
    !pendingDecision &&
    finishedEvent?.type !== 'championship'
  ) {
    pendingDecision = rollDecisionEvent({
      rng,
      recentIds: career.recentDecisionIds || [],
    });
  }

  // Sim the rest of the conference one week forward and recompute ranks.
  // matchesPlayed: total bracket matches the player just contested in this
  // event (1 for a dual, N for a tournament). NPCs run that many sim passes
  // so their cumulative records keep pace with the player's match count -
  // otherwise the player goes 5-0 across one tournament while the top NPC
  // only sims 1 match and reads "1-0".
  const playerOverall = computePlayerOverall(xpOut.wrestler.stats);
  const matchesPlayedThisEvent = wins + losses;
  const ranked = updateRankingsWeekly({
    pool,
    playerWins: record.seasonWins,
    playerLosses: record.seasonLosses,
    playerOverall,
    asOfEventIdx: nextIdx,
    matchesPlayed: matchesPlayedThisEvent,
    rng,
  });

  // v7: if this is a dual-style senior career (men), update both the
  // per-style entry AND the singular fallback. The per-style pool is the
  // authoritative source for bracket builder lookups; the singular pool
  // is mirrored so legacy code paths (rivals snapshot, rankings detail
  // screen reading career.rankingPool) keep rendering the same data the
  // bracket sees. The OTHER style's pool (e.g. greco when this was a
  // freestyle event) is left untouched - no player results land there.
  const nextRankingPools = hasDualPools
    ? { ...career.rankingPools, [eventStyle]: ranked.pool }
    : undefined;

  // Elijah Joles featured-partnership: flip elijah_boss_available the first
  // time a male career wins a state title. Used by the Career Dashboard to
  // surface a one-time "Elijah wants the smoke" toast. The Boss Challenge
  // itself is always reachable from the home banner regardless of this flag -
  // this just unlocks the in-career notification path.
  const isStateTitle = finishedEvent?.stakes === 'state' && result.placement === 1;
  const elijahGateOk = career.wrestler?.gender !== 'female';
  const wasAvailable = !!career.elijah_boss_available;
  const wasSeen = !!career.elijah_boss_seen;
  const elijah_boss_available = wasAvailable
    || (ELIJAH_PARTNERSHIP_ACTIVE && isStateTitle && elijahGateOk && !wasSeen);

  // Career Depth Pass v1 (Step 5): season-only counters used by prestige
  // badge detectors. Increment here, fold into nextSeasonMeta below.
  let pinsThisSeasonDelta = 0;
  let giantSlayerWinsDelta = 0;
  if (result.playerWon) {
    // Pin counter: dual win-by-pin or pre-aggregated tournament pins. Mirrors
    // the existing record.pins logic but stays season-scoped so the badge
    // can reset on advanceToNextSeason without losing career totals.
    const seasonPinDelta = typeof result.pinsInTournament === 'number'
      ? result.pinsInTournament
      : (result.winMethod === 'pin' ? 1 : 0);
    pinsThisSeasonDelta = seasonPinDelta;
    // Giant slayer: dual win against an opponent whose overall ranks in the
    // top GIANT_SLAYER_RANK of the active pool. Pool is the same `pool`
    // variable already in scope (per-style for senior men, singular otherwise).
    const dualOpp = finishedEvent?.opponent;
    if (dualOpp?.id && Array.isArray(pool)) {
      const sortedByOverall = pool.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0));
      const oppIdx = sortedByOverall.findIndex(p => p && p.id === dualOpp.id);
      if (oppIdx >= 0 && oppIdx < GIANT_SLAYER_RANK) {
        giantSlayerWinsDelta = 1;
      }
    }
  }

  // Career Depth Pass v1: consume any tempBuffs the match used.
  // STRICT CONTRACT: only tick when the caller explicitly forwards a
  // consumedBuffSourceIds array (even if empty). Paths that bypass the
  // career match wiring (sim duals, sim tournaments, dual-meet bouts
  // without modifier integration) MUST omit the field; recordEventResult
  // then leaves tempBuffs untouched so a buff never quietly vanishes
  // without having been applied. The previous behaviour (always tick,
  // expire duration-1 buffs) caused decision debuffs to disappear and
  // wrongly increment seasonMeta.debuffEventCount on sim paths.
  const consumedSourceIds = result?.consumedBuffSourceIds;
  const callerWiredModifiers = Array.isArray(consumedSourceIds);
  const ticked = callerWiredModifiers
    ? tickConsumedTempBuffs(xpOut.wrestler, consumedSourceIds)
    : { wrestler: xpOut.wrestler, consumedBuffs: [] };
  const debuffHitsThisEvent = ticked.consumedBuffs.filter(b => b && b.debuff === true).length;
  const prevSeasonMeta = career.seasonMeta || {
    debuffEventCount: 0,
    pinsThisSeason: 0,
    giantSlayerWinsThisSeason: 0,
    badgeEligibleSeasonYear: career.schedule?.seasonYear || 1,
    badgeEligibleFromVersion: CAREER_SHAPE_VERSION,
  };
  const nextSeasonMeta = (debuffHitsThisEvent > 0 || pinsThisSeasonDelta > 0 || giantSlayerWinsDelta > 0)
    ? {
        ...prevSeasonMeta,
        debuffEventCount: (prevSeasonMeta.debuffEventCount || 0) + debuffHitsThisEvent,
        pinsThisSeason: (prevSeasonMeta.pinsThisSeason || 0) + pinsThisSeasonDelta,
        giantSlayerWinsThisSeason: (prevSeasonMeta.giantSlayerWinsThisSeason || 0) + giantSlayerWinsDelta,
      }
    : prevSeasonMeta;

  // Career Depth Pass v1 (Step 5) - Prestige badge detection (season-end only).
  // Gated on seasonMeta.badgeEligibleSeasonYear so legacy mid-season hydrated
  // careers naturally wait one season before earning anything.
  let newlyEarnedBadges = [];
  let nextPrestigeBadges = career.prestigeBadges || [];
  if (seasonOver) {
    const eligibleYear = nextSeasonMeta?.badgeEligibleSeasonYear ?? Infinity;
    const currentSeasonYear = career.schedule?.seasonYear || 1;
    if (currentSeasonYear >= eligibleYear) {
      // Build a synthetic post-event career snapshot for the detectors so
      // they read the same seasonMeta + record + lastEventTrophy values the
      // player will see on the result screen.
      const detectorCareer = {
        ...career,
        record,
        seasonMeta: nextSeasonMeta,
        prestigeBadges: nextPrestigeBadges,
        lastEventTrophy: freshTrophy,
      };
      newlyEarnedBadges = detectNewPrestigeBadges(detectorCareer);
      if (newlyEarnedBadges.length > 0) {
        nextPrestigeBadges = [...nextPrestigeBadges, ...newlyEarnedBadges];
      }
    }
  }

  return {
    ...career,
    wrestler: ticked.wrestler,
    schedule: {
      ...career.schedule,
      events,
      currentEventIdx: nextIdx,
    },
    rivals,
    opponentMeetings,
    pendingDecision,
    record,
    rankingPool: ranked.pool,
    ...(nextRankingPools ? { rankingPools: nextRankingPools } : {}),
    rankings: ranked.rankings,
    seasonMeta: nextSeasonMeta,
    lastEventXp: {
      xpGained,
      leveledUp: xpOut.leveledUp,
      skillPointsGained: xpOut.skillPointsGained,
      newLevel: xpOut.wrestler.level,
      statPointsGained: totalStatBonus,
      // Career Depth Pass v1: structured breakdown rows for UI labelling.
      // Currently just the rivalry +25% row (Step 2, duals only). Future
      // steps may append additional rows (e.g. coach bonus, badge XP).
      breakdown: rivalryXpBonus > 0
        ? [{ label: 'Rivalry +25%', amount: rivalryXpBonus }]
        : [],
    },
    // Career Depth Pass v1: ephemeral UI handoff fields. Step 4 wires
    // lastEventTrophy from the freshly-minted championship/tournament
    // trophy (null for non-grant events). Step 5 (Prestige Badges) populates
    // lastEventBadges on season-end detection. advanceToNextSeason resets
    // both so they never leak across seasons.
    lastEventTrophy: freshTrophy,
    lastEventBadges: newlyEarnedBadges,
    prestigeBadges: nextPrestigeBadges,
    ...(seasonBonus ? { lastSeasonBonus: seasonBonus } : {}),
    // Elijah Joles partnership flags - optional, default-falsy reads.
    elijah_boss_available,
    elijah_boss_seen: wasSeen,
    // Guarantee a defined phase post-event. Legacy careers loaded without
    // a phase field would otherwise leak `undefined` here, blocking
    // advanceToNextSeason on the next call.
    phase: seasonOver ? 'offseason' : (career.phase || 'in_season'),
    updatedAt: Date.now(),
  };
}

/**
 * Advance from offseason → next preseason. Increments year (and tier if
 * crossed a boundary), regenerates rivals' overalls, generates next season
 * schedule, resets season-W/L counters. Phase A: HS-only, no tier flip,
 * so after year 4 this will throw - caller should transition to `retired`
 * or (Phase C) `recruiting`.
 */
export function advanceToNextSeason(career, { rng = Math.random } = {}) {
  recordSnapshot('career.advanceSeason', { fromTier: career?.wrestler?.tier, fromYear: career?.wrestler?.year });
  // Self-heal: if the season's events are all played but `phase` somehow
  // wasn't flipped to 'offseason' (legacy shape, swallowed error during
  // recordEventResult, hand-edited save), treat the schedule's actual
  // state as truth and proceed. This converts a hard "Advance does
  // nothing" failure into a successful year flip.
  let phase = career.phase;
  const playedEvents = career.schedule?.events || [];
  const allDone = playedEvents.length > 0
    && playedEvents.every(e => e.status === 'won' || e.status === 'lost');
  if (phase !== 'offseason' && allDone) phase = 'offseason';
  // Forward-compat: a future client may save a phase this version doesn't
  // recognize. Don't throw - return the career unchanged so the dashboard
  // can render an "Update required" banner without bricking the UI.
  if (phase && !KNOWN_PHASES.has(phase)) {
    return career;
  }
  if (phase !== 'offseason') {
    throw new Error(`Cannot advance season from phase: ${career.phase ?? 'unknown'}`);
  }

  const nextYear = career.wrestler.year + 1;
  const nextSeasonYear = (career.schedule?.seasonYear || career.wrestler?.year || 1) + 1;

  // Tier-end dispatcher. HS year 4 -> recruiting. College year 4 -> senior
  // style choice. Senior year MAX_SENIOR_YEARS -> retired. Each branch
  // returns a career in a paused state; user input drives the next step.
  if (career.wrestler.tier === 'hs' && nextYear > 4) {
    return enterRecruiting(career, { rng });
  }
  if (career.wrestler.tier === 'college' && nextYear > 4) {
    return enterSeniorStyleChoice(career, { rng });
  }
  if (career.wrestler.tier === 'senior' && nextYear > MAX_SENIOR_YEARS) {
    return {
      ...career,
      phase: 'retired',
      retiredAt: Date.now(),
      retireReason: 'senior_career_complete',
      updatedAt: Date.now(),
    };
  }

  const events = generateSeasonSchedule({
    tier: career.wrestler.tier,
    seasonYear: nextSeasonYear,
    year: nextYear,
    weightClass: career.wrestler.weightClass,
    style: 'folkstyle',
    gender: career.wrestler.gender || 'male',
    rivals: career.rivals,
    rng,
    scheduleVersion: 1, // v9: every new season on v9 uses the expanded schedule.
    // v9: per-style senior weight map (passed through to generateSeniorSeason
    // so Greco events stamp wrestler.weights.greco kg, not the freestyle/
    // display weight). Harmless for HS/college - the schedule branch there
    // ignores `weights`.
    weights: career.wrestler.weights,
  });

  // Award offseason base stat points. Tier-scaled (Source 1): HS wrestlers
  // gain raw athleticism faster than veterans. Win-bonus + title-bonus +
  // method-specialty stats are awarded earlier (in recordEventResult) so
  // the offseason number is just the participation floor.
  const offseasonBase = OFFSEASON_BASE_BY_TIER[career.wrestler.tier] ?? 3;
  const wrestler = {
    ...career.wrestler,
    year: nextYear,
    age: career.wrestler.age + 1,
    statPointsAvailable: (career.wrestler.statPointsAvailable || 0) + offseasonBase,
  };

  // Regenerate the full scope-tagged pool (~125 NPCs) for the new season -
  // fresh records, so rankings start from parity each year. Using the
  // expanded generator (not the legacy 24-NPC conference-only one) keeps
  // the rankings detail screen's top-25/50/100 views populated and keeps
  // the weekly sim's exact section/state rank math valid. (We keep the
  // existing rng so test determinism holds across advances.)
  const rankingPool = generateExpandedRankingPool({
    weightClass: career.wrestler.weightClass,
    tier: career.wrestler.tier,
    state: career.wrestler.state || DEFAULT_STATE,
    // Thread gender so women's careers don't regenerate into the men's NPC
    // pool every season advance. Pre-fix this defaulted to 'male' inside
    // generateExpandedRankingPool, replacing a women's pool with men's
    // names + men's special wrestlers on every advance.
    gender: career.wrestler.gender || 'male',
    rng,
  });
  const confPoolSize = rankingPool.filter(w => w.scope === 'conference').length || 24;
  const sectionPoolSize = rankingPool.filter(w => w.scope === 'conference' || w.scope === 'section').length || 60;
  const statePoolSize = rankingPool.length || 125;

  return {
    ...career,
    wrestler,
    schedule: {
      seasonYear: nextSeasonYear,
      events,
      currentEventIdx: 0,
    },
    record: {
      ...career.record,
      seasonWins: 0,
      seasonLosses: 0,
    },
    rankingPool,
    rankings: {
      conference: Math.ceil(confPoolSize / 2),
      section: Math.ceil(sectionPoolSize / 2),
      state: Math.ceil(statePoolSize / 2),
      asOfEventIdx: 0,
    },
    // Clear the prior offseason's bonus - it was showing this season so
    // stale UI won't leak into the next offseason screen. The NEW season
    // completion bonus will be set by recordEventResult at season-end.
    lastSeasonBonus: null,
    // Career Depth Pass v1: reset per-season counters; keep
    // badgeEligibleSeasonYear sticky so legacy careers stay aligned
    // with their first-eligible season.
    seasonMeta: {
      debuffEventCount: 0,
      pinsThisSeason: 0,
      giantSlayerWinsThisSeason: 0,
      badgeEligibleSeasonYear: career.seasonMeta?.badgeEligibleSeasonYear ?? nextSeasonYear,
      badgeEligibleFromVersion: CAREER_SHAPE_VERSION,
      scheduleVersion: 1, // v9: advanceToNextSeason always produces V1 schedule.
    },
    // Career Depth Pass v1: ephemeral last-event handoff fields are not
    // source-of-truth. Clear so an offseason save never carries a stale
    // championship/trophy/badge reference into the new season.
    lastEventXp: null,
    lastEventTrophy: null,
    lastEventBadges: [],
    // Career Depth Pass v1: coach is a function of wrestler.tier. Rebind
    // unconditionally so a legacy save carrying a stale tier/coach pair
    // (e.g. hs_coach_petrov on a college wrestler) self-heals on the next
    // season transition. Within-tier no-op when coach is already correct.
    coach: coachForCareerTier(career),
    phase: 'preseason',
    updatedAt: Date.now(),
  };
}

export function retireCareer(career, { reason = 'user_choice' } = {}) {
  recordSnapshot('career.retire', { tier: career?.wrestler?.tier, year: career?.wrestler?.year, reason });
  return {
    ...career,
    phase: 'retired',
    retiredAt: Date.now(),
    retireReason: reason,
    updatedAt: Date.now(),
  };
}

// --- Tier transition reducers --------------------------------------------
// HS senior finishing -> recruiting. Player picks a college offer (or walks
// on, or retires). Acceptance morphs the wrestler into a college freshman
// and snaps weight class. A celebration screen ('tier_transition' phase)
// renders the rank-reset, then 'preseason' takes over for the new tier.

function getScopeRankSnapshot(career) {
  const r = career.rankings || {};
  return {
    state: r.state ?? null,
    section: r.section ?? null,
    conference: r.conference ?? null,
  };
}

/**
 * Enter the recruiting flow at the end of HS senior year. Generates 0-5
 * college offers based on the player's HS resume. Walk-on path is always
 * available so the player has a way forward even with no real offers.
 */
export function enterRecruiting(career, { rng = Math.random } = {}) {
  recordSnapshot('career.enterRecruiting', { tier: career?.wrestler?.tier, year: career?.wrestler?.year });
  const { score, offers } = generateCollegeOffers(career, { rng });
  return {
    ...career,
    phase: 'recruiting',
    recruiting: {
      generatedAt: Date.now(),
      recruitingScore: score,
      offers,
      walkOnAvailable: true,
    },
    updatedAt: Date.now(),
  };
}

function buildCollegeFromOffer(career, offer, { rng }) {
  const currentWeight = career.wrestler.weightClass;
  // Thread gender + style so women's HS -> NCAA Women's transitions snap to
  // WOMENS_COLLEGE_WEIGHTS, not MEN's COLLEGE_WEIGHTS. Without these args
  // snapToValidWeight defaults to male/folkstyle and a 130-lb HS girl ends
  // up at 133 (men's NCAA), which doesn't exist in the women's table and
  // breaks downstream lookups (dual meet hero-bout indexOf, etc.).
  const gender = career.wrestler.gender || 'male';
  const style = career.wrestler.style || 'folkstyle';
  const collegeWeight = snapToValidWeight(currentWeight, 'college', style, gender);
  const cap = STAT_CAP_BY_TIER.college;

  // statFocus: +3 to that stat, capped.
  const statBumpAmount = 3;
  const stats = { ...career.wrestler.stats };
  if (offer.statFocus && typeof stats[offer.statFocus] === 'number') {
    stats[offer.statFocus] = Math.min(cap, stats[offer.statFocus] + statBumpAmount);
  }

  // deckBonus: prestige 5 = unlock card, prestige 4 = +1 stat point.
  let unlockedCardIds = career.wrestler.unlockedCardIds || [];
  let extraStatPoints = 0;
  if (offer.deckBonus?.type === 'unlock_card' && offer.deckBonus.cardId) {
    if (!unlockedCardIds.includes(offer.deckBonus.cardId)) {
      unlockedCardIds = [...unlockedCardIds, offer.deckBonus.cardId];
    }
  } else if (offer.deckBonus?.type === 'stat_point') {
    extraStatPoints = offer.deckBonus.count || 1;
  }

  const oldRankSnapshot = getScopeRankSnapshot(career);

  // Carry top-2 HS rivals into the new college pool.
  const hsRivals = career.rivals || [];
  const carriedRivals = followRivalsToCollege(hsRivals, {
    rng,
    playerCollegeId: offer.collegeId,
    pickCollege: pickRivalCollege,
  });

  // Fresh college ranking pool. Inject carried rivals so they show up at
  // college overall. Thread gender so a women's HS->college transition lands
  // on the women's NCAA pool (not the default-male pool).
  const basePool = generateExpandedRankingPool({
    weightClass: collegeWeight,
    tier: 'college',
    state: career.wrestler.state || DEFAULT_STATE,
    gender: career.wrestler.gender || 'male',
    rng,
  });
  const rivalsAsPoolEntries = carriedRivals.map((r, idx) => ({
    id: r.id,
    name: r.name,
    school: r.school,
    overall: r.overall,
    weightClass: collegeWeight,
    tier: 'college',
    scope: idx < 2 ? 'section' : 'conference',
    isRival: true,
    wins: 0,
    losses: 0,
  }));
  const rankingPool = [...basePool, ...rivalsAsPoolEntries];
  const confPoolSize = rankingPool.filter(w => w.scope === 'conference').length || 24;
  const sectionPoolSize = rankingPool.filter(w => w.scope === 'conference' || w.scope === 'section').length || 60;
  const statePoolSize = rankingPool.length || 125;

  const wrestler = {
    ...career.wrestler,
    tier: 'college',
    year: 1,
    age: (career.wrestler.age || 18) + 1,
    weightClass: collegeWeight,
    stats,
    statPointsAvailable: (career.wrestler.statPointsAvailable || 0) + extraStatPoints,
    unlockedCardIds,
    school: {
      collegeId: offer.collegeId,
      name: offer.schoolName,
      conference: offer.conference,
      prestige: offer.prestige,
      acceptedAt: Date.now(),
    },
  };

  const newScopeRanks = {
    conference: Math.ceil(confPoolSize / 2),
    section: Math.ceil(sectionPoolSize / 2),
    state: Math.ceil(statePoolSize / 2),
    asOfEventIdx: 0,
  };

  return {
    ...career,
    phase: 'tier_transition',
    wrestler,
    rivals: carriedRivals,
    rankingPool,
    rankings: newScopeRanks,
    record: { ...career.record, seasonWins: 0, seasonLosses: 0 },
    schedule: career.schedule, // generated by confirmTierTransition
    recruiting: null,
    // Career Depth Pass v1: coach is derived from wrestler.tier. Rebind on
    // every tier transition so HS Coach Petrov does not persist into college.
    coach: coachForTier('college'),
    tierTransition: {
      fromTier: 'hs',
      toTier: 'college',
      schoolName: offer.schoolName,
      conference: offer.conference,
      style: 'folkstyle',
      oldRank: oldRankSnapshot,
      newRank: { state: newScopeRanks.state, section: newScopeRanks.section, conference: newScopeRanks.conference },
      weightChanged: collegeWeight !== currentWeight,
      oldWeight: currentWeight,
      newWeight: collegeWeight,
      statBump: offer.statFocus ? { stat: offer.statFocus, amount: statBumpAmount } : null,
      deckBonus: offer.deckBonus || null,
    },
    updatedAt: Date.now(),
  };
}

/**
 * Accept a college offer. Advances the wrestler from HS year 4 -> college
 * year 1, snaps weight, applies stat focus, unlocks deck-bonus card,
 * carries top-2 HS rivals forward, regenerates the ranking pool at college
 * tier. Sets phase: 'tier_transition' for the celebration screen.
 */
export function acceptCollegeOffer(career, offerId, { rng = Math.random } = {}) {
  recordSnapshot('career.acceptCollegeOffer', {
    fromTier: career?.wrestler?.tier,
    offerId,
    offerSchool: career?.recruiting?.offers?.find?.(o => o?.id === offerId)?.schoolName,
    weight: career?.wrestler?.weightClass,
  });
  if (!career?.recruiting?.offers) {
    throw new Error('acceptCollegeOffer: no offers available');
  }
  const offer = career.recruiting.offers.find(o => o.id === offerId);
  if (!offer) {
    throw new Error(`acceptCollegeOffer: offer not found: ${offerId}`);
  }
  return buildCollegeFromOffer(career, offer, { rng });
}

/**
 * Walk-on path. Same shape as acceptCollegeOffer but uses a synthetic
 * prestige-1 offer with no stat focus and no deck bonus. For users who
 * didn't earn a real offer or chose to walk on instead.
 */
export function takeWalkOnPath(career, { rng = Math.random } = {}) {
  recordSnapshot('career.takeWalkOnPath', { fromTier: career?.wrestler?.tier });
  const offer = makeWalkOnOffer(rng);
  return buildCollegeFromOffer(career, offer, { rng });
}

/**
 * Post-celebration handoff: clear `tierTransition`, generate the schedule
 * for the new tier, set phase to 'preseason' so the dashboard takes over.
 */
export function confirmTierTransition(career, { rng = Math.random } = {}) {
  recordSnapshot('career.confirmTierTransition', { tier: career?.wrestler?.tier, year: career?.wrestler?.year });
  if (!career?.tierTransition) {
    // Career Depth Pass v1: rebind coach from current tier even on the
    // no-op branch so a legacy career carrying a stale tier/coach pair
    // (e.g. hs_coach_petrov on a college wrestler) self-heals.
    return { ...career, phase: 'preseason', coach: coachForCareerTier(career), updatedAt: Date.now() };
  }
  const events = generateSeasonSchedule({
    tier: career.wrestler.tier,
    seasonYear: (career.schedule?.seasonYear || 0) + 1,
    year: career.wrestler.year,
    weightClass: career.wrestler.weightClass,
    style: career.wrestler.style || 'folkstyle',
    gender: career.wrestler.gender || 'male',
    rivals: career.rivals,
    rng,
    scheduleVersion: 1, // v9: tier transition (HS->College, College->Senior) uses V1 schedule.
    weights: career.wrestler.weights, // v9: per-style senior weight map (see advanceToNextSeason).
  });
  return {
    ...career,
    phase: 'preseason',
    schedule: {
      seasonYear: (career.schedule?.seasonYear || 0) + 1,
      events,
      currentEventIdx: 0,
    },
    // Career Depth Pass v1: coach is a function of wrestler.tier. Always
    // rebind on tier confirm so the new-tier coach takes effect immediately.
    coach: coachForCareerTier(career),
    tierTransition: null,
    lastSeasonBonus: null,
    // v9: stamp scheduleVersion on the freshly-generated tier-transition schedule.
    seasonMeta: {
      ...(career.seasonMeta || {
        debuffEventCount: 0,
        pinsThisSeason: 0,
        giantSlayerWinsThisSeason: 0,
        badgeEligibleSeasonYear: (career.schedule?.seasonYear || 0) + 1,
        badgeEligibleFromVersion: CAREER_SHAPE_VERSION,
      }),
      scheduleVersion: 1,
    },
    updatedAt: Date.now(),
  };
}

/**
 * Senior style choice gateway. Computes valid freestyle/greco kg snaps
 * from the player's current college weight. User input picks the style
 * via chooseSeniorStyle.
 */
export function enterSeniorStyleChoice(career, { rng = Math.random } = {}) {
  recordSnapshot('career.enterSeniorStyleChoice', { tier: career?.wrestler?.tier, year: career?.wrestler?.year });
  const lbs = career.wrestler.weightClass;
  const isFemale = career?.wrestler?.gender === 'female';

  // v7: senior tier carries a per-style `weights` map. Men get freestyle +
  // greco snaps (both styles wrestled across the year). Women get one
  // women's-freestyle snap (no greco at any women's level worldwide).
  if (isFemale) {
    const womensWeight = snapToValidWeight(lbs, 'senior', 'womens_freestyle', 'female');
    return {
      ...career,
      phase: 'senior_style_choice',
      seniorChoice: {
        collegeFinalRank: career.rankings?.state ?? null,
        weights: { womens_freestyle: womensWeight },
        // Back-compat fields so any pre-v7 UI rendering still gets numeric
        // values to display. Women's mode lights up only the women's
        // freestyle card, but if a stale UI reads freestyleWeight it gets
        // a sensible fallback rather than undefined.
        womensFreestyleWeight: womensWeight,
        freestyleWeight: womensWeight,
        weightLbs: lbs,
        gender: 'female',
      },
      updatedAt: Date.now(),
    };
  }

  const freestyleWeight = snapToValidWeight(lbs, 'senior', 'freestyle');
  const grecoWeight = snapToValidWeight(lbs, 'senior', 'greco');
  return {
    ...career,
    phase: 'senior_style_choice',
    seniorChoice: {
      collegeFinalRank: career.rankings?.state ?? null,
      // v7: men wrestle BOTH styles at senior tier. Both kg snaps live
      // in the weights map; the celebration screen shows both.
      weights: { freestyle: freestyleWeight, greco: grecoWeight },
      // Back-compat fields preserved exactly for any UI / call site that
      // still reads them directly.
      freestyleWeight,
      grecoWeight,
      weightLbs: lbs,
      gender: 'male',
    },
    updatedAt: Date.now(),
  };
}

/**
 * Begin the senior international career.
 *
 * v7 behavior:
 *   - The `style` argument is preserved for back-compat (call site at
 *     WrestlingGame.jsx still passes it) but **ignored** for routing.
 *     The function determines the correct senior setup from
 *     `career.wrestler.gender`.
 *   - **Men** (`gender: 'male'`): wrestler is set up to compete in BOTH
 *     freestyle and greco events across the year. `wrestler.weights` map
 *     carries both UWW kg snaps; `career.rankingPools` carries one ranking
 *     pool per style; `wrestler.weightClass` is set to the freestyle kg
 *     for primary display.
 *   - **Women** (`gender: 'female'`): wrestler competes in women's freestyle
 *     only. `wrestler.weights = { womens_freestyle }`; `career.rankingPool`
 *     (singular) is set; `career.rankingPools` is left undefined.
 *   - Idempotent: if `career.wrestler.tier === 'senior'` already, returns
 *     the career unchanged (no double-bump of age, no re-generation of
 *     pools).
 *
 * Sets tier='senior', year=1, snaps to UWW kg, regenerates ranking pool(s),
 * carries top-2 college rivals probabilistically. Returns career in
 * 'tier_transition' phase for the celebration screen.
 */
export function chooseSeniorStyle(career, style, { rng = Math.random } = {}) {
  recordSnapshot('career.chooseSeniorStyle', { fromTier: career?.wrestler?.tier, style });
  if (!career?.seniorChoice) {
    throw new Error('chooseSeniorStyle: no senior choice context');
  }
  // v7 idempotency: if we're already at senior tier, return unchanged.
  // Save replays, double-clicks, and stale UI flows can re-trigger this
  // function; the original implementation would re-bump age and regen
  // pools every time.
  if (career.wrestler?.tier === 'senior') {
    return career;
  }

  const isFemale = career?.wrestler?.gender === 'female';
  // The legacy `style` argument is logged for telemetry but does not gate
  // behavior. Gender is the authority.
  const _legacyStyleArg = style;  

  const oldRankSnapshot = getScopeRankSnapshot(career);

  // Resolve weights map. Pulled from seniorChoice (built by
  // enterSeniorStyleChoice). Fallback to a fresh snap if the seniorChoice
  // shape pre-dates v7.
  const lbs = career.seniorChoice.weightLbs ?? career.wrestler?.weightClass ?? 138;
  const weights = career.seniorChoice.weights || (isFemale
    ? { womens_freestyle: snapToValidWeight(lbs, 'senior', 'womens_freestyle', 'female') }
    : { freestyle: snapToValidWeight(lbs, 'senior', 'freestyle'),
        greco:     snapToValidWeight(lbs, 'senior', 'greco') });

  // Primary display weight: women's = women's freestyle kg; men's =
  // freestyle kg (the dominant style on the senior calendar).
  const primaryStyle = isFemale ? 'womens_freestyle' : 'freestyle';
  const primaryWeight = weights[primaryStyle];

  // Carry top-2 college rivals over to senior. Style passed through here
  // is purely informational - the rival's senior-tier style display.
  const carriedRivals = followRivalsToSenior(career.rivals || [], {
    rng,
    playerStyle: primaryStyle,
    playerWeightClass: primaryWeight,
  });

  // Build ranking pools.
  //   Women: single pool keyed by women's freestyle weight.
  //   Men: TWO pools, one per style, each keyed by that style's weight.
  const rivalsToPoolEntries = (rivals, weightClass) => rivals.map((r, idx) => ({
    id: r.id,
    name: r.name,
    school: r.school,
    overall: r.overall,
    weightClass,
    tier: 'senior',
    scope: idx < 2 ? 'section' : 'conference',
    isRival: true,
    wins: 0,
    losses: 0,
  }));

  let rankingPool = null;
  let rankingPools = null;
  if (isFemale) {
    const basePool = generateExpandedRankingPool({
      weightClass: primaryWeight,
      tier: 'senior',
      state: career.wrestler.state || DEFAULT_STATE,
      gender: 'female',
      rng,
    });
    rankingPool = [...basePool, ...rivalsToPoolEntries(carriedRivals, primaryWeight)];
  } else {
    const freestylePool = generateExpandedRankingPool({
      weightClass: weights.freestyle,
      tier: 'senior',
      state: career.wrestler.state || DEFAULT_STATE,
      gender: 'male',
      rng,
    });
    const grecoPool = generateExpandedRankingPool({
      weightClass: weights.greco,
      tier: 'senior',
      state: career.wrestler.state || DEFAULT_STATE,
      gender: 'male',
      rng,
    });
    rankingPools = {
      freestyle: [...freestylePool, ...rivalsToPoolEntries(carriedRivals, weights.freestyle)],
      greco:     [...grecoPool,     ...rivalsToPoolEntries(carriedRivals, weights.greco)],
    };
    // Use freestyle pool as the singular fallback so any code path that
    // hasn't been updated to read rankingPools still has data to render.
    rankingPool = rankingPools.freestyle;
  }

  // Compute scope ranks from the pool we'll surface as primary.
  const primaryRankPool = rankingPool;
  const confPoolSize = primaryRankPool.filter(w => w.scope === 'conference').length || 24;
  const sectionPoolSize = primaryRankPool.filter(w => w.scope === 'conference' || w.scope === 'section').length || 60;
  const statePoolSize = primaryRankPool.length || 125;

  const wrestler = {
    ...career.wrestler,
    tier: 'senior',
    year: 1,
    age: (career.wrestler.age || 22) + 1,
    weightClass: primaryWeight,
    weights,
    // `style` is the legacy single-style field, kept in sync with the
    // primary display style for any UI / engine path that reads it.
    // For men it points to freestyle; for women to womens_freestyle.
    style: primaryStyle,
  };

  const newScopeRanks = {
    conference: Math.ceil(confPoolSize / 2),
    section: Math.ceil(sectionPoolSize / 2),
    state: Math.ceil(statePoolSize / 2),
    asOfEventIdx: 0,
  };

  return {
    ...career,
    phase: 'tier_transition',
    wrestler,
    rivals: carriedRivals,
    rankingPool,
    // Only set rankingPools for men (dual-style). Women's careers leave
    // it undefined and use the singular rankingPool. Bracket builder
    // checks rankingPools first, falls back to rankingPool.
    ...(rankingPools ? { rankingPools } : {}),
    rankings: newScopeRanks,
    record: { ...career.record, seasonWins: 0, seasonLosses: 0 },
    seniorChoice: null,
    // Career Depth Pass v1: rebind coach to senior tier so the college coach
    // does not persist into senior.
    coach: coachForTier('senior'),
    tierTransition: {
      fromTier: 'college',
      toTier: 'senior',
      schoolName: null,
      conference: null,
      // For men the celebration screen shows both styles; for women only one.
      style: primaryStyle,
      oldRank: oldRankSnapshot,
      newRank: { state: newScopeRanks.state, section: newScopeRanks.section, conference: newScopeRanks.conference },
      weightChanged: true,
      oldWeight: career.seniorChoice.weightLbs,
      newWeight: primaryWeight,
      statBump: null,
      deckBonus: null,
    },
    updatedAt: Date.now(),
  };
}

// ─── Hydration / shape migration ────────────────────────────────────────────
//
// Careers saved to Firestore before Phase B shipped are missing the new
// fields: unlockedCardIds, skillTree, xp/level, rankingPool, rankings.
// Without these, card-gating silently falls back to the full 114-card pool
// and the skill tree appears empty - giving the impression the feature
// was never built. hydrateCareer backfills any missing fields so legacy
// careers look structurally identical to fresh ones, without overwriting
// any progress they've already made.
//
// MUST be idempotent: callers may invoke it more than once per load cycle
// (Firestore round-trip + in-memory refresh, new-career wizard post-create).

// v6 (2026-04-30): inject the canonical named NPCs (Chase Kamats top
// overall, Jordon Eckstrom high-mid) into every existing career's
// rankingPool, and ensure Chase is the #1 rival on the rivals list.
// Strictly additive: ensureSpecialAiWrestlers and ensureChaseKamatsRival
// both no-op if the entries already exist (id and name dedupe).
//
// v5 (2026-04-30): one-time +10 statPointsAvailable backfill for all
// existing careers. Idempotent via the version short-circuit at the top
// of hydrateCareer + an explicit version-comparison guard inside the
// wrestler rebuild block.
// v7 (2026-05-01): gender on wrestler + women's-wrestling career path.
// Existing careers default to gender: 'male' on hydrate. Senior tier may
// also carry a `weights` map (per-style kg snaps) and `rankingPools` map
// (per-style ranking pools); these are absent on legacy senior careers
// and added on the next senior transition for women's careers or on
// re-entry for men's careers.
const CAREER_SHAPE_VERSION = 9;

/**
 * Resurrect a career that was force-retired under the old (pre-v4) contract
 * with `retireReason: 'hs_graduation_pending_recruiting'`. Flips the career
 * into 'recruiting' with a freshly generated offer pool. Old retire metadata
 * is archived into priorRetirements[] so the audit trail is preserved.
 */
function resurrectIntoRecruiting(career) {
  const now = Date.now();
  const priorRetirements = Array.isArray(career.priorRetirements) ? career.priorRetirements : [];
  if (career.retiredAt || career.retireReason) {
    priorRetirements.push({
      retiredAt: career.retiredAt || null,
      retireReason: career.retireReason || null,
      archivedAt: now,
    });
  }
  const { score, offers } = generateCollegeOffers(career, { rng: Math.random });
  return {
    ...career,
    phase: 'recruiting',
    retiredAt: null,
    retireReason: null,
    recruiting: {
      generatedAt: now,
      recruitingScore: score,
      offers,
      walkOnAvailable: true,
    },
    priorRetirements,
    updatedAt: now,
  };
}

/**
 * Backfill missing fields on a career object. Safe to call repeatedly on
 * already-hydrated careers (no-op). Does NOT award retroactive XP.
 *
 * v4 migration: in-progress careers pick up the new tier-end dispatcher
 * automatically. Retired careers with retireReason 'hs_graduation_pending_recruiting'
 * are resurrected into recruiting (the old force-retire was a placeholder
 * for the post-HS arc that didn't ship at the time). All other retired
 * careers stay retired.
 *
 * @param {object} raw - career object from Firestore / localStorage / createCareer
 * @returns {object} - hydrated career (new object reference if any field changed)
 */
export function hydrateCareer(raw) {
  recordSnapshot('career.hydrate', { hasWrestler: !!raw?.wrestler, phase: raw?.phase });
  if (!raw || !raw.wrestler) return raw;

  // v3 -> v4 resurrection: if a career was force-retired under the old
  // year-5 placeholder, flip it to recruiting with fresh offers. Run this
  // BEFORE the version short-circuit since v3 retired careers haven't
  // been touched yet.
  if (raw.phase === 'retired' && raw.retireReason === 'hs_graduation_pending_recruiting') {
    const resurrected = resurrectIntoRecruiting(raw);
    // v5 +10 backfill applies to resurrected careers too. Without this,
    // a v3 retired career would skip the stat-points bump and end up
    // 10 points behind every other migrated career.
    const v5Bump = (raw.version || 0) < 5 ? 10 : 0;
    if (v5Bump && resurrected.wrestler) {
      const baseSP = Number.isFinite(resurrected.wrestler.statPointsAvailable)
        ? resurrected.wrestler.statPointsAvailable : 0;
      resurrected.wrestler = { ...resurrected.wrestler, statPointsAvailable: baseSP + v5Bump };
    }
    // v6 special-NPC + Chase-Kamats-rival backfill. Same idempotent
    // helpers as the main hydrate path; safe to run on a resurrected
    // career whose rankingPool/rivals may already include them.
    if ((raw.version || 0) < 6) {
      if (Array.isArray(resurrected.rankingPool) && resurrected.wrestler) {
        // Branch on gender so women's resurrected careers don't get
        // Chase Kamats (male) injected into their NPC pool. Female v<6
        // careers don't exist in production (gender field arrived at v7),
        // but the branch costs nothing and keeps the contract safe if a
        // legacy save ever lands here.
        const isFemale = resurrected.wrestler.gender === 'female';
        const inject = isFemale ? ensureSpecialWomensAiWrestlers : ensureSpecialAiWrestlers;
        resurrected.rankingPool = inject(resurrected.rankingPool, {
          weightClass: resurrected.wrestler.weightClass,
          tier: resurrected.wrestler.tier,
          scope: 'conference',
        });
      }
      // Chase-Kamats-as-rival is male-only. Skip for female wrestlers; the
      // women's pantheon is already injected via the pool helper above
      // (Valerie Aikens etc.).
      if (resurrected.wrestler && resurrected.wrestler.gender !== 'female') {
        resurrected.rivals = ensureChaseKamatsRival(
          Array.isArray(resurrected.rivals) ? resurrected.rivals : [],
          {
            weightClass: resurrected.wrestler.weightClass,
            tier: resurrected.wrestler.tier,
            style: resurrected.wrestler.style || 'folkstyle',
          },
        );
      }
    }
    console.log('[Career-Hydrate]', {
      from: raw.version || 0,
      to: CAREER_SHAPE_VERSION,
      action: 'resurrect_recruiting',
      careerId: raw.id,
    });
    return { ...resurrected, version: CAREER_SHAPE_VERSION };
  }

  // Phase inference: even a v3 career can land here without a phase if a
  // bad write/legacy path left it undefined. Compute a sane phase from the
  // schedule before any other work - safe regardless of version. If the
  // career is already current-version AND has a phase, this is a no-op.
  const inferPhase = (rawCareer) => {
    if (rawCareer.phase) return rawCareer.phase;
    const events = rawCareer.schedule?.events || [];
    const allDone = events.length > 0
      && events.every(e => e.status === 'won' || e.status === 'lost');
    const anyDone = events.some(e => e.status === 'won' || e.status === 'lost');
    return allDone ? 'offseason' : anyDone ? 'in_season' : 'preseason';
  };

  // Cosmetic rename pass: "Brooke Gaberseck" -> "Brooke Wennin". Runs
  // BEFORE the version short-circuit so existing v7 saves with the old
  // name get the new name on next load. Idempotent: a save that's
  // already renamed has no entries matching the old name. Internal ID
  // (`special_brooke_gaberseck`) is preserved so equality checks against
  // BROOKE_GABERSECK_ID still match.
  const renameOldGaberseck = (entries) => {
    if (!Array.isArray(entries)) return entries;
    let changed = false;
    const out = entries.map(e => {
      if (e?.name === 'Brooke Gaberseck') {
        changed = true;
        return { ...e, name: 'Brooke Wennin' };
      }
      return e;
    });
    return changed ? out : entries;
  };
  if (raw.rivals || raw.rankingPool || raw.rankingPools) {
    const renamedRivals = renameOldGaberseck(raw.rivals);
    const renamedRankingPool = renameOldGaberseck(raw.rankingPool);
    let renamedRankingPools = raw.rankingPools;
    if (raw.rankingPools && typeof raw.rankingPools === 'object') {
      const keys = Object.keys(raw.rankingPools);
      const updated = {};
      let pmChanged = false;
      for (const k of keys) {
        const before = raw.rankingPools[k];
        const after = renameOldGaberseck(before);
        if (after !== before) pmChanged = true;
        updated[k] = after;
      }
      if (pmChanged) renamedRankingPools = updated;
    }
    if (renamedRivals !== raw.rivals
        || renamedRankingPool !== raw.rankingPool
        || renamedRankingPools !== raw.rankingPools) {
      raw = {
        ...raw,
        ...(renamedRivals !== raw.rivals ? { rivals: renamedRivals } : {}),
        ...(renamedRankingPool !== raw.rankingPool ? { rankingPool: renamedRankingPool } : {}),
        ...(renamedRankingPools !== raw.rankingPools ? { rankingPools: renamedRankingPools } : {}),
      };
    }
  }

  // Repair stale wrestler.weightClass when the tier/gender combo doesn't
  // include it. Pre-2026-05-06 the HS->college transition ignored gender,
  // so a female HS wrestler at 130 lbs got snapped to MEN'S NCAA 133 (which
  // isn't in WOMENS_COLLEGE_WEIGHTS). The bug surfaces in any flow that
  // does `weights.indexOf(weightClass)` (career dual meet, ranking pool
  // weight filters, etc.). Snap to the nearest valid weight on load and
  // rewrite schedule events that referenced the bad weight.
  //
  // Runs BEFORE the version short-circuit because v7 careers can already
  // be persisted with the bad weight. Idempotent: a no-op when the weight
  // is already valid.
  if (raw.wrestler && typeof raw.wrestler.weightClass === 'number' && raw.wrestler.tier) {
    const _gender = raw.wrestler.gender || 'male';
    // At senior tier, getWeightsForTier dispatches by style (not gender) -
    // a female senior with missing/legacy style='folkstyle' would resolve
    // to MEN'S SENIOR_FREESTYLE_KG and mis-snap. Force the women's table
    // when gender + tier match. HS/college: gender drives the table
    // directly inside getWeightsForTier, so style passes through.
    const _style = (raw.wrestler.tier === 'senior' && _gender === 'female')
      ? 'womens_freestyle'
      : (raw.wrestler.style || 'folkstyle');
    const _validWeights = getWeightsForTier(raw.wrestler.tier, _style, _gender);
    const _oldWeight = raw.wrestler.weightClass;
    if (Array.isArray(_validWeights) && _validWeights.length > 0
        && !_validWeights.includes(_oldWeight)) {
      const _newWeight = snapToValidWeight(_oldWeight, raw.wrestler.tier, _style, _gender);
      console.warn('[Career-Hydrate] weight-class repair:', {
        tier: raw.wrestler.tier,
        gender: _gender,
        oldWeight: _oldWeight,
        newWeight: _newWeight,
      });
      const repairedWrestler = { ...raw.wrestler, weightClass: _newWeight };
      const repairedSchedule = Array.isArray(raw.schedule?.events)
        ? {
            ...raw.schedule,
            events: raw.schedule.events.map(e =>
              e?.weightClass === _oldWeight ? { ...e, weightClass: _newWeight } : e
            ),
          }
        : raw.schedule;
      raw = { ...raw, wrestler: repairedWrestler, schedule: repairedSchedule };
    }
  }

  // Repair stale women's-career ranking pools. Pre-2026-05-06 several
  // pool-regeneration sites (advanceToNextSeason, buildCollegeFromOffer,
  // hydrate fallback / topup) called generateExpandedRankingPool without
  // the wrestler's gender, so the function defaulted to 'male' and women's
  // careers ended up with the men's pantheon (Chase Kamats, Jordon
  // Eckstrom, the COHORT_WRESTLERS cohort) and men's first-name pool.
  //
  // Two-fold detection so the heal fires whether the pool retains the
  // special-NPC names or just the filler men:
  //   1. ANY men's-special-NPC name present, or
  //   2. No women's-pantheon names present (Valerie Aikens et al.).
  //
  // Either signal regenerates the pool with the correct women's gender.
  // Rivals are also cleaned of male specials. Recorded H2H against
  // legitimate women's rivals (Sarah Lee etc.) survives. Runs BEFORE the
  // version short-circuit so already-persisted v7 careers self-heal.
  const MEN_SPECIAL_NAMES = new Set([
    'Chase Kamats', 'Jordon Eckstrom',
    'Stetson Clary', 'Jaxon Louis', 'Brayden Aide',
    'Marcus McCauley', 'Gavin Burch',
    'Elijah Joles', // featured-wrestler partnership; male-career only
  ]);
  const WOMEN_SPECIAL_NAMES = new Set([
    'Valerie Aikens', 'Larissa Newton', 'Angelee Kamats',
    'Niki Garwood', 'Brooke Wennin',
  ]);
  if (raw.wrestler?.gender === 'female' && Array.isArray(raw.rankingPool)
      && raw.rankingPool.length > 0
      && raw.wrestler.tier
      && typeof raw.wrestler.weightClass === 'number') {
    let hasMaleSpecial = false;
    let hasWomenSpecial = false;
    for (const p of raw.rankingPool) {
      const nm = p?.name;
      if (!nm) continue;
      if (MEN_SPECIAL_NAMES.has(nm))   hasMaleSpecial = true;
      if (WOMEN_SPECIAL_NAMES.has(nm)) hasWomenSpecial = true;
      if (hasMaleSpecial && hasWomenSpecial) break;
    }
    const contaminated = hasMaleSpecial || !hasWomenSpecial;
    if (contaminated) {
      console.warn('[Career-Hydrate] regenerating women\'s ranking pool:', {
        tier: raw.wrestler.tier,
        weightClass: raw.wrestler.weightClass,
        hasMaleSpecial,
        hasWomenSpecial,
      });
      const repairedPool = generateExpandedRankingPool({
        weightClass: raw.wrestler.weightClass,
        tier: raw.wrestler.tier,
        state: raw.wrestler.state,
        gender: 'female',
        rng: Math.random,
      });
      raw = { ...raw, rankingPool: repairedPool };
      // Drop male specials from rivals if any were injected there.
      if (Array.isArray(raw.rivals)) {
        const cleanedRivals = raw.rivals.filter(r => !MEN_SPECIAL_NAMES.has(r?.name));
        if (cleanedRivals.length !== raw.rivals.length) {
          raw = { ...raw, rivals: cleanedRivals };
        }
      }
      // Mark the career as needing a save so the in-memory repair gets
      // persisted to Firestore on the next saveCareer call (or sooner via
      // the WrestlingGame post-hydrate save). Without this the localStorage
      // mirror could keep serving the contaminated pool offline.
      raw._needsResave = true;
    }
  }

  // Short-circuit: if already at current version AND has a phase, nothing to do.
  if ((raw.version || 0) >= CAREER_SHAPE_VERSION && raw.phase) return raw;

  // Otherwise, even if version is current we may still need to fix `phase`.
  if ((raw.version || 0) >= CAREER_SHAPE_VERSION && !raw.phase) {
    return { ...raw, phase: inferPhase(raw) };
  }

  const w = raw.wrestler;

  // v4 -> v5 one-time +10 statPointsAvailable backfill. Gated by version
  // comparison so re-hydrating a v5 career doesn't double-apply (the
  // outer short-circuit at line ~1163 already returns early in that
  // case, but this is belt-and-suspenders). `Number.isFinite` guards
  // against any malformed legacy value (NaN / 'string' / undefined /
  // Infinity); saveCareer's schema validator would reject those upstream
  // so they're theoretical, but defense in depth costs nothing here.
  const v5StatPointsBackfill = (raw.version || 0) < 5 ? 10 : 0;
  const baseStatPoints = Number.isFinite(w.statPointsAvailable) ? w.statPointsAvailable : 0;

  const hydratedWrestler = {
    ...w,
    xp: typeof w.xp === 'number' ? w.xp : 0,
    level: typeof w.level === 'number' ? w.level : 1,
    statPointsAvailable: baseStatPoints + v5StatPointsBackfill,
    skillTree: w.skillTree ?? { unlockedNodes: [], pointsAvailable: 0, focus: null },
    // v7: female careers backfill the women's-specific signature cards if
    // missing. Idempotent - if a card is already in unlockedCardIds it's
    // not re-added. New careers at v7+ already include these from
    // createCareer; legacy female careers (theoretically there are none
    // pre-v7 since v7 introduced the gender field, but be defensive)
    // top up here.
    unlockedCardIds: (() => {
      const base = Array.isArray(w.unlockedCardIds) && w.unlockedCardIds.length > 0
        ? w.unlockedCardIds
        : [...CAREER_STARTER_DECK];
      if (w.gender !== 'female') return base;
      const have = new Set(base);
      const additions = WOMENS_CAREER_STARTER_ADD_ONS.filter(id => !have.has(id));
      return additions.length > 0 ? [...base, ...additions] : base;
    })(),
    injuries: Array.isArray(w.injuries) ? w.injuries : [],
    // Career Depth Pass v1: sanitize tempBuffs on every hydrate so legacy
    // saves with malformed entries (no sourceId, bad duration, etc.) become
    // usable by tickConsumedTempBuffs / applyCareerMatchModifiers.
    tempBuffs: sanitizeTempBuffs(w.tempBuffs),
    // Defensive backfills for fields old iOS / pre-Phase-B saves may lack.
    // Without these the dashboard crashes on direct accesses like
    // `wrestler.stats[key]` for very old careers from a 1.0.x app build.
    stats: (w.stats && typeof w.stats === 'object')
      ? { str: 55, spd: 55, tec: 55, end: 55, grt: 55, ...w.stats }
      : { str: 55, spd: 55, tec: 55, end: 55, grt: 55 },
    weightClass: typeof w.weightClass === 'number' ? w.weightClass : 138,
    year: typeof w.year === 'number' ? w.year : 1,
    age: typeof w.age === 'number' ? w.age : (DEFAULT_STARTING_AGE + (typeof w.year === 'number' ? w.year - 1 : 0)),
    tier: w.tier || 'hs',
    name: typeof w.name === 'string' ? w.name : 'Wrestler',
    // Phase D backfill: legacy careers default to PA (the canonical experience).
    state: w.state ? normalizeState(w.state) : DEFAULT_STATE,
    // v7: gender. Legacy careers (pre-v7) had no concept of gender, so they
    // were all implicitly male. Default to 'male' if missing or malformed.
    // Newly created careers stamp gender: 'female' (women-only post-v7).
    gender: w.gender === 'female' ? 'female' : 'male',
    // v7: weights map. Pre-senior tiers leave this absent; senior tier
    // entry populates it. Hydrate preserves whatever's there as long as
    // it looks like a plain object.
    weights: (w.weights && typeof w.weights === 'object' && !Array.isArray(w.weights))
      ? w.weights
      : (w.weights === undefined ? undefined : {}),
  };

  // Seed / upgrade ranking pool + derived ranks. Three cases:
  //   (a) no pool at all (pre-Phase-B): generate the full expanded pool.
  //   (b) legacy 24-wrestler conference pool (v2, no scope tags): keep the
  //       existing NPCs (already have records) and tag them scope='conference',
  //       then add fresh section+state scope wrestlers so the detail screen
  //       can render top 50 / top 100.
  //   (c) already expanded (has scope tags): leave alone.
  let rankingPool = raw.rankingPool;
  let rankings = raw.rankings;
  const hasExpandedPool = Array.isArray(rankingPool) && rankingPool.some(w => w?.scope);

  if (!Array.isArray(rankingPool) || rankingPool.length === 0) {
    rankingPool = generateExpandedRankingPool({
      weightClass: w.weightClass,
      tier: w.tier || 'hs',
      // Hydrate path: legacy / corrupted save with no rankingPool. Use the
      // wrestler's gender so women's careers regenerate into the women's
      // NPC pool, not the default-male one.
      gender: w.gender || 'male',
      rng: Math.random,
    });
    rankings = {
      conference: Math.ceil(rankingPool.filter(x => x.scope === 'conference').length / 2),
      section: Math.ceil(rankingPool.filter(x => x.scope !== 'state').length / 2),
      state: Math.ceil(rankingPool.length / 2),
      asOfEventIdx: raw.schedule?.currentEventIdx || 0,
    };
  } else if (!hasExpandedPool) {
    // Tag existing NPCs as conference scope, then top up with section + state
    // NPCs so the leaderboard views have enough wrestlers to fill out.
    const tagged = rankingPool.map(n => ({ ...n, scope: 'conference' }));
    const extras = generateExpandedRankingPool({
      weightClass: w.weightClass,
      tier: w.tier || 'hs',
      // Topup path: pre-expansion 24-NPC career being widened to the full
      // ~125 entries. Use the wrestler's gender so the section/state
      // top-up matches the conference scope's gender.
      gender: w.gender || 'male',
      rng: Math.random,
    }).filter(n => n.scope !== 'conference');
    rankingPool = [...tagged, ...extras];
    // Rankings stay valid - the existing conference rank is still correct.
    // Section/state get refined on the next weekly update.
  }

  // Legacy sim backfill: pre-v4 careers ran one sim pass per EVENT, but a
  // tournament event covers ~3-5 player matches. Result: player at 5-0,
  // top NPC at 1-0. On migration, sim extra weeks so the pool catches up
  // to the player's match count. We also seed records on freshly-tagged
  // NPCs (the !hasExpandedPool branch added new section/state entries
  // with wins:0/losses:0; without backfill they'd anchor the leaderboard).
  const seasonMatches = (raw.record?.seasonWins || 0) + (raw.record?.seasonLosses || 0);
  if (seasonMatches > 0 && Array.isArray(rankingPool) && rankingPool.length > 0) {
    const poolAvgMatches = rankingPool.reduce((acc, n) => acc + (n.wins || 0) + (n.losses || 0), 0) / rankingPool.length;
    const deficit = Math.max(0, seasonMatches - Math.floor(poolAvgMatches));
    const passes = Math.min(20, deficit); // cap so a hand-edited save can't loop forever
    for (let i = 0; i < passes; i++) {
      rankingPool = simWeekForPool(rankingPool, { rng: Math.random });
    }
  }

  // v6 backfill: ensure the canonical named NPCs (Chase Kamats top
  // overall, Jordon Eckstrom high-mid) are in every career's rankingPool
  // and that Chase Kamats sits at the top of the rivals list. Both
  // helpers are idempotent (id + name dedupe) so re-running this on a
  // career that already has them is a no-op. Strictly additive: never
  // modifies or removes existing entries.
  if ((raw.version || 0) < 6 && Array.isArray(rankingPool)) {
    // Gender-aware branch (matches the resurrection-path fix above).
    // Same defense-in-depth: production v<6 careers have no gender field
    // and default to male, but if a future regression sends a female v<6
    // career through here, it should hit the women's pantheon.
    const isFemale = hydratedWrestler.gender === 'female';
    const inject = isFemale ? ensureSpecialWomensAiWrestlers : ensureSpecialAiWrestlers;
    rankingPool = inject(rankingPool, {
      weightClass: hydratedWrestler.weightClass,
      tier: hydratedWrestler.tier,
      scope: 'conference',
    });
  }

  // Migrate stale event.bracketSize=33 (NCAA D1 IRL value) to 32. The 33
  // size was set by the Collegiate National Championship template before
  // 2026-05-05 and is unsupported by buildBracketStructure (no 33 builder
  // and the power-of-2 fallback emits orphaned seeds). Replacing with 32
  // unblocks any career mid-season that already has the bad event baked
  // into schedule.events.
  if (Array.isArray(raw.schedule?.events)) {
    raw.schedule.events = raw.schedule.events.map(e =>
      e?.bracketSize === 33 ? { ...e, bracketSize: 32 } : e
    );
  }


  const fromVersion = raw.version || 0;
  if (fromVersion < CAREER_SHAPE_VERSION) {
    console.log('[Career-Hydrate]', {
      from: fromVersion,
      to: CAREER_SHAPE_VERSION,
      action: 'backfill',
      phase: raw.phase || 'inferred',
      careerId: raw.id,
    });
  }
  // Defensive backfills for the structural fields the rest of the engine
  // assumes always exist. A pre-state-picker / partial-write career can
  // arrive without `schedule` / `rivals` / `record`, and downstream code
  // (CareerDashboard's ScheduleTab, recordEventResult, summarizeSeason)
  // dereferences them directly. Without these defaults the user hits an
  // "Undefined is not an object (evaluating 'n.schedule.events')" crash
  // the moment they tap into the career.
  const safeSchedule = raw.schedule && typeof raw.schedule === 'object'
    ? {
        seasonYear: raw.schedule.seasonYear || hydratedWrestler.year || 1,
        events: Array.isArray(raw.schedule.events) ? raw.schedule.events : [],
        currentEventIdx: typeof raw.schedule.currentEventIdx === 'number' ? raw.schedule.currentEventIdx : 0,
      }
    : { seasonYear: hydratedWrestler.year || 1, events: [], currentEventIdx: 0 };

  // v6 backfill: ensure Chase Kamats sits at the top of the rivals list.
  // Idempotent - returns the same array reference when he's already there.
  let safeRivals = Array.isArray(raw.rivals) ? raw.rivals : [];
  if ((raw.version || 0) < 6) {
    safeRivals = ensureChaseKamatsRival(safeRivals, {
      weightClass: hydratedWrestler.weightClass,
      tier: hydratedWrestler.tier,
      style: hydratedWrestler.style || 'folkstyle',
    });
  }
  const safeRecord = raw.record && typeof raw.record === 'object'
    ? {
        seasonWins: raw.record.seasonWins || 0,
        seasonLosses: raw.record.seasonLosses || 0,
        careerWins: raw.record.careerWins || 0,
        careerLosses: raw.record.careerLosses || 0,
        pins: raw.record.pins || 0,
        techs: raw.record.techs || 0,
        majorDecs: raw.record.majorDecs || 0,
        nearFalls: raw.record.nearFalls || 0,
        titles: Array.isArray(raw.record.titles) ? raw.record.titles : [],
      }
    : {
        seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
        pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [],
      };

  // Career Depth Pass v1 (7 -> 8) backfill scaffolding.
  // Existing careers become badge-eligible NEXT season (current seasonYear + 1)
  // so a mid-season hydrate can never grant a partial-season prestige badge.
  // Fresh v8 careers stamped via createCareer already carry these fields, so
  // the nullish-coalesce keeps them intact across re-hydration.
  const currentSeasonYear = safeSchedule.seasonYear || hydratedWrestler.year || 1;
  const isLegacyV8 = fromVersion < 8;
  // v9 (scheduleVersion) gate. Legacy pre-v9 careers get 0 so their
  // in-flight schedule is preserved by generateSeasonSchedule callers
  // (forward-only contract). Fresh v9+ careers stamped via createCareer
  // already carry scheduleVersion=1; preserve any numeric value.
  const isLegacyV9 = fromVersion < 9;
  const resolveScheduleVersion = (existing) => {
    if (Number.isFinite(existing)) return existing;
    return isLegacyV9 ? 0 : 1;
  };
  const v8SeasonMeta = raw.seasonMeta && typeof raw.seasonMeta === 'object'
    ? {
        debuffEventCount: Number.isFinite(raw.seasonMeta.debuffEventCount) ? raw.seasonMeta.debuffEventCount : 0,
        pinsThisSeason: Number.isFinite(raw.seasonMeta.pinsThisSeason) ? raw.seasonMeta.pinsThisSeason : 0,
        giantSlayerWinsThisSeason: Number.isFinite(raw.seasonMeta.giantSlayerWinsThisSeason) ? raw.seasonMeta.giantSlayerWinsThisSeason : 0,
        badgeEligibleSeasonYear: Number.isFinite(raw.seasonMeta.badgeEligibleSeasonYear)
          ? raw.seasonMeta.badgeEligibleSeasonYear
          : (isLegacyV8 ? currentSeasonYear + 1 : currentSeasonYear),
        badgeEligibleFromVersion: raw.seasonMeta.badgeEligibleFromVersion || CAREER_SHAPE_VERSION,
        scheduleVersion: resolveScheduleVersion(raw.seasonMeta.scheduleVersion),
      }
    : {
        debuffEventCount: 0,
        pinsThisSeason: 0,
        giantSlayerWinsThisSeason: 0,
        badgeEligibleSeasonYear: isLegacyV8 ? currentSeasonYear + 1 : currentSeasonYear,
        badgeEligibleFromVersion: CAREER_SHAPE_VERSION,
        scheduleVersion: resolveScheduleVersion(undefined),
      };
  const v8PrestigeBadges = Array.isArray(raw.prestigeBadges) ? raw.prestigeBadges : [];
  const v8Coach = raw.coach && typeof raw.coach === 'object'
    ? raw.coach
    : coachForTier(hydratedWrestler.tier);

  const career = {
    ...raw,
    version: CAREER_SHAPE_VERSION,
    phase: raw.phase || inferPhase(raw),
    wrestler: hydratedWrestler,
    schedule: safeSchedule,
    rivals: safeRivals,
    record: safeRecord,
    rankingPool,
    rankings: rankings || raw.rankings,
    // Career Depth Pass v1 backfilled fields (passthrough-tolerated; no schema migration).
    seasonMeta: v8SeasonMeta,
    prestigeBadges: v8PrestigeBadges,
    coach: v8Coach,
    // Flag for UI: show one-shot reassurance toast on first load post-update.
    // Cleared by the toast handler so it only fires once per session.
    _hydratedFromLegacy: fromVersion < CAREER_SHAPE_VERSION,
  };

  // Schema validation gate. On failure, attempt repair; if repair fails,
  // throw a typed error so the loader UI can show "repair save" instead
  // of a blank screen (handled in caller in Task 9).
  //
  // 2026-05-01: tightened the repair gate. Previously this checked
  // `repaired && repaired.__repairs` - but repairCareer always sets
  // __repairs (at least to []), so any non-null repaired value passed
  // even when the repair didn't actually fix the schema. That let
  // still-invalid careers propagate downstream and crash UIs that
  // assumed hydrated state was schema-valid (notably CareerSlotPicker's
  // unwrapped hydrate calls). Now we re-validate the repaired output
  // and only return it if validation passes; otherwise throw with the
  // ORIGINAL errors so callers see the real failure mode.
  const validation = validateCareer(career);
  if (!validation.ok) {
    console.warn('[hydrateCareer] schema validation failed', validation.errors);
    const repaired = repairCareer(career);
    if (repaired) {
      const repairedValidation = validateCareer(repaired);
      if (repairedValidation.ok) {
        console.warn('[hydrateCareer] auto-repaired', repaired.__repairs);
        recordSnapshot('career.repair', {
          count: repaired.__repairs.length,
          residual: !!repaired.__repairResidual,
        });
        return repaired;
      }
      console.warn('[hydrateCareer] repair did not fully validate', repairedValidation.errors);
    }
    recordSnapshot('career.repair.failed', { errors: validation.errors.length });
    throw Object.assign(new Error('CareerStateCorrupted'), {
      code: 'CAREER_CORRUPT',
      errors: validation.errors,
    });
  }
  return career;
}

// ─── Read helpers ────────────────────────────────────────────────────────────

export function getNextEvent(career) {
  const events = career?.schedule?.events;
  if (!Array.isArray(events)) return null;
  return findNextEvent(events);
}

export function getSeasonSummary(career) {
  const events = career?.schedule?.events;
  return summarizeSeason(Array.isArray(events) ? events : []);
}

export function isSeasonComplete(career) {
  return !findNextEvent(career.schedule.events);
}

// Build a Hall of Fame thumbnail from a retired career. Used when archiving
// so the profile doc only carries a summary (full career stays in the
// subcollection for read-on-demand).
export function buildHallOfFameThumbnail(career) {
  return {
    id: career.id,
    wrestlerName: career.wrestler.name,
    startYear: 1,
    endYear: career.schedule.seasonYear,
    finalTier: career.wrestler.tier,
    finalWeightClass: career.wrestler.weightClass,
    record: {
      careerWins: career.record.careerWins,
      careerLosses: career.record.careerLosses,
      pins: career.record.pins,
      titles: career.record.titles.length,
    },
    finalStats: career.wrestler.stats,
    retiredAt: career.retiredAt || Date.now(),
    retireReason: career.retireReason || 'user_choice',
  };
}

// Exported constants other modules may want to reference.
export { MAX_SENIOR_YEARS, DEFAULT_STARTING_AGE };
