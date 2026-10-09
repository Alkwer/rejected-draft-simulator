import test from "node:test";
import assert from "node:assert/strict";

import { analyzeBuildAdvice } from "../src/build-advisor.js";

const sketches = {
  duct_taped_banana: {
    id: "duct_taped_banana",
    name: "Duct-Taped Banana",
    rarity: "masterpiece",
    stats: { maxHp: 10000, attack: 500, bananaPeelChance: 50, accuracy: 140 },
  },
  rose_window: {
    id: "rose_window",
    name: "Rose Window",
    rarity: "masterpiece",
    stats: { maxHp: 12000, regen: 900, armor: 600, remedy: 80, opacity: 30 },
  },
  mobius_strip: {
    id: "mobius_strip",
    name: "Mobius Strip",
    rarity: "masterpiece",
    stats: { maxHp: 14000, burnChance: 80, burnDamage: 400, remedy: 120 },
  },
  transcendent_paragon: {
    id: "transcendent_paragon",
    name: "Transcendent Paragon",
    rarity: "opus",
    stats: { maxHp: 20000, armor: 2000, regen: 1000 },
  },
  bleed_route: {
    id: "bleed_route",
    name: "Bleed Route",
    rarity: "opus",
    stats: { bleedChance: 20, leapChance: 5 },
    rewards: [{ statName: "bleedChance", amount: 10 }],
    currencyRewards: [{ name: "Ink", amount: 1e5 }],
  },
  sustain_route: {
    id: "sustain_route",
    name: "Sustain Route",
    rarity: "framed",
    stats: { maxHp: 5000, regen: 200 },
    rewards: [
      { statName: "maxHp", amount: 1000 },
      { statName: "regen", amount: 100 },
    ],
  },
  bad_route: {
    id: "bad_route",
    name: "Bad Route",
    rarity: "rough",
    stats: { attack: 10 },
    rewards: [{ statName: "maxHp", amount: -1000 }],
  },
  armor_pen_route: {
    id: "armor_pen_route",
    name: "Armor Pen Route",
    rarity: "opus",
    stats: { armorPen: 300 },
    rewards: [{ statName: "armorPen", amount: 300 }],
  },
  freeze_route: {
    id: "freeze_route",
    name: "Freeze Route",
    rarity: "opus",
    stats: { freezeChance: 50 },
    rewards: [{ statName: "freezeChance", amount: 12 }],
  },
  burn_route: {
    id: "burn_route",
    name: "Burn Route",
    rarity: "opus",
    stats: { burnChance: 40, burnDamage: 300 },
    rewards: [
      { statName: "burnChance", amount: 8 },
      { statName: "burnDamage", amount: 300 },
    ],
  },
  scrap_burn: {
    id: "scrap_burn",
    name: "Scrap Burn",
    rarity: "scrap",
    stats: { burnDamage: 1000 },
    rewards: [{ statName: "burnDamage", amount: 1000 }],
  },
};

test("analyzeBuildAdvice uses target-specific priorities", () => {
  const duct = analyzeBuildAdvice({ sketches, state: {}, targetId: "duct_taped_banana", baseStats: {} });
  const rose = analyzeBuildAdvice({ sketches, state: {}, targetId: "rose_window", baseStats: {} });
  const mobius = analyzeBuildAdvice({ sketches, state: {}, targetId: "mobius_strip", baseStats: {} });
  const paragon = analyzeBuildAdvice({ sketches, state: {}, targetId: "transcendent_paragon", baseStats: {} });

  assert.equal(duct.targetPlan.id, "duct_taped_banana");
  assert.ok(duct.targetPlan.priorityStats.some((item) => item.stat === "bleedChance"));
  assert.ok(duct.targetPlan.priorityStats.some((item) => item.stat === "accuracy"));
  assert.ok(rose.targetPlan.priorityStats.some((item) => item.stat === "freezeChance"));
  assert.ok(rose.targetPlan.priorityStats.some((item) => item.stat === "armorPen"));
  assert.ok(mobius.targetPlan.priorityStats.some((item) => item.stat === "burnChance"));
  assert.ok(mobius.targetPlan.priorityStats.some((item) => item.stat === "remedy"));
  assert.ok(paragon.targetPlan.priorityStats.some((item) => item.stat === "execute"));
  assert.ok(paragon.targetPlan.priorityStats.some((item) => item.stat === "armorPen"));
});

