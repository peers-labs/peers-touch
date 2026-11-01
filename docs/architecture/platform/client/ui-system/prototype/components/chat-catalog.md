# 聊天目录层（迁移增量 10，增量 17/19/20/21/29/33 修订）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Updated**: 2026-11-01（增量 21；增量 33：轨内搜索回归、联系人分区折叠、请求动作图标化）
> · **Owner**: Client Platform / UI System
> **旧来源**：`pages/SocialChatPage.tsx`（chats/contacts 子导航）、
> `ChatSessionList`、`ChatContactsPanel`、`ChatContactsDetailPanel`、
> `FindPeopleModal`、`CreateGroupModal`、`ChatSearchDropdown`
> **前置**：[conversation-view](./conversation-view.md)（增量 2）

## 1. 产品边界

聊天代码迁入 `ui-system/chat/` 目录（`ChatFeature` 编排，替换原 DesignDirections
内联实现）。目录轨在**左** 300px 列、对话在右（增量 20 对齐 desktop SocialChatPage）。

- **头部薄板（增量 29 收敛，增量 33 修订）**：消息/联系人 `Segmented`（compact）＋
  轨内搜索图标钮＋行尾一个「＋」方圆图标钮，收进一条薄板（`.sk-rail-header`）。
  轨内搜索是**当前 tab 的就地列表过滤**：搜索钮展开单行 `TextField` 吃掉 tab 空间
  （Esc/关闭钮还原），消息轨按会话名/最后发言过滤，联系人轨跨四分区按
  姓名/站点/招呼语/简介过滤，搜索态分区标题隐去、结果打平。
  跨面全局导航仍走外轨 ⌘K（见 global-search-overlay.md）；
  会话内找消息统一收进资料卡「查找聊天记录」。三类搜索职责不重叠。
- **新建菜单**：「＋」弹出 发起单聊 / 建群两项（Menu 自带触发器，方圆 quiet 钮）。
- **消息/联系人子导航**：头部 `Segmented`；消息轨 = 会话列表，联系人轨 = 好友请求 + 联系人列表。
- **点人即开聊（微信式）**：联系人轨/找人弹窗里点任意人或群，直接打开（不存在则创建）
  对应会话并切到消息轨；不再有中间资料卡与「发消息」二次点击。联系人资料改由会话内
  ⓘ 资料卡承载（见 chat-conversation-frame.md）。
- **会话行**：单人方圆头像（右下在线状态点）；群聊用唯一的 `GroupAvatarComposite`
  拼贴（2–4 人 2×2，5–9 人 3×3；列表与资料卡共用同一渲染，增量 29）。
  置顶/免打扰标记；hover 行尾操作（静音/置顶/⋯ 三个兄弟钮，与行点击同为 `li` 子节点，杜绝 button 嵌套）；
  未读角标；置顶行优先排序。
- **联系人四分区（增量 33）**：新的请求 / 已发出 / 历史请求 / 联系人四段，标题统一为
  peers-ui 全宽安静钮（chevron + 名称 · N，`aria-expanded`、`data-collapsed`），
  空分区不渲染；默认仅**历史请求收起**（已处理存档不是待办），其余三段展开。
  计数（`data-pending-/outgoing-/history-/friends-count`）只挂数据，与折叠/搜索无关。
- **请求动作图标化（增量 33）**：接受/拒绝/撤回/删除不再独占整行文字钮，全部收进
  name 行右侧的 ghost `IconButton` 簇（✓ 接受，✕ 拒绝，↩ 撤回，🗑 删记录）；
  桌面 hover/聚焦行才浮现（与会话行动钮同一语法，主 owner 是人不是按钮），
  触摸/≤720px 常驻；接受 hover 走语义绿、拒绝/删除 hover 走危险红。
  接受首次失败仍显示行内 Alert，✓ 标签变「重试接受」。
- **好友请求（入站）**：接受变「已同意」、拒绝变「已拒绝」，记录沉入历史分区；
  历史记录可在 name 行直接删除（本地日志行，直接移除，无需二次确认），删空分区消失。
- **好友请求（出站）**：本地发出的 pending 请求在「已发出 · N」分区，
  站名标签 + 「· 已发送，等待对方接受」+ ↩ 撤回（从列表移除）。
- **联系人移除（增量 33）**：好友行行尾 hover `user-minus` 图标，两段确认 Dialog
  （标题带姓名、正文声明会话记录保留），确认后从联系人分区移除并更新计数（本地示例）。
  （增量 19 时好友点选曾在中栏显示联系人详情卡，增量 21 已随「点人即开聊」删除，
  代码固定传 `selectedContactId={null}`，勿再恢复中栏资料卡。）
- **发消息（增量 21 并入点人即开聊）**：旧详情卡「发消息」按钮已删除；
  现在点人本身即对已有会话直接打开、对新人创建会话，并切回消息轨。
