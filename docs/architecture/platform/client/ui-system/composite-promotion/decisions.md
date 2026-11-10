# Composite Promotion Pilot — Decisions

> **Status**: draft（CMP-D01…D08 均为 proposal，评审通过后转 accepted_decision）
> 父模块已接受决策 UI-D01…D04 继续生效；本文件不重复定义，只引用。

## CMP-D01: 复合层独立成包 `packages/ui/composite`

**Context**：registry 已登记 CommandSurface/ConversationRow 复合缺口；父模块
module-layout 现状写明「新 Pattern 留在原业务 Owner」「不为每个控件新增一个包」。
复合件既不是原语（持有产品级槽位结构与内部 UI 状态），也不是业务 Pattern
（不含业务真源与副作用），需要独立的归属与可机械执行的依赖边界。

**Decision**：新增 workspace 包 `packages/ui/composite`，包名
`@peers-touch/ui-composite`，与 `packages/ui/web`（`@peers-touch/ui` 原语层）
平级。依赖白名单：`@peers-touch/ui`、react/react-dom（peerDependencies）、
vitest/jsdom（devDependencies）。禁止任何其他运行时依赖。

**Rationale**：包边界是唯一能在 tsc/pnpm 层面阻断「复合件偷 import store/seed」
的机制；放进 web 包会让原语入口混入业务组合体，削弱 UI-D01 的公共入口语义。

**Alternatives**：
- 在 `packages/ui/web/src` 下开 `composites/` 目录：无依赖隔离，原语包体积与
  职责膨胀，拒绝。
- 继续留在各宿主：维持双写漂移现状，拒绝。
- 为每个复合件单独建包：过度切分，违背「不按 DOM 深度一层一包」，拒绝。

**Consequences**：新增一个 check/test/build 单元；pnpm workspace 与模块登记需
同步；正面是复合件合同可独立验证、独立评审。
**Reversal trigger**：试点结束后若三个组件均无法在端口闭合，包保留为空壳
或整体删除，不产生半截消费者。

## CMP-D02: 纯展示 + 端口契约，内部状态仅限 UI 瞬时态

**Context**：UI-D03 已接受业务与资源真源保留在既有 Owner；生产
`SearchOverlay`/`ChatSessionList` 当前把 store 投影、action 调用与渲染混在
单文件；原型 specimen 直接 import seed。

**Decision**：复合组件只允许持有：roving focus 光标、弹层开合与进出相位、
折叠展开、受控输入草稿等**不跨会话存活的 UI 瞬时态**。所有实体数据经 view
model props 进入；所有副作用经 intent callbacks 外发；组件不 import seed、
zustand、`desktop_api`、proto 运行时类、任何 fetch/IPC。

**Rationale**：同源的前提是同一份代码对两个宿主都成立；只要组件内残留一个
业务真源引用，另一宿主就无法消费。

**Alternatives**：在复合包内定义 repository 接口由宿主实现（Hexagonal Port）：
对当前三个组件属于过度设计，props+callbacks 已闭合；若后续出现跨组件共享的
数据获取需求再升级，拒绝提前抽象。

**Consequences**：宿主适配层代码量增加（装配职责显式化）；副作用可测试性提升。
**Reversal trigger**：某组件证明需要组件内数据获取才能满足产品交互（如
combobox 远程搜索内聚），回到评审新增 port 类型，不得静默引入。

## CMP-D03: 双宿主 DOM 契约经类型化 surface hooks 保全

**Context**：native gates 锁定 `pt-search-*`、`data-chat-conversation-pane`
（40 处引用）、`data-chat-profile-*`、`data-chat-session-*` 等；north-star
suite 锁定 `sk-*`、`data-search-open`、`data-global-search`、`data-pinned`
等。任务明确禁止改 gate 变绿。

**Decision**：复合组件渲染规范类名 `ptc-*` 与规范钩子 `data-ui-*`，同时接收
两类宿主注入：

