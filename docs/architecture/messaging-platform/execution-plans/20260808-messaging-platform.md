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
| MP-W13 | current Linux delivery candidate pending exact-source revalidation; macOS, Windows, and Mobile `UNPROVEN` | W10-E/W12 + Social Runtime Phase 3 | Historical aggregate `20260830T052209499498Z-ff6c99fc6e262b23e876f2c2e191a067` proved commit `c69ed69bb6d8d6e7cf2275f0ce2c76a39f35049b`. The current candidate semantically overlays that search-selection fix onto the canonical `peerPtid` migration from `origin/master`; it must produce a new source/Station/runtime-cell-bound 18-Gate aggregate before delivery. |
| MP-W11 | pending current Linux delivery-candidate revalidation | W02-W10/W12/W13 | Run final closure only after the integrated MP-W13-F candidate passes the exact-source aggregate and stale reports are rejected by source/build/runtime identity. Platform-wide readiness remains open because macOS, Windows, and Mobile are independent `UNPROVEN` claims. |

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

Candidate `110dbbad60db` passed
`chat-native-product-closure-e2e` on `desktop-linux-native` in run
`20260828T074608576954Z-cd10745b330bbc28cfb4196887206332`.
The exact-range receiver Gate then exposed a plan inventory gap:
`native_two_client_runner.py` still constructed a local Tauri binary and could
not consume the selected Linux runtime cell. NDR-W6 now includes that runner
in the existing `NativeDesktopRuntimeBinding` cutover. The two-client actors,
message and receipt assertions, selectors, timeout, and validator remain
unchanged; runtime identity, binary identity, and cleanup evidence become
cell-bound. MP-W13-F remains `UNPROVEN` until the migrated receiver Gate and
the final audits pass.

Independent review held the first migration candidate because its report and
validation path were not yet durable enough for receiver proof. The corrected
Gate publishes its canonical report and validation into the active Evidence
Store run, accepts only digest-verified same-run `ArtifactRef` evidence, embeds
the immutable environment manifest, and binds orchestrator, clean Station,
runtime-cell run, remote clean checkout, image, and binary identities. Failed
journeys retain the first failed step and structured reverse-order cleanup
evidence. The W8 aggregate Make entrypoint now passes the selected runtime cell.
No Direct-message, receipt, actor, selector, ordering, or timeout assertion was
changed. A new clean commit and Linux Gate run are still required.
The exact-range Make wrapper now also uses the external Evidence Store instead
of the removed repository-local `latest-plan.json` path.

The first migrated receiver run
`20260828T084905253937Z-1291c790a349a9db82599f911b46fd62`
reached the Linux client but compared the legacy numeric login actor ID with
the canonical PTID from the actor manifest. The runner now follows the existing
product Gate contract: authenticate, hydrate the active actor, then compare the
hydrated canonical PTID. Failed startup is left to the registered reverse-order
cleanup path, and logout is attempted only for sessions that actually
authenticated. The failed run remains `FAILED/UNPROVEN`.

The next run reached `conversation.open` and exposed that
`syncFriendSession` still called the retired `/conversation/messages` path
after Direct creation had moved to `messaging_create_direct`. The Chat
Acceptance harness now refreshes the modern local messaging projection, and
the two actors independently create and verify the same deterministic Direct
conversation ID before the unchanged DOM delivery assertions begin. The failed
run `20260828T085732134439Z-30c988bdd7e9f18a9b3e8b2d5bee1ef6`
remains `FAILED/UNPROVEN`.

Run `20260828T091038659436Z-471b23e7332f1b14a61711e635c9b47c` on
`e601b35abf92` passed the full bidirectional receiver journey and cleanup, but
the aggregate Gate remained `PARTIAL/UNPROVEN` because its validator conflated
the Provisioner runtime-manifest run ID with the Evidence Store run ID. It also
required actor app-log artifacts that the remote runtime exported only after
the runner's evidence collection point. The validator now compares the
embedded manifest with the digest-verified same-run environment artifact, and
the runner persists remote app logs after actor stop and before temporary-log
cleanup. A new exact-source run is required.

Run `20260828T092318799925Z-63e2e7ecda28238b1087044d363a730a` on
`957eeda37608` produced `DONE/PROVEN` product and validation artifacts with
source-matched Station, Linux cell, binary, actor logs, DOM, screenshots, and
cleanup. The generic Acceptance aggregate still remained `PARTIAL/UNPROVEN`
because it selected the validation JSON as the primary environment artifact
instead of the canonical Gate report. The runner now deterministically prefers
the current Gate's `acceptance-gate-evidence-report` and uses validation only
for traceability metadata. A new exact-source aggregate run is required.


### 2026-08-28 MP-W13-F Linux Closure Audit

