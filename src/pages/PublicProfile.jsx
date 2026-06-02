// Read-only Profile - used when viewing another wrestler from the
// leaderboard. Owns its own data fetch (one getProfile call) and
// applies the visibility matrix via `resolveVisibility`.
//
// Never shows Goals / History / Attrs / Delete / Respec - those are
// owner-only surfaces. Badge + Trophy preview depends on the mode
// returned by resolveVisibility.

import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { getProfile } from '../lib/firestoreService.js';
import { resolveVisibility, canSeeDetails, isRedacted } from '../lib/profileVisibility.js';
import { getLevelFromXP, ACHIEVEMENTS, isFoundersClubMember } from '../lib/profileUtils.js';
import {
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
  cancelOutgoing, unfriend, relationshipTo,
} from '../lib/friendRequests.js';
import NavBar from '../components/ui/NavBar';
import HonorBadge from '../components/wrestling/HonorBadge';
import { Lock, Trophy, Award, Users, UserPlus, Check, X as XIcon, UserMinus, Clock } from 'lucide-react';

/**
 * @param {{ uid: string, onBack: () => void, onAddFriend?: (targetUid: string) => void }} props
 */
export default function PublicProfile({ uid, onBack }) {
  const { user } = useAuth();
  const [target, setTarget] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Distinguishes "couldn't read this profile" from "no such profile." The
  // former shows a sign-in / retry CTA; the latter is a dead-end 404.
  const [loadErrorKind, setLoadErrorKind] = useState(null); // 'permission' | 'network' | null

  const refresh = React.useCallback(async () => {
    try {
      const [t, me] = await Promise.all([
        getProfile(uid),
        user?.uid ? getProfile(user.uid) : Promise.resolve(null),
      ]);
      setTarget(t);
      setViewer(me);
      setLoadErrorKind(null);
    } catch (e) {
      console.warn('[PublicProfile] Load error:', e);
      const code = e?.code || '';
      const msg  = (e?.message || '').toLowerCase();
      if (code.includes('permission') || msg.includes('permission')) {
        setLoadErrorKind('permission');
      } else {
        setLoadErrorKind('network');
      }
      setTarget(null);
    }
  }, [uid, user?.uid]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  const viewerFriends = Array.isArray(viewer?.practice_friends) ? viewer.practice_friends : [];

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      console.warn('[PublicProfile] Friend action failed:', e);
      setErr(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const mode = resolveVisibility(target, user?.uid, viewerFriends);
  const detailed = canSeeDetails(mode);
  const redacted = isRedacted(mode);

  if (loading) {
    return (
      <div className="min-h-full bg-zinc-950 text-white flex flex-col">
        <NavBar title="Profile" onBack={onBack} />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!target) {
    // Three failure modes share this surface - pick copy + CTA per kind.
    let icon = '🤼', title = 'Profile not found', body = 'This wrestler may have deleted their account or the link is broken.';
    let showRetry = false;
    let showSignIn = false;
    if (loadErrorKind === 'permission') {
      if (!user?.uid) {
        icon = '🔒';
        title = 'Sign in to view profiles';
        body  = 'Create an account or sign in to browse other wrestlers\' profiles.';
        showSignIn = true;
      } else {
        icon = '🔒';
        title = 'Profile is private';
        body  = 'This wrestler keeps their profile restricted. You may need to be friends, or the sync is still rolling out.';
        showRetry = true;
      }
    } else if (loadErrorKind === 'network') {
      icon = '📡';
      title = 'Could not load profile';
      body  = 'Check your connection and try again.';
      showRetry = true;
    }
    return (
      <div className="min-h-full bg-zinc-950 text-white flex flex-col">
        <NavBar title="Profile" onBack={onBack} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-xs">
            <div className="text-4xl mb-2">{icon}</div>
            <p className="text-zinc-200 text-sm font-black">{title}</p>
            <p className="text-zinc-500 text-xs mt-1">{body}</p>
            <div className="mt-4 flex flex-col gap-2">
              {showSignIn && (
                <button
                  onClick={() => { window.location.hash = 'signin'; }}
                  className="bg-amber-500 text-zinc-950 font-black text-xs py-2 px-4 rounded-lg"
                >
                  Sign In
                </button>
              )}
              {showRetry && (
                <button
                  onClick={() => { setLoading(true); refresh().finally(() => setLoading(false)); }}
                  className="bg-zinc-800 text-zinc-300 font-black text-xs py-2 px-4 rounded-lg"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const level = target.level || getLevelFromXP(target.xp || 0);
  const winCount = target.wins || 0;
  const lossCount = target.losses || 0;
  const drawCount = target.draws || 0;
  const totalDecided = winCount + lossCount + drawCount;
  const winPct = totalDecided > 0 ? (winCount / totalDecided) * 100 : null;
  const pinRate = winCount > 0 ? ((target.pins || 0) / winCount) * 100 : null;
  let earnedIds = [];
  try { earnedIds = JSON.parse(target.achievements_json || '[]'); } catch { earnedIds = []; }
  const earnedAch = ACHIEVEMENTS.filter(a => earnedIds.includes(a.id));
  const trophies = (() => {
    try { return JSON.parse(target.trophies_json || '[]'); }
    catch { return []; }
  })();
  const isFounder = isFoundersClubMember(target);

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Profile" onBack={onBack} />

      <div className="px-4 pt-3 pb-6 pb-[env(safe-area-inset-bottom)] space-y-3 md:max-w-2xl md:mx-auto w-full">
        {/* Hero */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-zinc-950 text-xl font-black flex-shrink-0">
            {(target.username || 'W').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-black text-lg truncate">{target.username || 'Unnamed'}</div>
            {target.team && (
              <div className="text-zinc-400 text-xs truncate">🏫 {target.team}</div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
                LVL {level}
              </span>
              {isFounder && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/40">
                  🎖️ Founders
                </span>
              )}
              {mode === 'self' && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40">
                  You
                </span>
              )}
              {mode === 'friend' && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40">
                  <Users className="inline w-3 h-3 mr-0.5" /> Friend
                </span>
              )}
            </div>
          </div>
          <HonorBadge uid={uid} size="lg" />
        </div>

        {/* Baseline stats - always shown. Redacted viewers stop here;
            friends / self / stranger_public get the richer grid below. */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-zinc-500 text-xs font-black uppercase tracking-wider mb-3">Stats</div>
          <div className="grid grid-cols-2 gap-3">
            <StatCell label="Level" value={level} />
            <StatCell label="Wins" value={winCount} />
            <StatCell label="Win %" value={winPct == null ? '-' : `${winPct.toFixed(1)}%`} />
            <StatCell label="Losses" value={lossCount} />
            <StatCell label="Pins" value={target.pins || 0} />
            <StatCell label="Tech Falls" value={target.tech_falls || 0} />
          </div>
        </div>

        {/* Redacted explainer - friends_only + stranger. Sits below the
            baseline stats so viewers still see the basics. */}
        {redacted && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center">
            <Lock className="w-6 h-6 text-zinc-500 mx-auto mb-2" />
            <p className="text-zinc-300 text-sm font-bold">Friends-only profile</p>
            <p className="text-zinc-500 text-xs mt-1">
              Send a friend request to see pin rate, streaks, badges, and trophies.
            </p>
          </div>
        )}

        {/* Extended stats - shown for self / friend / stranger_public */}
        {!redacted && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-zinc-500 text-xs font-black uppercase tracking-wider mb-3">Details</div>
            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Record" value={`${winCount}-${lossCount}${drawCount ? `-${drawCount}` : ''}`} />
              <StatCell label="Pin Rate" value={pinRate == null ? '-' : `${pinRate.toFixed(1)}%`} />
              <StatCell label="Best Streak" value={target.streak_best || 0} />
              <StatCell label="Matches" value={target.total_matches || 0} />
              <StatCell label="Total Points" value={target.total_points || 0} />
            </div>
          </div>
        )}

        {/* Badges preview - count for strangers, full grid for friends/self */}
        {!redacted && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Award className="w-4 h-4 text-amber-400" />
              <div className="text-zinc-300 text-xs font-black uppercase tracking-wider">
                Badges <span className="text-zinc-500">· {earnedAch.length}</span>
              </div>
            </div>
            {earnedAch.length === 0 ? (
              <p className="text-zinc-500 text-xs">No badges earned yet.</p>
            ) : detailed ? (
              <div className="grid grid-cols-4 gap-2">
                {earnedAch.slice(0, 16).map(a => (
                  <div key={a.id} className="aspect-square rounded-lg bg-zinc-950 ring-1 ring-zinc-800 flex items-center justify-center text-xl" title={a.name}>
                    {a.icon}
                  </div>
                ))}
                {earnedAch.length > 16 && (
                  <div className="aspect-square rounded-lg bg-zinc-950 ring-1 ring-zinc-800 flex items-center justify-center text-zinc-500 text-xs font-bold">
                    +{earnedAch.length - 16}
                  </div>
                )}
              </div>
            ) : (
              // Stranger (public): show top 5 icons only, no names
              <div className="flex gap-2">
                {earnedAch.slice(0, 5).map(a => (
                  <div key={a.id} className="w-10 h-10 rounded-lg bg-zinc-950 ring-1 ring-zinc-800 flex items-center justify-center text-lg">
                    {a.icon}
                  </div>
                ))}
                {earnedAch.length > 5 && (
                  <div className="w-10 h-10 rounded-lg bg-zinc-950 ring-1 ring-zinc-800 flex items-center justify-center text-zinc-500 text-xs font-bold">
                    +{earnedAch.length - 5}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Trophies preview */}
        {!redacted && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-amber-400" />
              <div className="text-zinc-300 text-xs font-black uppercase tracking-wider">
                Trophies <span className="text-zinc-500">· {trophies.length + (isFounder ? 1 : 0)}</span>
              </div>
            </div>
            {trophies.length === 0 && !isFounder ? (
              <p className="text-zinc-500 text-xs">No trophies yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {isFounder && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg bg-gradient-to-r from-indigo-500/25 to-violet-500/10 text-indigo-300 ring-1 ring-indigo-400/50">
                    🎖️ Founders Club
                  </span>
                )}
                {trophies.slice(0, 6).map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
                    🏆 {t.name || t.id || 'Trophy'}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Friend action - multi-state button driven by relationshipTo().
            Hidden on own page and for guests (no signed-in viewer). */}
        {mode !== 'self' && user?.uid && (
          <FriendAction
            viewer={viewer}
            targetUid={uid}
            busy={busy}
            onSend={() => run(() => sendFriendRequest(user.uid, uid))}
            onAccept={() => run(() => acceptFriendRequest(user.uid, uid))}
            onReject={() => run(() => rejectFriendRequest(user.uid, uid))}
            onCancel={() => run(() => cancelOutgoing(user.uid, uid))}
            onUnfriend={() => run(() => unfriend(user.uid, uid))}
          />
        )}
        {err && (
          <div className="text-rose-400 text-[11px] font-bold text-center">{err}</div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div className="bg-zinc-950 rounded-lg p-2 ring-1 ring-zinc-800">
      <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wider">{label}</div>
      <div className="text-white text-base font-black mt-0.5">{value}</div>
    </div>
  );
}

function FriendAction({ viewer, targetUid, busy, onSend, onAccept, onReject, onCancel, onUnfriend }) {
  const rel = relationshipTo(viewer, targetUid);
  const base = 'w-full font-black text-xs py-3 rounded-xl transition disabled:opacity-60';

  if (rel === 'friends') {
    return (
      <button onClick={onUnfriend} disabled={busy}
        className={`${base} bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/40`}>
        <UserMinus className="inline w-4 h-4 mr-1" /> Unfriend
      </button>
    );
  }
  if (rel === 'pending_out') {
    return (
      <button onClick={onCancel} disabled={busy}
        className={`${base} bg-zinc-900 border border-zinc-800 text-zinc-400`}>
        <Clock className="inline w-4 h-4 mr-1" /> Request Sent · Tap to Cancel
      </button>
    );
  }
  if (rel === 'pending_in') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onAccept} disabled={busy}
          className={`${base} bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40 hover:bg-emerald-500/30`}>
          <Check className="inline w-4 h-4 mr-1" /> Accept
        </button>
        <button onClick={onReject} disabled={busy}
          className={`${base} bg-zinc-900 border border-zinc-800 text-zinc-400`}>
          <XIcon className="inline w-4 h-4 mr-1" /> Reject
        </button>
      </div>
    );
  }
  // rel === 'none'
  return (
    <button onClick={onSend} disabled={busy}
      className={`${base} bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40 hover:bg-amber-500/30`}>
      <UserPlus className="inline w-4 h-4 mr-1" /> Add Friend
    </button>
  );
}
