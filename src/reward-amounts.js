import { steamUniverse } from "./combat/steam-encounter.js";
import { STEAM_DECAY_IMMUNE_STATS } from "./combat/steam-universes.js";
import { isFullSteamSave, toNumber } from "./save.js";
import { RewardProjectionError } from "./steam-stat-projection.js";

export function applyStatReward(statName, currentValue, amount) {
  const nextValue = currentValue + amount;
  if (!Number.isFinite(nextValue)) throw new RewardProjectionError(`Projected ${statName} exceeds the numeric range.`);
  return statName === "attackSpeed" ? nextValue : Math.max(0, nextValue);
}

export function steamSketchRewards({
  state = {},
  id,
  sketch,
  victoriesBefore,
  rewardDecay = toNumber(state.fundamentals?.rewardDecay, 1),
  rewardBoosterEffect = toNumber(state.fundamentals?.rewardBoosterEffect, 50),
  boosted = false,
  retroactive = false,
  newWins = 0,
}) {
  if (!isFullSteamSave(state)) return null;
  const multiverse = state.multiverse ?? {};
  const universe = steamUniverse(multiverse.currentUniverseId);
  const fundamentals = state.fundamentals ?? {};
  const card = cardRewardMultiplier(multiverse.collectibles, id, universe.cardBonusPower);
  const boosterBonus = rewardBoosterEffect / 100
    * multiverseRewardMultiplier(multiverse, "rewardBoosterEffectMultiplier");
  const booster = retroactive ? boosterBonus : boosted ? 1 + boosterBonus : 1;
  const repeat = !retroactive && victoriesBefore > 0 ? (universe.repeatVictoryRewardMultiplier ?? 1) : 1;
  const easy = state.gameMode === "easy";
  const modeCurrency = state.gameMode === "speedrun" ? 10 : easy ? 5 : 1;
  const earlyCurrency = !retroactive && newWins < steamCurrencyPerkWinsRemaining(state) ? 10 : 1;
  const currencyFactor = (universe.currencyRewardMultiplier ?? 1) * (universe.allRewardMultiplier ?? 1)
    * modeCurrency * earlyCurrency * repeat * booster * card;
  const statFactor = (universe.statRewardMultiplier ?? 1) * (universe.allRewardMultiplier ?? 1);
  const decayFactor = (decay) => {
    if (!retroactive) return 1 / (1 + victoriesBefore * decay);
    let cumulative = 0;
    for (let previous = 0; previous < victoriesBefore; previous += 1) {
      cumulative += 1 / (1 + previous * decay);
    }
    return cumulative;
  };
  const decay = decayFactor(rewardDecay);
  const protectedDecay = rewardDecay === 1 ? decay : decayFactor(1);
  return {
    decay,
    booster,
    statGain({ statName, amount }) {
      amount = toNumber(amount);
      const isDetrimental = statName === "attackSpeed" ? amount > 0 : amount < 0;
      const dividesDetrimental = isDetrimental && sketch.rarity === "opus" && toNumber(fundamentals.boosterOpusDivider) > 0;
      if (retroactive && dividesDetrimental) return 0;
      const decayImmune = STEAM_DECAY_IMMUNE_STATS.has(statName);
      return amount * repeat
        * (decayImmune ? protectedDecay : decay * statFactor)
        * (dividesDetrimental ? 1 / booster : booster)
        * (isDetrimental ? 1 : card * (easy ? 1.5 : 1));
    },
    currencyGain({ name, amount }) {
      if (universe.currencyRewardOnly && !universe.currencyRewardOnly.includes(name)) return 0;
      if (universe.currencyRewardDisabled?.includes(name)) return 0;
      const key = name === "Gold Leaf" ? "goldLeaf" : name.toLowerCase();
      let base = toNumber(amount) * Math.max(1, 1 + toNumber(fundamentals[`${key}RewardMultiplier`]) / 100);
      base *= Math.max(1, toNumber(fundamentals.featMedalMultiplier, 1));
      const underdogCurrency = name === "Gold Leaf"
        || (name === "Photon" && toNumber(fundamentals.underdogCommissionPhoton) > 0)
        || (name === "Spray" && toNumber(fundamentals.underdogCommissionSpray) > 0);
      if (underdogCurrency) base *= Math.max(1, toNumber(fundamentals.underdogCommissionMultiplier, 1));
      const exponent = toNumber(fundamentals[`${key}RewardExponent`]);
      if (base > 1 && exponent > 0) base **= 1 + exponent;
      const specialEffect = name === "Graphite" ? "graphitePostExponentMultiplier"
        : ["Wax", "Charcoal", "Coffee"].includes(name) ? "waxCharcoalCoffeeRewardMultiplier"
          : ["Ink", "Marker", "Acrylic"].includes(name) ? "inkMarkerAcrylicRewardMultiplier"
            : ["Spray", "Photon", "Gold Leaf"].includes(name) ? "sprayPhotonGoldLeafRewardMultiplier" : null;
      const perk = multiverseRewardMultiplier(multiverse, specialEffect);
      const recycled = toNumber(multiverse.collectibles?.recycled?.[`reward:${name}`]);
      const equipped = toNumber(multiverse.collectibles?.equippedEffects?.[`reward:${name}`], 1);
      return Math.max(0, base) * (perk + recycled) * equipped * decay * currencyFactor;
    },
  };
}

export function steamCurrencyPerkWinsRemaining(state) {
  if (!isFullSteamSave(state) || !state.multiverse?.firstClearPerkIds?.includes("first-ten-wins-currency")) return 0;
  const wins = Math.max(0, Math.floor(toNumber(state.currentUniverseBoostedCurrencyWins)));
  return Math.max(0, 10 - wins);
}

function multiverseRewardMultiplier(multiverse, key) {
  return key ? Math.max(0.0001, 1 + toNumber(multiverse.resolvedEffects?.[key])) : 1;
}

function cardRewardMultiplier(collectibles, id, bonusPower) {
  const counts = Object.values(collectibles?.cards?.[id] ?? {}).filter((count) => Number.isSafeInteger(count) && count > 0);
  const duplicates = counts.reduce((total, count) => total + count - 1, 0);
  const bonusPercent = counts.length * 10 + duplicates / 100;
  const multiplier = counts.length > 0
    ? 1 + bonusPercent / 100
    : toNumber(collectibles?.cardMultipliers?.[id], 1);
  if (bonusPower == null) return multiplier;
  const percent = Math.max(0, Math.round((multiplier - 1) * 10000) / 100);
  return 1 + percent ** bonusPower / 100;
}
