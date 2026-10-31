// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';
import { validateExtraction } from '../lib/extraction.js';

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-gate-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { brain: await new Brain({ dataDir }).init() };
}
const learn = (brain, turn, userText, extraction) =>
  brain.learn({ sessionId: 'gate-synthetic', turnId: String(turn), userText, ...(extraction ? { extraction } : {}) });
const memory = (evidence, extra = {}) => ({ text: evidence, evidence, kind: 'fact', scope: 'global', confidence: 0.9, ...extra });

test('one-off CI state is rejected even at high model confidence and never reaches the store', async t => {
  const { brain } = await fixture(t);
  const userText = 'github ci有问题';
  const result = await learn(brain, 1, userText, { memories: [memory(userText)] });
  assert.equal(result.rejected, 1);
  assert.deepEqual(await brain.list(), []);
});

test('the observed ephemeral samples are all rejected by the gate', () => {
  for (const evidence of [
    '结果:✅ Claude 头像消失。',
    'npm run verify：181 个测试全部通过',
    'https://github.com/yulianjie/dsh-brain/pull/3',
    'fix/windows-lock-eperm',
    'lib/core.js:218 的 fs.rename(tmp, brain.json)',
  ]) {
    const result = validateExtraction({ userText: evidence, extraction: { memories: [memory(evidence)] } });
    assert.equal(result.memories.length, 0, evidence);
    assert.equal(result.rejected, 1, evidence);
  }
});

test('completed-status suffixes and English word forms stay rejected', () => {
  for (const evidence of ['构建失败了。', '测试没通过了', 'build passes on Node 24', 'the build is failing', 'ci passes now']) {
    const result = validateExtraction({ userText: evidence, extraction: { memories: [memory(evidence)] } });
    assert.equal(result.memories.length, 0, evidence);
    assert.equal(result.rejected, 1, evidence);
  }
});

test('explicit intent and durable cues exempt the whole containing sentence', async t => {
  const { brain } = await fixture(t);
  await learn(brain, 1, '请记住：github ci有问题', { memories: [memory('请记住：github ci有问题')] });
  await learn(brain, 2, '以后ci有问题要先看Actions', { memories: [memory('以后ci有问题要先看Actions')] });
  const records = await brain.list();
  assert.equal(records.length, 2);
  assert.ok(records.some(r => r.text === '请记住：github ci有问题'), 'explicit 请记住 must win');
  assert.ok(records.some(r => r.text === '以后ci有问题要先看Actions'), 'a durable cue must win');
});

test('the five keep samples from real usage stay untouched by the gate', () => {
  const samples = [
    '我当前使用的是deepseek desktop',
    '请使用子agent评估',
    '修改需要在main分支完成，并且所有的修改请移动到main分支中，需要先同步远程main分支',
    '以后所有 GitHub 相关操作（查 Actions/CI 运行状态、Release、PR、Issue、仓库信息、调用 GitHub API 等）一律优先使用 gh 命令行工具（如 gh run list/view、gh release view/create、gh pr、gh api），不要改用网页抓取或 web_fetch 调 GitHub 接口。',
    '2026-10-31 调研结论：DSH 中对话被归档或删除时，dsh-brain 不应自动级联清除记忆（业界一致做法：ChatGPT/Claude/Gemini/Claude Code/Codex/mem0/Letta/LangGraph 均为「删除对话不删记忆、记忆独立管理」）。真正的缺口是文档透明化、/brain forget-session（按 source 溯源批量清理）、/brain clear（全清）。完整报告：docs/MEMORY-LIFECYCLE-REVIEW.zh-CN.md。',
  ];
  for (const text of samples) {
    const result = validateExtraction({ userText: text, extraction: { memories: [memory(text)] } });
    assert.equal(result.memories.length, 1, text);
    assert.equal(result.rejected, 0, text);
  }
});

test('style feedback in the same turn is not touched by the memory gate', () => {
  const userText = 'github ci有问题。以后回答请简短一点。';
  const result = validateExtraction({ userText, extraction: {
    memories: [memory('github ci有问题')],
    feedback: [{ trait: 'verbosity', value: 0.1, confidence: 0.9, evidence: '以后回答请简短一点。' }],
  } });
  assert.equal(result.memories.length, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.feedback.length, 1);
  assert.equal(result.feedback[0].trait, 'verbosity');
});

test('fallback products (请记住 sentences and style sentences) still learn end to end', async t => {
  const { brain } = await fixture(t);
  await learn(brain, 1, '请记住：我喜欢中文回答。');
  await learn(brain, 2, '以后回答请简短一点。');
  const records = await brain.list();
  assert.equal(records.length, 2);
  assert.ok(records.some(r => r.text === '请记住：我喜欢中文回答。'));
  assert.ok(records.some(r => r.key === 'style:verbosity'));
});
