import { toNumber } from "./save.js";
import { getPreciseEraserEligibility } from "./tool-rules.js";

const TARGET_PROFILES = {
  duct_taped_banana: {
    id: "duct_taped_banana",
    label: "Duct-Taped Banana",
    strategy: "Bleed pressure, Leap uptime, sustain, accuracy and banana-status cleanup.",
    statWeights: {
      bleedChance: 10,
      leapChance: 8,
      accuracy: 7,
      maxHp: 5,
      regen: 4,
      lifesteal: 4,
      remedy: 3,
      armor: 2,
    },
    minimums: {
      bleedChance: 10,
      leapChance: 5,
      accuracy: 50,
      maxHpRatio: 6,
    },
    tags: ["bleed", "leap", "sustain", "accuracy", "anti_banana"],
  },
  rose_window: {
    id: "rose_window",
    label: "Rose Window",
    strategy: "Freeze control, armor/regen breaking, Remedy or Opacity handling and sustain.",
    statWeights: {
      freezeChance: 10,
      armorPen: 9,
      attack: 6,
      execute: 5,
      remedy: 4,
      maxHp: 4,
      regen: 4,
      lifesteal: 3,
      accuracy: 2,
    },
    minimums: {
      freezeChance: 10,
      armorPenRatio: 0.6,
      maxHpRatio: 5,
    },
    tags: ["freeze", "armor_pen", "regen_break", "remedy_opacity", "sustain"],
  },
  mobius_strip: {
    id: "mobius_strip",
    label: "Mobius Strip",
    strategy: "Burn scaling, anti-burn sustain, Remedy and enough Leap/defense to survive setup.",
    statWeights: {
      burnChance: 10,
      burnDamage: 10,
      remedy: 6,
      maxHp: 5,
      regen: 5,
      lifesteal: 4,
      leapChance: 4,
      armor: 3,
    },
    minimums: {
      burnChance: 10,
      burnDamage: 100,
      remedy: 10,
      maxHpRatio: 8,
    },
    tags: ["burn", "anti_burn", "remedy", "leap", "sustain"],
  },
  transcendent_paragon: {
    id: "transcendent_paragon",
    label: "Transcendent Paragon",
    strategy: "Armor penetration, execute, raw damage and sustain against armor/regen pressure.",
    statWeights: {
      armorPen: 10,
      execute: 8,
      attack: 6,
      maxHp: 5,
      regen: 4,
      lifesteal: 4,
      blockChance: 3,
      dodge: 2,
    },
    minimums: {
      armorPenRatio: 0.7,
      execute: 5,
      maxHpRatio: 6,
    },
    tags: ["armor_pen", "execute", "damage", "sustain", "regen_break"],
  },
};

const DEFAULT_PROFILE = {
  id: "default",
  label: "Generic Target",
  strategy: "Raw damage, survivability and target-specific status counters.",
  statWeights: {
    attack: 6,
    armorPen: 5,
    maxHp: 5,
    regen: 3,
    lifesteal: 3,
    accuracy: 2,
  },
  minimums: {
    maxHpRatio: 5,
  },
  tags: ["damage", "sustain"],
};

const MEDITATION_EXCLUDED_STATS = new Set(["maxHp", "attack", "attackSpeed", "minDamage", "maxDamage"]);
const GUARANTEE_RARITIES = new Set(["rough", "framed", "opus", "masterpiece"]);
const STAT_SCORE_SCALE = {
  maxHp: 0.25,
  attack: 0.35,
  armor: 0.35,
  regen: 0.5,
};

export function analyzeBuildAdvice({
  sketches = {},
  state = {},
  targetId,
  baseStats = null,
  limit = 8,
} = {}) {
  const target = sketches[targetId] ?? { id: targetId, name: targetId, stats: {} };
  const profile = getTargetProfile(targetId, target);
  const stats = numericObject(baseStats ?? state.runStats ?? state.battleStats ?? state.playerStats ?? {});
  const activeItems = getActiveRunItems({ sketches, state, targetId, profile });
  const allRanked = rankSketches({
    sketches: Object.fromEntries(Object.entries(sketches).filter(([id]) => id !== targetId)),
    profile,
    state,
  });

  return {
    targetPlan: createTargetPlan({ target, profile, stats }),
    biggestProblems: detectBuildProblems({ stats, target, profile }),
    tools: {
      guarantee: createGuaranteeAdvice({ ranked: allRanked, state, limit }),
      booster: createBoosterAdvice({ activeItems, state, limit }),
      eraser: createEraserAdvice({ target, state }),
      meditation: createMeditationAdvice({ sketches, state, targetId, profile, limit }),
    },
    activeRun: {
      finish: activeItems.filter((item) => item.score > 0).slice(0, limit),
      hide: activeItems.filter((item) => item.score < 0).slice(0, limit),
      avoid: activeItems.filter((item) => item.score === 0).slice(0, limit),
      bestNextRewards: activeItems.filter((item) => item.score > 0).slice(0, limit),
    },
  };
}

