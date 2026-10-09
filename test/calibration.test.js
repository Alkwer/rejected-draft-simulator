import test from "node:test";
import assert from "node:assert/strict";

import {
  GAME_DATA_VERSIONS,
  KNOWN_REGRESSION_SCENARIOS,
  checkPatchSanity,
  createCalibrationReport,
  extractCombatLogs,
  parseCombatLogText,
  runKnownRegressionScenarios,
  suggestCalibrationTuning,
} from "../src/calibration.js";

test("extractCombatLogs normalizes save combat logs and external JSON logs", () => {
  const save = {
    version: 52,
    state: {
      combatLoggingEnabled: true,
      combatLog: [
        {
          sketchId: "duct_taped_banana",
          result: "defeat",
          durationMs: 12500,
          cause: "burn_over_time",
          playerStats: { maxHp: 100, attack: 10 },
          enemyStats: { maxHp: 1000, attack: 20 },
        },
      ],
    },
  };

  const logs = extractCombatLogs(save);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].targetId, "duct_taped_banana");
  assert.equal(logs[0].outcome, "loss");
  assert.equal(logs[0].seconds, 12.5);
  assert.equal(logs[0].reason, "burn_over_time");
  assert.equal(logs[0].sourceKey, "combatLog");

  const external = parseCombatLogText(JSON.stringify({
    logs: [
      { targetId: "rose_window", winner: "player", seconds: 9.25 },
    ],
  }));

  assert.equal(external.length, 1);
  assert.equal(external[0].targetId, "rose_window");
  assert.equal(external[0].outcome, "win");
  assert.equal(external[0].sourceKey, "external");
});

test("createCalibrationReport compares observed fights with simulation and flags deviations", () => {
  const sketches = {
    training_target: {
      id: "training_target",
      name: "Training Target",
      stats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
      immunities: [],
      vulnerability: null,
    },
  };
  const save = {
    version: 52,
    state: {
      combatLoggingEnabled: true,
      combatLog: [
        {
          targetId: "training_target",
          outcome: "loss",
          seconds: 1,
          reason: "real_reflect_damage",
          playerStats: {
            maxHp: 1000,
            attack: 1000,
            attackSpeed: 1000,
            accuracy: 100,
            minDamage: 100,
            maxDamage: 100,
          },
          targetStats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
          damageBreakdown: {
            player: { reflect: 500 },
            enemy: { direct: 10 },
          },
        },
      ],
    },
  };

  const report = createCalibrationReport({
    save,
    sketches,
    trials: 20,
    maxSeconds: 5,
    seed: "calibration-mismatch",
    dataMetadata: { gameVersion: "v0.874", saveVersion: 52 },
  });

  assert.equal(report.logs.total, 1);
  assert.equal(report.comparisons.length, 1);
  assert.equal(report.comparisons[0].actual.outcome, "loss");
  assert.equal(report.comparisons[0].predicted.outcome, "win");
  assert.ok(report.deviations.some((item) => item.code === "outcome_mismatch"));
  assert.equal(report.patchSanity.version, "v0.874");
});

test("suggestCalibrationTuning derives status, reflect and duration multipliers", () => {
  const tuning = suggestCalibrationTuning([
    {
      actual: {
        seconds: 12,
        damageBreakdown: {
          enemy: { status: 300 },
          player: { reflect: 40 },
        },
      },
      simulated: {
        fight: {
          seconds: 10,
          damageBreakdown: {
            enemy: { status: 100 },
            player: { reflect: 20 },
          },
        },
        summary: {
          medianSeconds: 10,
        },
      },
    },
  ]);

  assert.equal(tuning.statusTickMultiplier.value, 3);
  assert.equal(tuning.thornsCounterMultiplier.value, 2);
  assert.equal(tuning.durationMultiplier.value, 1.2);
  assert.equal(tuning.statusTickMultiplier.sampleCount, 1);
});

test("checkPatchSanity validates versioned Duct, Rose and Mobius snapshots", () => {
  const expected = GAME_DATA_VERSIONS["v0.874"].targets;
  const sketches = Object.fromEntries(
    Object.entries(expected).map(([id, target]) => [
      id,
      {
        id,
        name: target.name,
        rarity: target.rarity,
        stats: { ...target.stats },
        immunities: [...target.immunities],
        vulnerability: target.vulnerability ? [...target.vulnerability] : null,
      },
    ]),
  );

  const pass = checkPatchSanity({
    sketches,
    dataMetadata: { gameVersion: "v0.874", saveVersion: 52 },
  });

  assert.equal(pass.ok, true);
  assert.equal(pass.checkedTargets, 3);
  assert.equal(pass.failures.length, 0);

  sketches.mobius_strip.stats.burnDamage = 1;
  const fail = checkPatchSanity({
    sketches,
    dataMetadata: { gameVersion: "v0.874", saveVersion: 52 },
  });

  assert.equal(fail.ok, false);
  assert.ok(fail.failures.some((item) => item.code === "stat_mismatch" && item.targetId === "mobius_strip"));
});

test("runKnownRegressionScenarios protects calibrated save-like edge cases", () => {
  const expected = GAME_DATA_VERSIONS["v0.874"].targets;
  const sketches = Object.fromEntries(
    Object.entries(expected).map(([id, target]) => [
      id,
      {
        id,
        name: target.name,
        rarity: target.rarity,
        stats: { ...target.stats },
        immunities: [...target.immunities],
        vulnerability: target.vulnerability ? [...target.vulnerability] : null,
      },
    ]),
  );

  const result = runKnownRegressionScenarios({ sketches });

  assert.equal(result.total, KNOWN_REGRESSION_SCENARIOS.length);
  assert.equal(result.failed, 0);
  assert.ok(result.results.every((item) => item.pass));
});
