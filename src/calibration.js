import { runMonteCarlo, simulateFight } from "./combat.js";
import { createRng } from "./rng.js";
import { toNumber } from "./save.js";

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

  const comparisons = filteredLogs.map((log, index) => compareLogToSimulation({
    log,
    sketches,
    fallbackPlayer: player,
    trials,
    maxSeconds,
    seed: `${seed}:${index}:${log.targetId ?? "unknown"}`,
  }));
  const deviations = comparisons.flatMap((comparison) => comparison.deviations);

  return {
    mode: "calibration",
    gameDataVersion: dataMetadata?.gameVersion ?? latestGameDataVersion(),
    saveVersion: save?.version ?? null,
    logs: {
      total: allLogs.length,
      fromSave: saveLogs.length,
      external: normalizedExternalLogs.length,
      used: filteredLogs.length,
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
    saveVersion: dataMetadata?.saveVersion ?? null,
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
  sketches,
  fallbackPlayer,
  trials,
  maxSeconds,
  seed,
}) {
  const sketch = sketches[log.targetId] ?? null;
  const player = hasStats(log.playerStats) ? log.playerStats : fallbackPlayer;
  const targetStats = hasStats(log.targetStats) ? log.targetStats : sketch?.stats;
  const deviations = [];

  if (!hasStats(player) || !hasStats(targetStats)) {
    return {
      logIndex: log.index,
      targetId: log.targetId,
      actual: actualSummary(log),
      predicted: { outcome: "unknown", winRate: null },
      simulated: null,
      deviations: [
        {
          code: "missing_stats",
          targetId: log.targetId,
          message: "Cannot compare combat log because player or target stats are missing.",
        },
      ],
    };
  }

  const enemy = {
    ...targetStats,
    immunities: log.immunities ?? sketch?.immunities ?? [],
    vulnerability: log.vulnerability ?? sketch?.vulnerability ?? null,
  };
  const summary = runMonteCarlo({
    player,
    enemy,
    trials,
    maxSeconds,
    seed,
  });
  const fight = simulateFight({
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
    topVictoryCause: topKey(summary.victoryCauses),
    topDefeatCause: topKey(summary.defeatCauses),
  };

  if (log.outcome !== "unknown" && predicted.outcome !== "uncertain" && log.outcome !== predicted.outcome) {
    deviations.push({
      code: "outcome_mismatch",
      targetId: log.targetId,
      actual: log.outcome,
      predicted: predicted.outcome,
      winRate: round(summary.winRate),
      message: `Observed ${log.outcome}, but simulation predicted ${predicted.outcome}.`,
    });
  }

  const durationDeviation = compareDuration(log.seconds, summary.medianSeconds);
  if (durationDeviation) {
    deviations.push({
      code: "duration_mismatch",
      targetId: log.targetId,
      ...durationDeviation,
    });
  }

  const causeDeviation = compareCause(log.reason, summary);
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

function normalizeLogCollection(value, sourceKey) {
  const entries = unwrapLogCollection(value);
  return entries
    .map((entry, index) => normalizeLogEntry(entry, sourceKey, index))
    .filter(Boolean);
}

function unwrapLogCollection(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.logs)) return value.logs;
  if (Array.isArray(value.entries)) return value.entries;
  if (Array.isArray(value.history)) return value.history;
  if (typeof value === "object") {
    const objectValues = Object.values(value);
    if (objectValues.every((item) => item && typeof item === "object")) return objectValues;
    return [value];
  }
  return [];
}

function normalizeLogEntry(raw, sourceKey, index) {
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
  const seconds = normalizeSeconds(raw);
  const playerStats = numericObject(raw.playerStats ?? raw.player?.stats ?? raw.attackerStats);
  const targetStats = numericObject(raw.targetStats ?? raw.enemyStats ?? raw.defenderStats ?? target.stats);
  const damageBreakdown = normalizeDamageBreakdown(raw.damageBreakdown ?? raw.damage ?? raw.breakdown);

  if (!targetId && !targetName && normalizeOutcome(raw) === "unknown" && !Number.isFinite(seconds)) {
    return null;
  }

  return {
    sourceKey,
    index,
    targetId,
    targetName,
    outcome: normalizeOutcome(raw),
    seconds,
    reason: firstString(raw.reason, raw.cause, raw.deathCause, raw.resultReason, raw.outcomeReason),
    playerStats,
    targetStats,
    damageBreakdown,
    patchVersion: firstString(raw.patchVersion, raw.gameVersion, raw.version),
    raw,
  };
}

function normalizeOutcome(raw) {
  if (raw.winner != null) {
    const winner = String(raw.winner).toLowerCase();
    if (winner === "player" || winner === "attacker") return "win";
    if (winner === "enemy" || winner === "target" || winner === "defender") return "loss";
    if (winner === "timeout") return "timeout";
  }

  if (raw.won === true || raw.playerWon === true || raw.victory === true) return "win";
  if (raw.won === false || raw.playerWon === false || raw.loss === true || raw.defeat === true) return "loss";
  const text = String(raw.outcome ?? raw.result ?? raw.status ?? "").toLowerCase();
  if (!text) return "unknown";
  if (/timeout|stall/.test(text)) return "timeout";
  if (/win|victory|success|clear|player/.test(text)) return "win";
  if (/loss|lose|lost|death|defeat|enemy|player_hp_zero|fail/.test(text)) return "loss";
  return "unknown";
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
    const number = toNumber(value, NaN);
    if (Number.isFinite(number)) result[key] = number;
  }
  return result;
}

function hasStats(stats) {
  return Boolean(stats && typeof stats === "object" && Object.keys(stats).length > 0);
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
  return Object.keys(GAME_DATA_VERSIONS).sort().at(-1);
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
