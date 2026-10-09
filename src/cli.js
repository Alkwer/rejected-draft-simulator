#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { analyzeBuildAdvice } from "./build-advisor.js";
import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import {
  checkPatchSanity,
  createCalibrationReport,
  parseCombatLogText,
} from "./calibration.js";
import {
  createCurrentRunReport,
  createRunRecommendation,
  fixedTrialsFromSetting,
  formatNiceNumber,
  parseTrialsSetting,
  resolveSavePath,
  resolveTargetId,
  runCombatSimulation,
} from "./cli-convenience.js";
import { createDiagnosticReport, createModelAssumptionComparisons } from "./diagnostics.js";
import {
  compareFightParityFixture,
  renderFightParityMarkdown,
} from "./fight-parity.js";
import { createFightTrace, exportTraceMarkdown } from "./fight-trace.js";
import {
  estimateFindNewSketchOdds,
  estimateRedrawOdds,
  evaluateCurrentRun,
  formatMinimums,
  parseCandidateSettings,
  parseMinimums,
  recommendTargetedRedrawSettings,
} from "./redraw-planner.js";
import { applySketchRewards, parseIdList } from "./rewards.js";
import { parseRouteSpecs, parseSwapMap } from "./route-options.js";
import { compareRoutes, simulateRoute } from "./route.js";
import { analyzeSave, getStatsBySource } from "./save-analysis.js";
import { readSaveFile } from "./save.js";
import {
  createCombatReport,
  explainTarget,
  exportMarkdownReport,
} from "./report.js";
import { readDataMetadata, readSketchData } from "./sketch-data.js";
import { createStrategyPlan, parseStrategyCurrencyGoals } from "./strategy-planner.js";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.save && !args["list-targets"] && !args["patch-sanity"]) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const dataPath = args.data ?? findDefaultDataPath();
const sketches = readSketchData(dataPath);
const dataMetadata = readDataMetadata(dataPath);

if (args["list-targets"]) {
  const rarity = args.rarity;
  for (const sketch of Object.values(sketches)) {
    if (rarity && sketch.rarity !== rarity) continue;
    console.log(`${sketch.id.padEnd(32)} ${sketch.rarity.padEnd(12)} ${sketch.name}`);
  }
  process.exit(0);
}

if (args["patch-sanity"]) {
  const patchSanity = checkPatchSanity({
    sketches,
    dataMetadata,
    version: args["game-version"] ?? null,
  });
  if (wantsJsonOutput(args)) console.log(JSON.stringify({ patchSanity }, null, 2));
  else printPatchSanity(patchSanity);
  process.exit(patchSanity.ok ? 0 : 2);
}

args.save = resolveSavePath(args.save, { downloadsDir: args["downloads-dir"] });
const targetId = resolveTargetId(args.target);
const save = readSaveFile(args.save);
const analysis = analyzeSave({ save, sketches, targetId, dataMetadata });

if (args["inspect-save"]) {
  if (args.json) console.log(JSON.stringify(analysis, null, 2));
  else printSaveInspection(analysis);
  process.exit(0);
}

const requestedStatsSource = args.stats ?? "auto";
const statSource = requestedStatsSource === "auto"
  ? analysis.stats.recommendedSource
  : requestedStatsSource;
let player = requestedStatsSource === "auto"
  ? analysis.stats.sources[statSource] ?? {}
  : getStatsBySource(save.state, statSource);

const trialsSetting = parseTrialsSetting(args.trials);
const trials = fixedTrialsFromSetting(trialsSetting);
const maxSeconds = Number(args["max-seconds"] ?? 300);
const seed = args.seed ?? `${targetId ?? "calibration"}:${Date.now()}`;
const combatAssumptions = combatAssumptionsFromSave(save);

if (args.calibrate || args["import-combat-logs"]) {
  const externalLogs = args["combat-log"]
    ? parseCombatLogText(fs.readFileSync(args["combat-log"], "utf8"))
    : [];
  const calibration = createCalibrationReport({
    save,
    sketches,
    targetId,
    player,
    externalLogs,
    trials,
    maxSeconds,
    seed,
    dataMetadata,
  });
  if (wantsJsonOutput(args)) console.log(JSON.stringify({ statSource, calibration }, null, 2));
  else printCalibrationReport({ statSource, calibration });
  process.exit(calibration.patchSanity.ok ? 0 : 2);
}

if (args["current-run"] || args.remaining || args.recommend && !args["build-advice"]) {
  const currentRun = createCurrentRunReport({
    sketches,
    state: save.state,
    baseStats: player,
    trialsSetting,
    maxSeconds,
    seed,
    includeHidden: Boolean(args["include-hidden"]),
    assumptions: combatAssumptions,
  });
  const recommendation = createRunRecommendation({ currentRun, targetId });

  if (wantsJsonOutput(args)) {
    console.log(JSON.stringify({
      statSource,
      requestedStatsSource,
      statsReason: analysis.stats.reason,
      saveWarnings: analysis.warnings,
      targetId,
      currentRun,
      recommendation,
    }, null, 2));
  } else if (args.remaining) {
    printRemainingTargets({ currentRun, statSource, warnings: analysis.warnings });
  } else if (args.recommend) {
    printRunRecommendation({ currentRun, recommendation, statSource, targetId, warnings: analysis.warnings });
  } else {
    printCurrentRunReport({ currentRun, recommendation, statSource, targetId, warnings: analysis.warnings });
  }
  process.exit(0);
}

const target = sketches[targetId];
if (!target) {
  console.error(`Unknown target sketch: ${targetId}`);
  console.error("Use --list-targets --rarity masterpiece to see ids.");
  process.exit(1);
}

if (args.explain) {
  const explanation = explainTarget({ target, player });
  if (wantsJsonOutput(args)) console.log(JSON.stringify({ target: targetSummary(target), statSource, explanation }, null, 2));
  else printTargetExplanation({ target, statSource, explanation });
  process.exit(0);
}

if (args["build-advice"]) {
  const advice = analyzeBuildAdvice({
    sketches,
    state: save.state,
    targetId,
    baseStats: player,
  });

  if (wantsJsonOutput(args)) console.log(JSON.stringify({ target: targetSummary(target), statSource, advice }, null, 2));
  else printBuildAdvice({ target, statSource, advice });
  process.exit(0);
}

if (args["strategy-plan"] || args.strategy) {
  const strategyTrials = Math.max(1, Math.floor(Number(args["strategy-trials"] ?? Math.min(trials, 1000)) || 1000));
  const strategyTrialsSetting = parseTrialsSetting(strategyTrials);
  const strategyCurrentRun = createCurrentRunReport({
    sketches,
    state: save.state,
    baseStats: player,
    trialsSetting: strategyTrialsSetting,
    maxSeconds,
    seed: `${seed}:strategy-current-run`,
    includeHidden: Boolean(args["include-hidden"]),
    assumptions: combatAssumptions,
  });
  const strategyTargetSimulation = runCombatSimulation({
    player,
    enemy: {
      id: target.id,
      name: target.name,
      ...target.stats,
      immunities: target.immunities,
      vulnerability: target.vulnerability,
    },
    trialsSetting: strategyTrialsSetting,
    maxSeconds,
    seed: `${seed}:strategy-target`,
    assumptions: combatAssumptions,
  });
  const strategicPlan = createStrategyPlan({
    sketches,
    state: save.state,
    targetId,
    baseStats: player,
    targetSimulation: strategyTargetSimulation,
    currentRun: strategyCurrentRun,
    goalQuintessence: args["goal-q"] ?? args["goal-quintessence"] ?? null,
    goalCurrencies: parseStrategyCurrencyGoals(args["goal-currency"]),
    targetWinRate: args["target-win-rate"] == null ? null : Number(args["target-win-rate"]),
    softcapSeconds: args["softcap-seconds"] == null ? null : Number(args["softcap-seconds"]),
    maxSoftcapWaitSeconds: Number(args["max-softcap-wait"] ?? 1800),
    farmSeconds: Number(args["farm-seconds"] ?? 3600),
    boosterCandidates: args["booster-candidates"] ? parseRouteSpecs(args["booster-candidates"]) : [],
    masterpieceTargetIds: parseIdList(args["masterpiece-targets"]),
    strategyProfile: args["strategy-profile"] ?? args.profile,
    strategyMode: args["strategy-mode"] ?? args.mode,
    compareProfiles: parseIdList(args["compare-profiles"]),
    trials: strategyTrials,
    maxSeconds,
    seed,
  });

  if (wantsJsonOutput(args)) console.log(JSON.stringify({ target: targetSummary(target), statSource, strategicPlan }, null, 2));
  else printStrategyPlan({ target, statSource, strategicPlan });
  process.exit(0);
}

