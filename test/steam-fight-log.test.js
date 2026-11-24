import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWebServer } from "../src/web-server.js";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_DATA_PATH } from "../src/game-data-update.js";
import { createSteamFightMonitor, handleSteamFightRequest } from "../src/steam-fight-log.js";

const slot = {
  version: 86, meta: { profile: "steam", gameVersion: "v0.9771", savedAt: 1770000000000 },
  state: {
    saveProfile: "steam",
    playerStats: { maxHp: 100, attack: 20, attackSpeed: 1000, minDamage: 100, maxDamage: 100 },
    availableSketches: ["hyena_hulk"], erasedSketchIds: ["hyena_hulk"],
  },
};

const archivedForecast = {
  target: { id: "hyena_hulk", name: "Hyena Hulk" },
  trials: 4,
  maxSeconds: 2,
  probabilities: { win: 0.25, loss: 0.75, timeout: 0 },
  duration: { medianSeconds: 1, p10Seconds: 0.5, p90Seconds: 1.5 },
  assumptions: { combatSpeedMultiplier: 1, steam: { universeId: "mv-original" } },
  player: { maxHp: 100, attack: 20 },
  enemy: { maxHp: 1000 },
};

async function startServer(options) {
  const server = createWebServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/steam-fights`;
  return {
    request: (suffix = "", method = "GET", body, headers = {}) => fetch(url + suffix, {
      method, headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("saved Steam fight keeps the original slot and forecast across edits, retries and server restarts", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-steam-fight-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { steamSaveDir: dir, fightLogDir: path.join(dir, "log") };
  let server = await startServer(options);
  t.after(() => server.close());
  const request = (...args) => server.request(...args);
  const body = { id: randomUUID(), source: "steam", trials: 8, maxSeconds: 10 };
  const entry = "/" + body.id;
  assert.deepEqual((await (await request()).json()).fights, []);
  assert.equal((await request("", "POST", body)).status, 404);
  const file = path.join(dir, "slot-1.json");
  const bytes = Buffer.from(JSON.stringify(slot)).toString("base64") + "\r\n";
  fs.writeFileSync(file, bytes);
  const capture = await (await request("", "POST", body)).json();
  assert.equal(capture.ok, true, capture.error);
  const initial = capture.fight;
  assert.equal(initial.source, "slot-1.json");
  assert.equal(initial.forecast.target.id, "hyena_hulk");
  assert.equal(initial.forecast.enemy.maxHp, 500_000_000);
  assert.equal(initial.forecast.enemy.isPreciseErased, true);
  assert.equal(initial.gameVersion, slot.meta.gameVersion);
  assert.equal(initial.revision, 0);
  assert.equal(initial.observation, null);
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
  fs.writeFileSync(file, JSON.stringify({ ...slot, state: { ...slot.state, erasedSketchIds: [] } }));
  assert.deepEqual((await (await request("", "POST", body)).json()).fight, initial);
  assert.equal((await request("", "POST", { ...body, maxSeconds: 20 })).status, 409);
  const download = await request(entry + "/save");
  assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.equal(await download.text(), bytes);
  assert.equal((await request(entry + "/save", "GET", undefined, { origin: "https://example.org" })).status, 403);

  const record = (observation) => request(entry + "/observation", "PUT", observation);
  const result = { revision: 0, outcome: "loss", elapsedSeconds: 3.2 };
  const observed = (await (await record(result)).json()).fight;
  assert.equal(observed.observation.outcomeProbability, initial.forecast.probabilities.loss);
  assert.equal(observed.observation.medianDeltaSeconds, 3.2 - initial.forecast.duration.medianSeconds);
  assert.equal(observed.revision, 1);
  assert.deepEqual((await (await record(result)).json()).fight, observed);
  assert.equal((await record({ ...result, elapsedSeconds: 4 })).status, 409);
  assert.equal((await record({ ...result, elapsedSeconds: -1, revision: 1 })).status, 400);
  const corrected = (await (await record({ revision: 1, outcome: "win", elapsedSeconds: 12 })).json()).fight;
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.observation.outcomeProbability, null);
  assert.deepEqual(corrected.forecast, initial.forecast);
  await server.close();
  server = await startServer(options);
  assert.deepEqual((await (await request(entry)).json()).fight, corrected);
  const { fights } = await (await request()).json();
  assert.equal(fights.length, 1);
  assert.equal(fights[0].outcome, "win");
});

test("Steam export capture validates the file, creates independent forecasts and preserves pending observations", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-export-fight-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = await startServer({ fightLogDir: dir });
  t.after(() => server.close());
  const capture = (body) => server.request("", "POST", body);
  const body = { source: "export", trials: 2, maxSeconds: 1, saveText: "\uFEFF" + JSON.stringify(slot) };
  assert.equal((await capture(null)).status, 400);
  assert.equal((await capture({ ...body, id: [randomUUID()] })).status, 400);
  assert.equal((await capture({ ...body, targetId: "nonexistent" })).status, 400);
  assert.equal((await capture({ ...body, saveText: "invalid" })).status, 400);
  assert.equal((await capture({ ...body, saveText: JSON.stringify({ version: 52, state: {} }) })).status, 400);
  assert.equal((await capture({ ...body, trials: 0 })).status, 400);
  assert.deepEqual((await (await server.request()).json()).fights, []);
  const first = (await (await capture(body)).json()).fight;
  const second = (await (await capture(body)).json()).fight;
  assert.notEqual(first.id, second.id);
  assert.equal(first.source, "export");
  assert.equal(first.observation, null);
  const download = await server.request(`/${first.id}/save`);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(body.saveText));
  assert.equal((await capture({ ...body, id: first.id, saveText: JSON.stringify(slot) })).status, 409);
  assert.equal((await (await server.request()).json()).fights.length, 2);
});

test("Steam monitor imports a Hyena result in the background from the captured slot after a restart", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-observed-fight-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { steamSaveDir: dir, fightLogDir: path.join(dir, "log"), watchSteamFightsOnStart: true };
  const original = path.join(dir, "slot-1.json");
  const later = path.join(dir, "slot-2.json");
  const empty = { ...slot, meta: { ...slot.meta, slot: 1, savedAt: Date.now() }, state: { ...slot.state, notificationHistory: [] } };
  fs.writeFileSync(original, JSON.stringify(empty));
  let server = await startServer(options);
  t.after(() => server.close());
  async function capture() {
    const { fight } = await (await server.request("", "POST", { trials: 1, maxSeconds: 2 })).json();
    return fight;
  }
  const first = await capture();
  const second = await capture();
  const start = Date.parse(second.capturedAt) + 10;
  const notices = [{ type: "DEFEAT", message: "Defeated by Hyena Hulk! 7 second cooldown.",
    action: { kind: "combat-log", startTime: start, encounterId: "combat-42" }, timestamp: start + 1999 }];
  const saved = { ...empty, meta: { ...empty.meta, savedAt: start + 2000 },
    state: { ...empty.state, notificationHistory: notices } };
  fs.writeFileSync(later, JSON.stringify({ ...saved, meta: { ...saved.meta, slot: 2 } }));
  fs.writeFileSync(path.join(dir, "last-slot.txt"), "2");
  await server.close();
  server = await startServer(options);
  const fetchFight = async (id) => (await server.request("/" + id)).json();
  assert.equal((await fetchFight(second.id)).fight.observation, null);
  fs.writeFileSync(original, Buffer.from(JSON.stringify(saved)).toString("base64"));
  // No open page or polling HTTP request is required to persist an observation.
  const persisted = path.join(options.fightLogDir, second.id, "result-1", "observation.json");
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(persisted) && Date.now() < deadline) await delay(100);
  assert.ok(fs.existsSync(persisted));
  const rawObservation = JSON.parse(fs.readFileSync(persisted, "utf8"));
  assert.equal(rawObservation.elapsedSeconds, 1.999);
  assert.equal(rawObservation.outcomeProbability, second.forecast.probabilities.loss);
  const { fight } = await fetchFight(second.id);
  assert.equal(fight.revision, 1);
  assert.equal(fight.observation.source, "steam-notification");
  assert.equal(fight.observation.encounterId, "combat-42");
  assert.equal(fight.observation.elapsedSeconds, 1.999);
  assert.equal(fight.observation.outcome, "loss");
  assert.deepEqual(fight.forecast, second.forecast);
  const older = await fetchFight(first.id);
  assert.equal(older.fight.observation, null);
  assert.equal(older.monitorStatus, "superseded");

  // A prior version stored rounded elapsed time and calculated the comparison with it.
  fs.writeFileSync(persisted, JSON.stringify({ ...rawObservation, elapsedSeconds: 2, outcomeProbability: null }));
  assert.deepEqual((await fetchFight(second.id)).fight, fight);

  // An explicit manual correction can replace automatic timing even when the values agree.
  const corrected = await server.request("/" + second.id + "/observation", "PUT", {
    revision: 1, outcome: "loss", elapsedSeconds: 1.999,
  });
  const correctedFight = (await corrected.json()).fight;
  assert.equal(correctedFight.revision, 2);
  assert.equal(correctedFight.observation.source, undefined);
  const atHorizon = await server.request("/" + second.id + "/observation", "PUT", {
    revision: 2, outcome: "loss", elapsedSeconds: 2,
  });
  assert.equal((await atHorizon.json()).fight.observation.outcomeProbability, null);
  await server.close();
  server = await startServer(options);
  assert.equal((await fetchFight(second.id)).fight.observation.elapsedSeconds, 2);
  assert.equal((await fetchFight(second.id)).fight.revision, 3);
});

test("Steam monitor restores inspected coverage after a restart with a full, overlapping history", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-fight-checkpoint-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "log");
  const file = path.join(dir, "slot-1.json");
  const writeSlot = (savedAt, notificationHistory) => fs.writeFileSync(file, JSON.stringify({
    ...slot, meta: { ...slot.meta, slot: 1, savedAt }, state: { ...slot.state, notificationHistory },
  }));
  const options = { root, dataPath: DEFAULT_DATA_PATH, steamSaveDir: dir };
  writeSlot(slot.meta.savedAt, []);
  const { fight: captured } = await handleSteamFightRequest({
    ...options, pathname: "/api/steam-fights", method: "POST", body: { trials: 1, maxSeconds: 2 },
  });
  const since = Date.parse(captured.capturedAt);
  const through = since + 100;
  const checkpoint = path.join(root, captured.id, "monitor-checkpoint.json");
  assert.equal(fs.existsSync(checkpoint), false);

  const general = (timestamp) => ({ type: "GENERAL", timestamp });
  writeSlot(through, [general(through)]);
  const originalMonitor = createSteamFightMonitor(options);
  t.after(() => originalMonitor.stop());
  originalMonitor.start();
  assert.equal(originalMonitor.status(captured.id), "waiting");
  const checkpointBeforeFailure = fs.readFileSync(checkpoint, "utf8");
  assert.equal(JSON.parse(checkpointBeforeFailure).checkedThrough, through);

  const renameSync = fs.renameSync;
  const failCheckpoint = t.mock.method(fs, "renameSync", (from, to) => {
    if (to === checkpoint) throw Object.assign(new Error("checkpoint file is busy"), { code: "EBUSY" });
    return renameSync(from, to);
  });
  writeSlot(through + 20, [general(through + 20), general(through)]);
  originalMonitor.captured();
  assert.equal(originalMonitor.status(captured.id), "unavailable");
  assert.equal(fs.readFileSync(checkpoint, "utf8"), checkpointBeforeFailure);
  failCheckpoint.mock.restore();
  originalMonitor.stop();

  const startedAt = since + 300;
  const notifiedAt = startedAt + 5420;
  const notices = [
    { type: "DEFEAT", message: "Defeated by Hyena Hulk! 7 second cooldown.", timestamp: notifiedAt,
      action: { kind: "combat-log", startTime: startedAt, encounterId: "combat-after-checkpoint" } },
    ...Array.from({ length: 8 }, (_, index) => general(through + index)),
    general(through + 20),
  ];
  assert.equal(notices.length, 10);
  assert.ok(notices.every((notice) => notice.timestamp > since));
  writeSlot(notifiedAt + 1, notices);
  const restarted = createSteamFightMonitor(options);
  t.after(() => restarted.stop());
  restarted.start();
  const request = { ...options, pathname: "/api/steam-fights/" + captured.id, method: "GET" };
  const { fight } = handleSteamFightRequest(request);
  assert.equal(fight.revision, 1);
  assert.equal(fight.observation.source, "steam-notification");
  assert.equal(fight.observation.encounterId, "combat-after-checkpoint");
  assert.equal(fight.observation.elapsedSeconds, 5.42);
  restarted.captured();
  assert.equal(handleSteamFightRequest(request).fight.revision, 1);
});

test("an unreadable archive entry is reported by ID without blocking other fights", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-damaged-fight-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "log");
  const start = Date.now();
  const { target } = archivedForecast;
  function archiveFight(slotNumber, offset) {
    const id = randomUUID();
    const entryDir = path.join(root, id);
    const file = path.join(entryDir, "forecast.json");
    const capture = { id, capturedAt: new Date(start + offset).toISOString(), source: `slot-${slotNumber}.json` };
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...capture, forecast: archivedForecast }));
    return { id, entryDir, file, capture };
  }
  const older = archiveFight(1, 0);
  const brokenResult = archiveFight(1, 10);
  const malformedForecast = archiveFight(1, 20);
  const tracked = archiveFight(2, 30);
  const brokenForecast = archiveFight(3, 40);
  const latest = path.join(brokenResult.entryDir, "result-1");
  fs.mkdirSync(latest);
  fs.writeFileSync(path.join(latest, "observation.json"), "null");
  fs.writeFileSync(malformedForecast.file, JSON.stringify({ ...malformedForecast.capture, target }));
  fs.writeFileSync(brokenForecast.file, '{"forecast":');

  const notification = { type: "VICTORY", message: "Hyena Hulk defeated!", timestamp: start + 2019,
    action: { kind: "combat-log", startTime: start + 120, encounterId: "separate-slot" } };
  for (const slotNumber of [1, 2]) {
    fs.writeFileSync(path.join(dir, `slot-${slotNumber}.json`), JSON.stringify({
      ...slot, meta: { ...slot.meta, slot: slotNumber, savedAt: notification.timestamp },
      state: { ...slot.state, notificationHistory: [notification] },
    }));
  }

  const server = await startServer({ steamSaveDir: dir, fightLogDir: root, watchSteamFightsOnStart: true });
  t.after(() => server.close());
  const list = await server.request();
  assert.equal(list.status, 200);
  const { fights } = await list.json();
  assert.deepEqual(fights.filter((fight) => !fight.unreadable).map((fight) => fight.id), [tracked.id, older.id]);
  assert.deepEqual(fights.filter((fight) => fight.unreadable).map((fight) => fight.id).sort(),
    [brokenResult.id, brokenForecast.id, malformedForecast.id].sort());
  for (const { id } of [brokenResult, malformedForecast, brokenForecast]) {
    const response = await server.request(`/${id}`);
    assert.equal(response.status, 422);
    assert.ok((await response.json()).error.includes(id));
  }
  const newest = await (await server.request(`/${tracked.id}`)).json();
  assert.equal(newest.fight.observation.outcome, "win");
  assert.equal(newest.fight.observation.elapsedSeconds, 1.899);
  const previous = await (await server.request(`/${older.id}`)).json();
  assert.equal(previous.fight.observation, null);
  assert.equal(previous.monitorStatus, "superseded");
});

test("concurrent captures share work and a failed forecast can reuse the original save and catalog", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-in-flight-forecast-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "log");
  const dataPath = path.join(dir, "catalog.json");
  const file = path.join(dir, "slot-1.json");
  const original = { ...slot, meta: { ...slot.meta, slot: 1, savedAt: Date.now(), gameVersion: "fixture-patch" },
    state: { ...slot.state, notificationHistory: [] } };
  const bytes = JSON.stringify(original);
  fs.writeFileSync(file, bytes);
  const catalog = JSON.parse(fs.readFileSync(DEFAULT_DATA_PATH, "utf8"));
  fs.writeFileSync(dataPath, JSON.stringify(catalog));

  const monitor = createSteamFightMonitor({ root, steamSaveDir: dir });
  t.after(() => monitor.stop());
  monitor.start();
  const id = randomUUID();
  let rejectForecast;
  const failedForecast = new Promise((resolve, reject) => { rejectForecast = reject; });
  let attempts = 0;
  const request = {
    root, dataPath, steamSaveDir: dir, pathname: "/api/steam-fights", method: "POST",
    body: { id, trials: 1, maxSeconds: 2 }, pendingCaptures: new Map(), onCapture: monitor.captured,
    calculateForecast: (options) => {
      attempts++;
      assert.equal(options.save.state.playerStats.attack, original.state.playerStats.attack);
      assert.deepEqual(options.dataMetadata, catalog.metadata);
      assert.deepEqual(options.sketches.hyena_hulk, catalog.sketches.hyena_hulk);
      return failedForecast;
    },
  };
  const first = handleSteamFightRequest(request);
  const duplicate = handleSteamFightRequest(request);
  await assert.rejects(handleSteamFightRequest({ ...request, body: { ...request.body, trials: 2 } }), { status: 409 });
  assert.equal(attempts, 1);
  const download = handleSteamFightRequest({ ...request, pathname: `/api/steam-fights/${id}/save`, method: "GET" });
  assert.equal(download.download.toString("utf8"), bytes);
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, id, "capture.json"), "utf8"));
  const startedAt = Date.parse(snapshot.record.capturedAt) + 10;
  const timestamp = startedAt + 1999;
  fs.writeFileSync(file, JSON.stringify({
    ...original, meta: { ...original.meta, savedAt: timestamp },
    state: { ...original.state, playerStats: { ...original.state.playerStats, attack: 42 },
      notificationHistory: [{ type: "DEFEAT", message: "Defeated by Hyena Hulk!", timestamp,
        action: { kind: "combat-log", startTime: startedAt, encounterId: "while-running" } }] },
  }));
  monitor.captured();
  const pendingObservation = path.join(root, id, "result-1", "steam-observation.json");
  const pendingResult = JSON.parse(fs.readFileSync(pendingObservation, "utf8"));
  assert.equal(pendingResult.elapsedSeconds, 1.999);
  fs.writeFileSync(pendingObservation, JSON.stringify({ ...pendingResult, elapsedSeconds: 2 }));
  fs.writeFileSync(dataPath, "{}");
  rejectForecast(new Error("Worker stopped"));
  for (const result of await Promise.allSettled([first, duplicate])) assert.match(result.reason.message, /Worker stopped/);

  const server = await startServer({ fightLogDir: root, steamSaveDir: dir, dataPath });
  t.after(() => server.close());
  const { fights } = await (await server.request()).json();
  assert.deepEqual(fights, [{ id, capturedAt: snapshot.record.capturedAt, source: "slot-1.json",
    target: snapshot.target, outcome: "loss", pending: true }]);
  const [firstRead, secondRead] = await Promise.all([server.request(`/${id}`), server.request(`/${id}`)]);
  assert.equal(firstRead.status, 200);
  assert.equal(secondRead.status, 200);
  const { fight } = await firstRead.json();
  assert.deepEqual((await secondRead.json()).fight, fight);
  assert.deepEqual(fight.forecast.dataMetadata, catalog.metadata);
  assert.equal(fight.forecast.player.attack, original.state.playerStats.attack);
  assert.equal(fight.capturedAt, snapshot.record.capturedAt);
  assert.equal(fight.observation.encounterId, "while-running");
  assert.equal(fight.observation.elapsedSeconds, 1.999);
  assert.equal(fight.observation.outcomeProbability, fight.forecast.probabilities.loss);
  assert.ok(fight.forecast.warnings.some(({ code }) => code === "game_version_mismatch"));
  const pendingAfterRead = (await (await server.request()).json()).fights[0];
  assert.equal(pendingAfterRead.pending, undefined);
  assert.deepEqual((await (await server.request("", "POST", request.body)).json()).fight, fight);
});

test("the fight log reads and retries historical forecasts without stored warnings", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-old-forecast-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = randomUUID();
  const dir = path.join(root, id);
  fs.mkdirSync(dir);
  const historical = { id, source: "slot-1.json", capturedAt: new Date().toISOString(),
    forecast: archivedForecast };
  fs.writeFileSync(path.join(dir, "forecast.json"), JSON.stringify(historical));
  const request = { root, pathname: "/api/steam-fights", method: "GET" };
  assert.equal(handleSteamFightRequest(request).fights[0].id, id);
  const { fight } = handleSteamFightRequest({ ...request, pathname: `${request.pathname}/${id}` });
  assert.deepEqual(fight, { ...historical, revision: 0, observation: null });
  assert.deepEqual(await handleSteamFightRequest({ ...request, method: "POST",
    body: { id, trials: archivedForecast.trials, maxSeconds: archivedForecast.maxSeconds } }), { fight });
});

test("the fight log excludes structurally incomplete forecasts from the readable archive", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-incomplete-forecast-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = { root, pathname: "/api/steam-fights", method: "GET" };
  const capturedAt = new Date().toISOString();
  const variants = [
    { target: archivedForecast.target },
    { ...archivedForecast, duration: { ...archivedForecast.duration, medianSeconds: null } },
    { ...archivedForecast, probabilities: { win: 0.25 } },
    { ...archivedForecast, warnings: [null] },
  ];
  const ids = variants.map((forecast) => {
    const id = randomUUID();
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "forecast.json"), JSON.stringify({
      id, source: "slot-1.json", capturedAt, forecast,
    }));
    assert.throws(() => handleSteamFightRequest({ ...request, pathname: `${request.pathname}/${id}` }), { status: 422 });
    return id;
  });
  assert.deepEqual(handleSteamFightRequest(request).fights, ids.sort().reverse().map((id) => ({ id, unreadable: true })));
});
