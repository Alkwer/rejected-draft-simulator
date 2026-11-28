import { isFullSteamSave, toNumber } from "./save.js";
import {
  STEAM_PLAYER_BASE_STATS, STEAM_PLAYER_STAT_FUNDAMENTALS, STEAM_PLAYER_STAT_GROUPS, steamShopUpgrades,
} from "./steam-economy-data.js";

export class RewardProjectionError extends RangeError {}

const HARD_CAPPED = new Set("absorb accuracy blockChance counter critChance dodge elementalManipulationChance glancingBlow goldenLuckChance grappleChance interceptChance isolation opacity parry surrealism varnish".split(" "));
const GLOSSARY_GAINS = { scrap: 0.01, rough: 0.03, framed: 0.1, opus: 0.33, masterpiece: 1 };
// An effective-only stat can hit a cap during a projection. Carry its modeled
// contribution and uncapped value separately from raw stats supplied by Steam.
const PARTIAL_REWARDS = Symbol("Projected Steam rewards for effective-only stats");

function capStat(state, stat, value) {
  if (!Number.isFinite(value)) throw new RewardProjectionError(`Projected ${stat} exceeds the numeric range.`);
  if (stat === "attackSpeed") return Math.max(500, value);
  if (stat === "lifesteal") return Math.min(200, value);
  if (!HARD_CAPPED.has(stat)) return value;
  const bonus = Math.min(9, Math.max(0, toNumber(state.multiverse?.resolvedEffects?.playerStatHardCapBonus)));
  return Math.min(90 + bonus, value);
}

function statFactors(state, stat, levels, glossary, buffs) {
  let shop = 1;
  let add = 0;
  for (const upgrade of Object.values(steamShopUpgrades(state))) {
    if (upgrade.statName !== stat) continue;
    const level = toNumber(levels[upgrade.id]);
    if (upgrade.additive) add += upgrade.perLevel * level;
    else shop *= 1 + upgrade.perLevel * level;
  }
  const speed = stat === "attackSpeed";
  const fundamentals = state.fundamentals ?? {};
  const key = stat === "maxHp" ? "hpIncrease" : `${stat}Increase`;
  const fundamental = speed ? 1 - Math.max(0, toNumber(fundamentals.attackDelay)) / 100
    : 1 + (STEAM_PLAYER_STAT_FUNDAMENTALS.has(stat) ? Math.max(0, toNumber(fundamentals[key])) / 100 : 0);
  const effects = state.multiverse?.resolvedEffects ?? {};
  let category = 1;
  for (const [group, stats] of Object.entries(STEAM_PLAYER_STAT_GROUPS)) {
    if (stats.includes(stat)) category *= Math.max(0.0001, 1 + toNumber(effects[`${group}StatMultiplier`]));
  }
  let meditation = 1;
  for (const buff of buffs) {
    if (buff.stat === stat) meditation *= toNumber(buff.multiplier, 1);
  }
  const glossaryFactor = stat === "attack" || stat === "maxHp"
    ? glossary * Math.max(0.0001, 1 + toNumber(effects[`${stat}StatMultiplier`]))
    : 1;
  return { shop, add, fundamental, speedCap: toNumber(fundamentals.speedCap, 500) || 500,
    post: speed ? 1 / (category * meditation) : category * meditation * glossaryFactor };
}

function modeledStat(state, stat, raw, factors) {
  const base = toNumber(STEAM_PLAYER_BASE_STATS[stat]) + raw;
  const { shop, add, fundamental, post, speedCap } = factors;
  const effective = stat === "attackSpeed"
    ? Math.max(speedCap, Math.max(50, base / shop - add) * fundamental) * post
    : Math.max(0, base * shop + add) * fundamental * post;
  return capStat(state, stat, effective);
}

export function steamStartingPlayerStats(state) {
  const stats = {};
  for (const [stat, raw] of Object.entries(state.battleStats)) {
    const factors = statFactors(state, stat, {}, state.glossaryMultiplier, state.activeMeditationBuffs);
    stats[stat] = modeledStat(state, stat, raw, factors);
  }
  return stats;
}

