import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAnalysisRunner } from "../src/analysis-worker.js";
import { DEFAULT_DATA_PATH } from "../src/game-data-update.js";
import { createSteamFightForecast } from "../src/steam-fight-forecast.js";
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

test("the worker runs seeded Steam forecasts and retains compatibility warnings", async (t) => {
  const runner = createAnalysisRunner();
  t.after(() => runner.close());
  const options = {
    ...readGameBundle(DEFAULT_DATA_PATH),
    save: { version: 86, meta: { profile: "steam", gameVersion: "future-patch" },
      state: { playerStats: { maxHp: 100, attack: 20, attackSpeed: 1000 } } },
    trials: 2, maxSeconds: 5,
  };
  const forecast = await runner.runSteamForecast(options);
  assert.deepEqual(forecast, createSteamFightForecast(options));
  assert.ok(forecast.warnings.some(({ code }) => code === "game_version_mismatch"));
});
