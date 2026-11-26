import { analyzeBuildAdvice } from "./build-advisor.js";
import { runMonteCarlo } from "./combat.js";
import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { confidenceInterval95 } from "./combat/math.js";
import { enemyFromSketch } from "./combat/steam-encounter.js";
import { generatorRates } from "./currency-generators.js";
import { createEconomyPlan, resolveSoftcapSeconds } from "./economy.js";
import { RewardProjectionError, steamCurrencyPerkWinsRemaining, steamSketchRewards } from "./rewards.js";
import { createRng } from "./rng.js";
import { currencyRewardAmount, projectVictories, simulateRoute } from "./route.js";
import { isFullSteamSave, normalizeStats, toNumber } from "./save.js";
import { applySteamVictoryAvailability } from "./steam-route-availability.js";
import { applySteamVictoryStatChanges, createSteamStatProjection } from "./steam-stat-projection.js";
import { boosterRestriction, getSketchFightEligibility, isSketchToolUnlocked } from "./tool-rules.js";
import { remainingSketchVictories } from "./victory-limit.js";

const DEFAULT_TARGET_WIN_RATE = 0.5;
const DEFAULT_FARM_SECONDS = 3600;
const DEFAULT_MAX_SOFTCAP_WAIT_SECONDS = 30 * 60;
const DEFAULT_COMPARE_PROFILE_IDS = ["farm-q", "3-masterpiece", "transcendent-paragon"];
const MAX_FARM_STEPS = 8;
const MAX_FARM_TRIALS = 200;
const MAX_FARM_CHECK_TRIALS = 20;
const CULL_ROUTE_SAMPLES = 256;
const MIN_OPUS_FARM_VALUE_PER_MINUTE = 10;

const DEFAULT_REWARD_WEIGHTS = {
  quintessence: 1,
  currency: 1,
  combat: 1,
  opus: 1,
  masterpiece: 1,
  winRate: 1,
  p90: 1,
  risk: 1,
  redraw: 1,
};

export const STRATEGY_PROFILES = Object.freeze([
  {
    id: "farm-q",
    label: "Farm Q",
    defaultMode: "safe-farm",
    targetWinRate: 0.5,
    goal: { type: "quintessence", multiplier: 10, minimum: 1000 },
    rewardWeights: { quintessence: 1.8, currency: 0.8, combat: 0.7, opus: 1.2, masterpiece: 0.5, risk: 1.2 },
  },
  {
    id: "farm-photon",
    label: "Farm Photon",
    defaultMode: "greedy-farm",
    targetWinRate: 0.45,
    goal: { type: "currency", currency: "Photon", multiplier: 10, minimum: 1000 },
    rewardWeights: { quintessence: 0.7, currency: 1.9, combat: 0.6, opus: 1.3, masterpiece: 0.4, risk: 0.7 },
  },
  {
    id: "farm-gold-leaf",
    label: "Farm Gold Leaf",
    defaultMode: "greedy-farm",
    targetWinRate: 0.45,
    goal: { type: "currency", currency: "Gold Leaf", multiplier: 10, minimum: 1000 },
    rewardWeights: { quintessence: 0.7, currency: 1.9, combat: 0.6, opus: 1.3, masterpiece: 0.4, risk: 0.7 },
  },
  {
    id: "farm-acrylic",
    label: "Farm Acrylic",
    defaultMode: "greedy-farm",
    targetWinRate: 0.45,
    goal: { type: "currency", currency: "Acrylic", multiplier: 10, minimum: 1000 },
    rewardWeights: { quintessence: 0.7, currency: 1.9, combat: 0.6, opus: 1.3, masterpiece: 0.4, risk: 0.7 },
  },
  {
    id: "3-masterpiece",
    label: "3 Masterpiece",
    defaultMode: "redraw-fishing",
    targetWinRate: 0.5,
    goal: { type: "masterpiece_count", count: 3 },
    rewardWeights: { quintessence: 0.5, currency: 0.6, combat: 1.2, opus: 1.1, masterpiece: 1.8, risk: 1, redraw: 1.5 },
  },
  {
    id: "4-masterpiece",
    label: "4 Masterpiece",
    defaultMode: "redraw-fishing",
    targetWinRate: 0.55,
    goal: { type: "masterpiece_count", count: 4 },
    rewardWeights: { quintessence: 0.5, currency: 0.5, combat: 1.4, opus: 1.1, masterpiece: 2, risk: 1.1, redraw: 1.7 },
  },
  {
    id: "transcendent-paragon",
    label: "Transcendent Paragon",
    defaultMode: "boss-approach",
    targetWinRate: 0.6,
    targetId: "transcendent_paragon",
    goal: { type: "target_win_rate" },
    rewardWeights: { quintessence: 0.4, currency: 0.2, combat: 2, opus: 0.8, masterpiece: 1.5, risk: 1.2, redraw: 0.8 },
  },
]);

export const STRATEGY_MODES = Object.freeze([
  {
    id: "safe-farm",
    label: "Safe farm",
    rewardMultipliers: { currency: 0.95, combat: 0.9, winRate: 1.6, p90: 1.5, risk: 1.7 },
  },
  {
    id: "greedy-farm",
    label: "Greedy farm",
    rewardMultipliers: { currency: 1.6, combat: 1.05, winRate: 0.65, p90: 0.45, risk: 0.35 },
  },
  {
    id: "boss-approach",
    label: "Boss approach",
    rewardMultipliers: { currency: 0.15, combat: 2, winRate: 1.1, p90: 0.8, risk: 0.9 },
  },
  {
    id: "redraw-fishing",
    label: "Redraw fishing",
    rewardMultipliers: { currency: 0.25, combat: 0.7, winRate: 0.9, p90: 0.7, risk: 0.7, redraw: 2 },
  },
]);

const PROFILE_BY_ID = Object.fromEntries(STRATEGY_PROFILES.map((profile) => [profile.id, profile]));
const MODE_BY_ID = Object.fromEntries(STRATEGY_MODES.map((mode) => [mode.id, mode]));

