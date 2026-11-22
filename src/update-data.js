import path from "node:path";

import {
  checkGameDataFreshness,
  DEFAULT_DATA_PATH,
  LEGACY_DATA_PATH,
  updateGameData,
} from "./game-data-update.js";

const args = parseArgs(process.argv.slice(2));
const gameUrl = args["game-url"];
const dataPath = path.resolve(args.data ?? (gameUrl ? LEGACY_DATA_PATH : DEFAULT_DATA_PATH));
const steamDir = args["steam-dir"];
const offlineFallback = args["no-offline"] !== true;
const jsonOutput = args.json === true;

try {
  if (steamDir === true || gameUrl === true || (steamDir && gameUrl)) {
    throw new Error("Select a Steam folder with --steam-dir <folder> or a legacy page with --game-url <url>.");
  }
  if (args.check) {
    const freshness = await checkGameDataFreshness({ gameUrl, steamDir, dataPath });
    printResult(freshness, jsonOutput);
  } else {
    const result = await updateGameData({ gameUrl, steamDir, dataPath, offlineFallback });
    printResult(result, jsonOutput);
  }
} catch (error) {
  const payload = { ok: false, error: error.message ?? String(error) };
  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(payload.error);
  }
  process.exitCode = 1;
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if ("stale" in result) {
    if (result.stale) {
      for (const warning of result.warnings) console.log(`- ${warning.message}`);
    } else {
      console.log(gameUrl ? "Local data matches the legacy web assets." : "Local data matches the installed Steam build.");
    }
    return;
  }

  if (result.offline) {
    console.log(`Offline fallback: using cached data at ${result.dataPath}`);
    console.log(`Reason: ${result.error}`);
    return;
  }

  console.log(`${result.updated ? "Updated" : "Already current"}: ${result.dataPath}`);
  if (result.metadata.buildId) console.log(`Steam build: ${result.metadata.buildId}`);
  console.log(`Game version: ${result.metadata.gameVersion ?? "unknown"}`);
  console.log(`Save version: ${result.metadata.saveVersion ?? "unknown"}`);
  console.log(`Sketch asset: ${result.metadata.asset}`);
  console.log(`Main asset: ${result.metadata.mainAsset}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
