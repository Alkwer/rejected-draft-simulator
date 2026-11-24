import assert from "node:assert/strict";

// Playwright buffers response bodies. Check both wire records and their agreement.
export async function completedAnalysis(pendingResponse) {
  const response = await pendingResponse;
  assert.equal(response.status(), 200);
  const records = (await response.text()).trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  const [{ primary }, complete] = records;
  assert.equal(complete.ok, true, complete.error);
  for (const key of ["target", "result", "report", "finalStats", "bundle"]) {
    assert.deepEqual(primary[key], complete.analysis[key]);
  }
  return complete;
}
