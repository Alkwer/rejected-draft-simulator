import { confidenceInterval95 } from "./combat/math.js";
import { STEAM_DECAY_IMMUNE_STATS } from "./combat/steam-universes.js";
import { createRedrawBoardSampler } from "./redraw-boards.js";
import { findRedrawFarmRoutes } from "./redraw-farm-routes.js";
import { createRng } from "./rng.js";
import { isFullSteamSave, normalizeStats, toNumber } from "./save.js";
import { STEAM_PLAYER_BASE_STATS, STEAM_PLAYER_STAT_GROUPS } from "./steam-economy-data.js";
import { steamStartingPlayerStats } from "./steam-stat-projection.js";
import { invalidCombatStats } from "../web/save-format.js";

const DISCOVERY_DRAWS = 2000;
const RARE_TARGET_DRAW_LIMIT = 40000;
const ODDS_DRAWS = 4000;
const EXCLUDED_MEDITATION = new Set(["maxHp", "attack", "attackSpeed", "minDamage", "maxDamage"]);
const DEFENSIVE_MEDITATION = new Set(["opacity", "absorb", "blockChance", "glancingBlow"]);
const OFFENSIVE_MEDITATION = new Set(["accuracy", "critChance", "woundChance", "counter"]);

function startingMeditation(state, stats) {
  const mv = state.multiverse;
  if (!mv?.currentUniverseArtistDefeated || mv.currentUniverseId === "mv-original" && state.gameMode !== "easy") return [];
  const fundamentals = state.fundamentals ?? {};
  const multiplier = 1 + (15 + toNumber(fundamentals.meditationGoldZoneBonus))
    * (1 + toNumber(mv.resolvedEffects?.meditationEffectMultiplier)) / 100;
  return stats.filter((stat) => {
    if (DEFENSIVE_MEDITATION.has(stat)) return toNumber(fundamentals.meditationDefenseUnlocked) > 0;
    if (OFFENSIVE_MEDITATION.has(stat)) return toNumber(fundamentals.meditationOffenseUnlocked) > 0;
    return !EXCLUDED_MEDITATION.has(stat) && !STEAM_DECAY_IMMUNE_STATS.has(stat);
  }).map((stat) => ({ stat, multiplier }));
}

export function nextRedrawStart(saved, fallbackStats) {
  // Whitelist persistent inputs. A scenario's projected removals, shop gains,
  // current eraser/booster targets, and exhausted victory caps end at prestige.
  const state = {
    saveProfile: saved.saveProfile, gameMode: saved.gameMode, fundamentals: saved.fundamentals,
    multiverse: saved.multiverse, glossaryUnlocks: saved.glossaryUnlocks, seppukuConfig: saved.seppukuConfig,
    skillLevels: saved.skillLevels, conceptVictoryBoostCounts: saved.conceptVictoryBoostCounts,
    currentUniverseConceptVictoryBoostCounts: saved.currentUniverseConceptVictoryBoostCounts,
    redrawCount: toNumber(saved.redrawCount) + 1, streamlinedSearchRetries: saved.streamlinedSearchRetries,
    sketchVictories: {}, sketchRunVictories: {}, activeMeditationBuffs: [],
  };
  if (!isFullSteamSave(saved)) {
    const stats = invalidCombatStats(saved.playerStats).length ? fallbackStats : saved.playerStats;
    return { state, stats: normalizeStats(stats), basis: "exported_stats" };
  }
  const keys = new Set([...Object.keys(STEAM_PLAYER_BASE_STATS), ...Object.values(STEAM_PLAYER_STAT_GROUPS).flat(),
    ...Object.keys(saved.battleStats ?? {})]);
  keys.delete("immunities");
  keys.delete("vulnerability");
  state.battleStats = Object.fromEntries([...keys].map((key) => [key, 0]));
  if (state.multiverse?.firstClearPerkIds?.includes("starting-speed")) state.battleStats.attackSpeed = -200;
  state.activeMeditationBuffs = startingMeditation(state, [...keys]);
  state.glossaryMultiplier = toNumber(saved.glossaryMultiplier, 1)
    * (state.multiverse?.currentUniverseId === "mv-hard-5" ? 0.99 : 1);
  state.playerStats = steamStartingPlayerStats(state);
  return { state, stats: state.playerStats, basis: "steam_redraw" };
}

