# Agent Chat 范围总账与参考工程体验基准

> 阶段：PRODUCT 原型对齐
> 状态：confirmed
> 更新：2026-10-20
> 实现：`packages/prototypes/desktop/shell/src/AgentChatPage.tsx`
> 门禁：`packages/prototypes/desktop/shell/qa/agent_chat_checks.cjs`

## 权威规则

本文件冻结 Agent Chat 原型的功能边界。

- **功能范围**只来自 Peers 已确认清单。
- **参考工程**只作为信息架构、空间归属、交互反馈和返回路径基准。
- 参考工程有而清单没有的功能不得因“对齐”进入原型。
- 清单有而参考工程放在其他位置的能力，采用参考工程的空间归属，不机械保留旧入口。

## 产品论点

普通用户应在一个连续工作面中选择 Agent、管理 Topic、对话、处理人工门控并恢复失败。
Agent 名册、Topic、对话和 Profile 必须保持清晰所有权，不能靠跨页跳转或临时浮层掩盖信息架构。

- Surface type：高频桌面工作流。
- Main subject：当前 Agent 的当前 Topic。
- 主动作：composer 发送或停止。
- Signature：常驻 Agent 名册与 Topic/Chat 连续工作面。
- Positive calibration：采用参考工程的栏位关系、行菜单锚定、移动端页面层级和局部反馈。
- Negative calibration：拒绝底部 Agent 面板、菜单驱动的隐式跨面跳转、功能越界和开发者控制面。

## IN：确认范围

### Agent 与 Profile

- My Agents 名册常驻 Chat 与桌面 Profile。
- 创建、名称/描述搜索、选择 Agent。
- 行点击进入该 Agent 的 Chat。
- 行菜单仅保留 Agent 级动作：Agent Profile；非内置 Agent 额外提供 Delete。
- 创建 Agent 后立即进入 Profile，Profile 自动保存。
- Profile 使用参考工程实测的 `64px 身份轴 + 12px 间距 + 内容轴`：Back `36×36` 与头像 `64×64` 左边界相同；头像无二层按钮框，头像顶边与 `64px` 描述框顶边相同；名称/描述左边界相同，SOUL/AGENTS 编辑器填满剩余高度。
- 自动保存不常驻显示说明文字；名称、描述、SOUL/AGENTS、头像及扩展保存后统一通过 Shell `ToastHost` 通知，失败使用同一组件的错误态；Toast 复用 Chat 所用 LobeUI owner，并固定从右下角出现。
- 头像支持 Emoji 与本地图片；图片仅接受 PNG/JPEG/WebP/GIF 且不超过 2 MB。头像持久化到 Agent，并同步投影到名册与 Profile。
- Profile 的 Extensions 只显示已绑定项；Add skill / Add MCP tool 打开有搜索和分页上限的目录。
- Skills/MCP 分组的新增入口只使用带 tooltip/ARIA 的 `+` 图标。
- 已绑定 Skill/MCP 支持启停和移除。
- 删除 Agent 必须二次确认，并清理该 Agent 的 Topic、草稿、附件和 Profile 数据。

### Provider 与模型目录

- Provider 使用一个混合列表，不以 Direct / CLI Tab 拆分。
- Provider 列表默认开启 `Show usable only`，仅显示已启用且配置可用的项；关闭后显示完整目录，该偏好写入本地持久化。
- Add Provider 在创建时选择 `Direct model` 或 `CLI`；CLI 额外选择 Station 已注册的 adapter。
- Direct 只挂载 API Key、Base URL、连接检查和 Models；CLI 只挂载启用、Provider profile、默认模型、启动参数、环境变量、检查、恢复与保存。
- Direct 与 CLI Provider 均可启停；Provider 关闭或 chat model 关闭后，同一个共享 availability owner 立即从 Agent composer 模型树移除对应项。当前 Topic 指向已关闭模型时，composer 投影到第一个仍可用模型，不继续展示失效项。
- CLI Advanced 只读显示 Station 注册命令和隔离 workspace policy，可配置 timeout，并显示 adapter capabilities；客户端不得提交任意 executable path 或 shell command。
- 切换 Provider 时，前一个 schema 必须卸载；CLI 不出现 API Key、Base URL 或 Add Model。
- Direct 与 CLI chat models 都投影到同一个 `Provider → Models` 目录，供 Settings 默认模型和 Topic 覆盖共用。
- AI / Models 只保留默认模型选择，不再重复渲染 Provider 模型目录树。
- CLI Check、Restore defaults、Save 都有状态结果；Restore 与 Save 复用 Shell `ToastHost`。

