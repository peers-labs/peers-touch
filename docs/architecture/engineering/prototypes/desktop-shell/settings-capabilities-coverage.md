# Settings Capabilities 范围总账（AI / Channels / Advanced 能力下沉）

> 阶段：prototype implemented，pending Owner 体验（2026-10-23 落地，2026-10-24 收口审计）
> 创建：2026-10-23
> 实现：`packages/prototypes/desktop/shell/src/Settings.tsx` 及同级 section 组件，
> catalog 单一 owner 位于 `packages/prototypes/desktop/shared/capabilityStore.ts`
> 与 `shared/agentExtensionCatalog.ts`
> 门禁：`packages/prototypes/desktop/shell/qa/settings_capabilities_checks.cjs`
> 上游：本文是 [agent-chat-coverage.md](./agent-chat-coverage.md) 的姊妹总账，只冻结 Settings 工作面；
> Agent Chat/Profile/Topic 的边界不被本文修改。

---

## 1. 权威规则

- 本文件冻结 **Settings 内能力面**的产品边界；一级全局导航（Search / Chat / Agent /
  Moments / 通知 / 设置）**不新增任何入口**。
- Memory、Knowledge、Skills、MCP 下沉到 **Settings → AI**；
  Channel 能力在 **Settings → Channels** 做深；定时任务留在 **Settings → Advanced**。
  Plugins、Hooks 于 2026-10-24 defer（无消费面，见 §4.5/4.6）；Discover 节同日撤下。
- 参考工程（AgentBox `http://127.0.0.1:8436` 实例 #6，2026-10-23 live 走查）只作为
  信息架构、字段分组、状态表达与操作反馈基准；其一级 nav 形态、视觉皮肤、品牌不进入原型。
- 参考工程有而本文 IN 未列入的能力不得因"对齐"进入原型；本文 IN 而参考工程放在别处的能力，
  按本文归属实现，不机械复制其入口。
- **竞品遍历 → 场景推导 → 台账裁决**（2026-10-24 立规，同日扩为全模块）：做深任一能力面前，先逐屏遍历
  参考工程该面的全部实体/动作/状态，产出 adopt / adapt / reject / defer 台账，再从
  Peers 自身场景（配置 → 安装/引用 → 查看 → 编辑/自建 → Agent Profile 绑定）推导保留项；
  禁止随机挑功能点对齐。全模块台账：
  [settings-benchmark-disposition.md](./settings-benchmark-disposition.md)；
  Skills 首批台账保留于 [skills-benchmark-disposition.md](./skills-benchmark-disposition.md)（SK-B01…SK-B24）。
- 所有交互均为**可执行原型**（React+Vite+mock，localStorage/内存状态机），
  不接 Station、不执行真实 hook/shell/cron、不安装真实包。mock 必须诚实标注，
  不出现假成功、假遥测或不可达控件。
- 真实模型/评测/执行引擎依赖的能力（见 §6）不做交互壳，不伪造结果。

## 2. 产品论点

普通用户在一个不打扰主工作面的地方管理 Agent 的能力供给：知识从哪来、技能/插件/MCP/hook
挂什么、渠道消息如何进出、定时任务何时跑。这些是**低频配置与治理**，不属于一级工作面，
但必须可达、可懂、可撤销。

- Surface type：桌面 Shell 内的 Settings 工作面（高频工作流之外）。
- Main subject：一个能力组（AI / Channels / Advanced）下的一个 section。
- 主动作：安装/启用/停用/移除一个能力，或保存一项配置。
- Signature：能力实体（memory item / package / server / plugin / hook / job / channel）
  的"目录 → 详情 → 绑定/启停"单一表达，跨 section 复用同一行/卡片/开关语言。
- Positive calibration：复用现有 Settings 的水平 group tab + 垂直 section rail +
  `SettingsSection/SettingsRow/Toggle/Select/GhostBtn` 组件语言与 Quiet Protocol Minimalism。
- Negative calibration：拒绝把参考工程 13 个一级 nav 搬进来；拒绝第二套皮肤；
  拒绝假 Curator 对话、假评测分、假执行终端、假市场网络请求。

## 3. 目标信息架构（冻结）

Settings 顶部 group tab 保持五组，section rail 变化如下（`Settings.tsx` GROUPS）：

