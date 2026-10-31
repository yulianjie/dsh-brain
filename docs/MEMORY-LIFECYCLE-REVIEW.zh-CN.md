# 对话归档/删除与记忆保留：业界调研与策略建议

调研与撰写日期：2026-10-31。对象：本仓库 `@yulianjie/dsh-brain` v0.4.0。调研方式：本地源码与本机真实数据核对，加上三个并行子代理的联网调研（主流 AI 助手产品、记忆框架、隐私法规与行业数据实践）；关键结论另经原文抽查复核。

> **证据分级**（沿用 [ARCH-BENCHMARK.zh-CN.md](ARCH-BENCHMARK.zh-CN.md) 的做法）：
>
> 1. **本地**：本仓库源码 / 本机数据的直接证据，文件:行号可复核；
> 2. **官方**：联网抓取或本仓库 `.tmp/pages` 缓存的官方文档原文，附来源链接；
> 3. **权威**：监管机构、权威律所或厂商博客的解读，附来源链接；
> 4. **推断**：基于上述证据的推断，单独标注。
>
> 部分厂商页面（openai.com、help.openai.com、support.google.com 等）直接抓取返回 404，其官方原文经多语言版本或搜索快照交叉确认，此类情况在对应条目注明「经索引确认」。

---

## 0. 一句话结论

**对话在 DSH 中被归档或删除时，不需要也不应该自动同步清除记忆。** 对「提取式长期记忆」（dsh-brain 的形态）而言，这是全部调研对象的一致做法，且四家有官方原文明示：ChatGPT（"Deleting the original chat does not automatically delete a separate saved memory"）、Claude（"memory entries generated from it aren't removed"）、Microsoft Copilot（"Deleting a chat doesn't delete saved memories that were generated from that chat"）、Perplexity（"neither does deleting a thread in your history"）；Claude Code、Codex、zcode 等编码 Agent 与 mem0、Letta、LangGraph 等框架同构。与聊天绑定的「引用式记忆」（Gemini 历史记忆、ChatGPT Reference chat history 等）确实随对话删除而失效，但 dsh-brain 不属于这一类（见 §6.1 的分类）。归档在任何调研对象中都不触发任何删除。

dsh-brain 当前「对话消失、记忆保留」的行为**与业界一致，不需要改**。真正的缺口是三件事：

1. **文档没有把这件事说清楚**——用户删除对话后，其原话仍逐字留在 `brain.json` 里，但 README 未说明；
2. **缺少「按来源会话清除记忆」的入口**——溯源字段已经存在，只差一个命令；
3. **缺少「一键全清」入口**——对标 ChatGPT 的 *Delete and turn off memory* 与 Claude 的 *Reset memory*。

---

## 1. 问题定义与语义前提

**问题**：DSH Desktop 中的对话（会话）可以被归档或删除；dsh-brain 会从对话中提取长期记忆（`$DSH_HOME/brain/brain.json`，跨会话共享）。当对话消失后，其派生记忆是否应当被同步清除？