The clean candidate `f72f7d95091d` produced source-bound `DONE/PROVEN`
evidence for both required Linux runtime journeys:

- Product Gate
  `20260828T142622748616Z-bbff7c7eb9e2c2de7bc43b0ef990e94e`
  proved Direct search create/reuse with one list row, no forbidden or raw
  localized feedback, settings/background, attachments, offline and restart
  recovery, clear/restore, second-device recovery, and actor cleanup.
- Receiver Gate
  `20260828T150121373022Z-051e7bcc11587cb9ccd6d1fc36dc6217`
  proved bidirectional receiver-visible delivery and cleanup.
- Exact-range CI/static aggregate
  `20260828T150412143545Z-29c0e91144c9fe905af2deccfe4bade0`
  passed all eight selected structural and cheap Gates.

Independent review then found closure defects outside the product assertions:
the disposable reset policy did not hard-reject protected ports, Station
attestation bypassed strict host-key verification, the Gap Detector accepted
filtered exact-range plans, outer Provisioner cleanup lacked immutable
evidence, Product proof omitted the complete runtime-cell identity, and
member-settings migration/publication semantics were incomplete. The final
candidate closes those defects without changing product selectors, ordering,
timeouts, or success assertions. All source-bound runtime and exact-range
evidence must be regenerated after this documentation update. The external
Evidence Store remains the source of truth for those final run IDs.

The canonical exact-range audit then identified seven remaining environment
Gates without current-source proof. Six existing Native journeys are being
migrated from implicit local launch to the accepted Gate x runtime-cell
contract, with unchanged product assertions:

- `chat-native-interactions-e2e`
- `chat-contact-message-resilience-e2e`
- `chat-native-typing-e2e`
- `chat-native-multi-device-e2e`
- `chat-native-recovery-e2e`
- `chat-native-group-mls-e2e`

Their Catalog and Make entrypoints now require an explicit runtime cell, their
reports use the current external Evidence Store run, and their source identity
checks share the same Linux host/image/checkout/binary requirements. The
multi-device Gate delegates same-actor identity-key preparation to the runtime
storage owner. The seventh Gate, `chat-desktop-gateway-e2e`, no longer treats
its external provision log as a repository-relative path or misclassifies
arbitrary provisioning `ValueError`s as port errors. All seven remain
`UNPROVEN` until executed from the next clean commit.

Pre-commit rereview additionally closed first-failure preservation, fail-clean
atomic actor-storage cloning on Linux and local macOS, report-path override,
and stale explicit-Gate command resolution defects. These are lifecycle and
evidence-integrity corrections only; the existing Chat assertions remain
unchanged. MP-W13-F remains `UNPROVEN` pending clean-commit runtime evidence.

The first runner-owned runtime-cell aggregate
`20260828T215129732499Z-90c1e42259dc905e86b4f1798cab1750`
passed six of seven environment Gates and all selected local/structural Gates.
`chat-native-interactions-e2e` exposed a sender-side catch-up race: a message
could be visible to the receiver while the sender had not yet consumed its own
authority event, and interaction submission validated the local committed
projection before running its preflight drain. The Desktop Messaging Engine now
drains before edit and metadata target validation. Focused Linux run
`20260828T235312023024Z-7035474534fefd51fcffa339de3a1432`
passed the unchanged Direct and Group interaction journey, including timeout
retry, authority/Engine/DOM convergence, and resource cleanup. MP-W13-F remains
`UNPROVEN` until the final same-source aggregate and downstream audits pass.

The same-source aggregate
`20260829T000748292834Z-3cdc5c9684fc2b2719e4a9f0595a52f9`
then executed all 17 selected Gates successfully on commit `d84076b40412`.
Quality review found that eight environment reports lacked independent
Phase/BOM/Spec metadata even though their canonical product reports, runtime
identity, and cleanup evidence were present. The generic runner had incorrectly
treated that omission as traceability `not-required`; the run is therefore
retained as historical execution evidence but not accepted as final review
proof. The runner now fails closed for this case, and the affected Chat reports
declare their existing MP workstream, Gate, scenario, and Feature identifiers.
The Chat capability graph also records the Linux-proven journeys separately
from macOS, Windows, Mobile, multi-node persistence, receipt aggregation, and
injected-network backoff scope that remains unproven. MP-W13-F stays
`UNPROVEN` until the corrected clean candidate, Completion Audit, and
independent review pass.

Focused Linux run
`20260829T073113740621Z-8e6bf85237eb3db7b715aa5523a759da`
then passed all 34 unchanged `chat-native-interactions-e2e` assertions at clean
commit `0d4ab0cf774441814b27ba281a3fa65ca70f9a3d`. Runtime evidence
shows Alice, Bob, and Charlie each restored into an authenticated ready shell
without any post-restore `kicked` response. Direct and Group restart
convergence, Station authority readback, Engine durable readback, Gate cleanup,
and outer runtime-cell cleanup all passed. The source, Station `18132`, clean
Linux checkout, and Desktop binary are bound to the same commit.