if (args["plan-redraw"]) {
  const redrawPlan = createRedrawPlan({
    sketches,
    save,
    targetId,
    args,
    trials,
    seed,
  });

  if (wantsJsonOutput(args)) console.log(JSON.stringify({ target: targetSummary(target), redrawPlan }, null, 2));
  else printRedrawPlan({ target, redrawPlan });
  process.exit(0);
}

if (args["compare-routes"] || args.compare) {
  const compareSpec = args["compare-routes"] ?? args.compare;
  if (compareSpec === true) {
    console.error("Missing compare spec. Example: --compare \"empty:~farm:vinchy,mariline\"");
    process.exit(1);
  }
  const comparison = compareRoutes({
    sketches,
    state: save.state,
    baseStats: player,
    targetId,
    routes: parseRouteSpecs(compareSpec),
    trials,
    maxSeconds,
    seed,
    ...routeOptionsFromArgs(args),
  });

  if (wantsJsonOutput(args)) console.log(JSON.stringify({ target: targetSummary(target), statSource, comparison }, null, 2));
  else printRouteComparison({ target, statSource, comparison });
  process.exit(0);
}

if (args.route) {
  const routeResult = simulateRoute({
    sketches,
    state: save.state,
    baseStats: player,
    targetId,
    routeIds: parseIdList(args.route),
    trials,
    maxSeconds,
    seed,
    ...routeOptionsFromArgs(args),
  });
  const routeReport = routeResult.target?.simulation
    ? createCombatReport({
      target,
      player: routeResult.finalStats,
      simulation: routeResult.target.simulation,
      label: `Route: ${routeResult.routeIds.join(", ") || "empty"}`,
    })
    : null;

  if (wantsMarkdownOutput(args) && routeReport) {
    console.log(exportMarkdownReport(routeReport));
  } else if (wantsJsonOutput(args)) {
    console.log(JSON.stringify({
      target: targetSummary(target),
      statSource,
      requestedStatsSource,
      statsReason: analysis.stats.reason,
      saveWarnings: analysis.warnings,
      seed,
      route: routeResult,
      report: routeReport,
    }, null, 2));
  } else {
    printRouteResult({
      target,
      routeResult,
      statSource,
      requestedStatsSource,
      statsReason: analysis.stats.reason,
      warnings: analysis.warnings,
      seed,
      maxSeconds,
    });
  }
  process.exit(0);
}

const appliedIds = parseIdList(args.apply);
if (appliedIds.length > 0) {
  player = applySketchRewards({
    baseStats: player,
    sketches,
    defeatedIds: appliedIds,
    boostedIds: new Set(parseIdList(args.boosted)),
    rewardDecay: Number(args["reward-decay"] ?? save.state?.fundamentals?.rewardDecay ?? 1),
    rewardBoosterEffect: Number(args["booster-effect"] ?? save.state?.fundamentals?.rewardBoosterEffect ?? 50),
    existingVictories: save.state?.sketchVictories ?? {},
  });
}
const enemy = {
  id: target.id,
  name: target.name,
  ...target.stats,
  immunities: target.immunities,
  vulnerability: target.vulnerability,
};

if (args["fight-fixture"]) {
  const fixture = readJsonFile(args["fight-fixture"]);
  const fixtureWithAssumptions = fixture.assumptions
    ? fixture
    : { ...fixture, assumptions: combatAssumptions };
  const parity = compareFightParityFixture({
    fixture: fixtureWithAssumptions,
    player,
    enemy,
    targetId,
    maxSeconds,
    traceSeconds: Number(args["trace-seconds"] ?? 60),
    includeRng: Boolean(args["trace-rng"]),
    seed,
  });
  if (wantsMarkdownOutput(args)) {
    console.log(renderFightParityMarkdown(parity));
  } else if (wantsJsonOutput(args)) {
    console.log(JSON.stringify({
      target: targetSummary(target),
      statSource,
      requestedStatsSource,
      statsReason: analysis.stats.reason,
      saveWarnings: analysis.warnings,
      appliedIds,
      parity,
    }, null, 2));
  } else {
    printFightParity(parity);
  }
  process.exit(parity.ok || !args["fail-on-parity-mismatch"] ? 0 : 2);
}

if (args["trace-fight"]) {
  const trace = createFightTrace({
    player,
    enemy,
    maxSeconds,
    traceSeconds: Number(args["trace-seconds"] ?? 60),
    includeRng: Boolean(args["trace-rng"]),
    seed,
    assumptions: combatAssumptions,
  });
  if (wantsMarkdownOutput(args)) {
    console.log(exportTraceMarkdown(trace));
  } else if (wantsJsonOutput(args)) {
    console.log(JSON.stringify({
      target: targetSummary(target),
      statSource,
      requestedStatsSource,
      statsReason: analysis.stats.reason,
      saveWarnings: analysis.warnings,
      appliedIds,
      trace,
    }, null, 2));
  } else {
    printFightTrace(trace);
  }
  process.exit(0);
}

const result = runCombatSimulation({ player, enemy, trialsSetting, maxSeconds, seed, assumptions: combatAssumptions });
const report = createCombatReport({ target, player, simulation: result });
const assumptionComparisons = createModelAssumptionComparisons({
  target,
  player,
  baseline: result,
  trials: Math.min(trials, 1000),
  maxSeconds,
  seed: `${seed}:assumptions`,
  assumptions: combatAssumptions,
});
const diagnostics = createDiagnosticReport({
  target,
  player,
  simulation: result,
  report,
  dataMetadata,
  observedOutcome: args["observed-outcome"],
  assumptionComparisons,
});

if (wantsMarkdownOutput(args)) {
  console.log(exportMarkdownReport(report));
} else if (wantsJsonOutput(args)) {
  console.log(JSON.stringify({
    target: targetSummary(target),
    statSource,
    requestedStatsSource,
    statsReason: analysis.stats.reason,
    saveWarnings: analysis.warnings,
    seed,
    appliedIds,
    diagnostics,
    assumptionComparisons,
    report,
    ...result,
  }, null, 2));
} else {
  printResult({
    target,
    result,
    statSource,
    requestedStatsSource,
    statsReason: analysis.stats.reason,
    warnings: analysis.warnings,
    seed,
    maxSeconds,
    appliedIds,
    report,
    diagnostics,
  });
}

