# Frontend Eles · 自训练 UI/UX 方法论

> **Status**: active（增量 25–28 起生效）
> **Created**: 2026-11-01
> **Owner**: Client Platform / UI System
> **实现面**：`packages/prototypes/shared/ui-system/`（Frontend Eles 六个 tab）
> **产物库**：`packages/ui/`（`@peers-touch/ui`、tokens、assets、contracts）
> **门禁**：`tooling/scripts/ui-system/suites/boards.suite.json`、
> `tooling/scripts/ui-system/prototype-import-guard.mjs`

## 1. 这是什么

Frontend Eles 不是组件陈列室，而是一台**自训练机器**：桌面/手机原型在真实
产品任务里暴露 UI 需求，基础层把重复出现的需求沉淀成 peers-ui 组件与语法，
样本与套件是可审阅、可复用的训练产物，人审决定什么能晋升。原型负责提问，
库负责沉淀答案；方法论约束这个循环不被"为解决问题而解决问题"的一次性私写破坏。

六个 tab 是循环的六个工位：

1. **桌面原型 / 手机原型**——需求侧，真实产品面，只允许消费库能力。
2. **基础元素（组件）**——令牌与能力登记册：只列真实存在的能力，状态分
   已验收 / 已实现待样本 / 缺口已登记（数据源 `registry.ts`）。
3. **套件**——面向产品任务的组合模式（动作、表单、浮层、反馈、列表、身份媒体）。
4. **样本**——每个已验收组件的六维状态矩阵（标准 / 长文案 / 禁用）。
5. **设计理念**——本文件的可读版本，方法论与语法的唯一入口。

## 2. 自训练宪章（硬规则）

1. **先查库，再动手。** 原型需要任何元素/组件，先查能力登记册。已验收直接消费；
   已实现待样本的先补样本再消费；没有的登记为缺口。禁止在原型目录私写基础控件。
2. **缺口先晋升，原型后消费。** 新组件必须在基础层走完
   「定义 → 实现 → 样本（状态矩阵）→ 探针门禁 → 人审 → 晋升」，原型随后才消费；
   顺序不可颠倒。
3. **人审是唯一晋升权。** 探针 OBSERVED 只证明结构、几何、零 console error；
   视觉签名、产品语义、品味由用户逐项 review。候选/草稿/已验收状态必须显式标注。
4. **语法回流，删除私有实现。** 人审通过的语法晋升进令牌包，原型中的私有变量
   与私写控件随增量回迁并删除；库里保持唯一真值。
5. **双向可追溯，存量债显式登记。** 每个组件可追溯 库实现 ↔ 样本 ↔ 消费面；
   历史私写控件与手机端 antd 进入债务基线，门禁只允许债务减少。

## 3. 能力生命周期与登记册

`packages/prototypes/shared/ui-system/registry.ts` 是唯一能力清单，三种状态：

- `vetted` 已验收：库已实现 + 有样本卡 + 至少一个原型面真实消费；记录消费面。
- `implemented` 已实现待样本：库已导出但没有样本/消费，不允许在新原型里"裸用"，
  先补样本。
- `gap` 缺口已登记：原型仍在私写或即将需要，区分 `primitive`（库要新增的基础件）
  与 `composition`（应由套件承载的组合模式），并记录需求来源面。

旧的 130 项纸面目录取消：没有实现路径的定义条目不再展示。130 项目录数据
（`packages/ui/contracts`）保留为历史合同输入，不再作为 Gallery 真值；
后续经评审决定剪枝或与 registry 合并。

## 4. 语法与候选主题

当前人审通过的语法是**松绿玻璃（pine-on-neutral）**：中性纸灰凹陷画布、
不透明白色阅读面（毛玻璃只保留半透与模糊质感、不染色）、近墨主动作、
松绿只做连接/在线/选中的小面积标点、语义色各自独立、环境辉光拍平、
发丝分隔、方圆家族（头像 11 / 控件 12 / 卡片 16–20）、
三档阴影（静息/轻抬/浮层）、玻璃模糊只用于窗框与浮层。
用色硬约束以 north-star-frame.md「Pine 色彩哲学与用色边界」为准。

它以候选主题 `north-star-pine-glass` 存在于
`packages/ui/tokens/src/north-star-theme.ts`（`status: candidate`，
`allowedUse: prototype-specimen`），通过 scoped `UIProvider style={northStarVariables()}`
注入，**不改生产默认主题**（冷墨主题并存）。晋升为默认需要整体人审，
届时候选文件退役、原型 `--sk-*` 私有变量清零。

**跨面通用交互语法（桌面/手机同一份，平台差异除外不得分叉）：**

1. **搜索就地展开，永不跳页；各面头部图标砖同款。** 搜索图标在所在轨道行内 morph 成
   过滤框（行高不变、160ms 淡入/位移动效），列表在原页实时局部过滤，Esc/关闭键还原；
   不产生导航标题、返回键与独立路由。**消息面与动态面头部的搜索、新增（＋）必须是同一套
   36px 无边框 quiet 灰色图标砖**（透明底、`--pt-secondary` 图标、hover 浅 wash），
   收起态不画白描边砖、不用墨色实心 primary 钮；只有搜索 focus 展开时过滤框才显白底描边。
   轨内局部过滤与外轨 ⌘K 全局跨面导航职责切分（见增量 33/41）。
   **主在前，次靠右：菜单 tab（主）与工具砖（次）是固定职责分区。** 头部一行永远是
   「主导航 segmented 贴合内容宽、永不收缩换行」+「弹性余量」+「固定宽工具砖贴右缘」：
   主分组 `flex:0 0 auto`、track `width:auto`、内部钮 `flex:0 0 auto` 且 label nowrap，
   余量用主组 `margin-right:auto`（或次组首个元素 `margin-left:auto`）吸收，搜索/＋ 砖右缘
   对齐 header 内容右缘。三种错误形态都被门禁拦：① 主组 `flex:1 + width:100%` 平分整条宽
   track（过宽空条）；② 主组可收缩（`flex-shrink:1;min-width:0`，含 Segmented `fullWidth`）
   把「联系人」压成两行；③ 无 auto 余量时工具砖不贴右缘。动态面同理：island 不收缩，聚焦
   展开的搜索框是行内唯一可让步元素（`:focus-within{flex:0 1 auto;min-width:0}`）。
2. **超出可滑，两端必虚化。** 任何内容宽度超出容器、需要横向滚动的行（手机动态卡的
   反应 chips 等），必须用 `mask-image` 边缘渐隐（约 16px）提示「还有内容」，渐隐端
   随滚动位置动态切换 `start/end/both`，滚动条隐藏。是否换行依介质：桌面宽轨换行
   （wrap），手机触摸行动作行横滑——一旦选择横滑就必须给虚化。纵向溢出同法
   （`notifications.css` 先例）。
3. **留白必须有意义：动作轨道共享右缘。** 同一行内信息（chips/正文）居左、动作钮
   （表情/评论/发送）固定贴右，右缘与卡片内容边、下方评论发送钮严格对齐；不允许动作
   独占第二行、右侧留无功能空白。浮动控件（排序 chip、回到上方）是 `height:0` 的
   sticky 覆盖层，不占文档流，并锚在卡片**内缘**（右内缩 = 卡片内边距），边框/阴影
   不得压在卡片发丝边界上。**手机面「回到上方」是 flat quiet 图标砖**：不透明 surface
   填充（遮挡滚动穿过的卡片文字）+ 0 描边 + 无静息阴影 + 次级墨图标，hover 浅 wash；
   严禁白底+描边+阴影的 SaaS FAB 方块（描边/静息阴影在 flat 内容面是异质 chrome；桌面
   宽画布的胶囊容器形态不照搬到窄屏）。
4. **日常内容面用实体材质，玻璃只给窗框与浮层。** 手机产品面整体用
   `northStarVariables(mode, { material: 'flat' })`：动态卡、底栏 dock、输入框均为
   不透明白/canvas + 发丝线；半透毛玻璃不出现在需要长时阅读的内容面上（与六维「表面」
   一致）。桌面的 frosted 语法不变。
5. **图片九宫格同一规则（动态/聊天发图，上限 9）：** 1 张=16:10 宽幅，2 张=两列，
   3–9 张=三列方形；选取超余量截断，到 9 禁用选择器，缩略图 3 列预览、单张可移除。
   聊天 composer 的待发缩略图用紧凑 56px 轨，不套用动态弹层的整宽九宫格。
6. **输入区解剖统一、无死按钮：** 移动端聊天输入区固定为「表情钮、＋钮、输入框（占满
   剩余）、发送钮贴右」一行；表情走库 Popover（共享表情目录、按光标插入），＋走库 Menu
   （相册/拍摄）驱动隐藏 FilePicker，发送在空内容时以 availability 给出禁用原因。
   **任何可见可点控件必须接真实行为**：摆出来的图标不允许是空 handler——评审与门禁
   （check-layout 的 composer 段）会逐一点开表情/＋并校验发送态。
7. **消息行解剖与 desktop 同源：** 头像 32px、顶对齐，单聊圆角 11 / 群聊 8；对方头像在左、
   **自己消息头像必须在右（row-reverse），任何时候都不能漏渲染**；气泡列 gap 9、行 gap 14、
   气泡 16px 圆角 + 靠尾下角 6px，对方 subtle 底、自己 primary 墨底，正文 13.5/1.6；
   服务通知居中胶囊；纯图片不套气泡、九宫格贴右。check-layout 发一条消息后断言自己行
   有 32px 头像且 row-reverse。
8. **创建菜单必须名实相符、真闭环；底部 sheet 覆盖条带处抑制产品 chrome。** 头部 ＋/新增
   菜单的每一项必须落到其名称声明的完整功能闭环（「添加联系人」→通讯录出现此人；
   「发起群聊」→建群会话并打开），严禁仅关闭弹层或切换 tab 的假动作；空输入、重名、
   未选成员等不可提交态必须以 availability 给出原因。BottomSheet 物理覆盖底栏条带且本身是
   半透毛玻璃，打开期间宿主必须隐藏 MobileTabBar——故 sheet 开合状态属于 AppState
   （与 `composerOpen` 同类），不得只存组件本地态；tab/navigate/back/登出联动关闭，
   返回列表后不得残影重开。check-layout 逐一点开菜单项并断言产物（联系人行 / 群复合头像
   会话）与 sheet 打开期底栏缺席。
