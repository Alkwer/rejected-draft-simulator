// The dashboard requests two newline-delimited records. Errors before the
// first result and clients requesting the complete report use ordinary JSON.
export async function readAnalysisResponse(response, onPrimary) {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Analysis failed.");
    return data;
  }
  let buffer = "";
  let complete;
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    const lines = chunk.split("\n");
    for (const line of lines.slice(0, -1)) {
      const record = JSON.parse(buffer + line);
      buffer = "";
      if (record.primary) onPrimary?.(record.primary);
      else if (record.ok && record.analysis) complete = record;
      else throw new Error(record.error ?? "Invalid analysis response.");
    }
    buffer += lines.at(-1);
  }
  if (complete && !buffer) return complete;
  throw new Error("The connection closed before the full analysis arrived. Run the simulation again.");
}
