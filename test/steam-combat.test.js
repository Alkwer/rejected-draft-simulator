import assert from "node:assert/strict";
import test from "node:test";
import { combatAssumptionsFromSave } from "../src/combat-assumptions.js";
import { simulateFight } from "../src/combat.js";
import { buildSteamEnemy, enemyFromSketch, sketchForEncounter } from "../src/combat/steam-encounter.js";
import { normalizeFightFixture } from "../src/fight-parity.js";
import { applySketchRewards } from "../src/rewards.js";
import { simulateRoute } from "../src/route.js";

const player = { maxHp: 10000, attack: 1, attackSpeed: 1000 };
const enemy = { id: "sketch", source: "catalog", maxHp: 5, attack: 1, attackSpeed: 500 };

test("an oversized critical hit reports numeric overflow instead of predicting a timeout", () => {
  const options = { player: { ...player, attack: 1e308, minDamage: 100, maxDamage: 100, critChance: 100, critDmg: 200 },
    enemy: { ...enemy, attackSpeed: 10000 }, assumptions: combatAssumptionsFromSave({ saveProfile: "steam" }),
    maxSeconds: 5, rng: () => 0.2 };
  assert.throws(() => simulateFight(options), /direct damage to enemy.*numeric range/);
  const fight = simulateFight({ ...options, player: { ...options.player, attack: 1e307 }, trace: { seconds: 5 } });
  assert.equal(fight.winner, "player");
  const hit = fight.trace.flatMap((step) => step.damageEvents ?? []).find((event) => event.source === "direct");
  assert.equal(hit.requestedDamage, 2e307);
});

test("Steam encounter adjusts catalog enemies and leaves fixture snapshots intact", () => {
  const assumptions = combatAssumptionsFromSave({
    meta: { profile: "steam" },
    state: {
      multiverse: { currentUniverseId: "mv-easy-2" },
      erasedSketchIds: ["sketch"],
    },
  });
  const catalogEnemy = { ...enemy, maxHp: 5.009, vulnerability: ["bleedChance", 2] };
  const effective = buildSteamEnemy(catalogEnemy, assumptions.steam);
  assert.equal(effective.maxHp, 250);
  assert.equal(effective.attack, 10);
  assert.deepEqual(effective.vulnerability, ["bleedChance", 20]);
  assert.equal(buildSteamEnemy(effective, assumptions.steam), effective);

  const fallback = normalizeFightFixture({ assumptions }, { enemy: catalogEnemy, player });
  assert.equal(fallback.enemy.source, "catalog");
  const fixture = normalizeFightFixture({ assumptions, enemy: { id: "sketch", maxHp: 91, attack: 13 } });
  assert.equal(buildSteamEnemy(fixture.enemy, assumptions.steam).maxHp, 91);
  const route = simulateRoute({
    state: { saveProfile: "steam", multiverse: { currentUniverseId: "mv-medium-2" }, erasedSketchIds: ["sketch"] },
    sketches: { sketch: { stats: { maxHp: 9.9, attack: 1 } } },
    targetId: "sketch",
    baseStats: player,
  });
  assert.equal(route.target.stats.maxHp, 9);
  assert.equal(route.target.stats.attack, 2);
});

test("Steam enemy stack chances and Slowed attack timing use runtime units", () => {
  const assumptions = combatAssumptionsFromSave({ saveProfile: "steam" });
  const fight = simulateFight({
    player,
    enemy: { ...enemy, maxHp: 10000, attackSpeed: 990, slowChance: 50000 },
    assumptions,
    rng: () => 0.5,
    maxSeconds: 2,
    trace: { seconds: 2 },
  });
  const attacks = fight.trace.filter((event) => event.event === "attack");
  assert.equal(attacks[0].statuses.player.Slow, 500);
  assert.equal(attacks[1].attackerSide, "player");
  assert.equal(attacks[1].time, 1.5);
});

