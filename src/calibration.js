import { runMonteCarlo, simulateFight } from "./combat.js";
import { createRng } from "./rng.js";
import { toNumber } from "./save.js";
import { readFileSync } from "node:fs";
import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { buildSteamEnemy, enemyFromSketch } from "./combat/steam-encounter.js";
import { STEAM_UNIVERSES } from "./combat/steam-universes.js";
import { normalizeFightOutcome } from "./fight-outcome.js";
import { combatStatNumber, invalidCombatStats, isRecord } from "../web/save-format.js";

export const GAME_DATA_VERSIONS = {
  "v0.874": {
    saveVersion: 52,
    capturedAt: "2026-05-20",
    targets: {
      duct_taped_banana: {
        name: "Duct-Taped Banana",
        rarity: "masterpiece",
        stats: {
          maxHp: 3300000000000,
          attack: 100000000000,
          attackSpeed: 1900,
          bananaPeelChance: 9000,
          dodge: 44,
          isolation: 99,
          absorb: 95,
        },
        vulnerability: ["bleedChance", 25],
        immunities: [
          "blackFlameChance",
          "brittleChance",
          "hypnotizeChance",
          "poisonChance",
        ],
      },
      rose_window: {
        name: "Rose Window",
        rarity: "masterpiece",
        stats: {
          maxHp: 60000000000000,
          attack: 600000000,
          armor: 2000000000000,
          attackSpeed: 1200,
          hypnotizeChance: 1200,
          thornsChance: 6000000000,
          opacity: 96,
          freezeChance: 60000,
          regen: 2000000000000,
          remedy: 12,
        },
        vulnerability: ["freezeChance", 300],
        immunities: [
          "blackFlameChance",
          "bleedChance",
          "brittleChance",
          "curseChance",
          "hypnotizeChance",
          "irradiateChance",
          "plagueChance",
          "poisonChance",
          "slowChance",
        ],
      },
      mobius_strip: {
        name: "Mobius Strip",
        rarity: "masterpiece",
        stats: {
          maxHp: 600000000,
          attack: 300000000,
          attackSpeed: 300,
          absorb: 100,
          burnChance: 300,
          burnDamage: 30000000,
          remedy: 60,
          opacity: 30,
        },
        vulnerability: ["burnChance", 3],
        immunities: [
          "balloonChance",
          "bleedChance",
          "brittleChance",
          "counter",
          "curseChance",
          "electrocuteChance",
          "energyWaveChance",
          "frailtyChance",
          "freezeChance",
          "hinderChance",
          "hypnotizeChance",
          "irradiateChance",
          "parryDmg",
          "plagueChance",
          "poisonChance",
          "slowChance",
        ],
      },
    },
  },
  "v0.881": {
    saveVersion: 52,
    capturedAt: "2026-05-20",
    targets: {
      duct_taped_banana: {
        name: "Duct-Taped Banana",
        rarity: "masterpiece",
        stats: {
          maxHp: 3300000000000,
          attack: 100000000000,
          attackSpeed: 1900,
          bananaPeelChance: 9000,
          dodge: 44,
          isolation: 99,
          absorb: 95,
        },
        vulnerability: ["bleedChance", 25],
        immunities: [
          "blackFlameChance",
          "brittleChance",
          "hypnotizeChance",
          "poisonChance",
        ],
      },
      rose_window: {
        name: "Rose Window",
        rarity: "masterpiece",
        stats: {
          maxHp: 60000000000000,
          attack: 600000000,
          armor: 2000000000000,
          attackSpeed: 1200,
          hypnotizeChance: 1200,
          thornsChance: 6000000000,
          opacity: 96,
          freezeChance: 60000,
          regen: 2000000000000,
          remedy: 12,
        },
        vulnerability: ["freezeChance", 300],
        immunities: [
          "blackFlameChance",
          "bleedChance",
          "brittleChance",
          "curseChance",
          "hypnotizeChance",
          "irradiateChance",
          "plagueChance",
          "poisonChance",
          "slowChance",
        ],
      },
      mobius_strip: {
        name: "Mobius Strip",
        rarity: "masterpiece",
        stats: {
          maxHp: 600000000,
          attack: 300000000,
          attackSpeed: 300,
          absorb: 100,
          burnChance: 300,
          burnDamage: 30000000,
          remedy: 60,
          opacity: 30,
        },
        vulnerability: ["burnChance", 3],
        immunities: [
          "balloonChance",
          "bleedChance",
          "brittleChance",
          "counter",
          "curseChance",
          "electrocuteChance",
          "energyWaveChance",
          "frailtyChance",
          "freezeChance",
          "hinderChance",
          "hypnotizeChance",
          "irradiateChance",
          "parryDmg",
          "plagueChance",
          "poisonChance",
          "slowChance",
        ],
      },
    },
  },
};

