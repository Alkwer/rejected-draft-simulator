import test from "node:test";
import assert from "node:assert/strict";

import { simulateFight } from "../src/combat.js";
import { createRng } from "../src/rng.js";

test("vulnerability amplifies status application enough to beat absorb walls", () => {
  const vulnerable = simulateFight({
    rng: createRng("vulnerable-frailty"),
    player: { maxHp: 1e9, attack: 5e6, attackSpeed: 1000, accuracy: 100, frailtyChance: 100 },
    enemy: { maxHp: 1e8, attack: 0, attackSpeed: 1000, absorb: 95, vulnerability: ["frailtyChance", 25] },
    maxSeconds: 60,
  });
  const immune = simulateFight({
    rng: createRng("immune-frailty"),
    player: { maxHp: 1e9, attack: 5e6, attackSpeed: 1000, accuracy: 100, frailtyChance: 100 },
    enemy: { maxHp: 1e8, attack: 0, attackSpeed: 1000, absorb: 95, immunities: ["frailtyChance"] },
    maxSeconds: 60,
  });

  assert.equal(vulnerable.winner, "player");
  assert.equal(immune.winner, "timeout");
});

test("execute converts low enemy hp into a faster kill", () => {
  const withoutExecute = simulateFight({
    rng: createRng("no-execute"),
    player: { maxHp: 1000, attack: 15, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000 },
    maxSeconds: 20,
  });
  const withExecute = simulateFight({
    rng: createRng("with-execute"),
    player: { maxHp: 1000, attack: 15, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100, execute: 200 },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000 },
    maxSeconds: 20,
  });

  assert.equal(withExecute.winner, "player");
  assert.ok(withExecute.seconds < withoutExecute.seconds);
});

test("glancing blow reduces incoming crit damage", () => {
  const noGlance = simulateFight({
    rng: createRng("no-glance"),
    player: { maxHp: 100, attack: 0, attackSpeed: 1000 },
    enemy: { maxHp: 1000, attack: 60, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100, critChance: 100, critDmg: 300 },
    maxSeconds: 2,
  });
  const withGlance = simulateFight({
    rng: createRng("with-glance"),
    player: { maxHp: 100, attack: 0, attackSpeed: 1000, glancingBlow: 100 },
    enemy: { maxHp: 1000, attack: 60, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100, critChance: 100, critDmg: 300 },
    maxSeconds: 2,
  });

  assert.equal(noGlance.winner, "enemy");
  assert.notEqual(withGlance.winner, "enemy");
});

test("counter punishes attackers", () => {
  const result = simulateFight({
    rng: createRng("counter-thorns"),
    player: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 1000, attack: 300, attackSpeed: 5000, counter: 100 },
    maxSeconds: 10,
  });

  assert.equal(result.winner, "enemy");
});

test("varnish prevents one fatal blow", () => {
  const result = simulateFight({
    rng: createRng("varnish"),
    player: { maxHp: 100, attack: 30, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100, varnish: 100 },
    enemy: { maxHp: 90, attack: 200, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    maxSeconds: 5,
  });

  assert.equal(result.winner, "player");
});

test("haste speeds attacks and slow delays them", () => {
  const hasted = simulateFight({
    rng: createRng("haste"),
    player: { maxHp: 1000, attack: 25, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100, hasteChance: 100 },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000 },
    maxSeconds: 20,
  });
  const slowed = simulateFight({
    rng: createRng("slow"),
    player: { maxHp: 1000, attack: 25, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000, slowChance: 1000 },
    maxSeconds: 20,
  });

  assert.equal(hasted.winner, "player");
  assert.ok(hasted.seconds < slowed.seconds);
});

test("multi strike and energy wave add extra outgoing damage", () => {
  const baseline = simulateFight({
    rng: createRng("baseline-strikes"),
    player: { maxHp: 1000, attack: 20, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000 },
    maxSeconds: 20,
  });
  const enhanced = simulateFight({
    rng: createRng("enhanced-strikes"),
    player: {
      maxHp: 1000,
      attack: 20,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      multiStrikeChance: 200,
      energyWaveChance: 100,
    },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000 },
    maxSeconds: 20,
  });

  assert.equal(enhanced.winner, "player");
  assert.ok(enhanced.seconds < baseline.seconds);
});

test("burn damage stat contributes to burn dot pressure", () => {
  const result = simulateFight({
    rng: createRng("burn-damage"),
    player: {
      maxHp: 1e6,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      burnChance: 100,
      burnDamage: 1e5,
    },
    enemy: { maxHp: 1e6, attack: 0, attackSpeed: 1000 },
    maxSeconds: 20,
  });

  assert.equal(result.winner, "player");
});
