import { useState, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { FriendRequestProvider } from '@/lib/FriendRequestContext';
import { MatchChallengeProvider } from '@/lib/MatchChallengeContext';
import MatchChallengeModal from '@/components/wrestling/MatchChallengeModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { SoundProvider } from '@/lib/SoundContext';
import { ColorblindProvider } from '@/lib/ColorblindContext';
import { TabStateProvider } from '@/lib/tabState';
import AppShell from '@/components/layout/AppShell';
import WrestlingGame from './pages/WrestlingGame.jsx';
import GlobalQueueOverlay from '@/components/wrestling/GlobalQueueOverlay.jsx';

const AuthenticatedApp = () => {
  const { isLoadingAuth } = useAuth();

  // Brief loading while Firebase checks auth state - scoped inside AppShell
  // so the persistent TabBar still renders (empty, but present) behind it.
  if (isLoadingAuth) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 border-4 border-zinc-700 border-t-emerald-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Always render the app - auth is optional (for saving profiles/history).
  // v2.0 uses state-driven navigation inside WrestlingGame; no routing
  // library involved. The previous BrowserRouter/Routes wrapping was
  // vestigial from pre-v2.0 and has been removed so the hash-based tab
  // sync is the single source of truth.
  return <WrestlingGame />;
};


function App() {
  // Bumping resetKey forces the AppShell subtree to remount, which clears
  // any crashed component state below ErrorBoundary. Used by the
  // "Return to Menu" recovery action - see ErrorBoundary's onReturnToMenu.
  const [resetKey, setResetKey] = useState(0);

  // Early Game Center handshake. GameKit's authenticateHandler must be
  // installed early in the app lifecycle so iOS can return cached auth
  // silently. Without this, the first time the user taps the GC button
  // in MainMenu the call sees an uninitialized GKLocalPlayer and reports
  // "not signed in" even though the device user is signed in.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    import('@/lib/gameCenter.js').then(({ gcAuthenticate }) => {
      gcAuthenticate().catch(() => {});
    }).catch(() => {});
  }, []);

  const handleReturnToMenu = useCallback(() => {
    // Clear the hash so WrestlingGame's getScreenFromHash() lands on
    // 'menu' on remount. Empty hash is the existing menu convention
    // (see WrestlingGame.jsx setScreen → `window.location.hash = hashKey || ''`).
    // Use replaceState so we don't leave a trailing '#' in the URL and
    // don't push a history entry (Back from menu shouldn't replay the crash).
    try {
      const url = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', url);
    } catch {
      // Fallback for environments without history API access - empty
      // hash still resolves to 'menu' via the unknown-hash fallback.
      window.location.hash = '';
    }
    setResetKey(k => k + 1);
  }, []);

  return (
    <AuthProvider>
      <FriendRequestProvider>
        <MatchChallengeProvider>
          <SoundProvider>
            <ColorblindProvider>
              <QueryClientProvider client={queryClientInstance}>
                <ErrorBoundary onReturnToMenu={handleReturnToMenu}>
                  {/* v2.0 shell: single 100dvh flex column hosting <main> +
                      persistent TabBar. TabStateProvider owns the tab state
                      used by both AppShell (render) and WrestlingGame (sync
                      with its legacy `screen` state). */}
                  <TabStateProvider>
                    <AppShell key={resetKey}>
                      <AuthenticatedApp />
                    </AppShell>
                    {/* Background online-matchmaking pill + match-found modal.
                        Lives outside AppShell so it survives route/screen
                        transitions and remains visible anywhere in the app. */}
                    <GlobalQueueOverlay />
                    {/* Incoming match-challenge modal. Pops up the moment a
                        friend's challenge lands in Firestore - independent
                        of which screen the user is on. */}
                    <MatchChallengeModal />
                  </TabStateProvider>
                </ErrorBoundary>
                <Toaster />
              </QueryClientProvider>
            </ColorblindProvider>
          </SoundProvider>
        </MatchChallengeProvider>
      </FriendRequestProvider>
    </AuthProvider>
  )
}

export default App