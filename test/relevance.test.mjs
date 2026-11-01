import test from 'node:test';
import assert from 'node:assert/strict';
import { terms } from '../lib/text.js';
import { B, HISTORY_WEIGHT, K1, REL_FLOOR, SMALL_STORE, SPECIFIC_RATIO, STOPWORDS, WEAK_MAX, buildRelevanceIndex, queryUnits, selectRelevant } from '../lib/relevance.js';

const AT = '2026-10-01T00:00:00Z';
const TOPICS = {
  login: ['登录接口超时阈值设为 30 秒，配置在 auth.yaml', '登录失败三次后锁定账户十五分钟', '登录模块的测试用 mock 的 OAuth 服务器', '登录页的验证码由前端渲染', '登录 token 刷新走 /auth/refresh 接口'],
  ci: ['CI 流水线用 GitHub Actions，配置在 .github/workflows', 'CI 的测试矩阵覆盖 Node 22 和 24', 'CI 缓存 key 包含 package-lock 哈希', 'CI 失败时自动重跑一次网络相关测试', 'CI 发布任务只在 tag 推送时触发'],
  db: ['数据库用 PostgreSQL 16，连接池上限 20', '数据库迁移脚本放在 migrations 目录', '数据库测试使用独立的 schema', '数据库备份每天凌晨三点执行', '数据库连接超时 5 秒，配置通过环境变量注入'],
  settings: ['设置页面用 schemastery 生成表单', '设置页面的保存按钮需要二次确认', '设置页面配置项按分组折叠显示', '设置页面的测试覆盖 volatile 更新', '设置页面不允许修改数据目录'],
  release: ['发布流程先跑 verify 再打 tag', '发布到 npm 需要浏览器 2FA', '发布说明写在 docs/releases 目录', '发布后要校验 tarball 的 SHA256', '发布流程由 CI 的 tag 触发'],
  memory: ['记忆检索使用中文二元组分词', '记忆注入上限是 10 条和 6000 字符', '记忆去重的相似度阈值是 0.75', '记忆的测试使用临时目录', '记忆配置项包括 maxContextMemories'],
};
const GLOBALS = ['我喜欢先给结论再解释', '代码注释请用英文'];
// Ids sort in insertion order within each topic; every record shares one updatedAt.
const records = [
  ...Object.entries(TOPICS).flatMap(([topic, texts]) => texts.map((text, n) => ({ id: `${topic}-${n + 1}`, text, kind: 'fact', scope: 'workspace', updatedAt: AT }))),
  ...GLOBALS.map((text, n) => ({ id: `global-${n + 1}`, text, kind: 'preference', scope: 'global', updatedAt: AT })),
];
const index = buildRelevanceIndex(records);
const ids = list => list.map(record => record.id);
const select = (query, history = [], keep = []) => ids(selectRelevant(index, { query, history, keep }));
const LOGIN = ['login-1', 'login-5'];

test('relevance constants and corpus size match the calibrated policy', () => {
  assert.deepEqual({ K1, B, HISTORY_WEIGHT, SMALL_STORE, SPECIFIC_RATIO, REL_FLOOR, WEAK_MAX }, { K1: 1.2, B: 0.75, HISTORY_WEIGHT: 0.5, SMALL_STORE: 20, SPECIFIC_RATIO: 0.05, REL_FLOOR: 0.35, WEAK_MAX: 3 });
  assert.equal(index.N, 32);
  assert.ok(index.avg >= 1);
});

test('empty and contentless turns select nothing', () => {
  assert.deepEqual(select(''), []);
  for (const query of ['继续', '好的', '嗯', 'ok continue', '帮我看看']) assert.deepEqual(select(query), [], query);
});

test('a specific question selects its strong matches first', () => {
  assert.deepEqual(select('登录接口超时怎么办'), LOGIN);
  assert.deepEqual(select('数据库连接池满了'), ['db-1', 'db-5', 'db-3']);
  assert.deepEqual(select('发布流程怎么走'), ['release-5', 'release-1']);
});

