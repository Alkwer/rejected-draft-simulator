import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createMonteCarloAccumulator, runMonteCarlo } from "./combat.js";
import { confidenceInterval95 } from "./combat/math.js";
import { findActiveSteamSave, toNumber } from "./save.js";
import { enemyFromSketch } from "./combat/steam-encounter.js";
import { maxSketchVictories, remainingSketchVictories } from "./victory-limit.js";

export const TARGET_ALIASES = {
  duct: "duct_taped_banana",
  banana: "duct_taped_banana",
  rose: "rose_window",
  mobius: "mobius_strip",
  moebius: "mobius_strip",
  tp: "transcendent_paragon",
  paragon: "transcendent_paragon",
};

export function resolveTargetId(value) {
  if (value == null || value === true) return null;
  const raw = String(value).trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return TARGET_ALIASES[normalized] ?? raw;
}

export function resolveSavePath(value, { downloadsDir = defaultDownloadsDir(), steamSaveDir } = {}) {
  if (value == null || value === true) return value;
  if (String(value).toLowerCase() !== "latest") return value;
  return findActiveSteamSave(steamSaveDir) ?? findLatestSaveExport(downloadsDir);
}

export function findLatestSaveExport(downloadsDir = defaultDownloadsDir()) {
  const entries = fs.readdirSync(downloadsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^rejected-draft-save-.*\.txt$/i.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(downloadsDir, entry.name);
      const stat = fs.statSync(fullPath);
      return { path: fullPath, mtimeMs: stat.mtimeMs, name: entry.name };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));

  if (entries.length === 0) {
    throw new Error(`No rejected-draft-save-*.txt files found in ${downloadsDir}.`);
  }
  return entries[0].path;
}

export function parseTrialsSetting(value, {
  defaultTrials = 5000,
  initialTrials = 400,
  maxTrials = 8000,
  targetHalfWidth = 0.02,
} = {}) {
  if (value == null || value === true || String(value).toLowerCase() === "auto") {
    return {
      mode: "auto",
      initialTrials,
      maxTrials,
      targetHalfWidth,
    };
  }

  const parsed = Number(value ?? defaultTrials);
  return {
    mode: "fixed",
    trials: Math.max(1, Math.floor(Number.isFinite(parsed) ? parsed : defaultTrials)),
  };
}

export function fixedTrialsFromSetting(setting, fallback = 5000) {
  if (!setting || setting.mode === "fixed") return setting?.trials ?? fallback;
  return setting.maxTrials ?? fallback;
}

export function runCombatSimulation({
  player,
  enemy,
  trialsSetting,
  maxSeconds = 300,
  seed = "simulation",
  assumptions = {},
}) {
  const setting = trialsSetting ?? parseTrialsSetting();
  if (setting.mode !== "auto") {
    return {
      ...runMonteCarlo({
        player,
        enemy,
        trials: setting.trials,
        maxSeconds,
        seed,
        assumptions,
      }),
      autoTrials: {
        mode: "fixed",
        stable: true,
        targetHalfWidth: null,
      },
    };
  }

  const targetHalfWidth = setting.targetHalfWidth ?? 0.02;
  const initial = Number(setting.initialTrials ?? 400);
  const limit = Number(setting.maxTrials ?? 8000);
  let trials = Math.max(1, Math.floor(Number.isFinite(initial) ? initial : 400));
  const maxTrials = Math.max(trials, Math.floor(Number.isFinite(limit) ? limit : 8000));
  let runs = 0;
  const simulation = createMonteCarloAccumulator({ player, enemy, maxSeconds, seed, assumptions });

  while (true) {
    runs += 1;
    const { halfWidth } = simulation.advanceTo(trials);
    if (halfWidth <= targetHalfWidth || trials >= maxTrials) {
      return {
        ...simulation.finish(),
        autoTrials: {
          mode: "auto",
          stable: halfWidth <= targetHalfWidth,
          targetHalfWidth,
          runs,
          maxTrials,
        },
      };
    }
    trials = Math.min(maxTrials, trials * 2);
  }
}

