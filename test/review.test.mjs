import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '../lib/core.js';
import { BackgroundLearner, createIntegration } from '../lib/index.js';
import { extractExplicitPreferences, validateExtraction } from '../lib/extraction.js';

test('explicit feedback cannot authorize a different model-invented trait', () => {
  const userText = '以后回答简洁一点。';
  const result = validateExtraction({ userText, extraction: { feedback: [{ trait: 'warmth', value: 0.9, confidence: 1, evidence: userText }] } });
  assert.equal(result.feedback.length, 0);
});

test('quoted, fenced, example and hypothetical preferences do not become feedback', () => {
  for (const userText of ["'Please keep replies concise.'", '示例代码：\n```text\nPlease keep replies concise.\n```', '例如：请以后回答简洁一点。', '如果我说请以后回答简洁一点，你会怎样？']) {
    assert.equal(extractExplicitPreferences(userText).feedback.length, 0, userText);
    const evidence = userText.includes('Please') ? 'Please keep replies concise.' : '请以后回答简洁一点';
    assert.equal(validateExtraction({ userText, extraction: { feedback: [{ trait: 'verbosity', value: 0.1, confidence: 1, evidence }] } }).feedback.length, 0, userText);
  }
});

test('a current-statement opt-out overrides model-selected memory evidence', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-brain-review-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  await brain.learn({ sessionId: 'review-opt-out', turnId: '1', userText: '不要记住这件事：我喜欢乌龙茶', extraction: { memories: [{ text: '我喜欢乌龙茶', evidence: '我喜欢乌龙茶', kind: 'preference', scope: 'global', confidence: 1 }] } });
  assert.equal((await brain.list()).length, 0);
  // This is a statement-scoped opt-out, not a permanent learning mode.
  await brain.learn({ sessionId: 'review-opt-out', turnId: '2', userText: '请记住我喜欢红茶。' });
  assert.equal((await brain.list()).length, 1);
});

test('model-selected style excerpts cannot bypass gradual personality through memory context', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-brain-review-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  await brain.learn({ sessionId: 'review-style-excerpt', turnId: '1', userText: '以后回答简洁一点。', extraction: { memories: [{ text: '简洁一点', evidence: '简洁一点', kind: 'preference', scope: 'global', confidence: 1 }] } });
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
  assert.ok(!brain.context({ query: '简洁' }).includes('简洁一点'));
});

test('a frozen turn finishing extraction after unfreeze cannot accumulate style drift', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-brain-review-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const userText = '以后回答简洁一点。';
  const payload = JSON.stringify({ feedback: [{ trait: 'verbosity', value: 0.1, confidence: 1, evidence: userText }] });
  const events = new Map(), commands = new Map();
  const session = { id: 'review-freeze', header: { cwd: dataDir }, requestHeader: () => ({ config: { provider: 'synthetic', model: 'synthetic' } }) };
  const agent = { session };
  const ctx = {
    systemPrompt: { context() {} }, tools: { register() {} },
    commands: { register(command) { commands.set(command.name, command); } },
    agents: { roots: () => [agent], get: () => agent }, workingDirectory: { get: () => dataDir },
    llm: { async *stream() { await gate; yield { type: 'text-delta', index: 0, text: payload }; yield { type: 'finish', reason: { kind: 'stop' } }; } },
    on(name, callback) { events.set(name, callback); }, effect() {}, logger: { warn() {} },
  };
  const handle = await createIntegration(ctx, { dataDir });
  t.after(() => handle.learner.close());
  const command = rawInput => commands.get('brain').handler({ agent, rawInput });
  assert.equal((await command('freeze')).kind, 'success');
  events.get('agent/inbox/claimed')({ agent, turn: 1, message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: userText }] } });
  events.get('session/event')(session, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal((await command('unfreeze')).kind, 'success');
  release();
  await handle.learner.flush();
  assert.equal((await handle.brain.personality()).evidenceCounts.verbosity, 0);
});

test('enqueue at the drain completion boundary cannot strand a background job', async () => {
  const learned = [];
  let learner;
  learner = new BackgroundLearner({
    brain: { learn(job) {
      learned.push(job.turnId);
      return Promise.resolve().then(() => {
        if (job.turnId === '1') queueMicrotask(() => queueMicrotask(() => learner.enqueue({ sessionId: 'review-boundary', turnId: '2' })));
        return { rejected: 0 };
      });
    } },
    llm: {}, config: { extractionMaxQueue: 16, extractionTimeoutMs: 100 },
  });
  try {
    learner.enqueue({ sessionId: 'review-boundary', turnId: '1' });
    await learner.flush();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(learned, ['1', '2']);
    assert.equal(learner.queue.length, 0);
  } finally { await learner.close(); }
});
