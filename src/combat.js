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
import {
  HARMFUL_STATUSES,
  SELF_BUFF_TO_STAT,
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

export const DEFAULT_COMBAT_ASSUMPTIONS = {
  exportedEnemyStatusChanceScale: 1 / EXPORTED_SKETCH_CHANCE_SCALE,
  exportedEnemyBuffChanceScale: 1 / EXPORTED_SKETCH_CHANCE_SCALE,
  dotScale: 1,
  combatSpeedMultiplier: 1,
  flowStateActive: false,
  flowStateLevel: 0,
  flowStateKnownTargetIds: [],
};

export function runMonteCarlo({
  player,
  enemy,
  trials = 1000,
  seed = "default",
  maxSeconds = 300,
  assumptions = {},
}) {
  const summary = {
    trials,
    wins: 0,
    losses: 0,
    timeouts: 0,
    winRate: 0,
    avgSeconds: 0,
    medianSeconds: 0,
    p10Seconds: 0,
    p90Seconds: 0,
    timeoutRate: 0,
    winRateCi95: { lower: 0, upper: 0, halfWidth: 0 },
    reasons: {},
    deathCauses: {},
    timeoutDiagnoses: {},
    victoryCauses: {},
    defeatCauses: {},
  };
  const durations = [];
  let totalSeconds = 0;

  for (let i = 0; i < trials; i += 1) {
    const result = simulateFight({
      rng: createRng(`${seed}:${i}`),
      player,
      enemy,
      maxSeconds,
      assumptions,
    });
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
      const cause = classifyVictoryCause({ result, player, enemy });
      summary.victoryCauses[cause] = (summary.victoryCauses[cause] ?? 0) + 1;
    } else {
      const cause = classifyDefeatCause({ result, player, enemy });
      summary.defeatCauses[cause] = (summary.defeatCauses[cause] ?? 0) + 1;
    }
    totalSeconds += result.seconds;
    durations.push(result.seconds);
  }

  durations.sort((a, b) => a - b);
  const safeTrials = Math.max(1, trials);
  summary.winRate = summary.wins / safeTrials;
  summary.timeoutRate = summary.timeouts / safeTrials;
  summary.winRateCi95 = confidenceInterval95(summary.winRate, safeTrials);
  summary.avgSeconds = totalSeconds / safeTrials;
  summary.medianSeconds = durations[Math.floor(durations.length / 2)] ?? 0;
  summary.p10Seconds = percentile(durations, 0.1);
  summary.p90Seconds = percentile(durations, 0.9);
  return summary;
}

