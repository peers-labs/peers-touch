# 组件全集与场景目录

> 状态：源码盘点 + 规范提案；SOURCE_ONLY。本文不是已实现组件的承诺。

审计 LobeUI 6.9.0 的 100 个公共来源族、269 个组件/Provider/子部件候选值。族与值不能相加当作独立控件数。另补 34 个 Peers 需求条目，其中部分是同能力的聚合、命名归并或业务组合。

上游导出和类型是源码事实；“自有能力名、使用选择、交互合同、打样要求”是提案。未直接导入只证明源码引用差异；antd 同名和本地候选均未经过产品等价验证。

所有本地 JSX 声明、所有导入位点、Button 属性和全部上游边界在 [source-audit.json](./source-audit.json)。正文每项列完整符号集合与代表路径，JSON 保留每一个路径，不用少量示例冒充全量。

## 全局打样底线

- 每个 actionable family：normal、hover、focus-visible、pressed、pending、disabled-with-reason、success、error、recovering；网络相关增加 offline/degraded。被动展示件只覆盖相关状态，标记不适用原因。
- 每个适用交互：pointer、keyboard、touch；200% 文本、中文/英文长文、LTR/RTL、light/dark、reduced motion；不能仅截图。
- 每个族的“打样场景”从本项具体选择导出，不是只渲染一个默认值。组合无效时应被类型/运行时校验拒绝，不把所有正交轴笛卡尔积机械复制。
- 真正 specimen 必须 import 自有实现；用 mock 控制业务结果；显示 implementationRef、contractDigest、状态驱动与恢复操作。当前全部 specimen 为 NOT_BUILT。

## 分类索引

- **content**：[A](#ui.family.a) · [Descriptions](#ui.family.descriptions) · [Hotkey](#ui.family.hotkey) · [List](#ui.family.list) · [Markdown](#ui.family.markdown) · [Statistic](#ui.family.statistic) · [Table](#ui.family.table) · [Text](#ui.family.text) · [CalendarView](#ui.requirement.calendarview) · [VirtualList](#ui.requirement.virtuallist) · [SecretValue](#ui.requirement.secretvalue)
- **disclosure**：[Accordion](#ui.family.accordion) · [Collapsible](#ui.family.collapsible)
- **action**：[ActionIcon](#ui.family.actionicon) · [ActionIconGroup](#ui.family.actionicongroup) · [Button](#ui.family.button) · [CopyButton](#ui.family.copybutton) · [DownloadButton](#ui.family.downloadbutton) · [ConfirmAction](#ui.requirement.confirmaction) · [OverflowToolbar](#ui.requirement.overflowtoolbar)
- **identity**：[AgentAvatar](#ui.family.agentavatar) · [Avatar](#ui.family.avatar) · [FileTypeIcon](#ui.family.filetypeicon) · [FluentEmoji](#ui.family.fluentemoji) · [GroupAvatar](#ui.family.groupavatar) · [Icon](#ui.family.icon) · [MaterialFileTypeIcon](#ui.family.materialfiletypeicon)
- **feedback**：[Alert](#ui.family.alert) · [Badge](#ui.family.badge) · [Empty](#ui.family.empty) · [GuideCard](#ui.family.guidecard) · [Progress](#ui.family.progress) · [Result](#ui.family.result) · [Skeleton](#ui.family.skeleton) · [Spin](#ui.family.spin) · [Tag](#ui.family.tag) · [Toast](#ui.family.toast)
- **navigation**：[Anchor](#ui.family.anchor) · [Breadcrumb](#ui.family.breadcrumb) · [Burger](#ui.family.burger) · [DraggableSideNav](#ui.family.draggablesidenav) · [Pagination](#ui.family.pagination) · [SideNav](#ui.family.sidenav) · [Steps](#ui.family.steps) · [Tabs](#ui.family.tabs) · [Tree](#ui.family.tree) · [CommandPalette](#ui.requirement.commandpalette)
- **input**：[AutoComplete](#ui.family.autocomplete) · [Checkbox](#ui.family.checkbox) · [ColorPicker](#ui.family.colorpicker) · [ColorSwatches](#ui.family.colorswatches) · [DatePicker](#ui.family.datepicker) · [EditableText](#ui.family.editabletext) · [EditorSlashMenu](#ui.family.editorslashmenu) · [EmojiPicker](#ui.family.emojipicker) · [Form](#ui.family.form) · [HotkeyInput](#ui.family.hotkeyinput) · [ImageSelect](#ui.family.imageselect) · [Input](#ui.family.input) · [Radio](#ui.family.radio) · [Rate](#ui.family.rate) · [SearchBar](#ui.family.searchbar) · [Segmented](#ui.family.segmented) · [Select](#ui.family.select) · [Slider](#ui.family.slider) · [SortableList](#ui.family.sortablelist) · [Switch](#ui.family.switch) · [ToggleGroup](#ui.family.togglegroup) · [Upload](#ui.family.upload) · [MentionPicker](#ui.requirement.mentionpicker) · [RichTextEditor](#ui.requirement.richtexteditor) · [TimeField](#ui.requirement.timefield) · [TreeSelect](#ui.requirement.treeselect)
- **layout**：[Block](#ui.family.block) · [Divider](#ui.family.divider) · [DraggablePanel](#ui.family.draggablepanel) · [Flex](#ui.family.flex) · [Grid](#ui.family.grid) · [Header](#ui.family.header) · [Layout](#ui.family.layout) · [MaskShadow](#ui.family.maskshadow) · [ProgressiveBlur](#ui.family.progressiveblur) · [ScrollArea](#ui.family.scrollarea) · [ScrollShadow](#ui.family.scrollshadow) · [Card](#ui.requirement.card) · [Stack](#ui.requirement.stack)
- **media**：[Carousel](#ui.family.carousel) · [HtmlPreview](#ui.family.htmlpreview) · [Image](#ui.family.image) · [QRCode](#ui.family.qrcode) · [Video](#ui.family.video) · [AudioPlayer](#ui.requirement.audioplayer)
- **code**：[CodeDiff](#ui.family.codediff) · [CodeEditor](#ui.family.codeeditor) · [Highlighter](#ui.family.highlighter) · [Mermaid](#ui.family.mermaid) · [Snippet](#ui.family.snippet)
- **runtime**：[ConfigProvider](#ui.family.configprovider) · [FocusScope](#ui.family.focusscope) · [FontLoader](#ui.family.fontloader) · [Freeze](#ui.family.freeze) · [MotionProvider](#ui.family.motionprovider) · [Provider](#ui.family.provider) · [react-error-boundary](#ui.family.react-error-boundary) · [styles](#ui.family.styles)
- **overlay**：[ContextMenu](#ui.family.contextmenu) · [Drawer](#ui.family.drawer) · [DropdownMenu](#ui.family.dropdownmenu) · [FloatingPanel](#ui.family.floatingpanel) · [FloatingSheet](#ui.family.floatingsheet) · [Modal](#ui.family.modal) · [Popover](#ui.family.popover) · [Tooltip](#ui.family.tooltip)
- **domain**：[RelationshipRequestItem](#ui.requirement.relationshiprequestitem) · [ContactItem](#ui.requirement.contactitem) · [ConversationItem](#ui.requirement.conversationitem) · [MessageBubble](#ui.requirement.messagebubble) · [MessageComposer](#ui.requirement.messagecomposer) · [AttachmentItem](#ui.requirement.attachmentitem) · [AttachmentViewer](#ui.requirement.attachmentviewer) · [ReactionChip](#ui.requirement.reactionchip) · [IdentityBlock](#ui.requirement.identityblock) · [TrustIndicator](#ui.requirement.trustindicator) · [PermissionDecision](#ui.requirement.permissiondecision) · [AgentTaskCard](#ui.requirement.agenttaskcard) · [ToolCallCard](#ui.requirement.toolcallcard) · [DeviceLinkCard](#ui.requirement.devicelinkcard) · [ConnectionRecovery](#ui.requirement.connectionrecovery) · [NotificationItem](#ui.requirement.notificationitem) · [NavigationShell](#ui.requirement.navigationshell) · [AppletTile](#ui.requirement.applettile) · [ResourceUsage](#ui.requirement.resourceusage) · [OnboardingFlow](#ui.requirement.onboardingflow) · [SettingRow](#ui.requirement.settingrow)

## 上游完整来源族

<a id="ui.family.a"></a>
### A → Link

- **逐项深度规范**：[ui.spec.a](./specs/content.md#ui.spec.a)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：跳转到真实地址或站内位置。
- **上游全部公共值**：`A`。
- **上游定义**：[A:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L1)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`A`（2 位点）。
- **LobeHub 代表调用**：[src/features/Conversation/Markdown/plugins/FileLink/Render.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Conversation/Markdown/plugins/FileLink/Render.tsx#L4) · [src/features/Conversation/Markdown/plugins/LocalFileLink/Render.tsx:5](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Conversation/Markdown/plugins/LocalFileLink/Render.tsx#L5)。
- **何时选哪种 / 打样场景**：站内详情保留返回位置；外部文档显示去向；下载另用 DownloadAction。
- **相邻选择与禁用场景**：改变状态用 Button；没有目标不能伪装链接。
- **状态、恢复与键盘合同**：Enter 导航，支持复制链接和新标签；禁用时说明原因，不能 href="#"。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.accordion"></a>
### Accordion → Accordion

- **逐项深度规范**：[ui.spec.accordion](./specs/disclosure.md#ui.spec.accordion)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：组织多段可独立展开的信息。
- **上游全部公共值**：`Accordion`、`AccordionHeader`、`AccordionItem`、`AccordionPanel`、`AccordionRoot`、`AccordionTrigger`。
- **上游定义**：[Accordion:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L2) · [AccordionHeader:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/index.ts#L3) · [AccordionItem:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/index.ts#L4) · [AccordionPanel:5](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/index.ts#L5) · [AccordionRoot:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/index.ts#L6) · [AccordionTrigger:8](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/index.ts#L8)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Accordion`（45 位点）；`AccordionHeader`（31 位点）；`AccordionItem`（31 位点）；`AccordionPanel`（30 位点）；`AccordionRoot`（18 位点）；`AccordionTrigger`（31 位点）。
- **LobeHub 代表调用**：[src/components/ChatGroupWizard/ChatGroupWizard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChatGroupWizard/ChatGroupWizard.tsx#L3) · [src/components/Error/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Error/index.tsx#L3)。
- **何时选哪种 / 打样场景**：设置帮助用单开或多开；长详情默认展开关键段；FAQ 按标题检索。
- **相邻选择与禁用场景**：一个局部区域用 Disclosure；平级页面用 Tabs。
- **状态、恢复与键盘合同**：标题包含触发器和展开状态；Enter/Space 展开，隐藏内容退出焦点序列，标题层级连续。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `AccordionVariant`：`'borderless' | 'filled' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L4)
- `AccordionIndicatorPlacement`：`'end' | 'inline' | 'start'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L5)
- `alwaysShowAction`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L29)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L31)
- `AccordionRootProps`：`Omit< ComponentProps<typeof BaseUIAccordion.Root>, 'className' | 'render' > & { className?: string; hideIndicator?: boolean; indicatorPlacement?: AccordionIndicatorPlacement; variant?: AccordionVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L36)
- `hideIndicator`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L41)
- `AccordionItemProps`：`Omit< ComponentProps<typeof BaseUIAccordion.Item>, 'className' | 'render' > & { className?: string; variant?: AccordionVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L46)
- `AccordionHeaderProps`：`Omit< ComponentProps<typeof BaseUIAccordion.Header>, 'className' | 'render' > & { className?: string; indicatorPlacement?: AccordionIndicatorPlacement; variant?: AccordionVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L54)
- `AccordionTriggerProps`：`Omit< ComponentProps<typeof BaseUIAccordion.Trigger>, 'className' | 'render' > & { className?: string; hideIndicator?: boolean; indicatorPlacement?: AccordionIndicatorPlacement; variant?: AccordionVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L63)
- `hideIndicator`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L68)
- `AccordionPanelProps`：`Omit< ComponentProps<typeof BaseUIAccordion.Panel>, 'className' | 'render' > & { className?: string; contentClassName?: string; contentStyle?: CSSProperties; hideIndicator?: boolean; indicatorPlacement?: AccordionIndicatorPlacement; variant?: AccordionVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L73)
- `hideIndicator`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L80)
- `hideIndicator`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L90)
- `keepMounted`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L93)
- `multiple`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Accordion/type.ts#L94)

<a id="ui.family.actionicon"></a>
### ActionIcon → IconButton

- **逐项深度规范**：[ui.spec.actionicon](./specs/action.md#ui.spec.actionicon)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：紧凑工具操作。
- **上游全部公共值**：`ActionIcon`。
- **上游定义**：[ActionIcon:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/index.ts#L2)。
- **Peers 直接使用**：`ActionIcon`（26 导入位点，85 JSX 位点；applet/desktop/prototype）。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ActionIcon`（417 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/AgentSidebar.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSidebar.tsx#L8) · [apps/desktop/src/components/AppSideNav.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AppSideNav.tsx#L3) · [apps/desktop/src/components/BuilderPanel.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/BuilderPanel.tsx#L3)。
- **LobeHub 代表调用**：[src/components/ImageItem/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ImageItem/index.tsx#L2) · [src/components/KeyValueEditor/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/KeyValueEditor/index.tsx#L1)。
- **何时选哪种 / 打样场景**：消息复制、行尾更多、头部搜索；高风险删除需可见名称或确认；常用动作可加 Tooltip。
- **相邻选择与禁用场景**：主要承诺用文本 Button；持久开关用 ToggleButton。
- **状态、恢复与键盘合同**：必须提供 label；悬停、键盘焦点和触摸均可发现；图形使用圆角方形。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ActionIconVariant`：`'borderless' | 'filled' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L13)
- `ActionIconOutdent`：`boolean | 'start' | 'end'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L14)
- `active`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L28)
- `danger`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L30)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L31)
- `glass`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L32)
- `icon`：`IconProps['icon'] | ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L33)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L34)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L36)
- `spin`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L38)
- `title`：`TooltipProps['title']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L40)
- `tooltipProps`：`Omit<TooltipProps, 'children' | 'title'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L41)
- `BorderlessOutdentProps`：`[V] extends ['borderless'] ? { /** * Cancels this size's icon inset (half of block − glyph) with a negative * margin so a borderless ActionIcon lines up with adjacent copy. `true` / * `'start'` outdent the start edge; `'end'` outdents the end edge. */ outdent?: ActionIconOutdent; variant?: V; } : { outdent?: never; variant?: V }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIcon/type.ts#L44)

<a id="ui.family.actionicongroup"></a>
### ActionIconGroup → ActionGroup

- **逐项深度规范**：[ui.spec.actionicongroup](./specs/action.md#ui.spec.actionicongroup)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：同一对象的相关操作集合。
- **上游全部公共值**：`ActionIconGroup`。
- **上游定义**：[ActionIconGroup:7](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L7)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ActionIconGroup`（4 位点）。
- **LobeHub 代表调用**：[src/features/Conversation/Messages/components/MessageActionBar/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Conversation/Messages/components/MessageActionBar/index.tsx#L2) · [src/routes/(main)/(create)/image/features/GenerationFeed/BatchItem.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/routes/%28main%29/%28create%29/image/features/GenerationFeed/BatchItem.tsx#L4)。
- **何时选哪种 / 打样场景**：消息复制/编辑/更多；工具栏按频率排序；窄屏转 OverflowToolbar。
- **相邻选择与禁用场景**：互斥值用 Segmented；多选工具用 ToggleGroup。
- **状态、恢复与键盘合同**：共享基线和尾轨，分组有名称；溢出后保持相同命令和焦点顺序。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ActionIconGroupEvent`：`Pick<MenuInfo, 'key' | 'keyPath' | 'domEvent'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L8)
- `actionIconProps`：`Partial<Omit<ActionIconProps, 'icon' | 'size' | 'ref'>>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L11)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L12)
- `glass`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L13)
- `horizontal`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L17)
- `menu`：`DropdownMenuProps['items']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L19)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L22)
- `size`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L23)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ActionIconGroup/type.ts#L24)

<a id="ui.family.agentavatar"></a>
### AgentAvatar → AgentAvatar

- **逐项深度规范**：[ui.spec.agentavatar](./specs/identity.md#ui.spec.agentavatar)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：表达 Agent 身份和运行上下文。
- **上游全部公共值**：`AgentAvatar`。
- **上游定义**：[AgentAvatar:12](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L12)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：Agent 列表静态身份；任务中叠加状态；无图时确定性后备图形。
- **相邻选择与禁用场景**：真人用 Avatar；供应商商标用 BrandMark。
- **状态、恢复与键盘合同**：状态由业务投影提供；动画不成为唯一运行提示；加载失败不改变占位尺寸。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `AgentAvatarShape`：`| 'face' | 'bowl' | 'cloud' | 'tile' | 'hex' | 'shield' | 'pudding' | 'cookie' | 'star' | 'capsule' | 'ghost' | 'cat'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AgentAvatar/type.ts#L4)
- `AgentAvatarColor`：`'purple' | 'orange' | 'geekblue' | 'volcano' | 'magenta' | 'ink' | 'gray'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AgentAvatar/type.ts#L19)
- `AgentAvatarState`：`'idle' | 'working' | 'waiting' | 'blocked' | 'thinking' | 'done'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AgentAvatar/type.ts#L31)
- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AgentAvatar/type.ts#L62)

<a id="ui.family.alert"></a>
### Alert → InlineAlert

- **逐项深度规范**：[ui.spec.alert](./specs/feedback.md#ui.spec.alert)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：影响当前意图的局部消息。
- **上游全部公共值**：`Alert`。
- **上游定义**：[Alert:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/index.ts#L2)。
- **Peers 直接使用**：`Alert`（4 导入位点，7 JSX 位点；desktop）。
- **antd 候选**：`Alert`（31 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Alert`（64 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/ModelServiceTab.tsx:12](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ModelServiceTab.tsx#L12) · [apps/desktop/src/components/SkillsTab.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L8) · [apps/desktop/src/components/settings/MemorySettingsTab.tsx:14](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/MemorySettingsTab.tsx#L14)。
- **antd 代表调用**：[apps/desktop/src/components/MCPTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/MCPTab.tsx#L4) · [apps/desktop/src/components/agent/AgentCapabilityInventoryPanel.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/agent/AgentCapabilityInventoryPanel.tsx#L5)。
- **LobeHub 代表调用**：[src/components/ErrorBoundary/AlertFallback.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ErrorBoundary/AlertFallback.tsx#L3) · [src/features/Acceptance/Report/TerminalEvidence/TerminalEvidenceCard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Report/TerminalEvidence/TerminalEvidenceCard.tsx#L3)。
- **何时选哪种 / 打样场景**：字段组保存失败内联；权限不足显示下一步；可忽略提示可关闭；系统故障才用全局条。
- **相邻选择与禁用场景**：短暂完成用 Toast；整页阻断用 Result。
- **状态、恢复与键盘合同**：info/success/warning/error 是语义；错误关联受影响对象，关闭不清除业务故障。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `AlertType`：`'success' | 'info' | 'warning' | 'error' | 'secondary'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L12)
- `AlertVariant`：`| 'soft' | 'outlined' | 'plain' /** @deprecated Use `soft` instead. */ | 'filled' /** @deprecated Use `plain` instead. */ | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L13)
- `banner`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L79)
- `closable`：`AlertCloseConfig | boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L82)
- `colorfulText`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L88)
- `extraDefaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L94)
- `extraIsolate`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L96)
- `glass`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L98)
- `icon`：`IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L100)
- `iconProps`：`Omit<IconProps, 'icon'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L102)
- `showIcon`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L111)
- `NativeAlertProps`：`Omit< HTMLAttributes<HTMLDivElement>, keyof AlertOwnProps | 'children' | 'title' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Alert/type.ts#L124)

<a id="ui.family.anchor"></a>
### Anchor → SectionNav

- **逐项深度规范**：[ui.spec.anchor](./specs/navigation.md#ui.spec.anchor)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：长文档章节定位。
- **上游全部公共值**：`Anchor`。
- **上游定义**：[Anchor:15](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L15)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Anchor`（1 位点）。
- **LobeHub 代表调用**：[src/routes/(main)/community/(detail)/features/Toc/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/routes/%28main%29/community/%28detail%29/features/Toc/index.tsx#L3)。
- **何时选哪种 / 打样场景**：长设置页侧栏目录；滚动高亮当前段；深链接带锚点。
- **相邻选择与禁用场景**：普通外链用 Link；功能导航用 NavigationRail。
- **状态、恢复与键盘合同**：目标标题可聚焦；滚动不强迫抢焦点；固定头部偏移与返回位置受控。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.autocomplete"></a>
### AutoComplete → Autocomplete

- **逐项深度规范**：[ui.spec.autocomplete](./specs/input.md#ui.spec.autocomplete)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：允许自由输入并提供建议。
- **上游全部公共值**：`AutoComplete`。
- **上游定义**：[AutoComplete:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/index.ts#L1)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`AutoComplete`（2 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`AutoComplete`（1 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/AccountTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/AccountTab.tsx#L4) · [apps/desktop/src/components/settings/ProviderDetail.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/ProviderDetail.tsx#L4)。
- **LobeHub 代表调用**：[src/components/MCPStdioCommandInput/index.tsx:10](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/MCPStdioCommandInput/index.tsx#L10)。
- **何时选哪种 / 打样场景**：搜索历史可自由提交；联系人输入候选需显示身份；远端建议采用防抖和取消。
- **相邻选择与禁用场景**：只能选已有值用 Select；@实体用 MentionPicker。
- **状态、恢复与键盘合同**：输入与选择是不同事件；IME 不提交；旧请求不得覆盖新查询；无结果保留原文。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L7)
- `BaseAutocompleteProps`：`Omit< ComponentProps<typeof Autocomplete.Root>, 'className' | 'style' | 'render' | 'children' | 'items' | 'onValueChange' | 'mode' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L12)
- `allowClear`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L18)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L25)
- `prefix`：`InputProps['prefix']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L31)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L32)
- `size`：`InputProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L33)
- `suffix`：`InputProps['suffix']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L40)
- `variant`：`InputProps['variant']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/AutoComplete/type.ts#L41)

<a id="ui.family.avatar"></a>
### Avatar → Avatar / AvatarGroup

- **逐项深度规范**：[ui.spec.avatar](./specs/identity.md#ui.spec.avatar)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：表达真人或对象身份。
- **上游全部公共值**：`Avatar`、`AvatarGroup`。
- **上游定义**：[Avatar:18](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L18) · [AvatarGroup:16](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/index.ts#L16)。
- **Peers 直接使用**：`Avatar`（5 导入位点，8 JSX 位点；desktop）。
- **antd 候选**：`Avatar`（10 位点）。
- **本地替代候选**：[apps/desktop/src/components/common/SquareAvatar.tsx:79](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/common/SquareAvatar.tsx#L79) · [apps/desktop/src/components/common/UserSquareAvatar.tsx:22](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/common/UserSquareAvatar.tsx#L22) · [packages/prototypes/desktop/shared/PrototypeAgentAvatar.tsx:26](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shared/PrototypeAgentAvatar.tsx#L26) · [packages/prototypes/mobile/chat/src/components/UserSquareAvatar.tsx:19](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/mobile/chat/src/components/UserSquareAvatar.tsx#L19)。
- **LobeHub 直接使用**：`Avatar`（174 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/SkillsTab.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L8) · [apps/desktop/src/components/chat/MentionPopup.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/MentionPopup.tsx#L3) · [apps/desktop/src/components/chat/MentionTag.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/MentionTag.tsx#L3)。
- **antd 代表调用**：[apps/desktop/src/components/settings/ProviderMenu.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/ProviderMenu.tsx#L4) · [apps/desktop/src/pages/AgentGroupsPage.tsx:6](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/AgentGroupsPage.tsx#L6)。
- **LobeHub 代表调用**：[src/business/client/hooks/useWorkspaceOptionLabel.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/business/client/hooks/useWorkspaceOptionLabel.tsx#L4) · [src/components/Avatar/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Avatar/index.tsx#L3)。
- **何时选哪种 / 打样场景**：个人圆角方形；在线点仅附加；多人堆叠显示总数和完整列表入口。
- **相邻选择与禁用场景**：群集合用 GroupAvatar；权限用 TrustIndicator。
- **状态、恢复与键盘合同**：size 决定圆角；图失败回落 initials；叠加轮廓不被裁切；可点击头像由 Link 包裹。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `AvatarGeneratedFallbackVariant`：`'marble' | 'beam' | 'pixel' | 'sunset' | 'ring' | 'bauhaus'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L8)
- `AvatarFallbackVariant`：`'text' | AvatarGeneratedFallbackVariant` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L15)
- `animation`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L41)
- `bordered`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L53)
- `crossOrigin`：`'' | 'anonymous' | 'use-credentials'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L65)
- `draggable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L70)
- `emojiScaleWithBackground`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L75)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L91)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L96)
- `shape`：`'circle' | 'square'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L100)
- `sliceText`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L110)
- `unoptimized`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L126)
- `variant`：`'borderless' | 'filled' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L131)
- `zIndexReverse`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Avatar/type.ts#L169)

<a id="ui.family.badge"></a>
### Badge → Badge

