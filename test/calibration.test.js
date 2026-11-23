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

test("parseCombatLogText classifies terminal HP codes and preserves legacy outcome aliases", () => {
  const entries = [
    { outcome: "player_hp_zero" },
    { result: "ENEMY_HP_ZERO" },
    { status: "player HP zero" },
    { reason: "enemy_hp_zero" },
    { outcome: "timeout_regen_wall" },
    { status: "stalled" },
    { winner: "attacker", result: "player_hp_zero" },
    { winner: "target" },
    { playerWon: false },
    { result: "Victory" },
    { status: "player_pending" },
    { status: "window_open" },
  ];
  const logs = parseCombatLogText(JSON.stringify(entries.map((entry) => ({
    targetId: "training_target",
    ...entry,
  }))));

  assert.deepEqual(logs.map(({ outcome }) => outcome), [
    "loss", "win", "loss", "win", "timeout", "timeout",
    "win", "loss", "loss", "win", "unknown", "unknown",
  ]);
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

test("calibration excludes censored simulated medians and observed timeouts from duration tuning", () => {
  const log = { targetId: "wall", outcome: "win", seconds: 300, reason: "burn", gameVersion: "v0.874" };
  const report = createCalibrationReport({ save: { state: { combatLog: [log] } },
    sketches: { wall: { stats: { maxHp: 1000, attack: 0, attackSpeed: 1000 } } },
    player: { maxHp: 100, attack: 1, attackSpeed: 1000 }, trials: 5, maxSeconds: 5,
    dataMetadata: { gameVersion: "v0.874" } });
  assert.equal(report.logs.tuningEligible, 1);
  assert.equal(report.comparisons[0].predicted.medianCensored, true);
  assert.equal(report.comparisons[0].predicted.medianSeconds, 5);
  assert.equal(report.tuning.durationMultiplier.sampleCount, 0);
  assert.equal(report.deviations.some((item) => ["duration_mismatch", "outcome_mismatch", "cause_mismatch"].includes(item.code)), false);
  assert.equal(suggestCalibrationTuning([{ actual: { outcome: "timeout", seconds: 12 },
    simulated: { summary: { medianSeconds: 2 } } }]).durationMultiplier.value, null);
});

test("calibration keeps a completed median just below the horizon when half the trials time out", () => {
  const report = createCalibrationReport({
    save: { state: { combatLog: [{ targetId: "wall", outcome: "win", seconds: 5, gameVersion: "v0.874" }] } },
    sketches: { wall: { stats: { maxHp: 15, attack: 0, attackSpeed: 8000 } } },
    player: { maxHp: 100, attack: 10, attackSpeed: 999.9999, critChance: 50, minDamage: 100, maxDamage: 100 },
    trials: 2,
    maxSeconds: 1,
    seed: "0",
    dataMetadata: { gameVersion: "v0.874" },
  });

  const { predicted } = report.comparisons[0];
  assert.equal(predicted.timeoutRate, 0.5);
  assert.ok(Math.abs(predicted.medianSeconds - 0.9999999) < 1e-12);
  assert.equal(predicted.medianCensored, false);
  assert.equal(report.tuning.durationMultiplier.sampleCount, 1);
});

test("calibration tunes only matching patches after importing mixed external and save logs", () => {
  const fight = {
    targetId: "training_target",
    outcome: "win",
    seconds: 3,
    playerStats: { maxHp: 100, attack: 10, attackSpeed: 1000, minDamage: 100, maxDamage: 100, critChance: 50 },
    targetStats: { maxHp: 15, attack: 0, attackSpeed: 1000 },
  };
  const save = {
    version: 52,
    meta: { gameVersion: "v0.881" },
    state: { combatLog: [{ ...fight, seconds: 20 }] },
  };
  const mixed = {
    metadata: { gameVersion: "v0.881" },
    logs: [{ ...fight, seconds: 30, patchVersion: "v0.874" }, fight],
  };
  const externalLogs = parseCombatLogText(Buffer.from(JSON.stringify(mixed)).toString("base64"));
  const options = { dataMetadata: { gameVersion: "v0.881", saveVersion: 52 }, trials: 8, maxSeconds: 50 };
  const report = createCalibrationReport({ ...options, save, externalLogs });
  const matchingOnly = createCalibrationReport({ ...options, externalLogs: [externalLogs[1]] });

  assert.equal(report.logs.used, 3);
  assert.equal(report.logs.tuningEligible, 1);
  assert.deepEqual(report.comparisons.map(({ patchVersion, tuningExclusion }) => [patchVersion, tuningExclusion]), [
    [null, "calibration_log_patch_missing"],
    ["v0.874", "calibration_log_patch_mismatch"],
    ["v0.881", null],
  ]);
  assert.ok(report.comparisons.every(({ simulated }) => simulated));
  assert.deepEqual(report.comparisons[2].simulated, matchingOnly.comparisons[0].simulated);
  assert.deepEqual(report.tuning, matchingOnly.tuning);
  assert.equal(report.tuning.durationMultiplier.sampleCount, 1);
  assert.ok(report.warnings.some(({ code, count }) => code === "calibration_log_patch_missing" && count === 1));
  assert.ok(report.warnings.some(({ code, count }) => code === "calibration_log_patch_mismatch" && count === 1));
});

test("calibration needs catalog patch metadata even when a log matches the reference snapshot", () => {
  const { version: snapshotVersion } = checkPatchSanity();
  const report = createCalibrationReport({
    externalLogs: [{
      targetId: "training_target",
      outcome: "win",
      seconds: 3,
      gameVersion: snapshotVersion,
      playerStats: { maxHp: 100, attack: 10, attackSpeed: 1000 },
      targetStats: { maxHp: 1, attack: 0, attackSpeed: 1000 },
    }],
    trials: 2,
    maxSeconds: 5,
  });

  assert.equal(report.gameDataVersion, null);
  assert.equal(report.patchSanity.version, snapshotVersion);
  assert.ok(report.comparisons[0].simulated);
  assert.equal(report.comparisons[0].tuningExclusion, "calibration_catalog_patch_missing");
  assert.equal(report.logs.tuningEligible, 0);
  assert.equal(report.tuning.durationMultiplier.value, null);
  assert.ok(report.warnings.some(({ code, count }) => code === "calibration_catalog_patch_missing" && count === 1));
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
