// src/components/wrestling/ComebackBanner.jsx
//
// Prominent "COMEBACK WIN!" banner shown at the top of the match-end modal
// whenever the player was trailing at any point and still won. The signal
// is already tracked by wasTrailingRef in WrestlingGame.jsx; this component
// just surfaces the drama.
//
// Presentation only - no state, no side effects. The caller decides whether
// to render it (via `comebackWin` on postMatchData).

import React from 'react';
import { motion } from 'framer-motion';
import useReducedMotion from '../../lib/useReducedMotion.js';

export default function ComebackBanner() {
  const reduce = useReducedMotion();
  const animateProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25 } }
    : {
        initial: { opacity: 0, y: -8, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.45, ease: 'easeOut' },
      };
  return (
    <motion.div
      {...animateProps}
      className="bg-gradient-to-r from-amber-900/60 via-orange-900/60 to-amber-900/60 border border-amber-500/70 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-3"
      role="status"
      aria-label="Comeback win"
    >
      <span className="text-xl leading-none shrink-0" aria-hidden="true">💪</span>
      <div className="min-w-0">
        <div className="text-amber-200 text-[11px] font-black uppercase tracking-[0.18em] leading-none">
          Comeback Win!
        </div>
        <div className="text-amber-100/80 text-[11px] leading-tight mt-0.5">
          You were behind - and won anyway.
        </div>
      </div>
    </motion.div>
  );
}
