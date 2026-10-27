import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createIntegration } from '../lib/index.js';
import { updateContext, createContextMessage } from '../lib/context.js';

test('request preparation cannot prepend a reference before the protected system head', () => {
  let writes = 0;
  const session = { surface: { nodes: [] }, eventAt() {}, append() { writes++; } };
  assert.equal(updateContext(session, 'reference').deferred, true);
  assert.equal(writes, 0);
  session.surface.nodes.push(0);
  session.eventAt = () => ({ type: 'user/message' });
  assert.throws(() => updateContext(session, 'reference'), /protected first system/);
  assert.equal(writes, 0);
});

test('first reference is queued through pre-step and rejected steps never inject', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'brain-context-order-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const handlers = new Map();
  const session = { header: { cwd: dataDir }, surface: { nodes: [] }, eventAt() {}, append() { throw Error('must not append before system head'); } };
  const agent = { session };
  const ctx = { agents: { roots: () => [agent] }, workingDirectory: { get: () => dataDir }, llm: {},
    tools: { register() {} }, commands: { register() {} }, on(name, callback) { handlers.set(name, callback); }, effect() {} };
  const handle = await createIntegration(ctx, { dataDir });
  t.after(() => handle.learner.close());
  const input = { agent, signal: new AbortController().signal };
  const human = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] };
  const decision = await handlers.get('agent/pre-step')(input, async () => ({ kind: 'enter', messages: [human] }));
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[0], human);
  assert.equal(decision.messages[1].source.kind, 'brain:long-term-reference');
  assert.deepEqual(await handlers.get('agent/request')(input, async () => ({ model: 'synthetic' })), { model: 'synthetic' });
  const rejected = { kind: 'reject' };
  assert.equal(await handlers.get('agent/pre-step')(input, async () => rejected), rejected);
  session.surface.nodes.push(0);
  const existing = { kind: 'enter', messages: [human] };
  assert.equal(await handlers.get('agent/pre-step')(input, async () => existing), existing);
  assert.equal(createContextMessage('{{literal}}').content[0].text, '{{literal}}');
});
