# Schema — Links and QR Codes

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Shared Client Interaction

按用户命名，Schema是通用链接、DeepURL与二维码能力。不是JSON Schema验证器，
不是登录server，也不是网络控制器。一个payload可以复制成链接、显示成标准码或
Peers风格码，安全与业务语义保持不变。

- [设计与组件参数](./design.md)
- [数据与codec合同](./data-model.md)
- [决策](./decisions.md)
- [集成与移除边界](./integration.md)
- [模块归属](./module-layout.md)
- 首个消费者：[Mobile Scan Login](../../domains/identity/mobile-scan-login/README.md)

实现位于 `packages/schema` 和 `packages/schema-core`。三个 Desktop QR 消费者
使用同一 renderer；旧导航 helper 与 `qrcode.react` 依赖已移除，两端 native
连接外壳及 Mobile deep-link 分类已接入 strict core。共享向量、独立 decoder
与浏览器 fixture 验证组件；原生相机和完整登录 Journey 仍需独立证据。
