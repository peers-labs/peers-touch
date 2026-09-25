# Station 接入生命周期 - 设计决策

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Identity and Access

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| SAL-D01 | 双端统一按语义和结果衡量 | accepted |
| SAL-D02 | 零兼容硬切并重建干净基线 | accepted |
| SAL-D03 | 签名 Station identity + Access Gate 是唯一接入路径 | accepted |
| SAL-D04 | Federation governance 与普通客户端分离 | accepted |
| SAL-D05 | Relay 只属于基础设施 | accepted |
| SAL-D06 | 完整 E2E 与九维零引用共同决定完成 | accepted |

## SAL-D01：双端统一按语义和结果衡量

**Decision**

Desktop 与 Mobile 共享 capability ID、协议、状态、错误、作用域和持久结果。宿主
command 数量、组件结构和交互控件可以不同。

**Rationale**

代码镜像会把平台差异推入业务层；只对齐页面又无法约束协议和终态。

**Alternatives Considered**

- 完全同构代码：拒绝。
- 只做 UI 对齐：拒绝。

**Consequences**

需要 machine-readable applicability registry 与显式 platform exception。

## SAL-D02：零兼容硬切

**Decision**

没有正式用户与历史数据。切换时删除旧 route、command、DTO、key、parser、test、
fixture、doc 和 schema compatibility，并从干净数据基线启动。

**Rationale**

兼容层没有用户价值，只会制造双 owner。

**Alternatives Considered**

- 双路径观察期：拒绝。
- 读取旧 key 后迁移：拒绝。

**Consequences**

旧 Station 与新客户端不兼容；执行时需对精确开发环境另行授权重置。

## SAL-D03：唯一可信接入路径

**Decision**

双端先验证签名 Station identity，再使用四个 protobuf Access Gate endpoint。
删除 `/actor/login`、`auth_login`、legacy submission 与 JSON dual-form parsing。

**Rationale**

可达性不等于身份；多个入口会绕过 Station policy。

**Alternatives Considered**

- 保留 direct login fallback：拒绝。
- 继续接收多种 JSON shape：拒绝。

**Consequences**

客户端需要统一 generated decoder 与 typed error。

## SAL-D04：Federation governance 与客户端分离

**Decision**

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

## SAL-D05：Relay 只属于基础设施

**Decision**

客户端不直接访问 Relay，不展示 token、mount、invite、seed 或 forwarding endpoint。
只消费 Station 提供的人类可理解连接诊断。

**Rationale**

Relay 没有普通客户端业务语义，暴露它会制造错误 owner 和安全面。

**Alternatives Considered**

- 把 Relay 作为高级设置：拒绝。

**Consequences**

Relay 操作只在 Station/运维文档和工具中出现。

## SAL-D06：E2E 与零引用共同完成

**Decision**

Desktop/Mobile 首次接入、恢复、切换、same/cross-Station context E2E 全部通过，且
九维遗产扫描为零，模块才可完成。

**Rationale**

静态扫描不能证明用户结果，E2E 也不能证明旧 owner 已删除。

**Alternatives Considered**

- 只运行 build/unit tests：拒绝。

**Consequences**

最终 Gate 必须基于同一精确源码和真实原生客户端。
