# 全组件逐项规范入口

> DRAFT。这里补全的是设计合同；实现仍 NOT_IMPLEMENTED，交互打样仍 NOT_BUILT。新增行为、字段、默认值、数值均为待审阅提案，不把上游类型或已有 Skill 当作已验证产品行为。

[全量合同审定与结构化模型](../contract-review/README.md)提供主线依据、冲突处置和可执行边界。阅读本稿时保留 active 语义优先：危险动作不采用纯图标，动效默认沿主线 token；未接受的字段与场景不能直接当成生产 API 或业务协议。

100 个来源族与 34 个补充需求，逐项映射至 130 份能力合同。四组同能力名称共用合同：Provider/ConfigProvider、MaterialFileTypeIcon/FileTypeIcon、ScrollShadow/MaskShadow、Stack/Flex。来源记录保留独立，不把名称归并误算成删除能力。

每项都按相同维度整理：意图与相邻选择、Anatomy、状态和命令所有权、正交轴/默认/非法组合、具体场景、状态转换/失败恢复、键盘/焦点/触摸/读屏、图形几何/动效、极端数据、生命周期清理、自有公共合同形状、正反例及必要证据。场景数量依能力复杂性决定，不为凑齐 Button 的 20 项复制空场景。

## 按任务查合同

- [动作与命令](./action.md)：Button/SplitButton、IconButton、ActionGroup、复制、下载、确认、溢出工具栏。
- [输入与选择](./input.md)：文本/数字/密码/PIN/多行、表单、自动补全、单选/多选、日期/时间、搜索、颜色、滑条、格式开关、快捷键录入、文件选择、重排、提及、Emoji、Slash Menu、富文本编辑、层级选择。
- [身份与图形](./identity.md)：真人/Agent/群头像、文件类型、Emoji Artwork、自有 Icon/BrandMark 边界。
- [反馈与结果](./feedback.md)：Alert、Badge、Empty、Guide、Progress、Result、Skeleton、Busy、Tag/FilterChip、ToastHost。
- [内容与数据](./content.md)：Link、KeyValueList、ShortcutHint、List、Markdown、Metric、DataTable、Text、Calendar、VirtualList、SecretValue。
- [布局与滚动](./layout.md)：Surface、Divider、ResizablePanel、Stack/Inline、Grid、PageHeader、PageLayout、OverflowHint、SurfaceFade、ScrollArea、Card。
- [导航与任务位置](./navigation.md)：SectionNav、Breadcrumb、NavigationToggle、可调导航栏、Pagination、NavigationRail、StepProgress、Tabs、Tree、CommandPalette。
- [展开与折叠](./disclosure.md)：Accordion 多段展开、Disclosure 单段展开。
- [浮层与窗口](./overlay.md)：ContextMenu、Menu、Popover、Tooltip、Dialog/ConfirmDialog、Drawer、Sheet、FloatingPanel。
- [媒体与预览](./media.md)：Carousel、Image/ImageViewer、HtmlPreview、QrCode、VideoPlayer、AudioPlayer。
- [代码与图描述](./code.md)：CodeBlock、CodeSnippet、CodeEditor、CodeDiff/PatchDiff、DiagramPreview。
- [环境与生命周期](./runtime.md)：UIProvider、FocusBoundary、FontAssets、RenderSuspension、MotionPolicy、ViewErrorBoundary、ThemeBootstrap/Boundary。
- [Peers 业务组合](./domain.md)：关系请求、联系人、会话、消息、Composer、附件、Viewer、Reaction、Identity、Trust、Permission、Agent任务、ToolCall、DeviceLink、Recovery、Notification、Shell、Applet、Usage、Onboarding、SettingRow。

按上游名称查 [源码全集](../component-catalog.md)，每条都有合同直达链接。[公共值逐项处置](../public-symbol-dispositions.md) 对控件、组合、Root/槽位、Provider、Portal 和平台 port 分别给出目标归属；Typography 等跨族值映射到实际语义合同。机器索引在 [component-spec-index.json](../component-spec-index.json)，保留全部来源 ID、269 个公共候选的映射、场景 ID 和独立状态。Button 的 [B01–B20](../button-spec.md) 作为详细补充一起读取。

## 共同政策与逐项特例

共同政策只负责跨组件一致的规则；具体选择和特例以每项合同为准。没有适用合同或行为含义不清，按 [OwnerGap](../skills-and-knowledge-audit.md) 提交材料；已有明确合同能裁定的工程问题由 Agent 修复，不逐个请求许可。

### 状态与恢复

