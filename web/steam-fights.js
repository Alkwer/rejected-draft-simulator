const byId = (id) => document.getElementById(id);
const endpoint = "/api/steam-fights";
const outcomeLabels = { win: "Victory", loss: "Defeat", timeout: "Still fighting" };
const rangeLabels = { below: "Shorter than forecast range", within: "Within forecast range",
  above: "Longer than forecast range", indeterminate: "Time limit prevents comparison" };
const watchMessages = {
  waiting: "Waiting for Steam to save a Hyena Hulk result. You can switch back to the game.",
  settings: "Unlock the Combat Log and enable in-game Victory and Defeat notifications in Steam. Save a new pre-fight state or enter this result manually.",
  unavailable: "Waiting for the original Steam slot and its notification history to become available.",
  "missing-timing": "Steam saved a Hyena Hulk result without a combat start time. Enter this result manually.",
  "history-gap": "Steam has rotated the saved notifications for this forecast. Save a new pre-fight state just before your next attempt.",
  "setup-changed": "The combat setup or game version changed. Save a new pre-fight state or enter this result manually.",
  "setup-unverified": "The original Steam save could not be checked. Enter this result manually.",
  superseded: "A newer Hyena Hulk forecast was saved for this slot before a result was found.",
};
const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const timeNumbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
const percentages = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
const seconds = (value) => `${timeNumbers.format(value)} s`;
const quantile = (value, censored) => `${censored ? "≥ " : ""}${seconds(value)}`;
let current = null;
let captureId = null;
let targetsReady = false;
let resultEdited = false;

function status(id, message, error = false) {
  const el = byId(id);
  el.textContent = message;
  el.dataset.error = String(error);
}

async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method, cache: "no-store",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(new Error(payload.error ?? "Request failed."), { status: response.status });
  return payload;
}

function busy(active) {
  byId("captureFields").disabled = active || !targetsReady;
  byId("fightPicker").disabled = active;
  byId("resultFields").disabled = active || !current;
  byId("retryForecast").disabled = active;
}

function sourceLabel(source) {
  return source === "export" ? "Imported save" : source;
}

function pickerOption(fight) {
  const outcome = fight.outcome ?? fight.observation?.outcome;
  const state = fight.pending ? "Forecast pending" : outcome ? outcomeLabels[outcome] : "Awaiting result";
  const target = fight.target ?? fight.forecast.target;
  const option = new Option(`${dateTime.format(new Date(fight.capturedAt))} · ${target.name} · ${state}`, fight.id);
  if (fight.pending) option.dataset.pending = "true";
  return option;
}

function monitorsHyena(fight) {
  return fight.forecast.target.id === "hyena_hulk" && /^slot-[1-6]\.json$/.test(fight.source);
}

function updateWatch(fight, monitorStatus) {
  const observation = fight.observation;
  let message;
  if (observation?.source === "steam-notification") {
    const start = dateTime.format(new Date(observation.startedAt));
    message = `Read from Steam · fight started ${start}. Duration is measured to the result notification and may differ slightly from the Combat Log.`;
  } else if (observation) message = "Result entered manually.";
  else if (monitorsHyena(fight)) message = watchMessages[monitorStatus] ?? watchMessages.waiting;
  else message = "Automatic results are available for Hyena Hulk forecasts captured from a local Steam slot.";
  if (byId("watchStatus").textContent !== message) status("watchStatus", message);
}

