// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';
import { runCommand } from '../lib/index.js';
import { BRIEF_HEADER } from '../lib/style.js';
import { TRAITS } from '../lib/extraction.js';
import { INDEX_LINE_MAX, dreamPayload, groupCandidates, planDream, renderIndexLine, validateDream } from '../lib/dream.js';

const record = (id, text, { updatedAt = '2026-10-01T00:00:00.000Z', scope = 'global', workspace, key } = {}) => ({
  id, text, kind: 'fact', scope, ...(workspace ? { workspace } : {}), source: 'synthetic', confidence: 1,
  createdAt: updatedAt, updatedAt, ...(key ? { key } : {}),
});
const fixtureMemories = () => [
  record('a', '周会固定在每周五下午三点。', { updatedAt: '2026-10-01T00:00:00.000Z' }),
  record('b', '周会固定在每周五下午三点半。', { updatedAt: '2026-10-02T00:00:00.000Z' }),
  record('c', '部署流程使用 Docker。', { updatedAt: '2026-10-03T00:00:00.000Z' }),
  record('d', '部署流程使用 Docker 和 Compose。', { updatedAt: '2026-10-04T00:00:00.000Z' }),
];
const basePlan = () => ({
  groups: [{ ids: ['a', 'b'], title: '周会时间', line: '周会固定在每周五下午三点。', drop: ['a'] }],
  contradictions: [{ ids: ['c', 'd'], keep: 'd', reason: 'd 是较新的记录' }],
  style: { brief: '回答偏简短：先给结论。', basedOn: ['verbosity'] },
});
const random = seed => {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
};

test('grouping uses keys, then term similarity, and never groups a single memory', () => {
  const memories = [
    record('k1', '第一条记录。', { key: 'release' }),
    record('k2', '完全不同的措辞。', { key: 'release' }),
    record('s1', '周会固定在每周五下午三点。'),
    record('s2', '周会固定在每周五下午四点。'),
    record('u1', '数据库迁移使用 Flyway。'),
  ];
  const groups = groupCandidates(memories);
  assert.equal(groups.length, 2);
  const keyed = groups.find(group => group.reason === 'key');
  const similar = groups.find(group => group.reason === 'similarity');
  assert.deepEqual(keyed, { key: 'release', scope: 'global', workspace: undefined, ids: ['k1', 'k2'], reason: 'key' });
  assert.deepEqual(similar, { key: null, scope: 'global', workspace: undefined, ids: ['s1', 's2'], reason: 'similarity' });
  assert.ok(!groups.some(group => group.ids.includes('u1')));
});

test('grouping never crosses scopes or workspaces', () => {
  const text = '周会固定在每周五下午三点。';
  const workspaceA = path.resolve('project-a'), workspaceB = path.resolve('project-b');
  const isolated = [
    record('g', text),
    record('wa', text, { scope: 'workspace', workspace: workspaceA }),
    record('wb', text, { scope: 'workspace', workspace: workspaceB }),
  ];
  assert.deepEqual(groupCandidates(isolated, { threshold: 0.1 }), []);
  const paired = [...isolated, record('g2', text), record('wa2', text, { scope: 'workspace', workspace: workspaceA })];
  const groups = groupCandidates(paired, { threshold: 0.1 });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.ids).sort(), [['g', 'g2'], ['wa', 'wa2']]);
  assert.ok(groups.every(group => new Set(group.ids.map(id => `${group.scope}/${group.workspace ?? ''}`)).size === 1));
});

