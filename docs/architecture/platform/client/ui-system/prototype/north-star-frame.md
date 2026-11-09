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
   才进入，不预置空业务列。**图标轨在任何窗口宽度下都是 60px 竖面，不转水平
   顶栏（微信桌面端语法）**：通知/设置恒在竖轨底部锚点，宽度变化只压缩中栏
   （min-width:0 链 + 面内容器查询），导航不重排、不在「底部 ↔ 右上」之间
   跳位。≤760px 仅回收舞台外边距、壳铺满视口，几何方向不变。

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

6. **色彩角色：墨黑 = 动作，松绿（pine）= 身份与「当前所在」。**
   `--sk-primary: #1a1d20` 只用于**操作**——主按钮（发动态「+」、对话框确认/生成）、
   范围/数据胶囊、未读角标；`--sk-accent: #2f6a50` 用于**身份与定位**——轨头自我头像
   （与全产品自我身份色 `VIEWER_TONE` 统一）、轨上当前选中面（动态/消息/设置/搜索激活）、
   连接/在线点、接听/接受。选中面是「你在哪」而非动作，故走 pine 而非墨黑；任一时刻至多
   两块 pine（我 + 当前面），38px 小块属品牌标点，不违反 pine 不铺底。hover 仍是中性墨洗。
   pine 不兼作成功色；危险/警告/成功各走 `--sk-danger/--sk-warning/--sk-success` 语义令牌。
   实现上**不改全局 `--sk-primary`**（否则主按钮全变绿），只在轨的 `.is-active` 与
   `.sk-rail-avatar` 上映射到 `--sk-accent/--sk-on-accent`。
   墨胶囊不描边、不透底；卡片是中性纸灰之上的半透明白毛玻璃面（glass 皮肤，
   只留半透与模糊质感，画布不染色、环境辉光拍平）。

7. **滚动条是隐身基础设施，不是画框的一部分。**
   窗框内（含 portal 浮层）所有滚动面统一使用 quiet scrollbar 语法：
   Firefox 通道 `scrollbar-width: thin`；WebKit 通道 10px 透明槽、无轨道填充、
   无箭头，滑块是槽内 4px 中性胶囊（静止 alpha .16，悬停 .30，全圆角）。
   禁止任何滚动面退回 UA 默认粗灰条；新增滚动容器无需也不得自带滚动条样式。

8. **数字仪表盘化：极小灰色标签 vs 超大细体数值。**
   关键数值用 400 字重、26–32px、tabular-nums、负字距；标签 9–10px、
   字距放开、三级灰。卡片内不堆 1px 描边框，用松绿填充砖或白砖 + 柔投影分层。

9. **交流平权：默认秩序按时间/中性相关性，互动量不参与排序。（一等原则）**
   每个人的声音在默认秩序里等权——赞、反应、阅读、回复数等**互动量是表达，
   不是排序信号**，平台不得默认按热度把任何人/任何内容抬到更前，「没有谁更重要」。
   - **默认序**：对话与内容流按时间（`created_at` DESC / newest-first）；
     搜索按与查询的**中性相关性**，再以时间兜底。联系人、会话、成员、通知等
     以人为粒度的列表**禁止「常联系/高互动」之类权重入口**，回到时间或中性顺序。
   - **读者自选 ≠ 平台加权**：允许一个明确标注、默认不选中的**读者浏览视角**
     （如信息流「最新/热门」，默认「最新」）；它只在用户主动选择时改变其个人视图，
     平台不预选热度、不持久暗示热度更优。
   - **对话层更严格**：评论/回复区只有时间序，不提供「最多赞」等任何互动量排序；
     嵌套回复挂同一根，随根的时间序呈现。
   - **表达不剥夺**：平权针对的是**排序**，不删除赞/反应本身——计数保留为可见表达。
   - 覆盖与外推：本原则适用于一切「按互动量给人或内容分先后」的入口（信息流、评论、
     联系人「常联系」、会话置顶的热度依据、搜索热度序、推荐位、通知排序等）；新增
     列表/检索功能时必须显式声明其默认序是时间还是中性相关性，否则评审不予通过。
   - 机器守护：评论排序控件缺失（`moments-comment-pagination`）、信息流默认时间序
     且热门仅为可选项（`moments-feed-order-view` / `moments-feed`）等由 north-star
     套件断言；再引入按互动量排序的默认入口即视为违反本原则。

