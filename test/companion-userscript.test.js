import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("Tampermonkey companion script reads the game save and calls the local companion endpoint read-only", () => {
  const script = fs.readFileSync(path.join(projectRoot, "companion", "rejected-draft-companion.user.js"), "utf8");

  assert.match(script, /@match\s+https:\/\/kuzzigames\.com\/rejected_draft\/\*/);
  assert.match(script, /@match\s+https:\/\/kuzzigames\.com\/rejected_draft$/m);
  assert.match(script, /@match\s+https:\/\/www\.kuzzigames\.com\/rejected_draft$/m);
  assert.match(script, /@run-at\s+document-end/);
  assert.match(script, /@grant\s+GM_xmlhttpRequest/);
  assert.match(script, /@connect\s+127\.0\.0\.1/);
  assert.match(script, /unnamed-battler-save/);
  assert.match(script, /\/api\/companion\/analyze/);
  assert.match(script, /\/api\/companion\/fight-fixture/);
  assert.match(script, /GM_xmlhttpRequest/);
  assert.match(script, /Analyze current run/);
  assert.match(script, /Capture fight fixture/);
  assert.match(script, /Download fixture JSON/);
  assert.match(script, /saveHistory/);
  assert.match(script, /recordSaveSnapshot/);
  assert.match(script, /captureDiagnostics/);
  assert.match(script, /visibleCombatLog/);
  assert.match(script, /captureVisibleCombatLog/);
  assert.match(script, /innerText/);
  assert.match(script, /wrapStorageSetItem/);
  assert.match(script, /prototype\.setItem/);
  assert.match(script, /250/);
  assert.doesNotMatch(script, /localStorage\.setItem/);
  assert.doesNotMatch(script, /document\.querySelector\([^)]*CHALLENGE/);
  assert.doesNotMatch(script, /\.click\(\)/);
});

test("Tampermonkey companion script avoids template literals for editor parser compatibility", () => {
  const script = fs.readFileSync(path.join(projectRoot, "companion", "rejected-draft-companion.user.js"), "utf8");

  assert.doesNotMatch(script, /`/);
  assert.doesNotMatch(script, /\$\{/);
  assert.doesNotMatch(script, /\basync\b/);
  assert.doesNotMatch(script, /\bawait\b/);
});

test("Tampermonkey companion script mounts a visible isolated overlay with diagnostics", () => {
  const script = fs.readFileSync(path.join(projectRoot, "companion", "rejected-draft-companion.user.js"), "utf8");

  assert.match(script, /attachShadow/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /__rdSimulatorCompanion/);
  assert.match(script, /2147483647/);
  assert.match(script, /display: block !important/);
  assert.match(script, /visibility: visible !important/);
  assert.match(script, /opacity: 1 !important/);
});
