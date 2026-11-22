import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncSteamCatalog } from "./steam-catalog.js";
import { parseSketches, readDataMetadata } from "./sketch-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

export const DEFAULT_GAME_URL = "https://kuzzigames.com/rejected_draft/";
export const LEGACY_DATA_PATH = path.join(PROJECT_ROOT, "data", "artistLinks.js");
export const DEFAULT_DATA_PATH = path.join(PROJECT_ROOT, "data", "steam-catalog.json");
const WEB_SANITY_TARGETS = ["duct_taped_banana", "rose_window", "mobius_strip"];

export async function updateGameData({
  gameUrl,
  steamDir,
  dataPath = gameUrl ? LEGACY_DATA_PATH : DEFAULT_DATA_PATH,
  fetchImpl = globalThis.fetch,
  offlineFallback = true,
  now = () => new Date(),
} = {}) {
  if (!gameUrl) return syncSteamCatalog({ dataPath, steamDir, offlineFallback, now });
  if (path.extname(dataPath) === ".json") throw new Error("Legacy web data needs a separate .js file.");
  try {
    const html = await fetchText(fetchImpl, gameUrl);
    let { artistAsset, sketchAsset, mainAsset, storeAsset } = parseGamePageAssets(html);
    if (!mainAsset) throw new Error("Could not find main-*.js asset in game HTML.");

    const mainAssetUrl = resolveAssetUrl(mainAsset, gameUrl);
    const mainSource = await fetchText(fetchImpl, mainAssetUrl);
    artistAsset ??= parseArtistAssetFromMain(mainSource);
    sketchAsset ??= parseSketchAssetFromMain(mainSource);
    storeAsset ??= parseStoreAssetFromMain(mainSource);
    const storeSource = storeAsset ? await fetchText(fetchImpl, resolveAssetUrl(storeAsset, gameUrl)) : "";
    const dataAsset = artistAsset ?? sketchAsset;
    if (!dataAsset) throw new Error("Could not find artistLinks-*.js or data-sketches-*.js asset in game HTML or main bundle.");

    const dataAssetUrl = resolveAssetUrl(dataAsset, gameUrl);
    const sketchSource = await fetchText(fetchImpl, dataAssetUrl);
    const metadata = {
      platform: "web",
      gameVersion: extractGameVersion(mainSource) ?? extractGameVersion(storeSource) ?? path.basename(mainAsset),
      saveVersion: extractSaveVersion(mainSource) ?? extractSaveVersion(storeSource),
      asset: path.basename(dataAsset),
      assetPath: dataAsset,
      assetUrl: dataAssetUrl,
      assetKind: artistAsset ? "artistLinks" : "data-sketches",
      mainAsset: path.basename(mainAsset),
      mainAssetPath: mainAsset,
      mainAssetUrl,
      storeAsset: storeAsset ? path.basename(storeAsset) : null,
      storeAssetPath: storeAsset,
      storeAssetUrl: storeAsset ? resolveAssetUrl(storeAsset, gameUrl) : null,
      sourceUrl: gameUrl,
      capturedAt: formatDate(now()),
    };

    publishWebCatalog({ dataPath, sketchSource, metadata });

    return {
      updated: true,
      offline: false,
      dataPath,
      metadata,
    };
  } catch (error) {
    if (!error.webCatalogRecoveryRequired && offlineFallback && fs.existsSync(dataPath)) {
      return {
        updated: false,
        offline: true,
        dataPath,
        metadata: readMetadataForDataPath(dataPath),
        error: error.message ?? String(error),
      };
    }
    throw error;
  }
}