GAME_DATA_VERSIONS["main-CLD-lYso.js"] = {
  saveVersion: 52,
  capturedAt: "2026-05-22",
  targets: GAME_DATA_VERSIONS["v0.881"].targets,
};

GAME_DATA_VERSIONS["main-B8xwsW5G.js"] = {
  saveVersion: 52,
  capturedAt: "2026-05-23",
  targets: GAME_DATA_VERSIONS["v0.881"].targets,
};

GAME_DATA_VERSIONS["main-Dmswlyp_.js"] = {
  saveVersion: 52,
  capturedAt: "2026-05-24",
  targets: GAME_DATA_VERSIONS["v0.881"].targets,
};

const steamSnapshot = JSON.parse(readFileSync(new URL("../fixtures/sketch-snapshots.json", import.meta.url), "utf8"));
GAME_DATA_VERSIONS[steamSnapshot.gameVersion] = steamSnapshot;

export const KNOWN_REGRESSION_SCENARIOS = [
  {
    id: "duct_raw_attack_kills_underbuilt_player",
    targetId: "duct_taped_banana",
    expectedWinner: "enemy",
    maxSeconds: 10,
    player: {
      maxHp: 1000000,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
  },
  {
    id: "rose_armor_regen_wall_stalls_low_damage_player",
    targetId: "rose_window",
    expectedWinner: "timeout",
    expectedDiagnosis: "armor_wall",
    maxSeconds: 5,
    player: {
      maxHp: 1000000000000,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
  },
  {
    id: "mobius_fast_attack_kills_low_hp_player",
    targetId: "mobius_strip",
    expectedWinner: "enemy",
    maxSeconds: 5,
    player: {
      maxHp: 1000000,
      attack: 0,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
  },
];

const SAVE_LOG_KEYS = [
  "combatLog",
  "combatLogs",
  "battleLog",
  "battleLogs",
  "fightLog",
  "fightLogs",
  "fightHistory",
  "combatHistory",
  "recentCombatResults",
];

export function parseCombatLogText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];

  const parsed = parseJsonLike(trimmed);
  if (parsed != null) return normalizeLogCollection(parsed, "external");

  const lineLogs = trimmed
    .split(/\r?\n/)
    .map((line) => parseJsonLike(line.trim()))
    .filter((item) => item != null);
  return normalizeLogCollection(lineLogs, "external");
}

export function extractCombatLogs(save) {
  const state = save?.state ?? save ?? {};
  const logs = [];

  for (const key of SAVE_LOG_KEYS) {
    if (state[key] == null) continue;
    logs.push(...normalizeLogCollection(state[key], key));
  }

  return logs;
}

export function createCalibrationReport({
  save,
  sketches = {},
  targetId = null,
  player = {},
  externalLogs = [],
  trials = 1000,
  maxSeconds = 300,
  seed = "calibration",
  dataMetadata = null,
} = {}) {
  const saveLogs = extractCombatLogs(save);
  const normalizedExternalLogs = normalizeLogCollection(externalLogs, "external");
  const allLogs = [...saveLogs, ...normalizedExternalLogs];
  const filteredLogs = targetId ? allLogs.filter((log) => log.targetId === targetId) : allLogs;
  const gameDataVersion = firstString(dataMetadata?.gameVersion);
  const warnings = [];

  if (save?.state?.combatLoggingEnabled === false) {
    warnings.push({
      code: "combat_logging_disabled",
      message: "Save has combatLoggingEnabled=false, so real fight history may be empty.",
    });
  }
  if (allLogs.length === 0) {
    warnings.push({
      code: "no_combat_logs",
      message: "No combat logs were found in the save or external log input.",
    });
  } else if (targetId && filteredLogs.length === 0) {
    warnings.push({
      code: "no_logs_for_target",
      message: `Combat logs exist, but none match target ${targetId}.`,
    });
  }

  const fallbackAssumptions = combatAssumptionsFromSave(save);
  let tuningIndex = 0;
  const comparisons = filteredLogs.map((log, index) => {
    const platform = log.patchVersion === steamSnapshot.gameVersion ? "steam"
      : (log.patchVersion === gameDataVersion ? dataMetadata?.platform : null)
        ?? (Object.hasOwn(GAME_DATA_VERSIONS, log.patchVersion) ? "web" : null);
    const historicalAssumptions = historicalCombatAssumptions(log.combatAssumptions, platform);
    const patchExclusion = patchTuningExclusion(log.patchVersion, gameDataVersion);
    const encounterPlatform = historicalAssumptions?.steam ? "steam" : "web";
    const target = resolveCalibrationEnemy(log, sketches[log.targetId], {
      catalogMatches: patchExclusion === null && (!dataMetadata?.platform || dataMetadata.platform === encounterPlatform),
      historicalAssumptions,
    });
    const tuningExclusion = patchExclusion
      ?? (!hasLoggedPlayerStats(log.playerStats) ? "calibration_player_stats_missing" : null)
      ?? (log.combatAssumptions === undefined ? "calibration_combat_assumptions_missing" : null)
      ?? (!historicalAssumptions ? "calibration_combat_assumptions_invalid" : null)
      ?? target.exclusion;
    // Diagnostic-only fights cannot change the RNG sequence used for tuning.
    const simulationIndex = tuningExclusion ? index : tuningIndex++;
    const comparison = compareLogToSimulation({
      log,
      target,
      fallbackPlayer: tuningExclusion ? player : {},
      assumptions: historicalAssumptions ?? fallbackAssumptions,
      trials,
      maxSeconds,
      seed: `${seed}:${simulationIndex}:${log.targetId ?? "unknown"}`,
    });
    return {
      ...comparison,
      patchVersion: log.patchVersion,
      tuningExclusion,
    };
  });
  const deviations = comparisons.flatMap((comparison) => comparison.deviations);
  const tuningWarnings = {
    calibration_catalog_patch_missing: "the sketch catalog has no game patch metadata",
    calibration_log_patch_missing: "the logs specify no game patch",
    calibration_log_patch_mismatch: `the logs specify a different game patch than the catalog (${gameDataVersion})`,
    calibration_player_stats_missing: "the logs lack the recorded player health, attack, or attack speed needed for tuning",
    calibration_combat_assumptions_missing: "the logs lack per-fight combat settings",
    calibration_combat_assumptions_invalid: "the per-fight combat settings are incomplete or invalid for the combat engine",
    calibration_target_stats_incomplete: "the recorded target stats are incomplete or invalid and cannot be confirmed against the matching catalog and encounter settings",
    calibration_target_stats_missing: "the logs and catalog lack complete target health, attack, or attack speed",
  };
  for (const [code, reason] of Object.entries(tuningWarnings)) {
    const count = comparisons.filter((comparison) => comparison.tuningExclusion === code).length;
    if (count > 0) {
      warnings.push({
        code,
        count,
        message: `Excluded ${count} combat log(s) from tuning because ${reason}.`,
      });
    }
  }

  return {
    mode: "calibration",
    gameDataVersion,
    saveVersion: save?.version ?? null,
    logs: {
      total: allLogs.length,
      fromSave: saveLogs.length,
      external: normalizedExternalLogs.length,
      used: filteredLogs.length,
      tuningEligible: comparisons.filter((comparison) => comparison.tuningExclusion === null).length,
      targetFilter: targetId,
      combatLoggingEnabled: save?.state?.combatLoggingEnabled ?? null,
    },
    comparisons,
    deviations,
    tuning: suggestCalibrationTuning(comparisons),
    patchSanity: checkPatchSanity({ sketches, dataMetadata }),
    regression: runKnownRegressionScenarios({ sketches }),
    warnings,
  };
}

export function suggestCalibrationTuning(comparisons = []) {
  const statusRatios = [];
  const reflectRatios = [];
  const durationRatios = [];

  for (const comparison of comparisons) {
    if (comparison.tuningExclusion) continue;
    const actualBreakdown = comparison.actual?.damageBreakdown;
    const simulatedBreakdown = comparison.simulated?.fight?.damageBreakdown;

    const actualStatus = breakdownValue(actualBreakdown, "enemy", "status");
    const simulatedStatus = breakdownValue(simulatedBreakdown, "enemy", "status");
    pushRatio(statusRatios, actualStatus, simulatedStatus);

    const actualReflect = breakdownValue(actualBreakdown, "player", "reflect")
      + breakdownValue(actualBreakdown, "player", "parry");
    const simulatedReflect = breakdownValue(simulatedBreakdown, "player", "reflect")
      + breakdownValue(simulatedBreakdown, "player", "parry");
    pushRatio(reflectRatios, actualReflect, simulatedReflect);

    if (comparison.actual?.outcome === "timeout" || comparison.predicted?.medianCensored) continue;
    const actualSeconds = toNumber(comparison.actual?.seconds, NaN);
    const simulatedSeconds = toNumber(comparison.simulated?.summary?.medianSeconds, NaN)
      || toNumber(comparison.simulated?.fight?.seconds, NaN);
    pushRatio(durationRatios, actualSeconds, simulatedSeconds);
  }

  return {
    statusTickMultiplier: summarizeRatios(statusRatios, "status_tick_multiplier"),
    thornsCounterMultiplier: summarizeRatios(reflectRatios, "thorns_counter_multiplier"),
    durationMultiplier: summarizeRatios(durationRatios, "duration_multiplier"),
  };
}

function patchTuningExclusion(logPatch, catalogPatch) {
  if (!catalogPatch) return "calibration_catalog_patch_missing";
  if (!logPatch) return "calibration_log_patch_missing";
  return logPatch === catalogPatch ? null : "calibration_log_patch_mismatch";
}

function historicalCombatAssumptions(assumptions, platform) {
  if (!Number.isFinite(assumptions?.combatSpeedMultiplier) || assumptions.combatSpeedMultiplier <= 0 ||
      typeof assumptions.flowStateActive !== "boolean") return null;
  if (assumptions.flowStateActive && (!Number.isFinite(assumptions.flowStateLevel) || assumptions.flowStateLevel < 0 ||
      !isStringList(assumptions.flowStateKnownTargetIds))) return null;

  const { combatSpeedMultiplier, flowStateActive, flowStateLevel, flowStateKnownTargetIds, steam, battleSpeedup } = assumptions;
  const base = {
    combatSpeedMultiplier,
    flowStateActive,
    ...(flowStateActive && { flowStateLevel, flowStateKnownTargetIds }),
  };
  if (steam == null) return platform !== "steam" && battleSpeedup == null ? base : null;
  if (platform === "web") return null;
  if (battleSpeedup != null && (!Number.isFinite(battleSpeedup.multiplier) || battleSpeedup.multiplier <= 0 ||
      !Number.isFinite(battleSpeedup.remainingSeconds) || battleSpeedup.remainingSeconds <= 0)) return null;
  return validSteamEncounterSettings(steam) ? { ...base, steam, battleSpeedup } : null;
}

function validSteamEncounterSettings(steam) {
  return typeof steam.universeId === "string" && Object.hasOwn(STEAM_UNIVERSES, steam.universeId)
    && isStringList(steam.erasedSketchIds) && Number.isFinite(steam.eraserDivisor) && steam.eraserDivisor > 0
    && Number.isFinite(steam.buffStackCapBonuses?.Haste) && Number.isFinite(steam.buffStackCapBonuses?.Inspiration)
    && Array.isArray(steam.seppukuRules) && steam.seppukuRules.every((rule) =>
      ["all", "any"].includes(rule?.mode) && Array.isArray(rule.conditions) && rule.conditions.length > 0
      && rule.conditions.every((condition) => {
        const { stat, threshold } = condition ?? {};
        if (typeof stat !== "string" || !stat || !Number.isSafeInteger(threshold)) return false;
        return stat === "playerHp" || stat === "enemyHp" ? threshold >= 0 && threshold <= 100 : threshold >= 1;
      }));
}

function isStringList(values) {
  return Array.isArray(values) && values.every((value) => typeof value === "string" && value.trim().length > 0);
}

export function checkPatchSanity({
  sketches = {},
  dataMetadata = null,
  version = null,
  tolerance = 1e-9,
} = {}) {
  const selectedVersion = version ?? dataMetadata?.gameVersion ?? latestGameDataVersion();
  const expected = GAME_DATA_VERSIONS[selectedVersion];
  const failures = [];

  if (!expected) {
    failures.push({
      code: "unknown_game_version",
      version: selectedVersion,
      message: `No sanity snapshot exists for game data version ${selectedVersion}.`,
    });
    return {
      ok: false,
      version: selectedVersion,
      dataVersion: dataMetadata?.gameVersion ?? null,
      checkedTargets: 0,
      failures,
    };
  }

  const saveVersion = dataMetadata?.saveVersion ?? null;
  if (saveVersion !== null && expected.saveVersion != null && saveVersion !== expected.saveVersion) {
    failures.push({
      code: "save_version_mismatch",
      version: selectedVersion,
      expected: expected.saveVersion,
      actual: saveVersion,
      message: `Expected save version ${expected.saveVersion} for ${selectedVersion}, got ${saveVersion}.`,
    });
  }

  for (const [targetId, target] of Object.entries(expected.targets)) {
    const actual = sketches[targetId];
    if (!actual) {
      failures.push({
        code: "missing_target",
        targetId,
        message: `Missing target ${targetId} in sketch data.`,
      });
      continue;
    }

    if (actual.rarity !== target.rarity) {
      failures.push({
        code: "rarity_mismatch",
        targetId,
        expected: target.rarity,
        actual: actual.rarity,
      });
    }

    compareStats({ targetId, expected: target.stats, actual: actual.stats ?? {}, tolerance, failures });
    compareArray({ targetId, field: "immunities", expected: target.immunities, actual: actual.immunities, failures });
    compareArray({ targetId, field: "vulnerability", expected: target.vulnerability, actual: actual.vulnerability, failures });
  }

  return {
    ok: failures.length === 0,
    version: selectedVersion,
    dataVersion: dataMetadata?.gameVersion ?? null,
    saveVersion,
    checkedTargets: Object.keys(expected.targets).length,
    failures,
  };
}

export function runKnownRegressionScenarios({
  sketches = {},
  scenarios = KNOWN_REGRESSION_SCENARIOS,
} = {}) {
  const results = scenarios.map((scenario) => {
    const target = sketches[scenario.targetId];
    if (!target) {
      return {
        id: scenario.id,
        targetId: scenario.targetId,
        pass: false,
        reason: "missing_target",
      };
    }

    const fight = simulateFight({
      rng: createRng(`regression:${scenario.id}`),
      player: scenario.player,
      enemy: {
        id: target.id,
        name: target.name,
        ...target.stats,
        immunities: target.immunities,
        vulnerability: target.vulnerability,
      },
      maxSeconds: scenario.maxSeconds ?? 300,
    });
    const pass = fight.winner === scenario.expectedWinner
      && (!scenario.expectedDiagnosis || fight.timeoutDiagnosis === scenario.expectedDiagnosis);

    return {
      id: scenario.id,
      targetId: scenario.targetId,
      expectedWinner: scenario.expectedWinner,
      actualWinner: fight.winner,
      expectedDiagnosis: scenario.expectedDiagnosis ?? null,
      actualDiagnosis: fight.timeoutDiagnosis ?? null,
      seconds: round(fight.seconds),
      pass,
      reason: fight.reason,
    };
  });

  return {
    total: results.length,
    passed: results.filter((item) => item.pass).length,
    failed: results.filter((item) => !item.pass).length,
    results,
  };
}

function compareLogToSimulation({
  log,
  target,
  fallbackPlayer,
  assumptions,
  trials,
  maxSeconds,
  seed,
}) {
  const playerStats = hasLoggedPlayerStats(log.playerStats) ? log.playerStats : fallbackPlayer;
  const { enemy, exclusion } = target;
  const deviations = [];

  if (!hasLoggedPlayerStats(playerStats) || !enemy) {
    return {
      logIndex: log.index,
      targetId: log.targetId,
      sourceKey: log.sourceKey,
      actual: actualSummary(log),
      predicted: { outcome: "unknown", winRate: null },
      simulated: null,
      deviations: [
        {
          code: exclusion ?? "missing_stats",
          targetId: log.targetId,
          message: exclusion === "calibration_target_stats_incomplete"
            ? "Cannot compare combat log because the partial target snapshot could not be verified against the matching catalog and encounter settings."
            : "Cannot compare combat log because complete player or target stats are missing.",
        },
      ],
    };
  }

  const player = {
    ...playerStats,
    immunities: log.playerImmunities ?? fallbackPlayer?.immunities ?? [],
    vulnerability: log.playerVulnerability !== undefined ? log.playerVulnerability : fallbackPlayer?.vulnerability ?? null,
  };
  const summary = runMonteCarlo({
    assumptions,
    player,
    enemy,
    trials,
    maxSeconds,
    seed,
  });
  const fight = simulateFight({
    assumptions,
    rng: createRng(`${seed}:single`),
    player,
    enemy,
    maxSeconds,
  });
  const predicted = {
    outcome: predictedOutcome(summary),
    winRate: summary.winRate,
    timeoutRate: summary.timeoutRate,
    medianSeconds: summary.medianSeconds,
    medianCensored: summary.medianCensored,
    topVictoryCause: topKey(summary.victoryCauses),
    topDefeatCause: topKey(summary.defeatCauses),
  };

  // Compare outcomes only when the observation establishes the result at the simulated horizon.
  const outsideHorizon = log.outcome === "timeout"
    ? Number.isFinite(log.seconds) && log.seconds < maxSeconds
    : Number.isFinite(log.seconds) && log.seconds >= maxSeconds;
  if (!outsideHorizon && log.outcome !== "unknown" && predicted.outcome !== "uncertain" && log.outcome !== predicted.outcome) {
    deviations.push({
      code: "outcome_mismatch",
      targetId: log.targetId,
      actual: log.outcome,
      predicted: predicted.outcome,
      winRate: round(summary.winRate),
      message: `Observed ${log.outcome}, but simulation predicted ${predicted.outcome}.`,
    });
  }

  const durationDeviation = !predicted.medianCensored && log.outcome !== "timeout" &&
    compareDuration(log.seconds, summary.medianSeconds);
  if (durationDeviation) {
    deviations.push({
      code: "duration_mismatch",
      targetId: log.targetId,
      ...durationDeviation,
    });
  }

  const causeDeviation = !outsideHorizon && compareCause(log.reason, summary);
  if (causeDeviation) {
    deviations.push({
      code: "cause_mismatch",
      targetId: log.targetId,
      ...causeDeviation,
    });
  }

  return {
    logIndex: log.index,
    targetId: log.targetId,
    sourceKey: log.sourceKey,
    actual: actualSummary(log),
    predicted,
    simulated: {
      summary,
      fight: {
        winner: fight.winner,
        reason: fight.reason,
        seconds: fight.seconds,
        damageBreakdown: fight.damageBreakdown,
        deathCause: fight.deathCause,
        timeoutDiagnosis: fight.timeoutDiagnosis ?? null,
      },
    },
    deviations,
  };
}

function resolveCalibrationEnemy(log, sketch, { catalogMatches, historicalAssumptions }) {
  const catalogEnemy = invalidCombatStats(sketch?.stats).length === 0 ? enemyFromSketch(sketch, log.targetId) : null;
  const hasRecordedStats = Object.keys(log.targetStats).length > 0;
  const recordedModifiers = {
    ...(log.immunities !== undefined && { immunities: log.immunities }),
    ...(log.vulnerability !== undefined && { vulnerability: log.vulnerability }),
  };
  if (!log.targetStatsInvalid && invalidCombatStats(log.targetStats).length === 0) {
    return {
      enemy: {
        ...log.targetStats,
        id: log.targetId,
        immunities: sketch?.immunities ?? [],
        vulnerability: sketch?.vulnerability ?? null,
        ...recordedModifiers,
      },
      exclusion: null,
    };
  }
  if (!log.targetStatsInvalid && !hasRecordedStats && Object.keys(recordedModifiers).length === 0) {
    return catalogEnemy
      ? { enemy: { ...catalogEnemy, ...recordedModifiers }, exclusion: null }
      : { enemy: null, exclusion: "calibration_target_stats_missing" };
  }

  // Recorded stats are effective encounter values. Verify the partial snapshot
  // after applying historical Steam modifiers, then simulate the same values.
  if (!log.targetStatsInvalid && catalogEnemy && catalogMatches && historicalAssumptions) {
    const effective = buildSteamEnemy(catalogEnemy, historicalAssumptions.steam);
    const statsMatch = Object.entries(log.targetStats).every(([key, value]) =>
      key === "isPreciseErased" ? value === Boolean(effective[key]) : value === combatStatNumber(effective[key]));
    const immunitiesMatch = log.immunities === undefined
      || JSON.stringify([...log.immunities].sort()) === JSON.stringify([...(effective.immunities ?? [])].sort());
    const vulnerabilityMatches = log.vulnerability === undefined
      || JSON.stringify(log.vulnerability ?? []) === JSON.stringify(effective.vulnerability ?? []);
    if (statsMatch && immunitiesMatch && vulnerabilityMatches) return { enemy: effective, exclusion: null };
  }
  if (!log.targetStatsInvalid && !hasRecordedStats && catalogEnemy) {
    return { enemy: { ...catalogEnemy, ...recordedModifiers }, exclusion: "calibration_target_stats_incomplete" };
  }
  return { enemy: null, exclusion: "calibration_target_stats_incomplete" };
}

function normalizeLogCollection(value, sourceKey) {
  const wrappedEntries = [value?.logs, value?.entries, value?.history].find(Array.isArray);
  const entries = wrappedEntries ?? unwrapLogCollection(value);
  const collectionPatch = wrappedEntries
    ? firstString(value.patchVersion, value.gameVersion, value.metadata?.gameVersion, value.version)
    : null;
  return entries
    .map((entry, index) => normalizeLogEntry(entry, sourceKey, index, collectionPatch))
    .filter(Boolean);
}

function unwrapLogCollection(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    const objectValues = Object.values(value);
    if (objectValues.every((item) => item && typeof item === "object")) return objectValues;
    return [value];
  }
  return [];
}

