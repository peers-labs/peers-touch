# Messaging Platform — 执行计划

> **Status**: active
> **Version**: v1.5
> **Created**: 2026-08-08 | **Updated**: 2026-08-27
> **Owner**: Messaging Platform Team

---

## 1. Plan Sources And Gate

产品来源：

- `../product-definition.md`
- `../benchmark-disposition.md`
- `../experience-contract.md`
- `../product-state-model.md`
- `../acceptance-matrix.md`

架构来源：

- `../design.md`
- `../decisions.md`
- `../data-model.md`
- `../module-layout.md`
- `../integration.md`

当前状态：base plan `PLAN_APPROVED`（Owner approved 2026-08-08）；
MP-W10 attachment amendment `PLAN_APPROVED`（Owner approved 2026-08-10）；
MP-W12 interaction amendment `PLAN_APPROVED`（Goal owner approved 2026-08-16）。
MP-D28 industry-aligned pending/retry + post-accept retract amendment is accepted
（Goal owner approved 2026-08-17）。

## 2. Scope And Non-Scope

范围：

- Model proto、Station Messaging Platform、Desktop/Mobile Messaging Engine。
- Direct、Group MLS、multi-device、recovery、receipts、attachments、search、
  reply/thread、edit/retract、reaction、pin、typing。
- durable authority/queue/federation、native acceptance、旧路径删除和文档归并。

非范围：

- Chat 页面重新设计。
- Voice/video media plane。
- 不属于 Chat 的 Social/Agent/Notification 重构。
- 兼容无法验证密钥来源或协议语义的数据。

## 3. Current-State Baseline

执行前必须生成 machine-readable baseline：

- 全部 dirty tracked/untracked files及 owner；
- proto source 与 generated diff；
- Station conversation/envelope/device/backup schema、routes、workers；
- Desktop/Mobile command、runtime、store、crypto、acceptance callers；
- 当前运行中的 native profiles、ports、storage roots；
- old symbol/delete inventory；
- 当前可复现的 Alice/Bob failure evidence。

当前 worktree 含大量预先存在的 generated 和 Chat 改动。没有经过 baseline ownership
和 workstream reconciliation 的改动不得标记为本计划完成，也不得被覆盖或回退。

## 4. Traceability

| Workstream | Product | Architecture | Decisions | Gates |
|---|---|---|---|---|
| MP-W00 Baseline/control board | all | A12 | D10/D12 | evidence integrity |
| MP-W01 Canonical contracts/device identity | C03-C06/C09-C10 | A01/A07/A08/A12 | D06-D09 | G03-G06/G09-G10 |
| MP-W02 Station authority/device queues | C01-C03/C10-C12 | A02-A04/A06/A09/A10 | D02-D05/D09 | G01-G03/G10-G12 |
| MP-W03 Device Engine substrate/Direct | C01/C03-C05 | A01/A03/A05-A07 | D01/D03/D04/D06 | G01/G03-G05/G12 |
| MP-W04 Atomic receive/replay | C01-C04/C07/C12 | A03-A05/A10 | D01/D03-D05 | G01-G04/G07/G12 |
| MP-W05 Send/projection/receipts | C01-C03/C10/C12 | A05/A06/A09 | D01/D04/D09 | G01-G03/G10/G12 |
| MP-W05-R Direct DELIVERED repair | C01-C03/C10/C12 | A05/A06/A09 | D01/D04/D09 | G01-G03/G10/G12 |
| MP-W06 Federation | C02/C03/C11/C12 | A02-A04/A06/A10 | D02-D05/D19 | G02/G03/G11/G12 |
| MP-W07 Multi-device/OpenMLS | C05/C06/C09 | A01-A08 | D06-D07/D18 | G03/G05/G06/G09 |
| MP-W08 Backup/recovery | C07/C08 | A05/A07 | D08 | G07/G08/G12 |
| MP-W09 Mobile parity | C01-C16 | A01-A18 | D01-D27 | contract/native mobile cells |
| MP-W10 Attachments/search | C13/C14 | A05/A11/A12 | D11/D23-D25 | G13/G14 |
| MP-W12 Message interactions/typing | C10/C15/C16 | A02-A05/A09/A17/A18 | D09/D12/D26/D27 | G10/G15/G16 |
| MP-W13 Product truth repair | C01-C03/C10/C13-C16 | A05/A09/A11/A12/A17/A18 | D09/D11/D23-D28 | G13-G16 + `chat-native-product-closure-e2e` |
| MP-W11 Cutover/deletion/final audit | all | A01-A18 | D10/D12/D26/D27 | G01-G16 |

## 5. Dependency DAG

```text
MP-W00
  -> MP-W01
       ├──> MP-W02 ──> MP-W06
       └──> MP-W03
              │
MP-W02 + MP-W03
       └──> MP-W04 ──> MP-W05
              ├────────> MP-W07
              └────────> MP-W11-R

MP-W01 ──────────────────────────────> MP-W10-A
MP-W02 + MP-W06 + MP-W10-A ─────────> MP-W10-B
MP-W03 + MP-W04 + MP-W10-A ─────────> MP-W10-C
MP-W10-B + MP-W10-C ─────────────────> MP-W10-D
MP-W05 + MP-W10-D ───────────────────> MP-W10-E
MP-W11-R + MP-W10-D ─────────────────> MP-W08

MP-W04 + MP-W05 + MP-W07 ─────────────────> MP-W12
MP-W01 + MP-W03 + MP-W04 + MP-W12 ───────> MP-W09

MP-W10-E + MP-W12 + Social Runtime Phase 3 ──> MP-W13-A/B/C/D/E
MP-W13-A/B/C/D/E ────────────────────────────> MP-W13-F
W02/W05/W06/W07/W08/W09/W10-E/W12/W13 + W11-R ──> MP-W11 final closure
```

可并行：

- W02 Station substrate 与 W03 Device Engine substrate。
- W06 federation、W07 MLS、W08 recovery 在 W04 稳定后并行。
- W09 的 proto/core extraction 可并行；Mobile interaction parity 必须等待 W12 semantics
  与 Desktop Gate 稳定。
- W10-B Authority transfer 与 W10-C Engine transfer 在 W10-A contracts 完成后并行。

禁止并行：

- Proto source 与 generated consumer adaptation。
- 同一 responsibility 的 old/new owner cutover。
- receive transaction 与 ACK semantics。

### 2026-08-10 Plan Amendment: MP-W11-R Recovery Owner Cutover

Repository and native UI evidence proved that `RecoverySettings` is still gated by the
legacy `cryptoRuntime` identity bootstrap, while backup encoding, SQLCipher restore,
fresh-device enrollment and history projection are already owned by the Rust Messaging
Engine. This leaves W08 dependent on an old owner and violates the accepted single-owner
architecture.

`MP-W11-R` is therefore moved before W08 as an atomic cutover closure:

1. Messaging Engine identity/projection becomes the only readiness source consumed by
   Recovery Settings.
2. Recovery create/status/restore commands resolve only the active profile Engine and
   its canonical archive.
3. Legacy crypto identity generation, key-bundle publication and recovery bootstrap
   callers are deleted from the Recovery UI/runtime path; no fallback remains.
4. Tree search proves the Recovery surface has zero live dependency on the old owner.
5. Native high-chat source plus group-chat fresh profile proves happy-path restore and
   wrong-phrase/corrupt/local-commit-failure zero-partial behavior before W08 can close.

This amendment changes execution order only. It does not change MP-D08, topology,
contracts, persistence ownership or recovery semantics.

### 2026-08-10 Plan Amendment: MP-W10 Attachment Data Plane And Search

Owner accepted `MP-D23`–`MP-D25` on 2026-08-10. Repository inventory proved that
existing AES-GCM/OSS/renderer utilities are reusable primitives, but the canonical
Messaging Engine has text-only payloads, Station has no resumable transfer/grant owner,
download is whole-file, and search remains legacy renderer/Station-owned.

MP-W10 is therefore split by stable responsibility:

