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
