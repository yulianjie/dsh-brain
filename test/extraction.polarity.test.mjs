import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../lib/core.js';
import { extractExplicitPreferences, isStylePreference, memoryScope, validateExtraction } from '../lib/extraction.js';

async function root(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dsh-brain-polarity-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

const table = [
  ['以后回答简短一点。', 'verbosity', 'low'],
  ['回复不用那么详细。', 'verbosity', 'low'],
  ['回答别太简短。', 'verbosity', 'high'],
  ['请不要开玩笑。', 'humor', 'low'],
  ['请少开玩笑。', 'humor', 'low'],
  ['回答可以不那么幽默。', 'humor', 'low'],
  ['别那么正式。', 'formality', 'low'],
  ['语气别那么温柔。', 'warmth', 'low'],
  ['语气不要太直接。', 'warmth', 'high'],
  ['以后不要主动提醒我。', 'proactivity', 'low'],
  ['在所有项目里回答都简短一点。', 'verbosity', 'low'],
  ['如果可以的话，以后回答简短一点。', 'verbosity', 'low'],
  ['Please be more concise.', 'verbosity', 'low'],
  ['Avoid unsolicited suggestions.', 'proactivity', 'low'],
  ["Please don't be so brief.", 'verbosity', 'high'],
  ["Please don't be so formal.", 'formality', 'low'],
  ['No need to be formal.', 'formality', 'low'],
  ["Don't use jokes in replies.", 'humor', 'low'],
  ["Please don't suggest next steps.", 'proactivity', 'low'],
  ['Stop being so formal.', 'formality', 'low'],
];

test('local rules and end-to-end learning agree on negation, hedging and excess', async t => {
  const dataDir = await root(t);
  for (const [index, [text, trait, direction]] of table.entries()) {
    const local = extractExplicitPreferences(text).feedback.find(item => item.trait === trait);
    assert.ok(local, `local rule missed ${trait} in ${text}`);
    assert.equal(local.value < 0.5, direction === 'low', text);
    assert.equal(local.value > 0.5, direction === 'high', text);

    const brain = await new Brain({ dataDir: path.join(dataDir, String(index)) }).init();
    await brain.learn({
      sessionId: 'polarity-table',
      turnId: `row-${index}`,
      userText: text,
      extraction: { memories: [], feedback: [{ trait, value: direction === 'low' ? 0.2 : 0.8, confidence: 0.9, evidence: text }] },
    });
    const evidence = (await brain.exportData()).personality.evidence[trait].at(-1);
    assert.ok(evidence, `${text} did not record ${trait} evidence`);
    assert.equal(evidence.value < 0.5, direction === 'low', text);
    assert.equal(evidence.value > 0.5, direction === 'high', text);
  }
});

test('opposite local and model directions drop that dimension instead of merging it back', async t => {
  const userText = '请不要开玩笑。';
  const extraction = { memories: [], feedback: [{ trait: 'humor', value: 0.9, confidence: 0.9, evidence: userText }] };
  const result = validateExtraction({ userText, extraction });
  assert.equal(result.feedback.length, 0);
  assert.equal(result.rejected, 1);
  assert.deepEqual(result.conflicts, ['humor']);

  const dataDir = await root(t);
  const brain = await new Brain({ dataDir }).init();
  await brain.learn({ sessionId: 'polarity-conflict', turnId: '1', userText, extraction });
  const state = await brain.exportData();
  assert.equal(state.personality.evidence.humor.length, 0);
  assert.equal(state.personality.traits.humor, 0.5);
});

test('negation scope stops at clause boundaries', () => {
  for (const text of ['不要用英文回答，简短一点。', "Don't ramble, keep replies concise."]) {
    const local = extractExplicitPreferences(text).feedback.find(item => item.trait === 'verbosity');
    assert.ok(local, text);
    assert.ok(local.value < 0.5, text);
  }
});

test('opposite directions inside one sentence emit no feedback for that dimension', () => {
  assert.equal(extractExplicitPreferences('不要太简短，也不要太详细。').feedback.some(item => item.trait === 'verbosity'), false);
});

test('hypothetical sentences stay rejected for local rules and model feedback', () => {
  for (const text of ['如果我说请以后回答简洁一点，你会怎样？', '假如以后回答简短一点会怎样？']) {
    assert.equal(extractExplicitPreferences(text).feedback.length, 0, text);
    const result = validateExtraction({ userText: text, extraction: { feedback: [{ trait: 'verbosity', value: 0.1, confidence: 0.9, evidence: text }] } });
    assert.equal(result.feedback.length, 0, text);
  }
});

test('quantified projects are global; explicit project cues remain workspace-scoped', () => {
  assert.equal(memoryScope('在所有项目里都用中文回答'), 'global');
  assert.equal(memoryScope('在这个项目里用 pnpm'), 'workspace');
  assert.equal(memoryScope('在 dsh-brain 项目里用 pnpm'), 'workspace');
});

test('the request gate accepts hedged, negative and English style requests', () => {
  for (const text of ['回答可以不那么幽默。', 'Avoid unsolicited suggestions.', "Please don't suggest next steps.", 'Stop being so formal.']) {
    assert.equal(isStylePreference(text), true, text);
  }
  assert.equal(isStylePreference('我是中国人，三十岁。'), false);
});

const feedbackOf = text => validateExtraction({ extraction: extractExplicitPreferences(text), userText: text }).feedback;
const directionOf = (text, trait) => {
  const item = feedbackOf(text).find(entry => entry.trait === trait);
  return item && item.value < 0.5 ? 'low' : item && item.value > 0.5 ? 'high' : undefined;
};
const valueOf = (text, trait) => feedbackOf(text).find(entry => entry.trait === trait)?.value;

test('length complaints read as too long, never as a request for more detail', () => {
  const rows = [
    ['回答太长了。', 'low'],
    ['你的回答太长了。', 'low'],
    ['回答太啰嗦了。', 'low'],
    ['你的回答很啰嗦，以后注意。', 'low'],
    ['回答别太长。', 'low'],
    ['回答不要太啰嗦。', 'low'],
    ['Your answers are too long.', 'low'],
  ];
  for (const [text, direction] of rows) assert.equal(directionOf(text, 'verbosity'), direction, text);
});

test('不够 asks for more of the following style word instead of negating it', () => {
  const rows = [
    ['回答不够详细。', 'high'],
    ['回答不够简洁。', 'low'],
    ['你的回答一直不够详细，以后注意。', 'high'],
  ];
  for (const [text, direction] of rows) {
    assert.equal(isStylePreference(text), true, text);
    assert.equal(directionOf(text, 'verbosity'), direction, text);
  }
});

test('universal quantifiers directly on 项目 stay global; named projects stay workspace', () => {
  for (const text of ['在所有项目里都用中文回答', '在所有的项目里都用中文回答', '在每一个项目里都用中文回答']) assert.equal(memoryScope(text), 'global', text);
  for (const text of ['在这个项目里用 pnpm', '在 dsh-brain 项目里用 pnpm']) assert.equal(memoryScope(text), 'workspace', text);
});

test('model workspace facts stay fact/workspace even when the sentence mentions style', () => {
  const rows = [
    'API 的回答格式要统一一点。',
    '错误回复的格式要简单一点。',
    'Never suggest npm commands; we use pnpm.',
    '部署时少用 sudo，回答时提醒一点。',
    '日志的解释要详细一点，我们靠它排查。',
  ];
  for (const text of rows) {
    const result = validateExtraction({ userText: text, extraction: { memories: [{ text, kind: 'fact', scope: 'workspace', confidence: 0.9, evidence: text }] } });
    assert.equal(result.rejected, 0, text);
    assert.equal(result.memories.length, 1, text);
    assert.equal(result.memories[0].kind, 'fact', text);
    assert.equal(result.memories[0].scope, 'workspace', text);
  }
});

test('ordinary coding requests and artifact reviews are not style preferences', () => {
  const rows = [
    'Please suggest a fix for this bug.',
    'Please suggest some names for this variable.',
    'Can you suggest a better approach?',
    '请直接回答。',
    '请用专业术语解释。',
    '请展开解释一下这个函数。',
    '这个函数太长了。',
    '日志太长了，帮我总结一下。',
    'The function is too long.',
    'Keep the function short.',
    'Please explain this error in detail.',
    '这个方案太详细了。',
    '这个 README 太正式了。',
  ];
  for (const text of rows) {
    assert.equal(isStylePreference(text), false, text);
    assert.deepEqual(feedbackOf(text), [], text);
  }
});

test('requests about the reply manner keep their previous polarity', () => {
  const rows = [
    ['请少开玩笑。', 'humor', 'low'],
    ['别那么正式。', 'formality', 'low'],
    ['Please be more concise.', 'verbosity', 'low'],
    ["Don't use jokes in replies.", 'humor', 'low'],
    ['Stop being so formal.', 'formality', 'low'],
    ['请不要主动建议。', 'proactivity', 'low'],
    ['Please suggest next steps.', 'proactivity', 'high'],
    ['Too verbose.', 'verbosity', 'low'],
    ['Avoid unsolicited suggestions.', 'proactivity', 'low'],
  ];
  for (const [text, trait, direction] of rows) assert.equal(directionOf(text, trait), direction, text);
});

test('meaning-changing verbs block negation instead of reversing it', () => {
  for (const text of ["Don't forget to add jokes.", "Don't forget to suggest next steps.", "Don't stop being proactive."]) {
    const trait = text.includes('jokes') ? 'humor' : 'proactivity';
    const value = valueOf(text, trait);
    assert.ok(value === undefined || value > 0.5, text);
  }
  for (const text of ["I don't want jokes.", 'Please stop making jokes.']) {
    const value = valueOf(text, 'humor');
    assert.ok(value === undefined || value < 0.5, text);
  }
});

test('repeated 不要每次都那么 keeps the style word direction after negation', () => {
  assert.equal(directionOf('不要每次都那么简短。', 'verbosity'), 'high');
  assert.equal(directionOf('不要每次都那么详细。', 'verbosity'), 'low');
});

test('model feedback matching a length complaint or 不够 is learned end to end', async t => {
  const dataDir = await root(t);
  const rows = [
    { text: '回答太长了。', trait: 'verbosity', value: 0.2, direction: 'low' },
    { text: '回答不够详细。', trait: 'verbosity', value: 0.8, direction: 'high' },
  ];
  for (const [index, row] of rows.entries()) {
    const brain = await new Brain({ dataDir: path.join(dataDir, String(index)) }).init();
    await brain.learn({ sessionId: 'polarity-model', turnId: '1', userText: row.text, extraction: { memories: [], feedback: [{ trait: row.trait, value: row.value, confidence: 0.9, evidence: row.text }] } });
    const evidence = (await brain.exportData()).personality.evidence[row.trait].at(-1);
    assert.ok(evidence, row.text);
    assert.equal(evidence.value < 0.5, row.direction === 'low', row.text);
    assert.equal(evidence.value > 0.5, row.direction === 'high', row.text);
  }
});

test('reply-leading wording requests a style without a separate request marker', () => {
  const rows = [
    ['回答详细一点。', 'verbosity', 'high'],
    ['回答短一点。', 'verbosity', 'low'],
    ['语气正式一点。', 'formality', 'high'],
    ['回答可以幽默一点。', 'humor', 'high'],
  ];
  for (const [text, trait, direction] of rows) {
    assert.equal(directionOf(text, trait), direction, text);
  }
});

test('以后 with an ordinary verb is not a style request', () => {
  const rows = [
    '以后有问题直接找我。',
    '以后直接提交到 main 分支。',
    '今后请直接合并。',
    '以后我会主动更新依赖。',
    '以后找个专业的人来做。',
    '以后评估要客观。',
  ];
  for (const text of rows) {
    assert.equal(isStylePreference(text), false, text);
    assert.deepEqual(feedbackOf(text), [], text);
  }
});

test('universal quantifiers only scope globally when they directly modify 项目', () => {
  for (const text of ['请记住：在 dsh-brain 项目里，所有命令都用 pnpm。', '记住：在 web 项目里任何提交都要跑 lint。']) {
    assert.equal(memoryScope(text), 'workspace', text);
    const memories = extractExplicitPreferences(text).memories;
    assert.ok(memories.length > 0, text);
    for (const memory of memories) assert.equal(memory.scope, 'workspace', text);
  }
  assert.deepEqual(feedbackOf('在 dsh-brain 项目里回答简短一点，所有输出都用中文。'), []);
  for (const text of ['在所有项目里都用中文回答', '在所有的项目里都用中文回答', '在每一个项目里都用中文回答']) assert.equal(memoryScope(text), 'global', text);
});

test('a durable marker turns adverb plus reply verb into a lasting style', () => {
  const rows = [
    ['以后简短回答。', 'verbosity', 'low'],
    ['以后都简洁地回答我。', 'verbosity', 'low'],
    ['以后请正式地回复。', 'formality', 'high'],
    ['以后请详细解释。', 'verbosity', 'high'],
    ['以后详细说明原因。', 'verbosity', 'high'],
  ];
  for (const [text, trait, direction] of rows) {
    assert.equal(directionOf(text, trait), direction, text);
  }
  for (const text of ['请直接回答。', '请详细解释一下这个错误。']) assert.deepEqual(feedbackOf(text), [], text);
});

test('English less, fewer and modal openings are requests with reversed direction', () => {
  const rows = [
    ['Less formal, please.', 'formality', 'low'],
    ['Can you be less formal?', 'formality', 'low'],
    ['Not so formal, please.', 'formality', 'low'],
    ['Fewer jokes, please.', 'humor', 'low'],
    ['Less humour, please.', 'humor', 'low'],
  ];
  for (const [text, trait, direction] of rows) {
    assert.equal(directionOf(text, trait), direction, text);
  }
});

test('English negation permits helper words before the style word', () => {
  assert.equal(directionOf("Don't keep replies short.", 'verbosity'), 'high');
  assert.equal(directionOf("Please don't go into detail.", 'verbosity'), 'low');
});

test('正式环境 is an ordinary deployment instruction, not a style request', () => {
  assert.equal(isStylePreference('请部署到正式环境。'), false);
  assert.deepEqual(feedbackOf('请部署到正式环境。'), []);
});

test('model feedback matching reply-leading and less requests is learned end to end', async t => {
  const dataDir = await root(t);
  const rows = [
    { text: '回答详细一点。', trait: 'verbosity', value: 0.8, direction: 'high' },
    { text: 'Less formal, please.', trait: 'formality', value: 0.2, direction: 'low' },
  ];
  for (const [index, row] of rows.entries()) {
    const brain = await new Brain({ dataDir: path.join(dataDir, String(index)) }).init();
    await brain.learn({ sessionId: 'polarity-model-round3', turnId: '1', userText: row.text, extraction: { memories: [], feedback: [{ trait: row.trait, value: row.value, confidence: 0.9, evidence: row.text }] } });
    const evidence = (await brain.exportData()).personality.evidence[row.trait].at(-1);
    assert.ok(evidence, row.text);
    assert.equal(evidence.value < 0.5, row.direction === 'low', row.text);
    assert.equal(evidence.value > 0.5, row.direction === 'high', row.text);
  }
});

// Round 4 第 1 条: 都/每次 as "all of them", and modal/first-person openers that
// name a concrete object, are one-off content requests, not lasting style.
test('one-off requests with 都 or a concrete object are not learned as style', () => {
  const rows = [
    '两个问题都详细回答一下。',
    '这两种写法都详细解释一下。',
    '每个步骤都详细说明一下。',
    '三个选项都简短说明一下。',
    'Could you give me a detailed explanation of closures?',
    'Can you write a brief summary of this article?',
    'I want detailed logs for debugging.',
    'Make it less verbose.',
    'Can you make the email less formal?',
    'I prefer brief meeting notes.',
    // Siblings of the same categories.
    '这些都要详细说明。',
    '两个方案都详细说说。',
    '两个问题都回答详细一点。',
    '这些问题都回复简短一点。',
    '每个都说明简短一些。',
    'Please give me a brief summary.',
    'I would like detailed logs.',
    'Would you write a short intro?',
    'I prefer formal emails.',
    'Use less verbose logging.',
    'Make the logs less detailed.',
    'Fewer words in the summary.',
  ];
  for (const text of rows) {
    assert.equal(isStylePreference(text), false, text);
    assert.deepEqual(feedbackOf(text), [], text);
  }
});

test('a sentence-first manner request without an object is still learned', () => {
  const rows = [
    ['Can you be less formal?', 'formality', 'low'],
    ['Could you keep answers shorter?', 'verbosity', 'low'],
    ['I prefer short replies.', 'verbosity', 'low'],
    ['Can you be more concise?', 'verbosity', 'low'],
    ['I want shorter answers.', 'verbosity', 'low'],
  ];
  for (const [text, trait, direction] of rows) assert.equal(directionOf(text, trait), direction, text);
});

// Round 4 第 2 条: 以后 + another activity keeps its style word out of the profile.
test('以后 with another activity or object is not a reply style', () => {
  const rows = [
    '以后详细记录每次部署。',
    '以后周报写详细一点。',
    '以后使用说明写详细一点。',
    '以后详细测试再上线。',
    '以后再详细讨论。',
    '以后简短地写提交信息。',
    '以后开会简短一点。',
    // Siblings of the same categories.
    '以后文档写详细一点。',
    '以后代码注释写简短些。',
    '以后报告写简洁一点。',
    '以后每次部署都详细记录。',
    '以后回答里不要提开会。',
  ];
  for (const text of rows) {
    assert.equal(isStylePreference(text), false, text);
    assert.deepEqual(feedbackOf(text), [], text);
  }
  // The reply itself (or nothing else at all) still counts.
  const kept = [
    ['以后详细说明原因。', 'verbosity', 'high'],
    ['以后请详细解释。', 'verbosity', 'high'],
    ['以后简短回答。', 'verbosity', 'low'],
    ['以后你说话简短一点。', 'verbosity', 'low'],
    ['以后你回答详细一点。', 'verbosity', 'high'],
    ['以后简短一点。', 'verbosity', 'low'],
    ['以后别开玩笑。', 'humor', 'low'],
  ];
  for (const [text, trait, direction] of kept) assert.equal(directionOf(text, trait), direction, text);
});

// Round 4 第 3 条: 我的回答 is the user's own text, not the assistant's reply.
test('the user own reply is never a reply cue', () => {
  const rows = ['我的回答太长了，帮我精简一下。', '我的回复是不是太啰嗦了？', '我写的回复太啰嗦了。', '我自己的回答太啰嗦了。', '我刚才的回复太长了。'];
  for (const text of rows) {
    assert.equal(isStylePreference(text), false, text);
    assert.deepEqual(feedbackOf(text), [], text);
  }
  // 你的回答 is still the assistant's reply.
  assert.equal(directionOf('你的回答太长了。', 'verbosity'), 'low');
});

// Round 4 第 4 条: two narrow phrasings, nothing else.
test('请 plus an ambiguous style word accepts only a bare manner request', () => {
  const kept = [
    ['请正式一点。', 'formality', 'high'],
    ['请尽量专业一些。', 'formality', 'high'],
    ['请随意些。', 'formality', 'low'],
    ['Please be more neutral.', 'warmth', 'low'],
    ['Please be more formal.', 'formality', 'high'],
  ];
  for (const [text, trait, direction] of kept) assert.equal(directionOf(text, trait), direction, text);
  const rows = ['请正式发布', '请切换到正式分支', '请正式一点发布。', '请把文档写得正式一点。', '请部署到正式环境。'];
  for (const text of rows) assert.deepEqual(feedbackOf(text), [], text);
});

// Regression: a shared /g regex must never be re-entered from inside its own
// exec loop (a nested replace resets lastIndex and the loop never ends).
test('durable sentences with another activity finish in bounded time', () => {
  const rows = [
    '以后开会简短一点。',
    '以后周报写详细一点。',
    '以后再详细讨论。',
    '以后详细记录每次部署。',
    '以后简短地写提交信息。',
    '今后请直接合并。',
    '以后回答简短一点，'.repeat(250),
  ];
  for (const text of rows) {
    const started = performance.now();
    const feedback = validateExtraction({ extraction: extractExplicitPreferences(text), userText: text }).feedback;
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 200, `${text.slice(0, 20)} took ${Math.round(elapsed)}ms`);
    assert.ok(Array.isArray(feedback));
  }
});