- `MP-W10-A Contract Closure`: canonical private content, descriptor crypto/chunk
  commitments, transfer/grant requests, typed errors and generated bindings.
- `MP-W10-B Authority Transfer`: Authority-owned upload sessions, parts, immutable
  objects, event-time recipient grants, ranged download, Home-to-Authority signed
  streaming proxy, quota and orphan GC.
- `MP-W10-C Engine Transfer`: Engine-owned chunk encryption, durable upload/download
  checkpoints, hash/AEAD validation, atomic cache promotion and typed projection states.
- `MP-W10-D Message/Recovery/Search`: Direct/OpenMLS private content, atomic
  message+attachment+FTS receive/send transactions, recovery metadata/readback and FTS rebuild.
- `MP-W10-E Native Cutover`: renderer typed intent/projection cutover, legacy attachment/search
  owner deletion, high-chat/group-chat native MP-G13/G14 evidence.

The subworkstreams do not create intermediate product readiness. Only W10-E may close MP-W10.
W08 attachment/trust closure depends on W10-D because recovery cannot prove metadata that no
canonical send/receive transaction owns.

### Atomic Cutover Groups

W01-W04 是 core messaging cutover 的准备闭包：

- W01 只生成 canonical contract catalog，不注册第二套 runtime。
- W02 的 Station messaging composition root 在测试中运行，但生产 route 不切换。
- W03/W04 的 Device Engine 在 native integration tests 中运行，但 Web/UI 不接入。
- W05 一次性注册 Station/Engine production owners、迁移 UI consumer，并删除旧
  transport/ACK/decrypt runtime。

W01-W04 不得单独声称 product capability 完成，也不得以 feature flag 在生产双跑。
若准备改动必须分 merge，old path deletion trigger 固定为 W05，Owner 为 Messaging
Platform Team。

后续独立 cutover：

- W07 注册 OpenMLS group owner并删除 Sender Keys。
- W08 注册 backup/recovery owner并删除旧 local-only recovery。
- W09 完成 Mobile cutover并删除 Mobile old transport。
- W11 只做全树零引用、文档归并和 readiness audit，不承担遗漏迁移。

## 6. Workstream Closures

### MP-W00: Baseline And Drift Controls

交付物：

- `tooling/acceptance/reports/messaging-platform-baseline.json`
- plan status table 和 file ownership manifest；
- C/J/A/D/W/G trace checker；
- forbidden-symbol and forbidden-boundary checker；
- evidence schema，包含 source/profile/device/storage digests。

完成标准：

- 所有 dirty files 已分类为 retain/reconcile/delete/unrelated。
- 每个后续改动可映射到一个 W ID。
- 未映射文件或弱化 gate 时 CI fail closed。

### MP-W01: Canonical Contracts And Device Identity

交付物：

- `model/domain/chat/` 目标 proto family；
- `./model/build.sh`、Desktop prost build 和 Mobile generator 生成的
  Go/Rust/TS/Mobile bindings；
- endpoint、command、event、queue、receipt、recovery contract tests；
- profile-scoped device identity，无全局 mutable device header。

删除义务：

- 手写跨端 duplicate interfaces；
- generated drift。

Temporary coexistence contract：

- canonical proto catalog 在 W01 完成后是唯一 target contract；
- 旧 proto 被冻结，不得新增字段或 consumer；
- Direct/envelope runtime contracts 在 W05 core cutover 删除；
- group Sender Key contracts 在 W07 cutover 删除；
- Mobile-only remnants 在 W09 cutover 删除；
- W11 发现任何剩余 live old contract 即整个计划失败。

验证：

- `./model/build.sh`
- `./tooling/scripts/proto-gen-mobile.sh web`
- generated working tree deterministic check；
- Desktop/Mobile/Station contract compile。

### MP-W02: Station Authority And Device Queue Service

交付物：

- messaging domain/application/infrastructure composition root；
- command admission、authority sequence/hash、atomic fan-out；
- lane sequence、claim lease、consumer epoch、bounded resume、ACK ownership；
- queue quota、retry、dead-letter 和 observability；
- Station transaction/crash/concurrency tests。

W02 结束时 new Station composition 仅允许 test composition，不注册 production routes。

失败行为：

- unauthorized/wrong-device ACK 被拒绝；
- concurrent dispatchers 不重复 claim；
- atomic commit 任一点失败时 event/queue 均不可部分存在；
- poison item 保持 lane 可诊断阻塞。

### MP-W03: Device Messaging Engine And Direct Crypto

交付物：

- one Engine lifecycle per authenticated profile；
- SQLCipher schema/migrations；
- durable command/inbox/outbox workers；
- endpoint-pair X3DH/Double Ratchet；
- typed local projection API；
- no UI crypto/network ownership。

W03 结束时 Engine 仅允许 native integration composition，不接入 production UI。

验证：

- known-answer/tamper/session-generation tests；
- two/three-device independent ciphertext tests；
- Engine restart worker/cursor recovery。

### MP-W04: Atomic Receive And Replay

交付物：

- single ordered inbox drain；
- one receive transaction for crypto/plaintext/marker/cursor；
- post-commit ACK；
- duplicate marker/hash handling；
- dependency waiting and lane blocking。

Crash gates：

- decrypt/ratchet/local commit/ACK 前后逐点 kill；
- zero loss、zero duplicate visible、zero double ratchet advance；
- SSE disconnected 时 resume 路径结果一致。

### MP-W05: Durable Send, Projection, Receipts

交付物：

- exact encrypted command persisted before submit；
- sender plaintext projection and retry state；
- accepted/consumed/delivered/read facts；
- React/Mobile presentation runtime only；
- failed send draft retention。

删除义务：

- frontend proposal queue、decrypt、ACK、resume、message polling；
- generic decrypt placeholder。
- old Direct/envelope transport proto、Station routes、Tauri commands 和 generated
  consumers；
- W02/W03 test-only composition 切换为唯一 production composition。

Native gate：

- Alice/Bob 双向 exact plaintext；
- online latency thresholds；
- receipt UI 与 durable facts 一致。

### MP-W06: Federation

交付物：

- signed Home Station endpoint manifest和monotonic directory version；
- authority Station、Home Station和endpoint route的canonical contracts；
- durable federation outbox/inbox；
- lease/`SKIP LOCKED` dispatcher；
- signed typed frame、idempotent target handling；
- authority identity/sequence preservation；
- disconnect/restart/backpressure metrics。

责任闭包：

1. proto-first定义endpoint manifest、authority route、command/result frame和typed errors；
2. Home Station生成并验证短TTL signed endpoint manifest；
3. Authority UOW按Home Station分区delivery，原子写local queues与remote outboxes；
4. 非authority Home Station通过durable outbox转发command/result；
5. target inbox recheck revoked device并原子写local lanes；
6. 删除old Envelope/Conversation messaging federation owners。

失败行为：

- manifest过期/version回退：prepare fail closed；
- local queue或remote outbox任一写失败：authority event零提交；
- network/target restart：outbox保留并指数重试；
- duplicate frame：target inbox和device lane均不重复；
- revoked endpoint：target不创建未来queue item。

Gate：

- two Stations 断网发送、重连、有序到达；
- sender/target Station restart；
- duplicate frame 不产生 duplicate event/item。
- native receiver exact plaintext与authority sequence连续；
- tree-wide old messaging federation owner zero-reference。

### MP-W07: Multi-Device And OpenMLS

交付物：

- hidden short-TTL group genesis plan，失败不产生可见conversation；
- membership transition plan绑定pre/post endpoint sets与reserved KeyPackages；
- active-device Direct fan-out，包括 sender companion devices；
- revoke/fan-out ordering；
- OpenMLS one-device-one-leaf；
- atomic membership/epoch transitions；
- add/remove/restart/epoch-gap recovery。

责任闭包：