export function createStrategyPlan({
  sketches = {},
  state = {},
  assumptions = combatAssumptionsFromSave(state),
  targetId,
  baseStats = null,
  targetSimulation = null,
  targetComparisons = [],
  currentRun = null,
  goalQuintessence = null,
  goalCurrencies = {},
  targetWinRate = null,
  softcapSeconds = null,
  referenceTimeMs = Date.now(),
  maxSoftcapWaitSeconds = DEFAULT_MAX_SOFTCAP_WAIT_SECONDS,
  farmSeconds = DEFAULT_FARM_SECONDS,
  boosterCandidates = [],
  masterpieceTargetIds = [],
  strategyProfile = null,
  profile = null,
  strategyMode = null,
  mode = null,
  profileIds = [],
  compareProfiles = [],
  trials = 1000,
  maxSeconds = 300,
  seed = "strategy-plan",
} = {}) {
  const savedStats = assumptions.steam ? state.playerStats : state.currentRunStats ?? state.battleStats ?? state.playerStats;
  const stats = normalizeStats(baseStats ?? savedStats);
  const target = sketches[targetId] ?? { id: targetId, name: targetId, stats: {} };
  const currentRows = normalizeCurrentRows({ currentRun, state, sketches });
  const targetAvailable = currentRows.some((row) => row.id === targetId);
  const profileConfig = resolveStrategyProfile(profile ?? strategyProfile, { targetId });
  const modeConfig = resolveStrategyMode(mode ?? strategyMode ?? profileConfig.defaultMode);
  const rewardWeights = resolveRewardWeights({ profile: profileConfig, mode: modeConfig });
  const profileDefaults = createProfileGoalDefaults({ profile: profileConfig, state });
  const effectiveGoalQuintessence = goalQuintessence ?? profileDefaults.goalQuintessence;
  const normalizedGoalCurrencies = {
    ...profileDefaults.goalCurrencies,
    ...numericObject(goalCurrencies),
  };
  const effectiveTargetWinRate = resolveTargetWinRate(profileConfig, targetWinRate);
  const defeatedMasterpieces = defeatedMasterpieceIds({ state, sketches, currentRows });
  const profileResults = new Map();
  const getProfileResult = (id) => {
    if (!id) return null;
    if (!profileResults.has(id)) {
      const provided = [
        id === targetId ? targetSimulation : null,
        targetComparisons.find((row) => row.id === id),
        currentRun?.targets?.find((row) => row.id === id),
      ].find((result) => toNumber(result?.winRate, null) != null);
      const result = provided ?? (sketches[id]?.stats ? runMonteCarlo({
        player: stats,
        enemy: enemyFromSketch(sketches[id], id),
        assumptions,
        trials: boundedFarmTrials(trials),
        maxSeconds,
        seed: `${seed}:${id}:profile`,
      }) : null);
      profileResults.set(id, result);
    }
    return profileResults.get(id);
  };
  const buildAdvice = analyzeBuildAdvice({ sketches, state, assumptions, targetId, baseStats: stats, currentRows });
  const rawTargetStatWeights = Object.fromEntries(
    buildAdvice.targetPlan.priorityStats.map((item) => [item.stat, item.weight]),
  );
  const targetStatWeights = scaleTargetStatWeights(rawTargetStatWeights, rewardWeights);
  const targetEstimate = assessWinRate(
    toNumber(targetSimulation?.winRate, null) != null ? targetSimulation : currentRows.find((row) => row.id === targetId),
    effectiveTargetWinRate,
  );
  const approach = estimateApproachReadiness({
    state,
    targetEstimate,
    goalQuintessence: effectiveGoalQuintessence,
    goalCurrencies: normalizedGoalCurrencies,
    targetAvailable,
  });
  const opusValues = rankOpusStrategicValue({
    sketches,
    state,
    baseStats: stats,
    targetStatWeights,
    goalCurrencies: normalizedGoalCurrencies,
    rewardWeights,
    currentRows: currentRun?.targets ?? currentRows,
  });
  const visibleIds = new Set(currentRows.map((row) => row.id));
  const visibleOpusValues = opusValues.filter((item) => visibleIds.has(item.id));
  const opusFarm = assessOpusFarm({ opusValues: visibleOpusValues, currentRows, rewardWeights });
  const runEV = estimateRunEV({
    sketches,
    state,
    baseStats: stats,
    currentRows,
    targetStatWeights,
    farmSeconds,
  });
  const softcap = decideSoftcapOrRedraw({
    state,
    seconds: resolveSoftcapSeconds(state, softcapSeconds, referenceTimeMs),
    maxSoftcapWaitSeconds,
    currentRows,
    runEV,
  });
  const farmPlan = createFarmPlan({
    approach,
    runEV,
    opusFarm,
    state,
  });
  const profileGoal = createProfileGoal({
    profile: profileConfig,
    state,
    defeatedMasterpieces,
    goalQuintessence: effectiveGoalQuintessence,
    goalCurrencies: normalizedGoalCurrencies,
    targetId,
    targetWinRate: effectiveTargetWinRate,
    getProfileResult,
  });
  const profileModes = createProfileModes({
    currentRows,
    runEV,
    opusValues,
    targetId: profileConfig.targetId ?? targetId,
    profile: profileConfig,
    rewardWeights,
  });
  const profileProgress = estimateProfileProgress({
    profileGoal,
    approach,
    runEV,
    currentRows,
    sketches,
    defeatedMasterpieces,
  });
  const boosters = compareBoosterChoices({
    sketches,
    state,
    assumptions,
    baseStats: stats,
    targetId,
    candidates: boosterCandidates,
    currentRun,
    targetStatWeights,
    trials,
    maxSeconds,
    seed,
  });
  const masterpieceRoll = decideMasterpieceRoll({
    currentRows,
    targetId,
    targetEstimate,
    masterpieceTargetIds,
    opusFarm,
    targetWinRate: effectiveTargetWinRate,
  });
  const runCompletion = decideRunCompletion({
    currentRows,
    runEV,
    opusFarm,
    targetId,
    targetEstimate,
  });
  const profileRecommendations = createProfileRecommendations({
    buildAdvice,
    currentRows,
    profile: profileConfig,
    mode: modeConfig,
    rewardWeights,
  });
  const stopFarming = decideStopFarming({
    sketches,
    state,
    assumptions,
    stats,
    targetEstimate,
    currentRows,
    runEV,
    opusFarm,
    targetId,
    targetAvailable,
    trials,
    maxSeconds,
    seed,
  });
  const profileComparison = createProfileComparison({
    requestedProfileIds: normalizeList(compareProfiles).length > 0 ? compareProfiles : profileIds,
    selectedProfile: profileConfig,
    state,
    sketches,
    approach,
    runEV,
    currentRows,
    targetId,
    targetWinRate,
    getProfileResult,
    defeatedMasterpieces,
  });
  const economy = createEconomyPlan({
    state,
    baseStats: stats,
    referenceTimeMs,
    softcapSeconds,
    sketches,
    currentRows,
    targetStatWeights,
    rewardWeights,
    goalCurrencies: normalizedGoalCurrencies,
    goalQuintessence: effectiveGoalQuintessence,
    farmSeconds,
    softcap,
    runEV,
    profile: profileConfig,
  });

  return {
    target: {
      id: targetId,
      name: target.name ?? targetId,
      rarity: target.rarity ?? "unknown",
      availableNow: targetAvailable,
    },
    profile: {
      id: profileConfig.id,
      label: profileConfig.label,
      goal: profileGoal,
      mode: { id: modeConfig.id, label: modeConfig.label },
      rewardWeights,
    },
    approach,
    softcap,
    farmPlan,
    profileProgress,
    profileRecommendations,
    profileModes,
    stopFarming,
    profileComparison,
    economy,
    opusValues: opusValues.slice(0, 12),
    runEV,
    boosters,
    masterpieceRoll,
    runCompletion,
    assumptions: {
      targetWinRate: effectiveTargetWinRate,
      farmSeconds,
      maxSoftcapWaitSeconds,
      trials,
      combatModel: "approximate",
    },
  };
}

export function rankOpusStrategicValue({
  sketches = {},
  state = {},
  baseStats = state.playerStats,
  targetStatWeights = {},
  goalCurrencies = {},
  rewardWeights = DEFAULT_REWARD_WEIGHTS,
  currentRows = [],
} = {}) {
  const hiddenIds = new Set(normalizeList(state.hiddenSketches));
  for (const row of currentRows ?? []) {
    if (row.hidden) hiddenIds.add(row.id);
  }
  const rowsById = new Map(normalizeCurrentRows({ currentRun: { targets: currentRows }, state, sketches })
    .map((row) => [row.id, row]));
  return Object.values(sketches)
    .filter((sketch) => sketch?.rarity === "opus" && !hiddenIds.has(sketch.id) && remainingSketchVictories(state, sketch.id) > 0)
    .map((sketch) => {
      const steamRewards = estimateSteamPayout({ sketch, state, baseStats });
      const statRewards = steamRewards?.statRewards ?? sketch.rewards;
      const currencyRewards = steamRewards?.currencyRewards ?? sketch.currencyRewards;
      const statScore = estimateStatRewardValue({ rewards: statRewards, targetStatWeights, steam: Boolean(steamRewards) });
      const currencyScore = estimateCurrencyRewardValue({ rewards: currencyRewards, state, goalCurrencies });
      const row = rowsById.get(sketch.id);
      const safetyScore = row
        ? estimateSafetyScore(row, rewardWeights)
        : 0;
      const score = statScore * toNumber(rewardWeights.combat, 1)
        + currencyScore * toNumber(rewardWeights.currency, 1)
        + toNumber(rewardWeights.opus, 1)
        + safetyScore;
      return {
        id: sketch.id,
        name: sketch.name ?? sketch.id,
        rarity: sketch.rarity,
        statScore: roundNumber(statScore),
        currencyScore: roundNumber(currencyScore),
        safetyScore: roundNumber(safetyScore),
        score: roundNumber(score),
        bestCurrency: bestCurrencyReward(currencyRewards),
        bestStats: bestStatRewards(statRewards, targetStatWeights),
      };
    })
    .sort((a, b) => b.score - a.score || b.currencyScore - a.currencyScore || a.id.localeCompare(b.id));
}

export function parseStrategyCurrencyGoals(value) {
  if (!value || value === true) return {};
  if (typeof value === "object" && !Array.isArray(value)) return numericObject(value);
  const goals = {};
  for (const chunk of String(value).split(",")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)(?:=|:)(.+)$/);
    if (!match) continue;
    const currency = match[1].trim();
    const amount = Number(match[2].trim());
    if (currency && Number.isFinite(amount)) goals[currency] = amount;
  }
  return goals;
}

function resolveStrategyProfile(value, { targetId } = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const base = PROFILE_BY_ID[normalizeProfileId(value.id)] ?? createCustomProfile({ targetId });
    return {
      ...base,
      ...value,
      id: normalizeProfileId(value.id ?? base.id),
      rewardWeights: { ...base.rewardWeights, ...value.rewardWeights },
    };
  }
  const id = normalizeProfileId(value);
  if (PROFILE_BY_ID[id]) return PROFILE_BY_ID[id];
  return createCustomProfile({ targetId });
}

function resolveTargetWinRate(profile, override) {
  return toNumber(override ?? profile.targetWinRate, DEFAULT_TARGET_WIN_RATE);
}

function resolveStrategyMode(value) {
  const id = normalizeProfileId(value);
  return MODE_BY_ID[id] ?? MODE_BY_ID["greedy-farm"];
}

function resolveRewardWeights({ profile, mode }) {
  const weights = {
    ...DEFAULT_REWARD_WEIGHTS,
    ...profile.rewardWeights,
  };
  for (const [key, multiplier] of Object.entries(mode.rewardMultipliers ?? {})) {
    weights[key] = toNumber(weights[key], 1) * toNumber(multiplier, 1);
  }
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, roundNumber(toNumber(value, 1))]));
}

function createCustomProfile({ targetId } = {}) {
  return {
    id: "custom",
    label: targetId ? `Custom: ${targetId}` : "Custom",
    defaultMode: "greedy-farm",
    targetWinRate: DEFAULT_TARGET_WIN_RATE,
    goal: { type: "custom" },
    rewardWeights: DEFAULT_REWARD_WEIGHTS,
  };
}

function normalizeProfileId(value) {
  if (!value || value === true) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/g, "-");
}

function createProfileGoalDefaults({ profile, state }) {
  const goal = profile.goal ?? {};
  if (goal.type === "quintessence") {
    return {
      goalQuintessence: growthGoal(toNumber(state.quintessence), goal),
      goalCurrencies: {},
    };
  }
  if (goal.type === "currency") {
    return {
      goalQuintessence: null,
      goalCurrencies: {
        [goal.currency]: growthGoal(toNumber(state.currencies?.[goal.currency]), goal),
      },
    };
  }
  return {
    goalQuintessence: null,
    goalCurrencies: {},
  };
}

function growthGoal(current, goal) {
  const minimum = toNumber(goal.minimum, 1);
  const multiplier = Math.max(1, toNumber(goal.multiplier, 10));
  if (current > 0) return roundNumber(Math.max(minimum, current * multiplier));
  return minimum;
}

function scaleTargetStatWeights(targetStatWeights, rewardWeights) {
  const combatWeight = toNumber(rewardWeights.combat, 1);
  return Object.fromEntries(
    Object.entries(targetStatWeights).map(([stat, weight]) => [stat, toNumber(weight) * combatWeight]),
  );
}

