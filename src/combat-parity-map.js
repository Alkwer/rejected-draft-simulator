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
  const combatSource = findSource(sources, "combat.js") ?? "";
  const statusSource = findSource(sources, path.join("combat", "statuses.js")) ?? "";
  const timingSource = findSource(sources, path.join("combat", "timing.js")) ?? "";
  const performAttackSource = extractFunctionWindow(combatSource, "performAttack") ?? "";
  const mitigationSource = extractFunctionWindow(combatSource, "applyDefensiveMitigation") ?? "";
  const damageToSideSource = extractFunctionWindow(combatSource, "applyDamageToSide") ?? "";
  const skipTurnSource = extractFunctionWindow(statusSource, "shouldSkipTurn") ?? "";
  const referenceSections = parseReferenceSections(referenceMarkdown);

  const context = {
    combatSource,
    statusSource,
    timingSource,
    performAttackSource,
    mitigationSource,
    damageToSideSource,
    skipTurnSource,
  };

  const checks = [
    [statusCapsCheck(context), ["Status Caps And Sets"]],
    [remedyOrderCheck(context), ["Attack Resolution"]],
    [electrocuteOrderCheck(context), ["Damage Resolution"]],
    [curseReflectionCheck(context), ["Attack Resolution"]],
    [hotPotatoMultistrikeCheck(context), ["Attack Resolution"]],
    [hypnotizeSelfAttackCheck(context), ["Attack Resolution"]],
    [energyWaveTurnEffectCheck(context), ["Attack Resolution", "Status Tick Resolution"]],
    [lifestealOrderCheck(context), ["Attack Resolution"]],
    [varnishSurvivalCheck(context), ["Varnish Survival"]],
    [counterDelayedEffectCheck(context), ["Attack Resolution", "Combat Loop Timing"]],
    [tickCadenceCheck(context), ["Combat Loop Timing"]],
    [inspirationTickCheck(context), ["Status Tick Resolution"]],
    [periodicStatusOrderCheck(context), ["Status Tick Resolution"]],
    [bananaSlipCheck(context), ["Attack Resolution", "Combat Loop Timing"]],
  ].map(([check, sections]) => checkAgainstReference(check, sections, referenceSections));

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
  lines.push("Static checks against the reference assets listed below. Each match covers its named code path for that edition.");
  lines.push("");
  lines.push("## Version");
  lines.push("");
  lines.push(`- Edition: ${formatValue(map.version?.edition)}`);
  lines.push(`- Save version: ${formatValue(map.version?.saveVersion)}`);
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
  lines.push(`- Unverified: ${map.summary.statusCounts.unverified ?? 0}`);
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
  const caps = /\bconst STATUS_CAPS\s*=\s*\{([^}]+)\}/.exec(statusSource)?.[1] ?? "";
  const missing = requiredCaps.filter(([status, cap]) => !new RegExp(`\\b${status}\\s*:\\s*${cap}\\b`).test(caps));
  return createCheck({
    id: "status-caps",
    title: "Base status cap constants",
    status: missing.length === 0 ? "matched" : "gap",
    severity: missing.length === 0 ? "low" : "high",
    confidence: "high",
    gameReference: "The bundle status-cap block defines Haste, EnergyWave, Leap, Inspiration, BlackFlame and skip-status caps.",
    simulatorEvidence: missing.length === 0
      ? "STATUS_CAPS contains the base constants used for web player buffs and capped debuffs."
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
  const matched = !mitigationHasFrailtyBrittle && Boolean(mitigationSource) && tokensAppearInOrder(
    performAttackSource, ["applyDefensiveMitigation(", ".Electrocute", "applyDirectStatusDamageModifiers("],
  );
  return createCheck({
    id: "electrocute-frailty-brittle-order",
    title: "Electrocute before Frailty and Brittle",
    status: matched ? "matched" : "gap",
    severity: matched ? "medium" : "high",
    confidence: "high",
    gameReference: "Direct damage resolves Armor/Absorb, then Electrocute, then adds Frailty and Brittle to the direct damage event.",
    simulatorEvidence: matched
      ? "`performAttack` applies Electrocute before `applyDirectStatusDamageModifiers` handles Frailty/Brittle."
      : "The mitigation, Electrocute and direct-status sequence could not be established.",
    nextAction: matched
      ? "Keep the numeric trace fixture that locks this order."
      : "Check that Electrocute uses post-mitigation damage before Frailty and Brittle.",
  });
}

function curseReflectionCheck({ mitigationSource, performAttackSource }) {
  const directCurse = mitigationSource.includes("defenderStatuses.Curse") || mitigationSource.includes("trace.curse");
  const hasReflection = tokensAppearInOrder(performAttackSource, ["const bleedStacks", "const curseStacks", "curse_reflection", "const lifesteal"]);
  const matched = !directCurse && Boolean(mitigationSource) && hasReflection;
  return createCheck({
    id: "curse-reflection",
    title: "Curse reflection",
    status: matched ? "matched" : "gap",
    severity: matched ? "medium" : "critical",
    confidence: "high",
    gameReference: "The bundle applies Curse near the end of the attacker turn as reflection based on attack, after Bleed recoil and before Lifesteal.",
    simulatorEvidence: directCurse
      ? "Simulator currently treats Curse as a direct damage multiplier in mitigation."
      : hasReflection
        ? "Simulator resolves `curse_reflection` outside direct-hit mitigation."
        : "No end-of-turn Curse reflection was detected.",
    nextAction: matched
      ? "Verify Curse numbers against a traced real fight."
      : "Move Curse out of direct-hit mitigation and implement end-of-turn Curse reflection.",
  });
}

function hotPotatoMultistrikeCheck({ performAttackSource }) {
  const matched = tokensAppearInOrder(performAttackSource, [
    "rollMultistrikeHitCount(",
    "applyHotPotatoBeforeAttack(",
  ]);
  return createCheck({
    id: "hot-potato-multistrike-order",
    title: "Hot Potato vs Multistrike order",
    status: matched ? "matched" : "gap",
    severity: matched ? "medium" : "high",
    confidence: "high",
    gameReference: "The bundle resolves MultiStrike count before the HotPotato branch, then loops over direct hits.",
    simulatorEvidence: matched
      ? "Simulator shows MultiStrike before the Hot Potato branch."
      : "The expected Multistrike and Hot Potato call order was not detected.",
    nextAction: matched
      ? "Keep RNG-order coverage for Multistrike and Hot Potato."
      : "Check the Multistrike and Hot Potato sequence in `performAttack`.",
  });
}

function hypnotizeSelfAttackCheck({ skipTurnSource, performAttackSource }) {
  const rawAttackDamage = skipTurnSource.includes("Hypnotize") && skipTurnSource.includes("stat(attacker, \"attack\")");
  const swapsCombatants = tokensAppearInOrder(performAttackSource, ["resolveHypnotize(", "hypnotize.redirected", "targetSide = attackerSide"]);
  const matched = !rawAttackDamage && Boolean(skipTurnSource) && swapsCombatants;
  return createCheck({
    id: "hypnotize-self-attack",
    title: "Hypnotize self attack",
    status: matched ? "matched" : "gap",
    severity: matched ? "medium" : "critical",
    confidence: "high",
    gameReference: "Hypnotize redirects the turn into a full self attack path by swapping attacker and defender context, not by applying raw attack once.",
    simulatorEvidence: rawAttackDamage
      ? "`shouldSkipTurn` deletes Hypnotize and returns raw attacker attack as self damage."
      : matched
        ? "`performAttack` redirects the normal hit path by assigning the attacker as target."
        : "The self-targeted attack branch was not detected.",
    nextAction: matched
      ? "Keep the mitigated self-attack regression test and add real-fight confirmation when available."
      : "Verify that Hypnotize redirects through the normal hit resolver.",
  });
}

function energyWaveTurnEffectCheck({ performAttackSource, combatSource }) {
  const immediateHitDamage = performAttackSource.includes("energyWaveDamage");
  const webTicks = /\bconst WEB_STATUS_TICKS\s*=\s*\[([^\]]+)\]/.exec(combatSource)?.[1] ?? "";
  const tick = extractFunctionWindow(combatSource, "applyStatusTick") ?? "";
  const wave = extractFunctionWindow(combatSource, "applyEnergyWaveTick") ?? "";
  const hasTickModel = tick.includes("for (const tick of WEB_STATUS_TICKS)") && webTicks.includes("applyEnergyWaveTick,")
    && tokensAppearInOrder(
      wave, ["statuses.EnergyWave", "Math.floor(stacks * 0.1)", "applyDamageToSide(", "statuses.EnergyWave -= consumed"],
    );
  const matched = !immediateHitDamage && hasTickModel && performAttackSource.includes("applySelfBuffs(");
  return createCheck({
    id: "energy-wave-turn-effect",
    title: "Energy Wave turn effect",
    status: matched ? "matched" : "gap",
    severity: matched ? "low" : "medium",
    confidence: "high",
    gameReference: "The bundle attack resolver grants EnergyWave stacks during the self-buff phase; damage is emitted by the periodic consumption block, not by the hit resolver.",
    simulatorEvidence: immediateHitDamage
      ? "`performAttack` still applies immediate `energyWaveDamage`, which double-counts the tick model."
      : matched
        ? "Periodic tick damage consumes Energy Wave stacks. The attack path grants self buffs."
        : "The periodic damage and stack consumption path was not established.",
    nextAction: matched
      ? "Confirm the exact periodic tick cadence against a real fight fixture."
      : "Remove immediate on-hit EnergyWave damage and keep periodic stack consumption as the only damage path.",
  });
}