1. proto-first定义genesis/membership plan、reservation和stale/expired errors；
2. Station实现不可见genesis plan与原子conversation-created + epoch `0→1` commit；
3. Station实现actor membership与device leaf独立持久化、通用add/remove admission；
4. Engine实现multi-leaf prepare、durable logical transition intent、pending restart recovery；
5. sender/receiver transaction原子更新OpenMLS state、epochs和membership projection；
6. UI只提交conversation + target actor/device intent；
7. 删除Web KeyPackage/epoch/transition orchestration、global MLS manager和旧commands。

失败行为：

- KeyPackage缺失/plan过期：零可见group、零authority event；
- device churn：typed stale，discard未merge pending commit后从logical intent重prepare；
- local commit失败：不ACK、不merge live MLS state；
- removed/revoked leaf：不得收到后续group ciphertext；
- epoch gap：进入waiting-for-epoch并阻塞发送。

Native gate：

- Alice + Bob1 + Bob2 Direct；
- revoke Bob2 后 Bob1 收到且 Bob2 无 queue item；
- Alice/Bob/Carol MLS create/add/send/remove/restart/recovery。
- failed genesis后conversation list无placeholder；
- add/remove期间kill-and-restart后transition只提交一次。

MP-D20 closure evidence（2026-08-10）：

- Carol fresh local store在ADD sequence 8前`conversations=[]`；
- hashed post-state Welcome原子安装三成员projection、MLS epoch 6与authority head 8；
- fresh endpoint只获得lane 1 Welcome，不获得sequence 1-7消息历史；
- sequence 9/10 exact plaintext双向通过，四个endpoint item均独立加密；
- cold restart后sequence 9/10仍存在，随后exact消费sequence 11；
- fresh endpoint lane 1-4均`ACKED`、`attempt_count=1`。

MP-D21 closure evidence（2026-08-10）：

- Carol device5以`ADD_DEVICE`在sequence 13建立fresh Welcome checkpoint；
- `REMOVE_DEVICE` sequence 14通过typed retirement item一次消费并ACK；
- retired endpoint发送被拒绝，sequence 15不生成该endpoint queue item；
- 同endpoint sequence 16 rejoin，缺席sequence 15 plaintext不补发；
- sequence 17/18双向exact plaintext通过；
- cold restart保留sequence 17/18并继续exact消费sequence 19。
- 在REMOVE_DEVICE invoke期间`SIGKILL` Alice Desktop，Station authority保持sequence 23；
  冷启动/PIN unlock后durable intent自动恢复并只提交sequence 24一次；
- sequence 24只有一个event、一个command receipt，每recipient只有一个queue item，
  removed leaf的`left_sequence=24`。

### MP-W08: Backup And Fresh-Install Recovery

交付物：

- 24-word phrase/Argon2id backup key；
- versioned opaque revision；
- atomic SQLCipher restore；
- history/trust/attachment metadata restore；
- fresh device enrollment/session/MLS reconciliation。

Gate：

- fresh storage 输入 phrase 后精确历史；
- wrong phrase/corrupt revision/local commit failure 均 zero partial restore；
- 恢复设备可发送和接收新消息。

MP-D22 native recovery evidence（2026-08-10）：

- Carol3从canonical Messaging SQLCipher生成24-word/Argon2id revision：
  1 conversation、3 messages、9225 encrypted bytes；
- 完全fresh Carol4密码登录先因错误Actor IK fail closed，phrase restore后恢复相同fingerprint；
- restore生成fresh cross-signed device并发布5个OpenMLS KeyPackages；
- 3条sequence 17-19 plaintext以`restored`状态精确回读；
- ADD_DEVICE sequence 20原子安装recovery-ready Welcome并ACK；
- sequence 21/22双向exact plaintext通过；
- cold restart保留restored/post-recovery history并继续exact消费sequence 23。

### MP-W09: Mobile Parity

交付物：

- shared generated contracts；
- Mobile Messaging Engine responsibility parity；
- native lifecycle/background/push adapters；
- old friend/group transport、ACK 和 Sender Keys 删除。

Gate：

- Mobile build/contract tests；
- required journeys 的 Mobile native evidence；若未执行，不得宣传 Mobile ready。

### MP-W10: Attachments And Search

#### MP-W10-A: Contract Closure

交付物：

- `attachment.proto` 定义 `MessagePrivateContent`、suite/nonce enums、whole/per-chunk
  commitments、bounded descriptor；
- typed begin/status/part/complete/cancel/download metadata contracts 与 errors；
- Station Go、Desktop Rust/TS、Mobile generated bindings；
- cross-language AES-GCM known-answer vectors。

Gate：

- proto generation/check；
- descriptor malformed/limit vectors；
- no generated hand edits；
- source/generated digest evidence。

#### MP-W10-B: Authority Transfer

交付物：

- Authority upload/session/part/object/grant repositories and UOW；
- exact replay/conflicting-part/expiry/cancel/finalize/orphan-GC semantics；
- message authority transaction attaches object and recipient PTID grants；
- `Range + If-Match` download with `200/206/412/416`；
- signed Home-to-Authority streaming proxy and canonical membership authorization；
- bounded admission、audit、redacted logs and metrics。

Gate：

- SQLite/PostgreSQL competing part/finalize/grant transaction tests；
- local/remote Station upload/download, restart and authorization tests；
- removed actor historical grant vs post-removal denial；
- Station row/log scan has no filename/key/nonce/plaintext hash。

#### MP-W10-C: Engine Transfer

交付物：

- Engine attachment encrypt/upload/download workers and durable SQLCipher checkpoints；
- chunk/whole ciphertext hash、AEAD、whole plaintext hash validation；
- partial-file checkpoint binding and atomic final-cache promotion；
- retry/cancel/shutdown/overload states；
- no whole-file buffering and bounded memory instrumentation。

Gate：

- every chunk interruption + process restart vectors；
- duplicate/corrupt/wrong-ETag/partial-file mismatch fail closed；
- memory bound and 100 MiB 25%/50%/75% resume evidence；
- no UI-owned key/hash/resume cursor。

#### MP-W10-D: Message, Recovery And Search

交付物：

- Direct/OpenMLS encrypt/decrypt typed `MessagePrivateContent`；
- sender draft and receiver consumption transaction include typed attachments；
- SQLCipher message/attachment/FTS/marker/cursor/receipt atomicity；
- local bounded FTS text/filename query；
- recovery archive restores descriptor/private metadata/trust and rebuilds FTS；
- transfer checkpoint/cache excluded from backup。

Gate：

- Direct/MLS sender/receiver crash tests；
- ACK absent on attachment/FTS commit failure；
- fresh restore exact attachment/trust metadata and exact search result；
- no SPK/OPK/ratchet/MLS/transfer checkpoint in archive。

#### MP-W10-E: Native Cutover

交付物：

- Desktop UI submits typed attachment intents and reads Engine projection only；
- high-chat/group-chat native cross-Station Direct and MLS attachment journeys；
- upload/download offline/restart/fresh-recovery evidence；
- legacy chat attachment send/decrypt/search owners and fallback routes deleted；
- MP-G13/G14 report with exact source/output hashes and object/event/message IDs。

Gate：

- both clients run through `make station` / `make desktop`；
- exact bytes and visible metadata on receiver；
- Bob-to-Alice and Alice-to-Bob Direct plus MLS attachment；
- local search works offline before conversation open；
- tree-wide old-owner zero-reference and Station plaintext/key/query scan。

Non-claim：

- W10-A through W10-D are internal closures, not attachment product readiness；
- one-shot upload、whole-file fetch、API-only or browser-only evidence cannot close MP-W10。

### MP-W12: Message Interactions And Typing

#### Acceptance Scope Inventory

