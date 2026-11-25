import test from "node:test";
import assert from "node:assert/strict";

import { runMonteCarlo } from "../src/combat.js";
import { combatAssumptionsFromSave } from "../src/combat-assumptions.js";
import { enemyFromSketch } from "../src/combat/steam-encounter.js";
import { simulateRoute } from "../src/route.js";
import { createEconomyPlan } from "../src/economy.js";
import {
  createStrategyPlan,
  parseStrategyCurrencyGoals,
  rankOpusStrategicValue,
  STRATEGY_PROFILES,
} from "../src/strategy-planner.js";

test("buy-now recommendations share a wallet in priority order", () => {
  const state = { currencies: { Graphite: 5, Wax: 1e80 }, secretStashUnlocked: true };
  const { purchasePlan } = createEconomyPlan({ state, targetStatWeights: { poisonChance: 10000 } });
  assert.ok(purchasePlan.buyNow.some((item) => item.currency === "Wax"));
  assert.deepEqual(purchasePlan.buyNow.filter((item) => item.currency === "Graphite").map((item) => item.cost), [5]);
  const hp = purchasePlan.delay.find((item) => item.id === "upgrade_hp_graphite");
  assert.equal(hp.currentCurrency, 0);
  assert.equal(hp.affordable, false);
  state.currencies.Graphite = 7;
  assert.deepEqual(createEconomyPlan({ state }).purchasePlan.buyNow
    .filter((item) => item.currency === "Graphite").map((item) => item.cost), [5, 2]);
});

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

test("custom progress requires every resource and uses the slowest outstanding goal for its ETA", () => {
  const farm = { id: "farm", name: "Farm", rarity: "rough", stats: { maxHp: 1, attack: 0, attackSpeed: 1000 },
    currencyRewards: [{ name: "Photon", amount: 10 }, { name: "Graphite", amount: 2 }] };
  const options = { sketches: { farm }, targetId: "farm", strategyProfile: "custom",
    state: { playerStats: { attack: 10, maxHp: 100, attackSpeed: 1000 }, currencies: { Photon: 10 } },
    currentRun: { targets: [{ id: "farm", winRate: 1, p90Seconds: 1 }] },
    targetSimulation: { winRate: 1, trials: 100 }, targetWinRate: 0.5, trials: 2, maxSeconds: 5 };
  const progress = (goalCurrencies) => createStrategyPlan({ ...options, goalCurrencies }).profileProgress;
  const photon = progress({ Photon: 100 });
  assert.equal(photon.unit, "Photon");
  assert.equal(photon.missing, 90);
  assert.equal(photon.averageRuns, 9);
  const combined = progress({ Photon: 100, Graphite: 40 });
  assert.equal(combined.unit, "Graphite");
  assert.equal(combined.averageRuns, 20);
  assert.equal(progress({ Photon: 10 }).decision, "goal_reached");
  const unavailable = progress({ Photon: 100, Ink: 1 });
  assert.equal(unavailable.unit, "Ink");
  assert.equal(unavailable.averageRuns, null);
  assert.equal(unavailable.decision, "need_better_income_source");
});

test("strategy requests more trials when the win interval crosses the configured threshold", () => {
  const targetRow = { id: "target", rarity: "masterpiece", winRate: 0.51, trials: 100 };
  const options = {
    sketches,
    state: state(),
    targetId: "target",
    currentRun: { targets: [targetRow] },
    compareProfiles: ["farm-q"],
    trials: 20,
  };
  // The fallback current-run estimate and the explicit simulation should agree.
  for (const targetSimulation of [undefined, { winRate: 0.51, wins: 51, trials: 100 }]) {
    const plan = createStrategyPlan({ ...options, targetSimulation });
    assert.equal(plan.approach.winRate.ci95Lower.toFixed(3), "0.413");
    assert.equal(plan.approach.winRate.ci95Upper.toFixed(3), "0.606");
    assert.equal(plan.approach.ready, false);
    assert.equal(plan.approach.decision, "increase_trials");
    assert.equal(plan.stopFarming.decision, "increase_trials");
    assert.equal(plan.farmPlan.decision, "increase_trials");
    assert.equal(plan.profileProgress.decision, "increase_trials");
    assert.equal(plan.masterpieceRoll.decision, "keep_scout");
    assert.equal(plan.runCompletion.decision, "increase_trials");
  }

  for (const [winRate, lower, upper, ready, decision] of [
    [0.51, 0.5, 0.61, true, "attempt_target"],
    [0.49, 0.39, 0.5, false, "increase_trials"],
    [0.49, 0.39, 0.4999, false, "redraw"],
  ]) {
    const plan = createStrategyPlan({
      ...options,
      targetSimulation: { winRate, winRateCi95: { lower, upper } },
    });
    assert.equal(plan.approach.ready, ready);
    assert.equal(plan.stopFarming.decision, decision);
  }

  const custom = createStrategyPlan({ ...options, targetWinRate: 0.6 });
  assert.equal(custom.stopFarming.decision, "increase_trials");
  assert.equal(custom.runCompletion.decision, "increase_trials");

  const legacy = createStrategyPlan({ ...options, targetSimulation: { winRate: 0.51 } });
  assert.equal(legacy.approach.ready, true);
  assert.equal(legacy.stopFarming.decision, "attempt_target");
});

