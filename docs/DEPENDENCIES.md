# Dependencies and attribution

DSH Brain's own source and documentation are licensed under Apache-2.0. Dependency
licenses are not changed by that choice. `package-lock.json` records exact resolved
versions and integrity hashes; `npm ci` reproduces that dependency graph.

| Package | Locked version | Relationship | License |
| --- | --- | --- | --- |
| `@deepseek-ai/schemastery` | 3.18.5 | Direct dependency for native configuration schemas | MIT |
| `@deepseek-ai/cosmokit` | 1.8.6 | Transitive schema dependency | MIT |
| `@standard-schema/spec` | 1.1.0 | Transitive schema dependency | MIT |

The npm package does not bundle `node_modules`; npm installs dependencies with
their own license files. When redistributing dependencies together with the
project, retain their original license and attribution files. Recheck this table
against the lockfile when updating dependencies.

Desktop provides Cordis, the agent/session/LLM services, `tokenMeter`, React and UI primitives.
The context integration targets Desktop runtime 0.2.1-rc.3 and requires its
durable single-node surface replacement and token metering contracts.
These host packages are not vendored or redistributed here. The optional runtime
smoke script reads executable packages from a locally installed Desktop into a
temporary directory and removes that directory afterward. It does not copy host
code into the distributable package.

The memory/state design was informed by
[dsh-memory](https://github.com/haitang1/dsh-memory),
[Mem0](https://github.com/mem0ai/mem0) and
[Letta](https://docs.letta.com/v1-sdk/concepts/stateful-agents).
Those projects are references, not runtime dependencies. DSH Brain is an
independent implementation; no code from those projects is included.

DeepSeek Harness and other third-party names belong to their respective owners.
This project is not affiliated with or endorsed by DeepSeek.
