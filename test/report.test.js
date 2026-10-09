import test from "node:test";
import assert from "node:assert/strict";

import {
  createCombatReport,
  explainTarget,
  exportMarkdownReport,
} from "../src/report.js";

test("createCombatReport adds confidence interval, percentiles and breakdown tables", () => {
  const report = createCombatReport({
    target: {
      id: "rose_window",
      name: "Rose Window",
      stats: { maxHp: 10000, regen: 500, armor: 300, remedy: 50, opacity: 20 },
    },
    player: { attack: 100, armorPen: 20, maxHp: 1000 },
    simulation: {
      trials: 100,
      wins: 64,
      losses: 20,
      timeouts: 16,
      winRate: 0.64,
      avgSeconds: 12,
      medianSeconds: 10,
      p10Seconds: 5,
      p90Seconds: 25,
      timeoutRate: 0.16,
      victoryCauses: { raw_damage: 40, bleed: 24 },
      defeatCauses: { raw_attack: 20, regen_wall: 16 },
    },
  });

  assert.equal(report.winRate.percent, 64);
  assert.ok(report.winRate.ci95HalfWidth > 0.09);
  assert.equal(report.time.p10Seconds, 5);
  assert.equal(report.time.p90Seconds, 25);
  assert.equal(report.time.timeoutRate, 0.16);
  assert.deepEqual(report.breakdowns.victories[0], { code: "raw_damage", count: 40, rate: 0.4 });
  assert.deepEqual(report.breakdowns.failures[0], { code: "raw_attack", count: 20, rate: 0.2 });
  assert.ok(report.thresholds.some((item) => item.stat === "armorPen"));
  assert.ok(report.thresholds.some((item) => item.stat === "damagePerSecond"));
});

test("explainTarget returns target-specific interactions and thresholds", () => {
  const mobius = explainTarget({
    target: {
      id: "mobius_strip",
      name: "Mobius Strip",
      stats: { maxHp: 20000, burnChance: 90, burnDamage: 1000, remedy: 120 },
    },
    player: { maxHp: 5000, burnChance: 10, remedy: 5 },
  });

  assert.ok(mobius.interactions.some((item) => item.code === "burn_pressure"));
  assert.ok(mobius.interactions.some((item) => item.code === "remedy_status_clear"));
  assert.ok(mobius.thresholds.some((item) => item.stat === "maxHp"));
});

test("exportMarkdownReport renders report sections", () => {
  const report = createCombatReport({
    target: { id: "duct_taped_banana", name: "Duct-Taped Banana", stats: { maxHp: 1000, attack: 100 } },
    player: { maxHp: 300, attack: 50 },
    simulation: {
      trials: 20,
      wins: 10,
      losses: 5,
      timeouts: 5,
      winRate: 0.5,
      avgSeconds: 8,
      medianSeconds: 7,
      p10Seconds: 3,
      p90Seconds: 15,
      timeoutRate: 0.25,
      victoryCauses: { raw_damage: 10 },
      defeatCauses: { raw_attack: 5, stall: 5 },
    },
  });

  const markdown = exportMarkdownReport(report);

  assert.match(markdown, /# Combat Report: Duct-Taped Banana/);
  assert.match(markdown, /Win rate/);
  assert.match(markdown, /p10 \/ p90/);
  assert.match(markdown, /Failure Breakdown/);
  assert.match(markdown, /Stat Thresholds/);
});
