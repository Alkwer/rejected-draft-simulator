import { createRng } from "./rng.js";
import { toNumber } from "./save.js";

const RARITIES = ["rough", "framed", "opus", "masterpiece"];
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
  rarityWeights = DEFAULT_RARITY_WEIGHTS,
  trials = 5000,
  seed = "redraw",
} = {}) {
  if (searchNew) {
    throw new Error("Find New Sketches is a separate mode from Targeted Redraw minimums.");
  }
  const normalizedTargets = normalizeList(targetIds);
  const normalizedMinimums = normalizeMinimums(minimums);
  const slots = totalSlots == null
    ? inferTargetedRedrawTotalSlotsFromState(state, normalizedMinimums)
    : toNumber(totalSlots, sumMinimums(normalizedMinimums));
  const pool = buildRedrawPool({
    sketches,
    state,
    searchNew,
    searchNewMultiplier,
    includeStarMasterpieces,
    starMasterpieceWeight,
    paragonWeightMultiplier,
  });
  const forcedIds = unique([
    ...getGuaranteedSketchIdsFromState(state),
    ...normalizeList(guaranteedIds),
    ...normalizeList(unscrambledGuaranteeIds),
  ]);
  const targetedRedraw = analyzeTargetedRedrawLimits({
    sketches,
    state,
    minimums: normalizedMinimums,
    guaranteedIds,
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
      rarityWeights,
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
    warnings: createPlannerWarnings({ excludedTargets, includeStarMasterpieces, searchNew }),
  };
}

export function estimateFindNewSketchOdds({
  sketches = {},
  state = {},
  totalSlots = null,
  minimumRarity = "rough",
  maxRedraws = 100,
  includeStarMasterpieces = false,
  starMasterpieceWeight = 0.001,
  paragonWeightMultiplier = 0.25,
  rarityWeights = DEFAULT_RARITY_WEIGHTS,
  trials = 5000,
  seed = "find-new-sketches",
} = {}) {
  const slots = totalSlots == null ? inferTotalSlotsFromState(state) : toNumber(totalSlots, 10);
  const pool = buildRedrawPool({
    sketches,
    state,
    searchNew: false,
    searchNewMultiplier: 1,
    includeStarMasterpieces,
    starMasterpieceWeight,
    paragonWeightMultiplier,
    minimumRarity,
  });
  const newSketchIds = new Set(
    pool.items
      .filter((item) => isNewSketch({ state, id: item.id }))
      .map((item) => item.id),
  );
  const newSketchPool = summarizePool({ items: pool.items.filter((item) => newSketchIds.has(item.id)), excludedIds: {} });
  let singleRedrawHits = 0;
  let withinMaxRedrawHits = 0;
  let redrawsToNewTotal = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    let firstHit = null;
    for (let redraw = 1; redraw <= maxRedraws; redraw += 1) {
      const rng = createRng(`${seed}:${trial}:${redraw}`);
      const run = drawRun({
        pool,
        minimums: {},
        totalSlots: slots,
        forcedIds: [],
        rarityWeights,
        rng,
      });
      const hit = run.ids.some((id) => newSketchIds.has(id));
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
    minimumRarity: normalizeRarity(minimumRarity),
    probabilities: {
      singleRedrawNewSketch: round(singleRedrawHits / safeTrials),
      withinMaxRedraws: round(withinMaxRedrawHits / safeTrials),
    },
    averageRedrawsToNew: withinMaxRedrawHits > 0 ? round(redrawsToNewTotal / withinMaxRedrawHits) : null,
    newSketchPool,
    poolSummary: summarizePool(pool),
    warnings: [
      {
        code: "find_new_separate_mode",
        message: "Find New Sketches ignores Targeted Redraw minimums and searches for any unseen Rough+ sketch.",
      },
    ],
  };
}

export function analyzeTargetedRedrawLimits({
  sketches = {},
  state = {},
  minimums = null,
  guaranteedIds = [],
  totalSlots = null,
} = {}) {
  const currentMinimums = normalizeMinimums(minimums ?? state.targetedRedrawMins ?? {});
  const slots = totalSlots == null
    ? inferTargetedRedrawTotalSlotsFromState(state, currentMinimums)
    : toNumber(totalSlots, sumMinimums(currentMinimums));
  const selectedByRarity = normalizeGuaranteedSelections(state.guaranteedSketchSelections);
  for (const id of normalizeList(guaranteedIds)) {
    const rarity = normalizeRarity(sketches[id]?.rarity);
    if (RARITIES.includes(rarity) && !selectedByRarity[rarity].includes(id)) selectedByRarity[rarity].push(id);
  }

  const guaranteeCapacity = Object.fromEntries(
    RARITIES.map((rarity) => [rarity, getGuaranteeCapacity({ state, rarity })]),
  );
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
  const minimumChance = estimateTargetedMinimumChance({
    sketches,
    state,
    minimums: currentMinimums,
    guaranteedSelections: selectedByRarity,
  });
  const minimumChanceThreshold = toNumber(state.fundamentals?.targetedRedrawMinChance, 0);
  const enabled = Object.values(currentMinimums).some((value) => value > 0)
    && minimumChance >= minimumChanceThreshold;

  return {
    currentMinimums,
    totalSlots: slots,
    rarityChances: getRarityChances(state),
    minimumChance,
    minimumChanceThreshold,
    enabled,
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
} = {}) {
  const current = normalizeMinimums(baseMinimums ?? state.targetedRedrawMins ?? {});
  if (sumMinimums(current) <= 0) return DEFAULT_CANDIDATES;

  const totalSlots = inferTargetedRedrawTotalSlotsFromState(state, current);
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
  ...options
} = {}) {
  const resolvedCandidates = candidates ?? buildTargetedRedrawCandidates({ state });
  const recommendations = resolvedCandidates.map((candidate, index) => {
    const name = candidate.name ?? formatMinimums(candidate.minimums);
    const estimate = estimateRedrawOdds({
      sketches,
      state,
      targetIds,
      minimums: candidate.minimums,
      totalSlots: candidate.totalSlots,
      trials,
      seed: `${seed}:${name}:${index}`,
      ...options,
    });
    const farmScore = estimateFarmScore({ sketches, minimums: candidate.minimums });
    const targetProbability = estimate.probabilities.anyTarget;
    const validMinimumChance = estimate.targetedRedraw.enabled;
    const rawScore = targetProbability * targetWeight + farmScore * farmWeight;
    const score = validMinimumChance ? rawScore : rawScore - 1e6;
    return {
      name,
      minimums: normalizeMinimums(candidate.minimums),
      validMinimumChance,
      minimumChance: estimate.targetedRedraw.minimumChance,
      minimumChanceThreshold: estimate.targetedRedraw.minimumChanceThreshold,
      targetProbability,
      farmScore: round(farmScore),
      score: round(score),
      tradeoff: targetProbability > 0
        ? validMinimumChance ? "target_access" : "below_minimum_chance"
        : "farm_without_masterpiece_target",
      estimate,
    };
  });

  recommendations.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.targetProbability !== a.targetProbability) return b.targetProbability - a.targetProbability;
    return b.farmScore - a.farmScore;
  });

  return {
    targetIds: normalizeList(targetIds),
    recommendations,
  };
}

