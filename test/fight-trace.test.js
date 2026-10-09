import test from "node:test";
import assert from "node:assert/strict";

import { simulateFight } from "../src/combat.js";
import { createFightTrace, exportTraceMarkdown } from "../src/fight-trace.js";

test("createFightTrace records a deterministic timeline with HP, statuses and damage deltas", () => {
  const trace = createFightTrace({
    player: {
      id: "player",
      maxHp: 1000,
      attack: 120,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      burnChance: 100,
      burnDamage: 50,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 800,
      attack: 30,
      attackSpeed: 1000,
      freezeChance: 100,
    },
    maxSeconds: 8,
    traceSeconds: 6,
    seed: "trace-test",
  });

  assert.equal(trace.seed, "trace-test");
  assert.ok(trace.result.winner);
  assert.ok(trace.events.length > 2);
  assert.equal(trace.events[0].event, "start");
  assert.ok(trace.events.every((event) => event.time <= 6));
  assert.ok(trace.events.some((event) => event.event === "attack" && event.damage.enemy.total > 0));
  assert.ok(trace.events.some((event) => Object.keys(event.statuses.player).length > 0 || Object.keys(event.statuses.enemy).length > 0));
});

test("createFightTrace records status deltas for debugging engine parity", () => {
  const trace = createFightTrace({
    player: {
      id: "player",
      maxHp: 1000,
      attack: 50,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      burnChance: 100,
      burnDamage: 25,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 4,
    traceSeconds: 4,
    seed: "trace-status-delta",
  });

  const statusEvent = trace.events.find((event) => event.statusDelta?.enemy?.Burn);

  assert.ok(statusEvent);
  assert.deepEqual(statusEvent.statusDelta.enemy.Burn, {
    before: 0,
    after: 1,
    delta: 1,
  });
  assert.equal(statusEvent.statuses.enemy.Burn, 1);
});

test("createFightTrace can include ordered RNG calls for one fight", () => {
  const trace = createFightTrace({
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      critChance: 100,
      bleedChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 4,
    traceSeconds: 4,
    seed: "trace-rng",
    includeRng: true,
  });

  const rngEvents = trace.events.flatMap((event) => event.rng ?? []);

  assert.ok(rngEvents.length > 0);
  assert.ok(rngEvents.every((entry, index) => entry.index === index + 1));
  assert.ok(rngEvents.some((entry) => entry.label.includes("crit")));
  assert.ok(rngEvents.some((entry) => entry.label.includes("Bleed")));
});

test("createFightTrace annotates RNG calls with decision metadata", () => {
  const trace = createFightTrace({
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      critChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
      dodge: 44,
    },
    maxSeconds: 4,
    traceSeconds: 4,
    seed: "trace-rng-metadata",
    includeRng: true,
  });

  const rngEvents = trace.events.flatMap((event) => event.rng ?? []);
  const crit = rngEvents.find((entry) => entry.label === "hit.crit");
  const damageRoll = rngEvents.find((entry) => entry.label === "hit.damageRoll");
  const dodge = rngEvents.find((entry) => entry.label === "evasion.dodge");

  assert.ok(crit);
  assert.equal(crit.kind, "percent");
  assert.equal(crit.chance, 100);
  assert.equal(crit.threshold, 1);
  assert.equal(crit.success, true);

  assert.ok(damageRoll);
  assert.equal(damageRoll.kind, "range");
  assert.equal(damageRoll.min, 1);
  assert.equal(damageRoll.max, 1);
  assert.equal(damageRoll.result, 1);

  assert.ok(dodge);
  assert.equal(dodge.kind, "percent");
  assert.equal(dodge.chance, 44);
  assert.equal(dodge.threshold, 0.44);
  assert.equal(typeof dodge.success, "boolean");
});

test("createFightTrace annotates status stack rolls with guaranteed and fractional stacks", () => {
  const trace = createFightTrace({
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      burnChance: 250,
      burnDamage: 10,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 4,
    traceSeconds: 4,
    seed: "trace-stack-metadata",
    includeRng: true,
  });

  const burnEvent = trace.events.find((event) => event.statusDelta?.enemy?.Burn);
  const stackRoll = burnEvent?.rng?.find((entry) => entry.label === "status.Burn.apply.fractional");

  assert.ok(burnEvent);
  assert.ok(stackRoll);
  assert.equal(stackRoll.kind, "percent");
  assert.equal(stackRoll.totalChance, 250);
  assert.equal(stackRoll.guaranteedStacks, 2);
  assert.equal(stackRoll.fractionalChance, 50);
  assert.equal(stackRoll.stacks, burnEvent.statusDelta.enemy.Burn.delta);
});