function odds(hits, draws) {
  if (!draws) return null;
  const rate = hits / draws;
  return { hits, draws, rate, ci95: confidenceInterval95(rate, draws) };
}

export function planRedrawFarm({ sketches, state, baseStats, targetId, targetWinRate = 0.5, trials, maxSeconds, seed = "redraw-farm" }) {
  const summary = { targetId, targetName: sketches[targetId]?.name ?? targetId, goal: targetWinRate, plans: [] };
  const universe = state.multiverse?.currentUniverseId;
  if (universe === "mv-medium-5" && toNumber(state.redrawCount) - toNumber(state.streamlinedSearchRetries) >= 20) {
    return { ...summary, status: "redraw_limit" };
  }
  const sampler = createRedrawBoardSampler(sketches, state);
  if (!sampler) return { ...summary, status: "missing_draw_settings" };
  if (!sampler.canAppear(targetId)) return { ...summary, status: "outside_draw_pool" };
  const start = nextRedrawStart(state, baseStats);
  const discover = createRng(seed + ":board-search");
  const boards = [];
  for (let n = 0; n < DISCOVERY_DRAWS || (boards.length < 16 && n < RARE_TARGET_DRAW_LIMIT); n++) {
    const board = sampler.sample(discover);
    if (board.includes(targetId)) boards.push(board);
  }
  const search = findRedrawFarmRoutes({ sketches, state: start.state, baseStats: start.stats, targetId,
    targetWinRate, trials, maxSeconds, seed: seed + ":combat", boards });

  // Independent draws also measure the union without double-counting boards
  // that satisfy several alternative routes. All odds include the target.
  const verify = createRng(seed + ":board-odds");
  const hits = search.plans.map(() => 0);
  const minimumHits = search.plans.map(() => 0);
  let accepted = 0, anyHits = 0, targetHits = 0;
  for (let draw = 0; draw < ODDS_DRAWS; draw++) {
    const board = sampler.sample(verify);
    const meets = sampler.hasMinimums && sampler.meetsMinimums(board);
    if (meets) accepted++;
    if (!board.includes(targetId)) continue;
    targetHits++;
    let matched = false;
    for (const [i, plan] of search.plans.entries()) {
      if (!plan.requiredIds.every((id) => board.includes(id))) continue;
      hits[i]++;
      if (meets) minimumHits[i]++;
      matched = true;
    }
    if (matched) anyHits++;
  }
  const plans = search.plans.map((plan, i) => {
    const stages = [];
    for (const id of plan.routeIds) {
      if (stages.at(-1)?.id === id) stages.at(-1).wins++;
      else stages.push({ id, name: sketches[id].name ?? id, wins: 1 });
    }
    return { required: plan.requiredIds.map((id) => ({ id, name: sketches[id].name ?? id, alwaysDrawn: sampler.alwaysDrawn(id) })), stages,
      wins: plan.routeIds.length, targetWinRate: plan.targetWinRate, targetLower95: plan.targetWinRateLower95,
      minHelperWinRate: plan.minHelperWinRate, boardOdds: odds(hits[i], ODDS_DRAWS),
      minimumOdds: odds(minimumHits[i], accepted) };
  }).sort((a, b) => b.boardOdds.hits - a.boardOdds.hits || a.wins - b.wins || b.targetWinRate - a.targetWinRate);
  return { ...summary, plans, status: search.status, basis: start.basis, limited: search.truncated,
    skippedCulling: search.skippedCulling, skippedProjection: search.skippedRewardProjection,
    routesChecked: search.exploredRoutes, targetTrials: search.targetTrials, hasMinimums: sampler.hasMinimums,
    accepted, targetOdds: odds(targetHits, ODDS_DRAWS), anyPlanOdds: plans.length ? odds(anyHits, ODDS_DRAWS) : null };
}
