# Messaging Platform — 集成与原子切换

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-08-08 | **Updated**: 2026-09-13
> **Owner**: Messaging Platform Team

---

## 1. Integration Rule

这是目标态替换，不是双运行时迁移。每个责任域必须以 execution closure 原子切换：

```text
new contract/owner ready
  -> all consumers switched
  -> native gate passed
  -> old source/path deleted
  -> tree-wide zero-reference proof
```

回滚通过 commit/deployment rollback，不通过永久 compatibility shim。

### 1.1 Accepted API Ownership Correction

Conversation is the sole Chat entry point at `/conversation/*`. Device, Inbox,
Recovery, Key Exchange, and Federation APIs are exposed by their resource owners.
MP-D30 corrects a verified pre-consolidation violation of this rule: the tree had
parallel business surfaces and authority-store families. The hard cut is defined
by `docs/architecture/api-ownership/integration.md` and requires:

```text
modern authority semantics -> Conversation owner and /conversation/*
device identity/inbox/recovery/key exchange -> their resource owners
attachment/typing/receipt -> Conversation-owned routes
cross-Station mechanics -> shared Federation transport
duplicate routes/types/stores/callers -> deleted in the same closure
```

Existing duplicate paths are implementation debt and may not be cited as an API
precedent or extended by new callers.

## 2. Pre-Consolidation-To-Target Ownership Map

| 当前责任 | 目标 owner | 切换要求 |
|---|---|---|
| conversation command/event | Station Conversation DDD Authority | 单一 typed framework + aggregate/UOW |
| envelope inbox/outbox | Device Queue/Federation services | lane/lease/ACK semantics 完整 |
| Web `imRuntime` receive | Device Messaging Engine inbox | Web 不再 resume/ACK |
| Web `cryptoRuntime` protocol | Device Messaging Engine direct/MLS | Web 只投影 security state |
| Web message decode | Engine receive transaction | plaintext 来自 SQLCipher |
| `localStorage` proposals | Engine command outbox | durable exact command |
| global device header | per-profile Engine endpoint | 所有 auth request 显式 endpoint |
| page-local freshness/poll | Engine lifecycle | single profile runtime |
| Sender Keys/group crypto | OpenMLS device leaves | old symbols/columns/proto 删除 |
| friend transport/API | Messaging commands/events | routes/commands/generated types 删除 |

## 3. Atomic Cutover Matrix

| Concern | New source | Cutover condition | Required deletion proof |
|---|---|---|---|
| Contracts | `model/domain/chat/*` | W01 catalog generated；W05/W07/W09 按 runtime owner 原子切换 | obsolete proto/messages 在对应 cutover 后 zero refs |
| Station authority | Conversation DDD command/event domain | Direct/Group command gates pass | flat Conversation + Messaging authority owners zero |
| Device inbox | Conversation delivery lane/lease service | replay/crash/fencing gates pass | superseded queue and envelope ACK/resume paths zero |
| Federation routing | signed endpoint manifest + authority outbox | D19 accepted；two-Station disconnect/restart gate passes | old Envelope/Conversation federation messaging zero |
| Submitted command reconciliation | canonical receipt/Federation outbox/Device Inbox readback | D31 accepted；loss/restart/exact-retry gates pass | proposal-specific result route/store zero |
| Cross-Station typing | Authority-mediated signed ephemeral Federation frame | D32 accepted；Direct/Group deny/TTL/overload gates pass | durable typing rows and per-domain peer transport zero |
| Follower membership | authority-signed public event projection at Home Station | D29 accepted；create/remove/gap/restart/settings gate passes | legacy Conversation membership authorization for Messaging IDs zero |
| Device Engine | native Messaging Engine | receive/send transaction gates pass | Web crypto/inbox ownership zero |
| Direct crypto | endpoint-pair engine | two/three-device gates pass | actor-wide session keys zero |
| Group crypto | OpenMLS engine | MLS journey gate passes | Sender Keys/Megolm zero |
| Group membership | Station authority plan + Engine logical intent | D18 accepted；genesis/add/remove/restart gates pass | Web KeyPackage/epoch/MLS transition orchestration zero |
| Recovery | Engine + opaque repository | fresh-install gate passes | local-only backup assumptions zero |
| Attachment transfer | Authority transfer service + Engine checkpoint | D23-D25 accepted；native offline/restart/recovery gates pass | legacy chat OSS ACL/send/search paths zero |
| UI projection | messaging runtime/store | native visible gates pass | decode/ACK/network retry in UI zero |
| Mobile | same contract/engine responsibilities | parity and native build gates pass | friend/group old send/ACK zero |
| Docs | Messaging Platform set | all current links point here | conflicting current-source claims zero |