function createTargetPlan({ target, profile, stats }) {
  return {
    id: target.id,
    name: target.name ?? target.id,
    strategy: profile.strategy,
    tags: profile.tags,
    priorityStats: Object.entries(profile.statWeights)
      .sort(([, a], [, b]) => b - a)
      .map(([stat, weight]) => ({
        stat,
        weight,
        current: roundNumber(toNumber(stats[stat])),
      })),
  };
}

function getTargetProfile(targetId, target) {
  if (TARGET_PROFILES[targetId]) return TARGET_PROFILES[targetId];
  const haystack = `${targetId ?? ""} ${target?.name ?? ""}`.toLowerCase();
  if (haystack.includes("duct") || haystack.includes("banana")) return TARGET_PROFILES.duct_taped_banana;
  if (haystack.includes("rose")) return TARGET_PROFILES.rose_window;
  if (haystack.includes("mobius")) return TARGET_PROFILES.mobius_strip;
  if (haystack.includes("transcendent") || haystack.includes("paragon")) return TARGET_PROFILES.transcendent_paragon;
  return DEFAULT_PROFILE;
}

function detectBuildProblems({ stats, target, profile }) {
  const problems = [];
  const targetStats = numericObject(target.stats ?? {});
  const attack = toNumber(stats.attack);
  const targetRegen = toNumber(targetStats.regen);
  const targetHp = toNumber(targetStats.maxHp);
  const targetAttack = toNumber(targetStats.attack);
  const targetArmor = toNumber(targetStats.armor);

  if (targetRegen > 0 && attack < targetRegen * 1.5 || targetHp > 0 && attack > 0 && attack < targetHp / 200) {
    problems.push(problem("damage_low", "attack", stats.attack, Math.max(targetRegen * 1.5, targetHp / 200), "Raw damage may be too low for this target's HP/regen."));
  }
  if (targetArmor > 0 && toNumber(stats.armorPen) < targetArmor * toNumber(profile.minimums.armorPenRatio, 0.5)) {
    problems.push(problem("armor_pen_low", "armorPen", stats.armorPen, targetArmor * toNumber(profile.minimums.armorPenRatio, 0.5), "Armor penetration is behind the target's armor."));
  }
  if (targetAttack > 0 && toNumber(stats.maxHp) < targetAttack * toNumber(profile.minimums.maxHpRatio, 5)) {
    problems.push(problem("sustain_low", "maxHp", stats.maxHp, targetAttack * toNumber(profile.minimums.maxHpRatio, 5), "Effective HP/sustain is the likely survival bottleneck."));
  }

  for (const [stat, threshold] of Object.entries(profile.minimums)) {
    if (stat.endsWith("Ratio")) continue;
    if (toNumber(stats[stat]) < threshold) {
      problems.push(problem(minimumProblemCode(stat), stat, stats[stat], threshold, `${stat} is below this target profile's practical floor.`));
    }
  }

  return problems
    .map((item) => ({ ...item, severity: roundNumber(item.target <= 0 ? 1 : Math.max(0, (item.target - item.current) / item.target)) }))
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 8);
}

function problem(code, stat, current, target, message) {
  return {
    code,
    stat,
    current: roundNumber(toNumber(current)),
    target: roundNumber(toNumber(target)),
    message,
  };
}

function getActiveRunItems({ sketches, state, targetId, profile }) {
  const hidden = new Set(normalizeList(state.hiddenSketches));
  const maxVictories = toNumber(state.fundamentals?.maxVictories, 250);
  const runVictories = numericObject(state.sketchRunVictories ?? {});
  const availableIds = normalizeList(state.availableSketches);
  const ids = availableIds.length > 0
    ? availableIds
    : Object.keys(sketches);

  return rankSketches({
    sketches: Object.fromEntries(ids
      .filter((id) => id !== targetId)
      .filter((id) => !hidden.has(id))
      .filter((id) => toNumber(runVictories[id]) < maxVictories)
      .map((id) => [id, sketches[id]])
      .filter(([, sketch]) => Boolean(sketch))),
    profile,
    state,
  });
}

function rankSketches({ sketches, profile, state }) {
  return Object.values(sketches)
    .filter(Boolean)
    .map((sketch) => scoreSketch({ sketch, profile, state }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return rarityRank(b.rarity) - rarityRank(a.rarity);
    });
}

