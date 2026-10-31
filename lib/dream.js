// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
/** Read-only dream planning: candidate grouping, bounded payloads and fail-closed validation. */
import { createHash } from 'node:crypto';
import { TRAITS, containsCredential } from './extraction.js';
import { normalized, terms, similarity } from './text.js';

export const INDEX_LINE_MAX = 60;
const MAX_GROUP_IDS = 20;
const MAX_PAIR_COMPARISONS = 200000;
const MAX_NOVEL_BIGRAMS = 0;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

const idOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const safeLimit = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const textHash = text => createHash('sha256').update(normalized(String(text ?? ''))).digest('hex');

// Date.parse normalizes the same instant even when the ISO format differs
// (Z vs .000Z). Unparseable values fall back to a stable string key.
const timeKey = record => {
  const raw = record?.updatedAt;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return { numeric: true, value: parsed };
  }
  return { numeric: false, value: String(raw ?? '') };
};
const timeEqual = (left, right) => left.numeric === right.numeric && left.value === right.value;
const timeLater = (left, right) => left.numeric !== right.numeric
  ? (left.numeric ? 1 : -1)
  : left.value > right.value ? 1 : left.value < right.value ? -1 : 0;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pointLength(value) {
  return Array.from(value).length;
}

function truncatePoints(value, max) {
  const points = Array.from(String(value ?? ''));
  return points.length <= max ? points.join('') : points.slice(0, max).join('');
}

function newestRecord(ids, records) {
  let newest = records.get(ids[0]);
  for (const id of ids) {
    const record = records.get(id);
    if (timeLater(timeKey(record), timeKey(newest)) > 0) newest = record;
  }
  return newest;
}

function newestTime(ids, records) {
  let newest = timeKey(records.get(ids[0]));
  for (const id of ids) {
    const current = timeKey(records.get(id));
    if (timeLater(current, newest) > 0) newest = current;
  }
  return newest;
}

/** Split sorted ids into deterministic chunks of 2..20; a 1-id tail is folded into its predecessor. */
function splitGroup(ids, make) {
  const chunks = [];
  let index = 0;
  while (ids.length - index > MAX_GROUP_IDS) {
    let size = MAX_GROUP_IDS;
    if (ids.length - index - size === 1) size--;
    chunks.push(ids.slice(index, index + size));
    index += size;
  }
  if (index < ids.length) chunks.push(ids.slice(index));
  return chunks.filter(chunk => chunk.length >= 2).map(make);
}

/** One line, whitespace-collapsed, at most `max` code points, never splitting a surrogate pair. */
export function renderIndexLine(memory, { max = INDEX_LINE_MAX } = {}) {
  const limit = safeLimit(max, INDEX_LINE_MAX);
  const source = typeof memory === 'string' ? memory : memory?.text;
  const text = String(source ?? '').replace(/\s+/g, ' ').trim();
  return truncatePoints(text, limit);
}

