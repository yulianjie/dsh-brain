# DSH Brain 架构与设计

设计始于 2026-10-26，更新于 2026-11-02。当前本机 Desktop bundled runtime 为 0.2.1-rc.5（Electron 44.7.0、内置 Node.js 24.21.0），0.6.0 源码 runtime smoke 已通过，使用合成 provider adapter，不是在线 LLM 质量评测。Node.js 22.13 起支持无启动 flag 的 `node:sqlite`。本文说明当前设计和行为约束，开发方式见[贡献指南](../CONTRIBUTING.md)。

## v0.6：SQLite 存储与自动记忆边界

持久化数据库位于 `<dataDir>/brain.sqlite`，使用 Node 内建 `node:sqlite`、SQL 表和事务；没有新增 npm SQLite/native 依赖。Node.js 22.13 是 CLI 的最低版本。JSON 仍是备份与交换格式：导入导出保持 `schemaVersion: 1`，默认 `maxMemories` 仍为 500。首次启动发现旧 `brain.json` 时，以事务导入数据库，并保留旧 JSON 原样备份。迁移只复制已有数据，不调用 LLM 重写历史记忆正文。删除标记按记录身份与正文身份过滤旧备份；只有带稳定属性 key（包括自动生成的语义 key）的自动记忆才额外使用来源 evidence 作为同一属性的重放标记。无 key 记忆不会因共享 evidence 而互相删除，也不承诺识别任意语义改写后的重放。

轮次去重账本只记录非空提取：空提取不会占用 `processedTurns`。账本只保留最近 4096 个已处理轮次；被淘汰的旧轮次之后再次出现时，不再保证跨进程或跨窗口幂等。删除 tombstone 哈希永久保留，用于阻止旧备份重新导入已忘记的记忆；正常检索与上下文生成的热路径不读取这两个账本。模型和记忆工具使用严格的新数据库快照；并发恢复导致读取忙碌时不回退到旧记忆缓存，自动上下文会跳过该次参考，避免重新暴露另一实例已遗忘的内容。

自动学习的记忆正文取模型整理的摘要，原始用户证据独立保存供校验与追溯，不注入模型上下文。模型不可用时，不再把本轮原文自动保存为 memory；交流风格的数值反馈仍可走受限的本地降级规则。用户明确执行 `/brain remember` 或 CLI `remember` 时，仍按指定文本直接保存。

0.6.0 同时收紧若干提取、删除和权限边界：否定及临时风格语句不再被误当作全局长期风格；全局 scope 识别避免错误标注和重复写入；短 `updateOf` 纠正可更新已有记录；不同语言偏好的语义 key 不再冲突；共享 evidence 支持的独立记忆在删除与备份导入时互不误删；写入和遗忘仅对根 Agent 开放，子 Agent 仍可按需使用只读记忆工具；主题切换时移除无关旧引用，并修复参考消息更新对提示词缓存的影响。源码基线中已有的跨对话隔离也纳入本版：子 Agent 不接收其他对话的 Brain 参考。

## 2026-10-27：上下文与稳定性改进

当前工作区新增全局核心偏好召回、查询预览/全文分页、字符与估算 Token 双预算、单个当前参考消息和近期风格共识。设计依据、迁移边界、缓存取舍与验收见[调研与改进评估](MEMORY-CONTEXT-REVIEW.zh-CN.md)。新设置总数为 23；旧版本验收记录中的 20 项保留为历史记录。

## 2026-10-27：原生插件配置界面

常用配置通过宿主原生设置通道提供：服务端导出带 volatile 字段的 Config，客户端通过原生插件详情页的配置插槽和 configForms 显示表单、暂存修改、保存、校验及错误状态。仅声明 Config 并不能保证当前 rc.3 客户端显示表单，必须同时交付客户端模块。

- 自动学习：总开关及独立性格学习开关。
- 记忆与上下文：是否注入记忆/性格、记忆容量、注入条数及字符预算。
- 提取模型：提供方和模型留空时跟随当前会话；超时、输入长度、队列长度、输出预算等常用限制。
- 交流风格：自动演进、手动指定、关闭三个模式；手动模式提供五个 0..1 维度。
- 高级选项：SQLite 并发写事务等待等安全数值限制；存储目录保留为结构性配置，避免在设置页误切换数据位置。

