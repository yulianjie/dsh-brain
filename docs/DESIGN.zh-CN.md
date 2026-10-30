# DSH Brain 架构与设计

设计始于 2026-10-26，更新于 2026-10-27。目标 Desktop bundled runtime 为 0.2.1-rc.3；实际验收范围见[验证记录](VALIDATION.zh-CN.md)。本文说明当前设计和行为约束，开发方式见[贡献指南](../CONTRIBUTING.md)。

## 2026-10-27：上下文与稳定性改进

当前工作区新增全局核心偏好召回、查询预览/全文分页、字符与估算 Token 双预算、单个当前参考消息和近期风格共识。设计依据、迁移边界、缓存取舍与验收见[调研与改进评估](MEMORY-CONTEXT-REVIEW.zh-CN.md)。新设置总数为 23；旧版本验收记录中的 20 项保留为历史记录。

## 2026-10-27：原生插件配置界面

常用配置通过宿主原生设置通道提供：服务端导出带 volatile 字段的 Config，客户端通过原生插件详情页的配置插槽和 configForms 显示表单、暂存修改、保存、校验及错误状态。仅声明 Config 并不能保证当前 rc.3 客户端显示表单，必须同时交付客户端模块。

- 自动学习：总开关及独立性格学习开关。
- 记忆与上下文：是否注入记忆/性格、记忆容量、注入条数及字符预算。
- 提取模型：提供方和模型留空时跟随当前会话；超时、输入长度、队列长度、输出预算等常用限制。
- 交流风格：自动演进、手动指定、关闭三个模式；手动模式提供五个 0..1 维度。
- 高级选项：写锁等待等安全数值限制；存储目录保留为结构性配置，避免在设置页误切换数据位置。

设置与已有记忆/人格状态分离。手动模式只改变当前注入的风格，不调用 setPersonality/reset；恢复自动模式后继续使用原有学习结果。独立性格学习开关还遵循已有人工冻结状态。后台任务在配置变更时取消或失效，关闭学习后不能通过旧任务继续保存。校验失败不能部分覆盖有效配置；与当前存储容量冲突的缩容不能静默删除记忆。

0.2.0 验收覆盖真实宿主设置命名空间与 volatile 更新、配置持久化、客户端模块注册、原生 Desktop 页面显示、保存后离开再进入仍保留值，以及配置修改不重置学习状态。

## v0.4：风格文本化与 dream 规划（只读）

v0.4 第一阶段先解决两个只读问题：模型如何直接理解风格偏好，以及如何发现值得合并的记忆。两者都不改变持久化结构。

风格注入从裸 JSON（`{"mode":"adaptive","traits":{"warmth":0.62,…}}`）改为自然语言行为约定。`lib/style.js` 按固定顺序（warmth、verbosity、humor、proactivity、formality）把每个维度分到 low/mid/high 三档，0.35 与 0.65 属于 mid，只把非 mid 维度渲染成逐字固定的句子，全部 mid 时输出中性句。`context()` 只拼接 `BRIEF_HEADER` 与正文，不再注入 mode、维度名或数字；adaptive 使用当前学习值，manual 使用手动值，off 不注入。分档意味着 0.45 这类档内漂移不会改变提示词，只有跨档才改变行为描述，这是有意的稳定性取舍。

`lib/dream.js` 是纯函数规划层：`groupCandidates()` 先在相同 scope/workspace 内按非空 key 成组，再按 `normalized(text)` 的哈希做线性精确去重，剩余记录才用共享分词模块 `lib/text.js` 建 term 倒排索引，只比较共享词项的对，并设 20 万次比较上限；超限时 `planDream().stats.truncated` 为 true。只返回至少两条的组，超过 20 条的组按 id 排序切成多个 2..20 的块，排序确定。`dreamPayload()` 生成有组数、记忆数、文本长度上限的模型输入；`validateDream()` 结构性问题一律抛出带字段信息的 `Invalid dream plan:` 错误，缺省的 `groups`/`contradictions`/`drop` 按空数组处理，显式类型错误仍拒绝；文本忠实性不足则把 `line` 降级为组内最新记录的索引行并记入 `degraded`，时间戳按解析后的时刻判定并列。`planDream()` 只做计算，不做 IO。`brain.dreamPlan()` 与 `/brain dream [--json]` 读取原子替换后的文件后直接返回规划，不落盘。

两条对抗审查后收紧的硬规则。其一，**记忆优先于风格**：`context()` 先用 header 预算挑选记忆，最后仅当 `header + 风格段 + 记忆块` 整体仍满足预算时才追加风格段，否则丢弃风格段；因此 `maxContextChars=300` 这类窄预算下保留的是一条记忆而不是中性风格句——风格是软偏好，事实是本体。其二，**索引行不得造词**：`line` 中每个中文二元组都必须出现在组内原文中（ASCII 词同样要求子集），任一行不满足即降级为抽取式索引行；原先的 0.6 覆盖率阈值会让「三点→四点」这类单词替换通过，等于把防伪造线降到 82%。此外 `title`/`line`/`brief`/`reason` 拒绝控制字符与双向覆盖字符，`drop` 的重复 id 去重。

