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

test("calibration preserves both combatants' modifiers through external log import", () => {
  const stats = {
    maxHp: 10000,
    attack: 10,
    attackSpeed: 1000,
    accuracy: 100,
    minDamage: 100,
    maxDamage: 100,
    burnChance: 100,
    burnDamage: 10,
    poisonChance: 100,
    poisonDamage: 10,
  };
  const targetId = "training_target";
  const fallbackModifiers = { immunities: ["burnChance", "poisonChance"], vulnerability: ["burnChance", 9] };
  const nestedLog = {
    targetId,
    player: {
      ...fallbackModifiers,
      stats: { ...stats, immunities: ["poisonChance"], vulnerability: ["burnChance", 3] },
    },
    enemy: { ...fallbackModifiers, stats },
    enemyStats: { ...stats, immunities: ["poisonChance"], vulnerability: ["burnChance", 5] },
  };
  const entries = [
    nestedLog,
    {
      ...nestedLog,
      playerImmunities: [],
      playerVulnerability: null,
      immunities: [],
      vulnerability: [],
    },
    {
      targetId,
      player: { immunities: ["poisonChance"], vulnerability: ["burnChance", 3] },
      target: { immunities: ["poisonChance"], vulnerability: ["burnChance", 5] },
    },
    { targetId },
  ];
  const parsed = parseCombatLogText(JSON.stringify(entries));
  assert.deepEqual(parsed.map((entry) => [
    entry.playerImmunities, entry.playerVulnerability, entry.immunities, entry.vulnerability,
  ]), [
    [["poisonChance"], ["burnChance", 3], ["poisonChance"], ["burnChance", 5]],
    [[], null, [], []],
    [["poisonChance"], ["burnChance", 3], ["poisonChance"], ["burnChance", 5]],
    [undefined, undefined, undefined, undefined],
  ]);

  const options = {
    player: { ...stats, ...fallbackModifiers },
    sketches: { [targetId]: { stats, ...fallbackModifiers } },
    maxSeconds: 4,
    trials: 2,
  };
  const imported = createCalibrationReport({ ...options, externalLogs: parsed });
  const direct = createCalibrationReport({ ...options, externalLogs: entries });
  assert.deepEqual(imported, direct);
  assert.deepEqual(imported.comparisons.map(({ simulated }) => {
    const { player, enemy } = simulated.fight.damageBreakdown;
    return [player.status, enemy.status];
  }), [[180, 300], [120, 120], [180, 300], [0, 0]]);
});

test("calibration excludes censored simulated medians and observed timeouts from duration tuning", () => {
  const playerStats = { maxHp: 100, attack: 1, attackSpeed: 1000 };
  const log = { targetId: "wall", outcome: "win", seconds: 300, reason: "burn", gameVersion: "v0.874", playerStats };
  const report = createCalibrationReport({ save: { state: { combatLog: [log] } },
    sketches: { wall: { stats: { maxHp: 1000, attack: 0, attackSpeed: 1000 } } },
    trials: 5, maxSeconds: 5,
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
  const playerStats = { maxHp: 100, attack: 10, attackSpeed: 999.9999, critChance: 50, minDamage: 100, maxDamage: 100 };
  const report = createCalibrationReport({
    save: { state: { combatLog: [{ targetId: "wall", outcome: "win", seconds: 5, gameVersion: "v0.874", playerStats }] } },
    sketches: { wall: { stats: { maxHp: 15, attack: 0, attackSpeed: 8000 } } },
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

test("calibration keeps missing and incomplete player snapshots in diagnostics without using them for tuning", () => {
  const fight = { targetId: "wall", outcome: "win", seconds: 2, gameVersion: "v0.881" };
  const playerStats = { maxHp: 100, attack: 10, attackSpeed: 1000, critChance: 50 };
  const options = {
    dataMetadata: { gameVersion: fight.gameVersion },
    sketches: { wall: { stats: { maxHp: 15, attack: 0, attackSpeed: 1000 } } },
    player: playerStats,
    trials: 8,
    maxSeconds: 10,
  };
  const recorded = { ...fight, playerStats };
  const report = createCalibrationReport({
    ...options,
    externalLogs: [fight, { ...fight, playerStats: { attack: 10 } },
      { ...fight, playerStats: { ...playerStats, attack: "" } }, recorded],
  });
  const recordedOnly = createCalibrationReport({ ...options, externalLogs: [recorded] });

  assert.equal(report.logs.used, 4);
  assert.equal(report.logs.tuningEligible, 1);
  assert.deepEqual(report.comparisons.map(({ tuningExclusion }) => tuningExclusion),
    ["calibration_player_stats_missing", "calibration_player_stats_missing", "calibration_player_stats_missing", null]);
  assert.ok(report.comparisons.every(({ simulated }) => simulated));
  assert.ok(report.warnings.some(({ code, count }) => code === "calibration_player_stats_missing" && count === 3));
  assert.deepEqual(report.comparisons[3].simulated, recordedOnly.comparisons[0].simulated);
  assert.deepEqual(report.tuning, recordedOnly.tuning);
});

test("an invalid Steam attack interval does not interrupt calibration of other fights", () => {
  const stats = { maxHp: 100, attack: 5, attackSpeed: 1000 };
  const log = { targetId: "wall", gameVersion: "v0.881", targetStats: stats, outcome: "loss" };
  const options = {
    save: { meta: { profile: "steam" }, state: {} },
    externalLogs: [{ ...log, playerStats: { ...stats, attackSpeed: 0 } }, { ...log, playerStats: stats }],
    trials: 2,
    maxSeconds: 5,
    dataMetadata: { gameVersion: log.gameVersion },
  };
  const report = createCalibrationReport(options);
  assert.equal(report.comparisons[0].simulated, null);
  assert.equal(report.comparisons[0].deviations[0].code, "missing_stats");
  assert.ok(report.comparisons[1].simulated);
  assert.equal(report.logs.tuningEligible, 1);
  const diagnostic = createCalibrationReport({ ...options, player: stats });
  assert.ok(diagnostic.comparisons[0].simulated);
  assert.deepEqual(diagnostic.tuning, report.tuning);
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

test("checkPatchSanity detects a conflicting save version when metadata supplies one", () => {
  const version = "v0.874";
  const { saveVersion, targets: sketches } = GAME_DATA_VERSIONS[version];
  const report = checkPatchSanity({ sketches, dataMetadata: { gameVersion: version, saveVersion: saveVersion + 1 } });

  assert.equal(report.ok, false);
  assert.equal(report.checkedTargets, Object.keys(sketches).length);
  assert.deepEqual(report.failures.map(({ code, expected, actual }) => ({ code, expected, actual })), [
    { code: "save_version_mismatch", expected: saveVersion, actual: saveVersion + 1 },
  ]);
  assert.equal(checkPatchSanity({ sketches, dataMetadata: { gameVersion: version } }).ok, true);
  assert.equal(checkPatchSanity({ sketches, version, dataMetadata: { saveVersion: null } }).ok, true);
  assert.equal(checkPatchSanity({ sketches, version }).ok, true);
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
