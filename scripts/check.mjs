// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
const sources = (await Promise.all(['lib', 'bin', 'scripts', 'test'].map(name => files(join(root, name))))).flat();
for (const file of sources.filter(file => /\.[cm]?js$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message || file);
}
const docs = [...(await files(join(root, 'docs'))),
  ...(await readdir(root)).filter(name => name.endsWith('.md')).map(name => join(root, name))];
let links = 0;
for (const file of docs.filter(file => file.endsWith('.md'))) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const href = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split('#')[0]);
    if (!target) continue;
    await access(resolve(dirname(file), target)).catch(() => {
      throw new Error(`Broken local Markdown link in ${file}: ${href}`);
    });
    links++;
  }
}
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[''].version);
assert.equal(manifest.license, 'Apache-2.0');
assert.equal(lock.packages[''].license, manifest.license);
console.log(`Syntax, ${links} local documentation links, and package metadata verified.`);
