// ─── Career Decisions - Between-Event Choices ───────────────────────────────
// Roughly 2-4 times per season, after a non-championship event, the player
// gets a decision modal with 2 choices. Effects can be:
//   - permanent stat point grant (rare, +1)
//   - temporary buff/debuff for next match (tempBuffs[])
//   - skill XP (small)
//   - rival promotion / opponent scout
//   - risk: probabilistic outcome
//
// All events are family-friendly. No drugs, no alcohol, no actual cheating.

// Each decision has TWO choices; the player must pick one (or skip - defaults
// to no effect). Effect objects are interpreted in applyDecisionChoice and
// are intentionally simple JSON so they roundtrip Firestore cleanly.
const ALL_DECISIONS = [
  {
    id: 'extra_practice',
    headline: 'End of Practice',
    flavor: "Coach's gone home. The room's quiet. You could stay another hour and drill, or call it.",
    choices: [
      { id: 'stay',  label: 'Stay an extra hour', detail: '+1 TEC permanent', effect: { kind: 'stat_point', stat: 'tec', amount: 1 } },
      { id: 'leave', label: 'Head home, play video games', detail: '+5% stamina next match', effect: { kind: 'tempBuff', buff: { sourceId: 'extra_practice_leave', type: 'stamina_restore', amount: 0.05, label: '+5% stamina', duration: 1, debuff: false } } },
    ],
  },
  {
    id: 'big_test',
    headline: 'Big Test Tomorrow',
    flavor: 'Math test you forgot about. You can study, or watch wrestling film all night.',
    choices: [
      { id: 'study', label: 'Study, skip film', detail: 'No risk', effect: { kind: 'noop' } },
      { id: 'film',  label: 'Watch film all night',
        detail: '+1 TEC, 30% chance tired next match',
        effect: { kind: 'compound', steps: [
          { kind: 'stat_point', stat: 'tec', amount: 1 },
          { kind: 'risk', chance: 0.3, then: { kind: 'tempBuff', buff: { sourceId: 'big_test_film_risk', type: 'stat_boost_all', amount: -1, duration: 1, label: 'Tired (-1 all)', debuff: true } } },
        ] },
      },
    ],
  },
  {
    id: 'kids_clinic',
    headline: 'Local Kids Clinic',
    flavor: 'A youth coach asks if you can help run drills at the elementary school clinic Saturday.',
    choices: [
      { id: 'volunteer', label: 'Volunteer to coach', detail: '+1 GRT permanent', effect: { kind: 'stat_point', stat: 'grt', amount: 1 } },
      { id: 'rest',      label: 'Take the day off',  detail: 'Restore 10% stamina', effect: { kind: 'tempBuff', buff: { sourceId: 'kids_clinic_rest', type: 'stamina_restore', amount: 0.10, label: '+10% stamina', duration: 1, debuff: false } } },
    ],
  },
  {
    id: 'open_freestyle',
    headline: 'Saturday Open',
    flavor: 'There\'s a freestyle open across town. Different ruleset, but mat time is mat time.',
    choices: [
      { id: 'go',   label: 'Wrestle freestyle for fun',
        detail: '60% chance +1 SPD',
        effect: { kind: 'risk', chance: 0.6, then: { kind: 'stat_point', stat: 'spd', amount: 1 } },
      },
      { id: 'rest', label: 'Rest', detail: 'No effect', effect: { kind: 'noop' } },
    ],
  },
  {
    id: 'team_movie',
    headline: 'Team Movie Night',
    flavor: 'The team\'s going to see the new sports movie tonight.',
    choices: [
      { id: 'go',   label: 'Bond with the team', detail: '+1 SPD next match', effect: { kind: 'tempBuff', buff: { sourceId: 'team_movie_go', type: 'stat_boost', stat: 'spd', amount: 1, duration: 1, label: 'Team chemistry (+1 SPD)', debuff: false } } },
      { id: 'lift', label: 'Stay home and lift',
        detail: '50% chance +1 STR',
        effect: { kind: 'risk', chance: 0.5, then: { kind: 'stat_point', stat: 'str', amount: 1 } },
      },
    ],
  },
  {
    id: 'team_pizza',
    headline: 'Pizza With the Team',
    flavor: "Team's hitting the local pizza place after practice. You're a few pounds over.",
    choices: [
      { id: 'eat',  label: 'Eat pizza with the team', detail: '-3% stamina next match', effect: { kind: 'tempBuff', buff: { sourceId: 'team_pizza_eat', type: 'stamina_restore', amount: -0.03, label: 'Heavy stomach (-3% stamina)', duration: 1, debuff: true } } },
      { id: 'skip', label: 'Stick to your meal plan', detail: 'No effect', effect: { kind: 'noop' } },
    ],
  },
  {
    id: 'wrestling_camp',
    headline: 'Camp Invite',
    flavor: 'A college coach invited you to an elite week-long camp. Conflicts with the family vacation.',
    choices: [
      { id: 'camp',     label: 'Go to the elite camp', detail: '+2 to a random stat', effect: { kind: 'stat_point_random', amount: 2 } },
      { id: 'vacation', label: 'Family vacation', detail: '+1 GRT, full stamina',
        effect: { kind: 'compound', steps: [
          { kind: 'stat_point', stat: 'grt', amount: 1 },
          { kind: 'tempBuff', buff: { sourceId: 'wrestling_camp_vacation', type: 'stamina_restore', amount: 1.0, label: 'Refreshed', duration: 1, debuff: false } },
        ] },
      },
    ],
  },
  {
    id: 'heavy_lift',
    headline: 'Max Squat Day',
    flavor: 'Your strength coach is hyped. He wants you to push your max today.',
    choices: [
      { id: 'max',  label: 'Push your max squat',
        detail: '+1 STR, 20% injury (miss next match)',
        effect: { kind: 'compound', steps: [
          { kind: 'stat_point', stat: 'str', amount: 1 },
          { kind: 'risk', chance: 0.2, then: { kind: 'tempBuff', buff: { sourceId: 'heavy_lift_risk', type: 'stat_boost_all', amount: -2, duration: 1, label: 'Tweaked back (-2 all)', debuff: true } } },
        ] },
      },
      { id: 'cardio', label: 'Light cardio instead', detail: '+1 END safe', effect: { kind: 'stat_point', stat: 'end', amount: 1 } },
    ],
  },
  {
    id: 'social_media',
    headline: 'Social Media Beef',
    flavor: 'A rival posted a photo of his arm raised at last year\'s state finals. Captioned "next year too."',
    choices: [
      { id: 'callout', label: 'Call him out publicly',
        detail: '+1 STR next match, but he\'ll remember',
        effect: { kind: 'compound', steps: [
          { kind: 'tempBuff', buff: { sourceId: 'social_media_callout', type: 'stat_boost', stat: 'str', amount: 1, duration: 1, label: 'Fired up (+1 STR)', debuff: false } },
          { kind: 'flag', flag: 'mediaBeefRival', value: true },
        ] },
      },
      { id: 'quiet',   label: 'Stay humble', detail: 'No effect', effect: { kind: 'noop' } },
    ],
  },
  {
    id: 'late_film',
    headline: 'Scout Your Next Opponent',
    flavor: 'You found film of your next opponent online. It\'s 1am.',
    choices: [
      { id: 'study', label: 'Pull an all-nighter',
        detail: '+1 TEC, -4% stamina next match',
        effect: { kind: 'compound', steps: [
          { kind: 'tempBuff', buff: { sourceId: 'late_film_study_tec', type: 'stat_boost', stat: 'tec', amount: 1, duration: 1, label: 'Film study (+1 TEC)', debuff: false } },
          { kind: 'tempBuff', buff: { sourceId: 'late_film_study_tired', type: 'stamina_restore', amount: -0.04, label: '-4% stamina (tired)', duration: 1, debuff: true } },
        ] },
      },
      { id: 'sleep', label: 'Sleep on it', detail: '+10% stamina', effect: { kind: 'tempBuff', buff: { sourceId: 'late_film_sleep', type: 'stamina_restore', amount: 0.10, label: '+10% stamina', duration: 1, debuff: false } } },
    ],
  },
  {
    id: 'partner_injured',
    headline: 'Practice Partner Hurt',
    flavor: 'Your usual drilling partner is sidelined. Coach asks if you can drill with the JV today.',
    choices: [
      { id: 'help', label: 'Drill with the JV', detail: '+1 GRT permanent', effect: { kind: 'stat_point', stat: 'grt', amount: 1 } },
      { id: 'rest', label: 'Rest your body',  detail: 'Restore stamina', effect: { kind: 'tempBuff', buff: { sourceId: 'partner_injured_rest', type: 'stamina_restore', amount: 0.10, label: '+10% stamina', duration: 1, debuff: false } } },
    ],
  },
  {
    id: 'state_fair',
    headline: 'State Fair Junk Food',
    flavor: 'Your buddies are dragging you to the state fair. There\'s a deep-fried twinkie calling your name.',
    choices: [
      { id: 'eat',  label: 'Eat the fried twinkie',
        // Career Depth Pass v1: forfeit_next is not consumed anywhere; convert
        // the missed-weight consequence to a real -3 all stat debuff next match.
        // Full forfeit handling is deferred to a later pass.
        detail: '50% chance you miss weight (-3 all stats next match)',
        effect: { kind: 'risk', chance: 0.5, then: { kind: 'tempBuff', buff: { sourceId: 'state_fair_missed_weight', type: 'stat_boost_all', amount: -3, duration: 1, label: 'Missed weight (-3 all)', debuff: true } } },
      },
      { id: 'skip', label: 'Skip it, ride the rides', detail: 'No effect', effect: { kind: 'noop' } },
    ],
  },
  {
    id: 'mismatch_practice',
    headline: 'Heavyweight Matchup',
    flavor: 'The heavyweight needs a partner today. Way over your weight class.',
    choices: [
      { id: 'wrestle', label: 'Wrestle the heavyweight',
        detail: '30% +1 STR / 40% mild injury / 30% nothing',
        effect: { kind: 'risk_table', table: [
          { chance: 0.3, then: { kind: 'stat_point', stat: 'str', amount: 1 } },
          { chance: 0.4, then: { kind: 'tempBuff', buff: { sourceId: 'mismatch_practice_risk', type: 'stat_boost_all', amount: -1, duration: 1, label: 'Bruised (-1 all)', debuff: true } } },
          { chance: 0.3, then: { kind: 'noop' } },
        ] },
      },
      { id: 'stay',    label: 'Stay at your weight', detail: 'No effect', effect: { kind: 'noop' } },
    ],
  },
  {
    id: 'recruit_visit',
    headline: 'Recruiting Visit',
    flavor: 'A top-5 college coach is visiting your high school next week.',
    choices: [
      { id: 'visit', label: 'Take the visit', detail: '+1 GRT for 3 matches', effect: { kind: 'tempBuff', buff: { sourceId: 'recruit_visit', type: 'stat_boost', stat: 'grt', amount: 1, duration: 3, label: 'Destination motivation (+1 GRT)', debuff: false } } },
      { id: 'focus', label: 'Stay focused on now', detail: '+1 GRT permanent on 50%', effect: { kind: 'risk', chance: 0.5, then: { kind: 'stat_point', stat: 'grt', amount: 1 } } },
    ],
  },
  {
    id: 'mentor_freshman',
    headline: 'Freshman Wrestler',
    flavor: "There's a kid on the team who's struggling. He looks up to you. Coach asks you to mentor him.",
    choices: [
      { id: 'mentor', label: 'Mentor him', detail: '+1 GRT permanent', effect: { kind: 'stat_point', stat: 'grt', amount: 1 } },
      { id: 'self',   label: 'Focus on yourself', detail: 'No effect', effect: { kind: 'noop' } },
    ],
  },
];

