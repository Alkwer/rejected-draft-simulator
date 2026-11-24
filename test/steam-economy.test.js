import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEconomyPlan } from "../src/economy.js";
import { applySketchRewards } from "../src/rewards.js";
import { projectVictories, simulateRoute } from "../src/route.js";
import { STEAM_SHOP_CATALOG } from "../src/steam-shop-catalog.js";
import { createStrategyPlan } from "../src/strategy-planner.js";

test("Steam reward projections use actual attack gains after the Glossary multiplier", () => {
  const catalog = JSON.parse(readFileSync(new URL("../data/steam-catalog.json", import.meta.url), "utf8"));
  const id = "rorschach_bat";
  const sketches = { [id]: catalog.sketches[id] };
  const state = {
    saveProfile: "steam",
    glossaryMultiplier: 2,
    glossaryUnlocks: [id],
    battleStats: { attack: 2, attackSpeed: 0 },
    playerStats: { attack: 6, attackSpeed: 3000 },
  };
  const first = projectVictories({ state, baseStats: state.playerStats, sketches, ids: [id] });
  assert.equal(first.lastReward.statRewards.find(({ statName }) => statName === "attack").amount, 1.5);
  assert.equal(first.state.battleStats.attack, 2.75);
  assert.equal(first.stats.attack, 7.5);

  const second = projectVictories({ state: first.state, baseStats: first.stats, sketches, ids: [id] });
  const direct = applySketchRewards({ state, baseStats: state.playerStats, sketches, defeatedIds: [id, id] });
  assert.equal(second.stats.attack, 8.25);
  assert.deepEqual(second.stats, direct);
  assert.deepEqual(simulateRoute({ state, sketches, routeIds: [id, id] }).finalStats, direct);
  assert.equal(state.battleStats.attack, 2);
});

test("Steam projections handle a positive imported delay in place of a raw speed offset", () => {
  const state = { saveProfile: "steam", playerStats: { attackSpeed: 1000 }, battleStats: { attackSpeed: 1000 } };
  const sketches = { faster: { rewards: [{ statName: "attackSpeed", amount: -200 }] } };
  const first = projectVictories({ state, baseStats: state.playerStats, sketches, ids: ["faster"] });
  assert.equal(first.stats.attackSpeed, 800);
  const second = projectVictories({ state: first.state, baseStats: first.stats, sketches, ids: ["faster"] });
  assert.equal(second.stats.attackSpeed, 700);
});

test("Steam raw caps preserve hidden excess and floor detrimental rewards at the base stat", () => {
  const state = {
    saveProfile: "steam",
    glossaryMultiplier: 2,
    battleStats: { maxHp: 5, attackSpeed: -2600, dodge: 100 },
    playerStats: { maxHp: 30, attackSpeed: 500, dodge: 90 },
  };
  const sketches = {
    penalty: { rewards: [{ statName: "attackSpeed", amount: 75 }, { statName: "maxHp", amount: -50 }] },
    again: { rewards: [{ statName: "attackSpeed", amount: 75 }, { statName: "dodge", amount: -15 }] },
  };
  const first = projectVictories({ state, baseStats: state.playerStats, sketches, ids: ["penalty"] });
  assert.deepEqual(first.stats, { maxHp: 20, attackSpeed: 500, dodge: 90 });
  assert.equal(first.state.battleStats.attackSpeed, -2525);
  const second = projectVictories({ state: first.state, baseStats: first.stats, sketches, ids: ["again"] });
  assert.deepEqual(second.stats, { maxHp: 20, attackSpeed: 550, dodge: 85 });
});

test("Steam first clears add Glossary power once and project stat resets in applicable universes", () => {
  const state = {
    saveProfile: "steam",
    gameMode: "easy",
    multiverse: { currentUniverseId: "mv-medium-4", resolvedEffects: { glossaryRarityContributionBonus: 0.02 } },
    glossaryUnlocks: [],
    glossaryMultiplier: 1,
    battleStats: { maxHp: 0, attack: 9, dodge: 20 },
    playerStats: { maxHp: 10, attack: 10, dodge: 20 },
  };
  const sketches = { first: { rarity: "rough", immunities: ["dodge"], rewards: [] } };
  const first = projectVictories({ state, baseStats: state.playerStats, sketches, ids: ["first"] });
  assert.deepEqual(first.stats, { maxHp: 11, attack: 11, dodge: 0 });
  assert.deepEqual(first.state.glossaryUnlocks, ["first"]);
  const second = projectVictories({ state: first.state, baseStats: first.stats, sketches, ids: ["first"] });
  assert.deepEqual(second.stats, first.stats);
});

