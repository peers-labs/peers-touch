# 数据及状态合同

以下是待接受的语义，类型名称为提案，不是已生成代码。

## Search

继续使用 QueryIntent、ResultItem、ResourceRef、SourceReadState、SourceCoverage。

- 空输入：Suggest，Device-only，不发网络。
- 非空输入：200ms stable admission 后自动 FIND，scope 为 Device + 当前 Station；Enter 只是 completion/refresh/open，不改变 scope。
- FIND 经 request-scoped native channel 发布带 `frame_kind/request_id` 的两类 frame：来源完成后的 progressive source frame，以及全部来源完成/失败/到 5s deadline 后的最终 RRF frame。Domain `search.proto` 不新增展示字段；桌面 native binding 定义内部信封。
- Progressive frame 无分页 cursor，不进入 reusable Query cache，不作为完整 empty/error 状态，也不触发协调重查；未完成来源保留 pending coverage。最终 frame 才有 continuation、RRF 排序、稳定 selection、缓存和协调资格。
- Renderer 按 ResourceKey 合并 progressive items，但最终 frame 以 Search Core RRF 顺序整体替换 progressive 排序；最终 frame 到达前可打开已签发资源。
- Enter 在 progressive 阶段只等待当前 request 的最终 frame，不另发 query、不取消慢源；deadline 到达后以 partial final frame 收口。
- 同一 draft 每个来源最多一个在途 operation；新输入、filter 变更、identity/source fence 取消旧 flight。
- focus、visibility、定时协调只在 source lease 到期、revision 变化或没有有效响应时重读；不再因 no-store 固定每 2 秒重发。无事件时公开源陈旧窗口不超过其 cursor TTL，Open 始终重新核权。
- UI/core/Station 最大 query 长度统一为 256 Unicode scalar 以内的现有 core 合同；先发布 Station/共享协议，再升级客户端强制上限。

一次展示提交包含 query、filter、来源向量、当前授权结果、selection 和 traversal。
输入 draft 与 displayed query 独立，结果高亮依据后者。
复制不触发 resolve 或 Open；可复制文本只包含当前读权下签发的 title/snippet。
没有第二个 preview 全文缓存。

大小写语义由原域实现：Messaging/私密 FTS 复用 tokenizer；公开 Post/Comment
使用参数化 ILIKE。候选边界和原有分页排序不变；大小写变体应返回相同 ResourceKey 集合。
功能名匹配与高亮保留原文，测试 Unicode 长度变化，不能按 normalized 索引切割原字符串。

结果行结构：

```text
ul[role=list]
  li[role=listitem]
    -> open target[role=button, roving tabindex, text-selectable title/snippet/meta]
    -> copy button[sibling, labelledby row title]
```

listitem 内允许两个并列交互控件；open target 不再嵌套 copy button。
Search surface 使用真实焦点 roving tabindex，不使用 `aria-activedescendant`；ArrowDown 从 input 移交焦点，
第一行 ArrowUp 或可打印字符回 input。Copy 在 input/row 焦点下都作用于 active row，
且不覆盖当前 DOM 文本选区。

## 媒体 intent 与 projection

选图生成稳定 attachment intent ID，归属于 actor、session、draft ID/revision。
共享原生 preview grant 只覆盖用户选择的具体文件路径；父目录和相邻文件不可读。

状态：

```text
SELECTED -> VALIDATING -> LOCAL_PREVIEW_READY
PUBLIC：UPLOADING -> UPLOADED -> POST_COMMITTED -> IMAGE_READY
PRIVATE：READINESS -> ENCRYPTING -> UPLOADING -> POST_COMMITTED
         -> GRANT_PENDING -> DOWNLOADING -> DECRYPTING -> IMAGE_READY
```

每一步可进入 FAILED/CANCELLED/SCOPE_STALE；失败携带 stage、typed reason、retryability。
草稿不因失败清空。读取/解码失败不撤销已确认 Post，也不声称 upload 未提交。
本机文件路径仅通过受控 native intent 使用；私密 projection 不暴露明文路径。
私密媒体 renderer URL 是作用域受限 grant，不能当永久 object identity。

PUBLIC payload 只引用可公开解码的图片对象及真实 MIME、尺寸、字节大小，不能引用密文字节或 AES descriptor。
PRIVATE payload 复用 EncryptedMediaDescriptor，保持 ciphertext/plaintext hash、chunk、
object binding、受众和 device/recovery envelope 验证。
变更 audience 后不能复用按旧 audience 制备的上传结果。
已提交媒体仅在相同 object/descriptor/content generation/current authority 下保留能力。
grant 到期和授权撤销先于 UI continuity。

## Reaction

继续使用 ReactionKind、ReactionSummary 和现有 add/remove 命令。

- viewer 的选择是 `Set<ReactionKind>`，不是单 kind。
- 每个 summary count 只归该 kind，不能把全帖总数贴在一个 emoji 上。
- interaction state 归 actor/session/post/kind，包含 desired operation、pending、committed/readback、unknown、rejected。
- 公共 React/Unreact 可携带客户端 operation ID 做日志和本地 fence；当前 Station 不持久化或回显 exact replay，add/remove 幂等由复合键保证。
- 私密沿用原 command ledger。迟到结果不能覆盖更晚 intent；失败回到原权威 summary，空集合是有效结果。
- pending 只禁用对应 kind，不禁用整个 picker。
- 不以客户端 delete/add 两个写入模拟“更换”。

