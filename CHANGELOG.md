# Changelog

## Unreleased

- Fix intermittent Windows failures when concurrent writers contend for
  `.brain.lock`: NTFS reports a directory that another writer is creating or
  removing at that instant as `EPERM`/`EBUSY` instead of `EEXIST`, which aborted
  an ordinary write. The lock now treats those codes as contention inside the
  existing bounded wait, reports a lock path that can never be created instead
  of a misleading live-writer message, retries transient unlock errors, and
  covers both cases with regression tests.

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
