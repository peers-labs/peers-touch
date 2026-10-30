# Peers 业务组合 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [RelationshipRequestItem](#ui.spec.relationshiprequestitem)
- [ContactItem](#ui.spec.contactitem)
- [ConversationItem](#ui.spec.conversationitem)
- [MessageBubble](#ui.spec.messagebubble)
- [MessageComposer](#ui.spec.messagecomposer)
- [AttachmentItem](#ui.spec.attachmentitem)
- [AttachmentViewer](#ui.spec.attachmentviewer)
- [ReactionChip / ReactionPicker](#ui.spec.reactionchip)
- [IdentityBlock](#ui.spec.identityblock)
- [TrustIndicator](#ui.spec.trustindicator)
- [PermissionDecision](#ui.spec.permissiondecision)
- [AgentTaskCard](#ui.spec.agenttaskcard)
- [ToolCallCard](#ui.spec.toolcallcard)
- [DeviceLinkCard](#ui.spec.devicelinkcard)
- [ConnectionRecovery](#ui.spec.connectionrecovery)
- [NotificationItem](#ui.spec.notificationitem)
- [NavigationShell](#ui.spec.navigationshell)
- [AppletTile](#ui.spec.applettile)
- [ResourceUsage](#ui.spec.resourceusage)
- [OnboardingFlow](#ui.spec.onboardingflow)
- [SettingRow](#ui.spec.settingrow)

<a id="ui.spec.relationshiprequestitem"></a>
## RelationshipRequestItem

合同 ID：`ui.spec.relationshiprequestitem`。来源记录：[RelationshipRequestItem](../component-catalog.md#ui.requirement.relationshiprequestitem)。

### 意图、选择与边界

同一关系请求跨面一致。Contacts/Notifications 的接受拒绝；同对象同控件。相邻选择：不能各页自己画两颗按钮。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.relationshiprequestitem)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

IdentityBlock/RequestReason/RequestState/DecisionPair；Contacts与Notifications消费同requestID与同控件。

Relationship Owner管请求与幂等；UI System Owner管canonical DecisionPair。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- direction=incoming/outgoing；默认 incoming，outgoing没有接受拒绝。
- decision=pending/accepting/rejecting/accepted/rejected/withdrawn/expired；投影供值。
- surface=contacts/notification；相同语义与30视觉高度，不两套手画。

禁止：Contacts/Notifications两套按钮、accept点击即好友、过期仍决策、outgoing提供拒绝自己。

### 状态转换与可执行恢复

incoming pending→accept/reject requested→owner终态；竞争决策single-flight；别端处理/撤回/过期以最新状态代替按钮。

### 具体使用场景

<a id="ui.spec.relationshiprequestitem.case.01"></a>
#### 收到请求

- **选择**：incoming pending
- **触发与可观察结果**：读身份理由再接受/拒绝
- **失败、等待与恢复**：失败留请求可恢复。

<a id="ui.spec.relationshiprequestitem.case.02"></a>
#### 发出请求

- **选择**：outgoing
- **触发与可观察结果**：显示等待和合法撤回
- **失败、等待与恢复**：不显示接受自己的按钮。

<a id="ui.spec.relationshiprequestitem.case.03"></a>
#### 别端已处理

- **选择**：terminal projection
- **触发与可观察结果**：两面同步真实已处理
- **失败、等待与恢复**：不重复发决策。

<a id="ui.spec.relationshiprequestitem.case.04"></a>
#### 请求过期

- **选择**：expired
- **触发与可观察结果**：显示期限和可行下一步
- **失败、等待与恢复**：不把失败伪成拒绝。

<a id="ui.spec.relationshiprequestitem.case.05"></a>
#### 两面一致

- **选择**：contacts+notification
- **触发与可观察结果**：同request动作/label/marker
- **失败、等待与恢复**：任一pending同步锁竞争决定。

### 键盘、焦点、触摸与读屏

accept/reject独立具名按钮，键盘焦点稳定；触摸同轨；reader身份/理由/状态；无默认Enter替批准。

### 图形、几何与动效

DecisionPair30高度与统一圆角；Identity/Reason/Actions共享轨；fast反馈，pending不换行。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同名、远端身份、长理由、无权限请求、别端处理与账号切换。

Relationship runtime持request状态；组件清临时反馈；unmount不撤销已发决策；旧identity回调丢弃。

### 自有公共合同形状

requestId/requestView/identityView/decisionView/decisionActions/sourceSurface。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.contactitem"></a>
## ContactItem

合同 ID：`ui.spec.contactitem`。来源记录：[ContactItem](../component-catalog.md#ui.requirement.contactitem)。

### 意图、选择与边界

联系人对象的标准行。搜索、通讯录、分享选择；身份/来源/动作一致。相邻选择：群对象用 GroupItem。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.contactitem)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Avatar/Name/IdentitySource/Availability/PrimaryIntent/SecondaryActions；搜索、通讯录、选择共享身份槽。

Directory/Relationship/Messaging Owner管能力；UI管标准联系人行。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=browse/start-chat/select；必选。
- relationship=none/requested/contact/blocked；真实投影。
- discovery=local/remote/unknown；默认 unknown，细节只在影响用户时说明。

禁止：名字当actorID、UI选FederationID、每行自己resolve路由、start-chat无授权直接发消息。

### 状态转换与可执行恢复

查询loading→resolved/unknown/failed；start-chat→opening→ready/failed；发请求与开始聊天按关系授权分开。

### 具体使用场景

<a id="ui.spec.contactitem.case.01"></a>
#### 搜索找人

- **选择**：browse
- **触发与可观察结果**：显示真实身份与来源
- **失败、等待与恢复**：查询失败不是“无人”。

<a id="ui.spec.contactitem.case.02"></a>
#### 开始聊天

- **选择**：start-chat
- **触发与可观察结果**：服务端授权后打开会话
- **失败、等待与恢复**：失败给关系/投递就绪原因。

<a id="ui.spec.contactitem.case.03"></a>
#### 分享选择

- **选择**：select
- **触发与可观察结果**：勾选真实actor集合
- **失败、等待与恢复**：不因filter清隐含选择。

<a id="ui.spec.contactitem.case.04"></a>
#### 已封锁对象

- **选择**：blocked
- **触发与可观察结果**：读限制与合法解除入口
- **失败、等待与恢复**：不仍显示可发送按钮。

<a id="ui.spec.contactitem.case.05"></a>
#### 同名远端

- **选择**：identity source
- **触发与可观察结果**：用户能区分对象
- **失败、等待与恢复**：不暴露路由技术参数。

### 键盘、焦点、触摸与读屏

主导航Link与动作Button分区；选择checkbox单独；keyboard/touch完整；reader名字加可辨来源。

### 图形、几何与动效

各面共享头像/name/meta/actions轨道；long name可全读；状态不靠不明dot。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同名跨站、搜索旧缓存、已封锁、没有头像、条目失效与多人选择。

Directory/Contacts runtime订阅；row stable actorID；选择集归owner；组件不自动入联邦。

### 自有公共合同形状

actorId/identityView/relationshipView/availability/purpose/actionViews。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.conversationitem"></a>
## ConversationItem

合同 ID：`ui.spec.conversationitem`。来源记录：[ConversationItem](../component-catalog.md#ui.requirement.conversationitem)。

### 意图、选择与边界

会话的标准入口行。未读、草稿、最后活动、静音、置顶。相邻选择：普通实体用 ListItem。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.conversationitem)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Avatar/Title/LastActivity/Preview/Draft/Unread/MutePin/More；active route与未读分开。

Messaging/Draft Owner管会话事实；UI管导航行。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=direct/group/task；必选。
- preview=message/draft/system；默认最新可见message，draft优先政策显式。
- state=normal/archived/unavailable；真实。

禁止：打开点击立即读完、preview泄露私密、index key、pin状态只本地改变、行与more双激活。

### 状态转换与可执行恢复

collection加载→条目；open读取route；已读由Messaging receipt政策；pin/mute分别pending与confirmed。

### 具体使用场景

<a id="ui.spec.conversationitem.case.01"></a>
#### 有未读

- **选择**：normal
- **触发与可观察结果**：显示真实数量，打开后按receipt更新
- **失败、等待与恢复**：载入失败不清未读。

<a id="ui.spec.conversationitem.case.02"></a>
#### 有草稿

- **选择**：draft
- **触发与可观察结果**：显示草稿标记并恢复composer
- **失败、等待与恢复**：新消息不擦draft。

<a id="ui.spec.conversationitem.case.03"></a>
#### 静音置顶

- **选择**：actions
- **触发与可观察结果**：命令pending与确认可辨
- **失败、等待与恢复**：失败回确认状态。

<a id="ui.spec.conversationitem.case.04"></a>
#### 会话不可用

- **选择**：unavailable
- **触发与可观察结果**：读原因与返回/恢复
- **失败、等待与恢复**：不无声移除所有上下文。

### 键盘、焦点、触摸与读屏

Link打开与more/button分开；keyboard有完整title；touchlong-press有more；reader未读和草稿不只徽标。

### 图形、几何与动效

共享title/preview/time/count/action轨；time不挤断title；emoji/附件摘要可读。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

超长名、草稿与新消息并存、巨大未读、隐藏敏感预览、会话移除。

IM runtime持未读和draft；row回收不清；账号scope变更丢旧回调。

### 自有公共合同形状

conversationId/conversationView/draftSummary/unreadView/actions/openDestination。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.messagebubble"></a>
## MessageBubble

合同 ID：`ui.spec.messagebubble`。来源记录：[MessageBubble](../component-catalog.md#ui.requirement.messagebubble)。

### 意图、选择与边界

显示一条可追溯消息。本人/对方/系统；发送中/失败/编辑/删除；附件引用。相邻选择：Agent 任务进度另用 TaskCard。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.messagebubble)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Author/Body/Attachments/Reply/Time/Delivery/EditedDeleted/Actions；一条稳定messageID。

Messaging/Receipt Owner管消息与投递；UI只呈现。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- author=self/other/system；必选。
- delivery=queued/sending/sent/delivered/read/failed；以协议支持值投影。
- body=present/edited/deleted/partial-stream；默认 present。

禁止：发送按钮点击即已读、retry创建重复消息、删UI=撤回、消息bubble全click抢选择。

### 状态转换与可执行恢复

send intent→queued/sending→sent/delivered/read；sent不等read；failed可恢复同意图；编辑和撤回终态由owner。

### 具体使用场景

<a id="ui.spec.messagebubble.case.01"></a>
#### 发出消息

- **选择**：self sending
- **触发与可观察结果**：pending显示真实投递阶段
- **失败、等待与恢复**：失败保留正文附件和重试。

<a id="ui.spec.messagebubble.case.02"></a>
#### 收到消息

- **选择**：other
- **触发与可观察结果**：可读作者和来源，reply明确
- **失败、等待与恢复**：身份未知不给虚假verified。

<a id="ui.spec.messagebubble.case.03"></a>
#### 已编辑

- **选择**：edited
- **触发与可观察结果**：展示真实修订标记
- **失败、等待与恢复**：冲突消费owner版本。

<a id="ui.spec.messagebubble.case.04"></a>
#### 已撤回

- **选择**：deleted
- **触发与可观察结果**：保留tombstone与上下文
- **失败、等待与恢复**：不能假装从未存在。

<a id="ui.spec.messagebubble.case.05"></a>
#### 回复失效

- **选择**：reply
- **触发与可观察结果**：显示引用已不可用
- **失败、等待与恢复**：导航失败仍可回当前消息。

### 键盘、焦点、触摸与读屏

正文可选择复制；actions具名keyboard/touch；reply跳转可返回；reader作者/正文/真实投递状态，流式节流。

### 图形、几何与动效

Text/Markdown/Attachment共享边界，self/other分区不只色；流式无逐tokenfade；删除留可读tombstone。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长正文、RTL、emoji、无正文附件、断网重试、乱序receipt与被删引用。

Message runtime管durable内容和订阅；asset handle释放；虚拟回收不删消息；旧回调按ID/revision。

### 自有公共合同形状

messageId/messageView/authorView/deliveryView/bodyRevision/replyRef/actionViews。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.messagecomposer"></a>
## MessageComposer

合同 ID：`ui.spec.messagecomposer`。来源记录：[MessageComposer](../component-catalog.md#ui.requirement.messagecomposer)。

### 意图、选择与边界

承载发送意图及草稿。文本/附件/提及/回复；send/stop 分开；移动键盘恢复。相邻选择：长编辑用 RichTextEditor。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.messagecomposer)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

DraftEditor/Attachments/Mentions/ReplyContext/Send/Stop/Failure；草稿是一个完整发送意图。

Messaging/Agent/Draft Owner管意图与状态；UI管编辑面。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=message/agent-task；必选，stop只Agent当前执行。
- submit=enter/explicit-shortcut；按平台composer policy，IME保护。
- draft=clean/dirty/sending/failed；输入与execution分开。
- offline=queue-supported/blocked；由Messaging合同供。

禁止：发送先清正文、IME候选Enter提交、切会话沿用别会话草稿、停止即删除任务、UI创建幂等协议。

### 状态转换与可执行恢复

edit dirty→validate attachments/permissions→send→queued/confirmed/failed；失败保留draft；stop与取消整个任务不同command。

### 具体使用场景

<a id="ui.spec.messagecomposer.case.01"></a>
#### 文本发送

- **选择**：message
- **触发与可观察结果**：提交单意图，owner确认后清对应draft
- **失败、等待与恢复**：失败保留全部内容。

<a id="ui.spec.messagecomposer.case.02"></a>
#### 附件发送

- **选择**：message
- **触发与可观察结果**：合法附件集合并入同intent
- **失败、等待与恢复**：部分失败明确处理，不偷偷漏附件。

<a id="ui.spec.messagecomposer.case.03"></a>
#### 离线发送

- **选择**：queue-supported
- **触发与可观察结果**：显示已排本地队列
- **失败、等待与恢复**：不写远端已收到。

<a id="ui.spec.messagecomposer.case.04"></a>
#### Agent停止

- **选择**：agent-task
- **触发与可观察结果**：request stop显示stopping
- **失败、等待与恢复**：失败留输出且可重试。

<a id="ui.spec.messagecomposer.case.05"></a>
#### 切会话恢复

- **选择**：draft identity
- **触发与可观察结果**：各会话草稿光标按policy恢复
- **失败、等待与恢复**：不混对象。

<a id="ui.spec.messagecomposer.case.06"></a>
#### 移动键盘

- **选择**：platform
- **触发与可观察结果**：输入与发送可达
- **失败、等待与恢复**：键盘收起不丢draft。

### 键盘、焦点、触摸与读屏

Enter/ShiftEnter/IME按明确policy；Tab工具可退出；touch键盘不遮Send；reader附件/回复/发送原因；上传中有具名cancel。

### 图形、几何与动效

Editor/附件/尾部工具同frame/轨；chat按钮34角色；pending不挤文本；输入无动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

空正文有附件、全部附件失败、长文、剪贴板多媒体、reply被删、切会话与软键盘恢复。

Draft runtime按conversation/account持久；UI卸载不清；send单intent去重；resource临时handle按owner finalizer。

### 自有公共合同形状

draftId/conversationId/draftView/attachmentViews/replyRef/submitPolicy/sendView/stopView/onEdit/onSubmit。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.attachmentitem"></a>
## AttachmentItem

合同 ID：`ui.spec.attachmentitem`。来源记录：[AttachmentItem](../component-catalog.md#ui.requirement.attachmentitem)。

### 意图、选择与边界

资源转移状态与动作入口。文件名/MIME/大小/进度/重试/取消/打开。相邻选择：图片展示用 Image；下载用 DownloadAction。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.attachmentitem)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

FileTypeGlyph/Name/MIME/Size/TransferProgress/Failure/OpenSaveRetryCancel。

Resource/Transfer Owner管资源与权限；UI管附件行。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- direction=upload/download/local-ready；必选。
- state=queued/transferring/ready/failed/cancelled/expired/unsupported；真实。
- preview=available/unavailable；不能从扩展名猜。

禁止：上传发出=ready、失败后丢文件、retry重复resource、扩展名保证安全、URL当ID。

### 状态转换与可执行恢复

选择后queued→transferring→ready或failed；cancel请求后等确认；retry按同transfer恢复政策；ready才允许真实打开。

### 具体使用场景

<a id="ui.spec.attachmentitem.case.01"></a>
#### 正在上传

- **选择**：upload
- **触发与可观察结果**：显示loaded/total与取消
- **失败、等待与恢复**：失败保留来源和重试。

<a id="ui.spec.attachmentitem.case.02"></a>
#### 下载中断

- **选择**：download
- **触发与可观察结果**：按owner支持续传
- **失败、等待与恢复**：不造进度或新重复对象。

<a id="ui.spec.attachmentitem.case.03"></a>
#### 可打开

- **选择**：ready
- **触发与可观察结果**：按真实preview capability打开
- **失败、等待与恢复**：不支持改合法保存。

<a id="ui.spec.attachmentitem.case.04"></a>
#### 权限过期

- **选择**：expired
- **触发与可观察结果**：保留元数据说明需重授权
- **失败、等待与恢复**：不继续用旧受限handle。

<a id="ui.spec.attachmentitem.case.05"></a>
#### 取消传输

- **选择**：requested
- **触发与可观察结果**：显示正在取消
- **失败、等待与恢复**：收到cancelled再终止显示。

### 键盘、焦点、触摸与读屏

名字完整读取，打开/保存/取消具名分区；keyboard/touch；progress节流reader，不每chunk。

### 图形、几何与动效

filename/meta/status/action共享轨；long name截断有全文；Progress真实度量，不改变整行height。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0字节、未知size、超长名、双扩展、断点续传、加密失败与无权限。

Resource runtime管transfer/cache/handle；unmount不取消后台；临时资源仅任务finalizer清。

### 自有公共合同形状

attachmentId/resourceView/transferView/previewCapability/actionViews。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.attachmentviewer"></a>
## AttachmentViewer

合同 ID：`ui.spec.attachmentviewer`。来源记录：[AttachmentViewer](../component-catalog.md#ui.requirement.attachmentviewer)。

### 意图、选择与边界

统一文件打开与预览任务。图片/音频/视频/文本/文档/不支持；保存/关闭统一。相邻选择：HTML 必须用沙箱；不直接暴露 OS path。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.attachmentviewer)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Title/ResourceStatus/FormatRenderer/Save/Close/optionalFormatActions；统一预览chrome。

Resource/Security Owner管resolver；Platform Owner管window；UI统一壳。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- format=image/audio/video/text/document/unsupported；真实resolver给。
- surface=native-window/dialog/sheet；按平台能力。
- source=resolved-local/stream；port限定。

禁止：每格式自行OS路径解析、未知preview当空白、UI外链携secret、关闭取消全局下载。

### 状态转换与可执行恢复

open resource→resolving→ready/failed/unsupported/expired；format切换不换resourceID；保存与预览独立执行。

### 具体使用场景

<a id="ui.spec.attachmentviewer.case.01"></a>
#### 图片附件

- **选择**：image
- **触发与可观察结果**：统一chrome内zoom/保存/关闭
- **失败、等待与恢复**：解码失败保留文件名和替代。

<a id="ui.spec.attachmentviewer.case.02"></a>
#### 音视频

- **选择**：audio/video
- **触发与可观察结果**：同壳真实播放器
- **失败、等待与恢复**：格式不支持可合法保存。

<a id="ui.spec.attachmentviewer.case.03"></a>
#### 文本文档

- **选择**：text/document
- **触发与可观察结果**：安全renderer显示来源
- **失败、等待与恢复**：恶意内容阻断且可看适用说明。

<a id="ui.spec.attachmentviewer.case.04"></a>
#### 未知格式

- **选择**：unsupported
- **触发与可观察结果**：明确不可预览与保存入口
- **失败、等待与恢复**：不画假内容。

<a id="ui.spec.attachmentviewer.case.05"></a>
#### 资源过期

- **选择**：expired
- **触发与可观察结果**：重授权/重解析同ID
- **失败、等待与恢复**：不泄露旧路径。

### 键盘、焦点、触摸与读屏

打开keyboard焦点进标题/renderer；关闭返附件或safe fallback；touchzoom/媒体有按钮；reader格式与状态。

### 图形、几何与动效

compact一致title/actions轨道；各renderer bounded；不每格式新一套壳；motion不抢媒体。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

多格式、超大、恶意HTML/PDF、缺decoder、文件移除、多个native windows。

viewer handles/window scope释放；Resource owner管缓存；关闭preview不删附件/传输；限定sandbox。

### 自有公共合同形状

resourceId/resourceView/formatCapability/rendererPort/windowScope/saveAction/closeAction。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.reactionchip"></a>
## ReactionChip / ReactionPicker

合同 ID：`ui.spec.reactionchip`。来源记录：[ReactionChip](../component-catalog.md#ui.requirement.reactionchip)。

### 意图、选择与边界

消息和帖子反应交互。选中/计数/增减/菜单；已有相同反应去重。相邻选择：普通 emoji 插入用 EmojiPicker。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.reactionchip)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

EmojiGlyph/Count/MineState/Toggle/ParticipantsEntry；ReactionPicker提供同allowed集合。

Reaction/Privacy Owner管汇总与名单；UI管toggle。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- state=unselected/selected/pending；以confirmed与desired分离。
- aggregate=count/unknown；未知不显示0。
- purpose=toggle/view-participants；主/辅动作分开。

禁止：点击永久本地+1、0当未知、重复同emoji生成两chip、参与者泄露。

### 状态转换与可执行恢复

toggle→pending→owner新计数和mine或failed回确认；同emoji去重；别端更新合并按业务合同。

### 具体使用场景

<a id="ui.spec.reactionchip.case.01"></a>
#### 添加反应

- **选择**：unselected
- **触发与可观察结果**：发toggle确认后更新mine/count
- **失败、等待与恢复**：失败回原状态。

<a id="ui.spec.reactionchip.case.02"></a>
#### 取消我的

- **选择**：selected
- **触发与可观察结果**：移除自己的反应
- **失败、等待与恢复**：不能删除别人反应。

<a id="ui.spec.reactionchip.case.03"></a>
#### 查看参与者

- **选择**：authorized
- **触发与可观察结果**：打开有权名单
- **失败、等待与恢复**：无权只读可知计数。

<a id="ui.spec.reactionchip.case.04"></a>
#### 并发更新

- **选择**：projection
- **触发与可观察结果**：别端与本次结果按版本同步
- **失败、等待与恢复**：不靠组件猜最终count。

### 键盘、焦点、触摸与读屏

aria-pressed与具名“回应某emoji”；participants独立入口；keyboard/touch等价；reader真实数量。

### 图形、几何与动效

chip圆角与自有emoji，count同轨；fast选择，无弹跳刷计数；触摸外扩不重叠。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0 count、自己取消、并发反应、emoji禁用、名单无权、超大count。

Reaction runtime持aggregate；component无计数自增真源；旧message callback忽略。

### 自有公共合同形状

messageId/reactionId/emojiId/confirmedCount/mine/execution/participantsCapability。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.identityblock"></a>
## IdentityBlock

合同 ID：`ui.spec.identityblock`。来源记录：[IdentityBlock](../component-catalog.md#ui.requirement.identityblock)。

### 意图、选择与边界

身份、来源和受众上下文。联系人、消息作者、分享目标；敏感详情逐步展开。相邻选择：普通昵称用 Text 不足以表达跨 Station 身份。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.identityblock)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Avatar/Name/Source/AudienceContext/optionalDetails；身份不等连接路线。

Identity/Privacy Owner管身份；UI管必要上下文。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- context=author/contact/share-target；必选。
- resolution=known/partial/unknown；默认 unknown。
- disclosure=summary/details；默认 summary最少必要。

禁止：名字即ID、来源隐藏影响授权、UI让用户选联邦路由、unknown装verified。

### 状态转换与可执行恢复

lookup→resolved/partial/failed；unknown保原标识可读；可信状态独立TrustIndicator；details有授权。

### 具体使用场景

<a id="ui.spec.identityblock.case.01"></a>
#### 消息作者

- **选择**：author
- **触发与可观察结果**：名称与可知来源
- **失败、等待与恢复**：未知明确但不阻阅读正文。

<a id="ui.spec.identityblock.case.02"></a>
#### 分享目标

- **选择**：share-target
- **触发与可观察结果**：确认真实身份与受众边界
- **失败、等待与恢复**：无权详情不透露。

<a id="ui.spec.identityblock.case.03"></a>
#### 同名联系人

- **选择**：contact
- **触发与可观察结果**：来源区分并可查详情
- **失败、等待与恢复**：不能只头像猜。

<a id="ui.spec.identityblock.case.04"></a>
#### 缓存身份

- **选择**：partial
- **触发与可观察结果**：显示已知信息与需刷新状态
- **失败、等待与恢复**：不能标新鲜已验证。

### 键盘、焦点、触摸与读屏

姓名导航独立Link；reader可区分同名来源和受众；touch可展开来源；静态不Tab每slot。

### 图形、几何与动效

Avatar/title/meta共享轨；来源不泄技术plumbing；trusted marker不靠色；no random shift。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同名、跨站、长公开ID、未知来源、离线缓存和隐私限制。

Identity runtime管resolve与asOf；UI不查P2P路由；resource handle释放。

### 自有公共合同形状

actorId/displayIdentity/sourceSummary/audienceContext/resolution/asOf/detailsCapability。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.trustindicator"></a>
## TrustIndicator

合同 ID：`ui.spec.trustindicator`。来源记录：[TrustIndicator](../component-catalog.md#ui.requirement.trustindicator)。

### 意图、选择与边界

说明影响下一步的可信与限制状态。verified/remote/degraded/blocked/unknown；展开原因。相邻选择：普通在线点用 Badge。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.trustindicator)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

StateLabel/Reason/Impact/RecoveryOrDetails；只显示影响当前任务的可信与限制。

Trust/Policy Owner管判定；UI管可理解限制。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- state=verified/remote/degraded/blocked/unknown；业务定义真实语义。
- scope=identity/action/connection；必选。
- detail=summary/expanded；默认 summary。

禁止：远端=不可信、联邦正常=所有业务就绪、绿色=可授权、unknown中性dot无解释。

### 状态转换与可执行恢复

unknown→checking→owner状态；remote不是危险，verified不保证全部能力；恢复依typed reason。

### 具体使用场景

<a id="ui.spec.trustindicator.case.01"></a>
#### 身份已验证

- **选择**：identity
- **触发与可观察结果**：说明已验证的具体范围
- **失败、等待与恢复**：不承诺消息一定可投递。

<a id="ui.spec.trustindicator.case.02"></a>
#### 远端对象

- **选择**：remote
- **触发与可观察结果**：说明来源/受众差异
- **失败、等待与恢复**：不当默认danger。

<a id="ui.spec.trustindicator.case.03"></a>
#### 能力降级

- **选择**：degraded
- **触发与可观察结果**：说明当前哪项受限及下一步
- **失败、等待与恢复**：同站聊天可用不全禁用。

<a id="ui.spec.trustindicator.case.04"></a>
#### 阻断授权

- **选择**：blocked
- **触发与可观察结果**：原因与合法恢复
- **失败、等待与恢复**：UI不能自己解除。

### 键盘、焦点、触摸与读屏

文字不只dot，必要details可keyboard/touch；reader状态原因和受影响任务；不重复吓人提示。

### 图形、几何与动效

自有status glyph/tone；label与trailing status slot一致；checking不画无意义灰点。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

部分验证、缓存过期、跨站可投递但目录受限、签名失败和不明原因。

Trust/runtime owner订阅；UI不签发信任或自动放行；asOf与scope变化更新。

### 自有公共合同形状

trustView/state/reason/affectedCapabilities/asOf/recoveryActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.permissiondecision"></a>
## PermissionDecision

合同 ID：`ui.spec.permissiondecision`。来源记录：[PermissionDecision](../component-catalog.md#ui.requirement.permissiondecision)。

### 意图、选择与边界

用户审批真实能力与权限请求。Agent 工具使用、外部访问、设备授权；允许一次/有限期/拒绝。相邻选择：普通确认用 ConfirmDialog。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.permissiondecision)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Requester/Capability/Resources/Scope/Duration/Consequences/DecisionActions/Expiry。

Approval/Policy Owner管权限事实；UI管可理解决策。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- decision=allow-once/allow-bounded/deny；仅owner支持的合法选项。
- state=waiting/submitting/approved/denied/expired/withdrawn；投影。
- risk=declared-impact；由Policy Owner不是按钮tone判断。

禁止：自动批准、默认永久授权、隐藏scope、approve click即成功、UI自行造权限token。

### 状态转换与可执行恢复

waiting→chosen requested→owner confirmed；single-flight竞争锁；期限到/别端决定刷新终态；超时不批准。

### 具体使用场景

<a id="ui.spec.permissiondecision.case.01"></a>
#### 允许此次

- **选择**：allow-once
- **触发与可观察结果**：明确当前资源后提交
- **失败、等待与恢复**：失败保留请求可重试。

<a id="ui.spec.permissiondecision.case.02"></a>
#### 限期允许

- **选择**：bounded
- **触发与可观察结果**：显示期限与持续后果
- **失败、等待与恢复**：不默认永久。

<a id="ui.spec.permissiondecision.case.03"></a>
#### 拒绝请求

- **选择**：deny
- **触发与可观察结果**：提交真实拒绝并终态回读
- **失败、等待与恢复**：失败不显示已拒绝。

<a id="ui.spec.permissiondecision.case.04"></a>
#### 过期/撤回

- **选择**：terminal
- **触发与可观察结果**：移除竞争决策显示原因
- **失败、等待与恢复**：不能对旧request发批准。

<a id="ui.spec.permissiondecision.case.05"></a>
#### 别端决定

- **选择**：projection
- **触发与可观察结果**：显示已由其他设备处理
- **失败、等待与恢复**：不重复签发授权。

### 键盘、焦点、触摸与读屏

无默认Enter批准；安全initial focus；keyboard/touch可读全部资源范围；reader请求者与期限；长说明可完整看。

### 图形、几何与动效

明确范围与动作同轨；允许/拒绝按Decision政策；normal表面，pending保持文本。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

资源很多、敏感路径脱敏、期限刚过、别端处理、请求撤回和partial scope。

Approval runtime管权限token；UI只交decision intent；关闭不判拒绝除非合同明确；秘密不进日志。

### 自有公共合同形状

requestId/requesterView/capability/resources/scope/duration/expiry/decisionView/actions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.agenttaskcard"></a>
## AgentTaskCard

合同 ID：`ui.spec.agenttaskcard`。来源记录：[AgentTaskCard](../component-catalog.md#ui.requirement.agenttaskcard)。

### 意图、选择与边界

任务当前阶段与可行动状态。queued/running/waiting-decision/stopping/succeeded/failed。相邻选择：聊天气泡不能承载全部任务真源。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.agenttaskcard)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

TaskTitle/Stage/Progress/LatestUsefulOutput/DecisionWait/StopCancel/FailureRecovery。

Agent Execution Owner管任务；UI管阶段和下一步。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- state=queued/running/waiting-decision/stopping/succeeded/failed/cancelled；真实。
- surface=summary/detail；默认 summary可进入完整任务。
- action=stop-stream/cancel-task/retry；按能力供，不混。

禁止：running当success、停止流=取消任务、summary丢失败输出、组件自行编排工具。

### 状态转换与可执行恢复

queued→running→waiting-decision或terminal；stop→stopping→confirmed；失败保留输出和resume可能性；summary消费任务投影。

### 具体使用场景

<a id="ui.spec.agenttaskcard.case.01"></a>
#### 排队

- **选择**：queued
- **触发与可观察结果**：解释等待且可合法取消
- **失败、等待与恢复**：取消requested不等终止。

<a id="ui.spec.agenttaskcard.case.02"></a>
#### 执行中

- **选择**：running
- **触发与可观察结果**：显示阶段和有用输出
- **失败、等待与恢复**：断线标投影陈旧。

<a id="ui.spec.agenttaskcard.case.03"></a>
#### 待决策

- **选择**：waiting-decision
- **触发与可观察结果**：突出具体审批入口
- **失败、等待与恢复**：不能自动批准继续。

<a id="ui.spec.agenttaskcard.case.04"></a>
#### 请求停止

- **选择**：stopping
- **触发与可观察结果**：保留输出等待确认
- **失败、等待与恢复**：失败允许恢复动作。

<a id="ui.spec.agenttaskcard.case.05"></a>
#### 失败恢复

- **选择**：failed
- **触发与可观察结果**：说明原因与resume/retry范围
- **失败、等待与恢复**：不重跑已成功副作用。

### 键盘、焦点、触摸与读屏

status文字与下一步可读；decision入口keyboard/touch；不focus每token；reader关键阶段节流。

### 图形、几何与动效

主体是任务结果/下一步；阶段/action共享轨；无不停转头像和每tokenfade。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长任务、多工具并行、离线、恢复、部分输出、任务过期和别端继续。

Agent runtime管durable执行/lease；card卸载不stop；UI timers清理；asOf标陈旧。

### 自有公共合同形状

taskId/taskProjection/outputSummary/decisionRefs/actionCapabilities/asOf。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.toolcallcard"></a>
## ToolCallCard

合同 ID：`ui.spec.toolcallcard`。来源记录：[ToolCallCard](../component-catalog.md#ui.requirement.toolcallcard)。

### 意图、选择与边界

解释一次工具调用输入输出和决策。准备/执行/等待批准/失败/完成；敏感内容遮挡。相邻选择：一般日志用 CodeBlock。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.toolcallcard)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ToolName/Purpose/InputSummary/PermissionState/Execution/Output/Failure；敏感input遮挡。

Tool/Policy Execution Owner管调用；UI管解释。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- state=prepared/waiting-approval/running/succeeded/failed/cancelled；真实。
- detail=summary/expanded；默认 summary。
- payload=public/redacted/secret-reference；默认 redacted安全必要信息。

禁止：点击展开执行工具、工具输出当可信指令、秘密进DOM、失败无脑retry副作用。

### 状态转换与可执行恢复

prepared→approval(if required)→running→terminal；output迟到绑定callID；失败保留部分可读output；retry由effect政策裁定。

### 具体使用场景

<a id="ui.spec.toolcallcard.case.01"></a>
#### 执行准备

- **选择**：prepared
- **触发与可观察结果**：说明用途与资源
- **失败、等待与恢复**：不直接显示成功。

<a id="ui.spec.toolcallcard.case.02"></a>
#### 需要批准

- **选择**：waiting-approval
- **触发与可观察结果**：链接真实权限请求
- **失败、等待与恢复**：展开输入不代表批准。

<a id="ui.spec.toolcallcard.case.03"></a>
#### 执行输出

- **选择**：running
- **触发与可观察结果**：显示可读增量/阶段
- **失败、等待与恢复**：超时保留已产出内容。

<a id="ui.spec.toolcallcard.case.04"></a>
#### 失败调用

- **选择**：failed
- **触发与可观察结果**：具体原因与合法恢复
- **失败、等待与恢复**：副作用未知不能盲重跑。

<a id="ui.spec.toolcallcard.case.05"></a>
#### 敏感输入

- **选择**：redacted
- **触发与可观察结果**：只显示用户判断必要范围
- **失败、等待与恢复**：不把token放tooltip。

### 键盘、焦点、触摸与读屏

展开keyboard/touch；审批独立PermissionDecision；reader工具做什么和是否需行动；code outputs可选。

### 图形、几何与动效

title/status/input/output共享边界；Disclosure长详情；无需每调用独立无限大卡。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

巨型JSON、秘密、并行call同名、部分副作用、超时、已撤回审批。

Execution owner管call与副作用；UI不执行工具；资源handle释放；旧call回调不写新卡。

### 自有公共合同形状

toolCallId/toolDescriptor/inputView/permissionRef/execution/outputView/recoveryCapabilities。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.devicelinkcard"></a>
## DeviceLinkCard

合同 ID：`ui.spec.devicelinkcard`。来源记录：[DeviceLinkCard](../component-catalog.md#ui.requirement.devicelinkcard)。

### 意图、选择与边界

扫码与设备绑定的生命周期。二维码待扫/过期/手机批准/完成/撤销。相邻选择：QrCode 只负责画码。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.devicelinkcard)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Purpose/TargetDevice/QrCode/Expiry/ScanState/ApprovalState/CancelRevoke/Result。

DeviceLink/Auth Owner管全生命周期；UI管扫码与决策呈现。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- flow=login/link；必选，登录与绑定现有身份分开。
- state=preparing/waiting-scan/scanned/waiting-approval/confirmed/expired/revoked/failed；真实。
- platform=camera/alternative/unsupported；能力供。

禁止：扫描=登录、刷新图未轮换session、模拟相机支持当真机光学PASS、重复批准签两设备。

### 状态转换与可执行恢复

prepare→wait-scan→scanned→phone approval→confirmed；到期旧session失效；revoke请求与真实撤销分开。

### 具体使用场景

<a id="ui.spec.devicelinkcard.case.01"></a>
#### 扫码登录

- **选择**：login
- **触发与可观察结果**：等手机明确批准后Desktop确认
- **失败、等待与恢复**：网络失败保留阶段与恢复。

<a id="ui.spec.devicelinkcard.case.02"></a>
#### 绑定设备

- **选择**：link
- **触发与可观察结果**：展示新增设备身份与授权范围
- **失败、等待与恢复**：拒绝不生成已绑定状态。

<a id="ui.spec.devicelinkcard.case.03"></a>
#### 二维码过期

- **选择**：expired
- **触发与可观察结果**：旧码不可用并可刷新
- **失败、等待与恢复**：不能继续显示等待成功。

<a id="ui.spec.devicelinkcard.case.04"></a>
#### 多设备竞争

- **选择**：session projection
- **触发与可观察结果**：按owner裁定显示最新决定
- **失败、等待与恢复**：UI不各自乐观成功。

<a id="ui.spec.devicelinkcard.case.05"></a>
#### 撤销设备

- **选择**：revoke
- **触发与可观察结果**：明确后果并回读撤销
- **失败、等待与恢复**：失败保留仍有效说明。

### 键盘、焦点、触摸与读屏

reader目的/设备/期限，不能朗读payload；refresh/cancel可键盘触摸；手机批准安全焦点；无相机有边界说明。

### 图形、几何与动效

QrCodequiet zone和contrast不被state覆盖；设备说明/动作同轨；无扫码瞬间庆祝。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

旧截图、双手机同时扫、别端批准、权限拒绝、网络中断、已完成与撤销。

Device/Auth session owner管payload/期限；UI不签身份；清显示handle；离开不默认撤销已完成设备。

### 自有公共合同形状

sessionId/flow/targetDeviceView/qrView/expiry/approvalView/revokeView/platformCapabilities。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.connectionrecovery"></a>
## ConnectionRecovery

合同 ID：`ui.spec.connectionrecovery`。来源记录：[ConnectionRecovery](../component-catalog.md#ui.requirement.connectionrecovery)。

### 意图、选择与边界

连接或身份恢复的可执行路径。offline/reconnecting/degraded/needs-user/failed。相邻选择：EmptyState 不能隐藏离线。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.connectionrecovery)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

CapabilityReadiness/FailureReason/NextAction/PreservedContext/RetryBudget/AsOf。

Identity/Directory/Messaging Runtime各管scope；UI管可理解恢复。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=login/discovery/delivery；必选分层，不能笼统联邦正常。
- state=offline/reconnecting/degraded/needs-user/failed/ready；真实。
- retry=automatic-bounded/manual；默认 manual，自动需owner预算。

禁止：自动无限重试、显示技术路由参数、一个绿点代所有ready、恢复清draft。

### 状态转换与可执行恢复

failure→bounded reconnect→ready或needs-user/failed；ready按该scope，不推所有业务；保留draft和已完成输出。

### 具体使用场景

<a id="ui.spec.connectionrecovery.case.01"></a>
#### 离线

- **选择**：delivery
- **触发与可观察结果**：说明消息排队或受限
- **失败、等待与恢复**：恢复后真实投递状态更新。

<a id="ui.spec.connectionrecovery.case.02"></a>
#### 身份失效

- **选择**：login needs-user
- **触发与可观察结果**：给重新认证路径
- **失败、等待与恢复**：不自动重建身份。

<a id="ui.spec.connectionrecovery.case.03"></a>
#### 找人失败

- **选择**：discovery
- **触发与可观察结果**：保留查询与重查
- **失败、等待与恢复**：不把目录失败当无人。

<a id="ui.spec.connectionrecovery.case.04"></a>
#### 部分可用

- **选择**：degraded
- **触发与可观察结果**：同站聊天继续，跨站受限明确
- **失败、等待与恢复**：不禁全部通信。

<a id="ui.spec.connectionrecovery.case.05"></a>
#### 预算耗尽

- **选择**：failed
- **触发与可观察结果**：给可执行下一步与保留上下文
- **失败、等待与恢复**：不自动延长预算。

### 键盘、焦点、触摸与读屏

恢复动作具名keyboard/touch；状态不只dot；reader受影响任务与下一步；不每重连抢焦点。

### 图形、几何与动效

局部Alert/Result按scope，不能全页无差别blocked；真实进度或BusyLabel；不伪倒计时。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

同站可用跨站不可用、身份失效、目录不全、断网、重试预算耗尽。

Runtime Owner管重连/backoff和日志；UI不新建网络栈；卸载不结束共享恢复；计时读owner。

### 自有公共合同形状

scope/readinessView/failureView/retryBudget/asOf/recoveryActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.notificationitem"></a>
## NotificationItem

合同 ID：`ui.spec.notificationitem`。来源记录：[NotificationItem](../component-catalog.md#ui.requirement.notificationitem)。

### 意图、选择与边界

通知对象及其实际可执行动作。消息跳转、关系请求、审批；读状态和处理状态分离。相邻选择：普通 toast 不入通知真源。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.notificationitem)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Identity/Title/Reason/Time/ReadState/BusinessState/ActionOrDestination；二种状态分开。

Notification Owner管阅读；业务Owner管实际处理。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=message/relationship/approval/system；必选。
- read=unread/read；真实通知阅读状态。
- business=actionable/handled/expired；独立业务投影。

禁止：标已读=批准、重复canonical决策、已删目标空白跳转、隐私内容预览泄漏。

### 状态转换与可执行恢复

阅读→read receipt；action→对应业务决定；读通知不代表处理；过期/别端处理显示真结果。

### 具体使用场景

<a id="ui.spec.notificationitem.case.01"></a>
#### 消息通知

- **选择**：message
- **触发与可观察结果**：导航真实会话
- **失败、等待与恢复**：失效目标说明保来源。

<a id="ui.spec.notificationitem.case.02"></a>
#### 关系请求

- **选择**：relationship
- **触发与可观察结果**：复用RelationshipRequestItem
- **失败、等待与恢复**：任一面处理同步终态。

<a id="ui.spec.notificationitem.case.03"></a>
#### 权限请求

- **选择**：approval
- **触发与可观察结果**：进入真实PermissionDecision
- **失败、等待与恢复**：阅读不能批准。

<a id="ui.spec.notificationitem.case.04"></a>
#### 系统提示

- **选择**：system
- **触发与可观察结果**：读原因和合法下一步
- **失败、等待与恢复**：过期通知不得仍操作旧请求。

### 键盘、焦点、触摸与读屏

导航与决策actions分开，keyboard/touch可用；reader未读、原因、待处理；不靠颜色。

### 图形、几何与动效

Identity/summary/time/actions共轨；关系请求用canonical30 DecisionPair；不是每kind手造不同按钮。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

旧通知、重复事件、无权内容、已删目标、长标题与批量读。

Notification owner管集合/已读；domain管业务；row回收不改状态；别账号scope清理。

### 自有公共合同形状

notificationId/kind/readView/businessRef/businessView/destination/actionViews。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.navigationshell"></a>
## NavigationShell

合同 ID：`ui.spec.navigationshell`。来源记录：[NavigationShell](../component-catalog.md#ui.requirement.navigationshell)。

### 意图、选择与边界

统一桌面入口与全局设置。Desktop 首入口、workspace 切换、全局 Settings、移动适配。相邻选择：不默认进入某个 Agent 页面。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.navigationshell)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

DesktopEntry/GlobalNavigation/WorkspaceSwitcher/PageHost/GlobalSettings/StatusRegion。

Kernel/PageHost/Route Owner管启动和alive；UI管Shell。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- platform=desktop/mobile/browser；必选适配，职责不对称。
- scope=global/workspace；global入口长期稳定。
- readiness=boot/login/page-capability；由Kernel分层供。

禁止：Settings嵌Agent工作区、每路由重boot、跨账号投影残留、Mobile声称Desktop独占能力。

### 状态转换与可执行恢复

Kernel boot→entry→选择workspace/page；账号切换重新绑定投影；global Settings保持全局；page loading不等Shell坏。

### 具体使用场景

<a id="ui.spec.navigationshell.case.01"></a>
#### 首次进入

- **选择**：Desktop entry
- **触发与可观察结果**：看到桌面与全局入口
- **失败、等待与恢复**：未登录给清楚身份动作。

<a id="ui.spec.navigationshell.case.02"></a>
#### 切换工作区

- **选择**：scope
- **触发与可观察结果**：明确新scope与保留全局Settings
- **失败、等待与恢复**：旧draft按owner政策保存。

<a id="ui.spec.navigationshell.case.03"></a>
#### 打开设置

- **选择**：global
- **触发与可观察结果**：任何page可达同全局Settings
- **失败、等待与恢复**：不造每module独立入口。

<a id="ui.spec.navigationshell.case.04"></a>
#### 移动适配

- **选择**：mobile
- **触发与可观察结果**：通信与可靠性任务优先
- **失败、等待与恢复**：Desktop管理能力缺口明确。

<a id="ui.spec.navigationshell.case.05"></a>
#### 局部故障

- **选择**：page-capability
- **触发与可观察结果**：受影响页恢复，Shell仍导航
- **失败、等待与恢复**：不整app空白。

### 键盘、焦点、触摸与读屏

landmarks/skip main；route焦点主标题；touch平台导航；keyboard全局命令registry；reader当前workspace。

### 图形、几何与动效

Desktop类桌面入口，不默认落Agent页；全局nav与main轨；Mobile功能适配不强像素复制。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

无身份、多workspace、离线、插件失效、窗口很窄、soft keyboard。

Boot Kernel/Runtime/PageHost持生命周期；Shell只投影与路由；不页面自己启动服务。

### 自有公共合同形状

kernelView/navigationModel/workspaceView/pageHost/globalSettingsDestination/platformPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.applettile"></a>
## AppletTile

合同 ID：`ui.spec.applettile`。来源记录：[AppletTile](../component-catalog.md#ui.requirement.applettile)。

### 意图、选择与边界

应用入口对象。已安装/可打开/更新/权限异常；固定动作。相邻选择：不把 applet 当网页链接拼图。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.applettile)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Icon/Name/Purpose/InstallOpenStatus/PrimaryIntent/More；应用入口实体。

Applet/Host Owner管安装服务和权限；UI管入口。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- state=not-installed/installing/ready/update-available/blocked/failed；真实。
- action=install/open/manage；按state。
- placement=desktop/catalog；默认 desktop已安装，catalog候选。

禁止：图标click即已启动、默认强制安装、未绑定服务假ready、tile建第二Host。

### 状态转换与可执行恢复

install→pending→ready/failed；open Host确认后进入applet；update另意图；权限blocked不假可打开。

### 具体使用场景

<a id="ui.spec.applettile.case.01"></a>
#### 已安装入口

- **选择**：ready
- **触发与可观察结果**：打开真实Host session
- **失败、等待与恢复**：启动失败给恢复。

<a id="ui.spec.applettile.case.02"></a>
#### 未安装应用

- **选择**：catalog
- **触发与可观察结果**：读用途后安装
- **失败、等待与恢复**：失败不冒已安装。

<a id="ui.spec.applettile.case.03"></a>
#### 有更新

- **选择**：update-available
- **触发与可观察结果**：独立更新动作与后果
- **失败、等待与恢复**：不挡仍合法旧版使用。

<a id="ui.spec.applettile.case.04"></a>
#### 权限异常

- **选择**：blocked
- **触发与可观察结果**：说明当前不能做什么
- **失败、等待与恢复**：用户可进管理而非死tile。

### 键盘、焦点、触摸与读屏

具名主入口与more独立；keyboard/touch；reader名字、用途、状态；不能靠图标猜。

### 图形、几何与动效

tile沿Grid/Card共同轨；icon自有或合法Brand资产；状态不覆盖名字。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

名称长、缺icon、服务未绑定、更新中、manifest失效和权限撤回。

Applet Host管session/service；tile不加载业务服务；资源handle释放；unmount不卸载应用。

### 自有公共合同形状

appletId/manifestView/hostReadiness/installView/updateView/actionCapabilities。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.resourceusage"></a>
## ResourceUsage

合同 ID：`ui.spec.resourceusage`。来源记录：[ResourceUsage](../component-catalog.md#ui.requirement.resourceusage)。

### 意图、选择与边界

解释成本/额度及其影响。token/费用/上下文容量/资源上限；unknown/stale。相邻选择：一般数值用 Metric。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.resourceusage)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

MetricValues/Units/Period/Limit/AsOf/Impact/NextAction；费用和上下文容量不同指标。

Usage/Billing/Agent Owner管度量阈值；UI管解释。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- metric=tokens/cost/context/resource-limit；必选。
- data=known/estimated/stale/unknown；默认 unknown。
- impact=informative/warning/blocked；业务阈值供。

禁止：tokens直接换真实费用、unknown=0、计数超阈值私自阻任务、颜色唯一。

### 状态转换与可执行恢复

usage投影变化→显示asOf与影响；estimate不装实账；limit reached按实际能力阻断，不UI自猜。

### 具体使用场景

<a id="ui.spec.resourceusage.case.01"></a>
#### 本月用量

- **选择**：known tokens
- **触发与可观察结果**：单位/期间/asOf明确
- **失败、等待与恢复**：未到账说明陈旧。

<a id="ui.spec.resourceusage.case.02"></a>
#### 费用估计

- **选择**：estimated cost
- **触发与可观察结果**：显示估算与币种
- **失败、等待与恢复**：不写实际账单。

<a id="ui.spec.resourceusage.case.03"></a>
#### 上下文容量

- **选择**：context
- **触发与可观察结果**：显示可知占用和影响
- **失败、等待与恢复**：压缩由Agent owner决定。

<a id="ui.spec.resourceusage.case.04"></a>
#### 额度阻断

- **选择**：blocked
- **触发与可观察结果**：说明影响任务和合法调整
- **失败、等待与恢复**：不暴露技术参数作唯一解决。

### 键盘、焦点、触摸与读屏

reader单位、期间、估算/旧值与受影响任务；details/调整可keyboard/touch；图不能独占信息。

### 图形、几何与动效

Metric数字同轨、unit完整；Progress只可量化容量；无跑数造紧迫。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0、未知limit、多币种、折扣计费、异步到账、context压缩与超过上限。

Usage runtime管计费与容量；UI不重复算token；订阅释放；asOf来自数据。

### 自有公共合同形状

metricId/valueView/unit/period/limitView/asOf/impact/recoveryActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.onboardingflow"></a>
## OnboardingFlow

合同 ID：`ui.spec.onboardingflow`。来源记录：[OnboardingFlow](../component-catalog.md#ui.requirement.onboardingflow)。

### 意图、选择与边界

跨组件的引导完成旅程。创建身份→绑定设备→进入 Desktop；可回退/恢复。相邻选择：单项帮助用 GuideStep。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.onboardingflow)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Goal/StepProgress/CurrentTask/PreservedInputs/Recovery/SkipIfAllowed/FinishEntry。

Journey/Auth/Device Owner管完整流程；UI管步骤协调。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- entry=new-user/resume/add-device；必选。
- step=required/optional；由Journey契约。
- finish=durable-readback；固定不靠点击完成。

禁止：点击Next=完成、跳必需安全检查、每步独立无协同、退出清所有身份数据。

### 状态转换与可执行恢复

创建身份→验证/绑定→进入Desktop；可回退只影响允许步骤；中断恢复从真实已完成状态，不重新发安全操作。

### 具体使用场景

<a id="ui.spec.onboardingflow.case.01"></a>
#### 首次身份

- **选择**：new-user
- **触发与可观察结果**：创建后真实回读才能下一步
- **失败、等待与恢复**：失败保安全字段。

<a id="ui.spec.onboardingflow.case.02"></a>
#### 添加设备

- **选择**：add-device
- **触发与可观察结果**：扫码批准后确认绑定
- **失败、等待与恢复**：无相机标能力边界。

<a id="ui.spec.onboardingflow.case.03"></a>
#### 中断恢复

- **选择**：resume
- **触发与可观察结果**：显示已完成与下一项必要任务
- **失败、等待与恢复**：不重复创建身份。

<a id="ui.spec.onboardingflow.case.04"></a>
#### 跳可选介绍

- **选择**：optional
- **触发与可观察结果**：跳教学进入真实Desktop
- **失败、等待与恢复**：不能跳必要授权。

<a id="ui.spec.onboardingflow.case.05"></a>
#### 完成入口

- **选择**：finish
- **触发与可观察结果**：可做首个实际任务
- **失败、等待与恢复**：不以庆祝页代有用结果。

### 键盘、焦点、触摸与读屏

每步标题焦点，输入IME/触摸键盘完整；skip明确原因；reader当前位置/等待/错误；不自动跳审批。

### 图形、几何与动效

一致Shell与Form/Steps，教程不另起孤立产品；normal切步保输入，reduced稳定。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

新旧身份、断网、无相机、期限过、退出重开、跨设备与可选步骤。

Onboarding runtime保存安全允许draft与progress；秘密按Credential政策；退出资源由session finalizer。

### 自有公共合同形状

journeyId/entry/stepGraph/progress/taskViews/resumeRef/finishDestination。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.settingrow"></a>
## SettingRow

合同 ID：`ui.spec.settingrow`。来源记录：[SettingRow](../component-catalog.md#ui.requirement.settingrow)。

### 意图、选择与边界

全局设置的一项说明与控制。label/help/control/status 同轨；即时开关和表单明确。相邻选择：复杂组用 FieldGroup。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.settingrow)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Label/Help/Control/TrailingSaveStatus/optionalRecovery；一项设置一个意图。

Settings/Form Owner管值；UI管统一设置行。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- commit=immediate/form-draft；必选，Switch即时，Checkbox等可draft。
- availability=editable/policy-locked；默认 editable。
- control=registered-semantic-control；必供，不万能任意DOM。

禁止：Switch等大表单才保存、readonly当disabled、每slot双ring、checking灰点无解释。

### 状态转换与可执行恢复

immediate edit→pending→confirmed/rollback；form-draft→dirty→Form save；unknown/checking有文字不中性dot。

### 具体使用场景

<a id="ui.spec.settingrow.case.01"></a>
#### 即时通知

- **选择**：immediate Switch
- **触发与可观察结果**：切换后保存状态明确
- **失败、等待与恢复**：失败rollback并可重试。

<a id="ui.spec.settingrow.case.02"></a>
#### 表单偏好

- **选择**：form-draft Checkbox
- **触发与可观察结果**：修改只dirty等待统一保存
- **失败、等待与恢复**：不toast称已保存。

<a id="ui.spec.settingrow.case.03"></a>
#### 复合地址

- **选择**：one FieldFrame
- **触发与可观察结果**：协议/host/status同意图
- **失败、等待与恢复**：错误由父frame统一。

<a id="ui.spec.settingrow.case.04"></a>
#### 策略锁定

- **选择**：policy-locked
- **触发与可观察结果**：当前值与原因可读
- **失败、等待与恢复**：合法解除路径独立。

<a id="ui.spec.settingrow.case.05"></a>
#### 未知状态

- **选择**：checking
- **触发与可观察结果**：文字说明检查中
- **失败、等待与恢复**：不画无含义灰点。

### 键盘、焦点、触摸与读屏

label关联control，help/error不重复；键盘与touch同命中；reader锁定原因/保存状态；control父frame唯一ring。

### 图形、几何与动效

label/help/control/status共享track；窄屏按同意图堆叠；pending占status槽不挤label。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长说明、复合地址、disabled、未知远端值、立即设置和大表单并存。

Settings runtime供confirmed/draft；row无第二Store；unmount不取消save；旧账号回调忽略。

### 自有公共合同形状

settingId/label/help/commitPolicy/controlContract/availability/saveView/recoveryActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

