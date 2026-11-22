const byId = (id) => document.getElementById(id);
const endpoint = "/api/steam-fights";
const outcomeLabels = { win: "Victory", loss: "Defeat", timeout: "Still fighting" };
const rangeLabels = { below: "Shorter than forecast range", within: "Within forecast range",
  above: "Longer than forecast range", indeterminate: "Time limit prevents comparison" };
const watchMessages = {
  waiting: "Waiting for Steam to save a Hyena Hulk result. You can switch back to the game.",
  settings: "In Steam, unlock the Combat Log and turn on in-game Victory and Defeat notifications. Save your slot before the next fight.",
  unavailable: "Waiting for the original Steam slot and its notification history to become available.",
  "missing-timing": "Steam saved a Hyena Hulk result without a combat start time. Enter this result manually.",
  "history-gap": "Steam has rotated the saved notifications for this forecast. Save a new pre-fight state just before your next attempt.",
  superseded: "A newer Hyena Hulk forecast was saved for this slot before a result was found.",
};
const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const percentages = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
const seconds = (value) => `${numbers.format(value)} s`;
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
}

function sourceLabel(source) {
  return source === "export" ? "Imported save" : source;
}

function pickerOption(fight) {
  const outcome = fight.outcome ?? fight.observation?.outcome;
  const state = outcome ? outcomeLabels[outcome] : "Awaiting result";
  const target = fight.target ?? fight.forecast.target;
  return new Option(`${dateTime.format(new Date(fight.capturedAt))} · ${target.name} · ${state}`, fight.id);
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

function showFight(fight, monitorStatus) {
  if (current?.id !== fight.id) byId("manualResult").open = !monitorsHyena(fight) && !fight.observation;
  current = fight;
  const { forecast, observation } = fight;
  const { duration, probabilities, assumptions, enemy } = forecast;
  const picker = byId("fightPicker");
  const option = pickerOption(fight);
  const previous = [...picker.options].find((item) => item.value === fight.id);
  if (previous) previous.replaceWith(option);
  else picker.prepend(option);
  picker.value = fight.id;
  const url = new URL(location.href);
  url.searchParams.set("fight", fight.id);
  history.replaceState(null, "", url);

  byId("emptyFights").hidden = true;
  byId("fightPickerLabel").hidden = false;
  byId("fightDetail").hidden = false;
  byId("fightTitle").textContent = forecast.target.name;
  byId("resultState").textContent = observation ? "Result recorded" : "Awaiting result";
  byId("captureInfo").textContent = `${sourceLabel(fight.source)} · ${dateTime.format(new Date(fight.capturedAt))}`;
  byId("forecastOdds").textContent = `Victory ${percentages.format(probabilities.win)} · Defeat ${percentages.format(probabilities.loss)} · At limit ${percentages.format(probabilities.timeout)}`;
  byId("forecastMedian").textContent = `${quantile(duration.medianSeconds, duration.medianCensored)} median`;
  byId("forecastRange").textContent = `${quantile(duration.p10Seconds, duration.p10Censored)} – ${quantile(duration.p90Seconds, duration.p90Censored)}`;
  byId("forecastInfo").textContent = `${numbers.format(forecast.trials)} simulated fights · ${seconds(forecast.maxSeconds)} limit · ${numbers.format(enemy.maxHp)} enemy HP${enemy.isPreciseErased ? " after Precise Eraser" : ""}.`;
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
  const fields = [
    ["Game patch", fight.gameVersion ?? "Unknown"],
    ["Save schema", forecast.saveVersion ?? "Unknown"],
    ["Catalog patch / build", [forecast.dataMetadata?.gameVersion, forecast.dataMetadata?.buildId].filter(Boolean).join(" / ") || "Unknown"],
    ["Player HP", numbers.format(forecast.player.maxHp)],
    ["Player attack", numbers.format(forecast.player.attack)],
    ["Combat speed", `${numbers.format(assumptions.combatSpeedMultiplier)}×`],
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
  byId("resultOutcome").value = observation?.outcome ?? "";
  byId("resultElapsed").value = observation?.elapsedSeconds ?? "";
  resultEdited = false;
  byId("recordResult").textContent = observation ? "Update result" : "Save result";
  updateWatch(fight, monitorStatus);
}

async function loadFight(id) {
  const { fight, monitorStatus } = await api(`${endpoint}/${id}`);
  showFight(fight, monitorStatus);
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
      const draft = resultEdited && { outcome: byId("resultOutcome").value, elapsed: byId("resultElapsed").value };
      showFight(fight, monitorStatus);
      if (draft) {
        byId("resultOutcome").value = draft.outcome;
        byId("resultElapsed").value = draft.elapsed;
        resultEdited = true;
      }
      status("resultStatus", draft ? "A result arrived while you were editing. Your unsaved values are still in the form." : "");
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
  byId("fightPicker").replaceChildren(...fights.map(pickerOption));
  const linked = new URL(location.href).searchParams.get("fight");
  const id = fights.find((fight) => fight.id === linked)?.id ?? fights[0]?.id;
  if (id) await loadFight(id);
  else byId("emptyFights").textContent = "Saved forecasts and their results will appear here.";
  if (linked && linked !== id) status("resultStatus", "The linked fight is unavailable.", true);
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

byId("fightPicker").addEventListener("change", async () => {
  busy(true);
  const picker = byId("fightPicker");
  try {
    await loadFight(picker.value);
    status("resultStatus", "");
  } catch (error) {
    if (current) picker.value = current.id;
    status("resultStatus", error.message, true);
  } finally {
    busy(false);
  }
});

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
        await loadFight(current.id);
        status("resultStatus", "Another window changed this result. Review the latest entry before editing.", true);
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
