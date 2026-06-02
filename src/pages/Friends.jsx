// Friends management screen. Three tabs driven off the viewer's own
// profile:
//   • Requests - friend_requests_in[]   (Accept / Reject)
//   • Sent     - friend_requests_out[]  (Cancel)
//   • Friends  - practice_friends[]     (View / Unfriend)
//
// All three lists are materialized by batching through
// `getProfilesByUids` so we get a name/level/team for each uid without
// N separate reads.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { haptic } from '../lib/haptics.js';
import { getProfile, getProfilesByUids, searchUsersByUsername } from '../lib/firestoreService.js';
import {
  acceptFriendRequest, rejectFriendRequest, cancelOutgoing, unfriend,
  sendFriendRequest, relationshipTo,
} from '../lib/friendRequests.js';
import { getLevelFromXP } from '../lib/profileUtils.js';
import { clearFriendRequestNotification } from '../lib/notificationService.js';
import { createChallenge } from '../lib/matchChallenges.js';
import { startChallengeAsHost } from '../lib/queueManager.js';
import NavBar from '../components/ui/NavBar';
import { UserPlus, Check, X as XIcon, UserMinus, Clock, Users, Share2, Search, Swords } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { createInvite } from '../lib/invites.js';
import { withTimeout } from '../lib/withTimeout.js';

const TABS = [
  { id: 'find', label: 'Find' },
  { id: 'requests', label: 'Requests' },
  { id: 'sent', label: 'Sent' },
  { id: 'friends', label: 'Friends' },
];