- 命令控件接受 `availability` 与 `execution` 两条独立投影。`enabled/disabled-with-reason` 表示是否允许激活；`idle/pending/succeeded/failed/recovering` 表示命令进程。禁用原因必须在键盘、触摸和读屏可读路径里，不能只藏在 disabled Tooltip。
- 每次激活向已有 owner 提交真实意图。UI 可挡连点，业务幂等、授权、重放、取消和副作用继续归业务合同。提交、请求停止、动画结束均不能冒充确认终态。
- 输入拥有 draft/touched/dirty/validation；网络写入失败与字段无效分开。失败保留输入；是否重试原意图、重新提交或申请权限由具名 owner 决定。
- 被动图形、容器、文字、分隔线没有点击提交、pending命令、取消或成功状态。这些维度为 **NOT_APPLICABLE**；验证其数据变化、阅读语义和布局。图片等有资源状态，但不因此拥有业务执行状态。
- 导航维护目标和来源恢复，不以导航点击判任务完成。浮层的 open/closing/closed 是 presentation 状态；dirty 关闭、业务取消和资源释放分别裁定。
- Runtime/Provider 不发业务命令，不新增业务真源；环境缺口标明确 unsupported/degraded。Web 打样不能推断 Native 支持。

### 可访问性与输入方式

继承现有 [accessibility.md](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/docs/client/common/ui-identity/accessibility.md) 的单一焦点所有权、具名图标、可读状态、输入方式和运动政策；新增跨 renderer 字段为提案。

- 每项适用的 keyboard、pointer、touch、reader 行为都在该项定义，不能以“支持可访问性”代替具体按键和落点。
- Composite Field 由一个 FieldFrame 管 label/helper/error/focus；独立值才是独立 field。菜单、dialog、tree、tab、slider 的复合焦点规则各自定义。
- Keyboard 打开 Popover 进入内容并在关闭时恢复来源；pointer 打开不抢焦点。Modal Dialog trap focus，非模态信息面不 trap。来源已消失时回最近安全任务入口。
- 普通展示列表、布局 Grid 和 Text 不随意加交互 listbox/grid/button 语义；只在已声明的交互合同中使用这些角色。
- IME composition 未结束不能以 Enter 提交或选建议。触摸需可见替代入口，不只靠 hover、右键、长按、拖拽。

### 图标、外框与动效

[icon-motion-spec.md](../icon-motion-spec.md) 是本审阅包唯一几何/曲线提案入口，每项指定使用哪个角色和用途。没有资产路径、optical 打样或动态证据的项仍不能标精确图形已完成。

- 已有按钮视觉角色高度 24/28/30/32/34/36/40；6/8/10/12 圆角约束与圆角方形语言依现有组件文档。新的角色数值绑定、44×44 CSS 等价触摸目标是待打样提案，视觉尺寸与命中区域分开。
- Radio 选中点、Switch track/thumb、Badge 状态点、Rating glyph 属于各自语义图形，不是圆形 IconButton 的许可。
- fast/normal/slow 和标准/进入/退出曲线统一解析；拖动、滑条、resize 和文字输入直接跟手，不加缓动。减弱运动保留状态意义。
- QrCode 不沿普通 icon 曲线改 modules/quiet zone；品牌和 Emoji Artwork 有各自许可/光学规则，不强行改成线图标。

### 资源和平台生命周期

- 实体身份、数据、查询、草稿、权限、任务、资源解析/缓存由已有 owner 持有；控件只持必要 presentation 状态。具体所有权见每项。
- 组件清理自己的 observer、listener、timer、animation、pointer capture 与 display handle；不能随卸载终止共享业务任务。UI 中的 close 与业务 stop/cancel 是不同动作。
- 主题、locale、方向、motion、portal scope 与 platform ports 从同一 UIProvider 输入；不每个组件造一套全局监听和 Store。
- 全部能力当前各 renderer 状态均 **NOT_IMPLEMENTED / UNPROVEN**。`platform-capability` 只描述目标适配：OS 下载、全屏、相机、键盘、sandbox、native window 等须真实 port；没有能力时在用户承诺前给明确退化。

## 每个场景怎样打样

每个场景建立稳定 specimen ID，使用自有组件实际 renderer，绑定 contract/implementation/token/asset/platform-policy digest；显示 owner mock、输入、动作、预期可观察结果、失败恢复与 finalizer。命名角色和 schema 见 [data-model.md](../data-model.md)。

- 场景适用分支：正常、不可用及原因、等待、确认结果、typed failure、恢复、重复操作/竞争状态。非命令能力按上面的 NOT_APPLICABLE 规则测阅读、导航或资源变化。
- 基线条件：light/dark、长中文与英文、200%文字、窄视口、LTR/RTL、keyboard/pointer/touch、normal/reduced motion；关键组合需成对或专项检查，不机械生成整个笛卡尔积。
- 专项条件：每项极端数据、生命周期、非法组合逐条打样；资源/命令 mock 需能驱动逆序响应、过期、取消请求、别端已处理等该项必要分支。
- 正例证明具体场景的动作和可观察结果；反例证明明确禁止的组合会被拒绝或被评审判错。截图、动态交互、读屏/焦点、性能与资源清理证据分别记录。
- 模型与源码映射校验只能证明文档覆盖和引用一致。真实消息送达、权限批准、设备绑定、下载写盘、跨站发现等仍需对应产品 Journey 与 receiver 可见证据。

本包没有 Gallery 或真实 specimen。所有“须打样”都是要求，不能被自动转换成 BUILT/PASS。
