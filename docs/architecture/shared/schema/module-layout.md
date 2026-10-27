# Schema — Module Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Shared Client Interaction

唯一归属：

- `model/domain/schema/schema.proto`：通用链接外壳，domain payload仍由domain拥有。
- `packages/schema-core/`：共享Rust strict parser、payload bounds与type registry；
  Desktop/Mobile native消费，不访问网络或store。
- `packages/schema/`：共享TS公开API、单引擎QRcodec、React组件、style profiles；
  不让页面直接导入底层QR依赖。
- Desktop/Android/iOS deep-link与camera adapter：OS输入/生命周期，非业务真源。

codecs由同一proto合同与统一test vectors约束；没有Rust/TS平行业务state machine。
React presentation只处理码图，签名与业务权限在Rust/domain owner。

正向registry ID `shared-schema`，owner Shared Client Interaction；
characteristics为protocol/ownership/moduleLayout/crossRuntime/integration，
stateMachine/persistence为false；requiredDocuments仍为六份架构文档。
能力 `client.schema.link`与`client.schema.qr`；contractRoots为Schema proto/package；
consumers为Desktop/Mobile/Prototype Lib；allowedDependencies为generated model与
单QR SDK/共享tokens；evidenceGates为链接向量、独立decoder和MSL-A07。

共享 TS/Rust codec、QR renderer 和现有消费者迁移已实现。协议生成由
`packages/schema/generate.mjs` 从 canonical proto 依赖闭包产生；不导入其他 app 的
生成产物。`packages/schema/qa/link-vectors.json` 是跨运行时的同一向量真源。
Rust client 集成与原生相机证据仍需完整运行验证；不从共享库检查推导登录可用。
