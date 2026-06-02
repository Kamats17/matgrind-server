// src/components/layout/AppShell.jsx
//
// v2.0 root layout. Replaces the "every screen owns its own viewport" model
// with a single persistent shell:
//
//   ┌───────────────────────────────────┐
//   │ pt-safe inset                     │
//   │ ┌───────────────────────────────┐ │
//   │ │ <main>  scrolls                │ │
//   │ │   <AnimatePresence mode="wait">│ │
//   │ │     children (current screen)  │ │
//   │ │   </AnimatePresence>           │ │
//   │ └───────────────────────────────┘ │
//   │ <TabBar>  stays here, pb-safe     │
//   └───────────────────────────────────┘
//   height: 100dvh, flex column, overflow hidden on root.
//
// Why 100dvh instead of 100vh: on mobile Safari, `vh` includes the URL bar
// area, which causes the TabBar to sit below the fold when the bar is
// visible. `dvh` (dynamic viewport height) accounts for that.
//
// This component is intentionally dumb - it reads `activeTab` + `hideTabBar`
// from TabStateContext and forwards tap events back via `requestTab`. The
// state-of-truth lives in WrestlingGame (which owns the legacy `screen`
// state). See src/lib/tabState.js for the context contract.

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import TabBar from './TabBar.jsx';
import { useTabState } from '../../lib/tabState.jsx';

export default function AppShell({ children }) {
  const { activeTab, hideTabBar, requestTab } = useTabState();

  return (
    <div
      style={{ height: '100dvh' }}
      className="flex flex-col overflow-hidden bg-zinc-950 text-white"
    >
      <main
        className="flex-1 overflow-y-auto min-h-0 relative"
        // Top safe-area inset lives here (not on the root) so the TabBar
        // can still sit flush with the bottom of the viewport without
        // inheriting extra top padding.
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {children}
        </AnimatePresence>
      </main>

      <TabBar
        activeTab={activeTab}
        onTabChange={requestTab}
        hidden={hideTabBar}
      />
    </div>
  );
}
