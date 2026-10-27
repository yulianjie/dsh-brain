# DSH Brain 验证记录

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
