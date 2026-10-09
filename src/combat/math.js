export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function rollPercent(rng, chance, label = "rollPercent") {
  const roll = rng(label);
  const success = roll * 100 < chance;
  annotateRng(rng, label, {
    kind: "percent",
    chance: roundTraceNumber(chance),
    threshold: roundTraceNumber(Number(chance) / 100),
    success,
  });
  return success;
}

export function rollStacks(rng, chance, label = "rollStacks") {
  if (chance <= 0) return 0;
  const guaranteed = Math.floor(chance / 100);
  const fractionalChance = chance % 100;
  const fractionalSuccess = rollPercent(rng, fractionalChance, `${label}.fractional`);
  const stacks = guaranteed + (fractionalSuccess ? 1 : 0);
  annotateRng(rng, `${label}.fractional`, {
    totalChance: roundTraceNumber(chance),
    guaranteedStacks: guaranteed,
    fractionalChance: roundTraceNumber(fractionalChance),
    stacks,
  });
  return stacks;
}

export function rollMultistrikeHitCount(rng, chance, label = "multiStrike") {
  if (chance <= 0) return 1;
  const fullHundreds = Math.floor(chance / 100);
  const minimumExtras = chance >= 100 ? 1 : 0;
  let extras = 0;
  if (fullHundreds > 0) {
    const rangeLabel = `${label}.guaranteedRange`;
    const roll = rng(rangeLabel);
    extras = Math.floor(roll * (fullHundreds - minimumExtras + 1)) + minimumExtras;
    annotateRng(rng, rangeLabel, {
      kind: "integerRange",
      min: minimumExtras,
      max: fullHundreds,
      result: extras,
    });
  }
  if (rollPercent(rng, chance % 100, `${label}.fractional`)) extras += 1;
  return 1 + extras;
}

export function randomBetween(rng, min, max, label = "randomBetween") {
  const roll = rng(label);
  const result = min + (max - min) * roll;
  annotateRng(rng, label, {
    kind: "range",
    min: roundTraceNumber(min),
    max: roundTraceNumber(max),
    result: roundTraceNumber(result),
  });
  return result;
}

function annotateRng(rng, label, metadata) {
  if (typeof rng?.annotateLast !== "function") return;
  rng.annotateLast(label, metadata);
}

function roundTraceNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number;
  return Math.round(number * 1e9) / 1e9;
}

export function confidenceInterval95(rate, trials) {
  if (trials <= 0) return { lower: 0, upper: 0, halfWidth: 0 };
  const z = 1.96;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (rate + z2 / (2 * trials)) / denominator;
  const halfWidth = z * Math.sqrt((rate * (1 - rate) + z2 / (4 * trials)) / trials) / denominator;
  return {
    lower: clamp(center - halfWidth, 0, 1),
    upper: clamp(center + halfWidth, 0, 1),
    halfWidth,
  };
}

export function percentile(sortedValues, probability) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(probability * (sortedValues.length - 1))));
  return sortedValues[index] ?? 0;
}
