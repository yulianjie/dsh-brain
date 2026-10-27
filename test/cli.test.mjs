import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../bin/brain.mjs', import.meta.url));

function run(dataDir, ...args) {
  const result = spawnSync(process.execPath, [cli, '--data-dir', dataDir, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('CLI persists CRUD, isolates workspace, and roundtrips export/import', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-brain-cli-'));
  try {
    const data = join(dir, 'data');
    const workspace = join(dir, 'workspace');
    const global = run(data, 'remember', '用户喜欢中文交流');
    const local = run(data, 'remember', '项目使用 Rust', '--scope', 'workspace', '--workspace', workspace);
    assert.ok(global.id);
    assert.ok(local.id);
    assert.equal(run(data, 'list').length, 1);
    assert.equal(run(data, 'list', '--workspace', workspace).length, 2);
    assert.equal(run(data, 'search', 'Rust').length, 0);
    assert.equal(run(data, 'search', 'Rust', '--workspace', workspace)[0].id, local.id);
    assert.equal(run(data, 'update', global.id, '用户喜欢简洁中文').text, '用户喜欢简洁中文');
    const exported = join(dir, 'export.json');
    run(data, 'export', exported);
    const parsed = JSON.parse(await readFile(exported, 'utf8'));
    assert.equal(parsed.schemaVersion, 1);
    run(join(dir, 'other'), 'import', exported);
    assert.equal(run(join(dir, 'other'), 'list', '--workspace', workspace).length, 2);
    assert.equal(run(data, 'forget', global.id).forgotten, true);
    assert.equal(run(data, 'list').length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI personality controls survive separate processes and reject malformed input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-brain-cli-'));
  try {
    const initial = run(dir, 'personality');
    run(dir, 'personality', 'set', 'verbosity', '0.2');
    const manualVersion = run(dir, 'personality').version;
    run(dir, 'freeze');
    assert.equal(run(dir, 'personality').frozen, true);
    assert.equal(run(dir, 'personality').traits.verbosity, 0.2);
    run(dir, 'unfreeze');
    run(dir, 'reset');
    assert.equal(run(dir, 'personality').traits.verbosity, initial.traits.verbosity);
    run(dir, 'rollback', String(manualVersion));
    assert.equal(run(dir, 'personality').traits.verbosity, 0.2);
    assert.ok(run(dir, 'history').length > 0);
    const before = await readFile(join(dir, 'brain.json'), 'utf8');
    const invalid = spawnSync(process.execPath, [cli, '--data-dir', dir, 'personality', 'set', 'verbosity', 'NaN'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.equal(await readFile(join(dir, 'brain.json'), 'utf8'), before);
    const scope = spawnSync(process.execPath, [cli, '--data-dir', dir, 'remember', 'bad', '--scope', 'workspace'], { encoding: 'utf8' });
    assert.equal(scope.status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