### Topic

- Topic rail 顶部只显示当前 Agent 名称，不重复头像；Start new topic / Agent Profile / Search 为三个等宽图标槽。
- Search 在同一个图标槽行内横向替换三个动作；Cancel/Escape 清空查询并按相反方向恢复动作，不新增一行或挤压布局。
- `Topics <数量>` 紧邻列表上方，右侧拥有批量选择与批量删除。
- Start new topic、切换 Topic。
- Pin/Unpin、分组折叠。
- 按标题搜索。
- 手动 Edit。
- 单个 Delete 和批量 Delete 均二次确认；批量取消保留选择，确认后清理对应消息、草稿、附件和运行锁。
- 每个 Agent 恢复自己的最后 Topic；每个 Topic 恢复自己的草稿和未发送附件。

### Composer 与会话

- Enter 发送；Shift/Ctrl/Command + Enter 换行。
- 模型以 `Provider → Models` 为唯一目录结构；Settings 默认模型和 composer Topic 覆盖均从该树投影。
- Settings 拥有全局默认模型；新 Topic 继承默认值，composer 右下角通过可折叠、可搜索的 Provider 模型树设置当前 Topic 覆盖。
- Commands & Skills palette 同时支持 `/` 输入、指针和键盘打开。
- `/help` 为 Desktop 静态说明；`/tools`、`/skills` 只展示带版本的
  Station capability snapshot；`/clear` 创建空 Topic，旧 Topic 与证据保留。
- snapshot 覆盖 ready、empty、stale、unavailable；stale/unavailable 禁用
  capability action，但不阻断普通文本对话。
- 附件选择/移除/发送后回显。
- conversation header 左侧显示当前 Topic 标题，右侧提供会话正文搜索。搜索匹配消息正文、附件名、提问和产物标题，支持上/下一处定位、当前命中高亮与关闭还焦。
- thinking、streaming、activity 折叠/展开。
- 完成消息只显示实际参与或部分参与的 Skill、Memory、Knowledge、Attachment、
  Tool 紧凑徽标；展开详情同时说明 included、omitted、truncated、版本和原因。
  详情固定到历史 Turn，不随当前 Agent Binding 改写，也不暴露 Prompt、凭据、
  本地路径或 debug trace。
- 用户消息 Edit and resend。
- Stop、Regenerate、Copy。
- 两阶段 quick reply：Add to input / Reply now，且保留原草稿。
- 基础 artifact 卡片、列表与正文查看。

### 人工门控与恢复

- clarification：选项、Other、自定义输入、Submit、答案记录、Agent 续跑。
- tool approval：安全默认焦点、Cancel / Run tool、系统回执、Agent 续跑。
- typed error：未配置、鉴权、限流、网络、流中断、取消。
- 失败保留草稿；可恢复错误提供 Retry。

### 响应式

- Wide：Agent 名册 + Topic rail + conversation。
- Compact desktop：Agent 与 Topic 使用 48px compact rail，展开一个时收起另一个。
- Ultra-narrow：Chat 独占；Back 进入全宽 Topic 列表；Switch Agent 打开左侧全高抽屉。
- 窄屏 Agent 抽屉关闭后恢复触发器焦点，行菜单仍锚定触发器。

## CUT：明确排除

