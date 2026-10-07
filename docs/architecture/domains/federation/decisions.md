# Federation Architecture — 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-05-31 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | Federation 是持久虚拟实体 | accepted |
| D-02 | Station 可以加入多个 Federation | accepted |
| D-03 | 联邦治理权限和普通社交权限分离 | accepted |
| D-04 | 采用 Federation Ledger 而不是完整区块链 | accepted |
| D-05 | 联邦是基础设施，不是产品入口 | accepted |
| D-06 | 普通社交数据不上 Federation Ledger | accepted |
| D-07 | v1 Ledger 采用 active sequencer，不引入完整共识 | accepted |
| D-08 | Federation discovery 和 Catalog 查询必须显式带 Federation scope | accepted |
| D-09 | 跨站身份复用 ActorRef，不新增 Account wire identity | accepted |
| D-10 | Federation 业务归 Station app subserver，relay/locator 归 frame | accepted |
| D-11 | Federation Ledger 是内部治理真源，ActivityPub 只作为互操作层 | accepted |
| D-12 | Relay 是不可信传输，不是 Station 或 Federation authority | accepted |
| D-13 | Station enrollment 绑定 host-key proof 与 generation revocation | accepted |
| D-14 | Relay directory 只发布 Station 签名 route attestation | accepted |
| D-15 | Relay 数据面使用端到端 TLS 的 opaque tunnel | accepted |
| D-16 | Relay 复用 Station binary 但使用最小 role allowlist | accepted |

---

## D-01: Federation 是持久虚拟实体

**Status**: accepted
**Date**: 2026-05-31

### Context

如果 Federation 只是两个 Station 的临时连接，系统无法表达多 Station 共同组成的长期网络，也无法处理创建者退出、Station 多联邦成员身份、联邦治理历史等问题。

### Decision

Federation 被定义为持久虚拟实体，拥有自己的 ID、metadata、成员 Station、治理角色、policy 和 ledger。

### Rationale

用户理解的是“我加入了一个网络/社区”，不是“我的 Station 与某个服务器建立了连接”。持久实体模型能支撑成员治理、生命周期和跨 Station 状态复制。

### Alternatives Considered

- Station-to-Station 连接即 Federation：实现简单，但无法表达一个 Station 参加多个联邦，也无法支撑治理。
- Account-to-Account 关系即 Federation：会把社交关系和基础拓扑混在一起，权限边界混乱。

### Consequences

系统需要新增 Federation lifecycle、membership 和 governance 模型，但产品心智更清晰，未来可扩展性更好。

---

## D-02: Station 可以加入多个 Federation

**Status**: accepted
**Date**: 2026-05-31

### Context

同一个 Station 可能同时服务于不同社区、测试网、组织网络或私有联邦。如果强制一个 Station 只能加入一个 Federation，会限制真实部署场景。

### Decision

Station 与 Federation 是多对多关系。一个 Station 可以加入多个 Federation，一个 Federation 可以包含多个 Station。

### Rationale

这允许 Station 在不同 Federation 中暴露不同策略、成员关系和治理状态。普通客户端按 Federation context 展示可发现用户，Dashboard/CLI 展示并治理成员 Station。

### Alternatives Considered

- 单 Station 单 Federation：简单，但无法表达多社区参与。
- 所有 Station 进入全局 Federation：违背去中心化，也无法做私有或邀请制网络。

### Consequences

所有 Station、Actor、Catalog 查询都需要带 Federation 语境，不能默认存在全局联邦范围。

---

## D-03: 联邦治理权限和普通社交权限分离

**Status**: accepted
**Date**: 2026-05-31

### Context

同一 Station 中所有用户看到的联邦状态应该一致，但不能让所有用户都能新增、删除或屏蔽 Federation，否则 Station 拓扑会失控。

### Decision

Station/Federation governance 由 `station_owner`、`federation_admin`、`federation_owner`、`federation_admin` 等治理角色控制。普通 Account 只拥有浏览和社交行为权限。

### Rationale

