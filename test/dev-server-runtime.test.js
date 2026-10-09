import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { formatDevServerUrl, maybeOpenBrowser, parseDevServerArgs } from "../src/dev-server-runtime.js";

test("parseDevServerArgs enables browser opening with --open", () => {
  assert.deepEqual(parseDevServerArgs(["--open"]), { open: true });
  assert.deepEqual(parseDevServerArgs([]), { open: false });
});

test("formatDevServerUrl formats the local server address", () => {
  assert.equal(formatDevServerUrl({ host: "127.0.0.1", port: 5173 }), "http://127.0.0.1:5173");
});

test("maybeOpenBrowser only calls the opener when requested", async () => {
  const opened = [];
  const opener = async (url) => opened.push(url);

  assert.equal(await maybeOpenBrowser("http://127.0.0.1:5173", { open: false, opener }), false);
  assert.deepEqual(opened, []);

  assert.equal(await maybeOpenBrowser("http://127.0.0.1:5173", { open: true, opener }), true);
  assert.deepEqual(opened, ["http://127.0.0.1:5173"]);
});

test("Windows launcher starts the dev server with browser opening enabled", async () => {
  const launcher = await readFile(new URL("../Start Simulator.cmd", import.meta.url), "utf8");
  assert.match(launcher, /where node/);
  assert.match(launcher, /node "%~dp0src\\dev-server\.js" --open/);
  assert.match(launcher, /Starting Rejected Draft Simulator/);
  assert.doesNotMatch(launcher, /Nie znaleziono|Startuje|Serwer zostal|Kod bledu/i);
});
