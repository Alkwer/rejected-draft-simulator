import { createRng } from "./rng.js";
import {
  addBreakdown,
  cloneBreakdowns,
  createDamageBreakdown,
  createHealingBreakdown,
  dominantDamageSource,
  inferDeathCause,
} from "./combat/damage.js";
import {
  clamp,
  confidenceInterval95,
  percentile,
  randomBetween,
  rollMultistrikeHitCount,
  rollPercent,
  rollStacks,
} from "./combat/math.js";
import { combatantMaxHp, stat, statRaw } from "./combat/stats.js";
import { buildSteamEnemy, shouldTriggerSeppuku } from "./combat/steam-encounter.js";
import {
  STEAM_ON_HIT_STATUSES,
  applySteamBuff,
  applySteamOnHitStatusSkills,
  applySteamStatusTransitions,
  rollSteamBuffConversion,
  shouldSkipForParalysis,
  spreadSteamDiseases,
} from "./combat/steam-statuses.js";
import {
  HARMFUL_STATUSES,
  SELF_BUFF_TO_STAT,
  STATUS_CAPS,
  STATUS_TO_STAT,
  addStatus,
  applyRemedy,
  hasHarmfulStatusPressure,
  resolveHypnotize,
  shouldSkipTurn,
} from "./combat/statuses.js";
import { attackDelay, effectiveLeap } from "./combat/timing.js";
import {
  STATUS_APPLICATION_EFFECT,
  normalizeVulnerabilityEffects,
  vulnerabilityMultiplier,
} from "./combat/vulnerability.js";

const EXPORTED_SKETCH_CHANCE_SCALE = 100;
const REGEN_TICK_SECONDS = 1.001;
const STATUS_TICK_SECONDS = 1.002;
const COUNTER_DELAY_SECONDS = 0.2;
const TIME_EPSILON = 1e-9;
const COMBAT_SIDES = ["player", "enemy"];
const PERIODIC_DAMAGE_TICKS = [applyBurnTick, applyPlagueTick, applyPoisonTick, applyBlackFlameTick];
const WEB_STATUS_TICKS = [
  ...PERIODIC_DAMAGE_TICKS,
  applyEnergyWaveTick,
  applyInspirationTick,
  applyBalloonTick,
  applyIrradiateTick,
];

export const DEFAULT_COMBAT_ASSUMPTIONS = {
  exportedEnemyStatusChanceScale: 1 / EXPORTED_SKETCH_CHANCE_SCALE,
  exportedEnemyBuffChanceScale: 1 / EXPORTED_SKETCH_CHANCE_SCALE,
  dotScale: 1,
  combatSpeedMultiplier: 1,
  flowStateActive: false,
  flowStateLevel: 0,
  flowStateKnownTargetIds: [],
};

export function runMonteCarlo({ trials = 1000, ...options }) {
  const simulation = createMonteCarloAccumulator(options);
  simulation.advanceTo(trials);
  return simulation.finish();
}

export function createMonteCarloAccumulator({
  player,
  enemy,
  seed = "default",
  maxSeconds = 300,
  assumptions = {},
}) {
  const summary = {
    trials: 0,
    wins: 0,
    losses: 0,
    timeouts: 0,
    reasons: {},
    deathCauses: {},
    timeoutDiagnoses: {},
    victoryCauses: {},
    defeatCauses: {},
  };
  const durations = [];
  let totalSeconds = 0;
  const effectiveEnemy = buildSteamEnemy(enemy, assumptions.steam);

  function advanceTo(trials) {
    while (summary.trials < trials) {
      const result = simulateFight({
        rng: createRng(`${seed}:${summary.trials}`),
        player,
        enemy: effectiveEnemy,
        maxSeconds,
        assumptions,
      });
      summary.trials += 1;
      if (result.winner === "player") summary.wins += 1;
      else if (result.winner === "enemy") summary.losses += 1;
      else summary.timeouts += 1;
      summary.reasons[result.reason] = (summary.reasons[result.reason] ?? 0) + 1;
      if (result.deathCause) {
        summary.deathCauses[result.deathCause] = (summary.deathCauses[result.deathCause] ?? 0) + 1;
      }
      if (result.timeoutDiagnosis) {
        summary.timeoutDiagnoses[result.timeoutDiagnosis] = (summary.timeoutDiagnoses[result.timeoutDiagnosis] ?? 0) + 1;
      }
      if (result.winner === "player") {
        const cause = result.victoryCause;
        summary.victoryCauses[cause] = (summary.victoryCauses[cause] ?? 0) + 1;
      } else {
        const cause = classifyDefeatCause({ result, player, enemy: effectiveEnemy });
        summary.defeatCauses[cause] = (summary.defeatCauses[cause] ?? 0) + 1;
      }
      totalSeconds += result.seconds;
      durations.push({ seconds: result.seconds, censored: result.winner === "timeout" });
    }
    return winRateCi95();
  }

  function winRateCi95() {
    return confidenceInterval95(summary.wins / Math.max(1, summary.trials), summary.trials);
  }

  function finish() {
    // A completion at the same recorded time precedes the lower bound of a censored trial.
    durations.sort((a, b) => a.seconds - b.seconds || Number(a.censored) - Number(b.censored));
    const p10 = percentile(durations, 0.1, null);
    const median = percentile(durations, 0.5, null);
    const p90 = percentile(durations, 0.9, null);
    const safeTrials = Math.max(1, summary.trials);
    return {
      ...summary,
      winRate: summary.wins / safeTrials,
      timeoutRate: summary.timeouts / safeTrials,
      winRateCi95: winRateCi95(),
      avgSeconds: totalSeconds / safeTrials,
      avgCensored: summary.timeouts > 0,
      p10Seconds: p10?.seconds ?? 0,
      p10Censored: p10?.censored ?? false,
      medianSeconds: median?.seconds ?? 0,
      medianCensored: median?.censored ?? false,
      p90Seconds: p90?.seconds ?? 0,
      p90Censored: p90?.censored ?? false,
    };
  }

  return { advanceTo, finish };
}

export function simulateFight({ rng = Math.random, player, enemy, maxSeconds = 300, assumptions = {}, trace = null }) {
  const traceRecorder = createTraceRecorder(trace);
  const fightRng = createTraceRng(rng, traceRecorder);
  const normalizedAssumptions = normalizeCombatAssumptions(assumptions);
  const normalizedPlayer = normalizeCombatant(player);
  const effectiveEnemy = buildSteamEnemy(enemy, normalizedAssumptions.steam);
  const normalizedEnemy = normalizeCombatant(effectiveEnemy);
  const playerFirstAttackDelayMultiplier = flowStateFirstAttackDelayMultiplier(normalizedEnemy, normalizedAssumptions);
  const steam = Boolean(normalizedAssumptions.steam);
  const battleSpeedupEnd = normalizedAssumptions.battleSpeedup?.remainingSeconds ?? Infinity;
  const initialSpeed = combatSpeedAtTime(normalizedAssumptions, 0);
  const seppukuRules = normalizedAssumptions.steam?.seppukuRules ?? [];
  const seppukuTimes = seppukuRules.flatMap(({ conditions }) => (conditions ?? [])
    .filter(({ stat }) => stat === "timeInBattle")
    .map(({ threshold }) => Number(threshold)));
  let lastPlayerAttack = 0;
  let lastEnemyAttack = 0;
  let lastRegenTick = 0;
  let lastStatusTick = 0;
  let playerAttacked = false;
  const combat = {
    player: normalizedPlayer,
    enemy: normalizedEnemy,
    assumptions: normalizedAssumptions,
    trace: traceRecorder,
    playerHp: stat(player, "maxHp", 1),
    enemyHp: steam ? toFiniteNumber(effectiveEnemy?.maxHp, 1) : stat(enemy, "maxHp", 1),
    playerStatuses: {},
    enemyStatuses: {},
    damageBreakdown: {
      player: createDamageBreakdown(),
      enemy: createDamageBreakdown(),
    },
    healingBreakdown: {
      player: createHealingBreakdown(),
      enemy: createHealingBreakdown(),
    },
    enemyStatusDamage: {},
    enemyHealingPreventedByFreeze: 0,
    executeContributedDamage: false,
    mechanicEvents: [],
    damageEvents: [],
    pendingEffects: [],
    nextPlayerAttack: attackDelay(
      normalizedPlayer,
      {},
      initialSpeed,
      playerFirstAttackDelayMultiplier,
    ),
    nextEnemyAttack: attackDelay(normalizedEnemy, {}, initialSpeed),
    nextRegenTick: REGEN_TICK_SECONDS / initialSpeed,
    nextStatusTick: STATUS_TICK_SECONDS / initialSpeed,
    time: 0,
    reason: "timeout",
  };
  recordTrace(combat, "start");

  while (combat.time < maxSeconds) {
    if (combat.enemyHp <= 0) return finish("player", "enemy_hp_zero", combat);
    if (combat.playerHp <= 0) return finish("enemy", "player_hp_zero", combat);
    if (seppukuRules.length > 0 && shouldTriggerSeppuku(combat, seppukuRules)) {
      return finishSeppuku(combat);
    }
    if (steam) {
      const speed = combatSpeedAtTime(normalizedAssumptions, combat.time);
      // Steam calculates each deadline from the last event and the current speed.
      combat.nextPlayerAttack = Math.max(combat.time, lastPlayerAttack + attackDelay(
        combat.player,
        combat.playerStatuses,
        speed,
        playerAttacked ? 1 : playerFirstAttackDelayMultiplier,
        true,
      ));
      combat.nextEnemyAttack = Math.max(combat.time, lastEnemyAttack + attackDelay(
        combat.enemy, combat.enemyStatuses, speed, 1, true,
      ));
      combat.nextRegenTick = Math.max(combat.time, lastRegenTick + REGEN_TICK_SECONDS / speed);
      combat.nextStatusTick = Math.max(combat.time, lastStatusTick + STATUS_TICK_SECONDS / speed);
    }
    const nextPendingEffect = nextPendingEffectTime(combat);
    const nextSeppukuCheck = seppukuTimes.reduce(
      (next, time) => time > combat.time ? Math.min(next, time) : next,
      Infinity,
    );
    const nextSpeedChange = combat.time < battleSpeedupEnd ? battleSpeedupEnd : Infinity;
    const nextTime = Math.min(
      combat.nextPlayerAttack,
      combat.nextEnemyAttack,
      nextPendingEffect,
      combat.nextRegenTick,
      combat.nextStatusTick,
      nextSeppukuCheck,
      nextSpeedChange,
      maxSeconds,
    );
    combat.time = nextTime;

    if (combat.time >= maxSeconds) break;
    if (seppukuRules.length > 0 && shouldTriggerSeppuku(combat, seppukuRules)) return finishSeppuku(combat);
    if (combat.time === nextSpeedChange) continue;

    if (isDue(nextPendingEffect, combat.time)) {
      const beforeEffect = traceSnapshot(combat);
      const action = processPendingEffect({ rng: fightRng, combat });
      recordTraceDelta(combat, "pending_effect", beforeEffect, {
        attackerSide: action.attackerSide,
        defenderSide: action.defenderSide,
        action,
      });
    } else if (isDue(combat.nextPlayerAttack, combat.time) && combat.nextPlayerAttack <= combat.nextEnemyAttack + TIME_EPSILON) {
      const beforeAttack = traceSnapshot(combat);
      delete combat.playerStatuses.BananaSlip;
      const action = performAttack({ rng: fightRng, combat, attackerSide: "player", defenderSide: "enemy" });
      recordTraceDelta(combat, "attack", beforeAttack, { attackerSide: "player", defenderSide: "enemy", action });
      if (steam) {
        lastPlayerAttack = combat.time;
        playerAttacked = true;
      } else {
        combat.nextPlayerAttack += attackDelay(combat.player, combat.playerStatuses, combat.assumptions.combatSpeedMultiplier);
      }
    } else if (isDue(combat.nextEnemyAttack, combat.time)) {
      const beforeAttack = traceSnapshot(combat);
      delete combat.enemyStatuses.BananaSlip;
      const action = performAttack({ rng: fightRng, combat, attackerSide: "enemy", defenderSide: "player" });
      recordTraceDelta(combat, "attack", beforeAttack, { attackerSide: "enemy", defenderSide: "player", action });
      if (steam) lastEnemyAttack = combat.time;
      else combat.nextEnemyAttack += attackDelay(combat.enemy, combat.enemyStatuses, combat.assumptions.combatSpeedMultiplier);
    } else if (isDue(combat.nextRegenTick, combat.time)) {
      const beforeTick = traceSnapshot(combat);
      applyRegenerationTick(combat, fightRng);
      recordTraceDelta(combat, "tick", beforeTick, { tickType: "regen", deltaSeconds: 1 });
      if (steam) lastRegenTick = combat.time;
      else combat.nextRegenTick += REGEN_TICK_SECONDS / initialSpeed;
    } else if (isDue(combat.nextStatusTick, combat.time)) {
      const beforeTick = traceSnapshot(combat);
      applyStatusTick(combat, fightRng);
      recordTraceDelta(combat, "tick", beforeTick, { tickType: "status", deltaSeconds: 1 });
      if (steam) lastStatusTick = combat.time;
      else combat.nextStatusTick += STATUS_TICK_SECONDS / initialSpeed;
    } else if (nextSeppukuCheck !== combat.time) {
      break;
    }
  }

  if (combat.enemyHp <= 0) return finish("player", "enemy_hp_zero", combat);
  if (combat.playerHp <= 0) return finish("enemy", "player_hp_zero", combat);
  const timeoutDiagnosis = diagnoseTimeout(combat);
  return finish("timeout", `timeout_${timeoutDiagnosis}`, combat, { timeoutDiagnosis });
}

