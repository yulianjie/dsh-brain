import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Brain } from '../lib/core.js';
import { BRIEF_HEADER, styleBrief } from '../lib/style.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-core-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir, ...options }).init();
  return { brain, dataDir };
}
const learn = (brain, turn, userText = '以后回答请简短一点。', extra = {}) => brain.learn({ sessionId: 'synthetic', turnId: String(turn), userText,
  ...(/^请记住/.test(userText) && !extra.extraction ? { extraction: { memories: [{ text: userText.replace(/^请记住[：:,，\s]*/, ''), evidence: userText, scope: 'global', kind: 'preference', confidence: 0.9 }], feedback: [] } } : {}), ...extra });

test('atomic persistence, explicit correction, Unicode search and scope isolation', async t => {
  const { brain, dataDir } = await fixture(t);
  const global = await brain.remember({ text: '我喜欢中文交流', scope: 'global' });
  const projectA = path.join(dataDir, 'project-a'), projectB = path.join(dataDir, 'project-b');
  const record = await brain.remember({ text: '项目使用 Rust 和 SQLite', scope: 'workspace', workspace: projectA, key: 'stack' });
  await brain.remember({ text: '项目使用 TypeScript 和 SQLite', scope: 'workspace', workspace: projectA, key: 'stack' });
  const restarted = await new Brain({ dataDir }).init();
  assert.equal((await restarted.list()).length, 1);
  assert.equal((await restarted.list({ workspace: projectA })).length, 2);
  assert.equal((await restarted.list({ workspace: projectB })).length, 1);
  assert.equal((await restarted.search({ workspace: projectA, query: 'TypeScript' }))[0].id, record.id);
  assert.equal((await restarted.search({ query: '中文' }))[0].id, global.id);
  assert.equal((await restarted.search({ query: 'SQLite' })).length, 0);
  assert.equal(await restarted.forget({ id: record.id, workspace: projectB }), false);
  await assert.rejects(restarted.remember({ id: record.id, text: 'wrong project', scope: 'workspace', workspace: projectB }), /scope/);
  assert.ok(!restarted.context({ workspace: projectB }).includes('SQLite'));
});

test('deleted auto memory stays deleted after replay, future extraction, and old backup import', async t => {
  const { brain } = await fixture(t);
  await learn(brain, 1, '请记住我喜欢乌龙茶。');
  const backup = await brain.exportData();
  const record = (await brain.list())[0];
  assert.ok(record.source.includes('synthetic:1'));
  assert.equal(await brain.forget({ id: record.id }), true);
  assert.equal((await learn(brain, 1, '请记住我喜欢乌龙茶。')).duplicate, true);
  await learn(brain, 2, '请记住我喜欢乌龙茶。');
  await brain.importData(backup);
  assert.equal((await brain.list()).length, 0);
  await brain.remember({ text: record.text, scope: 'global' });
  assert.equal((await brain.list()).length, 1);
});

test('gradual personality needs three independent turns, deduplicates and records traceable history', async t => {
  const { brain } = await fixture(t);
  await learn(brain, 1); await learn(brain, 2); await learn(brain, 2);
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
  await learn(brain, 3);
  assert.equal((await brain.personality()).traits.verbosity, 0.45);
  await learn(brain, 4);
  assert.equal((await brain.personality()).traits.verbosity, 0.4);
  const history = await brain.personalityHistory();
  assert.equal(history.at(-1).changes[0].evidence[0].evidence, '以后回答请简短一点。');
  assert.ok(!(brain.context({})).includes('以后回答请简短一点'));
  assert.equal((await brain.list()).length, 0, 'offline style feedback does not create a raw memory');
  await brain.rollbackPersonality({ version: history[1].version });
  assert.equal((await brain.personality()).traits.verbosity, 0.45);
  await brain.resetPersonality();
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
});

test('freeze discards feedback and unfreeze restarts independent evidence', async t => {
  const { brain } = await fixture(t);
  await learn(brain, 1); await learn(brain, 2);
  await brain.setPersonality({ frozen: true });
  for (let i = 3; i < 8; i++) await learn(brain, i);
  assert.equal((await brain.personality()).evidenceCounts.verbosity, 0);
  await brain.setPersonality({ frozen: false });
  await learn(brain, 8);
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
  await brain.setPersonality({ traits: { warmth: 0.85 } });
  assert.equal((await brain.personality()).traits.warmth, 0.85);
});

test('language and manual style memories inject; automatic style evidence remains gradual even if model misses it', async t => {
  const { brain } = await fixture(t);
  await learn(brain, 1, '请记住：我喜欢中文回答。');
  assert.ok(brain.context({}).includes('我喜欢中文回答'));
  await learn(brain, 2, '以后回答请简短一点。', { extraction: { memories: [], feedback: [] } });
  assert.ok(!brain.context({ query: '回答简短' }).includes('以后回答请简短一点'));
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
  await brain.remember({ text: '人工设置：回答多用类比。', scope: 'global', kind: 'preference' });
  assert.ok(brain.context({}).includes('回答多用类比'));
});

