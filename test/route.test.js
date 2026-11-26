import test from "node:test";
import assert from "node:assert/strict";

import { compareRoutes, projectVictories, simulateRoute } from "../src/route.js";

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

test("one-pass forecasts match each separately simulated prefix, including skipped and missing sketches", () => {
  const options = { state: state({ fundamentals: { maxVictories: 2, rewardDecay: 1 } }),
    sketches, targetId: "target", seed: "route-prefix", maxSeconds: 5, trials: 5 };
  const ids = ["warmup", "missing", "warmup", "warmup", "drain"];
  const route = simulateRoute({ ...options, routeIds: ids, includeStepForecasts: true });
  for (const [index, step] of route.steps.entries()) {
    const prefix = simulateRoute({ ...options, routeIds: ids.slice(0, index + 1) });
    const { winRate, p90Seconds, p90Censored } = prefix.target.simulation;
    assert.equal(step.status, prefix.steps[index].status);
    assert.deepEqual(step.forecast, { winRate, p90Seconds, p90Censored, finalStats: prefix.finalStats, currencies: prefix.currencies });
  }
});

test("a declared route credits future rewards and labels the fight forecasts as conditional", () => {
  const route = simulateRoute({ sketches, state: state({ availableSketches: ["drain"] }),
    routeIds: ["warmup"], targetId: "target", trials: 3, maxSeconds: 8, includeStepForecasts: true });

  assert.equal(route.conditional, true);
  assert.equal(route.steps[0].conditional, true);
  assert.equal(route.steps[0].availableNow, false);
  assert.equal(route.steps[0].availabilityReason, "sketch_not_available");
  assert.deepEqual(route.steps[0].statRewards, [{ statName: "attack", amount: 100, finalValue: 200 }]);
  assert.equal(route.target.conditional, true);
  assert.equal(route.target.availableNow, false);
  assert.equal(route.target.simulation.winRate, 1);
});

test("Medium 2 uses the Steam removal seed, redraw victories and rarity cap across projections", () => {
  const catalog = {
    ...sketches,
    hidden: { ...sketches.drain, id: "hidden" },
    won: { ...sketches.drain, id: "won" },
  };
  const availableSketches = ["warmup", "drain", "hidden", "won", "replacement"];
  const saveState = state({
    saveProfile: "steam", sketchRemovalSeed: 1, availableSketches, hiddenSketches: ["hidden"],
    sketchVictories: { hidden: 1 }, sketchRunVictories: { won: 1 },
    guaranteedSketchIds: ["hidden", "won"], bonusSketchIds: ["hidden"],
    availableSketchCountsByRarity: { rough: 4, opus: 1 }, runTotalSketchCountsByRarity: { rough: 4, opus: 1 },
    fundamentals: { maxVictories: 4 }, multiverse: { currentUniverseId: "mv-medium-2", totalReincarnations: 3 },
    redrawCount: 2, lastRedrawTime: 42,
  });
  const options = { sketches: catalog, state: saveState, baseStats: saveState.playerStats };
  const assumed = projectVictories({ ...options, ids: ["warmup", "warmup", "hidden"] });
  assert.deepEqual(assumed.appliedIds, ["warmup", "warmup"]);
  assert.deepEqual(assumed.skippedUnavailableIds, ["hidden"]);
  assert.deepEqual(assumed.state.availableSketches, ["warmup", "drain", "won", "replacement"]);
  assert.deepEqual(assumed.state.hiddenSketches, []);
  assert.deepEqual(assumed.state.guaranteedSketchIds, ["won"]);
  assert.deepEqual(assumed.state.bonusSketchIds, []);
  assert.equal(assumed.state.availableSketchCountsByRarity.rough, 3);
  assert.equal(assumed.state.runTotalSketchCountsByRarity.rough, 3);
  assert.deepEqual(saveState.availableSketches, ["warmup", "drain", "hidden", "won", "replacement"]);
  assert.deepEqual(saveState.hiddenSketches, ["hidden"]);
  const next = projectVictories({ ...options, state: assumed.state, baseStats: assumed.stats, ids: ["hidden"] });
  assert.deepEqual(next.skippedUnavailableIds, ["hidden"]);
  assert.equal(next.state.sketchVictories.hidden, 1);
  const nextRedraw = projectVictories({ ...options, state: assumed.state, baseStats: assumed.stats, ids: ["hidden"], afterRedraw: true });
  assert.deepEqual(nextRedraw.appliedIds, ["hidden"]);

  // In saves without a seed, the same redraw identity produces the same native fallback.
  for (const sketchRemovalSeed of [undefined, 1127736186]) {
    const result = projectVictories({ ...options, state: { ...saveState, sketchRemovalSeed }, ids: ["warmup"] });
    assert.deepEqual(result.lastReward.availabilityChanges, [{ id: "drain", retired: false }]);
  }
});

