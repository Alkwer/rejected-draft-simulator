import { clamp } from "./math.js";
import { stat } from "./stats.js";

export function attackDelay(combatant, statuses = {}, speedMultiplier = 1, delayMultiplier = 1, steam = false) {
  let delayMs = steam
    ? Number(combatant?.stats?.attackSpeed ?? combatant?.attackSpeed ?? 2000)
    : stat(combatant, "attackSpeed", 2000);
  if (steam && (!Number.isFinite(delayMs) || delayMs <= 0)) {
    throw new Error("Steam combat requires a positive effective attackSpeed. Use playerStats for a Steam save.");
  }
  const slow = statuses.Slow ?? 0;
  if (slow > 0) delayMs *= 1 + slow * 0.001;
  const haste = statuses.Haste ?? 0;
  if (haste > 0) delayMs /= 1 + haste * 0.001;
  if (statuses.BananaSlip > 0) delayMs *= 2;
  const speed = Number.isFinite(Number(speedMultiplier)) && Number(speedMultiplier) > 0 ? Number(speedMultiplier) : 1;
  const delay = Number.isFinite(Number(delayMultiplier)) && Number(delayMultiplier) > 0 ? Number(delayMultiplier) : 1;
  const seconds = delayMs * delay / speed / 1000;
  return steam ? Math.max(Number.EPSILON, seconds) : clamp(seconds, 0.05, 30);
}

export function effectiveLeap(_combatant, statuses) {
  return clamp(statuses.Leap ?? 0, 0, 1000);
}
