import fs from "node:fs";
import path from "node:path";

const DEFAULT_GENERATED_AT = () => new Date().toISOString();
const DEFAULT_SIMULATOR_PATHS = [
  path.join("src", "combat.js"),
  path.join("src", "combat", "statuses.js"),
  path.join("src", "combat", "math.js"),
  path.join("src", "combat", "timing.js"),
  path.join("src", "combat", "vulnerability.js"),
];

export function buildCombatParityMap({
  referenceMarkdown = "",
  simulatorSources = [],
  generatedAt = DEFAULT_GENERATED_AT(),
} = {}) {
  const sources = normalizeSources(simulatorSources);
  const combinedSource = sources.map((source) => source.source).join("\n");
  const combatSource = findSource(sources, "combat.js") ?? combinedSource;
  const statusSource = findSource(sources, path.join("combat", "statuses.js")) ?? combinedSource;
  const performAttackSource = extractFunctionWindow(combatSource, "performAttack") ?? combatSource;
  const mitigationSource = extractFunctionWindow(combatSource, "applyDefensiveMitigation") ?? combatSource;
  const damageToSideSource = extractFunctionWindow(combatSource, "applyDamageToSide") ?? combatSource;
  const skipTurnSource = extractFunctionWindow(statusSource, "shouldSkipTurn") ?? statusSource;

  const context = {
    referenceMarkdown,
    sources,
    combinedSource,
    combatSource,
    statusSource,
    performAttackSource,
    mitigationSource,
    damageToSideSource,
    skipTurnSource,
  };

  const checks = [
    statusCapsCheck(context),
    remedyOrderCheck(context),
    electrocuteOrderCheck(context),
    curseReflectionCheck(context),
    hotPotatoMultistrikeCheck(context),
    hypnotizeSelfAttackCheck(context),
    energyWaveTurnEffectCheck(context),
    lifestealOrderCheck(context),
    varnishSurvivalCheck(context),
    counterDelayedEffectCheck(context),
  ];

  return {
    version: parseReferenceVersion(referenceMarkdown),
    generatedAt,
    sourcePaths: sources.map((source) => source.path),
    summary: summarizeChecks(checks),
    checks,
  };
}

