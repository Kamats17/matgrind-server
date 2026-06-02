import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../lib/AuthContext.jsx';
import { getLeaderboard, getUserEntry, storedToMs, isReactionCategory } from '../lib/leaderboardService.js';
import { getProfile, getProfilesByUids } from '../lib/firestoreService.js';
import { currentWeekId } from '../lib/weekId.js';
import NavBar from '../components/ui/NavBar';
import HonorBadge from '../components/wrestling/HonorBadge';
import { haptic } from '../lib/haptics.js';

// Tabs without a Game Center counterpart (reaction-time leaderboards live
// only in our Firestore backend) intentionally omitted - the "View on
// Game Center" button is hidden for those tabs below.
const LEADERBOARD_TO_GC_ID = {
  wins:   'com.matgrind.leaderboard.wins',
  level:  'com.matgrind.leaderboard.level',
  streak: 'com.matgrind.leaderboard.streak',
  pins:   'com.matgrind.leaderboard.pins',
};

// Two-level tab taxonomy. Main tabs are the broad category of record being
// ranked (match history, tournament play, reflex timing, or your friends
// circle); sub-tabs drill into a specific stat within that category.
//
// The 10 flat tabs we used to show scrolled horizontally and crammed 10
// tiny icon tiles into one row. Grouping into 4 main tabs fits every
// phone viewport without horizontal scroll and makes the relationship
// between "Wins" and "Tour Wins" (for example) legible at a glance.
//
// Sub-tab IDs for Matches/Tournament/Reflex map 1:1 to existing
// leaderboard categories (so data fetching is unchanged); Friends
// sub-tabs still hit the friends-only client-side sort path.
const MAIN_TABS = [
  {
    id: 'matches',
    label: 'Matches',
    icon: '🏆',
    subTabs: [
      { id: 'wins',   label: 'Wins',   icon: '🏆' },
      { id: 'level',  label: 'Level',  icon: '⭐' },
      { id: 'streak', label: 'Streak', icon: '🔥' },
      { id: 'pins',   label: 'Pins',   icon: '📌' },
    ],
  },
  {
    id: 'tournament',
    label: 'Tournament',
    icon: '🥇',
    subTabs: [
      { id: 'tournament_points', label: 'Points', icon: '🏅' },
      { id: 'tournament_wins',   label: 'Wins',   icon: '🥇' },
      { id: 'tournament_streak', label: 'Streak', icon: '🔥' },
    ],
  },
  {
    id: 'reflex',
    label: 'Reflex',
    icon: '⚡',
    subTabs: [
      { id: 'reaction_single', label: 'Best',    icon: '⚡' },
      { id: 'reaction_avg',    label: 'Average', icon: '🎯' },
    ],
  },
  {
    id: 'friends',
    label: 'Friends',
    icon: '🤝',
    // Friends sub-tabs live outside the global leaderboard fetch path - see
    // FRIENDS_SUB_TABS below. The `friends` flag on a sub-tab switches the
    // render into client-side sort-by-weekly-stats mode.
    subTabs: [
      { id: 'weekly_wins', label: 'Wins',   period: 'Week',     friends: true },
      { id: 'weekly_pins', label: 'Pins',   period: 'Week',     friends: true },
      { id: 'weekly_xp',   label: 'XP',     period: 'Week',     friends: true },
      { id: 'reflex',      label: 'Reflex', period: 'All-Time', friends: true },
    ],
  },
];

// Sub-tab IDs used in the Friends main tab - kept as its own list for the
// weekly-stat sort logic further down. Duplicates the ids above on purpose
// so friends rendering can stay decoupled from MAIN_TABS structure.
const FRIENDS_SUB_TABS = MAIN_TABS.find(t => t.id === 'friends').subTabs;

const FRIENDS_SUB_LABEL = {
  weekly_wins: 'Wins',
  weekly_pins: 'Pins',
  weekly_xp:   'XP',
  reflex:      'Best Time',
};

const VALUE_LABEL = {
  wins:               'Wins',
  level:              'Level',
  streak:             'Best Streak',
  pins:               'Pins',
  reaction_single:    'Best Time',
  reaction_avg:       'Avg (5 rounds)',
  tournament_points:  'Points',
  tournament_wins:    'Tour Match Wins',
  tournament_streak:  'Best Tour Streak',
};

function formatValue(category, storedValue) {
  if (isReactionCategory(category)) return `${storedToMs(storedValue)}ms`;
  return storedValue;
}

