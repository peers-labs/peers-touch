# Chat 本机存储治理 - 体验契约

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Device Messaging Engine

---

## 1. Journey 索引

| ID | Journey | 能力 |
|---|---|---|
| CSG-J01 | 查看本机 Chat 存储 | CSG-C01-C02 |
| CSG-J02 | 清理可再生成缓存 | CSG-C03/C07 |
| CSG-J03 | 设置并执行保留周期 | CSG-C04/C07 |
| CSG-J04 | 按会话清理本机数据 | CSG-C02/C05/C07 |
| CSG-J05 | 为我删除或撤回消息 | CSG-C06-C07 |
| CSG-J06 | 清理中断、重启与 Recovery | CSG-C03-C07 |
| CSG-J07 | 从存储列表批量清理会话 | CSG-C02/C05/C07/C08 |

## 2. CSG-J01：查看存储

1. 用户进入“设置 > 存储”。
2. 页面显示上次完整快照并标记统计中；首次无快照时显示骨架，不显示 0 B。
3. 后台扫描后更新总占用、消息、媒体、缓存和系统数据。
4. 会话列表显示名称、类型、最近活跃、消息字节、媒体字节和合计。
5. 用户可按占用排序或搜索，并可进入管理模式选择会话。

统计失败时保留上次快照并允许重试。

## 3. CSG-J02：清理缓存

1. 用户查看可清理估算并确认。
2. Engine 冻结不可扩大的清理项。
3. 跳过草稿、密钥、可靠性状态、活跃传输和用户导出文件。
4. 删除托管缩略图与可重新下载媒体缓存。
5. 重新测量并显示实际释放量。

失败时显示已释放量与剩余失败项；重试复用同一 operation。

## 4. CSG-J03：保留周期

1. 用户选择永久、1 年、90 天或 30 天。
2. 设置只作用于当前 Station/Actor/Device scope。
3. 空闲 worker 按 authority committed time 选候选。
4. 删除 transaction 提交对应 sequence/hash floor。
5. 只删除已 durable consume 的投影、FTS 与无引用媒体。
6. 普通同步和分页不得越过 floor 恢复旧明文。

## 5. CSG-J04：按会话清理

1. 用户从存储列表或会话详情查看预计可释放空间。
2. 二次确认“清理此设备上的聊天数据”。
3. Engine 冻结已验证 authority high-water sequence/hash。
4. transaction 删除该边界内投影、FTS、已完成 transfer metadata 与 references。
5. 零引用托管文件异步删除，数据库在安全时机 compact。
6. 显示实际释放量；新高 sequence 消息继续正常进入。

开始删除后不提供 24 小时撤销。完整加密 Recovery 是独立显式流程。

## 6. CSG-J07：批量清理会话

1. 用户在“设置 > 存储”的会话列表进入管理模式。
2. 用户逐项选择，或全选当前搜索结果；隐藏在当前搜索结果外的会话不会被隐式选中。
3. 清理按钮展示已选数量；二次确认展示会话数、预计可回收空间和当前设备范围。
4. 客户端冻结所选会话 ID 与 scope revision，串行调用 canonical 单会话清理。
5. 执行中展示 `已完成/总数`，禁止修改选择或重复提交。
6. 全部成功时退出管理模式并显示成功数与实际释放量。
7. 部分失败时显示成功数、失败数与实际释放量，仅保留失败项供重试。
8. scope 变化时停止尚未开始的项目，不把旧 scope 结果写入新账号或设备。

批量操作不承诺跨会话原子性；每个会话仍由自己的 immutable journal、
sequence/hash floor 与 physical readback 决定成功。

## 7. CSG-J05：消息操作

### 为我删除

- 提交 actor-scoped `HideMessageForActor`。
- 本人各设备在本地 transaction 内写 tombstone、清明文/FTS、推进 cursor 后 ACK。
- 其他参与者不受影响。

### 撤回

- 仅作者按既有权限发起 ordered retract。
- 各参与者显示撤回占位，原明文与无引用媒体不可访问。
- 不把本地隐藏伪装成撤回成功。

## 8. CSG-J06：失败与恢复

| 故障 | 结果 |
|---|---|
| 进程被杀 | 从 immutable cleanup items 继续 |
| DB 已提交、文件删除失败 | 内容保持不可见，文件项重试 |
| compact 失败 | 显示 `compaction_pending`，不声称已物理释放 |
| Hide/Retract 文件回收失败 | transaction 后 ACK，文件异步重试 |
| Recovery restore | 先应用 floor/tombstone 并 reconcile authority redaction |
| scope 切换 | 旧 operation 暂停，结果不写入新 scope |
| 磁盘不足或 DB locked | 停止清理并保护可靠性状态 |
| 批量中单项失败 | 已成功项保持提交；失败项保留选择并允许重试 |

## 8. 禁止体验

- 测量失败显示 0 B 或清理成功。
- “清理缓存”删除消息、草稿或密钥。
- “清理本机数据”影响其他设备或参与者。
- 清理后普通同步立即恢复旧历史。
- `compaction_pending` 被展示成已释放空间。
- Desktop 与 Mobile 对同一删除动作产生不同终态。
- 未经显式选择即清理全部会话，或部分失败却显示为全部成功。