function isDue(scheduledTime, currentTime) {
  return scheduledTime <= currentTime + TIME_EPSILON;
}

function nextPendingEffectTime(combat) {
  if (!combat.pendingEffects || combat.pendingEffects.length === 0) return Infinity;
  return Math.min(...combat.pendingEffects.map((effect) => effect.time));
}

function processPendingEffect({ rng, combat }) {
  const index = combat.pendingEffects
    .map((effect, itemIndex) => ({ effect, itemIndex }))
    .sort((a, b) => a.effect.time - b.effect.time)[0]?.itemIndex;
  if (index == null) return { type: "none" };

  const [effect] = combat.pendingEffects.splice(index, 1);
  if (effect.type === "counter") return performCounterEffect({ rng, combat, effect });
  return { type: effect.type ?? "unknown", skipped: true, reason: "unknown_pending_effect" };
}

function normalizeCombatant(input = {}) {
  return {
    id: input.id ?? input.sketchId ?? input.targetId ?? null,
    name: input.name ?? null,
    stats: { ...input },
    immunities: new Set(Array.isArray(input.immunities) ? input.immunities : []),
    vulnerability: Array.isArray(input.vulnerability) ? input.vulnerability : null,
    vulnerabilityEffects: normalizeVulnerabilityEffects(input.vulnerabilityEffects),
  };
}

function normalizeCombatAssumptions(input = {}) {
  const steam = input.steam ?? null;
  const speedupMultiplier = positiveFiniteNumber(input.battleSpeedup?.multiplier, 1);
  const remainingSeconds = positiveFiniteNumber(input.battleSpeedup?.remainingSeconds, 0);
  return {
    exportedEnemyStatusChanceScale: toFiniteNumber(
      input.exportedEnemyStatusChanceScale,
      steam ? 1 : DEFAULT_COMBAT_ASSUMPTIONS.exportedEnemyStatusChanceScale,
    ),
    exportedEnemyBuffChanceScale: toFiniteNumber(
      input.exportedEnemyBuffChanceScale,
      steam ? 1 : DEFAULT_COMBAT_ASSUMPTIONS.exportedEnemyBuffChanceScale,
    ),
    dotScale: toFiniteNumber(input.dotScale, DEFAULT_COMBAT_ASSUMPTIONS.dotScale),
    combatSpeedMultiplier: positiveFiniteNumber(
      input.combatSpeedMultiplier,
      DEFAULT_COMBAT_ASSUMPTIONS.combatSpeedMultiplier,
    ),
    battleSpeedup: steam && remainingSeconds > 0 ? { multiplier: speedupMultiplier, remainingSeconds } : null,
    flowStateActive: input.flowStateActive === true,
    flowStateLevel: Math.max(0, toFiniteNumber(input.flowStateLevel, DEFAULT_COMBAT_ASSUMPTIONS.flowStateLevel)),
    flowStateKnownTargetIds: normalizeStringSet(input.flowStateKnownTargetIds),
    inspirationCapBonus: Math.max(0, toFiniteNumber(input.inspirationCapBonus, 0)),
    steam,
  };
}

function finishSeppuku(combat) {
  const before = traceSnapshot(combat);
  addBreakdown(combat.damageBreakdown.player, "self", combat.playerHp);
  combat.playerHp = 0;
  recordTraceDelta(combat, "seppuku", before);
  return finish("enemy", "seppuku", combat);
}

function combatSpeedAtTime({ combatSpeedMultiplier, battleSpeedup }, time) {
  return battleSpeedup && time < battleSpeedup.remainingSeconds
    ? positiveFiniteNumber(combatSpeedMultiplier * battleSpeedup.multiplier, combatSpeedMultiplier)
    : combatSpeedMultiplier;
}

function flowStateFirstAttackDelayMultiplier(enemy, assumptions) {
  if (assumptions?.flowStateActive !== true) return 1;
  const level = toFiniteNumber(assumptions.flowStateLevel, 0);
  if (level <= 0) return 1;
  const enemyId = enemy?.id;
  if (!enemyId || !assumptions.flowStateKnownTargetIds?.has(enemyId)) return 1;
  return clamp(1 - level * 0.01, 0.1, 1);
}

function normalizeStringSet(value) {
  if (value instanceof Set) return new Set([...value].map(normalizeString).filter(Boolean));
  if (Array.isArray(value)) return new Set(value.map(normalizeString).filter(Boolean));
  return new Set();
}

function normalizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function finish(winner, reason, combat, extra = {}) {
  const deathCause = winner === "player"
    ? inferDeathCause(combat.damageBreakdown.enemy)
    : winner === "enemy"
      ? inferDeathCause(combat.damageBreakdown.player)
      : null;
  const result = {
    winner,
    reason,
    seconds: combat.time,
    playerHp: Math.max(0, combat.playerHp),
    enemyHp: Math.max(0, combat.enemyHp),
    damageBreakdown: cloneBreakdowns(combat.damageBreakdown),
    healingBreakdown: cloneBreakdowns(combat.healingBreakdown),
    deathCause,
    ...extra,
  };
  if (winner === "player") result.victoryCause = classifyVictoryCause(combat);
  if (combat.trace) {
    recordTrace(combat, "finish", { winner, reason, deathCause });
    result.trace = combat.trace.events;
  }
  return result;
}

function applyRegenerationTick(combat, rng) {
  applyRegenerationWithFreeze(combat, "player", stat(combat.player, "regen"), 1, rng);
  applyRegenerationWithFreeze(combat, "enemy", stat(combat.enemy, "regen"), 1, rng);
}

function applyStatusTick(combat, rng) {
  if (!combat.assumptions.steam) {
    if (Object.keys(combat.playerStatuses).length === 0
        && Object.keys(combat.enemyStatuses).length === 0) return;
    for (const tick of WEB_STATUS_TICKS) {
      for (const side of COMBAT_SIDES) tick(combat, side, rng);
    }
    return;
  }

  if (combat.playerHp > 0 && combat.enemyHp > 0) {
    applySteamStatusTransitions(combat.player, combat.playerStatuses, rng);
    applySteamStatusTransitions(combat.enemy, combat.enemyStatuses, rng);
    spreadSteamDiseases({
      combat,
      rng,
      blockLeap: ({ defenderSide, status, stacks }) => blockStatusWithLeap({ combat, rng, defenderSide, status, stacks }),
      onMechanic: (mechanic) => recordMechanic(combat, mechanic),
    });
  }
  for (const side of COMBAT_SIDES) {
    for (const tick of PERIODIC_DAMAGE_TICKS) tick(combat, side, rng);
    applyEnergyWaveTick(combat, opposingSide(side), rng);
    applyBalloonTick(combat, side);
    applyIrradiateTick(combat, side, rng);
  }
  for (const side of COMBAT_SIDES) applyInspirationTick(combat, side, rng);
}

function applyRegenerationWithFreeze(combat, side, healing, deltaSeconds, rng) {
  const statuses = combat[`${side}Statuses`];
  const freeze = statuses.Freeze ?? 0;

  if (healing > 0) {
    const healingWithoutFreeze = side === "enemy" && freeze > 0
      ? clamp(combatantMaxHp(combat.enemy) - combat.enemyHp, 0, healing)
      : 0;
    if (freeze > 100) {
      combat.enemyHealingPreventedByFreeze += healingWithoutFreeze;
      const beforeHp = combat[`${side}Hp`];
      const convertedDamage = healing * (freeze / 100 - 1);
      const dealtDamage = applyDamageToSide(combat, side, convertedDamage, rng, "status", {
        tags: ["regen", "Freeze"],
      });
      if (dealtDamage > 0) {
        recordMechanic(combat, {
          type: "regen",
          side,
          deltaSeconds,
          requestedHealing: healing,
          freeze,
          convertedDamage,
          dealtDamage,
          beforeHp,
          afterHp: combat[`${side}Hp`],
        });
      }
      return;
    }
    const healingTrace = healSide(combat, side, healing * Math.max(0, 1 - freeze / 100), "regen");
    combat.enemyHealingPreventedByFreeze += Math.max(0, healingWithoutFreeze - healingTrace.appliedHealing);
    if (healingTrace.appliedHealing > 0) {
      recordMechanic(combat, {
        type: "regen",
        side,
        deltaSeconds,
        requestedHealing: healing,
        freeze,
        ...healingTrace,
      });
    }
    return;
  }

  if (freeze > 0) {
    const beforeHp = combat[`${side}Hp`];
    const freezeDamage = freeze * deltaSeconds * combat.assumptions.dotScale;
    const dealtDamage = applyDamageToSide(combat, side, freezeDamage, rng, "status", {
      tags: ["periodic", "Freeze"],
    });
    if (dealtDamage > 0) {
      recordMechanic(combat, {
        type: "freeze_tick",
        side,
        deltaSeconds,
        freeze,
        damage: freezeDamage,
        dealtDamage,
        beforeHp,
        afterHp: combat[`${side}Hp`],
      });
    }
  }
}