## Pine 色彩哲学与用色边界

> 这是 pine（松绿）作为品牌色的**成文定义与硬约束**。选色、调色、评审
> 一律以此为准；没有「更好看的绿」可以绕过它。

### 哲学

Peers Touch 是一个去中心化的**邻里网络**——节点自治、彼此连接、长期存在。
pine 是这种关系的情绪符号，取的是「**迎客松**」意象，不是一片常绿树墙：

- **连接而不占有**：成片各自扎根、又彼此遮荫，对应联邦节点自组织，而非
  被中心浇灌。
- **可托付、低警觉**：松绿表达「安全、已连接、可长期相处」，但用低饱和、
  带光感的方式，不制造「快看我」的焦虑信号。
- **邻里、在地、日常**：是院落与街道里安静存在多年的「附近」，不是流量
  广场；对抗兴奋色（亮红/亮蓝/品红）带来的催促感。
- **耐用（longevity）**：像木、石一样的长期材料色，耐看、不过季，呼应
  本地持久数据与长期主义。

一句话：**安静、可托付、自然连接的邻里网络；迎客的、有光感的、活着的绿。**

### 用色边界（硬约束）

正因为 pine 的语义是「安静、迎客、有光感」，它的**面积与明度**都被哲学限定：

1. **中性是容器，pine 是标点。** 大面积画布/卡片必须是近乎无色的中性
   纸白/矿灰（约 95% 中性面）；pine 只出现在品牌标识、自我头像、轨当前面选中、
   连接/在线、关键链接与少量品牌 CTA——均为小面积标点（轨选中 38px 小块，任一时刻
   至多「我 + 当前面」两块）。**禁止把 pine（或任何深墨绿）刷成整屏画布、卡片底色、
   大面积填充或操作按钮**；操作按钮归墨黑。满屏高饱和绿会把品牌色降级成「皮肤」，
   既廉价又违背 pine「安静」的本意。
2. **必须是有光感的松，不是墨沉的绿。** pine 强调色保持中等明度、带一点
   透气感（松针受光），禁止近黑、近墨、无光亮感的厚重深绿用作大面积或
   品牌主色；深墨绿只允许作为中性墨（文字/主 CTA 胶囊）存在，而不是「绿」。
3. **描边用半透明中性色，不用带绿实线。** 层级靠 canvas↔surface 的中性
   tonal step + 发丝 + 投影，不靠绿色描边。
4. **语义归语义，品牌归品牌。** success/warning/danger/info 各有独立语义
   色并需过 AA；pine 不兼任成功色，避免「处处是绿」。
5. **头像默认中性墨块。** 需要身份区分时，只允许在一条**同明度、同饱和度、
   统一色相纪律**的克制小色阶里确定性取值；禁止每人一个随手挑的高饱和
   彩色（多色拼盘是「demo 感」的主要来源）。

参照纪律（不是抄色值）：高频日常通讯/社交容器（微信等）一律「中性容器 +
品牌色小面积触点」；效率工具（Linear 等）「近单色中性 + 唯一强调标点」。
两者殊途同归——**品牌色少而准，才显得贵。**

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
- **选中态是松绿实心块（身份/定位，不是动作）**：当前面（含搜索浮层打开态）的轨钮渲染
  `--sk-accent`（glass 皮肤即 pine `#2f6a50`）填充 + `--sk-on-accent` 白图标 + 主按钮投影；
  自我头像同样 pine（与内容区自我身份色一致）。墨黑 `--sk-primary` 只留给操作按钮
  （发动态「+」、Dialog 确认）。未选中透明、hover 7% 中性墨洗。状态规则的选择器特异性
  必须 ≥ 几何基规则（基规则 `.sk-rail .sk-rail-group .sk-rail-icon` 为 0,3,0；状态规则一度
  写成 0,2,0 被静默压回灰色，导致全部选中态与 hover 失效）——状态用
  `.sk-rail .sk-rail-group .sk-rail-icon.is-active/:hover`（0,4,0）。
  `rail-active-filled`（pine）/`rail-self-avatar-pine`/`rail-action-stays-ink`/
  `rail-inactive-transparent` computedStyle 断言锁死角色切分。
- 铃与设置恒在竖轨底部组，任何宽度不转顶栏（微信桌面端语法）；窄窗口只回收
  舞台外边距，`.sk-rail` 始终是全高 60px 竖面，通知/设置锚点不随宽度跳位。

