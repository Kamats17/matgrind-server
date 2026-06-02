// Path-tracing geometry + scoring for the PATH skill mechanic (transition cards).
// Pure module: no React, no DOM. Importable by Node ESM (server) and browser bundle.
//
// Six normalized polyline patterns; getReferencePolyline rotates and maps them
// into pixel-space [insetPx, sizePx-insetPx] before the player traces. scoreTrace
// grades a captured sample stream against that reference.

const MIN_SAMPLES        = 8;
const ENDPOINT_TOLERANCE = 60;
const PERFECT_DIST_PX    = 14;
// Bucketed-coverage gate. Reference is split into N_BUCKETS equal arc-length
// segments; each sample marks the bucket of its nearest projection. Requiring
// >= COVERAGE_FRACTION buckets visited catches "scribble at start, jump to
// end" cheese while a max-progress check alone cannot (a single end sample
// already pushes maxProgress to refLen).
const N_BUCKETS          = 10;
const COVERAGE_FRACTION  = 0.70;

// Patterns expressed in normalized [0,1] coords. Mapped into the inset rect
// (so the line stays well inside the canvas border).
export const PATH_PATTERNS = Object.freeze([
  // 0 - Zigzag (sine-wave, 5 waypoints, left → right)
  Object.freeze([
    { x: 0.00, y: 0.50 },
    { x: 0.25, y: 0.18 },
    { x: 0.50, y: 0.82 },
    { x: 0.75, y: 0.18 },
    { x: 1.00, y: 0.50 },
  ]),
  // 1 - S-Curve (top-left → bottom-right, S shape)
  Object.freeze([
    { x: 0.00, y: 0.00 },
    { x: 0.75, y: 0.20 },
    { x: 0.30, y: 0.50 },
    { x: 0.75, y: 0.80 },
    { x: 1.00, y: 1.00 },
  ]),
  // 2 - Triangle (3 vertices closed back to start)
  Object.freeze([
    { x: 0.00, y: 1.00 },
    { x: 0.50, y: 0.00 },
    { x: 1.00, y: 1.00 },
    { x: 0.00, y: 1.00 },
  ]),
  // 3 - L-Hook (bottom-left → bottom-right → top-right)
  Object.freeze([
    { x: 0.00, y: 1.00 },
    { x: 1.00, y: 1.00 },
    { x: 1.00, y: 0.00 },
  ]),
  // 4 - Wave (two crests, 5 waypoints)
  Object.freeze([
    { x: 0.00, y: 0.50 },
    { x: 0.25, y: 0.10 },
    { x: 0.50, y: 0.50 },
    { x: 0.75, y: 0.90 },
    { x: 1.00, y: 0.50 },
  ]),
  // 5 - Hook Return (comma shape)
  Object.freeze([
    { x: 0.00, y: 0.50 },
    { x: 0.50, y: 0.20 },
    { x: 0.85, y: 0.50 },
    { x: 0.50, y: 0.80 },
    { x: 0.20, y: 0.50 },
  ]),
]);