test("Madman and Brutal 1 apply both max-victory rules and prevent later fights with removed sketches", () => {
  const saveState = state({
    saveProfile: "steam", gameMode: "madman", availableSketches: ["warmup", "replacement", "target"],
    sketchRemovalSeed: 1, sketchRunVictories: { target: 1 }, autoHideMaxedUnlocked: true,
    guaranteedSketchIds: ["warmup", "replacement"], bonusSketchIds: ["warmup"],
    availableSketchCountsByRarity: { rough: 1, opus: 1, masterpiece: 1 },
    runTotalSketchCountsByRarity: { rough: 1, opus: 1, masterpiece: 1 },
    multiverse: { currentUniverseId: "mv-brutal-1", retiredSketchIds: ["already"] },
  });
  const options = { sketches, state: saveState, baseStats: saveState.playerStats };
  const result = projectVictories({ ...options, ids: ["warmup", "replacement"] });
  assert.deepEqual(result.appliedIds, ["warmup"]);
  assert.deepEqual(result.state.availableSketches, ["target"]);
  assert.deepEqual(result.state.multiverse.retiredSketchIds, ["already", "warmup"]);
  assert.deepEqual(result.state.hiddenSketches, ["warmup"]);
  assert.deepEqual(result.state.guaranteedSketchIds, []);
  assert.deepEqual(result.state.bonusSketchIds, []);
  assert.deepEqual(result.state.availableSketchCountsByRarity, { rough: 0, opus: 0, masterpiece: 1 });
  assert.deepEqual(result.state.runTotalSketchCountsByRarity, { rough: 1, opus: 0, masterpiece: 1 });
  const route = simulateRoute({ ...options, routeIds: ["warmup", "replacement"], targetId: "replacement",
    includeStepCombat: true, trials: 1, maxSeconds: 10 });
  assert.deepEqual(route.steps[0].availabilityChanges, [{ id: "warmup", retired: true }, { id: "replacement", retired: false }]);
  assert.equal(route.steps[1].status, "skipped_unavailable");
  assert.equal(route.steps[1].availableNow, true);
  assert.equal(route.steps[1].availableAtStep, false);
  assert.equal(route.steps[1].fightSimulation, undefined);
  assert.equal(route.target.availableAfterRoute, false);
  assert.equal(route.target.availabilityReasonAfterRoute, "sketch_not_available");
});

test("Medium 2 takes precedence when a first win also maxes a sketch in Madman", () => {
  const saveState = state({
    saveProfile: "steam", gameMode: "madman", availableSketches: ["warmup", "replacement"],
    multiverse: { currentUniverseId: "mv-medium-2" },
  });
  const options = { sketches, baseStats: saveState.playerStats };
  const first = projectVictories({ ...options, state: saveState, ids: ["warmup"] });
  assert.deepEqual(first.state.availableSketches, ["warmup", "replacement"]);
  const repeat = projectVictories({ ...options, state: { ...saveState, sketchRunVictories: { warmup: 1 } }, ids: ["warmup"] });
  assert.deepEqual(repeat.state.availableSketches, ["warmup"]);
});

test("an unknown eraser target does not consume a forecast eraser use", () => {
  const result = simulateRoute({ sketches, state: state({ fundamentals: { opusEraser: 1 } }),
    erasedIds: ["unknown", "erasable_target"], targetId: "erasable_target" });

  assert.deepEqual(result.tools.erasedSkipped, [{ id: "unknown", reason: "unknown_sketch" }]);
  assert.deepEqual(result.tools.erasedApplied, ["erasable_target"]);
  assert.equal(result.target.stats.maxHp, 400);
});

test("large finite balances survive route JSON export", () => {
  const result = simulateRoute({ state: state({ currencies: { Photon: 2e307, Graphite: Number.MAX_VALUE } }),
    sketches, routeIds: ["warmup"], includeStepForecasts: true });
  const exported = JSON.parse(JSON.stringify(result));
  assert.equal(exported.currencies.Photon, 2e307);
  assert.equal(exported.steps[0].forecast.currencies.Graphite, Number.MAX_VALUE);
});

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
  const remaining = simulateRoute({
    sketches,
    state: state({
      sketchRunVictories: { warmup: 2 },
      sketchVictories: { warmup: 1 },
      fundamentals: { ...state().fundamentals, maxVictories: 2 },
    }),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    routeIds: ["warmup", "warmup"],
  });

  assert.equal(capped.finalStats.attack, 100);
  assert.equal(capped.steps[0].status, "skipped_max_victories");
  assert.equal(beyond.finalStats.attack, 100);
  assert.equal(beyond.steps[0].status, "skipped_max_victories");
  assert.equal(remaining.finalStats.attack, 150);
  assert.equal(remaining.steps[0].rewardMultiplier.decay, 0.5);
  assert.equal(remaining.steps[1].status, "skipped_max_victories");
});

