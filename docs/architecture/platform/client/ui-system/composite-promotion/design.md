# Composite Promotion Pilot — Design

> **Status**: 搜索实施合同；P2/P3 为候选 · **Owner**: Client Platform / UI System
> 证据分类遵循架构设计方法论：`verified_fact` / `inference` / `hypothesis` / `proposal` / `accepted_decision`。

## 当前搜索实现

本轮按 [已确认验收合同](./acceptance-contract.md)执行。完整浮层的 DOM、布局、
状态呈现、键盘、输入法、复制手势、焦点及进出相位只在
`packages/ui/composite/src/search/GlobalSearchSurface.tsx` 与 `search.css` 实现。
原型 `GlobalSearchOverlay` 装配 seed/场景，Desktop `SearchOverlay` 装配
`searchPresentation` 和 `searchActions`；两边不保留竞争外壳。

面板沿确认原型宽 660px、圆角 18px、距顶 12vh、入场 200ms。
为保持已接受的 Desktop 连续性，面板高度为 viewport 内固定的 600px 上限，
coverage 保留 44px、动作行 36px，入场只变 opacity；窗口隐藏时结束相位，
减少动态效果时不播放动画。宽窄屏和主题是对照条件，父组件只提供角色 token。

选中项使用稳定 `rowKey`。Desktop 从原 store 提供 `selectedKey/scrollTop`，
组件上报变化；仅显式方向键滚动到行。当前 draft 与展示 query/filter 的匹配
由宿主提供，改变输入后 Enter 仍提交新查询；打开目标前声明焦点交接。
快捷项与显示项进入同一动作查找表，避免显示可点却查不到目标。

原型场景使用共享的可序列化样本；原生 Gate 记录实际展示的同一数据形状，
原型实际入口可回放这些数据及主题。回放只负责呈现对照，真实业务与资源权限
仍由原生 Journey 证明。没有源码或测试导入替代 `UI-AC01/02/03`。

## 1. 问题陈述（原试点调研记录）

### 1.1 原语已同源，复合层仍双写

- `packages/ui`（contracts/tokens/assets/semantics/web/desktop）是唯一公共 UI
  入口，`@peers-touch/ui` 被 Desktop 与原型共同消费；Desktop 内有 84+ 个
  `@peers-touch/ui` 引用点（verified_fact，仓库全局检索）。
- 复合组件仍是两份独立实现，靠 docs 规格 + `*Alignment.test.ts` 源码字符串
  断言维持一致：

| 复合面 | 原型实现（行数） | 生产实现（行数） | 对齐测试 |
|---|---|---|---|
| 全局搜索浮层 | `prototypes/shared/ui-system/search/GlobalSearchOverlay.tsx`（388） | `apps/desktop/src/components/search/SearchOverlay.tsx`（427） | `searchOverlayAlignment.test.ts` |
| 身份资料卡 | `prototypes/shared/ui-system/identity/IdentityCard.tsx`（150） | `apps/desktop/src/components/profile/PublicProfileCard.tsx`（377） | `profileCardAlignment.test.ts` |
| 会话轨/行 | `prototypes/shared/ui-system/chat/ChatRail.tsx`（602）+ `ChatFeature.tsx`（477，rail 装配段） | `apps/desktop/src/components/chat/ChatSessionList.tsx`（862） | `chatRailAlignment.test.ts`、`chatContactsAlignment.test.ts` |

- 漂移已经实际发生：搜索框焦点态曾偏离
  `prototype/components/global-search-overlay.md` §6（双层 outline 事故，
  verified_fact，见近期修复记录）；字符串断言无法阻止行为漂移，只能在源码
  文本碰巧包含固定字符串时通过。

### 1.2 原型 specimen 不能被生产直接 import 的四个根因（verified_fact）

1. 直接 import 种子数据：`GlobalSearchOverlay` import
   `chat-data` 的 `CONVERSATIONS/PEOPLE/SEED_MESSAGES` 与
   `moments-data` 的 `MOMENT_SEEDS`；`ChatFeature` 持有全部 seed 状态。
