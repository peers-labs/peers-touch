# Chat 本机存储治理 - 产品状态模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Device Messaging Engine

---

## 1. 存储总览

```text
unmeasured -> measuring -> ready
                    └----> stale_with_error -> measuring
```

- `unmeasured`：显示骨架，不显示 0 B。
- `measuring`：可显示上次快照并标记统计中。
- `ready`：显示真实总量、分类、会话列表和时间。
- `stale_with_error`：保留上次快照并允许重试。

快照按 `station_peer_id + actor_ptid + device_id + scope_revision` 隔离。

## 2. 清理操作

```text
idle
  -> estimating
  -> confirmation_required
  -> deleting
  -> compacting
  -> succeeded
```

异常：

```text
deleting -> failed_retryable -> deleting
compacting -> compaction_pending -> compacting
scope_changed -> paused_scope_inactive
```

- 删除开始前允许取消；开始后不提供撤销。
- DB transaction 成功后语义删除已完成。
- `succeeded` 必须有操作后实际物理测量。
- `compaction_pending` 不是物理回收成功。

## 3. 保留策略

```text
keep_forever | keep_365_days | keep_90_days | keep_30_days
  -> policy_saved
  -> pruning_scheduled
  -> pruning
  -> current
```

延长周期不会恢复已清理数据。普通历史分页不能越过已提交 sequence/hash floor。

## 4. 会话本机数据

```text
available
  -> clear_confirm_required
  -> sequence_floor_committed
  -> pruning
  -> cleared
  -> new_message
  -> available_current_only
```

会话身份、成员关系、authority head、crypto、可靠性状态和新消息始终保留。

## 5. 批量会话清理

```text
idle
  -> selecting
  -> confirmation_required
  -> clearing(current/total)
  -> succeeded
  -> partial_failure -> selecting_failed_only -> clearing
```

- `selecting` 只允许选择当前搜索结果中的会话；退出管理模式清空选择。
- `clearing` 冻结会话 ID 集合与 scope revision，执行期间禁止改变选择。
- `succeeded` 必须汇总每个会话的实际释放量。
- `partial_failure` 保留失败会话，已成功会话不得恢复或重复计入。
- scope 变化立即终止剩余队列并清除旧 scope 的选择与结果。

## 6. 单条消息

```text
visible
  -> hide_pending -> hidden_for_actor
  -> retract_pending -> retracted_marker
```

- `hidden_for_actor`：本人所有设备不可见。
- `retracted_marker`：参与者看到留痕。
- 两者都先 durable commit tombstone、内容不可见化、FTS 删除、consumption marker 与
  cursor，再 ACK；文件回收异步完成。

## 7. 禁止状态

- 页面显示成功但 journal 仍有未解释的 terminal failure。
- cache candidate 包含草稿、未 ACK inbox、密钥或 active transfer。
- 隐藏消息仍可由搜索或附件缓存访问。
- retention floor 内历史被普通 reconcile 恢复。
- 已删除内容从新 Recovery archive 复活。
- 批量清理未选择的会话，或把部分失败展示成全部成功。
- 旧 `cleared_at`、24 小时 restore、`deletedMessageUlids` 或
  `disappear_timer_seconds` 继续参与状态机。