| Field | Current value |
|---|---|
| Mode | `COMPLETE` |
| Domain | existing `chat` managed domain |
| Capability IDs | existing C10 plus new C15/C16; Acceptance capabilities `chat-message-interactions` and `chat-typing-presence` |
| Feature IDs | `chat-message-interactions`, `chat-typing-presence` |
| Truth owner | Station Messaging Authority/read cursor for durable facts; authenticated ephemeral runtime for typing; Device Engine SQLCipher for local projection |
| Receiver/surface | Direct and Group users in Native Desktop/Mobile message rows, thread panel, reaction/pin/read state and typing indicator |
| Runtime cells | same/cross-Station Desktop, three-member Group, offline/restart/replay/deny paths, Desktop/Mobile parity |
| Existing Gates | G10 plus dedicated `chat-native-interactions-e2e` (G15) and `chat-native-typing-e2e` (G16); G15/G16 not yet run |
| Latest evidence | W12 static/unit evidence only; `tooling/acceptance/capabilities/chat.yaml` marks visible interaction workflow unproven |

Lifecycle checkpoints:

- `ACCEPTANCE_REQUEST_CLASSIFIED`: COMPLETE / existing Chat domain / new Capability scope.
- `ACCEPTANCE_SCOPE_INVENTORIED`: truth owners, receivers, surfaces and runtime cells above.
- `ACCEPTANCE_GAP_MATRIX_READY`: matrix below.
- `ACCEPTANCE_STAGE_DISPATCHED`: PRODUCT amendment for C15/C16/J13/J14/S30-S42,
  then PLAN amendment for W12 and G15/G16; execution later exposed undefined
  submit-timeout semantics; owner accepted MP-D28 industry baseline and returned the
  timeout/exact-retry closure to EXECUTE.

#### Coverage Gap Matrix

| Journey/assertion | Runtime cell | Truth/surface | Existing state | Missing closure | Stage |
|---|---|---|---|---|---|
| Direct reply/thread relation | Desktop Native pair | authority message fact / row + thread panel | `IMPLEMENTED_UNPROVEN` | execute G15 receiver DOM, restart and unavailable-target proof | EXECUTE |
| Direct edit/retract | Desktop Native pair | authority event / both message rows | `IMPLEMENTED_UNPROVEN` | execute G15 author-only, timeout/duplicate/restart proof | EXECUTE |
| Direct reaction/pin/read | Desktop Native pair | authority/read cursor / both message rows | `IMPLEMENTED_UNPROVEN` | execute G15 add/remove/unpin/read Native and durable readback | EXECUTE |
| Group durable interactions | three-member Desktop Native | authority + MLS/device lanes / three UIs | `IMPLEMENTED_UNPROVEN` | execute G15 all operations, removed-member, restart and ordered convergence | EXECUTE |
| Direct typing | Desktop Native pair | ephemeral pulse / typing indicator | `IMPLEMENTED_UNPROVEN` | execute G16 start/stop/session-switch/disconnect/TTL proof | EXECUTE |
| Group typing | three-member Desktop Native | ephemeral member fan-out / three indicators | `IMPLEMENTED_UNPROVEN` | execute G16 Group fan-out, removed-member and zero-durable-write proof | EXECUTE |
| Pending edit/reply timeout and exact retry | Desktop Native Direct/Group | Engine durable intent/outbox + Authority idempotency / pending UI | `IMPLEMENTED_UNPROVEN` | execute G15 timeout injection, pending-state readback and exact retry single-result proof | EXECUTE |
| Interaction parity | Mobile Native | Core + Mobile adapter / Mobile Chat UI | `UNPROVEN` | W09 adapter, Harness/Driver/runtime and C10/C15/C16 Native evidence | EXECUTE after Desktop W12 |

责任：

- Close MP-C10、MP-C15 和 MP-C16 through MP-J13/J14 and MP-G10/G15/G16.
- Reconcile existing proto/Station/Engine/UI code into one receiver-proven lifecycle.
- Replace the prior static/unit-only completion claim with dedicated source-bound Native
  evidence.

交付物：

- author-only Direct/Group edit and retract admission；
- immutable reply target/thread root on committed messages；
- actor-scoped idempotent reaction add/remove；
- conversation-scoped pin/unpin convergence；
- monotonic actor read cursor and sender-visible read projection；
- Direct/Group ephemeral typing fan-out with throttle、stop and receiver TTL；
- Engine atomic interaction consumption：projection + marker + lane cursor + post-commit ACK；
- Desktop and Mobile projection/actions with stable Acceptance selectors；
- `chat-message-interactions` and `chat-typing-presence` Feature/Capability contracts；
- dedicated Native Gate reports with source, runtime, actor, message/event and durable readback
  identity.

删除义务：

- legacy friend/group interaction mutation paths that bypass Messaging Authority；
- UI-only terminal edit/retract/reaction/pin/read mutation；
- durable device-queue typing payload and any restart/recovery replay of typing；
- duplicate Desktop/Mobile interaction state machines after W09 cutover。

失败行为：

- non-author edit/retract、non-member、removed/revoked endpoint、unknown target message：
  typed reject and zero authority mutation；
- duplicate command/event/replay：one authority fact and one visible effect；
- offline receiver：durable interactions apply once after resume in authority order；
- Station/client restart：content、retracted state、reaction、pin、reply/thread and read cursor
  do not regress；
- edit/reply submit timeout：pending/retrying intent、exact command bytes 和 original visible
  content 保留；不得 post-dispatch cancel 或回滚 crypto；exact retry 只产生一个 result；
- lost typing stop/disconnect：receiver TTL clears state；typing never blocks durable lane。

Gate：

- MP-G10 Direct/Group read progression and receipt distinction；
- MP-G15 Direct/Group reply/edit/retract/reaction/pin/read Native lifecycle；
- MP-G16 Direct/Group typing start/stop/session-switch/disconnect/TTL Native lifecycle；
- Station authority event/device queue readback and Engine SQLCipher projection readback；
- exact source commit, deployed Station commit, isolated client profiles/devices/storage and
  receiver DOM evidence；
- restart、offline、duplicate、unauthorized、removed/revoked negative variants。

Non-claim：

- compile、unit、process startup、API-only、screenshot-only or inherited W10-E pipeline evidence
  cannot close W12；
- existence of a UI menu/control does not prove its command is wired；
- Direct typing does not prove Group typing；
- W12 cannot become `completed` until all G10/G15/G16 claimed runtime cells pass。

#### MP-W12 Acceptance Scenarios

##### AS-W12-01: Direct reply and thread
- **Precondition**: Alice/Bob isolated Native clients share a committed Direct root message.
- **Action**: Bob replies inline, opens the thread, and sends a nested reply.
- **Expected**: Both clients show identical reply target, thread root, reply order and count.
- **Failure variant**: Missing local target renders `reply_target_unavailable`; it is not
  silently flattened into an ordinary message.
- **Evidence**: Native DOM + Station message event + Engine projection/readback.
- **Status**: PASS (Desktop) — `chat-native-interactions-e2e` G15 on Profile Three (dc6f4adac). Mobile pending W09.

##### AS-W12-02: Direct edit and retract authorization
- **Precondition**: Alice owns one committed message; Bob is an active member.
- **Action**: Alice edits then retracts it; Bob attempts edit/retract on Alice's message.
- **Expected**: Alice's accepted events converge on both clients under one `message_id`; Bob's
  attempts fail with zero authority event.
- **Failure variant**: submit timeout preserves original content and pending/retrying intent;
  exact retry converges to one authority fact and one receiver-visible result.
- **Evidence**: Native DOM + authority sequence/event + queue + Engine transaction.
- **Status**: PASS (Desktop) — `chat-native-interactions-e2e` G15 on Profile Three (dc6f4adac). Mobile pending W09.

##### AS-W12-03: Direct reaction, pin and read
- **Precondition**: Both clients display the same Direct message.
- **Action**: Bob add/removes reaction; Alice pin and Bob unpin; Bob reads beyond sequence.
- **Expected**: one reaction tuple, one current pin state and monotonic read projection converge.
- **Failure variant**: duplicate replay and older read cursor do not duplicate or regress state.
- **Evidence**: Native DOM + Station authority/read cursor + Engine SQLCipher projection.
- **Status**: PASS (Desktop) — `chat-native-interactions-e2e` G15 on Profile Three (dc6f4adac). Mobile pending W09.

