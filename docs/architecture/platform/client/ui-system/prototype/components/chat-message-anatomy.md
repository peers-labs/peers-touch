# 消息解剖（迁移增量 12，增量 16/22/43 修订）

> **Status**: draft · **Created**: 2026-10-31 · **Updated**: 2026-11-02（增量 43）· **Owner**: Client Platform · UI System
> **旧来源**：`MessageActionBar`/`MessageReactions`、`ChatMessageArea`（引用块/链接预览/@提及）、
> 转发与删除确认 Dialog、`useChatMention` 候选弹层

## 1. 产品边界（全部 peers-ui，本地真实状态）

- **悬浮操作条**：hover/focus-within 浮现的白色胶囊，peer 气泡右上、me 气泡左上；
  反应、回复、话题、复制、转发、删除（仅本人消息可见，红色 hover）六入口全部有真实去向。
  **增量 22（飞书对齐）**：定位锚从 78% 宽消息行改为内容列，任何气泡宽度下都贴在气泡旁
  而非悬在列中部；DOM 带 `data-bar-side` 语义契约（peer 恒 `right`；me 在「各在一边」
  为 `left`，「统一靠左」偏好下随气泡改为 `right`）。
  **增量 43（锚定气泡盒）**：工具条与气泡同置于气泡尺寸锚定盒 `.sk-msg-main`（不再是
  `.sk-msg-col` 直接子级），`top:6px` 与气泡首行共边——群聊有昵称行时，锚到列会把工具条
  抬到名字高度。≤720px 窄宽改为 `bottom:calc(100%+6px)` 浮在气泡上沿外侧（统一靠左的自己
  消息与 peer 共用右侧外边），避免被裁切。
- **头像（增量 43）**：peer 与自己的消息默认都渲染头像（撤回分支同），群聊 8px 圆角、
  单聊皮肤半径；自己头像用 viewer 身份（`VIEWER_NAME`/`VIEWER_TONE`）。「各在一边」可经
  设置子开关 `hideOwnAvatarInSides` 仅隐藏自己头像，根节点 `data-hide-own-avatar` 仅在
  sides + 开启时为 true；「统一靠左」下开关消失且自己头像强制保留，同侧只改位置不改涂装
  （自己气泡仍 primary 填充、peer 仍 tile）。
- **快捷反应**：Popover 内 👍 ❤️ 😂 😮 四枚无边框圆形按钮；反应以松绿（pine）胶囊沉淀在气泡下，
  本人反应 `data-mine=1`，再点取消，计数真实联动。
- **回复**：操作条回复 → composer 上方引用条（回复对象 + 原文 + 取消 ×）；发送后新气泡内含
  左侧竖线引用块（who/原文），发送后引用条清空。
- **转发**：Dialog 列出当前会话外全部会话（群/单聊 Tag），转发后目标会话真实收到
  「转发：原文」消息并更新会话行预览，toast 反馈。
- **删除**：本人消息 → 两段确认 Dialog（危险红按钮），确认后消息从流中真实移除；
  peer 消息不提供删除入口。
- **复制**：写剪贴板并翻转 `data-copied`，toast 反馈。
- **链接预览卡**：消息 `link` 载荷在气泡内渲染图标 + 标题 + 单行省略描述，
  颜色继承气泡文本，不出现浏览器默认蓝链接。
- **@提及**：群聊 composer 输入活的 `@token` 时弹出成员候选（空草稿不弹、空格收尾关闭），
  选中写入 `@名字 `；发送后气泡内以原子令牌（不内部断行、下划线、650 字重）高亮。

## 2. 旧设计审计

- 旧 desktop 反应选择器是挂载在消息行的自定义层；原型统一为 peers-ui `Popover`，
  面板表面由 Popover 负责，内容只负责四枚圆形按钮，避免自造浮层阴影/定位。
- 删除/转发沿用 desktop 的两段确认与目标选择语义，但诚实标注「本地示例」：
  原型不伪造联邦删除，删除仅作用于本地视图状态。
- 转发不做假的跨端投递：只写本地会话状态；真实 MLS 转发语义留待 desktop 接线。
- **窄宽单栏交换（本增量补的 inc10/11 遗留缺口）**：≤1040px 时目录轨曾被全局
  `display:none` 且无返回路径，窄宽下消息功能是死面。现由 `.sk-chat-feature.sk-narrow-open`
  状态类驱动：无打开面时目录轨占满，打开会话/联系人后交换为内容面，
  头部/资料卡提供返回控件（`chat.back-to-list` / `contact.back`）。
- 新增 `--sk-overlay` 不透明表面 token（三皮肤各自取值）。玻璃皮肤的 `--sk-card-bg`
  是半透明白，浮层（侧拉页、悬浮操作条）若直接使用会让消息流与底层 composer 穿透重影；
  卡片继续用 card，遮挡型浮层一律用 overlay。
- ≤480px 头部保留 返回/标题/语音，视频/详情让位（搜索只在资料卡内）；置顶免打扰在轨行操作内仍可达，
  成员/媒体详情在窄宽降级（见 UNPROVEN）。

## 3. 组件与样式落点

- `chat/MessageActions.tsx`：`ReactionControl`、`MessageReactions`、`ForwardDialog`、
  `DeleteConfirm`、`MessageActionBar`。
- `chat/ConversationView.tsx`：引用块/链接卡/@提及富文本（`renderRichText`）、
  引用条、mention 候选弹层（活 token 门控）。
- `chat/chat.css`：操作条/反应/引用/链接卡/mention、`--sk-overlay` 使用、窄宽交换。
- `chat/ChatFeature.tsx`：`narrowOpen` 状态类与 `backToList`；`ChatDialogs.tsx`/
  `ConversationPanels.tsx` 头部返回控件。

## 4. 门禁

新增 6 场景，能力 **69/69 OBSERVED**（双宽溢出门 1360/390 同过）：
`msg-react-copy-link`（反应胶囊/复制态/链接卡/窄宽返回入口）、`msg-delete`（两段确认后移除）、
`msg-reply`（引用条 → 引用块气泡）、`msg-forward`（目标会话收到转发）、
`msg-mention-pop`（活 token 弹候选；空草稿不拦截指针）、
`msg-mention-select`（写入并收尾空格、弹层关闭）；`contact-detail` 补联系人返回入口断言；
`thread-replies` 回归。consumer 18/18，tsc 干净，0 console error。
Playwright 双宽 Journey（1360 + 390）人工截图核验：操作条双侧归属、反应选择器、
引用块、链接卡、@提及原子渲染、转发/删除 Dialog、话题面板不穿透、窄宽目录↔对话交换。

## 5. UNPROVEN

真实联邦表情回写与多端同步、链接 OG 元数据抓取（现为载荷内静态标题/描述）、
headless 外的剪贴板权限差异、消息编辑/多选/引用跳转定位；
≤480px 暂不提供会话详情侧拉页（成员/共享媒体），置顶/免打扰由轨行操作承载，
详情面在窄宽的完整形态随 mobile 真身设计再定。
