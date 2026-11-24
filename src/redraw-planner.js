import { steamUniverse } from "./combat/steam-encounter.js";
import { createRng } from "./rng.js";
import { steamSketchRewards } from "./reward-amounts.js";
import { isFullSteamSave, toNumber } from "./save.js";
import { remainingSketchVictories } from "./victory-limit.js";

const RARITIES = ["rough", "framed", "opus", "masterpiece"];
const EXPLORATORY_RARITIES = ["scrap", ...RARITIES];
const DEFAULT_RARITY_WEIGHTS = {
  rough: 65,
  framed: 25,
  opus: 8,
  masterpiece: 2,
};
const DEFAULT_CANDIDATES = [
  { name: "38/15/7/1", minimums: { rough: 38, framed: 15, opus: 7, masterpiece: 1 } },
  { name: "39/18/10/0", minimums: { rough: 39, framed: 18, opus: 10, masterpiece: 0 } },
  { name: "32/11/11/0", minimums: { rough: 32, framed: 11, opus: 11, masterpiece: 0 } },
  { name: "40/17/10/0", minimums: { rough: 40, framed: 17, opus: 10, masterpiece: 0 } },
];
const PARAGON_IDS = new Set(["nascent_paragon", "awakened_paragon", "transcendent_paragon", "the_false_paragon"]);
const RARITY_DECAY = {
  rough: 1.1,
  framed: 1.15,
  opus: 1.05,
  masterpiece: 2,
};

export function estimateRedrawOdds({
  sketches = {},
  state = {},
  targetIds = [],
  minimums = {},
  totalSlots = null,
  guaranteedIds = [],
  unscrambledGuaranteeIds = [],
  searchNew = false,
  searchNewMultiplier = 3,
  includeStarMasterpieces = false,
  starMasterpieceWeight = 0.001,
  paragonWeightMultiplier = 0.25,
  rarityWeights = null,
  trials = 5000,
  seed = "redraw",
} = {}) {
  if (searchNew) {
    throw new Error("Find New Sketches is a separate mode from Targeted Redraw minimums.");
  }
  const normalizedTargets = unique(normalizeList(targetIds));
  const normalizedMinimums = normalizeMinimums(minimums);
  const forcedIds = getForcedDrawIds({ state, guaranteedIds, unscrambledGuaranteeIds });
  const pool = buildRedrawPool({
    sketches,
    state,
    searchNew,
    searchNewMultiplier,
    includeStarMasterpieces,
    starMasterpieceWeight,
    paragonWeightMultiplier,
    excludeZeroChance: rarityWeights == null,
    forcedIds,
  });
  const sketchChances = rarityWeights == null ? getSavedSketchChances({ sketches, state, pool }) : null;
  const slots = normalizeSlotCount(totalSlots == null
    ? savedSlotCount(state) || (sketchChances ? pool.items.length : sumMinimums(normalizedMinimums))
    : toNumber(totalSlots, sumMinimums(normalizedMinimums)));
  const targetedRedraw = analyzeTargetedRedrawLimits({
    sketches,
    state,
    minimums: normalizedMinimums,
    guaranteedIds,
    unscrambledGuaranteeIds,
    includeStarMasterpieces,
    rarityWeights,
    totalSlots: slots,
  });
  const excludedTargets = normalizedTargets
    .filter((id) => pool.excludedIds[id])
    .map((id) => ({ id, reason: pool.excludedIds[id] }));
  const targetHits = Object.fromEntries(normalizedTargets.map((id) => [id, 0]));
  const countTotals = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0]));
  let rarityMinimumHits = 0;
  let anyTargetHits = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    const rng = createRng(`${seed}:${trial}`);
    const run = drawRun({
      pool,
      minimums: normalizedMinimums,
      totalSlots: slots,
      forcedIds,
      rarityWeights: rarityWeights ?? DEFAULT_RARITY_WEIGHTS,
      sketchChances,
      rng,
    });

    for (const rarity of RARITIES) countTotals[rarity] += run.countsByRarity[rarity] ?? 0;
    if (meetsMinimums(run.countsByRarity, normalizedMinimums)) rarityMinimumHits += 1;
    const runIds = new Set(run.ids);
    let hitAny = false;
    for (const id of normalizedTargets) {
      if (runIds.has(id)) {
        targetHits[id] += 1;
        hitAny = true;
      }
    }
    if (hitAny) anyTargetHits += 1;
  }

  const safeTrials = Math.max(1, trials);
  return {
    mode: "targeted_redraw",
    trials,
    seed,
    minimums: normalizedMinimums,
    totalSlots: slots,
    probabilities: {
      rarityMinimums: round(rarityMinimumHits / safeTrials),
      anyTarget: round(anyTargetHits / safeTrials),
    },
    targetHits,
    targetRates: Object.fromEntries(Object.entries(targetHits).map(([id, hits]) => [id, round(hits / safeTrials)])),
    averageCountsByRarity: Object.fromEntries(
      Object.entries(countTotals).map(([rarity, total]) => [rarity, round(total / safeTrials)]),
    ),
    targetedRedraw,
    poolSummary: summarizePool(pool),
    excludedTargets,
    warnings: [
      ...targetedRedraw.infeasibleReasons,
      ...createPlannerWarnings({ excludedTargets, includeStarMasterpieces, searchNew }),
    ],
  };
}

