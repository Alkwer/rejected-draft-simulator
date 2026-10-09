const els = {
  bundleStatus: document.querySelector("#bundleStatus"),
  stripQ: document.querySelector("#stripQ"),
  stripQDelta: document.querySelector("#stripQDelta"),
  stripTarget: document.querySelector("#stripTarget"),
  stripWin: document.querySelector("#stripWin"),
  stripWinDetail: document.querySelector("#stripWinDetail"),
  stripTimeout: document.querySelector("#stripTimeout"),
  stripTimeDetail: document.querySelector("#stripTimeDetail"),
  stripDecision: document.querySelector("#stripDecision"),
  stripBundle: document.querySelector("#stripBundle"),
  currentSpecsGrid: document.querySelector("#currentSpecsGrid"),
  importBundleButton: document.querySelector("#importBundleButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  compareTargetsButton: document.querySelector("#compareTargetsButton"),
  saveInput: document.querySelector("#saveInput"),
  saveFile: document.querySelector("#saveFile"),
  saveFileLabel: document.querySelector("#saveFileLabel"),
  clearButton: document.querySelector("#clearButton"),
  targetFilterInput: document.querySelector("#targetFilterInput"),
  targetSelect: document.querySelector("#targetSelect"),
  trialsSelect: document.querySelector("#trialsSelect"),
  maxSecondsInput: document.querySelector("#maxSecondsInput"),
  observedOutcomeSelect: document.querySelector("#observedOutcomeSelect"),
  traceSecondsInput: document.querySelector("#traceSecondsInput"),
  densityModeSelect: document.querySelector("#densityModeSelect"),
  strategyPresetButtons: document.querySelector("#strategyPresetButtons"),
  strategyProfileSelect: document.querySelector("#strategyProfileSelect"),
  strategyModeSelect: document.querySelector("#strategyModeSelect"),
  strategyCompareProfilesInput: document.querySelector("#strategyCompareProfilesInput"),
  strategyGoalQInput: document.querySelector("#strategyGoalQInput"),
  strategyGoalCurrencyInput: document.querySelector("#strategyGoalCurrencyInput"),
  strategySoftcapSecondsInput: document.querySelector("#strategySoftcapSecondsInput"),
  strategyFarmSecondsInput: document.querySelector("#strategyFarmSecondsInput"),
  strategyBoosterCandidatesInput: document.querySelector("#strategyBoosterCandidatesInput"),
  clearRouteButton: document.querySelector("#clearRouteButton"),
  routePlannerList: document.querySelector("#routePlannerList"),
  activeSketches: document.querySelector("#activeSketches"),
  activeCount: document.querySelector("#activeCount"),
  messageBar: document.querySelector("#messageBar"),
  nextActionBadge: document.querySelector("#nextActionBadge"),
  nextActionBody: document.querySelector("#nextActionBody"),
  targetLabel: document.querySelector("#targetLabel"),
  winRate: document.querySelector("#winRate"),
  winRateCi: document.querySelector("#winRateCi"),
  timeoutRate: document.querySelector("#timeoutRate"),
  fightTime: document.querySelector("#fightTime"),
  decision: document.querySelector("#decision"),
  decisionReason: document.querySelector("#decisionReason"),
  failureBreakdown: document.querySelector("#failureBreakdown"),
  thresholds: document.querySelector("#thresholds"),
  confidenceBadge: document.querySelector("#confidenceBadge"),
  whyResultList: document.querySelector("#whyResultList"),
  sanityChecksList: document.querySelector("#sanityChecksList"),
  mechanicWarningsList: document.querySelector("#mechanicWarningsList"),
  observationMismatch: document.querySelector("#observationMismatch"),
  extremeStatsList: document.querySelector("#extremeStatsList"),
  assumptionComparisonTable: document.querySelector("#assumptionComparisonTable"),
  fightTraceList: document.querySelector("#fightTraceList"),
  strategySummary: document.querySelector("#strategySummary"),
  strategyDecision: document.querySelector("#strategyDecision"),
  strategyReadiness: document.querySelector("#strategyReadiness"),
  strategySoftcap: document.querySelector("#strategySoftcap"),
  strategySoftcapReason: document.querySelector("#strategySoftcapReason"),
  strategyFarmGoal: document.querySelector("#strategyFarmGoal"),
  strategyFarmEta: document.querySelector("#strategyFarmEta"),
  strategyOpusList: document.querySelector("#strategyOpusList"),
  strategyDecisionsList: document.querySelector("#strategyDecisionsList"),
  strategyProfileList: document.querySelector("#strategyProfileList"),
  economyBuyList: document.querySelector("#economyBuyList"),
  economyBottleneckList: document.querySelector("#economyBottleneckList"),
  economyForecastList: document.querySelector("#economyForecastList"),
  economyWasteList: document.querySelector("#economyWasteList"),
  sketchDeltaName: document.querySelector("#sketchDeltaName"),
  sketchDeltaBody: document.querySelector("#sketchDeltaBody"),
  rollWishlistSummary: document.querySelector("#rollWishlistSummary"),
  rollWishlistList: document.querySelector("#rollWishlistList"),
  routePreviewSummary: document.querySelector("#routePreviewSummary"),
  routePreviewList: document.querySelector("#routePreviewList"),
  buildComparison: document.querySelector("#buildComparison"),
  uiDiagnosticsBadge: document.querySelector("#uiDiagnosticsBadge"),
  uiDiagnosticsList: document.querySelector("#uiDiagnosticsList"),
  fullComparePanel: document.querySelector("#fullComparePanel"),
  fullCompareTable: document.querySelector("#fullCompareTable"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  functionTabBar: document.querySelector("#functionTabBar"),
  mobileTabBar: document.querySelector("#mobileTabBar"),
};

const state = {
  assumed: new Map(),
  routeIds: [],
  hiddenSketchIds: new Set(),
  targetOptions: [],
  activeSketches: [],
  selectedSketchId: null,
  autoAnalyzeTimer: null,
  lastAnalysis: null,
  isBusy: false,
};

init();

async function init() {
  applyDensityMode(localStorage.getItem("rd-sim-density") ?? "comfortable");
  bindEvents();
  const savedFunctionTab = localStorage.getItem("rd-sim-function-tab");
  if (savedFunctionTab) setFunctionTab(savedFunctionTab);
  else setFunctionTab("results");
  setMobileTab("results");
  renderHistory();
  renderUiDiagnostics();
  await loadTargets();
  renderUiDiagnostics();
}

function bindEvents() {
  els.importBundleButton.addEventListener("click", importBundle);
  els.analyzeButton.addEventListener("click", analyze);
  els.targetSelect.addEventListener("change", analyzeIfReady);
  els.compareTargetsButton.addEventListener("click", toggleFullCompare);
  els.targetFilterInput.addEventListener("input", () => {
    renderTargetOptions();
    analyzeIfReady();
  });
  els.trialsSelect.addEventListener("change", scheduleAnalyze);
  els.maxSecondsInput.addEventListener("input", scheduleAnalyze);
  els.observedOutcomeSelect.addEventListener("change", scheduleAnalyze);
  els.traceSecondsInput.addEventListener("input", scheduleAnalyze);
  els.densityModeSelect.addEventListener("change", () => {
    applyDensityMode(els.densityModeSelect.value);
    renderUiDiagnostics();
  });
  for (const input of [
    els.strategyProfileSelect,
    els.strategyModeSelect,
    els.strategyCompareProfilesInput,
    els.strategyGoalQInput,
    els.strategyGoalCurrencyInput,
    els.strategySoftcapSecondsInput,
    els.strategyFarmSecondsInput,
    els.strategyBoosterCandidatesInput,
  ]) {
    input.addEventListener("input", scheduleAnalyze);
  }
  els.strategyPresetButtons.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-strategy-preset]")?.dataset.strategyPreset;
    if (preset) applyStrategyPreset(preset);
  });
  els.clearRouteButton.addEventListener("click", () => {
    state.routeIds = [];
    renderRoutePlanner();
    scheduleAnalyze();
  });
  els.functionTabBar.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-function-tab]")?.dataset.functionTab;
    if (tab) setFunctionTab(tab);
  });
  els.mobileTabBar.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-mobile-tab]")?.dataset.mobileTab;
    if (tab) setMobileTab(tab);
  });
  els.clearButton.addEventListener("click", () => {
    els.saveInput.value = "";
    els.saveFile.value = "";
    els.saveFileLabel.textContent = "Choose save file";
    state.assumed.clear();
    state.routeIds = [];
    state.hiddenSketchIds.clear();
    state.selectedSketchId = null;
    renderActiveSketches([]);
    renderRoutePlanner();
  });
  els.saveFile.addEventListener("change", async () => {
    const [file] = els.saveFile.files;
    if (!file) return;
    els.saveFileLabel.textContent = file.name;
    els.saveInput.value = await file.text();
    analyzeIfReady();
  });
  els.clearHistoryButton.addEventListener("click", () => {
    localStorage.removeItem("rd-sim-history");
    renderHistory();
  });
}

