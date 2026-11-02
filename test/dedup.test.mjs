// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';
import { BackgroundLearner } from '../lib/index.js';
import { validateExtraction } from '../lib/extraction.js';
import { similarity, terms } from '../lib/text.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-dedup-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { brain: await new Brain({ dataDir, ...options }).init(), dataDir };
}
const learn = (brain, turn, userText, extraction, extra = {}) =>
  brain.learn({ sessionId: 'dedup-synthetic', turnId: String(turn), userText, ...(extraction ? { extraction } : {}), ...extra });
const memory = (evidence, extra = {}) => ({ text: evidence, evidence, kind: 'fact', scope: 'global', confidence: 0.9, ...extra });
const chunks = async function* (value) { const text = JSON.stringify(value); yield { type: 'text-delta', index: 0, text }; yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }; };
const jaccard = (a, b) => similarity(new Set(terms(a)), new Set(terms(b)));

test('cross-naming-style keys merge by canonical form and keep the rich existing text', async t => {
  const { brain } = await fixture(t);
  const rich = '请称呼我为船长，在所有对话和项目中都保持这个称呼';
  const stored = await brain.remember({ text: rich, scope: 'global', key: 'preferred-address', source: 'model-tool', confidence: 0.9 });
  const result = await learn(brain, 1, '称呼我为船长', { memories: [memory('称呼我为船长', { key: 'preferred_address' })] });
  const records = await brain.list();
  assert.equal(records.length, 1, 'kebab-case and snake_case keys must merge');
  assert.equal(records[0].id, stored.id);
  // The short restatement is below 60% of the rich text, so the rich text wins.
  assert.equal(records[0].text, rich);
  assert.equal(records[0].key, 'preferred-address');
  assert.equal(result.remembered[0].text, rich);
});

test('an unavailable model leaves a remembered claim unchanged', async t => {
  const { brain } = await fixture(t);
  await brain.remember({ text: '以后你就是我的水手，名叫虫虫', scope: 'global', source: 'user-command', confidence: 1 });
  await learn(brain, 1, '请记住，以后你就是我的水手，名叫虫虫');
  const records = await brain.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].text, '以后你就是我的水手，名叫虫虫');
});

test('term-Jaccard merges at 0.92; the 0.6–0.75 review band and lower do not merge', async t => {
  // 11/12 shared bigrams; the trailing period keeps containment from firing first.
  assert.ok(jaccard('周会固定在每周五下午三点。', '周会固定在每周五下午三点半。') >= 0.75);
  const high = await fixture(t);
  await high.brain.remember({ text: '周会固定在每周五下午三点。', scope: 'global' });
  const merged = await high.brain.rememberWithOutcome({ text: '周会固定在每周五下午三点半。', scope: 'global' });
  assert.equal(merged.merged, true);
  assert.equal(merged.record.text, '周会固定在每周五下午三点半。');
  assert.equal((await high.brain.list()).length, 1);

  // 9/13 shared bigrams: below the write-time bar, but still a dream candidate.
  assert.ok(jaccard('周会固定在每周五下午三点。', '周会固定在每周五下午四点。') >= 0.6);
  const mid = await fixture(t);
  await mid.brain.remember({ text: '周会固定在每周五下午三点。', scope: 'global' });
  const review = await mid.brain.rememberWithOutcome({ text: '周会固定在每周五下午四点。', scope: 'global' });
  assert.equal(review.merged, false);
  assert.equal((await mid.brain.list()).length, 2);
  // Dream stays read-only over what write-time merging left behind: this pair
  // is exactly the human-review band between the two thresholds.
  const plan = mid.brain.dreamPlan();
  assert.equal(plan.stats.groups, 1);
  assert.equal(plan.stats.covered, 2);

  const low = await fixture(t);
  await low.brain.remember({ text: '数据库迁移使用 Flyway。', scope: 'global' });
  const distinct = await low.brain.rememberWithOutcome({ text: '界面配色遵循品牌规范。', scope: 'global' });
  assert.equal(distinct.merged, false);
  assert.equal((await low.brain.list()).length, 2);
});

test('short canonical keys never merge by canonical form', async t => {
  const { brain } = await fixture(t);
  await brain.remember({ text: '第一条独立记录。', scope: 'global', key: 'k1' });
  const outcome = await brain.rememberWithOutcome({ text: '另一条完全不同的内容。', scope: 'global', key: 'k2' });
  assert.equal(outcome.merged, false);
  assert.equal((await brain.list()).length, 2);
});

test('a canonical key collision with zero term overlap never merges', async t => {
  const { brain } = await fixture(t);
  await brain.remember({ text: '周会固定在每周五下午三点。', scope: 'global', key: 'meeting-schedule' });
  const outcome = await brain.rememberWithOutcome({ text: '数据库使用 PostgreSQL。', scope: 'global', key: 'meeting schedule' });
  assert.equal(outcome.merged, false, 'unrelated facts sharing only a canonical key must stay separate');
  assert.equal((await brain.list()).length, 2);
});

