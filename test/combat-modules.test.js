import test from "node:test";
import assert from "node:assert/strict";

import {
  addBreakdown,
  createDamageBreakdown,
  inferDeathCause,
  statusDotDamage,
} from "../src/combat/damage.js";
import { clamp, rollMultistrikeHitCount, rollPercent, rollStacks } from "../src/combat/math.js";
import { attackDelay, effectiveLeap } from "../src/combat/timing.js";
import {
  HARMFUL_STATUSES,
  SELF_BUFF_TO_STAT,
  STATUS_TO_STAT,
  addStatus,
  isHarmfulStatus,
  resolveHypnotize,
  shouldSkipTurn,
  statusStatNames,
  applyRemedy,
} from "../src/combat/statuses.js";

test("status module exposes harmful and self-buff stat mappings", () => {
  assert.equal(STATUS_TO_STAT.Burn, "burnChance");
  assert.equal(STATUS_TO_STAT.Balloon, "balloonChance");
  assert.equal(SELF_BUFF_TO_STAT.Thorns, "thornsChance");
  assert.equal(HARMFUL_STATUSES.has("Freeze"), true);
  assert.equal(isHarmfulStatus("Leap"), false);
  assert.ok(statusStatNames().includes("hotPotatoChance"));
});

test("addStatus applies status caps used by the combat engine", () => {
  const statuses = {};

  addStatus(statuses, "Hinder", 5000);
  addStatus(statuses, "Inspiration", 5000);
  addStatus(statuses, "Burn", 5000);

  assert.equal(statuses.Hinder, 1000);
  assert.equal(statuses.Inspiration, 100);
  assert.equal(statuses.Burn, 5000);
});

test("turn-skip statuses resolve hinder and banana peel, but not freeze or hypnotize", () => {
  const frozen = { Freeze: 1 };
  assert.deepEqual(shouldSkipTurn(() => 0.99, { attack: 50 }, frozen), { skipped: false, damage: 0 });
  assert.deepEqual(frozen, { Freeze: 1 });

  const hindered = { Hinder: 1000 };
  assert.deepEqual(shouldSkipTurn(() => 0, { attack: 50 }, hindered), { skipped: true, damage: 0 });
  assert.equal(hindered.Hinder, 500);

  const banana = { BananaPeel: 1000 };
  assert.deepEqual(shouldSkipTurn(() => 0, { attack: 50 }, banana), { skipped: true, damage: 0 });
  assert.equal(banana.BananaSlip, 1);
  assert.equal(banana.BananaPeel, undefined);

  const hypnotized = { Hypnotize: 1000 };
  assert.deepEqual(shouldSkipTurn(() => 0, { attack: 50 }, hypnotized), { skipped: false, damage: 0 });
  assert.deepEqual(resolveHypnotize(() => 0, hypnotized), { redirected: true });
  assert.deepEqual(hypnotized, {});
});

test("remedy clears high stack counts in weighted chunks like the game", () => {
  const statuses = { Bleed: 50, Burn: 50 };
  applyRemedy(sequenceRng([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
  ]), {
    remedy: 2000,
  }, statuses);

  assert.deepEqual(statuses, { Bleed: 40, Burn: 40 });
});

test("damage-over-time formulas cover every periodic status", () => {
  const combatant = { maxHp: 10000 };
  const damage = statusDotDamage(combatant, {
    Poison: 10,
    BurnDamage: 300,
    BlackFlame: 10,
    Plague: 10,
    Irradiate: 10,
    HotPotato: 10,
    Balloon: 999,
  }, 2);

  assert.equal(damage, 200 + 600 + 2000 + 20 + Math.sqrt(10) * 2);
});

test("timing module applies game haste and slow stack scaling, while Leap uses active stacks only", () => {
  assert.equal(attackDelay({ attackSpeed: 1000 }, { Slow: 100 }), 1.1);
  assert.equal(Math.round(attackDelay({ attackSpeed: 1000 }, { Haste: 100 }) * 1000) / 1000, 0.909);
  assert.equal(attackDelay({ attackSpeed: 1000 }, {}, 2), 0.5);
  assert.equal(attackDelay({ attackSpeed: 1 }, {}), 0.05);
  assert.equal(attackDelay({ attackSpeed: 999999 }, {}), 30);
  assert.equal(effectiveLeap({ leapChance: 900 }, { Leap: 500 }), 500);
  assert.equal(effectiveLeap({ leapChance: 900 }, {}), 0);
});

test("damage breakdown module keeps source totals and death causes stable", () => {
  const breakdown = createDamageBreakdown();

  addBreakdown(breakdown, "direct", 10);
  addBreakdown(breakdown, "energyWave", 30);
  addBreakdown(breakdown, "status", 5);

  assert.equal(breakdown.total, 45);
  assert.equal(inferDeathCause(breakdown), "direct_damage");
});

test("combat math helpers keep deterministic percent and stack behavior", () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(rollPercent(() => 0.2, 30), true);
  assert.equal(rollPercent(() => 0.8, 30), false);
  assert.equal(rollStacks(() => 0.2, 250), 3);
  assert.equal(rollStacks(() => 0.8, 250), 2);
  assert.equal(rollMultistrikeHitCount(sequenceRng([0, 0.99]), 250), 2);
  assert.equal(rollMultistrikeHitCount(sequenceRng([0.99, 0.2]), 250), 4);
});

function sequenceRng(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}
