# 朋友圈主权架构（Actor-Owned Moments）

> **Status**: accepted（用户于 2026-11-07 授权实施 Rust 内核与 Go 后端；UI 由独立 Owner 实施）
> **Version**: v0.5
> **Created**: 2026-11-06
> **v0.4 修订（2026-11-07）**：
> 1. 跨站事实更正——域中立帧总线 `POST /federation/delivery`（持久化 outbox + dispatcher +
>    HTTPTransport/Relay opaque + Registry receiver，在役承载 15 类报文）早已存在；公开 feed
>    缺的只是新 PayloadKind 与 receiver，不是新建传输（v0.3 §6.5「公开须全新端点」判断作废）。
> 2. 新增 AD-08：以钉版 glass 原型功能面为 v1 合同，单设备 + 公开链先交付；多设备
>    checkpoint（AFL-04）、毁站助记词回灌（AFL-05B）、私密密文子链切割（AFL-07/07B）延 v2；
>    非公开受众在 v1 继续走在役 E2EE prepare/submit 管线，本架构不动其权威。
> **Owner**: Architecture Team
> **Upstream**: [Federation Ledger](../../federation/README.md)、[Federated Human Social Activity](./design.md)、[Moments Runtime](../core/moments.md)

> **命名约定**：本架构的产品命题是**朋友圈数据主权从 Station 迁移到 Actor（人的密钥）**，
> 故架构层命名为「朋友圈主权架构 / Actor-Owned Moments」。其核心机制原语沿用 SSB 术语
> **Actor Feed Log**——这里的 feed 指一个作者的全部内容流（不是审计/埋点意义上的"活动日志"），
> log 指哈希签名的 append-only 结构。proto（`feed_log.proto`）、计划 ID（AFL-*）与文件名
> 保持机制名不变。Federation Ledger 是治理账本，Actor Feed Log 是个人内容流，二者平级、共享密码学内核。

---

## 1. 设计命题

当前朋友圈（Moments）的权威模型是 **Station 即权威的关系型 CRUD**：
`social_public_posts` / `social_private_posts` 存当前状态，软删除、可编辑，
跨站投递的是状态快照。私密内容已有**单对象**设备签名与 E2EE
（`actor_signing_key_id` + `actor_device_signature` + `EncryptedMediaDescriptor`），
但没有顺序性与历史完整性：任何持有副本的一方都无法证明
"作者的历史没有被其 Home Station 增删或改写"。

目标：在不推翻现有投影、时间线、审核、E2EE 设施的前提下，把朋友圈的
**权威来源**从 Station 数据库改为 **Actor 设备签名的 append-only 活动日志**
（Actor Feed Log）。Station 退为日志的常驻宿主与复制者；现有 CRUD 表降级为
可重建的物化投影。

参考实现分析（外部，`verified_fact`）：Secure Scuttlebutt（SSB）已验证
"per-identity 签名哈希链 + 社交图复制"足以支撑去中心化社交，无需共识、
token 或中心服务器；但 SSB 的 epidemic gossip 复制、flumedb 存储、
secret-handshake/box2 私有协议与"无删除原语"不直接适用于本项目。
本设计借其日志模型，不引其协议与依赖。

