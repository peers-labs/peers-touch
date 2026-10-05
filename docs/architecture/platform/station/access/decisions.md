# Station 接入生命周期 - 设计决策

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Identity and Access

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| SAL-D01 | 双端统一按语义和结果衡量 | accepted |
| SAL-D02 | 只维护当前接入契约 | accepted |
| SAL-D03 | 签名 Station identity + Access Gate 是唯一接入路径 | accepted |
| SAL-D04 | Federation governance 与普通客户端分离 | accepted |
| SAL-D05 | Relay 只属于基础设施 | accepted |
| SAL-D06 | 完整 E2E 与当前接口完整性共同决定完成 | accepted |

## SAL-D01：双端统一按语义和结果衡量

**Status**: accepted
**Date**: 2026-09-26

### Context

Desktop 与 Mobile 的宿主能力和 UI 结构不同，但必须向用户提供一致的接入结果。

### Decision

Desktop 与 Mobile 共享 capability ID、协议、状态、错误、作用域和持久结果。宿主
command 数量、组件结构和交互控件可以不同。

**Rationale**

代码镜像会把平台差异推入业务层；只对齐页面又无法约束协议和终态。

**Alternatives Considered**

- 完全同构代码：拒绝。
- 只做 UI 对齐：拒绝。

**Consequences**

需要 machine-readable applicability registry 与显式 platform exception。

---

## SAL-D02：只维护当前接入契约

**Status**: accepted
**Date**: 2026-09-26

### Context

多套接入 route、wire 或 parser 会产生无法判定的 owner 和失败语义。

### Decision

接入架构只维护当前 route、command、DTO、key、parser、test、fixture 和 schema。

**Rationale**

单一当前契约能消除双 owner，并让未知接口直接 fail closed。

**Alternatives Considered**

- 并行维护多套接入契约：拒绝。
- 由客户端猜测 wire shape：拒绝。

**Consequences**

客户端与 Station 必须使用同一 capability registry 和 protobuf schema。

---

## SAL-D03：唯一可信接入路径

**Status**: accepted
**Date**: 2026-09-26

### Context

网络可达性不能证明 Station 身份，客户端自定义接入流程也无法执行 Station policy。

### Decision

双端先验证签名 Station identity，再使用四个 protobuf Access Gate endpoint。
所有请求与响应只通过 generated codec。

**Rationale**

可达性不等于身份；多个入口会绕过 Station policy。

**Alternatives Considered**

- 增加未登记的备用入口：拒绝。
- 接收非 canonical wire shape：拒绝。

**Consequences**

客户端需要统一 generated decoder 与 typed error。

---

## SAL-D04：Federation governance 与客户端分离

**Status**: accepted
**Date**: 2026-09-26

### Context

普通客户端需要 Federation context 完成业务操作，但不拥有 Station membership
与 topology 的治理职责。

### Decision

普通客户端只消费或选择 Station 已提供的 Federation context。create/join/leave/
delete/member-station 属于 Dashboard/CLI 运维面。本决策接受后 supersede
Federation D-05 的 Settings Join/Leave 条款。

**Rationale**

Federation membership 是 Station 拓扑治理，不是普通用户高频任务。

**Alternatives Considered**

- 给 Mobile 补齐治理 UI：拒绝。
- 删除所有治理 API：拒绝，运维仍需真实 consumer。

**Consequences**

Desktop Federation 设置页收缩为 context 与状态。

---

## SAL-D05：Relay 只属于基础设施

**Status**: accepted
**Date**: 2026-09-26

### Context

Relay 的 token、mount 和 routing 属于 Station 连通性实现，不是普通客户端业务
概念。

### Decision

客户端不直接访问 Relay，不展示 token、mount、invite、seed 或 forwarding endpoint。
只消费 Station 提供的人类可理解连接诊断。

**Rationale**

Relay 没有普通客户端业务语义，暴露它会制造错误 owner 和安全面。

**Alternatives Considered**

- 把 Relay 作为高级设置：拒绝。

**Consequences**

Relay 操作只在 Station/运维文档和工具中出现。

---

## SAL-D06：E2E 与当前接口完整性共同完成

**Status**: accepted
**Date**: 2026-09-26

### Context

运行时结果和静态接口完整性证明不同风险，任一证据单独通过都不足以关闭模块。

### Decision

Desktop/Mobile 首次接入、恢复、切换、same/cross-Station context E2E 全部通过，
且 route、contract、owner 与双端 consumer 的正向 inventory 完整，模块才可完成。

**Rationale**

静态契约不能证明用户结果，E2E 也不能证明接口 inventory 完整。

**Alternatives Considered**

- 只运行 build/unit tests：拒绝。

**Consequences**

最终 Gate 必须基于同一精确源码和真实原生客户端。