9. **附属动作内联到所属容器的内建轨道，禁止单个图标独占空旷区域。** 多行输入框的附属动作
   （如添加图片）必须落在 field frame 自身底栏：左下 accessory、右下字数，同一轨道且与正文
   左右缘对齐；不允许在容器外另起一行放一个被大片留白包围的独立 pill/按钮。能力在 peers-ui
   `TextArea.leadingAccessory`（`.pt-textarea-foot`），桌面 Dialog 与手机 sheet 两面同构。
   iconOnly 的深色 scrim 变体只属于图像覆盖物（头像/封面换图），输入框内附件用 quiet ghost。
10. **窄屏渐进披露：空输入行不点不显示。** 手机动态卡的评论 composer 默认不渲染——评论
    列表可默认展开，但空「写评论」输入行只有在读者点该卡评论动作（图标+计数）后才出现并
    聚焦；再点一次收起。空输入框不得为每张卡默认占一行纵向空间（与第 9 条同源：不制造无
    内容的空区）。桌面宽画布保留「评论列表默认展开且可直接回复」（空间充裕，属允许的平台
    差异）。check-layout 断言默认 `.ma-comment-input` 计数为 0、点击后出现且聚焦；boards
    套件 `mobile-comment-tap-to-reveal` 固化。
11. **消息动作同一词汇表，介质只改容器。** 桌面 hover 动作条与手机长按 BottomSheet 必须从
    同一份 SSOT 派生——动作目录、分组（primary/organize/mutate/safety）、归属与可用性规则、
    反应目录（16 种/8 快捷）与 reaction 状态合同全部在
    `packages/prototypes/shared/chat-domain/`，两面禁止各写一份动作清单。归属/时限/文本
    可用性由 SSOT 单点裁决：他人消息无编辑/撤回，自己消息无举报，超过 4 分 30 秒变更窗或
    无文本的动作以 availability 给出中文原因而非消失。触摸手势参数固定：按住 420ms 唤起、
    移动 >10px 取消、触发时 8ms 触觉反馈、长按触发后抑制合成 click。反应必须落为气泡下方胶囊
    （`data-mine` 表达归属），再点同一胶囊取消；回复必须在发送后落真实引用块且 composer
    引用条清除；转发必须真实进入所选目标会话——不允许只关弹层的假动作。门禁：check-layout
    thread 段（peer/own 动作表、reaction toggle、引用闭环）+ boards 套件四个
    `mobile-msg-*` 场景，runner 用真实 `longPress` 操作而非合成事件。
12. **身份页按权重三层，低频技术标识默认不进首屏。** 我的页第一层是身份 Hero：
    植物意象 cover 与动态图片同源（shared `artwork()`，松绿 + 枝叶，导出 `VIEWER_COVER`，
    禁止自造第二张插画），**沉浸式全宽出血**——cover 向上延伸到状态栏后面、图压在灵动岛下
    （高 188 = 134 可视带 + 54 状态栏区），宿主以 `data-immersive` 标记让该页状态栏
    absolute 浮起；该标记**只挂 Me 落地页**（`route.tab=me && !route.setting`），推送的
    凭证/站点/关于二级页有自己的导航栏，必须保持状态栏常规流，否则浮起的状态栏会遮挡二级页
    返回钮。头像交叠 cover 可视带下沿（接缝 y 不随 cover 加高而移动）并以 3px surface
    切割环压在图/纸交界处；**封面与头像都必须可换，且与 desktop 设置›身份同一语法**——
    两者都用 peers-ui `FilePicker iconOnly iconId=edit`（库默认 30px、radius-md、
    `#000 34%` 深 scrim、白铅笔），分别钉在各自右下角：封面 `right:12/bottom:12`、
    头像收在头像内角 `right:6/bottom:6`（不飘到接缝中央）；手机是触摸面（`hover:none`），
    按 desktop `@media(hover:none)` 规则两钮常驻可点。禁止整图居中相机覆盖层、禁止两钮
    风格分叉（一深一浅）、禁止用 camera 图标替代 edit 铅笔。
    第二层是**凭证**：首屏只有一个「账号与凭证」入口行，长 PTID/用户名只在推送的二级页
    承载与复制——低频技术标识（PTID 等）任何时候都不裸露在首屏。第三层是偏好/网络/通用
    分组，用 peers-ui ListSection `inset` 白卡（手机面 `--pt-list-well=--pt-surface`、
    发丝边、16 圆角），组间留白分层，不再整页通栏发丝线；退出登录独立白卡危险区，安静红字
    行、无红框。触摸消费端**裁剪生产者/运维项**：AI providers、MCP、渠道/机器人、运行日志/
    统计不允许出现在手机我的页。门禁：check-layout me 段独立 record（cover 艺术/出血/
    高度、cover-immersive 顶对齐、statusbar 浮起、头像尺寸/交叠/环、封面/头像编辑钮右下
    几何与 icon-only 同构、无整面覆盖回归、身份事实、首屏隐私与裁剪、inset 白卡、危险区、
    二级页凭证+状态栏不浮起、返回后不回漏、切走 tab 状态栏恢复常规流）+ boards
    `mobile-me-profile` / `mobile-credentials-page`。
13. **通话动作按通话角色分配，主叫侧永远没有「接听」。** 「接听/拒绝」是被叫（incoming）
    专属动作，只出现在居中来电模态；主叫（outgoing）不主动接通，通话按与桌面 `CallOverlay`
    相同的相位预算自动推进 `outgoing（振铃 1.6s）→ connecting（接通 0.9s）→ active（计时）`，
    状态文案依次「正在呼叫…/正在发起视频通话…」「正在接通…」与 `mm:ss`。主动作区在接通前
    只有一个红色 phone-off，label「取消」（终止呼出尝试、回 idle）；active 后才是静音/摄像头
    加红色「挂断」。`call/accept` 语义归位为「被叫接听」信令事件，由定时器（原型）或信令
    （真身）驱动，UI 不得为主叫暴露它的入口。门禁：check-call-states 在 outgoing 立即断言
    「接听」钮计数为 0 且唯一控件 label 恰为「取消」，再零点击等待 connecting/active 出现
    （自动接通的证据）；boards `mobile-call-lifecycle` 用 `waitFor active` 取代接听点击，并以
    `missing [data-action-id='ma.call.phone']` 锁死主叫接听钮回归。

六维评审（文字/几何/色彩/图标/表面/布局）定义见「设计理念」tab 与
`north-star-frame.md`；探针覆盖几何与结构，品味留给人。

## 5. 机器门禁

- **探针**：`boards.suite.json` 校验六 tab 结构、登记册数量（当前 22 已验收 /
  5 缺口）、样本禁用态、套件交互、宪章条目、手机原型真实运行；
  1360/390 双宽溢出与 0 console error 随每个套件必跑。
- **私写控件基线**：`prototype-import-guard.mjs` 扫描原型特性目录中的裸
  `<button>/<input>/<textarea>/<select>`；训练板（基础元素/样本/套件/理念/
  手机框）必须为零；特性文件以 `prototype-import-baseline.json` 为债基线，
  新增文件或数量增长即失败，减少自动报为债务清偿。
- **每个被报告的问题先过门禁盘点（硬规则）**：处理任何用户提出的问题/bug 前，先判定
  包级脚本（`packages/prototypes/mobile/chat/scripts/`）与注册套件
  （`boards.suite.json`）是否已有能复现它的探针；没有就**在同一增量补齐**，门禁必须断言
  可观察的真实产物（联系人行、会话、复合头像……），不能只断言「面板能打开」。新门禁要做
  **变异验证**：临时让修复失效（如 reducer 变 no-op），确认新场景判 VIOLATED，再恢复——
  不能拦回归的门禁等于没有。包级脚本与注册套件两处都要对齐：产品面选择器重构后，注册场景
  是同一契约的 SSOT，不得留下引用旧皮的 ERROR 场景。
- 证据仍是 `CLAIM_SCOPE_OBSERVABLE_ONLY`：结构可观察，产品 Journey UNPROVEN。

## 6. 存量债务（显式登记，只许减少）

- 桌面原型 `sk-*` 私写组合件：设置下划线 tab/侧栏行、全局搜索命令面、会话行等；
  registry 中已登记 CommandSurface / ConversationRow / SettingRow / UnderlineTabs。
  逐增量回迁，回迁时删除原型私有实现。
- ~~手机原型直接消费 antd~~：**已清偿（增量 49）**。antd 与自绘英文第二张皮
  （MobileShell/pages/mp-*）全量删除，手机面只剩单一产品 UI（src/app），控件全部
  来自 peers-ui；证据靠 AppState 场景注入，验收脚本重基于 ma-*/data-action-id。
- 候选主题未晋升生产默认；候选与生产双真值是阶段性状态，不是终态。

## 7. 增量记录

- 25 IA 重置：七旧 tab/研究板（基础元素旧板、消费端全集、表达样本、基础拆解、
  20 基础组件、130 目录）退役，六 tab 建立，手机原型收编，本宪章成文。
- 26 候选主题 `north-star-pine-glass` 入库；基础元素板重建为令牌+真实登记册。
- 27 样本体系：20 个已验收组件状态矩阵，标准/长文案/禁用统一条件开关。
- 28 套件体系：6 个产品任务模式套件，全部由真实 peers-ui 组件与本地状态组成。
- 29 聊天壳收敛：轨头收薄、搜索入口统一（外轨 ⌘K + 资料卡记录搜索）、Switch 胶囊与
  IconButton 居中在库级修复、群头像唯一实现、群名可改/群公告可看；私造控件债 701 → 698。
- 30 视觉缺陷门禁补强：库级规定菜单不可用项必须是扁平行（透明底/透明边/灰字，不渲染描边盒）；
  窗框 chrome 图标钮永不实心填充，"面板打开"只用浅墨 wash（`is-active`）表达。
  对应探针 `message-menu-flat-disabled`、`header-icon-no-solid-fill`，同类问题回归即失败。
- 31 动态卡即完整阅读面：删除"打开动态"与 detail 视图，评论全部卡内展开（默认全显，>10 折叠），
  卡内写评论；删除入口只属于自己（评论 hover 垃圾桶 + 自己动态的 ⋯ 删除动态），两段确认。
