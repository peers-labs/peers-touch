# Messaging Platform — 设计决策

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-08-10
> **Owner**: Messaging Platform Team

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| MP-D01 | Device Messaging Engine 是设备协议唯一 owner | accepted |
| MP-D02 | Authority log 与 device queues 分离 | accepted |
| MP-D03 | 每设备有序 lane + at-least-once | accepted |
| MP-D04 | ACK 位于本地 durable consumption 之后 | accepted |
| MP-D05 | Realtime 只提供 wake-up | accepted |
| MP-D06 | Direct 按 endpoint pair 建 session | accepted |
| MP-D07 | Group 使用 RFC 9420 MLS device leaves | accepted |
| MP-D08 | Recovery 不复制 live crypto state | accepted |
| MP-D09 | Command/event/receipt 为统一 conversation framework | accepted |
| MP-D10 | hard cut，无永久兼容层 | accepted |
| MP-D11 | control plane 与 attachment data plane 分离 | accepted |
| MP-D12 | native receiver evidence 决定 readiness | accepted |
| MP-D13 | Authority event 使用 opaque delivery commitments | accepted |
| MP-D14 | Sending endpoint 通过 ordered public-event marker 推进 authority head | accepted |
| MP-D15 | Fresh device enrollment 必须携带 actor-cross-signed DSK proof | accepted |
| MP-D16 | Desktop/Mobile 共用 Portable Rust Messaging Core | accepted |
| MP-D17 | Station send-preparation snapshot 绑定 active-device fan-out | accepted |
| MP-D18 | MLS genesis 与 membership transition 使用短期 authority plan | accepted |
| MP-D19 | Federation routing 使用签名的短期 endpoint manifest | accepted |
| MP-D20 | Fresh MLS member 以 join event 建立 authority checkpoint | accepted |
| MP-D21 | Removed MLS endpoint 使用 retirement/rejoin checkpoint | accepted |
| MP-D22 | Recovery-ready projection 通过 Welcome 建立 current checkpoint | accepted |
| MP-D23 | Attachment object 与 transfer session 由 Conversation Authority 拥有 | accepted |
| MP-D24 | Attachment resume 使用 immutable chunk commitments | accepted |
| MP-D25 | Attachment projection 与 plaintext FTS 由 Engine SQLCipher 拥有 | accepted |

---

## MP-D01: Device Messaging Engine 是设备协议唯一 Owner

**Status**: accepted
**Date**: 2026-08-08

### Context

协议职责分散在 Web runtime、Rust commands 和 stores，无法形成事务或生命周期。

### Decision

Desktop Rust 和 Mobile 对应 native core 提供单一长生命周期 Messaging Engine。UI
只能提交 intent、读取 projection。

### Alternatives Considered

- Web runtime orchestration：拒绝，无法可靠拥有密钥、SQLCipher、进程生命周期。
- 多个 feature runtime：拒绝，会继续分裂 transaction boundary。

### Consequences

正面：可原子消费、清晰 owner、跨平台 contract 一致。负面：需要重构大量 command
surface，并为 native core 建立 worker/runtime 基础设施。

## MP-D02: Authority Log 与 Device Queues 分离

**Status**: accepted
**Date**: 2026-08-08

Conversation event 表达业务事实；device queue 只表达目标设备可靠投递。二者在 commit
时原子关联，但 retention、cursor 和 retry 独立。拒绝把 SSE/event 表直接当 inbox。

## MP-D03: 每设备有序 Lane + At-Least-Once

**Status**: accepted
**Date**: 2026-08-08

每个 `(PTID, device_id)` 获得单调 `lane_sequence`，并使用 lease/consumer epoch
claim。选择 at-least-once + durable dedup，拒绝无法在分布式崩溃中证明的
exactly-once transport。

代价：重复 delivery 是正常输入，所有 consumer 必须幂等。

## MP-D04: ACK 位于本地 Durable Consumption 之后

**Status**: accepted
**Date**: 2026-08-08

ACK 的唯一含义是 crypto state、plaintext projection、consumption marker 和 cursor
已经在设备 SQLCipher 中 commit。拒绝 SSE-write ACK、handler-entry ACK 和 UI-render
ACK。

代价：storage 故障会让 server queue 保持未 ACK，并需要 backpressure/告警。

## MP-D05: Realtime 只提供 Wake-Up

**Status**: accepted
**Date**: 2026-08-08

SSE/push 只通知“lane head 可能变化”。Engine 总是通过 bounded resume/claim 读取
durable item。拒绝通过 browser event payload 执行业务。

代价：每次 wake 可能多一次 API round trip，但换取统一可靠路径。

## MP-D06: Direct 按 Endpoint Pair 建 Session

**Status**: accepted
**Date**: 2026-08-08

每个 local/remote `(PTID, device_id)` pair 持有独立 X3DH/Double Ratchet generation。
同一 message identity 对目标 active devices 和 sender companion devices 生成独立
ciphertext。

拒绝 actor-wide session 和共享 ciphertext。代价是 fan-out 和 key material 增长。
独立 ciphertext 不产生独立 UI message；所有设备以同一 authority `event_id` 写入
逻辑消息 projection。

## MP-D07: Group 使用 RFC 9420 MLS Device Leaves

**Status**: accepted
**Date**: 2026-08-08

