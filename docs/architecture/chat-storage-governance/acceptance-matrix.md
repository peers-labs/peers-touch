# Chat 本机存储治理 - 验收矩阵

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Device Messaging Engine

---

## 1. 验收规则

- 所有 required capability 由当前精确源码完成 Desktop 与 Mobile 原生证明。
- source check、unit test、截图或接口回读不能单独替代 E2E。
- 清理前后读取真实文件/数据库字节，并验证可靠性状态未损坏。
- `compaction_pending` 不算物理回收成功。
- 任一旧符号在九个维度残留均失败。

## 2. Capability Crosswalk

| Capability | Journey | 当前差距 | Gate |
|---|---|---|---|
| CSG-C01 总览 | CSG-J01 | 无 Chat 真实空间统计 | CSG-G01 |
| CSG-C02 按会话占用 | CSG-J01/J04 | 无 per-conversation bytes | CSG-G01 |
| CSG-C03 缓存清理 | CSG-J02/J06 | 双端无统一入口和物理读回 | CSG-G02 |
| CSG-C04 保留周期 | CSG-J03/J06 | 无本机 TTL/floor | CSG-G03 |
| CSG-C05 会话清理 | CSG-J04/J06 | 当前只写 `cleared_at` | CSG-G04 |
| CSG-C06 删除语义 | CSG-J05/J06 | Desktop local-only，Mobile actor-hide | CSG-G05 |
| CSG-C07 回收与恢复 | CSG-J02-J06 | 无统一 journal/compact/Recovery redaction | CSG-G02-G06 |

## 3. Gates

### CSG-G00：Storage Contract

- 一个 Proto 定义 snapshot、policy、operation、result 与 typed errors。
- shared Core 是唯一治理 owner；双端 adapter 不重定义候选。
- legacy inventory 对全 scanRoots fail closed。

### CSG-G01：统计

- 总量来自 SQLCipher main/WAL/SHM 与 managed files。
- 类别不重复计数，system/shared 不伪分配。
- 双端展示相同分类与会话排序。
- 测量失败不回退 0 B，scope stale 结果不泄漏。

### CSG-G02：缓存清理

- 只清理 Engine-managed 可再生成 Chat cache。
- 消息、草稿、outbox、未 ACK inbox、crypto、active transfer 与导出文件保持。
- 中断后幂等恢复，结果包含实际释放量。

### CSG-G03：保留周期

- 四档策略在双端同义。
- 只删除已消费投影、FTS 与无引用媒体。
- floor 绑定 authority sequence/hash。
- 新消息、离线接收、重试、crypto 与 attachment transfer 保持。

### CSG-G04：按会话清理

- 该会话旧投影与无引用媒体被删除，其他会话/设备/参与者不受影响。
- 普通 sync/page 不恢复 floor 内明文，新消息继续进入。
- checkpoint/compact 后真实物理字节下降。
- 旧 `cleared_at` 与 24 小时 restore 零引用。

### CSG-G05：消息删除与 Recovery

- 双端都提交 canonical `HideMessageForActor`。
- Hide 对本人设备收敛，其他参与者不受影响。
- Retract 对参与者留痕，原内容不可访问。
- transaction 在 ACK 前完成，文件失败不阻塞 lane。
- 新 archive 不含 redacted 明文，restore 先 reconcile redaction。
- Desktop `deletedMessageUlids` 零引用。

### CSG-G06：零引用与聚合

- `disappear_timer_seconds`、伪 `statistics_get` 和受影响 compatibility schema 零引用。
- Desktop/Mobile、same/cross-Station、多设备、restart、fresh Recovery 全部通过。
- 九个维度无 allowlist suppression。

## 4. 必需运行单元

| Cell | 证明 |
|---|---|
| Desktop native | 统计、清理、retention、Hide/Retract 与物理读回 |
| Mobile native | 相同语义与结果 |
| Mixed same-Station | actor-hide 与新消息连续性 |
| Mixed cross-Station | retract、Recovery 与 authority sequence/hash |
| Same actor multi-device | “为我删除”跨本人设备收敛 |
| Fresh install/reset | 新 schema/archive 无旧兼容依赖 |

## 5. 完成条件

`CHAT_STORAGE_GOVERNANCE_ACCEPTED` 仅在 CSG-G00..CSG-G06 全部通过、所有 Task
为 `done`、`CCU-20260922` 保持 completed 且最终工作树干净时成立。
