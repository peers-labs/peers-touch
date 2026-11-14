# 朋友圈主权架构（Actor-Owned Moments）v1 实施计划

> **Plan ID**: AFL-20261106
> **Version ID**: 20261107-actor-owned-moments-r5
> **Created**: 2026-11-06T13:30:00.000Z
> **Owner**: Social / Federation / Desktop
> **修订**:
> - **r4（2026-11-07）**：① 跨站传输事实更正——域中立帧总线 `/federation/delivery`
>   （outbox+dispatcher+HTTPTransport/Relay opaque+Registry）已在役，公开跨站改为
>   复用总线（新增 feed 通知/互动 PayloadKind + receiver），仅缺口拉取新增 peer route
>   （架构 v0.4 §6.5/AD-03，作废 r3「全新端点、不复用」）。② 按用户确认的 glass 原型
>   功能面裁剪 v1 范围（AD-08）：AFL-04（多设备 checkpoint）、AFL-05B（毁站回灌）、
>   AFL-07/07B（密文子链切割）移出 v1 任务/闭合/标准，任务件保留备查；v1 单设备语义；
>   非公开受众继续走在役 E2EE，不切割。v1 任务 14→10，outcome 标准 16→11。
> - r3：架构层命名升格为「朋友圈主权架构 / Actor-Owned Moments」（机制名 Actor Feed Log 保留）。
> - r2：基于独立计划评审（1 BLOCKER + 6 MAJOR + 9 MINOR）修订：公开/私密切割分离、
>   补恢复协议 Task、DAG 串行化、Mobile 验收契约定主、Task 拆小、事实台账更正。

本计划只冻结实施模型，不表示实现已完成，也不授权 push、PR、发布、远程数据重置或历史改写。允许本地 checkpoint commit。

本轮实施授权为 Rust 内核和 Go 后端，UI/TS 产品化由独立 Owner 承担。
使用架构 v0.5 §6.0 的根签创世和固定 writer grant、独立可信根公钥、
`public/v1` 命名空间、有界订阅同步、独立线程真实性投影、持久化 fanout intent
和 Rust journal/head pin 合同。共享字节级原语位于 Frame `core/signedlog`，
领域序号、fork 和业务准入留在各自 Owner；治理链与 Secure Content 不改变 wire。
本轮不得自行 commit；原计划 checkpoint 声明不构成用户提交授权。

## 目标与完成口径（v1）

完成后必须同时成立：

1. 朋友圈**公开对象**（帖子、编辑、tombstone、reaction、comment）在 v1 的唯一突变权威是
   Actor 首建设备签名的 append-only Feed Log（单设备链，AD-08）；`social_public_posts`、
   MomentDelivery、计数与 FTS 由日志重放产生，旧公开直写在 AFL-03B cut commit 删除。
2. **v1 单设备**：每 actor 一条设备链，第二台设备的公开写被 typed 拒绝（可定位错误，
   非静默降级）；checkpoint 多设备合流（终态 §6.2）随 AFL-04 延 v2。
3. 公开 feed Station 间定向同步：事件通知复用在役 `/federation/delivery` 帧总线
   （新 PayloadKind + receiver，outbox 按 follower∩Audience 扇出，Relay 仅 opaque 转发），
   缺口/冷启动经新增有界拉取 peer route 补齐；非关注者评论/反应经同总线入站投递进入线程。
4. **非公开受众 v1 不换权威**：followers/friends/circle/group/allow/deny/self 继续走在役
   E2EE prepare/submit（`social_private_posts`），Desktop composer 按受众分流；在役私密
   管线与 native private gates 零回归。密文子链化（AFL-07/07B）延 v2。
5. Desktop 朋友圈按钉版 glass 原型（`packages/prototypes/shared/ui-system/moments/`
   动态/圈友两范围）产品化，组件全部来自 peers-ui，零临时件、零假人数据。
6. Mobile/旧端公开写在 cut 后服务端 typed 拒绝；`mobile-moments-participation` active
   契约同提交缩窄/改断言，不允许必挂 gate；Mobile 私密能力不受影响。
