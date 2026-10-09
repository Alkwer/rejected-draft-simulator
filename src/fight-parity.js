import { createFightTrace } from "./fight-trace.js";
import { toNumber } from "./save.js";

const DEFAULT_TOLERANCES = {
  seconds: 0.05,
  hpAbsolute: 1e-6,
  hpRelative: 0.001,
  damageAbsolute: 1e-6,
  damageRelative: 0.001,
};

export function compareFightParityFixture({
  fixture,
  player = null,
  enemy = null,
  targetId = null,
  seed = "fight-parity",
  maxSeconds = 300,
  traceSeconds = 60,
  includeRng = false,
  tolerances = {},
} = {}) {
  const normalized = normalizeFightFixture(fixture, { player, enemy, targetId });
  const effectiveTolerances = { ...DEFAULT_TOLERANCES, ...(normalized.tolerances ?? {}), ...tolerances };
  const deviations = [];

  if (!hasStats(normalized.player) || !hasStats(normalized.enemy)) {
    return {
      mode: "fight-parity",
      ok: false,
      fixtureId: normalized.id,
      targetId: normalized.targetId,
      targetName: normalized.targetName,
      seed,
      maxSeconds,
      traceSeconds,
      observed: normalized.observed,
      simulated: null,
      trace: null,
      deviations: [{
        code: "missing_stats",
        targetId: normalized.targetId,
        message: "Cannot run fight parity fixture because player or enemy stats are missing.",
      }],
    };
  }

  const trace = createFightTrace({
    player: normalized.player,
    enemy: normalized.enemy,
    maxSeconds: normalized.maxSeconds ?? maxSeconds,
    traceSeconds: normalized.traceSeconds ?? traceSeconds,
    includeRng: normalized.includeRng ?? includeRng,
    seed: normalized.seed ?? seed,
    assumptions: normalized.assumptions ?? {},
  });
  const simulated = summarizeTrace(trace);

  compareOutcome({ observed: normalized.observed, simulated, deviations });
  compareScalar({
    code: "duration_mismatch",
    label: "duration",
    actual: normalized.observed.seconds,
    expected: simulated.seconds,
    tolerance: effectiveTolerances.seconds,
    deviations,
    targetId: normalized.targetId,
    unit: "s",
  });
  compareScalar({
    code: "player_hp_mismatch",
    label: "player HP",
    actual: normalized.observed.playerHp,
    expected: simulated.playerHp,
    absoluteTolerance: effectiveTolerances.hpAbsolute,
    relativeTolerance: effectiveTolerances.hpRelative,
    deviations,
    targetId: normalized.targetId,
  });
  compareScalar({
    code: "enemy_hp_mismatch",
    label: "enemy HP",
    actual: normalized.observed.enemyHp,
    expected: simulated.enemyHp,
    absoluteTolerance: effectiveTolerances.hpAbsolute,
    relativeTolerance: effectiveTolerances.hpRelative,
    deviations,
    targetId: normalized.targetId,
  });
  compareBreakdown({
    observed: normalized.observed.damageBreakdown,
    simulated: simulated.damageBreakdown,
    tolerances: effectiveTolerances,
    deviations,
    targetId: normalized.targetId,
  });
  compareExpectedEvents({
    expectedEvents: normalized.observed.events,
    simulatedEvents: trace.events,
    tolerances: effectiveTolerances,
    deviations,
    targetId: normalized.targetId,
  });

  return {
    mode: "fight-parity",
    ok: deviations.length === 0,
    fixtureId: normalized.id,
    targetId: normalized.targetId,
    targetName: normalized.targetName,
    seed: trace.seed,
    maxSeconds: normalized.maxSeconds ?? maxSeconds,
    traceSeconds: normalized.traceSeconds ?? traceSeconds,
    observed: normalized.observed,
    simulated,
    trace,
    deviations,
  };
}

