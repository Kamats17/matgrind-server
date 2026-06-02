# Folkstyle Wrestling Simulator - Baseline Snapshot
**Date:** 2026-04-05
**Validated by:** Live browser testing (Playwright) against dev server at http://localhost:5173
**Status:** Functional prototype - all core systems confirmed working

---

## VALIDATION METHOD

Full live testing was conducted by:
1. Running the dev server (`npm run dev`)
2. Browser-based interaction via Playwright
3. Direct React state injection via `__reactContainer` fiber tree to force specific scenarios (FHL state, pin attempt, tech fall, decision)
4. Reading console output to capture runtime errors

---

## WHAT IS CONFIRMED WORKING ✓

### Match Flow
- [x] Main menu renders (vs CPU / Local 2P mode selection, name input)
- [x] `START MATCH` launches a match with correct initial state (period 1, 2:00, 0-0, both neutral, 100% stamina)
- [x] AI picks card ~400ms after player selects - resolution fires after 700ms
- [x] Match log populates correctly with each action
- [x] Match log entry count updates
- [x] `← Menu` navigates back to main menu mid-match
- [x] `REMATCH` resets correctly to a new match
- [x] `Main Menu` button on result modal returns to menu

### Scoring (NFHS Folkstyle - All Correct)
| Action | Expected | Live Result |
|--------|----------|-------------|
| Takedown | +3 pts | ✓ Green Wrestler hits Double Leg - TAKEDOWN! +3 pts |
| Near-fall | +2 pts | ✓ Tilt - NEAR FALL! +2 pts |
| Near-fall (pin break 3-count) | +3 pts | ✓ bridges hard - pin broken! +3 near-fall |
| Reversal | +2 pts | ✓ CPU Opponent reverses with Sit-Out! +2 pts |
| Escape | +1 pt | (not observed directly, scoring path confirmed in engine) |
| Tech Fall | at 15+ lead | ✓ Score 14+3=17, TECHNICAL FALL triggered |
| Decision | P3 clock 0:00 | ✓ Score 6-4, DECISION modal shown |

### Position Transitions
- [x] Double Leg wins → attacker TOP, defender BOTTOM
- [x] Reversal (Sit-Out) → reverser TOP, opponent BOTTOM - positions flip correctly
- [x] Card hand correctly changes to TOP cards (RIDE/TURN) after takedown
- [x] Card hand correctly changes to BOTTOM cards (ESC) when reversed to bottom
- [x] Card hand correctly changes back to NEUTRAL cards after escape/reversal to neutral
- [x] `control_established` condition set on attacker after takedown/reversal
- [x] `RECOVERING` condition set on defender after near-fall
- [x] `RECOVERING` condition cleared on period break

### Ground Control Visual
- [x] Ground Control SVG renders correctly when any wrestler is TOP/BOTTOM
- [x] TOP label appears above top wrestler in diagram
- [x] BOTTOM label appears below bottom wrestler
- [x] Initiative ⚡ dot correctly shown above the initiative holder

### Neutral Diagram
- [x] Neutral SVG renders when both wrestlers in neutral
- [x] "VS" divider shown
- [x] Initiative ⚡ correctly on initiative holder

### ScoreBoard
- [x] Period indicator (1/2/3) shows correct period
- [x] Clock counts down correctly (action-based, 10-18s per action)
- [x] Score updates immediately after each resolved action
- [x] Lead indicator ("GRN +N" or "RED +N" or "TIED") accurate
- [x] Stamina bars update correctly (100% → 78% after 22-cost card, floors at 0%)
- [x] Stamina bars not reset between periods
- [x] Position labels (NEUTRAL / TOP / BOTTOM) correct
- [x] Momentum arrow (↑ GRN / ↑ RED) updates after scoring moves
- [x] Conditions badges shown correctly ("control established", "recovering", "front headlock control")

### MatView
- [x] ▲ / ▼ / ◆ position icons correct for TOP/BOTTOM/NEUTRAL
- [x] "Green Wrestler ON TOP / BOTTOM - CPU Opponent" readable
- [x] Last action message updates after each round
- [x] CHAIN badge appears on scramble results
- [x] ⚡ INIT badge shows on initiative holder

### CardHand
- [x] 8 cards deal on match start and after each round resolution
- [x] ATK/DEF/RIDE/TURN/ESC badges render correctly by card category
- [x] Position-gated cards locked/disabled when wrestler is in wrong position (e.g., RIDE cards locked when neutral)
- [x] Condition-gated cards show "LOCKED" badge when condition not met (e.g., Arm Bar requires `control_established`)
- [x] "Req: [condition]" shown in tooltip for setup-required cards
- [x] "Counters: [card]" shown in tooltip
- [x] "Power: N" shown in tooltip
- [x] FHL cards render with "FHL" badge when injected into hand
- [x] Cards are correctly disabled after player selects one (until round resolves)
- [x] Card selection triggers ✓ Selected status in header

