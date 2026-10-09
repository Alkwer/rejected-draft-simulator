import test from "node:test";
import assert from "node:assert/strict";

import { simulateFight } from "../src/combat.js";
import { createRng } from "../src/rng.js";
import { decodeSaveText, toNumber } from "../src/save.js";
import { parseSketches } from "../src/sketch-data.js";
import { applySketchRewards } from "../src/rewards.js";

test("decodeSaveText decodes base64 save exports", () => {
  const payload = {
    version: 52,
    state: {
      quintessence: { mantissa: 1.25, exponent: 6 },
      playerStats: { attack: { mantissa: 2, exponent: 3 } },
    },
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

  const decoded = decodeSaveText(encoded);

  assert.equal(decoded.version, 52);
  assert.equal(toNumber(decoded.state.quintessence), 1.25e6);
  assert.equal(toNumber(decoded.state.playerStats.attack), 2e3);
});

test("parseSketches extracts current sketch stats, rewards, and currency rewards", () => {
  const source = `
    const sketches=[{id:"target",name:"Target",rarity:"masterpiece",
    stats:{maxHp:new n(100),attack:new n(5),attackSpeed:1000,vulnerability:["bleedChance",25]},
    rewards:[{statName:"attack",amount:new n(10)}],
    currencyRewards:[{name:"Graphite",amount:new n(5e25)}]}];
  `;

  const sketches = parseSketches(source);

  assert.equal(sketches.target.name, "Target");
  assert.equal(sketches.target.rarity, "masterpiece");
  assert.equal(sketches.target.stats.maxHp, 100);
  assert.deepEqual(sketches.target.vulnerability, ["bleedChance", 25]);
  assert.deepEqual(sketches.target.rewards, [{ statName: "attack", amount: 10 }]);
  assert.deepEqual(sketches.target.currencyRewards, [{ name: "Graphite", amount: 5e25 }]);
});

test("parseSketches supports split data-sketches bundles with a different Decimal alias", () => {
  const source = `
    import{a as e}from"./vendor.js";
    const m=[{id:"target",name:"Target",rarity:"opus",
    stats:{maxHp:new e(125),attack:new e(7),attackSpeed:900,vulnerability:["burnDamage",2.5]},
    rewards:[{statName:"burnDamage",amount:new e(3)}],
    currencyRewards:[{name:"Photon",amount:new e("1e40")}]}];
  `;

  const sketches = parseSketches(source);

  assert.equal(sketches.target.rarity, "opus");
  assert.equal(sketches.target.stats.maxHp, 125);
  assert.equal(sketches.target.stats.attackSpeed, 900);
  assert.deepEqual(sketches.target.vulnerability, ["burnDamage", 2.5]);
  assert.deepEqual(sketches.target.rewards, [{ statName: "burnDamage", amount: 3 }]);
  assert.deepEqual(sketches.target.currencyRewards, [{ name: "Photon", amount: 1e40 }]);
});

test("simulateFight reports a deterministic player win when enemy cannot survive one hit", () => {
  const result = simulateFight({
    rng: createRng("one-shot"),
    player: { maxHp: 100, attack: 250, attackSpeed: 1000, accuracy: 100 },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000 },
    maxSeconds: 10,
  });

  assert.equal(result.winner, "player");
  assert.equal(result.reason, "enemy_hp_zero");
});

test("simulateFight reports a deterministic player loss when enemy kills first", () => {
  const result = simulateFight({
    rng: createRng("enemy-one-shot"),
    player: { maxHp: 100, attack: 1, attackSpeed: 2000, accuracy: 100 },
    enemy: { maxHp: 1000, attack: 500, attackSpeed: 500, accuracy: 100 },
    maxSeconds: 10,
  });

  assert.equal(result.winner, "enemy");
  assert.equal(result.reason, "player_hp_zero");
});

test("simulateFight ignores numeric immunities fields from save stats", () => {
  const result = simulateFight({
    rng: createRng("numeric-immunities"),
    player: { maxHp: 100, attack: 250, attackSpeed: 1000, accuracy: 100, immunities: 0 },
    enemy: { maxHp: 100, attack: 0, attackSpeed: 1000, immunities: 0 },
    maxSeconds: 10,
  });

  assert.equal(result.winner, "player");
});

test("applySketchRewards applies rewards with booster and decay", () => {
  const stats = applySketchRewards({
    baseStats: { attack: 100, freezeChance: 1 },
    sketches: {
      a: { rewards: [{ statName: "attack", amount: 50 }] },
      b: { rewards: [{ statName: "freezeChance", amount: 2 }] },
    },
    defeatedIds: ["a", "b"],
    boostedIds: new Set(["a"]),
    rewardDecay: 1,
    rewardBoosterEffect: 50,
    existingVictories: { b: 1 },
  });

  assert.equal(stats.attack, 175);
  assert.equal(stats.freezeChance, 2);
});

test("simulateFight lets lifesteal sustain the attacker after dealing damage", () => {
  const result = simulateFight({
    rng: createRng("lifesteal-sustain"),
    player: { maxHp: 100, attack: 40, attackSpeed: 1000, accuracy: 100, lifesteal: 100 },
    enemy: { maxHp: 200, attack: 35, attackSpeed: 1000, accuracy: 100 },
    maxSeconds: 10,
  });

  assert.equal(result.winner, "player");
});

test("simulateFight lets active Leap stacks prevent incoming status application", () => {
  const result = simulateFight({
    rng: createRng("leap-status-block"),
    player: { maxHp: 100, attack: 30, attackSpeed: 1000, accuracy: 100, leapChance: 100 },
    enemy: { maxHp: 60, attack: 30, attackSpeed: 1000, accuracy: 100, freezeChance: 100 },
    maxSeconds: 5,
  });

  assert.equal(result.winner, "player");
});