- 32 评论是活的：卡内/回复输入统一单行 `TextField` + 同高右贴发送键（库 `TextArea` 强制
  min-height 80px，单行场景禁用；场景选择器绑定 `[data-card-composer] input`，回退 textarea 即失败）；
  每条评论可赞（翻转+计数+已赞语义色）、可回复（行内输入，回复进 tinted 嵌套块，回复回复挂同一根）；
  折叠只按**顶层**计数，动作条评论数递归含回复，两类计数在场景中分别断言。
- 33 联系人轨信息密度：请求动作（接受/拒绝/撤回/删记录）禁止独占整行文字钮，一律收进
  name 行右侧 ghost `IconButton` 簇（桌面 hover 浮现、触摸常驻，✓绿✕红 hover 语义），
  卡片高度只服务于人；四段列表（新请求/已发出/历史/联系人）统一可折叠分区头
  （peers-ui 全宽安静钮 + chevron + 计数，默认仅历史收起），计数只挂数据与折叠解耦；
  轨内搜索恢复为**就地列表过滤**（与外轨 ⌘K 跨面导航职责切分，搜索态分区打平隐藏）；
  历史记录与好友补齐删除/移除入口。五个新门禁锁死：过滤打平、双 tab 过滤、折叠 display
  切换与 aria-expanded、删空分区消失、移除计数 4→3。
- 34 外轨补通知铃：迁移真身 `AppSideNav` 底部组（铃→设置），原原型只迁了设置，
  铃位留空。铃用 peers-ui `IconButton`+`Popover`（不长裸元素债），面板解剖对齐真身
  `NotificationBell`：未读红角标、未读行高亮、分类 Tag、全部已读、单条已读/删除、空态；
  浮层在 `.pt-overlay-host`，场景交互必须 `clickGlobal`/全局 oracle。
  同步教训：底组从 1 钮变 2 钮，位置型选择器 `.sk-rail-group:nth-child(4) .sk-rail-icon`
  全部歧义（27 个设置场景误点铃），设置改挂 `data-rail-target="settings"` 稳定钩子，
  轨钮结构计数 4→5。
- 35 找人弹窗无头化 + 联邦查找：解释性 chrome（标题/描述/footer 取消/计数 tip）全部删除，
  打开首行即带放大镜的搜索框（autoFocus）与结果，关闭只留搜索行唯一 ✕（禁用 clearable
  防止双 ✕），冗余归零；查找对齐真身 `FindPeopleModal`——全部/联邦 scope 分段、
  陌生人走独立联邦目录（默认不列出），前缀即时搜、`@user@host` 精确解析、
  联邦行动作是「发送请求→等待通过」而非直接开会话。已知人默认直接列出这一真身没有的
  优点保留。三个新门禁锁死目录发现+请求态、scope 隔离、handle 解析/未知空态。
- 37 真身对齐五项 + 窗框架构一次收紧：
  ① 联系人轨增「已保存群组」段（五分区，`GroupAvatarComposite` 38px + 成员数，点群直接开群会话）；
  ② 消息轨搜索补出无会话的已知好友（search-as-create，点人直接新建会话）；
  ③ 外轨消息钮未读**总数**角标（聊天面求和实时上报）；
  ④ 找人联邦行补 PTID 身份行与 self/friend/pending/available 四身份态（仅 available 可发请求）；
  ⑤ `⌘/Ctrl+,` 设置、`⌘/Ctrl+N` 新会话（输入控件与输入法合成期不触发）。
  为让角标跨面实时，聊天/动态/设置三面改为**常驻挂载**（`.sk-feed-pane[data-pane-active]`
  切 display，状态/effect 存活）。
  两条用门禁固化的教训：
  - **角标定位包裹会改写子节点位置，禁止位置型导航选择器**：把消息/动态钮包进
    `.sk-rail-entry` 以挂角标后，按钮在父节点的 `:nth-child` 序号变化，95 处
    `.sk-rail-group:nth-child(2) .sk-rail-icon:nth-child(2|3)` 探针一次性失配。
    轨钮一律稳定钩子（`data-rail-target=chat|moments|settings`），结构包裹不再能炸导航。
  - **选中轨内搜索结果必须复位搜索**：否则带着 query 跳到单行过滤列表（看似「会话没建成」），
    选中即收起搜索框并清空 query，落点是完整 pin-first 列表。
  另一条断言时序规则：对某 tab/分区内元素的断言必须在导航切走（该子树卸载）**之前**
  以 mid-operation `expect` 完成，终态只断言导航结果。
- 38 动态反馈条「去二元并置 + 计数上移」：数据层本只有单选表情反应（赞是 16 种 emoji 之首），
  旧 UI 却把「最高频表情+总数」胶囊与旁边「更多反应」笑脸钮并置，被读成「点赞 + 表情」两套；
  且整条沉在默认全展（可上十条）的评论区最底，计数要划到底才见。合并为**一个** Popover 触发
  胶囊（点=开 16 面板，再点当前表情取消）+ 一个评论数钮，移到正文/图片正下方、评论区上方。
  两条固化规则：
  - **同一语义不得在同一动作条出现两个入口**：若控件背后是同一个单选状态模型，UI 必须只有一个
    承载控件，不能用「快捷态 + 更多态」并置制造虚假二元对立（快赞降为开面板两步是可接受代价）。
  - **计数/反馈入口贴内容，不贴列表尾部**：当下方列表默认全展且可能很长时，反馈计数必须在内容
    与列表之间，而不是列表之后。机器门禁用相邻关系
    `.sk-post-body + .sk-post-actions + .sk-comments` + 条上控件数 + 旧入口计数 0 锁死位置与单控件。
- 39 圈友列表去独占工具栏：「N 个圈子 + 新建圈子」独占一整条、下方大片空白，是低密度反例。
  页面级动作统一收进 subbar 右侧的**唯一动作位**（首页=发动态、圈友=新建圈子，同位同语法），
  「N 个圈子」这类可由列表自身读出的计数直接删除；`CirclesView` 回归纯列表，Dialog 归 Feature 层。
  固化规则：**列表视图不得为「计数 + 一个页面级动作」单开工具栏行**——计数能从内容读出就不重复展示，
  动作归该范围的 subbar 动作位。门禁在进入圈友范围时 mid-op 断言动作存在于 `.sk-moments-subbar`
  且旧 `.sk-circles-head` 计数为 0。
- 40 圈子生命周期闭环，并纠一个语义错误：早期把圈子画成「我加入的对称社群」导致自然追问「退出呢」，
  但 proto `Circle` 是发布者私有的单向受众列表（成员无感、非双向；双向空间是 chat.Group），
  所以闭环不是退出/解散，而是真身 `CircleManageView` 的 CRUD：整卡进入管理弹层（改名/描述、
  成员增删、删除两段确认），compose 受众读同一份数据、删空后禁用圈子发布。固化规则：
  - **生命周期要对齐协议所有权模型，不按表面相似性造动作**：私有受众列表只有拥有者的增删改，
    没有「退出」；退出/解散只属于双向群。UI 措辞也要从「加入/成员」回归「我的受众分组」。
  - **闭环必须含状态出口与跨视图一致性**：只有新建=孤岛；管理动作还要联动所有消费方（发动态受众
    Select、空态、发布禁用），否则删除会留下悬空引用。
  - **顺带暴露并修复库级缺陷**：Dialog 内打开 Popover/Menu/Select 时，非模态浮层与 `.pt-modal-layer`
    是同一 overlay-host 的兄弟节点，浮层无 z-index 被遮罩拦截。规则：模态层 z:1、其上方的非模态浮层
    z:2，同级以 DOM 注册序决胜；门禁用「Dialog 内真实点选 Select 选项」锁死，不能只断言面板存在。
- 41 信息就近规则：删除「找人」独立 tab，subbar 常驻单个搜索框，**切到哪个范围就搜哪个范围的内容**
  （首页→HOME 动态、探索→联邦动态、圈友→分组名称/描述/成员）。固化规则：
  - **搜索入口就近于当前领域，不为「搜索对象类型」单开 tab**：对象类型随范围走，一个搜索框 +
    `data-scope-search=<tab>` 绑定当前域；人的入口回归内容就近（点作者进个人页关注、分组加人在管理弹层）。
  - **切域必须清空关键词**：否则旧词静默过滤新领域，出现「搜不到」假象；门禁用「带词切 tab 后目标域
    全量呈现」反向锁死。
  - **搜索态关闭分页与结尾标记，无命中出 Empty**：搜索结果是完整集合，不能与分页切片混用语义；
    清空后恢复分页与加载更多（门禁验证恢复，不只验证过滤）。
  - TextField 的 className/data 属性落在原生 input（非 FieldFrame），宽度/外边距等宿主级布局
    要用 `:has(> .class)` 作用在 frame 上。
- 42 通知面板 owner 对齐：底部轨钮触发的高面板用 start 对齐的 `placement="right"` 时，防溢出翻转
  会把它放到钮上方并留缝，与 owner 失共边（「走弯了」）。规则：
  - **浮层锚定遵循 owner 引导**：owner 在边缘（底轨/顶栏）时用共边变体——库 OverlayPlacement 新增
    `right-bottom/left-bottom`（与 owner 共底边、向上生长），视口不够时贴边夹取而不是翻转脱离；
    overlay 节点带 `data-placement`。
  - **分类/类型标签不得伪装成按钮**：真身通知分类是不可点灰 chip；用带边框 Tag 会被读成「聊天」
    可点的死 affordance。无动作的元数据一律灰 chip（`pointer-events:none`）。
  - 机器规则：新增 `anchoredTo` 几何门禁，断言浮层在 owner 指定侧且共边（容差 8px），
    结构断言（data-placement）+ 几何断言（boundingBox 共边）+ chip 计数/旧 Tag 计数 0 三重锁定。
