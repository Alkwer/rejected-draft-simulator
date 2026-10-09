import { DEFAULT_COMBAT_ASSUMPTIONS, runMonteCarlo } from "./combat.js";
import { SELF_BUFF_TO_STAT, STATUS_TO_STAT } from "./combat/statuses.js";

const STATUS_CHANCE_STATS = new Set([...Object.values(STATUS_TO_STAT), "exacerbateChance"]);
const SELF_BUFF_CHANCE_STATS = new Set(Object.values(SELF_BUFF_TO_STAT));
const CHANCE_STATS = new Set([...STATUS_CHANCE_STATS, ...SELF_BUFF_CHANCE_STATS]);
const LARGE_NUMBER_THRESHOLD = 1e9;

export function createDiagnosticReport({
  target = {},
  player = {},
  simulation = {},
  report = {},
  dataMetadata = null,
  observedOutcome = null,
  assumptionComparisons = [],
} = {}) {
  const extremes = detectExtremeStats({ target });
  const warnings = createMechanicWarnings({ target, extremes, dataMetadata });
  const why = explainResult({ simulation, report, player, target });
  const sanityChecks = createSanityChecks({ simulation, report, warnings, extremes });
  const confidence = createConfidenceBadge({ simulation, warnings, sanityChecks });
  const diagnostics = {
    confidence,
    why,
    sanityChecks,
    warnings,
    extremes,
    assumptionComparison: assumptionComparisons,
  };
  diagnostics.observation = compareObservedOutcome({ observedOutcome, simulation, diagnostics });
  return diagnostics;
}

export function detectExtremeStats({ target = {} } = {}) {
  const stats = target.stats ?? target;
  const items = [];
  for (const [statName, rawValue] of Object.entries(stats ?? {})) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    if (CHANCE_STATS.has(statName) && value > 100) {
      const interpretedChance = isExportedTarget(target) ? value * DEFAULT_COMBAT_ASSUMPTIONS.exportedEnemyStatusChanceScale : value;
      items.push({
        stat: statName,
        value,
        kind: SELF_BUFF_CHANCE_STATS.has(statName) ? "self_buff_chance" : "status_chance",
        severity: value >= 1e6 ? "critical" : value >= 1000 ? "high" : "medium",
        interpretedChance,
        interpretation: `Exported enemy chance ${formatNumber(value)} is interpreted as ${formatNumber(interpretedChance)}% per roll by the current model.`,
      });
    } else if (Math.abs(value) >= LARGE_NUMBER_THRESHOLD) {
      items.push({
        stat: statName,
        value,
        kind: "large_number",
        severity: Math.abs(value) >= 1e12 ? "critical" : "high",
        interpretedChance: null,
        interpretation: `${statName} is an extreme scalar value (${formatNumber(value)}); verify units after patches.`,
      });
    }
  }
  return items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || Math.abs(b.value) - Math.abs(a.value));
}

export function compareObservedOutcome({ observedOutcome = null, simulation = {}, diagnostics = {} } = {}) {
  const observed = normalizeObservedOutcome(observedOutcome);
  if (!observed) {
    return {
      status: "none",
      observedOutcome: null,
      code: "no_observation",
      detail: "No practical observation to compare.",
    };
  }

  const winRate = Number(simulation.winRate ?? 0);
  const timeoutRate = Number(simulation.timeoutRate ?? 0);
  const uncertainty = Number(simulation.winRateCi95?.halfWidth ?? 0);
  const mechanicsText = likelyMismatchMechanic(diagnostics);

  if (observed === "win" && winRate <= 0.15) {
    return {
      status: "mismatch",
      observedOutcome: observed,
      code: "model_underestimates",
      detail: `The simulator shows a very low chance, but practice says you win. Check this first: ${mechanicsText}.`,
    };
  }
  if (observed === "loss" && winRate >= 0.75) {
    return {
      status: "mismatch",
      observedOutcome: observed,
      code: "model_overestimates",
      detail: `The simulator shows a high chance, but practice says you lose. The most suspicious parts are: ${mechanicsText}.`,
    };
  }
  if (observed === "timeout" && timeoutRate <= 0.15) {
    return {
      status: "mismatch",
      observedOutcome: observed,
      code: "timeout_underestimated",
      detail: "In practice the fight stalls, but the model rarely times out. Check regen, armor, remedy/opacity and status scaling.",
    };
  }
  if (uncertainty >= 0.04 || winRate > 0.3 && winRate < 0.7) {
    return {
      status: "watch",
      observedOutcome: observed,
      code: "variance_or_borderline",
      detail: `The result is in the sample-variance zone or depends on a mechanic mismatch. Run more attempts and compare the fight trace; suspicious parts: ${mechanicsText}.`,
    };
  }
  return {
    status: "aligned",
    observedOutcome: observed,
    code: "observation_matches_model",
    detail: "The practical observation matches the current simulation within these simple heuristics.",
  };
}