export function estimateFindNewSketchOdds({
  sketches = {},
  state = {},
  totalSlots = null,
  minimumRarity = null,
  maxRedraws = 100,
  includeStarMasterpieces = false,
  starMasterpieceWeight = 0.001,
  paragonWeightMultiplier = 0.25,
  rarityWeights = null,
  trials = 5000,
  seed = "find-new-sketches",
} = {}) {
  const steam = isFullSteamSave(state);
  const exactRarity = getExploratoryRarity(state);
  const minimum = normalizeRarity(minimumRarity ?? "rough");
  const pool = buildRedrawPool({
    sketches,
    state,
    searchNew: false,
    searchNewMultiplier: 1,
    includeStarMasterpieces,
    starMasterpieceWeight,
    paragonWeightMultiplier,
    minimumRarity: steam ? "rough" : minimum,
    excludeZeroChance: rarityWeights == null,
  });
  const scrapChance = steam ? getSteamScrapChance(state) / 100 : 1;
  const scrapPool = scrapChance < 1
    ? Object.values(sketches).filter(({ id, rarity }) => rarity === "scrap" && !id.startsWith("training_dummy_"))
    : [];
  const sketchChances = rarityWeights == null ? getSavedSketchChances({ sketches, state, pool }) : null;
  const slots = normalizeSlotCount(totalSlots == null
    ? savedSlotCount(state) || (sketchChances ? pool.items.length : 10)
    : toNumber(totalSlots, 10));
  const glossary = getGlossaryUnlocks(state);
  const isNew = ({ id, rarity }) => {
    if (exactRarity ? rarity !== exactRarity : minimumRarity != null && rarityRank(rarity) < rarityRank(minimum)) {
      return false;
    }
    return glossary ? !glossary.has(id) : toNumber(state.sketchVictories?.[id]) <= 0;
  };
  const newItems = [...pool.items, ...scrapPool].filter(isNew);
  const newSketchIds = new Set(newItems.map(({ id }) => id));
  const newSketchPool = summarizePool({ items: newItems, excludedIds: {} });
  // Steam rolls Scrap independently of the Rough+ slot estimate.
  const newScrapCount = newSketchPool.byRarity.scrap ?? 0;
  const newScrapChance = 1 - (1 - scrapChance) ** newScrapCount;
  let singleRedrawHits = 0;
  let withinMaxRedrawHits = 0;
  let redrawsToNewTotal = 0;

  for (let trial = 0; newSketchIds.size > 0 && trial < trials; trial += 1) {
    let firstHit = null;
    for (let redraw = 1; redraw <= maxRedraws; redraw += 1) {
      const rng = createRng(`${seed}:${trial}:${redraw}`);
      const run = drawRun({
        pool,
        minimums: {},
        totalSlots: slots,
        forcedIds: [],
        rarityWeights: rarityWeights ?? DEFAULT_RARITY_WEIGHTS,
        sketchChances,
        rng,
      });
      const hit = run.ids.some((id) => newSketchIds.has(id)) || (newScrapChance > 0 && rng() < newScrapChance);
      if (redraw === 1 && hit) singleRedrawHits += 1;
      if (hit) {
        firstHit = redraw;
        break;
      }
    }
    if (firstHit != null) {
      withinMaxRedrawHits += 1;
      redrawsToNewTotal += firstHit;
    }
  }

  const safeTrials = Math.max(1, trials);
  return {
    mode: "find_new_sketches",
    trials,
    seed,
    totalSlots: slots,
    maxRedraws,
    minimumRarity: exactRarity ?? (minimumRarity == null && scrapChance < 1 ? "scrap" : minimum),
    exactRarity,
    probabilities: {
      singleRedrawNewSketch: round(singleRedrawHits / safeTrials),
      withinMaxRedraws: round(withinMaxRedrawHits / safeTrials),
    },
    averageRedrawsToNew: withinMaxRedrawHits > 0 ? round(redrawsToNewTotal / withinMaxRedrawHits) : null,
    newSketchPool,
    poolSummary: summarizePool({ ...pool, items: [...pool.items, ...scrapPool] }),
    warnings: [
      {
        code: "find_new_separate_mode",
        message: exactRarity
          ? `Find New Sketches searches for unseen sketches of exactly ${exactRarity} rarity.`
          : "Find New Sketches searches for any eligible unseen sketch.",
      },
    ],
  };
}

