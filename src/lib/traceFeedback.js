// Render-gate helper for the per-side trace chip on the match HUD.
//
// The trace chip is the small "⚡ Name Trace +N" / "✓ Name Trace +N" status
// readout that surfaces a successful PATH-mechanic round (transition cards
// like spiral_ride, bridge_defense, pummel_inside). It must render whenever
// the engine signals: side played a path mechanic AND landed PERFECT/GOOD.
//
// Living as a pure helper (instead of inline JSX) so:
//   1. The contract is asserted by tests, not eyeballed in 5800 lines of
//      WrestlingGame.jsx.
//   2. Future regressions on the gate condition fail the test, not silent
//      missing-chip-on-screen issues.
//
// Contract:
//   - returns true only when the named side has a 'path' mechanic AND tier
//     is PERFECT or GOOD on that side. MISS rounds intentionally render no
//     chip (per product decision: missed traces should be invisible, not
//     loud - different from the takedown legacy chips that only fire on
//     PERFECT/GOOD anyway).
//   - returns false if lastResult is null/undefined, or any field is
//     missing on the requested side.
//
// IMPORTANT: server-authoritative online mode delivers `lastResult` via
// state_update messages. The server's serializer MUST include the
// `${side}Mechanic`, `${side}SkillTier`, and `${side}SkillBonusApplied`
// fields or this helper will return false on the opponent's trace even
// when the local engine would have stamped them. If you change the server
// schema, mirror that change here and add a test case.

export function shouldRenderTraceChip(lastResult, side) {
  if (!lastResult) return false;
  if (side !== 'p1' && side !== 'p2') return false;
  if (lastResult[`${side}Mechanic`] !== 'path') return false;
  const tier = lastResult[`${side}SkillTier`];
  return tier === 'PERFECT' || tier === 'GOOD';
}
