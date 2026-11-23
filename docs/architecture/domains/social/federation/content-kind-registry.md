# Social 内容类型分发表（Content Kind Registry）设计

状态：草案（待评审）
关联：actor-feed-log.md、actor-owned-moments-development.md、data-model.md
触发：下线投票（Poll）能力前，先把内容类型/互动事件的硬编码 switch 重构为注册表，
使新增/移除一种内容类型不再需要改动签名投影与转换内核。

## 1. 背景与问题

Social 子服务（220 个 Go 文件、79 个测试文件）当前按内容类型分发的逻辑以内核
`switch ... case model.PostType_*` / `case *model.FeedPayload_*` 的形式分散在多个
包中。投票是最重的变体，其代码与点赞/评论共用签名事件管道：

- `domain/converter.go`：`encodeContent` / `decodeContent` 按 `PostType` 做
  proto oneof ↔ DB 列的双向转换。
- `domain/feed_payload.go` / `feed_log.go`：按 `FeedEventKind` / `FeedPayload.mutation`
  做签名载荷校验。
- `infrastructure/feed_interaction_projector.go` / `feed_interaction_worker.go`：
  按 `FeedPayload` 变体（reaction / comment / poll_ballot）做投影与准入。
- `application/private_content_service.go`：`PrivateMomentKind` ↔ `PostType` 映射
  （E2EE 私密链路）。

问题（定级：中等耦合，非严重架构缺陷）：

1. 违反开闭原则：新增内容类型必须回头修改内核 switch，跨 4 个包、25 个共享文件。
2. 通用 helper 与领域变体同居于 `feed_poll*.go` 等按类型命名的文件，内聚错位，
   删除任一类型时容易误删通用能力。
3. protobuf 封闭 oneof 的穷举 switch 同时承担“扩展分发”和“完整性校验”两种职责。

## 2. 目标与非目标

目标：

- 引入显式的内容类型注册表，转换/投影/校验通过查表分发；移除一个类型 = 注销一个
  handler + 删除其专用文件，内核与其他类型零改动。
- 行为完全不变：重构阶段（阶段一）不改任何线上语义、签名字节、DB 列或 proto 编号。
- 保留 protobuf 封闭枚举在“完整性校验”场景的编译期穷举保证（见 §5 边界）。

非目标：

- 不改变事件溯源模型、签名/哈希算法、E2EE 信封结构。
- 不在本设计内重新设计投票；投票仅作为“注册表化后第一个被注销的 handler”。
- 不重构错误码、受众、状态等与内容类型无关的 switch。

## 3. 注册表抽象

### 3.1 公开内容类型（PostConverter 侧）

```go
// domain/content_kind.go
type ContentEncoder interface {
    // proto 请求 -> DB 扁平列
    Encode(req *model.CreatePostRequest) (text, attachments, linkPreview, repostRef string, err error)
}
type ContentDecoder interface {
    // DB 聚合 -> proto oneof
    Decode(out *model.Post, p *Post) error
}
type ContentKindHandler interface {
    Type() model.PostType
    ContentEncoder
    ContentDecoder
}

// 进程内不可变注册表；包初始化时显式注册，拒绝重复/未知类型。
type ContentKindRegistry struct { /* map[model.PostType]ContentKindHandler */ }
func NewContentKindRegistry(handlers ...ContentKindHandler) (*ContentKindRegistry, error)
func (r *ContentKindRegistry) Get(t model.PostType) (ContentKindHandler, error)
```

每种类型一个 `content_<kind>.go`（text/image/video/link/repost/location/poll），
`PostConverter` 持有 registry，`encodeContent`/`decodeContent` 退化为查表 + 委托。

### 3.2 互动事件投影（FeedProjector 侧）

```go
// infrastructure/interaction_handler.go
type InteractionHandler interface {
    Mutation() model.FeedPayload_Mutation_Typename // 反应的 oneof 包装类型名
    Project(ctx context.Context, tx *gorm.DB, in InteractionInput) error
    // Supplement 返回该互动需要的 Home 准入补充；无则 nil。
    Supplement(*model.FeedInteraction) []byte
}
```

reaction / comment 各一个 handler；poll_ballot 作为独立 handler 注册，注销时仅删除
该 handler 与 `social_feed_poll_versions` 表相关代码，reaction/comment 路径不变。
`FeedInteractionCanonicalBytes`、`FeedInteractionTarget`、`OriginalFeedPostRequest`
等通用 helper 迁移到中性命名文件（interaction_canonical.go / feed_post_request.go）。

### 3.3 私密内容（E2EE 侧）

`PrivateMomentKind ↔ PostType` 的双向映射收敛为 `privateKindRegistry`，
每个 kind 一个编解码条目；`PrivatePoll*` 专用 authority/store 随 poll 条目一起移除。

## 4. 分阶段计划（每阶段独立提交、各自可编译、测试全绿）

1. 阶段一·Go 注册表重构（行为不变）：新增 registry 与逐类型 handler 文件，
   转换/投影/私密映射改为查表；`go test ./apps/station/app/subserver/social/...` 全绿。
2. 阶段二·注销 poll handler：删除 poll 的 registry 条目与全部 `*poll*.go` 专用文件、
   投影表与私密 poll authority/store；通用 helper 已在阶段一迁走，不受影响。
3. 阶段三·Rust：station-trust / desktop / mobile src-tauri 的 poll 模块与接线移除，
   `cargo check`。
4. 阶段四·Desktop / 共享 UI / Mobile：移除 MomentPoll、投影、composer/store 分支，
   `tsc --noEmit` + vitest。
5. 阶段五·i18n：移除 zh-CN/en moments.json 的 poll key。
6. 阶段六·验收 harness：移除 public_feed_native 等 poll 场景与 reset 签名表条目。
7. 阶段七·proto：删除 poll.proto，post/feed_log/private_content/private_federation
   移除字段并 `reserved` 旧编号，运行 model/build.sh 重新生成 Go + TS，全量构建收口。

每阶段提交信息需说明“行为不变（阶段一）/能力移除（阶段二起）”。

## 5. 边界与不变量

- 注册表只用于“可插拔的类型分发”。签名载荷的合法性校验（如 `ValidateFeedPayload`
  对未知 oneof 返回 `ErrFeedInvalid`）保留封闭穷举，确保未注册/伪造变体在安全边界被拒。
- 注册表在进程启动期构建为不可变对象；重复注册、未知类型查询必须显式报错，禁止
  运行期静默增删，避免把编译期保证换成运行期遗漏。
- 不改变任何已分配 proto 字段号；移除字段一律 `reserved`，杜绝线格式冲突。
- 阶段一必须是纯结构重构：签名规范化字节（signedlog.Canonical）输出逐字节不变，
  由现有 feed_log / interaction 测试锁定。

## 6. 验收

- 阶段一：social 四个 Go 包全部 `go test` 通过，且无任何 proto/DB/签名改动。
- 阶段二起：每阶段对应语言的类型检查与单测通过；最终 `model/build.sh` 生成物干净，
  `grep -r Poll` 在非测试、非生成、非 `.tmp/.local` 源码中无业务残留（仅保留 reserved
  与历史迁移注释）。
- 原生验收：`social-public-feed-native-e2e` 在 poll 移除后应不再包含 poll 场景，
  其剩余场景需重新绑定 current source 并取得 PROVEN。
