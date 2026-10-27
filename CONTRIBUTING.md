# Contributing / 贡献指南

欢迎中文或英文的 Issue、文档改进和 Pull Request。项目由社区维护，当前处于
0.x 阶段；宿主接口可能随预发布版本变化。兼容性以 README 与验证记录为准。

## Development setup

Use Node.js 22 or newer and npm. No build step or global DSH installation is needed
for the core, CLI, and unit tests.

```sh
git clone https://github.com/yulianjie/dsh-brain.git
cd dsh-brain
npm ci
npm run verify
```

In Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.
`verify` checks JavaScript syntax and local Markdown links, runs the test suite,
then packs and installs the actual tarball in a temporary directory for a CLI and
export smoke test. The package check resolves dependencies from the npm registry.
It never installs into your real Desktop profile.

## Making changes

1. Open an Issue for substantial behavior, data format, or host API changes.
2. Create a focused branch from `main`; keep unrelated changes separate.
3. Follow the existing ESM JavaScript style: two spaces, semicolons, Node built-ins
   where practical. There is no transpilation or generated source to commit.
4. Add behavioral coverage for bugs and new features. Use synthetic conversations
   and temporary stores; do not read a contributor's real DSH data or credentials.
5. Update the Chinese README, relevant English guidance, and `CHANGELOG.md` when
   behavior changes. Keep the package and lockfile versions synchronized.
6. Run `npm run verify` and `git diff --check`, then submit a PR describing the
   problem, resulting behavior, and actual validation performed.

## Host integration

Windows Desktop integration targets bundled runtime **0.2.1-rc.3**. Run
`npm run test:runtime` with that Desktop installed; set `DSH_DESKTOP_EXE` for a
non-default executable. This uses temporary synthetic profiles and a controlled
provider. It does not prove native window behavior or real model quality.
Changes to settings UI also need manual Desktop verification. Do not automatically
stop a running Desktop instance or overwrite a contributor's profile.

CI runs Node 22/24 core, CLI, package and adapter tests on Windows, Linux and macOS.
It does not install Desktop or claim native integration on every operating system.
See [architecture](docs/DESIGN.zh-CN.md), [validation](docs/VALIDATION.zh-CN.md),
and [release checks](docs/RELEASING.md).

## Data and compatibility rules

- Treat recalled memories and model output as untrusted data, never instructions.
- Keep global/workspace boundaries, evidence validation, cancellation, bounded
  queues, atomic writes and non-destructive failure behavior intact.
- Avoid silently migrating, resetting or discarding a user's store. Document and
  test any schema change and its recovery path.
- Do not commit `brain.json`, exports, profiles, credentials, generated tarballs,
  copied host packages, or files from ignored local verification directories.
- Dependency licenses remain distinct from the project's Apache-2.0 license.

## Reports and community

Use [Issues](https://github.com/yulianjie/dsh-brain/issues) for reproducible bugs
and proposals. Send vulnerabilities through [private security reporting](SECURITY.md).
Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Unless explicitly stated otherwise, contributions intentionally submitted for
inclusion are provided under the [Apache License 2.0](LICENSE). Submit only work
you are entitled to contribute and preserve any applicable third-party notices.
