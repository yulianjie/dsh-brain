// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * 对抗性回归装甲（红队）。
 * 只固化「当前实现确实通过」的攻防行为；任何疑似缺陷不进本文件，见审查报告。
 * 运行：node test/dream.adversarial.test.mjs（本机沙箱下 node --test 会 EPERM）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';
import { runCommand } from '../lib/index.js';
import { BRIEF_HEADER, STYLE_BRIEF_MAX, styleBrief, traitBand } from '../lib/style.js';
import { TRAITS } from '../lib/extraction.js';
import { dreamPayload, groupCandidates, planDream, renderIndexLine, validateDream } from '../lib/dream.js';

const record = (id, text, { updatedAt = '2026-10-01T00:00:00.000Z', scope = 'global', workspace, key } = {}) => ({
  id, text, kind: 'fact', scope, ...(workspace ? { workspace } : {}), source: 'synthetic', confidence: 1,
  createdAt: updatedAt, updatedAt, ...(key ? { key } : {}),
});
const fixture = () => [
  record('a', '周会固定在每周五下午三点。', { updatedAt: '2026-10-01T00:00:00.000Z' }),
  record('b', '周会固定在每周五下午三点半。', { updatedAt: '2026-10-02T00:00:00.000Z' }),
  record('c', '部署流程使用 Docker。', { updatedAt: '2026-10-03T00:00:00.000Z' }),
  record('d', '部署流程使用 Docker 和 Compose。', { updatedAt: '2026-10-04T00:00:00.000Z' }),
];
const newestOf = (memories, ids) => ids.map(id => memories.find(item => item.id === id))
  .reduce((left, right) => (left.updatedAt >= right.updatedAt ? left : right));
const rejected = (plan, pattern, memories = fixture()) => assert.throws(
  () => validateDream(plan, memories),
  error => {
    assert.ok(error instanceof Error);
    assert.equal(error.constructor, Error, `must be a plain Error, got ${error.constructor.name}`);
    assert.match(error.message, /^Invalid dream plan:/);
    if (pattern) assert.match(error.message, pattern);
    return true;
  },
);

test('dream: 非普通对象或带原型链键名的 plan 整份拒绝', () => {
  for (const plan of [null, undefined, [], new Map(), new Date(0), () => {}, Symbol('x'), 42, 'plan', true]) {
    rejected(plan);
  }
  rejected(Object.assign(Object.create({ inherited: true }), { groups: [] }));
  rejected(JSON.parse('{"__proto__":{"groups":[]}}'), /unexpected field/);
  rejected(JSON.parse('{"constructor":1}'), /unexpected field/);
  // 继承来的键不算自有键，但仍然不是「普通对象」，必须拒绝。
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    rejected(JSON.parse(`{"${key}":[]}`), /unexpected field/);
  }
});

