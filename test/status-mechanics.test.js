import test from "node:test";
import assert from "node:assert/strict";

import { simulateFight } from "../src/combat.js";
import { createRng } from "../src/rng.js";

function passiveEnemy(overrides = {}) {
  return {
    maxHp: 1000,
    attack: 0,
    attackSpeed: 1000,
    ...overrides,
  };
}

function stablePlayer(overrides = {}) {
  return {
    maxHp: 100000,
    attack: 10,
    attackSpeed: 1000,
    accuracy: 100,
    minDamage: 100,
    maxDamage: 100,
    ...overrides,
  };
}

for (const [name, stats] of [
  ["Poison", { poisonChance: 1000 }],
  ["Burn", { burnChance: 1000, burnDamage: 100 }],
  ["BlackFlame", { blackFlameChance: 1000 }],
  ["Plague", { plagueChance: 1000 }],
  ["Irradiate", { irradiateChance: 1000 }],
]) {
  test(`${name} contributes periodic status damage`, () => {
    const result = simulateFight({
      rng: createRng(`dot-${name}`),
      player: stablePlayer({ attack: 1, ...stats }),
      enemy: passiveEnemy({ maxHp: 5000 }),
      maxSeconds: 10,
    });

    assert.ok(result.damageBreakdown.enemy.status > 0);
  });
}

test("bleed damages the bleeding attacker after it deals damage", () => {
  const result = simulateFight({
    rng: createRng("bleed-recoil"),
    player: stablePlayer({ attack: 100 }),
    enemy: passiveEnemy({ maxHp: 100000, attack: 1, bleedChance: 1000 }),
    maxSeconds: 4,
  });

  assert.ok(result.damageBreakdown.player.status > 0);
});

test("hinder and banana peel can deny enemy turns", () => {
  const baseline = simulateFight({
    rng: createRng("control-baseline"),
    player: stablePlayer({ maxHp: 150, attack: 5 }),
    enemy: passiveEnemy({ maxHp: 1000, attack: 100, attackSpeed: 1000 }),
    maxSeconds: 5,
  });
  const controlled = simulateFight({
    rng: createRng("control-chain"),
    player: stablePlayer({
      maxHp: 150,
      attack: 5,
      hinderChance: 100000,
      bananaPeelChance: 100000,
    }),
    enemy: passiveEnemy({ maxHp: 1000, attack: 100, attackSpeed: 1000 }),
    maxSeconds: 5,
  });

  assert.equal(baseline.winner, "enemy");
  assert.notEqual(controlled.winner, "enemy");
});

test("freeze does not prevent the frozen side from attacking", () => {
  const result = simulateFight({
    rng: () => 0,
    player: stablePlayer({ maxHp: 1000, attack: 1, freezeChance: 100 }),
    enemy: passiveEnemy({ maxHp: 100000, attack: 100, attackSpeed: 1000 }),
    maxSeconds: 1.1,
  });

  assert.ok(result.damageBreakdown.player.direct > 0);
});

test("freeze suppresses regeneration and shatters above 100 stacks", () => {
  const baseline = simulateFight({
    rng: () => 0,
    player: stablePlayer({ attack: 5000 }),
    enemy: passiveEnemy({ maxHp: 100000, attack: 0, attackSpeed: 10000, regen: 1000 }),
    maxSeconds: 2.1,
  });
  const chilled = simulateFight({
    rng: () => 0,
    player: stablePlayer({ attack: 5000, freezeChance: 100 }),
    enemy: passiveEnemy({ maxHp: 100000, attack: 0, attackSpeed: 10000, regen: 1000 }),
    maxSeconds: 2.1,
  });
  const shattered = simulateFight({
    rng: () => 0,
    player: stablePlayer({ attack: 5000, freezeChance: 20000 }),
    enemy: passiveEnemy({ maxHp: 100000, attack: 0, attackSpeed: 10000, regen: 1000 }),
    maxSeconds: 2.1,
  });

  assert.ok(chilled.healingBreakdown.enemy.regen < baseline.healingBreakdown.enemy.regen);
  assert.ok(shattered.damageBreakdown.enemy.status > chilled.damageBreakdown.enemy.status);
});

