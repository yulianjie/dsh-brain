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

- Extracts durable information from completed root-agent user turns, with literal
  source evidence, deduplication, bounded queues and conservative offline fallback.
- Retrieves global preferences and facts for the current workspace using English
  tokens and Chinese bigrams. No vector database or separate memory server is needed.
- Adjusts warmth, verbosity, humor, proactivity and formality gradually, with manual
  overrides, freeze/reset, history and rollback.
- Provides 20 native Desktop settings, `/brain` commands, five model tools and a
  standalone management CLI.
- Stores inspectable JSON with atomic replacement, cross-process write locking,
  import/export and deletion markers that resist resurrection from old backups.

## Requirements and compatibility

| Component | Scope |
| --- | --- |
| Core and management CLI | Node.js 22+; CI tests Node 22/24 on Windows, Linux and macOS |
| Desktop integration | Windows Desktop **bundled runtime 0.2.1-rc.3** |
| Installation scripts | Windows PowerShell and Desktop's bundled CLI |
| Native UI and CLI help | Currently Chinese; commands and configuration keys are stable identifiers |

Core CI coverage does not establish native Desktop support on Linux/macOS.
Other host versions need separate verification. The package version is **0.2.1**.

## Install

The official package name is **`@yulianjie/dsh-brain`**. The unscoped npm name
`dsh-brain` belongs to another project. The management command remains `dsh-brain`.

### From npm

Use Desktop's bundled CLI, not an unrelated global DSH installation:

```powershell
$dshCli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dshCli plugin --profile desktop add '@yulianjie/dsh-brain@0.2.1'
```

To install only the standalone management CLI, run
`npm install -g @yulianjie/dsh-brain@0.2.1`, then `dsh-brain --help`.
This global CLI installation does not register the Desktop plugin.

### From GitHub Release

Download `yulianjie-dsh-brain-0.2.1.tgz` and `SHA256SUMS.txt` from
[v0.2.1](https://github.com/yulianjie/dsh-brain/releases/tag/v0.2.1) into one directory:

```powershell
$expected = ((Get-Content .\SHA256SUMS.txt -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash .\yulianjie-dsh-brain-0.2.1.tgz -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA256 mismatch' }
tar -xf .\yulianjie-dsh-brain-0.2.1.tgz
.\package\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.2.1.tgz
```

Installation still downloads dependencies; the tarball does not bundle `node_modules`.

### From source

Install the target Desktop version, Git and Node.js/npm first. No compilation is
needed. Dependencies are downloaded from the npm registry.

```powershell
git clone https://github.com/yulianjie/dsh-brain.git
cd dsh-brain
npm.cmd ci
npm.cmd run verify
npm.cmd pack
.\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.2.1.tgz
```

Restart Desktop normally. Open the installed `@yulianjie/dsh-brain` plugin and run
`/brain status`. The installer calls Desktop's bundled `dsh plugin --profile desktop
add <tarball>`; it does not stop the running application or rewrite profile YAML.
Use `-DshCli <path>` for another installation, `-Profile` for another profile,
`-DshHome` for an isolated home, and `-DryRun` to inspect the intended operation.

```powershell
.\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.2.1.tgz -DshHome "$env:TEMP\dsh-brain-demo" -Profile brain-test
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

Keep the same `DSH_HOME` and `dataDir`. The plugin row ID `brain`, data path and
schemaVersion=1 are unchanged; memory, learned style, history and row configuration
overrides are retained. Installation does not stop Desktop or delete the store.

## Everyday use

Say “Please remember: I prefer replies in English”, or use explicit commands:

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
`brain_list`, `brain_remember`, `brain_forget` and `brain_personality`. Import/export
and destructive style controls are reserved for user commands or the local CLI.

Automatic learning does not scan old conversations or import another agent's
memory. It ignores assistant text, tool output and subagent turns. Workspace
identity comes from the session directory; renaming or moving it changes that key.

## Communication style

Five traits range from 0 to 1 with a neutral default of 0.5. Higher values mean
warmer, more detailed, more humorous, more proactive or more formal responses.
Automatic changes require at least three independent explicit feedback turns per
trait and move at most 0.05 per turn. Repeated events do not count twice. Freezing
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
| `lockTimeoutMs` | `15000` milliseconds |

The full ranges and patch examples are in the [Chinese configuration reference](README.md#配置与存储).
Only one extraction call runs at a time, with at most one attempt per turn. Queue
overflow drops new tasks; timeouts use local explicit-preference extraction. An
uncooperative provider occupies the model slot until it settles. Disabling learning
cancels waiting/in-flight extraction; an atomic commit already issued cannot be undone.

Data lives at `$DSH_HOME/brain/brain.json`, or `~/.dsh/brain/brain.json` without
`DSH_HOME`. Profiles with the same default home share global memories and style.
Set different `dataDir` values when they must be separated. Corrupt or unsupported
data causes an error and is preserved. Do not remove a lock while its writer lives.

## Management CLI

Use the source CLI, or install the local tarball globally with
`npm install -g ./yulianjie-dsh-brain-0.2.1.tgz` to obtain `dsh-brain`. Use a matching
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
markers while retaining the current style. See [all CLI examples](README.md#本地管理-cli).

## Privacy and limits

Local storage is **plaintext**, not encrypted. Automatic extraction sends current
user text through the configured host model, and recalled memories are included in
later model context. This can incur provider charges. Disable `autoLearn` to stop
automatic extraction; injection has separate switches. There is no separate
memory upload service.

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
of the real tarball using synthetic data. CI runs on Node 22/24 across three OSes.
Runtime smoke uses actual bundled host services and a controlled synthetic provider;
it does not call a real network model or validate a native window.

[Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) ·
[Architecture (Chinese)](docs/DESIGN.zh-CN.md) · [Validation (Chinese)](docs/VALIDATION.zh-CN.md) ·
[Changelog](CHANGELOG.md) · [Release checklist](docs/RELEASING.md)

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE).
Dependencies retain their own licenses. The design draws on memory/state concepts
from dsh-memory, Mem0 and Letta, without incorporating their source code.
See [dependencies and attribution](docs/DEPENDENCIES.md).
