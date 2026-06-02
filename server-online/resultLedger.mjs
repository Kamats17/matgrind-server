// Server-authoritative match-result ledger (Stage 4).
//
// The server owns the outcome: it runs the engine, so the winner/method/scores
// live in room.matchState. This module builds an immutable result record from
// that state (NEVER from any client-supplied field) and writes it idempotently
// to Firestore keyed by matchId. A duplicate finish, a reconnect-driven replay,
// or a process restart that re-attempts the write resolves to a single record —
// the foundation for closing the client-forgery gap on XP/wins/leaderboards.
//
// The build is pure (unit-tested); the write is I/O-isolated and injected with
// the Firestore handle by index.mjs (null in dev → no-op).

/**
 * Build the authoritative result record for a finished room. Reads ONLY the
 * engine's matchState + the room's player identities — no client outcome field
 * is ever consulted.
 * @returns {{ collection: string, matchId: string, record: object }}
 */
export function buildResultRecord(room, nowMs) {
  const s = (room && room.matchState) || {};
  return {
    collection: 'match_results',
    matchId: room.matchId,
    record: {
      matchId: room.matchId,
      roomCode: room.code,
      style: room.style,
      // Server-authoritative outcome — straight from the engine's matchState.
      winner: s.winner ?? null,        // 'p1' | 'p2' | null (draw)
      winMethod: s.winMethod ?? null,
      // Per-player server-owned fields. takedowns/pinCount feed the authoritative
      // online reward reducer (onlineRewards.mjs) — never any client claim.
      p1: {
        uid: room.host?.uid ?? null, name: room.host?.name ?? null,
        score: s.p1?.score ?? null, takedowns: s.p1?.takedownCount ?? 0, pinCount: s.p1?.pinCount ?? 0,
      },
      p2: {
        uid: room.guest?.uid ?? null, name: room.guest?.name ?? null,
        score: s.p2?.score ?? null, takedowns: s.p2?.takedownCount ?? 0, pinCount: s.p2?.pinCount ?? 0,
      },
      finishedAt: nowMs,
      schema: 2,
    },
  };
}

/**
 * Idempotently persist a built record. Uses Firestore create() keyed by
 * matchId: the FIRST write wins; a replay throws ALREADY_EXISTS (gRPC code 6)
 * which we treat as a no-op. No Firestore handle (dev) → 'skipped'.
 * @returns {Promise<'written'|'duplicate'|'skipped'>}
 */
export async function writeResultRecord(db, built) {
  if (!db || !built || !built.matchId) return 'skipped';
  try {
    await db.collection(built.collection).doc(built.matchId).create(built.record);
    return 'written';
  } catch (e) {
    if (e && (e.code === 6 || /ALREADY_EXISTS/i.test(String(e.message || e)))) return 'duplicate';
    throw e;
  }
}
