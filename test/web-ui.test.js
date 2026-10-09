import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("web UI selects auto trials by default", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const selectedOption = html.match(/<option\s+value="([^"]+)"\s+selected>/);

  assert.equal(selectedOption?.[1], "auto");
});

test("web UI visible copy is English", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");
  const combined = `${html}\n${app}`;

  assert.match(html, /<html lang="en">/);
  for (const expected of [
    "Bundle: loading",
    "Import bundle",
    "Simulate",
    "Compare",
    "Target filter",
    "Attempts",
    "Strategy planner",
    "No data",
    "Best next click",
    "Why this result?",
    "Warnings",
    "Practice vs model",
    "Build comparison",
    "Economy planner",
    "Buy now",
    "Bottlenecks",
    "Forecasts",
    "Roll wishlist",
    "window extended",
    "History",
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(expected)));
  }

  for (const forbidden of [
    "Brak",
    "brak",
    "Farma",
    "Porownaj",
    "Porównaj",
    "Próby",
    "Wynik",
    "Decyzja",
    "Porażki",
    "Źródło",
    "ładowanie",
    "targetów",
    "następne",
    "kliknięcie",
    "prób",
    "porażek",
    "pewność",
    "podejscie",
    "kroków",
    "jedna próbka",
    "Wybierz",
    "Symuluj",
    "Importuj",
    "Tryb",
    "Cel",
    "Okno",
    "Kandydaci",
    "Historia",
    "Usuń",
    "Wyczyść",
    "Najlepsze",
    "Dlaczego",
    "Ostrzeżenia",
    "Praktyka",
    "Aktywny",
    "Widoki",
    "Wariant",
    "np.",
  ]) {
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(forbidden)));
  }
});

test("web UI exposes strategy planner controls and output panel", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");

  for (const id of [
    "strategyGoalQInput",
    "strategyProfileSelect",
    "strategyModeSelect",
    "strategyCompareProfilesInput",
    "strategyGoalCurrencyInput",
    "strategySoftcapSecondsInput",
    "strategyFarmSecondsInput",
    "strategyBoosterCandidatesInput",
    "strategyDecision",
    "strategySoftcap",
    "strategyFarmGoal",
    "strategyOpusList",
    "strategyProfileList",
    "economyBuyList",
    "economyBottleneckList",
    "economyForecastList",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /strategyOptions:\s*strategyOptionsPayload\(\)/);
  assert.match(app, /function renderStrategyPlan/);
  assert.match(app, /function renderEconomyPlan/);
  assert.match(app, /renderEconomyPlan\(plan\.economy\)/);
  assert.match(app, /strategyProfile:\s*els\.strategyProfileSelect\.value/);
  assert.match(app, /strategyMode:\s*els\.strategyModeSelect\.value/);
});

test("web UI auto-runs analysis after target selection changes when a save is loaded", () => {
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");

  assert.match(app, /targetSelect\.addEventListener\("change",\s*analyzeIfReady\)/);
  assert.match(app, /function analyzeIfReady\(\)/);
  assert.match(app, /els\.saveInput\.value\.trim\(\)/);
});

