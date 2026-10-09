import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { GAME_DATA_VERSIONS } from "../src/calibration.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("Duct/Rose/Mobius fixture snapshot matches the patch sanity table", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(projectRoot, "fixtures", "sketch-snapshots.json"), "utf8"));
  const expected = GAME_DATA_VERSIONS[snapshot.gameVersion];

  assert.ok(expected);
  assert.equal(snapshot.saveVersion, expected.saveVersion);
  assert.deepEqual(snapshot.targets, expected.targets);
});