export async function checkGameDataFreshness({
  gameUrl, steamDir,
  dataPath = gameUrl ? LEGACY_DATA_PATH : DEFAULT_DATA_PATH,
  localMetadata,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!gameUrl) return syncSteamCatalog({ dataPath, steamDir, check: true });
  localMetadata ??= readDataMetadata(dataPath);
  const html = await fetchText(fetchImpl, gameUrl);
  const assets = parseGamePageAssets(html);
  const remote = {
    asset: assets.artistAsset || assets.sketchAsset ? path.basename(assets.artistAsset ?? assets.sketchAsset) : null,
    mainAsset: assets.mainAsset ? path.basename(assets.mainAsset) : null,
  };
  const warnings = [];

  if (
    (remote.asset && localMetadata?.asset && remote.asset !== localMetadata.asset)
    || (remote.mainAsset && localMetadata?.mainAsset && remote.mainAsset !== localMetadata.mainAsset)
  ) {
    warnings.push({
      code: "remote_asset_changed",
      message: "Local sketch data points at older game assets than the current game page.",
      local: {
        asset: localMetadata?.asset ?? null,
        mainAsset: localMetadata?.mainAsset ?? null,
      },
      remote,
    });
  }

  return {
    stale: warnings.length > 0,
    warnings,
    remote,
  };
}

export function parseGamePageAssets(html) {
  return {
    artistAsset: findAsset(html, "artistLinks"),
    sketchAsset: findAsset(html, "data-sketches"),
    mainAsset: findAsset(html, "main"),
    storeAsset: findAsset(html, "game-store"),
  };
}

export function extractGameVersion(mainSource) {
  const matches = [...String(mainSource).matchAll(/v\d+\.\d+(?:\.\d+)?/g)].map((match) => match[0]);
  const gamePatch = matches.filter((version) => version.startsWith("v0."));
  return (gamePatch.at(-1) ?? matches.at(-1) ?? null);
}

