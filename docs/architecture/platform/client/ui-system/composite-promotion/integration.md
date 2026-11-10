# Composite Promotion Pilot — Integration

> **Status**: draft · **Owner**: Client Platform / UI System
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
- `SearchHost.tsx`（lazy 挂载、⌘K）不改。
- `functions.ts`、`SearchResultMeta.tsx`、coverage Popover 留宿主，经插槽接入。
- `SearchOverlay.css` 中与复合件重复的规则删除；保留宿主专属（Popover 等）。

阻断判据：若 progressive frame 的 `isProgressive/pendingSources/stalled`
无法用 model 字段表达而必须把 store 传入组件，按 design §8.1 停为阻塞。

### 2.2 IdentityProfileCard（组件二）

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

### 2.3 ConversationRail（组件三）

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
| `searchOverlayAlignment.test.ts`（源码字符串） | 删除字符串断言；复合包内 `GlobalSearchSurface.test.tsx` 覆盖 roving/IME/Esc/分组/空态/双 hooks；Desktop 新接线测试断言 hooks 常量与 intents 映射 |
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

## 4. 门禁与登记联动（每组件交付时勾选）

- [ ] `registry.ts`：对应 GAP 转 implemented；双宿主切换完成后转 vetted 并登记 consumedBy。
- [ ] `catalogue.ts`：新增复合能力 id（建议 `ui.comp.search-surface`、
      `ui.comp.identity-profile-card`、`ui.comp.conversation-rail`）与槽位 anatomy。
- [ ] `prototype-import-baseline.json`：私写件删除后重算，只减不增。
- [ ] `primitive-layer-guard.mjs`：扩展或新增 composite 守卫，禁 app 层 `.ptc-*`。
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

Native acceptance gate 不在试点内执行，但通过 data-model.md 选择器清单做
静态断裂检查（grep 全部门禁选择器在新 DOM 中仍可命中）。

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
