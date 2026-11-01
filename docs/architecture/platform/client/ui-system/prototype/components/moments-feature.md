# MomentsFeature · 朋友圈动态子系统（迁移增量 4）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Owner**: Client Platform / UI System
> **旧来源**：`pages/moments/*`（MomentsApp、MomentsFeedPage、MomentDetailPage、
> MomentsExplorePage、MomentsUserPage、UserSearchPage、CircleManagePage）与
> `components/moments/*`（MomentCard、reactionCatalog、surfaces/*）
> **前置**：增量 1–3、[north-star-frame](../north-star-frame.md)

## 1. 产品边界

按 desktop 动态模块的**可见功能面**整体迁移，本地真实状态，不接 station/proto。

- **范围导航**：peers-ui `Segmented` 四范围——首页（关注+同圈 HOME）、探索（联邦公开）、
  找人（人名/站点搜索）、圈友（我的圈子）；头部「发动态」CTA 仅首页出现。
- **动态卡**：48px 方圆身份（r13）、姓名·时间、**来源 · 关系理由 · 受众**信任行
  （本站/来自\<站点\>、同圈/互相关注/关注的人/自己、公开/朋友/关注者/圈子·名/仅自己，
  各段 11px 图标 + 单点分隔，缺失项不伪造）、正文 320 字「展开全文/收起」、
  图片网格（1/2/3 列）+ 灯箱 Dialog（上一张/下一张、计数）、
  **卡内评论区**（增量 31：不再跳详情卡，默认全显；超过 10 条折叠为前 10 条 +
  「展开全部 N 条评论」；卡内即写即发，Enter/发送键、空态禁用）、动作条（反应与评论计数，
  气泡钮可收起评论区）；more 菜单只在自己的动态上出现（删除动态）。
- **反应**：desktop `reactionCatalog` 同款 16 种 emoji 的 Popover 选择器；
  汇总胶囊显示总数，观看者反应以**全框唯一琥珀**（墨色 + 12% 淡洗）标记，可翻转/迁移。
- **评论删除**：hover 自己的评论出现删除图标，两段确认（删除动态/删除评论共用确认 Dialog）；他人评论无删除入口。
- **个人页**：72px 方圆身份头（r20）、站点/简介、动态数、关注翻转、TA 的动态列表。
- **找人**：实时过滤 + 关注 Toggle（互关徽章）；**圈友**：圈子卡 + `AvatarGroup`
  重叠头像组 + 真实「新建圈子」Dialog。
- **发动态**：Dialog 内 embedded `TextArea` + 受众 `Select`（选圈子时出现圈子二级选择），
  发布后插入首页首位并立即可见。
- **分页**：显式「加载更多」按钮（3/页，desktop 明确不做无限滚动），到顶显示结尾标识。
- 所有可点元素都有真实去向；没有一个死按钮。

**不迁移（明确延后/不适用）**：私密动态 native 平台状态机（SocialPrivateState、
读私密/恢复/远程不可达）、视频/外链/投票/定位/转发 embed 等内容种类、
图片上传（灯箱图片为确定性本地 SVG 占位，明确非真实图床）、@提及与话题、
举报/联邦信源解释的协议枚举全量、
真实 store/分页接口、空/加载骨架的模拟延时、i18n。

## 2. 旧设计审计（新方法论）

- desktop 用 antd `Card/Button/Dropdown/Popover/Tooltip/Segmented` + 大量内联 style；
  新实现全部换成 peers-ui 原语（`Segmented`、`Popover`、`Menu`、`Dialog`、`Toggle`、
  `IconButton`、`Button`、`Avatar`、`AvatarGroup`、`TextArea`、`TextField`、`Select`、
  `Empty`），布局/材质归本文件 scoped CSS。
- **身份层级是本轮重做的第一动因。** 旧原型头像 40px、轨内身份 34px（小于 38px 导航键），
  卡面材质喧宾夺主。现定为轨身份 44/r12（比导航键大一档，近黑胶囊锚定全轨）、
  卡 48/r13、详情评论 28/r8、个人页 72/r20。
- **信任行不降级为单一圈子 Tag。** 旧实现的 `SocialTrustMeta` 是三段语义
  （source · reason · audience）；inc4 初版只放了一个圈子 Tag，丢了来源与关系理由。
  现按段渲染，联邦探索明确显示「来自 \<站点\>」。
- 反应选中色覆写：peers-ui `Toggle[aria-pressed=true]` 用库 primary（玻璃皮肤为近黑），
  与「赞=琥珀」语义冲突；`.sk-post-actions .pt-button.is-liked` 用更高特异性改走琥珀，
  与 inc2 输入区去框、inc3 portal 令牌同源，属于窗框对库组件的主题化接缝。
- 库组件外观接缝统一：卡片表面由 `.sk-post` 用 `--sk-card-*` 材质重述；
  embedded `TextArea` 无框，发布器表面画在 `.pt-field-frame` 宿主上（圆角宿主拥有焦点环）。

## 3. 文件与状态

- `moments/moments-data.ts`：类型、16 反应目录、8 条动态（6 HOME + 2 联邦）、
  6 人、3 圈子、确定性 SVG 图床占位。
- `moments/MomentCard.tsx`：单卡解剖（信任行/展开/图片灯箱/卡内评论区与折叠/反应条/自己的删除菜单）。
- `moments/MomentsFeature.tsx`：范围导航、tab/profile 两视图内导航（增量 31 删除 detail 视图，
  评论不离开卡片）；反应/评论/评论删除/动态删除/发布/关注/建圈全部本地状态；`moments/moments.css` 全部样式。
- 状态规则：观看者同时只保留一种反应（切换反应会迁移计数）；详情评论即时追加；
  发布/建圈真实插入；切范围重置分页；返回回来源范围。

## 4. 门禁

`north-star.suite.json` 中 13 个 moments 场景：feed 全解剖与工艺电池、
加载更多 3→6、快速反应（27→28 琥珀）、选择器 16 项、选择器选第 3 种、
灯箱开关、卡内发评论（3→4、清空）、仅自己可删评论、>10 条折叠/展开、发动态插入首位、探索远端信任、
找人关注+过滤、圈友新建（3→4、头像组计数）、个人页返回、个人页 72 身份内容。
1360 与 390 双宽度自动溢出；实测 0 console error、390 无横向溢出。
轨身份 44 由 feed 场景的 computedStyle 断言固定。
consumer 回归 18/18 OBSERVED，tsc 干净。

## 5. UNPROVEN

真实时间线/联邦数据源与协议信任枚举、私密动态与 native 媒体、图片真实上传与多图排版
（4–9 张）、视频/投票/定位/转发/链接、@提及与话题、删除/举报菜单、
反应/关注/建圈的持久化与跨端一致、虚拟长列表、i18n、真实读屏模态实测、
晋升 peers-ui 后的组件 API（候选：MomentCard 材质变体与 ReactionPicker 下沉为库组件）。