function createProfileGoal({
  profile, state, defeatedMasterpieces, goalQuintessence, goalCurrencies, targetId, targetWinRate, getProfileResult,
}) {
  const goal = profile.goal ?? {};
  if (goal.type === "quintessence") {
    return {
      type: "quintessence",
      current: roundNumber(toNumber(state.quintessence)),
      goal: goalQuintessence == null ? null : roundNumber(toNumber(goalQuintessence)),
      missing: roundNumber(Math.max(0, toNumber(goalQuintessence) - toNumber(state.quintessence))),
    };
  }
  if (goal.type === "currency") {
    const currency = goal.currency;
    const current = toNumber(state.currencies?.[currency]);
    const target = toNumber(goalCurrencies?.[currency]);
    return {
      type: "currency",
      currency,
      current: roundNumber(current),
      goal: roundNumber(target),
      missing: roundNumber(Math.max(0, target - current)),
    };
  }
  if (goal.type === "masterpiece_count") {
    // Older summaries can carry only a count, without the identities of first clears.
    const current = state.sketchVictories == null
      ? Math.max(defeatedMasterpieces.size, toNumber(state.defeatedMasterpieceCount ?? state.masterpieceDefeats))
      : defeatedMasterpieces.size;
    return {
      type: "masterpiece_count",
      current,
      goal: goal.count,
      missing: Math.max(0, toNumber(goal.count) - current),
    };
  }
  if (goal.type === "target_win_rate") {
    const goalTargetId = profile.targetId ?? targetId;
    const result = getProfileResult(goalTargetId);
    const estimate = result ? assessWinRate(result, targetWinRate) : null;
    const current = estimate?.current ?? null;
    return {
      type: "target_win_rate",
      current,
      goal: targetWinRate,
      missing: current == null ? null : Math.max(0, targetWinRate - current),
      targetId: goalTargetId ?? null,
      needsMoreTrials: estimate?.decision === "increase_trials",
    };
  }
  return {
    type: "custom",
    current: null,
    goal: null,
    missing: 0,
  };
}

function estimateProfileProgress({ profileGoal, approach, runEV, currentRows, sketches, defeatedMasterpieces }) {
  const type = profileGoal.type;
  let missing = toNumber(profileGoal.missing);
  let expectedPerRun = 0;
  let unit = type;

  if (type === "quintessence") {
    expectedPerRun = toNumber(runEV.quintessence?.expectedPerRun);
    unit = "Q";
  } else if (type === "currency") {
    expectedPerRun = toNumber(runEV.currencies?.[profileGoal.currency]?.expectedPerRun);
    unit = profileGoal.currency;
  } else if (type === "masterpiece_count") {
    if (missing > 0 && profileGoal.current > defeatedMasterpieces.size) {
      return { decision: "first_clear_history_unknown", unit: "masterpiece", missing,
        expectedPerRun: null, averageRuns: null, averageRedraws: null };
    }
    expectedPerRun = estimateMasterpieceKillsPerRun({ currentRows, sketches, defeatedMasterpieces, runEV });
    unit = "masterpiece";
  } else if (type === "target_win_rate") {
    expectedPerRun = estimateWinRateGainPerRun({ currentRows, runEV });
    unit = "win_rate";
    if (profileGoal.current == null) {
      return {
        decision: "target_win_rate_unknown",
        unit,
        missing: null,
        expectedPerRun: roundNumber(expectedPerRun),
        averageRuns: null,
        averageRedraws: null,
      };
    }
  } else {
    const limiting = limitingCustomGoal(approach, runEV, currentRows);
    ({ missing, expectedPerRun, unit } = limiting);
  }

  if (profileGoal.needsMoreTrials || type === "custom" && approach.winRate.decision === "increase_trials") {
    return {
      decision: "increase_trials",
      unit,
      missing: roundNumber(missing),
      expectedPerRun: roundNumber(expectedPerRun),
      averageRuns: null,
      averageRedraws: null,
    };
  }

  if (missing <= 0) {
    return {
      decision: "goal_reached",
      unit,
      missing: roundNumber(missing),
      expectedPerRun: roundNumber(expectedPerRun),
      averageRuns: 0,
      averageRedraws: 0,
    };
  }

  const runs = missing / expectedPerRun;
  const averageRuns = expectedPerRun > 0 && Number.isFinite(runs) ? runs : null;
  const usefulRunRate = estimateUsefulRunRate(currentRows);
  return {
    decision: averageRuns == null ? "need_better_income_source" : usefulRunRate < 0.2 ? "redraw_for_profile" : "farm_current_run",
    unit,
    missing: roundNumber(missing),
    expectedPerRun: roundNumber(expectedPerRun),
    usefulRunRate: roundNumber(usefulRunRate),
    averageRuns: averageRuns == null ? null : roundNumber(averageRuns),
    averageRedraws: averageRuns == null ? null : roundNumber(averageRuns / Math.max(0.05, usefulRunRate)),
  };
}

function limitingCustomGoal({ winRate, resources }, runEV, currentRows) {
  // All goals progress during the same run. The last one reached sets the ETA.
  const goals = [{ unit: "win_rate", missing: winRate.missing,
    expectedPerRun: estimateWinRateGainPerRun({ currentRows, runEV }) },
    { unit: "Q", missing: resources.quintessence.missing, expectedPerRun: runEV.quintessence.expectedPerRun }];
  for (const [unit, gap] of Object.entries(resources.currencies)) {
    const income = runEV.currencies[unit];
    goals.push({ unit, missing: gap.missing,
      expectedPerRun: income?.passiveExpectedPerRun === null ? null : income?.expectedPerRun ?? 0 });
  }
  const runsNeeded = ({ missing, expectedPerRun }) => {
    if (missing <= 0) return 0;
    return expectedPerRun > 0 ? missing / expectedPerRun : Infinity;
  };
  return goals.reduce((slowest, goal) => runsNeeded(goal) > runsNeeded(slowest) ? goal : slowest);
}

function createProfileModes({ currentRows, runEV, opusValues, targetId, profile, rewardWeights }) {
  const modes = {};
  for (const mode of STRATEGY_MODES) {
    const weights = resolveRewardWeights({ profile, mode });
    const candidates = rankModeCandidates({
      mode,
      currentRows,
      runEV,
      opusValues,
      targetId,
      rewardWeights: weights,
    });
    const recommendation = candidates[0] ?? null;
    const key = toCamelModeId(mode.id);
    modes[key] = {
      id: mode.id,
      label: mode.label,
      decision: mode.id === "redraw-fishing"
        ? decideRedrawFishing(candidates)
        : recommendation ? "finish_candidate" : "redraw",
      recommendation,
      candidates: candidates.slice(0, 8),
    };
  }
  return modes;
}

function rankModeCandidates({ mode, currentRows, runEV, opusValues, targetId, rewardWeights }) {
  const evById = new Map((runEV.sketches ?? []).map((item) => [item.id, item]));
  const opusById = new Map((opusValues ?? []).map((item) => [item.id, item]));
  return [...currentRows]
    .filter((row) => row.winRate > 0)
    .map((row) => {
      const ev = evById.get(row.id) ?? {};
      const opus = opusById.get(row.id) ?? {};
      const currencyValue = estimateCurrencyBagValue(ev.expectedCurrencies ?? {});
      const statValue = toNumber(ev.expectedStatScore);
      const safety = normalizedSafety(row);
      const rarity = rarityProfileScore(row.rarity);
      const isTarget = row.id === targetId ? 1 : 0;
      const isOpus = row.rarity === "opus" ? 1 : 0;
      const isMasterpiece = row.rarity === "masterpiece" ? 1 : 0;
      let score = currencyValue * toNumber(rewardWeights.currency, 1)
        + statValue * toNumber(rewardWeights.combat, 1)
        + safety * toNumber(rewardWeights.winRate, 1)
        + isOpus * toNumber(rewardWeights.opus, 1)
        + isMasterpiece * toNumber(rewardWeights.masterpiece, 1);

      if (mode.id === "safe-farm") {
        score += safety * 60 - toNumber(row.p90Seconds, 60) * 0.2 * toNumber(rewardWeights.p90, 1);
      } else if (mode.id === "greedy-farm") {
        score += currencyValue * 15 + statValue * 4 - (1 - clamp01(toNumber(row.winRate))) * 5;
      } else if (mode.id === "boss-approach") {
        score += statValue * 20 + isTarget * 100 + toNumber(row.winRate) * 20 - currencyValue * 4;
      } else if (mode.id === "redraw-fishing") {
        score = rarity * 12 * toNumber(rewardWeights.redraw, 1)
          + isTarget * 60
          + isMasterpiece * 30
          + isOpus * 12
          + toNumber(row.winRate) * 5
          + toNumber(opus.score) * 0.25;
      }

      return {
        id: row.id,
        name: row.name,
        rarity: row.rarity,
        winRate: roundNumber(toNumber(row.winRate)),
        p90Seconds: row.p90Seconds == null ? null : roundNumber(row.p90Seconds),
        p90Censored: row.p90Censored,
        score: roundNumber(score),
        currencyValue: roundNumber(currencyValue),
        statValue: roundNumber(statValue),
      };
    })
    .sort((a, b) => b.score - a.score || b.winRate - a.winRate || toNumber(a.p90Seconds, 60) - toNumber(b.p90Seconds, 60));
}

function createProfileRecommendations({ buildAdvice, currentRows, profile, mode, rewardWeights }) {
  return {
    profileId: profile.id,
    modeId: mode.id,
    guarantee: rankToolAdvice(buildAdvice.tools.guarantee, { currentRows, rewardWeights, tool: "guarantee" }),
    booster: rankToolAdvice(buildAdvice.tools.booster, { currentRows, rewardWeights, tool: "booster" }),
    eraser: rankToolAdvice(buildAdvice.tools.eraser, { currentRows, rewardWeights, tool: "eraser" }),
    meditation: rankToolAdvice(buildAdvice.tools.meditation, { currentRows, rewardWeights, tool: "meditation" }),
  };
}