## Comment 与 mention

复用 [post.proto Mention](../../../../model/domain/social/post.proto#L679-L690)：
`actor_ptid`、UTF-16 code unit `offset/length`、`display`。

公开协议新增字段：

```text
Comment.typed_mentions = 22
CreateCommentRequest.typed_mentions = 4
```

不修改没有生产者的 `UpdateCommentRequest`，也不修改 MomentEvent；@ 通知的投递状态归 notification Bridge。
无需新增 DDL：`social_comments.mentions_json` 已存在。
Station 把 request mentions 序列化到该列，读回时还原为 typed mention；public search projection
从同一未删除 Comment 读取。

Station Comment Owner 校验：

- range 不越界、不交叠、display 与对应 UTF-16 文本一致；
- actor 可解析且提及不改变父 Post audience；
- Social → notification Bridge 的 `CategorySocial` 投递前再次用父帖可读性裁决 mentioned actor；
- 公开通知可含最小展示文案；私密通知静态数据只存 post/comment/actor IDs，由客户端授权回读；
- 无权读者不能通过事件载荷获得正文、display snippet 或 post title；
- Bridge 未注册或投递失败不回滚评论，记录 typed warning/metric；不伪造通知、不做无界补投。

私密 comment intent/payload 已有 mentions，接入同一 UI controller 和原加密文本。
候选仅来自已可见 actor projection；显示名称不是身份，未选择的裸 `@名字` 不自动猜 PTID。
删除/替换文字时调整受影响 range；非法 range 阻止提交并保留草稿。

thread draft 由 actor/session/post 绑定，包含 text、mentions、replyTarget、
draftRevision 和 publication state。确认已提交但未读回时展示 readback pending，
不重新发评论；新草稿与已提交 intent 独立。draftRevision 是数据，不是组件 key。

## Feed 和线程

存储继续是 `postsById + feed windows + reactions + comments`，区分：

- resource identity：post/comment ID；
- content revision：正文与附件描述；
- interaction revision：评论/reaction 摘要；
- read authority：当前可读状态；
- view context：first window、tail、scroll anchor、输入焦点、展开状态。

归并规则：

- 同 ID 且 content revision 相等，保留实体引用和解码媒体。
- reaction/comment 更新只改 interaction projection。
- first-page reconcile 更新权威排序和游标，但不把“首批未返回”解释为 tail 删除。
- tail 只在删除/撤权事件、成员/受众变化或有界 tail verification 判定失效时移除。
- authority 变化立即重投影或移除，不能用 UI continuity 延长读权。
- 空 reaction/comment summary 可以覆盖旧非空集合。
- 后台刷新不显示页面级 skeleton；无当前数据才显示首屏 loading/empty。
- 同一帖子到处消费相同资源 projection，卡片不注册 timer/stream。

详情 embedded 状态隐藏无 handler 的 Open/comment 控件。Back 是 root card 的导航 action，
在线程卡片头部，不再是脱离卡片的独立行。

## Identity 与 AvatarAssets

Identity 继续持有 authenticated edge、profile freshness、account cache 和 canonical avatar identity。
AvatarAssets 仅持有资产解析/解码状态：unresolved、resolving、decoding、ready、absent、failed；
它不是认证、profile 或授权真源。

asset key：

```text
[sessionEpoch, actorPtid, stationScope, canonicalAvatarIdentity, profileRevision]
```

Station profile 返回 raw avatar identity/path/state，不把 per-process
`station-resource://local/<token>` 作为持久 key。native cache 命中时不重复 fetch；
失败不永久缓存 null，网络恢复或显式重试可重新解析。缓存最多 256 条，按 LRU 释放 decoded Image。
`data:image/` 继续直出，retired generated-avatar prefix 继续拒绝；二者不进入 native resolve。

Edge matrix：

```text
fresh OAuth        -> pending completion; profile/account/local asset ready/absent/failed before LOGIN_COMPLETED
fresh password     -> LoginPage/store rerouted through Identity Runtime; local path from auth response is decoded before ready
completed_login    -> PIN set/skip/relink waits for the same completion closure, starting at the user action
restored_session   -> valid session enters Shell; only local last-good decode is awaited
pin_unlock         -> same as restored_session; no network wait
account_switch     -> local last-good/neutral placeholder; late old-actor response fenced
applet_launch      -> no avatar preparation
```

fresh edge 头像准备预算 2s；超时进入可观察 degraded，不阻塞有效会话。
restore/PIN/switch 只等本地 decode 250ms，不重新等待网络。
无头像 (`ABSENT`) 第一帧即确定 fallback；有 URL 但尚未 ready 是 neutral placeholder，
不显示可能属于其它 actor 的字母或图片。同 actor profile URL/revision 变化在新图 decode 后 swap；
新 actor 不借用旧图。same-URL 内容更新必须由 profile revision 驱动；没有 revision 时不宣称支持。