This focused result closes the restored-session identity defect but does not
complete MP-W13-F. The temporary debugger instrumentation and artifacts were
removed after verification, and the focused Desktop, Rust, and static checks
passed. A new clean exact-range aggregate, required-proven validation, Gap
Detector, Completion Audit, and independent review remain required.

Independent review of the subsequent clean candidate
`f00bfdde35675a206fb80490180149a9c28fd464` found that the W11 audit could accept
stale source evidence, did not mechanically require the MP-W13 Product Closure
Gate, and wrote its verdict to the repository instead of the external Evidence
Store. The review also found that restored account identity could still race a
concurrent account switch. The in-flight 20-Gate aggregate was stopped and its
runtime cell was cleaned; it is not final proof.

Before rerunning MP-W13-F and MP-W11 closure:

- the closure contract must explicitly bind `desktop-linux-native` and include
  `chat-native-product-closure-e2e`;
- every consumed Gate manifest and canonical report must match the current
  clean source, workspace, Gate, run, and claimed runtime cell;
- the closure verdict must be a canonical Evidence Store artifact; and
- account selection, token restoration, session commit, window binding, and
  messaging activation must preserve one coordinated account identity.

These corrections preserve the accepted journey and all existing product
assertions. They do not claim macOS or Windows parity.

Candidate `63655081df751593f8724a5f345a9f8efebae0e2` closes the W11 evidence,
redaction, and remote source lease findings. The Tauri identity path also uses
one transition boundary for PIN unlock, account switch, restore, session
commit, window binding, and Messaging Engine activation. W11 requires the
Product Closure Gate and validates each native report against the runner-owned
runtime-cell manifest, current clean source, binary digest, Linux host/image
attestation, Gate, run, workspace, and `desktop-linux-native` claim. Evidence
redaction occurs before first write, including the final manifest; post-run
scanning is read-only and includes role metadata. The remote source lease
survives a standalone `ready` process, is owner-released by a later `stop`, and
expires on the runtime-cell TTL.

Final review keeps MP-W13-F at `PARTIAL/UNPROVEN` because the HTTP Gateway
identity path still has three P1 gaps:

- `account_switch` can commit `active_account_id` without the target account's
  restored JWT and Messaging Engine profile;
- PIN unlock derives its actor from `account_id`, which is invalid when an
  OAuth `provider_user_id` differs from the Station JWT subject; and
- legacy PIN records without a persisted actor binding do not fail closed.

The remaining closure must make HTTP switch and unlock commit one prepared
account/JWT/actor/runtime tuple with rollback on failure. Injected-account
Acceptance must prove concurrent multi-account switching, provider-user/actor
divergence, legacy actor omission rejection, and preservation of the previous
tuple after a failed transition. The corrected candidate must then pass
focused checks, independent blocker review, deployment to disposable Station
`18132`, the exact-range Linux aggregate, required-proven validation, Gap
Detector, and Completion Audit.

The working-tree closure now commits one prepared account/JWT/actor/runtime
tuple across HTTP and Tauri entrypoints. Messaging Engine creation is separated
from worker activation so no worker starts before durable and runtime identity
commit. Post-takeover failure invalidates every local projection for the
revoked actor instead of restoring stale state. OAuth PIN unlock uses the
rotated JWT subject, and legacy encrypted sessions without an actor binding
fail closed.

The updated `chat-desktop-gateway-e2e` Gate uses Provisioner-owned disposable
actors and run-scoped storage. It verifies concurrent server-side lock
contention, account/actor/token-fingerprint/Engine equality,
`provider_user_id != actor_id`, missing-actor rejection, real durable-write
failure at the identity commit boundary during a cross-account transition,
tuple rollback, and registered cleanup before destructive mutation. Terminated
Messaging lifecycle workers are replaced before activation succeeds and are
excluded from identity readback. The Evidence Store preserves structured
`secretScan` metadata through strict schema validation while retaining
credential-value redaction.

Focused verification passes: Desktop check, `364/364` tests with one unrelated
environment test skipped, Desktop production build, Rust auth service `8/8`,
Tauri auth `4/4`, auth identity `1/1`, lifecycle `1/1`, HTTP Gateway `4/4`
with one environment test ignored, Chat Native static Gate, Chat structural
validation, Acceptance runner `48/48`, planner `9/9`, validator `8/8`, Infra
boundary `8/8`, Gap Detector `18/18`, coverage report `15/15`, and combined
Provisioner/Evidence Store tests `117/117`. The worker-liveness regression
passes `2/2` profile-worker tests, and the Acceptance WebDriver feature build
passes.

