import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSteamSave, parseSaveEnvelope } from "../web/save-format.js";
export { isFullSteamSave, isSteamSave } from "../web/save-format.js";

const STEAM_SLOT_COUNT = 6;

export function findActiveSteamSave(steamSaveDir = defaultSteamSaveDir()) {
  if (!steamSaveDir) return null;

  const directory = path.resolve(steamSaveDir);
  const slotMarker = path.join(directory, "last-slot.txt");
  let lastSlot;
  try {
    if (fs.lstatSync(slotMarker, { throwIfNoEntry: false })?.isFile()) {
      lastSlot = fs.readFileSync(slotMarker, "utf8").trim();
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // The selected slot can be older than another slot on disk.
  const slots = Array.from({ length: STEAM_SLOT_COUNT }, (_, index) => index + 1)
    .flatMap((slot) => {
      const file = path.join(directory, `slot-${slot}.json`);
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      return stat?.isFile() ? [{ slot, file, mtimeMs: stat.mtimeMs }] : [];
    });

  return slots.find(({ slot }) => String(slot) === lastSlot)?.file
    ?? slots.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file
    ?? null;
}

export function defaultSteamSaveDir() {
  let appData;
  switch (process.platform) {
    case "win32":
      appData = process.env.APPDATA;
      break;
    case "linux":
      appData = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
      break;
    case "darwin":
      appData = path.join(os.homedir(), "Library", "Application Support");
      break;
  }
  return appData ? path.join(appData, "Rejected Draft", "saves", "steam") : null;
}

export function readSaveFile(file) {
  return decodeSaveText(fs.readFileSync(file, "utf8"));
}

export function decodeSaveText(text) {
  const save = parseSaveEnvelope(text, (value) => Buffer.from(value, "base64").toString("utf8"));
  if (isSteamSave(save)) {
    save.state.saveProfile ??= save.meta?.profile;
  }

  return save;
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
  return normalizeStats(state?.[source]);
}

export function normalizeStats(raw = {}) {
  return Object.fromEntries(Object.entries(raw ?? {}).map(([key, value]) => [
    key,
    key === "immunities" || key === "vulnerability" ? value : toNumber(value),
  ]));
}