test('exact normalized duplicates group linearly and oversized clusters split into 2..20', () => {
  const duplicates = [
    record('x1', '用户要求称呼为船长'),
    record('x2', '\n用户要求称呼为船长\t'),
    record('x3', '  用户要求称呼为船长  '),
  ];
  const exact = groupCandidates(duplicates);
  assert.equal(exact.length, 1);
  assert.deepEqual(exact[0].ids, ['x1', 'x2', 'x3']);

  const many = Array.from({ length: 25 }, (_, index) => record(`m${String(index).padStart(2, '0')}`, `用户要求回答简洁一些（第${index}次）`));
  const groups = groupCandidates(many);
  assert.deepEqual(groups.map(group => group.ids.length), [20, 5]);
  assert.deepEqual(groups.map(group => group.ids[0]), ['m00', 'm20']);
  assert.equal(new Set(groups.flatMap(group => group.ids)).size, 25);
  for (const group of groups) assert.ok(group.ids.length >= 2 && group.ids.length <= 20);
});

test('large stores are bounded: duplicates are linear and similarity work is capped', () => {
  const similar = Array.from({ length: 3000 }, (_, index) => record(`s${String(index).padStart(4, '0')}`, `用户希望回答尽量简洁并给出结论第${index}号`));
  const similarStart = Date.now();
  const similarPlan = planDream(similar);
  const similarMs = Date.now() - similarStart;
  assert.ok(similarMs < 2000, `3000 similar memories took ${similarMs}ms`);
  assert.equal(typeof similarPlan.stats.truncated, 'boolean');

  const duplicates = Array.from({ length: 10000 }, (_, index) => record(`d${String(index).padStart(5, '0')}`, '用户要求称呼为船长'));
  const duplicateStart = Date.now();
  const duplicatePlan = planDream(duplicates);
  const duplicateMs = Date.now() - duplicateStart;
  assert.ok(duplicateMs < 2000, `10000 duplicate memories took ${duplicateMs}ms`);
  assert.equal(duplicatePlan.stats.truncated, false);
  assert.equal(duplicatePlan.groups.length, 50);
  assert.equal(duplicatePlan.stats.covered, 1000);
  assert.ok(duplicatePlan.groups.every(group => group.ids.length >= 2 && group.ids.length <= 20));
  // The default maxGroups cap, not the grouping logic, bounds coverage; a larger
  // caller budget still covers every duplicate.
  const complete = planDream(duplicates, { maxGroups: 500 });
  assert.equal(new Set(complete.groups.flatMap(group => group.ids)).size, 10000);
});

test('renderIndexLine is whitespace-collapsed, bounded and surrogate safe', () => {
  const emoji = '😀'.repeat(100);
  const line = renderIndexLine({ text: emoji });
  assert.equal(Array.from(line).length, INDEX_LINE_MAX);
  assert.equal(line, '😀'.repeat(INDEX_LINE_MAX));
  assert.doesNotMatch(line, /[\uD800-\uDBFF]$/);
  assert.equal(renderIndexLine({ text: emoji }, { max: 5 }), '😀'.repeat(5));
  assert.equal(renderIndexLine({ text: '第一行\n第二行\t结尾' }), '第一行 第二行 结尾');
  assert.ok(Array.from(renderIndexLine({ text: `😀${'汉字'.repeat(100)}` }, { max: 17 })).length <= 17);
});

test('a structurally valid plan passes through, including style and drop', () => {
  const memories = fixtureMemories();
  const result = validateDream(basePlan(), memories);
  assert.deepEqual(result, {
    groups: [{ ids: ['a', 'b'], title: '周会时间', line: '周会固定在每周五下午三点。', drop: ['a'] }],
    contradictions: [{ ids: ['c', 'd'], keep: 'd', reason: 'd 是较新的记录' }],
    style: { brief: '回答偏简短：先给结论。', basedOn: ['verbosity'] },
    degraded: [],
  });
});