function rankToolAdvice(items = [], { currentRows, rewardWeights, tool }) {
  const rowById = new Map(currentRows.map((row) => [row.id, row]));
  const toolWeight = {
    guarantee: Math.max(toNumber(rewardWeights.opus, 1), toNumber(rewardWeights.masterpiece, 1)),
    booster: Math.max(toNumber(rewardWeights.currency, 1), toNumber(rewardWeights.combat, 1)),
    eraser: toNumber(rewardWeights.combat, 1) + toNumber(rewardWeights.masterpiece, 1),
    meditation: toNumber(rewardWeights.combat, 1),
  }[tool] ?? 1;
  return [...items]
    .map((item) => {
      const row = rowById.get(item.id);
      const safety = row ? normalizedSafety(row) * toNumber(rewardWeights.winRate, 1) : 0;
      return {
        ...item,
        profileScore: roundNumber(toNumber(item.score, 1) * toolWeight + safety),
      };
    })
    .sort((a, b) => b.profileScore - a.profileScore || toNumber(b.score) - toNumber(a.score))
    .slice(0, 8);
}

function decideStopFarming({
  sketches, state, assumptions, stats, targetEstimate, currentRows, runEV, opusFarm,
  targetId, targetAvailable, trials, maxSeconds, seed,
}) {
  const { current, target: targetWinRate, decision } = targetEstimate;
  if (!targetAvailable && decision !== "below_target") {
    return {
      decision: "redraw",
      reason: "target_unavailable",
      currentWinRate: roundNumber(current),
      targetWinRate,
      curve: [],
      hasUnverifiedCandidates: false,
    };
  }
  if (decision !== "below_target") {
    return {
      decision: decision === "ready" ? "attempt_target" : "increase_trials",
      reason: decision === "ready" ? "target_win_rate_reached" : "win_interval_crosses_fight_threshold",
      currentWinRate: roundNumber(current),
      targetWinRate,
      curve: [],
      hasUnverifiedCandidates: false,
    };
  }
  const { curve, improvesTarget, hasUnverifiedCandidates } = createWinRateCurve({
    sketches, state, assumptions, stats, current, currentRows, runEV, targetId, targetWinRate, trials, maxSeconds, seed,
  });
  const crossing = curve.find((step) => step.reachesTarget);
  if (crossing) {
    return {
      decision: "farm_until_step",
      reason: "visible_rewards_project_target_ready",
      conditional: !targetAvailable,
      currentWinRate: roundNumber(current),
      targetWinRate,
      targetStep: crossing.step,
      targetSketchId: crossing.id,
      curve,
      hasUnverifiedCandidates,
    };
  }
  if (!improvesTarget && !hasUnverifiedCandidates && !opusFarm.worthFarming
      && opusFarm.uncertain?.expectedValuePerMinute === 0) {
    return {
      ...uncertainFarmDecision(opusFarm.uncertain),
      currentWinRate: roundNumber(current),
      targetWinRate,
      curve,
      hasUnverifiedCandidates,
    };
  }
  return {
    decision: improvesTarget || hasUnverifiedCandidates ? "farm_more" : "redraw",
    reason: hasUnverifiedCandidates ? "visible_rewards_need_target_verification"
      : improvesTarget ? "no_projected_step_reaches_target" : "no_visible_progress_path",
    currentWinRate: roundNumber(current),
    targetWinRate,
    conditional: !targetAvailable,
    curve,
    hasUnverifiedCandidates,
  };
}

function createProfileComparison({
  requestedProfileIds,
  selectedProfile,
  state,
  sketches,
  approach,
  runEV,
  currentRows,
  targetId,
  targetWinRate,
  getProfileResult,
  defeatedMasterpieces,
}) {
  const ids = normalizeList(requestedProfileIds);
  const selected = selectedProfile.id !== "custom" ? [selectedProfile.id] : [];
  const uniqueIds = [...new Set((ids.length > 0 ? ids : [...selected, ...DEFAULT_COMPARE_PROFILE_IDS]).filter(Boolean))];
  return uniqueIds
    .map((id) => id === selectedProfile.id ? selectedProfile : resolveStrategyProfile(id, { targetId }))
    .filter((item) => item.id !== "custom")
    .map((profile) => {
      const mode = resolveStrategyMode(profile.defaultMode);
      const weights = resolveRewardWeights({ profile, mode });
      const defaults = createProfileGoalDefaults({ profile, state });
      const goal = createProfileGoal({
        profile,
        state,
        defeatedMasterpieces,
        goalQuintessence: defaults.goalQuintessence,
        goalCurrencies: defaults.goalCurrencies,
        targetId,
        targetWinRate: resolveTargetWinRate(profile, targetWinRate),
        getProfileResult,
      });
      const progress = estimateProfileProgress({
        profileGoal: goal,
        approach,
        runEV,
        currentRows,
        sketches,
        defeatedMasterpieces,
      });
      const modePlan = createProfileModes({
        currentRows,
        runEV,
        opusValues: [],
        targetId: profile.targetId ?? targetId,
        profile,
        rewardWeights: weights,
      })[toCamelModeId(mode.id)];
      return {
        id: profile.id,
        label: profile.label,
        mode: mode.id,
        goal,
        decision: progress.decision,
        estimatedRuns: progress.averageRuns,
        estimatedRedraws: progress.averageRedraws,
        bestSketchId: modePlan?.recommendation?.id ?? null,
        score: roundNumber(toNumber(modePlan?.recommendation?.score)),
      };
    });
}

function assessWinRate(result, target) {
  const current = clamp01(toNumber(result?.winRate));
  const trials = toNumber(result?.trials, null);
  const provided = result?.winRateCi95;
  const interval = Number.isFinite(provided?.lower) && Number.isFinite(provided?.upper)
    ? provided : trials > 0 ? confidenceInterval95(current, trials) : null;
  const decision = (interval?.lower ?? current) >= target ? "ready"
    : interval?.upper >= target ? "increase_trials" : "below_target";
  return {
    current,
    target,
    missing: roundNumber(Math.max(0, target - current)),
    trials,
    ci95Lower: interval?.lower ?? null,
    ci95Upper: interval?.upper ?? null,
    ci95HalfWidth: interval?.halfWidth ?? provided?.halfWidth ?? null,
    decision,
  };
}

function estimateApproachReadiness({ state, targetEstimate, goalQuintessence, goalCurrencies, targetAvailable }) {
  const resources = {
    quintessence: createResourceGap({
      current: toNumber(state.quintessence),
      goal: goalQuintessence == null ? null : toNumber(goalQuintessence),
    }),
    currencies: {},
  };
  for (const [currency, goal] of Object.entries(goalCurrencies)) {
    resources.currencies[currency] = createResourceGap({
      current: toNumber(state.currencies?.[currency]),
      goal,
    });
  }

  const resourceReady = resources.quintessence.ready
    && Object.values(resources.currencies).every((item) => item.ready);
  const ready = targetAvailable && targetEstimate.decision === "ready" && resourceReady;
  return {
    decision: ready ? "ready_to_attempt" : !targetAvailable && targetEstimate.decision !== "below_target" ? "target_unavailable"
      : targetEstimate.decision === "increase_trials" ? "increase_trials" : "farm_more",
    conditional: !targetAvailable,
    winRate: { ...targetEstimate, current: roundNumber(targetEstimate.current) },
    resources,
    ready,
  };
}

function createResourceGap({ current, goal }) {
  if (goal == null || goal <= 0) {
    return {
      current: roundNumber(current),
      goal: null,
      missing: 0,
      ready: true,
      progress: null,
    };
  }
  return {
    current: roundNumber(current),
    goal: roundNumber(goal),
    missing: roundNumber(Math.max(0, goal - current)),
    ready: current >= goal,
    progress: roundNumber(Math.min(1, current / goal)),
  };
}