2. 运行在 DesignDirections 标本框架内，`useT()/usePrefs()` 来自原型私有
   `prefs.ts`（localStorage 词典），生产使用 react-i18next +
   `packages/locales`。
3. 类名与数据钩子命名空间不同：原型 `sk-*` / `data-search-*` /
   `data-author-*` / `data-pinned` 等；生产 `pt-search-*` / `pp-*` /
   `sc-*` / `data-chat-*` 等。
4. 没有稳定的产品级 props 契约；生产侧还耦合 Desktop 专属模块
   （`UserSquareAvatar` 原生头像缓存、`FederatedHandle`、`feedback` 通道、
   `OverlayCommitProfiler`、zustand store、`searchActions`、proto 类型）。

### 1.3 治理面已有伏笔（verified_fact）

- `registry.ts` 已把 `CommandSurface`、`ConversationRow` 登记为
  `composition` 类 GAP，明确「逐增量回迁，回迁时删除原型私有实现」。
- 父模块 UI-D06（proposed）已定义 Composite 拥有具名槽位与 plane 归属。
- `docs/knowledge/playbooks/ui-primitive-promotion.md` 规定晋升五件套
  （grammar、token/组件、catalogue、craft 断言、knowledge）。
- `invariants/app-layer-must-not-restyle-primitives.md` 禁止 app 层重绘
  `.pt-*`；皮肤差异只能经 CSS 自定义属性注入。
- 原型 `DesignDirections.tsx` 已用 `UIProvider style={PT_BRIDGE}` 把
  `--pt-*` 桥接到 `--sk-*`，复合件消费 pt token 即可自动获得 pine-glass 皮肤。

## 2. 证据台账（选录）

| Claim | Class | Evidence | Confidence |
|---|---|---|---|
| 生产 SearchOverlay 行为是原型超集（progressive frames、zone/coverage、filter tabs、roving focus、IME 让渡、Cmd+C 复制、error/retry/hasMore） | verified_fact | `SearchOverlay.tsx` L30-416；`runtimes/searchFrames.ts` 被引用 | 高 |
| 原生 gates 依赖生产侧选择器（pt-search-row ×28、pt-search-field ×19、data-chat-conversation-pane ×40、data-chat-profile-* 等） | verified_fact | `grep tooling/acceptance/gates` 计数 | 高 |
| 原型 north-star.suite 依赖 sk-* 与 data-search-* / data-pinned / data-muted 等 | verified_fact | `tooling/scripts/ui-system/suites/north-star.suite.json` 场景 oracle | 高 |
| 原型与生产搜索浮层视觉参数不一致（面板 660px/r18/200ms vs 720px/r12/160ms；scrim 6px blur vs 无模糊） | verified_fact | `global-search.css`、`SearchOverlay.css` 头部规则；规格 §3 写的是 660/r18/200 | 高 |
| `@peers-touch/ui` 包内无测试框架；仓库已有 vitest@4 + jsdom@26 | verified_fact | `packages/ui/web/package.json`、根 `node_modules/.pnpm` | 高 |
| 仓库无 @testing-library；Desktop 测试均为源码字符串断言，无 render 测试 | verified_fact | 全仓检索 | 高 |
| 复合层独立成包可在依赖图上机械阻断 app/store import | inference | pnpm workspace 隔离 + tsc 模块解析 | 中高 |
| 双宿主类名可经 className/hook 注入适配而无需改 gate | inference | 两侧钩子均为组件根/行节点属性，无伪类依赖（nth-child 仅原型 suite 内部使用） | 中高 |
| 三组件端口可在不泄漏 runtime 的前提下表达生产全部行为 | hypothesis | 未完成端口试写；Search 的 progressive 帧模型是最大风险点 | 中 |

末行假设在组件一实现时验证；若端口必须引入 runtime 概念才能闭合，按任务
§5 停为阻塞并回本模块记录，不允许顺手改 store/runtime。

## 3. 范围与非范围

### 3.1 In scope

- 新复合层 `packages/ui/composite`（包名 `@peers-touch/ui-composite`）及其
  依赖边界、导出边界、样式与 i18n 合同。
