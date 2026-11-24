import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncSteamCatalog } from "../src/steam-catalog.js";
import { readGameBundle } from "../src/sketch-data.js";

function writeTestArchive(dir, { profile = "steam", stat = 40, checksum, shopEffect = "e=>new D(1).plus(new D(.3).times(e))" } = {}) {
  const sketch = `const profiles={steam:{id:"steam",sketchStatOverrides:{},sketchRewardOverrides:{}},"steam-demo":{}};
    const version="v0.99",sketches=[{id:"sample",name:"Sample",rarity:"rough",stats:{maxHp:new D(${stat}),attack:1,attackSpeed:500},rewards:[]}];`;
  const store = "const $v=89,options={version:$v,skipHydration:true};";
  const shop = `const upgrades=[{id:"upgrade_sample",stat:"attack",currency:"Wax",baseCost:new D("1e40"),costMultiplier:10,multiplier:${shopEffect},maxLevel:25,isHidden:!0}];`;
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  const members = {
    "package.json": JSON.stringify({ name: "rejected-draft", version: "0.99.0" }),
    "dist/steam-build-renderer.json": JSON.stringify({ profile, target: "renderer", buildId: "fixture",
      files: { "assets/data-sketches-A.js": checksum ?? digest(sketch), "assets/game-store-A.js": digest(store),
        "assets/data-skill-tree-A.js": digest(shop), "assets/main-A.js": digest("") } }),
    "dist/assets/data-skill-tree-A.js": shop,
    "dist/assets/game-store-A.js": store,
    "dist/assets/data-sketches-A.js": sketch,
  };
  const tree = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [name, content] of Object.entries(members)) {
    const segments = name.split("/");
    const file = segments.pop();
    let folder = tree;
    for (const part of segments) folder = folder.files[part] ??= { files: {} };
    const bytes = Buffer.from(content);
    folder.files[file] = { offset: String(offset), size: bytes.length };
    chunks.push(bytes);
    offset += bytes.length;
  }
  const index = Buffer.from(JSON.stringify(tree));
  const header = Buffer.alloc(16 + Math.ceil(index.length / 4) * 4);
  [4, header.length - 8, header.length - 12, index.length].forEach((value, i) => header.writeUInt32LE(value, 4 * i));
  index.copy(header, 16);
  fs.mkdirSync(path.join(dir, "resources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "resources", "app.asar"), Buffer.concat([header, ...chunks]));
}

test("Steam import discovers a secondary library, verifies resources, and replaces the catalog as one file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-steam-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const steamapps = path.join(dir, "steamapps");
  const library = path.join(dir, "games library");
  const install = path.join(library, "steamapps", "common", "Rejected Draft");
  const dataPath = path.join(dir, "data", "catalog.json");
  fs.mkdirSync(steamapps);
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(steamapps, "libraryfolders.vdf"), `"1" { "path" ${JSON.stringify(library)} }`);
  fs.writeFileSync(path.join(library, "steamapps", "appmanifest_4574820.acf"), '"installdir" "Rejected Draft" "buildid" "1234"');
  writeTestArchive(install);
  const options = { roots: [dir], steamDir: null, dataPath };
  assert.equal(syncSteamCatalog({ ...options, check: true }).stale, true);
  assert.equal(fs.existsSync(dataPath), false);
  const first = syncSteamCatalog(options);
  assert.equal(first.metadata.buildId, "1234");
  assert.equal(first.metadata.gameVersion, "v0.99");
  assert.equal(first.metadata.saveVersion, 89);
  assert.equal(readGameBundle(dataPath).sketches.sample.stats.maxHp, 40);
  assert.deepEqual(readGameBundle(dataPath).shopUpgrades.upgrade_sample, {
    id: "upgrade_sample", statName: "attack", currency: "Wax", baseCost: 1e40, costMultiplier: 10,
    perLevel: 0.3, maxLevel: 25, requiredSkillId: "stats-hidden-upgrades", hidden: true,
  });
  assert.equal(syncSteamCatalog({ ...options, steamDir: install }).updated, false);
  assert.equal(syncSteamCatalog({ ...options, check: true }).stale, false);
  const original = fs.readFileSync(dataPath, "utf8");
  for (const [settings, error] of [
    [{ profile: "steam-demo" }, /full Steam/],
    [{ checksum: "incorrect" }, /differs from/],
    [{ shopEffect: "e=>e*e" }, /Unsupported Steam shop upgrade/],
    [{ stat: '"1e500"' }, /numeric value/],
    [{ stat: 0 }, /Incomplete/],
  ]) {
    writeTestArchive(install, settings);
    assert.throws(() => syncSteamCatalog(options), error);
    assert.equal(fs.readFileSync(dataPath, "utf8"), original);
  }
  assert.equal(syncSteamCatalog({ ...options, roots: [] }).offline, true);
  assert.throws(() => syncSteamCatalog({ ...options, roots: [], check: true }), /installation not found/);
});
