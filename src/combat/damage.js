import { stat } from "./stats.js";
import { vulnerabilityMultiplier } from "./vulnerability.js";

export function createDamageBreakdown() {
  return {
    direct: 0,
    status: 0,
    reflect: 0,
    parry: 0,
    self: 0,
    energyWave: 0,
    total: 0,
  };
}

export function createHealingBreakdown() {
  return {
    regen: 0,
    lifesteal: 0,
    other: 0,
    total: 0,
  };
}

export function addBreakdown(breakdown, source, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (!(source in breakdown)) breakdown[source] = 0;
  breakdown[source] += amount;
  breakdown.total += amount;
}

export function cloneBreakdowns(breakdowns) {
  return {
    player: { ...breakdowns.player },
    enemy: { ...breakdowns.enemy },
  };
}

export function inferDeathCause(breakdown) {
  if (!breakdown || breakdown.total <= 0) return "unknown";
  const source = dominantDamageSource(breakdown);
  if (!source) return "unknown";
  if (source === "direct" || source === "energyWave") return "direct_damage";
  if (source === "status") return "status_damage";
  if (source === "reflect" || source === "parry") return "reflect_damage";
  if (source === "self") return "self_damage";
  return `${source}_damage`;
}

export function dominantDamageSource(breakdown = {}) {
  return Object.entries(breakdown)
    .filter(([key]) => key !== "total")
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "direct";
}

export function statusDotDamage(combatant, statuses, deltaSeconds) {
  const maxHp = stat(combatant, "maxHp", 1);
  let damage = 0;
  damage += (statuses.Poison ?? 0) * maxHp * 0.001 * deltaSeconds
    * vulnerabilityMultiplier(combatant, "poisonChance", "poisonDamage");
  damage += (statuses.BurnDamage ?? 0) * deltaSeconds
    * vulnerabilityMultiplier(combatant, "burnChance", "burnDamage");
  damage += (statuses.BlackFlame ?? 0) * maxHp * 0.01 * deltaSeconds
    * vulnerabilityMultiplier(combatant, "blackFlameChance", "blackFlameDamage");
  damage += (statuses.Plague ?? 0) * deltaSeconds;
  damage += Math.sqrt(statuses.Irradiate ?? 0) * deltaSeconds
    * vulnerabilityMultiplier(combatant, "irradiateChance", "irradiateDamage");
  return damage;
}
