# SettingsFeature · 设置框架（迁移增量 6，增量 22 修订）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Updated**: 2026-11-01（增量 22）· **Owner**: Client Platform / UI System
> **旧来源**：`pages/SettingsPage.tsx`（分组/分区导航）、
> `components/settings/SettingsLayout.tsx`（Container/Section/Row/ItemCard）
> **前置**：增量 1–5、[north-star-frame](../north-star-frame.md)

## 1. 产品边界

- **用于**：桌面设置的框架与导航原语——轨齿轮进入；6 个分组（通用/工具/通道/
  小程序/数据/帮助；AI 与联邦两组不出现）；多分区分组的左侧分区导航；
  Section（浮动材质卡）/ Row（标签块 + 右侧内在控件）/ ItemCard 原语；
  唯一在本轮落地的真实分区「通用」：界面语言 Select、聊天截图快捷键录制器。
- **诚实空态**：增量 7–9 才落地的分区渲染 peers-ui `Empty`，文案注明迁入增量；
  分组切换与分区切换都是真实导航，不放假控件。
- **不用于**：各分区业务内容（账号/安全/帮助=增量 7，存储/文件/日志=增量 8，
  工具/通道/小程序=增量 9）；Bots 挂起不迁；深链高亮、SectionHost 缓存策略等
  desktop 内核行为在原型层不适用。

## 2. 旧设计审计（新方法论）

- 旧 `SettingsPage` 用 antd + 下划线分组 tab（`borderBottom` 发丝 + 2px 主色激活条）
  与 180px `borderRight` 发丝侧边栏；新实现按北极星语法改为**材质药丸**：
  分组是 `--sk-tile` 槽内的 quiet 药丸，激活为近黑胶囊；分区导航是 primary 淡洗药丸列，
  两条 chrome 都零发丝边（机器门禁断言 subbar `border-bottom-width: 0` + craft C10）。
- 旧 `SettingsLayout` 原语（antd Title/Text/Flexbox 内联样式）重写为窗框原语：
  `SettingsSection`（材质卡，图标+标题+副标题+extra）、`SettingsRow`
  （左标签/描述、右内在控件，行间用 7% 文字色的卡内细分隔，不是 chrome 发丝）、
  `SettingsItemCard`（`--sk-tile` 嵌片）。控件本身全部是 peers-ui（Select/Button/Switch…），
  原语只管材质与布局。
- 快捷键录制器对照 desktop `chatScreenshotShortcut`：默认 `Mod+Shift+A`，
  聆听态捕获 window 级含修饰键组合（忽略纯修饰键），平台化显示（⌘⇧A / Ctrl+Shift+A），
  重置键在默认值时真实禁用；录制按钮本身可中止聆听。
- 轨上无去向的「通知」铃铛移除（不做死控件）；齿轮是当前唯一轨底入口。

## 3. 状态与导航

`group`（6 选 1）→ 切换时分区重置为该组首项；`section` 仅在分组分区数 >1 时显示导航；
单分区分组（通道/小程序/帮助）导航隐藏。语言、快捷键为本地真实状态。

### 3.1 增量 22：通用组扩为 5 分区 + 跨面偏好

通用组分区导航由 3 项扩为 5 项：账号 / **消息** / **消息通知** / 通用 / 安全。

- **消息**：消息对齐 Segmented「各在一边 / 统一靠左」，写 `prefs.messageLayout`。
- **消息通知**：两张卡（通知我哪些事件 5 开关、投递方式 2 开关），
  对齐 desktop `NotificationsSettingsSection`，默认 mentions/invites/friendRequests/
  network/inApp 开、reactions/sound 关。
- **语言真生效**：通用分区的语言 Select 不再是本地态——写 `prefs.locale` 后经
  窗内事件广播即时重渲染设置、聊天与窗框 chrome（inc6 时仅本地态的 UNPROVEN 解除）。
- 偏好统一存 localStorage key `north-star.prefs.v1`，跨功能面共享；设置根带 `data-ui-locale`。

## 4. 门禁

`north-star.suite.json` 新增 4 场景：`settings-frame`（齿轮激活、6 药丸、
3 分区、空态标增量 7、无发丝 chrome、工艺电池）、`settings-general-section`
（两行、语言 Select、默认 Mod+Shift+A、重置初始禁用）、`settings-shortcut-record`
（Meta+Shift+S 录制后重置恢复默认并重回禁用）、`settings-group-switch`
（单分区组隐藏导航、空态标增量 9）。轨图标计数同步 5→4。
35/35 OBSERVED（1360/390 自动双宽），consumer 18/18，tsc 干净，0 console error。

## 5. UNPROVEN

账号/安全/帮助/数据/工具/通道/小程序分区内容、Bots、真实服务端偏好持久化
（当前为 localStorage，仅在本浏览器原型内跨面持久）、深链高亮、
Section 卸载/缓存策略、晋升 peers-ui 后的 Section/Row API。
i18n 仅 zh-CN/en 且只覆盖窗内 chrome（种子消息/名单/朋友圈内容不译）；
desktop 真身 AppearanceSection 的消息密度/深色/字号未迁入。
