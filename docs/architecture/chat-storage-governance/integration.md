# Chat 本机存储治理 - 集成与硬切

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Device Messaging Engine

---

## 1. 当前实现映射

| Concern | 当前入口 | 问题 | 目标 |
|---|---|---|---|
| Local schema | `messaging-core/schema.rs` + 双端 adapter | 无治理表，SQL 重复 | shared governance core |
| Clear history | Station member `cleared_at` | 只隐藏、24h restore、不释放空间 | device-local floor + delete |
| Delete for me | Desktop `deletedMessageUlids`；Mobile actor-hide | 双端终态不同 | canonical actor-hide |
| Disappear timer | Proto、Station model、Mobile adapter | 无产品入口或 worker | 全链路删除 |
| Chat cache | 双端 Engine media cache | 无统一入口和物理读回 | shared cache classification |
| Statistics | Desktop `statistics_get` 固定零值 | 伪数据且无 Chat owner | 删除或由真实 owner 重建 |

## 2. 保留的 Owner

- Conversation：消息、成员、interaction 与 authority log。
- Device Messaging Engine：设备加密、投递、SQLCipher projection 与附件。
- Messaging Recovery：完整加密 archive 与 restore。
- `packages/client-storage`：非 Chat Web cache envelope。

Storage Governance 只作为 Device Messaging Engine 的子模块。

## 3. Shared Rust

- `packages/messaging-core` 增加 accounting、retention、cleanup、journal 和 redaction。
- 收敛 Desktop `messaging/store.rs` 与 Mobile `messaging/adapter.rs` 的重复治理 SQL。
- 现有 delivery、crypto、attachment transfer 状态机保持原 owner。

## 4. Desktop

- Rust 注册 canonical `chat_storage_*` commands。
- Settings 增加 Storage section。
- Conversation Detail 复用同一 snapshot/clear contract。
- 删除固定零值 `statistics_get`；非 Chat 统计若需要，必须由独立 owner 重建。
- 删除 `deletedMessageUlids` 与本地终态。

## 5. Mobile

- Rust 注册同名、同 Proto contract 的 `chat_storage_*` commands。
- Settings 与 Chat Overlay 增加相同语义入口。
- `clearMobileCache` 继续只管理非 Chat Web cache。
- Chat media cache 只由 Storage Governance 清理。

## 6. 语义替换

| 旧行为 | 新行为 | 删除义务 |
|---|---|---|
| `cleared_at` + 24h restore | 当前设备 sequence/hash floor + 物理删除 | Proto、Station schema、UI、test、doc |
| Desktop `deletedMessageUlids` | `HideMessageForActor` | local store、filter、fixture |
| Hide 只设 boolean | tombstone + 明文/FTS/媒体清理 | 双端 transaction |
| Retract 只设 marker | marker + 内容缓存清理 | 双端 projection |
| disappear timer 骨架 | 无能力 | Proto、generated、Station、adapter |
| 固定零统计 | 真实 Chat snapshot | command/wrapper/test |

## 7. Baseline Schema

1. 更新 canonical CREATE schema。
2. 删除受影响的 `ALTER`、backfill、compat reader 和旧 archive reader。
3. 对获批开发环境删除旧数据库与缓存。
4. 从空目录创建 Desktop/Mobile 数据。
5. 新 archive 只写未清理内容、floor 与 tombstone。
6. 运行 fresh install、Recovery 与 mixed-client E2E。

不编写旧数据迁移，不保留 legacy version marker。

## 8. 删除证明

`legacy-inventory.json` 是完整 baseline matcher，不是 seed allowlist。实现 Task 先对
全 scanRoots 执行 matcher；新增命中扩展证据。命中只能删除，或证明为 canonical
retained capability 后从 inventory 修订；不得 allowlist 隐藏。

## 9. 文档同步

接受后同步：

- `docs/architecture/chat-lifecycle/`：移除 24 小时 clear/restore。
- `docs/architecture/messaging-platform/`：补充 device-local floor 与 cleanup。
- `docs/architecture/encryption/`：补充 Recovery redaction。
- `docs/client/chat/` 与双端平台文档：Storage UI 与消息动作。
- `docs/knowledge/`：补充治理 invariant，移除旧兼容知识。
