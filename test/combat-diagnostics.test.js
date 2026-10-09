import test from "node:test";
import assert from "node:assert/strict";

import { runMonteCarlo, simulateFight } from "../src/combat.js";
import { createRng } from "../src/rng.js";

test("fight result separates status damage from direct damage", () => {
  const result = simulateFight({
    rng: createRng("status-breakdown"),
    player: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, burnChance: 500, burnDamage: 500 },
    enemy: { maxHp: 1000, attack: 0, attackSpeed: 1000 },
    maxSeconds: 20,
  });

  assert.equal(result.winner, "player");
  assert.equal(result.deathCause, "status_damage");
  assert.ok(result.damageBreakdown.enemy.status > result.damageBreakdown.enemy.direct);
});

test("fight result identifies reflect deaths from thorns and counter", () => {
  const result = simulateFight({
    rng: createRng("reflect-breakdown"),
    player: { maxHp: 100, attack: 50, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 1000, attack: 20, attackSpeed: 10000, counter: 100, thornsChance: 100 },
    maxSeconds: 10,
  });

  assert.equal(result.winner, "enemy");
  assert.equal(result.deathCause, "reflect_damage");
  assert.ok(result.damageBreakdown.player.reflect > 0);
});

test("thorns stacks deal flat damage instead of reflecting the incoming hit", () => {
  const result = simulateFight({
    rng: createRng("flat-thorns"),
    player: {
      maxHp: 1e12,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      thornsChance: 100,
    },
    enemy: {
      maxHp: 1e12,
      attack: 1e11,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    maxSeconds: 12,
  });

  assert.notEqual(result.winner, "player");
  assert.ok(result.damageBreakdown.enemy.reflect < 1000);
});

test("bleed vulnerability does not multiply bleed application chance", () => {
  const result = simulateFight({
    rng: createRng("bleed-vulnerability-recoil"),
    player: {
      maxHp: 1e9,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      bleedChance: 100,
    },
    enemy: {
      maxHp: 1e8,
      attack: 0,
      attackSpeed: 1000,
      vulnerability: ["bleedChance", 25],
    },
    maxSeconds: 20,
  });

  assert.notEqual(result.winner, "player");
});

test("burn vulnerability amplifies burn damage without multiplying burn application chance", () => {
  const basePlayer = {
    maxHp: 1e9,
    attack: 0,
    attackSpeed: 1000,
    accuracy: 100,
    burnChance: 1000,
    burnDamage: 100,
  };
  const baseEnemy = {
    maxHp: 100000,
    attack: 0,
    attackSpeed: 1000,
  };

  const normal = simulateFight({
    rng: createRng("burn-vulnerability-normal"),
    player: basePlayer,
    enemy: baseEnemy,
    maxSeconds: 4,
  });
  const vulnerable = simulateFight({
    rng: createRng("burn-vulnerability-damage"),
    player: basePlayer,
    enemy: {
      ...baseEnemy,
      id: "mobius_strip",
      vulnerability: ["burnChance", 3],
    },
    maxSeconds: 4,
  });

  assert.ok(vulnerable.damageBreakdown.enemy.status > normal.damageBreakdown.enemy.status * 2.5);
});

test("combatant-specific vulnerability effects can change how the same stat is used", () => {
  const player = {
    maxHp: 1e9,
    attack: 1000,
    attackSpeed: 1000,
    accuracy: 100,
    minDamage: 100,
    maxDamage: 100,
    frailtyChance: 100,
  };
  const enemy = {
    maxHp: 5000,
    attack: 0,
    attackSpeed: 1000,
    absorb: 95,
    vulnerability: ["frailtyChance", 25],
  };

  const defaultTarget = simulateFight({
    rng: createRng("target-vulnerability-default"),
    player,
    enemy,
    maxSeconds: 35,
  });
  const customTarget = simulateFight({
    rng: createRng("target-vulnerability-custom"),
    player,
    enemy: {
      ...enemy,
      vulnerabilityEffects: { frailtyChance: [] },
    },
    maxSeconds: 35,
  });

  assert.equal(defaultTarget.winner, "player");
  assert.notEqual(customTarget.winner, "player");
});

test("Duct-like low accuracy run is not reported as a favorable fight", () => {
  const summary = runMonteCarlo({
    seed: "duct-like-low-accuracy",
    trials: 300,
    player: {
      maxHp: 632853749254.2452,
      attack: 44132632756.60204,
      minDamage: 226.60333472077286,
      maxDamage: 775.9456310517694,
      attackSpeed: 1285.6814900608447,
      regen: 296917.220328448,
      dodge: 11.767620873862136,
      lifesteal: 3.019094623312421,
      critChance: 10.682551777567879,
      critDmg: 293.5164800324459,
      armor: 7478035.75405567,
      accuracy: 2.2339605180033453,
      armorPen: 63389645.76974875,
      execute: 171.52493327097122,
      parry: 1.9459617781929255,
      parryDmg: 8.571060441653295,
      glancingBlow: 5.218518526950444,
      counter: 3.5177534559235513,
      bleedChance: 25.197577904764003,
      burnChance: 32.20693963638681,
      burnDamage: 4193388.662588754,
      hinderChance: 104.25609153734507,
      poisonChance: 0.44570388138944195,
      hypnotizeChance: 10.093892460984822,
      slowChance: 132.36085981080274,
      frailtyChance: 1.9043373006826723,
      freezeChance: 17.234990151538657,
      multiStrikeChance: 12.069578201119544,
      blockChance: 11.908614775430394,
      blockAmount: 14908682.407553487,
      hasteChance: 2.0377142558884227,
      leapChance: 54.6711654279525,
      energyWaveChance: 3.336531476445622,
      absorb: 2.164875950627559,
      opacity: 4.989656325083863,
      remedy: 114.67242194438367,
      curseChance: 11.401121120106168,
      bananaPeelChance: 4.112607902094044,
      inspirationChance: 8.86048770442945,
      balloonChance: 59.2165167944912,
      thornsChance: 89.74659456458055,
      isolation: 3.05033228282962,
      purgeChance: 8.29065212685179,
    },
    enemy: {
      maxHp: 3300000000000,
      attack: 100000000000,
      attackSpeed: 1900,
      bananaPeelChance: 9000,
      dodge: 44,
      isolation: 99,
      absorb: 95,
      vulnerability: ["bleedChance", 25],
      immunities: ["blackFlameChance", "brittleChance", "hypnotizeChance", "poisonChance"],
    },
    maxSeconds: 300,
  });

  assert.ok(summary.winRate < 0.2);
});

test("timeouts diagnose regen walls", () => {
  const result = simulateFight({
    rng: createRng("regen-wall"),
    player: { maxHp: 1000, attack: 100, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 1000, attack: 0, attackSpeed: 1000, regen: 1000 },
    maxSeconds: 5,
  });

  assert.equal(result.winner, "timeout");
  assert.equal(result.reason, "timeout_regen_wall");
  assert.equal(result.timeoutDiagnosis, "regen_wall");
});

test("timeouts diagnose armor walls before generic max seconds", () => {
  const result = simulateFight({
    rng: createRng("armor-wall"),
    player: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 1000, attack: 0, attackSpeed: 1000, armor: 1000 },
    maxSeconds: 5,
  });

  assert.equal(result.winner, "timeout");
  assert.equal(result.reason, "timeout_armor_wall");
  assert.equal(result.timeoutDiagnosis, "armor_wall");
});

