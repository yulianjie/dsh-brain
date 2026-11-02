# Changelog

## 0.6.0

- Reject model summaries that reverse supported operation order, comparison
  direction or entity-to-value assignments. Reject one-off state and contradictory
  style feedback rather than persisting it as a lasting preference.
- Preserve unrelated records when a model proposes the wrong `updateOf`/id or
  colliding key. Busy model-facing reads fail closed instead of serving an old
  cached memory after another instance has forgotten it.

- Replace the persistent JSON file with SQL tables and transactions in
  `<dataDir>/brain.sqlite`, using Node's built-in `node:sqlite` (Node.js >=22.13).
  No npm SQLite/native dependency was added. On first startup, an existing
  `brain.json` is imported transactionally and the original JSON is preserved
  byte-for-byte as a backup. Historical memory text is not re-sent to an LLM for
  rewriting. JSON import/export remains `schemaVersion: 1`, with the default
  500-memory limit retained.
- Automatic memory bodies now use model-organized summaries. Original user text
  is stored as separate evidence for validation and traceability and is not
  injected into model context. If the extraction model is unavailable, automatic
  learning no longer saves the raw turn as a memory; limited numeric style
  feedback can still use the local fallback. Explicit `/brain remember` and CLI
  `remember` continue to save directly supplied text.
- Correct style extraction for negated and temporary feedback; prevent incorrect
  global-scope labeling and duplicate writes; allow `updateOf` to apply shorter
  corrections; separate semantic keys for language preferences; remove unrelated
  history-only references on a strong topic switch while allowing a weak continuation
  to bridge through shared recent history; and preserve prompt-prefix cache behavior.
- Scope source-evidence replay tombstones by stable property key, so deleting one
  claim backed by a sentence does not suppress a sibling claim using the same
  evidence during backup import. Without a stable key, forget relies on record/text
  identity and does not promise to recognize every paraphrased replay.
- Restrict memory writes and forget operations to the root agent. Child agents
  retain read-only `brain_search`, `brain_list`, `brain_read` and `brain_personality`
  tools; they do not receive an injected Brain reference.
- Include the cross-conversation isolation fix already present at the source
  baseline: subagents do not receive unrelated Brain references.
- Keep turn idempotency bounded: empty extractions are not recorded, and only the
  most recent 4096 processed turns are retained, so idempotency is not guaranteed
  after an older turn falls outside that window. Deletion hashes remain stored
  permanently to prevent old backups from resurrecting forgotten memories; normal
  recall does not read the ledgers.
- Local Desktop runtime smoke passed against 0.2.1-rc.5 using a synthetic provider
  adapter; it was not an online LLM quality evaluation. Tag-triggered CI, GitHub
  release assets and npm registry verification are recorded in the
  [0.6.0 verification record](docs/releases/v0.6.0.md).

### Retrieval and session isolation details

- Subagents no longer receive a Brain reference. `contextFor()` returns `''`
  for non-root agents, and `agent/pre-step` and `agent/request` return their
  decision or request unchanged. Their query used to be empty, so they got the
  newest `maxContextMemories` memories whatever the topic. If an older version
  left a Brain reference on a subagent's session, its next request replaces
  that node once with `Brain reference disabled.`; errors there are swallowed,
  so a subagent request never fails because of Brain. A failing
  `ctx.agents.roots()` lookup leaves the session untouched: no injection and
  no retirement of a reference, while the request itself proceeds; a user
  message claimed, or a turn ended, while the lookup fails is not learned.
  Only a lookup that succeeds and excludes the agent takes the non-root path.
- Read-only memory tools remain available to child agents. `brain_remember`,
  `brain_forget` and `/brain` mutation commands require a confirmed root agent;
  an unavailable root lookup rejects the mutation.
- Automatic injection selects memories by relevance instead of raw term
  counts. The new pure module `lib/relevance.js` scores eligible visible
  memories with BM25 over binary term frequency (`K1 = 1.2`, `B = 0.75`) on the
  shared `lib/text.js` terms. The index and queries both ignore a fixed
  stopword list (Chinese filler and connective bigrams; acknowledgements such
  as 收到, 谢谢, 没问题; option picks such as 方案, 第二, 下一步; generic
  question words such as 有没有 and 要不要; English function words and
  acknowledgements such as thanks, ok, next, done, lgtm), every Han term that
  contains one of 的了吗吧呢啊嗯哦, and ASCII numbers of one or two digits
  (option picks such as `2` or `方案 2`). Only terms of the current turn make
  a memory a candidate.
