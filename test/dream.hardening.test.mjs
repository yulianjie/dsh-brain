// 对抗性回归装甲：针对 dream/style 的边界与恶意输入。可用 `node test/dream.adversarial.test.mjs` 单跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';
import { runCommand } from '../lib/index.js';
import { BRIEF_HEADER, styleBrief } from '../lib/style.js';
import { groupCandidates, planDream, renderIndexLine, validateDream } from '../lib/dream.js';

const BASE = {
  kind: 'preference', scope: 'global', source: 'adversarial', confidence: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};
const memory = (id, text, extra = {}) => ({ ...BASE, id, text, ...extra });
const pair = () => [memory('a', '用户要求称呼为船长', { updatedAt: '2026-01-01T00:00:00.000Z' }), memory('b', '用户要求称呼为船长', { updatedAt: '2026-01-02T00:00:00.000Z' })];
const planOf = overrides => ({ groups: [{ ids: ['a', 'b'], title: '称呼', line: '用户要求称呼为船长', drop: [], ...overrides }], contradictions: [] });

test('dream: 原型链键名不能混过存在性检查', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => validateDream({ groups: [{ ids: ['a', id], title: 't', line: '用户要求称呼为船长' }] }, pair()), /Invalid dream plan/, id);
    assert.throws(() => validateDream({ contradictions: [{ ids: ['a', id], keep: 'a', reason: 'r' }] }, pair()), /Invalid dream plan/, id);
  }
});

test('dream: null 原型对象是合法 plan，Map 不是', () => {
  const plain = Object.create(null);
  plain.groups = [];
  assert.doesNotThrow(() => validateDream(plain, pair()));
  assert.throws(() => validateDream(new Map(), pair()), /Invalid dream plan/);
});

test('dream: 稀疏数组与 String 对象不能冒充合法字段', () => {
  // eslint-disable-next-line no-sparse-arrays
  const sparse = [memory('a', 'x'), memory('b', 'x')];
  assert.throws(() => validateDream(planOf({ drop: [, 'a'] }), sparse), /Invalid dream plan/);
  assert.throws(() => validateDream({ groups: [{ ids: ['a', 'b'], title: new String('t'), line: 'x' }] }, pair()), /Invalid dream plan/);
});

test('dream: 凭据不能借 style.brief 或 contradicted reason 混入', () => {
  const secrets = ['sk-abcdefghijklmnopqrstuvwx', 'ghp_abcdefghijklmnopqrstuvwxyz012345', 'AKIAABCDEFGHIJKLMNOP', 'password: hunter2'];
  for (const secret of secrets) {
    assert.throws(() => validateDream({ style: { brief: `记住 ${secret}`, basedOn: ['warmth'] } }, pair()), /Invalid dream plan/, secret);
    assert.throws(() => validateDream({ contradictions: [{ ids: ['a', 'b'], keep: 'b', reason: secret }] }, pair()), /Invalid dream plan/, secret);
  }
});

test('dream: 超大 plan 在组数上限处快速拒绝', () => {
  const memories = pair();
  const groups = Array.from({ length: 10000 }, () => ({ ids: ['a', 'b'], title: 't', line: '用户要求称呼为船长' }));
  const started = Date.now();
  assert.throws(() => validateDream({ groups }, memories), /Invalid dream plan/);
  assert.ok(Date.now() - started < 1000, '超大 plan 校验耗时过长');
});

test('dream: updatedAt 非法时仍然确定且可复现', () => {
  const broken = [memory('a', '用户要求称呼为船长', { updatedAt: 'not-a-date' }), memory('b', '用户要求称呼为船长', { updatedAt: 'also-bad' })];
  const attempt = drop => {
    try { return JSON.stringify(validateDream({ groups: [{ ids: ['a', 'b'], title: 't', line: '用户要求称呼为船长', drop }] }, broken)); }
    catch (error) { return `throw:${error.message}`; }
  };
  // 非法时间戳没有语义上的"最新"，但必须有一个确定、可复现的判定。
  assert.equal(attempt(['a']), attempt(['a']));
  assert.equal(attempt(['b']), attempt(['b']));
  // 字符串序里 'also-bad' < 'not-a-date'，因此 b 更旧、可以删；a 被判定为最新、不许删。
  assert.doesNotThrow(() => validateDream({ groups: [{ ids: ['a', 'b'], title: 't', line: '用户要求称呼为船长', drop: ['b'] }] }, broken));
  assert.throws(() => validateDream({ groups: [{ ids: ['a', 'b'], title: 't', line: '用户要求称呼为船长', drop: ['a'] }] }, broken), /Invalid dream plan/);
});

test('dream: 重复 id 的记忆集合被去重而不是产生自环', () => {
  const duplicated = [memory('a', '用户要求称呼为船长'), memory('a', '用户要求称呼为船长'), memory('b', '用户要求称呼为船长')];
  const groups = groupCandidates(duplicated);
  assert.equal(new Set(groups.flatMap(group => group.ids)).size, 2);
  for (const group of groups) assert.equal(new Set(group.ids).size, group.ids.length);
});

test('dream: 孤立代理项不会破坏索引行渲染', () => {
  const line = renderIndexLine({ text: '\uD83D 孤立代理 \uDE00 结尾' });
  assert.equal(typeof line, 'string');
  assert.ok([...line].length <= 60);
  assert.ok(!/^[\uDC00-\uDFFF]/.test(line));
});

