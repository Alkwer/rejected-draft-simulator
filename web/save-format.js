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
      [save.playerStats, save.battleStats, save.currentRunStats].some(isRecord)) {
    save = { version: save.version ?? null, state: save };
  }
  if (!isRecord(save) || !isRecord(save.state)) {
    throw new Error("Invalid Rejected Draft save. Missing game state.");
  }
  return save;
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