function printHelp() {
  console.log(`Rejected Draft Simulator

Usage:
  node src/cli.js --save <save.txt> --target <sketch_id> [options]
  node src/cli.js --list-targets --rarity masterpiece
  node src/cli.js --save <save.txt> --inspect-save [--target <sketch_id>]

Options:
  --data <file>          Path to artistLinks JS data file.
  --save latest          Use the newest rejected-draft-save-*.txt from Downloads.
  --downloads-dir <dir>  Folder used by --save latest. Default: %USERPROFILE%\\Downloads.
  --trials <n|auto>      Monte Carlo trials. Default: auto. Auto runs until CI is stable.
  --seed <text>          Deterministic seed.
  --max-seconds <n>      Fight timeout in seconds. Default: 300.
  --stats <source>       Stats source: auto, playerStats, battleStats or runStats. Default: auto.
  --inspect-save         Print save/run analysis without simulating a target.
  --current-run          Simulate all unbeaten visible sketches in the active run.
  --remaining            Show unbeaten visible sketches and win chance for each.
  --include-hidden       Include hidden sketches in --current-run and --remaining.
  --apply <ids>          Comma-separated sketch ids to apply as pre-target victories.
  --boosted <ids>        Comma-separated ids from --apply that should receive Reward Booster.
  --reward-decay <n>     Override save reward decay for --apply.
  --booster-effect <n>   Booster bonus percent for --apply. Default from save or 50.
  --route <ids>          Simulate defeating these sketch ids before the target.
  --compare-routes <x>   Compare route specs separated by ~ or |, for example "farm:a,b~rush:c".
  --compare <x>          Alias for --compare-routes.
  --erase <ids>          Apply Precise Eraser to these ids, usually the target.
  --swap <from:to,...>   Apply Sketch Swapper/Pivot replacements during --route.
  --meditate <id>        Simulate meditation on a sketch before the route.
  --meditation-stats <s> Comma-separated meditation stats to force when eligible.
  --meditation-zone <z>  Meditation zone: normal, teal or gold.
  --buy-secret-stash     Simulate buying Secret Stash if affordable.
  --buy-upgrades         Buy affordable upgrades during route simulation.
  --buy-upgrade-ids <u>  Comma-separated upgrade ids to buy greedily.
  --route-seconds <n>    Add passive generator income for this many seconds.
  --explain              Explain target mechanics and important stat thresholds.
  --observed-outcome <x> Compare simulation with practice: win, loss or timeout.
  --trace-fight          Export one deterministic fight timeline for debugging.
  --trace-seconds <n>    Seconds captured by --trace-fight. Default: 60.
  --trace-rng            Include ordered RNG calls in --trace-fight output.
  --fight-fixture <file> Compare one observed fight JSON fixture against a deterministic simulator trace.
  --fail-on-parity-mismatch Exit 2 when --fight-fixture finds deviations.
  --build-advice         Recommend target build priorities, tools and active-run actions.
  --recommend            Print one concrete run decision: fight, finish first, hide or redraw.
  --strategy-plan        Print strategic farm/softcap/EV/booster/roll advice for a target.
  --strategy-profile <p> Profile: farm-q, farm-photon, farm-gold-leaf, farm-acrylic, 3-masterpiece, 4-masterpiece, transcendent-paragon.
  --strategy-mode <m>    Mode: safe-farm, greedy-farm, boss-approach or redraw-fishing.
  --compare-profiles <x> Comma-separated strategy profiles to compare side by side.
  --goal-q <n>           Quintessence goal for --strategy-plan.
  --goal-currency <x>    Currency goals, for example "Photon=1e230,Gold Leaf=1e20".
  --softcap-seconds <n>  Seconds until the next softcap for wait-vs-redraw advice.
  --farm-seconds <n>     Time window for expected-value farm estimates. Default: 3600.
  --booster-candidates <x> Booster sets separated by ~, for example "old:franklyn,vinchy~new:new_tone,mariline".
  --calibrate            Import combat logs from save and compare real fights to simulation.
  --import-combat-logs   Alias for --calibrate.
  --combat-log <file>    Optional JSON/base64 combat log file to include in calibration.
  --patch-sanity         Check versioned Duct/Rose/Mobius snapshots for the current data.
  --game-version <v>     Version to check with --patch-sanity. Default from data metadata.
  --plan-redraw          Estimate Targeted Redraw odds and keep/redraw decision.
  --find-new-sketches    Estimate Find New Sketches mode instead of Targeted Redraw.
  --redraw-minimums <x>  Rarity minimums, for example 38/15/7/1 or rough=38,opus=7.
  --redraw-candidates <x> Candidate settings separated by ~, for example target:38/15/7/1~farm:39/18/10/0.
  --redraw-total <n>     Total slots to draw. Default: current save run total for Targeted Redraw.
  --search-new           Alias for --find-new-sketches.
  --include-star-masterpieces Include (*) Masterpieces with a very low weight.
  --star-weight <n>      Weight multiplier for (*) Masterpieces. Default: 0.001.
  --paragon-weight <n>   Weight multiplier for Paragon sketches. Default: 0.25.
  --guaranteed <ids>     Comma-separated sketch ids forced into the redraw estimate.
  --unscrambled <ids>    Comma-separated ids forced by Unscrambled Guarantee.
  --json                 Print machine-readable JSON.
  --markdown             Print a Markdown combat report.
  --export <format>      Export report format: json or markdown.
`);
}

function printResult({
  target,
  result,
  statSource,
  requestedStatsSource,
  statsReason,
  warnings,
  seed,
  maxSeconds,
  appliedIds,
  report,
  diagnostics,
}) {
  printWarnings(warnings);
  console.log(`Target: ${target.name} [${target.id}]`);
  console.log(`Stats source: ${statSource}${requestedStatsSource === "auto" ? " (auto)" : ""}`);
  if (statsReason) console.log(`Stats reason: ${statsReason}`);
  if (appliedIds.length > 0) console.log(`Applied pre-target rewards: ${appliedIds.join(", ")}`);
  console.log(`Trials: ${result.trials}`);
  if (result.autoTrials?.mode === "auto") {
    console.log(`Auto trials: ${result.autoTrials.stable ? "stable" : "maxed"} at +/- ${(result.autoTrials.targetHalfWidth * 100).toFixed(2)}% target CI`);
  }
  console.log(`Seed: ${seed}`);
  console.log(`Max fight time: ${maxSeconds}s`);
  console.log("");
  const ciHalfWidth = report?.winRate?.ci95HalfWidth ?? result.winRateCi95?.halfWidth ?? 0;
  console.log(`Win rate: ${(result.winRate * 100).toFixed(2)}% +/- ${(ciHalfWidth * 100).toFixed(2)}% (95% CI)`);
  if (diagnostics?.confidence) {
    console.log(`Confidence: ${diagnostics.confidence.label} (${diagnostics.confidence.reasons.join(", ") || "stable"})`);
  }
  console.log(`Wins / losses / timeouts: ${result.wins} / ${result.losses} / ${result.timeouts}`);
  console.log(`Average fight: ${result.avgSeconds.toFixed(2)}s`);
  console.log(`Median fight: ${result.medianSeconds.toFixed(2)}s`);
  console.log(`p10 / p90 fight: ${(result.p10Seconds ?? 0).toFixed(2)}s / ${(result.p90Seconds ?? 0).toFixed(2)}s`);
  console.log(`Timeout rate: ${((result.timeoutRate ?? 0) * 100).toFixed(2)}%`);
  console.log("");
  printReportBreakdown("Victory breakdown", report?.breakdowns?.victories);
  printReportBreakdown("Failure breakdown", report?.breakdowns?.failures);
  console.log("");
  printThresholds(report?.thresholds);
  if (diagnostics) {
    console.log("");
    printDiagnostics(diagnostics);
  }
  if (Object.keys(result.deathCauses ?? {}).length > 0) {
    console.log("");
    console.log("Death causes:");
    for (const [cause, count] of Object.entries(result.deathCauses).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cause.padEnd(20)} ${count}`);
    }
  }
  if (Object.keys(result.timeoutDiagnoses ?? {}).length > 0) {
    console.log("");
    console.log("Timeout diagnoses:");
    for (const [diagnosis, count] of Object.entries(result.timeoutDiagnoses).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${diagnosis.padEnd(20)} ${count}`);
    }
  }
  console.log("");
  console.log("Note: combat model v3 is approximate. Use it for comparing builds and diagnosing walls, not as a byte-for-byte clone of the game engine.");
}

