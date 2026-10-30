// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
/** Shared, dependency-free text normalization for ranking, grouping and fidelity checks. */
export function normalized(text) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function terms(value) {
  const normalizedValue = normalized(value);
  const words = normalizedValue.match(/[a-z0-9_]+/g) ?? [];
  for (const match of normalizedValue.matchAll(/[\p{Script=Han}]+/gu)) {
    const chars = [...match[0]];
    if (chars.length === 1) words.push(chars[0]);
    for (let i = 0; i < chars.length - 1; i++) words.push(chars[i] + chars[i + 1]);
  }
  return [...new Set(words)];
}
