# DSH Brain

[![CI](https://github.com/yulianjie/dsh-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/yulianjie/dsh-brain/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**简体中文** | [English](README.en.md)

给 DeepSeek Harness Desktop 增加本地长期记忆与逐步调整的交流风格。普通聊天结束后，插件从本轮用户发言中提取持久信息；后续会话根据当前工作区和问题检索这些信息。这里的“性格”是可查看、冻结、重置和回退的语言行为偏好，不代表意识或真实情感。

这是独立的社区插件，非 DeepSeek 官方产品。项目处于 0.x 阶段，宿主预发布 API 可能变化。

## 功能一览

- **跨会话记忆**：全局偏好与工作区事实分开检索，支持中英文、纠正合并及删除去重。
- **有证据的自动学习**：只处理已完成根轮次的用户文本，限制模型调用、超时与后台队列。
- **可控交流风格**：五维渐进调整，以及自动、手动、关闭模式；支持冻结、历史和回退。
- **原生配置与管理**：Desktop 中的 23 项设置、`/brain` 命令、六个模型工具和本地 CLI。
- **可检查的本地存储**：JSON、原子替换、并发锁、导入导出；无独立数据库服务。

自动提取和召回仍会使用宿主模型上下文；“本地存储”不等于“完全离线”。详见[数据边界](#数据边界与限制)。

## 文档导航

[安装](#安装与卸载) · [命令](#日常使用) · [配置](#配置与存储) · [故障排查](docs/TROUBLESHOOTING.md) · [架构](docs/DESIGN.zh-CN.md) · [机制拆解与外部对照](docs/ARCH-BENCHMARK.zh-CN.md) · [验证记录](docs/VALIDATION.zh-CN.md) · [更新日志](CHANGELOG.md) · [贡献](CONTRIBUTING.md) · [安全政策](SECURITY.md)

## 兼容性

当前版本 `0.4.1`，按 Windows Desktop **bundled runtime 0.2.1-rc.3** 的实际 API 实现。JavaScript ESM 核心使用 Node 内建模块；原生配置 schema 依赖 `@deepseek-ai/schemastery`。管理 CLI 需要 Node.js 22 或以上；插件由 Desktop 自带的 Node 运行。不保证其他版本的宿主接口兼容。

| 层级 | 支持与验证范围 |
| --- | --- |
| 核心与 CLI | Node.js 22+；CI 覆盖 Node 22/24 与 Windows、Linux、macOS |
| Desktop 插件与原生设置 | Windows bundled runtime 0.2.1-rc.3；其他宿主版本需重新验证 |
| 安装/卸载脚本 | Windows PowerShell，使用 Desktop 自带 CLI |
| 设置界面与 CLI 帮助 | 当前为中文；提供英文入门文档 |

## 安装与卸载

正式包名为 **`@yulianjie/dsh-brain`**。npm 上不带 scope 的 `dsh-brain` 属于其他项目，请勿混用。前提：目标版本 DeepSeek Harness Desktop；独立管理 CLI 需要 Node.js 22+。已有本项目 0.1.0/0.2.0 本地包时，先按下方迁移说明移除旧包。

### 从 npm 安装（推荐）

在 PowerShell 中调用 Desktop 自带 CLI；不要使用全局 npm 安装的其他版本 DSH：

```powershell
$dshCli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dshCli plugin --profile desktop add '@yulianjie/dsh-brain@0.4.1'
```

只安装独立管理 CLI 时使用 `npm.cmd install -g @yulianjie/dsh-brain@0.4.1`，然后运行 `dsh-brain --help`。全局安装 CLI 不会自动把插件加入 Desktop profile。

### 从 GitHub Release 安装

从 [v0.4.1 Release](https://github.com/yulianjie/dsh-brain/releases/tag/v0.4.1) 下载 `yulianjie-dsh-brain-0.4.1.tgz` 和 `SHA256SUMS.txt`，放到同一目录，校验后安装：

```powershell
$expected = ((Get-Content .\SHA256SUMS.txt -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash .\yulianjie-dsh-brain-0.4.1.tgz -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA256 mismatch' }
tar -xf .\yulianjie-dsh-brain-0.4.1.tgz
.\package\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.4.1.tgz
```

安装仍需下载 npm 依赖；tarball 未内置 `node_modules`。

### 从源码安装

另需 Git、Node.js 22+ 与 npm。源码无需编译：

```powershell
git clone https://github.com/yulianjie/dsh-brain.git
cd dsh-brain
npm.cmd ci
npm.cmd run verify
npm.cmd pack
.\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.4.1.tgz
```

重启 Desktop 后，在插件列表确认 `@yulianjie/dsh-brain`，再用 `/brain status` 检查状态。可以先用 `/brain remember global 我喜欢中文回答` 保存一条明确偏好，并通过 `/brain list global` 查看。

脚本默认调用 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，执行宿主支持的 `dsh plugin --profile desktop add <tarball>`。没有传 `-PackagePath` 时先在源码目录运行 `npm pack`。安装后重启 Desktop，插件随 profile 加载；脚本不会结束正在运行的 Desktop 进程。

先查看将执行的操作，或在独立环境验证：

```powershell
.\scripts\install.ps1 -DryRun
.\scripts\install.ps1 -PackagePath .\yulianjie-dsh-brain-0.4.1.tgz -DshHome "$env:TEMP\dsh-brain-demo" -Profile brain-test
.\scripts\uninstall.ps1 -DshHome "$env:TEMP\dsh-brain-demo" -Profile brain-test
```

非默认安装位置用 `-DshCli <完整路径>`；`-Profile` 默认 `desktop`。脚本通过包管理接口维护依赖，不手工覆盖 profile YAML。隔离 profile 的安装成功只说明包可安装，不代表已经在真实 Desktop 窗口中加载。

卸载插件：

```powershell
.\scripts\uninstall.ps1
```

从 Release 解压安装时，脚本路径为 `.\package\scripts\uninstall.ps1`；也可以调用 `& $dshCli plugin --profile desktop remove '@yulianjie/dsh-brain'`。

卸载保留记忆文件。需要彻底移除数据时，先导出并确认实际 `dataDir`，关闭使用该存储的实例后，再自行删除对应目录。

### 从旧本地包迁移

本项目旧本地包的名称为 `dsh-brain`。先导出记忆备份并保留现有 profile 配置，再使用 Desktop 自带 CLI 对同一个 profile 执行 `plugin --profile desktop remove dsh-brain`，之后安装 scoped 包并正常重启 Desktop。不要从 npm 安装旧的不带 scope 的名称。安装脚本发现旧依赖时会停止，避免两个 bundle 争用 `id: brain`。

本版本保持 `id: brain`、默认数据路径与 schemaVersion=1；保持相同 `DSH_HOME` / `dataDir` 即可继续使用原有记忆、风格与历史。自定义 `id: brain` 配置覆盖应保留。迁移不会自动删除旧数据，也不会自动停止 Desktop。

## 日常使用

可以直接说“请记住：我喜欢中文回答”“本项目使用 Rust”，也可以用明确命令管理。自动提取只处理已完成的根 agent 轮次中的用户文本，不把助手回答、工具输出或子 agent 发言作为用户偏好证据。它不会扫描已有聊天历史，也不会导入其他 agent 的记忆。

可用 `/brain` 命令：

| 命令 | 用途 |
| --- | --- |
| `/brain help` | 查看用法 |
| `/brain status` | 存储状态、学习队列统计 |
| `/brain list` | 全局与当前工作区记忆 |
| `/brain list global` / `/brain list workspace` | 按范围查看 |
| `/brain search 关键词` | 检索记忆 |
| `/brain remember global 我喜欢中文回答` | 明确保存全局偏好 |
| `/brain remember workspace 本项目使用 Rust` | 保存当前工作区事实 |
| `/brain forget <id>` | 遗忘指定记忆 |
| `/brain personality` | 查看维度、冻结状态和证据计数 |
| `/brain personality verbosity=0.2 warmth=0.6` | 立即人工设置风格 |
| `/brain freeze` / `/brain unfreeze` | 暂停/恢复自动风格调整 |
| `/brain reset` | 重置风格到中性值 |
| `/brain history` | 查看有限变更历史 |
| `/brain rollback <version>` | 回退到已有历史版本 |

`remember` 省略范围时，有会话工作区则使用 `workspace`，否则使用 `global`。模型也可调用 `brain_search`、`brain_list`、`brain_read`、`brain_remember`、`brain_forget`、`brain_personality` 六个工具。导入导出和破坏性风格控制由用户命令或本地 CLI 执行。

范围边界：全局偏好可用于所有项目；工作区事实仅提供给路径相同的会话。工作区由宿主会话 cwd 获取，不使用插件进程的 cwd 猜测。它按目录路径隔离，工作区改名或迁移后需要重新整理记录。

## 全局记忆与按需读取

全局指同一 `DSH_HOME` / `dataDir` 内跨会话、跨工作区共享，不代表云同步或跨用户共享。使用 `/brain remember global 我喜欢中文回答` 明确保存；工作区事实使用 `/brain remember workspace 本项目使用 Rust`。自动提取和模型工具会识别明确的个人偏好与项目限定；显式工具 `scope` 优先。命令省略范围时仍沿用当前工作区默认。

自动上下文先选少量全局 `preference` / `instruction`，使语言等偏好在无关键词重合时仍可用，再检索全局事实与当前工作区内容。最多 3 条常驻候选且不超过总条数预算的约三分之一；无关全局偏好最多使用约三分之一的估算 Token 预算。长记录提供最多 400 个 Unicode 码点的预览，可按 ID 取全文。更多偏好仍可通过工具检索，并非全部常驻。

- `brain_list` / `brain_search` 支持 `scope`、`limit`（1..20，默认 10）、`cursor`，返回 `{records,total,nextCursor}`。预览的 `truncated:true` 表示正文尚未完整读取。
- `brain_read({id,cursor?})` 返回 `{id,scope,text,nextCursor}`，逐页拼接 `text` 可获得原文。工作区权限对全文读取同样生效。
- 可见结果内容或顺序变化后游标会失效；普通聊天计数与性格变化不影响分页；收到 stale cursor 错误时重新从第一页读取。游标不能跨查询或工作区复用。
- `/brain status` 显示预算和本插件进程最近一次生成的上下文用量；本地 CLI/list/export 保持完整输出。

这些限制约束自动参考消息与单次工具结果，不能限制整段对话、其他插件或累计工具历史。查询变化时替换较早消息可能降低提示词前缀缓存命中率。完整调研、权衡和验证见[记忆与性格改进评估](docs/MEMORY-CONTEXT-REVIEW.zh-CN.md)。

## 风格如何变化

五个维度均为 `0..1`，默认 `0.5`：

| 维度 | 较高值表示 |
| --- | --- |
| `warmth` | 更亲切温暖 |
| `verbosity` | 更详细 |
| `humor` | 更常使用幽默 |
| `proactivity` | 更主动提供建议 |
| `formality` | 更正式 |

同一维度最近最多 5 次有效反馈中，至少 **3 个独立轮次且不少于 75%** 支持同一方向，最新反馈也同向，才自动变化；每轮变化不超过 `0.05`，距离目标不超过 `0.05` 时停止微调。矛盾反馈不取平均后继续漂移；项目专属或临时风格要求不改变全局性格。重复事件不会重复计数；冻结期间不积攒稍后突然生效的漂移。人工设置立即生效，历史最多保留 100 条，每维度反馈证据最多保留 20 条。不能根据人口学信息推断交流风格。

模型提取支持有用户原文证据的明确风格反馈，包括固定表达之外的语义反馈。本地兜底只识别有限的中英文表达，例如“以后回答简洁一点”“回复可以更温暖”“不要开玩笑”，可能漏掉同义表达。本地规则只在提取模型不可用（超时、出错、输出无法解析）时用于学习风格；模型正常返回时，风格只按模型给出的、带用户原文证据的反馈学习。自动学习的全局风格反馈可以在列表中查看，但不会作为立即生效的偏好原句注入，避免绕过逐步变化和冻结控制。

## 本地管理 CLI

源码目录使用 `node .\bin\brain.mjs`；npm 全局安装本 tarball 后可以使用 `dsh-brain`。除帮助外，成功结果输出 JSON，错误输出到 stderr 并返回非零退出码。

```powershell
node .\bin\brain.mjs status
node .\bin\brain.mjs remember "我喜欢简洁中文" --scope global
node .\bin\brain.mjs remember "项目使用 Rust" --scope workspace --workspace C:\work\demo
node .\bin\brain.mjs list --workspace C:\work\demo
node .\bin\brain.mjs search Rust --workspace C:\work\demo --limit 10
node .\bin\brain.mjs update <id> "项目使用 Rust 2024" --workspace C:\work\demo
node .\bin\brain.mjs forget <id> --workspace C:\work\demo
node .\bin\brain.mjs personality set verbosity 0.2
node .\bin\brain.mjs freeze
node .\bin\brain.mjs history
node .\bin\brain.mjs rollback <version>
node .\bin\brain.mjs export .\brain-backup.json
node .\bin\brain.mjs import .\brain-backup.json
```

CLI 默认写入全局记忆；使用 `--scope workspace` 必须同时传 `--workspace`。`list/search/update/forget` 不传工作区时，只访问全局记录。`remember` 支持 `--kind` 和用于纠正合并的 `--key`。`export` 输出完整存储，包括所有工作区、删除标记和风格历史，文件已存在时需传 `--force` 才覆盖。**导出文件包含私人记忆，应自行保管。** `import` 校验 schema 后合并记忆与删除/去重标记，保留当前风格，不直接用备份替换风格状态。删除标记会阻止旧备份复活已忘记的内容。遗忘风格记忆时，也会清理活动证据及历史中匹配的原文；已形成的风格数值会保留，可另用重置或人工设置调整。

任意命令可加 `--data-dir <目录>` 访问独立存储；这必须与插件的 `dataDir` 一致才能管理同一份数据。例如：

```powershell
node .\bin\brain.mjs --data-dir "$env:TEMP\brain-sandbox" remember "合成测试偏好"
```

## 配置与存储

安装后进入 Desktop 的“插件 → 已安装 → @yulianjie/dsh-brain”，在插件详情页直接调整原生配置表单。插件行详情也提供同一表单。23 个常用设置分为“学习与注入”“交流风格”“手动交流风格”“提取模型”“后台限制”“存储与上下文”六组，使用宿主设置服务保存到当前 profile，不需要另开网页。

修改先保存在表单草稿中，点击“保存”后生效；保存中禁用编辑，非法数值和不完整模型路由会禁用保存。每项带说明和默认值恢复入口，保存失败保留草稿供修正；离开表单会丢弃未保存草稿。已接受的设置由宿主持久化，下次启动继续使用。

“交流风格模式”有三个选项：

| 模式 | 行为 |
| --- | --- |
| 自动演进（`adaptive`） | 使用已学习的风格；是否继续学习还受风格学习开关、自动学习总开关及 `/brain freeze` 控制 |
| 手动指定（`manual`） | 使用五个手动维度值作为注入覆盖，暂停自动风格学习；不会改写已学习风格或其历史 |
| 关闭（`off`） | 不注入交流风格，也不学习新的风格反馈；已有风格保留 |

手动维度只在“手动指定”时可编辑。“注入长期记忆”“注入交流风格”和“学习交流风格反馈”分别控制检索注入与学习；关闭学习不删除已有记忆。模型服务商和模型 ID 必须同时填写，或同时留空跟随当前会话；这里只填写宿主已有的路由 ID，不填写认证信息。

设置保存后作用于后续请求。关闭自动学习会取消等待及进行中的后台提取；已经进入原子提交的写入不会被回滚。切换风格模式或学习开关时，旧任务不会在稍后重新作用于风格。

默认存储为 `$DSH_HOME/brain/brain.json`，未设置 `DSH_HOME` 时为 `~/.dsh/brain/brain.json`。不同 profile 若使用同一个 `DSH_HOME` 和默认目录，将共享同一份全局偏好与风格；工作区记录仍按路径隔离。需要不同身份时，为各 profile 配置不同 `dataDir`。

插件采用 JSON 原子替换和独立写锁目录 `.brain.lock`，跨进程修改在锁内重新读取并合并。遇到损坏 JSON、未知 schema 或非法数据会报错并保留原文件。写入锁等待默认 15 秒；同机崩溃残留的 `.brain.lock` 会在确认原进程已退出后自动接管，其他情况（不同主机、缺少 `host` 的旧锁、仍在运行的写入者）仍需确认写入者退出后手动移除 `.brain.lock`（如存在 `.brain.lock.takeover` 也一并处理）。存储不是加密数据库，文件权限仍由系统和用户账户决定。

`dataDir` 属于结构性高级设置，不在图形表单中暴露。需要它或其他配置文件 override 时，可在对应 profile 现有的 `cordis.patch.yml` 数组中追加针对 `id: brain` 的条目。例如禁用自动学习：

```yaml
- id: brain
  config:
    autoLearn: false
```

请保留文件中已有条目；初始文件若只有 `[]`，将其替换为上述数组即可。该宿主按行替换整个 `config`，因此同一条目中应列出所有需要保留的自定义值。直接修改文件后重启 profile。原生表单管理的常用键如下：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | 上述默认目录 | 独立存储目录 |
| `autoLearn` | `true` | 是否监听聊天并自动学习；设 `false` 仍可手动管理和注入 |
| `injectMemories` | `true` | 是否注入相关长期记忆 |
| `injectPersonality` | `true` | 是否注入当前模式下的交流风格 |
| `personalityMode` | `adaptive` | `adaptive`、`manual`、`off` |
| `personalityLearningEnabled` | `true` | 是否在 adaptive 模式继续学习明确风格反馈 |
| `manualWarmth` / `manualVerbosity` / `manualHumor` / `manualProactivity` / `manualFormality` | 各 `0.5` | manual 模式的五个覆盖值，范围 0..1，步进 0.05 |
| `extractionProvider` / `extractionModel` | 当前会话路由 | 经已有宿主 llm 服务提取，不另读认证文件 |
| `extractionMaxTokens` | `1800` | 提取模型输出 Token 上限，范围 128..8192 |
| `extractionTimeoutMs` | `15000` | 单次模型提取超时，范围 10..120000 |
| `extractionMaxChars` | `8000` | 本轮用户文本字符上限，范围 100..50000 |
| `extractionMaxQueue` | `16` | 后台等待队列上限，范围 1..128 |
| `maxMemories` | `500` | 总记忆条数上限，范围 1..100000；降低不会删除已有记录 |
| `maxContextChars` | `6000` | 注入上下文总字符上限，含说明与风格，范围 0..50000 |
| `maxContextTokens` | `2000` | 注入估算 Token 上限，范围 0..16000；0 停止注入，不是模型精确 token 数 |
| `maxToolResultChars` | `6000` | 模型记忆工具每页字符上限，范围 512..50000 |
| `maxToolResultTokens` | `2000` | 模型记忆工具每页估算 Token 上限，范围 128..16000 |
| `maxContextMemories` | `10` | 每次注入记忆条数上限，范围 0..100 |
| `lockTimeoutMs` | `15000` | 写锁等待时间，范围 0..120000 毫秒 |

后台同时最多一个模型提取调用，每轮最多调用一次；队列满时丢弃新增任务，不无限重试。超时后使用中英文明确偏好的本地兜底提取；若 provider 忽略取消信号，其调用未结束前不会开启另一个模型调用。自动提取可能使用当前已配置模型并产生费用；关闭 `autoLearn` 可停用。没有模型路由时，只进行明确偏好与“请记住”的保守本地提取。

## 数据边界与限制

记忆作为独立的低优先级参考消息注入，文本不经过模板插值，当前用户指令优先。每个模型请求最多保留一个当前 Brain 快照，通过宿主持久化 surface replacement 更新；磁盘事件历史保留原文。升级时只清理旧共享快照中的 Brain 命名分节，其他插件内容保留。系统同时限制条数、字符和估算 Token；检索使用英文词和中文字二元组，不是向量数据库。自动提取要求逐字用户证据，持久化证据原句，避免把模型改写中的猜测存为事实。

明显的 API key、Bearer token、密码赋值、私钥和含密码 URL 会被过滤；这是启发式过滤，不能识别所有秘密。不要主动要求插件记住敏感凭据。插件不会上传独立记忆库，但自动提取通过当前宿主模型处理本轮用户文本，后续被召回的记忆也会进入宿主正常模型上下文。

记忆与风格只是给模型的参考，不能保证模型每次严格照做。启发式检索和偏好识别仍可能漏召回或误判；可通过列表、修改、遗忘、冻结及关闭学习控制。

## 开发与验证

```powershell
npm.cmd ci
npm.cmd run verify
npm.cmd run test:runtime
```

`verify` 依次检查 JavaScript 语法、本地 Markdown 文件链接和元数据一致性，执行全部单元测试，再实际打包、在临时目录安装、导入插件并验证 CLI 持久化。`pack:check` 需要访问依赖源，使用合成数据；不会安装到日常 Desktop profile。GitHub CI 在三个系统的 Node 22/24 上执行相同检查。真实 Desktop runtime smoke 是需要本地宿主的独立检查，不在通用 CI 中运行。

测试使用临时目录和合成对话，不初始化用户现有聊天或其他 agent 的记忆。客户端测试覆盖宿主 schema 字段、数值和模型路由校验、只读保护、原生详情页 slot 注册与模式控件；其中原生表单组件使用边界替身，不能代替实际窗口验收。`test:runtime` 在 Windows 上通过 Desktop 的 Electron Node 模式读取实际 app.asar 中的代码，加载真实 Cordis、agent loop、systemPrompt、tools、commands、llm、session 和 workingDirectory 服务；可用 `DSH_DESKTOP_EXE` 指定其他安装路径。该 smoke 使用可控合成 provider，不读取用户 profile 或认证，不调用网络模型。单元测试、真实 bundled runtime 服务 smoke、真实网络模型效果、原生 Desktop 窗口验收是不同层级；具体本次执行结果见 [验证记录](docs/VALIDATION.zh-CN.md)。

源码结构与数据流见[设计文档](docs/DESIGN.zh-CN.md)。如需报告问题或提交修改，请阅读[贡献指南](CONTRIBUTING.md)与[社区行为准则](CODE_OF_CONDUCT.md)；安全漏洞使用[私密报告渠道](SECURITY.md)。发布步骤见[发布检查清单](docs/RELEASING.md)。

## 许可证与致谢

本项目使用 [Apache License 2.0](LICENSE)，版权声明见 [NOTICE](NOTICE)。依赖保留各自许可证，详见[依赖与致谢](docs/DEPENDENCIES.md)。

感谢 DeepSeek Harness 的插件基础设施。本项目参考了 dsh-memory、Mem0 和 Letta 的记忆/状态组织思路，采用独立实现，未复制其源码；不代表这些项目或 DeepSeek 的官方立场。