test("Varnish restores 25% HP for an erased encounter in combat and saved fixtures", () => {
  const sketch = { id: "sharper", stats: { maxHp: 100, attack: 1, attackSpeed: 9000, varnish: 100 } };
  for (const erased of [false, true]) {
    const assumptions = combatAssumptionsFromSave({ saveProfile: "steam", erasedSketchIds: erased ? [sketch.id] : [] });
    const enemy = enemyFromSketch(sketchForEncounter(sketch, assumptions));
    const fixtureEnemy = normalizeFightFixture({ enemy }).enemy;
    for (const target of [enemy, fixtureEnemy]) {
      const fight = simulateFight({
        assumptions, enemy: target, player: { ...player, attack: 200, accuracy: 100, minDamage: 100, maxDamage: 100 },
        rng: () => 0.5, maxSeconds: 1.5, trace: { seconds: 1.5 },
      });
      const trigger = fight.trace.flatMap((event) => event.mechanics ?? []).find((item) => item.type === "varnish");
      assert.equal(trigger?.restorePercent, erased ? 25 : 50);
      assert.equal(fight.enemyHp, erased ? 12.5 : 50);
    }
  }
});

test("Steam Seppuku evaluates configured rule combinations at the fight clock", () => {
  const state = {
    saveProfile: "steam",
    skillLevels: { "fund-seppuku": "1" },
    seppukuConfig: {
      enabled: true,
      rules: [{
        mode: "all",
        conditions: [{ stat: "timeInBattle", threshold: 3 }, { stat: "enemyHp", threshold: 90 }],
      }],
    },
  };
  const result = simulateFight({
    player,
    enemy: { ...enemy, maxHp: 10000 },
    assumptions: combatAssumptionsFromSave(state),
    rng: () => 0.5,
    maxSeconds: 10,
  });
  assert.equal(result.winner, "enemy");
  assert.equal(result.reason, "seppuku");
  assert.equal(result.seconds, 3);
  assert.equal(result.damageBreakdown.player.self > 0, true);
});

test("Steam Resonance uses the player Inspiration cap bonus and uncapped enemy buffs", () => {
  const stats = { maxHp: 1e9, attack: 1, attackSpeed: 1100, inspirationChance: 20000, resonanceChance: 100 };
  const assumptions = combatAssumptionsFromSave({ saveProfile: "steam", fundamentals: { inspirationCapBonus: 1000 } });
  const fight = simulateFight({
    player: stats, enemy: stats, assumptions, rng: () => 0.5, maxSeconds: 1.5, trace: { seconds: 1.5 },
  });
  const resonance = fight.trace.flatMap((event) => event.mechanics ?? []).filter((item) => item.type === "resonance");
  assert.deepEqual(resonance.map(({ side, before, after }) => [side, before, after]).sort(), [
    ["enemy", 200, 201], ["player", 200, 201],
  ]);
});

test("Steam cards affect positive rewards and currency after exponentiation", () => {
  const sketch = {
    rarity: "scrap",
    rewards: [{ statName: "attack", amount: 10000 }, { statName: "dodge", amount: 100 }, { statName: "regen", amount: -8 }],
    currencyRewards: [{ name: "Graphite", amount: 10 }],
  };
  const baseStats = { attack: 0, dodge: 0, regen: 10 };
  const state = {
    saveProfile: "steam",
    fundamentals: { rewardDecay: 0.5, graphiteRewardExponent: 1 },
    sketchVictories: { sketch: 1 },
    multiverse: { collectibles: { cards: { sketch: { first: 2, second: 1 } } } },
  };
  const sketches = { sketch };
  const plan = simulateRoute({ state, sketches, baseStats, routeIds: ["sketch"] });
  const stats = applySketchRewards({
    state, sketches, baseStats, defeatedIds: ["sketch"], rewardDecay: 0.5, existingVictories: state.sketchVictories,
  });
  assert.ok(Math.abs(plan.finalStats.attack - 8000.666666666667) < 1e-8);
  assert.equal(plan.finalStats.dodge, 60.005);
  assert.ok(Math.abs(plan.finalStats.regen - 4.666666666667) < 1e-8);
  assert.ok(Math.abs(plan.currencies.Graphite - 80.006666666667) < 1e-8);
  for (const key of Object.keys(stats)) assert.ok(Math.abs(stats[key] - plan.finalStats[key]) < 1e-8);
});

