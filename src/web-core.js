import { createRunRecommendation, parseTrialsSetting, resolveTargetId, runCombatSimulation } from "./cli-convenience.js";
import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { createDiagnosticReport, createModelAssumptionComparisons } from "./diagnostics.js";
import { createFightTrace } from "./fight-trace.js";
import { createCombatReport } from "./report.js";
import { applySketchRewards } from "./rewards.js";
import { simulateRoute } from "./route.js";
import { parseRouteSpecs } from "./route-options.js";
import { analyzeSave } from "./save-analysis.js";
import { decodeSaveText, toNumber } from "./save.js";
import { enemyFromSketch, sketchForEncounter } from "./combat/steam-encounter.js";
import { createStrategyPlan, parseStrategyCurrencyGoals } from "./strategy-planner.js";
import { remainingSketchVictories } from "./victory-limit.js";

const IMPORTANT_TARGET_IDS = [
  "duct_taped_banana",
  "rose_window",
  "mobius_strip",
  "transcendent_paragon",
];
const WEB_AUXILIARY_TRIAL_CAP = 100;
const WEB_LONG_FIGHT_MAX_SECONDS = 1800;
const WEB_LONG_FIGHT_MIN_CONFIGURED_SECONDS = 60;
const WEB_LONG_FIGHT_MIN_SECONDS = 600;
const WEB_LONG_FIGHT_WIN_DELTA = 0.05;
const WEB_LONG_FIGHT_TIMEOUT_DELTA = 0.25;
const ROLL_WISHLIST_SCAN_LIMIT = 60;
const ROLL_WISHLIST_RESULT_LIMIT = 12;
const ROLL_WISHLIST_RARITIES = new Set(["rough", "framed", "opus", "masterpiece"]);

