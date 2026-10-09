import test from "node:test";
import assert from "node:assert/strict";

import { parseRouteSpecs, parseSwapMap } from "../src/route-options.js";

test("parseRouteSpecs accepts shell-safe route separators", () => {
  assert.deepEqual(parseRouteSpecs("empty:~farm:vinchy,mariline"), [
    { name: "empty", ids: [] },
    { name: "farm", ids: ["vinchy", "mariline"] },
  ]);
});

test("parseRouteSpecs keeps pipe separators for direct node usage", () => {
  assert.deepEqual(parseRouteSpecs("empty:|farm:vinchy"), [
    { name: "empty", ids: [] },
    { name: "farm", ids: ["vinchy"] },
  ]);
});

test("parseSwapMap parses pivot mappings", () => {
  assert.deepEqual(parseSwapMap("old:new,opus:replacement"), {
    old: "new",
    opus: "replacement",
  });
});