## Mobile parity（移动产品面 chrome 归属）

北极星语法不是桌面专有：手机产品面（`packages/prototypes/mobile/chat`
的产品面 `MobileApp`，以及未来的 native Mobile runtime）消费**同一套
peers-ui 原语与令牌**，禁止在产品面内手造任何 chrome 组件（历史上的
`app/primitives.tsx` 已删除）。

- **材质令牌入库**：glass 皮肤的卡片材质沉淀为 `@peers-touch/ui-tokens`
  的 `--pt-glass-blur / -surface / -surface-alt / -tile / -border /
  -top-light / -shadow`（`northStarVariables(mode, { material })`，
  默认 `glass`）。数值与本文件 Source 的 `.sk-skin-glass` 卡片语法逐项一致：
  纸地板 `#f4f5f4`、卡面 `rgba(255,255,255,.68)`、blur 22px、发丝
  `rgba(22,26,24,.09)`、内高光 + 柔影、卡 r20 / sheet r22 / 控件 12 /
  头像 11、Manrope。`material: 'flat'` 是不需要半透画布的显式退化档。
- **库原语**（`@peers-touch/ui/web`，均 portal 进 UIProvider host，
  天然裁在圆角手机屏内）：
  - `MobileStatusBar`：真机状态栏解剖，不再接受 `right` 文本槽位——
    `carrier`（如 5G）+ `signalLevel 0–4`（四格信号，弱格半透）+
    `wifi`（iOS 式填充 Wi‑Fi 弧）+ `battery 0–100`/`charging`（电池轮廓、
    电量填充与凸点，≤20% 走 danger，充电闪电压纸色）全部为库内内聚 SVG
    （设备状态字形族，与语义 Icon 集区分），以 currentColor 着色，亮暗自适应；
    54px 行高、SF 设备字形，时间/指示簇与 `island`（122×37 灵动岛药丸，
    仅原型框开启，native 由 OS 自绘）光学居中。
  - `MobileNavBar`：返回 + 居中标题 + 尾部动作，遵循语法 2，**不画底发丝线**；
  - `MobileTabBar` / `MobileTabItem`：毛玻璃 dock、**仅图标无文字**（此尺度字形即含义，
    `label` 只作无障碍名），当前面 = pine 实心块 + on-accent 字形，与桌面轨「你在哪」
    语义完全同构；未读为 danger 红数胶囊（圆形状态点语法），非 pine；
  - `BottomSheet`：触摸面的 Dialog 对位件，玻璃材质、grip、全宽 quiet/danger
    动作，kind=`sheet` 走 modal overlay 合同；
  - `Avatar` 的 `presence` 点：pine 连接标点，纸带色环，圆形状态点例外。
- **组合纪律**：页面只用 ma-* 布局类摆放库原语；形状、颜色、材质、动效一律
  来自 `--pt-*` 令牌与 `.pt-*` 组件。需要新 chrome 时补进 peers-ui 本体，
  不允许过程性组件存在。