export function createWebAnalysis({
  saveText,
  save = decodeSaveText(saveText),
  sketches = {},
  dataMetadata = null,
  targetId = "duct_taped_banana",
  assumedVictoryIds = [],
  assumedVictories = null,
  trials = "auto",
  maxSeconds = 300,
  seed = "web-ui",
  strategyOptions = {},
  routeIds = [],
  hiddenSketchIds = [],
  observedOutcome = null,
  traceSeconds = 60,
} = {}) {
  const resolvedTargetId = resolveTargetId(targetId) ?? "duct_taped_banana";
  const combatAssumptions = combatAssumptionsFromSave(save);
  const target = sketchForEncounter(sketches[resolvedTargetId], combatAssumptions);
  if (!target) throw new Error(`Unknown target sketch: ${resolvedTargetId}`);

  const analysis = analyzeSave({ save, sketches, targetId: resolvedTargetId, dataMetadata });
  const statSource = analysis.stats.recommendedSource;
  const baseStats = analysis.stats.sources[statSource] ?? {};
  const assumedVictoryPlan = normalizeAssumedVictories({
    assumedVictories,
    assumedVictoryIds,
    sketches,
    state: save.state,
  });
  const assumedRouteIds = expandAssumedVictories(assumedVictoryPlan);
  const finalStats = applyAssumedVictories({
    baseStats,
    sketches,
    state: save.state,
    assumedVictoryIds: assumedRouteIds,
  });
  const trialsSetting = parseTrialsSetting(trials, {
    defaultTrials: 200,
    initialTrials: 200,
    maxTrials: 4000,
    targetHalfWidth: 0.025,
  });
  const auxiliaryTrials = fixedStrategyTrials(trialsSetting);
  const auxiliaryTrialsSetting = parseTrialsSetting(auxiliaryTrials);
  const targetSimulation = simulateTargetWithAdaptiveLimit({
    target,
    player: finalStats,
    trialsSetting,
    maxSeconds,
    seed: `${seed}:${resolvedTargetId}`,
    assumptions: combatAssumptions,
  });
  const result = targetSimulation.result;
  const targetMaxSeconds = targetSimulation.effectiveMaxSeconds;
  const report = createCombatReport({ target, player: finalStats, simulation: result });
  const assumptionComparisons = createModelAssumptionComparisons({
    target,
    player: finalStats,
    baseline: result,
    trials: auxiliaryTrials,
    maxSeconds: targetMaxSeconds,
    seed: `${seed}:assumptions`,
    assumptions: combatAssumptions,
  });
  const diagnostics = createDiagnosticReport({
    assumptions: combatAssumptions,
    target,
    player: finalStats,
    simulation: result,
    report,
    dataMetadata,
    observedOutcome,
    assumptionComparisons,
  });
  appendTimeLimitDiagnostics(diagnostics, result);
  const fightTrace = createFightTrace({
    player: finalStats,
    enemy: enemyFromSketch(target),
    maxSeconds: targetMaxSeconds,
    traceSeconds: Math.min(Math.max(5, toNumber(traceSeconds, 60)), Math.max(5, targetMaxSeconds)),
    seed: `${seed}:${resolvedTargetId}:trace`,
    assumptions: combatAssumptions,
  });
  const activeSketches = createActiveSketchRows({ analysis, sketches, baseStats, trialsSetting: auxiliaryTrialsSetting, maxSeconds, seed, assumptions: combatAssumptions });
  const recommendation = createRunRecommendation({
    targetId: resolvedTargetId,
    currentRun: { targets: activeSketches.filter((row) => !hiddenSketchIds.includes(row.id)) },
  });
  const targetComparisons = createTargetComparisons({
    sketches,
    activeSketches,
    finalStats,
    trialsSetting: auxiliaryTrialsSetting,
    maxSeconds: targetMaxSeconds,
    seed,
    assumptions: combatAssumptions,
  });
  const rewardState = stateAfterVictories(save.state, assumedRouteIds, sketches);
  const pairedOptions = {
    target, trialsSetting: auxiliaryTrialsSetting, maxSeconds: targetMaxSeconds,
    seed: `${seed}:reward-impact`, assumptions: combatAssumptions,
  };
  const rewardComparison = compareSketchRewards({ state: rewardState, stats: finalStats, sketches, pairedOptions });
  const route = normalizeIds(routeIds);
  const routeState = route.length ? stateAfterVictories(rewardState, route, sketches) : rewardState;
  const routeComparison = route.length ? compareSketchRewards({
    state: routeState, sketches, pairedOptions,
    stats: applyAssumedVictories({ baseStats: finalStats, sketches, state: rewardState, assumedVictoryIds: route }),
  }) : rewardComparison;
  const activeDeltas = createActiveDeltas({ sketches, activeSketches, state: routeState, ...routeComparison });
  const routePreview = createRoutePreview({
    sketches,
    state: save.state,
    baseStats,
    routeIds,
    targetId: resolvedTargetId,
    trialsSetting: auxiliaryTrialsSetting,
    maxSeconds: targetMaxSeconds,
    seed,
    assumptions: combatAssumptions,
  });
  const rollWishlist = createRollWishlist({
    sketches,
    state: rewardState,
    target,
    currentResult: rewardComparison.rewardBaseline,
    simulateAfterReward: rewardComparison.simulateAfterReward,
    finalStats,
    trialsSetting: auxiliaryTrialsSetting,
    maxSeconds: targetMaxSeconds,
    seed,
    assumptions: combatAssumptions,
  });
  const strategicPlan = createStrategyPlan({
    sketches,
    state: save.state,
    targetId: resolvedTargetId,
    baseStats: finalStats,
    targetSimulation: result,
    currentRun: { targets: activeSketches },
    ...normalizeStrategyOptions(strategyOptions),
    trials: auxiliaryTrials,
    maxSeconds: targetMaxSeconds,
    seed,
  });

  return {
    saveVersion: save.version ?? null,
    target: targetSummary(target),
    statSource,
    statsReason: analysis.stats.reason,
    warnings: analysis.warnings,
    assumedVictories: assumedVictoryPlan,
    assumedVictoryIds: assumedRouteIds,
    finalStats,
    result,
    report,
    diagnostics,
    assumptionComparisons,
    fightTrace,
    activeSketches,
    recommendation,
    nextAction: describeNextAction(recommendation, activeSketches, strategicPlan.softcap),
    strategicPlan,
    targetComparisons,
    activeDeltas,
    routePreview,
    rollWishlist,
    buildComparison: createBuildComparison({
      sketches,
      finalStats,
      activeSketches,
      trialsSetting: auxiliaryTrialsSetting,
      maxSeconds,
      seed,
      assumptions: combatAssumptions,
    }),
    bundle: summarizeGameBundle({ sketches, dataMetadata }),
    performance: {
      primaryTrials: result.trials,
      auxiliaryTrials,
      auxiliaryTrialCap: WEB_AUXILIARY_TRIAL_CAP,
    },
  };
}

