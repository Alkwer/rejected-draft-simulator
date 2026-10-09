import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

export const DEFAULT_GAME_URL = "https://kuzzigames.com/rejected_draft/";
export const DEFAULT_DATA_PATH = path.join(PROJECT_ROOT, "data", "artistLinks.js");

export async function updateGameData({
  gameUrl = DEFAULT_GAME_URL,
  dataPath = DEFAULT_DATA_PATH,
  fetchImpl = globalThis.fetch,
  offlineFallback = true,
  now = () => new Date(),
} = {}) {
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

    writeGameDataFiles({ dataPath, sketchSource, metadata });
    updateVersionHistory({ dataPath, metadata });

    return {
      updated: true,
      offline: false,
      dataPath,
      metadata,
    };
  } catch (error) {
    if (offlineFallback && fs.existsSync(dataPath)) {
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
  gameUrl = DEFAULT_GAME_URL,
  localMetadata = readMetadataForDataPath(DEFAULT_DATA_PATH),
  fetchImpl = globalThis.fetch,
} = {}) {
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

function writeGameDataFiles({ dataPath, sketchSource, metadata }) {
  const dir = path.dirname(dataPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataPath, sketchSource);
  fs.writeFileSync(metadataPathForDataPath(dataPath), `${JSON.stringify(metadata, null, 2)}\n`);
}

function updateVersionHistory({ dataPath, metadata }) {
  const filePath = path.join(path.dirname(dataPath), "game-versions.json");
  const history = readJson(filePath) ?? { current: null, versions: {} };
  const key = metadata.gameVersion ?? metadata.mainAsset ?? metadata.asset;
  history.current = key;
  history.versions ??= {};
  history.versions[key] = {
    saveVersion: metadata.saveVersion,
    capturedAt: metadata.capturedAt,
    asset: metadata.asset,
    mainAsset: metadata.mainAsset,
    sourceUrl: metadata.sourceUrl,
    sanityTargets: history.versions[key]?.sanityTargets ?? [
      "duct_taped_banana",
      "rose_window",
      "mobius_strip",
    ],
  };
  fs.writeFileSync(filePath, `${JSON.stringify(history, null, 2)}\n`);
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
