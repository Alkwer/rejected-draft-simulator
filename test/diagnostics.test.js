import test from "node:test";
import assert from "node:assert/strict";

import {
  compareObservedOutcome,
  createDiagnosticReport,
  createModelAssumptionComparisons,
  detectExtremeStats,
} from "../src/diagnostics.js";

const player = {
  id: "player",
  maxHp: 1000,
  attack: 1000,
  attackSpeed: 1000,
  accuracy: 100,
  minDamage: 100,
  maxDamage: 100,
  burnChance: 50,
  burnDamage: 100,
};

const suspiciousTarget = {
  id: "free_draw_kahlo",
  name: "Freedraw Kahlo",
  rarity: "opus",
  stats: {
    maxHp: 1e12,
    attack: 8e7,
    attackSpeed: 900,
    freezeChance: 3000,
    exacerbateChance: 1500,
    armor: 1e9,
    blockChance: 50,
    blockAmount: 1e10,
    regen: 1e9,
    bananaPeelChance: 1500,
  },
  immunities: ["burnChance"],
  vulnerability: ["freezeChance", 2],
};

test("createDiagnosticReport explains low win rate, sanity, warnings and confidence", () => {
  const simulation = {
    trials: 1200,
    winRate: 0,
    timeoutRate: 0.95,
    wins: 0,
    losses: 60,
    timeouts: 1140,
    p90Seconds: 300,
    winRateCi95: { halfWidth: 0.01 },
    defeatCauses: { regen_wall: 900, armor_wall: 240, raw_attack: 60 },
    victoryCauses: {},
    timeoutDiagnoses: { regen_wall: 900, armor_wall: 240 },
  };
  const report = {
    thresholds: [
      { stat: "damagePerSecond", current: 1000, target: 1e9, reason: "Beat HP and regen before timeout." },
      { stat: "armorPen", current: 0, target: 1e9, reason: "Avoid direct damage collapsing into armor." },
    ],
    breakdowns: {
      failures: [
        { code: "regen_wall", count: 900, rate: 0.75 },
        { code: "armor_wall", count: 240, rate: 0.2 },
      ],
      victories: [],
    },
  };

  const diagnostics = createDiagnosticReport({
    target: suspiciousTarget,
    player,
    simulation,
    report,
    dataMetadata: { gameVersion: "v0.881", saveVersion: 52 },
  });

  assert.equal(diagnostics.confidence.level, "low");
  assert.ok(diagnostics.why.some((item) => item.code === "regen_wall"));
  assert.ok(diagnostics.why.some((item) => item.code === "armor_wall"));
  assert.ok(diagnostics.sanityChecks.some((item) => item.code === "zero_win_rate" && item.status === "hard_wall"));
  assert.ok(diagnostics.warnings.some((item) => item.code === "special_immunities"));
  assert.ok(diagnostics.warnings.some((item) => item.code === "vulnerability_model"));
  assert.ok(diagnostics.extremes.some((item) => item.stat === "freezeChance" && item.interpretedChance === 30));
});

test("compareObservedOutcome flags likely model mismatch for practical losses", () => {
  const mismatch = compareObservedOutcome({
    observedOutcome: "loss",
    simulation: {
      winRate: 0.86,
      timeoutRate: 0.01,
      trials: 1000,
      winRateCi95: { halfWidth: 0.02 },
      defeatCauses: { status_damage: 40 },
    },
    diagnostics: {
      warnings: [{ code: "extreme_enemy_chance", detail: "plagueChance is scaled" }],
      extremes: [{ stat: "plagueChance" }],
    },
  });

  assert.equal(mismatch.status, "mismatch");
  assert.equal(mismatch.code, "model_overestimates");
  assert.match(mismatch.detail, /status|scaling|mechanic/i);
});