test("farming currency or an irrelevant stat does not cross a nearby target threshold", () => {
  const plan = createStrategyPlan({
    sketches,
    state: state(),
    baseStats: { maxHp: 1000, attack: 40, attackSpeed: 1000, accuracy: 50, minDamage: 100, maxDamage: 100 },
    targetId: "target",
    targetSimulation: { winRate: 0.499 },
    currentRun: { targets: [{ id: "opus_currency", winRate: 1 }, { id: "opus_hp", winRate: 1 }] },
    targetWinRate: 0.5,
    trials: 24,
    maxSeconds: 7,
  });

  assert.equal(plan.stopFarming.decision, "redraw");
  assert.ok(plan.profileModes.greedyFarm.candidates.some((row) => row.id === "opus_currency" && row.currencyValue > 0));
  assert.equal(plan.runEV.currencies.Graphite.battlePerSecond, null);
  assert.ok(plan.runEV.currencies.Graphite.battleExpectedPerRun > 0);
  assert.deepEqual(plan.stopFarming.curve.map(({ projectedWinRate, gain, reachesTarget }) => (
    { projectedWinRate, gain, reachesTarget }
  )), [
    { projectedWinRate: 0.499, gain: 0, reachesTarget: false },
    { projectedWinRate: 0.499, gain: 0, reachesTarget: false },
    { projectedWinRate: 0.499, gain: 0, reachesTarget: false },
  ]);
});

test("farming projects detrimental rewards using the same target samples", () => {
  const plan = createStrategyPlan({
    sketches: {
      ...sketches,
      target: { ...sketches.target, stats: { ...sketches.target.stats, dodge: 50 } },
      opus_attack: { ...sketches.opus_attack, rewards: [{ statName: "attack", amount: -5 }] },
    },
    state: state(),
    baseStats: { maxHp: 1000, attack: 40, attackSpeed: 1000, accuracy: 50, minDamage: 100, maxDamage: 100 },
    targetId: "target",
    targetSimulation: { winRate: 0.499 },
    currentRun: { targets: [{ id: "opus_attack", winRate: 1 }] },
    targetWinRate: 0.5,
    trials: 120,
    maxSeconds: 7,
    seed: "pair",
  });

  assert.equal(plan.stopFarming.decision, "redraw");
  assert.ok(plan.stopFarming.curve[0].gain < 0);
  assert.equal(plan.stopFarming.curve[0].reachesTarget, false);
});

test("farming verifies cumulative victories, decay and boosters against paired target trials", () => {
  const pairedSketches = {
    ...sketches,
    target: { ...sketches.target, stats: { ...sketches.target.stats, dodge: 50 } },
    opus_attack: { ...sketches.opus_attack, rewards: [{ statName: "attack", amount: 20 }] },
    opus_hp: { ...sketches.opus_hp, rewards: [{ statName: "attack", amount: 5 }] },
  };
  const saveState = state({
    sketchVictories: { opus_attack: 1, opus_currency: 2 },
    boostedSketchIds: ["opus_attack"],
    fundamentals: { maxVictories: 2, rewardDecay: 3, rewardBoosterEffect: 100 },
  });
  const baseStats = { maxHp: 1000, attack: 35, attackSpeed: 1000, accuracy: 50, minDamage: 100, maxDamage: 100 };
  const sample = { trials: 120, maxSeconds: 7, seed: "pair:farm-curve", enemy: enemyFromSketch(pairedSketches.target) };
  const winsWithAttack = (attack) => runMonteCarlo({ ...sample, player: { ...baseStats, attack } }).winRate;
  const current = winsWithAttack(35);
  const targetWinRate = 0.7;
  const options = {
    sketches: pairedSketches,
    state: saveState,
    baseStats,
    targetId: "target",
    targetSimulation: { winRate: current },
    currentRun: { targets: [
      { id: "opus_attack", winRate: 1 }, { id: "opus_hp", winRate: 1 },
      { id: "opus_currency", winRate: 1 }, { id: "target", winRate: current },
    ] },
    targetWinRate,
    trials: sample.trials,
    maxSeconds: sample.maxSeconds,
    seed: "pair",
  };
  const plan = createStrategyPlan(options);

  assert.equal(plan.stopFarming.decision, "farm_until_step");
  assert.equal(plan.stopFarming.targetStep, 2);
  assert.equal(plan.stopFarming.targetSketchId, "opus_hp");
  assert.deepEqual(plan.stopFarming.curve.map(({ id }) => id), ["opus_attack", "opus_hp"]);
  assert.equal(plan.stopFarming.curve[0].projectedWinRate, winsWithAttack(45));
  assert.equal(plan.stopFarming.curve[0].reachesTarget, false);
  assert.ok(Math.abs(plan.stopFarming.curve[1].projectedWinRate - winsWithAttack(50)) < 1e-6);

  const mismatchedBaseline = createStrategyPlan({
    ...options,
    targetSimulation: { winRate: 0.49 },
    currentRun: { targets: [{ id: "opus_attack", winRate: 1 }] },
  });
  assert.ok(mismatchedBaseline.stopFarming.curve[0].projectedWinRate > targetWinRate);
  assert.equal(mismatchedBaseline.stopFarming.curve[0].reachesTarget, false);
  assert.equal(mismatchedBaseline.stopFarming.decision, "farm_more");
});

test("strategy and economy resolve softcap deadlines against the same reference time", () => {
  const deadline = 1700000000000;
  const options = { state: { nextSoftcapAt: deadline }, targetId: "target", trials: 1 };
  for (const [offset, seconds, decision] of [[-60000, 60, "wait_softcap"], [0, 0, "softcap_reached"], [1000, 0, "softcap_reached"]]) {
    const input = { ...options, referenceTimeMs: deadline + offset };
    const plan = createStrategyPlan(input);
    for (const result of [plan.softcap, plan.economy.softcapEV, createEconomyPlan(input).softcapEV]) {
      assert.equal(result.secondsToSoftcap, seconds);
      assert.equal(result.decision, decision);
    }
  }
  assert.equal(createStrategyPlan({ ...options, softcapSeconds: 20 }).softcap.secondsToSoftcap, 20);
  assert.equal(createStrategyPlan({ ...options, state: {} }).softcap.secondsToSoftcap, null);
});

