// HTTP request routing for the online server, extracted so the
// access-control decisions are unit-testable without binding a socket.
//
// Policy (Stage 1 §1.8, guardrail 6 — fail closed):
//   - /health and /queue-size are PUBLIC (the client polls queue size).
//   - /metrics, /metrics.json, /debug/* are OPERATIONAL and protected:
//       * inaccessible entirely when no METRICS_AUTH_TOKEN is configured,
//       * otherwise require a matching `Authorization: Bearer <token>`.

function bearerToken(headers = {}) {
  const h = headers.authorization || headers.Authorization;
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

const json = (status, obj) => ({
  status,
  contentType: 'application/json',
  cors: true,
  body: JSON.stringify(obj),
});

/**
 * Pure router. Returns a response descriptor:
 *   { status, contentType?, body?, cors? }
 * `deps` injects server state + renderers so this stays testable.
 */
export function routeHttp(req, deps) {
  const method = req.method || 'GET';
  const url = req.url || '/';
  const {
    activeCount, queueSize, metricsToken,
    renderPrometheus, renderJson, recentEvents,
  } = deps;

  if (method === 'OPTIONS') return { status: 204, cors: true };

  // ── Public ──
  if (url === '/health') return json(200, { status: 'ok', rooms: activeCount() });
  if (url === '/queue-size') return json(200, { size: queueSize() });

  // ── Protected ops endpoints ──
  const isOps = url === '/metrics' || url === '/metrics.json' || url.startsWith('/debug/');
  if (isOps) {
    if (!metricsToken) return json(503, { error: 'ops_endpoints_disabled' }); // fail closed
    if (bearerToken(req.headers || {}) !== metricsToken) return json(401, { error: 'unauthorized' });

    if (url === '/metrics') {
      return { status: 200, contentType: 'text/plain; version=0.0.4', body: renderPrometheus() };
    }
    if (url === '/metrics.json') return json(200, renderJson());
    if (url.startsWith('/debug/recent')) {
      const u = new URL(url, 'http://localhost');
      const n = Math.min(500, Math.max(1, Number(u.searchParams.get('n')) || 200));
      return json(200, recentEvents(n));
    }
    return { status: 404 };
  }

  return { status: 404 };
}
