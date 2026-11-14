# Federated Human Social Activity — 数据模型

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-17 | **Updated**: 2026-11-08
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

公开协议真源是 `model/domain/social/feed_log.proto`，私密协议真源是
`private_content.proto` 与共享 Federation private interaction 协议。
[D-08](./decisions.md#d-08-评论点赞与投票延伸原交互权威) 的数据约束为：

- Reaction 的线程锚 `target_post_ref` 必需；可选 `target_comment_ref` 使用规范
  `oss://<home>/comment/<id>`，原投影验证其已签名创建事件属于父帖。
  业务键是 `(target_object_ref, actor_ptid, reaction_kind)`，较大链序号覆盖旧状态。
- Ballot 绑定父帖、创建时投票定义 SHA-256 和严格递增的不同选项索引；
  `(post_ref, actor_ptid)` 保存当前有效选票，人数和选项计数由选票重放派生。
- 接纳回执绑定 event hash、definition hash、作者站、接受时间和接纳结果；
  Native 使用独立可信 Station signing-key attestation 验签。
  签名负载、journal 和原线程回执持久化；SQL 计数和前端计数为可重建投影。
- 私密 target 同时绑定 parent post ID 与可选 comment ID，进入命令哈希、
  设备签名、去重和原权限事务。Opaque option IDs 与定义哈希进入私密选票，
  Station 不解密选项文案；授权投影返回当前 viewer 选择和计数。
- 私密反应摘要继续经 `FederatedPrivateResourceDelivery` 传播，typed
  `REACTION_PROJECTION` 只携带父帖引用、评论目标、命令身份、独立反应版本与
  viewer-bound summaries，不重复传送密文或信封。源事务从原冻结 recipient
  locality 取得 Home Station，并重验当前父帖、评论与 recipient grant。
  接收事务重验原已导入资源及本地 block/tombstone；资源尚未到达时保留重试，
  已撤销或被屏蔽时拒绝。摘要和 command/result 共用原反应投影表；
  同目标旧版本不能覆盖新版本，同版本内容冲突必须拒绝。
- 公开评论 point/window/page 的 `likes_count/is_liked` 从原已验证反应投影
  派生。一页只查询已授权评论目标的反应，并统一应用 viewer 共同连接、
  block 与 Station moderation 过滤；不会把帖子反应算入评论。
- Desktop/Mobile 私密反应 journal 的分区键均为 `(post_id, comment_id, kind)`；
  旧帖子命令迁移为空 `comment_id`，保留原签名字节和哈希。反应完成在原事务内
  合并当前目标的摘要版本，正文、媒体与评论回读提交同样保留较新反应，并返回
  实际持久化的合并投影。客户端私密评论行消费共享 `MomentCommentRow`，
  同目标同方向共享完成，未知结果以原命令重试；身份或权限失效不能发布迟到结果。

产品状态与验证边界见 [交互合同](./interaction-completion.md)，不在本文件复制。

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