- Strong and weak evidence. A candidate is strong when the store holds fewer
  than 20 eligible memories (`SMALL_STORE`), when it has at least two
  independent matches with the current turn, or when it matches a term that
  appears in at most `max(2, min(3, 5% of memories))` memories
  (`SPECIFIC_RATIO = 0.05`, capped at `WEAK_MAX`). Independent matches count
  each distinct matched ASCII word or lone Han character once and each maximal
  stretch of adjacent matched bigrams once, and a stretch counts only when it
  adds a term not counted yet: the overlapping bigrams of one word (数据/据库)
  are a single match, and a word repeated in the query counts once. One word or
  phrase, however long, is therefore weak unless it contains a specific term or
  the store is small, and once 20 or more memories are eligible a single word
  usually brings at most three memories however large the store: up to three
  specific ones or up to three weak ones. A long phrase whose bigrams are each
  rare in different memories can still bring a few more. The trade-off is
  that in a large store a single-concept question brings the three best of
  possibly more matches; on a 500-memory synthetic corpus single-phrase recall
  fell from 100% to 76% while precision stayed at 100%, and the model can call
  `brain_search` for the rest. Candidates whose current-turn score is below 35%
  of the best current-turn score are dropped (`REL_FLOOR = 0.35`); history
  never moves that bar. At most three weak matches appear (`WEAK_MAX = 3`),
  counting weak matches already shown, so repeated tool steps cannot pile them
  up.
- Conversation window and sticky selection. The query is the current turn's
  real user text. The previous two real user messages on the session surface
  (scanning the last six, each cut to 2000 code points) are history. Messages
  of the current turn are left out by the message ids recorded when the inbox
  claims them, with text containment as the fallback for messages without an
  id, so a current message longer than `extractionMaxChars` never takes a
  history slot. History terms add half their score to the order
  (`HISTORY_WEIGHT = 0.5`) and never add a memory on their own; once the
  previous turns contribute terms, a weak candidate needs at least one of
  them. Memories listed in the session's current Brain reference stay while
  they remain visible and eligible, ranked after new strong matches, until the
  count or budget limit pushes them out. Repeated tool steps and contentless
  turns therefore keep the same selection, and a turn with new strong matches
  puts those first. `lib/context.js` adds the read-only helpers
  `recentUserTexts()`, `referenceIds()` and `hasReference()`, which never
  throw.
- Core global `preference`/`instruction` records keep their share: their ids
  are removed from the kept ids before selection, so a core preference shown
  earlier stays inside the 1/3 core token sub-budget instead of returning as a
  kept memory. The style brief and all budget logic are unchanged.
- Provenance. Each injected line is now
  `{"id","scope","from","saved","text"}` (plus `truncated` when cut). `saved`
  is the `updatedAt` date. `from` is `this chat` for memories learned in the
  current session, `earlier chat` for other sessions, `saved by user` for
  `/brain remember`, CLI and API writes, `saved by assistant` for
  `brain_remember`, and `unknown` otherwise. `learn()` and the label share one
  session-id helper, so credential-like session ids that `learn()` hashes still
  match. The header now says that an item whose `from` is not `this chat` is
  background that may be stale or unrelated to the current task.
  `lastContextUsage`, shown by `/brain status`, adds `ids`: the injected memory
  ids in output order.
- `brain_search`, `brain_list`, `brain_read`, `/brain search`, `search()`,
  `memoryPage()`, `_rank()`, learning, write-time deduplication, dream and the
  CLI are unchanged.
- The relevance index is memoized per Brain instance, one entry per resolved
  workspace and at most four (the least recently used goes first),
  fingerprinted by the id, `updatedAt`, text length and key of every visible
  eligible memory; a write from the CLI or another instance rebuilds it on the
  next request. With `maxContextMemories` at 0 no index is built.
  schemaVersion stays 1, with no new persisted fields, settings or
  dependencies.
