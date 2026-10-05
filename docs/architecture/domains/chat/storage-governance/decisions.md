# Chat 本机存储治理 - 设计决策

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Device Messaging Engine

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| CSG-D01 | 本机治理不改写 Station authority | accepted |
| CSG-D02 | 物理总量与会话归属分开计量 | accepted |
| CSG-D03 | Retention 保护可靠性状态并使用 sequence/hash floor | accepted |
| CSG-D04 | Shared Rust Core 唯一拥有治理语义 | accepted |
| CSG-D05 | Hide/Retract 先不可见化再 ACK | accepted |
| CSG-D06 | 删除旧 clear/restore、local overlay 与 disappear timer | accepted |
| CSG-D07 | 真实物理字节下降才算回收成功 | accepted |
| CSG-D08 | 完整 E2E 与九维零引用共同决定完成 | accepted |
| CSG-D09 | 批量清理串行编排 canonical 单会话命令 | accepted |

## CSG-D01：本机治理不改写 Station authority

**Status**: accepted
**Date**: 2026-09-26

**Context**

设备空间治理与共享 Conversation authority 的删除范围需要明确分离。

**Decision**

统计、retention 和会话清理只修改当前设备。Station authority log、其他设备和其他
成员不受影响。

**Rationale**

空间管理与共享业务删除是不同意图。

**Alternatives Considered**

- 清理时删除 Station 事件：拒绝。
- 写 actor-wide clear marker：拒绝。

**Consequences**

普通分页不能按会话重新下载已清理明文；完整加密 Recovery 独立存在。

## CSG-D02：物理总量与会话归属分开计量

**Status**: accepted
**Date**: 2026-09-26

**Context**

共享数据库页和索引无法稳定归属到单个会话，但用户仍需要可信的总量。

**Decision**

总量测真实文件；per-conversation 使用可归属逻辑字节；共享开销进入 system。

**Rationale**

SQLite 页、WAL 和共享索引无法准确分摊。

**Alternatives Considered**

- 只展示逻辑字节：拒绝。
- 比例分摊所有 DB 页：拒绝。

**Consequences**

会话之和不必等于总物理占用。

## CSG-D03：Retention 使用安全 floor

**Status**: accepted
**Date**: 2026-09-26

**Context**

按时间清理消息可能破坏投递、去重、恢复和加密连续性。

**Decision**

Retention 只删除已 durable consume 的投影，以 authority sequence/hash 提交 floor；
墙钟只用于候选选择。

**Rationale**

容量治理不能破坏投递、去重、恢复或加密连续性。

**Alternatives Considered**

- 按本机时间直接删整行：拒绝。
- 只做 UI 隐藏：拒绝。

**Consequences**

清理查询必须计算 dependency closure，并保护所有不确定项。

## CSG-D04：Shared Rust Core 唯一拥有治理语义

**Status**: accepted
**Date**: 2026-09-26

**Context**

Desktop 与 Mobile 的独立实现会造成 retention、cleanup 和 compact 语义漂移。

**Decision**

`messaging-core::storage_governance` 定义 accounting、retention、cleanup、journal
与 compact 条件；双端只提供平台 adapter。

**Rationale**

双端分别实现会再次产生语义漂移。

**Alternatives Considered**

- 两端独立实现：拒绝。
- TypeScript 直接扫描 SQLCipher/files：拒绝。

**Consequences**

共享 Core 不得引入第二个消息状态机。

## CSG-D05：Hide/Retract 先不可见化再 ACK

**Status**: accepted
**Date**: 2026-09-26

**Context**

ACK 与本机不可见化的提交顺序决定崩溃或 Recovery 后是否会恢复明文。

**Decision**

一个 transaction 内提交 tombstone、明文/FTS 删除、reference decrement、
consumption marker 与 cursor；commit 后 ACK，文件异步回收。

**Rationale**

ACK 早于本地不可见化会在崩溃或 Recovery 后复活内容。

