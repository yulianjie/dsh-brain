import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Brain } from '../lib/core.js';
import { BRIEF_HEADER, styleBrief } from '../lib/style.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-settings-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, brain: await new Brain({ dataDir, ...options }).init() };
}
const feedback = (brain, turn, options = {}) => brain.learn({ sessionId: 'settings-synthetic', turnId: String(turn), userText: '以后回答请简短一点。', ...options });

test('runtime policy and manual overlay never overwrite learned or CLI state across restarts', async t => {
  const { brain, dataDir } = await fixture(t);
  await feedback(brain, 1); await feedback(brain, 2); await feedback(brain, 3);
  await feedback(brain, 4); await feedback(brain, 5); await feedback(brain, 6);
  await brain.setPersonality({ frozen: true });
  const personality = await brain.personality();
  const before = await brain.exportData();
  await brain.configure({ personalityMode: 'manual', manualTraits: { warmth: 0.9, verbosity: 0.8 }, personalityLearningEnabled: false, maxContextChars: 8000, injectMemories: false });
  const manual = brain.context({});
  assert.ok(manual.includes(BRIEF_HEADER + styleBrief({ warmth: 0.9, verbosity: 0.8 })));
  assert.ok(!manual.includes('"mode"'));
  assert.ok(!manual.includes('"traits"'));
  assert.ok(!manual.includes('"warmth"'));
  assert.deepEqual(await brain.exportData(), before);
  await brain.configure({ maxContextChars: 7000 });
  assert.deepEqual(await brain.personality(), personality);
  const restarted = await new Brain({ dataDir, personalityMode: 'adaptive', manualTraits: { warmth: 1 } }).init();
  assert.deepEqual(await restarted.personality(), personality);
  assert.deepEqual(await brain.exportData(), before);
  // The learned value crossed the low band, so a restart must render the *learned*
  // brief, not the neutral one: this is the assertion the band contract can carry.
  assert.ok(personality.traits.verbosity < 0.35, `expected a low-band trait, got ${personality.traits.verbosity}`);
  assert.ok(restarted.context({}).includes(BRIEF_HEADER + styleBrief(personality.traits)));
  assert.ok(restarted.context({}).includes('回答偏简短'));
  assert.ok(!restarted.context({}).includes('"verbosity"'));
});

test('memory and personality injection switches operate independently and per-call overrides do not stick', async t => {
  const { brain } = await fixture(t);
  await brain.remember({ text: '记忆标记：工作时间使用中文。', scope: 'global' });
  // A global fact is injected only when the turn is about it.
  const query = '记忆标记';
  const personalityOnly = brain.context({ injectMemories: false, query });
  assert.ok(!personalityOnly.includes('记忆标记'));
  assert.ok(personalityOnly.includes(BRIEF_HEADER + styleBrief({})));
  const memoryOnly = brain.context({ injectPersonality: false, query });
  assert.ok(memoryOnly.includes('记忆标记'));
  assert.ok(!memoryOnly.includes(BRIEF_HEADER));
  assert.ok(!brain.context({ personalityMode: 'off' }).includes(BRIEF_HEADER));
  assert.equal(brain.context({ injectMemories: false, injectPersonality: false }), '');
  assert.equal(brain.context({ injectMemories: false, personalityMode: 'off' }), '');
  assert.ok(brain.context({ query }).includes('记忆标记'));
  assert.ok(brain.context({}).includes(BRIEF_HEADER));
  assert.ok(!brain.context({}).includes('"traits"'));
});