test('containment needs a shorter side of at least 6 code points', async t => {
  const { brain } = await fixture(t);
  await brain.remember({ text: '周会固定在每周五下午三点。', scope: 'global' });
  const outcome = await brain.rememberWithOutcome({ text: '周会固定', scope: 'global' });
  assert.equal(outcome.merged, false);
  assert.equal((await brain.list()).length, 2);
});

test('an exact-key update accepts both corrections and concise property rewrites', async t => {
  const { brain } = await fixture(t);
  await brain.remember({ text: '项目使用 Rust 2018 版。', scope: 'global', key: 'stack' });
  const corrected = await brain.rememberWithOutcome({ text: '项目使用 Rust 2021 版。', scope: 'global', key: 'stack' });
  assert.equal(corrected.merged, true);
  assert.equal(corrected.record.text, '项目使用 Rust 2021 版。');
  const degraded = await brain.rememberWithOutcome({ text: '用 Rust。', scope: 'global', key: 'stack' });
  assert.equal(degraded.merged, true);
  assert.equal(degraded.record.text, '用 Rust。');
  assert.equal((await brain.list()).length, 1);
});

test('an explicit id rewrite bypasses the 60% rule entirely', async t => {
  const { brain } = await fixture(t);
  const stored = await brain.remember({ text: '请称呼我为船长，在所有对话和项目中都保持这个称呼', scope: 'global', key: 'preferred-address' });
  const rewritten = await brain.rememberWithOutcome({ id: stored.id, text: '叫我船长', scope: 'global', key: 'preferred-address', source: 'user-command' });
  assert.equal(rewritten.merged, true);
  assert.equal(rewritten.record.text, '叫我船长');
  assert.equal(rewritten.record.createdAt, stored.createdAt);
  assert.equal((await brain.list()).length, 1);
});

test('a valid same-scope updateOf cannot overwrite an unrelated claim', async t => {
  const { brain, dataDir } = await fixture(t);
  const workspace = path.join(dataDir, 'project');
  const old = await brain.remember({ text: 'CI流水线使用GitHub Actions。', scope: 'workspace', workspace, key: 'ci-pipeline' });
  const userText = '本项目数据库使用 SQLite。';
  const result = await learn(brain, 1, userText, { memories: [memory(userText, {
    text: '本项目数据库使用 SQLite。', scope: 'workspace', workspace, key: 'ci-pipeline', updateOf: old.id,
  })] }, { workspace });
  const records = await brain.list({ workspace });
  assert.equal(records.length, 2);
  assert.equal(records.find(record => record.id === old.id)?.text, 'CI流水线使用GitHub Actions。');
  const added = records.find(record => record.text.includes('SQLite'));
  assert.ok(added);
  assert.notEqual(added.id, old.id);
  assert.equal(added.key, undefined, 'the unrelated model key is discarded');
  assert.equal(result.remembered[0].id, added.id);
});

test('an exact model key cannot merge unrelated topics and its collision is discarded', async t => {
  const { brain, dataDir } = await fixture(t);
  const workspace = path.join(dataDir, 'project');
  const old = await brain.remember({ text: 'CI流水线使用GitHub Actions。', scope: 'workspace', workspace, key: 'same-key' });
  const userText = '本项目数据库使用 SQLite。';
  const result = await learn(brain, 1, userText, { memories: [memory(userText, {
    text: '本项目数据库使用 SQLite。', scope: 'workspace', workspace, key: 'same-key',
  })] }, { workspace });
  const records = await brain.list({ workspace });
  assert.equal(records.length, 2);
  assert.equal(records.find(record => record.id === old.id)?.text, 'CI流水线使用GitHub Actions。');
  const added = records.find(record => record.text.includes('SQLite'));
  assert.ok(added);
  assert.notEqual(added.id, old.id);
  assert.equal(added.key, undefined);
  assert.equal(result.remembered[0].id, added.id);

  const toolWrite = await brain.rememberWithOutcome({ text: '本项目缓存使用 Redis。', scope: 'workspace', workspace, key: 'same-key', source: 'model-tool' });
  assert.equal(toolWrite.merged, false);
  assert.equal(toolWrite.record.key, undefined);
  assert.equal((await brain.list({ workspace })).length, 3);
});

