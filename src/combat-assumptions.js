import { isFullSteamSave, toNumber } from "./save.js";
import { steamEncounterContext } from "./combat/steam-encounter.js";

export function combatAssumptionsFromSave(save = {}) {
  const state = save?.state ?? save ?? {};
  const steam = isFullSteamSave(save);
  const battleSpeedup = steam && battleSpeedupFromState(state);
  const flowTarget = steam ? steamFlowTarget(state, save.meta?.savedAt ?? state.lastSaveTime) : null;
  const knownTargets = normalizeStringList(state.glossaryUnlocks);
  const inspirationCapBonus = steam ? 0 : positiveFiniteOrDefault(state.fundamentals?.inspirationCapBonus, 0);
  return {
    combatSpeedMultiplier: steam ? baseCombatSpeedMultiplier(state) : combatSpeedMultiplierFromState(state),
    ...(battleSpeedup && { battleSpeedup }),
    ...(inspirationCapBonus > 0 && { inspirationCapBonus }),
    flowStateActive: steam ? Boolean(flowTarget) : flowStateActiveFromState(state),
    flowStateLevel: positiveFiniteOrDefault(state.fundamentals?.flowStateLevel, 0),
    flowStateKnownTargetIds: steam ? knownTargets.filter((id) => id === flowTarget) : knownTargets,
    ...(steam && { steam: steamEncounterContext(state) }),
  };
}

// A manual Steam challenge starts without Flow State. Use the snapshot clock so
// an exported fight and a history replay keep the same first-attack timing.
function steamFlowTarget(state, savedAt) {
  const combat = state.combatState;
  if (combat?.isFighting) return combat.isInFlowState ? combat.enemyId : null;
  const victory = combat?.lastVictory;
  if (!victory || !Number.isFinite(victory.time) || !Number.isFinite(savedAt)
      || savedAt < victory.time || savedAt - victory.time >= 5000
      || state.queuedChallenge || state.trainingState?.isActive || state.combatDiscoveryAnimation?.blocking) return null;
  if (Math.max(savedAt, toNumber(state.challengeCooldownUntil)) - victory.time >= 5000) return null;
  // The next target can differ with randomizer/advance. Only credit a known start.
  const retry = state.autoRetryActive && state.autoRetryUnlocked;
  const challenge = state.autoChallengeActive && state.autoChallengeUnlocked && !combat.isPlayerDefeated
    && (!Array.isArray(state.availableSketches) || state.availableSketches.includes(victory.enemyId));
  const target = retry ? state.lastEnemyId : challenge ? victory.enemyId : null;
  if (!target || (retry && state.randomizerActive && state.randomizerUnlocked)) return null;
  const limit = state.reviewAuditUnlocked && state.autoAdvanceActive && state.autoAdvanceUnlocked
    ? state.reviewAuditLimit : state.fundamentals?.maxVictories;
  return toNumber(state.sketchVictories?.[target]) < toNumber(limit, 250) ? target : null;
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
