import { extractCombatLogs } from "./calibration.js";
import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { resolveTargetId } from "./cli-convenience.js";
import { compareFightParityFixture } from "./fight-parity.js";
import { analyzeSave } from "./save-analysis.js";
import { decodeSaveText, toNumber } from "./save.js";

export function createCompanionFightFixture({
  saveText,
  sketches = {},
  dataMetadata = null,
  targetId = null,
  observed = null,
  browserSnapshot = null,
  seed = "companion-fixture",
  maxSeconds = 300,
  traceSeconds = 60,
} = {}) {
  const save = decodeCompanionSave(saveText);
  const resolvedTargetId = inferTargetId({ save, sketches, targetId, observed, browserSnapshot });
  const target = sketches[resolvedTargetId];
  if (!target) throw new Error(`Unknown target sketch: ${resolvedTargetId}`);

  const analysis = analyzeSave({ save, sketches, targetId: resolvedTargetId, dataMetadata });
  const statSource = analysis.stats.recommendedSource;
  const player = analysis.stats.sources[statSource] ?? {};
  const enemy = {
    id: target.id,
    name: target.name,
    ...target.stats,
    immunities: target.immunities,
    vulnerability: target.vulnerability,
  };
  const observedSource = selectObservedFight({ save, targetId: resolvedTargetId, observed, browserSnapshot });
  const combatAssumptions = combatAssumptionsFromSave(save);
  const captureDiagnostics = buildCaptureDiagnostics({ save, browserSnapshot, observedSource, combatAssumptions });
  const fixture = {
    id: `companion_${resolvedTargetId}_${observedSource.source}`,
    source: observedSource.source,
    capturedAt: new Date().toISOString(),
    gameVersion: dataMetadata?.gameVersion ?? null,
    saveVersion: save.version ?? null,
    targetId: resolvedTargetId,
    targetName: target.name,
    statSource,
    player,
    enemy,
    assumptions: combatAssumptions,
    captureDiagnostics,
    observed: observedSource.observed ?? {
      outcome: "unknown",
      reason: "No observed fight log was found in the provided browser snapshot or save.",
    },
  };
  const warnings = [
    ...analysis.warnings.map((item) => ({
      title: item.code ?? "save warning",
      detail: item.message ?? item.detail ?? String(item),
    })),
    ...observedSource.warnings,
  ];
  const parity = observedSource.observed
    ? compareFightParityFixture({
      fixture,
      player,
      enemy,
      targetId: resolvedTargetId,
      seed,
      maxSeconds,
      traceSeconds,
      includeRng: true,
    })
    : null;

  return {
    mode: "companion-fight-fixture",
    source: observedSource.source,
    targetId: resolvedTargetId,
    targetName: target.name,
    saveVersion: save.version ?? null,
    gameVersion: dataMetadata?.gameVersion ?? null,
    statSource,
    filename: fixtureFilename({ targetId: resolvedTargetId, saveVersion: save.version, source: observedSource.source }),
    cliEquivalent: `npm.cmd run simulate -- --save <save.txt> --target ${resolvedTargetId} --fight-fixture <downloaded-fixture.json> --trace-rng --trace-seconds ${Math.max(1, Math.floor(toNumber(traceSeconds, 60)))} --export markdown`,
    fixture,
    parity,
    warnings,
  };
}

function buildCaptureDiagnostics({ save, browserSnapshot, observedSource, combatAssumptions = null }) {
  const saveLogs = extractCombatLogs(save);
  const history = Array.isArray(browserSnapshot?.saveHistory) ? browserSnapshot.saveHistory : [];
  const localStorageCandidates = Array.isArray(browserSnapshot?.localStorageCandidates)
    ? browserSnapshot.localStorageCandidates
    : [];
  const visibleCombatLogText = extractVisibleCombatLogText(browserSnapshot?.visibleCombatLog);
  return {
    companionVersion: firstString(browserSnapshot?.companionVersion),
    selectedSource: observedSource.source,
    combatLoggingEnabled: save?.state?.combatLoggingEnabled ?? null,
    saveCombatLogCount: saveLogs.length,
    saveCombatLogTargetIds: uniqueStrings(saveLogs.map((log) => log.targetId)).slice(0, 12),
    saveHistoryCount: history.length,
    saveHistoryUniqueCount: uniqueStrings(history.map(saveHistoryFingerprint)).length,
    localStorageCandidateCount: localStorageCandidates.length,
    localStorageCandidateKeys: localStorageCandidates.map((item) => String(item?.key ?? "")).filter(Boolean).slice(0, 20),
    browserObservedPresent: Boolean(browserSnapshot?.observed),
    browserLastFightPresent: Boolean(browserSnapshot?.lastFight),
    visibleCombatLogPresent: Boolean(visibleCombatLogText),
    visibleCombatLogCharacters: visibleCombatLogText?.length ?? 0,
    combatSpeedMultiplier: combatAssumptions?.combatSpeedMultiplier ?? combatAssumptionsFromSave(save).combatSpeedMultiplier,
  };
}