test("Steam flat and battle-income generators fund the route and both strategy forecasts", () => {
  const state = {
    saveProfile: "steam",
    playerStats: { maxHp: 10, attack: 1, attackSpeed: 3000 },
    graphiteGeneratorUnlocked: true,
    graphitePlusUnlocked: true,
    waxGeneratorUnlocked: false,
    photonGeneratorUnlocked: true,
    photonOverdriveUnlocked: true,
    currencyGeneratorRates: { Wax: 9999 },
    totalBattleEarnedCurrencies: { Graphite: 20000, Photon: 40000 },
    totalEarnedCurrencies: { Graphite: 1e12 },
    fundamentals: { generatorMultiplier: 2, graphiteGeneratorMultiplier: 3, timeAcceleration: 2 },
    multiverse: { resolvedEffects: { generatorMultiplier: 0.5 } },
  };
  const route = simulateRoute({ state, routeSeconds: 4 });
  assert.deepEqual(route.generatedCurrencies, { Graphite: 180, Photon: 120 });
  assert.equal(route.totalBattleEarnedCurrencies.Graphite, 20000);
  const strategy = createStrategyPlan({ state, farmSeconds: 4, softcapSeconds: 4, goalCurrencies: { Graphite: 180 } });
  assert.deepEqual(strategy.economy.generatorEV.currencies.Graphite, { baseRate: 2.5, multiplier: 18, perSecond: 45, windowExpected: 180 });
  assert.equal(strategy.economy.generatorEV.currencies.Wax, undefined);
  assert.equal(strategy.economy.currencyForecasts.find(({ currency }) => currency === "Graphite").secondsToGoal, 4);
  assert.equal(strategy.economy.softcapEV.waitCurrencies.Graphite.expected, 180);
});

test("Steam shop includes native definitions, precise cost discounts and unlock requirements", () => {
  const state = {
    saveProfile: "steam",
    battleStats: { attack: 9 },
    playerStats: { attack: 10 },
    waxDiscountUnlocked: true,
    fundamentals: { waxUpgradeCost: 50 },
    currencies: { Wax: 0.3, Graphite: 1e120 },
    skillLevels: { "stats-hidden-upgrades": 1 },
  };
  const buyUpgradeIds = ["upgrade_atk_wax", "upgrade_masterpiece_thorns_graphite"];
  const economy = createEconomyPlan({ state });
  const shop = economy.shopUpgrades;
  assert.equal(shop.length, 53);
  assert.equal(shop.find(({ id }) => id === "upgrade_atk_wax").cost, 0.2);
  assert.equal(shop.find(({ id }) => id === "upgrade_secret_energywave_spray").cost, 1e45);
  assert.equal(shop.find(({ id }) => id === "upgrade_masterpiece_thorns_graphite").requiredSkillId, "stats-masterpiece-hunter");
  const route = simulateRoute({ state, buyUpgrades: true, buyUpgradeIds });
  assert.equal(route.finalStats.attack, 10.8);
  assert.equal(route.currencies.Wax, 0.1);
  assert.deepEqual(route.shop.skipped, [{
    id: "upgrade_masterpiece_thorns_graphite", reason: "required_skill_locked", requiredSkillId: "stats-masterpiece-hunter",
  }]);
});

test("Steam catalog additive upgrades increase a previously zero effective stat", () => {
  const id = "upgrade_armor_example";
  const state = {
    saveProfile: "steam",
    [STEAM_SHOP_CATALOG]: { [id]: { id, statName: "armor", currency: "Graphite", baseCost: 1, costMultiplier: 3, perLevel: 1.5, additive: true } },
    battleStats: { armor: 0 },
    playerStats: { armor: 0 },
    currencies: { Graphite: 1 },
    fundamentals: { armorIncrease: 10 },
    multiverse: { resolvedEffects: { defenseStatMultiplier: 1 } },
  };
  const economy = createEconomyPlan({ state });
  assert.equal(economy.shopUpgrades[0].marginalStatGain, 3.3);
  const route = simulateRoute({ state, buyUpgrades: true, buyUpgradeIds: [id] });
  assert.equal(route.finalStats.armor, 3.3);
});

test("Steam route skips explicitly locked tools and strategy omits locked booster choices", () => {
  const state = {
    saveProfile: "steam",
    playerStats: { maxHp: 100, attack: 10, attackSpeed: 3000 },
    preciseEraserUnlocked: false,
    rewardBoosterUnlocked: false,
  };
  const sketches = { small: { id: "small", rarity: "scrap", rewards: [{ statName: "attack", amount: 1 }] } };
  const route = simulateRoute({ state, sketches, routeIds: ["small"], boostedIds: ["small"], erasedIds: ["small"] });
  assert.equal(route.finalStats.attack, 11);
  assert.deepEqual(route.tools.boostedSkipped, [{ id: "small", reason: "booster_locked" }]);
  assert.deepEqual(route.tools.erasedSkipped, [{ id: "small", reason: "eraser_locked" }]);
  const strategy = createStrategyPlan({ state, sketches, boosterCandidates: [{ ids: ["small"] }] });
  assert.deepEqual(strategy.boosters, { recommendation: null, choices: [] });
});
