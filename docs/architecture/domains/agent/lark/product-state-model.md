# 飞书助手 — 产品状态

> **Status**: draft
> **Version**: v1.3
> **Created / Updated**: 2026-10-18
> **Owner**: Agent / Channel

## 连接集合

持久工作区持有 `connections[] + selectedConnectionId`；新增 Dialog 持有一次性的
`creationSession`，不进入客户端持久化。

- `connections[]`：每项是独立 `LarkConnection`，不通过全局单例共享可变状态。
- `selectedConnectionId`：为空时展示名单，存在时只挂载对应详情。
- `creationSession.closed → editing → scan/checking → connecting → closed`：
  打开时从空值创建，成功只追加新连接并选中；关闭、取消或成功均销毁字段与 Secret。
- `collection.loading → ready(non-empty / empty) | failed`：只有 `ready(empty)` 可以
  显示空名单；`failed` 保留错误并允许重试。

单个连接状态为 `connected ↔ disabled`，故障链为
`connected → attention → connecting → connected`。
`attention` 保留身份、可选默认响应 Agent、会话偏好、自动化和个人授权状态；
修复只处理失败环节。`disabled` 停止新消息但保留全部对象。

托管扫码与已有应用校验都先取得 `AppIdentity`，再创建同一种 `LarkConnection`；
创建合同不携带 Agent。已有应用从名单进入时创建新连接，从详情进入时替换当前连接应用。
检查成功后才提交；失败保留原连接和输入，不得先破坏现有身份。

默认约束：非空集合恰有一个 `isDefault`。显式更换默认是集合级原子更新；
删除默认连接时，从剩余启用连接优先选出下一默认，若均暂停则选择首项。
删除连接只移除该连接对象，不删除 Agent 或 Lark 平台内容。

## 默认响应 Agent 与会话偏好

连接可以没有默认响应 Agent。配置或切换为原子更新：
`unconfigured | current(agent A) → changing → current(agent B)`。
失败时继续由 A 处理，不能出现无归属窗口。

会话偏好是连接下的独立映射：
`inherited default Agent / unresolved → explicit Agent → inherited default Agent / unresolved`。
新增、修改或删除某个映射不改变连接的默认响应 Agent。连接创建时不显示 Agent，
详情中的默认响应配置与会话级路由是两个后续步骤。

单个偏好生命周期：
`draft → active ↔ paused → removed`。
草稿与已保存对象分离；返回、刷新或保存失败不能丢失草稿。
同一会话只允许一个已保存对象，编辑保留原启停状态。

## 个人授权

`not connected → authorizing → connected → expired / revoked`

已连接后的增权是独立子状态：
`connected → authorizing additive scope → connected`。`requestedDomains`
只表示已经生效的授权域，`pendingDomains` 只表示本次待确认域。用户拒绝、
授权窗口过期或新增 scope 不可用时，清空 `pendingDomains` 并保留原
`requestedDomains`、token 与既有工作能力；只有显式撤权才清空整个个人授权。
`expiresAt` 只表示有效 grant 生命周期，device-flow 使用独立
`attemptExpiresAt`。取消首次授权会清理未完成 profile；取消增权只停止本次
device-flow，不登出既有 grant。

运行时分别投影 `accessExpiresAt` 与 refresh grant 的 `expiresAt`。Station
每 10 分钟以及启动时对 ready / needs-refresh profile 执行
`auth status --verify`，由 lark-cli 持锁刷新 access token；每次 requester
工具执行前也会完成同一校验。`needs_refresh` 是可恢复状态，不等价于
`expired`，不能直接创建新的 device-flow。只有 refresh grant 到期、身份变化
或显式撤权才进入重新授权。

个人授权与 Bot 连接正交。取消授权不会断开消息；连接故障也不会把个人授权投影给其他人。
权限失效会暂停依赖该身份的未执行动作；恢复后重新检查当前动作与预览。
已连接状态必须携带可识别账号；撤权经确认后进入 `not connected`。

每条 `/channel/*` 写接口拥有独立 request/response Proto；资源 message
可以复用，route response 不复用通用 `EmptyResponse` 或跨动作 response，
从而使 API ownership registry 能将 route、contract 与 truth owner 一一绑定。

## 自动化

`draft → confirmed → active → paused / failed / expired / cancelled`

创建前确认触发条件、执行 Agent、结果和接收方。
运行幂等键绑定一次触发；恢复投递不得重新执行 Agent 或工具。
依赖个人授权的自动化在授权失效时暂停，不借用其他成员身份。
已保存自动化可以编辑、试运行、暂停、恢复和删除；每次试运行记录
`never → running → delivered / failed` 及最近结果时间。

## 已有应用

`editing → invalid / checking → needs repair → checking → ready → confirmed`

非法或空凭据停留在 `invalid`，不能改变当前连接。`needs repair` 展示实际缺失项；
修复后重新检查。只有 `ready` 且用户确认后才原子替换当前应用。
替换保留默认响应 Agent、会话偏好、自动化和历史。App Secret 不进入客户端持久化；
Station 将其写入 `channel_secrets` 的信封加密密文，绑定只保存
`credential_secret_id`。稳定 KEK 允许服务重启后按 actor、purpose 与 secret AAD
解密使用，明文不返回客户端。

## 测试投递

`idle → sending → delivered / failed → sending`

状态绑定接收人和一次消息 ID。失败重试同一测试意图，不重建连接；
已送达结果保留接收人、消息标识和时间，并允许再次发送新测试。

## 对话与交付

执行：`received → queued → running → waiting for user / completed / failed / cancelled`

投递：`pending → delivering → received / retryable failure / unknown`

执行完成与接收者获得结果分别持久化。投递恢复不能回到 `running`；
`unknown` 先核对外部结果。重复事件和重复点击返回同一任务的当前状态。

图片、文件和引用的解析结果必须绑定原消息来源。
不支持的内容进入明确的 `unsupported` 结果，不能伪装为成功。

## 多连接隔离

每个 `LarkConnection` 独立拥有身份、可选默认响应 Agent、会话偏好、自动化、个人授权、
应用、测试投递、草稿和活动。异步回调捕获发起时的 `connectionId`，
不得写入回调完成时恰好被选中的另一连接。
名单切换不重置对象；创建已有应用与扫码创建都只追加。
事件或定时触发后沿用请求人的资格、scope 和副作用合同。
故障或过窗保留原因；恢复不会补发无限积压或重复通知。

## 状态证据

产品状态由真实 owner 投影，不从“按钮已点击”或“SDK 已安装”推断。
原型按钮仅表达交互状态，生产全部状态仍是 UNPROVEN。