- 本轮完整搜索的端口、双宿主适配、同样本呈现对照与原生真实 Journey。
  身份卡和会话轨的以下设计保留为候选，不计本轮完成。
- 对齐测试从字符串断言改为复合包内 render 行为/契约测试 + 宿主接线测试。
- `registry.ts`、`catalogue.ts`、import-guard baseline、架构模块登记、
  north-star specimen 场景的联动更新。

### 3.2 Non-goals

- 全局窗框、聊天布局及 Mobile 的响应式改造；搜索自身的现有宽窄条件必须验证。
- 视觉重设计；视觉以北星规格文档为唯一基准，差异只做收敛不做创新。
- agent/moments 复合面、mobile app 代码（仅评估未来可行性）。
- store/runtime/search-core/proto 的任何改造。
- 联系人轨 `ChatContactsPanel`/`ContactsPane`、`ChatSearchDropdown`、
  `CreateGroupModal`/`FindPeopleModal`：留在宿主，经插槽接入。
- 删除或跳过原生断言、另建模拟生产页面；可在原 Gate 补采集和正确资源声明。

## 4. 目标架构

### 4.1 分层与依赖方向（Reuse Topology）

```text
Prototype host (DesignDirections / ChatFeature …)
      │  装配 seed → view model；注入 makeTranslate 版 t；注入 sk 类名/钩子
      ▼
@peers-touch/ui-composite （新增；纯展示 + 内部 UI 状态；只认端口）
      │  import
      ▼
@peers-touch/ui (web 原语) ── ui-tokens / ui-assets / ui-contracts / ui-semantics
      ▲
      │  装配 store projection → view model；注入 i18next t；注入 pt/sc/pp 类名/钩子
Desktop host (SearchHost / SocialChatPage / UserProfilePopover …)
```

复合层对宿主零依赖、对原语层单向依赖。完整拓扑见
[../composite-promotion-reuse-topology.svg](../composite-promotion-reuse-topology.svg)。

### 4.2 运行单元与边界

- **复合组件（新增运行单元）**：React 纯函数组件集合；生命周期仅限 React
  渲染与局部 UI 状态；无 effect 发起的 I/O；无定时器驱动的业务动作
  （入场相位等纯 UI 计时允许）。
- **原型宿主适配层**：把 `chat-data/moments-data` seed、`prefs.ts` 词典、
  本地 setState 仿真（发送/重试/typing）适配为端口；seed 留在原型。
- **生产宿主适配层**：把 zustand 投影、`searchActions`、native avatar、
  feedback、navigation 适配为端口；store/runtime 一行不改。

### 4.3 允许与禁止关系

允许：

- composite → `@peers-touch/ui`、`@peers-touch/ui-tokens`（经 ui 间接）、react。
- 宿主 → composite；宿主向 composite 注入 className/data 属性/插槽/回调/t。

禁止（用包依赖 + lint 规则机械阻断）：

- composite → 任何 `apps/*`、`packages/prototypes/*`、seed、zustand、
  `desktop_api`、Tauri API、fetch/WebSocket。
- composite → antd、@lobehub、react-i18next、lucide-react（图标一律走 ui
  `Icon`/`IconButton` 的 `iconId`）。
- 复合包内内置自然语言词典，或在 app 层重新定义 `.pt-*`/`.ptc-*` 呈现。
  角色颜色使用 pt token；确认原型的遮罩与动效值保留在唯一共享 CSS。
- 共享 UI 反向 import 原型（父模块 module-layout 既有禁令）。

## 5. 端口契约总览（完整定义见 data-model.md）

每个复合组件统一四类端口：

1. **View model props**：只读、序列化友好的数据袋（rows/profiles/sessions/
   coverage/error 等），字段名表达产品语义，不带 proto 类实例。
2. **Intent callbacks**：`onOpen/onClose/onAction/onCopy/onSelect…`，组件只
   发意图，不决定路由、不执行副作用。
3. **Render slots**：宿主专属渲染能力（native avatar、actions 节点、
   contacts 面板、popover 外壳）以 `ReactNode`/render-prop 注入。
