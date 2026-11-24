import assert from "node:assert/strict";
import test from "node:test";
import { createEconomyPlan } from "../src/economy.js";

test("capped speed and damage upgrades have no marginal gain or purchase value", () => {
  const state = { shopLevels: { upgrade_spd_graphite: 25, upgrade_secret_burn_damage_graphite: 2500 } };
  const plan = createEconomyPlan({ state, baseStats: { attackSpeed: 1000, burnDamage: 500 } });
  assert.equal(plan.purchasePlan.capped.length, 2);
  for (const upgrade of plan.purchasePlan.capped) {
    assert.deepEqual(upgrade.marginalEffect, { multiplier: 1, percent: 0 });
    assert.equal(upgrade.marginalStatGain, 0);
    assert.equal(upgrade.score, 0);
    assert.equal(upgrade.roi, 0);
    assert.equal(upgrade.nextLevel, null);
  }
});
