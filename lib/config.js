// Copyright 2026 DSH Brain contributors
// SPDX-License-Identifier: Apache-2.0
import z from '@deepseek-ai/schemastery';

const field = (schema, label, help, group) => schema.description(label).extra('help', help).extra('group', group).volatile();
const number = (value, min, max) => z.number().step(1).min(min).max(max).default(value);
export const Config = z.object({
  dataDir: z.string().description('记忆存储目录（仅配置文件，修改后重新加载插件）'),
  autoLearn: field(z.boolean().default(true), '自动学习', '从根会话的普通聊天中提取长期记忆与明确风格反馈；关闭会取消等待和进行中的后台学习。', '学习与注入'),
  injectMemories: field(z.boolean().default(true), '注入长期记忆', '将相关全局与当前工作区记忆作为参考提供给模型；关闭不删除已有记忆。', '学习与注入'),
  injectPersonality: field(z.boolean().default(true), '注入交流风格', '将当前有效的交流风格提供给模型；不影响记忆检索和已保存的人格状态。', '学习与注入'),
  personalityMode: field(z.union(['adaptive', 'manual', 'off']).default('adaptive'), '交流风格模式', '自动演进使用已学习的风格；手动指定仅使用下方手动值；关闭模式不注入风格且停止风格学习。切换不覆盖已学习状态。', '交流风格'),
  personalityLearningEnabled: field(z.boolean().default(true), '学习交流风格反馈', '仅在自动演进模式生效；还受自动学习总开关和现有 /brain freeze 冻结状态控制。', '交流风格'),
  manualWarmth: field(z.number().min(0).max(1).step(0.05).default(0.5), '手动：亲切程度', '仅手动指定模式：0 客观中性，1 温暖亲切；不会覆盖已学习值。', '手动交流风格'),
  manualVerbosity: field(z.number().min(0).max(1).step(0.05).default(0.5), '手动：详细程度', '仅手动指定模式：0 简短精炼，1 详细展开。', '手动交流风格'),
  manualHumor: field(z.number().min(0).max(1).step(0.05).default(0.5), '手动：幽默程度', '仅手动指定模式：0 严肃直接，1 可适度幽默。', '手动交流风格'),
  manualProactivity: field(z.number().min(0).max(1).step(0.05).default(0.5), '手动：主动程度', '仅手动指定模式：0 紧扣请求，1 主动提出相关建议。', '手动交流风格'),
  manualFormality: field(z.number().min(0).max(1).step(0.05).default(0.5), '手动：正式程度', '仅手动指定模式：0 轻松口语，1 正式严谨。', '手动交流风格'),
  extractionProvider: field(z.string().default(''), '提取模型服务商', '留空跟随当前会话服务商；只填写已由宿主配置的服务商 ID，不填写密钥。', '提取模型'),
  extractionModel: field(z.string().default(''), '提取模型 ID', '留空跟随当前会话模型；指定其他模型时需确保所选服务商支持该 ID。', '提取模型'),
  extractionMaxTokens: field(number(1800, 128, 8192), '提取输出 Token 上限', '每轮最多一次提取请求的输出上限；同时保留响应字符安全上限。', '提取模型'),
  extractionTimeoutMs: field(number(15000, 10, 120000), '提取超时（毫秒）', '超时会取消模型请求并回退到明确偏好的本地识别，不阻塞主对话。', '后台限制'),
  extractionMaxChars: field(number(8000, 100, 50000), '单轮提取输入字符上限', '只截取本轮真实用户文本；不读取工具内容、其他会话或子 Agent 对话。', '后台限制'),
  extractionMaxQueue: field(number(16, 1, 128), '后台等待队列上限', '最多一个模型提取同时运行；超出队列上限的新任务跳过。', '后台限制'),
  maxMemories: field(number(500, 1, 100000), '保存记忆条数上限', '降低上限不会删除已有记录；达到上限时由现有容量策略限制新增记录。', '存储与上下文'),
  maxContextChars: field(number(6000, 0, 50000), '注入总字符上限', '包含记忆与风格参考；0 表示停止全部自动上下文注入。', '存储与上下文'),
  maxContextTokens: field(number(2000, 0, 16000), '注入估算 Token 上限', '与字符上限同时生效；使用中英文保守估算，不代表模型精确计费；0 停止注入。', '存储与上下文'),
  maxContextMemories: field(number(10, 0, 100), '单次注入记忆条数上限', '每次模型请求最多选取多少条相关记忆；0 不注入记忆记录。', '存储与上下文'),
  maxToolResultChars: field(number(6000, 512, 50000), '记忆工具输出字符上限', '搜索、列表及详情按页返回；完整本地导出不受此限制。', '存储与上下文'),
  maxToolResultTokens: field(number(2000, 128, 16000), '记忆工具估算 Token 上限', '与工具字符上限同时生效；超长正文通过详情游标继续读取。', '存储与上下文'),
  lockTimeoutMs: field(number(15000, 0, 120000), '存储锁等待超时（毫秒）', '多个进程并发写入时等待锁的时长；0 不等待，不删除其他写入者的锁。', '存储与上下文'),
});

export const DEFAULTS = Object.freeze({ autoLearn: true, injectMemories: true, injectPersonality: true, personalityMode: 'adaptive', personalityLearningEnabled: true,
  manualWarmth: 0.5, manualVerbosity: 0.5, manualHumor: 0.5, manualProactivity: 0.5, manualFormality: 0.5,
  extractionProvider: '', extractionModel: '', extractionMaxTokens: 1800, extractionTimeoutMs: 15000, extractionMaxChars: 8000, extractionMaxQueue: 16,
  maxMemories: 500, maxContextChars: 6000, maxContextTokens: 2000, maxContextMemories: 10, maxToolResultChars: 6000, maxToolResultTokens: 2000, lockTimeoutMs: 15000 });
const volatile = value => typeof value === 'object' && value !== null && Symbol.for('cosmokit.volatile.write') in value;
const unref = value => volatile(value) ? value.get() : value;
function routeError(value) {
  return Boolean(String(unref(value.extractionProvider) ?? '').trim()) !== Boolean(String(unref(value.extractionModel) ?? '').trim())
    ? '提取服务商与模型 ID 必须同时填写，或同时留空跟随当前会话。' : undefined;
}
// Preserve the plain object schema for native form projection while enforcing
// the cross-field route invariant at Cordis's authoritative validation seam.
const standard = Config['~standard'];
Object.defineProperty(Config, '~standard', { value: { ...standard, validate(value) {
  const result = standard.validate(value);
  if (result.issues) return result;
  const error = routeError(result.value);
  return error ? { issues: [{ message: error, path: ['extractionProvider'] }] } : result;
} } });
/** Works with ordinary values in pure tests and native stable Volatile refs. */
export function readConfig(options = {}) {
  const resolved = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, volatile(options[key]) ? options[key].get() : options[key] ?? DEFAULTS[key]]));
  const parsed = Config(resolved);
  const error = routeError(parsed); if (error) throw new Error(error);
  const plain = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, parsed[key].get()]));
  plain.extractionProvider = plain.extractionProvider.trim() || undefined;
  plain.extractionModel = plain.extractionModel.trim() || undefined;
  plain.manualTraits = Object.fromEntries(['warmth', 'verbosity', 'humor', 'proactivity', 'formality'].map(trait => [trait, plain[`manual${trait[0].toUpperCase()}${trait.slice(1)}`]]));
  return plain;
}
