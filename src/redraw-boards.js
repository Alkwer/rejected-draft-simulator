import { getSavedRarityChances, getSavedSketchChances, getSteamScrapChance, isRedrawRarityEnabled } from "./redraw-planner.js";
import { isFullSteamSave, toNumber } from "./save.js";

const RARITIES = ["rough", "framed", "opus", "masterpiece"];
const PARAGONS = ["nascent_paragon", "awakened_paragon", "transcendent_paragon", "the_false_paragon"];
const PARAGON_UNLOCK_COUNTS = [35, 25, 25, 10];
// Extra discovery rolls on prestige in Steam build 26933131. Each tuple is
// [sketch, first redraw, glossary entries of this rarity, chance multiplier].
const DISCOVERY_ROLLS = [
  ["fountain_pen_duelist", 2, 0, 25], ["clockwork_heart", 3, 1, 20], ["rorschach_bat", 5, 2, 10],
  ["deep_diver", 6, 3, 4], ["canvas_flayer", 7, 4, 3], ["scorpion_mech", 8, 6, 3],
  ["plague_doctor", 9, 8, 3], ["cyber_skull", 10, 10, 2], ["sub_xero", 11, 0, 25],
  ["dumb_door", 13, 1, 15], ["miranara", 15, 2, 5], ["ink_son", 18, 3, 4],
  ["loopy", 21, 4, 3], ["bikachu", 24, 5, 3], ["eyezen", 27, 8, 3], ["kenpatchy", 30, 13, 3],
  ["wash_ink_ton", 40, 0, 7], ["marker_polo", 50, 1, 5], ["ed_ink_son", 60, 3, 3],
  ["art_istotle", 65, 5, 3], ["marie_blur_ie", 70, 7, 3], ["froyd", 75, 9, 3],
  ["show_pen", 80, 11, 2], ["franklyn", 90, 13, 2], ["vitruvian_man", 150, 1, 3],
];

function savedIds(value) {
  if (Array.isArray(value) || value instanceof Set) return [...value];
  if (typeof value === "string") return value.split(",").map((id) => id.trim()).filter(Boolean);
  return value && typeof value === "object" ? Object.values(value) : [];
}