- 运行中消息 queue、重排、编辑、Send now、自动串行 dispatch。
- Topic Smart Rename。
- Topic Sort & filter、状态筛选、正文搜索。
- Archive、未读、分页。
- 六类 artifact 筛选、artifact 搜索/排序。
- Export conversation、Share conversation、Link subscribe、Notebook。
- Reading view、Debug detail、Skill trace 等开发者检查器。
- conversation header AI/Skill 快捷按钮。
- Agent Hub、Import、Duplicate、Export bundle、Share Agent、Set default、Pin Agent。
- executor/provider/fallback 等普通用户不应直接操作的开发者配置。

## 参考工程现场事实

历史实测运行时：`http://127.0.0.1:8436`，参考工程实例 #6。

本轮重新实测，不使用旧推断：

- 1440px：全局导航、My Agents、Topic、Conversation 为并列工作列。
- 936px：My Agents 可保持展开，Topic 收敛，conversation 仍为主区。
- 430px：Topic 为全宽页面；Switch Agent 打开**左侧全高抽屉**，不是 bottom sheet。
- Agent 行菜单锚定行尾 `More`，空间不足时向上展开。
- Agent Profile 动作进入该 Agent Profile；普通 Agent 行点击进入该 Agent Chat。
- Mobile Profile 为独占页面，Back 返回；打开 Profile 时 Agent 抽屉关闭。
- Profile 桌面版遵循 Back/头像 64px 左轴与名称/描述右轴；头像点击打开 Emoji/Upload 锚定选择器。

现场截图：