## 2. 证据台账

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| 现有公开帖子为 CRUD 当前态存储，无哈希链 | verified_fact | `social/domain/post.go`、`social_public_posts`、`social/domain/events.go`（领域事件结构体无任何构造点，死代码） | high | — |
| `social_private_posts` 是现役 E2EE 安全内容管线存储，不是 legacy CRUD | verified_fact | `infrastructure/private_content_store.go:811`（prepare/submit 管线 + audience snapshots/grants/delivery intents）、`private_content_revocation.go` | high | 私密权威切割必须在密文子链合同（§6.5）落地后独立进行，不能与公开 cut 同批 |
| 私密动态已具备单对象设备签名与 E2EE 投递 | verified_fact | `model/domain/social/private_content.proto`、`federated_private_*` 子服务器；实际 64B Ed25519 验签仅在 `application/federated_private_interaction.go` | high | — |
| Reaction 仅 proto 预留签名位，公开链路零验签 | verified_fact | `social/post.proto` `ReactToPostRequest.actor_device_signature` 字段存在；Desktop 发送空值（`src-tauri/.../social.rs`），Station `reaction_service.go` 入参无签名且不验；comment.proto 无任何签名字段 | high | 公开 reaction/comment 的设备签名在两侧均为新建 |
| 跨站好友请求已是 seq+hash 校验的状态机事件流 | verified_fact | `social/domain/federated_friend_request.go` `ValidateFriendRequestEvent` | high | — |
| Federation Ledger 已沉淀 deterministic proto + SHA-256 + Ed25519 + SSE/cursor 同步 | verified_fact | `domains/federation/wire-protocol.md`（Status: draft） | medium | 规范仍 draft；运行时 ledger 能力由联邦生命周期 Journey 部分证明，哈希/验签代码内聚在 federation 子服务器，尚无共享包 |
| 客户端持有 actor 主身份密钥（助记词派生 IdentityKeyPair） | verified_fact | `packages/messaging-core` crypto/identity、`packages/secure-content-core` recovery.rs（mnemonic entropy → HKDF → 32B seed） | high | 设备签名密钥的 attestation 链（verified device signing key）与主身份的绑定需在合同中显式化 |
| **公开动态当前无跨站投递** | verified_fact | `social/infrastructure/public_post_repo.go`（仅本站持久化，注释明示 "the moment AP outbound goes live"）；公开链无对应 PayloadKind/receiver | high | — |
| **域中立 Station 间帧投递总线已在役（v0.4 更正 v0.3）** | verified_fact | `frame/core/federation/delivery/`（outbox+dispatcher+lease fencing+幂等）、`transport.go`（routed/local/HTTPTransport，直连或 Relay opaque tunnel，Bearer token 与帧逐字段绑定）、`routes.go`（`POST /federation/delivery` 单一域中立入口 + Registry 分发）；`delivery.proto` 已枚举 15 类 PayloadKind（会话/好友请求/关系/呼叫/社交私密 12–15），无任何公开 feed 种类 | high | 公开跨站**复用总线**：新增公开 feed 通知/互动 PayloadKind + receiver 即可；仅冷启动/缺口的有界拉取需新增 peer route |
| **公开发帖请求当前不带设备签名** | verified_fact | `social/post.proto`：`CreatePostPostRequest` 无签名字段；仅 `ReactToPostRequest` 与私密对象路径携带 `actor_device_signature` | high | 公开帖迁移到设备权威需要客户端协议升级与旧端兼容门 |
| 共享 signed-log 原语可消除朋友圈与治理链的重复 | inference | 两者事件信封/验签/同步形态同构，差异仅在定序与授权策略；但内核抽取本身是前置改造（见 AD-04） | medium | 抽取后的接口边界需要设计评审验证 |
| per-device 子链 + actor checkpoint 可解决多设备分叉 | inference | SSB metafeed 已工业验证；本项目设备 attestation 模型与之兼容 | medium | checkpoint 事件 proto 与重放裁剪规则未定 |
| 日志化后 Station 篡改可被跟随方发现 | proposal | 本文 §6、§9 | — | 需要篡改注入 Journey 证明 |

## 3. 范围与非范围

### 3.1 本架构定义

- Actor 活动日志的权威模型：事件类型、哈希链、签名输入、定序规则。
- 多设备写入（device feed + actor checkpoint）。
- 日志的 Station 宿主、Station 间定向复制与验签。
- 现有 CRUD 表面与日志的关系：唯一写路径，CRUD 为物化投影。
- 公开/私密两类受众在日志中的形态（明文事件 vs 密文信封事件）。
- 删除/编辑/撤回、fork 与重放失败语义。
- 存量数据的接入形态：已决——无存量用户，clean cut，不做 snapshot（AD-07）。

### 3.2 非目标

- 不引入 token、gas、PoW/PoS、智能合约或任何全局共识。
- 不实现 SSB gossip、mDNS 闲聊或客户端间复制；复制只发生在 Station 之间，
  客户端只连自己的 Home Station 读投影（§5）。
- 不改变 Federation Governance Ledger 的成员治理语义与 sequencer 模型。
- 不定义执行分期、任务拆分与迁移批次（属执行规划阶段）。
- 不做 ActivityPub outbox 映射（保留为后续互操作扩展）。
- 不承诺跨联邦公开发现；复制由 follow 图 + Audience 授权驱动。

### 3.3 保留 / 替换 / 删除（目标态处置）

- **保留**：时间线/HOT 排序、`MomentDelivery` fanout、计数快照、搜索、
  Audience 可见性、moderation/block、E2EE 密钥体系、媒体 OSS、
  Station 间传输（直连/Circuit）、events subserver SSE。
- **新增**：signed-log 共享原语、device feed 事件存储、actor checkpoint、
  Station 侧 feed verifier/projector、Station 间 feed 复制协议。
- **权威替换**：发帖/编辑/删除/反应/评论的写入口改为"先成日志事件，
  验签追加，再投影"；旧的直接改表写路径在目标态删除，无双写长期共存。
- **删除**：`social/domain/events.go` 中"构造后丢弃"的临时形态由真事件存储取代。

## 4. 真相源与所有权（Authority Map）