两个语义前提（业界共识，见 §3.8 的归档列与 [Attio 官方文档](https://docs.attio.com/docs/archiving-vs-deleting)）：

- **归档 = 保留 + 隐藏**：数据留在系统中，仅从界面收起；
- **删除 = 永久移除**：从存储中移除，不可恢复。

「删除对话时是否级联删除记忆」因此是一个独立的设计决策，不是归档的延伸问题。

---

## 2. dsh-brain 现状（本地证据）

### 2.1 记忆与对话的耦合度：解耦 + 部分溯源

记忆记录字段为 `id/text/kind/scope/workspace/source/confidence/key/personalityTraits/createdAt/updatedAt`（`lib/core.js:254`）。与对话生命周期相关的机制：

| 机制 | 现状 | 证据 |
| --- | --- | --- |
| 会话溯源 | 自动学习的记忆带 `source: "user-turn:<sessionId>:<turnId>"`；sessionId 即宿主会话目录名（含 `session-` 前缀，约 45 字符，小于 64 字符截断；疑似凭据时才换成哈希） | `lib/core.js:420-422` |
| 手动/工具记忆 | 无会话溯源：`source` 为 `manual`（命令/CLI）或 `model-tool`（模型工具） | `lib/core.js:254`、`lib/index.js:230` |
| 合并覆盖溯源 | 同 `key`/同文本合并更新时，`updated = { ...record, ... }` 用**最新写入者的 source 覆盖**旧记录，早期来源会话信息丢失 | `lib/core.js:265` |
| 轮次防重放 | `processedTurns` 存 `sha256(sessionId\0turnId)` 单向哈希，不可逆、无法映射回会话 | `lib/core.js:397,414-415` |
| 删除墓碑 | `tombstones` 阻止自动提取让已删事实复活；导入旧备份不会复活墓碑内容 | `lib/core.js:358,456-465` |

**结论**：记忆在设计上就**不属于对话**——`global` 属于用户、`workspace` 属于目录路径（不是会话），跨会话召回是产品核心目标（[DESIGN.zh-CN.md](DESIGN.zh-CN.md) 目标 2：「新会话能够召回旧会话的持久信息」）。但自动学习路径已经保留了可用的会话溯源（`source` 字段），这为「按会话清理」提供了现成基础。

### 2.2 现有清理机制：只有单条删除

- `forget({id})`：按 id 删除单条记忆，写墓碑，并连带清洗人格证据中匹配的原句（`lib/core.js:350-361`）；
- **没有**「按会话删除」「按工作区批量删除」「一键全清」命令（`lib/index.js:15` 的命令表、CLI 均无）；
- 导出 + 删除 `dataDir` 可实现全清，但这是文件操作而非产品入口；卸载插件同样保留记忆（[../README.md](../README.md)「卸载保留记忆文件」）。

### 2.3 插件感知不到对话的归档/删除

插件订阅的宿主事件只有：`loader/volatile-update`、`agent/pre-step`、`agent/request`、`agent/inbox/claimed`、`session/event`（且只用其中 `turn/end` 完成事件触发学习，`lib/index.js:193-263`）。

从本仓库 `.runtime-inspect/` 提取的宿主运行时模块看，会话生命周期事件只有 `session/created`（`dsh-session-index.js:1894-1916`），**未发现面向插件的会话删除/归档事件**。会话在磁盘上是 `~/.dsh/sessions/<工作区slug>/<sessionId>/` 目录；Desktop 界面的「删除/归档对话」具体如何作用于该目录，未在本仓库可验证范围内（app.asar 内的客户端代码未提取），如实标注为**未验证**。

因此「同步清除」目前**没有可靠触发通道**：要么等宿主提供事件，要么做文件系统监听——后者无法区分归档与删除、跨平台行为不一致、且与宿主删除操作存在竞态，不建议。

### 2.4 三个比对话活得久的残留通道（隐私视角）

1. **记忆正文 = 用户原话逐字**：自动学习的 `text` 就是 `evidence`，而 evidence 必须是本轮用户文本的逐字子串（`lib/extraction.js:259,270`）。删除对话后，用户在该对话中说过的原句仍逐字留在 `brain.json`。
2. **人格证据/历史原句**：`personality.evidence` 与 `history.changes[].evidence` 保存风格反馈原句，仅被 `forget` 的文本匹配、`reset` 或 `rollback` 清洗（`lib/core.js:355-357,430`）；evidence 条目只存轮次哈希，**无法映射回来源会话**。
3. **`processedTurns` / `tombstones`**：不可逆哈希，不泄露内容，但**无上限增长**（`validateState` 只校验格式不设容量，`lib/core.js:79-80`；`memories` 有 500 上限、`history` 有 100 上限，这两者没有）。

### 2.5 实证快照（2026-10-31，本机）

对本机 `~/.dsh/brain/brain.json` 的只读统计（撰写时点；后续会随正常使用与工具写入漂移，复核时数字可能略有出入）：共 18 条记忆；16 条自动学习，来自 4 个不同的根会话（`session-264d…`、`session-553b…`、`session-a38b…`、`session-be57…`），这 4 个会话目录当时都还存在于 `~/.dsh/sessions` 下；2 条为手动/工具写入。`source` 中的 sessionId 与磁盘目录名可逐字精确匹配。

即：当前真实数据中还没有「来源会话已被删除」的记忆，但机制上没有任何东西阻止这种状态出现——这正是本报告要回答的场景。

---

## 3. 主流产品：删除/归档对话时怎么处理记忆（联网调研）

### 3.1 OpenAI ChatGPT —— 明确「不级联」，并区分两层记忆

- **官方帮助文档**（*Memory in ChatGPT*；主站反爬，经官方镜像 help-lb.openai.com 与日文版搜索快照直接确认）："**Saved memories are stored separately from chat history. Deleting the original chat does not automatically delete a separate saved memory.** You can ask ChatGPT to forget a saved memory or delete it from Memory settings." / "Deleting a chat alone does not necessarily delete a separate saved memory created from that chat."——删除对话**不**自动删除由它产生的记忆。来源：[Memory in ChatGPT（官方镜像）](https://help-lb.openai.com/en/articles/8590148-memory-in-chatgpt)、[Memory in ChatGPT](https://help.openai.com/en/articles/8590148-memory-in-chatgpt)【官方】
- 管理入口（官方口径）："You can **delete individual memories, clear all of them, or turn memory off completely** in settings"——单条删除、全清、关闭三件套；*Temporary Chat* 不进历史、不创建记忆、最长 30 天安全保留【官方，经摘要与第三方转述确认】
- **Reference chat history**（引用历史对话做个性化）是另一层记忆：被删除的聊天不再被引用；关闭该功能后派生信息 30 天内从系统删除【第三方一致转述官方行为】。这层「引用式记忆」天然跟随对话消失，与 saved memories 的「提取式记忆」形成对照（分类见 §6.1）。
- **溯源**：saved memories 没有溯源到来源对话的界面，也没有「按来源对话清理」的官方能力【未找到官方说明】
- 已删除聊天从后端系统移除的窗口为 30 天（匿名化/法律义务例外）【官方，经多语言版本索引确认】
- 归档（Archived chats）：官方保留策略文档明确「**Regular and archived chats remain saved to your account until you delete them** … **Archiving a chat does not change its retention period.**」——归档不改变保留期、不触发删除，与记忆无涉【官方】。来源：[Chat and file retention in ChatGPT](https://help.openai.com/en/articles/8983778-chat-and-file-retention-in-chatgpt)

### 3.2 Anthropic Claude（claude.ai）—— 消费者版不级联；Anthropic 亲身实践过「级联」并放弃了它

- **消费者版官方帮助**（本仓库 `.tmp/pages/claudeai-memory-help.txt` 缓存了原文）："**When a conversation is deleted, including under a retention period, memory entries generated from it aren't removed**, but you can delete individual memories while memory is on."——删除对话（含保留期内到期删除）**不**删除其派生记忆条目。来源：[Use Claude's chat search and memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)【官方】
- **同一页面记录了一次重要的设计演变**：旧版「memory synthesis」把记忆做成对话的合成摘要、**跟随对话删除**（"When a conversation is deleted, its summary is also deleted"；对话删除/修改后 24 小时内重算）；新版把记忆改成独立话题条目、**不随对话删除**——Anthropic 自己从「级联」演进到了「解耦」，是本次调研中最有说服力的代际证据。
- 管理入口：Settings → Your Claude → Manage（Topics 逐条编辑/删除）、*Reset memory*（永久全删，不可撤销）、*Pause memory*（保留现有、暂停新增）、单聊 Memory off（该对话不读不写记忆）【官方】
- **溯源**：Past chat citations——记忆引用历史对话时给出可回链的引用，并可在引用处直接删除那个对话；这是调研中少见的「来源可见性」设计【官方】
- 企业版的两种受控级联：组织自定义保留期**同样适用于记忆**（超过保留期未更新的记忆条目被删除，可部分删除）；**删除项目会级联删除项目记忆**（"Project memory is deleted when the project is deleted"）；组织级关闭记忆立即删除全员全部记忆【官方】
- 删除的对话 30 天内从后端存储移除（滥用标记数据最长 2/7 年，去标识训练数据最长 5 年）。来源：[How long do you store my data?](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data)【官方】
- **归档**：claude.ai 未提供对话归档功能（未找到相关官方说明）。

### 3.3 Claude Code —— 转写清理时把记忆文件排除在外

官方文档（`.tmp/pages/cc-memory.txt` 缓存原文）："Claude Code deletes old session transcripts after the cleanupPeriodDays retention period, but **excludes the memory files in the memory directory from that retention sweep**. MEMORY.md and topic files stay until you or Claude edits or deletes them."——会话转写按保留期自动清理，**记忆文件被明确排除在清理之外**，直到用户或 Claude 主动编辑/删除。删除记忆=直接编辑 markdown 文件。来源：[How Claude remembers your project](https://code.claude.com/docs/en/memory)【官方】

### 3.4 OpenAI Codex —— 记忆属于用户层，thread 只是生成输入

- Memories 存 `~/.codex/memories/`（per-user `$CODEX_HOME`，非 per-project），由后台任务从「闲置足够久的 eligible threads」提取；`/memories` 命令按 thread 控制该会话是否读取/生成记忆。thread 删除不级联 memories【官方镜像文档 + 推断】。来源：[Codex memories](https://github.com/crasuna/openai-dev-docs-cn-mirror/blob/main/sources/en/codex/memories.md)
- 本仓库 [ARCH-BENCHMARK.zh-CN.md](ARCH-BENCHMARK.zh-CN.md) §4.2 已从本地 SQLite 佐证：`memories_v2_1.sqlite` 的 `stage1_outputs` 按 `thread_id` 组织，`threads` 表有会话级 `memory_mode` 开关——溯源存在，但删除语义仍是「记忆独立于 thread」。

### 3.5 Google Gemini —— 「引用式记忆」与聊天耦合最紧的反例

- 官方支持文章："**If you delete a chat, there might be a short delay before Gemini stops using it to personalize your responses.**" / "**To delete something that Gemini remembered about you, delete all chats with this info from Gemini Apps Activity.**"——删除 Gemini 记住的信息的官方办法就是**删除包含该信息的对话**。来源：[Get personalization with memory of your past Gemini chats](https://support.google.com/gemini/answer/16598469)【官方，经搜索摘要】
- **Saved info**（显式保存的记忆）是另一层：设置中可逐条查看/编辑/删除；删除对话是否影响 Saved info 官方未说明【官方（管理方式）+ 未找到（级联关系）】。来源：[Save info and reference past chats in Gemini Apps](https://support.google.com/gemini/answer/16413516)
- Gemini Apps Activity 默认 18 个月自动删除（可选 3/36 个月或关闭）；管理/关闭 Activity 不等于删除聊天【官方，经多语言版本索引确认】。来源：[Gemini Apps Privacy Hub](https://support.google.com/gemini/answer/13594961)
- Gemini CLI（编码场景）则与 Claude Code 同构：`save_memory` 直接写 markdown 文件，与对话解耦【官方站】。来源：[Memory files](https://geminicli.com/docs/tools/memory/)
- Workspace（Gemini 侧栏）：2026-02 起对话历史默认无限期保留，管理员可配置 3/18/36 个月自动删除；用户默认可手动删除单个对话【官方博客，经索引确认】。来源：[Workspace Updates](https://workspaceupdates.googleblog.com/2026/02/gemini-conversation-history-is-coming-to-side-panel-in-google-workspace.html)

### 3.6 zcode（GLM 系编码 CLI）

「Nothing is uploaded anywhere as part of the Memory feature. Since they're ordinary files, you can open, edit, or delete them by hand at any time — deleting the project's memory directory resets its memory completely.」——文件式记忆，删除记忆=删目录，与对话无关。来源：[zcode Memory 文档](https://zcode.z.ai/en/docs/memory)【官方】

### 3.7 GitHub Copilot / Microsoft Copilot / Cursor / Perplexity / 其他

**GitHub Copilot**（官方文档已直接抓取）：

- 会话数据的归档/删除语义由官方定义："**Delete**: Permanently remove the session…"；"**Archive**: Move the session out of your active list **without deleting it**."。来源：[About GitHub Copilot session data](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/session-data)【官方】
- **Copilot Memory**（2026 GA 的云端记忆，Repository facts + User preferences 两域）："Asking the agent to forget a cloud memory **downvotes it rather than permanently deleting it**"；"**Facts and preferences that go unused are automatically deleted after 28 days.** Successful validation and use can reset that timer."——使用驱动的 TTL；会话管理与记忆管理是两套独立系统，删除会话是否级联删除 Memory 官方未说明。来源：[Use memory with agents in VS Code](https://code.visualstudio.com/docs/copilot/agents/memory)【官方】

**Microsoft Copilot**（官方文档已直接抓取）——双轨设计最清晰的一家：

- 消费版 Copilot Chat："**Deleting a conversation doesn't remove memories saved from that conversation — delete them directly from your personalization settings.**" 配套 *Delete all memories* 全清；Temporary chat 不读不写记忆。来源：[Personalize Copilot with memory](https://learn.microsoft.com/en-us/training/modules/write-effective-prompts-do-more-prompting/3a-personalize-copilot-memory-instructions)【官方】
- Microsoft 365 Copilot 双轨：**Saved memories**「retained until the end-user explicitly deletes … **Deleting a chat doesn't delete saved memories that were generated from that chat**」；**Chat history 推断记忆**——删除所有来源对话后，该信息 **7 天内**从推断记忆清除；Purview 保留策略不约束记忆。来源：[Manage Copilot personalization and memory](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory)【官方】

**Perplexity**（官方帮助原文，经搜索摘要）：

- "Turning Memory off does not clear your memories, **and neither does deleting a thread in your history**."——官方明确删除对话不删记忆；Settings → Memory 逐条删除 / Clear all；incognito 永不记忆。来源：[Perplexity Help — Memory](https://www.perplexity.ai/help-center/en/articles/10968016-memory)【官方】

**Cursor**（官方帮助页已直接抓取）：

- 旧版 Cursor Memories（v0.51 beta，2025-05 上线）已在 v2.1（2025-11）移除，官方文档不复存在【多方第三方确认】。
- 现行 Bot 记忆的官方矩阵：**Reset a conversation → Memory is kept**；**Delete a Bot → That Bot's memory is deleted**（连同对话/附件，不可撤销）；"To keep a Bot's memory but take it out of your list, choose **Hide from sidebar**"；跨对话共享（"What a Bot saves in one chat, it remembers in all your chats with it"）；删除单个对话对记忆的影响官方未说明。来源：[What your Bot remembers](https://cursor.com/help/grok-bot/memory)【官方】

**Windsurf**（官方文档，已迁移至 Devin docs）：

- "**Memories is the system for sharing and persisting context across conversations.**"——记忆是跨对话持久化文件，设置面板逐条编辑/删除；删除对话是否影响记忆官方未说明。来源：[Devin docs — Memories](https://docs.devin.ai/desktop/cascade/memories)【官方】

**xAI Grok / Meta AI / Character.AI / Replika**：

- **Grok**：官方口径「Memories are transparent: you can see exactly what Grok knows and choose what to forget」——聊天内逐条遗忘 + Clear All Memories（Data Controls）；官方无记忆帮助页，「删除对话是否删除记忆」无官方说明（泄露的系统提示词称「删对话即删关联记忆」，**非官方文档，仅供参考**）。来源：[past.dev Grok teardown（转录官方公告/FAQ）](https://past.dev/blog/grok-memory)、[PCMag](https://www.pcmag.com/news/groks-new-memory-feature-will-remember-everything-youve-ever-said)【官方公告经一致转述】
- **Meta AI**：官方博客「only remember certain things you tell it in **1:1 conversations** … **you can delete its memories at any time**」；保存时提示 Memory updated → View All 逐条删除、`/reset-all-ais` 全清；删除对话是否级联删除记忆官方未说明。来源：[The Verge](https://www.theverge.com/2025/1/27/24352992/meta-ai-memory-personalization)【官方博客经媒体一致转述】
- **Character.AI**：Facts（本人/角色/配角）逐条编辑/禁用/删除，官方明言「**none of it has to disappear when you start a new chat**」。来源：[Smarter Memory for Smarter Chats](https://blog.character.ai/memory/)【官方博客，经摘要】
- **Replika**：官方把「删除对话」与「管理记忆」呈现为两个独立入口（Memory section 查看/增删）。来源：[Replika Help](https://help.replika.com/hc/en-us/articles/4410750548493-Can-I-delete-my-conversations)【官方，经摘要】
- **xAI grok-build（编码 CLI）**：文件式记忆 `~/.grok/memory/`，`grok memory clear` 一键清空工作区记忆（MEMORY.md、sessions/、index.sqlite）——与 Claude Code/zcode 同构。来源：[grok-build 用户指南](https://github.com/xai-org/grok-build/blob/8adf9013a0929e5c7f1d4e849492d2387837a28d/crates/codegen/xai-grok-pager/docs/user-guide/13-memory.md)【官方仓库文档】

### 3.8 小结

| 产品 / 形态 | 删除对话 → 记忆 | 归档 → 记忆 | 记忆独立管理入口 |
| --- | --- | --- | --- |
| ChatGPT（saved memories，提取式） | ❌ 不删除（官方原文明示） | 归档不删聊天、不改保留期（官方） | 单条删除 / 清除全部 / 关闭 |
| ChatGPT（Reference chat history，引用式） | ✅ 被删对话不再被引用 | 未找到说明 | 开关；关闭后派生信息 30 天内删除 |
| Claude.ai（新版记忆，提取式） | ❌ 不删除（官方原文明示） | claude.ai 无归档功能 | Topics 单条 / Reset / Pause / 单聊关闭；Past chat citations 溯源 |
| Claude.ai（旧版 synthesis，引用式） | ✅ 摘要随对话删除（已被新版取代） | — | — |
| Claude.ai（企业） | ⚠️ 保留期到期可删记忆条目；删项目级联删项目记忆 | 不影响 | 同上 + 组织级全删 |
| Claude Code | ❌ 转写清理明确排除记忆文件 | — | 直接编辑 markdown / /memory |
| Codex | ❌（推断，架构上解耦） | — | /memories 会话开关 + 文件 |
| Gemini（历史对话记忆，引用式） | ✅ 官方删除法＝删除含该信息的对话 | 未找到说明 | Apps Activity + Saved info 独立管理 |
| Gemini CLI | ❌ 文件式解耦 | — | 直接编辑文件 |
| GitHub Copilot（会话历史） | ✅ 会话删除即从会话索引删除（会话即数据） | ✅ 归档只移出列表不删除（官方） | 会话 Share/Delete/Archive |
| GitHub Copilot Memory（云端记忆） | 未找到说明；记忆独立于会话；未用 28 天自动删（官方） | —（同左） | GitHub 设置逐条删除 |
| Microsoft Copilot（saved memories） | ❌ 不删除（官方原文明示） | 未找到 | 单条 / Delete all / 关闭 |
| Microsoft Copilot（chat history 推断，引用式） | ✅ 删除所有来源对话后 7 天内清除（官方） | 未找到 | 关闭开关 30 天后全删 |
| Perplexity | ❌ 不删除（官方原文明示） | 未找到 | 单条 / Clear all；incognito 永不记忆 |
| Cursor Bot | Reset 对话保留记忆（官方）；删 Bot 级联删其记忆（官方） | Hide 保留一切（官方） | 聊天内口头管理（无列表界面） |
| Windsurf | 未找到说明（跨对话持久文件） | 未找到 | 记忆面板逐条编辑/删除 |
| Grok / Meta AI / Character.AI / Replika | 官方均未说明删除对话对记忆的影响 | 未找到 | 各有单条删除与全清入口 |
| zcode / grok-build | ❌ 文件式解耦 | — | 直接编辑/删目录 / memory clear |

---

## 4. 记忆框架：对话-记忆生命周期设计（联网调研）

> 本节由框架调研子代理完成（10 轮搜索 + 16 次官方文档抓取），核心结论经抽查复核。

**核心发现：没有任何主流框架在删除对话时无条件级联删除已提取的长期记忆。** 做法分为三种模式：

- **模式 A（解耦，主流）**：记忆属于用户/agent/项目，对话只是提取来源；删除对话不动记忆，删除记忆靠显式 API（mem0、Letta、LangGraph、OpenAI Assistants、Claude Code、Codex、Gemini CLI）。
- **模式 B（引用计数级联，最严谨）**：删除对话时只清理「**仅由该对话派生**」的数据，被其他对话共享的保留（Zep/Graphiti、Cognee、MemOS、Supermemory 的文档删除）。
- **模式 C（会话绑定）**：摘要/派生数据跟随对话删除（Claude 旧版 memory synthesis、OpenAI ChatKit thread items）。

### 4.1 逐框架要点

| 框架 | 溯源（记忆绑定会话） | 删对话级联删记忆 | TTL/过期/衰减 | 显式 forget API |
| --- | --- | --- | --- | --- |
| **mem0** | ✅ 每条记忆带 `run_id`（会话）等实体标签 | ❌ 应用主动 `delete_all(run_id=...)` | ✅ `expiration_date` 软过期 + decay 降权 | ✅ delete/batch_delete/delete_all（含 `*` 通配全清） |
| **Letta** | ❌ 记忆属 agent，跨会话共享 | ⚠️ 会话软删除；仅**该会话独占的 isolated blocks** 被永久删除 | ❌ 未找到 | ✅ archival passage / blocks / conversation |
| **Zep/Graphiti** | ✅ episode↔派生实体/事实完整关联 | ✅ **引用计数级联**（共享数据保留） | ⚠️ 双时态 `valid_at/invalid_at` 语义失效 | ✅ thread/episode/edge/node/user 全层级 |
| **LangGraph** | ⚠️ 无内置，靠 namespace 约定 | ❌ Store 与 thread 完全分离 | ✅ `put(ttl=minutes)` 滑动过期 | ✅ `adelete(namespace,key)` |
| **OpenAI Assistants** | ⚠️ 资源各自独立 | ❌ thread 删除不连带文件/向量库 | ❌ 无自动过期 | ✅ 各资源 DELETE |
| **Cognee** | ✅ per-document ownership | ✅ 文档级联 + 连带清理被污染的 session-cache | ❌ 未找到 | ✅ `forget()` 多模式（含只删派生保留原文） |
| **MemOS** | ✅ `file_ids` 可追溯 | ✅ 物理关联删除（不可逆） | ❌ 未找到 | ✅ ids/files/filter 三维度 |
| **Supermemory** | ✅ document→派生知识 | ✅ 文档级联；记忆 forget=软删保留审计 | ❌ 未找到 | ✅ forget by ID / 语义遗忘（支持 dry-run） |
| **Memobase** | ⚠️ 聚合画像无反向映射 | 反向取舍：原始对话处理完即删，只留画像 | ❌ 未找到 | ✅ blob / 整用户删除 |

关键原文摘录：

- **mem0**（最值得对标）："Deleting memories is how you honor compliance requests, undo bad data, or clean up expired sessions"；官方示例 `client.delete_all(run_id="session-xyz")` 的场景就叫 *"Clean up a session"*；`expiration_date` 为软过期——"Expiration **hides** a memory, it does not delete it"。来源：[Delete Memory](https://docs.mem0.ai/core-concepts/memory-operations/delete)、[Memory Expiration](https://docs.mem0.ai/platform/features/memory-expiration.md)【官方，已抽查原文】
- **Zep**（唯一完整级联链）："Deleting a thread removes all episodes associated with that thread. This triggers a cascading effect on the graph."——按引用计数清理，"This design preserves graph integrity. If multiple conversations mention the same entity… deleting one thread will not remove data that other threads contributed to the graph." 来源：[Deleting Data from the Graph](https://help.getzep.com/deleting-data-from-the-graph.md)【官方】
- **Letta**："Delete a conversation (soft delete)… Any isolated blocks associated with the conversation will be permanently deleted."——会话本身软删除，agent 级共享记忆不动。来源：[Delete Conversation](https://docs.letta.com/api/typescript/resources/conversations/methods/delete)【官方】
- **LangGraph**："If you create a new thread, you can still access the same memories so long as the user_id is the same."——Store 刻意设计为跨 thread。来源：[Stores](https://docs.langchain.com/oss/python/langgraph/stores.md)【官方】

### 4.2 对 dsh-brain 的直接含义【推断】

dsh-brain 现状属于模式 A，且已具备模式 B 的前提（`source` 溯源）。若要做级联，唯一严谨做法是 Zep 式引用计数：只清理「仅由该会话派生」的记忆——但 dsh-brain 的 `key` 合并会覆盖 `source`（§2.1），合并后无法判断是否多来源，**盲目级联会误删多会话共同强化的记忆**。

---

## 5. 法规与行业数据实践（联网调研）

> 本节由法规调研子代理完成（约 12 轮搜索），法条原文优先。要点如下，详细引文见 §9 参考来源。

### 5.1 法规要点

- **GDPR**：删除权（Art. 17）的对象是「与其相关的个人数据」，条文不区分来源；EDPB 明确 **inferred/derived data 属于个人数据**（Guidelines 01/2022 三分类）。存储限制原则（Art. 5(1)(e)）反对无限期保留——ICO：「不应以防万一而无限期保留数据」。针对「删除对话时是否级联清除派生记忆」**没有专门规则或执法**（空白地带）。
- **CCPA/CPRA**：加州总检察长 2022 年意见明确「inference 一经生成就成为个人信息」，删除权覆盖 "about" 而不仅 "from"；删除落实要求 "remains deleted, deidentified, or aggregated"。
- **PIPL 第 47 条**：处理目的已实现/不再必要、停止提供服务、撤回同意时，处理者**应当主动删除**；第 4 条「个人信息」为宽口径（「与已识别或者可识别的自然人有关的各种信息」）。
- 监管执法（Garante 对 OpenAI、EDPB ChatGPT Taskforce）聚焦训练法律依据与透明度，未涉及记忆级联。

### 5.2 行业数据实践要点

- **30 天硬删除窗口**是 OpenAI 与 Anthropic 对已删除对话的共同基线（安全/法律/匿名化例外）；
- **匿名化是延长保留的通用前提**（Anthropic 去标识训练数据 5 年等）；
- **工程共识：lineage + 级联**——派生数据须记录来源，删除时全链路级联，「只删主库」是公认反模式；向量数据库厂商（Pinecone 等）把按元数据清除定位为 GDPR 删除权的直接支撑；
- **软删除需配定时硬清**（timed purge）才能满足删除权；
- **未找到任何主流产品提供「删除对话时同时删除派生记忆」的选项或确认弹窗**——主流设计一律是「分离管理 + 独立删除入口」。

### 5.3 对本地插件的定性【推断】

dsh-brain 是**单用户本地插件**：数据不出机器、无控制者-处理者关系，GDPR/CCPA/PIPL 的法定义务不直接适用（用户自己就是数据的全部主体与持有者）。法规结论在这里的作用是**校准预期**：

1. 「删除对话 ≠ 要求删除记忆」在用户预期与合规语义上都是成立的（删除应是显式、可审计的请求）；
2. 但「用户原话逐字长期保留 + 不可见的残留通道」确实与「存储限制/数据最小化」的精神相悖——补上**可见性与清理入口**即可消除这个落差，而不需要自动级联。

---

## 6. 综合分析与建议

### 6.1 三种模式与 dsh-brain 的位置

| 模式 | 代表 | 删除对话时 | 适用语义 |
| --- | --- | --- | --- |
| A 解耦 | ChatGPT、Claude、Claude Code、Codex、mem0、LangGraph、**dsh-brain 现状** | 记忆保留 | 记忆=用户/项目资产，对话只是来源 |
| B 引用计数级联 | Zep、Cognee、MemOS、Supermemory | 只删「仅由该对话派生」的 | 知识图谱/多来源融合库 |
| C 会话绑定 | Claude 旧版摘要（synthesis）、Gemini 历史记忆、Microsoft 推断记忆、ChatKit items | 派生物跟随删除 | 会话摘要/个性化，非长期记忆 |

**建议：保持模式 A 为主体，向其补齐「显式清理入口」，不做自动级联。** 理由：

1. **产品语义**：跨会话召回是 dsh-brain 的核心价值；删除对话就清记忆，等于任一次 UI 整理都可能清空记忆库，产品价值自毁。业界无一例外。
2. **技术安全**：`key` 合并覆盖 `source`（§2.1），级联无法判断「仅由该会话派生」，必然误删（Zep 靠完整 lineage + 引用计数才敢做）。
3. **用户预期**：ChatGPT、Claude、Microsoft Copilot、Perplexity 都把「删除对话不删记忆」写进官方文档并配独立管理入口——这是被教育过的用户基线。
4. **合规语义**：删除应是显式请求（mem0 的设计理由原文：「Satisfies user erasure (GDPR/CCPA) without touching the rest of your data」）。「删对话」的动作语义不含「删记忆」。
5. **历史证据**：Anthropic 旧版 memory synthesis 是「记忆跟随对话级联删除」的真实样本（对话删除/到期后 24 小时内从记忆移除），新版切换为独立话题条目——级联方案被头部厂商实践后放弃。
6. **记忆形态**：业界清晰区分「提取式记忆」（不级联：ChatGPT saved memories、Claude 新版、Microsoft saved memories、Perplexity；Cursor Bot 连 reset 对话都保留记忆）与「引用式记忆」（删除源对话即失效：ChatGPT Reference chat history、Gemini 历史记忆、Microsoft chat-history 推断）。dsh-brain 只有提取式记忆（明确不扫描聊天历史做 RAG），落在「不级联」一侧没有歧义。

### 6.2 建议清单（按优先级）

| 优先级 | 建议 | 说明 | 业界对标 |
| --- | --- | --- | --- |
| **P0** | **文档透明化** | 在 README「数据边界与限制」明确写：删除或归档对话**不会**删除已提取的记忆；自动学习的记忆正文是用户原话的逐字片段；想清理用 `/brain forget` /（新增的）会话级清理 / 导出后删除 dataDir | ChatGPT / Claude 帮助文档原文明示 |
| **P0** | **`/brain forget-session <id前缀>`** | 利用现有 `source` 溯源批量删除该会话产生的记忆 + 写墓碑（防复活）；人格证据只能按「该会话中同时产出记忆的轮次」用 `source` 里的 turnId 反推轮次哈希做**部分**清理，完整清理依赖下一条 P1。配套 `/brain sources` 列出各来源会话的记忆数，方便定位 id | mem0 `delete_all(run_id=...)`（官方场景名就叫 "Clean up a session"） |
| **P1** | **`/brain clear`（全清）** | 带确认的一次性清空 memories + tombstones + processedTurns + 人格证据（可选保留人格数值与历史）；导出备份提示 | ChatGPT *Delete and turn off memory*、Claude *Reset memory* |
| **P1** | **人格证据加会话溯源** | `evidence` 条目从「turn 哈希」升级为带 sessionId（或哈希前的明文 id），使 forget-session 能连带清理风格证据；目前只有 reset/rollback 全清可用 | mem0 实体标签、Zep episode 关联 |
| **P2** | **宿主删除事件 + 可选级联配置** | 若宿主未来提供 `session/deleted` 事件：加 `forgetOnSessionDelete` 配置，**默认 false**；在此之前不做文件系统监听（无法区分归档/删除、跨平台不可靠、与宿主竞态） | Claude 企业版保留期级联（opt-in 语义） |
| **P2** | **dream 合并保留溯源并集** | v0.4 dream 落地为写入式合并时，被合并记录的 `source` 应聚合（`supersedes` 关联），否则 forget-session 会失准 | Cognee per-document ownership |
| **P3** | **`processedTurns`/`tombstones` 设上限** | 两者无上限增长（§2.4）；建议上限或按时间裁剪。注意：清理 processedTurns 理论上允许同轮次重放重学，但对话已删时无重放来源，风险仅在「清理了仍存活会话的哈希」时出现——按会话清理即可规避 | 存储限制原则的工程化 |
| **P3** | **软过期（可选）** | 记忆加 `expiresAt`/`lastHitAt`，检索时跳过过期项（隐藏不删除，可逆）；与 [ARCH-BENCHMARK.zh-CN.md](ARCH-BENCHMARK.zh-CN.md) P1-5「使用反馈与时间衰减」合并考虑 | mem0 `expiration_date`（"hides, not deletes"）；GitHub Copilot Memory「28 天未用自动删」 |

值得注意：「按来源清理」在整个业界是普遍空白——ChatGPT 的 saved memories 无溯源界面，Claude 仅在引用处回链原对话，Grok 只有引用卡片，没有一家提供「按来源对话批量清理记忆」的能力。dsh-brain 已有的 `source` 溯源 + 建议中的 `/brain forget-session` 若落地，将是超出当前主流产品的差异化能力，且不违背「不级联」共识——因为它仍然是用户的显式操作。

### 6.3 决策矩阵（推荐行为）

| 用户动作 | dsh-brain 建议行为 | 业界对应 |
| --- | --- | --- |
| 归档对话 | 什么都不做 | 所有产品一致 |
| 删除对话 | 默认保留记忆（现状即正确） | ChatGPT / Claude / Claude Code / Codex |
| 删除对话且想清掉相关记忆 | `/brain forget-session`（新增，显式操作） | mem0 "Clean up a session" |
| 全部重来 | `/brain clear`（新增）或 export + 删 dataDir | Reset memory / Delete and turn off |
| 删除整个项目目录 | 可考虑后续加 `/brain forget-workspace <路径>` | Claude 企业版「删项目级联删项目记忆」 |
| 卸载插件 | 保留记忆（现状），文档已说明彻底删除方式 | — |

### 6.4 与既有路线图的关系

- [ARCH-BENCHMARK.zh-CN.md](ARCH-BENCHMARK.zh-CN.md) P2-7「会话级/临时开关」（对标 Codex `threads.memory_mode`）与本报告互补：开关控制**写入**，本报告的入口控制**清除**；
- P1-5「使用反馈与时间衰减」可与本报告 P3「软过期」合并实现（`lastHitAt` 一字段两用）；
- dream 合并（P1-6）落地时必须同步考虑 P2 的溯源聚合，否则 forget-session 的准确性会随合并次数衰减。

---

## 7. 证据复核方式

```powershell
# 本地：溯源字段与合并覆盖
Select-String lib\core.js -Pattern 'user-turn|safeId|processedTurns'
# 本地：记忆正文=evidence（用户原话）
Select-String lib\extraction.js -Pattern 'text: evidence|userText.includes'
# 本地：插件事件订阅面
Select-String lib\index.js -Pattern "ctx.on\("
# 本机数据：来源会话与磁盘目录的对应（只读统计）
$b = Get-Content "$env:USERPROFILE\.dsh\brain\brain.json" -Raw | ConvertFrom-Json
$b.memories | Group-Object { ($_.source -split ':')[0..1] -join ':' } | Select-Object Count, Name
# 宿主：会话生命周期事件（提取模块中检索）
Select-String .runtime-inspect\dsh-session-index.js -Pattern 'session/created'
```

联网结论的来源链接全部在 §9；`.tmp/pages/` 内有 Claude.ai、Claude Code、zcode、Codex 等页面的本地缓存原文（URL 在各文件首行）。

---

## 8. 局限与未验证项

1. **DSH Desktop 的「归档/删除对话」对磁盘的具体作用未验证**（客户端代码在 app.asar 内未提取）；本报告只确认了「插件侧无对应事件」。
2. OpenAI / Google / xAI / Meta / Perplexity / Character.AI / Replika 的部分官方页面反爬或超时（直接抓取失败），原文经多语言版本、搜索快照或第三方一致转载交叉确认，已在 §3 逐条标注；Grok 与 Meta AI 的「删除对话是否删除记忆」在官方渠道无公开说明（Grok 仅泄露的系统提示词提及级联，非官方文档，仅供参考）。
3. A-MEM、MIRIX 等论文系统未讨论对话删除生命周期（子代理确认「未找到」）。
4. 主流产品均无「删除对话时级联删记忆」的先例，故本报告的反对级联建议属于**归纳性结论**，不是被法规强制的要求。

---

## 9. 参考来源

**官方文档（产品）**

- [OpenAI — Memory in ChatGPT](https://help.openai.com/en/articles/8590148-memory-in-chatgpt)（官方镜像：[help-lb.openai.com](https://help-lb.openai.com/en/articles/8590148-memory-in-chatgpt)）
- [OpenAI — Chat and file retention in ChatGPT](https://help.openai.com/en/articles/8983778-chat-and-file-retention-in-chatgpt)
- [Anthropic — Use Claude's chat search and memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)
- [Anthropic — How long do you store my data?](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data)
- [Claude Code — How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Codex memories（官方文档镜像）](https://github.com/crasuna/openai-dev-docs-cn-mirror/blob/main/sources/en/codex/memories.md)
- [Google — Gemini Apps Privacy Hub](https://support.google.com/gemini/answer/13594961)
- [Gemini CLI — Memory files](https://geminicli.com/docs/tools/memory/)
- [zcode — Memory](https://zcode.z.ai/en/docs/memory)
- [Google — Get personalization with memory of your past Gemini chats](https://support.google.com/gemini/answer/16598469)
- [Google — Save info and reference past chats in Gemini Apps](https://support.google.com/gemini/answer/16413516)
- [GitHub Copilot — About session data](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/session-data)
- [VS Code — Use memory with agents（Copilot Memory）](https://code.visualstudio.com/docs/copilot/agents/memory)
- [Microsoft Learn — Personalize Copilot with memory and custom instructions](https://learn.microsoft.com/en-us/training/modules/write-effective-prompts-do-more-prompting/3a-personalize-copilot-memory-instructions)
- [Microsoft Learn — Manage Copilot personalization and memory](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory)
- [Perplexity — Memory](https://www.perplexity.ai/help-center/en/articles/10968016-memory)
- [Cursor — What your Bot remembers](https://cursor.com/help/grok-bot/memory)
- [Devin（Windsurf）— Memories](https://docs.devin.ai/desktop/cascade/memories)
- [Character.AI — Smarter Memory for Smarter Chats](https://blog.character.ai/memory/)
- [Replika — Can I delete my conversations?](https://help.replika.com/hc/en-us/articles/4410750548493-Can-I-delete-my-conversations)
- [past.dev — Grok memory teardown（转录官方公告/FAQ）](https://past.dev/blog/grok-memory)
- [xAI grok-build — Memory 用户指南](https://github.com/xai-org/grok-build/blob/8adf9013a0929e5c7f1d4e849492d2387837a28d/crates/codegen/xai-grok-pager/docs/user-guide/13-memory.md)
- [OpenAI — ChatKit delete thread](https://developers.openai.com/api/reference/resources/beta/subresources/chatkit/subresources/threads/methods/delete.md)

**官方文档（框架）**

- [mem0 — Delete Memory Operation](https://docs.mem0.ai/core-concepts/memory-operations/delete)
- [mem0 — Memory Expiration](https://docs.mem0.ai/platform/features/memory-expiration.md)
- [mem0 — Entity-Scoped Memory](https://docs.mem0.ai/platform/features/entity-scoped-memory.md)
- [Letta — Delete Conversation](https://docs.letta.com/api/typescript/resources/conversations/methods/delete)
- [Letta — Conversations (threads)](http://docs.letta.com/guides/core-concepts/messages/conversations/)
- [Zep — Deleting Data from the Graph](https://help.getzep.com/deleting-data-from-the-graph.md)
- [Zep — Facts](https://help.getzep.com/facts.md)
- [LangGraph — Stores](https://docs.langchain.com/oss/python/langgraph/stores.md)
- [Cognee — Forget](https://docs.cognee.ai/core-concepts/main-operations/forget)
- [MemOS — delete_memory](https://github.com/MemTensor/MemOS/blob/main/docs/en/open_source/open_source_api/core/delete_memory.md)
- [Supermemory — Forget by ID](https://supermemory.ai/docs/v5/api-reference/content-management/forget-memories-by-id)
- [Supermemory — Delete documents](https://supermemory.ai/docs/v5/api-reference/content-management/delete-documents)
- [Memobase — Delete User](https://docs.memobase.io/api-reference/users/delete_user)

**法规与合规**

- [EDPB Guidelines 01/2022（right of access，inferred data 分类）](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-012022-data-subject-rights-right-access_en)
- [ICO — Storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)
- [加州 CCPA § 1798.105 法条原文](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1798.105&lawCode=CIV)
- [Wilmerhale — 加州 AG 关于 inferences 的意见解读](https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20220316-california-office-of-the-attorney-general-clarifies-what-constitutes-an-inference-under-the-ccpa)
- [PIPL 第 47 条全文（国新办刊载）](http://www.scio.gov.cn/xwfb/gwyxwbgsxwfbh/wqfbh_2284/2021n_2711/2021n11y16r/wjxgzc_4286/202208/t20220808_315296.html)
- [Bird & Bird — Agentic AI 与 GDPR 合规](https://www.twobirds.com/en/insights/2026/two-eras,-one-rulebook-what-agentic-ai-does-to-your-gdpr-compliance)
- [Dentons — EDPB ChatGPT Taskforce 报告解读](https://www.dentons.com/en/insights/articles/2024/june/18/to-scrape-or-not-to-scrape-eu-authorities)

**工程实践**

- [Pinecone — Update, Delete, and Fetch by Metadata（GDPR 清除）](https://www.pinecone.io/blog/update-delete-and-fetch-by-metadata/)
- [Attio — Archiving vs deleting（归档/删除语义）](https://docs.attio.com/docs/archiving-vs-deleting)