test("timeouts diagnose opacity and remedy status walls", () => {
  const result = simulateFight({
    rng: createRng("status-wall"),
    player: { maxHp: 1000, attack: 0, attackSpeed: 1000, accuracy: 100, bleedChance: 1000 },
    enemy: { maxHp: 1000, attack: 0, attackSpeed: 1000, opacity: 100, remedy: 1000 },
    maxSeconds: 5,
  });

  assert.equal(result.winner, "timeout");
  assert.equal(result.reason, "timeout_opacity_remedy_wall");
  assert.equal(result.timeoutDiagnosis, "opacity_remedy_wall");
});

test("monte carlo summary aggregates death causes and timeout diagnoses", () => {
  const summary = runMonteCarlo({
    seed: "diagnostic-summary",
    trials: 10,
    player: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 1000, attack: 0, attackSpeed: 1000, armor: 1000 },
    maxSeconds: 5,
  });

  assert.equal(summary.timeouts, 10);
  assert.equal(summary.timeoutDiagnoses.armor_wall, 10);
});

test("monte carlo summary includes confidence interval, percentiles and outcome causes", () => {
  const summary = runMonteCarlo({
    player: { maxHp: 500, attack: 200, attackSpeed: 1000 },
    enemy: { maxHp: 100, attack: 10, attackSpeed: 2000 },
    trials: 20,
    maxSeconds: 30,
    seed: "priority-6-summary",
  });

  assert.equal(summary.trials, 20);
  assert.ok(summary.winRateCi95.halfWidth >= 0);
  assert.ok(summary.p10Seconds <= summary.medianSeconds);
  assert.ok(summary.p90Seconds >= summary.medianSeconds);
  assert.equal(summary.timeoutRate, summary.timeouts / summary.trials);
  assert.ok(Object.keys(summary.victoryCauses).length > 0);
  assert.deepEqual(summary.defeatCauses, {});
});