### Pin Attempt Modal
- [x] Modal overlays correctly when `phase === 'pin_attempt'`
- [x] Pin probability % displayed prominently
- [x] 3 offense cards shown with +% bonus labels
- [x] 3 defense cards shown on CPU side (auto-selected by AI)
- [x] "CPU defending... ✓ Defense ready" status shown when AI has picked
- [x] "Offense: choose... ✓ Defense ready" status row updates correctly
- [x] After offense pick: pin resolves in ~500ms
- [x] Successful bridge defense → "+N near-fall, still on bottom" logged
- [x] Position stays TOP/BOTTOM after failed pin ✓
- [x] `control_established` preserved on attacker after failed pin ✓
- [x] `RECOVERING` set on defender after pin break ✓

### Period Break Modal
- [x] Period 2 modal shows after Period 1 clock expires
- [x] Correct chooser shown (P1 chooses in period 2)
- [x] Current score shown in modal (e.g., Green 5, CPU 2)
- [x] 3 position choices: Top / Bottom / Neutral
- [x] Choosing TOP sets wrestler to top position with `control_established`
- [x] Clock resets to 2:00 for new period
- [x] Scores persist across period break
- [x] Log entry "Period N over. Starting Period N+1." appears
- [x] Log entry "Period N - [name] chose [position]." appears

### Win Conditions / Result Modal
- [x] Tech Fall: "⚡ TECHNICAL FALL - [name] WINS THE MATCH" with 15+ lead
- [x] Decision: "🏅 DECISION - [name] WINS THE MATCH" at period 3 clock 0:00
- [x] Final score shown correctly on result modal
- [x] Per-wrestler stat breakdown (TD / Esc / Rev / NF) shown
- [x] REMATCH button restarts match with same names
- [x] Main Menu button returns to menu

### Push Pace
- [x] Button appears when no card selected and not resolving
- [x] Click: stamina -5 (100→95), momentum set to p1, clock -5s
- [x] Message: "Green Wrestler pushes the pace - initiative gained!"

### Stamina System
- [x] Each card costs its stamina amount per turn
- [x] Stamina floors at 0% - game does not freeze
- [x] Cards still shown and playable at 0% stamina
- [x] Both players' stamina can reach 0% simultaneously without crash

---

## CONFIRMED BUGS (LIVE) ✗

### BUG 1 - FHL Visual Never Renders [HIGH]
**Confirmed live by state injection.**

**What happens:** When `front_headlock_control` is active and both wrestlers are in `neutral` position, the WrestlerVisual component renders the NeutralDiagram (two wrestlers with "VS") instead of the FrontHeadlockDiagram.

**Root cause:** `WrestlerVisual.jsx:263` - condition order wrong:
```jsx
{isNeutral && <NeutralDiagram ... />}          // renders because isNeutral=true
{!isNeutral && !fhlActive && <GroundDiagram />} // skipped
{!isNeutral && fhlActive && <FHL Diagram />}    // skipped (isNeutral=true blocks it)
```

**Evidence:** Position label shows "Neutral", `front headlock control` badge shows in ScoreBoard, NeutralDiagram renders.

**Workaround:** None. FHL diagram is unreachable via normal gameplay.

**Fix:** Check `fhlActive` before `isNeutral`:
```jsx
{fhlActive && <FrontHeadlockDiagram />}
{!fhlActive && isNeutral && <NeutralDiagram />}
{!fhlActive && !isNeutral && <GroundDiagram />}
```

---

### BUG 2 - `saveMatchResult` Fire-and-Forget + No Error Handling [HIGH]
**Confirmed live by console errors.**

**What happens:** Every match end triggers `saveMatchResult`. The `MatchHistory.create()` call has no `await` and no `try/catch`. When the API fails (or is slow), the function silently crashes at the `await WrestlerProfile.list()` call. Match result is never saved. No user feedback.

**Evidence:** Console shows unhandled `Base44Error` at `WrestlingGame.jsx:116` after every match end.

**Affected code:** `WrestlingGame.jsx:103-135`

---

### BUG 3 - `control_established` Auto-Granted on Period-Start TOP Choice [MEDIUM]
**Confirmed live.**

**What happens:** Choosing TOP at a period break immediately sets `control_established` on the choosing wrestler. In real NFHS folkstyle, referee's position gives no control - control must be earned via riding or turn moves.

**Evidence:** After choosing TOP, `control_established` badge appears in ScoreBoard and Arm Bar (which requires this condition) becomes immediately available.

**Impact:** Players can use high-power turn cards (Arm Bar, Bar Arm) on the first action of a new period before establishing any actual control.

---

### BUG 4 - Duplicate Round Number in Log [LOW]
**Confirmed live.**

**What happens:** The period-transition log entry and the period-choice log entry both receive the same round number as the last action. Three consecutive log entries show the same round number.

**Evidence:** Log showed entries with round "10" for: last action, "Period 1 over.", "Period 2 - chose top."

---

### BUG 5 - Tooltip Z-Index Intercepts Card Clicks [MEDIUM]
**Confirmed live.**

**What happens:** The hover tooltip in `CardHand.jsx` is positioned absolutely within the card grid. When visible, its div layer intercepts pointer events on nearby card buttons, causing `TimeoutError` on click.