- 43 消息行几何与双边身份的四个修正：群聊悬浮工具条对齐昵称行而非气泡；统一靠左后自己头像消失；
  分段选中态是库默认冷灰；自己/对方在同侧时风格塌缩风险。固化规则：
  - **悬浮工具条锚定气泡盒，不锚定「昵称 + 气泡」列**：气泡与工具条放进同一个气泡尺寸的锚定盒
    （`.sk-msg-main`），工具条相对它绝对定位、顶边贴气泡首行（`top:6px`）；锚到列时群聊昵称行
    会把工具条抬到名字高度。DM 无昵称时结构同样成立。≤720px 统一改为气泡上方浮层（bottom 锚定），
    统一靠左的自己消息与 peer 共用右侧外边。几何门禁用 `anchoredTo` 对气泡断言侧别 + 顶边共边
    （容差 10px），群聊场景单独建锁。
  - **双边消息默认都有头像**：自己的消息在「各在一边」与「统一靠左」都渲染头像（撤回分支同规则），
    群聊 8px 圆角、单聊皮肤半径，与 peer 完全对称；头像色用本地 viewer 身份 token。隐藏自己头像只是
    sides 的**子偏好**：子 Switch 只在 sides 出现并缩进为子行，切到 left 开关消失且头像强制保留，
    根节点 `data-hide-own-avatar` 仅在 sides+开启时为 true。
  - **可见性门禁用 computedStyle display，不用 count**：`display:none` 节点仍命中选择器计数；
    隐藏断言必须是 `display:none`，显示断言取真身计算值（avatar 被原型规则提升为 `flex`，不照抄
    库里的 inline-flex）。
  - **同侧只改位置，不改涂装**：统一靠左后自己气泡仍是 primary 填充白字、peer 仍是 tile，
    左右风格差异不许塌缩；门禁用双方气泡 backgroundColor 物理值锁定。
  - **token 桥接要成对**：桥了 `--pt-primary` 就必须桥 `--pt-primarySubtle`，否则分段控件选中态、
    Select 选中项会露出库默认冷灰（`#e9ecf2`），与暖色皮肤不搭；subtle 值用
    `color-mix(in srgb, var(--sk-primary) 10%, var(--sk-raised))` 随皮肤派生，不硬编码。
    门禁双锁：选中态文字色为皮肤 primary + `computedStyleNone` 扫整卡禁画冷色元组。
- 44 群资料侧拉页被指出「样式不对齐 + 与真实功能不对齐」。根因与规则：
  - **覆盖型侧拉页的头部必须与被覆盖面共线**：`.sk-conv-view` 有 `padding:18px 22px 16px`，
    绝对定位侧拉页 `top:0` 而聊天头在 18px 内、高 60，侧拉头却是高 52 → 标题差 26px、
    两条 hairline。规则：覆盖面板头的 top/height/边框颜色必须与宿主面对齐（margin-top:18、
    height:60、同 8% 分隔色），门禁用 `anchoredTo` 断言两者 bottom 共线（容差 2px）。
  - **禁止自造图标砖**：真身行是 15px 纯图标，原型给图标套 30px 灰底圆角砖，把行撑到 46px
    并在砖周制造死空白。规则：设置行 = 纯图标 + 文字（leading 槽），无 tile 背景；
    门禁同时断言旧砖类计数为 0、纯图标类 ≥ 行数。
  - **功能清单必须对照真身源码，不自造入口也不遗漏**：`ChatDetailPanel.tsx` 里没有群公告
    （`announcement_pb` 无 UI 消费），原型却造了群公告行；群名编辑在真身是 Hero 内联编辑
    （owner/admin 门控）而非独立 Dialog 行；真身还有权限卡、viewer 自己在成员列表、
    添加成员/管理（设撤管理员、转让、移除两段确认）、我在本群昵称、聊天背景、群主解散/成员退出。
    规则：迁移面板先列真身功能清单，逐项映射「已实现/删除/UNPROVEN」；找不到真身消费的功能
    一律不画入口。
  - **几何断言优先于存在断言**：「标题对齐」这类需求用 boundingBox 共线/间距物理值锁，
    不能只断言节点存在——节点在但错位正是本次缺陷形态。
  - peers-ui Button 复用作扁平行后，`:first-child` 结构契约失效（track 前有图标/文字兄弟）；
    开关行选择器改用稳定 data 属性（`data-profile-muted`），不用位置伪类。
- 45 群头部「N 位成员」独占第二行被否。规则：
  - **标题的计数/状态元数据是同行尾随注释，不是副标题行**：头部标题区从 `column` 改
    `row + align-items:baseline + gap:8`，strong 可省略号、span `flex-shrink:0` 跟在右侧；
    单聊在线/免打扰同规则收敛，不保留两种排版。
  - 门禁用几何锁「同行」（副标题在标题 right 侧 + 顶边差 ≤4px），不只断言文字存在。
  - **成员集合新增「自己」后必须审计所有把 members 当「远端成员」的消费方**：通话网格初始化是
    「本地我 + 全部 members」，种子含 viewer 后自己重复（1+5=6）导致 `data-participant-count`
    漂移；入站群呼叫头像预览同理。规则：渲染远端参与者/远端预览时显式过滤 viewer 身份，
    「会话成员（含自己）」与「通话远端（不含自己）」是两个集合，不能共用。
- 46 轨头「消息/联系人」不等宽、搜索钮黑框。规则：
  - **同级分段控件必须等长对称**：二选一分段不是内容定宽的两个胶囊，容器占满后两段 `flex:1`
    平分（peers-ui `Segmented fullWidth`），label 在等宽格内居中。门禁用 bbox 宽度差 ≤2px
    锁（新增 `sameWidth` 几何 oracle：target 与 peer 等宽），不能只断言「有两个按钮」。
  - **黑框来自库 hover 规则特异性持平，不是 antd**：重构面 100% peers-ui（shared/ui-system
    零 antd 引用；手机原型的 antd 是登记在册的历史债务）。库 `.pt-button:hover`(0,3,0) 与
    quiet 去边框规则 `:is(...)`(0,3,0) 同特异性、靠源序生效，任何加载顺序/皮肤变化都可能让
    quiet chrome hover 露出 primary 描边。修复在库层：去边框规则用显式属性选择器提升到
    (0,4,0) 覆盖 hover/active/pressed；宿主层对轨头 chrome 再钉一道「全状态 border 透明」
    护栏。门禁：hover 后 `border-top-color` computed 必须是透明色。
  - **「像 antd」的观感必须先实测再下结论**：用探针读 idle/hover/:focus-visible/交互后各态
    的 border-color/outline/boxShadow 与 activeElement，不靠截图猜组件来源。
- 47 群「加不了人」暴露的不是单点 bug，是**生命周期审计缺失**。功能不是入口存在就算完成，
  每个子特性都是有生命的实体，必须沿「诞生 → 变更 → 消亡」核对数据出入口：
  - **成员诞生（加人）**：入口（dashed 添加）→ 候选集（好友池去重已在群者）→ 勾选弹层 →
    提交后 members 增长必须**同时广播到所有消费面**：成员格计数、头部「N 位成员」、
    rail/联系人列表的群合成头像、通话远端参与者；**并在消息流留下入群服务消息**（群是有
    账本的，诞生无痕等于没发生）。
  - **成员消亡（移除/退出/解散）**：移除两段确认 → members 收缩 + 同一批消费面同步 +
    移出服务消息；退出/解散后会话必须从本地列表消失并关闭面板——**非成员不能继续持有
    一个可管理的群**（旧实现只从 members 删自己、会话仍在列表，是假消亡）。
  - **属性变更（头像/群名/昵称/角色/背景）**：改一处必须同步所有渲染面。本次群头像上传后
    rail 两处 GroupAvatar 没传 `imageUrl`，只在资料卡生效——单一合成组件契约要求所有调用点
    传齐 props；门禁同时断言 hero 与 rail 的 `<img>`。
  - **角色派生即时性**：myRole 从 members 派生，转让群主后危险区（解散↔退出）、相机、
    添加入口、改名权限必须当场切换（已验证 owner→member 全部收敛）。
  - **副作用不放 setState updater**：StrictMode 双调用会让 updater 里的服务消息翻倍；
    新增成员先用当前渲染态算清楚，再纯函数 setState + updater 外发账本消息。
  - **门禁按生命周期而非 UI 结构写**：加人场景断言「计数+1 / rail 合成像+1 tile / 入群
    服务消息文本」三件套；退出场景独立于解散（先转让再退出，断言会话-1）；上传用
    `setFiles` op 打真实文件，断言 hero 与 rail 双 `<img>`。
  - **交付前自己跑一遍全生命周期 Playwright**：建群→加人→改名/换头像→设/撤管理员→转让→
    移除→（新成员视角）退出→解散，每步读 DOM 真值，闭环后再交用户试；不要把集成验证留给用户。
- 48 临时浮层必须遵守「点作用域外即隐藏」的平台约定。规则：
  - **库浮层（Popover/Menu/Select/Dialog）已自带外部关闭**：pointerdown capture 判定不在
    浮层与锚点内即 dismiss，模态层点 scrim 关闭。新增交互优先用库组件，不重造。
  - **自绘的非模态内联浮层（资料侧拉页、话题侧拉页）必须补同一个语义**：抽 `useDismissOutside`
    hook（pointerdown capture、ownerDocument 作用域、active 门控），触发钮列入 ignore
    选择器——capture 阶段先于 click，不排除触发钮会「关了又开」形成假死。
  - **子弹窗与父浮层的作用域关系**：从侧拉页内打开的 Dialog 走 portal，落在父浮层 DOM 之外，
    必须把 `.pt-modal-layer` 加入 ignore；点子弹窗遮罩只关子弹窗，不连坐关闭背后的资料页。
  - 点内部不关、点外部关、触发钮切换、子弹窗遮罩独立——四态都要建门禁，不只测「能打开」。
