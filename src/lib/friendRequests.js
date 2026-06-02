// Mutual friend-request engine. Both sides must accept before either
// appears in the other's `practice_friends` list (which is what the
// Friends leaderboard tab reads).
//
// Data model on the profile doc:
//   friend_requests_in:  string[]  uids who asked to friend me
//   friend_requests_out: string[]  uids I've asked to friend
//   practice_friends:    string[]  mutual, accepted friends
//
// Every mutation touches exactly two profile docs - the initiator's and
// the target's - and we run them inside a Firestore transaction so a
// mid-flight failure can't leave us half-linked.

import { doc, runTransaction, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from './firebase';

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Send a friend request from `senderUid` to `targetUid`.
 * No-op if already friends or a request is already pending either way.
 * @returns {Promise<'sent' | 'already_friends' | 'already_pending_out' | 'already_pending_in'>}
 */
export async function sendFriendRequest(senderUid, targetUid) {
  if (!senderUid || !targetUid) throw new Error('Missing uid');
  if (senderUid === targetUid) throw new Error('Cannot friend yourself');

  const senderRef = doc(db, 'profiles', senderUid);
  const targetRef = doc(db, 'profiles', targetUid);

  return runTransaction(db, async (tx) => {
    const [senderSnap, targetSnap] = await Promise.all([tx.get(senderRef), tx.get(targetRef)]);
    if (!senderSnap.exists()) throw new Error('Sender profile missing');
    if (!targetSnap.exists()) throw new Error('Target profile missing');

    const sender = senderSnap.data();
    const target = targetSnap.data();

    const sFriends = asArray(sender.practice_friends);
    if (sFriends.includes(targetUid)) return 'already_friends';

    const sOut = asArray(sender.friend_requests_out);
    if (sOut.includes(targetUid)) return 'already_pending_out';

    // If the target already sent US a request, this flow should call
    // acceptFriendRequest instead - but surface cleanly rather than throw.
    const sIn = asArray(sender.friend_requests_in);
    if (sIn.includes(targetUid)) return 'already_pending_in';

    tx.update(senderRef, { friend_requests_out: arrayUnion(targetUid) });
    tx.update(targetRef, { friend_requests_in: arrayUnion(senderUid) });
    return 'sent';
  });
}

/**
 * Accept an incoming request from `senderUid`. Mutual: adds each user
 * to the other's practice_friends list and clears both pending slots.
 */
export async function acceptFriendRequest(myUid, senderUid) {
  if (!myUid || !senderUid) throw new Error('Missing uid');
  if (myUid === senderUid) throw new Error('Cannot friend yourself');

  const myRef = doc(db, 'profiles', myUid);
  const senderRef = doc(db, 'profiles', senderUid);

  return runTransaction(db, async (tx) => {
    const [meSnap, senderSnap] = await Promise.all([tx.get(myRef), tx.get(senderRef)]);
    if (!meSnap.exists()) throw new Error('Profile missing');
    if (!senderSnap.exists()) throw new Error('Sender profile missing');

    const me = meSnap.data();
    const myIn = asArray(me.friend_requests_in);
    if (!myIn.includes(senderUid)) {
      // Stale client - request was already cancelled/accepted elsewhere.
      return 'stale';
    }

    tx.update(myRef, {
      friend_requests_in: arrayRemove(senderUid),
      practice_friends: arrayUnion(senderUid),
    });
    tx.update(senderRef, {
      friend_requests_out: arrayRemove(myUid),
      practice_friends: arrayUnion(myUid),
    });
    return 'accepted';
  });
}

/**
 * Reject an incoming request. Clears both pending slots, no friendship.
 *
 * Firestore transactions require all reads to complete BEFORE any writes -
 * we read both profiles up front so the writes that follow stay legal even
 * when the second profile (the sender) doesn't exist anymore.
 */
export async function rejectFriendRequest(myUid, senderUid) {
  if (!myUid || !senderUid) throw new Error('Missing uid');
  const myRef = doc(db, 'profiles', myUid);
  const senderRef = doc(db, 'profiles', senderUid);

  return runTransaction(db, async (tx) => {
    const [meSnap, senderSnap] = await Promise.all([tx.get(myRef), tx.get(senderRef)]);
    if (!meSnap.exists()) throw new Error('Profile missing');
    tx.update(myRef, { friend_requests_in: arrayRemove(senderUid) });
    // Sender doc might not exist (deleted account) - skip if so.
    if (senderSnap.exists()) {
      tx.update(senderRef, { friend_requests_out: arrayRemove(myUid) });
    }
    return 'rejected';
  });
}

/**
 * Cancel a request I previously sent. Mirror of reject, from the sender side.
 * All reads happen before all writes (Firestore transaction requirement).
 */
export async function cancelOutgoing(myUid, targetUid) {
  if (!myUid || !targetUid) throw new Error('Missing uid');
  const myRef = doc(db, 'profiles', myUid);
  const targetRef = doc(db, 'profiles', targetUid);

  return runTransaction(db, async (tx) => {
    const [meSnap, targetSnap] = await Promise.all([tx.get(myRef), tx.get(targetRef)]);
    if (!meSnap.exists()) throw new Error('Profile missing');
    tx.update(myRef, { friend_requests_out: arrayRemove(targetUid) });
    if (targetSnap.exists()) {
      tx.update(targetRef, { friend_requests_in: arrayRemove(myUid) });
    }
    return 'cancelled';
  });
}

/**
 * Remove a mutual friendship. Pulls each side from the other's list.
 * All reads happen before all writes (Firestore transaction requirement) -
 * the prior implementation read the friend doc AFTER writing to my doc,
 * which Firestore rejects with "all reads must be executed before all writes".
 */
export async function unfriend(myUid, friendUid) {
  if (!myUid || !friendUid) throw new Error('Missing uid');
  const myRef = doc(db, 'profiles', myUid);
  const friendRef = doc(db, 'profiles', friendUid);

  return runTransaction(db, async (tx) => {
    const [meSnap, friendSnap] = await Promise.all([tx.get(myRef), tx.get(friendRef)]);
    if (!meSnap.exists()) throw new Error('Profile missing');
    tx.update(myRef, { practice_friends: arrayRemove(friendUid) });
    if (friendSnap.exists()) {
      tx.update(friendRef, { practice_friends: arrayRemove(myUid) });
    }
    return 'unfriended';
  });
}

/**
 * Small pure helper - given a viewer profile and a target uid, classify
 * the relationship for UI purposes. Keeps FriendButton / PublicProfile
 * from duplicating the same ladder of `.includes()` checks.
 *
 * @returns {'self' | 'friends' | 'pending_out' | 'pending_in' | 'none'}
 */
export function relationshipTo(viewerProfile, targetUid) {
  if (!viewerProfile || !targetUid) return 'none';
  if (viewerProfile.id === targetUid || viewerProfile.uid === targetUid) return 'self';
  if (asArray(viewerProfile.practice_friends).includes(targetUid)) return 'friends';
  if (asArray(viewerProfile.friend_requests_out).includes(targetUid)) return 'pending_out';
  if (asArray(viewerProfile.friend_requests_in).includes(targetUid)) return 'pending_in';
  return 'none';
}