test("frailty and brittle increase later direct hits", () => {
  const baseline = simulateFight({
    rng: createRng("direct-status-baseline"),
    player: stablePlayer({ attack: 20 }),
    enemy: passiveEnemy({ maxHp: 1000 }),
    maxSeconds: 4,
  });
  const amplified = simulateFight({
    rng: createRng("direct-status-amplified"),
    player: stablePlayer({
      attack: 20,
      frailtyChance: 1000,
      brittleChance: 1000,
    }),
    enemy: passiveEnemy({ maxHp: 1000 }),
    maxSeconds: 4,
  });

  assert.ok(amplified.damageBreakdown.enemy.direct > baseline.damageBreakdown.enemy.direct);
});

test("curse reflects damage when the cursed side attacks", () => {
  const result = simulateFight({
    rng: createRng("curse-reflection"),
    player: stablePlayer({ attack: 100, curseChance: 1000 }),
    enemy: passiveEnemy({
      maxHp: 100000,
      attack: 1,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    }),
    maxSeconds: 1.1,
  });

  assert.ok(result.damageBreakdown.enemy.status > 0);
});

test("hypnotize redirects into a normal mitigated self attack", () => {
  const result = simulateFight({
    rng: createRng("hypnotize-mitigated-self-hit"),
    player: stablePlayer({ attack: 0, hypnotizeChance: 100000 }),
    enemy: passiveEnemy({
      maxHp: 100000,
      attack: 500,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
      armor: 450,
    }),
    maxSeconds: 1.1,
  });

  assert.equal(result.damageBreakdown.enemy.self ?? 0, 0);
  assert.ok(result.damageBreakdown.enemy.direct > 0);
  assert.ok(result.damageBreakdown.enemy.direct < 100);
});

test("electrocute amplifies incoming direct damage after application", () => {
  const baseline = simulateFight({
    rng: createRng("electrocute-baseline"),
    player: stablePlayer({ attack: 100 }),
    enemy: passiveEnemy({ maxHp: 1000 }),
    maxSeconds: 4,
  });
  const electrocuted = simulateFight({
    rng: createRng("electrocute-amplified"),
    player: stablePlayer({ attack: 100, electrocuteChance: 1000 }),
    enemy: passiveEnemy({ maxHp: 1000 }),
    maxSeconds: 4,
  });

  assert.ok(electrocuted.damageBreakdown.enemy.direct > baseline.damageBreakdown.enemy.direct);
});

test("inspiration, energy wave and thorns self buffs affect combat output", () => {
  const result = simulateFight({
    rng: createRng("self-buffs"),
    player: stablePlayer({
      attack: 50,
      inspirationChance: 1000,
      energyWaveChance: 1000,
      thornsChance: 1000,
    }),
    enemy: passiveEnemy({ maxHp: 1000, attack: 10, attackSpeed: 1000 }),
    maxSeconds: 5,
  });

  assert.ok(result.damageBreakdown.enemy.direct > 0);
  assert.ok(result.damageBreakdown.enemy.energyWave > 0);
  assert.ok(result.damageBreakdown.enemy.reflect > 0);
});

test("balloon does not deal passive periodic damage before it pops", () => {
  const baseline = simulateFight({
    rng: () => 0.9,
    player: stablePlayer({ attack: 1 }),
    enemy: passiveEnemy({ maxHp: 1000 }),
    maxSeconds: 3,
  });
  const balloon = simulateFight({
    rng: () => 0.9,
    player: stablePlayer({ attack: 1, balloonChance: 1000 }),
    enemy: passiveEnemy({ maxHp: 1000 }),
    maxSeconds: 3,
  });

  assert.equal(balloon.damageBreakdown.enemy.status, baseline.damageBreakdown.enemy.status);
});

test("hot potato waits for the holder turn instead of dealing passive dot damage", () => {
  const result = simulateFight({
    rng: () => 0.5,
    player: stablePlayer({ attack: 0, hotPotatoChance: 100 }),
    enemy: passiveEnemy({ maxHp: 1000, attack: 0, attackSpeed: 10000 }),
    maxSeconds: 3,
  });

  assert.equal(result.damageBreakdown.enemy.status, 0);
});

