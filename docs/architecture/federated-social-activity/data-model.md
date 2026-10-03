# Federated Human Social Activity — 数据模型

> **Status**: draft
> **Version**: v0.3
> **Created**: 2026-06-17 | **Updated**: 2026-10-03
> **Owner**: Architecture Team

---

## 1. 模型原则

1. 当前阶段只建模 Human 社交闭环。
2. 所有跨边界数据必须 Proto-First，不允许前端手写平行领域模型。
3. `ActorRef` 是身份载体，Profile 只是展示投影。
4. `Audience` 是可见范围真源，页面不能自行判断权限。
5. Feed projection 必须解释来源、关系路径和投递原因。
6. Agent / A2A / Applet 字段只保留扩展槽，不参与当前阶段业务逻辑。

---

## 2. 核心对象

| 对象 | 定义 | 当前阶段 |
|------|------|----------|
| `HumanActorRef` | Human Actor 的社交身份引用 | 必做 |
| `ActorProfileSummary` | Feed/Profile 使用的展示投影 | 必做 |
| `HumanPost` | 人类发布的动态 | 必做 |
| `CommentThread` | 评论与回复 | 必做 |
| `ReactionSummary` | typed reaction 汇总 | 必做 |
| `RelationshipReason` | 用户为什么看到此对象 | 必做 |
| `AudienceExplanation` | 可见范围的人类可读解释 | 必做 |
| `FeedProjection` | viewer-scoped feed 投影 | 必做 |
| `FutureExtensionSlots` | Agent/Applet/A2A 预留槽 | 只预留 |

---

## 3. Human Actor

```proto
// Conceptual shape. Final fields must be defined in model/domain/*.proto.
message HumanActorRef {
  string actor_id = 1;
  string display_name = 2;
  string handle = 3;
  string home_station_domain = 4;
  string home_station_peer_id = 5;
}
```

展示要求：

- Feed 中必须显示 display name 和 handle。
- 远端 Actor 必须显示 home Station。
- Profile 中必须显示 relationship to viewer。
- Unknown / unresolved actor 必须明确标识，不得伪装成本地用户。

---

## 4. Activity Object

```proto
enum HumanActivityKind {
  HUMAN_ACTIVITY_KIND_UNSPECIFIED = 0;
  HUMAN_ACTIVITY_KIND_POST = 1;
  HUMAN_ACTIVITY_KIND_COMMENT = 2;
  HUMAN_ACTIVITY_KIND_REACTION = 3;
  HUMAN_ACTIVITY_KIND_FOLLOW_EVENT = 4;
}

message HumanActivityObject {
  string id = 1;
  HumanActivityKind kind = 2;
  ActorRef author = 3;
  ActivitySource source = 4;
  Audience audience = 5;
  RelationshipReason relationship_reason = 6;
  InteractionState interaction_state = 7;
  FutureExtensionSlots extension_slots = 100;
}
```

说明：

- `Post` 仍然是当前 Moments 的核心对象。
- `Comment`、`Reaction` 可作为 Post 的互动，也可在通知/活动流中表达为 activity。
- `FollowEvent` 用于关系变化的可见活动，不等同于普通动态。

---

## 5. Feed Explanation Projection

当前落地协议位于 `model/domain/social/post.proto`：

```proto
message GetTimelineResponse {
  repeated Post posts = 1;
  string next_cursor = 2;
  bool has_more = 3;
  repeated FeedObjectExplanation explanations = 4;
}

message ListPostsResponse {
  repeated Post posts = 1;
  string next_cursor = 2;
  bool has_more = 3;
  repeated FeedObjectExplanation explanations = 4;
}

message GetPostResponse {
  Post post = 1;
  FeedObjectExplanation explanation = 2;
}

message FeedObjectExplanation {
  string object_id = 1;
  ActivitySource source = 2;
  RelationshipReason relationship_reason = 3;
  AudienceExplanation audience_explanation = 4;
  BlockExplanation block_explanation = 5;
}
```

设计约束：

- Explanation 是 viewer-scoped projection，不是 `Post` 的内在内容。
- `object_id` 指向 response 中的 `Post.id`。
- 页面必须优先渲染 explanation；缺失时只能做兼容降级。
- Station 保持权限真源，Desktop 不自行推断 block / permission 语义。

---

## 6. Relationship Reason

`RelationshipReason` 是 Human 联邦社交的关键模型，它解释“为什么我看到这条内容”。

