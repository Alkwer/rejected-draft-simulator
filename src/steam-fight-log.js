import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { decodeSaveText, defaultSteamSaveDir, findActiveSteamSave, isFullSteamSave, readSaveFile } from "./save.js";
import { readGameBundle } from "./sketch-data.js";
import { createSteamFightForecast, compareSteamFightObservation, validateSteamFightForecastInput } from "./steam-fight-forecast.js";
import { inspectHyenaHistory } from "./steam-fight-notifications.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TERMINAL_WATCH_STATUSES = new Set(["history-gap", "missing-timing", "superseded"]);

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readOptionalJson(file) {
  try {
    const data = readJson(file);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid saved fight file.");
    return data;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  }
}

// Publishing a completed, nonempty directory keeps partial writes invisible.
// A second writer racing for the same capture or revision cannot replace it.
function publish(parent, name, files) {
  fs.mkdirSync(parent, { recursive: true });
  const pending = fs.mkdtempSync(path.join(parent, ".pending-"));
  try {
    for (const [file, contents] of Object.entries(files)) fs.writeFileSync(path.join(pending, file), contents);
    const dest = path.join(parent, name);
    try {
      fs.renameSync(pending, dest);
    } catch (error) {
      if (fs.existsSync(dest)) return false;
      throw error;
    }
    return true;
  } finally {
    fs.rmSync(pending, { recursive: true, force: true });
  }
}

function fightDir(root, id) {
  if (typeof id !== "string" || !UUID.test(id)) throw problem(400, "Invalid fight ID.");
  return path.join(root, id);
}

function readWatchCheckpoint(root, id, since) {
  const file = path.join(fightDir(root, id), "monitor-checkpoint.json");
  let checkpoint;
  try {
    checkpoint = readJson(file);
  } catch (error) {
    if (error.code === "ENOENT") return { checkedThrough: since, status: "waiting" };
    throw error;
  }
  if (!Number.isSafeInteger(checkpoint?.checkedThrough) || checkpoint.checkedThrough < since ||
      (checkpoint.status !== "waiting" && !TERMINAL_WATCH_STATUSES.has(checkpoint.status))) {
    throw new Error(`Invalid Steam fight monitor checkpoint for ${id}.`);
  }
  return { checkedThrough: checkpoint.checkedThrough, status: checkpoint.status };
}

function writeWatchCheckpoint(root, id, checkpoint) {
  const file = path.join(fightDir(root, id), "monitor-checkpoint.json");
  const pending = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(pending, JSON.stringify(checkpoint), { flag: "wx" });
    fs.renameSync(pending, file);
  } finally {
    fs.rmSync(pending, { force: true });
  }
}

function unreadableFight(id, cause) {
  return Object.assign(problem(422, `Could not read saved fight ${id}.`), { cause });
}

function validateFightMetadata(metadata, id) {
  const target = metadata.forecast?.target ?? metadata.target;
  if (metadata.id !== id || typeof metadata.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(metadata.capturedAt)) || typeof metadata.source !== "string" ||
      typeof target?.id !== "string" || typeof target.name !== "string") {
    throw new Error("Invalid saved fight metadata.");
  }
  return metadata;
}

function validateReadyFight(record, id) {
  const { forecast } = record;
  if (!forecast?.target) throw new Error("Missing saved forecast.");
  const { assumptions, duration, enemy, maxSeconds, player, probabilities, trials, warnings } = forecast;
  const speedup = assumptions?.battleSpeedup;
  if (![duration?.p10Seconds, duration?.medianSeconds, duration?.p90Seconds].every((seconds) =>
    Number.isFinite(seconds) && seconds >= 0) ||
    ![probabilities?.win, probabilities?.loss, probabilities?.timeout].every((probability) =>
      Number.isFinite(probability) && probability >= 0 && probability <= 1) ||
    !Number.isInteger(trials) || trials < 1 || !Number.isInteger(maxSeconds) || maxSeconds < 1 ||
    ![assumptions?.combatSpeedMultiplier, enemy?.maxHp, player?.maxHp, player?.attack].every(Number.isFinite) ||
    typeof assumptions?.steam?.universeId !== "string" ||
    (speedup && ![speedup.multiplier, speedup.remainingSeconds].every(Number.isFinite)) ||
    (warnings != null && (!Array.isArray(warnings) || warnings.some((warning) => typeof warning?.message !== "string")))) {
    throw new Error("Invalid saved forecast.");
  }
  return validateFightMetadata(record, id);
}