- Known limits: subagents no longer see global preferences such as the
  code-comment language, so the parent agent has to pass them on or the
  subagent can call `brain_search`; a restated fact keeps the provenance of
  whichever text won the write-time merge; over a long conversation the
  reference can fill up to `maxContextMemories` with memories that were
  relevant earlier in that conversation; bigram tokenization can still produce
  a rare junk match across a word boundary; a few real words cannot match on
  their own because they are stopwords or contain a particle (for example
  确认, 酒吧); the relevance index is rebuilt on the first request after a
  write that changes a visible memory, so that request pays a build cost that
  grows with store size.
- Tests: new `test/relevance.test.mjs` (the policy on synthetic stores of 32,
  100 and 500 memories) and `test/isolation.test.mjs` (Brain and adapter level,
  through the hooks). Existing tests that relied on empty-query recall now pass a matching
  query or save a real preference as `kind: 'preference'`, and the digit,
  quote and trait-name checks in `test/dream.adversarial.test.mjs` cover the
  text after the header, which quotes `"this chat"`.

## 0.5.0 — 2026-10-31

- Write-time deduplication merging. `_remember` now matches a candidate against
  existing records in the same scope and workspace through five deterministic
  criteria, first match wins: exact key, exact normalized text, canonical key
  (`canonicalKey` = lowercase letters/digits, both sides at least 8 code points,
  so kebab-case and snake_case spellings of one semantic key merge — and the two
  texts must also share at least one term, so unrelated facts with colliding
  keys stay separate), containment
  of one normalized text in the other (shorter side at least 6 code points), and
  term-Jaccard similarity of at least 0.75 using the shared `lib/text.js`
  tokenizer. A hit merges instead of appending a near-duplicate: the record
  keeps the existing id and createdAt, refreshes updatedAt, takes the maximum
  confidence, prefers the existing key, and follows the mem0 "most informative"
  rule for text — a restatement shorter than 60% of the stored text loses to the
  stored text, anything at least that substantial wins as a correction.
  `kind` and `source` follow the winning text; `personalityTraits` take the
  union. The 0.75 bar sits above dream's 0.6 human-review threshold on purpose:
  an automatic write-time merge has no review step, and pairs between the two
  thresholds remain dream review candidates. `similarity()` moved from
  `lib/dream.js` to `lib/text.js` (dream imports it; behavior unchanged).
  Explicit manual rewrites — `automatic=false` with an id — keep the previous
  pure replacement semantics, so `brain_remember` with `id` and the CLI
  `update` command still replace text verbatim.
- The `brain_remember` tool result now includes `merged: boolean` (true when the
  write updated an existing record instead of creating one), and its
  description states that similar memories in the same scope are merged rather
  than duplicated. `/brain remember` and the `remember()` API still return the
  full record.
- Memory value gate. `validateExtraction` rejects ephemeral task state on the
  memories branch even at high model confidence (feedback is untouched):
  bare URLs, git-ref-shaped strings, `file.ext:line` references, 结果/状态/
  进度/输出/日志-colon status leads, status-emoji leads, status-ending
  predicates (有问题/报错/失败了/修好了…, completed 了 forms included), and
  test/build result snapshots ("181 个测试全部通过", verify/ci/build …
  pass/passes/passing/fail/fails/failing/passed/failed/green/red). A
  sentence that starts with 请记住/记住/remember, or contains a durable cue
  (以后/今后/往后/一直/每次/总是/always/from now on), is exempt — explicit
  user intent outranks the heuristics. Rejections count in `result.rejected`.
- Model-path `updateOf`. Background extraction now injects the top-10
  similar existing memories (same visible scope, id + key + text truncated to
  200 code points, read-only `brain.search`) into the user message as
  `EXISTING`, and `EXTRACTION_PROMPT` documents the minimum-signal bar, the
  time-bound-statement rule and the updateOf protocol. The model may answer
  with `"updateOf": "<id>"` on a memory that restates an existing one;
  `validateExtraction` passes a non-empty id of at most 100 characters through,
  and `learn()` resolves it inside the same transaction (same scope, same
  workspace path) onto that record with the informative merge. A stale or
  cross-scope id degrades to a plain add instead of failing the turn. A missing
  or failing search degrades to an empty `EXISTING` list; extraction never
  depends on store readability. `extractionPrompt()` in `lib/extraction.js`
  carries the same value-gate wording.
