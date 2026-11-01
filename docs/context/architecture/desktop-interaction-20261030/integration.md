# 集成边界

## 接入及禁止关系

Search UI → searchRuntime/searchQueries → existing native Search composition →
Messaging/Secure Content/Station Social 原域读取。复制仅使用当前有效结果。
禁止 Overlay 独立抓 Social API、建立正文缓存、把 Social 塞入无网络 Suggest 或绕过原域 resolve。

Social UI → Moments command/projection Owner → public Social API/OSS 或私密 Secure Content。
禁止页面 mount 定时刷新、renderer 自行判断加密与解密、用 URL fallback 绕过私密 grant。
PUBLIC 与 PRIVATE 的分支在冻结 audience 的媒体 intent 处闭合。

Identity UI → Identity projection + AvatarAssets；Identity effect → native auth/profile/avatar cache。
禁止 session 导入头像组件、Avatar 独立修改 profile、登录页重复创建认证会话、
组件因头像未就绪启动第二次 profile sync。

## 确认后必须同时删除/替换的旧路径

- 非空输入固定回到 suggest 的产品规则；Enter 才扩大来源的交互分歧。
- Search Core 收齐来源后单帧返回的发布模型；新增 progressive source frame 和最终 RRF frame，renderer 不拆两条 query。
- no-store 响应固定每 2 秒重放的 renderer 协调规则；改为 lease/revision/focus 条件。
- 512 字符 UI 输入与 256 字符 search-core 上限的不一致；Station/共享协议先兼容，Desktop/Mobile 后强制。
- 结果正文外层导航 button 与常驻重复解释文案；保留 SourceCoverage 数据和信任区标。
- `ossUploadEncryptedAttachmentSocial`、`SocialEncryptedAttachmentUploaded`、native
  `oss_upload_encrypted_attachment_social`、main command 注册和同文件零调用 generic
  `upload_encrypted_attachment` dead helper。
- 生产 Composer 对 PUBLIC 图片使用加密上传的路径；acceptance 必须驱动真实 Composer，
  不能只让 harness 直接调明文 store action；同步改写 `harness.test.ts` 和 `moments-store.test.ts`
  对加密 Social 上传的 mock/断言。
- Social picker 直接返回未授权本地路径的行为；提取共享 selected-file preview grant。
- `viewerReactedKind` 单 kind 投影、已反应后消失的 picker、错误总数 chip 和零消费者旧 ReactionBar。
- public comment 缺失 typed mention 的 DTO、request、converter、readback、notification Bridge producer、Desktop 通知消费和 UI 断点；不新增 DDL，不改无消费者的 UpdateComment。
- CommentList 中 draftRevision 驱动的 remount、detail 无目的 Open/comment 死控件、
  Back 独立于 thread surface 的布局、IME composition Enter 提交。
- `primeResolvedLocal`、resolveCache/inflight 从 SquareAvatar 迁出，由 AvatarAssets Owner 实现；
  旧组件/新 service 不并行保有缓存。
- feed ingest 中无条件整对象替换、首批窗口截断 tail、只接受非空 reaction 的规则。
- fresh login 中 profile response 的 `avatar_local_path` 被 TS 丢弃、ephemeral resource token 被当长期 avatar key 的路径。
- 生产密码登录绕过 Identity Runtime fresh edge 的 LoginPage/store 路由；completed login 立即 ready 的闭包。
- `profile.avatar_url || user.avatar` 吞掉权威 ABSENT 的合并、OAuth 固定 650ms wait、Tauri/HTTP gateway/`account_sync_avatar` 响应不一致。
- SquareAvatar 迁移中丢失 `data:image/` 直出和 retired generated-avatar prefix 抑制的特例。

## 合同回流

本提案不是 active 真源。接受后同步修改：

- `docs/architecture/domains/search/product.md`：明确空输入 Suggest 无网络、非空实时 FIND 可访问当前 Station 的产品选择和用户可见范围说明。
- `docs/architecture/domains/search/{design,data-model,integration,decisions}.md`、
  `docs/client/desktop/search-experience-contract.md` 和 Search 原型：200ms admission、progressive/final frame、lease-driven reconcile、row copy/ARIA、256 上限。
- Social core/runtime 文档：PUBLIC/PRIVATE 媒体编码、reaction 多 kind、comment mention 与 notification Bridge 投递、feed revision/tail（含 home/explore）。
- `docs/client/common/ui-identity/modules/social/desktop.md`：Back 移入 thread card、composer 一体按钮、reaction picker 和状态规则。
- `model/domain/social/{post,comment}.proto`：生成 Desktop/Mobile/Go，不手改生成文件；`model/domain/realtime/event.proto` 不新增字段。
- `docs/client/desktop/identity-lifecycle.md` 与身份 invariant：avatar cache 不是身份真源，补 edge matrix、canonical identity/local path、ABSENT/FAILED/degraded presentation、生产密码路由和 owns 路径。
- 更新 `identityRuntime`/`useAppLifecycle` 既有测试，固定 fresh/completed/restore/applet 的不同等待语义；覆盖两个 profile IPC 入口。
- frontend component tree registry：更新 Search overlay、Moments feed/detail、Auth entry 的 alive/render/性能说明。
- 业务 Acceptance actions/oracles 和模块 registry capability/Gate；不改 domain-neutral Core，不把业务缺口算作 Core 失败。
- 更新知识文档中已过时的 `allow_file_preview` 名称和“三个 picker 已授权”表述，使其与实际 helper 和调用一致。

原型同步使用原 Prototype Lib。当前仅有架构提案，没有伪造高保真原型或 native proof。
共用 proto 的新字段必须全量再生成原消费端；Desktop 是本次产品验证主面，
不能把它的结果宣布为 Mobile 或跨 Station 全域通过。

## 已存在错误的公开媒体

改上传路径只保证新对象正确，不能让已上传的密文字节自动成为普通图片。
现场先区分未提交上传、已提交错误对象和私密正常密文；依据 metadata、MIME、
hash、实际字节解码和当前资源授权形成只读清单。

对确由错误 PUBLIC 分支产生且 descriptor 完整的对象，修复归 Social/OSS Owner：
验证原 Post、object binding 和 hash，材料齐全才能解密、重新编码为普通图片对象并更新权威引用。
不在卡片中增加永久旧格式解密分支，不删除原文件来假装修好展示。
材料不完整则保留可恢复失败状态并要求原作者重新选择图片。
任何涉及 corpstable 既有记录的实际修复要独立授权；本次只在 corpdebug 验证制备与读取。

## corpdebug 边界

env 本地提交 `8f1b08e`、`dbed153` 与 `73a186f` 已完成；profile、deploy、topology、文档及
git-crypt 加密的 Station/Relay runtime template 已 tracked-clean。peers-android 的
`make profile corpdebug` 和 `make env-check` 已通过，reset policy 为 agent-resettable。尚未部署 Station/Relay。

部署和验证必须按 canonical `make station` / `make desktop` 与 remote deploy pipeline：
确认 Station/Relay 独立容器项目、18380/18381 入口、独立卷/数据库/账户数据；
共享的是物理宿主，不共享运行状态。不停止 corpstable。
日志和完整截图放在 worktree 外受控证据目录；Git 只保留合同及引用。