test('model-tool id updates are claim-checked while user-command id updates remain explicit', async t => {
  const { brain, dataDir } = await fixture(t);
  const workspace = path.join(dataDir, 'project');
  const old = await brain.remember({ text: 'CI流水线使用GitHub Actions。', scope: 'workspace', workspace, key: 'ci-pipeline' });
  const rejected = await brain.rememberWithOutcome({ id: old.id, text: '本项目数据库使用 SQLite。', scope: 'workspace', workspace, key: 'ci-pipeline', source: 'model-tool' });
  const afterModel = await brain.list({ workspace });
  assert.equal(afterModel.length, 2);
  assert.equal(afterModel.find(record => record.id === old.id)?.text, 'CI流水线使用GitHub Actions。');
  const newFact = afterModel.find(record => record.text.includes('SQLite'));
  assert.ok(newFact);
  assert.equal(newFact.key, undefined);
  assert.equal(rejected.record.id, newFact.id);

  const forced = await brain.rememberWithOutcome({ id: old.id, text: '显式覆盖为另一个用户指定的内容', scope: 'workspace', workspace, source: 'user-command' });
  assert.equal(forced.record.id, old.id);
  assert.equal(forced.record.text, '显式覆盖为另一个用户指定的内容');
  assert.equal((await brain.list({ workspace })).length, 2);
});

test('updateOf retargets the extraction at the named record inside the learn transaction', async t => {
  const { brain } = await fixture(t);
  const stored = await brain.remember({ text: '用户称呼我为船长', scope: 'global', key: 'preferred-address' });
  const result = await learn(brain, 1, '称呼我为船长', { memories: [memory('称呼我为船长', { updateOf: stored.id, key: 'preferred_address' })] });
  const records = await brain.list();
  assert.equal(records.length, 1, 'updateOf must update, not add');
  assert.equal(records[0].id, stored.id);
  assert.equal(records[0].text, '称呼我为船长');
  assert.equal(result.remembered[0].id, stored.id);
});

test('a short UI-language correction still updates the matching property', async t => {
  const { brain, dataDir } = await fixture(t);
  const workspace = path.join(dataDir, 'project');
  const oldText = '默认语言为简体中文，所有界面文案、菜单与帮助提示均使用简体中文。';
  const old = await brain.remember({ text: oldText, kind: 'preference', scope: 'workspace', workspace, key: 'preference:ui-language' });
  const userText = '本项目默认语言改为英文。';
  const result = await learn(brain, 1, userText, { memories: [memory(userText, {
    text: '项目默认语言为英文。', kind: 'preference', scope: 'workspace', workspace,
    key: 'preference:ui-language', updateOf: old.id,
  })] }, { workspace });
  const records = await brain.list({ workspace });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, old.id);
  assert.equal(records[0].text, '项目默认语言为英文。');
  assert.equal(result.remembered[0].id, old.id);
});

test('a stale or cross-scope updateOf degrades to a plain add without failing the turn', async t => {
  const { brain, dataDir } = await fixture(t);
  const workspace = path.join(dataDir, 'project-a');
  const stored = await brain.remember({ text: '项目使用 Rust', scope: 'workspace', workspace, key: 'stack' });
  const stale = await learn(brain, 1, '项目使用 TypeScript', { memories: [memory('项目使用 TypeScript', { scope: 'workspace', updateOf: 'no-such-record' })] }, { workspace });
  assert.equal(stale.remembered.length, 1, 'the write must still happen');
  const records = await brain.list({ workspace });
  assert.equal(records.length, 2);
  assert.equal(records.find(r => r.id === stored.id)?.text, '项目使用 Rust', 'the stale target stays untouched');

  const other = await fixture(t);
  const otherWorkspace = path.join(other.dataDir, 'project-b');
  const scoped = await other.brain.remember({ text: '项目使用 Rust', scope: 'workspace', workspace: otherWorkspace });
  const cross = await learn(other.brain, 1, '称呼我为船长', { memories: [memory('称呼我为船长', { scope: 'global', updateOf: scoped.id })] });
  // The named record exists but only in workspace scope, so the global item degrades.
  assert.equal(cross.remembered.length, 1);
  assert.equal((await other.brain.list()).length, 1, 'only the degraded global add is visible globally');
  assert.equal((await other.brain.list({ workspace: otherWorkspace })).length, 2);
  assert.equal((await other.brain.list({ workspace: otherWorkspace })).find(r => r.id === scoped.id)?.text, '项目使用 Rust');
});

test('merges keep the original identity, refresh updatedAt and take the maximum confidence', async t => {
  const { brain } = await fixture(t);
  const first = await brain.remember({ text: '周会固定在每周五下午三点半。', scope: 'global', confidence: 0.5 });
  await new Promise(resolve => setTimeout(resolve, 5));
  await learn(brain, 1, '请记住：全局周会固定在每周五下午三点半。', { memories: [memory('请记住：全局周会固定在每周五下午三点半。', { text: '周会固定在每周五下午三点半。' })], feedback: [] });
  const merged = (await brain.list())[0];
  assert.equal((await brain.list()).length, 1);
  assert.equal(merged.id, first.id);
  assert.equal(merged.createdAt, first.createdAt);
  assert.ok(merged.updatedAt > first.updatedAt, 'updatedAt must refresh');
  assert.equal(merged.confidence, 0.9, 'confidence takes the maximum');
  assert.equal(merged.text, '周会固定在每周五下午三点半。');
});

