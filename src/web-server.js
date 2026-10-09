import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCompanionFightFixture } from "./companion-fight-fixture.js";
import { createCompanionAnalysis, createTargetOptions, createWebAnalysis, summarizeGameBundle } from "./web-core.js";
import { updateGameData } from "./game-data-update.js";
import { readDataMetadata, readSketchData } from "./sketch-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

export function createWebServer({
  publicDir = path.join(PROJECT_ROOT, "web"),
  dataPath = path.join(PROJECT_ROOT, "data", "artistLinks.js"),
  gameUrl,
  updateDataOnImport = true,
  updateGameDataImpl = updateGameData,
} = {}) {
  return http.createServer(async (req, res) => {
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
      if (url.pathname === "/api/import-bundle" && req.method === "POST") {
        const update = updateDataOnImport
          ? await updateGameDataImpl({ dataPath, gameUrl, offlineFallback: true })
          : { updated: false, offline: false };
        const { sketches, dataMetadata } = readBundle(dataPath);
        return sendJson(res, { ok: true, update, bundle: summarizeGameBundle({ sketches, dataMetadata }) });
      }
      if (url.pathname === "/api/targets") {
        const { sketches, dataMetadata } = readBundle(dataPath);
        return sendJson(res, {
          ok: true,
          bundle: summarizeGameBundle({ sketches, dataMetadata }),
          targets: createTargetOptions({ sketches }),
        });
      }
      if (url.pathname === "/api/analyze" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.targetId) {
          return sendJson(res, { ok: false, error: "Missing targetId" }, 400);
        }
        const { sketches, dataMetadata } = readBundle(dataPath);
        const analysis = createWebAnalysis({
          saveText: body.saveText,
          sketches,
          dataMetadata,
          targetId: body.targetId,
          assumedVictoryIds: body.assumedVictoryIds,
          assumedVictories: body.assumedVictories,
          trials: body.trials ?? "auto",
          maxSeconds: body.maxSeconds ?? 300,
          seed: body.seed ?? "web-ui",
          strategyOptions: body.strategyOptions,
          routeIds: body.routeIds,
          observedOutcome: body.observedOutcome,
          traceSeconds: body.traceSeconds,
        });
        return sendJson(res, { ok: true, analysis });
      }
      if (url.pathname === "/api/companion/analyze" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.saveText) {
          return sendJson(res, { ok: false, error: "Missing saveText" }, 400, companionCorsHeaders(req));
        }
        const { sketches, dataMetadata } = readBundle(dataPath);
        const companion = createCompanionAnalysis({
          saveText: body.saveText,
          sketches,
          dataMetadata,
          targetId: body.targetId,
          trials: body.trials ?? 100,
          maxSeconds: body.maxSeconds ?? 120,
          seed: body.seed ?? "game-companion",
        });
        return sendJson(res, { ok: true, companion }, 200, companionCorsHeaders(req));
      }
      if (url.pathname === "/api/companion/fight-fixture" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.saveText) {
          return sendJson(res, { ok: false, error: "Missing saveText" }, 400, companionCorsHeaders(req));
        }
        const { sketches, dataMetadata } = readBundle(dataPath);
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
      }, 500, url.pathname.startsWith("/api/companion/") ? companionCorsHeaders(req) : {});
    }
  });
}

const COMPANION_ALLOWED_ORIGINS = new Set([
  "https://kuzzigames.com",
  "https://www.kuzzigames.com",
]);

function readBundle(dataPath) {
  return {
    sketches: readSketchData(dataPath),
    dataMetadata: readDataMetadata(dataPath),
  };
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
  return text ? JSON.parse(text) : {};
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
