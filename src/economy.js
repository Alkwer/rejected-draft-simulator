import {
  currencyFundamentalKey,
  SECRET_STASH_COST,
  SHOP_UPGRADES,
  upgradeCost,
} from "./route.js";
import { toNumber } from "./save.js";

const SPECIAL_CURRENCIES = ["Photon", "Gold Leaf"];
const DEFAULT_FARM_SECONDS = 3600;

const DEFAULT_STAT_WEIGHTS = {
  maxHp: 0.8,
  attack: 2.2,
  attackSpeed: 2,
  minDamage: 1.2,
  maxDamage: 1.2,
  armor: 1,
  armorPen: 2,
  regen: 1,
  accuracy: 1.6,
  burnDamage: 2.4,
  poisonChance: 1.6,
  slowChance: 1.4,
  frailtyChance: 1.8,
  freezeChance: 2,
  blockChance: 1.5,
  hasteChance: 1.6,
  energyWaveChance: 1.5,
};

export function createEconomyPlan({
  state = {},
  sketches = {},
  currentRows = [],
  targetStatWeights = {},
  rewardWeights = {},
  goalCurrencies = {},
  goalQuintessence = null,
  farmSeconds = DEFAULT_FARM_SECONDS,
  softcap = null,
  softcapSeconds = null,
  runEV = null,
  profile = null,
} = {}) {
  const windowSeconds = Math.max(1, toNumber(farmSeconds, DEFAULT_FARM_SECONDS));
  const stats = numericObject(state.currentRunStats ?? state.battleStats ?? state.playerStats ?? {});
  const currencies = numericObject(state.currencies ?? {});
  const shopUpgrades = analyzeShopUpgrades({
    state,
    stats,
    currencies,
    targetStatWeights,
    rewardWeights,
  });
  const purchasePlan = createPurchasePlan(shopUpgrades);
  const generatorEV = createGeneratorEV({ state, windowSeconds });
  const effectiveSoftcapSeconds = softcap?.secondsToSoftcap ?? softcapSeconds ?? detectSoftcapSeconds(state);
  const softcapEV = createSoftcapEV({
    state,
    seconds: effectiveSoftcapSeconds,
    runEV,
    softcap,
  });
  const secretStash = createSecretStashEV({
    state,
    shopUpgrades,
    generatorEV,
    profile,
  });
  const specialCurrencies = createSpecialCurrencyModels({
    state,
    goalCurrencies,
    runEV,
    generatorEV,
  });
  const currencyForecasts = createCurrencyForecasts({
    state,
    goalCurrencies,
    runEV,
    generatorEV,
  });
  const wastedRewards = detectWastedRewards({
    sketches,
    currentRows,
    targetStatWeights,
    goalCurrencies,
  });
  const bottlenecks = detectCurrencyBottlenecks({
    state,
    goalCurrencies,
    shopUpgrades,
    generatorEV,
    runEV,
    specialCurrencies,
    goalQuintessence,
  });

  return {
    shopUpgrades,
    purchasePlan,
    softcapEV,
    generatorEV,
    secretStash,
    specialCurrencies,
    currencyForecasts,
    wastedRewards,
    bottlenecks,
  };
}

function analyzeShopUpgrades({ state, stats, currencies, targetStatWeights, rewardWeights }) {
  const fundamentals = state.fundamentals ?? {};
  const shopLevels = numericObject(state.shopLevels ?? {});
  const secretStashUnlocked = isSecretStashUnlocked(state);
  return Object.values(SHOP_UPGRADES)
    .map((upgrade) => {
      const level = Math.max(0, Math.floor(toNumber(shopLevels[upgrade.id])));
      const capped = upgrade.maxLevel != null && level >= upgrade.maxLevel;
      const hiddenLocked = Boolean(upgrade.hidden) && !secretStashUnlocked;
      const cost = capped ? null : upgradeCost({ upgrade, level, fundamentals });
      const currentCurrency = toNumber(currencies[upgrade.currency]);
      const affordable = cost != null && currentCurrency >= cost && !hiddenLocked && !capped;
      const statWeight = statUpgradeWeight({ statName: upgrade.statName, targetStatWeights, rewardWeights });
      const marginalEffect = capped ? 0 : marginalUpgradeEffect({ upgrade, level });
      const marginalStatGain = marginalUpgradeStatGain({ stats, upgrade, marginalEffect });
      const score = statWeight * Math.max(0, marginalEffect.percent);
      const roi = cost > 0 ? score / Math.log10(10 + cost) : 0;
      const recommendation = capped
        ? "capped"
        : hiddenLocked
          ? "locked_secret_stash"
          : affordable && roi >= 0.15
            ? "buy_now"
            : currentCurrency < toNumber(cost)
              ? "delay_until_currency"
              : "low_roi";
      return {
        id: upgrade.id,
        statName: upgrade.statName,
        currency: upgrade.currency,
        level,
        nextLevel: capped ? null : level + 1,
        maxLevel: upgrade.maxLevel ?? null,
        cost: cost == null ? null : roundNumber(cost),
        currentCurrency: roundNumber(currentCurrency),
        affordable,
        hidden: Boolean(upgrade.hidden),
        hiddenLocked,
        capped,
        marginalEffect,
        marginalStatGain: roundNumber(marginalStatGain),
        score: roundNumber(score),
        roi: roundNumber(roi),
        recommendation,
      };
    })
    .sort((a, b) => {
      const recommendationRank = { buy_now: 4, delay_until_currency: 3, locked_secret_stash: 2, low_roi: 1, capped: 0 };
      return (recommendationRank[b.recommendation] ?? 0) - (recommendationRank[a.recommendation] ?? 0)
        || toNumber(b.roi) - toNumber(a.roi)
        || String(a.id).localeCompare(String(b.id));
    });
}

