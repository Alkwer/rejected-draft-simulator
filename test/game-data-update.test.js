import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  checkGameDataFreshness,
  extractGameVersion,
  extractSaveVersion,
  parseGamePageAssets,
  updateGameData,
} from "../src/game-data-update.js";
import { readGameBundle } from "../src/sketch-data.js";

const GAME_URL = "https://example.test/rejected_draft/";
const WEB_SKETCHES = fs.readFileSync(new URL("../data/artistLinks.js", import.meta.url), "utf8");

test("parseGamePageAssets detects main and artistLinks assets from game HTML", () => {
  const html = `
    <link rel="modulepreload" href="/rejected_draft/assets/artistLinks-TestHash.js">
    <script type="module" src="/rejected_draft/assets/main-TestHash.js"></script>
  `;

  assert.deepEqual(parseGamePageAssets(html), {
    artistAsset: "assets/artistLinks-TestHash.js",
    sketchAsset: null,
    mainAsset: "assets/main-TestHash.js",
    storeAsset: null,
  });
});

test("parseGamePageAssets detects split data-sketches assets from current game HTML", () => {
  const html = `
    <script type="module" crossorigin src="/rejected_draft/assets/main-CLD-lYso.js"></script>
    <link rel="modulepreload" crossorigin href="/rejected_draft/assets/data-sketches-DoX1aVCm.js">
  `;

  assert.deepEqual(parseGamePageAssets(html), {
    artistAsset: null,
    sketchAsset: "assets/data-sketches-DoX1aVCm.js",
    mainAsset: "assets/main-CLD-lYso.js",
    storeAsset: null,
  });
});

test("extractGameVersion and extractSaveVersion read current patch metadata from main bundle", () => {
  const mainJs = 'GAME_VERSION:"v1.0.0";const patch="v0.881";persist({version:52,skipHydration:false});';

  assert.equal(extractGameVersion(mainJs), "v0.881");
  assert.equal(extractSaveVersion(mainJs), 52);
});

test("updateGameData downloads assets and writes artistLinks plus metadata", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-update-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataPath = path.join(dir, "artistLinks.js");
  const responses = new Map([
    ["https://example.test/rejected_draft/", `
      <script type="module" src="/rejected_draft/assets/main-NewHash.js"></script>
    `],
    ["https://example.test/rejected_draft/assets/main-NewHash.js", `
      import "./artistLinks-NewHash.js";
      const patch = "v0.881";
      persist({version:53,skipHydration:false});
    `],
    ["https://example.test/rejected_draft/assets/artistLinks-NewHash.js", WEB_SKETCHES],
  ]);

  const result = await updateGameData({
    gameUrl: "https://example.test/rejected_draft/",
    dataPath,
    fetchImpl: createMockFetch(responses),
    now: () => new Date("2026-05-20T10:00:00Z"),
  });

  assert.equal(result.updated, true);
  assert.equal(result.metadata.gameVersion, "v0.881");
  assert.equal(result.metadata.saveVersion, 53);
  assert.equal(result.metadata.asset, "artistLinks-NewHash.js");
  assert.equal(fs.readFileSync(dataPath, "utf8"), WEB_SKETCHES);
  assert.ok(readGameBundle(dataPath).sketches.rose_window);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8")), result.metadata);

  const versions = JSON.parse(fs.readFileSync(path.join(dir, "game-versions.json"), "utf8"));
  assert.equal(versions.current, "v0.881");
  assert.equal(versions.versions["v0.881"].asset, "artistLinks-NewHash.js");
});

