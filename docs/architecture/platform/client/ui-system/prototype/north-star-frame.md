# 北极星 · 桌面原型窗框语法

> **Status**: draft（候选语法，逐项待确认；未晋升为生产 token）
> **Created**: 2026-10-30
> **Owner**: Client Platform / UI System
> **Entry**: `?site=frontend-eles&eles=directions`（旧 `eles=northstar` 兼容指向同一视图）
> **Source**: `packages/prototypes/shared/ui-system/DesignDirections.tsx` + `design-directions.css`

## Purpose

一扇持续演进的桌面应用窗框原型，未来收敛为 Desktop 原型；窗框里验证过的
模式反向沉淀进 peers-ui 元素集。**全仓只允许这一扇原型窗框**：新增平行
全屏看板/复制窗框等于造第二套体系，已被明确拒绝。皮肤（color/material）
是窗框内的 CSS 变量维度，结构对所有皮肤完全一致；壁纸是第二条独立维度。

**窗框里只放 Peers 真实产品面**：与 Peers Touch 无关或尚未确认要用的业务
拼装（站点卡、发起往来、拓扑、助手等）一律不得预置。组件按「产品边界 →
六维/状态合同 → 实现 → 探针门禁 → 人审 → token/知识沉淀」逐个训练
（首训 SearchField 已被增量 24 的
[`components/global-search-overlay.md`](./components/global-search-overlay.md)
取代：搜索是 ⌘K/搜索钮唤起的浮层，不是页面）。当前窗内上演动态、消息、
设置三个真实面，跨面路由由窗框宿主统一执行。

## Frame Grammar（设计原则）

1. **单一窗框，结构分区固定，信息列弹性。**
   60px 图标轨 / 62px 顶栏为固定 chrome 几何（命中区 38 + 两侧留白反推）；
   中栏 `flex:1` 是组件工作台，随屏宽伸缩。会话/内容轨在相应组件训练落地时
   才进入，不预置空业务列；≤760px 图标轨转顶栏。任何分辨率下 chrome 几何不变。

2. **Chrome 分区靠材质，不靠发丝线。**
   图标轨、顶栏之间**禁止 border 分隔**；层级用半透明表面
   （`--sk-rail-bg` / `--sk-head-bg`）、毛玻璃模糊与投影表达。描边发丝线是
   「后台瓷砖框」观感的来源。内容分组内部的分隔允许保留。

3. **圆角长在产生底色的那一层；身份元素统一方圆（rounded-square）。**
   不允许只给父容器圆角 + `overflow:hidden` 而让实际绘制底色/描边的子元素
   保持直角——一旦裁剪路径变化（脱离父级、独立截图、换容器）方角立刻漏出。
   每个可见填充层必须自带与其角色匹配的 radius。所有**身份元素**（轨标、
   头像等）必须是方圆，禁止全圆：统一消费 `--sk-avatar-radius`，由
   `roundedSquareAll` 断言保证 radius 严格小于短边的一半（非 50% 圆）。
   圆形只允许出现在「在线点/未读角标」这类状态点。

4. **焦点环跟随圆角、即时出现；内嵌原生控件不画方形 outline。**
   圆形容器内的 `<input>` 必须在足够特异性下清零全局
   `:focus-visible` 方框，键盘焦点反馈画在圆角宿主上
   （`.host:focus-within { box-shadow: 0 0 0 2px … }`）。**焦点通道
   （box-shadow/outline）不允许 transition**：延迟出现违反焦点反馈即时性，
   且会让聚焦后即时读取的计算样式停在零扩散/透明（craft C13）。焦点缺陷
   静态截图不可见，只能由聚焦后的计算样式门禁捕获。

5. **自定义按钮必须显式重置 UA 外观。**
   任何自定义 `<button>` 必须消除 `border-style: outset` 与系统灰底
   （`border:0; background:transparent/指定色`），否则残留一块系统按钮方盒。

6. **色彩角色：近黑胶囊承载关键动作/数据，琥珀是唯一强调色。**
   `--sk-primary: #0d100d` 用于主按钮、范围胶囊、选中项、数据胶囊与激活态；
   `--sk-accent: #e8a117` 只用于选中对象、滑杆填充、仪表弧、收藏、在线点。
   黑胶囊不描边、不透底；白卡为半透明白面（glass 皮肤）。

7. **数字仪表盘化：极小灰色标签 vs 超大细体数值。**
   关键数值用 400 字重、26–32px、tabular-nums、负字距；标签 9–10px、
   字距放开、三级灰。卡片内不堆 1px 描边框，用松绿填充砖或白砖 + 柔投影分层。