function createPurchasePlan(shopUpgrades) {
  const buyNow = shopUpgrades.filter((item) => item.recommendation === "buy_now");
  const delay = shopUpgrades.filter((item) => item.recommendation === "delay_until_currency");
  const locked = shopUpgrades.filter((item) => item.recommendation === "locked_secret_stash");
  const capped = shopUpgrades.filter((item) => item.recommendation === "capped");
  return {
    decision: buyNow.length > 0 ? "buy_now" : delay.length > 0 ? "delay_until_currency" : locked.length > 0 ? "unlock_secret_stash" : "no_purchase",
    buyNow: buyNow.slice(0, 8),
    delay: delay.slice(0, 8),
    locked: locked.slice(0, 8),
    capped: capped.slice(0, 8),
  };
}

function createGeneratorEV({ state, windowSeconds }) {
  const raw = numericObject(state.currencyGeneratorRates ?? state.generatorRates ?? state.generatorsPerSecond ?? {});
  const fundamentals = state.fundamentals ?? {};
  const currencies = {};
  for (const [currency, baseRate] of Object.entries(raw)) {
    const key = currencyFundamentalKey(currency);
    const globalMultiplier = toNumber(fundamentals.generatorMultiplier, 1);
    const currencyMultiplier = toNumber(fundamentals[`${key}GeneratorMultiplier`], 1);
    const multiplier = globalMultiplier * currencyMultiplier;
    const perSecond = baseRate * multiplier;
    currencies[currency] = {
      baseRate: roundNumber(baseRate),
      multiplier: roundNumber(multiplier),
      perSecond: roundNumber(perSecond),
      windowExpected: roundNumber(perSecond * windowSeconds),
    };
  }
  return {
    windowSeconds,
    currencies,
    totalPerSecondValue: roundNumber(Object.values(currencies).reduce((sum, item) => sum + logValue(item.perSecond), 0)),
  };
}

function createSoftcapEV({ state, seconds, runEV, softcap }) {
  if (seconds == null || !Number.isFinite(toNumber(seconds))) {
    return {
      decision: softcap?.decision ?? "unknown",
      reason: softcap?.reason ?? "softcap_time_missing",
      secondsToSoftcap: null,
      waitQuintessence: null,
      waitCurrencies: {},
      waitValue: softcap?.waitValue ?? null,
      runValue: runEV?.totalValue ?? softcap?.runValue ?? null,
    };
  }
  const waitSeconds = Math.max(0, toNumber(seconds));
  const generator = createGeneratorEV({ state, windowSeconds: waitSeconds });
  const waitCurrencies = Object.fromEntries(Object.entries(generator.currencies).map(([currency, item]) => [currency, {
    expected: roundNumber(item.windowExpected),
    perSecond: item.perSecond,
  }]));
  const qRate = quintessencePerSecond(state);
  const waitQuintessence = qRate * waitSeconds;
  const waitValue = logValue(waitQuintessence)
    + Object.values(waitCurrencies).reduce((sum, item) => sum + logValue(item.expected), 0);
  const runValue = runEV?.totalValue ?? softcap?.runValue ?? 0;
  return {
    decision: softcap?.decision ?? (waitValue >= runValue ? "wait_softcap" : "finish_current_run"),
    reason: softcap?.reason ?? (waitValue >= runValue ? "wait_value_beats_run" : "run_value_beats_wait"),
    secondsToSoftcap: roundNumber(waitSeconds),
    waitQuintessence: roundNumber(waitQuintessence),
    waitCurrencies,
    waitValue: roundNumber(waitValue),
    runValue: roundNumber(runValue),
  };
}