设置与已有记忆/人格状态分离。手动模式只改变当前注入的风格，不调用 setPersonality/reset；恢复自动模式后继续使用原有学习结果。独立性格学习开关还遵循已有人工冻结状态。后台任务在配置变更时取消或失效，关闭学习后不能通过旧任务继续保存。校验失败不能部分覆盖有效配置；与当前存储容量冲突的缩容不能静默删除记忆。

0.2.0 验收覆盖真实宿主设置命名空间与 volatile 更新、配置持久化、客户端模块注册、原生 Desktop 页面显示、保存后离开再进入仍保留值，以及配置修改不重置学习状态。

## v0.4：风格文本化与 dream 规划（只读）

v0.4 第一阶段先解决两个只读问题：模型如何直接理解风格偏好，以及如何发现值得合并的记忆。两者都不改变持久化结构。

风格注入从裸 JSON（`{"mode":"adaptive","traits":{"warmth":0.62,…}}`）改为自然语言行为约定。`lib/style.js` 按固定顺序（warmth、verbosity、humor、proactivity、formality）把每个维度分到 low/mid/high 三档，0.35 与 0.65 属于 mid，只把非 mid 维度渲染成逐字固定的句子，全部 mid 时输出中性句。`context()` 只拼接 `BRIEF_HEADER` 与正文，不再注入 mode、维度名或数字；adaptive 使用当前学习值，manual 使用手动值，off 不注入。分档意味着 0.45 这类档内漂移不会改变提示词，只有跨档才改变行为描述，这是有意的稳定性取舍。

`lib/dream.js` 是纯函数规划层：`groupCandidates()` 先在相同 scope/workspace 内按非空 key 成组，再按 `normalized(text)` 的哈希做线性精确去重，剩余记录才用共享分词模块 `lib/text.js` 建 term 倒排索引，只比较共享词项的对，并设 20 万次比较上限；超限时 `planDream().stats.truncated` 为 true。只返回至少两条的组，超过 20 条的组按 id 排序切成多个 2..20 的块，排序确定。`dreamPayload()` 生成有组数、记忆数、文本长度上限的模型输入；`validateDream()` 结构性问题一律抛出带字段信息的 `Invalid dream plan:` 错误，缺省的 `groups`/`contradictions`/`drop` 按空数组处理，显式类型错误仍拒绝；文本忠实性不足则把 `line` 降级为组内最新记录的索引行并记入 `degraded`，时间戳按解析后的时刻判定并列。`planDream()` 只做计算，不做 IO。`brain.dreamPlan()` 与 `/brain dream [--json]` 读取一致的数据库快照后直接返回规划，不落盘。

两条对抗审查后收紧的硬规则。其一，**记忆优先于风格**：`context()` 先用 header 预算挑选记忆，最后仅当 `header + 风格段 + 记忆块` 整体仍满足预算时才追加风格段，否则丢弃风格段；因此 `maxContextChars=300` 这类窄预算下保留的是一条记忆而不是中性风格句——风格是软偏好，事实是本体。其二，**索引行不得造词**：`line` 中每个中文二元组都必须出现在组内原文中（ASCII 词同样要求子集），任一行不满足即降级为抽取式索引行；原先的 0.6 覆盖率阈值会让「三点→四点」这类单词替换通过，等于把防伪造线降到 82%。此外 `title`/`line`/`brief`/`reason` 拒绝控制字符与双向覆盖字符，`drop` 的重复 id 去重。

**v0.5 当时为什么不迁移 JSON schema**：上述输出都可以从 `schemaVersion: 1` 状态重新计算，风格文案与候选组不是新的持久事实。当时保持零迁移可把风险限制在只读路径；v0.6 后端改为 SQLite，但 JSON 交换格式继续使用 `schemaVersion: 1`。

## v0.5（历史）：写时去重与价值门槛

v0.5 修两个已确认的写入缺陷：同一偏好以多条近似记录并存（三条写入路径的 key 命名风格不同、措辞转述无法命中旧的精确匹配），以及瞬时任务状态（CI 状态、测试结果、分支名）被模型提取路径存成 fact。方案是写入端的三层防线，当时保持 JSON `schemaVersion: 1`、零新增持久字段。

### 调研依据（按行为级表述）

