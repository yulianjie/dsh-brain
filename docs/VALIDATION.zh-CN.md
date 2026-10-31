# DSH Brain 验证记录

## v0.5.0：写时去重与价值门槛（2026-10-31）

main 合入后、发布前的验证记录。开发环境为 Windows 11、Node.js 24.14.1；CI 为 GitHub Actions 托管运行器（Windows/Linux/macOS × Node 22/24）。测试使用临时合成目录，没有读取或改动日常 desktop profile 与已有长期记忆。

- `npm run verify`：语法、文档链接、包元数据检查，214 项测试及 tarball 干净安装检查通过，含 23 项新增回归测试（dedup 16 项、gate 7 项）。CI 在 main 头提交（f9a9c54）六个矩阵任务全部通过（2026-10-31）。
- 实现与验证分工：实现与独立对抗验证由两个互不共享上下文的子 agent 完成。对抗验证覆盖：守门误杀/漏放探针（英文 CI/test 词汇带存在系统性误杀面，确认为保守锚定设计的既定取舍；完成态「了」后缀与英文词形漏放据此收紧）；合并信息丢失探针（canonical key 碰撞零词项重叠防护由该轮结论加入）；「船长/水手虫虫/gh」三组实测数据端到端重放；文档与代码一致性逐项核对（唯一必修项为 CHANGELOG 与正则的措辞不一致，已按收紧方向修复）。Lead 复审全量 diff 并亲测两轮 `npm run verify`。
- 三组实测重放结论：model-tool 富文本 + 模型提取（跨 key 命名风格）+ fallback 逐字复述收敛为一条并保留富文本；语义级转述在模型缺席时可能低于一切确定性阈值（实测 Jaccard 0.065）而并存——已记入设计文档「已知边界」。
- 未重新执行 Desktop bundled runtime 冒烟与原生窗口验收：本版本只改 lib 层写入/提取路径与文档，`lib/index.js` 仅扩展提取 prompt、注入只读既有记忆上下文并扩展工具返回字段，0.4.0 的运行时记录仍适用。

验证边界：没有真实网络模型验收（updateOf 协议与 EXISTING 上下文仅在合成流下验证）；没有在其他宿主版本上验证。

## v0.4.1：Windows 锁争用与改名重试（2026-10-31）

修复在 main 合入后、发布前的验证记录。开发环境为 Windows 11、Node.js 24.14.1；CI 为 GitHub Actions 托管运行器（Windows/Linux/macOS × Node 22/24）。测试使用临时合成目录，没有读取或改动日常 desktop profile 与已有长期记忆。

- `npm run verify`：语法、文档链接、包元数据检查，191 项测试及 tarball 干净安装检查通过（含两项修复的回归测试）。CI 在 main 头提交（bae6919）六个矩阵任务全部通过（2026-10-31）。
- 回归测试共 12 项：改名重试 5 项（瞬时 `EPERM` 突发重试、永久失败浮现原始错误、非瞬时错误码不重试、非 Windows 不重试、abort 中止保留原存储）；锁争用 7 项（`EPERM`/`EBUSY` 按争用有界等待、不可创建的锁目录报路径、旧 `EPERM` 不污染后续 `EEXIST` 超时判断、`fs.rm` 有界重试解锁、已存在目录报 "locked"、接管清理失败不中断写入、争用状态按最近失败重置）。
- 发布自动化：`v0.4.1` tag 触发 `.github/workflows/release.yml`，发布前重新执行同一 `npm run verify`，单一 `npm pack` 出包，GitHub Release 与 npm 使用同一 tarball，发布后回读 registry 比对 SHA256。
- 未重新执行 Desktop bundled runtime 冒烟与原生窗口验收：本版本只改 `lib/core.js` 写入路径与发布基础设施，0.4.0 的运行时记录仍适用。

验证边界：没有真实网络模型验收；没有在其他宿主版本上验证。

## v0.4.0：风格文本化、dream 规划与风格学习加固（2026-10-30）

测试环境为 Windows 11、Node.js 24.14.1、Desktop bundled agent-loop 0.2.1-rc.3 / Cordis 4.0.5。所有验证使用临时合成目录，没有读取或改动日常 desktop profile 与已有长期记忆。