function normalizeLogEntry(raw, sourceKey, index, collectionPatch) {
  if (!raw || typeof raw !== "object") return null;
  const target = raw.target ?? raw.sketch ?? raw.enemy ?? {};
  const targetId = firstString(
    raw.targetId,
    raw.sketchId,
    raw.enemyId,
    raw.id,
    target.id,
  );
  const targetName = firstString(raw.targetName, raw.sketchName, raw.enemyName, target.name);
  const outcome = normalizeFightOutcome(raw);
  const seconds = normalizeSeconds(raw);
  const playerStats = raw.playerStats ?? raw.player?.stats ?? raw.attackerStats;
  const targetStats = raw.targetStats ?? raw.enemyStats ?? raw.defenderStats ?? target.stats;
  const { stats: recordedTargetStats, invalid: targetStatsInvalid } = normalizeTargetStats(targetStats);
  const targetImmunities = raw.immunities ?? targetStats?.immunities ?? target.immunities;
  const targetVulnerability = [raw.vulnerability, targetStats?.vulnerability, target.vulnerability]
    .find((value) => value !== undefined);
  const invalidModifiers = (targetImmunities != null && !isStringList(targetImmunities))
    || (targetVulnerability != null && !Array.isArray(targetVulnerability));
  const damageBreakdown = normalizeDamageBreakdown(raw.damageBreakdown ?? raw.damage ?? raw.breakdown);

  if (!targetId && !targetName && outcome === "unknown" && !Number.isFinite(seconds)) {
    return null;
  }

  return {
    sourceKey,
    index,
    targetId,
    targetName,
    outcome,
    seconds,
    reason: firstString(raw.reason, raw.cause, raw.deathCause, raw.resultReason, raw.outcomeReason),
    playerStats: numericObject(playerStats),
    targetStats: recordedTargetStats,
    targetStatsInvalid: raw.targetStatsInvalid === true || targetStatsInvalid || invalidModifiers,
    playerImmunities: [raw.playerImmunities, playerStats?.immunities, raw.player?.immunities].find(Array.isArray),
    playerVulnerability: firstVulnerability(raw.playerVulnerability, playerStats?.vulnerability, raw.player?.vulnerability),
    immunities: [raw.immunities, targetStats?.immunities, target.immunities].find(Array.isArray),
    vulnerability: firstVulnerability(raw.vulnerability, targetStats?.vulnerability, target.vulnerability),
    combatAssumptions: Object.hasOwn(raw, "combatAssumptions") ? raw.combatAssumptions : raw.assumptions,
    damageBreakdown,
    patchVersion: firstString(raw.patchVersion, raw.gameVersion, raw.version) ?? collectionPatch,
    raw,
  };
}

