# Frontend Eles · Desktop · Agent

Agent 模块的 peers-ui 完备性验证原型。目标是把生产 Agent 域的全部能力
（含 Settings › AI 八节）一比一表达为 **仅由 `@peers-touch/ui` 原语组成**
的可执行界面；任何 peers-ui 缺口在库内就地补齐，不允许引入外部组件库。

## 硬门禁

```bash
pnpm --filter @peers-touch/prototype-ui-system peer-only-gate
```

门禁扫描本目录全部 `.ts/.tsx/.css`：

1. 禁止 `antd` / `@lobehub/*` / `lucide-react` / `react-layout-kit` 导入；
2. 禁止原生交互元素（`<button>` / `<input>` / `<select>` / `<textarea>`），
   交互一律走 peers-ui（Button/IconButton/Field/SearchField 等）；
3. 禁止 hex/rgb 原始色值，视觉只允许 `--pt-*` 设计令牌（域 CSS 仅做布局）。

## 结构

| 文件 | 职责 |
| --- | --- |
| `AgentFeature.tsx` | 模块入口：表面级导航状态（roster/topic/conversation/workbench、profile） |
| `AgentRoster.tsx` | 唯一左轨外壳：头部“我的 Agent”文本标题（对齐生产 myAgents）+ 可展开搜索 + 加号 Menu，230/48 几何与 dock 只此一份，列表恒定为 Agent 列表 |
| `AgentListBody.tsx` | 列表体：置顶/全部分组、行选择 Button 与兄弟溢出 Menu（行点击不开菜单） |
| `CreateAgentDialog.tsx` | Roster 加号的工作目标：新建 Agent 的名称/描述/默认模型，头像留待 Profile 三态编辑器 |
| `TopicRail.tsx` | 话题 rail：选择与溢出 Menu 为兄弟控件，行点击只负责选择；“开始一项工作”即在此新建会话话题 |
| `types.ts` | 原型本地视图模型，对齐生产 Agent→Topic→Turn 词汇表 |
| `agent-data.ts` | 确定性 seed 数据与工作面工具元数据 |
| `agent.css` | 仅 `--pt-*` 令牌的域布局，hairline 分栏 |
| `conversation/` | 消息族视图模型、seed 与组件：`ConversationPane` 轮次状态机、`MessageBubble`、`ToolCallView`（含 `TerminalSurface`/`CodeDiff`/审批/澄清）、`ClarificationView`、`TurnAttributionView`、`Composer` |
| `workbench/` | 右侧工作面：`Workbench` 三态外壳（浮动 rail/启动器/ResizablePanel 标签页）、`useWorkbench` 标签状态机、确定性 seed，以及 `docks/` 六 dock（summary/file/browser/terminal/memory/branches） |
| `profile/` | Agent Profile：`AgentProfile` 身份网格 + 双 Tabs、`AvatarPickerDialog`（initial/emoji/image 三态）、`IdentitySection`（SOUL.md/AGENTS.md）、`ExtensionsSection` + 懒加载 `ExtensionPickerDialog` |
| `settings/` | **已从 Agent rail 入口下线**（模型/provider 等运营配置归全局/dashboard，不在 Agent 模块内）。`AgentAiSettings` 八节组件与 `sections/` 源码保留、可独立编译，但当前无路由挂载、无入口 |
| `peer-only-gate.mjs` | 零外部元素机器门禁 |

## 批次

- B0（完成）peers-ui `TerminalSurface` 原语、模块脚手架、DesignDirections
  rail 接入、seed 模型、peer-only 门禁
- B1（完成）三栏外壳：AgentRoster（230/48、置顶分组、行 Menu、删除确认 Dialog、
  搜索过滤）、TopicRail（三槽动作、原位搜索、Topics count 批量选择、日期分组、
  行内改名、pin/rename/delete Menu、48px 折叠）；行选择 Button 与溢出 Menu
  触发 IconButton 为 wrap 内兄弟节点，悬停显隐，点击行不打开菜单；
  900/560 断点互斥与 ultra-narrow 左 Drawer；状态本地可变异，门禁新增手写 role 拦截
- B2（完成）消息全家桶 + Composer：user/assistant/system 气泡、amended 徽章、
  thinking 折叠、Markdown、follow-ups、六类归因 Tag；八张工具卡覆盖全状态
  （shell 走 TerminalSurface、file-write 走 CodeDiff、失败 Alert + retry、
  审批/澄清内联完成回写、类型化错误）；Composer 三 Popover（workspace/
  Full Access 能力清单/Provider 分组含不可用项）、附件 FilePickButton、
  slash 命令面板、streaming 下 Stop 可达且发送进入 FIFO 队列、stop 产出
  LIFECYCLE_CANCELLED 终态；澄清自由输入对齐生产 maxLength=4000 且无裸字符计数
