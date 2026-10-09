import { runMonteCarlo } from "./combat.js";
import { createRng } from "./rng.js";
import { toNumber } from "./save.js";
import { getPreciseEraserEligibility } from "./tool-rules.js";

const SECRET_STASH_ID = "stats-hidden-upgrades";
export const SECRET_STASH_COST = 1e222;

export const SHOP_UPGRADES = {
  upgrade_hp_graphite: {
    id: "upgrade_hp_graphite",
    statName: "maxHp",
    currency: "Graphite",
    baseCost: 2,
    costMultiplier: 1.625,
    perLevel: 0.06,
  },
  upgrade_atk_graphite: {
    id: "upgrade_atk_graphite",
    statName: "attack",
    currency: "Graphite",
    baseCost: 5,
    costMultiplier: 1.5,
    perLevel: 0.05,
  },
  upgrade_spd_graphite: {
    id: "upgrade_spd_graphite",
    statName: "attackSpeed",
    currency: "Graphite",
    baseCost: 10,
    costMultiplier: 2500,
    perLevel: 0.01,
    maxLevel: 25,
  },
  upgrade_secret_burn_damage_graphite: {
    id: "upgrade_secret_burn_damage_graphite",
    statName: "burnDamage",
    currency: "Graphite",
    baseCost: 1e40,
    costMultiplier: 10,
    perLevel: 0.2,
    maxLevel: 2500,
    hidden: true,
  },
  upgrade_secret_poison_wax: {
    id: "upgrade_secret_poison_wax",
    statName: "poisonChance",
    currency: "Wax",
    baseCost: 1e80,
    costMultiplier: 12,
    perLevel: 0.005,
    maxLevel: 50,
    hidden: true,
  },
  upgrade_secret_slow_charcoal: {
    id: "upgrade_secret_slow_charcoal",
    statName: "slowChance",
    currency: "Charcoal",
    baseCost: 1e100,
    costMultiplier: 15,
    perLevel: 0.025,
    maxLevel: 50,
    hidden: true,
  },
  upgrade_secret_frailty_coffee: {
    id: "upgrade_secret_frailty_coffee",
    statName: "frailtyChance",
    currency: "Coffee",
    baseCost: 1e80,
    costMultiplier: 18,
    perLevel: 0.005,
    maxLevel: 50,
    hidden: true,
  },
  upgrade_secret_freeze_ink: {
    id: "upgrade_secret_freeze_ink",
    statName: "freezeChance",
    currency: "Ink",
    baseCost: 1e60,
    costMultiplier: 20,
    perLevel: 0.005,
    maxLevel: 50,
    hidden: true,
  },
  upgrade_secret_block_marker: {
    id: "upgrade_secret_block_marker",
    statName: "blockChance",
    currency: "Marker",
    baseCost: 1e60,
    costMultiplier: 22,
    perLevel: 0.005,
    maxLevel: 50,
    hidden: true,
  },
  upgrade_secret_haste_acrylic: {
    id: "upgrade_secret_haste_acrylic",
    statName: "hasteChance",
    currency: "Acrylic",
    baseCost: 1e50,
    costMultiplier: 25,
    perLevel: 0.005,
    maxLevel: 50,
    hidden: true,
  },
  upgrade_secret_energywave_spray: {
    id: "upgrade_secret_energywave_spray",
    statName: "energyWaveChance",
    currency: "Spray",
    baseCost: 1e40,
    costMultiplier: 28,
    perLevel: 0.005,
    maxLevel: 50,
    hidden: true,
  },
};

const MEDITATION_EXCLUDED_STATS = new Set([
  "maxHp",
  "attack",
  "attackSpeed",
  "minDamage",
  "maxDamage",
]);

