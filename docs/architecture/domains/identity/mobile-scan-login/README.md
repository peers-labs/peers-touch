# Mobile Scan Login

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

手机扫描已登录 Desktop 的二维码，自动取得接入材料，经设备授权后进入同一
Station、同一 Actor 账号。允许两端使用不同网络路线。

这是获用户条件执行授权并经源码审查的目标产品与架构合同。源码基线为
`b6e481c69b718c40644fe3c922a1a73daa38ca16`，源码位于 `feat/mobile-scan-login`。
本文不构成原生验收结果；required 能力保持 `UNPROVEN`，直到对应证据成立。

## 阅读入口

- [架构设计](./design.md)：运行边界、网络引导、授权与安全。
- [协议与状态](./data-model.md)：二维码载荷、事务、恢复与资源限制。
- [架构决策](./decisions.md)：选型、代价与替代方案。
- [集成边界](./integration.md)、[模块归属](./module-layout.md)。
- [产品定义](./product-definition.md)、[交互合同](./experience-contract.md)、
  [可见状态](./product-state-model.md)、[验收合同](./acceptance-matrix.md)。
- [参考参数取舍](./benchmark-disposition.md)、[设计审查](./review.md)。
- [实施计划](./execution-plans/20261027-registered-device-link/plan.md)：
  垂直闭环、依赖、删除、验证预算与授权边界。
- [验证状态与剩余范围](./verification.md)。
- 通用能力的独立真源：[Schema](../../../shared/schema/README.md)。

## 上游约束

[Station Access](../../../platform/station/access/station-access-gate-architecture.md)、
[连接材料](../../../platform/runtime/node-connectivity/bootstrap-connection-material.md)、
[Node Connectivity](../../../platform/runtime/node-connectivity/design.md)、
[Actor 身份](../unified-actor-system.md)共同约束本设计。

UI 实现遵循本目录体验合同和已有 UI Identity；原型与原生证据分别验证。
active registry 已登记 Station 事务服务和共享加密core的真实消费路径。
Desktop/Mobile 已接入原生 owner；iOS 模拟器原生构建通过，业务验收仍未通过，
模块状态不构成产品 PASS。