7. 公开内容 tombstone 不可真正收回是显式信用承诺。无共识/token/gossip/代签/snapshot；
   回滚仅靠 cut commit revert。
8. **v2 延期项**（AFL-04 多设备、AFL-05B 毁站回灌、AFL-07/07B 密文子链）不参与
   v1 完成判定，任务件移至 `deferred-v2/` 并标注 DEFERRED（plan 校验器要求 tasks 索引与
   tasks/ 目录严格一致），其 outcome 标准（O03/O05/O11/O12/O16）移出 v1 合同；零副本
   毁站物理丢失在 v1 是已知边界。

人类可读执行前后差异见 [outcome-comparison.md](./outcome-comparison.md)。

## 当前实施与验收状态

AFL-01/02/03A/03B/05/06 的 Rust 与 Go 源码已实施，统一源码门禁
`social-public-feed-source` 覆盖 Go 回归、Rust 签名向量及 Native journal/cache。
独立互动凭据冲突和送达 ACK 语义已做受控变异验证。
此状态不把跨层 Task 标记为 done。

AFL-03B 的 Mobile active publish 契约、AFL-08 的 Desktop 签名事件消费及
AFL-09 的双站 Native Journey 尚未完成；旧私密 Native Suite 不证明新公开链。
完整用户效果、研发接入与四条待验收 Journey 分别见
[用户说明](../../actor-owned-moments-user-guide.md) 和
[研发说明](../../actor-owned-moments-development.md)。
当前结论为源码实现已具备验证基础，产品交付未闭合。

## 关键事实（评审后更正，均经源码核实）

- **域中立 Station 间帧投递总线已在役（r4 新增）**：`frame/core/federation/delivery/`
  （持久化 outbox+dispatcher+lease fencing+幂等）、`transport.go`（local/routed/HTTPTransport，
  直连或 Relay opaque tunnel，Bearer token 与帧逐字段绑定）、`routes.go`（单一
  `POST /federation/delivery` 入口 + Registry 按 PayloadKind 分发）；`delivery.proto`
  在役 15 类报文（社交私密 resource/invalidation/interaction=12–15），无公开 feed 种类。
  公开跨站复用该总线，缺口拉取新增 peer route。
