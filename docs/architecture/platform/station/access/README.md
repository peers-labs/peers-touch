# Station 统一接入生命周期

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access
> **Module**: `apps/desktop/`, `apps/mobile/`, `apps/station/frame/touch/`

---

## 1. Document Scope

本文档集定义 Desktop 与 Mobile 从输入一个接入地址，到可信识别 Home Station、
完成 Access Gate 并启动业务 runtime 的完整生命周期：

- 同一个输入可解析为 Station 直连入口或 Relay 入口；
- Relay 入口自动发现候选 Station，客户端只展示连接方式差异；
- 签名 Station identity 是最终身份，Relay 不是业务或账号 authority；
- 一个按 `station_peer_id` 建模、可持有多个 route candidate 的客户端 binding；
- protobuf Access Gate、Station/Actor/Device scope 与 Federation context；
- 直连与 Relay 路由切换、恢复、撤销和双端一致验收；
- 接入能力、owner 和双端 consumer 的正向完整性；
- Desktop/Mobile 跨类别共存与同类别 Session 接管。

本文档集不定义：

- Federation Ledger、membership 与 Relay 内部传输实现，见
  [Federation Domain](../../../domains/federation/README.md)；
- Chat、Social、Agent 等业务 API；
- Relay invite、mount、证书或配额的普通客户端管理 UI；
- Browser 客户端。

## 2. 背景

现有客户端把用户输入直接当作 Station URL。Mobile 已验证签名 Station identity，
但要求输入 origin 等于 Station `canonical_origin`；Desktop registry 仍以 URL 为
主键，probe 使用未签名 health/bootstrap 信息。现有 Relay 只服务 Station 间转发，
没有客户端可用的安全接入协议。

因此“允许填写 Relay 地址”不能通过把现有 `/relay/forward/*` 暴露给客户端完成。
本模块把连接位置与 Station 身份拆开，同时复用现有 Access Gate 和业务 API。

## 3. 设计目标

1. 用户只面对一个“接入地址”输入，不预先选择 Station 或 Relay 类型。
2. 客户端自动验证 endpoint role，并最终固定签名 `station_peer_id`。
3. 直连和 Relay 共享同一个 Station binding、Access Gate 与业务 runtime。
4. Relay 传输对业务内容和 Station session credential 保持不可见。
5. 同 Station 换路只重启 transport；Station 身份变化才清理完整 scope。
6. 私有 Station 默认不进入 Relay 目录，只通过 Station 签发的连接材料发现。
7. 所有接入接口均由当前 capability registry 声明且拥有真实 consumer。
8. 同一 actor 每个 canonical client class 只保留一个 active Session。
9. Desktop 与 Mobile 以相同结果、错误、安全条件和持久状态验收。

## 4. 文档导航