原始产品标识、截图文件名和历史证据目录保存在
[不可变取证清单](https://github.com/peers-labs/peers-touch/blob/e26b81c4cf3c5b9d0b920e9d1a434a751cfba208/docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md#L121-L146)。
这些是历史观察，不代表本次源码重新通过验证；不重命名或改写原始证据。

## 状态所有权

- Agent owner：名称、描述、头像、Profile 文档、扩展绑定、最后选中 Topic。
- Settings owner：Provider 模型目录与全局默认模型。
- Topic owner：模型覆盖、消息、草稿、未发送附件、运行状态、artifact、人工门控和 typed error。
- Roster owner：搜索、展开状态、创建与 Agent 删除。
- Topic rail owner：Agent 名称投影、新建、同栏标题搜索、数量、分组、Pin、Edit、单删与批量删除。
- Conversation owner：reading path、正文搜索与定位、activity、quick reply、artifact 和 composer。
- Overlay owner：Agent/Topic 菜单、删除确认、扩展选择器、artifact drawer、移动端 Agent 抽屉。

运行中只有一个 turn owner。Queue 不在当前范围，因此第二次发送不会创建并行执行或隐藏队列；
composer 草稿保留，用户可 Stop 当前 turn 后继续。

## 当前验证

执行：

```bash
CHROMIUM_PATH="<installed-chromium-executable>" \
AGENT_CHAT_URL=http://127.0.0.1:4173/?state=agent-chat \
node packages/prototypes/desktop/shell/qa/agent_chat_checks.cjs
```

当前结果：11 条完整 Journey、136 个唯一操作/状态合同，`errors=[]`。

本轮 ADL-00 source-bound 证据：`/tmp/pt-agent-depth-v2-prototype-final/`

- `04-command-palette-ready.png`
- `04-command-palette-empty.png`
- `04-command-palette-stale.png`
- `04-command-palette-unavailable.png`
- `05-turn-attribution-detail.png`
- `08-mobile-command-palette.png`
- `results.json`

门禁同时覆盖：

- 当前 worktree、commit 和源码 SHA-256。
- `/help`、`/tools`、`/skills`、`/clear` authority 与历史保留语义。
- ready/empty/stale/unavailable、keyboard/pointer、compact/narrow palette。
- Skill/Memory/Knowledge/Attachment/Tool attribution 的
  included/omitted/truncated 与历史固定语义。
- Shell TypeScript 检查与 Vite build。
- 宽屏、compact、mobile 几何与零横向溢出。
- 菜单、dialog、drawer 的键盘焦点与返回。
- 附件 file chooser、clipboard、reduced motion。
- 零 `pageerror`、零 console error、零失败请求。

## ADL-00 Owner Review

原型已由 Owner 明确确认为 `confirmed`。本轮确认冻结 Commands/Attribution
产品合同和可交互状态，不构成 Station authority 或 Native product evidence。

Owner 已确认：

- Commands & Skills 是否保持一个 palette，且 `/help`、Station snapshot、
  `/clear` 的空间归属和禁用语义正确。
- stale/unavailable 时 capability action 禁用、普通文本对话继续的表达是否清楚。
- Attribution 是否只用紧凑徽标表达实际参与项，并通过一层详情解释历史版本、
  included/omitted/truncated，而不过度暴露开发者信息。

ADL-03/ADL-04 production implementation 的产品确认阻塞已解除。

## Production 落地映射

2026-10-17 的确认仅覆盖此前 Agent Chat 基线。2026-10-20 新增的
Commands/Attribution 合同正在重新确认；Memory 图形化交互仍保留在原型，
本期不落地。

- Agent roster：`apps/desktop/src/components/agent/workbench/AgentRail.tsx`
  复用 Station-backed `agent` store；创建后直接进入 Profile，行菜单仅保留 Profile / Delete。
- Topic rail：`apps/desktop/src/components/AgentSidebar.tsx`
  在 `hideAgentPicker` 模式下仅投影 Agent 名称、三个等宽动作、同栏标题搜索和
  Pin / Rename / Delete。
- Conversation：`apps/desktop/src/pages/ChatPage.tsx` 与
  `apps/desktop/src/components/MessageList.tsx`；header 只保留 Topic 标题和当前
  Topic 正文搜索，搜索通过 virtualizer 定位未挂载消息；Queue、Terminal 和
  Portal 开发者入口已退出普通用户工作面。
- Profile：`apps/desktop/src/pages/AgentProfilePage.tsx`；保留 Identity、
  SOUL.md、AGENTS.md、Emoji/图片头像和真实 Skill/MCP binding；模型路由、
  Workspace、Memory、Activity、Diagnostics、Builder 和通用技术配置不再由
  Profile 暴露。
- Provider / Models：`ProviderMenu.tsx`、`ProviderDetail.tsx`、
  `CliProviderDetail.tsx`、`ModelServiceTab.tsx` 与 provider/settings stores；
  一个 Direct/CLI 混合列表，`Show usable only` 持久化，Models 只保留全局默认
  模型，composer 消费同一 availability projection。
- CLI 平台适配：Station 注册结构化执行/发现 argv，并通过 typed
  `ProviderRuntimeConfig` 声明 default model、startup args、environment 和
  timeout；Production UI 支持 check/restore/save 与 capability-driven Refresh。
  CLI 模型目录由 Station 按 actor 发现并只读投影，不提供手工 CRUD、单项 toggle
  或批量 toggle；注册命令和 workspace policy 仍只读。

当前 source evidence：

- 9 个聚焦 test files、35 tests 通过。
- 变更涉及的 Agent / Provider 文件 ESLint 通过。
- 仓库入口补齐生成绑定后，Desktop 全量 TypeScript 通过。
- Desktop Vite production bundle 通过。
- 当前 workspace 的 source-bound Code Structure Review 为 `PASS`。
- Native `make desktop` 尚未进入产品 Journey：首次被远程部署桥的 Python
  解释器不匹配阻断；复用健康 Station 后，又被全量 applet 编排中的 Atelier
  Rspack Wasm 间歇性构建错误阻断。单独使用 Node 22 构建 Atelier 可通过，
  但两次全量编排重试仍失败，因此 Native product behavior 保持 `UNPROVEN`。

## 未证明

- Station 持久历史和真实多进程 turn。
- Host tool 的真实执行、continuation delivery 与重试。
- 真实附件上传和 artifact store。
- production Desktop 的长会话 virtualization、hidden-render 成本和原生读屏器验证。
- production Desktop 的 ultra-narrow Agent/Topic 导航、Topic 批量删除和真实
  CLI adapter 检查/恢复 Journey。

这些边界不影响当前原型评审，但不能作为生产 Acceptance。
