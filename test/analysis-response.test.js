import assert from "node:assert/strict";
import test from "node:test";
import { readAnalysisResponse } from "../web/analysis-response.js";

function streamedResponse(text) {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
}

test("analysis records survive split lines and multibyte characters", async () => {
  const primary = { target: "Szkic Ł" };
  const complete = { ok: true, analysis: primary };
  const seen = [];
  const response = streamedResponse([JSON.stringify({ primary }), JSON.stringify(complete), ""].join("\n"));
  assert.deepEqual(await readAnalysisResponse(response, (record) => seen.push(record)), complete);
  assert.deepEqual(seen, [primary]);
});

test("an incomplete or failed analysis preserves the primary callback and rejects completion", async () => {
  const first = '{"primary":{"result":1}}\n';
  for (const [tail, error] of [["", /connection closed/], ['{"ok":false,"error":"Planner failed"}\n', /Planner failed/]]) {
    const seen = [];
    await assert.rejects(readAnalysisResponse(streamedResponse(first + tail), (record) => seen.push(record)), error);
    assert.deepEqual(seen, [{ result: 1 }]);
  }
});
