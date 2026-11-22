import { rollPercent, rollStacks } from "./math.js";
import { stat } from "./stats.js";
import { SELF_BUFF_TO_STAT, STATUS_CAPS, STATUS_TO_STAT, addStatus } from "./statuses.js";

const WOUND_CONVERSIONS = ["Frailty", "Hinder", "Bleed"];
const GRAPPLE_STATUSES = ["Frailty", "Hinder", "Paralysis", "Slow"];
const DISEASE_STATUSES = ["Poison", "Plague", "Curse"];

export const STEAM_ON_HIT_STATUSES = [
  "Bleed", "Burn", "Hinder", "Plague", "Poison", "Hypnotize", "Slow", "Frailty", "Freeze", "Electrocute",
  "Curse", "BlackFlame", "BananaPeel", "Balloon", "Brittle", "Irradiate", "Wound", "Paralysis",
];

export function applySteamStatusTransitions(combatant, statuses, rng) {
  const wound = statuses.Wound ?? 0;
  if (wound > 0) {
    const roll = rng("tick.Wound.convert");
    const next = WOUND_CONVERSIONS[Math.floor(roll * 10)];
    if (next) {
      delete statuses.Wound;
      if (!combatant.immunities.has(STATUS_TO_STAT[next])) addStatus(statuses, next, wound);
    }
  }

  const paralysis = statuses.Paralysis ?? 0;
  if (paralysis > 0 && paralysis < STATUS_CAPS.Paralysis) {
    const growth = paralysis * 0.05 * Math.max(0, 1 - stat(combatant, "isolation") / 100);
    const fractional = growth % 1;
    addStatus(statuses, "Paralysis", Math.floor(growth) + (
      fractional > 0 && rng("tick.Paralysis.growth") < fractional ? 1 : 0
    ));
  }
  const electrocute = statuses.Electrocute ?? 0;
  if (electrocute > 100 && (statuses.Paralysis ?? 0) < STATUS_CAPS.Paralysis
    && !combatant.immunities.has("paralysisChance") && rng("tick.Electrocute.paralysis") < 0.1) {
    addStatus(statuses, "Paralysis", Math.floor(electrocute / 100));
  }
  const slow = statuses.Slow ?? 0;
  if (slow >= 200 && !combatant.immunities.has("freezeChance")) {
    addStatus(statuses, "Freeze", Math.floor(slow / 200));
  }
}

export function rollSteamBuffConversion(rng, stacks, probability, label) {
  const logFailure = Math.log1p(-probability);
  let converted = 0;
  while (stacks > 0) {
    // Sample the gap to the next success in independent stack conversion rolls.
    stacks -= 1 + Math.floor(Math.log1p(-rng(label)) / logFailure);
    if (stacks >= 0) converted += 1;
  }
  return converted;
}

export function applySteamOnHitStatusSkills({ rng, attacker, defender, statuses, applyStatus, onMechanic }) {
  const grapple = stat(attacker, "grappleChance");
  if (grapple > 0 && !defender.immunities.has("grappleChance") && rollPercent(rng, grapple, "status.Grapple")) {
    for (const status of GRAPPLE_STATUSES) {
      if (rng(`status.Grapple.${status}`) < 0.5) applyStatus(status, 1000);
    }
    onMechanic({ type: "grapple" });
  }

  const manipulation = stat(attacker, "elementalManipulationChance");
  if (manipulation <= 0 || defender.immunities.has("elementalManipulationChance")) return;
  for (const [from, to, chance] of [
    ["Freeze", "Burn", manipulation],
    ["Burn", "BlackFlame", manipulation / 10],
  ]) {
    const fromStacks = statuses[from] ?? 0;
    if (fromStacks < 10 || defender.immunities.has(STATUS_TO_STAT[to])
      || !rollPercent(rng, chance, `status.ElementalManipulation.${from}`)) continue;
    const before = statuses[to] ?? 0;
    addStatus(statuses, to, Math.ceil(fromStacks * 0.01));
    const converted = statuses[to] - before;
    if (converted <= 0) continue;
    statuses[from] -= converted;
    if (statuses[from] <= 0) delete statuses[from];
    onMechanic({ type: "elemental_manipulation", from, to, converted });
  }
}

export function spreadSteamDiseases({ combat, rng, blockLeap, onMechanic }) {
  if (!["player", "enemy"].some((side) => stat(combat[side], "diseaseSpreadChance") > 0
    && DISEASE_STATUSES.some((status) => combat[`${side}Statuses`][status] > 0))) return;
  const before = { player: { ...combat.playerStatuses }, enemy: { ...combat.enemyStatuses } };
  for (const sourceSide of ["player", "enemy"]) {
    const chance = stat(combat[sourceSide], "diseaseSpreadChance");
    const defenderSide = sourceSide === "player" ? "enemy" : "player";
    const immunities = combat[defenderSide].immunities;
    if (chance <= 0 || immunities.has("diseaseSpreadChance")
      || !DISEASE_STATUSES.some((status) => before[sourceSide][status] > 0)) continue;
    const budget = rollStacks(rng, chance, `tick.${sourceSide}.DiseaseSpread`);
    for (const status of DISEASE_STATUSES) {
      const stacks = Math.min(budget, before[sourceSide][status] ?? 0);
      if (stacks <= 0 || immunities.has(STATUS_TO_STAT[status])) continue;
      const applied = blockLeap({ defenderSide, status, stacks });
      if (applied <= 0) continue;
      addStatus(combat[`${defenderSide}Statuses`], status, applied);
      onMechanic({ type: "disease_spread", sourceSide, defenderSide, status, stacks: applied });
    }
  }
}

export function shouldSkipForParalysis(rng, statuses) {
  const stacks = statuses.Paralysis ?? 0;
  if (stacks <= 0 || rng("skip.Paralysis") >= Math.min(1, stacks / STATUS_CAPS.Paralysis)) return false;
  delete statuses.Paralysis;
  statuses.ParalysisExposed = 1;
  return true;
}

export function applySteamBuff({ combat, rng, status, stacks, intendedSide }) {
  const intended = combat[intendedSide];
  if (intended.immunities.has(SELF_BUFF_TO_STAT[status])) return null;
  const otherSide = intendedSide === "player" ? "enemy" : "player";
  const interceptChance = stat(combat[otherSide], "interceptChance");
  const intercepted = interceptChance > 0
    && !intended.immunities.has("interceptChance")
    && rollPercent(rng, interceptChance, "buff.Intercept");
  const side = intercepted ? otherSide : intendedSide;
  const statuses = combat[`${side}Statuses`];
  const before = statuses[status] ?? 0;
  if (!combat[side].immunities.has(SELF_BUFF_TO_STAT[status])) {
    const bonus = Math.max(0, combat.assumptions.steam.buffStackCapBonuses?.[status] ?? 0);
    const cap = side === "player" ? (STATUS_CAPS[status] ?? Infinity) + bonus : Infinity;
    statuses[status] = Math.min(cap, before + stacks);
  }
  return { intercepted, side, before, after: statuses[status] ?? 0 };
}