| 文档 | 说明 |
|---|---|
| [product-definition.md](./product-definition.md) | 产品能力、范围和非目标 |
| [experience-contract.md](./experience-contract.md) | 直连、Relay、恢复与切换 Journey |
| [product-state-model.md](./product-state-model.md) | endpoint、route、identity 与 scope 状态 |
| [acceptance-matrix.md](./acceptance-matrix.md) | 能力、攻击面与 Gate 映射 |
| [design.md](./design.md) | Ownership、拓扑、协议与失败语义 |
| [decisions.md](./decisions.md) | 关键设计决策 |
| [data-model.md](./data-model.md) | endpoint、route binding 与 scope 数据模型 |
| [module-layout.md](./module-layout.md) | 目标模块布局与依赖方向 |
| [integration.md](./integration.md) | 当前实现证据、差距与切换策略 |
| [station-access-gate-architecture.md](./station-access-gate-architecture.md) | Access Gate 链的早期架构输入 |
| [station-access-gate-implementation-plan.md](./station-access-gate-implementation-plan.md) | Access Gate 实施记录 |
| [execution-plans/20261006-unified-relay-station-access-v8/plan.md](./execution-plans/20261006-unified-relay-station-access-v8/plan.md) | 当前已批准的 Relay 执行 Plan |
| [execution-plans/20261006-unified-relay-station-access-v7/plan.md](./execution-plans/20261006-unified-relay-station-access-v7/plan.md) | 已批准的 Plan Version；v7 补齐 SAL-REL-03 Dashboard source impact 的 formal Gate |
| [execution-plans/20261006-unified-relay-station-access-v6/plan.md](./execution-plans/20261006-unified-relay-station-access-v6/plan.md) | 已由 v7 替换；缺少 SAL-REL-03 Dashboard unit/web formal Gate |
| [execution-plans/20261006-unified-relay-station-access-v5/plan.md](./execution-plans/20261006-unified-relay-station-access-v5/plan.md) | 已由 v6 替换；缺少 SAL-REL-03 真实生产调用面与完整生成绑定写集 |
| [execution-plans/20261006-unified-relay-station-access-v4/plan.md](./execution-plans/20261006-unified-relay-station-access-v4/plan.md) | 已取消；因 `ACCEPTANCE_PLAN_DRIFT` 被 v5 替换 |
| [execution-plans/20261006-unified-relay-station-access-v3/plan.md](./execution-plans/20261006-unified-relay-station-access-v3/plan.md) | 已取消的 frozen v3；保留 sixwin exact-source Windows 编译与首次双角色运行快照 |
| [execution-plans/20261006-unified-relay-station-access-v2/plan.md](./execution-plans/20261006-unified-relay-station-access-v2/plan.md) | 已取消的 frozen v2；保留首次 sixwin exact-source 构建快照 |
| [execution-plans/20261006-unified-relay-station-access/plan.md](./execution-plans/20261006-unified-relay-station-access/plan.md) | 已取消的 frozen v1；保留历史快照，不再执行 |
| [reviews/review-03-unified-relay-product-architecture.md](./reviews/review-03-unified-relay-product-architecture.md) | 产品与架构 findings-first review |
| [reviews/review-04-unified-relay-plan-readiness.md](./reviews/review-04-unified-relay-plan-readiness.md) | Plan、安全与验收 readiness review |
| [reviews/review-05-unified-relay-plan-v2.md](./reviews/review-05-unified-relay-plan-v2.md) | sixwin 执行范围修订与 v2 readiness review |
| [reviews/review-06-unified-relay-plan-v3.md](./reviews/review-06-unified-relay-plan-v3.md) | Windows externalruntime 写集修订与 v3 readiness review |
| [reviews/review-07-unified-relay-plan-v4.md](./reviews/review-07-unified-relay-plan-v4.md) | externalruntime formal Gate inventory 修订与 v4 readiness review |
| [reviews/review-08-unified-relay-plan-v5.md](./reviews/review-08-unified-relay-plan-v5.md) | 当前 source impact formal Gate inventory 修订与 v5 readiness review |
| [reviews/review-09-unified-relay-plan-v6.md](./reviews/review-09-unified-relay-plan-v6.md) | Dashboard operator 与完整生成绑定写集修订的 v6 review |
| [reviews/review-10-unified-relay-plan-v7.md](./reviews/review-10-unified-relay-plan-v7.md) | Dashboard source impact formal Gate 修订的 v7 review |
| [execution-plans/20260926-station-access-lifecycle/plan.md](./execution-plans/20260926-station-access-lifecycle/plan.md) | 已完成的绑定 Plan |
| [execution-plans/20260929-desktop-oauth-preauth/plan.md](./execution-plans/20260929-desktop-oauth-preauth/plan.md) | Desktop OAuth 登录前回归修复 |
| [reviews/review-01-product-architecture.md](./reviews/review-01-product-architecture.md) | 第一轮产品与架构审查 |
| [reviews/review-02-plan-readiness.md](./reviews/review-02-plan-readiness.md) | 第二轮计划与验收审查 |

## 5. 上游真源

- `docs/architecture/access-gates/`
- `docs/architecture/engineering/api-governance/`
- `docs/architecture/domains/federation/`
- `docs/architecture/identity/`
- `docs/architecture/service-coordination.md`
- `docs/client/desktop/identity-lifecycle.md`

## 6. 当前状态

- 既有直连 Access Gate：已实现并验收。
- Product：`accepted`
- Architecture：`accepted`
- Lifecycle Plan：`completed`，3/3 Task 已关闭
- Desktop OAuth 回归 Plan：`completed`，SAL-OAUTH-01 已关闭
- Relay v8 Plan：Task 1-3 已关闭，Task 4 源码 checkpoint 已完成，运行态 Gate 待执行
- Mobile Infra/Chat 可用性 Plan：按独立 Run 跟踪
- `CCU-20260922`：保持 `completed`
