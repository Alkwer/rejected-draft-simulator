import path from "node:path";

import { writeCombatReferenceDocument } from "./combat-reference.js";

const args = parseArgs(process.argv.slice(2));

try {
  const result = await writeCombatReferenceDocument({
    metadataPath: path.resolve(args.metadata ?? path.join("data", "metadata.json")),
    assetDir: path.resolve(args["asset-dir"] ?? "tmp"),
    outputPath: path.resolve(args.output ?? path.join("docs", "combat-engine-reference.md")),
  });
  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      outputPath: result.outputPath,
      sections: result.reference.sections.length,
      missing: result.reference.missing,
      sources: result.sourceNames,
    }, null, 2));
  } else {
    console.log(`Wrote ${result.outputPath}`);
    console.log(`Sections: ${result.reference.sections.length}`);
    if (result.reference.missing.length > 0) {
      console.log(`Missing: ${result.reference.missing.map((item) => item.id).join(", ")}`);
    }
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
