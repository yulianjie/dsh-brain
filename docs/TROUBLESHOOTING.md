# Troubleshooting / 故障排查

Use synthetic data when reproducing problems. Never attach your complete memory
store, export or profile to a public Issue. Start with `/brain status`, or use
`node bin/brain.mjs --data-dir <your-data-directory> status` against the correct
store. CLI commands other than help may initialize an empty store if none exists.

| Symptom / 现象 | Checks and recovery / 检查与处理 |
| --- | --- |
| PowerShell blocks `npm.ps1` | Use `npm.cmd`; changing the system execution policy is unnecessary. |
| `Desktop bundled CLI not found` | Check the Desktop installation and pass `-DshCli` to install/uninstall. Do not substitute a global CLI and assume identical APIs. |
| Installed plugin does not appear | Confirm the target profile, restart Desktop normally, and check that its bundled runtime matches the documented target. An isolated test profile is not the daily Desktop profile. |
| Settings form does not appear | Confirm scoped package @yulianjie/dsh-brain 0.2.1, a complete `lib/client.js`, and a compatible host. The client companion and host settings services are both required. |
| Settings cannot be saved | Check numeric ranges, read-only state, and provider/model pairing. Both route fields must be empty or populated. Retry after resolving concurrent edits; unsaved drafts are not persistent. |
| A memory is missing | Check `dataDir`, `DSH_HOME`, workspace path, injection switches, search wording and context budgets. CLI `list` without `--workspace` only shows global records. Moving a project changes its workspace key. |
| Automatic learning stops | Check `autoLearn`, root-turn completion, queue counters and model routing. Timeouts fall back to explicit phrases; a provider ignoring cancellation occupies the single model slot until it settles. |
| Style is unchanged | Adaptive mode requires at least three independent explicit feedback turns per dimension. Check freeze, mode and learning switches. Manual mode is an injection override; it does not rewrite learned history. |
| CLI and Desktop show different state | Point the CLI at the same `dataDir`; a different environment or profile can use another store. |
| Capacity reached | Inspect and explicitly forget obsolete records, or raise `maxMemories`. Lowering capacity does not erase existing data. |
| Storage is corrupt or schema is unsupported | Stop writers and preserve the original file. Restore a known-good backup into a separate directory with the matching version; do not delete the damaged file to hide the error. |
| Write lock times out | Stop the processes using that store and confirm the lock owner has exited. Only then manually remove that store's `.brain.lock` directory. Do not remove a live writer's lock or the entire data directory. |
| Uninstall leaves data | This is intentional. Export first, verify the actual store path, stop its writers, then remove it yourself if desired. |

To isolate a CLI problem in PowerShell:

```powershell
$brainScratch = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
node .\bin\brain.mjs --data-dir $brainScratch remember "Synthetic troubleshooting preference"
node .\bin\brain.mjs --data-dir $brainScratch list
```

For bug reports include the plugin version, Desktop bundled runtime, Node version,
OS, exact command and redacted error text. Distinguish a core/CLI issue from a host
runtime, native UI or real model issue. See [validation](VALIDATION.zh-CN.md).