function createSecretStashEV({ state, shopUpgrades, generatorEV, profile }) {
  const unlocked = isSecretStashUnlocked(state);
  const quintessence = toNumber(state.quintessence);
  const missing = Math.max(0, SECRET_STASH_COST - quintessence);
  const hiddenUpgrades = shopUpgrades
    .filter((item) => item.hidden)
    .map((item) => ({
      ...item,
      materiality: secretUpgradeMateriality({ item, profile, generatorEV }),
    }))
    .sort((a, b) => materialityRank(b.materiality) - materialityRank(a.materiality) || toNumber(b.roi) - toNumber(a.roi));
  const qps = quintessencePerSecond(state);
  return {
    cost: SECRET_STASH_COST,
    currentQuintessence: roundNumber(quintessence),
    missingQuintessence: roundNumber(missing),
    unlocked,
    canUnlock: unlocked || quintessence >= SECRET_STASH_COST,
    paybackSeconds: missing <= 0 ? 0 : secondsToGoal(missing, qps),
    hiddenUpgrades,
    materialUpgrades: hiddenUpgrades.filter((item) => item.materiality !== "low").slice(0, 5),
  };
}

function createSpecialCurrencyModels({ state, goalCurrencies, runEV, generatorEV }) {
  const result = {};
  for (const currency of SPECIAL_CURRENCIES) {
    const current = toNumber(state.currencies?.[currency]);
    const goal = toNumber(goalCurrencies?.[currency]);
    const perSecond = combinedCurrencyPerSecond({ currency, runEV, generatorEV });
    const expectedPerRun = toNumber(runEV?.currencies?.[currency]?.expected);
    const missing = goal > 0 ? Math.max(0, goal - current) : 0;
    result[currency] = {
      current: roundNumber(current),
      goal: goal > 0 ? roundNumber(goal) : null,
      missing: roundNumber(missing),
      generatorPerSecond: roundNumber(toNumber(generatorEV.currencies?.[currency]?.perSecond)),
      runPerSecond: roundNumber(toNumber(runEV?.currencies?.[currency]?.perSecond)),
      perSecond: roundNumber(perSecond),
      expectedPerRun: roundNumber(expectedPerRun),
      secondsToGoal: missing > 0 ? secondsToGoal(missing, perSecond) : 0,
      runsToGoal: missing > 0 && expectedPerRun > 0 ? roundNumber(missing / expectedPerRun) : missing > 0 ? null : 0,
      model: currency === "Photon" ? "late_game_milestone_currency" : "rare_milestone_currency",
    };
  }
  return result;
}

function createCurrencyForecasts({ state, goalCurrencies, runEV, generatorEV }) {
  const currencies = new Set([
    ...Object.keys(goalCurrencies ?? {}),
    ...SPECIAL_CURRENCIES,
  ]);
  return [...currencies]
    .map((currency) => {
      const current = toNumber(state.currencies?.[currency]);
      const explicitGoal = toNumber(goalCurrencies?.[currency]);
      const goal = explicitGoal > 0 ? explicitGoal : current > 0 ? current * 10 : 0;
      const missing = Math.max(0, goal - current);
      const perSecond = combinedCurrencyPerSecond({ currency, runEV, generatorEV });
      const expectedPerRun = toNumber(runEV?.currencies?.[currency]?.expected);
      return {
        currency,
        current: roundNumber(current),
        goal: goal > 0 ? roundNumber(goal) : null,
        missing: roundNumber(missing),
        perSecond: roundNumber(perSecond),
        expectedPerRun: roundNumber(expectedPerRun),
        secondsToGoal: missing > 0 ? secondsToGoal(missing, perSecond) : 0,
        runsToGoal: missing > 0 && expectedPerRun > 0 ? roundNumber(missing / expectedPerRun) : missing > 0 ? null : 0,
      };
    })
    .filter((item) => item.goal != null || item.perSecond > 0 || item.expectedPerRun > 0)
    .sort((a, b) => {
      if (a.secondsToGoal == null && b.secondsToGoal != null) return 1;
      if (a.secondsToGoal != null && b.secondsToGoal == null) return -1;
      return toNumber(b.missing) - toNumber(a.missing) || String(a.currency).localeCompare(String(b.currency));
    });
}