test('context respects exact character budget and notices concurrent updates', async t => {
  const { brain, dataDir } = await fixture(t, { maxContextChars: 1000 });
  const other = await new Brain({ dataDir }).init();
  await other.remember({ text: '新的跨实例偏好是使用中文。', scope: 'global', kind: 'preference' });
  assert.ok(brain.context({}).includes('新的跨实例偏好'));
  await other.setPersonality({ traits: { verbosity: 0.25 } });
  assert.ok(brain.context({}).includes(BRIEF_HEADER + styleBrief({ verbosity: 0.25 })));
  assert.ok(!brain.context({}).includes('0.25'));
  for (let i = 0; i < 10; i++) await other.remember({ text: `${i} ${'内容'.repeat(200)}`, scope: 'global' });
  assert.ok(brain.context({ query: '内容' }).length <= 1000);
  assert.equal(new Brain({ dataDir, maxContextChars: 20 }).context({}), '');
});

test('capacity never silently evicts existing manual memories', async t => {
  const { brain } = await fixture(t, { maxMemories: 1 });
  await brain.remember({ text: 'keep this', scope: 'global' });
  await assert.rejects(brain.remember({ text: 'other', scope: 'global' }), /capacity/);
  await learn(brain, 1, '请记住我喜欢乌龙茶。');
  assert.equal((await brain.list())[0].text, 'keep this');
});

test('credential rejection and invalid import cannot mutate existing state', async t => {
  const { brain } = await fixture(t);
  await brain.remember({ text: 'safe synthetic record', scope: 'global' });
  const before = await brain.exportData();
  await assert.rejects(brain.remember({ text: 'api_key=synthetic-secret-value', scope: 'global' }), /credential/);
  const invalid = structuredClone(before); invalid.memories[0].text = 'password=synthetic-secret';
  await assert.rejects(brain.importData(invalid), /corrupt/);
  const hidden = structuredClone(before); hidden.memories[0].metadata = { credential: 'Bearer abcdefghijklmnopqrst' };
  await assert.rejects(brain.importData(hidden), /corrupt/);
  const unknown = structuredClone(before); unknown.memories[0].metadata = { unexpected: 'arbitrary unrecognized metadata' };
  await assert.rejects(brain.importData(unknown), /corrupt/);
  assert.deepEqual(await brain.exportData(), before);
  await learn(brain, 1, '请记住 api_key=synthetic-secret-value');
  assert.equal((await brain.list()).length, 1);
});

test('forget prunes matching raw personality evidence/history while keeping aggregate traits', async t => {
  const { brain } = await fixture(t);
  const text = '以后回答请简短一点。';
  const extraction = { memories: [{ text: '用户偏好简短回答。', evidence: text, scope: 'global', kind: 'preference', confidence: .9 }], feedback: [{ trait: 'verbosity', value: .1, confidence: .9, evidence: text }] };
  await learn(brain, 1, text, { extraction }); await learn(brain, 2, text, { extraction }); await learn(brain, 3, text, { extraction });
  const before = (await brain.personality()).traits.verbosity;
  const record = (await brain.list())[0];
  await brain.forget({ id: record.id });
  assert.ok(!JSON.stringify(await brain.exportData()).includes(text));
  assert.equal((await brain.personality()).traits.verbosity, before);
  assert.equal((await brain.personality()).evidenceCounts.verbosity, 0);
});

test('manual controls invalidate delayed feedback and lock limits cannot disable timeout', async t => {
  const { brain, dataDir } = await fixture(t);
  const generation = brain.personalityGeneration;
  await brain.setPersonality({ frozen: true }); await brain.setPersonality({ frozen: false });
  await learn(brain, 1, '以后回答请简短一点。', { personalityGeneration: generation });
  assert.equal((await brain.personality()).evidenceCounts.verbosity, 0);
  for (const lockTimeoutMs of [NaN, Infinity, -1, 'bad']) assert.throws(() => new Brain({ dataDir, lockTimeoutMs }), /limits/);
});

test('corrupt SQLite file is reported and never overwritten, init/read-only preserves revision', async t => {
  const { brain, dataDir } = await fixture(t);
  const before = await readFile(brain.file);
  await new Brain({ dataDir }).init();
  assert.deepEqual(await readFile(brain.file), before);
  await writeFile(brain.file, 'broken SQLite database');
  await assert.rejects(new Brain({ dataDir }).init(), /corrupt/);
  assert.equal(await readFile(brain.file, 'utf8'), 'broken SQLite database');
});

test('multiple instances and processes serialize independent writes', async t => {
  const { brain, dataDir } = await fixture(t);
  const others = await Promise.all(Array.from({ length: 4 }, () => new Brain({ dataDir }).init()));
  // v0.5 write-time merging treats texts with identical term sets (digit
  // swaps such as instance-0-1 / instance-1-0) as duplicates, so every write
  // keeps a distinct term set by fusing i and j into one token.
  await Promise.all(others.flatMap((instance, i) => Array.from({ length: 8 }, (_, j) => instance.remember({ text: `instance-${i}${j}`, scope: 'global' }))));
  const moduleURL = new URL('../lib/core.js', import.meta.url).href;
  const run = i => new Promise((resolve, reject) => {
    const script = `import {Brain} from ${JSON.stringify(moduleURL)}; const b=await new Brain({dataDir:${JSON.stringify(dataDir)}}).init(); for(let j=0;j<8;j++) await b.remember({text:'child-${i}'+j,scope:'global'});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = ''; child.stderr.on('data', chunk => error += chunk);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  });
  await Promise.all([run(1), run(2), run(3)]);
  assert.equal((await brain.list()).length, 56);
});
