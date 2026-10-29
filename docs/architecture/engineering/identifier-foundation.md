# Peers-Touch 标识族（Identifier Foundation）

> **Status**: active
> **Created**: 2026-10-28
> **Owner**: Architecture Team
> **Canonical code**:
> - 网络身份（密码学）：`apps/station/frame/touch/model/peer/`、`apps/station/frame/core/plugin/native/`
> - 域资源标识（生成器）：`apps/station/app/internal/identity/identifiers.go`

本文是“Peers-Touch 网络里谁有什么 ID、由谁生成、能否拨号”的唯一术语与归属来源。

## 1. 两个正交的标识族

Peers-Touch 只有两个标识族，**禁止互相转换或混用**。

| 族 | 例子 | 由谁产生 | 是否有密钥 | 能否拨号/验签 | 归属 |
|---|---|---|---|---|---|
| 网络身份 Network Identity | `12D3KooW…` | ed25519 私钥经 libp2p `peer.IDFromPrivateKey` 派生 | 有 | 能 | frame peer/trust |
| 域资源标识 Domain Resource ID | `fed_01J0…`、`evt_01J0…` | `app/internal/identity` 的前缀 + ULID 生成器 | 无 | 不能 | app/internal/identity |

判据：**能被网络连接、需要被对方验签的实体用网络身份；只是被持久化引用、没有 socket 的实体用域资源标识。**

### 1.1 网络身份（密码学派生）

- **Station Root PeerID**：逻辑站点长期身份，来自 `bootstrap.key`（Station root key）。一个逻辑 Station 一个；多节点集群共享。它签发 node 授权。
- **Node Host PeerID**：物理节点的 libp2p Host 身份，来自 `station-node.key`，每节点独立。Circuit、Direct、内层 TLS SPKI 都绑定它。
- **Relay PeerID**：Relay 进程的 Host 身份，只在 Circuit ACL / route 签名中有意义，不产生账号或成员身份。
- **Actor/Device**：Actor 跨站身份是 `ActorRef + federated handle + station_peer_id`；设备另有会话与端到端密钥，不与站点/中继密钥复用。

这些 ID 的信任链（root → node authorization → route attestation → inner TLS SPKI）由
`model/domain/peer/*.proto` 与 frame 的 trust 验证器定义，不在本文重复。

### 1.2 域资源标识（生成器派生）

不是网络节点、没有密钥的持久实体使用带前缀、按时间可排序的 ULID。唯一生成入口是
`app/internal/identity`：

```go
identity.NewFederationID()  // fed_<ULID>
identity.NewLedgerEventID() // evt_<ULID>
identity.New(identity.KindFederation)
identity.KindOf(id)         // 解析前缀，校验 <prefix>_<26 位 ULID>
```

- **Federation** 是一个虚拟治理网络（一张 Ledger），**不是网络节点**：它不监听端口、
  不在 DHT 里、不能被拨号。因此 federation_id **绝不能**是 peer id。运行 federation 的
  sequencer 才是一个可拨号 Station。这是 federation_id 用 `fed_` ULID 而非 `12D3…` 的原因。
- **Ledger Event** 是账本事实，用 `evt_`；治理事件另有顺序号 `seq` 与哈希链，`evt_` 只是其资源主键。

新增一种资源标识的唯一合规方式：在 `identity.Kind` 注册前缀并经 `New(kind)` 生成，
禁止在业务代码里再写 `"<prefix>_" + ulid.Make()` 字面量。

### 1.3 确定性 / 内容派生标识

部分 ID 不是随机生成，而是由内容确定性派生（用于幂等与等价重放），不经过 ULID 生成器，
但其前缀与域仍须在本文登记：

- Direct 会话：`direct-<sha256(canonical(actors))[:16]>`
  （`conversation/domain/valueobject.DirectConversationID`）。
- 会话事件：`<sha256(conversation,command)>[:16]`
  （`DeterministicEventID`）。
- Command/Plan/Message 等：ULID 或 ULID 派生，沿用各域既有合同，不做本次迁移。

## 2. 作用域引用（Scope）与会话

Conversation 的授权 scope 是一个**判别值对象**（`conversation/domain/valueobject.Scope`），
不是字符串、也不是新的身份族：

- 跨站会话：`Federation(federation_id)`，引用一个 Federation 资源 id（`fed_…`）。
- 同站会话：`Local(station_peer_id)`，由 Actor Home Station 归属派生；它绑定一个网络身份
  （Station PeerID），但**不是 federation、无账本、无生命周期、不入 federation 表、不可邀请/加入/退出、
  不得跨站复制**。

两种变体由 `ScopeKind`（`local` / `federation`）判别：

- `Scope.Canonical()`（`local\x00<station>` 或 `federation\x00<fed_id>`）进入会话事件哈希链与乐观锁，
  非空且确定；
- 持久化到 `conversations.scope_kind`（非业务空值）+ 可空 `federation_id`，Local 行
  `federation_id` 为 NULL，其 station 复用 `authority_station_peer_id` 列；
- frame 不依赖 app 值对象，在 `social_gate` 自带 `ScopeKind` 简单契约做跨站分流，
  不再使用 `local:` 字符串前缀。

详见
[可达对等联邦执行计划](../domains/federation/execution-plans/20261028-reachable-peers/plan.md)。

## 3. 归属与依赖方向

```text
model/domain/peer (proto 合同)
  <- frame/touch/model/peer trust + native transport   # 网络身份唯一来源
  <- app/internal/identity                               # 域资源 ID + local scope
       <- app/subserver/federation (fed_, evt_)
       <- app/subserver/conversation (scope 引用、确定性会话 ID)
```

- frame 模块不依赖 oklog/ulid，不生成 `fed_`/`evt_`；它只管网络身份与字节传输。
- app 域可以引用网络身份字符串（station_peer_id），但不能据此“派生”新的 PeerID 或密钥。
- Relay、bootstrap seed 都不获得 federation_id；它们是传输实体，不是治理实体。

## 4. 既有内联生成点（迁移登记）

收口目标是所有前缀资源 ID 经 `identity` 生成。当前已迁移：

- `federation_service.CreateFederation`：`fed_` → `identity.NewFederationID()`
- `ledger_service.generateEventID`：`evt_` → `identity.NewLedgerEventID()`

仍为各域既有合同、暂不在本批迁移的 ULID 用法（request id、events bus、notification、
oss、dashboard 等原始 ULID 或自有时间熵来源）保持现状；当它们需要稳定前缀/跨域引用时，
应先在 `identity.Kind` 登记再迁移，不新增第三种生成风格。
