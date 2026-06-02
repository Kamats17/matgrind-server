// src/lib/useSwipeBack.js
//
// iOS-style edge-swipe-to-go-back gesture. Listens at window level for a
// pointerdown that starts within EDGE_WIDTH px of the left edge of the
// viewport, then waits for a mostly-horizontal rightward drag past
// COMMIT_THRESHOLD. Once committed, fires the supplied `onBack` callback
// exactly once and emits a medium haptic so the gesture feels "armed."
//
// Why window-level (instead of attaching to a screen wrapper):
//   * Every non-game screen here is a different lazy-loaded route mounted
//     under <AnimatePresence> - no single shared DOM node exists to attach
//     to without invasive refactors.
//   * The narrow start zone (left 24px) keeps the listener from interfering
//     with centred in-screen gestures (RadialCardPicker, PinActionPad's
//     hold-and-swipe, the TraceMechanic swipe area).
//
// The vertical-cancel check (dy > 30 && dy > dx * 0.8) lets the user scroll
// the page even when their finger lands near the left edge - only an
// intentional rightward drag triggers the back action.
//
// Re-attaching listeners every render is wasteful, so the hook keeps the
// `onBack` handler in a ref; the effect only re-runs when `disabled` flips.

import { useEffect, useRef } from 'react';
import { haptic } from './haptics.js';

const EDGE_WIDTH = 24;        // start zone (px from left edge)
const COMMIT_THRESHOLD = 80;  // horizontal travel required to commit (px)
const VERTICAL_GRACE = 30;    // px of vertical drift before we consider
                              // the gesture "vertical" instead of horizontal

/**
 * @param {{ onBack: () => void, disabled?: boolean }} [opts]
 */
export function useSwipeBack({ onBack, disabled = false } = /** @type {any} */ ({})) {
  // Keep the latest callback in a ref so we don't churn listeners every
  // render when the parent recreates an inline `() => setScreen('menu')`.
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;

    // Per-gesture state. Reset on every pointerdown.
    const state = {
      active: false,
      committed: false,
      startX: 0,
      startY: 0,
      pointerId: null,
    };

    const onPointerDown = (e) => {
      // Ignore right/middle mouse buttons; only primary input counts.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Only begin tracking when the touch starts near the left edge.
      if (e.clientX > EDGE_WIDTH) return;
      state.active = true;
      state.committed = false;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.pointerId = e.pointerId;
    };

    const onPointerMove = (e) => {
      if (!state.active || state.committed) return;
      if (e.pointerId !== state.pointerId) return;
      const dx = e.clientX - state.startX;
      const dy = Math.abs(e.clientY - state.startY);
      // Vertical scroll wins - abandon the gesture.
      if (dy > VERTICAL_GRACE && dy > dx * 0.8) {
        state.active = false;
        return;
      }
      // Leftward drag from the edge isn't a back swipe.
      if (dx < 0) {
        state.active = false;
        return;
      }
      if (dx >= COMMIT_THRESHOLD) {
        state.committed = true;
        state.active = false;
        try { haptic.medium(); } catch { /* silent */ }
        // Fire on next frame so the haptic lands before any screen unmounts
        // (otherwise the buzz can be cut short on Android).
        const fn = onBackRef.current;
        if (typeof fn === 'function') {
          requestAnimationFrame(() => fn());
        }
      }
    };

    const onPointerEnd = (e) => {
      if (e.pointerId === state.pointerId) {
        state.active = false;
        state.pointerId = null;
      }
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onPointerEnd, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [disabled]);
}

export default useSwipeBack;