- **General**：Account / Notifications / Privacy & Security / Appearance & Language —— 不变。
- **Network**：Your Station / Discovery / Federation —— 不变。
- **AI**（2026-10-24 冻结为**六节**）：Providers / Models / Memory / Skills / MCP / Knowledge。
  Discover 节撤下（其安装路径由 Skills/MCP 自身的 New/Import 承接，无独立聚合面）。
- **Channels**：Bots / Lark —— 组不变，内容做深。
- **Advanced**：Data & Storage / Applets / Statistics / Diagnostics & Logs /
  **Scheduled Tasks（原位做深，不移入 AI）** / Command Palette / About。

section 顺序：Memory → Skills → MCP → Knowledge。**Plugins / Hooks 于 2026-10-24 defer**：
其 CRUD 闭合但原型中没有消费面（不联动 Skills/MCP/执行），属于无效果控件，
按 interaction-design-methodology §16.2 撤下，待消费构造存在后再进入 IA。

## 4. IN：确认范围

### 4.1 AI → Memory（位置已存在，补内容管理；引擎配置保留）

保留现有：Enable Memory、Embedding Model、Storage Backend（SQLite/PostgreSQL + DSN Test）、
Vector/Keyword 权重。

新增**记忆内容面**（同 section 内用二级 tab，不新增 Settings section）：

- `Browse`：记忆条目列表，列字段 = 内容摘要、分层徽标（Identity / Context / Experience /
  Preference / Activity 五层）、scope（All scopes 选择器）、更新时间；行点击打开只读详情。
- 过滤：分层 chip（All + 五层）、时间窗（Last 30d 等，静态选项）、关键字搜索（本地过滤）。
- 顶部摘要行：总条数与按层计数（mock 数据，非实时向量状态）。Retrieval status 卡只展示
  本地引擎配置中真实存在的 provider/model；vector count 固定 Pending、dimensions 固定 Not reported，
  直到 Station 真实建索引（MEM-B03；不做百分比/可用率假遥测）。
- `Persona`、`Resource`、`Events` 三个二级 tab 各给空态说明（该类记忆由真实运行时产生），
  不伪造条目、不做编辑表单。
- 不提供记忆新建/编辑/删除（真实记忆由 Agent 运行时写入）；Browse 仅浏览与搜索。
- 引擎配置的开关/选择保持内存态（与现状一致），本期不引入持久化合同。

### 4.2 AI → Skills（包模型重做，2026-10-24；对齐台账 SK-B01…SK-B24）

> 完整竞品遍历与逐项裁决（adopt/adapt/reject/defer）见
> [skills-benchmark-disposition.md](./skills-benchmark-disposition.md)，本节只冻结合同。

- **包网格目录**（`SkillSettings.tsx`）：分两组 "Built-in & referenced"（空组隐藏）
  与 "My packages"（空态给创建/导入引导）。包卡片字段 = 图标、名称、来源徽标
  （Built-in / Git / URL / ZIP / Custom / Local reference）、Read-only、
  Enabled/Disabled、描述、skill 数与版本，footer = View / 编辑或复制 / 包级开关。
  网格 `auto-fit`：宽屏卡片拉伸铺满内容列（上限 620px/列，稀疏包数不留死白），
  430 窄宽退化为单列。
- **查看抽屉**（右侧 drawer，列表压暗）：Identifier / Type / Status / Description /
  Contents 信息表、包内 skill 搜索、每个 skill 行（名称、identifier、版本、描述、
  View、独立开关）；包禁用时子开关解除武装（"Disabled with package"）。
- **五种安装/创建来源**（一个 New/Import 模态内分段切换，非市场页签）：
  Create empty / Git import / URL import / ZIP import / Reference（本地目录只读引用）；
  identifier 实时校验（`[a-zA-Z0-9._-]`），失败内联报错且不关闭模态；
  网络/磁盘动作不真实执行，成功 Toast + 入列。无 Market 面（reject，SK-B 台账）。
- **编辑/自建闭环**：只读包（builtin/reference）只给 Copy to edit（fork 为可编辑副本）；
  可编辑包给 Edit package（名称/identifier/描述）、Add skill（名称 + 预填 YAML
  frontmatter 的 SKILL.md 编辑器，名称与 frontmatter 联动）、单 skill 的 View/Edit
  （Markdown 正文编辑并持久化）、Delete package（行内二次确认）。
