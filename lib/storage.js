// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const TX_CONTEXT = new AsyncLocalStorage();
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value);
const parseJson = value => JSON.parse(value);
const isBusy = error => [5, 6].includes(Number(error?.errcode) & 0xff)
  || /database is (?:locked|busy)/i.test(error?.message ?? '');
const isCorrupt = error => error?.errcode === 11 || error?.errcode === 26
  || /not a database|database disk image is malformed|malformed database schema/i.test(error?.message ?? '');
const corruptStoreError = (file, cause) => isCorrupt(cause)
  ? new Error(`Invalid or corrupt Brain SQLite store at ${file}; existing data was not overwritten.`, { cause })
  : cause;
const abortIfNeeded = signal => signal?.throwIfAborted();
const canonicalFile = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
async function waitForRetry(ms, signal) {
  try { await delay(ms, undefined, { signal }); }
  catch (error) { abortIfNeeded(signal); throw error; }
}

function validateOptions(lockTimeoutMs) {
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0) throw new Error('Invalid SQLite lock timeout.');
  return lockTimeoutMs;
}

function optional(record, key) {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function memoryRow(record, ordinal) {
  return {
    id: record.id,
    ordinal,
    text: record.text,
    evidence: optional(record, 'evidence') ?? null,
    kind: record.kind,
    scope: record.scope,
    workspace: optional(record, 'workspace') ?? null,
    source: record.source,
    confidence: record.confidence,
    memory_key: optional(record, 'key') ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    personality_traits: optional(record, 'personalityTraits') === undefined ? null : json(record.personalityTraits),
  };
}

const MEMORY_COLUMNS = ['id', 'ordinal', 'text', 'evidence', 'kind', 'scope', 'workspace', 'source', 'confidence', 'memory_key', 'created_at', 'updated_at', 'personality_traits'];

function memoryFromRow(row) {
  const record = {
    id: row.id,
    text: row.text,
    kind: row.kind,
    scope: row.scope,
    ...(row.workspace === null ? {} : { workspace: row.workspace }),
    source: row.source,
    confidence: row.confidence,
    ...(row.memory_key === null ? {} : { key: row.memory_key }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.personality_traits === null ? {} : { personalityTraits: parseJson(row.personality_traits) }),
    ...(row.evidence === null ? {} : { evidence: row.evidence }),
  };
  return record;
}

function stateFromDatabase(db, { includeLedgers = true } = {}) {
  const meta = db.prepare('SELECT schema_version, revision FROM brain_state WHERE id = 1').get();
  if (!meta) throw new Error('SQLite Brain store has not been initialized.');
  const memories = db.prepare('SELECT * FROM memories ORDER BY ordinal').all().map(memoryFromRow);
  const memoryState = db.prepare('SELECT traits_json, frozen, evidence_json, version, control_generation FROM personality WHERE id = 1').get();
  if (!memoryState) throw new Error('SQLite Brain personality state is missing.');
  const state = {
    schemaVersion: meta.schema_version,
    revision: meta.revision,
    memories,
    tombstones: includeLedgers ? db.prepare('SELECT hash FROM tombstones ORDER BY ordinal').all().map(row => row.hash) : [],
    processedTurns: includeLedgers ? db.prepare('SELECT hash FROM processed_turns ORDER BY ordinal').all().map(row => row.hash) : [],
    personality: {
      traits: parseJson(memoryState.traits_json),
      frozen: Boolean(memoryState.frozen),
      evidence: parseJson(memoryState.evidence_json),
      version: memoryState.version,
      ...(memoryState.control_generation === null ? {} : { controlGeneration: memoryState.control_generation }),
    },
    history: db.prepare('SELECT payload_json FROM history ORDER BY ordinal').all().map(row => parseJson(row.payload_json)),
  };
  return state;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS brain_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      ordinal INTEGER NOT NULL,
      text TEXT NOT NULL,
      evidence TEXT,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      workspace TEXT,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      memory_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      personality_traits TEXT
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS memories_scope_workspace ON memories(scope, workspace);
    CREATE INDEX IF NOT EXISTS memories_updated_at ON memories(updated_at);
    CREATE TABLE IF NOT EXISTS tombstones (
      ordinal INTEGER PRIMARY KEY,
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tombstones_hash ON tombstones(hash);
    CREATE TABLE IF NOT EXISTS processed_turns (
      ordinal INTEGER PRIMARY KEY,
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS processed_turns_hash ON processed_turns(hash);
    CREATE TABLE IF NOT EXISTS personality (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      traits_json TEXT NOT NULL,
      frozen INTEGER NOT NULL,
      evidence_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      control_generation INTEGER
    );
    CREATE TABLE IF NOT EXISTS history (
      ordinal INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL
    );
  `);
}

function insertWholeState(db, state) {
  db.prepare('INSERT INTO brain_state(id, schema_version, revision) VALUES(1, ?, ?)')
    .run(state.schemaVersion, state.revision);
  const insertMemory = db.prepare(`INSERT INTO memories
    (id, ordinal, text, evidence, kind, scope, workspace, source, confidence, memory_key, created_at, updated_at, personality_traits)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  state.memories.forEach((record, ordinal) => {
    const row = memoryRow(record, ordinal);
    insertMemory.run(...MEMORY_COLUMNS.map(key => row[key]));
  });
  const insertLedger = (table, values) => {
    const insert = db.prepare(`INSERT INTO ${table}(ordinal, hash) VALUES(?, ?)`);
    values.forEach((value, ordinal) => insert.run(ordinal, value));
  };
  insertLedger('tombstones', state.tombstones);
  insertLedger('processed_turns', state.processedTurns);
  const p = state.personality;
  db.prepare(`INSERT INTO personality(id, traits_json, frozen, evidence_json, version, control_generation)
    VALUES(1, ?, ?, ?, ?, ?)`)
    .run(json(p.traits), Number(p.frozen), json(p.evidence), p.version, p.controlGeneration ?? null);
  const insertHistory = db.prepare('INSERT INTO history(ordinal, payload_json) VALUES(?, ?)');
  state.history.forEach((entry, ordinal) => insertHistory.run(ordinal, json(entry)));
}

function sameJson(left, right) {
  return json(left) === json(right);
}

function stateChanged(before, after) {
  if (before.schemaVersion !== after.schemaVersion) return true;
  if (before.memories.length !== after.memories.length || before.tombstones.length !== after.tombstones.length || before.processedTurns.length !== after.processedTurns.length || before.history.length !== after.history.length) return true;
  for (let index = 0; index < before.memories.length; index++) if (!sameJson(before.memories[index], after.memories[index])) return true;
  for (let index = 0; index < before.tombstones.length; index++) if (before.tombstones[index] !== after.tombstones[index]) return true;
  for (let index = 0; index < before.processedTurns.length; index++) if (before.processedTurns[index] !== after.processedTurns[index]) return true;
  if (!sameJson(before.personality, after.personality)) return true;
  for (let index = 0; index < before.history.length; index++) if (!sameJson(before.history[index], after.history[index])) return true;
  return false;
}

function syncMemories(db, before, after) {
  const nextById = new Map(after.map(record => [record.id, record]));
  const oldById = new Map(before.map(record => [record.id, record]));
  const oldOrdinalById = new Map(before.map((record, ordinal) => [record.id, ordinal]));
  const remove = db.prepare('DELETE FROM memories WHERE id = ?');
  for (const record of before) if (!nextById.has(record.id)) remove.run(record.id);
  const upsert = db.prepare(`INSERT INTO memories
    (id, ordinal, text, evidence, kind, scope, workspace, source, confidence, memory_key, created_at, updated_at, personality_traits)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ordinal=excluded.ordinal, text=excluded.text, evidence=excluded.evidence, kind=excluded.kind,
      scope=excluded.scope, workspace=excluded.workspace, source=excluded.source, confidence=excluded.confidence,
      memory_key=excluded.memory_key, created_at=excluded.created_at, updated_at=excluded.updated_at,
      personality_traits=excluded.personality_traits`);
  after.forEach((record, ordinal) => {
    const old = oldById.get(record.id);
    if (old && sameJson(old, record) && oldOrdinalById.get(record.id) === ordinal) return;
    const row = memoryRow(record, ordinal);
    upsert.run(...MEMORY_COLUMNS.map(key => row[key]));
  });
}

function syncLedger(db, table, before, after) {
  if (before.length === after.length && before.every((hash, index) => hash === after[index])) return;
  const rows = db.prepare(`SELECT ordinal, hash FROM ${table} ORDER BY ordinal`).all();
  const wanted = new Map();
  for (const hash of after) wanted.set(hash, (wanted.get(hash) ?? 0) + 1);

  // Keep the earliest durable row for each hash up to its desired count. This
  // preserves ordinals as a ring drops old turns and appends new ones.
  const keptRows = [], removedRows = [], keptCounts = new Map();
  for (const row of rows) {
    const kept = keptCounts.get(row.hash) ?? 0;
    if (kept < (wanted.get(row.hash) ?? 0)) {
      keptRows.push(row);
      keptCounts.set(row.hash, kept + 1);
    } else removedRows.push(row);
  }

  const consumed = new Map(), retainedInDesiredOrder = [], appendedInDesiredOrder = [];
  for (const hash of after) {
    const seen = consumed.get(hash) ?? 0;
    if (seen < (keptCounts.get(hash) ?? 0)) retainedInDesiredOrder.push(hash);
    else appendedInDesiredOrder.push(hash);
    consumed.set(hash, seen + 1);
  }
  const retainedInDatabaseOrder = keptRows.map(row => row.hash);
  const stableAppend = retainedInDesiredOrder.length === retainedInDatabaseOrder.length
    && retainedInDesiredOrder.every((hash, index) => hash === retainedInDatabaseOrder[index])
    && after.length === retainedInDesiredOrder.length + appendedInDesiredOrder.length
    && after.every((hash, index) => hash === (index < retainedInDesiredOrder.length
      ? retainedInDesiredOrder[index]
      : appendedInDesiredOrder[index - retainedInDesiredOrder.length]));

  if (stableAppend) {
    const remove = db.prepare(`DELETE FROM ${table} WHERE ordinal = ?`);
    for (const row of removedRows) remove.run(row.ordinal);
    let ordinal = db.prepare(`SELECT COALESCE(MAX(ordinal), -1) AS value FROM ${table}`).get().value;
    const insert = db.prepare(`INSERT INTO ${table}(ordinal, hash) VALUES(?, ?)`);
    for (const hash of appendedInDesiredOrder) insert.run(++ordinal, hash);
    return;
  }

  // Rare imports can reorder an existing ledger. Compact only that case so a
  // snapshot keeps the exact requested logical order without penalizing rings.
  db.prepare(`DELETE FROM ${table}`).run();
  const insert = db.prepare(`INSERT INTO ${table}(ordinal, hash) VALUES(?, ?)`);
  after.forEach((hash, ordinal) => insert.run(ordinal, hash));
}

function syncPersonality(db, before, after) {
  if (sameJson(before.personality, after.personality)) return;
  const p = after.personality;
  db.prepare(`INSERT INTO personality(id, traits_json, frozen, evidence_json, version, control_generation)
    VALUES(1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET traits_json=excluded.traits_json, frozen=excluded.frozen,
      evidence_json=excluded.evidence_json, version=excluded.version, control_generation=excluded.control_generation`)
    .run(json(p.traits), Number(p.frozen), json(p.evidence), p.version, p.controlGeneration ?? null);
}

function syncHistory(db, before, after) {
  if (after.length < before.length) db.prepare('DELETE FROM history WHERE ordinal >= ?').run(after.length);
  const update = db.prepare('UPDATE history SET payload_json = ? WHERE ordinal = ?');
  const insert = db.prepare('INSERT INTO history(ordinal, payload_json) VALUES(?, ?)');
  for (let ordinal = 0; ordinal < after.length; ordinal++) {
    if (sameJson(before[ordinal], after[ordinal])) continue;
    const payload = json(after[ordinal]);
    if (ordinal < before.length) update.run(payload, ordinal);
    else insert.run(ordinal, payload);
  }
}

function syncState(db, before, after) {
  syncMemories(db, before.memories, after.memories);
  syncLedger(db, 'tombstones', before.tombstones, after.tombstones);
  syncLedger(db, 'processed_turns', before.processedTurns, after.processedTurns);
  syncPersonality(db, before, after);
  syncHistory(db, before.history, after.history);
  db.prepare('UPDATE brain_state SET schema_version = ?, revision = ? WHERE id = 1')
    .run(after.schemaVersion, after.revision);
}

function bestEffortPrivateMode(file) {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    try { if (existsSync(candidate)) chmodSync(candidate, 0o600); } catch { /* ACLs or filesystem may not support chmod. */ }
  }
}

/** Relational persistence for the Brain state. Connections are short-lived. */
export class SqliteStore {
  constructor({ dataDir, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw new Error('SQLite Brain store requires a data directory.');
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'brain.sqlite');
    this.legacyFile = path.join(this.dataDir, 'brain.json');
    this.lockTimeoutMs = validateOptions(lockTimeoutMs);
    this._validateState = null;
    this._initialState = null;
    this._initialized = false;
    this._initializePromise = null;
    this._queue = Promise.resolve();
    this._snapshotCache = null;
  }

  async initialize({ initialState, validateState } = {}) {
    if (typeof initialState !== 'function' || typeof validateState !== 'function') throw new Error('SQLite initialization requires initialState and validateState functions.');
    if (this._initialized) return this;
    if (this._initializePromise) return this._initializePromise;
    this._initialState = initialState;
    this._validateState = validateState;
    this._initializePromise = this._initialize().then(() => {
      this._initialized = true;
      return this;
    }).catch(error => {
      this._initializePromise = null;
      throw corruptStoreError(this.file, error);
    });
    return this._initializePromise;
  }

  async _initialize() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const db = await this._openWithRetry({ allowUninitialized: true });
    try {
      await this._enableWal(db);
      await this._beginImmediate(db);
      try {
        createSchema(db);
        const marker = db.prepare("SELECT value FROM storage_meta WHERE key = 'initialized'").get();
        let state;
        if (!marker) {
          state = this._readLegacyOrInitial();
          this._validateState(state);
          insertWholeState(db, state);
          db.prepare("INSERT INTO storage_meta(key, value) VALUES('initialized', '1')").run();
        } else {
          state = stateFromDatabase(db);
          this._validateState(state);
        }
        await this._commit(db);
        this._snapshotCache = clone(state);
      } catch (error) {
        this._rollback(db);
        throw error;
      }
    } finally {
      db.close();
      bestEffortPrivateMode(this.file);
    }
  }

  _readLegacyOrInitial() {
    let state;
    try { state = parseJson(readFileSync(this.legacyFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') state = this._initialState();
      else if (error instanceof SyntaxError) throw new Error(`Invalid or corrupt Brain state at ${this.legacyFile}; existing data was not overwritten.`, { cause: error });
      else throw error;
    }
    return clone(state);
  }

  _open({ readOnly = false, allowUninitialized = false } = {}) {
    if (!this._initialized && !allowUninitialized) {
      if (!existsSync(this.file)) throw new Error(`Brain SQLite store is missing at ${this.file}.`);
      throw new Error('SQLite Brain store has not been initialized.');
    }
    if (readOnly && !existsSync(this.file)) throw new Error(`Brain SQLite store is missing at ${this.file}.`);
    let db;
    try { db = new DatabaseSync(this.file, readOnly ? { readOnly: true } : {}); }
    catch (error) {
      if (!existsSync(this.file)) throw new Error(`Brain SQLite store is missing at ${this.file}.`, { cause: error });
      throw corruptStoreError(this.file, error);
    }
    try {
      db.exec('PRAGMA busy_timeout = 0; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
      bestEffortPrivateMode(this.file);
      return db;
    } catch (error) {
      db.close();
      throw corruptStoreError(this.file, error);
    }
  }

  async _openWithRetry({ readOnly = false, allowUninitialized = false, signal } = {}) {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      abortIfNeeded(signal);
      try { return this._open({ readOnly, allowUninitialized }); }
      catch (error) {
        if (!isBusy(error) || this.lockTimeoutMs === 0 || Date.now() - started >= this.lockTimeoutMs) throw error;
        await waitForRetry(Math.min(20, 2 ** Math.min(attempt, 5)), signal);
      }
    }
  }

  async _enableWal(db, signal) {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      abortIfNeeded(signal);
      try {
        const result = db.prepare('PRAGMA journal_mode = WAL').get();
        if (String(result?.journal_mode).toLowerCase() !== 'wal') throw new Error('SQLite Brain store could not enable WAL mode.');
        db.exec('PRAGMA synchronous = FULL;');
        return;
      } catch (error) {
        if (!isBusy(error) || this.lockTimeoutMs === 0 || Date.now() - started >= this.lockTimeoutMs) throw error;
        await waitForRetry(Math.min(20, 2 ** Math.min(attempt, 5)), signal);
      }
    }
  }

  async _beginImmediate(db, signal) {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      abortIfNeeded(signal);
      try { db.exec('BEGIN IMMEDIATE'); return; }
      catch (error) {
        if (!isBusy(error) || this.lockTimeoutMs === 0 || Date.now() - started >= this.lockTimeoutMs) throw error;
        await waitForRetry(Math.min(20, 2 ** Math.min(attempt, 5)), signal);
      }
    }
  }

  async _commit(db, signal) {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      abortIfNeeded(signal);
      try { db.exec('COMMIT'); return; }
      catch (error) {
        if (!isBusy(error) || this.lockTimeoutMs === 0 || Date.now() - started >= this.lockTimeoutMs) throw error;
        await waitForRetry(Math.min(20, 2 ** Math.min(attempt, 5)), signal);
      }
    }
  }

  _rollback(db) {
    try { db.exec('ROLLBACK'); } catch { /* Ignore rollback errors and preserve the original failure. */ }
  }

  snapshot({ includeLedgers = true, allowStale = false } = {}) {
    let db;
    let started = false;
    try {
      db = this._open({ readOnly: true });
      db.exec('BEGIN');
      started = true;
      const state = stateFromDatabase(db, { includeLedgers });
      this._validateState(state);
      db.exec('COMMIT');
      started = false;
      if (includeLedgers) this._snapshotCache = clone(state);
      return state;
    } catch (error) {
      if (db && started) this._rollback(db);
      // Recalled data must not resurrect a deletion from another instance.
      // Cached reads are an explicit opt-in, never the model-facing default.
      if (allowStale && isBusy(error) && this._snapshotCache) return this._cachedSnapshot(includeLedgers);
      throw corruptStoreError(this.file, error);
    } finally {
      db?.close();
      bestEffortPrivateMode(this.file);
    }
  }

  _cachedSnapshot(includeLedgers) {
    const state = clone(this._snapshotCache);
    if (!includeLedgers) { state.tombstones = []; state.processedTurns = []; }
    this._validateState(state);
    return state;
  }

  transaction(operation, { signal, create = false } = {}) {
    if (typeof operation !== 'function') return Promise.reject(new Error('SQLite transaction requires an operation callback.'));
    const context = TX_CONTEXT.getStore();
    if (context?.active && canonicalFile(context.store.file) === canonicalFile(this.file)) return Promise.reject(new Error('Nested SQLite transactions on the same file are not allowed.'));
    const run = this._queue.then(() => this._runTransaction(operation, { signal, create }));
    this._queue = run.catch(() => {});
    return run;
  }

  async _runTransaction(operation, { signal, create }) {
    abortIfNeeded(signal);
    const db = await this._openWithRetry({ signal });
    let started = false;
    try {
      await this._beginImmediate(db, signal);
      started = true;
      const before = stateFromDatabase(db);
      const state = clone(before);
      const context = { store: this, active: true };
      let result;
      try { result = await TX_CONTEXT.run(context, () => operation(state)); }
      finally { context.active = false; }
      abortIfNeeded(signal);
      state.revision = before.revision;
      this._validateState(state);
      if (stateChanged(before, state)) {
        state.revision = before.revision + 1;
        this._validateState(state);
        syncState(db, before, state);
      }
      await this._commit(db, signal);
      started = false;
      this._snapshotCache = clone(state);
      // create is retained for compatibility with the Brain transaction API.
      // Initialization owns first-state creation and always writes a marker.
      void create;
      return clone(result);
    } catch (error) {
      if (started) this._rollback(db);
      throw corruptStoreError(this.file, error);
    } finally {
      db.close();
      bestEffortPrivateMode(this.file);
    }
  }
}

export default SqliteStore;
