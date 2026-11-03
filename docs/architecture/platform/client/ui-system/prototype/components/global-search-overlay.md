# GlobalSearchOverlay · 全局搜索浮层（增量 24）

> **Status**: draft（北极星窗框内训练中，未晋升 peers-ui）
> **Created**: 2026-11-01
> **Owner**: Client Platform / UI System
> **Specimen**: `packages/prototypes/shared/ui-system/search/GlobalSearchOverlay.tsx` · `search/global-search.css`
> **Host**: `packages/prototypes/shared/ui-system/DesignDirections.tsx`
> **Parity source**: `packages/prototypes/desktop/shell/src/search/SearchOverlay.tsx`（⌘K 唤起、永不独立成页、封闭域）
> **Gate**: `tooling/scripts/ui-system/suites/north-star.suite.json`（`global-search-*` 场景）

## 1. 产品用途与边界（先于视觉）

- **用于**：从左轨搜索钮或 `⌘K / ⌘F / Ctrl+K` 唤起的**顶置命令浮层**；在 Peers
  封闭域内搜索邻居、会话、消息、动态与设置功能，选中结果**路由回对象所在面**。
- **不用于**：公网搜索、本机文件、外部连接器、任何业务写请求；它不是页面，
  窗框内不存在「搜索 tab」（旧 SearchField 训练台随增量 24 移除）。
- **封闭域契约**：footer 常驻「封闭域 · 仅搜索 Peers 网络内容」；结果只来自
  真实原型 seed（`PEOPLE` / `CONVERSATIONS` / `SEED_MESSAGES` / `MOMENT_SEEDS`
  / 21 项真实设置 IA），无第三方来源行。
- **空查询契约**：展示「最近」（4 条固定 seed）与「功能直达」（新会话/新动态
  + 2 个设置功能），不渲染任何 `data-search-result` 行。

## 2. 路由契约（opener owns routing）

浮层只产出 `GlobalSearchTarget`，由宿主 `DesignDirections` 执行路由并关闭浮层：

| target | 宿主动作 |
|---|---|
| `conversation {conversationId, messageId?}` | 切消息轨，下发 `ChatNavigationRequest`（nonce 去重）打开会话；messageId 当前只定位会话，消息滚动定位 UNPROVEN |
| `person {personId}` | 切消息轨，复用 ChatFeature 的 openPerson（已有会话直接开，否则新建） |
| `moment {momentId}` | 切动态轨（动态详情路由 UNPROVEN，先落 feed） |
| `settings {group, section}` | 切设置轨，下发 `SettingsNavigationRequest` 直达分区 |
| `action new-chat / new-moment` | 切消息轨 / 动态轨 |

## 3. 六维定义

| 维度 | 定义 |
|---|---|
| 文字 | 输入 15.5px `--sk-text`；组标题 10.5px/0.09em 大写字距三级文字；行标题 13.5px/550，副行 11.5px 三级文字；footer 11px |
| 几何 | 面板宽 `min(660px,100%)`，顶置（距顶 12vh），圆角 18，max-height 600；行内边距 8/10、圆角 11；图标砖 28×28 圆角 9；空态 4+4 行不滚动 |
| 色彩 | 面板 `--sk-overlay` + 发丝边 `--sk-card-border`；scrim 墨绿 30% + 6px 模糊；hover/键盘 wash 为 `--sk-primary` 8%；命中高亮 `--sk-accent` 32%；无紫、无卡片阴影堆叠 |
| 图标 | 前导 Search 17；行图标按类型（人 Users/会话 Hash/消息 MessageCircle/动态 Sparkles/功能用该设置分区的真实图标，扳手仅回退）；最近行统一 Clock3 |
| 表面 | 单一面板三层：输入行 / 结果体（发丝分组）/ footer（发丝封顶）；组间仅发丝，无卡片套卡片 |
| 布局 | `fixed` 全屏 flex 居中顶对齐；结果体独立滚动，footer 常驻；≤560px 边距 10、隐藏右侧 tag |

