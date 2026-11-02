# Security policy / 安全政策

## Supported versions

Security fixes target the latest revision of the **0.6.x** line of `@yulianjie/dsh-brain` on `main`. Older
versions do not currently receive backports. This community project does not
promise a response or remediation deadline.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/yulianjie/dsh-brain/security/advisories/new).
Do not file a public Issue containing an exploit or private data. If GitHub does
not offer that form, open an Issue requesting a private contact channel with no
vulnerability details.

Include the affected version and platform, synthetic reproduction steps, expected
and observed behavior, and the impact. Never attach credentials, a real
`brain.sqlite` database, legacy `brain.json` files, SQLite sidecars, full exports,
private conversations, or unredacted filesystem paths.
请使用合成样例报告漏洞，不要在公开 Issue 中提交真实记忆或凭据。

## Trust and data boundaries

- Data is stored as plaintext SQLite at `<dataDir>/brain.sqlite`; transactions
  protect consistency but do not encrypt data or defend against a malicious process
  running as the same OS user. Legacy `brain.json` files and SQLite sidecars are
  equally sensitive.
- Workspace separation is logical path-based filtering, not a security sandbox.
  Profiles sharing the default `DSH_HOME` also share global memories and style.
- Automatic extraction sends current user text through the host's configured LLM
  provider. Model-organized memory summaries can enter later model context; original
  evidence is stored separately for checking and traceability and is not injected.
  When the model is unavailable, raw text is not automatically saved as memory.
  Explicit `/brain remember` and CLI `remember` still save supplied text directly.
  There is no separate memory upload service, but this is not a fully offline
  workflow when an LLM is used.
- Credential filtering is heuristic. It cannot guarantee that secrets will never
  be stored. Disable automatic learning for sensitive conversations and inspect
  stored records before sharing diagnostics or backups.
- Memories are untrusted, lower-priority context with provenance and size limits.
  Prompt injection and model compliance cannot be ruled out solely by these controls.
- Exports contain every workspace, original evidence, deletion markers and style history. Treat them
  as private backups. `forget` removes matching active evidence/history, but does
  not erase external backups, previous model requests or filesystem snapshots.
- `forget` is logical removal, not secure physical erasure. Deleted values may
  remain in SQLite free pages, WAL/SHM sidecar files, the preserved legacy JSON,
  backups, filesystem snapshots or prior model requests. It prevents ordinary
  future recall; it does not promise to purge every historical copy.

For configuration, data paths and recovery steps, see the [README](README.md) and
[troubleshooting guide](docs/TROUBLESHOOTING.md).
