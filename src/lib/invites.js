// Invite-link engine. Lets a signed-in wrestler generate a short code
// that anyone can open to be friend-requested automatically.
//
// Storage:
//   invites/{code}: {
//     owner_uid:  string
//     created_at: Timestamp
//     expires_at: Timestamp   // owner_created_at + 7 days
//     revoked:    boolean     // reserved; always false on create
//   }
//
// Code shape is 8 chars from [A-Z0-9], picked for human-readability in
// iMessage / Twitter. Collision odds at 36^8 (~2.8e12) are fine for the
// scale we'll hit for the foreseeable future. If two creations race on
// the same code we retry once - not worth a transaction.
//
// Share URLs intentionally point at the web domain even on iOS so the
// link survives being pasted into non-Capacitor contexts (SMS previews,
// shared notes, Slack). The iOS app registers both
// `matgrind://invite/<code>` and the universal-link path `/i/<code>`;
// `deepLink.js` routes either to consumeInvite().

import {
  doc, setDoc, getDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { sendFriendRequest } from './friendRequests';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/I/1 - readability
const CODE_LEN = 8;
const EXPIRY_DAYS = 7;
const WEB_BASE = 'https://play.matgrind.com';

function makeCode() {
  let out = '';
  const arr = new Uint8Array(CODE_LEN);
  (globalThis.crypto || window.crypto).getRandomValues(arr);
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Create a new invite for `ownerUid`. Returns the code + shareable URLs.
 * @param {string} ownerUid
 */
export async function createInvite(ownerUid) {
  if (!ownerUid) throw new Error('Missing owner uid');

  // One retry on collision. Two strikes ≈ 8e-25 odds - we'd rather bail
  // loudly than loop silently if the RNG is somehow broken.
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = makeCode();
    const ref = doc(db, 'invites', code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;

    const expiresAt = Timestamp.fromMillis(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await setDoc(ref, {
      owner_uid: ownerUid,
      created_at: serverTimestamp(),
      expires_at: expiresAt,
      revoked: false,
    });
    return {
      code,
      url: `${WEB_BASE}/i/${code}`,
      nativeUrl: `matgrind://invite/${code}`,
      expiresAt: expiresAt.toMillis(),
    };
  }
  throw new Error('Failed to allocate invite code');
}

/**
 * Consume an invite code as `consumerUid`. If the code is valid and not
 * expired, sends a friend request from the consumer to the invite owner.
 *
 * Returns an outcome string so callers can render the right toast:
 *   'sent' | 'already_friends' | 'already_pending_out' | 'already_pending_in'
 *   | 'self' | 'not_found' | 'expired' | 'revoked'
 */
export async function consumeInvite(code, consumerUid) {
  if (!code || !consumerUid) throw new Error('Missing code or uid');
  const clean = String(code).trim().toUpperCase();
  const snap = await getDoc(doc(db, 'invites', clean));
  if (!snap.exists()) return 'not_found';

  const invite = snap.data();
  if (invite.revoked) return 'revoked';
  const expiresMs = invite.expires_at?.toMillis?.() ?? 0;
  if (expiresMs && expiresMs < Date.now()) return 'expired';
  if (invite.owner_uid === consumerUid) return 'self';

  const outcome = await sendFriendRequest(consumerUid, invite.owner_uid);
  return outcome; // one of the sendFriendRequest return values
}

/**
 * Parse an invite code out of any of the three forms we might see:
 *   - https://play.matgrind.com/i/<code>
 *   - matgrind://invite/<code>
 *   - <code> (bare, for paste-in fallback)
 * Returns null if nothing parseable.
 */
export function parseInviteCode(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/(?:\/i\/|matgrind:\/\/invite\/|^)([A-Z0-9]{6,12})$/i);
  return m ? m[1].toUpperCase() : null;
}