function printDiagnostics(diagnostics) {
  console.log("Diagnostics:");
  console.log(`  Confidence: ${diagnostics.confidence?.label ?? "unknown"}`);
  for (const item of (diagnostics.why ?? []).slice(0, 5)) {
    console.log(`  Why ${item.code}: ${item.detail}`);
  }
  for (const item of (diagnostics.sanityChecks ?? []).slice(0, 3)) {
    console.log(`  Sanity ${item.code}: ${item.status} - ${item.detail}`);
  }
  for (const item of (diagnostics.warnings ?? []).slice(0, 4)) {
    console.log(`  Warning ${item.code}: ${item.detail}`);
  }
  if (diagnostics.observation?.status && diagnostics.observation.status !== "none") {
    console.log(`  Practice: ${diagnostics.observation.status} - ${diagnostics.observation.detail}`);
  }
}

function printFightTrace(trace) {
  console.log(`Fight trace: ${trace.target.name} [${trace.target.id}]`);
  console.log(`Seed: ${trace.seed}`);
  console.log(`Outcome: ${trace.result.winner} (${trace.result.reason}) at ${formatNumber(trace.result.seconds)}s`);
  console.log("");
  for (const event of trace.events) {
    const action = event.action?.type ? `${event.attackerSide}->${event.defenderSide} ${event.action.type}` : event.event;
    console.log(`${String(event.time).padStart(7)}s ${action.padEnd(24)} P ${formatNumber(event.playerHp).padEnd(10)} E ${formatNumber(event.enemyHp).padEnd(10)} dmg P/E ${formatNumber(event.damage.player.total)}/${formatNumber(event.damage.enemy.total)}`);
  }
}

function printFightParity(parity) {
  console.log(`Fight parity fixture: ${parity.fixtureId}`);
  console.log(`Target: ${parity.targetName ?? parity.targetId ?? "unknown"} [${parity.targetId ?? "unknown"}]`);
  console.log(`Status: ${parity.ok ? "PASS" : "FAIL"}`);
  console.log(`Seed: ${parity.seed}`);
  console.log("");
  console.log(`Observed:  ${parity.observed?.outcome ?? "unknown"} at ${formatNumber(parity.observed?.seconds)}s, P ${formatNumber(parity.observed?.playerHp)}, E ${formatNumber(parity.observed?.enemyHp)}`);
  console.log(`Simulated: ${parity.simulated?.outcome ?? "unknown"} at ${formatNumber(parity.simulated?.seconds)}s, P ${formatNumber(parity.simulated?.playerHp)}, E ${formatNumber(parity.simulated?.enemyHp)}`);
  if (parity.deviations.length > 0) {
    console.log("");
    console.log("Deviations:");
    for (const item of parity.deviations) console.log(`  ${item.code}: ${item.message}`);
  }
  console.log("");
  console.log(`Trace events: ${parity.trace?.events?.length ?? 0}`);
}

function printTargetExplanation({ target, statSource, explanation }) {
  console.log(`Target: ${target.name} [${target.id}]`);
  console.log(`Stats source: ${statSource}`);
  console.log("");
  console.log("Important interactions:");
  if (explanation.interactions.length === 0) console.log("  none");
  for (const item of explanation.interactions) {
    console.log(`  ${item.code}: ${item.title}`);
    console.log(`    ${item.detail}`);
  }
  console.log("");
  printThresholds(explanation.thresholds);
}

function printBuildAdvice({ target, statSource, advice }) {
  console.log(`Target: ${target.name} [${target.id}]`);
  console.log(`Stats source: ${statSource}`);
  console.log("");

  console.log("Build priorities:");
  console.log(`  Strategy: ${advice.targetPlan.strategy}`);
  console.log(`  Tags: ${advice.targetPlan.tags.join(", ")}`);
  for (const item of advice.targetPlan.priorityStats.slice(0, 10)) {
    console.log(`  ${item.stat.padEnd(18)} weight ${String(item.weight).padEnd(4)} current ${formatNumber(item.current)}`);
  }
  console.log("");

  console.log("Biggest problems:");
  if (advice.biggestProblems.length === 0) console.log("  none detected by heuristic thresholds");
  for (const item of advice.biggestProblems) {
    console.log(`  ${item.code.padEnd(20)} ${item.stat}: ${formatNumber(item.current)} / target ${formatNumber(item.target)} severity ${(item.severity * 100).toFixed(1)}%`);
  }
  console.log("");

  console.log("Tools:");
  printAdviceList("Guarantee", advice.tools.guarantee, (item) => `${item.id} [${item.rarity}] score ${item.score.toFixed(2)} ${item.action} ${formatReasons(item.reasons)}`);
  printAdviceList("Booster", advice.tools.booster, (item) => `${item.id} [${item.rarity}] score ${item.score.toFixed(2)} ${item.action} ${formatReasons(item.reasons)}`);
  printAdviceList("Eraser", advice.tools.eraser, (item) => `${item.id} ${item.action} - ${item.reason}`);
  printAdviceList("Meditation", advice.tools.meditation, (item) => `${item.id} [${item.rarity}] stats ${item.stats.join(", ")} score ${item.score.toFixed(2)}`);
  console.log("");

  console.log("Active run:");
  printAdviceList("Finish first", advice.activeRun.finish, (item) => `${item.id} [${item.rarity}] score ${item.score.toFixed(2)} ${formatReasons(item.reasons)}`);
  printAdviceList("Hide", advice.activeRun.hide, (item) => `${item.id} [${item.rarity}] score ${item.score.toFixed(2)} ${formatReasons(item.reasons)}`);
  printAdviceList("Avoid", advice.activeRun.avoid, (item) => `${item.id} [${item.rarity}] score ${item.score.toFixed(2)}`);
  printAdviceList("Best next rewards", advice.activeRun.bestNextRewards, (item) => `${item.id} [${item.rarity}] score ${item.score.toFixed(2)} ${formatReasons(item.reasons)}`);
  console.log("");
  console.log("Note: build advisor is heuristic. Use route simulation to verify close calls.");
}

