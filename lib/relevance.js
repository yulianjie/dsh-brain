// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
/** Relevance selection for automatic context injection. Pure: no IO.
 *
 * BM25 with binary term frequency over the shared `lib/text.js` terms. Only
 * the current turn makes a memory a candidate and sets the relevance floor; the
 * previous user turns add to the order and corroborate weak matches but never
 * add a memory on their own. Incumbents survive contentless turns; on a
 * contentful turn they need current-topic evidence or a link through recent
 * history when no strong current match displaces them. Weak incumbents use up
 * weak slots.
 * The constants were calibrated on synthetic corpora. */
import { normalized, terms } from './text.js';

/** BM25 term-frequency saturation and length normalization. */
export const K1 = 1.2;
export const B = 0.75;
/** History terms count half as much as terms of the current turn. */
export const HISTORY_WEIGHT = 0.5;
/** Below this many indexed memories every match counts as strong. */
export const SMALL_STORE = 20;
/** A term found in at most max(2, min(WEAK_MAX, 5% of memories)) memories is
 * specific enough alone, so one concept adds at most three memories. */
export const SPECIFIC_RATIO = 0.05;
/** Candidates whose current-turn score is below this fraction of the best are dropped. */
export const REL_FLOOR = 0.35;
/** At most this many weak matches, counting weak incumbents. */
export const WEAK_MAX = 3;

/** Filler words, acknowledgements, option picks and generic question words
 * that never identify a topic. */
export const STOPWORDS = new Set([
  '这个', '那个', '一下', '什么', '怎么', '为什', '么样', '可以', '我们', '你们', '他们', '就是', '现在', '然后', '因为', '所以', '如果', '没有', '不是', '还是', '已经', '一个', '这样', '那样', '帮我', '看看', '一点', '的话', '好的', '继续', '是不', '这里', '那里', '还有', '或者', '而且', '但是', '不要', '需要', '应该', '能不', '不能', '一些', '有点', '东西', '时候', '怎样', '如何', '吗', '吧', '呢', '啊', '嗯', '哦', '的', '了', '是', '在', '和', '也', '都', '就', '要', '把', '被', '让', '给',
  '收到', '明白', '谢谢', '感谢', '多谢', '没问', '问题', '没错', '同意', '确认', '搞定', '完美', '不错', '很好', '选项', '方案', '第一', '第二', '第三', '下一', '一步', '开始', '接着', '试试', '先这', '再来', '有没', '要不', '会不', '不会', '可不',
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'he', 'she', 'they', 'me', 'my', 'your', 'our', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'please', 'how', 'what', 'why', 'when', 'where', 'which', 'who', 'not', 'no', 'yes', 'ok', 'okay', 'so', 'if', 'then', 'there', 'here', 'just', 'also', 'up', 'out', 'about', 'into', 'than', 'too', 'very', 'have', 'has', 'had', 'let', 'lets', 'continue', 'go',
  'thanks', 'thank', 'thx', 'ty', 'great', 'good', 'nice', 'cool', 'sure', 'yep', 'yeah', 'yup', 'next', 'done', 'fine', 'perfect', 'alright', 'right', 'correct', 'agreed', 'agree', 'option', 'first', 'second', 'third', 'sounds', 'looks', 'ahead', 'proceed', 'lgtm', 'np', 'again', 'got',
]);
/** A Han term containing a particle straddles a word boundary (好的继续 → 的继). */
const PARTICLE = /[的了吗吧呢啊嗯哦]/u;
/** Ignored in the index and in queries alike; 1–2 digit numbers are option picks (2, 选 2). */
const ignored = term => STOPWORDS.has(term) || PARTICLE.test(term) || /^\d{1,2}$/.test(term);
/** Unique kept terms in first-seen order (`terms()` already dedupes). */
const indexTerms = text => terms(normalized(text)).filter(term => !ignored(term));

/** Query units in order: an ASCII word or a lone Han char is one unit; a Han
 * run of two or more chars is its bigram sequence, with ignored bigrams kept as
 * `null` so they still break adjacency. */
export function queryUnits(text) {
  const value = normalized(String(text));
  const units = [];
  for (const match of value.matchAll(/[a-z0-9_]+/g)) if (!ignored(match[0])) units.push({ run: false, terms: [match[0]] });
  for (const match of value.matchAll(/[\p{Script=Han}]+/gu)) {
    const chars = [...match[0]];
    if (chars.length === 1) { if (!ignored(chars[0])) units.push({ run: false, terms: [chars[0]] }); continue; }
    const bigrams = [];
    for (let i = 0; i < chars.length - 1; i++) { const term = chars[i] + chars[i + 1]; bigrams.push(ignored(term) ? null : term); }
    units.push({ run: true, terms: bigrams });
  }
  return units;
}

/** Index eligible records `{ id, text, key?, updatedAt }` once; scoring then
 * visits only the postings of the query terms. A term's document frequency is
 * the length of its posting list: each record appears in it at most once. */
export function buildRelevanceIndex(records) {
  const list = Array.from(records ?? []);
  const postings = new Map(), sizes = list.map((record, position) => {
    const unique = indexTerms(`${record.text} ${record.key ?? ''}`);
    for (const term of unique) {
      const posting = postings.get(term);
      if (posting) posting.push(position); else postings.set(term, [position]);
    }
    return unique.length;
  });
  const N = list.length;
  const avg = Math.max(1, N ? sizes.reduce((sum, size) => sum + size, 0) / N : 0);
  const norms = sizes.map(size => (K1 + 1) / (1 + K1 * (1 - B + B * size / avg)));
  const positions = new Map(list.map((record, position) => [record.id, position]));
  return { records: list, postings, sizes, N, avg, norms, positions };
}