export function createCompanionAnalysis({
  saveText,
  sketches = {},
  dataMetadata = null,
  targetId = null,
  trials = 100,
  maxSeconds = 120,
  seed = "game-companion",
} = {}) {
  const save = decodeSaveText(saveText);
  const resolvedTargetId = inferCompanionTargetId({ save, sketches, targetId });
  const analysis = createWebAnalysis({
    save,
    sketches,
    dataMetadata,
    targetId: resolvedTargetId,
    trials,
    maxSeconds,
    seed,
    traceSeconds: 30,
    strategyOptions: {
      strategyProfile: "farm-q",
      strategyMode: "safe-farm",
    },
  });

  return {
    saveVersion: analysis.saveVersion,
    bundle: analysis.bundle,
    summary: {
      targetId: analysis.target.id,
      targetName: analysis.target.name,
      winRate: analysis.result.winRate,
      timeoutRate: analysis.result.timeoutRate ?? 0,
      p90Seconds: analysis.result.p90Seconds ?? 0,
      trials: analysis.result.trials,
      decision: analysis.recommendation?.action ?? "unknown",
      nextAction: analysis.nextAction,
      statSource: analysis.statSource,
    },
    activeSketches: (analysis.activeSketches ?? []).slice(0, 5).map((item) => ({
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      winRate: item.winRate,
      timeoutRate: item.timeoutRate,
      p90Seconds: item.p90Seconds,
      problem: item.topFailure ?? item.topVictory ?? "none",
    })),
    warnings: [
      ...(analysis.warnings ?? []).map((item) => ({
        title: item.code ?? "save warning",
        detail: item.message ?? item.detail ?? String(item),
      })),
      ...(analysis.diagnostics?.warnings ?? []).map((item) => ({
        title: item.title ?? item.code ?? "model warning",
        detail: item.detail ?? item.severity ?? "Check model confidence.",
      })),
    ].slice(0, 5),
  };
}

export function summarizeGameBundle({ sketches = {}, dataMetadata = null } = {}) {
  const countsByRarity = {};
  for (const sketch of Object.values(sketches)) {
    countsByRarity[sketch.rarity ?? "unknown"] = (countsByRarity[sketch.rarity ?? "unknown"] ?? 0) + 1;
  }

  return {
    gameVersion: dataMetadata?.gameVersion ?? null,
    platform: dataMetadata?.platform ?? null,
    buildId: dataMetadata?.buildId ?? null,
    saveVersion: dataMetadata?.saveVersion ?? null,
    asset: dataMetadata?.asset ?? null,
    capturedAt: dataMetadata?.capturedAt ?? null,
    totalSketches: Object.keys(sketches).length,
    countsByRarity,
    importantTargets: IMPORTANT_TARGET_IDS
      .filter((id) => sketches[id])
      .map((id) => targetSummary(sketches[id])),
  };
}

export function createTargetOptions({ sketches = {} } = {}) {
  const important = IMPORTANT_TARGET_IDS
    .filter((id) => sketches[id])
    .map((id) => ({ ...targetSummary(sketches[id]), ...targetRewardsSummary(sketches[id]), group: "key" }));
  const rest = Object.values(sketches)
    .filter((sketch) => !IMPORTANT_TARGET_IDS.includes(sketch.id))
    .map((sketch) => ({ ...targetSummary(sketch), ...targetRewardsSummary(sketch), group: sketch.rarity }))
    .sort((a, b) => a.rarity.localeCompare(b.rarity) || a.name.localeCompare(b.name));
  return [...important, ...rest];
}

function createActiveSketchRows({ analysis, sketches, baseStats, trialsSetting, maxSeconds, seed, assumptions = {} }) {
  const remaining = [
    ...analysis.run.active.remaining,
    analysis.run.active.target,
  ].filter(Boolean);
  const seen = new Set();
  const rows = [];

  for (const item of remaining) {
    if (seen.has(item.id) || item.hidden || item.defeatedThisRun) continue;
    seen.add(item.id);
    const sketch = sketches[item.id];
    if (!sketch?.stats) continue;
    const result = simulateTarget({
      target: sketch,
      player: baseStats,
      trialsSetting,
      maxSeconds,
      seed: `${seed}:active:${item.id}`,
      assumptions,
    });
    rows.push({
      id: item.id,
      name: sketch.name ?? item.name ?? item.id,
      rarity: sketch.rarity ?? item.rarity ?? "unknown",
      hidden: item.hidden,
      remainingToMax: item.rewardProgress?.remainingToMax ?? 0,
      runVictories: item.rewardProgress?.runVictories ?? 0,
      totalVictories: item.rewardProgress?.totalVictories ?? 0,
      maxVictories: item.rewardProgress?.maxVictories ?? 0,
      winRate: round(result.winRate),
      winRateCi95: result.winRateCi95,
      ci95HalfWidth: round(result.winRateCi95?.halfWidth ?? 0),
      trials: result.trials,
      timeoutRate: round(result.timeoutRate ?? 0),
      medianSeconds: round(result.medianSeconds ?? 0),
      p90Seconds: round(result.p90Seconds ?? 0),
      topFailure: topKey(result.defeatCauses) ?? topKey(result.timeoutDiagnoses),
      topVictory: topKey(result.victoryCauses),
    });
  }

  return rows.sort((a, b) => b.winRate - a.winRate || rarityRank(b.rarity) - rarityRank(a.rarity) || a.id.localeCompare(b.id));
}

