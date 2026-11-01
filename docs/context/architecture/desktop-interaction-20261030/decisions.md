# 决策

## D01：非空输入自动 FIND，但保留 Suggest 的隐私边界

现有 Suggest 合同是 Device-only、无网络；Submit/FIND 才覆盖当前 Station。
用户要求输入即出结果，而 Social 结果位于当前 Station，不能把 Social 硬塞进 Suggest。

决定：

- 空输入保留 Suggest，不发网络。
- 非空输入停顿 200ms 自动 FIND；Search Core 增加 progressive source frame，最终再发布 RRF 融合 frame。
- Progressive frame 只支持首页阅读/打开；最终 frame 才发布排序、分页 cursor 和稳定 selection。
- 私密 Social 逐次做当前读权核验，不上传正文，不把无离线租约内容放入 Suggest。
- 协调刷新受 lease、revision 和事件约束，不固定每 2 秒重放 no-store FIND；无事件公开陈旧窗口为 cursor TTL。
- query 上限统一为 search-core 的 256，并按 Station/共享协议、Desktop/Mobile 的顺序兼容发布。

拒绝方案：把所有来源标成 suggestions，或在 renderer 拆成两条 query 自行融合。前者违反无网络建议语义和私密读权模型；后者绕过 Search Core 的 RRF、签发和分页合同。
代价：需要改造 core/IPC 的发布模型；以排序稳定、selected key 保留和 native request count Gate 约束。

## D02：阅读、复制与导航是同一行内的独立命中区域

结果行不再是一个整行 button。list/listitem 中的 open target 承载阅读与键盘打开，
copy button 是同 row sibling；文本可选择，快捷键复制 active row。帮助和 coverage 收拢到 `?`，信任区标保留。

拒绝方案：在整行 button 上阻止 mouseup 或加 stopPropagation。它无法同时满足拖选复制、键盘可达和 ARIA 关系。
代价：需要重排 Search row DOM/CSS；不得为复制新增全文缓存。

## D03：PUBLIC 明文上传，PRIVATE 端到端加密，renderer 不猜编码

公开 Social 复用已有明文 `oss_upload_attachment_social`；私密 Social 复用 Secure Content。
选图预览授权提取为共享 native helper；多选逐文件授权。
删除错误的公开加密 Social 命令、TS 类型/调用、注册和同文件零调用 dead helper。

拒绝方案：让 ImageThumbnail 检测 ciphertext 后解密。它把领域编码和 key 带到公开 renderer，
制造两套公开媒体语义，也不能让第二读者获得授权。
代价：已存在的错误公开对象需要单独只读审计和授权修复；新代码不背永久兼容包袱。

## D04：Reaction 领域保持多 kind，UI 合并为唯一 action bar

Station 和私密后端都按 `(post, actor, kind)` 复合键增删，允许多个 kind。
决定把零消费者的 ReactionBar 正确多 kind 语义并入 SocialActionBar，删除重复组件。
公开命令不新增服务端 ledger；复合键提供 Add/Delete 幂等，客户端 operation ID 只做本地 fence。
pending 只影响具体 kind。

拒绝方案：新增“替换 reaction”写协议或要求用户先删除。二者都偏离领域模型和用户诉求。
代价：UI 要同时显示多个已选 chip 与 picker，但这是已有 summary 合同。

## D05：评论 mention 是端到端 actor 协议，不是 `@字符串`

复用 Post Mention 类型，只新增 public Comment/Create 字段；复用已存在 `mentions_json` 列，
不做 DDL，不修改无生产者的 UpdateComment，也不新增无消费者的 MomentEvent 字段。
Station 校验 range、actor 和父帖可读性，并向既有 notification Bridge/CategorySocial 生产通知；
私密通知静态数据只含 IDs。Desktop 使用 Social actor candidate controller，不接入 Agent store。

拒绝方案一：直接复用 Agent MentionPopup。它的数据源、候选语义和键盘生命周期都不是人类 Social。
拒绝方案二：只保存显示文本或只发 self-echo MomentEvent。无法让被提及者收到通知、重名消歧或按权限裁决。
范围限定：本次只闭合评论 mention；主帖 composer 的 post-level mention 和已发布评论编辑不扩大。

## D06：稳定性由资源投影归并保证，不用停更、memo 或动画掩盖

Moments runtime 继续拥有事件和低频 reconcile；store 用资源 identity、content revision、
interaction revision、read authority 和 feed window 归并。后台刷新不清空已有数据、不截断 tail、
不 remount 输入。真实删除/撤权仍立即生效。

拒绝方案：停掉 45s reconcile、给整页加 fade、或只依赖 React.memo。它们分别损害 freshness、
掩盖错误绘制或不改变被截断的状态。
代价：需要有界 tail verification 来区分“首批未返回”和“真正移除”。

## D07：头像准备属于 Identity effect，但按 authenticated edge 分型

AvatarAssets 统一管 native resolve 和 decode，session 不导入组件。
生产密码登录必须从 LoginPage/store 重接回 Identity Runtime fresh edge；OAuth 和 completed login
在 pending completion 内等待 canonical profile、local path 和 decode，最多 2s。
Restore/PIN/switch 只等本地 last-good decode；applet 豁免。
native profile 返回 canonical identity/path/state，避免 ephemeral resource token 造成双 key 和重复下载。

拒绝方案：所有 edge 统一阻塞 2s。它会给 restore/PIN/account switch 增加冷启动延迟，
且 applet 合成 actor 没有头像可准备。
拒绝方案：先显示字母再 crossfade。用户报告正是这个中间帧；crossfade 不能消除错误身份首帧。
代价：需要 typed absent/failed/degraded 状态和 epoch fence；网络失败仍允许有效 session 进入。

## D08：历史坏图修复与新产品修复分离

代码切换只保证新 PUBLIC 对象正确。历史对象先按 MIME、descriptor、hash、Post binding 和当前授权分类；
材料完整时由 Social/OSS Owner 在独立授权下重新制备公开对象并更新权威引用。
corpstable 数据修复需要另行授权；corpdebug 只做验证，不把临时修复脚本提交为产品代码。

拒绝方案：删除旧对象或在客户端永久解密。前者破坏审计，后者扩散密钥和错误编码。

## 复审触发条件

- Search native Journey 显示 stable input 的 Station 请求数、partial latency 或取消语义不满足预算。
- corpdebug 证据表明图片失败主因不是编码错配，而是独立的 OSS/授权故障；仍修编码错配，但部署修复归对应 Owner。
- 同 Station actor profile 不提供可区分 avatar revision，却要求 same-URL 换图实时生效；需先扩 profile 合同。
- 评论 mention 的服务端 fanout 无法在当前通知 Owner 内按父帖权限过滤；mention 可先保留持久化/渲染，通知状态明确标记未实施，不显示假通知。
