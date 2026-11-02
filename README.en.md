# DSH Brain

[![CI](https://github.com/yulianjie/dsh-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/yulianjie/dsh-brain/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

[简体中文](README.md) | **English**

Local long-term memory and gradual, user-controlled communication style for
DeepSeek Harness Desktop. Remember durable preferences across conversations,
keep project facts scoped to a workspace, and inspect or adjust what is learned.
“Personality” means language behavior preferences, not consciousness or feelings.

This is an independent community plugin, not an official DeepSeek product. It is
currently a 0.x project targeting a specific prerelease host API.

## What it does

- Extracts durable information from completed root-agent user turns. Automatic
  memory text is a model-organized summary; separate original evidence is retained
  for validation and traceability and is not injected into conversations.
- Retrieves global preferences and facts for the current workspace using English
  tokens and Chinese bigrams. No vector database or separate memory server is needed.
- Adjusts warmth, verbosity, humor, proactivity and formality gradually, with manual
  overrides, freeze/reset, history and rollback.
- Provides 23 native Desktop settings, `/brain` commands, six model tools and a
  standalone management CLI.
- Stores data in SQL tables in `<dataDir>/brain.sqlite`, using built-in
  `node:sqlite` and transactions. JSON schemaVersion 1 import/export remains available.

## Requirements and compatibility

| Component | Scope |
| --- | --- |
| Core and management CLI | Node.js >=22.13; CI matrix targets Node 22/24 on Windows, Linux and macOS |
| Desktop integration | Local bundled runtime 0.2.1-rc.5 (Electron 44.7.0, Node 24.21.0); runtime smoke passed |
| Installation scripts | Windows PowerShell and Desktop's bundled CLI |
| Native UI and CLI help | Currently Chinese; commands and configuration keys are stable identifiers |

The package version is **0.6.0** and requires Node.js >=22.13, which can import
built-in `node:sqlite` without a startup flag. The minimum Node.js 22.13.0 Windows
binary, local Node.js 24.14.1 and Desktop's bundled Node.js 24.21.0 were checked.
The local Desktop smoke passed on bundled runtime 0.2.1-rc.5 using a synthetic
provider adapter; it was not an online LLM quality evaluation. Core CI coverage
does not establish native Desktop support on Linux/macOS. See the
[0.6.0 verification record](docs/releases/v0.6.0.md).

### Remote release verification (status at this source snapshot)

When this source snapshot was prepared, local source, package-install and Desktop
runtime checks were complete; final-tag GitHub CI, GitHub Release assets, npm
publication and registry tarball verification were pending the release workflow.
The [0.6.0 verification record](docs/releases/v0.6.0.md) and GitHub Actions have
the final status. The installation commands below target 0.6.0 and can be used
after the release workflow publishes the package.

## Install

The official package name is **`@yulianjie/dsh-brain`**. The unscoped npm name
`dsh-brain` belongs to another project. The management command remains `dsh-brain`.

### From npm (after publication)

Use Desktop's bundled CLI, not an unrelated global DSH installation:

```powershell
$dshCli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dshCli plugin --profile desktop add '@yulianjie/dsh-brain@0.6.0'
```

To install only the standalone management CLI, run
`npm install -g @yulianjie/dsh-brain@0.6.0`, then `dsh-brain --help`.
This global CLI installation does not register the Desktop plugin.

### From GitHub Release (after publication)

Download `yulianjie-dsh-brain-0.6.0.tgz` and `SHA256SUMS.txt` from
[v0.6.0](https://github.com/yulianjie/dsh-brain/releases/tag/v0.6.0) into one directory:

```powershell
$expected = ((Get-Content .\SHA256SUMS.txt -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash .\yulianjie-dsh-brain-0.6.0.tgz -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA256 mismatch' }
tar -xf .\yulianjie-dsh-brain-0.6.0.tgz
.\package\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.6.0.tgz
```

Installation still downloads dependencies; the tarball does not bundle `node_modules`.

### From source

Install the target Desktop version, Git and Node.js >=22.13/npm first. No compilation
is needed. Dependencies are downloaded from the npm registry.

```powershell
git clone https://github.com/yulianjie/dsh-brain.git
cd dsh-brain
npm.cmd ci
npm.cmd run verify
npm.cmd pack
.\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.6.0.tgz
```

Restart Desktop normally. Open the installed `@yulianjie/dsh-brain` plugin and run
`/brain status`. The installer calls Desktop's bundled `dsh plugin --profile desktop
add <tarball>`; it does not stop the running application or rewrite profile YAML.
Use `-DshCli <path>` for another installation, `-Profile` for another profile,
`-DshHome` for an isolated home, and `-DryRun` to inspect the intended operation.

```powershell
.\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.6.0.tgz -DshHome "$env:TEMP\dsh-brain-demo" -Profile brain-test
.\scripts\uninstall.ps1 -DshHome "$env:TEMP\dsh-brain-demo" -Profile brain-test
```

For the default profile, uninstall with `.\scripts\uninstall.ps1`. Uninstallation
preserves memory data. Export it before intentionally removing the verified data
directory, and stop all writers first. From an extracted Release package use
`.\package\scripts\uninstall.ps1`, or run
`& $dshCli plugin --profile desktop remove '@yulianjie/dsh-brain'`.

### Migrating from a local 0.1.0/0.2.0 package

Export your memory and keep a profile configuration backup. Remove the old local
package with Desktop's bundled `plugin --profile desktop remove dsh-brain`, then
install the scoped package and restart Desktop normally. Do not install the
unrelated unscoped package from npm. The installer refuses a profile still depending
on the old unscoped name to avoid duplicate `brain` entries.

Keep the same `DSH_HOME` and `dataDir`. Version 0.6.0 keeps the plugin row ID
`brain`, `dataDir` and JSON import/export `schemaVersion: 1`. On first startup it
imports an existing `brain.json` into `<dataDir>/brain.sqlite` in a transaction and
preserves the original JSON unchanged as a backup. Existing memory text is not sent
to an LLM for rewriting. The migration does not delete the source JSON or stop
Desktop. The default 500-memory limit remains in effect.

## Everyday use

When the extraction model is available, say “Please remember: I prefer replies
in English”. Without an available model, automatic learning does not save the raw
turn as a memory; use `/brain remember` or CLI `remember` to save text directly.
Other explicit commands include:

```text
/brain remember global I prefer replies in English
/brain remember workspace This project uses Rust
/brain list
/brain search Rust
/brain personality
/brain freeze
```

| Commands | Purpose |
| --- | --- |
| `help`, `status` | Help, storage status and learning counters |
| `list [global\|workspace]`, `search <query>` | Inspect and retrieve records |
| `remember [global\|workspace] <text>`, `forget <id>` | Save or forget a record |
| `personality [trait=value ...]` | Inspect or directly set style values |
| `freeze`, `unfreeze`, `reset` | Control automatic style changes |
| `history`, `rollback <version>` | Inspect and restore available style history |

Prefix each command with `/brain`. An omitted `remember` scope uses the current
session workspace when available, otherwise global. Model tools are `brain_search`,
`brain_list`, `brain_read`, `brain_remember`, `brain_forget` and `brain_personality`.
Child agents retain the read-only search/list/read/personality tools. Only the root
agent may use memory write/forget tools or `/brain` mutation commands. Similar
memories in the same scope merge into the existing record instead of creating a
duplicate; `brain_remember` reports that with `merged:true`. Import/export and
destructive style controls are reserved for user commands or the local CLI.

Automatic learning does not scan old conversations or import another agent's
memory. It ignores assistant text, tool output and subagent turns. Workspace
identity comes from the session directory; renaming or moving it changes that key.

## Memory retrieval and context limits

Global memories are shared across sessions and workspaces using the same data
store, not across separate users, stores or devices. Save explicit cross-project
preferences with `/brain remember global I prefer Chinese replies`. Automatic
recall includes a small budgeted set of global preferences even for unrelated
queries, followed by relevant global and current-workspace facts.

Recall follows the current turn, with the previous two user messages of the
session as context; the current turn's own messages are left out by message
id, or by text containment when they have no id. Acknowledgements, option picks
and generic follow-ups such as "continue", "ok", "thanks", 收到 or 方案 2 are
ignored and add nothing new. Once 20 or more memories are eligible, a memory
that matches only one word or one contiguous phrase of any length (a word
repeated in the query counts once), such as 数据库 or 数据库连接, and no rare
term is a weak match: at most three weak matches appear, counting ones already
shown, and during a conversation they also need a word from the previous two
turns. A rare term appears in at most max(2, min(3, 5% of memories)) memories,
so in a store of 20 or more memories a single word usually brings at most three
memories however large the store (a long phrase whose parts are each rare in
different memories can bring a few more); a single-concept question in a large
store brings the best three, and the model can call `brain_search` for the
rest. A few words, such as 确认 or 酒吧, are stopwords
or contain a particle and cannot trigger recall on their own. Contentless turns
reuse the current references, so tool-call steps keep the same selection. On a
topic-bearing turn, current matches must pass the relevance floor; a strong
current topic removes history-only old references. A weak candidate can bridge a
continuation when it shares recent user-history evidence with the current topic.
History cannot introduce a memory or raise the relevance floor. Unrelated global
preferences still use at most about a third of the token budget. Subagents get no Brain reference, so they also miss global
preferences such as the code-comment language: the parent agent has to pass
them on, or the subagent can call `brain_search`. Each injected memory says
`from` (`this chat`, `earlier chat`, `saved by user`, `saved by assistant` or
`unknown`) and `saved` (the date it was last saved); anything not from this chat
is presented as background that may be stale or unrelated. Only real user
messages already on this session's surface are read, never tool output,
assistant text, other sessions or subagents.

`brain_list` and `brain_search` return `{records,total,nextCursor}` previews and
accept `scope`, `limit` (1..20, default 10) and `cursor`. Use `brain_read({id,cursor?})`
to read exact text in bounded chunks. Cursors expire when their visible results change and cannot be reused across
queries or workspaces. Unrelated turn counters and persona updates do not expire them. Local CLI list/export remain complete.

One current Brain reference message is durably replaced before model requests.
Old log events remain available; legacy runtime snapshots lose only their Brain
section. This prevents automatic snapshot accumulation, but does not bound other
plugins, conversation history or accumulated tool results. Replacing an earlier
message can reduce prompt-prefix cache reuse. Token estimates are heuristics,
not exact billing or model-window guarantees. `/brain status` reports budgets and
the process's last generated context usage. See the
[research and evaluation](docs/MEMORY-CONTEXT-REVIEW.zh-CN.md).

## Communication style

Five traits range from 0 to 1 with a neutral default of 0.5. Higher values mean
warmer, more detailed, more humorous, more proactive or more formal responses.
Automatic changes require at least three independent turns and 75% agreement in
the latest five feedback entries, with the newest feedback supporting the same
direction. Changes move at most 0.05 per turn, with a 0.05 deadband. Project-only
and temporary feedback cannot change the global persona. Repeated events do not count twice. Freezing
does not accumulate a backlog of changes. Manual settings apply immediately.

- `adaptive`: inject learned style and learn when the relevant switches allow it.
- `manual`: inject five chosen overrides and pause style learning, preserving the
  learned values and history.
- `off`: neither inject style nor learn new style feedback; retain stored state.

History is limited to 100 entries; each trait retains up to 20 feedback evidence
entries. These are model hints, not guarantees of model behavior.

## Configuration and storage

Use Desktop's installed-plugin details page. Edit the draft, then explicitly save.
Invalid numbers or incomplete provider/model pairs prevent saving. Failed saves
retain the draft; navigating away discards unsaved edits. Advanced `dataDir`
configuration remains in the profile patch, outside the UI.

| Setting | Default / purpose |
| --- | --- |
| `autoLearn` | `true`; background learning master switch |
| `injectMemories`, `injectPersonality` | `true`; independent context controls |
| `personalityMode`, `personalityLearningEnabled` | `adaptive`, `true` |
| `manualWarmth`, `manualVerbosity`, `manualHumor`, `manualProactivity`, `manualFormality` | Each `0.5`; overrides in manual mode |
| `extractionProvider`, `extractionModel` | Both empty to follow the session; otherwise set both host route IDs, never credentials |
| `extractionMaxTokens`, `extractionTimeoutMs` | `1800` output tokens, `15000` milliseconds |
| `extractionMaxChars`, `extractionMaxQueue` | `8000` user-text characters, `16` queued turns |
| `maxMemories` | `500`; lowering it does not delete records |
| `maxContextChars`, `maxContextMemories` | `6000` total context characters, `10` recalled records |
| `maxContextTokens` | `2000` estimated tokens; 0 disables automatic injection |
| `maxToolResultChars`, `maxToolResultTokens` | `6000` characters / `2000` estimated tokens per tool page |
| `lockTimeoutMs` | `15000` milliseconds waiting on SQLite write contention |

The full ranges and patch examples are in the [Chinese configuration reference](README.md#配置与存储).
Only one extraction call runs at a time, with at most one attempt per turn. Queue
overflow drops new tasks. If the model is unavailable, the plugin does not
automatically save the user's raw turn as a memory; local rules may only provide
limited fallback for numeric style feedback. Explicit `/brain remember` and CLI
`remember` still save the text the user directly supplies. An uncooperative
provider occupies the model slot until it settles. Disabling learning cancels
waiting/in-flight extraction; a database transaction already issued cannot be undone.

Data lives at `$DSH_HOME/brain/brain.sqlite`, or `~/.dsh/brain/brain.sqlite`
without `DSH_HOME`. Profiles with the same default home share global memories and
style. Set different `dataDir` values when they must be separated. First startup
in 0.6.0 imports an existing `brain.json` and preserves the original JSON unchanged
as a backup; it does not call an LLM to rewrite historical text. SQLite transactions
protect updates. Keep the database and any SQLite sidecar files together when
backing up, and do not copy a database while it is being written. Corrupt or
unsupported databases are reported and preserved. The database is plaintext, not
encrypted. Empty extractions are not recorded as processed turns; only the latest
4096 processed turns are kept, so idempotency is not guaranteed after an old turn
leaves that window. Deletion hashes are retained permanently to stop old backups
from restoring forgotten memories, and normal memory recall does not read these ledgers.

## Management CLI

Use the source CLI, or install the local tarball globally with
`npm install -g ./yulianjie-dsh-brain-0.6.0.tgz` to obtain `dsh-brain`. Use a matching
`--data-dir` to manage the same store as Desktop. Except help, successful commands
return JSON; errors go to stderr with a nonzero exit status.

```sh
node bin/brain.mjs --help
node bin/brain.mjs --data-dir ./sandbox remember "Synthetic example preference"
node bin/brain.mjs --data-dir ./sandbox list
node bin/brain.mjs --data-dir ./sandbox personality set verbosity 0.2
node bin/brain.mjs --data-dir ./sandbox export ./brain-backup.json
```

CLI `remember` defaults to global; `--scope workspace` requires `--workspace`.
`list/search/update/forget` without a workspace only access global records. The CLI
also supports `update`, `import`, `freeze`, `unfreeze`, `reset`, `history` and
`rollback`. Export includes all workspaces, deletion markers and history; existing
files require `--force`. Import merges validated data and deletion/deduplication
markers while retaining the current style. The interchange format remains JSON
`schemaVersion: 1`; the default maximum of 500 memories still applies. See
[all CLI examples](README.md#本地管理-cli).

## Privacy and limits

Local SQLite storage is **plaintext**, not encrypted. When the extraction model is
available, automatic memory text is a model-organized summary. The original source
evidence is stored separately for checking and traceability; it is not injected
into conversations. Automatic extraction sends current user text through the
configured host model, and recalled memory summaries enter later model context.
This can incur provider charges. If the model is unavailable, raw user text is not
automatically saved as a memory. Explicit `/brain remember` and CLI `remember`
remain direct text-entry paths. Disable `autoLearn` to stop automatic extraction;
injection has separate switches. There is no separate memory upload service.

Credential filtering is heuristic and cannot identify every secret. Do not save
credentials or publish exports. Retrieval is lexical, not semantic vector search;
both extraction and recall can miss or misclassify information. Memories are
lower-priority reference data with provenance and size limits, not authoritative
instructions. Inspect, correct, forget, freeze or disable learning as needed.

See [security policy](SECURITY.md) and [troubleshooting](docs/TROUBLESHOOTING.md).

## Development and license

```sh
npm ci
npm run verify
# Optional, Windows with the target Desktop installed:
npm run test:runtime
```

`verify` checks syntax, local documentation links, tests and a clean installation
of the package tarball using synthetic data. The local 0.6.0 package was installed
through Desktop's bundled CLI; normal restart activation is pending. Runtime
smoke passed with the local 0.2.1-rc.5 bundled runtime and a synthetic provider
adapter; it did not call a real network model or evaluate LLM quality. The
tag-triggered CI and remote publication checks are tracked separately in the
[0.6.0 verification record](docs/releases/v0.6.0.md).

[Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) ·
[Architecture (Chinese)](docs/DESIGN.zh-CN.md) · [Validation (Chinese)](docs/VALIDATION.zh-CN.md) ·
[Changelog](CHANGELOG.md) · [Release checklist](docs/RELEASING.md)

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE).
Dependencies retain their own licenses. The design draws on memory/state concepts
from dsh-memory, Mem0 and Letta, without incorporating their source code.
See [dependencies and attribution](docs/DEPENDENCIES.md).