- B3（完成）右侧工作面三态：关闭时浮动图标 rail（6 入口）、打开无标签时 Start here 启动器、有标签时标签条 + 可搜索添加菜单 + fold；宽度由库 `ResizablePanel`（可达 separator + 键盘缩放）承载，无手写拖拽柄。六 dock 一比一对齐生产：summary（对话投影的事实行 + 6 指标，错误/待决定着色）、file（树/变更双 Tabs、目录聚合徽标、Git 状态 Tag、文件详情 CodeDiff）、browser（fail-closed、起始表单、标签页、地址历史进退、种子渲染框）、terminal（会话标签、新建/自定义命令、kill 产出 killed 终态，消费 `TerminalSurface` 使其在 registry 转 vetted）、memory（候选 confirm/reject 出队）、branches（取代/替代标记卡 + 进入延续）
- B4（完成）Agent Profile：roster 常驻、Profile 不挂载 Topic 历史；64px 左轨身份网格（Back 与方形头像同左缘），头像一个持久值三态（initial 首字母 / emoji 网格 / image 经 FilePickButton 上传，校验类型与 2MB、预览后保存）；身份区 SOUL.md/AGENTS.md 双 mono 编辑器（dirty/save 本地状态、窄屏堆叠）；扩展区 Skills/MCP 绑定行（Switch 启停、移除），`+` 打开可搜索、有界分页的懒加载目录选择器（非内联全量目录）。任务编排归模块级 Tasks 表面，Profile 内不设任务入口
- B5（完成）Agent 模块内 Settings › AI 八节，顺序与生产 AI 组一致：providers（Direct/CLI、密钥显隐、连通性检测、逐模型开关）、models（仅取已启用供应商可用模型的默认项）、discover（能力市场装/卸）、memory（嵌入/Segmented 后端/库 Slider 检索权重）、skills（已安装/内置/市场三态 + 扫描标记 + 导入）、mcp（服务器增删、可达性、工具展开）、voice（STT 供应商/语言/自动停止，无 TTS）、cron（DataTable 计划任务、cron/interval/once 三态新建、启停删除、连续失败着色）。原 roster 齿轮入口已移除（运营配置不属 Agent 模块），该表面当前无挂载入口；纯 peers-ui，peer-only 门禁通过
- B6（完成）去重与 Agents/Tasks 双模式：删除死占位 Atelier（入口、占位表面、CSS、双语键全清，任务归唯一 Tasks 表面）；Roster 重构为单一左轨外壳，头部对齐 chat 范式（Agents/Tasks `Segmented` + 搜索 IconButton 展开接管整行 + 加号 Menu），列表体按 mode 切换，230/48 几何/dock/Drawer 只保留一份；修活原死按钮“+”，agents 模式接 `CreateAgentDialog`。新增 `tasks/`：镜像生产 `AgentTask` 六态/三优先级与 start/pause/cancel 门控，`TaskRailList`（all/active/completed 过滤 + 状态 Tag + Progress）、`TaskHome`（对齐真实参照：Trae 式居中 hero 标题 + 居中卡片；卡片内部 1:1 复刻生产 `ChatInput` 语法——TextArea 在上、底部单条工具条左右分组，左为 Full Access/workspace 运行时授权、右为只读模型标识与 primary 方块发送 IconButton。**职责边界**：模型/provider/密钥配置是运营事，归全局/dashboard，Agent 模块内不设编辑入口；任务卡片只显示所选 Agent 绑定的 `defaultModel` 只读文本，不渲染 provider 树。执行 Agent/优先级落在卡片外第二行 quiet 选择器；**不设内置提示词胶囊**——经核实 opencode 首页无 suggestion chips，可复用提示词只以用户可编辑的外置 `/` 命令（`.opencode/command/*.md`）存在，故 TaskHome 保持干净 composer，子任务改由 TaskDetail 手动添加）、`TaskDetail`（子任务 Checkbox 联动 progress、result/error Alert、链接话题一键跳回 Agents 会话）。
- B6.1（完成）rail 底部对齐生产 `PanelToggleDock`：移除越界的 AI 设置齿轮（生产 AgentRail 底部本就只有折叠），`AgentFeature` 同步摘除 `aiSettings` 表面挂载与 `AgentSurface` 收窄为 `chat | profile`；折叠改为绝对定位单 28px 按钮（left/bottom 令牌化，expanded 与 collapsed 两态实测同为 28px、left 12、bottom 16），删除无引用的 `.pa-rail__dock-row`。peer-only 门禁、tsc 与 B2/B3/B4/B6 + dock 契约探针通过，运行时 foreign=0
- B6.2（完成）移除内置提示词胶囊：经核实 opencode 首页（`packages/app/src/home/route.tsx`）只渲染 projects + sessions，无 suggestion chips；其快捷提示词是外置 markdown `/` 命令（`.opencode/command/*.md`，由 `config/plugin/command.ts` 目录发现、core 仅做运行时注册，零硬编码数组）。据此删除 TaskHome 的 4 个内置模板胶囊、`TASK_TEMPLATES`、`TaskTemplate` 类型、40 个模板双语键与模板 CSS，任务创建改为直接在 composer 输入（子任务仍可在 TaskDetail 手动添加）。门禁、tsc、B2/B3/B4/B6 探针通过，`templateCapsulesRemoved=0`、foreign=0
- B7（完成）**取消 Tasks tab，只留 Agent**：任务与“在话题 rail 新建会话”语义重复，故整体撤销 B6 引入的任务体系——删除整个 `tasks/` 目录（TaskHome/TaskDetail/TaskRailList/useTasks/task-data/types）、`RailMode` 类型、Agents/Tasks `Segmented` 与 mode 切换、全部 `.pa-task-*`/`.pa-rail__mode*`/`.pa-rail__tabs` CSS 及 `agent.mode.*`、`agent.tasks.*` 双语键；`AgentFeature` 回归纯 Agent 三栏（roster·topic·conversation/workbench），`AgentRoster` 头部仅余靠右的可展开搜索 + 加号 Menu，开始工作统一走 TopicRail 新建会话。门禁、tsc 通过，B2/B3/B4 与 dock 契约探针全过、foreign=0（注：旧 b1 探针因 TopicRail 类名早已由 `__menu-glyph` 改为 `__menu` 而失效，与本次移除无关）
- B8（完成）Profile 按生产 `AgentProfilePage` 纠正真倒退：① SOUL.md/AGENTS.md 由手动“保存全部”改为生产式自动保存——600ms 防抖提交、onBlur 立即 flush、卸载时 flush 残留草稿，移除手动按钮，状态标签在“保存中…/已保存”间切换（`agent.profile.doc.saving` 新键）；② 标题输入对齐生产 23px/750、38px 高、透明无边框大字。Switch 不加伪造 loading（peers-ui Switch 无 pending 能力且原型本地 state 本就同步，制造假异步违反不造假原则），操作反馈由文档真实 saving/saved 承担。Atelier 入口经确认本轮不恢复。门禁、tsc、B2/B3/B4 探针通过（b4 实测 savingTag=保存中…、manualSaveRemoved=0、savedTag=已保存）、foreign=0
- B8.1（完成）rail 头部补回标识：取消 Tasks 后头部左侧的空 spacer 替换为“我的 Agent”静态文本标题（`agent.roster.title`，对齐生产 AgentRail 的 myAgents 文本标题而非单 tab 控件，13px/700、超长省略），搜索与加号仍靠右；搜索展开时标题让位于输入框。门禁、tsc、B2/B3/B4 与 dock 探针通过、foreign=0
- B8.2（完成）行溢出菜单收窄：实测菜单为库默认 `min-width:180px`（rail 仅 230px，留白偏多）。排查发现 peers-ui `Menu` 在类型上继承 `PopoverProps.className` 但运行时未透传给 `OverlayLayer`（Popover 有透传、Menu 遗漏，属实现与契约不符），修复 `packages/ui/web/src/overlays.tsx` 透传 `className`；agent 域据此给行菜单加 `.pa-row-menu` 将 min-width 收到 150px（仅作用该表面，其它菜单维持库规格）。实测 menuWidth 180→150、文字无截断；门禁、tsc、portal build、B2/B3/B4 探针通过、foreign=0

## 合同来源

- `docs/client/common/ui-identity/modules/agent/README.md`
- `docs/client/common/ui-identity/`（foundations/tokens/layout/components/craft）
- `docs/architecture/domains/agent/task-workbench/`
- `docs/architecture/platform/client/ui-system/prototype/self-training-methodology.md`