Independent final blocker review found no remaining P1 source defect. Its only
blocker is the absence of a source-bound runtime artifact for the uncommitted
implementation, so MP-W13 remains `PARTIAL/UNPROVEN` until a clean commit passes
the Linux aggregate, required-proven validation, Gap Detector, Completion
Audit, and `review-submit`.

The first aggregate attempt at `14e04370851f48847daf1dacfa53395286227ebf`
produced no product proof: Native and Desktop Gateway provisioning failed
closed because reset authorization was not exported, and the selected
Federation Gateway smoke lacked its declared environment Provisioner. The cell
cleanup completed. The next candidate adds only the missing
`local-desktop-gateway` provisioning link and must rerun the unchanged Gate
assertions against explicitly bound disposable Station `18132`.

The aggregate attempt at `7e1d321fc149e436feab6772e0f894bd0c8b6835`
also remained `UNPROVEN`: orphaned run-scoped SSH forwards blocked Native
client isolation, and the Desktop Gateway Provisioner bypassed first-write
redaction by streaming its process log directly into the immutable run
directory. The stale local forwards were released after ownership
verification. The Provisioner now stages process output outside the run and
persists it once through the canonical Evidence Store writer before audit.

The next candidate run at `682af3e96fc5a926e018ccbcb2d629df404ac8cd`
remained `UNPROVEN` because the disposable Station host exhausted its root
filesystem before Fixture reset. A whole-disk audit identified and removed
only 41.4 GB of reclaimable Docker build cache, preserving running containers
and volumes. The run also exposed a remaining D-07 wiring defect: Federation
Gateway smoke used caller-supplied ports instead of its Provisioner-owned
Runtime Manifest. The Gate now derives the Gateway, renderer, and Station
endpoints from that manifest; its product assertions are unchanged.

The exact-source Linux aggregate
`20260829T172402956898Z-bb3291653179b1ac01157ce6c8666670` at clean commit
`7dcdc71a22e8bf30b114b910a708c1d0cb6b2be0` executed all 10 selected Gates.
Six passed and four failed, so MP-W13-F remains `PARTIAL/UNPROVEN`. Source,
Station, remote checkout, Desktop binary, Linux host, WebKitGTK, workspace, and
cleanup identity were valid.

The four failures identify two implementation closures:

- Product Closure lost durable `active_account_id + has_session` after Station
  takeover invalidated the revoked session, so the second restart reached
  `session_missing`. Interactions and Typing also modeled restart as explicit
  logout plus fresh password login instead of persisted-session restore.
- Desktop Gateway did not compile the `acceptance-webdriver` feature in its
  Provisioner-owned runtime, so the planned durable identity commit failure
  injection could not execute.

The implementation must recommit the restored account state with the rotated
token, make Native restart helpers preserve and restore the existing session,
and build the local Gateway runtime with the Acceptance feature. Focused reruns
are diagnostic only. MP-W13-F still requires a new full exact-source aggregate,
required-proven validation, Gap Detector, Completion Audit, independent review,
and `review-submit`.

Working-tree Gateway diagnostic
`20260829T191005525236Z-4057c7f1e1106c911f843de1647f6a62` passed with
`DONE/PROVEN` Gate and cleanup evidence against disposable Station `18132`.
Because its workspace digest is dirty, it does not satisfy MP-W13-F
exact-source proof. The Provisioner now enables the Acceptance-only commit
failure path while binding its unused WebDriver listener to an ephemeral port,
and it refuses to replace an existing worktree/profile Desktop process.

The next clean-source aggregate
`20260829T203439484372Z-7c6fba9d9db5ce018b758a5e207fe73a` at
`d5b76eaf953504e0b599682a68472ccff04601f0` passed all 10 selected Gates and
all cleanup checks against disposable Station `18132`. Its canonical status is
still `PARTIAL/UNPROVEN`: `federation-desktop-gateway-smoke` omitted the
Phase/BOM/Spec traceability required for environment proof. The Gate now binds
its existing Federation Phase 1 `WS-6` workstream,
`desktop-federation-context-surface` capability, and
`desktop-federation-surfaces` Feature. MP-W13-F remains open until that
correction is committed and a new exact-source aggregate plus all final review
gates pass.

Exact-source aggregate
`20260829T220529357373Z-d9f2e09e9d76a4c60263e77bb47376bb` at
`3eb76b57745a31f5ad7b7b444922e8e74ff9579a` then passed the Federation smoke
with complete traceability and passed the other eight non-product-closure
Gates. Product Closure failed while opening a newly created direct
conversation from its first search result. Runtime evidence shows that the
conversation reached the Station-backed projection, while the UI handler
could return from a superseded `loadSessions` request before the winning
reconciliation published the conversation and therefore skip selection.
Cleanup passed for every Gate. MP-W13-F remains `PARTIAL/UNPROVEN` at
9 PASS / 1 FAIL.