// An ordinary redraw rolls inclusion for each sketch. The previous board size
// is an observed count, not a cap on the next board.
export function createRedrawBoardSampler(sketches, state) {
  const steam = isFullSteamSave(state);
  const saved = getSavedRarityChances(state);
  if (!["scrap", ...RARITIES].some((r) => state.rarityChances?.[r] != null || state.fundamentals?.[r + "Rarity"] != null)) return null;
  const chances = Object.fromEntries(RARITIES.map((r) => [r, saved[r] ?? 0]));
  const catalog = Object.values(sketches).filter(({ id, rarity }) =>
    !id.startsWith("training_dummy_") && (rarity === "scrap" || RARITIES.includes(rarity)));
  const regular = catalog.filter(({ id }) => !PARAGONS.includes(id));
  const rarityIds = RARITIES.map((rarity) => regular.filter((s) => s.rarity === rarity).map((s) => s.id));
  const glossary = new Set(savedIds(state.glossaryUnlocks ?? state.glossarySketchIds ?? state.unlockedSketchIds));
  const unscrambled = new Set(savedIds(state.unscrambledGlossaryItems));
  const retired = new Set(savedIds(state.multiverse?.retiredSketchIds));
  const eligible = (s) => s && !retired.has(s.id) && isRedrawRarityEnabled(state, s.rarity);
  const selections = state.guaranteedSketchSelections;
  const selectedIds = selections ? Object.values(selections).flatMap(savedIds)
    : savedIds(state.guaranteedSketchIds).filter((id) => state.sketchGuaranteeSources?.[id] !== "progression");
  const guaranteed = new Set(selectedIds.filter((id) => {
    const unlocked = !steam || !state.glossaryUnlocks || glossary.has(id) || unscrambled.has(id) && !PARAGONS.includes(id);
    return unlocked && eligible(sketches[id]);
  }));
  const items = regular.map((s) => ({ id: s.id, rarity: s.rarity,
    weight: !steam && s.rarity === "masterpiece" && s.name?.includes("(*)") ? 0.001 : 1 }));
  const rolls = getSavedSketchChances({ sketches, state, rarityChances: chances, pool: { items } });
  const scrapRate = (steam ? getSteamScrapChance(state) : toNumber(state.rarityChances?.scrap, 100)) / 100;
  const inclusion = regular.filter(eligible).map(({ id, rarity }) => [id, rarity === "scrap" ? scrapRate : rolls.get(id)]);
  const counts = RARITIES.map((r, i) => state.glossaryRarityCounts?.[r] ?? rarityIds[i].filter((id) => glossary.has(id)).length);
  const baseChance = (rarity) => toNumber(state.fundamentals?.[rarity + "Rarity"], chances[rarity]);
  const nextDraw = toNumber(state.redrawCount) + 1;
  const extraRolls = [];
  if (steam) for (const [id, first, required, factor] of DISCOVERY_ROLLS) {
    const sketch = sketches[id];
    if (!eligible(sketch) || glossary.has(id) || nextDraw < first || counts[RARITIES.indexOf(sketch.rarity)] < required) continue;
    extraRolls.push([id, baseChance(sketch.rarity) * factor / 100]);
  }
  const paragonRates = PARAGONS.map((id, i) => {
    const rarity = RARITIES[i];
    if (!eligible(sketches[id])) return 0;
    const base = baseChance(rarity);
    if (guaranteed.has(id) || base >= 100) return 1;
    if (counts[i] < PARAGON_UNLOCK_COUNTS[i] || i > 0 && !glossary.has(PARAGONS[i - 1])) return 0;
    const poolSize = catalog.filter((s) => s.rarity === rarity).length;
    return base / (100 * (1 + Math.max(0, poolSize - counts[i]) * 0.1));
  });
  const banishGroups = RARITIES.flatMap((rarity, i) => {
    const ids = rarityIds[i];
    const slots = Math.max(0, Math.min(3, toNumber(state.fundamentals?.[rarity + "BanishSlots"])));
    const banned = savedIds(state.banishedSketchSelections?.[rarity])
      .filter((id) => ids.includes(id) && !guaranteed.has(id) && (glossary.has(id) || unscrambled.has(id))).slice(0, slots);
    if (!banned.length) return [];
    const lastKnown = ids.findLastIndex((id) => glossary.has(id));
    return [{ banned, replacements: banned.map((id) =>
      ids.slice(0, Math.max(lastKnown, ids.indexOf(id)) + 1).filter((alt) => !banned.includes(alt) && eligible(sketches[alt]))) }];
  });
  const minimums = Object.entries(state.targetedRedrawMins ?? {}).filter(([, value]) => toNumber(value) > 0);
  const possible = new Set(guaranteed);
  const certain = new Set(guaranteed);
  for (const [id, rate] of [...inclusion, ...extraRolls]) {
    if (rate > 0) possible.add(id);
    if (rate >= 1) certain.add(id);
  }
  let chainCertain = true;
  for (const [i, rate] of paragonRates.entries()) {
    if (rate <= 0) break;
    possible.add(PARAGONS[i]);
    chainCertain &&= rate >= 1;
    if (chainCertain) certain.add(PARAGONS[i]);
  }
  for (const { banned, replacements } of banishGroups) {
    for (const [i, id] of banned.entries()) {
      certain.delete(id);
      if (possible.delete(id)) for (const alt of replacements[i]) possible.add(alt);
    }
  }
  return {
    canAppear: (id) => possible.has(id),
    alwaysDrawn: (id) => certain.has(id),
    hasMinimums: minimums.length > 0,
    meetsMinimums(board) {
      const byRarity = {};
      for (const id of board) byRarity[sketches[id].rarity] = (byRarity[sketches[id].rarity] ?? 0) + 1;
      return minimums.every(([r, min]) => (byRarity[r] ?? 0) >= toNumber(min));
    },
    sample(rng) {
      const board = new Set(guaranteed);
      for (const [id, rate] of inclusion) if (rng() < rate) board.add(id);
      for (const [id, rate] of extraRolls) if (rng() < rate) board.add(id);
      for (const [i, rate] of paragonRates.entries()) {
        if (rng() >= rate) break;
        board.add(PARAGONS[i]);
      }
      for (const { banned, replacements } of banishGroups) {
        for (const [i, id] of banned.entries()) {
          if (!board.delete(id)) continue;
          const choices = replacements[i].filter((alt) => !board.has(alt));
          if (choices.length) board.add(choices[Math.floor(rng() * choices.length)]);
        }
      }
      return [...board];
    },
  };
}
