import { isFullSteamSave, toNumber } from "./save.js";
import { steamEncounterContext } from "./combat/steam-encounter.js";

export function combatAssumptionsFromSave(save = {}) {
  const state = save?.state ?? save ?? {};
  const steam = isFullSteamSave(save);
  const battleSpeedup = steam && battleSpeedupFromState(state);
  return {
    combatSpeedMultiplier: steam ? baseCombatSpeedMultiplier(state) : combatSpeedMultiplierFromState(state),
    ...(battleSpeedup && { battleSpeedup }),
    flowStateActive: flowStateActiveFromState(state),
    flowStateLevel: positiveFiniteOrDefault(state.fundamentals?.flowStateLevel, 0),
    flowStateKnownTargetIds: normalizeStringList(state.glossaryUnlocks),
    ...(steam && { steam: steamEncounterContext(state) }),
  };
}

export function combatSpeedMultiplierFromState(state = {}) {
  const baseSpeed = baseCombatSpeedMultiplier(state);
  return positiveFiniteOrDefault(baseSpeed * (battleSpeedupFromState(state)?.multiplier ?? 1), 1);
}

function baseCombatSpeedMultiplier(state) {
  const baseSpeed = positiveFiniteOrDefault(state.fundamentals?.timeAcceleration, 1);
  const training = state.trainingState;
  return positiveFiniteOrDefault(baseSpeed * (training?.isActive === true && training.fastForward === true ? 10 : 1), 1);
}

function battleSpeedupFromState(state) {
  const remainingSeconds = positiveFiniteOrDefault(state.activeBattleSpeedupRemainingSeconds, 0);
  if (state.trainingState?.isActive === true || remainingSeconds <= 0) return null;
  return { multiplier: positiveFiniteOrDefault(state.fundamentals?.battleSpeedupRate, 2), remainingSeconds };
}

export function flowStateActiveFromState(state = {}) {
  if (state.combatState?.isInFlowState === true) return true;
  return state.autoRetryActive === true && state.autoRetryUnlocked !== false;
}

function positiveFiniteOrDefault(value, fallback) {
  const number = toNumber(value, NaN);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeStringList(value) {
  const items = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : [];
  return items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}