export function analyzeTargetedRedrawLimits({
  sketches = {},
  state = {},
  minimums = null,
  guaranteedIds = [],
  unscrambledGuaranteeIds = [],
  includeStarMasterpieces = false,
  rarityWeights = null,
  totalSlots = null,
} = {}) {
  const currentMinimums = normalizeMinimums(minimums ?? state.targetedRedrawMins ?? {});
  const slots = normalizeSlotCount(totalSlots == null
    ? inferTargetedRedrawTotalSlotsFromState(state, currentMinimums)
    : toNumber(totalSlots, sumMinimums(currentMinimums)));
  const selectedByRarity = normalizeGuaranteedSelections(state.guaranteedSketchSelections);
  const forcedIds = getForcedDrawIds({ state, guaranteedIds, unscrambledGuaranteeIds });
  for (const id of forcedIds) {
    const rarity = normalizeRarity(sketches[id]?.rarity);
    if (RARITIES.includes(rarity) && !selectedByRarity[rarity].includes(id)) selectedByRarity[rarity].push(id);
  }

  const capacityByRarity = Object.fromEntries(RARITIES.map((rarity) => [rarity, getGuaranteeCapacity({ state, rarity })]));
  const guaranteeCapacity = Object.fromEntries(RARITIES.map((rarity) => [rarity, capacityByRarity[rarity] ?? 0]));
  const selectedCounts = Object.fromEntries(
    RARITIES.map((rarity) => [rarity, selectedByRarity[rarity].length]),
  );
  const guaranteeSlotDetails = Object.fromEntries(RARITIES.map((rarity) => {
    const details = selectedByRarity[rarity].map((id) => ({
      id,
      cost: calculateGuaranteeSlotCost({ id, rarity, state, sketches }),
    }));
    return [rarity, details];
  }));
  const usedGuaranteeSlots = Object.fromEntries(
    RARITIES.map((rarity) => [
      rarity,
      guaranteeSlotDetails[rarity].reduce((sum, item) => sum + item.cost, 0),
    ]),
  );
  const pool = buildRedrawPool({
    sketches, state, includeStarMasterpieces, excludeZeroChance: rarityWeights == null, forcedIds,
  });
  const poolCounts = summarizePool(pool).byRarity;
  const infeasibleReasons = analyzeDrawFeasibility({ pool, poolCounts, forcedIds, minimums: currentMinimums, totalSlots: slots });
  const minimumChance = RARITIES.some((rarity) => currentMinimums[rarity] > poolCounts[rarity])
    ? 0
    : estimateTargetedMinimumChance({
        sketches,
        state,
        minimums: currentMinimums,
        guaranteedSelections: selectedByRarity,
      });
  const minimumChanceThreshold = toNumber(state.fundamentals?.targetedRedrawMinChance, 0);
  const overCapacity = RARITIES.filter((rarity) => capacityByRarity[rarity] != null
    && usedGuaranteeSlots[rarity] > capacityByRarity[rarity]);
  if (overCapacity.length > 0) {
    const details = overCapacity.map((rarity) => `${rarity} ${usedGuaranteeSlots[rarity]}/${guaranteeCapacity[rarity]}`);
    infeasibleReasons.push({
      code: "targeted_redraw_guarantee_capacity_exceeded",
      message: `Guaranteed sketches exceed the unlocked slots: ${details.join(", ")}.`,
    });
  }
  const validMinimumChance = Object.values(currentMinimums).some((value) => value > 0)
    && minimumChance >= minimumChanceThreshold;

  return {
    currentMinimums,
    totalSlots: slots,
    rarityChances: getRarityChances(state),
    minimumChance,
    minimumChanceThreshold,
    enabled: validMinimumChance && infeasibleReasons.length === 0,
    validMinimumChance,
    infeasibleReasons,
    guaranteeCapacity,
    selectedCounts,
    usedGuaranteeSlots,
    selectedByRarity,
    guaranteeSlotDetails,
  };
}

export function buildTargetedRedrawCandidates({
  state = {},
  baseMinimums = null,
  totalSlots = null,
} = {}) {
  const current = normalizeMinimums(baseMinimums ?? state.targetedRedrawMins ?? {});
  if (sumMinimums(current) <= 0) return DEFAULT_CANDIDATES;

  totalSlots ??= inferTargetedRedrawTotalSlotsFromState(state, current);
  const candidates = [];
  const seen = new Set();
  const add = (name, minimums) => {
    const normalized = normalizeMinimums(minimums);
    if (sumMinimums(normalized) > totalSlots) return;
    const key = formatMinimums(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ name, minimums: normalized, totalSlots });
  };

  add("save_current", current);
  add("farm_no_masterpiece", { ...current, masterpiece: 0 });
  add("farm_balanced_opus", {
    rough: current.rough + 1,
    framed: current.framed + 3,
    opus: current.opus + 3,
    masterpiece: 0,
  });
  add("farm_currency_opus", {
    rough: Math.max(0, current.rough - 6),
    framed: Math.max(0, current.framed - 4),
    opus: current.opus + 4,
    masterpiece: 0,
  });
  add("masterpiece_push", {
    rough: current.rough,
    framed: current.framed,
    opus: current.opus,
    masterpiece: current.masterpiece + 1,
  });
  add("masterpiece_safer", {
    rough: Math.max(0, current.rough - 2),
    framed: Math.max(0, current.framed - 1),
    opus: current.opus,
    masterpiece: current.masterpiece + 1,
  });

  return candidates.length > 0 ? candidates : DEFAULT_CANDIDATES;
}

