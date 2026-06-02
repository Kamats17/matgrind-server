// Static registry of permanent special honors keyed by Firebase Auth uid.
// Rendered next to the wrestler's name on the Leaderboard row and on the
// right side of their PublicProfile hero. Keyed by uid (not username) so
// a rename can't strip the honor.

export const HONORS = {
  WWUGDInCBuQmpi33sRU5puCHwDR2: {
    id: 'champion_1st_matgrind',
    title: '1st MatGrind Champion',
    imageSrc: '/honor-1st-champion.png',
  },
  QRbRMC6tzqhWX4PApoSS2Fbegzv2: {
    id: 'beta_2nd_place',
    title: '2nd Place MatGrind Beta',
    imageSrc: '/honor-2nd-beta.png',
  },
  SudP95U46FhdBfvJSc7MwP0EVo72: {
    id: 'beta_3rd_place',
    title: '3rd Place MatGrind Beta',
    imageSrc: '/honor-3rd-beta.png',
  },
};

/** @param {string | null | undefined} uid */
export function honorFor(uid) {
  if (!uid) return null;
  return HONORS[uid] || null;
}