export function simulateRoute({
  sketches = {},
  state = {},
  baseStats = null,
  routeIds = [],
  targetId = null,
  boostedIds = [],
  erasedIds = [],
  swapMap = {},
  meditation = null,
  buySecretStash = false,
  buyUpgrades = false,
  buyUpgradeIds = [],
  routeSeconds = 0,
  trials = 0,
  seed = "route",
  maxSeconds = 300,
} = {}) {
  const fundamentals = numericObject(state.fundamentals ?? {});
  const stats = numericObject(baseStats ?? state.runStats ?? state.battleStats ?? state.playerStats ?? {});
  const currencies = numericObject(state.currencies ?? {});
  const totalEarnedCurrencies = numericObject(state.totalEarnedCurrencies ?? {});
  const totalBattleEarnedCurrencies = numericObject(state.totalBattleEarnedCurrencies ?? {});
  const generatedCurrencies = {};
  const victories = numericObject(state.sketchVictories ?? {});
  const runVictories = numericObject(state.sketchRunVictories ?? {});
  const shopLevels = numericObject(state.shopLevels ?? {});
  const steps = [];
  const tools = {
    boostedApplied: [],
    boostedSkipped: [],
    erasedApplied: [],
    erasedSkipped: [],
    swappedApplied: [],
    swappedSkipped: [],
  };

  const secretStash = createSecretStashState({ state, buySecretStash });
  const shop = { purchased: [], skipped: [], levels: shopLevels };

  const boostedSet = applyRequestedBoosters({
    requestedIds: normalizeList(boostedIds),
    existingIds: normalizeList(state.boostedSketchIds),
    sketches,
    stats,
    currencies,
    totalEarnedCurrencies,
    totalBattleEarnedCurrencies,
    victories,
    fundamentals,
    tools,
  });

  const erasedSet = applyRequestedErasers({
    requestedIds: normalizeList(erasedIds),
    existingIds: normalizeList(state.erasedSketchIds),
    sketches,
    state,
    fundamentals,
    tools,
  });

  const meditationResult = applyMeditation({
    stats,
    sketch: meditation?.sketchId ? sketches[meditation.sketchId] : null,
    meditation,
    fundamentals,
  });

  buyAffordableUpgrades({
    enabled: buyUpgrades,
    upgradeIds: normalizeList(buyUpgradeIds),
    stats,
    currencies,
    shop,
    fundamentals,
    secretStash,
  });

  if (toNumber(routeSeconds) > 0) {
    addGeneratedCurrencies({
      seconds: toNumber(routeSeconds),
      state,
      fundamentals,
      currencies,
      totalEarnedCurrencies,
      totalBattleEarnedCurrencies,
      generatedCurrencies,
    });
  }

  const swapState = createSwapState({ existingIds: normalizeList(state.swappedSketchIds), swapMap, fundamentals });

  for (const originalId of normalizeList(routeIds)) {
    const { id, swapped } = resolveSwap({ originalId, sketches, swapState, tools });
    const sketch = sketches[id];
    if (!sketch) {
      steps.push({ originalId, id, status: "missing" });
      continue;
    }

    const totalVictoriesBefore = toNumber(victories[id]);
    const runVictoriesBefore = toNumber(runVictories[id]);
    const capVictoriesBefore = Math.max(totalVictoriesBefore, runVictoriesBefore);
    const maxVictories = toNumber(fundamentals.maxVictories, 250);
    const beyondMaxVictories = toNumber(fundamentals.beyondMaxVictories, 0);
    if (capVictoriesBefore >= maxVictories + beyondMaxVictories) {
      steps.push({
        originalId,
        id,
        name: sketch.name ?? id,
        status: "skipped_max_victories",
        swapped,
        victoriesBefore: totalVictoriesBefore,
        runVictoriesBefore,
      });
      continue;
    }

    const rewardMultiplier = createRewardMultiplier({
      victoriesBefore: totalVictoriesBefore,
      boosted: boostedSet.has(id),
      fundamentals,
    });
    const statRewards = applyRewardsToStats({ stats, rewards: sketch.rewards, multiplier: rewardMultiplier.total });
    const currencyRewards = applyCurrencyRewards({
      currencies,
      totalEarnedCurrencies,
      totalBattleEarnedCurrencies,
      rewards: sketch.currencyRewards,
      multiplier: rewardMultiplier.total,
      fundamentals,
    });

    victories[id] = totalVictoriesBefore + 1;
    runVictories[id] = runVictoriesBefore + 1;
    steps.push({
      originalId,
      id,
      name: sketch.name ?? id,
      rarity: sketch.rarity ?? "unknown",
      status: "defeated",
      swapped,
      victoriesBefore: totalVictoriesBefore,
      runVictoriesBefore,
      rewardMultiplier,
      statRewards,
      currencyRewards,
    });

    buyAffordableUpgrades({
      enabled: buyUpgrades,
      upgradeIds: normalizeList(buyUpgradeIds),
      stats,
      currencies,
      shop,
      fundamentals,
      secretStash,
    });
  }

  const target = targetId ? buildTarget({ sketches, targetId, erasedSet, tools }) : null;
  if (target && trials > 0) {
    target.simulation = runMonteCarlo({
      player: stats,
      enemy: target.stats,
      trials,
      maxSeconds,
      seed,
    });
  }

  return {
    routeIds: normalizeList(routeIds),
    finalStats: roundObject(stats),
    currencies: roundObject(currencies),
    totalEarnedCurrencies: roundObject(totalEarnedCurrencies),
    totalBattleEarnedCurrencies: roundObject(totalBattleEarnedCurrencies),
    generatedCurrencies: roundObject(generatedCurrencies),
    victories,
    runVictories,
    steps,
    tools,
    meditation: meditationResult,
    secretStash,
    shop,
    target,
  };
}