- 包级与单 skill 启停语义与 Agent Profile → Extensions 绑定目录一致
  （同一 catalog owner，不造第二套数据；停用包即时收回绑定能力）。
- Agent Profile Extensions 选择器继续从同一 skill catalog 投影，不新增入口。
- reject：Sync、Root Directory 磁盘浏览、用户全局目录聚合（真实磁盘面，UNPROVEN）；
  defer：Bytedance AI Market、Skill Evaluation、Skill Curator LLM 面板。

### 4.3 AI → MCP（列表、编辑、Form/JSON 模态与诚实统计）

- 保留：server 列表（stdio/http/sse）、工具数、启停、删除、Add Server 与逐行 Edit。
- Add/Edit 使用同一个模态，分 **Form / JSON Config** 两段：Form 覆盖 name/transport、
  stdio command + args + env（或 http/sse endpoint URL）；JSON 真解析
  `{ "mcpServers": { … } }`（command/args 或 url），支持批量新增或单条编辑。
  非法 JSON/缺 command 或 url/URL 格式错误时内联报错且不关闭模态；编辑 launch config
  会重置已发现工具，直到 Station 重连。
- 顶部三个统计：Servers / Enabled / Tools，全部由本地状态派生。**不设 Connected/Errors**：
  原型无真实连接权威，任何 Test 不得返回成功；Test 的诚实结果是 "Unverified"，
  并在区域内说明 "Connection tests need Station and are not run in this prototype"。
- **Import from Git**：表单 + 内联校验 + 成功入列，不执行真实 clone。
- 非法 JSON/缺 command 或 url/重名时内联报错且不关闭模态；成功 Toast + 入列 + 计数变化。
- 仅 enabled 且 toolCount>0 的 server 可在 Agent Profile → Add MCP tool 中绑定；
  0-tool 未验证 server 不进入选择器。
- 空态：无 server 时显示引导文案与 Add Server / Import from Git 两个动作。
- Agent 级授权继续由 Agent Profile → Extensions 绑定承接（与现有合同一致）。

### 4.4 AI → Knowledge（生产 Station 面，2026-10-25 v4）

- 生产 Settings 注册真实 Knowledge section（selected-only）：Station descriptor 为唯一真相；
  列表采用封面卡片网格（本地确定性渐变/首字母封面，无外部图片抓取）、标题、修订号与 local hash retrieval 状态。
- 新建/修订仅支持 Station inline document：title + text content；无 Git URL 意图字段、无 clone 反馈、
  无 eval sets、无本地假仓。
- **状态互斥**（interaction methodology §5.1）：list / create / detail / reader 不叠加。
- 详情展示 descriptor 元信息；reader 通过新增 Station `resource_id + revision` content-read API
  读取不可变正文；client-owned resource 明确不可在 Station 设置面读取。
- 检索状态诚实标注为 local hash retrieval（本地 64 维词袋、查询时切块），不展示向量数、索引百分比或假同步状态。
- tombstone 需二次确认；停用/tombstone 后 descriptor 离开活动列表且不可检索。
- 原型合同仍仅描述原型层：其 local pack / Git URL / “不投递给 Agent”边界不迁入生产端。

### 4.5 / 4.6 Plugins / Hooks —— DEFERRED（2026-10-24）

- 原 §4.5/4.6 撤下：两者 CRUD 闭合但系统中没有消费面（不联动 Skills/MCP/执行），
  构成 §16.2 的"无效果控件/剧场实体"。组件文件已删除、IA 不再注册；
  待"安装即改变能力面"的消费构造存在后重新立项。

### 4.7 Channels → Lark（按普通用户三决策重做，2026-10-24）

- 零连接时只渲染**一个**空态（不重复 list+detail 双空框）。
- 建连仅保留 **managed app demo** 路径（连接名 + 平台 → 模拟扫码 → 连接）。
  删除 "Use existing app" 凭据表单：原型对任意 cli_ id 返回 ready 是伪造安全裁决。