function analyzeIfReady() {
  if (state.isBusy || !els.saveInput.value.trim() || !hasSelectedTarget()) return;
  analyze();
}

function scheduleAnalyze() {
  if (!els.saveInput.value.trim() || !hasSelectedTarget()) return;
  window.clearTimeout(state.autoAnalyzeTimer);
  state.autoAnalyzeTimer = window.setTimeout(analyzeIfReady, 450);
}

async function loadTargets() {
  const data = await api("/api/targets");
  renderBundle(data.bundle);
  state.targetOptions = data.targets;
  renderTargetOptions();
}

function renderTargetOptions() {
  const current = els.targetSelect.value;
  const queryTokens = els.targetFilterInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const targets = state.targetOptions.filter((target) => (
    queryTokens.length === 0 || queryTokens.every((token) => target.searchText?.includes(token))
  ));
  els.targetSelect.innerHTML = "";
  if (targets.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No targets match the filter";
    option.disabled = true;
    option.selected = true;
    els.targetSelect.append(option);
    return;
  }
  for (const target of targets) {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = `${target.name} (${target.rarity})`;
    els.targetSelect.append(option);
  }
  const currentOption = [...els.targetSelect.options].find((option) => option.value === current);
  const duct = [...els.targetSelect.options].find((option) => option.value === "duct_taped_banana");
  if (currentOption) currentOption.selected = true;
  else if (duct) duct.selected = true;
  else if (els.targetSelect.options[0]) els.targetSelect.options[0].selected = true;
}

function hasSelectedTarget() {
  return Boolean(els.targetSelect.value && !els.targetSelect.selectedOptions[0]?.disabled);
}

