// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run this check with npm run pack:check.');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || `${command} failed`);
  return result.stdout;
}
const directory = await mkdtemp(join(tmpdir(), 'dsh-brain-package-'));
try {
  const [pack] = JSON.parse(run(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory]));
  const names = pack.files.map(file => file.path);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const required = ['package.json', 'LICENSE', 'NOTICE', 'README.md', 'README.en.md',
    'lib/index.js', 'lib/core.js', 'lib/client.js', 'lib/config.js', 'lib/extraction.js',
    'bin/brain.mjs', 'cordis.patch.yml', 'scripts/install.ps1', 'scripts/uninstall.ps1'];
  for (const name of required) assert.ok(names.includes(name), `Missing package file: ${name}`);
  for (const name of names) {
    assert.ok(manifest.files.some(allowed => allowed.endsWith('/') ? name.startsWith(allowed) : name === allowed)
      || name === 'package.json', `Unexpected package file: ${name}`);
    assert.doesNotMatch(name, /(?:^|\/)(?:brain\.json(?:\..*)?|\.env(?:\..*)?|node_modules|artifacts|\.git|\.brain\.lock)(?:\/|$)|\.(?:tgz|pem|key|log)$/i);
  }
  run(process.execPath, [npm, 'install', '--prefix', directory, '--ignore-scripts', '--no-audit', '--no-fund', join(directory, pack.filename)], directory);
  const installed = join(directory, 'node_modules', ...manifest.name.split('/'));
  const packageJson = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, manifest.version);
  assert.equal(packageJson.license, 'Apache-2.0');
  assert.match(await readFile(join(installed, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/);
  assert.match(await readFile(join(installed, 'NOTICE'), 'utf8'), /DSH Brain contributors/);
  const plugin = await import(pathToFileURL(join(installed, 'lib/index.js')));
  assert.equal(typeof plugin.apply, 'function');
  const cli = join(installed, 'bin/brain.mjs');
  const data = join(directory, 'synthetic-data');
  assert.match(run(process.execPath, [cli, '--help']), /DSH Brain/);
  const record = JSON.parse(run(process.execPath, [cli, '--data-dir', data, 'remember', 'Synthetic package smoke preference']));
  assert.ok(record.id);
  const records = JSON.parse(run(process.execPath, [cli, '--data-dir', data, 'list']));
  assert.equal(records[0].text, 'Synthetic package smoke preference');
  const bin = process.platform === 'win32' ? join(directory, 'node_modules/.bin/dsh-brain.cmd') : join(directory, 'node_modules/.bin/dsh-brain');
  // npm creates a platform-specific executable shim; verify it is present.
  await readFile(bin);
  console.log(`Verified ${pack.filename}: ${names.length} files, clean install, plugin import and isolated CLI persistence.`);
} finally {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dsh-brain-package-')) {
    throw new Error('Refusing to clean an unexpected package directory');
  }
  await rm(directory, { recursive: true, force: true });
}
