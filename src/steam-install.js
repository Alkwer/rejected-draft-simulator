import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const STEAM_APP_ID = "4574820";

function steamRoots() {
  const home = os.homedir();
  const roots = [process.env.STEAM_PATH];
  if (process.platform === "win32") {
    for (const [key, value] of [
      ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
      ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
    ]) {
      try {
        const output = execFileSync("reg.exe", ["query", key, "/v", value], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
        roots.push(output.match(/REG_SZ\s+([^\r\n]+)/)?.[1].trim());
      } catch {
        // Steam can be registered for the machine or just the current user.
      }
    }
    if (process.env["ProgramFiles(x86)"]) roots.push(path.join(process.env["ProgramFiles(x86)"], "Steam"));
  } else {
    roots.push(path.join(home, ".steam/steam"), path.join(home, ".local/share/Steam"),
      path.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"), path.join(home, "Library/Application Support/Steam"));
  }
  return roots.filter(Boolean);
}

function manifestFor(steamapps) {
  const file = path.join(steamapps, `appmanifest_${STEAM_APP_ID}.acf`);
  if (!fs.existsSync(file)) return null;
  const manifest = fs.readFileSync(file, "utf8");
  const dir = manifest.match(/"installdir"\s*"([^"]+)"/i)?.[1];
  if (!dir || path.basename(dir) !== dir) return null;
  return { dir: path.join(steamapps, "common", dir), buildId: manifest.match(/"buildid"\s*"(\d+)"/i)?.[1] ?? null };
}

export function findSteamInstall({ steamDir = process.env.REJECTED_DRAFT_STEAM_DIR, roots } = {}) {
  if (steamDir) {
    const dir = path.resolve(steamDir);
    const manifest = manifestFor(path.resolve(dir, "../.."));
    return { dir, buildId: manifest?.dir === dir ? manifest.buildId : null };
  }
  const libraries = new Set();
  for (const root of roots ?? steamRoots()) {
    libraries.add(root);
    const vdf = path.join(root, "steamapps", "libraryfolders.vdf");
    if (!fs.existsSync(vdf)) continue;
    for (const match of fs.readFileSync(vdf, "utf8").matchAll(/"path"\s*"((?:\\.|[^"\\])*)"/gi)) {
      libraries.add(match[1].replaceAll("\\\\", "\\"));
    }
  }
  for (const library of libraries) {
    const install = manifestFor(path.join(library, "steamapps"));
    if (install && fs.existsSync(install.dir)) return install;
  }
  return null;
}

// Electron ASAR stores a length-prefixed JSON directory followed by file bytes.
// Read only the selected members, without executing or unpacking the game.
export function withGameArchive(installDir, callback) {
  const archive = ["resources/app.asar", "Rejected Draft.app/Contents/Resources/app.asar",
    "Contents/Resources/app.asar"].map((name) => path.join(installDir, name)).find((file) => fs.existsSync(file));
  if (!archive) throw new Error(`Could not find the Steam game's resources/app.asar in ${installDir}.`);
  const fd = fs.openSync(archive, "r");
  try {
    const length = fs.fstatSync(fd).size;
    function read(offset, size) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || size < 0 || offset < 0 ||
          size > 32 * 1024 * 1024 || offset + size > length) throw new Error("Invalid Steam archive entry.");
      const bytes = Buffer.alloc(size);
      if (fs.readSync(fd, bytes, 0, size, offset) !== size) throw new Error("Incomplete Steam archive read.");
      return bytes;
    }
    const header = read(0, 16);
    const dataStart = 8 + header.readUInt32LE(4);
    const indexSize = header.readUInt32LE(12);
    if (dataStart < 16 + indexSize || dataStart > length) throw new Error("Invalid Steam archive header.");
    const root = JSON.parse(read(16, indexSize).toString("utf8"));
    return callback((name) => {
      let entry = root;
      for (const part of name.split("/")) entry = entry?.files?.[part];
      if (!entry || entry.offset == null || entry.unpacked) throw new Error(`Missing packed Steam asset: ${name}`);
      return read(dataStart + Number(entry.offset), entry.size).toString("utf8");
    });
  } finally {
    fs.closeSync(fd);
  }
}
