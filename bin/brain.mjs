#!/usr/bin/env node
// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Brain } from '../lib/core.js';

const HELP = `DSH Brain 本地管理命令（结果为 JSON）
用法: dsh-brain [--data-dir 目录] <命令> [参数]

  status                           查看存储状态
  list [--scope global|workspace]  查看全局或指定工作区记忆
  search <关键词> [--limit 数量]    检索全局和指定工作区记忆
  remember <文本> [--scope 范围]    添加记忆，默认 global
  update <id> <文本>               修改已有记忆
  forget <id>                      遗忘记忆
  export <文件> [--force]           导出完整数据，默认不覆盖文件
  import <文件>                    校验并合并导出的数据
  personality                      查看交流风格
  personality set <维度> <0..1>     人工设置单个维度
  freeze | unfreeze                冻结/解除冻结自动风格学习
  reset                            重置交流风格
  history                          查看风格历史
  rollback <version>               回退交流风格

选项: --workspace <绝对或相对路径>（workspace 范围必填）
      --kind <类别> --key <合并键>（remember 可用）
维度: warmth, verbosity, humor, proactivity, formality
未指定 --workspace 时，list/search 不显示工作区记忆。
默认存储: $DSH_HOME/brain（未设置时 ~/.dsh/brain）。
`;

function parse(argv) {
  const options = {};
  const positional = [];
  const values = new Set(['data-dir', 'workspace', 'scope', 'kind', 'key', 'limit']);
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && (arg === '--help' || arg === '-h')) { options.help = true; continue; }
    if (!literal && arg === '--force') { options.force = true; continue; }
    if (!literal && arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!values.has(name)) throw new Error(`未知选项: ${arg}`);
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要参数`);
      if (name in options) throw new Error(`${arg} 不能重复`);
      options[name] = value;
    } else positional.push(arg);
  }
  return { options, positional };
}

function requireArgs(args, min, max = min) {
  if (args.length < min || args.length > max) throw new Error('参数数量错误；使用 --help 查看用法');
}

async function main() {
  const { options, positional: [command, ...args] } = parse(process.argv.slice(2));
  if (options.help || !command || command === 'help') { process.stdout.write(HELP); return; }
  const allowedOptions = {
    status: [], list: ['scope', 'workspace'], search: ['workspace', 'limit'],
    remember: ['scope', 'workspace', 'kind', 'key'], update: ['workspace'], forget: ['workspace'],
    export: ['force'], import: [], personality: [], freeze: [], unfreeze: [], reset: [], history: [], rollback: [],
  };
  if (!(command in allowedOptions)) throw new Error(`未知命令: ${command}`);
  for (const option of Object.keys(options)) {
    if (option !== 'data-dir' && !allowedOptions[command].includes(option)) throw new Error(`${command} 不支持 --${option}`);
  }
  const workspace = options.workspace ? resolve(options.workspace) : undefined;
  const scope = options.scope ?? 'global';
  if (!['global', 'workspace'].includes(scope)) throw new Error('--scope 必须为 global 或 workspace');
  if (scope === 'workspace' && !workspace) throw new Error('workspace 范围必须指定 --workspace');
  const brain = new Brain(options['data-dir'] ? { dataDir: resolve(options['data-dir']) } : {});
  await brain.init();
  let result;
  switch (command) {
    case 'status': requireArgs(args, 0); result = await brain.stats(); break;
    case 'list': requireArgs(args, 0); result = await brain.list({ scope: options.scope, workspace }); break;
    case 'search': {
      requireArgs(args, 1, Infinity);
      const limit = options.limit === undefined ? undefined : Number(options.limit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) throw new Error('--limit 必须为 1..100 的整数');
      result = await brain.search({ query: args.join(' '), workspace, limit }); break;
    }
    case 'remember': requireArgs(args, 1, Infinity); result = await brain.remember({ text: args.join(' '), scope, workspace, kind: options.kind, key: options.key, source: 'cli' }); break;
    case 'update': {
      requireArgs(args, 2, Infinity);
      const existing = (await brain.list({ workspace })).find(record => record.id === args[0]);
      if (!existing) throw new Error('记忆不存在或不属于所选工作区');
      result = await brain.remember({ ...existing, text: args.slice(1).join(' '), source: 'cli' }); break;
    }
    case 'forget': requireArgs(args, 1); result = { forgotten: await brain.forget({ id: args[0], workspace }) }; break;
    case 'export': {
      requireArgs(args, 1);
      await writeFile(resolve(args[0]), `${JSON.stringify(await brain.exportData(), null, 2)}\n`, { encoding: 'utf8', flag: options.force ? 'w' : 'wx', mode: 0o600 });
      result = { exported: resolve(args[0]) }; break;
    }
    case 'import': requireArgs(args, 1); result = await brain.importData(JSON.parse(await readFile(resolve(args[0]), 'utf8'))); break;
    case 'personality':
      if (args.length === 0) result = await brain.personality();
      else {
        requireArgs(args, 3);
        if (args[0] !== 'set' || !['warmth', 'verbosity', 'humor', 'proactivity', 'formality'].includes(args[1])) throw new Error('用法: personality set <维度> <0..1>');
        const value = Number(args[2]);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('维度值必须在 0..1 之间');
        result = await brain.setPersonality({ traits: { [args[1]]: value } });
      }
      break;
    case 'freeze': case 'unfreeze': requireArgs(args, 0); result = await brain.setPersonality({ frozen: command === 'freeze' }); break;
    case 'reset': requireArgs(args, 0); result = await brain.resetPersonality(); break;
    case 'history': requireArgs(args, 0); result = await brain.personalityHistory(); break;
    case 'rollback': {
      requireArgs(args, 1);
      const version = Number(args[0]);
      if (!Number.isInteger(version) || version < 0) throw new Error('version 必须为非负整数');
      result = await brain.rollbackPersonality({ version }); break;
    }
  }
  process.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`);
}

main().catch(error => { process.stderr.write(`dsh-brain: ${error.message}\n`); process.exitCode = 1; });