test("Steam Wound converts on a status tick and respects immunity to the new status", () => {
  const fight = (immunities) => simulateFight({
    player: { ...player, attackSpeed: 600, woundChance: 500 },
    enemy: { ...enemy, maxHp: 10000, attackSpeed: 4000, immunities },
    assumptions: combatAssumptionsFromSave({ saveProfile: "steam" }),
    rng: (label) => label === "tick.Wound.convert" ? 0.15 : 0.5,
    maxSeconds: 1.1,
    trace: { seconds: 2 },
  }).trace.find((event) => event.event === "tick");
  assert.deepEqual(fight([]).statuses.enemy, { Hinder: 5 });
  assert.deepEqual(fight(["hinderChance"]).statuses.enemy, {});
});

test("Steam Paralysis cancels an attack and doubles one subsequent landed hit", () => {
  const result = simulateFight({
    player: { ...player, attack: 10, attackSpeed: 600, minDamage: 100, maxDamage: 100, paralysisChance: 100000 },
    enemy: { ...enemy, attackSpeed: 1000, maxHp: 10000 },
    assumptions: combatAssumptionsFromSave({ saveProfile: "steam" }),
    rng: () => 0.5,
    maxSeconds: 1.3,
    trace: { seconds: 2 },
  });
  const attacks = result.trace.filter((event) => event.event === "attack");
  assert.equal(attacks[0].statuses.enemy.Paralysis, 1000);
  assert.equal(attacks[1].action.reason, "paralysis");
  assert.equal(attacks[1].statuses.enemy.ParalysisExposed, 1);
  assert.equal(attacks[2].enemyHp, 9970);
  assert.equal(attacks[2].statuses.enemy.ParalysisExposed, undefined);
});

test("Steam Intercept redirects on-hit and periodic buffs, with immunity handling", () => {
  const run = (immunities) => simulateFight({
    player: { ...player, attackSpeed: 600, hasteChance: 100, inspirationChance: 100, immunities },
    enemy: { ...enemy, maxHp: 10000, attackSpeed: 4000, interceptChance: 100 },
    assumptions: combatAssumptionsFromSave({ saveProfile: "steam" }),
    rng: () => 0.5,
    maxSeconds: 1.1,
    trace: { seconds: 2 },
  }).trace;
  const intercepted = run([]);
  const firstAttack = intercepted.find((event) => event.event === "attack");
  assert.deepEqual(firstAttack.statuses.enemy, { Haste: 1 });
  assert.equal(firstAttack.mechanics.find((mechanic) => mechanic.type === "intercept")?.intendedSide, "player");
  assert.deepEqual(intercepted.find((event) => event.event === "tick").statuses.enemy, { Haste: 1, Inspiration: 1 });
  const protectedPlayer = run(["interceptChance"]);
  assert.deepEqual(protectedPlayer.find((event) => event.event === "tick").statuses.player, { Haste: 1, Inspiration: 1 });
});

test("Steam Grapple rolls individually for debuffs and respects opacity and immunity", () => {
  const result = simulateFight({
    player: { ...player, attackSpeed: 600, grappleChance: 100 },
    enemy: { ...enemy, maxHp: 10000, attackSpeed: 4000, opacity: 50, immunities: ["hinderChance"] },
    assumptions: combatAssumptionsFromSave({ saveProfile: "steam" }),
    rng: (label) => label === "status.Grapple.Slow" ? 0.75 : 0.25,
    maxSeconds: 0.8,
    trace: { seconds: 2 },
  });
  const attack = result.trace.find((event) => event.event === "attack");
  assert.deepEqual(attack.statuses.enemy, { Frailty: 5, Paralysis: 5 });
});

test("Steam Elemental Manipulation converts Freeze into Burn and Burn into Black Flame", () => {
  const result = simulateFight({
    player: { ...player, attackSpeed: 600, freezeChance: 200000, burnChance: 2000, elementalManipulationChance: 1000 },
    enemy: { ...enemy, maxHp: 10000, attackSpeed: 4000 },
    assumptions: combatAssumptionsFromSave({ saveProfile: "steam" }),
    rng: () => 0.5,
    maxSeconds: 0.8,
    trace: { seconds: 2 },
  });
  const attack = result.trace.find((event) => event.event === "attack");
  assert.deepEqual(attack.statuses.enemy, { Freeze: 1980, Burn: 39, BlackFlame: 1 });
});

