# Chat 本机存储治理

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Device Messaging Engine
> **Module**: `packages/messaging-core/`, `apps/desktop/`, `apps/mobile/`

---

## 1. Document Scope

本文档集定义 Desktop 与 Mobile 当前设备上的 Chat 存储治理：

- Chat 总占用与按会话占用；
- 可再生成缓存清理；
- 永久、1 年、90 天、30 天四档保留周期；
- 按会话清理与真实物理回收；
- 从存储列表显式多选会话并批量清理；
- “为我删除”“撤回”与 Recovery 的一致结果；
- 旧 clear/restore、Desktop 本地删除 overlay、未落地 disappear timer 和伪统计清理。

本文档集不定义：

- Station Conversation authority 的保留或删除；
- 企业留存、法律保全、云端配额或归档；
- Station 接入、Access Gate、Federation 或 Relay；
- Browser 客户端。

## 2. 背景

当前消息正文和已关联附件长期保留，双端没有统一 TTL、容量统计或物理回收。现有
“清空聊天记录”只写 `cleared_at` 并在 24 小时内可恢复，不释放本机空间；
Desktop 与 Mobile 的单条删除终态也不一致。

本模块只解决一个具体产品问题：让用户看懂并治理当前设备上的 Chat 空间。

## 3. 设计目标

1. 总量来自 SQLCipher/WAL/SHM 与 Engine 托管文件的真实测量。
2. 用户能按联系人或群聊定位空间占用。
3. 清理动作明确区分缓存、当前设备、本人所有设备和所有参与者。
4. Retention 与清理不破坏投递、去重、crypto、草稿或活跃传输。
5. 普通同步和分页不恢复已跨过 sequence/hash floor 的旧明文。
6. 完成必须证明实际物理字节下降。
7. 批量清理复用单会话 owner，显式报告部分成功并保留失败项重试。

## 4. 文档导航

| 文档 | 说明 |
|---|---|
| [product-definition.md](./product-definition.md) | 产品能力、范围与非目标 |
| [benchmark-disposition.md](./benchmark-disposition.md) | 现代聊天存储体验取舍 |
| [experience-contract.md](./experience-contract.md) | 统计、清理、保留与消息动作 Journey |
| [product-state-model.md](./product-state-model.md) | 可见状态与失败恢复 |
| [acceptance-matrix.md](./acceptance-matrix.md) | 能力与 Gate 映射 |
| [design.md](./design.md) | Storage Governance Core、边界与流程 |
| [decisions.md](./decisions.md) | 关键设计决策 |
| [data-model.md](./data-model.md) | Proto、policy、floor、journal 与 tombstone |
| [integration.md](./integration.md) | 双端接入与旧行为硬切 |
| [legacy-inventory.json](./legacy-inventory.json) | Chat 存储遗产 matcher 与 owner |
| [execution-plans/20260926-chat-storage-governance/plan.md](./execution-plans/20260926-chat-storage-governance/plan.md) | 已完成的初始治理 Plan |
| [execution-plans/20260927-chat-storage-batch-clear/plan.md](./execution-plans/20260927-chat-storage-batch-clear/plan.md) | 批量清理后续 Plan |
| [reviews/review-01-product-architecture.md](./reviews/review-01-product-architecture.md) | 第一轮产品与架构审查 |
| [reviews/review-02-plan-readiness.md](./reviews/review-02-plan-readiness.md) | 第二轮计划与验收审查 |
| [reviews/review-03-batch-clear.md](./reviews/review-03-batch-clear.md) | 批量清理产品、架构与计划复审 |

## 5. 上游真源

- `docs/architecture/messaging-platform/`
- `docs/architecture/chat-lifecycle/`
- `docs/architecture/encryption/`
- `docs/client/chat/`

## 6. 当前状态

- Product：`PRODUCT_READY_FOR_ARCHITECTURE`
- Architecture：`DESIGN_READY_FOR_EXECUTION`
- Plan：批量清理后续 Plan 待持久化与绑定
- `CCU-20260922`：保持 `completed`
