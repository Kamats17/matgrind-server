// src/lib/ScreenTransition.jsx
//
// Lightweight enter-animation wrapper used at the top of each major screen
// render in `src/pages/WrestlingGame.jsx`. Because the hosting component uses
// conditional `if (screen === 'X') return <Screen/>` branches rather than a
// single consolidated return, we cannot easily use `<AnimatePresence mode="wait">`
// (that would require refactoring ~20 return paths into one). Instead, every
// major screen wraps itself in a `<motion.div key={screenKey}>`; React sees
// the `key` change on screen transitions and remounts the motion node, which
// replays the `initial -> animate` transition as an enter animation.
//
// This gives us ~80% of the polish (enter animation everywhere) for ~20% of
// the refactor risk (no restructure of WrestlingGame.jsx). We lose exit
// animations, which is an acceptable trade-off for a stability-focused port.
//
// Reduced motion: when the user has `prefers-reduced-motion: reduce` set, we
// skip the translate-y offset entirely (no motion) and set duration to 0 so
// the content appears instantly. Opacity is also skipped via `initial={false}`.

import React from 'react';
import { motion } from 'framer-motion';
import useReducedMotion from './useReducedMotion';

export default function ScreenTransition({ screenKey, children, className = '' }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={screenKey}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }
      }
      className={className}
      style={{ height: '100%' }}
    >
      {children}
    </motion.div>
  );
}