test("fight trace records Leap blocking incoming status stacks", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 2000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      burnChance: 100,
      burnDamage: 10,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 1000,
      minDamage: 100,
      maxDamage: 100,
      leapChance: 100,
    },
    maxSeconds: 4,
    trace: { seconds: 4 },
  });

  const mechanic = result.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "leap_block");

  assert.ok(mechanic);
  assert.equal(mechanic.side, "enemy");
  assert.equal(mechanic.status, "Burn");
  assert.equal(mechanic.attemptedStacks, 1);
  assert.equal(mechanic.blockedStacks, 1);
  assert.equal(mechanic.appliedStacks, 0);
  assert.equal(mechanic.leapBefore, 1);
  assert.equal(mechanic.leapAfter, 0);
});

test("fight trace records Remedy clear details", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 2000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      remedy: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 1000,
      minDamage: 100,
      maxDamage: 100,
      burnChance: 100,
      burnDamage: 10,
    },
    maxSeconds: 4,
    trace: { seconds: 4 },
  });

  const mechanic = result.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "remedy");

  assert.ok(mechanic);
  assert.equal(mechanic.side, "player");
  assert.equal(mechanic.clearBudget, 1);
  assert.deepEqual(mechanic.removed, { Burn: 1 });
  assert.deepEqual(mechanic.before, { Burn: 1 });
  assert.deepEqual(mechanic.after, {});
});

test("fight trace records Balloon pop details", () => {
  const result = simulateFight({
    rng: rngByLabel({ "status.Balloon.pop": 0.1 }),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      balloonChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 3,
    trace: { seconds: 3 },
  });

  const mechanic = result.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "balloon_pop");

  assert.ok(mechanic);
  assert.equal(mechanic.side, "enemy");
  assert.equal(mechanic.stacks, 1);
  assert.equal(mechanic.roll, 0.1);
  assert.equal(mechanic.threshold, 0.25);
  assert.equal(mechanic.popped, true);
  assert.equal(mechanic.damage, 1);
});

test("fight trace records Hot Potato branch and pass details", () => {
  const result = simulateFight({
    rng: rngByLabel({ "hotPotato.branch": 0.99 }),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 2000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 1000,
      minDamage: 100,
      maxDamage: 100,
      hotPotatoChance: 100,
    },
    maxSeconds: 4,
    trace: { seconds: 4 },
  });

  const mechanics = result.trace.flatMap((event) => event.mechanics ?? []);
  const branch = mechanics.find((entry) => entry.type === "hot_potato_branch");
  const pass = mechanics.find((entry) => entry.type === "hot_potato_pass");

  assert.ok(branch);
  assert.equal(branch.side, "player");
  assert.equal(branch.branch, "pass");
  assert.equal(branch.stacksBefore, 1);
  assert.equal(branch.stacksAfter, 0);
  assert.equal(branch.passStacks, 1);

  assert.ok(pass);
  assert.equal(pass.fromSide, "player");
  assert.equal(pass.toSide, "enemy");
  assert.equal(pass.stacks, 1);
});

test("fight trace rolls Multistrike before Hot Potato branch", () => {
  const result = simulateFight({
    rng: rngByLabel({ "hotPotato.branch": 0.99 }),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 2000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      multiStrikeChance: 200,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 1000,
      minDamage: 100,
      maxDamage: 100,
      hotPotatoChance: 100,
    },
    maxSeconds: 4,
    trace: { seconds: 4, includeRng: true },
  });

  const labels = result.trace.flatMap((event) => event.rng ?? []).map((entry) => entry.label);
  const multiStrikeIndex = labels.indexOf("player.multiStrike.guaranteedRange");
  const hotPotatoIndex = labels.indexOf("hotPotato.branch");

  assert.ok(multiStrikeIndex >= 0);
  assert.ok(hotPotatoIndex >= 0);
  assert.ok(multiStrikeIndex < hotPotatoIndex);
});