function printStrategyPlan({ target, statSource, strategicPlan }) {
  console.log(`Target: ${target.name} [${target.id}]`);
  console.log(`Stats source: ${statSource}`);
  console.log("");

  if (strategicPlan.profile) {
    console.log("Strategy profile:");
    console.log(`  Profile: ${strategicPlan.profile.label} [${strategicPlan.profile.id}]`);
    console.log(`  Mode: ${strategicPlan.profile.mode.label} [${strategicPlan.profile.mode.id}]`);
    const goal = strategicPlan.profile.goal;
    if (goal.type === "currency") console.log(`  Goal: ${goal.currency} missing ${formatNumber(goal.missing)}`);
    else if (goal.type === "quintessence") console.log(`  Goal: Q missing ${formatNumber(goal.missing)}`);
    else if (goal.type === "masterpiece_count") console.log(`  Goal: ${goal.current}/${goal.goal} Masterpiece`);
    else console.log(`  Goal: ${goal.type}`);
    if (strategicPlan.profileProgress) {
      console.log(`  Avg runs/redraws: ${formatNullableNumber(strategicPlan.profileProgress.averageRuns)} / ${formatNullableNumber(strategicPlan.profileProgress.averageRedraws)}`);
    }
    console.log("");
  }

  console.log("Approach readiness:");
  console.log(`  Decision: ${strategicPlan.approach.decision}`);
  console.log(`  Win rate: ${(strategicPlan.approach.winRate.current * 100).toFixed(2)}% / target ${(strategicPlan.approach.winRate.target * 100).toFixed(2)}%`);
  const q = strategicPlan.approach.resources.quintessence;
  if (q.goal != null) console.log(`  Quintessence: ${formatNumber(q.current)} / ${formatNumber(q.goal)} missing ${formatNumber(q.missing)}`);
  for (const [currency, gap] of Object.entries(strategicPlan.approach.resources.currencies)) {
    console.log(`  ${currency}: ${formatNumber(gap.current)} / ${formatNumber(gap.goal)} missing ${formatNumber(gap.missing)}`);
  }
  console.log("");

  console.log("Softcap vs redraw:");
  console.log(`  Decision: ${strategicPlan.softcap.decision}`);
  console.log(`  Reason: ${strategicPlan.softcap.reason}`);
  if (strategicPlan.softcap.secondsToSoftcap != null) console.log(`  Seconds to softcap: ${formatNumber(strategicPlan.softcap.secondsToSoftcap)}`);
  console.log("");

  console.log("Farm plan:");
  console.log(`  Decision: ${strategicPlan.farmPlan.decision}`);
  const goal = strategicPlan.farmPlan.goal;
  if (goal.type === "currency") {
    console.log(`  Goal: ${goal.currency} missing ${formatNumber(goal.missing)} at ${formatNumber(goal.perSecond)}/s`);
  } else {
    console.log(`  Goal: ${goal.type} missing ${formatNumber(goal.missing)}${goal.perSecond == null ? "" : ` at ${formatNumber(goal.perSecond)}/s`}`);
  }
  if (goal.estimatedSeconds != null) console.log(`  Estimated time: ${formatNumber(goal.estimatedSeconds)}s`);
  console.log("");

  console.log("Top Opus value:");
  for (const item of strategicPlan.opusValues.slice(0, 6)) {
    console.log(`  ${item.id.padEnd(28)} score ${String(item.score).padEnd(8)} currency ${String(item.currencyScore).padEnd(8)} stats ${item.bestStats.map((reward) => `${reward.statName} ${formatSigned(reward.amount)}`).join(", ") || "none"}`);
  }
  if (strategicPlan.opusValues.length === 0) console.log("  none");
  console.log("");

  console.log("Run EV:");
  console.log(`  Window: ${strategicPlan.runEV.windowSeconds}s`);
  console.log(`  Quintessence: ${formatNumber(strategicPlan.runEV.quintessence.expected)} (${formatNumber(strategicPlan.runEV.quintessence.perSecond)}/s)`);
  for (const [currency, ev] of Object.entries(strategicPlan.runEV.currencies)) {
    console.log(`  ${currency}: ${formatNumber(ev.expected)} (${formatNumber(ev.perSecond)}/s)`);
  }
  console.log("");

  if (strategicPlan.economy) {
    printEconomyPlan(strategicPlan.economy);
    console.log("");
  }

  console.log("Booster choice:");
  if (strategicPlan.boosters.recommendation) {
    const best = strategicPlan.boosters.recommendation;
    console.log(`  Best: ${best.name} -> ${best.ids.join(", ")} win ${(best.winRate * 100).toFixed(2)}% score ${best.score}`);
  } else {
    console.log("  none supplied; pass --booster-candidates to compare options");
  }
  console.log("");

  console.log("Roll/run decisions:");
  console.log(`  Masterpiece roll: ${strategicPlan.masterpieceRoll.decision} (${strategicPlan.masterpieceRoll.reason})`);
  console.log(`  Finish run: ${strategicPlan.runCompletion.decision} (${strategicPlan.runCompletion.reason})`);
  if (strategicPlan.stopFarming) console.log(`  Stop farming: ${strategicPlan.stopFarming.decision} (${strategicPlan.stopFarming.reason})`);
  if (strategicPlan.profileModes?.safeFarm?.recommendation) {
    console.log(`  Safe farm: ${strategicPlan.profileModes.safeFarm.recommendation.id} score ${strategicPlan.profileModes.safeFarm.recommendation.score}`);
  }
  if (strategicPlan.profileModes?.greedyFarm?.recommendation) {
    console.log(`  Greedy farm: ${strategicPlan.profileModes.greedyFarm.recommendation.id} score ${strategicPlan.profileModes.greedyFarm.recommendation.score}`);
  }
  if (strategicPlan.profileModes?.bossApproach?.recommendation) {
    console.log(`  Boss approach: ${strategicPlan.profileModes.bossApproach.recommendation.id} score ${strategicPlan.profileModes.bossApproach.recommendation.score}`);
  }
  console.log("");
  if (strategicPlan.profileComparison?.length > 0) {
    console.log("Profile comparison:");
    for (const item of strategicPlan.profileComparison) {
      console.log(`  ${item.id.padEnd(22)} ${String(item.mode).padEnd(15)} runs ${formatNullableNumber(item.estimatedRuns).padEnd(10)} redraws ${formatNullableNumber(item.estimatedRedraws).padEnd(10)} best ${item.bestSketchId ?? "none"}`);
    }
    console.log("");
  }
  console.log("Note: strategic plan is a heuristic wrapper around combat, reward and redraw estimates. Use it to compare options, not as an exact clone of game internals.");
}

function printEconomyPlan(economy) {
  console.log("Economy:");
  const buyNow = economy.purchasePlan?.buyNow ?? [];
  if (buyNow.length > 0) {
    console.log("  Buy now:");
    for (const item of buyNow.slice(0, 5)) {
      console.log(`    ${item.id}: L${item.nextLevel} ${item.currency} ${formatNumber(item.cost)} ROI ${formatNumber(item.roi)}`);
    }
  } else {
    console.log("  Buy now: none");
  }

  const delayed = economy.purchasePlan?.delay ?? [];
  if (delayed.length > 0) {
    console.log("  Delay:");
    for (const item of delayed.slice(0, 5)) {
      console.log(`    ${item.id}: needs ${item.currency} ${formatNumber(item.cost)} (have ${formatNumber(item.currentCurrency)})`);
    }
  }

  const forecasts = economy.currencyForecasts ?? [];
  if (forecasts.length > 0) {
    console.log("  Forecasts:");
    for (const item of forecasts.slice(0, 5)) {
      const eta = item.secondsToGoal == null ? "unknown" : `${formatNumber(item.secondsToGoal)}s`;
      console.log(`    ${item.currency}: missing ${formatNumber(item.missing)} at ${formatNumber(item.perSecond)}/s, ETA ${eta}`);
    }
  }

  const bottlenecks = economy.bottlenecks ?? [];
  if (bottlenecks.length > 0) {
    console.log("  Bottlenecks:");
    for (const item of bottlenecks.slice(0, 5)) {
      console.log(`    ${item.currency}: ${item.reason}, missing ${formatNumber(item.missing)}`);
    }
  }

  if (economy.secretStash) {
    const stash = economy.secretStash;
    console.log(`  Secret Stash: ${stash.unlocked ? "unlocked" : stash.canUnlock ? "can unlock" : "locked"}; missing Q ${formatNumber(stash.missingQuintessence)}`);
  }
}

function printAdviceList(label, items, formatter) {
  console.log(`  ${label}:`);
  if (!items || items.length === 0) {
    console.log("    none");
    return;
  }
  for (const item of items.slice(0, 8)) console.log(`    ${formatter(item)}`);
}

function formatReasons(reasons = []) {
  return reasons.length > 0 ? `(${reasons.slice(0, 4).join(", ")})` : "";
}

