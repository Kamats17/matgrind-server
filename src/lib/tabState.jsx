// src/lib/tabState.js
//
// Single source of truth for the v2.0 app-shell tab model.
//
// The 5 tabs (Home / Play / Friends / Modes / Profile) are always
// present at the bottom of the app (via <TabBar> inside <AppShell>).
// `TABS` is the canonical list - iterate over this instead of hard-coding
// labels or icons anywhere else. The old "Progress" slot was redundant
// with Profile (same trophy case, same level/wins/losses); its only
// unique contents - training bests + the Leaderboard shortcut - now live
// on Profile. The freed slot houses Modes, which consolidates Career,
// Tournament, Dual Meet, Online Multiplayer, Local 1v1, Training Hub,
// and Versus CPU into a single mode-launching surface so the Home tab
// stays focused on the single-tap "wrestle a CPU match" CTA.
//
// `TabStateContext` is the bridge between AppShell (which renders the TabBar)
// and WrestlingGame (which owns the legacy `screen` state). WrestlingGame
// writes `activeTab` and `hideTabBar` into this context whenever its internal
// screen changes; AppShell's TabBar reads `activeTab` to highlight the right
// icon and calls `requestTab(id)` when the user taps. WrestlingGame listens
// for those requests and maps them to its legacy setScreen(...) calls.
//
// Why a context and not Zustand / Redux: we already have React context
// throughout the app (AuthContext, SoundContext, ColorblindContext). One
// more is lighter weight than pulling in a state library.

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Home, Swords, Users, Gamepad2, User } from 'lucide-react';

export const TABS = [
  { id: 'home',     label: 'Home',     icon: Home    },
  { id: 'play',     label: 'Play',     icon: Swords  },
  { id: 'friends',  label: 'Friends',  icon: Users   },
  { id: 'modes',    label: 'Modes',    icon: Gamepad2 },
  { id: 'profile',  label: 'Profile',  icon: User    },
];

export const TAB_IDS = TABS.map(t => t.id);

// Default context shape - in production we always render a provider, but
// the defaults here keep the types stable if a consumer is mounted outside
// the provider by accident (dev ergonomics).
/** @type {React.Context<{
 *   activeTab: string,
 *   hideTabBar: boolean,
 *   setActiveTab: (id: string) => void,
 *   setHideTabBar: (hidden: boolean) => void,
 *   requestTab: (id: string) => void,
 *   registerTabHandler: (handler: (id: string) => void) => () => void,
 * }>} */
const TabStateContext = createContext({
  activeTab: 'home',
  hideTabBar: false,
  setActiveTab: () => {},
  setHideTabBar: () => {},
  requestTab: () => {},
  registerTabHandler: () => () => {},
});

export function TabStateProvider({ children }) {
  const [activeTab, setActiveTab] = useState('home');
  const [hideTabBar, setHideTabBar] = useState(false);

  // Tab requests (TabBar taps) are forwarded to whichever consumer has
  // registered a handler - currently WrestlingGame. Using a ref keeps the
  // handler fresh without re-rendering the whole tree when the closure
  // captures change.
  const handlerRef = useRef(null);

  const requestTab = useCallback((tabId) => {
    const handler = handlerRef.current;
    if (handler) {
      handler(tabId);
    } else {
      // No consumer registered yet - fall back to just setting the tab so
      // the UI still responds. WrestlingGame will override this on mount.
      setActiveTab(tabId);
    }
  }, []);

  const registerTabHandler = useCallback((handler) => {
    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }, []);

  const value = {
    activeTab,
    hideTabBar,
    setActiveTab,
    setHideTabBar,
    requestTab,
    registerTabHandler,
  };

  return (
    <TabStateContext.Provider value={value}>
      {children}
    </TabStateContext.Provider>
  );
}

export function useTabState() {
  return useContext(TabStateContext);
}