test("fight trace records dodge and parry resolution details", () => {
  const dodgeResult = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 0,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
      dodge: 100,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });
  const dodge = dodgeResult.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "evasion" && entry.mode === "dodge");

  assert.ok(dodge);
  assert.equal(dodge.attackerSide, "player");
  assert.equal(dodge.defenderSide, "enemy");
  assert.equal(dodge.incomingDamage, 100);
  assert.equal(dodge.dodgeChance, 100);
  assert.equal(dodge.dodgeSuccess, true);
  assert.equal(dodge.accuracyChance, 0);
  assert.equal(dodge.accuracySuccess, false);
  assert.equal(dodge.outcome, "dodge");

  const parryResult = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 0,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
      parry: 100,
      parryDmg: 50,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });
  const parry = parryResult.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "evasion" && entry.mode === "parry");

  assert.ok(parry);
  assert.equal(parry.attackerSide, "player");
  assert.equal(parry.defenderSide, "enemy");
  assert.equal(parry.incomingDamage, 100);
  assert.equal(parry.parryChance, 100);
  assert.equal(parry.parrySuccess, true);
  assert.equal(parry.accuracyChance, 0);
  assert.equal(parry.accuracySuccess, false);
  assert.equal(parry.parryDamage, 50);
  assert.equal(parry.outcome, "parry");
});

test("fight trace records block armor and absorb mitigation details", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
      blockChance: 100,
      blockAmount: 10,
      armor: 20,
      absorb: 50,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const mitigation = result.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "mitigation");

  assert.ok(mitigation);
  assert.equal(mitigation.attackerSide, "player");
  assert.equal(mitigation.defenderSide, "enemy");
  assert.equal(mitigation.incomingDamage, 100);
  assert.deepEqual(mitigation.block, {
    chance: 100,
    success: true,
    amount: 10,
    before: 100,
    after: 90,
  });
  assert.deepEqual(mitigation.armor, {
    amount: 20,
    before: 90,
    after: 70,
  });
  assert.deepEqual(mitigation.absorb, {
    percent: 50,
    before: 70,
    after: 35,
  });
  assert.equal(mitigation.finalDamage, 35);
});

test("fight trace records crit glancing golden luck and execute details", () => {
  const critResult = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      critChance: 100,
      critDmg: 200,
      goldenLuckChance: 100,
      goldenLuckDamage: 300,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });
  const crit = critResult.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "offense" && entry.crit?.success);

  assert.ok(crit);
  assert.equal(crit.attackerSide, "player");
  assert.equal(crit.defenderSide, "enemy");
  assert.equal(crit.baseAttack, 100);
  assert.deepEqual(crit.damageRoll, {
    min: 1,
    max: 1,
    result: 1,
    before: 100,
    after: 100,
  });
  assert.deepEqual(crit.crit, {
    chance: 100,
    success: true,
    multiplier: 2,
    before: 100,
    after: 200,
  });
  assert.deepEqual(crit.glancing, {
    chance: 0,
    success: false,
  });
  assert.deepEqual(crit.goldenLuck, {
    chance: 100,
    success: true,
    multiplier: 3,
    before: 200,
    after: 600,
  });
  assert.equal(crit.finalDamage, 600);

  const glancingResult = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      critChance: 100,
      critDmg: 200,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
      glancingBlow: 100,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });
  const glancing = glancingResult.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "offense" && entry.glancing?.success);

  assert.ok(glancing);
  assert.equal(glancing.crit.success, true);
  assert.equal(glancing.glancing.success, true);
  assert.equal(glancing.crit.applied, false);
  assert.equal(glancing.finalDamage, 100);

  const executeResult = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      execute: 200,
      multiStrikeChance: 700,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });
  const execute = executeResult.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "offense" && entry.execute?.triggered);

  assert.ok(execute);
  assert.equal(execute.execute.hpRatio, 0.3);
  assert.equal(execute.execute.threshold, 0.3);
  assert.equal(execute.execute.multiplier, 2);
  assert.equal(execute.execute.before, 100);
  assert.equal(execute.execute.after, 200);
});