每 active device 一个 leaf。Membership authority transition 与 MLS epoch transition
绑定。拒绝 Sender Keys、Megolm 和 SimpleX fully-connected pairwise group。

代价：需要严格处理 epoch gap、Welcome、external commit、device add/remove。

## MP-D08: Recovery 不复制 Live Crypto State

**Status**: accepted
**Date**: 2026-08-08

24-word phrase 派生 backup key，恢复 actor identity、plaintext history、attachment
metadata 和 trust。fresh install 创建 fresh device identity、Direct sessions 和 MLS
leaves。

拒绝复制 ratchet/OPK/MLS live state，避免 nonce/key reuse 与并发 endpoint identity。

## MP-D09: 统一 Conversation Framework

**Status**: accepted
**Date**: 2026-08-08

Direct/Group、text/attachment、edit/retract/reaction、membership 与 receipt 共用 typed
command/event/authority sequence 框架；crypto payload 由 Direct/MLS engine 提供。

代价：Proto 和 authority domain 需要一次完整重建，而非局部 handler 修改。

## MP-D10: Hard Cut，无永久兼容层

**Status**: accepted
**Date**: 2026-08-08

每个责任域使用原子切换：new owner 完成、所有 consumer 切换、旧 symbol/path 删除、
tree scan 为零。回滚使用版本控制和部署回滚，不保留双 runtime。

代价：切换 closure 必须更小且证据充分，不能长期分批混跑。

## MP-D11: Control Plane 与 Attachment Data Plane 分离

**Status**: accepted
**Date**: 2026-08-08

消息 command 仅引用 encrypted object descriptor。大对象独立上传/下载、鉴权、校验和
恢复。拒绝把附件 bytes 塞入 authority event/device queue。

## MP-D12: Native Receiver Evidence 决定 Readiness

**Status**: accepted
**Date**: 2026-08-08

测试、API、数据库和截图分别只是证据片段。required journey 必须由隔离 native
clients 执行，并关联 Station/Engine durable readback。任一缺失均为 `UNPROVEN`。

## MP-D13: Authority Event 使用 Opaque Delivery Commitments

**Status**: accepted
**Date**: 2026-08-08

### Context

当前 `CommittedConversationEvent` 同时保存 authority fact 和全部 Direct device
ciphertexts，`event_hash` 对完整 event bytes 计算。若为每个 recipient 过滤 event，
recipient 无法复算 authority hash；若发送完整 event，则会暴露其他 device 的
ciphertext 和 endpoint identity。缺失的 canonical `command.proto` / `event.proto`
无法在该语义未定义时安全生成。

### Decision

Authority `ConversationEvent` 只保存公共 committed fact 和 sorted opaque delivery
commitments，不保存 endpoint identity 或 endpoint-private ciphertext。

每个 commitment 绑定：

```text
domain separator + schema version + conversation_id + event_id
+ recipient endpoint + payload type + SHA-256(endpoint-private payload)
```

每个 `DeviceEventDelivery` 只携带：

- 完整 public authority event；
- 当前 recipient endpoint；
- 当前 endpoint 的 Direct ciphertext、MLS payload 或 public-fact marker；
- endpoint payload hash；
- 对应 delivery commitment。

Device Queue 的 `payload_sha256` 再绑定完整 `DeviceEventDelivery` bytes。Authority
event、全部 required queue rows 和 command receipt 必须在同一 transaction 提交。
Canonical input 使用 unsigned big-endian fixed-width integers 和 length-prefixed UTF-8
strings，禁止 delimiter-based encoding。

### Rationale

- recipient 可验证 public authority hash chain，而无需取得其他 device payload；
- queue item 可证明其 endpoint-private payload 属于 authority committed delivery set；
- authority log、device delivery 和 UI logical event identity 保持分离；
- revoke/fan-out/fully-delivered 可基于 committed required delivery set审计。

### Alternatives Considered

- Event 携带全部 ciphertext：拒绝，跨 endpoint 暴露 payload 和 device topology。
- 每 recipient 生成不同 authority event：拒绝，会破坏共享 `event_id` 与 hash chain。
- 过滤 event 后保留原 hash：拒绝，recipient 无法验证 hash input。
- 只在 queue row 保存 ciphertext、event 不作 commitment：拒绝，queue payload 无法证明
  属于 authority accepted command。

### Consequences

- Proto 增加 delivery commitment 和 `DeviceEventDelivery` contract。
- Authority 必须以 deterministic canonical encoding 计算 commitment，并排序后 hash。
- Device Engine receive transaction 增加 commitment verification。
- event log 不直接恢复 ciphertext；可靠 replay 来自 device queue，plaintext history
  来自 encrypted recovery archive。

### Acceptance

Owner accepted on 2026-08-08. `MP-A13` is a mandatory invariant.

## MP-D14: Sending Endpoint 通过 Ordered Public-Event Marker 推进 Authority Head

**Status**: accepted
**Date**: 2026-08-08

### Context

当前 sending endpoint 不接收自己的 device queue item，而 command response 可独立于
inbox lane 到达。若 response 直接推进 sender projection/authority head，可能越过更早
提交但尚未 drain 的 event；若不推进，后续 event 的 `previous_hash` 无法连续验证。

### Decision

