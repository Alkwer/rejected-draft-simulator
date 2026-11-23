import assert from "node:assert/strict";
import test from "node:test";
import { runMonteCarlo } from "../src/combat.js";
import { analyzeSave } from "../src/save-analysis.js";
import { compareSteamFightObservation, createSteamFightForecast } from "../src/steam-fight-forecast.js";

function forecastInput() {
  return {
    save: {
      version: 86,
      meta: { profile: "steam" },
      state: {
        playerStats: {
          maxHp: { mantissa: 1, exponent: 3 },
          attack: "1000",
          attackSpeed: "800",
          minDamage: 100,
          maxDamage: 100,
          immunities: ["bleedChance"],
        },
        battleStats: { maxHp: "20", attack: "1", attackSpeed: "1200" },
        erasedSketchIds: ["hyena_hulk", "other"],
        multiverse: { currentUniverseId: "mv-easy-2" },
        fundamentals: { timeAcceleration: 2 },
        glossaryUnlocks: ["hyena_hulk", "other"],
        unrelatedSaveData: "must not appear in snapshot",
      },
    },
    sketches: {
      hyena_hulk: {
        name: "Hyena Hulk",
        rarity: "rough",
        stats: { maxHp: 20, attack: 1, attackSpeed: 2000 },
        vulnerability: ["bleedChance", 2],
      },
    },
    dataMetadata: { platform: "steam", buildId: "26823208" },
    trials: 5,
    seed: "hyena-practice",
  };
}

test("Steam forecast freezes the effective encounter and reproduces it from the captured inputs", () => {
  const input = forecastInput();
  const forecast = createSteamFightForecast(input);
  const replay = JSON.parse(JSON.stringify(forecast));
  assert.deepEqual(forecast, replay);
  assert.deepEqual(createSteamFightForecast(input), forecast);
  assert.deepEqual(forecast.target, { id: "hyena_hulk", name: "Hyena Hulk" });
  assert.deepEqual(forecast.probabilities, { win: 1, loss: 0, timeout: 0 });
  assert.equal(forecast.player.maxHp, 1000);
  assert.equal(forecast.enemy.maxHp, 1000);
  assert.equal(forecast.enemy.attack, 10);
  assert.equal(forecast.enemy.isPreciseErased, true);
  assert.deepEqual(forecast.enemy.vulnerability, ["bleedChance", 20]);
  assert.deepEqual(forecast.assumptions.steam.erasedSketchIds, ["hyena_hulk"]);
  assert.equal(forecast.assumptions.steam.universeId, "mv-easy-2");
  assert.equal(forecast.assumptions.combatSpeedMultiplier, 2);
  assert.equal(forecast.duration.medianSeconds, runMonteCarlo(replay).medianSeconds);
  assert.equal(forecast.duration.medianCensored, false);
  assert.throws(() => { forecast.duration.medianSeconds = 10; }, TypeError);
  assert.throws(() => forecast.player.immunities.push("slowChance"), TypeError);
  input.save.state.playerStats.immunities.push("slowChance");
  input.sketches.hyena_hulk.vulnerability[1] = 3;
  input.dataMetadata.buildId = "changed";
  assert.deepEqual(forecast, replay);
});

test("Steam forecast requires the full Steam profile, valid timing settings, and a catalog target", () => {
  const input = forecastInput();
  assert.throws(() => createSteamFightForecast({
    ...input, save: { ...input.save, meta: { profile: "steam-demo" } },
  }), /full Rejected Draft Steam save/);
  assert.throws(() => createSteamFightForecast({ ...input, targetId: "missing" }), /Unknown target/);
  assert.throws(() => createSteamFightForecast({
    ...input, dataMetadata: { platform: "web" },
  }), /Steam sketch catalog/);
  assert.throws(() => createSteamFightForecast({ ...input, trials: 5001 }), /Trials must/);
  assert.throws(() => createSteamFightForecast({ ...input, maxSeconds: 0 }), /time limit/);
});