function firstVulnerability(...values) {
  return values.find((value) => value === null || Array.isArray(value));
}

function normalizeSeconds(raw) {
  const direct = firstFinite(raw.seconds, raw.durationSeconds, raw.fightSeconds, raw.elapsedSeconds, raw.timeSeconds);
  if (Number.isFinite(direct)) return direct;
  const ms = firstFinite(raw.durationMs, raw.elapsedMs, raw.timeMs);
  return Number.isFinite(ms) ? ms / 1000 : NaN;
}

function normalizeDamageBreakdown(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    player: numericObject(raw.player ?? raw.takenByPlayer ?? raw.playerTaken ?? {}),
    enemy: numericObject(raw.enemy ?? raw.target ?? raw.takenByEnemy ?? raw.enemyTaken ?? {}),
  };
}

function actualSummary(log) {
  return {
    outcome: log.outcome,
    seconds: Number.isFinite(log.seconds) ? log.seconds : null,
    reason: log.reason ?? null,
    damageBreakdown: log.damageBreakdown,
  };
}

function predictedOutcome(summary) {
  if (summary.winRate >= 0.65) return "win";
  if (summary.timeoutRate >= 0.5) return "timeout";
  if (summary.winRate <= 0.35) return "loss";
  return "uncertain";
}

function compareDuration(actualSeconds, simulatedMedianSeconds) {
  if (!Number.isFinite(actualSeconds) || !Number.isFinite(simulatedMedianSeconds) || simulatedMedianSeconds <= 0) return null;
  const ratio = actualSeconds / simulatedMedianSeconds;
  const deltaSeconds = actualSeconds - simulatedMedianSeconds;
  if (Math.abs(deltaSeconds) < 2 && Math.abs(1 - ratio) < 0.35) return null;
  return {
    actualSeconds: round(actualSeconds),
    simulatedMedianSeconds: round(simulatedMedianSeconds),
    ratio: round(ratio),
    message: `Observed duration differs from simulated median by ${round(deltaSeconds)}s.`,
  };
}

