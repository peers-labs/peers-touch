# Station 接入生命周期

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-29
> **Owner**: Identity and Access
> **Module**: `apps/desktop/`, `apps/mobile/`, `apps/station/frame/touch/`

---

## 1. Document Scope

本文档集定义普通 Desktop 与 Mobile 客户端从选择 Station 到业务 runtime 可用的
完整接入生命周期：

- 签名 Station identity 验证与固定；
- protobuf Access Gate 唯一登录路径；
- Station、Actor、Device scope 隔离；
- Federation context 的消费与选择；
- Relay 对普通客户端不可见；
- 接入能力、owner 和双端 consumer 的正向完整性。

本文档集不定义：

- Chat 消息、附件或本机存储治理；
- Federation topology、Ledger 或 Relay 的内部实现；
- Dashboard/CLI 运维体验；
- Browser 客户端。

## 2. 背景

Desktop 与 Mobile 当前共享签名 Station identity、protobuf Access Gate 和
Station/Actor/Device scope。该模块把这条接入链及其 Federation context
消费边界定义为单一当前真源。

本模块只治理“客户端如何可信进入一个 Station 并取得明确 Federation context”，
不扩张为通用客户端平台项目。

## 3. 设计目标

1. 双端只使用签名 Station identity 与 protobuf Access Gate。
2. Session、Messaging 与本地投影共享同一 Station/Actor/Device scope。
3. 普通客户端只消费 Federation context，不治理 Federation topology。
4. Relay 只属于 Station/运维基础设施。
5. 所有接入接口均由当前 capability registry 声明且拥有真实 consumer。
6. Desktop 与 Mobile 以相同结果、错误和状态验收。

## 4. 文档导航

| 文档 | 说明 |
|---|---|
| [product-definition.md](./product-definition.md) | 产品能力、范围和非目标 |
| [experience-contract.md](./experience-contract.md) | 首次接入、恢复与切换 Journey |
| [product-state-model.md](./product-state-model.md) | 用户可见状态与禁止状态 |
| [acceptance-matrix.md](./acceptance-matrix.md) | 能力与 Gate 映射 |
| [design.md](./design.md) | Ownership、拓扑、协议与失败语义 |
| [decisions.md](./decisions.md) | 关键设计决策 |
| [data-model.md](./data-model.md) | 接入协议、状态与 scope 数据模型 |
| [module-layout.md](./module-layout.md) | 目标模块布局与依赖方向 |
| [integration.md](./integration.md) | 当前实现映射与跨运行时集成 |
| [station-access-gate-architecture.md](./station-access-gate-architecture.md) | Access Gate 链的早期架构输入 |
| [station-access-gate-implementation-plan.md](./station-access-gate-implementation-plan.md) | Access Gate 实施记录 |
| [execution-plans/20260926-station-access-lifecycle/plan.md](./execution-plans/20260926-station-access-lifecycle/plan.md) | 已完成的绑定 Plan |
| [execution-plans/20260929-desktop-oauth-preauth/plan.md](./execution-plans/20260929-desktop-oauth-preauth/plan.md) | Desktop OAuth 登录前回归修复 |
| [reviews/review-01-product-architecture.md](./reviews/review-01-product-architecture.md) | 第一轮产品与架构审查 |
| [reviews/review-02-plan-readiness.md](./reviews/review-02-plan-readiness.md) | 第二轮计划与验收审查 |

## 5. 上游真源

- `docs/architecture/platform/station/access/`
- `docs/architecture/engineering/api-governance/`
- `docs/architecture/shared/federation/`
- `docs/architecture/domains/identity/`
- `docs/architecture/platform/runtime/service-coordination.md`
- `docs/client/desktop/identity-lifecycle.md`

## 6. 当前状态

- Product：`accepted`
- Architecture：`accepted`
- Lifecycle Plan：`completed`，3/3 Task 已关闭
- Desktop OAuth 回归 Plan：`completed`，SAL-OAUTH-01 已关闭
- `CCU-20260922`：保持 `completed`
