# MomentsFeature · 朋友圈动态子系统（迁移增量 4）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-31 · **Updated**: 2026-11-05（交流平权一等原则：评论只按时间序，
> 取消「最多赞」；信息流「最新/热门」改为浮动全局视角——默认最新时间序，热门仅在读者
> 主动选择时生效，平台不默认按互动量加权。2026-11-02：增量 38：反馈条单胶囊化并上移；
> 39：圈友新建动作并入 subbar；40：圈子生命周期闭环；41：删除「找人」tab，subbar 常驻
> 就近搜索，切到哪个范围就搜哪个范围的内容）
> · **Owner**: Client Platform / UI System
> **旧来源**：`pages/moments/*`（MomentsApp、MomentsFeedPage、MomentDetailPage、
> MomentsExplorePage、MomentsUserPage、UserSearchPage、CircleManagePage）与
> `components/moments/*`（MomentCard、reactionCatalog、surfaces/*）
> **前置**：增量 1–3、[north-star-frame](../north-star-frame.md)

## 1. 产品边界

按 desktop 动态模块的**可见功能面**整体迁移，本地真实状态，不接 station/proto。

- **范围导航（两范围）**：peers-ui `Segmented`——动态（HOME 与联邦公开合并的一条时间线）、
  圈友（我的受众分组）。原「探索」不单列：联邦公开动态并入动态流，按时间序触达。
  **「找人」tab 删除**：人的入口回归内容就近——
  非主页身份锚点（动态作者、评论者的头像或名字）先弹**快捷名片**，关注/拉黑在名片内即可
  完成，「查看主页」才进个人页；轨内自我头像弹**浮动名片卡**（Popover，不跳页，卡内
  「管理账号」进设置）；分组加人在圈子管理弹层。
- **交流平权（一等设计原则）**：本条是 [north-star-frame Frame Grammar 原则 9](../north-star-frame.md)
  在动态子系统的落地，定义以该原则为唯一真源。**评论区只有时间序**——没有「最多赞」
  之类按反应数排序的控件，任何人的发言都不因赞多而被抬到更前；赞是表达，不是排序信号。
  评论固定最新在上（newest first），超页用「查看更早 N 条评论」游标加载。信息流层面区分
  「默认秩序」与「读者自选视角」：默认是 HOME→联邦的确定性时间序（created_at DESC），
  平台不默认按互动量加权；「最新 / 热门」`Segmented` 作为**浮动全局视角**存在——
  `position: sticky` 钉在滚动区右上、零行高（信息流顶部不留空行），以画布色**长方圆角
  胶囊**（r=`--sk-radius-control`，非全圆）+ 投影浮于卡片之上，明确它控制的是整条流；
  「热门」仅在读者主动选择时按反应总数排序（对齐 proto `TimelineSort`），是用户自己的
  浏览视角，而非平台替谁分轻重。
  **排序仅在最顶可操作（角色变形合同）**：`scrollTop<=4` 时胶囊是「最新/热门」分段；
  一旦下滑，同一胶囊原地变形为 **36px 纯图标「回顶」方钮**（15px `arrow-up`，无文字行），
  点击平滑滚回最顶后自动变回排序胶囊——用户不能在半截流里改排序，平台也不在滚动中用
  排序控件干扰阅读。搜索时该浮动控件隐藏。
  变形几何有硬结构，不允许数值试错：胶囊是右缘锚定的宽度动画盒（sort=测量宽、top=36px，
  `overflow:hidden` 裁剪）；两层共享一个 `width:max-content` 且 `flex:0 0 auto` 的**不可收缩
  grid stage**——图层几何与动画宽度解耦，在已收缩的胶囊内测量永远不会反馈成被压窄换行的
  排序层；两层同格右对齐，右缘与垂直中心在任何一帧完全重合。显隐按角色分别声明：incoming
  层首帧即 visible 并淡入，outgoing 层保持绘制到淡出结束才 hidden（单一
  `visibility 0s linear .22s` 会把 incoming 一起延迟，留下约 150ms 空白胶囊，即被否决的
  「闪」方案）。`data-feed-mode=sort|top`，两层始终挂载、不卸载不回流。
  **横向零溢出是结构属性，禁止数值试错与断点补丁（2026-11-06 硬化，对齐聊天面）**：从 `.sk-moments`、
  `.sk-feed-pane`（及 active pane 的直接子项）、`.sk-moments-scroll`、`.sk-feed-sort-float`
  到 `.sk-post` 全链 `min-width:0`；滚动宿主 `.sk-moments-scroll` 显式
  `overflow-x:hidden; overflow-y:auto`——只允许纵向滚动，任何后代的 intrinsic 宽都无法把列
  撑出 `.sk-shell` 圆角右缘。排序/回顶胶囊与卡片是同一滚动宿主的同级 flex 子项，二者右缘由
  布局天然重合（不允许靠固定宽度/margin 对齐）；胶囊是 `width:max-content` 的 sticky 零高
  overlay，`min-width:0` 保证它不向列反馈 min-content。自适应不得以挑几个宽度的媒体查询
  「验证」：`widthSweep` oracle 在 **700–2880 每 24px 一档**（顶部态 + 下滑 600px 回顶态）
  连续断言胶囊/卡片右缘一致、滚动宿主零横溢、卡名单行——任意一档发散即红。
- **就近搜索（信息就近规则）**：subbar 常驻一个带放大镜的 `TextField`（与其它搜索
  同一交互：即时过滤、可清除），**搜索域随当前范围切换**——动态过滤合并时间线
  （站点/作者/正文），圈友过滤分组（名称/描述/成员名）；搜索在当前时间序上就地过滤、
  关闭分页与结尾标记，无命中出 Empty。切范围即清空关键词（`data-scope-search=<tab>` 标记当前域），
  杜绝一个词静默过滤错误领域。subbar 右侧是**各范围共用的固定动作槽**：一个 38px 纯图标
  `IconButton`（动态=发动态、圈友=新建圈子），跨范围几何完全一致（像素级稳定门禁）；
  搜索占位符为统一短文案（不截断门禁），不允许列表内部另开「计数 + 动作」工具栏行。
- **动态卡**：48px 方圆身份（r13）、姓名·时间、**来源 · 关系理由 · 受众**信任行
  （本站/来自\<站点\>、同圈/互相关注/关注的人/自己、公开/朋友/关注者/圈子·名/仅自己，
  各段 11px 图标 + 单点分隔，缺失项不伪造）、正文 320 字「展开全文/收起」、
  图片网格（1/2/3 列）+ 灯箱 Dialog（上一张/下一张、计数）、
  **卡内评论区**（增量 31：不再跳详情卡，默认全显；超过 10 条**顶层**评论折叠为前 10 条 +
  「展开全部 N 条评论」，折叠/展开只数顶层，嵌套回复随所属根评论常驻；
  卡内即写即发，单行 `TextField` + 同高右贴发送键，Enter/发送、空态禁用）、
  **评论互动**（增量 32：每条评论带「赞 N/回复」meta 行，赞可翻转并带计数与已赞语义色；
  回复在该评论下展开行内单行输入框，回复进入 tinted 嵌套回复块，**回复的回复挂同一根**；
  反馈条评论计数递归含嵌套回复）；more 菜单只在自己的动态上出现（删除动态）。
- **反馈条（增量 38 收敛）**：动作条**紧贴正文/图片下方、评论区上方**，数量首屏可见
  （评论默认全展且可上十条，旧位置在评论区最底，要划过整串评论才看到计数）。条上只有两个
  peers `Button`：一个**反应胶囊** + 一个**评论数**（点击展开/收起评论区）。
  「赞」不是独立按钮——数据层本就只有单选表情反应（赞是 16 种 emoji 的第一种），旧 UI 却把
  「最高频表情+总数」胶囊与旁边一个「更多反应」笑脸钮并置，看起来像「点赞 + 表情」两件事，
  增量 38 合并为单一反应胶囊。
- **反应**：desktop `reactionCatalog` 同款 16 种 emoji 的 Popover 选择器（向下弹）。
  胶囊是 Popover 的唯一触发器：点击打开选择面板，选 emoji 即设为本人单选反应（换表情自动迁移），
  **再次选择当前表情取消**；无反应时是纯笑脸图标钮，有反应时显示「表情 + 总数」
  （本人已选显示本人表情，否则显示最高频表情），总数挂 `data-reaction-total`。
  观看者反应以**全框唯一松绿标点**（pine + 12% 淡洗）标记。
- **评论删除**：仅自己的评论在 meta 行出现「删除」（danger quiet 钮，非 hover 才可见的图标），
  两段确认（删除动态/删除评论共用确认 Dialog），删除递归清理嵌套回复；他人评论无删除入口。
- **身份色板（identity-tone，2026-11-05）**：字母头像按身份取确定性色相（陈屿靛蓝/周禾赭/
  苏禾陶土/林晚青/老周棕/阿砚紫/河埠头钢青等），未知名字哈希取同一色板；**自己独占松绿
  `#2f6a50`、群组合保留中性墨灰 `#3d434a`**。禁止让所有他人头像共用近黑色（曾导致整列像
  墓碑）。色相均为亮度<0.2 的中深色，Avatar 自动配白字。
- **快捷身份名片（共享 identity/IdentityCard，2026-11-05 起动态/聊天共用）**：个人页之外
  的一切身份芯片——动态作者头（头像+名字同一触发区）、每条评论的头像与名字、**聊天消息流里
  的头像**——点击只弹 264px 名片，不离开当前流：头像/名/站点/bio/粉丝/互相关注、**最近动态**
  （至多 3 个 72px 缩略格，有图用图、无图三行文字摘要，点格进该作者主页）、关注 `Toggle`、
  拉黑、「发消息」（聊天面，关闭即留在会话）、「查看主页」fullWidth 钮（点击即关名片再导航；
  聊天面会跨面切到动态面个人页）。本人芯片只显示「查看我的主页」；无本地档案的陌生作者只显示
  身份与「查看主页」，不伪造关注/粉丝。名片状态由 `data-author-self` / `data-author-seeded` /
  `data-author-follow` 标记；只有 follow/block 的 actionId 带 personId 后缀。
- **个人页**：72px 方圆身份头（r20）、站点/简介、动态数、关注翻转、TA 的动态列表；
  入口收敛为名片的「查看主页」与轨内自我头像的浮动名片卡（增量 41 后无独立找人页）。
- **圈友 = 我的受众分组（增量 40 闭环）**：语义对齐 proto `Circle`——单个 actor 拥有的
  PTID 命名列表，**成员无感、非双向**，不是群；因此**没有「退出圈子」**（退出/解散归
  chat.Group 群聊生命周期）。整卡是一个 peers `Button`（右 chevron），点击打开**管理 Dialog**：
  - 改名/描述（保存提交，取消丢弃，每次打开重挂载清空草稿）；
  - 成员列表移除（本人 `viewer` 行无移除钮，只有「我」徽标）；
  - 从已知人（PEOPLE_SEEDS）勾选添加，候选池随增删实时增减，全在组内出空态文案；
  - 「删除分组」danger 钮 → 独立两段确认 Dialog（删除不影响已发布动态可见范围）。
  列表无独立工具栏（增量 39：新建动作在 subbar 右侧）；全删后出 Empty。新建/管理/确认三个
  Dialog 均由 Feature 层持有。compose 发动态的圈子受众读同一份 circles，全删后圈子二级
  Select 不渲染并给引导，发布钮禁用，杜绝空圈发布。
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
- 反应选中色覆写：peers-ui 胶囊 `[aria-pressed=true]` 用库 primary（玻璃皮肤为近墨），
  与「赞=松绿」语义冲突；`.sk-post-actions .pt-button.is-liked` 用更高特异性改走 pine 强调，
  与 inc2 输入区去框、inc3 portal 令牌同源，属于窗框对库组件的主题化接缝。
- 增量 38 审计：旧 ReactionBar 在「有他人反应」态渲染一个最高频表情 `Toggle`（点击=直接赞 top）
  **外加**一个「更多反应」笑脸 `IconButton`，数据是单选表情、UI 却像「点赞 + 表情」两个控件；
  且整条沉在默认全展的评论区下方，计数要划到底才可见。现合并为**一个** Popover 触发胶囊
  （点击开 16 面板，再选当前表情取消）+ 一个评论数钮，并上移到正文与评论区之间。
  代价：一键快赞变两步（开面板→赞），换取无二元并置、触摸/鼠标一致的单一入口。
- 增量 40 审计：早期把圈子当「我加入的对称社群」画（成员头像组 +「你加入的圈子」），
  只有新建、无出口，是孤岛。proto 定论圈子是发布者私有的单向受众列表，故闭环不做「退出」，
  而是对齐真身 `CircleManageView`：整卡进入管理弹层（改名/描述、成员增删、删除两段确认）。
  配套库修复：Dialog 内打开 Popover/Menu/Select 时，浮层与模态遮罩同为 overlay-host 兄弟节点，
  原样式只有 `.pt-modal-layer` 有 `z-index:1`、浮层 auto，选项被遮罩拦截无法点击
  （compose 的圈子受众选择一直潜伏此缺陷）。库样式给非模态浮层 `z-index:2`，同级以 DOM 序决胜。
- 库组件外观接缝统一：卡片表面由 `.sk-post` 用 `--sk-card-*` 材质重述；
  embedded `TextArea` 无框，发布器表面画在 `.pt-field-frame` 宿主上（圆角宿主拥有焦点环）。

## 3. 文件与状态

- `moments/moments-data.ts`：类型、16 反应目录、8 条动态（6 HOME + 2 联邦）、
  6 人、3 圈子、确定性 SVG 图床占位；`MomentComment` 带 `likes: string[]` 与
  `replies: MomentComment[]`（一层嵌套，回复回复挂根），`VIEWER_NAME` 为本人身份键。
- `moments/MomentCard.tsx`：单卡解剖（信任行/展开/图片灯箱/卡内评论区与顶层折叠/反应条/自己的删除菜单）；
  `CommentItem` 递归渲染根评论与嵌套回复，meta 行为赞/回复/仅自己的删除，回复输入与卡内输入均为
  单行 `TextField` + `IconButton`（发送键与输入框同高右贴；库 `TextArea` 强制 min-height 80px，不适用单行场景）。
- `moments/MomentsFeature.tsx`：范围导航（增量 41 收敛为三范围 + subbar 单例就近搜索 `query`，
  切范围清空）、tab/profile 两视图内导航（增量 31 删除 detail 视图，评论不离开卡片；增量 41 删除
  `PeopleView` 与 people tab，关注入口归个人页）；反应/评论/**评论赞/评论回复（递归挂根）**/
  评论删除（递归清理）/动态删除/发布/关注/
  圈子新建/**改名/描述/成员增删/删除**全部本地状态；`ComposeDialog`（发动态）、`CircleCreateDialog`
  （新建）、`CircleManageDialog`（管理，增量 40）、删除确认 Dialog 均由 Feature 层持有（开关随打开
  重挂载清空草稿），`CirclesView` 是整卡可点的纯列表；`moments/moments.css` 全部原型样式，
  浮层层级修复在库 `packages/ui/web/src/styles.css`。
- 状态规则：观看者同时只保留一种反应（切换反应会迁移计数）；评论即时追加；
  评论赞按 `VIEWER_NAME` 递归翻转；回复只挂根评论的 `replies`，不再向下嵌套；
  发布真实插入；**圈子成员编辑在管理弹层内是草稿态，保存才提交**（取消丢弃），删除在独立确认 Dialog
  确认后立即移除；切范围重置分页；返回回来源范围。

## 4. 门禁

`north-star.suite.json` 中 32 个 moments 场景：feed 全解剖与工艺电池（含 3 tab、搜索域绑定、
无 people 面断言）、
加载更多 3→6、反应单胶囊（初始 `data-reaction-total=27` → 开面板选赞 → 松绿选中且 28 →
再选同一表情取消回 27、`aria-pressed` 复位）、选择器 16 项、选择器选第 3 种、
**反馈条位置与单控件（增量 38）**：`.sk-post-body + .sk-post-actions + .sk-comments`
相邻关系、条上恰 2 个 `.pt-button`、初始反应 27/评论 12、旧 `.sk-react-more/.sk-react-add`
计数为 0、灯箱开关、卡内发评论（3→4、清空）、仅自己可删评论、>10 条**顶层**折叠/展开（嵌套回复单列计数）、
评论赞翻转（他人初始未赞→on；自己种子已赞→off，计数保留他人赞）、
评论回复进入嵌套块且动作条评论计数递归更新（12→13）、发动态插入首位、探索远端信任、
**就近搜索（增量 41，4 场景）**：feed 搜「薄荷」→1 条，清空恢复分页 3 条与加载更多；
explore 搜「植物」→1 条联邦动态且搜索态无结尾标记；circles 搜「流转」→1 个分组；
首页带词切圈友后词清空、3 分组全显（切域复位），并锁死 3 tab、`.sk-people` 计数 0、
`data-scope-search` 随域变化；圈友（增量 39：mid-op 断言新建动作在 `.sk-moments-subbar` 内、`.sk-circles-head`
计数为 0，建圈后 3→4、头像组计数 13）、**圈子生命周期（增量 40，4 场景）**：`moments-circle-manage`
（开管理弹层、名称预填、移除老周+添加苏禾、改名保存后列表 3 卡 5 成员、头像聚合守恒）、
`moments-circle-manage-members`（成员 4→3 与候选 3→4 即时联动、本人行移除钮计数 0、取消丢弃）、
`moments-circle-delete`（删除→确认 Dialog→确认后 2 卡、头像聚合 12→7）、
`moments-circle-empty-compose-guard`（删空 3 组出 Empty；发动态选圈子受众时圈子 Select 不渲染、
引导出现——同时锁死库级「Dialog 内 Select 可点」）、个人页返回、个人页 72 身份内容。
1360 与 390 双宽度自动溢出；实测 0 console error、390 无横向溢出。
`moments-never-overflows-under-squeeze` 锁死横向结构合同：两个 `widthSweep` 在 700–2880
每 24px 连续扫描（顶部排序态 + 下滑 600px 的回顶态），断言排序/回顶胶囊右缘与首卡右缘
逐像素一致（≤1px）、`.sk-moments-scroll` 零横溢、卡名单行——不是抽样视口，任何一档
发散即红；不得对会纵向滚动的卡片用四边 containedIn（其底边随滚动内容超出可视区属正常）。
轨身份 44 由 feed 场景的 computedStyle 断言固定。
consumer/board/foundation 回归 OBSERVED（north-star 165 + boards 20），import-guard 裸元素债务持平 686，tsc 干净。

## 5. UNPROVEN

真实时间线/联邦数据源与协议信任枚举、私密动态与 native 媒体、图片真实上传与多图排版
（4–9 张）、视频/投票/定位/转发/链接、@提及与话题、删除/举报菜单、
反应/关注/建圈的持久化与跨端一致、虚拟长列表、i18n、真实读屏模态实测、
晋升 peers-ui 后的组件 API（候选：MomentCard 材质变体与 ReactionPicker 下沉为库组件）。