## Rail anatomy（图标轨入口合同）

对齐真身 `AppSideNav`（60px 轨、38px 命中区、方圆非圆）：

- 顶部组：身份 44/r12 → 搜索（⌘K 浮层触发）→ 消息（聊天面，带未读总数角标）→ 动态（朋友圈面）。
- **消息未读总数角标（增量 37）**：消息钮包一层定位宿主 `.sk-rail-entry`，
  未读总数由聊天面实时上报（`onUnreadTotal`，所有会话 unread 求和），
  在图标右上角渲染红数胶囊 `.sk-rail-badge[data-chat-unread]`（>99 显示 99+，0 不渲染）。
  角标是**跨面实时状态**：人在动态/设置面读不到消息，但计数仍随聊天面常驻状态变化。
  与通知铃共用 `.sk-rail-entry` 角标定位语法。
- 底部组：**通知铃（增量 34 补齐，真身 `NotificationBell` 解剖）→ 设置**。
  铃是 peers-ui `IconButton`（不长裸元素债），复用 `.sk-rail-icon` 几何；
  红点角标只允许红数胶囊（圆形状态点语法的延伸）；点击弹出 **`right-bottom`
  锚定**的 peers-ui `Popover` 面板——面板在铃右侧、**底边与铃共边、向上生长**
  （owner 引导原则，对齐真身 antd `rightBottom`；增量 42 前用 start 对齐 `right`，
  超高时被防溢出翻到钮上方并留缝，像漂走）。面板含未读高亮、**不可点灰色分类 chip**
  （不是 Tag/按钮）、全部已读、单条已读/删除、空态；浮层挂 `.pt-overlay-host`，
  **不落业务面、不切换 railTab**。
- 选择器合同：轨钮一律以稳定钩子寻址，**禁止位置型 `:nth-child` 选择器**——
  角标宿主 `.sk-rail-entry` 包裹会改变按钮在父节点中的位置，增量 37 前 95 处
  `.sk-rail-group:nth-child(2) .sk-rail-icon:nth-child(2|3)` 在包裹后全部失配。
  现合同：消息 `[data-rail-target='chat']`、动态 `[data-rail-target='moments']`、
  设置 `[data-rail-target='settings']`，搜索 `[data-global-search-trigger]`，
  铃 `[data-action-id='nav.notifications']`。轨钮结构计数 = 5。
- ≤760px 轨道转顶栏时铃与设置同行，既有媒体查询自动覆盖。

## Surface lifecycle 与全局快捷键（增量 37）

- **三面常驻挂载**：聊天 / 动态 / 设置三个面同时挂载为 `.sk-feed-pane`，
  仅以 `data-pane-active='true|false'` 切 `display:flex|none`（CSS 唯一真值）。
  非激活面不渲染视觉、不占高，但状态与 effect 存活——这是外轨未读总数角标
  全局实时的前提。早期「按 tab 条件挂载」会在离开聊天面时冻结/丢失计数。
- **快捷键**（窗框宿主统一监听，输入控件内不触发：`INPUT/TEXTAREA/SELECT` 或
  `contenteditable`，且忽略输入法合成 `keyCode 229`）：
  - `⌘/Ctrl+,` → 打开设置面；
  - `⌘/Ctrl+N` → 切到消息面并唤起找人弹窗（经 `newChatSignal` 非相传入聊天面）。

## Gate（机器门禁）

原则 3/4/5 与结构完整性由确定性套件守护，人工只判签名与品味：

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json
```

- craft battery C9 `embedded-control-square-focus`
- craft battery C10 `chrome-zone-hairline`
- craft battery C11 `ua-button-chrome`
- 结构计数（单窗框、3 统计/3 对象/3 设置/3 动态/3 会话）、范围切换、
  对象选择、滑杆联动（填充 + 气泡 + 0–7 刻度）、聚焦态计算样式

## Evolution Loop

每个被用户指出的工艺缺陷必须走完闭环，禁止停留在实例修复：

1. 修当前实例（CSS/结构）；
2. 抽象为可观察规则，进 craft battery / suite；
3. 记入 `docs/knowledge/pitfalls/`，owns 指向源码与门禁；
4. 本文件的 Grammar 在规则变化时更新。

## Boundaries

候选数值不写入 active token，不被生产页面消费；Manrope 为候选字体；
外部表达参考保持脱敏，仓内不保存其名称、链接、图像或业务对象。
真实读屏、触摸设备、性能分布、生产消费与用户对签名的最终判定均为 UNPROVEN。