function estimateRunEV({ sketches, state, baseStats, currentRows, targetStatWeights, farmSeconds }) {
  const currencies = {};
  const sketchesEV = [];
  const windowSeconds = Math.max(1, toNumber(farmSeconds, DEFAULT_FARM_SECONDS));
  const perkWinsRemaining = steamCurrencyPerkWinsRemaining(state);
  const schedule = sampleCullRoute({ state, sketches, currentRows, perkWinsRemaining, windowSeconds });
  // Track the probability of each prior win count while the perk is still active.
  const priorWinProbabilities = new Float64Array(perkWinsRemaining);
  if (perkWinsRemaining > 0) priorWinProbabilities[0] = 1;
  let statValue = 0;
  let statValuePerRun = 0;
  let earliestSeconds = 0;
  let routeTimed = true;
  let windowTimingIncomplete = false;

  for (const row of currentRows) {
    const sketch = sketches[row.id];
    if (!sketch || row.hidden) continue;
    const winRate = clamp01(toNumber(row.winRate));
    const seconds = row.p90Seconds;
    earliestSeconds += seconds ?? 0;
    routeTimed = routeTimed && seconds != null && !row.p90Censored;
    // The route follows input order. Beyond an uncertain duration, only full-route rewards are estimated.
    const completesInWindow = routeTimed && earliestSeconds <= windowSeconds;
    if (!routeTimed && earliestSeconds <= windowSeconds) windowTimingIncomplete = true;
    const planned = schedule?.steps.get(row.id);
    const routeWinRate = planned?.win ?? winRate;
    const timelyWinRate = planned?.timelyWin ?? (completesInWindow ? winRate : 0);
    const perkWinRate = planned?.perkWin ?? winRate * priorWinProbabilities.reduce((sum, chance) => sum + chance, 0);
    const timelyPerkWinRate = planned?.timelyPerkWin ?? (completesInWindow ? perkWinRate : 0);
    const steamRewards = estimateSteamPayout({ sketch, state, baseStats, perkWinsRemaining });
    if (!schedule && steamRewards && perkWinsRemaining > 0) {
      for (let wins = priorWinProbabilities.length - 1; wins > 0; wins -= 1) {
        priorWinProbabilities[wins] = priorWinProbabilities[wins] * (1 - winRate) + priorWinProbabilities[wins - 1] * winRate;
      }
      priorWinProbabilities[0] *= 1 - winRate;
    }
    const multiplier = steamRewards ? 1 : rewardMultiplier({ state, id: row.id });
    const expectedCurrencies = {};
    for (const reward of steamRewards?.currencyRewards ?? sketch.currencyRewards ?? []) {
      const rewardAmount = steamRewards ? reward.amount : currencyRewardAmount({
        name: reward.name,
        amount: toNumber(reward.amount) * multiplier,
        fundamentals: state.fundamentals ?? {},
      });
      const afterPerk = reward.amountWithoutPerk ?? rewardAmount;
      const expected = afterPerk * (routeWinRate - perkWinRate) + rewardAmount * perkWinRate;
      const expectedInWindow = afterPerk * (timelyWinRate - timelyPerkWinRate) + rewardAmount * timelyPerkWinRate;
      expectedCurrencies[reward.name] = toNumber(expectedCurrencies[reward.name]) + expected;
      const item = currencies[reward.name] ??= { battleExpectedPerRun: 0, battleWindowExpected: 0 };
      item.battleExpectedPerRun += expected;
      item.battleWindowExpected += expectedInWindow;
    }
    const expectedStatScore = estimateStatRewardValue({
      rewards: steamRewards?.statRewards ?? sketch.rewards,
      targetStatWeights,
      steam: Boolean(steamRewards),
    });
    statValuePerRun += expectedStatScore * routeWinRate;
    statValue += expectedStatScore * timelyWinRate;
    sketchesEV.push({
      id: row.id,
      name: row.name ?? sketch.name ?? row.id,
      rarity: row.rarity ?? sketch.rarity ?? "unknown",
      winRate: roundNumber(winRate),
      ...(schedule && { routeWinRate: roundNumber(routeWinRate) }),
      seconds,
      secondsCensored: row.p90Censored,
      expectedCurrencies: Object.fromEntries(Object.entries(expectedCurrencies).map(([name, amount]) => [name, roundNumber(amount)])),
      expectedStatScore: roundNumber(expectedStatScore * routeWinRate),
    });
  }

  const routeSeconds = schedule ? schedule.routeSeconds : routeTimed ? earliestSeconds : null;
  const currencyEV = estimateCurrencyEV({ currencies, rates: generatorRates(state), routeSeconds, windowSeconds });
  const quintessenceRate = quintessencePerSecond(state);
  const quintessence = {
    expected: roundNumber(quintessenceRate * windowSeconds),
    expectedPerRun: routeSeconds == null && quintessenceRate !== 0 ? null : roundNumber(quintessenceRate * (routeSeconds ?? 0)),
    perSecond: roundNumber(quintessenceRate),
  };

  return {
    windowSeconds,
    windowTimingIncomplete: schedule?.windowTimingIncomplete ?? windowTimingIncomplete,
    routeSeconds,
    ...(schedule && { availabilitySamples: schedule.samples }),
    quintessence,
    currencies: currencyEV,
    statValue: roundNumber(statValue),
    statValuePerRun: roundNumber(statValuePerRun),
    totalValue: roundNumber(totalEVValue({ currencies: currencyEV, quintessence, statValue, amountKey: "expected" })),
    totalValuePerRun: roundNumber(totalEVValue({ currencies: currencyEV, quintessence, statValue: statValuePerRun, amountKey: "expectedPerRun" })),
    sketches: sketchesEV.sort((a, b) => b.expectedStatScore - a.expectedStatScore),
  };
}

function sampleCullRoute({ state, sketches, currentRows, perkWinsRemaining, windowSeconds }) {
  if (!isFullSteamSave(state) || state.availableSketches == null || currentRows.length < 2) return null;
  const rows = currentRows.map((row) => ({ ...row, winRate: clamp01(toNumber(row.winRate)) }));
  const medium = state.multiverse?.currentUniverseId === "mv-medium-2";
  const madman = state.gameMode === "madman";
  if (!rows.slice(0, -1).some(({ id, winRate }) => winRate > 0 && (
    medium && toNumber(state.sketchRunVictories?.[id]) === 0
    || madman && remainingSketchVictories(state, id) <= 1
  ))) return null;

  const steps = new Map(rows.map(({ id }) => [id, { win: 0, timelyWin: 0, perkWin: 0, timelyPerkWin: 0 }]));
  const available = normalizeList(state.availableSketches);
  const random = createRng("run-availability");
  const samples = rows.slice(0, -1).some(({ winRate }) => winRate > 0 && winRate < 1) ? CULL_ROUTE_SAMPLES : 1;
  let totalSeconds = 0;
  let routeTimed = true;
  let windowTimingIncomplete = false;
  for (let sample = 0; sample < samples; sample += 1) {
    const snapshot = {
      saveProfile: state.saveProfile, gameMode: state.gameMode, multiverse: state.multiverse,
      fundamentals: state.fundamentals, availableSketches: available,
      redrawCount: state.redrawCount, lastRedrawTime: state.lastRedrawTime, sketchRemovalSeed: state.sketchRemovalSeed,
      sketchVictories: { ...state.sketchVictories }, sketchRunVictories: { ...state.sketchRunVictories },
    };
    let seconds = 0;
    let timed = true;
    let wins = 0;
    for (const row of rows) {
      if (!snapshot.availableSketches.includes(row.id)) continue;
      timed &&= row.p90Seconds != null && !row.p90Censored;
      seconds += row.p90Seconds ?? 0;
      if (!timed && seconds <= windowSeconds) windowTimingIncomplete = true;
      const step = steps.get(row.id);
      const timely = timed && seconds <= windowSeconds;
      const perk = wins < perkWinsRemaining;
      // Integrate this fight's own odds and sample its outcome for the remaining route.
      const chance = row.winRate / samples;
      step.win += chance;
      if (timely) step.timelyWin += chance;
      if (perk) step.perkWin += chance;
      if (timely && perk) step.timelyPerkWin += chance;
      if (row.winRate < 1 && random() >= row.winRate) continue;
      wins += 1;
      const victoriesBefore = toNumber(snapshot.sketchVictories[row.id]);
      const runVictoriesBefore = toNumber(snapshot.sketchRunVictories[row.id]);
      snapshot.sketchVictories[row.id] = victoriesBefore + 1;
      snapshot.sketchRunVictories[row.id] = runVictoriesBefore + 1;
      applySteamVictoryAvailability({
        state: snapshot, sketches, id: row.id, victoriesBefore, runVictoriesBefore, listIds: normalizeList,
      });
    }
    routeTimed &&= timed;
    totalSeconds += seconds;
  }
  return { steps, samples, routeSeconds: routeTimed ? roundNumber(totalSeconds / samples) : null, windowTimingIncomplete };
}

function decideSoftcapOrRedraw({ state, seconds, maxSoftcapWaitSeconds, currentRows, runEV }) {
  const runValue = runEV.totalValuePerRun;
  if (seconds == null || !Number.isFinite(seconds)) {
    return {
      decision: "unknown",
      reason: "softcap_time_missing",
      secondsToSoftcap: null,
      waitValue: null,
      runValue,
    };
  }

  const waitValue = estimatePassiveWaitValue({ state, seconds });
  if (seconds === 0) {
    return { decision: "softcap_reached", reason: "softcap_time_elapsed", secondsToSoftcap: 0, waitValue: 0, runValue };
  }
  const bestWinRate = Math.max(0, ...currentRows.map((row) => toNumber(row.winRate)));
  if (seconds <= maxSoftcapWaitSeconds) {
    return {
      decision: "wait_softcap",
      reason: "softcap_is_close",
      secondsToSoftcap: roundNumber(seconds),
      waitValue: roundNumber(waitValue),
      runValue,
    };
  }
  if (bestWinRate >= 0.5 && runValue > waitValue) {
    return {
      decision: "finish_current_run",
      reason: "current_run_ev_beats_waiting",
      secondsToSoftcap: roundNumber(seconds),
      waitValue: roundNumber(waitValue),
      runValue,
    };
  }
  return {
    decision: "redraw",
    reason: "softcap_is_far_and_current_run_ev_is_low",
    secondsToSoftcap: roundNumber(seconds),
    waitValue: roundNumber(waitValue),
    runValue,
  };
}

function assessOpusFarm({ opusValues, currentRows, rewardWeights }) {
  const rows = new Map(currentRows.map((row) => [row.id, row]));
  const estimates = opusValues.map((opus) => {
    const row = rows.get(opus.id);
    const { current, ci95Lower, ci95Upper } = assessWinRate(row, 0);
    const rewardValue = Math.max(0, opus.statScore * toNumber(rewardWeights.combat, 1)
      + opus.currencyScore * toNumber(rewardWeights.currency, 1));
    const timingKnown = row.p90Seconds != null && !row.p90Censored;
    // Compare expected reward utility over the same amount of fight time.
    const valuePerMinute = rewardValue * 60 / Math.max(5, row.p90Seconds ?? 60);
    return {
      ...opus,
      winRate: current,
      secondsPerFight: row.p90Seconds,
      secondsCensored: row.p90Censored,
      expectedValuePerMinute: timingKnown && row.winRate != null ? roundNumber(current * valuePerMinute) : null,
      lowerValuePerMinute: timingKnown ? roundNumber((ci95Lower ?? current) * valuePerMinute) : null,
      upperValuePerMinute: roundNumber((ci95Upper ?? (row.winRate == null ? 1 : current)) * valuePerMinute),
    };
  }).sort((a, b) => toNumber(b.expectedValuePerMinute) - toNumber(a.expectedValuePerMinute));

  return {
    estimates,
    worthFarming: estimates.find((item) => item.lowerValuePerMinute >= MIN_OPUS_FARM_VALUE_PER_MINUTE),
    uncertain: estimates.filter((item) => item.upperValuePerMinute >= MIN_OPUS_FARM_VALUE_PER_MINUTE)
      .sort((a, b) => b.upperValuePerMinute - a.upperValuePerMinute)[0],
  };
}

