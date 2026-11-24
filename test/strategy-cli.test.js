import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fixtureSave = path.join(projectRoot, "fixtures", "synthetic-save.txt");

test("CLI prints a strategic plan as JSON", () => {
  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--save",
    fixtureSave,
    "--target",
    "duct",
    "--strategy-plan",
    "--goal-q",
    "1e6",
    "--goal-currency",
    "Graphite=100",
    "--softcap-seconds",
    "60",
    "--trials",
    "5",
    "--strategy-trials",
    "3",
    "--export",
    "json",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.target.id, "duct_taped_banana");
  assert.equal(parsed.strategicPlan.assumptions.trials, 3);
  assert.equal(parsed.strategicPlan.approach.winRate.trials, 3);
  assert.equal(parsed.strategicPlan.approach.resources.quintessence.goal, 1e6);
  assert.equal(parsed.strategicPlan.approach.resources.currencies.Graphite.goal, 100);
  assert.ok(parsed.strategicPlan.masterpieceRoll.decision);
  assert.ok(parsed.strategicPlan.economy);
  assert.ok(Array.isArray(parsed.strategicPlan.economy.purchasePlan.buyNow));
  assert.ok(Array.isArray(parsed.strategicPlan.economy.currencyForecasts));
});

test("CLI rejects invalid strategy trial counts", () => {
  const base = ["src/cli.js", "--save", fixtureSave, "--target", "duct", "--strategy-plan", "--max-seconds", "1"];
  for (const values of [[], ["0"], ["1.5"], ["typo"], ["Infinity"]]) {
    const result = spawnSync(process.execPath, [...base, "--strategy-trials", ...values],
      { cwd: projectRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--strategy-trials must be a positive integer/);
    assert.equal(result.stdout, "");
  }
});

test("CLI accepts strategy profile and profile comparison options", () => {
  const result = spawnSync(process.execPath, [
    "src/cli.js",
    "--save",
    fixtureSave,
    "--target",
    "duct",
    "--strategy-plan",
    "--strategy-profile",
    "farm-q",
    "--strategy-mode",
    "safe-farm",
    "--compare-profiles",
    "farm-q,3-masterpiece,transcendent-paragon",
    "--trials",
    "5",
    "--export",
    "json",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.strategicPlan.profile.id, "farm-q");
  assert.equal(parsed.strategicPlan.profile.mode.id, "safe-farm");
  assert.deepEqual(parsed.strategicPlan.profileComparison.map((item) => item.id), [
    "farm-q",
    "3-masterpiece",
    "transcendent-paragon",
  ]);
});