export function recommendTargetedRedrawSettings({
  sketches = {},
  state = {},
  targetIds = [],
  candidates = null,
  trials = 2000,
  seed = "redraw-recommend",
  targetWeight = 100,
  farmWeight = 1,
  totalSlots = null,
  ...options
} = {}) {
  let resolvedCandidates = candidates;
  if (!resolvedCandidates) {
    const useSavedChances = options.rarityWeights == null && Object.keys(getSavedRarityChances(state)).length > 0;
    const hasUniverseRestrictions = RARITIES.some((rarity) => !isRedrawRarityEnabled(state, rarity));
    const forcedIds = getForcedDrawIds({ state, guaranteedIds: options.guaranteedIds, unscrambledGuaranteeIds: options.unscrambledGuaranteeIds });
    const pool = useSavedChances || hasUniverseRestrictions
      ? buildRedrawPool({ sketches, state, ...options, forcedIds, excludeZeroChance: useSavedChances })
      : null;
    const slots = totalSlots ?? (savedSlotCount(state) || pool?.items.length || null);
    resolvedCandidates = buildTargetedRedrawCandidates({ state, totalSlots: slots });
    if (hasUniverseRestrictions) {
      resolvedCandidates = adaptUniverseCandidates({ candidates: resolvedCandidates, state, pool, slots });
    }
  }
  const recommendations = [];
  const blockedCandidates = [];
  for (const candidate of resolvedCandidates) {
    const name = candidate.name ?? formatMinimums(candidate.minimums);
    const estimate = estimateRedrawOdds({
      ...options,
      sketches,
      state,
      targetIds,
      minimums: candidate.minimums,
      totalSlots: totalSlots ?? candidate.totalSlots,
      trials,
      seed,
    });
    const farmScore = minimumFarmScore(candidate.minimums);
    const targetProbability = estimate.probabilities.anyTarget;
    const { enabled, validMinimumChance, infeasibleReasons } = estimate.targetedRedraw;
    const result = {
      name,
      minimums: normalizeMinimums(candidate.minimums),
      validMinimumChance,
      minimumChance: estimate.targetedRedraw.minimumChance,
      minimumChanceThreshold: estimate.targetedRedraw.minimumChanceThreshold,
      targetProbability,
      farmScore: round(farmScore),
      score: enabled ? round(targetProbability * targetWeight + farmScore * farmWeight) : null,
      tradeoff: infeasibleReasons.length > 0 ? "infeasible"
        : !validMinimumChance ? "below_minimum_chance"
          : targetProbability > 0 ? "target_access" : "farm_without_masterpiece_target",
      estimate,
    };
    if (enabled) recommendations.push(result);
    else blockedCandidates.push(result);
  }

  recommendations.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.targetProbability !== a.targetProbability) return b.targetProbability - a.targetProbability;
    return b.farmScore - a.farmScore;
  });

  return {
    targetIds: unique(normalizeList(targetIds)),
    recommendations,
    blockedCandidates,
  };
}

function adaptUniverseCandidates({ candidates, state, pool, slots }) {
  const poolCounts = summarizePool(pool).byRarity;
  const seen = new Set();
  const results = [];
  const savedMinimums = normalizeMinimums(state.targetedRedrawMins);
  if (sumMinimums(savedMinimums) > 0) {
    results.push({ name: "save_current", minimums: savedMinimums, totalSlots: slots });
    seen.add(formatMinimums(savedMinimums));
  }
  for (const candidate of candidates) {
    if (candidate.name === "save_current") continue;
    const minimums = Object.fromEntries(
      RARITIES.map((rarity) => [rarity, Math.min(candidate.minimums[rarity] ?? 0, poolCounts[rarity])]),
    );
    const key = formatMinimums(minimums);
    const required = sumMinimums(minimums);
    if (seen.has(key) || required <= 0 || (slots != null && required > slots)) continue;
    seen.add(key);
    const name = candidate.name === formatMinimums(candidate.minimums) ? key : candidate.name;
    results.push({ name, minimums, totalSlots: slots });
  }
  if (slots > 0) {
    for (const rarity of RARITIES) {
      if (poolCounts[rarity] <= 0) continue;
      const minimums = { [rarity]: 1 };
      if (!seen.has(formatMinimums(minimums))) {
        results.push({ name: `${rarity}_minimum`, minimums, totalSlots: slots });
      }
    }
  }
  return results;
}

export function evaluateCurrentRun({
  sketches = {},
  state = {},
  targetIds = [],
  minimums = {},
  farmKeepThreshold = 2,
} = {}) {
  const ids = unique(normalizeList(state.availableSketches));
  const idSet = new Set(ids);
  const hidden = new Set(normalizeList(state.hiddenSketches));
  const eligible = new Set(ids.filter((id) => sketches[id] && !hidden.has(id) && remainingSketchVictories(state, id) > 0));
  const normalizedTargets = unique(normalizeList(targetIds));
  const normalizedMinimums = normalizeMinimums(minimums);
  const countsByRarity = countRarities({ sketches, ids });
  const presentTargets = normalizedTargets.filter((id) => idSet.has(id));
  const eligibleTargets = presentTargets.filter((id) => eligible.has(id));
  const missingTargets = normalizedTargets.filter((id) => !idSet.has(id));
  const minimumsMet = meetsMinimums(countsByRarity, normalizedMinimums);
  const farmScore = [...eligible].reduce((score, id) => score + sketchFarmValue(sketches[id], state, id), 0);
  const reasons = [];

  if (eligibleTargets.length > 0) reasons.push("target_present");
  else if (presentTargets.length > 0) reasons.push("target_hidden_or_completed");
  else if (normalizedTargets.length > 0) reasons.push("missing_target");
  if (minimumsMet) reasons.push("minimums_met");
  else reasons.push("minimums_not_met");
  if (farmScore >= farmKeepThreshold && farmKeepThreshold > 0) reasons.push("farm_score_met");

  let decision = "redraw";
  if (eligibleTargets.length > 0) decision = "keep";
  else if (minimumsMet && farmKeepThreshold > 0 && farmScore >= farmKeepThreshold) decision = "keep_farm";

  return {
    decision,
    reasons,
    targetIds: normalizedTargets,
    presentTargets,
    eligibleTargets,
    missingTargets,
    countsByRarity,
    minimums: normalizedMinimums,
    minimumsMet,
    farmScore: round(farmScore),
    farmKeepThreshold,
  };
}

