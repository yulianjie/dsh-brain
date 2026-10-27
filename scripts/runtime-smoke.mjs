#!/usr/bin/env node
// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
// Extracts ONLY executable package code from Desktop's app.asar to a disposable
// directory, then tests those exact bundled services. No profile/auth/session files.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[2] !== '--inside') {
  const desktop = process.env.DSH_DESKTOP_EXE ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe');
  const archive = join(desktop, '..', 'resources', 'app.asar', 'dsh', 'node_modules');
  const directory = mkdtempSync(join(tmpdir(), 'dsh-brain-runtime-'));
  const extractor = join(directory, 'extract.cjs');
  writeFileSync(extractor, `const fs=require('fs'),path=require('path'),Module=require('module');
const source=${JSON.stringify(archive)}, target=${JSON.stringify(join(directory, 'node_modules'))};
const todo=['@deepseek-ai/cordis','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-commands','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-session','@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-token-meter','@deepseek-ai/dsh-working-directory','@deepseek-ai/dsh-settings','@deepseek-ai/dsh-config-editor','@deepseek-ai/dsh-app-boot'];
const done=new Set();let files=0;
function copy(from,to){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory()){if(entry.name!=='node_modules')copy(a,b);}else{const value=fs.readFileSync(a);fs.writeFileSync(b,value);files++;if(/\\.[cm]?js$/.test(entry.name)){const text=value.toString();const re=/(?:from\\s*|import\\s*\\(|require\\s*\\()?["'](@[a-zA-Z0-9_.-]+\\/[a-zA-Z0-9_.-]+|[a-zA-Z][a-zA-Z0-9_.-]*)(?:\\/[^"']*)?["']/g;for(const m of text.matchAll(re)){const n=m[1];if(!Module.isBuiltin(n)&&fs.existsSync(path.join(source,n,'package.json')))todo.push(n);}}}}}
while(todo.length){const name=todo.shift();if(done.has(name))continue;done.add(name);copy(path.join(source,name),path.join(target,name));}
console.log(JSON.stringify({source,packages:done.size,files,cordis:JSON.parse(fs.readFileSync(path.join(target,'@deepseek-ai/cordis/package.json'))).version,agentLoop:JSON.parse(fs.readFileSync(path.join(target,'@deepseek-ai/dsh-agent-loop/package.json'))).version}));`);
  try {
    const extraction = spawnSync(desktop, ['--expose-internals', extractor], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 120000 });
    process.stdout.write(extraction.stdout ?? '');
    if (extraction.status !== 0) throw new Error(`Desktop extraction failed: ${(extraction.stderr ?? '').slice(-3000)}`);
    const runtime = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--inside', directory], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(runtime.stdout ?? ''); process.stderr.write(runtime.stderr ?? '');
    if (runtime.status !== 0) throw new Error('Bundled runtime smoke failed');
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dsh-brain-runtime-')) throw new Error('Refusing to clean an unexpected runtime directory');
    rmSync(directory, { recursive: true, force: true });
  }
} else {
  const { pathToFileURL } = await import('node:url');
  const assert = (await import('node:assert/strict')).default;
  const directory = process.argv[3];
  const load = name => import(pathToFileURL(join(directory, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')));
  const { Context, Service } = await load('cordis');
  const prompt = await load('dsh-system-prompt');
  const tools = await load('dsh-tools');
  const commands = await load('dsh-commands');
  const agents = await load('dsh-agent');
  const sessions = await load('dsh-session');
  const projections = await load('dsh-session-projection');
  const tokenMeter = await load('dsh-token-meter');
  const llm = await load('dsh-llm');
  const loop = await load('dsh-agent-loop');
  const workingDirectory = await load('dsh-working-directory');
  const packageRoot = resolve(process.env.DSH_BRAIN_PACKAGE_DIR ?? fileURLToPath(new URL('../', import.meta.url)));
  const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const { createIntegration, default: brainPlugin } = await import(pathToFileURL(join(packageRoot, 'lib/index.js')));
  const { Brain } = await import(pathToFileURL(join(packageRoot, 'lib/core.js')));
  const packageLink = join(directory, 'node_modules', ...packageManifest.name.split('/'));
  mkdirSync(dirname(packageLink), { recursive: true });
  symlinkSync(packageRoot, packageLink, process.platform === 'win32' ? 'junction' : 'dir');
  const { runInNewContext } = await import('node:vm');
  let clientId;
  runInNewContext(readFileSync(join(packageRoot, 'lib/client.js'), 'utf8'), { window: { __ModuleLoader__: { load(bundle) { clientId = bundle.id; } } } });
  assert.equal(clientId, packageManifest.name);
  const ctx = new Context();
  const failures = [];
  ctx.on('internal/error', error => { failures.push(String(error)); console.error(error); });
  ctx.plugin(prompt.default, {}); ctx.plugin(tools.default, { mode: 'native' });
  ctx.plugin(commands.default); ctx.plugin(agents.default); ctx.plugin(sessions.default);
  ctx.plugin(projections.default); ctx.plugin(tokenMeter.default); ctx.plugin(llm.default); ctx.plugin(loop.default, { agents: [], maxParallelToolCalls: 10 });
  // Filesystem transport is a deterministic test double; cwd projection,
  // recovery validation, context, and change commits use the actual service.
  class TestFilesystem extends Service {
    constructor(ctx) { super(ctx, 'fs'); }
    async resolve(path) { return path; }
    async stat() { return { type: 'directory' }; }
    processPath(path) { return path; }
  }
  ctx.plugin(TestFilesystem);
  ctx.plugin(workingDirectory.default, { defaultDirectory: directory });
  let handle;
  ctx.plugin({ name: 'brain-smoke', inject: ['systemPrompt','tools','commands','agents','llm','workingDirectory','tokenMeter'], async apply(child) { handle = await createIntegration(child, { dataDir: join(directory, 'brain'), extractionTimeoutMs: 1000 }); } });
  for (let i = 0; i < 200 && !handle; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(handle, 'plugin must mount with real Cordis service injection');
  let calls = 0, extractions = 0; const requests = [];
  class Synthetic extends llm.LlmAdapter {
    async *stream(options) {
      calls++; requests.push(options);
      let text = 'Synthetic response.';
      if (options.purpose === 'compaction') {
        extractions++;
        const user = JSON.parse(options.messages[1].content[0].text).USER;
        const style = user.includes('concise');
        text = JSON.stringify({ memories: [{ text: user, evidence: user, kind: style ? 'preference' : 'fact', scope: style ? 'global' : 'workspace', confidence: 0.95, key: style ? 'style:verbosity' : 'project-format' }], feedback: style ? [{ trait: 'verbosity', value: 0.1, evidence: user, confidence: 0.95 }] : [] });
      }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['brain-synthetic'], new Synthetic());
  const workspaceA = resolve(directory, 'project-a'), workspaceB = resolve(directory, 'project-b');
  mkdirSync(workspaceA); mkdirSync(workspaceB);
  const make = (id, cwd) => ctx.agentLoop.create(id, { provider: 'brain-synthetic', model: 'synthetic' }, { cwd });
  const agent = await make('brain-synthetic-root', workspaceA);
  const turn = async (target, text, owner = ctx) => {
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('agent turn timed out')), 5000);
      const off = owner.on('session/event', (session, event) => {
        if (session.id === target.id && event.type === 'turn/end') { clearTimeout(timer); off(); assert.equal(event.data.reason.kind, 'completed'); resolve(); }
      });
    });
    target.followup(llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
    await done; if (owner === ctx) await handle.learner.flush();
  };
  for (let i = 0; i < 3; i++) await turn(agent, 'Please keep replies concise.');
  assert.equal(extractions, 3);
  assert.equal((await handle.brain.personality()).traits.verbosity, 0.45);
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'brain:long-term-reference').length, 1, 'evidence-only changes must not rewrite the model snapshot');
  await turn(agent, 'This project stores its build manifests in the NEBULA format.');
  const outcome = await ctx.commands.execute(agent, '/brain remember workspace Project A uses the ORBIT format.', [], new AbortController().signal);
  assert.ok(JSON.stringify(outcome).includes('Project A uses the ORBIT format.'));
  const fresh = await make('brain-synthetic-new-session', workspaceA);
  const other = await make('brain-synthetic-other-project', workspaceB);
  const assembly = await ctx.systemPrompt.assemble(agents.assembleContextFor(fresh));
  const context = { text: handle.contextFor(fresh) };
  assert.ok(context.text.includes('ORBIT')); assert.ok(!assembly.contexts.some(item => item.name === 'brain:long-term-reference'));
  assert.ok(context.text.includes('concise'));
  assert.ok(context.text.includes('NEBULA'), 'ordinary chat must be automatically learned');
  assert.ok(!handle.contextFor(other).includes('ORBIT'));
  const execution = await ctx.tools.execute({ name: 'brain_search', arguments: { query: 'ORBIT' }, agent: fresh, callId: 'smoke-search', signal: new AbortController().signal });
  assert.equal(execution.isError, false); assert.ok(JSON.stringify(execution).includes('ORBIT'));
  const restarted = new Brain({ dataDir: join(directory, 'brain') }); await restarted.init();
  assert.ok(restarted.context({ workspace: workspaceA }).includes('ORBIT'));
  // Confirm model-facing native schema registration and actual new-session prompt.
  assert.equal(assembly.tools.filter(tool => tool.name.startsWith('brain_')).length, 6);
  await turn(fresh, 'What are the ORBIT and NEBULA formats used in this project?');
  const request = requests.filter(item => item.purpose !== 'compaction').at(-1);
  assert.ok(JSON.stringify(request.messages).includes('ORBIT'));
  assert.ok(JSON.stringify(request.messages).includes('NEBULA'));
  await ctx.workingDirectory.set(fresh, workspaceB);
  assert.equal(ctx.workingDirectory.get(fresh.session), workspaceB);
  assert.ok(!handle.contextFor(fresh).includes('ORBIT'));
  // Global preference recall must survive unrelated questions and cwd changes.
  await handle.brain.remember({ text: 'GLOBAL_PREFERENCE: 我喜欢中文回答。', kind: 'preference', scope: 'global' });
  await handle.brain.remember({ text: 'SECRET_A_ONLY deployment', scope: 'workspace', workspace: workspaceA });
  const long = await make('brain-long-session', workspaceA);
  const requestStart = requests.length;
  for (let i = 0; i < 30; i++) {
    if (i === 15) await ctx.workingDirectory.set(long, workspaceB);
    await turn(long, i % 2 ? 'Please keep replies concise.' : 'Tell me about deployment.');
    const latest = requests.filter(item => item.purpose !== 'compaction').at(-1);
    const snapshots = latest.messages.filter(m => m.source.kind === 'brain:long-term-reference');
    assert.equal(snapshots.length, 1, 'a request must contain exactly one current Brain snapshot');
    const reference = snapshots[0].content[0].text;
    assert.ok(reference.includes('GLOBAL_PREFERENCE'));
    assert.ok(reference.length <= 6000);
    if (i >= 15) assert.ok(!reference.includes('SECRET_A_ONLY'));
    assert.ok(!latest.messages.some(m => m.source.kind === 'runtime-context' && m.source.sections?.some(s => s.name === 'brain:long-term-reference')));
    const measured = ctx.tokenMeter.measure(long.session);
    const breakdown = ctx.sessionProjections.stateOf(long.session, 'contextBreakdown');
    assert.equal(breakdown.surfaceTokens, measured.surfaceTokens, 'replacement shadow prices must keep host accounting accurate');
  }
  const longMeasurements = requests.slice(requestStart).filter(r => r.purpose !== 'compaction').map(r => {
    const own = r.messages.filter(m => m.source.kind === 'brain:long-term-reference');
    return { snapshots: own.length, chars: own.reduce((n, m) => n + m.content[0].text.length, 0) };
  });
  // Surface replacements must replay without this plugin or custom event interpreters.
  const restored = new sessions.Session(long.session.id, long.session.snapshotEvents(), long.session.header);
  assert.deepEqual(restored.deriveMessages(), long.session.deriveMessages());
  // Model-only compaction can remove the slot; the next request must restore it.
  const ownSeq = long.session.surface.nodes.find(seq => long.session.eventAt(seq)?.data?.source?.kind === 'brain:long-term-reference');
  const previousSnapshot = long.session.deriveEventMessage(long.session.eventAt(ownSeq));
  long.session.append('compaction/prune', { shadowedRange: { start: ownSeq, end: ownSeq }, shadowedSeqs: [ownSeq], shadowedTokenCount: ctx.tokenMeter.estimateMessage(previousSnapshot) });
  long.session.append('user/message', { id: 'synthetic-summary', role: 'user', source: { kind: 'synthetic-compaction' }, content: [{ type: 'text', text: 'Synthetic conversation summary.' }] }, { surfaceOp: { op: 'replace', startSeq: ownSeq, endSeq: ownSeq }, sourceEventSeqs: [ownSeq] });
  await turn(long, 'What are my preferences after compaction?');
  assert.equal(long.session.deriveMessages().filter(m => m.source.kind === 'brain:long-term-reference').length, 1);
  assert.ok(long.session.deriveMessages().find(m => m.source.kind === 'brain:long-term-reference').content[0].text.includes('GLOBAL_PREFERENCE'));
  const duplicate = long.session.deriveMessages().find(m => m.source.kind === 'brain:long-term-reference');
  long.session.append('user/message', { ...duplicate, id: 'duplicate-reference' }, { surfaceOp: 'append' });
  await turn(long, 'Deduplicate imported snapshots.');
  assert.equal(long.session.deriveMessages().filter(m => m.source.kind === 'brain:long-term-reference').length, 1);
  // Migrate legacy shared snapshots while preserving unrelated named sections.
  const legacy = await make('brain-legacy-session', workspaceB);
  const oldText = 'LEGACY_PRIVATE_A';
  legacy.session.append('user/message', { id: 'legacy-memory', role: 'user', content: [{ type: 'text', text: oldText }],
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'brain:long-term-reference', text: oldText }, { name: 'other:context', text: 'OTHER_PLUGIN_PRESERVED' }] } }, { surfaceOp: 'append' });
  await turn(legacy, 'What are my preferences?');
  const migrated = requests.filter(r => r.purpose !== 'compaction').at(-1);
  assert.ok(!JSON.stringify(migrated.messages).includes(oldText));
  assert.ok(JSON.stringify(migrated.messages).includes('OTHER_PLUGIN_PRESERVED'));
  assert.ok(legacy.session.snapshotEvents().some(e => e.type === 'user/message' && JSON.stringify(e.data).includes(oldText)), 'original log must remain intact');
  // Live settings clear the retained snapshot on the next request, even in an old session.
  await handle.brain.configure({ injectMemories: false, injectPersonality: false });
  await turn(long, 'A plain request.');
  const disabled = requests.filter(r => r.purpose !== 'compaction').at(-1).messages.find(m => m.source.kind === 'brain:long-term-reference');
  assert.equal(disabled.content[0].text, 'Brain reference disabled.');
  await handle.brain.configure({ injectMemories: true, injectPersonality: true });
  console.log(JSON.stringify({ contextAudit: true, longTurns: longMeasurements.length, maximumBrainSnapshots: Math.max(...longMeasurements.map(x => x.snapshots)), maximumBrainChars: Math.max(...longMeasurements.map(x => x.chars)), sessionReplay: true, legacyMigration: true, unrelatedSectionsPreserved: true, globalAcrossWorkspaces: true, disableClearsOldContext: true, restoresAfterCompaction: true, hostTokenAccounting: true }));
  await ctx.commands.execute(agent, '/brain freeze', [], new AbortController().signal);
  assert.equal((await handle.brain.personality()).frozen, true);
  const learnedBeforeRestart = await handle.brain.personality();
  await ctx.fiber.dispose();
  assert.deepEqual(failures, []);
  // Mount the exact exported plugin entry, including Cordis's strict apply()
  // return contract, on a fresh host rather than only the diagnostic wrapper.
  const freshHost = new Context();
  freshHost.plugin(prompt.default, {}); freshHost.plugin(tools.default, { mode: 'native' });
  freshHost.plugin(commands.default); freshHost.plugin(agents.default); freshHost.plugin(sessions.default);
  freshHost.plugin(projections.default); freshHost.plugin(tokenMeter.default); freshHost.plugin(llm.default); freshHost.plugin(TestFilesystem);
  freshHost.plugin(workingDirectory.default, { defaultDirectory: directory });
  const pluginFiber = freshHost.plugin(brainPlugin, { dataDir: join(directory, 'brain') });
  for (let i = 0; i < 200 && pluginFiber.state !== 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  await pluginFiber.await(); assert.equal(pluginFiber.state, 2);
  await freshHost.fiber.dispose();
  // A complete synthetic profile exercises the actual config-editor persistence
  // and Loader reconciliation path used by Desktop's native settings forms.
  const appBoot = await load('dsh-app-boot');
  const configEditor = await load('dsh-config-editor');
  const settings = await load('dsh-settings');
  const NativeSchema = (await import(pathToFileURL(join(directory, 'node_modules/@deepseek-ai/schemastery/lib/index.cjs')))).default;
  const profileDir = join(directory, 'settings-profile'), home = join(directory, 'settings-home');
  mkdirSync(profileDir); mkdirSync(home);
  const patchPath = join(profileDir, 'cordis.patch.yml'), configPath = join(profileDir, 'cordis.yml');
  const profile = { name: 'brain-synthetic-settings', dir: profileDir, home, patchPath, installAnchor: join(directory, 'package.json'), overlays: [] };
  writeFileSync(profile.installAnchor, JSON.stringify({ name: 'dsh', version: '0.2.1-rc.3' }));
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'brain-synthetic-settings', private: true, dsh: { profile: { bundles: [] } } }));
  writeFileSync(configPath, '[]\n');
  writeFileSync(patchPath, JSON.stringify([{ insert: [{ id: 'brain', name: packageManifest.name, config: { dataDir: join(directory, 'brain') } }] }]));
  const bootSettings = () => appBoot.boot('brain-smoke', configPath, appBoot.readProfilePatches('brain-smoke', profile), async host => {
    host.provide('profileContext', profile);
    host.plugin(prompt.default, {}); host.plugin(tools.default, { mode: 'native' });
    host.plugin(commands.default); host.plugin(agents.default); host.plugin(sessions.default);
    host.plugin(projections.default); host.plugin(tokenMeter.default); host.plugin(llm.default); host.plugin(loop.default, { agents: [], maxParallelToolCalls: 10 });
    host.plugin(TestFilesystem); host.plugin(workingDirectory.default, { defaultDirectory: directory });
    host.plugin(configEditor.default); host.plugin(settings.default);
  });
  const host = await bootSettings();
  const descriptor = () => host.settings.describe().find(item => item.ns === 'brain');
  const formSchema = new NativeSchema(descriptor().schema);
  assert.equal(Object.keys(formSchema.dict).length, 23);
  assert.ok(!('dataDir' in formSchema.dict));
  const entry = [...host.loader.entries()].find(item => item.options.id === 'brain');
  const originalUid = entry.fiber.uid, storedBefore = readFileSync(join(directory, 'brain/brain.json'), 'utf8');
  await host.settings.mutate('brain', [{ op: 'set', path: ['autoLearn'], value: false }, { op: 'set', path: ['injectMemories'], value: false }, { op: 'set', path: ['personalityMode'], value: 'manual' }, { op: 'set', path: ['manualVerbosity'], value: 0.2 }], descriptor().revision);
  assert.equal(entry.fiber.uid, originalUid, 'volatile settings must preserve the live plugin fiber');
  host.llm.registerAdapter(['brain-synthetic'], new Synthetic());
  const uiAgent = await host.agentLoop.create('settings-probe', { provider: 'brain-synthetic', model: 'synthetic' }, { cwd: workspaceA });
  await turn(uiAgent, 'Show configured style.', host);
  const updatedContext = requests.filter(r => r.purpose !== 'compaction').at(-1).messages.find(m => m.source.kind === 'brain:long-term-reference').content[0].text;
  assert.ok(!updatedContext.includes('ORBIT')); assert.ok(updatedContext.includes('"mode":"manual"')); assert.ok(updatedContext.includes('"verbosity":0.2'));
  assert.equal(readFileSync(join(directory, 'brain/brain.json'), 'utf8'), storedBefore, 'settings edits must not overwrite learned/frozen personality');
  const patchBeforeInvalid = readFileSync(patchPath, 'utf8');
  await assert.rejects(host.settings.mutate('brain', [{ op: 'set', path: ['extractionProvider'], value: 'partial-route' }], descriptor().revision), /同时/);
  assert.equal(readFileSync(patchPath, 'utf8'), patchBeforeInvalid, 'invalid pair must be rejected before persistence');
  assert.equal(descriptor().value.extractionProvider, '');
  await host.fiber.dispose();
  const rebooted = await bootSettings();
  const restoredSettings = rebooted.settings.describe().find(item => item.ns === 'brain');
  assert.equal(restoredSettings.value.injectMemories, false); assert.equal(restoredSettings.value.personalityMode, 'manual'); assert.equal(restoredSettings.value.manualVerbosity, 0.2);
  const restartedPersona = await restarted.personality();
  assert.equal(restartedPersona.frozen, true); assert.deepEqual(restartedPersona, learnedBeforeRestart);
  await rebooted.fiber.dispose();
  console.log(JSON.stringify({ ok: true, packageName: packageManifest.name, packageVersion: packageManifest.version, scopedLoaderResolution: true, clientModuleIdentity: true, actualCordis: true, exportedPluginMounted: true, actualAgentLoop: true, actualWorkingDirectory: true, nativeTools: 6, nativeCommands: true, automaticFactExtraction: true, crossSessionRecall: true, workspaceIsolation: true, cwdChanges: true, gradualPersonality: true, persistedRestart: true, actualSettingsAPI: true, actualConfigEditor: true, actualLoaderVolatileUpdate: true, editableFields: 23, invalidPairRejectedBeforePersistence: true, settingsPersistedRestart: true, learnedPersonalityPreserved: true, calls, extractions }));
}
