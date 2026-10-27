import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIntegration } from '../lib/index.js';

test('explicit syncConfig barrier waits for an already-issued atomic commit to settle', async t => {
  const dataDir = await fs.mkdtemp(join(tmpdir(), 'brain-settings-review-'));
  const options = { dataDir };
  const handlers = new Map(), effects = [];
  const agent = { id: 'root', options: {}, session: { id: 'root', header: { cwd: dataDir }, requestHeader: () => ({ config: {} }) } };
  const ctx = {
    agents: { roots: () => [agent], get: () => agent },
    workingDirectory: { get: () => dataDir },
    systemPrompt: { context() {} }, tools: { register() {} }, commands: { register() {} },
    on(name, handler) { handlers.set(name, handler); }, effect(fn) { effects.push(fn()); },
    logger: { warn() {} }, llm: {},
  };
  const handle = await createIntegration(ctx, options);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const originalRename = fs.rename;
  fs.rename = async (...args) => {
    if (args[1] === handle.brain.file) { entered.resolve(); await release.promise; }
    return originalRename(...args);
  };
  t.after(async () => {
    release.resolve();
    for (const effect of effects) await effect();
    fs.rename = originalRename;
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  handlers.get('agent/inbox/claimed')({ agent, turn: 1, message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请记住合成测试标记 ORBIT。' }] } });
  handlers.get('session/event')(agent.session, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
  await entered.promise;
  options.autoLearn = false;
  let settled = false;
  // Native Cordis emits volatile-update synchronously and ignores promises;
  // direct integrations can additionally await this explicit disposal barrier.
  const update = handle.syncConfig().then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'settings save returned while an already-issued filesystem commit remained in flight');
  release.resolve(); await update;
  assert.equal(settled, true);
});
