import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { Brain } from '../lib/core.js';
import { BRIEF_HEADER, styleBrief } from '../lib/style.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-core-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const brain = await new Brain({ dataDir, ...options }).init();
  return { brain, dataDir };
}
const learn = (brain, turn, userText = '以后回答请简短一点。', extra = {}) => brain.learn({ sessionId: 'synthetic', turnId: String(turn), userText, ...extra });

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
  assert.ok((await brain.list()).some(r => r.text.includes('简短')));
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
  assert.ok(!brain.context({}).includes('以后回答请简短一点'));
  assert.equal((await brain.personality()).traits.verbosity, 0.5);
  await brain.remember({ text: '人工设置：回答多用类比。', scope: 'global' });
  assert.ok(brain.context({}).includes('回答多用类比'));
});

test('context respects exact character budget and notices concurrent updates', async t => {
  const { brain, dataDir } = await fixture(t, { maxContextChars: 1000 });
  const other = await new Brain({ dataDir }).init();
  await other.remember({ text: '新的跨实例偏好是使用中文。', scope: 'global' });
  assert.ok(brain.context({}).includes('新的跨实例偏好'));
  await other.setPersonality({ traits: { verbosity: 0.25 } });
  assert.ok(brain.context({}).includes(BRIEF_HEADER + styleBrief({ verbosity: 0.25 })));
  assert.ok(!brain.context({}).includes('0.25'));
  for (let i = 0; i < 10; i++) await other.remember({ text: `${i} ${'内容'.repeat(200)}`, scope: 'global' });
  assert.ok(brain.context({}).length <= 1000);
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
  await learn(brain, 1, text); await learn(brain, 2, text); await learn(brain, 3, text);
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

test('corrupt file is reported and never overwritten, init/read-only preserves revision', async t => {
  const { brain, dataDir } = await fixture(t);
  const before = await readFile(brain.file, 'utf8');
  await new Brain({ dataDir }).init();
  assert.equal(await readFile(brain.file, 'utf8'), before);
  await writeFile(brain.file, '{ broken JSON');
  await assert.rejects(new Brain({ dataDir }).init(), /corrupt/);
  assert.equal(await readFile(brain.file, 'utf8'), '{ broken JSON');
});

/** Windows refuses to replace a file that another handle has open. */
function failStoreRename(t, file, failure) {
  const original = fsp.rename;
  fsp.rename = async (from, to, ...rest) => {
    if (path.resolve(to) === path.resolve(file)) await failure();
    return original(from, to, ...rest);
  };
  t.after(() => { fsp.rename = original; });
}
const renameEperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM', syscall: 'rename' });
/** The retry is Windows-only: pretend to run on `platform` for one test. */
function onPlatform(t, platform) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
}

const lockExists = async dataDir => fsp.access(path.join(dataDir, '.brain.lock')).then(() => true, () => false);
const temporaryFiles = async dataDir => (await fsp.readdir(dataDir)).filter(name => name.endsWith('.tmp'));

test('a transient store rename EPERM, EACCES or EBUSY on Windows is retried while the lock is held', async t => {
  const { brain, dataDir } = await fixture(t);
  onPlatform(t, 'win32');
  let calls = 0; const lockChecks = [];
  const transient = [renameEperm(), Object.assign(new Error('EACCES: permission denied, rename'), { code: 'EACCES', syscall: 'rename' }), Object.assign(new Error('EBUSY: resource busy or locked, rename'), { code: 'EBUSY', syscall: 'rename' })];
  failStoreRename(t, brain.file, async () => {
    calls += 1;
    if (calls <= 3) { lockChecks.push(await lockExists(dataDir)); throw transient[calls - 1]; }
  });
  await brain.remember({ text: '写入在 rename EPERM 短暂出现后仍然成功', scope: 'global' });
  assert.equal(calls, 4);
  assert.deepEqual(lockChecks, [true, true, true]);
  const records = await new Brain({ dataDir }).list();
  assert.equal(records.length, 1);
  assert.equal(records[0].text, '写入在 rename EPERM 短暂出现后仍然成功');
  assert.deepEqual(await temporaryFiles(dataDir), []);
  assert.equal(await lockExists(dataDir), false);
});

test('a permanent store rename EPERM still surfaces and leaves the store unchanged', async t => {
  const { brain, dataDir } = await fixture(t);
  const before = await readFile(brain.file, 'utf8');
  onPlatform(t, 'win32');
  brain._renameRetryMs = 100;
  let inject = true, calls = 0;
  failStoreRename(t, brain.file, async () => { calls += 1; if (inject) throw renameEperm(); });
  const started = Date.now();
  await assert.rejects(brain.remember({ text: '永久失败的写入不应破坏存储', scope: 'global' }), error => error.code === 'EPERM' && error.syscall === 'rename');
  assert.ok(Date.now() - started >= 100);
  assert.ok(calls < 200, `the retry must stop at the configured window, saw ${calls} rename calls`);
  assert.equal(await readFile(brain.file, 'utf8'), before);
  assert.deepEqual(await temporaryFiles(dataDir), []);
  assert.equal(await lockExists(dataDir), false);
  inject = false;
  await brain.remember({ text: '永久失败的写入不应破坏存储', scope: 'global' });
});

test('the store rename is not retried off Windows', async t => {
  const { brain, dataDir } = await fixture(t);
  const before = await readFile(brain.file, 'utf8');
  onPlatform(t, 'linux');
  let calls = 0;
  failStoreRename(t, brain.file, async () => { calls += 1; throw renameEperm(); });
  await assert.rejects(brain.remember({ text: '非 Windows 平台不应重试', scope: 'global' }), error => error.code === 'EPERM');
  assert.equal(calls, 1);
  assert.equal(await readFile(brain.file, 'utf8'), before);
  assert.deepEqual(await temporaryFiles(dataDir), []);
  assert.equal(await lockExists(dataDir), false);
});

test('a non-transient store rename error on Windows is not retried', async t => {
  const { brain, dataDir } = await fixture(t);
  const before = await readFile(brain.file, 'utf8');
  onPlatform(t, 'win32');
  let calls = 0;
  failStoreRename(t, brain.file, async () => { calls += 1; throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC', syscall: 'rename' }); });
  await assert.rejects(brain.remember({ text: '非瞬时错误不应重试', scope: 'global' }), error => error.code === 'ENOSPC');
  assert.equal(calls, 1);
  assert.equal(await readFile(brain.file, 'utf8'), before);
  assert.deepEqual(await temporaryFiles(dataDir), []);
  assert.equal(await lockExists(dataDir), false);
});

test('an abort during the store rename retry stops it and leaves the store unchanged', async t => {
  const { brain, dataDir } = await fixture(t);
  const before = await readFile(brain.file, 'utf8');
  onPlatform(t, 'win32');
  const controller = new AbortController();
  let calls = 0;
  failStoreRename(t, brain.file, async () => {
    calls += 1;
    if (calls === 2) controller.abort(new Error('plugin reloaded during rename'));
    throw renameEperm();
  });
  await assert.rejects(learn(brain, 1, '请记住我喜欢乌龙茶。', { signal: controller.signal }), /plugin reloaded during rename/);
  assert.equal(calls, 2);
  assert.equal(await readFile(brain.file, 'utf8'), before);
  assert.deepEqual(await temporaryFiles(dataDir), []);
  assert.equal(await lockExists(dataDir), false);
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

/** Windows reports a lock directory that a concurrent writer is creating or
 * removing at that instant as EPERM/EBUSY instead of EEXIST. */
function failLockMkdir(t, lockDir, failure) {
  const original = fsp.mkdir;
  fsp.mkdir = async (target, ...rest) => {
    if (path.resolve(target) === path.resolve(lockDir)) failure();
    return original(target, ...rest);
  };
  t.after(() => { fsp.mkdir = original; });
}
const lockError = code => Object.assign(new Error(`${code}: lock directory mkdir failed`), { code });
const eperm = () => lockError('EPERM');

test('a transient lock mkdir EPERM is retried instead of failing the write', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-core-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let remaining = 3;
  failLockMkdir(t, path.join(dataDir, '.brain.lock'), () => { if (remaining-- > 0) throw eperm(); });
  const brain = new Brain({ dataDir });
  await brain.init();
  await brain.remember({ text: '写入在锁目录短暂 EPERM 后仍然成功', scope: 'global' });
  assert.equal((await new Brain({ dataDir }).list()).length, 1);
});

test('a transient lock mkdir EBUSY is retried instead of failing the write', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-core-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let remaining = 3;
  failLockMkdir(t, path.join(dataDir, '.brain.lock'), () => { if (remaining-- > 0) throw lockError('EBUSY'); });
  const brain = new Brain({ dataDir });
  await brain.init();
  await brain.remember({ text: '写入在锁目录短暂 EBUSY 后仍然成功', scope: 'global' });
  assert.equal((await new Brain({ dataDir }).list()).length, 1);
});

test('an uncreatable lock directory reports the path instead of a misleading lock owner', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-core-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  failLockMkdir(t, path.join(dataDir, '.brain.lock'), () => { throw eperm(); });
  const brain = new Brain({ dataDir, lockTimeoutMs: 250 });
  await assert.rejects(brain.init(), error => {
    assert.match(error.message, /cannot be created/i);
    assert.match(error.message, /\.brain\.lock/);
    assert.equal(error.code, 'EPERM');
    assert.equal(error.cause?.code, 'EPERM');
    return true;
  });
});

test('a stale EPERM does not misreport a lock timeout once later attempts see EEXIST', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-core-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const lockDir = path.join(dataDir, '.brain.lock');
  const originalMkdir = fsp.mkdir, originalAccess = fsp.access;
  let attempts = 0;
  // Only the first attempt fails with EPERM; every later one reports the directory
  // as present, and access() says it is gone at the timeout instant. Only the
  // latest failure may decide the message, so this must be reported as a lock.
  fsp.mkdir = async (target, ...rest) => {
    if (path.resolve(target) === path.resolve(lockDir)) throw attempts++ === 0 ? lockError('EPERM') : lockError('EEXIST');
    return originalMkdir(target, ...rest);
  };
  fsp.access = async (target, ...rest) => {
    if (path.resolve(target) === path.resolve(lockDir)) throw Object.assign(new Error('ENOENT: no such file or directory, access'), { code: 'ENOENT' });
    return originalAccess(target, ...rest);
  };
  t.after(() => { fsp.mkdir = originalMkdir; fsp.access = originalAccess; });
  const brain = new Brain({ dataDir, lockTimeoutMs: 200 });
  await assert.rejects(brain.init(), error => {
    assert.match(error.message, /Brain store is locked/);
    assert.doesNotMatch(error.message, /cannot be created/i);
    return true;
  });
});

test('unlocking removes the lock directory through fs.rm with bounded retries', async t => {
  const { brain } = await fixture(t);
  const lockDir = path.join(brain.dataDir, '.brain.lock');
  const original = fsp.rm;
  const calls = [];
  fsp.rm = async (target, options) => {
    if (path.resolve(target) === path.resolve(lockDir)) calls.push(options);
    return original(target, options);
  };
  t.after(() => { fsp.rm = original; });
  await brain.remember({ text: '解锁通过 fs.rm 删除锁目录', scope: 'global' });
  const options = calls.at(-1);
  assert.ok(options, 'expected fs.rm to be called for the lock directory');
  assert.equal(options.recursive, true);
  assert.equal(options.force, true);
  assert.equal(options.maxRetries, 4);
  assert.equal(options.retryDelay, 10);
  await assert.rejects(fsp.access(lockDir));
});

test('an existing lock directory is reported as a lock even when mkdir keeps failing', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-core-'));
  const lockDir = path.join(dataDir, '.brain.lock');
  // The directory exists, so the path itself is not the problem: only the
  // visibility of it at the timeout instant separates a lock from a filesystem
  // failure. No owner.json: _staleOwner() reads nothing and reclaims nothing.
  await fsp.mkdir(lockDir);
  const originalMkdir = fsp.mkdir;
  fsp.mkdir = async (target, ...rest) => {
    if (path.resolve(target) === path.resolve(lockDir)) throw eperm();
    return originalMkdir(target, ...rest);
  };
  t.after(async () => {
    fsp.mkdir = originalMkdir;
    await rm(dataDir, { recursive: true, force: true });
  });
  const brain = new Brain({ dataDir, lockTimeoutMs: 200 });
  await assert.rejects(brain.init(), error => {
    assert.match(error.message, /Brain store is locked/);
    assert.doesNotMatch(error.message, /cannot be created/i);
    return true;
  });
});

test('a failed takeover cleanup does not interrupt the write that reclaimed a stale lock', async t => {
  const { brain, dataDir } = await fixture(t);
  const lockDir = path.join(dataDir, '.brain.lock');
  const takeoverDir = path.join(dataDir, '.brain.lock.takeover');
  // A crash left its lock behind: the pid is gone on this host, so the write
  // below reclaims it through the takeover directory.
  await fsp.mkdir(lockDir);
  await writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999, token: 'stale-token', at: Date.now(), host: hostname() }));
  const originalRm = fsp.rm;
  fsp.rm = async (target, options) => {
    if (path.resolve(target) === path.resolve(takeoverDir)) throw eperm();
    return originalRm(target, options);
  };
  t.after(async () => {
    fsp.rm = originalRm;
    await rm(dataDir, { recursive: true, force: true });
  });
  await brain.remember({ text: '接管目录清理失败不应中断写入', scope: 'global' });
  assert.equal((await brain.list()).length, 1);
});
