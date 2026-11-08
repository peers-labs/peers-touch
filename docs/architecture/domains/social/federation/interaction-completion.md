# Social 评论点赞与投票合同

状态：**accepted，2026-11-08**。用户确认：「同意，继续吧，不要留遗产」。
本文在 AD-08 的原公开签名与私密 Owner 内补充交互合同；实施必须同步原协议、
消费者、文档和验收。用户同时授权 Social 本地 checkpoint commit，以便双站
同源验收。实现和产品证明仍须分别验证，已冻结 Plan 的 planned 区不得原地改写。

上游：[Actor Feed Log §6.0](./actor-feed-log.md#60-v1-冻结合同)、
[Moments](../core/moments.md)、[Secure Content](../../../shared/security/secure-content/README.md)、
[跨站 Social](../cross-station/README.md)、
[Desktop Runtime](../../../../client/desktop/runtime-projections.md)。

## 1. 已核实的缺口

- `model/domain/social/feed_log.proto` 的 `FeedReactionMutation` 只有
  `target_post_ref`。Go `ValidateFeedPayload`、`FeedProjector.projectInteraction`
  和 Native journal 都按帖子引用处理；评论点赞没有签名写入合同。
- `comment.proto` 的 `likes_count/is_liked` 是返回字段。Desktop `CommentList`
  目前只有回复和删除动作，不能由这两个字段推断点赞已经可用。
- `poll.proto` 有公开 `VotePollRequest`，`private_content.proto` 有
  `VotePrivatePollRequest/HashInput/Authority/Projection`。在 Social application
  和 Native command 中未找到投票执行入口；投票选项展示不构成投票能力。
- `MobileDeviceSearchGate` 的原 Suite 只有 iOS/Android。现有
  `ChatMixedNativeProvisioner` 拥有 Desktop + iOS 的生命周期，但不能直接
  当成双平台 Search 的已准备作者。公开种子仍调用被拒绝的 Mobile 无签名写。

以上是源码事实。尚无当前源码 Native 运行结果证明上述交互。

## 2. 产品合同

**IC-J01 评论点赞**：读者可以点赞和取消点赞一条可读评论，包括根评论和回复。
成功后自己和其他读者看到一致的状态；重启后保持；父帖或评论不可读时拒绝。
UI 只显示已确认并回读的计数，pending/error 单独呈现。

**IC-J02 投票**：读者在截止前选择满足最小/最大数量的选项并显式提交。
同一 Actor 在同一投票中只有一份当前选票；截止前可替换选择，
相同选择重试不增加人数。截止后只读结果。公开投票不承诺匿名；
私密投票不向未授权者公开题目、选项或明文选择。

**IC-J03 恢复**：提交结果未知时保存原命令/签名字节，再查询或重发原命令。
确定提交而回读失败时保留 pending readback。取消本地选择不撤销已提交选票。
账号、Session epoch 或 Station 变化丢弃旧投影和迟到回调。

**IC-J04 权限**：评论点赞和投票不得扩大父帖受众。block、撤销、删除及过期
由原 Owner 执行；UI 不能从关注状态或缓存正文推导写权限。

## 3. 公开交互权威

继续使用 AD-08 的 Actor 根签创世、唯一设备授权、设备签名 journal 和原 Feed
提交路由。任何新动作都不能通过旧公开 CRUD 或 Station 代签进入公开投影。

扩展原 `FeedReactionMutation`：保留必需的 `target_post_ref` 作为线程锚，
增加可选 `target_comment_ref`。两者均使用规范 `oss://<home>/post|comment/<id>`，
签名负载不使用各站本地投影 ID。评论引用必须绑定到该父帖的已验证创建事件；
空评论引用仍表示帖子反应。

反应业务唯一键为 `(target_object_ref, actor_ptid, reaction_kind)`。
同一 Actor 当前唯一设备链的较大序号决定 set/remove；重放旧序号不能复活反应。
评论被删除后不重新公开其反应，父帖被删除时整个线程投影不可见。
原线程 Store/Fanout/Delivery 负责传播，原 Native verifier 逐条验证引用和签名。
`likes_count/is_liked` 由已验证的 LIKE 反应重放得出。

在原 Feed 负载中增加 typed **poll ballot set** 事件：

- 绑定稳定父帖引用、原投票定义哈希和规范排序的不同 option indices。
- 选项、最小/最大选择数和截止时间在创建后不可改变；正文编辑不改变投票定义。
- 唯一键是 `(post_ref, actor_ptid)`；较大有效链序号替换旧选票。
- 重试仍发送同一事件，汇总从有效选票派生，不相信 Station 返回的计数。

**截止时间需要明确的新增权威边界**：Actor 签名的 `created_at` 不能证明真实
提交时间，恶意设备可以回填时间。由帖子作者 Home Station 在原交互事务中
判定截止，并产生绑定 event hash、poll-definition hash、接受时间和结果的签名
投票接纳回执。Native 验证该回执和 Actor 选票后才计数。源站投递延迟到截止后
会被拒绝，即使用户在截止前点击过提交；该结果必须清楚显示。

该回执只授予时间/接纳判定，不替 Actor 选票签名，也不证明汇总完整性或物理时钟
绝对正确。Home Station 的遗漏、停机或时钟错误仍是可用性/时间判定边界。
跨站客户端不能用接收时间或本机当前时间独立重新判定旧选票。

## 4. 私密交互权威

原 Secure Content prepare/submit、资源权限快照、设备验证和共享 Federation
command/result 管线继续拥有私密内容和权限。此次不迁移私密内容到公开 Feed。

评论点赞扩展原私密反应命令的 typed target，绑定原 parent post ID 和 comment ID；
评论、父帖与当前 viewer 权限在同一原 Owner 事务中检查，再更新反应与结果。
签名、命令哈希、去重和回读都必须包含 target，不能复用只绑定帖子的签名。

私密投票使用已声明的 `PrivatePollAuthority`、opaque option IDs、
`VotePrivatePollRequest` 和 `VotePrivatePollHashInput`，接入原 private interaction
的设备签名 command/result。Station 根据授权的 opaque option 集和自己的接纳时间
检查选票，不解密题目或选项文案。结果只经原授权投影返回。
同一 Actor 的当前选票替换和精确重试遵守 IC-J02/03。

目标反应和选票继续由 Social 原 Store 家族拥有；不能建立第二个公开 subserver、
权限表、消息传输系统或前端真值 Store。实现时须同步原交互 Domain Binding、
跨站签名输入和接受结果，不只增加 UI 按钮。

## 5. 客户端、复用与失败状态

组件只提交意图、渲染 Runtime 投影。评论行、投票表单、pending/error 展示进入
现有 peers-ui；原型和 Desktop 消费同一组件。UI 本地只保存未提交选项与焦点。
Moments Runtime 继续负责即时事件和周期回读，并保持可见线程兴趣与身份栅栏。

相同目标和方向的进行中命令共享完成；相反命令在当前命令未确定前拒绝。
投票使用完整选项集合替换，不能逐选项增加计数。成功只有 verified committed、
duplicate committed 或 verified readback；HTTP 成功码和 optimistic toggle 均不足。

需要 typed 区分：目标不可读、评论已删除、非投票、选项错误、数量错误、
定义变化、已截止、结果未知、提交后回读等待、设备写权拒绝和身份已替换。
不把超时解释为未提交，不把首次无结果解释为永久不可读。

Mobile 的公开写权仍按 AD-08 拒绝；此次为既有 Search 验收接入真实 Desktop
签名作者。由原 Mobile Search Provisioner 在 Suite 准备期组合现有 Desktop
启动/身份/build Owner，提前创建一个独立作者并一次性准备公开帖子和历史评论。
iOS/Android 场景只消费已准备作者和原资源引用，私密种子仍由原 Mobile Owner
发布。禁止在首场景开始后补建客户端、登录或源身份。

## 6. 可证伪的验收

**IC-A01**：两个 Native 读者对根评论/回复点赞、取消点赞、重试、重启读取一致；
签名错误、错误父帖、伪造本地 ID、旧序号和删除目标均被原 Owner 拒绝。

**IC-A02**：单选/多选合法提交、替换、同 Actor 重复提交不增加人数；
无选项、重复选项、越界、数量错误和过期拒绝。投票定义编辑被拒绝；
正文编辑保留原投票和互动。作者站接纳回执及计数篡改在 Native 被拒绝。

**IC-A03**：私密授权用户得到可读结果，非成员、撤销后、block 后和旧 epoch
拿不到正文、选项或结果。对跨站 delayed result、精确 retry 和删除父帖执行回归。

**IC-A04**：原 Public Native Suite 注入已提交后丢 ACK、丢通知、撤订后继续发布、
第二写入设备、正文篡改和已见 head 回退；每场景必须有实际 UI 动作和接收端
绘制断言。故障由原 Runtime/Fixture Owner 提供；不写前端 Store 模拟成功。

**IC-A05**：原 Mobile Social Search Suite 从 Desktop 已签名种子取得公开帖子和
22 条较新评论；两端均可打开历史评论、返回、删除后清除原引用。继续保留真实
私密种子、公开写拒绝、账号隔离、outage、block 与撤销断言。

**IC-A06**：与相同 Actor/Station/源身份下的正常链路比较实际提交到绘制延迟、
每个线程回读次数、bounded page/response、重试次数和完整清理。
不从 source tests 推导 Native 性能，不用不可比样本宣称提升。

以上接入原 Gate Catalog/Runner 和 Suite Runtime ledger。Source、结构、原型观察、
FUNCTIONAL_CHECK、ACCEPTANCE_PROOF 分开记录；正式 closure 在开发 Journey 通过后
执行一次。冻结 planned 效果区不由本文或源码检查核销。

当前 AFL 计划的 `Acceptance Execution` 十个 closure、completion 和 full
都是空数组，`planctl inspect` 返回 `allDeclaredGateIds=[]`。计划结构通过不能
证明其执行选择完整。补充实施须由原 Plan Owner 把已接受的检查与 Native Gate
映射进 closure，并保持 planned 效果区的 digest；在此之前只使用明确指定的
原 Gate，不把空选择解释为验收通过。

## 7. 决策与代价

采用原 Owner 的 typed 扩展，以保持引用、权限、
签名、去重、传播和投影在同一闭环。代价是生成协议、各端 verifier、
private interaction 和现有验收都需同步更新。

不采用前端 toggle 或无签名 vote RPC，因为它们不能满足 Actor 公开写入权威。
不采用设备自报时间判定截止，因为签名不能证明物理时间。
新增投票接纳回执意味着作者 Home Station 承担截止判定，需单独审查该信任边界。

已确认：本文 IC-J01..04 的产品行为、公开投票截止的 Home Station 接纳权威，
以及据此扩展原公开/私密协议。原 Owner 负责更新有效架构、生成协议、迁移完整
消费者并实施；本文不构成已实施或已验收结果。旧展示假动作、无签名写和
平行交互路径不得在完成状态中保留。

## 8. Native 远端身份引导

公开 Feed 的远端读取先取得 Actor Identity 原 Home-signed manifest，再通过
原 Federation scoped resolver 取得原始 `signed_profile`。展示投影不能替代签名
证明；`/actor/federation/profile` 是 Home Station 的本地 Actor 端点，客户端不能
把远端 handle 发给自己的 Station 并期待它返回远端证明。

Native 使用当前 Actor 可见的 active Federation contexts，逐一以明确
`federation_id` 请求原 resolver；只对目标在该 context 不可见的 404 继续查找。
网络、鉴权和完整性失败保持原错误。回包的 context、handle、Home Station、
PTID、key fingerprint 与原始 envelope 必须一致，随后独立验证签名和有效期。
相同 Home Station 的已有 key pin 不得被新回包替换。

`ActorRef.acct` 的持久化投影与 resolver 的 `@user@host` 查询格式通过现有
Secure Content canonicalizer 统一；只规范查询提示，不修改已签名的 manifest
或 envelope，PTID 与 Home Station 的证明绑定保持严格一致。

Station Registry 可保存只有身份用途的远端 Federation key pin。该记录不产生
Station transport entry、route、Access binding 或 Session；传输目标的注册和
准入仍由原 Station Runtime / Node Connectivity Owner 完成。

Federation 原 Actor cache 在 `touch_actor.federation_profile_envelope` 保留完整
Home-signed profile 字节，与同一 Actor 展示投影一起刷新。缓存命中仍核验当前
signed locator 的 revision、Home Station、key pin、membership 与原 envelope
签名/有效期；不得从展示列重建无签名信封。旧缓存没有原证明时按 miss 重新读取
Home Station，已有信任固定不能被缓存或重新读取结果替换。
