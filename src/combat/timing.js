import { clamp } from "./math.js";
import { stat } from "./stats.js";

export function attackDelay(combatant, statuses = {}, speedMultiplier = 1, delayMultiplier = 1) {
  let delayMs = stat(combatant, "attackSpeed", 2000);
  const slow = statuses.Slow ?? 0;
  if (slow > 0) delayMs *= 1 + slow * 0.001;
  const haste = statuses.Haste ?? 0;
  if (haste > 0) delayMs /= 1 + haste * 0.001;
  const speed = Number.isFinite(Number(speedMultiplier)) && Number(speedMultiplier) > 0 ? Number(speedMultiplier) : 1;
  const delay = Number.isFinite(Number(delayMultiplier)) && Number(delayMultiplier) > 0 ? Number(delayMultiplier) : 1;
  return clamp(delayMs * delay / speed / 1000, 0.05, 30);
}

export function effectiveLeap(_combatant, statuses) {
  return clamp(statuses.Leap ?? 0, 0, 1000);
}