- **创建群聊 Dialog**：成员多选 + 群名；无成员/无名称时提交禁用；首次提交失败出危险 Alert，
  「重试创建」pending 后入列、选中、写入服务消息。
- **建群联邦边界（增量 19 新增）**：候选池是全部已知人（含联邦站联系人，行尾站名标记）。
  选中任一非本站成员即进入 blocked：危险 Alert 点名跨站成员、提交钮以
  「联邦成员暂不能加入加密群」原因禁用（B19 可聚焦+原因暴露，不用原生 disabled）；
  取消跨站选择后立即恢复可提交。语义对应真实产品的联邦 MLS 群未交付边界。
- **群消息**：群会话气泡带发送者名与小头像；服务消息居中胶囊。

## 2. 旧设计审计

- desktop 的 48px 内层 icon 子导航改为轨顶 Segmented 药丸，与设置/动态范围切换同一语言。
- 旧会话行把置顶/免打扰画在行内（button 包 button 隐患）；新实现行点击与操作按钮为
  `li` 下兄弟节点，hover 浮现，消除嵌套交互元素。
- 群头像统一用 `GroupAvatarComposite`（增量 29 前会话行曾用 3×3 私写的 `GroupAvatar9`、
  搜索结果群行用 `AvatarGroup` 重叠圆 + 描边（与朋友圈头像组一致）；
  资料卡另有 2×2 灰底版本，两处不一致；增量 29 合并为同一组件，按成员数推导宫格，
  见 chat-session-list.md），不再与搜索行共用同一头像组件。
- `Menu` 自带触发器与弹层（内部 `Children.only`），不能再外套 Popover——
  这是本次迁移踩到的真实组件合同，后续菜单一律直用。
- 增量 20 回归 desktop 两处布局事实：会话轨在左（早期北极为右轨，是相对真身的退化）；
  搜索为头部紧凑图标钮、聚焦展开吃掉 tab 空间（增量 29 曾随全局 ⌘K 统一移除轨内搜索，
  增量 33 以「轨内就地过滤 ≠ 跨面导航」的职责切分恢复）。
- 增量 33 信息密度修正：旧请求卡把接受/拒绝两个全宽文字钮独占一行，卡片被动作撑高、
  name 反成配角；新实现把决策收成 name 行右侧 ghost 图标簇（桌面 hover 浮现），
  卡片高度只服务于人。四段平铺不可折叠、百条规模不可用，改为统一分区折叠钮；
  历史记录与好友补删除/移除入口。

## 3. 门禁

更新增量 1–3 全部旧探针（会话数/找人菜单/选择器），新增 8 场景：
目录结构、联系人请求失败重试、联系人详情、发消息跳转、建群失败重试、置顶/免打扰、
联合搜索分组（能力 62/62）。增量 19 增补 `contact-outgoing-cancel`、
`create-group-federation-block`，并把 `contact-requests` 断言迁到入站/出站/历史三分。
增量 20 增补 `rail-left-and-level-header`（grid 列位/水平行/收起态）、
`rail-search-expand`（展开标记/tab 收缩为 0/失焦收起）、`rail-search-ordering`
（联系人在前、命中时无 tips）、`rail-search-empty-tips`（双虚线 tips），
并为 `conversation-filter` 补聚焦步骤。增量 21 以 `contact-direct-open`
（直接打开会话、chats 轨激活、`.sk-contact-detail` missing、桌面无返回钮）
取代旧联系人详情/发消息跳转断言。增量 33 增补五场景：
`contact-rail-search`（联系人轨搜索展开、四分区打平隐藏、按姓名/站点过滤）、
`contact-rail-search-chats`（消息轨按会话名就地过滤、关闭恢复）、
`contact-sections-collapse`（历史默认收起 + body `display:none`、展开 `flex` +
`aria-expanded`，动作分区默认展开）、`contact-history-delete`（历史记录 name 行
直接删除、计数归零、空分区消失）、`contact-remove-friend`（好友 hover 移除 →
确认 Dialog → 计数 4→3）；既有 `contact-requests` / `contact-outgoing-cancel`
动作 actionId 全部不变（仅从文字钮变图标钮）。
增量 33 截点：north-star 120/120 OBSERVED，1360/390 双宽 0 console error、
390 无横向溢出；import-guard 裸元素债务持平 697；boards/foundation OBSERVED，tsc 干净。
> 滚动总数以 [migration-chat-social-settings.md](../migration-chat-social-settings.md)
> 为准（增量 22 起 north-star 108/108、consumer 17/17）；本节数字是增量 21 历史截点，不随后续增量回改。

## 4. UNPROVEN

真实 IM 会话同步、好友请求传输与接受通知、联邦联系人发现、出站请求的真实撤回协议、
联邦 MLS 加密群（当前阻断是产品边界的本地演示，不是服务端裁决）、群成员权限、
会话列表错误/过期重试的真实运行时状态。
