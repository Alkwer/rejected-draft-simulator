import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createWebServer } from "../src/web-server.js";
import { ANALYSIS_MODEL_VERSION } from "../src/model-version.js";
import { completedAnalysis } from "./browser-analysis.js";

async function checkFirstRunAndStorage(browser, url) {
  for (const mode of ["blocked", "quota"]) {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((storageMode) => {
        if (storageMode === "blocked") {
          Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
        } else {
          Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
          Storage.prototype.removeItem = () => { throw new DOMException("Blocked", "SecurityError"); };
        }
      }, mode);
      try {
        await page.goto(url);
        const steam = page.locator("#startSteamButton");
        const file = page.locator("#startFileButton");
        assert.ok(await steam.isVisible());
        assert.ok(await file.isVisible());
        const bounds = await file.boundingBox();
        assert.ok(bounds.y + bounds.height <= 900);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        const chooser = page.waitForEvent("filechooser");
        await file.click();
        const saveText = await readFile(new URL("../fixtures/synthetic-save.txt", import.meta.url));
        const response = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
        await (await chooser).setFiles({ name: "save.txt", mimeType: "text/plain", buffer: saveText });
        await completedAnalysis(response);
        await page.waitForFunction(() => !document.querySelector("#analyzeButton").disabled);
        assert.equal(await steam.isVisible(), false);
        if (width === 390) await page.getByRole("button", { name: "Run", exact: true }).click();
        else await page.getByRole("tab", { name: "Run", exact: true }).click();
        await page.locator("#densityModeSelect").selectOption("compact");
        assert.equal(await page.locator("body").getAttribute("data-density"), "compact");
        if (width === 390) await page.getByRole("button", { name: "Results", exact: true }).click();
        else await page.getByRole("tab", { name: "Compare", exact: true }).click();
        assert.ok(await page.locator("#historyList .history-item").count() > 0);
        await page.locator("#clearHistoryButton").evaluate((button) => button.click());
        assert.equal(await page.locator("#historyList").textContent(), "No history");
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  }
}

async function checkMobileImport(browser, server, url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let releaseCompletion;
  try {
    await page.goto(url);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Run", exact: true }).getAttribute("aria-pressed"), "true");
    await page.locator("#targetSelect").selectOption("little_stapler");
    await page.locator("#trialsSelect").selectOption("100");
    await page.locator("#maxSecondsInput").fill("5");
    const stats = { maxHp: 45000, attack: 1000, attackSpeed: 800, berserk: 0 };
    const steamExport = (ids) => JSON.stringify({ version: 86, meta: { profile: "steam" },
      state: { playerStats: stats, availableSketches: ids } });
    const response = () => page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
    const ready = () => page.waitForFunction(() => !document.querySelector("#analyzeButton").disabled);
    const simulate = page.getByRole("button", { name: "Run simulation", exact: true });
    const archive = page.getByRole("link", { name: /Steam fight log/ });
    assert.ok(await archive.isVisible());
    await page.locator("#saveInput").fill(steamExport(["little_stapler", "rorschach_bat"]));
    const first = response();
    await simulate.click();
    await completedAnalysis(first);
    await ready();
    const selected = response();
    await page.locator('[data-sketch-id="little_stapler"] .assume-one-button').click();
    assert.equal((await completedAnalysis(selected)).analysis.finalStats.berserk, 0.7);
    await ready();
    await page.getByRole("button", { name: "Results", exact: true }).click();
    assert.equal(await page.locator("#resultAssumptions").textContent(), "Forecast after 1 assumed victory.");
    assert.ok(await page.locator("#resultAssumptions").isVisible());
    await page.getByRole("button", { name: "Run", exact: true }).click();

    // Keep the real primary record flowing, but hold the final response until the UI displays it.
    const gate = new Promise((resolve) => { releaseCompletion = resolve; });
    server.prependOnceListener("request", (req, res) => {
      assert.equal(req.url, "/api/analyze");
      const end = res.end.bind(res);
      res.end = (...args) => { gate.then(() => end(...args)); return res; };
    });
    const second = response();
    await page.locator("#saveFile").setInputFiles({ name: "next-run.json", mimeType: "application/json",
      buffer: Buffer.from(steamExport(["rorschach_bat"])) });
    await page.getByRole("button", { name: "Results", exact: true }).click();
    await page.getByText(/Fight result ready/).waitFor();
    assert.ok(await page.locator("#winRateCi").isVisible());
    assert.match(await page.locator("#winRateCi").textContent(), /100 attempts/);
    assert.equal(await page.locator("#nextActionPanel").isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    releaseCompletion();
    const { analysis } = await completedAnalysis(second);
    assert.deepEqual(analysis.assumedVictories, {});
    assert.equal(analysis.finalStats.berserk, 0);
    await ready();
    assert.ok(await page.locator("#nextActionPanel").isVisible());
    await archive.click();
    await page.locator("#captureForm").waitFor();
  } finally {
    releaseCompletion?.();
    await page.close();
  }
}

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
    const { analysis } = await completedAnalysis(first);
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
    const result = (await completedAnalysis(retried)).analysis;
    assert.equal(result.target.id, "little_stapler");
    assert.equal(result.result.trials, 500);
    assert.equal(result.activeSketches[0].trials, 500);
    await page.waitForFunction(() => document.querySelector("#winRateCi").textContent.includes("500 attempts"));
  } finally {
    await page.close();
  }
}