export function compareRoutes({
  sketches = {},
  state = {},
  baseStats = null,
  targetId,
  routes = [],
  trials = 1000,
  seed = "compare-routes",
  maxSeconds = 300,
  ...routeOptions
} = {}) {
  const compared = routes.map((route, index) => {
    const name = route.name ?? `route_${index + 1}`;
    const result = simulateRoute({
      sketches,
      state,
      baseStats,
      targetId,
      routeIds: route.ids ?? route.routeIds ?? [],
      trials,
      maxSeconds,
      seed: `${seed}:${name}`,
      ...routeOptions,
      boostedIds: route.boostedIds ?? routeOptions.boostedIds,
      erasedIds: route.erasedIds ?? routeOptions.erasedIds,
      swapMap: route.swapMap ?? routeOptions.swapMap,
      meditation: route.meditation ?? routeOptions.meditation,
    });
    const simulation = result.target?.simulation ?? {};
    return {
      name,
      ids: route.ids ?? route.routeIds ?? [],
      finalStats: result.finalStats,
      winRate: simulation.winRate ?? 0,
      winRateCi95: simulation.winRateCi95 ?? { halfWidth: 0, lower: 0, upper: 0 },
      timeoutRate: simulation.timeoutRate ?? 0,
      avgSeconds: simulation.avgSeconds ?? 0,
      medianSeconds: simulation.medianSeconds ?? 0,
      p10Seconds: simulation.p10Seconds ?? 0,
      p90Seconds: simulation.p90Seconds ?? 0,
      target: result.target,
      steps: result.steps,
      tools: result.tools,
      currencies: result.currencies,
    };
  });

  compared.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    const attackDelta = toNumber(b.finalStats.attack) - toNumber(a.finalStats.attack);
    if (attackDelta !== 0) return attackDelta;
    return toNumber(b.finalStats.maxHp) - toNumber(a.finalStats.maxHp);
  });

  return {
    targetId,
    trials,
    routes: compared,
  };
}

function applyRequestedBoosters({
  requestedIds,
  existingIds,
  sketches,
  stats,
  currencies,
  totalEarnedCurrencies,
  totalBattleEarnedCurrencies,
  victories,
  fundamentals,
  tools,
}) {
  const boostedSet = new Set(existingIds);
  const maxUses = 1 + toNumber(fundamentals.rewardBoosterUses);
  let uses = boostedSet.size;

  for (const id of requestedIds) {
    if (boostedSet.has(id)) {
      tools.boostedApplied.push(id);
      continue;
    }
    if (uses >= maxUses) {
      tools.boostedSkipped.push({ id, reason: "no_booster_uses" });
      continue;
    }

    boostedSet.add(id);
    uses += 1;
    tools.boostedApplied.push(id);
    applyRetroactiveBooster({
      sketch: sketches[id],
      stats,
      currencies,
      totalEarnedCurrencies,
      totalBattleEarnedCurrencies,
      victoriesBefore: toNumber(victories[id]),
      fundamentals,
    });
  }

  return boostedSet;
}

function applyRetroactiveBooster({
  sketch,
  stats,
  currencies,
  totalEarnedCurrencies,
  totalBattleEarnedCurrencies,
  victoriesBefore,
  fundamentals,
}) {
  if (!sketch || victoriesBefore <= 0 || toNumber(fundamentals.rewardBoosterRetroactive) <= 0) return;

  const boosterBonus = toNumber(fundamentals.rewardBoosterEffect, 50) / 100;
  const decay = toNumber(fundamentals.rewardDecay, 1);
  const multiplier = boosterBonus * cumulativeRewardMultiplier(0, victoriesBefore, decay);
  applyRewardsToStats({ stats, rewards: sketch.rewards, multiplier });
  applyCurrencyRewards({
    currencies,
    totalEarnedCurrencies,
    totalBattleEarnedCurrencies,
    rewards: sketch.currencyRewards,
    multiplier,
    fundamentals,
  });
}

