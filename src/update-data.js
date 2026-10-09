import path from "node:path";

import {
  checkGameDataFreshness,
  DEFAULT_DATA_PATH,
  DEFAULT_GAME_URL,
  updateGameData,
} from "./game-data-update.js";
import { readDataMetadata } from "./sketch-data.js";

const args = parseArgs(process.argv.slice(2));
const dataPath = path.resolve(args.data ?? DEFAULT_DATA_PATH);
const gameUrl = args["game-url"] ?? DEFAULT_GAME_URL;
const offlineFallback = args["no-offline"] !== true;
const jsonOutput = args.json === true;

try {
  if (args.check) {
    const freshness = await checkGameDataFreshness({ gameUrl, localMetadata: readDataMetadata(dataPath) });
    printResult(freshness, jsonOutput);
  } else {
    const result = await updateGameData({ gameUrl, dataPath, offlineFallback });
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
      console.log("Game data is older than the current game page.");
      for (const warning of result.warnings) console.log(`- ${warning.message}`);
    } else {
      console.log("Local game data matches the current game page assets.");
    }
    return;
  }

  if (result.offline) {
    console.log(`Offline fallback: using cached data at ${result.dataPath}`);
    console.log(`Reason: ${result.error}`);
    return;
  }

  console.log(`Updated ${result.dataPath}`);
  console.log(`Game version: ${result.metadata.gameVersion ?? "unknown"}`);
  console.log(`Save version: ${result.metadata.saveVersion ?? "unknown"}`);
  console.log(`Artist asset: ${result.metadata.asset}`);
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
