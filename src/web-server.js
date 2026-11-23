import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCompanionFightFixture } from "./companion-fight-fixture.js";
import { createTargetOptions, summarizeGameBundle } from "./web-core.js";
import { createAnalysisRunner } from "./analysis-worker.js";
import { DEFAULT_DATA_PATH, LEGACY_DATA_PATH, updateGameData } from "./game-data-update.js";
import { readGameBundle } from "./sketch-data.js";
import { decodeSaveText, findActiveSteamSave, isSteamSave, readSaveFile } from "./save.js";
import { createSteamFightMonitor, handleSteamFightRequest } from "./steam-fight-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

export function createWebServer({
  publicDir = path.join(PROJECT_ROOT, "web"),
  gameUrl,
  dataPath = gameUrl ? LEGACY_DATA_PATH : DEFAULT_DATA_PATH,
  legacyDataPath = dataPath === DEFAULT_DATA_PATH ? LEGACY_DATA_PATH : dataPath,
  steamSaveDir,
  steamDir,
  fightLogDir = path.join(PROJECT_ROOT, ".local", "steam-fights"),
  watchSteamFightsOnStart = false,
  updateDataOnImport = true,
  updateGameDataImpl = updateGameData,
} = {}) {
  const monitor = createSteamFightMonitor({ root: fightLogDir, steamSaveDir });
  const analysisRunner = createAnalysisRunner();
  const forecastRunner = createAnalysisRunner();
  const pendingCaptures = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname.startsWith("/api/companion/") && req.method === "OPTIONS") {
        res.writeHead(204, companionCorsHeaders(req));
        res.end();
        return;
      }
      if (url.pathname === "/api/health") {
        return sendJson(res, { ok: true });
      }
      if (url.pathname === "/api/steam-fights" || url.pathname.startsWith("/api/steam-fights/")) {
        res.setHeader("cache-control", "no-store");
        if (!isLocalRequest(req)) return sendJson(res, { ok: false, error: "Open the Steam fight log on localhost." }, 403);
        monitor.start();
        const body = ["POST", "PUT"].includes(req.method) ? await readJsonBody(req) : {};
        const result = await handleSteamFightRequest({
          root: fightLogDir, dataPath, steamSaveDir, pathname: url.pathname, method: req.method, body,
          calculateForecast: forecastRunner.runSteamForecast, pendingCaptures, onCapture: monitor.captured,
        });
        if (result.download) {
          res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${result.filename}"` });
          res.end(result.download);
          return;
        }
        if (result.fight) {
          if (req.method === "POST") monitor.captured();
          if (result.fight.observation) monitor.recorded(result.fight.id);
          result.monitorStatus = monitor.status(result.fight.id);
        }
        return sendJson(res, { ok: true, ...result });
      }
      if (url.pathname === "/api/import-bundle" && req.method === "POST") {
        const update = updateDataOnImport
          ? await updateGameDataImpl({ dataPath, gameUrl, steamDir, offlineFallback: true })
          : { updated: false, offline: false };
        const { sketches, dataMetadata } = readGameBundle(dataPath);
        return sendJson(res, { ok: true, update, bundle: summarizeGameBundle({ sketches, dataMetadata }) });
      }
      if (url.pathname === "/api/targets") {
        const { sketches, dataMetadata } = readGameBundle(url.searchParams.get("edition") === "web" ? legacyDataPath : dataPath);
        return sendJson(res, {
          ok: true,
          bundle: summarizeGameBundle({ sketches, dataMetadata }),
          targets: createTargetOptions({ sketches }),
        });
      }
      if (url.pathname === "/api/analyze" && req.method === "POST") {
        const body = await readJsonBody(req);
        let save;
        let slotName;
        if (body.saveSource === "steam") {
          if (!isLocalRequest(req)) return sendJson(res, { ok: false, error: "Open the simulator on localhost to read a Steam slot." }, 403);
          const file = findActiveSteamSave(steamSaveDir);
          if (!file) return sendJson(res, { ok: false, error: "No Steam save slot found. Choose a save file or paste an export." }, 404);
          save = readSaveFile(file);
          slotName = path.basename(file);
        }
        if (!body.targetId) {
          return sendJson(res, { ok: false, error: "Missing targetId" }, 400);
        }
        save ??= decodeSaveText(body.saveText);
        const analysis = await analysisRunner.run(isSteamSave(save) ? dataPath : legacyDataPath, {
          identifyInputs: true,
          expectedSaveHash: body.expectedSaveHash,
          expectedCatalogHash: body.expectedCatalogHash,
          save,
          targetId: body.targetId,
          assumedVictoryIds: body.assumedVictoryIds,
          assumedVictories: body.assumedVictories,
          trials: body.trials ?? "auto",
          maxSeconds: body.maxSeconds ?? 300,
          seed: body.seed ?? "web-ui",
          referenceTimeMs: body.referenceTimeMs,
          strategyOptions: body.strategyOptions,
          routeIds: body.routeIds,
          hiddenSketchIds: body.hiddenSketchIds,
          observedOutcome: body.observedOutcome,
          traceSeconds: body.traceSeconds,
        });
        return sendJson(res, { ok: true, analysis, slotName });
      }
      if (url.pathname === "/api/companion/analyze" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.saveText) {
          return sendJson(res, { ok: false, error: "Missing saveText" }, 400, companionCorsHeaders(req));
        }
        const companion = await analysisRunner.run(legacyDataPath, {
          saveText: body.saveText,
          targetId: body.targetId,
          trials: body.trials ?? 100,
          maxSeconds: body.maxSeconds ?? 120,
          seed: body.seed ?? "game-companion",
        }, true);
        return sendJson(res, { ok: true, companion }, 200, companionCorsHeaders(req));
      }
      if (url.pathname === "/api/companion/fight-fixture" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.saveText) {
          return sendJson(res, { ok: false, error: "Missing saveText" }, 400, companionCorsHeaders(req));
        }
        const { sketches, dataMetadata } = readGameBundle(legacyDataPath);
        const fixtureCapture = createCompanionFightFixture({
          saveText: body.saveText,
          sketches,
          dataMetadata,
          targetId: body.targetId,
          observed: body.observed,
          browserSnapshot: body.browserSnapshot,
          seed: body.seed ?? "companion-fixture",
          maxSeconds: body.maxSeconds ?? 300,
          traceSeconds: body.traceSeconds ?? 60,
        });
        return sendJson(res, { ok: true, fixtureCapture }, 200, companionCorsHeaders(req));
      }

      return serveStatic({ req, res, publicDir, url });
    } catch (error) {
      return sendJson(res, {
        ok: false,
        error: error.message ?? String(error),
      }, error.status ?? 500, url.pathname.startsWith("/api/companion/") ? companionCorsHeaders(req) : {});
    }
  });
  if (watchSteamFightsOnStart) server.once("listening", () => monitor.start());
  server.once("close", () => monitor.stop());
  server.once("close", () => analysisRunner.close());
  server.once("close", () => forecastRunner.close());
  return server;
}

const COMPANION_ALLOWED_ORIGINS = new Set([
  "https://kuzzigames.com",
  "https://www.kuzzigames.com",
]);

function isLocalRequest(req) {
  const host = req.headers.host ?? "";
  const loopback = ["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  return loopback && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) &&
    (!req.headers.origin || req.headers.origin === `http://${host}`);
}

function serveStatic({ res, publicDir, url }) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const targetPath = path.resolve(publicDir, `.${pathname}`);
  const root = path.resolve(publicDir);
  if (!targetPath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": mimeType(targetPath) });
  fs.createReadStream(targetPath).pipe(res);
}

function companionCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!COMPANION_ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function sendJson(res, payload, status = 200, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON request."), { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Expected a JSON object."), { status: 400 });
  }
  return body;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
  }[ext] ?? "application/octet-stream";
}
