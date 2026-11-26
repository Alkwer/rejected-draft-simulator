import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { runMonteCarlo } from "./combat.js";
import { buildSteamEnemy, enemyFromSketch } from "./combat/steam-encounter.js";
import { extractStats, isFullSteamSave } from "./save.js";
import { validateSteamPlayerStats } from "../web/save-format.js";
import { validateDataCompatibility } from "./save-analysis.js";
import { ANALYSIS_MODEL_VERSION } from "./model-version.js";

export function validateSteamFightForecastInput({
  save,
  sketches = {},
  dataMetadata = null,
  targetId = "hyena_hulk",
  trials = 1000,
  maxSeconds = 300,
  seed = "steam-fight-forecast",
} = {}) {
  if (!isFullSteamSave(save) || !save.state) {
    throw new Error("A full Rejected Draft Steam save is required.");
  }
  if (dataMetadata?.platform && dataMetadata.platform !== "steam") {
    throw new Error("A Steam sketch catalog is required.");
  }
  if (!Object.hasOwn(sketches, targetId) || !sketches[targetId]?.stats) {
    throw new Error(`Unknown target sketch: ${targetId}`);
  }
  if (!Number.isInteger(trials) || trials < 1 || trials > 5000) {
    throw new Error("Trials must be an integer from 1 to 5000.");
  }
  if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > 1800) {
    throw new Error("The forecast time limit must be an integer from 1 to 1800 seconds.");
  }
  if (typeof seed !== "string" || !seed.trim()) {
    throw new Error("The forecast seed must be a non-empty string.");
  }
  validateSteamPlayerStats(save.state.playerStats);
  return { save, sketches, dataMetadata, targetId, trials, maxSeconds, seed };
}

export function createSteamFightForecast(input) {
  const { save, sketches, dataMetadata, targetId, trials, maxSeconds, seed } = validateSteamFightForecastInput(input);
  const sketch = sketches[targetId];
  const target = { id: targetId, name: sketch.name ?? targetId };
  const { player, assumptions } = steamFightSetup(save, targetId);
  const enemy = buildSteamEnemy(enemyFromSketch(sketch, targetId), assumptions.steam);
  const result = runMonteCarlo({
    player, enemy, assumptions, trials, seed, maxSeconds,
  });
  const { winRate: win, losses, timeoutRate: timeout } = result;

  return freezeSnapshot(JSON.parse(JSON.stringify({
    modelVersion: ANALYSIS_MODEL_VERSION,
    target,
    player,
    enemy,
    assumptions,
    dataMetadata,
    warnings: validateDataCompatibility({ save, dataMetadata }),
    saveVersion: save.version ?? null,
    seed,
    trials,
    maxSeconds,
    probabilities: { win, loss: losses / trials, timeout },
    duration: {
      medianSeconds: result.medianSeconds,
      p10Seconds: result.p10Seconds,
      p90Seconds: result.p90Seconds,
      medianCensored: result.medianCensored,
      p10Censored: result.p10Censored,
      p90Censored: result.p90Censored,
    },
  })));
}

export function steamFightSetup(save, targetId) {
  const player = extractStats(save.state, "playerStats");
  const assumptions = combatAssumptionsFromSave(save);
  // Only the requested target's memberships affect this encounter.
  assumptions.flowStateKnownTargetIds = assumptions.flowStateKnownTargetIds.filter((id) => id === targetId);
  assumptions.flowStateActive = assumptions.flowStateActive && assumptions.flowStateKnownTargetIds.length > 0;
  assumptions.steam.erasedSketchIds = assumptions.steam.erasedSketchIds.filter((id) => id === targetId);
  return { player, assumptions };
}

export function compareSteamFightObservation(forecast, { outcome, elapsedSeconds } = {}) {
  if (!["win", "loss", "timeout"].includes(outcome)) {
    throw new Error("Outcome must be win, loss, or timeout.");
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new Error("Elapsed seconds must be a non-negative number.");
  }
  const { duration, maxSeconds, probabilities } = forecast;
  const censored = outcome === "timeout";
  // Outcome probabilities are defined at the forecast horizon.
  const outcomeKnownAtHorizon = censored ? elapsedSeconds >= maxSeconds : elapsedSeconds < maxSeconds;
  return {
    outcome,
    elapsedSeconds,
    outcomeProbability: outcomeKnownAtHorizon ? probabilities[outcome] : null,
    medianDeltaSeconds: censored || duration.medianCensored ? null : elapsedSeconds - duration.medianSeconds,
    rangeStatus: observationRange(duration, elapsedSeconds, censored),
  };
}

function observationRange(duration, elapsedSeconds, censored) {
  const { p10Seconds, p10Censored, p90Seconds, p90Censored } = duration;
  if (!censored && elapsedSeconds < p10Seconds) return "below";
  if (!p90Censored && (elapsedSeconds > p90Seconds || (censored && elapsedSeconds === p90Seconds))) return "above";
  if (!censored && !p10Censored && (!p90Censored || elapsedSeconds <= p90Seconds)) return "within";
  return "indeterminate";
}

function freezeSnapshot(value) {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) freezeSnapshot(entry);
    Object.freeze(value);
  }
  return value;
}