test("Steam Disease Spread copies existing infections with per-status limits and defenses", () => {
  const result = simulateFight({
    player: { ...player, attackSpeed: 4000, diseaseSpreadChance: 200 },
    enemy: {
      ...enemy, maxHp: 10000, attackSpeed: 800, poisonChance: 500, plagueChance: 300, curseChance: 100,
      leapChance: 100, immunities: ["plagueChance"],
    },
    assumptions: combatAssumptionsFromSave({ saveProfile: "steam" }),
    rng: () => 0.5,
    maxSeconds: 1.1,
    trace: { seconds: 2 },
  });
  const tick = result.trace.find((event) => event.event === "tick");
  assert.equal(tick.statuses.player.Poison, 5);
  assert.deepEqual(tick.statuses.enemy, { Poison: 1, Curse: 1 });
});
test("Steam combat rejects a zero or negative attack delay from raw battle rewards", () => {
  for (const attackSpeed of [0, -200]) {
    assert.throws(() => simulateFight({
      player: { maxHp: 10, attack: 1, attackSpeed },
      enemy: { maxHp: 10, attack: 1, attackSpeed: 1000 },
      assumptions: { steam: {} },
    }), /positive effective attackSpeed/);
  }
});

const fixedDamage = { minDamage: 100, maxDamage: 100 };
const steamAssumptions = combatAssumptionsFromSave({ saveProfile: "steam" });

function firstAttackBy(side, attacker, defender, options = {}) {
  const result = simulateFight({
    player: side === "player" ? attacker : defender,
    enemy: side === "player" ? defender : attacker,
    assumptions: steamAssumptions,
    rng: () => 0.5,
    maxSeconds: 0.95,
    trace: { seconds: 1 },
    ...options,
  });
  return result.trace.find((event) => event.event === "attack" && event.attackerSide === side);
}

test("Steam Berserk checks the attacker's current HP and the target's immunity on both sides", () => {
  for (const side of ["player", "enemy"]) {
    const attacker = { ...fixedDamage, maxHp: 100, attack: 10, attackSpeed: 750, berserk: 250 };
    const defender = { ...fixedDamage, maxHp: 1000, attack: 75, attackSpeed: 500 };
    for (const [incomingDamage, expectedDamage] of [[74, 10], [75, 25], [76, 25]]) {
      const event = firstAttackBy(side, attacker, { ...defender, attack: incomingDamage });
      assert.equal(event.action.totalDamage, expectedDamage, side);
      if (incomingDamage === 75) {
        assert.deepEqual(event.mechanics.find(({ type }) => type === "offense").berserk, {
          triggered: true, hpRatio: 0.25, threshold: 0.25, multiplier: 2.5, before: 10, after: 25,
        });
      }
    }
    assert.equal(firstAttackBy(side, attacker, { ...defender, immunities: ["berserk"] }).action.totalDamage, 10);
    assert.equal(firstAttackBy(side, { ...attacker, berserk: 100 }, defender).action.totalDamage, 10);
    assert.equal(firstAttackBy(side, attacker, defender, { assumptions: {} }).action.totalDamage, 10);
  }
});

test("Steam Accuracy multiplies damage before mitigation for each defense it bypasses", () => {
  for (const side of ["player", "enemy"]) {
    const attacker = { ...fixedDamage, maxHp: 1000, attack: 100, attackSpeed: 500, accuracy: 80 };
    const defender = { maxHp: 1000, attack: 0, attackSpeed: 2000, parryDmg: 50, armor: 25 };
    for (const [dodge, parry, expectedDamage] of [[0, 0, 75], [100, 0, 125], [0, 100, 125], [100, 100, 200]]) {
      const event = firstAttackBy(side, attacker, { ...defender, dodge, parry });
      assert.equal(event.action.totalDamage, expectedDamage, side);
    }
    const evasiveDefender = { ...defender, dodge: 100, parry: 100 };
    const event = firstAttackBy(side, attacker, evasiveDefender);
    assert.deepEqual(event.mechanics.filter(({ type }) => type === "evasion").map(
      ({ mode, outcome, incomingDamage, outgoingDamage }) => [mode, outcome, incomingDamage, outgoingDamage],
    ), [["dodge", "bypassed", 100, 150], ["parry", "bypassed", 150, 225]]);
    const legacy = firstAttackBy(side, attacker, evasiveDefender, { assumptions: {} });
    assert.equal(legacy.action.totalDamage, 75);

    const parried = firstAttackBy(side, attacker, evasiveDefender, {
      rng: (label) => label === "evasion.parryAccuracy" ? 0.9 : 0.5,
    });
    assert.equal(parried.action.parriedHits, 1);
    assert.equal(parried[side + "Hp"], 925);
  }
});

