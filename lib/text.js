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

/** Jaccard similarity over term sets; 0 when either side is empty. Dream uses
 * it as the human-review candidate threshold; write-time merging reuses the
 * same measure with a higher bar so automatic merges stay conservative. */
export function similarity(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const term of small) if (large.has(term)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

/** Canonical key form for merge matching: lowercase letters and digits only.
 * Callers enforce a minimum length so short keys never merge spuriously. */
export function canonicalKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