The candidate repair treats the `messaging_create_direct` result as the
interaction's authoritative completion value: the UI selects and restores that
conversation ID immediately, then schedules `loadSessions` only as background
reconciliation. This matches the existing Contacts message path and prevents a
superseded reconciliation request from swallowing the user's click. Focused
selection tests, Product Closure static tests, Desktop check, Desktop tests,
and the production web build pass; clean-source runtime proof is pending.

Clean commit `c69ed69bb6d8d6e7cf2275f0ce2c76a39f35049b` then passed unified
aggregate `20260830T052209499498Z-ff6c99fc6e262b23e876f2c2e191a067`.
The aggregate contains all 18 selected Gates from the canonical range in one
immutable artifact and reports 18 passed, zero failed, blocked, partial,
incomplete, or unproven, with `completionStatus=DONE` and
`proofStatus=PROVEN`. Every Linux Native Gate binds source, disposable Station
`18132`, and `desktop-linux-native` cell commit to the same commit and records
successful cleanup.

Chat required-proven validation artifact
`chat-domain-validation/20260830T064910746621Z-3c12efb2bf7bcc2a8d86918770b4bd61`
marks all nine Chat capabilities `PROVEN`. Gap Detector accepted the exact
Linux MP-W13-F claim with all 18 selected Gates present and no gaps. MP-W13 is
therefore complete for Linux Desktop only; macOS, Windows, and Mobile remain
independent `UNPROVEN` platform claims.

### 2026-08-30 Current-Master Semantic Overlay

The Linux proof at `c69ed69bb6d8d6e7cf2275f0ce2c76a39f35049b` remains valid
only for that historical source identity. The delivery branch now integrates
the canonical `peerDid` to `peerPtid` migration from `origin/master` with the
already-proven interaction ordering:

```text
messaging_create_direct canonical result
  -> immediate canonical selection
  -> restore hidden local state
  -> background reconciliation
```

This is an implementation-level semantic overlay within `MP-W13-F`; it does
not change product behavior, runtime ownership, or the Linux-only platform
boundary. The integrated commit must rerun the same 18-Gate exact-source
aggregate, Chat required-proven validation, Gap Detector, Completion Audit, and
submit-time review before `MP-W13` and `MP-W11` can close for the current
delivery candidate.

The first rerun at `da45c293cdff4635116c4f3c8c28bc5a4dabbcff`,
aggregate `20260830T113117121389Z-78a35291fa86c1feb0642f2814c16183`,
stopped before product proof. The current four-file range selected 11 canonical
Gates, while this closure retains seven additional source-bound Linux
obligations from the prior 18-Gate set. Static checks still referenced the
pre-migration `peerDid` / `actor_did` names, the Native Tauri environment had
not joined the required service-kind cutover, and `proto-build` newline churn
made subsequent source attestation dirty. These are mechanical integration
corrections within `MP-W13-F`: update assertions to canonical PTID terms,
declare Station as the environment's endpoint-backed required service, restore
generated output, and rerun all 18 Gates. Product semantics and the Linux-only
claim remain unchanged.

Aggregate `20260830T114602576010Z-63749f7758dd30288b3fa9e3c4349697`
passed the corrected local structural Gates but remained `BLOCKED/UNPROVEN`
before Native product execution. Its first shared boundary failure showed that
the disposable Chat Fixture still inserted removed `sender_did` /
`receiver_did` columns instead of canonical actor PTIDs. The same hard cut left
the Federation gateway smoke reading removed `RuntimeManifest.station` data.
The next mechanical correction updates the Fixture and every affected Gate
consumer to the accepted PTID and `services.station` contracts, then reruns the
same source-bound 18-Gate closure.

Candidate `fde961da4bbe787d0053e778467005d60af9e8f2` contains that
correction. It also makes malformed preset PTIDs and malformed Station protocol
digests fail closed. Chat Native static, Chat and Acceptance Infra structural
validation, Desktop check/test/build, Station messaging package tests, runtime
provisioning self-validation, and the real disposable Station `18132` reset
pass. MP-W13-F remains `PARTIAL/UNPROVEN` until the candidate passes the full
exact-source 18-Gate aggregate and all downstream closure checks.

Exact-source aggregate
`20260830T122322895251Z-c5b825341dd29386af4f8c9755a3e8b5` at
`4786996440b62d67901ce16af225856718d1f1a1` reached the Linux Product Closure
Gate with valid source, Station, runtime-cell, and binary identity, then failed
at the shared pre-login `auth_logout` call because a freshly isolated client
correctly had no committed session. The aggregate was cancelled before
repeating that shared failure across the remaining Native Gates, and the Linux
cell was verified `CLEANED`. The dependency-ready correction is to remove only
the obsolete pre-login logout calls; authenticated cleanup logout remains
required. MP-W13-F remains `PARTIAL/UNPROVEN`.

