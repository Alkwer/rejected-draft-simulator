import { runMonteCarlo } from "./combat.js";
import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { buildSteamEnemy } from "./combat/steam-encounter.js";
import { currencyFundamentalKey, generatorRates } from "./currency-generators.js";
import { applyStatReward, steamCurrencyPerkWinsRemaining, steamSketchRewards } from "./reward-amounts.js";
import { createRng } from "./rng.js";
import { normalizeStats, toNumber } from "./save.js";
import { applySteamVictoryAvailability } from "./steam-route-availability.js";
import {
  areStatUpgradesAvailable, missingUpgradeSkill, SECRET_STASH_COST, SECRET_STASH_ID, shopUpgradesForState,
  spendUpgradeCurrency, upgradeCost,
} from "./shop-upgrades.js";
import { applySteamVictoryStatChanges, createSteamStatProjection, isSteamRawStats } from "./steam-stat-projection.js";
import { boosterRestriction, getPreciseEraserEligibility, getSketchFightEligibility } from "./tool-rules.js";
import { remainingSketchVictories } from "./victory-limit.js";

export { currencyFundamentalKey, SECRET_STASH_COST, upgradeCost };

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

const PROJECTED_REMOVALS = Symbol("Sketches removed during the projected run");

function createRewardLedger(state, baseStats) {
  const stats = normalizeStats(baseStats);
  const victories = numericObject(state.sketchVictories ?? {});
  const runVictories = numericObject(state.sketchRunVictories ?? {});
  return {
    stats,
    projection: createSteamStatProjection(state, stats, { raw: isSteamRawStats(state, stats) }),
    currencies: numericObject(state.currencies ?? {}),
    totalEarnedCurrencies: numericObject(state.totalEarnedCurrencies ?? {}),
    totalBattleEarnedCurrencies: numericObject(state.totalBattleEarnedCurrencies ?? {}),
    victories,
    runVictories,
    fightState: { ...state, sketchVictories: victories, sketchRunVictories: runVictories },
    removedIds: new Set(state[PROJECTED_REMOVALS]),
    newWins: 0,
  };
}

function routeFightEligibility(ledger, sketch, id) {
  const availability = getSketchFightEligibility(sketch, ledger.fightState);
  if (sketch?.id && !availability.eligible && remainingSketchVictories(ledger.fightState, id) <= 0) {
    return { eligible: false, reason: "max_victories" };
  }
  return availability;
}

function allowsHypotheticalVictory({ ledger, id, initialAvailability, requireAvailability, afterRedraw = false }) {
  // An explicitly hypothetical win can start off the board, and a redraw can bring back a culled sketch.
  return !requireAvailability && (afterRedraw || !ledger.removedIds.has(id))
    && !initialAvailability.eligible;
}

function creditVictory({ ledger, state, sketches, id, boosted, availability, hypothetical }) {
  const sketch = sketches[id];
  const victoriesBefore = toNumber(ledger.victories[id]);
  const runVictoriesBefore = toNumber(ledger.runVictories[id]);
  if (remainingSketchVictories(state, id, victoriesBefore) <= 0) {
    return { status: "skipped_max_victories", victoriesBefore, runVictoriesBefore };
  }
  if (!availability.eligible && !hypothetical) {
    return { status: "skipped_unavailable", victoriesBefore, runVictoriesBefore };
  }
  const fundamentals = state.fundamentals ?? {};
  const steamRewards = steamSketchRewards({ state, id, sketch, victoriesBefore, boosted, newWins: ledger.newWins });
  const rewardMultiplier = createRewardMultiplier({ victoriesBefore, boosted, fundamentals, steamRewards });
  const multiplier = rewardMultiplier.total;
  const statRewards = ledger.projection
    ? [...applySteamVictoryStatChanges(ledger.projection, state, id, sketch, steamRewards.statGain)]
      .map(([statName, amount]) => ({ statName, amount: roundNumber(amount), finalValue: roundNumber(ledger.stats[statName]) }))
    : applyRewardsToStats({ stats: ledger.stats, rewards: sketch.rewards, multiplier });
  const currencyRewards = applyCurrencyRewards({ ...ledger, rewards: sketch.currencyRewards, multiplier, fundamentals, steamRewards });
  ledger.victories[id] = victoriesBefore + 1;
  ledger.runVictories[id] = runVictoriesBefore + 1;
  ledger.newWins += 1;
  const availabilityChanges = availability.eligible ? applySteamVictoryAvailability({
    state: ledger.fightState, sketches, id, victoriesBefore, runVictoriesBefore, listIds: normalizeList,
  }) : [];
  for (const change of availabilityChanges) ledger.removedIds.add(change.id);
  return { status: "defeated", rarity: sketch.rarity ?? "unknown", victoriesBefore, runVictoriesBefore,
    rewardMultiplier: roundObject(rewardMultiplier), statRewards, currencyRewards,
    ...(availabilityChanges.length && { availabilityChanges }) };
}

