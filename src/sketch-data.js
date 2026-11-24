import fs from "node:fs";
import path from "node:path";

export function readGameBundle(dataPath) {
  if (path.extname(dataPath) === ".json") {
    const { metadata, sketches, shopUpgrades } = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    return { dataMetadata: metadata, sketches, ...(shopUpgrades && { shopUpgrades }) };
  }
  return { sketches: readSketchData(dataPath), dataMetadata: readDataMetadata(dataPath) };
}

export function readSketchData(dataPath) {
  const source = fs.readFileSync(dataPath, "utf8");
  return path.extname(dataPath) === ".json" ? JSON.parse(source).sketches : parseSketches(source);
}

export function readDataMetadata(dataPath) {
  if (path.extname(dataPath) === ".json") {
    return fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")).metadata : null;
  }
  const metadataPath = path.resolve(path.dirname(dataPath), "metadata.json");
  if (!fs.existsSync(metadataPath)) return null;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  return {
    gameVersion: metadata.gameVersion ?? null,
    saveVersion: metadata.saveVersion ?? null,
    asset: metadata.asset ?? null,
    capturedAt: metadata.capturedAt ?? null,
    ...metadata,
  };
}

export function parseSketches(source, { strict = false } = {}) {
  const sketches = {};
  const re =
    /\{id:"([^"]+)",name:"([^"]+)"[\s\S]*?rarity:"([^"]+)"[\s\S]*?stats:\{([\s\S]*?)\},\s*rewards:\[([\s\S]*?)\](?:,\s*currencyRewards:\[([\s\S]*?)\])?/g;

  let match;
  while ((match = re.exec(source))) {
    const [, id, name, rarity, statsRaw, rewardsRaw, currencyRaw = ""] = match;
    const { stats, vulnerability, immunities } = parseStats(statsRaw, strict);
    const rewards = parseRewards(rewardsRaw, strict);
    const currencyRewards = parseCurrencyRewards(currencyRaw, strict);
    if (strict && (rewards.length !== (rewardsRaw.match(/{/g) ?? []).length ||
        currencyRewards.length !== (currencyRaw.match(/{/g) ?? []).length)) {
      throw new Error(`Unsupported Steam reward in sketch ${id}.`);
    }
    sketches[id] = {
      id,
      name,
      rarity,
      stats,
      vulnerability,
      immunities,
      rewards,
      currencyRewards,
    };
  }

  return sketches;
}

function parseStats(raw, strict) {
  const stats = {};
  const statRe = /([A-Za-z][A-Za-z0-9]*):new [A-Za-z_$][A-Za-z0-9_$]*\(([^)]+)\)|([A-Za-z][A-Za-z0-9]*):(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g;
  let match;
  while ((match = statRe.exec(raw))) {
    const key = match[1] ?? match[3];
    if (key === "vulnerability" || key === "immunities") continue;
    stats[key] = parseAmount(match[2] ?? match[4], strict);
  }

  const vulnerabilityMatch = raw.match(/vulnerability:\["([^"]+)",([^\]]+)\]/);
  const vulnerability = vulnerabilityMatch
    ? [vulnerabilityMatch[1], parseAmount(vulnerabilityMatch[2], strict)]
    : null;

  const immunitiesMatch = raw.match(/immunities:\[([^\]]*)\]/);
  const immunities = immunitiesMatch
    ? [...immunitiesMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])
    : [];

  if (strict && raw.replace(statRe, "").replace(vulnerabilityMatch?.[0] ?? "", "")
      .replace(immunitiesMatch?.[0] ?? "", "").replace(/[,\s]/g, "")) {
    throw new Error("Unrecognized Steam sketch stat expression.");
  }
  return { stats, vulnerability, immunities };
}

function parseRewards(raw, strict) {
  return [...raw.matchAll(/statName:"([^"]+)",amount:new [A-Za-z_$][A-Za-z0-9_$]*\(([^)]+)\)/g)].map((match) => ({
    statName: match[1],
    amount: parseAmount(match[2], strict),
  }));
}

function parseCurrencyRewards(raw, strict) {
  return [...raw.matchAll(/name:"([^"]+)",amount:new [A-Za-z_$][A-Za-z0-9_$]*\(([^)]+)\)/g)].map((match) => ({
    name: match[1],
    amount: parseAmount(match[2], strict),
  }));
}

function parseAmount(raw, strict) {
  const cleaned = String(raw).trim().replace(/^["']|["']$/g, "");
  const parsed = Number(cleaned);
  if (strict && !Number.isFinite(parsed)) throw new Error(`Unsupported Steam numeric value: ${raw}`);
  return Number.isFinite(parsed) ? parsed : 0;
}