function applyRequestedErasers({ requestedIds, existingIds, sketches, state, fundamentals, tools }) {
  const erasedSet = new Set(existingIds);
  const maxUses = 1 + toNumber(fundamentals.preciseEraserUses);
  let uses = erasedSet.size;

  for (const id of requestedIds) {
    if (erasedSet.has(id)) {
      tools.erasedApplied.push(id);
      continue;
    }
    const eligibility = getPreciseEraserEligibility(sketches?.[id], state);
    if (!eligibility.eligible) {
      tools.erasedSkipped.push({ id, reason: eligibility.reason });
      continue;
    }
    if (uses >= maxUses) {
      tools.erasedSkipped.push({ id, reason: "no_eraser_uses" });
      continue;
    }
    erasedSet.add(id);
    uses += 1;
    tools.erasedApplied.push(id);
  }

  return erasedSet;
}

function createSwapState({ existingIds, swapMap, fundamentals }) {
  return {
    swapMap: swapMap ?? {},
    swappedSet: new Set(existingIds),
    maxUses: 1 + toNumber(fundamentals.swapperUses),
    uses: existingIds.length,
  };
}

function resolveSwap({ originalId, sketches, swapState, tools }) {
  const replacementId = swapState.swapMap?.[originalId];
  if (!replacementId) return { id: originalId, swapped: null };
  if (swapState.swappedSet.has(originalId)) {
    return { id: replacementId, swapped: { from: originalId, to: replacementId, existing: true } };
  }
  if (swapState.uses >= swapState.maxUses) {
    tools.swappedSkipped.push({ from: originalId, to: replacementId, reason: "no_swapper_uses" });
    return { id: originalId, swapped: null };
  }
  if (!sketches[replacementId]) {
    tools.swappedSkipped.push({ from: originalId, to: replacementId, reason: "missing_replacement" });
    return { id: originalId, swapped: null };
  }

  swapState.swappedSet.add(originalId);
  swapState.uses += 1;
  const swapped = { from: originalId, to: replacementId };
  tools.swappedApplied.push(swapped);
  return { id: replacementId, swapped };
}

function applyMeditation({ stats, sketch, meditation, fundamentals }) {
  if (!meditation?.sketchId || !sketch) {
    return {
      applied: false,
      sketchId: meditation?.sketchId ?? null,
      appliedStats: [],
      multiplier: 1,
      cooldownSeconds: 0,
    };
  }

  const requestedStats = normalizeList(meditation.stats);
  const eligibleStats = meditationEligibleStats(sketch);
  const selectedStats = requestedStats.length > 0
    ? requestedStats.filter((statName) => eligibleStats.includes(statName))
    : pickMeditationStats({
      eligibleStats,
      count: meditation.count ?? 1,
      seed: meditation.seed ?? meditation.sketchId,
    });
  const multiplier = meditationMultiplier({ fundamentals, zone: meditation.zone });

  for (const statName of selectedStats) {
    if (statName === "attackSpeed") stats[statName] = toNumber(stats[statName]) / multiplier;
    else stats[statName] = toNumber(stats[statName]) * multiplier;
  }

  return {
    applied: selectedStats.length > 0,
    sketchId: meditation.sketchId,
    zone: meditation.zone ?? "normal",
    appliedStats: selectedStats,
    multiplier: roundNumber(multiplier),
    cooldownSeconds: roundNumber(
      toNumber(fundamentals.meditationCooldownMax, 300)
      * Math.max(0, 1 - toNumber(fundamentals.meditationCooldownReduction) / 100),
    ),
  };
}

function meditationEligibleStats(sketch) {
  return Object.keys(sketch.stats ?? {})
    .filter((statName) => !MEDITATION_EXCLUDED_STATS.has(statName))
    .sort();
}