The correction now removes that pre-login call from every shared and
Gate-specific Native initial-authentication path without weakening the product
`auth_logout` contract or changing Fixture accounts. Structural regression
tests prove that initial login and restart paths do not log out, while existing
authenticated cleanup paths still do. Focused Python tests pass 77/77; the
`chat-native-visible-static` Gate passes at
`20260830T131620861219Z-09126c6790ced771c627df7f8cc9d8a9`; Acceptance Infra
validation is `STRUCTURALLY_VALID` at
`20260830T131648607384Z-78a7f76a9d21c2a33cdb69d5721d24dc`; Station messaging,
conversation, and envelope package tests pass; Desktop check, 365/365 executed
tests, and build pass. A broad Chat validation run passed its six local Gates
and stopped only because `local-desktop-gateway` was not provisioned. MP-W13-F
remains `PARTIAL/UNPROVEN` pending a clean commit, deployment, and the full
exact-source 18-Gate Linux aggregate.

Committed candidate `b851d221d261cd121a7077675da6dd112ecaab54` was deployed
to disposable Station `18132`. Exact-source aggregate
`20260830T132324598993Z-79e0e453e8aef5eac9ee376f8cf2003a` passed the local
Gates and proved that Product Closure crossed the obsolete logout boundary,
then failed during Alice login because the active Station registry entry had no
`peer_id`. Product Gate
`20260830T132344829627Z-f0a80cc7b04fd137c080ac6e7541ae75` retained valid
source, Station, runtime-cell, and binary identity and completed cleanup
without errors; the aggregate was cancelled before repeating the shared
failure, and the Linux cell was verified `CLEANED`. The root cause is
`StationRegistry::add`: a fresh environment-seeded entry already owns the URL,
so the probed metadata from `station_add` is discarded as a duplicate. The
dependency-ready correction is to merge and persist probed metadata when
adding an existing normalized Station URL, with registry and command-path
regression tests. MP-W13-F remains `PARTIAL/UNPROVEN`.

The Station registry correction now atomically replaces an existing normalized
URL entry with the latest probed metadata while preserving the active URL.
Regression coverage starts from an environment-seeded entry, refreshes its
`peer_id`, reloads the persisted registry, and verifies that the selected
Station retains that identity. Normal and `acceptance-webdriver` Rust test
targets pass 6/6 in both library and application binaries; `cargo fmt --check`,
Chat Native static, Desktop check, 365/365 executed frontend tests, and Desktop
build pass. MP-W13-F remains `PARTIAL/UNPROVEN` pending a clean commit,
exact-source deployment, and the full 18-Gate Linux aggregate.

Exact-source aggregate
`20260830T145021738008Z-029197c13bff9a48a385efdb07150cb6` ran against clean
commit `7c5751f7ad0ca2cefd498d8eeeabd7b0a8f3fd09`, disposable Station `18132`,
and `desktop-linux-native`. The registry correction crossed the former missing
Station identity boundary, but the aggregate finished 9 PASS / 9 FAIL and
remains `PARTIAL/UNPROVEN`. All eight Native Chat Gates failed at initial
authentication after `auth_login` succeeded: the identity pipeline immediately
called `auth_restore_session`, whose local token validation required JWT `sub`
while Station's canonical JWT contract emits `subject_ptid`. The Desktop
Gateway Gate independently rejected the canonical `actor_ptid` response because
its assertion still required `ptid`. Every runtime-cell and Provisioner cleanup
completed successfully, and `proto-build` passed last. The next correction must
align Desktop token decoding and the Gateway assertion with the canonical PTID
contracts before rerunning the same 18-Gate aggregate.

The canonical PTID correction is implemented in the current delivery
candidate. Desktop local JWT validation now consumes only Station's
`subject_ptid` claim and rejects legacy `sub`-only identity. The Desktop
Gateway Gate now consumes `actor_ptid`, captures the local `account_id` from
the committed current-session tuple, supplies `actor_ptid` when creating the
OAuth PIN fixture, and removes the persisted `actor_ptid` for the legacy
negative case. Focused normal and `acceptance-webdriver` Rust auth tests,
40 Chat Python contract tests, `cargo fmt --check`, Desktop check, 365/365
executed frontend tests, Desktop build, Chat Native static, and Chat structural
validation pass. MP-W13-F remains `PARTIAL/UNPROVEN` until this candidate is
committed and the retained exact-source 18-Gate Linux aggregate passes.

Exact-source aggregate
`20260830T164444086098Z-99846680116645e083efe5ff478ec07d` ran against clean
commit `2e0a2d52d95d86f009a86f41571e14a1c409b690`, disposable Station `18132`,
and `desktop-linux-native`. It finished 9 PASS / 8 FAIL / 1 BLOCKED with
canonical `completionStatus=BLOCKED` and `proofStatus=UNPROVEN`; source,
Station, runtime-cell, binary, and cleanup identity remained valid.

