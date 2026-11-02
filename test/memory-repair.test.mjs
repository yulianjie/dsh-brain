import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Brain } from '../lib/core.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'brain-memory-repair-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { workspace: join(dataDir, 'project'), other: join(dataDir, 'other'), brain: await new Brain({ dataDir }).init() };
}
const extraction = (text, evidence, extra = {}) => ({ memories: [{ text, evidence, kind: 'fact', scope: 'workspace', confidence: .95, ...extra }], feedback: [] });
const learn = (brain, turnId, workspace, userText, result) => brain.learn({ sessionId: 'repair-chat', turnId, workspace, userText, extraction: result });

test('SQLite saves a polished claim separately from source evidence and only recalls the claim', async t => {
  const { brain, workspace } = await fixture(t);
  const userText = '请记住：本项目的数据库统一采用 SQLite，不使用 PostgreSQL。';
  const summary = '项目数据库使用 SQLite，不使用 PostgreSQL。';
  await learn(brain, '1', workspace, userText, extraction(summary, userText));
  const [record] = await brain.list({ workspace });
  assert.equal(record.text, summary);
  assert.equal(record.evidence, userText);
  const reference = brain.context({ workspace, query: 'SQLite' });
  assert.ok(reference.includes(summary));
  assert.ok(!reference.includes('请记住'));
  assert.ok(!reference.includes('"evidence"'));
  assert.equal((await readFile(brain.file)).subarray(0, 16).toString(), 'SQLite format 3\0');
});

test('project summaries stay local and no raw fallback duplicates a successful extraction', async t => {
  const { brain, workspace, other } = await fixture(t);
  const userText = '请记住：构建命令是 pnpm build。';
  await learn(brain, '1', workspace, userText, extraction('构建命令为 pnpm build。', '构建命令是 pnpm build。', { scope: 'global' }));
  assert.equal((await brain.list({ workspace })).length, 1);
  assert.equal((await brain.list({ workspace }))[0].scope, 'workspace');
  assert.equal((await brain.list({ workspace: other })).length, 0);
  await learn(brain, '2', workspace, '请记住：测试命令是 pnpm test。');
  assert.equal((await brain.list({ workspace })).length, 1, 'model unavailable never stores the original conversation');
});

test('a short model correction replaces the named old property', async t => {
  const { brain, workspace } = await fixture(t);
  const old = await brain.remember({ text: '默认语言为简体中文，所有界面文案、菜单与帮助提示均使用简体中文。', scope: 'workspace', workspace });
  const userText = '本项目默认语言改为英文。';
  await learn(brain, '1', workspace, userText, extraction('项目默认语言为英文。', userText, { updateOf: old.id }));
  const records = await brain.list({ workspace });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, old.id);
  assert.equal(records[0].text, '项目默认语言为英文。');
});

test('opposite response-language preferences update one property across chats', async t => {
  const { brain, workspace } = await fixture(t);
  for (const [turn, language] of ['中文', '英文'].entries()) {
    const evidence = `我更喜欢${language}交流。`;
    await learn(brain, String(turn), workspace, evidence, extraction(`用户偏好${language}交流。`, evidence, { kind: 'preference', scope: 'global' }));
  }
  const records = await brain.list({ workspace });
  assert.equal(records.length, 1);
  assert.equal(records[0].text, '用户偏好英文交流。');
  assert.ok(!brain.context({ workspace }).includes('中文交流'));
});

test('negation survives source validation and repeated negative style requests', async t => {
  const { brain, workspace } = await fixture(t);
  const evidence = '本项目不使用 PostgreSQL，数据库采用 SQLite。';
  await learn(brain, 'bad', workspace, evidence, extraction('使用 PostgreSQL', '使用 PostgreSQL'));
  assert.equal((await brain.list({ workspace })).length, 0);
  for (let turn = 0; turn < 6; turn++) await learn(brain, String(turn), workspace, '以后回答不要总是主动建议。');
  assert.ok((await brain.personality()).traits.proactivity < .5);
  assert.ok(!brain.context({ workspace }).includes('结尾主动给一条'));
  const before = await brain.personality();
  for (const text of ['现在请回答简短一点。', '今天请回答详细一点。']) await learn(brain, text, workspace, text);
  assert.deepEqual(await brain.personality(), before);
});

