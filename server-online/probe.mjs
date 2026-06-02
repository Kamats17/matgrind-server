// Probe the deployed MatGrind WebSocket server end-to-end.
// Connects two fake clients, creates+joins a room, sends card_pick from each,
// and logs every frame — isolates whether the hang is server-side or client-side.
//
// Usage: node probe.mjs <wss-url> [firebaseIdToken]
// Without a token, falls back to a dummy string (only works in dev mode).

import WebSocket from 'ws';

const URL = process.argv[2] || 'wss://faithful-connection-production.up.railway.app';
const TOKEN = process.argv[3] || 'probe-token';
const TIMEOUT_MS = 20000;

function log(who, ...args) {
  const t = new Date().toISOString().slice(11, 23);
  console.log(`[${t}] ${who.padEnd(8)} |`, ...args);
}

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const client = {
      name, ws,
      received: [],
      send: (msg) => {
        log(name, 'TX →', JSON.stringify(msg).slice(0, 200));
        ws.send(JSON.stringify(msg));
      },
      waitFor: (type, ms = TIMEOUT_MS) => new Promise((res, rej) => {
        const existing = client.received.find(m => m.type === type);
        if (existing) return res(existing);
        const onMsg = (msg) => { if (msg.type === type) { cleanup(); res(msg); } };
        const t = setTimeout(() => { cleanup(); rej(new Error(`${name} timeout waiting for ${type}`)); }, ms);
        const cleanup = () => { client._listeners = client._listeners.filter(l => l !== onMsg); clearTimeout(t); };
        (client._listeners ||= []).push(onMsg);
      }),
    };
    ws.on('open', () => { log(name, 'WS OPEN'); resolve(client); });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        client.received.push(msg);
        log(name, 'RX ←', JSON.stringify(msg).slice(0, 200));
        (client._listeners || []).forEach(l => l(msg));
      } catch (e) { log(name, 'RX PARSE FAIL', raw.toString()); }
    });
    ws.on('close', (code, reason) => log(name, 'WS CLOSE', code, reason?.toString()));
    ws.on('error', (e) => { log(name, 'WS ERROR', e.message); reject(e); });
  });
}

async function main() {
  console.log('=== MatGrind server probe ===');
  console.log('URL:', URL);
  console.log('Token:', TOKEN.slice(0, 12) + '...');
  console.log('');

  const host = await connectClient('HOST');
  const guest = await connectClient('GUEST');

  host.send({ type: 'auth', token: TOKEN });
  const hostAuth = await host.waitFor('auth_success', 10000).catch(() => null);
  if (!hostAuth) {
    // Maybe the server sent an `error` instead of `auth_success`.
    const err = host.received.find(m => m.type === 'error');
    if (err) { log('HOST', 'AUTH FAILED:', err.message); process.exit(1); }
  }

  guest.send({ type: 'auth', token: 'differentuser-' + TOKEN });
  const guestAuth = await guest.waitFor('auth_success', 10000).catch(() => null);
  if (!guestAuth) {
    const err = guest.received.find(m => m.type === 'error');
    if (err) { log('GUEST', 'AUTH FAILED:', err.message); process.exit(1); }
  }

  // Create room
  host.send({ type: 'create_room', name: 'ProbeHost', style: 'folkstyle' });
  const roomCreated = await host.waitFor('room_created');
  const code = roomCreated.code;
  log('TEST', 'room code:', code);

  // Join room
  guest.send({ type: 'join_room', code, name: 'ProbeGuest' });
  await Promise.all([
    host.waitFor('game_start'),
    guest.waitFor('game_start'),
  ]);
  log('TEST', 'game_start received on both');

  // Authoritative protocol: each side first receives state_update with
  // hands and roundSeq, then sends card_pick (with that roundSeq).
  // The server resolves and broadcasts the next state_update.
  const hostInitState = host.received.find(m => m.type === 'state_update');
  const guestInitState = guest.received.find(m => m.type === 'state_update');
  const hostRoundSeq = hostInitState?.roundSeq ?? 1;
  const guestRoundSeq = guestInitState?.roundSeq ?? 1;
  const hostHand = hostInitState?.hand || [];
  const guestHand = guestInitState?.hand || [];

  // Pick the first card in each hand for the probe.
  const hostCard = hostHand[0]?.id || 'single_leg';
  const guestCard = guestHand[0]?.id || 'sprawl';

  host.send({ type: 'card_pick', roundSeq: hostRoundSeq, cardId: hostCard });
  guest.send({ type: 'card_pick', roundSeq: guestRoundSeq, cardId: guestCard });

  const hostAck = await host.waitFor('pick_acknowledged', 10000).catch(e => e);
  const guestAck = await guest.waitFor('pick_acknowledged', 10000).catch(e => e);
  // Wait for the post-resolution state_update (roundSeq advanced).
  // For NONE-mechanic cards this fires immediately; for skill cards the
  // server starts a challenge first and waits for both sides' challenges
  // to resolve. Probe doesn't simulate challenge_input - so for skill
  // cards we'll see challenge_start but no resolution before the deadline.
  const hostNext = await host.waitFor('state_update', 10000).catch(e => e);
  const guestNext = await guest.waitFor('state_update', 10000).catch(e => e);

  console.log('\n=== RESULT ===');
  console.log('HOST  pick_acknowledged:', hostAck instanceof Error ? 'MISSING (' + hostAck.message + ')' : 'RECEIVED');
  console.log('GUEST pick_acknowledged:', guestAck instanceof Error ? 'MISSING (' + guestAck.message + ')' : 'RECEIVED');
  console.log('HOST  next state_update:', hostNext instanceof Error ? 'MISSING (' + hostNext.message + ')' : `RECEIVED (roundSeq=${hostNext.roundSeq})`);
  console.log('GUEST next state_update:', guestNext instanceof Error ? 'MISSING (' + guestNext.message + ')' : `RECEIVED (roundSeq=${guestNext.roundSeq})`);

  host.ws.close();
  guest.ws.close();
  setTimeout(() => process.exit(0), 500);
}

main().catch(e => { console.error('PROBE FAILED:', e); process.exit(1); });
