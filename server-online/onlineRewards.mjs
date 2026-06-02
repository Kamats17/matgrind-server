// Stage 4: server-authoritative online reward settlement.
//
// The server is the ONLY writer of the trusted online_progress/{uid} documents.
// These functions consume the result record built from the engine's matchState
// (resultLedger.buildResultRecord) — never any client-supplied field — and produce
// the authoritative counters. A modified client cannot influence online wins, XP,
// or achievements: it never performs the write and never supplies the inputs.

// Deterministic online XP (no client XP formula reuse — see card/profile XP).
const XP = {
  participation: 50,
  win: 100,
  draw: 30,
  pinWin: 60,
  techFallWin: 40,
  closeMatch: 25,
  shutoutWin: 30,
  manyTakedowns: 20,
};
const CLOSE_MATCH_MARGIN = 3;   // |scoreDiff| <= 3 is a "close match"
const MANY_TAKEDOWNS = 3;       // 3+ takedowns earns the XP bonus
const TAKEDOWN_ACHIEVEMENT = 5; // 5+ takedowns in one match earns takedown_5

/** A fresh online_progress shape — every trusted online counter starts at zero. */
export function emptyOnlineProgress() {
  return {
    matches: 0, wins: 0, losses: 0, draws: 0, xp: 0,
    pins: 0, techFalls: 0, points: 0,
    streakCurrent: 0, streakBest: 0, achievementIds: [],
  };
}

const num = (v) => Number(v) || 0;

/**
 * Pure reward reducer. Given the server-built result record and a player's prior
 * online_progress doc, returns the new authoritative counters, the XP earned this
 * match, and any achievements newly unlocked.
 *
 * @param {object} record  resultLedger record: { winner, winMethod, p1, p2, ... }
 *                         where each player is { uid, name, score, takedowns, pinCount }
 * @param {'p1'|'p2'} role the player to compute for
 * @param {object} prior   the player's existing online_progress (or {} for a new player)
 * @returns {{ next: object, xpEarned: number, earnedAchievementIds: string[] }}
 */
export function buildOnlineRewardDelta(record, role, prior) {
  const base = { ...emptyOnlineProgress(), ...(prior || {}) };
  const priorAch = Array.isArray(base.achievementIds) ? base.achievementIds : [];

  const me = record[role] || {};
  const opp = record[role === 'p1' ? 'p2' : 'p1'] || {};
  const myScore = num(me.score);
  const oppScore = num(opp.score);
  const myTakedowns = num(me.takedowns);
  const myPins = num(me.pinCount);

  const isWin = record.winner === role;
  // The engine emits winner: 'draw' (not null) on an overtime-expired draw
  // (wrestlingEngine.js); treat both representations as a draw so it is never
  // mis-scored as a loss.
  const isDraw = record.winner == null || record.winner === 'draw';
  const isLoss = !isWin && !isDraw;
  const isClose = Math.abs(myScore - oppScore) <= CLOSE_MATCH_MARGIN;

  // ── XP (deterministic, additive) ──
  let xpEarned = XP.participation;
  if (isWin) xpEarned += XP.win;
  if (isDraw) xpEarned += XP.draw;
  if (isWin && record.winMethod === 'pin') xpEarned += XP.pinWin;
  if (isWin && record.winMethod === 'tech_fall') xpEarned += XP.techFallWin;
  if (isClose) xpEarned += XP.closeMatch;
  if (isWin && oppScore === 0) xpEarned += XP.shutoutWin;
  if (myTakedowns >= MANY_TAKEDOWNS) xpEarned += XP.manyTakedowns;

  // ── Counters (absolute next from prior; idempotency is the txn's job) ──
  const streakCurrent = isWin ? num(base.streakCurrent) + 1 : 0;
  const next = {
    matches: num(base.matches) + 1,
    wins: num(base.wins) + (isWin ? 1 : 0),
    losses: num(base.losses) + (isLoss ? 1 : 0),
    draws: num(base.draws) + (isDraw ? 1 : 0),
    xp: num(base.xp) + xpEarned,
    pins: num(base.pins) + myPins,
    techFalls: num(base.techFalls) + (isWin && record.winMethod === 'tech_fall' ? 1 : 0),
    points: num(base.points) + myScore,
    streakCurrent,
    streakBest: Math.max(num(base.streakBest), streakCurrent),
    achievementIds: priorAch.slice(),
  };

  // ── Achievements (evaluated against the new counters + this match) ──
  const reached = [];
  if (next.wins >= 1) reached.push('first_win');
  if (next.pins >= 1) reached.push('first_pin');
  if (next.techFalls >= 1) reached.push('first_tf');
  if (myTakedowns >= TAKEDOWN_ACHIEVEMENT) reached.push('takedown_5');
  if (isWin && oppScore === 0) reached.push('shutout');
  if (next.wins >= 10) reached.push('win_10');
  if (next.wins >= 50) reached.push('win_50');
  if (next.wins >= 100) reached.push('win_100');
  if (next.pins >= 10) reached.push('pin_10');
  if (next.streakCurrent >= 5) reached.push('streak_5');
  if (next.wins >= 5) reached.push('online_wins_5');

  const held = new Set(priorAch);
  const earnedAchievementIds = reached.filter((id) => !held.has(id));
  next.achievementIds = priorAch.concat(earnedAchievementIds);

  return { next, xpEarned, earnedAchievementIds };
}

