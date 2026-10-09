import test from "node:test";
import assert from "node:assert/strict";

import {
  createTargetOptions,
  createWebAnalysis,
  summarizeGameBundle,
} from "../src/web-core.js";

const sketches = {
  farm_a: {
    id: "farm_a",
    name: "Farm A",
    rarity: "opus",
    stats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
    rewards: [{ statName: "attack", amount: 1000 }],
    currencyRewards: [{ name: "Graphite", amount: 100 }],
    immunities: [],
    vulnerability: null,
  },
  duct_taped_banana: {
    id: "duct_taped_banana",
    name: "Duct-Taped Banana",
    rarity: "masterpiece",
    stats: { maxHp: 100, attack: 0, attackSpeed: 10000 },
    rewards: [],
    immunities: [],
    vulnerability: null,
  },
  rose_window: {
    id: "rose_window",
    name: "Rose Window",
    rarity: "masterpiece",
    stats: { maxHp: 5000, attack: 0, attackSpeed: 10000, regen: 1000 },
    rewards: [],
    immunities: [],
    vulnerability: null,
  },
  mobius_strip: {
    id: "mobius_strip",
    name: "Mobius Strip",
    rarity: "masterpiece",
    stats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
    rewards: [],
    immunities: [],
    vulnerability: null,
  },
};

function encodeSave(state) {
  return Buffer.from(JSON.stringify({ version: 52, state }), "utf8").toString("base64");
}

test("createWebAnalysis decodes save text, applies checked route sketches and returns UI sections", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana", "rose_window"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    dataMetadata: { gameVersion: "v0.874", saveVersion: 52 },
    targetId: "duct",
    assumedVictoryIds: ["farm_a"],
    trials: 10,
    maxSeconds: 20,
    seed: "web-core",
  });

  assert.equal(analysis.target.id, "duct_taped_banana");
  assert.deepEqual(analysis.assumedVictoryIds, ["farm_a"]);
  assert.ok(analysis.result.winRate > 0);
  assert.ok(analysis.activeSketches.some((item) => item.id === "farm_a"));
  assert.ok(analysis.recommendation.action);
  assert.deepEqual(analysis.buildComparison.map((item) => item.label), ["Farm", "Duct", "Rose"]);
  assert.equal(analysis.bundle.gameVersion, "v0.874");
});

test("createWebAnalysis applies requested kill counts and caps them at remaining run rewards", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana"],
    hiddenSketches: [],
    sketchRunVictories: { farm_a: 1 },
    sketchVictories: { farm_a: 5 },
    fundamentals: { maxVictories: 3, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    assumedVictories: { farm_a: 99 },
    trials: 10,
    maxSeconds: 20,
    seed: "web-core-counts",
  });

  const expectedAttack = 1 + 1000 / 6 + 1000 / 7;
  assert.deepEqual(analysis.assumedVictories, { farm_a: 2 });
  assert.deepEqual(analysis.assumedVictoryIds, ["farm_a", "farm_a"]);
  assert.ok(Math.abs(analysis.finalStats.attack - expectedAttack) < 1e-9);
});

test("createWebAnalysis keeps legacy assumedVictoryIds as one kill per checked sketch", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    fundamentals: { maxVictories: 3, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    assumedVictoryIds: ["farm_a"],
    trials: 10,
    maxSeconds: 20,
    seed: "web-core-legacy",
  });

  assert.deepEqual(analysis.assumedVictories, { farm_a: 1 });
  assert.deepEqual(analysis.assumedVictoryIds, ["farm_a"]);
  assert.equal(analysis.finalStats.attack, 1001);
});

test("createWebAnalysis defaults omitted trials to auto", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["duct_taped_banana"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    maxSeconds: 20,
    seed: "web-core-default-auto",
  });

  assert.equal(analysis.result.autoTrials.mode, "auto");
  assert.ok(analysis.result.trials >= 200);
  assert.ok(analysis.result.trials <= 4000);
});

test("createWebAnalysis extends target-only timeout windows before reporting a false zero", () => {
  const longFightSketches = {
    ...sketches,
    slow_target: {
      id: "slow_target",
      name: "Slow Target",
      rarity: "opus",
      stats: { maxHp: 3000, attack: 0, attackSpeed: 10000 },
      rewards: [],
      immunities: [],
      vulnerability: null,
    },
  };
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["slow_target"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches: longFightSketches,
    targetId: "slow_target",
    trials: 20,
    maxSeconds: 100,
    seed: "web-core-long-fight",
  });

  assert.equal(analysis.result.winRate, 1);
  assert.equal(analysis.result.timeLimit.extended, true);
  assert.equal(analysis.result.timeLimit.configuredMaxSeconds, 100);
  assert.equal(analysis.result.timeLimit.baseline.winRate, 0);
  assert.ok(analysis.result.timeLimit.effectiveMaxSeconds >= 300);
  assert.match(analysis.diagnostics.sanityChecks[0].detail, /extended/i);
});