function createBuildComparison({ sketches, finalStats, activeSketches, trialsSetting, maxSeconds, seed, assumptions = {} }) {
  const farmTarget = activeSketches[0] ?? null;
  const rows = [];
  rows.push({
    label: "Farm",
    targetId: farmTarget?.id ?? null,
    targetName: farmTarget?.name ?? "No active farm target",
    winRate: farmTarget?.winRate ?? null,
    winRateCi95: farmTarget?.winRateCi95 ?? null,
    ci95HalfWidth: farmTarget?.ci95HalfWidth ?? null,
    trials: farmTarget?.trials ?? null,
    p90Seconds: farmTarget?.p90Seconds ?? null,
    problem: farmTarget?.topFailure ?? farmTarget?.topVictory ?? "none",
  });

  for (const [label, id] of [["Duct", "duct_taped_banana"], ["Rose", "rose_window"]]) {
    const target = sketches[id];
    if (!target) continue;
    const result = simulateTarget({
      target,
      player: finalStats,
      trialsSetting,
      maxSeconds,
      seed: `${seed}:compare:${id}`,
      assumptions,
    });
    rows.push({
      label,
      targetId: id,
      targetName: target.name ?? id,
      winRate: round(result.winRate),
      winRateCi95: result.winRateCi95,
      ci95HalfWidth: round(result.winRateCi95?.halfWidth ?? 0),
      trials: result.trials,
      p90Seconds: round(result.p90Seconds ?? 0),
      problem: topKey(result.defeatCauses) ?? topKey(result.timeoutDiagnoses) ?? topKey(result.victoryCauses) ?? "none",
    });
  }

  return rows;
}

function createTargetComparisons({ sketches, activeSketches, finalStats, trialsSetting, maxSeconds, seed, assumptions = {} }) {
  const rows = [];
  const seen = new Set();
  const addTarget = ({ id, source }) => {
    if (seen.has(id)) return;
    const target = sketches[id];
    if (!target?.stats) return;
    seen.add(id);
    const result = simulateTarget({
      target,
      player: finalStats,
      trialsSetting,
      maxSeconds,
      seed: `${seed}:target-compare:${id}`,
      assumptions,
    });
    rows.push(comparisonRow({ target, result, source }));
  };

  for (const id of IMPORTANT_TARGET_IDS) addTarget({ id, source: "key_target" });

  for (const item of activeSketches) {
    if (item.rarity !== "opus") continue;
    if (seen.has(item.id)) continue;
    rows.push({
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      source: "active_run",
      winRate: item.winRate,
      winRateCi95: item.winRateCi95,
      ci95HalfWidth: item.ci95HalfWidth,
      trials: item.trials,
      p90Seconds: item.p90Seconds,
      problem: item.topFailure ?? item.topVictory ?? "none",
    });
    seen.add(item.id);
  }

  return rows.sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || b.winRate - a.winRate || a.name.localeCompare(b.name));
}

function comparisonRow({ target, result, source }) {
  return {
    id: target.id,
    name: target.name ?? target.id,
    rarity: target.rarity ?? "unknown",
    source,
    winRate: round(result.winRate),
    winRateCi95: result.winRateCi95,
    ci95HalfWidth: round(result.winRateCi95?.halfWidth ?? 0),
    trials: result.trials,
    p90Seconds: round(result.p90Seconds ?? 0),
    problem: topKey(result.defeatCauses) ?? topKey(result.timeoutDiagnoses) ?? topKey(result.victoryCauses) ?? "none",
  };
}

function sourceRank(source) {
  return source === "key_target" ? 0 : 1;
}

function stateAfterVictories(state, ids, sketches) {
  if (!ids.length) return state;
  const sketchVictories = { ...state.sketchVictories };
  for (const id of ids) {
    const previous = toNumber(sketchVictories[id]);
    if (sketches[id] && remainingSketchVictories(state, id, previous) > 0) sketchVictories[id] = previous + 1;
  }
  return { ...state, sketchVictories };
}

function compareSketchRewards({ state, stats, sketches, pairedOptions }) {
  const rewardBaseline = simulateTarget({ ...pairedOptions, player: stats });
  const results = new Map();
  function simulateAfterReward(id) {
    if (!results.has(id)) {
      const next = applyAssumedVictories({ baseStats: stats, sketches, state, assumedVictoryIds: [id] });
      const changed = sketches[id].rewards?.some(({ statName }) => next[statName] !== stats[statName]);
      results.set(id, changed ? simulateTarget({ ...pairedOptions, player: next }) : rewardBaseline);
    }
    return results.get(id);
  }
  return { rewardBaseline, simulateAfterReward };
}

function createActiveDeltas({ sketches, activeSketches, state, rewardBaseline, simulateAfterReward }) {
  const result = {};
  for (const item of activeSketches) {
    if (remainingSketchVictories(state, item.id) <= 0) continue;
    const nextResult = simulateAfterReward(item.id);
    result[item.id] = {
      id: item.id,
      name: item.name,
      winRate: round(nextResult.winRate),
      winRateDelta: round(nextResult.winRate - rewardBaseline.winRate),
      trials: nextResult.trials,
      p90Seconds: round(nextResult.p90Seconds ?? 0),
      p90Delta: round(nextResult.p90Seconds - rewardBaseline.p90Seconds),
      statRewards: sketches[item.id].rewards ?? [],
      currencyRewards: sketches[item.id].currencyRewards ?? [],
    };
  }
  return result;
}