function opposingSide(side) {
  return side === "player" ? "enemy" : "player";
}

function applyBurnTick(combat, side, rng) {
  const target = combat[side];
  const source = combat[opposingSide(side)];
  const statuses = combat[`${side}Statuses`];
  const stacks = statuses.Burn ?? 0;
  if (stacks <= 0 || combat[`${side}Hp`] <= 0) return;
  const damage = (statuses.BurnDamage ?? stacks * stat(source, "burnDamage", 1))
    * vulnerabilityMultiplier(target, "burnChance", "burnDamage");
  applyPeriodicDamage(combat, side, damage, "Burn", rng);
}

function applyPlagueTick(combat, side, rng) {
  const stacks = combat[`${side}Statuses`].Plague ?? 0;
  if (stacks <= 0 || combat[`${side}Hp`] <= 0) return;
  applyPeriodicDamage(combat, side, stacks, "Plague", rng);
  growStatusOverTime(combat, side, "Plague", stacks * 10, rng);
}

function applyPoisonTick(combat, side, rng) {
  const stacks = combat[`${side}Statuses`].Poison ?? 0;
  if (stacks <= 0 || combat[`${side}Hp`] <= 0) return;
  const target = combat[side];
  const damage = combatantMaxHp(target) * 0.001 * stacks
    * vulnerabilityMultiplier(target, "poisonChance", "poisonDamage");
  applyPeriodicDamage(combat, side, damage, "Poison", rng);
}

function applyBlackFlameTick(combat, side, rng) {
  const stacks = combat[`${side}Statuses`].BlackFlame ?? 0;
  const hp = combat[`${side}Hp`];
  if (stacks <= 0 || hp <= 0) return;
  const damage = hp * 0.01 * stacks * vulnerabilityMultiplier(combat[side], "blackFlameChance", "blackFlameDamage");
  applyPeriodicDamage(combat, side, damage, "BlackFlame", rng);
}

function applyBalloonTick(combat, side) {
  const statuses = combat[`${side}Statuses`];
  const before = statuses.Balloon ?? 0;
  const growth = Math.ceil(before * 0.25 * isolationMultiplier(combat[side]));
  if (growth <= 0) return;
  addStatus(statuses, "Balloon", growth);
  recordMechanic(combat, {
    type: "status_growth",
    side,
    status: "Balloon",
    deltaSeconds: 1,
    before,
    growth,
    after: statuses.Balloon ?? 0,
    chance: null,
  });
}

function applyIrradiateTick(combat, side, rng) {
  const stacks = combat[`${side}Statuses`].Irradiate ?? 0;
  if (stacks <= 0 || combat[`${side}Hp`] <= 0) return;
  const target = combat[side];
  const damage = target.vulnerability?.[0] === "irradiateChance"
    ? stacks * vulnerabilityMultiplier(target, "irradiateChance", "irradiateDamage")
    : Math.sqrt(stacks);
  applyPeriodicDamage(combat, side, damage, "Irradiate", rng);
  growStatusOverTime(combat, side, "Irradiate", stacks * 15, rng);
}

function applyPeriodicDamage(combat, side, damage, status, rng) {
  applyDamageToSide(combat, side, damage * combat.assumptions.dotScale, rng, "status", {
    tags: ["periodic", status],
  });
}

function growStatusOverTime(combat, side, status, chance, rng) {
  const statuses = combat[`${side}Statuses`];
  const effectiveChance = chance * isolationMultiplier(combat[side]);
  const before = statuses[status] ?? 0;
  const stacks = rollStacks(rng, effectiveChance, `tick.${status}.growth`);
  if (stacks > 0) {
    addStatus(statuses, status, stacks);
    recordMechanic(combat, {
      type: "status_growth",
      side,
      status,
      deltaSeconds: 1,
      before,
      growth: stacks,
      after: statuses[status] ?? 0,
      chance: effectiveChance,
    });
  }
}

function isolationMultiplier(combatant) {
  return Math.max(0, 1 - stat(combatant, "isolation") / 100);
}

function applyEnergyWaveTick(combat, side, rng) {
  const defenderSide = opposingSide(side);
  const source = combat[side];
  const target = combat[defenderSide];
  const statuses = combat[`${side}Statuses`];
  const stacks = statuses.EnergyWave ?? 0;
  if (stacks <= 0 || combat[`${side}Hp`] <= 0 || combat[`${defenderSide}Hp`] <= 0) return;

  const consumed = Math.min(stacks, Math.max(1, Math.floor(stacks * 0.1)));
  const inspiration = statuses.Inspiration ?? 0;
  const multiplier = vulnerabilityMultiplier(target, "energyWaveChance", "energyWaveDamage");
  const damage = stat(source, "attack") * consumed * (1 + inspiration / 100) * multiplier;
  const blockedByImmunity = target.immunities.has("energyWaveChance");
  const dealtDamage = blockedByImmunity ? 0 : applyDamageToSide(combat, defenderSide, damage, rng, "energyWave");
  statuses.EnergyWave -= consumed;
  if (statuses.EnergyWave <= 0) delete statuses.EnergyWave;
  recordMechanic(combat, {
    type: "energy_wave_tick",
    attackerSide: side,
    defenderSide,
    deltaSeconds: 1,
    stacksBefore: stacks,
    consumed,
    stacksAfter: statuses.EnergyWave ?? 0,
    inspiration,
    vulnerabilityMultiplier: multiplier,
    damage,
    dealtDamage,
    blockedByImmunity,
  });
}

function applyInspirationTick(combat, side, rng) {
  const combatant = combat[side];
  if (combat[`${side}Hp`] <= 0) return;

  const rawChance = applicationChance(
    combatant,
    "inspirationChance",
    combat.assumptions.exportedEnemyBuffChanceScale,
  );
  if (rawChance <= 0) return;

  const stacks = rollStacks(rng, rawChance, `tick.${side}.Inspiration.apply`);
  if (stacks <= 0) return;

  const buff = applyCombatBuff({
    combat,
    rng,
    status: "Inspiration",
    stacks,
    intendedSide: side,
    capBonus: combat.assumptions.inspirationCapBonus,
  });
  if (!buff) return;
  recordMechanic(combat, {
    type: "self_buff_tick",
    side: buff.side,
    status: "Inspiration",
    chance: rawChance,
    stacks,
    before: buff.before,
    after: buff.after,
  });
}

