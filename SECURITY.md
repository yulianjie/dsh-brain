# Security policy / 安全政策

## Supported versions

Security fixes target the latest revision of the **0.2.x** line of `@yulianjie/dsh-brain` on `main`. Older
versions do not currently receive backports. This community project does not
promise a response or remediation deadline.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/yulianjie/dsh-brain/security/advisories/new).
Do not file a public Issue containing an exploit or private data. If GitHub does
not offer that form, open an Issue requesting a private contact channel with no
vulnerability details.

Include the affected version and platform, synthetic reproduction steps, expected
and observed behavior, and the impact. Never attach credentials, real `brain.json`
files, full exports, private conversations, or unredacted filesystem paths.
请使用合成样例报告漏洞，不要在公开 Issue 中提交真实记忆或凭据。

## Trust and data boundaries

- Data is stored as plaintext JSON on the local filesystem. Atomic replacement and
  a write lock protect consistency; they do not encrypt data or defend against a
  malicious process running as the same OS user.
- Workspace separation is logical path-based filtering, not a security sandbox.
  Profiles sharing the default `DSH_HOME` also share global memories and style.
- Automatic extraction sends current user text through the host's configured LLM
  provider. Recalled memories enter subsequent model context. There is no separate
  memory upload service, but this is not a fully offline workflow when an LLM is used.
- Credential filtering is heuristic. It cannot guarantee that secrets will never
  be stored. Disable automatic learning for sensitive conversations and inspect
  stored records before sharing diagnostics or backups.
- Memories are untrusted, lower-priority context with provenance and size limits.
  Prompt injection and model compliance cannot be ruled out solely by these controls.
- Exports contain every workspace, deletion markers and style history. Treat them
  as private backups. `forget` removes matching active evidence/history, but does
  not erase external backups, previous model requests or filesystem snapshots.

For configuration, data paths and recovery steps, see the [README](README.md) and
[troubleshooting guide](docs/TROUBLESHOOTING.md).
