import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';
import { estimateTokens } from '../lib/budget.js';
import { validateExtraction } from '../lib/extraction.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'brain-memory-audit-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, brain: await new Brain({ dataDir, ...options }).init() };
}
const learn = (b, turn, userText, extra = {}) => b.learn({ sessionId: 'stability-audit', turnId: String(turn), userText, ...extra });

test('global preferences survive restart and unrelated queries across projects; workspace facts stay scoped', async t => {
  const { brain, dataDir } = await fixture(t);
  const projectA = path.join(dataDir, 'a'), projectB = path.join(dataDir, 'b');
  await learn(brain, 1, '请记住：我喜欢中文回答。', { workspace: projectA });
  await brain.remember({ text: 'ORBIT_PRIVATE_A deployment', scope: 'workspace', workspace: projectA });
  await brain.remember({ text: 'NEBULA_PUBLIC_GLOBAL deployment', scope: 'global' });
  const restarted = await new Brain({ dataDir }).init();
  for (const workspace of [undefined, projectA, projectB]) {
    const context = restarted.context({ workspace, query: 'deployment' });
    assert.ok(context.includes('我喜欢中文回答'));
    assert.ok(context.includes('NEBULA_PUBLIC_GLOBAL'));
    assert.equal(context.includes('ORBIT_PRIVATE_A'), workspace === projectA);
  }
  const global = await restarted.memoryPage({ workspace: projectA, scope: 'global' });
  assert.equal(global.records.length, 2);
  const record = (await restarted.list({ workspace: projectA, scope: 'workspace' }))[0];
  await assert.rejects(restarted.readMemory({ id: record.id, workspace: projectB }), /scope/);
});

test('personality evidence counters do not change prompt until effective traits change', async t => {
  const { brain } = await fixture(t);
  const initial = brain.context({});
  await learn(brain, 1, '以后回答请简短一点。');
  assert.equal(brain.context({}), initial);
  await learn(brain, 2, '以后回答请简短一点。');
  assert.equal(brain.context({}), initial);
  await learn(brain, 3, '以后回答请简短一点。');
  assert.notEqual(brain.context({}), initial);
  assert.doesNotMatch(brain.context({}), /evidenceCounts|controlGeneration|version|frozen/);
  const frozen = brain.context({});
  await brain.setPersonality({ frozen: true });
  assert.equal(brain.context({}), frozen);
});

test('conflicting feedback stays neutral; isolated reversal cannot continue old drift', async t => {
  const { brain } = await fixture(t);
  for (let i = 0; i < 24; i++) await learn(brain, i, i % 2 ? '以后回答请详细展开。' : '以后回答请简短一点。');
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
  await brain.resetPersonality();
  for (let i = 30; i < 34; i++) await learn(brain, i, '以后回答请简短一点。');
  const before = (await brain.personality()).traits.verbosity;
  await learn(brain, 34, '以后回答请详细展开。');
  assert.equal((await brain.personality()).traits.verbosity, before);
  for (let i = 35; i < 38; i++) await learn(brain, i, '以后回答请详细展开。');
  assert.equal((await brain.personality()).traits.verbosity, before + 0.05);
  const stable = await brain.personality();
  for (let i = 40; i < 50; i++) await learn(brain, i, '今天继续处理数据库。');
  assert.deepEqual(await brain.personality(), stable);
});

test('consistent feedback converges with bounded steps; frozen/manual/off modes do not drift', async t => {
  const { brain } = await fixture(t);
  let previous = 0.5;
  for (let i = 0; i < 30; i++) {
    await learn(brain, i, '以后回答请简短一点。');
    const next = (await brain.personality()).traits.verbosity;
    assert.ok(previous - next <= 0.050001 && next <= previous);
    previous = next;
  }
  assert.ok(Math.abs(previous - 0.1) <= 0.050001);
  const text = brain.context({});
  await brain.setPersonality({ frozen: true });
  for (let i = 30; i < 36; i++) await learn(brain, i, '以后回答请详细展开。');
  assert.equal(brain.context({}), text);
  await brain.setPersonality({ frozen: false });
  for (const personalityMode of ['manual', 'off']) {
    await brain.configure({ personalityMode });
    for (let i = 0; i < 5; i++) await learn(brain, `${personalityMode}-${i}`, '以后回答请详细展开。');
    assert.equal((await brain.personality()).traits.verbosity, previous);
  }
});