- Version 0.5.0, schemaVersion stays 1, no new persisted fields, no new
  dependencies, and the `validateState` whitelist is unchanged. 23 new
  regression tests cover the five merge criteria (including the
  canonical-collision term guard), the 60% rule, the explicit-id exception,
  updateOf (hit, stale, cross-scope), merge identity/capacity/
  scope isolation, the EXISTING context, the gate's rejections (including
  completed 了 suffixes and English word forms), exemptions and keep-samples,
  and the untouched feedback/fallback paths.

## 0.4.1 — 2026-10-31

- Fix intermittent Windows failures when concurrent writers contend for
  `.brain.lock`: NTFS reports a directory that another writer is creating or
  removing at that instant as `EPERM`/`EBUSY` instead of `EEXIST`, which aborted
  an ordinary write. Those codes now count as contention inside the existing
  bounded wait, and only the directory creation counts as contention: a
  failure while writing `owner.json` still surfaces immediately. Unlock now
  asks `fs.rm` for bounded retries (`maxRetries`/`retryDelay`) instead of
  removing the directory once, and a lock directory that has already vanished
  counts as a successful unlock. A failed takeover-directory cleanup no
  longer aborts the write that triggered the reclaim. A timeout that reports
  an uncreatable lock directory keeps the errno `code`
  (`error.code === 'EPERM'`) with `cause` pointing at the original failure,
  and says "cannot be created" only when the lock directory never appeared
  (an existing directory still reports "locked"). Contention is diagnosed
  from the most recent failure alone, so an old `EPERM` cannot poison a later
  `EEXIST` wait. Regression tests cover `EPERM`, `EBUSY` and the contention
  reset.
- Fix lost writes on Windows when another handle has `brain.json` open. The
  final rename over the store fails with `EPERM` while an unlocked reader
  (`list`, `search`, `personality`, `stats`, the `context()` call made for every
  prompt, or the `personalityGeneration` getter) holds the file, so a CLI write
  could fail while Desktop built a prompt and a background learning write could
  fail while a `context()` read overlapped it. `Brain._write` now retries that
  rename on Windows for `EPERM`, `EACCES` and `EBUSY` with a 1-5 ms backoff for
  up to 5 seconds, still under the store lock and still honoring abort signals
  and temp-file cleanup. Other platforms and other error codes are unchanged.
  A failure that never clears (for example a read-only `brain.json`) now
  surfaces its original error after those 5 seconds instead of at once, with
  the store untouched. Regression tests inject the Windows error for a
  transient burst, a permanent failure, a non-transient code, a non-Windows
  platform and an abort during the retry.

## 0.4.0 — 2026-10-30

- Replace raw personality JSON injection with a deterministic natural-language
  `styleBrief()` (five fixed dimensions, low/mid/high bands, neutral default).
  The prompt now carries `BRIEF_HEADER` plus behavior sentences and no longer
  exposes `mode`, trait names, or numeric values. Adaptive/manual/off semantics
  are unchanged. This is a model-visible text contract change: tests that
  asserted the old JSON (`core.settings`, `core`, `memory-context`, `adapter`,
  runtime smoke) now assert the complete expected brief fragment, and also
  reject any `"mode"`/`"traits"`/`"warmth"` fallback. Mid-band drift (for
  example 0.45) intentionally keeps the neutral wording until a band is crossed.
- Add read-only dream planning (`groupCandidates`, `dreamPayload`, `validateDream`,
  `planDream`): key/stem grouping is confined to one scope and workspace,
  oversized clusters split into deterministic 2..20-id chunks, exact normalized
  duplicates are grouped in linear time, and remaining pair comparisons use an
  inverted index with a hard 200k budget (`stats.truncated`). Payloads are
  bounded, structural plan errors fail closed with field-specific messages, and
  unfaithful index lines degrade to a generated index line. Missing
  `groups`/`contradictions`/`drop` arrays default to empty; explicit wrong types
  still fail. Timestamp ties are compared as instants across equivalent ISO
  formats.
