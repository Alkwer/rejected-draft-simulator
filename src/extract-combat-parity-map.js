import path from "node:path";

import { writeCombatParityMapDocument } from "./combat-parity-map.js";

const args = parseArgs(process.argv.slice(2));

try {
  const simulatorPaths = args.sources
    ? String(args.sources).split(",").map((item) => path.resolve(item.trim())).filter(Boolean)
    : undefined;
  const result = await writeCombatParityMapDocument({
    referencePath: path.resolve(args.reference ?? path.join("docs", "combat-engine-reference.md")),
    simulatorPaths,
    outputPath: path.resolve(args.output ?? path.join("docs", "combat-engine-parity-map.md")),
  });
  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      outputPath: result.outputPath,
      checks: result.map.summary.total,
      statusCounts: result.map.summary.statusCounts,
      severityCounts: result.map.summary.severityCounts,
    }, null, 2));
  } else {
    console.log(`Wrote ${result.outputPath}`);
    console.log(`Checks: ${result.map.summary.total}`);
    console.log(`Gaps: ${result.map.summary.statusCounts.gap ?? 0}`);
  }
} catch (error) {
  const payload = { ok: false, error: error.message ?? String(error) };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(payload.error);
  }
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