- **Codex**（提示词与官方配置参考的行为，两份报告交叉一致）：写任何记忆前先问「未来的 agent 会因为这条内容而合理地表现更好吗」，否即 no-op 且 no-op 被偏好；明确不存一次性查询、无 takeaways 的状态更新、临时事实、未采纳的 assistant 提议与泛泛建议；整合期「两条内容若导致相同未来行为则合并，保留更尖锐的那条」，关键词重叠本身不构成合并理由，拿不准时保留边界。
- **mem0**（arXiv:2504.19413 与仓库源码）：写时四元组决策 ADD/UPDATE/DELETE/NOOP，检索 top-10 相似记忆交给 LLM 判定；UPDATE 保留旧 id；「传达同一件事时保留信息量最大的一条」，同义且信息量不增则 NOOP；主判定交模型语义判断，数值阈值只用于低层精确匹配。
- **Claude**（官方文档与产品文本）：写入门槛是「would be useful in a future conversation」；可重新查询的数据、可重新推导的建议、自带时效的陈述（停车位、天气、当前分支）不存；read-before-write 的可见性移植为 `brain_remember` 返回 `merged` 标志。
- **Letta**：durable 才入记忆，/doctor 审计重复，合并前可备份。

形态适配结论：dsh-brain 是本地单文件、无后台服务、注入预算有限，取 mem0 写时四元组决策 + Codex 会话资格过滤的「写入端把好关」路线，而非 v3 ADD-only + 云端整合路线；文档引用按行为级表述。

### 三层防线

**层 1 确定性去重合并（`lib/core.js` `_remember`）**。同 scope+workspace 内按优先级首中即止：(a) 精确 key；(b) 归一化文本精确；(c) canonical key（`canonicalKey` 取小写字母数字，两侧均 ≥8 码位，短 key 不合并；canonical 相等还要求两文本至少共享一个词项，零重叠的不同事实不因 key 碰撞合并——「关键词重叠是佐证而非理由」的逆命题）；(d) 归一化文本包含关系且较短侧 ≥6 码位；(e) term-Jaccard ≥ 0.75（复用 `lib/text.js` 分词与 dream 同款 `similarity()`，后者从 dream.js 移到 text.js 导出）。多条匹配取优先级最高、其次数组顺序最早的一条，结果确定。

**一般去重的 informative 策略（「保留信息量最大」）**：对一般的相似内容合并，新文本归一化长度至少达到既有文本的 60% 时由新文本胜出；更短时保留既有正文，仅刷新 `updatedAt`，避免短促重述削弱记录。显式用户命令或 CLI 的 `id` 可以直接替换正文。模型 `updateOf`、模型工具的 `id` 以及无 id 的 key 合并，须先由正文支持相同属性：匹配已知语义偏好 key，或共享非泛化主题词。通过该检查的明确纠正可直接替换，不套用 60% 阈值；更新后保留既有 `id` 与 `createdAt`。一般 informative 合并保留既有 key，confidence 取两侧最大，kind/source 跟随胜出文本，personalityTraits 取并集。`brain_remember` 返回 `merged` 布尔标志。

**为什么 0.75 而不是 dream 的 0.6**：dream 是人工复核候选的只读门槛，写时自动合并没有复核环节，取更高门槛减少误合并；实测的重复案例（0.857 一档）仍被覆盖，0.6–0.75 区间的转述交由模型层 updateOf 处理，两条阈值之间的对继续作为 dream 候选保留边界。

**层 2 记忆价值门槛（`lib/extraction.js` `validateExtraction`，只作用于 memories 分支）**。豁免优先：包含句以「请记住/记住/remember」开头或含 durable cue（以后/今后/往后/一直/每次/总是/always/from now on，与风格学习共用同一 `durableCue` 集合）则不过滤。拒绝模式为锚定式、作用于 evidence 本身：纯 URL、git ref 形状（无空格与中文的 `owner/shape`）、`文件.扩展名:行号`、`结果|状态|进度|输出|日志` 引导、状态 emoji 引导、状态收尾谓词（有问题/报错/失败了/没通过了/修好了/消失了…，含完成态「了」后缀）、测试与构建结果快照（`N 个测试全部通过`、verify/ci/build + pass/passes/passing/fail/fails/failing/passed/failed/green/red）。命中即 `rejected++` 丢弃；feedback 分支与离线 fallback 的产物（请记住句、风格句）不受影响。