- `npm run verify`（干净检出）：语法、文档链接、包元数据检查，179 项测试及 tarball 干净安装检查通过。
- `node scripts/runtime-smoke.mjs`：加载实际 app.asar 中的 227 个运行时包，模型使用合成 provider。30 轮长会话每轮最多 1 个当前 Brain 参考（样本最大 547 字符），严格持久化恢复、压缩后恢复、旧共享快照迁移、关闭注入后清除、宿主 token 统计一致；23 项原生设置保存、重启恢复和已学风格保留通过。新会话的参考包含当前风格说明，不包含风格原句。
- 独立 `DSH_HOME` / profile：用 Desktop 自带 CLI 安装发布包，设置 `DSH_BRAIN_PACKAGE_DIR` 指向已安装的包重跑运行时冒烟，然后卸载。
- 风格规则：20 句否定、弱化和客气说法逐句验证本地规则方向与端到端存储；模型返回空结果时普通请求不产生风格证据；模型不可用时本地规则仍兜底；同一句中的事实在模型已给出风格反馈时正常注入。另用 174 句中英文语料核对本地规则：读反 0 句，误学 1 句（同一轮里先要求简短、又要求复杂问题详细的混合句）。
- 写锁：同机已退出进程留下的锁可接管，并发接管不丢更新；其他主机、缺少 `host` 的旧锁、仍在运行的写入者保持等待超时；删除失败时在超时后报错，不空转。
- 本地规则对长输入的处理时间：174 句中单句最慢约 8 ms，15,000 字符的输入约 30 ms。

验证边界：没有真实网络模型验收，也没有长期风格遵循率测试；原生设置界面代码未改动，本版本未重新操作原生窗口；没有其他宿主版本的兼容性结论。

## v0.3.1：首次参考写入顺序与严格磁盘恢复

v0.3.0 的最终 Desktop 完整重启验收发现 `system/message requires a protected first surface head`，因此撤回推荐。原有 `new Session(...)` 内存重放断言没有覆盖持久化格式的跨事件关系校验，不能等同于磁盘恢复验收。

修复：初始参考通过 `agent/pre-step` 返回消息队列，在宿主写入系统头之后提交；`agent/request` 对空 surface 延后，对已有会话只更新受保护系统头之后的参考。新增两项生命周期单测，总计 69 项；运行时每轮都使用真实 sessionFormatCatalog 严格编码/恢复，并验证模拟旧顺序会被拒绝。

本次生成的两段合成验收会话在独立备份后修复首对事件顺序和对应引用，严格恢复通过，用户/助手/工具正文保持不变；没有改写原有长期记忆或配置。

修正版的第三段真实新会话调用 brain_list / brain_personality 成功，正常退出 Desktop 全部进程后重启，原生窗口成功恢复 `BRAIN_RESTART_031_OK` 历史，未出现加载错误。修复的两段旧验收会话也重新可见并通过原生历史读取。


## v0.3.0：记忆与性格上下文改进（2026-10-27）

当前源码版本为 0.3.0；功能代码已安装到日常 desktop profile，并完成原生设置与真实聊天验收。测试环境为 Windows、Node.js 24.14.1、Desktop bundled agent-loop 0.2.1-rc.3 / Cordis 4.0.5。调研与设计评估见[记忆与性格改进评估](MEMORY-CONTEXT-REVIEW.zh-CN.md)。

- `npm run verify`：语法、文档链接与包元数据检查，67 项测试及 tarball 干净安装检查通过。v0.3.0 tarball 包含 28 个文件，新增预算及上下文模块可正常导入；CLI 使用临时合成目录。
- `node scripts/runtime-smoke.mjs`：加载实际 app.asar 中的 227 个运行时包，包括 tokenMeter；模型使用合成 provider，不读取用户 profile 或调用网络模型。
- 30 轮真实 agent-loop 请求：每次只有 **1 个当前 Brain 参考消息**，该样本最大 **774 字符**；证据计数变化不重写参考内容。其他普通聊天消息仍正常累积。
- 真实宿主验证：全局偏好跨工作区召回、工作区切换后的当前参考隔离、旧共享快照只清理 Brain 分节、持久会话重放、压缩移除参考后恢复、重复参考收敛为一份、关闭注入后清除旧内容。
- tokenMeter 测量与宿主 contextBreakdown 投影统计一致，验证相邻替换计量事件；原生设置服务覆盖 23 项、volatile 更新、重启恢复和已有性格状态保留。
- 500 条长合成记忆：完整分页遍历、不重复 ID、输出字符和估算 token 双限、中文/emoji/转义正文无损读取。最小工具预算仍可前进；跨范围、查询、工作区及结果变更后的旧游标拒绝使用；普通聊天计数和性格变化不中断分页。
- 性格评估：24 次交替矛盾反馈保持中性；一致反馈按每次最多 0.05 收敛；单次反向反馈不延续旧方向；冻结/manual/off、临时/项目反馈、普通聊天不产生全局漂移。