test('empty turns do not write a replay ledger and productive replay retention is bounded', async t => {
  const { brain, workspace } = await fixture(t);
  const before = await brain.exportData();
  for (let turn = 0; turn < 10; turn++) await learn(brain, String(turn), workspace, '普通聊天', { memories: [], feedback: [] });
  assert.deepEqual(await brain.exportData(), before);
  const state = await brain.exportData();
  state.processedTurns = Array.from({ length: 4200 }, (_, i) => createHash('sha256').update(String(i)).digest('hex'));
  await brain.importData(state);
  assert.equal((await brain.exportData()).processedTurns.length, 4096);
  await learn(brain, 'productive', workspace, '以后回答请简短一点。');
  assert.equal((await brain.exportData()).processedTurns.length, 4096);
  assert.equal((await learn(brain, 'productive', workspace, '以后回答请简短一点。')).duplicate, true);
});

test('forgetting source evidence blocks a differently polished replay and an old JSON backup', async t => {
  const { brain, workspace } = await fixture(t);
  const evidence = '本项目将构建产物保存在 dist 目录。';
  const key = 'project:build-artifact-location';
  await learn(brain, '1', workspace, evidence, extraction('项目构建产物保存在 dist 目录。', evidence, { key }));
  const backup = await brain.exportData();
  const [record] = await brain.list({ workspace });
  await brain.forget({ id: record.id, workspace });
  await learn(brain, '2', workspace, evidence, extraction('构建产物位于 dist 目录。', evidence, { key }));
  await brain.importData(backup);
  assert.equal((await brain.list({ workspace })).length, 0);
});

test('forgetting one claim from shared evidence preserves sibling claims during backup import', async t => {
  const { brain, workspace } = await fixture(t);
  const evidence = '本项目使用 SQLite，构建采用 Vite。';
  const databaseKey = 'project:database-engine';
  const buildKey = 'project:build-tool';
  await learn(brain, '1', workspace, evidence, { memories: [
    ...extraction('项目数据库使用 SQLite。', evidence).memories.map(item => ({ ...item, key: databaseKey })),
    ...extraction('项目构建使用 Vite。', evidence).memories.map(item => ({ ...item, key: buildKey })),
  ], feedback: [] });
  const backup = await brain.exportData();
  const before = await brain.list({ workspace });
  const deleted = before.find(record => record.key === databaseKey);
  const sibling = before.find(record => record.key === buildKey);
  assert.ok(deleted && sibling);

  await brain.forget({ id: deleted.id, workspace });
  assert.deepEqual((await brain.list({ workspace })).map(record => record.id), [sibling.id]);
  await brain.importData(backup);
  assert.deepEqual((await brain.list({ workspace })).map(record => record.id), [sibling.id]);
});

test('an equal-length external SQL edit invalidates the relevance index without a timestamp change', async t => {
  const { brain, workspace } = await fixture(t);
  const record = await brain.remember({ text: 'ORBIT 部署清单放在 deploy 目录', scope: 'workspace', workspace });
  assert.ok(brain.context({ workspace, query: 'ORBIT' }).includes('ORBIT'));
  const db = new DatabaseSync(brain.file);
  try { db.prepare('UPDATE memories SET text = ? WHERE id = ?').run('VEGAS 部署清单放在 deploy 目录', record.id); }
  finally { db.close(); }
  assert.ok(brain.context({ workspace, query: 'VEGAS' }).includes('VEGAS'));
  assert.ok(!brain.context({ workspace, query: 'ORBIT' }).includes('VEGAS'));
});

test('a project UI-language fact does not shadow the personal response-language preference', async t => {
  const { brain, workspace } = await fixture(t);
  await brain.remember({ text: '我更喜欢中文交流。', kind: 'preference', scope: 'global' });
  await brain.remember({ text: '本项目界面使用英文。', kind: 'fact', scope: 'workspace', workspace });
  assert.ok(brain.context({ workspace }).includes('中文交流'));
});

test('busy recall cannot expose a cached record another instance has forgotten', async t => {
  const { brain, workspace } = await fixture(t);
  const record = await brain.remember({ text: 'ORBIT_PRIVATE_DELETED deployment fact', scope: 'workspace', workspace });
  brain.context({ workspace, query: 'ORBIT_PRIVATE_DELETED' });
  const other = await new Brain({ dataDir: brain.dataDir }).init();
  await other.forget({ id: record.id, workspace });
  brain.store._open = () => { throw Object.assign(new Error('database is locked'), { errcode: 261 }); };
  assert.throws(() => brain.context({ workspace, query: 'ORBIT_PRIVATE_DELETED' }), /database is locked/);
  await assert.rejects(brain.readMemory({ workspace, id: record.id }), /database is locked/);
});