test('project-specific and temporary feedback cannot alter the global persona', async t => {
  const { brain, dataDir } = await fixture(t);
  const workspace = path.join(dataDir, 'a');
  for (let i = 0; i < 4; i++) await learn(brain, i, '本项目以后回答请详细展开。', { workspace });
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
  assert.ok(brain.context({ workspace, query: '回答' }).includes('本项目以后回答'));
  assert.ok(!brain.context({ query: '回答' }).includes('本项目以后回答'));
  const evidence = '回答请详细展开';
  const result = validateExtraction({ userText: '本项目以后回答请详细展开。', extraction: { feedback: [{ trait: 'verbosity', value: 0.9, confidence: 1, evidence }] } });
  assert.equal(result.feedback.length, 0);
  for (let i = 4; i < 8; i++) await learn(brain, i, '这次回答请详细展开。');
  assert.equal((await brain.personality()).evidenceCounts.verbosity, 0);
});

test('500 large memories stay within tool and injection budgets; pagination reaches every id', async t => {
  const { brain } = await fixture(t);
  const state = await brain.exportData();
  state.memories = Array.from({ length: 500 }, (_, i) => ({ id: `audit-${i}`, text: `中文 ORBIT ${i} ` + '文😀\\"'.repeat(300), kind: 'fact', scope: 'global', source: 'synthetic', confidence: 1, createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z' }));
  await brain.importData(state);
  const context = brain.context({ query: 'ORBIT' });
  assert.ok(context.length <= 6000 && estimateTokens(context) <= 2000);
  const ids = [];
  let cursor;
  do {
    const page = await brain.memoryPage({ query: 'ORBIT', cursor });
    const output = JSON.stringify(page);
    assert.ok(output.length <= 6000 && estimateTokens(output) <= 2000);
    assert.equal(page.total, 500);
    assert.ok(page.records.every(r => r.truncated));
    ids.push(...page.records.map(r => r.id)); cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.length, 500); assert.equal(new Set(ids).size, 500);
  let restored = '';
  do {
    const chunk = await brain.readMemory({ id: ids[0], cursor });
    assert.ok(JSON.stringify(chunk).length <= 6000 && estimateTokens(JSON.stringify(chunk)) <= 2000);
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk.text));
    restored += chunk.text; cursor = chunk.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(restored, state.memories.find(r => r.id === ids[0]).text);
});

test('small budgets make progress and cursors reject changed scopes, queries, and revisions', async t => {
  const { brain, dataDir } = await fixture(t, { maxToolResultChars: 512, maxToolResultTokens: 128 });
  for (let i = 0; i < 4; i++) await brain.remember({ text: `ORBIT ${i} ` + '中😀'.repeat(300), scope: 'global' });
  const page = await brain.memoryPage({ query: 'ORBIT' });
  assert.equal(page.records.length, 1);
  assert.ok(page.nextCursor);
  assert.ok(JSON.stringify(page).length <= 512 && estimateTokens(JSON.stringify(page)) <= 128);
  await learn(brain, 'unrelated-turn', '继续检查测试结果。');
  await brain.setPersonality({ traits: { warmth: 0.8 } });
  const continued = await brain.memoryPage({ query: 'ORBIT', cursor: page.nextCursor });
  assert.notEqual(continued.records[0].id, page.records[0].id, 'background counters must not invalidate pagination');
  for (const options of [{ query: 'other' }, { query: 'ORBIT', scope: 'global' }, { query: 'ORBIT', workspace: dataDir }]) await assert.rejects(brain.memoryPage({ ...options, cursor: page.nextCursor }), /cursor/);
  await brain.forget({ id: page.records[0].id });
  await assert.rejects(brain.memoryPage({ query: 'ORBIT', cursor: page.nextCursor }), /stale/);
  await brain.configure({ maxContextChars: 300 });
  assert.ok(brain.context({ query: 'ORBIT' }).length > 0, 'insufficient style budget must not disable all context');
  await brain.configure({ maxContextTokens: 0 });
  assert.equal(brain.context({}), '');
  assert.equal(brain.lastContextUsage.chars, 0);
});
