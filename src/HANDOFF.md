# Folkstyle Wrestling Simulator - Handoff Document
**Date:** April 2026  
**Platform:** Base44 (React + Vite + Tailwind)  
**Status:** Functional prototype - ready for extraction to full development

---

## 1. PROJECT OVERVIEW

### What is this?
A turn-based card game simulating USA folkstyle wrestling (NFHS rules). Two wrestlers face off over 3 periods, selecting moves from a hand of cards each turn. The engine resolves card clashes via a weighted power formula, tracks match state, and awards points for takedowns, escapes, reversals, near-falls, and pins.

### Current State
- **Working well:** Core turn resolution, scoring, pin attempt phase, period breaks, AI opponent, profile/XP system, match history, front headlock move tree, stamina and momentum mechanics, card hand system
- **Playable end-to-end:** Yes - full 3-period match with all win conditions (pin, tech fall, decision, draw)
- **Visual state:** Functional SVG position diagrams (neutral, top/bottom, front headlock). Not polished character art but positionally clear.
- **Known weaknesses:** See Section 3

---

## 2. CORE GAMEPLAY SYSTEMS

### Scoring (NFHS Folkstyle)
| Action | Points |
|--------|--------|
| Takedown | 3 |
| Escape | 1 |
| Reversal | 2 |
| Near Fall (2-count) | 2 |
| Near Fall (3-count) | 3 |
| Near Fall (4-count) | 4 |
| Tech Fall | Win (15-pt lead) |
| Pin | Immediate win |

### Match States (phase)
- `playing` - normal card selection loop
- `pin_attempt` - dedicated pin mini-phase (attacker picks offense, defender picks defense)
- `period_break` - period ended; eligible player picks starting position
- `finished` - match over

### Move Categories
| Category | When Available |
|----------|---------------|
| `neutral_attack` | Neutral position |
| `neutral_counter` | Neutral position |
| `top_control` | Top position only |
| `top_turns` | Top position + specific conditions |
| `bottom` | Bottom position only |
| `special` | Condition-gated |

### Conditions System
Conditions gate move availability and affect power calculations:
- `control_established` - standard top control
- `broken_down` - opponent flattened, enables advanced turns
- `top_pressure` - sustained pressure, enables turk moves
- `front_headlock_control` - enables full FHL move tree
- `recovering` - opponent is fatigued from turn attempts; bottom gets defensive bonus

### Pin System
Triggered when a PIN_ELIGIBLE card wins a near-fall result AND computed pin chance > 12%.

**Pin chance formula:**
```
base (move-specific: 0.10-0.42)
× control multiplier (×1.3 if control_established, ×1.4 if top_pressure)
+ pressure bonus (pressure/100 × 0.15)
+ stamina advantage (diff/100 × 0.12)
+ near-fall depth bonus (+0.06 for 3-count, +0.12 for 4-count)
- defensive resistance (built by successful pin defenses × 0.04)
```
Clamped to [0.03, 0.72].

**Pin resolution:**
- Offense picks: Lock Position (+0.12), Adjust Pressure (+0.06), Finish Pin (+0.18)
- Defense picks: Bridge (−0.22), Roll Through (−0.16), Fight Hands (−0.12)
- On success → PIN, match ends
- On fail (80% chance) → near-fall points awarded (2/3/4 based on danger level), stay on top/bottom
- On fail (20% chance) → defender escapes to neutral

### Front Headlock Move Tree
Requires `front_headlock_control` condition (set by `front_headlock` card):
- `fhl_go_behind` - takedown
- `fhl_knee_tap` - takedown
- `fhl_whipover` - takedown
- `fhl_cement_mixer` - takedown
- `fhl_gator_roll` - near-fall (pin eligible)
- `fhl_snap_spin` - takedown

### AI Behavior
Simple scoring-based card picker:
- Scores each card by `basePower + random(0-20)`
- Bonuses: +18 near-fall, +15 takedown, +12 reversal, +10 escape, +14 FHL control, +10 pin-eligible, +20 FHL branch
- Penalizes high-stamina cards when AI stamina < 40
- Period choice: 50% top, 30% bottom, 20% neutral
- Pin offense: picks highest bonus card
- Pin defense: picks highest resistance card