test('a generic word yields at most three weak matches', () => {
  assert.deepEqual(select('这个测试怎么过'), ['ci-2', 'memory-4', 'settings-4']);
  assert.deepEqual(select('改一下这个配置'), ['memory-5', 'ci-1', 'settings-3']);
  assert.deepEqual(select('登录'), ['login-5', 'login-3', 'login-4']);
});

test('incumbents stay through a contentless turn and history corroborates weak matches', () => {
  assert.deepEqual(select('继续', ['登录接口老是超时，帮我看看'], LOGIN), LOGIN);
  assert.deepEqual(select('测试要跟着改吗', ['登录接口老是超时，帮我看看', '看下 auth.yaml 里的超时配置']), ['login-3']);
});

test('a topic switch puts new strong matches ahead of the retained incumbents', () => {
  assert.deepEqual(select('现在看看数据库连接池满了的问题', ['登录接口老是超时', '看下 auth.yaml'], LOGIN), ['db-1', 'db-5', ...LOGIN]);
});

test('unknown incumbent ids are ignored', () => {
  assert.deepEqual(select('继续', [], ['login-1', 'gone-id']), ['login-1']);
});

test('weak picks do not pile up when every step keeps the previous output', () => {
  let keep = [];
  for (let step = 0; step < 4; step++) {
    keep = select('这个测试怎么过', [], keep);
    assert.deepEqual(keep, ['ci-2', 'memory-4', 'settings-4'], `step ${step + 1}`);
  }
  // A weak incumbent uses one of the weak slots.
  assert.deepEqual(select('这个测试怎么过', [], ['ci-4']), ['ci-4', 'ci-2', 'memory-4']);
});

test('history orders and corroborates but never moves the relevance floor', () => {
  assert.deepEqual(select('PostgreSQL 的配置要改吗'), ['db-1', 'memory-5', 'ci-1', 'settings-3']);
  assert.deepEqual(select('PostgreSQL 的配置要改吗', ['登录接口超时阈值设为 30 秒，配置在 auth.yaml，这个阈值是不是太短了']), ['db-1', 'login-1', 'db-5', 'ci-1']);
});

test('one word of three or more characters is a single match', () => {
  assert.deepEqual(select('数据库'), ['db-1', 'db-3', 'db-2']);
  assert.deepEqual(select('设置页面'), ['settings-1', 'settings-4', 'settings-2']);
  assert.deepEqual(select('数据库连接'), ['db-5', 'db-1', 'db-3', 'db-2', 'db-4']);
  // Overlapping bigrams of one word form one stretch of three characters.
  assert.deepEqual(queryUnits('数据库'), [{ run: true, terms: ['数据', '据库'] }]);
});

test('acknowledgements, option picks and particle bigrams select nothing', () => {
  const extra = buildRelevanceIndex([...records,
    { id: 'x-ack1', text: '配置类的继承关系要画成图', updatedAt: AT }, { id: 'x-ack2', text: '收到告警后先看监控面板', updatedAt: AT },
    { id: 'x-next', text: '前端用 Next.js 14 的 app router', updatedAt: AT }, { id: 'x-thanks', text: 'thanks 页面在支付成功后展示', updatedAt: AT },
    { id: 'x-two', text: '灰度比例先开 2 个百分点', updatedAt: AT }, { id: 'x-plan', text: '缓存方案选 Redis 集群', updatedAt: AT }]);
  const pick = query => ids(selectRelevant(extra, { query }));
  for (const query of ['好的继续', '收到', 'ok, next', 'thanks', '2', '选 2', '方案 2', '没问题', '可以了', '就这样吧']) assert.deepEqual(pick(query), [], query);
  assert.deepEqual(pick('Next.js 路由怎么配'), ['x-next']);
  assert.deepEqual(pick('缓存方案怎么选'), ['x-plan', 'ci-3']);
  assert.deepEqual(pick('告警之后看哪里'), ['x-ack2']);
});

