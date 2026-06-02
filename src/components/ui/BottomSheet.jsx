// src/components/ui/BottomSheet.jsx
//
// iOS-style bottom sheet. Slides up from the bottom on open, slides down on
// dismiss. Drag the handle downward ~80px+ to dismiss (touch and mouse).
// Backdrop click also dismisses unless `dismissible === false`. Focus is
// trapped visually via the backdrop; ESC key closes on desktop.
//
// Respects:
//  - `prefers-reduced-motion` (via useReducedMotion) - no slide animation
//  - iOS safe-area-inset-bottom - content never sits under the home bar
//  - ARIA dialog semantics - role="dialog" aria-modal and labelled by title
//
// Usage:
//   <BottomSheet open={show} onClose={() => setShow(false)} title="Period choice">
//     ...
//   </BottomSheet>
//
// Behaviour:
//  - Caller owns the `open` flag. The sheet renders nothing when open=false.
//  - Caller should treat onClose as "user wants to dismiss"; the sheet does
//    not self-decide whether dismissal is allowed (set `dismissible={false}`
//    to disable the drag-down and backdrop-tap paths for forced modals).
//  - haptic.light() fires on successful dismiss, haptic.medium() on open
//    (mount of first frame).

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useReducedMotion from '../../lib/useReducedMotion';
import { haptic } from '../../lib/haptics';

const DISMISS_THRESHOLD_PX = 80;

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  dismissible = true,
  className = '',
}) {
  const reduce = useReducedMotion();
  const didMountRef = useRef(false);

  // Haptic on actual open
  useEffect(() => {
    if (open && !didMountRef.current) {
      didMountRef.current = true;
      try { haptic.medium(); } catch { /* silent */ }
    }
    if (!open) didMountRef.current = false;
  }, [open]);

  // ESC key dismisses on desktop
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  const handleDragEnd = (_e, info) => {
    if (!dismissible) return;
    if (info.offset.y > DISMISS_THRESHOLD_PX || info.velocity.y > 500) {
      try { haptic.light(); } catch { /* silent */ }
      onClose?.();
    }
  };

  const backdropTap = () => {
    if (!dismissible) return;
    try { haptic.light(); } catch { /* silent */ }
    onClose?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title || 'Sheet'}>
          {/* Backdrop */}
          {/* audit-allow: guarded-early-return - dismissible state is the gate; backdrop is a non-button defensive element */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={backdropTap}
          />

          {/* Sheet */}
          <motion.div
            className={
              'absolute inset-x-0 bottom-0 bg-zinc-900 border-t border-zinc-800 ' +
              'rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto ' +
              'pb-[env(safe-area-inset-bottom)] ' + className
            }
            initial={reduce ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: 'spring', damping: 32, stiffness: 360, mass: 0.9 }
            }
            drag={dismissible ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag handle */}
            <div className="pt-3 pb-1 flex justify-center">
              <div
                className={
                  'w-10 h-1.5 rounded-full ' +
                  (dismissible ? 'bg-zinc-700' : 'bg-zinc-800')
                }
                aria-hidden="true"
              />
            </div>
            {title && (
              <div className="px-5 pt-1 pb-3 text-center text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                {title}
              </div>
            )}
            <div className="px-5 pb-6">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