- 主从布局；详情按 Configuration first 排列：
  - **Connection details**：只读本地 Local ID / Type / Created / Updated / Default responder，
    明示平台 binding handle 只有 Station 真实 provisioning 后才出现（不伪造平台句柄）。
  - **Messages & responder**：Default responder（名册 select）+ Topics 去向说明 +
    Group response mode（mentions/all）+ Reply display（Info card / Plain text，本地呈现偏好）。
  - **Event triggers**：本地规则表（@mentioned / 新群消息 / 入群 / 文档评论 → roster Agent →
    reply in channel/thread → enabled），Last run 恒为 Never；Station 在运行时真实投递，
    原型不触发、不模拟运行。
  - **Conversation routing**：逐会话覆盖（样例会话显式标注 sample），保存/移除闭合。
  - **Connection check**：仅检查本地配置完整性（app 类型/responder/handling），
    明示 "never contacts Lark servers"。
- 头部 **Channel Topics** 是只读弹层，从聊天外壳会话快照投影 default responder、
  routing triggers 涉及的每个 Agent 及其 Topics；不另建 Topic 数据源。
- reject：Diagnostics 消息日志/Stats 收发数字/Send test/授权与回调 URL/平台 Binding 句柄。
- Pause/Resume、Set default、Delete（头部可达 + 确认弹窗）均为本地状态并持久化（v9 schema）。
- Bots section 保留现有表与"绑定 Agent"列。

### 4.8 Advanced → Scheduled Tasks（原位做深）

- 保留标题 Cron Jobs/Scheduled Tasks 语义（沿用现 section 名 Scheduled Tasks）。
- 顶部：active/paused 计数（由列表派生）、搜索（本地过滤）、Refresh、New Job。
- New Job 使用右侧抽屉：自然语言调度条（本地解析 EN/中文常见模式，Parse 回填，不引库）、
  Basics（name/description/enabled）、Schedule（Cron expression / Every interval）、
  Execution（Run agent task / Shell command / Workflow；后两者选项可见但给"此类型在当前原型不可用"
  诚实警告，吸底提交条禁用）、Bound Agent + prompt、Runtime override（Model / Thinking effort /
  Timeout / Delete after run 一次性任务）。
- 吸底 completion footer 实时列举缺失必填字段；只有 name + valid schedule + Agent + prompt 齐备
  才能 Add/Save。
- 行字段：名称、description、cron 表达式（含 interval 派生）、作用域标签（System / Agent 名）、
  Runs once 标记、状态点（Active/Paused/Completed）、Next human time；操作 run-now（模拟一条
  Just now 历史）、pause/resume、history、edit、delete。
- 一次性任务 run-now 后进入 Completed 并禁用 run/pause（模拟退役，真实产品由运行时删除）。
- run-now、pause 即时改变状态与计数；delete 行内二次确认。

## 5. 共享表达与横切约束

- 实体目录统一语言：搜索框 + 来源/状态过滤 + 主安装/新建按钮在卡片头右对齐；
  行操作固定在右侧且跨行轴线一致（继承 Notifications 列轨合同）。
- 所有开关/安装/导入/重连/run-now 必须有可见结果：列表变化 + Shell `ToastHost`
  成功/失败反馈；失败路径给可恢复动作，不静默。
- 破坏性操作（移除包、删除 job、移除渠道）二次确认；受管/只读实体禁用编辑与删除。
- 键盘：弹层 portal 到 body、打开时背景 inert、Esc 关闭还焦 opener、Tab 首尾循环；
  列表/页签可键盘操作；复用现有 :focus-visible 品牌环。
- 布局稳定：同 section 内二级 tab/页签内容容器声明统一 `min-height`；
  过滤/搜索/空态不引起容器跳动（pt-prototype-design §3.7）。
- 响应式（2026-10-24 补"宽屏铺满"合同）：`SettingsContainer` 分 narrow（820 居中，
  表单型 section）/ wide（填充内容列，目录/主从型 section：Providers、Skills、MCP、
  Memory、Applets、Statistics、Logs）两变体；Skills 包网格 auto-fit 自适应列数，
  宽屏卡片铺满、稀疏包数不留死白，430 退化为单列。几何门禁覆盖 Portal 嵌入 1600 与
  全屏 1440 / 936 / 430 四视口；430 时 section rail 折叠为横向选择，详情全宽，零横向溢出。
- 主题：沿用 Shell 固定 light tokens；dark 为 UNPROVEN，不在本期声明。
- i18n：沿用原型既有英文工作文案约定（与 agent-chat 原型一致）；生产落地时走
  `packages/locales/`，不在原型内引入 i18n 框架。