**为什么先不迁移 schema**：上述输出都可以从现有 `schemaVersion: 1` 状态重新计算，风格文案与候选组不是新的持久事实。把合并结果、索引或 dream 游标写入 `brain.json` 才会需要字段白名单、迁移器和回滚策略；在分组质量与真实使用反馈得到验证前，先保持零迁移可以把风险限制在只读路径。等合并语义稳定后，再单独设计 `schemaVersion: 2` 与显式迁移，本次不新增持久字段、不放宽 `validateState()` 白名单、不新增运行时依赖。

## 目标与验收

为 DeepSeek Harness Desktop 提供可安装插件，让普通聊天积累长期记忆，并逐渐形成可解释、可控制的交流风格。性格指持久的语言行为偏好，不声称模型具有意识或真实情感。

1. 原生插件在 Desktop bundled runtime 中成功加载，模型请求参考消息、工具、根会话结束钩子实际有效。
2. 新会话能够召回旧会话的持久信息；全局偏好可共享，工作区事实不跨项目泄漏。
3. 普通聊天可自动提取记忆和风格反馈；提取使用已有 llm 服务，异步有界队列、超时、去重，不阻塞主对话。
4. 多个独立用户轮次的明确风格反馈逐渐改变 personality；单次反馈不能导致剧烈变化。查看、冻结、重置、历史、回退可用。
5. 记忆支持查看、检索、写入、修改、遗忘、导入导出；记忆不是高优先级指令，注入数量和总长度有上限。
6. 本机存储，原子持久化、并发写保护、损坏时明确报错而非静默覆盖；过滤明显凭据；不会读取其他 agent 的记忆或历史来初始化。
7. 中文 README、配置/命令说明、安装卸载脚本、测试、可分发 npm tarball；验证记录准确区分纯逻辑、真实运行时、模型行为和原生 UI。

