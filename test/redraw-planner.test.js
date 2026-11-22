import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeTargetedRedrawLimits,
  buildTargetedRedrawCandidates,
  estimateFindNewSketchOdds,
  estimateRedrawOdds,
  evaluateCurrentRun,
  recommendTargetedRedrawSettings,
} from "../src/redraw-planner.js";

const sketches = {
  rough_a: { id: "rough_a", name: "Rough A", rarity: "rough", rewards: [{ statName: "attack", amount: 1 }] },
  rough_b: { id: "rough_b", name: "Rough B", rarity: "rough", rewards: [{ statName: "maxHp", amount: 1 }] },
  framed_a: { id: "framed_a", name: "Framed A", rarity: "framed", rewards: [{ statName: "regen", amount: 1 }] },
  opus_a: {
    id: "opus_a",
    name: "Opus A",
    rarity: "opus",
    currencyRewards: [{ name: "Graphite", amount: 100 }],
  },
  opus_b: {
    id: "opus_b",
    name: "Opus B",
    rarity: "opus",
    currencyRewards: [{ name: "Wax", amount: 100 }],
  },
  duct: { id: "duct", name: "Duct-Taped Banana", rarity: "masterpiece" },
  rose: { id: "rose", name: "Rose Window", rarity: "masterpiece" },
  transcendent_paragon: { id: "transcendent_paragon", name: "Transcendent Paragon", rarity: "opus" },
  false_paragon: { id: "false_paragon", name: "The False Paragon (*)", rarity: "masterpiece" },
};

test("estimateRedrawOdds estimates target chance while enforcing rarity minimums", () => {
  const result = estimateRedrawOdds({
    sketches,
    targetIds: ["duct"],
    minimums: { rough: 2, framed: 1, opus: 1, masterpiece: 1 },
    trials: 400,
    seed: "rarity-minimums",
  });

  assert.equal(result.totalSlots, 5);
  assert.equal(result.probabilities.rarityMinimums, 1);
  assert.ok(result.probabilities.anyTarget > 0.3);
  assert.ok(result.probabilities.anyTarget < 0.7);
  assert.equal(result.averageCountsByRarity.rough, 2);
  assert.equal(result.averageCountsByRarity.masterpiece, 1);
});

test("estimateRedrawOdds excludes star masterpieces unless explicitly allowed", () => {
  const excluded = estimateRedrawOdds({
    sketches,
    targetIds: ["false_paragon"],
    minimums: { masterpiece: 1 },
    trials: 200,
    seed: "star-excluded",
  });
  const included = estimateRedrawOdds({
    sketches,
    targetIds: ["false_paragon"],
    minimums: { masterpiece: 1 },
    includeStarMasterpieces: true,
    starMasterpieceWeight: 0.01,
    trials: 2000,
    seed: "star-included",
  });

  assert.equal(excluded.probabilities.anyTarget, 0);
  assert.equal(excluded.excludedTargets[0].id, "false_paragon");
  assert.ok(included.probabilities.anyTarget > 0);
  assert.ok(included.probabilities.anyTarget < 0.05);
});

test("Targeted Redraw rejects Find New Sketches weighting", () => {
  const state = { sketchVictories: { duct: 3, rose: 0 } };

  assert.throws(() => estimateRedrawOdds({
    sketches,
    state,
    targetIds: ["rose"],
    minimums: { masterpiece: 1 },
    searchNew: true,
    searchNewMultiplier: 5,
  }), /Find New Sketches is a separate mode/);
});

test("estimateFindNewSketchOdds models Find New Sketches as a separate mode", () => {
  const result = estimateFindNewSketchOdds({
    sketches,
    state: { sketchVictories: { rough_a: 1, framed_a: 1, opus_a: 1, duct: 1 } },
    totalSlots: 3,
    maxRedraws: 100,
    trials: 300,
    seed: "find-new",
  });

  assert.equal(result.mode, "find_new_sketches");
  assert.ok(result.probabilities.singleRedrawNewSketch > 0);
  assert.ok(result.probabilities.withinMaxRedraws >= result.probabilities.singleRedrawNewSketch);
  assert.ok(result.averageRedrawsToNew >= 1);
  assert.ok(result.newSketchPool.byRarity.opus > 0);
});

