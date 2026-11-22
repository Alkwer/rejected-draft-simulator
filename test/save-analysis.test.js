import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSave } from "../src/save-analysis.js";
import { decodeSaveText } from "../src/save.js";

const sketches = {
  a: { id: "a", name: "A", rarity: "rough" },
  b: { id: "b", name: "B", rarity: "framed" },
  c: { id: "c", name: "C", rarity: "opus" },
  target: { id: "target", name: "Target", rarity: "masterpiece" },
};

function sampleSave(overrides = {}) {
  return {
    version: 52,
    state: {
      playerStats: { maxHp: "1000", attack: "100", attackSpeed: "1200" },
      battleStats: { maxHp: "800", attack: "400", attackSpeed: "900" },
      currentRunStats: { maxHp: "1200", attack: "250", attackSpeed: "1000" },
      redrawSummaryData: {
        currentRunStats: { maxHp: "9999", attack: "9999", attackSpeed: "1000" },
      },
      availableSketches: ["a", "b", "c", "target"],
      hiddenSketches: ["b"],
      sketchRunVictories: { a: 3, b: 0, c: 1, target: 0 },
      sketchVictories: { a: 3, b: 1, c: 2, target: 0 },
      fundamentals: { maxVictories: 3 },
      autoBoosterSketches: ["a"],
      autoEraserSketches: ["b"],
      autoSwapperSketches: ["c"],
      boostedSketchIds: ["a"],
      erasedSketchIds: ["b"],
      swappedSketchIds: ["c"],
      activeMeditationBuffs: [{ stat: "armor", multiplier: 1.1 }],
      pendingMeditationStats: ["armor", "regen"],
      meditationSketchId: "a",
      meditationCount: 2,
      targetedRedrawActive: false,
      targetedRedrawCountdown: null,
      ...overrides,
    },
  };
}

test("analyzeSave recommends run stats and compares global to battle stats", () => {
  const analysis = analyzeSave({ save: sampleSave(), sketches, targetId: "target" });

  assert.equal(analysis.stats.recommendedSource, "runStats");
  assert.equal(analysis.stats.reason, "current_run_stats_available");
  assert.equal(analysis.stats.sources.runStats.attack, 250);
  assert.equal(analysis.stats.playerVsBattle.attack.delta, 300);
  assert.equal(analysis.stats.playerVsBattle.attack.percentDelta, 300);
});

test("analyzeSave ignores stale redraw summary run stats when current run stats are empty", () => {
  const analysis = analyzeSave({
    save: sampleSave({
      currentRunStats: {},
      battleStats: { maxHp: "1", attack: "1", attackSpeed: "-100" },
      redrawSummaryData: {
        currentRunStats: { maxHp: "999999", attack: "999999", attackSpeed: "1000" },
      },
    }),
    sketches,
    targetId: "target",
  });

  assert.equal(analysis.stats.recommendedSource, "playerStats");
  assert.equal(analysis.stats.reason, "fallback_player_stats");
  assert.deepEqual(analysis.stats.sources.runStats, {});
});

test("Steam saves use live player stats and preserve active run progress", () => {
  const save = {
    ...sampleSave({
      playerStats: {
        maxHp: "1.5e5",
        attack: { mantissa: 2, exponent: 3 },
        attackSpeed: "1200",
        immunities: ["bleedChance"],
        vulnerability: ["burnChance", 2],
      },
    }),
    version: 86,
    meta: { profile: "steam", slot: 2 },
  };
  const encoded = Buffer.from(JSON.stringify(save), "utf8").toString("base64");

  for (const text of [encoded, JSON.stringify(save)]) {
    const analysis = analyzeSave({ save: decodeSaveText(text), sketches });
    assert.equal(analysis.saveVersion, 86);
    assert.equal(analysis.stats.recommendedSource, "playerStats");
    assert.equal(analysis.stats.reason, "steam_player_stats");
    assert.equal(analysis.stats.sources.playerStats.maxHp, 150000);
    assert.equal(analysis.stats.sources.playerStats.attack, 2000);
    assert.deepEqual(analysis.stats.sources.playerStats.immunities, ["bleedChance"]);
    assert.deepEqual(analysis.stats.sources.playerStats.vulnerability, ["burnChance", 2]);
    assert.equal(analysis.run.phase, "in_run");
    assert.equal(analysis.run.rewardProgress.c.runVictories, 1);
  }
});