function createFarmPlan({ approach, runEV, opusFarm, state }) {
  const qGap = approach.resources.quintessence;
  const missingCurrency = Object.entries(approach.resources.currencies)
    .find(([, gap]) => !gap.ready && gap.missing > 0);
  const goal = qGap.goal != null && qGap.missing > 0
    ? {
      type: "quintessence",
      current: qGap.current,
      goal: qGap.goal,
      missing: qGap.missing,
      perSecond: runEV.quintessence.perSecond,
      estimatedSeconds: secondsToGoal(qGap.missing, runEV.quintessence.perSecond),
    }
    : missingCurrency
      ? {
        type: "currency",
        currency: missingCurrency[0],
        current: missingCurrency[1].current,
        goal: missingCurrency[1].goal,
        missing: missingCurrency[1].missing,
        perSecond: runEV.currencies[missingCurrency[0]]?.perSecond ?? 0,
        estimatedSeconds: secondsToGoal(missingCurrency[1].missing, runEV.currencies[missingCurrency[0]]?.perSecond ?? 0),
      }
      : {
        type: "win_rate",
        current: approach.winRate.current,
        goal: approach.winRate.target,
        missing: approach.winRate.missing,
        perSecond: null,
        estimatedSeconds: null,
      };

  return {
    decision: approach.conditional && goal.type === "win_rate" && goal.missing <= 0 ? "target_unavailable"
      : goal.type === "win_rate" && approach.decision === "increase_trials" ? "increase_trials"
      : goal.missing <= 0 ? "goal_reached" : goal.estimatedSeconds != null ? "farm_until_goal"
      : runEV.sketches.some((item) => item.expectedStatScore > 0 || Object.values(item.expectedCurrencies).some((amount) => amount > 0))
        ? "farm_best_active_rewards" : opusFarm.uncertain ? "increase_trials" : "redraw",
    goal,
    windowSeconds: runEV.windowSeconds,
    passiveRates: {
      quintessence: quintessencePerSecond(state),
      currencies: generatorRates(state),
    },
    bestOpusTargets: opusFarm.estimates.slice(0, 5),
  };
}