- **逐项深度规范**：[ui.spec.badge](./specs/feedback.md#ui.spec.badge)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：补充计数或离散提醒。
- **上游全部公共值**：`Badge`。
- **上游定义**：[Badge:20](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L20)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Badge`（15 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Badge`（11 位点）。
- **antd 代表调用**：[apps/desktop/src/components/AppSideNav.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AppSideNav.tsx#L4) · [apps/desktop/src/components/NotificationBell.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/NotificationBell.tsx#L4)。
- **LobeHub 代表调用**：[src/components/FileParsingStatus/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/FileParsingStatus/index.tsx#L1) · [src/features/Auth/SignIn/SignInEmailStep.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Auth/SignIn/SignInEmailStep.tsx#L2)。
- **何时选哪种 / 打样场景**：未读计数截断 99+ 并提供完整可读数；在线状态仅在解释需要时显示。
- **相邻选择与禁用场景**：状态名称用 StatusTag；可选条件用 FilterChip。
- **状态、恢复与键盘合同**：计数由投影提供；不把普通红点当严重故障；屏幕阅读不重复播报每次刷新。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `BadgeStatus`：`'success' | 'processing' | 'default' | 'error' | 'warning'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Badge/type.ts#L3)
- `BadgeSize`：`'default' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Badge/type.ts#L5)
- `dot`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Badge/type.ts#L10)
- `showZero`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Badge/type.ts#L14)

<a id="ui.family.block"></a>
### Block → Surface

- **逐项深度规范**：[ui.spec.block](./specs/layout.md#ui.spec.block)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：建立具有明确意图的容器边界。
- **上游全部公共值**：`Block`。
- **上游定义**：[Block:22](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L22)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Block`（248 位点）。
- **LobeHub 代表调用**：[src/components/Error/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Error/index.tsx#L3) · [src/components/HtmlPreview/PreviewDrawer.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/HtmlPreview/PreviewDrawer.tsx#L4)。
- **何时选哪种 / 打样场景**：阅读用平面；操作区弱底色；浮层用 raised；恢复区关联失败对象。
- **相邻选择与禁用场景**：仅排版用 Stack/Grid；不得给每一段加 Card。
- **状态、恢复与键盘合同**：边界、标题和动作槽属于同一意图；不递归叠加阴影；容器自身没有无意义 tabIndex。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `clickable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Block/type.ts#L6)
- `glass`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Block/type.ts#L7)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Block/type.ts#L9)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Block/type.ts#L10)

<a id="ui.family.breadcrumb"></a>
### Breadcrumb → Breadcrumb

- **逐项深度规范**：[ui.spec.breadcrumb](./specs/navigation.md#ui.spec.breadcrumb)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：展示可回退的层级路径。
- **上游全部公共值**：`Breadcrumb`。
- **上游定义**：[Breadcrumb:23](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L23)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Breadcrumb`（7 位点）。
- **LobeHub 代表调用**：[src/features/AgentBreadcrumb/index.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentBreadcrumb/index.tsx#L4) · [src/features/AgentGoals/GoalWorkspaceBreadcrumb.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentGoals/GoalWorkspaceBreadcrumb.tsx#L3)。
- **何时选哪种 / 打样场景**：设置子页和文件夹；中间层可折叠；当前项不可伪装跳转。
- **相邻选择与禁用场景**：平级工作区用 Tabs；线性流程用 Steps。
- **状态、恢复与键盘合同**：使用导航 landmark 和当前项语义；窄屏仍能回到上层；返回保留上下文。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.burger"></a>
### Burger → NavigationToggle

- **逐项深度规范**：[ui.spec.burger](./specs/navigation.md#ui.spec.burger)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：切换全局导航可见性。
- **上游全部公共值**：`Burger`。
- **上游定义**：[Burger:25](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L25)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：窄窗口展开主导航；桌面折叠 rail。
- **相邻选择与禁用场景**：面板开关用 PanelToggle；更多菜单用 IconButton。
- **状态、恢复与键盘合同**：label 描述展开或收起导航，绑定 aria-expanded/controls；关闭回到触发器。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `fullscreen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Burger/type.ts#L10)
- `onOpenChange`：`(opened: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Burger/type.ts#L13)
- `opened`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Burger/type.ts#L15)
- `size`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Burger/type.ts#L16)
- `variant`：`ActionIconProps['variant']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Burger/type.ts#L18)

<a id="ui.family.button"></a>
### Button → Button / SplitButton

- **逐项深度规范**：[ui.spec.button](./specs/action.md#ui.spec.button)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：发出一次明确意图。
- **上游全部公共值**：`Button`、`SplitButton`。
- **上游定义**：[Button:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/index.ts#L2) · [SplitButton:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/index.ts#L4)。
- **Peers 直接使用**：`Button`（60 导入位点，351 JSX 位点；control/desktop/prototype）。
- **antd 候选**：`Button`（90 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Button`（615 位点）；`SplitButton`（4 位点）。
- **Peers 代表调用**：[apps/desktop/src/applet/AppletContainerShell.tsx:6](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/applet/AppletContainerShell.tsx#L6) · [apps/desktop/src/applet/LynxDebugPanel.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/applet/LynxDebugPanel.tsx#L3) · [apps/desktop/src/components/AgentSettingsModal.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSettingsModal.tsx#L4)。
- **antd 代表调用**：[apps/desktop/src/applet/LynxContainer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/applet/LynxContainer.tsx#L3) · [apps/desktop/src/components/chat/FollowUpChips.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/FollowUpChips.tsx#L2)。
- **LobeHub 代表调用**：[src/components/404/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/404/index.tsx#L3) · [src/components/AsyncError/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/AsyncError/index.tsx#L3)。
- **何时选哪种 / 打样场景**：保存/发送/停止/取消/删除/重试/复制/批准各用独立场景；emphasis、tone、density 正交。
- **相邻选择与禁用场景**：导航用 Link；持久选择用 ToggleButton；详见 button-spec.md。
- **状态、恢复与键盘合同**：重复触发、pending、取消和结果由同一 action identity 约束；失败保留输入。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ButtonType`：`'default' | 'primary' | 'dashed' | 'fill' | 'link' | 'text'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L11)
- `ButtonShape`：`'default' | 'circle' | 'round'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L12)
- `ButtonSize`：`'small' | 'middle' | 'large'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L13)
- `ButtonIconPosition`：`'start' | 'end'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L14)
- `ButtonOutdent`：`boolean | 'start' | 'end'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L15)
- `block`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L18)
- `danger`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L21)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L22)
- `ghost`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L28)
- `htmlType`：`ButtonHTMLAttributes<HTMLButtonElement>['type']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L30)
- `icon`：`IconProps['icon'] | ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L31)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L33)
- `TextOutdentProps`：`[T] extends ['text'] ? { /** * Cancels this size's `padding-inline` with a negative margin so a `text` * button lines up with adjacent copy. `true` / `'start'` outdent the start * edge; `'end'` outdents the end edge. */ outdent?: ButtonOutdent; type?: T; } : { outdent?: never; type?: T }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L41)
- `NativeButtonProps`：`Omit< ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseButtonOwnProps | 'type' | 'outdent' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L53)
- `NativeAnchorProps`：`Omit< AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseButtonOwnProps | 'type' | 'outdent' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Button/type.ts#L58)

<a id="ui.family.carousel"></a>
### Carousel → Carousel

- **逐项深度规范**：[ui.spec.carousel](./specs/media.md#ui.spec.carousel)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：浏览同一组视觉媒体。
- **上游全部公共值**：`Carousel`。
- **上游定义**：[Carousel:29](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L29)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Carousel`（1 位点）。
- **LobeHub 代表调用**：[src/features/Billboard/Carousel.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Billboard/Carousel.tsx#L3)。
- **何时选哪种 / 打样场景**：附件多图顺序浏览；有上一张/下一张和位置；显式选择播放。
- **相邻选择与禁用场景**：文档步骤用 Steps；大量对象用 Grid/List。
- **状态、恢复与键盘合同**：不自动轮播正文；键盘可导航；图片失败保持位置；拖拽不能阻止滚动和缩放。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `adaptiveHeight`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Carousel/type.ts#L10)
- `arrows`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Carousel/type.ts#L11)
- `autoplay`：`boolean | number` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Carousel/type.ts#L12)
- `dots`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Carousel/type.ts#L15)
- `loop`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Carousel/type.ts#L17)
- `pauseOnHover`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Carousel/type.ts#L19)

<a id="ui.family.checkbox"></a>
### Checkbox → Checkbox / CheckboxGroup

- **逐项深度规范**：[ui.spec.checkbox](./specs/input.md#ui.spec.checkbox)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：独立布尔或多选集合。
- **上游全部公共值**：`Checkbox`、`CheckboxGroup`。
- **上游定义**：[Checkbox:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/index.ts#L1) · [CheckboxGroup:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/index.ts#L2)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Checkbox` / Group（15 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Checkbox`（40 位点）。
- **antd 代表调用**：[apps/desktop/src/components/CronJobDrawer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/CronJobDrawer.tsx#L3) · [apps/desktop/src/components/LogsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/LogsTab.tsx#L4)。
- **LobeHub 代表调用**：[src/components/ChatGroupWizard/ChatGroupWizard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChatGroupWizard/ChatGroupWizard.tsx#L3) · [src/components/MemberSelectionModal/MemberSelectionModal.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/MemberSelectionModal/MemberSelectionModal.tsx#L4)。
- **何时选哪种 / 打样场景**：批量选择；接受条款；父项 mixed；多个偏好可同时选。
- **相邻选择与禁用场景**：立即生效设置用 Switch；互斥值用 Radio。
- **状态、恢复与键盘合同**：Space 切换；mixed 有明确派生规则；disabled 与不可更改原因分离；组错误关联 legend。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `CheckboxShape`：`'square' | 'circle'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/type.ts#L9)
- `BaseCheckboxProps`：`Omit< ComponentProps<typeof BaseCheckbox.Root>, 'className' | 'style' | 'render' | 'children' | 'onCheckedChange' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/type.ts#L11)
- `onChange`：`(checked: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/type.ts#L25)
- `textProps`：`DistributiveOmit<TextProps, 'children' | 'className' | 'style'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/type.ts#L38)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/type.ts#L42)
- `BaseCheckboxGroupProps`：`Omit< ComponentProps<typeof BaseCheckboxGroup>, 'className' | 'style' | 'render' | 'children' | 'onValueChange' | 'onChange' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/type.ts#L47)
- `textProps`：`CheckboxProps['textProps']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Checkbox/type.ts#L60)

<a id="ui.family.codediff"></a>
### CodeDiff → CodeDiff

- **逐项深度规范**：[ui.spec.codediff](./specs/code.md#ui.spec.codediff)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：审阅版本变化。
- **上游全部公共值**：`CodeDiff`、`PatchDiff`。
- **上游定义**：[CodeDiff:33](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L33) · [PatchDiff:36](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L36)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`CodeDiff`（2 位点）；`PatchDiff`（2 位点）。
- **LobeHub 代表调用**：[src/features/AgentGoals/ProcessControl/BatchPlan/PlanCompareModal.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentGoals/ProcessControl/BatchPlan/PlanCompareModal.tsx#L3) · [src/features/Dashboard/WidgetDetail/VersionDiff.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Dashboard/WidgetDetail/VersionDiff.tsx#L3)。
- **何时选哪种 / 打样场景**：左右对比适合宽屏；统一 diff 适合窄屏；PatchDiff 是补丁内容输入。
- **相邻选择与禁用场景**：普通代码用 CodeBlock；编辑用 CodeEditor。
- **状态、恢复与键盘合同**：键盘可逐块定位；增删不只靠颜色；大 diff 受限/分段；补丁视图不自动执行。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `DiffViewMode`：`'split' | 'unified'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L6)
- `defaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L28)
- `fullFeatured`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L41)
- `showHeader`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L58)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L70)
- `defaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L94)
- `fullFeatured`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L107)
- `showHeader`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L120)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeDiff/type.ts#L132)

<a id="ui.family.codeeditor"></a>
### CodeEditor → CodeEditor

- **逐项深度规范**：[ui.spec.codeeditor](./specs/code.md#ui.spec.codeeditor)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可编辑代码和结构化配置。
- **上游全部公共值**：`CodeEditor`。
- **上游定义**：[CodeEditor:39](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L39)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：系统提示模板、JSON 配置；只读预览单独模式；dirty/save/validation 可见。
- **相邻选择与禁用场景**：短单行用 TextField；只读用 CodeBlock。
- **状态、恢复与键盘合同**：保留草稿和撤销；Tab 缩进有退出路径；diagnostics 不吞 IME；卸载释放 editor。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/CodeEditor/type.ts#L23)

<a id="ui.family.collapsible"></a>
### Collapsible → Disclosure

- **逐项深度规范**：[ui.spec.collapsible](./specs/disclosure.md#ui.spec.collapsible)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：展开单个补充区域。
- **上游全部公共值**：`Collapsible`。
- **上游定义**：[Collapsible:40](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L40)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Collapsible`（3 位点）。
- **LobeHub 代表调用**：[src/features/AgentTasks/AgentTaskDetail/TaskAcceptance.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/AgentTaskDetail/TaskAcceptance.tsx#L3) · [src/features/AgentTasks/AgentTaskDetail/TaskActivities.tsx:7](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/AgentTaskDetail/TaskActivities.tsx#L7)。
- **何时选哪种 / 打样场景**：消息推理详情、附件元数据、过滤高级条件。
- **相邻选择与禁用场景**：多节并列用 Accordion；阻断决策用 Dialog。
- **状态、恢复与键盘合同**：触发器有展开状态；折叠不丢输入；禁止隐藏失败和批准需求。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `keepMounted`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Collapsible/type.ts#L8)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Collapsible/type.ts#L9)

<a id="ui.family.colorpicker"></a>
### ColorPicker → ColorPicker

- **逐项深度规范**：[ui.spec.colorpicker](./specs/input.md#ui.spec.colorpicker)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：选择语义允许的自定义颜色。
- **上游全部公共值**：`ColorPicker`。
- **上游定义**：[ColorPicker:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorPicker/index.ts#L1)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：封面/标记色允许的模块定制；输入色值和 alpha 分开。
- **相邻选择与禁用场景**：固定系统主题不可用任意选色；有限色用 ColorSwatches。
- **状态、恢复与键盘合同**：键盘可调数值；格式错误可恢复；对比提示；不得直接改全局 action.primary。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ColorPickerFormat`：`'hex' | 'rgb' | 'hsl'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorPicker/type.ts#L5)
- `ColorPickerTrigger`：`'swatch' | 'field' | 'chip'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorPicker/type.ts#L7)
- `alpha`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorPicker/type.ts#L10)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorPicker/type.ts#L15)
- `recent`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorPicker/type.ts#L22)
- `showText`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorPicker/type.ts#L26)

<a id="ui.family.colorswatches"></a>
### ColorSwatches → ColorSwatches

- **逐项深度规范**：[ui.spec.colorswatches](./specs/input.md#ui.spec.colorswatches)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：从批准的颜色集合选择。
- **上游全部公共值**：`ColorSwatches`。
- **上游定义**：[ColorSwatches:43](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L43)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ColorSwatches`（3 位点）。
- **LobeHub 代表调用**：[src/features/AgentSetting/AgentMeta/BackgroundSwatches.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentSetting/AgentMeta/BackgroundSwatches.tsx#L2) · [src/features/Settings/common/features/Appearance/ThemeSwatches/ThemeSwatchesNeutral.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Settings/common/features/Appearance/ThemeSwatches/ThemeSwatchesNeutral.tsx#L2)。
- **何时选哪种 / 打样场景**：模块标签和头像后备色；具名色板；选中轮廓可见。
- **相邻选择与禁用场景**：连续颜色编辑用 ColorPicker。
- **状态、恢复与键盘合同**：作为 RadioGroup/ToggleGroup 建模；选中不只靠颜色；色盲也能读名称。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `active`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorSwatches/type.ts#L12)
- `shape`：`'circle' | 'square'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorSwatches/type.ts#L15)
- `enableColorPicker`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorSwatches/type.ts#L23)
- `enableColorSwatches`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorSwatches/type.ts#L24)
- `shape`：`'circle' | 'square'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ColorSwatches/type.ts#L28)

<a id="ui.family.configprovider"></a>
### ConfigProvider → UIProvider

- **逐项深度规范**：[ui.spec.configprovider](./specs/runtime.md#ui.spec.configprovider)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：注入主题、locale、方向和运行环境。
- **上游全部公共值**：`ConfigProvider`。
- **上游定义**：[ConfigProvider:46](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L46)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`ConfigProvider`（6 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ConfigProvider`（3 位点）。
- **antd 代表调用**：[apps/x-config/console/src/App.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/x-config/console/src/App.tsx#L3) · [packages/prototypes/control/x-config/src/XConfigPrototype.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/control/x-config/src/XConfigPrototype.tsx#L3)。
- **LobeHub 代表调用**：[src/features/AuthShell/AuthThemeLite.tsx:7](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AuthShell/AuthThemeLite.tsx#L7) · [src/layout/GlobalProvider/AppTheme.tsx:8](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/layout/GlobalProvider/AppTheme.tsx#L8)。
- **何时选哪种 / 打样场景**：应用根唯一配置；嵌入宿主继承；测试显式注入。
- **相邻选择与禁用场景**：不是业务 Store；ThemeBoundary 只覆盖获准 token。
- **状态、恢复与键盘合同**：配置订阅有界；不可由 Provider 改 Station 真源；内部实现类型不外泄。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.contextmenu"></a>
### ContextMenu → ContextMenu

- **逐项深度规范**：[ui.spec.contextmenu](./specs/overlay.md#ui.spec.contextmenu)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：对象上下文中的次级命令。
- **上游全部公共值**：`ContextMenuHost`、`ContextMenuTrigger`。
- **上游定义**：[ContextMenuHost:61](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L61) · [ContextMenuTrigger:62](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L62)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ContextMenuHost`（1 位点）；`ContextMenuTrigger`（26 位点）。
- **LobeHub 代表调用**：[src/layout/SPAGlobalProvider/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/layout/SPAGlobalProvider/index.tsx#L3) · [src/features/AgentGoals/GoalCardItem.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentGoals/GoalCardItem.tsx#L3)。
- **何时选哪种 / 打样场景**：消息/文件右键；键盘菜单键；移动端长按为同一命令投影。
- **相邻选择与禁用场景**：主动作保持可见；设置选择不用上下文菜单。
- **状态、恢复与键盘合同**：对象 identity 固定；无悬浮目标也可关闭；命令重校验权限；关闭恢复焦点。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.copybutton"></a>
### CopyButton → CopyAction

- **逐项深度规范**：[ui.spec.copybutton](./specs/action.md#ui.spec.copybutton)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：复制当前对象的指定内容。
- **上游全部公共值**：`CopyButton`。
- **上游定义**：[CopyButton:67](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L67)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`CopyButton`（19 位点）。
- **LobeHub 代表调用**：[src/components/CommandLine/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/CommandLine/index.tsx#L3) · [src/components/CopyableLabel/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/CopyableLabel/index.tsx#L1)。
- **何时选哪种 / 打样场景**：消息正文、代码、恢复词分别指定 payload；敏感值默认不外显。
- **相邻选择与禁用场景**：文件保存用 DownloadAction。
- **状态、恢复与键盘合同**：success 只在 clipboard 成功后；权限失败给手动选择路径；定时恢复提示，清理 timer。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.datepicker"></a>
### DatePicker → DateField / DateRangeField

- **逐项深度规范**：[ui.spec.datepicker](./specs/input.md#ui.spec.datepicker)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：选择明确日期或日期范围。
- **上游全部公共值**：`DatePicker`、`DateRangePicker`、`DayjsDatePicker`、`DayjsDateRangePicker`。
- **上游定义**：[DatePicker:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/index.ts#L1) · [DateRangePicker:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/index.ts#L2) · [DayjsDatePicker:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/index.ts#L3) · [DayjsDateRangePicker:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/index.ts#L4)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`DatePicker` / RangePicker（4 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`DayjsDatePicker`（2 位点）；`DayjsDateRangePicker`（1 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/MyFilesSettings.tsx:28](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/MyFilesSettings.tsx#L28) · [apps/station/app/subserver/dashboard/web/src/pages/AccessGatesPage.tsx:16](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/station/app/subserver/dashboard/web/src/pages/AccessGatesPage.tsx#L16)。
- **LobeHub 代表调用**：[src/features/Settings/apikey/features/ApiKeyDatePicker/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Settings/apikey/features/ApiKeyDatePicker/index.tsx#L2) · [src/features/Settings/stats/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Settings/stats/index.tsx#L3)。
- **何时选哪种 / 打样场景**：任务截止日期使用 date-only；统计区间显式两端；时间点需时区。
- **相邻选择与禁用场景**：选时间用 TimeField；手写表达式用 TextField。
- **状态、恢复与键盘合同**：日历键盘与输入等价；闰日/范围/清空有合同；不通过 UTC 自动漂移日期。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `PickerLocaleInput`：`Omit<Partial<PickerLocale>, 'lang' | 'timePickerLocale'> & { lang?: Partial<PickerLocaleLang>; timePickerLocale?: TimePickerLocale; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L72)
- `PickerSize`：`'large' | 'medium' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L84)
- `PickerVariant`：`'outlined' | 'borderless' | 'filled' | 'underlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L85)
- `PickerStatus`：`'error' | 'warning'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L86)
- `PickerPlacement`：`'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L87)
- `CalendarMode`：`'date' | 'month' | 'year'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L90)
- `PickerSemanticName`：`'root' | 'prefix' | 'input' | 'suffix'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L93)
- `PickerPopupSemanticName`：`'root' | 'container' | 'header' | 'body' | 'content' | 'item' | 'footer'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L95)
- `InternalRcProps`：`'classNames' | 'generateConfig' | 'inlinePopup' | 'locale' | 'prefixCls' | 'styles'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L115)
- `MultipleRcProps`：`'maxTagCount' | 'multiple' | 'removeIcon' | 'tagRender'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L118)
- `ValueRcProps`：`| 'changeOnBlur' | 'defaultValue' | 'onCalendarChange' | 'onChange' | 'onOk' | 'placeholder' | 'placement' | 'size' | 'value'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L120)
- `changeOnBlur`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L136)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L149)
- `closable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L159)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L160)
- `maxTagCount`：`number | 'responsive'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L247)
- `multiple`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L254)
- `order`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L259)
- `range`：`'start' | 'end'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L284)
- `RangeDisabledDate`：`( current: DateType, info: { from?: DateType; type: PanelMode }, ) => boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L288)
- `RangeRcProps`：`'allowEmpty' | 'disabled' | 'disabledDate' | 'id' | 'onBlur' | 'onFocus' | 'order'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L293)
- `allowEmpty`：`boolean | [boolean, boolean]` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L304)
- `disabled`：`boolean | [boolean, boolean]` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L313)
- `order`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L340)
- `PresetPickerProps`：`Omit< PickerProps<DateType, ValueType>, 'picker' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L361)
- `GenericTimePickerProps`：`Omit< PickerProps<DateType, ValueType>, 'picker' | 'showTime' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L372)
- `MonthPicker`：`SinglePickerComponent<DateType, Omit<DatePickerBaseProps<DateType>, 'picker'>>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L410)
- `QuarterPicker`：`SinglePickerComponent<DateType, Omit<DatePickerBaseProps<DateType>, 'picker'>>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L411)
- `TimePicker`：`SinglePickerComponent< DateType, Omit<DatePickerBaseProps<DateType>, 'picker' | 'showTime'> >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L413)
- `WeekPicker`：`SinglePickerComponent<DateType, Omit<DatePickerBaseProps<DateType>, 'picker'>>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L417)
- `YearPicker`：`SinglePickerComponent<DateType, Omit<DatePickerBaseProps<DateType>, 'picker'>>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DatePicker/type.ts#L418)

<a id="ui.family.descriptions"></a>
### Descriptions → KeyValueList