test('a merging automatic learn never trips the capacity limit', async t => {
  const { brain } = await fixture(t, { maxMemories: 1 });
  await brain.remember({ text: '用户称呼我为船长', scope: 'global' });
  const result = await learn(brain, 1, '称呼我为船长', { memories: [memory('称呼我为船长')] });
  assert.equal(result.remembered.length, 1, 'the merge must absorb the write within capacity');
  assert.equal((await brain.list()).length, 1);
});

test('merging never crosses scopes or workspaces', async t => {
  const { brain, dataDir } = await fixture(t);
  const projectA = path.join(dataDir, 'project-a'), projectB = path.join(dataDir, 'project-b');
  const text = '周会固定在每周五下午三点半。';
  await brain.remember({ text, scope: 'global' });
  await brain.remember({ text, scope: 'workspace', workspace: projectA });
  await brain.remember({ text, scope: 'workspace', workspace: projectB });
  assert.equal((await brain.list()).length, 1);
  assert.equal((await brain.list({ workspace: projectA })).length, 2);
  assert.equal((await brain.list({ workspace: projectB })).length, 2);
});

test('validateExtraction passes plausible updateOf ids through and drops the rest silently', () => {
  const userText = '称呼我为船长';
  const valid = validateExtraction({ userText, extraction: { memories: [memory('称呼我为船长', { updateOf: 'a'.repeat(100) })] } });
  assert.equal(valid.memories[0].updateOf, 'a'.repeat(100));
  for (const updateOf of ['a'.repeat(101), '', '   ', 42, null, {}]) {
    const result = validateExtraction({ userText, extraction: { memories: [memory('称呼我为船长', { updateOf })] } });
    assert.equal(result.memories[0].updateOf, undefined, `updateOf ${JSON.stringify(updateOf)} must be dropped`);
    assert.equal(result.rejected, 0, 'a malformed updateOf is not a rejection');
  }
});

test('extraction sees the top-10 similar existing memories as bounded EXISTING context', async () => {
  const seen = [];
  const learner = new BackgroundLearner({
    brain: {
      async search(options) { seen.push(options); return [
        { id: 'id-1', key: 'preferred-address', text: '长'.repeat(400) },
        { id: 'id-2', text: '短的既有记忆' },
      ]; },
      async learn() { return { rejected: 0 }; },
    },
    llm: { stream(options) { seen.push(options); return chunks({ memories: [], feedback: [] }); } },
    config: { extractionMaxQueue: 2, extractionTimeoutMs: 500 },
  });
  learner.enqueue({ sessionId: 'dedup-existing', turnId: '1', workspace: 'C:\\work\\demo', userText: '称呼我为船长', provider: 'synthetic', model: 'synthetic' });
  await learner.flush();
  await learner.close();
  assert.deepEqual(seen[0], { query: '称呼我为船长', workspace: 'C:\\work\\demo', limit: 10 });
  const request = seen[1];
  assert.ok(request.messages[0].content[0].text.includes('updateOf'), 'the extraction prompt must document the updateOf protocol');
  const payload = JSON.parse(request.messages[1].content[0].text);
  assert.equal(payload.USER, '称呼我为船长');
  assert.equal(payload.EXISTING.length, 2);
  assert.deepEqual(Object.keys(payload.EXISTING[0]).sort(), ['id', 'key', 'text']);
  assert.equal(Array.from(payload.EXISTING[0].text).length, 200, 'previews truncate to 200 code points');
  assert.equal(payload.EXISTING[1].text, '短的既有记忆');
});

test('a missing or failing search degrades to an empty EXISTING list', async () => {
  const stubs = [
    { async learn() { return { rejected: 0 }; } },
    { async learn() { return { rejected: 0 }; }, async search() { throw new Error('store unreadable'); } },
  ];
  for (const brain of stubs) {
    const seen = [];
    const learner = new BackgroundLearner({ brain, llm: { stream(options) { seen.push(options); return chunks({ memories: [], feedback: [] }); } }, config: { extractionMaxQueue: 2, extractionTimeoutMs: 500 } });
    learner.enqueue({ sessionId: 'dedup-degraded', turnId: '1', userText: '称呼我为船长', provider: 'synthetic', model: 'synthetic' });
    await learner.flush();
    await learner.close();
    assert.equal(seen.length, 1, 'extraction must still run without EXISTING context');
    assert.deepEqual(JSON.parse(seen[0].messages[1].content[0].text).EXISTING, []);
  }
});
