export function normalizeFightOutcome(raw) {
  const winner = classifyOutcome(raw.winner);
  if (winner !== "unknown") return winner;
  if (raw.won === true || raw.playerWon === true || raw.victory === true) return "win";
  if (raw.won === false || raw.playerWon === false || raw.loss === true || raw.defeat === true) return "loss";

  for (const value of [raw.outcome, raw.result, raw.status]) {
    const outcome = classifyOutcome(value);
    if (outcome !== "unknown") return outcome;
  }

  for (const reason of [raw.reason, raw.cause, raw.deathCause, raw.resultReason, raw.outcomeReason]) {
    const outcome = outcomeFromReason(normalizeLabel(reason));
    if (outcome !== "unknown") return outcome;
  }
  return "unknown";
}

function classifyOutcome(value) {
  const label = normalizeLabel(value);
  const outcome = outcomeFromReason(label);
  if (outcome !== "unknown") return outcome;
  if (label === "player" || label === "attacker") return "win";
  if (label === "enemy" || label === "target" || label === "defender") return "loss";
  if (/(?:^|_)(?:timeout|time_out|stall|stalled|stalling)(?:_|$)/.test(label)) return "timeout";
  if (/(?:^|_)(?:win|wins|winning|won|victory|success|successful|successfully|clear|cleared)(?:_|$)/.test(label)) return "win";
  if (/(?:^|_)(?:loss|lose|loses|lost|death|defeat|defeated|fail|failed|failure)(?:_|$)/.test(label)) return "loss";
  return "unknown";
}

function outcomeFromReason(label) {
  if (label === "enemy_hp_zero") return "win";
  if (label === "player_hp_zero" || label === "seppuku") return "loss";
  if (label === "timeout" || label.startsWith("timeout_")) return "timeout";
  return "unknown";
}

function normalizeLabel(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
