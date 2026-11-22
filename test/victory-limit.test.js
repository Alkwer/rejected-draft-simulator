import test from "node:test";
import assert from "node:assert/strict";
import { applySketchRewards } from "../src/rewards.js";
import { createWebAnalysis } from "../src/web-core.js";

test("direct reward application stops granting repeat rewards at the cap", () => {
  const result = applySketchRewards({
    baseStats: { attack: 100 },
    sketches: { sketch: { rewards: [{ statName: "attack", amount: 100 }] } },
    defeatedIds: ["sketch", "sketch"],
    state: {
      sketchVictories: { sketch: 1 },
      sketchRunVictories: { sketch: 2 },
      fundamentals: { maxVictories: 2, beyondMaxVictories: 1 },
    },
  });

  assert.equal(result.attack, 150);
});

test("web recommendations, assumed rewards and route preview share the game's victory cap", () => {
  const player = { maxHp: 1000, attack: 100, attackSpeed: 100, accuracy: 100, minDamage: 100, maxDamage: 100 };
  const enemy = { maxHp: 20, attack: 1, attackSpeed: 1000 };
  const reward = { statName: "attack", amount: 100 };
  const sketches = {
    capped: { id: "capped", rarity: "opus", stats: enemy, rewards: [reward] },
    open: { id: "open", rarity: "opus", stats: enemy, rewards: [reward] },
    boss: { id: "boss", rarity: "masterpiece", stats: enemy },
  };
  const result = createWebAnalysis({
    save: { state: {
      playerStats: player,
      battleStats: player,
      availableSketches: ["capped", "open", "boss"],
      sketchVictories: { capped: 2, open: 1 },
      sketchRunVictories: { capped: 0, open: 2 },
      fundamentals: { maxVictories: 2, beyondMaxVictories: 1 },
    } },
    sketches,
    targetId: "boss",
    assumedVictories: { capped: 1, open: 2 },
    routeIds: ["capped", "open", "open"],
    trials: 1,
    maxSeconds: 10,
  });

  assert.deepEqual(result.assumedVictories, { open: 1 });
  assert.equal(result.finalStats.attack, 150);
  assert.deepEqual(result.routePreview.steps.map((step) => step.status), [
    "skipped_max_victories", "defeated", "skipped_max_victories",
  ]);
  assert.equal(result.routePreview.finalStats.attack, 150);
  assert.ok(!result.activeSketches.some(({ id }) => id === "capped"));
  const open = result.activeSketches.find(({ id }) => id === "open");
  assert.equal(open.remainingToMax, 1);
  assert.equal(open.totalVictories, 1);
  assert.equal(open.maxVictories, 2);
  assert.ok(result.rollWishlist.excluded.maxed.includes("capped"));
  assert.ok(!result.strategicPlan.opusValues.some(({ id }) => id === "capped"));
});