function createRollWishlist({
  sketches,
  state,
  target,
  currentResult,
  simulateAfterReward,
  finalStats,
  trialsSetting,
  maxSeconds,
  seed,
  assumptions = {},
}) {
  const guaranteed = new Set(guaranteedIdsFromState(state));
  const hidden = new Set(normalizeIds(state.hiddenSketches));
  const available = new Set(normalizeIds(state.availableSketches));
  const excluded = {
    guaranteed: [],
    hidden: [],
    target: [],
    maxed: [],
    invalid: [],
  };

  const candidates = [];
  for (const sketch of Object.values(sketches)) {
    const id = sketch?.id;
    if (!id || id === target.id) {
      if (id === target.id) excluded.target.push(id);
      continue;
    }
    if (!sketch?.stats || !ROLL_WISHLIST_RARITIES.has(sketch.rarity)) {
      if (id) excluded.invalid.push(id);
      continue;
    }
    if (guaranteed.has(id)) {
      excluded.guaranteed.push(id);
      continue;
    }
    if (hidden.has(id)) {
      excluded.hidden.push(id);
      continue;
    }
    if (remainingSketchVictories(state, id) <= 0) {
      excluded.maxed.push(id);
      continue;
    }
    const rewardScore = estimateRewardHint(sketch);
    if (rewardScore <= 0 && !available.has(id)) continue;
    candidates.push({
      sketch,
      rewardScore,
      source: available.has(id) ? "active_run" : "roll_pool",
    });
  }

  const baselineWinRate = round(currentResult.winRate ?? 0);
  const preselected = candidates
    .sort((a, b) => b.rewardScore - a.rewardScore || rarityRank(b.sketch.rarity) - rarityRank(a.sketch.rarity) || a.sketch.id.localeCompare(b.sketch.id))
    .slice(0, ROLL_WISHLIST_SCAN_LIMIT);
  const rarityPoolSizes = countCandidateRarityPool(candidates);
  const rows = [];

  for (const candidate of preselected) {
    const sketch = candidate.sketch;
    const targetResult = simulateAfterReward(sketch.id);
    const targetDelta = round((targetResult.winRate ?? 0) - (currentResult.winRate ?? 0));
    if (targetDelta <= 0 && candidate.source !== "active_run") continue;

    const candidateResult = simulateTarget({
      target: sketch,
      player: finalStats,
      trialsSetting,
      maxSeconds,
      seed: `${seed}:wishlist:candidate:${sketch.id}`,
      assumptions,
    });
    const candidateWinRate = round(candidateResult.winRate ?? 0);
    const feasibility = candidateWinRate >= 0.75 ? "safe" : candidateWinRate >= 0.35 ? "uncertain" : "risky";
    const rarityPoolSize = rarityPoolSizes[sketch.rarity] ?? 0;
    const rollShare = rarityPoolSize > 0 ? round(1 / rarityPoolSize) : 0;
    const priorityScore = round(Math.max(0, targetDelta) * (0.15 + candidateWinRate * 0.85) * (1 + Math.min(1, candidate.rewardScore / 100)));

    rows.push({
      id: sketch.id,
      name: sketch.name ?? sketch.id,
      rarity: sketch.rarity,
      source: candidate.source,
      feasibility,
      priorityScore,
      targetWinRate: round(targetResult.winRate ?? 0),
      targetWinRateDelta: targetDelta,
      candidateWinRate,
      candidateP90Seconds: round(candidateResult.p90Seconds ?? 0),
      p90Seconds: round(targetResult.p90Seconds ?? 0),
      p90Delta: round((targetResult.p90Seconds ?? 0) - (currentResult.p90Seconds ?? 0)),
      rollShare,
      rarityPoolSize,
      statRewards: summarizeRewardList(sketch.rewards, "statName"),
      currencyRewards: summarizeRewardList(sketch.currencyRewards, "name"),
    });
  }

  rows.sort((a, b) => b.priorityScore - a.priorityScore
    || b.targetWinRateDelta - a.targetWinRateDelta
    || b.candidateWinRate - a.candidateWinRate
    || a.name.localeCompare(b.name));

  return {
    baselineWinRate,
    scanned: preselected.length,
    candidateCount: candidates.length,
    resultLimit: ROLL_WISHLIST_RESULT_LIMIT,
    items: rows.slice(0, ROLL_WISHLIST_RESULT_LIMIT),
    excluded,
  };
}

