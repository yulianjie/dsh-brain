// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';

export const CONTEXT_NAME = 'brain:long-term-reference';
const RETIRED = 'Brain reference moved to the current Brain snapshot.';
export const createContextMessage = text => ({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: text || 'Brain reference disabled.' }],
  source: { kind: CONTEXT_NAME, form: 'snapshot', sections: text ? [{ name: CONTEXT_NAME, text }] : [] } });

/** Use the host's durable single-node replacement contract, never mutate messages.
 * Other plugins' runtime sections and the human transcript remain intact.
 * Current Desktop rc.3 exposes eventAt for reading exact surface positions.
 */
export function updateContext(session, text, tokenMeter) {
  if (!session?.surface?.nodes || typeof session.eventAt !== 'function' || typeof session.append !== 'function') {
    throw new Error('Brain context requires the Desktop session surface API.');
  }
  // The agent/request hook runs BEFORE the loop writes its initial system head.
  // Queue the first reference through pre-step instead; never precede that head.
  if (session.surface.nodes.length === 0) return { changed: false, retired: 0, deferred: true };
  if (session.eventAt(session.surface.nodes[0])?.type !== 'system/message') throw new Error('Brain context requires a protected first system message.');
  const replace = (seq, original, replacement) => {
    if (tokenMeter) session.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: tokenMeter.estimateMessage(original) });
    session.append('user/message', replacement, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] });
  };
  let current;
  let retired = 0;
  for (const seq of [...session.surface.nodes]) {
    const event = session.eventAt(seq);
    if (event?.type !== 'user/message') continue;
    const original = session.deriveEventMessage(event);
    if (original?.source?.kind === CONTEXT_NAME) {
      if (current) {
        replace(current.seq, current.original, { ...createContextMessage(''), source: { kind: 'brain:retired-context' }, content: [{ type: 'text', text: RETIRED }] });
        retired++;
      }
      current = { seq, original }; continue;
    }
    // Migrate only our named contribution from old shared runtime snapshots.
    const source = original?.source;
    if (source?.kind !== 'runtime-context' || source.form !== 'snapshot' || !Array.isArray(source.sections)
      || original.content.length !== 1 || original.content[0].type !== 'text'
      || !source.sections.every(section => typeof section.name === 'string' && typeof section.text === 'string')
      || !source.sections.some(section => section.name === CONTEXT_NAME)) continue;
    const sections = source.sections.filter(section => section.name !== CONTEXT_NAME);
    const replacement = { ...original, id: randomUUID(), source: { ...source, kind: 'brain:retired-context', sections },
      content: [{ type: 'text', text: sections.length ? 'Historical runtime context:\n\n' + sections.map(s => s.text).join('\n\n') : RETIRED }] };
    replace(seq, original, replacement);
    retired++;
  }
  const next = createContextMessage(text);
  if (current && current.original.content.length === 1 && current.original.content[0].text === next.content[0].text) return { changed: false, retired };
  if (!current && !text) return { changed: false, retired };
  if (current) replace(current.seq, current.original, next);
  else session.append('user/message', next, { surfaceOp: 'append' });
  return { changed: true, retired };
}