function compareBoosterChoices({
  sketches,
  state,
  assumptions,
  baseStats,
  targetId,
  candidates,
  currentRun,
  targetStatWeights,
  trials,
  maxSeconds,
  seed,
}) {
  if (!isSketchToolUnlocked(state, "booster")) return { recommendation: null, choices: [] };
  const unavailable = new Set((currentRun?.targets ?? [])
    .filter((row) => row.hidden || row.remainingToMax <= 0).map((row) => row.id));
  const existing = new Set(normalizeList(state.boostedSketchIds));
  const remaining = Math.max(0, 1 + toNumber(state.fundamentals?.rewardBoosterUses) - existing.size);
  const eligibleCandidates = normalizeCandidates(candidates).filter((candidate) => {
    const counts = new Map();
    for (const id of candidate.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const newUses = [...counts.keys()].filter((id) => !existing.has(id)).length;
    return newUses > 0 && newUses <= remaining && [...counts].every(([id, count]) => !unavailable.has(id)
      && (existing.has(id) || !boosterRestriction(sketches[id], state))
      && getSketchFightEligibility(sketches[id], state).eligible && count <= remainingSketchVictories(state, id));
  });
  const choices = eligibleCandidates.map((candidate) => {
    const options = {
      sketches,
      state,
      assumptions,
      baseStats,
      targetId,
      routeIds: candidate.ids,
      trials,
      maxSeconds,
      seed: `${seed}:booster`,
      includeStepCombat: true,
      requireAvailability: true,
    };
    const route = simulateRoute({ ...options, boostedIds: candidate.ids });
    const baseline = simulateRoute(options);
    const simulation = route.target?.simulation ?? {};
    const targetAvailable = route.target?.availableAfterRoute && !unavailable.has(targetId);
    const boosted = estimateBoosterRoute({ route, targetAvailable, targetStatWeights, steam: isFullSteamSave(state) });
    const unboosted = estimateBoosterRoute({ route: baseline, targetAvailable, targetStatWeights, steam: isFullSteamSave(state) });
    const retroactiveStats = Object.entries(targetStatWeights).map(([statName]) => ({
      statName, amount: toNumber(route.opening.stats[statName]) - toNumber(baseline.opening.stats[statName]),
    }));
    const retroactiveValue = estimateStatRewardValue({ rewards: retroactiveStats, targetStatWeights, steam: isFullSteamSave(state) })
      + Object.entries(route.opening.battleCurrencies).reduce((sum, [name, amount]) =>
        sum + signedLogAmount(amount - toNumber(baseline.opening.battleCurrencies[name])), 0);
    const score = (boosted.jointWinRate - unboosted.jointWinRate) * 1000
      + boosted.rewardValue - unboosted.rewardValue + retroactiveValue;
    return {
      name: candidate.name,
      ids: candidate.ids,
      simulated: true,
      trials,
      winRate: roundNumber(toNumber(simulation.winRate)),
      conditional: true,
      targetAvailable: Boolean(targetAvailable),
      targetRemovedDuringRoute: route.target?.availableNow === true
        && route.steps.some((step) => step.availabilityChanges?.some(({ id }) => id === targetId)),
      routeWinRate: roundNumber(boosted.routeWinRate),
      jointWinRate: targetAvailable ? roundNumber(boosted.jointWinRate) : null,
      steps: route.steps.map(({ id, status, availabilityReason, fightSimulation }) => ({ id, status, availabilityReason,
        fightSimulation: fightSimulation && { winRate: fightSimulation.winRate, winRateCi95: fightSimulation.winRateCi95,
          trials: fightSimulation.trials, p90Seconds: fightSimulation.p90Seconds, p90Censored: fightSimulation.p90Censored } })),
      ci95HalfWidth: simulation.winRateCi95?.halfWidth ?? null,
      timeoutRate: roundNumber(toNumber(simulation.timeoutRate)),
      finalStats: route.finalStats,
      currencies: route.currencies,
      score: roundNumber(score),
    };
  }).sort((a, b) => b.score - a.score || b.routeWinRate - a.routeWinRate);

  return {
    recommendation: choices.find((choice) => !choice.targetRemovedDuringRoute && choice.score > 0 && choice.routeWinRate > 0) ?? null,
    choices,
  };
}

function estimateBoosterRoute({ route, targetAvailable, targetStatWeights, steam }) {
  let routeWinRate = 1;
  let rewardValue = 0;
  for (const step of route.steps) {
    routeWinRate *= toNumber(step.fightSimulation?.winRate);
    rewardValue += routeWinRate * (estimateStatRewardValue({ rewards: step.statRewards, targetStatWeights, steam })
      + (step.currencyRewards ?? []).reduce((sum, reward) => sum + signedLogAmount(reward.amount), 0));
  }
  return { routeWinRate, rewardValue, jointWinRate: targetAvailable ? routeWinRate * toNumber(route.target?.simulation?.winRate) : 0 };
}

function decideMasterpieceRoll({ currentRows, targetId, targetEstimate, masterpieceTargetIds, opusFarm, targetWinRate }) {
  const wanted = new Set([targetId, ...normalizeList(masterpieceTargetIds)].filter(Boolean));
  const visibleMasterpieces = currentRows.filter((row) => row.rarity === "masterpiece");
  const wantedCandidates = visibleMasterpieces.filter((row) => wanted.has(row.id))
    .map((row) => ({ row, estimate: row.id === targetId ? targetEstimate : assessWinRate(row, targetWinRate) }))
    .sort((a, b) => b.estimate.current - a.estimate.current);
  const wantedDecision = wantedCandidates.find(({ estimate }) => estimate.decision === "ready")
    ?? wantedCandidates.find(({ estimate }) => estimate.decision === "increase_trials") ?? wantedCandidates[0];
  const bestVisible = [...visibleMasterpieces].sort((a, b) => b.winRate - a.winRate)[0] ?? null;
  const { row: wantedVisible, estimate: wantedEstimate } = wantedDecision ?? {};

  if (wantedVisible && wantedEstimate.decision === "ready") {
    return {
      decision: "keep_target",
      reason: "wanted_masterpiece_visible_and_favorable",
      targetId: wantedVisible.id,
      winRate: roundNumber(wantedEstimate.current),
      visibleMasterpieces,
    };
  }
  if (wantedVisible) {
    return {
      decision: "keep_scout",
      reason: wantedEstimate.decision === "increase_trials" ? "win_interval_crosses_fight_threshold" : "wanted_masterpiece_visible_but_low_odds",
      targetId: wantedVisible.id,
      winRate: roundNumber(wantedEstimate.current),
      visibleMasterpieces,
    };
  }
  if (opusFarm.worthFarming) {
    return {
      decision: "keep_farm",
      reason: "strong_opus_farm_value",
      targetId: opusFarm.worthFarming.id,
      bestOpus: opusFarm.worthFarming,
      visibleMasterpieces,
    };
  }
  if (opusFarm.uncertain) return { ...uncertainFarmDecision(opusFarm.uncertain), visibleMasterpieces };
  return {
    decision: "redraw",
    reason: "no_wanted_masterpiece_or_strong_farm_value",
    targetId: bestVisible?.id ?? null,
    visibleMasterpieces,
  };
}

function decideRunCompletion({ currentRows, runEV, opusFarm, targetId, targetEstimate }) {
  const targetRow = currentRows.find((row) => row.id === targetId);
  if (targetRow && targetEstimate.decision === "ready") {
    return {
      decision: "fight_target",
      reason: "target_is_visible_and_favorable",
      targetId,
      winRate: roundNumber(targetEstimate.current),
    };
  }
  const rewards = new Map(runEV.sketches.map((sketch) => [sketch.id, sketch]));
  const alternatives = currentRows.filter((row) => row.id !== targetId).map((row) => {
    const reward = rewards.get(row.id);
    const value = Math.max(0, toNumber(reward?.expectedStatScore) + estimateCurrencyBagValue(reward?.expectedCurrencies));
    const valuePerMinute = row.p90Censored ? 0 : value * 60 / Math.max(5, row.p90Seconds ?? 60);
    return { id: row.id, estimate: assessWinRate(row, 0.5), valuePerMinute };
  }).sort((a, b) => b.valuePerMinute - a.valuePerMinute || b.estimate.current - a.estimate.current);
  const best = alternatives.find(({ estimate }) => estimate.decision === "ready");
  if (best) {
    return {
      decision: "finish_best",
      reason: "best_visible_sketch_has_good_odds",
      targetId: best.id,
      winRate: roundNumber(best.estimate.current),
      expectedValuePerMinute: roundNumber(best.valuePerMinute),
    };
  }
  const uncertain = targetRow && targetEstimate.decision === "increase_trials"
    ? { id: targetId, estimate: targetEstimate }
    : alternatives.find(({ estimate }) => estimate.decision === "increase_trials");
  if (uncertain) {
    return {
      decision: "increase_trials",
      reason: "win_interval_crosses_fight_threshold",
      targetId: uncertain.id,
      winRate: roundNumber(uncertain.estimate.current),
    };
  }
  if (opusFarm.worthFarming) {
    return {
      decision: "finish_opus_farm",
      reason: "active_or_available_opus_rewards_are_worth_farming",
      targetId: opusFarm.worthFarming.id,
      bestOpus: opusFarm.worthFarming,
    };
  }
  if (opusFarm.uncertain) return uncertainFarmDecision(opusFarm.uncertain);
  return {
    decision: "redraw",
    reason: "no_high_odds_or_high_value_visible_sketch",
    targetId: null,
  };
}

function uncertainFarmDecision(bestOpus) {
  return {
    decision: "increase_trials",
    reason: bestOpus.secondsCensored ? "opus_farm_fight_time_censored" : "opus_farm_return_uncertain",
    targetId: bestOpus.id,
    bestOpus,
  };
}

function estimateSafetyScore(row, rewardWeights = DEFAULT_REWARD_WEIGHTS) {
  const winRate = clamp01(toNumber(row?.winRate));
  const p90 = Math.max(1, toNumber(row?.p90Seconds, row?.medianSeconds ?? 60));
  return winRate * 8 * toNumber(rewardWeights.winRate, 1)
    - Math.log10(1 + p90) * toNumber(rewardWeights.p90, 1)
    - (1 - winRate) * 4 * toNumber(rewardWeights.risk, 1);
}

function normalizedSafety(row) {
  const winRate = clamp01(toNumber(row?.winRate));
  const p90 = Math.max(1, toNumber(row?.p90Seconds, row?.medianSeconds ?? 60));
  return winRate * 2 - Math.log10(1 + p90) / 3 - (1 - winRate);
}

function decideRedrawFishing(candidates) {
  const best = candidates[0];
  if (!best) return "redraw";
  if (best.rarity === "masterpiece" || best.rarity === "opus" && best.score >= 12) return "keep_run";
  return best.score >= 30 ? "keep_run" : "redraw";
}

function defeatedMasterpieceIds({ state, sketches, currentRows }) {
  const rarityById = new Map(currentRows.map((row) => [row.id, row.rarity]));
  return new Set([...Object.entries(state.sketchVictories ?? {}), ...Object.entries(state.sketchRunVictories ?? {})]
    .filter(([id, count]) => toNumber(count) > 0 && (sketches[id]?.rarity ?? rarityById.get(id)) === "masterpiece")
    .map(([id]) => id));
}

function estimateMasterpieceKillsPerRun({ currentRows, sketches, defeatedMasterpieces, runEV }) {
  const firstWinRates = new Map();
  const routeRates = new Map(runEV.sketches.map(({ id, routeWinRate }) => [id, routeWinRate]));
  for (const row of currentRows) {
    if ((sketches[row.id]?.rarity ?? row.rarity) !== "masterpiece" || defeatedMasterpieces.has(row.id)) continue;
    firstWinRates.set(row.id, Math.max(firstWinRates.get(row.id) ?? 0, routeRates.get(row.id) ?? clamp01(row.winRate)));
  }
  return roundNumber([...firstWinRates.values()].reduce((sum, winRate) => sum + winRate, 0));
}

function estimateWinRateGainPerRun({ currentRows, runEV }) {
  const bestRewardGain = Math.max(
    0,
    ...(runEV.sketches ?? []).map((item) => Math.min(0.15, Math.max(0, toNumber(item.expectedStatScore)) * 0.02)),
  );
  const bestVisibleGain = Math.max(
    0,
    ...currentRows.map((row) => clamp01(toNumber(row.winRate)) * 0.015),
  );
  return roundNumber(Math.max(bestRewardGain, bestVisibleGain));
}

function estimateUsefulRunRate(currentRows) {
  if (!currentRows || currentRows.length === 0) return 0.05;
  const rates = [...currentRows]
    .filter((row) => !row.hidden)
    .map((row) => clamp01(toNumber(row.winRate)))
    .sort((a, b) => b - a)
    .slice(0, 3);
  if (rates.length === 0) return 0.05;
  return roundNumber(rates.reduce((sum, rate) => sum + rate, 0) / rates.length);
}

function boundedFarmTrials(trials) {
  return Math.max(1, Math.min(MAX_FARM_TRIALS, Math.floor(toNumber(trials, MAX_FARM_TRIALS))));
}

function createWinRateCurve({
  sketches, state, assumptions, stats, current, currentRows, runEV, targetId, targetWinRate, trials, maxSeconds, seed,
}) {
  const rowsById = new Map(currentRows.map((row) => [row.id, row]));
  const glossary = isFullSteamSave(state) && Array.isArray(state.glossaryUnlocks)
    && state.multiverse?.currentUniverseId !== "mv-easy-2" ? new Set(state.glossaryUnlocks) : null;
  const resetMode = isFullSteamSave(state)
    && ["mv-hard-2", "mv-medium-4"].includes(state.multiverse?.currentUniverseId);
  const optionsById = new Map(runEV.sketches.filter((item) => item.id !== targetId).map((item) => [item.id, {
    id: item.id,
    name: item.name,
    remaining: Math.ceil(rowsById.get(item.id).remainingToMax),
    winRate: rowsById.get(item.id).winRate,
    changesPlayer: (sketches[item.id].rewards ?? []).some((reward) => toNumber(reward.amount) !== 0)
      || Boolean(glossary && !glossary.has(item.id)) || resetMode,
  }]));
  const queue = [...optionsById.values()].filter((item) => item.winRate > 0);
  const curve = [];
  const rewardingCandidates = queue.filter((item) => item.changesPlayer);
  if (!sketches[targetId]?.stats) {
    return { curve, improvesTarget: false, hasUnverifiedCandidates: rewardingCandidates.length > 0 };
  }
  const enemy = enemyFromSketch(sketches[targetId], targetId);
  const needsFarmChecks = rewardingCandidates.some((item) => queue.length > 1 || item.remaining > 1);
  const checkTrialBudget = needsFarmChecks ? MAX_FARM_CHECK_TRIALS : 0;
  const sampleTrials = Math.min(boundedFarmTrials(trials), MAX_FARM_TRIALS - checkTrialBudget);
  const simulate = (player) => runMonteCarlo({
    player, enemy, assumptions, trials: sampleTrials, maxSeconds, seed: `${seed}:farm-curve`,
  }).winRate;
  let projectedState = state;
  let player = stats;
  let baseline;
  let winRate;
  let projected = current;
  let improvesTarget = false;
  let unverifiedFight = false;
  let nextIndex = 0;
  const targetInitiallyAvailable = getSketchFightEligibility(sketches[targetId], state).eligible;

  // At the original stats the current-run results already cover the fight.
  // With projected stats, share the per-step trial budget between both fights.
  for (; nextIndex < queue.length && nextIndex < MAX_FARM_STEPS; nextIndex += 1) {
    const item = queue[nextIndex];
    const farmer = sketches[item.id];
    if (!getSketchFightEligibility(farmer, projectedState).eligible) continue;
    if (player !== stats && (!farmer.stats || runMonteCarlo({
      player,
      enemy: enemyFromSketch(farmer, item.id),
      assumptions,
      trials: Math.min(checkTrialBudget, sampleTrials),
      maxSeconds,
      seed: `${seed}:${item.id}:farm-check`,
    }).wins === 0)) {
      unverifiedFight = true;
      continue;
    }
    const previousPlayer = player;
    try {
      const result = projectVictories({ state: projectedState, baseStats: player, sketches, ids: [item.id], requireAvailability: true });
      if (!result.appliedIds.length) continue;
      if (targetInitiallyAvailable && !getSketchFightEligibility(sketches[targetId], result.state).eligible) {
        // Another fight first can change which zero-victory sketch gets culled.
        unverifiedFight ||= queue.some(({ id }) => id !== item.id);
        continue;
      }
      projectedState = result.state;
      if (result.lastReward?.statRewards?.some(({ statName }) =>
        toNumber(result.stats[statName]) !== toNumber(player[statName]))) {
        baseline ??= simulate(stats);
        winRate = simulate(result.stats);
        player = result.stats;
      }
    } catch (error) {
      if (!(error instanceof RewardProjectionError)) throw error;
      unverifiedFight = true;
      continue;
    }
    if (item.remaining > 1 && previousPlayer !== player) {
      queue.push({ ...item, remaining: item.remaining - 1 });
    }

    // Pair the target trials and anchor their measured difference to the reported win rate.
    const nextProjected = baseline == null ? current : clamp01(current + (winRate - baseline));
    improvesTarget ||= nextProjected > current;
    curve.push({
      step: curve.length + 1,
      id: item.id,
      name: item.name,
      victoryNumber: projectedState.sketchVictories[item.id],
      projectedWinRate: roundNumber(nextProjected),
      gain: roundNumber(nextProjected - projected),
      reachesTarget: nextProjected >= targetWinRate && winRate > baseline
        && confidenceInterval95(winRate, sampleTrials).lower >= targetWinRate,
    });
    projected = nextProjected;
    if (curve.at(-1).reachesTarget) {
      nextIndex += 1;
      break;
    }
  }
  const hasUnverifiedCandidates = unverifiedFight
    || queue.slice(nextIndex).some((item) => item.changesPlayer)
    || rewardingCandidates.length > 1
    || (player !== stats && [...optionsById.values()].some((item) => item.winRate <= 0 && item.changesPlayer));
  return { curve, improvesTarget, hasUnverifiedCandidates };
}

function rarityProfileScore(rarity) {
  return {
    rough: 1,
    framed: 2,
    opus: 4,
    masterpiece: 8,
  }[rarity] ?? 0;
}

function toCamelModeId(id) {
  return String(id).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function estimateStatRewardValue({ rewards = [], targetStatWeights = {}, steam = false }) {
  let score = 0;
  for (const reward of rewards ?? []) {
    const weight = toNumber(targetStatWeights[reward.statName], 1);
    const amount = toNumber(reward.amount);
    score += signedLogAmount(steam && reward.statName === "attackSpeed" ? -amount : amount) * weight;
  }
  return score;
}

function estimateCurrencyRewardValue({ rewards = [], state = {}, goalCurrencies = {} }) {
  let score = 0;
  const currencies = numericObject(state.currencies ?? {});
  for (const reward of rewards ?? []) {
    const amount = toNumber(reward.amount);
    if (amount <= 0) continue;
    const goal = toNumber(goalCurrencies[reward.name]);
    const missing = goal > 0 ? Math.max(0, goal - toNumber(currencies[reward.name])) : 0;
    if (missing > 0) score += Math.min(amount, missing) / missing * 100;
    score += Math.log10(1 + amount) * (missing > 0 ? 2 : 0.5);
  }
  return score;
}

function bestCurrencyReward(rewards = []) {
  return [...rewards ?? []]
    .filter((reward) => toNumber(reward.amount) > 0)
    .map((reward) => ({ name: reward.name, amount: roundNumber(toNumber(reward.amount)) }))
    .sort((a, b) => b.amount - a.amount)[0] ?? null;
}

function bestStatRewards(rewards = [], targetStatWeights = {}) {
  return [...rewards ?? []]
    .map((reward) => ({
      statName: reward.statName,
      amount: roundNumber(toNumber(reward.amount)),
      weight: toNumber(targetStatWeights[reward.statName], 1),
    }))
    .sort((a, b) => b.weight * Math.abs(b.amount) - a.weight * Math.abs(a.amount))
    .slice(0, 3);
}

function normalizeCurrentRows({ currentRun, state, sketches }) {
  const rows = currentRun?.targets ?? normalizeList(state.availableSketches)
    .map((id) => sketches[id])
    .filter(Boolean)
    .map(({ id, name, rarity }) => ({ id, name, rarity }));
  return rows
    .filter((row) => !row.hidden && getSketchFightEligibility(sketches[row.id], state).eligible)
    .map((row) => normalizeCurrentRow({ ...row, rarity: row.rarity ?? sketches[row.id].rarity }, state))
    .filter((row) => row.remainingToMax > 0);
}

function normalizeCurrentRow(row, state) {
  const remaining = remainingSketchVictories(state, row.id);
  const p90Seconds = toNumber(row.p90Seconds, -1);
  const medianSeconds = toNumber(row.medianSeconds, -1);
  return {
    id: row.id,
    name: row.name ?? row.id,
    rarity: row.rarity ?? "unknown",
    hidden: Boolean(row.hidden),
    winRate: toNumber(row.winRate, null),
    winRateCi95: row.winRateCi95,
    trials: row.trials,
    p90Seconds: p90Seconds >= 0 ? p90Seconds : medianSeconds >= 0 ? medianSeconds : null,
    p90Censored: p90Seconds >= 0 ? Boolean(row.p90Censored) : medianSeconds >= 0 && Boolean(row.medianCensored),
    remainingToMax: Math.min(toNumber(row.remainingToMax, remaining), remaining),
  };
}

function rewardMultiplier({ state, id }) {
  const totalVictories = toNumber(state.sketchVictories?.[id]);
  const decay = toNumber(state.fundamentals?.rewardDecay, 1);
  const boosted = normalizeList(state.boostedSketchIds).includes(id);
  const booster = boosted ? 1 + toNumber(state.fundamentals?.rewardBoosterEffect, 50) / 100 : 1;
  return 1 / (1 + totalVictories * decay) * booster;
}

function estimateSteamPayout({ sketch, state, baseStats, perkWinsRemaining = 0 }) {
  const id = sketch.id;
  const victoriesBefore = toNumber(state.sketchVictories?.[id]);
  const rewardContext = {
    state,
    id,
    sketch,
    victoriesBefore,
    boosted: normalizeList(state.boostedSketchIds).includes(id),
  };
  const rewards = steamSketchRewards(rewardContext);
  if (!rewards) return null;
  const afterPerk = perkWinsRemaining > 0
    ? steamSketchRewards({ ...rewardContext, newWins: perkWinsRemaining })
    : null;
  let statRewards = (sketch.rewards ?? []).map((reward) => ({ ...reward, amount: rewards.statGain(reward) }));
  if (baseStats && Object.keys(baseStats).length > 0) {
    try {
      const projection = createSteamStatProjection(state, { ...baseStats });
      statRewards = [...applySteamVictoryStatChanges(projection, state, id, sketch, rewards.statGain)]
        .map(([statName, amount]) => ({ statName, amount }));
    } catch (error) {
      if (!(error instanceof RewardProjectionError)) throw error;
      statRewards = [];
    }
  }
  return {
    statRewards,
    currencyRewards: (sketch.currencyRewards ?? []).map((reward) => ({
      ...reward,
      amount: rewards.currencyGain(reward),
      ...(afterPerk && { amountWithoutPerk: afterPerk.currencyGain(reward) }),
    })),
  };
}

function estimateCurrencyEV({ currencies, rates, routeSeconds, windowSeconds }) {
  const names = new Set([...Object.keys(currencies), ...Object.keys(rates)]);
  return Object.fromEntries([...names].map((name) => {
    const { battleExpectedPerRun = 0, battleWindowExpected = 0 } = currencies[name] ?? {};
    const passivePerSecond = toNumber(rates[name]);
    const passiveExpected = passivePerSecond * windowSeconds;
    const passiveExpectedPerRun = routeSeconds == null && passivePerSecond !== 0 ? null : passivePerSecond * (routeSeconds ?? 0);
    const battlePerSecond = battleExpectedPerRun === 0 ? 0 : routeSeconds > 0 ? battleExpectedPerRun / routeSeconds : null;
    return [name, {
      expected: roundNumber(battleWindowExpected + passiveExpected),
      battleWindowExpected: roundNumber(battleWindowExpected),
      passiveExpected: roundNumber(passiveExpected),
      expectedPerRun: roundNumber(battleExpectedPerRun + (passiveExpectedPerRun ?? 0)),
      battleExpectedPerRun: roundNumber(battleExpectedPerRun),
      passiveExpectedPerRun: passiveExpectedPerRun == null ? null : roundNumber(passiveExpectedPerRun),
      perSecond: roundNumber((battlePerSecond ?? 0) + passivePerSecond),
      battlePerSecond: battlePerSecond == null ? null : roundNumber(battlePerSecond),
    }];
  }));
}

function totalEVValue({ currencies, quintessence, statValue, amountKey }) {
  const currencyValue = Object.values(currencies)
    .reduce((sum, item) => sum + Math.log10(1 + Math.max(0, item[amountKey])), 0);
  const quintessenceValue = Math.log10(1 + Math.max(0, quintessence[amountKey] ?? 0));
  return currencyValue + quintessenceValue + statValue;
}

function quintessencePerSecond(state) {
  return toNumber(
    state.quintessencePerSecond
    ?? state.quintessenceGeneratorRate
    ?? state.pendingQuintessencePerSecond
    ?? state.conceptualSynthesis?.quintessencePerSecond,
  );
}

function estimatePassiveWaitValue({ state, seconds }) {
  const q = quintessencePerSecond(state) * seconds;
  const currency = Object.values(generatorRates(state))
    .reduce((sum, rate) => sum + Math.log10(1 + Math.max(0, rate * seconds)), 0);
  return Math.log10(1 + Math.max(0, q)) + currency;
}

function estimateCurrencyBagValue(currencies = {}) {
  return Object.values(currencies).reduce((sum, amount) => sum + Math.log10(1 + Math.max(0, toNumber(amount))), 0);
}

function normalizeCandidates(candidates) {
  if (!candidates) return [];
  return [...candidates].map((candidate, index) => ({
    name: candidate.name ?? `candidate_${index + 1}`,
    ids: normalizeList(candidate.ids ?? candidate.routeIds),
  })).filter((candidate) => candidate.ids.length > 0);
}

function secondsToGoal(missing, perSecond) {
  if (missing <= 0) return 0;
  if (perSecond <= 0) return null;
  return roundNumber(missing / perSecond);
}

function signedLogAmount(amount) {
  const magnitude = Math.log10(1 + Math.abs(amount));
  return amount >= 0 ? magnitude : -magnitude * 1.5;
}

function numericObject(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw ?? {})) result[key] = toNumber(value);
  return result;
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value instanceof Set) return [...value].filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "object") return Object.values(value).filter(Boolean);
  return [];
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundNumber(value) {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;
  const abs = Math.abs(value);
  if (abs >= 1e12 || abs < 1e-6) return Number(value.toPrecision(12));
  return Math.round(value * 1e6) / 1e6;
}