export function simulateFight({ rng = Math.random, player, enemy, maxSeconds = 300, assumptions = {}, trace = null }) {
  const traceRecorder = createTraceRecorder(trace);
  const fightRng = createTraceRng(rng, traceRecorder);
  const normalizedAssumptions = normalizeCombatAssumptions(assumptions);
  const normalizedPlayer = normalizeCombatant(player);
  const normalizedEnemy = normalizeCombatant(enemy);
  const playerFirstAttackDelayMultiplier = flowStateFirstAttackDelayMultiplier(normalizedEnemy, normalizedAssumptions);
  const combat = {
    player: normalizedPlayer,
    enemy: normalizedEnemy,
    assumptions: normalizedAssumptions,
    trace: traceRecorder,
    playerHp: stat(player, "maxHp", 1),
    enemyHp: stat(enemy, "maxHp", 1),
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
    mechanicEvents: [],
    damageEvents: [],
    pendingEffects: [],
    nextPlayerAttack: attackDelay(
      normalizedPlayer,
      {},
      normalizedAssumptions.combatSpeedMultiplier,
      playerFirstAttackDelayMultiplier,
    ),
    nextEnemyAttack: attackDelay(normalizedEnemy, {}, normalizedAssumptions.combatSpeedMultiplier),
    nextRegenTick: combatTickDelay(REGEN_TICK_SECONDS, normalizedAssumptions),
    nextStatusTick: combatTickDelay(STATUS_TICK_SECONDS, normalizedAssumptions),
    time: 0,
    reason: "timeout",
  };
  recordTrace(combat, "start");

  while (combat.time < maxSeconds) {
    const nextPendingEffect = nextPendingEffectTime(combat);
    const nextTime = Math.min(
      combat.nextPlayerAttack,
      combat.nextEnemyAttack,
      nextPendingEffect,
      combat.nextRegenTick,
      combat.nextStatusTick,
      maxSeconds,
    );
    combat.time = nextTime;

    if (combat.enemyHp <= 0) {
      return finish("player", "enemy_hp_zero", combat);
    }
    if (combat.playerHp <= 0) {
      return finish("enemy", "player_hp_zero", combat);
    }
    if (combat.time >= maxSeconds) break;

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
      const action = performAttack({ rng: fightRng, combat, attackerSide: "player", defenderSide: "enemy" });
      recordTraceDelta(combat, "attack", beforeAttack, { attackerSide: "player", defenderSide: "enemy", action });
      combat.nextPlayerAttack += attackDelay(combat.player, combat.playerStatuses, combat.assumptions.combatSpeedMultiplier);
    } else if (isDue(combat.nextEnemyAttack, combat.time)) {
      const beforeAttack = traceSnapshot(combat);
      const action = performAttack({ rng: fightRng, combat, attackerSide: "enemy", defenderSide: "player" });
      recordTraceDelta(combat, "attack", beforeAttack, { attackerSide: "enemy", defenderSide: "player", action });
      combat.nextEnemyAttack += attackDelay(combat.enemy, combat.enemyStatuses, combat.assumptions.combatSpeedMultiplier);
    } else if (isDue(combat.nextRegenTick, combat.time)) {
      const beforeTick = traceSnapshot(combat);
      applyRegenerationTick(combat, fightRng);
      recordTraceDelta(combat, "tick", beforeTick, { tickType: "regen", deltaSeconds: 1 });
      combat.nextRegenTick += combatTickDelay(REGEN_TICK_SECONDS, combat.assumptions);
    } else if (isDue(combat.nextStatusTick, combat.time)) {
      const beforeTick = traceSnapshot(combat);
      applyStatusTick(combat, fightRng);
      recordTraceDelta(combat, "tick", beforeTick, { tickType: "status", deltaSeconds: 1 });
      combat.nextStatusTick += combatTickDelay(STATUS_TICK_SECONDS, combat.assumptions);
    } else {
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
  return {
    exportedEnemyStatusChanceScale: toFiniteNumber(
      input.exportedEnemyStatusChanceScale,
      DEFAULT_COMBAT_ASSUMPTIONS.exportedEnemyStatusChanceScale,
    ),
    exportedEnemyBuffChanceScale: toFiniteNumber(
      input.exportedEnemyBuffChanceScale,
      DEFAULT_COMBAT_ASSUMPTIONS.exportedEnemyBuffChanceScale,
    ),
    dotScale: toFiniteNumber(input.dotScale, DEFAULT_COMBAT_ASSUMPTIONS.dotScale),
    combatSpeedMultiplier: positiveFiniteNumber(
      input.combatSpeedMultiplier,
      DEFAULT_COMBAT_ASSUMPTIONS.combatSpeedMultiplier,
    ),
    flowStateActive: input.flowStateActive === true,
    flowStateLevel: Math.max(0, toFiniteNumber(input.flowStateLevel, DEFAULT_COMBAT_ASSUMPTIONS.flowStateLevel)),
    flowStateKnownTargetIds: normalizeStringSet(input.flowStateKnownTargetIds),
  };
}

function combatTickDelay(seconds, assumptions) {
  return seconds / positiveFiniteNumber(assumptions?.combatSpeedMultiplier, 1);
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
  applyPeriodicStatusTick(combat, "player", 1, rng);
  applyPeriodicStatusTick(combat, "enemy", 1, rng);
  applyInspirationTick(combat, "player", rng);
  applyInspirationTick(combat, "enemy", rng);
}

function applyRegenerationWithFreeze(combat, side, healing, deltaSeconds, rng) {
  const statuses = combat[`${side}Statuses`];
  const freeze = statuses.Freeze ?? 0;

  if (healing > 0) {
    if (freeze > 100) {
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

function applyPeriodicStatusTick(combat, side, deltaSeconds, rng) {
  const target = combat[side];
  const sourceSide = side === "player" ? "enemy" : "player";
  const source = combat[sourceSide];
  const statuses = combat[`${side}Statuses`];
  const sourceStatuses = combat[`${sourceSide}Statuses`];
  const scale = combat.assumptions.dotScale;
  const alive = () => combat[`${side}Hp`] > 0;

  if ((statuses.Burn ?? 0) > 0 && alive()) {
    applyDamageToSide(
      combat,
      side,
      periodicBurnDamage({ source, target, statuses, deltaSeconds }) * scale,
      rng,
      "status",
      { tags: ["periodic", "Burn"] },
    );
  }

  if ((statuses.Plague ?? 0) > 0 && alive()) {
    const stacks = statuses.Plague;
    applyDamageToSide(combat, side, stacks * deltaSeconds * scale, rng, "status", {
      tags: ["periodic", "Plague"],
    });
    growStatusOverTime(rng, target, statuses, "Plague", stacks * 10 * deltaSeconds, { combat, side, deltaSeconds });
  }

  if ((statuses.Poison ?? 0) > 0 && alive()) {
    const stacks = statuses.Poison;
    const damage = combatantMaxHp(target) * 0.001 * stacks * deltaSeconds
      * vulnerabilityMultiplier(target, "poisonChance", "poisonDamage");
    applyDamageToSide(combat, side, damage * scale, rng, "status", {
      tags: ["periodic", "Poison"],
    });
  }

  if ((statuses.BlackFlame ?? 0) > 0 && alive()) {
    const stacks = statuses.BlackFlame;
    const damage = combat[`${side}Hp`] * 0.01 * stacks * deltaSeconds
      * vulnerabilityMultiplier(target, "blackFlameChance", "blackFlameDamage");
    applyDamageToSide(combat, side, damage * scale, rng, "status", {
      tags: ["periodic", "BlackFlame"],
    });
  }

  applyEnergyWaveTick({ combat, side: sourceSide, defenderSide: side, deltaSeconds, rng, source, target, statuses: sourceStatuses });

  if ((statuses.Balloon ?? 0) > 0) {
    const before = statuses.Balloon;
    const growth = Math.ceil(statuses.Balloon * 0.25 * isolationMultiplier(target) * deltaSeconds);
    if (growth > 0) {
      addStatus(statuses, "Balloon", growth);
      recordMechanic(combat, {
        type: "status_growth",
        side,
        status: "Balloon",
        deltaSeconds,
        before,
        growth,
        after: statuses.Balloon ?? 0,
        chance: null,
      });
    }
  }

  if ((statuses.Irradiate ?? 0) > 0 && alive()) {
    const stacks = statuses.Irradiate;
    const damage = irradiateDamage(target, stacks) * deltaSeconds;
    applyDamageToSide(combat, side, damage * scale, rng, "status", {
      tags: ["periodic", "Irradiate"],
    });
    growStatusOverTime(rng, target, statuses, "Irradiate", stacks * 15 * deltaSeconds, { combat, side, deltaSeconds });
  }
}

function periodicBurnDamage({ source, target, statuses, deltaSeconds }) {
  const stacks = statuses.Burn ?? 0;
  if (stacks <= 0) return 0;
  const storedDamage = statuses.BurnDamage ?? null;
  const perSecond = storedDamage ?? stacks * stat(source, "burnDamage", 1);
  return perSecond * deltaSeconds * vulnerabilityMultiplier(target, "burnChance", "burnDamage");
}

function irradiateDamage(target, stacks) {
  if (target.vulnerability?.[0] === "irradiateChance") {
    return stacks * vulnerabilityMultiplier(target, "irradiateChance", "irradiateDamage");
  }
  return Math.sqrt(stacks);
}

function growStatusOverTime(rng, target, statuses, status, chance, options = {}) {
  const effectiveChance = chance * isolationMultiplier(target);
  const before = statuses[status] ?? 0;
  const stacks = rollStacks(rng, effectiveChance, `tick.${status}.growth`);
  if (stacks > 0) {
    addStatus(statuses, status, stacks);
    recordMechanic(options.combat, {
      type: "status_growth",
      side: options.side,
      status,
      deltaSeconds: options.deltaSeconds,
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

function applyEnergyWaveTick({ combat, side, defenderSide, deltaSeconds, rng, source, target, statuses }) {
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
    deltaSeconds,
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
  const statuses = combat[`${side}Statuses`];
  if (combat[`${side}Hp`] <= 0) return;

  const rawChance = applicationChance(
    combatant,
    "inspirationChance",
    combat.assumptions.exportedEnemyBuffChanceScale,
  );
  if (rawChance <= 0) return;

  const stacks = rollStacks(rng, rawChance, `tick.${side}.Inspiration.apply`);
  if (stacks <= 0) return;

  const before = statuses.Inspiration ?? 0;
  addStatus(statuses, "Inspiration", stacks);
  recordMechanic(combat, {
    type: "self_buff_tick",
    side,
    status: "Inspiration",
    chance: rawChance,
    stacks,
    before,
    after: statuses.Inspiration ?? 0,
  });
}

function performAttack({ rng, combat, attackerSide, defenderSide }) {
  const attacker = combat[attackerSide];
  const attackerStatuses = combat[`${attackerSide}Statuses`];
  let targetSide = defenderSide;
  let target = combat[targetSide];
  let targetStatuses = combat[`${targetSide}Statuses`];

  const remedyTrace = applyRemedy(rng, attacker, attackerStatuses);
  if (remedyTrace) recordMechanic(combat, { ...remedyTrace, side: attackerSide });
  const skip = shouldSkipTurn(rng, attacker, attackerStatuses);
  if (skip.skipped) return { type: "skip_turn", damage: 0 };

  const hypnotize = resolveHypnotize(rng, attackerStatuses);
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
  let hotPotatoPassStacks = applyHotPotatoBeforeAttack({ rng, combat, attackerSide, defenderSide: targetSide });
  if (combat[`${attackerSide}Hp`] <= 0) {
    return { type: "self_status", damage: 0, hitCount };
  }

  const isSurreal =
    rollPercent(rng, stat(attacker, "surrealism"), `${attackerSide}.surrealism`) && !target.immunities.has("surrealism");

  let totalDamage = 0;
  let originalDefenderDamage = 0;
  let landedHits = 0;
  let dodgedHits = 0;
  let parriedHits = 0;
  for (let hit = 0; hit < hitCount; hit += 1) {
    const targetHpKey = `${targetSide}Hp`;
    const targetHp = combat[targetHpKey];
    if (targetHp <= 0 || combat[`${attackerSide}Hp`] <= 0) break;
    const targetHpBeforeHit = targetHp;

    const offenseTrace = {
      type: "offense",
      attackerSide,
      defenderSide: targetSide,
      isSelfAttack: targetSide === attackerSide,
    };
    let damage = baseAttackDamage(rng, attacker, attackerStatuses, offenseTrace);
    damage = applyOffensiveMultipliers(
      rng,
      damage,
      attacker,
      target,
      targetHp,
      combatantMaxHp(target),
      offenseTrace,
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

    const mitigationCapture = {};
    damage = applyDefensiveMitigation(rng, damage, attacker, target, targetStatuses, isSurreal, {
      combat,
      attackerSide,
      defenderSide: targetSide,
      capture: mitigationCapture,
    });

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

    const appliedDamage = applyDamageToSide(combat, targetSide, damage + electrocuteDamage, rng, "direct", {
      attackerSide,
      defenderSide: targetSide,
      tags: directDamageTags(offenseTrace, mitigationCapture.trace, directModifierCapture.trace, electrocuteTrace),
    });
    totalDamage += appliedDamage;
    if (targetSide === defenderSide) originalDefenderDamage += appliedDamage;

    applyReactiveDamage({
      rng,
      combat,
      attackerSide,
      defenderSide: targetSide,
      isSurreal,
    });

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
    applySelfBuffs(rng, attacker, attackerStatuses, combat.assumptions);
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

  const bleedStacks = attackerStatuses.Bleed ?? 0;
  if (bleedStacks > 0 && originalDefenderDamage > 0) {
    const multiplier = vulnerabilityMultiplier(attacker, "bleedChance", "bleedRecoil");
    applyDamageToSide(combat, attackerSide, originalDefenderDamage * bleedStacks * 0.01 * multiplier, rng, "status", {
      tags: ["recoil", "Bleed"],
    });
  }

  const curseStacks = attackerStatuses.Curse ?? 0;
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
  if (lifesteal > 0 && originalDefenderDamage > 0 && combat[`${attackerSide}Hp`] > 0) {
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

  return {
    type: landedHits > 0 ? totalDamage > 0 ? "hit" : "blocked_or_absorbed" : "missed",
    hitCount,
    landedHits,
    dodgedHits,
    parriedHits,
    totalDamage,
    targetSide,
    isHypnotized: hypnotize.redirected,
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

function applyOffensiveMultipliers(rng, damage, attacker, defender, defenderHp, defenderMaxHp, trace) {
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
      if (blockSuccess) result = Math.max(0, result - blockAmount);
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

function resolveEvasion({ rng, combat, attackerSide, defenderSide, damage, isSurreal }) {
  if (isSurreal) return { type: "hit" };

  const attacker = combat[attackerSide];
  const defender = combat[defenderSide];

  const dodgeChance = stat(defender, "dodge");
  const dodgeSuccess = rollPercent(rng, dodgeChance, "evasion.dodge");
  if (dodgeSuccess) {
    const accuracyChance = stat(attacker, "accuracy");
    const accuracySuccess = rollPercent(rng, accuracyChance, "evasion.dodgeAccuracy");
    if (!accuracySuccess) {
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
        outcome: "dodge",
      });
      return { type: "dodge" };
    }
  }

  const parryChance = stat(defender, "parry");
  const parrySuccess = rollPercent(rng, parryChance, "evasion.parry");
  if (parrySuccess) {
    const accuracyChance = stat(attacker, "accuracy");
    const accuracySuccess = rollPercent(rng, accuracyChance, "evasion.parryAccuracy");
    if (accuracySuccess) return { type: "hit" };
    const multiplier = vulnerabilityMultiplier(attacker, "parryDmg", "parryDamage");
    const parryDamage = damage * (stat(defender, "parryDmg") / 100) * multiplier;
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
      outcome: "parry",
    });
    return { type: "parry", damage: parryDamage };
  }

  return { type: "hit" };
}

function applyReactiveDamage({ rng, combat, attackerSide, defenderSide, isSurreal }) {
  if (isSurreal) return;

  const attacker = combat[attackerSide];
  const defender = combat[defenderSide];
  const defenderStatuses = combat[`${defenderSide}Statuses`];

  const counterChance = stat(defender, "counter");
  const counterSuccess = rollPercent(rng, counterChance, "reactive.counter");
  if (counterSuccess && !attacker.immunities.has("counter")) {
    const scheduledTime = combat.time + COUNTER_DELAY_SECONDS;
    combat.pendingEffects.push({
      type: "counter",
      time: scheduledTime,
      counterSide: defenderSide,
      targetSide: attackerSide,
      amount: stat(defender, "attack"),
      chance: counterChance,
    });
    recordMechanic(combat, {
      type: "counter_scheduled",
      defenderSide,
      attackerSide,
      chance: counterChance,
      success: counterSuccess,
      delaySeconds: COUNTER_DELAY_SECONDS,
      scheduledTime: roundTraceNumber(scheduledTime),
      damage: roundTraceNumber(stat(defender, "attack")),
      dealtDamage: 0,
    });
  }

  const thornsStacks = defenderStatuses.Thorns ?? 0;
  if (thornsStacks > 0 && !attacker.immunities.has("thornsChance")) {
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

  const mitigationCapture = {};
  damage = applyDefensiveMitigation(rng, damage, attacker, defender, defenderStatuses, false, {
    combat,
    attackerSide,
    defenderSide,
    capture: mitigationCapture,
  });

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

function applyHotPotatoBeforeAttack({ rng, combat, attackerSide }) {
  const attacker = combat[attackerSide];
  const attackerStatuses = combat[`${attackerSide}Statuses`];
  const stacks = attackerStatuses.HotPotato ?? 0;
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
  for (const [status, statName] of Object.entries(STATUS_TO_STAT)) {
    if (defender.immunities.has(statName)) continue;

    const rawChance = applicationChance(attacker, statName, assumptions.exportedEnemyStatusChanceScale);
    if (rawChance <= 0) continue;

    const vulnerability = vulnerabilityMultiplier(defender, statName, STATUS_APPLICATION_EFFECT);
    const opacityMultiplier = 1 - clamp(stat(defender, "opacity"), 0, 100) / 100;
    const effectiveChance = rawChance * vulnerability * opacityMultiplier;
    let stacks = rollStacks(rng, effectiveChance, `status.${status}.apply`);
    if (!options.isSurreal && stacks > 0 && (defenderStatuses.Leap ?? 0) > 0) {
      const attemptedStacks = stacks;
      const leapBefore = defenderStatuses.Leap;
      const blocked = Math.min(stacks, defenderStatuses.Leap);
      stacks -= blocked;
      defenderStatuses.Leap -= blocked;
      if (defenderStatuses.Leap <= 0) delete defenderStatuses.Leap;
      recordMechanic(options.combat, {
        type: "leap_block",
        side: options.defenderSide,
        status,
        attemptedStacks,
        blockedStacks: blocked,
        appliedStacks: stacks,
        leapBefore,
        leapAfter: defenderStatuses.Leap ?? 0,
      });
    }
    if (stacks > 0) {
      addStatus(defenderStatuses, status, stacks);
      if (status === "Burn") {
        defenderStatuses.BurnDamage = (defenderStatuses.BurnDamage ?? 0) + stacks * stat(attacker, "burnDamage");
      }
    }
  }
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
  addStatus(attackerStatuses, picked, stacks);
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

function applySelfBuffs(rng, attacker, attackerStatuses, assumptions = DEFAULT_COMBAT_ASSUMPTIONS) {
  for (const [status, statName] of Object.entries(SELF_BUFF_TO_STAT)) {
    if (status === "Inspiration") continue;
    const rawChance = applicationChance(attacker, statName, assumptions.exportedEnemyBuffChanceScale);
    if (rawChance <= 0) continue;
    const stacks = rollStacks(rng, rawChance, `self.${status}.apply`);
    if (stacks > 0) addStatus(attackerStatuses, status, stacks);
  }
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
  if (!Number.isFinite(damage) || damage <= 0) return 0;

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
      const restorePercent = Math.max(0, 50 - (statuses.VarnishTriggers - 1));
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

function classifyVictoryCause({ result, player }) {
  const breakdown = result.damageBreakdown?.enemy;
  const dominant = dominantDamageSource(breakdown);
  if (dominant === "status") {
    if (statRaw(player, "bleedChance") > 0) return "bleed";
    if (statRaw(player, "burnChance") > 0 || statRaw(player, "burnDamage") > 0) return "burn";
    return "status_damage";
  }
  if (dominant === "reflect" || dominant === "parry") return "thorns_counter";
  if (dominant === "energyWave") return "energy_wave";
  if (statRaw(player, "execute") > 100) return "execute";
  if (statRaw(player, "freezeChance") > 0 && result.seconds > 2) return "freeze_chain";
  return "raw_damage";
}

function classifyDefeatCause({ result, player, enemy }) {
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
  if (!Number.isFinite(number)) return number;
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