export function normalizeFightFixture(fixture, fallback = {}) {
  const source = parseJsonLike(fixture);
  const raw = source && typeof source === "object" ? source : {};
  const observed = normalizeObserved(raw);
  const fixtureTargetId = firstString(raw.targetId, raw.sketchId, raw.enemyId, observed.targetId, fallback.targetId);
  const fallbackEnemy = normalizeCombatant(fallback.enemy, fixtureTargetId);
  const fixtureEnemy = normalizeCombatant(raw.enemy ?? raw.target ?? raw.targetStats, fixtureTargetId);
  const fixturePlayer = normalizeCombatant(raw.player ?? raw.playerStats, "player");
  const normalizedEnemy = hasStats(fixtureEnemy) ? fixtureEnemy : fallbackEnemy;
  const normalizedPlayer = hasStats(fixturePlayer) ? fixturePlayer : normalizeCombatant(fallback.player, "player");
  const targetName = firstString(
    raw.targetName,
    raw.sketchName,
    raw.enemyName,
    raw.enemy?.name,
    raw.target?.name,
    normalizedEnemy.name,
    observed.targetName,
  );

  return {
    id: firstString(raw.id, raw.fixtureId, raw.name) ?? "fight_fixture",
    targetId: fixtureTargetId ?? normalizedEnemy.id ?? null,
    targetName,
    player: normalizedPlayer,
    enemy: normalizedEnemy,
    observed: {
      ...observed,
      targetId: observed.targetId ?? fixtureTargetId ?? normalizedEnemy.id ?? null,
      targetName: observed.targetName ?? targetName,
    },
    seed: firstString(raw.seed),
    maxSeconds: finiteOrNull(raw.maxSeconds),
    traceSeconds: finiteOrNull(raw.traceSeconds),
    includeRng: typeof raw.includeRng === "boolean" ? raw.includeRng : null,
    assumptions: raw.assumptions && typeof raw.assumptions === "object" ? raw.assumptions : {},
    tolerances: raw.tolerances && typeof raw.tolerances === "object" ? raw.tolerances : {},
  };
}