const DECISION_PROBABILITY = 0.4; // 40% chance to roll one after each non-championship event

/**
 * Roll a decision event for the player. Returns null if the random check
 * doesn't fire OR if there are no eligible events. Eligibility is just
 * "any from ALL_DECISIONS" for v1 - future versions can filter by tier
 * or recently-shown ids.
 *
 * @param {{ rng?: () => number, recentIds?: string[] }} [opts]
 */
export function rollDecisionEvent({ rng = Math.random, recentIds = [] } = {}) {
  if (rng() >= DECISION_PROBABILITY) return null;
  const eligible = ALL_DECISIONS.filter(d => !recentIds.includes(d.id));
  if (eligible.length === 0) return null;
  const pick = eligible[Math.floor(rng() * eligible.length)];
  return pick;
}

/**
 * Apply a chosen effect to a wrestler. Returns a new wrestler. Compound and
 * risk effects are resolved here so the persisted wrestler reflects the
 * deterministic outcome of any RNG already rolled.
 *
 * @param {object} wrestler
 * @param {object} effect
 * @param {() => number} [rng]
 * @returns {{ wrestler: object, applied: Array<{ summary: string }> }}
 */
export function applyEffect(wrestler, effect, rng = Math.random) {
  let w = wrestler;
  const applied = [];
  if (!effect) return { wrestler: w, applied };

  function apply(eff) {
    if (!eff) return;
    switch (eff.kind) {
      case 'noop':
        applied.push({ summary: 'No effect' });
        break;
      case 'stat_point': {
        const cur = w.statPointsAvailable || 0;
        w = { ...w, statPointsAvailable: cur + (eff.amount || 1) };
        applied.push({ summary: `+${eff.amount || 1} stat point (target ${eff.stat?.toUpperCase() || 'stat'})` });
        break;
      }
      case 'stat_point_random': {
        const cur = w.statPointsAvailable || 0;
        w = { ...w, statPointsAvailable: cur + (eff.amount || 1) };
        applied.push({ summary: `+${eff.amount || 1} stat point (random)` });
        break;
      }
      case 'tempBuff': {
        const buffs = Array.isArray(w.tempBuffs) ? w.tempBuffs : [];
        const buff = { ...eff.buff, duration: eff.buff?.duration ?? 1 };
        w = { ...w, tempBuffs: [...buffs, buff] };
        applied.push({ summary: buff.label || 'Buff applied' });
        break;
      }
      case 'flag': {
        w = { ...w, [eff.flag]: eff.value };
        applied.push({ summary: `Flag ${eff.flag}` });
        break;
      }
      case 'compound': {
        for (const step of eff.steps || []) apply(step);
        break;
      }
      case 'risk': {
        if (rng() < (eff.chance ?? 0)) {
          apply(eff.then);
        } else {
          applied.push({ summary: 'Lucky - no penalty' });
        }
        break;
      }
      case 'risk_table': {
        let r = rng();
        for (const row of eff.table || []) {
          if (r < (row.chance ?? 0)) {
            apply(row.then);
            return;
          }
          r -= (row.chance ?? 0);
        }
        // Nothing matched - noop.
        applied.push({ summary: 'No effect' });
        break;
      }
      default:
        // Unknown effect kind - log but don't crash.
        applied.push({ summary: `Unknown effect: ${eff.kind}` });
    }
  }

  apply(effect);
  return { wrestler: w, applied };
}

/**
 * Apply a chosen decision to the wrestler and bookkeep the recent-events
 * list so the same headline doesn't appear two events in a row.
 *
 * @param {object} career
 * @param {object} decision  the rolled decision (from rollDecisionEvent)
 * @param {string} choiceId
 * @param {() => number} [rng]
 * @returns {{ career: object, applied: Array<{summary: string}> }}
 */
export function applyDecisionChoice(career, decision, choiceId, rng = Math.random) {
  const choice = decision?.choices?.find(c => c.id === choiceId);
  if (!choice) return { career, applied: [] };
  const out = applyEffect(career.wrestler, choice.effect, rng);
  const recent = Array.isArray(career.recentDecisionIds) ? career.recentDecisionIds : [];
  return {
    career: {
      ...career,
      wrestler: out.wrestler,
      pendingDecision: null,
      recentDecisionIds: [decision.id, ...recent.slice(0, 4)],
    },
    applied: out.applied,
  };
}

export const DECISION_EVENTS = ALL_DECISIONS;
export { DECISION_PROBABILITY };
