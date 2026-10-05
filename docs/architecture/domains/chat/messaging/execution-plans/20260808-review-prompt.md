# Messaging Platform — 独立评审提示

> **Status**: superseded by the approved
> [`../../../../engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md`](../../../../engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md)
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-08-10
> **Owner**: Messaging Platform Team

---

This prompt is retained as pre-consolidation review history. It must not be used
to select a public Messaging route or Station Messaging authority.

你是 Peers-Touch Messaging Platform 的独立产品、架构和执行计划评审者。请直接读取：

产品合同：

- `docs/architecture/domains/chat/messaging/product-definition.md`
- `docs/architecture/domains/chat/messaging/benchmark-disposition.md`
- `docs/architecture/domains/chat/messaging/experience-contract.md`
- `docs/architecture/domains/chat/messaging/product-state-model.md`
- `docs/architecture/domains/chat/messaging/acceptance-matrix.md`

架构合同：

- `docs/architecture/domains/chat/messaging/design.md`
- `docs/architecture/domains/chat/messaging/decisions.md`
- `docs/architecture/domains/chat/messaging/data-model.md`
- `docs/architecture/domains/chat/messaging/module-layout.md`
- `docs/architecture/domains/chat/messaging/integration.md`

执行计划：

- `docs/architecture/domains/chat/messaging/execution-plans/20260808-messaging-platform.md`

## 评审目标

判断该文档集能否约束 Peers-Touch 完整落地现代 Direct/Group IM，而不会再次出现：

- queue/ACK/crypto/persistence 分裂 ownership；
- acceptance 通过但用户不能即时看到精确明文；
- multi-device、recovery、MLS 或 Mobile 只存在骨架；
- 执行中引入 shim、dual runtime、fallback 或半迁移；
- 未完成时提前声称 usable。

## 评审维度

1. 产品能力和 journey 是否覆盖 Direct、Group、offline、restart、multi-device、
   revoke、recovery、federation、receipt、attachment 和 search。
2. SimpleX/Signal/Matrix disposition 是否有证据，是否错误照搬不适合 Peers 的模型。
3. owner/source-of-truth 是否唯一，是否还有 UI/Station/Engine 责任重叠。
4. authority sequence、device lane、claim lease、consumer fencing、ACK、replay、
   dedup、dead-letter 和 backpressure 是否完整。
5. Direct endpoint sessions、MLS device leaves、backup/restore 是否满足安全边界。
6. dependency DAG 是否正确，哪些 workstreams 可安全并行。
7. 每个替换是否有 atomic cutover 和 old-path deletion closure。
8. MP-C/J/S/A/D/W/G 追踪是否完整，是否存在未映射要求。
9. 每个 gate 是否从 receiver 视角可执行，是否会被 API-only/unit-only evidence 绕过。
10. 是否还有未定义的失败、取消、重启、过载、跨站或多窗口语义。

## 输出格式

```markdown
### 总体判断
[passed / conditionally passed / changes required]

### P0/P1 Findings
- ID、路径/章节、问题、影响、必须修改项

### Traceability Gaps
- 未映射 capability/journey/architecture/workstream/gate

### Ownership Or State-Machine Gaps
- owner 冲突、缺失状态、未定义失败语义

### Plan Gaps
- 依赖、切换、删除、证据或并行问题

### Required Changes Before Execution
- 按阻塞顺序列出

### Strongest Allowed Claim
- 当前文档最多支持的准确 readiness claim
```

评审者不得因为文档齐全而默认通过，必须交叉检查当前代码树和 benchmark source。无法
证明的结论标记 `UNPROVEN`。

## MP-D13 Amendment Review Record

`MP-D13` 已由 Owner 于 2026-08-08 接受。独立评审仍应验证：

1. public authority event + sorted opaque delivery commitments 是否同时保持：
   - shared `event_id` / authority hash chain；
   - endpoint-private ciphertext confidentiality；
   - required delivery set 的可审计性；
   - queue payload 到 authority acceptance 的密码学绑定。
2. commitment canonical input 是否必须加入 domain separator、固定整数编码和 protocol
   version，避免跨类型歧义。
3. event hash、endpoint payload hash、delivery commitment、queue payload hash 的验证
   顺序是否完整且 fail closed。
4. Direct 独立 ciphertext、Group 共享 MLS application ciphertext、无 private payload
   的 public facts 是否都能由同一 contract 表达。
5. 是否存在不暴露其他 endpoint identity、同时允许 fully-delivered aggregation 的更
   简洁方案。

若评审发现 commitment 无法同时满足 authority hash、endpoint privacy 和 payload
binding，必须重新打开 architecture gate；不得通过兼容 payload 或弱化验证绕过。

## MP-D23–MP-D25 Attachment Amendment Review

Owner 已于 2026-08-10 接受这三项；独立 reviewer 仍需验证：

1. Authority-hosted object 是否确实消除了 uploader Home Station ACL 与 conversation
   authority split-brain；remote Home streaming proxy 是否引入新的 durable truth。
2. message commit 时固化 recipient PTID grant，是否正确表达 removed actor 的历史
   可见性；是否存在必须按 endpoint、actor 或 membership epoch 授权的遗漏。
3. upload part `(upload_id, chunk_index)`、generation、chunk hash、whole hash 和 complete
   是否覆盖 duplicate、conflict、expiry、cancel、Station restart 与 orphan GC。
4. descriptor 的 suite/chunk/tag/nonce strategy/per-chunk commitments 是否足以让
   Desktop/Mobile 对同一 ciphertext 独立验证；2 GiB/2048 chunk policy 是否合理。
5. Range/If-Match/ETag、`206/416/412`、Home-to-Authority proxy cancellation 与
   backpressure 是否定义完整。
6. Engine SQLCipher message/attachment/FTS/marker/cursor/receipt transaction 是否保持
   ACK invariant；transfer checkpoint 与 decrypted cache 不进入 recovery 是否正确。
7. 是否仍有 filename、plaintext hash、key、nonce、query corpus 或 bearer URL 可能进入
   Station row/log/event/federation frame。
8. MP-G13/MP-G14 是否足以证明 upload/download resume、integrity、authorization、
   offline/restart/fresh recovery 和 exact local search，而不能被 one-shot/API-only
   evidence 绕过。

输出必须明确：

- `architecture valid`：accepted decisions 可继续约束 MP-W10；
- `changes required`：列出阻塞设计问题；
- `evidence blocked`：指出缺失的代码/运行时事实与可证伪 gate。

## MP-W10 Plan Amendment Review

评审 `MP-W10-A`–`MP-W10-E`：

1. W10-A proto/generation 是否确实在任何 Station/Engine consumer adaptation 之前。
2. W10-B Authority 与 W10-C Engine 是否在 A 后可独立并行，W10-D 是否正确等待两者。
3. W10-D 是否是 W08 attachment/trust recovery 的真实前置，而不是人为循环依赖。
4. W10-E 是否一次性切换 renderer consumers、删除 legacy attachment/search owners，
   且没有 fallback 或双 owner。
5. 每个 closure 是否包含 failure semantics、deterministic tests、native evidence 和
   explicit non-claim。
6. MP-G13/G14、100 MiB resume profile、Station secrecy scan 和 removed-actor grant gate
   是否覆盖 accepted MP-D23–MP-D25。

输出 `PLAN_READY_FOR_EXECUTION` 或列出必须修改的 dependency/gate/cutover 问题。