test("Steam forecasts retain the standard analysis compatibility warnings", () => {
  const input = forecastInput();
  input.save.meta.gameVersion = "v0.9999";
  input.save.state.multiverse.currentUniverseId = "new-universe";
  input.save.state.currencies = { quintessence: { mantissa: 1, exponent: 999 } };
  Object.assign(input.dataMetadata, { buildId: "future-build", gameVersion: "v0.9771", saveVersion: 85 });
  const { warnings } = createSteamFightForecast(input);
  assert.deepEqual(warnings, analyzeSave({ ...input, targetId: "hyena_hulk" }).warnings);
  assert.deepEqual(warnings.map(({ code }) => code), [
    "unknown_universe", "unverified_build", "economy_numeric_range", "game_version_mismatch", "stale_sketch_data",
  ]);
  assert.deepEqual(createSteamFightForecast(forecastInput()).warnings, []);
});

test("Steam forecast compares observations in elapsed real seconds and handles the forecast horizon", () => {
  const forecast = createSteamFightForecast(forecastInput());
  const median = forecast.duration.medianSeconds;
  assert.deepEqual(compareSteamFightObservation(forecast, { outcome: "win", elapsedSeconds: median }), {
    outcome: "win", elapsedSeconds: median, outcomeProbability: 1, medianDeltaSeconds: 0, rangeStatus: "within",
  });
  const fastLoss = compareSteamFightObservation(forecast, { outcome: "loss", elapsedSeconds: 0 });
  assert.equal(fastLoss.outcomeProbability, 0);
  assert.equal(fastLoss.medianDeltaSeconds, -median);
  assert.equal(fastLoss.rangeStatus, "below");
  const lateWin = compareSteamFightObservation(forecast, { outcome: "win", elapsedSeconds: 301 });
  assert.equal(lateWin.outcomeProbability, null);
  assert.equal(lateWin.medianDeltaSeconds, 301 - median);
  assert.equal(lateWin.rangeStatus, "above");
  assert.throws(() => compareSteamFightObservation(forecast, { outcome: "win", elapsedSeconds: -1 }), /Elapsed seconds/);
  assert.throws(() => compareSteamFightObservation(forecast, { outcome: "fled", elapsedSeconds: 2 }), /Outcome/);
});

test("Steam forecast treats simulated and observed timeouts as right-censored durations", () => {
  const input = forecastInput();
  input.save.state.playerStats.attackSpeed = "3000";
  const forecast = createSteamFightForecast({ ...input, maxSeconds: 1 });
  assert.deepEqual(forecast.probabilities, { win: 0, loss: 0, timeout: 1 });
  assert.deepEqual(forecast.duration, {
    medianSeconds: 1, p10Seconds: 1, p90Seconds: 1,
    medianCensored: true, p10Censored: true, p90Censored: true,
  });
  assert.deepEqual(compareSteamFightObservation(forecast, { outcome: "timeout", elapsedSeconds: 1 }), {
    outcome: "timeout", elapsedSeconds: 1, outcomeProbability: 1, medianDeltaSeconds: null, rangeStatus: "indeterminate",
  });
  assert.deepEqual(compareSteamFightObservation(forecast, { outcome: "timeout", elapsedSeconds: 0.5 }), {
    outcome: "timeout", elapsedSeconds: 0.5, outcomeProbability: null, medianDeltaSeconds: null, rangeStatus: "indeterminate",
  });
});

test("Steam forecast uses the engine's nearest-rank bounds for two sampled durations", () => {
  const input = forecastInput();
  input.save.state = { playerStats: {
    maxHp: 100, attack: 10, attackSpeed: 500, critChance: 50, critDamage: 200, minDamage: 100, maxDamage: 100,
  } };
  input.sketches.hyena_hulk.stats = { maxHp: 15, attack: 0, attackSpeed: 8000 };
  const { duration } = createSteamFightForecast({ ...input, trials: 2, seed: "0" });
  assert.equal(duration.p10Seconds, 0.5);
  assert.equal(duration.medianSeconds, 0.5);
  assert.equal(duration.p90Seconds, 1);
});
