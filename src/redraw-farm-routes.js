import { combatAssumptionsFromSave } from "./combat-assumptions.js";
import { enemyFromSketch } from "./combat/steam-encounter.js";
import { runMonteCarlo } from "./combat.js";
import { projectVictories } from "./route.js";
import { isFullSteamSave, toNumber } from "./save.js";
import { RewardProjectionError } from "./steam-stat-projection.js";
import { getSketchFightEligibility } from "./tool-rules.js";
import { remainingSketchVictories } from "./victory-limit.js";

const MIN_HELPER_WIN_RATE = 0.5;
const SCREEN_TRIALS = 6;
const HELPER_CHECK_TRIALS = 16;
const MAX_COMBAT_TRIALS = 8000;
const MAX_STARTING_HELPERS = 16;
const MAX_UNLOCKABLE_HELPERS = 12;
const MAX_PLANS = 6;
const MAX_ROUNDS = 6;
const MAX_WINS = 256;
const BEAM_WIDTH = 6;
const REPEAT_MILESTONES = new Set([2, 4, 8, 16, 32, 64, 128, MAX_WINS]);
const RARITIES = ["scrap", "rough", "framed", "opus", "masterpiece"];

// State and baseStats describe the start of the next redraw, before any fights.
// Each board is one complete sampled draw under a setting the player can use.
export function findRedrawFarmRoutes({
  sketches = {}, state = {}, baseStats = {}, targetId, targetWinRate = 0.5,
  trials = 128, maxSeconds = 300, seed = "redraw-farm",
  assumptions = combatAssumptionsFromSave(state), boards = [],
} = {}) {
  const goal = Math.max(0, Math.min(1, toNumber(targetWinRate, 0.5)));
  const trialsForPerfectSample = goal < 1 ? Math.ceil(3.8416 * goal / (1 - goal)) : Infinity;
  const targetTrials = Math.min(512, Math.max(64, Math.floor(toNumber(trials, 128)), trialsForPerfectSample));
  const target = sketches[targetId];
  const boardSamples = boards.filter((board) => board.includes(targetId));
  const result = {
    status: "not_found", plans: [], targetId, requestedTargetWinRate: goal, targetTrials,
    minRequiredHelperWinRate: MIN_HELPER_WIN_RATE, targetBoardHits: boardSamples.length,
    candidateCount: 0, exploredRoutes: 0, combatTrials: 0, skippedCulling: false,
    skippedRewardProjection: false, truncated: false,
  };
  if (!target?.stats || remainingSketchVictories(state, targetId) <= 0
      || new Set(state.multiverse?.retiredSketchIds).has(targetId)) {
    result.status = "target_unavailable";
    return result;
  }
  if (!boardSamples.length) {
    result.status = "target_not_sampled";
    return result;
  }
  const initialState = { ...state, availableSketches: boardSamples[0] };
  if (!getSketchFightEligibility(target, initialState).eligible) {
    result.status = "target_unavailable";
    return result;
  }

  const steam = isFullSteamSave(state);
  const universe = state.multiverse?.currentUniverseId;
  const enemies = new Map([[targetId, enemyFromSketch(target)]]);
  const forecasts = new WeakMap();
  const plans = new Map();
  const considered = new Map();
  const transitions = new Map();
  const root = { state: initialState, stats: baseStats, steps: [], helperIds: [], boards: boardSamples, score: 0, key: "" };
  const freshGlossary = steam && universe !== "mv-easy-2" && Array.isArray(state.glossaryUnlocks)
    ? new Set(state.glossaryUnlocks) : null;
  const canResetStats = steam && ["mv-hard-2", "mv-medium-4"].includes(universe);

  function forecast(stats, id, count, phase) {
    let cached = forecasts.get(stats);
    if (!cached) {
      cached = new Map();
      forecasts.set(stats, cached);
    }
    const key = `${id}:${phase}`;
    if (cached.has(key)) return cached.get(key);
    if (result.combatTrials + count > MAX_COMBAT_TRIALS) {
      result.truncated = true;
      return null;
    }
    const outcome = runMonteCarlo({
      player: stats, enemy: enemies.get(id), assumptions, maxSeconds, trials: count,
      seed: `${seed}:${id}:${phase}`,
    });
    result.combatTrials += count;
    cached.set(key, outcome);
    return outcome;
  }

  function addPlan(node) {
    const candidate = forecast(node.stats, targetId, SCREEN_TRIALS, "screen");
    if (!candidate || candidate.winRateCi95.upper < goal) return false;
    const key = JSON.stringify([...node.helperIds].sort());
    const existing = plans.get(key);
    if (existing && existing.routeIds.length <= node.steps.length) return true;
    let confirmation = forecast(node.stats, targetId, targetTrials, "confirm");
    if (!confirmation || !meetsGoal(confirmation, goal)) return false;

    // Milestones keep long farms affordable to search. Check earlier wins in
    // the last stretch so the advice can stop between two powers of two.
    let wins = node.steps.length;
    let low = node.steps.findLastIndex(({ id }) => id !== node.steps.at(-1).id) + 2;
    while (low < wins && MAX_COMBAT_TRIALS - result.combatTrials >= targetTrials + wins * HELPER_CHECK_TRIALS) {
      const mid = Math.floor((low + wins) / 2);
      const earlier = forecast(node.steps[mid].before, targetId, targetTrials, "confirm");
      if (!earlier) break;
      if (meetsGoal(earlier, goal)) {
        confirmation = earlier;
        wins = mid;
      } else low = mid + 1;
    }
    const steps = node.steps.slice(0, wins);
    let minHelperWinRate = null;
    for (const { before, id } of steps) {
      const helper = forecast(before, id, HELPER_CHECK_TRIALS, "confirm");
      if (!helper || !meetsGoal(helper, MIN_HELPER_WIN_RATE)) return false;
      minHelperWinRate = Math.min(minHelperWinRate ?? 1, helper.winRate);
    }
    plans.set(key, {
      requiredIds: [targetId, ...node.helperIds],
      routeIds: steps.map(({ id }) => id),
      targetWinRate: confirmation.winRate,
      targetWinRateLower95: confirmation.winRateCi95.lower,
      minHelperWinRate,
      sampledBoardHits: node.boards.length,
    });
    return true;
  }

  if (addPlan(root)) {
    result.status = "found";
    result.plans = [...plans.values()];
    return result;
  }
  if (trialsForPerfectSample > targetTrials) {
    result.truncated = true;
    return result;
  }
  const retired = new Set(state.multiverse?.retiredSketchIds);
  const byHelper = new Map();
  for (const board of boardSamples) {
    for (const id of new Set(board)) {
      const sketch = sketches[id];
      if (id === targetId || !sketch?.stats || retired.has(id) || remainingSketchVictories(state, id) <= 0) continue;
      if (!byHelper.has(id)) byHelper.set(id, new Set());
      byHelper.get(id).add(board);
    }
  }
  const candidates = [...byHelper].flatMap(([id, samples]) => {
    const sketch = sketches[id];
    const rewards = sketch.rewards ?? [];
    const newGlossaryEntry = freshGlossary && !freshGlossary.has(id);
    const affectsStats = rewards.some(({ amount }) => toNumber(amount) !== 0) || newGlossaryEntry || canResetStats;
    if (!affectsStats) return [];
    const score = rewards.reduce((sum, { statName, amount }) =>
      sum + statImprovement(statName, toNumber(amount), baseStats), newGlossaryEntry ? 0.2 : 0);
    return [{ id, score, samples }];
  }).sort((a, b) => b.score - a.score || b.samples.size - a.samples.size || a.id.localeCompare(b.id));
  result.candidateCount = candidates.length;
  for (const { id } of candidates) enemies.set(id, enemyFromSketch(sketches[id]));
  const startingHelpers = [];
  const unlockableHelpers = [];
  for (const candidate of candidates) {
    const probe = forecast(baseStats, candidate.id, 2, "probe");
    if (probe?.wins && startingHelpers.length < MAX_STARTING_HELPERS) startingHelpers.push(candidate);
    else if (unlockableHelpers.length < MAX_UNLOCKABLE_HELPERS) unlockableHelpers.push(candidate);
    if (startingHelpers.length >= MAX_STARTING_HELPERS && unlockableHelpers.length >= MAX_UNLOCKABLE_HELPERS) break;
  }
  const helpers = [...startingHelpers, ...unlockableHelpers];
  if (helpers.length < candidates.length) result.truncated = true;

  function advance(node, helper) {
    const key = `${node.key}${JSON.stringify(helper.id)}`;
    if (!transitions.has(key)) transitions.set(key, projectStep(node, helper, key));
    return transitions.get(key);
  }

  function projectStep(node, helper, key) {
    const { id, samples } = helper;
    const repeated = node.helperIds.includes(id);
    const availableBoards = repeated ? node.boards : node.boards.filter((board) => samples.has(board));
    if (!availableBoards.length) return null;
    const currentState = { ...node.state, availableSketches: availableBoards[0] };
    if (!getSketchFightEligibility(sketches[id], currentState).eligible) return null;
    // Medium 2 can remove an unbeaten draft of equal or lower rarity on
    // the first win. Only certify orders safe for every future removal seed.
    if (steam && universe === "mv-medium-2" && !repeated) {
      const rank = RARITIES.indexOf(sketches[id].rarity);
      if (rank >= RARITIES.indexOf(target.rarity) || node.helperIds.some((prior) => RARITIES.indexOf(sketches[prior].rarity) >= rank)) {
        result.skippedCulling = true;
        return null;
      }
    }
    if (steam && state.gameMode === "madman" && remainingSketchVictories(currentState, id) <= 1) {
      result.skippedCulling = true;
      return null;
    }
    const battle = forecast(node.stats, id, SCREEN_TRIALS, "screen");
    if (!battle || battle.winRate < MIN_HELPER_WIN_RATE) return null;
    try {
      const projected = projectVictories({
        state: currentState, baseStats: node.stats, sketches, ids: [id], requireAvailability: true,
      });
      if (!projected.appliedIds.length || !getSketchFightEligibility(target, projected.state).eligible) return null;
      if (!Object.keys(projected.stats).some((stat) => !Object.is(projected.stats[stat], node.stats[stat]))) return null;
      return {
        state: projected.state, stats: projected.stats, boards: availableBoards,
        helperIds: repeated ? node.helperIds : [...node.helperIds, id],
        steps: [...node.steps, { id, before: node.stats }], score: 0, key,
      };
    } catch (error) {
      if (!(error instanceof RewardProjectionError)) throw error;
      result.skippedRewardProjection = true;
      return null;
    }
  }

  function explore(node, next) {
    if (considered.has(node.key)) return considered.get(node.key);
    const targetScreen = forecast(node.stats, targetId, SCREEN_TRIALS, "screen");
    if (!targetScreen) return false;
    result.exploredRoutes += 1;
    if (targetScreen.winRate >= Math.max(1 / SCREEN_TRIALS, goal - 1 / SCREEN_TRIALS) && addPlan(node)) {
      considered.set(node.key, true);
      return true;
    }
    node.score = targetScreen.winRate + 0.06 * Math.asinh(Object.entries(node.stats).reduce(
      (total, [name, value]) => total + statImprovement(name, toNumber(value) - toNumber(baseStats[name]), baseStats), 0,
    )) + 0.04 * node.boards.length / boardSamples.length - 0.002 * node.steps.length;
    next.push(node);
    considered.set(node.key, false);
    return false;
  }

  let frontier = [root];
  for (let round = 0; round < MAX_ROUNDS && frontier.length && plans.size < MAX_PLANS; round += 1) {
    const next = [];
    for (const node of frontier) {
      if (node.steps.length >= MAX_WINS) continue;
      const branches = [];
      for (const helper of helpers) {
        const child = advance(node, helper);
        if (child && !explore(child, next)) branches.push({ child, helper });
        if (plans.size >= MAX_PLANS || result.combatTrials + targetTrials > MAX_COMBAT_TRIALS) break;
      }
      // Explore long stretches of the most promising repeated wins, while the
      // ordinary breadth search can interleave several different helpers.
      branches.sort((a, b) => b.child.score - a.child.score);
      for (const branch of branches.slice(0, round === 0 ? 3 : 1)) {
        let child = branch.child;
        // Keep budget for multi-sketch branches before committing to a long farm.
        const repeatLimit = round === 0 && branches.length > 1 ? 16 : MAX_WINS;
        for (let repeat = 2; repeat <= repeatLimit && child.steps.length < MAX_WINS && plans.size < MAX_PLANS; repeat += 1) {
          child = advance(child, branch.helper);
          if (!child) break;
          if ((REPEAT_MILESTONES.has(repeat) || child.steps.length === MAX_WINS
                || remainingSketchVictories(child.state, branch.helper.id) <= 0) && explore(child, next)) break;
        }
      }
      if (plans.size >= MAX_PLANS || result.combatTrials + targetTrials > MAX_COMBAT_TRIALS) break;
    }
    next.sort((a, b) => b.score - a.score || a.steps.length - b.steps.length);
    if (next.length > BEAM_WIDTH || round === MAX_ROUNDS - 1 && next.length) result.truncated = true;
    frontier = next.slice(0, BEAM_WIDTH);
    if (result.combatTrials + targetTrials > MAX_COMBAT_TRIALS) {
      result.truncated = true;
      break;
    }
  }
  result.plans = [...plans.values()].sort((a, b) => b.sampledBoardHits - a.sampledBoardHits
    || a.routeIds.length - b.routeIds.length || b.targetWinRate - a.targetWinRate);
  if (result.plans.length) result.status = "found";
  else if (result.skippedCulling) result.status = "unsupported_culling";
  return result;
}

function meetsGoal(result, goal) {
  return goal < 1 && result.winRate > 0 && result.winRateCi95.lower >= goal;
}

function statImprovement(name, change, baseStats) {
  const direction = name === "attackSpeed" ? -1 : 1;
  const baseline = Math.max(1, Math.abs(toNumber(baseStats[name])));
  const scale = ["attack", "maxHp", "attackSpeed"].includes(name) ? baseline / 3 : Math.max(10, baseline);
  return Math.max(-2, Math.min(2, direction * change / scale));
}