### Progression System
File: `lib/profileUtils.js`
- XP per match: 50 base, +100 win, +30 draw, +60 pin win, +40 tech fall win
- Close match bonus (+25), comeback bonus (+15)
- 200 XP per level
- Titles: Beginner → Cadet → Varsity → All-State → All-American → National Champion → Legend
- Data stored in `WrestlerProfile` entity (1 profile per user)
- Match history stored in `MatchHistory` entity

---

## 3. KNOWN BUGS & WEAKNESSES

### Active Issues
1. **FHL position visual bug:** The `front_headlock` card sets `front_headlock_control` as a condition on the attacker - but the attacker is in `neutral` position. The `WrestlerVisual` checks `isNeutral` first, so FHL visual only shows when `!isNeutral`. If both wrestlers stay neutral during FHL, the FHL diagram never renders. **Fix needed:** Either move wrestlers to a pseudo-position during FHL, or check condition regardless of position.

2. **Near-fall stays in top/bottom after pin break:** The post-pin-break state now correctly leaves both wrestlers on top/bottom. However, the bottom wrestler's conditions (RECOVERING) may persist longer than intended if the clock runs low, leading to a "stuck" board state where the top wrestler can't trigger new turns.

3. **AI is too predictable:** The AI always picks near-fall > takedown. A good human player can bait pin attempts and exploit the predictable pattern. Needs a randomized "style" system.

4. **Boundary reset ignores top/bottom preservation:** When `hadControl` is true, the log says "return to referee position" but the code does NOT reset positions - it only resets pressure. This means positions technically persist, which is correct - but the UI may confuse players who expect a visual reset. Add explicit messaging.

5. **Local 2P mode is untested:** Card hands render for both players but the turn-timing logic (AI timer) is skipped. The resolution loop works, but there's no "hidden hand" for P2 in local mode - both players can see each other's card choices. No fix implemented.

### Visual Weaknesses
- SVG wrestler diagrams are functional but not polished. They clearly communicate position (top/bottom/neutral) but are not attractive enough for a final game.
- FHL diagram overlap between attacker arm paths can look noisy at small sizes.
- No scramble position visual (scramble just shows the previous position).
- No animation between positions - just instant SVG swap.

### Technical Shortcuts
- Match clock uses `10 + random(8)` seconds per action - not tied to real time. Fast pacing is intentional but can feel random.
- No "stalemate" referee call system - the game can theoretically run infinitely if both players always draw.
- `deepCopy` uses `JSON.parse(JSON.stringify())` - fine for current data shapes, but breaks if any values become non-serializable.

---

## 4. RECOMMENDED NEXT STEPS FOR CLAUDE CODE

### Rebuild First
1. **Wrestler visuals** - Use a proper animation library (Framer Motion or Lottie) with hand-crafted wrestling silhouettes. The SVG approach works but needs a dedicated designer pass.
2. **AI system** - Replace the scoring heuristic with a proper state-space evaluation that considers score differential, time remaining, and stamina trends.
3. **Sound effects** - Critical for game feel. Even 3-4 sounds (takedown, near-fall, pin, whistle) would improve the experience dramatically.

### Keep As-Is
- Card definitions in `wrestlingCards.js` - clean, well-structured, easy to extend
- Match engine state machine in `wrestlingEngine.js` - solid foundation
- Profile/XP system - correct and extensible
- Period choice modal - works well
- Score display - clear and accurate

### Improve
- Expand card library: more neutral moves, trap moves, scramble moves
- Add referee calls: stalling, injury timeout, out of bounds reset with score consequences
- Add "style" variance to AI: aggressive, defensive, grinding styles
- Local 2P: implement hidden hand with "pass device" prompt between turns
- Add replay/log export

### Replace Entirely
- The `buildHand` shuffle function - currently gives 8 random cards from all eligible. Should be a proper draft/deck system with hand management between turns.
- The clock system - should be real-time with a pause option, not action-based approximation.

---

## 5. FILE / COMPONENT MAP

### Pages
| File | Purpose |
|------|---------|
| `pages/WrestlingGame.jsx` | Main game controller - all state, AI timers, phase routing |
| `pages/Profile.jsx` | Player profile, XP, level, match history |

