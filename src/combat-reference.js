import fs from "node:fs";
import path from "node:path";

const DEFAULT_GENERATED_AT = () => new Date().toISOString();

const SECTION_DEFINITIONS = [
  {
    id: "status-caps",
    title: "Status Caps And Sets",
    marker: "Fa={Haste",
    endMarker: "Zt=",
    confidence: "high",
    notes: [
      "Defines active self-buff caps and the harmful/self-buff status sets used by combat.",
      "Player buff base caps are Haste 1000, Inspiration 100, Leap 1000 and EnergyWave 1000. The attack resolver leaves enemy buffs uncapped.",
      "This section is a dependency for status application, Remedy filtering and player stack cap checks.",
    ],
  },
  {
    id: "varnish-survival",
    title: "Varnish Survival",
    minifiedName: "Zt",
    confidence: "high",
    notes: [
      "Runs after post-mitigation damage pushes HP to zero or below.",
      "Chance is compared as varnish minus prior VarnishTriggers against Math.random() * 100.",
      "Successful survival restores max HP times max(0, 50 - VarnishTriggers) percent.",
    ],
  },
  {
    id: "damage-resolution",
    title: "Damage Resolution",
    minifiedName: "Va",
    confidence: "high",
    notes: [
      "Resolves one direct hit and returns new HP plus hit/death/counter flags.",
      "Order visible in this bundle: Inspiration, Surrealism, min/max roll, Execute, Crit, Glancing Blow, Golden Luck, Dodge, Parry, Block, Armor and ArmorPen, Absorb, Electrocute, Frailty, Brittle, Varnish, Counter.",
      "Electrocute is calculated from post-mitigation direct damage before Frailty and Brittle are added to the normal damage event.",
    ],
  },
  {
    id: "attack-resolution",
    title: "Attack Resolution",
    minifiedName: "pt",
    confidence: "high",
    notes: [
      "Resolves a full attacker turn around the direct-hit resolver.",
      "The resolver handles Remedy, Hinder, BananaPeel, Hypnotize, then MultiStrike and the HotPotato branch before repeated hits.",
      "Each hit can apply statuses, pop Balloon, grow Brittle, apply Thorns, record Counter and grant self buffs. The turn ends with Bleed recoil, Curse reflection and Lifesteal.",
    ],
  },
  {
    id: "status-tick",
    title: "Status Tick Resolution",
    minifiedName: "qn",
    confidence: "high",
    notes: [
      "Runs harmful periodic statuses, EnergyWave consumption, Inspiration tick rolls, Balloon growth and Irradiate growth.",
      "EnergyWave consumes max(1, floor(stacks * 0.1)) per status tick and uses attacker attack times Inspiration.",
      "Inspiration is rolled on the status tick; Haste, Leap, EnergyWave and Thorns are rolled in the attack resolver.",
      "The status tick exits early when both status maps are empty. Player Inspiration adds the fundamentals cap bonus to its base 100, while enemy Inspiration is uncapped.",
    ],
  },
  {
    id: "regen-tick",
    title: "Regen Tick Resolution",
    minifiedName: "Qn",
    confidence: "high",
    notes: [
      "Runs regeneration and Freeze shatter/suppression separately from harmful status ticks.",
      "Freeze below or equal 100 reduces regen by one percent per stack; Freeze above 100 converts regen into damage.",
      "Varnish can trigger from freeze tick damage after HP reaches zero.",
    ],
  },
  {
    id: "combat-loop",
    title: "Combat Loop Timing",
    marker: "consolidateCombatTick:(e,n=!0)=>",
    endMarker: ",startTrainingDummy",
    confidence: "high",
    notes: [
      "The loop processes ready attacks, then regen ticks and status ticks against the current wall-clock target time.",
      "Regen cadence is 1001ms divided by the speed multiplier; status cadence is 1002ms divided by the speed multiplier.",
      "Attack delay uses attackSpeed times Slow as 0.1% per stack and divided by Haste as 0.1% per stack.",
      "Counter is scheduled 200ms divided by combat speed after the triggering attack and executes the attack resolver with the Counter flag.",
    ],
  },
];

export function extractCombatReference({
  metadata = {},
  sources = [],
  generatedAt = DEFAULT_GENERATED_AT(),
} = {}) {
  const normalizedSources = sources
    .filter((source) => source && typeof source.source === "string")
    .map((source) => ({
      name: source.name ?? "unknown.js",
      kind: source.kind ?? "unknown",
      source: source.source,
    }));

  const sections = [];
  const missing = [];
  for (const definition of SECTION_DEFINITIONS) {
    const extracted = extractSection(definition, normalizedSources);
    if (extracted) {
      sections.push({
        id: definition.id,
        title: definition.title,
        sourceName: extracted.sourceName,
        minifiedName: definition.minifiedName ?? null,
        confidence: definition.confidence,
        notes: definition.notes,
        snippet: extracted.snippet,
      });
    } else {
      missing.push({
        id: definition.id,
        title: definition.title,
        minifiedName: definition.minifiedName ?? null,
      });
    }
  }

  return {
    version: {
      edition: metadata.platform ?? null,
      gameVersion: metadata.gameVersion ?? null,
      saveVersion: metadata.saveVersion ?? null,
      mainAsset: metadata.mainAsset ?? null,
      storeAsset: metadata.storeAsset ?? null,
      sketchAsset: metadata.asset ?? null,
      capturedAt: metadata.capturedAt ?? null,
    },
    generatedAt,
    sections,
    missing,
  };
}