function performAttack({ rng, combat, attackerSide, defenderSide, counterEffect = null }) {
  const attacker = combat[attackerSide];
  const attackerStatuses = combat[`${attackerSide}Statuses`];
  const steam = Boolean(combat.assumptions.steam);
  // The web resolver reads these conditions from its turn-start status object.
  const initialStatuses = steam ? attackerStatuses : {
    Hinder: attackerStatuses.Hinder,
    BananaPeel: attackerStatuses.BananaPeel,
    Hypnotize: attackerStatuses.Hypnotize,
    HotPotato: attackerStatuses.HotPotato,
    Bleed: attackerStatuses.Bleed,
    Curse: attackerStatuses.Curse,
  };
  let targetSide = defenderSide;
  let target = combat[targetSide];
  let targetStatuses = combat[`${targetSide}Statuses`];

  const remedyTrace = applyRemedy(rng, attacker, attackerStatuses);
  if (remedyTrace) {
    recordMechanic(combat, { ...remedyTrace, side: attackerSide });
    if (steam) {
      const removedStacks = Object.values(remedyTrace.removed).reduce((sum, removed) => sum + removed, 0);
      const stacks = rollSteamBuffConversion(rng, removedStacks, 0.02, "self.Remedy.inspiration");
      if (stacks > 0) applyCombatBuff({ combat, rng, status: "Inspiration", stacks, intendedSide: attackerSide });
    }
  }
  if (steam && shouldSkipForParalysis(rng, attackerStatuses)) {
    return { type: "skip_turn", reason: "paralysis", damage: 0 };
  }
  const skip = shouldSkipTurn(rng, attacker, attackerStatuses, steam, initialStatuses);
  if (skip.skipped) return { type: "skip_turn", damage: 0 };

  const hypnotize = resolveHypnotize(rng, attackerStatuses, initialStatuses);
  if (hypnotize.redirected) {
    targetSide = attackerSide;
    target = attacker;
    targetStatuses = attackerStatuses;
    recordMechanic(combat, {
      type: "hypnotize",
      attackerSide,
      originalDefenderSide: defenderSide,
      redirectedTargetSide: targetSide,
    });
  }

  const hitCount = rollMultistrikeHitCount(rng, stat(attacker, "multiStrikeChance"), `${attackerSide}.multiStrike`);
  let hotPotatoPassStacks = applyHotPotatoBeforeAttack({ rng, combat, attackerSide, initialStacks: initialStatuses.HotPotato ?? 0 });
  if (combat[`${attackerSide}Hp`] <= 0) {
    return { type: "self_status", damage: 0, hitCount };
  }

  const rollSurreal = () =>
    rollPercent(rng, stat(attacker, "surrealism"), `${attackerSide}.surrealism`) && !target.immunities.has("surrealism");
  const steamSurreal = steam && rollSurreal();

  let totalDamage = 0;
  let totalRequestedDamage = 0;
  let originalDefenderDamage = 0;
  let landedHits = 0;
  let dodgedHits = 0;
  let parriedHits = 0;
  let webCounterChance = 0;
  for (let hit = 0; hit < hitCount; hit += 1) {
    const targetHpKey = `${targetSide}Hp`;
    const targetHp = combat[targetHpKey];
    if (targetHp <= 0 || combat[`${attackerSide}Hp`] <= 0) break;
    const targetHpBeforeHit = targetHp;
    const isSurreal = steam ? steamSurreal : rollSurreal();

    const offenseTrace = {
      type: "offense",
      attackerSide,
      defenderSide: targetSide,
      isSelfAttack: targetSide === attackerSide,
      ...(counterEffect && { isCounter: true }),
    };
    let damage = baseAttackDamage(rng, attacker, attackerStatuses, offenseTrace, counterEffect?.amount);
    damage = applyOffensiveMultipliers(
      rng,
      damage,
      attacker,
      target,
      targetHp,
      combatantMaxHp(target),
      offenseTrace,
      steam ? combat[`${attackerSide}Hp`] : null,
    );
    recordMechanic(combat, offenseTrace);

    const evasion = resolveEvasion({ rng, combat, attackerSide, defenderSide: targetSide, damage, isSurreal });
    if (evasion.type === "dodge") {
      dodgedHits += 1;
      continue;
    }
    if (evasion.type === "parry") {
      parriedHits += 1;
      continue;
    }
    damage = evasion.damage;

    const mitigationCapture = {};
    if (attackerSide === "player" && targetSide === "enemy" && offenseTrace.execute?.triggered) {
      mitigationCapture.damageWithoutExecute = damage / (stat(attacker, "execute") / 100);
    }
    damage = applyDefensiveMitigation(rng, damage, attacker, target, targetStatuses, isSurreal, {
      combat,
      attackerSide,
      defenderSide: targetSide,
      capture: mitigationCapture,
    });
    const paralysisMultiplier = combat.assumptions.steam && targetStatuses.ParalysisExposed > 0 ? 2 : 1;
    damage = applyParalysisExposure(combat, targetSide, damage);

    let electrocuteTrace = null;
    let electrocuteDamage = 0;
    const electrocute = targetStatuses.Electrocute ?? 0;
    if (electrocute > 0) {
      const beforeElectrocute = damage;
      const roll = rng("status.Electrocute.damage");
      const addedDamage = damage * (electrocute / 100) * roll;
      electrocuteDamage = addedDamage;
      electrocuteTrace = {
        type: "electrocute",
        attackerSide,
        defenderSide: targetSide,
        stacks: electrocute,
        roll,
        before: beforeElectrocute,
        addedDamage,
        after: beforeElectrocute + addedDamage,
      };
      recordMechanic(combat, electrocuteTrace);
    }

    const directModifierCapture = {};
    damage = applyDirectStatusDamageModifiers(damage, targetStatuses, {
      combat,
      attackerSide,
      defenderSide: targetSide,
      capture: directModifierCapture,
    });

    const requestedDamage = damage + electrocuteDamage;
    const tags = directDamageTags(offenseTrace, mitigationCapture.trace, directModifierCapture.trace, electrocuteTrace);
    if (counterEffect) tags.push("counter");
    const appliedDamage = applyDamageToSide(combat, targetSide, requestedDamage, rng, counterEffect ? "reflect" : "direct", {
      attackerSide,
      defenderSide: targetSide,
      tags,
    });
    if (mitigationCapture.damageWithoutExecute != null && appliedDamage > 0) {
      const baseline = mitigationCapture.damageWithoutExecute * paralysisMultiplier;
      const baselineElectrocute = electrocuteTrace ? baseline * (electrocute / 100) * electrocuteTrace.roll : 0;
      const baselineDirect = applyDirectStatusDamageModifiers(baseline, targetStatuses);
      const baselineDamage = Math.min(targetHpBeforeHit, baselineDirect + baselineElectrocute);
      if (appliedDamage - baselineDamage > Number.EPSILON * appliedDamage * 8) {
        combat.executeContributedDamage = true;
      }
    }
    totalDamage += appliedDamage;
    totalRequestedDamage += requestedDamage;
    if (targetSide === defenderSide) originalDefenderDamage += appliedDamage;

    if (steam) {
      applySteamReactiveDamage({ rng, combat, attackerSide, defenderSide: targetSide, isSurreal });
    } else {
      const chance = rollCounterChance({ rng, combat, attackerSide, defenderSide: targetSide, isSurreal });
      if (chance > 0) webCounterChance = chance;
    }

    landedHits += 1;
    applyStatuses(rng, attacker, target, targetStatuses, combat.assumptions, {
      isSurreal,
      combat,
      defenderSide: targetSide,
    });
    if (hotPotatoPassStacks > 0) {
      const targetBefore = targetStatuses.HotPotato ?? 0;
      addStatus(targetStatuses, "HotPotato", hotPotatoPassStacks);
      recordMechanic(combat, {
        type: "hot_potato_pass",
        fromSide: attackerSide,
        toSide: targetSide,
        stacks: hotPotatoPassStacks,
        targetBefore,
        targetAfter: targetStatuses.HotPotato ?? 0,
      });
      hotPotatoPassStacks = 0;
    }
    applyBalloonPop({ rng, combat, attacker, defender: target, defenderSide: targetSide });
    growBrittleAfterHit({ combat, defenderSide: targetSide, defenderHpBeforeHit: targetHpBeforeHit });
    if (!steam) applyThorns({ rng, combat, attackerSide, defenderSide: targetSide });
    applySelfBuffs({ rng, combat, attackerSide, attacker });
  }

  if (landedHits > 0) {
    applyExacerbate(rng, attacker, target, targetStatuses, combat.assumptions, {
      combat,
      attackerSide,
      defenderSide: targetSide,
    });
    applyResonance(rng, attacker, attackerStatuses, {
      combat,
      side: attackerSide,
    });
    applyPurge(rng, attacker, target, targetStatuses, {
      combat,
      attackerSide,
      defenderSide: targetSide,
    });
  }

  const bleedStacks = initialStatuses.Bleed ?? 0;
  if (bleedStacks > 0 && originalDefenderDamage > 0) {
    const multiplier = vulnerabilityMultiplier(attacker, "bleedChance", "bleedRecoil");
    applyDamageToSide(combat, attackerSide, originalDefenderDamage * bleedStacks * 0.01 * multiplier, rng, "status", {
      tags: ["recoil", "Bleed"],
    });
  }

  const curseStacks = initialStatuses.Curse ?? 0;
  if (curseStacks > 0) {
    const reflectedDamage = stat(combat[defenderSide], "attack") * (curseStacks / 100);
    if (reflectedDamage > 0) {
      const appliedCurseDamage = applyDamageToSide(combat, attackerSide, reflectedDamage, rng, "status", {
        tags: ["Curse", "reflection"],
      });
      recordMechanic(combat, {
        type: "curse_reflection",
        side: attackerSide,
        defenderSide,
        stacks: curseStacks,
        defenderAttack: roundTraceNumber(stat(combat[defenderSide], "attack")),
        damage: roundTraceNumber(reflectedDamage),
        dealtDamage: roundTraceNumber(appliedCurseDamage),
      });
    }
  }

  const lifesteal = stat(attacker, "lifesteal");
  if (lifesteal > 0 && originalDefenderDamage > 0 && combat[`${attackerSide}Hp`] > 0
    && !target.immunities.has("lifesteal")) {
    const requestedHealing = originalDefenderDamage * (lifesteal / 100);
    const healingTrace = healSide(combat, attackerSide, requestedHealing, "lifesteal");
    recordMechanic(combat, {
      type: "lifesteal",
      side: attackerSide,
      outgoingDamage: originalDefenderDamage,
      percent: lifesteal,
      requestedHealing,
      ...healingTrace,
    });
  }

  if (webCounterChance > 0 && !counterEffect) {
    scheduleCounter({ combat, attackerSide, defenderSide, chance: webCounterChance });
  }

  return {
    type: landedHits > 0 ? totalDamage > 0 ? "hit" : "blocked_or_absorbed" : "missed",
    hitCount,
    landedHits,
    dodgedHits,
    parriedHits,
    totalDamage,
    targetSide,
    isHypnotized: hypnotize.redirected,
    ...(counterEffect && { totalRequestedDamage }),
  };
}

function baseAttackDamage(rng, attacker, attackerStatuses, trace, baseDamage = null) {
  let damage = baseDamage == null || !Number.isFinite(Number(baseDamage))
    ? stat(attacker, "attack")
    : Number(baseDamage);
  const baseAttack = damage;
  if (trace) trace.baseAttack = roundTraceNumber(baseAttack);

  const inspiration = attackerStatuses.Inspiration ?? 0;
  if (inspiration > 0) {
    const before = damage;
    damage *= 1 + inspiration / 100;
    if (trace) {
      trace.inspiration = {
        stacks: roundTraceNumber(inspiration),
        before: roundTraceNumber(before),
        after: roundTraceNumber(damage),
      };
    }
  }

  const rollMin = stat(attacker, "minDamage", 75) / 100;
  const rollMax = stat(attacker, "maxDamage", 125) / 100;
  const beforeRoll = damage;
  const damageRoll = randomBetween(rng, rollMin, rollMax, "hit.damageRoll");
  damage *= damageRoll;
  if (trace) {
    trace.damageRoll = {
      min: roundTraceNumber(rollMin),
      max: roundTraceNumber(rollMax),
      result: roundTraceNumber(damageRoll),
      before: roundTraceNumber(beforeRoll),
      after: roundTraceNumber(damage),
    };
  }
  return damage;
}

function applyOffensiveMultipliers(rng, damage, attacker, defender, defenderHp, defenderMaxHp, trace, steamAttackerHp) {
  let result = damage;
  const hpRatio = defenderMaxHp <= 0 ? 1 : defenderHp / defenderMaxHp;
  const execute = stat(attacker, "execute");
  if (hpRatio <= 0.3 && execute > 100 && !defender.immunities.has("execute")) {
    const before = result;
    result *= execute / 100;
    if (trace) {
      trace.execute = {
        triggered: true,
        hpRatio: roundTraceNumber(hpRatio),
        threshold: 0.3,
        multiplier: roundTraceNumber(execute / 100),
        before: roundTraceNumber(before),
        after: roundTraceNumber(result),
      };
    }
  }

  if (steamAttackerHp != null) {
    const maxHp = combatantMaxHp(attacker);
    const attackerHpRatio = maxHp <= 0 ? 1 : steamAttackerHp / maxHp;
    const berserk = stat(attacker, "berserk");
    if (attackerHpRatio <= 0.25 && berserk > 100 && !defender.immunities.has("berserk")) {
      const before = result;
      const multiplier = berserk / 100;
      result *= multiplier;
      if (trace) {
        trace.berserk = {
          triggered: true,
          hpRatio: roundTraceNumber(attackerHpRatio),
          threshold: 0.25,
          multiplier: roundTraceNumber(multiplier),
          before: roundTraceNumber(before),
          after: roundTraceNumber(result),
        };
      }
    }
  }

  const critChance = stat(attacker, "critChance");
  const critSuccess = rollPercent(rng, critChance, "hit.crit");
  if (trace) {
    trace.crit = {
      chance: roundTraceNumber(critChance),
      success: critSuccess,
    };
  }
  if (critSuccess) {
    const glancingChance = stat(defender, "glancingBlow");
    const glancingSuccess = rollPercent(rng, glancingChance, "hit.glancingBlow");
    if (trace) {
      trace.glancing = {
        chance: roundTraceNumber(glancingChance),
        success: glancingSuccess,
      };
    }
    if (!glancingSuccess) {
      const beforeCrit = result;
      const critMultiplier = (stat(attacker, "critDmg", 150) * vulnerabilityMultiplier(defender, "critDmg", "critDamage")) / 100;
      result *= critMultiplier;
      if (trace) {
        trace.crit = {
          chance: roundTraceNumber(critChance),
          success: true,
          multiplier: roundTraceNumber(critMultiplier),
          before: roundTraceNumber(beforeCrit),
          after: roundTraceNumber(result),
        };
      }
      const goldenLuckChance = stat(attacker, "goldenLuckChance");
      const goldenLuckSuccess = rollPercent(rng, goldenLuckChance, "hit.goldenLuck");
      if (trace) {
        trace.goldenLuck = {
          chance: roundTraceNumber(goldenLuckChance),
          success: goldenLuckSuccess,
        };
      }
      if (goldenLuckSuccess) {
        const beforeGoldenLuck = result;
        const goldenLuckMultiplier = stat(attacker, "goldenLuckDamage", 150) / 100;
        result *= goldenLuckMultiplier;
        if (trace) {
          trace.goldenLuck = {
            chance: roundTraceNumber(goldenLuckChance),
            success: true,
            multiplier: roundTraceNumber(goldenLuckMultiplier),
            before: roundTraceNumber(beforeGoldenLuck),
            after: roundTraceNumber(result),
          };
        }
      }
    } else if (trace) {
      trace.crit.applied = false;
    }
  }

  if (trace) trace.finalDamage = roundTraceNumber(result);
  return result;
}