export function renderCombatParityMapMarkdown(map) {
  const lines = [];
  lines.push("# Combat Engine Parity Map");
  lines.push("");
  lines.push("Generated comparison between the current game combat reference and the local simulator combat engine. This is a Priority 26 working document: matched items are evidence-based, while gaps are implementation targets.");
  lines.push("");
  lines.push("## Version");
  lines.push("");
  lines.push(`- Main asset: ${formatValue(map.version?.mainAsset)}`);
  lines.push(`- Store asset: ${formatValue(map.version?.storeAsset)}`);
  lines.push(`- Captured: ${formatValue(map.version?.captured)}`);
  lines.push(`- Generated: ${formatValue(map.generatedAt)}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Matched: ${map.summary.statusCounts.matched ?? 0}`);
  lines.push(`- Gaps: ${map.summary.statusCounts.gap ?? 0}`);
  lines.push(`- Partial: ${map.summary.statusCounts.partial ?? 0}`);
  lines.push(`- Needs real fight: ${map.summary.statusCounts["needs-real-fight"] ?? 0}`);
  lines.push("");
  lines.push("| Check | Status | Severity | Simulator evidence | Next action |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const check of map.checks) {
    lines.push(`| ${escapeTable(check.title)} | ${escapeTable(check.status)} | ${escapeTable(check.severity)} | ${escapeTable(check.simulatorEvidence)} | ${escapeTable(check.nextAction)} |`);
  }
  lines.push("");
  lines.push("## Details");
  lines.push("");
  for (const check of map.checks) {
    lines.push(`### ${check.title}`);
    lines.push("");
    lines.push(`- ID: \`${check.id}\``);
    lines.push(`- Status: ${check.status}`);
    lines.push(`- Severity: ${check.severity}`);
    lines.push(`- Confidence: ${check.confidence}`);
    lines.push(`- Game reference: ${check.gameReference}`);
    lines.push(`- Simulator evidence: ${check.simulatorEvidence}`);
    lines.push(`- Next action: ${check.nextAction}`);
    if (check.details) lines.push(`- Detail: ${check.details}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export async function writeCombatParityMapDocument({
  referencePath = path.join("docs", "combat-engine-reference.md"),
  simulatorPaths = DEFAULT_SIMULATOR_PATHS,
  outputPath = path.join("docs", "combat-engine-parity-map.md"),
  now = DEFAULT_GENERATED_AT,
} = {}) {
  const referenceMarkdown = fs.existsSync(referencePath) ? fs.readFileSync(referencePath, "utf8") : "";
  const simulatorSources = simulatorPaths
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      path: filePath,
      source: fs.readFileSync(filePath, "utf8"),
    }));
  const map = buildCombatParityMap({
    referenceMarkdown,
    simulatorSources,
    generatedAt: typeof now === "function" ? now() : now,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderCombatParityMapMarkdown(map));
  return {
    outputPath,
    map,
  };
}

function statusCapsCheck({ statusSource }) {
  const requiredCaps = [
    ["Haste", 1000],
    ["EnergyWave", 1000],
    ["Leap", 1000],
    ["Inspiration", 100],
    ["BlackFlame", 99],
    ["Hinder", 1000],
    ["Hypnotize", 1000],
    ["BananaPeel", 1000],
  ];
  const missing = requiredCaps.filter(([status, cap]) => !new RegExp(`${status}\\s*:\\s*${cap}\\b`).test(statusSource));
  return createCheck({
    id: "status-caps",
    title: "Status caps",
    status: missing.length === 0 ? "matched" : "gap",
    severity: missing.length === 0 ? "low" : "high",
    confidence: "high",
    gameReference: "The bundle status-cap block defines Haste, EnergyWave, Leap, Inspiration, BlackFlame and skip-status caps.",
    simulatorEvidence: missing.length === 0
      ? "STATUS_CAPS contains the visible bundle caps."
      : `Missing cap evidence for ${missing.map(([status]) => status).join(", ")}.`,
    nextAction: missing.length === 0
      ? "Keep caps covered by tests when status handling changes."
      : "Align STATUS_CAPS with the extracted bundle caps.",
  });
}

function remedyOrderCheck({ performAttackSource }) {
  const inOrder = tokensAppearInOrder(performAttackSource, ["applyRemedy", "shouldSkipTurn"]);
  return createCheck({
    id: "remedy-turn-order",
    title: "Remedy and skip-status order",
    status: inOrder ? "matched" : "gap",
    severity: inOrder ? "low" : "high",
    confidence: "high",
    gameReference: "Attack resolution applies Remedy before Hinder, BananaPeel and Hypnotize can skip or redirect the turn.",
    simulatorEvidence: inOrder
      ? "`performAttack` calls `applyRemedy` before `shouldSkipTurn`."
      : "`performAttack` does not show Remedy before skip-status resolution.",
    nextAction: inOrder
      ? "Keep order locked with parity tests."
      : "Move Remedy before skip-status handling.",
  });
}

function electrocuteOrderCheck({ performAttackSource, mitigationSource }) {
  const mitigationHasFrailtyBrittle = mitigationSource.includes("defenderStatuses.Frailty")
    && mitigationSource.includes("defenderStatuses.Brittle");
  const mitigationIndex = performAttackSource.indexOf("applyDefensiveMitigation");
  const electrocuteAfterMitigation = mitigationIndex >= 0
    && /\.Electrocute\b/.test(performAttackSource.slice(mitigationIndex));
  const hasDirectStatusModifiers = performAttackSource.includes("applyDirectStatusDamageModifiers");
  const gap = mitigationHasFrailtyBrittle && electrocuteAfterMitigation;
  return createCheck({
    id: "electrocute-frailty-brittle-order",
    title: "Electrocute before Frailty and Brittle",
    status: gap ? "gap" : "matched",
    severity: gap ? "high" : "medium",
    confidence: "high",
    gameReference: "Direct damage resolves Armor/Absorb, then Electrocute, then adds Frailty and Brittle to the direct damage event.",
    simulatorEvidence: gap
      ? "`applyDefensiveMitigation` applies Frailty/Brittle before `performAttack` adds Electrocute."
      : hasDirectStatusModifiers
        ? "`performAttack` applies Electrocute before `applyDirectStatusDamageModifiers` handles Frailty/Brittle."
        : "Simulator evidence does not show Frailty/Brittle before Electrocute.",
    nextAction: gap
      ? "Split Frailty and Brittle out of mitigation so Electrocute is calculated from post-mitigation direct damage first."
      : "Keep the numeric trace fixture that locks this order.",
  });
}

function curseReflectionCheck({ mitigationSource, performAttackSource }) {
  const directCurse = mitigationSource.includes("defenderStatuses.Curse") || mitigationSource.includes("trace.curse");
  const hasReflection = /Curse Reflection|curse_reflection|type:\s*["']curse["']/.test(performAttackSource)
    && tokensAppearInOrder(performAttackSource, ["Bleed", "Curse", "lifesteal"]);
  return createCheck({
    id: "curse-reflection",
    title: "Curse reflection",
    status: directCurse && !hasReflection ? "gap" : "matched",
    severity: directCurse && !hasReflection ? "critical" : "medium",
    confidence: "high",
    gameReference: "The bundle applies Curse near the end of the attacker turn as reflection based on attack, after Bleed recoil and before Lifesteal.",
    simulatorEvidence: directCurse
      ? "Simulator currently treats Curse as a direct damage multiplier in mitigation."
      : hasReflection
        ? "Simulator resolves `curse_reflection` outside direct-hit mitigation."
        : "Simulator does not expose Curse in direct mitigation.",
    nextAction: directCurse && !hasReflection
      ? "Move Curse out of direct-hit mitigation and implement end-of-turn Curse reflection."
      : "Verify Curse numbers against a traced real fight.",
  });
}

function hotPotatoMultistrikeCheck({ performAttackSource }) {
  const hotBeforeMulti = tokensAppearInOrder(performAttackSource, [
    "applyHotPotatoBeforeAttack",
    "rollMultistrikeHitCount",
  ]);
  return createCheck({
    id: "hot-potato-multistrike-order",
    title: "Hot Potato vs Multistrike order",
    status: hotBeforeMulti ? "gap" : "matched",
    severity: hotBeforeMulti ? "high" : "medium",
    confidence: "high",
    gameReference: "The bundle resolves MultiStrike count before the HotPotato branch, then loops over direct hits.",
    simulatorEvidence: hotBeforeMulti
      ? "`performAttack` runs `applyHotPotatoBeforeAttack` before `rollMultistrikeHitCount`."
      : "Simulator shows MultiStrike before the Hot Potato branch.",
    nextAction: hotBeforeMulti
      ? "Move Hot Potato branch resolution after Multistrike count without changing the branch probabilities."
      : "Keep RNG-order coverage for Multistrike and Hot Potato.",
  });
}

function hypnotizeSelfAttackCheck({ skipTurnSource, performAttackSource }) {
  const rawAttackDamage = skipTurnSource.includes("Hypnotize") && skipTurnSource.includes("stat(attacker, \"attack\")");
  const swapsCombatants = performAttackSource.includes("hypnotize") && performAttackSource.includes("attackerSide") && performAttackSource.includes("defenderSide");
  return createCheck({
    id: "hypnotize-self-attack",
    title: "Hypnotize self attack",
    status: rawAttackDamage && !swapsCombatants ? "gap" : "matched",
    severity: rawAttackDamage && !swapsCombatants ? "critical" : "medium",
    confidence: "high",
    gameReference: "Hypnotize redirects the turn into a full self attack path by swapping attacker and defender context, not by applying raw attack once.",
    simulatorEvidence: rawAttackDamage
      ? "`shouldSkipTurn` deletes Hypnotize and returns raw attacker attack as self damage."
      : "Simulator does not use the raw-attack shortcut for Hypnotize.",
    nextAction: rawAttackDamage && !swapsCombatants
      ? "Replace Hypnotize skip damage with a self-targeted normal attack path using the same hit resolver."
      : "Keep the mitigated self-attack regression test and add real-fight confirmation when available.",
  });
}

function energyWaveTurnEffectCheck({ performAttackSource, combinedSource }) {
  const immediateHitDamage = performAttackSource.includes("energyWaveDamage");
  const hasTickModel = combinedSource.includes("applyEnergyWaveTick");
  const grantsStacks = performAttackSource.includes("EnergyWave") && performAttackSource.includes("energyWaveChance");
  const status = immediateHitDamage || !hasTickModel ? "gap" : "matched";
  return createCheck({
    id: "energy-wave-turn-effect",
    title: "Energy Wave turn effect",
    status,
    severity: status === "matched" ? "low" : "medium",
    confidence: "high",
    gameReference: "The bundle attack resolver grants EnergyWave stacks during the self-buff phase; damage is emitted by the periodic consumption block, not by the hit resolver.",
    simulatorEvidence: immediateHitDamage
      ? "`performAttack` still applies immediate `energyWaveDamage`, which double-counts the tick model."
      : hasTickModel
        ? `Simulator uses a tick model and no immediate hit damage was detected${grantsStacks ? " after stack grants" : ""}.`
        : "No Energy Wave damage model was detected.",
    nextAction: status === "matched"
      ? "Confirm the exact periodic tick cadence against a real fight fixture."
      : "Remove immediate on-hit EnergyWave damage and keep periodic stack consumption as the only damage path.",
  });
}

function lifestealOrderCheck({ performAttackSource }) {
  const lifestealBeforeBleed = tokensAppearInOrder(performAttackSource, ["const lifesteal", "const bleedStacks"]);
  const bleedBeforeCurseBeforeLifesteal = tokensAppearInOrder(performAttackSource, ["Bleed", "Curse", "lifesteal"]);
  return createCheck({
    id: "lifesteal-turn-order",
    title: "Bleed, Curse and Lifesteal order",
    status: lifestealBeforeBleed && !bleedBeforeCurseBeforeLifesteal ? "gap" : "matched",
    severity: lifestealBeforeBleed ? "high" : "medium",
    confidence: "high",
    gameReference: "The bundle applies Bleed recoil, then Curse reflection, then Lifesteal at the end of the turn.",
    simulatorEvidence: lifestealBeforeBleed
      ? "`performAttack` heals Lifesteal before applying Bleed recoil and has no Curse reflection block."
      : bleedBeforeCurseBeforeLifesteal
        ? "Simulator applies Bleed recoil, then Curse reflection, then Lifesteal."
        : "Simulator evidence does not show Lifesteal before Bleed recoil.",
    nextAction: lifestealBeforeBleed
      ? "Move Lifesteal after Bleed recoil and new Curse reflection."
      : "Keep end-of-turn ordering covered by regression tests.",
  });
}

function varnishSurvivalCheck({ damageToSideSource }) {
  const hasTriggerPenalty = damageToSideSource.includes("stat(combatant, \"varnish\") - triggersBefore");
  const hasRestore = damageToSideSource.includes("50 - (statuses.VarnishTriggers - 1)")
    || damageToSideSource.includes("50 - triggersBefore");
  return createCheck({
    id: "varnish-survival",
    title: "Varnish survival",
    status: hasTriggerPenalty && hasRestore ? "matched" : "gap",
    severity: hasTriggerPenalty && hasRestore ? "low" : "high",
    confidence: "high",
    gameReference: "Varnish checks chance minus previous triggers and restores max HP times max(0, 50 - previous triggers) percent.",
    simulatorEvidence: hasTriggerPenalty && hasRestore
      ? "`applyDamageToSide` uses `VarnishTriggers` for both chance penalty and restore percent."
      : "Varnish trigger penalty or restore-percent evidence is missing.",
    nextAction: hasTriggerPenalty && hasRestore
      ? "Keep Varnish fixtures around lethal direct and status damage."
      : "Align Varnish chance and restore math with the extracted `Zt` helper.",
  });
}

function counterDelayedEffectCheck({ combatSource, combinedSource }) {
  const counterEffectSource = extractFunctionWindow(combatSource, "performCounterEffect") ?? combinedSource;
  const hasPendingQueue = combinedSource.includes("pendingEffects");
  const hasDelayConstant = combinedSource.includes("COUNTER_DELAY_SECONDS");
  const schedulesCounter = combinedSource.includes("combat.pendingEffects.push")
    && combinedSource.includes("counter_scheduled");
  const processesCounter = combinedSource.includes("processPendingEffect")
    && combinedSource.includes("performCounterEffect");
  const usesDirectPipeline = tokensAppearInOrder(counterEffectSource, [
    "baseAttackDamage",
    "applyOffensiveMultipliers",
    "resolveEvasion",
    "applyDefensiveMitigation",
    "applyDamageToSide",
  ]);
  const matched = hasPendingQueue && hasDelayConstant && schedulesCounter && processesCounter && usesDirectPipeline;

  return createCheck({
    id: "counter-delayed-effect",
    title: "Delayed Counter effect",
    status: matched ? "matched" : "gap",
    severity: matched ? "low" : "high",
    confidence: "high",
    gameReference: "The bundle schedules Counter in `pendingCombatEffects` about 200ms after the triggering hit, then resolves it through the direct hit pipeline.",
    simulatorEvidence: matched
      ? "Simulator uses a pending effect queue, `COUNTER_DELAY_SECONDS`, `counter_scheduled` trace entries and `performCounterEffect` through the direct damage pipeline."
      : "Simulator evidence is missing a pending effect queue, delayed scheduling or direct-pipeline Counter resolution.",
    nextAction: matched
      ? "Confirm counter timing against a real fight fixture and check chained counter edge cases."
      : "Replace immediate Counter damage with a delayed pending effect that resolves through the direct damage pipeline.",
    details: matched
      ? "Counter is now observable as a scheduled attack event followed by a `pending_effect` trace event."
      : "",
  });
}

function createCheck(check) {
  return {
    details: "",
    ...check,
  };
}

function summarizeChecks(checks) {
  const statusCounts = {};
  const severityCounts = {};
  for (const check of checks) {
    statusCounts[check.status] = (statusCounts[check.status] ?? 0) + 1;
    severityCounts[check.severity] = (severityCounts[check.severity] ?? 0) + 1;
  }
  return {
    total: checks.length,
    statusCounts,
    severityCounts,
  };
}

function normalizeSources(input) {
  if (Array.isArray(input)) {
    return input
      .filter((source) => source && typeof source.source === "string")
      .map((source) => ({ path: source.path ?? source.name ?? "unknown", source: source.source }));
  }
  if (input && typeof input === "object") {
    return Object.entries(input)
      .filter(([, source]) => typeof source === "string")
      .map(([sourcePath, source]) => ({ path: sourcePath, source }));
  }
  return [];
}

function findSource(sources, suffix) {
  const normalizedSuffix = normalizePath(suffix);
  return sources.find((source) => normalizePath(source.path).endsWith(normalizedSuffix))?.source ?? null;
}

function normalizePath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

function tokensAppearInOrder(source, tokens) {
  let cursor = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    if (index < 0) return false;
    cursor = index + token.length;
  }
  return true;
}

function extractFunctionWindow(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = findFunctionBodyOpen(source, start + marker.length);
  if (open < 0) return null;
  const close = findMatchingBrace(source, open);
  if (close < 0) return null;
  return source.slice(start, close + 1);
}

function findFunctionBodyOpen(source, startIndex) {
  const paramsClose = findParameterListClose(source, startIndex);
  if (paramsClose < 0) return source.indexOf("{", startIndex);
  return source.indexOf("{", paramsClose);
}

function findParameterListClose(source, startIndex) {
  const open = source.indexOf("(", startIndex);
  if (open < 0) return -1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseReferenceVersion(markdown) {
  return {
    mainAsset: parseBullet(markdown, "Main asset"),
    storeAsset: parseBullet(markdown, "Store asset"),
    captured: parseBullet(markdown, "Captured"),
  };
}

function parseBullet(markdown, label) {
  const match = new RegExp(`- ${escapeRegExp(label)}:\\s*([^\\n]+)`).exec(markdown);
  if (!match) return null;
  return match[1].replaceAll("`", "").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function formatValue(value) {
  return value === null || value === undefined || value === "" ? "unknown" : String(value);
}
