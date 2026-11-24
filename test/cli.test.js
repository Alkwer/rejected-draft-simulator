import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fixtureSave = path.join(projectRoot, "fixtures", "synthetic-save.txt");

test("CLI runs a JSON simulation against a fixture save", () => {
  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--save",
    fixtureSave,
    "--target",
    "duct",
    "--trials",
    "3",
    "--max-seconds",
    "2",
    "--export",
    "json",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.target.id, "duct_taped_banana");
  assert.equal(parsed.trials, 3);
  assert.equal(parsed.appliedIds.length, 0);
});

test("CLI reports exact Steam Exploratory Redraw when only a different rarity is new", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rejected-draft-redraw-"));
  const file = path.join(directory, "save.json");
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "steam-catalog.json"), "utf8"));
    const state = {
      saveProfile: "steam",
      playerStats: { maxHp: 100, attack: 10, attackSpeed: 1000 },
      selectedExploratoryRarity: "opus",
      fundamentals: { exploratoryExclusion: 1, roughRarity: 100, opusRarity: 100 },
      rarityChances: { rough: 100, framed: 0, opus: 100, masterpiece: 0 },
      glossaryUnlocks: Object.values(catalog.sketches).filter(({ rarity }) => rarity === "opus").map(({ id }) => id),
    };
    fs.writeFileSync(file, JSON.stringify({ version: catalog.metadata.saveVersion, state }));
    const args = ["src/cli.js", "--save", file, "--target", "duct", "--plan-redraw", "--find-new-sketches",
      "--trials", "10", "--max-redraws", "2", "--seed", "exact-exploratory"];
    const options = { cwd: projectRoot, encoding: "utf8" };

    const json = spawnSync(process.execPath, [...args, "--json"], options);
    assert.equal(json.status, 0, json.stderr);
    const { estimate } = JSON.parse(json.stdout).redrawPlan;
    assert.equal(estimate.exactRarity, "opus");
    assert.equal(estimate.newSketchPool.total, 0);
    assert.equal(estimate.probabilities.withinMaxRedraws, 0);

    const plain = spawnSync(process.execPath, args, options);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /Exploratory rarity: opus \(exact\)/);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmdirSync(directory);
  }
});