async function checkSteamSlotSwitch(browser, url, dir) {
  const page = await browser.newPage();
  try {
    for (const slot of [1, 2]) {
      await writeFile(path.join(dir, `slot-${slot}.json`), JSON.stringify({ version: 87, meta: { profile: "steam", slot },
        state: { availableSketches: ["little_stapler", "rorschach_bat"],
          playerStats: { maxHp: 45000, attack: slot * 100, attackSpeed: 800, berserk: 0 } } }));
    }
    const marker = path.join(dir, "last-slot.txt");
    await writeFile(marker, "1");
    await page.goto(url);
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    await page.locator("#targetSelect").selectOption("little_stapler");
    await page.locator("#trialsSelect").selectOption("100");
    await page.locator("#maxSecondsInput").fill("5");
    async function analyze(button) {
      const response = page.waitForResponse((r) => r.url().endsWith("/api/analyze"));
      await button.click();
      const data = await completedAnalysis(response);
      await page.waitForFunction(() => !document.querySelector("#analyzeButton").disabled);
      return data;
    }
    await analyze(page.getByRole("button", { name: "Use active Steam slot" }));
    const assumed = page.locator('[data-sketch-id="little_stapler"] .assume-one-button');
    assert.equal((await analyze(assumed)).analysis.finalStats.berserk, 0.7);
    await writeFile(marker, "2");
    const switched = await analyze(page.locator("#analyzeButton"));
    assert.equal(switched.slotName, "slot-2.json");
    assert.equal(switched.analysis.finalStats.attack, 200);
    assert.equal(switched.analysis.finalStats.berserk, 0);
    assert.deepEqual(switched.analysis.assumedVictories, {});
    await page.getByText(/Switched to Steam slot-2.json/).waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("rd-sim-history"))[0].replay.settings.assumedVictories), {});
    assert.equal((await analyze(page.locator("#analyzeButton"))).analysis.finalStats.berserk, 0);
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const testDir = await mkdtemp(path.join(os.tmpdir(), "rd-browser-"));
const server = createWebServer({ updateDataOnImport: false, fightLogDir: path.join(testDir, "fights"), steamSaveDir: testDir });
try {
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  await checkFirstRunAndStorage(browser, `http://127.0.0.1:${server.address().port}/`);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/targets?edition=steam", (route) => route.abort("failed"), { times: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator("#messageBar").getByText(/Could not load the target catalog/).waitFor();
  await page.locator("#importBundleButton").click();
  await page.waitForFunction(() => document.querySelector("#targetSelect").options.length > 0);
  const battleTab = page.getByRole("tab", { name: "Battle", exact: true });
  await battleTab.press("ArrowRight");
  const runTab = page.getByRole("tab", { name: "Run", exact: true });
  assert.equal(await runTab.getAttribute("aria-selected"), "true");
  await runTab.press("End");
  await page.getByRole("tab", { name: "Compare", exact: true }).press("ArrowRight");
  assert.equal(await battleTab.evaluate((tab) => tab === document.activeElement && tab.tabIndex === 0), true);
  await battleTab.press("ArrowLeft");
  await page.getByRole("tab", { name: "Compare", exact: true }).press("Home");
  assert.equal(await battleTab.getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Run", exact: true }).press("Enter");
  const target = page.locator("#targetSelect");
  await page.evaluate(() => {
    const readText = File.prototype.text;
    File.prototype.text = function () {
      File.prototype.text = readText;
      return Promise.reject(new Error("Read failed."));
    };
  });
  await page.locator("#saveFile").setInputFiles({ name: "unavailable.txt", mimeType: "text/plain", buffer: Buffer.from("save") });
  await page.locator("#messageBar").getByText(/Could not read the save file/).waitFor();
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
  const web = await completedAnalysis(webResponse);
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
  const steam = await completedAnalysis(steamResponse);
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
  await page.locator("#targetFilterInput").fill("Duct");
  assert.equal(await target.inputValue(), "duct_taped_banana");
  assert.equal(await page.locator("#analyzeButton").isEnabled(), true);
  await page.locator("#targetFilterInput").fill("");
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
  const repeated = await completedAnalysis(repeatResponse);
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
  assert.deepEqual((await completedAnalysis(hiddenResponse)).analysis.strategicPlan.runEV.sketches, []);
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  await page.getByRole("cell", { name: "No active farm target" }).waitFor();
  await page.goto(`http://127.0.0.1:${server.address().port}/steam-fights.html`);
  await page.locator("#logSource").selectOption("export");
  state.activeBattleSpeedupRemainingSeconds = 0.1;
  state.fundamentals = { ...state.fundamentals, timeAcceleration: 1, battleSpeedupRate: 2 };
  await page.locator("#logFile").setInputFiles({ name: "test-slot.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ meta: { profile: "steam", gameVersion: "v0.9772" }, version: 999, state })) });
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
  for (const [id, message] of [[unreadableId, "The linked fight could not be read."], ["missing", "The linked fight is unavailable."]]) {
    await page.goto(new URL(`?fight=${id}`, page.url()).href);
    await page.getByText(message, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("fight"), id);
    assert.equal(await page.locator("#fightDetail").isVisible(), false);
    assert.equal(await page.locator("#fightPicker").inputValue(), "");
  }
  await page.locator("#fightPicker").selectOption(fightId);
  await page.locator("#fightDetail").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("fight"), fightId);
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
  await page.getByText("Compare recorded fights by setup").click();
  await page.locator("#comparisonGroups").getByRole("heading", { name: "Hyena Hulk · 1 fight" }).waitFor();
  assert.equal(await page.locator("#comparisonGroups tbody tr").first().locator("td").first().textContent(), "1");

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Archive overflows at ${width}px`);
  }
  assert.deepEqual(errors, []);
  await checkMobileImport(browser, server, `http://127.0.0.1:${server.address().port}/`);
  await checkMoreTrials(browser, `http://127.0.0.1:${server.address().port}/`);
  await checkSteamSlotSwitch(browser, `http://127.0.0.1:${server.address().port}/`, testDir);
  console.log("Passed save imports, responsive layout, queued changes, history replay, censored times, diagnostics, hidden targets and Steam archive checks.");
} finally {
  await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(testDir, { recursive: true, force: true });
}