test('history alone never adds a memory', () => {
  assert.deepEqual(select('继续', ['登录接口老是超时，帮我看看', '看下 auth.yaml 里的超时配置']), []);
});

test('a small store treats every match as strong and breaks score ties by recency', () => {
  const small = buildRelevanceIndex([
    { id: 'orbit', text: 'ORBIT deployment', updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'nebula', text: 'NEBULA deployment', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'chinese', text: '我喜欢中文回答', updatedAt: '2026-10-01T00:00:00Z' },
  ]);
  assert.deepEqual(ids(selectRelevant(small, { query: 'deployment' })), ['nebula', 'orbit']);
});

test('selection is deterministic for identical inputs', () => {
  const options = { query: '现在看看数据库连接池满了的问题', history: ['登录接口老是超时', '看下 auth.yaml'], keep: LOGIN };
  const first = ids(selectRelevant(index, options));
  assert.deepEqual(ids(selectRelevant(index, options)), first);
  assert.deepEqual(ids(selectRelevant(buildRelevanceIndex(records), options)), first);
});

test('a query made only of stopwords selects nothing', () => {
  const query = '这个 怎么 继续 吗 the and please continue';
  assert.ok(terms(query).every(term => STOPWORDS.has(term)), 'every query term must be a stopword');
  assert.deepEqual(select(query), []);
});

test('generic single terms never yield more than three matches', () => {
  // Every indexed term found in more than max(2, 5% of N) records is weak alone.
  const generic = [...index.postings].filter(([term, posting]) => posting.length > Math.max(2, SPECIFIC_RATIO * index.N) && terms(term).length === 1 && terms(term)[0] === term).map(([term]) => term);
  assert.ok(generic.length >= 5);
  for (const query of generic) assert.ok(select(query).length <= WEAK_MAX, query);
  // Incumbents that do not match the turn are not weak and leave the weak slots free.
  const result = select('测试', [], ['release-1', 'release-2']);
  assert.deepEqual(result.slice(0, 2), ['release-1', 'release-2']);
  assert.equal(result.length, 2 + WEAK_MAX);
});

test('a word repeated in the query is still one match', () => {
  assert.deepEqual(select('登录还是登录'), select('登录'));
  assert.deepEqual(select('登录还是登录'), ['login-5', 'login-3', 'login-4']);
  assert.deepEqual(select('CI 和 CI 有啥区别'), ['ci-2', 'ci-3', 'release-5']);
  assert.deepEqual(select('这个测试和那个测试有什么区别'), ['ci-2', 'memory-4', 'settings-4']);
});

test('one concept adds at most three memories in a large store', () => {
  // Reviewer generator: 插件市场 in 20 of 500 memories (4%, under SPECIFIC_RATIO).
  const records = [];
  for (let i = 0; i < 20; i++) records.push({ id: `p-${String(i).padStart(2, '0')}`, text: `插件市场第${i}条：${['安装流程', '卸载步骤', '版本兼容', '签名校验', '缓存目录'][i % 5]}说明`, updatedAt: AT });
  const filler = ['网络代理', '日志轮转', '字体渲染', '快捷键位', '主题配色', '窗口布局', '剪贴板', '通知中心', '更新通道', '崩溃报告'];
  for (let i = 0; i < 480; i++) records.push({ id: `o-${String(i).padStart(3, '0')}`, text: `${filler[i % 10]}备注编号${String.fromCodePoint(0x4e00 + i * 7)}${String.fromCodePoint(0x4e00 + i * 11)}`, updatedAt: AT });
  const large = buildRelevanceIndex(records);
  for (const query of ['插件市场', '插件市场怎么样了']) {
    const result = ids(selectRelevant(large, { query }));
    assert.equal(result.length, 3, query);
    assert.ok(result.every(id => id.startsWith('p-')), query);
  }
});