test("CLI route reports use the erased enemy's HP for the DPS threshold", () => {
  const result = spawnSync(process.execPath, ["src/cli.js", "--save", fixtureSave, "--target", "rorschach_bat",
    "--route", "mariline", "--erase", "rorschach_bat", "--trials", "1", "--max-seconds", "10", "--json"],
  { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const { target, report, route } = JSON.parse(result.stdout);
  assert.equal(target.stats.maxHp, 110);
  assert.equal(target.stats.maxHp, route.target.stats.maxHp);
  assert.equal(report.thresholds.find((row) => row.stat === "damagePerSecond").target, 11);
});

test("CLI applies the same Steam opening and booster rules across single fights and routes", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rejected-draft-cli-"));
  const file = path.join(directory, "save.json");
  const data = path.join(directory, "catalog.json");
  t.after(() => {
    fs.unlinkSync(file);
    fs.unlinkSync(data);
    fs.rmdirSync(directory);
  });
  const boss = { id: "boss", name: "Boss", rarity: "rough",
    stats: { maxHp: 10, attack: 10000, attackSpeed: 800, minDamage: 100, maxDamage: 100 }, rewards: [] };
  const farm = { ...boss, name: "Farm", id: "farm", rarity: "opus", rewards: [{ statName: "armor", amount: 1 }] };
  fs.writeFileSync(data, JSON.stringify({ sketches: { boss, farm }, metadata: { platform: "steam", gameVersion: "v0.9772" } }));
  const state = { playerStats: { maxHp: 100, attack: 100, attackSpeed: 1000, minDamage: 100, maxDamage: 100 },
    fundamentals: { flowStateLevel: 50 }, glossaryUnlocks: ["boss", "farm"], availableSketches: ["boss", "farm"],
    combatState: { lastVictory: { time: 10000, enemyId: "boss" } }, autoChallengeActive: true, autoChallengeUnlocked: true };
  const save = { meta: { profile: "steam", savedAt: 11000 }, version: 87, state };
  fs.writeFileSync(file, JSON.stringify(save));
  const run = (...args) => {
    const result = spawnSync(process.execPath, ["src/cli.js", "--save", file, "--data", data, "--target", "boss",
      "--trials", "10", "--max-seconds", "5", "--seed", "opening", "--json", ...args], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const direct = run();
  assert.equal(direct.winRate, 1);
  assert.equal(run("--route", "farm").route.target.simulation.winRate, direct.winRate);
  assert.equal(run("--compare-routes", "empty:").comparison.routes[0].winRate, direct.winRate);
  const applied = run("--apply", "farm,boss", "--boosted", "farm,boss");
  assert.ok(applied.saveWarnings.some((warning) => warning.code === "no_booster_uses" && warning.message.includes("boss")));

  state.availableSketches = ["farm"];
  fs.writeFileSync(file, JSON.stringify(save));
  const plan = (...args) => run("--plan-redraw", "--redraw-minimums", "0/0/1/0", ...args).redrawPlan.currentRun;
  assert.equal(plan().decision, "keep_farm");
  assert.equal(plan("--farm-keep-threshold", "3").decision, "redraw");
});

test("CLI rejects invalid stat sources, time limits, and trial counts", () => {
  for (const args of [["--stats", "typo"], ["--max-seconds", "typo"], ["--max-seconds", "0"],
    ["--max-seconds"], ["--trials", "1.5"], ["--trials", "Infinity"]]) {
    const result = spawnSync(process.execPath, ["src/cli.js", "--save", fixtureSave, "--target", "duct", ...args],
      { cwd: projectRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(args[0]));
    assert.equal(result.stdout.trim(), "");
  }
});

test("CLI defaults omitted trials to auto", () => {
  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--save",
    fixtureSave,
    "--target",
    "duct",
    "--max-seconds",
    "2",
    "--export",
    "json",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.autoTrials.mode, "auto");
  assert.ok(parsed.trials >= 400);
  assert.ok(parsed.trials <= 8000);
});

test("CLI patch sanity succeeds for the current fixture snapshot", () => {
  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--patch-sanity",
    "--export",
    "json",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.patchSanity.ok, true);
  assert.equal(parsed.patchSanity.checkedTargets, 3);
});

test("CLI exports a deterministic fight trace as JSON", () => {
  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--save",
    fixtureSave,
    "--target",
    "duct",
    "--trace-fight",
    "--trace-seconds",
    "5",
    "--max-seconds",
    "5",
    "--export",
    "json",
    "--seed",
    "cli-trace",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.trace.seed, "cli-trace");
  assert.equal(parsed.trace.target.id, "duct_taped_banana");
  assert.ok(parsed.trace.events.length > 0);
  assert.ok(parsed.trace.events.every((event) => event.time <= 5));
});

test("CLI can export RNG decisions in fight traces", () => {
  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--save",
    fixtureSave,
    "--target",
    "duct",
    "--trace-fight",
    "--trace-rng",
    "--trace-seconds",
    "5",
    "--max-seconds",
    "5",
    "--export",
    "json",
    "--seed",
    "cli-trace-rng",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const rngEvents = parsed.trace.events.flatMap((event) => event.rng ?? []);
  assert.ok(rngEvents.length > 0);
  assert.ok(rngEvents.every((entry, index) => entry.index === index + 1));
});

test("CLI exports a single-fight parity fixture comparison as JSON", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-fight-fixture-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  fs.writeFileSync(fixturePath, JSON.stringify({
    id: "cli_fixture_direct_win",
    targetId: "duct_taped_banana",
    observed: {
      outcome: "win",
      seconds: 1.001,
      playerHp: 1000,
      enemyHp: 0,
      damageBreakdown: {
        player: { total: 0 },
        enemy: { direct: 10, total: 10 },
      },
    },
    player: {
      id: "player",
      maxHp: 1000,
      attack: 10,
      attackSpeed: 1000,
      accuracy: 100,
      minDamage: 100,
      maxDamage: 100,
    },
    enemy: {
      id: "duct_taped_banana",
      name: "Duct-Taped Banana",
      maxHp: 10,
      attack: 0,
      attackSpeed: 10000,
    },
  }));

  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--save",
    fixtureSave,
    "--target",
    "duct",
    "--fight-fixture",
    fixturePath,
    "--trace-seconds",
    "3",
    "--max-seconds",
    "5",
    "--export",
    "json",
    "--seed",
    "cli-fixture",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.parity.ok, true);
  assert.equal(parsed.parity.fixtureId, "cli_fixture_direct_win");
  assert.equal(parsed.parity.trace.seed, "cli-fixture");
});