export default function Leaderboard({ onBack, onViewProfile }) {
  const { user } = useAuth();
  // Two-level tab state. `activeMain` drives the sub-tab row; each main tab
  // remembers its own last-selected sub-tab so swapping back and forth
  // doesn't drop you on sub-tab #1 every time.
  const [activeMain, setActiveMain] = useState('matches');
  const [subTabByMain, setSubTabByMain] = useState({
    matches: 'wins',
    tournament: 'tournament_points',
    reflex: 'reaction_single',
    friends: 'weekly_wins',
  });
  const activeMainTab = MAIN_TABS.find(t => t.id === activeMain) || MAIN_TABS[0];
  const activeSub = subTabByMain[activeMain];
  const isFriendsMain = activeMain === 'friends';
  // `activeTab` is the global-leaderboard category id; friends sub-tabs
  // don't use it (they hit a different data path).
  const activeTab = isFriendsMain ? null : activeSub;
  const friendsSubTab = isFriendsMain ? activeSub : 'weekly_wins';
  const setActiveSub = (id) => setSubTabByMain(prev => ({ ...prev, [activeMain]: id }));
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(false);
  const [userEntry, setUserEntry] = useState(null);
  // Friends state is orthogonal to the global leaderboard cache: we need
  // the raw profile list (to re-sort client-side by different weekly
  // fields without re-fetching) plus a cached all-time reflex list.
  const [friendsProfiles, setFriendsProfiles] = useState(null);
  const [friendsReflex, setFriendsReflex] = useState(null);
  const [friendsEmpty, setFriendsEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (isFriendsMain) {
      // Skip the global path entirely. Friends data comes from the
      // current user's practice_friends list.
      const loadFriends = async () => {
        if (!user?.uid) { setFriendsEmpty(true); return; }
        setLoading(true);
        try {
          const me = await getProfile(user.uid);
          const friendUids = Array.isArray(me?.practice_friends) ? me.practice_friends : [];
          const allUids = Array.from(new Set([user.uid, ...friendUids]));
          if (friendUids.length === 0) {
            if (!cancelled) {
              setFriendsProfiles([]);
              setFriendsReflex([]);
              setFriendsEmpty(true);
            }
            return;
          }
          // Profiles (weekly_stats) + all-time reflex in parallel.
          const [profiles, reflexEntries] = await Promise.all([
            getProfilesByUids(allUids),
            Promise.all(allUids.map(uid => getUserEntry(uid, 'reaction_single').then(e => e ? { ...e, uid } : null))),
          ]);
          if (!cancelled) {
            setFriendsProfiles(profiles);
            setFriendsReflex(reflexEntries.filter(Boolean));
            setFriendsEmpty(false);
          }
        } catch (err) {
          console.warn('[Leaderboard] Friends load error:', err);
        }
        if (!cancelled) setLoading(false);
      };
      loadFriends();
      return () => { cancelled = true; };
    }

    if (!activeTab) return; // defensive: no global category selected
    const load = async () => {
      // Use cache if we already fetched this tab
      if (entries[activeTab]) {
        // Still fetch user entry
        if (user?.uid) {
          const ue = await getUserEntry(user.uid, activeTab);
          if (!cancelled) setUserEntry(ue);
        }
        return;
      }

      setLoading(true);
      try {
        const [data, ue] = await Promise.all([
          getLeaderboard(activeTab, 25),
          user?.uid ? getUserEntry(user.uid, activeTab) : null,
        ]);
        if (!cancelled) {
          setEntries(prev => ({ ...prev, [activeTab]: data }));
          setUserEntry(ue);
        }
      } catch (err) {
        console.warn('[Leaderboard] Load error:', err);
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, isFriendsMain, user?.uid, entries]);

  const tabData = entries[activeTab] || [];
  const userInList = user?.uid && tabData.some(e => e.uid === user.uid);

  // Build Friends list client-side so switching sub-tabs doesn't re-fetch.
  const friendsList = React.useMemo(() => {
    if (!isFriendsMain) return [];
    if (friendsSubTab === 'reflex') {
      if (!friendsReflex) return [];
      return [...friendsReflex]
        .map(e => ({ uid: e.uid, username: e.username, value: storedToMs(e.value) }))
        .sort((a, b) => a.value - b.value);
    }
    if (!friendsProfiles) return [];
    const weekId = currentWeekId();
    const keyMap = { weekly_wins: 'wins', weekly_pins: 'pins', weekly_xp: 'xp_earned' };
    const key = keyMap[friendsSubTab];
    return friendsProfiles
      .map(p => {
        const ws = p.weekly_stats;
        const v = (ws && ws.week_id === weekId) ? (ws[key] || 0) : 0;
        return { uid: p.id, username: p.username || 'Wrestler', value: v };
      })
      .sort((a, b) => b.value - a.value);
  }, [isFriendsMain, friendsSubTab, friendsProfiles, friendsReflex]);

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      {/* iOS-style NavBar */}
      <NavBar title="Leaderboards" onBack={onBack} />

      {/* Tabs */}
      <div className="px-4 pt-4 max-w-lg md:max-w-2xl mx-auto w-full">
        {/* Main tabs - 4 equal columns, no horizontal scroll. */}
        <div className="grid grid-cols-4 gap-1.5 mb-2" role="radiogroup" aria-label="Leaderboard category">
          {MAIN_TABS.map(tab => {
            const active = activeMain === tab.id;
            return (
              <button
                key={tab.id}
                role="radio"
                aria-checked={active}
                aria-label={tab.label}
                // Active option in a radio-style toggle is a no-op when
                // re-clicked (React bails on identical state). The smoke
                // walker can't tell that apart from a broken button, so
                // we tag the active one for SKIP_BUTTONS; inactive options
                // keep no testid and are walked normally.
                {...(active ? { 'data-testid': 'leaderboard-tab-active' } : {})}
                onClick={() => {
                  if (activeMain === tab.id) {
                    try { haptic.light(); } catch { /* silent */ }
                  } else {
                    setActiveMain(tab.id);
                  }
                }}
                className={`py-2 px-1 rounded-xl border-2 text-center transition-all ${
                  active
                    ? 'border-amber-600 bg-amber-950/30 text-white'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                }`}
              >
                <div className="text-base leading-none">{tab.icon}</div>
                <div className="text-[10px] font-black uppercase tracking-wider mt-1 whitespace-nowrap">{tab.label}</div>
              </button>
            );
          })}
        </div>

        {/* Sub-tab pill row - one line of small pills for the active main
            tab's children. Matches/Tournament/Reflex share the same pill
            style; Friends pills append the weekly/all-time qualifier. */}
        <div className="flex flex-wrap gap-1.5 mb-3" role="radiogroup" aria-label="Leaderboard sub-category">
          {activeMainTab.subTabs.map(sub => {
            const active = activeSub === sub.id;
            const ariaLabel = sub.period ? `${sub.label} ${sub.period}` : sub.label;
            return (
              <button
                key={sub.id}
                role="radio"
                aria-checked={active}
                aria-label={ariaLabel}
                {...(active ? { 'data-testid': 'leaderboard-subtab-active' } : {})}
                onClick={() => {
                  if (activeSub === sub.id) {
                    try { haptic.light(); } catch { /* silent */ }
                  } else {
                    setActiveSub(sub.id);
                  }
                }}
                className={`py-1.5 px-3 rounded-lg text-center transition-all text-[11px] font-black uppercase tracking-wider ${
                  active
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800 hover:text-zinc-400'
                }`}
              >
                {sub.label}
                {sub.period && <span className="opacity-60"> · {sub.period}</span>}
              </button>
            );
          })}
        </div>

        {Capacitor.isNativePlatform() && LEADERBOARD_TO_GC_ID[activeTab] && (
          <button
            onClick={async () => {
              // Auth-gate before presenting. GKGameCenterViewController
              // renders empty (or fails to focus on the requested board)
              // when the local player isn't authenticated - same fix
              // pattern as the home-screen GC button in MainMenu.jsx.
              try {
                const gc = await import('../lib/gameCenter.js');
                let authed = gc.gcIsAuthenticated();
                if (!authed) authed = await gc.gcAuthenticate();
                if (authed) {
                  await gc.gcShowLeaderboards({ leaderboardId: LEADERBOARD_TO_GC_ID[activeTab] });
                } else {
                  const err = gc.gcLastAuthError?.();
                  alert(
                    'Game Center isn\'t available yet.\n\n' +
                    (err ? `iOS reported: ${err}\n\n` : '') +
                    'Make sure you\'re signed in to Game Center in iOS Settings, ' +
                    'then tap this button again.'
                  );
                }
              } catch (e) {
                console.warn('[Leaderboard] Game Center open failed:', e);
                alert('Game Center error: ' + (e?.message || e));
              }
            }}
            className="w-full mb-3 bg-zinc-900 hover:bg-zinc-800 border border-blue-800/50 text-blue-400 font-bold text-xs py-2.5 rounded-xl transition-all"
          >
            🎮 View on Game Center
          </button>
        )}
      </div>

      {/* Leaderboard List */}
      <div className="flex-1 px-4 pb-4 max-w-lg md:max-w-2xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
          </div>
        ) : isFriendsMain ? (
          friendsEmpty || friendsList.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
              <div className="text-3xl mb-2">🤝</div>
              <p className="text-zinc-500 text-sm font-bold">No friends yet</p>
              <p className="text-zinc-600 text-xs mt-1">Play online matches to build your friends list!</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {friendsList.map((entry, i) => {
                const isUser = user?.uid && entry.uid === user.uid;
                const rank = i + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
                const valueStr = friendsSubTab === 'reflex' ? `${entry.value}ms` : entry.value;
                const clickable = !!onViewProfile && !!entry.uid;
                return (
                  <button
                    type="button"
                    key={entry.uid}
                    onClick={clickable ? () => onViewProfile(entry.uid) : undefined}
                    disabled={!clickable}
                    className={`w-full text-left flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${clickable ? 'active:scale-[0.99] hover:bg-zinc-800/40' : ''} ${
                      isUser
                        ? 'border-emerald-600/50 bg-emerald-950/20'
                        : rank === 1
                          ? 'border-amber-500/40 bg-gradient-to-r from-yellow-950/30 via-zinc-900 to-zinc-900'
                          : 'border-zinc-800 bg-zinc-900/70'
                    }`}
                  >
                    <div className="w-8 text-center">
                      {medal ? (
                        <span className={`text-lg ${rank === 1 ? 'animate-pulse' : ''}`}>{medal}</span>
                      ) : (
                        <span className="text-zinc-500 text-sm font-black">{rank}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-bold truncate flex items-center flex-wrap ${isUser ? 'text-emerald-400' : 'text-white'}`}>
                        {entry.username}
                        {isUser && <span className="text-emerald-600 text-xs ml-1">(you)</span>}
                      </div>
                    </div>
                    <HonorBadge uid={entry.uid} size="sm" className="mr-1" />
                    <div className="text-right">
                      <div className={`text-lg font-black ${rank <= 3 ? 'text-amber-400' : 'text-zinc-300'}`}>
                        {valueStr}
                      </div>
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider">
                        {FRIENDS_SUB_LABEL[friendsSubTab]}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : tabData.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <div className="text-3xl mb-2">🏟️</div>
            <p className="text-zinc-500 text-sm font-bold">No entries yet</p>
            <p className="text-zinc-600 text-xs mt-1">Play matches to climb the leaderboard!</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {tabData.map((entry, i) => {
              const isUser = user?.uid && entry.uid === user.uid;
              const rank = i + 1;
              const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
              const clickable = !!onViewProfile && !!entry.uid;
              return (
                <button
                  type="button"
                  key={entry.id}
                  onClick={clickable ? () => onViewProfile(entry.uid) : undefined}
                  disabled={!clickable}
                  className={`w-full text-left flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${clickable ? 'active:scale-[0.99] hover:bg-zinc-800/40' : ''} ${
                    isUser
                      ? 'border-emerald-600/50 bg-emerald-950/20'
                      : rank === 1
                        ? 'border-amber-500/40 bg-gradient-to-r from-yellow-950/30 via-zinc-900 to-zinc-900'
                        : rank <= 3
                          ? 'border-amber-800/30 bg-zinc-900'
                          : rank <= 8
                            ? 'border-amber-900/20 bg-zinc-900/70'
                            : 'border-zinc-800 bg-zinc-900/50'
                  }`}
                >
                  {/* Rank */}
                  <div className="w-8 text-center">
                    {medal ? (
                      <span className={`text-lg ${rank === 1 ? 'animate-pulse' : ''}`}>{medal}</span>
                    ) : rank <= 8 ? (
                      <span className="text-amber-600/70 text-sm">⭐</span>
                    ) : (
                      <span className="text-zinc-500 text-sm font-black">{rank}</span>
                    )}
                  </div>
                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-bold truncate flex items-center flex-wrap ${isUser ? 'text-emerald-400' : 'text-white'}`}>
                      {entry.username}
                      {isUser && <span className="text-emerald-600 text-xs ml-1">(you)</span>}
                      {rank === 1 && (
                        <span className="bg-yellow-500/20 text-yellow-400 text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1">CHAMPION</span>
                      )}
                      {rank >= 2 && rank <= 3 && (
                        <span className="bg-zinc-400/10 text-zinc-300 text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1">PODIUM</span>
                      )}
                      {rank >= 4 && rank <= 8 && (
                        <span className="bg-amber-700/15 text-amber-500/80 text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1">ELITE</span>
                      )}
                    </div>
                  </div>
                  <HonorBadge uid={entry.uid} size="sm" className="mr-1" />
                  {/* Value */}
                  <div className="text-right">
                    <div className={`text-lg font-black ${rank <= 3 ? 'text-amber-400' : rank <= 8 ? 'text-amber-500/70' : 'text-zinc-300'}`}>
                      {formatValue(activeTab, entry.value)}
                    </div>
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider">
                      {VALUE_LABEL[activeTab]}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* User's rank if not in top 25 */}
            {!userInList && userEntry && (
              <>
                <div className="text-center text-zinc-600 text-sm py-1">· · ·</div>
                <div className="flex items-center gap-3 rounded-xl border border-emerald-600/50 bg-emerald-950/20 px-4 py-3">
                  <div className="w-8 text-center">
                    <span className="text-zinc-500 text-sm font-black">-</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-emerald-400 truncate">
                      {userEntry.username} <span className="text-emerald-600 text-xs">(you)</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-zinc-300">{formatValue(activeTab, userEntry.value)}</div>
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{VALUE_LABEL[activeTab]}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
