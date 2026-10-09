import { toNumber } from "./save.js";

const TARGET_THRESHOLD_PROFILES = {
  duct_taped_banana: [
    { stat: "bleedChance", target: 10, reason: "Bleed gives Duct pressure while direct damage is still low." },
    { stat: "leapChance", target: 5, reason: "Leap uptime helps reduce incoming status pressure." },
    { stat: "accuracy", target: 50, reason: "Accuracy reduces dodge/parry stalls and banana-related misses." },
  ],
  rose_window: [
    { stat: "freezeChance", target: 10, reason: "Freeze buys time against Rose's sustain." },
    { stat: "armorPenRatio", target: 0.6, reason: "Rose commonly turns into an armor wall without penetration." },
  ],
  mobius_strip: [
    { stat: "burnChance", target: 10, reason: "Mobius is primarily a burn-scaling target." },
    { stat: "burnDamage", target: 100, reason: "Burn chance without burn damage is slow against Mobius." },
    { stat: "remedy", target: 10, reason: "Remedy helps stabilize against burn and other status pressure." },
  ],
  transcendent_paragon: [
    { stat: "armorPenRatio", target: 0.7, reason: "Transcendent Paragon punishes low armor penetration." },
    { stat: "execute", target: 5, reason: "Execute shortens the last phase after armor/regen pressure." },
  ],
};

export function createCombatReport({
  target,
  player = {},
  simulation,
  label = null,
} = {}) {
  const trials = toNumber(simulation?.trials);
  const winRate = simulation?.winRate ?? safeRate(simulation?.wins, trials);
  const ci = simulation?.winRateCi95 ?? confidenceInterval95(winRate, trials);
  const explanation = explainTarget({ target, player });

  return {
    label,
    target: {
      id: target?.id ?? null,
      name: target?.name ?? target?.id ?? "unknown",
    },
    trials,
    winRate: {
      value: round(winRate),
      percent: round(winRate * 100),
      ci95Lower: round(ci.lower ?? 0),
      ci95Upper: round(ci.upper ?? 0),
      ci95HalfWidth: round(ci.halfWidth ?? 0),
      ci95HalfWidthPercent: round((ci.halfWidth ?? 0) * 100),
    },
    outcomes: {
      wins: toNumber(simulation?.wins),
      losses: toNumber(simulation?.losses),
      timeouts: toNumber(simulation?.timeouts),
    },
    time: {
      averageSeconds: round(toNumber(simulation?.avgSeconds)),
      medianSeconds: round(toNumber(simulation?.medianSeconds)),
      p10Seconds: round(toNumber(simulation?.p10Seconds)),
      p90Seconds: round(toNumber(simulation?.p90Seconds)),
      timeoutRate: round(simulation?.timeoutRate ?? safeRate(simulation?.timeouts, trials)),
    },
    breakdowns: {
      victories: entriesToRates(simulation?.victoryCauses ?? {}, trials),
      failures: entriesToRates(simulation?.defeatCauses ?? simulation?.timeoutDiagnoses ?? {}, trials),
    },
    thresholds: explanation.thresholds,
    interactions: explanation.interactions,
  };
}