function createRoutePreview({ sketches, state, baseStats, routeIds, targetId, trialsSetting, maxSeconds, seed }) {
  const ids = normalizeIds(routeIds);
  if (ids.length === 0) {
    return { routeIds: [], steps: [], finalStats: null, currencies: null };
  }

  const trials = fixedStrategyTrials(trialsSetting);
  const steps = [];
  let latest = null;
  for (let index = 0; index < ids.length; index += 1) {
    latest = simulateRoute({
      sketches,
      state,
      baseStats,
      routeIds: ids.slice(0, index + 1),
      targetId,
      trials,
      maxSeconds,
      seed: `${seed}:route-preview:${index}`,
    });
    const step = latest.steps.at(-1) ?? { id: ids[index], status: "missing" };
    const simulation = latest.target?.simulation ?? {};
    steps.push({
      index: index + 1,
      id: step.id ?? ids[index],
      name: step.name ?? sketches[ids[index]]?.name ?? ids[index],
      status: step.status,
      targetWinRate: round(simulation.winRate ?? 0),
      p90Seconds: round(simulation.p90Seconds ?? 0),
      finalStats: summarizeStats(latest.finalStats),
      currencies: summarizeCurrencies(latest.currencies),
    });
  }

  return {
    routeIds: ids,
    steps,
    finalStats: summarizeStats(latest?.finalStats ?? {}),
    currencies: summarizeCurrencies(latest?.currencies ?? {}),
  };
}

function summarizeStats(stats = {}) {
  const keys = ["maxHp", "attack", "attackSpeed", "accuracy", "armor", "armorPen", "regen", "burnChance", "bleedChance", "freezeChance"];
  return Object.fromEntries(keys.filter((key) => stats[key] != null).map((key) => [key, round(toNumber(stats[key]))]));
}

function summarizeCurrencies(currencies = {}) {
  return Object.fromEntries(Object.entries(currencies)
    .filter(([, value]) => toNumber(value) > 0)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
    .slice(0, 6)
    .map(([key, value]) => [key, round(toNumber(value))]));
}

function inferCompanionTargetId({ save, sketches, targetId }) {
  const requested = resolveTargetId(targetId);
  if (requested && sketches[requested]) return requested;

  const state = save?.state ?? {};
  const hidden = new Set(state.hiddenSketches ?? []);
  const candidates = [
    state.lastEnemyId,
    ...(state.availableSketches ?? []),
    ...IMPORTANT_TARGET_IDS,
    ...Object.keys(sketches),
  ];

  for (const candidate of candidates) {
    const resolved = resolveTargetId(candidate) ?? candidate;
    if (!resolved || hidden.has(resolved)) continue;
    if (sketches[resolved]?.stats) return resolved;
  }

  throw new Error("No available sketch target found in save or bundle.");
}

function describeNextAction(recommendation, activeSketches, softcap) {
  const row = activeSketches.find((item) => item.id === recommendation.targetId);
  if (row) {
    const target = recommendation.action === "fight_target";
    return {
      type: target ? "target" : "farm",
      title: `${target ? "Fight" : "Farm"} ${row.name}`,
      detail: `Win chance ${percentLabel(row.winRate)} · p90 ${secondsLabel(row.p90Seconds)}.`,
    };
  }
  if (softcap?.decision === "wait_softcap") {
    return {
      type: "softcap", title: "Wait for softcap",
      detail: softcap.secondsToSoftcap == null ? softcap.reason : `${secondsLabel(softcap.secondsToSoftcap)} · ${softcap.reason}`,
    };
  }
  return { type: "redraw", title: "Consider redraw", detail: recommendation.reason };
}

function percentLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "--";
}

function secondsLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}s` : "--";
}

function applyAssumedVictories({ baseStats, sketches, state, assumedVictoryIds }) {
  if (assumedVictoryIds.length === 0) return baseStats;
  return applySketchRewards({
    state,
    baseStats,
    sketches,
    defeatedIds: assumedVictoryIds,
    boostedIds: new Set(),
    rewardDecay: toNumber(state?.fundamentals?.rewardDecay, 1),
    rewardBoosterEffect: toNumber(state?.fundamentals?.rewardBoosterEffect, 50),
    existingVictories: state?.sketchVictories ?? {},
  });
}

function normalizeAssumedVictories({ assumedVictories, assumedVictoryIds, sketches, state }) {
  const requested = new Map();
  const add = (id, count = 1) => {
    const normalizedId = String(id ?? "").trim();
    const normalizedCount = Math.floor(Number(count));
    if (!normalizedId || !Number.isFinite(normalizedCount) || normalizedCount <= 0) return;
    requested.set(normalizedId, (requested.get(normalizedId) ?? 0) + normalizedCount);
  };

  if (assumedVictories && typeof assumedVictories === "object") {
    if (Array.isArray(assumedVictories)) {
      for (const item of assumedVictories) {
        if (typeof item === "string") add(item, 1);
        else add(item?.id, item?.count ?? item?.victories ?? 1);
      }
    } else {
      for (const [id, count] of Object.entries(assumedVictories)) add(id, count);
    }
  } else {
    for (const id of normalizeIds(assumedVictoryIds)) add(id, 1);
  }

  const plan = {};
  for (const [id, requestedCount] of requested) {
    if (!sketches[id]) continue;
    const remaining = remainingSketchVictories(state, id);
    const count = Math.min(requestedCount, remaining);
    if (count > 0) plan[id] = count;
  }
  return plan;
}

function expandAssumedVictories(plan) {
  const ids = [];
  for (const [id, count] of Object.entries(plan)) {
    for (let index = 0; index < count; index += 1) ids.push(id);
  }
  return ids;
}

function simulateTargetWithAdaptiveLimit({ target, player, trialsSetting, maxSeconds, seed, assumptions = {} }) {
  const configuredMaxSeconds = normalizeMaxSeconds(maxSeconds);
  const baseline = simulateTarget({
    target,
    player,
    trialsSetting,
    maxSeconds: configuredMaxSeconds,
    seed,
    assumptions,
  });
  let probe = baseline;
  let checkedMaxSeconds = configuredMaxSeconds;
  while (shouldProbeLongFight(probe, checkedMaxSeconds, configuredMaxSeconds)) {
    checkedMaxSeconds = nextLongFightWindow(checkedMaxSeconds);
    probe = simulateTarget({
      target, player, trialsSetting, maxSeconds: checkedMaxSeconds, seed, assumptions,
    });
    if (isBetterLongFightResult({ baseline, probe })) {
      return {
        effectiveMaxSeconds: checkedMaxSeconds,
        result: { ...probe, timeLimit: {
          extended: true, configuredMaxSeconds, effectiveMaxSeconds: checkedMaxSeconds,
          baseline: summarizeTimeLimitResult(baseline),
        } },
      };
    }
  }
  return {
    effectiveMaxSeconds: configuredMaxSeconds,
    result: { ...baseline, timeLimit: {
      extended: false, configuredMaxSeconds, effectiveMaxSeconds: configuredMaxSeconds, checkedMaxSeconds,
      ...(checkedMaxSeconds > configuredMaxSeconds && { probe: summarizeTimeLimitResult(probe) }),
    } },
  };
}

function simulateTarget({ target, player, trialsSetting, maxSeconds, seed, assumptions = {} }) {
  return runCombatSimulation({
    player,
    enemy: enemyFromSketch(target),
    trialsSetting,
    maxSeconds,
    seed,
    assumptions,
  });
}

function normalizeMaxSeconds(value) {
  return Math.max(5, toNumber(value, 300));
}

function shouldProbeLongFight(result, effectiveMaxSeconds, configuredMaxSeconds) {
  if (effectiveMaxSeconds >= WEB_LONG_FIGHT_MAX_SECONDS) return false;
  if (configuredMaxSeconds >= WEB_LONG_FIGHT_MAX_SECONDS) return false;
  if (configuredMaxSeconds < WEB_LONG_FIGHT_MIN_CONFIGURED_SECONDS) return false;
  if (toNumber(result.losses) > 0) return false;
  if (toNumber(result.timeoutRate) < 0.7) return false;
  return toNumber(result.p90Seconds) >= effectiveMaxSeconds * 0.95;
}

function nextLongFightWindow(currentMaxSeconds) {
  return Math.min(
    WEB_LONG_FIGHT_MAX_SECONDS,
    Math.max(WEB_LONG_FIGHT_MIN_SECONDS, currentMaxSeconds * 2),
  );
}

function isBetterLongFightResult({ baseline, probe }) {
  const winDelta = toNumber(probe.winRate) - toNumber(baseline.winRate);
  const timeoutDelta = toNumber(baseline.timeoutRate) - toNumber(probe.timeoutRate);
  return winDelta >= WEB_LONG_FIGHT_WIN_DELTA || timeoutDelta >= WEB_LONG_FIGHT_TIMEOUT_DELTA && toNumber(probe.winRate) > 0;
}

function summarizeTimeLimitResult(result = {}) {
  return {
    trials: toNumber(result.trials),
    winRate: round(toNumber(result.winRate)),
    timeoutRate: round(toNumber(result.timeoutRate)),
    medianSeconds: round(toNumber(result.medianSeconds)),
    p90Seconds: round(toNumber(result.p90Seconds)),
  };
}

function appendTimeLimitDiagnostics(diagnostics, result) {
  if (!result?.timeLimit?.extended) return;
  const configured = result.timeLimit.configuredMaxSeconds;
  const effective = result.timeLimit.effectiveMaxSeconds;
  const baseline = result.timeLimit.baseline ?? {};
  const item = {
    code: "fight_window_extended",
    status: "info",
    title: "Fight window extended",
    detail: `The fight window was extended: the configured ${secondsLabel(configured)} window looked like ${percentLabel(baseline.winRate)} with ${percentLabel(baseline.timeoutRate)} timeout, so the target was re-simulated at ${secondsLabel(effective)}.`,
  };
  diagnostics.sanityChecks = [item, ...(diagnostics.sanityChecks ?? [])];
  diagnostics.why = [
    {
      code: "long_fight",
      title: "Long fight",
      detail: `This target can look impossible if the simulation window is too short. Current p90 is ${secondsLabel(result.p90Seconds)} after extending the window.`,
      severity: 0.95,
    },
    ...(diagnostics.why ?? []),
  ].slice(0, 8);
}

function normalizeStrategyOptions(options = {}) {
  return {
    goalQuintessence: blankToNull(options.goalQuintessence ?? options.goalQ),
    goalCurrencies: parseStrategyCurrencyGoals(options.goalCurrencies ?? options.goalCurrency),
    targetWinRate: blankToNull(options.targetWinRate),
    softcapSeconds: blankToNull(options.softcapSeconds),
    maxSoftcapWaitSeconds: toNumber(options.maxSoftcapWaitSeconds, 1800),
    farmSeconds: toNumber(options.farmSeconds, 3600),
    boosterCandidates: parseRouteSpecs(options.boosterCandidates),
    masterpieceTargetIds: normalizeIds(options.masterpieceTargetIds ?? options.masterpieceTargets),
    strategyProfile: blankToNull(options.strategyProfile ?? options.profile),
    strategyMode: blankToNull(options.strategyMode ?? options.mode),
    compareProfiles: normalizeIds(options.compareProfiles ?? options.profileIds),
  };
}

function blankToNull(value) {
  if (value == null || value === true) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function fixedStrategyTrials(trialsSetting) {
  if (!trialsSetting || trialsSetting.mode === "fixed") {
    return Math.min(toNumber(trialsSetting?.trials, 200), WEB_AUXILIARY_TRIAL_CAP);
  }
  return Math.min(toNumber(trialsSetting.initialTrials, 200), WEB_AUXILIARY_TRIAL_CAP);
}

function targetSummary(target) {
  return {
    id: target.id,
    name: target.name ?? target.id,
    rarity: target.rarity ?? "unknown",
  };
}

function targetRewardsSummary(target) {
  const rewardStats = (target.rewards ?? []).map((item) => item.statName).filter(Boolean);
  const rewardCurrencies = (target.currencyRewards ?? []).map((item) => item.name).filter(Boolean);
  return {
    rewardStats,
    rewardCurrencies,
    searchText: [
      target.id,
      target.name,
      target.rarity,
      rewardStats.length > 0 ? "stat" : null,
      rewardCurrencies.length > 0 ? "currency" : null,
      ...rewardStats,
      ...rewardCurrencies,
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

function guaranteedIdsFromState(state = {}) {
  return [
    ...normalizeIds(state.guaranteedSketchIds),
    ...["rough", "framed", "opus", "masterpiece"].flatMap((rarity) => normalizeIds(state.guaranteedSketchSelections?.[rarity])),
  ];
}

function estimateRewardHint(sketch = {}) {
  let score = 0;
  const rarityWeight = {
    rough: 0.25,
    framed: 0.75,
    opus: 1.25,
    masterpiece: 1,
  }[sketch.rarity] ?? 0.5;
  for (const reward of sketch.rewards ?? []) {
    const amount = Math.abs(toNumber(reward.amount));
    if (amount <= 0) continue;
    score += rarityWeight * (1 + Math.log10(1 + amount));
  }
  for (const reward of sketch.currencyRewards ?? []) {
    const amount = Math.abs(toNumber(reward.amount));
    if (amount <= 0) continue;
    score += 0.25 * (1 + Math.log10(1 + amount));
  }
  return round(score);
}

function countCandidateRarityPool(candidates = []) {
  const counts = {};
  for (const candidate of candidates) {
    const rarity = candidate.sketch?.rarity ?? "unknown";
    counts[rarity] = (counts[rarity] ?? 0) + 1;
  }
  return counts;
}

function summarizeRewardList(rewards = [], key) {
  return [...rewards]
    .filter((item) => item?.[key] && toNumber(item.amount) !== 0)
    .sort((a, b) => Math.abs(toNumber(b.amount)) - Math.abs(toNumber(a.amount)))
    .slice(0, 4)
    .map((item) => ({
      name: item[key],
      amount: round(toNumber(item.amount)),
    }));
}

function normalizeIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function topKey(counts = {}) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function rarityRank(rarity) {
  return {
    rough: 1,
    framed: 2,
    opus: 3,
    masterpiece: 4,
  }[rarity] ?? 0;
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}