test("updateGameData downloads split data-sketches assets when artistLinks is absent", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-update-split-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataPath = path.join(dir, "artistLinks.js");
  const responses = new Map([
    ["https://example.test/rejected_draft/", `
      <script type="module" src="/rejected_draft/assets/main-SplitHash.js"></script>
      <link rel="modulepreload" href="/rejected_draft/assets/data-sketches-SplitHash.js">
      <link rel="modulepreload" href="/rejected_draft/assets/game-store-SplitHash.js">
    `],
    ["https://example.test/rejected_draft/assets/main-SplitHash.js", `
      import{a as sketches}from"./data-sketches-SplitHash.js";
      import"./game-store-SplitHash.js";
    `],
    ["https://example.test/rejected_draft/assets/game-store-SplitHash.js", "persist({version:54,skipHydration:false});"],
    ["https://example.test/rejected_draft/assets/data-sketches-SplitHash.js", WEB_SKETCHES],
  ]);

  const result = await updateGameData({
    gameUrl: "https://example.test/rejected_draft/",
    dataPath,
    fetchImpl: createMockFetch(responses),
    now: () => new Date("2026-05-22T10:00:00Z"),
  });

  assert.equal(result.updated, true);
  assert.equal(result.metadata.gameVersion, "main-SplitHash.js");
  assert.equal(result.metadata.saveVersion, 54);
  assert.equal(result.metadata.asset, "data-sketches-SplitHash.js");
  assert.equal(result.metadata.assetKind, "data-sketches");
  assert.equal(result.metadata.storeAsset, "game-store-SplitHash.js");
  assert.equal(fs.readFileSync(dataPath, "utf8"), WEB_SKETCHES);
});

function webImport(dataPath, sketches, main = 'persist({version:54,skipHydration:false});') {
  return {
    dataPath, gameUrl: GAME_URL, fetchImpl: createMockFetch(new Map([
      [GAME_URL, '<script src="assets/main-New.js"></script>'],
      [GAME_URL + "assets/main-New.js", `import "./data-sketches-New.js"; ${main}`],
      [GAME_URL + "assets/data-sketches-New.js", sketches],
    ])),
  };
}

function cacheWebCatalog(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-update-cache-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const metadata = { asset: "data-sketches-Cached.js", saveVersion: 52 };
  const original = {
    "artistLinks.js": WEB_SKETCHES,
    "metadata.json": JSON.stringify(metadata),
    "game-versions.json": JSON.stringify({ current: "main-Old.js", versions: { "main-Old.js": metadata } }),
  };
  for (const [file, contents] of Object.entries(original)) fs.writeFileSync(path.join(dir, file), contents);
  return {
    dir, metadata, dataPath: path.join(dir, "artistLinks.js"),
    checkUnchanged() {
      assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(original).sort());
      for (const [file, contents] of Object.entries(original)) {
        assert.equal(fs.readFileSync(path.join(dir, file), "utf8"), contents);
      }
    },
  };
}

test("invalid web downloads preserve the catalog, metadata and version history", async (t) => {
  const cache = cacheWebCatalog(t);
  const truncated = WEB_SKETCHES.slice(0, WEB_SKETCHES.lastIndexOf("],n="));
  const invalid = [
    [webImport(cache.dataPath, "export const sketches = [];"), /catalog.*missing/i],
    [webImport(cache.dataPath, WEB_SKETCHES.replace('id:"rose_window"', 'id:"placeholder"')), /missing.*rose_window/i],
    [webImport(cache.dataPath, WEB_SKETCHES.replace('id:"stick man"', "id:'stick man'")), /incomplete/i],
    [webImport(cache.dataPath, truncated), /bundle syntax/i],
    [webImport(cache.dataPath, WEB_SKETCHES, ""), /web save schema version/i],
  ];
  for (const [options, expected] of invalid) {
    const result = await updateGameData(options);
    assert.equal(result.updated, false);
    assert.equal(result.offline, true);
    assert.deepEqual(result.metadata, cache.metadata);
    assert.match(result.error, expected);
    cache.checkUnchanged();
    await assert.rejects(updateGameData({ ...options, offlineFallback: false }), expected);
    cache.checkUnchanged();
  }
});