**层 3 模型路径语义判定（`lib/index.js` + extraction + core）**。`extract()` 注入 top-10 同 scope 相似既有记忆为 `EXISTING` 上下文（id + key + 文本截 200 码位，只读快照，读取失败降级为空列表）；`EXTRACTION_PROMPT` 与独立构造器 `extractionPrompt()` 加入价值门槛与时效措辞；模型可对重述/更新候选返回 `updateOf`（非空字符串 ≤100，`validateExtraction` 透传，存在性不在此校验）。`learn()` 在同一事务中检查目标的 scope、workspace 与相同属性支持；通过检查的 `updateOf` 可直接更新，正文替换不受 60% 阈值约束。无效、陈旧或与新事实无关的 id 按普通新增继续处理，旧记忆保留；与无关属性冲突的 key 会从新增记录中移除。

### 明确不做（后续方向）

- 后台整合（Kairos/AutoDream 式 idle 后全局整合、24h 门控）：先验证写时防线效果，dream 保持只读。
- 老化淘汰（last_used/30 天未用）：需新增持久字段，超出本次零迁移边界。
- 会话 idle ≥6h 才提取：交互式桌面场景不适用。
- 冲突 DELETE/自动矛盾消解：dream 矛盾检测保持只读、人工确认。
- v0.5 时 `processedTurns` 与 tombstones 尚未限长；v0.6 的保留策略见本文「SQLite 存储与自动记忆边界」。

### 已知边界（对抗性验证确认的取舍）

- **模型不可用时没有自动记忆原文 fallback**：这是为避免把未经整理的当前轮文本当作长期记忆；需要直接保存时，用户可明确使用记忆命令。
- **包含关系合并可翻转否定**：「不要总是主动建议」被「总是主动建议」包含式合并且新文本胜出时否定丢失——这是「重述即纠正」语义的固有取舍，与显式 id 改写的纯替换语义一致。
- **守门按锚定保守设计允许漏放**：「测试全绿」「pr 123 已经合并了」等口语化状态仍可能通过；英文 CI/test 词汇带（无 always/以后 等耐久措辞时）存在系统性误杀可能。误杀可由「请记住：」显式意图豁免找回。
- **canonical key 同主题碰撞仍可能合并**：零词项重叠已挡；共享个别词项的不同事实若碰巧同名 key，仍会被合并——低概率残余风险。

## v0.6：注入隔离（防止跨对话串味）

每次模型请求都带一条 Brain 参考消息（`lib/index.js` 的 `contextFor()` 调用 `Brain.context()`）。记忆一多，这条消息就混进其他对话的记忆，模型会把它们和当前对话混为一谈。已确认的原因有五个：

1. 子 Agent 拿到最新 10 条。宿主对每个 Agent 都触发两个钩子，但 `agent/inbox/claimed` 只为根 Agent 记录查询文本，子 Agent 的查询恒为空，`_rank` 给每条记忆 1 分，于是按 `updatedAt` 注入最新的 `maxContextMemories` 条。
2. “继续”“好的”这类无内容轮次同样退化为最新 N 条，或者命中虚词。
3. 没有相关度下限：共享一个泛用二元组（配置、测试）就能入选；排序只是包含的查询词个数，其次新近度。
4. 每次只看当前轮文本，入选集合逐轮抖动（同一话题 5 轮内重合率 50% → 33% → 0%），每次变化都改写参考节点，也破坏提示词前缀缓存。
5. 注入行没有来源和日期，模型分不清早先对话里的事实和本对话里刚说的话。

### 规则

