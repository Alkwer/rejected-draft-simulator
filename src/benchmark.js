#!/usr/bin/env node
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { runMonteCarlo } from "./combat.js";

const directPlayer = {
  maxHp: 100000,
  attack: 2500,
  attackSpeed: 1000,
  accuracy: 100,
  minDamage: 100,
  maxDamage: 100,
};
const baseEnemy = {
  id: "benchmark_target", name: "Benchmark Target",
  maxHp: 250000, attack: 500, attackSpeed: 1200, armor: 100, absorb: 5,
};
const scenarios = {
  status: {
    player: { ...directPlayer, burnChance: 150, burnDamage: 500, bleedChance: 50, freezeChance: 25 },
    enemy: baseEnemy,
  },
  direct: { player: directPlayer, enemy: { ...baseEnemy, maxHp: 10000 } },
  "regen-wall": { player: directPlayer, enemy: { ...baseEnemy, attack: 0, regen: 5000 } },
};

export function runBenchmark({ scenario = "status", trials = 1000, seed = "benchmark", maxSeconds = 30 } = {}) {
  if (!Object.hasOwn(scenarios, scenario)) throw new RangeError("--scenario must be status, direct or regen-wall.");
  if (!Number.isSafeInteger(trials) || trials < 1) throw new RangeError("--trials must be a positive integer.");
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw new RangeError("--max-seconds must be a positive, finite number.");
  const startedAt = performance.now();
  const summary = runMonteCarlo({
    ...scenarios[scenario],
    trials,
    seed,
    maxSeconds,
  });
  const elapsedMs = Math.max(0.001, performance.now() - startedAt);

  return {
    scenario,
    seed,
    maxSeconds,
    trials,
    elapsedMs,
    simulationsPerSecond: trials / (elapsedMs / 1000),
    winRate: summary.winRate,
    timeoutRate: summary.timeoutRate,
    timeoutDiagnoses: summary.timeoutDiagnoses,
    medianSeconds: summary.medianSeconds,
    medianCensored: summary.medianCensored,
  };
}

function printBenchmark(result, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Rejected Draft Simulator benchmark");
  console.log(`Scenario: ${result.scenario} | Seed: ${result.seed} | Fight limit: ${result.maxSeconds}s`);
  console.log(`Trials: ${result.trials}`);
  console.log(`Elapsed: ${result.elapsedMs.toFixed(2)}ms`);
  console.log(`Simulations/sec: ${result.simulationsPerSecond.toFixed(0)}`);
  console.log(`Win rate: ${(result.winRate * 100).toFixed(2)}%`);
  console.log(`Timeout rate: ${(result.timeoutRate * 100).toFixed(2)}%`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = runBenchmark({
      scenario: args.scenario,
      trials: args.trials === undefined ? undefined : Number(String(args.trials)),
      seed: args.seed,
      maxSeconds: args["max-seconds"] === undefined ? undefined : Number(String(args["max-seconds"])),
    });
    printBenchmark(result, { json: Boolean(args.json) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