每个 committed event fan-out 到所有相关 active devices，包括当前 sending endpoint。
当前 sending endpoint 的 payload kind 为 `PUBLIC_EVENT`，只携带 public authority
event marker，不携带 ciphertext。该 marker 通过正常 lane 被 claim、原子消费和 ACK，
并将本地 pending sender projection 升级为 committed。

Command response 只更新 durable command submission state，不改变 authority head 或
最终 message projection。

### Alternatives Considered

- Command response 直接推进 authority head：拒绝，独立网络路径可乱序。
- Sending endpoint 不维护 authority head：拒绝，后续 incoming event 无法验证完整 hash
  chain。
- Sending endpoint 再加密一份给自己：拒绝，没有安全收益，增加 ratchet 和 key
  material。
- UI optimistic state 作为最终消息：拒绝，UI 不是 durable projection owner。

### Consequences

- 每个 event 增加一个轻量 sending-endpoint queue item。
- pending sender projection 必须以 `command_id` 持久化，并在 marker consume 时升级。
- 所有设备使用同一 lane ordering、marker、cursor、authority head 和 ACK semantics。

### Acceptance

Owner accepted on 2026-08-09.

## MP-D23: Attachment Object 与 Transfer Session 由 Conversation Authority 拥有

**Status**: accepted
**Date**: 2026-08-10

### Context

现有 chat attachment 上传到客户端绑定的 Home Station OSS，authorization 仍查询
legacy friend-chat tables。跨 Station recipient 无法用自己的 Home token 直接访问
object host，也没有一个 owner 能把 object grant 与 authority event 原子绑定。

### Decision

Conversation Authority Station 是 canonical attachment object host。它拥有 resumable
transfer session、opaque bytes、descriptor validation、message-event grant、quota、
orphan GC 和 audit。远端客户端通过自己的 Home Station 以 signed federation data-plane
stream 代理到 Authority；大对象不进入 durable messaging control outbox。

Message commit 将 completed object 与 `event_id`、conversation 和当时 committed recipient
PTIDs 原子绑定。下载授权读取该 immutable grant，不读取当前 membership。

### Rationale

- authorization 与 event recipient truth 在同一 owner 和 transaction；
- removed actor 保留其已收到历史附件，不能读取后续附件；
- Home Station 不需要复制 conversation ACL 或对象 metadata；
- Station 仍只看到 ciphertext descriptor，不看到 private metadata/key。

### Alternatives Considered

- object 留在 uploader Home Station：拒绝，需要跨 Station 复制 authority membership
  与 historical grant，形成第二真源。
- bearer URL 放入 E2EE payload：拒绝，泄露后无法绑定 actor、撤销或审计。
- bytes 放入 device queue/federation outbox：拒绝，阻塞 ordered control lane。

### Consequences

正面：单一 ACL owner、可审计、跨站拓扑明确。负面：remote upload/download 必须经过
Home-to-Authority streaming proxy，Authority 承担 conversation object capacity。

## MP-D24: Attachment Resume 使用 Immutable Chunk Commitments

**Status**: accepted
**Date**: 2026-08-10

### Context

现有 AES-GCM chunk encryption 计算 whole hashes，但 upload/download 是 whole-file
best effort。仅保存 byte offset 无法证明 partial file 未损坏，也无法安全重放 part。

### Decision

Descriptor 固定 suite、chunk size/count、tag size、nonce strategy、whole ciphertext
hash 和 ordered per-chunk ciphertext hashes。Upload part 使用
`(upload_id, chunk_index)` 幂等；相同 hash exact replay，不同 hash conflict。
Complete 重算 whole size/hash。Download 使用 immutable ETag、`Range + If-Match`，
Engine 每完成一个 chunk 后持久化 bitmap/hash checkpoint。

### Rationale

每个 chunk 可独立验证、重试和解密；restart 不信任未验证的 partial bytes；whole hash
仍提供完整 object commitment。

### Alternatives Considered

- 仅 whole-file hash：拒绝，resume 后必须重新下载或重新 hash 整个 partial file。
- 仅 byte offset：拒绝，无法检测 partial corruption。
- per-part server checksum 但不进 descriptor：拒绝，recipient 无 E2EE commitment。
- Merkle tree：暂不采用，复杂度高于当前 bounded attachment size 的收益。

### Consequences

正面：精确 resume、conflict detection、跨端 known-answer 可测。负面：descriptor 大小
按 chunk count 线性增长，因此必须限制 attachment size 与最大 chunk count。

## MP-D25: Attachment Projection 与 Plaintext FTS 由 Engine SQLCipher 拥有

**Status**: accepted
**Date**: 2026-08-10

### Context

当前 SQLCipher 只有 opaque recovery metadata table，send/receive transaction 不写
attachment row；搜索仍调用 Station conversation route，违反 plaintext local-only。

### Decision

Messaging Engine 在同一 SQLCipher transaction 写 message、typed attachment metadata、
FTS text/filename、consumption marker、cursor 和 receipt。Transfer checkpoints 也是
Engine-owned durable local state，但不进入 recovery。Recovery 保存 descriptor/private
metadata，并从 validated archive 重建 FTS；fresh device 按需重新下载 bytes。

### Rationale

plaintext/search/attachment metadata 共享一个 transaction owner；失败时不 ACK；Station
不需要 plaintext index。