- 不新增第三方依赖；图表用 DOM/CSS 表达，不引入图表库；cron 不引入解析库。

## 6. CUT / UNPROVEN：明确排除

- **不做（即使参考工程有）**：一级 nav 的 Project / Coding Agent / Workflow / Cloud /
  Remote Access / Agent Hub；Skill Curator AI 策展对话；Skill Evaluation 评测页签与
  caseset/评分运行；Knowledge eval sets；Memory 的向量状态卡与 consolidation 配置；
  Hook 脚本编辑器与执行输出；Plugin 安装对 Skills/Hooks/MCP 实体的真实联动写；
  Cron 的 Workflow/Shell 真实调度、真实计时器触发（run-now 仅产生 mock 历史）；
  真实 OAuth、Webhook、消息收发与长连接；市场网络请求与真实 Git clone；
  暗色主题、遥测反馈控件。
- **UNPROVEN（原型不证明）**：Station 持久化、真实包安装/签名/版本升级、真实权限沙箱、
  真实渠道消息生命周期、定时任务真实执行、跨设备同步、读屏器实测、大数据量性能。
  原型通过只证明 IA、交互闭环与状态表达；生产权威属于 Station/native 验收。

## 7. 状态所有权（原型）

- Settings owner：section 注册、group/section 导航、共享目录选择器与 Toast。
- Capability catalog owner（已收口为单一实现）：`shared/capabilityStore.ts` 的
  `createCapabilityStore` 提供版本化 localStorage 集合（读写校验、seed 合并、
  跨组件事件订阅）；`shared/agentExtensionCatalog.ts` 注册 skill packages
  （`peers.prototype.skill-packages.v1`）与 MCP servers
  （`peers.prototype.mcp-servers.v1`）两个 store，并由 `getAvailableSkills()` /
  `buildAgentExtensionCatalog()` 投影。Settings 各 section 与 Agent Profile
  Extensions 只订阅/投影同一 store，不持私有副本；在 Settings 停用包后，Profile
  绑定选择器即时不可绑定，重新启用即恢复。
- 原型 Knowledge 为 store 化集合（`peers.prototype.knowledge-packs.v1`）：内置包只读，
  用户包与其 notes 经版本化键持久化，reload 后保留；移除同样持久化。生产端不得复用该本地仓，
  必须以 Station descriptor/content API 为唯一真相。
- Plugins / Hooks：2026-10-24 起 defer，无 store、无 IA 注册。
- Channel owner：渠道实例、responder/response mode、逐会话路由、本地 check 结果；
  Agent 绑定引用名册 id。详情内显式说明"渠道消息进入绑定 Agent 的 Topic；
  会话级覆盖在 Conversation routing"，不另建 Topic 管理面。
- **Agent 身份唯一来源（2026-10-24 收口）**：`shared/agentRoster.ts` 读取聊天外壳
  持久化的名册（`agent-chat-agent-order` + `agent-chat-agent-<id>`，内置 assistant），
  Lark responder/路由、Scheduled Tasks 的 Bound Agent、Bots 的 Bound Agent 全部只从
  该名册渲染选项并持久化名册 id；旧的各面本地硬编码名单（alice/agent/research/maker）
  在读取时归一化（agent→assistant，其余→未绑定）。一个 Agent 在名册、Profile、
  Extensions、composer、渠道/定时/Bots 中是同一个实体。
- **能力贯通**：Skills/MCP 目录（Settings 单一 owner）→ Agent Profile Extensions
  绑定（物理可点的 portal 选择器，z-index 高于全屏预览层）→ composer 的
  Commands & Skills；Settings 停用包即时收回绑定能力。
- Schedule owner：job 列表、表单、next-run/history mock；不持有真实定时器。
- 持久化边界：上述用户态实体（导入的包/server、自建 pack 与 notes、job、
  渠道实例、Bots 绑定）走单一版本化 localStorage 键；Memory 引擎配置维持内存态。
  生产持久化合同不在本原型批准。

## 8. 验证（QA 门禁）

语义层全绿不等于闭环；当前门禁分四层：

1. **语义层**：`qa/settings_capabilities_checks.cjs` 由 `agent_chat_checks.cjs`
   同进程引入，39 项（26 agent-chat + 13 能力面）当前全绿。它只证明元素存在与可点，
   不证明链路闭环或渲染正确。