export function explainTarget({ target = {}, player = {} } = {}) {
  const targetStats = numericObject(target.stats ?? target);
  const playerStats = numericObject(player);
  const id = target.id ?? "";
  const name = target.name ?? id;
  const key = targetProfileKey({ id, name });
  const interactions = [];

  if (toNumber(targetStats.attack) > 0) {
    interactions.push({
      code: "raw_attack",
      title: "Raw attack pressure",
      detail: "If max HP and sustain are too low, the fight fails before scaling tools matter.",
    });
  }
  if (toNumber(targetStats.burnChance) > 0 || toNumber(targetStats.burnDamage) > 0 || key === "mobius_strip") {
    interactions.push({
      code: "burn_pressure",
      title: "Burn pressure",
      detail: "Burn bypasses simple armor checks and forces HP, regen, lifesteal or Remedy to keep up.",
    });
  }
  if (toNumber(targetStats.regen) > 0) {
    interactions.push({
      code: "regen_wall",
      title: "Regen wall",
      detail: "Damage per second must beat regen with enough margin before timeout.",
    });
  }
  if (toNumber(targetStats.armor) > 0) {
    interactions.push({
      code: "armor_wall",
      title: "Armor wall",
      detail: "Armor penetration has direct value when target armor is near or above your hit damage.",
    });
  }
  if (toNumber(targetStats.remedy) > 0) {
    interactions.push({
      code: "remedy_status_clear",
      title: "Remedy clears status pressure",
      detail: "Bleed, burn, freeze and other status plans need enough stacks to survive Remedy clears.",
    });
  }
  if (toNumber(targetStats.opacity) > 0) {
    interactions.push({
      code: "opacity_status_resist",
      title: "Opacity reduces status application",
      detail: "Status chance has less practical value unless the plan also handles Opacity.",
    });
  }
  if (key === "duct_taped_banana" || toNumber(targetStats.bananaPeelChance) > 0) {
    interactions.push({
      code: "banana_peel",
      title: "Banana Peel can waste attacks",
      detail: "Accuracy, Leap uptime and sustain reduce the chance that slips spiral into a loss.",
    });
  }

  return {
    target: { id, name },
    thresholds: createThresholds({ key, targetStats, playerStats }),
    interactions,
  };
}

export function exportMarkdownReport(report) {
  const lines = [];
  lines.push(`# Combat Report: ${report.target.name}`);
  if (report.label) lines.push(``);
  if (report.label) lines.push(`Label: ${report.label}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Trials: ${report.trials}`);
  lines.push(`- Win rate: ${formatPercent(report.winRate.value)} +/- ${formatPercent(report.winRate.ci95HalfWidth)} (95% CI)`);
  lines.push(`- Wins / losses / timeouts: ${report.outcomes.wins} / ${report.outcomes.losses} / ${report.outcomes.timeouts}`);
  lines.push(`- Average / median fight: ${formatSeconds(report.time.averageSeconds)} / ${formatSeconds(report.time.medianSeconds)}`);
  lines.push(`- p10 / p90: ${formatSeconds(report.time.p10Seconds)} / ${formatSeconds(report.time.p90Seconds)}`);
  lines.push(`- Timeout rate: ${formatPercent(report.time.timeoutRate)}`);
  lines.push("");
  lines.push("## Victory Breakdown");
  lines.push(...breakdownLines(report.breakdowns.victories));
  lines.push("");
  lines.push("## Failure Breakdown");
  lines.push(...breakdownLines(report.breakdowns.failures));
  lines.push("");
  lines.push("## Stat Thresholds");
  lines.push(...thresholdLines(report.thresholds));
  lines.push("");
  lines.push("## Target Interactions");
  lines.push(...interactionLines(report.interactions));
  return `${lines.join("\n")}\n`;
}

function createThresholds({ key, targetStats, playerStats }) {
  const thresholds = [];
  const targetAttack = toNumber(targetStats.attack);
  const burnPressure = toNumber(targetStats.burnDamage);
  const targetHp = toNumber(targetStats.maxHp);
  const targetRegen = toNumber(targetStats.regen);
  const targetArmor = toNumber(targetStats.armor);

  const hpPressure = Math.max(targetAttack, burnPressure);
  if (hpPressure > 0) {
    thresholds.push({
      stat: "maxHp",
      target: round(hpPressure * targetMaxHpRatio(key)),
      current: round(toNumber(playerStats.maxHp)),
      reason: "Survive enough hits for status/control tools to matter.",
    });
  }
  if (targetHp > 0 || targetRegen > 0) {
    thresholds.push({
      stat: "damagePerSecond",
      target: round(Math.max(targetRegen * 1.5, targetHp / 300)),
      current: round(toNumber(playerStats.attack) / Math.max(0.05, toNumber(playerStats.attackSpeed, 1000) / 1000)),
      reason: "Beat HP and regen before the timeout window.",
    });
  }
  if (targetArmor > 0) {
    thresholds.push({
      stat: "armorPen",
      target: round(targetArmor * armorPenRatio(key)),
      current: round(toNumber(playerStats.armorPen)),
      reason: "Avoid direct damage collapsing into an armor wall.",
    });
  }

  for (const item of TARGET_THRESHOLD_PROFILES[key] ?? []) {
    if (item.stat === "armorPenRatio") {
      thresholds.push({
        stat: "armorPen",
        target: round(targetArmor * item.target),
        current: round(toNumber(playerStats.armorPen)),
        reason: item.reason,
      });
    } else {
      thresholds.push({
        stat: item.stat,
        target: item.target,
        current: round(toNumber(playerStats[item.stat])),
        reason: item.reason,
      });
    }
  }

  return dedupeThresholds(thresholds);
}