The run exposed two remaining Acceptance business-injection boundaries:

- nine Native Chat Gate modules still read legacy `actorId` from harness
  results even though the harness emits canonical `actorPtid`, so the visible
  post-login identity is read as empty;
- the Gateway scenario deletes Bob's actor-scoped raw session when it
  PIN-protects the OAuth account for the same actor, then incorrectly attempts
  to restore Bob's password account; the prior-tuple rollback check must use
  Alice's independent account instead.

Both corrections remain inside the accepted MP-W13-F Acceptance scope and do
not change product semantics. MP-W13-F remains `PARTIAL/UNPROVEN`.

The Acceptance correction now consumes `actorPtid` consistently across all
nine Native Chat Gate modules and keeps the OAuth PIN failure-path baseline on
Alice's independent account after Bob's actor-scoped raw session is purged.
Regression coverage enforces a zero-hit legacy `actorId` scan and the
independent-account fixture. Focused verification passes 162/162 Chat Python
tests, 6/6 frontend Acceptance identity tests, Python compilation,
`git diff --check`, and structural validation for all nine Chat capabilities.
MP-W13-F remains `PARTIAL/UNPROVEN` pending a clean commit, exact-source
deployment, and the retained 18-Gate Linux aggregate.

Exact-source aggregate
`20260831T010051680324Z-9acc18252a3930520d39240dba1120f1` ran against clean
commit `6811189717933a5b68380dd6a2b9d07674c6eeb3`, disposable Station `18132`,
and `desktop-linux-native`. Source, Station, remote checkout, Linux
host/image, and per-Gate binary identities were bound correctly. Provisioner
cleanup passed for every environment-backed Gate and `proto-build` passed
last. The aggregate finished 11 PASS / 7 FAIL with canonical
`completionStatus=PARTIAL` and `proofStatus=UNPROVEN`.

The remaining boundaries are:

- Product Closure consumes the stale search-result `peer-did` attribute while
  the production surface exposes canonical `peer-ptid`.
- Interactions authenticates the Tauri window but reads engine evidence
  through the unrelated `http-gateway` session namespace.
- Station typing publishes ephemeral events under a numeric actor ID while the
  SSE receiver subscribes under canonical PTID; the Gate's first start/stop
  checks also skip receiver observation because of truthy-response
  short-circuiting.
- Native Group callers still send `memberDids` / `memberDid` after the harness
  contract moved to `memberPtids` / `memberPtid`.
- Native teardown calls HTTP Gateway logout for Tauri-window sessions, so
  `session_missing` is expected for that namespace and cannot be treated as a
  successful Native logout or hidden through an idempotent fallback.

The Gateway OAuth/PIN correction is proven by
`chat-desktop-gateway-e2e`, but MP-W13-F remains `PARTIAL/UNPROVEN`.
Required-proven validation, Gap Detector, Completion Audit, and review
submission remain blocked until focused corrections pass and a new clean
exact-source 18-Gate aggregate reaches 18/18 `DONE/PROVEN`.

The owner approved the correction cycle on 2026-08-31 with Linux as the only
compatibility and runtime-proof target. macOS, Windows, and Mobile remain
explicitly `UNPROVEN`; this cycle does not execute or claim those platforms.

The integrated correction is committed at
`a8fe6560adfe173dd447a857a7e525d38f04a71f` and pushed to
`origin/refactor/chat-acceptance-cutover`. A remote deployment attempt was
stopped before restart because a local cache had repurposed canonical profile
`three` for disposable endpoint `http://10.37.94.156:18132`, while the runtime
loader correctly selected the sibling environment repository's `three`
definition at `http://10.37.94.156:18080`. Exact source synchronization
completed on deployment node `10.37.94.156` and the build was interrupted; no
Gate ran and no runtime proof advanced.

MP-W13-F is blocked on an Acceptance/development-environment infrastructure
correction that gives the disposable Station a distinct canonical environment
profile and makes preflight plus runtime resolve the same worktree selection
through that source. MP-W13-F remains `PARTIAL/UNPROVEN`.

The correction now defines canonical profile `chat-native-disposable` for
deployment node `10.37.94.156` and disposable Station `18132`, removes the
shared selector from runtime resolution, and makes `make config` consume the
same resolver as deployment. Three isolated profile-resolution regression
tests, shell syntax validation, Skill validation, and `git diff --check` pass.
MP-W13-F is unblocked for exact-source deployment but remains
`PARTIAL/UNPROVEN` until the retained Linux aggregate passes.

