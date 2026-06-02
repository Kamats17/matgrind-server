// src/lib/useReducedMotion.js
//
// React hook subscribing to the `prefers-reduced-motion: reduce` media query.
// Returns a boolean. Re-renders whenever the user toggles the OS setting.
//
// Handles the Safari <14 `addListener`/`removeListener` fallback for the
// standard `addEventListener`/`removeEventListener` API. Also guards
// `window.matchMedia` for SSR / non-browser environments (hook stays silent
// and returns `false` in those cases rather than throwing).
//
// Usage:
//   const reduce = useReducedMotion();
//   <motion.div initial={reduce ? false : { opacity: 0 }} ... />

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion() {
  const [reduce, setReduce] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.matchMedia(QUERY).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mql;
    try {
      mql = window.matchMedia(QUERY);
    } catch {
      return;
    }
    const handler = (e) => setReduce(!!e.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // Safari <14 fallback
    if (typeof mql.addListener === 'function') {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, []);

  return reduce;
}

export default useReducedMotion;