function scoreSketch({ sketch, profile, state }) {
  const reasons = [];
  let score = rarityBaseScore(sketch.rarity);
  for (const reward of sketch.rewards ?? []) {
    const statName = reward.statName;
    const weight = toNumber(profile.statWeights[statName]);
    const amount = toNumber(reward.amount);
    if (weight <= 0 || amount === 0) continue;
    const contribution = signedLogAmount(amount) * weight * toNumber(STAT_SCORE_SCALE[statName], 1);
    score += contribution;
    reasons.push(`${statName} ${formatSigned(amount)}`);
  }

  for (const reward of sketch.currencyRewards ?? []) {
    const amount = toNumber(reward.amount);
    if (amount <= 0) continue;
    score += Math.log10(1 + amount) * 0.25;
    reasons.push(`${reward.name} ${formatSigned(amount)}`);
  }

  const selected = isGuaranteedSelected({ state, id: sketch.id });
  return {
    id: sketch.id,
    name: sketch.name ?? sketch.id,
    rarity: sketch.rarity ?? "unknown",
    score: roundNumber(score),
    alreadyGuaranteed: selected,
    reasons,
  };
}

function signedLogAmount(amount) {
  const magnitude = Math.log10(1 + Math.abs(amount));
  return amount >= 0 ? magnitude : -magnitude * 1.5;
}

function createGuaranteeAdvice({ ranked, state, limit }) {
  return ranked
    .filter((item) => item.score > 0)
    .filter((item) => GUARANTEE_RARITIES.has(item.rarity))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      action: item.alreadyGuaranteed ? "keep_guaranteed" : "guarantee_if_slot_available",
    }));
}

function createBoosterAdvice({ activeItems, state, limit }) {
  const boosted = new Set(normalizeList(state.boostedSketchIds));
  const maxUses = 1 + toNumber(state.fundamentals?.rewardBoosterUses);
  const remainingUses = Math.max(0, maxUses - boosted.size);
  return activeItems
    .filter((item) => item.score > 0)
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      action: boosted.has(item.id) ? "already_boosted" : index < remainingUses ? "boost" : "save_for_later",
    }));
}

function createEraserAdvice({ target, state }) {
  const erased = new Set(normalizeList(state.erasedSketchIds));
  const maxUses = 1 + toNumber(state.fundamentals?.preciseEraserUses);
  const remainingUses = Math.max(0, maxUses - erased.size);
  const eligibility = getPreciseEraserEligibility(target, state);
  let action = "no_eraser_uses";
  let reason = "No Precise Eraser uses are currently available.";
  if (erased.has(target.id)) {
    action = "already_erased";
    reason = "Precise Eraser is already applied to the selected target.";
  } else if (!eligibility.eligible) {
    action = "not_eligible";
    reason = eligibility.message;
  } else if (remainingUses > 0) {
    action = "erase_target";
    reason = "Precise Eraser has the highest direct value on the selected target.";
  }

  return [{
    id: target.id,
    name: target.name ?? target.id,
    rarity: target.rarity ?? "unknown",
    action,
    reasonCode: eligibility.reason,
    reason,
  }];
}

function createMeditationAdvice({ sketches, state, targetId, profile, limit }) {
  const hidden = new Set(normalizeList(state.hiddenSketches));
  const ids = normalizeList(state.availableSketches).length > 0 ? normalizeList(state.availableSketches) : Object.keys(sketches);
  return ids
    .filter((id) => id !== targetId && !hidden.has(id))
    .map((id) => meditationScore({ sketch: sketches[id], profile }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function meditationScore({ sketch, profile }) {
  if (!sketch) return { id: null, score: 0, stats: [] };
  const stats = Object.keys(sketch.stats ?? {})
    .filter((stat) => !MEDITATION_EXCLUDED_STATS.has(stat))
    .filter((stat) => toNumber(profile.statWeights[stat]) > 0)
    .sort((a, b) => toNumber(profile.statWeights[b]) - toNumber(profile.statWeights[a]));
  const score = stats.reduce((sum, stat) => sum + toNumber(profile.statWeights[stat]), 0);
  return {
    id: sketch.id,
    name: sketch.name ?? sketch.id,
    rarity: sketch.rarity ?? "unknown",
    score: roundNumber(score),
    stats,
    action: "meditate_if_available",
  };
}

function isGuaranteedSelected({ state, id }) {
  return ["rough", "framed", "opus", "masterpiece"].some((rarity) => normalizeList(state.guaranteedSketchSelections?.[rarity]).includes(id));
}

function statToCode(stat) {
  return String(stat).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function minimumProblemCode(stat) {
  if (stat.endsWith("Chance")) return `${statToCode(stat.replace(/Chance$/, ""))}_low`;
  return `${statToCode(stat)}_low`;
}

function rarityBaseScore(rarity) {
  if (rarity === "masterpiece") return 0.8;
  if (rarity === "opus") return 0.5;
  if (rarity === "framed") return 0.2;
  if (rarity === "rough") return 0;
  return 0;
}

function rarityRank(rarity) {
  return { rough: 1, framed: 2, opus: 3, masterpiece: 4 }[rarity] ?? 0;
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

function formatSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${number >= 0 ? "+" : ""}${roundNumber(number)}`;
}

function roundNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}