test("a complete web bundle can remove a target", async (t) => {
  const cache = cacheWebCatalog(t);
  const previous = readGameBundle(cache.dataPath);
  const revised = WEB_SKETCHES.replace(/\{id:"stick man",name:"Stick Man",.*?\},(?=\{id:"fountain_pen_duelist")/, "");
  const result = await updateGameData(webImport(cache.dataPath, revised));
  assert.equal(result.updated, true);
  const { sketches } = readGameBundle(cache.dataPath);
  assert.equal(Object.keys(sketches).length, Object.keys(previous.sketches).length - 1);
  assert.equal(Object.hasOwn(sketches, "stick man"), false);
  assert.ok(sketches.rose_window);
});

test("web publication can retry after interruption between file replacements", async (t) => {
  const cache = cacheWebCatalog(t);
  const abandoned = fs.mkdtempSync(path.join(cache.dir, ".web-catalog-update-"));
  const revised = WEB_SKETCHES + "\n// New bundle";
  fs.renameSync(cache.dataPath, path.join(abandoned, "backup-0"));
  fs.writeFileSync(cache.dataPath, revised);
  fs.writeFileSync(path.join(abandoned, "next-1"), "{}");

  const retried = await updateGameData(webImport(cache.dataPath, revised));
  assert.equal(retried.updated, true);
  assert.deepEqual(readGameBundle(cache.dataPath).dataMetadata, retried.metadata);
  const history = JSON.parse(fs.readFileSync(path.join(cache.dir, "game-versions.json"), "utf8"));
  assert.equal(history.current, retried.metadata.gameVersion);
  assert.deepEqual(history.versions["main-Old.js"], cache.metadata);
  assert.equal(fs.readFileSync(path.join(abandoned, "backup-0"), "utf8"), WEB_SKETCHES);
});

test("a web publication failure restores both the previous source and metadata before retry", async (t) => {
  const cache = cacheWebCatalog(t);
  const renameSync = fs.renameSync;
  const failPublish = t.mock.method(fs, "renameSync", (from, to) => {
    if (path.basename(from) === "next-2") throw Object.assign(new Error("version file is busy"), { code: "EBUSY" });
    return renameSync(from, to);
  });
  const options = webImport(cache.dataPath, WEB_SKETCHES + "\n// New bundle");
  const result = await updateGameData(options);
  assert.equal(result.updated, false);
  assert.equal(result.offline, true);
  assert.match(result.error, /version file is busy/);
  cache.checkUnchanged();

  failPublish.mock.restore();
  const retried = await updateGameData(options);
  assert.equal(retried.updated, true);
  assert.equal(retried.metadata.asset, "data-sketches-New.js");
  assert.equal(fs.readFileSync(cache.dataPath, "utf8"), WEB_SKETCHES + "\n// New bundle");
  const history = JSON.parse(fs.readFileSync(path.join(cache.dir, "game-versions.json"), "utf8"));
  assert.equal(history.current, "main-New.js");
  assert.deepEqual(history.versions["main-Old.js"], cache.metadata);
});

test("checkGameDataFreshness warns when local asset differs from current page", async () => {
  const metadata = { asset: "artistLinks-OldHash.js", mainAsset: "main-OldHash.js" };
  const responses = new Map([
    ["https://example.test/rejected_draft/", `
      <link rel="modulepreload" href="/rejected_draft/assets/artistLinks-NewHash.js">
      <script type="module" src="/rejected_draft/assets/main-NewHash.js"></script>
    `],
  ]);

  const freshness = await checkGameDataFreshness({
    gameUrl: "https://example.test/rejected_draft/",
    localMetadata: metadata,
    fetchImpl: createMockFetch(responses),
  });

  assert.equal(freshness.stale, true);
  assert.deepEqual(freshness.warnings.map((warning) => warning.code), ["remote_asset_changed"]);
  assert.equal(freshness.remote.asset, "artistLinks-NewHash.js");
  assert.equal(freshness.remote.mainAsset, "main-NewHash.js");
});

test("updateGameData uses last local data when offline fallback is enabled", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-offline-"));
  const dataPath = path.join(dir, "artistLinks.js");
  fs.writeFileSync(dataPath, "cached artist data");
  fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ asset: "artistLinks-Cached.js" }));

  const result = await updateGameData({
    dataPath,
    gameUrl: "https://example.test/rejected_draft/",
    fetchImpl: async () => {
      throw new Error("network unavailable");
    },
    offlineFallback: true,
  });

  assert.equal(result.updated, false);
  assert.equal(result.offline, true);
  assert.equal(result.metadata.asset, "artistLinks-Cached.js");
  assert.equal(fs.readFileSync(dataPath, "utf8"), "cached artist data");
});

function createMockFetch(responses) {
  return async (url) => {
    const key = String(url);
    if (!responses.has(key)) throw new Error(`Unexpected fetch: ${key}`);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => responses.get(key),
    };
  };
}
