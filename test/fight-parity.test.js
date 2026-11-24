import test from "node:test";
import assert from "node:assert/strict";

import {
  compareFightParityFixture,
  normalizeFightFixture,
  renderFightParityMarkdown,
} from "../src/fight-parity.js";

const deterministicWinFixture = {
  id: "deterministic_direct_win",
  targetId: "training_target",
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
  player: {
    id: "player",
    maxHp: 1000,
    attack: 10,
    attackSpeed: 1000,
    accuracy: 100,
    minDamage: 100,
    maxDamage: 100,
  },
  enemy: {
    id: "training_target",
    name: "Training Target",
    maxHp: 10,
    attack: 0,
    attackSpeed: 10000,
  },
};

test("compareFightParityFixture matches a deterministic observed fight", () => {
  const parity = compareFightParityFixture({
    fixture: deterministicWinFixture,
    seed: "fight-parity-match",
    maxSeconds: 5,
    traceSeconds: 3,
  });

  assert.equal(parity.ok, true);
  assert.equal(parity.comparedFields, 7);
  assert.equal(parity.fixtureId, "deterministic_direct_win");
  assert.equal(parity.targetId, "training_target");
  assert.deepEqual(parity.deviations, []);
  assert.equal(parity.observed.outcome, "win");
  assert.equal(parity.simulated.outcome, "win");
  assert.equal(parity.simulated.reason, "enemy_hp_zero");
  assert.ok(parity.trace.events.some((event) => event.event === "attack"));
  assert.ok(parity.trace.events.some((event) => event.event === "finish"));
});

test("fight parity recognizes terminal HP codes in both nested and flat observations", () => {
  assert.equal(normalizeFightFixture({ observed: { outcome: "player_hp_zero" } }).observed.outcome, "loss");
  assert.equal(normalizeFightFixture({ result: "enemy_hp_zero" }).observed.outcome, "win");
  assert.equal(normalizeFightFixture({ observed: { reason: "player_hp_zero" } }).observed.outcome, "loss");
  assert.equal(normalizeFightFixture({ result: { status: "timeout_stall" } }).observed.outcome, "timeout");
});

test("fight parity compares full fight damage when the event trace ends before combat", () => {
  const parity = compareFightParityFixture({
    fixture: deterministicWinFixture,
    maxSeconds: 5,
    traceSeconds: 0.5,
  });

  assert.equal(parity.ok, true);
  assert.equal(parity.comparedFields, 7);
  assert.ok(parity.trace.events.every(({ time }) => time <= 0.5));
  assert.ok(!parity.trace.events.some(({ event }) => event === "attack" || event === "finish"));
  assert.equal(parity.simulated.damageBreakdown.enemy.direct, 10);
  assert.equal(parity.simulated.damageBreakdown.enemy.total, 10);
});

test("compareFightParityFixture reports outcome and numeric mismatches", () => {
  const parity = compareFightParityFixture({
    fixture: {
      ...deterministicWinFixture,
      id: "deterministic_mismatch",
      observed: {
        ...deterministicWinFixture.observed,
        outcome: "loss",
        seconds: 4,
        playerHp: 0,
        enemyHp: 10,
      },
    },
    seed: "fight-parity-mismatch",
    maxSeconds: 5,
    traceSeconds: 3,
  });

  assert.equal(parity.ok, false);
  assert.ok(parity.deviations.some((item) => item.code === "outcome_mismatch"));
  assert.ok(parity.deviations.some((item) => item.code === "duration_mismatch"));
  assert.ok(parity.deviations.some((item) => item.code === "player_hp_mismatch"));
  assert.ok(parity.deviations.some((item) => item.code === "enemy_hp_mismatch"));
});

test("empty observations cannot pass parity, while an observed zero or event can", () => {
  const compare = (observed) => compareFightParityFixture({ fixture: { ...deterministicWinFixture, observed } });
  const empty = compare({ outcome: "unknown", reason: "No combat log", events: [null, {}] });
  assert.equal(empty.status, "no_observation");
  assert.equal(empty.ok, false);
  assert.equal(empty.comparedFields, 0);
  assert.match(renderFightParityMarkdown(empty), /NO OBSERVATION/);
  assert.equal(compare({ enemyHp: 0 }).comparedFields, 1);
  assert.equal(compare({ events: [{ event: "attack" }] }).status, "match");
});

test("indexed events must match type, action and observation order", () => {
  const compare = (events) => compareFightParityFixture({
    fixture: { ...deterministicWinFixture, observed: { events } },
  });
  const attack = compare([]).trace.events.find((event) => event.event === "attack");
  assert.equal(compare([{ index: 1, event: "start" },
    { index: attack.index, event: "attack", action: attack.action.type }]).status, "match");
  for (const events of [
    [{ index: 1, event: "attack" }],
    [{ index: attack.index, event: "attack", action: "wrong_action" }],
    [{ index: attack.index }, { index: 1 }],
    [{ index: 1 }, { index: 1 }],
  ]) {
    assert.equal(compare(events).status, "mismatch");
  }
});

test("compareFightParityFixture applies combat speed multiplier from fixture assumptions", () => {
  const parity = compareFightParityFixture({
    fixture: {
      ...deterministicWinFixture,
      id: "deterministic_speed_multiplier",
      observed: {
        ...deterministicWinFixture.observed,
        seconds: 0.5,
      },
      assumptions: {
        combatSpeedMultiplier: 2,
      },
    },
    seed: "fight-parity-speed",
    maxSeconds: 5,
    traceSeconds: 3,
  });

  assert.equal(parity.ok, true);
  assert.equal(parity.simulated.seconds, 0.5);
  assert.deepEqual(parity.deviations, []);
});

test("renderFightParityMarkdown summarizes the fixture comparison", () => {
  const parity = compareFightParityFixture({
    fixture: deterministicWinFixture,
    seed: "fight-parity-markdown",
    maxSeconds: 5,
    traceSeconds: 3,
  });
  const markdown = renderFightParityMarkdown(parity);

  assert.match(markdown, /# Fight Parity Fixture/);
  assert.match(markdown, /deterministic_direct_win/);
  assert.match(markdown, /PASS/);
  assert.match(markdown, /Training Target/);
});
