export function stat(combatant, key, fallback = 0) {
  return Number(combatant?.stats?.[key] ?? combatant?.[key] ?? fallback) || fallback;
}

export function statRaw(combatant, key, fallback = 0) {
  return Number(combatant?.stats?.[key] ?? combatant?.[key] ?? fallback) || fallback;
}

export function combatantMaxHp(combatant) {
  return stat(combatant, "maxHp", 1);
}
