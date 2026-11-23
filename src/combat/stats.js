export function stat(combatant, key, fallback = 0) {
  const value = Number(combatant?.stats?.[key] ?? combatant?.[key] ?? fallback);
  return Number.isNaN(value) ? fallback : value;
}

export function statRaw(combatant, key, fallback = 0) {
  return stat(combatant, key, fallback);
}

export function combatantMaxHp(combatant) {
  return stat(combatant, "maxHp", 1);
}