test("Steam parry damage immunity protects the attacker and still allows the defender to parry", () => {
  for (const side of ["player", "enemy"]) {
    const attacker = { ...fixedDamage, maxHp: 1000, attack: 100, attackSpeed: 500, accuracy: 0, immunities: ["parryDmg"] };
    const defender = { maxHp: 1000, attack: 0, attackSpeed: 2000, parry: 100, parryDmg: 50 };
    const immune = firstAttackBy(side, attacker, defender);
    assert.equal(immune.action.parriedHits, 1);
    assert.equal(immune[side + "Hp"], 1000);
    const vulnerable = firstAttackBy(side, { ...attacker, immunities: [] }, { ...defender, immunities: ["parryDmg"] });
    assert.equal(vulnerable[side + "Hp"], 950);
    const legacy = firstAttackBy(side, attacker, defender, { assumptions: {} });
    assert.equal(legacy[side + "Hp"], 1000);
  }
});

test("Steam counters apply Berserk and both Accuracy damage multipliers", () => {
  const { trace } = simulateFight({
    player: { ...fixedDamage, maxHp: 1000, attack: 75, attackSpeed: 500, dodge: 100, parry: 100 },
    enemy: { ...fixedDamage, maxHp: 100, attack: 10, attackSpeed: 2000, accuracy: 80, berserk: 200, counter: 100 },
    assumptions: steamAssumptions,
    rng: () => 0.5,
    maxSeconds: 0.9,
    trace: { seconds: 1 },
  });
  const counter = trace.find(({ event }) => event === "pending_effect");
  assert.equal(counter.action.damage, 45);
  assert.equal(counter.playerHp, 955);
});

test("Steam lifesteal immunity prevents healing when striking an immune target on either side", () => {
  for (const side of ["player", "enemy"]) {
    const attacker = { ...fixedDamage, maxHp: 1000, attack: 100, attackSpeed: 750, lifesteal: 50 };
    const defender = { ...fixedDamage, maxHp: 1000, attack: 250, attackSpeed: 500, immunities: ["lifesteal"] };
    const immune = firstAttackBy(side, attacker, defender);
    assert.equal(immune.action.totalDamage, 100);
    assert.equal(immune[side + "Hp"], 750);
    const vulnerable = firstAttackBy(side, { ...attacker, immunities: ["lifesteal"] }, { ...defender, immunities: [] });
    assert.equal(vulnerable[side + "Hp"], 800);
    const legacy = firstAttackBy(side, attacker, defender, { assumptions: {} });
    assert.equal(legacy[side + "Hp"], 750);
  }
});

test("Steam speedup expiry recalculates attack and tick deadlines and preserves an already queued counter", () => {
  const assumptions = combatAssumptionsFromSave({
    saveProfile: "steam",
    fundamentals: { timeAcceleration: 2, battleSpeedupRate: 2 },
    activeBattleSpeedupRemainingSeconds: 0.275,
  });
  const { trace } = simulateFight({
    player: { ...fixedDamage, maxHp: 1000, attack: 10, attackSpeed: 1000, inspirationChance: 100 },
    enemy: { ...fixedDamage, maxHp: 1000, attack: 20, attackSpeed: 1600, counter: 100, regen: 1 },
    assumptions,
    rng: () => 0.5,
    maxSeconds: 0.9,
    trace: { seconds: 1 },
  });
  assert.deepEqual(trace.filter(({ event }) => event === "attack").map(({ attackerSide, time }) => [attackerSide, time]),
    [["player", 0.25], ["player", 0.75], ["enemy", 0.8]]);
  assert.deepEqual(trace.filter(({ event }) => event === "tick").map(
    ({ healing, statusDelta, time }) => [time, healing.enemy.regen, statusDelta.player.Inspiration?.delta ?? 0],
  ), [[0.25, 1, 0], [0.251, 0, 1], [0.751, 1, 0], [0.752, 0, 1]]);
  assert.equal(trace.find(({ event }) => event === "pending_effect").time, 0.3);
  assert.equal(trace.find(({ event }) => event === "pending_effect").action.damage, 20);
});
