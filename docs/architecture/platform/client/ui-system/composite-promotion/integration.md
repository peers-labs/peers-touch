# Composite Promotion Pilot — Integration

> **Status**: 搜索实施合同；P2/P3 为候选 · **Owner**: Client Platform / UI System
> 描述双宿主如何接入复合层、测试如何改造、门禁如何联动、如何回滚。

## 1. 宿主适配模式（统一形态）

每个组件两侧各有一个**适配文件**，职责严格限定为数据装配与钩子映射：

```text
Prototype host adapter                 Desktop host adapter
  seed/prefs/local state                 store projection/runtime actions
        │                                        │
        ▼                                        ▼
  view model + t(makeTranslate)         view model + t(i18next)
  classNames: sk-* / data-search-*      classNames: pt-/pp-/sc-* / data-chat-*
        │                                        │
        └──────────────┬─────────────────────────┘
                       ▼
          @peers-touch/ui-composite（唯一组件实现）
```

适配文件允许 import：复合包、ui 原语（仅插槽内容需要时）、宿主自身 store/seed；
不允许再复制复合件的 DOM 结构或 CSS。

## 2. 分组件迁移映射

### 2.1 GlobalSearchSurface（组件一）

原型侧：

- `GlobalSearchOverlay.tsx` 瘦身为适配层：保留 `buildIndex`（seed 索引）、
  `SETTINGS_FUNCTIONS`、recent/quick 装配，输出 `SearchSurfaceModel`；
  键盘/roving/相位逻辑删除（复合件承担）。
- `DesignDirections.tsx` 仍持有 open 状态与 `onNavigate` 路由。
- `global-search.css` 中被复合件接管的规则删除；仅保留宿主专属壳规则（如有）。

生产侧：

- `SearchOverlay.tsx` 瘦身为适配层：`useSearchStore`/`searchPresentation`/
  `searchFrames`/`searchActions` 保留，把 frame 收敛为 `SearchSurfaceModel`；
  roving、IME、copy 的**DOM 行为**进复合件，store 动作仍由 intents 回调触发。
- `SearchHost.tsx` 保留 lazy 加载和 ⌘K 入口；首次访问后保留适配器，让共享组件完成退出帧。
- `functions.ts`、`SearchResultMeta.tsx` 和来源说明的数据装配留宿主。
  说明内容通过 `model.info` 进入共享 Popover，刷新通过 `onRefresh` 调用强制查询。
- `SearchOverlay.css` 已删除；浮层及说明内容的样式全部由共享 `search.css` 管理。
  既有命令菜单通过共享包的 `search.css` 导出继续使用同一套样式，清除旧路径引用。
  命令执行仍由命令菜单负责，不计入本次搜索业务验收。
- `SearchHost` 首次打开后保留适配器，传递真实 `open`，由共享组件完成退出帧和焦点恢复。
  宿主只保留访问寿命；显示状态、选中与滚位继续来自原 Search store。

阻断判据：若 progressive frame 的 `isProgressive/pendingSources/stalled`
无法用 model 字段表达而必须把 store 传入组件，按 design §8.1 停为阻塞。

### 2.2 IdentityProfileCard（后续候选，本轮不实施）

原型侧：

- `IdentityCard.tsx` 瘦身为适配层；`IdentityTrigger` Popover 包装留原型
  （Popover 是 ui 原语，Trigger 属宿主编排）。
- moments 条数据由 moments 宿主经 props 装配；硬编码中文全部转 key。
- `AuthorCard.tsx`、`ChatIdentity.tsx` 两个消费方改为消费适配层。

生产侧：

- `PublicProfileCard.tsx` 瘦身为适配层，三态 variant 映射保留；
  `UserSquareAvatar` 经 `avatarSlot`、关系动作经 `actionsSlot`
  （`ProfilePrimaryAction` 不动）、技术详情复制经 `onCopyTechnical`
  回调，feedback 留宿主。
- 三个消费方（`MessageSenderProfileCard` author、`UserProfilePopover` self、
  `ChatDetailPanel` sheet）只改 import 与装配，变体语义不变。
- `profileCard.css` 随组件搬迁；`northstar.css` 中 popover 外壳规则留宿主。

### 2.3 ConversationRail（后续候选，本轮不实施）

原型侧：

- `ChatRail.tsx` 瘦身为适配层：`SessionRows` 的行 DOM 删除；`ContactsPane`、
  `RequestCard`、`ContactSection` 整体留原型（经 `contactsSlot` 注入）。
- `ChatFeature.tsx` 继续持有全部 seed 状态与回调，只改装配出口。
- `chat.css` 中 rail/row 规则搬迁，composer/message 等规则不动。

生产侧：

- `ChatSessionList.tsx` 瘦身为适配层：store 投影、`searchResults`、
  `buildContextActions`、`handleSelect` 保留；行 DOM 与轨头由复合件承担。
- `renderContacts` 机制映射为 `contactsSlot`；`ChatSearchDropdown` 经
  `railExtraSlot`；`CreateGroupModal`/`FindPeopleModal` 留宿主。
- `chatGeometry.ts`、`chat.css` 行高/角标规则随组件搬迁；宽度
  `CHAT_RAIL_WIDTH` 内联样式留宿主（并行工作流敏感，不接管布局宽度）。
- 不修改 `SocialChatPage.tsx`、`tauri.conf.json`；若接线必须触碰
  `SocialChatPage`，仅做 import 替换并在提交信息登记。

## 3. 测试改造

