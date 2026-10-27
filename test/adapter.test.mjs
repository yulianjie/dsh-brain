import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BackgroundLearner, createIntegration, runCommand, workspaceOf, apply } from '../lib/index.js';
import { Config, DEFAULTS, readConfig } from '../lib/config.js';
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit';

const config = { extractionMaxQueue: 2, extractionTimeoutMs: 25 };
const job = (id = '1') => ({ sessionId: 'synthetic', turnId: id, workspace: process.cwd(), userText: 'Please keep replies concise.', provider: 'synthetic', model: 'model' });
const chunks = async function* (value) { const text = JSON.stringify(value); yield { type: 'text-delta', index: 0, text }; yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }; };
const extraction = { memories: [], feedback: [] };

test('background deduplicates turns and assembles final block without duplicating deltas', async () => {
  const learned = []; let calls = 0;
  const learner = new BackgroundLearner({ brain: { async learn(value) { learned.push(value); } }, llm: { stream(options) { calls++; assert.equal(options.messages.length, 2); assert.ok(!('tools' in options)); return chunks(extraction); } }, config });
  learner.enqueue(job()); learner.enqueue(job()); await learner.flush();
  assert.equal(calls, 1); assert.equal(learned.length, 1); assert.deepEqual(learned[0].extraction, extraction);
  assert.equal(learner.counters.completed, 1); await learner.close();
});

test('enqueue at drain completion cannot strand a queued job', async () => {
  const learned = [];
  const learner = new BackgroundLearner({ brain: { learn(value) {
    learned.push(value.turnId);
    return Promise.resolve().then(() => {
      if (value.turnId === '1') queueMicrotask(() => queueMicrotask(() => learner.enqueue({ ...job('2'), provider: undefined })));
      return { rejected: 0 };
    });
  } }, llm: {}, config });
  learner.enqueue({ ...job('1'), provider: undefined }); await learner.flush();
  assert.deepEqual(learned, ['1', '2']); assert.equal(learner.queue.length, 0); await learner.close();
});

test('timeout falls back and uncooperative model cannot accumulate orphan calls', async () => {
  let calls = 0; const learned = [];
  const learner = new BackgroundLearner({ brain: { async learn(value) { learned.push(value); } }, llm: { stream() { calls++; return new Promise(() => {}); } }, config });
  learner.enqueue(job('1')); learner.enqueue(job('2')); learner.enqueue(job('3')); learner.enqueue(job('4'));
  await learner.flush();
  assert.equal(calls, 1); assert.equal(learned.length, 3); assert.ok(learned.every(value => value.extraction === undefined));
  assert.equal(learner.counters.extractionFailures, 1); assert.equal(learner.counters.dropped, 1); assert.equal(learner.counters.fallback, 3);
  await learner.close();
});

test('malformed, unfinished, failed, and oversized extraction streams fall back', async () => {
  for (const stream of [
    async function* () { yield { type: 'text-delta', index: 0, text: '{invalid' }; yield { type: 'finish', reason: { kind: 'stop' } }; },
    async function* () { yield { type: 'text-delta', index: 0, text: '{}' }; },
    async function* () { yield { type: 'finish', reason: { kind: 'error' } }; },
    async function* () { yield { type: 'text-delta', index: 0, text: 'x'.repeat(20001) }; },
  ]) {
    let learned;
    const learner = new BackgroundLearner({ brain: { async learn(value) { learned = value; } }, llm: { stream }, config });
    learner.enqueue(job()); await learner.flush(); assert.equal(learned.extraction, undefined); assert.equal(learner.counters.extractionFailures, 1); await learner.close();
  }
});

test('disposing cancels extraction and does not learn afterward', async () => {
  let learned = 0, signal;
  const learner = new BackgroundLearner({ brain: { async learn() { learned++; } }, llm: { stream(options) { signal = options.signal; return new Promise(() => {}); } }, config });
  learner.enqueue(job()); await learner.close(); assert.equal(signal.aborted, true); assert.equal(learned, 0);
});

test('missing route uses deterministic fallback and reports learning errors', async () => {
  const learner = new BackgroundLearner({ brain: { async learn() { throw new Error('storage failed'); } }, llm: { stream() { assert.fail('must not invoke unrouted model'); } }, config });
  learner.enqueue({ ...job(), provider: undefined }); await learner.flush();
  assert.equal(learner.counters.learningFailures, 1); assert.equal(learner.counters.fallback, 1); await learner.close();
});

