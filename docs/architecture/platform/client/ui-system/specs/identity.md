# 身份与图形 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [AgentAvatar](#ui.spec.agentavatar)
- [Avatar / AvatarGroup](#ui.spec.avatar)
- [GroupAvatar](#ui.spec.groupavatar)
- [FileTypeGlyph](#ui.spec.filetypeicon)
- [EmojiArtwork](#ui.spec.fluentemoji)
- [Icon / IconAssets](#ui.spec.icon)

<a id="ui.spec.agentavatar"></a>
## AgentAvatar

合同 ID：`ui.spec.agentavatar`。来源记录：[AgentAvatar](../component-catalog.md#ui.family.agentavatar)。

### 意图、选择与边界

表达 Agent 身份和运行上下文。Agent 列表静态身份；任务中叠加状态；无图时确定性后备图形。相邻选择：真人用 Avatar；供应商商标用 BrandMark。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.agentavatar)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

AvatarBase/AgentName/optionalRunMarker；运行marker不是身份可信度。

Agent Owner管身份与任务；Resource Owner管图片；UI管投影。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- size=list/header/detail；默认 list。
- identity=image/generated-fallback；默认 fallback依据stableID。
- context=identity/task-status；默认 identity，不自动显示busy。

禁止：加载动画冒充任务running、头像badge暗示授权、随机fallback每次变、组件直接取密钥。

### 状态转换与可执行恢复

resource loading→ready/failed fallback；任务状态由Agent projection更新，与图片加载分开。

### 具体使用场景

<a id="ui.spec.agentavatar.case.01"></a>
#### Agent列表

- **选择**：identity list
- **触发与可观察结果**：显示稳定身份后备
- **失败、等待与恢复**：图失败不变成陌生Agent。

<a id="ui.spec.agentavatar.case.02"></a>
#### 运行任务

- **选择**：task-status
- **触发与可观察结果**：显示运行文字与marker
- **失败、等待与恢复**：停止请求不立即标已停。

<a id="ui.spec.agentavatar.case.03"></a>
#### 详情标题

- **选择**：header
- **触发与可观察结果**：头像与完整名称同轨
- **失败、等待与恢复**：长名可展开完整阅读。

<a id="ui.spec.agentavatar.case.04"></a>
#### 无图Agent

- **选择**：generated-fallback
- **触发与可观察结果**：稳定ID映射自有图形
- **失败、等待与恢复**：不得凭图形声称Agent类型已验证。

### 键盘、焦点、触摸与读屏

静态头像不Tab；可打开详情用独立Link；触摸动作明确；reader名字与真实任务状态，图片不重复朗读。

### 图形、几何与动效

圆角方形沿Avatar；marker不占脸中央；不转头像表达思考，pending文字独立。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同名Agent、长名、缺图、名称变更、多个任务不同状态。

resolver handle由resource owner释放；fallback稳定不随机；换Agent清旧任务marker。

### 自有公共合同形状

agentId/displayName/avatarView/sizeRole/taskView/optionalDetailDestination。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.avatar"></a>
## Avatar / AvatarGroup

合同 ID：`ui.spec.avatar`。来源记录：[Avatar](../component-catalog.md#ui.family.avatar)。

### 意图、选择与边界

表达真人或对象身份。个人圆角方形；在线点仅附加；多人堆叠显示总数和完整列表入口。相邻选择：群集合用 GroupAvatar；权限用 TrustIndicator。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.avatar)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Image/Fallback/optionalPresence；AvatarGroup有成员槽、总数和完整名单入口。

Identity/Presence Owner供事实；Resource Owner管来源；UI管外观。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- shape=square-rounded；固定当前产品身份。
- size=inline/list/header/profile；默认 list按角色token。
- group=none/overlap/grid；默认 none；overlap必须有总数。

禁止：圆形真人头像、avatar内发下载请求和解析native路径、online推断、0成员显示“+0”。

### 状态转换与可执行恢复

loading→image/fallback；presence online/offline/unknown来自业务，不凭图片成功判断在线。

### 具体使用场景

<a id="ui.spec.avatar.case.01"></a>
#### 通讯录

- **选择**：list
- **触发与可观察结果**：显示姓名后备或真实头像
- **失败、等待与恢复**：缺图不影响联系人动作。

<a id="ui.spec.avatar.case.02"></a>
#### 在线状态

- **选择**：presence explicit
- **触发与可观察结果**：附可读状态标签
- **失败、等待与恢复**：unknown不画不解释的灰点。

<a id="ui.spec.avatar.case.03"></a>
#### 多人预览

- **选择**：group overlap
- **触发与可观察结果**：显示若干头像和总数入口
- **失败、等待与恢复**：空名单显示明确无成员。

<a id="ui.spec.avatar.case.04"></a>
#### 个人资料

- **选择**：profile
- **触发与可观察结果**：大图仍按自有轮廓
- **失败、等待与恢复**：过期资源回后备并可刷新。

### 键盘、焦点、触摸与读屏

被动头像不抢焦点；动作放Link/Button；group入口读完整数量；触摸不靠hover查看名字。

### 图形、几何与动效

圆角由size policy钳制；group separation ring为结构，不是信任；图到达无尺寸跳变。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

无名、同名、超长、0成员、超过显示上限、资源过期与恶意图片。

受限display handle交resolver管理；卸载释放；不在Avatar建立remote cache。

### 自有公共合同形状

entityId/name/resourceView/sizeRole/presenceView/groupMembers/maxVisible。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.groupavatar"></a>
## GroupAvatar

合同 ID：`ui.spec.groupavatar`。来源记录：[GroupAvatar](../component-catalog.md#ui.family.groupavatar)。

### 意图、选择与边界

表达一个群实体。成员合成头像或群自定义图；明确成员与群名。相邻选择：多个独立人用 AvatarGroup。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.groupavatar)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

CompositeMembers/GroupName/optionalCustomImage；群entity不是临时成员数组。

Group/Privacy Owner管身份与成员；UI管组合。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- image=custom/composite；默认 composite。
- members=representative/hidden；默认 representative按隐私。
- size=list/header；默认 list。

禁止：把每个tile当私聊入口、泄露不可见成员、成员数组index当群ID。

### 状态转换与可执行恢复

成员变化更新合成图；custom失败降为合成或群名后备；权限不允许时不透露成员。

### 具体使用场景

<a id="ui.spec.groupavatar.case.01"></a>
#### 新群

- **选择**：composite
- **触发与可观察结果**：有群名后备，成员逐步加入
- **失败、等待与恢复**：零成员不放随机人像。

<a id="ui.spec.groupavatar.case.02"></a>
#### 群自定义图

- **选择**：custom
- **触发与可观察结果**：显示群选图
- **失败、等待与恢复**：失效回合成而不丢群身份。

<a id="ui.spec.groupavatar.case.03"></a>
#### 大群

- **选择**：representative
- **触发与可观察结果**：显示批准的代表成员
- **失败、等待与恢复**：完整名单另有权限入口。

<a id="ui.spec.groupavatar.case.04"></a>
#### 隐私群

- **选择**：hidden
- **触发与可观察结果**：只显示群图和群名
- **失败、等待与恢复**：不请求隐藏成员头像。

### 键盘、焦点、触摸与读屏

静态不Tab；打开群用独立导航；reader群名，不逐个重复朗读合成头像；触摸名单有入口。

### 图形、几何与动效

固定2×2或注册布局提案，外轮廓圆角方形；不把群头像画成四个独立可点区。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0/1/2/1000成员、退群、隐藏成员、custom失效。

合成依据stable群ID与获准成员；成员asset handles释放；换群不继承旧成员图。

### 自有公共合同形状

groupId/name/customAvatarView/visibleMemberViews/privacyPolicy/sizeRole。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.filetypeicon"></a>
## FileTypeGlyph

合同 ID：`ui.spec.filetypeicon`。来源记录：[FileTypeIcon](../component-catalog.md#ui.family.filetypeicon)、[MaterialFileTypeIcon](../component-catalog.md#ui.family.materialfiletypeicon)。

### 意图、选择与边界

文件类型识别。按 MIME/扩展名显示通用类型；未知文件后备；危险文件提示独立。相邻选择：供应商标用 BrandMark；附件状态用 StatusTag。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.filetypeicon)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Glyph/TypeLabel；MIME/extension映射一份自有资产，不选多套供应商风格。

Resource Owner管类型事实；Asset Owner管唯一映射。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=document/image/audio/video/archive/code/unknown；默认 unknown。
- source=resolved-mime/extension-hint；默认 resolved-mime，hint不证明内容。
- use=decorative/standalone-label；默认 decorative。

禁止：文件图标保证可预览/安全、同格式两套glyph、扩展名图即真实检测结论。

### 状态转换与可执行恢复

unknown→resolved kind；unsupported/unsafe是独立资源状态，不用文件glyph担保安全。

### 具体使用场景

<a id="ui.spec.filetypeicon.case.01"></a>
#### 文档附件

- **选择**：resolved document
- **触发与可观察结果**：显示文档glyph和文件名
- **失败、等待与恢复**：未知格式回通用file。

<a id="ui.spec.filetypeicon.case.02"></a>
#### 图片伪扩展

- **选择**：mime priority
- **触发与可观察结果**：检测为archive则用实际kind
- **失败、等待与恢复**：异常另显示资源警告。

<a id="ui.spec.filetypeicon.case.03"></a>
#### 未知文件

- **选择**：unknown
- **触发与可观察结果**：显示通用类型并允许合法保存
- **失败、等待与恢复**：不宣称支持预览。

<a id="ui.spec.filetypeicon.case.04"></a>
#### 紧凑列表

- **选择**：decorative
- **触发与可观察结果**：图与类型文字同轨
- **失败、等待与恢复**：不让reader重复三次文件类型。

### 键盘、焦点、触摸与读屏

装饰aria-hidden；独立类型图读类型名；静态不Tab；触摸类型说明与文件行合并。

### 图形、几何与动效

统一viewBox/stroke/optical尺寸；文件glyph不RTL镜像；不按扩展名随机染色。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

无扩展、双扩展、大小写、伪MIME、未知格式与极长文件名。

无下载/解析责任；映射与资产hash由Asset registry；版本切换不能遗留第二映射。

### 自有公共合同形状

resolvedKind/mimeHint/extensionHint/sizeRole/accessibilityLabel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.fluentemoji"></a>
## EmojiArtwork

合同 ID：`ui.spec.fluentemoji`。来源记录：[FluentEmoji](../component-catalog.md#ui.family.fluentemoji)。

### 意图、选择与边界

具备文本后备的表情展示。已选择 emoji 的视觉增强；装饰性欢迎图形在 envelope 内。相邻选择：输入真实字符用 EmojiPicker；不直接依赖远端 CDN。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.fluentemoji)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

EmojiArtwork/TextFallback/Attribution；来源资产与Unicode语义分开。

Asset Owner管版权和映射；Domain Owner管语义。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- render=artwork/text；默认 text，合法资源才artwork。
- purpose=semantic/decorative；默认 semantic。
- motion=static；默认且首版固定，动图需单独许可。

禁止：未授权商标资产、gif自动播放、fallback换情绪、decorative图读成动作。

### 状态转换与可执行恢复

loading→artwork/fallback；失败保留同一Unicode/name，不换另一表情。

### 具体使用场景

<a id="ui.spec.fluentemoji.case.01"></a>
#### 正文增强

- **选择**：semantic
- **触发与可观察结果**：同一emoji使用合法图像增强
- **失败、等待与恢复**：资源缺失回文本。

<a id="ui.spec.fluentemoji.case.02"></a>
#### 欢迎装饰

- **选择**：decorative
- **触发与可观察结果**：在批准envelope展示
- **失败、等待与恢复**：不抢屏幕阅读。

<a id="ui.spec.fluentemoji.case.03"></a>
#### 反应图形

- **选择**：semantic static
- **触发与可观察结果**：只渲染反应，命令归ReactionChip
- **失败、等待与恢复**：加载失败不改计数。

<a id="ui.spec.fluentemoji.case.04"></a>
#### 离线显示

- **选择**：text
- **触发与可观察结果**：Unicode和名称仍可读
- **失败、等待与恢复**：无字形显示名字不随机图。

### 键盘、焦点、触摸与读屏

semantic提供短名称，decorative隐藏；静态不焦点；触摸不能把装饰图当按钮。

### 图形、几何与动效

按emoji artwork资产包独立光学规范，不能强套line icon描边；尺寸按envelope；静态。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

肤色、ZWJ、无对应资产、主题对比、供应商许可撤回。

asset handle释放；最近使用不由Artwork记录；许可与digest按资产条目。

### 自有公共合同形状

emojiId/unicode/assetRef/purpose/sizeRole/fallbackLabel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.icon"></a>
## Icon / IconAssets

合同 ID：`ui.spec.icon`。来源记录：[Icon](../component-catalog.md#ui.family.icon)。

### 意图、选择与边界

统一图标语义与几何。动作 glyph、状态 glyph、独立 BrandMark；固定 viewBox/线宽/圆端。相邻选择：不能把供应商 React 图标对象传给业务 API。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.icon)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Glyph/optionalSemanticLabel；BrandMark单独资产角色。

Asset/Motion Owner管路径曲线；UI Owner管语义。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=decorative/status；默认 decorative，独立状态需label。
- size=16/18/20/24角色映射；默认20提案。
- direction=mirror/fixed；由asset登记，默认 fixed。

禁止：Icon onClick作按钮、未登记path、品牌自动镜像、所有glyph统一旋转表示loading。

### 状态转换与可执行恢复

已解析asset→渲染；缺ID按registered fallback或报告缺口；不能悄悄用别的动作图。

### 具体使用场景

<a id="ui.spec.icon.case.01"></a>
#### 发送动作

- **选择**：decorative action.send
- **触发与可观察结果**：Button拥有名称与动作
- **失败、等待与恢复**：缺asset报告资产缺口。

<a id="ui.spec.icon.case.02"></a>
#### 独立警告

- **选择**：status label
- **触发与可观察结果**：图加可读风险说明
- **失败、等待与恢复**：不能只黄色三角。

<a id="ui.spec.icon.case.03"></a>
#### 返回导航

- **选择**：mirror policy
- **触发与可观察结果**：RTL按登记镜像
- **失败、等待与恢复**：play/clock不自动镜像。

<a id="ui.spec.icon.case.04"></a>
#### 供应商品牌

- **选择**：BrandMark
- **触发与可观察结果**：按许可原比例展示
- **失败、等待与恢复**：不强改线宽冒自有glyph。

### 键盘、焦点、触摸与读屏

Icon自身非按钮；decorative隐藏；status有名称；触摸动作由外层具名control。

### 图形、几何与动效

24 viewBox、1.8 stroke为提案；optical特例登记；品牌不变形；静态默认，动效引用motion角色。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

极小尺寸、深浅背景、RTL箭头、缺资产、fill/stroke特例。

无业务请求；asset digest变化重验所有相关specimen；不页面局部覆盖stroke。

### 自有公共合同形状

iconId/sizeRole/purpose/label；禁止接受第三方React constructor。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