function applyDefensiveMitigation(rng, damage, attacker, defender, defenderStatuses, isSurreal, options = {}) {
  let result = damage;
  let damageWithoutExecute = options.capture?.damageWithoutExecute;
  const trace = {
    type: "mitigation",
    attackerSide: options.attackerSide,
    defenderSide: options.defenderSide,
    incomingDamage: roundTraceNumber(damage),
    isSurreal: Boolean(isSurreal),
  };
  let changed = false;

  if (!isSurreal) {
    const blockChance = stat(defender, "blockChance");
    const blockSuccess = rollPercent(rng, blockChance, "mitigation.block");
    if (blockSuccess || blockChance > 0) {
      const before = result;
      const blockAmount = blockSuccess ? stat(defender, "blockAmount") : 0;
      if (blockSuccess) {
        result = Math.max(0, result - blockAmount);
        if (damageWithoutExecute != null) damageWithoutExecute = Math.max(0, damageWithoutExecute - blockAmount);
      }
      trace.block = {
        chance: roundTraceNumber(blockChance),
        success: blockSuccess,
        amount: roundTraceNumber(blockAmount),
        before: roundTraceNumber(before),
        after: roundTraceNumber(result),
      };
      changed = true;
    }
  }

  if (!isSurreal) {
    const effectiveArmor = Math.max(0, stat(defender, "armor") - stat(attacker, "armorPen"));
    const beforeArmor = result;
    result = Math.max(0, result - effectiveArmor);
    if (damageWithoutExecute != null) damageWithoutExecute = Math.max(0, damageWithoutExecute - effectiveArmor);
    if (effectiveArmor > 0) {
      trace.armor = {
        amount: roundTraceNumber(effectiveArmor),
        before: roundTraceNumber(beforeArmor),
        after: roundTraceNumber(result),
      };
      changed = true;
    }

    const absorbPercent = clamp(stat(defender, "absorb"), 0, 100);
    const absorb = absorbPercent / 100;
    const beforeAbsorb = result;
    result *= 1 - absorb;
    if (damageWithoutExecute != null) damageWithoutExecute *= 1 - absorb;
    if (absorbPercent > 0) {
      trace.absorb = {
        percent: roundTraceNumber(absorbPercent),
        before: roundTraceNumber(beforeAbsorb),
        after: roundTraceNumber(result),
      };
      changed = true;
    }
  }

  result = Math.max(0, result);
  if (damageWithoutExecute != null) options.capture.damageWithoutExecute = Math.max(0, damageWithoutExecute);
  if (changed) {
    trace.finalDamage = roundTraceNumber(result);
    if (options.capture) options.capture.trace = trace;
    recordMechanic(options.combat, trace);
  }
  return result;
}

function applyDirectStatusDamageModifiers(damage, defenderStatuses, options = {}) {
  let result = damage;
  const trace = {
    type: "direct_status_modifiers",
    attackerSide: options.attackerSide,
    defenderSide: options.defenderSide,
    incomingDamage: roundTraceNumber(damage),
  };
  let changed = false;

  const frailty = defenderStatuses.Frailty ?? 0;
  if (frailty > 0) {
    const before = result;
    result *= 1 + frailty / 100;
    trace.frailty = {
      stacks: roundTraceNumber(frailty),
      before: roundTraceNumber(before),
      after: roundTraceNumber(result),
    };
    changed = true;
  }

  const brittle = defenderStatuses.Brittle ?? 0;
  if (brittle > 0) {
    const before = result;
    result += brittle;
    trace.brittle = {
      stacks: roundTraceNumber(brittle),
      before: roundTraceNumber(before),
      after: roundTraceNumber(result),
    };
    changed = true;
  }

  result = Math.max(0, result);
  if (changed) {
    trace.finalDamage = roundTraceNumber(result);
    if (options.capture) options.capture.trace = trace;
    recordMechanic(options.combat, trace);
  }
  return result;
}

function applyParalysisExposure(combat, side, damage) {
  const statuses = combat[`${side}Statuses`];
  if (!combat.assumptions.steam || !(statuses.ParalysisExposed > 0)) return damage;
  delete statuses.ParalysisExposed;
  recordMechanic(combat, { type: "paralysis_exposure", side, before: damage, after: damage * 2 });
  return damage * 2;
}

function resolveEvasion({ rng, combat, attackerSide, defenderSide, damage, isSurreal }) {
  if (isSurreal) return { type: "hit", damage };

  const attacker = combat[attackerSide];
  const defender = combat[defenderSide];
  const steam = Boolean(combat.assumptions.steam);

  const dodgeChance = stat(defender, "dodge");
  const dodgeSuccess = rollPercent(rng, dodgeChance, "evasion.dodge");
  if (dodgeSuccess) {
    const accuracyChance = stat(attacker, "accuracy");
    const accuracySuccess = rollPercent(rng, accuracyChance, "evasion.dodgeAccuracy");
    if (!accuracySuccess || steam) {
      recordMechanic(combat, {
        type: "evasion",
        mode: "dodge",
        attackerSide,
        defenderSide,
        incomingDamage: roundTraceNumber(damage),
        dodgeChance: roundTraceNumber(dodgeChance),
        dodgeSuccess,
        accuracyChance: roundTraceNumber(accuracyChance),
        accuracySuccess,
        outcome: accuracySuccess ? "bypassed" : "dodge",
        ...(accuracySuccess && { outgoingDamage: roundTraceNumber(damage * 1.5) }),
      });
    }
    if (!accuracySuccess) return { type: "dodge" };
    if (steam) damage *= 1.5;
  }

  const parryChance = stat(defender, "parry");
  const parrySuccess = rollPercent(rng, parryChance, "evasion.parry");
  if (parrySuccess) {
    const accuracyChance = stat(attacker, "accuracy");
    const accuracySuccess = rollPercent(rng, accuracyChance, "evasion.parryAccuracy");
    if (accuracySuccess && !steam) return { type: "hit", damage };
    const multiplier = vulnerabilityMultiplier(attacker, "parryDmg", "parryDamage");
    const parryDamage = accuracySuccess || attacker.immunities.has("parryDmg")
      ? 0
      : damage * (stat(defender, "parryDmg") / 100) * multiplier;
    const appliedParryDamage = applyDamageToSide(combat, attackerSide, parryDamage, rng, "parry", {
      tags: ["parry"],
    });
    recordMechanic(combat, {
      type: "evasion",
      mode: "parry",
      attackerSide,
      defenderSide,
      incomingDamage: roundTraceNumber(damage),
      parryChance: roundTraceNumber(parryChance),
      parrySuccess,
      accuracyChance: roundTraceNumber(accuracyChance),
      accuracySuccess,
      parryDamage: roundTraceNumber(appliedParryDamage),
      outcome: accuracySuccess ? "bypassed" : "parry",
      ...(accuracySuccess && { outgoingDamage: roundTraceNumber(damage * 1.5) }),
    });
    return accuracySuccess ? { type: "hit", damage: damage * 1.5 } : { type: "parry" };
  }

  return { type: "hit", damage };
}

function applySteamReactiveDamage({ rng, combat, attackerSide, defenderSide, isSurreal }) {
  if (isSurreal) return;
  const chance = rollCounterChance({ rng, combat, attackerSide, defenderSide, isSurreal });
  if (chance > 0) scheduleCounter({ combat, attackerSide, defenderSide, chance });
  applyThorns({ rng, combat, attackerSide, defenderSide });
}

function rollCounterChance({ rng, combat, attackerSide, defenderSide, isSurreal }) {
  const chance = isSurreal ? 0 : stat(combat[defenderSide], "counter");
  return rollPercent(rng, chance, "reactive.counter") && !combat[attackerSide].immunities.has("counter") ? chance : 0;
}

function scheduleCounter({ combat, attackerSide, defenderSide, chance }) {
  const delaySeconds = COUNTER_DELAY_SECONDS / combatSpeedAtTime(combat.assumptions, combat.time);
  const scheduledTime = combat.time + delaySeconds;
  const amount = stat(combat[defenderSide], "attack");
  combat.pendingEffects.push({
    type: "counter",
    time: scheduledTime,
    counterSide: defenderSide,
    targetSide: attackerSide,
    amount,
    chance,
  });
  recordMechanic(combat, {
    type: "counter_scheduled",
    defenderSide,
    attackerSide,
    chance,
    success: true,
    delaySeconds,
    scheduledTime: roundTraceNumber(scheduledTime),
    damage: roundTraceNumber(amount),
    dealtDamage: 0,
  });
}

function applyThorns({ rng, combat, attackerSide, defenderSide }) {
  const attacker = combat[attackerSide];
  const thornsStacks = combat[`${defenderSide}Statuses`].Thorns ?? 0;
  if (thornsStacks <= 0 || attacker.immunities.has("thornsChance")) return;
  const multiplier = vulnerabilityMultiplier(attacker, "thornsChance", "thornsDamage");
  const damage = thornsStacks * multiplier;
  const dealtDamage = applyDamageToSide(combat, attackerSide, damage, rng, "reflect", {
    tags: ["thorns"],
  });
  recordMechanic(combat, {
    type: "thorns",
    defenderSide,
    attackerSide,
    stacks: thornsStacks,
    vulnerabilityMultiplier: multiplier,
    damage,
    dealtDamage,
  });
  if (!combat.assumptions.steam && rollPercent(rng, Math.log10(thornsStacks), "reactive.thorns.debuffs")) {
    for (const status of ["Bleed", "Hinder", "Frailty", "Slow"]) {
      if (!attacker.immunities.has(STATUS_TO_STAT[status]) && !attacker.immunities.has(status)) {
        addStatus(combat[`${attackerSide}Statuses`], status, 1);
      }
    }
  }
}

