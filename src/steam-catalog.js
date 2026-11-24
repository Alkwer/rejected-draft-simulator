import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STEAM_APP_ID, findSteamInstall, withGameArchive } from "./steam-install.js";
import { parseSketches, readGameBundle } from "./sketch-data.js";
import { parseSteamShop } from "./steam-shop-catalog.js";

function assetName(files, prefix) {
  const matches = Object.keys(files).filter((name) => name.startsWith(`assets/${prefix}-`) && name.endsWith(".js"));
  if (matches.length !== 1) throw new Error(`Expected one ${prefix} asset in the Steam renderer manifest.`);
  return matches[0];
}

function saveVersionFromStore(source) {
  const key = source.match(/\bversion:([\w$]+),skipHydration:/)?.[1];
  if (!key) throw new Error("Could not identify the Steam save schema.");
  const value = /^\d+$/.test(key) ? key : source.match(new RegExp(`(?:^|[,; ])${key.replaceAll("$", "\\$")}=(\\d+)(?=[,;])`))?.[1];
  if (!value) throw new Error("Could not resolve the Steam save schema version.");
  return Number(value);
}

function readSteamCatalog(install, now) {
  return withGameArchive(install.dir, (read) => {
    const pkg = JSON.parse(read("package.json"));
    const manifest = JSON.parse(read("dist/steam-build-renderer.json"));
    if (pkg.name !== "rejected-draft" || manifest.profile !== "steam" || manifest.target !== "renderer") {
      throw new Error("Select the full Steam installation of Rejected Draft.");
    }
    const asset = assetName(manifest.files, "data-sketches");
    const store = assetName(manifest.files, "game-store");
    const skillTree = assetName(manifest.files, "data-skill-tree");
    function verifiedText(member) {
      const source = read(`dist/${member}`);
      if (createHash("sha256").update(source).digest("hex") !== manifest.files[member]) {
        throw new Error(`Steam asset differs from its renderer manifest: ${member}`);
      }
      return source;
    }
    const source = verifiedText(asset);
    const storeSource = verifiedText(store);
    const shopUpgrades = parseSteamShop(verifiedText(skillTree));
    const gameVersion = [...source.matchAll(/"(v\d+\.\d+(?:\.\d+)*)"/g)].map((match) => match[1])
      .find((v) => pkg.version === v.slice(1) || pkg.version === `${v.slice(1)}.0`) ?? `v${pkg.version}`;
    // The full Steam profile uses the base records. Web/demo overrides live in the same bundle.
    const profile = source.match(/steam:\{id:"steam"([\s\S]*?)(?=,"steam-demo":|,web:\{)/)?.[1];
    if (!profile || !profile.includes("sketchStatOverrides:{}") || !profile.includes("sketchRewardOverrides:{}")) {
      throw new Error("Unrecognized Steam sketch overrides. The previous catalog was preserved.");
    }
    const sketches = parseSketches(source, { strict: true });
    const ids = [...source.matchAll(/\{id:"([^"]+)",name:"/g)].map((m) => m[1]);
    if (!ids.length || ids.length !== Object.keys(sketches).length || ids.length !== (source.match(/,rewards:\[/g) ?? []).length ||
        ids.some((id) => !(sketches[id]?.stats.maxHp > 0 && sketches[id].stats.attackSpeed > 0))) {
      throw new Error("Incomplete Steam sketch catalog. The previous catalog was preserved.");
    }
    return {
      metadata: {
        platform: "steam", appId: STEAM_APP_ID, buildId: install.buildId, rendererBuildId: manifest.buildId,
        gameVersion, saveVersion: saveVersionFromStore(storeSource), asset: path.posix.basename(asset),
        mainAsset: path.posix.basename(assetName(manifest.files, "main")), storeAsset: path.posix.basename(store),
        shopAsset: path.posix.basename(skillTree),
        sourceUrl: `https://store.steampowered.com/app/${STEAM_APP_ID}/`, capturedAt: now().toISOString().slice(0, 10),
      },
      sketches, shopUpgrades,
    };
  });
}

export function syncSteamCatalog({ dataPath, steamDir, roots, check = false, offlineFallback = true, now = () => new Date() }) {
  if (path.extname(dataPath) !== ".json") throw new Error("The Steam catalog path must end in .json.");
  const install = findSteamInstall({ steamDir, roots });
  let cached;
  if (fs.existsSync(dataPath)) {
    try {
      cached = readGameBundle(dataPath);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const local = cached?.dataMetadata;
  if (!install) {
    const error = "Steam installation not found. Set REJECTED_DRAFT_STEAM_DIR or pass --steam-dir pointing to the game folder.";
    if (!check && offlineFallback && local?.platform === "steam" && Object.keys(cached.sketches ?? {}).length) {
      return { updated: false, offline: true, metadata: local, dataPath, error };
    }
    throw new Error(error);
  }
  const catalog = readSteamCatalog(install, now);
  const remote = catalog.metadata;
  const stale = local?.platform !== "steam" || local.rendererBuildId !== remote.rendererBuildId ||
    local.gameVersion !== remote.gameVersion || local.asset !== remote.asset || local.shopAsset !== remote.shopAsset ||
    local.saveVersion !== remote.saveVersion || (remote.buildId !== null && local.buildId !== remote.buildId) ||
    JSON.stringify(cached.sketches) !== JSON.stringify(catalog.sketches) ||
    JSON.stringify(cached.shopUpgrades) !== JSON.stringify(catalog.shopUpgrades);
  if (check) {
    const warnings = stale ? [{ code: "steam_build_changed", message: "The local catalog differs from the installed Steam build." }] : [];
    return { stale, warnings, remote };
  }
  if (stale) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    const tmp = `${dataPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(catalog, null, 2)}\n`);
      fs.renameSync(tmp, dataPath);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return { updated: stale, offline: false, metadata: stale ? remote : local, dataPath };
}