- 49 手机面单一产品化 + 跨面交互语法对齐（本轮成文即 §4 五条语法）：
  - **删除第二张皮**：MobileShell/pages/components、英文 demo 种子、mp-* 皮肤（30+ 文件、
    3600+ 行）全部退役；`MobilePrototype` 瘦身为场景宿主，`<MobileApp scenario=…/>` 注入
    AppState（default/journey/station-offline/long-content/long-lists）；数据直接消费
    shared `identity-tone/chat-data/moments-data`，群头像走库 `GroupAvatar`
    （2–4 人 2×2、5–9 人 3×3，成员各自确定性色调，唯自己 pine）。设备机身唯一归属共享
    宿主 `.nb-phone`，包体 793KB→372KB。
  - 搜索就地 morph（不跳页）；动态=动态/圈友两段+最新/热门零高度 sticky 浮标；
    反应 chips 横滑 + 双向边缘虚化；动作钮与评论发送共享卡片右缘；手机面切 flat 实体材质。
  - 动态发图对齐 desktop：上限 9 张九宫格（1=16:10 / 2=两列 / 3–9=三列），
    FilePicker 多选、超余量截断、9/9 禁用。
  - 验收脚本重写：check-layout（三视口几何/无旧皮/无溢出）、check-long-lists
    （240 会话/320 联系人/480 消息）、check-call-states、check-residual-parity
    （源码+运行时禁 antd/mp-*/英文种子）；mobile-surface-boundary 守卫反转为「只准一张皮」。
- 50 消息面 ＋ 菜单真实闭环 + sheet/底栏组合修复（成文即 §4 第 8 条）：
  - **缺陷**：消息头 ＋ 的「添加联系人 / 发起群聊」原是假动作 BottomSheet——只关闭弹层并切
    tab，名称与行为不符（用户实测「添加怎么变成搜索」的名实错位同源）。旧全局 newChatOpen
    删除后开合下沉为组件本地态，又丢掉了「sheet 打开期隐藏底栏」的组合关系，半透毛玻璃下
    透出底栏图标虚影。
  - contact/add：昵称 + 备注，空名/重名以 availability 禁用，prepend 进通讯录；
    「添加并发消息」进联系人详情→会话；首条消息把按需合成的 direct 会话提升进会话列表
    （preview/time 同步更新）。group/start：群名可选（默认「甲、乙 的群聊」），人员 chips
    多选（≥1，身份色头像+选中勾），建含 viewer 成员 tiles 的群会话并直接打开，同时进入
    通讯录群聊目录，列表行渲染 GroupAvatar 复合拼贴。本地实体 id 统一走 state.nextLocalId()。
  - 新增 AppState.chatsSheet（none/add-contact/start-group），tab/navigate/back/signOut/
    group/start 联动归位 none；MobileAppView 在 chatsSheet≠none 或 composerOpen 时隐藏
    MobileTabBar。BottomSheet 无 footer 槽，表单动作脚放 sheet body 内 .ma-form-foot
    （取消钉左、主动作贴右），人员选择器 .ma-person-picker 在 sheet 内部滚动（max-height）。
  - check-layout 新增 ＋ 菜单段（三视口）：两项菜单文案、添加 sheet 标题且非搜索 morph、
    sheet 打开期 .pt-mobile-tabbar 缺席、空/重名禁用、添加后联系人行存在、选 2 人发起后
    群线程标题匹配且返回列表后该行带 data-columns 复合头像。
  - **注册套件同步重建（boards.suite.json）**：增量 49 重产品面时只重写了包级脚本，
    注册套件的 14 条手机场景中 13 条仍引用已删第二张皮（`.ma-tab`/`ma.tab.agent`/
    `ma.new-chat`/`.ma-search-trigger`/`[data-search-page]`/`.ma-thread-name` 等），
    evaluate-specimens 下全部 ERROR，且旧 `mobile-new-chat-sheet` 把「搜索并发起会话」假面板
    当预期——门禁 SSOT 实际长期红灯。本增量全部按单一产品面选择器重写，删除三个已退役特性
    场景（Agent 预留格、全局搜索覆盖层、旧假面板），新增 add-contact-sheet / add-contact-loop /
    start-group-loop / group-row-composite / search-morph-inplace 五场景；手机场景
    18/18 OBSERVED。
  - **变异验证**：临时把 `contact/add` reducer 置为 no-op，`mobile-add-contact-loop` 判
    VIOLATED（仅断言面板形态的 add-contact-sheet 仍 OBSERVED，证明门禁区分「能打开」与
    「真生效」），恢复后回到 OBSERVED。
  - 存量未决（非本增量引入，如实挂起）：elements 板 `.nb-token-code` 桌面宽 151>144
    溢出，自改动前基线即失败，需单独增量处理。
- 51 发动态附件内联（成文即 §4 第 9 条）：
  - **缺陷**：手机发动态 sheet 与桌面发动态 Dialog 的「添加图片」都是 field 外独立一行
    的 pill 按钮，右侧大片留白——单个图标动作独占空旷区域。用户红框指定位置：textarea
    内左下角，与右下字数对位。
  - **库能力**：peers-ui `TextArea` 新增 `leadingAccessory`，FieldFrame 多行态渲染
    `.pt-textarea-foot` 底栏（左 accessory / 右字数同轨）；iconOnly FilePicker 在 accessory
    槽内是 quiet ghost（深色 scrim 变体仍只用于头像/封面图像覆盖物），已选数量以
    `.pt-textarea-accessory-count` 跟在图标后，9/9 禁用保留。
  - **两面同构**：mobile `ComposerSheet` 与 shared `MomentsFeature.ComposeDialog` 删除独立
    FilePicker 行（`.ma-composer-sheet .pt-file-button` 覆盖样式、`.sk-compose-toolbar`
    一并删除）；desktop 输入框补 characterCount（0/280 与手机一致）。
  - **门禁**：check-layout composer 段断言 foot 内存在 image input + 字数、图标/字数同一
    水平轨道且对齐 textarea 文本左右缘、`.ma-composer-sheet > .pt-file-picker` 独立 pill
    缺席；boards 套件新增 `mobile-moment-inline-attach`、north-star 套件新增
    `moments-compose-inline-attach`（含独立工具栏缺席断言）。变异验证：产品代码移除
    accessory 后包级门禁三视口与 boards 注册场景均判失败，恢复转 OBSERVED。
- 52 手机评论 composer 渐进披露（成文即 §4 第 10 条）：
  - **缺陷**：每张动态卡默认渲染空「写评论……」输入行，即使 0 评论也占纵向空间（用户：
    「不点就不显示」）。评论列表默认展开的信任语法保留，空输入行改为点击评论动作后才出现
    并自动聚焦，再点收起；发送后 composer 保持打开以便连续回复。
  - 平台差异：桌面宽画布保留「列表默认展开 + 可直接回复」（north-star 门禁固化），手机
    窄屏走渐进披露，属语法允许的介质差异而非分叉。
  - **门禁**：check-layout 新增默认 `.ma-comment-input` 计数为 0、点击该卡评论动作后出现
    且为 activeElement；boards 套件新增 `mobile-comment-tap-to-reveal`，既有
    `mobile-inline-comments` 补「先点评论再输入」操作。变异验证（composer 默认 true）门禁
    三视口全部失败，恢复转绿。
- 53 消息头 Segmented track 贴合内容（与动态面同构）：
  - **缺陷**：`.ma-rail-tabs{flex:1}` + `.ma-chat-subnav{width:100%}` 让消息/联系人两段
    平分整条宽 track（274px 容器装 156px 内容），subtle wash 成为过宽空条；动态面
    `.ma-scope-island` 是 `flex:0 1 auto` 贴合内容。改为容器贴合 + track `width:auto`
    （实测 160px，余量 10px），右侧空间留给搜索/＋图标砖，两面头部同构。
  - **门禁**：check-layout chat-list 段新增内容贴合断言（track 宽 − 按钮 content 宽总宽
    − gap/track padding ≤ 16px；注意判据是「内容所需宽」而非 track 内空白——按钮被 flex
    平分撑宽时 track 内无空白但仍过宽）。双点变异（flex:1+width:100%）三视口全部失败，
    单点变异不触发（两条件叠加才构成缺陷），恢复转绿。
- 54 回到上方按钮改为 flat 图标砖（成文即 §4 第 3 条补充）：
  - **缺陷**：下滑动态流后出现的回顶钮是白底 + 描边 + 静息阴影的独立 36px 方块（SaaS FAB
    语言），悬在 flat 内容流上，与「发丝分隔、静息无阴影、quiet 图标砖承载动作」的手机面
    哲学冲突（用户红框：「这边框也不是我们的哲学」）。
  - 改为 `emphasis=quiet` + `.pt-button.ma-feed-top`（提特异性压过库 quiet 规则）：
    不透明 `--pt-surface`（实体填充遮挡滚动穿过的卡片文字）、`border:0`、`box-shadow:none`、
    次级墨图标、hover `--pt-subtle` wash；与头部搜索/＋图标砖同语系。桌面宽画布的胶囊
    （container 带阴影、内部图标无框）形态不照搬。
  - **门禁**：check-layout moments 段滚动流后断言回顶砖 36px、border-top-width=0、
    box-shadow=none、背景 alpha≥.99；boards 套件新增 `mobile-back-to-top-flat-tile`
    （scroll 600 后 exists + computedStyle 双断言）。变异验证（描边+阴影+透明底）三视口
    `back-to-top-framed` 全失败，恢复转绿。
  - **操作事故与恢复**：变异回滚时误用 `git checkout -- mobile-app.css`，把含全部未提交
    改动的文件回退到 HEAD（439 行旧版）。恢复路径：Trae Local History 快照（昨晚
    21:38，538 行）已落后于当天工作；最终以当天 02:28 的 vite 构建产物
    dist/assets/index-*.css 为真相源，用 postcss 按文档序提取全部 ma-* 规则 + ma- 前缀
    keyframes/media 重建（253 节点），与构建产物做规范化规则 diff 验证 0 增 0 缺（仅
    segmented 两处有意差异），全套门禁转绿。教训：**对含未提交改动的文件，回滚变异只能用
    受控字符串替换，禁止 git checkout/restore**；构建产物是未提交工作的可取证快照。