| 对象 | 突变权威 | 宿主/副本 | 投影消费者 |
|---|---|---|---|
| Device feed 事件 | Actor 设备私钥签名 | Home Station 为常驻副本；按授权复制到友站 | projector |
| Actor checkpoint | Actor 主密钥（24 词助记词对应身份） | 同上 | 合并器 |
| 日志接受/拒绝 | Home Station（准入策略，非内容权威） | — | verifier |
| 跨站复制范围 | 作者 Audience + 接收方 follow/关系 | 友站 verifier | — |
| 帖子当前态、时间线、计数、搜索 | 无突变权威（派生） | 各站本地投影表 | Desktop/Mobile |
| 私密明文与媒体密钥 | 作者设备 + 收件人设备 E2EE | Station 仅存密文信封 | 收件人客户端 |
| Federation 治理事实 | Governance Ledger sequencer（独立链） | 成员站 | Dashboard/治理投影 |

禁止关系：

- Station **不得**接受未通过设备签名 + 链连续性校验的日志事件。
- Station **不得**以投影表写回的方式"修复"日志；投影只能由重放产生。
- Relay **不得**解释、缓存明文或裁决可见性；它只转发 opaque bytes（既有边界不变）。
- 友站 **不得**把超出 Audience 授权的事件投递到本地投影。

## 5. 运行时单元与边界

```text
[Client Devices: Desktop / Mobile]
  持有设备 Ed25519 私钥（verified device signing key，secure storage）
  与 actor 主身份密钥（现有 E2EE IdentityKeyPair：24 词助记词 → HKDF → 32B seed）
  离线可在本地 device feed 排队事件；上线后提交 Home Station
        │ ① 提交签名 FeedEvent（发帖/编辑/tombstone/反应/评论）
        ▼
[Home Station · app/social]
  Feed Verifier：设备签名 → checkpoint 授权 → seq/prev_hash → Audience 准入
        │ 追加
        ▼
  Signed-Log Kernel（前置任务先从 Federation Ledger 抽出的共享库：
    SHA-256 · Ed25519 · deterministic proto · fork 停机）
    ├─ Actor Feed Log Store（作者定序，per-device 子链 + checkpoint 合并）
  └─ Federation Governance Ledger（sequencer 定序，独立实例，复用同一内核）
        │ 重放
        ▼
  Feed Projector → social_public/private_posts · MomentDelivery · 计数 · FTS
        │ ② 客户端分页读取投影（现状协议不变）
        ▼
[Client Devices]

Home Station ──③ 公开 feed（v0.4）：事件通知复用在役 /federation/delivery 帧总线
   （新 PayloadKind，outbox 按 follower∩Audience 逐站扇出，直连或 Relay opaque tunnel）；
   冷启动/缺口走新增有界拉取 peer route（cursor 分页、验签）。私密 feed 不变：
   复用在役 federated_private_resource 定向投递（v1 不切割，见 AD-08）
   ──▶ Peer Station
        ├─ Receiver：签名/链连续性校验、准入、限速、垃圾事件拒收
        ├─ Replicated Feed Log（v1 仅公开明文链；私链子链延 v2）
        └─ 本地投影 → 其本站客户端
```

- 客户端不复制整链、不与其他客户端 gossip；存储/流量模型与现状一致。
- Station 是常开一等副本宿主，承担 SSB 中缺失的"总有在线节点"角色。
- **Relay 不是复制拓扑中的节点，不扇出**：复制目标集由 Home Station 应用层按
  follow ∩ Audience 计算，日志同步默认 Station 直连（IPv6/公网/DCUtR 打洞）；
  仅当两站直连失败时，同一条 Station-to-Station 隧道才穿过 Circuit Relay v2，
  Relay 只见 opaque bytes，不知道事件内容也不决定发给谁。
- signed-log kernel 是进程内库（Go 一份，客户端验签复用 Rust 侧既有
  `station-trust` 同源规则），不是新服务、不是新网络跳点。

## 6. 合同（目标态要点，proto-first）

### 6.0 v1 冻结合同

`model/domain/social/feed_log.proto` 是 v1 协议真源。`chain_id = public/v1`，
其他命名空间在 v1 拒绝；私密内容仍归 Secure Content，不在公开链留下序号空洞。

Actor 根密钥分别签署 `FeedGenesisStatement` 与 `FeedWriterGrantStatement`。
根公钥必须与 Actor Identity 已保留的连续性公钥一致，不能从待验证报文自行建立信任。
首条事件引用创世记录哈希，后续事件引用前条签名事件哈希；每条绑定授权哈希、
Actor、链、序号、类型、payload 哈希和时间。v1 一条公开链只接受一个固定 writer grant，
没有设备轮换操作；writer 不可用时停写，多设备和换设备续链归 v2。