test('a common long phrase adds at most three memories', () => {
  // Reviewer generator: 20 of 100 memories start with 数据库连接.
  const records = [];
  const tails = ['超时要重试', '池满了要扩容', '字符串放在 env', '泄漏要排查', '失败要告警'];
  for (let i = 0; i < 20; i++) records.push({ id: `c-${String(i).padStart(2, '0')}`, text: `数据库连接${tails[i % 5]}（第${'甲乙丙丁戊己庚辛壬癸'[i % 10]}${'子丑寅卯辰巳午未申酉'[Math.floor(i / 2) % 10]}条）`, updatedAt: AT });
  const filler = ['网络代理', '日志轮转', '字体渲染', '快捷键位', '主题配色', '窗口布局', '剪贴板', '通知中心', '更新通道', '崩溃报告'];
  for (let i = 0; i < 80; i++) records.push({ id: `o-${String(i).padStart(3, '0')}`, text: `${filler[i % 10]}备注${String.fromCodePoint(0x4e00 + i * 7)}${String.fromCodePoint(0x4e00 + i * 11)}`, updatedAt: AT });
  const phrases = buildRelevanceIndex(records);
  for (const query of ['数据库连接', '数据库连接池满了怎么办', '数据库连接超时要重试吗']) {
    const result = ids(selectRelevant(phrases, { query }));
    assert.equal(result.length, 3, query);
    assert.ok(result.every(id => id.startsWith('c-')), query);
  }
});

test('history cannot lift a candidate over the current-turn floor', () => {
  // y matches the turn through one specific word but is long, so its current
  // score is far below the floor; forty shared history words would lift its total above it.
  const words = Array.from({ length: 40 }, (_, i) => `hw${i}`);
  const store = buildRelevanceIndex([
    { id: 'x', text: 'alpha bravo', updatedAt: AT },
    { id: 'y', text: `alpha ${words.join(' ')}`, updatedAt: AT },
    ...Array.from({ length: 18 }, (_, i) => ({ id: `f-${i}`, text: `filler${i} note${i} entry${i}`, updatedAt: AT })),
  ]);
  assert.equal(store.N, 20);
  assert.deepEqual(ids(selectRelevant(store, { query: 'alpha bravo' })), ['x']);
  assert.deepEqual(ids(selectRelevant(store, { query: 'alpha bravo', history: [words.join(' ')] })), ['x']);
});

test('ignored bigrams stay gaps between independent matches', () => {
  // 置的 and 的测 are particle bigrams: 配置 and 测试 are two matches, not one stretch.
  assert.deepEqual(queryUnits('配置的测试'), [{ run: true, terms: ['配置', null, null, '测试'] }]);
  const mixed = buildRelevanceIndex([...records, { id: 'x-mixed', text: '测试环境的配置放在 env 目录', updatedAt: AT }]);
  const df = term => mixed.postings.get(term).length;
  assert.ok(mixed.N >= SMALL_STORE && df('配置') > 3 && df('测试') > 3, 'neither word is specific');
  // History makes weak matches need corroboration; x-mixed has none, so only strength admits it.
  assert.deepEqual(ids(selectRelevant(mixed, { query: '配置的测试', history: ['看下 auth.yaml'] })), ['x-mixed', 'login-1']);
});

test('the floor also applies when every candidate is weak', () => {
  const long = `gizmo ${Array.from({ length: 1990 }, (_, i) => String.fromCodePoint(0x4e00 + (i * 7919) % 5000)).join('')}`;
  const store = buildRelevanceIndex([
    { id: 'short', text: 'gizmo 校准', updatedAt: AT },
    { id: 'medium', text: 'gizmo 的安装步骤写在 docs 目录', updatedAt: AT },
    { id: 'long', text: long, updatedAt: AT },
    ...Array.from({ length: 17 }, (_, i) => ({ id: `f-${i}`, text: `filler${i} note${i} entry${i}`, updatedAt: AT })),
  ]);
  assert.ok(store.N >= SMALL_STORE && store.postings.get('gizmo').length > 2, 'gizmo is weak alone');
  assert.ok(long.length <= 2000);
  assert.deepEqual(ids(selectRelevant(store, { query: 'gizmo' })), ['short', 'medium']);
});
