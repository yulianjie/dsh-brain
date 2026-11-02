import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../lib/storage.js';

const traits = () => ({ warmth: 0.5, verbosity: 0.5 });
const evidence = () => ({ warmth: [], verbosity: [] });
const timestamp = '2026-11-02T00:00:00.000Z';
const turnHash = digit => String(digit).repeat(64);

function initialState() {
  return {
    schemaVersion: 1,
    revision: 0,
    memories: [],
    tombstones: [],
    processedTurns: [],
    personality: { traits: traits(), frozen: false, evidence: evidence(), version: 0, controlGeneration: 0 },
    history: [{ version: 0, at: timestamp, reason: 'initial', traits: traits(), frozen: false }],
  };
}

function validateState(state) {
  if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Array.isArray(state.memories) || !Array.isArray(state.tombstones) || !Array.isArray(state.processedTurns)
    || !state.personality || !Array.isArray(state.history) || !state.history.length) throw new Error('invalid state');
  for (const memory of state.memories) {
    if (!memory.id || !memory.text || !['global', 'workspace'].includes(memory.scope)) throw new Error('invalid memory');
    if (memory.evidence !== undefined && typeof memory.evidence !== 'string') throw new Error('invalid evidence');
  }
  return state;
}

async function fixture(t, { timeout = 1000, seed = initialState() } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-sqlite-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new SqliteStore({ dataDir, lockTimeoutMs: timeout });
  await store.initialize({ initialState, validateState });
  return { dataDir, store, seed };
}

test('creates relational SQLite tables, round-trips state and closes each connection', async t => {
  const { dataDir, store } = await fixture(t);
  const before = store.snapshot();
  assert.deepEqual(before, initialState());
  const outcome = await store.transaction(state => {
    state.memories.push({
      id: 'memory-1', text: 'A concise summary', evidence: 'The original user wording', kind: 'fact', scope: 'global',
      source: 'manual', confidence: 1, createdAt: timestamp, updatedAt: timestamp,
    });
    state.processedTurns.push(turnHash(1));
    state.tombstones.push(turnHash(2));
    state.personality.traits.verbosity = 0.7;
    return { saved: true };
  });
  assert.deepEqual(outcome, { saved: true });
  const after = store.snapshot();
  assert.equal(after.revision, 1);
  assert.equal(after.memories[0].text, 'A concise summary');
  assert.equal(after.memories[0].evidence, 'The original user wording');
  assert.deepEqual(after.processedTurns, [turnHash(1)]);
  assert.deepEqual(after.tombstones, [turnHash(2)]);
  assert.equal(after.personality.traits.verbosity, 0.7);

  const db = new DatabaseSync(store.file);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    assert.deepEqual(tables, ['brain_state', 'history', 'memories', 'personality', 'processed_turns', 'storage_meta', 'tombstones']);
    assert.equal(db.prepare('SELECT text, evidence FROM memories WHERE id = ?').get('memory-1').evidence, 'The original user wording');
    assert.equal(db.prepare("SELECT value FROM storage_meta WHERE key = 'initialized'").get().value, '1');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memories').get().count, 1);
  } finally { db.close(); }
  assert.equal((await readFile(store.file)).subarray(0, 16).toString('binary'), 'SQLite format 3\0');
  assert.deepEqual(store.snapshot({ includeLedgers: false }).processedTurns, []);
  assert.deepEqual(store.snapshot({ includeLedgers: false }).tombstones, []);
  if (process.platform !== 'win32') assert.equal((await stat(store.file)).mode & 0o777, 0o600);

  // No retained connection or close hook is needed before Windows can remove the data directory.
  await rm(dataDir, { recursive: true, force: true });
  assert.equal(store.file.endsWith('brain.sqlite'), true);
});

