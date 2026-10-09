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
  assert.equal(resolveSavePath("latest", { downloadsDir: dir }), newer);
  assert.equal(resolveSavePath(older, { downloadsDir: dir }), older);
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
      fundamentals: { maxVictories: 2 },
      availableSketches: ["easy", "hard", "hidden", "done"],
      hiddenSketches: ["hidden"],
      sketchRunVictories: { done: 2 },
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

test("formatNiceNumber formats large stats compactly", () => {
  assert.equal(formatNiceNumber(123456789), "123.46M");
  assert.equal(formatNiceNumber(1.16e228), "1.16e228");
  assert.equal(formatNiceNumber(15320), "15.32K");
  assert.equal(formatNiceNumber(0.123456), "0.123");
});
