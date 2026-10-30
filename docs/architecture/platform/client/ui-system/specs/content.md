# 内容与数据 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [Link](#ui.spec.a)
- [KeyValueList](#ui.spec.descriptions)
- [ShortcutHint](#ui.spec.hotkey)
- [List / ListItem](#ui.spec.list)
- [Markdown / RichText](#ui.spec.markdown)
- [Metric](#ui.spec.statistic)
- [DataTable](#ui.spec.table)
- [Text](#ui.spec.text)
- [CalendarView](#ui.spec.calendarview)
- [VirtualList](#ui.spec.virtuallist)
- [SecretValue](#ui.spec.secretvalue)

<a id="ui.spec.a"></a>
## Link

合同 ID：`ui.spec.a`。来源记录：[A](../component-catalog.md#ui.family.a)。

### 意图、选择与边界

跳转到真实地址或站内位置。站内详情保留返回位置；外部文档显示去向；下载另用 DownloadAction。相邻选择：改变状态用 Button；没有目标不能伪装链接。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.a)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Label/optionalExternalGlyph；Link拥有导航语义，目标交Route/Host port。

Route/Resource Owner供目标授权；UI Owner管Link。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- target=internal/external/section；默认 internal。
- availability=resolved/unavailable；默认 resolved必须有真实目标。
- emphasis=body/quiet；默认 body，不冒充主要命令。

禁止：href="#"、链接偷偷删除、没有href仍role=link、外部handoff成功等于远端任务完成。

### 状态转换与可执行恢复

activate→navigation handoff→目标页面或handoff失败；地址可复制；失效目标保留上下文和返回。

### 具体使用场景

<a id="ui.spec.a.case.01"></a>
#### 进入详情

- **选择**：internal
- **触发与可观察结果**：打开对象路由并保留来源scroll
- **失败、等待与恢复**：对象失效显示返回路径。

<a id="ui.spec.a.case.02"></a>
#### 官方帮助

- **选择**：external
- **触发与可观察结果**：显示真实去向并交host打开
- **失败、等待与恢复**：host拒绝可复制地址。

<a id="ui.spec.a.case.03"></a>
#### 定位章节

- **选择**：section
- **触发与可观察结果**：定位标题并更新锚点
- **失败、等待与恢复**：章节不存在不跳页顶冒成功。

<a id="ui.spec.a.case.04"></a>
#### 受限资源

- **选择**：unavailable
- **触发与可观察结果**：显示不可访问原因与权限路径
- **失败、等待与恢复**：不可暴露秘密目标URL。

### 键盘、焦点、触摸与读屏

Enter导航，支持新标签与复制地址；route转移焦点至标题；触摸明确label；reader外部去向。

### 图形、几何与动效

正文underline policy与Text共用；external glyph装饰；focus即时，导航不等待动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

超长URL、无目标、外部协议拒绝、目标已删除、RTL混合数字。

返回位置由Route Owner保留；卸载不终止外部任务；不用组件缓存授权URL。

### 自有公共合同形状

destinationId/resolvedHref/label/targetKind/navigationPort/unavailableReason。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.descriptions"></a>
## KeyValueList

合同 ID：`ui.spec.descriptions`。来源记录：[Descriptions](../component-catalog.md#ui.family.descriptions)。

### 意图、选择与边界

读取对象属性。身份详情、设备属性、权限摘要；可复制值；多列降为单列。相邻选择：批量记录用 DataTable；可编辑表单用 Field。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.descriptions)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GroupTitle/KeyValueRows/optionalValueActions；每key与value有语义关联。

Entity Owner供属性；UI管可读映射。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- layout=single/multi-column；默认 single，宽屏才multi。
- value=plain/copyable/secret；默认 plain，secret用SecretValue。
- missing=unknown/not-applicable；显式不用空字符串代替。

禁止：0显示—、空=不存在、密码明文属性、每行独立不齐轨道。

### 状态转换与可执行恢复

loading→known/unknown/failed；属性刷新保留asOf；复制独立结果不替换属性真值。

### 具体使用场景

<a id="ui.spec.descriptions.case.01"></a>
#### 设备属性

- **选择**：plain
- **触发与可观察结果**：显示设备名/最后活动/来源
- **失败、等待与恢复**：未知活动明确未知。

<a id="ui.spec.descriptions.case.02"></a>
#### 身份详情

- **选择**：copyable
- **触发与可观察结果**：稳定公开ID可复制
- **失败、等待与恢复**：不复制隐藏凭据。

<a id="ui.spec.descriptions.case.03"></a>
#### 权限摘要

- **选择**：plain
- **触发与可观察结果**：资源范围/期限成对展示
- **失败、等待与恢复**：过期显示真实状态。

<a id="ui.spec.descriptions.case.04"></a>
#### 窄窗口

- **选择**：single
- **触发与可观察结果**：多列降单列顺序不变
- **失败、等待与恢复**：长路径可完整阅读。

### 键盘、焦点、触摸与读屏

dl或等价key-value语义；静态不Tab；copy/link独立焦点；触摸完整值入口；reader键后值。

### 图形、几何与动效

所有行共享label/value/action轨道，窄屏堆叠；长value换行；不为每属性画卡。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长路径、无值与0、秘密、超多字段、RTL键和值混排。

数据订阅归entity owner；不把敏感值写入description缓存；切identity更新整组。

### 自有公共合同形状

title/rows/keyId/valueView/valueKind/asOf/valueActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.hotkey"></a>
## ShortcutHint

合同 ID：`ui.spec.hotkey`。来源记录：[Hotkey](../component-catalog.md#ui.family.hotkey)。

### 意图、选择与边界

展示平台快捷键。菜单右侧 cmd/ctrl；动作 tooltip。相邻选择：设置快捷键用 ShortcutField。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.hotkey)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

KeyTokens/PlatformLabel；只显示，不能在组件注册命令。

Command Registry/Platform Owner管绑定；UI管提示。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- platform=mac/windows/linux；由host注入。
- format=compact/spoken；默认 compact，reader spoken。
- binding=registered/unavailable；默认 registered需registry值。

禁止：文案Cmd但真实Ctrl、hint创建第二快捷键、只屏幕图符无spoken label。

### 状态转换与可执行恢复

显示当前实际binding；未绑定不显示虚构默认；热键变化同步文字。

### 具体使用场景

<a id="ui.spec.hotkey.case.01"></a>
#### 菜单提示

- **选择**：compact
- **触发与可观察结果**：显示真实复制快捷键
- **失败、等待与恢复**：未绑定留空而非猜。

<a id="ui.spec.hotkey.case.02"></a>
#### 工具Tooltip

- **选择**：compact
- **触发与可观察结果**：名称后补充快捷键
- **失败、等待与恢复**：不能成为唯一动作名称。

<a id="ui.spec.hotkey.case.03"></a>
#### 跨平台

- **选择**：platform
- **触发与可观察结果**：Mac⌘与WindowsCtrl按真实绑定
- **失败、等待与恢复**：不机械替换含保留键。

<a id="ui.spec.hotkey.case.04"></a>
#### 辅助阅读

- **选择**：spoken
- **触发与可观察结果**：完整键名可读
- **失败、等待与恢复**：不读符号unicode编码。

### 键盘、焦点、触摸与读屏

被动不Tab；reader读键名“Command加K”；触摸可以阅读但不假装能用硬键盘。

### 图形、几何与动效

keycap排版统一，glyph与文字基线；RTL保持组合键顺序；静态。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

多段组合、无键盘、布局差异、长键名、绑定冲突。

registry subscription清理；无document keydown；不保存自己的binding副本。

### 自有公共合同形状

commandId/bindingView/platform/displayMode。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.list"></a>
## List / ListItem

合同 ID：`ui.spec.list`。来源记录：[List](../component-catalog.md#ui.family.list)。

### 意图、选择与边界

同类对象序列。联系人、会话、文件、搜索结果；meta/action 槽和共享轨道。相邻选择：多列记录用 DataTable；超过测量阈值用 VirtualList。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.list)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ListRoot/ItemPrimary/Meta/Leading/TrailingActions；每行共用轨道。

Collection/Selection Owner管集合；UI管行模板。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=read/navigate/select；必选，决定item语义。
- density=compact/standard；默认 standard。
- scale=ordinary/virtual；默认 ordinary，超边界用VirtualList。

禁止：div行全click又含button、index key、所有列表一律aria-listbox、每行独立宽度。

### 状态转换与可执行恢复

query loading/content/empty/failed；行action pending独立；selected与active route分开。

### 具体使用场景

<a id="ui.spec.list.case.01"></a>
#### 联系人列表

- **选择**：navigate
- **触发与可观察结果**：点详情/独立动作清晰
- **失败、等待与恢复**：失效联系人可返回。

<a id="ui.spec.list.case.02"></a>
#### 选择文件

- **选择**：select
- **触发与可观察结果**：checkbox反映集合
- **失败、等待与恢复**：受限项解释不可选。

<a id="ui.spec.list.case.03"></a>
#### 只读属性序列

- **选择**：read
- **触发与可观察结果**：读语义顺序不Tab每行
- **失败、等待与恢复**：空转明确EmptyState。

<a id="ui.spec.list.case.04"></a>
#### 大量会话

- **选择**：virtual
- **触发与可观察结果**：交VirtualList保持scroll锚
- **失败、等待与恢复**：不能由List重写消息缓存。

### 键盘、焦点、触摸与读屏

阅读列表语义；导航用Link；选择用checkbox/radio；不盲加listbox；触摸动作区不和行导航双触发；reader对象元数据。

### 图形、几何与动效

头像/title/meta/action同轨；长主文可截断有完整入口；行高按密度而非各页硬编码。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0/1/海量、长名、动态删除、重复ID、无权限item。

query owner管集合；row stableID；事件按行身份绑定；虚拟化不代替业务生命周期。

### 自有公共合同形状

items/itemId/purpose/density/selectionView/rowSlots/actions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.markdown"></a>
## Markdown / RichText

合同 ID：`ui.spec.markdown`。来源记录：[Markdown](../component-catalog.md#ui.family.markdown)。

### 意图、选择与边界

渲染受控富文本。消息正文、流式内容、引用/代码/搜索来源；Typography 拆为 Text。相邻选择：HTML 预览用沙箱；编辑用 RichTextEditor。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.markdown)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

DocumentBlocks/InlineText/Code/Links/Citations/ResourceSlots；解析结果与流式原文分开。SearchResultCards 对应引用结果的 Title/Origin/Excerpt/Attribution/AccessStatus；Typography 归 Text 合同。

Message/Document Owner管源内容；UI/Policy Owner管安全解析。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=complete/streaming；默认 complete。
- trust=sanitized-content；固定，插件也受policy。
- capability=basic/registered-rich-plugins；默认 basic。
- source=message/document；owner供真实引用和资源。
- citationPresentation=inline-reference/result-list；默认 inline-reference；多来源结果用result-list，不与正文段落混同。

禁止：执行raw HTML脚本、插件随意越权、引用链接编造、stream每次重建选区、标题样式冒heading。

### 状态转换与可执行恢复

完整解析或增量流→可读blocks；未闭合代码有稳定预览；失败可看原文；链接/资源失败局部恢复。引用结果 loading/ready/empty/failed 独立于正文；同来源用 stable citationID 去重；出处失效保留已知标题/摘录并说明不可打开。

### 具体使用场景

<a id="ui.spec.markdown.case.01"></a>
#### 消息正文

- **选择**：complete basic
- **触发与可观察结果**：安全渲染段落/链接/代码
- **失败、等待与恢复**：解析失败可展开原文。

<a id="ui.spec.markdown.case.02"></a>
#### 流式回答

- **选择**：streaming
- **触发与可观察结果**：增量可读且保留滚动选区
- **失败、等待与恢复**：断流保留已收到内容。

<a id="ui.spec.markdown.case.03"></a>
#### 搜索引用

- **选择**：registered citations result-list
- **触发与可观察结果**：显示标题/来源/摘录/署名与日期，具名Link打开真实出处
- **失败、等待与恢复**：加载失败保留正文；出处失效说明不可打开；未知署名/日期不补造。

<a id="ui.spec.markdown.case.04"></a>
#### 嵌入资源

- **选择**：registered plugin
- **触发与可观察结果**：解析resourceID交安全preview
- **失败、等待与恢复**：格式失败局部降级。

<a id="ui.spec.markdown.case.05"></a>
#### 不可信HTML

- **选择**：sanitized
- **触发与可观察结果**：阻止脚本和危险URL
- **失败、等待与恢复**：不把清洗当业务内容真实性验证。

### 键盘、焦点、触摸与读屏

保留选区、原生文本阅读；标题/list/table语义；链接keyboard可用；触摸长按选择；reader流式不逐token刷。

### 图形、几何与动效

Text/CodeBlock统一排版；不每token fade；code横滚；资源保留ratio避免跳。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

巨大文档、未闭合语法、HTML/XSS、长URL、重复引用、未知插件和RTL代码。引用结果的无日期、无署名、未知来源不伪造；授权来源仅显示可公开摘要，长摘录有完整阅读路径。

解析worker取消/释放；资源handle释放；消息identity变更清旧增量；UI不改源消息。

### 自有公共合同形状

sourceText/documentId/streamRevision/pluginCapabilities/sanitizationPolicy/resourcePort/citationViews；citation包含id/title/origin/excerpt/attribution/dateView/destination/accessState。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.statistic"></a>
## Metric

合同 ID：`ui.spec.statistic`。来源记录：[Statistic](../component-catalog.md#ui.family.statistic)。

### 意图、选择与边界

展示带单位和时间范围的数值。用量、成本、连接数；变化对比明确基期。相邻选择：状态用 StatusTag；业务仪表盘由 domain 组合。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.statistic)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Value/Unit/Period/Comparison/AsOf/Status；Metric不是裸数字。

Metric/Usage Owner管事实；UI管格式与阅读。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- value=known/unknown/stale；默认 unknown。
- comparison=none/absolute/relative；默认 none，基期必供。
- format=count/currency/ratio；必选精度单位。

禁止：unknown当0、无基期涨跌箭头、币种缺失、累计/本月混同、组件推算费用。

### 状态转换与可执行恢复

loading→known/unknown/failed；stale保留asOf；变化不是业务success。

### 具体使用场景

<a id="ui.spec.statistic.case.01"></a>
#### 用量

- **选择**：count known
- **触发与可观察结果**：显示本月token与asOf
- **失败、等待与恢复**：缺数显示未知。

<a id="ui.spec.statistic.case.02"></a>
#### 成本

- **选择**：currency
- **触发与可观察结果**：币种/精度/期间完整
- **失败、等待与恢复**：估算需明确估算来源。

<a id="ui.spec.statistic.case.03"></a>
#### 变化

- **选择**：relative
- **触发与可观察结果**：显示比上期变化及基值
- **失败、等待与恢复**：基值0不造百分比。

<a id="ui.spec.statistic.case.04"></a>
#### 过期统计

- **选择**：stale
- **触发与可观察结果**：保留旧值并标更新时间
- **失败、等待与恢复**：刷新失败不归零。

### 键盘、焦点、触摸与读屏

被动不Tab；读出数值单位和期间；细节Link可达；触摸tooltip非唯一解释。

### 图形、几何与动效

数字tabular排版，单位次级可读；不跑数动画掩盖asOf。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0、负数、NaN、极大值、百分比除零、多币种和缺基期。

数据刷新归Metric owner；格式化按locale；无自有计费计算。

### 自有公共合同形状

metricId/valueState/unit/period/asOf/precision/comparisonBase。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.table"></a>
## DataTable

合同 ID：`ui.spec.table`。来源记录：[Table](../component-catalog.md#ui.family.table)。

### 意图、选择与边界

批量二维记录与比较。设备管理、后台记录、资源统计；sort/filter/select/expand/virtual。相邻选择：社交流用实体 ListItem；不把所有功能页做后台表。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.table)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

TableHeader/Rows/Cells/Sort/Filter/Selection/Expand/Pagination；DataGrid需另声明编辑键盘合同。

Data/Query Owner管排序与分页；UI管二维呈现。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=read-table/interactive-grid；默认 read-table。
- data=client/server；默认 server，sort语义与来源一致。
- selection=none/single/multiple；默认 none。
- scale=ordinary/virtual；默认 ordinary。

禁止：仅当前页排序却称全量、选当前页当全库、index key、所有cell无意义Tab。

### 状态转换与可执行恢复

querying→rows/empty/failed；sort/filter变query；selection范围冻结于批量提交；展开加载有局部failed。

### 具体使用场景

<a id="ui.spec.table.case.01"></a>
#### 设备管理

- **选择**：read-table server
- **触发与可观察结果**：排序与分页提交查询
- **失败、等待与恢复**：失败保留旧页并标旧查询。

<a id="ui.spec.table.case.02"></a>
#### 批量操作

- **选择**：multiple
- **触发与可观察结果**：展示准确选中范围后承诺
- **失败、等待与恢复**：混合失败保留未成功项。

<a id="ui.spec.table.case.03"></a>
#### 展开记录

- **选择**：expand
- **触发与可观察结果**：局部加载详情
- **失败、等待与恢复**：失败只在该行恢复。

<a id="ui.spec.table.case.04"></a>
#### 窄屏比较

- **选择**：responsive
- **触发与可观察结果**：关键列保留其余进详情
- **失败、等待与恢复**：不隐藏关键单位。

<a id="ui.spec.table.case.05"></a>
#### 海量记录

- **选择**：virtual
- **触发与可观察结果**：只窗口渲染且读屏总量/位置可知
- **失败、等待与恢复**：未加载不等于无数据。

### 键盘、焦点、触摸与读屏

表头/单元格语义；read-table按互动控件Tab不全cell；grid才roving；touch窄屏详情替代；reader排序和数量。

### 图形、几何与动效

共享column tracks、sticky边界统一；长单元格有展开；resize跟手；不以卡片替代精确比较。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0行、上万行、缺字段、长路径、冻结列、服务器排序、分页全选与权限混合。

Query/Selection owner持有；observer清理；row stableID；虚拟回收不清选中。

### 自有公共合同形状

rowIds/columns/cellViews/query/sort/filter/selection/expansion/paging。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.text"></a>
## Text

合同 ID：`ui.spec.text`。来源记录：[Text](../component-catalog.md#ui.family.text)。

### 意图、选择与边界

统一排版角色和溢出政策。pageTitle、sectionTitle、body、meta、caption、code；标题仍用语义层级。相邻选择：布局由 Stack；富文本用 RichText。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.text)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SemanticElement/Role/Content/Overflow/optionalFullValue；视觉role不取代heading层级。

UI Typography Owner管角色；Domain Owner供文案事实。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- role=pageTitle/sectionTitle/body/meta/caption/code；默认 body。
- overflow=wrap/ellipsis/clip-approved；默认 wrap。
- semantics=heading/paragraph/inline；按内容明确。

禁止：fontSize当heading、clip关键错误、metadata低对比、Text onclick假按钮。

### 状态转换与可执行恢复

值变更保持阅读；截断有完整可读路径；缺值由业务显式给文案，不统一“—”。

### 具体使用场景

<a id="ui.spec.text.case.01"></a>
#### 页面标题

- **选择**：pageTitle heading
- **触发与可观察结果**：文档主标题与导航焦点
- **失败、等待与恢复**：长名换行不遮主要动作。

<a id="ui.spec.text.case.02"></a>
#### 对象元数据

- **选择**：meta
- **触发与可观察结果**：时间来源仍可读
- **失败、等待与恢复**：缺数据明确未知。

<a id="ui.spec.text.case.03"></a>
#### 长文件名

- **选择**：ellipsis
- **触发与可观察结果**：截断但可完整查看/复制
- **失败、等待与恢复**：触摸不依赖Tooltip。

<a id="ui.spec.text.case.04"></a>
#### 代码片段

- **选择**：code
- **触发与可观察结果**：保留空白和可选择
- **失败、等待与恢复**：不错误换成比例字体。

### 键盘、焦点、触摸与读屏

静态不Tab；heading层级连续；全文展开是具名按钮/Popover；触摸不能只hover全值。

### 图形、几何与动效

唯一type scale、line-height、weight；中文英文200%不硬截高；纯文不动效。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长URL、数字、双向文本、emoji、换行、200%文字和超长标题。

无请求或timer；复制/selectable政策保留；不在Text解析业务对象。

### 自有公共合同形状

role/semanticLevel/content/overflow/fullValueAccess/selectable/locale。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.calendarview"></a>
## CalendarView

合同 ID：`ui.spec.calendarview`。来源记录：[CalendarView](../component-catalog.md#ui.requirement.calendarview)。

### 意图、选择与边界

以日历形式浏览日程。月/周/日；当前时区可见；事件点到详情。相邻选择：只是选择日期用 DateField。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.calendarview)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Toolbar/PeriodTitle/DayHeaders/TimeGrid/EventItems/OverflowMore/Zone。

Calendar/DateTime Owner管事件与时区；UI管日历呈现。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- view=month/week/day；默认 month。
- interaction=read/create；默认 read，create显式权限。
- zone=owner-provided；必选，all-day与instant分开。

禁止：跨zone偏日、重叠事件不可达、拖动未经保存即事实、无权限仍可创建。

### 状态转换与可执行恢复

period navigation→query→events/empty/failed；创建独立Form；拖改日程仅已声明能力。

### 具体使用场景

<a id="ui.spec.calendarview.case.01"></a>
#### 月浏览

- **选择**：month read
- **触发与可观察结果**：选事件进详情，更多显示当天列表
- **失败、等待与恢复**：加载失败保留月份。

<a id="ui.spec.calendarview.case.02"></a>
#### 周日程

- **选择**：week
- **触发与可观察结果**：以可见zone显示真实时段
- **失败、等待与恢复**：DST格子对应实际时间。

<a id="ui.spec.calendarview.case.03"></a>
#### 全天事项

- **选择**：all-day
- **触发与可观察结果**：独立全天轨不冒0点会议
- **失败、等待与恢复**：跨日范围可读。

<a id="ui.spec.calendarview.case.04"></a>
#### 创建预约

- **选择**：create allowed
- **触发与可观察结果**：点击或按钮进Form
- **失败、等待与恢复**：冲突由业务owner反馈。

### 键盘、焦点、触摸与读屏

日期grid箭头定位、事件具名进入详情；today按钮可键盘；触摸不用drag唯一创建；reader完整时间/zone。

### 图形、几何与动效

稳定日/时轨道；overlap不遮全名，更多入口；period切换normal；不把全天强塞0点。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

DST、跨日、全天、多重重叠、上百事件、不同zone、窄屏。

query取消；当前时间clock订阅释放；Calendar不管理预约冲突。

### 自有公共合同形状

period/view/zone/eventViews/queryStatus/onNavigate/onOpenEvent/createAction。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.virtuallist"></a>
## VirtualList

合同 ID：`ui.spec.virtuallist`。来源记录：[VirtualList](../component-catalog.md#ui.requirement.virtuallist)。

### 意图、选择与边界

在性能边界内呈现大列表。消息、会话、联系人；估高与测量策略。相邻选择：小列表用 List。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.virtuallist)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Viewport/MeasuredRows/Spacers/Anchor/AccessiblePosition；只有渲染窗口，不改数据真源。

Collection/Page Owner管数据与锚；UI Virtualization管窗口。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- height=fixed/measured；默认 measured，消息可变高。
- anchor=entity+offset/end-follow；默认 entity+offset。
- follow=at-end-only/manual；默认 at-end-only。

禁止：index anchor、所有插入强制底部、回收焦点无恢复、把未render当不存在。

### 状态转换与可执行恢复

数据插入/高度变化→anchor恢复；用户离底部不自动吸底；分页loading独立；focus row不能静默回收。

### 具体使用场景

<a id="ui.spec.virtuallist.case.01"></a>
#### 消息历史

- **选择**：measured anchor
- **触发与可观察结果**：向上加载保留当前消息位置
- **失败、等待与恢复**：图片迟到重新测量保锚。

<a id="ui.spec.virtuallist.case.02"></a>
#### 底部流

- **选择**：at-end-only
- **触发与可观察结果**：在底部跟随新内容
- **失败、等待与恢复**：阅读旧消息时显示新消息入口。

<a id="ui.spec.virtuallist.case.03"></a>
#### 跳转搜索

- **选择**：entity ID
- **触发与可观察结果**：加载目标范围后定位
- **失败、等待与恢复**：目标已删显示解释而非跳首条。

<a id="ui.spec.virtuallist.case.04"></a>
#### 焦点行

- **选择**：retention
- **触发与可观察结果**：操作行保持可达直到安全转移
- **失败、等待与恢复**：窗口回收不丢菜单焦点。

### 键盘、焦点、触摸与读屏

键盘定位先确保row渲染；reader列表总数/位置按实际已知；触摸滚动稳定；有检索/跳转替代逐条遍历。

### 图形、几何与动效

估高从row角色，实测修正不抖；resize跟手0ms；不可shimmer整个滚动区。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

数万消息、图片迟到、多行扩大、prepend、删除anchor、跳转未加载ID。

Resize/Intersection observers清理；draft与业务订阅归owner；虚拟回收不结束任务。

### 自有公共合同形状

itemIds/estimateHeight/measurementPort/anchorView/followPolicy/loadRange/onAnchorChange。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.secretvalue"></a>
## SecretValue

合同 ID：`ui.spec.secretvalue`。来源记录：[SecretValue](../component-catalog.md#ui.requirement.secretvalue)。

### 意图、选择与边界

可控读取与复制敏感值。恢复词、API 凭据；遮挡/短时显露/复制。相邻选择：普通属性用 KeyValueList。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.secretvalue)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

MaskedSummary/Reveal/Copy/Expiry/Warning；秘密不塞入默认DOM或fixture。

Credential/Security Owner管访问与期限；UI管显露投影。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- visibility=masked/revealed；默认 masked。
- operation=reveal/copy；各有授权port，不必先显示才copy。
- expiry=owner-deadline；必供或明确无显露能力。

禁止：password放title/data-attr、mock真凭据、await前复制成功、timer仅本地清text而handle仍可读。

### 状态转换与可执行恢复

masked→authorizing→revealed→masked/expired；copy确认才copied；授权失败保留遮挡。

### 具体使用场景

<a id="ui.spec.secretvalue.case.01"></a>
#### 查看恢复词

- **选择**：reveal
- **触发与可观察结果**：认证后显示必要时间
- **失败、等待与恢复**：到期或锁屏遮挡释放。

<a id="ui.spec.secretvalue.case.02"></a>
#### 复制API凭据

- **选择**：copy
- **触发与可观察结果**：受限port直接复制
- **失败、等待与恢复**：Clipboard拒绝不把秘密放toast。

<a id="ui.spec.secretvalue.case.03"></a>
#### 失效秘密

- **选择**：expired
- **触发与可观察结果**：说明需重新授权或换凭据
- **失败、等待与恢复**：不重用过期handle。

<a id="ui.spec.secretvalue.case.04"></a>
#### 账号切换

- **选择**：masked
- **触发与可观察结果**：立即丢旧账号显露资源
- **失败、等待与恢复**：不显示上一身份秘密。

### 键盘、焦点、触摸与读屏

具名显露/隐藏/复制键盘触摸；reader默认不朗读秘密；显露按明确用户请求；不自动放明文title。

### 图形、几何与动效

遮挡不暴露真实字符长度policy；等宽值有完整选择路径但不能滚动泄漏；显露无炫技动效。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

多行恢复词、过期、失焦、截屏政策、clipboard拒绝、切账号。

显露timer按deadline；identity切换/锁屏/卸载释放handle并遮挡；不日志/telemetry缓存。

### 自有公共合同形状

secretId/maskedSummary/revealPort/copyPort/revealDeadline/visibilityPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