test('dream: ids 里的原型链名字不能混过存在性检查', () => {
  for (const id of ['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
    rejected({ groups: [{ ids: [id, 'a'], title: 't', line: '周会固定在每周五下午三点。' }] }, /unknown memory/);
  }
});

test('dream: 并列最新时间戳时 drop 一个都不许删，keep 任一最新都合法', () => {
  const tied = [
    record('a', '周会固定在每周五下午三点。', { updatedAt: '2026-10-02T00:00:00Z' }),
    record('b', '周会固定在每周五下午三点半。', { updatedAt: '2026-10-02T00:00:00.000Z' }),
  ];
  for (const drop of [['a'], ['b'], ['b', 'b']]) {
    rejected({ groups: [{ ids: ['a', 'b'], title: 't', line: '周会固定在每周五下午三点。', drop }] }, /most recently updated/, tied);
  }
  rejected({ contradictions: [{ ids: ['a', 'b'], keep: 'a', reason: '保留旧值' }] }, /most recently updated/, [
    record('a', '周会固定在每周五下午三点。', { updatedAt: '2026-10-01T00:00:00.000Z' }),
    record('b', '周会固定在每周五下午三点半。', { updatedAt: '2026-10-02T00:00:00.000Z' }),
  ]);
  const kept = validateDream({ contradictions: [{ ids: ['a', 'b'], keep: 'b', reason: '同一时刻，任一保留' }] }, tied);
  assert.equal(kept.contradictions[0].keep, 'b');
});

test('dream: drop 的畸形形态不能绕过子集与最新保护', () => {
  const base = { groups: [{ ids: ['a', 'b'], title: 't', line: '周会固定在每周五下午三点。' }] };
  rejected({ groups: [{ ...base.groups[0], drop: new Set(['a']) }] }, /must be an array/);
  rejected({ groups: [{ ...base.groups[0], drop: [, 'a'] }] }, /subset/);
  rejected({ groups: [{ ...base.groups[0], drop: ['missing'] }] }, /subset/);
  rejected({ groups: [{ ...base.groups[0], drop: [1] }] }, /subset/);
  rejected({ groups: [{ ...base.groups[0], drop: 'a' }] }, /must be an array/);
});

test('dream: 畸形输入只抛带 Invalid dream plan: 前缀的普通 Error', () => {
  const base = { groups: [{ ids: ['a', 'b'], title: 't', line: '周会固定在每周五下午三点。' }] };
  const cases = [
    { ...base, groups: [null] },
    { ...base, groups: [new Map()] },
    { ...base, groups: [{ ids: [Symbol('a')], title: 't', line: 'x' }] },
    { ...base, groups: [{ ids: [1n], title: 't', line: 'x' }] },
    { ...base, groups: [{ ids: ['a', 'b'], title: 1n, line: 'x' }] },
    { ...base, groups: [{ ids: ['a', 'b'], title: () => {}, line: 'x' }] },
    { ...base, groups: [{ ids: ['a', 'b'], title: 't', line: Symbol('x') }] },
    { ...base, style: new Map() },
    { ...base, style: { brief: 'x', basedOn: new Set(['warmth']) } },
    { ...base, contradictions: [null] },
    { ...base, contradictions: [{ ids: ['a', 'b'], keep: 'b', reason: 0 }] },
  ];
  for (const plan of cases) rejected(plan);
  rejected(base, /Invalid dream plan:/, 'not memories');
});

test('dream: 同一 id 跨 group/contradiction 复用与跨 scope 成组都被拒', () => {
  rejected({
    groups: [{ ids: ['a', 'b'], title: 't', line: '周会固定在每周五下午三点。' }],
    contradictions: [{ ids: ['a', 'b'], keep: 'b', reason: '重复使用 a' }],
  }, /more than one entry/);
  const mixed = [
    record('a', '周会固定在每周五下午三点。'),
    record('b', '周会固定在每周五下午三点半。', { scope: 'workspace', workspace: path.resolve('project-b') }),
  ];
  rejected({ groups: [{ ids: ['a', 'b'], title: 't', line: '周会固定在每周五下午三点。' }] }, /mixes scopes or workspaces/, mixed);
});

test('dream: 编造的索引行被降级而不是放行', () => {
  const memories = [
    record('r1', '项目使用 Rust 编写。'),
    record('r2', '项目使用 Rust 和 Tokio。', { updatedAt: '2026-10-02T00:00:00.000Z' }),
  ];
  const fabricate = line => validateDream({ groups: [{ ids: ['r1', 'r2'], title: '技术栈', line }] }, memories);
  // 只换一个 ASCII 词：Rust → Go 级别的伪造必须降级。
  const swapped = fabricate('项目使用 Go 编写。');
  assert.deepEqual(swapped.degraded, [{ ids: ['r1', 'r2'], reason: 'unfaithful-line' }]);
  assert.equal(swapped.groups[0].line, renderIndexLine(newestOf(memories, ['r1', 'r2'])));
  // 全连接词、零覆盖率同样降级。
  assert.equal(fabricate('用户要求').degraded.length, 1);
  // 忠实原文不降级。
  const exact = fabricate('项目使用 Rust 编写。');
  assert.deepEqual(exact.degraded, []);
  assert.equal(exact.groups[0].line, '项目使用 Rust 编写。');
});

test('dream: 凭据出现在 line/title/brief/reason 任一字段都必须拒绝', () => {
  const memories = fixture();
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const cases = [
    { groups: [{ ids: ['a', 'b'], title: 't', line: 'sk-abcdefghijklmnopqrst' }] },
    { groups: [{ ids: ['a', 'b'], title: 'ghp_abcdefghijklmnopqrst', line: '周会固定在每周五下午三点。' }] },
    { groups: [{ ids: ['a', 'b'], title: 't', line: '密码：abcd1234' }] },
    { groups: [{ ids: ['a', 'b'], title: 't', line: 'password: hunter2' }] },
    { style: { brief: jwt, basedOn: ['warmth'] } },
    { contradictions: [{ ids: ['a', 'b'], keep: 'b', reason: 'token: ghp_abcdefghijklmnopqrst' }] },
  ];
  for (const plan of cases) rejected(plan, /credential/, memories);
});

test('dream: 超大 group 数在上限处快速失败而不是遍历全部 id', () => {
  const memories = [record('m0', '记录零'), record('m1', '记录一')];
  const groups = Array.from({ length: 10000 }, () => ({ ids: ['m0', 'm1'], title: 't', line: '记录零' }));
  const started = Date.now();
  rejected({ groups }, /groups exceeds/, memories);
  assert.ok(Date.now() - started < 2000, 'oversized plan must fail fast');
  assert.throws(() => validateDream({ groups: [{}], contradictions: [] }, memories, { maxGroups: 0 }), /groups exceeds/);
});

test('dream: 同一输入两次校验结果一致，且不修改入参', () => {
  const memories = fixture();
  const plan = {
    groups: [{ ids: ['a', 'b'], title: '周会', line: '完全编造的句子。', drop: ['a'] }],
    contradictions: [{ ids: ['c', 'd'], keep: 'd', reason: 'd 较新' }],
  };
  const snapshot = JSON.stringify(plan);
  const first = validateDream(plan, memories);
  const second = validateDream(plan, memories);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(plan), snapshot, 'validateDream must not mutate the plan');
  assert.equal(first.degraded.length, 1);
  assert.deepEqual(first.contradictions[0], { ids: ['c', 'd'], keep: 'd', reason: 'd 较新' });
});