export function createSteamStatProjection(state, stats, { raw = false, trackGlossary = true } = {}) {
  if (!isFullSteamSave(state)) return null;
  const battleStats = { ...state.battleStats };
  // A native attack-speed reward is a nonpositive offset. Some partial exports
  // put the effective delay here as well as in playerStats.
  if (toNumber(battleStats.attackSpeed) > 0) delete battleStats.attackSpeed;
  const rawKeys = new Set(Object.keys(battleStats));
  const partial = { ...state[PARTIAL_REWARDS] };
  for (const [stat, value] of Object.entries(partial)) battleStats[stat] = value.reward;
  const levels = { ...state.shopLevels };
  const buffs = Array.isArray(state.activeMeditationBuffs) ? [...state.activeMeditationBuffs] : [];
  const known = trackGlossary && Array.isArray(state.glossaryUnlocks) ? new Set(state.glossaryUnlocks) : null;
  let glossary = toNumber(state.glossaryMultiplier, 1);
  const factorsFor = (stat) => statFactors(state, stat, levels, glossary, buffs);

  function change(stat, mutate) {
    const current = toNumber(stats[stat]);
    const oldFactors = factorsFor(stat);
    const oldRaw = toNumber(battleStats[stat]);
    mutate();
    const nextFactors = factorsFor(stat);
    const nextRaw = toNumber(battleStats[stat]);
    const speed = stat === "attackSpeed";
    if (raw) stats[stat] = nextRaw;
    else if (rawKeys.has(stat)) {
      const before = modeledStat(state, stat, oldRaw, oldFactors);
      const after = modeledStat(state, stat, nextRaw, nextFactors);
      stats[stat] = current + (after - before);
    } else {
      // Older and partial Steam states may only contain effective player stats.
      const slope = ({ shop, fundamental, post }) => fundamental * post * (speed ? 1 / shop : shop);
      const oldSlope = slope(oldFactors);
      const nextSlope = slope(nextFactors);
      const uncapped = partial[stat]?.uncapped ?? current;
      const oldAdd = (speed ? -1 : 1) * oldFactors.add * oldFactors.fundamental * oldFactors.post;
      const nextAdd = (speed ? -1 : 1) * nextFactors.add * nextFactors.fundamental * nextFactors.post;
      const scaled = oldSlope === 0 ? uncapped - oldAdd : (uncapped - oldAdd) * (nextSlope / oldSlope);
      const next = scaled + nextAdd + (nextRaw - oldRaw) * nextSlope;
      if (!Number.isFinite(next)) throw new RewardProjectionError(`Projected ${stat} exceeds the numeric range.`);
      partial[stat] = { reward: nextRaw, uncapped: next };
      stats[stat] = next;
    }
    if (!raw) {
      stats[stat] = speed ? Math.max(Math.min(current, 500), stats[stat]) : capStat(state, stat, Math.max(0, stats[stat]));
    }
    if (!Number.isFinite(stats[stat])) throw new RewardProjectionError(`Projected ${stat} exceeds the numeric range.`);
    return stats[stat] - current;
  }

  return {
    applyReward(stat, amount) {
      return change(stat, () => {
        if (!Number.isFinite(amount)) throw new RewardProjectionError(`Projected ${stat} exceeds the numeric range.`);
        const old = toNumber(battleStats[stat], raw ? toNumber(stats[stat]) : 0);
        const next = old + amount;
        if (!Number.isFinite(next)) throw new RewardProjectionError(`Projected ${stat} exceeds the numeric range.`);
        battleStats[stat] = rawKeys.has(stat) || raw
          ? (stat === "attackSpeed" ? Math.min(0, next) : Math.max(0, next))
          : next;
      });
    },
    resetReward(stat) {
      if (!Object.hasOwn(battleStats, stat)) return 0;
      return change(stat, () => { battleStats[stat] = 0; });
    },
    addGlossary(id, rarity) {
      if (!known || known.has(id) || !Object.hasOwn(GLOSSARY_GAINS, rarity)) return [];
      known.add(id);
      const universe = state.multiverse?.currentUniverseId;
      const perRedraw = universe === "mv-hard-5" ? 0.99 ** (toNumber(state.redrawCount) - toNumber(state.streamlinedSearchRetries)) : 1;
      const bonus = Math.max(0, toNumber(state.multiverse?.resolvedEffects?.glossaryRarityContributionBonus));
      const gained = (GLOSSARY_GAINS[rarity] + bonus) * (state.gameMode === "easy" ? 2 : 1) * perRedraw;
      const next = universe === "mv-easy-2" ? 1 : glossary + gained;
      // Keep the same old glossary factor during both calculations.
      const old = glossary;
      return ["attack", "maxHp"].map((stat) => {
        glossary = old;
        return { statName: stat, amount: change(stat, () => { glossary = next; }) };
      });
    },
    buyUpgrade(upgrade, level) {
      return change(upgrade.statName, () => { levels[upgrade.id] = level; });
    },
    addMeditation(stat, multiplier) {
      change(stat, () => { buffs.push({ stat, multiplier }); });
    },
    statePatch() {
      return {
        ...(state.battleStats && { battleStats: Object.fromEntries([...rawKeys].map((stat) => [stat, battleStats[stat]])) }),
        ...(Object.keys(partial).length && { [PARTIAL_REWARDS]: partial }),
        ...(known && { glossaryUnlocks: [...known], glossaryMultiplier: glossary }),
        ...(!raw && { playerStats: { ...stats } }),
      };
    },
  };
}

export function applySteamVictoryStatChanges(projection, state, id, sketch, statGain) {
  const changes = new Map();
  const record = (stat, amount) => changes.set(stat, (changes.get(stat) ?? 0) + amount);
  for (const { statName, amount } of projection.addGlossary(id, sketch.rarity)) {
    if (amount !== 0) record(statName, amount);
  }
  for (const reward of sketch.rewards ?? []) {
    const { statName } = reward;
    if (statName === "immunities" || statName === "vulnerability") continue;
    const gain = statGain(reward);
    record(statName, gain === 0 ? 0 : projection.applyReward(statName, gain));
  }
  const universe = state.multiverse?.currentUniverseId;
  const reset = universe === "mv-hard-2" ? [(sketch.vulnerability ?? sketch.stats?.vulnerability)?.[0]]
    : universe === "mv-medium-4" ? (sketch.immunities ?? sketch.stats?.immunities ?? []) : [];
  for (const stat of reset) {
    const delta = projection.resetReward(stat);
    if (delta !== 0) record(stat, delta);
  }
  return changes;
}

export function isSteamRawStats(state, stats) {
  return Boolean(state.battleStats && toNumber(stats?.attackSpeed) <= 0
    && Object.hasOwn(stats ?? {}, "attackSpeed")
    && toNumber(state.battleStats.attackSpeed) === toNumber(stats.attackSpeed)
    && toNumber(state.battleStats.attack) === toNumber(stats.attack));
}
