# Messaging Platform — 执行计划

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
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

当前状态：`PLAN_APPROVED`（Owner approved 2026-08-08）。执行从 `MP-W00` 开始。

## 2. Scope And Non-Scope

范围：

- Model proto、Station Messaging Platform、Desktop/Mobile Messaging Engine。
- Direct、Group MLS、multi-device、recovery、receipts、attachments、search。
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
| MP-W06 Federation | C02/C03/C11/C12 | A02-A04/A06/A10 | D02-D05/D19 | G02/G03/G11/G12 |
| MP-W07 Multi-device/OpenMLS | C05/C06/C09 | A01-A08 | D06-D07/D18 | G03/G05/G06/G09 |
| MP-W08 Backup/recovery | C07/C08 | A05/A07 | D08 | G07/G08/G12 |
| MP-W09 Mobile parity | C01-C14 | A01-A12 | D01-D12 | contract/native mobile cells |
| MP-W10 Attachments/search | C13/C14 | A05/A11 | D11 | G13/G14 |
| MP-W11 Cutover/deletion/final audit | all | A01-A12 | D10/D12 | G01-G14 |

## 5. Dependency DAG

```text
MP-W00
  -> MP-W01
       ├──> MP-W02 ──> MP-W06
       └──> MP-W03
              │
MP-W02 + MP-W03
       └──> MP-W04 ──> MP-W05 ──> MP-W10
              ├────────> MP-W07
              └────────> MP-W08

MP-W01 + MP-W03 + MP-W04 ──> MP-W09

W02/W05/W06/W07/W08/W09/W10 ──> MP-W11
```

可并行：

- W02 Station substrate 与 W03 Device Engine substrate。
- W06 federation、W07 MLS、W08 recovery 在 W04 稳定后并行。
- W09 Mobile adapter 可在 shared contracts/engine semantics 稳定后并行。

禁止并行：

- Proto source 与 generated consumer adaptation。
- 同一 responsibility 的 old/new owner cutover。
- receive transaction 与 ACK semantics。

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

交付物：

- encrypted object descriptors、upload/download resume、hash validation；
- SQLCipher attachment projection；
- local plaintext FTS；
- backup/restore integration。

Gate：

- attachment send/download/offline/restart/recovery；
- search exact result；
- Station storage/logs 无 plaintext/key。

### MP-W11: Atomic Cutover And Completion Audit

交付物：

- 所有 old owners、routes、commands、schemas、docs 删除或 superseded；
- docs/README 与 knowledge 更新；
- tree-wide forbidden scans；
- G01-G14 evidence bundle；
- `pt-completion-auditor` 和 independent review。

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
| MP-W02 | in progress | W01 | Domain contracts moved to `messaging/domain`; single test composition + owned-table migration + SQLite atomic fan-out/replay/rollback/revoke/MLS + queue FSM pass; isolated-schema PostgreSQL concurrent authority/lane sequencing and competing federation dispatcher gates pass against remote Station PostgreSQL |
| MP-W03 | in progress | W01 | Typed Double Ratchet wire/AAD + SQLCipher-owned stable endpoint/MLS identity + unified consumer + Direct restart + durable command tests pass; ACTIVE-gated X3DH pre-key message bootstrap is Station actor-IK-bound and retry/restart durable; login/restore/validate/OAuth/PIN lifecycle activates one per-account Engine worker, logout/Station switch/process exit stops and joins it |
| MP-W04 | in progress | W02/W03 | Real Direct queue decrypt + delivery/session/AAD binding + atomic ratchet/plaintext/marker/cursor/receipt commit + replay-before-decrypt + post-commit ACK + Engine drain/checkpoint resume + explicit device transport/handler tests pass; production activation waits secure per-profile enrollment and W05 cutover |
| MP-W05 | in progress | W04 | MP-D14/MP-D17 accepted; authenticated send plan + stale fencing + Direct/OpenMLS prepare + durable retry/draft + supersede/reprepare + marker pass; production `/messaging/*` subserver and typed Tauri send/projection surface are registered; Direct/Group create/list and core React text send/load delegate to Engine. Mutations, receipts and remaining frontend/old runtime owners still require cutover |
| MP-W06 | in progress | W02/W04 + accepted MP-D19 | Signed endpoint manifest/authority routing contracts generated across Go/Rust/Desktop TS/Mobile TS; signed typed frame + verified peer-JWT key evidence + exact inbound claims/frame binding + real auth middleware chain + fenced durable outbox/dispatcher + atomic target inbox/device-lane ingest tests pass; authority producer, manifest service, command forwarding and two-Station native gates pending |
| MP-W07 | in progress | W02/W03/W04 + accepted MP-D18/MP-D20/MP-D21 | Hidden genesis atomically commits sequence 1/2 and native Alice/Bob projection; add/remove actor with Carol multi-device leaves, durable intent retry, removal cutoff and post-removal exact plaintext pass. MP-D20 fresh join passes native empty-history, hashed checkpoint, bidirectional exact plaintext, independent ACK and cold-restart continuity through sequence 11. MP-D21 ADD_DEVICE/REMOVE_DEVICE/retirement/rejoin passes absence isolation, bidirectional exact plaintext and cold-restart continuity through sequence 19. Transition kill/restart and old-owner deletion remain pending |
| MP-W08 | in progress | W03/W04 | MP-D15 accepted; deterministic certificate + Actor IK pinning + verified-only queue eligibility + durable retry + atomic restore pass; production enrollment/recovery routes are active; ACTIVE-gated SQLCipher SPK/OPK and OpenMLS KeyPackage generation, exact-byte retry, provider-pool restart recovery, and Station verified-device publication gates pass. Native fresh password login currently generates a different Actor IK and enrollment correctly fails closed; secure Actor IK recovery/device-link journey remains pending |
| MP-W09 | pending | W01/W03/W04 + accepted MP-D16 | Portable shared-core architecture accepted; execution-plan decomposition required before atomic Desktop/Mobile cutover |
| MP-W10 | pending | W04/W05 | — |
| MP-W11 | pending | W02-W10 | — |

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
cargo check --features e2e-testing
cargo test --features e2e-testing

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

只有 MP-W00 至 MP-W11 全部完成、MP-G01 至 MP-G14 全部通过、old-path scans 为零、
independent review 与 completion audit 通过后，才允许声明：

> Messaging Platform 在已列 runtime/platform cells 上可用。

其他任何状态必须精确声明完成的 W/G IDs 和未完成项。