| Reason | 含义 | Feed 表达 |
|--------|------|-----------|
| `SELF` | 我自己发布 | `你发布了` |
| `FOLLOWING` | 我关注了作者 | `因为你关注了 Alice` |
| `FOLLOWER` | 作者关注我 | `关注你的人` |
| `MUTUAL` | 双向关注 | `互相关注` |
| `CIRCLE` | 同属某发布可见圈子 | `来自 Infra Circle` |
| `MENTIONED` | 我被提及 | `提到了你` |
| `PUBLIC_FEDERATED` | 联邦公共内容 | `来自 Station B 的公开动态` |
| `PROFILE_VIEW` | 查看作者主页时出现 | `作者主页` |
| `UNKNOWN` | 无法解释 | 不应进入普通 Feed，必须降级或隐藏 |

---

## 7. Audience Explanation

`Audience` 是权限真源，`AudienceExplanation` 是 UI 投影。

| Audience | UI 表达 | 关键说明 |
|----------|---------|----------|
| `PUBLIC` | 公开 | 可跨 Station 可见，仍受 Federation policy 限制 |
| `FOLLOWERS` | 关注者可见 | 仅作者关注关系内可见 |
| `CIRCLE` | 指定圈子 | 发布者私有圈子，成员不一定知道自己属于圈子 |
| `GROUP` | 群组 | 复用 Group 成员关系 |
| `SELF` | 仅自己 | 不进入他人 feed |
| `CUSTOM_ALLOW` | 允许名单 | 只显示解释，不暴露完整名单 |
| `CUSTOM_DENY` | 排除名单 | 只显示解释，不暴露完整名单 |

---

## 8. Feed Projection

```ts
interface HumanFeedProjection {
  objectsById: Record<string, HumanActivityObject>;
  feedIds: {
    home: string[];
    federated: string[];
    profile: Record<string, string[]>;
    circle: Record<string, string[]>;
  };
  actorsById: Record<string, ActorProfileSummary>;
  feedExplanationsByObjectId: Record<string, FeedObjectExplanation>;
  loadingState: Record<string, FeedLoadingState>;
}
```

约束：

- Runtime 拥有 projection freshness。
- 页面只读 projection 并触发用户动作。
- Feed 不应通过 mount-time fetch 保持业务状态正确。
- Projection 必须能在 reload / reconnect 后恢复一致。

---

## 9. Block Explanation

`BlockExplanation` 当前阶段的主要职责是避免 UI 伪造 block 状态。

当前落地方式：

- 被 block 影响而不可见的内容不进入 feed response。
- 已返回的内容标记为 `BLOCK_STATE_NOT_BLOCKED`。
- `VIEWER_BLOCKED_AUTHOR`、`AUTHOR_BLOCKED_VIEWER`、`STATION_BLOCKED` 是协议预留，后续需要 block audit / moderation projection 才能展示。
- Station-level block 不能由 Desktop 根据缺失内容或 station domain 本地推断，必须来自 `moderation-projection.md` 定义的 Station policy source。

---

## 10. Future Extension Slots

```ts
interface FutureExtensionSlots {
  agentActorRef?: never;
  a2aTraceRef?: never;
  appletSurfaceRef?: never;
  coordinationRef?: never;
}
```

当前阶段这些字段不启用。设计预留的意义是：

- 不让 Human Activity Object 未来无法扩展。
- 不在当前阶段引入 Agent 社交、A2A 调用、Applet 发布和协作共识。
- E2E 验收不得依赖这些字段。

---

## 11. Cross-Station Private Resource Contract

The new wire source belongs under `model/domain/social/private_federation.proto`.
`model/domain/federation/delivery.proto` only enumerates the domain-neutral
payload kinds.