- Add `brain.dreamPlan()` and `/brain dream [--json]`; both only read the
  durable store and never write a plan or migrate state.
- Harden the dream validator after an adversarial review: control and bidi
  characters are rejected in `title`/`line`/`brief`/`reason`; duplicate `drop`
  ids collapse to one; index lines may not invent a single CJK bigram (a 0.6
  coverage ratio let a one-word swap through, so 三点→四点 now degrades to the
  extractive line); a corrupt or missing store returns an actionable error
  instead of a raw `SyntaxError`.
- Context assembly now ranks durable memories above the soft style brief: at
  narrow budgets (for example `maxContextChars=300`) the brief is dropped rather
  than the only memory line, matching the pre-0.4 allocation.
- Extract shared normalization/tokenization into `lib/text.js`; `lib/core.js`
  behavior is unchanged and no new runtime dependency is introduced. The
  persisted `schemaVersion` stays 1.
- Read local style polarity through clause-scoped negation (including 少, 不那么,
  stop, never and no need), so phrases such as 少开玩笑, 别那么正式 and
  "don't be so formal" no longer flip to the opposite direction. Length
  complaints (太长, 啰嗦, 冗长, too long, too wordy, wordy) are low verbosity
  directly and are never reversed by a preceding 太 or negation, while 不够 is a
  request cue (回答不够详细 asks for more detail) rather than a negator. The
  negation gap allows helper words such as keep, go into or replies, and
  meaning-changing verbs such as forget, stop, mind, 忘 or 介意 block the flip
  instead of inverting it. Opposite directions inside one sentence cancel that
  dimension, and a local/model direction disagreement drops that dimension for
  the turn instead of letting the weaker signal win. Style is learned only when
  the wording targets the assistant's reply manner: reply-leading phrases such
  as 回答详细一点, reply-adjacent manner words, 别/不要/太/那么 evaluations and
  English less/fewer/not so requests qualify, and a durable marker makes
  副词+回答 a lasting style rather than a one-off request. 以后/今后/往后 alone
  do not prove a style request, and common words such as 直接, 主动 or 正式 do
  not count when they modify something else (直接找我, 正式环境). Requests about
  code, functions, logs, docs, READMEs or other artifacts stay ordinary
  instructions. Quantifiers scope globally only when they directly modify 项目
  (所有项目, 每一个项目); a named project such as 在 dsh-brain 项目里 stays
  workspace even when 所有 appears later, polite 如果可以的话/方便的话 clauses
  no longer make a request look hypothetical, and curly apostrophes in
  contractions are not treated as quotation marks. 都 is "all of them", not a
  durable marker: it only counts when a time word carries it (以后都, 每次都,
  一直都, 总是), so 两个问题都详细回答一下 asks for one answer about two items.
  can you / could you / would you / I want / I'd like / I prefer and
  less / fewer / not so count only sentence-initially and only when they
  describe the reply manner itself; when a concrete object follows (an
  explanation of, a summary of, logs, notes, the email, it, this) the sentence
  stays a one-off content request. 我的回答/我的回复/我写的回答 is the user's own
  text and no longer a reply cue, while 你的回答 still is. Two narrow
  phrasings stay accepted: 请 + ambiguous style word + 一点/一些/些 and
  "Please be (more|less) + style word", both only when the sentence names no
  other object. A durable request is also skipped when its style word targets
  another activity or object (以后详细记录每次部署, 以后周报写详细一点,
  以后开会简短一点).
- Compare the 0.05 learning deadband as integers at 0.0001 precision so low and
  high directions converge symmetrically (0.15 and 0.85). Reclaim `.brain.lock`
  only when `owner.json` names the same host, a positive non-self pid, and
  `process.kill(pid, 0)` reports `ESRCH`; takeover is serialized through
  `.brain.lock.takeover`, and the loop retries immediately only after the stale
  lock was actually deleted. A failed deletion (for example EPERM from a Windows
  scanner) leaves the takeover marker cleaned up and falls back to the normal
  timeout plus random wait, while locks without `host` and locks from other hosts
  still time out and require manual cleanup.
