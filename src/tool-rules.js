import { isFullSteamSave, toNumber } from "./save.js";
import { remainingSketchVictories } from "./victory-limit.js";

export function getSketchFightEligibility(sketch, state = {}) {
  if (!sketch?.id) {
    return { eligible: false, reason: "unknown_sketch", message: "The sketch is missing from the catalog." };
  }
  if (containsSketch(state.hiddenSketches, sketch.id)) {
    return { eligible: false, reason: "hidden_sketch", message: "The sketch is hidden in this run." };
  }
  if (state.availableSketches != null && !containsSketch(state.availableSketches, sketch.id)) {
    return { eligible: false, reason: "sketch_not_available", message: "The sketch is unavailable in this run." };
  }
  if (remainingSketchVictories(state, sketch.id) <= 0) {
    return { eligible: false, reason: "max_victories", message: "The sketch has reached its victory limit." };
  }
  return { eligible: true, reason: null, message: null };
}

function containsSketch(value, id) {
  if (value instanceof Set) return value.has(id);
  if (Array.isArray(value)) return value.includes(id);
  if (typeof value === "string") return value.split(",").some((entry) => entry.trim() === id);
  return Boolean(value && typeof value === "object" && Object.values(value).includes(id));
}

export function isSketchToolUnlocked(state, tool) {
  const key = tool === "eraser" ? "preciseEraserUnlocked" : "rewardBoosterUnlocked";
  return !isFullSteamSave(state) || state[key] !== false;
}

export function getPreciseEraserEligibility(sketch, state = {}) {
  if (!sketch?.id) {
    return { eligible: false, reason: "unknown_sketch", message: "The sketch is missing from the catalog." };
  }
  if (!isSketchToolUnlocked(state, "eraser")) {
    return { eligible: false, reason: "eraser_locked", message: "Precise Eraser is still locked in this save." };
  }
  const rarity = String(sketch?.rarity ?? "").toLowerCase();

  if (rarity === "opus" && !hasOpusEraser(state)) {
    return {
      eligible: false,
      reason: "opus_eraser_not_unlocked",
      message: "Precise Eraser on Opus targets requires the Opus Eraser talent.",
    };
  }

  if (rarity === "masterpiece") {
    return {
      eligible: false,
      reason: "masterpiece_not_eligible",
      message: "Precise Eraser is currently unavailable for Masterpiece targets in this game bundle.",
    };
  }

  return {
    eligible: true,
    reason: null,
    message: null,
  };
}

function hasOpusEraser(state = {}) {
  if (toNumber(state.fundamentals?.opusEraser) > 0) return true;
  if (isDisabled(state.disabledSkills, "fund-opus-eraser")) return false;
  return toNumber(state.skillLevels?.["fund-opus-eraser"]) > 0;
}

function isDisabled(disabledSkills, id) {
  if (!disabledSkills) return false;
  if (disabledSkills instanceof Set) return disabledSkills.has(id);
  if (Array.isArray(disabledSkills)) return disabledSkills.includes(id);
  if (typeof disabledSkills === "object") return Boolean(disabledSkills[id]);
  return false;
}
