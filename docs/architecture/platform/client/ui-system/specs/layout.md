# 布局与滚动 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [Surface](#ui.spec.block)
- [Divider](#ui.spec.divider)
- [ResizablePanel](#ui.spec.draggablepanel)
- [Stack / Inline](#ui.spec.flex)
- [Grid](#ui.spec.grid)
- [PageHeader](#ui.spec.header)
- [PageLayout](#ui.spec.layout)
- [OverflowHint](#ui.spec.maskshadow)
- [SurfaceFade](#ui.spec.progressiveblur)
- [ScrollArea](#ui.spec.scrollarea)
- [Card](#ui.spec.card)

<a id="ui.spec.block"></a>
## Surface

合同 ID：`ui.spec.block`。来源记录：[Block](../component-catalog.md#ui.family.block)。

### 意图、选择与边界

建立具有明确意图的容器边界。阅读用平面；操作区弱底色；浮层用 raised；恢复区关联失败对象。相邻选择：仅排版用 Stack/Grid；不得给每一段加 Card。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.block)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SurfaceRoot/Content/optionalActions；容器边界不制造业务对象。

UI Layout Owner管Surface；children业务归各owner。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- role=reading/action/recovery；默认 reading。
- elevation=flat/raised；默认 flat；overlay才raised。
- padding=none/standard；默认 standard按scope。

禁止：每个段落卡化、reading容器假button、容器替子控件加第二focus/error。

### 状态转换与可执行恢复

容器自身没有pending/success；child owner投影；recovery surface关联真实失败对象。

### 具体使用场景

<a id="ui.spec.block.case.01"></a>
#### 阅读区

- **选择**：flat reading
- **触发与可观察结果**：内容清楚分组
- **失败、等待与恢复**：不加无意义raised。

<a id="ui.spec.block.case.02"></a>
#### 操作区

- **选择**：action
- **触发与可观察结果**：弱底区呈现真实动作
- **失败、等待与恢复**：动作无权限显示原因。

<a id="ui.spec.block.case.03"></a>
#### 恢复区

- **选择**：recovery
- **触发与可观察结果**：同失败对象展示恢复路径
- **失败、等待与恢复**：不能仅换红背景。

<a id="ui.spec.block.case.04"></a>
#### 浮层承载

- **选择**：raised
- **触发与可观察结果**：遵循Overlay边界
- **失败、等待与恢复**：不在普通列表层层阴影。

### 键盘、焦点、触摸与读屏

被动container不Tab；语义section有标题；动作各自焦点；触摸不整个面都click。

### 图形、几何与动效

统一surface/border/radius token；不层层nested shadow；背景变化fast。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长内容、嵌套容器、暗色、高对比和边界不足。

不在Surface创建Store或订阅；卸载只清presentation资源。

### 自有公共合同形状

surfaceRole/elevation/paddingRole/semanticLabel/children。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.divider"></a>
## Divider

合同 ID：`ui.spec.divider`。来源记录：[Divider](../component-catalog.md#ui.family.divider)。

### 意图、选择与边界

分隔不同意图或语义组。菜单动作分组；设置组间隔；正文 hr 表示主题变化。相邻选择：仅需留白用 spacing；无需每行分隔。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.divider)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SeparatorLine/optionalGroupLabel；纯布局和正文主题变化分开。

UI Layout Owner；无业务命令。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- axis=horizontal/vertical；默认 horizontal。
- semantics=decorative/thematic/menu-group；默认 decorative。
- label=none/visible；默认 none。

禁止：空组separator、装饰线focusable、hr代所有padding、separator带隐藏命令。

### 状态转换与可执行恢复

被动无action状态；组变化重新排列；不要对separator伪造loading。

### 具体使用场景

<a id="ui.spec.divider.case.01"></a>
#### 菜单分组

- **选择**：menu-group
- **触发与可观察结果**：普通和危险组分隔
- **失败、等待与恢复**：无危险项不留空线。

<a id="ui.spec.divider.case.02"></a>
#### 正文主题

- **选择**：thematic
- **触发与可观察结果**：hr表示主题变化
- **失败、等待与恢复**：不靠line代标题。

<a id="ui.spec.divider.case.03"></a>
#### 工具栏

- **选择**：vertical decorative
- **触发与可观察结果**：分工具组
- **失败、等待与恢复**：窄屏移入menu仍保留语义组。

<a id="ui.spec.divider.case.04"></a>
#### 设置区

- **选择**：horizontal label
- **触发与可观察结果**：可读组名与合理间距
- **失败、等待与恢复**：不重复每字段边框。

### 键盘、焦点、触摸与读屏

decorative隐藏；thematic用hr语义；menu separator遵循menu；不进Tab或触摸操作。

### 图形、几何与动效

line来自border token、对比可辨；vertical有父高度；静态不动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

空前后组、密集separator、200%label、RTL。

无listener/timer；消失不代表数据删除。

### 自有公共合同形状

axis/semanticRole/label/spacingRole。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.draggablepanel"></a>
## ResizablePanel

合同 ID：`ui.spec.draggablepanel`。来源记录：[DraggablePanel](../component-catalog.md#ui.family.draggablepanel)。

### 意图、选择与边界

可调整的持久工作区域。会话侧栏、Agent 检视区；min/max/折叠/恢复宽度。相邻选择：临时细节用 Drawer；浮动窗用 FloatingPanel。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.draggablepanel)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

PanelContent/ResizeHandle/Collapse/Restore；ResizablePanel不是可拖浮窗。

Page/Presentation Owner管layout及alive；UI管resize。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- axis=horizontal/vertical；默认 horizontal。
- state=expanded/collapsed；默认 expanded。
- bounds=owner-min/max；必供，偏好恢复须clamp。

禁止：无键盘resize、拖超bounds、折叠丢draft、whole content作为handle。

### 状态转换与可执行恢复

resize draft→commit size；collapse记录上次尺寸；restore有效尺寸；保存偏好失败不影响当前可用视图。

### 具体使用场景

<a id="ui.spec.draggablepanel.case.01"></a>
#### 会话侧栏

- **选择**：horizontal
- **触发与可观察结果**：拖宽阅读长名
- **失败、等待与恢复**：最小宽保可读入口。

<a id="ui.spec.draggablepanel.case.02"></a>
#### Agent检视

- **选择**：bounds
- **触发与可观察结果**：扩展面板不挤主任务到不可用
- **失败、等待与恢复**：新窗口clamp旧偏好。

<a id="ui.spec.draggablepanel.case.03"></a>
#### 折叠恢复

- **选择**：state
- **触发与可观察结果**：恢复上次有效宽度
- **失败、等待与恢复**：隐藏视图业务任务仍继续。

<a id="ui.spec.draggablepanel.case.04"></a>
#### 键盘调整

- **选择**：separator
- **触发与可观察结果**：箭头改宽并播报
- **失败、等待与恢复**：触摸/键盘结果一致。

### 键盘、焦点、触摸与读屏

separator箭头调整、Home/End至界、明确折叠恢复；触摸handle且不抢scroll；reader当前尺寸与bounds。

### 图形、几何与动效

drag0ms；handle命中外扩不遮内容；collapse normal；窗口变小重新clamp。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

父容器0宽、极窄、双侧panel、200%内容、偏好超过新bounds。

pointercapture/observer释放；panel content生命周期由PageHost，collapse不默认kill runtime。

### 自有公共合同形状

axis/size/minSize/maxSize/collapsed/onResize/onCommitSize/onCollapse。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.flex"></a>
## Stack / Inline

合同 ID：`ui.spec.flex`。来源记录：[Flex](../component-catalog.md#ui.family.flex)、[Stack](../component-catalog.md#ui.requirement.stack)。

### 意图、选择与边界

一维排版。纵向内容用 Stack；行尾动作用 Inline；响应式换行显式。相邻选择：二维轨道用 Grid；边界用 Surface。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.flex)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Stack/Inline的Children/Gaps/Alignment/Wrap；一维公共API，来源Flex与Stack归一。

UI Layout Owner；children各有语义owner。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- direction=stack/inline；默认 stack。
- wrap=no-wrap/wrap；默认 no-wrap，窄行动组可wrap。
- alignment=start/center/end/stretch；默认 stretch于stack、start于inline。
- gap=semantic spacing；默认 standard，不任意像素。

禁止：order反转阅读序、Space另建spacing真源、随意negative gap、布局container可点击。

### 状态转换与可执行恢复

布局自身无命令状态；child变化按flow；不把视觉重排当业务排序。

### 具体使用场景

<a id="ui.spec.flex.case.01"></a>
#### 纵向表单

- **选择**：stack
- **触发与可观察结果**：标题字段页脚按统一间距
- **失败、等待与恢复**：文本放大不硬高截断。

<a id="ui.spec.flex.case.02"></a>
#### 行尾动作

- **选择**：inline
- **触发与可观察结果**：按钮共轨，窄屏明确wrap
- **失败、等待与恢复**：不因一长标签上下错位。

<a id="ui.spec.flex.case.03"></a>
#### 标签集合

- **选择**：wrap
- **触发与可观察结果**：chips自然换行
- **失败、等待与恢复**：视觉顺序与键盘一致。

<a id="ui.spec.flex.case.04"></a>
#### RTL导航

- **选择**：inline
- **触发与可观察结果**：按direction政策排布
- **失败、等待与恢复**：不手工reverse两次。

### 键盘、焦点、触摸与读屏

DOM阅读与visual顺序一致；被动不Tab；触摸命中由children；reader无多余group。

### 图形、几何与动效

共同主轴/交叉轴；min-width:0语义等价支持长内容；gap不边距拼接；resize0ms。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0children、长label、wrap多行、RTL、纵向200%、嵌套。

无业务Store；纯layout不订阅window除非对应adapter需要，observer释放。

### 自有公共合同形状

direction/gapRole/align/justify/wrap/children。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.grid"></a>
## Grid

合同 ID：`ui.spec.grid`。来源记录：[Grid](../component-catalog.md#ui.family.grid)。

### 意图、选择与边界

明确二维轨道和响应式分配。文件网格、Applet 启动器；重复行共享轨道。相邻选择：单向排版用 Stack；大量数据用 VirtualList。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.grid)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GridTracks/Cells/ResponsiveRules；二维轨道独立于child任意宽度。

UI Layout Owner；数据集合owner独立。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- columns=fixed-count/min-cell；默认 min-cell。
- alignment=shared-tracks；默认，对齐重复rows。
- responsive=declared-breakpoints；显式，禁止每页面随机值。

禁止：视觉dense重排打乱阅读、固定高度截字、普通grid全cell可焦点。

### 状态转换与可执行恢复

容器变化→重新分配轨道；cell数据loading独立；不重排identity。

### 具体使用场景

<a id="ui.spec.grid.case.01"></a>
#### 文件网格

- **选择**：min-cell
- **触发与可观察结果**：随宽度改列，文件身份稳定
- **失败、等待与恢复**：长名有完整阅读。

<a id="ui.spec.grid.case.02"></a>
#### Applet入口

- **选择**：min-cell
- **触发与可观察结果**：tile同轨保证动作基线
- **失败、等待与恢复**：没有安装不冒可打开。

<a id="ui.spec.grid.case.03"></a>
#### 数据对齐

- **选择**：fixed-count
- **触发与可观察结果**：多行共享label/value轨
- **失败、等待与恢复**：不逐行flex造成错列。

<a id="ui.spec.grid.case.04"></a>
#### 大字模式

- **选择**：responsive
- **触发与可观察结果**：减列而非缩字体
- **失败、等待与恢复**：触摸目标保留。

### 键盘、焦点、触摸与读屏

普通layout不加role=grid；仅交互二维导航另有合同；DOM顺序一致；触摸tile不重叠。

### 图形、几何与动效

minmax轨道和spacing token；不能按内容高短造成动作轨断裂；resize无easing。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0cells、极宽/窄、长标签、不同比例图、200%文本和RTL。

observer按adapter释放；stable itemIDs；layout不持选择状态。

### 自有公共合同形状

columnPolicy/minCellRole/gapRole/breakpointPolicy/alignment。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.header"></a>
## PageHeader

合同 ID：`ui.spec.header`。来源记录：[Header](../component-catalog.md#ui.family.header)。

### 意图、选择与边界

当前页面的主题和动作。名称、上下文、主要动作、补充说明；窄屏溢出。相邻选择：全局 shell header 由 NavigationShell 管理。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.header)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

PageTitle/Context/PrimaryAction/SecondaryActions/optionalBreadcrumb。

Page Owner供上下文动作；UI管主题阅读路径。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=page/panel；默认 page。
- action=none/one-primary；默认 none，主要承诺最多一个区域。
- overflow=wrap/menu；默认 menu低频动作。

禁止：多个无关primary、Settings藏module header、长title压动作、header写业务fetch。

### 状态转换与可执行恢复

title/context由Page状态更新；action pending自身反馈；header不是页面就绪状态机。

### 具体使用场景

<a id="ui.spec.header.case.01"></a>
#### 会话标题

- **选择**：page
- **触发与可观察结果**：名称+通话/更多入口
- **失败、等待与恢复**：失效会话说明并返回。

<a id="ui.spec.header.case.02"></a>
#### 设置页

- **选择**：page
- **触发与可观察结果**：全局Settings主题和保存
- **失败、等待与恢复**：无dirty不给伪提交。

<a id="ui.spec.header.case.03"></a>
#### 附件面

- **选择**：panel
- **触发与可观察结果**：文件名与保存/关闭共轨
- **失败、等待与恢复**：格式不支持保留真实动作。

<a id="ui.spec.header.case.04"></a>
#### 窄窗口

- **选择**：overflow
- **触发与可观察结果**：主要任务入口可见
- **失败、等待与恢复**：菜单与外部同action模型。

### 键盘、焦点、触摸与读屏

route焦点到主标题；标题不假button；actions可键盘触摸；reader上下文和明确动作。

### 图形、几何与动效

title与actions共享轨，subtitle可换行；header icon36等已有角色；不巨型装饰banner。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长title、极窄、无动作、多context、global与module settings区别。

快捷键归Command Registry；header卸载不清page runtime；不缓存旧对象title。

### 自有公共合同形状

title/context/scope/breadcrumb/primaryAction/secondaryActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.layout"></a>
## PageLayout

合同 ID：`ui.spec.layout`。来源记录：[Layout](../component-catalog.md#ui.family.layout)。

### 意图、选择与边界

页面级边界和区域槽。header/main/sidebar/toc/footer；按平台 policy 分配。相邻选择：不重建 Boot kernel；局部布局用 Stack/Grid。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.layout)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Header/Main/Sidebar/Toc/Footer槽；PageLayout遵循平台PageHost政策。

Presentation/PageHost Owner管区域与生命周期；UI管排版。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- surface=page/split/detail；默认 page。
- sidebar=none/persistent/adaptive；默认 none。
- scroll=main/section；默认 main唯一主要scroll。

禁止：每页造Shell、多个不明main、全页固定高度挡键盘、Layout承接业务boot。

### 状态转换与可执行恢复

route/resize→区域可见调整；page runtime boot由Kernel；layout不推导登录/业务ready。

### 具体使用场景

<a id="ui.spec.layout.case.01"></a>
#### 标准页

- **选择**：main scroll
- **触发与可观察结果**：header与main明确
- **失败、等待与恢复**：长内容可滚动。

<a id="ui.spec.layout.case.02"></a>
#### 分栏会话

- **选择**：split adaptive
- **触发与可观察结果**：窄屏转单面并保留返回
- **失败、等待与恢复**：不丢输入draft。

<a id="ui.spec.layout.case.03"></a>
#### 长文目录

- **选择**：toc
- **触发与可观察结果**：目录与正文关联
- **失败、等待与恢复**：目录隐藏仍有章节路径。

<a id="ui.spec.layout.case.04"></a>
#### 移动输入

- **选择**：insets
- **触发与可观察结果**：键盘出现主任务仍可操作
- **失败、等待与恢复**：不缩小命中区求容纳。

### 键盘、焦点、触摸与读屏

landmarks和skip-to-main；焦点与route转移按平台；触摸键盘safe-area；隐藏区域inert。

### 图形、几何与动效

轨道与minmax约束；共享header高度；resize0ms，区域开合motion role。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

超窄、软键盘、safe area、200%字、多滚动容器和嵌套Page。

PageHost负责alive/draft；layout observer释放；不能把sidebar collapse当销毁服务。

### 自有公共合同形状

surface/regionSlots/sidebarPolicy/scrollPolicy/platformInsets。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.maskshadow"></a>
## OverflowHint

合同 ID：`ui.spec.maskshadow`。来源记录：[MaskShadow](../component-catalog.md#ui.family.maskshadow)、[ScrollShadow](../component-catalog.md#ui.family.scrollshadow)。

### 意图、选择与边界

提示内容可继续滚动。横向工具和竖向列表边缘渐隐。相邻选择：不能遮住最后动作；可滚动性也需键盘路径。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.maskshadow)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

OverflowHint与ScrollArea关联的Start/EndIndicators；MaskShadow、ScrollShadow共享合同。

UI Scroll Owner管提示；ScrollArea供metrics。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- axis=horizontal/vertical；默认 vertical。
- signal=fade/edge-marker；默认 fade，主题可用edge-marker。
- visibility=actual-overflow；固定基于真实scroll位置。

禁止：始终两侧阴影、遮按钮、遮全文却不能滚、两套不同mask真源。

### 状态转换与可执行恢复

无overflow无hint；到start隐藏start，toend隐藏end；动态内容重新测量。

### 具体使用场景

<a id="ui.spec.maskshadow.case.01"></a>
#### 横向chips

- **选择**：horizontal
- **触发与可观察结果**：右侧有溢出才fade
- **失败、等待与恢复**：到尾消失。

<a id="ui.spec.maskshadow.case.02"></a>
#### 日志面

- **选择**：vertical
- **触发与可观察结果**：显示可继续向下
- **失败、等待与恢复**：无内容不残留阴影。

<a id="ui.spec.maskshadow.case.03"></a>
#### 高对比

- **选择**：edge-marker
- **触发与可观察结果**：替换视觉渐隐
- **失败、等待与恢复**：仍不遮文字。

<a id="ui.spec.maskshadow.case.04"></a>
#### RTL容器

- **选择**：metrics
- **触发与可观察结果**：按逻辑起止正确显示
- **失败、等待与恢复**：不硬判scrollLeft>0。

### 键盘、焦点、触摸与读屏

hint装饰不Tab；被遮内容可滚动键盘/触摸；reader不重复“阴影”，必要时提供scroll区域label。

### 图形、几何与动效

统一fade width角色，不遮关键actions/contrast；滚动跟随无easing。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

内容正好等宽、RTL scroll坐标、缩放、scrollbar宽度和高对比。

scroll/Resize observers释放；仅展示不拥有scroll offset或数据。

### 自有公共合同形状

axis/scrollMetrics/edgeVisibility/fadeRole。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.progressiveblur"></a>
## SurfaceFade

合同 ID：`ui.spec.progressiveblur`。来源记录：[ProgressiveBlur](../component-catalog.md#ui.family.progressiveblur)。

### 意图、选择与边界

边缘视觉渐隐特效。只在批准的模块 envelope 且确有空间连续性意义时。相邻选择：普通列表优先 OverflowHint；默认不加装饰 blur。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.progressiveblur)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SurfaceFade装饰层/ProtectedContentArea；不是内容或焦点拥有者。

UI/Presentation Owner管效果适用性；无业务owner。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- use=approved-envelope/off；默认 off。
- effect=fade/blur；默认 fade，blur需明确价值。
- interaction=pass-through；固定不截pointer。

禁止：无批准全局启用、模糊敏感值当安全、遮焦点、用blur表达loading。

### 状态转换与可执行恢复

实际空间连续性需求才启用；reduced/高对比降为静态边界；无业务pending状态。

### 具体使用场景

<a id="ui.spec.progressiveblur.case.01"></a>
#### 批准媒体envelope

- **选择**：fade
- **触发与可观察结果**：提示连续区域
- **失败、等待与恢复**：无overflow不显示。

<a id="ui.spec.progressiveblur.case.02"></a>
#### 低性能模式

- **选择**：off
- **触发与可观察结果**：保留清晰边界与全文
- **失败、等待与恢复**：不阻止任务。

<a id="ui.spec.progressiveblur.case.03"></a>
#### 高对比

- **选择**：static
- **触发与可观察结果**：移除blur保证阅读
- **失败、等待与恢复**：不降低文字可读。

<a id="ui.spec.progressiveblur.case.04"></a>
#### 控件覆盖

- **选择**：protected area
- **触发与可观察结果**：关键动作不在fade区
- **失败、等待与恢复**：pointer不得被装饰层拦截。

### 键盘、焦点、触摸与读屏

装饰aria-hidden；文字不被遮关键部分；键盘触摸穿透；不假装禁用状态。

### 图形、几何与动效

blur/fade只在资产policy登记角色；性能预算与退化明确；不全屏毛玻璃叠层。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长文字、低性能device、高对比、overscroll和多层blur。

清理compositor资源；离屏关闭效果；不持续requestAnimationFrame。

### 自有公共合同形状

envelopeId/effectPolicy/scrollMetrics/protectedContentInsets。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.scrollarea"></a>
## ScrollArea

合同 ID：`ui.spec.scrollarea`。来源记录：[ScrollArea](../component-catalog.md#ui.family.scrollarea)。

### 意图、选择与边界

受控滚动容器。代码块、列表、面板独立 viewport。相邻选择：可以原生滚动则优先原生；不造全局滚动调度。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.scrollarea)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Viewport/Content/Scrollbar/optionalEdgeHints；main与嵌套scroll明确。

Page/Scroll Owner管锚；UI管viewport。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- axis=vertical/horizontal/both；默认 vertical。
- ownership=page/local；默认 local。
- anchoring=browser/explicit-entity；默认 browser，消息由VirtualList明确。

禁止：无限嵌套scroll、scroll锁不释放、滚动每帧set全局Store、横overflow裁掉不可达。

### 状态转换与可执行恢复

user scroll更新offset；data resize按anchoring政策；loading/error属于children。

### 具体使用场景

<a id="ui.spec.scrollarea.case.01"></a>
#### 代码块

- **选择**：horizontal local
- **触发与可观察结果**：长行横向可浏览
- **失败、等待与恢复**：键盘仍可退出。

<a id="ui.spec.scrollarea.case.02"></a>
#### 独立面板

- **选择**：vertical
- **触发与可观察结果**：有明确scroll边界
- **失败、等待与恢复**：短内容不显示多余bar。

<a id="ui.spec.scrollarea.case.03"></a>
#### 消息viewport

- **选择**：explicit anchor
- **触发与可观察结果**：交VirtualList保持位置
- **失败、等待与恢复**：prepend不跳。

<a id="ui.spec.scrollarea.case.04"></a>
#### 移动键盘

- **选择**：page
- **触发与可观察结果**：末行可滚至安全区
- **失败、等待与恢复**：不能锁死body导致输入不可见。

### 键盘、焦点、触摸与读屏

溢出时可键盘操作且有region label；touch惯性与nested手势；不trap Tab；reader不重复wrapper。

### 图形、几何与动效

scrollbar可发现、命中目标；不要全藏bar；手势0ms；padding避免最后一行被footer遮。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

无溢出、横code长行、RTL、粘底、缩放和键盘出现。

scroll/resize listener释放；持久offset由Page owner；滚动不重启业务任务。

### 自有公共合同形状

axis/label/anchorPolicy/scrollPositionPort/edgeHints。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.card"></a>
## Card

合同 ID：`ui.spec.card`。来源记录：[Card](../component-catalog.md#ui.requirement.card)。

### 意图、选择与边界

可独立阅读或操作的对象单元。Agent 摘要、资源卡；reading/action/recovery 分角色。相邻选择：连续会话行不包重卡。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.card)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Subject/Title/Meta/Body/Actions/optionalRecovery；一个可独立理解对象。

Entity/Task Owner管卡内容与动作；UI管阅读单元。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- role=reading/action/recovery；默认 reading。
- activation=none/navigate；默认 none，动作区另有按钮。
- emphasis=flat/selected；默认 flat，选中不等于hover。

禁止：整卡onClick与子button双触发、只有标题无价值、每卡自定尺寸、loading清对象。

### 状态转换与可执行恢复

对象loading/ready/failed按view；card navigation不代表完成；内部action单独pending。

### 具体使用场景

<a id="ui.spec.card.case.01"></a>
#### Agent摘要

- **选择**：reading navigate
- **触发与可观察结果**：显示用途并可进详情
- **失败、等待与恢复**：不可用说明仍可读。

<a id="ui.spec.card.case.02"></a>
#### 资源卡

- **选择**：action
- **触发与可观察结果**：预览与保存为明确动作
- **失败、等待与恢复**：保存失败局部恢复。

<a id="ui.spec.card.case.03"></a>
#### 恢复任务

- **选择**：recovery
- **触发与可观察结果**：展示失败对象和下一步
- **失败、等待与恢复**：不是只有红边。

<a id="ui.spec.card.case.04"></a>
#### 选择集合

- **选择**：selected
- **触发与可观察结果**：选中投影与导航分开
- **失败、等待与恢复**：失败不改对象identity。

### 键盘、焦点、触摸与读屏

语义article/section；主导航为具名Link，禁止把整个含控件card变button；触摸各区；reader标题meta。

### 图形、几何与动效

统一标题/body/action轨道；高度由内容；不默认多层shadow或圆角巨卡。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长摘要、多动作、缺图、失败对象、批量card与200%字。

业务subscription归owner；asset handles释放；card回收不结束task。

### 自有公共合同形状

entityId/role/title/meta/content/navigation/actionViews/recoveryView。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

