import assert from "node:assert/strict";
import test from "node:test";
import { redrawFarmFixture } from "../fixtures/redraw-farm.js";
import { createRedrawBoardSampler } from "../src/redraw-boards.js";
import { nextRedrawStart, planRedrawFarm } from "../src/redraw-farm-plan.js";
import { createWebAnalysis } from "../src/web-core.js";

test("the dashboard finds a repeated two-helper route and measures all three drafts on the same board", () => {
  const { state, ...options } = redrawFarmFixture();
  state.rarityChances.masterpiece = 50;
  const { redrawFarmPlan: result } = createWebAnalysis({ ...options, save: { state }, strategyOptions: { targetWinRate: 0.75 } });
  assert.equal(result.goal, 0.75);
  assert.equal(result.status, "found");
  const [plan] = result.plans;
  assert.deepEqual(plan.required.map(({ id }) => id), [options.targetId, "first", "second"]);
  assert.deepEqual(plan.stages.map(({ id, wins }) => [id, wins]), [["first", 2], ["second", 1]]);
  assert.ok(Math.abs(plan.boardOdds.rate - 0.125) < 0.025);
  assert.ok(Math.abs(plan.minimumOdds.rate - 0.5) < 0.06);
  assert.equal(plan.minimumOdds.hits, plan.boardOdds.hits);
  assert.equal(plan.targetWinRate, 1);
});

test("overlapping alternatives are counted once per board", () => {
  const options = redrawFarmFixture();
  for (const helper of [options.sketches.first, options.sketches.second]) {
    helper.stats.maxHp = 5;
    helper.rewards[0].amount = 15;
  }
  const result = planRedrawFarm(options);
  assert.equal(result.plans.length, 2);
  assert.ok(Math.abs(result.anyPlanOdds.rate - 0.75) < 0.035);
  const [a, b] = result.plans;
  assert.equal(result.anyPlanOdds.hits, a.boardOdds.hits + b.boardOdds.hits - result.accepted);
});

test("Steam restarts with persistent bonuses and drops shop, combat, tool and victory state", () => {
  const state = { saveProfile: "steam", redrawCount: 10,
    playerStats: { maxHp: 1e9, attack: 1e6, attackSpeed: 500 }, battleStats: { attack: 123, maxHp: 999 },
    glossaryMultiplier: 3, fundamentals: { attackIncrease: 100, hpIncrease: 50 },
    multiverse: { currentUniverseId: "mv-original", firstClearPerkIds: ["starting-speed"] },
    activeMeditationBuffs: [{ stat: "attack", multiplier: 10 }], shopLevels: { upgrade_atk_graphite: 40 },
    sketchVictories: { a: 55 }, boostedSketchIds: ["a"], erasedSketchIds: ["b"] };
  const original = structuredClone(state);
  const start = nextRedrawStart(state);
  assert.equal(start.stats.attack, 6);
  assert.equal(start.stats.maxHp, 45);
  assert.equal(start.stats.attackSpeed, 2800);
  assert.equal(start.state.redrawCount, 11);
  assert.deepEqual(start.state.sketchVictories, {});
  assert.equal(start.state.boostedSketchIds, undefined);
  assert.equal(start.state.erasedSketchIds, undefined);
  assert.deepEqual(state, original);
});

test("ordinary draws respect independent Scrap rolls, manual guarantees, retired sketches and banish replacements", () => {
  const sketches = Object.fromEntries(["old", "replacement", "ban", "forced", "retired", "scrap"].map((id) =>
    [id, { id, rarity: id === "scrap" ? "scrap" : "rough" }]));
  const state = { saveProfile: "steam", availableSketchCountsByRarity: { rough: 1 },
    glossaryUnlocks: Object.keys(sketches), rarityChances: { rough: 50, scrap: 50 },
    fundamentals: { roughBanishSlots: 1 }, multiverse: { retiredSketchIds: ["retired"] },
    guaranteedSketchIds: ["old"], guaranteedSketchSelections: { rough: ["forced"] },
    banishedSketchSelections: { rough: ["ban"] } };
  const sampler = createRedrawBoardSampler(sketches, state);
  const rolls = [1, 1, 0, 1, 0, 0.75];
  assert.deepEqual(sampler.sample(() => rolls.shift() ?? 0.75).sort(), ["forced", "replacement", "scrap"]);
  assert.equal(sampler.canAppear("ban"), false);
  assert.equal(sampler.canAppear("retired"), false);
  assert.equal(sampler.alwaysDrawn("forced"), true);
  assert.equal(sampler.alwaysDrawn("replacement"), false);
  assert.equal(sampler.alwaysDrawn("scrap"), false);
  assert.deepEqual(sampler.sample(() => 0.99), ["forced"]);
});

test("unknown odds, exhausted redraw limits and a target outside the pool have distinct results", () => {
  const options = redrawFarmFixture();
  assert.equal(planRedrawFarm({ ...options, state: {} }).status, "missing_draw_settings");
  assert.equal(planRedrawFarm({ ...options, state: { ...options.state, saveProfile: "steam", redrawCount: 21,
    streamlinedSearchRetries: 1, multiverse: { currentUniverseId: "mv-medium-5" } } }).status, "redraw_limit");
  options.state.rarityChances.masterpiece = 0;
  assert.equal(planRedrawFarm(options).status, "outside_draw_pool");
});
