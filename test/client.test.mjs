import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Config, DEFAULTS } from '../lib/config.js';

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
// Native primitive stand-ins expose registration/render/controller boundaries.
// Persistence semantics are tested against the real Host in settings smoke/UI.
class NativeForm {
  constructor(scope, specs) { this.scope = scope; this.specs = specs; this.saved = 0; this.values = {}; }
  bind(project) { return { getSnapshot: project, subscribe: () => () => {} }; }
  shell() { return { available: true, writable: this.scope.writable !== false, dirty: true, invalid: this.specs.some(spec => this.field(spec.field).invalid), saving: false }; }
  field(key) { const spec = this.specs.find(item => item.field === key); const text = this.values[key] ?? spec.format(this.scope.value[key]); return { text, invalid: spec.parse(text) === undefined, overridden: false }; }
  actions() { return { edit: (key, text) => { this.values[key] = text; }, resetField() {}, discard() {} }; }
  async save() { this.saved++; }
  dispose() { this.disposed = true; }
}
const primitives = { SettingsFormModel: NativeForm, SettingsForm: 'NativeSettingsForm', SettingsValueField: 'NativeValueField', Switch: 'NativeSwitch', Button: 'NativeButton' };
let client;
vm.runInNewContext(source, { window: { __ModuleLoader__: { load(bundle) { assert.equal(bundle.id, 'dsh-brain'); client = bundle.factory(name => name === 'react' ? { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) } : primitives); } } } });
const json = Config.toJSON();
const fields = client.fieldsFromSchema(json);
const find = key => fields.find(field => field.key === key);

test('native client derives Chinese grouped fields from Host schema and excludes structural paths', () => {
  assert.equal(fields.length, Object.keys(DEFAULTS).length);
  assert.ok(!find('dataDir'));
  assert.equal(find('autoLearn').label, '自动学习');
  assert.ok(find('autoLearn').hint.includes('普通聊天'));
  assert.deepEqual(Array.from(find('personalityMode').choices), ['adaptive', 'manual', 'off']);
  for (const field of fields) assert.ok(field.label && field.group && field.hint, field.key);
});

test('schema-derived numeric validation rejects range, fractional integer, and malformed values', () => {
  const count = client.settingsSpec(find('maxContextMemories'));
  for (const value of ['-1', '101', '2.5', 'NaN', 'Infinity']) assert.equal(count.parse(value), undefined, value);
  assert.equal(count.parse('11').value, 11);
  assert.equal(count.parse('').kind, 'clear');
  const trait = client.settingsSpec(find('manualWarmth'));
  assert.equal(trait.parse('0.65').value, 0.65);
  assert.equal(trait.parse('0.67'), undefined);
});

test('native form refuses invalid paired route and read-only saves; accepted pair can save', async () => {
  const controller = new client.BrainConfigController({ value: DEFAULTS }, fields);
  const face = controller.inject();
  face.edit('extractionProvider', 'synthetic');
  assert.equal(controller.projection().routeError, true);
  await face.save(); assert.equal(controller.form.saved, 0);
  face.edit('extractionModel', 'test-model');
  assert.equal(controller.projection().routeError, false);
  await face.save(); assert.equal(controller.form.saved, 1);
  const readOnly = new client.BrainConfigController({ value: DEFAULTS, writable: false }, fields);
  await readOnly.inject().save(); assert.equal(readOnly.form.saved, 0);
});

test('installed package and row detail slots use Host brain namespace without duplicate built-in item', () => {
  const registered = [], effects = [], disposed = [];
  const ctx = {
    effect(effect) { effects.push(effect()); },
    configForms: {
      whileServed(namespaces, register) { assert.deepEqual(Array.from(namespaces), ['brain']); const dispose = register(); return () => { dispose(); disposed.push('watch'); }; },
      describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'brain', schema: json }] } }) }),
      get(id) { assert.equal(id, 'brain'); return { value: DEFAULTS }; },
    },
    slots: { inject(name, register) { return register(); }, register(options, component) { registered.push({ options, component }); return () => disposed.push(options.name); } },
  };
  client.apply(ctx);
  assert.deepEqual(registered.map(item => [item.options.name, item.options.key]), [['plugins.bundle.config', 'dsh-brain'], ['plugins.row.config', 'dsh-brain#brain']]);
  assert.equal(registered[0].component, client.BrainConfigCard);
  assert.doesNotMatch(source, /https?:|window\.open|remote\.|fetch\(|setPersonality/);
  effects.forEach(dispose => dispose()); assert.equal(disposed.length, 3);
});

test('native page renders Chinese mode options and disables manual fields in adaptive mode', () => {
  const controller = new client.BrainConfigController({ value: DEFAULTS }, fields);
  const face = controller.inject();
  const tree = client.BrainConfigCard({ ...face, view: 'page', useBrainConfig: selector => selector(controller.projection()) });
  const nodes = [];
  function walk(node) { if (node && typeof node === 'object') { nodes.push(node); for (const child of node.children ?? []) walk(child); } }
  walk(tree);
  assert.ok(nodes.some(node => node.type === 'NativeSettingsForm'));
  assert.deepEqual(nodes.filter(node => node.type === 'option').map(node => node.children[0]), ['自动演进', '手动指定', '关闭']);
  assert.equal(nodes.find(node => node.props.id === 'dsh-brain-config-manualWarmth').props.disabled, true);
  assert.equal(nodes.find(node => node.props.id === 'dsh-brain-config-maxContextMemories').props.disabled, false);
});
