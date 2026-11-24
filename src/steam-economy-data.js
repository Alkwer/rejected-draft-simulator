import { readFileSync } from "node:fs";
import { STEAM_SHOP_CATALOG } from "./steam-shop-catalog.js";

let bundledShopUpgrades;

export function steamShopUpgrades(state) {
  if (state[STEAM_SHOP_CATALOG]) return state[STEAM_SHOP_CATALOG];
  bundledShopUpgrades ??= JSON.parse(readFileSync(new URL("../data/steam-catalog.json", import.meta.url), "utf8")).shopUpgrades;
  return bundledShopUpgrades;
}

// Player stat definitions verified in Steam build 26885190.
export const STEAM_PLAYER_BASE_STATS = {
  maxHp: 10,
  attack: 1,
  minDamage: 75,
  maxDamage: 125,
  attackSpeed: 3e3,
  critDmg: 150,
  execute: 100,
  berserk: 100,
  parryDmg: 5,
  burnDamage: 1,
  goldenLuckDamage: 150,
};

export const STEAM_PLAYER_STAT_GROUPS = {
  buff: "hasteChance leapChance energyWaveChance inspirationChance thornsChance resonanceChance".split(" "),
  debuff: "bleedChance burnChance burnDamage hinderChance plagueChance poisonChance hypnotizeChance slowChance frailtyChance freezeChance electrocuteChance curseChance blackFlameChance bananaPeelChance balloonChance hotPotatoChance brittleChance irradiateChance exacerbateChance woundChance paralysisChance".split(" "),
  utility: "attackSpeed lifesteal parry hinderChance hypnotizeChance slowChance frailtyChance freezeChance hasteChance opacity remedy bananaPeelChance balloonChance brittleChance thornsChance isolation purgeChance interceptChance grappleChance elementalManipulationChance diseaseSpreadChance".split(" "),
  offense: "attack minDamage maxDamage attackSpeed lifesteal critChance critDmg accuracy armorPen execute berserk parryDmg counter bleedChance burnChance burnDamage plagueChance poisonChance hypnotizeChance multiStrikeChance energyWaveChance electrocuteChance curseChance blackFlameChance surrealism inspirationChance hotPotatoChance goldenLuckChance goldenLuckDamage irradiateChance purgeChance woundChance paralysisChance grappleChance elementalManipulationChance diseaseSpreadChance".split(" "),
  defense: "maxHp regen dodge lifesteal armor parry glancingBlow counter blockChance blockAmount leapChance absorb opacity varnish isolation interceptChance".split(" "),
  chance: "dodge critChance accuracy parry glancingBlow counter bleedChance burnChance hinderChance plagueChance poisonChance hypnotizeChance slowChance frailtyChance freezeChance multiStrikeChance blockChance hasteChance leapChance energyWaveChance electrocuteChance curseChance blackFlameChance bananaPeelChance varnish surrealism inspirationChance balloonChance hotPotatoChance brittleChance thornsChance goldenLuckChance irradiateChance exacerbateChance resonanceChance purgeChance interceptChance woundChance paralysisChance grappleChance elementalManipulationChance diseaseSpreadChance".split(" "),
};

export const STEAM_PLAYER_STAT_FUNDAMENTALS = new Set("attack maxHp regen armor armorPen dodge minDamage maxDamage lifesteal execute blockChance blockAmount accuracy bleedChance plagueChance burnChance burnDamage electrocuteChance curseChance absorb irradiateChance parry parryDmg critChance critDmg glancingBlow counter opacity poisonChance thornsChance multiStrikeChance freezeChance remedy hinderChance hypnotizeChance slowChance frailtyChance hasteChance energyWaveChance".split(" "));