联邦拓扑属于 Station/Federation 治理层；联邦建立后的好友、follow、聊天属于 Account 社交层。两者生命周期和风险完全不同。

### Alternatives Considered

- 所有登录用户都能管理联邦：体验开放，但会导致拓扑混乱。
- 只有 Station owner 能管理一切：安全但过于集中，不利于委托运营。

### Consequences

需要 Station 级 role assignment 和 Federation 级 actor role。治理能力只暴露给 Dashboard/CLI operator surface，普通客户端不得持有管理操作。

---

## D-04: 采用 Federation Ledger 而不是完整区块链

**Status**: accepted
**Date**: 2026-05-31

### Context

Federation 需要可验证、可复制、不可抵赖的治理历史。但当前目标不是构建通用链系统，不需要 token、gas、PoW、PoS 或全网共识。

### Decision

第一阶段采用 permissioned append-only Federation Ledger。Ledger event 通过 hash chain 串联，并由 actor signature 和 station signature 验证。

### Rationale

Federation Ledger 保留区块链式的可审计和防篡改特性，但复杂度远低于完整公链。它足够支撑 Federation 创建、Station 加入、授权、策略变更等治理事实。

### Alternatives Considered

- 完整区块链：过度复杂，偏离联邦社交主目标。
- 普通数据库表：实现简单，但跨 Station 复制和审计可信度不足。
- 中央 registry：查询方便，但违背去中心化。

### Consequences

系统需要事件 hash、签名、replay、materialized state 和同步机制。后续可以在 policy 层升级 multi-sig 或 quorum。

---

## D-05: 联邦是基础设施，不是产品入口

**Status**: accepted
**Date**: 2026-07-21

### Context

原始 D-05 决定 Desktop 提供"联邦广场"作为一级导航入口。实际原型验证表明：联邦操作（创建/加入/离开/治理）频率极低，类似护照管理而非日常动作。为联邦设置独立一级页面过度拔高了用户对联邦的感知权重，偏离了"以人为中心"的产品心智。

### Decision

废弃"联邦广场"作为 Desktop 一级入口。联邦存在感通过以下方式渗透：

1. **搜索/联系人/聊天**（日常入口）— 用户通过正常社交路径发现联邦内的人，联邦作为底层 scope 自然生效。
2. **Settings → Federation**（低频状态）— 查看身份、调整 Actor 可见性、查看可用 context 与连接状态。
3. **Dashboard → Federation**（治理入口）— Station 管理员创建联邦、审批加入、管理 Ledger 和策略。

### Rationale

联邦是底层网络拓扑——用户日常感知的一级入口是"人"，不是"联邦"。正如普通人不会天天意识到自己在哪个国家的互联网上，用户也不应频繁操作联邦。联邦上下文通过好友来源标注、搜索 scope 筛选、群聊跨站标识自然渗透。

### Alternatives Considered

- 保留联邦广场为一级入口：过度拔高联邦存在感，干扰日常社交路径。
- 完全不提供联邦 UI：治理和配置无处落地，管理员无法操作。
- 放在 Contacts 内部 Tab：治理能力（创建/审批/策略）不应混入联系人页面。

### Consequences

Desktop 无需新增一级导航入口。普通客户端只消费 Federation context、scoped Catalog/Resolver 与连接状态；成员 Station、创建、加入、离开、删除和权限治理只由 Dashboard/CLI operator surface 消费。

---

## D-06: 普通社交数据不上 Federation Ledger

**Status**: accepted
**Date**: 2026-05-31

### Context

聊天、点赞、评论、好友请求内容和在线状态是高频业务数据。如果这些数据全部进入 Federation Ledger，会造成隐私、性能和存储问题。

### Decision

Federation Ledger 只记录治理事实，不记录普通社交数据。

### Rationale

治理事实需要审计和复制；社交行为需要隐私、低延迟和业务语义。两者不应共用同一账本。

### Alternatives Considered