async function importBundle() {
  setBusy(true);
  try {
    const data = await api("/api/import-bundle", { method: "POST" });
    renderBundle(data.bundle);
    if (data.update?.offline) {
      showMessage("No internet connection. Using the last local data bundle.", "ok");
    } else {
      showMessage("Bundle imported.", "ok");
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(false);
  }
}

async function analyze() {
  if (!hasSelectedTarget()) {
    showMessage("Choose a target before running the simulation.");
    return;
  }
  setBusy(true);
  hideMessage();
  try {
    const payload = {
      saveText: els.saveInput.value,
      targetId: els.targetSelect.value,
      assumedVictories: assumedVictoriesPayload(),
      routeIds: state.routeIds,
      trials: els.trialsSelect.value,
      maxSeconds: Number(els.maxSecondsInput.value || 300),
      observedOutcome: els.observedOutcomeSelect.value,
      traceSeconds: Number(els.traceSecondsInput.value || 60),
      strategyOptions: strategyOptionsPayload(),
      seed: `web-${Date.now()}`,
    };
    const data = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.lastAnalysis = data.analysis;
    renderAnalysis(data.analysis);
    pushHistory(data.analysis);
    renderHistory();
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(false);
  }
}

function renderAnalysis(analysis) {
  renderBundle(analysis.bundle);
  renderResourceStrip(analysis);
  renderCurrentSpecs(analysis.finalStats);
  renderActiveSketches(analysis.activeSketches);
  renderResult(analysis);
  renderDiagnostics(analysis.diagnostics);
  renderAssumptionComparisons(analysis.assumptionComparisons);
  renderFightTrace(analysis.fightTrace);
  renderNextAction(analysis);
  renderStrategyPlan(analysis.strategicPlan);
  renderSketchDelta(analysis);
  renderRollWishlist(analysis.rollWishlist);
  renderRoutePlanner();
  renderRoutePreview(analysis.routePreview);
  renderTargetComparisons(analysis.targetComparisons);
  renderBuildComparison(analysis.buildComparison);
  renderHistory();
  renderUiDiagnostics();
}

function renderBundle(bundle) {
  if (!bundle) return;
  const parts = [
    bundle.gameVersion ?? "unknown",
    `${bundle.totalSketches ?? 0} sketches`,
    bundle.asset ?? "local data",
  ];
  els.bundleStatus.textContent = `Bundle: ${parts.join(" | ")}`;
  if (els.stripBundle) {
    els.stripBundle.textContent = bundle.gameVersion ?? "local";
  }
}

function renderResourceStrip(analysis) {
  if (!analysis) return;
  const result = analysis.result ?? {};
  const q = analysis.strategicPlan?.approach?.resources?.quintessence;
  const farm = analysis.strategicPlan?.farmPlan?.goal;
  els.stripQ.textContent = q?.current == null ? "--" : formatNumber(q.current);
  els.stripQDelta.textContent = q?.missing > 0 ? `missing ${formatNumber(q.missing)}` : farm?.estimatedSeconds != null ? `ETA ${seconds(farm.estimatedSeconds)}` : "ready";
  els.stripTarget.textContent = analysis.target?.name ?? "--";
  els.stripWin.textContent = percent(result.winRate);
  els.stripWinDetail.textContent = `+/- ${percent(result.winRateCi95?.halfWidth ?? 0)}`;
  els.stripTimeout.textContent = percent(result.timeoutRate ?? 0);
  els.stripTimeDetail.textContent = `p90 ${seconds(result.p90Seconds)}`;
  els.stripDecision.textContent = compactDecision(analysis.recommendation?.action ?? "--");
}

function renderCurrentSpecs(stats = {}) {
  if (!els.currentSpecsGrid) return;
  for (const cell of els.currentSpecsGrid.querySelectorAll("[data-stat-key]")) {
    const key = cell.dataset.statKey;
    const value = stats?.[key];
    cell.querySelector("strong").textContent = value == null ? "--" : formatNumber(value);
  }
}

function renderActiveSketches(items) {
  state.activeSketches = items;
  const visibleItems = items.filter((item) => !state.hiddenSketchIds.has(item.id));
  syncAssumptionsWithItems(visibleItems);
  if (!state.selectedSketchId || !visibleItems.some((item) => item.id === state.selectedSketchId)) {
    state.selectedSketchId = visibleItems[0]?.id ?? null;
  }
  els.activeCount.textContent = String(visibleItems.length);
  els.activeSketches.innerHTML = "";
  if (visibleItems.length === 0) {
    els.activeSketches.className = "sketch-list empty-state";
    els.activeSketches.textContent = "No data";
    return;
  }
  els.activeSketches.className = "sketch-list";
  for (const item of visibleItems) {
    const maxCount = Math.max(0, Number(item.remainingToMax) || 0);
    const count = getAssumedCount(item.id);
    const row = document.createElement("div");
    row.className = "sketch-row";
    row.dataset.sketchId = item.id;
    row.innerHTML = `
      <input class="assumed-toggle" type="checkbox" title="Assume defeated before target" aria-label="Assume ${escapeHtml(item.name)} defeated before target" ${count > 0 ? "checked" : ""}>
      <span class="sketch-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.id)} | ${escapeHtml(item.rarity)} | kills ${item.runVictories}/${item.runVictories + maxCount} | left ${maxCount}</span>
      </span>
      <span class="kill-controls">
        <input class="kill-count" type="number" min="0" max="${maxCount}" step="1" value="${count}" title="Extra kills">
        <button class="mini-button" type="button" data-tooltip="Assume all remaining kills">Max</button>
      </span>
      <span class="quick-actions">
        <button class="mini-button assume-one-button" type="button" title="Assume 1 kill" data-tooltip="Assume one extra kill">1</button>
        <button class="mini-button route-button" type="button" title="Add to route" data-tooltip="Add to route preview">Route</button>
        <button class="mini-button target-button" type="button" title="Simulate as target" data-tooltip="Simulate this sketch as target">Target</button>
        <button class="mini-button hide-button" type="button" title="Hide in UI" data-tooltip="Hide from this UI session">Hide</button>
      </span>
      <span class="sketch-rate">${percent(item.winRate)}</span>
    `;
    const toggle = row.querySelector(".assumed-toggle");
    const countInput = row.querySelector(".kill-count");
    const maxButton = row.querySelector(".mini-button");
    const assumeOneButton = row.querySelector(".assume-one-button");
    const routeButton = row.querySelector(".route-button");
    const targetButton = row.querySelector(".target-button");
    const hideButton = row.querySelector(".hide-button");
    const updateControls = () => {
      const nextCount = getAssumedCount(item.id);
      toggle.checked = nextCount > 0;
      countInput.value = String(nextCount);
      row.classList.toggle("selected", nextCount > 0);
      row.classList.toggle("inspected", state.selectedSketchId === item.id);
    };
    row.addEventListener("click", (event) => {
      if (event.target.closest("button,input")) return;
      state.selectedSketchId = item.id;
      renderActiveSketches(state.activeSketches);
      renderSketchDelta(state.lastAnalysis);
    });
    toggle.addEventListener("change", () => {
      setAssumedCount(item.id, toggle.checked ? Math.max(1, getAssumedCount(item.id)) : 0, maxCount);
      updateControls();
      scheduleAnalyze();
    });
    countInput.addEventListener("input", () => {
      setAssumedCount(item.id, countInput.value, maxCount);
      updateControls();
      scheduleAnalyze();
    });
    maxButton.addEventListener("click", () => {
      setAssumedCount(item.id, maxCount, maxCount);
      updateControls();
      scheduleAnalyze();
    });
    assumeOneButton.addEventListener("click", () => {
      setAssumedCount(item.id, 1, maxCount);
      updateControls();
      scheduleAnalyze();
    });
    routeButton.addEventListener("click", () => {
      addRouteId(item.id);
      state.selectedSketchId = item.id;
      renderRoutePlanner();
      renderSketchDelta(state.lastAnalysis);
      scheduleAnalyze();
    });
    targetButton.addEventListener("click", () => {
      selectTarget(item.id);
      state.selectedSketchId = item.id;
      analyzeIfReady();
    });
    hideButton.addEventListener("click", () => {
      state.hiddenSketchIds.add(item.id);
      state.assumed.delete(item.id);
      state.routeIds = state.routeIds.filter((id) => id !== item.id);
      renderActiveSketches(state.activeSketches);
      renderRoutePlanner();
      scheduleAnalyze();
    });
    updateControls();
    els.activeSketches.append(row);
  }
}

function renderResult(analysis) {
  const result = analysis.result;
  els.targetLabel.textContent = analysis.target.name;
  els.winRate.textContent = percent(result.winRate);
  els.winRateCi.textContent = `+/- ${percent(result.winRateCi95?.halfWidth ?? 0)} | ${result.trials} attempts`;
  els.timeoutRate.textContent = percent(result.timeoutRate ?? 0);
  els.fightTime.textContent = `median ${seconds(result.medianSeconds)} | p90 ${seconds(result.p90Seconds)}${timeLimitNote(result)}`;
  els.decision.textContent = analysis.recommendation.action;
  els.decisionReason.textContent = analysis.recommendation.targetId ?? analysis.recommendation.reason;

  renderBreakdown(analysis.report.breakdowns.failures);
  renderThresholds(analysis.report.thresholds);
}

function timeLimitNote(result = {}) {
  if (!result.timeLimit?.extended) return "";
  return ` | window extended ${seconds(result.timeLimit.configuredMaxSeconds)} -> ${seconds(result.timeLimit.effectiveMaxSeconds)}`;
}

function renderBreakdown(items) {
  els.failureBreakdown.innerHTML = "";
  if (!items || items.length === 0) {
    els.failureBreakdown.className = "breakdown-list empty-state";
    els.failureBreakdown.textContent = "No failures";
    return;
  }
  els.failureBreakdown.className = "breakdown-list";
  for (const item of items.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "breakdown-item";
    row.innerHTML = `<strong>${escapeHtml(item.code)}</strong><span>${item.count} | ${percent(item.rate)}</span>`;
    els.failureBreakdown.append(row);
  }
}

function renderThresholds(items) {
  els.thresholds.innerHTML = "";
  if (!items || items.length === 0) {
    els.thresholds.className = "threshold-list empty-state";
    els.thresholds.textContent = "No data";
    return;
  }
  els.thresholds.className = "threshold-list";
  for (const item of items.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "threshold-item";
    row.innerHTML = `<strong>${escapeHtml(item.stat)}</strong><span>${formatNumber(item.current)} / ${formatNumber(item.target)}</span>`;
    els.thresholds.append(row);
  }
}

function renderDiagnostics(diagnostics) {
  if (!diagnostics) {
    els.confidenceBadge.textContent = "none";
    renderSimpleList(els.whyResultList, []);
    renderSimpleList(els.sanityChecksList, []);
    renderSimpleList(els.mechanicWarningsList, []);
    renderSimpleList(els.observationMismatch, []);
    renderSimpleList(els.extremeStatsList, []);
    return;
  }

  const confidence = diagnostics.confidence ?? {};
  els.confidenceBadge.textContent = `confidence: ${confidence.label ?? confidence.level ?? "none"}`;
  els.confidenceBadge.className = `counter confidence-badge ${confidence.level ?? "unknown"}`;
  renderSimpleList(els.whyResultList, (diagnostics.why ?? []).slice(0, 6).map((item) => ({
    title: item.title ?? item.code,
    detail: item.detail ?? item.code,
  })));
  renderSimpleList(els.sanityChecksList, (diagnostics.sanityChecks ?? []).map((item) => ({
    title: `${item.status}: ${item.title}`,
    detail: item.detail,
  })));
  renderSimpleList(els.mechanicWarningsList, (diagnostics.warnings ?? []).map((item) => ({
    title: `${item.severity}: ${item.title}`,
    detail: item.detail,
  })));
  renderSimpleList(els.observationMismatch, diagnostics.observation?.status && diagnostics.observation.status !== "none"
    ? [{
      title: `${diagnostics.observation.status}: ${diagnostics.observation.code}`,
      detail: diagnostics.observation.detail,
    }]
    : []);
  renderSimpleList(els.extremeStatsList, (diagnostics.extremes ?? []).slice(0, 8).map((item) => ({
    title: `${item.severity}: ${item.stat}`,
    detail: item.interpretation,
  })));
}

function renderAssumptionComparisons(items = []) {
  els.assumptionComparisonTable.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.label ?? item.id)}</td>
      <td>${percent(item.winRate)}</td>
      <td>${signedPercent(item.deltaWinRate)}</td>
      <td>${percent(item.timeoutRate)}</td>
      <td>${seconds(item.p90Seconds)}</td>
      <td>${escapeHtml(item.problem ?? "none")}</td>
    `;
    els.assumptionComparisonTable.append(row);
  }
}

function renderFightTrace(trace) {
  const events = trace?.events ?? [];
  if (events.length === 0) {
    renderSimpleList(els.fightTraceList, []);
    els.fightTraceList.textContent = "No trace";
    return;
  }
  renderSimpleList(els.fightTraceList, events.slice(0, 24).map((event) => ({
    title: `${seconds(event.time)} ${event.event}`,
    detail: `${traceAction(event)} | HP P ${formatNumber(event.playerHp)} / E ${formatNumber(event.enemyHp)} | dmg P/E ${formatNumber(event.damage?.player?.total)} / ${formatNumber(event.damage?.enemy?.total)} | status ${traceStatuses(event.statuses)}`,
  })));
}

function traceAction(event) {
  if (event.winner) return `${event.winner}: ${event.reason}`;
  if (event.action?.type) return `${event.attackerSide}->${event.defenderSide} ${event.action.type}`;
  return event.attackerSide ? `${event.attackerSide}->${event.defenderSide}` : "snapshot";
}

function traceStatuses(statuses = {}) {
  const format = (side) => Object.entries(side ?? {})
    .filter(([, value]) => Number(value) > 0)
    .slice(0, 4)
    .map(([key, value]) => `${key}:${formatNumber(value)}`)
    .join(", ") || "none";
  return `P ${format(statuses.player)} / E ${format(statuses.enemy)}`;
}

function renderNextAction(analysis) {
  const action = chooseNextAction(analysis);
  els.nextActionBadge.textContent = action.badge;
  els.nextActionBody.className = "next-action-body";
  els.nextActionBody.innerHTML = `
    <strong>${escapeHtml(action.title)}</strong>
    <span>${escapeHtml(action.detail)}</span>
  `;
}

function chooseNextAction(analysis) {
  const targetWin = Number(analysis.result?.winRate ?? 0);
  const bestActive = [...analysis.activeSketches ?? []]
    .filter((item) => !state.hiddenSketchIds.has(item.id))
    .sort((a, b) => b.winRate - a.winRate || a.p90Seconds - b.p90Seconds)[0];
  const softcap = analysis.strategicPlan?.softcap;
  const recommendation = analysis.recommendation?.action ?? "";

  if (targetWin >= 0.5) {
    return { badge: "target", title: `Fight ${analysis.target.name}`, detail: `Target has ${percent(targetWin)} win rate.` };
  }
  if (bestActive && bestActive.winRate >= 0.8) {
    return { badge: "farm", title: `Finish ${bestActive.name}`, detail: `Best active sketch has ${percent(bestActive.winRate)} and p90 ${seconds(bestActive.p90Seconds)}.` };
  }
  if (softcap?.decision === "wait_softcap") {
    return { badge: "softcap", title: "Wait for softcap", detail: softcap.secondsToSoftcap == null ? softcap.reason : `${seconds(softcap.secondsToSoftcap)} | ${softcap.reason}` };
  }
  if (String(recommendation).includes("redraw")) {
    return { badge: "redraw", title: "Consider redraw", detail: analysis.recommendation?.reason ?? "Current run has low expected value." };
  }
  return { badge: "approach", title: "Farm for target", detail: `Target has ${percent(targetWin)}. Look for rewards that improve the largest missing stats.` };
}

function renderSketchDelta(analysis) {
  const delta = analysis?.activeDeltas?.[state.selectedSketchId];
  if (!delta) {
    els.sketchDeltaName.textContent = "none";
    renderSimpleList(els.sketchDeltaBody, []);
    els.sketchDeltaBody.textContent = "Select a sketch from the active run";
    return;
  }
  els.sketchDeltaName.textContent = delta.name ?? delta.id;
  renderSimpleList(els.sketchDeltaBody, [
    {
      title: "Target win rate",
      detail: `${percent(delta.winRate)} (${signedPercent(delta.winRateDelta)}) | p90 ${seconds(delta.p90Seconds)} (${signedSeconds(delta.p90Delta)})`,
    },
    {
      title: "Stat rewards",
      detail: (delta.statRewards ?? []).map((item) => `${item.statName} ${signedNumber(item.amount)}`).join(", ") || "none",
    },
    {
      title: "Currency",
      detail: (delta.currencyRewards ?? []).map((item) => `${item.name} ${formatNumber(item.amount)}`).join(", ") || "none",
    },
  ]);
}

function renderRollWishlist(wishlist) {
  const items = wishlist?.items ?? [];
  els.rollWishlistSummary.textContent = wishlist
    ? `${items.length}/${wishlist.candidateCount ?? 0} shown`
    : "none";
  if (items.length === 0) {
    renderSimpleList(els.rollWishlistList, []);
    els.rollWishlistList.textContent = wishlist ? "No positive non-guaranteed hits found" : "No data";
    return;
  }
  renderSimpleList(els.rollWishlistList, items.map((item, index) => ({
    title: `${index + 1}. ${item.name} [${item.rarity}]`,
    detail: [
      `${item.feasibility}`,
      `target ${percent(item.targetWinRate)} (${signedPercent(item.targetWinRateDelta)})`,
      `kill ${percent(item.candidateWinRate)}`,
      `p90 ${seconds(item.p90Seconds)}`,
      `roll share ${percent(item.rollShare)}`,
      rewardSummary(item),
    ].filter(Boolean).join(" | "),
  })));
}

function rewardSummary(item) {
  const stats = (item.statRewards ?? [])
    .map((reward) => `${reward.name} ${signedNumber(reward.amount)}`)
    .join(", ");
  const currencies = (item.currencyRewards ?? [])
    .map((reward) => `${reward.name} ${formatNumber(reward.amount)}`)
    .join(", ");
  return [stats, currencies].filter(Boolean).join(" / ");
}

function renderRoutePlanner() {
  if (state.routeIds.length === 0) {
    els.routePlannerList.className = "breakdown-list empty-state";
    els.routePlannerList.textContent = "No route";
    return;
  }
  els.routePlannerList.className = "breakdown-list";
  els.routePlannerList.innerHTML = "";
  state.routeIds.forEach((id, index) => {
    const active = state.activeSketches.find((item) => item.id === id);
    const row = document.createElement("div");
    row.className = "route-item";
    row.innerHTML = `
      <span><strong>${index + 1}. ${escapeHtml(active?.name ?? id)}</strong><small>${escapeHtml(id)}</small></span>
      <button class="mini-button" type="button" title="Remove from route" data-tooltip="Remove from route">Remove</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      state.routeIds.splice(index, 1);
      renderRoutePlanner();
      scheduleAnalyze();
    });
    els.routePlannerList.append(row);
  });
}

