#!/usr/bin/env node
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { runMonteCarlo } from "./combat.js";

export function runBenchmark({
  trials = 1000,
  seed = "benchmark",
  maxSeconds = 30,
} = {}) {
  const player = {
    maxHp: 100000,
    attack: 2500,
    attackSpeed: 1000,
    accuracy: 100,
    minDamage: 100,
    maxDamage: 100,
    burnChance: 150,
    burnDamage: 500,
    bleedChance: 50,
    freezeChance: 25,
  };
  const enemy = {
    id: "benchmark_target",
    name: "Benchmark Target",
    maxHp: 250000,
    attack: 500,
    attackSpeed: 1200,
    armor: 100,
    absorb: 5,
  };

  const startedAt = performance.now();
  const summary = runMonteCarlo({
    player,
    enemy,
    trials,
    seed,
    maxSeconds,
  });
  const elapsedMs = Math.max(0.001, performance.now() - startedAt);

  return {
    trials,
    elapsedMs,
    simulationsPerSecond: trials / (elapsedMs / 1000),
    winRate: summary.winRate,
    timeoutRate: summary.timeoutRate,
    medianSeconds: summary.medianSeconds,
  };
}

function printBenchmark(result, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Rejected Draft Simulator benchmark");
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
  const result = runBenchmark({
    trials: Math.max(1, Math.floor(Number(args.trials ?? 1000) || 1000)),
    seed: args.seed ?? "benchmark",
    maxSeconds: Number(args["max-seconds"] ?? 30),
  });
  printBenchmark(result, { json: Boolean(args.json) });
}