export function parseMinimums(value) {
  if (!value) return {};
  if (typeof value === "object") return normalizeMinimums(value);
  const text = String(value).trim();
  if (/^\d+\/\d+\/\d+\/\d+$/.test(text)) {
    const [rough, framed, opus, masterpiece] = text.split("/").map(Number);
    return normalizeMinimums({ rough, framed, opus, masterpiece });
  }
  const result = {};
  for (const part of text.split(",")) {
    const [rawKey, rawValue] = part.split(/[=:]/).map((item) => item?.trim());
    if (!rawKey || rawValue == null) continue;
    result[normalizeRarity(rawKey)] = toNumber(rawValue);
  }
  return normalizeMinimums(result);
}

export function parseCandidateSettings(value) {
  if (!value) return DEFAULT_CANDIDATES;
  return String(value)
    .split(/[~|]/)
    .map((raw, index) => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const separator = trimmed.indexOf(":");
      if (separator >= 0) {
        const name = trimmed.slice(0, separator).trim() || `candidate_${index + 1}`;
        const minimums = parseMinimums(trimmed.slice(separator + 1));
        return { name, minimums };
      }
      const minimums = parseMinimums(trimmed);
      return { name: formatMinimums(minimums), minimums };
    })
    .filter(Boolean);
}

export function formatMinimums(minimums = {}) {
  const normalized = normalizeMinimums(minimums);
  return `${normalized.rough}/${normalized.framed}/${normalized.opus}/${normalized.masterpiece}`;
}

function estimateTargetedMinimumChance({
  sketches = {},
  state = {},
  minimums = {},
  guaranteedSelections = null,
} = {}) {
  const normalizedMinimums = normalizeMinimums(minimums);
  const chances = getRarityChances(state);
  const glossaryUnlocks = getGlossaryUnlocks(state);
  const selections = guaranteedSelections ?? normalizeGuaranteedSelections(state.guaranteedSketchSelections);
  const orderedSketches = Object.values(sketches).filter((sketch) => !sketch.id.startsWith("training_dummy_"));
  let chance = 1;

  for (const rarity of RARITIES) {
    const required = normalizedMinimums[rarity] ?? 0;
    if (required <= 0) continue;

    const selected = new Set(selections[rarity] ?? []);
    const allOfRarity = orderedSketches.filter((sketch) => normalizeRarity(sketch.rarity) === rarity);
    const nonParagonIds = allOfRarity
      .filter((sketch) => !PARAGON_IDS.has(sketch.id))
      .map((sketch) => sketch.id);
    const fullRarityCount = allOfRarity.length;
    if (fullRarityCount <= 0) {
      chance = 0;
      continue;
    }

    const guaranteedNonParagons = nonParagonIds.filter((id) => selected.has(id)).length;
    const remainingRequired = Math.max(0, required - guaranteedNonParagons);
    if (remainingRequired <= 0) continue;

    const baseProbability = Math.min(1, Math.max(0, toNumber(chances[rarity]) / 100));
    const remainingSlots = Math.max(0, fullRarityCount - guaranteedNonParagons - 1);
    const halfProbability = baseProbability / 2;
    const noFocusProbability = 1 - halfProbability;
    const probabilities = [];
    const decay = RARITY_DECAY[rarity];

    if (decay && remainingSlots > 0) {
      const unselectedIds = nonParagonIds.filter((id) => !selected.has(id));
      let lastUnlockedIndex = -1;
      for (let index = 0; index < nonParagonIds.length; index += 1) {
        if (glossaryUnlocks?.has(nonParagonIds[index])) lastUnlockedIndex = index;
      }
      for (const id of unselectedIds) {
        const distance = nonParagonIds.indexOf(id) - lastUnlockedIndex;
        let probability = baseProbability;
        if (distance > 1) probability /= decay ** (distance - 1);
        probabilities.push(probability);
      }
    } else {
      for (let index = 0; index < remainingSlots; index += 1) probabilities.push(baseProbability);
    }

    chance *= noFocusProbability * poissonBinomialAtLeast(probabilities, remainingRequired)
      + halfProbability * poissonBinomialAtLeast(probabilities, remainingRequired - 1);
  }

  return round(chance);
}

function poissonBinomialAtLeast(probabilities, required) {
  if (required <= 0) return 1;
  if (required > probabilities.length) return 0;
  const dp = new Float64Array(probabilities.length + 1);
  dp[0] = 1;
  for (let index = 0; index < probabilities.length; index += 1) {
    const probability = Math.max(0, Math.min(1, toNumber(probabilities[index])));
    for (let count = index + 1; count >= 1; count -= 1) {
      dp[count] = dp[count] * (1 - probability) + dp[count - 1] * probability;
    }
    dp[0] *= 1 - probability;
  }
  let total = 0;
  for (let count = required; count <= probabilities.length; count += 1) total += dp[count];
  return Math.max(0, Math.min(1, total));
}

function getRarityChances(state = {}) {
  const saved = getSavedRarityChances(state);
  return Object.fromEntries(RARITIES.map((rarity) => [
    rarity,
    saved[rarity] ?? DEFAULT_RARITY_WEIGHTS[rarity],
  ]));
}

export function isRedrawRarityEnabled(state, rarity) {
  return !isFullSteamSave(state)
    || !steamUniverse(state.multiverse?.currentUniverseId).disabledRarities?.includes(rarity);
}

function getSteamScrapChance(state) {
  const universe = steamUniverse(state.multiverse?.currentUniverseId);
  return Math.max(0, Math.min(100, universe.scrapRarityChance ?? toNumber(state.rarityChances?.scrap, 100)));
}

