import React, { useEffect, useState } from 'react';
import QueueBanner from './QueueBanner.jsx';
import QueuePill from './QueuePill.jsx';
import MatchFoundModal from './MatchFoundModal.jsx';
import {
  getState as getQueueState,
  onState as onQueueState,
  onMatchFound as onQueueMatchFound,
  cancelQueue,
  forfeitMatch,
  isInterruptHostile,
} from '../../lib/queueManager.js';

/**
 * App-level overlay that renders the background-queue pill and the
 * match-found modal. Lives above WrestlingGame in the tree so it's
 * visible on every screen.
 *
 * Handoff to WrestlingGame uses custom DOM events:
 *   - 'matgrind:queue-accept' - fired when user accepts a found match;
 *     payload: { detail: { payload } } where payload is the game_start blob.
 *   - 'matgrind:queue-decline' - fired on explicit decline or countdown
 *     expiry. No payload needed (queueManager.forfeitMatch is called here).
 *
 * WrestlingGame listens for 'matgrind:queue-accept', extracts the payload,
 * and routes through its existing startNetworkGame path.
 */
export default function GlobalQueueOverlay() {
  const [snap, setSnap] = useState(() => getQueueState());
  const [matchPayload, setMatchPayload] = useState(null);

  useEffect(() => {
    const offState = onQueueState(setSnap);
    const offMatch = onQueueMatchFound((payload) => setMatchPayload(payload));
    return () => { offState(); offMatch(); };
  }, []);

  const opponentName = matchPayload
    ? (matchPayload.networkPlayer === 'p1' ? matchPayload.p2Name : matchPayload.p1Name) || 'Opponent'
    : 'Opponent';

  const onAccept = () => {
    const payload = matchPayload;
    setMatchPayload(null);
    if (!payload) return;
    window.dispatchEvent(new CustomEvent('matgrind:queue-accept', { detail: { payload } }));
  };

  const onDecline = () => {
    setMatchPayload(null);
    forfeitMatch({ requeue: false });
    window.dispatchEvent(new CustomEvent('matgrind:queue-decline'));
  };

  return (
    <>
      <QueueBanner />
      <QueuePill
        status={snap.status}
        startedAt={snap.startedAt}
        errorMessage={snap.errorMessage}
        onCancel={cancelQueue}
        hidden={false /* pill is allowed everywhere; visibility is driven by status */}
      />
      {matchPayload && (
        <MatchFoundModal
          opponentName={opponentName}
          interrupt={isInterruptHostile()}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      )}
    </>
  );
}