test('migrates a valid legacy JSON state once and leaves the source byte-for-byte intact', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-migrate-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const legacyFile = path.join(dataDir, 'brain.json');
  const legacy = initialState();
  legacy.revision = 17;
  legacy.memories.push({
    id: 'legacy-1', text: 'Stored without model work', evidence: 'Original evidence', kind: 'preference', scope: 'global',
    source: 'user-turn:old-session:42', confidence: 0.9, key: 'language', createdAt: timestamp, updatedAt: timestamp,
    personalityTraits: ['warmth'],
  });
  legacy.tombstones.push(turnHash(3));
  legacy.processedTurns.push(turnHash(4));
  const bytes = `${JSON.stringify(legacy, null, 2)}\n`;
  await writeFile(legacyFile, bytes, 'utf8');

  const store = new SqliteStore({ dataDir });
  await store.initialize({ initialState, validateState });
  assert.deepEqual(store.snapshot(), legacy);
  assert.equal(await readFile(legacyFile, 'utf8'), bytes);

  const laterState = initialState();
  laterState.memories.push({
    id: 'later-1', text: 'New data', kind: 'fact', scope: 'global', source: 'manual', confidence: 1,
    createdAt: timestamp, updatedAt: timestamp,
  });
  await writeFile(legacyFile, JSON.stringify(laterState), 'utf8');
  const secondStore = new SqliteStore({ dataDir });
  await secondStore.initialize({ initialState, validateState });
  assert.deepEqual(secondStore.snapshot(), legacy, 'the completed marker prevents a second import');
  assert.equal(JSON.parse(await readFile(legacyFile, 'utf8')).memories[0].id, 'later-1');
});

test('invalid legacy JSON rolls back schema creation and can be retried after repair', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-bad-json-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const legacyFile = path.join(dataDir, 'brain.json');
  await writeFile(legacyFile, '{ not json', 'utf8');
  const store = new SqliteStore({ dataDir });
  await assert.rejects(store.initialize({ initialState, validateState }), /Invalid or corrupt Brain state/);
  assert.equal(await readFile(legacyFile, 'utf8'), '{ not json');

  const db = new DatabaseSync(store.file);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='storage_meta'").get().count, 0);
  } finally { db.close(); }

  await writeFile(legacyFile, JSON.stringify(initialState()), 'utf8');
  await store.initialize({ initialState, validateState });
  assert.deepEqual(store.snapshot(), initialState());
});

test('a rejected legacy state leaves no migration marker', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-invalid-state-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const legacyFile = path.join(dataDir, 'brain.json');
  const invalid = initialState();
  invalid.memories.push({ id: 'bad', text: '', scope: 'global' });
  const bytes = JSON.stringify(invalid);
  await writeFile(legacyFile, bytes, 'utf8');
  const store = new SqliteStore({ dataDir });
  await assert.rejects(store.initialize({ initialState, validateState }), /invalid memory/);
  assert.equal(await readFile(legacyFile, 'utf8'), bytes);
  const db = new DatabaseSync(store.file);
  try { assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='storage_meta'").get().count, 0); }
  finally { db.close(); }
});

test('snapshot does not create a missing database and corrupt SQLite files are preserved', async t => {
  const missingDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-missing-sqlite-'));
  t.after(() => rm(missingDir, { recursive: true, force: true }));
  const missing = new SqliteStore({ dataDir: missingDir });
  await missing.initialize({ initialState, validateState });
  await rm(missing.file, { force: true });
  assert.throws(() => missing.snapshot(), /Brain SQLite store is missing/);
  await assert.rejects(access(missing.file), { code: 'ENOENT' });

  const corruptDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-corrupt-sqlite-'));
  t.after(() => rm(corruptDir, { recursive: true, force: true }));
  const corruptFile = path.join(corruptDir, 'brain.sqlite');
  const bytes = Buffer.from('not a sqlite database');
  await writeFile(corruptFile, bytes);
  const corrupt = new SqliteStore({ dataDir: corruptDir });
  await assert.rejects(corrupt.initialize({ initialState, validateState }), /Invalid or corrupt Brain SQLite store/);
  assert.deepEqual(await readFile(corruptFile), bytes);
});

