import { analyzeBuildAdvice } from "./build-advisor.js";
import { runMonteCarlo } from "./combat.js";
import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { confidenceInterval95 } from "./combat/math.js";
import { enemyFromSketch } from "./combat/steam-encounter.js";
import { generatorRates } from "./currency-generators.js";
import { createEconomyPlan, resolveSoftcapSeconds } from "./economy.js";
import { RewardProjectionError, steamCurrencyPerkWinsRemaining, steamSketchRewards } from "./rewards.js";
import { currencyRewardAmount, projectVictories, simulateRoute } from "./route.js";
import { isFullSteamSave, normalizeStats, toNumber } from "./save.js";
import { applySteamVictoryStatChanges, createSteamStatProjection } from "./steam-stat-projection.js";
import { isSketchToolUnlocked } from "./tool-rules.js";
import { remainingSketchVictories } from "./victory-limit.js";

const DEFAULT_TARGET_WIN_RATE = 0.5;
const DEFAULT_FARM_SECONDS = 3600;
const DEFAULT_MAX_SOFTCAP_WAIT_SECONDS = 30 * 60;
const DEFAULT_COMPARE_PROFILE_IDS = ["farm-q", "3-masterpiece", "transcendent-paragon"];
const MAX_FARM_STEPS = 8;
const MAX_FARM_TRIALS = 200;
const MAX_FARM_CHECK_TRIALS = 20;

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
  const buildAdvice = analyzeBuildAdvice({ sketches, state, assumptions, targetId, baseStats: stats });
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
    opusValues: visibleOpusValues,
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
    opusValues: visibleOpusValues,
    targetWinRate: effectiveTargetWinRate,
  });
  const runCompletion = decideRunCompletion({
    currentRows,
    opusValues: visibleOpusValues,
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
    targetId,
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
    expectedPerRun = estimateMasterpieceKillsPerRun({ currentRows, sketches, defeatedMasterpieces });
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
    missing = approach.ready ? 0 : toNumber(approach.winRate.missing);
    expectedPerRun = estimateWinRateGainPerRun({ currentRows, runEV });
    unit = "custom";
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

  const averageRuns = expectedPerRun > 0 ? missing / expectedPerRun : null;
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
    .filter((row) => !row.hidden)
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
  sketches, state, assumptions, stats, targetEstimate, currentRows, runEV,
  targetId, trials, maxSeconds, seed,
}) {
  const { current, target: targetWinRate, decision } = targetEstimate;
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
      currentWinRate: roundNumber(current),
      targetWinRate,
      targetStep: crossing.step,
      targetSketchId: crossing.id,
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

function estimateApproachReadiness({ state, targetEstimate, goalQuintessence, goalCurrencies }) {
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
  const ready = targetEstimate.decision === "ready" && resourceReady;
  return {
    decision: ready ? "ready_to_attempt" : targetEstimate.decision === "increase_trials" ? "increase_trials" : "farm_more",
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
    const steamRewards = estimateSteamPayout({
      sketch,
      state,
      baseStats,
      perkWinsRemaining,
      perkProbability: priorWinProbabilities.reduce((sum, chance) => sum + chance, 0),
    });
    if (steamRewards && perkWinsRemaining > 0) {
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
      const expected = rewardAmount * winRate;
      expectedCurrencies[reward.name] = toNumber(expectedCurrencies[reward.name]) + expected;
      const item = currencies[reward.name] ??= { battleExpectedPerRun: 0, battleWindowExpected: 0 };
      item.battleExpectedPerRun += expected;
      if (completesInWindow) item.battleWindowExpected += expected;
    }
    const expectedStatScore = estimateStatRewardValue({
      rewards: steamRewards?.statRewards ?? sketch.rewards,
      targetStatWeights,
      steam: Boolean(steamRewards),
    }) * winRate;
    statValuePerRun += expectedStatScore;
    if (completesInWindow) statValue += expectedStatScore;
    sketchesEV.push({
      id: row.id,
      name: row.name ?? sketch.name ?? row.id,
      rarity: row.rarity ?? sketch.rarity ?? "unknown",
      winRate: roundNumber(winRate),
      seconds,
      secondsCensored: row.p90Censored,
      expectedCurrencies: Object.fromEntries(Object.entries(expectedCurrencies).map(([name, amount]) => [name, roundNumber(amount)])),
      expectedStatScore: roundNumber(expectedStatScore),
    });
  }

  const routeSeconds = routeTimed ? earliestSeconds : null;
  const currencyEV = estimateCurrencyEV({ currencies, rates: generatorRates(state), routeSeconds, windowSeconds });
  const quintessenceRate = quintessencePerSecond(state);
  const quintessence = {
    expected: roundNumber(quintessenceRate * windowSeconds),
    expectedPerRun: routeSeconds == null && quintessenceRate !== 0 ? null : roundNumber(quintessenceRate * (routeSeconds ?? 0)),
    perSecond: roundNumber(quintessenceRate),
  };

  return {
    windowSeconds,
    windowTimingIncomplete,
    routeSeconds,
    quintessence,
    currencies: currencyEV,
    statValue: roundNumber(statValue),
    statValuePerRun: roundNumber(statValuePerRun),
    totalValue: roundNumber(totalEVValue({ currencies: currencyEV, quintessence, statValue, amountKey: "expected" })),
    totalValuePerRun: roundNumber(totalEVValue({ currencies: currencyEV, quintessence, statValue: statValuePerRun, amountKey: "expectedPerRun" })),
    sketches: sketchesEV.sort((a, b) => b.expectedStatScore - a.expectedStatScore),
  };
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

function createFarmPlan({ approach, runEV, opusValues, state }) {
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
    decision: goal.type === "win_rate" && approach.winRate.decision === "increase_trials" ? "increase_trials"
      : goal.missing <= 0 ? "goal_reached" : goal.estimatedSeconds == null ? "farm_best_active_rewards" : "farm_until_goal",
    goal,
    windowSeconds: runEV.windowSeconds,
    passiveRates: {
      quintessence: quintessencePerSecond(state),
      currencies: generatorRates(state),
    },
    bestOpusTargets: opusValues.slice(0, 5),
  };
}

function compareBoosterChoices({
  sketches,
  state,
  assumptions,
  baseStats,
  targetId,
  candidates,
  targetStatWeights,
  trials,
  maxSeconds,
  seed,
}) {
  if (!isSketchToolUnlocked(state, "booster")) return { recommendation: null, choices: [] };
  const hiddenIds = new Set(normalizeList(state.hiddenSketches));
  const existing = new Set(normalizeList(state.boostedSketchIds));
  const remaining = Math.max(0, 1 + toNumber(state.fundamentals?.rewardBoosterUses) - existing.size);
  const eligibleCandidates = normalizeCandidates(candidates)
    .filter((candidate) => candidate.ids.every((id) => !hiddenIds.has(id))
      && (!isFullSteamSave(state) || new Set(candidate.ids.filter((id) => !existing.has(id))).size <= remaining));
  const choices = eligibleCandidates.map((candidate) => {
    const route = simulateRoute({
      sketches,
      state,
      assumptions,
      baseStats,
      targetId,
      routeIds: candidate.ids,
      boostedIds: candidate.ids,
      trials,
      maxSeconds,
      seed: `${seed}:booster`,
    });
    const simulation = route.target?.simulation ?? {};
    const statValue = estimateStatsObjectValue({ stats: route.finalStats, baseStats, targetStatWeights, steam: isFullSteamSave(state) });
    const currencyValue = estimateCurrencyBagValue(route.totalEarnedCurrencies);
    const score = toNumber(simulation.winRate) * 1000 + statValue + currencyValue;
    return {
      name: candidate.name,
      ids: candidate.ids,
      simulated: true,
      trials,
      winRate: roundNumber(toNumber(simulation.winRate)),
      ci95HalfWidth: simulation.winRateCi95?.halfWidth ?? null,
      timeoutRate: roundNumber(toNumber(simulation.timeoutRate)),
      finalStats: route.finalStats,
      currencies: route.currencies,
      score: roundNumber(score),
    };
  }).sort((a, b) => b.score - a.score || b.winRate - a.winRate);

  return {
    recommendation: choices[0] ?? null,
    choices,
  };
}

function decideMasterpieceRoll({ currentRows, targetId, targetEstimate, masterpieceTargetIds, opusValues, targetWinRate }) {
  const wanted = new Set([targetId, ...normalizeList(masterpieceTargetIds)].filter(Boolean));
  const visibleMasterpieces = currentRows.filter((row) => row.rarity === "masterpiece");
  const wantedVisible = visibleMasterpieces.find((row) => wanted.has(row.id));
  const bestVisible = visibleMasterpieces.sort((a, b) => toNumber(b.winRate) - toNumber(a.winRate))[0] ?? null;
  const bestOpus = opusValues[0] ?? null;
  const wantedEstimate = wantedVisible?.id === targetId ? targetEstimate : assessWinRate(wantedVisible, targetWinRate);

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
  if (bestOpus && bestOpus.score >= 10) {
    return {
      decision: "keep_farm",
      reason: "strong_opus_farm_value",
      targetId: bestVisible?.id ?? bestOpus.id,
      bestOpus,
      visibleMasterpieces,
    };
  }
  return {
    decision: "redraw",
    reason: "no_wanted_masterpiece_or_strong_farm_value",
    targetId: bestVisible?.id ?? null,
    visibleMasterpieces,
  };
}

function decideRunCompletion({ currentRows, opusValues, targetId, targetEstimate }) {
  const targetRow = currentRows.find((row) => row.id === targetId);
  if (targetRow && targetEstimate.decision === "ready") {
    return {
      decision: "fight_target",
      reason: "target_is_visible_and_favorable",
      targetId,
      winRate: roundNumber(targetEstimate.current),
    };
  }
  const alternatives = currentRows.filter((row) => row.id !== targetId)
    .sort((a, b) => b.winRate - a.winRate)
    .map((row) => ({ id: row.id, estimate: assessWinRate(row, 0.5) }));
  const best = alternatives.find(({ estimate }) => estimate.decision === "ready");
  if (best) {
    return {
      decision: "finish_best",
      reason: "best_visible_sketch_has_good_odds",
      targetId: best.id,
      winRate: roundNumber(best.estimate.current),
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
  const bestOpus = opusValues[0] ?? null;
  if (bestOpus && bestOpus.score >= 10) {
    return {
      decision: "finish_opus_farm",
      reason: "active_or_available_opus_rewards_are_worth_farming",
      targetId: bestOpus.id,
      score: bestOpus.score,
    };
  }
  return {
    decision: "redraw",
    reason: "no_high_odds_or_high_value_visible_sketch",
    targetId: null,
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

function estimateMasterpieceKillsPerRun({ currentRows, sketches, defeatedMasterpieces }) {
  const firstWinRates = new Map();
  for (const row of currentRows) {
    if ((sketches[row.id]?.rarity ?? row.rarity) !== "masterpiece" || defeatedMasterpieces.has(row.id)) continue;
    firstWinRates.set(row.id, Math.max(firstWinRates.get(row.id) ?? 0, clamp01(row.winRate)));
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

  // At the original stats the current-run results already cover the fight.
  // With projected stats, share the per-step trial budget between both fights.
  for (; nextIndex < queue.length && nextIndex < MAX_FARM_STEPS; nextIndex += 1) {
    const item = queue[nextIndex];
    const farmer = sketches[item.id];
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
      const result = projectVictories({ state: projectedState, baseStats: player, sketches, ids: [item.id] });
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
  const hidden = new Set(normalizeList(state.hiddenSketches));
  const rows = currentRun?.targets ?? normalizeList(state.availableSketches)
    .map((id) => sketches[id])
    .filter(Boolean)
    .map(({ id, name, rarity }) => ({ id, name, rarity }));
  return rows
    .filter((row) => !row.hidden && !hidden.has(row.id))
    .map((row) => normalizeCurrentRow(row, state))
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
    winRate: toNumber(row.winRate),
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

function estimateSteamPayout({ sketch, state, baseStats, perkWinsRemaining = 0, perkProbability = 1 }) {
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
  const afterPerk = perkWinsRemaining > 0 && perkProbability < 1
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
      amount: afterPerk
        ? rewards.currencyGain(reward) * perkProbability + afterPerk.currencyGain(reward) * (1 - perkProbability)
        : rewards.currencyGain(reward),
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

function estimateStatsObjectValue({ stats, baseStats, targetStatWeights, steam }) {
  let score = 0;
  for (const [stat, weight] of Object.entries(targetStatWeights)) {
    const delta = toNumber(stats[stat]) - toNumber(baseStats?.[stat]);
    if (delta === 0) continue;
    score += signedLogAmount(steam && stat === "attackSpeed" ? -delta : delta) * weight;
  }
  return score;
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
