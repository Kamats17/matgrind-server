import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext.jsx';
import { notifyFriendRequest } from './notificationService.js';

// Live count of pending incoming friend requests, surfaced as a context so
// the bottom-nav badge updates the moment a request arrives instead of
// requiring the user to navigate to the Friends tab to discover it. Also
// fires a Capacitor LocalNotification when a NEW request lands while the
// app is backgrounded, so the user sees the tray entry on lock screen.
//
// One Firestore onSnapshot listener per signed-in session - the listener is
// scoped to the user's own profile doc so it only reads documents the user
// already has permission to read. Detaches on sign-out / unmount.

const FriendRequestContext = createContext({
  pendingCount: 0,
  pendingUids: [],
});

export function FriendRequestProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingUids, setPendingUids] = useState([]);
  // Track the previous count across snapshots so we can distinguish "new
  // request just arrived" (count went up) from initial load or count going
  // down via accept/decline. Only the going-up case fires a notification.
  const lastCountRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || !user?.uid) {
      setPendingCount(0);
      setPendingUids([]);
      lastCountRef.current = null;
      return undefined;
    }

    const ref = doc(db, 'profiles', user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const incoming = Array.isArray(data?.friend_requests_in) ? data.friend_requests_in : [];
      const next = incoming.length;
      setPendingCount(next);
      setPendingUids(incoming);

      // Fire a notification only when the count INCREASED while the app
      // was backgrounded. lastCountRef is null on first snapshot to avoid
      // a startup notification surge for already-pending requests.
      const prev = lastCountRef.current;
      if (prev !== null && next > prev) {
        const isBackgrounded = typeof document !== 'undefined' && document.hidden;
        if (isBackgrounded) {
          notifyFriendRequest(next).catch(() => { /* not fatal */ });
        }
      }
      lastCountRef.current = next;
    }, (err) => {
      console.warn('[FriendRequestContext] snapshot error:', err?.message);
    });

    return () => { unsub(); };
  }, [user?.uid, isAuthenticated]);

  return (
    <FriendRequestContext.Provider value={{ pendingCount, pendingUids }}>
      {children}
    </FriendRequestContext.Provider>
  );
}

export function useFriendRequests() {
  return useContext(FriendRequestContext);
}
