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
| 4 | **动态子系统 MomentsFeature**（范围导航/首页/探索/找人/圈友/详情/个人页/发动态） | Segmented、Popover、Menu、Dialog、AvatarGroup、Toggle、TextArea、TextField、Select、IconButton、Empty | 2 |
| 5 | ~~动态详情 / 发动态 / 圈友管理~~（已并入增量 4；私密动态/媒体内容种类等保持延后） | 同 4 | — |
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
- [x] 2 ConversationView（peers-ui TextArea embedded / IconButton send / Avatar；
      peer/me 气泡、时间、本地发送、Enter 发送、空禁发、焦点环归属；合同见
      components/conversation-view.md；门禁 14/14）
- [x] 3 发起会话/联系人选择（peers-ui Dialog + SearchField + Avatar + Empty；
      新联系人创建/已有打开、过滤空态、portal 弹层同皮肤令牌；合同
      components/contact-picker.md；门禁 18/18）
- [x] 4 动态子系统 MomentsFeature（按 desktop 功能面重做：Segmented 四范围
      首页/探索/找人/圈友，48 方圆头像与来源·理由·受众信任行，16 反应 Popover +
      琥珀选中，图片网格灯箱，评论预览/详情/真实发评论，发动态 Dialog + 受众选择，
      个人页 72 身份头与关注，圈友头像组与新建圈子，加载更多；身份层级轨 44/卡 48/
      个人页 72；合同 components/moments-feature.md；门禁 31/31，1360/390 双宽度）
- [x] 5 动态详情 / 发动态 / 圈友管理（并入增量 4；私密动态 native 状态机、视频/投票/
      定位/转发等内容种类、真实图床与持久化保持 UNPROVEN）
- [x] 6 设置框架 SettingsFrame（6 分组材质药丸 + 多分区分区导航 + Section/Row/ItemCard
      原语 + 语言 Select + 截图快捷键录制；未建分区为诚实 Empty；合同
      components/settings-frame.md；门禁 35/35）
- [x] 7 账号/安全/帮助内容（身份卡/可复制 ID/资料编辑/标签链接/设备关联二维码状态机/
      恢复密钥与备份/24 词恢复/帮助折叠跳转；合同
      components/settings-account-security-help.md；门禁 40/40）
- [x] 8 数据/存储设置（用量/留存/清缓存/会话表批量删除进度/文件上传/日志分级；
      合同 components/settings-data.md；门禁 45/45）
- [x] 9 工具/通道/小程序（cron/命令面板/工具表/飞书开通向导/小程序钻取；Bots 挂起；
      合同 components/settings-tools-channels-applets.md；门禁 53/53）

## 5. 全功能点审计与执行计划（2026-10-31 临时计划）

> 方法：逐文件审计 `apps/desktop/src/pages/*` + `components/{chat,settings,moments}`，
> 每个功能点标注 ✅ 已迁入 / ◐ 部分 / ✗ 未迁；排除 AI、Federation 两大分组。
> 所有迁移只用 peers-ui 组合，本地真实状态，不允许死控件。

### 5.1 Chat / Social 功能点审计

会话与联系人（SocialChatPage 左两层）：
- [x] ✅ 会话轨：列表/未读角标/过滤/选中清未读/新建会话（增量 1/3）
- [ ] ◐ 群会话：fixture 有群数据但未用 GroupAvatar，无群名/群预览层级
- [ ] ✗ 会话行状态：置顶（Pin）、免打扰（BellOff）标记
- [ ] ✗ 新建菜单：找人（已有）+ 创建群（CreateGroupModal：多选成员、群名、创建失败重试）
- [ ] ✗ 会话搜索下拉：联系人/群/会话联合结果（ChatSearchDropdown），区别于当前轨内过滤
- [ ] ✗ chats/contacts 子导航 + 联系人面板：好友请求（接受/拒绝/待处理·已同意·已拒绝状态/行内错误）、
      联系人列表
- [ ] ✗ 联系人详情面板（ChatContactsDetailPanel：资料、发消息、建群 opening 态）
- [ ] ✗ 会话列表错误态（blocking/stale）与重试

对话窗（ChatMessageArea）：
- [x] ✅ 文本消息流 + 输入区 + Enter 发送 + 空态禁发（增量 2）
- [x] ✅ 1:1 音视频通话（呼出状态机增量 11；来电接听/拒绝增量 14，详情面板有演示入口）
- [x] ✅ 群通话（GroupCallSurface：加入/参与者网格/发言高亮/静音摄像头联动；增量 14）
- [x] ✅ 会话详情面板（成员、置顶/免打扰开关、共享媒体；增量 11）
- [x] ✅ 会话内消息搜索（增量 11）
- [x] ✅ Thread 话题面板（种子回复 + 发送计数联动；增量 11）
- [x] ✅ 消息行操作：消息反应、回复/进 Thread、转发、复制、
      删除确认、悬浮操作条几何（增量 12；含窄宽单栏交换与不透明浮层 token）