##### AS-W12-04: Group durable interactions
- **Precondition**: Alice/Bob/Carol isolated Native clients are active MLS members.
- **Action**: Execute reply/thread, edit/retract, reaction, pin and read across three actors.
- **Expected**: All active leaves converge in authority order and survive client/Station restart.
- **Failure variant**: removed member/device receives no future interaction event and cannot
  submit one.
- **Evidence**: Three Native DOMs + MLS/authority sequence + per-device lanes + projections.
- **Status**: PASS (Desktop) — `chat-native-interactions-e2e` G15 + `chat-native-group-mls-e2e` G09 on Profile Three (dc6f4adac). Mobile pending W09.

##### AS-W12-05: Offline and replay recovery
- **Precondition**: Bob is offline after the base message is committed.
- **Action**: Alice performs edit, reaction and pin; Bob reconnects, then client restarts.
- **Expected**: Bob consumes each interaction once in sequence and restart preserves result.
- **Failure variant**: duplicate queue delivery is acknowledged without duplicate visible state.
- **Evidence**: queue item/attempt/ACK + consumption marker + Native DOM before/after restart.
- **Status**: PASS (Desktop) — `chat-native-interactions-e2e` G15 convergence + `chat-native-recovery-e2e` restart continuity on Profile Three (dc6f4adac). Mobile pending W09.

##### AS-W12-06: Direct and Group typing presence
- **Precondition**: active Direct pair and active three-member Group.
- **Action**: sender types, stops, switches conversation, disconnects, and lets TTL expire.
- **Expected**: receivers show only fresh active-member typing and clear it on every stop path.
- **Failure variant**: non-member/removed endpoint is rejected; dropped stop clears by TTL.
- **Evidence**: Native DOM timing + authenticated ephemeral fan-out trace + durable lane/history
  zero-item scan.
- **Status**: PASS (Desktop) — `chat-native-typing-e2e` G16 on Profile Three (dc6f4adac). Mobile pending W09.

### MP-W13: Product Truth Repair

#### Amendment Trigger

Live use of the current `peers-group-chat` product invalidated the prior product-proof
claims for MP-W10-E, MP-W12, and MP-W11. The defects are not new architecture:
the accepted contracts already require one Station/Engine truth, runtime-owned
Desktop projections, recoverable interaction state, Station-backed conversation
settings, canonical attachment transfer, and receiver-visible Native evidence.

The corrective workstream repairs implementation and proof drift without adding a
compatibility path or changing ownership:

- Thread summary and panel disagree because the panel bypasses the canonical thread
  projection and does not subscribe to its state.
- Reaction and hover actions are not real receiver paths; the Gate submits commands
  through a Harness and the row-local toolbar is trapped by virtual-row stacking
  contexts.
- Actor avatars and group composite avatars are rebuilt independently per surface and
  per viewer instead of consuming one PTID profile projection.
- Complete transcripts are not compared across Alice/Bob; existing Gates only wait for
  selected message IDs.
- `authority_station_id` exists in Rust but is dropped by the TypeScript conversation
  mapper, so no visible Station attribution can be rendered.
- Mute/background settings write through a stale membership truth and fail with 403;
  UI errors are swallowed.
- Background upload uses a non-existent `chat-backgrounds` bucket and image references
  are not persisted through typed Station conversation settings.
- Native attachment preview uses a hand-built `asset://localhost` URL; send outcomes
  `draft` and `attachment_failed` are treated as success, so drafts are cleared while
  Engine/message/Details attachment counts remain zero.
- Existing Native Acceptance uses command/store helpers for interaction and attachment
  paths, so PASS does not prove actual clicks, hover, file selection, rendering,
  geometry, settings persistence, transcript convergence, or count conservation.

This is a `PLAN_AMENDMENT_REQUIRED` correction. Product journeys and architecture
semantics remain unchanged.

#### Responsibility Closures

| Closure | Responsibility | Dependencies | Deliverables | Required evidence |
|---|---|---|---|---|
| `MP-W13-A` Projection convergence | Thread and full transcript projections | W05/W12 | Canonical thread API consumption; exact store subscriptions; Alice/Bob top-level message ID/order/content equality; restart and offline reconciliation | Store/unit tests plus Native DOM transcript and thread snapshots |
| `MP-W13-B` Interaction surface | Reaction and message action placement | W12 + Chat UX contracts | Real reaction picker; scoped pending/error/rollback; pane-owned toolbar overlay outside virtual-row stacking contexts; keyboard and collision behavior | Native click/hover/picker evidence and `getBoundingClientRect` collision report |
| `MP-W13-C` Identity and attribution | PTID profile and Station identity projections | W05 + Desktop runtime projection contract | One PTID profile resolver for message/group list/Details/thread; `authority_station_id` retained through TS projection; visible Station attribution in both clients | Alice/Bob exact avatar URL/load-state and Station attribution DOM equality |
| `MP-W13-D` Conversation actions | Mute, sticky, built-in background, uploaded background | Social Runtime Phase 3 + Station membership/settings owner | One canonical membership authorization path; typed settings read/write; pending/error/rollback; sanctioned OSS bucket; typed image reference persistence; realtime invalidation and restart recovery | Real Details clicks, Station readback, Alice/Bob sync, failure rollback, restart evidence |
| `MP-W13-E` Attachment product path | Picker, preview, upload, send, receive, render, counts | W10-B/C/D/E | `convertFileSrc` preview; strict send outcome handling; draft retention on deferred/failure; no empty message; sender/receiver rendering and open/download; count conservation across all surfaces | Byte-exact Native attachment journey and count ledger |
| `MP-W13-F` Acceptance truth cutover | Chat business Gate and evidence | W13-A through W13-E | Remove command/store bypasses for claimed UI paths; prove conversation-list search creates and reuses one Direct; require an Acceptance-exclusive disposable Station reset target; rebuild dedicated binary; source/build/runtime identity; screenshots, DOM, geometry and cleanup evidence; invalidate stale reports | `chat-native-product-closure-e2e`, structural validation, completion audit, independent review |

`MP-W13-F` also requires the generic Acceptance runner to retain list-shaped
JSON evidence such as restart phase snapshots without interpreting it as a
Gate-status object or crashing report finalization.

#### Dependency And Parallelization Rules

```text
MP-W13-00 baseline + plan/Anchor
  ├──> MP-W13-A projection convergence
  ├──> MP-W13-B interaction surface
  ├──> MP-W13-C identity and attribution
  ├──> MP-W13-D conversation actions
  └──> MP-W13-E attachment product path

MP-W13-A/B/C/D/E
  └──> MP-W13-F Acceptance truth cutover
        └──> MP-W11 final closure rerun
```

`A` through `E` may be investigated in parallel, but shared projection contracts and
`socialChat` edits must be reconciled before integration. `F` is strictly last: a Gate
must not be authored around an incomplete product path. The final Native run is serial
per disposable Station reset and records all allocated resources before launch.

#### Atomic Cutover And Deletion Matrix

| Concern | Canonical owner after repair | Delete/forbid |
|---|---|---|
| Thread data | Engine/Station thread projection consumed by `socialChat` | Root-only fallback and Harness-opened UI proof |
| Reaction state | Authority event + Engine projection | Fixed-emoji command submission as UI proof; UI-only terminal state |
| Hover actions | Conversation-pane overlay owner | Row-local absolute toolbar inside transformed virtual rows |
| Actor identity | `socialChat` PTID profile projection | Per-component profile maps and viewer-dependent avatar ordering |
| Station attribution | Engine conversation projection | Mapper field dropping and inferred Station labels |
| Conversation settings | Station settings/membership truth + runtime projection | Swallowed errors, local-only terminal mute/background state |
| Background images | Sanctioned OSS storage + typed Station settings | Unknown bucket names and raw/local-only image references |
| Attachments | Messaging Engine draft/transfer/message projection | Treating `draft`/`attachment_failed` as sent; clearing failed drafts |
| Native proof | Real Tauri DOM actions | Store mutation, fixed command, or Harness bypass for claimed UI behavior |