- `social_private_posts` 是**现役 E2EE 安全内容管线**存储（`infrastructure/private_content_store.go:811`，prepare/submit + grants/delivery intents），不是 legacy CRUD；评审 F-01。
- W11 hard-cut 后非公开受众只有 E2EE 一条路（`moment_service.go:314-319` 对 legacy 私密直写 typed 拒绝）；v1 非公开受众不换权威，沿用 prepare/submit。
- 公开动态无跨站 PayloadKind/receiver（`public_post_repo.go` 注释 "the moment AP outbound goes live"）；Station 间无 SSE，只有 30s ticker 轮询 + `/fed/v1/ledger/*`（治理语义，不复用）；评审 F-12。
- 公开发帖/评论无签名：`CreatePostRequest`/`CreateCommentRequest` 无字段，`comment.proto` 零签名字段；Reaction 仅 proto 预留 `actor_device_signature`，Desktop 发空、Station 不验（`social.rs`、`reaction_service.go:45`），实际 Ed25519 验签仅 `federated_private_interaction.go`；评审 F-08。
- 公开"编辑"当前不存在：`UpdatePostRequest` 有 proto 无路由无服务，POST_UPDATED 是新能力；评审 F-13。
- `domain/events.go` 四结构体是零构造点死代码；但 `moment_event_publisher.go` 是现役实时 SSE 桥（含跨站私密 StageImported* 事务钩子），二者不可混删；评审 F-05。
- `mobile-moments-participation` 是 active 验收契约（含 publish/react/comment 断言），cut 后必须同提交处置；评审 F-02。
- 两套 canonical 传统并存：federation deterministic-marshal 与 `internal/securecontent/canonical.go` 手写 protowire；评审 F-15。
- ledger proto 实际路径 `model/domain/federation/federation_ledger.proto`；评审 F-11。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "AFL-20261106",
  "versionId": "20261107-actor-owned-moments-r5",
  "createdAt": "2026-11-06T13:30:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/social/federation/actor-feed-log.md",
      "docs/architecture/domains/federation/wire-protocol.md",
      "docs/architecture/domains/social/core/moments.md"
    ],
    "decisions": ["AD-01", "AD-02", "AD-03", "AD-04", "AD-05", "AD-07", "AD-08"]
  },
  "scope": {
    "sourceClaims": [
      { "pathPrefix": "model/domain/social", "mode": "exclusive-write" },
      { "pathPrefix": "model/domain/federation/federation_ledger.proto", "mode": "exclusive-write" },
      { "pathPrefix": "model/domain/federation/delivery.proto", "mode": "exclusive-write" },
      { "pathPrefix": "model/build.sh", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/social", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/federation", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/frame/core/federation", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/frame/core/signedlog", "mode": "exclusive-write" },
      { "pathPrefix": "packages/ui", "mode": "exclusive-write" },
      { "pathPrefix": "packages/locales", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop/src", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop/src-tauri/src/interface", "mode": "exclusive-write" },
      { "pathPrefix": "tooling/acceptance", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/domains/social", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/actor_identity", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/internal/securecontent", "mode": "shared-read" },
      { "pathPrefix": "packages/secure-content-core", "mode": "shared-read" },
      { "pathPrefix": "packages/station-trust", "mode": "exclusive-write" },
      { "pathPrefix": "packages/messaging-core", "mode": "shared-read" },
      { "pathPrefix": "packages/prototypes", "mode": "shared-read" },
      { "pathPrefix": "apps/mobile", "mode": "shared-read" },
      { "pathPrefix": "apps/station", "mode": "shared-read" },
      { "pathPrefix": "apps/desktop", "mode": "shared-read" },
      { "pathPrefix": "model", "mode": "shared-read" }
    ],
    "nonGoals": [
      "v1 多设备 checkpoint 合流与第二台设备写入（AFL-04，延 v2；v1 第二设备 typed 拒绝）",
      "v1 毁站后助记词身份重建与友站链回灌（AFL-05B，延 v2；零副本物理丢失为已知边界）",
      "v1 私密密文子链合同与在役 secure-content 写路径切割（AFL-07/07B，延 v2；在役 E2EE prepare/submit 保持不动）",
      "Mobile 朋友圈新 UI 与设备签名发帖（cut 后服务端 typed 拒绝直到 Mobile 独立计划；聊天与私密能力不受影响）",
      "ActivityPub outbox、跨联邦公开发现",
      "token、gas、PoW/PoS、BFT 共识、sequencer 自动选举",
      "SSB gossip、mDNS 闲聊、客户端对等复制",
      "旧客户端兼容门、Station 代签、snapshot checkpoint、历史回填（AD-06/§6.6/§6.7 已废止）",
      "Relay 角色变更",
      "push、PR、公开发布、远程生产部署与数据重置"
    ]
  },
  "tasks": [
    { "id": "AFL-01", "workstreamId": "KERNEL", "path": "tasks/AFL-01.md", "dependsOn": [] },
    { "id": "AFL-02", "workstreamId": "LOG-BACKEND", "path": "tasks/AFL-02.md", "dependsOn": ["AFL-01"] },
    { "id": "AFL-03A", "workstreamId": "PUBLIC-PROJECTOR", "path": "tasks/AFL-03A.md", "dependsOn": ["AFL-02"] },
    { "id": "AFL-03B", "workstreamId": "PUBLIC-CUT", "path": "tasks/AFL-03B.md", "dependsOn": ["AFL-03A"] },
    { "id": "AFL-05", "workstreamId": "PUBLIC-REPLICATION", "path": "tasks/AFL-05.md", "dependsOn": ["AFL-03A"] },
    { "id": "AFL-06", "workstreamId": "INBOUND-INTERACTIONS", "path": "tasks/AFL-06.md", "dependsOn": ["AFL-05", "AFL-03A"] },
    { "id": "AFL-08A", "workstreamId": "PEERS-UI-PARTS", "path": "tasks/AFL-08A.md", "dependsOn": ["AFL-02"] },
    { "id": "AFL-08B", "workstreamId": "DESKTOP-INTEGRATION", "path": "tasks/AFL-08B.md", "dependsOn": ["AFL-03B", "AFL-05", "AFL-06", "AFL-08A"] },
    { "id": "AFL-08C", "workstreamId": "DESKTOP-JOURNEYS", "path": "tasks/AFL-08C.md", "dependsOn": ["AFL-08B"] },
    { "id": "AFL-09", "workstreamId": "END-STATE-PROOF", "path": "tasks/AFL-09.md", "dependsOn": ["AFL-08C"] }
  ],
  "outcomeComparison": {
    "path": "outcome-comparison.md"
  },
  "authorization": {
    "checkpoint": { "localCommit": "denied", "amend": "denied" },
    "delivery": { "push": "denied", "pullRequest": "denied" },
    "runtime": { "deployProfiles": [], "destructiveResetScopes": [] },
    "history": { "rewrite": "denied" }
  }
}
```

## 实施模型（r4 修订要点）

1. **v1 只切公开（AD-07a/AD-08）**：03A+03B 把公开对象切到签名 log；在役 E2EE 私密
   管线一行不动，非公开受众由 Desktop 按受众分流到在役网关；私密切割（07/07B）延 v2。
2. **v1 单设备（AD-08）**：不实现 checkpoint 合并器，每 actor 首建设备一条链；03B 起
   第二设备公开写 typed 拒绝。多设备（04）延 v2，故 05 不再被 04/07 阻塞。
3. **跨站复用帧总线（v0.4/AD-03）**：05 = delivery.proto 新增公开 feed 通知 PayloadKind
   + social receiver + append 事务内 outbox 扇出（范本：federated_private_resource），
   外加一个有界拉取 peer route（注册在 frame federation routes）补冷启动/缺口；
   06 入站互动同样新增 PayloadKind，不另造反向通道。
4. **DAG**：01→02→03A→03B；02→05；05+03A→06；02→08A；03B+05+06+08A→08B；08B→08C→09。
5. **实时桥（F-05）**：03A 显式区分 live apply 发布与 rebuild replay 抑制，保留跨站私密
   事务钩子（在役管线依赖，不得随公开 cut 删除）。
6. **事实更正（F-08/F-11/F-12/F-13 + r4）**：reaction/comment 公开签名是新建；跨站通知
   复用在役帧总线、仅拉取端点新增（r4 更正 r3）；编辑是新能力；proto 路径修正。
7. **体量拆分（F-07）**：03 拆 03A/03B，08 拆 08A/08B/08C。

## Acceptance Execution

v1 共 10 个闭合；DEFERRED 任务（AFL-04/05B/07/07B）不在此对象。

```json
{
  "closures": {
    "afl-01-signed-log-kernel": [],
    "afl-02-feed-log-backend": [],
    "afl-03a-public-projector": [],
    "afl-03b-public-clean-cut": [],
    "afl-05-public-feed-replication": [],
    "afl-06-inbound-interactions": [],
    "afl-08a-peers-ui-parts": [],
    "afl-08b-desktop-integration": [],
    "afl-08c-desktop-journeys": [],
    "afl-09-end-state-proof": []
  },
  "completion": [],
  "full": []
}
```

## 审批边界

用户于 2026-11-06 批准：目标终态、公开不可真删为信用承诺、无存量 clean cut、后端跨端 UI 仅 Desktop、peers-social worktree、原型以 show worktree 动态/圈友为准且全用 peers-ui。r2 修订（2026-11-06）经独立计划评审，公开/私密切割分离与 Mobile 验收契约定主属计划机械修订，不扩大授权。

**r4（2026-11-07）经用户当轮授权**：① 跨站底层复用在役 `/federation/delivery` 帧总线
（用户原话「底层分发方案就用刚刚的」）；② v1 功能面以用户确认的 glass 原型为准反推裁剪
（「原型上的功能我都确认了，先按照这个做一版」），多设备/毁站回灌/密文子链延 v2，
在役 E2EE 不切割。r4 属已授权方向上的计划机械修订，不扩大授权；仍不授权 push、PR、
发布、远程重置。
