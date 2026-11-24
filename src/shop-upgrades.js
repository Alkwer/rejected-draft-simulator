import { currencyFundamentalKey } from "./currency-generators.js";
import { isFullSteamSave, toNumber } from "./save.js";
import { steamShopUpgrades } from "./steam-economy-data.js";

export const SECRET_STASH_ID = "stats-hidden-upgrades";
export const SECRET_STASH_COST = 1e222;

const DISCOUNTS = [
  ["Graphite", "graphiteDiscountUnlocked", 0.5],
  ["Graphite", "graphiteSuperDiscountUnlocked", 0.001],
  ["Charcoal", "charcoalDiscountUnlocked", 0.25],
  ["Charcoal", "charcoalSuperDiscountUnlocked", 0.0001],
  ["Wax", "waxDiscountUnlocked", 0.1],
  ["Coffee", "coffeeDiscountUnlocked", 0.1],
  ["Ink", "inkDiscountUnlocked", 0.1],
  ["Marker", "markerDiscountUnlocked", 0.01],
  ["Acrylic", "acrylicDiscountUnlocked", 0.01],
  ["Spray", "sprayDiscountUnlocked", 0.01],
  ["Photon", "photonDiscountUnlocked", 0.001],
];

export function shopUpgradesForState(state, legacy) {
  return isFullSteamSave(state) ? steamShopUpgrades(state) : legacy;
}

export function areStatUpgradesAvailable(state) {
  return !isFullSteamSave(state) || state.multiverse?.currentUniverseId !== "mv-hard-1";
}

export function missingUpgradeSkill(state, upgrade, secretStashUnlocked) {
  const skill = upgrade.requiredSkillId ?? (upgrade.hidden ? SECRET_STASH_ID : null);
  if (skill === SECRET_STASH_ID) return secretStashUnlocked ? null : skill;
  return skill && toNumber(state.skillLevels?.[skill]) <= 0 ? skill : null;
}

export function upgradeCost({ upgrade, level, fundamentals = {}, state = {} }) {
  const { currency, baseCost, maxLevel } = upgrade;
  let scaling = upgrade.costMultiplier;
  const currencyKey = currencyFundamentalKey(currency);
  let discount = Math.max(0.01, 1 - toNumber(fundamentals[`${currencyKey}UpgradeCost`]) / 100);
  if (isFullSteamSave(state)) {
    discount = Math.max(0.01, Math.min(1, discount));
    for (const [discountCurrency, flag, factor] of DISCOUNTS) {
      if (currency === discountCurrency && state[flag]) discount *= factor;
    }
    if (maxLevel == null) {
      const reduction = Math.min(0.5, Math.max(0, toNumber(state.multiverse?.resolvedEffects?.infiniteStatUpgradeCostScalingReduction)));
      scaling = 1 + (scaling - 1) * (1 - reduction);
    }
  }
  const firstCost = baseCost * discount;
  const cost = firstCost * scaling ** level;
  if (Number.isFinite(cost) || firstCost === 0) return firstCost === 0 ? 0 : cost;
  return 10 ** (Math.log10(firstCost) + level * Math.log10(scaling));
}

export function upgradeSpend(state, cost) {
  return isFullSteamSave(state) && toNumber(state.skillLevels?.["shop-free-purchases"]) > 0 ? 0 : cost;
}

export function spendUpgradeCurrency(state, currencies, currency, cost) {
  const amount = upgradeSpend(state, cost);
  const multiverseId = state.multiverse?.currentUniverseId;
  const spendAll = isFullSteamSave(state) && (multiverseId === "mv-medium-3" || state.gameMode === "madman");
  for (const name of spendAll ? Object.keys(currencies) : [currency]) {
    currencies[name] = Math.max(0, toNumber(currencies[name]) - amount);
  }
}