```ts
interface SurfaceHooks {
  classNames?: Partial<Record<RegionKey, string>>;
  dataAttributes?: Partial<Record<RegionKey, Record<string, string | boolean | undefined>>>;
}
```

宿主在适配层把 legacy 类名/数据属性映射到对应区域节点。data-model.md 附全量
选择器清单与区域映射，作为不可破坏的合同附件。

**Rationale**：gate 选择器是当前唯一的机器证据，先保全再演进；规范钩子给
未来 gate/suite 收敛提供单一目标。

**Alternatives**：在复合组件内硬编码双份类名：把宿主命名空间污染进共享包，
永久化双真源，拒绝。直接重写 gate 选择器：违反任务约束且 native gate 无法
在试点环境复验，拒绝。

**Consequences**：并存期每个节点带两套标识；宿主适配层成为 legacy 钩子的
唯一登记处。退役条件：gate 与 suite 全部迁移到 `data-ui-*` 后删除注入映射。

## CMP-D04: 样式单一真源随组件迁入，只消费 pt token

**Context**：原型用 `--sk-*` 私有变量 + `sk-*` 类，生产用 `--pt-*` +
`pt-/pp-/sc-*` 类；invariant 禁止 app 层重绘 `.pt-*`；原型已有
PT_BRIDGE 把 pt token 桥接到 sk 变量。

**Decision**：复合包自带 `ptc-*.css`，全部值引用 `--pt-*`（含暗色变量，
暗色模式自动成立），禁止十六进制色值与 app 层覆盖。原型宿主经 UIProvider
PT_BRIDGE 换肤；生产宿主用默认主题。搬迁以「不改已接受像素」为默认原则；
已核实的搜索浮层规格冲突（660/r18/200ms vs 720/r12/160ms）按北星规格收敛，
但作为评审门显式确认项，未确认不合并组件一。

**Rationale**：样式与组件同源才能消除漂移；token 桥接是项目已接受的换肤机制。

**Alternatives**：两侧各留 CSS、组件只给结构：样式漂移根因不除，拒绝。
在包内同时维护 sk/pt 两套样式：双真源，拒绝。

**Consequences**：生产搜索浮层可能出现一次规格级像素微调（需用户确认）；
原型侧删除对应 sk CSS 后 import-guard baseline 与 craft 断言需同步更新。

**Resolution（2026-11-10 试点实现期，P1-7 评审门落档）**：组件一落地采用
**保持生产现规格**方案——复合包 `search.css` 的 panel 宽 720px、圆角 12px、
入场 160ms 与生产 `SearchOverlay.css` 逐值对齐，保证生产侧零像素回归。
北星规格（660px / r18 / 200ms）属本计划 §nonGoals 明确排除的「视觉重设计与
新像素创新」，**不在试点内收敛**，登记为后续独立视觉决策项，需用户显式
签署后另开变更。状态：**resolved-deferred（延后决议）**，验收门以「生产
DOM 视觉与改造前一致」为通过口径，而非北星 660 规格。

## CMP-D05: i18n 注入 `CompositeTranslate`，包内无词典

**Context**：生产用 react-i18next + `packages/locales`，`check:locales`
强制 key 完备与 en/zh-CN 对等；原型用 `prefs.ts` 本地词典；`IdentityCard`
现存硬编码中文，违反 Iron Law。

**Decision**：复合包定义
`type CompositeTranslate = (key: string, options?: Record<string, unknown>) => string;`
每个复合组件必填 `t`。包内不依赖 react-i18next、不内置词典。Desktop 适配层
传绑定 namespace 的 i18next t，新 key 进 `packages/locales/{en,zh-CN}`；
原型适配层传 `makeTranslate` 包装，新 key 进 `prefs.ts` STRINGS。

**Rationale**：i18n 机制属于宿主基础设施；包只消费翻译函数这一最小端口。

**Alternatives**：包内依赖 react-i18next：把宿主框架选择强加给原型与未来
mobile/lynx 消费者，拒绝。

