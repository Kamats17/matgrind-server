import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { haptic } from '@/lib/haptics';
import { MECHANIC_TUNING, SKILL_TIERS } from '@/lib/cardArchetypeMechanics';
import { getReferencePolyline, scoreTrace } from '@/lib/pathPatterns';

// Polyline-trace gesture for transition cards. The player drags a finger
// along a dashed reference line; scoreTrace grades coverage + accuracy.
//
// Note: this is the PATH mechanic, not the existing TRACE mechanic. TRACE
// is the 2-arrow swipe sequence used by top_turns cards. They share the
// "Trace the path" UI label by accident of language; their gestures and
// scoring are completely independent.
export default function PathMechanic({ onResolve, tuningOverride = null, onInput = null }) {
  const tuning = tuningOverride
    ? { ...MECHANIC_TUNING.path, ...tuningOverride }
    : MECHANIC_TUNING.path;

  // Pattern + rotation come from server params in online mode (so the
  // server grades against the same reference). Offline: random per mount.
  const params = useMemo(() => {
    if (tuningOverride
        && Number.isFinite(tuningOverride.patternIndex)
        && Number.isFinite(tuningOverride.rotationDeg)) {
      return {
        patternIndex: tuningOverride.patternIndex,
        rotationDeg:  tuningOverride.rotationDeg,
        sizePx:       tuningOverride.sizePx ?? 320,
        insetPx:      tuningOverride.insetPx ?? 36,
      };
    }
    return {
      patternIndex: Math.floor(Math.random() * 6),
      rotationDeg:  Math.floor(Math.random() * 4) * 90,
      sizePx:       320,
      insetPx:      36,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reference = useMemo(
    () => getReferencePolyline(params.patternIndex, params.rotationDeg, params.sizePx, params.insetPx),
    [params],
  );

  const sampleIntervalMs = 1000 / (tuning.sampleHzMaxClient || 15);

  const svgRef = useRef(null);
  const samplesRef = useRef([]);
  const [userPath, setUserPath] = useState('');
  const lastSampleAtRef = useRef(0);
  const tracingRef = useRef(false);
  const resolvedRef = useRef(false);

  const onResolveRef = useRef(onResolve);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);

  const safeResolve = (result) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolveRef.current(result);
  };

  // Idle timeout: no stroke or stroke never finishes -> MISS.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!resolvedRef.current) {
        haptic.warning();
        safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS });
      }
    }, tuning.strokeTimeoutMs || 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convert a pointer event into SVG viewBox-local coords (0..sizePx).
  // Required: scoreTrace and the server reference polyline both live in
  // pixel space, not clientX/Y.
  const toLocal = (e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) {
      return { x: 0, y: 0, t: performance.now() };
    }
    return {
      x: ((e.clientX - r.left) / r.width)  * params.sizePx,
      y: ((e.clientY - r.top)  / r.height) * params.sizePx,
      t: performance.now(),
    };
  };

  const pushSample = (sample, { throttle }) => {
    if (throttle) {
      const now = sample.t;
      if (now - lastSampleAtRef.current < sampleIntervalMs) return;
      lastSampleAtRef.current = now;
    } else {
      lastSampleAtRef.current = sample.t;
    }
    samplesRef.current.push(sample);
    if (onInput) onInput('sample', sample);
    setUserPath(buildPath(samplesRef.current));
  };

  const handlePointerDown = (e) => {
    if (resolvedRef.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    tracingRef.current = true;
    samplesRef.current = [];
    setUserPath('');
    lastSampleAtRef.current = 0;
    haptic.light();
    pushSample(toLocal(e), { throttle: false });
  };

  const handlePointerMove = (e) => {
    if (!tracingRef.current || resolvedRef.current) return;
    pushSample(toLocal(e), { throttle: true });
  };

  const handlePointerUp = (e) => {
    if (!tracingRef.current || resolvedRef.current) return;
    tracingRef.current = false;
    // Unthrottled final sample so the wrong_end gate sees the true release point.
    pushSample(toLocal(e), { throttle: false });
    if (onInput) onInput('stroke_end', {});
    const result = scoreTrace(samplesRef.current, reference, tuning);
    if (result.tier === 'PERFECT') haptic.heavy();
    else if (result.tier === 'GOOD') haptic.medium();
    else haptic.warning();
    safeResolve({ tier: result.tier, ...SKILL_TIERS[result.tier] });
  };

  // Reference polyline as SVG path string.
  const referencePathStr = useMemo(() => buildPath(reference), [reference]);

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="text-xs uppercase tracking-widest text-zinc-400">Trace the path</div>
      {/* Render size is responsive: capped at sizePx, shrinks to fit narrow
          panels (5rem accounts for overlay + panel padding). viewBox keeps the
          coordinate space at sizePx, and toLocal() maps pointer events via
          getBoundingClientRect, so scoring is unaffected by the rendered size. */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${params.sizePx} ${params.sizePx}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          touchAction: 'none',
          width: `min(${params.sizePx}px, calc(100vw - 5rem))`,
          height: `min(${params.sizePx}px, calc(100vw - 5rem))`,
        }}
        className="rounded-2xl bg-zinc-900 border-2 border-zinc-700"
      >
        {/* Halo under the dashed line for a wider visual target */}
        <path
          d={referencePathStr}
          stroke="rgba(113, 113, 122, 0.35)"
          strokeWidth={28}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d={referencePathStr}
          stroke="rgb(228, 228, 231)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="8 8"
          fill="none"
        />
        {/* Waypoints */}
        {reference.map((p, i) => {
          const isStart = i === 0;
          const isEnd   = i === reference.length - 1;
          const fill = isStart ? 'rgb(74, 222, 128)' : isEnd ? 'rgb(248, 113, 113)' : 'rgb(113, 113, 122)';
          const radius = isStart || isEnd ? 10 : 6;
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={radius}
              fill={fill}
            />
          );
        })}
        {/* Player's live trace */}
        {userPath && (
          <motion.path
            d={userPath}
            stroke="rgb(251, 191, 36)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
          />
        )}
      </svg>
    </div>
  );
}

function buildPath(points) {
  if (!points || points.length === 0) return '';
  let s = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    s += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return s;
}
