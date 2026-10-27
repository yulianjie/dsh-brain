// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
// Portable estimate, not a model tokenizer. Character limits remain authoritative.
export function estimateTokens(text) {
  let ascii = 0, other = 0;
  for (const point of String(text)) {
    if (point.codePointAt(0) < 128) ascii++;
    else other += Buffer.byteLength(point, 'utf8') / 2;
  }
  return Math.ceil(ascii / 3 + other);
}

export const fitsBudget = (text, chars, tokens) => text.length <= chars && estimateTokens(text) <= tokens;

/** Find a Unicode-safe prefix whose fully serialized envelope fits both limits. */
export function fitText(text, render, chars, tokens) {
  if (fitsBudget(render(text), chars, tokens)) return text;
  const points = Array.from(text);
  let low = 0, high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fitsBudget(render(points.slice(0, mid).join('')), chars, tokens)) low = mid;
    else high = mid - 1;
  }
  return points.slice(0, low).join('');
}
