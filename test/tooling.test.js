import test from "node:test";
import assert from "node:assert/strict";

import { runBenchmark } from "../src/benchmark.js";
import { collectJsFiles } from "../src/lint.js";

test("benchmark reports simulations per second", () => {
  const result = runBenchmark({ trials: 5, seed: "benchmark-test" });

  assert.equal(result.trials, 5);
  assert.ok(result.elapsedMs > 0);
  assert.ok(result.simulationsPerSecond > 0);
  assert.ok(result.winRate >= 0 && result.winRate <= 1);
});

test("lint file collector includes source and test JavaScript files", () => {
  const files = collectJsFiles(process.cwd());

  assert.ok(files.some((file) => file.endsWith("src\\combat.js") || file.endsWith("src/combat.js")));
  assert.ok(files.some((file) => file.endsWith("test\\tooling.test.js") || file.endsWith("test/tooling.test.js")));
});
