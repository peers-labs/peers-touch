# Desktop 功能迁移图：chat · social · settings（用 peers-ui 重建）

> **Status**: draft / 增量推进中
> **Created**: 2026-10-30 · **Owner**: Client Platform / UI System
> **Frame**: [北极星窗框](./north-star-frame.md)，入口 `?eles=directions`
> **方法**：每个增量 = 旧设计审计（新方法论找缺口）→ 用 peers-ui 元素组合 → 状态合同 → 探针门禁 → 人审 → token/知识沉淀。未过门前不称为完成。

## 0. 范围裁定

| 域 | 现状来源（desktop） | 本轮 |
|---|---|---|
| 人对人聊天 | `pages/SocialChatPage.tsx`（399 行）、`components/chat`、`components/messages` | ✅ 迁移 |
| 社交动态 | `pages/moments/`：Feed / Explore / User / MomentDetail / CircleManage / UserSearch | ✅ 迁移 |
| 设置（非 AI、非联邦） | `pages/SettingsPage.tsx` 分组 general / tools / channels / applets / data / help | ✅ 迁移 |
| AI 聊天 | `pages/ChatPage.tsx`、`AgentChatPage`、AgentGroups | ❌ 排除（AI） |
| AI 设置 | 设置分组 ai（providers/models/discover/memory/skills/mcp/voice）、BotsSettings、AgentGrowth | ❌ 排除（AI） |
| 联邦 | `FederationTab`、settings group federation、中继/联邦专属设置 | ❌ 排除（federation） |

边界说明：`channels` 组里的 **bots**（消息通道机器人）与 AI 机器人有重叠，迁移到该增量时单独人审归属，默认先排除；`connections` 属人对人通道，纳入。

## 1. 旧设计审计方法（每个增量必做）

对照 [窗框语法](./north-star-frame.md) 七条与 craft C1–C13，逐项给旧实现打「保留 / 重做 / 删除」：

- 是否 1px 发丝描边分区（应材质化）；身份元素是否方圆；圆角是否长在绘图层。
- 动作是否近黑胶囊、单一强调；按钮是否 UA 重置；有无死按钮。
- 焦点环是否跟随圆角且即时（无 transition）；内嵌控件是否漏方框。
- 组件是否可用 peers-ui 直接组合；旧 antd/`@lobehub/ui`/react-layout-k 用法是否应替换。
- i18n、空态、加载、极值长文本、390/宽屏、键盘与 ARIA 是否齐全。

## 2. 依赖与顺序（自底向上，组件先行）

| # | 增量 | 组合的 peers-ui 元素 | 依赖 |
|---|---|---|---|
| 1 | **会话轨 ConversationRail**（chat/social 共用） | Avatar/GroupAvatar、Badge、Button/IconButton、SearchField、List/ListItem、EmptyState、ScrollArea | SearchField（已训练） |
| 2 | 对话窗 ConversationView | MessageList 自有渲染 + Avatar、TextArea/TextField、IconButton、InfiniteList/ScrollArea、EmptyState | 1 |
| 3 | 发起会话/联系人选择 | Autocomplete 或 List+SearchField、Avatar、Button、Modal/Dialog | 1 |
| 4 | 动态流 MomentsFeed | Card、Avatar、Badge、IconButton、Tag、EmptyState、InfiniteList | 2 |
| 5 | 动态详情 / 发动态 / 圈友管理 | 同 4 + TextArea、Dialog、AvatarGroup | 4 |
| 6 | 设置框架 SettingsFrame | SectionNav、Accordion/Disclosure、Card/Surface、PageHeader | — |
| 7 | 通用设置行 SettingsRow | Switch、Select、TextField、Button、InlineAlert | 6 |
| 8 | 数据/存储设置 | Switch、Button、Progress、Alert、Table（保留项） | 7 |
| 9 | 工具/通道/小程序/帮助分组 | Select、TextField、Tag、Accordion | 7 |

每个增量单独门禁（结构/交互/工艺/无死按钮/双视口），通过后才进入下一个。

## 3. 技术约束

- 迁移面使用 `@peers-touch/ui`（web owner）组合，不复制组件；皮肤只覆盖 CSS 变量与窗框级布局，不改 peers-ui 行为合同。
- 原型内数据为本地 fixture，不接 station/runtime；真实数据流、i18n 词条、读屏/触摸、生产消费保持 UNPROVEN，逐项显式标注。
- 已排除的 AI/federation 元素不得借通用组件回流。

## 4. 进度

- [x] 0 SearchField 训练（既有）
- [x] 1 ConversationRail（peers-ui Avatar/Badge/Button/Empty + 已训练 SearchField；
      8 会话、未读角标、选中清未读、轨内过滤、双皮肤令牌桥接；门禁 12/12）
- [ ] 2 ConversationView（消息流 + 输入区）
- [ ] 3 …9