### Components - Wrestling
| File | Purpose |
|------|---------|
| `components/wrestling/MainMenu.jsx` | Start screen, mode/name selection, rules |
| `components/wrestling/ScoreBoard.jsx` | Live score, clock, period, stamina bars |
| `components/wrestling/MatView.jsx` | Position text display + chain/initiative indicators |
| `components/wrestling/WrestlerVisual.jsx` | SVG positional diagrams (neutral/top-bottom/FHL) |
| `components/wrestling/CardHand.jsx` | Card grid with hover tooltip, availability filtering |
| `components/wrestling/MatchLog.jsx` | Scrolling action history |
| `components/wrestling/PeriodChoiceModal.jsx` | Period 2/3 position selection modal |
| `components/wrestling/PinAttemptModal.jsx` | Pin mini-phase modal |
| `components/wrestling/MatchResultModal.jsx` | End-of-match result screen |

### Library / Logic
| File | Purpose |
|------|---------|
| `lib/wrestlingEngine.js` | Match engine: state machine, round resolution, pin logic, AI, period transitions |
| `lib/wrestlingCards.js` | All card definitions, position constants, score constants |
| `lib/profileUtils.js` | XP calculation, level system, rank titles |

---

## 6. DATA MODEL SUMMARY

### WrestlerProfile Entity
```json
{
  "username": "string",
  "wins": "number",
  "losses": "number",
  "draws": "number",
  "pins": "number",
  "tech_falls": "number",
  "total_points": "number",
  "xp": "number",
  "level": "number"
}
```
One record per user. Updated after each match.

### MatchHistory Entity
```json
{
  "player_name": "string",
  "opponent_name": "string",
  "result": "win|loss|draw",
  "win_method": "pin|tech_fall|decision|draw",
  "player_score": "number",
  "opponent_score": "number",
  "periods": "number",
  "notable_events": ["array of strings"],
  "xp_earned": "number",
  "game_mode": "vs_ai|local"
}
```

### Card Data (in-memory, lib/wrestlingCards.js)
```js
{
  id: string,
  name: string,
  category: 'neutral_attack'|'neutral_counter'|'top_control'|'top_turns'|'bottom'|'special',
  position: 'neutral'|'top'|'bottom',
  staminaCost: number,       // 8-26
  basePower: number,         // 50-80
  counters: string[],        // card IDs this card beats
  setupRequired: string[],   // CONDITIONS that must be active
  scoreEffect: {
    type: 'takedown'|'escape'|'reversal'|'near_fall'|'control'|'counter'|'setup',
    points?: number,
    setsCondition?: string,
  },
  description: string,
  flavor: string,
}
```

### Live Match State (in-memory)
```js
{
  phase: 'playing'|'pin_attempt'|'period_break'|'finished',
  period: 1|2|3,
  clock: number,             // seconds remaining
  roundNumber: number,
  p1: WrestlerState,
  p2: WrestlerState,
  p1Conditions: string[],
  p2Conditions: string[],
  pressure: { p1OnP2: number, p2OnP1: number },  // 0-100
  initiative: 'p1'|'p2',
  momentum: 'p1'|'p2'|'neutral',
  chainActive: boolean,
  lastResult: ResultObject,
  log: LogEntry[],
  winner: 'p1'|'p2'|'draw'|null,
  winMethod: 'pin'|'tech_fall'|'decision'|'draw'|null,
  periodChoicePending: boolean,
  pendingChoiceFor: 'p1'|'p2'|null,
  turnHistory: { p1: {[cardId]: count}, p2: {[cardId]: count} },
  pinAttempt: PinAttemptState|null,
}
```

---

## 7. TRANSITION CHECKLIST

- [x] Game engine fully separated from UI
- [x] Card definitions separated from engine logic
- [x] Profile/XP logic separated from live gameplay
- [x] All major components split into focused files
- [x] Match states all resolve correctly
- [x] Pin system: awards near-fall on fail, small escape chance
- [x] SVG visuals: positionally clear (not polished)
- [ ] Local 2P hidden hand - NOT implemented
- [ ] Sound - NOT implemented
- [ ] AI style variance - NOT implemented
- [ ] Real-time clock - NOT implemented (action-based approximation only)
- [ ] Scramble visual state - NOT implemented

**Extraction readiness: HIGH**
The logic is clean enough to move into Claude Code as-is. The biggest rebuilds needed are visual (wrestler art) and AI (strategy depth), both of which are well-isolated.