**Alternatives Considered**

- 等全部文件删除再 ACK：拒绝，会阻塞 ordered lane。

**Consequences**

文件失败必须由 journal 重试，不能回滚 durable redaction。
actor-hide 只限制 projection mutation，不限制 authority event fanout；所有 active
endpoint 都必须按序提交该 event，非目标 actor 使用 observe-only commit 保持
authority head 连续。
in-place Recovery restore 必须保留当前 session 已绑定的 device identity，并在停止
worker 后把当前 endpoint 的 enrollment、SPK/OPK、MLS bootstrap inventory、lane
cursor、consumption markers、authority heads 与 retired checkpoints 从 live
SQLCipher store 直接转移到 staging。它们不得进入 archive 或跨设备复制；Direct
ratchet、MLS group/session/transition 与 pending command state 仍必须清除。

## CSG-D06：删除旧语义

**Status**: accepted
**Date**: 2026-09-26

**Context**

旧 clear/restore、local overlay 和未落地 timer 与当前设备治理目标冲突。

**Decision**

删除 `cleared_at`、24 小时 restore、Desktop `deletedMessageUlids`、
`disappear_timer_seconds` 与固定零值 Chat 统计链。

**Rationale**

这些路径要么不释放空间，要么双端终态不同，要么没有产品闭环。

**Alternatives Considered**

- 改造旧 clear：拒绝，其 actor-wide scope 与本机治理冲突。
- 顺便补齐阅后即焚：拒绝，超出范围。

**Consequences**

Chat Lifecycle 的旧 clear/restore 条款需被本模块明确取代。

## CSG-D07：真实字节下降才算成功

**Status**: accepted
**Date**: 2026-09-26

**Context**

逻辑删除和预计回收量不能证明设备已获得可用磁盘空间。

**Decision**

成功必须在 checkpoint/compact 后重新读取 SQLCipher main/WAL/SHM 与托管文件；
`compaction_pending` 只能是未完成。

**Rationale**

逻辑删除和预计回收量不能证明用户获得了可用磁盘空间。

**Alternatives Considered**

- 以 deleted row count 代替：拒绝。

**Consequences**

UI 同时展示估算、实际释放量和待压缩状态。

## CSG-D08：E2E 与零引用共同完成

**Status**: accepted
**Date**: 2026-09-26

**Context**

存储治理同时涉及运行时行为与旧路径删除，单类证据无法证明完整闭环。

**Decision**

双端原生、same/cross-Station、多设备、重启、Recovery 与物理字节 E2E 全部通过，
且九维遗产扫描为零，模块才可完成。

**Rationale**

行为证明与结构清理缺一不可。

**Alternatives Considered**

- 只运行 unit/build：拒绝。

**Consequences**

最终聚合必须基于同一精确源码。

## CSG-D09：批量清理串行编排 canonical 单会话命令

**Status**: accepted
**Date**: 2026-09-27

**Context**

批量选择需要复用已验证的单会话删除 owner，并明确部分失败与 scope 变化行为。

**Decision**

Desktop 与 Mobile 的批量清理是设备端 UI/runtime orchestration：冻结显式选择与
scope revision，按确定顺序串行调用 `chat_storage_clear_conversation`，并汇总
每项 canonical 结果。

**Rationale**

单会话命令已经拥有 immutable journal、sequence/hash floor、保护集、compact 与
物理读回。批量只是用户选择和结果聚合，不应新增协议、数据库事务或删除 owner。

**Alternatives Considered**

- 新增跨会话原子批量命令：拒绝；会扩大锁范围，并制造无法兑现的全有或全无承诺。
- 并发调用单会话清理：拒绝；会竞争 cleanup lease 与 compact。
- UI 直接删除投影：拒绝；绕过 shared Core。

**Consequences**

批量允许部分成功。已成功项保持提交；失败项保留选择供重试。scope 变化时停止
未开始项，双端必须使用相同状态与结果语义。
