# Messaging Platform — 集成与原子切换

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-10
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

## 2. Current-To-Target Ownership Map

| 当前责任 | 目标 owner | 切换要求 |
|---|---|---|
| conversation command/event | Station Messaging Authority | 单一 typed framework |
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
| Station authority | messaging command/event domain | Direct/Group command gates pass | old conversation mutation paths zero |
| Device queues | lane/lease queue service | replay/crash/fencing gates pass | envelope ACK/resume paths zero |
| Federation routing | signed endpoint manifest + authority outbox | D19 accepted；two-Station disconnect/restart gate passes | old Envelope/Conversation federation messaging zero |
| Device Engine | native Messaging Engine | receive/send transaction gates pass | Web crypto/inbox ownership zero |
| Direct crypto | endpoint-pair engine | two/three-device gates pass | actor-wide session keys zero |
| Group crypto | OpenMLS engine | MLS journey gate passes | Sender Keys/Megolm zero |
| Group membership | Station authority plan + Engine logical intent | D18 accepted；genesis/add/remove/restart gates pass | Web KeyPackage/epoch/MLS transition orchestration zero |
| Recovery | Engine + opaque repository | fresh-install gate passes | local-only backup assumptions zero |
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