### 3.1 Desktop/Mobile Core Cutover

> `MP-D16` accepted by Owner on 2026-08-09.

```text
portable core ports + tests complete
  -> Desktop adapter uses core
  -> Mobile adapter uses same core
  -> Desktop/Mobile native gates pass
  -> delete Desktop in-place protocol modules
  -> delete Mobile Sender Keys and old group/friend runtime
  -> tree-wide one-core/zero-Sender-Key proof
```

该 closure 不允许以下中间终态：

- Desktop 使用 portable core、Mobile 继续 Sender Keys；
- Mobile 使用复制的 OpenMLS implementation；
- platform adapter re-export 原 Desktop modules；
- 以 feature flag 在同一 client 双跑 old/new crypto；
- 两份 SQLCipher messaging schema 或 migration owner。

回滚必须回滚整个 W09 cutover commit/deployment，不恢复 Sender Keys compatibility path。

### 3.2 MLS Membership Cutover

> `MP-D18` accepted by Owner on 2026-08-09.

```text
authority plan contracts generated
  -> hidden genesis reservation + atomic genesis commit
  -> atomic add/remove actor/device admission
  -> Engine durable logical transition intents
  -> native create/add/remove/restart gates pass
  -> delete Web KeyPackage/epoch/MLS transition orchestration
  -> delete global/legacy MLS command owner
```

禁止中间终态：

- 可见epoch-zero placeholder group；
- 先写member row再异步提交MLS；
- UI枚举devices、claim KeyPackage或选择authority epoch；
- old conversation/group transition作为fallback；
- frontend accept/discard pending OpenMLS state；
- 通过隐藏failed group掩盖Station shared truth。

现有`CreateMessagingGroupConversation`先发布conversation、后做genesis的路径在cutover时
整体删除。不会新增abort API去清理已发布placeholder；新路径从源头不发布未完成group。

#### 3.2.1 Fresh Join Checkpoint

> `MP-D20` accepted by Owner on 2026-08-10.

```text
Station transition event includes hashed post-state snapshot
  -> added endpoint receives MLS Welcome
  -> Engine verifies strict fresh-join predicate
  -> one SQLCipher transaction installs MLS + projection + authority head
  -> ACK after commit
  -> later events require normal contiguous previous_hash
```

该cutover不引入旧event replay、独立snapshot endpoint或UI projection补丁。Desktop、
Mobile和portable core必须共享相同checkpoint predicate；任一端只实现“首event可跳跃”
而未验证Welcome/ADD/snapshot绑定，视为安全回归。

### 3.3 Federation Messaging Cutover

> `MP-D19` accepted by Owner on 2026-08-09.

```text
signed Home Station endpoint manifests
  -> authority plan binds routes and directory versions
  -> authority UOW atomically writes local queues + remote outboxes
  -> target inbox atomically writes local lanes
  -> two-Station disconnect/restart/duplicate gates pass
  -> delete old Envelope/Conversation messaging federation paths
```

不能把现有outbox/dispatcher单测当成跨Station能力证明；必须有authority producer、
Home Station route truth、target ingest和两个独立数据库的native receiver evidence。

#### 3.3.1 Submitted Command Reconciliation Cutover

> `MP-D31` amendment status: accepted (Owner accepted 2026-09-13)

