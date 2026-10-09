import { analyzeBuildAdvice } from "./build-advisor.js";
import { createEconomyPlan } from "./economy.js";
import { currencyRewardAmount, simulateRoute } from "./route.js";
import { toNumber } from "./save.js";

const DEFAULT_TARGET_WIN_RATE = 0.5;
const DEFAULT_FARM_SECONDS = 3600;
const DEFAULT_MAX_SOFTCAP_WAIT_SECONDS = 30 * 60;
const DEFAULT_COMPARE_PROFILE_IDS = ["farm-q", "3-masterpiece", "transcendent-paragon"];

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
  targetId,
  baseStats = null,
  targetSimulation = null,
  currentRun = null,
  goalQuintessence = null,
  goalCurrencies = {},
  targetWinRate = null,
  softcapSeconds = null,
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
  const stats = numericObject(baseStats ?? state.currentRunStats ?? state.battleStats ?? state.playerStats ?? {});
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
  const effectiveTargetWinRate = targetWinRate == null
    ? toNumber(profileConfig.targetWinRate, DEFAULT_TARGET_WIN_RATE)
    : toNumber(targetWinRate, DEFAULT_TARGET_WIN_RATE);
  const buildAdvice = analyzeBuildAdvice({ sketches, state, targetId, baseStats: stats });
  const rawTargetStatWeights = Object.fromEntries(
    buildAdvice.targetPlan.priorityStats.map((item) => [item.stat, item.weight]),
  );
  const targetStatWeights = scaleTargetStatWeights(rawTargetStatWeights, rewardWeights);
  const approach = estimateApproachReadiness({
    state,
    targetSimulation,
    currentRows,
    targetId,
    targetWinRate: effectiveTargetWinRate,
    goalQuintessence: effectiveGoalQuintessence,
    goalCurrencies: normalizedGoalCurrencies,
  });
  const opusValues = rankOpusStrategicValue({
    sketches,
    state,
    targetStatWeights,
    goalCurrencies: normalizedGoalCurrencies,
    rewardWeights,
    currentRows,
  });
  const runEV = estimateRunEV({
    sketches,
    state,
    currentRows,
    targetStatWeights,
    farmSeconds,
  });
  const softcap = decideSoftcapOrRedraw({
    state,
    softcapSeconds,
    maxSoftcapWaitSeconds,
    currentRows,
    runEV,
  });
  const farmPlan = createFarmPlan({
    approach,
    runEV,
    opusValues,
    state,
    farmSeconds,
  });
  const profileGoal = createProfileGoal({
    profile: profileConfig,
    state,
    sketches,
    goalQuintessence: effectiveGoalQuintessence,
    goalCurrencies: normalizedGoalCurrencies,
    targetWinRate: effectiveTargetWinRate,
  });
  const profileModes = createProfileModes({
    currentRows,
    runEV,
    opusValues,
    targetId,
    profile: profileConfig,
    rewardWeights,
  });
  const profileProgress = estimateProfileProgress({
    profile: profileConfig,
    profileGoal,
    approach,
    runEV,
    currentRows,
    sketches,
    state,
  });
  const boosters = compareBoosterChoices({
    sketches,
    state,
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
    target,
    masterpieceTargetIds,
    opusValues,
    targetWinRate: effectiveTargetWinRate,
  });
  const runCompletion = decideRunCompletion({
    currentRows,
    opusValues,
    targetId,
  });
  const profileRecommendations = createProfileRecommendations({
    buildAdvice,
    currentRows,
    profile: profileConfig,
    mode: modeConfig,
    rewardWeights,
  });
  const stopFarming = decideStopFarming({
    targetSimulation,
    currentRows,
    runEV,
    targetId,
    targetWinRate: effectiveTargetWinRate,
    activeMode: profileModes[toCamelModeId(modeConfig.id)],
  });
  const profileComparison = createProfileComparison({
    requestedProfileIds: normalizeList(compareProfiles).length > 0 ? compareProfiles : profileIds,
    selectedProfileId: profileConfig.id,
    state,
    sketches,
    approach,
    runEV,
    currentRows,
    targetId,
    targetSimulation,
  });
  const economy = createEconomyPlan({
    state,
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
  targetStatWeights = {},
  goalCurrencies = {},
  rewardWeights = DEFAULT_REWARD_WEIGHTS,
  currentRows = [],
} = {}) {
  const rowsById = new Map(normalizeCurrentRows({ currentRun: { targets: currentRows }, state, sketches })
    .map((row) => [row.id, row]));
  return Object.values(sketches)
    .filter((sketch) => sketch?.rarity === "opus")
    .map((sketch) => {
      const statScore = estimateStatRewardValue({ rewards: sketch.rewards, targetStatWeights });
      const currencyScore = estimateCurrencyRewardValue({ rewards: sketch.currencyRewards, state, goalCurrencies });
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
        bestCurrency: bestCurrencyReward(sketch.currencyRewards),
        bestStats: bestStatRewards(sketch.rewards, targetStatWeights),
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

function createProfileGoal({ profile, state, sketches = {}, goalQuintessence, goalCurrencies, targetWinRate }) {
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
    const current = countDefeatedMasterpieces({ state, sketches });
    return {
      type: "masterpiece_count",
      current,
      goal: goal.count,
      missing: Math.max(0, toNumber(goal.count) - current),
    };
  }
  if (goal.type === "target_win_rate") {
    return {
      type: "target_win_rate",
      current: null,
      goal: targetWinRate,
      missing: null,
      targetId: profile.targetId ?? null,
    };
  }
  return {
    type: "custom",
    current: null,
    goal: null,
    missing: 0,
  };
}

function estimateProfileProgress({ profile, profileGoal, approach, runEV, currentRows, sketches, state }) {
  const type = profileGoal.type;
  let missing = toNumber(profileGoal.missing);
  let expectedPerRun = 0;
  let unit = type;

  if (type === "quintessence") {
    expectedPerRun = toNumber(runEV.quintessence?.expected);
    unit = "Q";
  } else if (type === "currency") {
    expectedPerRun = toNumber(runEV.currencies?.[profileGoal.currency]?.expected);
    unit = profileGoal.currency;
  } else if (type === "masterpiece_count") {
    expectedPerRun = estimateMasterpieceKillsPerRun({ currentRows, sketches, state });
    unit = "masterpiece";
  } else if (type === "target_win_rate") {
    missing = Math.max(0, toNumber(profile.targetWinRate, DEFAULT_TARGET_WIN_RATE) - toNumber(approach.winRate.current));
    expectedPerRun = estimateWinRateGainPerRun({ currentRows, runEV });
    unit = "win_rate";
  } else {
    missing = approach.ready ? 0 : toNumber(approach.winRate.missing);
    expectedPerRun = estimateWinRateGainPerRun({ currentRows, runEV });
    unit = "custom";
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
        score += safety * 60 - toNumber(row.p90Seconds) * 0.2 * toNumber(rewardWeights.p90, 1);
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
        p90Seconds: roundNumber(toNumber(row.p90Seconds)),
        score: roundNumber(score),
        currencyValue: roundNumber(currencyValue),
        statValue: roundNumber(statValue),
      };
    })
    .sort((a, b) => b.score - a.score || b.winRate - a.winRate || a.p90Seconds - b.p90Seconds);
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

function decideStopFarming({ targetSimulation, currentRows, runEV, targetId, targetWinRate, activeMode }) {
  const current = roundNumber(toNumber(
    targetSimulation?.winRate,
    currentRows.find((row) => row.id === targetId)?.winRate ?? 0,
  ));
  const curve = createWinRateCurve({ current, runEV, currentRows, targetWinRate });
  if (current >= targetWinRate) {
    return {
      decision: "attempt_target",
      reason: "target_win_rate_reached",
      currentWinRate: current,
      targetWinRate,
      curve,
    };
  }
  const crossing = curve.find((step) => step.projectedWinRate >= targetWinRate);
  if (crossing) {
    return {
      decision: "farm_until_step",
      reason: "visible_rewards_project_target_ready",
      currentWinRate: current,
      targetWinRate,
      targetStep: crossing.step,
      targetSketchId: crossing.id,
      curve,
    };
  }
  return {
    decision: activeMode?.recommendation ? "farm_more" : "redraw",
    reason: activeMode?.recommendation ? "visible_rewards_help_but_do_not_cross_target" : "no_visible_progress_path",
    currentWinRate: current,
    targetWinRate,
    curve,
  };
}

function createProfileComparison({
  requestedProfileIds,
  selectedProfileId,
  state,
  sketches,
  approach,
  runEV,
  currentRows,
  targetId,
  targetSimulation,
}) {
  const ids = normalizeList(requestedProfileIds);
  const selected = selectedProfileId && selectedProfileId !== "custom" ? [selectedProfileId] : [];
  const uniqueIds = [...new Set((ids.length > 0 ? ids : [...selected, ...DEFAULT_COMPARE_PROFILE_IDS]).filter(Boolean))];
  return uniqueIds
    .map((id) => resolveStrategyProfile(id, { targetId }))
    .filter((item) => item.id !== "custom")
    .map((profile) => {
      const mode = resolveStrategyMode(profile.defaultMode);
      const weights = resolveRewardWeights({ profile, mode });
      const defaults = createProfileGoalDefaults({ profile, state });
      const goal = createProfileGoal({
        profile,
        state,
        sketches,
        goalQuintessence: defaults.goalQuintessence,
        goalCurrencies: defaults.goalCurrencies,
        targetWinRate: toNumber(profile.targetWinRate, DEFAULT_TARGET_WIN_RATE),
      });
      const progress = estimateProfileProgress({
        profile,
        profileGoal: goal,
        approach: profile.id === selectedProfileId
          ? approach
          : {
            ...approach,
            winRate: {
              ...approach.winRate,
              current: toNumber(targetSimulation?.winRate, approach.winRate.current),
              target: toNumber(profile.targetWinRate, DEFAULT_TARGET_WIN_RATE),
              missing: Math.max(0, toNumber(profile.targetWinRate, DEFAULT_TARGET_WIN_RATE) - toNumber(targetSimulation?.winRate, approach.winRate.current)),
            },
          },
        runEV,
        currentRows,
        sketches,
        state,
      });
      const modePlan = createProfileModes({
        currentRows,
        runEV,
        opusValues: [],
        targetId,
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

function estimateApproachReadiness({
  state,
  targetSimulation,
  currentRows,
  targetId,
  targetWinRate,
  goalQuintessence,
  goalCurrencies,
}) {
  const currentWinRate = roundNumber(toNumber(
    targetSimulation?.winRate,
    currentRows.find((row) => row.id === targetId)?.winRate ?? 0,
  ));
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
  const winRateReady = currentWinRate >= targetWinRate;
  return {
    decision: winRateReady && resourceReady ? "ready_to_attempt" : "farm_more",
    winRate: {
      current: currentWinRate,
      target: targetWinRate,
      missing: roundNumber(Math.max(0, targetWinRate - currentWinRate)),
      trials: targetSimulation?.trials ?? null,
      ci95HalfWidth: targetSimulation?.winRateCi95?.halfWidth ?? null,
    },
    resources,
    ready: winRateReady && resourceReady,
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

function estimateRunEV({ sketches, state, currentRows, targetStatWeights, farmSeconds }) {
  const currencies = {};
  const sketchesEV = [];
  const windowSeconds = Math.max(1, toNumber(farmSeconds, DEFAULT_FARM_SECONDS));
  let statValue = 0;

  for (const row of currentRows) {
    const sketch = sketches[row.id];
    if (!sketch || row.hidden) continue;
    const winRate = clamp01(toNumber(row.winRate));
    const seconds = Math.max(1, toNumber(row.p90Seconds, row.medianSeconds ?? 60));
    const multiplier = rewardMultiplier({ state, id: row.id });
    const expectedCurrencies = {};
    for (const reward of sketch.currencyRewards ?? []) {
      const rewardAmount = currencyRewardAmount({
        name: reward.name,
        amount: toNumber(reward.amount) * multiplier,
        fundamentals: state.fundamentals ?? {},
      });
      const expected = rewardAmount * winRate;
      expectedCurrencies[reward.name] = roundNumber(expected);
      addCurrencyEV(currencies, reward.name, expected, seconds);
    }
    const expectedStatScore = estimateStatRewardValue({ rewards: sketch.rewards, targetStatWeights }) * winRate;
    statValue += expectedStatScore;
    sketchesEV.push({
      id: row.id,
      name: row.name ?? sketch.name ?? row.id,
      rarity: row.rarity ?? sketch.rarity ?? "unknown",
      winRate: roundNumber(winRate),
      seconds,
      expectedCurrencies,
      expectedStatScore: roundNumber(expectedStatScore),
    });
  }

  for (const [currency, rate] of Object.entries(generatorRates(state))) {
    addCurrencyEV(currencies, currency, toNumber(rate) * windowSeconds, windowSeconds, true);
  }

  const quintessenceRate = quintessencePerSecond(state);
  const quintessence = {
    expected: roundNumber(quintessenceRate * windowSeconds),
    perSecond: roundNumber(quintessenceRate),
  };

  return {
    windowSeconds,
    quintessence,
    currencies: roundCurrencyEV(currencies),
    statValue: roundNumber(statValue),
    totalValue: roundNumber(totalEVValue({ currencies, quintessence, statValue })),
    sketches: sketchesEV.sort((a, b) => b.expectedStatScore - a.expectedStatScore),
  };
}

function decideSoftcapOrRedraw({ state, softcapSeconds, maxSoftcapWaitSeconds, currentRows, runEV }) {
  const seconds = softcapSeconds == null ? detectSoftcapSeconds(state) : toNumber(softcapSeconds);
  if (seconds == null || !Number.isFinite(seconds)) {
    return {
      decision: "unknown",
      reason: "softcap_time_missing",
      secondsToSoftcap: null,
      waitValue: null,
      runValue: runEV.totalValue,
    };
  }

  const waitValue = estimatePassiveWaitValue({ state, seconds });
  const bestWinRate = Math.max(0, ...currentRows.map((row) => toNumber(row.winRate)));
  if (seconds <= maxSoftcapWaitSeconds) {
    return {
      decision: "wait_softcap",
      reason: "softcap_is_close",
      secondsToSoftcap: roundNumber(seconds),
      waitValue: roundNumber(waitValue),
      runValue: runEV.totalValue,
    };
  }
  if (bestWinRate >= 0.5 && runEV.totalValue > waitValue) {
    return {
      decision: "finish_current_run",
      reason: "current_run_ev_beats_waiting",
      secondsToSoftcap: roundNumber(seconds),
      waitValue: roundNumber(waitValue),
      runValue: runEV.totalValue,
    };
  }
  return {
    decision: "redraw",
    reason: "softcap_is_far_and_current_run_ev_is_low",
    secondsToSoftcap: roundNumber(seconds),
    waitValue: roundNumber(waitValue),
    runValue: runEV.totalValue,
  };
}

function createFarmPlan({ approach, runEV, opusValues, state, farmSeconds }) {
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
    decision: goal.missing <= 0 ? "goal_reached" : goal.estimatedSeconds == null ? "farm_best_active_rewards" : "farm_until_goal",
    goal,
    windowSeconds: farmSeconds,
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
  baseStats,
  targetId,
  candidates,
  targetStatWeights,
  trials,
  maxSeconds,
  seed,
}) {
  const choices = normalizeCandidates(candidates).map((candidate) => {
    const route = simulateRoute({
      sketches,
      state,
      baseStats,
      targetId,
      routeIds: candidate.ids,
      boostedIds: candidate.ids,
      trials,
      maxSeconds,
      seed: `${seed}:booster:${candidate.name}`,
    });
    const simulation = route.target?.simulation ?? {};
    const statValue = estimateStatsObjectValue({ stats: route.finalStats, baseStats, targetStatWeights });
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

function decideMasterpieceRoll({ currentRows, targetId, target, masterpieceTargetIds, opusValues, targetWinRate }) {
  const wanted = new Set([targetId, ...normalizeList(masterpieceTargetIds)].filter(Boolean));
  const visibleMasterpieces = currentRows.filter((row) => row.rarity === "masterpiece");
  const wantedVisible = visibleMasterpieces.find((row) => wanted.has(row.id));
  const bestVisible = visibleMasterpieces.sort((a, b) => toNumber(b.winRate) - toNumber(a.winRate))[0] ?? null;
  const bestOpus = opusValues[0] ?? null;

  if (wantedVisible && toNumber(wantedVisible.winRate) >= targetWinRate) {
    return {
      decision: "keep_target",
      reason: "wanted_masterpiece_visible_and_favorable",
      targetId: wantedVisible.id,
      winRate: roundNumber(toNumber(wantedVisible.winRate)),
      visibleMasterpieces,
    };
  }
  if (wantedVisible) {
    return {
      decision: "keep_scout",
      reason: "wanted_masterpiece_visible_but_low_odds",
      targetId: wantedVisible.id,
      winRate: roundNumber(toNumber(wantedVisible.winRate)),
      visibleMasterpieces,
    };
  }
  if (bestOpus && bestOpus.score >= 10) {
    return {
      decision: "keep_farm",
      reason: "strong_opus_farm_value",
      targetId: bestVisible?.id ?? target.id,
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

function decideRunCompletion({ currentRows, opusValues, targetId }) {
  const visibleRows = [...currentRows].filter((row) => !row.hidden);
  const targetRow = visibleRows.find((row) => row.id === targetId);
  if (targetRow && toNumber(targetRow.winRate) >= 0.5) {
    return {
      decision: "fight_target",
      reason: "target_is_visible_and_favorable",
      targetId,
      winRate: roundNumber(toNumber(targetRow.winRate)),
    };
  }
  const best = visibleRows.sort((a, b) => toNumber(b.winRate) - toNumber(a.winRate))[0] ?? null;
  if (best && toNumber(best.winRate) >= 0.5) {
    return {
      decision: "finish_best",
      reason: "best_visible_sketch_has_good_odds",
      targetId: best.id,
      winRate: roundNumber(toNumber(best.winRate)),
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

function countDefeatedMasterpieces({ state, sketches = {} }) {
  const victories = numericObject(state.sketchVictories ?? {});
  const explicit = toNumber(state.defeatedMasterpieceCount ?? state.masterpieceDefeats);
  if (explicit > 0) return explicit;
  return Object.entries(victories)
    .filter(([id, count]) => count > 0 && sketches[id]?.rarity === "masterpiece")
    .length;
}

function estimateMasterpieceKillsPerRun({ currentRows, sketches, state }) {
  const maxVictories = Math.max(1, toNumber(state.fundamentals?.maxVictories, 1));
  const expected = currentRows
    .filter((row) => row.rarity === "masterpiece" || sketches[row.id]?.rarity === "masterpiece")
    .reduce((sum, row) => {
      const remaining = Math.max(0, toNumber(row.remainingToMax, maxVictories));
      return sum + clamp01(toNumber(row.winRate)) * Math.min(1, remaining);
    }, 0);
  return roundNumber(expected);
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

function createWinRateCurve({ current, runEV, currentRows, targetWinRate }) {
  const rowById = new Map(currentRows.map((row) => [row.id, row]));
  let projected = clamp01(toNumber(current));
  return [...runEV.sketches ?? []]
    .sort((a, b) => toNumber(b.expectedStatScore) - toNumber(a.expectedStatScore))
    .slice(0, 8)
    .map((item, index) => {
      const row = rowById.get(item.id);
      const gain = Math.min(0.15, Math.max(0.003, toNumber(item.expectedStatScore) * 0.02))
        * Math.max(0.25, clamp01(toNumber(row?.winRate, item.winRate)));
      projected = clamp01(projected + gain);
      return {
        step: index + 1,
        id: item.id,
        name: item.name,
        projectedWinRate: roundNumber(projected),
        gain: roundNumber(gain),
        reachesTarget: projected >= targetWinRate,
      };
    });
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

function estimateStatRewardValue({ rewards = [], targetStatWeights = {} }) {
  let score = 0;
  for (const reward of rewards ?? []) {
    const weight = toNumber(targetStatWeights[reward.statName], 1);
    const amount = toNumber(reward.amount);
    score += signedLogAmount(amount) * weight;
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
  const rows = currentRun?.targets ?? [];
  if (rows.length > 0) return rows.map(normalizeCurrentRow);
  const hidden = new Set(normalizeList(state.hiddenSketches));
  const ids = normalizeList(state.availableSketches);
  return ids
    .map((id) => sketches[id])
    .filter(Boolean)
    .map((sketch) => ({
      id: sketch.id,
      name: sketch.name ?? sketch.id,
      rarity: sketch.rarity ?? "unknown",
      hidden: hidden.has(sketch.id),
      winRate: 0,
      p90Seconds: 60,
      remainingToMax: 1,
    }));
}

function normalizeCurrentRow(row) {
  return {
    id: row.id,
    name: row.name ?? row.id,
    rarity: row.rarity ?? "unknown",
    hidden: Boolean(row.hidden),
    winRate: toNumber(row.winRate),
    p90Seconds: toNumber(row.p90Seconds, row.medianSeconds ?? 60),
    medianSeconds: toNumber(row.medianSeconds),
    remainingToMax: toNumber(row.remainingToMax, 1),
  };
}

function rewardMultiplier({ state, id }) {
  const totalVictories = toNumber(state.sketchVictories?.[id]);
  const decay = toNumber(state.fundamentals?.rewardDecay, 1);
  const boosted = normalizeList(state.boostedSketchIds).includes(id);
  const booster = boosted ? 1 + toNumber(state.fundamentals?.rewardBoosterEffect, 50) / 100 : 1;
  return 1 / (1 + totalVictories * decay) * booster;
}

function addCurrencyEV(currencies, name, expected, seconds, passive = false) {
  const item = currencies[name] ?? {
    expected: 0,
    perSecond: 0,
    passiveExpected: 0,
  };
  item.expected += expected;
  item.perSecond += expected / Math.max(1, seconds);
  if (passive) item.passiveExpected += expected;
  currencies[name] = item;
}

function roundCurrencyEV(currencies) {
  return Object.fromEntries(Object.entries(currencies).map(([name, item]) => [name, {
    expected: roundNumber(item.expected),
    perSecond: roundNumber(item.perSecond),
    passiveExpected: roundNumber(item.passiveExpected),
  }]));
}

function totalEVValue({ currencies, quintessence, statValue }) {
  const currencyValue = Object.values(currencies)
    .reduce((sum, item) => sum + Math.log10(1 + Math.max(0, item.expected)), 0);
  const quintessenceValue = Math.log10(1 + Math.max(0, quintessence.expected));
  return currencyValue + quintessenceValue + statValue;
}

function generatorRates(state) {
  const raw = state.currencyGeneratorRates ?? state.generatorRates ?? state.generatorsPerSecond ?? {};
  const rates = {};
  const fundamentals = state.fundamentals ?? {};
  for (const [currency, rate] of Object.entries(raw)) {
    const key = currencyFundamentalKey(currency);
    rates[currency] = toNumber(rate)
      * toNumber(fundamentals.generatorMultiplier, 1)
      * toNumber(fundamentals[`${key}GeneratorMultiplier`], 1);
  }
  return rates;
}

function quintessencePerSecond(state) {
  return toNumber(
    state.quintessencePerSecond
    ?? state.quintessenceGeneratorRate
    ?? state.pendingQuintessencePerSecond
    ?? state.conceptualSynthesis?.quintessencePerSecond,
  );
}

function detectSoftcapSeconds(state) {
  const direct = state.secondsToSoftcap ?? state.softcapSeconds ?? state.nextSoftcapSeconds;
  if (direct != null) return toNumber(direct);
  const timestamp = state.nextSoftcapAt ?? state.softcapAt;
  const parsed = timestamp == null ? NaN : Number(timestamp);
  if (!Number.isFinite(parsed)) return null;
  const now = Date.now();
  return parsed > now ? (parsed - now) / 1000 : parsed;
}

function estimatePassiveWaitValue({ state, seconds }) {
  const q = quintessencePerSecond(state) * seconds;
  const currency = Object.values(generatorRates(state))
    .reduce((sum, rate) => sum + Math.log10(1 + Math.max(0, rate * seconds)), 0);
  return Math.log10(1 + Math.max(0, q)) + currency;
}

function estimateStatsObjectValue({ stats, baseStats, targetStatWeights }) {
  let score = 0;
  for (const [stat, weight] of Object.entries(targetStatWeights)) {
    const delta = toNumber(stats[stat]) - toNumber(baseStats?.[stat]);
    if (delta === 0) continue;
    score += signedLogAmount(delta) * weight;
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

function currencyFundamentalKey(name) {
  const parts = String(name)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return parts
    .map((part, index) => {
      const lower = part.charAt(0).toLowerCase() + part.slice(1);
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
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