### Alternatives Considered

- Web store/localStorage index：拒绝，无法与 receive/restore 原子提交。
- Station FTS：拒绝，泄露 plaintext 和 filename。
- 独立 local search database：拒绝，产生 message projection 与 index split-brain。

### Consequences

正面：离线搜索、atomic restore、单一 owner。负面：SQLCipher 写放大，restore 必须重建
FTS，并需要 bounded indexing/backfill gate。

## MP-D20: Fresh MLS Member 以 Join Event 建立 Authority Checkpoint

**Status**: accepted
**Date**: 2026-08-10

### Context

新增 MLS member 的 fresh endpoint 只收到加入 transition 的 Welcome。它没有加入前的
authority events，也不应取得加入前 plaintext；若仍要求本地 authority head 从 sequence
1 连续，Welcome 会永久阻塞为 `authority event chain is not contiguous`。

旧 events 的 delivery commitments 没有包含新 endpoint，因此把旧 events 重新包装进该
endpoint lane 会破坏 `MP-A13`。直接忽略 `previous_hash` 则会把任意非连续 event 变成
可接受输入。

### Decision

每个 membership transition committed event 携带完整的公共
`ConversationAuthoritySnapshot`，描述 transition 提交后的 conversation metadata、
owner、active actor memberships、active device leaves 和 epochs。Snapshot 是 event
payload 的一部分，因此进入 authority event hash。

Fresh endpoint 可以把明确添加自己的 MLS Welcome event 作为首个 authority
checkpoint，但必须同时满足：

- 本地该 conversation 不存在 authority head、MLS session、conversation projection 或
  consumption marker；
- delivery payload kind 是 `MLS_WELCOME`；
- transition changes 明确 `ADD_ACTOR` 或 `ADD_DEVICE` 当前 `(PTID, device_id)`；
- post-transition snapshot 包含当前 actor 和 endpoint；
- snapshot、event、Welcome 的 conversation、sequence、membership epoch 和 MLS epoch
  完全一致；
- event hash、endpoint payload hash、delivery commitment 和 queue payload hash 全部
  验证通过。

Engine 在一个 SQLCipher transaction 中写入 Welcome-derived MLS state、snapshot-derived
conversation/member projection、authority head、lane cursor、consumption marker 和
receipt；commit 成功后才 ACK。后续 event 必须从该 join event 严格连续。

加入前 plaintext/history 不通过 event log 或 device queue提供。需要旧历史只能通过
`MP-D08` encrypted recovery archive，且必须遵守产品恢复权限。

### Rationale

- Station 继续拥有 membership、sequence 和公共 post-transition truth；
- 新成员可以验证未来 hash chain，而不伪造对旧 delivery commitments 的归属；
- Welcome、projection 和 authority checkpoint 共享一个原子 local commit；
- history visibility 与 MLS membership admission 明确分离。

### Alternatives Considered

- 重放 sequence 1 到 join-1 的旧 authority events：拒绝，旧 commitments 未绑定新
  endpoint，并扩大加入前 metadata 暴露。
- 首个 Welcome 直接忽略 previous hash：拒绝，无法区分合法 join 与缺失/攻击 event。
- Station 提供独立 mutable snapshot API：拒绝，会制造 event log 之外的第二个
  membership truth。
- UI 在 Welcome 后补 conversation/member projection：拒绝，UI 不是 crypto 或
  membership owner，且无法形成原子 ACK boundary。

### Consequences

正面：

- fresh actor/device join 可在无旧 history 情况下安全启动；
- one-device-one-leaf 与 post-join exact plaintext journey可执行；
- epoch gap 仍默认 fail closed。

负面：

- membership event 增加完整公共 post-state snapshot；
- Station event builder 和所有 native Engine adapters必须实现同一 checkpoint predicate；
- snapshot size 随 active actor/device 数增长，需要受现有 group membership quota约束。

### Acceptance

- fresh Carol 在加入前 conversation list为空；
- ADD 后 Welcome 原子创建group projection与authority head；
- Carol看不到join前plaintext，但可解密join后的exact plaintext；
- forged snapshot、错误endpoint、错误epoch、非Welcome gap全部零local commit、零ACK；
- restart/replay不重复安装Welcome或projection。

Owner accepted through the standing completion directive on 2026-08-10.

## MP-D21: Removed MLS Endpoint 使用 Retirement/Rejoin Checkpoint

**Status**: accepted
**Date**: 2026-08-10

### Context

`REMOVE_DEVICE`/`REMOVE_ACTOR`提交后，被移除endpoint仍需消费一个有序authority item，
才能在durable ACK前退役本地MLS state。当前Station把removed endpoint包装成
`PUBLIC_EVENT`，Desktop却只能把membership public marker解释为发送端pending-transition
确认，因此真实REMOVE_DEVICE在removed endpoint失败为
`messaging MLS sender marker binding mismatch`。

被移除endpoint在缺席期间不会收到group events。若同一仍有效
`(PTID, device_id)`稍后重新加入，它会收到新的Welcome，但本地保留旧authority head和
MLS session，不能按普通连续event处理，也不能伪装成MP-D20的empty-store fresh join。

### Decision

