import test from "node:test";
import assert from "node:assert/strict";

import { compareRoutes, simulateRoute } from "../src/route.js";

const sketches = {
  warmup: {
    id: "warmup",
    name: "Warmup",
    rarity: "rough",
    stats: { maxHp: 10, attack: 0, attackSpeed: 1000 },
    rewards: [{ statName: "attack", amount: 100 }],
    currencyRewards: [{ name: "Graphite", amount: 100 }],
  },
  drain: {
    id: "drain",
    name: "Drain",
    rarity: "rough",
    stats: { maxHp: 10, attack: 0, attackSpeed: 1000 },
    rewards: [{ statName: "attack", amount: -20 }],
    currencyRewards: [],
  },
  replacement: {
    id: "replacement",
    name: "Replacement",
    rarity: "opus",
    stats: { maxHp: 10, attack: 0, attackSpeed: 1000, armor: 5, regen: 2 },
    rewards: [{ statName: "maxHp", amount: 50 }],
    currencyRewards: [],
  },
  target: {
    id: "target",
    name: "Target",
    rarity: "masterpiece",
    stats: { maxHp: 1000, attack: 0, attackSpeed: 1000 },
    rewards: [],
    currencyRewards: [],
  },
  erasable_target: {
    id: "erasable_target",
    name: "Erasable Target",
    rarity: "opus",
    stats: { maxHp: 800, attack: 0, attackSpeed: 1000 },
    rewards: [],
    currencyRewards: [],
  },
};

function state(overrides = {}) {
  return {
    playerStats: { maxHp: "1000", attack: "100", attackSpeed: "1000" },
    battleStats: { maxHp: "1000", attack: "100", attackSpeed: "1000" },
    currencies: { Graphite: "0" },
    totalEarnedCurrencies: { Graphite: "0" },
    totalBattleEarnedCurrencies: { Graphite: "0" },
    shopLevels: {},
    sketchVictories: {},
    sketchRunVictories: {},
    boostedSketchIds: [],
    erasedSketchIds: [],
    swappedSketchIds: [],
    activeMeditationBuffs: [],
    skillLevels: {},
    quintessence: "0",
    fundamentals: {
      maxVictories: 1,
      rewardDecay: 1,
      rewardBoosterUses: 1,
      rewardBoosterEffect: 50,
      rewardBoosterRetroactive: 1,
      preciseEraserUses: 1,
      opusEraser: 0,
      swapperUses: 1,
      meditationRewardMax: 0.1,
      meditationGoldZoneBonus: 7,
      meditationTealZoneBonus: 5,
      meditationCooldownMax: 300,
      meditationCooldownReduction: 0,
      graphiteRewardMultiplier: 100,
      graphiteRewardExponent: 0,
      featMedalMultiplier: 1,
      generatorMultiplier: 1,
      graphiteGeneratorMultiplier: 1,
      graphiteUpgradeCost: 0,
    },
    ...overrides,
  };
}

test("simulateRoute applies route rewards with decay and respects max victories", () => {
  const capped = simulateRoute({
    sketches,
    state: state({ sketchVictories: { warmup: 1 } }),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    routeIds: ["warmup"],
  });
  const beyond = simulateRoute({
    sketches,
    state: state({ sketchVictories: { warmup: 1 }, fundamentals: { ...state().fundamentals, beyondMaxVictories: 1 } }),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    routeIds: ["warmup"],
  });

  assert.equal(capped.finalStats.attack, 100);
  assert.equal(capped.steps[0].status, "skipped_max_victories");
  assert.equal(beyond.finalStats.attack, 150);
  assert.equal(beyond.steps[0].rewardMultiplier.decay, 0.5);
});

test("simulateRoute handles booster limits, negative rewards and retroactive booster gains", () => {
  const result = simulateRoute({
    sketches,
    state: state({ sketchVictories: { warmup: 2 } }),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    routeIds: ["drain"],
    boostedIds: ["warmup", "drain", "replacement"],
  });

  assert.equal(result.finalStats.attack, 145);
  assert.deepEqual(result.tools.boostedApplied, ["warmup", "drain"]);
  assert.deepEqual(result.tools.boostedSkipped, [{ id: "replacement", reason: "no_booster_uses" }]);
  assert.equal(result.steps[0].statRewards[0].amount, -30);
});