- **逐项深度规范**：[ui.spec.descriptions](./specs/content.md#ui.spec.descriptions)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：读取对象属性。
- **上游全部公共值**：`Descriptions`。
- **上游定义**：[Descriptions:69](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L69)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Descriptions` / Item（9 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Descriptions`（2 位点）。
- **antd 代表调用**：[apps/desktop/src/components/SkillsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L4) · [apps/desktop/src/components/portal/views/AgentOverviewView.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/portal/views/AgentOverviewView.tsx#L3)。
- **LobeHub 代表调用**：[src/features/ResourceManager/FileDetail.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/ResourceManager/FileDetail.tsx#L3) · [src/features/Settings/creds/features/ViewCredModal/Content.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Settings/creds/features/ViewCredModal/Content.tsx#L4)。
- **何时选哪种 / 打样场景**：身份详情、设备属性、权限摘要；可复制值；多列降为单列。
- **相邻选择与禁用场景**：批量记录用 DataTable；可编辑表单用 Field。
- **状态、恢复与键盘合同**：语义 dl/dt/dd；长值换行；密钥遮挡由业务决定；缺值显示未提供。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `bordered`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Descriptions/type.ts#L11)
- `colon`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Descriptions/type.ts#L13)

<a id="ui.family.divider"></a>
### Divider → Divider

- **逐项深度规范**：[ui.spec.divider](./specs/layout.md#ui.spec.divider)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：分隔不同意图或语义组。
- **上游全部公共值**：`Divider`。
- **上游定义**：[Divider:71](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L71)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Divider`（8 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Divider`（57 位点）。
- **antd 代表调用**：[apps/desktop/src/components/ModelProviderSelect.tsx:6](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ModelProviderSelect.tsx#L6) · [apps/desktop/src/components/SkillAppletSelector.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillAppletSelector.tsx#L5)。
- **LobeHub 代表调用**：[src/components/ChangelogModal/ChangelogContent.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChangelogModal/ChangelogContent.tsx#L1) · [src/components/Skeleton/Tasks.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Skeleton/Tasks.tsx#L3)。
- **何时选哪种 / 打样场景**：菜单动作分组；设置组间隔；正文 hr 表示主题变化。
- **相邻选择与禁用场景**：仅需留白用 spacing；无需每行分隔。
- **状态、恢复与键盘合同**：装饰线 aria-hidden；语义分割用 separator；方向和密度来自 token。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `DividerOrientation`：`'horizontal' | 'vertical'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Divider/type.ts#L3)
- `dashed`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Divider/type.ts#L7)

<a id="ui.family.downloadbutton"></a>
### DownloadButton → DownloadAction

- **逐项深度规范**：[ui.spec.downloadbutton](./specs/action.md#ui.spec.downloadbutton)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：导出或保存指定资源。
- **上游全部公共值**：`DownloadButton`。
- **上游定义**：[DownloadButton:73](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L73)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：附件保存、导出会话、报告下载。
- **相邻选择与禁用场景**：复制文本用 CopyAction；打开预览用 PreviewAction。
- **状态、恢复与键盘合同**：准备/下载/失败可见；filename/权限由 resource contract 决定；失败不冒充已保存。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.draggablepanel"></a>
### DraggablePanel → ResizablePanel

- **逐项深度规范**：[ui.spec.draggablepanel](./specs/layout.md#ui.spec.draggablepanel)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可调整的持久工作区域。
- **上游全部公共值**：`DraggablePanel`、`DraggablePanelBody`、`DraggablePanelContainer`、`DraggablePanelContent`、`DraggablePanelFooter`、`DraggablePanelHandle`、`DraggablePanelHeader`、`DraggablePanelRoot`、`DraggablePanelToggle`。
- **上游定义**：[DraggablePanel:20](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L20) · [DraggablePanelBody:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L2) · [DraggablePanelContainer:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L4) · [DraggablePanelContent:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L6) · [DraggablePanelFooter:8](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L8) · [DraggablePanelHandle:10](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L10) · [DraggablePanelHeader:12](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L12) · [DraggablePanelRoot:14](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L14) · [DraggablePanelToggle:16](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/index.ts#L16)。
- **Peers 直接使用**：`DraggablePanel`（2 导入位点，2 JSX 位点；desktop）。
- **antd 候选**：无同名候选。
- **本地替代候选**：[apps/desktop/src/components/agent/workbench/PanelToggleDock.tsx:10](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/agent/workbench/PanelToggleDock.tsx#L10) · [packages/prototypes/desktop/shared/PanelToggleButton.tsx:32](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shared/PanelToggleButton.tsx#L32) · [packages/prototypes/desktop/shared/PanelToggleButton.tsx:82](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shared/PanelToggleButton.tsx#L82)。
- **LobeHub 直接使用**：`DraggablePanel`（9 位点）；`DraggablePanelContainer`（1 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/BuilderPanel.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/BuilderPanel.tsx#L3) · [apps/desktop/src/components/portal/PortalPanel.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/portal/PortalPanel.tsx#L3)。
- **LobeHub 代表调用**：[src/features/Acceptance/Viewer/Conversation/CollaboratorConversationRail.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Viewer/Conversation/CollaboratorConversationRail.tsx#L3) · [src/features/Acceptance/Viewer/History/AcceptanceLedgerRail.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Viewer/History/AcceptanceLedgerRail.tsx#L3)。
- **何时选哪种 / 打样场景**：会话侧栏、Agent 检视区；min/max/折叠/恢复宽度。
- **相邻选择与禁用场景**：临时细节用 Drawer；浮动窗用 FloatingPanel。
- **状态、恢复与键盘合同**：拖拽和键盘步进等价；持久化由 shell owner 决定；拖动不启动网络请求。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `defaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L26)
- `expand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L28)
- `expandable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L29)
- `mode`：`'fixed' | 'float'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L34)
- `onExpandChange`：`(expand: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L35)
- `showBorder`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L43)
- `showHandleWhenCollapsed`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L44)
- `showHandleWideArea`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggablePanel/type.ts#L49)

<a id="ui.family.draggablesidenav"></a>
### DraggableSideNav → ResizableNavigationRail

- **逐项深度规范**：[ui.spec.draggablesidenav](./specs/navigation.md#ui.spec.draggablesidenav)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可调宽度的导航侧栏。
- **上游全部公共值**：`DraggableSideNav`。
- **上游定义**：[DraggableSideNav:75](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L75)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：会话标题较长时扩宽；用户偏好恢复。
- **相邻选择与禁用场景**：普通 rail 用 NavigationRail；不再另设一份尺寸真源。
- **状态、恢复与键盘合同**：组合 NavigationRail + ResizablePanel；resize 时列表状态与滚动位置不丢失。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `body`：`(expand: boolean) => ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L12)
- `defaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L28)
- `expand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L36)
- `expandable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L41)
- `footer`：`ReactNode | ((expand: boolean) => ReactNode)` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L46)
- `header`：`ReactNode | ((expand: boolean) => ReactNode)` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L51)
- `onExpandChange`：`(expand: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L65)
- `placement`：`'left' | 'right'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L82)
- `resizable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L87)
- `showBorder`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L92)
- `showHandle`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L97)
- `showHandleHighlight`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L98)
- `showHandleWhenCollapsed`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DraggableSideNav/type.ts#L103)

<a id="ui.family.drawer"></a>
### Drawer → Drawer

- **逐项深度规范**：[ui.spec.drawer](./specs/overlay.md#ui.spec.drawer)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：侧边补充详情或受限任务。
- **上游全部公共值**：`Drawer`、`DrawerBackdrop`、`DrawerClose`、`DrawerContent`、`DrawerDescription`、`DrawerFooter`、`DrawerHeader`、`DrawerPopup`、`DrawerPortal`、`DrawerRoot`、`DrawerTitle`、`DrawerTrigger`。
- **上游定义**：[Drawer:30](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L30) · [DrawerBackdrop:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L4) · [DrawerClose:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L6) · [DrawerContent:8](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L8) · [DrawerDescription:10](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L10) · [DrawerFooter:12](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L12) · [DrawerHeader:14](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L14) · [DrawerPopup:16](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L16) · [DrawerPortal:18](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L18) · [DrawerRoot:20](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L20) · [DrawerTitle:22](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L22) · [DrawerTrigger:24](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/index.ts#L24)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Drawer`（11 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Drawer`（16 位点）；`DrawerPopup`（1 位点）；`DrawerPortal`（1 位点）；`DrawerRoot`（1 位点）。
- **antd 代表调用**：[apps/desktop/src/components/CronJobDrawer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/CronJobDrawer.tsx#L3) · [apps/desktop/src/components/SkillsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L4)。
- **LobeHub 代表调用**：[src/components/HtmlPreview/PreviewDrawer.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/HtmlPreview/PreviewDrawer.tsx#L4) · [src/features/Acceptance/AcceptanceDrawer.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/AcceptanceDrawer.tsx#L3)。
- **何时选哪种 / 打样场景**：桌面消息详情；移动 sheet；需输入的侧任务。
- **相邻选择与禁用场景**：不可绕过承诺用 Dialog；常驻工具用 Panel。
- **状态、恢复与键盘合同**：声明 modal/nonmodal；明确遮罩/Escape/dirty close；宽度和滚动边界独立。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `DrawerPlacement`：`'bottom' | 'left' | 'right' | 'top'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L3)
- `DrawerPush`：`boolean | { distance?: number }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L5)
- `afterOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L38)
- `closable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L42)
- `keyboard`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L49)
- `mask`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L50)
- `maskClosable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L51)
- `noHeader`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L52)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Drawer/type.ts#L54)

<a id="ui.family.dropdownmenu"></a>
### DropdownMenu → Menu

- **逐项深度规范**：[ui.spec.dropdownmenu](./specs/overlay.md#ui.spec.dropdownmenu)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可执行命令集合。
- **上游全部公共值**：`DropdownMenu`、`DropdownMenuCheckboxItemIndicator`、`DropdownMenuCheckboxItemPrimitive`、`DropdownMenuFooter`、`DropdownMenuGroup`、`DropdownMenuGroupLabel`、`DropdownMenuHeader`、`DropdownMenuItem`、`DropdownMenuItemContent`、`DropdownMenuItemDesc`、`DropdownMenuItemExtra`、`DropdownMenuItemIcon`、`DropdownMenuItemLabel`、`DropdownMenuItemLabelGroup`、`DropdownMenuPopup`、`DropdownMenuPortal`、`DropdownMenuPositioner`、`DropdownMenuRoot`、`DropdownMenuScrollViewport`、`DropdownMenuSeparator`、`DropdownMenuSubmenuArrow`、`DropdownMenuSubmenuRoot`、`DropdownMenuSubmenuTrigger`、`DropdownMenuSwitchItem`、`DropdownMenuTrigger`。
- **上游定义**：[DropdownMenu:80](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L80) · [DropdownMenuCheckboxItemIndicator:82](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L82) · [DropdownMenuCheckboxItemPrimitive:83](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L83) · [DropdownMenuFooter:84](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L84) · [DropdownMenuGroup:86](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L86) · [DropdownMenuGroupLabel:87](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L87) · [DropdownMenuHeader:89](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L89) · [DropdownMenuItem:91](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L91) · [DropdownMenuItemContent:92](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L92) · [DropdownMenuItemDesc:15](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DropdownMenu/index.ts#L15) · [DropdownMenuItemExtra:94](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L94) · [DropdownMenuItemIcon:96](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L96) · [DropdownMenuItemLabel:98](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L98) · [DropdownMenuItemLabelGroup:22](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DropdownMenu/index.ts#L22) · [DropdownMenuPopup:102](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L102) · [DropdownMenuPortal:104](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L104) · [DropdownMenuPositioner:106](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L106) · [DropdownMenuRoot:109](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L109) · [DropdownMenuScrollViewport:110](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L110) · [DropdownMenuSeparator:112](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L112) · [DropdownMenuSubmenuArrow:114](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L114) · [DropdownMenuSubmenuRoot:116](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L116) · [DropdownMenuSubmenuTrigger:117](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L117) · [DropdownMenuSwitchItem:42](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DropdownMenu/index.ts#L42) · [DropdownMenuTrigger:119](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L119)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`DropdownMenu`（166 位点）；`DropdownMenuFooter`（1 位点）；`DropdownMenuGroup`（2 位点）；`DropdownMenuGroupLabel`（2 位点）；`DropdownMenuHeader`（3 位点）；`DropdownMenuItem`（8 位点）；`DropdownMenuItemContent`（2 位点）；`DropdownMenuItemDesc`（1 位点）；`DropdownMenuItemExtra`（2 位点）；`DropdownMenuItemIcon`（1 位点）；`DropdownMenuItemLabel`（3 位点）；`DropdownMenuItemLabelGroup`（1 位点）；`DropdownMenuPopup`（15 位点）；`DropdownMenuPortal`（15 位点）；`DropdownMenuPositioner`（15 位点）；`DropdownMenuRoot`（10 位点）；`DropdownMenuScrollViewport`（3 位点）；`DropdownMenuSubmenuArrow`（2 位点）；`DropdownMenuSubmenuRoot`（6 位点）；`DropdownMenuSubmenuTrigger`（6 位点）；`DropdownMenuTrigger`（10 位点）。
- **LobeHub 代表调用**：[src/features/Acceptance/Report/TerminalEvidence/TerminalPlayer.tsx:8](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Report/TerminalEvidence/TerminalPlayer.tsx#L8) · [src/features/Acceptance/Viewer/Comments/CommentCard.tsx:5](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Viewer/Comments/CommentCard.tsx#L5)。
- **何时选哪种 / 打样场景**：更多动作、分组、checkbox/radio 命令、submenu、danger 区。
- **相邻选择与禁用场景**：持久值字段用 Select；自由输入用 Autocomplete。
- **状态、恢复与键盘合同**：箭头/Home/End/搜索字母；Enter 执行；Escape 逐层关闭；切换项可决定 keepOpen。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `nativeButton`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DropdownMenu/type.ts#L58)
- `triggerProps`：`Omit<MenuTriggerProps<Payload>, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/DropdownMenu/type.ts#L68)

<a id="ui.family.editabletext"></a>
### EditableText → InlineEdit

- **逐项深度规范**：[ui.spec.editabletext](./specs/input.md#ui.spec.editabletext)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：原位编辑短文本。
- **上游全部公共值**：`EditableText`。
- **上游定义**：[EditableText:124](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L124)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`EditableText`（2 位点）。
- **LobeHub 代表调用**：[src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx#L1) · [src/features/MobileHome/SessionListContent/Modals/ConfigGroupModal/GroupItem.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/MobileHome/SessionListContent/Modals/ConfigGroupModal/GroupItem.tsx#L1)。
- **何时选哪种 / 打样场景**：会话/Agent/文件标题；显示与编辑双态；enter 保存/esc 取消。
- **相邻选择与禁用场景**：长内容用 Editor；受限选项用 Select。
- **状态、恢复与键盘合同**：blur 保存必须显式政策；保存 pending 保留内容；失败留在编辑态且提供重试。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `editing`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditableText/type.ts#L25)
- `inputProps`：`Omit< ControlInputProps, | 'onChange' | 'value' | 'onChangeEnd' | 'onValueChanging' | 'texts' | 'className' | 'style' | 'onBlur' | 'onFocus' | 'size' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditableText/type.ts#L30)
- `onEditingChange`：`(editing: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditableText/type.ts#L44)
- `showEditIcon`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditableText/type.ts#L46)
- `size`：`ControlInputProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditableText/type.ts#L50)
- `variant`：`ControlInputProps['variant']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditableText/type.ts#L59)

<a id="ui.family.editorslashmenu"></a>
### EditorSlashMenu → SlashCommandMenu

- **逐项深度规范**：[ui.spec.editorslashmenu](./specs/input.md#ui.spec.editorslashmenu)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：编辑器内插入或执行结构命令。
- **上游全部公共值**：`EditorSlashMenu`。
- **上游定义**：[EditorSlashMenu:126](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L126)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：/插入代码块、附件、模板；过滤候选。
- **相邻选择与禁用场景**：全局命令用 CommandPalette；@引用用 MentionPicker。
- **状态、恢复与键盘合同**：触发 token 范围可替换；Esc 保留原文；IME/无匹配/插入失败均可恢复。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `EditorSlashMenuOption`：`{ /** Render danger style (red) */ danger?: boolean; /** Whether the item is disabled */ disabled?: boolean; /** Optional extra content shown at the end */ extra?: React.ReactNode; /** Optional icon shown at the start */ icon?: React.ReactNode; /** Optional additional keywords for filtering */ keywords?: string[]; /** Visible label, also used for filtering by default */ label: string; /** Unique id of the command */ value: EditorSlashMenuItemValue; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditorSlashMenu/type.ts#L8)
- `danger`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditorSlashMenu/type.ts#L10)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditorSlashMenu/type.ts#L12)
- `EditorSlashMenuOnOpenChange`：`( open: boolean, details: AutocompleteRootChangeEventDetails, ) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditorSlashMenu/type.ts#L33)
- `EditorSlashMenuPlacement`：`'top' | 'bottom'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EditorSlashMenu/type.ts#L56)

<a id="ui.family.emojipicker"></a>
### EmojiPicker → EmojiPicker

- **逐项深度规范**：[ui.spec.emojipicker](./specs/input.md#ui.spec.emojipicker)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：选择字符或反应符号。
- **上游全部公共值**：`EmojiPicker`。
- **上游定义**：[EmojiPicker:131](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L131)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：[apps/mobile/src/components/reactions/ReactionPicker.tsx:12](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/reactions/ReactionPicker.tsx#L12) · [packages/prototypes/shared/ReactionPicker.tsx:18](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/shared/ReactionPicker.tsx#L18)。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：正文插入 emoji；消息 reaction 使用受限集；最近使用仅本地。
- **相邻选择与禁用场景**：人物身份用 Avatar；不使用大型图像承担文本语义。
- **状态、恢复与键盘合同**：键盘搜索与分组；插入恢复光标；反应去重归业务；资源加载失败有文本路径。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `shape`：`'circle' | 'square'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L11)
- `allowDelete`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L41)
- `allowModelAvatar`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L42)
- `allowUpload`：`| boolean | { enableEmoji?: boolean; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L43)
- `enableEmoji`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L46)
- `contentProps`：`Omit<FlexboxProps, 'className' | 'ref' | 'style'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L49)
- `defaultOpen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L54)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L55)
- `onOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L59)
- `onUpload`：`AvatarUploaderProps['onUpload']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L60)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L61)
- `popupProps`：`Omit< PopoverProps, 'onOpenChange' | 'defaultOpen' | 'content' | 'open' | 'trigger' | 'children' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L63)
- `texts`：`AvatarUploaderProps['texts'] & { delete?: string; emoji?: string; upload?: string; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/EmojiPicker/type.ts#L69)

<a id="ui.family.empty"></a>
### Empty → EmptyState

- **逐项深度规范**：[ui.spec.empty](./specs/feedback.md#ui.spec.empty)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：解释为什么没有内容并指向下一步。
- **上游全部公共值**：`Empty`。
- **上游定义**：[Empty:132](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L132)。
- **Peers 直接使用**：`Empty`（3 导入位点，3 JSX 位点；desktop）。
- **antd 候选**：`Empty`（60 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Empty`（107 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/portal/views/AgentOverviewView.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/portal/views/AgentOverviewView.tsx#L2) · [apps/desktop/src/components/portal/views/WorkingFilesView.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/portal/views/WorkingFilesView.tsx#L3) · [apps/desktop/src/components/portal/views/WorkingProgressView.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/portal/views/WorkingProgressView.tsx#L3)。
- **antd 代表调用**：[apps/desktop/src/components/LogsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/LogsTab.tsx#L4) · [apps/desktop/src/components/MCPTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/MCPTab.tsx#L4)。
- **LobeHub 代表调用**：[src/business/client/features/SandboxStorageUpsell.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/business/client/features/SandboxStorageUpsell.tsx#L3) · [src/components/ChatGroupWizard/ChatGroupWizard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChatGroupWizard/ChatGroupWizard.tsx#L3)。
- **何时选哪种 / 打样场景**：初次使用=创建；过滤无结果=清除筛选；权限不可见=请求访问；已清空=状态说明。
- **相邻选择与禁用场景**：加载用 Skeleton；错误用 RecoveryState。
- **状态、恢复与键盘合同**：每种原因有独立文案和 action；不能把网络失败渲染成没有数据。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `actionProps`：`Omit<ComponentProps<'div'>, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L9)
- `align`：`CSSProperties['alignItems']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L10)
- `descriptionProps`：`DistributiveOmit<TextProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L12)
- `icon`：`IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L14)
- `iconColor`：`IconProps['color']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L15)
- `imageProps`：`Omit<ComponentProps<'div'>, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L17)
- `titleProps`：`DistributiveOmit<TextProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L21)
- `type`：`'default' | 'page'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L22)
- `variant`：`'default' | 'dashed'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Empty/type.ts#L23)

<a id="ui.family.filetypeicon"></a>
### FileTypeIcon → FileTypeGlyph

- **逐项深度规范**：[ui.spec.filetypeicon](./specs/identity.md#ui.spec.filetypeicon)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：文件类型识别。
- **上游全部公共值**：`FileTypeIcon`。
- **上游定义**：[FileTypeIcon:133](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L133)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`FileTypeIcon`（4 位点）。
- **LobeHub 代表调用**：[src/components/FileIcon/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/FileIcon/index.tsx#L1) · [src/features/PageExplorer/PageExplorerPlaceholder.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/PageExplorer/PageExplorerPlaceholder.tsx#L3)。
- **何时选哪种 / 打样场景**：按 MIME/扩展名显示通用类型；未知文件后备；危险文件提示独立。
- **相邻选择与禁用场景**：供应商标用 BrandMark；附件状态用 StatusTag。
- **状态、恢复与键盘合同**：映射由 Peers 管理；扩展名不等于安全验证；与 MaterialFileTypeIcon 合并同一能力。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `type`：`'file' | 'folder'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FileTypeIcon/type.ts#L13)
- `variant`：`'color' | 'mono'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FileTypeIcon/type.ts#L14)

<a id="ui.family.flex"></a>
### Flex → Stack / Inline

- **逐项深度规范**：[ui.spec.flex](./specs/layout.md#ui.spec.flex)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：一维排版。
- **上游全部公共值**：`Center`、`FlexBasic`、`Flexbox`。
- **上游定义**：[Center:135](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L135) · [FlexBasic:137](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L137) · [Flexbox:139](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L139)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Flex`（1 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Center`（210 位点）；`Flexbox`（1707 位点）。
- **antd 代表调用**：[apps/desktop/src/components/messages/ClarificationQuestion.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/messages/ClarificationQuestion.tsx#L2)。
- **LobeHub 代表调用**：[src/business/client/features/SandboxStorageUpsell.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/business/client/features/SandboxStorageUpsell.tsx#L3) · [src/components/AsyncBoundary/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/AsyncBoundary/index.tsx#L3)。
- **何时选哪种 / 打样场景**：纵向内容用 Stack；行尾动作用 Inline；响应式换行显式。
- **相邻选择与禁用场景**：二维轨道用 Grid；边界用 Surface。
- **状态、恢复与键盘合同**：gap/align/justify 来自受限布局合同；业务不传任意第三方 Flex 属性。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ContentPosition`：`| 'center' | 'end' | 'flex-end' | 'flex-start' | 'start' | 'stretch' | 'baseline'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L10)
- `FlexDirection`：`'vertical' | 'vertical-reverse' | 'horizontal' | 'horizontal-reverse'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L19)
- `allowShrink`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L42)
- `distribution`：`CSSProperties['justifyContent']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L69)
- `horizontal`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L93)
- `justify`：`CSSProperties['justifyContent']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L98)
- `visible`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L135)
- `wrap`：`CSSProperties['flexWrap']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L146)
- `CenterProps`：`Omit<FlexBasicProps, 'distribution' | 'direction' | 'align'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Flex/type.ts#L153)

<a id="ui.family.floatingpanel"></a>
### FloatingPanel → FloatingPanel

- **逐项深度规范**：[ui.spec.floatingpanel](./specs/overlay.md#ui.spec.floatingpanel)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可移动的非模态工具窗。
- **上游全部公共值**：`FloatingPanel`。
- **上游定义**：[FloatingPanel:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/index.ts#L1)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`FloatingPanel`（1 位点）。
- **LobeHub 代表调用**：[src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx:6](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx#L6)。
- **何时选哪种 / 打样场景**：持续查看 Agent 输出或媒体工具；显式固定/恢复。
- **相邻选择与禁用场景**：临时选择用 Popover；关键批准用 Dialog。
- **状态、恢复与键盘合同**：窗口位置有边界；键盘可移动；销毁释放 listener；多窗口状态由 shell owner 管理。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `FloatingPanelPlacement`：`'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L6)
- `FloatingPanelResizeHandle`：`'bottom' | 'bottomLeft' | 'bottomRight' | 'left' | 'right' | 'top' | 'topLeft' | 'topRight'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L7)
- `closable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L41)
- `defaultOpen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L44)
- `keyboard`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L48)
- `mask`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L49)
- `maskClosable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L50)
- `modal`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L55)
- `onOpenChange`：`ModalRootProps['onOpenChange']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L59)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L62)
- `resizable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingPanel/type.ts#L64)

<a id="ui.family.floatingsheet"></a>
### FloatingSheet → Sheet

