# Changelog

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