```proto
message FederatedPrivateResourceDelivery {
  uint32 format_version = 1;
  string federation_id = 2;
  string delivery_id = 3;
  string source_station_peer_id = 4;
  string target_station_peer_id = 5;
  peers_touch.model.actor.v1.ActorRef target_actor = 6;
  PrivateContentResourceKind resource_kind = 7;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 8;
  uint64 lifecycle_revision = 9;
  PostMetadata post_metadata = 10;
  CommentMetadata comment_metadata = 11;
  peers_touch.model.secure_content.v1.EncryptedPayload payload = 12;
  repeated peers_touch.model.secure_content.v1.ViewerContentKeyEnvelope
      target_actor_envelopes = 13;
  repeated peers_touch.model.secure_content.v1.EncryptedObjectDescriptor
      objects = 14;
  PrivateContentVerification verification = 15;
  peers_touch.model.social.v1.AudienceExplanation audience_explanation = 16;
  google.protobuf.Timestamp committed_at = 17;
}

message FederatedPrivateResourceInvalidation {
  uint32 format_version = 1;
  string federation_id = 2;
  string source_station_peer_id = 3;
  string target_station_peer_id = 4;
  peers_touch.model.actor.v1.ActorRef target_actor = 5;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 6;
  uint64 lifecycle_revision = 7;
  PrivateResourceInvalidationReason reason = 8;
  google.protobuf.Timestamp committed_at = 9;
}

message FederatedPrivateInteractionCommand {
  uint32 format_version = 1;
  string federation_id = 2;
  string command_id = 3;
  bytes canonical_command_sha256 = 4;
  peers_touch.model.actor.v1.ActorDeviceRef actor = 5;
  string source_station_peer_id = 6;
  string target_station_peer_id = 7;
  peers_touch.model.secure_content.v1.SecureResourceRef parent = 8;
  oneof command {
    SubmitPrivateCommentRequest submit_comment = 10;
    PrivateReactionCommand reaction = 11;
  }
  string actor_signing_key_id = 12;
  bytes actor_device_signature = 13;
}

message FederatedPrivateInteractionResult {
  uint32 format_version = 1;
  string command_id = 2;
  bytes canonical_command_sha256 = 3;
  FederatedPrivateInteractionResultKind kind = 4;
  bytes canonical_result = 5;
  bytes canonical_result_sha256 = 6;
}
```

Exact field numbering is finalized before code generation. Unknown fields are
rejected for signed canonical messages.

## 12. Federation Payload Kinds

Add distinct durable kinds:

- `SOCIAL_PRIVATE_RESOURCE_DELIVERY`
- `SOCIAL_PRIVATE_RESOURCE_INVALIDATION`
- `SOCIAL_PRIVATE_INTERACTION_COMMAND`
- `SOCIAL_PRIVATE_INTERACTION_RESULT`

All are durable. Private content never uses the ephemeral signal path and never
enters Federation Ledger.

## 13. Remote Content PreKey Requests

Extend the generated Key Exchange contract with typed wrappers:

```proto
message ClaimFederatedContentPreKeysRequest {
  string source_home_station_peer_id = 1;
  string target_home_station_peer_id = 2;
  string federation_id = 3;
  peers_touch.model.secure_content.v1.ClaimContentPreKeysRequest request = 4;
  peers_touch.model.actor.v1.ActorDeviceRef requester = 5;
  bytes canonical_prepare_sha256 = 6;
}

message ClaimFederatedContentPreKeysResponse {
  peers_touch.model.secure_content.v1.ClaimContentPreKeysResponse response = 1;
}
```

The target Key Exchange authority stores exact replay identity by source
Station, plan ID and prepare hash. Inventory is advisory; claim is authoritative.

## 14. Recipient Projection Persistence

Recipient Home Station adds a separate projection family; it does not reuse
source-authority tables as if they were locally authored:

```text
social_remote_private_resources
  source_station_peer_id
  content_id
  generation
  target_actor_ptid
  lifecycle_revision
  resource_kind
  metadata_bytes
  encrypted_payload_bytes
  object_descriptor_set_bytes
  commit_proof_bytes
  proof_key_attestation_bytes
  state
  committed_at
  updated_at

social_remote_private_envelopes
  source_station_peer_id
  content_id
  generation
  target_actor_ptid
  key_kind
  recipient_device_id
  one_time_key_id
  envelope_bytes
  principal_epoch

social_remote_private_interaction_commands
  actor_ptid
  command_id
  source_station_peer_id
  canonical_command_sha256
  command_bytes
  result_bytes
  state
  created_at
  resolved_at
```

Primary and unique keys include source Station and target actor so equal
resource IDs from different authorities cannot collide. Receiver queries always
require the authenticated actor and, for endpoint envelopes, the current device.

## 15. State Machines

### Delivery projection

```text
ABSENT
  -> RECEIVED_PENDING_VERIFY
  -> ACTIVE
  -> REVOKED

RECEIVED_PENDING_VERIFY
  -> REJECTED_TERMINAL
ACTIVE
  -> ACTIVE          exact duplicate / newer interaction projection
ACTIVE
  -> REVOKED         valid higher lifecycle revision
REVOKED
  -> REVOKED         stale or duplicate delivery/invalidation
```

`REVOKED -> ACTIVE` is forbidden for the same resource generation.

### Remote interaction command

```text
PENDING -> LEASED -> RETRY_WAIT -> LEASED
LEASED -> COMMITTED
LEASED -> REJECTED
LEASED -> EXPIRED
```

Exact replay returns the recorded terminal result. Reusing a command ID with a
different hash is `PAYLOAD_HASH_CONFLICT`.
