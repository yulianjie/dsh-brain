import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-fallback-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { brain: await new Brain({ dataDir }).init() };
}

const ORDINARY = [
  '两个问题都详细回答一下。',
  'Could you give me a detailed explanation of closures?',
  '这两种写法都详细解释一下。',
  'I want detailed logs for debugging.',
  '每个步骤都详细说明一下。',
  'Can you give me a detailed comparison of the two libraries?',
];
const empty = { memories: [], feedback: [] };
const evidence = async (brain, trait) => (await brain.exportData()).personality.evidence[trait];

test('model success on ordinary requests learns no local style drift', async t => {
  const { brain } = await fixture(t);
  for (const [turn, userText] of ORDINARY.entries()) {
    await brain.learn({ sessionId: 'fallback-ordinary', turnId: String(turn), userText, extraction: empty });
  }
  const personality = await brain.personality();
  assert.deepEqual((await brain.exportData()).personality.evidence.verbosity, []);
  assert.equal(personality.traits.verbosity, 0.5);
  assert.deepEqual(await brain.list(), []);
});

test('model unavailability keeps the local fallback for explicit style requests', async t => {
  const { brain } = await fixture(t);
  for (const [turn, userText] of ['以后回答简短一点。', '以后回答详细一点。', '请少开玩笑。'].entries()) {
    await brain.learn({ sessionId: 'fallback-unavailable', turnId: String(turn), userText });
  }
  assert.ok((await evidence(brain, 'verbosity')).length >= 1);
  assert.ok((await evidence(brain, 'humor')).length >= 1);
});

test('an empty model result suppresses a real style request that local rules would read', async t => {
  const { brain } = await fixture(t);
  await brain.learn({ sessionId: 'fallback-empty', turnId: '1', userText: '以后回答简短一点。', extraction: empty });
  assert.deepEqual(await evidence(brain, 'verbosity'), []);

  const other = (await fixture(t)).brain;
  await other.learn({ sessionId: 'fallback-empty', turnId: '1', userText: '以后回答简短一点。' });
  const local = await evidence(other, 'verbosity');
  assert.equal(local.length, 1);
  assert.ok(local[0].value < 0.5);
});

test('a model-missed style sentence cannot overwrite the remembered preference', async t => {
  const { brain } = await fixture(t);
  await brain.learn({ sessionId: 'fallback-overwrite', turnId: '1', userText: '以后回答简短一点。', extraction: { memories: [], feedback: [{ trait: 'verbosity', value: 0.2, confidence: 0.9, evidence: '以后回答简短一点。' }] } });
  await brain.learn({ sessionId: 'fallback-overwrite', turnId: '2', userText: '两个问题都详细回答一下。', extraction: empty });
  assert.equal((await brain.list()).some(record => record.text === '两个问题都详细回答一下。'), false);
  const verbosity = await evidence(brain, 'verbosity');
  assert.equal(verbosity.length, 1);
  assert.equal(verbosity[0].evidence, '以后回答简短一点。');
});

test('model style feedback is still recorded', async t => {
  const { brain } = await fixture(t);
  await brain.learn({ sessionId: 'fallback-model-style', turnId: '1', userText: '以后回答简短一点。', extraction: { memories: [], feedback: [{ trait: 'verbosity', value: 0.2, confidence: 0.9, evidence: '以后回答简短一点。' }] } });
  const verbosity = await evidence(brain, 'verbosity');
  assert.equal(verbosity.length, 1);
  assert.ok(verbosity[0].value < 0.5);
});

test('explicit 请记住 memories still merge when the model returns nothing', async t => {
  const { brain } = await fixture(t);
  await brain.learn({ sessionId: 'fallback-explicit', turnId: '1', userText: '请记住：我喜欢中文回答。', extraction: empty });
  const records = await brain.list();
  assert.equal(records.length, 1);
  assert.ok(records[0].text.includes('我喜欢中文回答'));
});

test('local style evidence does not hide a fact the model already explained', async t => {
  const { brain } = await fixture(t);
  const userText = '以后回答简短一点，另外我用 Windows。';
  await brain.learn({
    sessionId: 'fallback-shared-sentence',
    turnId: '1',
    userText,
    extraction: {
      memories: [{ text: '我用 Windows', kind: 'fact', scope: 'global', confidence: 0.9, evidence: '我用 Windows' }],
      feedback: [{ trait: 'verbosity', value: 0.2, confidence: 0.9, evidence: '以后回答简短一点' }],
    },
  });
  assert.ok(brain.context({ query: 'Windows' }).includes('我用 Windows'));
  const verbosity = await evidence(brain, 'verbosity');
  assert.equal(verbosity.length, 1);
  assert.ok(verbosity[0].value < 0.5);
});