test("analyzeBuildAdvice recommends tools and active run actions", () => {
  const advice = analyzeBuildAdvice({
    sketches,
    targetId: "duct_taped_banana",
    baseStats: { maxHp: 1000, attack: 200, accuracy: 20, bleedChance: 1 },
    state: {
      availableSketches: ["bleed_route", "sustain_route", "bad_route", "duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: {},
      fundamentals: {
        maxVictories: 250,
        rewardBoosterUses: 1,
        preciseEraserUses: 1,
        meditationRewardMax: 0.1,
      },
      boostedSketchIds: [],
      erasedSketchIds: [],
      guaranteedSketchSelections: {
        rough: [],
        framed: [],
        opus: [],
        masterpiece: [],
      },
    },
  });

  assert.equal(advice.tools.eraser[0].id, "duct_taped_banana");
  assert.equal(advice.tools.booster[0].id, "bleed_route");
  assert.ok(advice.tools.guarantee.some((item) => item.id === "bleed_route"));
  assert.equal(advice.tools.meditation[0].id, "bleed_route");
  assert.equal(advice.activeRun.finish[0].id, "bleed_route");
  assert.ok(advice.activeRun.hide.some((item) => item.id === "bad_route"));
  assert.ok(advice.activeRun.bestNextRewards.some((item) => item.id === "bleed_route"));
});

test("analyzeBuildAdvice marks Masterpiece targets as ineligible for Precise Eraser", () => {
  const advice = analyzeBuildAdvice({
    sketches,
    targetId: "duct_taped_banana",
    baseStats: {},
    state: {
      fundamentals: { preciseEraserUses: 1 },
      erasedSketchIds: [],
    },
  });

  assert.equal(advice.tools.eraser[0].id, "duct_taped_banana");
  assert.equal(advice.tools.eraser[0].action, "not_eligible");
  assert.equal(advice.tools.eraser[0].reasonCode, "masterpiece_not_eligible");
  assert.match(advice.tools.eraser[0].reason, /Masterpiece/);
});

test("analyzeBuildAdvice marks Opus targets as ineligible until Opus Eraser is unlocked", () => {
  const advice = analyzeBuildAdvice({
    sketches,
    targetId: "transcendent_paragon",
    baseStats: {},
    state: {
      fundamentals: { preciseEraserUses: 1, opusEraser: 0 },
      erasedSketchIds: [],
    },
  });

  assert.equal(advice.tools.eraser[0].id, "transcendent_paragon");
  assert.equal(advice.tools.eraser[0].action, "not_eligible");
  assert.equal(advice.tools.eraser[0].reasonCode, "opus_eraser_not_unlocked");
});

test("analyzeBuildAdvice recommends Precise Eraser for Opus targets with Opus Eraser", () => {
  const advice = analyzeBuildAdvice({
    sketches,
    targetId: "transcendent_paragon",
    baseStats: {},
    state: {
      fundamentals: { preciseEraserUses: 1, opusEraser: 1 },
      erasedSketchIds: [],
    },
  });

  assert.equal(advice.tools.eraser[0].id, "transcendent_paragon");
  assert.equal(advice.tools.eraser[0].action, "erase_target");
});

test("analyzeBuildAdvice identifies the biggest build problem", () => {
  const advice = analyzeBuildAdvice({
    sketches,
    targetId: "rose_window",
    baseStats: { maxHp: 1000, attack: 100, armorPen: 0, freezeChance: 0, remedy: 0 },
    state: {},
  });

  const codes = advice.biggestProblems.map((item) => item.code);
  assert.ok(codes.includes("armor_pen_low"));
  assert.ok(codes.includes("damage_low"));
  assert.ok(codes.includes("freeze_low"));
});

test("analyzeBuildAdvice does not recommend scrap sketches for guarantee", () => {
  const advice = analyzeBuildAdvice({
    sketches,
    targetId: "mobius_strip",
    baseStats: {},
    state: {},
  });

  assert.ok(!advice.tools.guarantee.some((item) => item.rarity === "scrap"));
});
