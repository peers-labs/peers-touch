# Station 接入生命周期

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
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
- 无历史用户前提下的旧登录、重复接口和客户端治理入口硬切。

本文档集不定义：

- Chat 消息、附件或本机存储治理；
- Federation topology、Ledger 或 Relay 的内部实现；
- Dashboard/CLI 运维体验；
- Browser 客户端。

## 2. 背景

已完成的 `CCU-20260922` 解决 Chat 双端主生命周期统一，不覆盖接入层。当前 Desktop
仍有 `/actor/login` 回退和普通用户 Federation 管理入口，Mobile 则使用签名
Station identity 与 Access Gate，形成第二套语义和多余实体。

本模块只治理“客户端如何可信进入一个 Station 并取得明确 Federation context”。
它不会继续扩张为通用客户端平台项目。

## 3. 设计目标

1. 双端只使用签名 Station identity 与 protobuf Access Gate。
2. Session、Messaging 与本地投影共享同一 Station/Actor/Device scope。
3. 普通客户端只消费 Federation context，不治理 Federation topology。
4. Relay 只属于 Station/运维基础设施。
5. 所有旧路径、别名、兼容解析、无消费者 wrapper 和旧测试归零。
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
| [integration.md](./integration.md) | 当前实现映射与硬切范围 |
| [legacy-inventory.json](./legacy-inventory.json) | 接入遗产 matcher 与 owner |
| [execution-plans/20260926-station-access-lifecycle/plan.md](./execution-plans/20260926-station-access-lifecycle/plan.md) | 已绑定并执行中的 Plan |
| [reviews/review-01-product-architecture.md](./reviews/review-01-product-architecture.md) | 第一轮产品与架构审查 |
| [reviews/review-02-plan-readiness.md](./reviews/review-02-plan-readiness.md) | 第二轮计划与验收审查 |

## 5. 上游真源

- `docs/architecture/access-gates/`
- `docs/architecture/api-ownership/`
- `docs/architecture/federation/`
- `docs/architecture/identity/`
- `docs/architecture/service-coordination.md`
- `docs/client/desktop/identity-lifecycle.md`

## 6. 当前状态

- Product：`accepted`
- Architecture：`accepted`
- Plan：`active`，当前 Task 为 `SAL-01-access-hard-cut`
- `CCU-20260922`：保持 `completed`
