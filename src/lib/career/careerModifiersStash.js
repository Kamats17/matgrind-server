// Tagged stash for career match modifiers. Pure data ops; the ref lives in
// WrestlingGame.jsx but the tag-validation logic is testable in isolation.
//
// The {careerId, eventId} tag prevents stale modifiers from leaking between
// careers or events: readModifiers returns null whenever the active context
// does not match the stashed context, so a forgotten clear cannot contaminate
// a different career/event.

export function stashModifiers(prev, careerId, eventId, mods) {
  if (!careerId || !eventId) return prev;
  return { careerId, eventId, mods };
}

export function readModifiers(stash, careerId, eventId) {
  if (!stash) return null;
  if (stash.careerId !== careerId || stash.eventId !== eventId) return null;
  return stash.mods;
}

export function clearModifiers() {
  return null;
}
