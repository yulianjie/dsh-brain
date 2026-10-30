// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
/** Deterministic natural-language rendering of soft communication traits. */
import { TRAITS } from './extraction.js';

export const STYLE_BRIEF_MAX = 600;
export const BRIEF_HEADER = '沟通风格（软性偏好；当前用户指令优先）：';

const NEUTRAL = '保持中性默认：信息完整、语气平和、不主动扩展。';
const SENTENCES = {
  warmth: { low: '语气克制：直述事实与结论，不寒暄。', high: '语气偏暖：先接住对方处境，再给建议。' },
  verbosity: { low: '回答偏简短：先给结论，最多补一两句理由。', high: '回答偏详细：给步骤、取舍与必要示例。' },
  humor: { low: '不使用玩笑或调侃。', high: '可以适度幽默，但技术判断保持严肃。' },
  proactivity: { low: '只回答被问到的内容，不主动扩展。', high: '结尾主动给一条相关的下一步建议。' },
  formality: { low: '用口语化表达，允许短句。', high: '用正式、完整的书面表达。' },
};

const clamp = value => Math.max(0, Math.min(1, value));
const traitValue = value => Number.isFinite(value) ? clamp(value) : 0.5;

export function traitBand(value) {
  const normalized = traitValue(value);
  return normalized < 0.35 ? 'low' : normalized > 0.65 ? 'high' : 'mid';
}

/** Body only; callers prepend BRIEF_HEADER. Never emits raw trait values. */
export function styleBrief(traits = {}) {
  const source = traits && typeof traits === 'object' && !Array.isArray(traits) ? traits : {};
  const sentences = [];
  for (const trait of TRAITS) {
    const band = traitBand(source[trait]);
    if (band !== 'mid') sentences.push(SENTENCES[trait][band]);
  }
  const text = sentences.length ? sentences.join('') : NEUTRAL;
  return Array.from(text).slice(0, STYLE_BRIEF_MAX).join('');
}