- 55 头部主次分区修正：主在前、次靠右（成文即 §1 搜索就地展开条内「主在前，次靠右」段）：
  - **缺陷与自我回归**：增量 53 修「track 过宽」时只把容器改成 `flex:0 1 auto`、track
    `width:auto`，但保留了 Segmented 的 `fullWidth`（库规则使内部钮 `flex:1;min-width:0`），
    又没有补上弹性余量——结果两个钮在窄 track 内被平分收缩，「联系人」压成「联系/人」两行，
    且搜索/＋ 砖不再贴右缘。单看一个症状修布局必然制造另一个症状。
  - **结构模型**（两个 header 同一）：主 segmented `flex:0 0 auto` + track `width:auto` +
    内部钮 `flex:0 0 auto` + label nowrap（永不收缩换行）；主组 `margin-right:auto` 吸收
    全部余量（动态面等价物是搜索 tile 的 `margin-left:auto`）；搜索/＋ 固定 36px 砖贴 header
    内容右缘。动态面聚焦展开的搜索框是行内唯一让步元素
    （`:focus-within{flex:0 1 auto;min-width:0}`），压力由它吸收，主标签不动。JSX 移除
    `fullWidth`（主分组没有「平分」语义）。
  - **门禁**：check-layout chat-list 与 moments 两段各断言三件事——选项 content 高 ≤26px
    （无换行）、track 宽贴合内容（余量 ≤16px）、＋ 砖右缘 = 容器右缘 − paddingRight（±2px）。
    三态变异全部复现并被拦：A `flex:1+width:100%`→segmented-track-stretched；
    B 内部钮 `flex:1 1 0%;min-width:0`→segmented-label-wrapped；C 去掉 auto 余量→
    tool-tile-not-right-aligned（两面同时报）。注册套件 mobile-product-default /
    search-morph-inplace / moment-publish OBSERVED 回归通过。
- 56 手机消息动作体系全量对齐桌面（成文即 §4 第 11 条）：
  - **缺陷**：手机线程消息右侧是无动作的空白区，桌面 hover 有完整 MessageActionBar
    （反应/在话题中回复/回复/转发/复制/多选/置顶/稍后处理/编辑/撤回/举报/管理/仅对我隐藏），
    手机面只有阅读能力，跨面词汇表断裂。
  - **SSOT 复用，不造第二份**：动作目录/分组/归属/可用性与反应目录、reaction 状态合同
    全部直接复用在役 `shared/chat-domain/`（`MESSAGE_ACTION_CATALOG`、`messageActionGroups`、
    `QUICK_REACTION_KINDS`、`applyViewerReaction`）；手机只写介质容器 `MessageActionSheet`
    （长按 BottomSheet：8 快捷反应 + 全部 16、回复/转发 quick row、分组长动作、divider、
    禁用中文原因）与闭环（ForwardSheet/ThreadReplySheet/ReportSheet/多选批量条/置顶 banner/
    编辑回填/撤回居中服务提示/隐藏确认/toast）。桌面 hover 条 ↔ 手机长按 sheet 是容器介质
    差异，词汇与裁决同源。
  - **门禁健壮性教训**：门禁在等待「被修复行为的产物」时，若该产物因变异缺席，Playwright
    自动等待会硬等 30s 后抛未捕获 TimeoutError，使整个门禁进程崩溃（变异验证反而无法判红）。
    规则：点击/操作门禁产物前先 `count()` 守卫，缺席即 record defect 并跳过后续操作，
    让变异态输出命名缺陷（reaction-chip-missing ×2/视口）且进程正常非零退出。
  - **门禁**：check-layout thread 段新增 4 条记录（peer 动作表归属与 6 长动作、reaction
    toggle/untoggle、引用条→发送→引用块→条清除、自己新消息置顶/编辑/撤回且无举报、窗口内
    可用）；evaluate runner 新增真实手势 op `longPress`（hover + 按住 520ms + 松开，非合成
    事件），boards 套件新增四个 `mobile-msg-*` 场景（含 mid-operation expect 闭环）。
    双变异验证：react reducer no-op 下包级门禁三视口判红且不崩溃；长按阈值 420→2000ms
    下四个注册场景全部判红（sheet 缺席链式失败）；恢复后 check-layout 0 defects、
    四场景 OBSERVED、north-star 167/167 OBSERVED。
  - **顺带修复的库级缺陷（quiet danger 描边盒）**：`styles.css` 中
    `.pt-button[data-tone=danger]{…border-color:var(--pt-danger)}` 与 quiet 规则
    特异性相同（0,2,0）且在其后，导致 quiet/inline 危险钮静息态被强染红描边盒
    （hover 态反而透明，自相矛盾），禁用 quiet 行同理被画上灰边灰底——与增量 30
    「菜单行静息必须扁平」冲突，手机长按表「仅对我隐藏」实测出现红框。库级修复：
    danger 恒定染红文字/图标，红边框只给 `:not(quiet):not(inline)` 的有框钮；
    禁用 quiet/inline 行透明底/透明边只留灰字。secondary danger（退出登录等）与
    primary danger（实心确认钮）语义不变；桌面全部 167 场景回归无影响。
    check-layout 新增 `.ma-sheet-row.is-danger` 四边 border-color 透明断言，
    boards peer 场景新增 border 透明 + 红字令牌（north-star 候选主题 danger
    =`#c0392f`，与默认主题 `#c63939` 不同，oracle 必须按作用域实测取值）双断言；
    回退该库规则即判红，恢复转 OBSERVED。
