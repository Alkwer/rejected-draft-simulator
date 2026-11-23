import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createWebServer } from "../src/web-server.js";

const scenarios = [
  {
    name: "Steam active run", target: "hyena_hulk", maxSeconds: 30,
    active: ["hyena_hulk", "franklyn", "rorschach_bat", "little_stapler"],
    stats: { maxHp: 3e8, attack: 5e8, attackSpeed: 750, accuracy: 95 },
  },
  {
    name: "Long Steam status fight", target: "little_stapler", maxSeconds: 90,
    active: ["little_stapler", "rorschach_bat", "stick man"],
    stats: { maxHp: 1e10, attack: 260, attackSpeed: 750, accuracy: 100,
      burnChance: 100, burnDamage: 1, slowChance: 50, remedy: 2, regen: 15 },
  },
];

async function measure(page, url, scenario) {
  // UI-generated seeds and softcap reference times depend on Date.now().
  await page.addInitScript(() => { Date.now = () => Date.UTC(2026, 5, 1, 12); });
  await page.goto(url);
  await page.getByRole("tab", { name: "Run", exact: true }).click();
  await page.locator("#targetSelect").selectOption(scenario.target);
  await page.locator("#trialsSelect").selectOption("100");
  await page.locator("#maxSecondsInput").fill(String(scenario.maxSeconds));
  await page.locator("#saveInput").fill(JSON.stringify({
    version: 86, meta: { profile: "steam" },
    state: { playerStats: scenario.stats, availableSketches: scenario.active },
  }));
  await page.getByRole("tab", { name: "Battle", exact: true }).click();
  const samples = [];
  let baseline;
  let gameBuild;
  for (let sample = 0; sample < 4; sample++) {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/analyze"), { timeout: 180000 });
    await page.evaluate(() => {
      performance.clearMeasures("dashboard");
      const button = document.querySelector("#analyzeButton");
      button.addEventListener("click", () => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (button.disabled) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => performance.measure("dashboard", { start })));
        });
        observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
      }, { once: true, capture: true });
    });
    await page.locator("#analyzeButton").click();
    const data = await (await response).json();
    assert.equal(data.ok, true, data.error);
    const elapsed = await (await page.waitForFunction(() => performance.getEntriesByName("dashboard", "measure")[0]?.duration)).jsonValue();
    const analysis = data.analysis;
    assert.equal(analysis.bundle.platform, "steam");
    assert.equal(analysis.target.id, scenario.target);
    assert.ok(analysis.targetComparisons.length && analysis.strategicPlan && analysis.rollWishlist);
    assert.match(await page.locator("#winRateCi").textContent(), /100 attempts/);
    if (sample === 0) {
      baseline = analysis.result;
      gameBuild = analysis.bundle.buildId;
    } else {
      assert.deepEqual(analysis.result, baseline);
      samples.push(Math.round(elapsed));
    }
  }
  return { scenario: scenario.name, gameBuild, trials: baseline.trials,
    fightMedianSeconds: baseline.medianSeconds, medianCensored: baseline.medianCensored,
    samplesMs: samples, medianDashboardMs: [...samples].sort((a, b) => a - b)[1] };
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const server = createWebServer({ updateDataOnImport: false });
try {
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    try {
      const result = await measure(page, url, scenario);
      console.log(JSON.stringify(result));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