function compareCause(reason, summary) {
  const normalized = normalizeCause(reason);
  if (!normalized) return null;
  const combined = new Set([
    ...Object.keys(summary.defeatCauses ?? {}),
    ...Object.keys(summary.timeoutDiagnoses ?? {}),
    ...Object.keys(summary.deathCauses ?? {}),
  ]);
  if (combined.has(normalized)) return null;
  if (normalized === "status_damage" && (combined.has("status_damage") || combined.has("opacity_remedy_wall"))) return null;
  if (normalized === "thorns_counter" && (combined.has("reflect_damage") || combined.has("thorns_counter"))) return null;
  return {
    observedCause: normalized,
    simulatedCauses: [...combined].sort(),
    message: `Observed cause ${normalized} was not present in simulation causes.`,
  };
}

function normalizeCause(reason) {
  const text = String(reason ?? "").toLowerCase();
  if (!text) return null;
  if (/burn|bleed|poison|status|dot/.test(text)) return "status_damage";
  if (/thorn|counter|reflect|parry/.test(text)) return "thorns_counter";
  if (/regen/.test(text)) return "regen_wall";
  if (/armor/.test(text)) return "armor_wall";
  if (/dodge|accuracy|miss|banana/.test(text)) return "dodge_accuracy_wall";
  if (/timeout|stall/.test(text)) return "stall";
  if (/attack|hit|raw|direct/.test(text)) return "raw_attack";
  return text.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function summarizeRatios(ratios, code) {
  const clean = ratios.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length === 0) {
    return {
      code,
      value: null,
      sampleCount: 0,
      confidence: "none",
    };
  }
  const value = round(median(clean));
  return {
    code,
    value,
    sampleCount: clean.length,
    min: round(clean[0]),
    max: round(clean[clean.length - 1]),
    confidence: clean.length >= 5 ? "medium" : "low",
  };
}