function readCaptureMetadata(dir, id) {
  const capture = readOptionalJson(path.join(dir, "capture.json"));
  return capture && validateFightMetadata({ ...capture.record, target: capture.target }, id);
}

function readFightMetadata(root, id) {
  const dir = fightDir(root, id);
  try {
    const record = readOptionalJson(path.join(dir, "forecast", "forecast.json"))
      ?? readOptionalJson(path.join(dir, "forecast.json"));
    if (record) return validateReadyFight(record, id);
    const capture = readCaptureMetadata(dir, id);
    if (capture) return capture;
    if (!fs.existsSync(dir)) return null;
    throw new Error("Missing saved fight metadata.");
  } catch (cause) {
    throw unreadableFight(id, cause);
  }
}

function restoreSteamTiming(observation) {
  const { source, startedAt, notifiedAt } = observation;
  if (source === "steam-notification" && Number.isSafeInteger(startedAt) && startedAt > 0 &&
      Number.isSafeInteger(notifiedAt) && notifiedAt >= startedAt) {
    return { ...observation, elapsedSeconds: (notifiedAt - startedAt) / 1000 };
  }
  return observation;
}

function readFight(root, id, metadata) {
  const dir = fightDir(root, id);
  try {
    let revision = 0;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const match = item.isDirectory() && /^result-(\d+)$/.exec(item.name);
      if (match) revision = Math.max(revision, Number(match[1]));
    }
    let observation = null;
    if (revision) {
      const resultDir = path.join(dir, `result-${revision}`);
      const recorded = readOptionalJson(path.join(resultDir, "observation.json"));
      observation = restoreSteamTiming(recorded === undefined
        ? readJson(path.join(resultDir, "steam-observation.json"))
        : recorded);
      if (!["win", "loss", "timeout"].includes(observation.outcome) ||
          !Number.isFinite(observation.elapsedSeconds) || observation.elapsedSeconds < 0) {
        throw new Error("Invalid saved fight observation.");
      }
      if (metadata.forecast && (recorded === undefined || observation.source === "steam-notification")) {
        observation = { ...observation, ...compareSteamFightObservation(metadata.forecast, observation) };
      }
    }
    return { ...metadata, revision, observation };
  } catch (cause) {
    throw unreadableFight(id, cause);
  }
}

function getFight(root, id, includePending = false) {
  const metadata = readFightMetadata(root, id);
  if (!metadata) throw problem(404, "Saved fight not found.");
  if (!metadata.forecast && !includePending) throw problem(409, "The forecast is pending. Open this saved fight to resume it.");
  return readFight(root, id, metadata);
}

function savedInput(body, steamSaveDir) {
  if (body.source === "export") {
    if (typeof body.saveText !== "string" || !body.saveText.trim()) throw problem(400, "Choose a Steam save file.");
    return { raw: Buffer.from(body.saveText, "utf8"), source: "export" };
  }
  if (body.source !== undefined && body.source !== "steam") throw problem(400, "Unknown save source.");
  const slot = findActiveSteamSave(steamSaveDir);
  if (!slot) throw problem(404, "No active Steam slot found. Choose a Steam save file instead.");
  return { raw: fs.readFileSync(slot), source: path.basename(slot) };
}

async function capture({ root, dataPath, steamSaveDir, calculateForecast, pendingCaptures, onCapture }, body) {
  const id = body.id ?? randomUUID();
  const dir = fightDir(root, id);
  const targetId = body.targetId ?? "hyena_hulk";
  const { trials = 1000, maxSeconds = 300 } = body;
  if (!fs.existsSync(dir)) {
    const { raw, source } = savedInput(body, steamSaveDir);
    const capturedAt = new Date().toISOString();
    let save;
    try {
      save = decodeSaveText(raw.toString("utf8"));
      if (!isFullSteamSave(save)) throw new Error("Choose a save from the full Steam edition.");
    } catch (error) {
      throw problem(400, error.message);
    }
    const { sketches, dataMetadata } = readGameBundle(dataPath);
    try {
      validateSteamFightForecastInput({ save, sketches, dataMetadata, targetId, trials, maxSeconds, seed: id });
    } catch (error) {
      throw problem(400, error.message);
    }
    const sketch = sketches[targetId];
    const snapshot = {
      record: { id, capturedAt, source, gameSavedAt: save.meta?.savedAt ?? null, gameVersion: save.meta?.gameVersion ?? null },
      target: { id: targetId, name: sketch.name ?? targetId }, trials, maxSeconds, sketch, dataMetadata,
    };
    if (publish(root, id, { "save.json": raw, "capture.json": JSON.stringify(snapshot) })) onCapture();
  }

  // A retry always uses the published save and catalog entry for this ID.
  const fight = getFight(root, id, true);
  const snapshot = fight.forecast ?? readJson(path.join(dir, "capture.json"));
  const sameSource = (body.source ?? "steam") === (fight.source === "export" ? "export" : "steam");
  const sameExport = fight.source !== "export" || body.saveText === fs.readFileSync(path.join(dir, "save.json"), "utf8");
  if (!sameSource || !sameExport || targetId !== snapshot.target.id || trials !== snapshot.trials || maxSeconds !== snapshot.maxSeconds) {
    throw problem(409, "A different pre-fight state already uses this ID.");
  }
  if (fight.forecast) return fight;
  return finishCapture({ root, calculateForecast, pendingCaptures }, fight, snapshot);
}