/** Records in priority order: strong candidates, then incumbents, then the weak
 * slots incumbents left free. The caller applies count and budget. */
export function selectRelevant(index, { query = '', history = [], keep = [] } = {}) {
  const { records, postings, N, norms, positions } = index;
  const df = term => postings.get(term).length;
  const idf = term => Math.log(1 + (N - df(term) + 0.5) / (df(term) + 0.5));
  // Unindexed terms become gaps too: they cannot be matched by any memory.
  const rawUnits = typeof query === 'string' ? queryUnits(query) : [];
  const hasCurrentEvidence = rawUnits.some(unit => unit.terms.some(Boolean));
  const units = rawUnits.map(unit => ({ run: unit.run, terms: unit.terms.map(term => term && postings.has(term) ? term : null) }));
  const cur = [...new Set(units.flatMap(unit => unit.terms).filter(Boolean))];
  const current = new Set(cur), hist = [], seen = new Set();
  for (const text of Array.isArray(history) ? history : []) {
    if (typeof text !== 'string') continue;
    for (const term of indexTerms(text)) if (postings.has(term) && !current.has(term) && !seen.has(term)) { seen.add(term); hist.push(term); }
  }
  const entries = new Map();
  const entry = position => {
    let value = entries.get(position);
    if (!value) entries.set(position, value = { position, record: records[position], cur: 0, hist: 0, matched: new Set(), historyTerms: new Set(), specific: false, corroborated: false });
    return value;
  };
  const specificDf = Math.max(2, Math.min(WEAK_MAX, SPECIFIC_RATIO * N));
  for (const term of cur) {
    const weight = idf(term), specific = df(term) <= specificDf;
    for (const position of postings.get(term)) {
      const value = entry(position);
      value.cur += weight * norms[position];
      value.matched.add(term);
      if (specific) value.specific = true;
    }
  }
  const incumbents = new Set();
  for (const id of Array.isArray(keep) ? keep : []) {
    const position = typeof id === 'string' ? positions.get(id) : undefined;
    if (position !== undefined) { incumbents.add(position); entry(position); }
  }
  // History only scores records that are already candidates or incumbents.
  for (const term of hist) {
    const weight = idf(term);
    for (const position of postings.get(term)) {
      const value = entries.get(position);
      if (value) { value.hist += weight * norms[position]; value.corroborated = true; value.historyTerms.add(term); }
    }
  }
  // Independent evidence: a matched word or lone char counts once per distinct
  // term; within a Han run each maximal stretch of adjacent matched bigrams
  // counts once, and only if it adds a term not counted before. So the
  // overlapping bigrams of one word (数据/据库) are one match, and a word
  // repeated in the query is still one match.
  const independent = matched => {
    let count = 0;
    const counted = new Set();
    for (const unit of units) {
      if (!unit.run) {
        const term = unit.terms[0];
        if (term && matched.has(term) && !counted.has(term)) { count++; counted.add(term); }
        continue;
      }
      let stretch = [];
      for (const term of [...unit.terms, null]) {
        if (term && matched.has(term)) { stretch.push(term); continue; }
        if (!stretch.length) continue;
        if (stretch.some(seen => !counted.has(seen))) count++;
        for (const seen of stretch) counted.add(seen);
        stretch = [];
      }
    }
    return count;
  };
  const strong = [], weak = [];
  for (const value of entries.values()) {
    value.total = value.cur + HISTORY_WEIGHT * value.hist;
    if (!value.matched.size) continue;
    if (N < SMALL_STORE || value.specific || independent(value.matched) >= 2) strong.push(value);
    else {
      if (!hist.length || value.corroborated) weak.push(value);
    }
  }
  // The floor compares current-turn scores only, so history cannot raise the bar.
  const top = [...strong, ...weak].reduce((best, value) => Math.max(best, value.cur), 0);
  const kept = value => value.cur >= REL_FLOOR * top;
  const order = (a, b) => b.total - a.total || b.record.updatedAt.localeCompare(a.record.updatedAt) || a.record.id.localeCompare(b.record.id);
  const first = strong.filter(kept).sort(order);
  if (hasCurrentEvidence) {
    // A history-only incumbent may bridge a weak continuation only when a
    // current candidate shares recent history evidence with it. Strong current
    // matches signal a topic switch and displace all history-only references.
    const linkedHistory = new Set();
    for (const value of entries.values()) {
      if (value.matched.size && kept(value)) for (const term of value.historyTerms) linkedHistory.add(term);
    }
    for (const position of incumbents) {
      const value = entries.get(position);
      if (value?.matched.size) {
        if (!kept(value)) incumbents.delete(position);
      } else if (first.length || ![...(value?.historyTerms ?? [])].some(term => linkedHistory.has(term))) {
        incumbents.delete(position);
      }
    }
  }
  const weakIncumbents = weak.reduce((count, value) => count + Number(incumbents.has(value.position)), 0);
  const shown = new Set(first.map(value => value.position));
  const second = [...incumbents].filter(position => !shown.has(position)).map(position => entries.get(position)).sort(order);
  const third = weak.filter(value => kept(value) && !incumbents.has(value.position)).sort(order).slice(0, Math.max(0, WEAK_MAX - weakIncumbents));
  return [...first, ...second, ...third].map(value => value.record);
}
