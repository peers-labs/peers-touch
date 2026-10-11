# Social Chat — 原型

> **Status**: pending-review
> **Version**: v1.0
> **Created**: 2026-07-02 | **Updated**: 2026-10-11
> **Owner**: Chat / Social
> **Module**: `packages/prototypes/desktop/features/social-chat/`

---

## 原型在哪

`packages/prototypes/desktop/features/social-chat/`

这是 Desktop 站点下的 Chat 局部能力原型，不是一级站点，也不是最终产品代码。可预览入口收敛到 `packages/prototypes/desktop/shell/`：Social Chat 作为 Desktop Shell 内的 `chat` 页面承载，不再作为 Prototype Portal 顶层独立卡片展示。

## 落地目标

落地目标是 `apps/desktop` 的社交聊天体验：

- 私聊会话列表、消息阅读流、composer、私聊详情。
- 群聊会话列表、群聊消息阅读流、群详情、成员管理与权限差异。
- Chat 模块内的 `Chat` / `Contacts` 竖向二级 tab。
- Contacts 主从面板（对齐真实 `apps/desktop` 的 `ChatContactsPanel` + `ChatContactsDetailPanel`）：
  - New Friends：请求卡片含 Incoming/Outgoing、Pending/Accepted/Rejected、request attempts 标签；pending incoming 可 Accept / Reject，接受后联系人按 PTID 进入 Contacts。
  - Saved Groups：折叠分区，单击选中看详情，双击（或详情 Message）进入群聊。
  - Contacts：按 PTID 去重的联系人行，同名 Bob / Carol 按不同 Home Station 保留独立行；右侧详情空态为 “Select a contact or saved group to view details”，选中后显示身份、Station/Federation 技术明细（可复制）与 Message 入口。
- stream call：从 Chat 会话头部的语音 / 视频按钮进入；语音、呼出和来电复用 Agent 后台执行 tray 的紧凑尺寸与右下角锚点，视频可切换紧凑、覆盖 Chat 模块和全屏三种显示范围。
- Conversation action surface：静音、置顶、背景、搜索、清空历史、退出/解散/删除。

原型只用于确认终态交互形态；确认后仍需在 Desktop 真实工程按运行时、store、i18n 和权限模型重新实现。

## 怎么跑

```bash
make run-prototype desktop
```

进入 `Desktop Shell` 后，从左侧「聊天」入口打开 Social Chat。

也可在原型包内单独运行，仅用于开发调试：

```bash
pnpm --filter @peers-touch/prototype-desktop-social-chat dev
```

## 对应设计

本原型覆盖 `docs/client/chat/chat-ux-contract.md` 中的核心 Chat UX 合同：

- `MessageItem -> Bubble -> Content -> MetaRow -> ActionAnchor` 消息语义。
- `HeaderRect / MessageViewportRect / ComposerRect / FloatingLayerRect` 边界。
- 私聊详情：身份验证、安全号入口、背景、搜索、清空历史、删除/屏蔽类风险动作。
- 群聊详情：成员预览、添加成员、管理成员、owner/admin/member 权限差异、退出/解散。
- Trust state：稳定加密/验证状态压缩为 quiet chip；群详情不展示原始加密指纹。
- Stream call state：idle / outgoing / incoming / active / reconnecting / ended / failed，评审状态切换折叠在 Chat header 的 `...` action menu 内。

## 总账状态

`pending-review`

当前跨端 Chat 工艺改动已完成 prototype L1/L2/L3/L4 evidence，等待
Owner 确认；确认前不得作为新的 Desktop Chat 落地参照。

## 当前覆盖面

- 私聊样本：已验证在线、未验证离线、普通加密会话。
- 会话详情（对齐真实 `ChatDetailPanel`）：私聊资料卡含 @handle、Station、可折叠
  Technical details（PTID/Home Station/Federation）、Online/Standard chat 关系标签、
  Posts/Followers/Following 统计；SETTINGS（Mute / Pin / Chat background / Search messages）；
  SHARED CONTENT 的 Media(N)/Files(N) 从消息附件派生，空态与网格/列表齐备。
- 全局 Search Messages 弹窗（对齐真实 `SearchMessagesModal`）：跨会话或单会话搜索、
  All/Messages/Threads/Files 过滤、Direct/Group 与消息类型标签、命中高亮、发送者与时间、
  Jump 跳转、空查询 “Start typing…”、无结果与 Esc 关闭。
- 消息气泡（对齐真实 `ChatMessageRow`/`ChatMessageContent`）：对方气泡白底+描边+轻阴影、
  本人主色气泡；纯表情消息大字号无气泡；纯图片/语音媒体消息无气泡背景；
  语音条（播放键+波形+时长）、文件/图片附件卡；URL 自动渲染 Link 预览卡（域名+链接）；
  被引用消息在气泡内左侧强调边引用块；时间/回执独立 16px 元信息行；
  回应为计数 chip、可点切换；Thread 汇总 chip（消息数）打开右侧 Thread 侧栏。