test("fight trace records Frailty Brittle and Electrocute damage modifiers", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      frailtyChance: 100,
      brittleChance: 100,
      electrocuteChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 10000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 3,
    trace: { seconds: 3 },
  });

  const mechanics = result.trace.flatMap((event) => event.mechanics ?? []);
  const statusModifiers = mechanics.find((entry) => entry.type === "direct_status_modifiers");
  const electrocute = mechanics.find((entry) => entry.type === "electrocute");

  assert.ok(electrocute);
  assert.equal(electrocute.attackerSide, "player");
  assert.equal(electrocute.defenderSide, "enemy");
  assert.equal(electrocute.stacks, 1);
  assert.equal(electrocute.roll, 0.99);
  assert.equal(electrocute.before, 100);
  assert.equal(electrocute.addedDamage, 0.99);
  assert.equal(electrocute.after, 100.99);

  assert.ok(statusModifiers);
  assert.deepEqual(statusModifiers.frailty, {
    stacks: 1,
    before: 100,
    after: 101,
  });
  assert.deepEqual(statusModifiers.brittle, {
    stacks: 2,
    before: 101,
    after: 103,
  });
  assert.equal(statusModifiers.finalDamage, 103);
});

test("fight trace records detailed damage events with modifier tags and overkill", () => {
  const modified = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      frailtyChance: 100,
      brittleChance: 100,
      electrocuteChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 10000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 3,
    trace: { seconds: 3 },
  });

  const modifiedHit = modified.trace
    .flatMap((event) => event.damageEvents ?? [])
    .find((entry) => entry.source === "direct" && entry.tags?.includes("electrocute"));

  assert.ok(modifiedHit);
  assert.equal(modifiedHit.side, "enemy");
  assert.equal(modifiedHit.requestedDamage, 103.99);
  assert.equal(modifiedHit.appliedDamage, 103.99);
  assert.equal(modifiedHit.overkillDamage, 0);
  assert.deepEqual(modifiedHit.tags, ["direct", "frailty", "brittle", "electrocute"]);

  const overkill = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1500,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const lethalHit = overkill.trace
    .flatMap((event) => event.damageEvents ?? [])
    .find((entry) => entry.source === "direct");

  assert.ok(lethalHit);
  assert.equal(lethalHit.requestedDamage, 1500);
  assert.equal(lethalHit.appliedDamage, 1000);
  assert.equal(lethalHit.overkillDamage, 500);
  assert.deepEqual(lethalHit.tags, ["direct", "overkill"]);

  const periodic = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      burnChance: 100,
      burnDamage: 25,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 2.1,
    trace: { seconds: 3 },
  });

  const burnTick = periodic.trace
    .flatMap((event) => event.damageEvents ?? [])
    .find((entry) => entry.source === "status" && entry.tags?.includes("Burn"));

  assert.ok(burnTick);
  assert.equal(burnTick.side, "enemy");
  assert.equal(burnTick.requestedDamage, 25);
  assert.equal(burnTick.appliedDamage, 25);
  assert.deepEqual(burnTick.tags, ["status", "periodic", "Burn"]);
});

test("fight trace records Brittle growth after a landed hit without immediate Energy Wave damage", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      energyWaveChance: 100,
      brittleChance: 1000,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 10000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const mechanics = result.trace.flatMap((event) => event.mechanics ?? []);
  const brittleGrowth = mechanics.find((entry) => entry.type === "brittle_growth");

  assert.equal(mechanics.some((entry) => entry.type === "energy_wave"), false);

  assert.ok(brittleGrowth);
  assert.equal(brittleGrowth.side, "enemy");
  assert.equal(brittleGrowth.damageTaken, 100);
  assert.equal(brittleGrowth.before, 10);
  assert.equal(brittleGrowth.growth, 1);
  assert.equal(brittleGrowth.after, 11);
});

test("fight trace grants Energy Wave stacks without immediate on-hit damage", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 50,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      energyWaveChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 10000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 0.051,
    trace: { seconds: 0.051 },
  });

  const attack = result.trace.find((event) => event.event === "attack" && event.attackerSide === "player");

  assert.ok(attack);
  assert.equal(attack.statusDelta.player.EnergyWave?.after, 1);
  assert.equal(attack.mechanics.some((entry) => entry.type === "energy_wave"), false);
  assert.equal(attack.damageEvents.some((entry) => entry.source === "energyWave"), false);
  assert.equal(attack.damage.enemy.direct, 100);
  assert.equal(attack.damage.enemy.energyWave ?? 0, 0);
});