export function projectVictories({ state, baseStats, sketches, ids, boostedIds = [], requireAvailability = false, afterRedraw = false }) {
  const tools = { boostedApplied: [], boostedSkipped: [] };
  const appliedIds = [];
  const skippedUnavailableIds = [];
  const skippedVictories = [];
  if (!ids.length) return { state, stats: baseStats, tools, appliedIds, skippedUnavailableIds, skippedVictories };
  const ledger = createRewardLedger(state, baseStats);
  const boosters = applyRequestedBoosters({ requestedIds: boostedIds, sketches, state, ledger, tools });
  let lastReward;
  for (const id of ids) {
    if (!Object.hasOwn(sketches, id)) {
      skippedVictories.push({ id, reason: "unknown_sketch" });
      continue;
    }
    const sketch = sketches[id];
    const availability = routeFightEligibility(ledger, sketch, id);
    const hypothetical = allowsHypotheticalVictory({ ledger, id, initialAvailability: getSketchFightEligibility(sketch, state),
      requireAvailability, afterRedraw });
    lastReward = creditVictory({ ledger, state, sketches, id, boosted: boosters.has(id), availability, hypothetical });
    if (lastReward.status === "defeated") appliedIds.push(id);
    else skippedVictories.push({ id, reason: availability.reason });
    if (lastReward.status === "skipped_unavailable") skippedUnavailableIds.push(id);
  }
  const perkWins = Math.min(ledger.newWins, steamCurrencyPerkWinsRemaining(state));
  return {
    stats: ledger.stats,
    tools,
    lastReward,
    appliedIds,
    skippedUnavailableIds,
    skippedVictories,
    state: { ...ledger.fightState, ...ledger.projection?.statePatch(), ...(tools.boostedApplied.length && { boostedSketchIds: [...boosters] }),
      currencies: ledger.currencies, totalEarnedCurrencies: ledger.totalEarnedCurrencies,
      totalBattleEarnedCurrencies: ledger.totalBattleEarnedCurrencies,
      ...(ledger.removedIds.size && { [PROJECTED_REMOVALS]: [...ledger.removedIds] }),
      ...(perkWins && { currentUniverseBoostedCurrencyWins: toNumber(state.currentUniverseBoostedCurrencyWins) + perkWins }) },
  };
}

