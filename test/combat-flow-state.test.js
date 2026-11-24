import test from "node:test";
import assert from "node:assert/strict";

import { combatAssumptionsFromSave } from "../src/combat-assumptions.js";
import { simulateFight } from "../src/combat.js";

const player = {
  id: "player",
  maxHp: 100,
  attack: 100,
  attackSpeed: 1000,
  accuracy: 100,
  minDamage: 100,
  maxDamage: 100,
};

const fastEnemy = {
  id: "known_target",
  name: "Known Target",
  maxHp: 100,
  attack: 100,
  attackSpeed: 800,
  accuracy: 100,
  minDamage: 100,
  maxDamage: 100,
};

test("combat assumptions extract Flow State and known glossary targets from saves", () => {
  const assumptions = combatAssumptionsFromSave({
    state: {
      fundamentals: {
        timeAcceleration: 2,
        flowStateLevel: 40,
      },
      autoRetryActive: true,
      glossaryUnlocks: ["known_target", "other_target"],
    },
  });

  assert.equal(assumptions.combatSpeedMultiplier, 2);
  assert.equal(assumptions.flowStateActive, true);
  assert.equal(assumptions.flowStateLevel, 40);
  assert.deepEqual(assumptions.flowStateKnownTargetIds, ["known_target", "other_target"]);
});

test("Flow State speeds only the first player attack against known glossary targets", () => {
  const withoutFlowState = simulateFight({
    rng: () => 0,
    player,
    enemy: fastEnemy,
    maxSeconds: 2,
    assumptions: {
      flowStateActive: true,
      flowStateLevel: 50,
      flowStateKnownTargetIds: ["other_target"],
    },
  });

  const withFlowState = simulateFight({
    rng: () => 0,
    player,
    enemy: fastEnemy,
    maxSeconds: 2,
    assumptions: {
      flowStateActive: true,
      flowStateLevel: 50,
      flowStateKnownTargetIds: ["known_target"],
    },
  });

  assert.equal(withoutFlowState.winner, "enemy");
  assert.equal(withoutFlowState.seconds, fastEnemy.attackSpeed / 1000);
  assert.equal(withFlowState.winner, "player");
  assert.equal(withFlowState.seconds, player.attackSpeed * 0.5 / 1000);
});

test("Steam first-attack advantage belongs to a confirmed fight or a recent automatic repeat", () => {
  const state = { autoRetryActive: true, autoRetryUnlocked: true, lastEnemyId: "known_target",
    glossaryUnlocks: ["known_target", "other"], fundamentals: { flowStateLevel: 40 }, combatState: { lastVictory: null } };
  const save = { meta: { profile: "steam", savedAt: 10000 }, state };
  const winner = (id = "known_target") => simulateFight({ rng: () => 0, player,
    enemy: { ...fastEnemy, id }, maxSeconds: 2, assumptions: combatAssumptionsFromSave(save) }).winner;
  assert.equal(winner(), "enemy");
  state.combatState.lastVictory = { enemyId: "known_target", time: 5000 };
  assert.equal(winner(), "enemy");
  state.combatState.lastVictory.time++;
  assert.equal(winner(), "player");
  assert.equal(winner("other"), "enemy");
  state.challengeCooldownUntil = 10100;
  assert.equal(winner(), "enemy");
  Object.assign(state.combatState, { isFighting: true, isInFlowState: true, enemyId: "other" });
  assert.equal(winner("other"), "player");
  assert.equal(winner(), "enemy");
});