function renderRoutePreview(preview) {
  const steps = preview?.steps ?? [];
  els.routePreviewSummary.textContent = steps.length === 0 ? "none" : `${steps.length} steps`;
  if (steps.length === 0) {
    renderSimpleList(els.routePreviewList, []);
    els.routePreviewList.textContent = "No route";
    return;
  }
  renderSimpleList(els.routePreviewList, steps.map((step) => ({
    title: `${step.index}. ${step.name}`,
    detail: `target win ${percent(step.targetWinRate)} | p90 ${seconds(step.p90Seconds)} | atk ${formatNumber(step.finalStats?.attack)} | hp ${formatNumber(step.finalStats?.maxHp)}`,
  })));
}

function renderBuildComparison(items) {
  els.buildComparison.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(item.targetName)}</td>
      <td>${item.winRate == null ? "--" : percent(item.winRate)}</td>
      <td>${item.ci95HalfWidth == null ? "--" : `+/- ${percent(item.ci95HalfWidth)}`}</td>
      <td>${item.p90Seconds == null ? "--" : seconds(item.p90Seconds)}</td>
      <td>${escapeHtml(item.problem ?? "none")}</td>
    `;
    els.buildComparison.append(row);
  }
}

function renderTargetComparisons(items = []) {
  els.fullCompareTable.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.source === "key_target" ? "Key" : "Run"}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.rarity)}</td>
      <td>${percent(item.winRate)}</td>
      <td>+/- ${percent(item.ci95HalfWidth)}</td>
      <td>${seconds(item.p90Seconds)}</td>
      <td>${escapeHtml(item.problem ?? "none")}</td>
    `;
    row.addEventListener("click", () => {
      selectTarget(item.id);
      analyzeIfReady();
    });
    els.fullCompareTable.append(row);
  }
}

