import { toNumber } from "./save.js";

export function getPreciseEraserEligibility(sketch, state = {}) {
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