- **逐项深度规范**：[ui.spec.floatingsheet](./specs/overlay.md#ui.spec.floatingsheet)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：有限屏幕空间中的临时任务。
- **上游全部公共值**：`FloatingSheet`。
- **上游定义**：[FloatingSheet:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingSheet/index.ts#L1)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`FloatingSheet`（1 位点）。
- **LobeHub 代表调用**：[src/features/FloatingChatPanel/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/FloatingChatPanel/index.tsx#L3)。
- **何时选哪种 / 打样场景**：移动选择、分享、详情；允许全高切换。
- **相邻选择与禁用场景**：桌面同语义用 Popover/Drawer；不可强行复刻位置。
- **状态、恢复与键盘合同**：焦点/返回键/手势统一关闭语义；dirty input 不能被拖拽静默丢弃。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `defaultOpen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingSheet/type.ts#L8)
- `dismissible`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingSheet/type.ts#L9)
- `mode`：`'overlay' | 'inline'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingSheet/type.ts#L13)
- `onOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingSheet/type.ts#L14)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingSheet/type.ts#L16)
- `variant`：`'elevated' | 'embedded'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FloatingSheet/type.ts#L20)

<a id="ui.family.fluentemoji"></a>
### FluentEmoji → EmojiArtwork

- **逐项深度规范**：[ui.spec.fluentemoji](./specs/identity.md#ui.spec.fluentemoji)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：具备文本后备的表情展示。
- **上游全部公共值**：`FluentEmoji`。
- **上游定义**：[FluentEmoji:144](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L144)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`FluentEmoji`（14 位点）。
- **LobeHub 代表调用**：[src/components/404/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/404/index.tsx#L3) · [src/components/Error/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Error/index.tsx#L3)。
- **何时选哪种 / 打样场景**：已选择 emoji 的视觉增强；装饰性欢迎图形在 envelope 内。
- **相邻选择与禁用场景**：输入真实字符用 EmojiPicker；不直接依赖远端 CDN。
- **状态、恢复与键盘合同**：asset 有 license/source；缺资源回落 Unicode；装饰图不额外读出重复名称。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `unoptimized`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FluentEmoji/type.ts#L11)

<a id="ui.family.focusscope"></a>
### FocusScope → FocusBoundary

- **逐项深度规范**：[ui.spec.focusscope](./specs/runtime.md#ui.spec.focusscope)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：管理局部焦点与焦点恢复。
- **上游全部公共值**：`FocusScope`。
- **上游定义**：[FocusScope:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/FocusScope/index.ts#L1)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：Dialog trap；Popover 键盘进入；关闭回到发起控制。
- **相邻选择与禁用场景**：普通 Surface 不 trap；非模态不能隔离整个应用。
- **状态、恢复与键盘合同**：嵌套作用域按栈；失效 trigger 回退到邻近可读位置；清理跨窗口监听。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.fontloader"></a>
### FontLoader → FontAssets

- **逐项深度规范**：[ui.spec.fontloader](./specs/runtime.md#ui.spec.fontloader)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：受控字体资产和后备。
- **上游全部公共值**：`FontLoader`。
- **上游定义**：[FontLoader:146](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L146)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`FontLoader`（1 位点）。
- **LobeHub 代表调用**：[src/layout/GlobalProvider/AppTheme.tsx:8](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/layout/GlobalProvider/AppTheme.tsx#L8)。
- **何时选哪种 / 打样场景**：自有字体按需加载；系统字体先显示；离线可读。
- **相邻选择与禁用场景**：不在业务页各自加载字体。
- **状态、恢复与键盘合同**：来源/license/hash 固定；不阻塞主要内容；字体切换不得破坏文字与焦点位置。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.form"></a>
### Form → Form / Field / FieldGroup

- **逐项深度规范**：[ui.spec.form](./specs/input.md#ui.spec.form)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：聚合编辑、校验和提交。
- **上游全部公共值**：`Form`、`FormDivider`、`FormField`、`FormFlatGroup`、`FormFooter`、`FormGroup`、`FormSubmitFooter`、`FormTitle`。
- **上游定义**：[Form:15](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L15) · [FormDivider:27](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L27) · [FormField:28](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L28) · [FormFlatGroup:29](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L29) · [FormFooter:30](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L30) · [FormGroup:31](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L31) · [FormSubmitFooter:32](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L32) · [FormTitle:33](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/index.ts#L33)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Form` / Item（21 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Form`（1 位点）。
- **antd 代表调用**：[apps/desktop/src/components/CronJobDrawer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/CronJobDrawer.tsx#L3) · [apps/desktop/src/components/settings/MemorySettingsTab.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/MemorySettingsTab.tsx#L3)。
- **LobeHub 代表调用**：[src/features/Projects/WorkingDirectories/AdvancedSettings.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Projects/WorkingDirectories/AdvancedSettings.tsx#L4)。
- **何时选哪种 / 打样场景**：设置表单、身份创建、Agent 配置；group/title/helper/error/footer。
- **相邻选择与禁用场景**：即刻生效的单项用 SettingRow + Switch；展示用 KeyValueList。
- **状态、恢复与键盘合同**：fieldId/errorId 关联；submit 校验焦点；跨字段错误明确；失败保留 dirty values。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `FormVariant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L11)
- `FormLayout`：`'horizontal' | 'vertical'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L12)
- `ItemsType`：`'group' | 'flat'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L13)
- `BaseFormProps`：`Omit<ComponentProps<typeof BaseForm>, 'render' | 'className' | 'style'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L17)
- `collapsible`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L26)
- `compact`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L31)
- `itemMinWidth`：`FormFieldProps['minWidth']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L40)
- `onFinish`：`( values: FormValues, eventDetails: Parameters<NonNullable<BaseFormProps['onFormSubmit']>>[1], ) => void | Promise<void>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L50)
- `divider`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L71)
- `hidden`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L72)
- `required`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L76)
- `collapsible`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L84)
- `defaultActive`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L85)
- `icon`：`IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L88)
- `active`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L95)
- `collapsible`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L96)
- `defaultActive`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L97)
- `icon`：`IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L100)
- `onCollapse`：`(active: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L102)
- `visible`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L112)
- `buttonProps`：`Omit<ButtonProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L118)
- `enableReset`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L119)
- `enableUnsavedWarning`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L120)
- `float`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L121)
- `resetButtonProps`：`Omit<ButtonProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L123)
- `saveButtonProps`：`Omit<ButtonProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L124)
- `tagProps`：`Omit<TagProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L149)
- `hasUnsavedChanges`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L154)
- `itemMinWidth`：`FormFieldProps['minWidth']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L156)
- `submitLoading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Form/type.ts#L159)

<a id="ui.family.freeze"></a>
### Freeze → RenderSuspension

- **逐项深度规范**：[ui.spec.freeze](./specs/runtime.md#ui.spec.freeze)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：隐藏视图的渲染控制。
- **上游全部公共值**：`Freeze`。
- **上游定义**：[Freeze:148](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L148)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Freeze`（3 位点）。
- **LobeHub 代表调用**：[src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx:6](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx#L6) · [src/features/EntityLink/Render/InternalEntityPreview.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/EntityLink/Render/InternalEntityPreview.tsx#L4)。
- **何时选哪种 / 打样场景**：仅在平台 PageHost 合同允许时冻结隐藏树。
- **相邻选择与禁用场景**：业务不得自行 freeze 阻断 runtime 更新。
- **状态、恢复与键盘合同**：投影更新与 view render 分开；恢复读最新状态；效果/资源仍由 runtime owner 清理。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `frozen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Freeze/type.ts#L5)

<a id="ui.family.grid"></a>
### Grid → Grid

- **逐项深度规范**：[ui.spec.grid](./specs/layout.md#ui.spec.grid)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：明确二维轨道和响应式分配。
- **上游全部公共值**：`Grid`。
- **上游定义**：[Grid:150](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L150)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Grid`（37 位点）。
- **LobeHub 代表调用**：[src/components/Descriptions/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Descriptions/index.tsx#L2) · [src/components/Skeleton/AgentStatistics.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Skeleton/AgentStatistics.tsx#L3)。
- **何时选哪种 / 打样场景**：文件网格、Applet 启动器；重复行共享轨道。
- **相邻选择与禁用场景**：单向排版用 Stack；大量数据用 VirtualList。
- **状态、恢复与键盘合同**：列规则按宽度；动作边缘对齐；视觉顺序保持阅读顺序；不以固定 px 堵住本地化。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.groupavatar"></a>
### GroupAvatar → GroupAvatar

- **逐项深度规范**：[ui.spec.groupavatar](./specs/identity.md#ui.spec.groupavatar)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：表达一个群实体。
- **上游全部公共值**：`GroupAvatar`。
- **上游定义**：[GroupAvatar:151](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L151)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：[apps/desktop/src/components/common/GroupCompositeAvatar.tsx:17](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/common/GroupCompositeAvatar.tsx#L17) · [apps/desktop/src/components/common/GroupSquareAvatar.tsx:15](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/common/GroupSquareAvatar.tsx#L15)。
- **LobeHub 直接使用**：`GroupAvatar`（2 位点）。
- **LobeHub 代表调用**：[src/features/Conversation/Messages/GroupTasks/index.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Conversation/Messages/GroupTasks/index.tsx#L4) · [src/features/GroupAvatar/index.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/GroupAvatar/index.tsx#L4)。
- **何时选哪种 / 打样场景**：成员合成头像或群自定义图；明确成员与群名。
- **相邻选择与禁用场景**：多个独立人用 AvatarGroup。
- **状态、恢复与键盘合同**：与 Avatar 同形状语言；成员数和身份来自投影；不在每个页面重算群真源。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `AvatarItem`：`string | Omit<AvatarProps, 'size'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GroupAvatar/type.ts#L7)
- `avatarShape`：`AvatarProps['shape']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GroupAvatar/type.ts#L11)
- `grid`：`2 | 3 | 'auto'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GroupAvatar/type.ts#L13)

<a id="ui.family.guidecard"></a>
### GuideCard → GuideStep

- **逐项深度规范**：[ui.spec.guidecard](./specs/feedback.md#ui.spec.guidecard)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：帮助完成一个具体任务。
- **上游全部公共值**：`GuideCard`。
- **上游定义**：[GuideCard:152](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L152)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：空 Agent 引导创建；身份恢复步骤；可再次打开。
- **相邻选择与禁用场景**：营销介绍不用任务卡；整段流程用 OnboardingFlow。
- **状态、恢复与键盘合同**：下一步真实可执行；完成来源明确；跳过不冒充完成；记忆状态由产品 owner 决定。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `closable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GuideCard/type.ts#L14)
- `closeIconProps`：`Omit<ActionIconProps, 'icon' | 'onClick'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GuideCard/type.ts#L15)
- `coverProps`：`ImgProps & { priority?: boolean }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GuideCard/type.ts#L17)
- `priority`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GuideCard/type.ts#L17)
- `onClose`：`ActionIconProps['onClick']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GuideCard/type.ts#L20)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GuideCard/type.ts#L22)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/GuideCard/type.ts#L28)

<a id="ui.family.header"></a>
### Header → PageHeader

- **逐项深度规范**：[ui.spec.header](./specs/layout.md#ui.spec.header)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：当前页面的主题和动作。
- **上游全部公共值**：`Header`。
- **上游定义**：[Header:153](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L153)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：名称、上下文、主要动作、补充说明；窄屏溢出。
- **相邻选择与禁用场景**：全局 shell header 由 NavigationShell 管理。
- **状态、恢复与键盘合同**：一个主标题；动作按优先级；sticky 区不遮盖 focus target。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.highlighter"></a>
### Highlighter → CodeBlock

- **逐项深度规范**：[ui.spec.highlighter](./specs/code.md#ui.spec.highlighter)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：只读代码与语法高亮。
- **上游全部公共值**：`Highlighter`、`SyntaxHighlighter`。
- **上游定义**：[Highlighter:155](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L155) · [SyntaxHighlighter:158](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L158)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Highlighter`（32 位点）。
- **LobeHub 代表调用**：[src/components/HtmlPreview/PreviewDrawer.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/HtmlPreview/PreviewDrawer.tsx#L4) · [src/components/ManifestPreviewer/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ManifestPreviewer/index.tsx#L1)。
- **何时选哪种 / 打样场景**：消息代码、配置片段、工具输出；语言名称/复制/折叠。
- **相邻选择与禁用场景**：可编辑用 CodeEditor；变更用 CodeDiff。
- **状态、恢复与键盘合同**：高亮失败仍可读原文；大文本限制/懒加载；复制不含装饰行号。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L10)
- `enableTransformer`：`HighlighterProps['enableTransformer']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L12)
- `language`：`HighlighterProps['language']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L13)
- `theme`：`HighlighterProps['theme']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L15)
- `variant`：`HighlighterProps['variant']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L16)
- `actionIconSize`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L20)
- `actionsRender`：`(props: { actionIconSize: ActionIconProps['size']; content: string; getContent: () => string; language: string; originalNode: ReactNode; }) => ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L21)
- `actionIconSize`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L22)
- `allowChangeLanguage`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L28)
- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L29)
- `copyable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L37)
- `defaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L38)
- `enableTransformer`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L42)
- `fullFeatured`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L44)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L47)
- `showLanguage`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L48)
- `theme`：`'lobe-theme' | BundledHighlighterTheme` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L54)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L55)
- `wrap`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Highlighter/type.ts#L56)

<a id="ui.family.hotkey"></a>
### Hotkey → ShortcutHint

- **逐项深度规范**：[ui.spec.hotkey](./specs/content.md#ui.spec.hotkey)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：展示平台快捷键。
- **上游全部公共值**：`Hotkey`。
- **上游定义**：[Hotkey:162](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L162)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Hotkey`（5 位点）。
- **LobeHub 代表调用**：[src/features/ChatInput/InputEditor/Placeholder.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/ChatInput/InputEditor/Placeholder.tsx#L2) · [src/features/HotkeyHelperPanel/HotkeyContent.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/HotkeyHelperPanel/HotkeyContent.tsx#L1)。
- **何时选哪种 / 打样场景**：菜单右侧 cmd/ctrl；动作 tooltip。
- **相邻选择与禁用场景**：设置快捷键用 ShortcutField。
- **状态、恢复与键盘合同**：按平台映射；提示不自动注册全局事件；同动作不可显示冲突快捷键。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `compact`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Hotkey/type.ts#L9)
- `inverseTheme`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Hotkey/type.ts#L10)
- `isApple`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Hotkey/type.ts#L11)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Hotkey/type.ts#L16)

<a id="ui.family.hotkeyinput"></a>
### HotkeyInput → ShortcutField

- **逐项深度规范**：[ui.spec.hotkeyinput](./specs/input.md#ui.spec.hotkeyinput)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：录入和校验快捷键。
- **上游全部公共值**：`HotkeyInput`。
- **上游定义**：[HotkeyInput:163](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L163)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`HotkeyInput`（3 位点）。
- **LobeHub 代表调用**：[src/features/Settings/hotkey/features/Conversation.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Settings/hotkey/features/Conversation.tsx#L4) · [src/features/Settings/hotkey/features/Desktop.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Settings/hotkey/features/Desktop.tsx#L3)。
- **何时选哪种 / 打样场景**：设置全局与局部命令；冲突提示和恢复默认。
- **相邻选择与禁用场景**：普通文本用 TextField。
- **状态、恢复与键盘合同**：捕获期间明确提示；保留 Esc 退出；系统保留键不可抢占；注册由命令 owner 完成。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `allowClear`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HotkeyInput/type.ts#L4)
- `allowReset`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HotkeyInput/type.ts#L5)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HotkeyInput/type.ts#L8)
- `isApple`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HotkeyInput/type.ts#L10)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HotkeyInput/type.ts#L19)
- `variant`：`'filled' | 'borderless' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HotkeyInput/type.ts#L28)

<a id="ui.family.htmlpreview"></a>
### HtmlPreview → HtmlPreview

- **逐项深度规范**：[ui.spec.htmlpreview](./specs/media.md#ui.spec.htmlpreview)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：隔离查看不可信 HTML。
- **上游全部公共值**：`HtmlPreview`、`HtmlPreviewIframe`。
- **上游定义**：[HtmlPreview:168](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L168) · [HtmlPreviewIframe:170](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L170)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`HtmlPreview`（3 位点）；`HtmlPreviewIframe`（1 位点）。
- **LobeHub 代表调用**：[src/components/HtmlPreview/InlinePreview.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/HtmlPreview/InlinePreview.tsx#L1) · [src/components/HtmlPreview/PreviewDrawer.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/HtmlPreview/PreviewDrawer.tsx#L4)。
- **何时选哪种 / 打样场景**：Agent 生成页面和附件预览；显示来源和打开外部入口。
- **相邻选择与禁用场景**：普通 Markdown 不经 iframe；代码用 CodeBlock。
- **状态、恢复与键盘合同**：sandbox/CSP/消息校验属于 preview adapter；默认无主应用权限；不能访问宿主 credentials。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `HtmlPreviewMode`：`'preview' | 'source'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L6)
- `HtmlPreviewStreamingMode`：`'defer' | 'live' | 'auto'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L21)
- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L33)
- `actionIconSize`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L45)
- `actionsRender`：`(props: { actionIconSize: ActionIconProps['size']; content: string; getContent: () => string; mode: HtmlPreviewMode; originalNode: ReactNode; setMode: (mode: HtmlPreviewMode) => void; }) => ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L46)
- `actionIconSize`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L47)
- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L62)
- `copyable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L74)
- `defaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L79)
- `downloadable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L82)
- `fullFeatured`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L88)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L102)
- `showLanguage`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L104)
- `theme`：`'light' | 'dark'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L112)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/HtmlPreview/type.ts#L113)

<a id="ui.family.icon"></a>
### Icon → Icon / IconAssets

- **逐项深度规范**：[ui.spec.icon](./specs/identity.md#ui.spec.icon)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：统一图标语义与几何。
- **上游全部公共值**：`Icon`、`IconProvider`。
- **上游定义**：[Icon:178](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L178) · [IconProvider:178](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L178)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Icon`（835 位点）。
- **LobeHub 代表调用**：[src/components/AsyncError/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/AsyncError/index.tsx#L3) · [src/components/AvatarUpload/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/AvatarUpload/index.tsx#L3)。
- **何时选哪种 / 打样场景**：动作 glyph、状态 glyph、独立 BrandMark；固定 viewBox/线宽/圆端。
- **相邻选择与禁用场景**：不能把供应商 React 图标对象传给业务 API。
- **状态、恢复与键盘合同**：业务传 Peers icon ID；装饰 icon hidden；语义 icon 有 label；详见 icon-motion-spec.md。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `IconSizeType`：`'large' | 'middle' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Icon/type.ts#L9)
- `LucideIconProps`：`Pick< LucideProps, 'fill' | 'fillRule' | 'fillOpacity' | 'color' | 'focusable' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Icon/type.ts#L12)
- `spin`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Icon/type.ts#L21)

<a id="ui.family.image"></a>
### Image → Image / ImageViewer

- **逐项深度规范**：[ui.spec.image](./specs/media.md#ui.spec.image)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：显示并预览图片。
- **上游全部公共值**：`Image`、`PreviewGroup`。
- **上游定义**：[Image:180](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L180) · [PreviewGroup:183](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L183)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Image`（2 位点）。
- **本地替代候选**：[apps/desktop/src/components/chat/AttachmentItem.tsx:323](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/AttachmentItem.tsx#L323)。
- **LobeHub 直接使用**：`Image`（24 位点）；`PreviewGroup`（4 位点）。
- **antd 代表调用**：[apps/desktop/src/components/moments/ImageThumbnail.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/moments/ImageThumbnail.tsx#L2) · [apps/desktop/src/components/moments/PrivateMediaGrid.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/moments/PrivateMediaGrid.tsx#L2)。
- **LobeHub 代表调用**：[src/components/ImageItem/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ImageItem/index.tsx#L2) · [src/features/Acceptance/Report/ReportViewer.tsx:11](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Report/ReportViewer.tsx#L11)。
- **何时选哪种 / 打样场景**：inline、thumbnail、单图 viewer、PreviewGroup 组浏览。
- **相邻选择与禁用场景**：文件状态用 AttachmentItem；选择用 ImageChoice。
- **状态、恢复与键盘合同**：明确尺寸避免抖动；损坏/受限/下载态；缩放回到原位置；alt 与装饰政策明确。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `onOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L11)
- `ImageProps`：`Omit<ComponentProps<'img'>, 'width' | 'height'> & { actions?: ReactNode; alwaysShowActions?: boolean; classNames?: { image?: string; wrapper?: string }; height?: number | string; isLoading?: boolean; maxHeight?: number | string; maxWidth?: number | string; minHeight?: number | string; minWidth?: number | string; objectFit?: 'cover' | 'contain'; preview?: boolean | ImagePreviewOptions; ref?: Ref<HTMLDivElement>; size?: number | string; styles?: { image?: CSSProperties; wrapper?: CSSProperties }; variant?: 'borderless' | 'filled' | 'outlined'; width?: number | string; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L16)
- `alwaysShowActions`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L18)
- `isLoading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L21)
- `objectFit`：`'cover' | 'contain'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L26)
- `preview`：`boolean | ImagePreviewOptions` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L27)
- `variant`：`'borderless' | 'filled' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L31)
- `enable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L37)
- `preview`：`boolean | ImagePreviewOptions` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Image/type.ts#L38)

<a id="ui.family.imageselect"></a>
### ImageSelect → ImageChoice

- **逐项深度规范**：[ui.spec.imageselect](./specs/input.md#ui.spec.imageselect)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：用图像选一个或多个值。
- **上游全部公共值**：`ImageSelect`。
- **上游定义**：[ImageSelect:188](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L188)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ImageSelect`（1 位点）。
- **LobeHub 代表调用**：[src/features/Settings/common/features/Common/Common.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Settings/common/features/Common/Common.tsx#L3)。
- **何时选哪种 / 打样场景**：封面模板、Agent 形象、背景图。
- **相邻选择与禁用场景**：自由上传用 FileDropzone；普通文本选项用 Select。
- **状态、恢复与键盘合同**：radio/checkbox 语义；图片坏仍可选名称；触摸目标达标；选择与上传分离。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `icon`：`IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ImageSelect/type.ts#L8)
- `onChange`：`(value: this['value']) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ImageSelect/type.ts#L24)
- `unoptimized`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ImageSelect/type.ts#L31)

<a id="ui.family.input"></a>
### Input → TextField / NumberField / PinField / PasswordField / TextArea

- **逐项深度规范**：[ui.spec.input](./specs/input.md#ui.spec.input)；8 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：编辑原始文本或受约束值。
- **上游全部公共值**：`Input`、`InputNumber`、`InputOTP`、`InputPassword`、`TextArea`。
- **上游定义**：[Input:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/index.ts#L1) · [InputNumber:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/index.ts#L2) · [InputOTP:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/index.ts#L3) · [InputPassword:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/index.ts#L4) · [TextArea:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/index.ts#L6)。
- **Peers 直接使用**：`Input`（17 导入位点，57 JSX 位点；desktop/prototype）；`InputPassword`（2 导入位点，2 JSX 位点；desktop）；`TextArea`（8 导入位点，12 JSX 位点；desktop）。
- **antd 候选**：`Input` / Password、Search、TextArea（69 位点）；`InputNumber`（12 位点）。
- **本地替代候选**：[apps/desktop/src/components/common/PinInput.tsx:99](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/common/PinInput.tsx#L99)。
- **LobeHub 直接使用**：`Input`（150 位点）；`InputNumber`（17 位点）；`InputPassword`（12 位点）；`TextArea`（77 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/AgentSettingsModal.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSettingsModal.tsx#L4) · [apps/desktop/src/components/AgentSidebar.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSidebar.tsx#L8) · [apps/desktop/src/components/CronJobDrawer.tsx:15](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/CronJobDrawer.tsx#L15)。
- **antd 代表调用**：[apps/desktop/src/components/ChatInput.tsx:14](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ChatInput.tsx#L14) · [apps/desktop/src/components/LogsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/LogsTab.tsx#L4)。
- **LobeHub 代表调用**：[src/components/FeedbackModal/FeedbackContent.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/FeedbackModal/FeedbackContent.tsx#L4) · [src/components/FormInput/FormInput.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/FormInput/FormInput.tsx#L1)。
- **何时选哪种 / 打样场景**：短文/密码/数字/PIN/多行分开；prefix/suffix/help/error 属于 Field。
- **相邻选择与禁用场景**：查询用 SearchField；结构选择用 Select。
- **状态、恢复与键盘合同**：value/change/commit 区分；IME、粘贴、清空、显示密码有合同；不静默截断。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `InputVariant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L6)
- `InputSize`：`'small' | 'middle' | 'large'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L7)
- `BaseInputProps`：`Omit< ComponentProps<typeof BaseInput>, 'size' | 'prefix' | 'render' | 'className' | 'style' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L21)
- `allowClear`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L27)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L46)
- `visibilityToggle`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L72)
- `BaseNumberFieldProps`：`Omit< ComponentProps<typeof NumberField.Root>, 'className' | 'style' | 'render' | 'onValueChange' | 'children' | 'prefix' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L91)
- `changeOnWheel`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L100)
- `classNames`：`Pick<InputClassNames, 'input'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L102)
- `controls`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L107)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L114)
- `styles`：`Pick<InputStyles, 'input'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L117)
- `BaseOTPFieldProps`：`Omit< ComponentProps<typeof OTPField.Root>, 'className' | 'style' | 'render' | 'onValueChange' | 'children' | 'length' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L122)
- `classNames`：`Pick<InputClassNames, 'input'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L129)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L136)
- `styles`：`Pick<InputStyles, 'input'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L139)
- `TextAreaAutoSize`：`boolean | { maxRows?: number; minRows?: number }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L143)
- `allowClear`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L147)
- `classNames`：`Pick<InputClassNames, 'input'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L152)
- `resize`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L160)
- `showCount`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L161)
- `styles`：`Pick<InputStyles, 'input'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Input/type.ts#L162)

<a id="ui.family.layout"></a>
### Layout → PageLayout

- **逐项深度规范**：[ui.spec.layout](./specs/layout.md#ui.spec.layout)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：页面级边界和区域槽。
- **上游全部公共值**：`Layout`、`LayoutFooter`、`LayoutHeader`、`LayoutMain`、`LayoutSidebar`、`LayoutSidebarInner`、`LayoutToc`。
- **上游定义**：[Layout:196](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L196) · [LayoutFooter:197](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L197) · [LayoutHeader:199](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L199) · [LayoutMain:201](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L201) · [LayoutSidebar:204](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L204) · [LayoutSidebarInner:205](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L205) · [LayoutToc:208](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L208)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：header/main/sidebar/toc/footer；按平台 policy 分配。
- **相邻选择与禁用场景**：不重建 Boot kernel；局部布局用 Stack/Grid。
- **状态、恢复与键盘合同**：页面不订阅无关全局状态；内容和浮层独立滚动；main landmark 单一。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.list"></a>
### List → List / ListItem

- **逐项深度规范**：[ui.spec.list](./specs/content.md#ui.spec.list)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：同类对象序列。
- **上游全部公共值**：`List`。
- **上游定义**：[List:211](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L211)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`List` / Item、Item.Meta（8 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`List`（5 位点）。
- **antd 代表调用**：[apps/desktop/src/pages/moments/CircleManagePage.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/moments/CircleManagePage.tsx#L4) · [apps/desktop/src/pages/moments/UserSearchPage.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/moments/UserSearchPage.tsx#L4)。
- **LobeHub 代表调用**：[src/components/ChatGroupWizard/ChatGroupWizard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChatGroupWizard/ChatGroupWizard.tsx#L3) · [src/components/MemberSelectionModal/MemberSelectionModal.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/MemberSelectionModal/MemberSelectionModal.tsx#L4)。
- **何时选哪种 / 打样场景**：联系人、会话、文件、搜索结果；meta/action 槽和共享轨道。
- **相邻选择与禁用场景**：多列记录用 DataTable；超过测量阈值用 VirtualList。
- **状态、恢复与键盘合同**：稳定 key；加载追加保留滚动锚点；行点击与内部按钮不互相触发。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `danger`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L15)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L17)
- `icon`：`IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L20)
- `showAction`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L24)
- `type`：`'divider'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L31)
- `ListSemanticName`：`'actions' | 'description' | 'extra' | 'item' | 'label'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L36)
- `compact`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L41)
- `selectable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L47)
- `variant`：`'borderless' | 'filled' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/List/type.ts#L49)

<a id="ui.family.markdown"></a>
### Markdown → Markdown / RichText