function renderStrategyPlan(plan) {
  if (!plan) {
    els.strategySummary.textContent = "none";
    els.strategyDecision.textContent = "--";
    els.strategyReadiness.textContent = "--";
    els.strategySoftcap.textContent = "--";
    els.strategySoftcapReason.textContent = "--";
    els.strategyFarmGoal.textContent = "--";
    els.strategyFarmEta.textContent = "--";
    renderSimpleList(els.strategyOpusList, []);
    renderSimpleList(els.strategyDecisionsList, []);
    renderSimpleList(els.strategyProfileList, []);
    renderEconomyPlan(null);
    return;
  }

  const winRate = plan.approach?.winRate;
  const qGap = plan.approach?.resources?.quintessence;
  const farmGoal = plan.farmPlan?.goal ?? {};
  els.strategySummary.textContent = plan.profile?.label ?? plan.target?.name ?? "strategy";
  els.strategyDecision.textContent = compactDecision(plan.approach?.decision);
  els.strategyReadiness.textContent = `win ${percent(winRate?.current)} / ${percent(winRate?.target)}${qGap?.goal == null ? "" : ` | missing Q ${formatNumber(qGap.missing)}`}`;
  els.strategySoftcap.textContent = compactDecision(plan.softcap?.decision);
  els.strategySoftcapReason.textContent = plan.softcap?.secondsToSoftcap == null
    ? plan.softcap?.reason ?? "--"
    : `${seconds(plan.softcap.secondsToSoftcap)} | ${plan.softcap.reason}`;
  els.strategyFarmGoal.textContent = farmGoal.type === "currency"
    ? farmGoal.currency
    : compactDecision(farmGoal.type);
  els.strategyFarmEta.textContent = farmGoal.estimatedSeconds == null
    ? `missing ${formatNumber(farmGoal.missing)}`
    : `missing ${formatNumber(farmGoal.missing)} | ETA ${seconds(farmGoal.estimatedSeconds)}`;

  renderSimpleList(
    els.strategyOpusList,
    (plan.opusValues ?? []).slice(0, 5).map((item) => ({
      title: item.name ?? item.id,
      detail: `score ${formatNumber(item.score)} | currency ${formatNumber(item.currencyScore)} | stat ${formatNumber(item.statScore)}`,
    })),
  );

  const bestBooster = plan.boosters?.recommendation;
  renderSimpleList(els.strategyDecisionsList, [
    {
      title: "Profile",
      detail: `${plan.profile?.id ?? "custom"} | ${plan.profile?.mode?.id ?? "auto"} | ${profileProgressLabel(plan.profileProgress)}`,
    },
    {
      title: "Stop farming",
      detail: `${compactDecision(plan.stopFarming?.decision)} | ${plan.stopFarming?.reason ?? "--"}`,
    },
    {
      title: "Masterpiece roll",
      detail: `${compactDecision(plan.masterpieceRoll?.decision)} | ${plan.masterpieceRoll?.reason ?? "--"}`,
    },
    {
      title: "Run",
      detail: `${compactDecision(plan.runCompletion?.decision)} | ${plan.runCompletion?.reason ?? "--"}`,
    },
    {
      title: "Booster",
      detail: bestBooster ? `${bestBooster.name}: ${bestBooster.ids.join(", ")} | win ${percent(bestBooster.winRate)}` : "no candidates",
    },
  ]);

  renderSimpleList(
    els.strategyProfileList,
    (plan.profileComparison ?? []).map((item) => ({
      title: `${item.label ?? item.id} | ${item.mode}`,
      detail: `runs ${nullableNumber(item.estimatedRuns)} | redraws ${nullableNumber(item.estimatedRedraws)} | best ${item.bestSketchId ?? "none"}`,
    })),
  );
  renderEconomyPlan(plan.economy);
}