test("balloon can pop on a later successful hit for flat status damage", () => {
  const result = simulateFight({
    rng: () => 0,
    player: stablePlayer({ attack: 1, balloonChance: 100 }),
    enemy: passiveEnemy({ maxHp: 1000, attack: 0, attackSpeed: 10000 }),
    maxSeconds: 2.1,
  });

  assert.ok(result.damageBreakdown.enemy.status > 0);
});

test("plague grows on status ticks", () => {
  const result = simulateFight({
    rng: () => 0,
    player: stablePlayer({ attack: 1, attackSpeed: 10000, plagueChance: 100 }),
    enemy: passiveEnemy({ maxHp: 1000000, attack: 0, attackSpeed: 10000 }),
    maxSeconds: 11.1,
    trace: { seconds: 12, maxEvents: 20 },
  });

  assert.ok(result.trace.some((event) => (event.statuses.enemy.Plague ?? 0) > 1));
});

test("balloon grows on status ticks when it does not pop", () => {
  const result = simulateFight({
    rng: () => 0.9,
    player: stablePlayer({ attack: 1, attackSpeed: 10000, balloonChance: 100 }),
    enemy: passiveEnemy({ maxHp: 1000000, attack: 0, attackSpeed: 10000 }),
    maxSeconds: 11.1,
    trace: { seconds: 12, maxEvents: 20 },
  });

  assert.ok(result.trace.some((event) => (event.statuses.enemy.Balloon ?? 0) > 1));
});

test("exacerbate duplicates one harmful status instead of every active status", () => {
  const result = simulateFight({
    rng: () => 0.4,
    player: stablePlayer({
      attack: 1,
      bleedChance: 100,
      freezeChance: 100,
      exacerbateChance: 100,
    }),
    enemy: passiveEnemy({ maxHp: 1000000, attack: 0, attackSpeed: 10000 }),
    maxSeconds: 1.1,
    trace: { seconds: 2, maxEvents: 20 },
  });

  const attack = result.trace.find((event) => event.event === "attack");
  assert.equal((attack.statuses.enemy.Bleed ?? 0) + (attack.statuses.enemy.Freeze ?? 0), 3);
});

test("self buffs roll per successful multistrike hit", () => {
  const result = simulateFight({
    rng: () => 0.5,
    player: stablePlayer({
      attack: 1,
      multiStrikeChance: 100,
      leapChance: 100,
    }),
    enemy: passiveEnemy({ maxHp: 1000000, attack: 0, attackSpeed: 10000 }),
    maxSeconds: 1.1,
    trace: { seconds: 2, maxEvents: 20 },
  });

  const attack = result.trace.find((event) => event.event === "attack");
  assert.equal(attack.statuses.player.Leap, 2);
});

test("exported sketch enemy status chances above 100 are treated as scaled percentages", () => {
  const result = simulateFight({
    rng: () => 0,
    player: stablePlayer({ maxHp: 100000, attack: 0 }),
    enemy: passiveEnemy({
      id: "joan_of_art",
      attack: 0,
      plagueChance: 9000,
    }),
    maxSeconds: 5,
  });

  assert.equal(result.winner, "timeout");
  assert.ok(result.playerHp > 95000);
});

test("exported sketch enemy self buff chances above 100 are treated as scaled percentages", () => {
  const result = simulateFight({
    rng: () => 0,
    player: stablePlayer({ maxHp: 10000, attack: 0 }),
    enemy: passiveEnemy({
      id: "joan_of_art",
      attack: 3000,
      minDamage: 100,
      maxDamage: 100,
      inspirationChance: 1800,
    }),
    maxSeconds: 3.1,
  });

  assert.equal(result.winner, "timeout");
  assert.ok(result.playerHp > 0);
});

test("multistrike applies on-hit statuses once per successful hit", () => {
  const result = simulateFight({
    rng: () => 0.5,
    player: stablePlayer({
      attack: 1,
      multiStrikeChance: 100,
      bleedChance: 100,
    }),
    enemy: passiveEnemy({ maxHp: 1000000, attackSpeed: 10000 }),
    maxSeconds: 1.01,
    trace: { seconds: 2, maxEvents: 20 },
  });

  const attack = result.trace.find((event) => event.event === "attack");
  assert.equal(attack.statuses.enemy.Bleed, 2);
});
