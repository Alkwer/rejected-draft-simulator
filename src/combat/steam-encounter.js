import { toNumber } from "../save.js";
import {
  STEAM_ENEMY_BASE_STATS,
  STEAM_ENEMY_STAT_GROUPS,
  STEAM_UNIVERSES,
} from "./steam-universes.js";

export function enemyFromSketch(sketch, id = sketch.id) {
  return {
    ...sketch.stats,
    id,
    name: sketch.name,
    rarity: sketch.rarity,
    source: sketch.source ?? "catalog",
    immunities: sketch.immunities,
    vulnerability: sketch.vulnerability,
  };
}

export function sketchForEncounter(sketch, assumptions) {
  if (!sketch || !assumptions.steam) return sketch;
  const { id, name, rarity, source, immunities, vulnerability, ...stats } =
    buildSteamEnemy(enemyFromSketch(sketch), assumptions.steam);
  return { ...sketch, id, name, rarity, source, immunities, vulnerability, stats };
}

export function steamUniverse(universeId) {
  return Object.hasOwn(STEAM_UNIVERSES, universeId) ? STEAM_UNIVERSES[universeId] : STEAM_UNIVERSES["mv-original"];
}

export function steamEncounterContext(state) {
  const multiverse = state.multiverse ?? {};
  const eraserEffect = Math.max(0, toNumber(multiverse.resolvedEffects?.preciseEraserMultiplier));
  const seppuku = state.seppukuConfig;
  return {
    universeId: multiverse.currentUniverseId ?? "mv-original",
    erasedSketchIds: state.erasedSketchIds instanceof Set || Array.isArray(state.erasedSketchIds)
      ? [...state.erasedSketchIds]
      : [],
    eraserDivisor: 2 * (1 - 4 * Math.expm1(-eraserEffect / 4)),
    buffStackCapBonuses: {
      Haste: toNumber(multiverse.resolvedEffects?.hasteStackCapBonus),
      Inspiration: toNumber(state.fundamentals?.inspirationCapBonus)
        + toNumber(multiverse.resolvedEffects?.inspirationStackCapBonus),
    },
    seppukuRules: seppuku?.enabled === true && toNumber(state.skillLevels?.["fund-seppuku"]) >= 1
      ? normalizeSeppukuRules(seppuku.rules)
      : [],
  };
}

export function buildSteamEnemy(enemy, context) {
  if (!context || enemy?.source !== "catalog") return enemy;
  const universe = steamUniverse(context.universeId);
  const stats = { ...enemy, source: "encounter" };
  const vulnerable = Array.isArray(enemy.vulnerability);
  if (enemy.rarity !== "artist" && !["mv-artist", "artist"].includes(enemy.id)) {
    const health = Math.max(
      universe.enemyHealthMultiplier ?? 1,
      vulnerable ? (universe.vulnerableSketchHealthMultiplier ?? 0) : 0,
    );
    const attack = Math.max(
      universe.enemyAttackMultiplier ?? 1,
      vulnerable ? (universe.vulnerableSketchAttackMultiplier ?? 0) : 0,
    );
    const baseMultipliers = { maxHp: health, attack };
    const multipliers = { ...baseMultipliers };
    for (const [category, keys] of Object.entries(STEAM_ENEMY_STAT_GROUPS)) {
      const multiplier = universe[`enemy${category}StatMultiplier`];
      if (multiplier == null) continue;
      for (const key of keys) multipliers[key] = Math.max(multipliers[key] ?? multiplier, multiplier);
    }
    for (const [key, multiplier] of Object.entries(multipliers)) {
      if (enemy[key] == null) continue;
      const amount = toNumber(enemy[key]);
      const atBase = amount === (STEAM_ENEMY_BASE_STATS[key] ?? 0);
      stats[key] = amount * (atBase ? (baseMultipliers[key] ?? 1) : multiplier);
    }
  }
  if (vulnerable && universe.vulnerabilityEffectMultiplier != null) {
    const [stat, factor] = enemy.vulnerability;
    stats.vulnerability = [stat, factor * universe.vulnerabilityEffectMultiplier];
  }
  if (context.erasedSketchIds?.includes(enemy.id)) {
    stats.maxHp = Math.floor(toNumber(stats.maxHp) / (context.eraserDivisor ?? 2));
    stats.isPreciseErased = true;
  }
  return stats;
}

function normalizeSeppukuRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    if (!Array.isArray(rule?.conditions)) return [];
    const conditions = rule.conditions.filter((condition) => {
      const { stat, threshold } = condition ?? {};
      if (typeof stat !== "string" || !Number.isSafeInteger(threshold)) return false;
      return stat === "playerHp" || stat === "enemyHp" ? threshold >= 0 && threshold <= 100 : threshold >= 1;
    });
    return conditions.length ? [{ mode: rule.mode === "all" ? "all" : "any", conditions }] : [];
  });
}

export function shouldTriggerSeppuku(combat, rules) {
  return rules.some(({ mode, conditions }) => {
    if (!Array.isArray(conditions) || conditions.length === 0) return false;
    const meets = ({ stat, threshold }) => {
      if (stat === "playerHp") return combat.playerHp <= combat.player.stats.maxHp * threshold / 100;
      if (stat === "enemyHp") return combat.enemyHp >= combat.enemy.stats.maxHp * threshold / 100;
      if (stat === "timeInBattle") return combat.time >= threshold;
      return (combat.playerStatuses[stat] ?? 0) >= threshold;
    };
    return mode === "all" ? conditions.every(meets) : conditions.some(meets);
  });
}