- **逐项深度规范**：[ui.spec.markdown](./specs/content.md#ui.spec.markdown)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：渲染受控富文本。
- **上游全部公共值**：`Markdown`、`SearchResultCards`、`Typography`。
- **上游定义**：[Markdown:214](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L214) · [SearchResultCards:220](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L220) · [Typography:216](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L216)。
- **Peers 直接使用**：`Markdown`（2 导入位点，2 JSX 位点；applet）。
- **antd 候选**：`Typography` / Paragraph、Text、Title（165 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Markdown`（67 位点）；`SearchResultCards`（1 位点）；`Typography`（3 位点）。
- **Peers 代表调用**：[packages/applets/remote-cli/src/AgentChat.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/applets/remote-cli/src/AgentChat.tsx#L3) · [packages/applets/web-search/src/Page.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/applets/web-search/src/Page.tsx#L3)。
- **antd 代表调用**：[apps/desktop/src/applet/LynxContainer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/applet/LynxContainer.tsx#L3) · [apps/desktop/src/components/ConfigBadge.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ConfigBadge.tsx#L3)。
- **LobeHub 代表调用**：[src/components/CommentList/CommentItem.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/CommentList/CommentItem.tsx#L4) · [src/components/StreamingMarkdown/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/StreamingMarkdown/index.tsx#L3)。
- **何时选哪种 / 打样场景**：消息正文、流式内容、引用/代码/搜索来源；Typography 拆为 Text。
- **相邻选择与禁用场景**：HTML 预览用沙箱；编辑用 RichTextEditor。
- **状态、恢复与键盘合同**：统一 sanitizer/link policy；流式不重置选区和滚动；不执行内容中的命令。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `allowHtml`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L26)
- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L28)
- `enableCustomFootnotes`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L41)
- `enableGithubAlert`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L42)
- `enableHtmlPreview`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L43)
- `enableLatex`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L44)
- `enableMermaid`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L45)
- `enableStream`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L46)
- `fullFeaturedCodeBlock`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L47)
- `reactMarkdownProps`：`Omit< Readonly<ReactMarkdownOptions>, 'components' | 'rehypePlugins' | 'remarkPlugins' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L48)
- `showFootnotes`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L56)
- `variant`：`'default' | 'chat'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L59)
- `enableImageGallery`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Markdown/type.ts#L65)

<a id="ui.family.maskshadow"></a>
### MaskShadow → OverflowHint

- **逐项深度规范**：[ui.spec.maskshadow](./specs/layout.md#ui.spec.maskshadow)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：提示内容可继续滚动。
- **上游全部公共值**：`MaskShadow`。
- **上游定义**：[MaskShadow:230](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L230)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`MaskShadow`（4 位点）。
- **LobeHub 代表调用**：[src/features/Conversation/Messages/AssistantGroup/components/CollapsedMessage.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Conversation/Messages/AssistantGroup/components/CollapsedMessage.tsx#L1) · [src/features/Conversation/Messages/User/components/ContentPreview.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Conversation/Messages/User/components/ContentPreview.tsx#L1)。
- **何时选哪种 / 打样场景**：横向工具和竖向列表边缘渐隐。
- **相邻选择与禁用场景**：不能遮住最后动作；可滚动性也需键盘路径。
- **状态、恢复与键盘合同**：仅呈现辅助；不得拦截 pointer；与 ScrollShadow 同一能力实现。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `position`：`'top' | 'bottom' | 'left' | 'right'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaskShadow/type.ts#L4)
- `visibility`：`'auto' | 'always' | 'never'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaskShadow/type.ts#L6)

<a id="ui.family.materialfiletypeicon"></a>
### MaterialFileTypeIcon → FileTypeGlyph

- **逐项深度规范**：[ui.spec.filetypeicon](./specs/identity.md#ui.spec.filetypeicon)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：另一来源的文件类型资产候选。
- **上游全部公共值**：`MaterialFileTypeIcon`。
- **上游定义**：[MaterialFileTypeIcon:232](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L232)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`MaterialFileTypeIcon`（2 位点）。
- **LobeHub 代表调用**：[src/components/FileIcon/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/FileIcon/index.tsx#L1) · [src/features/CommunitySkillDetail/Details/Install/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/CommunitySkillDetail/Details/Install/index.tsx#L3)。
- **何时选哪种 / 打样场景**：用于源码对比与许可审计；目标仅保留一份类型映射。
- **相邻选择与禁用场景**：不同时引入两套 MIME 图标库。
- **状态、恢复与键盘合同**：外部资产可内化受控集合；glyph 名称由 Peers 定义；样式来源不成为产品 API。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `FileNamesKey`：`keyof (typeof iconMap)['fileNames']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaterialFileTypeIcon/type.ts#L5)
- `FolderNamesKey`：`keyof (typeof iconMap)['folderNames']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaterialFileTypeIcon/type.ts#L6)
- `FileExtensionsKey`：`keyof (typeof iconMap)['fileExtensions']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaterialFileTypeIcon/type.ts#L7)
- `fallbackUnknownType`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaterialFileTypeIcon/type.ts#L10)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaterialFileTypeIcon/type.ts#L12)
- `type`：`'file' | 'folder'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaterialFileTypeIcon/type.ts#L14)
- `variant`：`'raw' | 'file' | 'folder'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/MaterialFileTypeIcon/type.ts#L15)

<a id="ui.family.mermaid"></a>
### Mermaid → DiagramPreview

- **逐项深度规范**：[ui.spec.mermaid](./specs/code.md#ui.spec.mermaid)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：渲染文本图描述。
- **上游全部公共值**：`Mermaid`、`SyntaxMermaid`。
- **上游定义**：[Mermaid:236](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L236) · [SyntaxMermaid:239](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L239)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Mermaid`（3 位点）。
- **LobeHub 代表调用**：[src/components/mdx/CodeBlock.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/mdx/CodeBlock.tsx#L3) · [src/features/Portal/Artifacts/Body/Renderer/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Portal/Artifacts/Body/Renderer/index.tsx#L1)。
- **何时选哪种 / 打样场景**：Agent 图解释、文档附图；原文可查。
- **相邻选择与禁用场景**：产品固定架构图用仓库 renderer；编辑用 CodeEditor。
- **状态、恢复与键盘合同**：解析失败显示原文和错误；不安全指令受限；大图有资源边界；依赖隔离在 adapter。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L9)
- `theme`：`MermaidProps['theme']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L15)
- `variant`：`MermaidProps['variant']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L16)
- `actionIconSize`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L20)
- `actionsRender`：`(props: { actionIconSize: ActionIconProps['size']; content: string; getContent: () => string; originalNode: ReactNode; }) => ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L21)
- `actionIconSize`：`ActionIconProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L22)
- `animated`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L27)
- `copyable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L35)
- `defaultExpand`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L36)
- `fullFeatured`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L38)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L40)
- `showLanguage`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L41)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Mermaid/type.ts#L48)

<a id="ui.family.modal"></a>
### Modal → Dialog / ConfirmDialog

- **逐项深度规范**：[ui.spec.modal](./specs/overlay.md#ui.spec.modal)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：需要专注或明确承诺的任务。
- **上游全部公共值**：`Modal`、`ModalBackdrop`、`ModalClose`、`ModalContent`、`ModalDescription`、`ModalFooter`、`ModalHeader`、`ModalHost`、`ModalPopup`、`ModalPortal`、`ModalRoot`、`ModalTitle`、`ModalTrigger`、`ModalViewport`。
- **上游定义**：[Modal:39](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L39) · [ModalBackdrop:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L2) · [ModalClose:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L4) · [ModalContent:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L6) · [ModalDescription:8](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L8) · [ModalFooter:10](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L10) · [ModalHeader:12](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L12) · [ModalHost:35](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L35) · [ModalPopup:14](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L14) · [ModalPortal:16](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L16) · [ModalRoot:18](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L18) · [ModalTitle:20](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L20) · [ModalTrigger:22](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L22) · [ModalViewport:24](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/index.ts#L24)。
- **Peers 直接使用**：`Modal`（3 导入位点，3 JSX 位点；desktop/prototype）。
- **antd 候选**：`Modal`（54 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Modal`（4 位点）；`ModalClose`（1 位点）；`ModalFooter`（41 位点）；`ModalHeader`（1 位点）；`ModalHost`（2 位点）；`ModalTitle`（1 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/settings/channels/ChannelProvisioningPanel.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/channels/ChannelProvisioningPanel.tsx#L2) · [packages/prototypes/desktop/shell/src/LarkChannels.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/LarkChannels.tsx#L8) · [packages/prototypes/desktop/shell/src/Notifications.tsx:15](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/Notifications.tsx#L15)。
- **antd 代表调用**：[apps/desktop/src/components/AgentSettingsModal.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSettingsModal.tsx#L3) · [apps/desktop/src/components/AgentSidebar.tsx:10](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSidebar.tsx#L10)。
- **LobeHub 代表调用**：[src/features/MobileGroupChat/Topics.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/MobileGroupChat/Topics.tsx#L1) · [src/features/Portal/Mobile.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Portal/Mobile.tsx#L3)。
- **何时选哪种 / 打样场景**：创建编辑、删除确认、批准权限；内容/footer/标题/描述。
- **相邻选择与禁用场景**：轻信息用 Popover；侧补充用 Drawer；非承诺不弹窗。
- **状态、恢复与键盘合同**：焦点 trap/恢复；Escape 和遮罩受 dirty/commit 政策约束；同 intent 单实例。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `maskClosable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L17)
- `onOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L18)
- `onOpenChangeComplete`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L19)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L20)
- `setCanDismissByClickOutside`：`(value: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L36)
- `afterOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L53)
- `allowFullscreen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L54)
- `centered`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L57)
- `closable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L68)
- `confirmLoading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L70)
- `destroyOnHidden`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L71)
- `draggable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L72)
- `keyboard`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L80)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L81)
- `mask`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L82)
- `maskClosable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L83)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Modal/type.ts#L88)

<a id="ui.family.motionprovider"></a>
### MotionProvider → MotionPolicy

- **逐项深度规范**：[ui.spec.motionprovider](./specs/runtime.md#ui.spec.motionprovider)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：注入统一运动策略。
- **上游全部公共值**：`MotionComponent`、`MotionProvider`。
- **上游定义**：[MotionComponent:244](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L244) · [MotionProvider:244](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L244)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：reduced motion、平台 duration、静态验证模式。
- **相邻选择与禁用场景**：业务不直接提供 MotionComponent。
- **状态、恢复与键盘合同**：运动不决定业务完成；取消/卸载清理；同一 token 生成 CSS 和 Lynx policy。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.pagination"></a>
### Pagination → Pagination

- **逐项深度规范**：[ui.spec.pagination](./specs/navigation.md#ui.spec.pagination)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：明确切分大量结果。
- **上游全部公共值**：`Pagination`。
- **上游定义**：[Pagination:245](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L245)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Pagination`（5 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Pagination`（11 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/MemorySettingsSection.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/MemorySettingsSection.tsx#L4) · [apps/desktop/src/components/settings/MyFilesSettings.tsx:28](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/MyFilesSettings.tsx#L28)。
- **LobeHub 代表调用**：[src/features/AgentTasks/AgentTaskList/AgentTasksPage.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/AgentTaskList/AgentTasksPage.tsx#L1) · [src/routes/(main)/community/(detail)/user/features/UserAgentList.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/routes/%28main%29/community/%28detail%29/user/features/UserAgentList.tsx#L3)。
- **何时选哪种 / 打样场景**：后台记录和可深链接页码；pageSize 选择。
- **相邻选择与禁用场景**：会话/消息流用增量加载；不硬加页码。
- **状态、恢复与键盘合同**：页/总数/范围可读；切页取消旧请求；empty page 回到有效页；保留过滤上下文。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `PaginationSize`：`'small' | 'middle'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L5)
- `PaginationSemanticName`：`'item' | 'root'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L8)
- `PaginationItemType`：`'page' | 'prev' | 'next' | 'jump-prev' | 'jump-next'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L11)
- `PaginationAlign`：`'start' | 'center' | 'end'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L13)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L32)
- `hideOnSinglePage`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L33)
- `responsive`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L43)
- `showLessItems`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L45)
- `showQuickJumper`：`boolean | { goButton?: ReactNode }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L47)
- `showSizeChanger`：`boolean | PaginationSizeChangerProps` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L49)
- `showTitle`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L51)
- `simple`：`boolean | { readOnly?: boolean }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L54)
- `readOnly`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Pagination/type.ts#L54)

<a id="ui.family.popover"></a>
### Popover → Popover

- **逐项深度规范**：[ui.spec.popover](./specs/overlay.md#ui.spec.popover)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：锚定控件的短任务或详情。
- **上游全部公共值**：`Popover`、`PopoverArrow`、`PopoverArrowIcon`、`PopoverBackdrop`、`PopoverGroup`、`PopoverPopup`、`PopoverPortal`、`PopoverPositioner`、`PopoverProvider`、`PopoverRoot`、`PopoverTriggerElement`、`PopoverViewport`。
- **上游定义**：[Popover:247](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L247) · [PopoverArrow:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L3) · [PopoverArrowIcon:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L1) · [PopoverBackdrop:5](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L5) · [PopoverGroup:23](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L23) · [PopoverPopup:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L6) · [PopoverPortal:8](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L8) · [PopoverPositioner:10](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L10) · [PopoverProvider:19](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L19) · [PopoverRoot:12](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L12) · [PopoverTriggerElement:13](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L13) · [PopoverViewport:15](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/index.ts#L15)。
- **Peers 直接使用**：`Popover`（1 导入位点，1 JSX 位点；desktop）。
- **antd 候选**：`Popover`（8 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Popover`（75 位点）；`PopoverPopup`（1 位点）；`PopoverPortal`（1 位点）；`PopoverPositioner`（1 位点）；`PopoverRoot`（1 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/SkillAppletSelector.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillAppletSelector.tsx#L4)。
- **antd 代表调用**：[apps/desktop/src/components/BuilderPanel.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/BuilderPanel.tsx#L5) · [apps/desktop/src/components/ConfigBadge.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ConfigBadge.tsx#L3)。
- **LobeHub 代表调用**：[src/components/InlineRename/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/InlineRename/index.tsx#L3) · [src/components/ManifestPreviewer/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ManifestPreviewer/index.tsx#L1)。
- **何时选哪种 / 打样场景**：emoji 选择、局部说明、轻量编辑。
- **相邻选择与禁用场景**：命令用 Menu；阻断任务用 Dialog；纯提示用 Tooltip。
- **状态、恢复与键盘合同**：anchor identity/collision/focus 由统一 OverlayHost；内容可交互，outside/Escape 合同清楚。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `PopoverPositionerProps`：`Omit< BasePopoverPositionerProps, 'className' | 'style' | 'children' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L26)
- `PopoverTriggerComponentProps`：`Omit< BasePopoverTriggerProps, 'className' | 'style' | 'children' | 'render' | 'nativeButton' | 'handle' | 'payload' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L34)
- `PopoverPopupProps`：`Omit<BasePopoverPopupProps, 'className' | 'style' | 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L42)
- `PopoverBackdropProps`：`Omit<BasePopoverBackdropProps, 'className' | 'style'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L47)
- `PopoverPortalProps`：`Omit<BasePopoverPortalProps, 'children' | 'container'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L52)
- `arrow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L59)
- `defaultOpen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L99)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L105)
- `nativeButton`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L127)
- `onOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L132)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L137)
- `ref`：`ComponentPropsWithRef<typeof BasePopover.Trigger>['ref']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L168)
- `standalone`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Popover/type.ts#L173)

<a id="ui.family.progress"></a>
### Progress → Progress

