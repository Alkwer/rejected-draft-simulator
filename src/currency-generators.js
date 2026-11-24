import { isFullSteamSave, toNumber } from "./save.js";

// Flat and battle-income based Steam generators in build 26885190.
const STEAM_GENERATORS = [
  ["graphiteGeneratorUnlocked", "Graphite", 0.5],
  ["waxGeneratorUnlocked", "Wax", 0.5],
  ["photonGeneratorUnlocked", "Photon", 1],
  ["graphitePlusUnlocked", "Graphite"],
  ["waxOverdriveUnlocked", "Wax"],
  ["charcoalOverdriveUnlocked", "Charcoal"],
  ["coffeeGeneratorUnlocked", "Coffee"],
  ["markerGeneratorUnlocked", "Marker"],
  ["inkGeneratorUnlocked", "Ink"],
  ["acrylicGeneratorUnlocked", "Acrylic"],
  ["sprayGeneratorUnlocked", "Spray"],
  ["photonOverdriveUnlocked", "Photon"],
];

export function currencyGeneratorIncome(state) {
  const steam = isFullSteamSave(state) && STEAM_GENERATORS.some(([key]) => Object.hasOwn(state, key));
  const raw = {};
  const fundamentals = state.fundamentals ?? {};
  const global = toNumber(fundamentals.generatorMultiplier, 1);
  if (steam) {
    for (const [flag, currency, flat] of STEAM_GENERATORS) {
      if (state[flag] !== true) continue;
      const baseRate = flat ?? toNumber(state.totalBattleEarnedCurrencies?.[currency]) * 1e-4;
      raw[currency] = (raw[currency] ?? 0) + baseRate;
    }
  }
  const rates = steam ? raw : state.currencyGeneratorRates ?? state.generatorRates ?? state.generatorsPerSecond ?? {};
  const nativeMultiplier = steam ? toNumber(fundamentals.timeAcceleration, 1)
    * Math.max(0.0001, 1 + toNumber(state.multiverse?.resolvedEffects?.generatorMultiplier)) : 1;
  return Object.fromEntries(Object.entries(rates).map(([currency, value]) => {
    const baseRate = toNumber(value);
    const key = currencyFundamentalKey(currency);
    const multiplier = global * toNumber(fundamentals[`${key}GeneratorMultiplier`], 1) * nativeMultiplier;
    return [currency, { baseRate, multiplier, perSecond: baseRate * multiplier }];
  }).filter(([, income]) => Number.isFinite(income.perSecond) && income.perSecond > 0));
}

export function generatorRates(state) {
  return Object.fromEntries(Object.entries(currencyGeneratorIncome(state))
    .map(([currency, income]) => [currency, income.perSecond]));
}

export function currencyFundamentalKey(name) {
  return String(name).split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part, index) => (index === 0 ? part[0].toLowerCase() : part[0].toUpperCase()) + part.slice(1))
    .join("");
}
