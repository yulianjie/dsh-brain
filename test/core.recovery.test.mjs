import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SqliteStore } from '../lib/storage.js';

const at = '2026-11-02T00:00:00.000Z';
const hash = digit => String(digit).repeat(64);
const traits = () => ({ verbosity: 0.5 });
const evidence = () => ({ verbosity: [] });
function initialState() {
  return {
    schemaVersion: 1, revision: 0, memories: [], tombstones: [], processedTurns: [],
    personality: { traits: traits(), frozen: false, evidence: evidence(), version: 0, controlGeneration: 0 },
    history: [{ version: 0, at, reason: 'initial', traits: traits(), frozen: false }],
  };
}
function validateState(state) {
  if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Array.isArray(state.memories) || !Array.isArray(state.tombstones) || !Array.isArray(state.processedTurns)
    || !state.personality || !Array.isArray(state.history) || !state.history.length) throw new Error('invalid state');
  if ([...state.tombstones, ...state.processedTurns].some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error('invalid ledger');
  for (const memory of state.memories) if (!memory.id || !memory.text || !['global', 'workspace'].includes(memory.scope)) throw new Error('invalid memory');
  return state;
}
async function tempDir(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-sqlite-recovery-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

function waitForReady(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`child did not enter its transaction: ${output}`)), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stderr = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('READY')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      if (!output.includes('READY')) { clearTimeout(timer); reject(new Error(`child exited before transaction: ${code} ${stderr}`)); }
    });
  });
}

test('an abruptly exited writer rolls back its SQLite transaction and the next process recovers', async t => {
  const dataDir = await tempDir(t);
  const parent = new SqliteStore({ dataDir, lockTimeoutMs: 2000 });
  await parent.initialize({ initialState, validateState });
  await parent.transaction(state => {
    state.memories.push({ id: 'committed', text: 'survives crash', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: at, updatedAt: at });
  });
  const before = parent.snapshot();
  const moduleURL = new URL('../lib/storage.js', import.meta.url).href;
  const script = `
    import { SqliteStore } from ${JSON.stringify(moduleURL)};
    const at = ${JSON.stringify(at)};
    const traits = () => ({ verbosity: 0.5 });
    const initialState = () => ({ schemaVersion: 1, revision: 0, memories: [], tombstones: [], processedTurns: [], personality: { traits: traits(), frozen: false, evidence: { verbosity: [] }, version: 0, controlGeneration: 0 }, history: [{ version: 0, at, reason: 'initial', traits: traits(), frozen: false }] });
    const validateState = state => { if (!state || !Array.isArray(state.memories) || !Array.isArray(state.tombstones) || !Array.isArray(state.processedTurns)) throw new Error('invalid state'); return state; };
    const store = new SqliteStore({ dataDir: ${JSON.stringify(dataDir)}, lockTimeoutMs: 2000 });
    await store.initialize({ initialState, validateState });
    await store.transaction(async state => {
      state.memories.push({ id: 'uncommitted', text: 'must roll back', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: at, updatedAt: at });
      state.tombstones.push(${JSON.stringify(hash(1))});
      process.stdout.write('READY\\n');
      await new Promise(() => {});
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  await waitForReady(child);
  child.kill();
  let exitTimer;
  const exitTimeout = new Promise((_, reject) => {
    exitTimer = setTimeout(() => reject(new Error('killed SQLite writer did not exit')), 10_000);
    exitTimer.unref();
  });
  const exit = await Promise.race([
    closed,
    exitTimeout,
  ]);
  clearTimeout(exitTimer);
  assert.notEqual(exit.code, 0);

  const recovered = new SqliteStore({ dataDir, lockTimeoutMs: 2000 });
  await recovered.initialize({ initialState, validateState });
  assert.deepEqual(recovered.snapshot(), before);
  await recovered.transaction(state => {
    state.memories.push({ id: 'after-recovery', text: 'new process can write', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: at, updatedAt: at });
  });
  assert.deepEqual(recovered.snapshot().memories.map(memory => memory.id), ['committed', 'after-recovery']);
  assert.equal(recovered.snapshot().revision, before.revision + 1);
});

test('callback failures and invalid post-state preserve prior committed data', async t => {
  const dataDir = await tempDir(t);
  const store = new SqliteStore({ dataDir });
  await store.initialize({ initialState, validateState });
  await store.transaction(state => {
    state.processedTurns.push(hash(2));
    state.memories.push({ id: 'kept', text: 'committed first', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: at, updatedAt: at });
  });
  const before = store.snapshot();

  await assert.rejects(store.transaction(state => {
    state.tombstones.push(hash(3));
    state.memories.push({ id: 'temporary', text: 'rollback', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: at, updatedAt: at });
    throw new Error('callback failed');
  }), /callback failed/);
  assert.deepEqual(store.snapshot(), before);

  await assert.rejects(store.transaction(state => {
    state.tombstones.push('not-a-valid-hash');
  }), /invalid ledger/);
  assert.deepEqual(store.snapshot(), before);
});
