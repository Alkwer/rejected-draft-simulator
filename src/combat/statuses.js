import { rollPercent } from "./math.js";
import { stat } from "./stats.js";

export const STATUS_TO_STAT = {
  Bleed: "bleedChance",
  Burn: "burnChance",
  Poison: "poisonChance",
  Freeze: "freezeChance",
  Hinder: "hinderChance",
  Slow: "slowChance",
  Frailty: "frailtyChance",
  BananaPeel: "bananaPeelChance",
  Curse: "curseChance",
  Hypnotize: "hypnotizeChance",
  Electrocute: "electrocuteChance",
  BlackFlame: "blackFlameChance",
  Plague: "plagueChance",
  Irradiate: "irradiateChance",
  HotPotato: "hotPotatoChance",
  Balloon: "balloonChance",
  Brittle: "brittleChance",
};

export const SELF_BUFF_TO_STAT = {
  Haste: "hasteChance",
  Inspiration: "inspirationChance",
  EnergyWave: "energyWaveChance",
  Leap: "leapChance",
  Thorns: "thornsChance",
};

export const HARMFUL_STATUSES = new Set(Object.keys(STATUS_TO_STAT));

export const STATUS_CAPS = {
  BlackFlame: 99,
  Hinder: 1000,
  Hypnotize: 1000,
  BananaPeel: 1000,
  Haste: 1000,
  EnergyWave: 1000,
  Leap: 1000,
  Inspiration: 100,
};

export function addStatus(statuses, status, stacks) {
  const uncapped = (statuses[status] ?? 0) + stacks;
  statuses[status] = Math.min(STATUS_CAPS[status] ?? Number.POSITIVE_INFINITY, uncapped);
}

export function isHarmfulStatus(status) {
  return HARMFUL_STATUSES.has(status);
}

export function statusStatNames() {
  return Object.values(STATUS_TO_STAT);
}

export function hasHarmfulStatusPressure(combatant) {
  return statusStatNames().some((statName) => stat(combatant, statName) > 0);
}

export function applyRemedy(rng, combatant, statuses) {
  const remedy = stat(combatant, "remedy");
  if (remedy <= 0) return null;

  let clears = Math.floor(remedy / 100);
  if (rollPercent(rng, remedy % 100, "remedy.fractional")) clears += 1;
  const clearBudget = clears;
  if (clears <= 0) return null;

  const active = Object.entries(statuses)
    .filter(([status, stacks]) => isHarmfulStatus(status) && stacks > 0)
    .map(([status, stacks]) => ({ status, stacks }));
  let totalStacks = active.reduce((total, item) => total + item.stacks, 0);
  if (totalStacks <= 0) return null;

  const before = harmfulStatusSnapshot(statuses);
  const removed = {};
  const removeStacks = (status, stacks) => {
    const actual = Math.min(statuses[status] ?? 0, stacks);
    if (actual <= 0) return 0;
    statuses[status] -= actual;
    removed[status] = (removed[status] ?? 0) + actual;
    if (statuses[status] <= 0) clearStatus(statuses, status);
    return actual;
  };

  if (clears >= totalStacks) {
    for (const item of active) removeStacks(item.status, item.stacks);
    return createRemedyTrace(clearBudget, before, removed, statuses);
  }

  while (clears > 0 && active.length > 0) {
    if (active.length === 1) {
      const item = active[0];
      removeStacks(item.status, clears);
      return createRemedyTrace(clearBudget, before, removed, statuses);
    }

    const chunk = Math.max(1, Math.floor(clears / 10));
    let roll = rng("remedy.pickStatus") * totalStacks;
    let pickedIndex = 0;
    for (let index = 0; index < active.length; index += 1) {
      roll -= active[index].stacks;
      if (roll < 0) {
        pickedIndex = index;
        break;
      }
    }

    const picked = active[pickedIndex];
    const removedStacks = removeStacks(picked.status, Math.min(chunk, picked.stacks, clears));
    picked.stacks -= removedStacks;
    clears -= removedStacks;
    totalStacks -= removedStacks;
    if (picked.stacks <= 0 || (statuses[picked.status] ?? 0) <= 0) {
      active.splice(pickedIndex, 1);
    }
  }

  return createRemedyTrace(clearBudget, before, removed, statuses);
}

function clearStatus(statuses, status) {
  delete statuses[status];
  if (status === "Burn") delete statuses.BurnDamage;
}

function createRemedyTrace(clearBudget, before, removed, statuses) {
  if (Object.keys(removed).length === 0) return null;
  return {
    type: "remedy",
    clearBudget,
    removed,
    before,
    after: harmfulStatusSnapshot(statuses),
  };
}

function harmfulStatusSnapshot(statuses) {
  const result = {};
  for (const [status, stacks] of Object.entries(statuses)) {
    if (isHarmfulStatus(status) && stacks > 0) result[status] = stacks;
  }
  return result;
}

export function shouldSkipTurn(rng, attacker, statuses) {
  if ((statuses.Hinder ?? 0) > 0 && rng("skip.Hinder") < Math.min(1, statuses.Hinder / 1000)) {
    statuses.Hinder = Math.floor(statuses.Hinder / 2);
    if (statuses.Hinder <= 0) delete statuses.Hinder;
    return { skipped: true, damage: 0 };
  }

  if ((statuses.BananaPeel ?? 0) > 0 && rng("skip.BananaPeel") < Math.min(1, statuses.BananaPeel / 1000)) {
    delete statuses.BananaPeel;
    statuses.BananaSlip = 1;
    return { skipped: true, damage: 0 };
  }

  return { skipped: false, damage: 0 };
}

export function resolveHypnotize(rng, statuses) {
  if ((statuses.Hypnotize ?? 0) > 0 && rng("skip.Hypnotize") < Math.min(1, statuses.Hypnotize / 1000)) {
    delete statuses.Hypnotize;
    return { redirected: true };
  }

  return { redirected: false };
}