Focused Linux aggregate
`20260831T060844651620Z-05ad6436b8ef2710f1319c3c90b4c63d` then ran against
clean source `d20a8f91a771fe36a9595ac5e9b9ecbd7b31c4c5`, disposable Station
`http://10.37.94.156:18132` on deployment node `10.37.94.156`, and runtime
cell `desktop-linux-native` on Linux host `10.37.246.80`. It completed
5 PASS / 2 FAIL. Interactions, typing, Group MLS, two-client, and recovery
passed. Product Closure failed when its first HTTP Gateway readback attempted
to consume a Tauri-window-authenticated session. Multi-Device passed all five
product assertions but failed its business cleanup because Bob1's expected
session takeover was not reflected in the Gate lifecycle ledger. Provisioner
cleanup passed for all seven Gates.

The approved MP-W13-F correction is:

- replace all Product Closure HTTP Gateway readbacks with bounded,
  actor-validated Tauri-window Harness readbacks;
- prove Bob1 reaches the revoked unauthenticated identity state after Bob2
  takeover, then record that explicit lifecycle transition before cleanup;
- retain fail-closed cleanup for any authenticated client that loses its
  session unexpectedly.

This is a plan bookkeeping amendment within the accepted window-session
ownership and multi-device handoff contracts. It does not change product
semantics. Product Closure and Multi-Device must pass focused Linux reruns
before the retained 18-Gate aggregate runs. macOS, Windows, and Mobile remain
`UNPROVEN` and outside this correction cycle.

Focused reruns at clean source
`468e1702d3948a0664d4e383a95516f8f8d4808e` then proved Product Closure run
`20260831T072850367906Z-48299bae1ba2d8e516ff92e97faa24f8` and Multi-Device
run `20260831T075347334163Z-3a9f81176291b81e572ff92dc0437d93` as
`PASS/DONE/PROVEN`, each with successful cleanup.

Retained aggregate
`20260831T075903155838Z-beb051cfed538a276e78ad01ade81cad` completed
18 PASS / 0 FAIL at the same exact source. It reports aggregate
`completionStatus=DONE`, `proofStatus=PROVEN`, zero missing traceability, and
successful cleanup for every provisioned Gate. Station evidence belongs to
deployment node `10.37.94.156` and endpoint `18132`; Linux Native runtime-cell
evidence belongs to host `10.37.246.80`.

Chat required-proven validation artifact
`chat-domain-validation/20260831T091909749786Z-2b1ccc9dd33b1a95af3c393e655d2fae`
marks all nine Chat capabilities `PROVEN`. Final closure nevertheless remains
`PARTIAL/UNPROVEN`: the canonical `origin/master...HEAD` plan additionally
selects `desktop-dev-runtime-isolation-static`, whose stale assertions still
required the retired shared `.local/dev/profile` selector instead of the
accepted worktree-specific active symlink plus sibling `env` repository
authority. The assertions are being aligned to that accepted contract. The
final exact-source aggregate must contain the union of canonical range Gates
and retained Linux closure obligations before Gap Detector, MP-W11 Completion
Audit, and submit review may close.

Final exact-source aggregate
`20260831T142010116108Z-14a6f4f74f887bfb8a34230afa060fef` at commit
`162d36a32d8bd5cb62d04f9f3c7caf83e3833b51` completed 19 PASS / 0 FAIL
with `DONE/PROVEN`, zero missing traceability, and successful cleanup for every
provisioned Gate. Station evidence belongs to deployment node
`10.37.94.156` and endpoint `18132`; Linux Native runtime-cell evidence
belongs to host `10.37.246.80`. Fresh W11 owner scans and Chat
required-proven validation passed, and Gap Detector reports no gap for the
Linux-only NDR-W7 / MP-W13-F claim.

W11 Completion Audit run
`20260831T153920368737Z-db1df6c1d9a07632118f5c542bdb8ff8` nevertheless
failed because the audit compares two source-identity representations as exact
dictionaries. Immutable Gate manifests use
`{commit, workspaceDigest, canonicalWorktreeHash}`; Native evidence reports
use `{commit, workspaceDigest, worktree}`. Commit `63655081d` introduced this
comparison without normalizing the already emitted Native report identity.
The audit must preserve commit, clean-workspace, and canonical-worktree
binding while comparing these representations. MP-W11 and MP-W13-F remain
`PARTIAL/UNPROVEN` until the audit correction, exact-source revalidation,
Completion Audit, and submit review pass. macOS, Windows, and Mobile remain
`UNPROVEN`.

The approved W11 correction is now implemented at the audit boundary. It
hashes the report's recorded worktree and requires the resulting canonical
identity, commit, and clean-workspace digest to match the Evidence Store
manifest. A different worktree remains a hard failure. The focused Completion
Audit unit suite passes 12/12; exact-source runtime revalidation remains
pending at the resulting commit.

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