export function simulateRoute({
  sketches = {},
  state = {},
  assumptions = combatAssumptionsFromSave(state),
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
  includeStepForecasts = false,
  includeStepCombat = false,
  requireAvailability = false,
} = {}) {
  const fundamentals = numericObject(state.fundamentals ?? {});
  const savedStats = assumptions.steam ? state.playerStats : state.runStats ?? state.battleStats ?? state.playerStats;
  const ledger = createRewardLedger(state, baseStats ?? savedStats);
  const { stats, projection, currencies, totalEarnedCurrencies, totalBattleEarnedCurrencies, victories, runVictories } = ledger;
  const generatedCurrencies = {};
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

  const boostedSet = applyRequestedBoosters({ requestedIds: boostedIds, sketches, state, ledger, tools });

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
    projection,
    sketch: meditation?.sketchId ? sketches[meditation.sketchId] : null,
    meditation,
    fundamentals,
    state,
  });

  if (toNumber(routeSeconds) > 0) {
    addGeneratedCurrencies({
      seconds: toNumber(routeSeconds),
      state,
      currencies,
      totalEarnedCurrencies,
      generatedCurrencies,
    });
  }

  buyAffordableUpgrades({
    enabled: buyUpgrades,
    upgradeIds: normalizeList(buyUpgradeIds),
    stats,
    projection,
    currencies,
    shop,
    fundamentals,
    state,
    secretStash,
  });

  const swapState = createSwapState({ existingIds: normalizeList(state.swappedSketchIds), swapMap, fundamentals });
  const target = targetId ? buildTarget({ sketches, targetId, erasedSet, tools, steam: assumptions.steam }) : null;
  const targetAvailability = target ? getSketchFightEligibility(sketches[targetId], state) : null;
  const opening = includeStepCombat ? { stats: roundObject(stats), battleCurrencies: roundObject(totalBattleEarnedCurrencies) } : null;
  const forecast = () => runMonteCarlo({ player: stats, enemy: target.stats, trials, maxSeconds, seed, assumptions });
  let lastForecast;

  for (const originalId of normalizeList(routeIds)) {
    const { id, swapped } = resolveSwap({ originalId, sketches, swapState, tools });
    const sketch = sketches[id];
    const initialAvailability = getSketchFightEligibility(sketch, state);
    const availability = routeFightEligibility(ledger, sketch, id);
    const hypothetical = allowsHypotheticalVictory({ ledger, id, initialAvailability, requireAvailability });
    const fightTarget = includeStepCombat && trials > 0 && sketch?.stats
      && (availability.eligible || hypothetical)
      && remainingSketchVictories(state, id, ledger.victories[id]) > 0
      ? buildTarget({ sketches, targetId: id, erasedSet, tools, steam: assumptions.steam }) : null;
    const fightSimulation = fightTarget && runMonteCarlo({
      player: stats, enemy: fightTarget.stats, trials, maxSeconds, seed: `${seed}:step:${id}:${ledger.victories[id] ?? 0}`, assumptions,
    });
    const step = sketch
      ? { originalId, id, name: sketch.name ?? id, swapped,
        ...creditVictory({ ledger, state, sketches, id, boosted: boostedSet.has(id), availability, hypothetical }) }
      : { originalId, id, status: "missing" };
    step.availableNow = initialAvailability.eligible;
    step.availableAtStep = availability.eligible;
    step.availabilityReason = availability.reason;
    step.conditional = ledger.newWins > 0 || targetAvailability?.eligible === false;
    if (fightSimulation) step.fightSimulation = fightSimulation;
    if (step.status === "defeated") {
      buyAffordableUpgrades({ enabled: buyUpgrades, upgradeIds: normalizeList(buyUpgradeIds),
        stats, projection, currencies, shop, fundamentals, state, secretStash });
    }
    if (includeStepForecasts) {
      if (target && trials > 0 && (!lastForecast || step.status === "defeated")) lastForecast = forecast();
      step.forecast = { winRate: lastForecast?.winRate, p90Seconds: lastForecast?.p90Seconds,
        p90Censored: lastForecast?.p90Censored, finalStats: roundObject(stats), currencies: roundObject(currencies) };
    }
    steps.push(step);
  }

  if (target && trials > 0) {
    target.simulation = lastForecast ?? forecast();
  }
  if (target) {
    const finalAvailability = routeFightEligibility(ledger, sketches[targetId], targetId);
    target.availableNow = targetAvailability.eligible;
    target.availabilityReason = targetAvailability.reason;
    target.availableAfterRoute = finalAvailability.eligible;
    target.availabilityReasonAfterRoute = finalAvailability.reason;
    target.conditional = ledger.newWins > 0 || !target.availableNow;
  }

  return {
    routeIds: normalizeList(routeIds),
    conditional: ledger.newWins > 0 || Boolean(target?.conditional),
    ...(opening && { opening }),
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
      seed,
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
      avgCensored: simulation.avgCensored ?? false,
      medianSeconds: simulation.medianSeconds ?? 0,
      medianCensored: simulation.medianCensored ?? false,
      p10Seconds: simulation.p10Seconds ?? 0,
      p10Censored: simulation.p10Censored ?? false,
      p90Seconds: simulation.p90Seconds ?? 0,
      p90Censored: simulation.p90Censored ?? false,
      target: result.target,
      conditional: result.conditional,
      steps: result.steps,
      tools: result.tools,
      currencies: result.currencies,
    };
  });

  compared.sort((a, b) => {
    const reachable = Number(b.target?.availableAfterRoute === true) - Number(a.target?.availableAfterRoute === true);
    if (reachable) return reachable;
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

function applyRequestedBoosters({ requestedIds, sketches, state, ledger, tools }) {
  const fundamentals = state.fundamentals ?? {};
  const boostedSet = new Set(normalizeList(state.boostedSketchIds));
  const maxUses = 1 + toNumber(fundamentals.rewardBoosterUses);

  for (const id of new Set(normalizeList(requestedIds))) {
    if (!Object.hasOwn(sketches, id)) {
      tools.boostedSkipped.push({ id, reason: "unknown_sketch" });
      continue;
    }
    if (boostedSet.has(id)) {
      tools.boostedApplied.push(id);
      continue;
    }
    const restriction = boosterRestriction(sketches[id], state);
    if (restriction) {
      tools.boostedSkipped.push({ id, reason: restriction });
      continue;
    }
    if (boostedSet.size >= maxUses) {
      tools.boostedSkipped.push({ id, reason: "no_booster_uses" });
      continue;
    }

    boostedSet.add(id);
    tools.boostedApplied.push(id);
    applyRetroactiveBooster({
      id,
      sketch: sketches[id],
      ...ledger,
      victoriesBefore: toNumber(ledger.victories[id]),
      fundamentals,
      state,
    });
  }

  return boostedSet;
}

function applyRetroactiveBooster({
  id,
  sketch,
  stats,
  projection,
  currencies,
  totalEarnedCurrencies,
  totalBattleEarnedCurrencies,
  victoriesBefore,
  fundamentals,
  state,
}) {
  if (!sketch || victoriesBefore <= 0 || toNumber(fundamentals.rewardBoosterRetroactive) <= 0) return;

  const boosterBonus = toNumber(fundamentals.rewardBoosterEffect, 50) / 100;
  const decay = toNumber(fundamentals.rewardDecay, 1);
  const multiplier = boosterBonus * cumulativeRewardMultiplier(0, victoriesBefore, decay);
  const steamRewards = steamSketchRewards({ state, id, sketch, victoriesBefore, retroactive: true });
  applyRewardsToStats({ stats, rewards: sketch.rewards, multiplier, steamRewards, projection });
  applyCurrencyRewards({
    currencies,
    totalEarnedCurrencies,
    totalBattleEarnedCurrencies,
    rewards: sketch.currencyRewards,
    multiplier,
    fundamentals,
    steamRewards,
  });
}

function applyRequestedErasers({ requestedIds, existingIds, sketches, state, fundamentals, tools }) {
  const erasedSet = new Set(existingIds);
  const maxUses = 1 + toNumber(fundamentals.preciseEraserUses);
  let uses = erasedSet.size;

  for (const id of requestedIds) {
    if (!Object.hasOwn(sketches, id)) {
      tools.erasedSkipped.push({ id, reason: "unknown_sketch" });
      continue;
    }
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

function applyMeditation({ stats, projection, sketch, meditation, fundamentals, state }) {
  if (!meditation?.sketchId || !sketch || (
    remainingSketchVictories(state, meditation.sketchId) <= 0 && toNumber(fundamentals.beyondMaxVictories) <= 0
  )) {
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
    if (projection) projection.addMeditation(statName, multiplier);
    else if (statName === "attackSpeed") stats[statName] = toNumber(stats[statName]) / multiplier;
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

function buyAffordableUpgrades({ enabled, upgradeIds, stats, projection, currencies, shop, fundamentals, state, secretStash }) {
  if (!enabled || upgradeIds.length === 0) return;

  for (const id of upgradeIds) {
    const upgrade = shopUpgradesForState(state, SHOP_UPGRADES)[id];
    if (!upgrade) {
      shop.skipped.push({ id, reason: "unknown_upgrade" });
      continue;
    }
    if (!areStatUpgradesAvailable(state)) {
      shop.skipped.push({ id, reason: "stat_upgrades_disabled" });
      continue;
    }
    const missingSkill = missingUpgradeSkill(state, upgrade, secretStash.unlocked);
    if (missingSkill) {
      shop.skipped.push({ id, reason: missingSkill === SECRET_STASH_ID ? "secret_stash_locked" : "required_skill_locked",
        ...(missingSkill !== SECRET_STASH_ID && { requiredSkillId: missingSkill }) });
      continue;
    }

    let level = Math.max(0, Math.floor(toNumber(shop.levels[id])));
    while (upgrade.maxLevel == null || level < upgrade.maxLevel) {
      const cost = upgradeCost({ upgrade, level, fundamentals, state });
      const currency = toNumber(currencies[upgrade.currency]);
      if (!Number.isFinite(cost) || level >= Number.MAX_SAFE_INTEGER || currency < cost) break;

      if (projection) projection.buyUpgrade(upgrade, level + 1);
      else applyUpgradeStat({ stats, upgrade, oldLevel: level, newLevel: level + 1 });
      spendUpgradeCurrency(state, currencies, upgrade.currency, cost);
      level += 1;
      shop.levels[id] = level;
      shop.purchased.push({ id, level, currency: upgrade.currency, cost: roundNumber(cost) });
    }
  }
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
  currencies,
  totalEarnedCurrencies,
  generatedCurrencies,
}) {
  for (const [currency, rate] of Object.entries(generatorRates(state))) {
    const amount = rate * seconds;
    addCurrency({ bag: generatedCurrencies, name: currency, amount });
    addCurrency({ bag: currencies, name: currency, amount });
    addCurrency({ bag: totalEarnedCurrencies, name: currency, amount });
  }
}

function buildTarget({ sketches, targetId, erasedSet, tools, steam }) {
  const sketch = sketches[targetId];
  if (!sketch) return null;
  const stats = {
    id: targetId,
    name: sketch.name ?? targetId,
    ...numericObject(sketch.stats),
    immunities: sketch.immunities,
    vulnerability: sketch.vulnerability,
  };
  const erased = erasedSet.has(targetId);
  if (erased && !tools.erasedApplied.includes(targetId)) tools.erasedApplied.push(targetId);
  if (!steam && erased) stats.maxHp = toNumber(stats.maxHp) / 2;
  const encounter = steam ? buildSteamEnemy(
    { ...stats, rarity: sketch.rarity, source: "catalog" },
    { ...steam, erasedSketchIds: [...erasedSet] },
  ) : stats;
  return {
    id: targetId,
    name: sketch.name ?? targetId,
    rarity: sketch.rarity ?? "unknown",
    stats: encounter,
  };
}

function createRewardMultiplier({ victoriesBefore, boosted, fundamentals, steamRewards }) {
  const decay = steamRewards?.decay ?? rewardDecayMultiplier({
    victoriesBefore,
    rewardDecay: toNumber(fundamentals.rewardDecay, 1),
  });
  const booster = steamRewards?.booster ?? (boosted ? 1 + toNumber(fundamentals.rewardBoosterEffect, 50) / 100 : 1);
  return {
    decay,
    booster,
    total: decay * booster,
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

function applyRewardsToStats({ stats, rewards = [], multiplier, steamRewards, projection }) {
  const applied = [];
  for (const reward of rewards ?? []) {
    const statName = reward.statName;
    if (projection && (statName === "immunities" || statName === "vulnerability")) continue;
    const amount = steamRewards ? steamRewards.statGain(reward) : toNumber(reward.amount) * multiplier;
    const before = toNumber(stats[statName]);
    const effectiveGain = projection ? (amount === 0 ? 0 : projection.applyReward(statName, amount)) : amount;
    if (!projection) stats[statName] = applyStatReward(statName, before, amount);
    applied.push({ statName, amount: roundNumber(effectiveGain), finalValue: roundNumber(toNumber(stats[statName])) });
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
  steamRewards,
}) {
  const applied = [];
  for (const reward of rewards ?? []) {
    const amount = steamRewards ? steamRewards.currencyGain(reward) : currencyRewardAmount({
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
  // Values at this scale already have limited fractional precision. Multiplying
  // by a rounding factor can overflow even when the original balance is finite.
  if (Math.abs(value) >= 1e12) return value;
  return Math.round(value * 1e12) / 1e12;
}