test("Find New Sketches uses the Steam glossary even for a sketch with no victories", () => {
  const options = {
    sketches: { rough_a: sketches.rough_a },
    totalSlots: 1,
    maxRedraws: 2,
    trials: 5,
  };
  const seen = estimateFindNewSketchOdds({
    ...options,
    state: { glossaryUnlocks: ["rough_a"], sketchVictories: { rough_a: 0 } },
  });
  const unseen = estimateFindNewSketchOdds({
    ...options,
    state: { glossaryUnlocks: [], glossarySketchIds: ["rough_a"], sketchVictories: { rough_a: 1 } },
  });
  assert.equal(seen.newSketchPool.total, 0);
  assert.equal(seen.probabilities.singleRedrawNewSketch, 0);
  assert.equal(unseen.newSketchPool.total, 1);
  assert.equal(unseen.probabilities.singleRedrawNewSketch, 1);
});

test("Targeted Redraw rolls each sketch using the web save's rarity chance and glossary order", () => {
  const estimate = estimateRedrawOdds({
    sketches: { rough_a: sketches.rough_a, rough_b: sketches.rough_b, duct: sketches.duct },
    state: {
      fundamentals: { roughRarity: 50, masterpieceRarity: 0 },
      rarityChances: { rough: 100, masterpiece: 100 },
      glossaryUnlocks: [],
    },
    targetIds: ["rough_a", "rough_b", "duct"],
    trials: 4000,
    seed: "web-rarity-per-sketch",
  });

  assert.ok(Math.abs(estimate.targetRates.rough_a - 0.5) < 0.03);
  assert.ok(Math.abs(estimate.targetRates.rough_b - 0.5 / 1.1) < 0.03);
  assert.equal(estimate.targetRates.duct, 0);
  assert.ok(Math.abs(estimate.probabilities.anyTarget - (1 - 0.5 * (1 - 0.5 / 1.1))) < 0.03);
});

test("Find New Sketches respects effective Steam rarity chances and a caller's weight override", () => {
  const options = {
    sketches: { rough_a: sketches.rough_a, duct: sketches.duct },
    state: {
      saveProfile: "steam",
      fundamentals: { roughRarity: 0, masterpieceRarity: 100 },
      rarityChances: { rough: 100, masterpiece: 0 },
      glossaryUnlocks: ["rough_a"],
    },
    totalSlots: 1,
    maxRedraws: 2,
    trials: 20,
  };
  const estimated = estimateFindNewSketchOdds(options);
  const overridden = estimateFindNewSketchOdds({ ...options, rarityWeights: { masterpiece: 1 } });
  const targeted = estimateRedrawOdds({ ...options, targetIds: ["duct"], rarityWeights: { masterpiece: 1 } });

  assert.equal(estimated.probabilities.withinMaxRedraws, 0);
  assert.equal(overridden.probabilities.singleRedrawNewSketch, 1);
  assert.equal(targeted.targetRates.duct, 1);
});

test("Targeted Redraw respects the slot limit when guarantees or minimums overfill a draw", () => {
  const guaranteeOverflow = estimateRedrawOdds({
    sketches,
    totalSlots: 1,
    guaranteedIds: ["rough_a", "duct"],
    targetIds: ["duct"],
    trials: 5,
  });
  const minimumOverflow = estimateRedrawOdds({
    sketches,
    totalSlots: 2,
    minimums: { rough: 2, opus: 1 },
    trials: 5,
  });

  assert.equal(guaranteeOverflow.targetRates.duct, 0);
  assert.equal(guaranteeOverflow.averageCountsByRarity.rough, 1);
  assert.equal(guaranteeOverflow.averageCountsByRarity.masterpiece, 0);
  assert.equal(minimumOverflow.averageCountsByRarity.opus, 0);
  assert.equal(minimumOverflow.probabilities.rarityMinimums, 0);
  assert.equal(minimumOverflow.targetedRedraw.enabled, false);
});

test("estimateRedrawOdds supports paragon weighting and Unscrambled Guarantee", () => {
  const weighted = estimateRedrawOdds({
    sketches,
    targetIds: ["transcendent_paragon"],
    minimums: { opus: 1 },
    paragonWeightMultiplier: 0.01,
    trials: 1000,
    seed: "paragon-weighted",
  });
  const guaranteed = estimateRedrawOdds({
    sketches,
    targetIds: ["transcendent_paragon"],
    minimums: { opus: 1 },
    unscrambledGuaranteeIds: ["transcendent_paragon"],
    paragonWeightMultiplier: 0.01,
    trials: 100,
    seed: "paragon-guaranteed",
  });

  assert.ok(weighted.targetRates.transcendent_paragon < 0.1);
  assert.equal(guaranteed.targetRates.transcendent_paragon, 1);
});