test('dream: key 为 __proto__ 时仍按普通字符串成组', () => {
  const groups = groupCandidates([memory('a', '甲', { key: '__proto__' }), memory('b', '乙', { key: '__proto__' })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ids, ['a', 'b']);
});

test('dream: planDream 对空库与单条库返回空计划而不是抛错', () => {
  assert.deepEqual(planDream([]).groups, []);
  assert.deepEqual(planDream([memory('a', '唯一一条')]).groups, []);
  assert.equal(planDream([]).stats.groups, 0);
});

test('风格段：极小预算下不抛错、不超预算、不吞掉可用内容', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'brain-adversarial-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await new Brain({ dataDir }).init();
  for (const budget of [0, 40, 80, 120, 160, 400]) {
    const brain = await new Brain({ dataDir, maxContextChars: budget, maxContextTokens: 4096 }).init();
    const text = brain.context({});
    assert.equal(typeof text, 'string');
    assert.ok(text.length <= budget, `预算 ${budget} 被超出：${text.length}`);
  }
});

test('风格段：极值 traits 的注入长度稳定且不含数值', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'brain-adversarial-extreme-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  for (const value of [0, 1]) {
    await brain.setPersonality({ traits: { warmth: value, verbosity: value, humor: value, proactivity: value, formality: value } });
    const text = brain.context({});
    assert.ok(text.includes(BRIEF_HEADER + styleBrief({ warmth: value, verbosity: value, humor: value, proactivity: value, formality: value })));
    assert.ok(!/\d\.\d/.test(text.replace(/"id":"[^"]+"/g, '')));
  }
});

test('命令：/brain dream 的 JSON 可解析且参数校验严格', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'brain-adversarial-cmd-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  await brain.remember({ text: '用户要求称呼为船长', scope: 'global', kind: 'preference', key: 'k1' });
  await brain.remember({ text: '用户要求称呼船长', scope: 'global', kind: 'preference', key: 'k2' });
  const parsed = JSON.parse(await runCommand(brain, undefined, 'dream --json'));
  assert.ok(Array.isArray(parsed.groups));
  assert.equal(typeof parsed.stats.covered, 'number');
  for (const bad of ['dream --yaml', 'dream --json extra', 'dream whatever']) {
    await assert.rejects(() => runCommand(brain, undefined, bad), /only --json/, bad);
  }
});

test('dream: drop 重复 id 被去重而不是原样回传', () => {
  const out = validateDream({ groups: [{ ids: ['a', 'b'], title: 't', line: '用户要求称呼为船长', drop: ['a', 'a'] }] }, pair());
  assert.deepEqual(out.groups[0].drop, ['a']);
});

test('dream: 控制字符与双向覆盖字符不能进标题、索引行或风格段', () => {
  const nasty = ['\u0000', '\u202E', '\u2066', '\u0007'];
  for (const char of nasty) {
    assert.throws(() => validateDream({ groups: [{ ids: ['a', 'b'], title: `标${char}题`, line: '用户要求称呼为船长' }] }, pair()), /control characters/, JSON.stringify(char));
    assert.throws(() => validateDream({ groups: [{ ids: ['a', 'b'], title: '标题', line: `用户要求${char}称呼为船长` }] }, pair()), /control characters/, JSON.stringify(char));
    assert.throws(() => validateDream({ style: { brief: `记住${char}`, basedOn: ['warmth'] } }, pair()), /control characters/, JSON.stringify(char));
  }
});

test('dream: 单个 CJK 词被替换的伪造就降级，不再靠 0.6 覆盖率放行', () => {
  const memories = [
    memory('a', '周会固定在每周五下午三点。', { updatedAt: '2026-01-01T00:00:00.000Z' }),
    memory('b', '周会固定在每周五下午三点半。', { updatedAt: '2026-01-02T00:00:00.000Z' }),
  ];
  const spoofed = validateDream({ groups: [{ ids: ['a', 'b'], title: '周会', line: '周会固定在每周五下午四点。', drop: [] }] }, memories);
  assert.deepEqual(spoofed.degraded, [{ ids: ['a', 'b'], reason: 'unfaithful-line' }]);
  const quoted = validateDream({ groups: [{ ids: ['a', 'b'], title: '周会', line: '周会固定在每周五下午三点。', drop: [] }] }, memories);
  assert.deepEqual(quoted.degraded, []);
});

test('dream: 损坏或缺失的存储给出可操作错误而不是 SyntaxError', async t => {
  const { writeFile, rm } = await import('node:fs/promises');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'brain-adversarial-corrupt-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir }).init();
  await brain.remember({ text: '用户要求称呼为船长', scope: 'global' });
  await writeFile(brain.file, '{not json', 'utf8');
  assert.throws(() => brain.dreamPlan(), /Invalid or corrupt Brain state/);
  await rm(brain.file);
  assert.throws(() => brain.dreamPlan(), /Brain store is missing/);
});

test('预算：窄预算下记忆优先于风格段，绝不出现"只有风格没有记忆"', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'brain-adversarial-budget-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const seed = await new Brain({ dataDir }).init();
  await seed.remember({ text: '用户要求称呼为船长', scope: 'global', kind: 'preference' });
  for (const budget of [246, 300, 329, 500]) {
    const brain = await new Brain({ dataDir, maxContextChars: budget, maxContextTokens: 4096 }).init();
    const text = brain.context({});
    assert.ok(text.length <= budget, `预算 ${budget} 被超出：${text.length}`);
    if (budget >= 284) assert.ok(text.includes('称呼为船长'), `预算 ${budget} 丢失了能装下的记忆`);
  }
  // 300 是典型的临界值：HEAD 上能装下记忆，风格段必须让位。
  const tight = await new Brain({ dataDir, maxContextChars: 300, maxContextTokens: 4096 }).init();
  assert.ok(tight.context({}).includes('称呼为船长'));
});
