import { Worker, parentPort, workerData } from "node:worker_threads";
import { readGameBundle } from "./sketch-data.js";
import { createSteamFightForecast } from "./steam-fight-forecast.js";
import { createCompanionAnalysis, createWebAnalysis } from "./web-core.js";

const workerName = "simulator-analysis";

if (workerData === workerName && parentPort) {
  parentPort.on("message", ({ id, companion, dataPath, options, steamForecast }) => {
    try {
      const analyze = companion ? createCompanionAnalysis : createWebAnalysis;
      const analysis = steamForecast ? createSteamFightForecast(options) : analyze({ ...options, ...readGameBundle(dataPath) });
      parentPort.postMessage({ id, analysis });
    } catch (error) {
      parentPort.postMessage({ id, error: error.message ?? String(error), status: error.status });
    }
  });
}

// Each runner serializes CPU-heavy work while HTTP and Steam monitoring callbacks run on the main thread.
export function createAnalysisRunner() {
  let worker;
  let nextId = 0;
  const pending = new Map();
  function disconnect(instance, error) {
    if (worker !== instance) return;
    worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  function runRequest(payload) {
    if (!worker) {
      const instance = new Worker(new URL(import.meta.url), { workerData: workerName, execArgv: [] });
      worker = instance;
      instance.on("message", ({ id, analysis, error, status }) => {
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        if (error !== undefined) request.reject(Object.assign(new Error(error), { status }));
        else request.resolve(analysis);
      });
      instance.once("error", (error) => disconnect(instance, error));
      instance.once("exit", (code) => disconnect(instance, new Error(`Analysis worker exited (${code}).`)));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      worker.postMessage({ id, ...payload });
      pending.set(id, { resolve, reject });
    });
  }
  return {
    run(dataPath, options, companion = false) {
      return runRequest({ dataPath, options, companion });
    },
    runSteamForecast(options) {
      return runRequest({ steamForecast: true, options });
    },
    close() {
      if (worker) {
        const instance = worker;
        disconnect(instance, new Error("Simulator server closed."));
        void instance.terminate();
      }
    },
  };
}