async function finishCapture({ root, calculateForecast, pendingCaptures }, { id }, snapshot) {
  let pending = pendingCaptures.get(id);
  if (!pending) {
    pending = Promise.resolve().then(async () => {
      const dir = fightDir(root, id);
      const { target, sketch, dataMetadata, trials, maxSeconds, record } = snapshot;
      const save = readSaveFile(path.join(dir, "save.json"));
      const forecast = await calculateForecast({ save, sketches: { [target.id]: sketch },
        dataMetadata, targetId: target.id, trials, maxSeconds, seed: id });
      const completed = validateReadyFight({ ...record, forecast }, id);
      publish(dir, "forecast", { "forecast.json": JSON.stringify(completed) });
    }).finally(() => pendingCaptures.delete(id));
    pendingCaptures.set(id, pending);
  }
  await pending;
  return getFight(root, id);
}

function recordObservation(root, id, body, evidence = {}) {
  const fight = getFight(root, id);
  let comparison;
  try {
    comparison = compareSteamFightObservation(fight.forecast, body);
  } catch (error) {
    throw problem(400, error.message);
  }
  if (fight.observation?.outcome === comparison.outcome && fight.observation.source === evidence.source &&
      fight.observation.elapsedSeconds === comparison.elapsedSeconds) return fight;
  const conflict = "This result changed in another window. Reload the saved fight before editing it.";
  if (body.revision !== fight.revision) throw problem(409, conflict);
  const observation = { ...comparison, ...evidence, recordedAt: new Date().toISOString() };
  const won = publish(fightDir(root, id), `result-${fight.revision + 1}`, { "observation.json": JSON.stringify(observation) });
  if (!won) throw problem(409, conflict);
  return { ...fight, revision: fight.revision + 1, observation };
}

function summarizeFight({ id, capturedAt, source, forecast, target }) {
  return { id, capturedAt, source, target: forecast?.target ?? target };
}

function archiveEntries(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory() && UUID.test(item.name))
    .map(({ name: id }) => {
      let summary = { id };
      try {
        const metadata = readFightMetadata(root, id);
        if (!metadata) return { id, unreadable: true };
        summary = summarizeFight(metadata);
        const { observation } = readFight(root, id, metadata);
        return { ...summary, outcome: observation?.outcome ?? null, ...(!metadata.forecast && { pending: true }) };
      } catch (error) {
        if (error.status !== 422) throw error;
        if (!summary.target) {
          try {
            const capture = readCaptureMetadata(fightDir(root, id), id);
            if (capture) summary = summarizeFight(capture);
          } catch {
            // The unreadable entry may have no usable timestamp or slot to delimit earlier captures.
          }
        }
        return { ...summary, unreadable: true };
      }
    })
    .sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? "") || b.id.localeCompare(a.id));
}

export function listSteamFights(root) {
  return archiveEntries(root).map((fight) => fight.unreadable ? { id: fight.id, unreadable: true } : fight);
}

