# 环境与生命周期 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [UIProvider](#ui.spec.configprovider)
- [FocusBoundary](#ui.spec.focusscope)
- [FontAssets](#ui.spec.fontloader)
- [RenderSuspension](#ui.spec.freeze)
- [MotionPolicy](#ui.spec.motionprovider)
- [ViewErrorBoundary](#ui.spec.react-error-boundary)
- [ThemeBoundary / ThemeBootstrap](#ui.spec.styles)

<a id="ui.spec.configprovider"></a>
## UIProvider

合同 ID：`ui.spec.configprovider`。来源记录：[ConfigProvider](../component-catalog.md#ui.family.configprovider)、[Provider](../component-catalog.md#ui.family.provider)。

### 意图、选择与边界

注入主题、locale、方向和运行环境。应用根唯一配置；嵌入宿主继承；测试显式注入。相邻选择：不是业务 Store；ThemeBoundary 只覆盖获准 token。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.configprovider)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

UIProvider的Theme/Locale/Direction/Motion/PortalScope/PlatformPorts；上游Provider与ConfigProvider归一。

UI/Presentation Owner管context；Kernel管app业务boot。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=app-root/approved-embed；默认 app-root。
- theme=light/dark/system；默认 system。
- direction=ltr/rtl；locale policy供。
- ports=explicit-platform；必供真实支持能力。

禁止：供应商Provider re-export、自造业务Store、每个Tab重mount根、跨window portal。

### 状态转换与可执行恢复

bootstrap读取context→ready/degraded；theme/locale更新投影；缺port显式unsupported，不注入假成功。

### 具体使用场景

<a id="ui.spec.configprovider.case.01"></a>
#### 应用启动

- **选择**：app-root
- **触发与可观察结果**：注入真实theme/locale/ports
- **失败、等待与恢复**：缺能力明确degraded。

<a id="ui.spec.configprovider.case.02"></a>
#### 嵌入Applet

- **选择**：approved-embed
- **触发与可观察结果**：继承宿主policy并限局部token
- **失败、等待与恢复**：不能覆全局品牌。

<a id="ui.spec.configprovider.case.03"></a>
#### 系统深色

- **选择**：system
- **触发与可观察结果**：更新统一tokens
- **失败、等待与恢复**：不每组件独立监听。

<a id="ui.spec.configprovider.case.04"></a>
#### 多窗口

- **选择**：scope
- **触发与可观察结果**：每window own portal和focus
- **失败、等待与恢复**：不把menu渲到别窗。

### 键盘、焦点、触摸与读屏

Provider不渲染focus目标；locale切换不丢已有焦点；touch/system偏好通过同context；reader方向和语言随root。

### 图形、几何与动效

token与motion单一真源；portal同window；首屏theme避免闪白；不每页加provider重置。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

SSR/首屏、嵌入宿主、多个native windows、locale切换和缺adapter。

system listeners根scope注册一次清理；不拥有业务session/draft；嵌入边界明确继承。

### 自有公共合同形状

themePolicy/locale/direction/motionPolicy/platformPorts/portalScope/assetRegistry。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.focusscope"></a>
## FocusBoundary

合同 ID：`ui.spec.focusscope`。来源记录：[FocusScope](../component-catalog.md#ui.family.focusscope)。

### 意图、选择与边界

管理局部焦点与焦点恢复。Dialog trap；Popover 键盘进入；关闭回到发起控制。相邻选择：普通 Surface 不 trap；非模态不能隔离整个应用。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.focusscope)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FocusBoundary/InitialTarget/RestoreTarget/AllowedOutside；不绘第二focus ring。

UI Focus Owner管理scope；surface提供语义target。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=trap/contained/restore-only；默认 restore-only，modal才trap。
- entry=keyboard/pointer；真实输入mode。
- fallback=nearest-safe-target；来源卸载时。

禁止：所有popover trap、Scope自己描环、pointer强制焦点、来源消失focus掉不可见。

### 状态转换与可执行恢复

activate scope→按entry进入→deactivate恢复；隐藏焦点先转安全target；scope层级按window stack。

### 具体使用场景

<a id="ui.spec.focusscope.case.01"></a>
#### Dialog

- **选择**：trap keyboard
- **触发与可观察结果**：Tab限modal可用项
- **失败、等待与恢复**：关闭回来源或安全fallback。

<a id="ui.spec.focusscope.case.02"></a>
#### Popover

- **选择**：restore-only
- **触发与可观察结果**：keyboard进入pointer不抢
- **失败、等待与恢复**：Escape正确返回。

<a id="ui.spec.focusscope.case.03"></a>
#### 折叠区域

- **选择**：contained
- **触发与可观察结果**：先移子焦点再hidden
- **失败、等待与恢复**：不保留inert内部焦点。

<a id="ui.spec.focusscope.case.04"></a>
#### 来源卸载

- **选择**：fallback
- **触发与可观察结果**：回邻近任务入口
- **失败、等待与恢复**：不盲回已删节点。

### 键盘、焦点、触摸与读屏

Tab/ShiftTab只在modal trap；Escape归surface；pointer popover不抢焦点；reader当前dialog标题；touch不额外ring。

### 图形、几何与动效

ring由semantic control拥有；Scope只管理位置；focus即时不等动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

trigger卸载、nested scopes、disabled initial、portal与shadow tree、window blur。

focus listeners成对释放；不会残留trap；不在close盲focus document.body。

### 自有公共合同形状

scopeId/mode/entryMode/initialTarget/restoreTarget/fallbackPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.fontloader"></a>
## FontAssets

合同 ID：`ui.spec.fontloader`。来源记录：[FontLoader](../component-catalog.md#ui.family.fontloader)。

### 意图、选择与边界

受控字体资产和后备。自有字体按需加载；系统字体先显示；离线可读。相邻选择：不在业务页各自加载字体。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.fontloader)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FontAssets清单/LoadPolicy/FallbackStack/Status；字体不是业务请求。

Asset/Presentation Owner管字体与许可。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- load=critical/deferred；默认 deferred系统字体先可读。
- source=bundled/approved-remote；默认 bundled。
- fallback=system-stack；固定可读路径。

禁止：字体没到整页空白、远程未批准资产、无中文fallback、字体成功=UX一致。

### 状态转换与可执行恢复

fallback visible→font-ready或font-failed fallback；不把加载字体阻断登录/消息。

### 具体使用场景

<a id="ui.spec.fontloader.case.01"></a>
#### 首屏

- **选择**：system fallback
- **触发与可观察结果**：立即可读
- **失败、等待与恢复**：自有字体慢不挡任务。

<a id="ui.spec.fontloader.case.02"></a>
#### 中文覆盖

- **选择**：locale
- **触发与可观察结果**：缺glyph用系统后备
- **失败、等待与恢复**：不显示方块。

<a id="ui.spec.fontloader.case.03"></a>
#### 离线

- **选择**：bundled
- **触发与可观察结果**：使用允许本地资产
- **失败、等待与恢复**：不无限重试remote。

<a id="ui.spec.fontloader.case.04"></a>
#### 字体切换

- **选择**：metrics
- **触发与可观察结果**：重排仍保行轨与焦点
- **失败、等待与恢复**：须视觉打样而非只hash。

### 键盘、焦点、触摸与读屏

字体更新不改语义/焦点；reader文本本身；touch命中随text resize重新计算。

### 图形、几何与动效

font metrics和fallback尽量匹配；避免布局大跳；不对全文fade。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

离线、缺中文glyph、变量font、许可证、超慢与200%文本。

font handles/listeners清理；根一次加载，按许可缓存；不每页独立fetch。

### 自有公共合同形状

fontAssetIds/loadPolicy/fallbackStack/localeCoverage/statusPort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.freeze"></a>
## RenderSuspension

合同 ID：`ui.spec.freeze`。来源记录：[Freeze](../component-catalog.md#ui.family.freeze)。

### 意图、选择与边界

隐藏视图的渲染控制。仅在平台 PageHost 合同允许时冻结隐藏树。相邻选择：业务不得自行 freeze 阻断 runtime 更新。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.freeze)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

RenderSuspensionBoundary/VisibilityPolicy；不是业务Runtime暂停器。

PageHost/Runtime Owner管alive；UI只按授权suspend。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- state=active/hidden-suspended；由PageHost供。
- eligibility=allowed/not-allowed；默认 not-allowed需现有政策。
- resources=business-continue/presentation-pause；固定职责分离。

禁止：Freeze停止消息接收、所有Tab默认freeze、resume旧投影、隐藏仍可聚焦。

### 状态转换与可执行恢复

PageHost hidden且获准→suspend render；active→resume最新projection；暂停期间业务事件由runtime保存。

### 具体使用场景

<a id="ui.spec.freeze.case.01"></a>
#### 隐藏Agent页

- **选择**：allowed
- **触发与可观察结果**：停止无意义render但任务继续
- **失败、等待与恢复**：回来读最新真实终态。

<a id="ui.spec.freeze.case.02"></a>
#### 草稿页

- **选择**：preserve
- **触发与可观察结果**：draft留owner
- **失败、等待与恢复**：不得因隐藏丢输入。

<a id="ui.spec.freeze.case.03"></a>
#### 不允许暂停

- **选择**：not-allowed
- **触发与可观察结果**：正常受控更新
- **失败、等待与恢复**：不能强行包装Freeze。

<a id="ui.spec.freeze.case.04"></a>
#### 账号变化

- **选择**：identity
- **触发与可观察结果**：清旧树并绑定新scope
- **失败、等待与恢复**：不resume旧凭据view。

### 键盘、焦点、触摸与读屏

hidden inert退出Tab；resume按Page focus policy；touch入口恢复；reader不见hidden旧树。

### 图形、几何与动效

无冻结动画；避免恢复时逐积压frame播放；读取最新view。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

任务仍running、隐藏dirty编辑、资源过期、账号切换和多个page。

PageHost管alive与suspension；UI不丢unsubscribe关键业务；presentation timer可停并恢复。

### 自有公共合同形状

pageId/visibility/suspensionEligibility/projectionRevision/platformPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.motionprovider"></a>
## MotionPolicy

合同 ID：`ui.spec.motionprovider`。来源记录：[MotionProvider](../component-catalog.md#ui.family.motionprovider)。

### 意图、选择与边界

注入统一运动策略。reduced motion、平台 duration、静态验证模式。相邻选择：业务不直接提供 MotionComponent。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.motionprovider)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

MotionPolicy Context/ReducedPreference/RoleResolver；不私造另一套easing。

Asset/Motion Owner管策略；UI Context提供。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=system/reduced/instant-test；默认 system。
- durationRole=instant/fast/normal/slow；按component合同。
- interactive=direct-manipulation；不因reduced禁止直接drag或媒体。

禁止：各页另写spring、reduced隐藏pending、动画结束发success、provider每frame更新Store。

### 状态转换与可执行恢复

preference变化→新policy；在途非必要动画停止到稳定state；不能把停止animation当业务cancel。

### 具体使用场景

<a id="ui.spec.motionprovider.case.01"></a>
#### 普通交互

- **选择**：system
- **触发与可观察结果**：按角色解析hover与panel
- **失败、等待与恢复**：不自行加弹簧。

<a id="ui.spec.motionprovider.case.02"></a>
#### 减弱运动

- **选择**：reduced
- **触发与可观察结果**：panel直接显示仍有状态
- **失败、等待与恢复**：不消灭信息。

<a id="ui.spec.motionprovider.case.03"></a>
#### 动态验证

- **选择**：instant-test
- **触发与可观察结果**：稳定终帧用于结构检查
- **失败、等待与恢复**：不替代真实motion证据。

<a id="ui.spec.motionprovider.case.04"></a>
#### 打断动画

- **选择**：preference change
- **触发与可观察结果**：立刻稳定到当前view
- **失败、等待与恢复**：任务意图不被取消。

### 键盘、焦点、触摸与读屏

焦点与aria更新即时；touchdrag直接反馈；reader状态文字独立于motion。

### 图形、几何与动效

曲线/100/200/300ms均提案；唯一resolver；reduced移除shimmer/位移，仍可明白状态。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

偏好中途切换、hidden、同scope嵌套、长动画打断和测试instant。

root system listener一次清理；animation handles归组件；业务状态不在MotionPolicy。

### 自有公共合同形状

mode/preferencePort/durationRoles/easingRoles/reducedRules。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.react-error-boundary"></a>
## ViewErrorBoundary

合同 ID：`ui.spec.react-error-boundary`。来源记录：[react-error-boundary](../component-catalog.md#ui.family.react-error-boundary)。

### 意图、选择与边界

限制渲染故障影响范围。页面/预览/扩展视图异常局部降级。相邻选择：网络失败用 RecoveryState；业务失败不靠 catch-all。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.react-error-boundary)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ViewErrorBoundary/FailureSurface/RetryView/ReportRef；隔离render故障。

UI Runtime Owner管边界；业务故障归Domain。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=page/preview/extension；默认 preview局部。
- retry=remount/reload-resource；由失败类型。
- diagnostics=redacted；固定不露stack秘密。

禁止：吞错当空、catch所有异步为render成功、无限自动remount、报错携真实凭据。

### 状态转换与可执行恢复

render exception→local fallback；重试重新建受影响view；runtime任务仍以owner状态；非render异步错误交业务恢复。

### 具体使用场景

<a id="ui.spec.react-error-boundary.case.01"></a>
#### 预览崩溃

- **选择**：preview
- **触发与可观察结果**：局部显示重试/保存
- **失败、等待与恢复**：会话仍可用。

<a id="ui.spec.react-error-boundary.case.02"></a>
#### Applet故障

- **选择**：extension
- **触发与可观察结果**：限制到该扩展view
- **失败、等待与恢复**：不毁全局Shell。

<a id="ui.spec.react-error-boundary.case.03"></a>
#### 页面恢复

- **选择**：page
- **触发与可观察结果**：重建view读owner最新投影
- **失败、等待与恢复**：不重发后台任务。

<a id="ui.spec.react-error-boundary.case.04"></a>
#### 重复崩溃

- **选择**：bounded retry
- **触发与可观察结果**：停止自动循环给明确返回
- **失败、等待与恢复**：保脱敏diagnostic引用。

### 键盘、焦点、触摸与读屏

fallback可键盘/触摸重试/返回；重要错误announce；focus到可行动标题而非无故全页。

### 图形、几何与动效

沿Recovery/Alert合同；不无限Skeleton；无崩溃庆祝动效。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

重复crash、错误边界自身失败、秘密stack、账号切换、异步reject。

失败view资源finalizer；runtime不被remount重复boot；retry有界；diagnostic脱敏。

### 自有公共合同形状

boundaryId/scope/fallback/retryPolicy/redactedDiagnosticPort/resetKeys。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.styles"></a>
## ThemeBoundary / ThemeBootstrap

合同 ID：`ui.spec.styles`。来源记录：[styles](../component-catalog.md#ui.family.styles)。

### 意图、选择与边界

主题初始化与获准局部表达。避免首屏闪烁；模块有限 token narrowing；dark/light。相邻选择：业务不能 setLobeTheme；不新增平行 theme Store。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.styles)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ThemeBootstrap/ThemeBoundary/TokenProjection；初始化与局部表达不是通用CSS逃生口。

UI Token/Presentation Owner管主题；Kernel只提供环境。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=global/approved-module；默认 global唯一。
- mode=light/dark/system；沿UIProvider。
- override=semantic-narrowing；只已批准局部token。

禁止：任意style覆盖组件ring/radius、两套tokens、主题脚本访问业务秘密、局部变全局。

### 状态转换与可执行恢复

bootstrap→resolved theme；system变化更新；局部boundary移除恢复继承；不修改业务。

### 具体使用场景

<a id="ui.spec.styles.case.01"></a>
#### 首屏主题

- **选择**：bootstrap
- **触发与可观察结果**：启动前读取合法偏好
- **失败、等待与恢复**：失败用系统/明确fallback。

<a id="ui.spec.styles.case.02"></a>
#### 模块表达

- **选择**：approved-module
- **触发与可观察结果**：有限token narrowing
- **失败、等待与恢复**：不替换全局Button语义。

<a id="ui.spec.styles.case.03"></a>
#### 深色阅读

- **选择**：dark
- **触发与可观察结果**：主题对比与图标可读
- **失败、等待与恢复**：hash一致不等于contrast通过。

<a id="ui.spec.styles.case.04"></a>
#### 移除边界

- **选择**：inherit
- **触发与可观察结果**：恢复父token且无残留
- **失败、等待与恢复**：不重建全业务树。

### 键盘、焦点、触摸与读屏

对比/focus policy一致；locale和touch不是CSS猜测；reader语义不受隐藏样式破坏。

### 图形、几何与动效

tokens/assets唯一source；首屏不闪；不未批准brand漂移；0ms核心theme切换可读。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

SSR、无stored偏好、嵌入scope、dark contrast、focus ring和高对比。

bootstrap脚本有限、listener清理；不每页注入全局style；移除boundary无残留变量。

### 自有公共合同形状

themeState/tokenProjection/approvedOverrideIds/bootstrapPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

