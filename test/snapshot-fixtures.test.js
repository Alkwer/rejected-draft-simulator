import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { readGameBundle } from "../src/sketch-data.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("the shipped Steam catalog contains the verified Duct/Rose/Mobius records", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(projectRoot, "fixtures", "sketch-snapshots.json"), "utf8"));
  const { sketches, dataMetadata } = readGameBundle(path.join(projectRoot, "data", "steam-catalog.json"));
  assert.equal(dataMetadata.gameVersion, snapshot.gameVersion);
  assert.equal(dataMetadata.buildId, snapshot.buildId);
  assert.equal(dataMetadata.saveVersion, snapshot.saveVersion);
  for (const [id, record] of Object.entries(snapshot.targets)) {
    for (const [field, expected] of Object.entries(record)) assert.deepEqual(sketches[id][field], expected);
  }
});
