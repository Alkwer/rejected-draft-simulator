import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createCurrentRunReport,
  createRunRecommendation,
  findLatestSaveExport,
  formatNiceNumber,
  parseTrialsSetting,
  resolveSavePath,
  resolveTargetId,
  runCombatSimulation,
} from "../src/cli-convenience.js";

test("resolveTargetId accepts short target aliases", () => {
  assert.equal(resolveTargetId("duct"), "duct_taped_banana");
  assert.equal(resolveTargetId("rose"), "rose_window");
  assert.equal(resolveTargetId("mobius"), "mobius_strip");
  assert.equal(resolveTargetId("tp"), "transcendent_paragon");
  assert.equal(resolveTargetId("duct_taped_banana"), "duct_taped_banana");
});

test("target resolution accepts unique catalog labels and preserves ambiguous names", () => {
  const sketches = { "stick man": { name: "Stick Man" }, mobius_strip: { name: "Möbius Strip" },
    early: { name: "Boss" }, late: { name: "Boss" } };
  assert.equal(resolveTargetId("Stick-Man", sketches), "stick man");
  assert.equal(resolveTargetId("Mobius Strip", sketches), "mobius_strip");
  assert.equal(resolveTargetId("Boss", sketches), "Boss");
  assert.equal(resolveTargetId("constructor", sketches), "constructor");
});

test("resolveSavePath latest uses the newest Rejected Draft save export", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-saves-"));
  const older = path.join(dir, "rejected-draft-save-Q1-G1-2026-05-19.txt");
  const newer = path.join(dir, "rejected-draft-save-Q2-G1-2026-05-20.txt");
  const ignored = path.join(dir, "notes.txt");
  fs.writeFileSync(older, "older");
  fs.writeFileSync(newer, "newer");
  fs.writeFileSync(ignored, "ignored");
  fs.utimesSync(older, new Date("2026-05-19T10:00:00Z"), new Date("2026-05-19T10:00:00Z"));
  fs.utimesSync(newer, new Date("2026-05-20T10:00:00Z"), new Date("2026-05-20T10:00:00Z"));

  assert.equal(findLatestSaveExport(dir), newer);
  assert.equal(resolveSavePath("latest", { downloadsDir: dir, steamSaveDir: path.join(dir, "absent") }), newer);
  assert.equal(resolveSavePath(older, { downloadsDir: dir }), older);
});

test("resolveSavePath latest follows the active Steam slot before newer slots and exports", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-steam-saves-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const steamSaveDir = path.join(dir, "steam");
  const downloadsDir = path.join(dir, "downloads");
  fs.mkdirSync(steamSaveDir);
  fs.mkdirSync(downloadsDir);
  const active = path.join(steamSaveDir, "slot-1.json");
  const newer = path.join(steamSaveDir, "slot-6.json");
  const marker = path.join(steamSaveDir, "last-slot.txt");
  const exportPath = path.join(downloadsDir, "rejected-draft-save-latest.txt");
  fs.writeFileSync(active, "active");
  fs.writeFileSync(newer, "newer");
  fs.writeFileSync(marker, "1\r\n");
  fs.writeFileSync(path.join(steamSaveDir, "slot-2.name.json"), "slot name");
  fs.writeFileSync(exportPath, "export");
  fs.utimesSync(active, new Date("2026-05-19T10:00:00Z"), new Date("2026-05-19T10:00:00Z"));
  fs.utimesSync(newer, new Date("2026-05-20T10:00:00Z"), new Date("2026-05-20T10:00:00Z"));

  const options = { downloadsDir, steamSaveDir };
  assert.equal(resolveSavePath("latest", options), active);
  assert.equal(resolveSavePath(exportPath, options), exportPath);
  fs.unlinkSync(marker);
  assert.equal(resolveSavePath("latest", options), newer);
  fs.writeFileSync(marker, "../../downloads/rejected-draft-save-latest.txt");
  assert.equal(resolveSavePath("latest", options), newer);
});

test("runCombatSimulation supports trials auto and records stability metadata", () => {
  const result = runCombatSimulation({
    player: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    enemy: { maxHp: 10, attack: 0, attackSpeed: 10000 },
    maxSeconds: 5,
    seed: "auto-trials-test",
    trialsSetting: parseTrialsSetting("auto", {
      initialTrials: 20,
      maxTrials: 100,
      targetHalfWidth: 0.1,
    }),
  });

  assert.equal(result.autoTrials.mode, "auto");
  assert.equal(result.autoTrials.stable, true);
  assert.ok(result.trials >= 20);
  assert.ok(result.trials <= 100);
  assert.equal(result.wins, result.trials);
});

