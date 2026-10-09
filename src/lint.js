#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_DIRS = ["src", "test", "web"];

export function collectJsFiles(root = process.cwd(), dirs = DEFAULT_DIRS) {
  const files = [];
  for (const dir of dirs) {
    const absolute = path.resolve(root, dir);
    if (!fs.existsSync(absolute)) continue;
    collectFromDirectory(absolute, files);
  }
  return files.sort();
}

export function runLint({
  root = process.cwd(),
  files = collectJsFiles(root),
} = {}) {
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      failures.push({
        file,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }
  }

  return {
    ok: failures.length === 0,
    checked: files.length,
    failures,
  };
}

function collectFromDirectory(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFromDirectory(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = runLint();
  if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`Syntax check failed: ${path.relative(process.cwd(), failure.file)}`);
      if (failure.stdout) console.error(failure.stdout.trim());
      if (failure.stderr) console.error(failure.stderr.trim());
    }
    process.exit(1);
  }
  console.log(`Syntax check passed for ${result.checked} JavaScript files.`);
}