export default function Friends({ onBack, onViewProfile }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [others, setOthers] = useState({});   // uid -> profile
  const [tab, setTab] = useState('requests');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');         // uid currently being acted on
  const [err, setErr] = useState('');

  // Find-tab search state. Debounced so we aren't firing a Firestore query
  // on every keystroke. Results carry the full profile shape from the search
  // hit, plus a relationship tag derived against the viewer's own profile so
  // the row's CTA reads correctly (Add / Pending / Friends).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchSeqRef = useRef(0);

  // Confirmation modal for the destructive unfriend action. Stores the uid
  // and display name of the friend being removed so the dialog can address
  // them by name. Cleared on Yes/No.
  const [confirmingUnfriend, setConfirmingUnfriend] = useState(null);

  // Clear the "new friend request" tray notification on mount - the user is
  // viewing the page now, no need to keep nudging them about it. Matches the
  // pattern used after match-found notifications are consumed.
  useEffect(() => {
    clearFriendRequestNotification().catch(() => { /* not fatal */ });
  }, []);

  const refresh = useCallback(async () => {
    if (!user?.uid) return { ok: true };
    const meRes = await withTimeout(getProfile(user.uid), 10_000, 'friends.getProfile');
    if (!meRes.ok) return meRes;
    const me = meRes.value;
    setProfile(me);
    const uids = Array.from(new Set([
      ...(Array.isArray(me?.friend_requests_in) ? me.friend_requests_in : []),
      ...(Array.isArray(me?.friend_requests_out) ? me.friend_requests_out : []),
      ...(Array.isArray(me?.practice_friends) ? me.practice_friends : []),
    ]));
    if (uids.length === 0) { setOthers({}); return { ok: true }; }
    const rowsRes = await withTimeout(getProfilesByUids(uids), 10_000, 'friends.getProfilesByUids');
    if (!rowsRes.ok) return rowsRes;
    const map = {};
    for (const r of rowsRes.value) map[r.id] = r;
    setOthers(map);
    return { ok: true };
  }, [user?.uid]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    refresh()
      .then((res) => {
        if (cancelled) return;
        if (res && res.ok === false) {
          if (res.error === 'timeout') {
            setErr("Couldn't load friends - request timed out. Tap Retry.");
          } else {
            console.warn('[Friends] load', res.error);
            setErr("Couldn't load friends. Tap Retry.");
          }
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[Friends] load', e);
        setErr("Couldn't load friends. Tap Retry.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setErr('');
    refresh()
      .then((res) => {
        if (res && res.ok === false) {
          if (res.error === 'timeout') {
            setErr("Couldn't load friends - request timed out. Tap Retry.");
          } else {
            console.warn('[Friends] retry', res.error);
            setErr("Couldn't load friends. Tap Retry.");
          }
        }
      })
      .catch((e) => {
        console.warn('[Friends] retry', e);
        setErr("Couldn't load friends. Tap Retry.");
      })
      .finally(() => { setLoading(false); });
  }, [refresh]);

  const inReq  = Array.isArray(profile?.friend_requests_in)  ? profile.friend_requests_in  : [];
  const outReq = Array.isArray(profile?.friend_requests_out) ? profile.friend_requests_out : [];
  const friends = Array.isArray(profile?.practice_friends)   ? profile.practice_friends   : [];

  const act = async (uid, fn) => {
    if (busy) return;
    setBusy(uid);
    setErr('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      console.warn('[Friends] action failed', e);
      setErr(e?.message || 'Something went wrong');
    } finally {
      setBusy('');
    }
  };

  // Optimistic unfriend: pull the friend out of local state the moment
  // the Firestore transaction returns. The previous flow waited on a
  // refresh() call after the action - if that follow-up read stalled or
  // hit a transient error, the friend stayed visible and the unfriend
  // button "looked broken" even though the write went through.
  const performUnfriend = useCallback(async (uid) => {
    if (busy || !user?.uid) return;
    setBusy(uid);
    setErr('');
    try {
      await unfriend(user.uid, uid);
      // Pull the row immediately so the user sees the change without
      // waiting on a follow-up read. Background refresh is best-effort.
      setProfile((p) => p ? {
        ...p,
        practice_friends: (Array.isArray(p.practice_friends) ? p.practice_friends : []).filter((f) => f !== uid),
      } : p);
      setOthers((o) => {
        if (!o[uid]) return o;
        const copy = { ...o };
        delete copy[uid];
        return copy;
      });
      refresh().catch(() => { /* best effort */ });
    } catch (e) {
      console.warn('[Friends] unfriend failed', e);
      setErr(e?.message || 'Could not remove friend. Tap to retry.');
    } finally {
      setBusy('');
    }
  }, [busy, user?.uid, refresh]);

  const counts = useMemo(() => ({
    find: 0,
    requests: inReq.length,
    sent: outReq.length,
    friends: friends.length,
  }), [inReq.length, outReq.length, friends.length]);

  // Debounced username search. Cancels in-flight queries when the user keeps
  // typing by stamping each query with a sequence number; only the latest
  // sequence's results are written to state.
  useEffect(() => {
    if (tab !== 'find') return undefined;
    const term = searchQuery.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const hits = await searchUsersByUsername(term, user?.uid);
        if (seq !== searchSeqRef.current) return; // stale
        setSearchResults(hits);
      } catch (e) {
        if (seq !== searchSeqRef.current) return;
        console.warn('[Friends] search failed', e);
        setSearchResults([]);
      } finally {
        if (seq === searchSeqRef.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, tab, user?.uid]);

  const handleSendRequest = useCallback(async (targetUid) => {
    if (!user?.uid || busy) return;
    setBusy(targetUid);
    setErr('');
    try {
      const result = await sendFriendRequest(user.uid, targetUid);
      if (result === 'sent' || result === 'already_pending_in') {
        await refresh();
      }
      // Other return values (already_friends / already_pending_out) are
      // displayed via relationshipTo on the next render of the result list.
    } catch (e) {
      console.warn('[Friends] sendFriendRequest', e);
      setErr(e?.message || 'Failed to send request');
    } finally {
      setBusy('');
    }
  }, [user?.uid, busy, refresh]);

  // Generic invite (top-of-page button). Generates a fresh invite URL and
  // hands it to the OS share sheet without targeting any specific friend.
  const handleShareInvite = async () => {
    if (!user?.uid || busy) return;
    setBusy('invite');
    setErr('');
    try {
      const { url } = await createInvite(user.uid);
      const shareText = `Come wrestle me on MatGrind: ${url}`;
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: 'MatGrind invite', text: shareText, url, dialogTitle: 'Invite a friend' });
      } else if (navigator.share) {
        await navigator.share({ title: 'MatGrind invite', text: shareText, url });
      } else {
        await navigator.clipboard?.writeText(url);
        setErr('Link copied to clipboard');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.warn('[Friends] invite share', e);
        setErr(e?.message || 'Failed to create invite');
      }
    } finally {
      setBusy('');
    }
  };

  // Per-friend "Invite to match". In-app challenge: writes a Firestore
  // doc the recipient is listening for, then opens the WS host flow so
  // the private room is ready when they accept. WrestlingGame's existing
  // onMatchFound consumer takes the live NetworkClient once the match
  // starts and drops both players into the bout - no link sharing, no
  // navigation away from this screen.
  const handleInviteToMatch = useCallback(async (friendUid, friendName) => {
    if (!user?.uid || busy) return;
    setBusy(friendUid);
    setErr('');
    try {
      const senderName = profile?.username || user.displayName || 'A wrestler';
      const style = 'folkstyle';
      // 1. Write the Firestore doc first so the recipient sees a
      //    "pending" record even before our WS auth lands. The room
      //    code field is null at this point; queueManager patches it in
      //    once the server confirms the room is live, which is what
      //    unlocks the recipient's Accept button via the held-back
      //    rule in MatchChallengeContext.
      await createChallenge({
        senderUid: user.uid,
        senderName,
        recipientUid: friendUid,
        style,
      });
      // 2. Open the WS connection in host mode. State machine is
      //    'connecting' -> 'searching' -> 'found'; GlobalQueueOverlay
      //    surfaces the waiting indicator and gives the user a cancel
      //    button while we wait for the recipient.
      await startChallengeAsHost({
        targetUid: friendUid,
        name: senderName,
        style,
      });
      setErr(`Challenge sent to ${friendName || 'your friend'}. Waiting for them to accept…`);
    } catch (e) {
      console.warn('[Friends] invite to match', e);
      setErr(e?.message || 'Failed to send challenge');
    } finally {
      setBusy('');
    }
  }, [user?.uid, busy, profile?.username, user?.displayName]);

  if (loading) {
    return (
      <div className="min-h-full bg-zinc-950 text-white flex flex-col">
        <NavBar title="Friends" onBack={onBack} />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const rows = tab === 'requests' ? inReq : tab === 'sent' ? outReq : tab === 'friends' ? friends : [];

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Friends" onBack={onBack} />

      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
        <div role="radiogroup" aria-label="Friends section" className="flex gap-1 px-3 py-2 md:max-w-2xl md:mx-auto">
          {TABS.map(t => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={isActive}
                aria-label={t.label}
                data-testid={isActive ? 'friends-tab-active' : `friends-tab-${t.id}`}
                onClick={() => {
                  if (isActive) {
                    try { haptic.light(); } catch { /* silent */ }
                  } else {
                    setTab(t.id);
                  }
                }}
                className={`flex-1 text-[11px] font-black uppercase tracking-wider py-2 rounded-lg transition ${
                  isActive
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label}
                {counts[t.id] > 0 && (
                  <span className="ml-1 text-[10px] text-zinc-500">· {counts[t.id]}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-3 pb-[env(safe-area-inset-bottom)] md:max-w-2xl md:mx-auto w-full space-y-2">
        <button
          onClick={handleShareInvite}
          disabled={busy === 'invite' || !user?.uid}
          className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 font-black text-xs py-3 rounded-xl shadow-lg disabled:opacity-60"
        >
          <Share2 className="inline w-4 h-4 mr-2" />
          {busy === 'invite' ? 'Creating link…' : 'Share Invite Link'}
        </button>

        {err && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] font-bold p-2 rounded-lg flex items-center justify-between gap-2">
            <span className="flex-1">{err}</span>
            {err.startsWith("Couldn't load friends") && (
              <button
                type="button"
                onClick={handleRetry}
                className="px-2 py-1 rounded bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40 text-[11px] font-black"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {tab === 'find' && (
          <FindUsersPanel
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults}
            searching={searching}
            viewerProfile={profile}
            busy={busy}
            onView={(uid) => onViewProfile?.(uid)}
            onAdd={handleSendRequest}
            onQuickInvite={handleShareInvite}
            quickInviteBusy={busy === 'invite'}
          />
        )}

        {tab !== 'find' && rows.length === 0 && <EmptyState tab={tab} />}

        {tab !== 'find' && rows.map(uid => {
          const other = others[uid];
          const name = other?.username || 'Unknown wrestler';
          const team = other?.team || '';
          const level = other?.level || getLevelFromXP(other?.xp || 0);
          const isBusy = busy === uid;

          return (
            <div key={uid} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center gap-3">
              <button
                onClick={() => onViewProfile?.(uid)}
                className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-zinc-950 text-sm font-black flex-shrink-0"
                title="View profile"
              >
                {name.slice(0, 2).toUpperCase()}
              </button>
              <button
                onClick={() => onViewProfile?.(uid)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="text-white text-sm font-black truncate">{name}</div>
                <div className="text-zinc-500 text-[11px] truncate">
                  LVL {level}{team ? ` · 🏫 ${team}` : ''}
                </div>
              </button>

              {tab === 'requests' && (
                <div className="flex gap-1">
                  <button
                    onClick={() => act(uid, () => acceptFriendRequest(user.uid, uid))}
                    disabled={isBusy}
                    className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40 disabled:opacity-60"
                    title="Accept"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => act(uid, () => rejectFriendRequest(user.uid, uid))}
                    disabled={isBusy}
                    className="p-2 rounded-lg bg-zinc-800 text-zinc-400 disabled:opacity-60"
                    title="Reject"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              )}
              {tab === 'sent' && (
                <button
                  onClick={() => act(uid, () => cancelOutgoing(user.uid, uid))}
                  disabled={isBusy}
                  className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-[11px] font-black disabled:opacity-60"
                >
                  <Clock className="inline w-3 h-3 mr-1" /> Cancel
                </button>
              )}
              {tab === 'friends' && (
                <div className="flex gap-1">
                  <button
                    onClick={() => handleInviteToMatch(uid, name)}
                    disabled={isBusy}
                    className="p-2 rounded-lg bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30 hover:bg-amber-500/25 disabled:opacity-60"
                    title="Invite to match"
                    aria-label={`Invite ${name} to a match`}
                  >
                    <Swords className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmingUnfriend({ uid, name })}
                    disabled={isBusy}
                    className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-60"
                    title="Unfriend"
                    aria-label={`Remove ${name} as a friend`}
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unfriend confirmation - destructive same-side action gated behind a
          deliberate Yes/No so an accidental tap on the icon doesn't silently
          remove the friend. Reject / cancel skip this gate because both are
          easily reversible from the other user's side. */}
      {confirmingUnfriend && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-700 bg-zinc-950 p-5">
            <div className="text-rose-300 text-xs font-black uppercase tracking-[0.2em] mb-2">Remove friend</div>
            <div className="text-white font-bold text-lg mb-2">
              Remove {confirmingUnfriend.name} as a friend?
            </div>
            <div className="text-zinc-400 text-sm leading-relaxed mb-4">
              You can always send them a new friend request later.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingUnfriend(null)}
                disabled={busy === confirmingUnfriend.uid}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold disabled:opacity-60"
              >
                No, keep friend
              </button>
              <button
                onClick={() => {
                  const target = confirmingUnfriend;
                  setConfirmingUnfriend(null);
                  if (target?.uid) performUnfriend(target.uid);
                }}
                disabled={busy === confirmingUnfriend.uid}
                className="flex-1 py-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black disabled:opacity-60"
              >
                Yes, remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab }) {
  const copy = tab === 'requests'
    ? { icon: <UserPlus className="w-6 h-6 text-zinc-500 mx-auto mb-2" />, title: 'No incoming requests', body: 'When someone adds you, their request shows up here.' }
    : tab === 'sent'
    ? { icon: <Clock className="w-6 h-6 text-zinc-500 mx-auto mb-2" />, title: 'No pending invites', body: 'Find a wrestler in the Find tab and tap Add to send them a request.' }
    : { icon: <Users className="w-6 h-6 text-zinc-500 mx-auto mb-2" />, title: 'No friends yet', body: 'Accept an incoming request or send one to start your friends list.' };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
      {copy.icon}
      <p className="text-zinc-300 text-sm font-bold">{copy.title}</p>
      <p className="text-zinc-500 text-xs mt-1">{copy.body}</p>
    </div>
  );
}

function FindUsersPanel({ query, onQueryChange, results, searching, viewerProfile, busy, onView, onAdd, onQuickInvite, quickInviteBusy }) {
  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 2;
  const showHint = trimmed.length === 0;

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">Search users by username</span>
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Search by username"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-400/30"
            aria-label="Search users by username"
          />
        </div>
      </label>

      {showHint && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center">
          <Search className="w-6 h-6 text-zinc-500 mx-auto mb-2" />
          <p className="text-zinc-300 text-sm font-bold">Find a training partner</p>
          <p className="text-zinc-500 text-xs mt-1">Type a username to search.</p>
          {onQuickInvite && (
            <>
              <div className="flex items-center gap-2 my-4 text-zinc-600 text-[10px] font-black tracking-widest uppercase">
                <span className="flex-1 h-px bg-zinc-800" />
                <span>or</span>
                <span className="flex-1 h-px bg-zinc-800" />
              </div>
              <button
                type="button"
                onClick={onQuickInvite}
                disabled={quickInviteBusy}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25 active:scale-[0.98] transition-all text-xs font-black disabled:opacity-60"
              >
                <Share2 className="w-4 h-4" />
                {quickInviteBusy ? 'Creating link…' : 'Share my invite link'}
              </button>
              <p className="text-zinc-600 text-[11px] mt-2">Send a link to a friend - they jump straight into a match with you.</p>
            </>
          )}
        </div>
      )}

      {tooShort && (
        <div className="text-zinc-500 text-xs px-1">Type at least 2 characters to search.</div>
      )}

      {searching && (
        <div className="flex items-center justify-center py-3 text-zinc-500 text-xs">
          <span className="w-3 h-3 border-2 border-zinc-700 border-t-amber-400 rounded-full animate-spin mr-2" />
          Searching…
        </div>
      )}

      {!searching && trimmed.length >= 2 && results.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center">
          <p className="text-zinc-300 text-sm font-bold">No matches</p>
          <p className="text-zinc-500 text-xs mt-1">No public profiles found for "{trimmed}".</p>
        </div>
      )}

      {results.map((u) => {
        const rel = relationshipTo(viewerProfile, u.id);
        const name = u.username || 'Unknown wrestler';
        const team = u.team || '';
        const level = u.level || getLevelFromXP(u.xp || 0);
        const isBusy = busy === u.id;
        return (
          <div key={u.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center gap-3">
            <button
              onClick={() => onView(u.id)}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-zinc-950 text-sm font-black flex-shrink-0"
              title="View profile"
            >
              {name.slice(0, 2).toUpperCase()}
            </button>
            <button
              onClick={() => onView(u.id)}
              className="flex-1 min-w-0 text-left"
            >
              <div className="text-white text-sm font-black truncate">{name}</div>
              <div className="text-zinc-500 text-[11px] truncate">
                LVL {level}{team ? ` · 🏫 ${team}` : ''}
              </div>
            </button>
            {rel === 'friends' && (
              <span className="px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 text-[10px] font-black ring-1 ring-emerald-400/30">
                Friends
              </span>
            )}
            {rel === 'pending_out' && (
              <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400 text-[10px] font-black">
                Pending
              </span>
            )}
            {rel === 'pending_in' && (
              <span className="px-2 py-1 rounded-md bg-amber-500/15 text-amber-300 text-[10px] font-black ring-1 ring-amber-400/30">
                Wants to add you
              </span>
            )}
            {rel === 'none' && (
              <button
                onClick={() => onAdd(u.id)}
                disabled={isBusy}
                className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40 text-[11px] font-black disabled:opacity-60 flex items-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {isBusy ? 'Adding…' : 'Add'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
