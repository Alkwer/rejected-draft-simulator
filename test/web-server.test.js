import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createWebServer } from "../src/web-server.js";

test("web server exposes health and bundle import endpoints", async () => {
  const server = createWebServer({ updateDataOnImport: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const bundle = await fetch(`http://127.0.0.1:${port}/api/import-bundle`, { method: "POST" }).then((response) => response.json());
    assert.equal(bundle.ok, true);
    assert.ok(bundle.bundle.totalSketches > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("web server import endpoint refreshes game data when enabled", async () => {
  let called = 0;
  const server = createWebServer({
    updateGameDataImpl: async () => {
      called += 1;
      return { updated: true, metadata: { gameVersion: "v0.881" } };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const bundle = await fetch(`http://127.0.0.1:${port}/api/import-bundle`, { method: "POST" }).then((response) => response.json());
    assert.equal(bundle.ok, true);
    assert.equal(called, 1);
    assert.equal(bundle.update.updated, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("web server analyze endpoint defaults omitted trials to auto", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-web-server-"));
  const dataPath = path.join(dir, "artistLinks.js");
  fs.writeFileSync(dataPath, `
    export const sketches = [
      {id:"duct_taped_banana",name:"Duct-Taped Banana",rarity:"masterpiece",stats:{maxHp:10,attack:0,attackSpeed:10000},rewards:[]}
    ];
  `);
  const saveText = Buffer.from(JSON.stringify({
    version: 52,
    state: {
      playerStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      battleStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      availableSketches: ["duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: {},
      sketchVictories: {},
      fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50, timeAcceleration: 2 },
    },
  }), "utf8").toString("base64");

  const server = createWebServer({ dataPath, updateDataOnImport: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        saveText,
        targetId: "duct",
        maxSeconds: 20,
        seed: "web-server-default-auto",
      }),
    }).then((res) => res.json());

    assert.equal(response.ok, true, response.error);
    assert.equal(response.analysis.result.autoTrials.mode, "auto");
    assert.ok(response.analysis.result.trials >= 200);
    assert.ok(response.analysis.result.trials <= 4000);

    const missingTargetResponse = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        saveText,
        targetId: "",
        maxSeconds: 20,
      }),
    });
    const missingTarget = await missingTargetResponse.json();
    assert.equal(missingTargetResponse.status, 400);
    assert.equal(missingTarget.ok, false);
    assert.match(missingTarget.error, /targetId/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("web server companion endpoint analyzes raw game localStorage save and allows the game origin", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-companion-server-"));
  const dataPath = path.join(dir, "artistLinks.js");
  fs.writeFileSync(dataPath, `
    export const sketches = [
      {id:"stick man",name:"Stick Man",rarity:"scrap",stats:{maxHp:10,attack:0,attackSpeed:10000},rewards:[{stat:"attack",amount:1}]},
      {id:"duct_taped_banana",name:"Duct-Taped Banana",rarity:"masterpiece",stats:{maxHp:10000,attack:100,attackSpeed:1000},rewards:[]}
    ];
  `);
  const saveText = JSON.stringify({
    version: 52,
    state: {
      playerStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      battleStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      availableSketches: ["stick man", "duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: {},
      sketchVictories: {},
      fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50, timeAcceleration: 2 },
    },
  });

  const server = createWebServer({ dataPath, updateDataOnImport: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const preflight = await fetch(`http://127.0.0.1:${port}/api/companion/analyze`, {
      method: "OPTIONS",
      headers: {
        origin: "https://kuzzigames.com",
        "access-control-request-method": "POST",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://kuzzigames.com");
    assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);

    const response = await fetch(`http://127.0.0.1:${port}/api/companion/analyze`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kuzzigames.com",
      },
      body: JSON.stringify({
        saveText,
        trials: 50,
        maxSeconds: 20,
        seed: "companion-test",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://kuzzigames.com");
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.companion.summary.targetId, "stick man");
    assert.equal(payload.companion.summary.targetName, "Stick Man");
    assert.equal(typeof payload.companion.summary.nextAction.title, "string");
    assert.ok(payload.companion.summary.nextAction.title.length > 0);
    assert.ok(Array.isArray(payload.companion.activeSketches));
    assert.ok(Array.isArray(payload.companion.warnings));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("web server companion endpoint captures and compares a fight fixture", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-companion-fixture-"));
  const dataPath = path.join(dir, "artistLinks.js");
  fs.writeFileSync(dataPath, `
    export const sketches = [
      {id:"duct_taped_banana",name:"Duct-Taped Banana",rarity:"masterpiece",stats:{maxHp:10,attack:0,attackSpeed:10000},rewards:[]}
    ];
  `);
  const saveText = JSON.stringify({
    version: 52,
    state: {
      playerStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      battleStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      availableSketches: ["duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: {},
      sketchVictories: {},
      fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
    },
  });

  const server = createWebServer({ dataPath, updateDataOnImport: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/companion/fight-fixture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kuzzigames.com",
      },
      body: JSON.stringify({
        saveText,
        targetId: "duct",
        seed: "companion-fixture-test",
        maxSeconds: 5,
        traceSeconds: 3,
        observed: {
          outcome: "win",
          seconds: 1.001,
          playerHp: 1000,
          enemyHp: 0,
          damageBreakdown: {
            player: { total: 0 },
            enemy: { direct: 10, total: 10 },
          },
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://kuzzigames.com");
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.fixtureCapture.source, "provided_observation");
    assert.equal(payload.fixtureCapture.fixture.targetId, "duct_taped_banana");
    assert.equal(payload.fixtureCapture.parity.ok, true);
    assert.equal(payload.fixtureCapture.parity.trace.seed, "companion-fixture-test");
    assert.match(payload.fixtureCapture.filename, /duct_taped_banana.*\.json/);
    assert.match(payload.fixtureCapture.cliEquivalent, /--fight-fixture/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("web server companion endpoint infers observed wins from browser save history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-companion-history-"));
  const dataPath = path.join(dir, "artistLinks.js");
  fs.writeFileSync(dataPath, `
    export const sketches = [
      {id:"duct_taped_banana",name:"Duct-Taped Banana",rarity:"masterpiece",stats:{maxHp:10,attack:0,attackSpeed:10000},rewards:[]}
    ];
  `);
  const beforeSave = {
    version: 52,
    state: {
      playerStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      battleStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      availableSketches: ["duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: { duct_taped_banana: 0 },
      sketchVictories: { duct_taped_banana: 0 },
      combatState: { isFighting: true, enemyId: "duct_taped_banana" },
      fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50 },
    },
  };
  const afterSave = {
    version: 52,
    state: {
      ...beforeSave.state,
      sketchRunVictories: { duct_taped_banana: 1 },
      sketchVictories: { duct_taped_banana: 1 },
      combatState: { isFighting: false, enemyId: null },
    },
  };

  const server = createWebServer({ dataPath, updateDataOnImport: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/companion/fight-fixture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kuzzigames.com",
      },
      body: JSON.stringify({
        saveText: JSON.stringify(afterSave),
        targetId: "duct",
        seed: "companion-history-test",
        maxSeconds: 5,
        traceSeconds: 3,
        browserSnapshot: {
          companionVersion: "test-version",
          saveHistory: [
            { capturedAt: "2026-05-23T19:05:00.000Z", saveText: JSON.stringify(beforeSave) },
            { capturedAt: "2026-05-23T19:05:03.500Z", saveText: JSON.stringify(afterSave) },
          ],
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.fixtureCapture.source, "browser_save_history");
    assert.equal(payload.fixtureCapture.fixture.observed.outcome, "win");
    assert.equal(payload.fixtureCapture.fixture.observed.targetId, "duct_taped_banana");
    assert.equal(payload.fixtureCapture.fixture.observed.approximateSeconds, 3.5);
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.companionVersion, "test-version");
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.saveHistoryCount, 2);
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.combatLoggingEnabled, null);
    assert.equal(payload.fixtureCapture.parity.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("web server companion fixture includes diagnostics when no observed fight is available", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-companion-diagnostics-"));
  const dataPath = path.join(dir, "artistLinks.js");
  fs.writeFileSync(dataPath, `
    export const sketches = [
      {id:"duct_taped_banana",name:"Duct-Taped Banana",rarity:"masterpiece",stats:{maxHp:10,attack:0,attackSpeed:10000},rewards:[]}
    ];
  `);
  const saveText = JSON.stringify({
    version: 52,
    state: {
      combatLoggingEnabled: true,
      combatLogs: [],
      playerStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 1, maxDamage: 1 },
      battleStats: { maxHp: 1000, attack: 1, attackSpeed: 1000, accuracy: 100, minDamage: 1, maxDamage: 1 },
      availableSketches: ["duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: { duct_taped_banana: 0 },
      sketchVictories: { duct_taped_banana: 0 },
      fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50, timeAcceleration: 2 },
    },
  });

  const server = createWebServer({ dataPath, updateDataOnImport: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/companion/fight-fixture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kuzzigames.com",
      },
      body: JSON.stringify({
        saveText,
        targetId: "duct",
        browserSnapshot: {
          companionVersion: "test-version",
          saveHistory: [{ capturedAt: "2026-05-23T19:05:00.000Z", saveText }],
          localStorageCandidates: [
            { key: "some-combat-key", value: "{\"empty\":true}" },
          ],
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.fixtureCapture.source, "no_observed_fight");
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.companionVersion, "test-version");
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.combatLoggingEnabled, true);
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.saveCombatLogCount, 0);
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.saveHistoryCount, 1);
    assert.deepEqual(payload.fixtureCapture.fixture.captureDiagnostics.localStorageCandidateKeys, ["some-combat-key"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("web server companion endpoint reads a visible combat log snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-companion-visible-log-"));
  const dataPath = path.join(dir, "artistLinks.js");
  fs.writeFileSync(dataPath, `
    export const sketches = [
      {id:"duct_taped_banana",name:"Duct-Taped Banana",rarity:"masterpiece",stats:{maxHp:10,attack:0,attackSpeed:10000},rewards:[]}
    ];
  `);
  const saveText = JSON.stringify({
    version: 52,
    state: {
      combatLoggingEnabled: true,
      playerStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      battleStats: { maxHp: 1000, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
      availableSketches: ["duct_taped_banana"],
      hiddenSketches: [],
      sketchRunVictories: { duct_taped_banana: 0 },
      sketchVictories: { duct_taped_banana: 0 },
      fundamentals: { maxVictories: 2, rewardDecay: 1, rewardBoosterEffect: 50, timeAcceleration: 2 },
    },
  });

  const server = createWebServer({ dataPath, updateDataOnImport: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/companion/fight-fixture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kuzzigames.com",
      },
      body: JSON.stringify({
        saveText,
        targetId: "duct",
        browserSnapshot: {
          companionVersion: "test-version",
          visibleCombatLog: {
            text: [
              "Combat Log",
              "History:",
              "Duct-Taped Banana (VICTORY)",
              "Enemy: Duct-Taped Banana",
              "Events: 23",
              "Time: 4.2s",
              "VICTORY",
            ].join("\n"),
          },
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.fixtureCapture.source, "browser_visible_combat_log");
    assert.equal(payload.fixtureCapture.fixture.observed.outcome, "win");
    assert.equal(payload.fixtureCapture.fixture.observed.targetName, "Duct-Taped Banana");
    assert.equal(payload.fixtureCapture.fixture.observed.approximateSeconds, 4.2);
    assert.equal(payload.fixtureCapture.fixture.observed.eventCount, 23);
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.visibleCombatLogPresent, true);
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.visibleCombatLogCharacters > 20, true);
    assert.equal(payload.fixtureCapture.fixture.captureDiagnostics.combatSpeedMultiplier, 2);
    assert.equal(payload.fixtureCapture.fixture.assumptions.combatSpeedMultiplier, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
