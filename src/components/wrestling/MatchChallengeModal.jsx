import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Swords, X as XIcon } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useMatchChallenge } from '../../lib/MatchChallengeContext.jsx';
import { acceptChallenge, declineChallenge, isExpired } from '../../lib/matchChallenges.js';
import { acceptChallengeAsGuest } from '../../lib/queueManager.js';
import { haptic } from '../../lib/haptics.js';

// Global incoming-challenge modal. Mounted once at the App level - any
// signed-in user with a pending match challenge addressed to them sees
// it pop up the moment the challenge doc lands in Firestore. Accept
// flips the doc to 'accepted' and joins the room via the queue manager
// (the existing onMatchFound consumer in WrestlingGame takes the live
// NetworkClient and starts the match). Decline flips the doc and
// dismisses.
//
// Renders nothing when there's no pending challenge. The modal is
// intentionally non-dismissable on backdrop tap - only Accept / Decline
// resolve it, so a user can't accidentally swipe away an invite.

export default function MatchChallengeModal() {
  const { user } = useAuth();
  const { incoming, dismiss } = useMatchChallenge();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Auto-dismiss the modal when the challenge expires while it's open.
  // The Firestore doc TTL is 5 minutes; we tick a short timer here so
  // the UI stops asking the user to act on a dead invite.
  useEffect(() => {
    if (!incoming) return undefined;
    const t = setInterval(() => {
      if (isExpired(incoming)) dismiss();
    }, 5000);
    return () => clearInterval(t);
  }, [incoming, dismiss]);

  if (!incoming) return null;

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try { haptic.medium(); } catch { /* silent */ }
    try {
      // Flip the Firestore doc first so the sender sees the accept
      // immediately - even if the WS join takes a beat. The status
      // change is what unlocks the sender's "they accepted!" UI; the
      // actual room join happens in parallel.
      await acceptChallenge(user.uid);
      await acceptChallengeAsGuest({
        roomCode: incoming.roomCode,
        name: user.displayName || 'Player',
        style: incoming.style || 'folkstyle',
      });
      // Success: queueManager is now in 'connecting' / 'searching' and
      // will fire onMatchFound when the server emits game_start.
      // WrestlingGame's existing handler takes it from there. Drop the
      // modal; we don't need to follow the WS lifecycle from here.
      dismiss();
    } catch (e) {
      console.warn('[MatchChallengeModal] accept failed', e);
      setErr(e?.message || 'Could not accept the challenge.');
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try { haptic.light(); } catch { /* silent */ }
    try {
      await declineChallenge(user.uid);
    } catch (e) {
      console.warn('[MatchChallengeModal] decline failed', e);
    } finally {
      dismiss();
      setBusy(false);
    }
  };

  const styleLabel = incoming.style === 'freestyle' ? 'Freestyle'
    : incoming.style === 'greco' ? 'Greco-Roman'
    : 'Folkstyle';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="max-w-md w-full rounded-2xl border border-amber-500/40 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center ring-1 ring-amber-400/40 flex-shrink-0">
            <Swords className="w-5 h-5 text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-amber-300 text-[10px] font-black uppercase tracking-[0.2em]">
              Match Challenge
            </div>
            <div className="text-white font-bold text-lg truncate">
              {incoming.fromName || 'A wrestler'}
            </div>
          </div>
        </div>
        <div className="text-zinc-400 text-sm leading-relaxed mb-4">
          {incoming.fromName || 'They'} wants to wrestle you. <span className="text-zinc-300 font-semibold">{styleLabel}</span> match starts as soon as you accept.
        </div>

        {err && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] font-bold p-2 rounded-lg mb-3">
            {err}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleDecline}
            disabled={busy}
            className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-1"
          >
            <XIcon className="w-4 h-4" />
            Decline
          </button>
          <button
            onClick={handleAccept}
            disabled={busy || !incoming.roomCode}
            className="flex-1 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black disabled:opacity-60 inline-flex items-center justify-center gap-1"
          >
            <Swords className="w-4 h-4" />
            {busy ? 'Joining…' : 'Accept'}
          </button>
        </div>
        {!Capacitor.isNativePlatform() && (
          <div className="mt-3 text-zinc-600 text-[10px] text-center">
            Tip: native app users get a push notification when invited.
          </div>
        )}
      </div>
    </div>
  );
}