test('missing optional arrays default to empty while explicit wrong types still fail', () => {
  const memories = fixtureMemories();
  const line = '周会固定在每周五下午三点。';
  const entry = { ids: ['a', 'b'], title: '周会时间', line };
  const result = validateDream({ groups: [entry] }, memories);
  assert.deepEqual(result.contradictions, []);
  assert.deepEqual(result.groups[0].drop, []);
  assert.deepEqual(validateDream({}, memories), { groups: [], contradictions: [], style: undefined, degraded: [] });
  assert.deepEqual(validateDream({ groups: [] }, memories).contradictions, []);
  assert.throws(() => validateDream({ groups: null }, memories), /groups must be an array/);
  assert.throws(() => validateDream({ groups: [], contradictions: null }, memories), /contradictions must be an array/);
  assert.throws(() => validateDream({ groups: [{ ...entry, drop: null }] }, memories), /drop must be an array/);
});

test('timestamp ties are detected across equivalent ISO formats', () => {
  const memories = [
    record('a', '周会固定在每周五下午三点。', { updatedAt: '2026-10-02T00:00:00Z' }),
    record('b', '周会固定在每周五下午三点半。', { updatedAt: '2026-10-02T00:00:00.000Z' }),
  ];
  const plan = { groups: [{ ids: ['a', 'b'], title: '周会时间', line: '周会固定在每周五下午三点。', drop: ['a'] }] };
  assert.throws(() => validateDream(plan, memories), /most recently updated/);
  const contradiction = { contradictions: [{ ids: ['a', 'b'], keep: 'b', reason: '同一时刻，任一保留' }] };
  assert.equal(validateDream(contradiction, memories).contradictions[0].keep, 'b');
});

test('dreamPayload skips unknown ids when choosing the hint', () => {
  const memories = [record('a', '第一条记录。')];
  const payload = dreamPayload([{ ids: ['missing', 'a'], key: null }], memories);
  assert.equal(payload.groups[0].hint, '第一条记录。');
  const empty = dreamPayload([{ ids: ['missing'], key: null }], memories);
  assert.equal(empty.groups[0].hint, '');
});

test('structural violations fail closed with field-specific errors', () => {
  const memories = fixtureMemories();
  const invalid = (plan, pattern) => {
    assert.throws(() => validateDream(plan, memories), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.constructor, Error);
      assert.match(error.message, /^Invalid dream plan:/);
      if (pattern) assert.match(error.message, pattern);
      return true;
    });
  };
  const mutate = change => { const plan = basePlan(); change(plan); return plan; };

  invalid(null);
  invalid([]);
  invalid(new Date(0));
  invalid(Object.assign(Object.create({ inherited: true }), basePlan()));
  invalid(mutate(plan => { plan.extra = true; }), /unexpected field/);
  invalid(mutate(plan => { plan.groups = {}; }), /groups/);
  invalid(mutate(plan => { plan.contradictions = 'none'; }), /contradictions/);
  assert.throws(() => validateDream(basePlan(), memories, { maxGroups: 0 }), /groups exceeds/);
  invalid({ groups: [], contradictions: Array.from({ length: 5 }, () => ({})) }, /contradictions exceeds/);

  invalid(mutate(plan => { plan.groups[0].ids = 'ab'; }), /ids/);
  invalid(mutate(plan => { plan.groups[0].ids = ['a', 1]; }), /strings/);
  invalid(mutate(plan => { plan.groups[0].ids = ['a']; }), /2\.\.20/);
  invalid(mutate(plan => { plan.groups[0].ids = Array.from({ length: 21 }, (_, index) => `id-${index}`); }), /2\.\.20/);
  invalid(mutate(plan => { plan.groups[0].ids = ['a', 'a']; }), /duplicate/);
  invalid(mutate(plan => { plan.groups[0].ids = ['a', 'missing']; }), /unknown memory/);
  invalid(mutate(plan => { plan.contradictions[0].ids = ['a', 'c']; plan.contradictions[0].keep = 'c'; }), /more than one entry/);

  const mixed = [record('a', '周会固定在每周五下午三点。'), record('b', '周会固定在每周五下午三点半。', { scope: 'workspace', workspace: path.resolve('project-b') })];
  assert.throws(() => validateDream(basePlan(), mixed), /mixes scopes or workspaces/);

  invalid(mutate(plan => { plan.groups[0].title = ''; }), /title/);
  invalid(mutate(plan => { plan.groups[0].title = 'x'.repeat(41); }), /title/);
  invalid(mutate(plan => { plan.groups[0].title = 7; }), /title/);
  invalid(mutate(plan => { plan.groups[0].line = ''; }), /line/);
  invalid(mutate(plan => { plan.groups[0].line = 'x'.repeat(61); }), /line/);

  invalid(mutate(plan => { plan.groups[0].drop = 'a'; }), /drop/);
  invalid(mutate(plan => { plan.groups[0].drop = ['a', 'missing']; }), /subset/);
  invalid(mutate(plan => { plan.groups[0].drop = ['b']; }), /most recently updated/);

  invalid(mutate(plan => { plan.contradictions[0].keep = 'missing'; }), /belong to ids/);
  invalid(mutate(plan => { plan.contradictions[0].keep = 'c'; }), /most recently updated/);
  invalid(mutate(plan => { plan.contradictions[0].reason = ''; }), /reason/);
  invalid(mutate(plan => { plan.contradictions[0].reason = 'x'.repeat(201); }), /reason/);

  invalid(mutate(plan => { plan.style = []; }), /style/);
  invalid(mutate(plan => { plan.style = {}; }), /brief/);
  invalid(mutate(plan => { plan.style.brief = 'x'.repeat(601); }), /brief/);
  invalid(mutate(plan => { plan.style.basedOn = 'verbosity'; }), /basedOn/);
  invalid(mutate(plan => { plan.style.basedOn = ['empathy']; }), /unknown trait/);

  invalid(mutate(plan => { plan.groups[0].line = 'sk-abcdefghijklmnopqrst'; }), /credential/);
  invalid(mutate(plan => { plan.style.brief = 'api_key=synthetic-secret-value'; }), /credential/);
  assert.throws(() => validateDream(basePlan(), 'not memories'), /Invalid dream plan: memories/);
});