- **只有根 Agent 有参考消息。** `contextFor()` 对缺失或非根 Agent 返回空串；`agent/pre-step` 与 `agent/request` 对非根 Agent 原样返回决策或请求，记忆和风格段都不给。根 Agent 的判定与宿主一致：`ctx.agents.roots().includes(agent)`；该调用抛错时视为未知：两个钩子原样返回、不写会话（既不注入，也不退役参考），模型请求照常进行；查询失败时认领的用户消息或结束的轮次不会被学习；只有查询成功且确认不是根的 Agent 才走非根路径。旧版本若在子 Agent 会话上留下过 Brain 参考节点，子 Agent 的下一次请求（未中止时）用 `updateContext(session, '')` 把它替换成 `Brain reference disabled.`，之后幂等；没有这种节点时不写任何事件，任何错误都被吞掉。
- **读权限与上下文注入分开。** 子 Agent 不接收注入的 Brain 参考，但可调用只读 `brain_search`、`brain_list`、`brain_read` 和 `brain_personality` 工具。`brain_remember`、`brain_forget` 与 `/brain` 修改命令必须确认当前 Agent 是根 Agent；根身份查询失败或结果未知时，写入和遗忘均拒绝执行。
- **忽略的词项。** 索引和查询使用同一套过滤：固定停用词表（中文虚词与口头语二元组；“收到”“谢谢”“没问题”等确认语；“方案”“第二”“下一步”等选项用语；“有没有”“要不要”等泛泛追问；英文功能词与 thanks、ok、next、done、lgtm 等确认语）、含“的了吗吧呢啊嗯哦”任一字的中文词项（“好的继续”切出的“的继”这类跨词边界的二元组），以及一到两位的 ASCII 数字（“2”“方案 2”这类选项）。
- **只有当前轮能引入记忆。** `lib/relevance.js`（纯函数，无 IO）对可见、可注入的记录做二值词频 BM25，词项取 `terms(normalized(text + ' ' + key))` 再按上面的规则过滤。候选必须命中至少一个当前轮词项；之前的用户消息只加分、只为弱匹配作证，永远不能单独引入记忆，也不参与相关度下限。
- **独立证据。** 查询先切成单元：一个 ASCII 词或单个汉字是一个单元；两个及以上汉字的连续片段是其二元组序列，被忽略或未入索引的二元组留作空位。一条记忆的独立命中数 = 命中的不同单词单元数 + 汉字片段里相邻命中二元组的极大连续段数，其中一段只有带来尚未计过的词项时才计数。因此一个词的重叠二元组（数据/据库）只算一次命中，查询里重复的词（“登录还是登录”“CI 和 CI 有啥区别”）也只算一次。
- **强与弱。** 满足任一条件即为强候选：库内可注入记忆少于 `SMALL_STORE`；独立命中至少 2 个；命中某个文档频率不超过 `max(2, min(WEAK_MAX, SPECIFIC_RATIO × N))` 的当前轮词项。其余为弱候选；一旦之前两轮贡献了历史词项，弱候选还必须命中其中至少一个才可接受。
- **相对下限只看当前轮。** `top` 取强候选与可接受弱候选的当前轮得分最大值，当前轮得分低于 `REL_FLOOR × top` 的候选全部丢弃，强候选也不例外。历史得分的一半只加在排序用的总分上。
- **无内容延用与历史桥接。** 当前轮没有可匹配的词项时，沿用本会话仍可见、可注入的参考记忆，使工具步骤和无内容轮次保持稳定。有当前轮证据时，候选必须通过 `REL_FLOOR × top` 的当前轮分数门槛；历史分数不能引入候选或提高此门槛。通过门槛的强当前候选表明主题已切换，会清除仅靠历史保留的旧引用。弱候选需通过同一分数门槛并得到最近两轮用户历史佐证；它与当前候选共享的历史词项也可桥接仍相关的历史引用。核心全局偏好的 id 先从参考在任者中去掉，它们照旧走核心通道，不会绕过 1/3 子预算。
- **顺序与弱名额。** 强候选 → 不在其中的在任者 → 弱候选；组内按总分降序、`updatedAt` 降序、`id` 升序，结果确定。命中当前轮但不强的在任者占用弱名额，第三组只取 `max(0, WEAK_MAX − 弱在任者数)` 条。条数与预算仍由 `context()` 施加，核心全局偏好排在最前。
- **对话窗口。** 查询是本轮真实用户文本；历史取本会话界面上最近 6 条真实用户消息里的最后 2 条，每条截 2000 个码点。本轮的消息按 id 排除：`agent/inbox/claimed` 记下本轮认领的真实用户消息 id，`recentUserTexts(session, limit, excludeIds)` 跳过这些消息且不占名额；没有 id 的消息再用 `current.includes(text)` 兜底。所以一轮里新消息还没上界面（第一次请求）和已经上界面（之后的步骤）时历史相同，超过 `extractionMaxChars` 被截断的长消息也不会占历史名额。只读取 `role === 'user'` 且 `source.kind === 'user'` 的消息，不读工具输出、助手文本、其他会话或子 Agent；`referenceIds()` 从最后一个 Brain 参考节点读取 JSON 行的 `id`。这些辅助函数只读，出错时返回空结果。
- **来源标注。** 每行是 `{id, scope, from, saved, text}`（截断时再加 `truncated`）。`saved` 为 `updatedAt` 的日期部分。`from`：`user-turn:<sid>:<tid>` 中的 `<sid>`（前缀之后到最后一个冒号）等于当前会话的来源 id 时为 `this chat`，否则（包括未提供会话时）为 `earlier chat`；`user-command`、`cli`、`manual` 为 `saved by user`；`model-tool` 为 `saved by assistant`；其余为 `unknown`。当前会话的来源 id 与 `learn()` 写入时由同一个函数计算（疑似凭据的 id 取哈希，否则截取前 64 个字符），两边不会漂移。header 写明：`from` 不是 `this chat` 的条目只是可能过时或与当前任务无关的背景。
- **可观测。** `lastContextUsage.ids` 记录注入的记忆 id（输出顺序，没有则为 `[]`），`/brain status` 直接显示。