test('dream: 聚类结构合法，组内 id 唯一且都在 2..20 内', () => {
  const memories = [
    record('e1', '😀'), record('e2', '😀'),
    record('p1', '。。。'), record('p2', '。。。'),
    record('z1', ''), record('z2', ''),
    ...Array.from({ length: 25 }, (_, index) => record(`m${String(index).padStart(2, '0')}`, `用户要求回答简洁一些（第${index}次）`)),
  ];
  const groups = groupCandidates(memories);
  for (const group of groups) {
    assert.ok(Array.isArray(group.ids));
    assert.ok(group.ids.length >= 2 && group.ids.length <= 20, `bad group size ${group.ids.length}`);
    assert.equal(new Set(group.ids).size, group.ids.length, 'duplicate id inside a group');
    assert.ok(group.ids.every(id => memories.some(item => item.id === id)));
    assert.ok(['key', 'similarity'].includes(group.reason));
    const scopes = new Set(group.ids.map(id => `${memories.find(item => item.id === id).scope}/${memories.find(item => item.id === id).workspace ?? ''}`));
    assert.equal(scopes.size, 1, 'group must not cross scope/workspace');
  }
  assert.deepEqual(groups.map(group => group.ids.length), [...groups.map(group => group.ids.length)].sort((a, b) => b - a));
  assert.deepEqual(groupCandidates(memories), groups, 'grouping must be deterministic');
  const plan = planDream(memories);
  assert.equal(plan.stats.groups, groups.length);
  assert.equal(plan.stats.covered, new Set(groups.flatMap(group => group.ids)).size);
  assert.equal(plan.stats.promptChars, JSON.stringify(plan.payload).length);
});

test('dream: 空 key 与仅大小写不同的工作区不会被误合并', () => {
  assert.deepEqual(groupCandidates([record('k1', '甲', { key: '' }), record('k2', '乙', { key: '' })]), []);
  assert.deepEqual(groupCandidates([
    record('w1', '同一句', { scope: 'workspace', workspace: 'C:\\W' }),
    record('w2', '同一句', { scope: 'workspace', workspace: 'c:\\w' }),
  ]), []);
  assert.deepEqual(groupCandidates([
    record('q1', '甲', { key: 'k' }),
    record('q2', '乙', { key: 'k', scope: 'workspace', workspace: 'C:\\W' }),
  ]), []);
});

test('dream: 相似度合并是并查集传递闭包且顺序稳定', () => {
  const memories = [
    record('t1', 'alpha beta gamma'),
    record('t2', 'alpha beta gamma delta'),
    record('t3', 'beta gamma delta epsilon'),
  ];
  const groups = groupCandidates(memories, { threshold: 0.2 });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ids, ['t1', 't2', 't3']);
  assert.deepEqual(groups[0].ids, [...groups[0].ids].sort());
});

test('dream: maxGroups 截断保留排序最靠前的组', () => {
  const memories = [
    record('k1a', '甲一', { key: 'k1' }), record('k1b', '甲二', { key: 'k1' }), record('k1c', '甲三', { key: 'k1' }),
    record('k2a', '乙一', { key: 'k2' }), record('k2b', '乙二', { key: 'k2' }),
    record('k3a', '丙一', { key: 'k3' }), record('k3b', '丙二', { key: 'k3' }),
  ];
  const plan = planDream(memories, { maxGroups: 1 });
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0].ids, ['k1a', 'k1b', 'k1c']);
  assert.equal(plan.stats.covered, 3);
});