test('a fabricated line degrades to the newest member index line', () => {
  const memories = fixtureMemories();
  const plan = basePlan();
  plan.groups[0].line = '完全编造且与记录无关的内容。';
  const result = validateDream(plan, memories);
  assert.deepEqual(result.degraded, [{ ids: ['a', 'b'], reason: 'unfaithful-line' }]);
  assert.equal(result.groups[0].line, renderIndexLine(memories[1]));
  assert.equal(result.groups[0].line, '周会固定在每周五下午三点半。');
});

test('planDream returns deterministic payload and correct stats without mutating input', () => {
  const memories = [
    record('k1', '第一条记录。', { key: 'release' }),
    record('k2', '完全不同的措辞。', { key: 'release' }),
    record('s1', '周会固定在每周五下午三点。'),
    record('s2', '周会固定在每周五下午四点。'),
    record('u1', '数据库迁移使用 Flyway。'),
    record('u2', '界面配色遵循品牌规范。'),
  ];
  const snapshot = structuredClone(memories);
  const first = planDream(memories), second = planDream(memories);
  assert.deepEqual(memories, snapshot);
  assert.deepEqual(first, second);
  assert.deepEqual(first.groups, groupCandidates(memories));
  assert.equal(first.groups.length, 2);
  assert.equal(first.stats.memories, 6);
  assert.equal(first.stats.groups, 2);
  assert.equal(first.stats.covered, 4);
  assert.equal(first.stats.truncated, false);
  assert.equal(first.stats.promptChars, JSON.stringify(first.payload).length);
  assert.equal(first.payload.memories.length, 4);
  assert.deepEqual(first.payload.groups.map(group => group.ids), first.groups.map(group => group.ids));
  assert.ok(JSON.stringify(first.payload).length < 4000);
});