- **逐项深度规范**：[ui.spec.progress](./specs/feedback.md#ui.spec.progress)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可量化工作的进度。
- **上游全部公共值**：`Progress`。
- **上游定义**：[Progress:249](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L249)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Progress`（11 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Progress`（15 位点）。
- **antd 代表调用**：[apps/desktop/src/components/MCPTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/MCPTab.tsx#L4) · [apps/desktop/src/components/SkillsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L4)。
- **LobeHub 代表调用**：[src/components/RatingOverview/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/RatingOverview/index.tsx#L3) · [src/features/AgentTasks/features/TaskSubtaskProgressTag.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/features/TaskSubtaskProgressTag.tsx#L3)。
- **何时选哪种 / 打样场景**：附件已传字节/总字节；分阶段导出；无总量用 indeterminate。
- **相邻选择与禁用场景**：无法测量不要显示假百分比；短等待用 BusyIndicator。
- **状态、恢复与键盘合同**：明确 source/单位；完成由业务事实；失败/暂停/恢复另有动作和状态。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ProgressType`：`'line' | 'circle'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Progress/type.ts#L3)
- `ProgressVariant`：`'line' | 'segments' | 'inset'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Progress/type.ts#L5)
- `ProgressStatus`：`'normal' | 'active' | 'success' | 'exception'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Progress/type.ts#L7)
- `ProgressSize`：`'small' | 'middle' | 'large' | number` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Progress/type.ts#L9)
- `showInfo`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Progress/type.ts#L18)

<a id="ui.family.progressiveblur"></a>
### ProgressiveBlur → SurfaceFade

- **逐项深度规范**：[ui.spec.progressiveblur](./specs/layout.md#ui.spec.progressiveblur)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：边缘视觉渐隐特效。
- **上游全部公共值**：`ProgressiveBlur`。
- **上游定义**：[ProgressiveBlur:251](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L251)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：只在批准的模块 envelope 且确有空间连续性意义时。
- **相邻选择与禁用场景**：普通列表优先 OverflowHint；默认不加装饰 blur。
- **状态、恢复与键盘合同**：不模糊正文/动作；性能和 reduced motion 独立验证；不是基础必选件。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ProgressiveBlurPosition`：`'top' | 'bottom' | 'left' | 'right'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ProgressiveBlur/type.ts#L3)
- `ProgressiveBlurMode`：`'auto' | 'blur' | 'gradient'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ProgressiveBlur/type.ts#L11)
- `children`：`HTMLAttributes<HTMLDivElement>['children']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ProgressiveBlur/type.ts#L39)

<a id="ui.family.provider"></a>
### Provider → UIProvider

- **逐项深度规范**：[ui.spec.configprovider](./specs/runtime.md#ui.spec.configprovider)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：上游 LobeUIProvider 聚合入口候选。
- **上游全部公共值**：`LobeUIProvider`。
- **上游定义**：[LobeUIProvider:253](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L253)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **何时选哪种 / 打样场景**：审计其配置依赖；目标合并 ConfigProvider 和 MotionPolicy。
- **相邻选择与禁用场景**：不复制成另一个 Peers Provider 根。
- **状态、恢复与键盘合同**：只保留一个应用 UI owner；theme/locale/overlay contracts 明确；第三方 props 不公开。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.qrcode"></a>
### QRCode → QrCode

- **逐项深度规范**：[ui.spec.qrcode](./specs/media.md#ui.spec.qrcode)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：将有期限的 payload 转成机器可扫符号。
- **上游全部公共值**：`QRCode`。
- **上游定义**：[QRCode:254](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L254)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`QRCode`（5 位点）。
- **LobeHub 代表调用**：[src/features/AgentChannel/platform/wechat/QrCodeAuth.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentChannel/platform/wechat/QrCodeAuth.tsx#L3) · [src/features/AgentChannel/quickSetup/FeishuQuickCreate.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentChannel/quickSetup/FeishuQuickCreate.tsx#L3)。
- **何时选哪种 / 打样场景**：设备绑定、扫码登录、分享；loading/expired/refreshed 分开。
- **相邻选择与禁用场景**：装饰二维码图标不构成可扫码；扫码输入由设备能力完成。
- **状态、恢复与键盘合同**：quiet zone/对比/纠错级别明确；过期不继续展示有效态；值不得进入截图日志。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `QRCodeErrorLevel`：`'L' | 'M' | 'Q' | 'H'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/QRCode/type.ts#L3)
- `QRCodeStatus`：`'active' | 'loading' | 'expired'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/QRCode/type.ts#L4)
- `bordered`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/QRCode/type.ts#L8)

<a id="ui.family.radio"></a>
### Radio → Radio / RadioGroup

- **逐项深度规范**：[ui.spec.radio](./specs/input.md#ui.spec.radio)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：少量互斥值。
- **上游全部公共值**：`Radio`、`RadioGroup`。
- **上游定义**：[Radio:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/index.ts#L1) · [RadioGroup:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/index.ts#L2)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Radio` / Group（4 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`RadioGroup`（3 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/ProviderMenu.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/ProviderMenu.tsx#L4) · [apps/mobile/src/pages/ContactsPage.tsx:11](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/pages/ContactsPage.tsx#L11)。
- **LobeHub 代表调用**：[src/features/ChatInput/ControlBar/HeteroControlBar/QuotaMenu/QuotaAccountManagerModal.tsx:6](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/ChatInput/ControlBar/HeteroControlBar/QuotaMenu/QuotaAccountManagerModal.tsx#L6) · [src/features/PluginDevModal/MCPManifestForm/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/PluginDevModal/MCPManifestForm/index.tsx#L2)。
- **何时选哪种 / 打样场景**：权限范围、发布模式、少量设置选择。
- **相邻选择与禁用场景**：更多候选用 Select；视图切换用 Segmented。
- **状态、恢复与键盘合同**：方向键选择，组一个 tab stop；必选/可清空明确；受限选项有原因。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `BaseRadioProps`：`Omit< ComponentProps<typeof BaseRadio.Root>, 'className' | 'style' | 'render' | 'children' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/type.ts#L9)
- `textProps`：`DistributiveOmit<TextProps, 'children' | 'className' | 'style'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/type.ts#L34)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/type.ts#L38)
- `BaseRadioGroupProps`：`Omit< BaseRadioGroup.Props<string>, 'className' | 'style' | 'render' | 'children' | 'onValueChange' | 'onChange' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/type.ts#L43)
- `gap`：`FlexboxProps['gap']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/type.ts#L54)
- `horizontal`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/type.ts#L59)
- `textProps`：`RadioProps['textProps']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Radio/type.ts#L64)

<a id="ui.family.rate"></a>
### Rate → Rating

- **逐项深度规范**：[ui.spec.rate](./specs/input.md#ui.spec.rate)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：表达有量尺的评分。
- **上游全部公共值**：`Rate`。
- **上游定义**：[Rate:257](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L257)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Rate`（1 位点）。
- **LobeHub 代表调用**：[src/components/RatingOverview/Rate.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/RatingOverview/Rate.tsx#L1)。
- **何时选哪种 / 打样场景**：反馈或质量评估需说明尺度；只读与可编辑分开。
- **相邻选择与禁用场景**：满意/不满意用 ToggleGroup；系统状态不用星级。
- **状态、恢复与键盘合同**：键盘量尺；未评分不同于零；失败恢复前值；不能把评分当事实质量证明。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `allowHalf`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Rate/type.ts#L7)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Rate/type.ts#L12)
- `readOnly`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Rate/type.ts#L15)

<a id="ui.family.react-error-boundary"></a>
### react-error-boundary → ViewErrorBoundary

- **逐项深度规范**：[ui.spec.react-error-boundary](./specs/runtime.md#ui.spec.react-error-boundary)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：限制渲染故障影响范围。
- **上游全部公共值**：`ErrorBoundary`。
- **上游定义**：[ErrorBoundary:338](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L338)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ErrorBoundary`（1 位点）。
- **LobeHub 代表调用**：[src/components/ErrorBoundary/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ErrorBoundary/index.tsx#L3)。
- **何时选哪种 / 打样场景**：页面/预览/扩展视图异常局部降级。
- **相邻选择与禁用场景**：网络失败用 RecoveryState；业务失败不靠 catch-all。
- **状态、恢复与键盘合同**：reset key 绑定对象；提供恢复且不丢业务草稿；报告红acted，不能无限自动重试。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.result"></a>
### Result → ResultState

- **逐项深度规范**：[ui.spec.result](./specs/feedback.md#ui.spec.result)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：完整任务的结果或整面阻断。
- **上游全部公共值**：`Result`。
- **上游定义**：[Result:259](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L259)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Result`（1 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Result`（11 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/OAuth2ConnectModal.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/OAuth2ConnectModal.tsx#L3)。
- **LobeHub 代表调用**：[src/features/Auth/MarketAuthCallback/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Auth/MarketAuthCallback/index.tsx#L3) · [src/features/Auth/OAuthAuthorizeError/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Auth/OAuthAuthorizeError/index.tsx#L3)。
- **何时选哪种 / 打样场景**：设备绑定完成、权限阻断、不可恢复错误。
- **相邻选择与禁用场景**：局部消息用 InlineAlert；无内容用 EmptyState。
- **状态、恢复与键盘合同**：结果来源由业务确认；成功有下一步，失败区分重试/返回/联系 owner。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ResultStatus`：`'success' | 'error' | 'info' | 'warning'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Result/type.ts#L3)

<a id="ui.family.scrollarea"></a>
### ScrollArea → ScrollArea

- **逐项深度规范**：[ui.spec.scrollarea](./specs/layout.md#ui.spec.scrollarea)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：受控滚动容器。
- **上游全部公共值**：`ScrollArea`、`ScrollAreaContent`、`ScrollAreaCorner`、`ScrollAreaRoot`、`ScrollAreaScrollbar`、`ScrollAreaThumb`、`ScrollAreaViewport`。
- **上游定义**：[ScrollArea:17](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/index.ts#L17) · [ScrollAreaContent:10](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/index.ts#L10) · [ScrollAreaCorner:11](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/index.ts#L11) · [ScrollAreaRoot:12](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/index.ts#L12) · [ScrollAreaScrollbar:13](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/index.ts#L13) · [ScrollAreaThumb:14](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/index.ts#L14) · [ScrollAreaViewport:15](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/index.ts#L15)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ScrollArea`（14 位点）。
- **LobeHub 代表调用**：[src/components/ChangelogModal/ChangelogModalContent.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChangelogModal/ChangelogModalContent.tsx#L3) · [src/components/PublishConfirmModal/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/PublishConfirmModal/index.tsx#L1)。
- **何时选哪种 / 打样场景**：代码块、列表、面板独立 viewport。
- **相邻选择与禁用场景**：可以原生滚动则优先原生；不造全局滚动调度。
- **状态、恢复与键盘合同**：键盘/触摸/滚轮可达；保留锚点；滚动条不遮动作；清理 resize/scroll observer。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `contentProps`：`Omit<ScrollAreaContentProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/type.ts#L15)
- `corner`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/type.ts#L16)
- `disableContentFit`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/type.ts#L26)
- `scrollbarProps`：`Omit<ScrollAreaScrollbarProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/type.ts#L27)
- `scrollFade`：`boolean | ScrollAreaFadeOrientation` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/type.ts#L36)
- `viewportProps`：`Omit<ScrollAreaViewportProps, 'children' | 'scrollFade'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollArea/type.ts#L38)

<a id="ui.family.scrollshadow"></a>
### ScrollShadow → OverflowHint

- **逐项深度规范**：[ui.spec.maskshadow](./specs/layout.md#ui.spec.maskshadow)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：说明可滚动内容的边缘。
- **上游全部公共值**：`ScrollShadow`。
- **上游定义**：[ScrollShadow:263](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L263)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ScrollShadow`（17 位点）。
- **LobeHub 代表调用**：[src/features/AgentGoals/AgentGoalsPage.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentGoals/AgentGoalsPage.tsx#L3) · [src/features/AgentSidebar/Topic/TopicListContent/ThreadList/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentSidebar/Topic/TopicListContent/ThreadList/index.tsx#L1)。
- **何时选哪种 / 打样场景**：与 MaskShadow 合并；横向 chips 和日志长文本。
- **相邻选择与禁用场景**：不用渐隐隐藏信息或强制装饰。
- **状态、恢复与键盘合同**：读取滚动位置仅本地；边缘状态不驱动业务；overflow 隐藏时仍可键盘读取。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `hideScrollBar`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L6)
- `isEnabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L7)
- `onVisibilityChange`：`(visibility: { bottom?: boolean; left?: boolean; right?: boolean; top?: boolean; }) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L9)
- `bottom`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L10)
- `left`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L11)
- `right`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L12)
- `top`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L13)
- `orientation`：`'vertical' | 'horizontal'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L15)
- `visibility`：`'auto' | 'always' | 'never'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ScrollShadow/type.ts#L18)

<a id="ui.family.searchbar"></a>
### SearchBar → SearchField

- **逐项深度规范**：[ui.spec.searchbar](./specs/input.md#ui.spec.searchbar)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：具有查询语义的输入。
- **上游全部公共值**：`SearchBar`。
- **上游定义**：[SearchBar:264](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L264)。
- **Peers 直接使用**：`SearchBar`（5 导入位点，6 JSX 位点；desktop）。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`SearchBar`（36 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/AgentSidebar.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSidebar.tsx#L8) · [apps/desktop/src/components/agent/workbench/AgentRail.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/agent/workbench/AgentRail.tsx#L2) · [apps/desktop/src/components/settings/DiscoverSettings.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/DiscoverSettings.tsx#L4)。
- **LobeHub 代表调用**：[src/components/ChatGroupWizard/ChatGroupWizard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChatGroupWizard/ChatGroupWizard.tsx#L3) · [src/components/MemberSelectionModal/MemberSelectionModal.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/MemberSelectionModal/MemberSelectionModal.tsx#L4)。
- **何时选哪种 / 打样场景**：局部实时过滤、提交式全局搜索、清空/取消；scope 可见。
- **相邻选择与禁用场景**：普通值编辑用 TextField；大搜索工作区用 SearchWorkspace。
- **状态、恢复与键盘合同**：query 与 result 独立；debounce/cancel/stale response 合同；empty/error 分开。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `enableShortKey`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/SearchBar/type.ts#L11)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/SearchBar/type.ts#L12)
- `spotlight`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/SearchBar/type.ts#L16)

<a id="ui.family.segmented"></a>
### Segmented → SegmentedControl

- **逐项深度规范**：[ui.spec.segmented](./specs/input.md#ui.spec.segmented)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：在少量同层视图或显示模式中切换。
- **上游全部公共值**：`Segmented`、`SegmentedIndicator`、`SegmentedItem`、`SegmentedItemIcon`、`SegmentedItemLabel`、`SegmentedRoot`。
- **上游定义**：[Segmented:265](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L265) · [SegmentedIndicator:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/index.ts#L2) · [SegmentedItem:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/index.ts#L4) · [SegmentedItemIcon:5](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/index.ts#L5) · [SegmentedItemLabel:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/index.ts#L6) · [SegmentedRoot:8](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/index.ts#L8)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Segmented`（16 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Segmented`（30 位点）。
- **antd 代表调用**：[apps/desktop/src/components/CronJobDrawer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/CronJobDrawer.tsx#L3) · [apps/desktop/src/components/agent/AgentModuleNav.tsx:1](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/agent/AgentModuleNav.tsx#L1)。
- **LobeHub 代表调用**：[src/features/Acceptance/Report/TerminalEvidence/TerminalEvidenceCard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Report/TerminalEvidence/TerminalEvidenceCard.tsx#L3) · [src/features/AgentChannel/PlatformDetail/QuickView.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentChannel/PlatformDetail/QuickView.tsx#L3)。
- **何时选哪种 / 打样场景**：列表/网格、时间维度、局部筛选；支持 icon+label。
- **相邻选择与禁用场景**：页面内容层级用 Tabs；表单值用 Radio。
- **状态、恢复与键盘合同**：互斥单值；role 按 view/value 选择；切换不丢独立输入；active 指示不只靠色。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `SegmentedSize`：`'large' | 'middle' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L4)
- `SegmentedVariant`：`'filled' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L5)
- `SegmentedOrientation`：`'horizontal' | 'vertical'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L6)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L10)
- `SegmentedRootProps`：`Omit< ComponentProps<typeof BaseUIToggleGroup<Value>>, 'className' | 'render' | 'value' | 'defaultValue' | 'onValueChange' | 'multiple' > & { className?: string; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L42)
- `block`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L50)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L55)
- `glass`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L56)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L62)
- `vertical`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Segmented/type.ts#L69)

<a id="ui.family.select"></a>
### Select → Select / MultiSelect

- **逐项深度规范**：[ui.spec.select](./specs/input.md#ui.spec.select)；6 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：从已有集合中选值。
- **上游全部公共值**：`Select`、`SelectArrow`、`SelectBackdrop`、`SelectGroup`、`SelectGroupLabel`、`SelectIcon`、`SelectItem`、`SelectItemIndicator`、`SelectItemText`、`SelectList`、`SelectPopup`、`SelectPortal`、`SelectPositioner`、`SelectRoot`、`SelectScrollDownArrow`、`SelectScrollUpArrow`、`SelectSeparator`、`SelectTrigger`、`SelectValue`。
- **上游定义**：[Select:267](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L267) · [SelectArrow:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L2) · [SelectBackdrop:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L4) · [SelectGroup:5](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L5) · [SelectGroupLabel:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L6) · [SelectIcon:9](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L9) · [SelectItem:11](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L11) · [SelectItemIndicator:12](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L12) · [SelectItemText:15](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L15) · [SelectList:17](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L17) · [SelectPopup:19](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L19) · [SelectPortal:21](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L21) · [SelectPositioner:23](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L23) · [SelectRoot:25](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L25) · [SelectScrollDownArrow:26](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L26) · [SelectScrollUpArrow:28](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L28) · [SelectSeparator:30](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L30) · [SelectTrigger:31](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L31) · [SelectValue:33](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/index.ts#L33)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Select` / Option（40 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Select`（95 位点）。
- **antd 代表调用**：[apps/desktop/src/components/AgentSettingsModal.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSettingsModal.tsx#L3) · [apps/desktop/src/components/BuilderPanel.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/BuilderPanel.tsx#L5)。
- **LobeHub 代表调用**：[src/components/JSONSchemaConfig/ItemRender.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/JSONSchemaConfig/ItemRender.tsx#L1) · [src/components/TablePagination/PageSizeSelect.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/TablePagination/PageSizeSelect.tsx#L3)。
- **何时选哪种 / 打样场景**：模型、成员、语言；search/multi/clear/virtual 是明确能力。
- **相邻选择与禁用场景**：允许自由输入用 Autocomplete；少量互斥用 Radio。
- **状态、恢复与键盘合同**：键盘 typeahead/箭头/Esc；搜索不改已选值；未知已选项可读；多选删除逐项可达。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `SelectSize`：`'large' | 'middle' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L9)
- `SelectVariant`：`'borderless' | 'filled' | 'outlined'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L10)
- `SelectBehaviorVariant`：`'default' | 'item-aligned'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L11)
- `SelectIndicatorVariant`：`'check' | 'bold'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L18)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L22)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L30)
- `allowClear`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L62)
- `autoFocus`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L63)
- `defaultOpen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L74)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L76)
- `filterOption`：`boolean | ((input: string, option: SelectOption<Value>) => boolean)` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L81)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L89)
- `mode`：`'multiple' | 'tags'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L90)
- `onOpenChange`：`(open: boolean, eventDetails?: SelectRootChangeEventDetails) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L96)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L100)
- `popupMatchSelectWidth`：`boolean | number` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L105)
- `prefix`：`ReactNode | IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L106)
- `readOnly`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L107)
- `required`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L108)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L116)
- `showSearch`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L117)
- `suffixIcon`：`IconProps['icon'] | ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L120)
- `suffixIconProps`：`Omit<IconProps, 'icon'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Select/type.ts#L121)

<a id="ui.family.sidenav"></a>
### SideNav → NavigationRail

- **逐项深度规范**：[ui.spec.sidenav](./specs/navigation.md#ui.spec.sidenav)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：持久的主导航或对象列表入口。
- **上游全部公共值**：`SideNav`。
- **上游定义**：[SideNav:269](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L269)。
- **Peers 直接使用**：`SideNav`（1 导入位点，1 JSX 位点；desktop）。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：该族未直接引用。
- **Peers 代表调用**：[apps/desktop/src/components/AppSideNav.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AppSideNav.tsx#L3)。
- **何时选哪种 / 打样场景**：desktop rail；mobile 同语义适配底部导航；active/notification。
- **相邻选择与禁用场景**：局部 tabs 用 Tabs；tree 用 Tree。
- **状态、恢复与键盘合同**：位置由 Shell 管理；route active 与 unread 分离；隐藏树生命周期遵循平台合同。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.skeleton"></a>
### Skeleton → Skeleton

- **逐项深度规范**：[ui.spec.skeleton](./specs/feedback.md#ui.spec.skeleton)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：已知结构加载期间的占位。
- **上游全部公共值**：`Skeleton`、`SkeletonAvatar`、`SkeletonText`。
- **上游定义**：[Skeleton:270](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L270) · [SkeletonAvatar:19](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Skeleton/index.ts#L19) · [SkeletonText:20](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Skeleton/index.ts#L20)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Skeleton` / Avatar、Input（6 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Skeleton`（133 位点）；`SkeletonAvatar`（3 位点）；`SkeletonText`（6 位点）。
- **antd 代表调用**：[apps/desktop/src/components/ModelProviderSelect.tsx:6](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ModelProviderSelect.tsx#L6) · [apps/desktop/src/components/agent/workbench/AgentRail.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/agent/workbench/AgentRail.tsx#L4)。
- **LobeHub 代表调用**：[src/components/EmojiPicker/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/EmojiPicker/index.tsx#L2) · [src/components/ListSkeleton/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ListSkeleton/index.tsx#L3)。
- **何时选哪种 / 打样场景**：头像+文本行；首屏卡；局部内容渐进。
- **相邻选择与禁用场景**：未知结构短等用 BusyIndicator；失败不能无限骨架。
- **状态、恢复与键盘合同**：占位匹配终态尺寸；不反复闪烁；aria-busy 在真实 owner；reduced motion 去 shimmer。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `SkeletonAnimation`：`'fade' | 'sweep'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Skeleton/type.ts#L3)
- `animated`：`boolean | SkeletonAnimation` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Skeleton/type.ts#L6)
- `shape`：`'circle' | 'square'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Skeleton/type.ts#L21)

<a id="ui.family.slider"></a>
### Slider → Slider / SliderField

- **逐项深度规范**：[ui.spec.slider](./specs/input.md#ui.spec.slider)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：连续或步进范围调整。
- **上游全部公共值**：`Slider`、`SliderWithInput`。
- **上游定义**：[Slider:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/index.ts#L1) · [SliderWithInput:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/index.ts#L2)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Slider`（3 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Slider`（5 位点）；`SliderWithInput`（7 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/ProviderDetail.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/ProviderDetail.tsx#L4) · [apps/desktop/src/components/settings/TTSSettings.tsx:14](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/TTSSettings.tsx#L14)。
- **LobeHub 代表调用**：[src/components/DiscreteSlider/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/DiscreteSlider/index.tsx#L2) · [src/components/JSONSchemaConfig/ItemRender.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/JSONSchemaConfig/ItemRender.tsx#L1)。
- **何时选哪种 / 打样场景**：音量、温度、缩放；精确值配 NumberField。
- **相邻选择与禁用场景**：无序类别用 Select；高精度只需数字用 NumberField。
- **状态、恢复与键盘合同**：箭头/Home/End；step/范围/单位可读；预览与 commit 区分；避免每 tick 远端提交。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `BaseSliderProps`：`Omit< ComponentProps<typeof BaseSlider.Root>, | 'className' | 'style' | 'render' | 'children' | 'onValueChange' | 'value' | 'defaultValue' | 'onChange' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L7)
- `changeOnWheel`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L41)
- `classNames`：`SliderProps['classNames'] & { input?: string; slider?: string; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L42)
- `controls`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L46)
- `gap`：`FlexboxProps['gap']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L47)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L48)
- `size`：`InputNumberProps['size']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L49)
- `styles`：`SliderProps['styles'] & { input?: CSSProperties; slider?: CSSProperties; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L50)
- `unlimitedInput`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Slider/type.ts#L54)

<a id="ui.family.snippet"></a>
### Snippet → CodeSnippet

- **逐项深度规范**：[ui.spec.snippet](./specs/code.md#ui.spec.snippet)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：短可复制代码片段。
- **上游全部公共值**：`Snippet`。
- **上游定义**：[Snippet:273](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L273)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Snippet`（6 位点）。
- **LobeHub 代表调用**：[src/components/OllamaSetupGuide/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/OllamaSetupGuide/index.tsx#L1) · [src/features/Electron/HeterogeneousAgent/StatusGuide/states/AuthRequiredState.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Electron/HeterogeneousAgent/StatusGuide/states/AuthRequiredState.tsx#L2)。
- **何时选哪种 / 打样场景**：命令行、token 模板、安装步骤。
- **相邻选择与禁用场景**：长代码用 CodeBlock；敏感密钥用 SecretValue。
- **状态、恢复与键盘合同**：不自动执行；复制结果可核验；换行/占位符语义明确；错误给原文。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `copyable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Snippet/type.ts#L7)
- `shadow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Snippet/type.ts#L11)
- `spotlight`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Snippet/type.ts#L12)
- `variant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Snippet/type.ts#L13)

<a id="ui.family.sortablelist"></a>
### SortableList → ReorderableList

- **逐项深度规范**：[ui.spec.sortablelist](./specs/input.md#ui.spec.sortablelist)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：用户改变稳定对象顺序。
- **上游全部公共值**：`SortableList`。
- **上游定义**：[SortableList:274](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L274)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`SortableList`（17 位点）。
- **LobeHub 代表调用**：[src/features/AgentSetting/AgentOpening/OpeningQuestions.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentSetting/AgentOpening/OpeningQuestions.tsx#L3) · [src/features/DeviceManager/DeviceDetail.tsx:5](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/DeviceManager/DeviceDetail.tsx#L5)。
- **何时选哪种 / 打样场景**：Agent 工具排序、导航自定义、附件顺序。
- **相邻选择与禁用场景**：普通阅读用 List；重新筛选不叫拖拽排序。
- **状态、恢复与键盘合同**：拖拽和上移/下移按钮等价；提交失败恢复前序；stable ID 与 index 分离。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.spin"></a>
### Spin → BusyIndicator

- **逐项深度规范**：[ui.spec.spin](./specs/feedback.md#ui.spec.spin)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：无法量化的短等待。
- **上游全部公共值**：`Spin`。
- **上游定义**：[Spin:275](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L275)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Spin`（67 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Spin`（128 位点）。
- **antd 代表调用**：[apps/desktop/src/applet/LynxContainer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/applet/LynxContainer.tsx#L3) · [apps/desktop/src/components/MCPTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/MCPTab.tsx#L4)。
- **LobeHub 代表调用**：[src/components/AsyncBoundary/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/AsyncBoundary/index.tsx#L3) · [src/components/AvatarUpload/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/AvatarUpload/index.tsx#L3)。
- **何时选哪种 / 打样场景**：局部操作 pending；首次连接。
- **相邻选择与禁用场景**：可测进度用 Progress；加载结构用 Skeleton。
- **状态、恢复与键盘合同**：说明在等什么；长等待给取消/恢复；不把旋转动画当作 action 正在执行的唯一证据。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `SpinSize`：`'small' | 'middle' | 'large' | number` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Spin/type.ts#L3)
- `SpinVariant`：`'default' | 'network'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Spin/type.ts#L5)
- `spinning`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Spin/type.ts#L13)

<a id="ui.family.statistic"></a>
### Statistic → Metric

- **逐项深度规范**：[ui.spec.statistic](./specs/content.md#ui.spec.statistic)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：展示带单位和时间范围的数值。
- **上游全部公共值**：`Statistic`。
- **上游定义**：[Statistic:277](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L277)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Statistic`（5 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Statistic`（1 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/AgentGrowthTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/AgentGrowthTab.tsx#L4) · [apps/station/app/subserver/dashboard/web/src/pages/NodesPage.tsx:15](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/station/app/subserver/dashboard/web/src/pages/NodesPage.tsx#L15)。
- **LobeHub 代表调用**：[src/components/StatisticCard/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/StatisticCard/index.tsx#L2)。
- **何时选哪种 / 打样场景**：用量、成本、连接数；变化对比明确基期。
- **相邻选择与禁用场景**：状态用 StatusTag；业务仪表盘由 domain 组合。
- **状态、恢复与键盘合同**：stale/unknown/zero 区分；不可凭动画假增长；locale 格式、精度和趋势方向受控。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Statistic/type.ts#L6)

<a id="ui.family.steps"></a>
### Steps → StepProgress

- **逐项深度规范**：[ui.spec.steps](./specs/navigation.md#ui.spec.steps)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：线性或有分支的任务位置。
- **上游全部公共值**：`Steps`。
- **上游定义**：[Steps:279](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L279)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Steps`（6 位点）。
- **LobeHub 代表调用**：[src/components/OllamaSetupGuide/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/OllamaSetupGuide/index.tsx#L1) · [src/features/AgentGoals/GoalHowItWorksModal/HowItWorksContent.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentGoals/GoalHowItWorksModal/HowItWorksContent.tsx#L3)。
- **何时选哪种 / 打样场景**：设备绑定、身份恢复、导入过程。
- **相邻选择与禁用场景**：平级浏览用 Tabs；长章节用 SectionNav。
- **状态、恢复与键盘合同**：done/current/blocked/error 可读；回跳是否可编辑由 journey 决定；不能按动画直接完成步骤。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `StepStatus`：`'wait' | 'process' | 'finish' | 'error'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Steps/type.ts#L3)
- `orientation`：`'horizontal' | 'vertical'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Steps/type.ts#L17)
- `variant`：`'default' | 'dot'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Steps/type.ts#L25)

<a id="ui.family.styles"></a>
### styles → ThemeBoundary / ThemeBootstrap

- **逐项深度规范**：[ui.spec.styles](./specs/runtime.md#ui.spec.styles)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：主题初始化与获准局部表达。
- **上游全部公共值**：`LobeThemeScript`、`ThemeScope`。
- **上游定义**：[LobeThemeScript:40](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/styles/index.ts#L40) · [ThemeScope:45](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/styles/index.ts#L45)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ThemeScope`（1 位点）。
- **LobeHub 代表调用**：[src/utils/router.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/utils/router.tsx#L3)。
- **何时选哪种 / 打样场景**：避免首屏闪烁；模块有限 token narrowing；dark/light。
- **相邻选择与禁用场景**：业务不能 setLobeTheme；不新增平行 theme Store。
- **状态、恢复与键盘合同**：同一 token 真源；bootstrap 与 live config 一致；SSR/宿主未就绪有后备。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

上游类型轴没有在族根 type.ts/types.ts 直接抽取到；可能来自组件文件或继承类型。不能据此断言没有变体，使用完整源码入口审阅。

<a id="ui.family.switch"></a>
### Switch → Switch

- **逐项深度规范**：[ui.spec.switch](./specs/input.md#ui.spec.switch)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：立即生效的单项设置。
- **上游全部公共值**：`Switch`、`SwitchIcon`、`SwitchRoot`、`SwitchThumb`。
- **上游定义**：[Switch:283](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L283) · [SwitchIcon:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/index.ts#L1) · [SwitchRoot:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/index.ts#L1) · [SwitchThumb:1](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/index.ts#L1)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Switch`（23 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Switch`（58 位点）。
- **antd 代表调用**：[apps/desktop/src/components/CronJobDrawer.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/CronJobDrawer.tsx#L3) · [apps/desktop/src/components/LogsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/LogsTab.tsx#L4)。
- **LobeHub 代表调用**：[src/components/ChatGroupWizard/ChatGroupWizard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChatGroupWizard/ChatGroupWizard.tsx#L3) · [src/components/InstantSwitch/index.tsx:2](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/InstantSwitch/index.tsx#L2)。
- **何时选哪种 / 打样场景**：通知开关、显示选项；需远端保存时 pending。
- **相邻选择与禁用场景**：提交表单里的布尔用 Checkbox；危险操作用确认。
- **状态、恢复与键盘合同**：Space 切换；label 不随 on/off 改意图；远端失败 rollback；权限拒绝原因内联。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `SwitchSize`：`'default' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L12)
- `SwitchChangeEventHandler`：`( checked: boolean, event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>, ) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L14)
- `isChecked`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L34)
- `isPressed`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L35)
- `setIsChecked`：`(checked: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L36)
- `setIsPressed`：`(pressed: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L37)
- `SwitchRootProps`：`Omit<ComponentProps<typeof Switch.Root>, 'render'> & ComponentProps<'button'> & { size?: SwitchSize; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L40)
- `SwitchThumbProps`：`Omit<ComponentProps<typeof Switch.Thumb>, 'render'> & ComponentProps<'span'> & { size?: SwitchSize; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L45)
- `SwitchIconPosition`：`'left' | 'right' | 'thumb'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L50)
- `SwitchIconProps`：`ComponentProps<'span'> & { position: SwitchIconPosition; size?: SwitchSize; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L52)
- `autoFocus`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L65)
- `checked`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L69)
- `defaultChecked`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L85)
- `defaultValue`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L89)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L93)
- `loading`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L101)
- `value`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Switch/type.ts#L150)

<a id="ui.family.table"></a>
### Table → DataTable

- **逐项深度规范**：[ui.spec.table](./specs/content.md#ui.spec.table)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：批量二维记录与比较。
- **上游全部公共值**：`Table`、`TableBody`、`TableCell`、`TableColGroup`、`TableContainer`、`TableElement`、`TableExpandedRow`、`TableFooter`、`TableHeader`、`TableHeaderCell`、`TableRoot`、`TableRow`、`TableScroll`、`TableSummaryFoot`、`TableTitle`。
- **上游定义**：[Table:285](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L285) · [TableBody:13](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L13) · [TableCell:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L2) · [TableColGroup:14](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L14) · [TableContainer:15](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L15) · [TableElement:16](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L16) · [TableExpandedRow:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L2) · [TableFooter:17](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L17) · [TableHeader:18](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L18) · [TableHeaderCell:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L2) · [TableRoot:19](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L19) · [TableRow:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L2) · [TableScroll:20](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L20) · [TableSummaryFoot:21](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L21) · [TableTitle:22](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/atoms/index.ts#L22)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Table`（25 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Table`（10 位点）。
- **antd 代表调用**：[apps/desktop/src/components/settings/AgentGrowthTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/AgentGrowthTab.tsx#L4) · [apps/desktop/src/components/settings/BotsSettings.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/BotsSettings.tsx#L3)。
- **LobeHub 代表调用**：[src/components/InlineTable/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/InlineTable/index.tsx#L1) · [src/features/AgentUsage/ModelBreakdown.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentUsage/ModelBreakdown.tsx#L3)。
- **何时选哪种 / 打样场景**：设备管理、后台记录、资源统计；sort/filter/select/expand/virtual。
- **相邻选择与禁用场景**：社交流用实体 ListItem；不把所有功能页做后台表。
- **状态、恢复与键盘合同**：列标题和排序可读；稳定行 ID；键盘不丢行；大数据按合同分页/虚拟化。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `TableVariant`：`'filled' | 'outlined' | 'borderless'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L22)
- `SortOrder`：`'ascend' | 'descend' | null` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L24)
- `TableColumnSorter`：`boolean | TableCompareFn<T> | { compare?: TableCompareFn<T>; multiple?: number }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L33)
- `TableSorterTooltipProps`：`Partial<Omit<TooltipProps, 'children'>> & { /** @default 'full-header' */ target?: 'full-header' | 'sorter-icon'; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L37)
- `target`：`'full-header' | 'sorter-icon'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L39)
- `FilterValue`：`string | number | boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L42)
- `clearFilters`：`(params?: { closeDropdown?: boolean; confirm?: boolean }) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L54)
- `closeDropdown`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L54)
- `confirm`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L54)
- `confirm`：`(params?: { closeDropdown?: boolean }) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L57)
- `closeDropdown`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L57)
- `visible`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L64)
- `onOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L73)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L75)
- `TableBreakpoint`：`'xxxl' | 'xxl' | 'xl' | 'lg' | 'md' | 'sm' | 'xs'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L86)
- `TableColumnFixed`：`boolean | 'start' | 'end' | 'left' | 'right'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L89)
- `TableColumnEllipsis`：`boolean | { showTitle?: boolean }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L91)
- `showTitle`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L91)
- `TableColumnAlign`：`'left' | 'center' | 'right' | 'start' | 'end'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L93)
- `filterDropdownOpen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L138)
- `filtered`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L142)
- `filterIcon`：`ReactNode | ((filtered: boolean) => ReactNode)` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L145)
- `filterMode`：`'menu' | 'tree'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L147)
- `filterMultiple`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L149)
- `filterOnClose`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L151)
- `filterResetToDefaultFilteredValue`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L153)
- `filterSearch`：`boolean | ((input: string, item: TableColumnFilterItem) => boolean)` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L156)
- `hidden`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L159)
- `onFilter`：`(value: FilterValue, record: T) => boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L165)
- `onFilterDropdownOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L167)
- `rowScope`：`'row' | 'rowgroup'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L173)
- `shouldCellUpdate`：`(record: T, prevRecord: T) => boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L175)
- `showSorterTooltip`：`boolean | TableSorterTooltipProps` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L177)
- `TableExpandedRowRender`：`( record: T, index: number, indent: number, expanded: boolean, ) => ReactNode` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L201)
- `expandable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L211)
- `expanded`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L212)
- `defaultExpandAllRows`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L227)
- `expandRowByClick`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L239)
- `forceRender`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L243)
- `onExpand`：`(expanded: boolean, record: T) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L246)
- `rowExpandable`：`(record: T) => boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L249)
- `showExpandColumn`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L251)
- `TableRowSelectionType`：`'checkbox' | 'radio'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L254)
- `TableRowSelectMethod`：`'all' | 'none' | 'invert' | 'single' | 'multiple'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L257)
- `TableRowSelectionCheckboxProps`：`Partial< Omit<CheckboxProps, 'checked' | 'defaultChecked'> > & AriaAttributes` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L260)
- `TableSelectionPreset`：`'SELECT_ALL' | 'SELECT_INVERT' | 'SELECT_NONE'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L274)
- `align`：`'left' | 'center' | 'right'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L279)
- `checkStrictly`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L281)
- `hideSelectAll`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L294)
- `onSelect`：`(record: T, selected: boolean, selectedRows: T[], nativeEvent: Event) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L302)
- `onSelectAll`：`(selected: boolean, selectedRows: T[], changeRows: T[]) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L304)
- `onSelectMultiple`：`(selected: boolean, selectedRows: T[], changeRows: T[]) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L308)
- `preserveSelectedRowKeys`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L312)
- `renderCell`：`( value: boolean, record: T, index: number, originNode: ReactNode, ) => ReactNode | TableRenderedCell<T>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L314)
- `selections`：`(TableSelectionItem | TableSelectionPreset)[] | boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L323)
- `TablePaginationPlacement`：`'topStart' | 'topCenter' | 'topEnd' | 'bottomStart' | 'bottomCenter' | 'bottomEnd' | 'none'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L328)
- `action`：`'paginate' | 'sort' | 'filter'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L346)
- `TableComponentsSemanticName`：`'cell' | 'row' | 'wrapper'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L371)
- `TableSemanticName`：`'body' | 'content' | 'footer' | 'header' | 'pagination' | 'root' | 'section' | 'title'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L374)
- `TableSize`：`'large' | 'middle' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L434)
- `TableLoadingConfig`：`Omit<SpinProps, 'children' | 'ref'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L437)
- `header`：`Partial<Record<TableComponentsSemanticName | 'table', TableCustomizeComponent>>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L444)
- `align`：`'start' | 'end' | 'nearest'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L450)
- `fixed`：`boolean | 'top' | 'bottom'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L472)
- `loading`：`boolean | TableLoadingConfig` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L511)
- `rowHoverable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L537)
- `scroll`：`{ scrollToFirstRowOnChange?: boolean; x?: number | string | true; y?: number | string }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L546)
- `scrollToFirstRowOnChange`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L546)
- `showHeader`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L548)
- `showSorterTooltip`：`boolean | TableSorterTooltipProps` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L550)
- `sticky`：`boolean | TableSticky` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L556)
- `tableLayout`：`'auto' | 'fixed'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L563)
- `virtual`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Table/type.ts#L571)

