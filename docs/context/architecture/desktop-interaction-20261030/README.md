# Desktop 搜索、Social 与登录体验架构方案

状态：`proposed-r3.1`。日期：2026-10-30。待用户确认后实施。

工作区：`peers-android`。产品面：macOS Native Desktop；目录名称不代表本次只改 Android。
源码基线：`574cc209f`，已 rebase 到远端 master `d16a3c72f64b03028f801fbde16cbc86190bcc5e`。
本方案只修改提案文档；尚未修改生产代码，应用代码未提交、未推送。

## 要达成的体验

- **搜索**：非空输入停顿后自动发起 FIND；Search Core 先提交已完成来源的可读 frame，最终在 5s 预算内融合。大小写不敏感。结果片段可直接选择复制，键盘导航继续可用；解释性文案集中到可 hover、点击及键盘打开的 `?`。
- **Social 媒体**：选图立即预览，公开与私密附件分别进入正确的原生上传和读取链路，失败保留草稿并可重试。
- **Social 互动**：反应选择器始终可用，可继续选其它表情；评论支持真实 actor 的 `@`、持久化、通知收件箱和可读通知；提交按钮在输入框边界内，Back 在所属线程卡片头部，详情移除无用途控件。
- **阅读稳定性**：后台 reconcile 只更新变化资源，保留未变化卡片、媒体、分页尾部和输入状态；不通过清空列表或重挂载刷新。
- **登录头像**：认证、profile 与账号投影仍归 Identity；首次 OAuth/密码登录进入业务 Shell 前闭合头像准备，已登录 edge 使用本地 last-good，不先展示字母再替换成照片。

这不是另建“体验框架”。现有 Search、Moments 和 Identity 分别闭合自己的状态与契约，复用已有原生资源、安全内容、查询及 UI 组件。

## 已定位的事实

- 输入事件已经 dispatch，但非功能输入固定走 Suggest；Suggest 合同是 Device-only 且不发网络，FIND 才覆盖当前 Station。私密 Social 没有离线读租约，不能进入 Suggest。
- Station 公开 Social 搜索使用大小写敏感的 `LIKE`；本机 FTS tokenizer 已对 Latin 字符生成小写 token。
- 搜索结果整行是导航 button，title/snippet 不能选择复制；verbose coverage 同时出现在输入栏和 88px 固定 footer。
- 公开发帖分支调用 `oss_upload_encrypted_attachment_social`，对象以 `application/octet-stream` 密文存入 public moments；公开卡片按普通图片取原始字节解码。该错误足以导致上传成功但所有读者坏图。
- Social 选图器直接返回路径，没有授予所选文件预览能力。当前仓库不存在知识文档所称 `allow_file_preview` 符号；真实 helper 是 `messaging.rs` 内私有的 `allow_attachment_preview`，需要提取为共享能力。
- SocialActionBar 用第一个 viewer reaction 表示当前状态，并在已反应后隐藏选择器；Station/私密后端均按 `(post, actor, kind)` 复合键支持多 kind。
- 公开评论 wire 没有 typed mentions，但数据库 `social_comments.mentions_json` 和 Station converter 的存储骨架已存在；缺 proto、request 填充、proto readback、校验、事件 mention 列表和 UI。
- 45 秒 reconcile 重新发布首批 20 条 ID，无条件替换 Post 引用，空 reaction 不能归零，已分页尾部会被首批窗口截断；私密评论组件 key 包含 draftRevision。这些是确定的稳定性缺口；截图闪动的像素级因果仍需原生帧证据。
- OAuth 首次登录后，`sync_user_profile` 已物化本地头像文件，但 TS 合并 profile 时丢弃 `avatar_local_path`；Identity dispatch 也先进入 authenticated，再执行 profile reconcile。现有预热只设置 `Image.src`，不等待 decode。

## 独立复审处置

r1/r2 已完成两轮三路只读复审并修订为 r3：

- Search：保留 FIND，明确空输入 Suggest 与非空实时 FIND 的隐私边界；当前 core 会等齐来源，因此 r3 把 progressive source frame、最终 RRF 融合、排序稳定和分页边界列为必需改造。
- Social：确认公开媒体是架构级错配；改为明文 PUBLIC、Secure Content PRIVATE；补齐真实 Composer 验收。评论 @ 包含持久化、readback 和 notification Bridge 投递，而不只是插入文本。
- Social reaction 不新增服务端 ledger：公开 add/remove 的复合键已幂等；客户端本地 intent fence 防迟到覆盖，不承诺当前服务端 exact replay。
- Identity：生产密码登录绕过 runtime fresh edge 的路径必须重接；fresh OAuth/password/completion 闭合头像，restore/PIN/switch 只等待本地 last-good decode，applet 豁免。
- 复审提出的 `mentions_json` 已存在、`allow_file_preview` 符号不存在、详情评论死按钮、HEIC MIME、Station avatar 重复物化等事实均已纳入合同。

## 文档

1. [设计与证据](./design.md)：现状、Owner、目标交互、失败语义。
2. [决策](./decisions.md)：复用、替代方案、代价和复核条件。
3. [数据及状态合同](./data-model.md)：查询、媒体、评论 mention、投影及头像。
4. [集成边界](./integration.md)：原模块接入、删除项、合同回流和历史错误媒体。
5. [模块关系](./module-layout.md)：目录与组件职责。
6. [原生诊断与验收](./verification.md)：完整 Journey、观察点、预算及证据边界。

## 环境事实

env 仓库已按授权产生三个本地提交：`8f1b08e feat(corpdebug): add isolated stable-bug profile`、
`dbed153 chore(corpdebug): add encrypted runtime definitions` 和
`73a186f docs(corpdebug): describe encrypted runtime templates`。
profile、deploy、topology、文档和 Station/Relay runtime template 均已纳入；env 仓库默认使用 git-crypt，
Git 索引中的 runtime template 已验证为 `GITCRYPT` 密文。主机上的实际 `runtime.env` 仍在独立 runtime 目录。
env 仓库当前本地 ahead 7，未推送。

peers-android 已执行：

```text
make profile corpdebug
make env-check
```

结果：`sourceState=tracked-clean`，`resetPolicy=agent-resettable`，Station 为 `10.37.195.98:18380`，
工作区 slot 21。尚未部署 corpdebug Station/Relay，未启动服务，未触碰 corpstable。

## 审阅结论

当前方案可审阅，尚未获用户接受，也未证明缺陷已修复。
所有性能、媒体成功、无闪动和登录首帧声明均须由当前源码的原生 Journey 验证。
本提案不进入 active 架构注册表；确认后将规范性合同合入既有 Owner 文档，
同步真实能力及 Gate 投影，不创建跨三个领域的新模块 Owner。