test('workspace resolves exact live session cwd without process fallback', () => {
  assert.equal(workspaceOf({}, {}), undefined);
  assert.equal(workspaceOf({}, { session: { header: { cwd: 'relative' } } }), undefined);
  assert.equal(workspaceOf({ workingDirectory: { get: () => process.cwd() } }, { session: { header: { cwd: join(tmpdir(), 'old-project') } } }), process.cwd());
});

async function setup(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'brain-adapter-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const handlers = new Map(), tools = new Map(), commands = new Map(), effects = [], contexts = [], warnings = [];
  const agent = { id: 'root', options: {}, session: { id: 'root', header: { cwd: dataDir }, requestHeader: () => ({ config: { provider: 'header-route', model: 'header-model' } }) } };
  const child = { id: 'child', session: { id: 'child', header: { cwd: dataDir } } };
  let calls = 0;
  const ctx = {
    agents: { roots: () => [agent], get: id => id === 'root' ? agent : child },
    workingDirectory: { get: session => session.header.cwd },
    systemPrompt: { context: definition => contexts.push(definition) },
    tools: { register: definition => tools.set(definition.name, definition) },
    commands: { register: definition => commands.set(definition.name, definition) },
    on(event, handler) { handlers.set(event, handler); }, effect(fn) { effects.push(fn()); }, logger: { warn: value => warnings.push(value) },
    llm: { stream(request) { calls++; assert.equal(request.provider, 'header-route'); return chunks(extraction); } },
  };
  const runtimeOptions = { dataDir, ...options };
  const handle = await createIntegration(ctx, runtimeOptions);
  t.after(async () => { for (const effect of effects) await effect(); });
  return { ...handle, ctx, runtimeOptions, handlers, tools, commands, contexts, agent, child, dataDir, warnings, calls: () => calls };
}
const input = (text, source = 'user') => ({ role: 'user', source: { kind: source }, content: [{ type: 'text', text }] });

test('integration learns only real user text from completed live root turns', async t => {
  const state = await setup(t); const claimed = state.handlers.get('agent/inbox/claimed'), event = state.handlers.get('session/event');
  claimed({ agent: state.child, turn: 1, message: input('subagent private') });
  event(state.child.session, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
  claimed({ agent: state.agent, turn: 1, message: input('runtime secret', 'runtime-context') });
  claimed({ agent: state.agent, turn: 1, message: input('Please keep replies concise.') });
  event(state.agent.session, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error' } } });
  assert.equal(state.calls(), 0);
  event(state.agent.session, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } });
  event(state.agent.session, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } });
  await state.learner.flush(); assert.equal(state.calls(), 1); assert.equal((await state.brain.stats()).processedTurns, 1);
});

