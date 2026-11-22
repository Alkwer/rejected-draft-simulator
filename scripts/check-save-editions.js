import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createWebServer } from "../src/web-server.js";

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const server = createWebServer({ updateDataOnImport: false });
try {
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole("tab", { name: "Run", exact: true }).press("Enter");
  const target = page.locator("#targetSelect");
  await target.selectOption("little_stapler");
  await page.locator("#trialsSelect").selectOption("100");
  await page.locator("#maxSecondsInput").fill("5");
  await page.locator("#targetFilterInput").fill("Little Stapler");

  const saveText = (await readFile(new URL("../fixtures/synthetic-save.txt", import.meta.url), "utf8")).trim();
  await page.locator("#saveInput").fill(saveText);
  await page.waitForFunction(() => document.querySelector("#targetSelect").value === "duct_taped_banana");
  assert.equal(await target.locator('option[value="little_stapler"]').count(), 0);
  assert.equal(await page.locator("#targetFilterInput").inputValue(), "");
  const webResponse = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
  await page.locator("#analyzeButton").press("Enter");
  const web = await (await webResponse).json();
  assert.equal(web.ok, true, web.error);
  assert.equal(web.analysis.bundle.platform, "web");
  assert.equal(web.analysis.target.id, "duct_taped_banana");
  await page.waitForFunction(() => document.querySelector("#winRateCi").textContent.includes("95% CI"));
  const { lower, upper } = web.analysis.result.winRateCi95;
  const range = `${(100 * lower).toFixed(1)}%–${(100 * upper).toFixed(1)}%`;
  assert.ok((await page.locator("#winRateCi").textContent()).includes(range));

  const { state } = JSON.parse(Buffer.from(saveText, "base64").toString());
  const steamFile = JSON.stringify({ meta: { profile: "steam" }, version: 86, state });
  const steamResponse = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
  await page.locator("#saveFile").setInputFiles({ name: "slot-1.json", mimeType: "application/json", buffer: Buffer.from(steamFile) });
  const steam = await (await steamResponse).json();
  assert.equal(steam.ok, true, steam.error);
  assert.equal(steam.analysis.bundle.platform, "steam");
  assert.equal(await target.locator('option[value="little_stapler"]').count(), 1);
  await page.waitForFunction(() => !document.querySelector("#analyzeButton").disabled);

  const attempts = page.locator("#trialsSelect");
  const requests = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/analyze", async (route) => {
    requests.push(route.request().postDataJSON().trials);
    if (requests.length === 1) await gate;
    await route.continue();
  });
  const firstRequest = page.waitForRequest((r) => r.url().endsWith("/api/analyze"));
  await page.locator("#analyzeButton").press("Enter");
  await firstRequest;
  await attempts.selectOption("2000");
  await attempts.selectOption("500");
  release();
  await page.waitForFunction(() => document.querySelector("#winRateCi").textContent.includes("500 attempts"));
  assert.deepEqual(requests, ["100", "500"]);
  await page.locator("#clearButton").press("Enter");
  assert.equal(await page.locator("#saveInput").inputValue(), "");
  assert.equal(await page.locator("#targetLabel").textContent(), "none");
  assert.equal(await page.locator("#winRateCi").textContent(), "CI --");
  assert.equal(await page.locator("#stripDecision").textContent(), "--");
  assert.equal(await page.locator("#fightTraceList").textContent(), "No trace");
  assert.equal(await page.locator("#fullCompareTable tr").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Passed save imports, confidence interval, queued analysis changes and clearing results.");
} finally {
  await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