export function createCurrentRunReport({
  sketches = {},
  state = {},
  baseStats = {},
  trialsSetting = parseTrialsSetting(),
  maxSeconds = 300,
  seed = "current-run",
  includeHidden = false,
  assumptions = {},
} = {}) {
  const available = normalizeArray(state.availableSketches);
  const hidden = new Set(normalizeArray(state.hiddenSketches));
  const runVictories = state.sketchRunVictories ?? {};
  const maxVictories = maxSketchVictories(state);
  const skipped = {
    missing: [],
    hidden: [],
    completed: [],
  };

  const targets = [];
  for (const id of available) {
    const sketch = sketches[id];
    if (!sketch?.stats) {
      skipped.missing.push(id);
      continue;
    }
    const runVictoryCount = toNumber(runVictories[id]);
    const remainingToMax = remainingSketchVictories(state, id);
    const isHidden = hidden.has(id);
    if (remainingToMax <= 0) {
      skipped.completed.push(id);
      continue;
    }
    if (isHidden && !includeHidden) {
      skipped.hidden.push(id);
      continue;
    }

    const simulation = runCombatSimulation({
      player: baseStats,
      enemy: enemyFromSketch(sketch, id),
      trialsSetting,
      maxSeconds,
      seed: `${seed}:${id}`,
      assumptions,
    });
    targets.push({
      id,
      name: sketch.name ?? id,
      rarity: sketch.rarity ?? "unknown",
      hidden: isHidden,
      runVictories: runVictoryCount,
      remainingToMax,
      trials: simulation.trials,
      winRate: round(simulation.winRate),
      winRateCi95: simulation.winRateCi95,
      ci95HalfWidth: round(simulation.winRateCi95?.halfWidth ?? 0),
      timeoutRate: round(simulation.timeoutRate ?? 0),
      medianSeconds: round(simulation.medianSeconds ?? 0),
      medianCensored: simulation.medianCensored,
      p90Seconds: round(simulation.p90Seconds ?? 0),
      p90Censored: simulation.p90Censored,
      topFailure: topKey(simulation.defeatCauses) ?? topKey(simulation.timeoutDiagnoses),
      topVictory: topKey(simulation.victoryCauses),
      autoTrials: simulation.autoTrials,
    });
  }

  targets.sort((a, b) => b.winRate - a.winRate || rarityRank(b.rarity) - rarityRank(a.rarity) || a.id.localeCompare(b.id));

  return {
    maxVictories,
    targets,
    skipped,
    summary: {
      totalAvailable: available.length,
      simulated: targets.length,
      hiddenSkipped: skipped.hidden.length,
      completedSkipped: skipped.completed.length,
      missingSkipped: skipped.missing.length,
    },
  };
}

export function createRunRecommendation({ currentRun, targetId = null } = {}) {
  const targets = (currentRun?.targets ?? []).filter((item) => !item.hidden)
    .sort((a, b) => b.winRate - a.winRate || a.id.localeCompare(b.id));
  const target = targetId ? targets.find((item) => item.id === targetId) : null;
  const best = targets[0];
  const hideCandidates = targets
    .filter((item) => (recommendationInterval(item)?.upper ?? item.winRate) <= 0.05)
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      winRate: item.winRate,
      reason: item.topFailure ?? "low_win_rate",
    }));

  if (targets.length === 0) {
    return {
      action: "redraw",
      targetId: null,
      confidence: "medium",
      reason: "no_remaining_visible_sketches",
      hideCandidates,
    };
  }

  const favorable = (item) => (recommendationInterval(item)?.lower ?? item.winRate) >= 0.5;
  if (target && favorable(target)) {
    return {
      action: "fight_target",
      targetId: target.id,
      confidence: confidenceForEstimate(target),
      reason: "target_present_and_favorable",
      hideCandidates,
    };
  }

  const alternative = targets.find(favorable);
  if (alternative) {
    return {
      action: "finish_first",
      targetId: alternative.id,
      confidence: confidenceForEstimate(alternative),
      reason: "best_visible_sketch_has_good_odds",
      hideCandidates,
    };
  }

  const uncertain = [target, ...targets].find((row) => row && recommendationInterval(row)?.upper >= 0.5);
  if (uncertain) return {
    action: "increase_trials", targetId: uncertain.id, confidence: "low",
    reason: "win_interval_crosses_fight_threshold", hideCandidates,
  };

  if (targetId && !target) {
    return {
      action: "redraw",
      targetId: null,
      confidence: "medium",
      reason: "requested_target_not_in_visible_run",
      hideCandidates,
    };
  }

  if (best && best.winRate >= 0.15) {
    return {
      action: "farm_current_run",
      targetId: best.id,
      confidence: "low",
      reason: "best_visible_sketch_is_possible_but_risky",
      hideCandidates,
    };
  }

  return {
    action: "redraw",
    targetId: null,
    confidence: "medium",
    reason: "all_visible_sketches_have_low_odds",
    hideCandidates,
  };
}

export function formatNiceNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (number === 0) return "0";

  const abs = Math.abs(number);
  if (abs >= 1e15 || abs < 0.001) return trimExponential(number.toExponential(3));
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) return `${trimFixed(number / scale, 2)}${suffix}`;
  }
  if (abs >= 100) return trimFixed(number, 1);
  if (abs >= 10) return trimFixed(number, 2);
  if (abs >= 1) return trimFixed(number, 3);
  return trimFixed(number, 3);
}

function defaultDownloadsDir() {
  return path.join(os.homedir(), "Downloads");
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...value];
  if (value instanceof Set) return [...value];
  if (typeof value === "object") return Object.values(value);
  return [];
}

function topKey(counts = {}) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function recommendationInterval(row) {
  return row.winRateCi95 ?? (row.trials > 0 ? confidenceInterval95(row.winRate, row.trials) : null);
}

function confidenceForEstimate(row) {
  const interval = recommendationInterval(row);
  if (!interval) return "low";
  return interval.lower >= 0.85 ? "high" : "medium";
}

function rarityRank(rarity) {
  return {
    rough: 1,
    framed: 2,
    opus: 3,
    masterpiece: 4,
  }[rarity] ?? 0;
}

function trimFixed(value, decimals) {
  return Number(value.toFixed(decimals)).toString();
}

function trimExponential(value) {
  return value
    .replace(/\.?0+e/, "e")
    .replace("e+", "e");
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}
