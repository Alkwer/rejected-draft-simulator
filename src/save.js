import fs from "node:fs";

export function readSaveFile(path) {
  return decodeSaveText(fs.readFileSync(path, "utf8"));
}

export function decodeSaveText(text) {
  const trimmed = text.trim();
  const json = Buffer.from(trimmed, "base64").toString("utf8");
  return JSON.parse(json);
}

export function toNumber(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === "object") {
    const mantissa = value.mantissa ?? value.m;
    const exponent = value.exponent ?? value.e;
    if (mantissa != null && exponent != null) {
      const parsed = Number(mantissa) * 10 ** Number(exponent);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
  }
  return fallback;
}

export function extractStats(state, source = "playerStats") {
  const raw = state?.[source] ?? {};
  const stats = {};
  for (const [key, value] of Object.entries(raw)) {
    stats[key] = toNumber(value);
  }
  return stats;
}
