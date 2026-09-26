# Chat 本机存储治理 - 设计决策

> **Status**: draft
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Device Messaging Engine

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| CSG-D01 | 本机治理不改写 Station authority | proposed |
| CSG-D02 | 物理总量与会话归属分开计量 | proposed |
| CSG-D03 | Retention 保护可靠性状态并使用 sequence/hash floor | proposed |
| CSG-D04 | Shared Rust Core 唯一拥有治理语义 | proposed |
| CSG-D05 | Hide/Retract 先不可见化再 ACK | proposed |
| CSG-D06 | 删除旧 clear/restore、local overlay 与 disappear timer | proposed |
| CSG-D07 | 真实物理字节下降才算回收成功 | proposed |
| CSG-D08 | 完整 E2E 与九维零引用共同决定完成 | proposed |

## CSG-D01：本机治理不改写 Station authority

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

**Decision**

双端原生、same/cross-Station、多设备、重启、Recovery 与物理字节 E2E 全部通过，
且九维遗产扫描为零，模块才可完成。

**Rationale**

行为证明与结构清理缺一不可。

**Alternatives Considered**

- 只运行 unit/build：拒绝。

**Consequences**

最终聚合必须基于同一精确源码。