function detectWastedRewards({ sketches, currentRows, targetStatWeights, goalCurrencies }) {
  const wasted = [];
  const rows = currentRows.length > 0 ? currentRows : Object.values(sketches).map((sketch) => ({ id: sketch.id, winRate: 0 }));
  for (const row of rows) {
    if (row.hidden) continue;
    const sketch = sketches[row.id];
    if (!sketch) continue;
    for (const reward of sketch.rewards ?? []) {
      const amount = toNumber(reward.amount);
      const statWeight = toNumber(targetStatWeights[reward.statName], DEFAULT_STAT_WEIGHTS[reward.statName] ?? 0.25);
      if (amount <= 0) {
        wasted.push(wastedReward(row, "zero_or_negative_reward", `${reward.statName} ${roundNumber(amount)}`));
      } else if (statWeight <= 0.05) {
        wasted.push(wastedReward(row, "low_marginal_stat", reward.statName));
      }
    }
    for (const reward of sketch.currencyRewards ?? []) {
      const amount = toNumber(reward.amount);
      const goal = toNumber(goalCurrencies?.[reward.name]);
      if (amount <= 0) {
        wasted.push(wastedReward(row, "zero_or_negative_reward", `${reward.name} ${roundNumber(amount)}`));
      } else if (goal <= 0 && amount < 1) {
        wasted.push(wastedReward(row, "tiny_non_goal_currency", reward.name));
      }
    }
  }
  return uniqueBy(wasted, (item) => `${item.id}:${item.reason}:${item.detail}`).slice(0, 12);
}

function detectCurrencyBottlenecks({ state, goalCurrencies, shopUpgrades, generatorEV, runEV, specialCurrencies, goalQuintessence }) {
  const bottlenecks = [];
  const currencies = numericObject(state.currencies ?? {});
  for (const [currency, goal] of Object.entries(goalCurrencies ?? {})) {
    const current = toNumber(currencies[currency]);
    const missing = Math.max(0, toNumber(goal) - current);
    if (missing <= 0) continue;
    const perSecond = combinedCurrencyPerSecond({ currency, runEV, generatorEV });
    bottlenecks.push({
      type: "currency_goal",
      currency,
      reason: "goal_currency_missing",
      current: roundNumber(current),
      missing: roundNumber(missing),
      perSecond: roundNumber(perSecond),
      secondsToClear: secondsToGoal(missing, perSecond),
      severity: bottleneckSeverity(missing, perSecond),
    });
  }

  for (const item of shopUpgrades) {
    if (item.recommendation !== "delay_until_currency" || item.cost == null) continue;
    const missing = Math.max(0, toNumber(item.cost) - toNumber(currencies[item.currency]));
    bottlenecks.push({
      type: "shop_upgrade",
      currency: item.currency,
      reason: "upgrade_currency_shortfall",
      upgradeId: item.id,
      current: roundNumber(toNumber(currencies[item.currency])),
      missing: roundNumber(missing),
      perSecond: roundNumber(combinedCurrencyPerSecond({ currency: item.currency, runEV, generatorEV })),
      secondsToClear: secondsToGoal(missing, combinedCurrencyPerSecond({ currency: item.currency, runEV, generatorEV })),
      severity: bottleneckSeverity(missing, combinedCurrencyPerSecond({ currency: item.currency, runEV, generatorEV })) * 0.6,
    });
  }

  const qGoal = toNumber(goalQuintessence);
  if (qGoal > 0 && toNumber(state.quintessence) < qGoal) {
    const missing = qGoal - toNumber(state.quintessence);
    const qps = quintessencePerSecond(state);
    bottlenecks.push({
      type: "quintessence_goal",
      currency: "Quintessence",
      reason: "quintessence_missing",
      current: roundNumber(toNumber(state.quintessence)),
      missing: roundNumber(missing),
      perSecond: roundNumber(qps),
      secondsToClear: secondsToGoal(missing, qps),
      severity: bottleneckSeverity(missing, qps) * 0.8,
    });
  }

  for (const [currency, model] of Object.entries(specialCurrencies ?? {})) {
    if (model.goal == null || model.missing <= 0) continue;
    const exists = bottlenecks.some((item) => item.currency === currency && item.reason === "goal_currency_missing");
    if (!exists) {
      bottlenecks.push({
        type: "special_currency",
        currency,
        reason: "special_currency_missing",
        current: model.current,
        missing: model.missing,
        perSecond: model.perSecond,
        secondsToClear: model.secondsToGoal,
        severity: bottleneckSeverity(model.missing, model.perSecond) * 0.9,
      });
    }
  }

  return bottlenecks
    .sort((a, b) => toNumber(b.severity) - toNumber(a.severity) || String(a.currency).localeCompare(String(b.currency)))
    .map((item) => ({ ...item, severity: roundNumber(item.severity) }))
    .slice(0, 12);
}

