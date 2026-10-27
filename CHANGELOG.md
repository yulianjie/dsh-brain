# Changelog

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
