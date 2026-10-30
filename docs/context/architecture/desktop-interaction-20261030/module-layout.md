# 模块关系

## Search Owner

- `runtimes/searchRuntime.ts`：输入、filter、Open intent、stable admission、focus/identity fence。
- `runtimes/searchQueries.ts`：订阅、AbortSignal、展示 frame、source validity、partial coverage 和租约驱动协调。
- `services/search.ts`：proto/native transport，不持有正文缓存。
- `components/search/`：纯渲染、输入焦点、键盘选择、复制 action、`?` coverage popover。
- `packages/search-core`：FIND/Suggest 来源选择、取消、有界 session、source worker、progressive source frame 与最终 RRF frame。
- `packages/messaging-core` 与端侧 Messaging Store：本机消息/会话 FTS。
- `apps/desktop/src-tauri/src/application/search/private.rs` 与 Secure Content：当前授权下的私密 Social 查询。
- `apps/station/app/subserver/social/infrastructure/public_search.go`：公开 Post/Comment 的参数化 ILIKE 与 100 候选窗口。

不新增第二个搜索引擎、preview cache 或 Overlay 私有 Social API。

## Moments Owner

- `runtimes/momentsRuntime.ts`：事件、scope、reconcile supervisor 和 post-scoped wakeup。
- `store/moments.ts`：公开 posts、feed windows、comments、reactions、纯资源归并函数。
- `store/privateMoments.ts`、`store/privateComments.ts`：原生私密 projection、command ledger、grant 状态。
- `components/moments/surfaces/`：content rail、thread、action row、composer 的共同边界。
- `MomentCard`：单 post projection，不判断媒体加解密，不注册刷新 timer。
- `SocialActionBar`：唯一多 kind reaction/comment action bar；旧 ReactionBar 语义并入后删除。
- `CommentList`/Social mention controller：thread draft、actor candidate popover、IME 协调和一体提交控件。
- `interface/tauri_commands/asset_preview.rs`（提案提取的共享模块）：精确 selected-file SDK grant，供 Social/generic/Profile picker 复用。
- `interface/tauri_commands/oss.rs`：PUBLIC 明文 Social 上传；删除错误 public encrypted social 命令。
- Station social domain/application/infrastructure：typed mention 校验、已有 `mentions_json` 持久化、readback、父帖权限复核和 notification Bridge `CategorySocial` producer；Desktop notification store 负责消费与跳转。

Post-level Moment composer mention 不在本次范围；私密媒体 grant 与 recovery 继续归 Secure Content。

## Identity Owner

- `kernel/identityLifecycle.ts`：纯 phase/freshness reducer，新增 presentation 状态只表达 edge completion，不把 avatar cache 当身份真源。
- `kernel/identityRuntime.ts`：按 edge matrix 执行 profile/account/asset readiness，处理 pending completion、生产密码登录重接和 epoch fence。
- `pages/login/LoginPage.tsx` 与 `store/session.ts`：提交密码登录后交给 Identity Runtime，不直接把 session 切到 ready。
- `services/avatarAssets.ts`：canonical key、native resolve、shared flight、Image.decode、LRU、last-good、scope cleanup；不依赖 React 组件。
- `store/session.ts`：当前 actor/session 镜像，保存 canonical avatar identity 与 local path，不导入组件。
- `store/accountIdentity.ts`：账号列表投影，和 session 使用同一身份记录。
- `components/common/SquareAvatar.tsx`、`UserSquareAvatar.tsx`：ready/absent/degraded/neutral placeholder 纯渲染。
- `application/profile/mod.rs`、`infrastructure/avatar_cache`、Station resource projector、Tauri/HTTP gateway 及 fallback `account_sync_avatar`：返回相同 canonical identity/path/state，按 cache identity 命中本地物化，不暴露 per-process token 为持久 key。

## Model Owner

- `model/domain/search/search.proto`：Suggest/FIND scope 合同继续生效；本方案不新增 proto 字段。
- `model/domain/social/comment.proto`：Comment/Create typed mention 字段，不改无消费者的 Update。
- `model/domain/social/post.proto`：继续复用 Mention 类型，不复制定义。
- `model/domain/realtime/event.proto`：不新增 mentioned 字段；@ 通知走既有 notification Bridge。

所有 proto 变更经生成器更新 Desktop/Mobile/Go，禁止手改 generated 文件。

## 生命周期

- PageHost 保留 Search overlay `on-visit + none`、Moments primary `idle + forever` 的既有注册。
- hidden feed 不因 post-scoped event 重绘整张列表；选择器只订阅资源切片。
- popover、mention、preview 随明确动作挂载，关闭释放并还焦。
- native file grant、private media grant、AvatarAssets flight、reaction/comment command 均绑定 session/scope，迟到回调无法复活旧 scope。
- 没有第四个跨 Search/Social/Identity 的“体验状态 store”。