新增typed `MLS_RETIREMENT` endpoint payload，禁止继续以`PUBLIC_EVENT`承载removed
endpoint语义。Payload绑定conversation、event、transition、removed endpoint和
post-transition snapshot。

Engine只在transition changes明确`REMOVE_ACTOR`或`REMOVE_DEVICE`当前endpoint，且
post-state不再包含当前endpoint时接受retirement。它在一个SQLCipher transaction中：

- 删除该conversation的live MLS group与pending transition；
- 写入`retired` checkpoint，包括retirement sequence/hash、epochs和本地endpoint；
- 更新snapshot-derived conversation/member projection；
- 推进authority head、lane cursor和consumption marker；
- 写receipt；commit成功后才ACK。

Retired endpoint不接收缺席期间group events，也不得发送。后续同一endpoint的
`MLS_WELCOME`只有在transition明确重新添加它、snapshot包含它、完整delivery绑定通过，
并且本地状态恰好是matching retired checkpoint时，才可作为rejoin checkpoint。Rejoin
transaction原子替换MLS state/projection/authority head，清除retired checkpoint并ACK。
缺席期间plaintext/history不补发。

### Rationale

- retirement与sender echo是不同的协议事实，使用不同typed payload；
- endpoint退出、缺席和rejoin各自有durable local state，不依赖UI推断；
- 同一有效设备可被正常重新邀请，无需轮换全局device identity；
- rejoin不泄漏缺席期间历史，未来event重新恢复严格hash-chain continuity。

### Alternatives Considered

- removed endpoint静默丢弃item：拒绝，lane无法ACK且live MLS state仍可误发送。
- 继续复用`PUBLIC_EVENT`并按endpoint分支：拒绝，保持两个不同语义共用一个wire kind。
- 永久禁止同一device_id重新加入：拒绝，不符合多设备群聊产品体验。
- 给removed endpoint补发缺席events：拒绝，违反membership confidentiality和原delivery
  commitments。

### Consequences

- proto、Station payload builder和portable Engine consumer需要共同新增retirement kind；
- SQLCipher增加每conversation retired checkpoint；
- rejoin Welcome可跨越缺席sequence，但仅能从matching retired checkpoint进入；
- transition或local commit失败保持旧state且不ACK。

### Acceptance

- REMOVE_DEVICE item在removed endpoint原子retire并ACK；
- removal后的group message不生成该endpoint queue item；
- 同endpoint ADD_DEVICE Welcome原子rejoin且不恢复缺席plaintext；
- rejoin后双向exact plaintext、cold restart和后续strict continuity通过；
- forged retirement/rejoin、错误endpoint、错误snapshot和partial commit全部零ACK。

Owner accepted on 2026-08-10.

## MP-D22: Recovery-Ready Projection 通过 Welcome 建立 Current Checkpoint

**Status**: accepted
**Date**: 2026-08-10

### Context

MP-D08要求fresh install先恢复Actor IK、history与projection，再生成fresh device并重建
sessions/leaves。MP-D20要求无authority head的Welcome只能安装到empty local conversation。
因此正确恢复出的非空projection会被empty-store predicate拒绝，无法完成ADD_DEVICE。

### Decision

Canonical recovery staging为每个恢复的conversation写入one-shot
`recovery_ready=true`。它只表示该projection/history来自已验证archive，且尚未绑定当前
device的authority head与MLS state。

Fresh device的ADD Welcome只有满足以下条件才可使用recovery checkpoint：

- 本地无该conversation authority head、MLS group或consumption marker；
- conversation projection存在且`recovery_ready=true`；
- archive PTID等于当前认证PTID；
- Welcome、ADD change、当前endpoint和hashed post-state完全绑定；
- delivery/event/payload hashes与commitment全部通过。

同一个SQLCipher transaction安装Welcome-derived MLS state、current snapshot projection、
authority head、cursor、marker与receipt，并把`recovery_ready`置false。已恢复message
projections保留不变。普通非空projection、手工设置flag或第二次checkpoint全部fail
closed。

### Consequences

- recovery readiness是conversation-local durable state，不是全局UI状态；
- archive history可以在加入current MLS epoch前可见，但该device在checkpoint前不能发送；
- current snapshot可更新恢复时的name/members/epochs，同时保留合法旧history；
- 多conversation恢复分别完成one-shot reconciliation。

### Acceptance

- fresh profile使用24-word phrase恢复exact history和Actor IK；
- fresh cross-signed device成功enroll并发布KeyPackages；
- ADD_DEVICE Welcome在非空recovery-ready store原子安装并清除flag；
- checkpoint前发送失败，checkpoint后双向exact plaintext；
- wrong phrase、forged Welcome、普通非空projection和partial commit均零破坏、零ACK。

Owner accepted on 2026-08-10.

## MP-D18: MLS Genesis 与 Membership Transition 使用短期 Authority Plan

**Status**: accepted
**Date**: 2026-08-09

### Context

当前 `CreateMessagingGroupConversation` 先创建可见 conversation 与 sequence 1，再由
Engine claim KeyPackage 并提交 OpenMLS genesis。若任一 endpoint 缺少 KeyPackage，
用户会得到永久停在 `membership_epoch=0 / mls_epoch=0` 的可见空群。

