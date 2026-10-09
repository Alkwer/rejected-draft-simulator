import { extractStats, toNumber } from "./save.js";

const RUN_STATS_PATHS = [
  ["currentRunStats"],
];

export function analyzeSave({ save, sketches = {}, targetId = null, dataMetadata = null }) {
  const state = save?.state ?? {};
  const maxVictories = toNumber(state.fundamentals?.maxVictories, 250);
  const stats = analyzeStats(state);
  const active = analyzeActiveSketches({ state, sketches, targetId, maxVictories });

  return {
    saveVersion: save?.version ?? null,
    stats,
    run: {
      phase: detectRunPhase(state, active.items, maxVictories),
      countsByRarity: state.availableSketchCountsByRarity ?? state.runTotalSketchCountsByRarity ?? {},
      active,
      rewardProgress: Object.fromEntries(active.items.map((item) => [item.id, item.rewardProgress])),
    },
    tools: analyzeTools(state),
    meditation: analyzeMeditation(state),
    warnings: validateDataFreshness({ saveVersion: save?.version, dataMetadata }),
  };
}

export function analyzeStats(state) {
  const playerStats = extractStats(state, "playerStats");
  const battleStats = extractStats(state, "battleStats");
  const runStats = extractRunStats(state);
  const recommended = chooseStatsSource({ state, playerStats, battleStats, runStats });

  return {
    recommendedSource: recommended.source,
    reason: recommended.reason,
    sources: {
      playerStats,
      battleStats,
      runStats,
    },
    playerVsBattle: compareStats(playerStats, battleStats),
  };
}

export function getStatsBySource(state, source) {
  if (source === "auto") return analyzeStats(state).sources[analyzeStats(state).recommendedSource] ?? {};
  if (source === "runStats") return extractRunStats(state);
  return extractStats(state, source);
}

function extractRunStats(state) {
  for (const path of RUN_STATS_PATHS) {
    const raw = getPath(state, path);
    if (raw && Object.keys(raw).length > 0) return numericObject(raw);
  }
  return {};
}

function chooseStatsSource({ state, playerStats, battleStats, runStats }) {
  if (hasEnoughStats(runStats) && normalizeArray(state.availableSketches).length > 0) {
    return { source: "runStats", reason: "current_run_stats_available" };
  }
  if (hasEnoughStats(battleStats) && battleStats.attackSpeed > 0) {
    return { source: "battleStats", reason: "battle_stats_available" };
  }
  if (hasEnoughStats(playerStats)) {
    return { source: "playerStats", reason: "fallback_player_stats" };
  }
  return { source: "playerStats", reason: "no_viable_stats_found" };
}

function hasEnoughStats(stats) {
  return toNumber(stats.maxHp) > 0 && toNumber(stats.attack) >= 0 && Object.keys(stats).length > 0;
}

function compareStats(base, current) {
  const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
  const comparison = {};
  for (const key of [...keys].sort()) {
    const baseValue = toNumber(base[key]);
    const currentValue = toNumber(current[key]);
    const delta = currentValue - baseValue;
    comparison[key] = {
      playerStats: roundNumber(baseValue),
      battleStats: roundNumber(currentValue),
      delta: roundNumber(delta),
      percentDelta: baseValue === 0 ? null : roundNumber((delta / Math.abs(baseValue)) * 100),
    };
  }
  return comparison;
}

function analyzeActiveSketches({ state, sketches, targetId, maxVictories }) {
  const hidden = new Set(normalizeArray(state.hiddenSketches));
  const available = normalizeArray(state.availableSketches);
  const runVictories = state.sketchRunVictories ?? {};
  const totalVictories = state.sketchVictories ?? {};
  const groups = {
    defeated: [],
    hidden: [],
    remaining: [],
    target: null,
  };

  const items = available.map((id) => {
    const sketch = sketches[id] ?? { id, name: id, rarity: "unknown" };
    const runVictoryCount = toNumber(runVictories[id]);
    const totalVictoryCount = toNumber(totalVictories[id]);
    const remainingToMax = Math.max(0, maxVictories - runVictoryCount);
    const item = {
      id,
      name: sketch.name ?? id,
      rarity: sketch.rarity ?? "unknown",
      hidden: hidden.has(id),
      isTarget: id === targetId,
      defeatedThisRun: runVictoryCount >= maxVictories,
      rewardProgress: {
        totalVictories: totalVictoryCount,
        runVictories: runVictoryCount,
        rewardsCollectedThisRun: runVictoryCount,
        remainingToMax,
        maxVictories,
      },
    };

    if (item.isTarget) groups.target = item;
    else if (item.defeatedThisRun) groups.defeated.push(item);
    else if (item.hidden) groups.hidden.push(item);
    else groups.remaining.push(item);

    return item;
  });

  return { ...groups, items };
}

function analyzeTools(state) {
  return {
    autoBooster: normalizeArray(state.autoBoosterSketches),
    autoEraser: normalizeArray(state.autoEraserSketches),
    autoSwapper: normalizeArray(state.autoSwapperSketches),
    boosted: normalizeArray(state.boostedSketchIds),
    erased: normalizeArray(state.erasedSketchIds),
    swapped: normalizeArray(state.swappedSketchIds),
    guaranteed: normalizeArray(state.guaranteedSketchIds),
    guaranteedSelections: state.guaranteedSketchSelections ?? {},
  };
}

function analyzeMeditation(state) {
  return {
    sketchId: state.meditationSketchId ?? null,
    count: toNumber(state.meditationCount),
    cooldownStart: state.meditationCooldownStart ?? null,
    activeBuffs: normalizeArray(state.activeMeditationBuffs),
    pendingStats: normalizeArray(state.pendingMeditationStats),
    usedThisSession: toNumber(state.meditationsUsedThisSession),
  };
}

function detectRunPhase(state, activeItems, maxVictories) {
  if (state.targetedRedrawActive || toNumber(state.targetedRedrawCountdown) > 0) return "before_redraw";
  if (activeItems.length === 0) return "before_redraw";
  if (activeItems.every((item) => item.rewardProgress.runVictories >= maxVictories)) return "cleared_run";
  if (activeItems.some((item) => item.rewardProgress.runVictories > 0)) return "in_run";
  return "after_redraw";
}

function validateDataFreshness({ saveVersion, dataMetadata }) {
  const dataSaveVersion = dataMetadata?.saveVersion;
  if (dataSaveVersion == null || saveVersion == null) return [];
  if (Number(dataSaveVersion) >= Number(saveVersion)) return [];
  return [
    {
      code: "stale_sketch_data",
      message: `Sketch data metadata is for save version ${dataSaveVersion}, but save is version ${saveVersion}.`,
      dataSaveVersion: Number(dataSaveVersion),
      saveVersion: Number(saveVersion),
      gameVersion: dataMetadata?.gameVersion ?? null,
    },
  ];
}

function getPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function numericObject(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw)) result[key] = toNumber(value);
  return result;
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...value];
  if (value instanceof Set) return [...value];
  if (typeof value === "object") return Object.values(value);
  return [];
}

function roundNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e9) / 1e9;
}