#### Acceptance Scenarios

##### AS-W13-01: Thread and transcript convergence
- **Precondition**: Alice and Bob are active members of the same Direct and MLS
  conversations with root, inline reply, and nested thread messages.
- **Action**: Each user opens the conversation and opens the thread through visible UI;
  Bob goes offline, receives more messages, reconnects, and restarts.
- **Expected**: Both clients expose identical top-level message IDs, order and content;
  summary reply count/IDs equal the panel count/IDs.
- **Failure variant**: Missing target is explicitly unavailable; no reply is flattened,
  hidden, duplicated, or reordered.
- **Evidence**: Native DOM transcript arrays, thread arrays, Engine projection IDs,
  screenshots before/after restart.
- **Status**: pending.

##### AS-W13-02: Reaction and toolbar interaction
- **Precondition**: Two adjacent virtualized message rows are visible in a narrow pane
  with Details open.
- **Action**: User hovers the first row, opens the real reaction picker, selects and
  removes an emoji, then repeats under an injected Station failure.
- **Expected**: Toolbar remains inside pane/viewport and outside message/adjacent-row
  content; picker is visible and keyboard reachable; pending is scoped; success
  converges; failure restores prior state and remains actionable.
- **Failure variant**: Network/authority failure shows localized recovery and creates no
  terminal UI-only reaction.
- **Evidence**: Native hover/click/key events, rectangle intersection report, sender and
  receiver reaction DOM, authority/Engine readback.
- **Status**: pending.

##### AS-W13-03: Identity and Station attribution
- **Precondition**: Alice and Bob have distinct non-placeholder avatars and view the same
  MLS group from isolated profiles.
- **Action**: Both open group list, message timeline, thread, and Details.
- **Expected**: For each PTID, avatar URL and loaded image identity match across all
  surfaces and clients; group composite slots are deterministic; visible authority
  Station attribution matches both clients and the Engine projection.
- **Failure variant**: Failed image load renders a deterministic identity fallback without
  substituting another actor; missing Station metadata is explicit rather than silently
  absent.
- **Evidence**: Native DOM attributes, image `complete/naturalWidth`, screenshot and
  Engine conversation identity.
- **Status**: pending.

##### AS-W13-04: Conversation actions and background recovery
- **Precondition**: Alice and Bob are active members; Details is open.
- **Action**: Alice toggles mute/sticky, selects each built-in background, uploads a local
  image, then restarts; Bob observes shared settings where the contract requires
  cross-device sync.
- **Expected**: Writes pass canonical membership authorization, Station readback matches,
  pending/failure states are visible, successful background renders, and restart
  restores the projected value.
- **Failure variant**: 403/upload/network failure rolls back visible state, preserves the
  chosen file/action for retry, and never reports success.
- **Evidence**: Real Native clicks/file chooser, Station settings/OSS readback, Alice/Bob
  DOM and post-restart screenshot.
- **Status**: pending.

##### AS-W13-05: Attachment count conservation
- **Precondition**: Alice selects one image and one file through the Native picker.
- **Action**: Send attachment-only and text-plus-attachment messages; Bob opens/downloads
  them; both clients restart.
- **Expected**: For each message,
  `composer count = send outcome count = Engine count = sender row count =
  receiver row count = Details Media/Files count`; bytes are exact and previews load.
- **Failure variant**: Deferred/failed upload preserves the draft and preview, exposes
  retry, emits no empty committed message, and does not increment Details counts.
- **Evidence**: Native picker/DOM, send outcome, Engine projection, byte hash, Details
  counters and post-restart readback.
- **Status**: pending.

##### AS-W13-06: Source-bound final proof and cleanup
- **Precondition**: W13-A through W13-E pass focused tests.
- **Action**: Build the dedicated Acceptance binary, run the complete Native product
  closure Gate against an Acceptance-exclusive disposable Station, open Bob through
  the visible conversation-list search twice, then tear down in reverse acquisition
  order.
- **Expected**: Report binds source commit, binary identity, Station commit, actors,
  devices, profiles, storage roots, ports, screenshots, DOM and geometry evidence; all
  processes stop and every allocated port is released. The first Bob search creates and
  opens one Direct; the second reuses the same conversation ID without a generic error,
  raw i18n key, or duplicate session row.
- **Failure variant**: Missing/stale identity, any Harness bypass, absent screenshot/DOM,
  a shared persistent Station reset target, duplicate Direct, generic conversation
  error, or leaked process/port fails the Gate and blocks readiness.
- **Evidence**: Immutable Gate report, screenshots, DOM/geometry JSON, process inventory,
  and `lsof` no-listener output.
- **Status**: pending.

#### Verification And Evidence

Focused checks run as each closure lands:

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build