export function renderCombatReferenceMarkdown(reference) {
  const lines = [];
  lines.push("# Combat Engine Reference");
  lines.push("");
  lines.push("Extracted mechanics for the edition and asset versions listed below. Use observed fights from the same edition to verify timing and outcomes.");
  lines.push("");
  lines.push("## Version");
  lines.push("");
  lines.push(`- Edition: ${formatValue(reference.version?.edition)}`);
  lines.push(`- Game version: ${formatValue(reference.version?.gameVersion)}`);
  lines.push(`- Save version: ${formatValue(reference.version?.saveVersion)}`);
  lines.push(`- Main asset: ${formatValue(reference.version?.mainAsset)}`);
  lines.push(`- Store asset: ${formatValue(reference.version?.storeAsset)}`);
  lines.push(`- Sketch asset: ${formatValue(reference.version?.sketchAsset)}`);
  lines.push(`- Captured: ${formatValue(reference.version?.capturedAt)}`);
  lines.push(`- Generated: ${formatValue(reference.generatedAt)}`);
  lines.push("");
  lines.push("## Detected Bundle Sections");
  lines.push("");
  for (const section of reference.sections ?? []) {
    lines.push(`- ${section.title}: \`${section.minifiedName ?? "window"}\` from \`${section.sourceName}\` (${section.confidence})`);
  }
  if ((reference.missing ?? []).length > 0) {
    lines.push("");
    lines.push("Missing sections:");
    for (const item of reference.missing) {
      lines.push(`- ${item.title}: expected \`${item.minifiedName ?? item.id}\``);
    }
  }
  lines.push("");
  for (const section of reference.sections ?? []) {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(`- Source: \`${section.sourceName}\``);
    lines.push(`- Minified symbol: \`${section.minifiedName ?? "source window"}\``);
    lines.push(`- Confidence: ${section.confidence}`);
    lines.push("");
    lines.push("Notes:");
    for (const note of section.notes ?? []) lines.push(`- ${note}`);
    lines.push("");
    lines.push("```js");
    lines.push(section.snippet);
    lines.push("```");
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export async function writeCombatReferenceDocument({
  metadataPath = path.join("data", "metadata.json"),
  assetDir = "tmp",
  outputPath = path.join("docs", "combat-engine-reference.md"),
  fetchImpl = globalThis.fetch,
  now = DEFAULT_GENERATED_AT,
} = {}) {
  const metadata = readJson(metadataPath) ?? {};
  const sources = await readReferenceSources({ metadata, assetDir, fetchImpl });
  const reference = extractCombatReference({
    metadata,
    sources,
    generatedAt: typeof now === "function" ? now() : now,
  });
  if (reference.sections.length === 0) {
    throw new Error(`No combat reference sections found for ${metadata.storeAsset ?? "the selected assets"} in ${assetDir}.`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderCombatReferenceMarkdown(reference));
  return {
    outputPath,
    reference,
    sourceNames: sources.map((source) => source.name),
  };
}

export async function readReferenceSources({ metadata = {}, assetDir = "tmp", fetchImpl = globalThis.fetch } = {}) {
  const wanted = [
    { kind: "main", asset: metadata.mainAsset, url: metadata.mainAssetUrl },
    { kind: "store", asset: metadata.storeAsset, url: metadata.storeAssetUrl },
  ].filter((item) => item.asset);
  const sources = [];
  for (const item of wanted) {
    const filePath = path.join(assetDir, item.asset);
    let source = null;
    if (fs.existsSync(filePath)) {
      source = fs.readFileSync(filePath, "utf8");
    } else if (item.url) {
      source = await fetchText(fetchImpl, item.url);
      fs.mkdirSync(assetDir, { recursive: true });
      fs.writeFileSync(filePath, source);
    }
    if (source) {
      sources.push({
        name: item.asset,
        kind: item.kind,
        source,
      });
    }
  }
  return sources;
}

function extractSection(definition, sources) {
  for (const source of sortSourcesForSection(definition, sources)) {
    const snippet = definition.minifiedName
      ? extractAssignedArrowSnippet(source.source, definition.minifiedName)
      : extractWindowSnippet(source.source, definition.marker, definition.endMarker);
    if (snippet) return { sourceName: source.name, snippet };
  }
  return null;
}

function sortSourcesForSection(definition, sources) {
  if (
    definition.id === "status-caps"
    || definition.id === "varnish-survival"
    || definition.id === "damage-resolution"
    || definition.id === "attack-resolution"
    || definition.id === "status-tick"
    || definition.id === "regen-tick"
    || definition.id === "combat-loop"
  ) {
    return [...sources].sort((a, b) => Number(b.kind === "store") - Number(a.kind === "store"));
  }
  return sources;
}

function extractWindowSnippet(source, marker, endMarker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const end = source.indexOf(endMarker, start + marker.length);
  return end > start ? cleanSnippet(source.slice(start, end)) : null;
}

function extractAssignedArrowSnippet(source, name) {
  const assignment = new RegExp(
    `(?:\\b(?:const|let|var)\\s+|[,;]\\s*)${escapeRegExp(name)}\\s*=\\s*\\([^(){}]*\\)\\s*=>\\s*\\{`,
  ).exec(source);
  if (!assignment) return null;
  const start = assignment.index + (/^[,;]/.test(assignment[0]) ? 1 : 0);
  const bodyStart = assignment.index + assignment[0].length - 1;
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd < 0) return null;
  return cleanSnippet(source.slice(start, bodyEnd + 1));
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function cleanSnippet(snippet) {
  return String(snippet)
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,])\s*/g, "$1")
    .trim();
}

async function fetchText(fetchImpl, url) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available.");
  const response = await fetchImpl(url);
  if (!response?.ok) {
    throw new Error(`Fetch failed for ${url}: ${response?.status ?? "unknown"} ${response?.statusText ?? ""}`.trim());
  }
  return response.text();
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatValue(value) {
  return value === null || value === undefined || value === "" ? "unknown" : String(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
