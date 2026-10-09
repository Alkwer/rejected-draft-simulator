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
  assert.equal(withoutFlowState.seconds, 1);
  assert.equal(withFlowState.winner, "player");
  assert.equal(withFlowState.seconds, 0.8);
});
