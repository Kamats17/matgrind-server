// In-app match challenge engine.
//
// When a user taps "Invite to match" next to a friend, we write a single
// Firestore doc at match_challenges/{recipientUid} that the recipient's
// app listens for in real time. The doc's status field flips between
// pending -> accepted/declined/cancelled to drive the UI on both sides.
//
// Doc id = recipient uid: only one pending incoming challenge per user
// at a time. A fresh challenge overwrites the prior one so the latest
// sender wins. Previous senders see their challenge transition to
// status='cancelled' via their own outgoing listener and clean up.

import {
  doc, setDoc, updateDoc, deleteDoc, getDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase.js';

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes - long enough for the recipient to notice + respond

function challengeRef(recipientUid) {
  return doc(db, 'match_challenges', recipientUid);
}

/**
 * Write a fresh challenge from `senderUid` to `recipientUid`. Initial
 * doc carries the sender's display name + wrestling style; the room
 * code is patched in via `setChallengeRoomCode` once the sender's WS
 * server has created the private room.
 *
 * @returns {Promise<void>}
 */
export async function createChallenge({ senderUid, senderName, recipientUid, style }) {
  if (!senderUid || !recipientUid) throw new Error('Missing uid');
  if (senderUid === recipientUid) throw new Error('Cannot challenge yourself');
  const expiresAt = Timestamp.fromMillis(Date.now() + EXPIRY_MS);
  await setDoc(challengeRef(recipientUid), {
    from: senderUid,
    fromName: senderName || 'A wrestler',
    to: recipientUid,
    style: style || 'folkstyle',
    status: 'pending',
    roomCode: null,
    createdAt: serverTimestamp(),
    expiresAt,
  });
}

/**
 * Patch the room code into an existing pending challenge. Called by the
 * sender once their `create_room` round-trip with the WS server returns
 * a code. Two-step write avoids leaving a window where the recipient
 * could accept before there's a room to join.
 */
export async function setChallengeRoomCode(recipientUid, roomCode) {
  if (!roomCode) throw new Error('Missing room code');
  await updateDoc(challengeRef(recipientUid), { roomCode });
}

/**
 * Recipient flips status to 'accepted'. The sender's outgoing listener
 * picks this up and lets the WS layer drive the rest (the recipient
 * joinRoom()s in parallel; game_start fires on both sides).
 */
export async function acceptChallenge(recipientUid) {
  await updateDoc(challengeRef(recipientUid), { status: 'accepted' });
}

/** Recipient declines without joining. Sender sees the flip via listener. */
export async function declineChallenge(recipientUid) {
  await updateDoc(challengeRef(recipientUid), { status: 'declined' });
}

/**
 * Sender cancels mid-flight (closed the app, changed mind, took too
 * long). Marks the doc cancelled so the recipient's listener can drop
 * its modal cleanly even if the sender's WS already closed.
 */
export async function cancelChallenge(recipientUid) {
  try {
    await updateDoc(challengeRef(recipientUid), { status: 'cancelled' });
  } catch {
    // Already gone - swallow. The sender's local cleanup is the
    // important bit; the doc disappearing is fine.
  }
}

/** Drop the doc entirely after the match has started (or fully resolved). */
export async function clearChallenge(recipientUid) {
  try { await deleteDoc(challengeRef(recipientUid)); } catch { /* ignore */ }
}

/**
 * One-shot read used by the recipient's accept handler to grab the
 * latest doc just before joining the room - guards against acting on a
 * stale snapshot if the sender cancelled between modal-render and tap.
 */
export async function readChallenge(recipientUid) {
  const snap = await getDoc(challengeRef(recipientUid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Treat any doc older than EXPIRY_MS as expired regardless of stored TS. */
export function isExpired(challenge) {
  if (!challenge) return true;
  const ts = challenge.expiresAt?.toMillis?.() ?? challenge.createdAt?.toMillis?.() ?? 0;
  if (!ts) return false; // brand-new doc whose serverTimestamp hasn't materialized yet
  return Date.now() > ts;
}