- **双边同一交互语法（不得无故分叉）**：
  - 消息面头部是桌面 `ChatRail` 的同位行——52px 行高、compact 图标
    Segmented（消息/联系人）、无边框 quiet 搜索/＋ 图标砖；**主次分区固定为
    「主菜单 tab 贴合内容、永不收缩换行居左 + 弹性余量 + 工具砖贴右缘」**
    （主 `flex:0 0 auto`、`margin-right:auto` 吸收余量；不用 Segmented fullWidth
    平分，不允许主组可收缩把标签压成两行）；点搜索是**本行
    morph 成 36px 过滤框、列表在原页实时局部过滤**（Esc/关闭还原），
    永远不是跳转页、无返回键与「搜索」标题；＋ 是锚定图标的 Menu，
    菜单项必须名实相符并跑完整闭环（添加联系人→入通讯录、发起群聊→建群会话
    并打开），禁止只关弹层/切 tab 的假动作，不可提交态给 availability 原因；
    BottomSheet 打开期宿主隐藏 MobileTabBar（半透玻璃不得透出底栏 chrome），
    sheet 开合因此属于 AppState（`chatsSheet`），路由变化联动关闭。
  - 动态面是 `MomentsFeature` 同位语法：动态/圈友 compact island、搜索与＋
    **与消息面完全同款的 36px 无边框 quiet 灰色图标砖**（不使用白描边砖、
    不使用墨色实心 primary 钮），搜索 focus 才原地展开成白底描边字段；
    ＋（feed=发动态，circles=新建圈子）为锚定图标的动作；最新/热门浮动 chip；
    圈友=受众分组数据面（新建/成员管理），
    composer 受众 8 类（公开/关注者/朋友/圈子/群聊/白名单/黑名单/仅自己），
    卡片含信任元信息、多选 emoji reaction、评论列表默认展开内联；
    composer 图片附件内联在 TextArea 自身底栏（`leadingAccessory`：左下 quiet
    ghost 图标 + 右下字数同轨），不允许 field 外独立「添加图片」行；
    手机窄屏空评论输入行不点不渲染（点评论动作后出现并聚焦），桌面宽画布可直接回复。
  - **数据同源**：移动面直接消费 shared 的 `identity-tone`（每人确定性色相、
    唯自己 pine）、`chat-data`（会话含 pinned/muted/members）、`moments-data`
    （动态/圈子/受众），不得在 mobile 自造分叉种子与全员墨色。
  - 群头像统一走库 `GroupAvatar`：成员各自色调，2–4 人 2×2、5–9 人 3×3，
    与桌面 `GroupAvatarComposite` 布局等价；`imageUrl` 覆盖为上传群像。
  - **消息动作同一词汇表（增量 56）**：桌面 hover 动作条与手机长按 BottomSheet
    是同一动作体系的两种介质容器，不是两套功能。动作目录/分组/归属与可用性裁决、
    反应目录与 reaction 状态合同唯一存在于 `shared/chat-domain/`
    （`MESSAGE_ACTION_CATALOG`、`messageActionGroups`、`applyViewerReaction`），
    两面禁止各写清单。差异只允许在容器与唤起手势：桌面 hover 浮现工具条，手机
    按住 420ms（移动 >10px 取消、触觉反馈、抑制合成 click）弹 BottomSheet——
    8 快捷反应可展开 16、回复/转发 quick row、分组长动作。归属规则不随介质变：
    他人消息无编辑/撤回、自己消息无举报、变更窗 4 分 30 秒外禁用并给原因。
    反应落气泡下胶囊（再点取消）、回复落引用块、转发真实进入目标会话。
  - **我的页身份权重三层（增量 57）**：手机触摸消费端的「我的」按信息权重分三层，
    技术标识让位于身份事实。① 身份 Hero：植物意象 cover（与动态图片同源 shared
    `artwork()`/`VIEWER_COVER`，禁造第二张插画）**沉浸式全宽出血**——cover 向上延伸到
    状态栏后、图压灵动岛（188 = 134 可视带 + 54 状态栏区），宿主仅在 Me 落地页挂
    `data-immersive` 让状态栏 absolute 浮起（凭证/站点/关于二级页不挂，状态栏保持常规流，
    否则浮层遮挡二级页导航返回钮），头像以 3px surface 切割环交叠可视带下沿；
    **封面与头像都可换，与 desktop 设置›身份同一语法**：同一个 iconOnly FilePicker
    深 scrim 铅笔（库默认 30px/radius-md/#000 34%）钉在各自右下角——封面 right:12/bottom:12、
    头像内角 right:6/bottom:6，触摸面常驻；禁止整图居中相机覆盖与两钮风格分叉；② 凭证降级：首屏只有「账号与凭证」入口行，长 PTID/用户名只在推送的
    二级页承载与复制，低频技术标识不裸露首屏；③ 偏好/网络/通用为 inset 白卡
    （`--pt-list-well=surface`、发丝边、16 圆角），组间留白分层而非整页通栏发丝线，
    退出登录在独立白卡危险区做安静红字行。AI providers/MCP/渠道/机器人/日志/统计等
    生产运维项不进入触摸消费端。

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
- craft battery C16 quiet scrollbar（槽 ≤10px、轨道透明、滑块 alpha ≤.4）
- 结构计数（单窗框、3 统计/3 对象/3 设置/3 动态/3 会话）、范围切换、
  对象选择、滑杆联动（填充 + 气泡 + 0–7 刻度）、聚焦态计算样式
- 原则 9 交流平权：评论区无排序控件（`moments-comment-pagination` 的
  `no-comment-sort-control` / `no-most-liked-option`）、信息流默认时间序且
  热门仅为可选视角（`moments-feed` 的 `feed-default-time-order`、
  `moments-feed-order-view`）

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