当前 `PrepareMessagingSend` 只快照已有 member devices。它不能安全表达 add actor/device
后的 prospective leaf set，也没有绑定 KeyPackage reservation。Station 的 transition
admission 因此只能安全处理 genesis，不能把 add/remove actor/device 与 authority
event、epochs、member rows 和 queue fan-out放在同一 transaction。

这些都是 source inspection 和 native failure evidence 已验证的事实，不是实现偏好。

### Decision

Station 增加两种 authenticated、短 TTL、版本绑定的 authority plan：

1. `PrepareGroupGenesis` 创建不可见 plan reservation，不创建 conversation、event、
   member row 或 queue item。它返回完整 active endpoint set、每个非创建者 endpoint
   的 exact reserved KeyPackage、authority plan hash 和 expiry。
2. `PrepareMembershipTransition` 锁定当前 conversation/membership/device snapshot，
   根据 typed add/remove actor/device intent计算 pre/post endpoint sets。add transition
   返回所有新增 leaf 的 exact reserved KeyPackages；remove transition不返回密钥。

plan hash 必须绑定：

- conversation/group intent identity；
- authority sequence/hash；
- current membership/MLS epochs；
- typed action、target actor/device和role；
- bytewise-sorted pre/post endpoint sets；
- reserved KeyPackage IDs及其 hashes；
- expiry 与 plan identity。

提交时 Station 在同一 unit of work 中重新验证 active/revoked device truth和plan：

```text
validate plan + active-device truth
+ create/append authority event(s)
+ mutate actor membership rows
+ mutate member-device leaf rows
+ advance membership/MLS epochs
+ enqueue exact transition deliveries
+ consume KeyPackage reservations
+ persist command receipt
```

任一点失败全部回滚。plan过期或snapshot变化返回typed stale result，零 shared mutation。
短 TTL plan不冻结device set；最终提交始终重新验证。

delivery规则：

- surviving existing leaves：`MLS_COMMIT`；
- newly added leaves：`MLS_WELCOME`；
- surviving sender：ordered `PUBLIC_EVENT` marker；
- voluntarily leaving sender：ordered public marker，用于提交本地pending transition并进入
  `left`；
- removed actor endpoints：不携带密钥的typed removal state fact，之后不再收到group item；
- already revoked device：包括removal transition在内不再创建任何新queue item。

Group genesis提交原子创建conversation-created fact和epoch `0→1` transition。prepare失败、
plan过期或客户端放弃只删除/过期不可见reservation，不产生可见空群。

Device Engine持久化logical genesis/membership intent和每次attempt。stale时：

- 丢弃尚未merge的pending OpenMLS commit；
- supersede旧attempt；
- 使用fresh authority plan与KeyPackages重新prepare；
- 不回滚或改写任何已接受MLS epoch。

### Rationale

- Station继续拥有membership和active-device truth；
- 一次transition覆盖一个actor的全部active devices，维持one-device-one-leaf；
- KeyPackage claim与prospective leaf set具有可重放、可过期、可审计的绑定；
- failed genesis不会污染用户可见conversation；
- UI只提交typed intent，不读取epoch、claim KeyPackage或合并OpenMLS state。

### Alternatives Considered

- 先写member rows再提交MLS：拒绝，会让Station membership领先于crypto epoch。
- 复用普通send plan：拒绝，它只描述当前endpoint set，无法绑定prospective leaves。
- 客户端自行枚举devices和claim KeyPackages：拒绝，复制Station truth并保留UI crypto owner。
- 在失败后删除已发布conversation：拒绝，其他devices可能已观察sequence 1，删除会破坏
  authority history。
- 长 TTL reservation冻结device set：拒绝，revoke后仍可能产生未来delivery。
- 前端隐藏epoch-zero group：拒绝，共享truth仍错误且其他客户端继续可见。

### Consequences

正面：

- create/add/remove都具有一个atomic authority boundary；
- stale/retry/restart有typed durable语义；
- failed group creation不再留下用户可见死群；
- old frontend MLS orchestration可以整体删除。

负面：

- canonical proto需要新增plan/reservation contracts和typed stale/expired errors；
- Station需要actor membership表、KeyPackage reservation和row-locking；
- Engine需要durable logical transition intents及pending transition restart recovery；
- native add/remove/revoke gate必须覆盖plan expiry和device churn竞态。

### Acceptance

Owner accepted on 2026-08-09.

## MP-D19: Federation Routing 使用签名的短期 Endpoint Manifest

**Status**: accepted
**Date**: 2026-08-09

### Context

canonical crypto identity正确地保持为`(PTID, device_id)`，但它不包含网络路由。当前
Messaging Device Directory只读取本地`actor_devices`；`MessagingConversationView`
不声明authority Station；Authority commit也只写本地device queues，从未生成
federation outbox frame。已有outbox/inbox/dispatcher/transport因此没有生产者，无法形成
跨Station消息链路。

### Decision

crypto identity与routing metadata保持分离：

```text
CryptoEndpoint = (PTID, device_id)

FederatedEndpointManifest {
  actor_ptid
  home_station_id
  directory_version
  issued_at
  expires_at
  active_endpoints[] {
    endpoint
    signing_key_id
    public_bundle_hashes
  }
  home_station_signature
}
```

