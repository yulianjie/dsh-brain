import test from 'node:test';
import assert from 'node:assert/strict';
import { containsCredential, validateExtraction, extractExplicitPreferences } from '../lib/extraction.js';

test('credential recognition covers keys, authorization, private keys, passwords and URL credentials', () => {
  for (const text of ['sk-synthetic1234567890123456', 'ghp_synthetic1234567890123456', 'Bearer abcdefghijklmnopqrst', 'password=syntheticsecret', '密码：syntheticsecret', 'https://name:secret@example.invalid', '-----BEGIN RSA PRIVATE KEY-----']) assert.equal(containsCredential(text), true, text);
  assert.equal(containsCredential('使用环境变量配置 API key，不要记录密码。'), false);
});

test('offline preferences support Chinese, English and negative requests', () => {
  assert.equal(extractExplicitPreferences('以后回答请简短一点。').feedback[0].value, 0.1);
  assert.equal(extractExplicitPreferences('Please keep replies concise.').feedback[0].trait, 'verbosity');
  assert.equal(extractExplicitPreferences('请不要开玩笑。').feedback.find(f => f.trait === 'humor').value, 0.1);
  assert.equal(extractExplicitPreferences('语气不要太正式。').feedback.find(f => f.trait === 'formality').value, 0.15);
  assert.equal(extractExplicitPreferences('请不要主动建议。').feedback.find(f => f.trait === 'proactivity').value, 0.1);
});

test('transient requests, quoted examples, assistant claims and demographics do not create style evidence', () => {
  for (const text of ['这次请简短回答。', 'Please keep this answer brief this time.', '他说：“以后回答请简短一点。”', '"Please keep replies concise."', '我是中国人，三十岁。', '助手说希望用户的回复简短。']) assert.equal(extractExplicitPreferences(text).feedback.length, 0, text);
});

test('model extraction requires literal current user evidence and stores original statement', () => {
  const userText = '本项目用 Rust。';
  const valid = validateExtraction({ userText, extraction: { memories: [{ text: 'Invented unsupported summary', kind: 'fact', scope: 'global', confidence: 0.9, evidence: userText }], feedback: [{ trait: 'verbosity', value: 0, confidence: 0.9, evidence: 'not in user turn' }] } });
  assert.equal(valid.memories[0].text, userText);
  assert.equal(valid.memories[0].scope, 'workspace');
  assert.equal(valid.feedback.length, 0);
  assert.equal(valid.rejected, 1);
});

test('semantic model feedback can recognize ordinary feedback beyond deterministic phrases', () => {
  const userText = '你这种轻松口吻挺好，保持。';
  const result = validateExtraction({ userText, extraction: { feedback: [{ trait: 'formality', value: 0.2, confidence: 0.95, evidence: userText }] } });
  assert.equal(result.feedback.length, 1);
  const demographic = '我是中国人。';
  assert.equal(validateExtraction({ userText: demographic, extraction: { feedback: [{ trait: 'formality', value: 0.9, confidence: 0.99, evidence: demographic }] } }).feedback.length, 0);
});

test('malformed/conflicting extraction values and credential evidence are rejected', () => {
  const userText = '请不要开玩笑。';
  const result = validateExtraction({ userText, extraction: { feedback: [{ trait: 'humor', value: 0.9, confidence: 1, evidence: userText }, { trait: 'unknown', value: 0.3, confidence: 1, evidence: userText }, { trait: 'warmth', value: NaN, confidence: 1, evidence: userText }], memories: [{ text: 'bad', scope: 'global', confidence: 0.3, evidence: userText }] } });
  assert.equal(result.feedback.length, 0); assert.equal(result.memories.length, 0); assert.equal(result.rejected, 4);
});