const PROGRESS_COLLECTION = 'online_progress';

/**
 * Settle a finished match authoritatively in ONE Firestore transaction:
 * create the immutable match_results/{matchId} ledger record AND update both
 * players' online_progress/{uid} docs. The ledger create is the idempotency
 * anchor — a replay (same matchId) finds the record already present and aborts
 * without re-applying any counter.
 *
 * Returns { receipts, settled }. Each receipt is the trusted reward summary for
 * one player, ready to push as a `match_settled` message:
 *   { uid, matchId, onlineProgress, xpEarned, achievementIds }
 *
 * In dev (no Firestore handle) this is a safe no-op.
 *
 * @param {object|null} db    admin Firestore handle (or null in dev mode)
 * @param {object} built      resultLedger.buildResultRecord() output: { collection, matchId, record }
 * @param {object} [opts]     { attempts = 1, sleep = noop } - bounded retry for
 *                            transient Firestore failures. The transaction is
 *                            idempotent, so re-running is safe.
 */
export async function settleAuthoritativeMatch(db, built, opts = {}) {
  if (!db || !built || !built.matchId || !built.record) {
    return { receipts: [], settled: false };
  }
  const attempts = Math.max(1, opts.attempts || 1);
  const sleep = opts.sleep || (() => Promise.resolve());
  const record = built.record;
  const matchRef = db.collection(built.collection).doc(built.matchId);
  const uids = { p1: record.p1?.uid || null, p2: record.p2?.uid || null };

  const runOnce = () => db.runTransaction(async (tx) => {
    // READS FIRST (Firestore forbids reads after writes in a txn).
    const existing = await tx.get(matchRef);
    if (existing.exists) return null; // already settled — idempotent abort

    const refs = {
      p1: uids.p1 ? db.collection(PROGRESS_COLLECTION).doc(uids.p1) : null,
      p2: uids.p2 ? db.collection(PROGRESS_COLLECTION).doc(uids.p2) : null,
    };
    const priorSnap = {
      p1: refs.p1 ? await tx.get(refs.p1) : null,
      p2: refs.p2 ? await tx.get(refs.p2) : null,
    };

    // WRITES: ledger record anchors idempotency, then both progress docs.
    tx.create(matchRef, record);
    const out = [];
    for (const role of ['p1', 'p2']) {
      const ref = refs[role];
      if (!ref) continue;
      const prior = priorSnap[role]?.exists ? priorSnap[role].data() : {};
      const { next, xpEarned, earnedAchievementIds } = buildOnlineRewardDelta(record, role, prior);
      tx.set(ref, next, { merge: true });
      out.push({
        uid: uids[role],
        matchId: built.matchId,
        onlineProgress: next,
        xpEarned,
        achievementIds: earnedAchievementIds,
      });
    }
    return out;
  });

  // Bounded retry: a transient Firestore failure (e.g. UNAVAILABLE) must not
  // permanently drop the settlement, since the room marks ledgerWritten before
  // calling us and never re-emits. Idempotency makes re-running safe.
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const receipts = await runOnce();
      return { receipts: receipts || [], settled: !!receipts };
    } catch (e) {
      lastErr = e;
      if (attempt < attempts) await sleep(attempt);
    }
  }
  throw lastErr;
}
