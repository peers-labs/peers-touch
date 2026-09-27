# Chat 本机存储治理 - 验收矩阵

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Device Messaging Engine

---

## 1. 验收规则

- 所有 required capability 由当前精确源码完成 Desktop 与 Mobile 原生证明。
- source check、unit test、截图或接口回读不能单独替代 E2E。
- 清理前后读取真实文件/数据库字节，并验证可靠性状态未损坏。
- `compaction_pending` 不算物理回收成功。
- 任一旧符号在九个维度残留均失败。

## 2. Capability Crosswalk

| Capability | Journey | 当前基础 / 剩余差距 | Gate |
|---|---|---|---|
| CSG-C01 总览 | CSG-J01 | 双端已有真实空间统计 | CSG-G01 |
| CSG-C02 按会话占用 | CSG-J01/J04 | 双端已有 per-conversation bytes | CSG-G01 |
| CSG-C03 缓存清理 | CSG-J02/J06 | 双端已有统一入口和物理读回 | CSG-G02 |
| CSG-C04 保留周期 | CSG-J03/J06 | 已有本机 TTL/floor | CSG-G03 |
| CSG-C05 会话清理 | CSG-J04/J06 | 已切换为 sequence/hash floor | CSG-G04 |
| CSG-C06 删除语义 | CSG-J05/J06 | 双端已有 canonical hide/retract | CSG-G05 |
| CSG-C07 回收与恢复 | CSG-J02-J06 | 已有统一 journal/compact/Recovery redaction | CSG-G02-G06 |
| CSG-C08 批量清理 | CSG-J07 | 存储列表只能查看，会话清理入口分散 | CSG-G07 |

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

### CSG-G07：批量会话清理

- Desktop 与 Mobile 的存储列表都提供管理模式、逐项选择和全选当前搜索结果。
- 未选择会话时不能提交；确认面展示所选数量、预计可回收量和当前设备范围。
- 批量执行串行复用 canonical 单会话清理，不新增旁路删除或第二套持久状态。
- 全部成功显示成功数与实际释放量，并从快照中移除已清理占用。
- 注入一个单项失败时，已成功项保持删除，失败项保持选择且可重试。
- scope 切换停止剩余队列，旧结果不得进入新 scope。
- 双端原生 Journey 均证明至少两个会话的选择、确认、物理回收和重启后不复活。

## 4. 必需运行单元

| Cell | 证明 |
|---|---|
| Desktop native | 统计、清理、retention、Hide/Retract 与物理读回 |
| Mobile native | 相同语义与结果 |
| Mixed same-Station | actor-hide 与新消息连续性 |
| Mixed cross-Station | retract、Recovery 与 authority sequence/hash |
| Same actor multi-device | “为我删除”跨本人设备收敛 |
| Fresh install/reset | 新 schema/archive 无旧兼容依赖 |
| Desktop native batch | 存储列表多选、确认、进度、结果与重启后不复活 |
| Mobile native batch | 相同批量语义、窄屏操作和失败项重试 |

## 5. 完成条件

`CHAT_STORAGE_GOVERNANCE_ACCEPTED` 仅在 CSG-G00..CSG-G07 全部通过、所有 Task
为 `done`、`CCU-20260922` 保持 completed 且最终工作树干净时成立。