function lifestealOrderCheck({ performAttackSource }) {
  const matched = tokensAppearInOrder(performAttackSource, ["const bleedStacks", "const curseStacks", "const lifesteal"]);
  return createCheck({
    id: "lifesteal-turn-order",
    title: "Bleed, Curse and Lifesteal order",
    status: matched ? "matched" : "gap",
    severity: matched ? "medium" : "high",
    confidence: "high",
    gameReference: "The bundle applies Bleed recoil, then Curse reflection, then Lifesteal at the end of the turn.",
    simulatorEvidence: matched
      ? "Simulator applies Bleed recoil, then Curse reflection, then Lifesteal."
      : "The expected Bleed, Curse and Lifesteal blocks were not detected in order.",
    nextAction: matched
      ? "Keep end-of-turn ordering covered by regression tests."
      : "Verify that Lifesteal follows Bleed recoil and Curse reflection.",
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

function counterDelayedEffectCheck({ combatSource, performAttackSource }) {
  const counterEffectSource = extractFunctionWindow(combatSource, "performCounterEffect") ?? "";
  const scheduler = extractFunctionWindow(combatSource, "scheduleCounter") ?? "";
  const webCounter = extractFunctionWindow(combatSource, "performWebCounter") ?? "";
  const pendingEffectSource = extractFunctionWindow(combatSource, "processPendingEffect") ?? "";
  const schedulesCounter = /\bconst COUNTER_DELAY_SECONDS\s*=\s*0\.2\s*;/.test(combatSource)
    && tokensAppearInOrder(scheduler, [
      "COUNTER_DELAY_SECONDS / combatSpeedAtTime(",
      "combat.pendingEffects.push(",
      "counter_scheduled",
    ]);
  const processesCounter = pendingEffectSource.includes("performCounterEffect(");
  const usesAttackTurn = counterEffectSource.includes("if (!combat.assumptions.steam) return performWebCounter(")
    && tokensAppearInOrder(webCounter, ["performAttack(", "counterEffect: effect"])
    && tokensAppearInOrder(performAttackSource, [
      "applyRemedy(", "shouldSkipTurn(", "rollMultistrikeHitCount(", "applyDamageToSide(", "applyStatuses(",
      "applyThorns(", "applySelfBuffs(", "if (webCounterChance > 0 && !counterEffect)", "scheduleCounter(",
    ]);
  const matched = schedulesCounter && processesCounter && usesAttackTurn;

  return createCheck({
    id: "counter-delayed-effect",
    title: "Delayed Counter scheduling and attack turn",
    status: matched ? "matched" : "gap",
    severity: matched ? "low" : "high",
    confidence: "high",
    gameReference: "The bundle queues Counter 200ms divided by combat speed after the triggering attack and runs the attack resolver with its Counter flag.",
    simulatorEvidence: matched
      ? "The speed-scaled queue dispatches a flagged web attack turn. That turn resolves effects and cannot queue another Counter."
      : "The speed-scaled queue or flagged attack-turn dispatch was not established.",
    nextAction: matched
      ? "Keep the traced Counter, Multistrike and skip checks. Compare dispatch timing with observed web fights."
      : "Check speed-scaled scheduling and the flagged web attack turn.",
  });
}

function tickCadenceCheck({ combatSource }) {
  const matched = [
    ["REGEN", "Regen", "1.001"],
    ["STATUS", "Status", "1.002"],
  ].every(([key, name, seconds]) =>
    combatSource.includes(`const ${key}_TICK_SECONDS = ${seconds};`)
    && combatSource.includes(`next${name}Tick: ${key}_TICK_SECONDS / initialSpeed`)
    && combatSource.includes(`combat.next${name}Tick += ${key}_TICK_SECONDS / initialSpeed`));
  return createCheck({
    id: "periodic-tick-cadence",
    title: "Periodic tick intervals",
    status: matched ? "matched" : "gap",
    severity: "medium",
    confidence: "high",
    gameReference: "The bundle uses 1001ms for regen and 1002ms for status ticks, each divided by combat speed.",
    simulatorEvidence: matched
      ? "The simulator starts and advances the web regen and status deadlines at the extracted intervals."
      : "The expected speed-scaled values or deadline updates were not detected.",
    nextAction: matched
      ? "Compare wall-clock catch-up and simultaneous events with observed web fights."
      : "Check the web regen and status deadlines against the two extracted intervals.",
  });
}

function inspirationTickCheck({ combatSource }) {
  const tick = extractFunctionWindow(combatSource, "applyStatusTick") ?? "";
  const inspiration = extractFunctionWindow(combatSource, "applyInspirationTick") ?? "";
  const buff = extractFunctionWindow(combatSource, "applyCombatBuff") ?? "";
  const webTicks = /\bconst WEB_STATUS_TICKS\s*=\s*\[([^\]]+)\]/.exec(combatSource)?.[1] ?? "";
  const matched = tokensAppearInOrder(tick, [
    "!combat.assumptions.steam",
    "Object.keys(combat.playerStatuses).length === 0",
    "Object.keys(combat.enemyStatuses).length === 0",
    "return;",
    "for (const tick of WEB_STATUS_TICKS)",
  ]) && webTicks.includes("applyInspirationTick,")
    && tokensAppearInOrder(inspiration, ["rollStacks(", "applyCombatBuff(", "capBonus: combat.assumptions.inspirationCapBonus"])
    && tokensAppearInOrder(buff, ['intendedSide === "player" ?', "STATUS_CAPS[status]", "+ capBonus", ": Infinity"]);
  return createCheck({
    id: "inspiration-tick-caps",
    title: "Inspiration tick eligibility and caps",
    status: matched ? "matched" : "gap",
    severity: "medium",
    confidence: "high",
    gameReference: "The web status tick returns when both status maps are empty. It caps player Inspiration at 100 plus the fundamentals bonus and leaves enemy Inspiration uncapped.",
    simulatorEvidence: matched
      ? "The simulator checks for active status maps and applies separate player and enemy cap rules."
      : "The empty-status guard, tick roll or side-specific cap was not detected.",
    nextAction: matched
      ? "Keep the traced empty-status and cap regression test."
      : "Check tick eligibility and cap handling for both sides.",
  });
}

function periodicStatusOrderCheck({ combatSource }) {
  const damageTicks = /\bconst PERIODIC_DAMAGE_TICKS\s*=\s*\[([^\]]+)\]/.exec(combatSource)?.[1] ?? "";
  const webTicks = /\bconst WEB_STATUS_TICKS\s*=\s*\[([^\]]+)\]/.exec(combatSource)?.[1] ?? "";
  const tick = extractFunctionWindow(combatSource, "applyStatusTick") ?? "";
  const matched = combatSource.includes('const COMBAT_SIDES = ["player", "enemy"]')
    && tokensAppearInOrder(damageTicks, ["applyBurnTick", "applyPlagueTick", "applyPoisonTick", "applyBlackFlameTick"])
    && tokensAppearInOrder(webTicks, [
      "...PERIODIC_DAMAGE_TICKS", "applyEnergyWaveTick", "applyInspirationTick", "applyBalloonTick", "applyIrradiateTick",
    ])
    && tokensAppearInOrder(tick, [
      "!combat.assumptions.steam", "for (const tick of WEB_STATUS_TICKS)", "for (const side of COMBAT_SIDES)", "tick(combat, side, rng)",
    ]);
  return createCheck({
    id: "periodic-status-order",
    title: "Periodic status effect order",
    status: matched ? "matched" : "gap",
    severity: "medium",
    confidence: "high",
    gameReference: "The web status tick processes both sides per effect: Burn, Plague, Poison, BlackFlame, EnergyWave, Inspiration, Balloon and Irradiate.",
    simulatorEvidence: matched
      ? "Each web tick effect runs for the player and then the enemy before the next effect."
      : "The archived status effect sequence or side iteration was not detected.",
    nextAction: matched
      ? "Keep the two-sided trace regression and compare lethal interactions with observed web fights."
      : "Check the web status effect sequence and side iteration.",
  });
}