function selectObservedFight({ save, targetId, observed, browserSnapshot }) {
  const provided = normalizeObservedCandidate(observed);
  if (provided) return { source: "provided_observation", observed: provided, warnings: [] };

  const browser = normalizeObservedCandidate(browserSnapshot?.observed)
    ?? normalizeObservedCandidate(browserSnapshot?.lastFight)
    ?? normalizeObservedCandidate(browserSnapshot);
  if (browser) return { source: "browser_snapshot", observed: browser, warnings: [] };

  const visibleCombatLog = normalizeVisibleCombatLog(browserSnapshot?.visibleCombatLog, targetId);
  if (visibleCombatLog) return { source: "browser_visible_combat_log", observed: visibleCombatLog, warnings: [] };

  const localStorageLog = latestLocalStorageCandidate(browserSnapshot, targetId);
  if (localStorageLog) return { source: "browser_local_storage", observed: localStorageLog, warnings: [] };

  const saveLog = latestSaveCombatLog(save, targetId);
  if (saveLog) return { source: "save_combat_log", observed: saveLog, warnings: [] };

  const saveHistory = latestSaveHistoryObservation({ save, browserSnapshot, targetId });
  if (saveHistory) return { source: "browser_save_history", observed: saveHistory, warnings: [] };

  return {
    source: "no_observed_fight",
    observed: null,
    warnings: [{
      title: "no observed fight",
      detail: "No combat log or active battle log was found. Try capturing immediately after a fight while the game page is still open.",
    }],
  };
}

function latestSaveCombatLog(save, targetId) {
  const logs = extractCombatLogs(save)
    .filter((log) => !targetId || log.targetId === targetId || !log.targetId);
  const latest = logs.at(-1);
  if (!latest) return null;
  return {
    targetId: latest.targetId ?? targetId,
    targetName: latest.targetName,
    outcome: latest.outcome,
    seconds: Number.isFinite(latest.seconds) ? latest.seconds : null,
    reason: latest.reason,
    damageBreakdown: latest.damageBreakdown,
    playerStats: latest.playerStats,
    targetStats: latest.targetStats,
    raw: latest.raw,
  };
}

function latestLocalStorageCandidate(browserSnapshot, targetId) {
  const candidates = Array.isArray(browserSnapshot?.localStorageCandidates)
    ? browserSnapshot.localStorageCandidates
    : [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const parsed = parseJsonLike(candidate?.value);
    const observed = normalizeObservedCandidate(parsed);
    if (observed && (!targetId || observed.targetId === targetId || !observed.targetId)) return observed;
  }
  return null;
}

function latestSaveHistoryObservation({ save, browserSnapshot, targetId }) {
  const history = normalizeSaveHistory(browserSnapshot, save);
  for (let index = history.length - 1; index > 0; index -= 1) {
    const observed = compareSaveHistoryPair(history[index - 1], history[index], targetId);
    if (observed) return observed;
  }
  return null;
}

function normalizeSaveHistory(browserSnapshot, currentSave) {
  const entries = Array.isArray(browserSnapshot?.saveHistory) ? browserSnapshot.saveHistory : [];
  const history = entries
    .map((entry) => {
      const save = decodeHistorySave(entry);
      if (!save) return null;
      return {
        capturedAt: firstString(entry?.capturedAt, entry?.time, entry?.timestamp),
        save,
      };
    })
    .filter(Boolean);
  if (currentSave && history.length === 0) {
    history.push({
      capturedAt: firstString(browserSnapshot?.capturedAt),
      save: currentSave,
    });
  }
  return history;
}

function decodeHistorySave(entry) {
  if (!entry) return null;
  if (entry.save && typeof entry.save === "object") return entry.save;
  const text = firstString(entry.saveText, entry.value, entry.raw);
  if (!text) return null;
  try {
    return decodeCompanionSave(text);
  } catch {
    return null;
  }
}

