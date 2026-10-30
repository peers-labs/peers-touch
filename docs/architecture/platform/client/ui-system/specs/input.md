# 输入与选择 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [TextField / NumberField / PinField / PasswordField / TextArea](#ui.spec.input)
- [Autocomplete](#ui.spec.autocomplete)
- [Checkbox / CheckboxGroup](#ui.spec.checkbox)
- [Radio / RadioGroup](#ui.spec.radio)
- [Switch](#ui.spec.switch)
- [Select / MultiSelect](#ui.spec.select)
- [SearchField](#ui.spec.searchbar)
- [Form / Field / FieldGroup](#ui.spec.form)
- [InlineEdit](#ui.spec.editabletext)
- [ColorPicker](#ui.spec.colorpicker)
- [ColorSwatches](#ui.spec.colorswatches)
- [DateField / DateRangeField](#ui.spec.datepicker)
- [TimeField](#ui.spec.timefield)
- [ShortcutField](#ui.spec.hotkeyinput)
- [ImageChoice](#ui.spec.imageselect)
- [Rating](#ui.spec.rate)
- [SegmentedControl](#ui.spec.segmented)
- [Slider / SliderField](#ui.spec.slider)
- [ToggleButton / ToggleGroup](#ui.spec.togglegroup)
- [ReorderableList](#ui.spec.sortablelist)
- [FilePicker / FileDropzone](#ui.spec.upload)
- [SlashCommandMenu](#ui.spec.editorslashmenu)
- [EmojiPicker](#ui.spec.emojipicker)
- [MentionPicker](#ui.spec.mentionpicker)
- [RichTextEditor](#ui.spec.richtexteditor)
- [TreeSelect / Cascader](#ui.spec.treeselect)

<a id="ui.spec.input"></a>
## TextField / NumberField / PinField / PasswordField / TextArea

合同 ID：`ui.spec.input`。来源记录：[Input](../component-catalog.md#ui.family.input)。

### 意图、选择与边界

编辑原始文本或受约束值。短文/密码/数字/PIN/多行分开；prefix/suffix/help/error 属于 Field。相邻选择：查询用 SearchField；结构选择用 Select。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.input)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FieldFrame统一Label/Prefix/Value/Suffix/Helper/Error；TextField、NumberField、PasswordField、PinField、TextArea独立值合同，共用frame。

UI Owner 管输入语义与FieldFrame；Form/Domain Owner 管draft、值有效性和提交。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=text/number/password/pin/multiline；必选，不用一个type万能接口。
- editing=editable/readOnly/disabled；默认 editable；readOnly允许阅读复制，disabled解释原因。
- commit=explicit/blur；默认 explicit，IME期间禁止提交。
- validation=untouched/checking/valid/invalid；默认 untouched，与transport分离。

禁止：placeholder代label、Number用truthiness丢0、逐字符IME校验、密码进日志、PIN六个独立错误ring、readonly被禁用。

### 状态转换与可执行恢复

edit产生dirty draft→validate→commit pending→saved/transportFailed；非法数值不提交；Pin验证失败保持可重输政策；secret显露由owner控制。

### 具体使用场景

<a id="ui.spec.input.case.01"></a>
#### 短文本命名

- **选择**：TextField explicit
- **触发与可观察结果**：输入名称后提交，保留前后空白处理说明
- **失败、等待与恢复**：超长或重复名定位字段并保留草稿。

<a id="ui.spec.input.case.02"></a>
#### 数字参数

- **选择**：NumberField step+range
- **触发与可观察结果**：允许编辑中间态“-”，提交时解析精确值
- **失败、等待与恢复**：越界不偷偷clamp已提交业务值。

<a id="ui.spec.input.case.03"></a>
#### 密码登录

- **选择**：PasswordField
- **触发与可观察结果**：默认遮挡，显式按可见按钮，提交受限凭据
- **失败、等待与恢复**：失败不泄漏明文；显露时限和清空由credential政策。

<a id="ui.spec.input.case.04"></a>
#### 验证码

- **选择**：PinField declared length
- **触发与可观察结果**：整串粘贴分配，Backspace返回前位，提交一次
- **失败、等待与恢复**：错误或过期区别显示，重新发送有真实期限。

<a id="ui.spec.input.case.05"></a>
#### 多行描述

- **选择**：TextArea
- **触发与可观察结果**：Enter换行，明确按钮提交，可伸高到限值
- **失败、等待与恢复**：失败保留多行草稿和光标。

<a id="ui.spec.input.case.06"></a>
#### 只读地址

- **选择**：readOnly TextField
- **触发与可观察结果**：可聚焦和复制，说明由系统管理
- **失败、等待与恢复**：不可变不是disabled，仍可完整阅读。

<a id="ui.spec.input.case.07"></a>
#### 中文编辑

- **选择**：TextField IME
- **触发与可观察结果**：composition结束才验证或响应提交键
- **失败、等待与恢复**：未完成候选不被Enter发出。

<a id="ui.spec.input.case.08"></a>
#### 组合地址

- **选择**：prefix+value一frame
- **触发与可观察结果**：协议与host共同编辑同一地址
- **失败、等待与恢复**：整值错误在父frame显示，不加双边框。

### 键盘、焦点、触摸与读屏

Tab至语义输入；TextArea Enter换行，提交另有明确快捷键；Number箭头按step；PIN粘贴整串且Backspace连续；触摸inputMode匹配；读屏label/helper/error一次。

### 图形、几何与动效

同意图一个外框和focus ring；前后缀同轨；多行自适应高度有上限；密码眼睛为具名IconButton；输入不加位移动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

空与0、负数/指数/小数精度、中文IME、emoji组合字符、长URL、粘贴带空格、200%字；PIN长度不写死为6。

draft归Form/composer owner；debounce与验证请求可取消；切换账号清敏感值；旧校验不能覆盖新draft。

### 自有公共合同形状

各kind独立value类型；fieldId/label/draft/validation/readOnly；number有min/max/step/precision；pin有length/alphabet；onEdit/onCommit。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.autocomplete"></a>
## Autocomplete

合同 ID：`ui.spec.autocomplete`。来源记录：[AutoComplete](../component-catalog.md#ui.family.autocomplete)。

### 意图、选择与边界

允许自由输入并提供建议。搜索历史可自由提交；联系人输入候选需显示身份；远端建议采用防抖和取消。相邻选择：只能选已有值用 Select；@实体用 MentionPicker。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.autocomplete)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

TextField/Listbox/ActiveOption/QueryStatus；自由文本与候选entity不混值。

Query/Directory Owner 管候选授权与查询；UI管编辑与选择。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- selection=free-text/entity；默认 free-text；实体提交必须选真实identity。
- source=local/remote；默认 local；远端需query identity。
- commit=submit/select；默认 submit；选建议与提交业务分开。

禁止：自由文本伪entity、第一项自动批准、旧结果盖新查询、只有鼠标可选。

### 状态转换与可执行恢复

typing→querying→suggestions/empty/failed；过期结果忽略；选中填值，是否提交按合同；查询失败允许自由文本或要求重查。

### 具体使用场景

<a id="ui.spec.autocomplete.case.01"></a>
#### 搜索历史

- **选择**：free-text local
- **触发与可观察结果**：输入显示历史，Enter可提交新词
- **失败、等待与恢复**：无历史不禁用自由输入。

<a id="ui.spec.autocomplete.case.02"></a>
#### 找联系人

- **选择**：entity remote
- **触发与可观察结果**：候选显示身份来源，选择后绑定entity
- **失败、等待与恢复**：同名不能只凭label提交。

<a id="ui.spec.autocomplete.case.03"></a>
#### 服务不可用

- **选择**：remote
- **触发与可观察结果**：保留查询并显示重新查询
- **失败、等待与恢复**：entity模式不能把未解析文本当用户。

<a id="ui.spec.autocomplete.case.04"></a>
#### 快速改词

- **选择**：query identity
- **触发与可观察结果**：只呈现最后查询结果
- **失败、等待与恢复**：逆序响应丢弃，不闪回旧建议。

### 键盘、焦点、触摸与读屏

焦点保留input，Arrow移动候选、Enter选择、Escape关；IME不触发select；触摸点击候选；读屏expanded与数量。

### 图形、几何与动效

FieldFrame唯一ring；候选等高轨道、身份副文；normal开合不影响输入跟手。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同名实体、零建议、上万本地候选、过期请求逆序、长查询与空白。

取消旧query和debounce；dismiss不清typed draft；entity范围切换废弃旧候选。

### 自有公共合同形状

draft/queryId/sourcePort/options/selectionMode/selectedEntity/onEdit/onChoose/onSubmit。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.checkbox"></a>
## Checkbox / CheckboxGroup

合同 ID：`ui.spec.checkbox`。来源记录：[Checkbox](../component-catalog.md#ui.family.checkbox)。

### 意图、选择与边界

独立布尔或多选集合。批量选择；接受条款；父项 mixed；多个偏好可同时选。相邻选择：立即生效设置用 Switch；互斥值用 Radio。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.checkbox)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Input/Label/Helper；Group有Legend，父级mixed只表示部分选择。

UI Owner 管三态；Form/Selection Owner 管集合范围。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- value=checked/unchecked/mixed；默认 unchecked；mixed仅聚合投影。
- mode=single/group/tree-summary；默认 single。
- commit=draft；默认进入表单草稿，立即设置优先Switch。

禁止：mixed当第三个可提交布尔值、全选越权、Checkbox与链接同一次激活、未勾选条款默认同意。

### 状态转换与可执行恢复

toggle改draft→Form提交；mixed激活默认选择全部，清空需再激活；远端失败按Form恢复，不自行显示保存成功。

### 具体使用场景

<a id="ui.spec.checkbox.case.01"></a>
#### 批量选择

- **选择**：group
- **触发与可观察结果**：勾选多项，父项显示mixed
- **失败、等待与恢复**：受限项不纳入可操作全选。

<a id="ui.spec.checkbox.case.02"></a>
#### 接受条款

- **选择**：single
- **触发与可观察结果**：明确勾选后满足提交前置条件
- **失败、等待与恢复**：不能预选替用户同意。

<a id="ui.spec.checkbox.case.03"></a>
#### 父级全选

- **选择**：tree-summary
- **触发与可观察结果**：mixed→选全部可选子项
- **失败、等待与恢复**：部分失败保留逐项状态。

<a id="ui.spec.checkbox.case.04"></a>
#### 多个偏好

- **选择**：draft group
- **触发与可观察结果**：各选项独立开关，统一保存
- **失败、等待与恢复**：保存失败不抹掉选择。

### 键盘、焦点、触摸与读屏

Space切换，Tab每个可操作项；label同命中区但不包独立链接；读屏checked/mixed和Legend。

### 图形、几何与动效

方形check轮廓、check/mixed自有glyph；fast状态色；触摸外扩不跨相邻项。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

零项、部分禁用、全选受限、长条款、多行label和200%字。

选中集按stable value持有；过滤不默认清隐藏选择；scope变化由owner裁定。

### 自有公共合同形状

checked/valueSet/items/label/disabledReason/onDraftChange/groupLabel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.radio"></a>
## Radio / RadioGroup

合同 ID：`ui.spec.radio`。来源记录：[Radio](../component-catalog.md#ui.family.radio)。

### 意图、选择与边界

少量互斥值。权限范围、发布模式、少量设置选择。相邻选择：更多候选用 Select；视图切换用 Segmented。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.radio)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GroupLegend/RadioItems/Descriptions；一个group拥有一个值。

UI Owner 管互斥选择；Domain/Form Owner管可选值。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- selection=required/optional；默认 required；可空时提供明确“无”选项或清空。
- layout=stack/inline；默认 stack，短选项可inline。
- presentation=plain/descriptive；默认 plain，复杂权限用描述。

禁止：多个checked、用颜色区分无语义、disabled选项被默认提交、选项移除静默换值。

### 状态转换与可执行恢复

选择替换draft值→显式提交；required未选为未完成，不自动选高风险授权。

### 具体使用场景

<a id="ui.spec.radio.case.01"></a>
#### 权限范围

- **选择**：descriptive
- **触发与可观察结果**：用户选此次/限定时长，再单独批准
- **失败、等待与恢复**：不预选永久授权。

<a id="ui.spec.radio.case.02"></a>
#### 发布模式

- **选择**：required
- **触发与可观察结果**：私有/指定受众择一
- **失败、等待与恢复**：未选不提交。

<a id="ui.spec.radio.case.03"></a>
#### 无需某选项

- **选择**：optional
- **触发与可观察结果**：明确选择“无”
- **失败、等待与恢复**：空值不等于失效候选。

<a id="ui.spec.radio.case.04"></a>
#### 候选变更

- **选择**：stable value
- **触发与可观察结果**：保留有效值，失效值提示重选
- **失败、等待与恢复**：不悄悄换第一项。

### 键盘、焦点、触摸与读屏

Tab入组、箭头选下一项、Space选当前；disabled不参与选择；触摸label可点；读屏group与checked。

### 图形、几何与动效

Radio识别圆点属输入语义，不能推广圆形IconButton；同描述轨道；fast颜色。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

单项、全禁用、长描述、已选项被删除、RTL箭头方向。

stable values；候选更新保留仍有效选择，无效交owner提示而非选第一项。

### 自有公共合同形状

value/options/required/groupLabel/onDraftChange/disabledReasons。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.switch"></a>
## Switch

合同 ID：`ui.spec.switch`。来源记录：[Switch](../component-catalog.md#ui.family.switch)。

### 意图、选择与边界

立即生效的单项设置。通知开关、显示选项；需远端保存时 pending。相邻选择：提交表单里的布尔用 Checkbox；危险操作用确认。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.switch)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Label/Description/Switch/SaveStatus；label说明设置本身，不随值换成两个命令。

Settings Owner 管持久值与乐观回滚；UI Owner管switch。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- commit=immediate；固定，统一提交表单用Checkbox。
- execution=idle/pending/failed；默认 idle。
- availability=editable/locked；默认 editable，locked有原因。

禁止：乐观值当确认值、失败不rollback、Switch等待大表单提交、label只写开/关。

### 状态转换与可执行恢复

on/off→pending desired value→owner confirmed/failed rollback；pending不等于禁用原因，竞争toggle按owner政策。

### 具体使用场景

<a id="ui.spec.switch.case.01"></a>
#### 消息通知

- **选择**：immediate
- **触发与可观察结果**：切换后显示正在保存，确认后稳定
- **失败、等待与恢复**：失败回到原值并可重试。

<a id="ui.spec.switch.case.02"></a>
#### 显示密度

- **选择**：local immediate
- **触发与可观察结果**：本地确认立即生效
- **失败、等待与恢复**：写偏好失败说明未持久化。

<a id="ui.spec.switch.case.03"></a>
#### 策略锁定

- **选择**：locked
- **触发与可观察结果**：读设置值与不可改原因
- **失败、等待与恢复**：恢复动作在邻近SettingRow。

<a id="ui.spec.switch.case.04"></a>
#### 快速操作

- **选择**：single intent
- **触发与可观察结果**：pending显示期望值并阻竞争
- **失败、等待与恢复**：收到过期响应不覆盖新值。

### 键盘、焦点、触摸与读屏

Space切换；焦点保持；触摸整体label命中；读屏switch checked及保存失败，不仅颜色。

### 图形、几何与动效

track/thumb为开关专用轮廓；fast或normal位移；reduced静态替换；外围命中至少目标提案。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

远端旧值、极慢保存、离线、连续点击、账号切换与受策略锁定。

pending意图由设置runtime持有；组件卸载不撤销保存；旧账号回调丢弃。

### 自有公共合同形状

settingId/confirmedValue/desiredValue/execution/lockedReason/onToggle。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.select"></a>
## Select / MultiSelect

合同 ID：`ui.spec.select`。来源记录：[Select](../component-catalog.md#ui.family.select)。

### 意图、选择与边界

从已有集合中选值。模型、成员、语言；search/multi/clear/virtual 是明确能力。相邻选择：允许自由输入用 Autocomplete；少量互斥用 Radio。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.select)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FieldFrame/ValueSummary/Trigger/Listbox/QueryStatus；MultiSelect另有ChipList与Remove。

Directory/Model/Form Owner供真实候选和权限；UI管选择投影。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- selection=single/multiple；默认 single；多值明确MultiSelect合同。
- search=none/local/remote；默认 none，小集合优先Radio。
- clear=allowed/required；默认 required，清空不造未知值。
- commit=choose/draft；默认 draft，由Form决定提交。

禁止：自由文本当合法ID、多选截断无数量、菜单关闭自动保存、加载时清空既有选择。

### 状态转换与可执行恢复

closed→open→querying/options/failed→choose→draft；multi选择不每次关闭；失效已选值保留可读信息并要求修正。

### 具体使用场景

<a id="ui.spec.select.case.01"></a>
#### 模型选择

- **选择**：single remote
- **触发与可观察结果**：显示名字和可用性，选择有效modelId
- **失败、等待与恢复**：失效模型保留说明并可重选。

<a id="ui.spec.select.case.02"></a>
#### 添加成员

- **选择**：multiple
- **触发与可观察结果**：逐项选择，chips可移除，最后明确提交
- **失败、等待与恢复**：权限变化标出失效成员。

<a id="ui.spec.select.case.03"></a>
#### 选择语言

- **选择**：single local
- **触发与可观察结果**：本地过滤，选locale更新草稿
- **失败、等待与恢复**：不能把label当localeID。

<a id="ui.spec.select.case.04"></a>
#### 清空可选值

- **选择**：clear allowed
- **触发与可观察结果**：清空为null并保留焦点
- **失败、等待与恢复**：required值不给虚假清空入口。

<a id="ui.spec.select.case.05"></a>
#### 海量候选

- **选择**：remote+virtual
- **触发与可观察结果**：查询并键盘定位可视候选
- **失败、等待与恢复**：失败保留已选值和查询词。

<a id="ui.spec.select.case.06"></a>
#### 候选无权限

- **选择**：不可选
- **触发与可观察结果**：显示可读限制与替代
- **失败、等待与恢复**：不能从UI解除权限。

### 键盘、焦点、触摸与读屏

Arrow/Enter选择、Escape返回trigger；输入搜索用activedescendant；chip Backspace先定位再删除；触摸sheet适配；读屏value/数量/原因。

### 图形、几何与动效

父FieldFrame唯一ring；value-label-status槽稳定；长值省略有完整阅读；菜单normal。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同名、无项、上万项虚拟、已选不可见、全部选中、长chip与RTL。

query取消、选中按stableID；dataset切换不把旧ID解释为新对象；关闭不清已选draft。

### 自有公共合同形状

valueId/valueIds/options/queryPort/clearPolicy/selectionMode/onChoose/onRemove。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.searchbar"></a>
## SearchField

合同 ID：`ui.spec.searchbar`。来源记录：[SearchBar](../component-catalog.md#ui.family.searchbar)。

### 意图、选择与边界

具有查询语义的输入。局部实时过滤、提交式全局搜索、清空/取消；scope 可见。相邻选择：普通值编辑用 TextField；大搜索工作区用 SearchWorkspace。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.searchbar)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

QueryInput/Scope/Clear/SubmitOrCancel/QueryStatus；scope与关键词合成一个查询意图。

Query Owner管数据和范围；UI Owner管查询编辑。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=live/submit；默认 submit；小列表本地筛选用live。
- scope=local/global/entity；显式供label。
- resultPolicy=replace/retain-stale；默认 retain-stale并标旧结果。

禁止：清空即退页、旧请求覆盖结果、断网显示无结果、IME Enter提交半句。

### 状态转换与可执行恢复

draft→composition end→querying→results/empty/failed；新queryId覆盖旧查询；clear和cancel不是同一动作。

### 具体使用场景

<a id="ui.spec.searchbar.case.01"></a>
#### 过滤联系人

- **选择**：live local
- **触发与可观察结果**：输入后过滤，clear恢复全集
- **失败、等待与恢复**：空集区分初始为空和筛选无结果。

<a id="ui.spec.searchbar.case.02"></a>
#### 全局找人

- **选择**：submit entity
- **触发与可观察结果**：Enter查明确范围，显示查询中
- **失败、等待与恢复**：失败保留词并可重查。

<a id="ui.spec.searchbar.case.03"></a>
#### 退出搜索

- **选择**：cancel
- **触发与可观察结果**：返回来源并按policy保留草稿
- **失败、等待与恢复**：cancel不当作clear提交。

<a id="ui.spec.searchbar.case.04"></a>
#### 结果过期

- **选择**：retain-stale
- **触发与可观察结果**：显示旧结果与正在刷新标识
- **失败、等待与恢复**：旧结果可否动作由业务owner决定。

### 键盘、焦点、触摸与读屏

Enter仅submit模式提交；Escape先关建议再退出；清空保留input焦点；触摸键盘search；读屏查询范围和结果摘要。

### 图形、几何与动效

FieldFrame含search glyph、清空和status；忙碌不挤短输入；不对每键做动效。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

空查询、拼音IME、长关键词、反复相同词、无结果与断网不同。

debounce/query observer释放；返回页面恢复query和scroll由Page owner负责。

### 自有公共合同形状

query/scope/mode/queryId/resultStatus/onQueryChange/onSubmit/onClear/onCancel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.form"></a>
## Form / Field / FieldGroup

合同 ID：`ui.spec.form`。来源记录：[Form](../component-catalog.md#ui.family.form)。

### 意图、选择与边界

聚合编辑、校验和提交。设置表单、身份创建、Agent 配置；group/title/helper/error/footer。相邻选择：即刻生效的单项用 SettingRow + Switch；展示用 KeyValueList。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.form)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FormTitle/FieldGroups/FieldFrame/ErrorSummary/Submit/Cancel；父Form只聚合，字段拥有本地错误ring。

Form/Draft Owner管聚合、校验和提交；FieldFrame语义归UI。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- save=explicit/immediate-group；默认 explicit；即时设置拆SettingRow。
- validation=local/remote；默认 local，远端有checking。
- close=clean/dirty/pending；由draft事实判定。

禁止：保存先清draft、每字段单独重复提交、隐藏错误无路径、schema错误当网络错误。

### 状态转换与可执行恢复

pristine→dirty→validating→submitting→saved/field-invalid/transport-failed；校验与写入失败分离；dirty退出明确保存/丢弃/继续。

### 具体使用场景

<a id="ui.spec.form.case.01"></a>
#### 保存设置

- **选择**：explicit
- **触发与可观察结果**：校验dirty字段，提交后回读确认
- **失败、等待与恢复**：写失败保留所有dirty值。

<a id="ui.spec.form.case.02"></a>
#### 创建身份

- **选择**：required fields
- **触发与可观察结果**：首错聚焦，秘密字段不进fixture
- **失败、等待与恢复**：远端拒绝保留安全字段按credential政策。

<a id="ui.spec.form.case.03"></a>
#### 编辑Agent

- **选择**：dynamic groups
- **触发与可观察结果**：条件字段显式显示，保存有效范围
- **失败、等待与恢复**：已隐藏错误给跳转或清理规则。

<a id="ui.spec.form.case.04"></a>
#### 退出未保存

- **选择**：dirty close
- **触发与可观察结果**：提供保存/丢弃/继续，焦点留可决策面
- **失败、等待与恢复**：pending关闭由owner说明后台结果。

<a id="ui.spec.form.case.05"></a>
#### 远端冲突

- **选择**：revision
- **触发与可观察结果**：显示当前值与草稿差异供裁定
- **失败、等待与恢复**：不静默覆盖别端修改。

### 键盘、焦点、触摸与读屏

submit Enter有明确submitter且IME保护；错误摘要链接首错误；Tab按视觉顺序；触摸键盘不挡footer；reader关联label/error。

### 图形、几何与动效

组标题/字段/页脚共享轨道；一个意图一个frame；错误不改变相邻control高度基线；动效只用于局部反馈。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长表单、隐藏字段错误、部分权限、动态字段移除、重复提交和服务器值冲突。

draft和保存归runtime；关闭不擅自终止保存；异步校验按field revision取消旧结果。

### 自有公共合同形状

draft/initialSnapshot/fields/validationSummary/saveView/onEdit/onSubmit/onRequestClose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.editabletext"></a>
## InlineEdit

合同 ID：`ui.spec.editabletext`。来源记录：[EditableText](../component-catalog.md#ui.family.editabletext)。

### 意图、选择与边界

原位编辑短文本。会话/Agent/文件标题；显示与编辑双态；enter 保存/esc 取消。相邻选择：长内容用 Editor；受限选项用 Select。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.editabletext)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ReadValue/EditTrigger/TextField/Save/Cancel/InlineStatus。

Entity/Draft Owner 管版本与保存；UI管读写切换。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- commit=enter/explicit/blur；默认 enter；blur需无损退出政策。
- layout=single/multiline；默认 single，长内容用Editor。
- activation=button/double-click；默认 button，double-click仅补充。

禁止：blur无条件丢草稿、双击唯一入口、远端未保存就退出、行导航与编辑同触发。

### 状态转换与可执行恢复

reading→editing dirty→saving→reading/failed；Escape恢复旧值；失败停在editing并保留draft。

### 具体使用场景

<a id="ui.spec.editabletext.case.01"></a>
#### 会话改名

- **选择**：single enter
- **触发与可观察结果**：进入编辑并选中名称，Enter保存
- **失败、等待与恢复**：重名错误保留draft。

<a id="ui.spec.editabletext.case.02"></a>
#### Agent名称

- **选择**：explicit
- **触发与可观察结果**：保存与取消具名可见
- **失败、等待与恢复**：网络失败不退阅读态。

<a id="ui.spec.editabletext.case.03"></a>
#### 取消更改

- **选择**：Escape
- **触发与可观察结果**：恢复原值返回编辑按钮
- **失败、等待与恢复**：对象移除返回安全列表。

<a id="ui.spec.editabletext.case.04"></a>
#### 别端改名

- **选择**：revision
- **触发与可观察结果**：提示原值已变化允许重新确认
- **失败、等待与恢复**：不盖掉新名称。

### 键盘、焦点、触摸与读屏

编辑按钮可Tab/Enter；进入选定文本；IME Enter不保存；触摸可见编辑；读屏编辑状态与错误。

### 图形、几何与动效

读写同轨宽度，frame不挤跳行；成功无整行缩放。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

空名、超长、重名、对象被删、另一端改名。

保存callback绑定entity与revision；列表虚拟回收不得丢draft，由owner保存。

### 自有公共合同形状

entityId/value/draft/commitPolicy/editState/onEdit/onSave/onCancel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.colorpicker"></a>
## ColorPicker

合同 ID：`ui.spec.colorpicker`。来源记录：[ColorPicker](../component-catalog.md#ui.family.colorpicker)。

### 意图、选择与边界

选择语义允许的自定义颜色。封面/标记色允许的模块定制；输入色值和 alpha 分开。相邻选择：固定系统主题不可用任意选色；有限色用 ColorSwatches。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.colorpicker)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FieldLabel/SaturationValue/Hue/Alpha/TextValue/Preview/Validation；Preview不单独提交。

Module Owner准许自定义范围；UI Owner管颜色输入。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- format=hex/rgb/hsl；默认 hex；转换显示不丢精度。
- alpha=opaque/allowed；默认 opaque，透明仅特定场景。
- commit=draft/explicit；默认 draft。

禁止：色板改变全局品牌、非法值静默归零、只靠色面鼠标操作、alpha不支持仍可调。

### 状态转换与可执行恢复

drag/text-edit→valid draft→commit；非法字符串保留用于修正，不直接变黑色；远端失败保留选择。

### 具体使用场景

<a id="ui.spec.colorpicker.case.01"></a>
#### 封面色

- **选择**：opaque draft
- **触发与可观察结果**：拖动选择预览，表单保存
- **失败、等待与恢复**：写失败保留草稿色。

<a id="ui.spec.colorpicker.case.02"></a>
#### 精确色值

- **选择**：hex input
- **触发与可观察结果**：粘贴合法值并同步色面
- **失败、等待与恢复**：非法值在字段说明。

<a id="ui.spec.colorpicker.case.03"></a>
#### 允许透明

- **选择**：alpha allowed
- **触发与可观察结果**：调透明度显示百分比
- **失败、等待与恢复**：模块不支持alpha明确拒绝。

<a id="ui.spec.colorpicker.case.04"></a>
#### 取消预览

- **选择**：explicit
- **触发与可观察结果**：恢复原色不改已存配置
- **失败、等待与恢复**：关闭不把暂存色当确认。

### 键盘、焦点、触摸与读屏

色面有箭头替代及数值输入；触摸拖动不抢页面滚动；读屏数值和颜色名辅助，不只读hex。

### 图形、几何与动效

色面与滑条有独立语义焦点；跟手0ms；合法值才更新preview；不覆写品牌token。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

纯黑白、透明0、颜色空间转换、粘贴大小写/短hex、色弱。

drag capture释放；预览临时token在取消时恢复；主题scope不泄漏。

### 自有公共合同形状

colorValue/format/alphaPolicy/onDraft/onCommit/onCancel/validation。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.colorswatches"></a>
## ColorSwatches

合同 ID：`ui.spec.colorswatches`。来源记录：[ColorSwatches](../component-catalog.md#ui.family.colorswatches)。

### 意图、选择与边界

从批准的颜色集合选择。模块标签和头像后备色；具名色板；选中轮廓可见。相邻选择：连续颜色编辑用 ColorPicker。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.colorswatches)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GroupLabel/NamedSwatches/SelectedMarker/optionalCustomEntry。

Asset/UI Owner管色板；Module Owner管可选范围。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- selection=single/read-only；默认 single。
- palette=semantic/approved-custom；默认 semantic，集合由owner供。
- display=name+color；固定，不纯颜色。

禁止：色名仅tooltip、未注册品牌颜色、用背景色当唯一selected。

### 状态转换与可执行恢复

选色改draft→owner提交；palette更新若旧色缺失保留自定义已选说明。

### 具体使用场景

<a id="ui.spec.colorswatches.case.01"></a>
#### 标签颜色

- **选择**：semantic
- **触发与可观察结果**：选具名“工作”等颜色
- **失败、等待与恢复**：palette失效显示旧值并重选。

<a id="ui.spec.colorswatches.case.02"></a>
#### 头像后备

- **选择**：approved
- **触发与可观察结果**：选择注册后备色
- **失败、等待与恢复**：深浅主题有对比说明。

<a id="ui.spec.colorswatches.case.03"></a>
#### 只读色板

- **选择**：read-only
- **触发与可观察结果**：阅读当前颜色名
- **失败、等待与恢复**：不显示可点按钮。

<a id="ui.spec.colorswatches.case.04"></a>
#### 自定义入口

- **选择**：allowed
- **触发与可观察结果**：进入ColorPicker独立任务
- **失败、等待与恢复**：取消不清既有选择。

### 键盘、焦点、触摸与读屏

单选roving箭头；Space选；触摸命中；reader读名称和选中；高对比保留check。

### 图形、几何与动效

统一方形swatch，选中轮廓与颜色对比；fast marker更新。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同色不同语义、零色板、旧色缺失、暗色不可辨和200%名称。

palette scope按模块；不持久复制全局token；卸载无网络责任。

### 自有公共合同形状

paletteId/items/value/onChoose/customEntryPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.datepicker"></a>
## DateField / DateRangeField

合同 ID：`ui.spec.datepicker`。来源记录：[DatePicker](../component-catalog.md#ui.family.datepicker)。

### 意图、选择与边界

选择明确日期或日期范围。任务截止日期使用 date-only；统计区间显式两端；时间点需时区。相邻选择：选时间用 TimeField；手写表达式用 TextField。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.datepicker)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FieldFrame/DateText/CalendarTrigger/MonthNav/DayGrid/RangeSummary；date-only与instant分开。

DateTime/Form Owner管日期与时间语义；UI管日历导航。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- value=date-only/range；默认 date-only；instant需TimeField和时区。
- range=inclusive/exclusive-end；默认 inclusive，查询口转换由owner。
- entry=text/calendar；默认二者等价。
- restriction=min-max/disabled-dates；显式，不能只有灰色。

禁止：date-only转UTC导致偏日、范围半值提交、不可选只灰无原因、用本地时间推断远端期限。

### 状态转换与可执行恢复

edit/open→partial range→valid selection→draft；end早于start显示错误或明确交换提案，不静默改日；远端保存归Form。

### 具体使用场景

<a id="ui.spec.datepicker.case.01"></a>
#### 任务截止

- **选择**：date-only
- **触发与可观察结果**：输入/点选某日，提交不含时区偏移
- **失败、等待与恢复**：不可选日期给原因。

<a id="ui.spec.datepicker.case.02"></a>
#### 统计区间

- **选择**：range inclusive
- **触发与可观察结果**：先起后止，显示两端完整日期
- **失败、等待与恢复**：部分范围不可提交。

<a id="ui.spec.datepicker.case.03"></a>
#### 跨年选择

- **选择**：calendar
- **触发与可观察结果**：月份导航到下一年仍保留起日
- **失败、等待与恢复**：闰日合法性按日历判断。

<a id="ui.spec.datepicker.case.04"></a>
#### 清空可选日期

- **选择**：nullable
- **触发与可观察结果**：清空回未设置
- **失败、等待与恢复**：required日期不给空提交。

<a id="ui.spec.datepicker.case.05"></a>
#### 定时任务

- **选择**：Date+TimeField
- **触发与可观察结果**：显示时区和完整时点交date-time owner
- **失败、等待与恢复**：DST无效/重复时刻要求明确选择。

### 键盘、焦点、触摸与读屏

日历箭头/Home/End/PageUp/Down；Escape回field；触摸日期命中；reader读完整日期/不可选原因；文本可直接输入。

### 图形、几何与动效

月份标题与weekday共享7列轨；日期selected与today分开；月份切换normal，不误当保存。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

闰年、跨年、DST边界、空端点、时区变更、locale日期顺序。

日历关闭保留partial draft政策；当前日期时钟从owner注入；禁止用动画时间判到期。

### 自有公共合同形状

dateValue/rangeValue/calendarSystem/locale/restrictions/rangeBoundaryPolicy/onDraft。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.timefield"></a>
## TimeField

合同 ID：`ui.spec.timefield`。来源记录：[TimeField](../component-catalog.md#ui.requirement.timefield)。

### 意图、选择与边界

选择带明确单位与时区政策的时间。日程时刻、安静时段；时区为 date-time owner 提供。相邻选择：日期用 DateField。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.timefield)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FieldFrame/Hour/Minute/optionalSecond/ZoneSummary/Validation；时段范围有Start/End。

DateTime Owner管时区与范围；UI管时间输入。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- value=time-only/instant-context/range；默认 time-only；instant需日期和zone。
- precision=minute/second；默认 minute。
- clock=12h/24h；locale决定展示，内部值不歧义。

禁止：time-only默认UTC、跨午夜当负时长、缺AMPM猜测、系统timezone变化静默改已选。

### 状态转换与可执行恢复

partial input→valid time→draft→commit；缺AM/PM不成完整值；DST冲突由DateTime owner回传选择。

### 具体使用场景

<a id="ui.spec.timefield.case.01"></a>
#### 安静时段

- **选择**：time-only range
- **触发与可观察结果**：选22:00到07:00，显示跨次日
- **失败、等待与恢复**：不拒绝合法跨午夜。

<a id="ui.spec.timefield.case.02"></a>
#### 任务时刻

- **选择**：instant-context
- **触发与可观察结果**：日期+时间+zone一起确认
- **失败、等待与恢复**：DST不存在时刻要求重选。

<a id="ui.spec.timefield.case.03"></a>
#### 精确时间

- **选择**：second
- **触发与可观察结果**：输入时分秒并显示单位
- **失败、等待与恢复**：非法秒保持草稿提示。

<a id="ui.spec.timefield.case.04"></a>
#### 12小时制

- **选择**：locale clock
- **触发与可观察结果**：选择上午/下午消除歧义
- **失败、等待与恢复**：未明确不提交。

### 键盘、焦点、触摸与读屏

可整串输入；箭头按精度；Tab分段但父frame单ring；触摸时间键盘；reader单位与时区。

### 图形、几何与动效

各段同基线，冒号装饰隐藏读屏；不让滚轮误改聚焦值；拖动跟手无easing。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

00:00、23:59、跨午夜范围、12h午/午夜、DST跳时/重复时、秒精度。

zone变化由owner重新解释而非控件换UTC；旧校验按revision丢弃。

### 自有公共合同形状

localTime/precision/clock/zoneContext/dateContext/rangePolicy/onDraft。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.hotkeyinput"></a>
## ShortcutField

合同 ID：`ui.spec.hotkeyinput`。来源记录：[HotkeyInput](../component-catalog.md#ui.family.hotkeyinput)。

### 意图、选择与边界

录入和校验快捷键。设置全局与局部命令；冲突提示和恢复默认。相邻选择：普通文本用 TextField。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.hotkeyinput)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

CommandLabel/CaptureTrigger/ChordPreview/Conflict/Reset/Clear。

Command Registry/Platform Owner管冲突；UI管录入。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=global/window/editor；必选。
- capture=single-chord/sequence；默认 single-chord。
- reserved=reject；固定，由platform清单判断。

禁止：录制触发真实命令、静默覆盖别人绑定、禁用Escape退出、把展示⌘字符串当keyCode。

### 状态转换与可执行恢复

idle→recording→candidate→checking→valid/conflict→save；Escape取消录制；modifier-only未完成。

### 具体使用场景

<a id="ui.spec.hotkeyinput.case.01"></a>
#### 设置全局命令

- **选择**：global
- **触发与可观察结果**：录制组合并检查冲突再保存
- **失败、等待与恢复**：OS保留键明确拒绝。

<a id="ui.spec.hotkeyinput.case.02"></a>
#### 编辑器命令

- **选择**：editor
- **触发与可观察结果**：绑定局部scope不干扰全局
- **失败、等待与恢复**：冲突显示已有命令。

<a id="ui.spec.hotkeyinput.case.03"></a>
#### 恢复默认

- **选择**：reset
- **触发与可观察结果**：显示默认组合并提交
- **失败、等待与恢复**：默认也冲突时不给伪成功。

<a id="ui.spec.hotkeyinput.case.04"></a>
#### 触摸配置

- **选择**：preset
- **触发与可观察结果**：选择可用预设或接键盘录入
- **失败、等待与恢复**：设备无硬键盘不显示死入口。

### 键盘、焦点、触摸与读屏

进入录制后拦截限定scope命令；Escape退出；触摸提供选择预设；reader逐键名与冲突命令。

### 图形、几何与动效

keycaps沿ShortcutHint；焦点在capture owner；录制不闪烁。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

OS保留键、布局不同、Cmd/Ctrl映射、辅助技术快捷键、重复序列和纯修饰。

录制监听立即释放；保存后仅Command Registry注册，不在控件重复绑定。

### 自有公共合同形状

commandId/scope/chord/platformPolicy/conflictPort/onCandidate/onSave/onReset。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.imageselect"></a>
## ImageChoice

合同 ID：`ui.spec.imageselect`。来源记录：[ImageSelect](../component-catalog.md#ui.family.imageselect)。

### 意图、选择与边界

用图像选一个或多个值。封面模板、Agent 形象、背景图。相邻选择：自由上传用 FileDropzone；普通文本选项用 Select。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.imageselect)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GroupLabel/ImageTiles/Caption/SelectionMarker/ResourceStatus。

Asset/Module Owner管集合；UI管图像选择。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- selection=single/multiple；默认 single。
- availability=ready/loading/failed；每asset独立。
- fit=cover/contain；默认 contain，截裁需preview清楚。

禁止：用src当对象ID、未加载等于不可选无说明、整tile链接又勾选、裁切隐藏关键内容。

### 状态转换与可执行恢复

选择assetId→draft；加载失败不清选择identity；提交按owner验证资源可用。

### 具体使用场景

<a id="ui.spec.imageselect.case.01"></a>
#### 选择封面

- **选择**：single cover
- **触发与可观察结果**：选模板并给实际裁切预览
- **失败、等待与恢复**：加载失败可重试同asset。

<a id="ui.spec.imageselect.case.02"></a>
#### 选择Agent形象

- **选择**：single contain
- **触发与可观察结果**：完整显示头像形象，提交assetId
- **失败、等待与恢复**：资源失效要求重选。

<a id="ui.spec.imageselect.case.03"></a>
#### 多个背景

- **选择**：multiple
- **触发与可观察结果**：独立勾选并显示计数
- **失败、等待与恢复**：不可用项不进有效集合。

<a id="ui.spec.imageselect.case.04"></a>
#### 无可用图片

- **选择**：empty
- **触发与可观察结果**：提供上传或返回
- **失败、等待与恢复**：不放占位图冒充选项。

### 键盘、焦点、触摸与读屏

单选roving，多选按checkbox；触摸点tile不双触发；reader图名/选中/不可用原因。

### 图形、几何与动效

固定ratio格子避免图片迟到跳位；marker与边界不只色；加载无自播放。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同图异ID、缺图、极端宽高、超长说明、选择图被删除。

resolver handle释放；选择按stableID不按index；返回保留draft。

### 自有公共合同形状

options/assetIds/selectionMode/fitPolicy/resourceViews/onChoose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.rate"></a>
## Rating

合同 ID：`ui.spec.rate`。来源记录：[Rate](../component-catalog.md#ui.family.rate)。

### 意图、选择与边界

表达有量尺的评分。反馈或质量评估需说明尺度；只读与可编辑分开。相邻选择：满意/不满意用 ToggleGroup；系统状态不用星级。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.rate)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ScaleLabel/RatingItems/ValueText/optionalClear；量尺语义必须说明。

Feedback/Metric Owner管量尺和保存；UI管评分交互。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=editable/read-only；默认 read-only。
- precision=whole/half；默认 whole，半分有读屏支持。
- scale=declared min/max/labels；无量尺不渲染可评分。

禁止：0当空、半分仅鼠标、同星数不同量尺不解释、只读星仍按钮。

### 状态转换与可执行恢复

preview hover不提交→choose draft→owner save；失败恢复确认值或留待重试draft，需声明。

### 具体使用场景

<a id="ui.spec.rate.case.01"></a>
#### 满意度

- **选择**：whole editable
- **触发与可观察结果**：选择1–5并显示意义，提交反馈
- **失败、等待与恢复**：提交失败保留待评值。

<a id="ui.spec.rate.case.02"></a>
#### 只读均值

- **选择**：read-only half
- **触发与可观察结果**：显示4.5/5和样本数
- **失败、等待与恢复**：缺数据显示未知不是0。

<a id="ui.spec.rate.case.03"></a>
#### 撤回评分

- **选择**：clear allowed
- **触发与可观察结果**：回未评分并提交撤回
- **失败、等待与恢复**：不把清空当零分。

<a id="ui.spec.rate.case.04"></a>
#### 不同量尺

- **选择**：declared scale
- **触发与可观察结果**：按指标说明评分
- **失败、等待与恢复**：旧量尺值不自动换算。

### 键盘、焦点、触摸与读屏

箭头步进、Home/End至界值；触摸点选；reader读“3/5，含义”；只读不进Tab。

### 图形、几何与动效

星形只是rating专用glyph；选中有数值；fast预览，reduced静态。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0分与未评分、半分、最大变更、无权限和长尺度描述。

hover清理；量尺变化旧值不可偷映射；保存归Feedback owner。

### 自有公共合同形状

value/scale/precision/mode/labels/onDraft/onCommit。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.segmented"></a>
## SegmentedControl

合同 ID：`ui.spec.segmented`。来源记录：[Segmented](../component-catalog.md#ui.family.segmented)。

### 意图、选择与边界

在少量同层视图或显示模式中切换。列表/网格、时间维度、局部筛选；支持 icon+label。相邻选择：页面内容层级用 Tabs；表单值用 Radio。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.segmented)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GroupLabel/Segments/SelectedIndicator；视图值与draft筛选值明确。

Page/Query Owner管模式和数据；UI管单选指示。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=view/filter；默认 view；完整页面内容用Tabs。
- activation=automatic/manual；默认 automatic仅本地轻视图。
- selection=single；固定，格式多选用ToggleGroup。

禁止：多选伪segment、立即远端重操作却无pending、只有图标无label、切换默认销毁草稿。

### 状态转换与可执行恢复

选择模式→view更新或filter draft；数据未到显示新模式loading，不混旧数据；失败可回原模式。

### 具体使用场景

<a id="ui.spec.segmented.case.01"></a>
#### 列表网格

- **选择**：view local
- **触发与可观察结果**：切换呈现同对象集合
- **失败、等待与恢复**：焦点和选中对象保持。

<a id="ui.spec.segmented.case.02"></a>
#### 时间维度

- **选择**：view remote
- **触发与可观察结果**：选择周/月显示刷新状态
- **失败、等待与恢复**：失败保留上次数据并标所属维度。

<a id="ui.spec.segmented.case.03"></a>
#### 筛选类别

- **选择**：filter draft
- **触发与可观察结果**：选值更新查询draft
- **失败、等待与恢复**：未提交不冒充已刷新。

<a id="ui.spec.segmented.case.04"></a>
#### 昂贵视图

- **选择**：manual
- **触发与可观察结果**：箭头定位，Enter才激活
- **失败、等待与恢复**：避免每箭头发网络请求。

### 键盘、焦点、触摸与读屏

单Tab入组，左右箭头/Home/End；manual Enter提交；触摸segment；reader选中模式。

### 图形、几何与动效

等高轨道，long label可自适应非机械等宽；normal指示；reduced instant。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

一项/多于舒适容量、全禁用、长语言、RTL；过多值用Select。

view state归Page owner；面板生命周期不由Segmented私自unmount。

### 自有公共合同形状

value/items/purpose/activation/onChange/contentStatus。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.slider"></a>
## Slider / SliderField

合同 ID：`ui.spec.slider`。来源记录：[Slider](../component-catalog.md#ui.family.slider)。

### 意图、选择与边界

连续或步进范围调整。音量、温度、缩放；精确值配 NumberField。相邻选择：无序类别用 Select；高精度只需数字用 NumberField。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.slider)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Label/Track/Thumb/ValueLabel/optionalNumberField；Range有两个具名Thumb。

Value/Media Owner管提交；UI管范围编辑。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- range=single/interval；默认 single。
- step=continuous/discrete；默认 discrete，step必供。
- commit=live/release；默认 release，昂贵远端不每像素提交。

禁止：float累积漂移、两个thumb无名字、拖动每帧网络、越界无原因、视觉宽度当业务值。

### 状态转换与可执行恢复

pointer/key edit→draft→release commit→confirmed/failed；低/高不可无政策交叉；精确值通过NumberField。

### 具体使用场景

<a id="ui.spec.slider.case.01"></a>
#### 音量

- **选择**：single live
- **触发与可观察结果**：拖动即本地更新并可静音
- **失败、等待与恢复**：设备不支持显示限制。

<a id="ui.spec.slider.case.02"></a>
#### 模型参数

- **选择**：single release
- **触发与可观察结果**：调draft，松手或明确保存
- **失败、等待与恢复**：远端失败保留可修正值。

<a id="ui.spec.slider.case.03"></a>
#### 筛选区间

- **选择**：interval
- **触发与可观察结果**：调整最小/最大并显示两端
- **失败、等待与恢复**：交叉按已声明约束处理。

<a id="ui.spec.slider.case.04"></a>
#### 精确输入

- **选择**：NumberField配对
- **触发与可观察结果**：键入精确值同步thumb
- **失败、等待与恢复**：非法输入不强制跳回默认。

### 键盘、焦点、触摸与读屏

箭头按step、Page按大步、Home/End；双thumb按名字Tab；触摸capture且滚动冲突处理；reader值/单位/范围。

### 图形、几何与动效

跟手0ms；thumb目标可外扩；track不只色；normal仅放手落位。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

min=max、0/负数、极小step精度、两个thumb重合、RTL和放大。

pointercapture/unmount释放；旧保存不覆盖新drag；未commit draft归owner。

### 自有公共合同形状

value/range/min/max/step/unit/commitPolicy/onDraft/onCommit。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.togglegroup"></a>
## ToggleButton / ToggleGroup

合同 ID：`ui.spec.togglegroup`。来源记录：[ToggleGroup](../component-catalog.md#ui.family.togglegroup)。

### 意图、选择与边界

可保持按下状态的一组操作。格式 bold/italic 多选；筛选单/多；工具模式。相邻选择：值字段用 Radio/Checkbox；页面用 Tabs。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.togglegroup)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GroupLabel/ToggleButtons/PressedState；每button表持久选择而非命令pending。

Editor/Filter Owner管选择；UI管pressed。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- selection=single/multiple；默认 multiple，格式可组合。
- empty=allowed/required；默认 allowed。
- scope=editor/filter/tool-mode；必选以解释状态。

禁止：点击当submit、pressed只靠色、radio约束与多值冲突、选区变化仍保留旧格式。

### 状态转换与可执行恢复

press切valueSet→owner确认；单选不保持两个pressed；mixed编辑选区可显示indeterminate但不是新值。

### 具体使用场景

<a id="ui.spec.togglegroup.case.01"></a>
#### 加粗斜体

- **选择**：multiple editor
- **触发与可观察结果**：切当前选区格式，按钮反映真实选区
- **失败、等待与恢复**：空选区按editor插入政策。

<a id="ui.spec.togglegroup.case.02"></a>
#### 工具模式

- **选择**：single required
- **触发与可观察结果**：选择一个操作模式
- **失败、等待与恢复**：当前模式失效明确提示重选。

<a id="ui.spec.togglegroup.case.03"></a>
#### 筛选条件

- **选择**：multiple
- **触发与可观察结果**：勾选多个条件并显示查询范围
- **失败、等待与恢复**：远端失败不把旧结果标新条件。

<a id="ui.spec.togglegroup.case.04"></a>
#### 混合选区

- **选择**：indeterminate projection
- **触发与可观察结果**：读出混合格式并可统一
- **失败、等待与恢复**：mixed不作为持久格式枚举。

### 键盘、焦点、触摸与读屏

toolbar箭头或普通Tab按layout；Space切换；reader aria-pressed；触摸可见选中标记。

### 图形、几何与动效

沿Button quiet轮廓，pressed有持久边界；fast颜色、无弹簧。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

选区混合格式、全禁用、模式失效、RTL与长label。

编辑选区变化更新pressed投影；组件不自己持另一个格式Store。

### 自有公共合同形状

values/items/selectionMode/emptyPolicy/selectionProjection/onToggle。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.sortablelist"></a>
## ReorderableList

合同 ID：`ui.spec.sortablelist`。来源记录：[SortableList](../component-catalog.md#ui.family.sortablelist)。

### 意图、选择与边界

用户改变稳定对象顺序。Agent 工具排序、导航自定义、附件顺序。相邻选择：普通阅读用 List；重新筛选不叫拖拽排序。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.sortablelist)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Items/DragHandles/DropIndicator/MoveUpDown/SaveStatus；item stableID不变。

Order/Domain Owner管顺序与冲突；UI管重排交互。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- ordering=local-draft/persisted；默认 local-draft。
- activation=handle；固定，避免整行抢输入。
- constraints=free/group-bound；默认 group-bound有声明。

禁止：数组index作key、只有鼠标可拖、过滤子集覆盖全顺序、跨授权组搬移。

### 状态转换与可执行恢复

idle→dragging/reordering→draft order→saving→confirmed/failed；失败回确认顺序或保留待保存并说明。

### 具体使用场景

<a id="ui.spec.sortablelist.case.01"></a>
#### 工具排序

- **选择**：persisted
- **触发与可观察结果**：handle改顺序后保存
- **失败、等待与恢复**：失败显示待保存而非伪成功。

<a id="ui.spec.sortablelist.case.02"></a>
#### 附件顺序

- **选择**：local-draft
- **触发与可观察结果**：拖/上移改变发送顺序
- **失败、等待与恢复**：上传中锁定项明确原因。

<a id="ui.spec.sortablelist.case.03"></a>
#### 固定导航

- **选择**：group-bound
- **触发与可观察结果**：仅允许可移动项调整
- **失败、等待与恢复**：跨固定边界拒绝并播报。

<a id="ui.spec.sortablelist.case.04"></a>
#### 取消拖动

- **选择**：Escape
- **触发与可观察结果**：恢复抓取前位置和焦点
- **失败、等待与恢复**：远端数据变化不覆盖新对象。

### 键盘、焦点、触摸与读屏

具名上移/下移和键盘抓取/放下；Escape取消；触摸handle有滚动阈值；reader播报位置“2/5”。

### 图形、几何与动效

拖动跟手0ms，落位normal；保留行高度placeholder；焦点轮廓随itemID。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

零/一项、上千项、固定项、过滤排序、跨组限制和保存冲突。

释放capture/drag listeners；拖动期间数据更新由owner reconcile；unmount不丢顺序草稿。

### 自有公共合同形状

items/orderIds/constraints/onDraftReorder/onCommitOrder/onCancel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.upload"></a>
## FilePicker / FileDropzone

合同 ID：`ui.spec.upload`。来源记录：[Upload](../component-catalog.md#ui.family.upload)。

### 意图、选择与边界

选择文件并提交资源。点击选择和拖入等价；多文件/校验/预览；文件上传状态交给 domain。相邻选择：选择已有图片用 ImageChoice；只下载用 DownloadAction。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.upload)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FilePickerTrigger/Dropzone/AcceptedPolicy/SelectedFiles/Validation；上传执行由Attachment Owner。

Platform File port管选择；Resource Owner管权限与上传；UI管投放。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- source=picker/drop/paste；默认 picker，其他为等价入口。
- selection=single/multiple；默认 multiple。
- validation=type/size/count；明确实际限制，accept不是安全校验。

禁止：accept当安全审计、选择即声称上传完成、文件名作ID、拒绝一项清全部。

### 状态转换与可执行恢复

choose→local validation→accepted/rejected→resource transfer；单文件拒绝不抹成功选项；取消picker不报失败。

### 具体使用场景

<a id="ui.spec.upload.case.01"></a>
#### 点击添加

- **选择**：picker multiple
- **触发与可观察结果**：选择后逐项校验再加入附件
- **失败、等待与恢复**：取消无错误，拒绝说明原因。

<a id="ui.spec.upload.case.02"></a>
#### 拖入文件

- **选择**：drop
- **触发与可观察结果**：显示投放反馈，drop后同一校验
- **失败、等待与恢复**：目录未支持明确拒绝。

<a id="ui.spec.upload.case.03"></a>
#### 粘贴图片

- **选择**：paste supported
- **触发与可观察结果**：转资源intent并保留正文
- **失败、等待与恢复**：失败不吞原剪贴板文字。

<a id="ui.spec.upload.case.04"></a>
#### 混合文件

- **选择**：partial accept
- **触发与可观察结果**：合法项加入，超限项逐项拒绝
- **失败、等待与恢复**：修正后可重新选择。

### 键盘、焦点、触摸与读屏

按钮Enter打开系统picker；dropzone有点击等价入口；触摸picker；reader逐项接受/拒绝与限制。

### 图形、几何与动效

虚线边界只说明投放任务；drag-over有文字；不得把整个页面变dropzone；fast高亮。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

目录、零字节、重复文件、大文件、MIME不一致、权限和取消。

drop/paste listeners按scope释放；objectURL与临时handle由resource finalizer；页面退出保留owner上传。

### 自有公共合同形状

selectionPort/acceptPolicy/maxBytes/maxCount/selectedViews/onAccept/onReject。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.editorslashmenu"></a>
## SlashCommandMenu

合同 ID：`ui.spec.editorslashmenu`。来源记录：[EditorSlashMenu](../component-catalog.md#ui.family.editorslashmenu)。

### 意图、选择与边界

编辑器内插入或执行结构命令。/插入代码块、附件、模板；过滤候选。相邻选择：全局命令用 CommandPalette；@引用用 MentionPicker。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.editorslashmenu)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

QueryToken/Anchor/Listbox/CommandDescription；仅匹配editor认可的slash上下文。

Editor Owner管transaction；Command Owner管真实执行。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- operation=insert/command；默认 insert。
- scope=block/inline；默认 block，由editor供上下文。
- filter=local/async；默认 local。

禁止：代码中每slash开菜单、普通文本吞掉、命令绕审批、旧bookmark写错位置。

### 状态转换与可执行恢复

slash context→query→候选→选择→editor transaction；命令失败保留文档，不能先删slash再丢命令。

### 具体使用场景

<a id="ui.spec.editorslashmenu.case.01"></a>
#### 插入代码块

- **选择**：block insert
- **触发与可观察结果**：选命令后单事务替换slash为代码块
- **失败、等待与恢复**：失败保留原文。

<a id="ui.spec.editorslashmenu.case.02"></a>
#### 插入模板

- **选择**：insert
- **触发与可观察结果**：展示模板名并插入当前合法位置
- **失败、等待与恢复**：异步模板失效给重查。

<a id="ui.spec.editorslashmenu.case.03"></a>
#### 执行工具

- **选择**：command
- **触发与可观察结果**：选择进入正式命令/权限流程
- **失败、等待与恢复**：不直接绕过PermissionDecision。

<a id="ui.spec.editorslashmenu.case.04"></a>
#### 退出菜单

- **选择**：Escape
- **触发与可观察结果**：保留用户typed slash查询
- **失败、等待与恢复**：关闭不清正文。

### 键盘、焦点、触摸与读屏

input保留焦点，Arrow/Enter选、Escape回原文本；IME不选；触摸候选；reader读插入或执行。

### 图形、几何与动效

anchor跟光标，collision修正；normal浮层；候选description不挤行轨。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

代码块内slash、选区、slash中段、长文滚动、候选变化和权限禁用。

selection bookmark按doc revision重验证；query取消；unmount清anchor listener。

### 自有公共合同形状

editorContext/query/options/operation/selectionBookmark/onChoose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.emojipicker"></a>
## EmojiPicker

合同 ID：`ui.spec.emojipicker`。来源记录：[EmojiPicker](../component-catalog.md#ui.family.emojipicker)。

### 意图、选择与边界

选择字符或反应符号。正文插入 emoji；消息 reaction 使用受限集；最近使用仅本地。相邻选择：人物身份用 Avatar；不使用大型图像承担文本语义。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.emojipicker)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Search/CategoryNav/Grid/Recent/SkinTone/ChosenSummary。

Editor/Reaction Owner管语义；Asset Owner管合法emoji。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=insert/reaction；默认 insert；reaction受业务集合限制。
- source=unicode/approved-custom；默认 unicode。
- skinTone=default/selected；默认 default，持久偏好本地。

禁止：插入即发送、未批准custom、字符长度当emoji数量、仅hover名称。

### 状态转换与可执行恢复

open→search/browse→choose→insert或reaction intent；后者pending真实；无结果与资源失败分开。

### 具体使用场景

<a id="ui.spec.emojipicker.case.01"></a>
#### 正文插入

- **选择**：unicode insert
- **触发与可观察结果**：在editor bookmark插入完整emoji
- **失败、等待与恢复**：编辑位置失效要求重新定位。

<a id="ui.spec.emojipicker.case.02"></a>
#### 消息反应

- **选择**：reaction
- **触发与可观察结果**：选允许项发业务toggle
- **失败、等待与恢复**：失败保留原计数并可重试。

<a id="ui.spec.emojipicker.case.03"></a>
#### 搜索无结果

- **选择**：search
- **触发与可观察结果**：显示无匹配和清空入口
- **失败、等待与恢复**：不替用户选第一个。

<a id="ui.spec.emojipicker.case.04"></a>
#### 平台缺字

- **选择**：fallback
- **触发与可观察结果**：显示短名称或自有合法图形
- **失败、等待与恢复**：不能显示随机占位当同一emoji。

### 键盘、焦点、触摸与读屏

grid箭头/Home/End，输入Tab可达；Escape回trigger；触摸搜索和格子；reader短名称而非只字形。

### 图形、几何与动效

网格固定命中区，glyph可文本后备；无hover放大；recent与category不跳。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

ZWJ组合、肤色、旗帜、平台缺字、搜索多语言、禁用custom和巨大emoji集。

recent本地按账号scope；资源handle释放；选中不自动发送消息。

### 自有公共合同形状

purpose/allowedEmojiIds/query/recentIds/skinTone/onChoose/resourcePort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.mentionpicker"></a>
## MentionPicker

合同 ID：`ui.spec.mentionpicker`。来源记录：[MentionPicker](../component-catalog.md#ui.requirement.mentionpicker)。

### 意图、选择与边界

将正文文本绑定到真实实体引用。@联系人/Agent/文件；范围可见；插入完整 identity。相邻选择：普通建议用 Autocomplete。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.mentionpicker)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

MentionToken/Query/Listbox/IdentityMeta/Scope；结果必须是授权entity reference。

Directory/Auth Owner管候选；Editor Owner管引用；Messaging管受众。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- entity=person/agent/file；context明确允许集合。
- lookup=local/remote；默认 local，remote有queryId。
- insertion=structured-reference；固定，不仅展示字符串。

禁止：字符串当actorID、默认跨站搜索、透露无权候选、过期bookmark插错位置。

### 状态转换与可执行恢复

@context→query→resolve candidates→choose→editor reference；无权限/不存在与查询失败分开。

### 具体使用场景

<a id="ui.spec.mentionpicker.case.01"></a>
#### 提及联系人

- **选择**：person
- **触发与可观察结果**：选完整身份后插入结构引用
- **失败、等待与恢复**：同名需来源区分。

<a id="ui.spec.mentionpicker.case.02"></a>
#### 调用Agent

- **选择**：agent
- **触发与可观察结果**：选Agent实体后形成任务上下文
- **失败、等待与恢复**：不可用Agent不假装可执行。

<a id="ui.spec.mentionpicker.case.03"></a>
#### 引用文件

- **选择**：file
- **触发与可观察结果**：选择有权资源，插入resourceID
- **失败、等待与恢复**：发送给受众前复验权限。

<a id="ui.spec.mentionpicker.case.04"></a>
#### 离线查询

- **选择**：remote failed
- **触发与可观察结果**：保留@文本和重查入口
- **失败、等待与恢复**：不凭缓存伪称已确认身份。

### 键盘、焦点、触摸与读屏

input保持焦点，Arrow/Enter选择，Escape留原文本；IME保护；触摸同名可辨；reader身份来源和类型。

### 图形、几何与动效

候选IdentityBlock轨道；mention样式不等于信任标记；菜单normal。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同名、跨站、已删对象、无权限文件、长路径、旧选区和离线。

query/anchor清理；reference由editor保存稳定ID；发送时业务再验证受众权限。

### 自有公共合同形状

allowedEntityKinds/scope/queryPort/entityId/bookmark/onInsertReference。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.richtexteditor"></a>
## RichTextEditor

合同 ID：`ui.spec.richtexteditor`。来源记录：[RichTextEditor](../component-catalog.md#ui.requirement.richtexteditor)。

### 意图、选择与边界

具有结构化文本语义的编辑面。帖子、Note、模板；工具栏与快捷键一致。相邻选择：短聊天可用 MessageComposer。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.richtexteditor)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

DocumentSurface/Toolbar/Selection/BlockControls/Attachments/Validation/SaveStatus。

Editor/Draft Owner管文档；Domain Owner管发布与权限。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- document=note/post/template；必选对应schema。
- mode=edit/read-only；默认 edit。
- save=explicit/autosave；默认 explicit；autosave需冲突恢复政策。
- content=structured-document；固定，不用HTML字符串做真源。

禁止：innerHTML当稳定文档、每键自动远端覆盖、格式按钮独立状态、失败清正文。

### 状态转换与可执行恢复

transaction→dirty→validate→save→confirmed/conflict/failed；undo历史属于editor，保存版本与本地undo分离。

### 具体使用场景

<a id="ui.spec.richtexteditor.case.01"></a>
#### 编辑Note

- **选择**：explicit
- **触发与可观察结果**：结构事务与undo一致，保存回读
- **失败、等待与恢复**：失败保留doc和光标。

<a id="ui.spec.richtexteditor.case.02"></a>
#### 发布帖子

- **选择**：post
- **触发与可观察结果**：检查受众与附件，再明确发布
- **失败、等待与恢复**：发布失败保留草稿。

<a id="ui.spec.richtexteditor.case.03"></a>
#### 模板编辑

- **选择**：schema
- **触发与可观察结果**：变量作为结构节点可验证
- **失败、等待与恢复**：未知变量给字段错误。

<a id="ui.spec.richtexteditor.case.04"></a>
#### 离线恢复

- **选择**：autosave allowed
- **触发与可观察结果**：本地draft恢复并显示未同步
- **失败、等待与恢复**：冲突交owner处理不盖远端。

<a id="ui.spec.richtexteditor.case.05"></a>
#### 粘贴内容

- **选择**：paste policy
- **触发与可观察结果**：清洗危险结构保留可读内容
- **失败、等待与恢复**：不执行粘贴脚本。

### 键盘、焦点、触摸与读屏

IME/selection完整；格式快捷键与toolbar一致；Tab可离开；触摸选区不被浮层抢；reader标题/列表语义。

### 图形、几何与动效

正文排版Text角色；工具栏不随选区跳动；输入0ms；粘贴清洗不全篇fade。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

大文档、粘贴HTML、代码/表格、emoji、离线恢复、不同设备并发。

doc owner保存draft/版本；释放editor observers和assets；卸载不丢未保存文档。

### 自有公共合同形状

documentId/schema/documentView/selection/saveView/transactionPort/pastePolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.treeselect"></a>
## TreeSelect / Cascader

合同 ID：`ui.spec.treeselect`。来源记录：[TreeSelect](../component-catalog.md#ui.requirement.treeselect)。

### 意图、选择与边界

表单内选择层级值。知识路径、组织节点；单/多；显示完整路径。相邻选择：纯浏览用 Tree；无层级用 Select。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.treeselect)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FieldFrame/PathSummary/TreePopup/Search/SelectedValues；Cascader为分层导航投影。

Hierarchy/Policy Owner管树与可选范围；UI管路径选择。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- selection=single/multiple；默认 single。
- target=leaf/any-node；默认 leaf；父节点是否合法明确。
- presentation=tree/cascader；默认 tree，逐层少选可cascader。

禁止：label当路径ID、父check越权选所有、未加载等于无子、无限递归环。

### 状态转换与可执行恢复

open→expand/query→choose allowedID→draft；父节点half-check是汇总，不自动提交整子树权限。

### 具体使用场景

<a id="ui.spec.treeselect.case.01"></a>
#### 选知识路径

- **选择**：leaf tree
- **触发与可观察结果**：展开后选叶并显示全路径
- **失败、等待与恢复**：加载失败可重试该支。

<a id="ui.spec.treeselect.case.02"></a>
#### 选组织范围

- **选择**：any-node
- **触发与可观察结果**：明确父节点代表的范围再选择
- **失败、等待与恢复**：部分权限不默认扩授权。

<a id="ui.spec.treeselect.case.03"></a>
#### 多层分类

- **选择**：cascader
- **触发与可观察结果**：逐层选到合法终点
- **失败、等待与恢复**：中途返回保留路径draft。

<a id="ui.spec.treeselect.case.04"></a>
#### 已有值失效

- **选择**：validation
- **触发与可观察结果**：展示旧路径及需要重选
- **失败、等待与恢复**：不静默改成父节点。

### 键盘、焦点、触摸与读屏

tree箭头/Home/End；cascader逐层进入/返回；Escape回field；触摸sheet；reader完整路径与已选。

### 图形、几何与动效

统一FieldFrame；多级面板有有界宽度，窄屏单面逐层；normal进出。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

lazy children、重名路径、循环坏数据、失效已选、超深和部分权限。

加载取消与stable nodeID；ancestor授权变化复验；关闭不抹选中。

### 自有公共合同形状

nodeIds/treePort/targetPolicy/selectionMode/pathResolver/presentation/onChoose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

