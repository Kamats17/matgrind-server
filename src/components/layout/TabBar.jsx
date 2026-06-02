// src/components/layout/TabBar.jsx
//
// Persistent 5-tab nav that lives at the bottom of <AppShell>. This is the
// single biggest native-feel signal in v2.0: a reviewer who opens the app
// sees a native tab bar with haptic feedback on every tap, not a web
// hamburger or centered nav. The bar:
//
//   - Stays in layout flow (no position: fixed). AppShell is a flex column
//     so the bar just sits at the bottom.
//   - Routes the iOS safe-area inset through each button's paddingBottom
//     (NOT via `pb-safe` on the nav). The visual icon/label sit inside a
//     56px inner row; the home-indicator strip below is empty padding that
//     still belongs to the button - so taps in that strip register on the
//     correct tab instead of falling into a dead zone.
//   - Hides via `hidden` prop during focus moments (active match, pin
//     attempt, drill active). Hiding uses `display: none` - keeping the
//     element in the tree would shift layout inside <main> when the bar
//     vanishes.
//   - Fires haptic.light() on `pointerdown` for instant feedback. The
//     actual tab switch happens on click (onPointerUp) so the visual + touch
//     feedback land before navigation.
//
// Active-tab visual: icon scales to 1.1 via framer-motion. Label + icon
// recolor from zinc to yellow. The whole button gets `active:scale-95` for
// press-in feedback.

import React from 'react';
import { motion } from 'framer-motion';
import { TABS } from '../../lib/tabState.jsx';
import { haptic } from '../../lib/haptics';
import { useFriendRequests } from '../../lib/FriendRequestContext.jsx';

export default function TabBar({ activeTab, onTabChange, hidden = false }) {
  const { pendingCount } = useFriendRequests();
  if (hidden) return null;

  return (
    <nav
      className="shrink-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-800"
      role="tablist"
      aria-label="Primary"
    >
      {/*
        IMPORTANT: the safe-area inset (env(safe-area-inset-bottom)) is applied
        as padding ON THE BUTTONS, not on the <nav>. The previous design put
        `pb-safe` on the nav, which left a 30-40px dead zone below the buttons
        on iPhone X+ devices - taps in the home-indicator strip hit padding
        instead of any tab. Routing the inset through the buttons themselves
        means the entire bar (including the home-indicator strip) is tappable.
        Visual content stays inside the 56px row via flex centering above the
        padding, so the icon/label position is unchanged.
      */}
      <div className="grid grid-cols-5">
        {TABS.map((tab, idx) => {
          const active = tab.id === activeTab;
          const Icon = tab.icon;
          const badge = tab.id === 'friends' && pendingCount > 0 ? pendingCount : 0;
          const ariaLabel = badge > 0
            ? `${tab.label}, tab, ${idx + 1} of ${TABS.length}, ${badge} pending request${badge === 1 ? '' : 's'}`
            : `${tab.label}, tab, ${idx + 1} of ${TABS.length}`;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={ariaLabel}
              data-testid={active ? `tabbar-${tab.id}-active` : `tabbar-${tab.id}`}
              onPointerDown={() => {
                try { haptic.light(); } catch { /* silent */ }
              }}
              onClick={() => onTabChange?.(tab.id)}
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
              className="relative active:scale-95 transition-transform duration-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
            >
              {/* Visual row sits inside this 56px box so the icon stays
                  vertically centred regardless of how tall the home-indicator
                  inset (added as paddingBottom on the button) makes the
                  outer tappable area. */}
              <div className="h-14 flex flex-col items-center justify-center gap-0.5">
                <motion.div
                  animate={{ scale: active ? 1.12 : 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                  className="flex items-center justify-center relative"
                >
                  <Icon
                    size={22}
                    className={active ? 'text-yellow-400' : 'text-zinc-500'}
                    strokeWidth={active ? 2.4 : 2}
                    aria-hidden="true"
                  />
                  {badge > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center leading-none"
                      aria-hidden="true"
                    >
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </motion.div>
                <span
                  className={`text-[10px] font-bold tracking-wide ${
                    active ? 'text-yellow-400' : 'text-zinc-500'
                  }`}
                >
                  {tab.label}
                </span>
              </div>
              {/* Active indicator - a thin yellow pill above the icon.
                  Uses layoutId so framer-motion slides it between tabs. */}
              {active && (
                <motion.div
                  layoutId="tabbar-active-indicator"
                  className="absolute top-0 h-[2px] w-8 rounded-full bg-yellow-400"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
