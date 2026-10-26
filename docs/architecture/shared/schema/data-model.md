# Schema — Payload and Codec Contract

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Shared Client Interaction

通用wire定义于 `model/domain/schema/schema.proto`；具体业务payload仍由各自
auth/peer/domain proto拥有。外观参数是共享组件typed presentation合同，不进二维码。

## 链接类别

- `WebUrl`：传统HTTP(S)链接；保留URL语义，展示不等于自动打开。
- `NavigationLink`：当前`pt://`内部导航语法，单一registry映射owner。
- `ConnectionLink`：现有`peers-touch://connect#<base64url(proto)>`。
- `DeviceLink`：候选`peers-touch://device/link#<base64url(proto)>`，
  payload是inline offer或locator的生成oneof。
- `TypedAction`：`peers-touch://action/v1#<base64url(SchemaAction)>`，
  只接受非 Device Link 的注册动作，不能通过换 route 绕过 kind 分派。
- `PublicConnectionMaterial`：现有 `ptm1:` 外壳的 typed 公共连接材料；
  owner 仍必须验证来源、签名、实际 endpoint TLS 与 route。
- `OAuthCallback`：现有严格`peers-touch://oauth/callback?...`；
  分派专用OAuth owner，不通过普通nav/action执行。
- `ExternalProtocolQr`：指定 owner 的 presentation-only 字节输入，保留现有
  `peers-touch:safety/v1` 安全核对与频道 provider 语义；
  不进入导航、Device Link 或可执行动作 registry，Schema 不执行其内容。

Generic action使用protobuf typed envelope/descriptor registry。
若为扩展使用`Any`，type URL必须匹配固定构建期allowlist和目标owner；
payload由生成schema校验，再交给owner，不采用运行时下载schema、eval或反射执行。
Schema core只验外壳/类型/长度；业务签名、policy与副作用由owner再次校验。

## 解析规则

二维码/链接/粘贴输入均走相同strict codec。限制长度、编码层数与已知字段；
拒绝重复安全query、userinfo、模糊route、path traversal、未知action、
多重percent decode和嵌套引用。secret只放fragment或opaque body。

传统URL可包含它自己的query/path；Station discovery origin则由peer owner施加
只允许canonical origin的额外规则，不能用generic URL通过替代Station验证。

解析结果区分`recognized / malformed / unsupported`，不把所有失败回退为外部URL。
Schema不能将扫码来的可执行命令、file://或shell URI作为默认动作。
通用二维码可以编码文本URL，但“登录码”必须用registered DeviceLink格式。

## QR artifact

输出payload digest、版本/模块/ECC、quiet zone、logical dimensions、最终外观、
降级原因以及受scope控制的SVG/PNG handle。敏感payload仅由当前owner临时持有；
diagnostics和缓存key不得记录原二维码fragment。

同一个artifact改变头像/尺寸不会改变payload字节；自定义style只是标准QR表示。
图片blob独立限尺寸/类型并清理metadata，SVG导出嵌入受控资源，
禁止携带script、外部href或在导出时联网。
