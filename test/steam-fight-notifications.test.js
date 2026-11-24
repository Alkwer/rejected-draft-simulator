import assert from "node:assert/strict";
import test from "node:test";
import { inspectHyenaHistory } from "../src/steam-fight-notifications.js";

const since = 1_000_000;
const win = { type: "VICTORY", message: "Pokonano Hyena Hulk!\n+2 zwycięstw", timestamp: since + 6200,
  action: { kind: "combat-log", encounterId: "combat-2", startTime: since + 35 } };
const loss = { type: "DEFEAT", message: "Defeated by Hyena Hulk! 7 second cooldown.", timestamp: since + 9000,
  action: { kind: "combat-log", encounterId: "combat-3", startTime: since + 7340 } };
function inspect(history, window = {}, state = {}) {
  return inspectHyenaHistory({ meta: { savedAt: since + 10000 },
    state: { notificationHistory: history, ...state } }, { since, ...window });
}

test("matches the first subsequent Hyena encounter by target, category, timing and slot window", () => {
  const history = [loss, win,
    { ...loss, message: "Defeated by Other Hyena Hulk! 8 second cooldown." },
    { ...win, action: { ...win.action, startTime: since - 10000 }, timestamp: since + 1 }];
  const match = inspect(history);
  assert.equal(match.outcome, "win");
  assert.equal(match.elapsedSeconds, 6.165);
  assert.deepEqual(match.evidence, { source: "steam-notification", encounterId: "combat-2",
    startedAt: win.action.startTime, notifiedAt: win.timestamp });
  assert.equal(inspect([loss]).elapsedSeconds, 1.66);
  assert.equal(inspect([loss], { until: since + 8000 }).status, "superseded");
  assert.equal(inspect([{ ...loss, type: "VICTORY" }]).status, "waiting");
  assert.equal(inspect([{ ...win, action: { ...win.action, startTime: since - 10000 } }]).status, "waiting");
  assert.equal(inspect([{ ...loss, message: "Pokonane przez Hyena Hulk! 7 sekundowe odnowienie." }]).outcome, "loss");
  assert.equal(inspect([{ ...win, message: "鬣狗浩克 已被击败！" }]).outcome, "win");
  assert.equal(inspect([loss, null, win]).evidence.encounterId, win.action.encounterId);
});

test("missing timing, disabled notifications and rotated histories never invent a result", () => {
  for (const action of [null, { ...win.action, startTime: "100" }, { ...win.action, kind: "training" },
    { ...win.action, startTime: win.timestamp + 1 }]) {
    assert.equal(inspect([{ ...win, action }, loss]).status, "missing-timing");
  }
  assert.equal(inspect([], {}, { notificationSettings: { VICTORY: { inGame: false } } }).status, "settings");
  assert.equal(inspect(undefined).status, "unavailable");
  const general = { type: "GENERAL", timestamp: since + 1 };
  const full = [loss, ...Array(9).fill(general)];
  assert.equal(inspect(full).status, "history-gap");
  assert.equal(inspect(full.slice(0, 5), {}, { notificationStyle: "basic" }).status, "history-gap");
  assert.equal(inspect(full, { checkedThrough: since + 100 }).outcome, "loss");
});