test("simulateRoute applies precise eraser to Opus targets when Opus Eraser is unlocked", () => {
  const result = simulateRoute({
    sketches,
    state: state({ fundamentals: { ...state().fundamentals, opusEraser: 1 } }),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    routeIds: ["warmup"],
    targetId: "erasable_target",
    erasedIds: ["erasable_target"],
  });

  assert.equal(result.finalStats.attack, 200);
  assert.equal(result.target.stats.maxHp, 400);
  assert.deepEqual(result.tools.erasedApplied, ["erasable_target"]);
});

test("simulateRoute skips requested precise eraser on Opus targets without Opus Eraser", () => {
  const result = simulateRoute({
    sketches,
    state: state(),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    targetId: "erasable_target",
    erasedIds: ["erasable_target"],
  });

  assert.equal(result.target.rarity, "opus");
  assert.equal(result.target.stats.maxHp, 800);
  assert.deepEqual(result.tools.erasedApplied, []);
  assert.deepEqual(result.tools.erasedSkipped, [{ id: "erasable_target", reason: "opus_eraser_not_unlocked" }]);
});

test("simulateRoute skips requested precise eraser on Masterpiece targets", () => {
  const result = simulateRoute({
    sketches,
    state: state(),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    targetId: "target",
    erasedIds: ["target"],
  });

  assert.equal(result.target.rarity, "masterpiece");
  assert.equal(result.target.stats.maxHp, 1000);
  assert.deepEqual(result.tools.erasedApplied, []);
  assert.deepEqual(result.tools.erasedSkipped, [{ id: "target", reason: "masterpiece_not_eligible" }]);
});

test("simulateRoute can pivot route sketches before applying rewards", () => {
  const result = simulateRoute({
    sketches,
    state: state(),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    routeIds: ["warmup"],
    swapMap: { warmup: "replacement" },
  });

  assert.equal(result.finalStats.maxHp, 1050);
  assert.equal(result.steps[0].id, "replacement");
  assert.deepEqual(result.tools.swappedApplied, [{ from: "warmup", to: "replacement" }]);
});

test("simulateRoute applies deterministic meditation buffs and cooldown", () => {
  const result = simulateRoute({
    sketches,
    state: state(),
    baseStats: { maxHp: 1000, attack: 100, armor: 10, regen: 10, attackSpeed: 1000 },
    routeIds: [],
    meditation: { sketchId: "replacement", stats: ["armor", "regen"], zone: "gold" },
  });

  assert.equal(result.finalStats.armor, 11.7);
  assert.equal(result.finalStats.regen, 11.7);
  assert.equal(result.meditation.cooldownSeconds, 300);
  assert.deepEqual(result.meditation.appliedStats, ["armor", "regen"]);
});

test("simulateRoute reports Secret Stash progress and buys hidden shop upgrades when unlocked", () => {
  const result = simulateRoute({
    sketches,
    state: state({
      skillLevels: { "stats-hidden-upgrades": 1 },
      currencies: { Graphite: "1e40" },
      shopLevels: { upgrade_secret_burn_damage_graphite: 0 },
      quintessence: "1e223",
    }),
    baseStats: { maxHp: 1000, attack: 100, burnDamage: 10, attackSpeed: 1000 },
    routeIds: ["warmup"],
    buyUpgrades: true,
    buyUpgradeIds: ["upgrade_secret_burn_damage_graphite"],
  });

  assert.equal(result.secretStash.unlocked, true);
  assert.equal(result.secretStash.canAfford, true);
  assert.ok(result.finalStats.burnDamage > 10);
  assert.equal(result.shop.purchased[0].id, "upgrade_secret_burn_damage_graphite");
  assert.equal(result.currencies.Graphite, 200);
});

test("simulateRoute includes passive generator income during the route", () => {
  const result = simulateRoute({
    sketches,
    state: state({
      currencyGeneratorRates: { Graphite: 10 },
      fundamentals: {
        ...state().fundamentals,
        generatorMultiplier: 2,
        graphiteGeneratorMultiplier: 3,
      },
    }),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    routeIds: [],
    routeSeconds: 5,
  });

  assert.equal(result.generatedCurrencies.Graphite, 300);
  assert.equal(result.currencies.Graphite, 300);
});

test("compareRoutes ranks route options for the same target", () => {
  const comparison = compareRoutes({
    sketches,
    state: state(),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    targetId: "target",
    routes: [
      { name: "empty", ids: [] },
      { name: "warmup", ids: ["warmup"] },
    ],
    trials: 20,
    seed: "compare-routes",
  });

  assert.equal(comparison.targetId, "target");
  assert.equal(comparison.routes[0].name, "warmup");
  assert.ok(comparison.routes[0].finalStats.attack > comparison.routes[1].finalStats.attack);
});