function performCounterEffect({ rng, combat, effect }) {
  const attackerSide = effect.counterSide;
  const defenderSide = effect.targetSide;
  const attacker = combat[attackerSide];
  const defender = combat[defenderSide];
  const attackerStatuses = combat[`${attackerSide}Statuses`];
  const defenderStatuses = combat[`${defenderSide}Statuses`];

  if (!attacker || !defender || combat[`${attackerSide}Hp`] <= 0 || combat[`${defenderSide}Hp`] <= 0) {
    recordMechanic(combat, {
      type: "counter",
      defenderSide: attackerSide,
      attackerSide: defenderSide,
      scheduledTime: roundTraceNumber(effect.time),
      skipped: true,
      reason: "dead_side",
      damage: 0,
      dealtDamage: 0,
    });
    return { type: "counter", attackerSide, defenderSide, skipped: true, reason: "dead_side", damage: 0 };
  }
  if (!combat.assumptions.steam) return performWebCounter({ rng, combat, effect, attackerSide, defenderSide });
  if (shouldSkipForParalysis(rng, attackerStatuses)) {
    return { type: "counter", attackerSide, defenderSide, skipped: true, reason: "paralysis", damage: 0 };
  }

  const offenseTrace = {
    type: "offense",
    attackerSide,
    defenderSide,
    isCounter: true,
    isSelfAttack: false,
  };
  let damage = baseAttackDamage(rng, attacker, attackerStatuses, offenseTrace, effect.amount);
  damage = applyOffensiveMultipliers(
    rng,
    damage,
    attacker,
    defender,
    combat[`${defenderSide}Hp`],
    combatantMaxHp(defender),
    offenseTrace,
    combat[`${attackerSide}Hp`],
  );
  recordMechanic(combat, offenseTrace);

  const evasion = resolveEvasion({ rng, combat, attackerSide, defenderSide, damage, isSurreal: false });
  if (evasion.type === "dodge" || evasion.type === "parry") {
    recordMechanic(combat, {
      type: "counter",
      defenderSide: attackerSide,
      attackerSide: defenderSide,
      chance: effect.chance,
      success: true,
      scheduledTime: roundTraceNumber(effect.time),
      outcome: evasion.type,
      damage: 0,
      dealtDamage: 0,
    });
    return { type: "counter", attackerSide, defenderSide, damage: 0, outcome: evasion.type };
  }
  damage = evasion.damage;

  const mitigationCapture = {};
  damage = applyDefensiveMitigation(rng, damage, attacker, defender, defenderStatuses, false, {
    combat,
    attackerSide,
    defenderSide,
    capture: mitigationCapture,
  });
  damage = applyParalysisExposure(combat, defenderSide, damage);

  let electrocuteTrace = null;
  let electrocuteDamage = 0;
  const electrocute = defenderStatuses.Electrocute ?? 0;
  if (electrocute > 0) {
    const beforeElectrocute = damage;
    const roll = rng("status.Electrocute.damage");
    electrocuteDamage = damage * (electrocute / 100) * roll;
    electrocuteTrace = {
      type: "electrocute",
      attackerSide,
      defenderSide,
      stacks: electrocute,
      roll,
      before: beforeElectrocute,
      addedDamage: electrocuteDamage,
      after: beforeElectrocute + electrocuteDamage,
    };
    recordMechanic(combat, electrocuteTrace);
  }

  const directModifierCapture = {};
  damage = applyDirectStatusDamageModifiers(damage, defenderStatuses, {
    combat,
    attackerSide,
    defenderSide,
    capture: directModifierCapture,
  });

  const requestedDamage = damage + electrocuteDamage;
  const dealtDamage = applyDamageToSide(combat, defenderSide, requestedDamage, rng, "reflect", {
    attackerSide,
    defenderSide,
    tags: [...directDamageTags(offenseTrace, mitigationCapture.trace, directModifierCapture.trace, electrocuteTrace), "counter"],
  });
  applyStatuses(rng, attacker, defender, defenderStatuses, combat.assumptions, { combat, defenderSide });
  applySelfBuffs({ rng, combat, attackerSide, attacker });
  recordMechanic(combat, {
    type: "counter",
    defenderSide: attackerSide,
    attackerSide: defenderSide,
    chance: effect.chance,
    success: true,
    scheduledTime: roundTraceNumber(effect.time),
    damage: roundTraceNumber(requestedDamage),
    dealtDamage: roundTraceNumber(dealtDamage),
  });

  return {
    type: "counter",
    attackerSide,
    defenderSide,
    damage: dealtDamage,
  };
}

function performWebCounter({ rng, combat, effect, attackerSide, defenderSide }) {
  const { type, totalDamage = 0, totalRequestedDamage = 0, ...turn } = performAttack({
    rng, combat, attackerSide, defenderSide, counterEffect: effect,
  });
  let outcome = type;
  if (type === "missed") {
    if (turn.dodgedHits > 0 && turn.parriedHits === 0) outcome = "dodge";
    if (turn.parriedHits > 0 && turn.dodgedHits === 0) outcome = "parry";
  }
  const skipped = type === "skip_turn";
  recordMechanic(combat, {
    type: "counter",
    defenderSide: attackerSide,
    attackerSide: defenderSide,
    chance: effect.chance,
    success: true,
    scheduledTime: roundTraceNumber(effect.time),
    outcome,
    skipped,
    damage: roundTraceNumber(totalRequestedDamage),
    dealtDamage: roundTraceNumber(totalDamage),
  });
  return { ...turn, type: "counter", attackerSide, defenderSide, damage: totalDamage, outcome, skipped };
}

function applyHotPotatoBeforeAttack({ rng, combat, attackerSide, initialStacks: stacks }) {
  const attacker = combat[attackerSide];
  const attackerStatuses = combat[`${attackerSide}Statuses`];
  if (stacks <= 0) return 0;

  const roll = rng("hotPotato.branch");
  if (roll < 0.5) {
    addStatus(attackerStatuses, "HotPotato", 1);
    recordHotPotatoBranch(combat, attackerSide, "add_1", stacks, attackerStatuses.HotPotato, { roll });
    return 0;
  }
  if (roll < 0.6) {
    addStatus(attackerStatuses, "HotPotato", 5);
    recordHotPotatoBranch(combat, attackerSide, "add_5", stacks, attackerStatuses.HotPotato, { roll });
    return 0;
  }
  if (roll < 0.65) {
    addStatus(attackerStatuses, "HotPotato", 10);
    recordHotPotatoBranch(combat, attackerSide, "add_10", stacks, attackerStatuses.HotPotato, { roll });
    return 0;
  }
  if (roll < 0.75) {
    attackerStatuses.HotPotato = stacks * 2;
    recordHotPotatoBranch(combat, attackerSide, "x2", stacks, attackerStatuses.HotPotato, { roll });
    return 0;
  }
  if (roll < 0.78) {
    attackerStatuses.HotPotato = stacks * 3;
    recordHotPotatoBranch(combat, attackerSide, "x3", stacks, attackerStatuses.HotPotato, { roll });
    return 0;
  }
  if (roll < 0.8) {
    attackerStatuses.HotPotato = stacks * 4;
    recordHotPotatoBranch(combat, attackerSide, "x4", stacks, attackerStatuses.HotPotato, { roll });
    return 0;
  }
  if (roll < 0.95) {
    delete attackerStatuses.HotPotato;
    const multiplier = vulnerabilityMultiplier(attacker, "hotPotatoChance", "hotPotatoDamage");
    const damage = applyDamageToSide(combat, attackerSide, stacks * multiplier, rng, "status", {
      tags: ["HotPotato"],
    });
    recordHotPotatoBranch(combat, attackerSide, "explode", stacks, 0, { roll, damage });
    return 0;
  }

  delete attackerStatuses.HotPotato;
  recordHotPotatoBranch(combat, attackerSide, "pass", stacks, 0, { roll, passStacks: stacks });
  return stacks;
}

function recordHotPotatoBranch(combat, side, branch, stacksBefore, stacksAfter, detail = {}) {
  recordMechanic(combat, {
    type: "hot_potato_branch",
    side,
    branch,
    stacksBefore,
    stacksAfter,
    ...roundMechanicNumbers(detail),
  });
}

function applyStatuses(rng, attacker, defender, defenderStatuses, assumptions = DEFAULT_COMBAT_ASSUMPTIONS, options = {}) {
  const opacityMultiplier = assumptions.steam && options.isSurreal
    ? 1
    : 1 - clamp(stat(defender, "opacity"), 0, 100) / 100;
  const applyStatus = (status, rawChance = applicationChance(
    attacker, STATUS_TO_STAT[status], assumptions.exportedEnemyStatusChanceScale,
  )) => {
    const statName = STATUS_TO_STAT[status];
    if (rawChance <= 0 || defender.immunities.has(statName)) return;
    const vulnerability = vulnerabilityMultiplier(defender, statName, STATUS_APPLICATION_EFFECT);
    const effectiveChance = rawChance * vulnerability * opacityMultiplier;
    let stacks = rollStacks(rng, effectiveChance, `status.${status}.apply`);
    if (!options.isSurreal && stacks > 0 && defenderStatuses.Leap > 0) {
      stacks = blockStatusWithLeap({ combat: options.combat, rng, defenderSide: options.defenderSide, status, stacks });
    }
    if (stacks > 0) {
      addStatus(defenderStatuses, status, stacks);
      if (status === "Burn" && !assumptions.steam) {
        defenderStatuses.BurnDamage = (defenderStatuses.BurnDamage ?? 0) + stacks * stat(attacker, "burnDamage");
      }
    }
  };
  if (assumptions.steam) {
    if (opacityMultiplier <= 0) return;
    for (const status of STEAM_ON_HIT_STATUSES) applyStatus(status);
    applySteamOnHitStatusSkills({
      rng,
      attacker,
      defender,
      statuses: defenderStatuses,
      applyStatus,
      onMechanic: (mechanic) => recordMechanic(options.combat, { side: options.defenderSide, ...mechanic }),
    });
    applyStatus("HotPotato");
  } else {
    for (const status of Object.keys(STATUS_TO_STAT)) {
      if (status !== "Wound" && status !== "Paralysis") applyStatus(status);
    }
  }
}