function bananaSlipCheck({ combatSource, timingSource, skipTurnSource }) {
  const fight = extractFunctionWindow(combatSource, "simulateFight") ?? "";
  const delay = extractFunctionWindow(timingSource, "attackDelay") ?? "";
  const matched = tokensAppearInOrder(skipTurnSource, [".BananaPeel", "statuses.BananaSlip = 1"])
    && delay.includes("if (statuses.BananaSlip > 0) delayMs *= 2;")
    && ["player", "enemy"].every((side) => tokensAppearInOrder(fight, [
      `delete combat.${side}Statuses.BananaSlip;`,
      "performAttack(",
      `attackerSide: "${side}"`,
    ]));
  return createCheck({
    id: "banana-slip-delay",
    title: "BananaSlip next attack delay",
    status: matched ? "matched" : "gap",
    severity: "medium",
    confidence: "high",
    gameReference: "BananaPeel skips a turn. BananaSlip doubles the following attack interval and is cleared when that attack is processed.",
    simulatorEvidence: matched
      ? "The delay formula and both attack branches apply and clear BananaSlip."
      : "The web delay formula or turn cleanup could not be established.",
    nextAction: matched
      ? "Keep the traced skip and next attack timestamps covered."
      : "Check BananaSlip handling in the shared attack delay and the web loop.",
  });
}