<a id="ui.family.tabs"></a>
### Tabs → Tabs

- **逐项深度规范**：[ui.spec.tabs](./specs/navigation.md#ui.spec.tabs)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：同一上下文中的平级内容面。
- **上游全部公共值**：`Tabs`、`TabsIndicator`、`TabsList`、`TabsPanel`、`TabsRoot`、`TabsTab`。
- **上游定义**：[Tabs:287](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L287) · [TabsIndicator:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/index.ts#L2) · [TabsList:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/index.ts#L3) · [TabsPanel:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/index.ts#L4) · [TabsRoot:5](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/index.ts#L5) · [TabsTab:7](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/index.ts#L7)。
- **Peers 直接使用**：`Tabs`（3 导入位点，4 JSX 位点；desktop）。
- **antd 候选**：`Tabs`（8 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Tabs`（67 位点）；`TabsIndicator`（3 位点）；`TabsList`（3 位点）；`TabsRoot`（3 位点）；`TabsTab`（3 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/AgentSettingsModal.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/AgentSettingsModal.tsx#L4) · [apps/desktop/src/components/SkillsTab.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L8) · [apps/desktop/src/components/settings/MemorySettingsSection.tsx:18](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/MemorySettingsSection.tsx#L18)。
- **antd 代表调用**：[apps/desktop/src/components/ShareDialog.tsx:2](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ShareDialog.tsx#L2) · [apps/desktop/src/components/settings/channels/ChannelProvisioningPanel.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/channels/ChannelProvisioningPanel.tsx#L3)。
- **LobeHub 代表调用**：[src/components/HtmlPreview/PreviewDrawer.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/HtmlPreview/PreviewDrawer.tsx#L4) · [src/components/OllamaSetupGuide/index.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/OllamaSetupGuide/index.tsx#L1)。
- **何时选哪种 / 打样场景**：详情页 tabs；Settings 子区；主模块由 PageHost policy 管理。
- **相邻选择与禁用场景**：几个表单值用 Segmented/Radio；层级用 NavigationRail。
- **状态、恢复与键盘合同**：自动激活只在无明显延迟时；手动 Enter 激活可选；tabpanel 关联；持久状态明确。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `TabsVariant`：`'rounded' | 'square' | 'point'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L4)
- `TabsSize`：`'small' | 'middle' | 'large'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L5)
- `TabsOrientation`：`'horizontal' | 'vertical'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L6)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L26)
- `TabsRootProps`：`Omit<ComponentProps<typeof BaseUITabs.Root>, 'className' | 'render'> & { className?: string; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L32)
- `TabsListProps`：`Omit<ComponentProps<typeof BaseUITabs.List>, 'className' | 'render'> & { className?: string; variant?: TabsVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L36)
- `TabsTabProps`：`Omit<ComponentProps<typeof BaseUITabs.Tab>, 'className' | 'render'> & { className?: string; size?: TabsSize; variant?: TabsVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L41)
- `TabsPanelProps`：`Omit< ComponentProps<typeof BaseUITabs.Panel>, 'className' | 'render' > & { className?: string; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L47)
- `TabsIndicatorProps`：`Omit< ComponentProps<typeof BaseUITabs.Indicator>, 'className' | 'render' > & { className?: string; variant?: TabsVariant; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tabs/type.ts#L54)

<a id="ui.family.tag"></a>
### Tag → StatusTag / FilterChip

- **逐项深度规范**：[ui.spec.tag](./specs/feedback.md#ui.spec.tag)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：描述状态或可操作筛选条件。
- **上游全部公共值**：`Tag`。
- **上游定义**：[Tag:289](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L289)。
- **Peers 直接使用**：`Tag`（25 导入位点，125 JSX 位点；desktop）。
- **antd 候选**：`Tag` / CheckableTag（61 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Tag`（251 位点）。
- **Peers 代表调用**：[apps/desktop/src/applet/AppletContainerShell.tsx:6](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/applet/AppletContainerShell.tsx#L6) · [apps/desktop/src/applet/LynxDebugPanel.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/applet/LynxDebugPanel.tsx#L3) · [apps/desktop/src/components/ChatInput.tsx:13](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ChatInput.tsx#L13)。
- **antd 代表调用**：[apps/desktop/src/components/chat/ChatDetailPanel.tsx:6](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/ChatDetailPanel.tsx#L6) · [apps/desktop/src/components/chat/FindPeopleModal.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/FindPeopleModal.tsx#L5)。
- **LobeHub 代表调用**：[src/components/ChangelogModal/VersionTag.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChangelogModal/VersionTag.tsx#L3) · [src/components/Editor/AutoSaveHint.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/Editor/AutoSaveHint.tsx#L3)。
- **何时选哪种 / 打样场景**：status 用静态 Tag；筛选选中用 FilterChip；可关闭标签。
- **相邻选择与禁用场景**：计数用 Badge；不能让所有 tag 都像按钮。
- **状态、恢复与键盘合同**：静态/可选/可删除分开语义；dismiss 有可读名称；trust 状态必须来自投影。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `TagShape`：`'normal' | 'round'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tag/type.ts#L3)
- `TagSize`：`'small' | 'middle' | 'large'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tag/type.ts#L5)
- `TagVariant`：`'filled' | 'outlined' | 'borderless' | 'solid'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tag/type.ts#L7)
- `closable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tag/type.ts#L21)

<a id="ui.family.text"></a>
### Text → Text

- **逐项深度规范**：[ui.spec.text](./specs/content.md#ui.spec.text)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：统一排版角色和溢出政策。
- **上游全部公共值**：`Text`。
- **上游定义**：[Text:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/index.ts#L3)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Text`（905 位点）。
- **LobeHub 代表调用**：[src/business/client/features/ShareShell/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/business/client/features/ShareShell/index.tsx#L3) · [src/business/client/hooks/useWorkspaceOptionLabel.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/business/client/hooks/useWorkspaceOptionLabel.tsx#L4)。
- **何时选哪种 / 打样场景**：pageTitle、sectionTitle、body、meta、caption、code；标题仍用语义层级。
- **相邻选择与禁用场景**：布局由 Stack；富文本用 RichText。
- **状态、恢复与键盘合同**：不能仅按字号代替 h1-h6；truncation 有完整值路径；长文/本地化换行可读。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `align`：`'left' | 'center' | 'right'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L14)
- `code`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L17)
- `delete`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L19)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L20)
- `ellipsis`：`| boolean | { rows?: number; tooltip?: boolean | string | Omit<TooltipProps, 'children'>; tooltipWhenOverflow?: boolean; }` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L21)
- `tooltip`：`boolean | string | Omit<TooltipProps, 'children'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L25)
- `tooltipWhenOverflow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L26)
- `italic`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L29)
- `lineHeight`：`CSSProperties['lineHeight']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L31)
- `mark`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L32)
- `noWrap`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L33)
- `strong`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L35)
- `textDecoration`：`CSSProperties['textDecoration']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L37)
- `textTransform`：`CSSProperties['textTransform']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L38)
- `type`：`'secondary' | 'success' | 'warning' | 'danger' | 'info'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L39)
- `underline`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L40)
- `weight`：`'bold' | 'bolder' | number` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L41)
- `whiteSpace`：`CSSProperties['whiteSpace']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L42)
- `wordBreak`：`CSSProperties['wordBreak']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L43)
- `TextProps`：`TextBaseProps & (Shiny extends true ? { shiny: true; shinyDuration?: CSSProperties['animationDuration']; } : { shiny?: false; shinyDuration?: never; })` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L46)
- `shinyDuration`：`CSSProperties['animationDuration']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Text/type.ts#L50)

<a id="ui.family.toast"></a>
### Toast → Toast / ToastHost

