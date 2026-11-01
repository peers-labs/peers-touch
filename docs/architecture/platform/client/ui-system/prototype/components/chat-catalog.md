# 聊天目录层（迁移增量 10，增量 17/19/20/21 修订）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Updated**: 2026-11-01（增量 21；同日文档校正：群头像/联系人详情两条与增量 17/21 代码对齐）
> · **Owner**: Client Platform / UI System
> **旧来源**：`pages/SocialChatPage.tsx`（chats/contacts 子导航）、
> `ChatSessionList`、`ChatContactsPanel`、`ChatContactsDetailPanel`、
> `FindPeopleModal`、`CreateGroupModal`、`ChatSearchDropdown`
> **前置**：[conversation-view](./conversation-view.md)（增量 2）

## 1. 产品边界

聊天代码迁入 `ui-system/chat/` 目录（`ChatFeature` 编排，替换原 DesignDirections
内联实现）。目录轨在**左** 300px 列、对话在右（增量 20 对齐 desktop SocialChatPage）。

- **头部单行（增量 20）**：消息/联系人 `Segmented`、搜索、行尾动作钮三者水平平齐在一行
  （`.sk-rail-header`，align-items center），全图标无文字（放大镜/＋/✕，资深用户可识别）。
  搜索默认是 34px 圆形图标钮；点放大镜展开为整行输入框（0.22s 动画），tab 区让位收缩到 0
  （opacity 同步淡出）。行尾钮随状态切换：收起态为 **＋新建菜单**（找人/创建群聊），
  展开态为 **✕取消搜索**（同一位置单钮双态：清空查询、移出焦点、收起，再变回 ＋）；
  Esc 等价取消（结果弹层打开时 Popover 会在 document 捕获吞 Esc，故在 window 捕获阶段处理）。
  失焦且查询为空时搜索自动收起。
- **搜索结果弹层（增量 20 重排）**：两组固定顺序——**联系人在前、聊天在后**
  （聊天组内含群聊与单聊，行带 kind 标记）；查询期间两组始终渲染，无命中的组显示
  居中文案 `---无相关联系人---` / `---无相关聊天---`（i18n 键 `search.empty.contacts/chats`），
  不再用整面板 Empty。点联系人直接开/建会话（增量 21 起两轨一致）。
  消息轨内列表同时按查询实时过滤（联系人轨不另过滤，结果只走弹层）。
- **消息/联系人子导航**：头部 `Segmented`；消息轨 = 会话列表，联系人轨 = 好友请求 + 联系人列表。
- **点人即开聊（增量 21，微信式）**：联系人轨/搜索/找人弹窗里点任意人或群，直接打开（不存在则创建）
  对应会话并切到消息轨；不再有中间资料卡与「发消息」二次点击。联系人资料改由会话内
  ⓘ 资料卡承载（见 chat-conversation-frame.md）。
- **会话行**：单人方圆头像（右下在线状态点）；群聊 3×3 九宫格拼贴
  （`GroupAvatar9`，增量 17 对齐真身 SessionList，见 chat-session-list.md）；
  搜索结果弹层里的群聊行才用 `AvatarGroup` 重叠圆。置顶/免打扰标记；
  hover 行尾操作（静音/置顶/⋯ 三个兄弟钮，与行点击同为 `li` 子节点，杜绝 button 嵌套）；
  未读角标；置顶行优先排序。
- **联合搜索**：见上方「搜索结果弹层」（增量 20 前为联系人/群聊/会话三组，
  现按联系人优先重排为联系人/聊天两组）。
- **新建菜单**：收起态行尾圆形 ＋ 图标钮（Menu 自带触发器）——找人（复用找人 Dialog，11 人池）/ 创建群聊；
  搜索展开时该位置为 ✕ 取消搜索钮（见上）。
- **好友请求（入站）**：接受/拒绝状态标签；接受首次失败显示行内错误 Alert，重试后变「已同意」；
  拒绝变「已拒绝」。已处理请求不消失，沉入「历史请求」分区（仅状态标签，无操作钮），
  与真身 ContactsBook 的状态点列表一致。
- **好友请求（出站，增量 19 新增）**：本地发出的 pending 请求独立「已发出 · N」分区，
  站名标签 + 「· 已发送，等待对方接受」+ 撤回请求钮（从列表移除）；
  入站/出站计数分别挂 `data-pending-count` / `data-outgoing-count`。
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
- 群头像不用 peers-ui 的 `GroupAvatar`（2×2 宫格语义，适合群徽标而非会话行）：
  搜索结果群行用 `AvatarGroup` 重叠圆 + 描边（与朋友圈头像组一致）；
  会话行在增量 17 改为 3×3 九宫格 `GroupAvatar9`（对齐真身 SessionList，
  见 chat-session-list.md），不再与搜索行共用同一头像组件。
- `Menu` 自带触发器与弹层（内部 `Children.only`），不能再外套 Popover——
  这是本次迁移踩到的真实组件合同，后续菜单一律直用。
- 增量 20 回归 desktop 两处布局事实：会话轨在左（早期北极为右轨，是相对真身的退化）；
  搜索为头部紧凑图标钮、聚焦展开吃掉 tab 空间；结果联系人优先、两组各自空态 tips
  （真身 SessionList 只有单一空文案，分组 tips 是对「联系人/聊天来源可辨识」的改进）。

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
取代旧联系人详情/发消息跳转断言（增量 21 截点：总门禁 101 动态场景全 OBSERVED）。
consumer 18/18，tsc 干净，0 console error。
> 滚动总数以 [migration-chat-social-settings.md](../migration-chat-social-settings.md)
> 为准（增量 22 起 north-star 108/108、consumer 17/17）；本节数字是增量 21 历史截点，不随后续增量回改。

## 4. UNPROVEN

真实 IM 会话同步、好友请求传输与接受通知、联邦联系人发现、出站请求的真实撤回协议、
联邦 MLS 加密群（当前阻断是产品边界的本地演示，不是服务端裁决）、群成员权限、
会话列表错误/过期重试的真实运行时状态。