export function createModelAssumptionComparisons({
  target = {},
  player = {},
  baseline = null,
  trials = 200,
  maxSeconds = 300,
  seed = "assumptions",
  assumptions = {},
} = {}) {
  const enemy = enemyFromTarget(target);
  const safeTrials = Math.max(1, Math.floor(Number(trials) || 200));
  const baselineAssumptions = { ...DEFAULT_COMBAT_ASSUMPTIONS, ...assumptions };
  const variants = [
    {
      id: "baseline",
      label: "Baseline",
      assumptions: baselineAssumptions,
      result: baseline,
    },
    {
      id: "enemy_status_x1",
      label: "Enemy status chance x1",
      assumptions: { ...baselineAssumptions, exportedEnemyStatusChanceScale: 1 },
    },
    {
      id: "dot_half",
      label: "DoT tick x0.5",
      assumptions: { ...baselineAssumptions, dotScale: 0.5 },
    },
    {
      id: "enemy_buff_x1",
      label: "Enemy self-buff chance x1",
      assumptions: { ...baselineAssumptions, exportedEnemyBuffChanceScale: 1 },
    },
  ];
  const baselineResult = baseline ?? runMonteCarlo({
    player,
    enemy,
    trials: safeTrials,
    maxSeconds,
    seed: `${seed}:baseline`,
    assumptions: baselineAssumptions,
  });

  return variants.map((variant) => {
    const result = variant.result ?? runMonteCarlo({
      player,
      enemy,
      trials: safeTrials,
      maxSeconds,
      seed: `${seed}:${variant.id}`,
      assumptions: variant.assumptions,
    });
    return {
      id: variant.id,
      label: variant.label,
      assumptions: variant.assumptions,
      winRate: result.winRate ?? 0,
      deltaWinRate: (result.winRate ?? 0) - (baselineResult.winRate ?? 0),
      timeoutRate: result.timeoutRate ?? 0,
      p90Seconds: result.p90Seconds ?? 0,
      problem: topProblem(result),
    };
  });
}

function explainResult({ simulation = {}, report = {}, player = {}, target = {} }) {
  const items = [];
  const failures = report.breakdowns?.failures ?? ratesFromMap(simulation.defeatCauses, simulation.trials);
  const victories = report.breakdowns?.victories ?? ratesFromMap(simulation.victoryCauses, simulation.trials);
  for (const item of failures.slice(0, 4)) {
    items.push(explainCause(item, "failure"));
  }
  if ((simulation.winRate ?? 0) > 0) {
    for (const item of victories.slice(0, 3)) {
      items.push(explainCause(item, "victory"));
    }
  }
  const thresholds = [...(report.thresholds ?? [])]
    .sort((a, b) => severityFromThreshold(b) - severityFromThreshold(a))
    .slice(0, 3);
  for (const threshold of thresholds) {
    items.push({
      code: `threshold_${threshold.stat}`,
      title: `${threshold.stat} is below practical target`,
      detail: `Current ${formatNumber(threshold.current)} vs target ${formatNumber(threshold.target)}. ${threshold.reason ?? ""}`.trim(),
      severity: severityFromThreshold(threshold),
    });
  }
  if (items.length === 0) {
    items.push({
      code: "no_dominant_cause",
      title: "No dominant cause detected",
      detail: `Win rate ${(Number(simulation.winRate ?? 0) * 100).toFixed(1)}%; inspect trace for turn-level details.`,
      severity: 0.2,
    });
  }
  if ((target.stats?.attack ?? 0) > (player.maxHp ?? 0)) {
    items.push({
      code: "sustain_check",
      title: "Incoming attack can exceed your HP pool",
      detail: "Target raw attack is above player max HP before mitigation; survivability may be the blocker.",
      severity: 0.9,
    });
  }
  return items.sort((a, b) => b.severity - a.severity).slice(0, 8);
}