send/genesis/membership prepare通过authenticated federation directory从每个actor的
Home Station取得短TTL signed manifest与所需public bundles/KeyPackages。authority plan
绑定manifest identity、version、expiry、endpoint routes和public material hashes；
`home_station_id`只参与routing/fan-out，不进入crypto endpoint identity。

Authority Station在一个database transaction中：

- commit统一conversation event和authority sequence；
- 为本地recipient写device queues；
- 按target Home Station聚合remote `FederatedDeviceQueueBatch`；
- 为每个remote batch写durable federation outbox；
- 写command receipt。

任一本地queue或outbox写失败时整个authority commit回滚。dispatcher在transaction外
异步发送signed frame。Target Home Station验证Station signature、frame claims、
idempotency和payload hash，在一个transaction中写federation inbox与local device lanes。

Target Home Station必须再次读取当前device registry：

- snapshot后revoked endpoint：丢弃该write，不创建queue item；
- snapshot后新activate endpoint：其activation sequence晚于该event，不追补过去ciphertext；
- manifest过期、错误Home Station或directory version回退：reject frame，source outbox
  保持retryable/diagnosable。

非authority Home Station上的client command先进入本地durable federation outbox，
以`AUTHORITY_COMMAND` frame发往conversation Authority Station。Authority result返回
Home Station后只更新durable command state；设备仍通过自己的ordered queue marker推进
authority head。

### Rationale

- `(PTID, device_id)`继续是稳定crypto地址，Station迁移不改变session identity；
- Home Station是其actor device lifecycle的唯一truth；
- Authority Station继续唯一排序conversation facts；
- outbox与authority event原子写入，网络断开不丢失已接受event；
- target registry recheck保证revoked device零未来queue。

### Alternatives Considered

- 把Home Station拼进`CryptoEndpoint`：拒绝，Station迁移会改变crypto identity。
- Authority直接查自己的`actor_devices`表示remote actor：拒绝，复制错误truth。
- HTTP request goroutine直接转发remote delivery：拒绝，crash后丢失且无outbox replay。
- Target Station收到logical event后自行选择devices并加密：拒绝，Target无plaintext和
  sender ratchet/MLS state。
- 继续使用旧Envelope/Conversation federation：拒绝，形成永久dual owner。

### Consequences

正面：

- authority ordering、device-local lanes和跨Stationretry形成闭环；
- routing变更不污染crypto identity；
- disconnect/restart/duplicate frame均可用durable state验证。

负面：

- proto需要authority Station、signed manifest、route snapshot和authority command/result
  frame contracts；
- Authority UOW必须同时拥有local queue与federation outbox repository；
- Home Station directory需要monotonic version和manifest signing；
- native G11需要至少两个独立Station数据库和两个Home Station client profiles。

### Acceptance

Owner accepted on 2026-08-09.

## MP-D15: Fresh Device Enrollment 必须携带 Actor-Cross-Signed DSK Proof

**Status**: accepted
**Date**: 2026-08-09

### Context

Actor identity 层已定义 per-device Ed25519 DSK，并由 actor IK 对
`device_public_key + device_id` cross-sign。当前 canonical enrollment contract 只含
fingerprint 和 signing-key ID，Station 无法验证提交的 device public key 是否由 actor
identity 授权；旧 register handler 仅因请求已认证就信任任意 public key。

### Decision

Fresh device enrollment 必须提交：

- fresh `device_id`；
- device Ed25519 public key；
- actor IK public key fingerprint；
- actor IK 对 canonical device certificate input 的 cross-signature；
- signing-key ID 和 observed actor profile version。

Station 验证 cross-signature、actor identity continuity、device/profile version 和
endpoint header binding 后，才从 `ENROLLING` 转为 `ACTIVE`。未激活 device 不接收未来
queue item，也不能发布 SPK/OPK 或加入 MLS。

### Consequences

- Recovery staging 可先生成并持久化 fresh local DSK，状态为
  `awaiting_device_enrollment`；
- enrollment 失败可使用同一 proof 幂等重试，不重新生成 device identity；
- device private key、cross-signing seed、SPK/OPK 和 MLS state不进入 recovery
  archive。

### Acceptance

Owner accepted on 2026-08-09.

## MP-D17: Station Send-Preparation Snapshot 绑定 Active-Device Fan-Out

**Status**: accepted
**Date**: 2026-08-09

### Context

Engine必须在加密前知道完整 required endpoint set、authority head、membership epoch和
MLS epoch，但当前 canonical contract只有提交后的 `ChatCommand`。从本地 session表
推断 endpoint set会包含 revoked/stale device，也无法发现刚激活的 companion device。

Device activation/revoke可能发生在准备和提交之间。Authority虽然能拒绝不完整的
payload set，但没有 typed snapshot与 stale error时，客户端无法区分可重试网络失败、
不可重放的 stale fan-out，以及普通 command rejection。

### Proposed Decision

Station提供 authenticated `PrepareMessagingSend` read contract：

- 输入为 `conversation_id`和当前 `(PTID, device_id)`；
- 返回 conversation kind、authority sequence/hash、membership/MLS epoch；
- Direct返回除当前 sender外的全部 required active endpoints；
- 返回对上述字段和 bytewise-sorted endpoint set计算的
  `delivery_plan_sha256`。

`ChatCommand`必须携带该 `delivery_plan_sha256`。Authority在持有 conversation/device
registry transaction boundary时重算计划，并在写 event或queue row前完成验证：