test("fight trace applies Inspiration on the status tick instead of on hit", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 50,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      inspirationChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 10000,
      attack: 0,
      attackSpeed: 10000,
    },
    maxSeconds: 1.1,
    trace: { seconds: 2 },
  });

  const attack = result.trace.find((event) => event.event === "attack");
  const inspirationTick = result.trace.find((event) =>
    event.event === "tick"
    && event.mechanics?.some((entry) => entry.type === "self_buff_tick" && entry.status === "Inspiration")
  );

  assert.ok(attack);
  assert.equal(attack.statuses.player.Inspiration, undefined);
  assert.ok(inspirationTick);
  assert.deepEqual(inspirationTick.statusDelta.player.Inspiration, {
    before: 0,
    after: 1,
    delta: 1,
  });
});

test("fight trace records lifesteal healing after outgoing damage", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 200,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      lifesteal: 50,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 500,
      minDamage: 100,
      maxDamage: 100,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const lifesteal = result.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "lifesteal");

  assert.ok(lifesteal);
  assert.equal(lifesteal.side, "player");
  assert.equal(lifesteal.outgoingDamage, 200);
  assert.equal(lifesteal.percent, 50);
  assert.equal(lifesteal.requestedHealing, 100);
  assert.equal(lifesteal.appliedHealing, 100);
  assert.equal(lifesteal.beforeHp, 900);
  assert.equal(lifesteal.afterHp, 1000);
});

test("fight trace records Varnish survival rolls", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1200,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 10000,
      varnish: 100,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const varnish = result.trace
    .flatMap((event) => event.mechanics ?? [])
    .find((entry) => entry.type === "varnish");

  assert.ok(varnish);
  assert.equal(varnish.side, "enemy");
  assert.equal(varnish.source, "direct");
  assert.equal(varnish.incomingDamage, 1200);
  assert.equal(varnish.beforeHp, 1000);
  assert.equal(varnish.afterDamageHp, -200);
  assert.equal(varnish.chance, 100);
  assert.equal(varnish.success, true);
  assert.equal(varnish.triggersBefore, 0);
  assert.equal(varnish.triggersAfter, 1);
  assert.equal(varnish.restorePercent, 50);
  assert.equal(varnish.afterHp, 500);
});

test("fight trace records Counter and Thorns reactive damage", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 80,
      attackSpeed: 500,
      minDamage: 100,
      maxDamage: 100,
      counter: 100,
      thornsChance: 100,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const mechanics = result.trace.flatMap((event) => event.mechanics ?? []);
  const counter = mechanics.find((entry) => entry.type === "counter");
  const thorns = mechanics.find((entry) => entry.type === "thorns");

  assert.ok(counter);
  assert.equal(counter.defenderSide, "enemy");
  assert.equal(counter.attackerSide, "player");
  assert.equal(counter.chance, 100);
  assert.equal(counter.success, true);
  assert.equal(counter.damage, 80);
  assert.equal(counter.dealtDamage, 80);

  assert.ok(thorns);
  assert.equal(thorns.defenderSide, "enemy");
  assert.equal(thorns.attackerSide, "player");
  assert.equal(thorns.stacks, 1);
  assert.equal(thorns.vulnerabilityMultiplier, 1);
  assert.equal(thorns.damage, 1);
  assert.equal(thorns.dealtDamage, 1);
});

test("counter damage is resolved as a delayed pending effect", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 10,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 80,
      attackSpeed: 10000,
      minDamage: 100,
      maxDamage: 100,
      counter: 100,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const firstAttack = result.trace.find((event) => event.event === "attack" && event.attackerSide === "player");
  const counterEvent = result.trace.find((event) => event.event === "pending_effect" && event.action?.type === "counter");

  assert.ok(firstAttack);
  assert.equal(firstAttack.time, 1);
  assert.equal(firstAttack.playerHp, 1000);
  assert.equal(firstAttack.damage.player.total, 0);
  assert.ok(firstAttack.mechanics.some((entry) => entry.type === "counter_scheduled"));

  assert.ok(counterEvent);
  assert.equal(counterEvent.time, 1.2);
  assert.equal(counterEvent.playerHp, 920);
  assert.equal(counterEvent.damage.player.total, 80);
  assert.ok(counterEvent.mechanics.some((entry) => entry.type === "counter" && entry.dealtDamage === 80));
});