| 现有测试 | 改造后 |
|---|---|
| `searchOverlayAlignment.test.ts` | 6 项现有结构检查读取唯一共享 CSS，继续检查输入焦点、固定轨道、覆盖与动效；共享行为测试及真实入口补充行为证据，结构检查不作端到端证明 |
| `profileCardAlignment.test.ts` | 复合包 `IdentityProfileCard.test.tsx` 覆盖三态渲染、插槽、技术详情回调、双 hooks；像素级 CSS 断言转为对复合包 CSS 的单一测试 |
| `chatRailAlignment.test.ts`、`chatContactsAlignment.test.ts` | rail 部分进复合包 `ConversationRail.test.tsx`；contacts 相关断言保留在 Desktop（该面未晋升），删掉其中指向行 DOM 的字符串断言 |
| north-star.suite.json | 选择器不改；实现引用路径（implementationRefs）更新到复合包；evaluate-specimens  digest 重新绑定 |

复合包测试基线（每个组件至少覆盖）：

1. 空/有数据/错误三态渲染；
2. 键盘交互（搜索：↑↓ Enter Esc IME；rail：搜索瓦片 Esc；卡片：details 开合）；
3. intent 回调被正确触发且组件不发起任何副作用；
4. `surfaceHooks` 注入的类名/数据属性出现在合同指定区域；
5. 插槽缺省与传入两种路径；
6. 快照式 DOM 结构断言（锁定 ARIA role 与层级）。

## 4. 门禁与登记联动

完整 Search 的生命周期由
[原型总账 §4.2](../../../../engineering/prototypes/README.md#42-完整界面的确认与生产准入)
负责。总账绑定呈现源码摘要、双 adapter 和实际入口；pre-edit context
返回该映射。Desktop Vite 在启动、热更新及构建时检查确认，review/CI
检查 adapter 结构、全宿主共享 CSS 边界及生命周期反例。

后续可见调整须先改原型使用的共享 UI，再取得用户对该版本的确认；
不能先改 Desktop DOM/CSS 后把原型同步成结果。原型可展示草稿，
生产拒绝摘要不匹配的草稿。确认记录不等于原 Native Journey 或正式
Acceptance 的通过证据。

- [ ] `registry.ts`：对应 GAP 转 implemented；双宿主切换完成后转 vetted 并登记 consumedBy。
- [ ] `catalogue.ts`：新增复合能力 id（建议 `ui.comp.search-surface`、
      `ui.comp.identity-profile-card`、`ui.comp.conversation-rail`）与槽位 anatomy。
- [ ] `prototype-import-baseline.json`：私写件删除后重算，只减不增。
- [x] `primitive-layer-guard.mjs` 覆盖 `.ptc-*`；完整界面守卫默认扫描所有
      app/prototype CSS，禁止覆盖共享类与旧宿主钩子，不把全量历史原语债务
      纳入本次迁移。
- [ ] `architecture-modules.json`：本模块投影（文档评审通过即登记，实现状态随组件更新）。
- [ ] locale：新 key 同步 en/zh-CN 与原型 STRINGS，过 `check:locales`。
- [ ] `north-star.suite.json` implementationRefs 与证据 digest 重跑。

## 5. 验证顺序（每组件）

```text
复合包 check + test
  → 原型 check + evaluate-specimens（north-star + boards，0 console error）
  → Desktop check（locales/social-wire/runtime-boundaries/tsc）
  → Desktop vitest 全量
  → Desktop vite build
  → primitive-layer-guard / prototype-import-guard
```

上述源码检查只排除局部接线错误。搜索还须完成
[UI-AC01/02/03](./acceptance-contract.md)：原型实际入口、同一份原生展示数据和
主题的回放对照、可还原的一处共享可见修改，以及原 Native Desktop Journey。

`chat-device-search-native-e2e` 在 Catalog 显式要求 `desktop-macos-native` 和
`acceptance-binary`。环境负责 Station/Actor fixture，Cell 负责当前源码二进制
与原生输入资格；Runner 将二者都交给原 Gate。此 Journey 不操作文件选择器，
其附件由既有 Messaging 上传动作创建，因此不要求额外 chooser capability。
不在命令字符串里手工设置 cell 来代替 Runner 的清单与资源生命周期。

原 Gate 的 `presentationCaptures` 记录完整 `SearchSurfaceData`、已解析文字及
pt 主题。把其中一次 capture 保存为 JSON，原型启动后使用
`/?site=frontend-eles&eles=directions&searchCapture=/@fs/<capture绝对路径>`，
从原左轨搜索按钮打开；本地同源文件回放只存在于原型，不进入发布版本。
对照时取 capture 的实际 viewport，比较内容、顺序、所有轨道和焦点；截图用于
视觉复核。业务通过状态仍以原 Gate 为准，回放不能授权资源或模拟业务通过。

## 6. 回滚策略

- 组件粒度 = 回滚粒度：每个组件的库代码、双宿主切换、测试、登记放在同一组
  提交内（可多个 commit，但作为一个可整体 revert 的序列）。
- 复合包新增是加法，回滚宿主切换即恢复现状；包内未消费代码在下一组件开始前
  不允许累积（组件一未合入，不开组件二）。
- 回滚触发：端口阻塞、视觉评审否决、gate 选择器无法静态保全、specimen 0 console
  error 无法修复。
- 不使用 feature flag 长期并存；双实现并存窗口限定在单个组件的评审周期内。

## 7. 残留与后续推广（试点结束时输出）

- 未晋升复合面清单：ContactsPane/RequestCard、ChatSearchDropdown、
  FindPeople/CreateGroup 弹窗、moments 复合面、settings 复合面、agent 复合面。
- mobile 可行性评估：composite 包无 web-only API（除 DOM 本身），理论可被
  mobile web 复用；native Lynx 不支持能力按 UI-D02 返回 unsupported，本试点
  不动 mobile 代码，结论仅作记录。
- legacy 钩子退役：待 gates/suite 选择器迁移到 `data-ui-*` 后单独立项。
