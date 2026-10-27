# Mobile Scan Login — Ownership Map

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

## 目标模块

- `model/domain/auth/device_link.proto`：共享业务wire。
- Station `app/subserver/device_link/`：事务服务、仓储端口与handler；
  Station composition 注册一次，调用 `touch/auth` 的 Session 准备端口，
  不让 `touch/auth` 反向导入业务协调器，不另起登录server。
- `packages/device-link-core/`：共享客户端transcript、加密material验证和恢复语义；
  通过Host端口访问安全存储；不拥有Station事务或policy。
- Desktop `application/device_link/`：窗口/账号绑定、Tauri命令与密钥生命周期。
- Desktop `runtimes/deviceLinkRuntime.ts` 与 `store/deviceLink.ts`：仅持有可展示投影、
  调度可见面板的单flight读取，随原Session owner的activation fence撤销本地授权。
  全局Settings账号页按需挂载 `DeviceLinkPanel`，不在组件mount中创建offer或轮询。
- Mobile `runtime/device_link/`：原生扫码结果、Station验证、claim和ack。
  `mod.rs` 持久化与状态驱动，`intake.rs` 扫码/claim，
  `delivery.rs` 密文/证书/Session提交，`actions.rs` 准入提交/取消；
  `protocol.rs` 固定原路线的RPC，`projection.rs` 去秘密投影。
  `commands/device_link.rs` 只发布投影；`platform/qr_scanner.rs` 通过官方 Tauri
  Android CameraX/MLKit 与 iOS AVFoundation 实现接收载荷。
  `runtime/oauth/link_session.rs` 在现有 Session owner 内暂存及确认凭据，
  Messaging 的既有设备 seed backup 接收同安装实例的签名密钥。
- Mobile `runtimes/deviceLinkRuntime.ts` 与 `features/auth/deviceLinkStore.ts`：
  在 Station/auth 图之前恢复原生扫码事务；调度单 flight 状态读取。
  原 `mobileNativeEventBridge` 接收唤醒，页面不安装 listener 或轮询。
  `DeviceLinkScreen` 只展示账号、核对码和恢复操作；准入表单复用 `AccessGateHost`。
  确认后的路线进入原 Station registry，凭据由原 Session runtime 接纳，
  生命周期内核决定 PIN、critical runtime 和 Shell 准入。
- `packages/schema-core/` / `packages/schema/`：由独立Schema模块拥有。

布局遵循当前业务 subserver 与 frame 认证设施之间的调用方向。
Device Link不重复实现station-trust、libp2p、Session issuer或Actor Device仓储。

## 正向 registry 投影

模块ID `mobile-scan-login`，owner Identity and Access；
特征为protocol/stateMachine/persistence/ownership/moduleLayout/crossRuntime/integration。
requiredDocuments为README/design/decisions/data-model/module-layout/integration。

能力 `identity.device-link.authorize`：
contractRoots为auth Device Link proto；consumers为两个native runtime；
allowedDependencies为Schema、Node Connectivity、Access、Session、Actor Identity；
evidenceGates为MSL-A01—MSL-A09。它不拥有这些上游模块的路径。

Session owner接受按device的上游合同修订，但仍需其自身证据；
Device Link的MSL-A09证明多手机产品效果，不能替代Session索引/轮换/迁移验收。

registry 已登记实际 Station 服务、共享加密core、proto与已接受决策。
当前消费路径为 Station composition、共享core以及Desktop/Mobile native runtime；
Mobile 登录界面已有同真源消费路径；平台打包、相机及真实跨端验证仍须闭合。
`active`表示模块真源已存在，
不代表 MSL-A01—MSL-A09 产品证明。