test("delayed counter uses the normal direct damage pipeline", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 10,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      armor: 50,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 10000,
      minDamage: 100,
      maxDamage: 100,
      counter: 100,
      critChance: 100,
      critDmg: 200,
    },
    maxSeconds: 2,
    trace: { seconds: 2 },
  });

  const counterEvent = result.trace.find((event) => event.event === "pending_effect" && event.action?.type === "counter");

  assert.ok(counterEvent);
  assert.equal(counterEvent.damage.player.total, 150);
  assert.ok(counterEvent.mechanics.some((entry) => entry.type === "offense" && entry.crit?.success));
  assert.ok(counterEvent.mechanics.some((entry) => entry.type === "mitigation" && entry.armor?.amount === 50));
  assert.ok(counterEvent.damageEvents.some((event) => event.tags.includes("counter") && event.appliedDamage === 150));
});

test("fight trace records Exacerbate Resonance and Purge post-hit status changes", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      bleedChance: 100,
      hasteChance: 100,
      exacerbateChance: 100,
      resonanceChance: 100,
      purgeChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 0,
      attackSpeed: 500,
      minDamage: 100,
      maxDamage: 100,
      thornsChance: 100,
    },
    maxSeconds: 1.1,
    trace: { seconds: 1.1 },
  });

  const mechanics = result.trace.flatMap((event) => event.mechanics ?? []);
  const exacerbate = mechanics.find((entry) => entry.type === "exacerbate");
  const resonance = mechanics.find((entry) => entry.type === "resonance");
  const purge = mechanics.find((entry) => entry.type === "purge");

  assert.ok(exacerbate);
  assert.equal(exacerbate.attackerSide, "player");
  assert.equal(exacerbate.defenderSide, "enemy");
  assert.equal(exacerbate.status, "Bleed");
  assert.equal(exacerbate.stacks, 1);
  assert.equal(exacerbate.before, 1);
  assert.equal(exacerbate.after, 2);

  assert.ok(resonance);
  assert.equal(resonance.side, "player");
  assert.equal(resonance.status, "Haste");
  assert.equal(resonance.stacks, 1);
  assert.equal(resonance.before, 1);
  assert.equal(resonance.after, 2);

  assert.ok(purge);
  assert.equal(purge.attackerSide, "player");
  assert.equal(purge.defenderSide, "enemy");
  assert.deepEqual(purge.removed, [
    { status: "Thorns", before: 1, after: 0 },
  ]);
});

test("fight trace records regen energy wave tick and status growth mechanics", () => {
  const result = simulateFight({
    rng: rngByLabel(),
    player: {
      id: "player",
      maxHp: 1000,
      attack: 100,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      energyWaveChance: 1000,
      plagueChance: 1000,
      balloonChance: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 10000,
      attack: 0,
      attackSpeed: 10000,
      regen: 25,
    },
    maxSeconds: 2.1,
    trace: { seconds: 3, maxEvents: 20 },
  });

  const regenTick = result.trace.find((event) =>
    event.event === "tick"
    && event.mechanics?.some((entry) => entry.type === "regen" && entry.side === "enemy")
  );
  const tick = result.trace.find((event) =>
    event.event === "tick"
    && event.mechanics?.some((entry) => entry.type === "energy_wave_tick")
  );
  assert.ok(regenTick);
  assert.ok(tick);

  const regen = regenTick.mechanics.find((entry) => entry.type === "regen" && entry.side === "enemy");
  const energyWaveTick = tick.mechanics.find((entry) => entry.type === "energy_wave_tick");
  const plagueGrowth = tick.mechanics.find((entry) => entry.type === "status_growth" && entry.status === "Plague");
  const balloonGrowth = tick.mechanics.find((entry) => entry.type === "status_growth" && entry.status === "Balloon");

  assert.deepEqual(regen, {
    type: "regen",
    side: "enemy",
    deltaSeconds: 1,
    requestedHealing: 25,
    freeze: 0,
    appliedHealing: 25,
    beforeHp: 9900,
    afterHp: 9925,
  });

  assert.deepEqual(energyWaveTick, {
    type: "energy_wave_tick",
    attackerSide: "player",
    defenderSide: "enemy",
    deltaSeconds: 1,
    stacksBefore: 10,
    consumed: 1,
    stacksAfter: 9,
    inspiration: 0,
    vulnerabilityMultiplier: 1,
    damage: 100,
    dealtDamage: 100,
    blockedByImmunity: false,
  });

  assert.deepEqual(plagueGrowth, {
    type: "status_growth",
    side: "enemy",
    status: "Plague",
    deltaSeconds: 1,
    before: 10,
    growth: 1,
    after: 11,
    chance: 100,
  });

  assert.deepEqual(balloonGrowth, {
    type: "status_growth",
    side: "enemy",
    status: "Balloon",
    deltaSeconds: 1,
    before: 1,
    growth: 1,
    after: 2,
    chance: null,
  });
});