- 所有联邦行为上账本：可审计性强，但成本和隐私风险过高。
- 完全不上账本：实现简单，但无法验证治理历史。

### Consequences

friend/follow/chat 等跨站能力需要各自的业务协议和投递机制，不能依赖 Federation Ledger 承载业务数据。

---

## D-07: v1 Ledger 采用 active sequencer，不引入完整共识

**Status**: accepted
**Date**: 2026-05-31

### Context

Federation Ledger 需要可验证、可复制、追加式治理历史，但 v1 明确不构建完整区块链或通用分布式共识。如果多个 admin Station 同时追加 event，并各自分配 `seq` 和 `head_hash`，同一 Federation 很容易产生并发 head 分叉。

### Decision

每个 Federation 在 v1 只有一个 active sequencer Station。Sequencer 由 genesis event 或 `SequencerChanged` event 指定，负责为正式 ledger event 分配 `seq`、`prev_hash` 和 `event_hash`。非 sequencer Station 只能提交 signed proposal，由 sequencer 验证 policy 后追加为正式 event。

### Rationale

Active sequencer 是 permissioned ledger 的最小可行一致性模型。它避免了完整共识复杂度，同时让所有成员 Station 对 head 演进有确定性判断。

### Alternatives Considered

- 任意 admin Station 都可追加：实现简单，但无法可靠处理并发 head 分叉。
- 完整 BFT / PoS / PoW 共识：过度复杂，偏离 v1 目标。
- 中央 registry 分配 head：查询方便，但违背 Federation 持久虚拟实体和去中心化部署目标。

### Consequences

需要记录 `sequencer_station_peer_id`、proposal、handover event、fork detection。Sequencer 失联时 Federation 根据 policy 进入 read-only、quorum handover 或 orphaned，而不是由本地配置私自切换 head。

---

## D-08: Federation discovery 和 Catalog 查询必须显式带 Federation scope

**Status**: accepted
**Date**: 2026-05-31

### Context

一个 Station 可以加入多个 Federation。同一个 Actor 在不同 Federation 中可能有不同可见性、policy 和目录暴露规则。现有 by-handle resolve 和 catalog primitive 主要回答“如何找某个 actor”，不能单独回答“在哪个 Federation scope 内找”。

### Decision

Federation Discovery、Station list、Catalog search、Public actor list、Resolver hydrate 等默认用户路径必须显式带 `federation_id`。没有 `federation_id` 的 handle resolve 只能作为高级或 legacy 路径，并且必须声明 resolve 语境。

### Rationale

显式 scope 能防止把多 Federation 系统退化为隐式全局目录，也能让 privacy、rate limit、membership、policy 都在正确范围内生效。

### Alternatives Considered

- 全局 Catalog：用户体验简单，但违背多 Federation 边界和隐私期望。
- 只靠 handle resolve：适合已知地址，不适合作为 Federation scoped 公开发现入口。

### Consequences

Catalog proto 和 Station API 需要补充 `federation_id`。Actor visibility 需要支持 Federation scoped 降级层。搜索和发现入口必须在 Federation scope 内展示成员 Station 和公开 Actor。

---

## D-09: 跨站身份复用 ActorRef，不新增 Account wire identity

**Status**: accepted
**Date**: 2026-05-31

### Context

项目已有统一 Actor System，规定 `ActorRef` 是跨进程和跨网络身份载体。Federation 草案早期使用 Account 作为概念名，如果直接扩展为 wire identity，会和 `ActorRef`、`ptid`、`acct`、station-local `actor_id` 产生并行模型。

### Decision

Federation 文档中的 Account 只保留为产品语言。跨 Station wire payload、ledger event、role assignment、signature context 必须使用 `ActorRef` 语义、federated handle 和 `station_peer_id`。

### Rationale

复用 `ActorRef` 可以避免身份漂移，符合 Proto-First 和统一 Actor System。Station-local `actor_id` 仍可用于本地 DB 关联，但不能被当成全局身份。

### Alternatives Considered

