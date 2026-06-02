import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext.jsx';
import { isExpired } from './matchChallenges.js';

// Real-time listener for an INCOMING match challenge addressed to the
// signed-in user. One Firestore onSnapshot listener per session, scoped
// to match_challenges/{user.uid}. When a fresh pending challenge with a
// roomCode lands, it surfaces here as `incoming` for the global modal
// to render. A challenge without a roomCode is held back ("sender hasn't
// finished setup yet") so the user doesn't see an Accept button that
// can't actually join anything.
//
// Lifecycle states the listener cares about:
//   pending  + roomCode -> render modal, allow accept/decline
//   pending  + no code  -> hold (sender still creating room)
//   accepted            -> sender's flow drives the WS handoff; ignore
//   declined            -> ignore (sender side sees the flip)
//   cancelled           -> drop the modal if it was up
//   expired             -> drop the modal if it was up

const MatchChallengeContext = createContext({
  incoming: null,
  dismiss: () => {},
});

export function MatchChallengeProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [incoming, setIncoming] = useState(null);
  // Track which challenge id we've already explicitly dismissed so the
  // listener doesn't keep re-prompting if the doc lingers for a beat.
  const dismissedRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || !user?.uid) {
      setIncoming(null);
      dismissedRef.current = null;
      return undefined;
    }

    const ref = doc(db, 'match_challenges', user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setIncoming(null);
        return;
      }
      const data = { id: snap.id, ...snap.data() };
      // Don't re-show a challenge we already dismissed manually unless
      // the sender re-sent a fresh one (different `from` or createdAt).
      const fingerprint = `${data.from}:${data.createdAt?.toMillis?.() ?? data.createdAt}`;
      if (dismissedRef.current === fingerprint) return;

      if (data.status !== 'pending') { setIncoming(null); return; }
      if (!data.roomCode) { setIncoming(null); return; }
      if (isExpired(data)) { setIncoming(null); return; }
      setIncoming(data);
    }, (err) => {
      console.warn('[MatchChallengeContext] snapshot error:', err?.message);
    });

    return () => { unsub(); };
  }, [user?.uid, isAuthenticated]);

  const dismiss = () => {
    if (incoming) {
      const fingerprint = `${incoming.from}:${incoming.createdAt?.toMillis?.() ?? incoming.createdAt}`;
      dismissedRef.current = fingerprint;
    }
    setIncoming(null);
  };

  return (
    <MatchChallengeContext.Provider value={{ incoming, dismiss }}>
      {children}
    </MatchChallengeContext.Provider>
  );
}

export function useMatchChallenge() {
  return useContext(MatchChallengeContext);
}