function compareSaveHistoryPair(beforeEntry, afterEntry, targetId) {
  const beforeState = beforeEntry?.save?.state ?? beforeEntry?.save ?? {};
  const afterState = afterEntry?.save?.state ?? afterEntry?.save ?? {};
  const candidateIds = saveHistoryCandidateIds(beforeState, afterState, targetId);
  for (const id of candidateIds) {
    const beforeRun = toNumber(beforeState.sketchRunVictories?.[id], 0);
    const afterRun = toNumber(afterState.sketchRunVictories?.[id], 0);
    const beforeTotal = toNumber(beforeState.sketchVictories?.[id], 0);
    const afterTotal = toNumber(afterState.sketchVictories?.[id], 0);
    if (afterRun > beforeRun || afterTotal > beforeTotal) {
      return {
        targetId: id,
        outcome: "win",
        reason: "Victory count increased in browser save history.",
        approximateSeconds: approximateSecondsBetween(beforeEntry, afterEntry),
        raw: {
          source: "browser_save_history",
          runVictoriesBefore: beforeRun,
          runVictoriesAfter: afterRun,
          totalVictoriesBefore: beforeTotal,
          totalVictoriesAfter: afterTotal,
        },
      };
    }
  }

  const beforeCombat = beforeState.combatState ?? {};
  const afterCombat = afterState.combatState ?? {};
  const enemyId = firstString(beforeCombat.enemyId, beforeState.lastEnemyId, targetId);
  if (beforeCombat.isFighting === true && afterCombat.isFighting === false && (!targetId || enemyId === targetId)) {
    return {
      targetId: enemyId,
      outcome: "loss",
      reason: "Combat ended without a victory delta in browser save history.",
      approximateSeconds: approximateSecondsBetween(beforeEntry, afterEntry),
      raw: { source: "browser_save_history" },
    };
  }
  return null;
}

function saveHistoryCandidateIds(beforeState, afterState, targetId) {
  const ids = [
    targetId,
    beforeState.combatState?.enemyId,
    afterState.combatState?.enemyId,
    beforeState.lastEnemyId,
    afterState.lastEnemyId,
    ...Object.keys(beforeState.sketchRunVictories ?? {}),
    ...Object.keys(afterState.sketchRunVictories ?? {}),
    ...Object.keys(beforeState.sketchVictories ?? {}),
    ...Object.keys(afterState.sketchVictories ?? {}),
  ].filter((id) => typeof id === "string" && id.trim());
  return [...new Set(ids)];
}

