import { extractStats, isSteamSave, toNumber } from "./save.js";
import { STEAM_UNIVERSES, VERIFIED_STEAM_BUILD } from "./combat/steam-universes.js";
import { maxSketchVictories, remainingSketchVictories } from "./victory-limit.js";
import { invalidCombatStats, validateCombatStatSources } from "../web/save-format.js";

export function analyzeSave({ save, sketches = {}, targetId = null, dataMetadata = null }) {
  const state = save?.state ?? {};
  const steamSave = isSteamSave(save);
  const stats = analyzeStats(state, { steamSave });
  const active = analyzeActiveSketches({ state, sketches, targetId });

  return {
    saveVersion: save?.version ?? null,
    stats,
    run: {
      phase: detectRunPhase(state, active.items),
      countsByRarity: state.availableSketchCountsByRarity ?? state.runTotalSketchCountsByRarity ?? {},
      active,
      rewardProgress: Object.fromEntries(active.items.map((item) => [item.id, item.rewardProgress])),
    },
    tools: analyzeTools(state),
    meditation: analyzeMeditation(state),
    warnings: validateDataCompatibility({ save, steamSave, dataMetadata }),
  };
}

export function analyzeStats(state, { steamSave = isSteamSave({ state }) } = {}) {
  const playerStats = extractStats(state, "playerStats");
  const battleStats = extractStats(state, "battleStats");
  const runStats = extractRunStats(state);
  const recommended = chooseStatsSource(state, steamSave);

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
  if (source === "auto") {
    const { sources, recommendedSource } = analyzeStats(state);
    return sources[recommendedSource] ?? {};
  }
  const rawSource = source === "runStats" ? "currentRunStats" : source;
  validateCombatStatSources(state, [rawSource]);
  return extractStats(state, rawSource);
}

function extractRunStats(state) {
  return extractStats(state, "currentRunStats");
}

function chooseStatsSource(state, steamSave) {
  // Steam's battleStats holds accumulated rewards, and playerStats includes all active modifiers.
  if (steamSave) {
    return { source: "playerStats", reason: "steam_player_stats" };
  }
  const hasRunStats = invalidCombatStats(state?.currentRunStats).length === 0;
  if (hasRunStats && normalizeArray(state.availableSketches).length > 0) {
    return { source: "runStats", reason: "current_run_stats_available" };
  }
  if (invalidCombatStats(state?.battleStats).length === 0) {
    return { source: "battleStats", reason: "battle_stats_available" };
  }
  if (invalidCombatStats(state?.playerStats).length === 0) {
    return { source: "playerStats", reason: "fallback_player_stats" };
  }
  if (hasRunStats) {
    return { source: "runStats", reason: "fallback_current_run_stats" };
  }
  validateCombatStatSources(state);
}

function compareStats(base, current) {
  const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
  const comparison = {};
  for (const key of [...keys].sort()) {
    if (key === "immunities" || key === "vulnerability") continue;
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

export function analyzeActiveSketches({ state, sketches, targetId }) {
  const hidden = new Set(normalizeArray(state.hiddenSketches));
  const available = normalizeArray(state.availableSketches);
  const runVictories = state.sketchRunVictories ?? {};
  const totalVictories = state.sketchVictories ?? {};
  const maxVictories = maxSketchVictories(state);
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
    const remainingToMax = remainingSketchVictories(state, id, totalVictoryCount);
    const item = {
      id,
      name: sketch.name ?? id,
      rarity: sketch.rarity ?? "unknown",
      hidden: hidden.has(id),
      isTarget: id === targetId,
      defeatedThisRun: remainingToMax <= 0,
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

function detectRunPhase(state, activeItems) {
  if (state.targetedRedrawActive || toNumber(state.targetedRedrawCountdown) > 0) return "before_redraw";
  if (activeItems.length === 0) return "before_redraw";
  if (activeItems.every((item) => item.defeatedThisRun)) return "cleared_run";
  if (activeItems.some((item) => item.rewardProgress.runVictories > 0)) return "in_run";
  return "after_redraw";
}

export function validateDataCompatibility({ save, steamSave = isSteamSave(save), dataMetadata }) {
  const warnings = [];
  const saveVersion = save?.version;
  const profile = save?.meta?.profile ?? save?.state?.saveProfile;
  if (profile === "steam") {
    const universe = save.state?.multiverse?.currentUniverseId;
    if (universe && !Object.hasOwn(STEAM_UNIVERSES, universe)) {
      warnings.push({ code: "unknown_universe", message: `Unknown Steam universe ${universe}. Estimates use original-universe modifiers.` });
    }
    if (dataMetadata?.buildId && dataMetadata.buildId !== VERIFIED_STEAM_BUILD) {
      warnings.push({ code: "unverified_build", message: `Catalog build ${dataMetadata.buildId} differs from the combat model's verified Steam build ${VERIFIED_STEAM_BUILD}.` });
    }
    const amounts = [save.state?.quintessence, ...Object.values(save.state?.currencies ?? {})];
    if (amounts.some((value) => value != null && !Number.isFinite(toNumber(value, NaN)))) {
      warnings.push({ code: "economy_numeric_range", message: "A saved currency exceeds the simulator's numeric range. Economy projections for this run are unreliable." });
    }
  }
  if (dataMetadata?.platform === "steam" && profile === "steam-demo") {
    warnings.push({ code: "steam_demo", message: "This demo slot has different balance and available sketches. The catalog and verified combat rules cover the full Steam release." });
  } else if (dataMetadata?.platform === "steam" && !steamSave) {
    warnings.push({
      code: "save_platform_mismatch",
      message: "This save uses the legacy format. Steam sketch data may have different stats and rewards.",
    });
  } else if (steamSave && dataMetadata?.platform === "web") {
    warnings.push({ code: "save_platform_mismatch", message: "This Steam save is being compared with legacy web sketch data." });
  } else if (profile === "steam" && save.meta?.gameVersion && dataMetadata?.gameVersion && save.meta.gameVersion !== dataMetadata.gameVersion) {
    warnings.push({ code: "game_version_mismatch", message: `Save patch ${save.meta.gameVersion} differs from catalog patch ${dataMetadata.gameVersion}. Refresh Steam data or use a matching save.` });
  }
  const dataSaveVersion = dataMetadata?.saveVersion;
  if (dataSaveVersion != null && saveVersion != null && Number(dataSaveVersion) < Number(saveVersion)) {
    warnings.push({
      code: "stale_sketch_data",
      message: `Sketch data metadata is for save version ${dataSaveVersion}, but save is version ${saveVersion}.`,
      dataSaveVersion: Number(dataSaveVersion),
      saveVersion: Number(saveVersion),
      gameVersion: dataMetadata?.gameVersion ?? null,
    });
  }
  return warnings;
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
  if (Math.abs(value) >= 1e9) return value;
  return Math.round(value * 1e9) / 1e9;
}