```text
bounded result proto generated
  -> Conversation resolver reads canonical receipt/outbox/Device Inbox only
  -> Device Engine reconciles submitted commands on owned lifecycle wake
  -> exact NOT_FOUND retry and accepted/rejected local transactions pass
  -> loss/restart Native evidence passes
  -> proposal-specific result route/store remains absent
```

The resolver is read-only over shared truth. It must not claim an Inbox item, advance
an authority or lane cursor, mint a command ID, or create another result table.
Startup performs a one-time hard-cut normalization of historical payload-hash
command-result item IDs to the canonical
`(recipient endpoint, conversation_id, command_id)` identity. It preserves lane
sequence, payload, state, and receipt binding; malformed or conflicting rows fail
startup instead of enabling a permanent compatibility lookup.

#### 3.3.2 Authority-Mediated Ephemeral Typing Cutover

> `MP-D32` amendment status: accepted (Owner accepted 2026-09-13)

```text
typing payload proto generated
  -> Federation registry fixes CONVERSATION_TYPING to ephemeral QoS
  -> sender Home routes admission to Conversation Authority
  -> Authority validates membership and fans out by verified Home Station
  -> recipient Home typed receiver publishes to local Event Bus
  -> Direct/Group Native and zero-durable-row evidence passes
```

The cutover extends the existing signed Federation transport. It must not retain a
Conversation-specific peer client, durable typing fallback, or follower-owned member
fan-out.

#### 3.3.3 Home Station Follower Membership Cutover

> `MP-D29` amendment status: accepted (Owner accepted 2026-09-05)

```text
authority commit writes Station-addressed projection outbox + device batch
  -> target validates and atomically applies public follower projection
  -> device batch validates matching public event and enqueues private payload
  -> follower conversation/head/member repositories
  -> authority-signed event-log replay for missing base or gaps
  -> canonical Messaging membership reader
  -> typed member-settings path
  -> delete legacy thread/settings requests for Messaging conversations
```

该cutover必须保持：

- endpoint-private payload仍以opaque bytes写入device lane；
- follower projection只消费public authority event；
- projection target使用authority-persisted member Home Station route，不依赖active
  device；
- creation/member snapshot使用`ptid + home_station_id + role`，不存在target-side
  directory猜测；
- authority transaction持久化per-event projection grant，replay严格按requesting
  Home Station entitlement过滤；
- authority和follower repository按`authority_station_id`互斥选择，不双写同一truth；
- removal projection通过pre/post Home Station union送达，与device queue delivery解耦；
- missing base、gap、fork、invalid signature时settings fail closed；
- event-log replay不推进device lane、不生成missing ciphertext、不回滚follower head；
- authority event/projection grant co-retain；unexpected replay-source loss进入typed
  read-only，不能静默重建；
- thread summary/count来自Device Engine local projection，不回退legacy plaintext
  Conversation API。

Required deletion proof：

- Desktop canonical Chat 不再调用legacy JSON
  `/conversation/member/settings`与`/conversation/thread/counts`；
- Station canonical Messaging authorization不读取legacy
  `conversation_members`或`conversation_follower_members`；
- target ingest不解析`DeviceEventDelivery.endpoint_payload`，也不持久化已apply的完整
  public event bytes；
- queue-history/client-state membership inference zero；
- swallowed member-settings/thread-count authorization errors zero。

Required two-Station evidence：

- remote Direct和Group create后，Bob Home Station存在verified follower membership；
- duplicate frame/restart保持one head/one membership projection；
- zero-active-device member仍收到Station-addressed projection；
- gap触发event-log replay且replay前settings fail closed，missing device frame仍从
  source outbox exact retry；
- stale replay、wrong target/nonce、authority key mismatch和sequence rollback全部拒绝；
- late-join Welcome必须通过independent owner Home Station resolve建立authority pin，
  pre-join/post-removal replay拒绝；
- replay event/grant digest mismatch和unexpected source loss拒绝；
- sequence/event collision、wrong previous hash、buffer overflow/expiry进入明确
  fail-closed state；
