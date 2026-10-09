import { toNumber } from "./save.js";

export function combatAssumptionsFromSave(save = {}) {
  const state = save?.state ?? save ?? {};
  return {
    combatSpeedMultiplier: combatSpeedMultiplierFromState(state),
    flowStateActive: flowStateActiveFromState(state),
    flowStateLevel: positiveFiniteOrDefault(state.fundamentals?.flowStateLevel, 0),
    flowStateKnownTargetIds: normalizeStringList(state.glossaryUnlocks),
  };
}

export function combatSpeedMultiplierFromState(state = {}) {
  const baseSpeed = positiveFiniteOrDefault(state.fundamentals?.timeAcceleration, 1);
  const trainingState = state.trainingState ?? {};
  const isTraining = trainingState.isActive === true;
  const fastForward = trainingState.fastForward === true;
  const battleSpeedupActive = !isTraining && toNumber(state.activeBattleSpeedupRemainingSeconds, 0) > 0;
  const combatSpeedMultiplier = baseSpeed
    * (isTraining && fastForward ? 10 : 1)
    * (battleSpeedupActive ? 2 : 1);
  return positiveFiniteOrDefault(combatSpeedMultiplier, 1);
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
