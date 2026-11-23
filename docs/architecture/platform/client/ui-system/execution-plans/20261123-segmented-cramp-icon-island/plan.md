---
status: implemented-pending-native-verification
owner: Client Platform / UI System
created: 2026-11-23
review-cadence: on-change
governing:
  - docs/architecture/platform/client/ui-system/prototype/drawer-assembly.md
  - packages/prototypes/shared/ui-system/chat/ChatRail.tsx
  - docs/client/desktop/window-chrome.md
authority: 浏览器/WebKit DOM 证据用于定位与回归；原生 Journey 证据取得前保持 UNPROVEN
---

# 导轨头部 cramp 修复：职责分离结构复位与图标岛贴合

## 1. 现象链

1. 抽屉拉宽后头部仍是一条横跨大半预算的灰色空条，图标缩在左侧、文字不恢复。
2. 第一轮修复让折叠态贴合内容后，搜索/新建瓦片被拖到图标岛旁挤成一团，
   失去右侧锚定。

两个现象同源，单看任一个都会导向打补丁。

## 2. 根本原因：原语晋升时合并了两个布局职责

north-star 原型 `ChatRail.tsx` 的头部是**两节点职责分离**结构：

```text
header.sk-rail-header (flex, gap 8px)
├── div.sk-rail-tabs        flex:1 1 auto; min-width:0   ← 弹簧：吸收剩余空间，右锚动作组
│   └── Segmented.sk-chat-subnav  width:100%             ← 纯瓦片控件：只负责标签/图标内容
├── IconButton (搜索)       flex:0 0 auto
└── Menu > IconButton (新建)
```

生产端 `ChatSessionList` 晋升时丢掉了 `.sk-rail-tabs` 包裹层，把弹簧
（`flex:1 1 auto; min-width:0`，原 `.sc-rail-subnav` 规则）直接挂到
Segmented host 上。一个元素同时承担"把动作组顶到右边的弹簧"和"贴合内容的
图标岛"两个互斥角色：

- 保持拉伸（旧行为）→ 折叠后灰条填满预算，两个 28px 瓦片面朝大片死区（现象 1）。
- 改为贴合（第一轮修复）→ 弹簧力消失，搜索/新建随岛左移挤在一起（现象 2）。

## 3. 被实测证伪的假设

用真实 `@peers-touch/ui` Segmented + 1:1 复刻导轨 DOM/CSS 的临时探针，
在 WebKit/Chromium 双引擎验证步进变宽、rAF 快速拖拽与 `flushSync` 表面
RO 风暴：cramp 状态机全部正确切换，无 RO 投递丢失。以下假设证伪，不实施：

- passive `useEffect` 帧时序滞后——无需迁 `useLayoutEffect`/`flushSync`。
- 兄弟 DOM/padding 预算耦合漂移——无需新增 `budgetWidth` 受控 prop。

探针与截图均为临时文件，验证后已删除，未入库。

## 4. 修复

### 4.1 结构复位（根因修复，应用层）

- `ChatSessionList.tsx`：Segmented 外包 `<div className="sc-rail-tabs">`，
  与原型 `.sk-rail-tabs` 同构。
- `chat.css`：弹簧规则 `.sc-rail-tabs { flex:1 1 auto; min-width:0 }`；
  `.sc-rail-subnav` 不再携带 flex，只作语义/样式钩子。

cramp 的 `measureAvailableWidth` 因此更干净：Segmented 的 parent 变为包裹层，
其内无兄弟节点，可用预算即 flex 引擎原生分配的包裹层宽度，手工兄弟扣减归零。

### 4.2 图标岛贴合（原语层，支撑修复）

- `selection.tsx`：`fullWidth` 的 `width:100%` 仅在未折叠时下发；host 暴露
  `data-density`。
- `styles.css`：`.pt-segmented[data-icon-only='true']` 增加
  `flex:0 0 auto; width:max-content`。折叠后控件在包裹层内贴合瓦片，包裹层
  透明吸收剩余空间——灰岛不再拉伸，动作组位置也不动。

### 4.3 compact 标签预算（原语层，token 化）

compact 密度图标-文字间距 `--pt-space-xs`(8)→`--pt-space-xxs`(4)，离屏探针
`.pt-segmented__measure-item` 同步镜像，保证测量诚实。英文 Messages/People
标签岛固有宽 215→207px，默认 300px 导轨由"差 3px 放不下"变为余量 6px。

## 5. 实测证据（真实原语 + 新结构探针，双引擎）

| 导轨宽 | 状态 | 图标岛 host | 包裹层 | 搜索右缘 | 加号右缘 |
| --- | --- | --- | --- | --- | --- |
| 160 | icon-only | 68px | 72px | 44px | 8px |
| 250 | icon-only | 68px | 162px | 44px | 8px |
| 283 | icon-only | 68px | 195px | 44px | 8px |
| 294 | 标签恢复 | 206px | 206px | 44px | 8px |
| 300 | 带标签 | 212px | 212px | 44px | 8px |
| 360 | 带标签 | 272px | 272px | 44px | 8px |

动作瓦片右缘在所有宽度/状态下恒定（加号 8px=header 内缩，搜索 44px=
内缩+瓦片+间距），cramp 切换不再移动动作组。标签恢复临界点 302→294px；
反向收窄折叠正常；无 console 错误。

## 6. 影响面

- 仅 `ChatSessionList` 同时使用 compact + fullWidth + 全图标 options，
  三处修复的交集只落在聊天导轨。
- Memory/Skills 的 Segmented 无 density 无 fullWidth；mobile 用 comfortable；
  text-only 组无 leading 字形——均零行为变化。
- 搜索展开态与 toolsCompact 菜单态不渲染该包裹层，无交集。

## 7. 验证

- ui 包 tsc、desktop `pnpm run check`：通过。
- `primitive-layer-guard`：PASS，基线 css=815/js=26 零新增。
- `vitest run src`：2380 通过；4 失败均为既有基线
  （chromeTonalStepAlignment×2、navigationOwnership×1、chatGeometry×1），无新增。
- `vite build`：通过。
- `segmentedCrampAlignment.test.ts`：新增结构分离契约（原型/生产双端
  `.sk-rail-tabs`/`.sc-rail-tabs` 弹簧规则 + subnav 不得携带 flex）与图标岛、
  compact 镜像契约，共 12 项全过。

### 仍需的原生证据（UNPROVEN）

`make desktop` 真窗口：64→360 连续 1px 拖扫，确认标签阶跃同帧、动作瓦片
右锚定不跳动、无横向 overflow；默认宽度英文标签可见；折叠态为贴合图标岛。

## 8. 明确不做

- 不引入 `budgetWidth` prop、不做 `useLayoutEffect`/`flushSync` 改造（假设已证伪）。
- 不改 `geometry.chatRail` 宽度 token 与停靠结算语义。
- 不用 header padding/负 margin 等局部手段挪阈值。