test("diagnostic user-facing messages are English", () => {
  const noObservation = compareObservedOutcome({
    observedOutcome: "",
    simulation: { winRate: 0.5, timeoutRate: 0, winRateCi95: { halfWidth: 0.01 } },
  });
  const report = createDiagnosticReport({
    target: suspiciousTarget,
    player,
    simulation: {
      trials: 20,
      winRate: 0.5,
      timeoutRate: 0,
      wins: 10,
      losses: 10,
      timeouts: 0,
      winRateCi95: { halfWidth: 0.08 },
      defeatCauses: { raw_attack: 10 },
      victoryCauses: { raw_damage: 10 },
    },
    report: { thresholds: [], breakdowns: { failures: [], victories: [] } },
    observedOutcome: "loss",
  });
  const combined = JSON.stringify([noObservation, report]);

  assert.match(noObservation.detail, /No practical observation/i);
  assert.match(report.confidence.label, /high|medium|low/);
  for (const forbidden of ["Brak", "Symulator", "praktyka", "Wynik", "Zrob", "porownaj", "Obserwacja", "sprawdz"]) {
    assert.doesNotMatch(combined, new RegExp(forbidden, "i"));
  }
});

test("detectExtremeStats reports exported chance interpretation", () => {
  const extremes = detectExtremeStats({
    target: {
      id: "joan_of_art",
      name: "Joan of Art",
      stats: { plagueChance: 9000, thornsChance: 6000000000, blockAmount: 10000000000 },
    },
  });

  assert.ok(extremes.some((item) => item.stat === "plagueChance" && item.interpretedChance === 90));
  assert.ok(extremes.some((item) => item.stat === "thornsChance" && item.severity === "critical"));
  assert.ok(extremes.some((item) => item.stat === "blockAmount" && item.kind === "large_number"));
});

test("createModelAssumptionComparisons compares status, DoT and enemy buff assumptions", () => {
  const target = {
    id: "assumption_target",
    name: "Assumption Target",
    stats: { maxHp: 2000, attack: 10, attackSpeed: 1000, burnChance: 3000, thornsChance: 3000 },
    immunities: [],
    vulnerability: null,
  };
  const comparisons = createModelAssumptionComparisons({
    target,
    player,
    baseline: { winRate: 0.5, timeoutRate: 0.1, p90Seconds: 10 },
    trials: 40,
    maxSeconds: 20,
    seed: "assumption-comparison",
  });

  assert.deepEqual(comparisons.map((item) => item.id), [
    "baseline",
    "enemy_status_x1",
    "dot_half",
    "enemy_buff_x1",
  ]);
  assert.ok(comparisons.every((item) => Number.isFinite(item.winRate)));
  assert.ok(comparisons.some((item) => item.deltaWinRate !== 0));
});

test("regression diagnostics cover Kahlo/Joan false zero, Duct false full and Vinchy false high cases", () => {
  const kahloZero = createDiagnosticReport({
    target: suspiciousTarget,
    player,
    simulation: {
      trials: 100,
      winRate: 0,
      timeoutRate: 0,
      wins: 0,
      losses: 100,
      timeouts: 0,
      winRateCi95: { halfWidth: 0.04 },
      defeatCauses: { raw_attack: 100 },
    },
    report: { thresholds: [], breakdowns: { failures: [{ code: "raw_attack", count: 100, rate: 1 }], victories: [] } },
  });
  assert.ok(kahloZero.sanityChecks.some((item) => item.code === "zero_win_rate" && item.status === "suspicious"));

  const ductFull = createDiagnosticReport({
    target: { id: "duct_taped_banana", name: "Duct-Taped Banana", stats: { bananaPeelChance: 9000, dodge: 44, absorb: 95 }, immunities: [], vulnerability: null },
    player,
    simulation: {
      trials: 50,
      winRate: 1,
      timeoutRate: 0,
      wins: 50,
      losses: 0,
      timeouts: 0,
      p90Seconds: 1,
      winRateCi95: { halfWidth: 0.08 },
      victoryCauses: { raw_damage: 50 },
    },
    report: { thresholds: [], breakdowns: { failures: [], victories: [{ code: "raw_damage", count: 50, rate: 1 }] } },
  });
  assert.ok(ductFull.sanityChecks.some((item) => item.code === "full_win_rate" && item.status === "suspicious"));

  const vinchyMismatch = compareObservedOutcome({
    observedOutcome: "loss",
    simulation: { trials: 1000, winRate: 0.48, timeoutRate: 0.2, winRateCi95: { halfWidth: 0.03 }, defeatCauses: { status_wall: 200 } },
    diagnostics: { warnings: [{ code: "opacity_remedy_model" }], extremes: [] },
  });
  assert.equal(vinchyMismatch.status, "watch");
  assert.match(vinchyMismatch.detail, /variance|sample|mechanic/i);
});