export function createSteamFightMonitor({ root, steamSaveDir = defaultSteamSaveDir() }) {
  const watches = new Map();
  let directoryStamp;
  let timer;

  function refresh() {
    const stamp = fs.statSync(root, { throwIfNoEntry: false })?.mtimeMs;
    if (stamp === directoryStamp) return;
    const nextCapture = new Map();
    const pending = new Set();
    for (const fight of archiveEntries(root)) {
      if (fight.target?.id !== "hyena_hulk" || !/^slot-[1-6]\.json$/.test(fight.source)) continue;
      const since = Date.parse(fight.capturedAt);
      const until = nextCapture.get(fight.source) ?? Infinity;
      nextCapture.set(fight.source, since);
      if (fight.outcome || fight.unreadable) continue;
      const watch = watches.get(fight.id) ?? { source: fight.source, since };
      watch.until = until;
      watches.set(fight.id, watch);
      pending.add(fight.id);
    }
    for (const id of watches.keys()) if (!pending.has(id)) watches.delete(id);
    directoryStamp = stamp;
  }

  function tick() {
    refresh();
    const slots = new Map();
    for (const [id, watch] of watches) {
      if (watch.checkedThrough === undefined) {
        try {
          Object.assign(watch, readWatchCheckpoint(root, id, watch.since));
        } catch {
          watch.status = "unavailable";
          continue;
        }
      }
      if (TERMINAL_WATCH_STATUSES.has(watch.status)) continue;
      if (!slots.has(watch.source)) {
        try {
          const file = steamSaveDir && path.join(steamSaveDir, watch.source);
          const slot = file && fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() && readSaveFile(file);
          slots.set(watch.source, isFullSteamSave(slot) ? slot : null);
        } catch (error) {
          // Steam may be replacing the slot. Leave it pending for the next poll.
          if (error.code && !["ENOENT", "EBUSY", "EPERM", "EACCES"].includes(error.code)) throw error;
          slots.set(watch.source, null);
        }
      }
      const slot = slots.get(watch.source);
      if (!slot || (slot.meta?.slot != null && `slot-${slot.meta.slot}.json` !== watch.source)) {
        watch.status = "unavailable";
        continue;
      }
      const match = inspectHyenaHistory(slot, watch);
      if (match.status !== "imported") {
        const checkedThrough = match.checkedThrough ?? watch.checkedThrough;
        if (checkedThrough > watch.checkedThrough || TERMINAL_WATCH_STATUSES.has(match.status)) {
          try {
            writeWatchCheckpoint(root, id, { checkedThrough, status: match.status });
          } catch {
            watch.status = "unavailable";
            continue;
          }
          watch.checkedThrough = checkedThrough;
        }
        watch.status = match.status;
        continue;
      }
      const result = { outcome: match.outcome, elapsedSeconds: match.elapsedSeconds };
      try {
        if (getFight(root, id, true).forecast) {
          recordObservation(root, id, { revision: 0, ...result }, match.evidence);
        } else {
          // The forecast can still be running when Steam saves the result.
          const observation = { ...result, ...match.evidence, recordedAt: new Date().toISOString() };
          publish(fightDir(root, id), "result-1", { "steam-observation.json": JSON.stringify(observation) });
        }
      } catch (error) {
        if (error.status !== 409) {
          watch.status = "unavailable";
          continue;
        }
      }
      watches.delete(id);
    }
  }

  function poll() {
    try {
      tick();
    } catch (error) {
      for (const watch of watches.values()) {
        if (!TERMINAL_WATCH_STATUSES.has(watch.status)) watch.status = "unavailable";
      }
      console.warn("Steam fight monitor:", error.message);
    }
  }
  return {
    start() {
      if (timer) return;
      poll();
      timer = setInterval(poll, 2000);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = undefined; },
    captured() { directoryStamp = null; poll(); },
    recorded(id) { watches.delete(id); },
    status(id) { return watches.get(id)?.status ?? null; },
  };
}

export function handleSteamFightRequest({ root, dataPath, steamSaveDir, pathname, method, body = {},
  calculateForecast = createSteamFightForecast, pendingCaptures = new Map(), onCapture = () => {},
}) {
  const [, , , id, action, ...extra] = pathname.split("/");
  if (!id && action === undefined) {
    if (method === "GET") return { fights: listSteamFights(root) };
    if (method === "POST") {
      return capture({ root, dataPath, steamSaveDir, calculateForecast, pendingCaptures, onCapture }, body)
        .then((fight) => ({ fight }));
    }
  } else if (id && !extra.length) {
    if (!action && method === "GET") {
      const fight = getFight(root, id, true);
      if (fight.forecast) return { fight };
      const snapshot = readJson(path.join(fightDir(root, id), "capture.json"));
      return finishCapture({ root, calculateForecast, pendingCaptures }, fight, snapshot).then((resolved) => ({ fight: resolved }));
    }
    if (action === "observation" && method === "PUT") return { fight: recordObservation(root, id, body) };
    if (action === "save" && method === "GET") {
      const file = path.join(fightDir(root, id), "save.json");
      if (!fs.existsSync(file)) throw problem(404, "Saved fight not found.");
      return { download: fs.readFileSync(file), filename: `steam-before-fight-${id}.json` };
    }
  }
  throw problem(404, "Unknown fight log operation.");
}