export function extractSaveVersion(mainSource) {
  const matches = [...String(mainSource).matchAll(/version:(\d+),(?:skipHydration|onRehydrateStorage)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return matches.length > 0 ? Math.max(...matches) : null;
}

function findAsset(source, prefix) {
  const escaped = escapeRegExp(prefix);
  const re = new RegExp(`(?:["'(=]|^)([^"'()\\s]*assets/${escaped}-[^"'()\\s]+\\.js)`, "g");
  const match = re.exec(String(source));
  return match ? normalizeAssetPath(match[1]) : null;
}

function parseArtistAssetFromMain(mainSource) {
  return findAsset(mainSource, "artistLinks")
    ?? normalizeAssetPath(String(mainSource).match(/artistLinks-[^"'()\s]+\.js/)?.[0] ?? null);
}

function parseSketchAssetFromMain(mainSource) {
  return findAsset(mainSource, "data-sketches")
    ?? normalizeAssetPath(String(mainSource).match(/data-sketches-[^"'()\s]+\.js/)?.[0] ?? null);
}

function parseStoreAssetFromMain(mainSource) {
  return findAsset(mainSource, "game-store")
    ?? normalizeAssetPath(String(mainSource).match(/game-store-[^"'()\s]+\.js/)?.[0] ?? null);
}

function normalizeAssetPath(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  value = value.replace(/^https?:\/\/[^/]+\//, "");
  value = value.replace(/^\/+/, "");
  value = value.replace(/^\.\//, "");
  const assetIndex = value.indexOf("assets/");
  if (assetIndex >= 0) return value.slice(assetIndex);
  if (/^(artistLinks|data-sketches|game-store|main)-/.test(value)) return `assets/${value}`;
  return value;
}

function resolveAssetUrl(asset, gameUrl) {
  return new URL(asset, ensureTrailingSlash(gameUrl)).href;
}

async function fetchText(fetchImpl, url) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available.");
  const response = await fetchImpl(url);
  if (!response?.ok) {
    throw new Error(`Fetch failed for ${url}: ${response?.status ?? "unknown"} ${response?.statusText ?? ""}`.trim());
  }
  return response.text();
}

function publishWebCatalog({ dataPath, sketchSource, metadata }) {
  if (!Number.isSafeInteger(metadata.saveVersion) || metadata.saveVersion < 1) {
    throw new Error("Could not identify the web save schema version.");
  }
  let sketches;
  try {
    sketches = parseSketches(sketchSource, { strict: true });
  } catch (error) {
    throw new Error("Could not parse the web sketch catalog.", { cause: error });
  }
  const ids = [...sketchSource.matchAll(/\{id:"([^"]+)",name:"/g)].map((match) => match[1]);
  const declaredRecords = [...sketchSource.matchAll(/\brewards\s*:\s*\[/g)].length;
  const customChallenge = /\{id:[\w$]+,name:"Custom Challenge",/.test(sketchSource) ? 1 : 0;
  if (declaredRecords !== ids.length + customChallenge || ids.length !== Object.keys(sketches).length ||
      ids.some((id) => !Object.hasOwn(sketches, id) || !(sketches[id].stats.maxHp > 0 &&
        sketches[id].stats.attackSpeed > 0 && sketches[id].stats.attack >= 0))) {
    throw new Error("Incomplete web sketch catalog.");
  }

  const dir = path.dirname(dataPath);
  const historyPath = path.join(dir, "game-versions.json");
  const history = readJson(historyPath) ?? { current: null, versions: {} };
  history.versions ??= {};
  const key = metadata.gameVersion;
  const sanityTargets = history.versions[key]?.sanityTargets ?? WEB_SANITY_TARGETS;
  const missing = [...new Set([...WEB_SANITY_TARGETS, ...sanityTargets])]
    .filter((id) => !Object.hasOwn(sketches, id));
  if (missing.length) throw new Error(`Incomplete web sketch catalog. Missing: ${missing.join(", ")}.`);

  // A truncated bundle can contain intact records. Check that the whole module parses without executing it.
  const syntax = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: sketchSource, stdio: ["pipe", "ignore", "ignore"], windowsHide: true,
  });
  if (syntax.error) throw syntax.error;
  if (syntax.status !== 0) throw new Error("Invalid web sketch bundle syntax.");

  history.current = key;
  history.versions[key] = {
    saveVersion: metadata.saveVersion,
    capturedAt: metadata.capturedAt,
    asset: metadata.asset,
    mainAsset: metadata.mainAsset,
    sourceUrl: metadata.sourceUrl,
    sanityTargets,
  };
  fs.mkdirSync(dir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(dir, ".web-catalog-update-"));
  let recoveryRequired = false;
  try {
    replaceWebCatalogFiles(staging, [
      [dataPath, sketchSource],
      [metadataPathForDataPath(dataPath), `${JSON.stringify(metadata, null, 2)}\n`],
      [historyPath, `${JSON.stringify(history, null, 2)}\n`],
    ]);
  } catch (error) {
    recoveryRequired = error.webCatalogRecoveryRequired;
    throw error;
  } finally {
    if (!recoveryRequired) fs.rmSync(staging, { recursive: true, force: true });
  }
}

function replaceWebCatalogFiles(staging, files) {
  const prepared = files.map(([file, contents], index) => {
    const current = fs.lstatSync(file, { throwIfNoEntry: false });
    if (current && !current.isFile()) throw new Error(`Expected a regular catalog file at ${file}.`);
    const next = path.join(staging, `next-${index}`);
    const backup = current ? path.join(staging, `backup-${index}`) : null;
    if (backup) fs.copyFileSync(file, backup);
    fs.writeFileSync(next, contents);
    return { file, next, backup };
  });
  const published = [];
  try {
    for (const entry of prepared) {
      fs.renameSync(entry.next, entry.file);
      published.push(entry);
    }
  } catch (error) {
    const failures = [];
    for (const { file, backup } of published.reverse()) {
      try {
        if (backup) fs.renameSync(backup, file);
        else fs.unlinkSync(file);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) {
      throw Object.assign(new AggregateError([error, ...failures], `Web catalog rollback failed. Backups remain at ${staging}.`),
        { webCatalogRecoveryRequired: true });
    }
    throw error;
  }
}

function readMetadataForDataPath(dataPath) {
  return readJson(metadataPathForDataPath(dataPath));
}

function metadataPathForDataPath(dataPath) {
  return path.join(path.dirname(dataPath), "metadata.json");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatDate(now) {
  const date = typeof now === "function" ? now() : now;
  return new Date(date).toISOString().slice(0, 10);
}

function ensureTrailingSlash(value) {
  return String(value).endsWith("/") ? String(value) : `${value}/`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