function createSanityChecks({ simulation = {}, report = {}, warnings = [], extremes = [] }) {
  const checks = [];
  const winRate = Number(simulation.winRate ?? 0);
  const trials = Number(simulation.trials ?? 0);
  const ci = Number(simulation.winRateCi95?.halfWidth ?? 0);
  const topFailure = (report.breakdowns?.failures ?? ratesFromMap(simulation.defeatCauses, trials))[0];
  const topVictory = (report.breakdowns?.victories ?? ratesFromMap(simulation.victoryCauses, trials))[0];
  const hasRiskyMechanics = warnings.some((item) => item.severity !== "low") || extremes.some((item) => item.severity === "critical");

  if (winRate === 0) {
    const hardWall = trials >= 500 && ci <= 0.03 && topFailure?.rate >= 0.7;
    checks.push({
      code: "zero_win_rate",
      status: hardWall ? "hard_wall" : "suspicious",
      title: hardWall ? "0% looks like a real wall" : "0% may be suspicious",
      detail: hardWall
        ? `Dominant failure: ${topFailure.code} (${formatPercent(topFailure.rate)}).`
        : "Low sample size, extreme stats, special mechanics or missing calibration can create false 0%.",
    });
  }

  if (winRate === 1) {
    const reliable = trials >= 500 && ci <= 0.03 && !hasRiskyMechanics;
    checks.push({
      code: "full_win_rate",
      status: reliable ? "dominant" : "suspicious",
      title: reliable ? "100% looks reliable" : "100% may be suspicious",
      detail: reliable
        ? `Dominant victory: ${topVictory?.code ?? "unknown"} (${formatPercent(topVictory?.rate ?? 1)}).`
        : "Low sample size or target mechanics can create false 100%; verify with trace and real attempts.",
    });
  }

  if (checks.length === 0) {
    checks.push({
      code: "rate_range",
      status: "ok",
      title: "Win rate is not at an extreme",
      detail: "No 0%/100% sanity edge detected.",
    });
  }
  return checks;
}

function createMechanicWarnings({ target = {}, extremes = [], dataMetadata = null }) {
  const warnings = [];
  if ((target.immunities ?? []).length > 0) {
    warnings.push({
      code: "special_immunities",
      severity: "medium",
      title: "Target has immunities",
      detail: `Immunities: ${target.immunities.join(", ")}. Verify that the model maps them like the game patch.`,
    });
  }
  if (target.vulnerability) {
    warnings.push({
      code: "vulnerability_model",
      severity: "medium",
      title: "Target has vulnerability scaling",
      detail: `Vulnerability ${target.vulnerability[0]} x${target.vulnerability[1]} can depend on the source sketch/mechanic.`,
    });
  }
  if (extremes.some((item) => item.kind === "status_chance")) {
    warnings.push({
      code: "status_scaling_model",
      severity: "high",
      title: "Exported status chance scaling",
      detail: "At least one enemy status chance is above 100 and is interpreted with exported enemy scaling.",
    });
  }
  if (extremes.some((item) => item.kind === "self_buff_chance")) {
    warnings.push({
      code: "enemy_buff_scaling_model",
      severity: "high",
      title: "Exported enemy buff chance scaling",
      detail: "At least one enemy self-buff chance is above 100 and may be patch-sensitive.",
    });
  }
  if (target.stats?.opacity >= 80 || target.stats?.remedy >= 100) {
    warnings.push({
      code: "opacity_remedy_model",
      severity: "medium",
      title: "Opacity/Remedy wall possible",
      detail: "High opacity or remedy can make status-heavy builds diverge from practical attempts.",
    });
  }
  if (!dataMetadata?.gameVersion) {
    warnings.push({
      code: "unknown_game_version",
      severity: "low",
      title: "Unknown game version",
      detail: "No game version metadata was provided for this diagnostic report.",
    });
  }
  return warnings;
}