const REFERENCE_MARKERS = {
  "Status Caps And Sets": ["Haste:", "Inspiration:", "EnergyWave:"],
  "Varnish Survival": ["50-", "varnishTriggered"],
  "Damage Resolution": ["Electrocute", "Frailty", "Brittle"],
  "Attack Resolution": ["remedy", "Hypnotize", "multiStrikeChance", "HotPotato"],
  "Status Tick Resolution": ["EnergyWave", "inspirationChance", "Balloon"],
  "Combat Loop Timing": ["consolidateCombatTick:", "lastRegenTick", "lastStatusTick"],
};

function parseReferenceSections(markdown) {
  const sections = new Set();
  for (const section of markdown.split(/^## /m).slice(1)) {
    const title = section.slice(0, section.indexOf("\n")).trim();
    const snippet = /^\x60\x60\x60js\r?\n([\s\S]*?)^\x60\x60\x60[ \t]*\r?$/m.exec(section)?.[1] ?? "";
    if (REFERENCE_MARKERS[title]?.every((marker) => snippet.includes(marker))) sections.add(title);
  }
  return sections;
}

function checkAgainstReference(check, sections, referenceSections) {
  const missing = sections.filter((section) => !referenceSections.has(section));
  if (missing.length === 0) return check;
  return {
    ...check,
    status: "unverified",
    confidence: "low",
    gameReference: `Missing extracted code for ${missing.join(", ")}.`,
    nextAction: "Extract the required sections from the archived store bundle.",
  };
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
  return sources.find(({ path: sourcePath }) => {
    const normalizedPath = normalizePath(sourcePath);
    return normalizedPath === normalizedSuffix || normalizedPath.endsWith(`/${normalizedSuffix}`);
  })?.source ?? null;
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
  const marker = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(source);
  if (!marker) return null;
  const start = marker.index;
  const open = findFunctionBodyOpen(source, start + marker[0].length - 1);
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
    edition: parseBullet(markdown, "Edition"),
    saveVersion: parseBullet(markdown, "Save version"),
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
