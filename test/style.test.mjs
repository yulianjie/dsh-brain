// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_HEADER, STYLE_BRIEF_MAX, styleBrief, traitBand } from '../lib/style.js';
import { TRAITS } from '../lib/extraction.js';

const NEUTRAL = '保持中性默认：信息完整、语气平和、不主动扩展。';
const SENTENCES = {
  warmth: { low: '语气克制：直述事实与结论，不寒暄。', high: '语气偏暖：先接住对方处境，再给建议。' },
  verbosity: { low: '回答偏简短：先给结论，最多补一两句理由。', high: '回答偏详细：给步骤、取舍与必要示例。' },
  humor: { low: '不使用玩笑或调侃。', high: '可以适度幽默，但技术判断保持严肃。' },
  proactivity: { low: '只回答被问到的内容，不主动扩展。', high: '结尾主动给一条相关的下一步建议。' },
  formality: { low: '用口语化表达，允许短句。', high: '用正式、完整的书面表达。' },
};
const ranks = { low: 0, mid: 1, high: 2 };
const random = seed => {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
};

test('all-mid traits render exactly the neutral sentence', () => {
  assert.equal(styleBrief({}), NEUTRAL);
  assert.equal(styleBrief(Object.fromEntries(TRAITS.map(trait => [trait, 0.5]))), NEUTRAL);
  assert.ok(!styleBrief({}).includes(BRIEF_HEADER));
});

test('each dimension low/high emits its exact sentence table entry', () => {
  for (const trait of TRAITS) {
    assert.equal(styleBrief({ [trait]: 0 }), SENTENCES[trait].low, trait);
    assert.equal(styleBrief({ [trait]: 1 }), SENTENCES[trait].high, trait);
  }
  assert.equal(styleBrief(Object.fromEntries(TRAITS.map(trait => [trait, 0]))), TRAITS.map(trait => SENTENCES[trait].low).join(''));
  assert.equal(styleBrief(Object.fromEntries(TRAITS.map(trait => [trait, 1]))), TRAITS.map(trait => SENTENCES[trait].high).join(''));
});

test('band boundaries 0.35 and 0.65 remain mid while just outside moves', () => {
  assert.equal(traitBand(0.35), 'mid');
  assert.equal(traitBand(0.65), 'mid');
  assert.equal(traitBand(0.3499), 'low');
  assert.equal(traitBand(0.6501), 'high');
  assert.equal(styleBrief({ warmth: 0.35 }), NEUTRAL);
  assert.equal(styleBrief({ warmth: 0.65 }), NEUTRAL);
  assert.equal(styleBrief({ warmth: -5 }), SENTENCES.warmth.low);
  assert.equal(styleBrief({ warmth: 5 }), SENTENCES.warmth.high);
});

test('malformed or unknown inputs normalize to neutral without throwing', () => {
  for (const input of [null, undefined, [], 'warm', 42, true, new Date(0), { unknown: 0.9 }, { warmth: NaN }, { warmth: Infinity }, { warmth: -Infinity }, { warmth: '0.9' }, { warmth: null }, { warmth: {} }, Object.create(null)]) {
    assert.doesNotThrow(() => styleBrief(input));
    assert.equal(styleBrief(input), NEUTRAL);
  }
});

test('raising one trait never lowers its band', () => {
  for (const trait of TRAITS) {
    let previous = ranks[traitBand(0)];
    for (let step = 1; step <= 100; step++) {
      const current = ranks[traitBand(step / 100)];
      assert.ok(current >= previous, `${trait} lost band at ${step / 100}`);
      previous = current;
    }
  }
});

test('identical random inputs produce identical briefs', () => {
  const next = random(20261028);
  for (let i = 0; i < 100; i++) {
    const traits = Object.fromEntries(TRAITS.map(trait => [trait, next()]));
    assert.equal(styleBrief(traits), styleBrief({ ...traits }));
  }
});

test('brief stays within the code-point limit for every extreme combination', () => {
  assert.equal(STYLE_BRIEF_MAX, 600);
  for (let mask = 0; mask < 32; mask++) {
    const traits = Object.fromEntries(TRAITS.map((trait, index) => [trait, mask & (1 << index) ? 1 : 0]));
    assert.ok(Array.from(styleBrief(traits)).length <= STYLE_BRIEF_MAX);
  }
});

test('brief never leaks raw values, JSON syntax or trait vocabulary', () => {
  const next = random(7);
  const samples = [styleBrief({}), styleBrief(Object.fromEntries(TRAITS.map(trait => [trait, 0.62])))];
  for (let i = 0; i < 100; i++) samples.push(styleBrief(Object.fromEntries(TRAITS.map(trait => [trait, next()]))));
  for (const brief of samples) {
    assert.doesNotMatch(brief, /\d\.\d/);
    assert.ok(!brief.includes('"traits"'));
    assert.ok(!brief.includes('{'));
    assert.ok(!brief.includes('}'));
    assert.ok(!/\b(?:traits|warmth|verbosity|humor|proactivity|formality)\b/i.test(brief));
  }
});