test("simulateRoute buys upgrades with passive income on a route without fights", () => {
  const result = simulateRoute({
    sketches,
    state: state({ currencies: { Graphite: 0 }, currencyGeneratorRates: { Graphite: 5 } }),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000 },
    buyUpgrades: true,
    buyUpgradeIds: ["upgrade_atk_graphite"],
    routeSeconds: 1,
  });

  assert.deepEqual(result.shop.purchased, [{ id: "upgrade_atk_graphite", level: 1, currency: "Graphite", cost: 5 }]);
  assert.equal(result.currencies.Graphite, 0);
  assert.equal(result.finalStats.attack, 105);
});

test("Eternal Practice permits meditation on a capped sketch without granting additional victories", () => {
  const options = {
    sketches,
    baseStats: { maxHp: 1000, armor: 100 },
    meditation: { sketchId: "replacement", stats: ["armor"] },
    routeIds: ["replacement"],
  };
  const cappedState = state({ sketchVictories: { replacement: 1 } });
  const regular = simulateRoute({ ...options, state: cappedState });
  const eternalPractice = simulateRoute({
    ...options,
    state: { ...cappedState, fundamentals: { ...cappedState.fundamentals, beyondMaxVictories: 1 } },
  });

  assert.equal(regular.meditation.applied, false);
  assert.equal(eternalPractice.meditation.applied, true);
  assert.equal(eternalPractice.finalStats.armor, 110);
  assert.equal(eternalPractice.steps[0].status, "skipped_max_victories");
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
  assert.equal(result.totalEarnedCurrencies.Graphite, 300);
  assert.equal(result.totalBattleEarnedCurrencies.Graphite, 0);
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

test("compareRoutes uses identical fight samples for identical routes with different names", () => {
  const options = {
    sketches: { ...sketches, target: { ...sketches.target, stats: { ...sketches.target.stats, dodge: 50 } } },
    state: state(),
    baseStats: { maxHp: 1000, attack: 100, attackSpeed: 1000, accuracy: 50 },
    targetId: "target",
    trials: 24,
    seed: "same-route",
    maxSeconds: 22,
  };
  const direct = simulateRoute({ ...options, routeIds: ["warmup"] });
  const comparison = compareRoutes({
    ...options,
    routes: [{ name: "First", ids: ["warmup"] }, { name: "Renamed", ids: ["warmup"] }],
  });

  for (const entry of comparison.routes) assert.deepEqual(entry.target.simulation, direct.target.simulation);
});

test("compareRoutes ranks a reachable target ahead of a stronger build that removed it", () => {
  const saveState = state({ saveProfile: "steam", availableSketches: ["warmup", "drain"],
    multiverse: { currentUniverseId: "mv-medium-2" } });
  const comparison = compareRoutes({
    sketches, state: saveState, baseStats: saveState.playerStats, targetId: "drain",
    routes: [{ name: "Farm", ids: ["warmup"] }, { name: "Fight now", ids: [] }], trials: 2, maxSeconds: 5,
  });
  assert.deepEqual(comparison.routes.map(({ name, target }) => [name, target.availableAfterRoute]),
    [["Fight now", true], ["Farm", false]]);
});

test("simulateRoute uses the legacy save's time acceleration and Flow State", () => {
  const player = { maxHp: 100, attack: 100, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 };
  const options = {
    sketches: { target: { ...sketches.target, stats: { ...player, attackSpeed: 800 } } },
    baseStats: player,
    targetId: "target",
    trials: 4,
    maxSeconds: 2,
  };
  const save = {
    fundamentals: { timeAcceleration: 2, flowStateLevel: 50 },
    autoRetryActive: true,
    glossaryUnlocks: ["target"],
  };
  const known = simulateRoute({ ...options, state: save }).target.simulation;
  const unknown = simulateRoute({ ...options, state: { ...save, glossaryUnlocks: [] } }).target.simulation;
  const normalSpeed = simulateRoute({
    ...options,
    state: { ...save, fundamentals: { ...save.fundamentals, timeAcceleration: 1 } },
  }).target.simulation;

  assert.equal(known.winRate, 1);
  assert.equal(unknown.winRate, 0);
  assert.equal(known.avgSeconds, 0.25);
  assert.equal(known.avgSeconds * 2, normalSpeed.avgSeconds);
});