签名输入是域分隔字节加无 map、无未知字段的确定性 protobuf。
创世、授权、事件签名与事件哈希分别使用
`peers-touch/social-feed/{genesis,writer-grant,event,event-hash}/v1\0`。
跨语言向量位于 `model/domain/social/testdata/feed_v1.json`。机制原语归
`apps/station/frame/core/signedlog`，领域准入与链推进归 Social；
治理链只复用字节级哈希/签名原语，保持其既有签名字节和 sequencer 语义。
Secure Content 保留其已冻结的独立 canonical 协议。

通知、互动、订阅分别使用在役 Delivery 总线的新 PayloadKind。
订阅持久化并使用单调 revision 防止撤订后旧通知重新激活；作者站按订阅站聚合，
本地提交事务只登记 fanout intent，工作线程按有界页面物化共享 outbox。
接收站持久化脏游标，并周期执行有界同步，因此最后通知丢失或过期后仍可追平。
自动补拉必须在作者站核验请求站和有效订阅，撤订与 block 停止自动复制。
客户端主动读取公开帖子使用同一 `ReadFeedRequest` 的 `explicit_public_read`；
由本站 authenticated viewer 触发一次有界 pull，再写入原副本和线程索引。
该意图进入原 scope 的 canonical-request 哈希；作者站还核验 viewer 的 Home
等于请求站、作者 Home 等于本站，并通过原 `PublicReadPort` 检查双方 block
与 Station moderation。主动读取不修改关注或订阅，不扩展私密受众。
取证游标来自原 Station 副本；每次最多补拉 32 个事件和 32 条线程回执，
远端尚有后续页时不能把本地已导入前缀呈现为完整尾部。返回在原读取事务中
再次检查 viewer 权限；离线失败不能降级为缓存成功。

非关注者互动携带创世、writer grant 与单条事件，证明该互动的作者真实性；
独立线程投影和作者连续链分开存储，不把未取得前缀当成已证明完整历史。
帖子作者站在同一事务中持有作者线程头锁分配 arrival cursor，并保存回执索引。
`ReadFeedRequest.include_thread/after_thread_cursor` 在原有已授权读取路由补拉线程，
每页最多 32 条，整个响应不超过 1 MiB；线程游标不参与作者链序号或完整性证明。
新关注者与丢失即时转发的接收站周期补拉历史回执，逐条验证互动者的独立身份根、
固定授权、签名和帖子归属后才推进订阅线程游标。源站收到 Delivery 送达 ACK 才标记
互动已转发；过期后以新的 transport revision 重发原始回执，不重签业务事件。
客户端分别保存作者链和线程回执，线程消费游标独立于同步游标，并逐条绑定到已验证
作者发帖事件。线程回执证明真实性，不证明作者站没有遗漏、隐藏或重排互动。
Reaction 业务唯一键是目标对象、Actor、reaction kind；评论目标同时绑定稳定父帖引用；
Comment 绑定稳定 comment ID，
编辑和 tombstone 必须属于原作者。事件幂等键不能替代业务去重。