function blockStatusWithLeap({ combat, rng, defenderSide, status, stacks }) {
  const statuses = combat[`${defenderSide}Statuses`];
  const leapBefore = statuses.Leap ?? 0;
  const blocked = Math.min(stacks, leapBefore);
  if (blocked <= 0) return stacks;
  statuses.Leap -= blocked;
  if (statuses.Leap <= 0) delete statuses.Leap;
  recordMechanic(combat, {
    type: "leap_block",
    side: defenderSide,
    status,
    attemptedStacks: stacks,
    blockedStacks: blocked,
    appliedStacks: stacks - blocked,
    leapBefore,
    leapAfter: statuses.Leap ?? 0,
  });
  if (combat.assumptions.steam) {
    const haste = rollSteamBuffConversion(rng, blocked, 0.1, "self.Leap.haste");
    if (haste > 0) applyCombatBuff({ combat, rng, status: "Haste", stacks: haste, intendedSide: defenderSide });
  }
  return stacks - blocked;
}

function applyExacerbate(rng, attacker, defender, defenderStatuses, assumptions = DEFAULT_COMBAT_ASSUMPTIONS, options = {}) {
  const exacerbate = applicationChance(attacker, "exacerbateChance", assumptions.exportedEnemyStatusChanceScale);
  const stacks = rollStacks(rng, exacerbate, "status.Exacerbate.apply");
  if (stacks <= 0 || defender.immunities.has("exacerbateChance")) return;
  const active = Object.keys(defenderStatuses).filter((status) => HARMFUL_STATUSES.has(status) && defenderStatuses[status] >= 1);
  if (active.length === 0) return;
  const picked = active[Math.floor(rng("status.Exacerbate.pick") * active.length)];
  const before = defenderStatuses[picked] ?? 0;
  addStatus(defenderStatuses, picked, stacks);
  recordMechanic(options.combat, {
    type: "exacerbate",
    attackerSide: options.attackerSide,
    defenderSide: options.defenderSide,
    chance: exacerbate,
    stacks,
    active,
    status: picked,
    before,
    after: defenderStatuses[picked] ?? 0,
  });
}

function applyResonance(rng, attacker, attackerStatuses, options = {}) {
  const stacks = rollStacks(rng, stat(attacker, "resonanceChance"), "self.Resonance.apply");
  if (stacks <= 0) return;
  const active = Object.keys(attackerStatuses).filter((status) => SELF_BUFF_TO_STAT[status] && attackerStatuses[status] >= 1);
  if (active.length === 0) return;
  const picked = active[Math.floor(rng("self.Resonance.pick") * active.length)];
  const before = attackerStatuses[picked] ?? 0;
  applyCombatBuff({ combat: options.combat, rng, status: picked, stacks, intendedSide: options.side, allowIntercept: false });
  recordMechanic(options.combat, {
    type: "resonance",
    side: options.side,
    stacks,
    active,
    status: picked,
    before,
    after: attackerStatuses[picked] ?? 0,
  });
}

function applyPurge(rng, attacker, defender, defenderStatuses, options = {}) {
  const stacks = rollStacks(rng, stat(attacker, "purgeChance"), "status.Purge.apply");
  if (stacks <= 0 || defender.immunities.has("purgeChance")) return;
  const removed = [];
  for (let index = 0; index < stacks; index += 1) {
    const active = Object.keys(defenderStatuses)
      .filter((status) => SELF_BUFF_TO_STAT[status] && defenderStatuses[status] >= 1)
      .map((status) => ({ status, stacks: defenderStatuses[status] }));
    const total = active.reduce((sum, item) => sum + item.stacks, 0);
    if (total <= 0) break;
    let roll = rng("status.Purge.pick") * total;
    let picked = active[0].status;
    for (const item of active) {
      roll -= item.stacks;
      if (roll < 0) {
        picked = item.status;
        break;
      }
    }
    const before = defenderStatuses[picked] ?? 0;
    defenderStatuses[picked] -= 1;
    if (defenderStatuses[picked] <= 0) delete defenderStatuses[picked];
    removed.push({
      status: picked,
      before,
      after: defenderStatuses[picked] ?? 0,
    });
  }
  if (removed.length > 0) {
    recordMechanic(options.combat, {
      type: "purge",
      attackerSide: options.attackerSide,
      defenderSide: options.defenderSide,
      stacks,
      removed,
    });
  }
}

function applySelfBuffs({ rng, combat, attackerSide, attacker }) {
  for (const [status, statName] of Object.entries(SELF_BUFF_TO_STAT)) {
    if (status === "Inspiration") continue;
    const rawChance = applicationChance(attacker, statName, combat.assumptions.exportedEnemyBuffChanceScale);
    if (rawChance <= 0) continue;
    const stacks = rollStacks(rng, rawChance, `self.${status}.apply`);
    if (stacks > 0) applyCombatBuff({ combat, rng, status, stacks, intendedSide: attackerSide });
  }
}

function applyCombatBuff({ combat, rng, status, stacks, intendedSide, allowIntercept = true, capBonus = 0 }) {
  if (combat.assumptions.steam) {
    const result = applySteamBuff({ combat, rng, status, stacks, intendedSide, allowIntercept });
    if (result?.intercepted) {
      recordMechanic(combat, { type: "intercept", intendedSide, status, stacks, ...result });
    }
    return result;
  }
  const statuses = combat[`${intendedSide}Statuses`];
  const before = statuses[status] ?? 0;
  const cap = intendedSide === "player" ? (STATUS_CAPS[status] ?? Infinity) + capBonus : Infinity;
  const after = Math.min(before + stacks, cap);
  statuses[status] = after;
  return { side: intendedSide, before, after };
}

function applyBalloonPop({ rng, combat, defender, defenderSide }) {
  const defenderStatuses = combat[`${defenderSide}Statuses`];
  const stacks = defenderStatuses.Balloon ?? 0;
  if (stacks <= 0) return 0;

  const roll = rng("status.Balloon.pop");
  if (roll >= 0.25) {
    recordMechanic(combat, {
      type: "balloon_pop",
      side: defenderSide,
      stacks,
      roll: roundTraceNumber(roll),
      threshold: 0.25,
      popped: false,
      damage: 0,
    });
    return 0;
  }

  delete defenderStatuses.Balloon;
  const damage = stacks * vulnerabilityMultiplier(defender, "balloonChance", "balloonPop");
  const appliedDamage = applyDamageToSide(combat, defenderSide, damage, rng, "status", {
    tags: ["Balloon", "pop"],
  });
  recordMechanic(combat, {
    type: "balloon_pop",
    side: defenderSide,
    stacks,
    roll: roundTraceNumber(roll),
    threshold: 0.25,
    popped: true,
    damage: roundTraceNumber(appliedDamage),
  });
  return appliedDamage;
}

function growBrittleAfterHit({ combat, defenderSide, defenderHpBeforeHit }) {
  const defenderStatuses = combat[`${defenderSide}Statuses`];
  const brittle = defenderStatuses.Brittle ?? 0;
  if (brittle <= 0) return;
  const damageTaken = Math.max(0, defenderHpBeforeHit - combat[`${defenderSide}Hp`]);
  if (damageTaken <= 0) return;
  const growth = Math.min(brittle, Math.floor(damageTaken * 0.01));
  if (growth > 0) {
    addStatus(defenderStatuses, "Brittle", growth);
    recordMechanic(combat, {
      type: "brittle_growth",
      side: defenderSide,
      damageTaken,
      before: brittle,
      growth,
      after: defenderStatuses.Brittle ?? 0,
    });
  }
}

function applicationChance(combatant, statName, exportedScale) {
  const raw = stat(combatant, statName);
  if (!isExportedSketchEnemy(combatant) || raw <= EXPORTED_SKETCH_CHANCE_SCALE) return raw;
  return raw * exportedScale;
}

function isExportedSketchEnemy(combatant) {
  return combatant?.id != null && combatant.id !== "player";
}

function applyDamageToSide(combat, side, damage, rng, source = "direct", detail = {}) {
  if (!Number.isFinite(damage)) {
    throw new RangeError(`Cannot simulate ${source} damage to ${side}: damage exceeds the numeric range.`);
  }
  if (damage <= 0) return 0;

  const hpKey = `${side}Hp`;
  const statuses = combat[`${side}Statuses`];
  const combatant = combat[side];
  const before = combat[hpKey];
  combat[hpKey] -= damage;

  if (combat[hpKey] <= 0) {
    const triggersBefore = statuses.VarnishTriggers ?? 0;
    const chance = stat(combatant, "varnish") - triggersBefore;
    const success = rollPercent(rng, chance, "defense.varnish");
    if (success) {
      statuses.VarnishTriggers = triggersBefore + 1;
      const restorePercent = Math.max(0, 50 - triggersBefore) * (combat.assumptions.steam && combatant.stats.isPreciseErased ? 0.5 : 1);
      const afterDamageHp = combat[hpKey];
      combat[hpKey] = combatantMaxHp(combatant) * (restorePercent / 100);
      recordMechanic(combat, {
        type: "varnish",
        side,
        source,
        incomingDamage: damage,
        beforeHp: before,
        afterDamageHp,
        chance,
        success,
        triggersBefore,
        triggersAfter: statuses.VarnishTriggers,
        restorePercent,
        afterHp: combat[hpKey],
      });
    }
  }

  const applied = Math.max(0, before - Math.max(0, combat[hpKey]));
  addBreakdown(combat.damageBreakdown[side], source, applied);
  if (side === "enemy" && source === "status" && applied > 0) {
    const status = detail.tags?.find((tag) => HARMFUL_STATUSES.has(tag)) ?? "other";
    const breakdown = combat.enemyStatusDamage;
    breakdown[status] = (breakdown[status] ?? 0) + applied;
  }
  recordDamageEvent(combat, {
    side,
    source,
    beforeHp: before,
    afterHp: combat[hpKey],
    rawAfterHp: before - damage,
    requestedDamage: damage,
    appliedDamage: applied,
    overkillDamage: Math.max(0, damage - before),
    ...detail,
  });
  return applied;
}

function recordDamageEvent(combat, event) {
  if (!combat?.trace) return;
  const tags = normalizeDamageTags(event.source, event.tags, event.overkillDamage);
  combat.damageEvents.push(roundMechanicNumbers({
    ...event,
    tags,
  }));
}

function normalizeDamageTags(source, tags = [], overkillDamage = 0) {
  const defaults = {
    direct: ["direct"],
    status: ["status"],
    reflect: ["reflected"],
    parry: ["reflected", "parry"],
    self: ["self"],
    energyWave: ["energyWave"],
  };
  const result = [];
  for (const tag of [...(defaults[source] ?? [source]), ...tags]) {
    if (tag && !result.includes(tag)) result.push(tag);
  }
  if (overkillDamage > 0 && !result.includes("overkill")) result.push("overkill");
  return result;
}