- 57 手机「我的」页三层重设计——身份 Hero / 凭证降级 / inset 白卡组（成文即 §4 第 12 条）：
  - **缺陷**：旧页是「横排头像 + meta」紧接一张通栏发丝线字段表（首选用户名/所属站点/
    PTID），技术标识 PTID 长串与名字同权重裸露首屏，无品牌 Hero，分组是跨整页的发丝线
    而非留白分层。用户拍板：植物意象 cover + 凭证收二级页。
  - **三层结构**：① 身份 Hero——cover 全宽出血 134px，复用 shared `artwork()`
    （新增导出 `VIEWER_COVER`：MINT 松绿渐变 + 枝叶 glyph），不自造插画；68px 头像以
    -34px 负 margin 交叠 cover 下沿，`0 0 0 3px var(--pt-surface)` 白环在图/纸交界处
    切割；换头像 FilePicker iconOnly 收进头像右下 24px 角标；名字/本机 Tag/`@linye ·
    松绿书屋站`/stats+加入时间。② 凭证——首屏只留「账号与凭证」一个 inset 入口行，
    推送二级页 `CredentialsScreen` 才承载用户名/PTID（复制）/站点。③ 偏好/网络/通用
    ListSection `inset` 白卡（`.ma-root` 注入 `--pt-list-well=surface/border/lg`，
    组间 14px 留白，发丝线只留在卡内）+ 独立白卡危险区（退出登录 quiet danger 行，
    直接吃增量 56 的库级扁平修复）。AI/MCP/渠道/日志/统计等生产运维项不进触摸消费端。
  - **门禁教训一（否定文本需要对偶 oracle）**：隐私降级断言是「首屏任何位置都不得含
    PTID 文本」，`missing [data-credential]` 选择器只能证明该组件没渲染，管不住文本从
    别的节点（如入口行 description）泄漏——变异把 PTID 塞进 description 后选择器门禁
    漏判。给 evaluate runner 补 `textNotContains` oracle（与 `textContains` 对偶，
    容器文本否定），隐私/裁剪类断言一律走容器文本否定。
  - **门禁教训二（record 不得聚合互不相关的失败点）**：`record(name, defects.length===0)`
    只上报 `defects[0]`；一个 measure 里串了 cover/头像/PTID/well/危险区五类断言时，
    well 令牌变灰探针其实判中了 `inset-well-not-white`，却被同 record 更早的头像交叠
    缺陷遮蔽，汇总不可见、变异验证一度误判「没拦住」（完整列表只在 captures.json 的
    `details.*.defects`，取证时才定位）。规则：互不相关的失败点拆成独立 record；
    me 段拆为八个（cover/avatar/facts/home-privacy/inset-wells/danger-zone/
    credentials-push/home-after-back），每个 measure 独立查询、缺失即独立失败。
  - **门禁与变异**：check-layout me 段八 record + boards `mobile-me-profile`（重写，
    原「首屏含 PTID」断言反转为 textNotContains，新增 cover/交叠头像/inset 计数/
    危险区扁平）与新增 `mobile-credentials-page`。四点变异双门禁全部判红后恢复：
    PTID 漏入入口 description（包级 `ptid-leaked` ×3 视口 + boards
    `ptid-off-first-screen`）、cover 钩子失效（`hero-cover-missing` + boards
    `hero-cover`）、头像 margin 归零（`hero-avatar-not-overlapping` ×3）、
    `--pt-list-well` 退回 subtle（`inset-well-not-white:rgb(246,247,246)` ×3）。
    恢复后 check-layout 0 defects、boards 29/29 OBSERVED（仅存量 elements 板桌面
    溢出红）、north-star 167/167 OBSERVED、tsc/build/boundary/long-list/residual 全过。
  - **沉浸式 cover（灵动岛白带修复）**：首版 cover 高 134、在 `.ma-body` 内，状态栏是
    `.ma-root` 固定占位 54px 透明层，导致灵动岛所在顶部条带透出纸灰 canvas（近白带），
    品牌图从状态栏下方才开始。改为 cover 高 188（134 可视带向上 +54 状态栏区，底缘接缝
    y 不变，头像/角标零位移），宿主按 `route.tab=me && !route.setting` 挂 `data-immersive`，
    该页状态栏 `position:absolute` 浮起、`.ma-body` 自动上移占满，图延伸到灵动岛后，黑字/
    黑岛在浅绿上可读，tabbar 不动；切 tab 状态栏恢复常规流。
  - **作用域教训（浮起状态栏不得命中二级页）**：第一版用 `[data-tab="me"]` 做选择器，me
    推送的凭证/站点/关于 DetailPage 也命中——它们有自己的 MobileNavBar，状态栏浮起后
    返回钮被 z-index:12 的浮层遮挡（Playwright「resolved but not visible」30s 超时）。
    规则：改变顶层 chrome 占位的标记必须精确到**落地页**而不是 tab；沉浸式用独立
    `data-immersive`（仅无 setting 的 me 首页），二级页断言状态栏保持 relative。
  - **门禁与变异**：me 段新增/拆分到九个独立 record（再吃一次增量 57 教训二：cover 高度与
    「顶对齐状态栏」「状态栏浮起」是三个独立失败点，同 record 聚合时 `defects[0]` 互相遮蔽，
    必须拆 record）；boards 加 `hero-cover-immersive`(absolute)/`root-immersive-marker`/
    `hero-cover-height=188`，凭证页加 `detail-statusbar-in-flow`(relative)/
    `no-immersive-on-detail`，默认消息页加 `statusbar-in-flow-on-chats`。变异：① 完整回退
    （删浮起规则 + cover 134）三视口报 height+not-under-statusbar；② 只失效浮起选择器
    （cover 仍 188）三视口报 not-under-statusbar + not-floating、height 不误伤。恢复后
    check-layout 0 defects、boards 29/29、north-star 167/167。
  - **封面可换补齐（与头像对称）**：首版只给头像接缝角标加了 FilePicker，漏了 cover 编辑
    入口——身份图由「背景 + 头像」两部分构成，两者都必须可换。补 cover 右下角深色 scrim
    铅笔（`.ma-hero-cover-action`：30px 圆、rgba(19,22,21,.42)+blur(8)、白铅笔，右 14 下 12，
    避开灵动岛与头像交叠区；图片覆盖物用深色 scrim 是 iconOnly FilePicker 的正确变体，头像
    在纸/图交界仍用浅色 chip），`readImage(setter)` 工厂同时服务封面与头像。check-layout
    me-hero-cover record 断言 cover 内存在 `input[type=file][accept=image/*]` 且命中框完全
    落在 cover 内，boards 加 cover/avatar 两个 change-action exists；临时移除 cover picker
    三视口报 `cover-change-action-missing`，恢复转绿，且真实 setInputFiles 后背景切换为
    dataURL 已取证。
  - **编辑膏药反模式 → 整图点按/意图浮现（supersedes 上一条的角标/scrim 圆钮）**：右下角深色
    圆钮 + 头像接缝浅圆钮两块常驻 chrome 被评审判为「狗皮膏药」——在品牌封面图上贴两个割裂
    的形状，位置（右下/接缝）和风格（实心圆 vs 玻璃圆）都不对。desktop `SelfCardPopover`
    的既有语法是身份展示面干净、编辑藏在意图之后；据此改为：封面与头像的 FilePicker label
    绝对铺满整幅图（cover `inset:0`、头像 68×68 + radius 18），**静息态零 chrome**（按钮与
    `::before` scrim opacity 全 0），只在 `:hover/:active/:focus-within` 整面浮现墨 34–42%
    scrim + 居中相机（封面带「更换封面」玻璃胶囊，头像仅 22px 相机），离开即隐，带
    reduced-motion 降级；图标从 edit 铅笔换为 `camera`（语义=换照片）。触摸端点按直接唤起
    系统选图（按压瞬间 scrim 反馈），可发现性由整图可点 + AT 名承担。删除 `.ma-hero-cover-
    action`/`.ma-hero-avatar-action` 两套膏药 CSS 与接缝角标门禁。门禁拆为三个独立 record：
    `me-hero-cover`/`me-hero-avatar`（picker 铺满、accept、几何）、`me-image-edit-quiet-rest`
    （静息 opacity=0、scrim=0、legacy 类必须不存在）、`me-image-edit-reveal`（hover 后按钮与
    scrim opacity=1）；boards cover/avatar 选择器改 `> .pt-file-picker input` 并新增
    `no-legacy-edit-badge` missing。两点变异：静息 opacity 0→1 三视口报
    `cover-edit-chrome-visible-at-rest`；hover 浮现 opacity 1→0 报
    `cover-edit-not-revealed-on-hover`（scrim 探针独立不误伤）。恢复后 0 defects、boards
    29/29、north-star 167/167。教训：**可编辑图像的 affordance 应是整图热区 + 意图态浮现，
    不是在图上常驻一个角标形状**；静息干净度必须有独立探针，否则功能在（能点）但视觉污染
    无人拦。
  - **跨端对称裁决（supersedes 上一条「整图点按/居中相机」）**：评审指出手机端自创的整图
    scrim + 居中相机胶囊违反对称原则——desktop 设置›身份（`AccountSection.tsx` 的
    `.sk-banner-action` / `.sk-identity-avatar-action`，`settings.css:198-238`）的 SSOT 是：
    封面与头像用**同一个** `FilePicker iconOnly iconId=edit`（库 `.pt-file-picker[data-icon-only]`
    默认 30px、radius-md、`#000 34%` 深 scrim、白铅笔），分别钉在右下角（banner right:12/
    bottom:12；avatar right:6/bottom:6 收在头像内角），hover 设备静息隐藏、悬停淡入，
    `@media(hover:none)` 触摸设备常驻。手机回退到该 SSOT：删除整面 `inset:0` 覆盖层、
    `::before` scrim、居中相机和 reduced-motion 块，图标 camera→edit，仅用
    `.ma-hero-cover-action`/`.ma-hero-avatar-action` 两个定位 span 承载库默认钮。早期「膏药」
    的真正病根不是有角标，而是两钮风格分叉（封面深色圆 vs 头像接缝白色圆）且头像钮飘在接缝
    中央；同构 + 内角定位后两钮一致、各自归属明确。门禁改为：封面/头像 action 的右下几何
    （±3px）、`icon-only` 同构（两钮 computed backgroundColor/borderRadius 相等、30px）、
    `:scope > .pt-file-picker` 整面覆盖回归探针（`*-fullbleed-picker-regression`）；boards
    选择器回到 action span 并加 `data-icon-only=true` 与 no-fullbleed 断言。两点变异：
    封面 right 12→40 三视口报 `cover-action-not-bottom-right`；头像钮 `!important` 强制白底
    报 `edit-chip-bg-diverged`（普通特异性规则被库 (0,3,0) 顶回，说明库本身也在保护同构）。
    教训：**跨端共享同一身份编辑词汇表，介质差异只允许 hover 显隐，不允许换组件/换位置/换
    图标**；评审给的 desktop 截图优先级高于本端自创的「更安静」方案。
- 58 手机外呼通话角色语法对齐桌面——主叫侧移除「接听」，自动接通 + 取消/挂断（成文即 §4 第 13 条）：
  - **缺陷**：手机 `CallScreen` 在 outgoing（「正在呼叫…」）渲染绿色「接听」+ 红色「挂断」两枚钮，
    而手机状态机根本没有 incoming 态（只有 idle/outgoing/active），`call/accept` 仅本地把 outgoing
    翻成 active——把「模拟对方接听」这个信令事件错误地做成主叫按钮。「接听」是被叫动作，主叫无法
    接听自己拨出的电话，违反对称原则与 iOS call-kit 语法；桌面 `CallOverlay` 从无此钮（外呼定时器
    自动 ringing→connecting→active，绿色接听只在 incoming 居中弹窗，外呼 HUD 非 active 时单钮 label
    是「取消」）。
  - **状态机修正（补全相位，非补丁）**：`CallState` 增加 `connecting`；新增 action `call/connect`
    （outgoing→connecting），`call/accept` 守卫由 outgoing 改为 connecting→active，语义归位为
    「被叫接听」信令、改由定时器驱动且无 UI 入口。`CallScreen` 加与桌面同参的 RING_MS=1600/
    CONNECT_MS=900 定时器，connecting 文案「正在接通…」；接通前控制区只留一枚红色 phone-off、
    label「取消」（call/end 回 idle），active 才渲染静音/摄像头/「挂断」。删除 accept 绿钮、`accept`
    prop 与 `.ma-call-btn.is-accept` 死规则。取消时定时器 cleanup 叠加 reducer 状态守卫，迟到跳转 no-op。
  - **门禁与变异**：check-call-states 改为 outgoing 立即断言「接听」钮 count==0 且控件 label 恰为
    `["取消"]`，再零点击 waitFor connecting→active（自动接通的证据），取消流程改点「取消」；boards
    `mobile-call-lifecycle` 删 `ma.call.phone` 接听点击、改 `waitFor active`，新增 `no-caller-accept-tile`
    missing oracle。变异：把「接听」钮塞回 preActive 控制区，门禁在「must not expose an accept tile」
    断言判红；回滚后转绿。回归：check-call-states 通过、check-layout 0 defects、boundary/long-list/
    residual 通过、boards 29 场景 OBSERVED（仅存量 elements 板桌面 nb-token-code 溢出红）、north-star
    全 OBSERVED、tsc/vite build 通过。
- 59 登录不是一张自造表单，是 Station 下发的 AccessDecision 状态机（首启门禁真机对齐）：
  - **缺陷**：Owner 质问「少了什么」，重读真机后确认原型首启门禁整体是假的——一个「本机身份 +
    通行密钥」表单，点「登录并继续」即无条件翻牌。真机选定 Station 后经历 launch 十态中的
    station-handshake → access-gate-chain，进入应用的唯一条件是 decision=GRANTED；gate 有十种类型，
    登录凭据由 Station 通过 `alternativeActions` 精确广告（`auth.password/submit_login`、
    `auth.oauth/start_oauth`），schema 字段由 Station 的 `input_schema_json` 下发，邀请码错误在原 gate
    内联报错（不切页面），device-trust 没有交互分支只能 unavailable。自造表单把这些合同全部抹掉。
  - **合同镜像（补状态机，非补皮肤）**：新增纯模块 `accessGate.ts`，proto 常量（gate type/decision
    state 原值）、判定函数（currentAccessGate/isLoginGate/isInviteCodeGate/isSchemaDrivenGate/
    advertisedCredentialChoices/parseGateFields/hasSchemaValue）、提交迁移（invite/login/schema）与真机
    `authSession.ts` 逐一同构；fixture 只模拟 RPC 结果（Station 绑定 gateProfile），合同不模拟。
    渲染器 `AccessGateView.tsx` 严格按真机分支顺序：recovery-only → invite → schema → login（广告驱动
    quick/email tab）→ unavailable。准入围栏收进 reducer：只有 submit 结果 granted（或扫码 device-link）
    才能 `signedOut=false`，旧的无条件 `auth/signIn` 删除。
  - **固化规则**：
    - **入口对齐先读完整调用链再动手**：onContinue → verifyStationEntryRuntime → startStationAccessAttempt
      → accessStart/accessSubmit → isAccessGranted 才 reconcileShellAdmission。少读任何一环都会重新造错。
    - **客户端只投影 Station 广告的能力**：login-full/email-only/oauth-only 三个 fixture 分别证明
      「没广告的 OAuth/邮箱一律不渲染」；用「两个都画」试探针即红。
    - **提交失败保留 decision**：真机 catch 只 setAuthError，不替换 decision；错误码是内联 Alert，
      recovery-only 面只属于 Station 级 BLOCKED/FAILED/PENDING。首次实现错误地把失败提交转成 FAILED
      decision，导致整个面切成 recovery——用邀请码拒绝探针抓回。
    - **证据场景的定时器必须冻结**：OAuth 相位机只跟随「用户主动启动」的流程（oauthStarted 标志 +
      reducer 双围栏）；深链场景预置的 awaiting_provider 相位跨完整定时器窗口不得漂移，否则证据面
      自我推进、无法检查。
    - **恢复态不与副标题重复**：recovery/unavailable 的具体文案只出现一次（提示框），泛化登录副标题
      在这些面压制；L2 截图必须实际查看，重复文案只有看图能发现。
  - **门禁与变异**：check-layout 新增 20+ 独立 record（handshake 挂载、tabbar 不穿透、canLogin 空禁用/
    填齐启用、GRANTED 才进 shell、凭据广告、邀请码拒绝停留/演示码推进链、schema required、unavailable
    零输入、recovery 三态零提交控件、session-expired、login-failed、OAuth 相位/取消/冻结）。
    9 项变异逐项验证能拦后恢复。boards signout finalizer 改写完整门禁链；另修复上轮双叉收敛遗留的
    过期 finalizer（`取消搜索` 文字钮选择器）。14 个 gate-* 场景 1:1 对齐真机 entry fixture 词汇。
    回归：check-layout 三视图口 0 defects、boundary/long-list/call/residual 通过、boards 29 OBSERVED/
    0 ERROR（仅存量桌面 nb-token-code 溢出 VIOLATED）、tsc/vite build 通过。
