const LEGACY_STAT_SOURCES = ["playerStats", "battleStats", "currentRunStats"];

export function parseSaveEnvelope(text, decodeBase64 = decodeBase64Text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("Save is empty.");
  let save;
  try {
    save = JSON.parse(trimmed.startsWith("{") ? trimmed : decodeBase64(trimmed));
  } catch {
    throw new Error("Invalid Rejected Draft save. Expected JSON or a base64-encoded save.");
  }
  if (isRecord(save) && !Object.hasOwn(save, "state") &&
      LEGACY_STAT_SOURCES.some((source) => Object.hasOwn(save, source))) {
    save = { version: save.version ?? null, state: save };
  }
  if (!isRecord(save) || !isRecord(save.state)) {
    throw new Error("Invalid Rejected Draft save. Missing game state.");
  }
  if (!isSteamSave(save)) validateLegacyStatSources(save.state);
  return save;
}

export function validateLegacyStatSources(state, sources = LEGACY_STAT_SOURCES) {
  const invalidBySource = sources.map((source) => invalidCombatStats(state?.[source]));
  if (invalidBySource.some((fields) => fields.length === 0)) return;

  const details = sources.map((source, index) => `${source} (${invalidBySource[index].join(", ")})`);
  throw new Error(`Invalid Rejected Draft save. Missing or invalid combat stats in ${details.join("; ")}. `
    + "Expected one source with positive maxHp and attackSpeed and non-negative attack.");
}

export function invalidCombatStats(stats) {
  return ["maxHp", "attack", "attackSpeed"].filter((key) => {
    const value = isRecord(stats) && Object.hasOwn(stats, key) ? combatStatNumber(stats[key]) : NaN;
    return !Number.isFinite(value) || (key === "attack" ? value < 0 : value <= 0);
  });
}

export function combatStatNumber(value) {
  if (isRecord(value)) {
    const mantissa = plainStatNumber(value.mantissa ?? value.m);
    const exponent = plainStatNumber(value.exponent ?? value.e);
    return mantissa * 10 ** exponent;
  }
  return plainStatNumber(value);
}

function plainStatNumber(value) {
  return typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
}

function decodeBase64Text(value) {
  const bytes = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return new TextDecoder().decode(Uint8Array.from(bytes, (char) => char.charCodeAt(0)));
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function profileOf(save) {
  return save?.meta?.profile ?? (save?.state ?? save)?.saveProfile;
}

export function isSteamSave(save) {
  const profile = profileOf(save);
  return profile === "steam" || profile === "steam-demo";
}

export function isFullSteamSave(save) {
  return profileOf(save) === "steam";
}