test("web UI exposes priority 13 planner controls and panels", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "web", "styles.css"), "utf8");

  for (const id of [
    "targetFilterInput",
    "observedOutcomeSelect",
    "traceSecondsInput",
    "strategyPresetButtons",
    "compareTargetsButton",
    "fullComparePanel",
    "diagnosticWhyPanel",
    "confidenceBadge",
    "sanityChecksList",
    "mechanicWarningsList",
    "observationMismatch",
    "extremeStatsList",
    "assumptionComparisonTable",
    "fightTraceList",
    "nextActionPanel",
    "routePlannerList",
    "routePreviewList",
    "rollWishlistList",
    "rollWishlistSummary",
    "sketchDeltaPanel",
    "mobileTabBar",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /active-run-section/);
  assert.match(html, /id="sketchDeltaPanel"[^>]+data-mobile-panel="planner"/);
  assert.match(app, /scheduleAnalyze\(/);
  assert.match(app, /function hasSelectedTarget/);
  assert.match(app, /No targets match the filter/);
  assert.match(app, /renderTargetComparisons/);
  assert.match(app, /renderDiagnostics/);
  assert.match(app, /renderFightTrace/);
  assert.match(app, /observedOutcome/);
  assert.match(app, /renderRoutePreview/);
  assert.match(app, /renderRollWishlist/);
  assert.match(app, /renderSketchDelta/);
  assert.match(app, /applyStrategyPreset/);
  assert.match(app, /setMobileTab\("results"\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.mobile-tab-bar/);
  assert.match(css, /body\[data-mobile-tab="results"\] \.active-run-section/);
});

test("web UI splits desktop functions into workspace tabs", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "web", "styles.css"), "utf8");

  assert.match(html, /id="functionTabBar"/);
  for (const tab of ["results", "run", "strategy", "diagnostics", "compare-history"]) {
    assert.match(html, new RegExp(`data-function-tab="${tab}"`));
    assert.match(css, new RegExp(`body\\[data-function-tab="${tab}"\\]`));
  }

  for (const panel of ["results", "strategy", "diagnostics", "compare-history"]) {
    assert.match(html, new RegExp(`data-function-panel="${panel}"`));
  }

  assert.match(html, /id="currentSpecsPanel"[^>]+data-function-panel="run"/);
  assert.match(app, /functionTabBar:\s*document\.querySelector\("#functionTabBar"\)/);
  assert.match(app, /setFunctionTab\("results"\)/);
  assert.match(app, /function setFunctionTab\(tab\)/);
  assert.match(app, /rd-sim-function-tab/);
  assert.match(css, /\.function-tab-bar/);
  assert.match(css, /body\[data-function-tab="run"\] \.main-stack/);
});

test("web UI uses the Rejected Draft sketchbook design system", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "web", "styles.css"), "utf8");

  for (const id of [
    "resourceStrip",
    "stripQ",
    "stripWin",
    "stripTarget",
    "currentSpecsPanel",
    "protocolRail",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  for (const token of [
    "--paper",
    "--paper-grid",
    "--ink",
    "--charcoal",
    "--mint",
    "--cyan",
    "--orange",
    "--violet",
    "--danger",
  ]) {
    assert.match(css, new RegExp(escapeRegExp(token)));
  }

  assert.match(css, /font-family:\s*Georgia/);
  assert.match(css, /\.resource-strip/);
  assert.match(css, /\.protocol-rail/);
  assert.match(css, /\.stat-matrix/);
  assert.match(css, /\.sketch-frame/);
  assert.match(css, /background-image:[\s\S]*linear-gradient/);
  assert.match(app, /function renderResourceStrip/);
  assert.match(app, /renderResourceStrip\(analysis\)/);
});

test("web UI keeps popups and dropdowns in the dark design system", () => {
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "web", "styles.css"), "utf8");

  assert.match(css, /select option/);
  assert.match(css, /background:\s*var\(--charcoal-2\)/);
  assert.doesNotMatch(app, /#fff6f5|#f2fbf5|#f0c7c4|#b8e2c6/);
});

test("web UI completes priority 19 polish, density controls, and diagnostics", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "web", "styles.css"), "utf8");
  const improvements = fs.readFileSync(path.join(projectRoot, "Improvements.md"), "utf8");

  for (const id of [
    "densityModeSelect",
    "uiDiagnosticsPanel",
    "uiDiagnosticsBadge",
    "uiDiagnosticsList",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  for (const pattern of [
    /data-tooltip=/,
    /function applyDensityMode/,
    /function collectUiDiagnostics/,
    /function renderUiDiagnostics/,
    /rd-sim-density/,
    /renderUiDiagnostics\(\)/,
  ]) {
    assert.match(`${html}\n${app}`, pattern);
  }

  for (const pattern of [
    /Theme token checklist/,
    /scrollbar-color/,
    /::-webkit-scrollbar/,
    /:focus-visible/,
    /\[data-tooltip\]::after/,
    /::file-selector-button/,
    /input:invalid/,
    /select:invalid/,
    /body\[data-density="compact"\]/,
    /body\[data-density="dense"\]/,
    /\.ui-diagnostics/,
    /::selection/,
    /@media \(prefers-reduced-motion: reduce\)/,
  ]) {
    assert.match(css, pattern);
  }

  assert.match(
    improvements,
    /- DONE: Audit every UI surface for the dark Rejected Draft design system/,
  );
  assert.match(improvements, /- DONE: Add a "UI diagnostics" page or CLI command/);

  for (const fileName of ["priority19-desktop.png", "priority19-mobile.png"]) {
    assert.ok(
      fs.existsSync(path.join(projectRoot, "docs", "visual-regression", fileName)),
      `${fileName} should be kept as a visual regression reference`,
    );
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