test('dream: 空库/单条/极小 payload 预算下正常且有界', () => {
  const empty = planDream([]);
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(empty.stats, { memories: 0, groups: 0, covered: 0, promptChars: empty.stats.promptChars, truncated: false });
  assert.ok(JSON.stringify(empty.payload).length < 100);

  const single = planDream([record('a', '单条记录。')]);
  assert.deepEqual(single.groups, []);

  const payload = dreamPayload([{ ids: ['a', 'b'], key: null }], [record('a', '甲'), record('b', '乙')], { maxMemories: 1 });
  assert.deepEqual(payload, { groups: [], memories: [] });
  assert.ok(JSON.stringify(payload).length < 100);
});

test('dream: planDream 的结果能直接喂给 validateDream 而不产生结构错误', () => {
  const memories = fixture();
  const plan = planDream(memories);
  assert.equal(plan.groups.length, 2);
  const candidate = {
    groups: plan.groups.map(group => {
      const newest = newestOf(memories, group.ids);
      return { ids: [...group.ids], title: renderIndexLine(newest, { max: 40 }), line: renderIndexLine(newest) };
    }),
  };
  const result = validateDream(candidate, memories);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.degraded, []);
  assert.ok(result.groups.every(group => group.drop.length === 0));
  assert.equal(plan.stats.promptChars, JSON.stringify(plan.payload).length);
});

test('style: 0.35/0.65 属 mid，邻域浮点不越档', () => {
  assert.equal(traitBand(0.35), 'mid');
  assert.equal(traitBand(0.65), 'mid');
  assert.equal(traitBand(0.3499999), 'low');
  assert.equal(traitBand(0.3500001), 'mid');
  assert.equal(traitBand(0.6499999), 'mid');
  assert.equal(traitBand(0.6500001), 'high');
  assert.equal(styleBrief({ warmth: 0.35 }), styleBrief({}));
  assert.equal(styleBrief({ warmth: 0.65 }), styleBrief({}));
});

test('style: -0/MIN_VALUE/1e-9/0.999999 落在正确档且不泄露数值', () => {
  const low = styleBrief({ warmth: 0 });
  for (const value of [-0, Number.MIN_VALUE, 1e-9, -1e-9]) {
    assert.equal(styleBrief({ warmth: value }), low, `value ${value}`);
  }
  assert.equal(styleBrief({ warmth: 0.999999 }), styleBrief({ warmth: 1 }));
  for (const value of [-0, Number.MIN_VALUE, 1e-9, 0.999999]) {
    assert.doesNotMatch(styleBrief({ warmth: value }), /\d/);
  }
});

test('style: 五维顺序固定，绝不重复拼句', () => {
  const allLow = styleBrief(Object.fromEntries(TRAITS.map(trait => [trait, 0])));
  const allHigh = styleBrief(Object.fromEntries(TRAITS.map(trait => [trait, 1])));
  const lowSentences = {
    warmth: '语气克制：直述事实与结论，不寒暄。',
    verbosity: '回答偏简短：先给结论，最多补一两句理由。',
    humor: '不使用玩笑或调侃。',
    proactivity: '只回答被问到的内容，不主动扩展。',
    formality: '用口语化表达，允许短句。',
  };
  const highSentences = {
    warmth: '语气偏暖：先接住对方处境，再给建议。',
    verbosity: '回答偏详细：给步骤、取舍与必要示例。',
    humor: '可以适度幽默，但技术判断保持严肃。',
    proactivity: '结尾主动给一条相关的下一步建议。',
    formality: '用正式、完整的书面表达。',
  };
  assert.equal(allLow, TRAITS.map(trait => lowSentences[trait]).join(''));
  assert.equal(allHigh, TRAITS.map(trait => highSentences[trait]).join(''));
  const parts = allLow.split('。').filter(Boolean);
  assert.equal(parts.length, 5);
  assert.equal(new Set(parts).size, 5, 'the same sentence must not be emitted twice');
});

test('style: 码点预算与禁用词在极端组合下仍成立', () => {
  for (let mask = 0; mask < 32; mask++) {
    const traits = Object.fromEntries(TRAITS.map((trait, index) => [trait, mask & (1 << index) ? 1 : 0]));
    const brief = styleBrief(traits);
    assert.ok(Array.from(brief).length <= STYLE_BRIEF_MAX);
    assert.doesNotMatch(brief, /\d\.\d/);
    assert.ok(!brief.includes('{') && !brief.includes('}'));
    assert.ok(!brief.includes('"traits"'));
    assert.ok(!/人格|情绪|意识/.test(brief));
    assert.ok(!/\b(?:traits|warmth|verbosity|humor|proactivity|formality)\b/i.test(brief));
  }
});

