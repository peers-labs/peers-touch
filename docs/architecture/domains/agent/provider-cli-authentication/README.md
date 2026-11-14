# CLI 账号连接方案

> **Status**: accepted for implementation
> **Version**: v1.0
> **Created**: 2026-10-31 | **Updated**: 2026-10-31
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/station/app/subserver/agent/`

本方案已于 2026-11-01 获用户确认实施，并受同次确认的紧凑交互要求约束：
复用原 Desktop 配置方式，CLI 下拉项直接发起下载与安装，项背景显示真实进度，
不新增独立安装列表。共享服务仍由 Dashboard 管理，普通 Desktop 只消费模型。

本方案补齐“安装 CLI 后仍须自行寻找登录方式”的产品缺口。它定义可直接发起的
供应商登录、授权等待、鉴权检查、持久化、重新连接和断开连接。
生产实现进行中，供应商真实登录尚未闭环。当前有同一 Shell 与
Dashboard 联动的 drafting 交互线框，授权与调用均为模拟。

上游：[Provider 管理边界](../provider-control-plane.md)、
[共享安装与私有执行](../provider-managed-cli-install.md)。
本目录扩展现有 Agent Provider 能力，不登记为独立架构模块。
用户确认授权实施；模拟线框不构成供应商授权成功或真实消费证据。

文档按职责分开：

- [agentbox-adaptation.md](agentbox-adaptation.md)：用户指定 AgentBox 配置体验的源码核查、复用结构与 Station 适配合同。
- [lifecycle-contract.md](lifecycle-contract.md)：安装到用户调用的完整产品合同候选。
- [user-journey.md](user-journey.md)：独立使用流程候选。
- [wireflow.md](wireflow.md)：现有 Prototype Lib 中的可点击线框入口及未证明范围。
- [product-definition.md](product-definition.md)：用户结果、入口与范围。
- [experience-contract.md](experience-contract.md)：按钮、返回路径和可用性。
- [product-state-model.md](product-state-model.md)：可见状态与恢复。
- [vendor-evidence.md](vendor-evidence.md)：源码、官方资料和真实 CLI 探测。
- [design.md](design.md)：所有权、adapter、运行链路与资源边界。
- [data-model.md](data-model.md)：拟新增的合同与持久化。
- [decisions.md](decisions.md)：方案、替代项与代价。
- [integration.md](integration.md)：既有所有者接入及替换范围。
- [acceptance-matrix.md](acceptance-matrix.md)：必须实际证明的用户生命周期。
- [review.md](review.md)：草案审阅及尚未证明的可行性。

共享资源由管理员连接、个人资源由本人连接的边界保持。设备码、浏览器链接、回传码及凭据刷新由 adapter
适配，用户无需 SSH、打开服务器终端或寻找配置目录。
