import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package exposes its plugin bundle and standalone management CLI', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.name, '@yulianjie/dsh-brain');
  assert.equal(manifest.publishConfig.access, 'public');
  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.bin['dsh-brain'], 'bin/brain.mjs');
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.ok(patch.includes(`name: '${manifest.name}'`));
  const uninstall = await readFile(new URL('../scripts/uninstall.ps1', import.meta.url), 'utf8');
  assert.ok(uninstall.includes(`remove '${manifest.name}'`));
  for (const name of ['install', 'uninstall']) {
    const script = await readFile(new URL(`../scripts/${name}.ps1`, import.meta.url), 'utf8');
    assert.match(script, /resources\\runtime\\cli\\bin\\dsh\.cmd/);
    assert.match(script, /plugin --profile \$Profile (add|remove)/);
    assert.doesNotMatch(script, /Set-Content|Out-File|WriteAllText/);
  }
});