- **逐项深度规范**：[ui.spec.toast](./specs/feedback.md#ui.spec.toast)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：不需决策的短暂反馈。
- **上游全部公共值**：`ToastHost`。
- **上游定义**：[ToastHost:296](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L296)。
- **Peers 直接使用**：`ToastHost`（2 导入位点，2 JSX 位点；desktop/prototype）。
- **antd 候选**：无同名候选。
- **本地替代候选**：[packages/prototypes/desktop/shared/Toast.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shared/Toast.tsx#L5)。
- **LobeHub 直接使用**：`ToastHost`（2 位点）。
- **Peers 代表调用**：[apps/desktop/src/main.tsx:3](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/main.tsx#L3) · [packages/prototypes/desktop/shared/Toast.tsx:1](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shared/Toast.tsx#L1)。
- **LobeHub 代表调用**：[src/features/AuthShell/AuthThemeLite.tsx:7](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AuthShell/AuthThemeLite.tsx#L7) · [src/layout/SPAGlobalProvider/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/layout/SPAGlobalProvider/index.tsx#L3)。
- **何时选哪种 / 打样场景**：复制成功、保存已完成；undo 仅在真实可撤销时。
- **相邻选择与禁用场景**：需处理的错误用 InlineAlert/RecoveryState；批准不用 toast。
- **状态、恢复与键盘合同**：队列有界和去重；离屏可访问；重要消息不自动消失；计时和多窗口 owner 单一。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ToastType`：`'success' | 'info' | 'warning' | 'error' | 'loading' | 'default'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L6)
- `ToastPosition`：`'top' | 'top-left' | 'top-right' | 'bottom' | 'bottom-left' | 'bottom-right'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L8)
- `ToastActionVariant`：`'primary' | 'secondary' | 'text' | 'danger' | 'ghost'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L11)
- `props`：`Omit<React.ComponentPropsWithRef<'button'>, 'onClick'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L25)
- `actionProps`：`React.ComponentPropsWithRef<'button'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L38)
- `closable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L51)
- `hideCloseButton`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L69)
- `icon`：`IconProps['icon']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L73)
- `error`：`ReactNode | ((error: Error) => ReactNode) | Omit<ToastOptions, 'type'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L148)
- `loading`：`ReactNode | Omit<ToastOptions, 'type'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L149)
- `success`：`ReactNode | ((data: T) => ReactNode) | Omit<ToastOptions, 'type'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L150)
- `error`：`(options: Omit<ToastOptions, 'type'> | string) => ToastInstance` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L156)
- `info`：`(options: Omit<ToastOptions, 'type'> | string) => ToastInstance` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L157)
- `loading`：`(options: Omit<ToastOptions, 'type'> | string) => ToastInstance` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L158)
- `success`：`(options: Omit<ToastOptions, 'type'> | string) => ToastInstance` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L160)
- `warning`：`(options: Omit<ToastOptions, 'type'> | string) => ToastInstance` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Toast/type.ts#L161)

<a id="ui.family.togglegroup"></a>
### ToggleGroup → ToggleButton / ToggleGroup

- **逐项深度规范**：[ui.spec.togglegroup](./specs/input.md#ui.spec.togglegroup)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可保持按下状态的一组操作。
- **上游全部公共值**：`ToggleGroup`、`ToggleGroupItem`、`ToggleGroupItemIcon`、`ToggleGroupItemLabel`、`ToggleGroupRoot`。
- **上游定义**：[ToggleGroup:306](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L306) · [ToggleGroupItem:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/index.ts#L2) · [ToggleGroupItemIcon:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/index.ts#L3) · [ToggleGroupItemLabel:4](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/index.ts#L4) · [ToggleGroupRoot:6](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/index.ts#L6)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`ToggleGroup`（2 位点）。
- **LobeHub 代表调用**：[src/features/AgentTasks/AgentTaskDetail/scheduler/SchedulerForm.tsx:1](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/AgentTaskDetail/scheduler/SchedulerForm.tsx#L1) · [src/features/Portal/LocalFile/Body.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Portal/LocalFile/Body.tsx#L3)。
- **何时选哪种 / 打样场景**：格式 bold/italic 多选；筛选单/多；工具模式。
- **相邻选择与禁用场景**：值字段用 Radio/Checkbox；页面用 Tabs。
- **状态、恢复与键盘合同**：aria-pressed 与 action pending 分离；单/多模式显式；roving focus；不可伪装一次性 Button。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `ToggleGroupSize`：`'middle' | 'small'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/type.ts#L3)
- `ToggleGroupVariant`：`'borderless' | 'outlined' | 'segmented'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/type.ts#L4)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/type.ts#L22)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/ToggleGroup/type.ts#L32)

<a id="ui.family.tooltip"></a>
### Tooltip → Tooltip

- **逐项深度规范**：[ui.spec.tooltip](./specs/overlay.md#ui.spec.tooltip)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：简短非交互说明。
- **上游全部公共值**：`Tooltip`、`TooltipGroup`。
- **上游定义**：[Tooltip:308](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L308) · [TooltipGroup:2](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/index.tsx#L2)。
- **Peers 直接使用**：`Tooltip`（13 导入位点，57 JSX 位点；desktop）。
- **antd 候选**：`Tooltip`（29 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Tooltip`（228 位点）；`TooltipGroup`（22 位点）。
- **Peers 代表调用**：[apps/desktop/src/components/MCPTab.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/MCPTab.tsx#L8) · [apps/desktop/src/components/ModelProviderSelect.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/ModelProviderSelect.tsx#L5) · [apps/desktop/src/components/SkillsTab.tsx:8](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L8)。
- **antd 代表调用**：[apps/desktop/src/components/GlobalLayout.tsx:5](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/GlobalLayout.tsx#L5) · [apps/desktop/src/components/NotificationBell.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/NotificationBell.tsx#L4)。
- **LobeHub 代表调用**：[src/components/ChatGroupWizard/ChatGroupWizard.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/ChatGroupWizard/ChatGroupWizard.tsx#L3) · [src/components/CodeEditorPane/StatusBar.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/CodeEditorPane/StatusBar.tsx#L3)。
- **何时选哪种 / 打样场景**：icon 名称、快捷键、截断值；hover+focus。
- **相邻选择与禁用场景**：需要按钮/链接用 Popover；关键原因必须可见。
- **状态、恢复与键盘合同**：不可包含可聚焦子控件；Esc 关闭；可悬停、可持续；触摸有可读替代。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `TooltipPositionerProps`：`Omit< BaseTooltipPositionerProps, 'className' | 'style' | 'children' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L23)
- `TooltipTriggerComponentProps`：`Omit< BaseTooltipTriggerProps, 'className' | 'style' | 'children' | 'render' | 'handle' | 'payload' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L31)
- `TooltipPopupComponentProps`：`Omit< BaseTooltipPopupProps, 'className' | 'style' | 'children' >` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L39)
- `TooltipPortalProps`：`Omit<BaseTooltipPortalProps, 'children' | 'container'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L47)
- `arrow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L54)
- `defaultOpen`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L82)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L86)
- `hotkeyProps`：`Omit<HotkeyProps, 'keys'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L94)
- `onOpenChange`：`(open: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L109)
- `open`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L114)
- `ref`：`ComponentPropsWithRef<typeof BaseTooltip.Trigger>['ref']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L148)
- `standalone`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L154)
- `arrow`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L188)
- `classNames`：`TooltipProps['classNames']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L191)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L193)
- `disableDestroyOnInvalidTrigger`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L198)
- `disableZeroOriginGuard`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L203)
- `getPopupContainer`：`TooltipProps['getPopupContainer']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L204)
- `hotkeyProps`：`Omit<HotkeyProps, 'keys'>` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L206)
- `layoutAnimation`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L207)
- `popupContainer`：`TooltipProps['popupContainer']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L212)
- `styles`：`TooltipProps['styles']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tooltip/type.ts#L216)

<a id="ui.family.tree"></a>
### Tree → Tree

- **逐项深度规范**：[ui.spec.tree](./specs/navigation.md#ui.spec.tree)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：层级数据导航或选择。
- **上游全部公共值**：`Tree`。
- **上游定义**：[Tree:310](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L310)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Tree`（2 位点）。
- **LobeHub 代表调用**：[src/features/AgentTasks/AgentTaskDetail/TaskSubtasks.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/AgentTasks/AgentTaskDetail/TaskSubtasks.tsx#L3) · [src/features/BackgroundActivity/ProcessExplorer/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/BackgroundActivity/ProcessExplorer/index.tsx#L3)。
- **何时选哪种 / 打样场景**：文件夹、知识目录；lazy load；checkable 独立。
- **相邻选择与禁用场景**：平级列表用 List；表单复杂选择用 TreeSelect。
- **状态、恢复与键盘合同**：展开/选择/勾选三种语义；左右箭头、Home/End；加载失败在节点恢复。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `checkable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L6)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L8)
- `isLeaf`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L10)
- `selectable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L12)
- `hasChildren`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L18)
- `isLast`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L20)
- `trail`：`boolean[]` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L23)
- `blockNode`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L43)
- `checkable`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L44)
- `checkStrictly`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L46)
- `defaultExpandAll`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L50)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L53)
- `multiple`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L56)
- `onCheck`：`(keys: string[], info: { checked: boolean; node: TreeDataNode }) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L57)
- `checked`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L57)
- `onExpand`：`(keys: string[], info: { expanded: boolean; node: TreeDataNode }) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L58)
- `expanded`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L58)
- `onSelect`：`(keys: string[], info: { node: TreeDataNode; selected: boolean }) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L60)
- `selected`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L60)
- `showIcon`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L63)
- `showLine`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L64)
- `switcherIcon`：`ReactNode | ((info: { expanded: boolean; node: TreeDataNode }) => ReactNode)` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L68)
- `expanded`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L68)
- `vimKeys`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Tree/type.ts#L71)

<a id="ui.family.upload"></a>
### Upload → FilePicker / FileDropzone

- **逐项深度规范**：[ui.spec.upload](./specs/input.md#ui.spec.upload)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：选择文件并提交资源。
- **上游全部公共值**：`Upload`、`UploadDragger`。
- **上游定义**：[Upload:313](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L313) · [UploadDragger:3](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Upload/index.ts#L3)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：`Upload`（1 位点）。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Upload`（22 位点）。
- **antd 代表调用**：[apps/desktop/src/components/SkillsTab.tsx:4](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/SkillsTab.tsx#L4)。
- **LobeHub 代表调用**：[src/components/AvatarUpload/index.tsx:3](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/AvatarUpload/index.tsx#L3) · [src/components/FeedbackModal/FeedbackContent.tsx:4](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/components/FeedbackModal/FeedbackContent.tsx#L4)。
- **何时选哪种 / 打样场景**：点击选择和拖入等价；多文件/校验/预览；文件上传状态交给 domain。
- **相邻选择与禁用场景**：选择已有图片用 ImageChoice；只下载用 DownloadAction。
- **状态、恢复与键盘合同**：accept 是提示不是安全校验；单项错误不丢其它文件；取消/续传由 transfer owner。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `beforeUpload`：`(file: File, fileList: File[]) => boolean | Promise<boolean | void> | void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Upload/type.ts#L10)
- `directory`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Upload/type.ts#L12)
- `disabled`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Upload/type.ts#L13)
- `dragger`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Upload/type.ts#L14)
- `multiple`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Upload/type.ts#L16)
- `openFileDialogOnClick`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Upload/type.ts#L19)

<a id="ui.family.video"></a>
### Video → VideoPlayer

- **逐项深度规范**：[ui.spec.video](./specs/media.md#ui.spec.video)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：受控播放视频资源。
- **上游全部公共值**：`Video`。
- **上游定义**：[Video:328](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/index.ts#L328)。
- **Peers 直接使用**：该族无 @lobehub/ui 直接引用；不是产品缺失结论。
- **antd 候选**：无同名候选。
- **本地替代候选**：未匹配；全量私有/业务声明见机器附录。
- **LobeHub 直接使用**：`Video`（3 位点）。
- **LobeHub 代表调用**：[src/features/Acceptance/Viewer/Evidence/Video/VideoEvidencePlayer.tsx:9](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Viewer/Evidence/Video/VideoEvidencePlayer.tsx#L9) · [src/features/Acceptance/Viewer/Evidence/Video/VideoReviewStage.tsx:5](https://github.com/lobehub/lobehub/blob/1aeb26ae2c7458325e241e2b377417b2404a754f/src/features/Acceptance/Viewer/Evidence/Video/VideoReviewStage.tsx#L5)。
- **何时选哪种 / 打样场景**：附件预览和媒体正文；字幕、时间、音量、fullscreen。
- **相邻选择与禁用场景**：音频用 AudioPlayer；文件列表用 AttachmentItem。
- **状态、恢复与键盘合同**：不自动带声播放；键盘/字幕/失败可恢复；卸载释放 media 和 object URL。。
- **Owner**：基础/组合能力归 UI System Owner；对象命令与状态真源归对应业务 Owner；平台壳归 Presentation Owner。具体人员未绑定，Agent 不得自报批准。
- **状态**：规范 DRAFT；自有实现 NOT_IMPLEMENTED；specimen NOT_BUILT；产品等价 UNPROVEN。

**上游显式类型轴（源码摘录，完整记录见 JSON）**

- `VideoMarkerColor`：`'success' | 'warning' | 'error' | 'info' | (string & {})` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L8)
- `VideoStatus`：`'loading' | 'ready' | 'error'` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L18)
- `captions`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L23)
- `muted`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L25)
- `paused`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L26)
- `setCaptions`：`(captions: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L40)
- `setMuted`：`(muted: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L41)
- `autoPlay`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L51)
- `loop`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L52)
- `preload`：`HTMLVideoElement['preload']` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L59)
- `captions`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L64)
- `muted`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L72)
- `onMutedChange`：`(muted: boolean) => void` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L74)
- `thumbnails`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L89)
- `frameStep`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L96)
- `frameStep`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L124)
- `thumbnails`：`boolean` · [定义](https://github.com/lobehub/lobe-ui/blob/a5441425c589bb5ff6b1a971acc209b6d66abda3/src/Video/type.ts#L132)

## Peers 补充需求与非 LobeUI 来源

<a id="ui.requirement.card"></a>
### Card → Card

- **逐项深度规范**：[ui.spec.card](./specs/layout.md#ui.spec.card)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可独立阅读或操作的对象单元。
- **具体场景 / 打样**：Agent 摘要、资源卡；reading/action/recovery 分角色。
- **相邻选择**：连续会话行不包重卡。
- **交互、状态与恢复**：title/content/footer 共享轨道；嵌套需不同意图。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：Card（26 位点）。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.confirmaction"></a>
### ConfirmAction → ConfirmAction

- **逐项深度规范**：[ui.spec.confirmaction](./specs/action.md#ui.spec.confirmaction)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：轻量且明确的风险确认。
- **具体场景 / 打样**：可撤销删除、断开、移除；不可逆改用 ConfirmDialog。
- **相邻选择**：普通按钮不强行二次确认。
- **交互、状态与恢复**：对象名称/影响/恢复同时可见；pending 不重复发送。
- **本地候选**：[apps/desktop/src/components/chat/ChatDeleteConfirmOverlay.tsx:18](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/ChatDeleteConfirmOverlay.tsx#L18) · [apps/desktop/src/components/settings/channels/LarkChannelsSettings.tsx:190](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/channels/LarkChannelsSettings.tsx#L190) · [apps/mobile/src/pages/chat/ChatOverlayHost.tsx:387](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/pages/chat/ChatOverlayHost.tsx#L387) · [packages/prototypes/desktop/features/social-chat/src/components/DetailPanel.tsx:194](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/features/social-chat/src/components/DetailPanel.tsx#L194) · [packages/prototypes/mobile/chat/src/components/SettingDetailView.tsx:473](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/mobile/chat/src/components/SettingDetailView.tsx#L473)。
- **antd 候选**：Popconfirm（24 位点）。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.stack"></a>
### Stack → Stack / Inline

- **逐项深度规范**：[ui.spec.flex](./specs/layout.md#ui.spec.flex)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：独立的一维布局公共 API。
- **具体场景 / 打样**：替代 Space、Compact、react-layout-kit；受限 gap/direction/wrap。
- **相邻选择**：二维用 Grid。
- **交互、状态与恢复**：组合字段不生成双重边框；不传供应商 style props。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：Space（21 位点）。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.commandpalette"></a>
### CommandPalette → CommandPalette

- **逐项深度规范**：[ui.spec.commandpalette](./specs/navigation.md#ui.spec.commandpalette)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：跨页面的可发现命令入口。
- **具体场景 / 打样**：搜索命令/对象；快捷键调起；近期使用。
- **相邻选择**：编辑器插入用 SlashCommandMenu。
- **交互、状态与恢复**：权限与当前上下文过滤；执行后恢复对应焦点。
- **本地候选**：[packages/prototypes/desktop/shell/src/Shell.tsx:506](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/Shell.tsx#L506)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.mentionpicker"></a>
### MentionPicker → MentionPicker

- **逐项深度规范**：[ui.spec.mentionpicker](./specs/input.md#ui.spec.mentionpicker)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：将正文文本绑定到真实实体引用。
- **具体场景 / 打样**：@联系人/Agent/文件；范围可见；插入完整 identity。
- **相邻选择**：普通建议用 Autocomplete。
- **交互、状态与恢复**：光标 token 和实体 ID 分离；IME/失效引用/权限撤销可恢复。
- **本地候选**：[apps/desktop/src/components/chat/MentionPopup.tsx:25](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/MentionPopup.tsx#L25) · [apps/desktop/src/components/chat/MentionTag.tsx:19](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/MentionTag.tsx#L19) · [apps/desktop/src/components/chat/MentionTag.tsx:59](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/MentionTag.tsx#L59)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.richtexteditor"></a>
### RichTextEditor → RichTextEditor

- **逐项深度规范**：[ui.spec.richtexteditor](./specs/input.md#ui.spec.richtexteditor)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：具有结构化文本语义的编辑面。
- **具体场景 / 打样**：帖子、Note、模板；工具栏与快捷键一致。
- **相邻选择**：短聊天可用 MessageComposer。
- **交互、状态与恢复**：selection/history/dirty owner 单一；粘贴净化；插入失败保留草稿。
- **本地候选**：[apps/applets/note/frontend/src/presentation/pages/NoteAppletPage.tsx:239](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/applets/note/frontend/src/presentation/pages/NoteAppletPage.tsx#L239) · [apps/applets/note/frontend/src/presentation/pages/NoteAppletPage.tsx:297](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/applets/note/frontend/src/presentation/pages/NoteAppletPage.tsx#L297) · [apps/desktop/src/pages/AgentProfilePage.tsx:288](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/AgentProfilePage.tsx#L288) · [apps/desktop/src/pages/AgentProfilePage.tsx:768](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/AgentProfilePage.tsx#L768) · [apps/x-config/console/src/App.tsx:645](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/x-config/console/src/App.tsx#L645) · [apps/x-config/console/src/App.tsx:737](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/x-config/console/src/App.tsx#L737)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.timefield"></a>
### TimeField → TimeField

- **逐项深度规范**：[ui.spec.timefield](./specs/input.md#ui.spec.timefield)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：选择带明确单位与时区政策的时间。
- **具体场景 / 打样**：日程时刻、安静时段；时区为 date-time owner 提供。
- **相邻选择**：日期用 DateField。
- **交互、状态与恢复**：DST/跨日/分钟步进可验证；不偷偷转换。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.calendarview"></a>
### CalendarView → CalendarView

- **逐项深度规范**：[ui.spec.calendarview](./specs/content.md#ui.spec.calendarview)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：以日历形式浏览日程。
- **具体场景 / 打样**：月/周/日；当前时区可见；事件点到详情。
- **相邻选择**：只是选择日期用 DateField。
- **交互、状态与恢复**：跨天事件语义、空/失败/冲突；键盘导航和本地化。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.treeselect"></a>
### TreeSelect → TreeSelect / Cascader

- **逐项深度规范**：[ui.spec.treeselect](./specs/input.md#ui.spec.treeselect)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：表单内选择层级值。
- **具体场景 / 打样**：知识路径、组织节点；单/多；显示完整路径。
- **相邻选择**：纯浏览用 Tree；无层级用 Select。
- **交互、状态与恢复**：lazy 节点失败可重试；选择父级语义明确；不可漏掉旧值。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.virtuallist"></a>
### VirtualList → VirtualList

- **逐项深度规范**：[ui.spec.virtuallist](./specs/content.md#ui.spec.virtuallist)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：在性能边界内呈现大列表。
- **具体场景 / 打样**：消息、会话、联系人；估高与测量策略。
- **相邻选择**：小列表用 List。
- **交互、状态与恢复**：锚点、焦点和读屏可达；prepend 不跳；虚拟化不丢业务投影。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.audioplayer"></a>
### AudioPlayer → AudioPlayer

- **逐项深度规范**：[ui.spec.audioplayer](./specs/media.md#ui.spec.audioplayer)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：播放音频与语音附件。
- **具体场景 / 打样**：语音消息、播客附件；时长和加载状态。
- **相邻选择**：视频用 VideoPlayer。
- **交互、状态与恢复**：键盘播放/暂停、转写可读；离开暂停政策；释放资源。
- **本地候选**：[apps/desktop/src/components/chat/GroupCallSurface.tsx:140](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/GroupCallSurface.tsx#L140)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.relationshiprequestitem"></a>
### RelationshipRequestItem → RelationshipRequestItem

- **逐项深度规范**：[ui.spec.relationshiprequestitem](./specs/domain.md#ui.spec.relationshiprequestitem)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：同一关系请求跨面一致。
- **具体场景 / 打样**：Contacts/Notifications 的接受拒绝；同对象同控件。
- **相邻选择**：不能各页自己画两颗按钮。
- **交互、状态与恢复**：entityId/decisionId/state owner 明确；过期、重复、跨端已处理可读。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.contactitem"></a>
### ContactItem → ContactItem

- **逐项深度规范**：[ui.spec.contactitem](./specs/domain.md#ui.spec.contactitem)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：联系人对象的标准行。
- **具体场景 / 打样**：搜索、通讯录、分享选择；身份/来源/动作一致。
- **相邻选择**：群对象用 GroupItem。
- **交互、状态与恢复**：读取业务投影；行点击与操作隔离；重复行共享轨道。
- **本地候选**：[packages/prototypes/desktop/features/social-chat/src/components/ContactIdentityRow.tsx:9](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/features/social-chat/src/components/ContactIdentityRow.tsx#L9)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.conversationitem"></a>
### ConversationItem → ConversationItem

- **逐项深度规范**：[ui.spec.conversationitem](./specs/domain.md#ui.spec.conversationitem)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：会话的标准入口行。
- **具体场景 / 打样**：未读、草稿、最后活动、静音、置顶。
- **相邻选择**：普通实体用 ListItem。
- **交互、状态与恢复**：unread 与 delivery 分离；切换保留草稿/滚动；新活动不抢焦点。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.messagebubble"></a>
### MessageBubble → MessageBubble

- **逐项深度规范**：[ui.spec.messagebubble](./specs/domain.md#ui.spec.messagebubble)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：显示一条可追溯消息。
- **具体场景 / 打样**：本人/对方/系统；发送中/失败/编辑/删除；附件引用。
- **相邻选择**：Agent 任务进度另用 TaskCard。
- **交互、状态与恢复**：delivery 真源来自 messaging；复制/反应/回复合同共享；不中断选区。
- **本地候选**：[apps/desktop/src/components/MessageBubble.tsx:31](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/MessageBubble.tsx#L31) · [apps/desktop/src/components/chat/ChatMessageArea.tsx:92](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/ChatMessageArea.tsx#L92) · [apps/desktop/src/components/chat/ChatThreadPanel.tsx:82](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/ChatThreadPanel.tsx#L82) · [apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx:87](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx#L87) · [apps/desktop/src/components/chat/message/ChatMessageContent.tsx:36](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/message/ChatMessageContent.tsx#L36) · [apps/desktop/src/components/chat/message/ChatMessageRow.tsx:376](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/message/ChatMessageRow.tsx#L376) · [apps/desktop/src/components/chat/message/ChatMessageRow.tsx:387](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/message/ChatMessageRow.tsx#L387) · [apps/desktop/src/components/chat/message/ChatMessageTimeline.tsx:116](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/message/ChatMessageTimeline.tsx#L116)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.messagecomposer"></a>
### MessageComposer → MessageComposer

- **逐项深度规范**：[ui.spec.messagecomposer](./specs/domain.md#ui.spec.messagecomposer)；6 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：承载发送意图及草稿。
- **具体场景 / 打样**：文本/附件/提及/回复；send/stop 分开；移动键盘恢复。
- **相邻选择**：长编辑用 RichTextEditor。
- **交互、状态与恢复**：草稿在 runtime/store；失败不清；IME 不发；附件状态可独立恢复。
- **本地候选**：[apps/desktop/src/components/chat/ChatComposer.tsx:142](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/ChatComposer.tsx#L142) · [apps/desktop/src/components/composer/ChatComposer.tsx:31](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/composer/ChatComposer.tsx#L31)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.attachmentitem"></a>
### AttachmentItem → AttachmentItem

- **逐项深度规范**：[ui.spec.attachmentitem](./specs/domain.md#ui.spec.attachmentitem)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：资源转移状态与动作入口。
- **具体场景 / 打样**：文件名/MIME/大小/进度/重试/取消/打开。
- **相邻选择**：图片展示用 Image；下载用 DownloadAction。
- **交互、状态与恢复**：encrypted/ready/expired/blocked 不可由 UI 猜；断点续传交 transfer owner。
- **本地候选**：[apps/desktop/src/components/chat/AttachmentItem.tsx:323](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/AttachmentItem.tsx#L323) · [apps/desktop/src/components/composer/AttachmentStage.tsx:35](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/composer/AttachmentStage.tsx#L35) · [apps/mobile/src/pages/chat/ChatMessagePresentation.tsx:140](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/pages/chat/ChatMessagePresentation.tsx#L140)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.attachmentviewer"></a>
### AttachmentViewer → AttachmentViewer

- **逐项深度规范**：[ui.spec.attachmentviewer](./specs/domain.md#ui.spec.attachmentviewer)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：统一文件打开与预览任务。
- **具体场景 / 打样**：图片/音频/视频/文本/文档/不支持；保存/关闭统一。
- **相邻选择**：HTML 必须用沙箱；不直接暴露 OS path。
- **交互、状态与恢复**：资源 resolver 和 preview owner 负责访问/解密/释放；错误保留来源。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.reactionchip"></a>
### ReactionChip → ReactionChip / ReactionPicker

- **逐项深度规范**：[ui.spec.reactionchip](./specs/domain.md#ui.spec.reactionchip)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：消息和帖子反应交互。
- **具体场景 / 打样**：选中/计数/增减/菜单；已有相同反应去重。
- **相邻选择**：普通 emoji 插入用 EmojiPicker。
- **交互、状态与恢复**：optimistic 回滚有 actionId；跨端已选合并来自业务；触摸/键盘一致。
- **本地候选**：[apps/desktop/src/components/moments/ReactionBar.tsx:42](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/moments/ReactionBar.tsx#L42) · [apps/mobile/src/components/reactions/ReactionChip.tsx:15](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/reactions/ReactionChip.tsx#L15) · [apps/mobile/src/components/reactions/ReactionPicker.tsx:12](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/reactions/ReactionPicker.tsx#L12) · [packages/prototypes/shared/ReactionChip.tsx:19](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/shared/ReactionChip.tsx#L19) · [packages/prototypes/shared/ReactionPicker.tsx:18](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/shared/ReactionPicker.tsx#L18)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.identityblock"></a>
### IdentityBlock → IdentityBlock

- **逐项深度规范**：[ui.spec.identityblock](./specs/domain.md#ui.spec.identityblock)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：身份、来源和受众上下文。
- **具体场景 / 打样**：联系人、消息作者、分享目标；敏感详情逐步展开。
- **相邻选择**：普通昵称用 Text 不足以表达跨 Station 身份。
- **交互、状态与恢复**：稳定 actor identity 与显示名分离；remote/local 可读；不得伪造 verified。
- **本地候选**：[apps/desktop/src/components/chat/ChatActorIdentityRow.tsx:22](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/chat/ChatActorIdentityRow.tsx#L22) · [apps/mobile/src/components/recovery/ActorIdentityRecoveryOverlay.tsx:10](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/recovery/ActorIdentityRecoveryOverlay.tsx#L10)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.trustindicator"></a>
### TrustIndicator → TrustIndicator

- **逐项深度规范**：[ui.spec.trustindicator](./specs/domain.md#ui.spec.trustindicator)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：说明影响下一步的可信与限制状态。
- **具体场景 / 打样**：verified/remote/degraded/blocked/unknown；展开原因。
- **相邻选择**：普通在线点用 Badge。
- **交互、状态与恢复**：Station/信任业务拥有状态；unknown 不自动判可信；有纠正路径。
- **本地候选**：[apps/desktop/src/components/settings/AgentGrowthTab.tsx:47](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/AgentGrowthTab.tsx#L47)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.permissiondecision"></a>
### PermissionDecision → PermissionDecision

- **逐项深度规范**：[ui.spec.permissiondecision](./specs/domain.md#ui.spec.permissiondecision)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：用户审批真实能力与权限请求。
- **具体场景 / 打样**：Agent 工具使用、外部访问、设备授权；允许一次/有限期/拒绝。
- **相邻选择**：普通确认用 ConfirmDialog。
- **交互、状态与恢复**：resource/scope/duration/decision identity 明确；过期/竞争处理；不得默认批准。
- **本地候选**：[apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx:217](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx#L217) · [apps/mobile/src/pages/settings/SettingsSections.tsx:1160](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/pages/settings/SettingsSections.tsx#L1160) · [packages/prototypes/desktop/applets/atelier/src/blocks.tsx:333](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/applets/atelier/src/blocks.tsx#L333) · [packages/prototypes/desktop/features/agent/src/Page.tsx:103](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/features/agent/src/Page.tsx#L103)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.agenttaskcard"></a>
### AgentTaskCard → AgentTaskCard

- **逐项深度规范**：[ui.spec.agenttaskcard](./specs/domain.md#ui.spec.agenttaskcard)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：任务当前阶段与可行动状态。
- **具体场景 / 打样**：queued/running/waiting-decision/stopping/succeeded/failed。
- **相邻选择**：聊天气泡不能承载全部任务真源。
- **交互、状态与恢复**：status 来自 Agent runtime；stop != cancel != done；恢复上下文可追踪。
- **本地候选**：[apps/desktop/src/pages/TasksPage.tsx:85](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/TasksPage.tsx#L85)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.toolcallcard"></a>
### ToolCallCard → ToolCallCard

- **逐项深度规范**：[ui.spec.toolcallcard](./specs/domain.md#ui.spec.toolcallcard)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：解释一次工具调用输入输出和决策。
- **具体场景 / 打样**：准备/执行/等待批准/失败/完成；敏感内容遮挡。
- **相邻选择**：一般日志用 CodeBlock。
- **交互、状态与恢复**：工具和 runtime 投影真源；大输出截断可展开；不会因展开重复调用。
- **本地候选**：[apps/desktop/src/components/messages/ToolCallCard.tsx:145](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/messages/ToolCallCard.tsx#L145) · [apps/desktop/src/components/messages/ToolCallCard.tsx:582](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/messages/ToolCallCard.tsx#L582) · [packages/prototypes/desktop/features/agent/src/Page.tsx:47](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/features/agent/src/Page.tsx#L47)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.devicelinkcard"></a>
### DeviceLinkCard → DeviceLinkCard

- **逐项深度规范**：[ui.spec.devicelinkcard](./specs/domain.md#ui.spec.devicelinkcard)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：扫码与设备绑定的生命周期。
- **具体场景 / 打样**：二维码待扫/过期/手机批准/完成/撤销。
- **相邻选择**：QrCode 只负责画码。
- **交互、状态与恢复**：绑定事实由协议投影；不得本地计时推断已登录；secret 不记录证据。
- **本地候选**：本次命名扫描未匹配；这是需求提案，不是现有实现声明。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.connectionrecovery"></a>
### ConnectionRecovery → ConnectionRecovery

- **逐项深度规范**：[ui.spec.connectionrecovery](./specs/domain.md#ui.spec.connectionrecovery)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：连接或身份恢复的可执行路径。
- **具体场景 / 打样**：offline/reconnecting/degraded/needs-user/failed。
- **相邻选择**：EmptyState 不能隐藏离线。
- **交互、状态与恢复**：runtime 含重试预算；页面说明作用域和可恢复工作；自动重试有界。
- **本地候选**：[apps/mobile/src/components/recovery/CommandRecoveryPanel.tsx:25](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/recovery/CommandRecoveryPanel.tsx#L25) · [apps/mobile/src/components/recovery/RecoveryOverlayHost.tsx:101](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/recovery/RecoveryOverlayHost.tsx#L101) · [packages/prototypes/desktop/applets/atelier/src/Page.tsx:492](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/applets/atelier/src/Page.tsx#L492)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.notificationitem"></a>
### NotificationItem → NotificationItem

- **逐项深度规范**：[ui.spec.notificationitem](./specs/domain.md#ui.spec.notificationitem)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：通知对象及其实际可执行动作。
- **具体场景 / 打样**：消息跳转、关系请求、审批；读状态和处理状态分离。
- **相邻选择**：普通 toast 不入通知真源。
- **交互、状态与恢复**：同实体嵌入同组件；已处理/过期可读；不把已读当已批准。
- **本地候选**：[apps/desktop/src/components/NotificationBell.tsx:35](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/NotificationBell.tsx#L35) · [apps/desktop/src/components/NotificationBell.tsx:154](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/NotificationBell.tsx#L154) · [apps/mobile/src/components/MobileNotificationCenter.tsx:127](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/MobileNotificationCenter.tsx#L127) · [packages/prototypes/desktop/shell/src/Notifications.tsx:97](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/Notifications.tsx#L97) · [packages/prototypes/desktop/shell/src/Notifications.tsx:207](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/Notifications.tsx#L207)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.navigationshell"></a>
### NavigationShell → NavigationShell

- **逐项深度规范**：[ui.spec.navigationshell](./specs/domain.md#ui.spec.navigationshell)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：统一桌面入口与全局设置。
- **具体场景 / 打样**：Desktop 首入口、workspace 切换、全局 Settings、移动适配。
- **相邻选择**：不默认进入某个 Agent 页面。
- **交互、状态与恢复**：Shell 和 PageHost 拥有 route/lifetime；业务页不可复制全局导航。
- **本地候选**：[apps/mobile/src/components/MobileShell.tsx:236](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/components/MobileShell.tsx#L236) · [packages/prototypes/mobile/chat/src/MobileShell.tsx:43](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/mobile/chat/src/MobileShell.tsx#L43)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.applettile"></a>
### AppletTile → AppletTile

- **逐项深度规范**：[ui.spec.applettile](./specs/domain.md#ui.spec.applettile)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：应用入口对象。
- **具体场景 / 打样**：已安装/可打开/更新/权限异常；固定动作。
- **相邻选择**：不把 applet 当网页链接拼图。
- **交互、状态与恢复**：Applet manifest/宿主拥有 capabilities；UI 不自己绑定 service。
- **本地候选**：[apps/desktop/src/pages/AppletsPage.tsx:752](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/AppletsPage.tsx#L752) · [packages/prototypes/desktop/shell/src/Shell.tsx:381](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/Shell.tsx#L381)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.resourceusage"></a>
### ResourceUsage → ResourceUsage

- **逐项深度规范**：[ui.spec.resourceusage](./specs/domain.md#ui.spec.resourceusage)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：解释成本/额度及其影响。
- **具体场景 / 打样**：token/费用/上下文容量/资源上限；unknown/stale。
- **相邻选择**：一般数值用 Metric。
- **交互、状态与恢复**：unit/source/asOf 必须明确；达到限制给可执行选项；不能猜测余额。
- **本地候选**：[apps/station/app/subserver/dashboard/web/src/pages/oss/BucketsTab.tsx:64](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/station/app/subserver/dashboard/web/src/pages/oss/BucketsTab.tsx#L64) · [apps/station/app/subserver/dashboard/web/src/pages/oss/UsageTab.tsx:40](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/station/app/subserver/dashboard/web/src/pages/oss/UsageTab.tsx#L40)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.onboardingflow"></a>
### OnboardingFlow → OnboardingFlow

- **逐项深度规范**：[ui.spec.onboardingflow](./specs/domain.md#ui.spec.onboardingflow)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：跨组件的引导完成旅程。
- **具体场景 / 打样**：创建身份→绑定设备→进入 Desktop；可回退/恢复。
- **相邻选择**：单项帮助用 GuideStep。
- **交互、状态与恢复**：StepProgress 只投影位置；业务完成和未证实状态分离；清理临时资源。
- **本地候选**：[apps/desktop/src/pages/SettingsPage.tsx:1733](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/pages/SettingsPage.tsx#L1733) · [apps/desktop/src/views/OnboardingView.tsx:17](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/views/OnboardingView.tsx#L17) · [packages/prototypes/desktop/shell/src/WelcomeLoginPrototype.tsx:990](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/WelcomeLoginPrototype.tsx#L990)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.overflowtoolbar"></a>
### OverflowToolbar → OverflowToolbar

- **逐项深度规范**：[ui.spec.overflowtoolbar](./specs/action.md#ui.spec.overflowtoolbar)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：有限空间中的动作优先级。
- **具体场景 / 打样**：常用可见，低频收进 Menu；键盘命令相同。
- **相邻选择**：单按钮不用工具栏；不能隐藏唯一恢复动作。
- **交互、状态与恢复**：基于可用空间折叠；保持 action identity；溢出不产生双 handler。
- **本地候选**：[apps/desktop/src/components/composer/ActionBar/ActionBar.tsx:23](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/composer/ActionBar/ActionBar.tsx#L23) · [apps/desktop/src/components/messages/MessageActionBar.tsx:12](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/messages/MessageActionBar.tsx#L12) · [apps/desktop/src/components/moments/surfaces/SocialActionBar.tsx:54](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/moments/surfaces/SocialActionBar.tsx#L54) · [packages/prototypes/desktop/features/applet-workspace/src/AppletWorkspacePrototype.tsx:531](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/features/applet-workspace/src/AppletWorkspacePrototype.tsx#L531) · [packages/prototypes/desktop/features/call/src/CallPrototype.tsx:767](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/features/call/src/CallPrototype.tsx#L767) · [packages/prototypes/desktop/features/social-chat/src/components/ChatArea.tsx:861](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/features/social-chat/src/components/ChatArea.tsx#L861)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.secretvalue"></a>
### SecretValue → SecretValue

- **逐项深度规范**：[ui.spec.secretvalue](./specs/content.md#ui.spec.secretvalue)；4 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：可控读取与复制敏感值。
- **具体场景 / 打样**：恢复词、API 凭据；遮挡/短时显露/复制。
- **相邻选择**：普通属性用 KeyValueList。
- **交互、状态与恢复**：不进入 telemetry/截图 fixture；权限和显露期限由 domain owner 提供。
- **本地候选**：[apps/desktop/src/components/settings/RecoverySettings.tsx:38](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/RecoverySettings.tsx#L38)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。

<a id="ui.requirement.settingrow"></a>
### SettingRow → SettingRow

- **逐项深度规范**：[ui.spec.settingrow](./specs/domain.md#ui.spec.settingrow)；5 项具体场景，包含 Anatomy、变体/默认/非法组合、状态/恢复、可访问性、几何动效、极端数据、生命周期、API 与打样合同。
- **职责**：全局设置的一项说明与控制。
- **具体场景 / 打样**：label/help/control/status 同轨；即时开关和表单明确。
- **相邻选择**：复杂组用 FieldGroup。
- **交互、状态与恢复**：Settings 属于全局通用层；remote pending/失败在当前行；不能只 toast。
- **本地候选**：[apps/desktop/src/components/settings/SettingsLayout.tsx:144](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/desktop/src/components/settings/SettingsLayout.tsx#L144) · [apps/mobile/src/pages/settings/SettingsSections.tsx:175](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/apps/mobile/src/pages/settings/SettingsSections.tsx#L175) · [packages/prototypes/desktop/shell/src/Settings.tsx:367](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch-show/packages/prototypes/desktop/shell/src/Settings.tsx#L367)。
- **antd 候选**：无。
- **归属**：ui.requirement 条目；不能与上游族相加称为唯一组件数量。能力去重后才能冻结自有 API。
- **状态**：DRAFT / NOT_IMPLEMENTED / NOT_BUILT；替代等价 UNPROVEN。
