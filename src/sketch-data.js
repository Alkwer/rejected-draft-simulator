import fs from "node:fs";
import path from "node:path";

export function readSketchData(path) {
  return parseSketches(fs.readFileSync(path, "utf8"));
}

export function readDataMetadata(dataPath) {
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

export function parseSketches(source) {
  const sketches = {};
  const re =
    /\{id:"([^"]+)",name:"([^"]+)"[\s\S]*?rarity:"([^"]+)"[\s\S]*?stats:\{([\s\S]*?)\},\s*rewards:\[([\s\S]*?)\](?:,\s*currencyRewards:\[([\s\S]*?)\])?/g;

  let match;
  while ((match = re.exec(source))) {
    const [, id, name, rarity, statsRaw, rewardsRaw, currencyRaw = ""] = match;
    const { stats, vulnerability, immunities } = parseStats(statsRaw);
    sketches[id] = {
      id,
      name,
      rarity,
      stats,
      vulnerability,
      immunities,
      rewards: parseRewards(rewardsRaw),
      currencyRewards: parseCurrencyRewards(currencyRaw),
    };
  }

  return sketches;
}

function parseStats(raw) {
  const stats = {};
  const statRe = /([A-Za-z][A-Za-z0-9]*):new [A-Za-z_$][A-Za-z0-9_$]*\(([^)]+)\)|([A-Za-z][A-Za-z0-9]*):(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g;
  let match;
  while ((match = statRe.exec(raw))) {
    const key = match[1] ?? match[3];
    if (key === "vulnerability" || key === "immunities") continue;
    stats[key] = parseAmount(match[2] ?? match[4]);
  }

  const vulnerabilityMatch = raw.match(/vulnerability:\["([^"]+)",([^\]]+)\]/);
  const vulnerability = vulnerabilityMatch
    ? [vulnerabilityMatch[1], parseAmount(vulnerabilityMatch[2])]
    : null;

  const immunitiesMatch = raw.match(/immunities:\[([^\]]*)\]/);
  const immunities = immunitiesMatch
    ? [...immunitiesMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])
    : [];

  return { stats, vulnerability, immunities };
}

function parseRewards(raw) {
  return [...raw.matchAll(/statName:"([^"]+)",amount:new [A-Za-z_$][A-Za-z0-9_$]*\(([^)]+)\)/g)].map((match) => ({
    statName: match[1],
    amount: parseAmount(match[2]),
  }));
}

function parseCurrencyRewards(raw) {
  return [...raw.matchAll(/name:"([^"]+)",amount:new [A-Za-z_$][A-Za-z0-9_$]*\(([^)]+)\)/g)].map((match) => ({
    name: match[1],
    amount: parseAmount(match[2]),
  }));
}

function parseAmount(raw) {
  const cleaned = String(raw).trim().replace(/^["']|["']$/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
