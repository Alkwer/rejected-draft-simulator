export function applySketchRewards({
  baseStats,
  sketches,
  defeatedIds,
  boostedIds = new Set(),
  rewardDecay = 1,
  rewardBoosterEffect = 50,
  existingVictories = {},
}) {
  const stats = { ...baseStats };
  const localVictories = { ...existingVictories };

  for (const id of defeatedIds) {
    const sketch = sketches[id];
    if (!sketch) continue;

    const victoriesBefore = localVictories[id] ?? 0;
    const decayMultiplier = 1 / (1 + victoriesBefore * rewardDecay);
    const boosterMultiplier = boostedIds.has(id) ? 1 + rewardBoosterEffect / 100 : 1;
    const multiplier = decayMultiplier * boosterMultiplier;

    for (const reward of sketch.rewards ?? []) {
      const statName = reward.statName;
      const nextValue = (stats[statName] ?? 0) + reward.amount * multiplier;
      stats[statName] = statName === "attackSpeed" ? nextValue : Math.max(0, nextValue);
    }

    localVictories[id] = victoriesBefore + 1;
  }

  return stats;
}

export function parseIdList(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