test('style: 畸形 traits 一律不抛错并退化为中性', () => {
  const neutral = styleBrief({});
  for (const input of [null, undefined, [], 'warm', 42, true, new Date(0), new String('x'), Object.create(null),
    { unknown: 0.9 }, { warmth: NaN }, { warmth: Infinity }, { warmth: -Infinity }, { warmth: '0.9' },
    { warmth: null }, { warmth: {} }, { warmth: Symbol('x') }, { warmth: 1n }]) {
    assert.doesNotThrow(() => styleBrief(input));
    assert.equal(styleBrief(input), neutral);
  }
});

test('context: 极小字符预算下不抛错、不超预算，风格段可整体省略', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-adv-budget-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  await brain.remember({ text: '预算标记：项目使用 Rust。', scope: 'global' });
  for (const budget of [8000, 400, 200, 120, 60]) {
    await brain.configure({ maxContextChars: budget });
    const context = brain.context({});
    assert.equal(typeof context, 'string');
    assert.ok(context.length <= budget, `budget ${budget} exceeded: ${context.length}`);
    if (budget === 8000) {
      assert.ok(context.includes(BRIEF_HEADER));
      assert.ok(context.includes('预算标记'));
    }
  }
});

test('context: manual 只给一个维度时其余维度按 0.5 处理', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-adv-manual-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  await brain.configure({ personalityMode: 'manual', manualTraits: { warmth: 0.9 }, injectMemories: false });
  const context = brain.context({});
  assert.ok(context.includes(BRIEF_HEADER + '语气偏暖：先接住对方处境，再给建议。'));
  assert.ok(!context.includes('回答偏简短'));
  assert.ok(!context.includes('回答偏详细'));
  assert.ok(!context.includes('不使用玩笑'));
});

test('context: 0/0.5/1 极值不注入数字、JSON 或维度名', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-adv-extreme-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  for (const value of [0, 0.5, 1]) {
    await brain.setPersonality({ traits: Object.fromEntries(TRAITS.map(trait => [trait, value])) });
    const context = brain.context({});
    assert.ok(context.includes(BRIEF_HEADER));
    assert.doesNotMatch(context, /\d/);
    assert.ok(!context.includes('"'));
    assert.ok(!context.includes('warmth'));
    assert.ok(context.length <= brain.maxContextChars);
  }
  await brain.configure({ personalityMode: 'off' });
  assert.ok(!brain.context({}).includes(BRIEF_HEADER));
});

test('dream: /brain dream --json 可 JSON.parse，人类摘要不超 10 组且无控制字符', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-adv-cli-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  for (const text of ['周会固定在每周五下午三点。', '周会固定在每周五下午四点。', '部署使用 Docker。', '部署使用 Docker 和 Helm。', '迁移使用 Flyway。', '配色遵循品牌规范。']) {
    await brain.remember({ text, scope: 'global' });
  }
  const before = await readFile(brain.file, 'utf8');
  const json = await runCommand(brain, undefined, 'dream --json');
  const parsed = JSON.parse(json);
  assert.equal(typeof parsed.stats.groups, 'number');
  assert.ok(Array.isArray(parsed.groups) && Array.isArray(parsed.payload.memories));
  const human = await runCommand(brain, undefined, 'dream');
  assert.match(human.split('\n')[0], /^dream: \d+ candidate group\(s\)/);
  assert.ok(human.split('\n').filter(line => line.startsWith('group ')).length <= 10);
  assert.doesNotMatch(human, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  assert.equal(await readFile(brain.file, 'utf8'), before, 'both dream commands must stay read-only');
});

test('dream: dreamPlan 与 context 交替调用互不污染且都只读', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-adv-purity-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  for (const text of ['周会固定在每周五下午三点。', '周会固定在每周五下午四点。', '部署使用 Docker。', '部署使用 Docker 和 Helm。']) {
    await brain.remember({ text, scope: 'global' });
  }
  const before = await readFile(brain.file, 'utf8');
  const firstContext = brain.context({});
  const plan = brain.dreamPlan();
  const secondContext = brain.context({});
  assert.equal(firstContext, secondContext, 'dreamPlan must not leak into context');
  assert.deepEqual(plan, brain.dreamPlan(), 'dreamPlan must be deterministic');
  assert.equal(await readFile(brain.file, 'utf8'), before);
  assert.equal(plan.stats.memories, 4);
  assert.ok(plan.stats.covered <= plan.stats.memories);
  assert.ok(plan.stats.promptChars <= JSON.stringify(plan.payload).length);
});
