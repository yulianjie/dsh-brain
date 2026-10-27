// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
/* Native Desktop/Web client companion. The Host discovers this ./client bundle.
 * All settings reads and writes use the Host's configForms service. */
window.__ModuleLoader__.load({
  id: '@yulianjie/dsh-brain',
  factory(require) {
    const React = require('react');
    const { SettingsFormModel, SettingsForm, SettingsValueField, Switch, Button } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const NS = 'brain';
    const MODE_LABELS = { adaptive: '自动演进', manual: '手动指定', off: '关闭' };
    const labels = { unavailable: '正在读取配置；若长时间未出现，请确认插件已启用。', readOnly: '当前部署的配置为只读。', saveFailed: '保存未成功；修改已保留，请检查数值后重试。配置可能已被其他窗口修改。', save: '保存', saving: '保存中…' };

    function fieldsFromSchema(envelope) {
      const refs = envelope?.refs ?? {};
      const root = refs[envelope?.uid] ?? envelope;
      return Object.entries(root?.dict ?? {}).flatMap(([key, reference]) => {
        if (key === 'dataDir') return [];
        const node = typeof reference === 'number' ? refs[reference] : reference;
        if (!node || !['boolean', 'number', 'string', 'union'].includes(node.type)) return [];
        const choices = node.type === 'union' ? (node.list ?? []).map(item => typeof item === 'number' ? refs[item] : item).filter(item => item?.type === 'const').map(item => item.value) : [];
        return [{ key, type: node.type, label: node.meta?.description ?? key, hint: node.meta?.help ?? '', group: node.meta?.group ?? '其他设置', meta: node.meta ?? {}, choices }];
      });
    }

    function settingsSpec(field) {
      return {
        field: field.key,
        format: value => value === undefined ? '' : String(value),
        parse: text => {
          const value = text.trim();
          if (value === '') return { kind: 'clear' };
          if (field.type === 'boolean') return ['true', 'false'].includes(value) ? { kind: 'set', value: value === 'true' } : undefined;
          if (field.type === 'union') return field.choices.includes(value) ? { kind: 'set', value } : undefined;
          if (field.type === 'number') {
            const number = Number(value), { min = -Infinity, max = Infinity, step } = field.meta;
            if (!Number.isFinite(number) || number < min || number > max || (step && Math.abs(number / step - Math.round(number / step)) > 1e-7)) return undefined;
            return { kind: 'set', value: number };
          }
          return { kind: 'set', value };
        },
      };
    }

    class BrainConfigController {
      constructor(scope, fields) {
        this.fields = fields;
        this.form = new SettingsFormModel(scope, fields.map(settingsSpec));
        this.store = this.form.bind(() => this.projection());
      }
      projection() {
        const values = Object.fromEntries(this.fields.map(field => [field.key, this.form.field(field.key)]));
        const provider = values.extractionProvider?.text.trim() ?? '';
        const model = values.extractionModel?.text.trim() ?? '';
        const routeError = !!provider !== !!model;
        const shell = this.form.shell();
        return { ...shell, invalid: shell.invalid || routeError || !shell.writable, routeError, fields: this.fields, values };
      }
      inject() {
        const actions = this.form.actions();
        return { hooks: { brainConfig: this.store }, ...actions,
          save: () => { if (!this.projection().invalid) return this.form.save(); } };
      }
      dispose() { this.form.dispose(); }
    }

    function BrainConfigCard(props) {
      const state = props.useBrainConfig(snapshot => snapshot);
      if (props.view === 'summary') return '管理长期记忆、自动学习、上下文预算与交流风格；配置保存在当前 profile。';
      const mode = state.values.personalityMode?.text ?? 'adaptive';
      const groups = new Map();
      for (const field of state.fields) {
        if (!groups.has(field.group)) groups.set(field.group, []);
        groups.get(field.group).push(field);
      }
      const fieldView = field => {
        const value = state.values[field.key];
        const disabled = !state.writable || state.saving || (field.key.startsWith('manual') && mode !== 'manual') || (field.key === 'personalityLearningEnabled' && mode !== 'adaptive');
        const id = `dsh-brain-config-${field.key}`;
        const reset = value.overridden ? h(Button, { size: 'small', disabled, onClick: () => props.resetField(field.key) }, '恢复默认') : null;
        if (field.type === 'boolean' || field.type === 'union') return h('div', { key: field.key, style: { display: 'grid', gap: 6 } },
          h('div', { style: { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' } },
            h('label', { htmlFor: id, style: { fontWeight: 500 } }, field.label),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, reset,
              field.type === 'boolean' ? h(Switch, { checked: value.text === 'true', label: field.label, disabled, onChange: checked => props.edit(field.key, String(checked)) })
                : h('select', { id, value: value.text, disabled, 'aria-describedby': `${id}-hint`, onChange: event => props.edit(field.key, event.target.value), style: { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid var(--border-color, #8886)', borderRadius: 6, padding: '6px 10px' } }, ...field.choices.map(choice => h('option', { key: choice, value: choice }, MODE_LABELS[choice] ?? choice))))),
          h('p', { id: `${id}-hint`, style: { margin: 0, fontSize: 12, opacity: 0.65, lineHeight: 1.65 } }, field.hint));
        const invalidLabel = field.type === 'number' ? `请输入 ${field.meta.min} 至 ${field.meta.max} 的有效数值${field.meta.step === 1 ? '（整数）' : ''}，或留空恢复默认。` : '请输入有效值。';
        return h(SettingsValueField, { key: field.key, id, label: field.label, hint: field.hint, numeric: field.type === 'number', disabled,
          ...value, invalidLabel, overriddenLabel: '已覆盖', resetLabel: '恢复默认',
          onEdit: text => props.edit(field.key, text), onReset: () => props.resetField(field.key) });
      };
      return h('div', { 'data-dsh-brain-config': true, style: { maxWidth: 720 } },
        h(SettingsForm, { state, labels, onSave: props.save, onDiscard: props.discard },
          ...[...groups].map(([group, fields]) => h('section', { key: group, 'aria-label': group, style: { display: 'grid', gap: 18, marginBottom: 26 } },
            h('h4', { style: { margin: '0 0 2px', fontSize: 14, fontWeight: 600 } }, group),
            ...fields.map(fieldView), group === '提取模型' && state.routeError ? h('p', { role: 'alert', style: { margin: 0, color: 'var(--color-error, #d64b4b)', fontSize: 12 } }, '服务商与模型 ID 必须同时填写，或同时留空跟随当前会话。') : null)),
          h('p', { style: { fontSize: 12, opacity: 0.65, lineHeight: 1.65 } }, '保存后对后续请求生效。切换交流风格模式与手动值不会覆盖已学习的性格。存储目录仅通过高级配置文件修改。')));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.configForms.whileServed([NS], () => {
        const namespace = ctx.configForms.describe().getSnapshot().view?.namespaces.find(item => item.ns === NS);
        const fields = fieldsFromSchema(namespace?.schema);
        const controller = new BrainConfigController(ctx.configForms.get(NS), fields);
        const register = (name, key) => ctx.slots.inject(name, () => ctx.slots.register({ name, key, inject: () => controller.inject() }, BrainConfigCard));
        const disposers = [register('plugins.bundle.config', '@yulianjie/dsh-brain'), register('plugins.row.config', '@yulianjie/dsh-brain#brain')];
        return () => { for (const dispose of disposers) dispose(); controller.dispose(); };
      }), 'dsh-brain: native configuration form');
    }

    return { inject: ['slots', 'configForms'], apply, fieldsFromSchema, settingsSpec, BrainConfigController, BrainConfigCard };
  },
});
