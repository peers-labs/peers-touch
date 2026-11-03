# 代码与图描述 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [CodeBlock](#ui.spec.highlighter)
- [CodeSnippet](#ui.spec.snippet)
- [CodeEditor](#ui.spec.codeeditor)
- [CodeDiff](#ui.spec.codediff)
- [DiagramPreview](#ui.spec.mermaid)

<a id="ui.spec.highlighter"></a>
## CodeBlock

合同 ID：`ui.spec.highlighter`。来源记录：[Highlighter](../component-catalog.md#ui.family.highlighter)。

### 意图、选择与边界

只读代码与语法高亮。消息代码、配置片段、工具输出；语言名称/复制/折叠。相邻选择：可编辑用 CodeEditor；变更用 CodeDiff。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.highlighter)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

CodeBlock/LanguageLabel/LineNumbers/Copy/Expand；只读语法着色。

Document Owner管原文；UI Code renderer管高亮。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- wrap=no-wrap/wrap；默认 no-wrap可横滚。
- lines=hidden/shown；默认 hidden，复制不含行号。
- height=full/collapsible；默认 full，长代码可collapsible。

禁止：高亮执行代码、复制行号、非法语言崩整页、纯色语法声称代码正确。

### 状态转换与可执行恢复

parse→highlighted/plain-fallback；语言未知显示plain text；复制结果独立。

### 具体使用场景

<a id="ui.spec.highlighter.case.01"></a>
#### 消息代码

- **选择**：no-wrap
- **触发与可观察结果**：语法着色可复制原文
- **失败、等待与恢复**：失败回plain。

<a id="ui.spec.highlighter.case.02"></a>
#### 未知语言

- **选择**：plain
- **触发与可观察结果**：显示原文和未知语言
- **失败、等待与恢复**：不猜语法验证。

<a id="ui.spec.highlighter.case.03"></a>
#### 长代码

- **选择**：collapsible
- **触发与可观察结果**：展开/横scroll完整阅读
- **失败、等待与恢复**：折叠不删源文。

<a id="ui.spec.highlighter.case.04"></a>
#### 配置片段

- **选择**：line numbers
- **触发与可观察结果**：定位错误行
- **失败、等待与恢复**：复制排除display行号。

### 键盘、焦点、触摸与读屏

可选全文；keyboard横scroll/复制；touch展开；reader代码原文不逐tokenspan冗余。

### 图形、几何与动效

mono type scale与line-height；高亮对比按主题；无流式逐tokenfade。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

巨大块、未知语言、恶意HTML、tabs空白与长单行。

worker取消，highlight cache按source digest；复制用原文；无执行能力。

### 自有公共合同形状

sourceText/language/wrap/lineNumbers/heightPolicy/copyAction。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.snippet"></a>
## CodeSnippet

合同 ID：`ui.spec.snippet`。来源记录：[Snippet](../component-catalog.md#ui.family.snippet)。

### 意图、选择与边界

短可复制代码片段。命令行、token 模板、安装步骤。相邻选择：长代码用 CodeBlock；敏感密钥用 SecretValue。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.snippet)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ShortCode/LanguageOrShell/Copy/optionalPrompt；命令提示符与实际payload分开。

Document/Command Owner管内容；UI管短代码。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=command/code；默认 code。
- copy=payload-only；固定，不复制提示符和输出。
- sensitivity=ordinary/secret-reference；默认 ordinary，秘密转SecretValue。

禁止：复制$提示符、渲染时执行命令、真实token进样例、复制输出当命令。

### 状态转换与可执行恢复

显示真实snippet；copy→确认/失败；没有“执行成功”状态，因为默认不执行。

### 具体使用场景

<a id="ui.spec.snippet.case.01"></a>
#### 安装命令

- **选择**：command
- **触发与可观察结果**：显示shell与复制纯命令
- **失败、等待与恢复**：环境不同明确适用性。

<a id="ui.spec.snippet.case.02"></a>
#### 配置片段

- **选择**：code
- **触发与可观察结果**：保留空白可复制
- **失败、等待与恢复**：copy拒绝可选择原文。

<a id="ui.spec.snippet.case.03"></a>
#### 带提示符

- **选择**：payload-only
- **触发与可观察结果**：提示符视觉显示但不入clipboard
- **失败、等待与恢复**：不把终端输出混payload。

<a id="ui.spec.snippet.case.04"></a>
#### 凭据模板

- **选择**：secret-reference
- **触发与可观察结果**：用占位变量或受限SecretValue
- **失败、等待与恢复**：不放真凭据。

### 键盘、焦点、触摸与读屏

全文可选择；copykeyboard/touch具名；reader原文与shell标签；不只有hover复制。

### 图形、几何与动效

mono短块，长行horizontal scroll；copy同轨；不打字动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

多行命令、反斜杠续行、秘密模板、长路径和平台差异。

copy timer清理；source按文档owner；不隐式调用shell。

### 自有公共合同形状

text/kind/language/prompt/copyPayload/secretReference。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.codeeditor"></a>
## CodeEditor

合同 ID：`ui.spec.codeeditor`。来源记录：[CodeEditor](../component-catalog.md#ui.family.codeeditor)。

### 意图、选择与边界

可编辑代码和结构化配置。系统提示模板、JSON 配置；只读预览单独模式；dirty/save/validation 可见。相邻选择：短单行用 TextField；只读用 CodeBlock。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.codeeditor)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

EditorSurface/Gutter/Language/Diagnostics/SaveStatus/ReadOnlyNotice。

Document/Settings Owner管保存；Editor engine由UI治理。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=edit/read-only；默认 edit。
- language=registered；必供或plain。
- save=explicit/autosave；默认 explicit，autosave有revision。

禁止：Tab永久trap、语法valid当已保存、原文innerHTML、卸载清dirty、每键远端覆盖。

### 状态转换与可执行恢复

edit→dirty→validate→save→confirmed/conflict/failed；诊断不是业务写入结果；read-only保选择复制。

### 具体使用场景

<a id="ui.spec.codeeditor.case.01"></a>
#### JSON配置

- **选择**：explicit
- **触发与可观察结果**：局部诊断并保存
- **失败、等待与恢复**：无效JSON不提交，draft留住。

<a id="ui.spec.codeeditor.case.02"></a>
#### 提示模板

- **选择**：edit
- **触发与可观察结果**：变量与undo事务一致
- **失败、等待与恢复**：未知变量有说明。

<a id="ui.spec.codeeditor.case.03"></a>
#### 只读文件

- **选择**：read-only
- **触发与可观察结果**：选区复制可用
- **失败、等待与恢复**：不disabled整editor。

<a id="ui.spec.codeeditor.case.04"></a>
#### 版本冲突

- **选择**：revision
- **触发与可观察结果**：显示远端变更与本地draft
- **失败、等待与恢复**：不静默覆盖。

### 键盘、焦点、触摸与读屏

Tab插入/离开有明确policy和提示；IME完整；keyboard快捷键registry；touch有替代工具；reader访问code text和diagnostics。

### 图形、几何与动效

mono轨道、gutter不含复制；resize0ms；诊断定位不全屏动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

巨大文件、JSON未闭合、未知language、行结尾、Unicode与外部版本变化。

editor/worker/listeners释放；doc draft归owner；未提交内容不能随mount丢失。

### 自有公共合同形状

documentId/text/revision/language/mode/diagnostics/saveView/editorPort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.codediff"></a>
## CodeDiff

合同 ID：`ui.spec.codediff`。来源记录：[CodeDiff](../component-catalog.md#ui.family.codediff)。

### 意图、选择与边界

审阅版本变化。左右对比适合宽屏；统一 diff 适合窄屏；PatchDiff 是补丁内容输入。相邻选择：普通代码用 CodeBlock；编辑用 CodeEditor。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.codediff)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Old/NewLabels/LineChanges/HunkNav/ContextExpand/CopySource；PatchDiff是输入格式能力。

Document/Review Owner管版本；UI engine管diff。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- layout=split/unified；默认 unified，宽屏split。
- source=two-snapshots/patch；必选并标版本。
- context=bounded/all；默认 bounded可展开。

禁止：无版本对比、红绿唯一含义、diff即批准更改、patch执行、溢出裁行。

### 状态转换与可执行恢复

resolve/compute→diff/empty/failed；空diff表示这两个版本无变化；失败可看原文。

### 具体使用场景

<a id="ui.spec.codediff.case.01"></a>
#### 宽屏代码

- **选择**：split
- **触发与可观察结果**：左右版本标题与对应行
- **失败、等待与恢复**：计算失败看原文。

<a id="ui.spec.codediff.case.02"></a>
#### 窄屏

- **选择**：unified
- **触发与可观察结果**：明确+/-并可跳hunk
- **失败、等待与恢复**：不挤两列不可读。

<a id="ui.spec.codediff.case.03"></a>
#### 补丁审阅

- **选择**：patch
- **触发与可观察结果**：显示patch对应版本
- **失败、等待与恢复**：不默认应用补丁。

<a id="ui.spec.codediff.case.04"></a>
#### 无变更

- **选择**：empty diff
- **触发与可观察结果**：说明两snapshot无差异
- **失败、等待与恢复**：二进制不可比较不当empty。

### 键盘、焦点、触摸与读屏

hunk keyboard前后；line文本可选择；touchunified；reader新增删除文本标识，不只红绿。

### 图形、几何与动效

mono双方同line-height，空行placeholder保持对齐；长行横滚；resize切unified无数据丢失。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

二进制、重命名、大文件、无末行newline、恶意patch和换行差异。

diff worker取消，绑定两个digest；原文不进可执行路径；unmount释放大缓存。

### 自有公共合同形状

oldSnapshot/newSnapshot/patchSource/layout/contextPolicy/computePort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.mermaid"></a>
## DiagramPreview

合同 ID：`ui.spec.mermaid`。来源记录：[Mermaid](../component-catalog.md#ui.family.mermaid)。

### 意图、选择与边界

渲染文本图描述。Agent 图解释、文档附图；原文可查。相邻选择：产品固定架构图用仓库 renderer；编辑用 CodeEditor。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.mermaid)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

DiagramSurface/SourceToggle/Error/Zoom/optionalExport；DiagramPreview不改变架构事实。

Document Owner管内容；UI/Security Owner管renderer。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- source=registered-text-language；必供文本。
- execution=sandboxed-render；固定。
- view=diagram/source；默认 diagram失败可source。

禁止：脚本执行、无文字替代、图渲染即正确证明、未经允许外部fetch。

### 状态转换与可执行恢复

parse/render→ready/failed/unsupported；error可定位原文；zoom只展示；渲染成功不等于架构正确。

### 具体使用场景

<a id="ui.spec.mermaid.case.01"></a>
#### 文档流程图

- **选择**：diagram
- **触发与可观察结果**：渲染并可读source
- **失败、等待与恢复**：语法失败定位原文。

<a id="ui.spec.mermaid.case.02"></a>
#### Agent解释图

- **选择**：summary
- **触发与可观察结果**：图和文字解释一致
- **失败、等待与恢复**：未验证事实仍标来源。

<a id="ui.spec.mermaid.case.03"></a>
#### 大图浏览

- **选择**：bounded zoom
- **触发与可观察结果**：可缩放和回初始视图
- **失败、等待与恢复**：不让超宽撑坏页面。

<a id="ui.spec.mermaid.case.04"></a>
#### 不支持平台

- **选择**：source
- **触发与可观察结果**：显示原文与明确能力边界
- **失败、等待与恢复**：不声称native图已验收。

### 键盘、焦点、触摸与读屏

图有summary和source替代；keyboardzoom/源码toggle；touchpan按钮替代；reader不读不可理解path。

### 图形、几何与动效

bounded viewport与统一theme；不强制套产品架构图句法到每类图；render无不断抖动。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

巨大图、未知语法、脚本link、布局超宽、低性能平台。

sandbox/worker/cache按digest释放；external links交Link安全policy。

### 自有公共合同形状

sourceText/sourceDigest/summary/renderPolicy/viewMode/exportCapability。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

