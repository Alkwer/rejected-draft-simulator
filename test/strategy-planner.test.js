import test from "node:test";
import assert from "node:assert/strict";

import {
  createStrategyPlan,
  parseStrategyCurrencyGoals,
  rankOpusStrategicValue,
  STRATEGY_PROFILES,
} from "../src/strategy-planner.js";

const sketches = {
  opus_currency: {
    id: "opus_currency",
    name: "Opus Currency",
    rarity: "opus",
    stats: { maxHp: 10, attack: 0, attackSpeed: 1000 },
    rewards: [],
    currencyRewards: [{ name: "Graphite", amount: 500 }],
  },
  opus_attack: {
    id: "opus_attack",
    name: "Opus Attack",
    rarity: "opus",
    stats: { maxHp: 10, attack: 0, attackSpeed: 1000, accuracy: 25 },
    rewards: [{ statName: "attack", amount: 300 }],
    currencyRewards: [],
  },
  opus_hp: {
    id: "opus_hp",
    name: "Opus HP",
    rarity: "opus",
    stats: { maxHp: 10, attack: 0, attackSpeed: 1000 },
    rewards: [{ statName: "maxHp", amount: 300 }],
    currencyRewards: [],
  },
  target: {
    id: "target",
    name: "Target",
    rarity: "masterpiece",
    stats: { maxHp: 200, attack: 0, attackSpeed: 1000 },
    rewards: [],
    currencyRewards: [],
  },
};

function state(overrides = {}) {
  return {
    playerStats: { maxHp: "1000", attack: "1", attackSpeed: "100", accuracy: "100", minDamage: "100", maxDamage: "100" },
    battleStats: { maxHp: "1000", attack: "1", attackSpeed: "100", accuracy: "100", minDamage: "100", maxDamage: "100" },
    currencies: { Graphite: "50" },
    quintessence: "100",
    quintessencePerSecond: "2",
    currencyGeneratorRates: { Graphite: 1 },
    availableSketches: ["opus_currency", "opus_attack", "opus_hp", "target"],
    hiddenSketches: [],
    sketchVictories: {},
    sketchRunVictories: {},
    boostedSketchIds: [],
    fundamentals: {
      maxVictories: 2,
      rewardDecay: 1,
      rewardBoosterUses: 2,
      rewardBoosterEffect: 50,
      graphiteRewardMultiplier: 0,
      generatorMultiplier: 1,
      graphiteGeneratorMultiplier: 1,
    },
    ...overrides,
  };
}

const currentRun = {
  targets: [
    { id: "opus_currency", name: "Opus Currency", rarity: "opus", winRate: 0.8, p90Seconds: 20, remainingToMax: 2 },
    { id: "opus_attack", name: "Opus Attack", rarity: "opus", winRate: 0.6, p90Seconds: 30, remainingToMax: 2 },
    { id: "target", name: "Target", rarity: "masterpiece", winRate: 0.4, p90Seconds: 60, remainingToMax: 1 },
  ],
};

test("createStrategyPlan estimates resource gaps, softcap choice, farm plan and run EV", () => {
  const plan = createStrategyPlan({
    sketches,
    state: state(),
    targetId: "target",
    baseStats: state().battleStats,
    targetSimulation: { winRate: 0.4, trials: 100, winRateCi95: { halfWidth: 0.05 } },
    currentRun,
    goalQuintessence: 1000,
    goalCurrencies: { Graphite: 500 },
    softcapSeconds: 120,
    farmSeconds: 60,
    targetWinRate: 0.5,
    maxSoftcapWaitSeconds: 300,
  });

  assert.equal(plan.approach.resources.quintessence.missing, 900);
  assert.equal(plan.approach.resources.currencies.Graphite.missing, 450);
  assert.equal(plan.approach.winRate.missing, 0.1);
  assert.equal(plan.softcap.decision, "wait_softcap");
  assert.equal(plan.farmPlan.goal.type, "quintessence");
  assert.equal(plan.runEV.windowSeconds, 60);
  assert.ok(plan.runEV.currencies.Graphite.expected > 0);
});

test("rankOpusStrategicValue prioritizes currency Opus when a currency goal is missing", () => {
  const values = rankOpusStrategicValue({
    sketches,
    state: state(),
    targetStatWeights: { attack: 10, maxHp: 1 },
    goalCurrencies: { Graphite: 1000 },
  });

  assert.equal(values[0].id, "opus_currency");
  assert.ok(values[0].currencyScore > values[0].statScore);
  assert.ok(values.some((item) => item.id === "opus_attack" && item.statScore > 0));
});