- 定义 FederationAccount：名称直观，但引入第二套身份系统。
- 只用 federated handle：可读性好，但缺少 `ptid` / `kind` 等稳定语义。

### Consequences

Ledger event、role、proposal、scoped visibility 需要包含 `ActorRef` canonical proto bytes 或等价字段。Desktop UI 可以展示 Account，但 API 和 ledger 不能使用 Account 作为真源模型。

---

## D-10: Federation 业务归 Station app subserver，relay/locator 归 frame

**Status**: accepted
**Date**: 2026-05-31

### Context

Station 平台分为 `app` 和 `frame`。现有 federation locator、resolver、profile envelope、relay、bootstrap 多在 frame 侧，是基础设施能力。新的 Federation lifecycle、membership、policy、ledger 是业务治理能力，如果落在 frame，会让 frame 积累业务真相。

### Decision

Federation governance 业务归 Station app layer 或等价 app-layer subserver。Station frame layer 只提供 relay、bootstrap、locator、resolver、profile envelope、station signing key、transport、auth middleware 等基础能力。

### Rationale

这符合 Station app/frame 依赖规则：app 可以依赖 frame，frame 不应依赖 app，也不应承载业务规则。

### Alternatives Considered

- 全放 frame：接近现有 locator 代码，但会破坏分层。
- 全放 app，包括 relay/locator：会重复基础设施能力，并让业务 subserver 管理 transport 细节。

### Consequences

需要定义清晰接口：app-layer federation service 调用 frame 提供的 signing、relay publish/request、resolver、locator primitive；frame 不读取 Federation policy 表，也不裁决治理权限。

---

## D-11: Federation Ledger 是内部治理真源，ActivityPub 只作为互操作层

**Status**: accepted
**Date**: 2026-05-31

### Context

整体架构历史上提到 ActivityPub Federation；当前草案引入 Peers-Touch Federation Ledger。两者如果不区分，会导致治理真源不清：Station membership 和 policy 是由 ActivityPub activity 决定，还是由 ledger 决定。

### Decision

Peers-Touch 内部 Federation governance 以 Federation Ledger 为真源。ActivityPub 可作为外部 fediverse 互操作层，用于 actor/activity 兼容，但不能直接改写 Federation membership、policy、role、sequencer。

### Rationale

Ledger 能提供 Peers-Touch 所需的 permissioned governance、replay、audit 和 policy enforcement。ActivityPub 的价值在于互操作，不适合作为当前内部治理账本的替代。

### Alternatives Considered

- 全部治理走 ActivityPub：生态兼容强，但权限、账本、sequencer、policy 难以和项目内部模型对齐。
- 完全不支持 ActivityPub：内部一致性强，但降低未来 fediverse 互操作能力。

### Consequences

如果外部 ActivityPub 事件需要影响 Federation governance，必须先转换成合法 proposal / ledger event。内部 Station-to-Station 治理同步使用 proto + ledger，不使用 ActivityPub activity 作为事实源。

---

## D-12: Relay 是不可信传输，不是 Station 或 Federation authority

**Status**: accepted
**Date**: 2026-10-06

### Context

Relay 位于公网连接边界。如果它可以签发 Station identity、裁决 Access Gate 或修改
Federation membership，Relay 被攻破就等同于全部 Station 业务真源被攻破。

### Decision

Relay 只拥有 endpoint identity、route directory、mount/tunnel lifecycle、配额和
transport audit。Station identity、Access Gate、Session、Federation Ledger、
membership、policy 与业务数据仍由各自 Station owner 裁决。

### Rationale

把 Relay 视为不可信网络中介，可将其泄漏半径限制为可用性和连接 metadata。

### Alternatives Considered

- Relay 兼任中央 Station registry：拒绝，产生中心业务 authority。
- Relay 代理并解析全部 Station API：拒绝，扩大凭据与数据泄漏面。

### Consequences

所有经 Relay 的业务流量需要端到端保护；客户端与 Station 都不能信任 Relay 提供的
Station 身份声明。

---