- Thread 侧栏：根消息 + 回复流 + 独立 “Reply in thread…” 输入（Enter 发送、空内容禁用），
  回复计数实时反映到主时间线的汇总 chip；本原型回复为本地状态。
- 消息操作面（对齐真实 `ChatMessageActionOverlay`）：悬停工具条 React / Reply /
  Reply in thread / Forward / More；React 为 6 列 24 表情网格（真实 `REACTION` 全集），
  回应以计数 chip 呈现、可点切换；More 菜单含 Reply in thread / Pin·Unpin / Reply /
  Forward / Copy text / Edit / Recall / Delete for me。Pin 在消息元信息行渲染 Pin chip；
  Edit 与 Recall 仅对本人、发送 4 分 30 秒窗口内（`FRIEND_RECALL_WINDOW_MS`）、
  且 Edit 仅文本消息可见；Edit 将内容载入 composer 并显示编辑引用条（Save/Cancel，
  空内容禁用保存），提交后正文更新并显示 `Edited` 标记（保留原发送时间与排序）；
  Recall 将消息替换为墓碑态且保留行 `data-chat-message-id` 身份；Delete for me 二次确认。
  本原型全部为本地交互态。
- 会话头部（对齐真实 `ChatMessageArea` header）：名称旁为私聊 presence dot chip
  （`data-chat-presence-tag` = online/offline/unknown，未知显式渲染、不折叠为离线）、
  端到端加密 Lock、Authority Station pill（`Server` 图标 + `Station · 名称`，
  `data-chat-station="authority"`，群聊回退当前 Station 名）；副标题保留在线/成员数与
  typing 提示。
- 消息内搜索跳转（对齐真实 `highlightedMessageUlid`）：头部 Search 弹层命中后点击结果，
  关闭弹层、目标行 `scrollIntoView({block:'center'})` 平滑滚动并高亮 1.8s 后淡出
  （`data-chat-message-highlight`）。
- 安全验证：私聊 “View safety number / Verify identity” 打开安全码弹窗（QR +
  60 位安全码 + Mark as verified）。
- Composer（对齐真实 `ChatComposer`）：白色圆角 shell + 轻阴影，内嵌 3 行起、
  自动增高（≤180px，展开 ≤320px）的 textarea；左侧工具键 Emoji / File /
  Screenshot / Voice，右侧 Expand/Collapse 与方形 Send；Enter 发送、Shift+Enter
  换行、IME 组合不误发；表情为 420px 弹层（Recent 持久化 localStorage +
  All 40 个 + 底部条），按光标插入并回填焦点，插入后关闭；回复/编辑引用条带左侧强调边。
  File 通过真实 `<input type=file>`（浏览器 File API）选取，在 composer 内显示待发附件 chip（可移除），发送后图片渲染为缩略图、文件渲染为附件卡（名称+大小），会话预览同步为 `[Image]/[File] 名称`；Screenshot/Voice 因依赖桌面录制能力，以 toast 说明仅桌面端可用，不做假实现。
- 会话列表（对齐真实 `ChatSessionList`）：顶部为可输入 Search（非静态条），
  实时过滤会话（名称/末条/信任标签），下拉展示会话与可直开的联系人（`UserPlus` 行），
  选择后跳转会话/为联系人新建私聊；带清空按钮；右键 Pin/Mute/Mark read/Hide/Delete 不变。
- Presence/Typing（对齐真实 presence 副标题）：私聊在线对端在发送后显示 1.8s
  “typing…”（头部副标题主色 + 时间线三点气泡动画），随后自动消失；生产由 SSE 驱动，原型为本地演示。
- 群聊样本：当前用户为群主、管理员、普通成员三种权限态。
- 消息样本：文本、系统消息、图片、文件、失败发送状态。
- `CHAT-CRAFT-J01`：发送消息已本地保存但远端未确认；用户可从会话级
  recovery surface 或消息级动作重试，恢复后显示 delivered receipt 与对端确认。
- Contacts 样本：3 条好友请求（2 已接受、1 待处理）、1 个已保存群、按 PTID
  去重的联系人行（含同名 Bob/Carol 各两条 Home Station 身份）；Accept/Reject、
  详情选中、群 Message 跳转会话均为原型本地状态。
- 操作样本：发送 mock 消息、打开详情、成员管理、角色调整、禁言、转让群主、清空历史、退出/解散确认。
- Direct 设置样本：本地背景选择立即预览、消息搜索与输入框内清除、24 小时内清空/恢复历史。
- 通话样本：语音/视频呼出、来电、接通、弱网重连、结束、失败提示。
- 通话浮层边界：紧凑态复用 `GlobalOperationTray` 的 `240–320px` 宽度、
  `right/bottom: 20px` 锚点和轻量 raised surface；语音与来电保持单行紧凑态。