### 常量与理由

常量在合成语料上校准；改动它们需要重新跑 `test/relevance.test.mjs` 的期望表。

- `K1 = 1.2`、`B = 0.75`：BM25 的常用默认值。二值词频下 `K1` 只决定长度归一的幅度，`B` 让词项很多的长记录不会仅凭篇幅占优。
- `HISTORY_WEIGHT = 0.5`：历史是上下文而不是当前意图，只加一半排序分数。它可佐证弱续接，但不能单独引入记忆或抬高相对下限；当前轮有通过门槛的强匹配时，仅靠历史保留的旧引用会被移除。
- `SMALL_STORE = 20`：记忆很少时文档频率没有统计意义，小库中任一命中都按强处理，避免因噪声漏掉相关记忆。
- `SPECIFIC_RATIO = 0.05`（下限 2 条，上限 `WEAK_MAX` 条）：只出现在少数记忆里的词足够具体，单独命中即可；“配置”“测试”“登录”这类在一个项目里到处出现的词单独命中只算弱。上限保证可注入记忆达到 20 条后，不论库多大，一个词通常最多带入 3 条：要么不超过 3 条具体的，要么不超过 3 条弱的（各个二元组分别在不同记忆里罕见的长词组仍可能多带几条）；没有上限时，500 条记忆的库里阈值是 25 条，一个出现在 20 条记忆里的词会把 20 条全部带进来。代价是大库里单一概念的问题只带入可能更多匹配中最好的 3 条：在 500 条合成记忆的语料上，单短语召回率从 100% 降到 76%，精确率保持 100%；其余可以由模型调用 `brain_search` 取回。
- 没有长短语规则：一个泛用词或一个词组（“数据库”“设置页面”“数据库连接”）不论多长都只是一处命中，按弱处理，否则一个出现在二十条记忆里的词会把它们全部带进来。曾经试过“连续命中五个及以上汉字即算强”，后来去掉：真实文本里的多词短语本身含有跨词的罕见二元组，已能通过具体性判为强；这条规则唯一独有的效果是让常见长短语涌入，一个五字短语出现在 100 条记忆中的 20 条时会占满全部 10 个名额，去掉后为 3 条。
- `REL_FLOOR = 0.35`：相对下限去掉只沾一个边的条目，又不依赖分数的绝对尺度（库大小和文本长度都会改变绝对分）。只用当前轮得分计算，是因为与历史重叠的旧话题弱匹配曾把下限抬高，挤掉当前问题唯一的最佳匹配。
- `WEAK_MAX = 3`：新对话里的泛用词查询仍给出少量线索，但不会把同一泛词下的整批记忆塞进来。弱在任者计入名额，是因为每个工具调用步骤都会重跑 `agent/request`：若不计入，上一步的弱匹配作为在任者回来后每步再加 3 条（3 → 6 → 9 → 10）。
- 历史扫描 6 条、保留 2 条、每条 2000 码点：覆盖“上一轮问题 + 本轮追问”的常见形态。粘贴的长文本词项很多，每条截断限制了它对排序和作证的影响；但它在当前轮里仍可能凭多个共享词形成强候选（见已知边界）。
- 索引备忘：每个 Brain 实例按解析后的工作区缓存索引，最多 4 个、淘汰最久未用的；指纹是可见可注入记录按顺序的 `id`、`updatedAt`、正文内容与 `key`，CLI 或其他实例写入后下一次请求即重建，不跨实例共享；`maxContextMemories` 为 0 时既不建也不查。备忘只决定排序，注入文本总是来自本次重读的快照。