## D-13: Station enrollment 绑定 host-key proof 与 generation revocation

**Status**: accepted
**Date**: 2026-10-06

### Context

一次性 invite 证明“知道一个秘密”，但不能证明注册者控制声明的
`station_peer_id`。无 generation 的 bearer token 也无法可靠撤销。

### Decision

Relay challenge 由 Station host key 签名，Relay 从 public key 推导 PeerID。invite
消费与 mount generation 原子创建；credential 使用独立非对称 issuer 和严格
audience/scope/jti/expiry。撤销递增 generation 并关闭全部旧流。

### Rationale

PoP 把 enrollment 与既有 Station identity 统一，generation 使 revoke、rotate 和
reconnect 具有确定语义。

### Alternatives Considered

- 信任请求头或配置 PeerID：拒绝。
- 共用 Station Session JWT secret：拒绝。
- 仅删除 mount row：拒绝，旧 credential 仍可重建。

### Consequences

需要 hash-only invite、原子事务、credential key rotation、replay store 与完整
operator recovery Journey。

---

## D-14: Relay directory 只发布 Station 签名 route attestation

**Status**: accepted
**Date**: 2026-10-06

### Context

客户端需要从 Relay 找到目标 Station，但 Relay 不能成为 Station identity 或公开性
真源。

### Decision

Relay 只缓存并返回 Station host key 签名、短期有效、绑定 Relay identity 和 mount
generation 的 route attestation。目录默认私有；公开列出必须由 Station opt-in，
私有访问使用 Station 签名 grant。

### Rationale

客户端可独立验证 route，Relay 既不能伪造 Station，也不能擅自公开私有 Station。

### Alternatives Considered

- Relay 自签 Station directory：拒绝。
- 默认公开全部 online mounts：拒绝。
- 建全局 Peers-Touch registry：拒绝。

### Consequences

route attestation、grant digest、expiry 与 generation 必须成为 canonical Proto 和
Acceptance attack surface。

---

## D-15: Relay 数据面使用端到端 TLS 的 opaque tunnel

**Status**: accepted
**Date**: 2026-10-06

### Context

当前透明 HTTP forward 暴露 method、path、headers、Authorization 和 body，无法满足
客户端经 Relay 登录和使用业务 API 的安全要求。

### Decision

Relay 仅转发 opaque bytes。Client 到 Station 在 tunnel 内建立 TLS 1.3，证书 SPKI
由 Station route attestation 固定；Station-to-Station traffic 也使用 scoped opaque
tunnel 与 typed capability manifest。

### Rationale

成熟 TLS 实现提供机密性、完整性和服务端身份认证，避免自研加密协议，同时保留
Station canonical HTTP/protobuf router。

### Alternatives Considered

- 透明 HTTP reverse proxy：拒绝。
- 只有 outer TLS：拒绝。
- 自研 Noise/AEAD wire：拒绝，除非未来独立安全评审证明标准 TLS 不可行。

### Consequences

需要 inner TLS ingress、SPKI lifecycle、bounded frames 与取消/backpressure。
`/relay/forward/*` 和 client token 在 cutover 后删除。

---

## D-16: Relay 复用 Station binary 但使用最小 role allowlist

**Status**: accepted
**Date**: 2026-10-06

### Context

复制仓库或服务会形成协议烟囱；让 Relay 默认加载全部 Station subserver 又会扩大
公网攻击面。

### Decision

Relay 继续从同一仓库、构建和 binary 产生，但以显式 role allowlist 只启用
health、discovery、operator admin、mount、tunnel 和 metrics。生产缺少强制安全
配置时启动失败。

### Rationale

共享实现和治理避免重复，角色最小化保持部署边界清晰。

### Alternatives Considered

- 新建 Relay 仓库/SDK：拒绝。
- 用 denylist 从完整 Station 删除少数 handler：拒绝，新增业务默认暴露。

### Consequences

compose、entrypoint、route inventory 和发布验收必须验证 allowlist，而不是只检查
一个 `enabled` flag。