test('autoLearn disabled preserves query-aware prompt recall without invoking model', async t => {
  const state = await setup(t, { autoLearn: false });
  await state.brain.remember({ text: 'ORBIT manifests', scope: 'workspace', workspace: state.dataDir });
  await state.brain.remember({ text: 'NEBULA artifacts', scope: 'workspace', workspace: state.dataDir });
  state.handlers.get('agent/inbox/claimed')({ agent: state.agent, turn: 1, message: input('NEBULA') });
  const text = state.contexts[0].text({ agent: state.agent });
  assert.ok(text.includes('NEBULA')); assert.ok(!text.includes('ORBIT')); assert.equal(state.contexts[0].interpolate, false);
  state.handlers.get('session/event')(state.agent.session, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
  await state.learner.flush(); assert.equal(state.calls(), 0);
});

test('live cwd change cannot reattribute initial user evidence to another workspace', async t => {
  const state = await setup(t);
  state.ctx.llm.stream = async function* (request) {
    const text = JSON.parse(request.messages[1].content[0].text).USER;
    assert.equal(text, 'Project A stores ORBIT manifests.');
    yield* chunks({ memories: [{ text, evidence: text, scope: 'workspace', kind: 'fact', confidence: 0.9 }], feedback: [] });
  };
  state.handlers.get('agent/inbox/claimed')({ agent: state.agent, turn: 1, message: input('Project A stores ORBIT manifests.') });
  const workspaceB = join(state.dataDir, 'project-b'); state.agent.session.header.cwd = workspaceB;
  state.handlers.get('agent/inbox/claimed')({ agent: state.agent, turn: 1, message: input('Project B stores NEBULA data.') });
  state.handlers.get('session/event')(state.agent.session, { type: 'turn/end', seq: 9, data: { turn: 1, reason: { kind: 'completed' } } });
  await state.learner.flush();
  assert.ok(state.brain.context({ workspace: state.dataDir, query: 'ORBIT' }).includes('ORBIT'));
  assert.ok(!state.brain.context({ workspace: workspaceB, query: 'ORBIT' }).includes('ORBIT'));
  assert.equal((await state.brain.list({ workspace: workspaceB })).length, 0);
});

test('corrupt storage skips prompt context with one warning and preserves corrupt bytes', async t => {
  const state = await setup(t); await writeFile(state.brain.file, '{corrupt', 'utf8');
  assert.equal(state.contexts[0].text({ agent: state.agent }), ''); assert.equal(state.contexts[0].text({ agent: state.agent }), '');
  assert.equal(state.warnings.length, 1); await assert.rejects(state.brain.stats());
});

test('native command and tool definitions use current runtime contract', async t => {
  const state = await setup(t); assert.equal(state.tools.size, 5);
  const command = state.commands.get('brain'); assert.equal(command.recordInput, false);
  const result = await command.handler({ agent: state.agent, rawInput: 'remember workspace Project uses ORBIT' });
  assert.equal(result.kind, 'success');
  const output = await state.tools.get('brain_search').execute({ query: 'ORBIT' }, { agent: state.agent });
  assert.ok(output.includes('ORBIT')); assert.deepEqual(state.tools.get('brain_search').output.render({}, output), [{ type: 'text', text: output }]);
  const error = await command.handler({ agent: state.agent, rawInput: 'personality verbosity=oops' }); assert.equal(error.kind, 'error');
  assert.equal(await apply(state.ctx, { dataDir: join(state.dataDir, 'second') }), undefined);
});

test('human controls freeze/reset/history/rollback/manual traits are available', async t => {
  const state = await setup(t);
  await runCommand(state.brain, state.dataDir, 'freeze'); assert.equal((await state.brain.personality()).frozen, true);
  await runCommand(state.brain, state.dataDir, 'unfreeze');
  await runCommand(state.brain, state.dataDir, 'personality warmth=0.8 verbosity=0.2'); assert.equal((await state.brain.personality()).traits.warmth, 0.8);
  const history = await runCommand(state.brain, state.dataDir, 'history');
  await runCommand(state.brain, state.dataDir, 'reset'); assert.equal((await state.brain.personality()).traits.warmth, 0.5);
  await runCommand(state.brain, state.dataDir, `rollback ${history.at(-1).version}`); assert.equal((await state.brain.personality()).traits.warmth, 0.8);
  await assert.rejects(runCommand(state.brain, undefined, 'remember workspace not allowed'));
});

test('feedback captured before a manual control cannot drift personality after deferred extraction', async t => {
  const state = await setup(t);
  // Two valid rounds make the next stale result capable of crossing the threshold.
  await state.brain.learn({ ...job('seed-1') }); await state.brain.learn({ ...job('seed-2') });
  const generation = state.brain.personalityGeneration;
  let release; const entered = Promise.withResolvers();
  const ready = new Promise(resolve => { release = resolve; });
  state.ctx.llm.stream = async function* () { entered.resolve(); await ready; yield* chunks({ memories: [], feedback: [{ trait: 'verbosity', value: 0.1, evidence: 'Please keep replies concise.', confidence: 0.95 }] }); };
  state.handlers.get('agent/inbox/claimed')({ agent: state.agent, turn: 1, message: input('Please keep replies concise.') });
  state.handlers.get('session/event')(state.agent.session, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } });
  await entered.promise;
  await runCommand(state.brain, state.dataDir, 'freeze'); await runCommand(state.brain, state.dataDir, 'unfreeze');
  assert.ok(state.brain.personalityGeneration > generation);
  release(); await state.learner.flush();
  assert.equal((await state.brain.personality()).traits.verbosity, 0.5);
  assert.equal((await state.brain.personality()).evidenceCounts.verbosity, 0);
});

test('native Config exposes labeled volatile fields and validates complete route pairs', () => {
  const fields = Object.entries(Config.dict).filter(([, schema]) => schema.meta.volatile);
  assert.equal(fields.length, 20); assert.equal(Config.dict.dataDir.meta.volatile, undefined);
  assert.ok(fields.every(([, schema]) => schema.meta.description && schema.meta.help && schema.meta.group));
  assert.ok(Config['~standard'].validate({ extractionProvider: 'only-provider' }).issues);
  assert.ok(Config['~standard'].validate({ extractionModel: 'only-model' }).issues);
  assert.ok(!Config['~standard'].validate({ extractionProvider: ' ', extractionModel: ' ' }).issues);
  assert.equal(readConfig({ extractionProvider: ' provider ', extractionModel: ' model ' }).extractionProvider, 'provider');
  assert.throws(() => readConfig({ extractionTimeoutMs: 0 }));
  assert.throws(() => readConfig({ maxMemories: 0 }));
  assert.throws(() => readConfig({ manualVerbosity: 2 }));
  assert.throws(() => readConfig({ extractionProvider: 'provider' }));
});

