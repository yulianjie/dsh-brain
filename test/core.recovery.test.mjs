import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promises as fsp } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Brain } from '../lib/core.js';

async function tempDir(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-recovery-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
const exists = file => access(file).then(() => true, () => false);
const lockDir = dataDir => path.join(dataDir, '.brain.lock');
const takeoverDir = dataDir => path.join(dataDir, '.brain.lock.takeover');
const ownerFile = dataDir => path.join(lockDir(dataDir), 'owner.json');
async function writeOwner(dataDir, owner) {
  await mkdir(lockDir(dataDir), { recursive: true });
  await writeFile(ownerFile(dataDir), JSON.stringify(owner));
}
function exitedPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', () => resolve(child.pid));
  });
}
const learn = (brain, turnId, userText) => brain.learn({ sessionId: 'recovery-deadband', turnId, userText });

test('deadband is symmetric at both ends', async t => {
  const dataDir = await tempDir(t);
  const short = await new Brain({ dataDir: path.join(dataDir, 'short') }).init();
  for (let turn = 0; turn < 12; turn++) await learn(short, String(turn), '以后回答简短一点。');
  assert.equal((await short.personality()).traits.verbosity, 0.15);

  const detailed = await new Brain({ dataDir: path.join(dataDir, 'detailed') }).init();
  for (let turn = 0; turn < 12; turn++) await learn(detailed, String(turn), '以后回答详细一点。');
  assert.equal((await detailed.personality()).traits.verbosity, 0.85);
});

test('same-host stale lock from an exited process is reclaimed', async t => {
  const dataDir = await tempDir(t);
  const brain = await new Brain({ dataDir, lockTimeoutMs: 0 }).init();
  const pid = await exitedPid();
  await writeOwner(dataDir, { pid, token: 'stale-token', at: Date.now(), host: hostname() });
  await brain.remember({ text: 'recovered write', scope: 'global' });
  assert.deepEqual((await brain.list()).map(record => record.text), ['recovered write']);
  assert.equal(await exists(lockDir(dataDir)), false);
  assert.equal(await exists(takeoverDir(dataDir)), false);
});

test('a stale lock that cannot be deleted times out instead of spinning', async t => {
  const dataDir = await tempDir(t);
  const pid = await exitedPid();
  await writeOwner(dataDir, { pid, token: 'stale-token', at: Date.now(), host: hostname() });
  const original = fsp.rm;
  t.after(() => { fsp.rm = original; });
  fsp.rm = async (target, options) => {
    if (String(target) === lockDir(dataDir)) {
      const error = new Error('EPERM: operation not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return original.call(fsp, target, options);
  };
  const started = Date.now();
  const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('lock retry did not stop within 2s')), 2000).unref());
  await assert.rejects(Promise.race([
    new Brain({ dataDir, lockTimeoutMs: 200 }).remember({ text: 'must fail', scope: 'global' }),
    deadline,
  ]), /\.brain\.lock/);
  assert.ok(Date.now() - started < 2000);
  assert.equal(await exists(lockDir(dataDir)), true);
  assert.equal(await exists(takeoverDir(dataDir)), false);
});

test('a stale lock from another host is never reclaimed', async t => {
  const dataDir = await tempDir(t);
  const pid = await exitedPid();
  await writeOwner(dataDir, { pid, token: 'stale-token', at: Date.now(), host: 'other-host' });
  const original = await readFile(ownerFile(dataDir), 'utf8');
  await assert.rejects(new Brain({ dataDir, lockTimeoutMs: 300 }).remember({ text: 'must fail', scope: 'global' }), /\.brain\.lock/);
  assert.equal(await exists(ownerFile(dataDir)), true);
  assert.equal(await readFile(ownerFile(dataDir), 'utf8'), original);
  assert.equal(await exists(takeoverDir(dataDir)), false);
});

test('an old lock without a host is never reclaimed', async t => {
  const dataDir = await tempDir(t);
  const pid = await exitedPid();
  await writeOwner(dataDir, { pid, token: 'stale-token', at: Date.now() });
  await assert.rejects(new Brain({ dataDir, lockTimeoutMs: 300 }).remember({ text: 'must fail', scope: 'global' }), /\.brain\.lock/);
  assert.equal(await exists(ownerFile(dataDir)), true);
});

test('a same-host lock held by a running process times out', async t => {
  const dataDir = await tempDir(t);
  await writeOwner(dataDir, { pid: process.pid, token: 'live-token', at: Date.now(), host: hostname() });
  await assert.rejects(new Brain({ dataDir, lockTimeoutMs: 300 }).remember({ text: 'must fail', scope: 'global' }), /\.brain\.lock/);
  assert.equal(await exists(ownerFile(dataDir)), true);
});

test('concurrent writers reclaiming one stale lock do not lose updates', async t => {
  const dataDir = await tempDir(t);
  const first = await new Brain({ dataDir, lockTimeoutMs: 5000 }).init();
  const second = await new Brain({ dataDir, lockTimeoutMs: 5000 }).init();
  const pid = await exitedPid();
  await writeOwner(dataDir, { pid, token: 'stale-token', at: Date.now(), host: hostname() });
  await Promise.all([
    first.remember({ text: 'record a', scope: 'global' }),
    second.remember({ text: 'record b', scope: 'global' }),
  ]);
  const records = await new Brain({ dataDir }).init().then(brain => brain.list());
  assert.deepEqual(records.map(record => record.text).sort(), ['record a', 'record b']);
  assert.equal(await exists(lockDir(dataDir)), false);
  assert.equal(await exists(takeoverDir(dataDir)), false);
});