- 60 消息反应展开态必须是整除列数的 grid，功能钮不占数据格：
  - **缺陷**：长按消息的操作 sheet 展开后，16 个反应 + 1 个收起钮共 17 个固定 38px 元素用
    `flex-wrap` 排，每行容 9 个，落位成 9+8，两行右缘参差、列不对齐；而 composer 表情面板是
    整齐的 8 列 grid。同一 App 两套表情网格语言。根因是把「功能切换钮」当成数据流里的一个格子。
  - **修正（容器层，不动数据）**：反应区包一层 `.ma-react-head`；收起态横滑快选行（8 个）+
    右侧固定展开钮；展开态 head 转纵向，反应条改 `grid repeat(8,1fr)`，16 个严格 2×8、两行列缘
    重合、等宽；收起/展开钮移出反应条，展开态落到网格下方右对齐、透明底（不冒充表情）。
  - **固化规则**：
    - **N 个数据项 + 1 个功能钮，绝不共享同一个 wrap 流**：数据按固定列数 grid 整除换行，
      功能切换钮放容器层独立位置，否则行列数随宽度漂移、必然参差。
    - **同一产品的同类网格共用列数语法**：反应展开态与 composer 调色板同为 8 列。
    - **对齐探针测两行列缘，不只数总数**：断言两行各 8 格且逐列 left 坐标重合 + 等宽；
      仅断言 count==16 抓不到错位。
  - **门禁与变异**：新增 `msg-react-expanded-grid`（toggle 不占 strip、2 行 ×8、列缘重合、等宽）；
    变异把展开态改回 flex-wrap 即报 `reaction-rows:16`（width:100% 使每格独占一行），恢复转绿。
    收起态探针仍守 8 个快选。回归：check-layout 三视图口 0 defects、long-list/call/residual、
    boundary、tsc/build 通过，boards 29 OBSERVED（三个动作 sheet 场景全 OBSERVED）、
    north-star 167 OBSERVED。
- 61 全屏覆盖层禁用 `justify-content:space-between`——三段（顶/中区/底）必须显式 flex band（全盘 mobile 视觉审计）：
  - **缺陷**：Owner 圈出通话面挂断红圆被屏幕底缘裁掉一半、静音 caption「静音」只剩半截。根因是 `.ma-call`
    用 `flex-direction:column + justify-content:space-between` 让 trust/avatar/copy/controls 四项均分，
    controls 被推到容器底边，叠加 30px 底部 padding 不足，图标/caption 出血。
  - **修正**：覆盖层改为三段显式结构——trust `flex:0 0 auto` 贴状态栏，avatar+copy 包进一个
    `flex:1 1 auto; min-height:0` 的居中中区，controls `flex:0 0 auto` 贴底且底部留 56px 安全区；
    JSX 把头像与名字移入同一中区容器。图标 64px、caption 与图标成组（`.ma-call-btn` column）。
  - **固化规则**：
    - **全屏覆盖层（通话/扫码/引导）永远不要 space-between 推控件**：用「固定顶 band + flex 中区 +
      固定底 band」三段，底部 band 自带 safe-area padding，否则内容高度一变控件就出血。
    - **出血探针要测每个 tile 含 caption 距设备屏底的距离**，不能只测覆盖层矩形 contained——
      覆盖层铺满屏幕时 contained 恒真，抓不到内部控件被裁。
  - **审计方法纠偏**：standalone 3108 在 844 视口下设备框（800px+workbench chrome）会超出视口，
    截图底部被浏览器裁，易误判为产品 bug；须用能容纳整设备的视口（430×1000）或 Portal 嵌入态截图，
    以 `.mp-device-screen` 底边为参照量 gap，而不是浏览器 viewport。
  - **门禁与变异**：check-call-states 增强为逐 tile 断言 `iconBottomGap≥24 / labelBottomGap≥8`；
    变异把底部 padding 改 0 即报 `labelBottomGap:0`，恢复转绿。回归：check-layout 三视图口 0 defects、
    call/long-list/residual、boundary、tsc/build 通过。
  - **另记**：审计中一度把 Me 头像右下角编辑笔当成缺陷改成外缘小钮，触发既有
    `avatar-action-outside-avatar` 探针——该 chip 在头像内 right:6/bottom:6、30px、与封面 chip 同构
    是增量 57 锁定的合同，非本次范围，立即回退。教训：全盘审计要先读既有探针锁了什么，
    被探针固化的视觉就是已接受合同，不能凭单张截图当 bug 改。
- 62 mobile composer 必须与 desktop 同一框式解剖，浮层尺寸由网格推导，禁止写死/私加控件：
  - **缺陷（用户四点逐条核对）**：① 输入框自己描边、工具在框外，读成「剪贴」出来的第二个盒子，
    不像 desktop `.sk-composer` 一个圆角 tile 装下全部；② 工具顺序/成员漂移，且一度私加了 scissors
    截图钮（用户明确「不用剪贴」）；③ 文件入口应是「一个文件夹钮 → 选择文件／照相」两项菜单，
    而不是多个并列入口；④ 表情浮窗 `width:304px;max-height:264px` 是上轮从 desktop 312 拍脑袋缩来的
    写死值，不跟随网格/屏宽——用户直接质问「这个比例原理是什么，还是随机的」。根因：把 mobile 当成
    独立皮肤重排，没有从 desktop `.sk-composer` 的解剖（唯一圆角宿主 + 去框内嵌 FieldFrame +
    auto-grow TextArea + 右下 squircle 发送）推导。
  - **修正（对齐 desktop 合同，不私造）**：`.ma-composer` 改为单一圆角 tile（pt-subtle 底、16 圆角、
    `:focus-within` primary ring），表情/文件/语音/展开/发送全部为其后代；内嵌 `framing="embedded"`
    FieldFrame 去掉自身 border/background/padding，唯一框边归宿主；TextField 换 TextArea，复刻 desktop
    的 auto-grow（minRows/maxRows 在展开时同时抬高，空框也明显变高）；工具与展开钮用库级
    `density="compact"` 收窄（token 驱动，非硬压像素），发送保留 36px squircle。删除 scissors。
    文件改为单个文件夹钮 + Menu（`选择文件`/`照相`，两个原生 input：multiple 无 accept + image capture）。
    VoicePlayer 是共享 desktop 组件、渲染 `.sk-voice*`，mobile 只加载本表，故在 `.ma-voice-draft`/
    `.ma-voice-bubble` 作用域补齐 mobile 版语音样式（录音/预览/播放/进度/时长）。
  - **固化规则**：
    - **跨端同一组件解剖，不重排只换 token**：desktop 用一个圆角宿主拥有唯一框边时，mobile 必须同构，
      不能让输入框自己描边形成第二个盒子；工具是宿主后代，用「后代包含」探针锁死，漂出框即红。
    - **浮层宽高必须能从内容网格推导，禁止孤立像素**：表情面板宽 = `列数×cell + (列数-1)×gap +
      两侧 padding`（8×32+7×2+2×10=290），高度贴合内容并用 `52vh` 封顶，仅窄屏用 `100vw-24px` 兜底。
      探针直接用 grid 的 computed 列数/cell/gap/padding 反算期望宽比对，写死 304 立即报
      `emoji-panel-width-undriven:304!=290`。
    - **flex 链上的 inline 包装要显式 blockify**：`.ma-composer-input-wrap` 是 `<span>`，不写
      `display:flex` 时其 `flex:1` 被忽略，内嵌框塌成内容宽（实测 148px）；要么用 div，要么显式 flex。
    - **窄屏五控件挤占输入区时，用库密度档收窄工具钮、保发送主钮，不靠魔数 gap**；紧凑后输入列仍 ≥180px。
  - **门禁与变异**：check-layout `composer` 改为框式合同（五控件都是 `.ma-composer` 后代、
    `screenshot-present` 永红、须为 textarea、输入列 ≥180、空态发送禁用）；新增 `composer-attach-menu`
    （两项、id `ma.attach.choose/camera`、文案「选择文件/照相」）；表情面板加宽度反算断言。
    变异三项（回加 scissors、面板写死 304、照相改旧文案）分别报 screenshot-present /
    emoji-panel-width-undriven:304!=290 / attach-labels-wrong，恢复转绿。回归：check-layout 三视图口
    0 defects、call/long-list/residual、tsc/vite build 通过，boards 29 场景全 OBSERVED（仅存量桌面
    nb-token-code 溢出基线红，与本次无关）、north-star 167 OBSERVED。真机 430×1000 截图四态目检：
    框式静息/表情浮窗包裹网格/文件菜单/展开 auto-grow。注：录音真实 MediaRecorder 在 headless 无麦，
    仅 UI 态与 DOM 合同可验，真实录音待有麦环境。
