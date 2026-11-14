# 群媒体决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-11-13 | **Updated**: 2026-11-13
> **Owner**: Chat Product Team

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| GC-D01 | 共享 Client Chat Core SDK 和生命周期，保留 Host auth/UI | accepted |
| GC-D02 | Direct/Group 共用设备 lease，取消后等待真实清理 | accepted |
| GC-D03 | device/session 绑定 grant 与初始无媒体权限 token | accepted |
| GC-D04 | 原权限 mutation fence 内完成 grant revoke 和 SFU eject | accepted |
| GC-D05 | 真实说明可信 SFU 传输保护；不伪称 MLS 媒体 E2EE | accepted |

## GC-D01: 单一 SDK 实现

**Status**: accepted
**Date**: 2026-11-13

### Context
Desktop 已有 SDK，Mobile 没有；这是源码事实。
### Decision
共享 provider/types/controller，Host 只注入原认证 join、ICE 和事件。
### Rationale
同一 SDK cleanup 与 track 语义不会跨客户端漂移。
### Alternatives Considered
复制 Desktop 实现会产生双 owner；自建 SFU 与既有合同冲突。
### Consequences
共享包增加 lazy media dependency；两端都要验证消费者。
Review condition：新平台不能实现现有 Provider 合同，应扩展原合同并全量验证。

## GC-D02: 媒体占用与取消

**Status**: accepted
**Date**: 2026-11-13

### Context
Direct 的 capture 可以在 reset 后迟到；Group 也会异步连接。
### Decision
先 reserve，失效 attempt 不能写新状态；清理完成后 release。
### Rationale
UI idle 必须意味着设备可重新捕获。
### Alternatives Considered
只检查 UI state 会在 pending capture 期间发生竞争。
### Consequences
清理慢时用户看到 leaving；不能强行显示成功。
Review condition：真实原生 cleanup 不能完成时保留失败与资源占用诊断。

## GC-D03: 媒体 admission

**Status**: accepted
**Date**: 2026-11-13

### Context
Actor-only 六小时 token 可以被移除端点重放。
### Decision
grant 绑定 canonical Session device；签名 token 初始无 publish/subscribe，
只有 Authority 验证 endpoint grant 后才通过 SFU 管理 API 开启权限。
### Rationale
token 可重放也不能自行恢复媒体权限。
### Alternatives Considered
TTL、客户端 heartbeat 或 unsigned webhook 无法证明授权。
### Consequences
grant 持久化及授权 callback 必需；callback 不可用时通话不能开始。
Review condition：SFU 实测若在初始禁权时仍能收发媒体，必须关闭该接入并修正 provider。

## GC-D04: 权限撤销

**Status**: accepted
**Date**: 2026-11-13

### Context
原 owner 有串行化权限 mutation 的事务 fence；现有 eject 无调用者。
### Decision
在这些 fence 内先撤销 grant 并确认 eject，再返回权限 mutation 成功。
### Rationale
现有连接与重放都受同一 permission truth 约束。
### Alternatives Considered
仅异步 outbox 或定时扫描会留出已撤销端点收听窗口。
### Consequences
SFU/Federation 不可达时撤销未成功并可重试；回滚可能保守断开合法端点。
Review condition：锁顺序竞争、restart、远端失败和 replay Gate 是必需证明。

## GC-D05: 隐私说明

**Status**: accepted
**Date**: 2026-11-13

### Context
原适配器没有 E2EE key provider；SFU transport 在 SFU 终止。
### Decision
UI 根据能力显示传输保护与可信 SFU 边界，不宣称 MLS 媒体 E2EE。
### Rationale
原型信任文案必须由真实能力驱动。
### Alternatives Considered
固定“已加密”会错误暗示服务端无法接触媒体。
### Consequences
SFU operator 是媒体信任边界；加密消息合同不受影响。
Review condition：后续启用客户端帧 E2EE 必须有 key/epoch/platform 独立合同与媒体证明。

## 架构评审记录

2026-11-13，当前 Agent 以独立 findings-first pass 评审：
发现原 token 重放、设备缺失、未等待 cleanup、伪 E2EE 声明、SSE 与 SDK owner 混淆；
上述决策分别约束这些问题。保留既有三导航与全量 M01–M15 North Star，
不生成新 Plan，不改变授权。目标设计已接受；实现、平台和权限竞争仍需实际 Gate。