- 视频显示范围：紧凑态保持同一锚点并增加媒体高度；`Fill Chat module`
  仅覆盖 `SocialChatPage` 根边界并保留 Desktop 全局 rail；`Enter full screen`
  才覆盖整个 viewport。

## 当前工艺证据（2026-10-11）

- Product thesis：投递失败时，用户无需猜测消息是否丢失，并可在原会话内完成恢复。
- Signature：只在 delivery uncertainty 出现时展开一条 quiet delivery
  recovery surface；稳定状态不显示协议噪音。
- Positive calibration：上下文不断裂、失败反馈局部化、输入与密文保留、恢复结果可读回。
- Negative calibration：无独立错误页、无全局告警、无 decorative motion、无
  screenshot-only success claim。
- L2：1440px failed/recovered 与中文窄屏均已实际打开检查；无重叠或横向 overflow。
- L3：Retry 从 failed → sending → delivered，并追加 peer acknowledgement；
  会话/联系人切换、建好友/建群菜单、详情面板、发送消息等既有功能路径回归通过；
  Contacts 主从面板的 Accept/Reject、详情选中与 Message 跳转已真实点击验证；
  无 console/page error。
- L4：新动作有 accessible name；键盘路径、中文 expansion、reduced motion
  和 local lab layout stability 已检查。
- Evidence root:
  `~/.peers-touch/dev/workspaces/48035cb460a725a5/evidence/chat-craft/20261011/`。
- `UNPROVEN`：真实 Station/Relay、Native Desktop、screen reader 实机和生产
  field performance。

## L2 Visual Evidence（2026-09-20）

| 状态 | 视口 / 主题 | 证据 | 判定 |
| --- | --- | --- | --- |
| 视频通话紧凑态 | 1440×1500 / light | [`20260920-call-video-compact.png`](./evidence-l2/20260920-call-video-compact.png) | 320px 宽、右下 20px 锚点；消息上下文保持可读 |
| 视频覆盖 Chat 模块 | 1440×1500 / light | [`20260920-call-video-chat-fill.png`](./evidence-l2/20260920-call-video-chat-fill.png) | 覆盖完整 Chat 根边界；Desktop 全局 rail 保持可见 |
| 视频全屏 | 1440×1500 / light | [`20260920-call-video-fullscreen.png`](./evidence-l2/20260920-call-video-fullscreen.png) | 覆盖整个 viewport |
| 语音呼出紧凑态 | 1440×1500 / light | [`20260920-call-voice-compact.png`](./evidence-l2/20260920-call-voice-compact.png) | 单行 320×64；与 Agent 后台执行 tray 密度一致 |
| 视频来电紧凑态 | 1440×1500 / light | [`20260920-call-incoming-compact.png`](./evidence-l2/20260920-call-incoming-compact.png) | 无全屏 backdrop；接听/拒绝动作保持可见 |
| 视频紧凑窄窗口 | 1024×1500 / light | [`20260920-call-video-compact-narrow.png`](./evidence-l2/20260920-call-video-compact-narrow.png) | 不超出 Chat 根边界；控件无截断或重叠 |

## 已知差异 / 待补

- 原型使用 mock 数据，不接 Station、Desktop Rust、实时同步或真实端到端加密。
- `UNSYNCED`：真实 Desktop 在 X3DH 进行中显示 `Establishing secure channel…`，
  且只在 DM/MLS 会话真实 ready 后显示锁图标；当前原型仅覆盖稳定加密态。
  下一步由 Chat / Social Owner 在原型状态切换器补 `establishing` 态并完成 L2 截图确认。
- 同名联系人现在按 PTID 保留独立行，并在 Contacts / Create Group 中以两条
  可完整阅读的次级身份行分别展示 Federation 与 Home Station domain。头像
  fallback 以 PTID 而不是显示名稳定取值，且统一由方形 Avatar 组件控制圆角。
- Create Group 原型现在使用可见联系人选择，并覆盖“失败后保留选择 + inline error
  + Retry”的恢复态；第二次提交进入 mock 成功态。该 mock 只证明交互形态，
  不构成真实 MLS 或 Native Acceptance 证据。
- 文件/图片只展示交互卡片，不做真实上传或下载；背景选择使用本地对象 URL
  表达即时预览，生产实现仍必须完成异步上传、持久化和失败回滚。
- 消息搜索为原型内过滤（全局 + 单会话）；真实结果必须来自 Desktop 本地持久化投影。
- 消息回应/撤回/删除/转发/回复、安全码标记均为原型本地交互态，不与 Station
  持久化或真实端到端加密同步；Thread 侧栏、@提及、语音录制、截图/剪接、
  Link preview 尚未实现，真实能力见 `apps/desktop/src/components/chat/`。
- 在线、离线与状态不可用是三个独立状态；生产实现必须由 Presence owner 的
  snapshot/event 驱动，原型不模拟网络权威。
- Owner 确认前不得把本原型当作真实 Desktop 落地依据。
