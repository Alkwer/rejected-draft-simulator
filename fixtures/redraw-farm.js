function sketch(id, name, rarity, hp, reward) {
  return { id, name, rarity,
    stats: { maxHp: hp, attack: 1e5, attackSpeed: 1500, accuracy: 100, minDamage: 100, maxDamage: 100 },
    rewards: reward ? [{ statName: "attack", amount: reward }] : [] };
}

// One attack before defeat: two wins over First unlock Second, then the target.
export function redrawFarmFixture() {
  const targetId = "duct_taped_banana";
  const sketches = {
    [targetId]: sketch(targetId, "Final Draft", "masterpiece", 20, 0),
    first: sketch("first", "First Draft", "rough", 5, 4),
    second: sketch("second", "Second Draft", "framed", 17, 4),
  };
  const state = {
    playerStats: { maxHp: 100, attack: 10, attackSpeed: 1000, accuracy: 100, minDamage: 100, maxDamage: 100 },
    availableSketches: [targetId], sketchVictories: { first: 2 }, glossaryUnlocks: Object.keys(sketches),
    fundamentals: { maxVictories: 2, rewardDecay: 0 }, rarityChances: { rough: 50, framed: 50, masterpiece: 100 },
    targetedRedrawMins: { rough: 1, framed: 1 },
  };
  return { targetId, sketches, state, trials: 100, maxSeconds: 5, seed: "farm-board" };
}