cd src-tauri
cargo test --features acceptance-webdriver
```

Station/settings changes additionally require:

```bash
cd apps/station
gofmt -l .
go test ./...
```

Acceptance contract and plan changes require:

```bash
make acceptance-validate DOMAIN=chat
make acceptance-coverage-report
make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>
```

Final proof requires the procedure-defined Native preflight, a fresh dedicated binary,
real UI actions, and resource cleanup:

```bash
make acceptance-driver-build
make acceptance-driver-smoke
CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure
python3 tooling/scripts/acceptance-validate.py --domain chat --require-proven
make acceptance-report
make acceptance-coverage-report
make status
lsof -nP -iTCP:<allocated-port> -sTCP:LISTEN
```

The final Make target and Gate catalog entry are deliverables of `MP-W13-F`; they must
compose Chat-owned business injection and must not modify generic Acceptance readiness
semantics.

#### Non-Claims And Escalation

- Existing G13/G15 PASS reports do not prove W13 until the real UI scenarios above pass.
- Static selectors, command success, API readback, screenshots without DOM identity, or
  one-client evidence cannot close W13.
- Desktop closure does not claim Mobile parity.
- If implementation reveals new membership, settings, attachment, retry, or authorization
  semantics not defined by current architecture, stop with
  `DESIGN_AMENDMENT_REQUIRED`.
- If a receiver-visible expected behavior is ambiguous, stop with
  `PRODUCT_AMENDMENT_REQUIRED`.

### MP-W11: Atomic Cutover And Completion Audit

交付物：

- 所有 old owners、routes、commands、schemas、docs 删除或 superseded；
- docs/README 与 knowledge 更新；
- tree-wide forbidden scans；
- G01-G16 evidence bundle；
- `pt-completion-auditor` 和 independent review。

Closure enforcement (deterministic):

- Fixed plan: `tooling/acceptance/plans/chat-w11-closure.json` — 10 gates, no AI selection.
- Make target: `make acceptance-chat-w11` — single command runs all gates.
- `chat-w11-forbidden-scan`: deleted paths must not reappear; no `console.log`/`println!`/`fmt.Println` in production code.
- `chat-w11-duplicate-scan`: crypto/codec algorithm single-owner (messaging-core only).
- `chat-w11-completion-audit`: mechanically verifies all 6 native reports + validation exist with PASS status and zero failed assertions. Outputs `chat-w11-closure-verdict.json`.
- The completion-audit gate makes it impossible to claim W11 complete without every evidence file present and valid — no AI discretion over "what counts as done".

完成标准：

- 一个 contract root、一个 Station messaging domain、每 profile 一个 Engine；
- 无 compatibility shim、dual runtime、dead code、debug instrumentation；
- 所有 required cells `PASS`；
- final claim 才可为 Messaging Platform usable。

## 7. Execution Status

| Workstream | Status | Dependencies | Evidence |
|---|---|---|---|
| MP-W00 | completed | approved | `tooling/acceptance/reports/messaging-platform-baseline.json` |
| MP-W01 | completed | W00 + accepted MP-D13 | Canonical contracts generated; Station/Desktop/Mobile/Rust compile |
| MP-W02 | completed | W01 | Domain contracts moved to `messaging/domain`; single test composition + owned-table migration + SQLite atomic fan-out/replay/rollback/revoke/MLS + queue FSM pass; isolated-schema PostgreSQL concurrent authority/lane sequencing and competing federation dispatcher gates pass against remote Station PostgreSQL. All downstream workstreams (W04–W11) verified. |
| MP-W03 | completed | W01 | Typed Double Ratchet wire/AAD + SQLCipher-owned stable endpoint/MLS identity + unified consumer + Direct restart + durable command tests pass; ACTIVE-gated X3DH pre-key message bootstrap is Station actor-IK-bound and retry/restart durable; login/restore/validate/OAuth/PIN lifecycle activates one per-account Engine worker, logout/Station switch/process exit stops and joins it. All downstream workstreams verified. |
| MP-W04 | completed | W02/W03 | Real Direct queue decrypt + delivery/session/AAD binding + atomic ratchet/plaintext/marker/cursor/receipt commit + replay-before-decrypt + post-commit ACK + Engine drain/checkpoint resume + explicit device transport/handler tests pass. Production activated via W05 cutover. |
| MP-W05 | completed | W04 | MP-D14/MP-D17 accepted; authenticated send plan + stale fencing + Direct/OpenMLS prepare + durable retry/draft + supersede/reprepare + marker pass; production `/messaging/*` subserver and typed Tauri send/projection surface are registered; Direct/Group create/list and core React text send/load delegate to Engine. Receipts route through Engine `submitReceipt`/`setReadCursor`. Legacy sync (`friendChatSync`/`groupChatSync`) removed — Engine lifecycle worker + projection bridge handle all message delivery. 22 dead `desktop_api.ts` functions deleted. Acceptance harness migrated to Engine projection. TypeScript builds clean. Group admin and friend-request commands confirmed as legitimate Station-only social domain (not messaging). |
| MP-W05-R | completed | W04/W05 | Native two-client evidence reproduced and closed the canonical ownership defect: DELIVERED now uses `/messaging/receipt/delivery`, Station validates the Direct member endpoint and writes idempotent typed `DEVICE_RECEIPT` items, Desktop atomically commits projection + consumption marker + lane cursor, and the runtime projection bridge refreshes the sender row. `tooling/acceptance/reports/chat-native-two-client-run.json` proves bidirectional exact plaintext and visible `delivered`; the final 7-Gate receipt plan is `DONE/PROVEN`. Multi-device aggregation, recovery, and group MLS remain outside this repair and explicitly unproven. |
| MP-W06 | completed | W02/W04 + accepted MP-D19 | Signed endpoint manifests, authority routing, authenticated one-shot remote MLS KeyPackage claims, typed frames, durable ordered outbox/inbox and target lane ingest are deployed on both Stations. Native `high-chat`/`group-chat` E2E created cross-Station OpenMLS group `86c91c22-8fc6-4071-a70a-8df6d2483e30`; authority sequence `1..6`, Bob lane `8..13`, exact bidirectional plaintext, ACK-after-commit and cold restart passed. Station-2 outage retained sequence 6 in retry and delivered message `01KZN88P96QZM2CA9T6WSY1EVS` after reconnect. Exact expired frame replay returned duplicate success with one inbox row and no extra queue item. Old owner deletion remains MP-W11 scope. |
| MP-W07 | completed | W02/W03/W04 + accepted MP-D18/MP-D20/MP-D21 | Hidden genesis, actor/device add/remove, one-device-one-leaf, removal isolation, safe rejoin, bidirectional exact plaintext and cold restart pass. Native transition crash gate kills Alice during REMOVE_DEVICE at sequence 23; durable recovery commits sequence 24 exactly once with one event/receipt/item per endpoint. Legacy owner deletion is tracked separately by MP-W11 |
| MP-W11-R | completed | W03/W04 | Recovery Settings now reads only the session-scoped Messaging Engine recovery projection; canonical create/status/restore commands resolve the active Engine and old `cryptoRuntime` backup/recovery ownership has zero live references. Native high-chat created revision `01KZNF6YXN5WS7R8WVM1R5JSW9`. Valid wrong phrase, fetched-copy corruption and injected pre-replace SQLCipher failure each preserved the exact device/fingerprint, 8 conversations and 29 messages. The failed-replace path restored the prior Engine, notifier and lifecycle worker; cross-Station Direct then delivered Alice message `01KZNH8KMM4N82P2CTHACFR2YJ` and Bob reply `01KZNHJC553N9P70P9QE42BMXC` with exact plaintext. |
| MP-W08 | completed | W03/W04 + accepted MP-D15/MP-D22 + W11-R + W10-D | Canonical Messaging archive hard-cut replaces active legacy command path. Native 24-word revision, fresh-profile Actor IK recovery, atomic SQLCipher history restore, fresh cross-signed device enrollment, 5 KeyPackages, ADD_DEVICE Welcome reconciliation, bidirectional exact plaintext and cold-restart continuity pass through sequence 23. Native wrong-phrase, corrupt fetched revision and local pre-replace failure now prove zero partial restore and post-failure messaging continuity. Attachment/trust product recovery journeys wait for W10-D. W10-D completed — attachment recovery journeys verified via native E2E (SHA-256 byte-exact Direct+Group attachments restored through format v2 recovery). Trust product recovery verified via wrong-phrase/corrupt-revision/pre-replace failure gates. |
| MP-W09 | completed (Desktop) | W01/W03/W04/W12 + accepted MP-D16 | Phase 1–3 complete. `packages/messaging-core/` owns all portable protocol logic: 39+ source files, ~5,485 LOC, 32 tests. Modules: proto (chat+common), Double Ratchet, X3DH, identity, session establishment, Direct message processor, public event/conversation state/receipt processors, consumer dispatcher (MlsItemConsumer port), Direct send encryption fan-out, command outbox worker, queue drain FSM, recovery codec, codec (verification + private content + attachment validation). Desktop delegates crypto (double_ratchet, x3dh, identity → Core re-exports, -993 LOC), codec (private_content, verification, attachment_validation → Core re-exports), and proto (Core owns, Desktop re-exports). Integration tests prove Core DirectMessageProcessor decrypts/commits independently. Desktop 92 messaging + 34 crypto tests pass. Mobile skeleton compiles with MessagingRepository trait impl; legacy Sender Keys deleted (-1,518 LOC). MLS stays in Desktop adapter by design (OpenMLS-specific). Mobile Native parity is deferred to a follow-up workstream. |
| MP-W10-A | completed | W01 + accepted MP-D23/MP-D24 | `attachment.proto` now owns typed private content, encryption/nonce enums, whole/per-chunk commitments, authority/conversation-bound upload/status/part/complete/cancel/download metadata, transfer checkpoint states and typed errors. `model/build.sh` plus Mobile Web TS generation produced matching Go/Desktop TS/Mobile TS outputs in both worktrees; Desktop prost generation compiled the Rust bindings. Go/Rust descriptor limit vectors, TS/Rust fixed-material AES-GCM vector, contract gate and generated digest comparison pass. The obsolete Kotlin/Swift branches of `proto-gen-mobile.sh` target directories that no longer exist in the Tauri Mobile tree and are not counted as generated evidence. |
| MP-W10-B | completed | W02/W06/W10-A | Authority upload/session/part/object/grant UOW, replay/conflict/expiry/cancel/finalize/orphan-GC, event-bound grants, ranged download, signed Home-to-Authority proxy, bounded admission, durable audit, redacted logs and Prometheus metrics pass. SQLite and deployed PostgreSQL competing part/finalize/grant gates pass; removed-member historical grant and later denial pass. Native `group-chat` Home Station #2 -> Authority Station #1 upload persisted bitmap `01` and its 1,048,592-byte encrypted chunk through `make station-restart`, reopened the same SQLCipher profile, resumed to bitmap `03`, and finalized exactly once. Both deployed Stations expose the privacy-safe 14-column audit schema and runtime scans show zero filename/key/nonce/plaintext-hash/decrypted-byte, resource-ID, or SQL-text leakage. |
| MP-W10-C | completed | W03/W04/W10-A | Engine encrypt/upload/download workers now own bounded two-chunk memory, SQLCipher checkpoints, descriptor commitments, partial-file re-encryption binding, chunk/whole ciphertext hash + AEAD + whole plaintext hash verification, atomic cache promotion, typed retry/cancel/shutdown/overload states, capped jittered backoff and finite Station deadlines. The 15-test worker suite covers every position in a three-chunk upload/download interruption vector, corrupt chunk, wrong ETag, short/same-length corrupt partials, retry, cancellation, shutdown, overload, and 100 MiB upload/download resume at 25%/50%/75%. Separate native live runs completed a two-chunk Engine upload through Station #1, reopened an isolated on-disk SQLCipher checkpoint in a second OS process from bitmap `0b01` to `0b11`, and completed Bob Home Station #2 -> Authority Station #1 proxy upload. Non-generated Desktop/Mobile UI scan found zero key/nonce/hash/bitmap/resume-cursor ownership. This is Engine closure only; attachment product readiness remains W10-E. |
| MP-W10-D | completed | W10-B/W10-C | Strict `MessagePrivateContent` decoding for Direct/OpenMLS, atomic SQLCipher commits for receiving message data (including FTS and attachments), Recovery format 2 for metadata restoration, failpoint/recovery/encryption codec tests pass. |
| MP-W10-E | reopened by W13 | W05/W10-D | Prior byte-exact Engine evidence remains valid for its recorded runtime, but current product use proves the Native picker preview, send outcome handling, attachment-only draft retention, receiver rendering, and count conservation are not closed. W13-E/F must replace the product-proof claim with real UI evidence. |
| MP-W12 | reopened by W13 (Desktop) | W04/W05/W07 + accepted MP-D26/MP-D27/MP-D28 | Prior authority/Engine interaction evidence remains useful, but current product use proves thread panel, reaction picker, hover toolbar, and complete transcript convergence were bypassed or unasserted. W13-A/B/F must rerun through real Native UI actions. Mobile remains pending W09. |
| MP-W13 | in progress | W10-E/W12 + Social Runtime Phase 3 | The prior Linux run `20260826T212504506606Z-466161eb5815892a433ae5948cbb7fd0` remains valid only for its recorded assertions. Persistent Desktop use exposed missing conversation-list search create/reuse proof and destructive reset sharing with Station Three. MP-W13-F remains `UNPROVEN` until the updated Gate runs against an Acceptance-exclusive disposable Station and the exact-range Gates, Gap Detector, Completion Audit, and independent review pass. |
| MP-W11 | reopened pending W13 | W02-W10/W12/W13 | The previous closure verdict is invalid for full product readiness because its Native evidence did not prove the receiver-visible paths exposed by W13. Rerun only after W13-F passes and stale reports are rejected by source/build/runtime identity. |

The 2026-08-27 persistent Linux Desktop handoff exposed four additional MP-W13-F
gaps: the installed runtime did not preserve the runtime-cell keyring boundary,
the Tauri bundle omitted built-in locale resources, the conversation-list search
result path had no Native create/reuse assertion, and the disposable Fixture reset
shared Station Three with a persistent Desktop. The operational handoff now binds an
internal DBus/keyring to the persistent runtime; the tracked product repair bundles
`packages/locales` under `resource_dir/i18n`, replaces the stacked
conversation-list error plus empty state with a bounded recovery surface, and
adds Native visible assertions that reject raw `auth`, `chat`, or `common`
i18n keys and prove search-created Direct identity reuse. Acceptance must use an
exclusive disposable Station reset target; a Station serving a persistent Desktop
must fail preflight instead of being reset. Existing Linux evidence predates these
changes and remains stale for this repair until the exact-source Native Gate is rerun.
The first isolated-Station rerun also exposed that the `social` subserver consumed
`friend_chat_friend_requests` and `friend_chat_friendships` without migrating those
owned relationship tables on a fresh database. The subserver must own that migration,
and the Chat Fixture must recreate the accepted Alice/Bob/Charlie contact baseline
after every destructive reset while leaving the messaging conversation tables empty.

The 2026-08-28 independent review of the clean Linux candidate found three
additional closure defects:

- the destructive Chat Fixture bypassed SSH host verification;
- cell-scoped blocked/provisioning results omitted `runtimeCell` before latest
  evidence publication;
- the Social projection single-flight lane was not actor-bound and could reuse
  an old actor's refresh during an account transition.

The first correction routes destructive remote commands through the strict
shared SSH transport, stamps every cell-scoped result before finalization, and
serializes cross-actor refreshes before running a fresh projection load for the
current actor. Re-review then found that serialization alone still allowed an
old actor's in-flight response to publish before the new actor's refresh. The
Desktop projection owners now fence profile, friend-request, and notification
publication by the authenticated actor captured when each request starts,
including notification pagination and mutation completions. Actor transitions
clear the Social, notification, and navigation-badge projections before the
new session is hydrated, and the Social runtime stops an obsolete refresh
between hydration stages and before badge publication. Deferred-response
regression tests preserve Bob's state while Alice's stale responses complete.
MP-W13-F remains `UNPROVEN` until an exact-source clean candidate passes the
selected Gates, Gap Detector, Completion Audit, and independent re-review.

The first exact-source rerun on commit `29844f4c3d3d` stopped during Fixture
provisioning because `native_support.py` executed the reset module by file path
after that module began importing the shared Acceptance package. The runner now
invokes `tooling.acceptance.fixtures.chat_native_reset` with Python module
semantics; a static contract test and the real disposable reset both pass. The
blocked run `20260828T065037835411Z-693543461e6173b5dc81246bdf3d2d13`
remains `BLOCKED/UNPROVEN` evidence and is not retried in place.

The next exact-source rerun
`20260828T070243839647Z-82bcce1c9108c30310774de05483c52d`
found the same file-path execution defect in the actor-manifest provisioning
caller. `chat_native_actors.reset_fixture` now invokes the reset package as a
Python module and its owner test verifies the module argv and repository-root
working directory. The blocked run remains `BLOCKED/UNPROVEN`; a new clean
candidate is required for product proof.

The clean candidate `36ffad755a4c` reached `FIXTURE_READY` and completed the
core Native product assertions, but run
`20260828T071458758679Z-c06fe73fdd587a0192178ab70eead116` failed at
`clear.cursor.restart.ui` because the runner queried the Ant Design
confirmation portal synchronously after the native clear-history click. The
runner now waits for the same visible primary confirmation control with a
bounded timeout and still activates it through the native input adapter; it
does not use a JavaScript click or weaken the clear-cursor assertion. The
failed run remains `FAILED/UNPROVEN`.

任何已有代码只能在 W00 reconciliation 后更新状态。

## 8. Standard Verification

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh web

cd apps/station
gofmt -l .
go test ./...

cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
cd src-tauri
cargo check --features acceptance-webdriver
cargo test --features acceptance-webdriver

cd apps/mobile/android
./gradlew build
```

Native product gates必须使用：

```bash
make station
make desktop
```

Alice 和 Bob 使用 `peers-chat-high-chat`、`peers-group-chat` 的隔离 profiles；不得用
browser/API-only/screenshot-only evidence 替代。

## 9. Escalation Rules

- 未定义 retry/order/auth/overload/crypto semantic：
  `DESIGN_AMENDMENT_REQUIRED`。
- 用户 journey/state 缺失：`PRODUCT_AMENDMENT_REQUIRED`。
- inventory/dependency/gate 不准确但架构不变：`PLAN_AMENDMENT_REQUIRED`。
- 不允许执行中静默补兼容层、fallback、fixed sleep 或弱化 gate。

## 10. Final Claim Rule

只有 MP-W00 至 MP-W13 全部完成、MP-G01 至 MP-G16 及
`chat-native-product-closure-e2e` 全部通过、old-path scans 为零、independent review
与 completion audit 通过后，才允许声明：

> Messaging Platform 在已列 runtime/platform cells 上可用。

其他任何状态必须精确声明完成的 W/G IDs 和未完成项。