function printRouteResult({
  target,
  routeResult,
  statSource,
  requestedStatsSource,
  statsReason,
  warnings,
  seed,
  maxSeconds,
}) {
  printWarnings(warnings);
  console.log(`Target: ${target.name} [${target.id}]`);
  console.log(`Stats source: ${statSource}${requestedStatsSource === "auto" ? " (auto)" : ""}`);
  if (statsReason) console.log(`Stats reason: ${statsReason}`);
  console.log(`Route: ${routeResult.routeIds.length > 0 ? routeResult.routeIds.join(", ") : "empty"}`);
  console.log(`Seed: ${seed}`);
  console.log(`Max fight time: ${maxSeconds}s`);
  console.log("");

  console.log("Route steps:");
  for (const step of routeResult.steps) {
    const label = `${step.id ?? step.originalId}`.padEnd(32);
    if (step.status !== "defeated") {
      console.log(`  ${label} ${step.status}`);
      continue;
    }
    const rewards = step.statRewards.map((reward) => `${reward.statName} ${formatSigned(reward.amount)}`);
    const currencies = step.currencyRewards.map((reward) => `${reward.name} ${formatSigned(reward.amount)}`);
    console.log(`  ${label} x${step.rewardMultiplier.total} ${[...rewards, ...currencies].join(", ") || "no rewards"}`);
  }
  if (routeResult.steps.length === 0) console.log("  none");
  console.log("");

  if (routeResult.tools.boostedApplied.length > 0) {
    console.log(`Boosted: ${routeResult.tools.boostedApplied.join(", ")}`);
  }
  if (routeResult.tools.erasedApplied.length > 0) {
    console.log(`Erased: ${routeResult.tools.erasedApplied.join(", ")}`);
  }
  if (routeResult.tools.swappedApplied.length > 0) {
    console.log(`Swapped: ${routeResult.tools.swappedApplied.map((item) => `${item.from}->${item.to}`).join(", ")}`);
  }
  if (routeResult.meditation.applied) {
    console.log(`Meditation: ${routeResult.meditation.sketchId} ${routeResult.meditation.appliedStats.join(", ")} x${routeResult.meditation.multiplier}`);
  }
  if (routeResult.shop.purchased.length > 0) {
    console.log(`Upgrades bought: ${routeResult.shop.purchased.map((item) => `${item.id} Lv.${item.level}`).join(", ")}`);
  }
  console.log(`Secret Stash: ${routeResult.secretStash.unlocked ? "unlocked" : "locked"} (${routeResult.secretStash.canAfford ? "affordable" : "not affordable"})`);
  console.log("");

  const simulation = routeResult.target?.simulation;
  if (simulation) {
    console.log(`Win rate: ${(simulation.winRate * 100).toFixed(2)}% +/- ${((simulation.winRateCi95?.halfWidth ?? 0) * 100).toFixed(2)}% (95% CI)`);
    console.log(`Wins / losses / timeouts: ${simulation.wins} / ${simulation.losses} / ${simulation.timeouts}`);
    console.log(`Average fight: ${simulation.avgSeconds.toFixed(2)}s`);
    console.log(`Median fight: ${simulation.medianSeconds.toFixed(2)}s`);
    console.log(`p10 / p90 fight: ${(simulation.p10Seconds ?? 0).toFixed(2)}s / ${(simulation.p90Seconds ?? 0).toFixed(2)}s`);
    console.log(`Timeout rate: ${((simulation.timeoutRate ?? 0) * 100).toFixed(2)}%`);
  } else {
    console.log("No target simulation was run.");
  }
  console.log("");
  console.log("Note: route mode applies approximate reward/progress mechanics before the combat model.");
}

function printRouteComparison({ target, statSource, comparison }) {
  console.log(`Target: ${target.name} [${target.id}]`);
  console.log(`Stats source: ${statSource}`);
  console.log(`Trials per route: ${comparison.trials}`);
  console.log("");
  console.log("Route".padEnd(22) + "Win rate".padEnd(18) + "Timeout".padEnd(10) + "p90".padEnd(10) + "Attack".padEnd(14) + "Max HP");
  for (const route of comparison.routes) {
    const halfWidth = route.winRateCi95?.halfWidth ?? 0;
    console.log(
      route.name.padEnd(22)
      + `${(route.winRate * 100).toFixed(2)}%+/-${(halfWidth * 100).toFixed(1)}`.padEnd(18)
      + `${(route.timeoutRate * 100).toFixed(1)}%`.padEnd(10)
      + `${route.p90Seconds.toFixed(2)}s`.padEnd(10)
      + formatNumber(route.finalStats.attack).padEnd(14)
      + formatNumber(route.finalStats.maxHp),
    );
  }
}

function printReportBreakdown(label, items = []) {
  console.log(`${label}:`);
  if (!items || items.length === 0) {
    console.log("  none");
    return;
  }
  for (const item of items) {
    console.log(`  ${item.code.padEnd(20)} ${String(item.count).padStart(6)} (${(item.rate * 100).toFixed(2)}%)`);
  }
}

function printThresholds(thresholds = []) {
  console.log("Stat thresholds:");
  if (!thresholds || thresholds.length === 0) {
    console.log("  none");
    return;
  }
  for (const item of thresholds) {
    console.log(`  ${item.stat.padEnd(18)} current ${formatNumber(item.current).padEnd(12)} target ${formatNumber(item.target).padEnd(12)} ${item.reason}`);
  }
}

function printRedrawPlan({ target, redrawPlan }) {
  if (redrawPlan.mode === "find_new_sketches") {
    console.log("Mode: Find New Sketches");
    console.log(`Trials: ${redrawPlan.estimate.trials}`);
    console.log(`Seed: ${redrawPlan.estimate.seed}`);
    console.log(`Total slots: ${redrawPlan.estimate.totalSlots}`);
    console.log(`Max redraws: ${redrawPlan.estimate.maxRedraws}`);
    console.log("");
    console.log(`Single redraw new-sketch chance: ${(redrawPlan.estimate.probabilities.singleRedrawNewSketch * 100).toFixed(2)}%`);
    console.log(`Within max redraws: ${(redrawPlan.estimate.probabilities.withinMaxRedraws * 100).toFixed(2)}%`);
    console.log(`Average redraws to new: ${redrawPlan.estimate.averageRedrawsToNew ?? "n/a"}`);
    console.log("");
    console.log(`New-sketch pool: ${redrawPlan.estimate.newSketchPool.total} rough+ sketches`);
    console.log(`Pool by rarity: ${formatMinimums(redrawPlan.estimate.newSketchPool.byRarity)}`);
    console.log("");
    console.log("Note: Find New Sketches is separate from Targeted Redraw minimums.");
    return;
  }

  console.log(`Target: ${target.name} [${target.id}]`);
  console.log(`Trials: ${redrawPlan.estimate.trials}`);
  console.log(`Seed: ${redrawPlan.estimate.seed}`);
  console.log(`Minimums: ${formatMinimums(redrawPlan.estimate.minimums)}`);
  console.log(`Total slots: ${redrawPlan.estimate.totalSlots}`);
  if (redrawPlan.estimate.targetedRedraw) {
    const limits = redrawPlan.estimate.targetedRedraw;
    console.log("");
    console.log("Targeted Redraw limits:");
    console.log(`  Game minimum chance: ${(limits.minimumChance * 100).toFixed(4)}% / required ${(limits.minimumChanceThreshold * 100).toFixed(2)}% (${limits.enabled ? "enabled" : "blocked"})`);
    console.log(`  Guarantee capacity: ${formatMinimums(limits.guaranteeCapacity)}`);
    console.log(`  Selected guarantees: ${formatMinimums(limits.selectedCounts)}`);
    console.log(`  Used guarantee slots: ${formatMinimums(limits.usedGuaranteeSlots)}`);
  }
  console.log("");

  console.log("Current run:");
  console.log(`  Decision: ${redrawPlan.currentRun.decision}`);
  console.log(`  Reasons: ${redrawPlan.currentRun.reasons.join(", ")}`);
  console.log(`  Counts: ${formatMinimums(redrawPlan.currentRun.countsByRarity)}`);
  console.log("");

  console.log("Odds:");
  console.log(`  Rarity minimums: ${(redrawPlan.estimate.probabilities.rarityMinimums * 100).toFixed(2)}%`);
  console.log(`  Target hit: ${(redrawPlan.estimate.probabilities.anyTarget * 100).toFixed(2)}%`);
  for (const [id, rate] of Object.entries(redrawPlan.estimate.targetRates)) {
    console.log(`  ${id}: ${(rate * 100).toFixed(2)}%`);
  }
  if (redrawPlan.estimate.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of redrawPlan.estimate.warnings) console.log(`  ${warning.code}: ${warning.message}`);
  }
  console.log("");

  console.log("Recommendations:");
  for (const item of redrawPlan.recommendations.recommendations.slice(0, 5)) {
    const minimumChance = item.minimumChance == null ? "n/a" : `${(item.minimumChance * 100).toFixed(4)}%`;
    const validity = item.validMinimumChance == null ? "unknown" : item.validMinimumChance ? "valid" : "blocked";
    console.log(
      `  ${item.name.padEnd(14)} ${formatMinimums(item.minimums).padEnd(12)} target ${(item.targetProbability * 100).toFixed(2)}%`
      + ` min ${minimumChance.padEnd(9)} ${validity.padEnd(7)} farm ${item.farmScore.toFixed(2)} score ${item.score.toFixed(2)} (${item.tradeoff})`,
    );
  }
  console.log("");
  console.log("Note: Targeted Redraw minimum chance now follows the game's rarity-limit formula; combat and target-hit odds are still Monte Carlo estimates.");
}

