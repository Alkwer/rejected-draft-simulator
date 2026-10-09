import { parseIdList } from "./rewards.js";

export function parseRouteSpecs(value) {
  return String(value ?? "")
    .split(/[|~]/)
    .map((raw, index) => {
      const trimmed = raw.trim();
      const separator = trimmed.indexOf(":");
      if (separator >= 0) {
        return {
          name: trimmed.slice(0, separator).trim() || `route_${index + 1}`,
          ids: parseIdList(trimmed.slice(separator + 1)),
        };
      }
      return {
        name: trimmed || `route_${index + 1}`,
        ids: parseIdList(trimmed),
      };
    })
    .filter((route) => route.name || route.ids.length > 0);
}

export function parseSwapMap(value) {
  const result = {};
  for (const item of parseIdList(value)) {
    const [from, to] = item.split(":").map((part) => part?.trim()).filter(Boolean);
    if (from && to) result[from] = to;
  }
  return result;
}