function showFight(fight, monitorStatus, preserveDraft = false) {
  const observationChanged = fight.observation && (current?.id !== fight.id || current.revision !== fight.revision);
  const { forecast, observation } = fight;
  const { duration, probabilities, assumptions, enemy, player } = forecast;
  const warnings = forecast.warnings ?? [];
  if (current?.id !== fight.id) byId("manualResult").open = !monitorsHyena(fight) && !fight.observation;
  current = fight;
  const picker = byId("fightPicker");
  const option = pickerOption(fight);
  const previous = [...picker.options].find((item) => item.value === fight.id);
  if (previous) previous.replaceWith(option);
  else picker.prepend(option);
  picker.value = fight.id;
  byId("retryForecast").hidden = true;
  const url = new URL(location.href);
  url.searchParams.set("fight", fight.id);
  history.replaceState(null, "", url);

  byId("emptyFights").hidden = true;
  byId("fightPickerLabel").hidden = false;
  byId("fightDetail").hidden = false;
  byId("fightTitle").textContent = forecast.target.name;
  byId("resultState").textContent = observation ? "Result recorded" : "Awaiting result";
  byId("captureInfo").textContent = `${sourceLabel(fight.source)} · ${dateTime.format(new Date(fight.capturedAt))}`;
  const forecastWarnings = byId("forecastWarnings");
  forecastWarnings.replaceChildren(...warnings.map(({ message }) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
  forecastWarnings.hidden = forecastWarnings.childElementCount === 0;
  byId("forecastOdds").textContent = `Victory ${percentages.format(probabilities.win)} · Defeat ${percentages.format(probabilities.loss)} · At limit ${percentages.format(probabilities.timeout)}`;
  byId("forecastMedian").textContent = `${quantile(duration.medianSeconds, duration.medianCensored)} median`;
  byId("forecastRange").textContent = `${quantile(duration.p10Seconds, duration.p10Censored)} – ${quantile(duration.p90Seconds, duration.p90Censored)}`;
  byId("forecastInfo").textContent = `${forecast.dataMetadata?.buildId ? `Steam build ${forecast.dataMetadata.buildId} · ` : ""}${numbers.format(forecast.trials)} simulated fights · ${seconds(forecast.maxSeconds)} limit · ${numbers.format(enemy.maxHp)} enemy HP${enemy.isPreciseErased ? " after Precise Eraser" : ""}.`;
  byId("actualOutcome").textContent = "—";
  byId("actualTime").textContent = "—";
  byId("actualRange").textContent = "—";
  if (observation) {
    const { outcome, elapsedSeconds, outcomeProbability, medianDeltaSeconds, rangeStatus } = observation;
    const probability = outcomeProbability === null ? "outside comparable window" : `${percentages.format(outcomeProbability)} of trials`;
    byId("actualOutcome").textContent = `${outcomeLabels[outcome]} · ${probability}`;
    const delta = medianDeltaSeconds === null ? "" : medianDeltaSeconds === 0 ? " · matches median"
      : ` · ${seconds(Math.abs(medianDeltaSeconds))} ${medianDeltaSeconds > 0 ? "longer" : "shorter"} than median`;
    const prefix = outcome === "timeout" ? "≥ " : observation.source === "steam-notification" ? "≈ " : "";
    byId("actualTime").textContent = `${prefix}${seconds(elapsedSeconds)}${delta}`;
    byId("actualRange").textContent = rangeLabels[rangeStatus];
  }
  const baseSpeed = assumptions.combatSpeedMultiplier;
  const boost = assumptions.battleSpeedup;
  const speedLabel = boost
    ? `${numbers.format(baseSpeed * boost.multiplier)}× for ${seconds(boost.remainingSeconds)}, then ${numbers.format(baseSpeed)}×`
    : `${numbers.format(baseSpeed)}×`;
  const fields = [
    ["Game patch", fight.gameVersion ?? "Unknown"],
    ["Save schema", forecast.saveVersion ?? "Unknown"],
    ["Simulator model", forecast.modelVersion ?? "Not recorded"],
    ["Catalog patch / build", [forecast.dataMetadata?.gameVersion, forecast.dataMetadata?.buildId].filter(Boolean).join(" / ") || "Unknown"],
    ["Player HP", numbers.format(forecast.player.maxHp)],
    ["Player attack", numbers.format(forecast.player.attack)],
    ["Combat speed", speedLabel],
    ["Universe", assumptions.steam.universeId],
  ];
  if (Number.isFinite(fight.gameSavedAt) && Number.isFinite(new Date(fight.gameSavedAt).getTime())) {
    fields.unshift(["Game saved at", dateTime.format(new Date(fight.gameSavedAt))]);
  }
  byId("snapshotStats").replaceChildren(...fields.flatMap(([key, value]) => {
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = key;
    definition.textContent = value;
    return [term, definition];
  }));
  byId("downloadSave").href = `${endpoint}/${fight.id}/save`;
  if (!preserveDraft) {
    byId("resultOutcome").value = observation?.outcome ?? "";
    byId("resultElapsed").value = observation?.elapsedSeconds ?? "";
    resultEdited = false;
  }
  byId("recordResult").textContent = observation ? "Update result" : "Save result";
  updateWatch(fight, monitorStatus);
  if (observationChanged && byId("archiveComparison").open) loadComparisons();
}

let comparisonRequest = 0;
async function loadComparisons() {
  const request = ++comparisonRequest;
  const container = byId("comparisonGroups");
  container.replaceChildren();
  status("comparisonStatus", "Loading comparisons…");
  try {
    const { groups, excluded } = await api(`${endpoint}/comparisons`);
    if (request !== comparisonRequest) return;
    const messages = [];
    if (!groups.length) messages.push("Record a comparable Steam result to see its group.");
    if (excluded) messages.push(`${excluded} recorded result(s) excluded due to missing version information or an early cutoff.`);
    status("comparisonStatus", messages.join(" "));
    for (const group of groups) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = `${group.target.name} · ${group.fights} ${group.fights === 1 ? "fight" : "fights"}`;
      const details = document.createElement("p");
      details.textContent = `${group.universe} · ${seconds(group.maxSeconds)} limit · ${group.gameVersion} · build ${group.build} · model ${group.modelVersion}`;
      const link = document.createElement("a");
      link.href = `?fight=${encodeURIComponent(group.exampleId)}`;
      link.textContent = "View this setup";
      const table = document.createElement("table");
      table.className = "log-table";
      table.setAttribute("aria-label", `Observed and expected outcomes for ${group.target.name}`);
      const header = table.createTHead().insertRow();
      for (const title of ["Outcome at limit", "Observed", "Expected"]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = title;
        header.append(cell);
      }
      const body = table.createTBody();
      for (const [outcome, label] of Object.entries(outcomeLabels)) {
        const row = body.insertRow();
        const name = document.createElement("th");
        name.scope = "row";
        name.textContent = label;
        row.append(name);
        row.insertCell().textContent = numbers.format(group.observed[outcome]);
        row.insertCell().textContent = numbers.format(group.expected[outcome]);
      }
      section.append(heading, details, table, link);
      container.append(section);
    }
  } catch (error) {
    if (request === comparisonRequest) status("comparisonStatus", error.message, true);
  }
}

byId("archiveComparison").addEventListener("toggle", (event) => {
  if (event.currentTarget.open) loadComparisons();
});

async function loadFight(id, preserveDraft = false) {
  const retry = byId("retryForecast");
  const pending = [...byId("fightPicker").options].some((option) => option.value === id && option.dataset.pending);
  retry.hidden = true;
  if (pending) status("resultStatus", "Finishing the forecast from your saved pre-fight state…");
  try {
    const { fight, monitorStatus } = await api(`${endpoint}/${id}`);
    showFight(fight, monitorStatus, preserveDraft);
    status("resultStatus", "");
  } catch (error) {
    if (pending) {
      retry.dataset.fightId = id;
      retry.hidden = false;
    }
    throw error;
  }
}

let refreshing = false;
async function refreshObservation() {
  const previous = current;
  if (refreshing || !previous || previous.observation || !monitorsHyena(previous) ||
      document.hidden || byId("fightPicker").disabled) return;
  refreshing = true;
  try {
    const { fight, monitorStatus } = await api(`${endpoint}/${previous.id}`);
    if (current !== previous || byId("fightPicker").disabled) return;
    if (fight.revision !== previous.revision) {
      showFight(fight, monitorStatus, resultEdited);
      status("resultStatus", resultEdited ? "A result arrived while you were editing. Your unsaved values are still in the form." : "");
    } else updateWatch(fight, monitorStatus);
  } catch {
    if (current === previous) status("watchStatus", "Cannot reach the simulator. Retrying the Steam result check…", true);
  } finally {
    refreshing = false;
  }
}

async function loadTargets() {
  const { targets } = await api("/api/targets?edition=steam");
  targets.sort((a, b) => a.name.localeCompare(b.name));
  const select = byId("logTarget");
  select.replaceChildren(...targets.map((target) => new Option(target.name, target.id)));
  if (targets.some((target) => target.id === "hyena_hulk")) select.value = "hyena_hulk";
  targetsReady = targets.length > 0;
  if (!targetsReady) throw new Error("Steam catalog is empty. Refresh Steam data in the simulator.");
}

async function loadSaved() {
  const { fights } = await api(endpoint);
  const readable = fights.filter((fight) => !fight.unreadable);
  const unreadable = fights.filter((fight) => fight.unreadable);
  byId("unreadableFightIds").replaceChildren(...unreadable.map(({ id }) => {
    const item = document.createElement("li");
    item.textContent = id;
    return item;
  }));
  byId("unreadableFights").hidden = unreadable.length === 0;
  const picker = byId("fightPicker");
  picker.replaceChildren(...readable.map(pickerOption));
  const linked = new URL(location.href).searchParams.get("fight");
  const id = readable.find((fight) => fight.id === linked)?.id ?? readable[0]?.id;
  if (id) {
    byId("emptyFights").hidden = true;
    byId("fightPickerLabel").hidden = false;
    picker.value = id;
    await loadFight(id);
  } else byId("emptyFights").textContent = unreadable.length
    ? "No readable saved fights." : "Saved forecasts and their results will appear here.";
  if (linked && !fights.some((fight) => fight.id === linked)) status("resultStatus", "The linked fight is unavailable.", true);
}

byId("logSource").addEventListener("change", () => {
  const file = byId("logSource").value === "export";
  byId("fileLabel").hidden = !file;
  byId("logFile").required = file;
});

byId("captureForm").addEventListener("input", () => { captureId = null; });
byId("captureForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  busy(true);
  status("captureStatus", "Saving the pre-fight state and running the forecast…");
  try {
    captureId ??= crypto.randomUUID();
    const source = byId("logSource").value;
    const payload = { id: captureId, targetId: byId("logTarget").value, source,
      trials: byId("logTrials").valueAsNumber, maxSeconds: byId("logLimit").valueAsNumber };
    if (source === "export") {
      const bytes = await byId("logFile").files[0].arrayBuffer();
      payload.saveText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    }
    const { fight, monitorStatus } = await api(endpoint, "POST", payload);
    showFight(fight, monitorStatus);
    captureId = null;
    status("captureStatus", "Pre-fight state saved.");
    status("resultStatus", "");
  } catch (error) {
    status("captureStatus", error.message, true);
  } finally {
    busy(false);
  }
});