export function renderFightParityMarkdown(parity) {
  const lines = [];
  lines.push(`# Fight Parity Fixture: ${parity.fixtureId}`);
  lines.push("");
  lines.push(`Status: **${parity.ok ? "PASS" : "FAIL"}**`);
  lines.push(`Target: ${parity.targetName ?? parity.targetId ?? "unknown"} [${parity.targetId ?? "unknown"}]`);
  lines.push(`Seed: ${parity.seed}`);
  lines.push("");
  lines.push("| Side | Outcome | Time | Player HP | Enemy HP | Reason |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- |");
  lines.push(`| Observed | ${parity.observed?.outcome ?? "unknown"} | ${formatNumber(parity.observed?.seconds)} | ${formatNumber(parity.observed?.playerHp)} | ${formatNumber(parity.observed?.enemyHp)} | ${parity.observed?.reason ?? ""} |`);
  lines.push(`| Simulated | ${parity.simulated?.outcome ?? "unknown"} | ${formatNumber(parity.simulated?.seconds)} | ${formatNumber(parity.simulated?.playerHp)} | ${formatNumber(parity.simulated?.enemyHp)} | ${parity.simulated?.reason ?? ""} |`);
  lines.push("");

  if (parity.deviations.length > 0) {
    lines.push("## Deviations");
    for (const item of parity.deviations) {
      lines.push(`- \`${item.code}\`: ${item.message}`);
    }
    lines.push("");
  }

  if (parity.trace?.events?.length > 0) {
    lines.push("## Trace");
    lines.push("| t | event | action | P HP | E HP | dmg P/E |");
    lines.push("| ---: | --- | --- | ---: | ---: | ---: |");
    for (const event of parity.trace.events.slice(0, 20)) {
      const action = event.action?.type
        ? `${event.attackerSide}->${event.defenderSide} ${event.action.type}`
        : "";
      lines.push(`| ${formatNumber(event.time)} | ${event.event} | ${action} | ${formatNumber(event.playerHp)} | ${formatNumber(event.enemyHp)} | ${formatNumber(event.damage?.player?.total)}/${formatNumber(event.damage?.enemy?.total)} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function normalizeObserved(fixture) {
  const raw = parseJsonLike(fixture.observed ?? fixture.actual ?? fixture.log ?? fixture.combatLog ?? fixture.result ?? fixture) ?? {};
  const target = raw.target ?? raw.sketch ?? raw.enemy ?? {};
  const outcome = normalizeOutcome(raw);
  return {
    targetId: firstString(raw.targetId, raw.sketchId, raw.enemyId, target.id),
    targetName: firstString(raw.targetName, raw.sketchName, raw.enemyName, target.name),
    outcome,
    seconds: normalizeSeconds(raw),
    reason: firstString(raw.reason, raw.cause, raw.deathCause, raw.resultReason, raw.outcomeReason),
    playerHp: firstFiniteOrNull(
      raw.playerHp,
      raw.finalPlayerHp,
      raw.playerFinalHp,
      raw.remainingPlayerHp,
      raw.player?.hp,
      raw.player?.currentHp,
    ),
    enemyHp: firstFiniteOrNull(
      raw.enemyHp,
      raw.targetHp,
      raw.finalEnemyHp,
      raw.enemyFinalHp,
      raw.remainingEnemyHp,
      raw.enemy?.hp,
      raw.target?.hp,
    ),
    damageBreakdown: normalizeDamageBreakdown(raw.damageBreakdown ?? raw.damage ?? raw.breakdown),
    events: normalizeExpectedEvents(raw.events ?? raw.activeBattleLog ?? raw.logEvents ?? []),
    raw,
  };
}

function normalizeCombatant(raw, fallbackId = null) {
  if (!raw || typeof raw !== "object") return {};
  const statsSource = raw.stats && typeof raw.stats === "object" ? raw.stats : raw;
  return {
    id: firstString(raw.id, raw.sketchId, raw.targetId, fallbackId),
    name: firstString(raw.name, raw.sketchName, raw.targetName),
    ...numericObject(statsSource),
    immunities: Array.isArray(raw.immunities) ? raw.immunities : [],
    vulnerability: Array.isArray(raw.vulnerability) ? raw.vulnerability : null,
    vulnerabilityEffects: Array.isArray(raw.vulnerabilityEffects) ? raw.vulnerabilityEffects : [],
  };
}

function summarizeTrace(trace) {
  return {
    outcome: winnerToOutcome(trace.result.winner),
    winner: trace.result.winner,
    reason: trace.result.reason,
    seconds: trace.result.seconds,
    playerHp: trace.result.playerHp,
    enemyHp: trace.result.enemyHp,
    deathCause: trace.result.deathCause ?? null,
    damageBreakdown: finalDamageBreakdown(trace.events),
    eventSummary: summarizeEvents(trace.events),
  };
}

function finalDamageBreakdown(events) {
  const result = { player: {}, enemy: {} };
  for (const event of events) {
    mergeBreakdown(result.player, event.damage?.player);
    mergeBreakdown(result.enemy, event.damage?.enemy);
  }
  if (result.player.total == null) result.player.total = 0;
  if (result.enemy.total == null) result.enemy.total = 0;
  return result;
}

function summarizeEvents(events = []) {
  const byEvent = {};
  const byAction = {};
  for (const event of events) {
    byEvent[event.event] = (byEvent[event.event] ?? 0) + 1;
    const action = event.action?.type;
    if (action) byAction[action] = (byAction[action] ?? 0) + 1;
  }
  return {
    total: events.length,
    byEvent,
    byAction,
  };
}

function compareOutcome({ observed, simulated, deviations }) {
  if (!observed?.outcome || observed.outcome === "unknown") return;
  if (observed.outcome === simulated.outcome) return;
  deviations.push({
    code: "outcome_mismatch",
    actual: observed.outcome,
    expected: simulated.outcome,
    message: `Observed outcome ${observed.outcome}, but simulated outcome is ${simulated.outcome}.`,
  });
}

function compareScalar({
  code,
  label,
  actual,
  expected,
  tolerance = null,
  absoluteTolerance = null,
  relativeTolerance = null,
  deviations,
  targetId,
  unit = "",
}) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return;
  const diff = Math.abs(actual - expected);
  const allowed = tolerance ?? Math.max(
    absoluteTolerance ?? 0,
    Math.max(Math.abs(actual), Math.abs(expected), 1) * (relativeTolerance ?? 0),
  );
  if (diff <= allowed) return;
  deviations.push({
    code,
    targetId,
    actual: round(actual),
    expected: round(expected),
    delta: round(actual - expected),
    tolerance: round(allowed),
    message: `Observed ${label} ${formatNumber(actual)}${unit}, but simulated ${formatNumber(expected)}${unit}.`,
  });
}

function compareBreakdown({ observed, simulated, tolerances, deviations, targetId }) {
  if (!observed) return;
  for (const side of ["player", "enemy"]) {
    const observedSide = observed[side] ?? {};
    const simulatedSide = simulated?.[side] ?? {};
    for (const key of Object.keys(observedSide)) {
      compareScalar({
        code: "damage_breakdown_mismatch",
        label: `${side}.${key} damage`,
        actual: observedSide[key],
        expected: toNumber(simulatedSide[key], 0),
        absoluteTolerance: tolerances.damageAbsolute,
        relativeTolerance: tolerances.damageRelative,
        deviations,
        targetId,
      });
    }
  }
}

function compareExpectedEvents({ expectedEvents, simulatedEvents, tolerances, deviations, targetId }) {
  if (!Array.isArray(expectedEvents) || expectedEvents.length === 0) return;

  let searchFrom = 0;
  for (const expected of expectedEvents) {
    const simulatedIndex = findSimulatedEvent(expected, simulatedEvents, searchFrom);
    if (simulatedIndex < 0) {
      deviations.push({
        code: "event_missing",
        targetId,
        expected: expected.event ?? expected.type ?? expected.action ?? "event",
        message: `Expected event ${expected.event ?? expected.type ?? expected.action ?? "event"} was not found in the simulated trace.`,
      });
      continue;
    }

    const simulated = simulatedEvents[simulatedIndex];
    searchFrom = simulatedIndex + 1;
    compareScalar({
      code: "event_time_mismatch",
      label: `${expected.event ?? "event"} time`,
      actual: expected.time,
      expected: simulated.time,
      tolerance: tolerances.seconds,
      deviations,
      targetId,
      unit: "s",
    });
    compareScalar({
      code: "event_player_hp_mismatch",
      label: `${expected.event ?? "event"} player HP`,
      actual: expected.playerHp,
      expected: simulated.playerHp,
      absoluteTolerance: tolerances.hpAbsolute,
      relativeTolerance: tolerances.hpRelative,
      deviations,
      targetId,
    });
    compareScalar({
      code: "event_enemy_hp_mismatch",
      label: `${expected.event ?? "event"} enemy HP`,
      actual: expected.enemyHp,
      expected: simulated.enemyHp,
      absoluteTolerance: tolerances.hpAbsolute,
      relativeTolerance: tolerances.hpRelative,
      deviations,
      targetId,
    });
  }
}

function findSimulatedEvent(expected, simulatedEvents, searchFrom) {
  if (Number.isInteger(expected.index)) {
    const index = expected.index - 1;
    return index >= 0 && index < simulatedEvents.length ? index : -1;
  }
  const expectedEvent = expected.event ?? expected.type;
  const expectedAction = expected.action;
  for (let index = searchFrom; index < simulatedEvents.length; index += 1) {
    const simulated = simulatedEvents[index];
    if (expectedEvent && simulated.event !== expectedEvent) continue;
    if (expectedAction && simulated.action?.type !== expectedAction) continue;
    return index;
  }
  return -1;
}

function normalizeExpectedEvents(rawEvents) {
  const parsed = parseJsonLike(rawEvents);
  const events = Array.isArray(parsed) ? parsed : [];
  return events.map((event) => ({
    ...event,
    event: firstString(event.event, event.type),
    action: firstString(event.action, event.actionType, event.action?.type),
    time: firstFiniteOrNull(event.time, event.seconds, event.elapsedSeconds),
    playerHp: firstFiniteOrNull(event.playerHp, event.finalPlayerHp, event.player?.hp),
    enemyHp: firstFiniteOrNull(event.enemyHp, event.targetHp, event.enemy?.hp, event.target?.hp),
  }));
}

function normalizeOutcome(raw) {
  if (raw.winner != null) return winnerToOutcome(raw.winner);
  if (raw.won === true || raw.playerWon === true || raw.victory === true) return "win";
  if (raw.won === false || raw.playerWon === false || raw.loss === true || raw.defeat === true) return "loss";
  const text = String(raw.outcome ?? raw.result ?? raw.status ?? "").toLowerCase();
  if (!text) return "unknown";
  if (/timeout|stall/.test(text)) return "timeout";
  if (/win|victory|success|clear|player/.test(text)) return "win";
  if (/loss|lose|lost|death|defeat|enemy|player_hp_zero|fail/.test(text)) return "loss";
  return "unknown";
}

function winnerToOutcome(winner) {
  const text = String(winner ?? "").toLowerCase();
  if (text === "player" || text === "attacker" || text === "win") return "win";
  if (text === "enemy" || text === "target" || text === "defender" || text === "loss") return "loss";
  if (text === "timeout") return "timeout";
  return "unknown";
}

function normalizeSeconds(raw) {
  const direct = firstFiniteOrNull(raw.seconds, raw.durationSeconds, raw.fightSeconds, raw.elapsedSeconds, raw.timeSeconds);
  if (direct != null) return direct;
  const ms = firstFiniteOrNull(raw.durationMs, raw.elapsedMs, raw.timeMs);
  return ms == null ? null : ms / 1000;
}

function normalizeDamageBreakdown(raw) {
  const parsed = parseJsonLike(raw);
  if (!parsed || typeof parsed !== "object") return null;
  return {
    player: numericObject(parsed.player ?? parsed.takenByPlayer ?? parsed.playerTaken ?? {}),
    enemy: numericObject(parsed.enemy ?? parsed.target ?? parsed.takenByEnemy ?? parsed.enemyTaken ?? {}),
  };
}

function numericObject(raw = {}) {
  if (!raw || typeof raw !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    const number = toNumber(value, NaN);
    if (Number.isFinite(number)) result[key] = number;
  }
  return result;
}

function mergeBreakdown(target, source = {}) {
  if (!source || typeof source !== "object") return;
  for (const [key, value] of Object.entries(source)) {
    const number = toNumber(value, NaN);
    if (Number.isFinite(number)) target[key] = (target[key] ?? 0) + number;
  }
}

function hasStats(stats) {
  return Boolean(stats && typeof stats === "object" && Object.keys(numericObject(stats)).length > 0);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstFiniteOrNull(...values) {
  for (const value of values) {
    const number = toNumber(value, NaN);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function finiteOrNull(value) {
  const number = toNumber(value, NaN);
  return Number.isFinite(number) ? number : null;
}

function parseJsonLike(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (Math.abs(number) >= 1e6 || (Math.abs(number) > 0 && Math.abs(number) < 0.001)) return number.toExponential(3);
  return String(round(number));
}

function round(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number;
  return Math.round(number * 1e6) / 1e6;
}