function statUpgradeWeight({ statName, targetStatWeights, rewardWeights }) {
  const targetWeight = toNumber(targetStatWeights[statName], DEFAULT_STAT_WEIGHTS[statName] ?? 0.6);
  return targetWeight * Math.max(0.25, toNumber(rewardWeights.combat, 1));
}

function marginalUpgradeEffect({ upgrade, level }) {
  const oldMultiplier = 1 + upgrade.perLevel * level;
  const newMultiplier = 1 + upgrade.perLevel * (level + 1);
  const multiplier = upgrade.statName === "attackSpeed"
    ? oldMultiplier / newMultiplier
    : newMultiplier / oldMultiplier;
  const percent = upgrade.statName === "attackSpeed"
    ? (1 / multiplier - 1) * 100
    : (multiplier - 1) * 100;
  return {
    multiplier: roundNumber(multiplier),
    percent: roundNumber(percent),
  };
}

function marginalUpgradeStatGain({ stats, upgrade, marginalEffect }) {
  const current = toNumber(stats[upgrade.statName]);
  if (upgrade.statName === "attackSpeed") return current * (1 - toNumber(marginalEffect.multiplier));
  return current * (toNumber(marginalEffect.multiplier) - 1);
}

function secretUpgradeMateriality({ item, profile, generatorEV }) {
  if (item.recommendation === "buy_now") return "high";
  if (item.currency === profile?.goal?.currency) return "high";
  if (item.currency === "Photon" || item.currency === "Gold Leaf") return "high";
  if (toNumber(generatorEV.currencies?.[item.currency]?.perSecond) > 0 && toNumber(item.roi) > 0.05) return "medium";
  if (toNumber(item.score) > 0.5) return "medium";
  return "low";
}

function combinedCurrencyPerSecond({ currency, runEV, generatorEV }) {
  return toNumber(runEV?.currencies?.[currency]?.perSecond) + toNumber(generatorEV.currencies?.[currency]?.perSecond);
}

function isSecretStashUnlocked(state) {
  const skillLevels = state.skillLevels ?? state.skills ?? {};
  return toNumber(skillLevels["stats-hidden-upgrades"]) > 0 || Boolean(state.secretStashUnlocked);
}

function detectSoftcapSeconds(state) {
  const direct = state.secondsToSoftcap ?? state.softcapSeconds ?? state.nextSoftcapSeconds;
  if (direct != null) return toNumber(direct);
  const timestamp = state.nextSoftcapAt ?? state.softcapAt;
  const parsed = timestamp == null ? NaN : Number(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return parsed > Date.now() ? (parsed - Date.now()) / 1000 : parsed;
}

function quintessencePerSecond(state) {
  return toNumber(
    state.quintessencePerSecond
    ?? state.quintessenceGeneratorRate
    ?? state.pendingQuintessencePerSecond
    ?? state.conceptualSynthesis?.quintessencePerSecond,
  );
}

function wastedReward(row, reason, detail) {
  return {
    id: row.id,
    name: row.name ?? row.id,
    rarity: row.rarity ?? "unknown",
    reason,
    detail,
  };
}

function bottleneckSeverity(missing, perSecond) {
  if (missing <= 0) return 0;
  if (perSecond <= 0) return logValue(missing) * 1000;
  return Math.log10(1 + missing / Math.max(1e-9, perSecond));
}

function materialityRank(value) {
  return { high: 3, medium: 2, low: 1 }[value] ?? 0;
}

function secondsToGoal(missing, perSecond) {
  if (missing <= 0) return 0;
  if (perSecond <= 0) return null;
  return roundNumber(missing / perSecond);
}

function logValue(value) {
  return Math.log10(1 + Math.max(0, toNumber(value)));
}

function numericObject(raw = {}) {
  const result = {};
  for (const [key, value] of Object.entries(raw ?? {})) result[key] = toNumber(value);
  return result;
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function roundNumber(value) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  const abs = Math.abs(value);
  if (abs >= 1e12 || abs < 1e-6) return Number(value.toPrecision(12));
  return Math.round(value * 1e9) / 1e9;
}