function getExploratoryRarity(state) {
  if (!isFullSteamSave(state) || toNumber(state.fundamentals?.exploratoryExclusion) <= 0) return null;
  const eligible = (rarity) => isRedrawRarityEnabled(state, rarity)
    && (rarity === "scrap" ? getSteamScrapChance(state) < 100 : toNumber(state.fundamentals?.[`${rarity}Rarity`]) > 0);
  const saved = state.selectedExploratoryRarity;
  const selected = EXPLORATORY_RARITIES.includes(saved) ? saved : "rough";
  if (eligible(selected)) return selected;
  return RARITIES.find(eligible) ?? (eligible("scrap") ? "scrap" : null);
}

function getSavedRarityChances(state) {
  const steam = isFullSteamSave(state);
  const chances = {};
  for (const rarity of RARITIES) {
    if (!isRedrawRarityEnabled(state, rarity)) {
      chances[rarity] = 0;
      continue;
    }
    const fundamental = state.fundamentals?.[`${rarity}Rarity`];
    const effective = state.rarityChances?.[rarity];
    const preferred = toNumber(steam ? effective : fundamental, NaN);
    const value = Number.isFinite(preferred) ? preferred : toNumber(steam ? fundamental : effective, NaN);
    if (Number.isFinite(value)) chances[rarity] = value;
  }
  return chances;
}

function getSavedSketchChances({ sketches, state, pool }) {
  const rarityChances = getSavedRarityChances(state);
  if (Object.keys(rarityChances).length === 0) return null;

  const glossary = getGlossaryUnlocks(state);
  const decayById = new Map();
  for (const rarity of RARITIES) {
    const ids = Object.values(sketches)
      .filter((sketch) => sketch.rarity === rarity && !sketch.id.startsWith("training_dummy_") && !PARAGON_IDS.has(sketch.id))
      .map((sketch) => sketch.id);
    const lastUnlockedIndex = ids.findLastIndex((id) => glossary?.has(id));
    for (const [index, id] of ids.entries()) {
      decayById.set(id, RARITY_DECAY[rarity] ** Math.max(0, index - lastUnlockedIndex - 1));
    }
  }

  // Game rarity is the inclusion chance for each sketch. Special sketches retain planner weights.
  return new Map(pool.items.map(({ id, rarity, weight }) => {
    const chance = (rarityChances[rarity] ?? DEFAULT_RARITY_WEIGHTS[rarity]) / 100;
    return [id, Math.max(0, Math.min(1, chance / (decayById.get(id) ?? 1))) * weight];
  }));
}

function normalizeGuaranteedSelections(value = {}) {
  const result = Object.fromEntries(RARITIES.map((rarity) => [rarity, []]));
  for (const rarity of RARITIES) {
    result[rarity] = unique(normalizeList(value?.[rarity]));
  }
  return result;
}

function getGuaranteeCapacity({ state = {}, rarity }) {
  const fundamentals = state.fundamentals ?? {};
  const computed = fundamentals[`${rarity}Sketches`];
  if (computed != null) return Math.max(0, Math.floor(toNumber(computed)));

  const skillLevels = state.skillLevels ?? {};
  const prefix = `rarity-${rarity}-q`;
  let total = null;
  for (const [key, value] of Object.entries(skillLevels)) {
    if (key === prefix || key.startsWith(`${prefix}-`)) total = (total ?? 0) + toNumber(value);
  }
  return total == null ? null : Math.max(0, Math.floor(total));
}

function calculateGuaranteeSlotCost({ id, rarity, state = {}, sketches = {} }) {
  if (PARAGON_IDS.has(id)) return Math.max(1, Math.floor(toNumber(state.fundamentals?.paragonSlots, 1)));

  const normalizedRarity = normalizeRarity(sketches[id]?.rarity ?? rarity);
  if (!RARITIES.includes(normalizedRarity)) return 1;

  const glossaryUnlocks = getGlossaryUnlocks(state);
  const unscrambledGlossaryItems = new Set(normalizeList(state.unscrambledGlossaryItems));
  const hasUnscrambledGuarantee = toNumber(state.fundamentals?.[`${normalizedRarity}UnscrambledGuarantee`]) > 0;
  if (!glossaryUnlocks?.has(id) && unscrambledGlossaryItems.has(id) && hasUnscrambledGuarantee) return 2;
  return 1;
}

function getForcedDrawIds({ state, guaranteedIds, unscrambledGuaranteeIds }) {
  return unique([
    ...normalizeList(state.guaranteedSketchIds),
    ...RARITIES.flatMap((rarity) => normalizeList(state.guaranteedSketchSelections?.[rarity])),
    ...normalizeList(guaranteedIds),
    ...normalizeList(unscrambledGuaranteeIds),
  ]);
}

function analyzeDrawFeasibility({ pool, poolCounts, forcedIds, minimums, totalSlots }) {
  const itemsById = Object.fromEntries(pool.items.map((item) => [item.id, item]));
  const forcedCounts = countRarities({ sketches: itemsById, ids: forcedIds });
  const requiredSlots = RARITIES.reduce((sum, rarity) => sum + Math.max(minimums[rarity], forcedCounts[rarity]), 0);
  const reasons = [];
  if (requiredSlots > totalSlots) {
    reasons.push({
      code: "targeted_redraw_insufficient_slots",
      message: `The minimums and guaranteed sketches require ${requiredSlots} slots, but only ${totalSlots} are available.`,
    });
  }
  const unavailableGuarantees = forcedIds.filter((id) => !Object.hasOwn(itemsById, id));
  if (unavailableGuarantees.length > 0) {
    reasons.push({
      code: "targeted_redraw_guarantee_unavailable",
      message: `Guaranteed sketches outside the draw pool: ${unavailableGuarantees.join(", ")}.`,
    });
  }
  const insufficientRarities = RARITIES.filter((rarity) => minimums[rarity] > poolCounts[rarity]);
  const poolSize = pool.items.length;
  if (totalSlots > poolSize || insufficientRarities.length > 0) {
    const details = insufficientRarities.map((rarity) => `${rarity} ${minimums[rarity]}/${poolCounts[rarity]}`);
    reasons.push({
      code: "targeted_redraw_insufficient_pool",
      message: `The draw pool has ${poolSize} sketches for ${totalSlots} slots.`
        + (details.length > 0 ? ` Unmet rarity minimums: ${details.join(", ")}.` : ""),
    });
  }
  return reasons;
}

