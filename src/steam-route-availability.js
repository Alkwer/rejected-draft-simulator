import { isFullSteamSave, toNumber } from "./save.js";
import { remainingSketchVictories } from "./victory-limit.js";

const RARITIES = ["scrap", "rough", "framed", "opus", "masterpiece"];

export function applySteamVictoryAvailability({ state, sketches, id, victoriesBefore, runVictoriesBefore, listIds }) {
  if (!isFullSteamSave(state)) return [];

  const universe = state.multiverse?.currentUniverseId;
  const firstVictoryCull = universe === "mv-medium-2" && runVictoriesBefore === 0;
  const maxed = remainingSketchVictories(state, id, victoriesBefore) > 0
    && remainingSketchVictories(state, id) === 0;
  const retire = maxed && universe === "mv-brutal-1";
  const available = state.availableSketches == null ? null : listIds(state.availableSketches);
  const rarity = sketches[id].rarity;
  const culled = available && (firstVictoryCull || maxed && state.gameMode === "madman")
    ? chooseCulledSketch(available, state, sketches, id, firstVictoryCull ? RARITIES.indexOf(rarity) : undefined)
    : null;
  const changes = [];

  if (maxed) {
    decrementRarity(state, "availableSketchCountsByRarity", rarity);
    if (state.autoHideMaxedUnlocked) state.hiddenSketches = [...new Set([...listIds(state.hiddenSketches), id])];
  }
  if (retire) {
    state.multiverse = { ...state.multiverse,
      retiredSketchIds: [...new Set([...listIds(state.multiverse?.retiredSketchIds), id])] };
    changes.push({ id, retired: true });
  }
  if (culled) {
    const culledRarity = sketches[culled]?.rarity;
    if (decrementRarity(state, "availableSketchCountsByRarity", culledRarity)) {
      decrementRarity(state, "runTotalSketchCountsByRarity", culledRarity);
    }
    changes.push({ id: culled, retired: false });
    if (state.hiddenSketches != null) state.hiddenSketches = listIds(state.hiddenSketches).filter((value) => value !== culled);
  }
  if (changes.length > 0) {
    const removed = new Set(changes.map((change) => change.id));
    if (available) state.availableSketches = available.filter((value) => !removed.has(value));
    for (const key of ["guaranteedSketchIds", "bonusSketchIds"]) {
      if (state[key] != null) state[key] = listIds(state[key]).filter((value) => !removed.has(value));
    }
  }
  return changes;
}

function decrementRarity(state, key, rarity) {
  const count = toNumber(state[key]?.[rarity]);
  if (!rarity || count <= 0) return false;
  state[key] = { ...state[key], [rarity]: Math.max(0, count - 1) };
  return true;
}

function chooseCulledSketch(available, state, sketches, victor, maxRarityRank) {
  const savedSeed = state.sketchRemovalSeed;
  const seed = Number.isInteger(savedSeed) && savedSeed >= 0 && savedSeed <= 0xffffffff
    ? savedSeed
    : fnv1a([
      state.multiverse?.currentUniverseId || "", state.multiverse?.totalReincarnations || 0,
      state.redrawCount || 0, state.lastRedrawTime || 0,
    ].join(":"));
  const random = createMulberry32(fnv1a(victor, seed));
  let selected = null;
  let count = 0;
  for (const id of available) {
    if (id === victor || toNumber(state.sketchRunVictories?.[id]) > 0) continue;
    if (maxRarityRank !== undefined) {
      const rank = RARITIES.indexOf(sketches[id]?.rarity);
      if (rank < 0 || rank > maxRarityRank) continue;
    }
    // A reservoir sample reproduces the game's draw order, including entries hidden in the UI.
    if (random() < 1 / ++count) selected = id;
  }
  return selected;
}

function fnv1a(value, seed = 0x811c9dc5) {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

function createMulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}