function renderEconomyPlan(economy) {
  if (!economy) {
    renderSimpleList(els.economyBuyList, []);
    renderSimpleList(els.economyBottleneckList, []);
    renderSimpleList(els.economyForecastList, []);
    renderSimpleList(els.economyWasteList, []);
    return;
  }

  const buyRows = [
    ...(economy.purchasePlan?.buyNow ?? []).map((item) => ({
      title: `${item.statName} L${item.nextLevel}`,
      detail: `${item.currency} ${formatNumber(item.cost)} | ROI ${formatNumber(item.roi)}`,
    })),
    ...(economy.purchasePlan?.delay ?? []).slice(0, 4).map((item) => ({
      title: `Delay ${item.statName} L${item.nextLevel}`,
      detail: `${item.currency} ${formatNumber(item.currentCurrency)} / ${formatNumber(item.cost)}`,
    })),
  ];
  renderSimpleList(els.economyBuyList, buyRows.slice(0, 8));

  renderSimpleList(
    els.economyBottleneckList,
    (economy.bottlenecks ?? []).slice(0, 8).map((item) => ({
      title: item.currency,
      detail: `${compactDecision(item.reason)} | missing ${formatNumber(item.missing)} | ETA ${item.secondsToClear == null ? "unknown" : seconds(item.secondsToClear)}`,
    })),
  );

  renderSimpleList(
    els.economyForecastList,
    (economy.currencyForecasts ?? []).slice(0, 8).map((item) => ({
      title: item.currency,
      detail: `goal ${formatNumber(item.goal)} | ${formatNumber(item.perSecond)}/s | runs ${nullableNumber(item.runsToGoal)}`,
    })),
  );

  renderSimpleList(
    els.economyWasteList,
    (economy.wastedRewards ?? []).slice(0, 8).map((item) => ({
      title: item.name ?? item.id,
      detail: `${compactDecision(item.reason)} | ${item.detail ?? ""}`,
    })),
  );
}