真实聊天验收（Asia/Singapore 2026-10-27）：当前 DeepSeek-V4.1-Flash 完成 brain_list、brain_search、brain_remember、brain_read、brain_personality；第二个新会话读回合成全局校验码。通过本地管理清理唯一合成记录，再由真实模型调用 brain_forget 确认 forgotten=false、brain_search 确认 total=0。临时要求简短回答后，五个性格数值仍为原值，风格证据仍为零。验收前后原有 memories/personality/history 逐字段一致，cordis.yml 与 cordis.patch.yml 的 SHA256 一致；仅增加四个正常轮次去重记录和两个合成记录删除标记。原生页面显示 23 项设置、一个 brain 组件运行中。

验证边界：没有真实网络模型长期风格遵循率测试或其他宿主版本兼容性结论。自动参考的预算不包含其他插件、对话历史或累计工具结果，估算 token 不代表模型精确计费。

## v0.2.1 发布候选验证（2026-10-27）

- 包身份改为 `@yulianjie/dsh-brain@0.2.1`；服务器 bundle、客户端模块 ID、原生配置插槽和卸载目标一致，CLI 仍为 `dsh-brain`。
- `npm run verify`：59/59 行为测试通过；实际 scoped tarball 的临时安装、插件导入和 CLI 持久化通过。
- 在独立 `DSH_HOME` / `release-check` profile 使用 Desktop bundled CLI 安装 tarball；组合配置包含 scoped 插件，profile 保留基础 bundle。
- 设置 `DSH_BRAIN_PACKAGE_DIR` 指向该 profile 的已安装包，真实 bundled runtime 0.2.1-rc.3 smoke 通过；验证 scoped loader 解析、客户端模块 ID、20 项原生设置、保存/重启、跨会话召回和工作区隔离。
- 从旧本地 0.2.0 tarball 迁移：安装脚本阻止两种名称共存；移除旧包再安装 scoped 包后，`maxContextMemories: 7` 合成覆盖保留，合成记忆、风格和冻结状态文件 SHA256 完全不变。
- 卸载 scoped 包后，合成记忆文件 SHA256 不变，基础 bundle 保留，插件 bundle 移除。