test('concurrent initializers migrate once and concurrent instances merge transactions', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-concurrent-init-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const legacy = initialState();
  legacy.memories.push({
    id: 'original', text: 'Original fact', kind: 'fact', scope: 'global', source: 'manual', confidence: 1,
    createdAt: timestamp, updatedAt: timestamp,
  });
  await writeFile(path.join(dataDir, 'brain.json'), JSON.stringify(legacy), 'utf8');
  const first = new SqliteStore({ dataDir, lockTimeoutMs: 3000 });
  const second = new SqliteStore({ dataDir, lockTimeoutMs: 3000 });
  await Promise.all([
    first.initialize({ initialState, validateState }),
    second.initialize({ initialState, validateState }),
  ]);
  assert.deepEqual(second.snapshot(), legacy);
  const startRevision = first.snapshot().revision;
  await Promise.all([
    first.transaction(async state => { await new Promise(resolve => setTimeout(resolve, 10)); state.tombstones.push(turnHash(5)); }),
    second.transaction(async state => { await new Promise(resolve => setTimeout(resolve, 10)); state.processedTurns.push(turnHash(6)); }),
  ]);
  const merged = first.snapshot();
  assert.equal(merged.revision, startRevision + 2);
  assert.deepEqual(merged.tombstones, [turnHash(5)]);
  assert.deepEqual(merged.processedTurns, [turnHash(6)]);
});

test('same-instance writes queue, persistence is incremental, and zero timeout fails immediately when busy', async t => {
  const { dataDir, store: first } = await fixture(t, { timeout: 0 });
  await first.transaction(state => {
    state.memories.push(
      { id: 'one', text: 'One', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: timestamp, updatedAt: timestamp },
      { id: 'two', text: 'Two', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: timestamp, updatedAt: timestamp },
    );
  });
  const db = new DatabaseSync(first.file);
  try {
    db.exec('CREATE TABLE memory_updates(id TEXT NOT NULL)');
    db.exec(`CREATE TRIGGER count_memory_updates AFTER UPDATE ON memories BEGIN INSERT INTO memory_updates(id) VALUES(NEW.id); END`);
  } finally { db.close(); }
  await Promise.all([
    first.transaction(async state => { await new Promise(resolve => setTimeout(resolve, 5)); state.memories[0].text = 'One edited'; }),
    first.transaction(state => { state.memories[1].text = 'Two edited'; }),
  ]);
  const check = new DatabaseSync(first.file);
  try {
    assert.deepEqual(check.prepare('SELECT id FROM memory_updates ORDER BY id').all().map(row => row.id), ['one', 'two']);
  } finally { check.close(); }

  const second = new SqliteStore({ dataDir, lockTimeoutMs: 0 });
  await second.initialize({ initialState, validateState });
  let release;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const hold = first.transaction(async state => {
    state.tombstones.push(turnHash(7));
    markStarted();
    await new Promise(resolve => { release = resolve; });
  });
  await started;
  const start = Date.now();
  await assert.rejects(second.transaction(state => { state.tombstones.push(turnHash(8)); }), error => error.errcode === 5);
  assert.ok(Date.now() - start < 100, 'zero timeout does not wait for the writer');
  release();
  await hold;
  assert.deepEqual(first.snapshot().tombstones, [turnHash(7)]);
});

test('exceptions and aborts roll back every table and preserve committed state', async t => {
  const { store } = await fixture(t);
  await store.transaction(state => { state.tombstones.push(turnHash(9)); });
  const committed = store.snapshot();
  await assert.rejects(store.transaction(state => {
    state.tombstones.push(turnHash(1));
    state.memories.push({ id: 'transient', text: 'not committed', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: timestamp, updatedAt: timestamp });
    throw new Error('forced failure');
  }), /forced failure/);
  assert.deepEqual(store.snapshot(), committed);

  const controller = new AbortController();
  let release;
  const aborted = store.transaction(async state => {
    state.processedTurns.push(turnHash(2));
    await new Promise(resolve => { release = resolve; });
  }, { signal: controller.signal });
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(new Error('cancelled write'));
  release();
  await assert.rejects(aborted, /cancelled write/);
  assert.deepEqual(store.snapshot(), committed);
});