- [x] ✅ 服务/系统消息（入群/建群事件居中胶囊；增量 11）
- [x] ✅ 链接预览卡（气泡内图标/标题/单行省略；增量 12）
- [x] ✅ @提及（活 token 候选弹层 + 气泡内原子令牌高亮；增量 12）
- [x] ✅ 输入区：emoji（最近使用）、文件/图片附件（草稿/进度/重试/移除/粘贴/拖放）、
      截图入口（浏览器壳映射为图片选择）、真实 MediaRecorder 语音（录制/取消/完成/试听/发送、
      气泡内播放与进度）、输入框展开/收起（增量 13）
- [x] ✅ 附件详情宿主：图片 Dialog（含本地保存）/文件详情 Dialog/语音播放器（增量 13）
- [x] ◯ 只读分享页：审计确认旧 SharePage 属 AI Agent 域，社交聊天无此能力；
      按不做烟囱原则不迁移（增量 13 审计结论）

Social / Moments：
- [x] ✅ 动态子系统全功能面（增量 4：四范围/卡片解剖/16 反应/图片灯箱/评论/发布/
      个人页/找人/圈友/分页）
- [ ] ✗（UNPROVEN 延后）视频/投票/定位/外链/转发内容种类、私密动态 native 状态、
      真实图床、@提及与话题、删除/举报

### 5.2 Settings 功能点审计（排除 AI 7 项与 Federation）

- [x] ✅ S0 框架：6 分组材质药丸（AI·联邦不出现）、多分区分区导航、
      SettingsSection/ItemCard/Row 原语（深链高亮不适用原型层）
- [x] ✅ S1 通用：语言切换；截图快捷键录制/重置/默认值（增量 6）
- [x] ✅ S2 账号（AccountTab）：身份卡（头像/头图本地选图）、统计、
      @username 与 PTID 可复制、资料编辑、标签、链接增删、设备关联状态机（增量 7）
- [x] ✅ S3 安全（RecoverySettings）：24 词密钥生成/复制、创建备份门禁、
      恢复对话框 24 词门槛（增量 7）
- [x] ✅ S4 工具：工具表（分类/审批标签）、定时任务（新建校验/启停/运行/删除）、
      命令面板（过滤 Dialog；增量 9）
- [x] ✅ S5 通道：飞书开通向导（域名→授权→开通→入列）、已连接卡投递/入站开关、
      移除确认；企业路由/健康配置 UNPROVEN；Bots 显式挂起（增量 9）
- [x] ✅ S6 小程序：列表 + 可配置项二级钻取开关面板 + 只读项不可点（增量 9）
- [x] ✅ S7 数据：聊天留存、清缓存两段确认、会话存储表（多选/批量 Progress/单项重试）、
      文件管理（上传 Dialog/复制/下载/删除）、日志分级过滤（增量 8）
- [x] ✅ S8 帮助：关于卡 + 内置搜索功能折叠表（4 项，点击真实跳转；增量 7）

### 5.3 执行分组（每增量独立门禁 + 截图人判）

- [x] 6 SettingsFrame + SettingsRow 原语（S0 + 通用分区语言/快捷键；门禁 35/35）
- [x] 7 通用/账号/安全/帮助（S1 在 6 落语言+快捷键；S2/S3/S8 在 7；门禁 40/40）
- [x] 8 数据：存储/文件/日志（S7；门禁 45/45）
- [x] 9 工具/通道/小程序（S4/S5/S6；bots 显式挂起；门禁 53/53）
- [x] 10 聊天目录层：子导航/联系人/好友请求(失败重试)/详情/建群(失败重试)/群头像组/
      置顶免打扰/联合搜索；合同 components/chat-catalog.md；门禁 62/62
- [x] 11 对话框架：头部 4 入口/详情侧拉/消息搜索/Thread 回复/服务消息/1:1 通话状态机；
      合同 components/chat-conversation-frame.md；门禁 67/67
- [x] 12 消息解剖：反应/回复/转发/复制/删除确认/链接预览/@提及；
      顺带补齐窄宽（≤1040）目录↔对话单栏交换与 `--sk-overlay` 不透明浮层 token；
      合同 components/chat-message-anatomy.md；门禁 69/69（consumer 18/18）
- [x] 13 富输入：emoji/附件草稿（进度/失败重试/移除/粘贴/拖放）/截图图片选择/
      真实 MediaRecorder 语音/气泡播放器/图片文件详情 Dialog/输入展开；
      SharePage 经审计属 AI 域不迁移；探针新增 setFiles 与 fake-media 驱动；
      合同 components/chat-rich-composer.md；门禁 75/75（consumer 18/18）
- [x] 14 通话面：来电接听/拒绝（详情面板演示入口）、群通话网格（stagger 加入/发言高亮/
      静音摄像头联动）、通话状态上提 ChatFeature；合同 components/chat-calls.md；门禁 78/78（consumer 18/18）
- [ ] 15 跨模块设计哲学总评：样式/边界/对齐/对称全量走查 + craft battery 加固

### 5.4 决策（2026-10-31 已确认）

- 通话纳入：增量 14 做 1:1 与群通话本地状态机（振铃/接通/静音/摄像头/挂断），不接 P2P。
- Bots 设置继续挂起，等归属决策；增量 9 不含 Bots。
- 执行顺序：先 Settings（6→9），再深 Chat（10→14），最后增量 15 跨模块设计哲学总评。
