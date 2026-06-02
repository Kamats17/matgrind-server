// Durable metrics snapshot builder (Stage 1 §1.7). Pure: the I/O (Firestore
// write) lives in index.mjs and is isolated in a try/catch so telemetry can
// never crash gameplay.
//
// Doc IDs are namespaced by release + process start so cumulative counters
// (which reset on every deploy / restart) are only ever compared within the
// same process lifetime (guardrail 5). The minute bucket makes a given
// minute's snapshot idempotent — re-running overwrites rather than appends.

export function buildSnapshot({ json, releaseId, processStartTimeMs, nowMs, retentionDays = 30 }) {
  const minuteBucket = Math.floor(nowMs / 60000);
  const docId = `${releaseId}__${processStartTimeMs}__${minuteBucket}`;
  // `expireAt` is a real Date (firebase-admin stores it as a Firestore
  // Timestamp). Enable a Firestore TTL policy on this field so old snapshots
  // auto-delete — `retentionDays` alone is just metadata.
  const expireAt = new Date(nowMs + retentionDays * 86400000);
  return {
    collection: 'server_metrics',
    docId,
    data: {
      releaseId,
      processStartTimeMs,
      capturedAtMs: nowMs,
      minuteBucket,
      retentionDays,
      expireAt,
      counters: json.counters || {},
      gauges: json.gauges || {},
    },
  };
}