test('rolling a full processed-turn window deletes one old row and appends one new row', async t => {
  const { store } = await fixture(t);
  const window = Array.from({ length: 4096 }, (_, index) => createHash('sha256').update(`processed-turn-${index}`).digest('hex'));
  await store.transaction(state => { state.processedTurns = window; });
  const db = new DatabaseSync(store.file);
  try {
    db.exec('CREATE TABLE turn_writes(action TEXT NOT NULL)');
    db.exec("CREATE TRIGGER turn_insert AFTER INSERT ON processed_turns BEGIN INSERT INTO turn_writes(action) VALUES('insert'); END");
    db.exec("CREATE TRIGGER turn_update AFTER UPDATE ON processed_turns BEGIN INSERT INTO turn_writes(action) VALUES('update'); END");
    db.exec("CREATE TRIGGER turn_delete AFTER DELETE ON processed_turns BEGIN INSERT INTO turn_writes(action) VALUES('delete'); END");
  } finally { db.close(); }

  const next = createHash('sha256').update('processed-turn-next').digest('hex');
  await store.transaction(state => { state.processedTurns = [...state.processedTurns.slice(1), next]; });
  const audit = new DatabaseSync(store.file);
  try {
    const writes = audit.prepare('SELECT action, COUNT(*) AS count FROM turn_writes GROUP BY action ORDER BY action').all().map(row => ({ action: row.action, count: row.count }));
    assert.deepEqual(writes, [
      { action: 'delete', count: 1 },
      { action: 'insert', count: 1 },
    ]);
  } finally { audit.close(); }
  assert.deepEqual(store.snapshot().processedTurns, [...window.slice(1), next]);
});

test('personality history rows append and survive a new store instance', async t => {
  const { dataDir, store } = await fixture(t);
  await store.transaction(state => {
    state.personality.traits.verbosity = 0.8;
    state.personality.version = 1;
    state.history.push({ version: 1, at: timestamp, reason: 'manual', traits: { ...state.personality.traits }, frozen: false });
  });
  await store.transaction(state => {
    state.personality.traits.verbosity = 0.5;
    state.personality.version = 2;
    state.history.push({ version: 2, at: timestamp, reason: 'reset', traits: { ...state.personality.traits }, frozen: false });
  });
  const expected = store.snapshot().history;
  assert.deepEqual(expected.map(entry => entry.version), [0, 1, 2]);
  const reopened = new SqliteStore({ dataDir });
  await reopened.initialize({ initialState, validateState });
  assert.deepEqual(reopened.snapshot().history, expected);
  assert.equal(reopened.snapshot().history.find(entry => entry.version === 1).traits.verbosity, 0.8);
});

test('snapshots during writes see one committed revision; nested same-file transactions fail fast', async t => {
  const { store } = await fixture(t);
  const other = new SqliteStore({ dataDir: store.dataDir, lockTimeoutMs: 0 });
  await other.initialize({ initialState, validateState });
  let release;
  const holding = store.transaction(async state => {
    state.tombstones.push(turnHash(3));
    assert.deepEqual(store.snapshot(), initialState(), 'a read sees the prior committed revision, never half-written rows');
    await new Promise(resolve => { release = resolve; });
  });
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  try {
    assert.deepEqual(store.snapshot(), initialState(), 'an independent reader sees the last committed revision');
    await assert.rejects(other.transaction(() => undefined), error => error.errcode === 5);
  } finally { release(); }
  await holding;
  assert.deepEqual(store.snapshot().tombstones, [turnHash(3)]);

  await assert.rejects(store.transaction(async () => other.transaction(() => undefined)), /Nested SQLite transactions on the same file/);
  await assert.rejects(store.transaction(async () => store.transaction(() => undefined)), /Nested SQLite transactions on the same file/);
  assert.deepEqual(store.snapshot().tombstones, [turnHash(3)]);
});

test('a busy recovery read rejects stale data unless cached reads are explicitly allowed', async t => {
  const { store } = await fixture(t);
  await store.transaction(state => {
    state.processedTurns.push(turnHash(4));
    state.memories.push({ id: 'cached', text: 'committed cache value', kind: 'fact', scope: 'global', source: 'manual', confidence: 1, createdAt: timestamp, updatedAt: timestamp });
  });
  const committed = store.snapshot();
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql, ...args) {
    if (String(sql).includes('PRAGMA busy_timeout')) throw Object.assign(new Error('database is locked'), { errcode: 261 });
    return originalExec.call(this, sql, ...args);
  };
  try {
    assert.throws(() => store.snapshot(), /database is locked/);
    assert.deepEqual(store.snapshot({ allowStale: true }), committed);
    assert.deepEqual(store.snapshot({ includeLedgers: false, allowStale: true }).processedTurns, []);
  } finally { DatabaseSync.prototype.exec = originalExec; }
});
