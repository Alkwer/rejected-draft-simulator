// Keep installed catalog definitions separate from user-supplied save fields.
export const STEAM_SHOP_CATALOG = Symbol("Steam shop catalog");

export function parseSteamShop(source) {
  const start = source.search(/\[\{id:"upgrade_[^"]+",stat:/);
  const end = source.indexOf("}]", start);
  if (start < 0 || end < 0) throw new Error("Missing Steam shop upgrade definitions.");
  const catalog = {};
  for (const record of source.slice(start + 2, end).split("},{")) {
    const row = /^id:"(upgrade_[\w-]+)",stat:"(\w+)",currency:"([^"]+)",baseCost:([^,]+),costMultiplier:([^,]+),multiplier:([^,]+),maxLevel:(-?\d+)(.*)$/.exec(record);
    if (!row) throw new Error("Unsupported Steam shop record. The previous catalog was preserved.");
    const [, id, statName, currency, price, scale, effect, cap, flags] = row;
    const baseCost = Number(/^new [\w$]+\("([\d.e+-]+)"\)$/.exec(price)?.[1] ?? price);
    const costMultiplier = Number(scale);
    const factor = /^([\w$]+)=>new [\w$]+\(1\)\.plus\(new [\w$]+\(([\d.e+-]+)\)\.times\(\1\)\)$/.exec(effect);
    const maxLevel = Number(cap);
    const perLevel = Number(factor?.[2]);
    const options = /^(?:,isHidden:!0)?(?:,requiredSkillId:"([\w-]+)")?$/.exec(flags);
    if (!options || !Number.isSafeInteger(maxLevel) || maxLevel < -1 || Object.hasOwn(catalog, id)
      || ![baseCost, costMultiplier, perLevel].every((value) => Number.isFinite(value) && value > 0)
      || costMultiplier <= 1) throw new Error("Unsupported Steam shop upgrade: " + id);
    const hidden = flags.includes(",isHidden:!0");
    const requiredSkillId = options[1] ?? (hidden ? "stats-hidden-upgrades" : undefined);
    catalog[id] = { id, statName, currency, baseCost, costMultiplier, perLevel,
      ...(maxLevel >= 0 && { maxLevel }), ...(requiredSkillId && { requiredSkillId }), hidden };
  }
  return catalog;
}