test("createStrategyPlan ranks booster choices with route simulation", () => {
  const plan = createStrategyPlan({
    sketches,
    state: state(),
    targetId: "target",
    baseStats: state().battleStats,
    targetSimulation: { winRate: 0.1, trials: 20 },
    currentRun,
    boosterCandidates: [
      { name: "attack_boost", ids: ["opus_attack"] },
      { name: "hp_boost", ids: ["opus_hp"] },
    ],
    trials: 20,
    maxSeconds: 5,
    seed: "strategy-booster",
  });

  assert.equal(plan.boosters.recommendation.name, "attack_boost");
  assert.ok(plan.boosters.choices[0].winRate > plan.boosters.choices[1].winRate);
  assert.equal(plan.boosters.choices[0].simulated, true);
});

test("parseStrategyCurrencyGoals accepts comma separated currency goals", () => {
  assert.deepEqual(parseStrategyCurrencyGoals("Graphite=1e6,Gold Leaf:2.5e3"), {
    Graphite: 1e6,
    "Gold Leaf": 2500,
  });
});

test("strategy planner exposes named goal profiles with weighted profile output", () => {
  assert.ok(STRATEGY_PROFILES.some((profile) => profile.id === "farm-q"));
  assert.ok(STRATEGY_PROFILES.some((profile) => profile.id === "farm-photon"));
  assert.ok(STRATEGY_PROFILES.some((profile) => profile.id === "3-masterpiece"));
  assert.ok(STRATEGY_PROFILES.some((profile) => profile.id === "transcendent-paragon"));

  const plan = createStrategyPlan({
    sketches,
    state: state({ currencies: { Graphite: "50", Photon: "25" }, currencyGeneratorRates: { Graphite: 1, Photon: 2 } }),
    targetId: "target",
    baseStats: state().battleStats,
    targetSimulation: { winRate: 0.45, trials: 100 },
    currentRun,
    strategyProfile: "farm-photon",
    strategyMode: "greedy-farm",
    farmSeconds: 60,
  });

  assert.equal(plan.profile.id, "farm-photon");
  assert.equal(plan.profile.mode.id, "greedy-farm");
  assert.equal(plan.profile.goal.type, "currency");
  assert.equal(plan.profile.goal.currency, "Photon");
  assert.ok(plan.profile.rewardWeights.currency > plan.profile.rewardWeights.combat);
  assert.ok(plan.profileProgress.averageRuns > 0);
  assert.ok(plan.profileProgress.averageRedraws >= plan.profileProgress.averageRuns);
});

test("strategy modes change active run priorities for safe, greedy and boss planning", () => {
  const richCurrentRun = {
    targets: [
      { id: "opus_currency", name: "Opus Currency", rarity: "opus", winRate: 0.9, p90Seconds: 12, remainingToMax: 2 },
      { id: "opus_attack", name: "Opus Attack", rarity: "opus", winRate: 0.25, p90Seconds: 80, remainingToMax: 2 },
      { id: "target", name: "Target", rarity: "masterpiece", winRate: 0.35, p90Seconds: 50, remainingToMax: 1 },
    ],
  };
  const plan = createStrategyPlan({
    sketches: {
      ...sketches,
      opus_attack: {
        ...sketches.opus_attack,
        rewards: [{ statName: "attack", amount: 5000 }],
      },
      opus_currency: {
        ...sketches.opus_currency,
        currencyRewards: [{ name: "Graphite", amount: 1e20 }],
      },
    },
    state: state(),
    targetId: "target",
    baseStats: state().battleStats,
    targetSimulation: { winRate: 0.35, trials: 100 },
    currentRun: richCurrentRun,
    strategyProfile: "transcendent-paragon",
    goalCurrencies: { Graphite: 10000 },
    farmSeconds: 60,
  });

  assert.equal(plan.profileModes.safeFarm.recommendation.id, "opus_currency");
  assert.equal(plan.profileModes.greedyFarm.recommendation.id, "opus_currency");
  assert.equal(plan.profileModes.bossApproach.recommendation.id, "opus_attack");
  assert.equal(plan.profileModes.redrawFishing.decision, "keep_run");
});

test("strategy planner returns profile-specific tools, stop farming advice and profile comparison", () => {
  const plan = createStrategyPlan({
    sketches,
    state: state({ sketchVictories: { target: 1 } }),
    targetId: "target",
    baseStats: state().battleStats,
    targetSimulation: { winRate: 0.55, trials: 100 },
    currentRun,
    strategyProfile: "3-masterpiece",
    profileIds: ["farm-q", "3-masterpiece", "transcendent-paragon"],
    targetWinRate: 0.5,
    farmSeconds: 60,
  });

  assert.equal(plan.profileRecommendations.guarantee.length > 0, true);
  assert.equal(plan.profileRecommendations.booster.length > 0, true);
  assert.equal(plan.profileRecommendations.eraser[0].id, "target");
  assert.equal(plan.profileRecommendations.eraser[0].action, "not_eligible");
  assert.equal(plan.profileRecommendations.meditation.length > 0, true);
  assert.equal(plan.stopFarming.decision, "attempt_target");
  assert.equal(plan.profileComparison.length, 3);
  assert.ok(plan.profileComparison.some((item) => item.id === "farm-q" && item.estimatedRuns != null));
  assert.ok(plan.profileComparison.some((item) => item.id === "transcendent-paragon"));
});