function compareStats({ targetId, expected, actual, tolerance, failures }) {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const stat of [...keys].sort()) {
    const expectedValue = toNumber(expected[stat], NaN);
    const actualValue = toNumber(actual[stat], NaN);
    if (approximatelyEqual(actualValue, expectedValue, tolerance)) continue;
    failures.push({
      code: "stat_mismatch",
      targetId,
      stat,
      expected: expectedValue,
      actual: actualValue,
    });
  }
}

function compareArray({ targetId, field, expected = [], actual = [], failures }) {
  const normalizedExpected = JSON.stringify(normalizeArray(expected));
  const normalizedActual = JSON.stringify(normalizeArray(actual));
  if (normalizedExpected === normalizedActual) return;
  failures.push({
    code: `${field}_mismatch`,
    targetId,
    expected,
    actual,
  });
}

function numericObject(raw = {}) {
  if (!raw || typeof raw !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && !value.trim()) continue;
    const number = toNumber(value, NaN);
    if (Number.isFinite(number)) result[key] = number;
  }
  return result;
}

function normalizeTargetStats(raw) {
  if (raw == null) return { stats: {}, invalid: false };
  if (!isRecord(raw)) return { stats: {}, invalid: true };

  const metadataKeys = ["id", "name", "rarity", "source", "immunities", "vulnerability"];
  const entries = [];
  let invalid = false;
  for (const [key, value] of Object.entries(raw)) {
    if (metadataKeys.includes(key)) continue;
    if (key === "isPreciseErased" && typeof value === "boolean") {
      entries.push([key, value]);
      continue;
    }
    const number = combatStatNumber(value);
    if (key === "isPreciseErased" || !Number.isFinite(number)) invalid = true;
    else entries.push([key, number]);
  }
  return { stats: Object.fromEntries(entries), invalid };
}

function hasLoggedPlayerStats(stats) {
  return Number.isFinite(stats?.maxHp) && stats.maxHp > 0
    && Number.isFinite(stats.attack) && stats.attack >= 0
    && Number.isFinite(stats.attackSpeed) && stats.attackSpeed > 0;
}

function breakdownValue(breakdown, side, key) {
  return toNumber(breakdown?.[side]?.[key], 0);
}

function pushRatio(target, observed, simulated) {
  if (!Number.isFinite(observed) || !Number.isFinite(simulated)) return;
  if (observed <= 0 || simulated <= 0) return;
  target.push(observed / simulated);
}

function topKey(counts = {}) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = toNumber(value, NaN);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

function parseJsonLike(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(Buffer.from(text, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
}

function normalizeArray(value) {
  if (value == null) return [];
  const array = Array.isArray(value) ? value : [value];
  return array.map((item) => {
    if (Array.isArray(item)) return normalizeArray(item);
    return item;
  });
}

function approximatelyEqual(actual, expected, tolerance) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return actual === expected;
  const scale = Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) <= scale * tolerance;
}

function latestGameDataVersion() {
  return steamSnapshot.gameVersion;
}

function median(values) {
  if (values.length === 0) return NaN;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

function round(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1e6) / 1e6;
}