function drawRun({ pool, minimums, totalSlots, forcedIds, rarityWeights, sketchChances, rng }) {
  const available = new Map(pool.items.map((item) => [item.id, { ...item }]));
  const ids = [];
  const countsByRarity = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0]));

  for (const id of forcedIds) {
    if (ids.length >= totalSlots) break;
    const item = available.get(id);
    if (!item) continue;
    addDrawn({ item, ids, countsByRarity, available });
  }

  for (const rarity of RARITIES) {
    while (ids.length < totalSlots && (countsByRarity[rarity] ?? 0) < (minimums[rarity] ?? 0)) {
      const item = drawWeighted(
        [...available.values()].filter((candidate) => candidate.rarity === rarity),
        rng,
      );
      if (!item) break;
      addDrawn({ item, ids, countsByRarity, available });
    }
  }

  if (ids.length < totalSlots && sketchChances) {
    const hits = [...available.values()].filter(({ id }) => rng() < sketchChances.get(id));
    const remainingSlots = totalSlots - ids.length;
    for (let index = 0; index < hits.length && index < remainingSlots; index += 1) {
      if (hits.length > remainingSlots) {
        const selected = index + Math.floor(rng() * (hits.length - index));
        [hits[index], hits[selected]] = [hits[selected], hits[index]];
      }
      addDrawn({ item: hits[index], ids, countsByRarity, available });
    }
  }

  while (!sketchChances && ids.length < totalSlots && available.size > 0) {
    const rarity = drawRarity({ available: [...available.values()], rarityWeights, rng });
    if (!rarity) break;
    const item = drawWeighted([...available.values()].filter((candidate) => candidate.rarity === rarity), rng);
    if (!item) break;
    addDrawn({ item, ids, countsByRarity, available });
  }

  return { ids, countsByRarity };
}

function addDrawn({ item, ids, countsByRarity, available }) {
  ids.push(item.id);
  countsByRarity[item.rarity] = (countsByRarity[item.rarity] ?? 0) + 1;
  available.delete(item.id);
}

function drawRarity({ available, rarityWeights, rng }) {
  const candidates = RARITIES
    .filter((rarity) => available.some((item) => item.rarity === rarity))
    .map((rarity) => ({ rarity, weight: toNumber(rarityWeights[rarity]) }));
  const picked = drawWeighted(candidates, rng, "weight");
  return picked?.rarity ?? null;
}

function drawWeighted(items, rng, weightKey = "weight") {
  if (items.length === 0) return null;
  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, toNumber(item[weightKey], 1)), 0);
  if (totalWeight <= 0) return items[Math.floor(rng() * items.length)] ?? null;
  let roll = rng() * totalWeight;
  for (const item of items) {
    roll -= Math.max(0, toNumber(item[weightKey], 1));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function buildRedrawPool({
  sketches,
  state = {},
  searchNew,
  searchNewMultiplier,
  includeStarMasterpieces,
  starMasterpieceWeight = 0.001,
  paragonWeightMultiplier = 0.25,
  minimumRarity = "rough",
  excludeZeroChance = false,
  forcedIds = [],
}) {
  const victories = state.sketchVictories ?? {};
  const excludedIds = {};
  const items = [];
  const chances = excludeZeroChance && isFullSteamSave(state) ? getSavedRarityChances(state) : {};
  const forced = new Set(forcedIds);

  for (const sketch of Object.values(sketches)) {
    if (sketch.id.startsWith("training_dummy_")) continue;
    if (!RARITIES.includes(sketch.rarity)) continue;
    if (rarityRank(sketch.rarity) < rarityRank(minimumRarity)) continue;
    if (!isRedrawRarityEnabled(state, sketch.rarity)) {
      excludedIds[sketch.id] = "universe_rarity_disabled";
      continue;
    }
    if (isStarMasterpiece(sketch) && !includeStarMasterpieces) {
      excludedIds[sketch.id] = "star_masterpiece_excluded";
      continue;
    }
    if (chances[sketch.rarity] <= 0 && !forced.has(sketch.id)) {
      excludedIds[sketch.id] = "zero_rarity_chance";
      continue;
    }

    let weight = 1;
    if (isStarMasterpiece(sketch)) weight *= starMasterpieceWeight;
    if (isParagon(sketch)) weight *= paragonWeightMultiplier;
    if (searchNew && toNumber(victories[sketch.id]) <= 0) weight *= searchNewMultiplier;

    items.push({
      id: sketch.id,
      name: sketch.name ?? sketch.id,
      rarity: sketch.rarity,
      weight,
      starMasterpiece: isStarMasterpiece(sketch),
      paragon: isParagon(sketch),
    });
  }

  return { items, excludedIds };
}

function summarizePool(pool) {
  const byRarity = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0]));
  let starMasterpieces = 0;
  let paragons = 0;
  for (const item of pool.items) {
    byRarity[item.rarity] = (byRarity[item.rarity] ?? 0) + 1;
    if (item.starMasterpiece) starMasterpieces += 1;
    if (item.paragon) paragons += 1;
  }
  return {
    total: pool.items.length,
    byRarity,
    starMasterpieces,
    paragons,
    excluded: Object.keys(pool.excludedIds).length,
  };
}