test('manual/off/disabled personality learning pauses evidence while memory learning continues', async t => {
  const { brain } = await fixture(t);
  await feedback(brain, 1); await feedback(brain, 2);
  assert.equal((await brain.personality()).evidenceCounts.verbosity, 2);
  for (const [turn, policy] of [[3, { personalityMode: 'manual' }], [4, { personalityMode: 'off' }], [5, { personalityMode: 'adaptive', personalityLearningEnabled: false }]]) {
    await brain.configure(policy);
    await feedback(brain, turn);
    await brain.learn({ sessionId: 'settings-synthetic', turnId: `memory-${turn}`, workspace: brain.dataDir, userText: `请记住合成项目编号是 ${turn}。`, extraction: { memories: [{ text: `合成项目编号是 ${turn}。`, evidence: `请记住合成项目编号是 ${turn}。`, scope: 'workspace', kind: 'fact', confidence: .9 }], feedback: [] } });
    assert.equal((await brain.personality()).evidenceCounts.verbosity, 2);
    assert.equal((await brain.personality()).traits.verbosity, 0.5);
  }
  assert.ok((await brain.list({workspace:brain.dataDir})).some(record => record.text.includes('项目编号是 5')));
  await brain.configure({ personalityMode: 'adaptive', personalityLearningEnabled: true });
  await feedback(brain, 6);
  assert.equal((await brain.personality()).traits.verbosity, 0.45);
});

test('per-job learning gates keep memory and personality learning independent', async t => {
  const { brain } = await fixture(t);
  for (let turn = 1; turn <= 3; turn++) await feedback(brain, turn, { learnMemories: false });
  assert.equal((await brain.list()).length, 0);
  assert.equal((await brain.personality()).traits.verbosity, 0.45);
  await feedback(brain, 4, { learnPersonality: false, extraction: { memories: [{ text: '用户偏好简短回答。', evidence: '以后回答请简短一点。', scope: 'global', kind: 'preference', confidence: .9 }], feedback: [] } });
  assert.equal((await brain.personality()).evidenceCounts.verbosity, 3);
  assert.equal((await brain.list()).length, 1);
  await assert.rejects(feedback(brain, 5, { learnMemories: 'yes' }), /boolean/);
});

test('live limit changes validate atomically, retain existing records, and count only injectable records', async t => {
  const { brain } = await fixture(t, { maxContextMemories: 1 });
  await brain.remember({ text: '可注入事实：项目使用 Rust。', scope: 'global' });
  await feedback(brain, 1);
  assert.ok(brain.context({ query: 'Rust' }).includes('可注入事实'));
  const existing = await brain.list();
  await brain.configure({ maxMemories: 1 });
  assert.deepEqual(await brain.list(), existing);
  await assert.rejects(brain.remember({ text: 'new record', scope: 'global' }), /capacity/);
  const before = brain.maxContextChars;
  await assert.rejects(brain.configure({ maxContextChars: 10, personalityMode: 'invalid' }), /policy/);
  assert.equal(brain.maxContextChars, before);
  await assert.rejects(brain.configure({ typo: true }), /Unknown/);
  await brain.configure({ maxContextChars: 20 });
  assert.equal(brain.context({}), '');
});

test('aborted learning waiting on another SQLite writer never consumes its turn', async t => {
  const { brain } = await fixture(t);
  const before = await brain.exportData();
  const db = new DatabaseSync(brain.file);
  db.exec('BEGIN IMMEDIATE');
  try {
    const controller = new AbortController();
    const operation = feedback(brain, 1, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('settings changed')), 20);
    await assert.rejects(operation, /settings changed/);
  } finally { db.exec('ROLLBACK'); db.close(); }
  assert.deepEqual(await brain.exportData(), before);
  const result = await feedback(brain, 1);
  assert.equal(result.duplicate, false);
  assert.equal((await brain.personality()).evidenceCounts.verbosity, 1);
});

test('aborted work at SQL commit boundary rolls back its changes', async t => {
  const { brain } = await fixture(t);
  const before = await brain.exportData();
  const controller = new AbortController();
  const originalCommit = brain.store._commit.bind(brain.store);
  brain.store._commit = async (db, signal) => { controller.abort(new Error('plugin reloaded before commit')); return originalCommit(db, signal); };
  await assert.rejects(feedback(brain, 1, { signal: controller.signal }), /plugin reloaded/);
  assert.deepEqual(await brain.exportData(), before);
});
