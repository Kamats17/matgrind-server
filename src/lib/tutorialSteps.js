// src/lib/tutorialSteps.js
//
// Tutorial step definitions - pure data. The component (Tutorial.jsx) reads
// `kind` and renders the matching interactive surface. No engine state is
// constructed here; each interactive step renders the same component the
// live game uses (CardSkillChallenge mechanics, PeriodChoiceModal), so the
// player practices the actual UI.
//
// Adding a step: append to TUTORIAL_STEPS. Tutorial.jsx routes by `kind` -
// only add new kinds if you also handle them in the renderer switch.

export const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    kind: 'intro',
    title: 'Welcome to MatGrind',
    body: [
      'A wrestling card game built around real folkstyle scoring.',
      'Three periods. First to a pin or major lead wins. Otherwise the higher score after period 3 takes it.',
      'Every move you play is decided by two things: which card you pick, and how well you execute the mini-game that follows.',
    ],
  },

  {
    id: 'card_anatomy',
    kind: 'card_anatomy',
    title: 'Reading a Card',
    body: [
      'Each card shows its name, base power, stamina cost, and category. Counters and required setups are listed in the detail view.',
      'Higher power means a better chance of winning the exchange - but you only get the full power if you nail the skill mini-game that runs after you commit.',
    ],
    cardId: 'double_leg',
  },

  {
    id: 'charge',
    kind: 'minigame',
    mechanic: 'charge',
    title: 'Mini-Game: Charge',
    body: [
      'Neutral attacks, throws, and par-terre top moves use Charge.',
      'Press and hold the bar. Release inside the green zone for PERFECT (+8 power). Just outside it is GOOD (+4). Way off is a MISS - your card still plays, but with no bonus.',
    ],
    promptCardName: 'Double Leg',
  },

  {
    id: 'reaction',
    kind: 'minigame',
    mechanic: 'reaction',
    title: 'Mini-Game: Reaction',
    body: [
      'Counter cards (Sprawl, Whizzer, Down Block) use Reaction.',
      'Wait for the whistle. The button turns green - tap as fast as you can. Under 250 ms is PERFECT. Tapping early is a MISS.',
    ],
    promptCardName: 'Sprawl',
  },

  {
    id: 'trace',
    kind: 'minigame',
    mechanic: 'trace',
    title: 'Mini-Game: Trace',
    body: [
      'Top-position turns (Half Nelson, Power Half, Cradles) use Trace.',
      'Two directional arrows appear - swipe each one in the right direction within the window. Both perfect = +8 power and a much better near-fall.',
    ],
    promptCardName: 'Half Nelson',
  },

  {
    id: 'burst',
    kind: 'minigame',
    mechanic: 'burst',
    title: 'Mini-Game: Burst',
    body: [
      'Bottom-position escapes (Stand-Up, Switch, Granby) use Burst.',
      '2-second tap window. 10+ taps = PERFECT, 6-9 = GOOD. Cardio matters - escapes are how you avoid getting ridden out.',
    ],
    promptCardName: 'Stand-Up',
  },

  {
    id: 'period_choice',
    kind: 'period_choice',
    title: 'Choosing Your Position',
    body: [
      'At the start of period 2 you choose where to start: Top, Bottom, or Neutral. Defer hands the choice to your opponent (only available in period 2).',
      'Top is for riders looking to score with turns. Bottom is for fast escapers. Neutral is the safe coin-flip if you trust your takedowns.',
    ],
  },

  {
    id: 'pin',
    kind: 'pin_explainer',
    title: 'Pin Attempts',
    body: [
      'Some top turns trigger a 3-stage pin sequence. The attacker picks an offense card; the defender picks a defense card. Each defense card you spend is burned for the rest of the attempt.',
      'Stage 1 starts at base pin probability. Stages 2 and 3 add pressure as the defender runs out of cards. Survive all 3 stages to escape - get pinned and the match ends instantly.',
    ],
  },

  {
    id: 'stamina',
    kind: 'stamina_explainer',
    title: 'Stamina Management',
    body: [
      'Every card has a stamina cost. Drop below ~120 and fatigue kicks in - your power gets reduced even on PERFECT mini-games.',
      'The END (Endurance) stat lowers stamina costs. Smart wrestlers save their high-cost moves for the moments that decide the match.',
    ],
  },

  {
    id: 'wrap',
    kind: 'wrap',
    title: "You're Ready",
    body: [
      "You know the loop: pick a card, win the mini-game, score points, manage stamina across three periods.",
      'Want more reps? The Skill Drills tab grinds each mini-game in isolation. Moves & Counters lists every card with its counters and matchups.',
      'Time to grind.',
    ],
  },
];

export const TUTORIAL_STORAGE_KEY   = 'matgrind_tutorial_step';
export const TUTORIAL_COMPLETED_KEY = 'matgrind_tutorial_completed';
