import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runBenchmark } from "../src/benchmark.js";
import { collectJsFiles } from "../src/lint.js";

test("benchmark reports simulations per second", () => {
  const result = runBenchmark({ trials: 5, seed: "benchmark-test" });

  assert.equal(result.trials, 5);
  assert.ok(result.elapsedMs > 0);
  assert.ok(result.simulationsPerSecond > 0);
  assert.ok(result.winRate >= 0 && result.winRate <= 1);
  assert.equal(result.scenario, "status");
  assert.equal(result.seed, "benchmark-test");
});

test("benchmark scenarios exercise direct victories and regeneration timeouts", () => {
  const direct = runBenchmark({ scenario: "direct", trials: 3 });
  assert.equal(direct.winRate, 1);
  assert.ok(direct.medianSeconds < direct.maxSeconds);
  const wall = runBenchmark({ scenario: "regen-wall", trials: 3, maxSeconds: 80 });
  assert.deepEqual(wall.timeoutDiagnoses, { regen_wall: 3 });
  assert.equal(wall.medianCensored, true);
  assert.equal(wall.medianSeconds, 80);
});

test("benchmark CLI rejects invalid settings before reporting throughput", () => {
  const file = fileURLToPath(new URL("../src/benchmark.js", import.meta.url));
  for (const args of [["--trials"], ["--trials", "1.5"], ["--trials", "0"], ["--max-seconds", "typo"],
    ["--max-seconds", "0"], ["--scenario", "unknown"]]) {
    const result = spawnSync(process.execPath, [file, "--json", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(args[0]));
    assert.equal(result.stdout, "");
  }
});

test("lint file collector includes source and test JavaScript files", () => {
  const files = collectJsFiles(process.cwd());

  assert.ok(files.some((file) => file.endsWith("src\\combat.js") || file.endsWith("src/combat.js")));
  assert.ok(files.some((file) => file.endsWith("test\\tooling.test.js") || file.endsWith("test/tooling.test.js")));
});