function printCurrentRunReport({ currentRun, recommendation, statSource, targetId, warnings }) {
  printWarnings(warnings);
  console.log("Current run simulation");
  console.log(`Stats source: ${statSource}`);
  if (targetId) console.log(`Target filter: ${targetId}`);
  console.log(`Simulated: ${currentRun.summary.simulated}/${currentRun.summary.totalAvailable}`);
  console.log(`Skipped: hidden ${currentRun.summary.hiddenSkipped}, completed ${currentRun.summary.completedSkipped}, missing ${currentRun.summary.missingSkipped}`);
  console.log("");
  printRunRecommendationBody(recommendation);
  console.log("");
  printRemainingTargetsTable(currentRun.targets);
}

function printRemainingTargets({ currentRun, statSource, warnings }) {
  printWarnings(warnings);
  console.log("Remaining active sketches");
  console.log(`Stats source: ${statSource}`);
  console.log(`Simulated: ${currentRun.summary.simulated}/${currentRun.summary.totalAvailable}`);
  console.log("");
  printRemainingTargetsTable(currentRun.targets);
}

function printRunRecommendation({ currentRun, recommendation, statSource, targetId, warnings }) {
  printWarnings(warnings);
  console.log("Run recommendation");
  console.log(`Stats source: ${statSource}`);
  if (targetId) console.log(`Requested target: ${targetId}`);
  console.log("");
  printRunRecommendationBody(recommendation);
  console.log("");
  printRemainingTargetsTable(currentRun.targets.slice(0, 8));
}

function printRunRecommendationBody(recommendation) {
  console.log(`Decision: ${recommendation.action}`);
  console.log(`Reason: ${recommendation.reason}`);
  console.log(`Confidence: ${recommendation.confidence}`);
  if (recommendation.targetId) console.log(`Sketch: ${recommendation.targetId}`);
  if (recommendation.hideCandidates.length > 0) {
    console.log(`Hide candidates: ${recommendation.hideCandidates.map((item) => `${item.id} (${(item.winRate * 100).toFixed(1)}%)`).join(", ")}`);
  } else {
    console.log("Hide candidates: none");
  }
}

function printRemainingTargetsTable(targets) {
  console.log("Sketch".padEnd(30) + "Rarity".padEnd(13) + "Win".padEnd(11) + "CI".padEnd(10) + "p90".padEnd(10) + "Left".padEnd(8) + "Problem");
  if (targets.length === 0) {
    console.log("  none");
    return;
  }
  for (const item of targets) {
    console.log(
      item.id.padEnd(30)
      + item.rarity.padEnd(13)
      + `${(item.winRate * 100).toFixed(1)}%`.padEnd(11)
      + `+/-${(item.ci95HalfWidth * 100).toFixed(1)}`.padEnd(10)
      + `${item.p90Seconds.toFixed(1)}s`.padEnd(10)
      + String(item.remainingToMax).padEnd(8)
      + (item.topFailure ?? item.topVictory ?? "none"),
    );
  }
}

function printSaveInspection(analysis) {
  printWarnings(analysis.warnings);
  console.log(`Save version: ${analysis.saveVersion ?? "unknown"}`);
  console.log(`Run phase: ${analysis.run.phase}`);
  console.log(`Recommended stats: ${analysis.stats.recommendedSource} (${analysis.stats.reason})`);
  console.log("");

  console.log("Active sketches:");
  console.log(`  Target: ${formatSketch(analysis.run.active.target)}`);
  console.log(`  Defeated this run: ${analysis.run.active.defeated.length}`);
  console.log(`  Hidden: ${analysis.run.active.hidden.length}`);
  console.log(`  Remaining visible: ${analysis.run.active.remaining.length}`);
  for (const item of analysis.run.active.remaining.slice(0, 12)) {
    const progress = item.rewardProgress;
    console.log(`    ${item.id.padEnd(28)} ${item.rarity.padEnd(12)} ${progress.runVictories}/${progress.maxVictories}`);
  }
  if (analysis.run.active.remaining.length > 12) {
    console.log(`    ... ${analysis.run.active.remaining.length - 12} more`);
  }
  console.log("");

  console.log("Tools:");
  console.log(`  Auto booster: ${formatList(analysis.tools.autoBooster)}`);
  console.log(`  Auto eraser: ${formatList(analysis.tools.autoEraser)}`);
  console.log(`  Auto swapper: ${formatList(analysis.tools.autoSwapper)}`);
  console.log(`  Boosted: ${formatList(analysis.tools.boosted)}`);
  console.log(`  Erased: ${formatList(analysis.tools.erased)}`);
  console.log(`  Swapped: ${formatList(analysis.tools.swapped)}`);
  console.log("");

  console.log("Meditation:");
  console.log(`  Sketch: ${analysis.meditation.sketchId ?? "none"}`);
  console.log(`  Count: ${analysis.meditation.count}`);
  console.log(`  Pending stats: ${formatList(analysis.meditation.pendingStats)}`);
  console.log(`  Active buffs: ${formatBuffs(analysis.meditation.activeBuffs)}`);
  console.log("");

  console.log("Largest playerStats -> battleStats differences:");
  for (const [statName, diff] of largestDiffs(analysis.stats.playerVsBattle, 10)) {
    const percent = diff.percentDelta == null ? "n/a" : `${diff.percentDelta.toFixed(2)}%`;
    console.log(`  ${statName.padEnd(22)} ${formatNumber(diff.playerStats)} -> ${formatNumber(diff.battleStats)} (${percent})`);
  }
}

function printCalibrationReport({ statSource, calibration }) {
  printWarnings(calibration.warnings);
  console.log("Calibration report");
  console.log(`Game data version: ${calibration.gameDataVersion ?? "unknown"}`);
  console.log(`Save version: ${calibration.saveVersion ?? "unknown"}`);
  console.log(`Stats source fallback: ${statSource}`);
  console.log(`Combat logging: ${calibration.logs.combatLoggingEnabled === false ? "disabled" : calibration.logs.combatLoggingEnabled === true ? "enabled" : "unknown"}`);
  console.log(`Combat logs: ${calibration.logs.used}/${calibration.logs.total} used (save ${calibration.logs.fromSave}, external ${calibration.logs.external})`);
  if (calibration.logs.targetFilter) console.log(`Target filter: ${calibration.logs.targetFilter}`);
  console.log("");

  printPatchSanity(calibration.patchSanity);
  console.log("");
  printRegressionSummary(calibration.regression);
  console.log("");

  console.log("Observed vs simulated fights:");
  if (calibration.comparisons.length === 0) {
    console.log("  none");
  }
  for (const item of calibration.comparisons.slice(0, 12)) {
    const predictedRate = item.predicted.winRate == null ? "n/a" : `${(item.predicted.winRate * 100).toFixed(2)}%`;
    const seconds = item.actual.seconds == null ? "n/a" : `${item.actual.seconds.toFixed(2)}s`;
    console.log(`  ${String(item.targetId ?? "unknown").padEnd(28)} real ${item.actual.outcome.padEnd(8)} sim ${item.predicted.outcome.padEnd(9)} win ${predictedRate.padEnd(8)} real time ${seconds}`);
  }
  if (calibration.comparisons.length > 12) {
    console.log(`  ... ${calibration.comparisons.length - 12} more`);
  }
  console.log("");

  console.log("Deviations:");
  if (calibration.deviations.length === 0) {
    console.log("  none");
  }
  for (const item of calibration.deviations.slice(0, 12)) {
    console.log(`  ${item.code.padEnd(18)} ${String(item.targetId ?? "unknown").padEnd(28)} ${item.message}`);
  }
  if (calibration.deviations.length > 12) {
    console.log(`  ... ${calibration.deviations.length - 12} more`);
  }
  console.log("");

  console.log("Suggested tuning:");
  printTuningItem("Status ticks", calibration.tuning.statusTickMultiplier);
  printTuningItem("Thorns/Counter", calibration.tuning.thornsCounterMultiplier);
  printTuningItem("Duration", calibration.tuning.durationMultiplier);
  console.log("");
  console.log("Note: calibration only suggests multipliers. Apply engine changes after enough real combat-log samples repeat the same deviation.");
}