4. **Surface hooks**：`classNames`（按区域）+ `dataAttributes`（按区域）类型化
   映射，保证两侧既有 gate 选择器原样存活；另发复合件规范类名 `ptc-*` 与
   规范数据钩子 `data-ui-*` 作为未来单一契约。

i18n 端口：`type CompositeTranslate = (key: string, options?: Record<string, unknown>) => string;`
包内不持有词典；Desktop 传 i18next 绑定函数，原型传 `makeTranslate` 适配。

## 6. 视觉对账与收敛原则

- 单一样式真源随组件迁入复合包，选择器统一 `ptc-*`，值只引用 `--pt-*`；
  原型经既有 PT_BRIDGE 自动获得 pine-glass，生产经默认主题获得冷墨/松绿。
- 搜索以本文件“当前搜索实现”和原型合同为准；旧的 720/r12/160ms 延后方案
  已由完整原型接入要求替代。固定轨道与 opacity-only 来自既有 Desktop 连续性
  合同，不把内容量变化或后台动画悬停带进生产。
- 其余两个组件以生产 PR#182 北星对齐后的几何为基线（对齐测试已锁定像素），
  迁移只搬样式不改值；如发现原型规格与生产像素冲突，逐项登记评审。

## 7. 质量门禁（falsifiable）

| 门禁 | 命令/载体 | 通过标准 |
|---|---|---|
| 复合包类型检查 | `pnpm --filter @peers-touch/ui-composite run check` | 0 error |
| 复合包行为测试 | `pnpm --filter @peers-touch/ui-composite run test`（vitest+jsdom） | 全绿；断言 DOM 钩子、键盘、回调、插槽，不读源码字符串 |
| 原型标本 | `evaluate-specimens.mjs --suite north-star.suite.json`（含 boards） | rollup OBSERVED、0 console error、既有场景全保留 |
| Desktop 源检查 | `cd apps/desktop && pnpm run check` | locales/social-wire/runtime-boundaries/tsc 全过 |
| Desktop 单测 | `cd apps/desktop && pnpm run test` | 改造后的宿主接线测试全绿，数量不得低于现有断言覆盖面 |
| Desktop 构建 | `cd apps/desktop && pnpm run build` | 成功 |
| 原型/库构建 | `pnpm --filter @peers-touch/prototype-ui-system run check`、ui 全链 check | 成功 |
| 原语边界 | `node tooling/scripts/review/primitive-layer-guard.mjs` | 无 NEW；composite 包内零 app 类选择器 |
| 原型私写债 | `node tooling/scripts/ui-system/prototype-import-guard.mjs` | baseline 只减不增 |
| Native Journey | 原 `chat-device-search-native-e2e` | 当前源码真实分页、中文/附件搜索、打开/返回、失效与恢复、账号隔离；原断言全部保留 |

## 8. 风险与失败语义

1. **端口表达力不足（最高风险，hypothesis）**：生产搜索的 progressive/coverage
   语义若无法用纯 view model 表达，组件一停写，回滚为现状双写，在本文件
   追加阻塞记录，禁止把 searchRuntime 概念泄漏进复合包。
2. **双 hook 维护期分叉**：`ptc-*`/`data-ui-*` 与 legacy 钩子并存期间，靠
   复合包单一渲染出口保证同生共死；legacy 钩子的退役另立后续计划，不在试点。
3. **视觉回归**：样式搬迁可能出现 token 桥接缺口；以 north-star suite 的
   computedStyle oracle 与 Desktop 对齐测试像素值双重拦截。
4. **并行工作流冲突**：窄屏工作流可能改 `SocialChatPage.tsx`/chat CSS/
   `tauri.conf.json`；本任务默认不碰这些文件，组件三的宿主接线若必须改
   `SocialChatPage`，仅做 import 替换级最小改动并在提交说明登记原因。
5. **i18n 缺口**：`IdentityCard` 现存硬编码中文（verified_fact），晋升必须
   先在 `packages/locales` 与原型 `prefs.ts` 补 key，过 `check:locales`。