## 4. 状态与交互合同

| 状态/交互 | 表现 | 可观察断言 |
|---|---|---|
| 唤起（钮/⌘K） | 140ms 上浮入场；30ms 后输入框聚焦；触发器 `aria-expanded=true` | `[data-search-open]` 存在；`[data-global-search]:focus` |
| 空查询 | 最近 + 功能直达两组；零结果行 | `[data-search-group='recent'/'quick']`；无 `[data-search-result]` |
| 查询 | 五分组（人/会话/消息/动态/功能，空组不渲染）+ 组计数；标题/副行命中高亮 | `[data-search-group=…]`、`.sk-search-hit` 计数 |
| 键盘 | ↑↓ 跨行（鼠标移入同步光标）、Enter 开当前光标、Esc 关；IME 合成中（keyCode 229）全让渡 | 中文输入不触发 Enter/Esc |
| 无命中 | 空态（查询词回显 + 封闭域说明），零结果行 | `[data-search-empty]`、结果行 = 0 |
| 关闭 | Esc / scrim / × / 选中后关闭；焦点还触发器 | 面板消失；触发器 `aria-expanded=false` |

全局快捷键监听挂 `window`，仅响应带 Meta/Ctrl 的 `k/f`；IME 守卫与浮层内一致。

## 5. DOM 契约（探针依赖）

```
.sk-search-overlay[role=dialog][aria-modal]          fixed 根（在 .sk-shell 外，断言需 scope:global）
.sk-search-scrim
.sk-search-panel[data-search-open]
  .sk-search-input-row > .sk-search-leading
  input.sk-search-input[data-global-search][role=combobox][aria-controls=sk-search-results]
  kbd.sk-search-kbd / button.sk-search-close[aria-label]
  .sk-search-body#sk-search-results[role=listbox]
    .sk-search-group[data-search-group=recent|quick|person|conversation|message|moment|function]
      .sk-search-group-title（含 <em> 计数）
      button.sk-search-row[data-search-result=<kind>]#sk-search-opt-N[role=option][aria-selected]
        .sk-search-row-icon / .sk-search-row-main(title,meta) / .sk-search-row-tag / .sk-search-row-open
    .sk-search-empty[data-search-empty] > strong/p/.sk-search-boundary-inline
  .sk-search-footer > .sk-search-boundary + .sk-search-keys
触发器：button.sk-rail-icon[data-global-search-trigger][aria-haspopup=dialog][aria-expanded]
```

## 6. 皮肤扩展性

只消费角色变量（`--sk-overlay` / `--sk-card-border` / `--sk-primary` /
`--sk-accent` / `--sk-text*` / `--sk-tile`），三套皮肤改值不改规则；
松绿皮肤中 `--sk-primary` 即近黑墨，wash 是墨色 8%，禁止引入紫色/品牌蓝。
焦点表达在输入行底发丝变色，内嵌 input 的全局方形 `:focus-visible` outline
由 `.sk-theme .sk-search-input:focus-visible { outline:none }` 抑制（同 SearchField 教训）。

## 7. 门禁（机器）

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json
```

7 个 `global-search-*` 场景：钮唤起/⌘K 唤起/书架多分组/Enter 进会话/点消息进群/
通知跳设置/无命中空态；外加 frame 场景断言初始无浮层、默认落动态流。
1360/390 双宽溢出、craft battery（root=body，浮层在 shell 外）、0 console error。
签名与品味仍由人审，作者不自判通过。

## 8. 边界与 UNPROVEN

- 选中消息后的**消息级滚动定位/高亮**、动态详情路由、新会话/新动态的 composer 预聚焦；
- 搜索历史真实持久化（当前「最近」为固定 seed）、索引分词/拼音/容错（当前为小写 includes）；
- 读屏实测、触摸键盘、⌘F 与浏览器查找冲突的产品取舍、真实 Station 数据源；
- 晋升 peers-ui 后的 API 合同（受控 open、结果渲染插槽、快捷键可配置）。