### 保持不变

`brain_search`、`brain_list`、`brain_read`、`/brain search`、`memoryPage()`、`search()`、`_rank()`、学习、写时去重、dream 与 CLI 都不变。`context()` 中每次重读与校验、字符/估算 Token 双预算与 header 优先装入、核心全局偏好（至多 `min(3, ceil(maxContextMemories / 3))` 条全局 `preference`/`instruction`，占约 1/3 Token 子预算）、只在全部装得下时才追加的风格段、按 id 排序的输出块都保持原样。`schemaVersion` 仍为 1，无新增持久字段、设置项或依赖。

### 已知边界

- 子 Agent 不再看到全局偏好（例如代码注释语言），需要父 Agent 在任务里转述，或由子 Agent 调用 `brain_search`。
- 新对话里的泛用词查询（如只问“登录”）仍会注入至多 3 条弱匹配：此时还没有历史可以作证。
- 粘贴的长文本词项很多，可能让关系不大的记忆凭两处以上独立命中成为强候选。
- 无可匹配主题的轮次会沿用在任引用；有主题证据时，候选受当前轮相关度下限约束，强新话题会移除 history-only 旧引用。弱候选仅在获得最近用户历史的共同证据时可续接。
- 被重述的事实保留写时合并中胜出文本的来源：短促重述只刷新 `updatedAt`，`from` 仍是原记录的来源。
- 二元组分词仍可能偶尔在词边界上切出无关匹配。
- 少数真实词语不能单独匹配：它们是停用词或含助词（例如“确认”“酒吧”）。
- 写入改变了可见记忆后，第一次请求要重建相关度索引，这次请求的构建时间随库大小增长。
- 可注入记忆少于 20 条的库跳过具体性与独立证据判断，任一命中都算强。
- 历史只覆盖本会话界面上之前两条真实用户消息；更早的轮次或已被压缩替换的内容不参与评分。

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
- `lib/storage.js`：Node 内建 SQLite 数据库、SQL 表、事务及旧 JSON 首次导入。
- `lib/text.js`：共享的 NFKC/空白归一化与 ASCII 词、中文单字/二元组分词。
- `lib/style.js`：把五维 trait 确定性地渲染成自然语言风格段（三档、固定句子表）。
- `lib/dream.js`：只读的候选分组、有界 payload、plan 校验与降级、规划入口。
- `lib/relevance.js`：自动注入的相关度选择（二值词频 BM25、强弱候选、相对下限、在任者保留）；纯函数，无 IO。
- `lib/context.js`：宿主当前参考消息替换、旧共享快照分节迁移、token 计量事件，以及只读的近期用户消息、参考 id 与参考节点检测。
- `lib/budget.js`：不依赖模型的 token 估算和 Unicode 安全输出预算。
- `lib/extraction.js`：结构化提取协议、校验、证据约束、中文/英文明确风格反馈的离线兜底。
- `lib/index.js`：Cordis apply，agent/request 参考消息替换、tools、commands、agent 回合事件、llm 服务适配。
- `lib/config.js`：原生 schema、默认值、范围校验、模型路由成对校验与 volatile 读取。
- `lib/client.js`：由宿主 ModuleLoader 加载的原生设置客户端；不能直接在 Node 中导入执行。
- `bin/brain.mjs`：本地管理 CLI；提供服务不可用时的人工控制。
- `scripts/install.ps1` / `uninstall.ps1`：默认定位 Desktop bundled CLI，调用受支持的插件管理接口，保留现有 profile 配置。
- `test/`：核心行为、边界、并发、宿主适配与客户端边界测试；使用临时合成数据。
- `scripts/runtime-smoke.mjs`：可选的真实 Desktop bundled runtime 服务验证。
- `scripts/check.mjs` / `package-check.mjs`：语法/文档检查与真实 npm tarball 安装检查。
- `.github/workflows/ci.yml`：Node 22/24 在 Windows、Linux、macOS 上的持续验证。

