// Visibility resolution for Profile ↔ PublicProfile.
//
// There are two axes: the viewer's relationship to the target
// ('self' | 'friend' | 'stranger') and the target's privacy toggle
// ('public' | 'friends_only'). The combined mode determines which
// Profile sections render and which fields are redacted.
//
// Kept as a pure helper so both the React component and future
// server-side code (e.g. a redaction Cloud Function) can share logic.

/**
 * @param {{id?: string, uid?: string, profile_visibility?: string} | null} target
 * @param {string | null} viewerUid
 * @param {string[]} viewerFriends  practice_friends list of the viewer
 * @returns {'self' | 'friend' | 'stranger_public' | 'stranger_private'}
 */
export function resolveVisibility(target, viewerUid, viewerFriends = []) {
  if (!target) return 'stranger_private';
  const targetUid = target.id || target.uid;
  if (viewerUid && targetUid && viewerUid === targetUid) return 'self';
  const isFriend = Array.isArray(viewerFriends) && targetUid && viewerFriends.includes(targetUid);
  if (isFriend) return 'friend';
  const vis = target.profile_visibility || 'public';
  return vis === 'friends_only' ? 'stranger_private' : 'stranger_public';
}

/** True when the viewer can see detailed sections (history, goals, etc). */
export function canSeeDetails(mode) {
  return mode === 'self' || mode === 'friend';
}

/** True when only the "🔒 Friends-only" redaction should render. */
export function isRedacted(mode) {
  return mode === 'stranger_private';
}