function rotateAroundCenter(point, deg) {
  const rad = (deg * Math.PI) / 180;
  const cx = 0.5;
  const cy = 0.5;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

/**
 * Build a deterministic reference polyline in pixel space.
 * @param {number} patternIndex - 0..5 into PATH_PATTERNS
 * @param {number} rotationDeg - one of 0/90/180/270
 * @param {number} sizePx - canvas size (default 320)
 * @param {number} insetPx - margin from canvas edge (default 36)
 * @returns {Array<{x:number, y:number}>}
 */
export function getReferencePolyline(patternIndex, rotationDeg = 0, sizePx = 320, insetPx = 36) {
  const idx = ((Number(patternIndex) | 0) + PATH_PATTERNS.length) % PATH_PATTERNS.length;
  const deg = ((Number(rotationDeg) | 0) % 360 + 360) % 360;
  const pattern = PATH_PATTERNS[idx];
  const usable = sizePx - 2 * insetPx;
  return pattern.map((p) => {
    const r = rotateAroundCenter(p, deg);
    return {
      x: insetPx + r.x * usable,
      y: insetPx + r.y * usable,
    };
  });
}

function distToPoint(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Project p onto segment [a,b]. Returns distance and parameter t in [0,1]
 * (0 = at a, 1 = at b).
 */
function projectOntoSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { dist: distToPoint(p, a), t: 0 };
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return { dist: Math.hypot(p.x - projX, p.y - projY), t };
}

export function distToSegment(p, a, b) {
  return projectOntoSegment(p, a, b).dist;
}

export function nearestSegmentDist(p, polyline) {
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distToSegment(p, polyline[i], polyline[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

export function polylineLength(points) {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += distToPoint(points[i], points[i + 1]);
  }
  return len;
}

/**
 * Grade a captured sample stream against a reference polyline.
 *
 * @param {Array<{x:number,y:number,t?:number}>} samples
 * @param {Array<{x:number,y:number}>} reference
 * @param {{perfectDevPx:number, goodDevPx:number}} tuning
 * @returns {{tier:'PERFECT'|'GOOD'|'MISS', accuracy:number, dev:number, refProgress:number, reason?:string}}
 */
export function scoreTrace(samples, reference, tuning) {
  if (!Array.isArray(samples) || samples.length < MIN_SAMPLES) {
    return { tier: 'MISS', accuracy: 0, dev: Infinity, refProgress: 0, reason: 'too_few_samples' };
  }
  if (!Array.isArray(reference) || reference.length < 2) {
    return { tier: 'MISS', accuracy: 0, dev: Infinity, refProgress: 0, reason: 'invalid_reference' };
  }

  if (distToPoint(samples[0], reference[0]) > ENDPOINT_TOLERANCE) {
    return { tier: 'MISS', accuracy: 0, dev: Infinity, refProgress: 0, reason: 'wrong_start' };
  }
  if (distToPoint(samples[samples.length - 1], reference[reference.length - 1]) > ENDPOINT_TOLERANCE) {
    return { tier: 'MISS', accuracy: 0, dev: Infinity, refProgress: 0, reason: 'wrong_end' };
  }

  const refLen = polylineLength(reference);
  if (refLen <= 0) {
    return { tier: 'MISS', accuracy: 0, dev: Infinity, refProgress: 0, reason: 'invalid_reference' };
  }

  const cumLen = new Array(reference.length);
  cumLen[0] = 0;
  for (let i = 0; i < reference.length - 1; i++) {
    cumLen[i + 1] = cumLen[i] + distToPoint(reference[i], reference[i + 1]);
  }

  let onLine = 0;
  let sumDev = 0;
  const visited = new Array(N_BUCKETS).fill(false);

  for (const s of samples) {
    let bestDist = Infinity;
    let bestSegIdx = 0;
    let bestT = 0;
    for (let i = 0; i < reference.length - 1; i++) {
      const { dist, t } = projectOntoSegment(s, reference[i], reference[i + 1]);
      if (dist < bestDist) {
        bestDist = dist;
        bestSegIdx = i;
        bestT = t;
      }
    }
    sumDev += bestDist;
    if (bestDist <= PERFECT_DIST_PX) onLine += 1;
    const segLen = cumLen[bestSegIdx + 1] - cumLen[bestSegIdx];
    const progress = cumLen[bestSegIdx] + bestT * segLen;
    const bucket = Math.max(
      0,
      Math.min(N_BUCKETS - 1, Math.floor((progress / refLen) * N_BUCKETS)),
    );
    visited[bucket] = true;
  }

  const visitedCount = visited.reduce((n, v) => n + (v ? 1 : 0), 0);
  const refProgress = visitedCount / N_BUCKETS;
  if (refProgress < COVERAGE_FRACTION) {
    return { tier: 'MISS', accuracy: onLine / samples.length, dev: Infinity, refProgress, reason: 'too_short' };
  }

  const dev = sumDev / samples.length;
  const accuracy = onLine / samples.length;

  const perfectDevPx = Number.isFinite(tuning?.perfectDevPx) ? tuning.perfectDevPx : 18;
  const goodDevPx    = Number.isFinite(tuning?.goodDevPx)    ? tuning.goodDevPx    : 42;

  if (accuracy >= 0.90 && dev <= perfectDevPx) {
    return { tier: 'PERFECT', accuracy, dev, refProgress };
  }
  if (dev <= goodDevPx) {
    return { tier: 'GOOD', accuracy, dev, refProgress };
  }
  return { tier: 'MISS', accuracy, dev, refProgress };
}

export const SCORE_TRACE_CONSTANTS = Object.freeze({
  MIN_SAMPLES,
  COVERAGE_FRACTION,
  ENDPOINT_TOLERANCE,
  PERFECT_DIST_PX,
  N_BUCKETS,
});