所有安装验证均使用独立合成目录，未变更日常 Desktop profile。本版本未重新操作原生窗口、未调用真实网络模型。最终 CI、公开附件下载校验与 npm 发布后验证结果见 [v0.2.1 Release](https://github.com/yulianjie/dsh-brain/releases/tag/v0.2.1)。

## 开源整理复验（2026-10-27）

环境：Windows、Node.js v24.14.1、npm 11.14.0、Desktop bundled runtime 0.2.1-rc.3。

- `npm ci`：按锁文件安装成功，依赖审计当时报告 0 个已知漏洞；这不是不存在漏洞的保证。
- `npm run verify`：语法、本地 Markdown 文件链接与包元数据检查通过；59/59 测试通过，0 失败、0 跳过。
- `pack:check`：实际生成包含 23 个文件的 tarball，在临时目录安装依赖，成功导入插件并验证 CLI 跨进程保存和读取合成记录；校验 Apache-2.0 许可与 NOTICE，未使用用户数据目录。
- `npm run test:runtime`：真实 Cordis 4.0.5 / agent-loop 0.2.1-rc.3 服务 smoke 通过；226 个运行时代码包、4052 个文件仅用于临时验证，未进入仓库或安装包。
- 设置命名空间、20 项表单字段、volatile 更新、无效路由拒绝、配置重启恢复、已有风格保留、跨会话召回与工作区隔离全部通过。

本次整理没有重新操作原生 Desktop 窗口，也没有调用联网模型。下方原生窗口记录属于此前同版本验收。GitHub CI 的 Windows/Linux/macOS 与 Node 22/24 结果以[对应提交的 workflow](https://github.com/yulianjie/dsh-brain/actions/workflows/ci.yml)为准；CI 不运行原生 Desktop。

## v0.2.0 原生插件配置（2026-10-27）

执行 `npm test`：**59/59 通过，0 失败、0 跳过**。新增原生客户端分组/校验/插槽测试，真实 volatile 引用更新、模型路由成对校验、旧轮次失效与在途取消测试，以及核心设置策略不覆盖学习状态的测试。

`npm run test:runtime` 通过，使用实际 Desktop app.asar 的 226 个代码包、4052 个文件（Cordis 4.0.5，agent-loop 0.2.1-rc.3）。在临时合成 profile 中运行真实 appBoot、Loader、Include、SettingsForms 与 ConfigEditor：

- `brain` 设置命名空间提供 20 个可编辑字段，结构性 `dataDir` 不在表单中。
- `settings.mutate` 实际原子保存 YAML，并通过 volatile 更新即时修改注入与手动风格策略，保持插件实例。
- 只填写服务商、不填写模型的无效组合在持久化前被拒绝。
- 完整宿主重启后恢复配置；修改设置前后已有学习数据文件逐字节一致，已学习的 verbosity=0.45 与人工冻结状态保留。
- 原有聊天、自动记忆、工具与工作区隔离回归全部通过。

新增输出标记为 `actualSettingsAPI`、`actualConfigEditor`、`actualLoaderVolatileUpdate`、`invalidPairRejectedBeforePersistence`、`settingsPersistedRestart`、`learnedPersonalityPreserved`，均为 true；`editableFields` 为 20。

### 原生 Desktop 窗口验收

此前在 Windows Desktop 原生窗口中完成：

1. 将日常 `desktop` profile 从 0.1.0 升级为 0.2.0，通过应用菜单正常退出并重新打开。
2. 在“插件 → dsh-brain”详情页看到 20 项原生配置和六个中文分组；自动模式下手动风格输入框禁用，模式选项显示中文。
3. 将“单次注入记忆条数上限”由 10 改为 11，点击保存；宿主 `cordis.patch.yml` 实际保存 `maxContextMemories: 11`。
4. 返回插件列表，再次进入详情页，输入框仍为 11。
5. 恢复 10，并通过“恢复默认 → 保存”移除测试覆盖值；最终 profile 中没有残留 `maxContextMemories` 测试项。
6. 对比升级前保存的哈希，现有 `brain.json` 完全未变；未修改原有记忆或性格数据。

安装前 profile 配置已备份到工作区忽略的 `artifacts/settings-upgrade-backup-*`。本次不调用联网模型生成。设置修改会同步取消尚未提交的后台学习；已经发出原子重命名的提交不能回滚，不声称保存瞬间之后绝无旧提交落盘。

后续完整方案与 v0.1.0 历史验证如下。

## v0.1.0 初始交付（历史记录）

日期：2026-10-26。平台：Windows，Node.js v24.14.1。本文件记录开发验收范围，不能替代其他版本宿主的兼容性验证。

## 验证结果

当时执行 `npm test`：**41/41 通过，0 失败、0 跳过**。

当时执行 `npm run test:runtime`：通过。脚本使用 Electron Node 模式，从本机 Desktop `resources/app.asar/dsh/node_modules` 提取 47 个代码包、890 个文件到临时目录，结束后清理。运行时版本为 **agent-loop 0.2.1-rc.3 / Cordis 4.0.5**；没有使用 npm-global rc.2 替代验证。

真实宿主测试输出：

```json
{"ok":true,"actualCordis":true,"exportedPluginMounted":true,"actualAgentLoop":true,"actualWorkingDirectory":true,"nativeTools":5,"nativeCommands":true,"automaticFactExtraction":true,"crossSessionRecall":true,"workspaceIsolation":true,"cwdChanges":true,"gradualPersonality":true,"persistedRestart":true,"calls":10,"extractions":5}
```

其中模型 provider 与文件系统 transport 使用可控测试替身；Cordis、agent loop、session、session projection、workingDirectory、LLM registry、prompt、tools、commands 使用实际 bundled 代码。测试驱动 5 轮合成聊天，验证 3 轮明确风格反馈使 verbosity 从 0.50 调整至 0.45，并确认自动学到的项目事实进入新会话的真实模型请求。

## 需求与证据

| 需求 | 验证位置 | 结果 |
| --- | --- | --- |
| 可安装 Cordis 插件 | package.test、隔离 CLI 安装/组合/卸载、runtime-smoke 导出入口挂载 | 通过 |
| 普通聊天自动学习 | runtime-smoke 的 NEBULA 项目事实及 3 轮反馈 | 通过 |
| 跨会话记忆、重启持久化 | core.test、CLI 独立进程、runtime-smoke 新 agent 和新 Brain 实例 | 通过 |
| 全局/工作区隔离 | core.test、adapter.test、runtime-smoke workingDirectory.set | 通过 |
| 聊天中切换工作区不污染归属 | adapter.test 在用户输入后切换 cwd，保存仍属于输入时工作区 | 通过 |
| 搜索、添加、修改、遗忘 | core.test、cli.test、native brain_search 与 /brain remember | 通过 |
| 导入导出、旧备份不复活删除记录 | core.test、cli.test | 通过；导入合并记忆，不替换当前性格 |
| 性格缓慢变化、冻结、重置、历史、回退 | core.test、adapter.test、runtime-smoke | 通过 |
| 冻结/重置期间的在途结果失效 | adapter.test、review.test 使用受控延迟 provider | 通过 |
| 性格变化可追溯 | core.test 断言历史包含变更前后值和原始用户证据 | 通过 |
| 遗忘相关证据原文 | core.test 断言删除后导出不含该原文 | 通过；保留已形成的数值风格，重置另用 reset |
| 单轮重复事件、工具/子 agent 排除 | adapter.test | 通过 |
| 否定、临时、引文、代码示例、不记住要求 | extraction.test、review.test | 通过所列样例；自然语言识别仍属启发式 |
| 提取超时、无路由、坏 JSON、异常、卸载取消 | adapter.test | 通过 |
| 队列有界、忽略取消的 provider 不堆积、完成边界不丢唤醒 | adapter.test、review.test | 通过 |
| 并发写、原子持久化、损坏保护 | core.test：4 个实例与 3 个子进程，最终 56 条独立记录 | 通过 |
| 凭据过滤与严格导入 | core.test、extraction.test | 通过所列模式；不承诺识别所有秘密 |
| 上下文数量/字符预算、CLI 更新立即可见 | core.test、adapter.test | 通过 |
| 中文文档、CLI、安装卸载脚本 | README、DESIGN、CLI 测试、实际隔离安装 | 已交付 |

## 安装链路验证

使用 Desktop 自带的 `resources/runtime/cli/bin/dsh.cmd`，`--version` 输出 `0.2.1-rc.3`。在独立 `DSH_HOME` 与 `brain-test` profile 执行安装脚本，检查依赖与组合配置包含 `dsh-brain` bundle、`id: brain` 和 `name: dsh-brain`；卸载后依赖和 bundle 移除，原 `@deepseek-ai/dsh-base` 保留。测试没有修改日常 `desktop` profile。

最终发布文件通过 `npm pack` 生成；仅打包 lib、bin、scripts、docs、bundle manifest、README、LICENSE 与 package.json，不包含临时运行时副本、测试存储、用户记忆、认证文件或聊天历史。

## v0.1.0 历史验证边界

- 本次没有向真实联网模型发起生成请求，没有做原生 Desktop 窗口交互验收。
- 已证明插件的数据流、宿主接口与持久化行为；未声称真实模型每次都遵循性格提示，也未测量长期自然对话的提取准确率。
- 未更改用户日常 Desktop profile；安装命令见 README。
- 检索使用英文词/中文二元组，无向量嵌入服务；风格学习由用户明确反馈驱动，模型语义提取与保守离线规则配合。

## v0.1.0 历史复现命令

```powershell
npm.cmd test
npm.cmd run test:runtime
npm.cmd pack
.\scripts\install.ps1 -PackagePath .\dsh-brain-0.1.0.tgz -DshHome "$env:TEMP\dsh-brain-verification" -Profile brain-test
.\scripts\uninstall.ps1 -DshHome "$env:TEMP\dsh-brain-verification" -Profile brain-test
```

上述 tarball 名称对应历史版本；当前版本安装命令以 [README](../README.md) 为准。非默认 Desktop 安装位置，runtime smoke 使用 `DSH_DESKTOP_EXE`，安装脚本使用 `-DshCli`。npm tarball 不包含测试和开发验证脚本，`npm test`、`npm run verify` 和 `npm run test:runtime` 应在完整源码 checkout 中运行。