2. **闭环层**：`qa/settings_closure_checks.cjs`（独立运行，2026-10-24 引入，
   依据 `docs/client/common/interaction-design-methodology.md` §16）。
   当前 **11/11 PASS**：Knowledge 三条（状态互斥、内置条目阅读器、add-note 闭环）、
   MCP 三条（JSON 真解析+非法报错、Test 永不伪造 OK、0-tool 不可绑定）、
   **能力贯通一条**（Profile 物理点击绑定 → composer Commands & Skills 出现 →
   Settings 停用即消失）、Lark 两条（无凭据自服务路径、radio 几何+名册路由+reload+删除）、
   **名册身份一条**（同一 roster id 在 Lark/Cron/Bots 三处可绑定，旧虚构 id 全消失）、
   Cron 锚点一条。门禁含渲染复合断言（label/control 包围盒）与全链路操作断言。
3. **几何层**：`qa/settings_geometry_checks.cjs`（2026-10-24 引入）。
   遍历全部 21 节 × 四视口（Portal 嵌入 1600、全屏 1440/936/430），对渲染复合做
   真实 `elementFromPoint` 命中检测：控件中心点必须可点、文本不得压住无关控件、
   无关控件不得互相覆盖、内容列不得横向溢出；另含 10 个对话框/展开面板的开启态
   与 Knowledge 工具栏同一行断言。
4. **逐控件交互层**：`qa/settings_interaction_checks.cjs`（2026-10-24 引入）。
   **56 条命名旅程**真实点按/输入/选择每个控件并断言后果：列表开详情、过滤真过滤、
   开关回读、危险动作二次确认、非法输入内联报错、模拟检测（Providers/Memory DSN）
   只能给出 Unverified；Skills 八条覆盖搜索/查看抽屉/建包/加 skill/编辑/删包/复制派生；
   legacy 节的死控件（Unblock/Change PIN/Auto lock/Manage files/Export/破坏性确认）
   一并收口。

> 2026-10-24 "AI 整体"收口：除模块内闭环外，追加跨面身份与能力贯通两条门禁。
> 新增 `shared/agentRoster.ts` 为 Agent 身份唯一来源；修复 ExtensionPicker 因
> createPortal(z-index 80) 被全屏预览层(z-index 1000)遮挡而无法点击的缺陷；
> Knowledge 文案改为诚实定位（本原型不投递给 Agent）。
> 语义 39 + 闭环 11 双层门禁全绿，tsc/build 通过，
> L2 截图见 `.dev-local/evidence/ai-whole-20261024/`。

覆盖（Journey 级，均已实现）：

1. AI 组六节（Providers/Models/Memory/Skills/MCP/Knowledge）可达，顺序冻结；
   Discover/Plugins/Hooks 不出现在 IA；Advanced 仍持有 Scheduled Tasks。
2. Memory：五层过滤/搜索/计数派生；Retrieval status 从本地 embedding 配置派生，
   Pending/Not reported 不伪造；二级 tab 空态诚实；引擎控件保留可用。
3. Skills：包网格→查看抽屉→单 skill 启停；五种安装/创建来源（Create empty/Git/URL/
   ZIP/Reference）表单成功与校验失败；自建包→Add skill（SKILL.md 脚手架）→编辑/删除
   全闭环；只读包 Copy to edit 派生；Profile Extensions 选择器仍从同一 catalog 投影；
   Market 控件零出现。
4. MCP：三统计（Servers/Enabled/Tools）随启停/删除变化；Form/JSON Config 双态模态负责
   新增、批量导入与逐行编辑（编辑重置已发现工具）；Import from Git 闭环；空态双动作；Test 恒为 Unverified。
5. Knowledge：封面卡片网格→建包（可选 Git URL 意图）→分组条目树→阅读器→本地 note→移除；
   eval 相关控件零出现。
6. Plugins / Hooks：DEFERRED，IA 中零入口、无 store、无组件（2026-10-24 撤下）。
7. （原 Hooks 旅程随 §6 一并撤下。）
8. Lark：单空态→managed app 建连；本地元数据/responder/reply display/event triggers/
   Channel Topics 只读投影/routing/local check；绑定名册 Agent 持久回读；
   无假诊断/假 Stats/凭据自助；Bots 绑定列回读。