function renderSimpleList(container, items) {
  container.innerHTML = "";
  if (!items || items.length === 0) {
    container.className = "breakdown-list empty-state";
    container.textContent = "No data";
    return;
  }
  container.className = "breakdown-list";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "breakdown-item";
    row.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span>`;
    container.append(row);
  }
}

function pushHistory(analysis) {
  const history = readHistory();
  history.unshift({
    at: new Date().toLocaleString("en-US"),
    target: analysis.target.name,
    winRate: analysis.result.winRate,
    decision: analysis.recommendation.action,
    assumedCount: analysis.assumedVictoryIds.length,
  });
  localStorage.setItem("rd-sim-history", JSON.stringify(history.slice(0, 12)));
}

function renderHistory() {
  const history = readHistory();
  els.historyList.innerHTML = "";
  if (history.length === 0) {
    els.historyList.className = "history-list empty-state";
    els.historyList.textContent = "No history";
    return;
  }
  els.historyList.className = "history-list";
  for (const item of history) {
    const row = document.createElement("div");
    row.className = "history-item";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.target)}</strong>
        <span>${escapeHtml(item.at)} | ${escapeHtml(item.decision)} | kills ${item.assumedCount}</span>
      </div>
      <strong>${percent(item.winRate)}</strong>
    `;
    els.historyList.append(row);
  }
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem("rd-sim-history") ?? "[]");
  } catch {
    return [];
  }
}

function addRouteId(id) {
  if (!id) return;
  state.routeIds.push(id);
}

function selectTarget(id) {
  if (!state.targetOptions.some((target) => target.id === id)) return;
  els.targetFilterInput.value = "";
  renderTargetOptions();
  const option = [...els.targetSelect.options].find((item) => item.value === id);
  if (option) option.selected = true;
}

function toggleFullCompare() {
  if (document.body.dataset.functionTab !== "compare-history") {
    setFunctionTab("compare-history");
    els.fullComparePanel.classList.remove("hidden");
    return;
  }
  els.fullComparePanel.classList.toggle("hidden");
}

function applyStrategyPreset(preset) {
  const setTargetIfExists = (id) => {
    if (state.targetOptions.some((target) => target.id === id)) selectTarget(id);
  };

  if (preset === "farm-q") {
    els.strategyProfileSelect.value = "farm-q";
    els.strategyModeSelect.value = "safe-farm";
    els.strategyGoalQInput.value = "1e230";
    els.strategyGoalCurrencyInput.value = "";
    els.strategySoftcapSecondsInput.value = "600";
    els.strategyFarmSecondsInput.value = "3600";
  } else if (preset === "farm-currency") {
    els.strategyProfileSelect.value = "farm-photon";
    els.strategyModeSelect.value = "greedy-farm";
    els.strategyGoalQInput.value = "";
    els.strategyGoalCurrencyInput.value = "Photon=1e230";
    els.strategySoftcapSecondsInput.value = "600";
    els.strategyFarmSecondsInput.value = "3600";
  } else if (preset === "masterpiece") {
    setTargetIfExists("duct_taped_banana");
    els.strategyProfileSelect.value = "3-masterpiece";
    els.strategyModeSelect.value = "redraw-fishing";
    els.strategyGoalQInput.value = "";
    els.strategyGoalCurrencyInput.value = "Photon=1e230";
    els.strategySoftcapSecondsInput.value = "900";
    els.strategyFarmSecondsInput.value = "3600";
  } else if (preset === "paragon") {
    setTargetIfExists("transcendent_paragon");
    els.strategyProfileSelect.value = "transcendent-paragon";
    els.strategyModeSelect.value = "boss-approach";
    els.strategyGoalQInput.value = "1e230";
    els.strategyGoalCurrencyInput.value = "";
    els.strategySoftcapSecondsInput.value = "1800";
    els.strategyFarmSecondsInput.value = "7200";
  } else if (preset === "finish-run") {
    els.strategyProfileSelect.value = "";
    els.strategyModeSelect.value = "";
    els.strategyGoalQInput.value = "";
    els.strategyGoalCurrencyInput.value = "";
    els.strategySoftcapSecondsInput.value = "";
    els.strategyFarmSecondsInput.value = "1800";
  }
  scheduleAnalyze();
}

function setMobileTab(tab) {
  document.body.dataset.mobileTab = tab;
  for (const button of els.mobileTabBar.querySelectorAll("[data-mobile-tab]")) {
    button.classList.toggle("selected", button.dataset.mobileTab === tab);
  }
}

function setFunctionTab(tab) {
  const validTabs = ["results", "run", "strategy", "diagnostics", "compare-history"];
  const normalized = validTabs.includes(tab) ? tab : "results";
  document.body.dataset.functionTab = normalized;
  localStorage.setItem("rd-sim-function-tab", normalized);
  for (const button of els.functionTabBar.querySelectorAll("[data-function-tab]")) {
    const selected = button.dataset.functionTab === normalized;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
  }
}

function applyDensityMode(mode) {
  const normalized = ["comfortable", "compact", "dense"].includes(mode) ? mode : "comfortable";
  document.body.dataset.density = normalized;
  els.densityModeSelect.value = normalized;
  localStorage.setItem("rd-sim-density", normalized);
}

