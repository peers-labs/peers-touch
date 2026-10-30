# MomentsFeed · 朋友圈动态流（迁移增量 4）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-30 · **Owner**: Client Platform / UI System
> **旧来源**：`pages/moments/MomentsFeedPage.tsx`、`components/moments/MomentCard.tsx`
> **前置**：增量 1–3、[north-star-frame](../north-star-frame.md)

## 1. 产品边界

- **用于**：HOME 时间线的文本动态阅读——发布者方圆身份、时间/地点、圈子标签、正文、
  点赞（真实本地翻转态），以及回复数元信息。
- **不用于（本轮延后）**：
  - 图片/定位帖（旧 `ImageGrid`、`locationPost`、`MapPin`）、外链卡片、`MoreHorizontal` 卡片菜单；
  - 回复详情与评论预览（旧 `commentPreview` / `MomentDetailPage`）——回复数当前是**纯文本元信息，
    不是控件**，详情进入增量 5；
  - 发布器（旧 `MomentComposer` / `SocialComposer` 浮层）、圈子管理（`CircleManagePage`）、
    探索/用户页、作者点击跳转；
  - 信源 · 理由 · 受众信任元信息（旧 `SocialTrustMeta` / `FeedObjectExplanation`，
    现仅以 fixture 圈子标签占位）、多种 `ReactionKind`（现仅「赞」）；
  - 显式「加载更多」分页、空/加载态、真实 station 数据源（`useActiveMomentsSlice`）。
- 本地 fixture（3 条）；不发起任何业务写请求，赞态只活在组件本地。

## 2. 旧设计审计（新方法论）

- 旧 `MomentsFeedView` 直连 active moments store，卡片为自绘 `MomentCard`
  （内联 style 拼装、antd 风格表面、图片网格/菜单/反应全套重量）。新实现只迁移
  「文本流 + 赞」纵切，全部用 peers-ui 组合：**`Card flat`** 承载、
  `Avatar`（40px 方圆）身份、**`Tag tone="neutral"`** 圈子、
  **`Toggle emphasis="quiet"`** 点赞（leading `Heart`，选中填充）。
- **库组件自带外观必须用窗框材质令牌重述。** peers-ui `Card` 即使 `flat`
  仍保留 1px `--pt-border` 发丝边与库圆角/阴影；直接使用会退回 owner 已拒绝的
  admin 拼缝。`.sk-moment-card` 以 `--sk-card-border / --sk-r-card /
  --sk-card-shadow / --sk-glass-blur` 重述边框、圆角、阴影、玻璃模糊，
  与 SearchField 训练台 `.sk-card` 同源（见 [north-star-frame](../north-star-frame.md)）。
- **选中态语义换肤。** peers-ui `Toggle` 选中时用库 primary 底/墨；玻璃皮肤 primary
  是近黑胶囊，点赞语义却是全框唯一琥珀强调。`.sk-moment-actions .pt-button.is-liked`
  以更高特异性覆写为 `--sk-accent` 墨色 + 12% 琥珀淡洗，quiet 幽灵不画框。
- 回复数刻意渲染为 `<span class="sk-moment-replies">` 而非按钮：延后的能力不得
  伪装成可点控件（工艺电池 C12 的死按钮红线）。

## 3. 状态与交互

进入「动态」轨（左轨第 3 项 Sparkles，Bot/AI 轨已按范围删除）→ 3 张卡片纵向流
（16 gap，区内滚动）→ 点赞：`aria-pressed` 翻转、计数 +1、心形填充、琥珀选中态；
再次点赞回到未赞与原计数。赞态按 moment id 存于 `MomentsFeed` 本地
`Record<string, boolean>`，卡片之间互不影响；切轨卸载即重置（fixture 语义）。

## 4. 门禁

`north-star.suite.json`：`moments-feed`（3 卡 / 3 头像且全方圆 / 3 圈子 Tag /
3 段正文 / 3 个未赞 Toggle / 首卡「24 赞」/ 3 条回复元信息 / 无会话轨 /
标题「朋友圈动态」/ craft battery 全清）、`moments-like-on`（pressed、25、
is-liked、其余 2 条仍未赞）、`moments-like-off`（再点翻回 false、24、无选中态）。
1360 与 390 双宽度自动溢出检查；实测 0 console error、390 无横向溢出。
同期修正：Bot 轨移除后左轨图标计数门禁由 `gte 6` 改为 `equals 5`。

## 5. UNPROVEN

真实时间线数据源/分页、图片与定位帖、多反应类型、评论详情、发布器、
圈子与受众信任语义、作者/卡片菜单跳转、赞态持久化与跨端一致、空/加载/错误态、
i18n、晋升 peers-ui 后的组件 API（候选：`MomentCard` 材质变体由窗框令牌主题化，
而非在消费侧重述边框/阴影）。