test("auto trials reuse the fixed seed sequence without repeating fights", () => {
  let reads = 0;
  const fighter = { maxHp: 100, attack: 10, attackSpeed: 1000, dodge: 20, critChance: 15 };
  const options = {
    player: { ...fighter, get maxHp() { reads += 1; return fighter.maxHp; } },
    enemy: fighter,
    maxSeconds: 20,
    seed: "balanced-auto-trials",
  };
  const { autoTrials, ...auto } = runCombatSimulation({ ...options, trialsSetting: parseTrialsSetting("auto", {
    initialTrials: 16,
    maxTrials: 96,
    targetHalfWidth: 0.01,
  }) });
  const autoReads = reads;
  reads = 0;
  const { autoTrials: fixedTrials, ...fixed } = runCombatSimulation({
    ...options,
    trialsSetting: parseTrialsSetting(auto.trials),
  });

  assert.equal(autoTrials.runs, 4);
  assert.equal(autoTrials.stable, false);
  assert.equal(auto.trials, 96);
  assert.equal(fixedTrials.mode, "fixed");
  assert.ok(auto.wins > 0 && auto.losses > 0);
  assert.equal(autoReads, reads);
  assert.deepEqual(auto, fixed);
});

test("parseTrialsSetting defaults to auto when omitted", () => {
  const setting = parseTrialsSetting();

  assert.equal(setting.mode, "auto");
  assert.equal(setting.initialTrials, 400);
  assert.equal(setting.maxTrials, 8000);
  assert.equal(setting.targetHalfWidth, 0.02);
});

test("createCurrentRunReport simulates unbeaten visible active sketches", () => {
  const sketches = {
    easy: {
      id: "easy",
      name: "Easy",
      rarity: "rough",
      stats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
      immunities: [],
    },
    hard: {
      id: "hard",
      name: "Hard",
      rarity: "opus",
      stats: { maxHp: 100000, attack: 1000, attackSpeed: 100 },
      immunities: [],
    },
    hidden: {
      id: "hidden",
      name: "Hidden",
      rarity: "framed",
      stats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
      immunities: [],
    },
    done: {
      id: "done",
      name: "Done",
      rarity: "rough",
      stats: { maxHp: 10, attack: 0, attackSpeed: 10000 },
      immunities: [],
    },
  };

  const report = createCurrentRunReport({
    sketches,
    state: {
      fundamentals: { maxVictories: 2, beyondMaxVictories: 1 },
      availableSketches: ["easy", "hard", "hidden", "done"],
      hiddenSketches: ["hidden"],
      sketchVictories: { done: 2 },
      sketchRunVictories: { easy: 2, done: 1 },
    },
    baseStats: { maxHp: 1000, attack: 1000, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    trialsSetting: parseTrialsSetting(10),
    maxSeconds: 5,
    seed: "current-run-test",
  });

  assert.deepEqual(report.targets.map((item) => item.id), ["easy", "hard"]);
  assert.equal(report.targets[0].winRate, 1);
  assert.equal(report.targets[0].remainingToMax, 2);
  assert.equal(report.skipped.hidden.length, 1);
  assert.equal(report.skipped.completed.length, 1);
});

test("createCurrentRunReport applies Steam universe scaling to catalog sketches by rarity", () => {
  const stats = { maxHp: 100, attack: 0, attackSpeed: 10000 };
  const report = createCurrentRunReport({
    sketches: {
      exhibition: { id: "exhibition", rarity: "artist", stats },
      study: { id: "study", rarity: "rough", stats },
    },
    state: { availableSketches: ["exhibition", "study"] },
    baseStats: { maxHp: 1000, attack: 110, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    trialsSetting: parseTrialsSetting(2),
    maxSeconds: 1.1,
    assumptions: { steam: { universeId: "mv-medium-2" } },
  });

  assert.equal(report.targets.find(({ id }) => id === "exhibition").winRate, 1);
  assert.equal(report.targets.find(({ id }) => id === "exhibition").medianCensored, false);
  const study = report.targets.find(({ id }) => id === "study");
  assert.equal(study.timeoutRate, 1);
  assert.equal(study.medianCensored, true);
  assert.equal(study.p90Censored, true);
});

test("createRunRecommendation returns a concrete finish or redraw decision", () => {
  const finish = createRunRecommendation({
    currentRun: {
      targets: [
        { id: "hard", rarity: "opus", winRate: 0.1, hidden: false },
        { id: "easy", rarity: "rough", winRate: 0.95, hidden: false },
      ],
    },
  });

  assert.equal(finish.action, "finish_first");
  assert.equal(finish.targetId, "easy");

  const redraw = createRunRecommendation({
    targetId: "duct_taped_banana",
    currentRun: {
      targets: [
        { id: "bad", rarity: "rough", winRate: 0.01, hidden: false },
      ],
    },
  });

  assert.equal(redraw.action, "redraw");
  assert.ok(redraw.hideCandidates.some((item) => item.id === "bad"));
});

test("recommendations distinguish one win, supported odds and a borderline estimate", () => {
  const recommendation = (wins, trials) => createRunRecommendation({ targetId: "boss",
    currentRun: { targets: [{ id: "boss", winRate: wins / trials, trials }] } });
  assert.equal(recommendation(1, 1).confidence, "low");
  assert.equal(recommendation(1000, 1000).confidence, "high");
  assert.equal(recommendation(51, 100).action, "increase_trials");
  assert.equal(recommendation(600, 1000).action, "fight_target");
});

test("formatNiceNumber formats large stats compactly", () => {
  assert.equal(formatNiceNumber(123456789), "123.46M");
  assert.equal(formatNiceNumber(1.16e228), "1.16e228");
  assert.equal(formatNiceNumber(15320), "15.32K");
  assert.equal(formatNiceNumber(0.123456), "0.123");
});