function targetProfileKey({ id, name }) {
  const text = `${id} ${name}`.toLowerCase();
  if (text.includes("duct") || text.includes("banana")) return "duct_taped_banana";
  if (text.includes("rose")) return "rose_window";
  if (text.includes("mobius")) return "mobius_strip";
  if (text.includes("transcendent") || text.includes("paragon")) return "transcendent_paragon";
  return "generic";
}

function targetMaxHpRatio(key) {
  if (key === "mobius_strip") return 8;
  if (key === "rose_window") return 5;
  return 6;
}

function armorPenRatio(key) {
  if (key === "transcendent_paragon") return 0.7;
  return 0.6;
}

function dedupeThresholds(thresholds) {
  const byKey = new Map();
  for (const threshold of thresholds) {
    const existing = byKey.get(threshold.stat);
    if (!existing || threshold.target > existing.target) byKey.set(threshold.stat, threshold);
  }
  return [...byKey.values()];
}

function entriesToRates(entries = {}, trials = 0) {
  const safeTrials = Math.max(1, trials);
  return Object.entries(entries)
    .map(([code, count]) => ({ code, count: toNumber(count), rate: round(toNumber(count) / safeTrials) }))
    .sort((a, b) => b.count - a.count);
}

function breakdownLines(items) {
  if (!items || items.length === 0) return ["- none"];
  return items.map((item) => `- ${item.code}: ${item.count} (${formatPercent(item.rate)})`);
}

function thresholdLines(items) {
  if (!items || items.length === 0) return ["- none"];
  return items.map((item) => `- ${item.stat}: current ${formatNumber(item.current)} / target ${formatNumber(item.target)} - ${item.reason}`);
}

function interactionLines(items) {
  if (!items || items.length === 0) return ["- none"];
  return items.map((item) => `- ${item.title}: ${item.detail}`);
}

function confidenceInterval95(rate, trials) {
  if (trials <= 0) return { lower: 0, upper: 0, halfWidth: 0 };
  const z = 1.96;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (rate + z2 / (2 * trials)) / denominator;
  const halfWidth = z * Math.sqrt((rate * (1 - rate) + z2 / (4 * trials)) / trials) / denominator;
  return {
    lower: clamp(center - halfWidth, 0, 1),
    upper: clamp(center + halfWidth, 0, 1),
    halfWidth,
  };
}

function safeRate(count, total) {
  const denominator = toNumber(total);
  return denominator > 0 ? toNumber(count) / denominator : 0;
}

function numericObject(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw ?? {})) result[key] = toNumber(value);
  return result;
}

function formatPercent(value) {
  return `${(toNumber(value) * 100).toFixed(2)}%`;
}

function formatSeconds(value) {
  return `${toNumber(value).toFixed(2)}s`;
}

function formatNumber(value) {
  const number = toNumber(value);
  if (Math.abs(number) >= 1e6 || Math.abs(number) < 0.001 && number !== 0) return number.toExponential(3);
  return String(Math.round(number * 1000) / 1000);
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
