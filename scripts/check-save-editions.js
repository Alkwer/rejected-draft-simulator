import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createWebServer } from "../src/web-server.js";
import { ANALYSIS_MODEL_VERSION } from "../src/model-version.js";

async function checkMoreTrials(browser, url) {
  const page = await browser.newPage();
  try {
    // The analysis seed comes from Date.now(). Keep this borderline encounter reproducible.
    await page.clock.setFixedTime(new Date(1760000000000));
    await page.goto(url);
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    await page.locator("#targetSelect").selectOption("duct_taped_banana");
    await page.locator("#trialsSelect").selectOption("500");
    await page.locator("#maxSecondsInput").fill("5");
    const save = { version: 86, meta: { profile: "steam" }, state: { availableSketches: ["little_stapler"],
      playerStats: { maxHp: 1, attack: 15000, attackSpeed: 500, minDamage: 100, maxDamage: 100, critChance: 50, critDmg: 200 } } };
    const first = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
    await page.locator("#saveFile").setInputFiles({ name: "borderline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(save)) });
    const { analysis } = await (await first).json();
    assert.equal(analysis.nextAction.targetId, "little_stapler");
    assert.equal(analysis.nextAction.trials, 100);
    await page.getByRole("tab", { name: "Battle", exact: true }).click();
    const button = page.getByRole("button", { name: "Run 500 trials", exact: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await button.isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
    const retried = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
    await button.press("Enter");
    const result = (await (await retried).json()).analysis;
    assert.equal(result.target.id, "little_stapler");
    assert.equal(result.result.trials, 500);
    assert.equal(result.activeSketches[0].trials, 500);
    await page.waitForFunction(() => document.querySelector("#winRateCi").textContent.includes("500 attempts"));
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const testDir = await mkdtemp(path.join(os.tmpdir(), "rd-browser-"));
const server = createWebServer({ updateDataOnImport: false, fightLogDir: path.join(testDir, "fights"), steamSaveDir: testDir });
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

  await page.getByRole("tab", { name: "Battle", exact: true }).press("Enter");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Battle panel overflows at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "Run", exact: true }).press("Enter");

  const { state } = JSON.parse(Buffer.from(saveText, "base64").toString());
  state.nextSoftcapAt = Date.now() + 60000;
  const steamFile = JSON.stringify({ meta: { profile: "steam" }, version: 86, state });
  const steamResponse = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
  await page.locator("#saveFile").setInputFiles({ name: "slot-1.json", mimeType: "application/json", buffer: Buffer.from(steamFile) });
  const steam = await (await steamResponse).json();
  assert.equal(steam.ok, true, steam.error);
  assert.equal(steam.analysis.bundle.platform, "steam");
  assert.ok(steam.analysis.strategicPlan.softcap.secondsToSoftcap > 0 && steam.analysis.strategicPlan.softcap.secondsToSoftcap <= 60);
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
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  const historyRow = page.locator(".history-item").filter({ hasText: "Steam" }).filter({ hasText: "trials 100 ·" }).last();
  const repeatResponse = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
  await historyRow.getByRole("button", { name: "Repeat analysis" }).click();
  const repeated = await (await repeatResponse).json();
  assert.deepEqual(repeated.analysis, steam.analysis);
  await page.waitForFunction(() => document.querySelector("#trialsSelect").value === "100");
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("rd-sim-history")));
  assert.ok(history.every((row) => row.replay.saveHash && row.replay.catalogHash && row.replay.modelVersion &&
    Number.isSafeInteger(row.replay.settings.referenceTimeMs) && !("saveText" in row.replay.settings)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Planner", exact: true }).click();
  assert.ok(await historyRow.getByRole("button", { name: "Repeat analysis" }).isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.setViewportSize({ width: 1440, height: 900 });
  const changedResponse = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
  await page.locator(".history-item").filter({ hasText: "Legacy web" }).getByRole("button", { name: "Repeat analysis" }).click();
  assert.equal((await changedResponse).status(), 409);
  await page.getByText("The save has changed.", { exact: false }).waitFor();
  await page.getByRole("tab", { name: "Run", exact: true }).click();
  await page.locator("#clearButton").press("Enter");
  assert.equal(await page.locator("#saveInput").inputValue(), "");
  assert.equal(await page.locator("#targetLabel").textContent(), "none");
  assert.equal(await page.locator("#winRateCi").textContent(), "CI --");
  assert.equal(await page.locator("#stripDecision").textContent(), "--");
  assert.equal(await page.locator("#fightTraceList").textContent(), "No trace");
  assert.equal(await page.locator("#fullCompareTable tr").count(), 0);

  const timingSave = { version: 86, meta: { profile: "steam", gameVersion: "qa-mismatch" },
    state: { availableSketches: ["little_stapler"], currencyGeneratorRates: { Graphite: 2 },
      playerStats: { maxHp: 1e20, attack: 0, attackSpeed: 1000 } } };
  await page.locator("#targetSelect").selectOption("little_stapler");
  await page.locator("#saveFile").setInputFiles({ name: "timing.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(timingSave)) });
  await page.getByRole("tab", { name: "Battle", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#fightTime").textContent.includes("p90 ≥5.0s"));
  await page.getByRole("tab", { name: "Diagnostics", exact: true }).click();
  await page.locator("#modelBuildStatus").getByText(/qa-mismatch/).waitFor();
  assert.match(await page.locator("#diagnosticSample").textContent(), /95% CI.*100 attempts/);
  assert.match(await page.locator("#assumptionSample").textContent(), /100 paired trials/);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Diagnostics overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "Strategy", exact: true }).click();
  await page.locator("#economyForecastList").getByText(/full route \(battle only\)/).waitFor();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const planner = page.getByRole("button", { name: "Planner", exact: true });
    if (await planner.isVisible()) await planner.click();
    assert.ok(await page.locator("#economyForecastList").isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Strategy overflows at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "Run", exact: true }).click();
  const hiddenResponse = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  assert.deepEqual((await (await hiddenResponse).json()).analysis.strategicPlan.runEV.sketches, []);
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  await page.getByRole("cell", { name: "No active farm target" }).waitFor();
  await page.goto(`http://127.0.0.1:${server.address().port}/steam-fights.html`);
  await page.locator("#logSource").selectOption("export");
  state.activeBattleSpeedupRemainingSeconds = 0.1;
  state.fundamentals = { ...state.fundamentals, timeAcceleration: 1, battleSpeedupRate: 2 };
  await page.locator("#logFile").setInputFiles({ name: "test-slot.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ meta: { profile: "steam" }, version: 999, state })) });
  await page.getByText("Forecast settings", { exact: true }).click();
  await page.locator("#logTrials").fill("1");
  await page.locator("#captureForm button[type=submit]").click();
  await page.getByText(/but save is version 999/).waitFor();
  const unreadableId = "0536c44b-f55c-4080-acac-70cee323d102";
  await mkdir(path.join(testDir, "fights", unreadableId));
  await page.reload();
  await page.locator("#unreadableFightIds").getByText(unreadableId).waitFor();
  await page.locator("#snapshotDetails summary").click();
  await page.locator("#snapshotStats").getByText("Simulator model", { exact: true }).waitFor();
  await page.locator("#snapshotStats").getByText(/2× for 0[.,]1 s, then 1×/).waitFor();
  await page.getByText(/but save is version 999/).waitFor();
  assert.equal(await page.locator("#fightPicker option").count(), 1);

  const fightId = await page.locator("#fightPicker").inputValue();
  const resultUrl = `/api/steam-fights/${fightId}/observation`;
  const outcome = page.locator("#resultOutcome");
  const elapsed = page.locator("#resultElapsed");
  const submitResult = page.locator("#recordResult");
  await outcome.selectOption("win");
  await elapsed.fill("5");
  const otherResult = await page.request.put(new URL(resultUrl, page.url()).href, {
    data: { revision: 0, outcome: "loss", elapsedSeconds: 3 },
  });
  assert.equal(otherResult.status(), 200);
  const conflict = page.waitForResponse((response) => response.url().endsWith(resultUrl));
  await submitResult.click();
  assert.equal((await conflict).status(), 409);
  await page.getByText(/Review it above, then submit again/).waitFor();
  assert.match(await page.locator("#actualOutcome").textContent(), /^Defeat/);
  assert.equal(await outcome.inputValue(), "win");
  assert.equal(await elapsed.inputValue(), "5");
  const retry = page.waitForResponse((response) => response.url().endsWith(resultUrl));
  await submitResult.click();
  const { fight: corrected } = await (await retry).json();
  assert.equal(corrected.forecast.modelVersion, ANALYSIS_MODEL_VERSION);
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.observation.outcome, "win");
  assert.equal(corrected.observation.elapsedSeconds, 5);
  await page.waitForFunction(() => document.querySelector("#actualOutcome").textContent.startsWith("Victory"));

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Archive overflows at ${width}px`);
  }
  assert.deepEqual(errors, []);
  await checkMoreTrials(browser, `http://127.0.0.1:${server.address().port}/`);
  console.log("Passed save imports, responsive layout, queued changes, history replay, censored times, diagnostics, hidden targets and Steam archive checks.");
} finally {
  await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(testDir, { recursive: true, force: true });
}
