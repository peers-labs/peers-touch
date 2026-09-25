# Chat 本机存储治理 - 数据模型

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Device Messaging Engine

---

## 1. Storage Contract

新增 `model/domain/chat/storage.proto`，只用于客户端跨进程契约，不注册 Station
business route。

```proto
enum ChatRetentionPreset {
  CHAT_RETENTION_PRESET_UNSPECIFIED = 0;
  CHAT_RETENTION_PRESET_FOREVER = 1;
  CHAT_RETENTION_PRESET_365_DAYS = 2;
  CHAT_RETENTION_PRESET_90_DAYS = 3;
  CHAT_RETENTION_PRESET_30_DAYS = 4;
}

message ChatStorageScope {
  string station_peer_id = 1;
  string actor_ptid = 2;
  string device_id = 3;
}

message ConversationStorageUsage {
  string conversation_id = 1;
  uint64 message_bytes = 2;
  uint64 media_bytes = 3;
  uint64 reclaimable_bytes = 4;
  int64 last_activity_unix_ms = 5;
}

message ChatStorageSnapshot {
  ChatStorageScope scope = 1;
  string revision = 2;
  int64 measured_at_unix_ms = 3;
  uint64 physical_total_bytes = 4;
  uint64 message_bytes = 5;
  uint64 media_bytes = 6;
  uint64 cache_bytes = 7;
  uint64 system_bytes = 8;
  uint64 reclaimable_bytes = 9;
  repeated ConversationStorageUsage conversations = 10;
}
```

计数均为非负 `uint64`。`physical_total_bytes` 必须来自真实文件 metadata。

## 2. Retention Policy

```sql
CREATE TABLE chat_storage_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retention_preset INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE chat_retention_floor (
  conversation_id TEXT PRIMARY KEY,
  pruned_through_sequence INTEGER NOT NULL,
  authority_event_hash BLOB NOT NULL CHECK(length(authority_event_hash) = 32),
  policy_cutoff_unix_ms INTEGER,
  reason TEXT NOT NULL CHECK (reason IN ('policy', 'manual_clear')),
  updated_at_unix_ms INTEGER NOT NULL
);
```

规则：

- 默认 `FOREVER`。
- manual clear 冻结当前已验证 authority high-water。
- retention 可按 authority `committed_at` 选候选，但提交 sequence/hash。
- floor 只在同一已验证 hash chain 上单调前进。
- policy 延长不会恢复已清理数据。
- conversation identity、authority head 与 crypto state 不进入 floor。

## 3. Cleanup Journal

```sql
CREATE TABLE chat_cleanup_journal (
  operation_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (
    scope_kind IN ('cache', 'conversation', 'retention', 'actor_hide', 'retract')
  ),
  conversation_id TEXT,
  scope_revision TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'planned', 'deleting_rows', 'deleting_files',
      'compacting', 'compaction_pending', 'paused_scope_inactive',
      'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled'
    )
  ),
  estimated_reclaimable_bytes INTEGER NOT NULL,
  physical_bytes_before INTEGER NOT NULL,
  physical_bytes_after INTEGER,
  last_error_code TEXT,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE chat_cleanup_items (
  operation_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (
    item_kind IN ('projection', 'fts', 'interaction', 'transfer', 'file')
  ),
  target_ref TEXT NOT NULL,
  expected_size_bytes INTEGER NOT NULL,
  expected_digest BLOB,
  state TEXT NOT NULL CHECK (
    state IN (
      'pending', 'deleted', 'skipped_protected',
      'failed_retryable', 'failed_terminal'
    )
  ),
  last_error_code TEXT,
  PRIMARY KEY(operation_id, item_id),
  FOREIGN KEY(operation_id) REFERENCES chat_cleanup_journal(operation_id)
);
```

候选在删除前冻结。重试复用 `operation_id + scope_revision + item_id`，不得重新查询
扩大范围。

## 4. Redaction Tombstone

```sql
CREATE TABLE message_redaction_tombstones (
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hidden_for_actor', 'retracted')),
  authority_sequence INTEGER NOT NULL,
  authority_event_hash BLOB NOT NULL CHECK(length(authority_event_hash) = 32),
  applied_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(conversation_id, message_id, kind)
);
```

Hide/Retract 的同一 transaction：

```text
tombstone
+ plaintext/edited_text 清空或 projection 删除
+ FTS 删除
+ attachment reference decrement
+ consumption marker
+ lane cursor
```

commit 后 ACK，文件 item 异步处理。

## 5. Byte Accounting

| 类别 | 来源 | 会话可归属 |
|---|---|---|
| message | projection、metadata、FTS、interaction | 是 |
| media | completed Engine-managed attachments | 是 |
| cache | thumbnail、redownloadable media | 是 |
| system | SQLCipher pages、WAL/SHM、shared index/journal | 否 |
| protected | outbox/inbox/crypto/dedup/active transfer | 不可清理 |

统计冻结 scope revision 并使用只读 DB snapshot。WAL passive checkpoint 后读取
main/WAL/SHM metadata；扫描期间新增字节进入下一次快照。

## 6. Deletion Closure

```text
message projection
  -> FTS row
  -> reactions / pins / read-detail projection
  -> attachment projection
  -> completed transfer metadata
  -> attachment reference decrement
  -> zero-reference managed file deletion
```

始终保留 compact tombstone、authority head、dedup 所需最小记录、active transport
与 crypto state。

## 7. Recovery

新 archive：

- 包含 retention floor 与 redaction tombstone；
- 不包含已清理或 redacted 的明文和 attachment metadata；
- restore staging 后先从 archive head reconcile 当前 authority redaction；
- 本模块不读取旧 archive schema，现有开发 archive 直接丢弃。

## 8. Error Model

| Code | 含义 | 可重试 |
|---|---|---|
| `STORAGE_SCOPE_STALE` | 结果属于旧 scope | 否 |
| `STORAGE_BUSY` | DB 或 cleanup lease 被占用 | 是 |
| `STORAGE_PROTECTED_STATE` | 候选含受保护状态 | 修正候选后 |
| `STORAGE_IO_FAILED` | 文件读取或删除失败 | 是 |
| `STORAGE_COMPACTION_PENDING` | 语义删除完成，物理压缩待重试 | 是 |
| `STORAGE_MEASUREMENT_PARTIAL` | 部分目录无法测量 | 是 |
| `STORAGE_INVALID_POLICY` | 非四档 policy | 否 |