export function evaluateCurrentRun({
  sketches = {},
  state = {},
  targetIds = [],
  minimums = {},
  farmKeepThreshold = 0,
} = {}) {
  const ids = normalizeList(state.availableSketches);
  const idSet = new Set(ids);
  const normalizedTargets = normalizeList(targetIds);
  const normalizedMinimums = normalizeMinimums(minimums);
  const countsByRarity = countRarities({ sketches, ids });
  const presentTargets = normalizedTargets.filter((id) => idSet.has(id));
  const missingTargets = normalizedTargets.filter((id) => !idSet.has(id));
  const minimumsMet = meetsMinimums(countsByRarity, normalizedMinimums);
  const farmScore = estimateFarmScore({ sketches, ids });
  const reasons = [];

  if (presentTargets.length > 0) reasons.push("target_present");
  else if (normalizedTargets.length > 0) reasons.push("missing_target");
  if (minimumsMet) reasons.push("minimums_met");
  else reasons.push("minimums_not_met");
  if (farmScore >= farmKeepThreshold && farmKeepThreshold > 0) reasons.push("farm_score_met");

  let decision = "redraw";
  if (presentTargets.length > 0) decision = "keep";
  else if (minimumsMet && farmKeepThreshold > 0 && farmScore >= farmKeepThreshold) decision = "keep_farm";

  return {
    decision,
    reasons,
    targetIds: normalizedTargets,
    presentTargets,
    missingTargets,
    countsByRarity,
    minimums: normalizedMinimums,
    minimumsMet,
    farmScore: round(farmScore),
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
  const glossaryUnlocks = new Set(normalizeList(
    state.glossaryUnlocks ?? state.glossarySketchIds ?? state.unlockedSketchIds,
  ));
  const selections = guaranteedSelections ?? normalizeGuaranteedSelections(state.guaranteedSketchSelections);
  const orderedSketches = Object.values(sketches);
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
        if (glossaryUnlocks.has(nonParagonIds[index])) lastUnlockedIndex = index;
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
  const fundamentals = state.fundamentals ?? {};
  return Object.fromEntries(RARITIES.map((rarity) => [
    rarity,
    toNumber(
      fundamentals[`${rarity}Rarity`] ?? state.rarityChances?.[rarity] ?? DEFAULT_RARITY_WEIGHTS[rarity],
      DEFAULT_RARITY_WEIGHTS[rarity],
    ),
  ]));
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
  let total = 0;
  for (const [key, value] of Object.entries(skillLevels)) {
    if (key === prefix || key.startsWith(`${prefix}-`)) total += toNumber(value);
  }
  return Math.max(0, Math.floor(total));
}

function calculateGuaranteeSlotCost({ id, rarity, state = {}, sketches = {} }) {
  if (PARAGON_IDS.has(id)) return Math.max(1, Math.floor(toNumber(state.fundamentals?.paragonSlots, 1)));

  const normalizedRarity = normalizeRarity(sketches[id]?.rarity ?? rarity);
  if (!RARITIES.includes(normalizedRarity)) return 1;

  const glossaryUnlocks = new Set(normalizeList(
    state.glossaryUnlocks ?? state.glossarySketchIds ?? state.unlockedSketchIds,
  ));
  const unscrambledGlossaryItems = new Set(normalizeList(state.unscrambledGlossaryItems));
  const hasUnscrambledGuarantee = toNumber(state.fundamentals?.[`${normalizedRarity}UnscrambledGuarantee`]) > 0;
  if (!glossaryUnlocks.has(id) && unscrambledGlossaryItems.has(id) && hasUnscrambledGuarantee) return 2;
  return 1;
}

function getGuaranteedSketchIdsFromState(state = {}) {
  return unique([
    ...normalizeList(state.guaranteedSketchIds),
    ...RARITIES.flatMap((rarity) => normalizeList(state.guaranteedSketchSelections?.[rarity])),
  ]);
}

function drawRun({ pool, minimums, totalSlots, forcedIds, rarityWeights, rng }) {
  const available = new Map(pool.items.map((item) => [item.id, { ...item }]));
  const ids = [];
  const countsByRarity = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0]));

  for (const id of forcedIds) {
    const item = available.get(id);
    if (!item) continue;
    addDrawn({ item, ids, countsByRarity, available });
  }

  for (const rarity of RARITIES) {
    while ((countsByRarity[rarity] ?? 0) < (minimums[rarity] ?? 0)) {
      const item = drawWeighted(
        [...available.values()].filter((candidate) => candidate.rarity === rarity),
        rng,
      );
      if (!item) break;
      addDrawn({ item, ids, countsByRarity, available });
    }
  }

  while (ids.length < totalSlots && available.size > 0) {
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
  state,
  searchNew,
  searchNewMultiplier,
  includeStarMasterpieces,
  starMasterpieceWeight,
  paragonWeightMultiplier,
  minimumRarity = "rough",
}) {
  const victories = state.sketchVictories ?? {};
  const excludedIds = {};
  const items = [];

  for (const sketch of Object.values(sketches)) {
    if (!RARITIES.includes(sketch.rarity)) continue;
    if (rarityRank(sketch.rarity) < rarityRank(minimumRarity)) continue;
    if (isStarMasterpiece(sketch) && !includeStarMasterpieces) {
      excludedIds[sketch.id] = "star_masterpiece_excluded";
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
    byRarity[item.rarity] += 1;
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

function estimateFarmScore({ sketches, minimums = null, ids = null }) {
  if (ids) {
    return ids.reduce((score, id) => score + sketchFarmValue(sketches[id]), 0);
  }
  const normalized = normalizeMinimums(minimums ?? {});
  return normalized.rough * 0.1 + normalized.framed * 0.5 + normalized.opus * 2 + normalized.masterpiece * 0.25;
}

function sketchFarmValue(sketch) {
  if (!sketch) return 0;
  let score = sketch.rarity === "opus" ? 2 : sketch.rarity === "framed" ? 0.5 : sketch.rarity === "rough" ? 0.1 : 0.25;
  for (const reward of sketch.currencyRewards ?? []) score += Math.log10(Math.max(1, toNumber(reward.amount))) / 10;
  return score;
}

function createPlannerWarnings({ excludedTargets, includeStarMasterpieces, searchNew }) {
  const warnings = [];
  if (excludedTargets.length > 0) {
    warnings.push({
      code: "excluded_star_masterpiece_target",
      message: "One or more target ids are (*) Masterpieces and are excluded by default.",
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

function isNewSketch({ state, id }) {
  if (state.glossarySketchIds) return !normalizeList(state.glossarySketchIds).includes(id);
  if (state.unlockedSketchIds) return !normalizeList(state.unlockedSketchIds).includes(id);
  return toNumber(state.sketchVictories?.[id]) <= 0;
}

function inferTotalSlotsFromState(state = {}) {
  const counts = state.runTotalSketchCountsByRarity ?? state.availableSketchCountsByRarity;
  if (!counts) return 10;
  const total = RARITIES.reduce((sum, rarity) => sum + toNumber(counts[rarity]), 0);
  return total > 0 ? total : 10;
}

function inferTargetedRedrawTotalSlotsFromState(state = {}, minimums = {}) {
  const counts = state.runTotalSketchCountsByRarity ?? state.availableSketchCountsByRarity;
  if (counts) {
    const total = RARITIES.reduce((sum, rarity) => sum + toNumber(counts[rarity]), 0);
    if (total > 0) return total;
  }
  return sumMinimums(normalizeMinimums(minimums));
}

function rarityRank(rarity) {
  const index = RARITIES.indexOf(normalizeRarity(rarity));
  return index < 0 ? 0 : index;
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
