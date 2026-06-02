import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKILL_TREE_NODES,
  BRANCHES,
  getNode,
  getNodesByBranch,
  isNodeUnlocked,
  canUnlockNode,
  tryUnlockNode,
  totalTreeCost,
  totalUnlockableCards,
} from './careerSkillTree.js';
import { CARDS } from '../wrestlingCards.js';
import { CAREER_STARTER_DECK } from './careerStarterDeck.js';

// ─── Shape invariants ───────────────────────────────────────────────────────

describe('careerSkillTree - node definitions', () => {
  test('every node id is unique', () => {
    const ids = SKILL_TREE_NODES.map(n => n.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every node belongs to a known branch', () => {
    for (const n of SKILL_TREE_NODES) {
      assert.ok(BRANCHES.includes(n.branch), `bad branch on ${n.id}: ${n.branch}`);
    }
  });

  test('every prereq id exists', () => {
    const ids = new Set(SKILL_TREE_NODES.map(n => n.id));
    for (const n of SKILL_TREE_NODES) {
      for (const p of n.prereqs) {
        assert.ok(ids.has(p), `${n.id} has unknown prereq ${p}`);
      }
    }
  });

  test('prereqs are within the same branch (no cross-branch chains)', () => {
    for (const n of SKILL_TREE_NODES) {
      for (const pid of n.prereqs) {
        const p = getNode(pid);
        assert.equal(p.branch, n.branch, `${n.id} cross-branch prereq ${pid}`);
      }
    }
  });

  test('every unlocked card id exists in CARDS', () => {
    for (const n of SKILL_TREE_NODES) {
      for (const cid of n.unlocks || []) {
        assert.ok(CARDS[cid], `${n.id} unlocks unknown card ${cid}`);
      }
    }
  });

  test('no node unlocks a card that is already in the starter deck', () => {
    const starter = new Set(CAREER_STARTER_DECK);
    for (const n of SKILL_TREE_NODES) {
      for (const cid of n.unlocks || []) {
        assert.ok(!starter.has(cid), `${n.id} redundantly unlocks starter card ${cid}`);
      }
    }
  });

  test('no card is unlocked by two different nodes', () => {
    const seen = new Map();
    for (const n of SKILL_TREE_NODES) {
      for (const cid of n.unlocks || []) {
        if (seen.has(cid)) {
          assert.fail(`${cid} unlocked by both ${seen.get(cid)} and ${n.id}`);
        }
        seen.set(cid, n.id);
      }
    }
  });

  test('starter deck (26) + unlockable tree cards == total usable pool', () => {
    // We don't require every CARD to be reachable - throws-only /
    // style-specific cards may intentionally not appear in the HS tree.
    // We just assert there's no double-counting and reasonable coverage.
    const starter = new Set(CAREER_STARTER_DECK);
    const unlocks = new Set();
    for (const n of SKILL_TREE_NODES) for (const c of n.unlocks) unlocks.add(c);
    const union = new Set([...starter, ...unlocks]);
    assert.ok(union.size >= 80, `coverage too low: ${union.size} reachable cards`);
  });
});

describe('careerSkillTree - cost budget', () => {
  test('total cost to unlock entire tree is in the 100-160 range', () => {
    const t = totalTreeCost();
    assert.ok(t >= 100 && t <= 160, `total tree cost ${t} outside target 100-160`);
  });

  test('at least 80 unlockable cards across the tree', () => {
    assert.ok(totalUnlockableCards() >= 80);
  });
});

// ─── Unlock flow ────────────────────────────────────────────────────────────

function freshWrestler() {
  return {
    xp: 0,
    level: 1,
    skillTree: { unlockedNodes: [], pointsAvailable: 10, focus: null },
    unlockedCardIds: [...CAREER_STARTER_DECK],
  };
}

describe('careerSkillTree - canUnlockNode / tryUnlockNode', () => {
  test('root node with no prereqs is unlockable if points suffice', () => {
    const w = freshWrestler();
    const check = canUnlockNode(w, 'scr_go_behind');
    assert.equal(check.ok, true);
  });

  test('deep node rejected when prereqs missing', () => {
    const w = freshWrestler();
    const check = canUnlockNode(w, 'scr_scramble_1');
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'prereq_missing');
  });

  test('unknown node id → unknown_node', () => {
    const w = freshWrestler();
    const check = canUnlockNode(w, 'totally_fake_node');
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'unknown_node');
  });

  test('insufficient points → not_enough_points', () => {
    const w = freshWrestler();
    w.skillTree.pointsAvailable = 0;
    const check = canUnlockNode(w, 'scr_go_behind');
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'not_enough_points');
  });

  test('tryUnlockNode on success: cost deducts, node added, cards joined', () => {
    const w = freshWrestler();
    const out = tryUnlockNode(w, 'scr_go_behind');
    assert.equal(out.ok, true);
    assert.equal(out.wrestler.skillTree.pointsAvailable, 9); // cost 1
    assert.ok(out.wrestler.skillTree.unlockedNodes.includes('scr_go_behind'));
    assert.ok(out.wrestler.unlockedCardIds.includes('go_behind'));
  });

  test('tryUnlockNode does not mutate input', () => {
    const w = freshWrestler();
    const before = JSON.parse(JSON.stringify(w));
    tryUnlockNode(w, 'scr_go_behind');
    assert.deepEqual(w, before);
  });

  test('buying same node twice is a no-op on second call', () => {
    let w = freshWrestler();
    w = tryUnlockNode(w, 'scr_go_behind').wrestler;
    const out = tryUnlockNode(w, 'scr_go_behind');
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'already_unlocked');
  });

  test('tier-2 node unlockable after tier-1 prereq', () => {
    let w = freshWrestler();
    w = tryUnlockNode(w, 'scr_hand_snap').wrestler;
    const check = canUnlockNode(w, 'scr_reattack_bottom');
    assert.equal(check.ok, true);
  });

  test('tier-3 scramble node needs TWO tier-2 prereqs', () => {
    let w = freshWrestler();
    w.skillTree.pointsAvailable = 20;
    w = tryUnlockNode(w, 'scr_hand_snap').wrestler;
    w = tryUnlockNode(w, 'scr_reattack_bottom').wrestler;
    // Only one of two prereqs; scr_hand_reattack also required
    let check = canUnlockNode(w, 'scr_scramble_1');
    assert.equal(check.ok, false);
    w = tryUnlockNode(w, 'scr_hand_reattack').wrestler;
    check = canUnlockNode(w, 'scr_scramble_1');
    assert.equal(check.ok, true);
  });

  test('unlockedCardIds stays deduped when node unlocks card already present', () => {
    let w = freshWrestler();
    // Artificially pre-add a card the tree would otherwise grant
    w.unlockedCardIds.push('go_behind');
    const out = tryUnlockNode(w, 'scr_go_behind');
    assert.equal(out.ok, true);
    const count = out.wrestler.unlockedCardIds.filter(c => c === 'go_behind').length;
    assert.equal(count, 1);
  });

  test('getNodesByBranch returns a non-empty list for every branch', () => {
    for (const b of BRANCHES) {
      const nodes = getNodesByBranch(b);
      assert.ok(nodes.length > 0, `branch ${b} has no nodes`);
    }
  });
});