test('200 malformed plans throw Error or degrade safely, never a TypeError', () => {
  const memories = fixtureMemories();
  const next = random(424242);
  const leaves = [null, undefined, 0, -1, 'x', 'sk-abcdefghijklmnopqrst', true, [], {}, { groups: 'x' }];
  const garbage = depth => {
    const roll = next();
    if (depth >= 3 || roll < 0.45) return leaves[Math.floor(next() * leaves.length)];
    if (roll < 0.7) return Array.from({ length: Math.floor(next() * 4) }, () => garbage(depth + 1));
    const object = {};
    for (const key of ['groups', 'contradictions', 'style', 'ids', 'title', 'line', 'drop', 'keep', 'reason', 'brief', 'basedOn', 'extra']) {
      if (next() < 0.25) object[key] = garbage(depth + 1);
    }
    return object;
  };
  for (let i = 0; i < 200; i++) {
    const plan = garbage(0);
    let result;
    try { result = validateDream(plan, memories); }
    catch (error) {
      assert.ok(error instanceof Error);
      assert.equal(error.constructor, Error, `unexpected error type for sample ${i}: ${error.message}`);
      assert.match(error.message, /^Invalid dream plan:/);
      continue;
    }
    assert.ok(result && typeof result === 'object');
    assert.ok(Array.isArray(result.groups) && Array.isArray(result.contradictions) && Array.isArray(result.degraded));
    assert.notEqual(result, plan);
  }
});

test('Brain.dreamPlan groups durable memories and context injects the text brief', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-dream-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  for (const text of [
    '周会固定在每周五下午三点。',
    '周会固定在每周五下午四点。',
    '部署流程使用 Docker 和 Kubernetes。',
    '部署流程使用 Docker 和 Helm。',
    '数据库迁移使用 Flyway。',
    '界面配色遵循品牌规范。',
  ]) await brain.remember({ text, scope: 'global' });
  const before = await readFile(brain.file, 'utf8');
  const beforeStat = await stat(brain.file);
  const plan = brain.dreamPlan();
  const afterStat = await stat(brain.file);
  assert.equal(await readFile(brain.file, 'utf8'), before, 'dreamPlan must stay read-only');
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, 'dreamPlan must not touch mtime');
  assert.equal(plan.stats.memories, 6);
  assert.equal(plan.stats.groups, 2);
  assert.equal(plan.stats.covered, 4);
  assert.equal(plan.stats.truncated, false);
  assert.ok(plan.groups.every(group => group.reason === 'similarity' && group.ids.length === 2));
  assert.deepEqual(plan, brain.dreamPlan());
  const context = brain.context({});
  assert.ok(context.includes(BRIEF_HEADER));
  assert.ok(!context.includes('"traits"'));
  assert.ok(!context.includes('"mode"'));
  assert.ok(!context.includes('"warmth"'));
  assert.ok(!context.includes('Soft communication traits'));
  for (const value of [0, 0.5, 1]) {
    await brain.setPersonality({ traits: Object.fromEntries(TRAITS.map(trait => [trait, value])) });
    const extreme = brain.context({});
    assert.ok(extreme.length <= brain.maxContextChars, `context exceeds the character budget at ${value}`);
    assert.ok(extreme.includes(BRIEF_HEADER));
    assert.ok(extreme.includes('周会固定在每周五下午三点'), 'memory section must survive the style budget');
  }
  const stable = await readFile(brain.file, 'utf8');
  const human = await runCommand(brain, undefined, 'dream');
  assert.match(human, /2 candidate group\(s\), 4\/6 memories covered/);
  assert.match(human, /group 1 \(similarity\): /);
  assert.match(human, /周会固定在每周五下午/);
  const json = JSON.parse(await runCommand(brain, undefined, 'dream --json'));
  assert.equal(json.stats.groups, 2);
  assert.ok(Array.isArray(json.groups) && json.payload.memories.length === 4);
  await assert.rejects(runCommand(brain, undefined, 'dream --raw'), /only --json/);
  assert.equal(await readFile(brain.file, 'utf8'), stable, 'dream commands must stay read-only');
});