- 完全一致：继续现有 atomic event/fan-out；
- 不一致：返回 typed `STALE_DELIVERY_PLAN`，零 event、零queue row。

Engine处理 stale plan时：

- 保留同一 logical draft和`message_id`；
- 将旧 command attempt标记为 superseded，不重放其 ciphertext；
- 从已持久化 advanced ratchet/MLS state创建新`command_id`和新 snapshot；
- 新 ciphertext继续前进，不回滚或复用 message key。

### Rationale

- Station仍是 active/revoked truth；
- Engine不读取前端或本地缓存猜测 fan-out；
- stale rejection发生在任何 authority mutation前；
- 不回滚 ratchet，避免 nonce/key reuse；
- logical message identity与 transport attempt identity保持分离。

### Alternatives Considered

- 从本地 Direct sessions推断 recipients：拒绝，无法证明 active/revoked完整性。
- Authority接受任意 recipient subset：拒绝，违反 required multi-device fan-out。
- stale后重放原 ciphertext：拒绝，payload set与当前 active devices不匹配。
- rollback ratchet并重新加密：拒绝，crash/retry下无法安全证明未复用 key/nonce。
- 长 TTL reservation冻结 device set：拒绝，撤销设备仍可能收到未来queue item。

### Consequences

- proto需增加 send-preparation request/response、plan hash和 typed stale error；
- SQLCipher pending projection需分离 logical message与 command attempts；
- frequent device churn可能产生未提交 ratchet gaps，receiver通过 bounded skipped-key
  semantics处理；
- stale attempt保留审计状态，但不得继续进入outbox。

### Acceptance

Owner accepted on 2026-08-09.

## MP-D16: Desktop/Mobile 共用 Portable Rust Messaging Core

**Status**: accepted
**Date**: 2026-08-09

### Context

Desktop 已在 `apps/desktop/src-tauri/src/messaging/` 建立 Direct Double Ratchet、
OpenMLS、atomic receive、recovery、queue drain 和 SQLCipher projection。Mobile Rust
仍使用 Sender Keys，并且没有同等 Device Messaging Engine。若在 Mobile crate 内复制
Desktop modules，即使初始代码相同，crypto state machine、schema、failure semantics
和修复节奏也会立即分叉。

### Decision

建立一个不依赖 Tauri 和平台 API 的 portable Rust Messaging Core，作为 Desktop 与
Mobile 唯一协议实现。Core 拥有：

- X3DH/Double Ratchet 和 skipped-key semantics；
- RFC 9420 OpenMLS group/device-leaf state machine；
- command/outbox、ordered inbox、dedup、cursor、receipt 和 ACK boundary；
- recovery archive codec 与 atomic-store transaction contracts；
- typed local projections 与错误状态。

Desktop/Mobile 只提供 platform adapters：

- encrypted database connection/transaction；
- keychain/secure-enclave material；
- HTTP queue/command transport；
- clock/randomness；
- foreground/background/push lifecycle；
- typed projection delivery。

W09 cutover 必须让 Desktop 与 Mobile 同时依赖该 core，并在同一 closure 删除 Mobile
Sender Keys 和 Desktop 内原协议 implementation。禁止 re-export shim、复制目录、
feature flag 双跑或平台私有 crypto fork。

### Rationale

- protocol/security 修复只有一个落点；
- Desktop/Mobile 使用相同 wire、AAD、transaction、replay 和 recovery semantics；
- 平台差异被限制在可测试 adapters，而不是密码协议；
- Sender Keys 删除可以用 tree-wide single-source proof 验证。

### Alternatives Considered

- Mobile 复制 Desktop Rust modules：拒绝，形成第二套长期协议 owner。
- Desktop core 通过本地 HTTP/FFI 提供给 Mobile：拒绝，增加进程/ABI lifecycle 和
  mobile deployment complexity。
- 继续保留 Sender Keys，仅对 Direct 共用代码：拒绝，违反 MP-D07 和 W09 parity。
- 只共享 crypto primitives、各端保留 queue/recovery state machine：拒绝，可靠性与
  data-loss bug 主要发生在 transaction/lifecycle boundary，不只发生在 primitive。

### Consequences

正面：

- 一个 Direct/OpenMLS/queue/recovery source of truth；
- Desktop/Mobile protocol tests 使用相同 test vectors 和 failpoints；
- Mobile cutover 不需要重新设计消息语义。

负面：

- 必须抽象 SQLCipher、key material、network 和 lifecycle ports；
- Desktop 现有 implementation 需要整体迁移，不能长期保留原目录作为第二真源；
- 两个 Tauri crate 的 Rust dependency/build pipeline 需要统一；
- native mobile background、push 和 secure-storage adapters 仍需单独验证。

### Acceptance

- `packages/messaging-core/` 是唯一 Direct/OpenMLS/queue/recovery implementation；
- Desktop 与 Mobile crate 都以 path/workspace dependency 使用它；
- identical known-answer、crash/replay 和 recovery vectors 在两端 adapter suites通过；
- `sender_keys|SenderKey|group_sender_keys|crypto_group_sk_` tree-wide zero；
- Desktop/Mobile native Direct、MLS、restart 和 recovery evidence通过。

Owner accepted on 2026-08-09.
