import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAnalysisRunner } from "../src/analysis-worker.js";
import { createWebAnalysis } from "../src/web-core.js";
import { readGameBundle } from "../src/sketch-data.js";

test("the analysis worker preserves seeded results and isolates concurrent request errors", async (t) => {
  const runner = createAnalysisRunner();
  t.after(() => runner.close());
  const dataPath = fileURLToPath(new URL("../data/artistLinks.js", import.meta.url));
  const saveText = readFileSync(new URL("../fixtures/synthetic-save.txt", import.meta.url), "utf8");
  const options = { saveText, targetId: "duct", seed: "worker", trials: 2, maxSeconds: 5 };
  const [invalid, valid] = await Promise.allSettled([
    runner.run(dataPath, { ...options, targetId: "missing" }),
    runner.run(dataPath, options),
  ]);
  assert.match(invalid.reason.message, /Unknown target sketch/);
  assert.equal(valid.status, "fulfilled");
  assert.deepEqual(valid.value, createWebAnalysis({ ...options, ...readGameBundle(dataPath) }));
});
