# 聊天目录层（迁移增量 10）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Owner**: Client Platform / UI System
> **旧来源**：`pages/SocialChatPage.tsx`（chats/contacts 子导航）、
> `ChatSessionList`、`ChatContactsPanel`、`ChatContactsDetailPanel`、
> `FindPeopleModal`、`CreateGroupModal`、`ChatSearchDropdown`
> **前置**：[conversation-view](./conversation-view.md)（增量 2）

## 1. 产品边界

聊天代码迁入 `ui-system/chat/` 目录（`ChatFeature` 编排，替换原 DesignDirections
内联实现）。

- **消息/联系人子导航**：轨顶 `Segmented`；消息轨 = 会话列表，联系人轨 = 好友请求 + 联系人列表。
- **会话行**：单人方圆头像；群聊重叠头像组（AvatarGroup）；置顶/免打扰标记；
  hover 行尾操作（置顶/免打扰，与行点击为兄弟控件，杜绝 button 嵌套）；未读角标；置顶行优先排序。
- **联合搜索**：轨内搜索弹 Popover，分「联系人 / 群聊 / 会话」三组实时结果；
  点联系人无会话时直接新建并打开，点已有会话直接选中。
- **新建菜单**：Menu 自带触发器——找人（复用找人 Dialog，11 人池）/ 创建群聊。
- **好友请求**：接受/拒绝状态标签；接受首次失败显示行内错误 Alert，重试后变「已同意」；
  拒绝变「已拒绝」；好友列表点选在中栏显示联系人详情（身份/站点/简介/发消息）。
- **发消息**：详情卡按钮对已有会话直接打开、对新人创建会话，并切回消息轨。
- **创建群聊 Dialog**：成员多选 + 群名；无成员/无名称时提交禁用；首次提交失败出危险 Alert，
  「重试创建」pending 后入列、选中、写入服务消息。
- **群消息**：群会话气泡带发送者名与小头像；服务消息居中胶囊。

## 2. 旧设计审计

- desktop 的 48px 内层 icon 子导航改为轨顶 Segmented 药丸，与设置/动态范围切换同一语言。
- 旧会话行把置顶/免打扰画在行内（button 包 button 隐患）；新实现行点击与操作按钮为
  `li` 下兄弟节点，hover 浮现，消除嵌套交互元素。
- 群头像不用 peers-ui 的 `GroupAvatar`（2×2 宫格语义，适合群徽标而非会话行），
  改用 `AvatarGroup` 重叠圆 + 描边，与朋友圈头像组一致。
- `Menu` 自带触发器与弹层（内部 `Children.only`），不能再外套 Popover——
  这是本次迁移踩到的真实组件合同，后续菜单一律直用。

## 3. 门禁

更新增量 1–3 全部旧探针（会话数/找人菜单/选择器），新增 8 场景：
目录结构、联系人请求失败重试、联系人详情、发消息跳转、建群失败重试、置顶/免打扰、
联合搜索分组（能力 62/62）。consumer 18/18，tsc 干净，0 console error。

## 4. UNPROVEN

真实 IM 会话同步、好友请求传输、联邦联系人发现、群成员权限、
会话列表错误/过期重试的真实运行时状态。