function collectGroups(memories, { threshold = 0.6, maxGroups = 50 } = {}) {
  const limit = safeLimit(maxGroups, 50);
  const cutoff = Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : 0.6;
  const records = [];
  const seenIds = new Set();
  for (const record of Array.isArray(memories) ? memories : []) {
    if (!record || typeof record.id !== 'string' || !record.id || seenIds.has(record.id)) continue;
    seenIds.add(record.id);
    records.push(record);
  }
  const buckets = new Map();
  for (const record of records) {
    const bucketKey = `${record.scope}\u0000${record.workspace ?? ''}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { scope: record.scope, workspace: record.workspace, records: [] });
    buckets.get(bucketKey).records.push(record);
  }
  const groups = [];
  let truncated = false;
  for (const bucket of buckets.values()) {
    const used = new Set();
    const byKey = new Map();
    for (const record of bucket.records) {
      if (typeof record.key !== 'string' || !record.key) continue;
      if (!byKey.has(record.key)) byKey.set(record.key, []);
      byKey.get(record.key).push(record);
    }
    for (const [key, members] of byKey) {
      if (members.length < 2) continue;
      for (const member of members) used.add(member.id);
      splitGroup(members.map(member => member.id).sort(idOrder), ids => groups.push({ key, scope: bucket.scope, workspace: bucket.workspace, ids, reason: 'key' }));
    }
    const remaining = bucket.records.filter(record => !used.has(record.id));
    if (remaining.length < 2) continue;

    // Exact normalized duplicates are grouped in linear time before any pairwise work.
    const byText = new Map();
    for (const record of remaining) {
      const hash = textHash(record.text);
      if (!byText.has(hash)) byText.set(hash, []);
      byText.get(hash).push(record);
    }
    for (const members of byText.values()) {
      if (members.length < 2) continue;
      for (const member of members) used.add(member.id);
      splitGroup(members.map(member => member.id).sort(idOrder), ids => groups.push({ key: null, scope: bucket.scope, workspace: bucket.workspace, ids, reason: 'similarity' }));
    }

    const rest = remaining.filter(record => !used.has(record.id));
    if (rest.length < 2) continue;
    const termSets = rest.map(record => new Set(terms(String(record.text ?? ''))));
    const parent = rest.map((_, index) => index);
    const find = index => {
      let root = index;
      while (parent[root] !== root) root = parent[root];
      while (parent[index] !== root) { const next = parent[index]; parent[index] = root; index = next; }
      return root;
    };
    const union = (left, right) => {
      const a = find(left), b = find(right);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    };
    // Inverted index: only pairs sharing at least one term are compared, and the
    // global comparison budget bounds the work for adversarially broad indexes.
    const postings = new Map();
    let comparisons = 0;
    search: for (let i = 0; i < rest.length; i++) {
      const seen = new Set();
      for (const term of termSets[i]) {
        const posting = postings.get(term);
        if (!posting) continue;
        for (const j of posting) {
          if (seen.has(j)) continue;
          seen.add(j);
          if (comparisons >= MAX_PAIR_COMPARISONS) { truncated = true; break search; }
          comparisons++;
          if (similarity(termSets[i], termSets[j]) >= cutoff) union(i, j);
        }
      }
      for (const term of termSets[i]) {
        if (!postings.has(term)) postings.set(term, []);
        postings.get(term).push(i);
      }
    }
    const components = new Map();
    for (let index = 0; index < rest.length; index++) {
      const root = find(index);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(rest[index].id);
    }
    for (const ids of components.values()) {
      if (ids.length < 2) continue;
      splitGroup(ids.sort(idOrder), chunk => groups.push({ key: null, scope: bucket.scope, workspace: bucket.workspace, ids: chunk, reason: 'similarity' }));
    }
  }
  groups.sort((a, b) => b.ids.length - a.ids.length || idOrder(a.ids[0], b.ids[0]));
  return { groups: groups.slice(0, limit), truncated };
}

export function groupCandidates(memories, options = {}) {
  return collectGroups(memories, options).groups;
}

/** Compact, bounded model input. Only memories referenced by the included groups are sent. */
export function dreamPayload(groups, memories, { maxGroups = 50, maxMemories = 200 } = {}) {
  const groupLimit = safeLimit(maxGroups, 50);
  const memoryLimit = safeLimit(maxMemories, 200);
  const records = new Map();
  for (const record of Array.isArray(memories) ? memories : []) {
    if (record && typeof record.id === 'string' && !records.has(record.id)) records.set(record.id, record);
  }
  const included = new Set();
  const selectedGroups = [];
  const selectedMemories = [];
  for (const group of (Array.isArray(groups) ? groups : []).slice(0, groupLimit)) {
    const ids = Array.isArray(group?.ids) ? [...new Set(group.ids.filter(id => typeof id === 'string'))] : [];
    const fresh = ids.filter(id => records.has(id) && !included.has(id));
    if (included.size + fresh.length > memoryLimit) break;
    const firstId = ids.find(id => records.has(id));
    const hint = typeof group?.key === 'string' && group.key
      ? group.key
      : firstId ? truncatePoints(records.get(firstId).text ?? '', 40) : '';
    selectedGroups.push({ ids, hint });
    for (const id of fresh) {
      included.add(id);
      const record = records.get(id);
      const full = String(record.text ?? '');
      const text = truncatePoints(full, 400);
      selectedMemories.push({ id, text, kind: record.kind, scope: record.scope, updatedAt: record.updatedAt, ...(pointLength(full) > 400 ? { truncated: true } : {}) });
    }
  }
  return { groups: selectedGroups, memories: selectedMemories };
}

function lineIsFaithful(line, corpus) {
  const value = normalized(line);
  const ascii = value.match(/[a-z0-9_]+/g) ?? [];
  if (ascii.some(word => !corpus.has(word))) return false;
  // A ratio threshold let a single swapped word through (三点 -> 四点 still scores
  // 0.82). Every CJK bigram of the index line must therefore exist in the group's
  // own text: the model may delete words, never invent them. Anything else
  // degrades to the extractive index line, which is lossless by construction.
  const novel = new Set();
  for (const match of value.matchAll(/[\p{Script=Han}]+/gu)) {
    const chars = [...match[0]];
    for (let i = 0; i < chars.length - 1; i++) {
      const bigram = chars[i] + chars[i + 1];
      if (!corpus.has(bigram)) novel.add(bigram);
    }
  }
  return novel.size <= MAX_NOVEL_BIGRAMS;
}

/** Fail-closed structural validation; unfaithful index lines degrade instead of throwing. */
export function validateDream(plan, memories, { maxGroups = 50 } = {}) {
  const fail = message => { throw new Error(`Invalid dream plan: ${message}`); };
  if (!Array.isArray(memories)) fail('memories must be an array.');
  const groupLimit = safeLimit(maxGroups, 50);
  const records = new Map();
  for (const record of memories) {
    if (record && typeof record.id === 'string' && !records.has(record.id)) records.set(record.id, record);
  }
  if (!isPlainObject(plan)) fail('plan must be a plain object.');
  for (const key of Object.keys(plan)) {
    if (!['groups', 'contradictions', 'style'].includes(key)) fail(`unexpected field "${key}".`);
  }
  // Models routinely omit empty optional arrays; a missing array means [].
  const inputGroups = plan.groups === undefined ? [] : plan.groups;
  const inputContradictions = plan.contradictions === undefined ? [] : plan.contradictions;
  if (!Array.isArray(inputGroups)) fail('groups must be an array.');
  if (inputGroups.length > groupLimit) fail(`groups exceeds the ${groupLimit}-group limit.`);
  if (!Array.isArray(inputContradictions)) fail('contradictions must be an array.');
  if (inputContradictions.length > memories.length) fail('contradictions exceeds the memory count.');

  const seenIds = new Set();
  const validateIds = (entry, path) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.ids)) fail(`${path}.ids must be an array.`);
    if (entry.ids.length < 2 || entry.ids.length > 20) fail(`${path}.ids must contain 2..20 ids.`);
    const local = new Set();
    for (const id of entry.ids) {
      if (typeof id !== 'string') fail(`${path}.ids must contain strings.`);
      if (local.has(id)) fail(`${path}.ids contains the duplicate id "${id}".`);
      if (!records.has(id)) fail(`${path}.ids references the unknown memory "${id}".`);
      if (seenIds.has(id)) fail(`memory "${id}" appears in more than one entry.`);
      local.add(id);
    }
    const first = records.get(entry.ids[0]);
    for (const id of entry.ids) {
      const record = records.get(id);
      if (record.scope !== first.scope || record.workspace !== first.workspace) fail(`${path}.ids mixes scopes or workspaces.`);
    }
    for (const id of local) seenIds.add(id);
    return local;
  };
  const requireString = (value, path, min, max) => {
    if (typeof value !== 'string' || pointLength(value) < min || pointLength(value) > max) fail(`${path} must be a string of ${min}..${max} code points.`);
    if (CONTROL_CHARACTERS.test(value)) fail(`${path} must not contain control characters.`);
  };

  const groups = [];
  const degraded = [];
  for (const [index, entry] of inputGroups.entries()) {
    const path = `groups[${index}]`;
    validateIds(entry, path);
    requireString(entry.title, `${path}.title`, 1, 40);
    requireString(entry.line, `${path}.line`, 1, 60);
    const drop = entry.drop === undefined ? [] : entry.drop;
    if (!Array.isArray(drop)) fail(`${path}.drop must be an array.`);
    const ids = new Set(entry.ids);
    for (const id of drop) {
      if (typeof id !== 'string' || !ids.has(id)) fail(`${path}.drop must be a subset of ids.`);
    }
    const uniqueDrop = [...new Set(drop)];
    const newest = newestTime(entry.ids, records);
    for (const id of uniqueDrop) {
      if (timeEqual(timeKey(records.get(id)), newest)) fail(`${path}.drop must not remove the most recently updated memory.`);
    }
    let line = entry.line;
    const corpus = new Set(terms(entry.ids.map(id => String(records.get(id).text ?? '')).join(' ')));
    if (!lineIsFaithful(line, corpus)) {
      line = renderIndexLine(newestRecord(entry.ids, records));
      degraded.push({ ids: [...entry.ids], reason: 'unfaithful-line' });
    }
    groups.push({ ids: [...entry.ids], title: entry.title, line, drop: uniqueDrop });
  }

  const contradictions = [];
  for (const [index, entry] of inputContradictions.entries()) {
    const path = `contradictions[${index}]`;
    validateIds(entry, path);
    if (typeof entry.keep !== 'string' || !entry.ids.includes(entry.keep)) fail(`${path}.keep must belong to ids.`);
    if (!timeEqual(timeKey(records.get(entry.keep)), newestTime(entry.ids, records))) fail(`${path}.keep must be the most recently updated memory.`);
    requireString(entry.reason, `${path}.reason`, 1, 200);
    contradictions.push({ ids: [...entry.ids], keep: entry.keep, reason: entry.reason });
  }

  let style;
  if (plan.style !== undefined) {
    if (!isPlainObject(plan.style)) fail('style must be an object.');
    requireString(plan.style.brief, 'style.brief', 1, 600);
    if (!Array.isArray(plan.style.basedOn)) fail('style.basedOn must be an array.');
    if (plan.style.basedOn.some(trait => !TRAITS.includes(trait))) fail('style.basedOn contains an unknown trait.');
    style = { brief: plan.style.brief, basedOn: [...plan.style.basedOn] };
  }

  const visited = new WeakSet();
  const scan = (value, path, depth) => {
    if (depth > 32) fail(`${path} is too deeply nested.`);
    if (typeof value === 'string') {
      if (containsCredential(value)) fail(`${path} contains a credential.`);
      return;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) value.forEach((item, index) => scan(item, `${path}[${index}]`, depth + 1));
    else for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`, depth + 1);
  };
  scan(plan, 'plan', 0);

  return { groups, contradictions, style, degraded };
}

/** Pure read path: no IO, no state mutation. */
export function planDream(memories, { threshold = 0.6, maxGroups = 50 } = {}) {
  const records = Array.isArray(memories) ? memories : [];
  const { groups, truncated } = collectGroups(records, { threshold, maxGroups });
  const payload = dreamPayload(groups, records, { maxGroups });
  const covered = new Set(groups.flatMap(group => group.ids)).size;
  return { groups, payload, stats: { memories: records.length, groups: groups.length, covered, promptChars: JSON.stringify(payload).length, truncated } };
}
