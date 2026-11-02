# 导航与任务位置 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [SectionNav](#ui.spec.anchor)
- [Breadcrumb](#ui.spec.breadcrumb)
- [NavigationToggle](#ui.spec.burger)
- [ResizableNavigationRail](#ui.spec.draggablesidenav)
- [Pagination](#ui.spec.pagination)
- [NavigationRail](#ui.spec.sidenav)
- [StepProgress](#ui.spec.steps)
- [Tabs](#ui.spec.tabs)
- [Tree](#ui.spec.tree)
- [CommandPalette](#ui.spec.commandpalette)

<a id="ui.spec.anchor"></a>
## SectionNav

合同 ID：`ui.spec.anchor`。来源记录：[Anchor](../component-catalog.md#ui.family.anchor)。

### 意图、选择与边界

长文档章节定位。长设置页侧栏目录；滚动高亮当前段；深链接带锚点。相邻选择：普通外链用 Link；功能导航用 NavigationRail。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.anchor)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SectionNav/SectionLinks/ActiveSection；与正文真实heading IDs关联。

Document/Route Owner管章节identity；UI管定位。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- sync=scroll/location；默认 scroll。
- navigation=instant/smooth；默认遵循MotionPolicy。
- layout=rail/inline；默认 rail，窄屏inline。

禁止：目录指不存在ID、active只靠颜色、点击平滑却永不焦点、全局window与局部scroll混用。

### 状态转换与可执行恢复

scroll→activeSection；activate定位真实标题；不存在不伪更新成功锚点。

### 具体使用场景

<a id="ui.spec.anchor.case.01"></a>
#### 长设置页

- **选择**：rail scroll
- **触发与可观察结果**：选章节定位到可见标题
- **失败、等待与恢复**：sticky header不遮目标。

<a id="ui.spec.anchor.case.02"></a>
#### 分享章节

- **选择**：location
- **触发与可观察结果**：深链接恢复同章节
- **失败、等待与恢复**：缺章给可读解释。

<a id="ui.spec.anchor.case.03"></a>
#### 动态章节

- **选择**：sync
- **触发与可观察结果**：追加后目录与heading同步
- **失败、等待与恢复**：删除当前章安全选邻近。

<a id="ui.spec.anchor.case.04"></a>
#### 窄窗口

- **选择**：inline
- **触发与可观察结果**：目录可折叠仍可操作
- **失败、等待与恢复**：不裁长章名。

### 键盘、焦点、触摸与读屏

Link Enter、新标签可深链；route定位后焦点标题；触摸有可读项；reader当前章节。

### 图形、几何与动效

目录与content轨道统一；scroll-margin适配sticky header；reduced不用smooth。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长heading、重复ID、动态章节、嵌套scroll、URL不存在。

Intersection/scroll observers释放；history与深链由Route owner；不在导航复制正文。

### 自有公共合同形状

sections/activeId/scrollContainer/headingResolver/navigationPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.breadcrumb"></a>
## Breadcrumb

合同 ID：`ui.spec.breadcrumb`。来源记录：[Breadcrumb](../component-catalog.md#ui.family.breadcrumb)。

### 意图、选择与边界

展示可回退的层级路径。设置子页和文件夹；中间层可折叠；当前项不可伪装跳转。相邻选择：平级工作区用 Tabs；线性流程用 Steps。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.breadcrumb)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

AncestorLinks/CurrentLabel/OverflowAncestors；层级真实不是浏览历史。

Hierarchy/Route Owner管路径；UI管breadcrumb。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- collapse=none/middle-menu；默认 middle-menu仅不足空间。
- current=non-link/link-if-task；默认 non-link。
- source=hierarchy；固定来源owner。

禁止：current href="#"、路径label当ID、祖先无权限仍泄名、separator可焦点。

### 状态转换与可执行恢复

层级更新→路径；activate祖先route；失效祖先显示状态或重查，不能编造父目录。

### 具体使用场景

<a id="ui.spec.breadcrumb.case.01"></a>
#### 设置子页

- **选择**：hierarchy
- **触发与可观察结果**：全局Settings→子项
- **失败、等待与恢复**：不要把module Settings混全局。

<a id="ui.spec.breadcrumb.case.02"></a>
#### 文件目录

- **选择**：hierarchy
- **触发与可观察结果**：点祖先回真实目录
- **失败、等待与恢复**：目录移动刷新路径。

<a id="ui.spec.breadcrumb.case.03"></a>
#### 深目录

- **选择**：middle-menu
- **触发与可观察结果**：中间层可从menu导航
- **失败、等待与恢复**：完整可读不只有省略号。

<a id="ui.spec.breadcrumb.case.04"></a>
#### 当前页面

- **选择**：non-link
- **触发与可观察结果**：标当前位置
- **失败、等待与恢复**：不重复刷新同页冒动作。

### 键盘、焦点、触摸与读屏

nav label+有序层级；祖先Link可键盘，overflow Menu；触摸能看完整路径；current aria-current。

### 图形、几何与动效

separator装饰，长current可换行/完整读；不缩字；RTL方向policy。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

超深层级、同名、移位/删除祖先、长路径和窄屏。

route owner管路径与返回；overflow anchor释放；不把最近打开页当祖先。

### 自有公共合同形状

ancestorDestinations/currentNode/collapsePolicy/navigationPort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.burger"></a>
## NavigationToggle

合同 ID：`ui.spec.burger`。来源记录：[Burger](../component-catalog.md#ui.family.burger)。

### 意图、选择与边界

切换全局导航可见性。窄窗口展开主导航；桌面折叠 rail。相邻选择：面板开关用 PanelToggle；更多菜单用 IconButton。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.burger)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

NavigationToggleTrigger/Glyph/AccessibleLabel；只切导航可见性。

Shell/Presentation Owner管nav政策；UI管toggle。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=expand-rail/open-overlay；按viewport policy选择。
- visibility=open/closed；默认由Shell提供。
- label=show/hide-navigation；随动作但对象固定。

禁止：仅三个横线无label、toggle同时去首页、关闭hidden nav仍可Tab。

### 状态转换与可执行恢复

closed→open→closed；overlay和persistent rail不同焦点政策；不是route切换。

### 具体使用场景

<a id="ui.spec.burger.case.01"></a>
#### 窄屏主导航

- **选择**：open-overlay
- **触发与可观察结果**：打开nav并可选择页面
- **失败、等待与恢复**：关闭返回原入口。

<a id="ui.spec.burger.case.02"></a>
#### 桌面折叠rail

- **选择**：expand-rail
- **触发与可观察结果**：收窄并保留各入口
- **失败、等待与恢复**：焦点不丢当前项。

<a id="ui.spec.burger.case.03"></a>
#### 键盘退出

- **选择**：overlay
- **触发与可观察结果**：Escape关nav
- **失败、等待与恢复**：不取消当前任务。

<a id="ui.spec.burger.case.04"></a>
#### 窗口变宽

- **选择**：policy
- **触发与可观察结果**：overlay转persistent只保一棵nav
- **失败、等待与恢复**：不留下遮罩锁。

### 键盘、焦点、触摸与读屏

Enter/Space，expanded/controls；keyboard overlay进入nav，Escape返回；触摸可见；reader显示/隐藏导航。

### 图形、几何与动效

header36角色轮廓，glyph为navigation.toggle；motion不延迟可用；reduced静态。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

极窄、键盘打开、当前nav焦点、窗口跨断点。

Shell持状态；跨断点不会双render两套可聚焦nav；卸载释放所属overlay。

### 自有公共合同形状

navigationId/mode/open/onToggle/platformPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.draggablesidenav"></a>
## ResizableNavigationRail

合同 ID：`ui.spec.draggablesidenav`。来源记录：[DraggableSideNav](../component-catalog.md#ui.family.draggablesidenav)。

### 意图、选择与边界

可调宽度的导航侧栏。会话标题较长时扩宽；用户偏好恢复。相邻选择：普通 rail 用 NavigationRail；不再另设一份尺寸真源。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.draggablesidenav)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

NavigationRail/ResizeHandle/CollapseRestore；扩展ResizablePanel而不重写导航。

Shell/Layout Owner管rail与偏好；UI复用resize。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- layout=expanded/collapsed；默认 expanded。
- resize=allowed/fixed-platform；默认 allowed Desktop，Mobile按平台。
- bounds=rail-policy；显式min/max。

禁止：折叠删route状态、rail拖动抢所有点击、另造resize实现与双偏好真源。

### 状态转换与可执行恢复

resize→preference save；collapse保留active route与上次宽度；保存失败当前仍可用。

### 具体使用场景

<a id="ui.spec.draggablesidenav.case.01"></a>
#### 长会话

- **选择**：expanded
- **触发与可观察结果**：拖宽读名称
- **失败、等待与恢复**：触及max不侵占主任务。

<a id="ui.spec.draggablesidenav.case.02"></a>
#### 收起导航

- **选择**：collapsed
- **触发与可观察结果**：留具名icon入口
- **失败、等待与恢复**：关闭不清当前会话草稿。

<a id="ui.spec.draggablesidenav.case.03"></a>
#### 恢复宽度

- **选择**：preference
- **触发与可观察结果**：加载clamp有效宽
- **失败、等待与恢复**：旧屏幕值超界修正。

<a id="ui.spec.draggablesidenav.case.04"></a>
#### 移动导航

- **选择**：fixed-platform
- **触发与可观察结果**：使用Shell平台布局
- **失败、等待与恢复**：不提供无意义拖宽handle。

### 键盘、焦点、触摸与读屏

handle键盘箭头与折叠按钮；nav本身Link语义；touch不整rail拖；reader宽度与目的。

### 图形、几何与动效

导航label/action共同轨道；0ms跟手；collapse normal；icon模式仍提供名称。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长会话名、200%字、0宽父容器、屏幕resize与RTL侧栏。

PageHost持alive；Resize与preferences port复用；无另一个nav Store。

### 自有公共合同形状

navigationModel/sizeView/bounds/collapsed/resizePort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.pagination"></a>
## Pagination

合同 ID：`ui.spec.pagination`。来源记录：[Pagination](../component-catalog.md#ui.family.pagination)。

### 意图、选择与边界

明确切分大量结果。后台记录和可深链接页码；pageSize 选择。相邻选择：会话/消息流用增量加载；不硬加页码。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.pagination)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Previous/Pages/Next/PageSize/ResultCount；页号与cursor模式不混。

Query/Route Owner管分页；UI管入口。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- data=page-number/cursor；默认 page-number；cursor无未知总页号。
- size=fixed/selectable；默认 fixed。
- range=known/unknown-total；默认 unknown-total。

禁止：未知总数造页号、next禁用只灰不解释、失败current跳新页但数据旧。

### 状态转换与可执行恢复

activate page→querying→new page/failed；pending保留旧page标状态；筛选变化reset政策由Query owner。

### 具体使用场景

<a id="ui.spec.pagination.case.01"></a>
#### 管理记录

- **选择**：page-number
- **触发与可观察结果**：第2页query成功才确认当前页
- **失败、等待与恢复**：失败仍第1页。

<a id="ui.spec.pagination.case.02"></a>
#### 未知总量

- **选择**：cursor
- **触发与可观察结果**：仅prev/next与可知数量
- **失败、等待与恢复**：不显示猜测最后页。

<a id="ui.spec.pagination.case.03"></a>
#### 改变页大小

- **选择**：selectable
- **触发与可观察结果**：明确重算页范围
- **失败、等待与恢复**：不保留越界offset。

<a id="ui.spec.pagination.case.04"></a>
#### 末页清空

- **选择**：reconcile
- **触发与可观察结果**：跳合法上一页并查询
- **失败、等待与恢复**：不无限空页。

### 键盘、焦点、触摸与读屏

具名上一页/下一页，current page；keyboard不全组陷阱；touch命中；reader第几页与真实数量。

### 图形、几何与动效

页按钮按compact角色，ellipsis非按钮除非有明确跳转任务；不让总页变更整条抖。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0结果、1页、巨大页数、末页删除、总数未知和长locale。

query取消旧页；page URL可深链由Route；selected数据政策由owner。

### 自有公共合同形状

page/cursor/pageSize/totalState/onNavigate/onPageSizeChange/queryState。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.sidenav"></a>
## NavigationRail

合同 ID：`ui.spec.sidenav`。来源记录：[SideNav](../component-catalog.md#ui.family.sidenav)。

### 意图、选择与边界

持久的主导航或对象列表入口。desktop rail；mobile 同语义适配底部导航；active/notification。相邻选择：局部 tabs 用 Tabs；tree 用 Tree。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.sidenav)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

NavGroups/Links/ActiveMarker/Notification/GlobalSettings；nav不是Tabs。

Shell/Route Owner管导航语义；UI管投影。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- level=global/workspace；必选全局Settings归global。
- presentation=rail/list/bottom；按平台。
- collapse=expanded/icon；默认 expanded，icon必须label。

禁止：全局Settings藏Agent里、点nav销毁全部runtime、active与selected对象混同、icon无名。

### 状态转换与可执行恢复

route active投影；未读由业务；点击导航恢复页面上下文；登录blocked由Shell解释。

### 具体使用场景

<a id="ui.spec.sidenav.case.01"></a>
#### Desktop入口

- **选择**：global rail
- **触发与可观察结果**：先桌面Shell再进功能
- **失败、等待与恢复**：Settings始终全局可达。

<a id="ui.spec.sidenav.case.02"></a>
#### 工作区导航

- **选择**：workspace
- **触发与可观察结果**：换区保持全局设置位置
- **失败、等待与恢复**：不能继承旧workspace权限。

<a id="ui.spec.sidenav.case.03"></a>
#### 移动底部

- **选择**：bottom
- **触发与可观察结果**：同业务目的不同layout
- **失败、等待与恢复**：不假称Desktop管理能力全有。

<a id="ui.spec.sidenav.case.04"></a>
#### 收窄rail

- **选择**：icon
- **触发与可观察结果**：名称可keyboard/touch查看
- **失败、等待与恢复**：不靠hover独占。

### 键盘、焦点、触摸与读屏

nav landmark+Link aria-current；键盘有名称；touch bottom遵同语义；notification不取代label。

### 图形、几何与动效

统一轨道与active marker；header/main入口层级清晰；normal仅指示切换。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长名称、多workspaces、未读巨大、插件入口消失和窄screen。

PageHost持页面alive；nav无业务初始化；commands registry不重复；换账号清旧scope。

### 自有公共合同形状

navModel/activeDestination/presentation/globalEntries/notificationViews。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.steps"></a>
## StepProgress

合同 ID：`ui.spec.steps`。来源记录：[Steps](../component-catalog.md#ui.family.steps)。

### 意图、选择与边界

线性或有分支的任务位置。设备绑定、身份恢复、导入过程。相邻选择：平级浏览用 Tabs；长章节用 SectionNav。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.steps)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

StepList/StepLabel/Current/Completed/Blocked/optionalNavigation。

Journey Owner管步骤前置；UI管进度表达。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- process=linear/branched；默认 linear，branched需owner给合法下一步。
- interaction=status-only/navigable；默认 status-only。
- progress=owner-confirmed；固定。

禁止：点击下一步=完成、未验证跳安全步骤、branch画成固定线却不说明、status-only小点可点。

### 状态转换与可执行恢复

not-started→current→completed或blocked；下一步依真实前置；回退不自动回滚已完成业务。

### 具体使用场景

<a id="ui.spec.steps.case.01"></a>
#### 设备绑定

- **选择**：linear
- **触发与可观察结果**：等手机批准时当前步waiting
- **失败、等待与恢复**：不能自动下一步。

<a id="ui.spec.steps.case.02"></a>
#### 身份恢复

- **选择**：navigable
- **触发与可观察结果**：合法回看步骤
- **失败、等待与恢复**：完成状态依owner保留。

<a id="ui.spec.steps.case.03"></a>
#### 导入过程

- **选择**：status-only
- **触发与可观察结果**：显示当前阶段与失败
- **失败、等待与恢复**：没导完不全部绿。

<a id="ui.spec.steps.case.04"></a>
#### 分支任务

- **选择**：branched
- **触发与可观察结果**：选择后显示真实路线
- **失败、等待与恢复**：弃分支不伪标完成。

### 键盘、焦点、触摸与读屏

status-only不焦点；可导航步有button/link且说明可达；reader当前/总/阻断；touch不是小圆点唯一入口。

### 图形、几何与动效

step marker与文本同轨；narrow可竖排；completed标记不靠绿；动效normal只表示位置。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

跳步骤、异步等待、分支重选、长label、恢复会话和失败。

Journey Owner持progress；Step组件不检查协议；timer不判断完成。

### 自有公共合同形状

stepGraph/currentStep/completedIds/blockedReasons/navigationActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.tabs"></a>
## Tabs

合同 ID：`ui.spec.tabs`。来源记录：[Tabs](../component-catalog.md#ui.family.tabs)。

### 意图、选择与边界

同一上下文中的平级内容面。详情页 tabs；Settings 子区；主模块由 PageHost policy 管理。相邻选择：几个表单值用 Segmented/Radio；层级用 NavigationRail。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.tabs)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

TabList/Triggers/ActiveIndicator/TabPanels；同上下文平级内容。

Page/Route Owner管panel和alive；UI管tab交互。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- activation=automatic/manual；默认 automatic仅轻本地panel。
- mount=preserve/conditional；PageHost政策决定，默认preserve有边界。
- route=local/deep-link；默认 local。

禁止：Tabs当全局Shell、隐藏panel可Tab、箭头触发昂贵请求无manual、切换清draft。

### 状态转换与可执行恢复

focus tab与selected分开manual；activate→panel loading/ready/error；切tab不等于完成panel任务。

### 具体使用场景

<a id="ui.spec.tabs.case.01"></a>
#### 详情子面

- **选择**：local automatic
- **触发与可观察结果**：切概览/记录同对象
- **失败、等待与恢复**：记录失败局部恢复。

<a id="ui.spec.tabs.case.02"></a>
#### 设置编辑

- **选择**：preserve
- **触发与可观察结果**：切tab保留未保存值
- **失败、等待与恢复**：离页按Form dirty政策。

<a id="ui.spec.tabs.case.03"></a>
#### 昂贵数据

- **选择**：manual
- **触发与可观察结果**：箭头定位Enter加载
- **失败、等待与恢复**：不每次focus发query。

<a id="ui.spec.tabs.case.04"></a>
#### 深链tab

- **选择**：deep-link
- **触发与可观察结果**：URL恢复指定面
- **失败、等待与恢复**：不存在tab明确fallback说明。

### 键盘、焦点、触摸与读屏

单Tab入tablist，箭头/Home/End；manual Enter；aria-controls/selected；隐藏panel inert；touch label；reader标题。

### 图形、几何与动效

统一tab轨道，normal indicator；过多可滚/overflow；200%不缩字；reduced即时。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

disabled tab、panel dirty、重请求、深链接失效、tab移除。

PageHost管alive；panel保留draft/scroll；组件不得每次切换重boot runtime。

### 自有公共合同形状

tabs/selectedId/activation/mountPolicy/routePolicy/onSelect/panelViews。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.tree"></a>
## Tree

合同 ID：`ui.spec.tree`。来源记录：[Tree](../component-catalog.md#ui.family.tree)。

### 意图、选择与边界

层级数据导航或选择。文件夹、知识目录；lazy load；checkable 独立。相邻选择：平级列表用 List；表单复杂选择用 TreeSelect。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.tree)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

TreeRoot/TreeItems/Expand/Label/optionalCheck/LoadStatus；导航与check分开。

Hierarchy/Selection Owner管树与权限；UI管导航。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=navigate/select；默认 navigate。
- load=eager/lazy；默认 eager。
- check=none/cascade/independent；默认 none，cascade有范围政策。

禁止：展开=选中、未加载=leaf、cascade越权、循环无限递归、label当ID。

### 状态转换与可执行恢复

expand→loading children→expanded/failed；selected与expanded分开；unknown children不等于leaf。

### 具体使用场景

<a id="ui.spec.tree.case.01"></a>
#### 文件导航

- **选择**：navigate lazy
- **触发与可观察结果**：展开目录后进文件
- **失败、等待与恢复**：加载失败可重试同支。

<a id="ui.spec.tree.case.02"></a>
#### 知识目录

- **选择**：navigate
- **触发与可观察结果**：层级与章节清晰
- **失败、等待与恢复**：目标删除有返回。

<a id="ui.spec.tree.case.03"></a>
#### 层级多选

- **选择**：cascade policy
- **触发与可观察结果**：父mixed反映可选子
- **失败、等待与恢复**：无权子不被全选。

<a id="ui.spec.tree.case.04"></a>
#### 键盘收起

- **选择**：navigation
- **触发与可观察结果**：左箭头收枝焦点在父
- **失败、等待与恢复**：hidden子不继续可达。

### 键盘、焦点、触摸与读屏

Arrow上下可见节点，左右展开/收，Home/End；typeahead；readerlevel/expanded/selected；touch独立expand/选择。

### 图形、几何与动效

缩进与indicator统一，深层不压字到无宽；水平scroll或路径详情；展开normal。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

循环数据、超深、上万节点、partial权限、lazy空与失败。

load requests取消；稳定nodeID；fold子焦点移父；check集合归Selection owner。

### 自有公共合同形状

nodes/nodePort/expandedIds/selectedIds/checkPolicy/onExpand/onSelect。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.commandpalette"></a>
## CommandPalette

合同 ID：`ui.spec.commandpalette`。来源记录：[CommandPalette](../component-catalog.md#ui.requirement.commandpalette)。

### 意图、选择与边界

跨页面的可发现命令入口。搜索命令/对象；快捷键调起；近期使用。相邻选择：编辑器插入用 SlashCommandMenu。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.commandpalette)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Dialog/Search/GroupedResults/CommandOrObjectMeta/ShortcutHint/EmptyRecovery。

Command/Directory Owner管可执行集合；UI管统一查找。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- result=command/object；每项必选，分别执行/导航。
- scope=global/workspace；默认 global有明确可见scope。
- query=local/remote-mixed；默认 local，remote部分标等待。

禁止：palette绕权限、快捷键重复注册、对外品牌命令canonical化、第一项默认危险执行。

### 状态转换与可执行恢复

open→query→results/empty/failed→choose；危险命令进入确认，palette选择不代表批准。

### 具体使用场景

<a id="ui.spec.commandpalette.case.01"></a>
#### 查找命令

- **选择**：local command
- **触发与可观察结果**：输入并选真实命令
- **失败、等待与恢复**：不可用给具体原因。

<a id="ui.spec.commandpalette.case.02"></a>
#### 查找对象

- **选择**：remote object
- **触发与可观察结果**：结果显示来源，选择导航
- **失败、等待与恢复**：远端失败仍可用本地命令。

<a id="ui.spec.commandpalette.case.03"></a>
#### 危险动作

- **选择**：command
- **触发与可观察结果**：选择后打开确认面
- **失败、等待与恢复**：不能直接删对象。

<a id="ui.spec.commandpalette.case.04"></a>
#### 触摸使用

- **选择**：global visible entry
- **触发与可观察结果**：可从Shell入口开palette
- **失败、等待与恢复**：不只提供Cmd+K。

### 键盘、焦点、触摸与读屏

注册快捷键打开，keyboard焦点搜索；Arrow/Enter选择、Escape返回来源；touch入口可见；reader对象/命令类型。

### 图形、几何与动效

复用Dialog和Autocomplete轨道；结果分组非满屏卡；normal进出，输入0ms。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

重复命令名、无权限、远端迟到、无硬键盘、空query近期项。

registry真实命令集合；query取消；选命令后焦点交任务；恢复trigger可能已卸载用安全fallback。

### 自有公共合同形状

scope/commandRegistry/objectQueryPort/resultViews/onExecute/onNavigate。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