- removal final projection把Bob置inactive，之后settings write明确拒绝；
- Alice/Bob Native settings、thread/toolbar journey无403或runtime-log audit failure。

### 3.4 Attachment Data-Plane Cutover

> `MP-D23`–`MP-D25` amendment status: accepted (Owner accepted 2026-08-10).

```text
canonical attachment proto + transfer/grant contracts
  -> Authority transfer service owns opaque object sessions and grants
  -> Home Station exposes only signed streaming proxy
  -> Engine owns chunk crypto/checkpoint/projection/FTS
  -> send/receive/recovery transactions include typed attachment metadata
  -> native cross-Station offline/restart/recovery/search gates pass
  -> delete legacy chat OSS ACL, Web attachment key owner and Station search route
```

Retained：

- generic OSS backend/blob/CAS adapters，只作为 Authority transfer service 的 opaque
  byte-store port；
- existing AES-GCM chunk algorithm only after its suite/nonce/tag/hash semantics move into
  canonical proto and cross-language known-answer tests；
- `oss://` resolver only as an internal `storage_ref` adapter, not as authorization truth。

Replaced：

- renderer-owned attachment encryption/upload orchestration；
- legacy friend/group attachment fields and Station conversation search；
- whole-file cache download/direct-final-path writes；
- legacy `friend_chat_sessions`-based chat object permission。

Required deletion proof：

- UI 不调用 upload part/complete、decrypt/hash-accept 或维护 durable transfer cursor；
- Station Conversation authority 是 descriptor validation 与 recipient grant 的唯一 owner；
- `conversation_search_messages` 和 server plaintext search 在 canonical Chat path zero refs；
- attachment filename/key/nonce/plaintext hash 不出现在 Station row/log/federation frame。

该 cutover 不能保留以下 fallback：

- canonical send 失败后回落 legacy friend/group attachment send；
- resume 失败后无 hash 地 whole-file accept；
- remote object 失败后返回 public/bearer URL；
- FTS 未命中时调用 Station plaintext search。

## 4. Required Tree-Wide Guards

CI scans must fail on：

- `friendChatSendMessage`、friend message ACK routes；
- Sender Key symbols和 schema；
- `[Message cannot be decrypted]` 作为 generic fallback；
- frontend calls to decrypt/DKX/inbox ACK/resume；
- frontend durable queue/cursor/device identity in `localStorage`；
- global mutable `DEVICE_ID` ownership；
- runtime `setInterval`/fixed sleep for message correctness；
- duplicate Direct/Group transport implementations；
- stale generated proto bindings。

## 5. Data Treatment

项目以 clean-slate platform 交付，不运行两套消息协议。开发/测试数据库和本地 profile
使用新 schema 重新初始化。用户级 recovery 只针对新 Messaging Platform 产生的
backup revisions；不声称恢复无法验证密钥来源的数据。

## 6. Documentation Consolidation

Messaging Platform 接受后：

- `docs/architecture/encryption/` 仅保留其仍独立的密码学细节，否则内容归并后标记
  `superseded`；
- `docs/architecture/federated-im/` 的 conversation/federation messaging 内容归并；
- `docs/architecture/realtime/event-stream.md` 只定义通用 stream，不定义 Chat 消费；
- `docs/architecture/social-runtime/` 只定义 Social projection，不定义 message transport；
- `docs/client/chat/` 继续拥有跨端 UI/UX 合同。

不存在两个 active messaging architecture sources。

准备期间允许 new contract/test composition 与 current runtime source 同时存在，但 new
composition 不得注册 production route、UI consumer 或 feature flag。它不是兼容路径，
删除 trigger 和 owner 固定记录在执行计划的 Atomic Cutover Groups 中。

## 7. Operational Evidence

每个 cutover evidence bundle 至少包含：

- source commit/worktree digest；
- generated-contract digest；
- Station profile/database；
- client profiles、ports、storage roots、device IDs；
- exact commands 和 timestamps；
- Station authority/queue readback；
- Device Engine consumption marker/cursor readback；
- native UI exact plaintext and state；
- zero-reference scan。