9. Cron：右侧抽屉 New/Edit、NL Parse、interval/completion footer/runtime override/一次性任务、
   run-now 产生 history、pause 改变计数、搜索过滤、非法 cron 内联错误、Delete 二次确认。
10. 横切：零 pageerror/零 console error/零失败请求；所有破坏性动作二次确认；
    弹层焦点环与 Esc；1440/936/430 零横向溢出；tab 切换截图级布局稳定（高度差 ≤2px）；
    长文案/伪本地化不溢出。
11. catalog 单一 owner：在 Settings 停用一个已装 skill package 后，新建本地 Agent 的
    Profile Extensions 选择器中该 skill 即时不可绑定；在 Settings 重新启用后恢复可绑定。
12. 用户实体 reload 持久化：Git/URL/ZIP 导入或自建的 skill package 及其自写 skill、
    Git/JSON 导入的 MCP server、新建 Knowledge pack 与 notes、Cron job、渠道实例、
    Bots 绑定在整页 reload 后逐项保留；移除在 reload 后同样生效。受管 seed 行不被重复合并。

既有 26 项 agent chat 检查必须保持全绿（共享 GROUPS 与 catalog，防回归）。
L2 截图集合：每个新/改 section 的 default / 空态 / 详情或弹层 / 430 窄宽，
全部实际打开目验后才能进入 pending-review。收口审计的 41 项全绿运行与
`settings-cap-01..15` 截图（含 09 catalog-single-owner、10 catalog-persistence）
存于 `.dev-local/evidence/agentbox-live-gap-20261023/p1/full-qa-closure/`
（任务本地证据，非仓库产物）。

## 9. 现场证据（2026-10-23 live）

- Peers 现状：`deep5/pp-ai-memory.png`、`pp-ai-skills.png`、`pp-ai-mcp.png`、
  `pp-ai-discover.png`、`pp-channels-bots.png`、`pp-channels-lark.png`、
  `pp-advanced-cron.png`。
- 参考工程：`inventory/inv-memory.png`、`inv-knowledge.png`、`inv-cron-jobs.png`、
  `inv-channels.png`，`deep5/ab-cap-skill.png`、`ab-cap-plugin.png`、
  `ab-cap-hook.png`、`ab-cap-mcp.png`。
- 证据根目录：`.dev-local/evidence/agentbox-live-gap-20261023/`（任务本地，非仓库产物）；
  差距叙述见 `gap-list.md` §6.5。
- 2026-10-24 Skills 专项深遍历（`#/capabilities/skill` 包网格/查看抽屉/五种导入/
  Add skill/Edit package）与逐项裁决：`skills-benchmark-disposition.md`（SK-B01…SK-B24）。

## 10. 状态

**implemented，全盘竞品台账 A/B 两批收口（2026-10-24）**：AI 六节（Providers/Models/Memory/Skills/
MCP/Knowledge）+ Channels + Advanced Scheduled Tasks/About 落地；全模块先遍历 AgentBox #6 再逐项
adopt/adapt/reject/defer，台账见 `settings-benchmark-disposition.md`。Skills 按 SK-B01…SK-B24
台账从扁平列表/Market mock 重做为包网格 + 查看抽屉 + 五种安装来源 + 自建编辑闭环；
Cron 重做为右侧抽屉（NL Parse/interval/completion footer/runtime override/一次性任务）；
Lark 增加本地元数据、Event triggers、Channel Topics 投影与 reply display；Knowledge 改为封面网格、
分组条目树与 Git URL 意图模态；MCP 支持 Form/JSON 模态新增与编辑；Memory Retrieval 卡诚实派生；
Provider 默认星标与模型 Unverified 灯；About 增加 What’s new 与诚实更新检查。
SettingsContainer 保持 wide/narrow 变体，宽屏铺满、430 单列；几何（全 section × 4 视口）+
逐控件交互 60 + 闭环 11 + agent-chat 回归全绿，tsc/build 通过。
Discover 撤下，Diagnostics/Stats/Market/Plugins/Hooks defer；跨面 Agent 身份统一为单一 roster，
Skills/MCP 绑定贯通到 composer。
证据：任务本地 `/tmp/batchA`、`/tmp/batchB` L2 截图与 QA evidence 目录；仓库内不保存截图。
所有数据为本地 mock，不接 Station/native，不构成生产合同。代码未提交，待 Owner 体验确认。