function countRarities({ sketches, ids }) {
  const counts = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0]));
  for (const id of ids) {
    const rarity = sketches[id]?.rarity;
    if (RARITIES.includes(rarity)) counts[rarity] += 1;
  }
  return counts;
}

function minimumFarmScore(minimums) {
  const normalized = normalizeMinimums(minimums ?? {});
  return normalized.rough * 0.1 + normalized.framed * 0.5 + normalized.opus * 2 + normalized.masterpiece * 0.25;
}

function sketchFarmValue(sketch, state, id) {
  const rewards = steamSketchRewards({ state, id, sketch, victoriesBefore: toNumber(state.sketchVictories?.[id]),
    boosted: normalizeList(state.boostedSketchIds).includes(id) });
  const gains = (sketch.currencyRewards ?? []).map((reward) => rewards ? rewards.currencyGain(reward) : toNumber(reward.amount));
  const improvesStat = (sketch.rewards ?? []).some((reward) => {
    const amount = rewards ? rewards.statGain(reward) : toNumber(reward.amount);
    return reward.statName === "attackSpeed" ? amount < 0 : amount > 0;
  });
  if (!improvesStat && !gains.some((amount) => amount > 0)) return 0;
  let score = sketch.rarity === "opus" ? 2 : sketch.rarity === "framed" ? 0.5 : sketch.rarity === "rough" ? 0.1 : 0.25;
  for (const amount of gains) score += Math.log10(Math.max(1, amount)) / 10;
  return score;
}

function createPlannerWarnings({ excludedTargets, includeStarMasterpieces, searchNew }) {
  const warnings = [];
  if (excludedTargets.some(({ reason }) => reason === "star_masterpiece_excluded")) {
    warnings.push({
      code: "excluded_star_masterpiece_target",
      message: "One or more target ids are (*) Masterpieces and are excluded by default.",
    });
  }
  if (excludedTargets.some(({ reason }) => reason === "universe_rarity_disabled")) {
    warnings.push({
      code: "excluded_universe_rarity_target",
      message: "One or more targets have a rarity disabled in this universe.",
    });
  }
  if (excludedTargets.some(({ reason }) => reason === "zero_rarity_chance")) {
    warnings.push({
      code: "excluded_zero_rarity_chance_target",
      message: "One or more targets have a 0% rarity chance in this save and are not guaranteed.",
    });
  }
  if (includeStarMasterpieces) {
    warnings.push({
      code: "star_masterpiece_low_weight",
      message: "(*) Masterpieces are included with a very low default weight; treat their chance as practical longshot.",
    });
  }
  if (searchNew) {
    warnings.push({
      code: "search_new_weighting",
      message: "Search New is modeled as a weight boost for sketches with zero total victories.",
    });
  }
  return warnings;
}

function meetsMinimums(countsByRarity, minimums) {
  return RARITIES.every((rarity) => toNumber(countsByRarity[rarity]) >= toNumber(minimums[rarity]));
}

function normalizeMinimums(minimums = {}) {
  const result = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0]));
  for (const [key, value] of Object.entries(minimums ?? {})) {
    const rarity = normalizeRarity(key);
    if (RARITIES.includes(rarity)) result[rarity] = Math.max(0, Math.floor(toNumber(value)));
  }
  return result;
}

function normalizeRarity(value) {
  const text = String(value).trim().toLowerCase();
  if (text === "r" || text === "roughs") return "rough";
  if (text === "f" || text === "frameds") return "framed";
  if (text === "o" || text === "opuses" || text === "opi") return "opus";
  if (text === "m" || text === "masterpieces") return "masterpiece";
  return text;
}

function sumMinimums(minimums) {
  return RARITIES.reduce((sum, rarity) => sum + toNumber(minimums[rarity]), 0);
}

function isStarMasterpiece(sketch) {
  return sketch.rarity === "masterpiece" && /\(\*\)/.test(sketch.name ?? "");
}

function isParagon(sketch) {
  return /paragon/i.test(`${sketch.id} ${sketch.name ?? ""}`);
}

function getGlossaryUnlocks(state) {
  const glossary = state.glossaryUnlocks ?? state.glossarySketchIds ?? state.unlockedSketchIds;
  return glossary == null ? null : new Set(normalizeList(glossary));
}

function normalizeSlotCount(value) {
  return Math.max(0, Math.floor(value));
}

function savedSlotCount(state) {
  const counts = state.runTotalSketchCountsByRarity ?? state.availableSketchCountsByRarity;
  const total = RARITIES.filter((rarity) => isRedrawRarityEnabled(state, rarity))
    .reduce((sum, rarity) => sum + toNumber(counts?.[rarity]), 0);
  return Math.max(0, total);
}

function inferTargetedRedrawTotalSlotsFromState(state = {}, minimums = {}) {
  return savedSlotCount(state) || sumMinimums(normalizeMinimums(minimums));
}

function rarityRank(rarity) {
  const index = EXPLORATORY_RARITIES.indexOf(normalizeRarity(rarity));
  return index < 0 ? 1 : index;
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value instanceof Set) return [...value].filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items)];
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}
