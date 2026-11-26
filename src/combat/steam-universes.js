// Reference build for the modeled encounter parameters. Real-fight calibration is separate.
export const VERIFIED_STEAM_BUILD = "26933131";
export const VERIFIED_STEAM_BUILDS = new Set(["26885190", VERIFIED_STEAM_BUILD]);
export const STEAM_UNIVERSES = {
  "mv-original": {},
  "mv-easy-1": {currencyRewardMultiplier: 0.0001, currencyRewardOnly: ["Graphite", "Wax", "Charcoal", "Coffee", "Ink"], disabledRarities: ["framed", "opus", "masterpiece"]},
  "mv-easy-2": {vulnerableSketchHealthMultiplier: 100, vulnerableSketchAttackMultiplier: 10, vulnerabilityEffectMultiplier: 10, disabledRarities: ["masterpiece"]},
  "mv-easy-3": {enemyHealthMultiplier: 0.1, currencyRewardMultiplier: 25, scrapRarityChance: 75, disabledRarities: ["framed", "opus", "masterpiece"]},
  "mv-easy-4": {disabledRarities: ["opus", "masterpiece"]},
  "mv-easy-5": {enemyBuffStatMultiplier: 2.5, currencyRewardOnly: ["Graphite", "Wax"]},
  "mv-medium-1": {enemyOffenseStatMultiplier: 1.5, currencyRewardMultiplier: 0.75, currencyRewardDisabled: ["Coffee"]},
  "mv-medium-2": {enemyHealthMultiplier: 2, enemyAttackMultiplier: 2, statRewardMultiplier: 0.75},
  "mv-medium-3": {enemyAttackMultiplier: 2.5, enemyDebuffStatMultiplier: 2.5, scrapRarityChance: 50},
  "mv-medium-4": {enemyDefenseStatMultiplier: 2, currencyRewardMultiplier: 0.2, disabledRarities: ["masterpiece"]},
  "mv-medium-5": {enemyUtilityStatMultiplier: 3},
  "mv-hard-1": {enemyBuffStatMultiplier: 4, enemyDebuffStatMultiplier: 4, currencyRewardMultiplier: 0.04},
  "mv-hard-2": {currencyRewardDisabled: ["Photon"], statRewardMultiplier: 0.3},
  "mv-hard-3": {enemyAttackMultiplier: 2.5, enemyChanceStatMultiplier: 5, allRewardMultiplier: 0.25, scrapRarityChance: 25},
  "mv-hard-4": {currencyRewardMultiplier: 0.0001, statRewardMultiplier: 0.0001, repeatVictoryRewardMultiplier: 0.01, cardBonusPower: 4, disabledRarities: ["masterpiece"]},
  "mv-hard-5": {},
  "mv-brutal-1": {enemyHealthMultiplier: 12, enemyAttackMultiplier: 9, allRewardMultiplier: 0.1},
  "mv-brutal-2": {enemyHealthMultiplier: 16, enemyAttackMultiplier: 12, allRewardMultiplier: 0.3, scrapRarityChance: 10},
  "mv-brutal-3": {enemyHealthMultiplier: 20, enemyAttackMultiplier: 15, allRewardMultiplier: 0.2},
};

export const STEAM_ENEMY_STAT_GROUPS = {
  Buff: "hasteChance leapChance energyWaveChance inspirationChance thornsChance resonanceChance".split(" "),
  Debuff: "bleedChance burnChance burnDamage hinderChance plagueChance poisonChance hypnotizeChance slowChance frailtyChance freezeChance electrocuteChance curseChance blackFlameChance bananaPeelChance balloonChance hotPotatoChance brittleChance irradiateChance exacerbateChance woundChance paralysisChance".split(" "),
  Utility: "lifesteal hinderChance hypnotizeChance slowChance frailtyChance freezeChance hasteChance remedy bananaPeelChance balloonChance brittleChance thornsChance purgeChance diseaseSpreadChance".split(" "),
  Offense: "attack minDamage maxDamage lifesteal critDmg armorPen execute berserk parryDmg bleedChance burnChance burnDamage plagueChance poisonChance hypnotizeChance multiStrikeChance energyWaveChance electrocuteChance curseChance blackFlameChance inspirationChance hotPotatoChance goldenLuckChance goldenLuckDamage irradiateChance purgeChance woundChance paralysisChance diseaseSpreadChance".split(" "),
  Defense: "maxHp regen lifesteal armor blockAmount leapChance".split(" "),
  Chance: "bleedChance burnChance hinderChance plagueChance poisonChance hypnotizeChance slowChance frailtyChance freezeChance multiStrikeChance hasteChance leapChance energyWaveChance electrocuteChance curseChance blackFlameChance bananaPeelChance inspirationChance balloonChance hotPotatoChance brittleChance thornsChance goldenLuckChance irradiateChance exacerbateChance resonanceChance purgeChance woundChance paralysisChance diseaseSpreadChance".split(" "),
};

export const STEAM_ENEMY_BASE_STATS = {
  maxHp: 10,
  attack: 1,
  minDamage: 75,
  maxDamage: 125,
  critDmg: 150,
  execute: 100,
  berserk: 100,
  parryDmg: 5,
  burnDamage: 1,
  goldenLuckDamage: 150,
};

export const STEAM_DECAY_IMMUNE_STATS = new Set("attackSpeed dodge critChance accuracy parry glancingBlow counter blockChance absorb opacity varnish surrealism isolation interceptChance grappleChance elementalManipulationChance".split(" "));