test('native stable refs change context policy and limits without writing learned state', async t => {
  const refs = Config({});
  const state = await setup(t, refs);
  await state.brain.remember({ text: 'ORBIT project manifest', scope: 'workspace', workspace: state.dataDir });
  await state.brain.setPersonality({ frozen: true, traits: { verbosity: 0.35 } });
  const stored = await state.brain.exportData();
  updateVolatile(refs.injectMemories, createVolatile(false));
  updateVolatile(refs.personalityMode, createVolatile('manual'));
  updateVolatile(refs.manualVerbosity, createVolatile(0.2));
  updateVolatile(refs.maxContextChars, createVolatile(3000));
  await state.handlers.get('loader/volatile-update')([['injectMemories'], ['personalityMode'], ['manualVerbosity'], ['maxContextChars']]);
  const context = state.contexts[0].text({ agent: state.agent });
  assert.ok(context.includes('"mode":"manual"')); assert.ok(context.includes('"verbosity":0.2')); assert.ok(!context.includes('ORBIT'));
  assert.equal(state.brain.maxContextChars, 3000);
  assert.deepEqual(await state.brain.exportData(), stored);
  updateVolatile(refs.personalityMode, createVolatile('adaptive'));
  await state.syncConfig(); assert.ok(state.contexts[0].text({ agent: state.agent }).includes('"verbosity":0.35'));
  assert.deepEqual(await state.brain.exportData(), stored);
});

test('disable and re-enable automatic learning invalidates an already admitted turn', async t => {
  const state = await setup(t, Config({}));
  state.handlers.get('agent/inbox/claimed')({ agent: state.agent, turn: 1, message: input('Please keep replies concise.') });
  updateVolatile(state.runtimeOptions.autoLearn, createVolatile(false)); await state.syncConfig();
  updateVolatile(state.runtimeOptions.autoLearn, createVolatile(true)); await state.syncConfig();
  state.handlers.get('session/event')(state.agent.session, { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } });
  await state.learner.flush(); assert.equal(state.calls(), 0); assert.equal((await state.brain.stats()).processedTurns, 0);
});

test('live learning configuration cancels inflight extraction and queued evidence', async t => {
  const state = await setup(t, Config({}));
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let signal;
  state.ctx.llm.stream = async function* (request) { signal = request.signal; entered.resolve(); await release.promise; yield* chunks(extraction); };
  const send = turn => {
    state.handlers.get('agent/inbox/claimed')({ agent: state.agent, turn, message: input('Please keep replies concise.') });
    state.handlers.get('session/event')(state.agent.session, { type: 'turn/end', seq: turn * 10, data: { turn, reason: { kind: 'completed' } } });
  };
  send(1); await entered.promise; send(2);
  updateVolatile(state.runtimeOptions.personalityLearningEnabled, createVolatile(false));
  await state.syncConfig();
  assert.equal(signal.aborted, true); assert.equal(state.learner.queue.length, 0); assert.equal((await state.brain.stats()).processedTurns, 0);
  release.resolve(); await state.learner.flush();
  assert.equal((await state.brain.personality()).evidenceCounts.verbosity, 0);
});

test('explicit extraction route and token budget update live, blank pair follows session', async t => {
  const state = await setup(t, Config({ extractionProvider: ' other-provider ', extractionModel: ' other-model ', extractionMaxTokens: 512 }));
  const requests = [];
  state.ctx.llm.stream = request => { requests.push(request); return chunks(extraction); };
  const send = async turn => {
    state.handlers.get('agent/inbox/claimed')({ agent: state.agent, turn, message: input('Synthetic current user fact.') });
    state.handlers.get('session/event')(state.agent.session, { type: 'turn/end', seq: turn, data: { turn, reason: { kind: 'completed' } } });
    await state.learner.flush();
  };
  await send(1); assert.equal(requests[0].provider, 'other-provider'); assert.equal(requests[0].model, 'other-model'); assert.equal(requests[0].maxTokens, 512);
  updateVolatile(state.runtimeOptions.extractionProvider, createVolatile('')); updateVolatile(state.runtimeOptions.extractionModel, createVolatile('')); await state.syncConfig();
  await send(2); assert.equal(requests[1].provider, 'header-route'); assert.equal(requests[1].model, 'header-model');
  const before = state.brain.maxContextChars;
  updateVolatile(state.runtimeOptions.maxContextChars, createVolatile(1234)); updateVolatile(state.runtimeOptions.extractionProvider, createVolatile('invalid-partial'));
  assert.throws(() => state.syncConfig(), /同时/); assert.equal(state.brain.maxContextChars, before);
});