## 调研依据

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：Cordis 插件平台；以 Desktop app.asar 中的具体 API 为集成依据。
- [dsh-memory](https://github.com/haitang1/dsh-memory)：借鉴会话结束提取、动态 context 注入和 memory 工具思路。
- [Mem0](https://github.com/mem0ai/mem0)：借鉴提取、合并、检索流程，不引入其服务依赖。
- [Letta](https://docs.letta.com/v1-sdk/concepts/stateful-agents)：参考持久状态与核心记忆分离思想。

独立实现，不复制上述参考项目的源码。集成测试使用 Desktop bundled CLI 和代码；npm-global 版本或 profile 的依赖链接不能替代目标 Desktop 版本的验证。

## 结构

- `lib/core.js`：纯 Node 核心 Brain 类，存储、记忆、检索、人格状态、历史；不依赖宿主。
- `lib/text.js`：共享的 NFKC/空白归一化与 ASCII 词、中文单字/二元组分词。
- `lib/style.js`：把五维 trait 确定性地渲染成自然语言风格段（三档、固定句子表）。
- `lib/dream.js`：只读的候选分组、有界 payload、plan 校验与降级、规划入口。
- `lib/context.js`：宿主当前参考消息替换、旧共享快照分节迁移、token 计量事件。
- `lib/budget.js`：不依赖模型的 token 估算和 Unicode 安全输出预算。
- `lib/extraction.js`：结构化提取协议、校验、证据约束、中文/英文明确偏好的离线兜底。
- `lib/index.js`：Cordis apply，agent/request 参考消息替换、tools、commands、agent 回合事件、llm 服务适配。
- `lib/config.js`：原生 schema、默认值、范围校验、模型路由成对校验与 volatile 读取。
- `lib/client.js`：由宿主 ModuleLoader 加载的原生设置客户端；不能直接在 Node 中导入执行。
- `bin/brain.mjs`：本地管理 CLI；提供服务不可用时的人工控制。
- `scripts/install.ps1` / `uninstall.ps1`：默认定位 Desktop bundled CLI，调用受支持的插件管理接口，保留现有 profile 配置。
- `test/`：核心行为、边界、并发、宿主适配与客户端边界测试；使用临时合成数据。
- `scripts/runtime-smoke.mjs`：可选的真实 Desktop bundled runtime 服务验证。
- `scripts/check.mjs` / `package-check.mjs`：语法/文档检查与真实 npm tarball 安装检查。
- `.github/workflows/ci.yml`：Node 22/24 在 Windows、Linux、macOS 上的持续验证。

优先使用 JavaScript ESM、Node 内建模块，避免原生编译和额外数据库依赖。状态为 schemaVersion=1 的 JSON，默认 `$DSH_HOME/brain`（未指定时 `~/.dsh/brain`）。全局记忆、工作区记忆、人格分别管理；根目录可配置。

## 核心 API

`new Brain({ dataDir, maxMemories?, maxContextChars?, ... })`，`await brain.init()`。

所有方法返回 Promise，除 `context({workspace,query})` 是同步只读快照（给请求前的参考消息生成）。

- `remember({text, kind?, scope:'global'|'workspace', workspace?, source?, confidence?, id?, key?})` → record；id 指定时修改，key 用于语义合并。
- `list({scope?,workspace?})`、`search({query,workspace?,limit?})` → record[]；未提供 workspace 时不暴露 workspace 记录。
- `memoryPage({query?,scope?,workspace?,cursor?,limit?})` → 有预算的预览页；`readMemory({id,workspace?,cursor?})` → 精确正文分段。
- `forget({id,workspace?})` → boolean。
- `learn({sessionId,turnId,workspace,userText,assistantText?,extraction?})` → 学习结果；可直接使用受校验的模型 extraction 或离线明确反馈提取。
- `personality()` → 包含维度、冻结状态、证据计数的快照。
- `setPersonality({frozen?,traits?})`、`resetPersonality()`、`personalityHistory()`、`rollbackPersonality({version})`。
- `exportData()`、`importData(data)`、`stats()`、`context({workspace,query})`。
- `dreamPlan({threshold?,maxGroups?})` → `{groups,payload,stats}`；同步只读，读取原子替换后的文件后返回候选合并组，不写状态。
- 实现补充同步只读属性 `personalityGeneration`：在用户消息到达时快照控制代数，传入 `learn`；冻结、重置等人工控制递增代数，阻止先前在途提取继续影响风格。工作区也在消息到达时快照，避免本轮中途切换目录导致记忆串项目。

提取结果统一为 `{memories:[{text,kind,scope,key?,confidence,evidence}],feedback:[{trait,value,confidence,evidence}]}`；trait 为 warmth、verbosity、humor、proactivity、formality，value 为 [0,1] 目标值。evidence 必须是当前 userText 的逐字片段；模型输出和工具输出不作为用户偏好证据。禁止根据人口学特征推断风格。

每个 trait 最近最多 5 次反馈中至少 3 个独立 turn、至少 75% 同向支持且最新反馈也同向才自动更新；取支持值中位数为目标，单轮 delta <= 0.05，目标距离 <= 0.05 时不微调；范围 [0,1]，默认中性；保持有限证据和变更历史、去重 turn。冻结时不积攒日后突然生效的漂移。人工设置立即生效。

## 聊天集成

启动时加载状态；根 agent 回合结束时只取本轮用户文本，排除 subagent、工具、runtime context。后台提取最多一个模型调用每轮，限制输入长度、并发、队列、超时；不能无限重试或递归生成 agent。凭据走宿主 llm，不另读 auth 文件。首次请求通过 `agent/pre-step` 队列在系统头之后提交参考，后续 `agent/request` 在宿主准备模型请求时更新有来源的低优先级参考消息，文本不走模板插值。使用原生单节点 surface replacement 保留一个当前快照，写入相邻的 tokenMeter 计量事件供宿主重放和用量统计。原始日志不删除，旧共享 runtime 快照只移除 Brain 分节。保留用户当前指令优先。workspace 必须从该 agent/session 的 cwd 获取，不能用插件进程 cwd 代替。

模型工具使用 brain_ 前缀：搜索、列表、按 ID 分段读全文、记住、遗忘、性格查看；破坏性人格控制和导入导出由用户 `/brain` 命令或 CLI 完成。`/brain` 支持 help/status/list/search/remember/forget/personality/freeze/unfreeze/reset/history/rollback；复杂导入导出由 CLI 提供。

## 验证策略

核心测试：重启持久化、项目隔离、中英文检索、纠正去重、删除不复活、凭据过滤、非法提取、重复事件、多个实例竞争、损坏文件不覆盖、注入预算、人格渐进/冻结/回退。

宿主测试：从 Desktop app.asar 用 Electron Node 模式加载真实 Cordis、systemPrompt、agent、tools、commands、llm；挂载插件，驱动根会话事件/真实 agent loop，观察新 session prompt 中召回事实以及 trait 变化。模型测试优先可控 provider；若执行真实网络模型测试，仅使用专门合成对话，避免访问用户现有对话。

安装测试优先隔离 profile，确认包内容和 bundle 加载。若安装用户 desktop profile，则保留其他插件及配置，不自动强制关闭运行中的 Desktop。
