import { projectVictories } from "./route.js";
import { isFullSteamSave, toNumber } from "./save.js";

export { RewardProjectionError } from "./steam-stat-projection.js";
export { applyStatReward, steamCurrencyPerkWinsRemaining, steamSketchRewards } from "./reward-amounts.js";

export function projectSketchRewards({
  baseStats, sketches, defeatedIds, boostedIds = [], state = {},
  rewardDecay = isFullSteamSave(state) ? toNumber(state.fundamentals?.rewardDecay, 1) : 1,
  rewardBoosterEffect = isFullSteamSave(state) ? toNumber(state.fundamentals?.rewardBoosterEffect, 50) : 50,
  existingVictories = state.sketchVictories ?? {},
}) {
  return projectVictories({
    state: { ...state, sketchVictories: existingVictories,
      fundamentals: { ...state.fundamentals, rewardDecay, rewardBoosterEffect } },
    baseStats, sketches, ids: defeatedIds, boostedIds,
  });
}

export function applySketchRewards(options) {
  return projectSketchRewards(options).stats;
}

export function parseIdList(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
