# 媒体与预览 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [Carousel](#ui.spec.carousel)
- [Image / ImageViewer](#ui.spec.image)
- [HtmlPreview](#ui.spec.htmlpreview)
- [QrCode](#ui.spec.qrcode)
- [VideoPlayer](#ui.spec.video)
- [AudioPlayer](#ui.spec.audioplayer)
- [CallControl](#ui.spec.call-control)

<a id="ui.spec.call-control"></a>
## CallControl

合同 ID：`ui.spec.call-control`。通话媒体控制复用 IconButton 的执行、禁用原因、
键盘焦点和 accessible label。共享控件拥有 64px 圆形目标、10px caption gap、
media-stage 中性/危险/选中外观。Caption 是装饰文本，不产生第二个交互目标。
selected 只消费已确认媒体状态；permission 和 cleanup pending 由通话 owner 提供。
业务页面与原型不再为通话按钮重画背景、边框或圆角。
长中文英文标题需换行；拒绝权限给明确原因；减弱动效不影响控制可发现性。

<a id="ui.spec.carousel"></a>
## Carousel

合同 ID：`ui.spec.carousel`。来源记录：[Carousel](../component-catalog.md#ui.family.carousel)。

### 意图、选择与边界

浏览同一组视觉媒体。附件多图顺序浏览；有上一张/下一张和位置；显式选择播放。相邻选择：文档步骤用 Steps；大量对象用 Grid/List。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.carousel)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Slides/Previous/Next/Position/optionalPlay/Pause/Indicators。

Resource/Selection Owner管媒体；UI管轮播。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- playback=manual/explicit-auto；默认 manual。
- loop=off/on；默认 off，on需位置说明。
- content=media-only；默认，非营销自动旋转。

禁止：默认自播、只有小dots可选、index错配资源、失败永远转loading。

### 状态转换与可执行恢复

manual choose→loading→ready/failed；auto需用户显式启动，focus/hover/隐身暂停；failed可跳下一张。

### 具体使用场景

<a id="ui.spec.carousel.case.01"></a>
#### 附件多图

- **选择**：manual
- **触发与可观察结果**：按序浏览并显示3/8
- **失败、等待与恢复**：失败张可重试/跳过。

<a id="ui.spec.carousel.case.02"></a>
#### 单张媒体

- **选择**：one
- **触发与可观察结果**：只显示媒体无需prev/next
- **失败、等待与恢复**：不假造第二张。

<a id="ui.spec.carousel.case.03"></a>
#### 显式轮播

- **选择**：explicit-auto
- **触发与可观察结果**：用户按播放后可暂停
- **失败、等待与恢复**：focus或hidden暂停。

<a id="ui.spec.carousel.case.04"></a>
#### 触摸浏览

- **选择**：swipe+buttons
- **触发与可观察结果**：滑动与按钮同结果
- **失败、等待与恢复**：RTL按逻辑前后。

### 键盘、焦点、触摸与读屏

具名prev/next与位置；keyboard按控制不抢全页箭头；touchswipe有按钮替代；reader当前第几张。

### 图形、几何与动效

统一ratio或bounded height；normal换张，reduced直接；不自动把读者拉走。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0/1/上千张、不同ratio、失败slide、RTL与大字。

auto timer/media handle释放；hidden停auto；index变化按slideID。

### 自有公共合同形状

slideIds/currentId/playbackPolicy/loop/mediaViews/onChoose。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.image"></a>
## Image / ImageViewer

合同 ID：`ui.spec.image`。来源记录：[Image](../component-catalog.md#ui.family.image)。

### 意图、选择与边界

显示并预览图片。inline、thumbnail、单图 viewer、PreviewGroup 组浏览。相邻选择：文件状态用 AttachmentItem；选择用 ImageChoice。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.image)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ResolvedImage/Alt/Fallback/optionalViewer；ImageViewer有Zoom/Navigation/Save/Close。

Resource Owner管解析/权限；UI管图与viewer。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- use=inline/thumbnail/viewer；默认 inline。
- fit=contain/cover；默认 contain，cover需实际裁切可理解。
- group=single/preview-group；默认 single。

禁止：src当永久ID、未知图片假占位、未授权保存、viewer关闭资源任务丢失。

### 状态转换与可执行恢复

loading→ready/failed/expired；viewer open独立；zoom不改源资源；失效显示重试/保存合法替代。

### 具体使用场景

<a id="ui.spec.image.case.01"></a>
#### 正文图片

- **选择**：inline contain
- **触发与可观察结果**：完整显示并有适当alt
- **失败、等待与恢复**：失败局部重试。

<a id="ui.spec.image.case.02"></a>
#### 文件缩略图

- **选择**：thumbnail cover
- **触发与可观察结果**：裁切只作预览可打开原图
- **失败、等待与恢复**：不是图片全貌证明。

<a id="ui.spec.image.case.03"></a>
#### 单图查看

- **选择**：viewer
- **触发与可观察结果**：zoom/保存/关闭统一
- **失败、等待与恢复**：不支持格式明确降级。

<a id="ui.spec.image.case.04"></a>
#### 多图查看

- **选择**：preview-group
- **触发与可观察结果**：保持源集合顺序与位置
- **失败、等待与恢复**：某张失效不换错资源。

### 键盘、焦点、触摸与读屏

image alt按内容purpose；装饰alt空；viewer键盘zoom/关闭/前后，touchpinch有按钮替代；焦点返回来源。

### 图形、几何与动效

ratio保布局；zoom直接跟手；viewer开合normal；不对每张图随机radius。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

巨大尺寸、EXIF方向、动画图、透明、下载不全、缺alt和超长描述。

resolver/objectURL/decoder handles释放；preview按resourceID；不在Image独立下载cache。

### 自有公共合同形状

resourceId/resourceView/alt/purpose/fit/ratio/viewerCapabilities/groupIds。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.htmlpreview"></a>
## HtmlPreview

合同 ID：`ui.spec.htmlpreview`。来源记录：[HtmlPreview](../component-catalog.md#ui.family.htmlpreview)。

### 意图、选择与边界

隔离查看不可信 HTML。Agent 生成页面和附件预览；显示来源和打开外部入口。相邻选择：普通 Markdown 不经 iframe；代码用 CodeBlock。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.htmlpreview)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SandboxSurface/SourceLabel/LoadStatus/BlockedNotice/OpenExternal/RawSource。

Security/Resource Owner管sandbox政策；UI管预览。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- network=blocked/allowlist；默认 blocked。
- scripts=blocked/approved-sandbox；默认 blocked。
- handoff=preview/external-open；默认 preview不执行宿主能力。

禁止：默认执行scripts、同origin带credential、内容自开宿主文件、ready说可信。

### 状态转换与可执行恢复

resolve→sandbox load→ready/blocked/failed；错误可看源或合法外部打开；ready仅预览成功不验证内容。

### 具体使用场景

<a id="ui.spec.htmlpreview.case.01"></a>
#### Agent页面

- **选择**：blocked scripts
- **触发与可观察结果**：隔离展示并可看源
- **失败、等待与恢复**：被阻脚本明确说明。

<a id="ui.spec.htmlpreview.case.02"></a>
#### HTML附件

- **选择**：offline preview
- **触发与可观察结果**：读取受限资源显示
- **失败、等待与恢复**：失效资源局部恢复。

<a id="ui.spec.htmlpreview.case.03"></a>
#### 外部打开

- **选择**：handoff
- **触发与可观察结果**：显示去向交browser
- **失败、等待与恢复**：handoff不等于安全认证。

<a id="ui.spec.htmlpreview.case.04"></a>
#### 恶意内容

- **选择**：blocked
- **触发与可观察结果**：阻止弹窗/宿主访问
- **失败、等待与恢复**：保留可读源与返回。

### 键盘、焦点、触摸与读屏

iframe/renderer有标题，keyboard能进出；不focus trap；touch滚动有界；reader有源与限制。

### 图形、几何与动效

预览边界清晰，尺寸bounded；loading不盖全部控制；不动效掩盖重载。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

恶意脚本、链接导航、弹窗、跨域fetch、大HTML与崩溃。

sandbox/worker资源释放；no host credentials；external交平台port，不能用preview泄漏令牌。

### 自有公共合同形状

resourceId/sourceView/sandboxPolicy/networkAllowlist/openExternalPort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.qrcode"></a>
## QrCode

合同 ID：`ui.spec.qrcode`。来源记录：[QRCode](../component-catalog.md#ui.family.qrcode)。

### 意图、选择与边界

将有期限的 payload 转成机器可扫符号。设备绑定、扫码登录、分享；loading/expired/refreshed 分开。相邻选择：装饰二维码图标不构成可扫码；扫码输入由设备能力完成。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.qrcode)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

QrSymbol/QuietZone/Purpose/Expiry/Refresh/Status；payload来自业务session。

DeviceLink/Auth Owner管session；UI管机器符号。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=device-link/login/share；必选。
- payload=ready/loading/expired；默认 loading。
- display=screen/export-approved；默认 screen，认证码不默认export。

禁止：扫码=授权、二维码圆角美化不可扫、旧码刷新只换图未换session、payload进日志。

### 状态转换与可执行恢复

loading→ready→scanned/waiting-approval/expired/confirmed；扫描不等于登录；刷新轮换session由owner。

### 具体使用场景

<a id="ui.spec.qrcode.case.01"></a>
#### 扫码登录

- **选择**：login
- **触发与可观察结果**：展示期限与手机批准等待
- **失败、等待与恢复**：到期禁用旧码并可刷新。

<a id="ui.spec.qrcode.case.02"></a>
#### 设备绑定

- **选择**：device-link
- **触发与可观察结果**：显示明确绑定目标
- **失败、等待与恢复**：取消/撤销由session owner。

<a id="ui.spec.qrcode.case.03"></a>
#### 公开分享

- **选择**：share
- **触发与可观察结果**：公开payload按权限可保存
- **失败、等待与恢复**：不继承认证码导出能力。

<a id="ui.spec.qrcode.case.04"></a>
#### 无相机

- **选择**：alternative
- **触发与可观察结果**：显示平台限制或合法替代
- **失败、等待与恢复**：不标光学验证已通过。

### 键盘、焦点、触摸与读屏

不可扫码用户有合法替代或平台说明；refresh可键盘触摸；reader目的与到期不读秘密payload。

### 图形、几何与动效

严格quiet zone/contrast，尺寸按真实扫描打样；无圆角/gradient破坏modules；状态不盖码。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

高DPI、低亮度、长payload、小屏、到期扫码与截图旧码。

expiry clock由session owner；组件不自己生成安全payload；unmount释放显示handle不伪撤销。

### 自有公共合同形状

sessionId/purpose/payloadView/expiry/status/refreshAction/alternativePath。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.video"></a>
## VideoPlayer

合同 ID：`ui.spec.video`。来源记录：[Video](../component-catalog.md#ui.family.video)。

### 意图、选择与边界

受控播放视频资源。附件预览和媒体正文；字幕、时间、音量、fullscreen。相邻选择：音频用 AudioPlayer；文件列表用 AttachmentItem。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.video)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

MediaSurface/PlayPause/Timeline/Time/Volume/Captions/Fullscreen/Status。

Media/Resource Owner管播放与访问；UI管control。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- play=manual；默认且禁止无意自播。
- resource=stream/local-resolved；由resource port供。
- captions=available/unavailable；真实能力。

禁止：autoplay带声、假时长、播放器关闭不释放、触摸无替代控件、seek未成功先跳确认值。

### 状态转换与可执行恢复

idle→loading→playing/paused/buffering/failed/ended；seek需确认可播；格式不支持给保存替代。

### 具体使用场景

<a id="ui.spec.video.case.01"></a>
#### 视频附件

- **选择**：manual
- **触发与可观察结果**：点击播放加载真实资源
- **失败、等待与恢复**：失败提供重试/合法保存。

<a id="ui.spec.video.case.02"></a>
#### 缓冲中

- **选择**：buffering
- **触发与可观察结果**：时间停真实位置并说明等待
- **失败、等待与恢复**：不动画假播放。

<a id="ui.spec.video.case.03"></a>
#### 带字幕

- **选择**：captions
- **触发与可观察结果**：可选字幕与语言
- **失败、等待与恢复**：缺字幕说明真实边界。

<a id="ui.spec.video.case.04"></a>
#### 全屏

- **选择**：platform-capability
- **触发与可观察结果**：进入/退出保位置
- **失败、等待与恢复**：拒绝保持普通view。

### 键盘、焦点、触摸与读屏

keyboardplay/seek/volume/fullscreen具名；touch大目标；字幕可操作；reader时间和值，非每帧宣布。

### 图形、几何与动效

ratio稳定；播放是内容运动不reduced禁用；controls fade有可发现政策；loading不伪时间前进。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

时长unknown、直播、超大视频、无字幕、seek失败和音频设备拒绝。

media/decoder/listeners释放；visibility是否pause按policy；后台播放由Media owner。

### 自有公共合同形状

resourceView/playbackView/seekPort/captionTracks/fullscreenCapabilities。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.audioplayer"></a>
## AudioPlayer

合同 ID：`ui.spec.audioplayer`。来源记录：[AudioPlayer](../component-catalog.md#ui.requirement.audioplayer)。

### 意图、选择与边界

播放音频与语音附件。语音消息、播客附件；时长和加载状态。相邻选择：视频用 VideoPlayer。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.audioplayer)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

PlayPause/Duration/Timeline/optionalWaveform/Speed/Status/TranscriptEntry。

Media/Transcript Owner管事实；UI管音频control。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=voice/audio；默认 audio。
- progress=known/unknown-duration；默认 unknown直到metadata。
- background=allowed/pause-on-hide；由Media policy供。

禁止：假waveform当真实音量、voice click直接下载无限、多播放器自动同时播放、未知时长0。

### 状态转换与可执行恢复

idle→loading→playing/paused/buffering/failed/ended；time来自media；录音waveform不造fake进度。

### 具体使用场景

<a id="ui.spec.audioplayer.case.01"></a>
#### 语音消息

- **选择**：voice
- **触发与可观察结果**：按播放加载并显示真实时长
- **失败、等待与恢复**：失败保持消息上下文。

<a id="ui.spec.audioplayer.case.02"></a>
#### 音频附件

- **选择**：audio
- **触发与可观察结果**：seek与速度可控
- **失败、等待与恢复**：格式不支持合法保存。

<a id="ui.spec.audioplayer.case.03"></a>
#### 查看转写

- **选择**：transcript
- **触发与可观察结果**：打开已有转写
- **失败、等待与恢复**：未知不编文字。

<a id="ui.spec.audioplayer.case.04"></a>
#### 切资源

- **选择**：identity
- **触发与可观察结果**：停止/释放旧播放再按政策开新
- **失败、等待与恢复**：迟到事件不改新音频。

### 键盘、焦点、触摸与读屏

具名play/暂停、keyboardseek/speed；touch大命中；reader时长和当前时间节流；转写入口可达。

### 图形、几何与动效

紧凑音频轨同附件行；waveform有真实或明确装饰数据；不自动播放。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0时长、unknown、语音长内容、倍速、设备权限、加载中快切资源。

播放session归Media Owner；资源切换释放旧decoder；unmount按background政策，不双播。

### 自有公共合同形状

resourceId/playbackView/durationView/speedOptions/transcriptDestination/mediaPort。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。