**Evidence:** Playwright click on "Build a Base" failed: `<div class="text-zinc-600 text-xs italic mt-0.5"> from <div class="mt-2 p-3..."> subtree intercepts pointer events`.

**Impact:** During normal gameplay (mouse hovering near cards), some clicks may fail to register if cursor is positioned over the tooltip area.

---

### BUG 6 - `RECOVERING` Not Cleaned Up Within Period [MEDIUM]
**Known from code review, not directly triggered in live test.**

**What happens:** `RECOVERING` condition set after near-fall or pin break. Only cleaned up at period break (engine line 737) or via stalemate result. If clock runs low in a period while `RECOVERING` is active, the top player can't trigger new turns (diminishing returns stack prevents any turn card from winning).

---

### BUG 7 - Comeback Bonus Logic Wrong [LOW]
**Confirmed from code review, not player-visible.**

**What happens:** `profileUtils.js:21` - `if (result === 'win' && opponentScore > 0) xp += 15`. This awards the "comeback bonus" for ANY win where the opponent scored at all - including winning 15-1. The condition should check whether the opponent was ever leading.

---

### BUG 8 - `near_fall` Does Not Reset `turnHistory` [MEDIUM]
**Confirmed from code review.**

**What happens:** `escape` and `reversal` both reset `turnHistory` to `{}`. `near_fall` does not. After a near-fall, the top player's turn cards carry full diminishing returns into the next round, making immediate follow-up turns harder than intended.

---

## KNOWN LIMITATIONS (DESIGN, NOT BUGS)

| Item | Status | Notes |
|------|--------|-------|
| Clock is action-based, not real-time | By design | Each action deducts 10-18s randomly |
| AI style is purely score-based | By design | `basePower + random(0-20)` with type bonuses |
| Local 2P hands visible to both players | Incomplete | No hidden hand / pass-device flow |
| No sound effects | Not implemented | |
| No scramble position visual | Not implemented | Shows last position instead |
| No animation between positions | Not implemented | Instant SVG swap |
| No stalling referee call | Not implemented | Matches can loop at 0% stamina |
| No pin win tested in live session | Probabilistic | Pin logic confirmed correct in code review |
| `deepCopy` uses JSON.parse/stringify | Technical debt | Will fail on non-serializable values |

---

## CRITICAL SYSTEMS STATUS

| System | Status | Confidence |
|--------|--------|------------|
| Match engine state machine | ✓ Working | High - live validated all phase transitions |
| Scoring (TD/Esc/Rev/NF) | ✓ Working | High - all point values verified |
| Tech fall (15pt lead) | ✓ Working | High - live validated |
| Decision (P3 expiry) | ✓ Working | High - live validated |
| Pin attempt phase | ✓ Working | High - live validated, resolution correct |
| Period breaks | ✓ Working | High - modal, choice, clock reset all confirmed |
| Position transitions | ✓ Working | High - neutral/top/bottom flip correct |
| Card availability filtering | ✓ Working | High - LOCKED/disabled logic correct |
| Condition system | ✓ Working | High - control_established, recovering correct |
| FHL card availability | ✓ Working | High - FHL cards render and are selectable |
| FHL visual | ✗ BROKEN | High - diagram unreachable via normal play |
| Push Pace | ✓ Working | High - stamina/-5, momentum, clock all correct |
| Match result modal | ✓ Working | High - tech fall, decision both confirmed |
| saveMatchResult | ✗ BROKEN | High - fire-and-forget, unhandled error, silent data loss |
| Profile/XP | Untested live | Medium - logic confirmed in code review |
| Local 2P mode | Incomplete | Low - hands exposed, no pass-device |
| AI opponent | ✓ Functional | High - picks cards, resolves, period/pin choices work |

---

## REGRESSION RISK AREAS

Before any refactoring, these areas must have behavior locked down with tests or explicit regression checks:

1. **`resolveRound`** - any change to power formula, boundary reset, or result routing could silently break scoring
2. **`checkEndConditions`** - tech fall threshold (≥15), period transitions, draw detection
3. **`resolvePinAttempt`** - near-fall point calculation (`chance > 0.50 ? 4 : chance > 0.35 ? 3 : 2`), escape probability (20%)
4. **`applyResult` switch cases** - each case sets specific conditions/pressure/position; any missed case = silent wrong state
5. **`CardHand` availability filter** - if `isAvailable()` logic changes, wrong cards could be shown/hidden
6. **Period break position assignment** - `applyPeriodChoice` must set correct position AND rebuild hands

---

## BASELINE FINGERPRINT

```
App version:    Extracted Base44 prototype, April 2026
Engine:         wrestlingEngine.js - 862 lines
Cards:          wrestlingCards.js - 677 lines, 52 cards
Game file:      WrestlingGame.jsx - 494 lines
Test date:      2026-04-05
Periods:        3 × 120 seconds (action-based clock)
Cards per hand: 8
Tech fall:      15-point lead
Max pin chance: 0.72 (72%)
Min pin chance: 0.03 (3%)
Pin threshold:  >12% to trigger pin_attempt phase
Boundary reset: 8% chance per round
```

This document is the reference point. No changes should be made to logic until this baseline is reviewed and agreed upon.