function pickMeditationStats({ eligibleStats, count, seed }) {
  const rng = createRng(`meditation:${seed}`);
  const pool = [...eligibleStats];
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function meditationMultiplier({ fundamentals, zone }) {
  const base = 1 + toNumber(fundamentals.meditationRewardMax, 0.1);
  if (zone === "gold") return base + toNumber(fundamentals.meditationGoldZoneBonus) / 100;
  if (zone === "teal") return base + toNumber(fundamentals.meditationTealZoneBonus) / 100;
  return base;
}

function createSecretStashState({ state, buySecretStash }) {
  const skillLevels = numericObject(state.skillLevels ?? {});
  const quintessence = toNumber(state.quintessence);
  let unlocked = toNumber(skillLevels[SECRET_STASH_ID]) > 0 || Boolean(state.secretStashUnlocked);
  let spentQuintessence = 0;
  if (!unlocked && buySecretStash && quintessence >= SECRET_STASH_COST) {
    unlocked = true;
    spentQuintessence = SECRET_STASH_COST;
  }
  return {
    id: SECRET_STASH_ID,
    cost: SECRET_STASH_COST,
    quintessence,
    canAfford: quintessence >= SECRET_STASH_COST,
    unlocked,
    spentQuintessence,
    remainingQuintessence: Math.max(0, quintessence - spentQuintessence),
  };
}

function buyAffordableUpgrades({ enabled, upgradeIds, stats, currencies, shop, fundamentals, secretStash }) {
  if (!enabled || upgradeIds.length === 0) return;

  for (const id of upgradeIds) {
    const upgrade = SHOP_UPGRADES[id];
    if (!upgrade) {
      shop.skipped.push({ id, reason: "unknown_upgrade" });
      continue;
    }
    if (upgrade.hidden && !secretStash.unlocked) {
      shop.skipped.push({ id, reason: "secret_stash_locked" });
      continue;
    }

    let level = toNumber(shop.levels[id]);
    while (upgrade.maxLevel == null || level < upgrade.maxLevel) {
      const cost = upgradeCost({ upgrade, level, fundamentals });
      const currency = toNumber(currencies[upgrade.currency]);
      if (currency < cost) break;

      currencies[upgrade.currency] = currency - cost;
      applyUpgradeStat({ stats, upgrade, oldLevel: level, newLevel: level + 1 });
      level += 1;
      shop.levels[id] = level;
      shop.purchased.push({ id, level, currency: upgrade.currency, cost: roundNumber(cost) });
    }
  }
}

export function upgradeCost({ upgrade, level, fundamentals }) {
  const currencyKey = currencyFundamentalKey(upgrade.currency);
  const discount = Math.max(0, 1 - toNumber(fundamentals[`${currencyKey}UpgradeCost`]) / 100);
  return upgrade.baseCost * upgrade.costMultiplier ** level * discount;
}

function applyUpgradeStat({ stats, upgrade, oldLevel, newLevel }) {
  const oldMultiplier = 1 + upgrade.perLevel * oldLevel;
  const newMultiplier = 1 + upgrade.perLevel * newLevel;
  const current = toNumber(stats[upgrade.statName]);
  if (upgrade.statName === "attackSpeed") {
    stats[upgrade.statName] = current * (oldMultiplier / newMultiplier);
  } else {
    stats[upgrade.statName] = current * (newMultiplier / oldMultiplier);
  }
}

function addGeneratedCurrencies({
  seconds,
  state,
  fundamentals,
  currencies,
  totalEarnedCurrencies,
  totalBattleEarnedCurrencies,
  generatedCurrencies,
}) {
  const rates = numericObject(
    state.currencyGeneratorRates
      ?? state.generatorRates
      ?? state.generatorsPerSecond
      ?? {},
  );
  for (const [currency, rate] of Object.entries(rates)) {
    if (rate <= 0) continue;
    const key = currencyFundamentalKey(currency);
    const amount = rate
      * seconds
      * toNumber(fundamentals.generatorMultiplier, 1)
      * toNumber(fundamentals[`${key}GeneratorMultiplier`], 1);
    addCurrency({ bag: generatedCurrencies, name: currency, amount });
    addCurrency({ bag: currencies, name: currency, amount });
    addCurrency({ bag: totalEarnedCurrencies, name: currency, amount });
    addCurrency({ bag: totalBattleEarnedCurrencies, name: currency, amount });
  }
}

function buildTarget({ sketches, targetId, erasedSet, tools }) {
  const sketch = sketches[targetId];
  if (!sketch) return null;
  const stats = numericObject(sketch.stats ?? {});
  if (erasedSet.has(targetId)) {
    stats.maxHp = toNumber(stats.maxHp) / 2;
    if (!tools.erasedApplied.includes(targetId)) tools.erasedApplied.push(targetId);
  }
  return {
    id: targetId,
    name: sketch.name ?? targetId,
    rarity: sketch.rarity ?? "unknown",
    stats: {
      id: targetId,
      name: sketch.name ?? targetId,
      ...stats,
      immunities: sketch.immunities,
      vulnerability: sketch.vulnerability,
    },
  };
}

function createRewardMultiplier({ victoriesBefore, boosted, fundamentals }) {
  const decay = rewardDecayMultiplier({
    victoriesBefore,
    rewardDecay: toNumber(fundamentals.rewardDecay, 1),
  });
  const booster = boosted ? 1 + toNumber(fundamentals.rewardBoosterEffect, 50) / 100 : 1;
  return {
    decay: roundNumber(decay),
    booster: roundNumber(booster),
    total: roundNumber(decay * booster),
  };
}

function rewardDecayMultiplier({ victoriesBefore, rewardDecay }) {
  return 1 / (1 + victoriesBefore * rewardDecay);
}

function cumulativeRewardMultiplier(start, count, rewardDecay) {
  let total = 0;
  for (let i = 0; i < count; i += 1) total += rewardDecayMultiplier({ victoriesBefore: start + i, rewardDecay });
  return total;
}

function applyRewardsToStats({ stats, rewards = [], multiplier }) {
  const applied = [];
  for (const reward of rewards ?? []) {
    const statName = reward.statName;
    const amount = toNumber(reward.amount) * multiplier;
    const nextValue = toNumber(stats[statName]) + amount;
    stats[statName] = statName === "attackSpeed" ? nextValue : Math.max(0, nextValue);
    applied.push({ statName, amount: roundNumber(amount), finalValue: roundNumber(stats[statName]) });
  }
  return applied;
}

function applyCurrencyRewards({
  currencies,
  totalEarnedCurrencies,
  totalBattleEarnedCurrencies,
  rewards = [],
  multiplier,
  fundamentals,
}) {
  const applied = [];
  for (const reward of rewards ?? []) {
    const amount = currencyRewardAmount({
      name: reward.name,
      amount: toNumber(reward.amount) * multiplier,
      fundamentals,
    });
    addCurrency({ bag: currencies, name: reward.name, amount });
    addCurrency({ bag: totalEarnedCurrencies, name: reward.name, amount });
    addCurrency({ bag: totalBattleEarnedCurrencies, name: reward.name, amount });
    applied.push({ name: reward.name, amount: roundNumber(amount), finalValue: roundNumber(currencies[reward.name]) });
  }
  return applied;
}

export function currencyRewardAmount({ name, amount, fundamentals }) {
  const key = currencyFundamentalKey(name);
  let result = amount;
  result *= 1 + toNumber(fundamentals.rewardMultiplier) / 100;
  result *= 1 + toNumber(fundamentals[`${key}RewardMultiplier`]) / 100;
  result *= toNumber(fundamentals.featMedalMultiplier, 1);
  result *= toNumber(fundamentals[`${key}MedalMultiplier`], 1);
  result *= toNumber(fundamentals[`${key}RefinementMultiplier`], 1);
  result *= toNumber(fundamentals[`${key}ResonanceMultiplier`], 1);
  result *= toNumber(fundamentals[`${key}DegenMultiplier`], 1);
  if (name === "Gold Leaf" || name === "Photon" && toNumber(fundamentals.underdogCommissionPhoton) > 0) {
    result *= toNumber(fundamentals.underdogCommissionMultiplier, 1);
  }

  const exponent = toNumber(fundamentals[`${key}RewardExponent`]);
  if (exponent > 0 && result > 1) result **= 1 + exponent;
  return result;
}

function addCurrency({ bag, name, amount }) {
  bag[name] = toNumber(bag[name]) + amount;
}

export function currencyFundamentalKey(name) {
  const parts = String(name)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
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

function roundObject(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw)) result[key] = roundNumber(value);
  return result;
}

function roundNumber(value) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  const magnitude = Math.max(1, Math.abs(value));
  const digits = magnitude >= 1e12 ? 12 : 1e12;
  return Math.round(value * digits) / digits;
}