test("farming uses the Steam universe for both the target and the next reward", () => {
  const steamSketches = {
    ...sketches,
    target: { ...sketches.target, stats: { ...sketches.target.stats, dodge: 50 } },
    opus_attack: { ...sketches.opus_attack, rewards: [{ statName: "attack", amount: 32 }] },
  };
  const saveState = state({ saveProfile: "steam", multiverse: { currentUniverseId: "mv-medium-2" } });
  const assumptions = combatAssumptionsFromSave(saveState);
  const baseStats = { maxHp: 1000, attack: 75, attackSpeed: 1000, accuracy: 50, minDamage: 100, maxDamage: 100 };
  const sample = { trials: 120, maxSeconds: 7, seed: "pair:farm-curve", enemy: enemyFromSketch(steamSketches.target), assumptions };
  const current = runMonteCarlo({ ...sample, player: baseStats }).winRate;
  const plan = createStrategyPlan({
    sketches: steamSketches,
    state: saveState,
    assumptions,
    baseStats,
    targetId: "target",
    targetSimulation: { winRate: current },
    currentRun: { targets: [{ id: "opus_attack", winRate: 1 }] },
    targetWinRate: 0.7,
    trials: sample.trials,
    maxSeconds: sample.maxSeconds,
    seed: "pair",
  });
  const next = runMonteCarlo({ ...sample, player: { ...baseStats, attack: 99 } });

  assert.ok(next.winRate > current);
  assert.equal(plan.stopFarming.curve[0].projectedWinRate, Number(next.winRate.toFixed(6)));
  assert.ok(next.winRate >= 0.7 && next.winRateCi95.lower < 0.7);
  assert.equal(plan.stopFarming.curve[0].reachesTarget, false);
  assert.equal(plan.stopFarming.decision, "farm_until_step");
  assert.ok(plan.stopFarming.targetStep > 1);
});