test("estimateRedrawOdds infers Targeted Redraw total slots and forced guarantees from save state", () => {
  const state = {
    runTotalSketchCountsByRarity: { scrap: 71, rough: 44, framed: 15, opus: 8, masterpiece: 1 },
    targetedRedrawMins: { rough: 38, framed: 15, opus: 7, masterpiece: 1 },
    guaranteedSketchSelections: {
      rough: ["rough_a"],
      framed: ["framed_a"],
      opus: ["opus_a"],
      masterpiece: [],
    },
    guaranteedSketchIds: ["rough_a", "framed_a", "opus_a"],
    fundamentals: {
      roughRarity: 75,
      framedRarity: 33.3333,
      opusRarity: 12.1,
      masterpieceRarity: 2,
      roughSketches: 1,
      framedSketches: 1,
      opusSketches: 1,
      masterpieceSketches: 0,
      targetedRedrawMinChance: 0.05,
    },
  };

  const result = estimateRedrawOdds({
    sketches,
    state,
    targetIds: ["opus_a"],
    minimums: state.targetedRedrawMins,
    trials: 50,
    seed: "save-slots",
  });

  assert.equal(result.totalSlots, 68);
  assert.equal(result.targetRates.opus_a, 1);
  assert.equal(result.targetedRedraw.minimumChanceThreshold, 0.05);
});

test("analyzeTargetedRedrawLimits reads save minima, capacities and game minimum chance", () => {
  const state = {
    targetedRedrawMins: { rough: 38, framed: 15, opus: 7, masterpiece: 1 },
    runTotalSketchCountsByRarity: { scrap: 71, rough: 44, framed: 15, opus: 8, masterpiece: 1 },
    guaranteedSketchSelections: {
      rough: Array.from({ length: 12 }, (_, index) => `rough_${index}`),
      framed: Array.from({ length: 10 }, (_, index) => `framed_${index}`),
      opus: Array.from({ length: 4 }, (_, index) => `opus_${index}`),
      masterpiece: [],
    },
    skillLevels: {
      "rarity-rough-q": 10,
      "rarity-rough-q-2": 2,
      "rarity-framed-q": 10,
      "rarity-opus-q": 4,
    },
    fundamentals: {
      roughRarity: 75,
      framedRarity: 33.3333,
      opusRarity: 12.1,
      masterpieceRarity: 2,
      targetedRedrawMinChance: 0.05,
      paragonSlots: 3,
      roughUnscrambledGuarantee: 0,
      framedUnscrambledGuarantee: 0,
      opusUnscrambledGuarantee: 0,
      masterpieceUnscrambledGuarantee: 0,
    },
  };

  const limits = analyzeTargetedRedrawLimits({ sketches, state });

  assert.deepEqual(limits.currentMinimums, { rough: 38, framed: 15, opus: 7, masterpiece: 1 });
  assert.equal(limits.totalSlots, 68);
  assert.deepEqual(limits.guaranteeCapacity, { rough: 12, framed: 10, opus: 4, masterpiece: 0 });
  assert.deepEqual(limits.selectedCounts, { rough: 12, framed: 10, opus: 4, masterpiece: 0 });
  assert.equal(limits.minimumChanceThreshold, 0.05);
  assert.ok(limits.minimumChance >= 0);
  assert.ok(limits.minimumChance <= 1);
});

test("analyzeTargetedRedrawLimits accounts for paragon and unscrambled guarantee slot costs", () => {
  const guaranteeSketches = {
    old_opus: { id: "old_opus", name: "Old Opus", rarity: "opus" },
    new_opus: { id: "new_opus", name: "New Opus", rarity: "opus" },
    awakened_paragon: { id: "awakened_paragon", name: "Awakened Paragon", rarity: "opus" },
  };
  const limits = analyzeTargetedRedrawLimits({
    sketches: guaranteeSketches,
    state: {
      glossaryUnlocks: ["old_opus"],
      unscrambledGlossaryItems: ["new_opus"],
      guaranteedSketchSelections: {
        rough: [],
        framed: [],
        opus: ["old_opus", "new_opus", "awakened_paragon"],
        masterpiece: [],
      },
      fundamentals: {
        opusSketches: 6,
        paragonSlots: 3,
        opusUnscrambledGuarantee: 1,
        targetedRedrawMinChance: 0.05,
      },
    },
  });

  assert.equal(limits.usedGuaranteeSlots.opus, 6);
  assert.deepEqual(limits.guaranteeSlotDetails.opus.map((item) => item.cost), [1, 2, 3]);
});