async function selectFight(id) {
  busy(true);
  const picker = byId("fightPicker");
  try {
    await loadFight(id);
  } catch (error) {
    if (current) picker.value = current.id;
    status("resultStatus", error.message, true);
  } finally {
    busy(false);
  }
}

byId("fightPicker").addEventListener("change", (event) => selectFight(event.target.value));
byId("retryForecast").addEventListener("click", (event) => selectFight(event.currentTarget.dataset.fightId));

byId("resultForm").addEventListener("input", () => { resultEdited = true; });
byId("resultForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!current) return;
  busy(true);
  const url = `${endpoint}/${current.id}`;
  try {
    const { fight } = await api(`${url}/observation`, "PUT", {
      revision: current.revision, outcome: byId("resultOutcome").value, elapsedSeconds: byId("resultElapsed").valueAsNumber,
    });
    showFight(fight);
    status("resultStatus", "Steam result saved.");
  } catch (error) {
    status("resultStatus", error.message, true);
    if (error.status === 409) {
      try {
        await loadFight(current.id, true);
        status("resultStatus", "The saved result changed. Review it above, then submit again to save your values.", true);
      } catch (reloadError) {
        status("resultStatus", reloadError.message, true);
      }
    }
  } finally {
    busy(false);
  }
});

busy(true);
const [catalog, saved] = await Promise.allSettled([loadTargets(), loadSaved()]);
if (catalog.status === "rejected") status("captureStatus", catalog.reason.message, true);
if (saved.status === "rejected") {
  byId("emptyFights").textContent = "Could not load saved fights.";
  status("resultStatus", saved.reason.message, true);
}
busy(false);
setInterval(refreshObservation, 2500);
document.addEventListener("visibilitychange", refreshObservation);