test("strategy planner exposes Priority 17 economy planning", () => {
  const richState = state({
    playerStats: {
      maxHp: "1e9",
      attack: "1e6",
      attackSpeed: "100",
      accuracy: "100",
      minDamage: "100",
      maxDamage: "100",
      burnDamage: "10",
    },
    battleStats: {
      maxHp: "1e9",
      attack: "1e6",
      attackSpeed: "100",
      accuracy: "100",
      minDamage: "100",
      maxDamage: "100",
      burnDamage: "10",
    },
    currencies: {
      Graphite: "100",
      Photon: "25",
      "Gold Leaf": "1",
      Acrylic: "50",
    },
    quintessence: "1e222",
    currencyGeneratorRates: {
      Graphite: 2,
      Photon: 0.5,
      "Gold Leaf": 0.05,
    },
    shopLevels: {
      upgrade_atk_graphite: 0,
      upgrade_secret_burn_damage_graphite: 0,
    },
    fundamentals: {
      ...state().fundamentals,
      generatorMultiplier: 2,
      graphiteGeneratorMultiplier: 3,
      photonGeneratorMultiplier: 4,
      goldLeafGeneratorMultiplier: 5,
      graphiteRewardMultiplier: 50,
      featMedalMultiplier: 2,
    },
  });

  const plan = createStrategyPlan({
    sketches,
    state: richState,
    targetId: "target",
    baseStats: richState.battleStats,
    targetSimulation: { winRate: 0.2, trials: 100 },
    currentRun,
    strategyProfile: "farm-photon",
    goalCurrencies: { Photon: 1000, "Gold Leaf": 10 },
    softcapSeconds: 120,
    farmSeconds: 60,
  });

  assert.ok(plan.economy);
  assert.ok(plan.economy.shopUpgrades.some((item) => item.id === "upgrade_atk_graphite" && item.nextLevel === 1 && item.affordable));
  assert.ok(plan.economy.purchasePlan.buyNow.some((item) => item.id === "upgrade_atk_graphite"));
  assert.equal(plan.economy.generatorEV.currencies.Graphite.perSecond, 12);
  assert.equal(plan.economy.generatorEV.currencies.Photon.perSecond, 4);
  assert.equal(plan.economy.softcapEV.waitCurrencies.Graphite.expected, 1440);
  assert.equal(plan.economy.secretStash.canUnlock, true);
  assert.ok(plan.economy.secretStash.hiddenUpgrades.some((item) => item.hidden && item.id === "upgrade_secret_burn_damage_graphite"));
  assert.equal(plan.economy.specialCurrencies.Photon.missing, 975);
  assert.ok(plan.economy.currencyForecasts.some((item) => item.currency === "Photon" && item.secondsToGoal > 0));
  assert.equal(plan.economy.bottlenecks[0].currency, "Photon");
});

test("strategy planner detects wasted rewards and purchase delays", () => {
  const lowValueSketches = {
    ...sketches,
    opus_hp: {
      ...sketches.opus_hp,
      rewards: [{ statName: "maxHp", amount: 0 }],
      currencyRewards: [{ name: "Graphite", amount: 0 }],
    },
  };
  const weakState = state({
    currencies: { Graphite: "1", Photon: "0" },
    currencyGeneratorRates: { Graphite: 0, Photon: 0 },
    shopLevels: { upgrade_atk_graphite: 0 },
  });
  const weakRun = {
    targets: [
      { id: "opus_hp", name: "Opus HP", rarity: "opus", winRate: 0.9, p90Seconds: 20, remainingToMax: 2 },
      { id: "target", name: "Target", rarity: "masterpiece", winRate: 0.1, p90Seconds: 100, remainingToMax: 1 },
    ],
  };

  const plan = createStrategyPlan({
    sketches: lowValueSketches,
    state: weakState,
    targetId: "target",
    baseStats: weakState.battleStats,
    targetSimulation: { winRate: 0.1, trials: 100 },
    currentRun: weakRun,
    strategyProfile: "farm-photon",
    goalCurrencies: { Photon: 1000 },
    farmSeconds: 60,
  });

  assert.ok(plan.economy.purchasePlan.delay.some((item) => item.id === "upgrade_atk_graphite" && item.currency === "Graphite"));
  assert.ok(plan.economy.wastedRewards.some((item) => item.id === "opus_hp" && item.reason === "zero_or_negative_reward"));
  assert.ok(plan.economy.bottlenecks.some((item) => item.currency === "Photon" && item.reason === "goal_currency_missing"));
});