评论点赞、typed ballot 与作者站截止接纳采用
[D-08](./decisions.md#d-08-评论点赞与投票延伸原交互权威) 及
[交互合同 §3](./interaction-completion.md#3-公开交互权威)。
该扩展仍在原公开链、线程投影和 Delivery 总线中完成；私密投票与评论反应
保持原 Secure Content/private interaction 权威。创建后的投票定义不可变，
正文编辑不能重置定义或已提交的互动。

帖子 `created_at/updated_at/edited_at` 属于原作者签名正文。反应及评论计数是
独立的派生状态，更新计数不能通过 ORM 自动更新时间改写这些字段；
Native 正文比对保持严格，不能把这类漂移当作可信的作者编辑。

Rust 持久化原始签名 journal 与已验证 head。重试发送同一签名字节，
已见序号回退或同序不同哈希必须拒绝。投影正文必须与已验证事件重放结果绑定，
不能只验证 Station 的一个 head。签名链无法证明此前从未见过的尾部未被隐藏，
也不能恢复已失去所有副本的内容；产品不可承诺这两项。

以下多设备 checkpoint 与密文子链段落描述 v2 终态，不改变本段 v1 合同。

### 6.1 事件信封（device feed）

```text
FeedEvent {
  actor_ptid
  device_key_id
  device_seq            // 该设备子链单调递增
  prev_event_hash       // 该设备子链前一事件；genesis 为全 0
  event_type            // POST_CREATED | POST_UPDATED | POST_TOMBSTONED
                        // | REACTION | COMMENT | CHECKPOINT
  payload_hash          // typed payload 的 deterministic proto 哈希
  created_at_unix_ms
  device_signature      // 对上述字段 canonical bytes 的 Ed25519 签名
}
```

- 公开事件 payload 明文；非公开事件 payload 为密文信封
  （复用 `EncryptedMediaDescriptor` 同族 E2EE 设施），链上不出现明文与密钥。
- 媒体仍在 OSS/对象存储，内容按哈希寻址；日志只引用 content hash。
- 反应与评论属于**作者各自的设备链**，通过目标帖子的稳定 `oss://{station}/post/{id}`
  引用关联；不写入被评论者的链。

### 6.2 Actor checkpoint

```text
CheckpointPayload {
  actor_ptid
  checkpoint_seq        // actor 主链自己的递增序号
  heads[]               // { device_key_id, device_seq, head_event_hash }
  prev_checkpoint_hash
  actor_signature       // 主密钥签名
}
```

- 合并器以最新合法 checkpoint 认可的设备 head 集合判定哪些事件属于该 actor；
- **跨设备顺序不使用客户端时钟**：checkpoint 携带顺序向量（每设备 device_seq head
  集 + checkpoint 自身单调序），投影顺序由「checkpoint 序 → 设备序 → device_key_id
  字典序平局规则」确定性导出，保证各站投影一致，杜绝改时钟插队；
- 并发冲突（不同设备同时 `POST_UPDATED` 与 `POST_TOMBSTONED` 指向同一帖子）按
  同一确定性顺序裁决：tombstone 一旦在合并序中出现即为终态，后到的编辑不复活；
- 设备 attestation/撤销复用现有设备密钥体系，被撤销设备在新 checkpoint 后失效；
- checkpoint 本身作为 `CHECKPOINT` 事件落在主密钥控制的链上。checkpoint 签发频率
  与"主密钥设备离线期间既有设备仍可发帖"的降级语义在执行规划定义（新设备接入
  必须有在线主密钥，发帖不必须）。

### 6.3 接收与重放

1. 验设备签名（含设备是否被当前 checkpoint 认可）；
2. 验 payload hash、event hash、`device_seq = 本地 head + 1`、prev_hash 连续；
3. Audience 准入（跨站复制时还要验接收方关系与 block/moderation）；
4. 全部通过才追加并触发投影；任一失败：拒绝并记录 typed 原因，
   链连续性冲突进入 `feed_fork_detected`，停止该 actor 的投影推进，
   不接受"以最新覆盖"的静默修复。

### 6.4 编辑、删除、撤回

- 编辑 = `POST_UPDATED` 追加事件；删除 = `POST_TOMBSTONED`；投影层折叠为当前态。
- 公开/FOLLOWERS 内容：tombstone 后联邦内停止展示，但已取得副本的站点
  技术上可留存历史——产品必须如实告知，不承诺"互联网级收回"。
- 私密内容：日志中只有密文信封；撤回事件要求授权副本持有者级联销毁本地明文
  与缓存（沿用现有 private content revocation 通道）。

### 6.4b 公私混链的元数据边界（F7）

一条 device feed 同时承载公开与私密事件时，对未授权副本隐藏私事件会暴露 seq
空洞与发文时间。目标态按受众类别把 device feed 拆为独立子链（公开链 + 按
受众/密钥域的私密链），各自独立 seq；checkpoint 同时列出各子链 head，未获授权
的一方看不到私密链的存在与计数。私密链的承载形态在执行规划细化，架构层禁止
退回"单链留空洞"。

### 6.5 Station 间复制（公开复用帧总线，私密维持在役通道）

事实前提（v0.4 源码复核）：

- 公开动态无跨站投递（`public_post_repo.go` 仅本站持久化，AP outbound 未上线）。
- 但 Station 间**域中立帧投递总线已在役**：业务写与 outbox 入队同事务，dispatcher
  持久化重试（lease fencing、幂等键、payload hash 冲突），`HTTPTransport` POST
  `/federation/delivery`（直连或 Relay opaque tunnel），接收入口校验 token↔帧绑定后
  按 `PayloadKind` 分发到注册 receiver（见证据台账 v0.4 条）。在役 15 类报文
  （会话/好友请求/关系/呼叫/社交私密 12–15）全部走这条总线，包括私密动态密文帧与
  跨站私密互动（14/15）的 fan-out 范本。

因此公开复制分两层，不新建第二套投递设施：

- **公开 feed 事件通知（复用总线，新建报文种类）**：新增公开 feed PayloadKind，
  帧的 OpaquePayload 装 Actor 设备签名的 FeedEvent（或其指针 + seq）；作者 Home Station
  在 append 事务内按 follower∩Audience 计算远端 Home Station 集，逐站入 outbox
  （fan-out 形态直接沿用 `federated_private_resource` 的 remoteStations 收集、排序、
  `ValidateActiveStationPair`、逐站建帧范本）。推送是**低延迟通知，可丢可重放**，
  权威始终是可重放的签名链；接收站 receiver 独立验签、验链连续性、做 block/moderation、
  限速与垃圾事件拒收，通过后入本地 log 并触发投影。
- **缺口/冷启动补齐（新增有界拉取 peer route）**：新站订阅、推送丢失、cursor 过期时，
  接收站按作者 + cursor 有界拉取事件段，形态对齐在役 conversation follower-events /
  event-sync（鉴权 scope、分页、限速），授权集同样由接收方 follow 图 ∩ 作者 Audience
  在**被拉取方**计算。这是 v1 唯一新增的 HTTP 能力；不新增 overlay、不复用 governance
  ledger 的 `/fed/v1/ledger/*`（那是治理 sequencer 语义）。
- **入站互动发现（复用总线，新建报文种类）**：公开帖的评论/反应可来自帖主未关注的人，
  仅靠 follow 图扇出无法组线程。互动者 Home Station 用同一总线新增互动 PayloadKind
  向帖主 Home Station 推送签名互动事件（与在役社交私密互动 14/15 同构：验签 + 限速 +
  帖主站 thread admission）；帖主站维护按帖子聚合的线程索引，再随帖主 feed 扇出给
  其跟随者。这是与出站通知对等的必交件。
- **私密 feed（v1 不切割，见 AD-08）**：v1 非公开受众继续走在役 E2EE prepare/submit +
  `federated_private_resource` peer stream，密文子链化（日志事件作为密文对象载荷承载）
  属 v2（原 AFL-07/07B）。
- **聚合去重（F10）**：reaction 唯一性以 actor 为单位跨其全部设备子链判定；v1 单设备
  （AD-08）下去重退化为 `(actor_ptid, device_key_id, device_seq)` 幂等，跨设备折叠随
  AFL-04 进 v2。
- 底层承载统一：直连优先，NAT 时 Relay opaque tunnel，Relay 不见明文、不决定复制目标。
- 去重：以 `(actor_ptid, device_key_id, device_seq)` 幂等。

### 6.6 客户端升级与兼容门（已废止，见 AD-07）

> **superseded-by AD-07（2026-11-06）**：产品无存量用户，clean cut 不设代签窗口，
> 本节关于 Station 代签与 `station_attested` 的机制不再生效。

### 6.7 存量接入（已废止，见 AD-07）

> **superseded-by AD-07（2026-11-06）**：不生成 snapshot checkpoint，不做历史
> 接入；日志从 genesis 重新开始，旧写路径直接删除。

## 7. 失败与运营语义

| 失败 | 目标行为 |
|---|---|
| Home Station 宕机 | 客户端离线排队；友站继续服务已复制内容；恢复后按 cursor 追平 |
| Home Station 库被篡改/删除 | 签名链对不上即被友站/客户端发现；作者凭助记词在新 Station 恢复身份，从友站副本拉回链继续写 |
| 设备丢失/换机 | 助记词恢复主密钥 → 新设备 attestation → 新 checkpoint 接续；旧设备链在 checkpoint 中终止 |
| 双设备并发 | 各自子链独立递增，由 checkpoint 合流，无全局锁 |
| 友站超期下线 | ring/cursor 过期后批量拉取；长期失联不影响其他站 |
| 恶意/垃圾作者 | Station moderation 在投影层与复制层生效（不转发/不展示），不重写作者链 |
| Home Station 拒收合法事件（F8） | verifier 只能因签名/链/Audience/限速等 typed 规则拒绝，不得静默丢弃；拒绝期作者可凭助记词把身份与已复制日志迁移到新 Station 继续发布，不提供"绕过自己 Station 实时发布"通道 |
| 主密钥丢失且无恢复 | 身份终止，不提供"Station 代管找回"口子 |

## 8. 质量门（架构主张必须可证伪）

> v0.4 按 AD-08 分期标注；v1 完成判定只认 **[v1]**  Journey，**[v2]** 项保持 UNPROVEN。

- **[v1]** 篡改检测 Journey：直接改写友站/本站日志表中一条事件的 payload，
  verifier 必须拒绝、投影不得变化、出现 `feed_fork` 可观测事件。
- **[v1]** 跨站 Journey：A 站作者发帖/编辑/tombstone，B 站 follower 端到端可见状态收敛
  （帧总线通知到达 + 缺口拉取补齐两条路径各断言一次），且断言 B 站事件链 hash 与签名
  校验通过；非 follow/越 Audience 拉取拒绝；伪造 seq/签名拒收。
- **[v1]** 硬切兼容门：cut 后未签名/旧协议公开写请求被 verifier typed 拒绝；旧客户端与
  Mobile 公开发帖收到明确错误而非静默 Station 代签；对应 active gate 同提交处置。
- **[v1]** 线程发现 Journey：非关注用户在公开帖评论/反应，帖主站经帧总线入站投递形成
  线程索引并扇出给帖主跟随者；伪造/越界/超载事件被 typed 拒收。
- **[v1]** Relay opaque Journey：跨站帧经 Relay 路径抓包断言不见明文、不含复制目标决策。
- **[v1]** 单设备语义 Journey：第二台设备（未 attestation）的公开写在 v1 被 typed 拒绝，
  错误可定位；该断言在 v2 被多设备 Journey 取代。
- **[v1]** 性能门：Station 间复制与投影重放在目标社交流量画像下满足现有 Moments
  P95 时间线 SLA（具体阈值在执行规划中以当前基线测量值设定，不在此虚构数字）。
- **[v1]** 在役私密不回归：v1 改动期间 native private gates 全绿，E2EE prepare/submit、
  跨站私密投递与撤回行为零变化。
- **[v2]** 多设备 Journey：两设备离线并发发帖后上线，checkpoint 合流，投影无重复无丢失。
- **[v2]** 顺序确定 Journey：篡改设备时钟不改变两站合并后的帖子顺序；并发编辑与
  tombstone 终态一致。
- **[v2]** 元数据隔离 Journey：未获私密受众授权的站观察不到私密子链的 seq 与存在性。
- **[v2]** 密文隔离 Journey：非 Audience 授权方即使持有事件密文也无法进入明文投影；
  撤回级联销毁明文。
- **[v2]** 拒迁/恢复 Journey：Station typed 拒收合法事件或 Home 销毁时，作者凭助记词
  在新站恢复身份、从友站合法副本回灌全链并继续追加；零副本不承诺复活。

## 9. 决策记录（ADR-lite）

### AD-01 作者定序的 per-device 签名日志，不引入共识

- Context：需要跨站可验证的历史完整性；联邦成员是已知授权站，作者对自己的
  历史拥有全部权威，不存在多方竞争写同一状态。
- Decision：每设备一条 append-only Ed25519 哈希链，actor checkpoint 合流；
  无 sequencer、无共识、无 token。
- Alternatives：完整公链（成本/隐私/复杂度不匹配，拒绝）；保持纯 CRUD
  （跨站信任只能建立在对 Station 运营者的善意上，拒绝作为目标态）。
- Consequences：获得不可篡改与可移植性；接受公开内容不可真正收回、
  零副本用户仍有单点丢失风险。

### AD-02 单一写路径：日志为权威，CRUD 全部降级为投影

- Context：双轨（部分内容走日志、部分走 CRUD）会产生编辑/删除/跨站语义分叉
  与双真相源对账成本。
- Decision：所有朋友圈对象的写都先成为日志事件；现有表与 fanout 保留为
  可重建物化视图；旧直写路径在目标态删除。
- Reversal trigger：若投影重建在真实数据量下无法满足 SLA，允许缓存优化，
  但不得恢复第二权威。

### AD-03 Station 间定向复制，不采用 SSB gossip

- Context：SSB 设备互相 epidemic 复制在 NAT/移动端冷启动差；本项目有常开 Station。
- Decision：复制只在 Station 间按 follow+Audience 定向进行，客户端不持有
  对等复制职责。**v0.4 修订**：事件通知与入站互动复用在役域中立帧总线
  `/federation/delivery`（新增 PayloadKind/receiver，见 §6.5），私密复制复用现有
  federated_private_resource 通道；仅缺口/冷启动的有界拉取是新增 peer route。
  v0.3「公开 feed sync 必须全新端点、不得记为复用」的表述因漏判帧总线而作废。
- Consequences：Home Station 重新成为可用性关键（由友站复制与身份可移植缓解）；
  公开复制带来接收站准入/反垃圾成本，必须与通知 receiver、拉取端点同期交付。

### AD-04 与 Governance Ledger 共享 signed-log 内核，不共享链

- Context：治理链与朋友圈链的信封、哈希、验签、同步同构；各写一份是重复造轮。
- Decision：抽取共享 signed-log 原语（canonical 编码、验签顺序、fork 处理、
  cursor 同步），两个实例只在"谁能写、谁定序"上策略不同。
- 前置事实：该内核**当前不存在为共享包**——哈希/验签代码内聚在 federation
  子服务器，wire 规范仍 draft。因此"抽内核"是本架构的**第一个执行批次**
  （先提炼 + 治理链回归证明等价），而不是朋友圈实现时顺手获得的免费复用。
- Consequences：内核接口必须同时满足 sequencer 与 per-device 两种定序策略，
  抽取设计需独立评审，禁止让任一方的业务类型泄漏进内核。

### AD-05 私密内容密文上链，复用现有 E2EE

- Decision：非公开事件载荷只存密文信封与密钥封装，访问控制与撤回沿用
  secure content 体系；不为日志另造加密协议。

### AD-06 存量以 snapshot checkpoint 接入，不回填签名（已废止，见 AD-07）

- Decision：切换点前的历史以快照为权威，完整性保证只对切换点后成立。
- Rationale：给旧帖子补签需要Station 代持作者历史，破坏权威模型且成本无收益。
- Status：**superseded-by AD-07（2026-11-06）**。

### AD-07 无存量用户前提：clean cut，公开/私密两条切割独立进行

- Decision：不设代签窗口、不生成 snapshot checkpoint、不回填历史。权威切换分
  两条独立切割：(a) 公开对象（post/comment/reaction）在设备签名写路径与投影就绪后
  原子 hard cut，旧公开直写与 Desktop TS/Rust 旧调用同提交删除；(b) 私密对象在
  密文子链合同（§6.5）落地后，以真实密文链替换现役 secure-content 写路径，并用现有
  native private gates 回归，不提前动 `social_private_posts` 管线。
- 未升级客户端（含 Mobile 朋友圈发帖）在 cut 后收到 typed 拒绝，Station 不代签；
  对应验收契约（如 mobile-moments-participation 的 publish 断言）必须在同一 cut
  Task 内显式缩窄或暂停，不得留下必挂的 active gate。
- Rationale：产品无存量用户，兼容机制是纯负债；但私密表是在役 E2EE 管线而非
  legacy CRUD，两条切割的风险与依赖完全不同，合并切割会逼出"占位信封重写加密
  管线"的反模式。
- 反转触发：出现真实存量用户或移动端无法同步升级时，重新启用 AD-06/§6.6 类机制，
  以新决策记录。

### AD-08 v1 交付边界：以钉版 glass 原型功能面为合同；单设备 + 公开链先落地，在役 E2EE 不切割

- Context：架构终态（多设备 checkpoint、密文子链、毁站回灌）工程量大且其中多项在
  钉版原型上没有对应产品面。用户已确认以 peers-touch-show 的 DesignDirections「松绿 ·
  北极星」glass 原型（`packages/prototypes/shared/ui-system/moments/`，动态/圈友两范围）
  的可见功能集作为第一版产品合同；原型不迁移私密状态机、无多设备/毁站恢复入口。
- Decision：
  1. **v1 只迁移公开对象**（post/edit/tombstone/reaction/comment）到设备签名 feed log，
     旧公开直写 hard cut（AD-07a 不变）。
  2. **v1 单设备**：每个 actor 一条设备链，设备授权取主身份对首建设备密钥的 attestation；
     不实现 checkpoint 合并器（§6.2 的多设备合流仍为终态），第二台设备发帖在 v1 被
     typed 拒绝并给出可定位错误，不静默降级。
  3. **非公开受众（followers/friends/circle/group/allow/deny/self）v1 不换权威**：
     W11 hard-cut 后这些受众本就只走在役 E2EE prepare/submit（`social_private_posts`）。
     产品 UI 按受众分流——public 走签名链，其余走在役私密网关；两条路径并存不是双真相，
     因为权威域按受众公开性互斥。密文子链化（§6.4b、AFL-07/07B）整体延 v2。
  4. **公开跨站进 v1**：按 AD-03（v0.4）复用帧总线路由。
  5. **延 v2**：多设备 checkpoint 合流（AFL-04）、私密密文子链合同与切割（AFL-07/07B）、
     毁站后助记词身份重建与友站回灌（AFL-05B）。任务文件保留备查，移出 v1 计划的
     tasks/closures/criteria；v1 不承诺这三项的 Journey，相关 outcome 不参与 v1 完成判定。
  6. Mobile 公开发帖沿用 AD-07 的 typed 拒绝 + active gate 同提交处置；Mobile 私密能力
     不受影响（在役管线未动）。
- Rationale：可试的第一版应是一条最薄但完整的纵向主权闭环（签名→投影→跨站→Desktop），
  而非四个半成品子系统；在役 E2EE 是经过验证的生产路径，无存量迁移压力，没有理由在
  v1 为统一而重写它。
- 反转触发：v1 试用证明单设备语义阻碍真实使用、或私密受众的产品形态需要链上完整性时，
  按既有 AFL-04/07/05B 设计进入 v2，不需推翻 v1 合同。

## 10. 图表

- [Actor Feed Log 目标运行时拓扑](../../../actor-feed-log-target.svg)
  （viewpoint: Runtime Topology；箭头仅表示真实网络流；图文件在架构根，
  因 `social/federation` 尚未注册架构模块，图按 project 图位先例放置）