test("createWebAnalysis returns a strategic planner section when strategy options are supplied", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    currencies: { Graphite: 10 },
    quintessence: 100,
    quintessencePerSecond: 2,
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    trials: 10,
    maxSeconds: 20,
    seed: "web-core-strategy",
    strategyOptions: {
      goalQuintessence: "1000",
      goalCurrency: "Graphite=500",
      softcapSeconds: 120,
      farmSeconds: 60,
      boosterCandidates: "farm:farm_a",
    },
  });

  assert.equal(analysis.strategicPlan.approach.resources.quintessence.goal, 1000);
  assert.equal(analysis.strategicPlan.approach.resources.currencies.Graphite.goal, 500);
  assert.equal(analysis.strategicPlan.softcap.decision, "wait_softcap");
  assert.equal(analysis.strategicPlan.farmPlan.goal.type, "quintessence");
  assert.equal(analysis.strategicPlan.boosters.recommendation.name, "farm");
});

test("createWebAnalysis forwards strategy profile options to the planner", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    currencies: { Graphite: 10, Photon: 5 },
    quintessence: 100,
    quintessencePerSecond: 2,
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    trials: 10,
    maxSeconds: 20,
    seed: "web-core-strategy-profile",
    strategyOptions: {
      strategyProfile: "farm-photon",
      strategyMode: "greedy-farm",
      compareProfiles: "farm-q,farm-photon,transcendent-paragon",
    },
  });

  assert.equal(analysis.strategicPlan.profile.id, "farm-photon");
  assert.equal(analysis.strategicPlan.profile.mode.id, "greedy-farm");
  assert.deepEqual(analysis.strategicPlan.profileComparison.map((item) => item.id), [
    "farm-q",
    "farm-photon",
    "transcendent-paragon",
  ]);
});

test("createWebAnalysis returns priority 13 planner data for UI comparisons and route previews", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana", "rose_window", "mobius_strip"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    currencies: { Graphite: 0 },
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    routeIds: ["farm_a"],
    trials: 10,
    maxSeconds: 20,
    seed: "web-core-p13",
  });

  assert.ok(analysis.targetComparisons.some((item) => item.id === "mobius_strip"));
  assert.ok(analysis.targetComparisons.some((item) => item.id === "farm_a" && item.source === "active_run"));
  assert.equal(analysis.routePreview.steps.length, 1);
  assert.equal(analysis.routePreview.steps[0].id, "farm_a");
  assert.ok(analysis.routePreview.steps[0].targetWinRate > analysis.result.winRate);
  assert.ok(analysis.activeDeltas.farm_a.winRateDelta > 0);
  assert.ok(analysis.activeDeltas.farm_a.statRewards.some((item) => item.statName === "attack"));
});

test("createWebAnalysis ranks non-guaranteed roll wishlist sketches for the selected target", () => {
  const wishlistSketches = {
    ...sketches,
    target_wall: {
      id: "target_wall",
      name: "Target Wall",
      rarity: "masterpiece",
      stats: { maxHp: 1000, attack: 0, attackSpeed: 10000 },
      rewards: [],
      immunities: [],
      vulnerability: null,
    },
    guaranteed_best: {
      id: "guaranteed_best",
      name: "Guaranteed Best",
      rarity: "opus",
      stats: { maxHp: 1, attack: 0, attackSpeed: 10000 },
      rewards: [{ statName: "attack", amount: 500000 }],
      immunities: [],
      vulnerability: null,
    },
    roll_best: {
      id: "roll_best",
      name: "Roll Best",
      rarity: "opus",
      stats: { maxHp: 1, attack: 0, attackSpeed: 10000 },
      rewards: [{ statName: "attack", amount: 500000 }],
      currencyRewards: [{ name: "Graphite", amount: 1000 }],
      immunities: [],
      vulnerability: null,
    },
    hard_reward: {
      id: "hard_reward",
      name: "Hard Reward",
      rarity: "opus",
      stats: { maxHp: 1e15, attack: 1e15, attackSpeed: 100 },
      rewards: [{ statName: "attack", amount: 750000 }],
      immunities: [],
      vulnerability: null,
    },
    no_help: {
      id: "no_help",
      name: "No Help",
      rarity: "rough",
      stats: { maxHp: 1, attack: 0, attackSpeed: 10000 },
      rewards: [{ statName: "accuracy", amount: 1 }],
      immunities: [],
      vulnerability: null,
    },
  };
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["target_wall"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    guaranteedSketchSelections: { opus: ["guaranteed_best"] },
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches: wishlistSketches,
    targetId: "target_wall",
    trials: 20,
    maxSeconds: 5,
    seed: "web-core-roll-wishlist",
  });

  assert.equal(analysis.rollWishlist.baselineWinRate, analysis.result.winRate);
  assert.ok(analysis.rollWishlist.items.length > 0);
  assert.equal(analysis.rollWishlist.items[0].id, "roll_best");
  assert.ok(analysis.rollWishlist.items[0].targetWinRateDelta > 0);
  assert.ok(analysis.rollWishlist.items[0].candidateWinRate > 0.8);
  assert.ok(!analysis.rollWishlist.items.some((item) => item.id === "guaranteed_best"));
  assert.ok(analysis.rollWishlist.items.some((item) => item.id === "hard_reward" && item.feasibility === "risky"));
  assert.ok(analysis.rollWishlist.excluded.guaranteed.includes("guaranteed_best"));
});