**Consequences**：IdentityCard 晋升需先补一批 locale key（原型与生产各一套
命名空间，允许同名不同前缀）。

## CMP-D06: 宿主专属能力一律走渲染插槽

**Context**：`UserSquareAvatar` 依赖 native 头像缓存与 actorPtid 解析；
feedback 通道（notifySuccess/notifyError）是 Desktop 内核；
`OverlayCommitProfiler` 是 Desktop 性能埋点；`FederatedHandle` 是纯展示
但物理位置在 app 层。

**Decision**：

- 头像：`avatarSlot: ReactNode` 注入，复合件不解析任何 ptid/图片缓存。
- 动作区：`actionsSlot: ReactNode` 注入（关系逻辑留 `ProfilePrimaryAction`
  等宿主 owner），复合件只负责布局容器。
- 复制反馈：复合件只发 `onCopy(value): void`，toast/失败提示由宿主决定。
- Handle：`@user@host` 是纯字符串拼接，复合件按 props（localPart/home）
  内部渲染，不 import Desktop 组件。
- Profiler/埋点：留在宿主包裹层，不进包。
- 联系人面板/搜索下拉/弹窗：`contactsSlot`、`extraSlot` 等区域插槽。

**Rationale**：插槽把「平台能力」与「产品布局」分离，符合 UI-D03 与
invariant 的真源保留原则。

**Alternatives**：把 UserSquareAvatar 也晋升进 ui：它绑定 native 缓存生命周期，
不属于跨端纯展示，拒绝（后续可单独评估其纯展示内核的剥离）。

## CMP-D07: 复合包内置 vitest + jsdom 行为测试，对齐测试改为接线测试

**Context**：仓库无 @testing-library；已有 vitest@4 与 jsdom@26；现有
`*Alignment.test.ts` 全部是 `readFileSync` + 字符串包含断言，无法验证行为。

**Decision**：`packages/ui/composite` 加 vitest@4 + jsdom@26 devDependencies
（仓库已锁定版本，不引入新依赖族），用 `react-dom/client` + `act` 直接挂载，
断言：渲染后的 DOM 钩子/ARIA、键盘 roving、IME 让渡、回调触发、插槽渲染、
双 hook 映射。Desktop 侧 alignment 测试收缩为「宿主把正确 hooks/t/插槽
传给复合件」的接线测试，不再断言组件源码字符串。

**Rationale**：行为测试跟随组件同源，才能在任一侧消费变更时拦截回归；
不引 @testing-library 避免新依赖族，先用官方 react-dom 原语。

**Alternatives**：引入 @testing-library/react：生态标准但仓库零存量，试点期
拒绝；若原语写法明显损害可维护性，再单独提依赖评审。

**Consequences**：复合包新增测试维护面；Desktop 测试数量可能减少但断言深度
增加，覆盖清单在 integration.md 登记。

## CMP-D08: 晋升与 registry/guard/模块登记联动，人审保留唯一晋升权

**Context**：自训练方法论规定「人审是唯一晋升权」，registry 三态
（vetted/implemented/gap）与 import-guard baseline 是现有机器门禁。

**Decision**：每个组件晋升时同步完成：
1. `registry.ts` 对应 GAP（CommandSurface/ConversationRow 等）转 implemented
   并在原型真实消费后转 vetted；
2. `packages/ui/contracts/src/catalogue.ts` 登记复合能力与槽位；
3. `prototype-import-baseline.json` 只减不增，私写件删除如实反映；
4. `architecture-modules.json` 增加本模块正向投影；
5. north-star suite 场景保留，必要时仅把实现引用路径更新到复合包。

**Rationale**：晋升不是搬代码，是所有权转移；登记不联动等于制造无主代码。

**Alternatives**：代码先搬、登记后补：历史上已造成 registry 与实际脱节，拒绝。

**Consequences**：每个组件的提交必须同时含库、双宿主、测试、登记四类改动，
评审面变大但可按组件独立回滚。