function directDamageTags(offenseTrace = {}, mitigationTrace = {}, directModifierTrace = {}, electrocuteTrace = null) {
  const tags = ["direct"];
  if (offenseTrace.execute?.triggered) tags.push("execute");
  if (offenseTrace.berserk?.triggered) tags.push("berserk");
  if (offenseTrace.crit?.success && offenseTrace.crit.applied !== false) tags.push("crit");
  if (offenseTrace.goldenLuck?.success) tags.push("goldenLuck");
  if (directModifierTrace?.frailty) tags.push("frailty");
  if (directModifierTrace?.brittle) tags.push("brittle");
  if (electrocuteTrace) tags.push("electrocute");
  return tags;
}

function healSide(combat, side, healing, source = "other") {
  const hpKey = `${side}Hp`;
  const before = combat[hpKey];
  if (!Number.isFinite(healing) || healing <= 0) {
    return {
      appliedHealing: 0,
      beforeHp: before,
      afterHp: before,
    };
  }
  combat[hpKey] = Math.min(combatantMaxHp(combat[side]), combat[hpKey] + healing);
  const applied = Math.max(0, combat[hpKey] - before);
  addBreakdown(combat.healingBreakdown[side], source, applied);
  return {
    appliedHealing: applied,
    beforeHp: before,
    afterHp: combat[hpKey],
  };
}

function classifyVictoryCause(combat) {
  const dominant = dominantDamageSource(combat.damageBreakdown.enemy);
  if (dominant === "status") {
    const status = dominantDamageSource(combat.enemyStatusDamage);
    return { Bleed: "bleed", Burn: "burn", Freeze: "freeze_chain" }[status] ?? "status_damage";
  }
  if (dominant === "reflect" || dominant === "parry") return "thorns_counter";
  if (dominant === "energyWave") return "energy_wave";
  if (combat.executeContributedDamage) return "execute";
  if (combat.enemyHealingPreventedByFreeze > 0) return "freeze_chain";
  return "raw_damage";
}

function classifyDefeatCause({ result, player, enemy }) {
  if (result.reason === "seppuku") return "seppuku";
  if (result.winner === "timeout") {
    if (result.timeoutDiagnosis === "regen_wall") return "regen_wall";
    if (result.timeoutDiagnosis === "armor_wall") return "armor_wall";
    if (result.timeoutDiagnosis === "absorb_wall") return "absorb_wall";
    if (result.timeoutDiagnosis === "opacity_remedy_wall") return "status_wall";
    if (result.timeoutDiagnosis === "leap_status_wall") return "dodge_accuracy_wall";
    if (statRaw(enemy, "dodge") > 0 && statRaw(player, "accuracy") < statRaw(enemy, "dodge")) return "dodge_accuracy_wall";
    return "stall";
  }

  const dominant = dominantDamageSource(result.damageBreakdown?.player);
  if (dominant === "status") return "status_damage";
  if (dominant === "reflect" || dominant === "parry") return "reflect_damage";
  if (dominant === "self") return "self_damage";
  return "raw_attack";
}

function diagnoseTimeout(combat) {
  if (isRegenWall(combat)) return "regen_wall";
  if (isArmorWall(combat)) return "armor_wall";
  if (isAbsorbWall(combat)) return "absorb_wall";
  if (isOpacityRemedyWall(combat)) return "opacity_remedy_wall";
  if (isStatusLeapWall(combat)) return "leap_status_wall";
  return "max_seconds";
}

function isRegenWall(combat) {
  const enemyHealing = combat.healingBreakdown.enemy.regen;
  const enemyDamage = combat.damageBreakdown.enemy.total;
  return enemyHealing > 0 && enemyDamage > 0 && enemyHealing >= enemyDamage * 0.7 && combat.enemyHp > combatantMaxHp(combat.enemy) * 0.5;
}

function isArmorWall(combat) {
  const playerAttack = stat(combat.player, "attack");
  if (playerAttack <= 0) return false;
  const armorGap = stat(combat.enemy, "armor") - stat(combat.player, "armorPen");
  return armorGap >= playerAttack && combat.damageBreakdown.enemy.total <= playerAttack;
}

function isAbsorbWall(combat) {
  return stat(combat.enemy, "absorb") >= 90 && combat.damageBreakdown.enemy.total > 0 && combat.enemyHp > combatantMaxHp(combat.enemy) * 0.5;
}

function isOpacityRemedyWall(combat) {
  return hasHarmfulStatusPressure(combat.player)
    && (stat(combat.enemy, "opacity") >= 80 || stat(combat.enemy, "remedy") >= 100)
    && combat.damageBreakdown.enemy.status <= combat.damageBreakdown.enemy.direct;
}

function isStatusLeapWall(combat) {
  return hasHarmfulStatusPressure(combat.player)
    && effectiveLeap(combat.enemy, combat.enemyStatuses) >= 80
    && combat.damageBreakdown.enemy.status <= combat.damageBreakdown.enemy.direct;
}

function createTraceRecorder(trace) {
  if (!trace) return null;
  return {
    events: [],
    rngCalls: [],
    includeRng: Boolean(trace.includeRng ?? trace.rng),
    maxSeconds: Math.max(0, Number(trace.seconds ?? trace.maxSeconds ?? 60) || 60),
    maxEvents: Math.max(1, Math.floor(Number(trace.maxEvents ?? 240) || 240)),
    maxRngEvents: Math.max(1, Math.floor(Number(trace.maxRngEvents ?? 1000) || 1000)),
  };
}

function createTraceRng(rng, trace) {
  if (!trace?.includeRng) return rng;
  function tracedRng(label = "rng") {
    const value = rng(label);
    if (trace.rngCalls.length < trace.maxRngEvents) {
      trace.rngCalls.push({
        index: trace.rngCalls.length + 1,
        label: String(label),
        value: Math.round(value * 1e9) / 1e9,
      });
    }
    return value;
  }
  tracedRng.annotateLast = function annotateLast(label, metadata = {}) {
    const last = trace.rngCalls[trace.rngCalls.length - 1];
    if (!last || last.label !== String(label)) return;
    Object.assign(last, metadata);
  };
  return tracedRng;
}

function traceSnapshot(combat) {
  return {
    time: combat.time,
    rngIndex: combat.trace?.rngCalls.length ?? 0,
    mechanicIndex: combat.mechanicEvents.length,
    damageEventIndex: combat.damageEvents.length,
    playerHp: combat.playerHp,
    enemyHp: combat.enemyHp,
    playerStatuses: { ...combat.playerStatuses },
    enemyStatuses: { ...combat.enemyStatuses },
    damageBreakdown: cloneBreakdowns(combat.damageBreakdown),
    healingBreakdown: {
      player: { ...combat.healingBreakdown.player },
      enemy: { ...combat.healingBreakdown.enemy },
    },
  };
}

function recordTraceDelta(combat, event, before, detail = {}) {
  if (!combat.trace) return;
  const damage = diffSideBreakdowns(before.damageBreakdown, combat.damageBreakdown);
  const healing = diffSideBreakdowns(before.healingBreakdown, combat.healingBreakdown);
  const hpDelta = {
    player: Math.max(0, combat.playerHp) - Math.max(0, before.playerHp),
    enemy: Math.max(0, combat.enemyHp) - Math.max(0, before.enemyHp),
  };
  const statusDelta = {
    player: diffStatuses(before.playerStatuses, combat.playerStatuses),
    enemy: diffStatuses(before.enemyStatuses, combat.enemyStatuses),
  };
  const rngEvents = combat.trace?.includeRng
    ? combat.trace.rngCalls.slice(before.rngIndex)
    : [];
  const mechanics = combat.mechanicEvents.slice(before.mechanicIndex);
  const damageEvents = combat.damageEvents.slice(before.damageEventIndex);
  const statusesChanged =
    JSON.stringify(before.playerStatuses) !== JSON.stringify(combat.playerStatuses)
    || JSON.stringify(before.enemyStatuses) !== JSON.stringify(combat.enemyStatuses);
  if (
    event === "tick"
    && damage.player.total <= 0
    && damage.enemy.total <= 0
    && healing.player.total <= 0
    && healing.enemy.total <= 0
    && !statusesChanged
  ) {
    return;
  }
  recordTrace(combat, event, { ...detail, damage, healing, hpDelta, statusDelta, rng: rngEvents, mechanics, damageEvents });
}

function recordTrace(combat, event, detail = {}) {
  if (!combat.trace || combat.time > combat.trace.maxSeconds || combat.trace.events.length >= combat.trace.maxEvents) return;
  combat.trace.events.push({
    index: combat.trace.events.length + 1,
    time: Math.round(combat.time * 1000) / 1000,
    event,
    playerHp: Math.max(0, combat.playerHp),
    enemyHp: Math.max(0, combat.enemyHp),
    statuses: {
      player: compactStatuses(combat.playerStatuses),
      enemy: compactStatuses(combat.enemyStatuses),
    },
    damage: detail.damage ?? emptySideBreakdowns(),
    healing: detail.healing ?? emptySideBreakdowns(),
    hpDelta: detail.hpDelta ?? { player: 0, enemy: 0 },
    statusDelta: detail.statusDelta ?? { player: {}, enemy: {} },
    rng: detail.rng ?? [],
    mechanics: detail.mechanics ?? [],
    damageEvents: detail.damageEvents ?? [],
    action: detail.action ?? null,
    attackerSide: detail.attackerSide ?? null,
    defenderSide: detail.defenderSide ?? null,
    winner: detail.winner ?? null,
    reason: detail.reason ?? null,
    deathCause: detail.deathCause ?? null,
  });
}

function recordMechanic(combat, mechanic) {
  if (!combat?.trace || !mechanic) return;
  combat.mechanicEvents.push(roundMechanicNumbers(mechanic));
}

function roundMechanicNumbers(value) {
  if (Array.isArray(value)) return value.map(roundMechanicNumbers);
  if (!value || typeof value !== "object") {
    return typeof value === "number" ? roundTraceNumber(value) : value;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = roundMechanicNumbers(item);
  return result;
}

function roundTraceNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) >= 1e12) return number;
  return Math.round(number * 1e9) / 1e9;
}

function diffSideBreakdowns(before, after) {
  return {
    player: diffBreakdown(before.player, after.player),
    enemy: diffBreakdown(before.enemy, after.enemy),
  };
}

function diffStatuses(before = {}, after = {}) {
  const result = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const beforeValue = Number(before[key] ?? 0);
    const afterValue = Number(after[key] ?? 0);
    if (beforeValue === afterValue) continue;
    result[key] = {
      before: beforeValue,
      after: afterValue,
      delta: afterValue - beforeValue,
    };
  }
  return result;
}

function diffBreakdown(before = {}, after = {}) {
  const result = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after), "total"]);
  for (const key of keys) {
    result[key] = Math.max(0, (after[key] ?? 0) - (before[key] ?? 0));
  }
  return result;
}

function emptySideBreakdowns() {
  return {
    player: createDamageBreakdown(),
    enemy: createDamageBreakdown(),
  };
}

function compactStatuses(statuses = {}) {
  return Object.fromEntries(Object.entries(statuses).filter(([, value]) => Number(value) > 0));
}

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