优先使用 JavaScript ESM、Node 内建模块，避免原生编译和额外数据库依赖。持久数据存入 `<dataDir>/brain.sqlite`，底层为 SQLite SQL 表和事务；Node.js 最低版本为 22.13。默认 `dataDir` 为 `$DSH_HOME/brain`（未指定时 `~/.dsh/brain`）。从旧版首次启动时会把 `brain.json` 事务导入数据库，并保留原文件作原样备份。JSON 只用于导入导出，schemaVersion 保持 1；默认容量 500 条。全局记忆、工作区记忆、人格分别管理；根目录可配置。

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
- `dreamPlan({threshold?,maxGroups?})` → `{groups,payload,stats}`；同步只读数据库快照，返回候选合并组，不写状态。
- 实现补充同步只读属性 `personalityGeneration`：在用户消息到达时快照控制代数，传入 `learn`；冻结、重置等人工控制递增代数，阻止先前在途提取继续影响风格。工作区也在消息到达时快照，避免本轮中途切换目录导致记忆串项目。

模型提取结果为 `{memories:[{text,kind,scope,key?,confidence,evidence}],feedback:[{trait,value,confidence,evidence}]}`；memory `text` 是模型整理的正文摘要；原始 `evidence` 独立持久化，只供校验追溯，不注入上下文。`evidence` 必须是当前 `userText` 的逐字片段；模型输出和工具输出不作为用户偏好证据。模型不可用时，不自动保存原文 memory，风格数值反馈允许受限本地降级。显式 `remember` 接口尊重用户直接提供的文本。trait 为 warmth、verbosity、humor、proactivity、formality，value 为 [0,1] 目标值。禁止根据人口学特征推断风格。

每个 trait 最近最多 5 次反馈中至少 3 个独立 turn、至少 75% 同向支持且最新反馈也同向才自动更新；取支持值中位数为目标，单轮 delta <= 0.05，目标距离 <= 0.05 时不微调；范围 [0,1]，默认中性；保持有限证据和变更历史、去重 turn。冻结时不积攒日后突然生效的漂移。人工设置立即生效。

## 聊天集成

启动时加载 SQLite 状态；根 agent 回合结束时只取本轮用户文本，排除 subagent、工具、runtime context。后台提取最多一个模型调用每轮，限制输入长度、并发、队列、超时；不能无限重试或递归生成 agent。凭据走宿主 llm，不另读 auth 文件。记忆写入与遗忘操作仅根 Agent 可执行；子 Agent 可按需调用只读记忆工具。首次请求通过 `agent/pre-step` 队列在系统头之后提交参考，后续 `agent/request` 在宿主准备模型请求时更新有来源的低优先级参考消息，文本不走模板插值。使用原生单节点 surface replacement 保留一个当前快照，写入相邻的 tokenMeter 计量事件供宿主重放和用量统计。原始日志不删除，旧共享 runtime 快照只移除 Brain 分节。保留用户当前指令优先。workspace 必须从该 agent/session 的 cwd 获取，不能用插件进程 cwd 代替。

模型工具使用 brain_ 前缀：搜索、列表、按 ID 分段读全文、记住、遗忘、性格查看；破坏性人格控制和导入导出由用户 `/brain` 命令或 CLI 完成。`/brain` 支持 help/status/list/search/remember/forget/personality/freeze/unfreeze/reset/history/rollback；复杂导入导出由 CLI 提供。

## 验证策略

核心测试：重启持久化、项目隔离、中英文检索、纠正去重、删除不复活、凭据过滤、非法提取、重复事件、多个实例竞争、损坏文件不覆盖、注入预算、人格渐进/冻结/回退。

宿主测试：从 Desktop app.asar 用 Electron Node 模式加载真实 Cordis、systemPrompt、agent、tools、commands、llm；挂载插件，驱动根会话事件/真实 agent loop，观察新 session prompt 中召回事实以及 trait 变化。模型测试优先可控 provider；若执行真实网络模型测试，仅使用专门合成对话，避免访问用户现有对话。

安装测试优先隔离 profile，确认包内容和 bundle 加载。若安装用户 desktop profile，则保留其他插件及配置，不自动强制关闭运行中的 Desktop。