function printPatchSanity(patchSanity) {
  console.log("Patch sanity:");
  console.log(`  Version: ${patchSanity.version ?? "unknown"}`);
  console.log(`  Checked targets: ${patchSanity.checkedTargets}`);
  console.log(`  Status: ${patchSanity.ok ? "ok" : "failed"}`);
  if (patchSanity.failures.length === 0) {
    console.log("  Failures: none");
    return;
  }
  console.log("  Failures:");
  for (const failure of patchSanity.failures.slice(0, 12)) {
    if (failure.code === "stat_mismatch") {
      console.log(`    ${failure.targetId}.${failure.stat}: expected ${formatNumber(failure.expected)}, got ${formatNumber(failure.actual)}`);
    } else {
      console.log(`    ${failure.code}: ${failure.targetId ?? failure.version ?? "unknown"}`);
    }
  }
  if (patchSanity.failures.length > 12) {
    console.log(`    ... ${patchSanity.failures.length - 12} more`);
  }
}

function printRegressionSummary(regression) {
  console.log("Known regression scenarios:");
  console.log(`  Passed: ${regression.passed}/${regression.total}`);
  if (regression.failed === 0) {
    console.log("  Failures: none");
    return;
  }
  console.log("  Failures:");
  for (const item of regression.results.filter((result) => !result.pass)) {
    console.log(`    ${item.id}: expected ${item.expectedWinner}, got ${item.actualWinner} (${item.reason})`);
  }
}

function printTuningItem(label, item) {
  const value = item.value == null ? "n/a" : `${item.value}x`;
  console.log(`  ${label.padEnd(16)} ${value.padEnd(10)} samples ${String(item.sampleCount).padEnd(4)} confidence ${item.confidence}`);
}

function printWarnings(warnings = []) {
  for (const warning of warnings) {
    console.warn(`Warning: ${warning.message}`);
  }
}

function formatSketch(item) {
  if (!item) return "none";
  return `${item.id} [${item.rarity}] ${item.rewardProgress.runVictories}/${item.rewardProgress.maxVictories}`;
}

function formatList(items) {
  return items.length > 0 ? items.join(", ") : "none";
}

function formatBuffs(buffs) {
  if (buffs.length === 0) return "none";
  return buffs.map((buff) => `${buff.stat} x${buff.multiplier}`).join(", ");
}

function largestDiffs(comparison, limit) {
  return Object.entries(comparison)
    .filter(([, diff]) => diff.delta !== 0)
    .sort(([, a], [, b]) => Math.abs(b.percentDelta ?? b.delta) - Math.abs(a.percentDelta ?? a.delta))
    .slice(0, limit);
}

function formatNumber(value) {
  return formatNiceNumber(value);
}

function formatNullableNumber(value) {
  return value == null ? "n/a" : formatNumber(value);
}

function targetSummary(target) {
  return {
    id: target.id,
    name: target.name,
    rarity: target.rarity,
    stats: target.stats,
    vulnerability: target.vulnerability,
    immunities: target.immunities,
  };
}

function routeOptionsFromArgs(args) {
  return {
    boostedIds: parseIdList(args.boosted),
    erasedIds: parseIdList(args.erase ?? args.erased),
    swapMap: parseSwapMap(args.swap),
    meditation: args.meditate
      ? {
        sketchId: args.meditate,
        stats: parseIdList(args["meditation-stats"]),
        zone: args["meditation-zone"] ?? "normal",
      }
      : null,
    buySecretStash: Boolean(args["buy-secret-stash"]),
    buyUpgrades: Boolean(args["buy-upgrades"] || args["buy-upgrade-ids"]),
    buyUpgradeIds: parseIdList(args["buy-upgrade-ids"]),
    routeSeconds: Number(args["route-seconds"] ?? 0),
  };
}

function createRedrawPlan({ sketches, save, targetId, args, trials, seed }) {
  const targetIds = parseIdList(args.targets ?? targetId);
  const findNewMode = Boolean(args["find-new-sketches"] || args["search-new"]);
  if (findNewMode) {
    return {
      mode: "find_new_sketches",
      estimate: estimateFindNewSketchOdds({
        sketches,
        state: save.state,
        totalSlots: args["redraw-total"] == null ? null : Number(args["redraw-total"]),
        maxRedraws: Number(args["max-redraws"] ?? 100),
        includeStarMasterpieces: Boolean(args["include-star-masterpieces"]),
        starMasterpieceWeight: Number(args["star-weight"] ?? 0.001),
        paragonWeightMultiplier: Number(args["paragon-weight"] ?? 0.25),
        trials,
        seed,
      }),
    };
  }

  const minimums = parseMinimums(args["redraw-minimums"] ?? args.minimums ?? save.state?.targetedRedrawMins ?? "38/15/7/1");
  const candidates = args["redraw-candidates"] ? parseCandidateSettings(args["redraw-candidates"]) : null;
  const options = {
    includeStarMasterpieces: Boolean(args["include-star-masterpieces"]),
    starMasterpieceWeight: Number(args["star-weight"] ?? 0.001),
    paragonWeightMultiplier: Number(args["paragon-weight"] ?? 0.25),
    guaranteedIds: parseIdList(args.guaranteed),
    unscrambledGuaranteeIds: parseIdList(args.unscrambled),
    totalSlots: args["redraw-total"] == null ? null : Number(args["redraw-total"]),
  };
  const estimate = estimateRedrawOdds({
    sketches,
    state: save.state,
    targetIds,
    minimums,
    trials,
    seed,
    ...options,
  });
  const recommendations = recommendTargetedRedrawSettings({
    sketches,
    state: save.state,
    targetIds,
    candidates,
    trials: Math.min(trials, 2000),
    seed: `${seed}:recommend`,
    ...options,
  });
  const currentRun = evaluateCurrentRun({
    sketches,
    state: save.state,
    targetIds,
    minimums,
  });

  return {
    targetIds,
    estimate,
    recommendations,
    currentRun,
  };
}

function formatSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${number >= 0 ? "+" : ""}${formatNumber(number)}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function wantsJsonOutput(parsedArgs) {
  return Boolean(parsedArgs.json) || String(parsedArgs.export ?? "").toLowerCase() === "json";
}

function wantsMarkdownOutput(parsedArgs) {
  const exportFormat = String(parsedArgs.export ?? "").toLowerCase();
  return Boolean(parsedArgs.markdown) || exportFormat === "markdown" || exportFormat === "md";
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function findDefaultDataPath() {
  const candidates = [
    path.resolve(process.cwd(), "data", "artistLinks.js"),
    path.resolve(process.cwd(), "..", "artistLinks-CsK2J3KP-2026-05-20.js"),
    path.resolve(process.cwd(), "artistLinks-CsK2J3KP-2026-05-20.js"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("Could not find sketch data. Pass --data <artistLinks JS file>.");
  }
  return found;
}