- Learn style only from the extraction model when it answers: local explicit
  preference rules are now a pure fallback (timeout, error, unparsable output)
  instead of being merged into a successful model result. Keyword heuristics
  misread ordinary requests ("两个问题都详细回答一下。" looked like a request for
  more detail), so six plain turns used to drift `verbosity` from 0.5 to 0.7 and
  inject "回答偏详细" while the model correctly saw no style request; a local
  `style:<traits>` memory could also overwrite the user's real preference. Local
  rules are still consulted to flag style excerpts so raw wording never injects,
  and local "请记住"/"remember" memories still merge. Local feedback only flags
  a dimension the model left alone and that is not in `conflicts`; a local
  whole-sentence tag would otherwise hide an unrelated fact from the same
  sentence (以后回答简短一点，另外我用 Windows。). Trade-off: an explicit
  request the model misses is no longer learned locally.

## 0.3.1 — 2026-10-27

- Fix first-turn reference ordering: queue the initial Brain message through
  pre-step, after the host's protected system head, instead of appending during
  request preparation. Later updates still replace only the Brain node.
- Validate every runtime smoke turn with the host's strict persisted-log codec,
  including a regression that rejects the 0.3.0 ordering bug.
- 0.3.0 is withdrawn: its in-memory replay test missed a stricter disk restore
  invariant. Upgrade before creating new conversations.

## 0.3.0 — 2026-10-27

- Keep a single current Brain reference on the model-visible session surface;
  preserve durable history, other runtime sections, and host token accounting.
- Add bounded global preference recall, paginated memory previews and `brain_read`
  chunks with result-bound cursors and workspace isolation.
- Add estimated token budgets alongside character limits (23 native settings).
- Stabilize adaptive style using recent consensus, a deadband and deterministic
  values for recognized phrases; project-only feedback cannot change global style.
- Add adversarial memory/style tests, a 30-turn bundled runtime audit, replay and
  compaction checks, and a sourced design evaluation.

## 0.2.1 — 2026-10-27

First public GitHub and npm release, distributed as `@yulianjie/dsh-brain`.
The unscoped npm name `dsh-brain` belongs to a different project.

### Packaging and migration

- Align the scoped package name, Cordis bundle, browser module ID, native settings
  slots and uninstall target; the CLI remains `dsh-brain` and the store schema is unchanged.
- Refuse scripted installation alongside the older local unscoped package to avoid
  duplicate `brain` entries. Uninstall the local package first and keep the same data directory.
- Provide an installable npm tarball and SHA256 checksum with the GitHub Release.

### Open-source preparation

- Adopt Apache-2.0 for the project, with a copyright notice and dependency license inventory.
- Add English onboarding, contribution/security policies, troubleshooting and release guidance.
- Add GitHub issue/PR templates, dependency updates and Node 22/24 CI on three operating systems.
- Validate source syntax, documentation links and installation of the actual npm tarball.
- Exclude private stores, local inspection copies, credentials and generated archives from Git.

## 0.2.0 — 2026-10-27

- Native Desktop plugin settings with 20 fields in six groups, validation, draft
  editing, explicit save, error handling and restoration of defaults.
- Adaptive, manual and off communication-style modes; manual overrides preserve
  learned style and history.
- Independent memory/style injection and style-learning controls, live volatile
  updates, extraction-route validation, cancellation and stale-task protection.
- Runtime smoke coverage for real host configuration persistence and restart.

## 0.1.0 — 2026-10-26

- Initial local JSON memory store, global/workspace retrieval, concurrent write
  protection, credential filtering, import/export and deletion markers.
- Evidence-based automatic extraction with bounded background processing and a
  deterministic fallback for explicit Chinese/English preferences.
- Gradual communication style with viewing, manual adjustment, freeze/reset,
  history and rollback.
- Cordis plugin, five model tools, `/brain` commands, local CLI and Windows
  Desktop installation/uninstallation scripts.

Versions 0.1.0 and 0.2.0 were local development milestones, not public releases
of this project on npm. Version 0.2.1 is the first public release.