function renderUiDiagnostics() {
  if (!els.uiDiagnosticsList) return;
  const diagnostics = collectUiDiagnostics();
  const warnings = diagnostics.filter((item) => item.severity !== "ok");
  els.uiDiagnosticsBadge.textContent = warnings.length === 0 ? "OK" : `${warnings.length} warnings`;
  els.uiDiagnosticsBadge.className = `counter confidence-badge ${warnings.length === 0 ? "high" : "medium"}`;

  const rows = diagnostics.length === 0
    ? [{ title: "No UI gaps detected", detail: "Dark theme, labels, tooltips and layout checks passed.", severity: "ok" }]
    : diagnostics;
  els.uiDiagnosticsList.innerHTML = "";
  els.uiDiagnosticsList.className = "breakdown-list";
  for (const item of rows) {
    const row = document.createElement("div");
    row.className = "breakdown-item";
    row.dataset.severity = item.severity ?? "ok";
    row.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span>`;
    els.uiDiagnosticsList.append(row);
  }
}

function collectUiDiagnostics() {
  const diagnostics = [];
  const requiredIds = [
    "resourceStrip",
    "currentSpecsPanel",
    "saveInput",
    "saveFile",
    "targetSelect",
    "trialsSelect",
    "densityModeSelect",
    "activeSketches",
    "strategyPresetButtons",
    "uiDiagnosticsPanel",
    "uiDiagnosticsBadge",
    "uiDiagnosticsList",
    "protocolRail",
  ];
  for (const id of requiredIds) {
    if (!document.getElementById(id)) {
      diagnostics.push({
        severity: "error",
        title: `Missing #${id}`,
        detail: "A required UI surface is missing from the page.",
      });
    }
  }

  const namelessControls = [...document.querySelectorAll("button,input,select,textarea")]
    .filter((control) => !control.closest("[hidden]"))
    .filter((control) => {
      if (control.id && document.querySelector(`label[for="${control.id}"]`)) return false;
      if (control.closest("label")) return false;
      const aria = control.getAttribute("aria-label");
      const title = control.getAttribute("title");
      const tooltip = control.dataset.tooltip;
      const text = control.textContent?.trim();
      return !aria && !title && !tooltip && !text;
    });
  if (namelessControls.length > 0) {
    diagnostics.push({
      severity: "warning",
      title: "Missing accessible labels",
      detail: `${namelessControls.length} controls need visible text, title, aria-label or tooltip.`,
    });
  }

  const tooltipGaps = [...document.querySelectorAll(".icon-only, .protocol-card, [data-strategy-preset], #clearRouteButton")]
    .filter((control) => !control.dataset.tooltip);
  if (tooltipGaps.length > 0) {
    diagnostics.push({
      severity: "warning",
      title: "Missing tooltips",
      detail: `${tooltipGaps.length} icon/planner controls need sketchbook tooltips.`,
    });
  }

  const bodyColor = window.getComputedStyle(document.body).backgroundColor;
  if (bodyColor === "rgb(255, 255, 255)" || bodyColor === "rgb(251, 249, 246)") {
    diagnostics.push({
      severity: "error",
      title: "Light page background",
      detail: `Body background is ${bodyColor}; expected the dark paper token.`,
    });
  }

  const viewportWidth = document.documentElement.clientWidth;
  const overflowItems = [...document.body.querySelectorAll("*")]
    .filter((element) => !element.closest(".table-wrap"))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && (rect.right > viewportWidth + 2 || rect.left < -2));
  if (overflowItems.length > 0) {
    const worst = overflowItems
      .map(({ element, rect }) => ({
        name: element.id ? `#${element.id}` : element.className ? `.${String(element.className).split(/\s+/)[0]}` : element.tagName.toLowerCase(),
        overflow: Math.max(rect.right - viewportWidth, -rect.left),
      }))
      .sort((a, b) => b.overflow - a.overflow)[0];
    diagnostics.push({
      severity: "warning",
      title: "Horizontal overflow",
      detail: `${Math.ceil(worst.overflow)}px overflow near ${worst.name}. Check fixed widths or long labels.`,
    });
  }

  const density = document.body.dataset.density;
  if (!["comfortable", "compact", "dense"].includes(density)) {
    diagnostics.push({
      severity: "warning",
      title: "Density mode missing",
      detail: "Set comfortable, compact or dense density so large run lists remain usable.",
    });
  }

  return diagnostics;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error ?? "API error");
  return data;
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  els.analyzeButton.disabled = isBusy;
  els.importBundleButton.disabled = isBusy;
  els.targetSelect.disabled = isBusy;
}

function showMessage(message, kind = "error") {
  els.messageBar.classList.remove("hidden");
  els.messageBar.classList.toggle("ok", kind === "ok");
  els.messageBar.classList.toggle("error", kind !== "ok");
  els.messageBar.textContent = message;
}

function hideMessage() {
  els.messageBar.classList.add("hidden");
  els.messageBar.classList.remove("ok", "error");
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${(number * 100).toFixed(1)}%`;
}

function signedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "+0.0%";
  return `${number >= 0 ? "+" : ""}${(number * 100).toFixed(1)}%`;
}

function seconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(1)}s`;
}

function signedSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "+0.0s";
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}s`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (Math.abs(number) >= 1e9 || Math.abs(number) < 0.001 && number !== 0) return number.toExponential(2);
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
  return `${Math.round(number * 1000) / 1000}`;
}

function nullableNumber(value) {
  return value == null ? "n/a" : formatNumber(value);
}

function profileProgressLabel(progress) {
  if (!progress) return "no ETA";
  return `runs ${nullableNumber(progress.averageRuns)} | redraws ${nullableNumber(progress.averageRedraws)}`;
}

function signedNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "+0";
  return `${number >= 0 ? "+" : ""}${formatNumber(number)}`;
}

function syncAssumptionsWithItems(items) {
  const limits = new Map(items.map((item) => [item.id, Math.max(0, Number(item.remainingToMax) || 0)]));
  for (const [id, count] of [...state.assumed]) {
    const limit = limits.get(id);
    if (limit == null || limit <= 0) {
      state.assumed.delete(id);
    } else {
      setAssumedCount(id, count, limit);
    }
  }
}

function getAssumedCount(id) {
  return state.assumed.get(id) ?? 0;
}

function setAssumedCount(id, value, maxCount) {
  const count = Math.min(Math.max(0, Math.floor(Number(value) || 0)), Math.max(0, Math.floor(Number(maxCount) || 0)));
  if (count <= 0) state.assumed.delete(id);
  else state.assumed.set(id, count);
}

function assumedVictoriesPayload() {
  return Object.fromEntries([...state.assumed].filter(([, count]) => count > 0));
}

function strategyOptionsPayload() {
  return {
    strategyProfile: els.strategyProfileSelect.value,
    strategyMode: els.strategyModeSelect.value,
    compareProfiles: els.strategyCompareProfilesInput.value.trim(),
    goalQuintessence: els.strategyGoalQInput.value.trim(),
    goalCurrency: els.strategyGoalCurrencyInput.value.trim(),
    softcapSeconds: els.strategySoftcapSecondsInput.value.trim(),
    farmSeconds: els.strategyFarmSecondsInput.value.trim(),
    boosterCandidates: els.strategyBoosterCandidatesInput.value.trim(),
  };
}

function compactDecision(value) {
  return String(value ?? "--").replaceAll("_", " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