test("farming checks a second win on the same sketch with decay and the victory cap", () => {
  const options = {
    sketches: {
      ...sketches,
      target: { ...sketches.target, stats: { ...sketches.target.stats, maxHp: 100 } },
      opus_attack: { ...sketches.opus_attack, rewards: [{ statName: "attack", amount: 40 }] },
    },
    baseStats: { maxHp: 1000, attack: 42, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    targetId: "target",
    targetSimulation: { winRate: 0 },
    currentRun: { targets: [{ id: "opus_attack", winRate: 1, remainingToMax: 2 }] },
    trials: 20,
    maxSeconds: 1.5,
  };
  const twoWins = createStrategyPlan({ ...options, state: state() }).stopFarming;
  assert.equal(twoWins.decision, "farm_until_step");
  assert.equal(twoWins.targetStep, 2);
  assert.equal(twoWins.targetSketchId, "opus_attack");
  assert.deepEqual(twoWins.curve.map(({ id, victoryNumber, projectedWinRate }) => (
    [id, victoryNumber, projectedWinRate]
  )), [["opus_attack", 1, 0], ["opus_attack", 2, 1]]);

  const atCap = createStrategyPlan({
    ...options,
    state: state({ fundamentals: { maxVictories: 1, rewardDecay: 1 } }),
  }).stopFarming;
  assert.equal(atCap.decision, "redraw");
  assert.equal(atCap.hasUnverifiedCandidates, false);
  assert.equal(atCap.curve.length, 1);

  const steeperDecay = createStrategyPlan({
    ...options,
    state: state({ fundamentals: { maxVictories: 2, rewardDecay: 3 } }),
  }).stopFarming;
  assert.equal(steeperDecay.decision, "redraw");
  assert.deepEqual(steeperDecay.curve.map(({ projectedWinRate }) => projectedWinRate), [0, 0]);
});

test("farming distinguishes unchecked repeats from a completed search of the visible path", () => {
  const options = {
    sketches: {
      ...sketches,
      opus_attack: { ...sketches.opus_attack, rewards: [{ statName: "attack", amount: 1 }] },
    },
    baseStats: { maxHp: 1000, attack: 42, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    targetId: "target",
    targetSimulation: { winRate: 0 },
    currentRun: { targets: [{ id: "opus_attack", winRate: 1 }] },
    state: state({ fundamentals: { maxVictories: 250, rewardDecay: 1 } }),
    trials: 2,
    maxSeconds: 1.5,
  };
  const capped = createStrategyPlan(options).stopFarming;
  assert.equal(capped.curve.length, 8);
  assert.equal(capped.hasUnverifiedCandidates, true);
  assert.equal(capped.decision, "farm_more");
  assert.equal(capped.reason, "visible_rewards_need_target_verification");

  const firstRewardWeakensPlayer = createStrategyPlan({
    ...options,
    state: state(),
    sketches: {
      ...options.sketches,
      opus_attack: {
        ...options.sketches.opus_attack,
        stats: { ...sketches.opus_attack.stats, attack: 100, attackSpeed: 500 },
        rewards: [{ statName: "maxHp", amount: -990 }, { statName: "attack", amount: 100 }],
      },
    },
  }).stopFarming;
  assert.equal(firstRewardWeakensPlayer.curve.length, 1);
  assert.equal(firstRewardWeakensPlayer.hasUnverifiedCandidates, true);
  assert.equal(firstRewardWeakensPlayer.decision, "farm_more");
});

test("farming verifies a different sketch's first win before adding its reward", () => {
  const baseStats = { maxHp: 1000, attack: 42, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 };
  const candidates = {
    ...sketches,
    opus_hp: {
      ...sketches.opus_hp,
      rewards: [{ statName: "maxHp", amount: -990 }, { statName: "critDamage", amount: 1e60 }],
    },
    opus_currency: { ...sketches.opus_currency, rewards: [{ statName: "attack", amount: 1 }] },
    opus_attack: {
      ...sketches.opus_attack,
      stats: { maxHp: 10, attack: 100, attackSpeed: 500, accuracy: 100, minDamage: 100, maxDamage: 100 },
      rewards: [{ statName: "attack", amount: 100 }],
    },
    target: { ...sketches.target, stats: { ...sketches.target.stats, maxHp: 100 } },
  };
  const fight = { enemy: enemyFromSketch(candidates.opus_attack), trials: 20, maxSeconds: 1.5 };
  assert.equal(runMonteCarlo({ ...fight, player: baseStats }).wins, 20);
  assert.equal(runMonteCarlo({ ...fight, player: { ...baseStats, maxHp: 10 } }).wins, 0);

  const { runEV, stopFarming } = createStrategyPlan({
    sketches: candidates,
    state: state({ fundamentals: { maxVictories: 1, rewardDecay: 1 } }),
    baseStats,
    targetId: "target",
    targetSimulation: { winRate: 0 },
    currentRun: { targets: ["opus_hp", "opus_attack", "opus_currency"].map((id) => ({ id, winRate: 1 })) },
    trials: 200,
    maxSeconds: fight.maxSeconds,
  });
  assert.deepEqual(runEV.sketches.map(({ id }) => id), ["opus_hp", "opus_attack", "opus_currency"]);
  assert.deepEqual(stopFarming.curve.map(({ id, projectedWinRate }) => [id, projectedWinRate]), [
    ["opus_hp", 0], ["opus_currency", 0],
  ]);
  assert.equal(stopFarming.hasUnverifiedCandidates, true);
  assert.equal(stopFarming.decision, "farm_more");
});

test("an explicitly empty current run does not fall back to available sketches", () => {
  const saveState = state({ hiddenSketches: ["opus_currency"] });
  const options = { sketches, state: saveState, targetId: "target", goalCurrencies: { Graphite: 1000 } };
  const empty = createStrategyPlan({ ...options, currentRun: { targets: [] } });
  const fallback = createStrategyPlan(options);

  assert.deepEqual(empty.runEV.sketches, []);
  assert.deepEqual(empty.farmPlan.bestOpusTargets, []);
  assert.equal(empty.masterpieceRoll.decision, "redraw");
  assert.equal(empty.runCompletion.decision, "redraw");
  assert.equal(empty.stopFarming.decision, "redraw");
  assert.ok(empty.opusValues.every(({ id }) => id !== "opus_currency"));
  assert.ok(fallback.runEV.sketches.some(({ id }) => id === "opus_attack"));
  assert.ok(fallback.runEV.sketches.every(({ id }) => id !== "opus_currency"));
});

test("strategy candidates and run EV retain the uncertainty of input fight times", () => {
  const plan = createStrategyPlan({
    sketches,
    state: state(),
    targetId: "target",
    targetSimulation: { winRate: 0.5 },
    currentRun: { targets: [
      { id: "opus_currency", winRate: 0.8, p90Seconds: 45, p90Censored: true },
      { id: "opus_hp", winRate: 0.6, medianSeconds: 30, medianCensored: true },
    ] },
  });

  const candidates = Object.fromEntries(plan.profileModes.greedyFarm.candidates.map((row) => [row.id, row]));
  const estimates = Object.fromEntries(plan.runEV.sketches.map((row) => [row.id, row]));
  assert.equal(candidates.opus_currency.p90Seconds, 45);
  assert.equal(candidates.opus_currency.p90Censored, true);
  assert.equal(estimates.opus_currency.seconds, 45);
  assert.equal(estimates.opus_currency.secondsCensored, true);
  assert.equal(estimates.opus_hp.seconds, 30);
  assert.equal(estimates.opus_hp.secondsCensored, true);
});

test("a farm window earns a battle payout only once the fight fits in the window", () => {
  const input = {
    sketches: {
      ...sketches,
      opus_currency: {
        ...sketches.opus_currency,
        currencyRewards: [{ name: "Photon", amount: 100 }],
      },
    },
    state: state({ currencies: {}, currencyGeneratorRates: { Graphite: 2 } }),
    targetId: "target",
    targetSimulation: { winRate: 0.5 },
    currentRun: { targets: [{ id: "opus_currency", winRate: 1, p90Seconds: 120 }] },
    strategyProfile: "farm-photon",
    goalCurrencies: { Photon: 100 },
  };
  for (const [farmSeconds, expected] of [[5, 0], [119.5, 0], [120, 100], [240, 100]]) {
    const plan = createStrategyPlan({ ...input, farmSeconds });
    const { runEV, economy } = plan;
    assert.equal(runEV.routeSeconds, 120);
    assert.equal(runEV.windowTimingIncomplete, false);
    assert.equal(runEV.currencies.Photon.expected, expected);
    assert.equal(runEV.currencies.Photon.battleWindowExpected, expected);
    assert.equal(runEV.currencies.Photon.expectedPerRun, 100);
    assert.equal(runEV.currencies.Graphite.expected, farmSeconds * 2);
    assert.equal(runEV.currencies.Graphite.expectedPerRun, 240);
    assert.equal(runEV.quintessence.expected, farmSeconds * 2);
    assert.equal(runEV.quintessence.expectedPerRun, 240);
    assert.equal(plan.profileProgress.expectedPerRun, 100);
    assert.equal(economy.specialCurrencies.Photon.expectedPerRun, 100);
    assert.equal(economy.specialCurrencies.Photon.runsToGoal, 1);
    assert.equal(economy.currencyForecasts.find(({ currency }) => currency === "Photon").expectedPerRun, 100);
    assert.equal(economy.specialCurrencies.Photon.secondsToGoal, plan.farmPlan.goal.estimatedSeconds);
    assert.ok(Math.abs(economy.specialCurrencies.Photon.secondsToGoal - 120) < 0.001);
    assert.equal(plan.softcap.runValue, runEV.totalValuePerRun);
    assert.equal(economy.softcapEV.runValue, runEV.totalValuePerRun);
  }
});

test("unknown and censored fight times preserve the timed prefix without crediting later fights", () => {
  const input = {
    sketches: {
      ...sketches,
      opus_currency: { ...sketches.opus_currency, currencyRewards: [{ name: "Graphite", amount: 100 }] },
      opus_attack: { ...sketches.opus_attack, currencyRewards: [{ name: "Photon", amount: 200 }] },
      target: { ...sketches.target, currencyRewards: [{ name: "Graphite", amount: 300 }] },
    },
    state: state({ currencies: {}, currencyGeneratorRates: { Graphite: 2 } }),
    targetId: "target",
    targetSimulation: { winRate: 0.5 },
    goalCurrencies: { Graphite: 500, Photon: 100 },
    farmSeconds: 30,
  };
  for (const [timing, windowTimingIncomplete] of [
    [{}, true],
    [{ p90Seconds: 15, p90Censored: true }, true],
    [{ p90Seconds: 40, p90Censored: true }, false],
  ]) {
    const plan = createStrategyPlan({ ...input, currentRun: { targets: [
      { id: "opus_currency", winRate: 1, medianSeconds: 10 },
      { id: "opus_attack", winRate: 0.5, ...timing },
      { id: "target", winRate: 1, p90Seconds: 5 },
    ] } });
    const { runEV, economy } = plan;
    assert.equal(runEV.routeSeconds, null);
    assert.equal(runEV.windowTimingIncomplete, windowTimingIncomplete);
    assert.equal(runEV.sketches.find(({ id }) => id === "opus_attack").seconds, timing.p90Seconds ?? null);
    assert.equal(runEV.currencies.Graphite.expected, 160);
    assert.equal(runEV.currencies.Graphite.expectedPerRun, 400);
    assert.equal(runEV.currencies.Graphite.passiveExpectedPerRun, null);
    assert.equal(runEV.currencies.Graphite.battlePerSecond, null);
    assert.equal(runEV.currencies.Graphite.perSecond, 2);
    assert.equal(runEV.currencies.Photon.expected, 0);
    assert.equal(runEV.currencies.Photon.expectedPerRun, 100);
    assert.equal(runEV.statValue, 0);
    assert.ok(runEV.statValuePerRun > 0);
    assert.equal(economy.specialCurrencies.Photon.runPerSecond, null);
    assert.equal(economy.specialCurrencies.Photon.secondsToGoal, null);
    assert.equal(economy.currencyForecasts.find(({ currency }) => currency === "Graphite").secondsToGoal, 250);
  }
});

test("strategy currency forecasts divide battle rewards by time spent on all eligible fights", () => {
  const farming = {
    opus_currency: { ...sketches.opus_currency, currencyRewards: [{ name: "Graphite", amount: 100 }] },
    opus_attack: { ...sketches.opus_attack, currencyRewards: [{ name: "Photon", amount: 100 }] },
    target: { ...sketches.target, currencyRewards: [{ name: "Graphite", amount: 900 }] },
  };
  const input = {
    sketches: farming,
    state: state({
      currencies: {},
      currencyGeneratorRates: {},
      sketchVictories: { target: 2 },
    }),
    targetId: "target",
    currentRun: { targets: currentRun.targets.map((row) => ({ ...row, winRate: 1, p90Seconds: 10 })) },
    goalCurrencies: { Graphite: 100, Photon: 100 },
  };
  const plan = createStrategyPlan({ ...input, farmSeconds: 20 });
  const short = createStrategyPlan({ ...input, farmSeconds: 10 });

  assert.deepEqual(plan.runEV.sketches.map(({ id }) => id), ["opus_attack", "opus_currency"]);
  assert.equal(plan.runEV.currencies.Graphite.battlePerSecond, 5);
  assert.equal(plan.runEV.currencies.Photon.battlePerSecond, 5);
  assert.equal(plan.economy.currencyForecasts.find(({ currency }) => currency === "Graphite").secondsToGoal, 20);
  assert.equal(plan.economy.specialCurrencies.Photon.secondsToGoal, 20);
  assert.equal(short.runEV.currencies.Graphite.expected, 100);
  assert.equal(short.runEV.currencies.Photon.expected, 0);
  assert.equal(short.runEV.currencies.Photon.expectedPerRun, 100);
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

test("Steam strategy EV and Opus rankings use the same next-win payout as routes", () => {
  const steamSketches = {
    ...sketches,
    opus_currency: {
      ...sketches.opus_currency,
      currencyRewards: [{ name: "Photon", amount: 1000 }, { name: "Graphite", amount: 20 }],
      rewards: [{ statName: "attack", amount: 100 }],
    },
    opus_hp: {
      ...sketches.opus_hp,
      currencyRewards: [{ name: "Photon", amount: 500 }],
    },
  };
  const steamState = state({
    saveProfile: "steam",
    gameMode: "easy",
    currencyGeneratorRates: {},
    boostedSketchIds: ["opus_currency"],
    sketchVictories: { opus_currency: 1 },
    multiverse: {
      currentUniverseId: "mv-hard-2",
      firstClearPerkIds: ["first-ten-wins-currency"],
      collectibles: { cards: { opus_currency: { normal: 1, shiny: 1 } } },
    },
  });
  const route = simulateRoute({ state: steamState, sketches: steamSketches, routeIds: ["opus_currency"] });
  const { currencyRewards, statRewards } = route.steps[0];
  assert.deepEqual(currencyRewards.map(({ name, amount }) => [name, amount]), [["Photon", 0], ["Graphite", 900]]);
  assert.equal(statRewards[0].amount, 40.5);

  const plan = createStrategyPlan({
    state: steamState,
    sketches: steamSketches,
    targetId: "target",
    currentRun: { targets: [{ id: "opus_currency", winRate: 0.5, p90Seconds: 10 }] },
    goalCurrencies: { Photon: 1000 },
  });
  const entry = plan.runEV.sketches.find(({ id }) => id === "opus_currency");
  assert.deepEqual(entry.expectedCurrencies, { Photon: 0, Graphite: 450 });
  const ranked = plan.opusValues.find(({ id }) => id === "opus_currency");
  assert.deepEqual(ranked.bestCurrency, { name: "Graphite", amount: 900 });
  assert.equal(ranked.bestStats[0].amount, statRewards[0].amount);
  assert.ok(Math.abs(entry.expectedStatScore - ranked.statScore * 0.5) <= 1e-6);
  const photonOnly = plan.opusValues.find(({ id }) => id === "opus_hp");
  assert.equal(photonOnly.currencyScore, 0);
  assert.equal(photonOnly.bestCurrency, null);
});

test("Steam run EV accounts for earlier fights exhausting the first-ten-win currency perk", () => {
  const steamSketches = {
    ...sketches,
    opus_attack: {
      ...sketches.opus_attack,
      currencyRewards: [{ name: "Graphite", amount: 20 }],
    },
  };
  const steamState = state({
    saveProfile: "steam",
    currentUniverseBoostedCurrencyWins: 9,
    multiverse: { firstClearPerkIds: ["first-ten-wins-currency"] },
    currencyGeneratorRates: {},
  });
  const twoWins = simulateRoute({ state: steamState, sketches: steamSketches, routeIds: ["opus_currency", "opus_attack"] });
  const oneWin = simulateRoute({ state: steamState, sketches: steamSketches, routeIds: ["opus_attack"] });
  const plan = createStrategyPlan({
    state: steamState,
    sketches: steamSketches,
    targetId: "target",
    currentRun: { targets: [{ id: "opus_currency", winRate: 0.5 }, { id: "opus_attack", winRate: 1 }] },
  });
  const fullPayout = oneWin.steps[0].currencyRewards[0].amount;
  const reducedPayout = twoWins.steps[1].currencyRewards[0].amount;
  assert.equal(fullPayout, 200);
  assert.equal(reducedPayout, 20);
  assert.equal(plan.runEV.sketches.find(({ id }) => id === "opus_attack").expectedCurrencies.Graphite,
    (fullPayout + reducedPayout) / 2);
  assert.equal(plan.opusValues.find(({ id }) => id === "opus_attack").bestCurrency.amount, fullPayout);
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

test("booster comparisons omit configurations containing a hidden sketch", () => {
  const plan = createStrategyPlan({
    sketches,
    state: state({ hiddenSketches: ["opus_currency"] }),
    targetId: "target",
    boosterCandidates: [
      { name: "mixed", ids: ["opus_attack", "opus_currency"] },
      { name: "visible", ids: ["opus_attack"] },
    ],
    trials: 4,
    maxSeconds: 5,
  });

  assert.equal(plan.boosters.recommendation.name, "visible");
  assert.deepEqual(plan.boosters.choices.map(({ name }) => name), ["visible"]);
});

test("farm decisions use the uncertainty and fight time of the Opus payout", () => {
  const jackpot = { ...sketches.opus_currency, currencyRewards: [{ name: "Photon", amount: 1e6 }] };
  const options = { sketches: { ...sketches, [jackpot.id]: jackpot }, state: state({ availableSketches: [jackpot.id] }),
    goalCurrencies: { Photon: 1000 }, targetId: "target", targetSimulation: { winRate: 0 }, trials: 5 };
  const plan = (winRate, trials, p90Seconds) => createStrategyPlan({ ...options,
    currentRun: { targets: [{ id: jackpot.id, winRate, trials, p90Seconds }] } });

  const noWins = plan(0, 100, 60);
  assert.equal(noWins.runEV.currencies.Photon.battleExpectedPerRun, 0);
  assert.equal(noWins.farmPlan.bestOpusTargets[0].expectedValuePerMinute, 0);
  assert.equal(noWins.masterpieceRoll.decision, "redraw");
  assert.equal(noWins.runCompletion.decision, "redraw");
  assert.equal(noWins.farmPlan.decision, "redraw");

  const smallSample = plan(0, 5, 60);
  assert.equal(smallSample.masterpieceRoll.decision, "increase_trials");
  assert.equal(smallSample.runCompletion.reason, "opus_farm_return_uncertain");
  assert.equal(smallSample.stopFarming.reason, "opus_farm_return_uncertain");
  assert.ok(smallSample.runCompletion.bestOpus.upperValuePerMinute > 10);

  const fast = plan(0.2, 100, 60);
  assert.equal(fast.masterpieceRoll.decision, "keep_farm");
  assert.equal(fast.masterpieceRoll.targetId, jackpot.id);
  assert.equal(fast.runCompletion.decision, "finish_opus_farm");
  const slow = plan(0.2, 100, 600);
  assert.equal(slow.masterpieceRoll.decision, "redraw");
  assert.equal(slow.runCompletion.decision, "redraw");
});

test("booster recommendations require accessible, beatable route steps and incremental gains", () => {
  const impossible = { ...sketches.opus_attack, id: "impossible",
    stats: { maxHp: 1e9, attack: 1e9, attackSpeed: 10 }, rewards: [{ statName: "attack", amount: 1e9 }] };
  const absent = { ...impossible, id: "absent", stats: sketches.opus_currency.stats };
  const health = { ...sketches.opus_hp, rewards: [{ statName: "maxHp", amount: 30 }] };
  const plan = createStrategyPlan({
    sketches: { ...sketches, impossible, absent, [health.id]: health },
    state: state({ availableSketches: ["impossible", "opus_attack", "opus_currency", "opus_hp", "target"],
      hiddenSketches: ["opus_currency"], sketchVictories: { opus_attack: 2 } }),
    targetId: "target",
    boosterCandidates: [
      { name: "Absent reward", ids: ["absent"] },
      { name: "Impossible second fight", ids: ["opus_hp", "impossible"] },
      { name: "Hidden", ids: ["opus_currency"] },
      { name: "Capped", ids: ["opus_attack"] },
      { name: "Unknown", ids: ["unknown"] },
      { name: "Over cap", ids: ["opus_hp", "opus_hp", "opus_hp"] },
      { name: "Reachable reward", ids: ["opus_hp"] },
    ],
    trials: 20,
    maxSeconds: 5,
  });

  assert.deepEqual(plan.boosters.choices.map(({ name }) => name), ["Reachable reward", "Impossible second fight"]);
  assert.equal(plan.boosters.recommendation.name, "Reachable reward");
  const failedRoute = plan.boosters.choices[1];
  assert.equal(failedRoute.conditional, true);
  assert.equal(failedRoute.winRate, 1);
  assert.equal(failedRoute.routeWinRate, 0);
  assert.equal(failedRoute.jointWinRate, 0);
  assert.deepEqual(failedRoute.steps.map(({ fightSimulation }) => fightSimulation.winRate), [1, 0]);
});

test("a favorable projected fight still requires an available target", () => {
  const options = { sketches, targetId: "target", targetSimulation: { winRate: 1, trials: 100 }, trials: 1,
    currentRun: { targets: [{ id: "target", winRate: 1 }, { id: "opus_currency", winRate: 1 }] } };
  for (const overrides of [
    { availableSketches: ["opus_currency"] }, { hiddenSketches: ["target"] }, { sketchVictories: { target: 2 } },
  ]) {
    const plan = createStrategyPlan({ ...options, state: state(overrides) });
    assert.equal(plan.target.availableNow, false);
    assert.equal(plan.approach.conditional, true);
    assert.equal(plan.approach.ready, false);
    assert.notEqual(plan.stopFarming.decision, "attempt_target");
    assert.notEqual(plan.runCompletion.decision, "fight_target");
  }
});

test("the masterpiece roll prefers another wanted target with supported odds", () => {
  const wanted = { ...sketches.target, id: "wanted" };
  const plan = createStrategyPlan({ sketches: { ...sketches, wanted }, targetId: "target", masterpieceTargetIds: ["wanted"],
    state: state({ availableSketches: ["target", "wanted"] }), targetSimulation: { winRate: 0.8, trials: 4 },
    currentRun: { targets: [{ id: "target", winRate: 0.8, trials: 4 }, { id: "wanted", winRate: 0.7, trials: 100 }] },
    trials: 1 });
  assert.equal(plan.masterpieceRoll.decision, "keep_target");
  assert.equal(plan.masterpieceRoll.targetId, "wanted");
});

test("createStrategyPlan uses the same fight samples after renaming a booster choice", () => {
  const plan = createStrategyPlan({
    sketches: { ...sketches, target: { ...sketches.target, stats: { ...sketches.target.stats, dodge: 50 } } },
    state: state(),
    targetId: "target",
    baseStats: { maxHp: 1000, attack: 60, attackSpeed: 1000, accuracy: 50, minDamage: 100, maxDamage: 100 },
    targetSimulation: { winRate: 0.1, trials: 24 },
    currentRun,
    boosterCandidates: [
      { name: "First", ids: ["opus_currency"] },
      { name: "Renamed", ids: ["opus_currency"] },
    ],
    trials: 24,
    maxSeconds: 6,
    seed: "same-booster",
  });
  const [first, renamed] = plan.boosters.choices;

  assert.deepEqual(renamed, { ...first, name: "Renamed" });
  assert.ok(first.winRate > 0 && first.winRate < 1);
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
    targetSimulation: { winRate: 0.65, trials: 100 },
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

test("the Paragon profile uses its own target's result and the effective threshold", () => {
  const paragon = "transcendent_paragon";
  const profile = "transcendent-paragon";
  const options = {
    sketches: { ...sketches, [paragon]: { ...sketches.target, id: paragon } },
    state: state(),
    targetId: "opus_currency",
    targetSimulation: { winRate: 1, trials: 20 },
    currentRun: { targets: [{ id: paragon, winRate: 0, trials: 20 }] },
    compareProfiles: [profile],
    trials: 20,
  };
  const selected = createStrategyPlan({ ...options, profile });
  assert.deepEqual(selected.profile.goal, {
    type: "target_win_rate", current: 0, goal: 0.6, missing: 0.6, targetId: paragon, needsMoreTrials: false,
  });
  assert.notEqual(selected.profileProgress.decision, "goal_reached");
  assert.deepEqual(selected.profileComparison[0].goal, selected.profile.goal);
  assert.equal(selected.profileComparison[0].decision, selected.profileProgress.decision);

  const compared = createStrategyPlan(options).profileComparison[0];
  assert.deepEqual(compared.goal, selected.profile.goal);
  assert.notEqual(compared.decision, "goal_reached");

  const manual = createStrategyPlan({
    ...options,
    profile,
    targetId: paragon,
    targetSimulation: { winRate: 0.7, trials: 20 },
    targetWinRate: 0.9,
  });
  assert.equal(manual.profile.goal.current, 0.7);
  assert.equal(manual.profileProgress.missing, 0.2);
  assert.notEqual(manual.profileProgress.decision, "goal_reached");
  assert.deepEqual(manual.profileComparison[0].goal, manual.profile.goal);
  assert.equal(manual.profileComparison[0].decision, manual.profileProgress.decision);

  const manualComparison = createStrategyPlan({
    ...options,
    targetComparisons: [{ id: paragon, winRate: 0.7, trials: 20 }],
    targetWinRate: 0.9,
  }).profileComparison[0];
  assert.deepEqual(manualComparison.goal, manual.profile.goal);
  assert.equal(manualComparison.decision, manual.profileProgress.decision);

  const uncertain = createStrategyPlan({
    ...options,
    profile,
    targetComparisons: [{ id: paragon, winRate: 0.61, trials: 100 }],
  });
  assert.equal(uncertain.profile.goal.missing, 0);
  assert.equal(uncertain.profile.goal.needsMoreTrials, true);
  assert.equal(uncertain.profileProgress.decision, "increase_trials");
  assert.equal(uncertain.profileComparison[0].decision, "increase_trials");
});

test("the Paragon profile simulates its target when it is absent from the current roll", () => {
  const paragon = "transcendent_paragon";
  const options = {
    state: state(),
    profile: "transcendent-paragon",
    targetId: "opus_currency",
    targetSimulation: { winRate: 1 },
    currentRun: { targets: [] },
    trials: 2,
    maxSeconds: 1.5,
  };
  const inactive = createStrategyPlan({
    ...options,
    sketches: { ...sketches, [paragon]: { ...sketches.target, id: paragon } },
  });
  assert.equal(inactive.profile.goal.current, 0);
  assert.notEqual(inactive.profileProgress.decision, "goal_reached");

  const missing = createStrategyPlan({ ...options, sketches });
  assert.equal(missing.profile.goal.current, null);
  assert.equal(missing.profileProgress.decision, "target_win_rate_unknown");
});

test("Masterpiece profiles count and estimate only first wins on distinct sketches", () => {
  const newMasterpiece = { ...sketches.target, id: "new_masterpiece" };
  const previouslyDefeated = { ...sketches.target, id: "past_masterpiece" };
  const plan = createStrategyPlan({
    sketches: { ...sketches, [newMasterpiece.id]: newMasterpiece, [previouslyDefeated.id]: previouslyDefeated },
    state: state({
      availableSketches: ["target", newMasterpiece.id, previouslyDefeated.id],
      sketchVictories: { target: 6, opus_attack: 2 },
      sketchRunVictories: { target: 3, [previouslyDefeated.id]: 2 },
      defeatedMasterpieceCount: 8,
      fundamentals: { maxVictories: 10 },
    }),
    profile: "3-masterpiece",
    compareProfiles: ["3-masterpiece", "4-masterpiece"],
    targetId: "target",
    targetSimulation: { winRate: 1 },
    currentRun: { targets: [
      { id: "target", winRate: 1 },
      { id: previouslyDefeated.id, winRate: 1 },
      { id: newMasterpiece.id, winRate: 0.5 },
      { id: newMasterpiece.id, winRate: 0.5 },
    ] },
    trials: 1,
  });

  assert.deepEqual(plan.profile.goal, { type: "masterpiece_count", current: 2, goal: 3, missing: 1 });
  assert.equal(plan.profileProgress.expectedPerRun, 0.5);
  assert.equal(plan.profileProgress.averageRuns, 2);
  assert.deepEqual(plan.profileComparison[1].goal, { type: "masterpiece_count", current: 2, goal: 4, missing: 2 });
  assert.equal(plan.profileComparison[1].estimatedRuns, 4);
});

test("older aggregate Masterpiece counts preserve progress without guessing first clears", () => {
  const result = createStrategyPlan({ sketches, targetId: "target", profile: "3-masterpiece",
    state: { defeatedMasterpieceCount: 2 }, currentRun: { targets: [{ id: "target", winRate: 1 }] }, trials: 1 });
  assert.equal(result.profile.goal.current, 2);
  assert.equal(result.profileProgress.averageRuns, null);
  assert.equal(result.profileProgress.decision, "first_clear_history_unknown");
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
    goalCurrencies: { Graphite: 500, Photon: 1000, "Gold Leaf": 10 },
    softcapSeconds: 120,
    farmSeconds: 60,
  });

  assert.ok(plan.economy);
  assert.ok(plan.economy.shopUpgrades.some((item) => item.id === "upgrade_atk_graphite" && item.nextLevel === 1 && item.affordable));
  assert.ok(plan.economy.purchasePlan.buyNow.some((item) => item.id === "upgrade_atk_graphite"));
  assert.equal(plan.economy.generatorEV.currencies.Graphite.perSecond, 12);
  assert.equal(plan.economy.generatorEV.currencies.Photon.perSecond, 4);
  assert.equal(plan.economy.specialCurrencies.Photon.perSecond, 4);
  assert.equal(plan.economy.specialCurrencies.Photon.runPerSecond, 0);
  assert.equal(plan.economy.specialCurrencies.Photon.secondsToGoal, 243.75);
  const mixedForecast = plan.economy.currencyForecasts.find(({ currency }) => currency === "Graphite");
  assert.ok(Math.abs(plan.runEV.currencies.Graphite.perSecond - (12 + 1200 / 110)) < 1e-6);
  assert.equal(mixedForecast.perSecond, plan.runEV.currencies.Graphite.perSecond);
  assert.ok(Math.abs(mixedForecast.secondsToGoal - 400 / mixedForecast.perSecond) < 1e-8);
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