test("createWebAnalysis caps auxiliary dashboard simulations for UI performance", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana", "rose_window", "mobius_strip"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    currencies: { Graphite: 0 },
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    routeIds: ["farm_a"],
    trials: "auto",
    maxSeconds: 20,
    seed: "web-core-aux-trials",
  });

  assert.equal(analysis.result.autoTrials.mode, "auto");
  assert.ok(analysis.result.trials >= 200);
  assert.ok(analysis.activeSketches.every((item) => item.trials <= 100));
  assert.ok(analysis.targetComparisons.every((item) => item.trials <= 100));
  assert.ok(analysis.buildComparison.every((item) => item.trials == null || item.trials <= 100));
  assert.ok(Object.values(analysis.activeDeltas).every((item) => item.trials <= 100));
  assert.equal(analysis.performance.auxiliaryTrials, 100);
});

test("createWebAnalysis returns priority 14 diagnostics, trace and observed mismatch", () => {
  const saveText = encodeSave({
    playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: ["farm_a", "duct_taped_banana"],
    hiddenSketches: [],
    sketchRunVictories: {},
    sketchVictories: {},
    currencies: { Graphite: 0 },
    fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
  });

  const analysis = createWebAnalysis({
    saveText,
    sketches,
    targetId: "duct",
    trials: 20,
    maxSeconds: 20,
    seed: "web-core-p14",
    observedOutcome: "win",
    traceSeconds: 5,
  });

  assert.ok(analysis.diagnostics.confidence.level);
  assert.ok(analysis.diagnostics.why.length > 0);
  assert.equal(analysis.diagnostics.observation.observedOutcome, "win");
  assert.deepEqual(analysis.assumptionComparisons.map((item) => item.id), [
    "baseline",
    "enemy_status_x1",
    "dot_half",
    "enemy_buff_x1",
  ]);
  assert.equal(analysis.fightTrace.target.id, "duct_taped_banana");
  assert.ok(analysis.fightTrace.events.length > 0);
});

test("createWebAnalysis applies save combat speed multiplier to target simulations", () => {
  const sketches = {
    duct_taped_banana: {
      id: "duct_taped_banana",
      name: "Duct-Taped Banana",
      rarity: "masterpiece",
      stats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
      rewards: [],
    },
  };
  const save = {
    version: 52,
    state: {
      playerStats: { maxHp: 1000, attack: 10, attackSpeed: 10000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      battleStats: { maxHp: 1000, attack: 10, attackSpeed: 10000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      availableSketches: ["duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: {},
      sketchVictories: {},
      fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50, timeAcceleration: 2 },
    },
  };

  const analysis = createWebAnalysis({
    saveText: JSON.stringify(save),
    sketches,
    targetId: "duct_taped_banana",
    trials: 20,
    maxSeconds: 6,
    seed: "web-speed-multiplier",
  });

  assert.equal(analysis.result.winRate, 1);
  assert.ok(analysis.result.medianSeconds < 6);
  assert.equal(analysis.fightTrace.result.winner, "player");
});

test("createTargetOptions includes reward type tokens for UI filtering", () => {
  const options = createTargetOptions({ sketches });
  const farm = options.find((item) => item.id === "farm_a");

  assert.ok(farm.searchText.includes("opus"));
  assert.ok(farm.searchText.includes("stat"));
  assert.ok(farm.searchText.includes("currency"));
  assert.ok(farm.searchText.includes("graphite"));
});

test("summarizeGameBundle reports counts and important targets", () => {
  const summary = summarizeGameBundle({
    sketches,
    dataMetadata: { gameVersion: "v0.874", asset: "artistLinks-test.js", capturedAt: "2026-05-20" },
  });

  assert.equal(summary.gameVersion, "v0.874");
  assert.equal(summary.asset, "artistLinks-test.js");
  assert.equal(summary.totalSketches, 4);
  assert.equal(summary.countsByRarity.masterpiece, 3);
  assert.deepEqual(summary.importantTargets.map((item) => item.id), [
    "duct_taped_banana",
    "rose_window",
    "mobius_strip",
  ]);
});
