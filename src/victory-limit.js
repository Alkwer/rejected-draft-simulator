import { toNumber } from "./save.js";

export function maxSketchVictories(state) {
  return Math.max(1, toNumber(state?.fundamentals?.maxVictories, 250));
}

export function remainingSketchVictories(state, id, victories = state?.sketchVictories?.[id]) {
  return Math.max(0, maxSketchVictories(state) - toNumber(victories));
}