function normalizeObservedCandidate(raw) {
  const parsed = parseJsonLike(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const nested = parsed.observed ?? parsed.actual ?? parsed.result ?? null;
  if (nested && nested !== parsed) return normalizeObservedCandidate(nested);

  const activeBattleLog = normalizeArray(parsed.activeBattleLog ?? parsed.events ?? parsed.logEvents);
  const combatState = parsed.combatState ?? parsed.state?.combatState ?? {};
  const target = parsed.target ?? parsed.enemy ?? {};
  const observed = {
    targetId: firstString(parsed.targetId, parsed.enemyId, parsed.sketchId, combatState.enemyId, target.id),
    targetName: firstString(parsed.targetName, parsed.enemyName, parsed.sketchName, target.name),
    outcome: normalizeOutcome(parsed),
    seconds: firstFiniteOrNull(parsed.seconds, parsed.durationSeconds, parsed.elapsedSeconds, combatState.elapsedSeconds),
    reason: firstString(parsed.reason, parsed.cause, parsed.deathCause, parsed.resultReason),
    playerHp: firstFiniteOrNull(
      parsed.playerHp,
      parsed.finalPlayerHp,
      parsed.currentPlayerHp,
      combatState.currentPlayerHp,
    ),
    enemyHp: firstFiniteOrNull(
      parsed.enemyHp,
      parsed.targetHp,
      parsed.finalEnemyHp,
      parsed.currentEnemyHp,
      combatState.currentEnemyHp,
    ),
    damageBreakdown: parsed.damageBreakdown ?? parsed.damage ?? parsed.trainingState?.damageBreakdown ?? null,
    events: activeBattleLog,
    raw: parsed,
  };

  const hasUsefulData = observed.outcome !== "unknown"
    || observed.seconds != null
    || observed.playerHp != null
    || observed.enemyHp != null
    || activeBattleLog.length > 0
    || observed.damageBreakdown != null;
  return hasUsefulData ? observed : null;
}

function inferTargetId({ save, sketches, targetId, observed, browserSnapshot }) {
  const visibleCombatLog = normalizeVisibleCombatLog(browserSnapshot?.visibleCombatLog);
  const candidates = [
    targetId,
    normalizeObservedCandidate(observed)?.targetId,
    normalizeObservedCandidate(browserSnapshot?.observed)?.targetId,
    visibleCombatLog?.targetId,
    browserSnapshot?.targetId,
    save?.state?.lastEnemyId,
    ...(save?.state?.availableSketches ?? []),
    "duct_taped_banana",
    "rose_window",
    "mobius_strip",
    "transcendent_paragon",
  ];
  for (const candidate of candidates) {
    const resolved = resolveTargetId(candidate) ?? candidate;
    if (resolved && sketches[resolved]) return resolved;
  }
  throw new Error("No available target found for fight fixture capture.");
}

function normalizeVisibleCombatLog(raw, expectedTargetId = null) {
  const source = parseJsonLike(raw) ?? raw;
  const text = extractVisibleCombatLogText(source);
  if (!text) return null;

  const targetName = firstMatch(text, /Enemy:\s*([^\r\n]+)/i)
    ?? firstMatch(text, /^(.+?)\s*\((?:VICTORY|DEFEAT|LOSS|WIN)\)/im);
  const targetId = firstString(source?.targetId, source?.enemyId, targetNameToId(targetName));
  if (expectedTargetId && targetId && targetId !== expectedTargetId) return null;

  const detailIndex = text.search(/Enemy:|Events:|Time:/i);
  const detailText = detailIndex >= 0 ? text.slice(detailIndex) : text;
  const seconds = firstFiniteOrNull(
    source?.seconds,
    source?.durationSeconds,
    source?.elapsedSeconds,
    numberFromMatch(text, /Time:\s*([0-9]+(?:[\.,][0-9]+)?)\s*s?/i),
  );
  const eventCount = firstFiniteOrNull(source?.eventCount, source?.eventsCount, numberFromMatch(text, /Events:\s*([0-9]+)/i));
  const observed = {
    targetId,
    targetName,
    outcome: outcomeFromVisibleCombatLog(detailText),
    seconds,
    approximateSeconds: seconds,
    eventCount,
    reason: "Visible Combat Log modal snapshot.",
    raw: {
      source: "visible_combat_log",
      text: text.slice(0, 20000),
    },
  };

  const hasUsefulData = observed.outcome !== "unknown"
    || observed.seconds != null
    || observed.eventCount != null
    || observed.targetName != null;
  return hasUsefulData ? observed : null;
}

function extractVisibleCombatLogText(raw) {
  const source = parseJsonLike(raw) ?? raw;
  const text = typeof source === "string"
    ? source
    : firstString(source?.text, source?.innerText, source?.content);
  return text ? text.replace(/\r\n/g, "\n").trim() : null;
}

function outcomeFromVisibleCombatLog(text) {
  const value = String(text ?? "");
  if (/\btimeout\b|\bstall\b/i.test(value)) return "timeout";
  if (/\bvictory\b|\bwin\b|\bsuccess\b/i.test(value)) return "win";
  if (/\bdefeat\b|\bloss\b|\blost\b|\bfailed\b|\bfail\b/i.test(value)) return "loss";
  return "unknown";
}

function targetNameToId(name) {
  if (!name) return null;
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || null;
}

function decodeCompanionSave(saveText) {
  const text = String(saveText ?? "").trim();
  if (!text) throw new Error("Save export is empty.");
  try {
    return decodeSaveText(text);
  } catch {
    return JSON.parse(text);
  }
}

function fixtureFilename({ targetId, saveVersion, source }) {
  const date = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `rejected-draft-fight-fixture-${safeName(targetId)}-S${saveVersion ?? "unknown"}-${safeName(source)}-${date}.json`;
}

function normalizeOutcome(raw) {
  if (raw.winner != null) {
    const winner = String(raw.winner).toLowerCase();
    if (winner === "player" || winner === "attacker") return "win";
    if (winner === "enemy" || winner === "target" || winner === "defender") return "loss";
    if (winner === "timeout") return "timeout";
  }
  if (raw.won === true || raw.playerWon === true || raw.victory === true) return "win";
  if (raw.won === false || raw.playerWon === false || raw.loss === true || raw.defeat === true) return "loss";
  const text = String(raw.outcome ?? raw.result ?? raw.status ?? "").toLowerCase();
  if (/timeout|stall/.test(text)) return "timeout";
  if (/win|victory|success|clear|player/.test(text)) return "win";
  if (/loss|lose|lost|death|defeat|enemy|player_hp_zero|fail/.test(text)) return "loss";
  return "unknown";
}

function parseJsonLike(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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

function firstMatch(text, pattern) {
  const match = String(text ?? "").match(pattern);
  return firstString(match?.[1]);
}

function numberFromMatch(text, pattern) {
  const value = firstMatch(text, pattern);
  if (!value) return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function approximateSecondsBetween(beforeEntry, afterEntry) {
  const beforeTime = Date.parse(beforeEntry?.capturedAt ?? "");
  const afterTime = Date.parse(afterEntry?.capturedAt ?? "");
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime) || afterTime < beforeTime) return null;
  return (afterTime - beforeTime) / 1000;
}

function uniqueStrings(values) {
  return [...new Set(values
    .filter((value) => value != null)
    .map((value) => String(value))
    .filter((value) => value.trim()))];
}

function saveHistoryFingerprint(entry) {
  return firstString(entry?.saveText, entry?.value, entry?.raw, entry?.capturedAt) ?? "";
}

function safeName(value) {
  return String(value ?? "unknown").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "unknown";
}
