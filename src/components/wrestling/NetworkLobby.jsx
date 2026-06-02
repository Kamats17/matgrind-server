import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NetworkClient, WS_PORT } from '../../lib/networkClient.js';
import { auth } from '../../lib/firebase.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { startQueue } from '../../lib/queueManager.js';
import NavBar from '../ui/NavBar';

// Derive the HTTP base from the configured WSS server. Used for the read-only
// /queue-size endpoint shown above the SEARCH FOR OPPONENT button.
// `import.meta.env` is a Vite construct; cast through `any` so tsc strict
// mode doesn't reject it under the project-wide checkJs config.
const ONLINE_HTTP_BASE = (() => {
  const meta = /** @type {any} */ (import.meta);
  const ws = (typeof import.meta !== 'undefined' && meta.env?.VITE_ONLINE_SERVER_URL) || '';
  if (!ws) return '';
  return ws.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
})();

const MODES = ['folkstyle', 'freestyle', 'greco', 'womens_freestyle'];

export default function NetworkLobby({ onGameStart, onBack, onCreateWrestler }) {
  const { user, isAuthenticated } = useAuth();

  // Top-level mode: null | 'lan' | 'online'.
  // LAN is intentionally hidden in the shipping UI (no LAN servers reachable
  // from the sandboxed iOS app). Initial state is forced to 'online' so the
  // LAN-vs-Online picker is skipped. The LAN code paths below stay intact for
  // dev / web use - un-hiding is a one-line change back to `useState(null)`.
  const [netMode, setNetMode] = useState('online');

  // LAN sub-state
  const [role, setRole] = useState(null);           // null | 'host' | 'join'
  const [hostIP, setHostIP] = useState('');

  // Online sub-state
  const [onlineRole, setOnlineRole] = useState(null); // null | 'create' | 'join'
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [opponentName, setOpponentName] = useState('');

  // Shared state
  const [status, setStatus] = useState('idle');     // idle | connecting | waiting | connected | error | reconnecting
  const [errorMsg, setErrorMsg] = useState('');
  const [playerName, setPlayerName] = useState(user?.displayName || '');
  const [style, setStyle] = useState('folkstyle');
  const [reconnectInfo, setReconnectInfo] = useState(null); // { attempt, max }
  const clientRef = useRef(null);

  // Detect local IP for host display (LAN only)
  const [localIP, setLocalIP] = useState('');
  useEffect(() => {
    if (netMode !== 'lan') return;
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
      pc.onicecandidate = (e) => {
        if (!e || !e.candidate) return;
        const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m && !m[1].startsWith('127.')) {
          setLocalIP(m[1]);
          pc.close();
        }
      };
    } catch {
      setLocalIP('(check your network settings)');
    }
  }, [netMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clientRef.current?.disconnect();
  }, []);

  // Live queue size for the matchmaking screen. Polls /queue-size while the
  // user is on the matchmaking sub-screen so we can show "{N} wrestlers
  // searching". Cheap (a single int) and avoids opening a second WebSocket
  // just for the count. Only polls while viewing the matchmaking tile.
  const [queueSize, setQueueSize] = useState(null);
  useEffect(() => {
    if (onlineRole !== 'matchmaking') return;
    if (!ONLINE_HTTP_BASE) return;
    let cancelled = false;
    const fetchSize = async () => {
      try {
        const res = await fetch(`${ONLINE_HTTP_BASE}/queue-size`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.size === 'number') setQueueSize(data.size);
      } catch { /* offline or network blip - leave count as-is */ }
    };
    fetchSize();
    const t = setInterval(fetchSize, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, [onlineRole]);

  // ── LAN Connection Handler ────────────────────────────────────────────
  function handleLANConnect(ip) {
    const serverIP = ip || hostIP.trim() || 'localhost';
    setStatus('connecting');
    setErrorMsg('');

    const client = new NetworkClient({
      serverIP,
      tokenProvider: null, // LAN has no auth
      onConnect: () => {
        setStatus('waiting');
        client.sendConfig(playerName.trim() || (role === 'host' ? 'Green Wrestler' : 'Red Wrestler'), style);
      },
      onMessage: (msg) => {
        if (msg.type === 'assigned') {
          client._assignedPlayer = msg.player;
        }
        if (msg.type === 'waiting') {
          setStatus('waiting');
        }
        if (msg.type === 'state_update') {
          setStatus('connected');
          // Ownership of `client` transfers to WrestlingGame. Null our ref so
          // the unmount cleanup (line ~74) doesn't call disconnect() on the
          // client we just handed off - which would dispose it and make the
          // next sendCardPick return false → "Connection lost" red box.
          clientRef.current = null;
          onGameStart({
            client,
            initialState: msg.state,
            initialHand: msg.hand,
            networkPlayer: msg.state ? (client._assignedPlayer || 'p1') : 'p1',
          });
        }
        if (msg.type === 'error') {
          setStatus('error');
          setErrorMsg(msg.message || 'Server error');
          client.disconnect();
        }
      },
      onDisconnect: () => {
        if (status !== 'connected') {
          setStatus('error');
          setErrorMsg('Disconnected from server');
        }
        clientRef.current = null;
      },
      onReconnecting: (attempt, max) => {
        setStatus('connecting');
        setErrorMsg(`Reconnecting… (${attempt}/${max})`);
      },
    });

    client.connect()
      .catch(err => {
        setStatus('error');
        setErrorMsg(err.message || 'Could not connect');
      });

    clientRef.current = client;
  }

  // ── Online Connection Handler ─────────────────────────────────────────
  const handleOnlineConnect = useCallback(async (action) => {
    setStatus('connecting');
    setErrorMsg('');

    // Get Firebase ID token
    let token;
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setStatus('error');
        setErrorMsg('You must be signed in to play online');
        return;
      }
      // Force-refresh - don't trust a cached token that may have ticked
      // past its 1h expiry while the app was backgrounded.
      token = await currentUser.getIdToken(true);
    } catch (err) {
      setStatus('error');
      setErrorMsg('Could not get auth token: ' + err.message);
      return;
    }

    const name = playerName.trim() || user?.displayName || 'Player';

    const client = new NetworkClient({
      serverIP: null, // not used for online
      // Called before every auth send, including reconnects - guarantees a
      // non-stale Firebase ID token on wire even after long backgrounding.
      tokenProvider: () => auth.currentUser?.getIdToken(true) ?? Promise.reject(new Error('No current user')),
      onConnect: () => {
        // Auth is sent automatically by connectOnline
        // Wait for auth_success before doing anything
      },
      onMessage: (msg) => {
        switch (msg.type) {
          case 'auth_success':
            // Authenticated - now create or join room
            if (action === 'create') {
              client.createRoom(name, style);
            } else if (action === 'join') {
              client.joinRoom(joinCode.toUpperCase().trim(), name);
            }
            break;

          case 'auth_error':
            setStatus('error');
            setErrorMsg(msg.message || 'Authentication failed');
            client.disconnect();
            break;

          case 'room_created':
            setRoomCode(msg.code);
            setStatus('waiting');
            break;

          case 'opponent_joined':
            setOpponentName(msg.opponent);
            // Store player assignment
            client._assignedPlayer = msg.player;
            break;

          case 'game_start':
            setStatus('connected');
            // Ownership transfers to WrestlingGame - see LAN handler note.
            clientRef.current = null;
            // Scrub the lobby's onMessage / onDisconnect / onReconnecting
            // closures off the client. WrestlingGame patches onMessage in
            // startNetworkGame, but the other callbacks would still mutate
            // local lobby state if a mid-match reconnect fired. Same fix
            // pattern as queueManager.consumeMatch.
            client.onMessage = () => {};
            client.onConnect = () => {};
            client.onDisconnect = () => {};
            client.onReconnecting = () => {};
            onGameStart({
              client,
              networkPlayer: msg.player,
              p1Name: msg.p1Name,
              p2Name: msg.p2Name,
              style: msg.style,
              mode: 'online',
              initialInitiative: msg.initialInitiative || null,
            });
            break;

          case 'opponent_disconnected':
            setReconnectInfo({ waiting: true, timeout: msg.timeout });
            break;

          case 'opponent_reconnected':
            setReconnectInfo(null);
            break;

          case 'match_voided':
            setStatus('error');
            setErrorMsg(msg.reason || 'Match voided - opponent left');
            setReconnectInfo(null);
            clientRef.current = null;
            break;

          case 'room_expired':
            setStatus('error');
            setErrorMsg(msg.message || 'Room expired');
            setReconnectInfo(null);
            clientRef.current = null;
            break;

          case 'reconnected':
            setRoomCode(msg.roomCode);
            setStatus('waiting');
            setReconnectInfo(null);
            break;

          case 'error':
            setStatus('error');
            setErrorMsg(msg.message || 'Server error');
            client.disconnect();
            break;
        }
      },
      onDisconnect: () => {
        if (status !== 'connected') {
          setStatus('error');
          setErrorMsg('Disconnected from server');
        }
        setReconnectInfo(null);
        clientRef.current = null;
      },
      onReconnecting: (attempt, max) => {
        setStatus('reconnecting');
        setReconnectInfo({ attempt, max });
      },
    });

    try {
      await client.connectOnline(token);
      clientRef.current = client;
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Could not connect to online server');
    }
  }, [playerName, style, joinCode, user, onGameStart, status]);

  const handleSpectateConnect = useCallback(async () => {
    setStatus('connecting');
    setErrorMsg('');

    let token;
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) { setStatus('error'); setErrorMsg('Sign in required'); return; }
      // Force-refresh - don't trust a cached token that may have ticked
      // past its 1h expiry while the app was backgrounded.
      token = await currentUser.getIdToken(true);
    } catch (err) { setStatus('error'); setErrorMsg('Auth error'); return; }

    const client = new NetworkClient({
      serverIP: null,
      tokenProvider: () => auth.currentUser?.getIdToken(true) ?? Promise.reject(new Error('No current user')),
      onConnect: () => {},
      onMessage: (msg) => {
        switch (msg.type) {
          case 'auth_success':
            client.spectateRoom(joinCode.toUpperCase().trim());
            break;
          case 'spectate_joined':
            setStatus('connected');
            // Ownership transfers to WrestlingGame - see LAN handler note.
            clientRef.current = null;
            // Audit repair #16: scrub the lobby's callback closures off the
            // client the same way the normal game_start branch does. Without
            // this, a mid-match reconnect or stray message would still
            // mutate lobby state via the stale onMessage / onDisconnect /
            // onReconnecting handlers, even though WrestlingGame has taken
            // over the client.
            client.onMessage = () => {};
            client.onConnect = () => {};
            client.onDisconnect = () => {};
            client.onReconnecting = () => {};
            onGameStart({
              client,
              networkPlayer: 'spectator',
              p1Name: msg.p1Name,
              p2Name: msg.p2Name,
              style: msg.style,
              mode: 'online',
            });
            break;
          case 'auth_error':
            setStatus('error');
            setErrorMsg(msg.message || 'Auth failed');
            client.disconnect();
            break;
          case 'error':
            setStatus('error');
            setErrorMsg(msg.message || 'Could not spectate');
            client.disconnect();
            break;
        }
      },
      onDisconnect: () => {
        setStatus('error');
        setErrorMsg('Disconnected');
        clientRef.current = null;
      },
      onReconnecting: () => {
        setStatus('reconnecting');
      },
    });

    try {
      await client.connectOnline(token);
      clientRef.current = client;
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Could not connect');
    }
  }, [joinCode, onGameStart]);


  // ── Style label helper ────────────────────────────────────────────────
  const styleLabel = (m) => (
    m === 'greco' ? 'Greco-Roman' :
    m === 'freestyle' ? 'Freestyle' :
    m === 'womens_freestyle' ? "Women's Freestyle" :
    'Folkstyle'
  );

  // ── Name + style config (shared) ─────────────────────────────────────
  const configSection = (
    <div className="flex flex-col gap-2 w-full max-w-xs">
      <input
        type="text"
        placeholder="Your wrestler name"
        value={playerName}
        onChange={e => setPlayerName(e.target.value)}
        maxLength={20}
        className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-zinc-500"
      />
      <div className="grid grid-cols-2 gap-2">
        {MODES.map(m => (
          <button
            key={m}
            onClick={() => setStyle(m)}
            className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
              style === m
                ? 'bg-yellow-500 text-black'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {styleLabel(m)}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Reconnection overlay (shown on top of game) ──────────────────────
  if (reconnectInfo && !reconnectInfo.waiting) {
    return (
      <div className="h-full bg-zinc-950/95 flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-yellow-400 font-black text-xl animate-pulse">Reconnecting...</div>
        <div className="text-zinc-400 text-sm">
          Attempt {reconnectInfo.attempt} of {reconnectInfo.max}
        </div>
        <div className="w-48 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-yellow-500 rounded-full transition-all duration-500"
            style={{ width: `${(reconnectInfo.attempt / reconnectInfo.max) * 100}%` }}
          />
        </div>
        <div className="text-zinc-600 text-xs">Do not close the app</div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────
  if (status === 'error') {
    // Auth errors ("Sign in required" / "You must be signed in to play
    // online") look just like connection errors without context - the
    // bare "Try Again" action will fail for the same reason on the next
    // tap. Detect the auth flavor and show the real auth CTAs instead.
    const isAuthError =
      !isAuthenticated ||
      /sign.?in|signed in|auth/i.test(errorMsg || '');
    return (
      <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
        <div className="text-red-400 font-black text-xl">
          {isAuthError ? 'Sign In Required' : 'Connection Failed'}
        </div>
        <div className="text-zinc-400 text-sm text-center max-w-xs">
          {isAuthError
            ? 'Online play needs a free MatGrind account so your wins, profile, and rematch code are tied to you.'
            : errorMsg}
        </div>
        {isAuthError ? (
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <button
              onClick={() => { setStatus('idle'); setErrorMsg(''); setReconnectInfo(null); onCreateWrestler?.('signup'); }}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-black font-black text-sm transition-all"
            >
              CREATE ACCOUNT
            </button>
            <button
              onClick={() => { setStatus('idle'); setErrorMsg(''); setReconnectInfo(null); onCreateWrestler?.('login'); }}
              className="w-full py-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 hover:bg-emerald-900/40 active:scale-[0.98] text-emerald-300 font-black text-sm transition-all"
            >
              SIGN IN
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setStatus('idle'); setErrorMsg(''); setReconnectInfo(null); }}
            className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] rounded-xl text-white font-bold text-sm transition-all"
          >
            Try Again
          </button>
        )}
        <button
          onClick={() => { onBack?.(); }}
          className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors"
        >
          Back to Menu
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  TOP-LEVEL: Choose LAN vs Online
  // ══════════════════════════════════════════════════════════════════════
  if (!netMode) {
    return (
      <div className="h-full bg-zinc-950 flex flex-col">
        <NavBar title="Multiplayer" onBack={onBack} />
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="text-center mb-2">
            <div className="text-2xl font-black text-white tracking-wide">MULTIPLAYER</div>
            <div className="text-zinc-500 text-sm mt-1">Choose how to play</div>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={() => setNetMode('online')}
              className="w-full py-4 rounded-xl border-2 border-purple-600 bg-purple-950/40 hover:bg-purple-900/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-purple-400 font-black text-lg">PLAY ONLINE</div>
              <div className="text-zinc-500 text-sm mt-0.5">Create or join a room with a code</div>
            </button>

            <button
              onClick={() => setNetMode('lan')}
              className="w-full py-4 rounded-xl border-2 border-emerald-700/60 bg-zinc-900/40 hover:bg-zinc-800/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-emerald-500 font-black text-lg">LAN GAME</div>
              <div className="text-zinc-500 text-sm mt-0.5">Play on the same Wi-Fi network</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  ONLINE MODE
  // ══════════════════════════════════════════════════════════════════════
  if (netMode === 'online') {
    // Must be signed in
    if (!isAuthenticated) {
      return (
        <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
          <div className="text-center">
            <div className="text-xl font-black text-white">SIGN IN REQUIRED</div>
            <div className="text-zinc-500 text-sm mt-2 max-w-xs">
              Online play needs a free MatGrind account so your wins, profile, and rematch code are tied to you.
            </div>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <button
              onClick={() => onCreateWrestler?.('signup')}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-black font-black text-sm transition-all"
            >
              CREATE ACCOUNT
            </button>
            <button
              onClick={() => onCreateWrestler?.('login')}
              className="w-full py-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 hover:bg-emerald-900/40 active:scale-[0.98] text-emerald-300 font-black text-sm transition-all"
            >
              SIGN IN
            </button>
          </div>
          <button
            onClick={() => onBack?.()}
            className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors mt-1"
          >
            Back
          </button>
        </div>
      );
    }

    // Choose create or join. Default action is FIND MATCH (auto-match
     // with a random opponent) - it's the fastest path to a game and
     // the canonical "Quick Match" entry point since the MainMenu tile
     // was removed. Create/Join Room remain as secondary options for
     // playing with a specific friend via room code. Spectate is tertiary.
    if (!onlineRole && status === 'idle') {
      return (
        <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-6 px-6">
          <div className="text-center mb-2">
            <div className="text-2xl font-black text-white tracking-wide">ONLINE MATCH</div>
            <div className="text-zinc-500 text-sm mt-1">Quick match against a random opponent</div>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-xs">
            {/* Primary action - Quick Match / Find Match. Bigger,
                brighter, first in tab order. Yellow keeps visual parity
                with the old MainMenu Quick Match tile. */}
            <button
              onClick={() => setOnlineRole('matchmaking')}
              className="w-full py-5 rounded-xl border-2 border-yellow-500 bg-yellow-950/40 hover:bg-yellow-900/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-yellow-400 font-black text-lg">⚔ QUICK MATCH</div>
              <div className="text-zinc-400 text-sm mt-0.5">Auto-match with a random opponent</div>
            </button>

            {/* Secondary - play with a specific friend via room code. */}
            <div className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest mt-1 mb-0.5 text-center">
              Or play with a friend
            </div>

            <button
              onClick={() => setOnlineRole('create')}
              className="w-full py-3 rounded-xl border border-purple-700/60 bg-purple-950/30 hover:bg-purple-900/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-purple-300 font-black text-sm">CREATE ROOM</div>
              <div className="text-zinc-500 text-xs mt-0.5">Get a code to share with a friend</div>
            </button>

            <button
              onClick={() => setOnlineRole('join')}
              className="w-full py-3 rounded-xl border border-blue-700/60 bg-blue-950/30 hover:bg-blue-900/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-blue-300 font-black text-sm">JOIN ROOM</div>
              <div className="text-zinc-500 text-xs mt-0.5">Enter a friend's room code</div>
            </button>

            <button
              onClick={() => setOnlineRole('spectate')}
              className="w-full py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-zinc-400 font-bold text-xs">SPECTATE</div>
              <div className="text-zinc-600 text-[10px] mt-0.5">Watch a match with a room code</div>
            </button>
          </div>

          <button
            onClick={() => onBack?.()}
            className="text-zinc-600 hover:text-zinc-400 text-sm mt-2 transition-colors"
          >
            Back
          </button>
        </div>
      );
    }

    // ── Create Room Flow ──────────────────────────────────────────────
    if (onlineRole === 'create') {
      if (status === 'idle') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-center">
              <div className="text-xl font-black text-white">CREATE ROOM</div>
              <div className="text-zinc-500 text-sm mt-1">Set up your match</div>
            </div>

            {configSection}

            <button
              onClick={() => handleOnlineConnect('create')}
              className="w-full max-w-xs py-3 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-black transition-all"
            >
              CREATE ROOM
            </button>

            <button
              onClick={() => { setOnlineRole(null); setStatus('idle'); }}
              className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors"
            >
              Back
            </button>
          </div>
        );
      }

      if (status === 'connecting') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-4">
            <div className="text-purple-400 animate-pulse text-lg font-bold">Creating room...</div>
            <div className="flex gap-2 mt-1">
              {[1,2,3].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />
              ))}
            </div>
          </div>
        );
      }

      if (status === 'waiting' && roomCode) {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-center">
              <div className="text-xl font-black text-purple-400 animate-pulse">Waiting for opponent...</div>
              <div className="text-zinc-500 text-sm mt-2">Share this room code</div>
            </div>

            <div className="bg-zinc-900 border-2 border-purple-600 rounded-xl p-6 w-full max-w-xs text-center">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Room Code</div>
              <div className="text-4xl font-black text-purple-400 font-mono tracking-[0.3em]">
                {roomCode}
              </div>
              <div className="text-zinc-600 text-xs mt-3">
                Tell your friend to join with this code
              </div>
            </div>

            <div className="text-zinc-600 text-xs">
              Style: <span className="text-zinc-400 capitalize">{style}</span>
            </div>

            <div className="flex gap-2 mt-1">
              {[1,2,3].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />
              ))}
            </div>

            <button
              onClick={() => {
                clientRef.current?.disconnect();
                setStatus('idle');
                setRoomCode('');
                setOnlineRole(null);
              }}
              className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors mt-2"
            >
              Cancel
            </button>
          </div>
        );
      }
    }

    // ── Join Room Flow ────────────────────────────────────────────────
    if (onlineRole === 'join') {
      if (status === 'idle') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-center">
              <div className="text-xl font-black text-white">JOIN ROOM</div>
              <div className="text-zinc-500 text-sm mt-1">Enter the room code from your friend</div>
            </div>

            {configSection}

            <div className="w-full max-w-xs">
              <input
                type="text"
                placeholder="Room code (e.g. ABCD)"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                onKeyDown={e => e.key === 'Enter' && joinCode.length === 4 && handleOnlineConnect('join')}
                maxLength={4}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white font-mono text-2xl text-center tracking-[0.3em] focus:outline-none focus:border-blue-600 uppercase"
              />
            </div>

            <button
              onClick={() => handleOnlineConnect('join')}
              disabled={joinCode.length !== 4}
              className="w-full max-w-xs py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 text-white font-black transition-all"
            >
              JOIN ROOM
            </button>

            <button
              onClick={() => { setOnlineRole(null); setJoinCode(''); setStatus('idle'); }}
              className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors"
            >
              Back
            </button>
          </div>
        );
      }

      if (status === 'connecting') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-4">
            <div className="text-blue-400 animate-pulse text-lg font-bold">Joining room {joinCode}...</div>
            <div className="flex gap-2 mt-1">
              {[1,2,3].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />
              ))}
            </div>
          </div>
        );
      }
    }

    // ── Find Match (Matchmaking) Flow ──────────────────────────────────
    if (onlineRole === 'matchmaking') {
      return (
        <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
          <div className="text-center">
            <div className="text-xl font-black text-white">FIND MATCH</div>
            <div className="text-zinc-500 text-sm mt-1">Auto-pair with a random opponent</div>
          </div>

          {configSection}

          {typeof queueSize === 'number' && queueSize > 0 && (
            <div className="text-center -mt-1">
              <div className="text-emerald-400 text-sm font-bold">
                {queueSize} {queueSize === 1 ? 'wrestler' : 'wrestlers'} searching
              </div>
              <div className="text-zinc-600 text-xs">Jump in and find a match.</div>
            </div>
          )}

          <button
            onClick={() => {
              startQueue({ name: playerName.trim() || user?.displayName || 'Player', style });
              onBack?.();
            }}
            className="w-full max-w-xs py-3 rounded-xl bg-yellow-600 hover:bg-yellow-500 active:scale-95 text-black font-black transition-all"
          >
            SEARCH FOR OPPONENT
          </button>

          <button
            onClick={() => { setOnlineRole(null); setStatus('idle'); }}
            className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors"
          >
            Back
          </button>
        </div>
      );
    }

    // ── Spectate Flow ──────────────────────────────────────────────────
    if (onlineRole === 'spectate') {
      if (status === 'idle') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-center">
              <div className="text-xl font-black text-white">SPECTATE</div>
              <div className="text-zinc-500 text-sm mt-1">Enter a room code to watch a match</div>
            </div>

            <div className="w-full max-w-xs">
              <input
                type="text"
                placeholder="Room code (e.g. ABCD)"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                onKeyDown={e => e.key === 'Enter' && joinCode.length === 4 && handleSpectateConnect()}
                maxLength={4}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white font-mono text-2xl text-center tracking-[0.3em] focus:outline-none focus:border-zinc-500 uppercase"
              />
            </div>

            <button
              onClick={handleSpectateConnect}
              disabled={joinCode.length !== 4}
              className="w-full max-w-xs py-3 rounded-xl bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 text-white font-black transition-all"
            >
              WATCH MATCH
            </button>

            <button
              onClick={() => { setOnlineRole(null); setJoinCode(''); setStatus('idle'); }}
              className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors"
            >
              Back
            </button>
          </div>
        );
      }

      if (status === 'connecting') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-4">
            <div className="text-zinc-400 animate-pulse text-lg font-bold">Connecting to room {joinCode}...</div>
          </div>
        );
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  LAN MODE (existing logic, cleaned up)
  // ══════════════════════════════════════════════════════════════════════
  if (netMode === 'lan') {
    // Choose host or join
    if (!role) {
      return (
        <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-6 px-6">
          <div className="text-center mb-2">
            <div className="text-2xl font-black text-white tracking-wide">LAN GAME</div>
            <div className="text-zinc-500 text-sm mt-1">Play on the same Wi-Fi network</div>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={() => setRole('host')}
              className="w-full py-4 rounded-xl border-2 border-emerald-600 bg-emerald-950/40 hover:bg-emerald-900/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-emerald-400 font-black text-lg">HOST GAME</div>
              <div className="text-zinc-500 text-sm mt-0.5">Start a game on this machine</div>
            </button>

            <button
              onClick={() => setRole('join')}
              className="w-full py-4 rounded-xl border-2 border-blue-600 bg-blue-950/40 hover:bg-blue-900/40 active:scale-95 transition-all text-left px-5"
            >
              <div className="text-blue-400 font-black text-lg">JOIN GAME</div>
              <div className="text-zinc-500 text-sm mt-0.5">Connect to the host's game</div>
            </button>
          </div>

          <button
            onClick={() => { setNetMode(null); setRole(null); }}
            className="text-zinc-600 hover:text-zinc-400 text-sm mt-2 transition-colors"
          >
            Back
          </button>
        </div>
      );
    }

    // ── HOST flow ──────────────────────────────────────────────────────
    if (role === 'host') {
      if (status === 'idle') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-center">
              <div className="text-xl font-black text-white">HOST GAME</div>
              <div className="text-zinc-500 text-sm mt-1">Share your IP with the other player</div>
            </div>

            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-full max-w-xs text-center">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Your Network IP</div>
              <div className="text-2xl font-black text-emerald-400 font-mono tracking-wide">
                {localIP || '...'}
              </div>
              <div className="text-zinc-600 text-xs mt-2">
                Tell them: open browser &rarr; Network &rarr; Join &rarr; type this IP
              </div>
            </div>

            {configSection}

            <button
              onClick={() => handleLANConnect('localhost')}
              className="w-full max-w-xs py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black transition-all"
            >
              START SERVER & WAIT
            </button>

            <button onClick={() => setRole(null)} className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors">
              Back
            </button>
          </div>
        );
      }

      if (status === 'connecting') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-4">
            <div className="text-zinc-400 animate-pulse text-lg font-bold">Connecting to server...</div>
            <div className="text-zinc-600 text-sm">Make sure <code className="text-zinc-400">node server.mjs</code> is running</div>
          </div>
        );
      }

      if (status === 'waiting') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-center">
              <div className="text-xl font-black text-emerald-400 animate-pulse">Waiting for opponent...</div>
              <div className="text-zinc-500 text-sm mt-2">Tell the other player to join at:</div>
            </div>
            <div className="bg-zinc-900 border border-emerald-800 rounded-xl p-5 text-center">
              <div className="text-3xl font-black text-emerald-400 font-mono tracking-widest">
                {localIP || 'localhost'}
              </div>
              <div className="text-zinc-500 text-xs mt-2">Port {WS_PORT}</div>
            </div>
            <div className="flex gap-2 mt-2">
              {[1,2,3].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />
              ))}
            </div>
          </div>
        );
      }
    }

    // ── JOIN flow ──────────────────────────────────────────────────────
    if (role === 'join') {
      if (status === 'idle') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-center">
              <div className="text-xl font-black text-white">JOIN GAME</div>
              <div className="text-zinc-500 text-sm mt-1">Enter the host's IP address</div>
            </div>

            {configSection}

            <div className="w-full max-w-xs">
              <input
                type="text"
                placeholder="Host IP (e.g. 192.168.1.42)"
                value={hostIP}
                onChange={e => setHostIP(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLANConnect()}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-blue-600"
              />
            </div>

            <button
              onClick={() => handleLANConnect()}
              disabled={!hostIP.trim()}
              className="w-full max-w-xs py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 text-white font-black transition-all"
            >
              CONNECT
            </button>

            <button onClick={() => setRole(null)} className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors">
              Back
            </button>
          </div>
        );
      }

      if (status === 'connecting') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-3">
            <div className="text-blue-400 animate-pulse text-lg font-bold">Connecting to {hostIP}...</div>
          </div>
        );
      }

      if (status === 'waiting') {
        return (
          <div className="h-full bg-zinc-950 flex flex-col items-center justify-center gap-4">
            <div className="text-blue-400 font-black text-xl animate-pulse">Connected!</div>
            <div className="text-zinc-500 text-sm">Waiting for host to start the game...</div>
            <div className="flex gap-2 mt-1">
              {[1,2,3].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />
              ))}
            </div>
          </div>
        );
      }
    }
  }

  return null;
}
