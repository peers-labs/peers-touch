# 浮层与窗口 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

作用域焦点服从 `UIProvider inputFocus`。explicit（Mobile）模式下，modal
首次聚焦可读容器；关闭恢复非编辑控件，不唤起此前输入框的软键盘。
Tab/Shift+Tab 仍可进入输入框并在 modal 内循环。automatic 模式保持既有
桌面表单初始焦点。不得通过全局 focus 拦截或定时 blur 改写用户直接输入。

BottomSheet 的 HTML 属性绑定在 dialog 根节点，内容由独立 body 滚动。
表面身份、读屏属性与几何检查不得挂在可能超过视口的滚动内容上。

- [ContextMenu](#ui.spec.contextmenu)
- [Menu](#ui.spec.dropdownmenu)
- [Popover](#ui.spec.popover)
- [Tooltip](#ui.spec.tooltip)
- [Dialog / ConfirmDialog](#ui.spec.modal)
- [Drawer](#ui.spec.drawer)
- [Sheet](#ui.spec.floatingsheet)
- [FloatingPanel](#ui.spec.floatingpanel)

<a id="ui.spec.contextmenu"></a>
## ContextMenu

合同 ID：`ui.spec.contextmenu`。来源记录：[ContextMenu](../component-catalog.md#ui.family.contextmenu)。

### 意图、选择与边界

对象上下文中的次级命令。消息/文件右键；键盘菜单键；移动端长按为同一命令投影。相邻选择：主动作保持可见；设置选择不用上下文菜单。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.contextmenu)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ObjectAnchor/MenuItems/Groups/Submenus；复用Menu命令合同。

Domain Owner供commands；UI Overlay Owner管context。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- entry=pointer-context/keyboard/long-press；默认提供全部适用入口。
- scope=object；固定当前targetID。
- placement=point/element/sheet；按输入平台。

禁止：右击即执行、index目标、长按唯一入口、菜单打开后target换对象。

### 状态转换与可执行恢复

open冻结target identity→choose→命令；target失效关闭；不可用项有原因，不能查权限后闪可用。

### 具体使用场景

<a id="ui.spec.contextmenu.case.01"></a>
#### 消息右键

- **选择**：object menu
- **触发与可观察结果**：显示该条复制/详情
- **失败、等待与恢复**：删消息时菜单安全关闭。

<a id="ui.spec.contextmenu.case.02"></a>
#### 文件菜单

- **选择**：keyboard
- **触发与可观察结果**：Shift+F10等价命令
- **失败、等待与恢复**：不可下载项有理由。

<a id="ui.spec.contextmenu.case.03"></a>
#### 移动长按

- **选择**：sheet
- **触发与可观察结果**：同一命令集合
- **失败、等待与恢复**：可见more可替代长按。

<a id="ui.spec.contextmenu.case.04"></a>
#### 文本选区

- **选择**：policy
- **触发与可观察结果**：保留合法复制行为
- **失败、等待与恢复**：不盲屏蔽原生上下文。

### 键盘、焦点、触摸与读屏

Shift+F10/menu-key，箭头菜单，Escape回对象；touch长按有visible more替代；reader目标与动作。

### 图形、几何与动效

Menu轨道与normal，point anchor collision；touch改Sheet按平台，不用hover submenu。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

虚拟行回收、object被删、右击在文字选区、嵌套菜单与窗口边。

document listeners仅所属scope；close释放；不页面全局抓所有contextmenu。

### 自有公共合同形状

targetId/commands/entryMode/anchorView/menuScope。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.dropdownmenu"></a>
## Menu

合同 ID：`ui.spec.dropdownmenu`。来源记录：[DropdownMenu](../component-catalog.md#ui.family.dropdownmenu)。

### 意图、选择与边界

可执行命令集合。更多动作、分组、checkbox/radio 命令、submenu、danger 区。相邻选择：持久值字段用 Select；自由输入用 Autocomplete。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.dropdownmenu)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Root/Trigger/Popup/Item/Label/Shortcut/Separator/Checkbox/Radio/Submenu；Item角色互斥。

UI Menu Owner管交互；Domain Owner供命令和选择。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- item=command/check/radio/submenu；每项必选。
- scope=window-local；固定host绑定。
- close=after-command/keep-for-choice；默认 after-command，multi可keep。

禁止：menu内任意表单、submenu hover唯一、开菜单发默认命令、focus掉body。

### 状态转换与可执行恢复

closed→open→focus item→activate；command pending在任务投影，menu关闭不冒完成；check/radio更新值。

### 具体使用场景

<a id="ui.spec.dropdownmenu.case.01"></a>
#### 更多动作

- **选择**：command
- **触发与可观察结果**：选择编辑进入任务
- **失败、等待与恢复**：失败由任务面可恢复。

<a id="ui.spec.dropdownmenu.case.02"></a>
#### 显示选项

- **选择**：check
- **触发与可观察结果**：勾选保持menu或按声明关闭
- **失败、等待与恢复**：失败恢复真实值。

<a id="ui.spec.dropdownmenu.case.03"></a>
#### 互斥排序

- **选择**：radio
- **触发与可观察结果**：选一个排序方式
- **失败、等待与恢复**：旧query不盖新选择。

<a id="ui.spec.dropdownmenu.case.04"></a>
#### 子菜单

- **选择**：submenu
- **触发与可观察结果**：键盘进入并可Escape返回
- **失败、等待与恢复**：越屏自动换侧。

### 键盘、焦点、触摸与读屏

Arrow/Home/End/typeahead；submenu左右；Escape逐级回trigger；touch不靠hover；menu item disabled有原因。

### 图形、几何与动效

icon/label/shortcut/trailing共享轨；danger组separator；normal开合，collision无弹簧。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长label、全禁用、几十项、submenu越屏、RTL和嵌入host。

单scope stack与portal；anchor消失关闭；listeners释放；commands一源。

### 自有公共合同形状

menuId/items/itemKind/anchor/portalScope/closePolicy/onCommand/onChoice。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.popover"></a>
## Popover

合同 ID：`ui.spec.popover`。来源记录：[Popover](../component-catalog.md#ui.family.popover)。

### 意图、选择与边界

锚定控件的短任务或详情。emoji 选择、局部说明、轻量编辑。相邻选择：命令用 Menu；阻断任务用 Dialog；纯提示用 Tooltip。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.popover)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Root/Trigger/Anchor/Popup/Title/Content/Close；PopoverGroup共享singleton scope。

UI Overlay Owner管anchor/focus；Task Owner管dirty。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=info/short-task；默认 info，长输入用Dialog/Drawer。
- modality=nonmodal；默认固定，modal任务用Dialog。
- dismiss=outside/explicit/dirty-aware；默认 outside，dirty-aware保草稿。

禁止：pointer开强制focus、非modaltrap、点击外部丢草稿、global portal跨native window。

### 状态转换与可执行恢复

closed→opening→open→closing；presentation不等于business pending；dirty关闭向owner请求。

### 具体使用场景

<a id="ui.spec.popover.case.01"></a>
#### 局部说明

- **选择**：info
- **触发与可观察结果**：锚定对象显示详情
- **失败、等待与恢复**：anchor失效关闭到安全位置。

<a id="ui.spec.popover.case.02"></a>
#### emoji选择

- **选择**：short-task
- **触发与可观察结果**：选择后回composer
- **失败、等待与恢复**：关闭不发送正文。

<a id="ui.spec.popover.case.03"></a>
#### 轻量编辑

- **选择**：dirty-aware
- **触发与可观察结果**：编辑后保存/取消
- **失败、等待与恢复**：outside请求不能默默丢draft。

<a id="ui.spec.popover.case.04"></a>
#### 多个触发

- **选择**：group
- **触发与可观察结果**：打开一个关闭前一同组
- **失败、等待与恢复**：不得叠出多份同意图。

### 键盘、焦点、触摸与读屏

pointer开不抢焦点，keyboard开进入；Escape关闭回trigger；非modal不trap；touch短任务可Sheet；reader标题。

### 图形、几何与动效

稳定anchor collision，normal入出<=4px提案；单scope只一个同组popover；不重复叠影。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

anchor移动/卸载、文本放大、窗口边、多层popover、input dirty。

portal scope与window绑定；scroll/resize监听清理；关闭不终止已提交业务。

### 自有公共合同形状

popoverId/groupId/anchor/open/purpose/dismissPolicy/focusPolicy/onRequestClose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.tooltip"></a>
## Tooltip

合同 ID：`ui.spec.tooltip`。来源记录：[Tooltip](../component-catalog.md#ui.family.tooltip)。

### 意图、选择与边界

简短非交互说明。icon 名称、快捷键、截断值；hover+focus。相邻选择：需要按钮/链接用 Popover；关键原因必须可见。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.tooltip)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

TriggerAssociation/PlainHint/Shortcut；无交互content。TooltipGroup 对同scope的多个trigger共享delay政策和有界当前hint。

UI Overlay Owner；文案与binding各owner供。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=name/shortcut/full-value；默认 name。
- entry=hover+focus；固定双入口，touch关键说明在正文。
- timing=policy；统一delay，不各页计时。

禁止：Tooltip含按钮/表单、disabled原因唯一藏里面、icon无label仅tooltip、全值触摸不可读。

### 状态转换与可执行恢复

idle→delayed visible→hidden；Escape可关闭；trigger移除即隐藏；不是错误恢复唯一路径。

### 具体使用场景

<a id="ui.spec.tooltip.case.01"></a>
#### 图标说明

- **选择**：name
- **触发与可观察结果**：hover/focus解释对象动作
- **失败、等待与恢复**：按钮仍有自身label。

<a id="ui.spec.tooltip.case.02"></a>
#### 快捷键

- **选择**：shortcut
- **触发与可观察结果**：补充真实绑定
- **失败、等待与恢复**：未绑定不造默认。

<a id="ui.spec.tooltip.case.03"></a>
#### 截断内容

- **选择**：full-value
- **触发与可观察结果**：提供完整可读文字
- **失败、等待与恢复**：触摸另有展开路径。

<a id="ui.spec.tooltip.case.04"></a>
#### 禁用原因

- **选择**：supporting
- **触发与可观察结果**：附近可读原因再补提示
- **失败、等待与恢复**：不靠不可焦点disabled触发。

### 键盘、焦点、触摸与读屏

aria-describedby不重复label；无focus trap；reader按关联读说明；touch不依赖长按tooltip。

### 图形、几何与动效

plain文本边界和normal淡入；不箭头摇摆；reduced静态。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长说明、截断全值、disabled不可焦点trigger、多个密集trigger。

delay timer/portal清理；每scope有界；visible不发业务请求；group内快速换trigger取消旧delay，不让旧hint迟到覆盖新对象。

### 自有公共合同形状

hintId/content/triggerRef/purpose/timingPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.modal"></a>
## Dialog / ConfirmDialog

合同 ID：`ui.spec.modal`。来源记录：[Modal](../component-catalog.md#ui.family.modal)。

### 意图、选择与边界

需要专注或明确承诺的任务。创建编辑、删除确认、批准权限；内容/footer/标题/描述。相邻选择：轻信息用 Popover；侧补充用 Drawer；非承诺不弹窗。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.modal)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

DialogRoot/Title/Description/Body/Footer/Close；ConfirmDialog说明对象、范围、后果。

UI Overlay Owner管modal；Domain/Draft Owner管后果和提交。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=task/confirm；必选，危险confirm不是通用boolean。
- dismiss=allowed/dirty-aware/explicit-only；默认 dirty-aware。
- initialFocus=safe/task-input；默认 safe，审批不落批准。

禁止：Enter默认批准权限、无title、遮罩丢dirty、关闭先清实体、scroll锁残留。

### 状态转换与可执行恢复

closed→open→editing/asking→submitting→confirmed/failed；请求关闭先判断dirty/pending；失败保留上下文。

### 具体使用场景

<a id="ui.spec.modal.case.01"></a>
#### 创建编辑

- **选择**：task
- **触发与可观察结果**：输入校验后保存
- **失败、等待与恢复**：失败留draft。

<a id="ui.spec.modal.case.02"></a>
#### 不可逆删除

- **选择**：confirm
- **触发与可观察结果**：展示准确范围与后果后确认
- **失败、等待与恢复**：执行失败保留对象信息。

<a id="ui.spec.modal.case.03"></a>
#### 权限批准

- **选择**：confirm safe
- **触发与可观察结果**：明确此次/期限/拒绝
- **失败、等待与恢复**：初始焦点不得自动同意。

<a id="ui.spec.modal.case.04"></a>
#### 未保存退出

- **选择**：dirty-aware
- **触发与可观察结果**：保存/丢弃/继续由用户选择
- **失败、等待与恢复**：关闭不静默遗弃草稿。

<a id="ui.spec.modal.case.05"></a>
#### 移动键盘

- **选择**：insets
- **触发与可观察结果**：输入和footer仍可达
- **失败、等待与恢复**：不通过缩字解决。

### 键盘、焦点、触摸与读屏

modal trap focus且其他scope inert；Escape遵dismiss；关闭恢复来源或安全fallback；touchback同政策；reader标题描述。

### 图形、几何与动效

明确标题/body/footer轨道；内容有界滚动，键盘不遮动作；normal/slow空间动效。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

超长文、嵌套confirm、来源卸载、软键盘、200%字与后台提交。

window stack/scroll锁成对释放；close不等于cancel business；draft归Task owner。

### 自有公共合同形状

dialogId/kind/title/description/dismissPolicy/initialFocus/taskView/onRequestClose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.drawer"></a>
## Drawer

合同 ID：`ui.spec.drawer`。来源记录：[Drawer](../component-catalog.md#ui.family.drawer)。

### 意图、选择与边界

侧边补充详情或受限任务。桌面消息详情；移动 sheet；需输入的侧任务。相邻选择：不可绕过承诺用 Dialog；常驻工具用 Panel。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.drawer)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Title/Body/TaskFooter/Close；侧边任务与底层上下文关联。

Page/Task Owner管对象和draft；Overlay Owner管drawer。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- modality=nonmodal/modal；默认 nonmodal仅阅读详情；需专注输入可modal。
- placement=side/platform-sheet；按平台，默认 Desktop side。
- dismiss=allowed/dirty-aware；默认 dirty-aware。

禁止：阅读drawer无故trap、底层对象换导致丢dirty、mobile硬挤side、关闭=删除。

### 状态转换与可执行恢复

closed→open→loading/ready/editing/failed；底层选择变更须对drawer object identity裁定，不随便覆盖dirty。

### 具体使用场景

<a id="ui.spec.drawer.case.01"></a>
#### 消息详情

- **选择**：nonmodal
- **触发与可观察结果**：看附件属性保留会话
- **失败、等待与恢复**：对象删除给解释。

<a id="ui.spec.drawer.case.02"></a>
#### 侧边编辑

- **选择**：modal dirty
- **触发与可观察结果**：明确保存与关闭
- **失败、等待与恢复**：失败保留值。

<a id="ui.spec.drawer.case.03"></a>
#### 窄窗口

- **选择**：platform-sheet
- **触发与可观察结果**：转适配表面保同任务
- **失败、等待与恢复**：不重复两份drawer。

<a id="ui.spec.drawer.case.04"></a>
#### 底层切对象

- **选择**：identity
- **触发与可观察结果**：dirty时请求裁定再切
- **失败、等待与恢复**：不静默替换内容。

### 键盘、焦点、触摸与读屏

modal才trap；keyboard开进入标题/input，nonmodal可返回底层；Escape按dirty；touchback；reader对象标题。

### 图形、几何与动效

侧边width bounds与main保底；Mobile用Sheet平台政策；normal/slow位移，reduced即时。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长详情、窄screen、底层对象删除、来源焦点消失和未保存。

resource/query清理；dirty/task由owner；side drawer不新开隐形page runtime。

### 自有公共合同形状

objectId/modality/platformPlacement/dismissPolicy/contentView/taskActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.floatingsheet"></a>
## Sheet

合同 ID：`ui.spec.floatingsheet`。来源记录：[FloatingSheet](../component-catalog.md#ui.family.floatingsheet)。

### 意图、选择与边界

有限屏幕空间中的临时任务。移动选择、分享、详情；允许全高切换。相邻选择：桌面同语义用 Popover/Drawer；不可强行复刻位置。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.floatingsheet)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SheetRoot/Title/Content/Handle/Close/TaskFooter。

Overlay/Platform Owner管sheet；Task Owner管任务。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- height=content/partial/full；默认 content有max。
- modality=modal/nonmodal；默认 modal选择任务。
- dismiss=gesture/explicit/dirty-aware；默认 dirty-aware。

禁止：下滑丢draft、drag唯一关闭入口、内容scroll抢关闭、未释放遮罩。

### 状态转换与可执行恢复

closed→open→height-change→closed；gesture请求关闭仍判断dirty；拖到中间height不是业务完成。

### 具体使用场景

<a id="ui.spec.floatingsheet.case.01"></a>
#### 移动选择

- **选择**：content modal
- **触发与可观察结果**：选择值回原field
- **失败、等待与恢复**：取消不清原值。

<a id="ui.spec.floatingsheet.case.02"></a>
#### 分享任务

- **选择**：partial
- **触发与可观察结果**：受众和动作完整可见
- **失败、等待与恢复**：失败保留选择。

<a id="ui.spec.floatingsheet.case.03"></a>
#### 长详情

- **选择**：full
- **触发与可观察结果**：切全高阅读仍可关闭
- **失败、等待与恢复**：标题与footer不挡内容。

<a id="ui.spec.floatingsheet.case.04"></a>
#### 编辑退出

- **选择**：dirty-aware
- **触发与可观察结果**：手势触发关闭询问
- **失败、等待与恢复**：不能绕表单保护。

### 键盘、焦点、触摸与读屏

modal focus trap；打开时默认聚焦有标题关联的 SheetRoot，避免阅读/管理面自动唤起软键盘；
只有任务显式声明 autofocus 时才直接进入输入。用户点击输入后保留正常键盘和焦点循环。
touchdrag有明确关闭按钮替代；back按dirty；reader标题/展开高度不逐像素announce。

### 图形、几何与动效

safe-area/insets与键盘；拖0ms，release normal；reduced保直接交互无装饰位移。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

短/超长、软键盘、手势与内部scroll冲突、屏幕旋转和200%字。

pointercapture/scroll锁释放；task继续归owner；高度偏好scope明确。

### 自有公共合同形状

sheetId/heightPolicy/modality/dismissPolicy/insets/taskView/onRequestClose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.floatingpanel"></a>
## FloatingPanel

合同 ID：`ui.spec.floatingpanel`。来源记录：[FloatingPanel](../component-catalog.md#ui.family.floatingpanel)。

### 意图、选择与边界

可移动的非模态工具窗。持续查看 Agent 输出或媒体工具；显式固定/恢复。相邻选择：临时选择用 Popover；关键批准用 Dialog。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.floatingpanel)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

WindowTitle/DragHandle/Content/Pin/Restore/Close；非模态工具窗。

Window/Presentation Owner管位置；Task Owner管后台。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- position=free/pinned；默认 free有viewport bounds。
- size=fixed/resizable；默认 fixed，resize复用Panel。
- task=monitor/control；默认 monitor，控制需要具名actions。

禁止：close=停止Agent、漂屏外无法恢复、整个内容可拖、重复相同panel无singleton。

### 状态转换与可执行恢复

open→move/pin/minimize/close；视图关闭不终止后台任务；需要stop单独command。

### 具体使用场景

<a id="ui.spec.floatingpanel.case.01"></a>
#### 监看Agent

- **选择**：monitor
- **触发与可观察结果**：显示任务进度可回主任务
- **失败、等待与恢复**：关闭只关视图。

<a id="ui.spec.floatingpanel.case.02"></a>
#### 媒体工具

- **选择**：control
- **触发与可观察结果**：播放动作独立具名
- **失败、等待与恢复**：拖动不误暂停。

<a id="ui.spec.floatingpanel.case.03"></a>
#### 固定位置

- **选择**：pinned
- **触发与可观察结果**：锁位置但内容可交互
- **失败、等待与恢复**：不锁业务命令。

<a id="ui.spec.floatingpanel.case.04"></a>
#### 恢复屏内

- **选择**：restore
- **触发与可观察结果**：位置超界clamp或显式恢复
- **失败、等待与恢复**：不用清业务data解决布局。

### 键盘、焦点、触摸与读屏

title handle有键盘移动或恢复位置；不trap；touchdrag保点击控件；reader窗口标题与固定状态。

### 图形、几何与动效

window内bounded位置，拖0ms；恢复normal；不画OS伪装控制无handler。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

窗口缩小、屏外旧位置、多panel、内容重、触摸与scroll。

位置偏好归window scope；observer/capture释放；后台订阅由task owner持有。

### 自有公共合同形状

panelId/title/position/bounds/pinned/restoreAction/taskView。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。
