// Lightweight in-process metrics for the authoritative online server.
// Counters + gauges only (no histograms yet) - exposed via /metrics in
// Prometheus text-format and via /metrics.json for ad-hoc dashboards.
//
// Imported by roomManager (room/engine events), challengeEngine (tier
// outcomes, anti-cheat floor hits), and index.mjs (auth + connection
// events). Adding a new counter is a one-liner: bump it from anywhere.

const counters = new Map();   // 'name|labelKVPairs' -> number
const gauges = new Map();     // same key shape

function key(name, labels) {
  if (!labels) return name;
  const parts = Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(',');
  return parts ? `${name}|${parts}` : name;
}

/**
 * Increment a counter by `n` (default 1).
 * Labels are optional and used to slice the metric (e.g., mechanic, tier).
 */
export function incCounter(name, labels = null, n = 1) {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) || 0) + n);
}

/**
 * Set a gauge value. Use for "current" measurements (rooms_active, etc.).
 */
export function setGauge(name, value, labels = null) {
  gauges.set(key(name, labels), value);
}

/** For tests: read a counter value. */
export function getCounter(name, labels = null) {
  return counters.get(key(name, labels)) || 0;
}
export function getGauge(name, labels = null) {
  return gauges.get(key(name, labels)) ?? null;
}

/** For tests: clear all metric state. */
export function resetMetrics() {
  counters.clear();
  gauges.clear();
}

function parseKey(k) {
  const idx = k.indexOf('|');
  if (idx === -1) return { name: k, labels: {} };
  const name = k.slice(0, idx);
  const labels = {};
  const parts = k.slice(idx + 1).split(',');
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) labels[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return { name, labels };
}

function fmtLabels(labels) {
  const keys = Object.keys(labels);
  if (!keys.length) return '';
  return '{' + keys.map(k => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`).join(',') + '}';
}

/**
 * Render counters + gauges in Prometheus text format. One line per
 * (name, label-set). Suitable for /metrics scrape.
 */
export function renderPrometheus() {
  const lines = [];
  // Group by name so we emit one HELP + TYPE block per metric.
  const byName = new Map(); // name -> { type, items: [{labels, value}] }
  for (const [k, v] of counters) {
    const { name, labels } = parseKey(k);
    if (!byName.has(name)) byName.set(name, { type: 'counter', items: [] });
    byName.get(name).items.push({ labels, value: v });
  }
  for (const [k, v] of gauges) {
    const { name, labels } = parseKey(k);
    if (!byName.has(name)) byName.set(name, { type: 'gauge', items: [] });
    byName.get(name).items.push({ labels, value: v });
  }
  for (const [name, { type, items }] of byName) {
    lines.push(`# TYPE ${name} ${type}`);
    for (const { labels, value } of items) {
      lines.push(`${name}${fmtLabels(labels)} ${value}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** JSON dump of all metric state (for ad-hoc dashboards). */
export function renderJson() {
  const out = { counters: {}, gauges: {} };
  for (const [k, v] of counters) out.counters[k] = v;
  for (const [k, v] of gauges) out.gauges[k] = v;
  return out;
}