test("createFightTrace reports hp deltas using visible clamped HP values", () => {
  const trace = createFightTrace({
    player: {
      id: "player",
      maxHp: 1000,
      attack: 1,
      attackSpeed: 10000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "trace_target",
      name: "Trace Target",
      maxHp: 1000,
      attack: 100000,
      attackSpeed: 1000,
    },
    maxSeconds: 3,
    traceSeconds: 3,
    seed: "trace-visible-hp",
  });

  const attackIndex = trace.events.findIndex((event) => event.attackerSide === "enemy");
  const attack = trace.events[attackIndex];
  const previous = trace.events[attackIndex - 1];

  assert.ok(attack);
  assert.ok(previous);
  assert.equal(attack.playerHp, 0);
  assert.equal(attack.hpDelta.player, attack.playerHp - previous.playerHp);
});

test("exportTraceMarkdown renders trace timeline for CLI use", () => {
  const trace = createFightTrace({
    player: { id: "player", maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { id: "trace_target", name: "Trace Target", maxHp: 10, attack: 0, attackSpeed: 10000 },
    maxSeconds: 5,
    traceSeconds: 5,
    seed: "trace-markdown",
  });

  const markdown = exportTraceMarkdown(trace);

  assert.match(markdown, /# Fight Trace: Trace Target/);
  assert.match(markdown, /Outcome/);
  assert.match(markdown, /\| Time \| Event \|/);
});

test("exportTraceMarkdown renders mechanic trace summaries", () => {
  const markdown = exportTraceMarkdown({
    target: { name: "Trace Target" },
    seed: "trace-markdown-mechanics",
    traceSeconds: 5,
    maxSeconds: 5,
    result: { winner: "player", reason: "enemy_hp_zero", seconds: 1, playerHp: 1000, enemyHp: 0 },
    events: [
      {
        time: 1,
        event: "attack",
        playerHp: 1000,
        enemyHp: 999,
        damage: { player: { total: 0 }, enemy: { total: 1 } },
        statuses: { player: {}, enemy: {} },
        mechanics: [
          { type: "leap_block", blockedStacks: 1, status: "Burn" },
          { type: "remedy", removed: { Burn: 1 } },
          { type: "hot_potato_pass", fromSide: "player", toSide: "enemy" },
          { type: "evasion", mode: "dodge", outcome: "dodge" },
          { type: "mitigation", incomingDamage: 100, finalDamage: 35 },
        ],
      },
      {
        time: 2,
        event: "attack",
        playerHp: 1000,
        enemyHp: 399,
        damage: { player: { total: 0 }, enemy: { total: 600 } },
        statuses: { player: {}, enemy: {} },
        damageEvents: [
          {
            side: "enemy",
            source: "direct",
            requestedDamage: 604.0197,
            appliedDamage: 600,
            overkillDamage: 4.0197,
            tags: ["direct", "crit", "execute", "electrocute", "overkill"],
          },
        ],
        mechanics: [
          {
            type: "offense",
            baseAttack: 100,
            damageRoll: { result: 1 },
            execute: { triggered: true, multiplier: 2 },
            crit: { success: true, multiplier: 2 },
            glancing: { success: false },
            goldenLuck: { success: true, multiplier: 3 },
            finalDamage: 600,
          },
          {
            type: "electrocute",
            stacks: 1,
            addedDamage: 1.0197,
            after: 104.0197,
          },
        ],
      },
      {
        time: 3,
        event: "attack",
        playerHp: 1000,
        enemyHp: 249,
        damage: { player: { total: 0 }, enemy: { total: 100 } },
        statuses: { player: {}, enemy: { Brittle: 11 } },
        mechanics: [
          { type: "brittle_growth", growth: 1, after: 11 },
          { type: "lifesteal", appliedHealing: 100, afterHp: 1000 },
        ],
      },
      {
        time: 4,
        event: "attack",
        playerHp: 919,
        enemyHp: 500,
        damage: { player: { total: 81 }, enemy: { total: 500 } },
        statuses: { player: {}, enemy: { Thorns: 1, VarnishTriggers: 1 } },
        mechanics: [
          { type: "varnish", side: "enemy", success: true, restorePercent: 50, afterHp: 500 },
          { type: "counter", defenderSide: "enemy", attackerSide: "player", damage: 80, dealtDamage: 80 },
          { type: "thorns", defenderSide: "enemy", attackerSide: "player", stacks: 1, dealtDamage: 1 },
        ],
      },
      {
        time: 5,
        event: "attack",
        playerHp: 999,
        enemyHp: 499,
        damage: { player: { total: 1 }, enemy: { total: 1 } },
        statuses: { player: { Haste: 2 }, enemy: { Bleed: 2 } },
        damageEvents: [
          {
            side: "enemy",
            source: "status",
            requestedDamage: 25,
            appliedDamage: 25,
            overkillDamage: 0,
            tags: ["status", "periodic", "Burn"],
          },
        ],
        mechanics: [
          { type: "exacerbate", status: "Bleed", stacks: 1, before: 1, after: 2 },
          { type: "resonance", status: "Haste", stacks: 1, before: 1, after: 2 },
          { type: "purge", removed: [{ status: "Thorns", before: 1, after: 0 }] },
          { type: "regen", side: "enemy", requestedHealing: 25, appliedHealing: 25, beforeHp: 9900, afterHp: 9925 },
          { type: "energy_wave_tick", attackerSide: "player", defenderSide: "enemy", consumed: 1, dealtDamage: 100 },
          { type: "status_growth", side: "enemy", status: "Plague", before: 10, growth: 1, after: 11 },
        ],
      },
    ],
  });

  assert.match(markdown, /\| Time \| Event \| Action \| HP \| Damage \| Damage Events \| Statuses \| Mechanics \| RNG \|/);
  assert.match(markdown, /Leap blocked 1 Burn/);
  assert.match(markdown, /Remedy cleared Burn:1/);
  assert.match(markdown, /Hot Potato pass player->enemy/);
  assert.match(markdown, /Dodge dodge/);
  assert.match(markdown, /Mitigation 100->35/);
  assert.match(markdown, /Offense 100->600 crit x2 execute x2 golden x3/);
  assert.match(markdown, /Electrocute \+1.02 ->104.02/);
  assert.match(markdown, /Brittle growth \+1 ->11/);
  assert.match(markdown, /Lifesteal \+100 ->1.00K/);
  assert.match(markdown, /Varnish enemy restored 50% ->500/);
  assert.match(markdown, /Counter enemy->player 80/);
  assert.match(markdown, /Thorns enemy->player 1/);
  assert.match(markdown, /Exacerbate Bleed \+1 ->2/);
  assert.match(markdown, /Resonance Haste \+1 ->2/);
  assert.match(markdown, /Purge Thorns:1->0/);
  assert.match(markdown, /Regen enemy 9.90K \+25 ->9.93K/);
  assert.match(markdown, /Energy Wave tick player->enemy -1 dealt 100/);
  assert.match(markdown, /Plague growth 10 \+1 ->11/);
  assert.match(markdown, /E direct\[direct, crit, execute, electrocute, overkill\] 604.02->600 overkill 4.02/);
  assert.match(markdown, /E status\[status, periodic, Burn\] 25->25/);
});

function rngByLabel(overrides = {}, fallback = 0.99) {
  return (label) => overrides[label] ?? fallback;
}
