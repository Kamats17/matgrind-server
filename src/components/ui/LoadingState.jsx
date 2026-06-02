// src/components/ui/LoadingState.jsx
//
// Canonical loading placeholder. Replaces the inline `LazyFallback`
// previously defined in WrestlingGame.jsx so every React.Suspense fallback
// looks identical.
//
// Shows:
//  - A branded emerald spinner (matches the preloader in index.html)
//  - Optional label (defaults to "Loading…")
//  - Optional rotating tip (reuses src/lib/matchTips.js randomTip())
//
// Usage:
//   <React.Suspense fallback={<LoadingState tip />}>
//     <Profile ... />
//   </React.Suspense>
//
//   <LoadingState label="Loading replay..." tip />

import React from 'react';
import { randomTip } from '../../lib/matchTips.js';

export default function LoadingState({ label = 'Loading…', tip = false, className = '' }) {
  const tipText = tip ? randomTip() : null;
  return (
    <div
      // v2.0: scoped to the nearest `relative` ancestor (AppShell's <main>)
      // via `absolute` instead of `fixed`. This keeps the persistent TabBar
      // visible while a lazy screen resolves. Fallback to pt/pb-safe so the
      // spinner still clears the notch / home indicator when rendered
      // outside the shell.
      className={
        'absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center px-6 ' +
        'pt-safe pb-safe ' + className
      }
      role="status"
      aria-live="polite"
    >
      {/* Matches the app-preloader spinner geometry in index.html so there's
          no visual jump from the HTML preloader to the React loading state. */}
      <div
        className="w-8 h-8 rounded-full border-4 border-zinc-800 border-t-emerald-500 animate-spin"
        aria-hidden="true"
      />
      <div className="mt-4 text-zinc-400 text-sm font-semibold">{label}</div>
      {tipText && (
        <div className="mt-6 max-w-xs text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500/70 mb-1">TIP</div>
          <div className="text-zinc-500 text-xs leading-snug">{tipText}</div>
        </div>
      )}
    </div>
  );
}
