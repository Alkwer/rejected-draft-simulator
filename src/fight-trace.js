import { createRng } from "./rng.js";
import { simulateFight } from "./combat.js";

export function createFightTrace({
  player,
  enemy,
  maxSeconds = 300,
  traceSeconds = 60,
  seed = "trace",
  assumptions = {},
  includeRng = false,
} = {}) {
  const result = simulateFight({
    rng: createRng(seed),
    player,
    enemy,
    maxSeconds,
    assumptions,
    trace: { seconds: traceSeconds, includeRng },
  });
  return {
    seed,
    maxSeconds,
    traceSeconds,
    includeRng,
    target: {
      id: enemy?.id ?? null,
      name: enemy?.name ?? enemy?.id ?? "target",
    },
    result: {
      winner: result.winner,
      reason: result.reason,
      seconds: result.seconds,
      playerHp: result.playerHp,
      enemyHp: result.enemyHp,
      deathCause: result.deathCause ?? null,
    },
    events: result.trace ?? [],
  };
}

export function exportTraceMarkdown(trace) {
  const lines = [];
  lines.push(`# Fight Trace: ${trace.target?.name ?? trace.target?.id ?? "target"}`);
  lines.push("");
  lines.push(`Seed: \`${trace.seed}\``);
  lines.push(`Window: ${trace.traceSeconds}s / max fight ${trace.maxSeconds}s`);
  lines.push("");
  lines.push("## Outcome");
  lines.push("");
  lines.push(`- Winner: ${trace.result?.winner ?? "unknown"}`);
  lines.push(`- Reason: ${trace.result?.reason ?? "unknown"}`);
  lines.push(`- Time: ${formatSeconds(trace.result?.seconds)}`);
  lines.push(`- Player HP: ${formatNumber(trace.result?.playerHp)}`);
  lines.push(`- Enemy HP: ${formatNumber(trace.result?.enemyHp)}`);
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  lines.push("| Time | Event | Action | HP | Damage | Damage Events | Statuses | Mechanics | RNG |");
  lines.push("| ---: | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const event of trace.events ?? []) {
    lines.push([
      formatSeconds(event.time),
      event.event,
      formatAction(event),
      `P ${formatNumber(event.playerHp)} / E ${formatNumber(event.enemyHp)}`,
      `P ${formatNumber(event.damage?.player?.total)} / E ${formatNumber(event.damage?.enemy?.total)}`,
      formatDamageEvents(event.damageEvents),
      `P ${formatStatuses(event.statuses?.player)} / E ${formatStatuses(event.statuses?.enemy)}`,
      formatMechanics(event.mechanics),
      formatRng(event.rng),
    ].map(escapeTable).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  return `${lines.join("\n")}\n`;
}

function formatAction(event) {
  if (event.winner) return `${event.winner}:${event.reason}`;
  if (!event.action) return event.attackerSide ? `${event.attackerSide}->${event.defenderSide}` : "";
  return `${event.attackerSide}->${event.defenderSide} ${event.action.type}`;
}

function formatStatuses(statuses = {}) {
  const entries = Object.entries(statuses).filter(([, value]) => Number(value) > 0);
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}:${formatNumber(value)}`).join(", ");
}

function formatRng(rng = []) {
  if (!Array.isArray(rng) || rng.length === 0) return "none";
  return rng.slice(0, 5).map(formatRngEntry).join(", ");
}

function formatRngEntry(entry) {
  const base = `${entry.index}:${entry.label}=${formatNumber(entry.value)}`;
  if (entry.kind === "percent") {
    return `${base} < ${formatNumber(entry.threshold)} ${entry.success ? "ok" : "miss"}`;
  }
  if (entry.kind === "range") {
    return `${base} -> ${formatNumber(entry.result)}`;
  }
  if (entry.kind === "integerRange") {
    return `${base} -> ${entry.result}`;
  }
  return base;
}

function formatMechanics(mechanics = []) {
  if (!Array.isArray(mechanics) || mechanics.length === 0) return "none";
  return mechanics.slice(0, 6).map(formatMechanic).join(", ");
}

function formatDamageEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) return "none";
  return events.slice(0, 4).map(formatDamageEvent).join(", ");
}

function formatDamageEvent(event) {
  const side = event.side === "player" ? "P" : event.side === "enemy" ? "E" : String(event.side ?? "?");
  const tags = Array.isArray(event.tags) && event.tags.length > 0 ? `[${event.tags.join(", ")}]` : "";
  const overkill = Number(event.overkillDamage) > 0 ? ` overkill ${formatNumber(event.overkillDamage)}` : "";
  return `${side} ${event.source ?? "damage"}${tags} ${formatNumber(event.requestedDamage)}->${formatNumber(event.appliedDamage)}${overkill}`;
}

function formatMechanic(mechanic) {
  if (mechanic.type === "leap_block") {
    return `Leap blocked ${formatNumber(mechanic.blockedStacks)} ${mechanic.status}`;
  }
  if (mechanic.type === "remedy") {
    return `Remedy cleared ${formatRemoved(mechanic.removed)}`;
  }
  if (mechanic.type === "balloon_pop") {
    return `Balloon ${mechanic.popped ? "popped" : "held"} ${formatNumber(mechanic.stacks)}`;
  }
  if (mechanic.type === "hot_potato_branch") {
    return `Hot Potato ${mechanic.branch}`;
  }
  if (mechanic.type === "hot_potato_pass") {
    return `Hot Potato pass ${mechanic.fromSide}->${mechanic.toSide}`;
  }
  if (mechanic.type === "evasion") {
    return `${capitalize(mechanic.mode)} ${mechanic.outcome}`;
  }
  if (mechanic.type === "mitigation") {
    return `Mitigation ${formatNumber(mechanic.incomingDamage)}->${formatNumber(mechanic.finalDamage)}`;
  }
  if (mechanic.type === "offense") {
    return formatOffenseMechanic(mechanic);
  }
  if (mechanic.type === "electrocute") {
    return `Electrocute +${formatNumber(mechanic.addedDamage)} ->${formatNumber(mechanic.after)}`;
  }
  if (mechanic.type === "energy_wave") {
    return `Energy Wave ${formatNumber(mechanic.finalDamage)} dealt ${formatNumber(mechanic.dealtDamage)}`;
  }
  if (mechanic.type === "brittle_growth") {
    return `Brittle growth +${formatNumber(mechanic.growth)} ->${formatNumber(mechanic.after)}`;
  }
  if (mechanic.type === "lifesteal") {
    return `Lifesteal +${formatNumber(mechanic.appliedHealing)} ->${formatNumber(mechanic.afterHp)}`;
  }
  if (mechanic.type === "varnish") {
    return `Varnish ${mechanic.side} restored ${formatNumber(mechanic.restorePercent)}% ->${formatNumber(mechanic.afterHp)}`;
  }
  if (mechanic.type === "counter_scheduled") {
    return `Counter scheduled ${mechanic.defenderSide}->${mechanic.attackerSide} @${formatNumber(mechanic.scheduledTime)}`;
  }
  if (mechanic.type === "counter") {
    return `Counter ${mechanic.defenderSide}->${mechanic.attackerSide} ${formatNumber(mechanic.dealtDamage)}`;
  }
  if (mechanic.type === "thorns") {
    return `Thorns ${mechanic.defenderSide}->${mechanic.attackerSide} ${formatNumber(mechanic.dealtDamage)}`;
  }
  if (mechanic.type === "exacerbate") {
    return `Exacerbate ${mechanic.status} +${formatNumber(mechanic.stacks)} ->${formatNumber(mechanic.after)}`;
  }
  if (mechanic.type === "resonance") {
    return `Resonance ${mechanic.status} +${formatNumber(mechanic.stacks)} ->${formatNumber(mechanic.after)}`;
  }
  if (mechanic.type === "purge") {
    return `Purge ${formatRemovedTransitions(mechanic.removed)}`;
  }
  if (mechanic.type === "regen") {
    if (Number(mechanic.appliedHealing) > 0) {
      const before = Number.isFinite(Number(mechanic.beforeHp)) ? `${formatNumber(mechanic.beforeHp)} ` : "";
      return `Regen ${mechanic.side} ${before}+${formatNumber(mechanic.appliedHealing)} ->${formatNumber(mechanic.afterHp)}`;
    }
    const before = Number.isFinite(Number(mechanic.beforeHp)) ? `${formatNumber(mechanic.beforeHp)} ` : "";
    const after = Number.isFinite(Number(mechanic.afterHp)) ? ` ->${formatNumber(mechanic.afterHp)}` : "";
    return `Regen ${mechanic.side} ${before}converted ${formatNumber(mechanic.dealtDamage)}${after}`;
  }
  if (mechanic.type === "freeze_tick") {
    return `Freeze ${mechanic.side} ${formatNumber(mechanic.dealtDamage)}`;
  }
  if (mechanic.type === "energy_wave_tick") {
    return `Energy Wave tick ${mechanic.attackerSide}->${mechanic.defenderSide} -${formatNumber(mechanic.consumed)} dealt ${formatNumber(mechanic.dealtDamage)}`;
  }
  if (mechanic.type === "self_buff_tick") {
    return `${mechanic.status} tick ${mechanic.side} +${formatNumber(mechanic.stacks)} ->${formatNumber(mechanic.after)}`;
  }
  if (mechanic.type === "status_growth") {
    const before = Number.isFinite(Number(mechanic.before)) ? `${formatNumber(mechanic.before)} ` : "";
    return `${mechanic.status} growth ${before}+${formatNumber(mechanic.growth)} ->${formatNumber(mechanic.after)}`;
  }
  return mechanic.type ?? "mechanic";
}

function formatOffenseMechanic(mechanic) {
  const modifiers = [];
  if (mechanic.crit?.success) {
    modifiers.push(mechanic.crit.applied === false ? "crit glancing" : `crit x${formatNumber(mechanic.crit.multiplier)}`);
  }
  if (mechanic.execute?.triggered) modifiers.push(`execute x${formatNumber(mechanic.execute.multiplier)}`);
  if (mechanic.goldenLuck?.success) modifiers.push(`golden x${formatNumber(mechanic.goldenLuck.multiplier)}`);
  const suffix = modifiers.length > 0 ? ` ${modifiers.join(" ")}` : "";
  return `Offense ${formatNumber(mechanic.baseAttack)}->${formatNumber(mechanic.finalDamage)}${suffix}`;
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function formatRemoved(removed = {}) {
  const entries = Object.entries(removed);
  if (entries.length === 0) return "none";
  return entries.map(([status, stacks]) => `${status}:${formatNumber(stacks)}`).join(", ");
}

function formatRemovedTransitions(removed = []) {
  if (!Array.isArray(removed) || removed.length === 0) return "none";
  return removed.map((item) => `${item.status}:${formatNumber(item.before)}->${formatNumber(item.after)}`).join(", ");
}

function formatSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}s` : "--";
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (Math.abs(number) >= 1e9 || Math.abs(number) < 0.001 && number !== 0) return number.toExponential(2);
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
  return `${Math.round(number * 1000) / 1000}`;
}

function escapeTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}