test("buildTargetedRedrawCandidates uses save-aware current minima and farm variants", () => {
  const candidates = buildTargetedRedrawCandidates({
    state: {
      targetedRedrawMins: { rough: 38, framed: 15, opus: 7, masterpiece: 1 },
      runTotalSketchCountsByRarity: { scrap: 71, rough: 44, framed: 15, opus: 8, masterpiece: 1 },
    },
  });
  const names = candidates.map((item) => item.name);

  assert.ok(names.includes("save_current"));
  assert.ok(candidates.some((item) => item.name.includes("farm")));
  assert.ok(candidates.every((item) => item.totalSlots === 68));
});

test("recommendTargetedRedrawSettings ranks target and farm tradeoffs", () => {
  const result = recommendTargetedRedrawSettings({
    sketches,
    targetIds: ["duct"],
    candidates: [
      { name: "farm", minimums: { rough: 2, framed: 1, opus: 2, masterpiece: 0 } },
      { name: "target", minimums: { rough: 2, framed: 1, opus: 1, masterpiece: 1 } },
    ],
    trials: 300,
    seed: "recommend-target",
  });

  assert.equal(result.recommendations[0].name, "target");
  assert.ok(result.recommendations[0].targetProbability > 0);
  assert.equal(result.recommendations[1].targetProbability, 0);
  assert.ok(result.recommendations[1].farmScore > result.recommendations[0].farmScore);
});

test("generated redraw candidates can roll beyond saved minima when the save has no previous slot count", () => {
  const state = { targetedRedrawMins: { rough: 1 }, rarityChances: { rough: 100, masterpiece: 100 } };
  const result = recommendTargetedRedrawSettings({ state, sketches, targetIds: ["duct"], trials: 5 });
  const current = result.recommendations.find(({ name }) => name === "save_current");
  assert.ok(current.estimate.totalSlots > 1);
  assert.equal(current.targetProbability, 1);
});

test("Targeted Redraw excludes infeasible candidates from the ranking", () => {
  const candidates = [
    { name: "slots", totalSlots: 1, minimums: { rough: 1 } },
    { name: "pool", totalSlots: 3, minimums: { framed: 2 } },
    { name: "valid", totalSlots: 1, minimums: { opus: 1 } },
  ];
  const options = { sketches, candidates, trials: 5, guaranteedIds: ["opus_a"] };
  const ranked = recommendTargetedRedrawSettings(options);
  assert.deepEqual(ranked.recommendations.map(({ name }) => name), ["valid"]);
  assert.deepEqual(ranked.blockedCandidates.map(({ name, score, tradeoff }) => [name, score, tradeoff]), [
    ["slots", null, "infeasible"],
    ["pool", null, "infeasible"],
  ]);
  assert.deepEqual(ranked.blockedCandidates.map(({ estimate }) => estimate.targetedRedraw.infeasibleReasons[0].code), [
    "targeted_redraw_insufficient_slots",
    "targeted_redraw_insufficient_pool",
  ]);

  const unavailable = recommendTargetedRedrawSettings({ ...options, unscrambledGuaranteeIds: ["false_paragon"] });
  assert.deepEqual(unavailable.recommendations, []);
  assert.equal(unavailable.blockedCandidates.length, candidates.length);
  assert.ok(unavailable.blockedCandidates.every(({ estimate }) => estimate.targetedRedraw.infeasibleReasons
    .some(({ code }) => code === "targeted_redraw_guarantee_unavailable")));

  const overCapacity = recommendTargetedRedrawSettings({
    ...options,
    state: { fundamentals: { opusSketches: 0 } },
  });
  assert.deepEqual(overCapacity.recommendations, []);
  assert.ok(overCapacity.blockedCandidates.every(({ estimate }) => estimate.targetedRedraw.infeasibleReasons
    .some(({ code }) => code === "targeted_redraw_guarantee_capacity_exceeded")));
});

test("evaluateCurrentRun returns keep/redraw decisions from active save sketches", () => {
  const keep = evaluateCurrentRun({
    sketches,
    state: { availableSketches: ["rough_a", "opus_a", "duct"] },
    targetIds: ["duct"],
    minimums: { rough: 1, opus: 1, masterpiece: 1 },
  });
  const redraw = evaluateCurrentRun({
    sketches,
    state: { availableSketches: ["rough_a", "opus_a", "rose"] },
    targetIds: ["duct"],
    minimums: { rough: 1, opus: 2, masterpiece: 1 },
  });

  assert.equal(keep.decision, "keep");
  assert.ok(keep.reasons.includes("target_present"));
  assert.equal(redraw.decision, "redraw");
  assert.ok(redraw.reasons.includes("missing_target"));
  assert.ok(redraw.reasons.includes("minimums_not_met"));
});
