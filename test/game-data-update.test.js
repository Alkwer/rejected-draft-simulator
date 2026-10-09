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

test("updateGameData downloads assets and writes artistLinks plus metadata", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-update-"));
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
    ["https://example.test/rejected_draft/assets/artistLinks-NewHash.js", "export const sketches = [];"],
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
  assert.equal(fs.readFileSync(dataPath, "utf8"), "export const sketches = [];");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8")), result.metadata);

  const versions = JSON.parse(fs.readFileSync(path.join(dir, "game-versions.json"), "utf8"));
  assert.equal(versions.current, "v0.881");
  assert.equal(versions.versions["v0.881"].asset, "artistLinks-NewHash.js");
});

test("updateGameData downloads split data-sketches assets when artistLinks is absent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-update-split-"));
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
    ["https://example.test/rejected_draft/assets/data-sketches-SplitHash.js", "export const sketches = [];"],
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
  assert.equal(fs.readFileSync(dataPath, "utf8"), "export const sketches = [];");
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