test("save decoder accepts legacy companion state and rejects broken or out-of-range Steam stats", () => {
  const { state } = sampleSave();
  assert.deepEqual(decodeSaveText(JSON.stringify(state)).state, state);
  assert.throws(() => decodeSaveText(" "), /empty/i);
  assert.throws(() => decodeSaveText('{"state":[]}'), /missing game state/i);
  assert.throws(() => decodeSaveText('{"state":{"saveProfile":"steam"}}'), /missing player stats/i);
  const steamState = { ...state, saveProfile: "steam", playerStats: { ...state.playerStats, attack: "1e400" } };
  assert.throws(() => decodeSaveText(JSON.stringify({ state: steamState })), /attack.*finite number/i);
});

test("analyzeSave classifies active sketches and reward progress", () => {
  const analysis = analyzeSave({ save: sampleSave(), sketches, targetId: "target" });

  assert.deepEqual(analysis.run.active.defeated.map((item) => item.id), ["a"]);
  assert.deepEqual(analysis.run.active.hidden.map((item) => item.id), ["b"]);
  assert.deepEqual(analysis.run.active.remaining.map((item) => item.id), ["c"]);
  assert.equal(analysis.run.active.target.id, "target");
  assert.equal(analysis.run.rewardProgress.a.runVictories, 3);
  assert.equal(analysis.run.rewardProgress.a.remainingToMax, 0);
  assert.equal(analysis.run.rewardProgress.c.rewardsCollectedThisRun, 1);
  assert.equal(analysis.run.rewardProgress.c.remainingToMax, 1);
});

test("analyzeSave reads automation tools and meditation state", () => {
  const analysis = analyzeSave({ save: sampleSave(), sketches, targetId: "target" });

  assert.deepEqual(analysis.tools.autoBooster, ["a"]);
  assert.deepEqual(analysis.tools.autoEraser, ["b"]);
  assert.deepEqual(analysis.tools.autoSwapper, ["c"]);
  assert.deepEqual(analysis.tools.boosted, ["a"]);
  assert.deepEqual(analysis.tools.erased, ["b"]);
  assert.deepEqual(analysis.tools.swapped, ["c"]);
  assert.equal(analysis.meditation.sketchId, "a");
  assert.deepEqual(analysis.meditation.pendingStats, ["armor", "regen"]);
  assert.deepEqual(analysis.meditation.activeBuffs, [{ stat: "armor", multiplier: 1.1 }]);
});

test("analyzeSave detects run phases", () => {
  assert.equal(analyzeSave({ save: sampleSave(), sketches }).run.phase, "in_run");

  const afterRedraw = sampleSave({ sketchRunVictories: { a: 0, b: 0, c: 0, target: 0 } });
  assert.equal(analyzeSave({ save: afterRedraw, sketches }).run.phase, "after_redraw");

  const beforeRedraw = sampleSave({ targetedRedrawActive: true, targetedRedrawCountdown: 10 });
  assert.equal(analyzeSave({ save: beforeRedraw, sketches }).run.phase, "before_redraw");

  const cleared = sampleSave({
    availableSketches: ["a"],
    sketchRunVictories: { a: 0 },
    hiddenSketches: [],
  });
  assert.equal(analyzeSave({ save: cleared, sketches }).run.phase, "cleared_run");
});

test("analyzeSave warns when sketch data metadata is older than the save", () => {
  const stale = analyzeSave({
    save: sampleSave(),
    sketches,
    dataMetadata: { saveVersion: 51, gameVersion: "v0.873" },
  });
  const current = analyzeSave({
    save: sampleSave(),
    sketches,
    dataMetadata: { saveVersion: 52, gameVersion: "v0.874" },
  });

  assert.deepEqual(stale.warnings.map((warning) => warning.code), ["stale_sketch_data"]);
  assert.deepEqual(current.warnings, []);
});

test("analyzeSave warns when a legacy save is analyzed against Steam sketch data", () => {
  const analysis = analyzeSave({ save: sampleSave(), sketches, dataMetadata: { platform: "steam", saveVersion: 86 } });
  assert.deepEqual(analysis.warnings.map((warning) => warning.code), ["save_platform_mismatch"]);
});
