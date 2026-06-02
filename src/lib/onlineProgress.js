// Stage 4 client reconciliation (pure helpers).
//
// Online wins/XP/achievements are authoritative server-side in online_progress/{uid}.
// The server pushes a trusted `match_settled` receipt over the socket after it commits
// the settlement transaction; the client only DISPLAYS and SUBMITS those values - it
// never computes or claims them. These helpers keep the apply path honest:
//   - dedupe settlements by matchId (a late push or a fallback read must not double-apply)
//   - read the trusted online win count from the server source, never the (forgeable,
//     mixed-mode) local profile.
//
// The Firestore fallback read (reconnect / missed push) lives in
// firestoreService.getOnlineProgress() so this module stays import-light and unit-testable.

/**
 * True iff this matchId's settlement has not been applied yet. Mutating the set
 * is the caller's job (apply, then `seen.add(matchId)`).
 * @param {Set<string>} seenMatchIds
 * @param {string} matchId
 */
export function shouldApplySettlement(seenMatchIds, matchId) {
  if (!matchId) return false;
  return !seenMatchIds.has(matchId);
}

/**
 * The trusted online win count to display / submit to Game Center. `source` is the
 * server-owned online_progress (from a match_settled receipt or a fallback read) -
 * never the client's local profile.online_wins.
 * @param {{wins?: number|string}|null|undefined} source
 */
export function trustedOnlineWins(source) {
  return Number(source?.wins) || 0;
}

/**
 * Resolve server-sent achievement ids to display objects from a client registry
 * (profileUtils.ACHIEVEMENTS), preserving order and skipping ids the client does
 * not know. Used to surface server-awarded online achievements in the result modal.
 * @param {string[]|null|undefined} ids
 * @param {Array<{id: string}>|null|undefined} registry
 */
export function resolveAchievementObjects(ids, registry) {
  if (!Array.isArray(ids) || !Array.isArray(registry)) return [];
  return ids
    .map((id) => registry.find((a) => a && a.id === id))
    .filter(Boolean);
}
