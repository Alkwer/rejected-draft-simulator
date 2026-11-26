import test from "node:test";
import assert from "node:assert/strict";

import { simulateFight } from "../src/combat.js";
import { combatAssumptionsFromSave } from "../src/combat-assumptions.js";
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

test("archived web Counter delay scales with combat speed", () => {
  const { trace } = simulateFight({
    rng: () => 0.5,
    player: { maxHp: 1000, attack: 10, attackSpeed: 1000 },
    enemy: { maxHp: 1000, attack: 10, attackSpeed: 5000, counter: 100 },
    assumptions: combatAssumptionsFromSave({ fundamentals: { timeAcceleration: 2 } }),
    maxSeconds: 0.7,
    trace: { seconds: 0.7 },
  });

  const attack = trace.find((event) => event.event === "attack");
  const scheduled = attack.mechanics.find((mechanic) => mechanic.type === "counter_scheduled");
  assert.equal(scheduled.delaySeconds, 0.1);
  assert.equal(trace.find((event) => event.event === "pending_effect").time, 0.6);
});

test("archived web Multistrike queues one Counter that runs a full turn without chaining", () => {
  const stats = { maxHp: 1000, attack: 10, counter: 100, multiStrikeChance: 100 };
  const { trace } = simulateFight({
    rng: () => 0.5,
    player: { ...stats, attackSpeed: 700, poisonChance: 100, thornsChance: 100 },
    enemy: { ...stats, attackSpeed: 5000, remedy: 100, burnChance: 100, burnDamage: 1, hasteChance: 100 },
    maxSeconds: 1,
    trace: { seconds: 1, includeRng: true },
  });

  const attack = trace.find((event) => event.event === "attack");
  assert.equal(attack.action.landedHits, 2);
  assert.equal(attack.mechanics.filter(({ type }) => type === "counter_scheduled").length, 1);
  assert.equal(attack.statuses.enemy.Poison, 2);
  const counters = trace.filter((event) => event.event === "pending_effect");
  assert.equal(counters.length, 1);
  const [counter] = counters;
  assert.equal(counter.action.type, "counter");
  assert.equal(counter.action.landedHits, 2);
  assert.equal(counter.action.damage, 20);
  assert.equal(counter.statuses.enemy.Poison, 1);
  assert.equal(counter.statuses.enemy.Haste, 2);
  assert.equal(counter.statuses.player.Burn, 2);
  assert.equal(counter.mechanics.filter(({ type }) => type === "thorns").length, 2);
  assert.equal(counter.rng.filter(({ label, success }) => label === "reactive.counter" && success).length, 2);
  assert.equal(counter.rng.filter(({ label }) => label === "enemy.surrealism").length, 2);
  assert.equal(counter.mechanics.some(({ type }) => type === "counter_scheduled"), false);
  assert.equal(counter.damageEvents.filter(({ tags }) => tags.includes("counter")).length, 2);
});

test("archived web Hinder can skip a queued Counter", () => {
  const { trace } = simulateFight({
    rng: () => 0.5,
    player: { maxHp: 1000, attack: 10, attackSpeed: 700, hinderChance: 100000 },
    enemy: { maxHp: 1000, attack: 10, attackSpeed: 5000, counter: 100, remedy: 100000 },
    maxSeconds: 1,
    trace: { seconds: 1 },
  });

  const counter = trace.find((event) => event.event === "pending_effect");
  assert.equal(counter.action.skipped, true);
  assert.equal(counter.action.damage, 0);
  assert.deepEqual(counter.mechanics.find(({ type }) => type === "remedy").removed, { Hinder: 1000 });
  assert.equal(counter.statuses.enemy.Hinder, 500);
  assert.equal(counter.playerHp, 1000);
});

test("archived web Inspiration ticks require a status and cap only the player", () => {
  const base = { maxHp: 1000, attack: 1, attackSpeed: 1100, inspirationChance: 20000 };
  const { trace } = simulateFight({
    rng: () => 0.5,
    player: { ...base, hasteChance: 100 },
    enemy: base,
    assumptions: combatAssumptionsFromSave({ fundamentals: { inspirationCapBonus: 25 } }),
    maxSeconds: 2.1,
    trace: { seconds: 2.1 },
  });

  const firstAttack = trace.find((event) => event.event === "attack");
  assert.equal(firstAttack.statuses.player.Inspiration, undefined);
  assert.equal(firstAttack.statuses.enemy.Inspiration, undefined);
  const tick = trace.find((event) => event.event === "tick");
  assert.equal(tick.time, 2.004);
  assert.equal(tick.statuses.player.Inspiration, 125);
  assert.equal(tick.statuses.enemy.Inspiration, 200);
});

test("archived web status ticks process the player then enemy for each effect", () => {
  const stats = {
    maxHp: 1000, attack: 1, attackSpeed: 800,
    burnChance: 1000, burnDamage: 1, plagueChance: 1000, poisonChance: 1000, blackFlameChance: 1000,
    energyWaveChance: 1000, inspirationChance: 100, balloonChance: 1000, irradiateChance: 1000,
  };
  const { trace } = simulateFight({
    rng: () => 0.5,
    player: stats,
    enemy: stats,
    maxSeconds: 1.1,
    trace: { seconds: 1.1 },
  });

  const tick = trace.find((event) => event.event === "tick");
  assert.deepEqual(tick.damageEvents.map(({ side, tags }) => [side, tags.at(-1)]), [
    ["player", "Burn"], ["enemy", "Burn"],
    ["player", "Plague"], ["enemy", "Plague"],
    ["player", "Poison"], ["enemy", "Poison"],
    ["player", "BlackFlame"], ["enemy", "BlackFlame"],
    ["enemy", "energyWave"], ["player", "energyWave"],
    ["player", "Irradiate"], ["enemy", "Irradiate"],
  ]);
  assert.deepEqual(tick.mechanics.map(({ status, side, attackerSide }) =>
    [status ?? "EnergyWave", side ?? attackerSide]), [
    ["Plague", "player"], ["Plague", "enemy"],
    ["EnergyWave", "player"], ["EnergyWave", "enemy"],
    ["Inspiration", "player"], ["Inspiration", "enemy"],
    ["Balloon", "player"], ["Balloon", "enemy"],
    ["Irradiate", "player"], ["Irradiate", "enemy"],
  ]);
});

test("archived web BananaSlip doubles only the next attack interval", () => {
  let applications = 0;
  const { trace } = simulateFight({
    rng: (label) => {
      if (label === "skip.BananaPeel") return 0;
      if (label === "status.BananaPeel.apply.fractional" && applications++ === 0) return 0;
      return 0.5;
    },
    player: { maxHp: 1000, attack: 1, attackSpeed: 1000, bananaPeelChance: 50 },
    enemy: { maxHp: 1000, attack: 1, attackSpeed: 2000 },
    maxSeconds: 8.1,
    trace: { seconds: 8.1 },
  });

  const attacks = trace.filter((event) => event.event === "attack" && event.attackerSide === "enemy");
  assert.deepEqual(attacks.map((event) => [event.time, event.statuses.enemy.BananaSlip]),
    [[2, 1], [6, undefined], [8, undefined]]);
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
