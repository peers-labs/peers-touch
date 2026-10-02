# Agent 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-02 | **Updated**: 2026-10-02
> **Owner**: Peers-Touch Agent Team

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| MCA-D14 | Home 工作状态由 Station 投影 | accepted |
| MCA-D15 | 使用统一能力清单与 Agent 绑定 | accepted |
| MCA-D16 | Station 管理能力操作，客户端执行本机 MCP | accepted |
| MCA-D17 | Connector 资源与 Agent 工具清单分离 | accepted |
| MCA-D18 | Evaluation 使用 Station 聚合 | accepted |
| MCA-D20 | 使用发布者签名 catalog 与权威读回 | accepted |
| MCA-D22 | 使用 Station-owned 能力场景控制面 | accepted |
| MCA-D23 | 单一场景控制面覆盖 ToolCall、MCP 与 Connector | accepted |

## MCA-D14: Home 工作状态由 Station 投影

**Status**: accepted
**Date**: 2026-08-17

### Context

Agent readiness、会话和任务若由页面分别推导会产生互相矛盾的状态。

### Decision

Home 使用 Station-owned work projection，客户端只消费并呈现该投影。

### Rationale

单一业务真源允许多客户端与重启恢复得到一致结果。

### Alternatives Considered

由各页面独立拼装状态；该方案因无法保证 freshness 与一致性而拒绝。

### Consequences

Station 必须提供稳定身份和可重放投影，客户端不得持有替代权威状态。

## MCA-D15: 使用统一能力清单与 Agent 绑定

**Status**: accepted
**Date**: 2026-08-17

### Context

Builtin tool、Skill、MCP、Connector 与本机能力曾使用不同标识和 readiness 路径。

### Decision

所有能力通过版本化 manifest、Agent binding 和 readiness snapshot 接入。

### Rationale

统一合同使能力选择、降级、撤权和审计可以使用同一身份模型。

### Alternatives Considered

保留每类能力的私有绑定模型；该方案会持续制造分叉和重复治理。

### Consequences

能力不可绕过 binding/readiness 直接进入 Turn。

## MCA-D16: Station 管理能力操作，客户端执行本机 MCP

**Status**: accepted
**Date**: 2026-08-17

### Context

Desktop 拥有本机 MCP 进程与 secret，但客户端私有状态无法提供权威重放和恢复。

### Decision

Station 创建和推进 ToolCall；Desktop 在能力会话内执行 MCP 并回传 fenced receipt。

### Rationale

该边界同时保留本机资源所有权与 Station 业务权威。

### Alternatives Considered

全部由 Desktop 编排或把本机 secret 移交 Station；两者分别破坏恢复和安全边界。

### Consequences

执行回执必须具备 actor、device、attempt 和 ToolCall lineage。

## MCA-D17: Connector 资源与 Agent 工具清单分离

**Status**: accepted
**Date**: 2026-08-17

### Context

OAuth 连接、资源发现、工具同步、Agent 绑定与调用是不同生命周期。

### Decision

Connector owner 管理授权资源，Agent 只消费由其同步出的工具 manifest。

### Rationale

分离后可独立撤权、刷新和审计，而无需向 Agent 暴露 OAuth secret。

### Alternatives Considered

把 Connector 配置直接作为 Agent 工具；该方案混淆权限与执行状态。

### Consequences

Connector 失效必须使相关能力 readiness 失效并阻止新调用。

## MCA-D18: Evaluation 使用 Station 聚合

**Status**: accepted
**Date**: 2026-08-17

### Context

客户端直接运行 Evaluation 会绕过权威 Turn、数据集和结果生命周期。

### Decision

Evaluation run/result 由 Station 聚合，并复用 canonical Turn kernel。

### Rationale

统一 Turn 路径可以保留输入、模型、能力和结果的可追踪身份。

### Alternatives Considered

保留 Desktop `quickCompletion` 作为 Evaluation owner；该方案无法提供共享真源。

### Consequences

客户端只负责创建请求、观察进度和展示结果。

## MCA-D20: 使用发布者签名 catalog 与权威读回

**Status**: accepted
**Date**: 2026-09-17

### Context

Agent、Skill 与 MCP 发现需要可信来源，任意 URL JSON 无法证明发布者和安装状态。

### Decision

使用发布者签名的 catalog snapshot，并从目标 authority 读回安装与撤权状态。

### Rationale

签名验证建立来源信任，权威读回证明实际状态而不是页面乐观结果。

### Alternatives Considered

托管商业 Marketplace 或继续接受任意 JSON；均超出当前信任和产品边界。

### Consequences

Catalog transport 不得替代签名信任，安装证明必须来自目标 authority。

## MCA-D22: 使用 Station-owned 能力场景控制面

**Status**: accepted
**Date**: 2026-09-18

### Context

部分能力失败与竞态无法通过公开产品输入确定性触发。

### Decision

建立受限、run-scoped、非生产可用的 Station-owned Acceptance 场景控制面。

### Rationale

单一控制面能在不创建第二业务真源的前提下产生可复验失败证据。

### Alternatives Considered

在客户端加入 mock 分支或依赖随机故障；两者都不能形成可信正式证据。

### Consequences

场景必须绑定 run/actor、显式清理，并在生产配置中 fail closed。

## MCA-D23: 单一场景控制面覆盖 ToolCall、MCP 与 Connector

**Status**: accepted
**Date**: 2026-09-19

### Context

ToolCall、MCP 和 Connector 的错误、取消与竞态需要一致的执行身份和证据语义。

### Decision

扩展 MCA-D22 的同一控制面覆盖这些能力操作，不新增平行场景 authority。

### Rationale

共享 run、barrier、receipt 和 cleanup 合同可避免不同 Gate 形成相互冲突的真源。

### Alternatives Considered

为每类能力建立独立测试控制器；该方案会重复生命周期并削弱证据可比性。

### Consequences

所有场景必须证明零执行或一次执行边界，并保留完整 ToolCall lineage。