function createConfidenceBadge({ simulation = {}, warnings = [], sanityChecks = [] }) {
  let score = 1;
  const reasons = [];
  const trials = Number(simulation.trials ?? 0);
  const ci = Number(simulation.winRateCi95?.halfWidth ?? 1);
  if (trials < 200) {
    score -= 0.35;
    reasons.push("low_trials");
  } else if (trials < 1000) {
    score -= 0.15;
    reasons.push("medium_trials");
  }
  if (ci > 0.08) {
    score -= 0.35;
    reasons.push("wide_ci");
  } else if (ci > 0.03) {
    score -= 0.15;
    reasons.push("medium_ci");
  }
  const riskyWarnings = warnings.filter((item) => item.severity === "high" || item.severity === "critical");
  if (riskyWarnings.length > 0) {
    score -= Math.min(0.6, riskyWarnings.length * 0.45);
    reasons.push("uncertain_mechanics");
  }
  const mediumWarnings = warnings.filter((item) => item.severity === "medium");
  if (mediumWarnings.length > 0) {
    score -= Math.min(0.25, mediumWarnings.length * 0.08);
    reasons.push("target_specific_mechanics");
  }
  if (sanityChecks.some((item) => item.status === "suspicious")) {
    score -= 0.35;
    reasons.push("suspicious_extreme_rate");
  }
  const level = score >= 0.75 ? "high" : score >= 0.45 ? "medium" : "low";
  return {
    level,
    label: level === "high" ? "high" : level === "medium" ? "medium" : "low",
    score: Math.max(0, Math.min(1, score)),
    reasons,
  };
}

function explainCause(item, type) {
  const dictionary = {
    raw_attack: "Enemy raw attack or attack speed is killing you before your build stabilizes.",
    status_damage: "Damage-over-time or status pressure is the dominant problem.",
    regen_wall: "Enemy regeneration is outhealing your pressure.",
    armor_wall: "Enemy armor is absorbing direct damage before it matters.",
    absorb_wall: "Enemy absorb is reducing too much incoming damage.",
    dodge_accuracy_wall: "Dodge, parry, leap or low accuracy is preventing reliable pressure.",
    status_wall: "Opacity, remedy or leap is suppressing your status plan.",
    stall: "The fight is timing out without a single clearer wall.",
    raw_damage: "Your direct damage is the main win condition.",
    burn: "Burn pressure is driving wins.",
    bleed: "Bleed/status recoil is driving wins.",
    execute: "Execute is shortening the final phase.",
    thorns_counter: "Reflect, thorns or counter damage is deciding the fight.",
  };
  return {
    code: item.code,
    title: `${type === "failure" ? "Failure" : "Victory"}: ${item.code}`,
    detail: `${dictionary[item.code] ?? "This cause dominates the simulation."} Share ${formatPercent(item.rate)} (${item.count ?? 0} samples).`,
    severity: Number(item.rate ?? 0),
  };
}

function ratesFromMap(map = {}, trials = 1) {
  return Object.entries(map ?? {})
    .map(([code, count]) => ({ code, count, rate: Number(count) / Math.max(1, Number(trials) || 1) }))
    .sort((a, b) => b.count - a.count);
}

function severityFromThreshold(item = {}) {
  const current = Math.max(0, Number(item.current ?? 0));
  const target = Math.max(0, Number(item.target ?? 0));
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - current / target));
}

function topProblem(result = {}) {
  const failures = ratesFromMap(result.defeatCauses, result.trials);
  if (failures.length > 0) return failures[0].code;
  const timeouts = ratesFromMap(result.timeoutDiagnoses, result.trials);
  if (timeouts.length > 0) return timeouts[0].code;
  return "none";
}

function enemyFromTarget(target = {}) {
  return {
    id: target.id,
    name: target.name,
    ...(target.stats ?? {}),
    immunities: target.immunities,
    vulnerability: target.vulnerability,
  };
}

function likelyMismatchMechanic(diagnostics = {}) {
  const warningCodes = (diagnostics.warnings ?? []).map((item) => item.code);
  if (warningCodes.some((code) => code.includes("status") || code.includes("buff"))) return "status scaling / buff scaling";
  if (warningCodes.includes("opacity_remedy_model")) return "remedy, opacity or status wall";
  if ((diagnostics.extremes ?? []).length > 0) return "status scaling / mechanics / extreme stat units after patch";
  return "sample variance / mechanic mismatch / stale data";
}

function normalizeObservedOutcome(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["win", "wins"].includes(text)) return "win";
  if (["loss", "lose"].includes(text)) return "loss";
  if (["timeout", "stall"].includes(text)) return "timeout";
  return null;
}

function isExportedTarget(target = {}) {
  return target.id != null && target.id !== "player";
}

function severityRank(severity) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity] ?? 0;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0.0%";
  return `${(number * 100).toFixed(1)}%`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (Math.abs(number) >= 1e9 || Math.abs(number) < 0.001 && number !== 0) return number.toExponential(2);
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
  return `${Math.round(number * 1000) / 1000}`;
}
