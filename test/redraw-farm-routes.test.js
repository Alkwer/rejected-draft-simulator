import assert from "node:assert/strict";
import test from "node:test";

import { findRedrawFarmRoutes } from "../src/redraw-farm-routes.js";

function sketch(id, maxHp, attack = 0, reward = 0) {
  return {
    id, rarity: id === "target" ? "masterpiece" : "rough",
    stats: { maxHp, attack, attackSpeed: 1000, minDamage: 100, maxDamage: 100 },
    rewards: reward ? [{ statName: "attack", amount: reward }] : [],
  };
}

const baseStats = { maxHp: 100, attack: 10, attackSpeed: 1000, minDamage: 100, maxDamage: 100 };

function options(overrides = {}) {
  return {
    sketches: { target: sketch("target", 20), first: sketch("first", 5, 0, 6), second: sketch("second", 15, 0, 6) },
    state: { fundamentals: { maxVictories: 1 } },
    baseStats, targetId: "target", targetWinRate: 0.5, trials: 64, maxSeconds: 1.5,
    seed: "redraw-route", boards: [["target", "first", "second"]], ...overrides,
  };
}

test("combines helpers that individually cannot reach the target and can unlock an initially unwinnable fight", () => {
  const settings = options();
  assert.equal(findRedrawFarmRoutes({ ...settings, boards: [["target", "first"]] }).status, "not_found");
  assert.equal(findRedrawFarmRoutes({ ...settings, boards: [["target", "second"]] }).status, "not_found");
  const result = findRedrawFarmRoutes(settings);
  assert.equal(result.status, "found");
  assert.deepEqual(result.plans[0].requiredIds, ["target", "first", "second"]);
  assert.deepEqual(result.plans[0].routeIds, ["first", "second"]);
  assert.equal(result.plans[0].targetWinRate, 1);
  assert.equal(result.plans[0].minHelperWinRate, 1);
  assert.deepEqual(result, findRedrawFarmRoutes(settings));
});

test("does not combine helpers from different boards, and counts repeated sampled boards", () => {
  const firstBoard = ["target", "first"];
  const boardWithBoth = ["target", "first", "second"];
  const disjoint = findRedrawFarmRoutes(options({ boards: [firstBoard, ["target", "second"]] }));
  assert.equal(disjoint.status, "not_found");
  const result = findRedrawFarmRoutes(options({ boards: [firstBoard, boardWithBoth, boardWithBoth] }));
  assert.equal(result.plans[0].sampledBoardHits, 2);
  assert.equal(result.targetBoardHits, 3);
});

test("checks decaying rewards and caps across a long sequence on the new board", () => {
  const sketches = { target: sketch("target", 43), first: sketch("first", 5, 0, 10) };
  const settings = options({ sketches, boards: [["target", "first"]], state: {
    availableSketches: ["old_sketch"], fundamentals: { maxVictories: 40, rewardDecay: 1 },
  } });
  const result = findRedrawFarmRoutes(settings);
  assert.equal(result.status, "found");
  assert.deepEqual(result.plans[0].requiredIds, ["target", "first"]);
  assert.ok(result.plans[0].routeIds.length > 8);
  assert.ok(result.plans[0].routeIds.every((id) => id === "first"));
  const capped = findRedrawFarmRoutes({
    ...settings, state: { ...settings.state, fundamentals: { maxVictories: 8, rewardDecay: 1 } },
  });
  assert.equal(capped.status, "not_found");
});

test("distinguishes missing or ineligible targets and can report a direct target in a culling universe", () => {
  const state = { saveProfile: "steam", gameMode: "normal", multiverse: { currentUniverseId: "mv-medium-2" } };
  const settings = options({ state });
  assert.equal(findRedrawFarmRoutes({ ...settings, boards: [["first"]] }).status, "target_not_sampled");
  assert.equal(findRedrawFarmRoutes({ ...settings, state: { ...state, hiddenSketches: ["target"] } }).status, "target_unavailable");
  assert.equal(findRedrawFarmRoutes(settings).status, "unsupported_culling");
  const direct = findRedrawFarmRoutes({ ...settings, baseStats: { ...baseStats, attack: 100 } });
  assert.equal(direct.status, "found");
  assert.deepEqual(direct.plans[0].requiredIds, ["target"]);
  assert.deepEqual(direct.plans[0].routeIds, []);
});

test("reports the verified win count between milestones on a long farm", () => {
  const settings = options({ sketches: { target: sketch("target", 102), first: sketch("first", 5, 0, 1) },
    boards: [["target", "first"]], state: { fundamentals: { maxVictories: 200, rewardDecay: 0 } } });
  const result = findRedrawFarmRoutes(settings);
  assert.equal(result.status, "found");
  assert.deepEqual(result.plans[0].routeIds, Array(92).fill("first"));
});

test("Medium 2 can certify increasing rarity routes irrespective of which surplus draft gets culled", () => {
  const settings = options();
  const result = findRedrawFarmRoutes({ ...settings,
    sketches: { ...settings.sketches, first: { ...settings.sketches.first, rarity: "scrap" } },
    state: { saveProfile: "steam", fundamentals: { maxVictories: 1 }, multiverse: { currentUniverseId: "mv-medium-2" } },
    // Medium 2 doubles enemy HP and grants 75% of ordinary stat rewards.
    baseStats: { ...baseStats, attack: 32 },
  });
  assert.equal(result.status, "found");
  assert.deepEqual(result.plans[0].routeIds, ["first", "second"]);
});

test("omits Madman farm steps that could cull the still-unbeaten target", () => {
  const state = { saveProfile: "steam", gameMode: "madman", fundamentals: { maxVictories: 1 } };
  const result = findRedrawFarmRoutes(options({ state }));
  assert.equal(result.status, "unsupported_culling");
  assert.equal(result.skippedCulling, true);
  assert.deepEqual(result.plans, []);
});

test("leaves room for beatable opening fights when the biggest rewards are unreachable", () => {
  const unreachable = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const id = `unreachable_${index}`;
    return [id, sketch(id, 1000, 0, 100)];
  }));
  const sketches = { ...unreachable, target: sketch("target", 15), first: sketch("first", 5, 0, 6) };
  const result = findRedrawFarmRoutes(options({ sketches, boards: [Object.keys(sketches)] }));
  assert.equal(result.candidateCount, 31);
  assert.equal(result.status, "found");
  assert.deepEqual(result.plans[0].routeIds, ["first"]);
});

test("does not certify a 100% true win rate from an all-winning sample", () => {
  const settings = options({ baseStats: { ...baseStats, attack: 100 }, targetWinRate: 1 });
  assert.deepEqual(findRedrawFarmRoutes(settings).plans, []);
});
