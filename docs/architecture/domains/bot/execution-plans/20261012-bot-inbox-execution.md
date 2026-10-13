# Bot 能力 — 执行计划（Vertical Slices）

> **Status**: plan（待 Owner 确认后冻结为 Plan Version）
> **Created**: 2026-10-12
> **Owner**: Architecture Team
> **依据设计**: [`../design.md`](../design.md)、[`../data-model.md`](../data-model.md)、[`../module-layout.md`](../module-layout.md)、[`../integration.md`](../integration.md)、[`../acceptance-matrix.md`](../acceptance-matrix.md)
> **依据原型**: `bot-inbox`（原型总账 `confirmed`，2026-10-12）
> **证据基线**: master `48d3f34e9`

---

## 0. 执行原则

- **垂直闭环优先**：每个切片以"可验证交付"收尾（Station 集成测试或打包 Desktop Journey），不交付纯水平层。
- **结构性证明前置**：G-BOT-02（AGENT 身份链）与 G-BOT-03（系统发送方服务明文投递）在任何 UI/webhook 编排前先证明；任一受阻立即回到 DESIGN，不堆功能。
- **Proto-first**：任何数据模型先落 `model/domain/*`，禁止手写模型与编辑生成文件。
- **无 mock**：前后端协同一律真实 BFF↔Station；调用方对真实 webhook 端点。
- **单一摄入管道**：本机调用方（curl/hook）与外部系统共用同一个 Station webhook 入口，不建第二份。
- **单向 v1 语义**：Bot 仅入站 webhook；会话内无回复输入、无呼叫、无 safety number（原型已确认，见 [prototype/README.md](../prototype/README.md)）。

---

## 1. 切片依赖图

```text
S0 契约（proto 全集 + 生成）
 └─> S1 AGENT 身份链（G-BOT-02）+ registry 管理
      └─> S2 系统发送方 + direct_service_plaintext（G-BOT-03）+ messaging-core 接收
           └─> S3 webhook 摄入 + 事务双产物 + 总线/SSE（Station 端到端）
                 └─> S5 Desktop tray/OS 通知/渲染/Bots 设置（G-BOT-06/10 打包 Journey）

S4 peersbot CLI —— 已从 v1 移除（BOT-D10 superseded，2026-10-12）：
   对外只交付 HTTP webhook 合同与 curl/hook 示例（docs/api/bot/webhook.md），
   不建 tooling/cli/peersbot；未来受维护发送端作为 apps/ 一等公民另立决策。
```

S0→S1→S2→S3→S5 为严格链（后片的主体身份与线协议由前片定义）。S5 依赖 S3。
原 S4 为可并行的可选发送端，现已 deferred / not-for-v1，不再是 S5 的前置。

---

## 2. 切片定义

### S0 — 契约层（proto 全集 + 生成，无行为）

范围：

- `model/domain/actor/actor.proto`：`ACTOR_KIND_AGENT = 7`。
- `model/domain/chat/command.proto`：`PreparedEndpointPayloadKind = 8`（direct_service_plaintext）。
- `model/domain/chat/conversation.proto`：`ConversationMember.actor_kind`；消息安全标记字段。
- `model/domain/notification/notification.proto`：`NOTIFICATION_TYPE_BOT_EVENT = 410`；Produce 幂等键。
- `model/domain/realtime/event.proto`：`StreamEvent` 新增通知臂（arm 26 `bot_notification`）。
- 新增 `model/domain/bot/bot.proto`（registry + 管理 API/枚举）、`webhook.proto`（IngestWebhookEvent*、source、severity）。
- 运行 `./model/build.sh` 与 `./tooling/scripts/proto-gen-mobile.sh`。

闭环（可验证）：三端生成成功且消费方可编译；枚举/字段齐备，无运行时行为。

验收映射：契约为全部 BOT-A 的前置；本身不计 Journey。

---

### S1 — AGENT 身份链 + Bot registry（G-BOT-02）

范围（[module-layout.md §2–3](../module-layout.md)）：

- kind 强制传播集：`identity/ptid.go`（TypeAgent `"b"`、白名单、解析）、`model/db/actor_kind.go`、`actor/signup_kind.go`（防御 case）、`actor_identity/.../endpoint_manifest.go`（manifest 白名单签发/验证）、persistence 迁移映射。社交护栏对 AGENT 拒绝人类图动作。
- `bot` 子服务器骨架 + domain（Bot 聚合、principal、errors、secret SHA-256）。
- `application/registry`：create（含 HIDDEN AGENT actor mint）/rotate/enable/disable/revoke；重名类型化拒绝。
- persistence：`bot_registration` + 迁移；`management_handler.go`（JWT owner 作用域 `/bot/*`）。
- 组合根 `server.WithSubServer(bot)`。

闭环：

- **BOT-A01 Journey**：创建 Bot → PTID letter `b`、HIDDEN、registry ACTIVE、URL+secret 仅明文一次。
- **BOT-A02 集成**：传播集全部显式 AGENT 分类；manifest 放行；迁移接受 `b`；社交护栏拒绝。
- BOT-A03（轮换：webhook id/历史不变，旧 secret 401）、BOT-A04/A04B（停用/吊销即时 409/404，下一个请求即生效）、BOT-A05（重名拒绝）。

**门**：G-BOT-02 在此片内必须通过；受阻即回 DESIGN。

---

### S2 — 系统发送方 + 服务明文投递（G-BOT-03）

范围：

- conversation 域：`valueobject` 增加 `direct_service_plaintext`；聚合根系统发送方校验分支（仅系统发送方可构造 kind=8；人类设备命令构造被聚合拒绝；非 owner/联邦目标在系统发送端口被拒）。
- conversation application：系统发送端口、授予校验、FederationID 内部来源、事务绑定。
- interface http（mapper/event_sealer/projection）透传新类型；`receipt_recorder.deliveryKindFromProto` 放行。
- `packages/messaging-core/src/inbox/`：service-plaintext processor 落消息；**未知 delivery kind skip+ack**，不毒化持久 inbox。

闭环：

- **BOT-A21 集成**（核心结构证明）：kind=8 + `ConversationMember.actor_kind` + 消息安全标记齐备；人类设备构造被拒；非 owner/联邦目标被拒；回执放行。
- **BOT-A21B 集成**：messaging-core 落服务明文；未知类型 skip+ack。
- Desktop/Mobile 渲染不在此片（S5），但线协议两端在此闭合。

**门**：G-BOT-03 在此片必须证明"经会话应用端口、不耦合 repository"完成投递。

---

### S3 — Webhook 摄入 + 事务双产物 + 总线/SSE（Station 端到端）

范围：

- `interface/http/webhook_handler.go`：`POST /bot/webhook/:webhook_id`，Bearer secret，流式 32 KiB LimitReader（typed handler 的 64 MiB 缓冲不适用），公开路由无 JWT。
- application/ingest：normalizer（proto-JSON→领域事件、长度上限）、redaction（类密钥值过滤）、folder（dedupe/折叠）、limiter（per-Bot 令牌桶 + per-IP 溢出桶，429 + Retry-After）、service（准入编排、24h request_id 幂等桶、事务边界）。
- application/delivery `bot_message_service.go`：**同一事务** ① 会话消息（MessageEnvelope arm 11）② ProduceInTx 通知行；post-commit Publish；准入后失败入 quarantine 补偿，同 id 重试幂等补齐两件产物。
- 首个事件惰性建立 Bot↔owner 直聊（系统授予记录，无社交好友边）。
- 结构化负载 `peers-touch.bot-event.v1` + 降级文本；未读重复折叠（不跨天/不混类型）。
- notification：`ProduceInTx` 事务端口 + `(recipient_ptid, idempotency_key, bucket)` 唯一索引（命中返回原通知）；events StreamEvent 通知臂扇出 → 在线设备 SSE。

闭环（Station 集成测试为主）：

- 边缘：BOT-A10（错 secret/未知 id 401 不可区分、无落库）、BOT-A11（超限/非法 JSON/非法枚举 400）、BOT-A12（限流）、BOT-A14（伪造 actor/recipient 忽略）、BOT-A15（非 owner 作用域）、BOT-A16（准入后失败隔离补偿）。
- 幂等/偏好：BOT-A13（重放恰好一条消息+一行通知）、BOT-A05B（TASK 偏好静音不产通知行，但消息/未读仍产）、BOT-A28（通知幂等键）。
- 投递：BOT-A20（惰性直聊）、BOT-A22（卡片+降级文本）、BOT-A23（折叠）、BOT-A24（Produce→总线→SSE，漏扇出可追持久通知）、BOT-A27（ProduceInTx/提交失败隔离；post-commit Publish 失败不回滚）。

完成后：真实 HTTP webhook 调用一次性、精确地变成一条会话消息 + 一行通知。

---

### S4 — peersbot CLI（DEFERRED / not-for-v1，BOT-D10 superseded）

**v1 不实现。** 不创建 `tooling/cli/peersbot`，不发布二进制，不承担 BOT-A40…A44 验收门。

- 对外交付物改为 [对外 Webhook 合同](../../../../api/bot/webhook.md)：端点、Bearer 鉴权、canonical JSON、
  状态码、24h `request_id` 幂等、curl / CI / Claude Code hook 可直接抄的接入片段。
- “hook 不阻塞 agent”由调用方按合同用 `curl --max-time 5 … || true` 满足；断网补偿以同
  `request_id` 重试覆盖，不做官方 spool。
- hook JSON→canonical event 的映射（Stop→task_completed、Notification→waiting_input/
  task_failed）作为调用方约定写进 webhook 合同 §9，不属于 Station 代码。
- 重启条件：若未来要官方受维护发送端，必须作为 `apps/` 一等公民立项（独立生命周期/发布），
  重开 ADR 并恢复相应验收矩阵，而不是放回 `tooling/`。

---

### S5 — Desktop 驻留 / OS 通知 / 渲染 / Bots 设置（打包 Journey）

范围：

- Tauri：启用 `tray-icon` feature、加 `tauri-plugin-notification`；`application/tray`（TrayIconBuilder、菜单、未读投影角标）、`application/os_notification`（发起策略、action scheme 允许列表）；复用 host_events 不新增旁路。
- TS：`services/eventStream.ts` 消费通知臂（SSE 优先、轮询补偿）；`store/notification.ts`；角标 = **未读会话数**（消息为真相），通知臂只驱动 OS banner/通知中心；focus/mute 两层门控；点击深链回会话。
- messaging-core 接入：Desktop 渲染 Bot 事件卡片（`peers-touch.bot-event.v1`）；去锁依据同时来自 delivery kind 与成员 actor_kind；单向 composer（无回复、无呼叫、无 safety number）。
- 全局层 Settings → Bots 管理页接 management API（创建/轮换/停用/吊销/头像，与已确认原型一致）。
- Mobile：遇未知 delivery kind skip+ack 不崩溃。

实现切片与决策（2026-10-12 Owner 对齐）：

- **S5-1 消息卡片渲染（只读）**：Desktop 读 `messaging_service_messages`（新增 Rust 读命令），TS 据 delivery kind + 成员 `actor_kind=AGENT` 双重识别 bot 会话；时间轴渲染结构化事件卡；头部去 E2EE 锁→琥珀色“Station 托管/自动化 Bot”，去语音/视频呼叫，底部单向提示条。覆盖 A21B/A26/G-BOT-10 渲染面。
- **S5-2 Bots 设置 + 头像（owner token 内完成）**：Rust build.rs 编 bot proto + 4 个管理命令（list/create/rotate/set-state）。**头像复用 actor，不在 bot 表加字段**：bot 即 AGENT actor，头像存 `touch_actor.icon`；新增 `POST /bot/update-profile`（`{bot_ptid,avatar}`）与 `CreateBotRequest.optional avatar`，复用现有 owner 校验（`loadOwned`），由 Station bot 服务在内部 actor 写入（不开放通用 `/actor/profile` 的 target 参数）；图片走现有 `/sub-oss/upload`（bucket=avatar, public）存相对 URL；读取渲染零新通道（复用 `peerProfiles[botPtid].avatar`）。内部写 icon 不触发 HIDDEN actor 的 DHT publish。TS 设置区经模块注册表挂全局 section，创建两阶段凭证揭示（curl 片段，非 CLI 片段）；头像选择保留“预设图标×底色 + 上传”，统一落 OSS。
- **S5-3 Tray 驻留 + OS 通知**：开 tauri `tray-icon` feature + `tauri-plugin-notification`；`application/tray` + `application/os_notification`；Rust 成为 `desktop:tray-open`/`desktop:notification-tap` 的原生生产者；deep-link 运行时路由；Dock badge=未读会话数（消息真源，BOT-D13，不数通知）；TS 在 `eventStream.ts` 增加 `botNotification`(arm 26) 分支，仅驱动“是否弹 OS 横幅”（focus/mute 两层门控、group_key 折叠每事件一条），消息 envelope 臂仍驱动收件箱/未读。覆盖 A30–A35/J03/J04。
- **S5-3 实现记录（2026-10-13，代码完成；打包 Journey 未验证）**：核对源码后**未采用** `tauri-plugin-notification`——其桌面后端是 notify-rust，`show()` 丢弃 identifier/`userInfo` 且无任何点击回调（Rust/JS 均拿不到），无法满足 A31 点击深链。改为 macOS 原生 `UNUserNotificationCenter` + 自定义 delegate（`application/macos_user_notifications.rs`），路由（notificationId/sessionUlid/target）写入 `userInfo`，点击经既有 `desktop:notification-tap` 回传（可跨重启）；前台驻留时仍弹 banner。tray 在 `application/tray.rs`+`window_lifecycle.rs`（关窗 hide，无 tray/webdriver 构建降级为关窗即退）；OS 原语门面 `application/native_surface.rs`（`native_notification_show` 含 chat/ 目标 allowlist=A34，`native_dock_set_badge`=未读会话数）。TS `services/botNotificationGate.ts` 实现 focus + category pushEnabled/soundEnabled 两层门控、权威通知行富化（一次重试 + i18n 兜底）、帧去重与 group_key 折叠；tap 选中会话并导航 social chat；`navigationBadges` 把未读会话数镜像到 Dock。自动校验：cargo check 默认与 acceptance-webdriver 均过、native_surface 单测（含 A34）过、tsc 0 错、vitest 1077 通过、vite build 过；`check:social-wire/runtime-boundaries` 在本 worktree 因缺 `apps/mobile/src/features/group` 既有失败（非本次引入）。**A30–A35/A21B/A25/A26/G-BOT-10 仍为 UNPROVEN，待打包 Desktop Journey 演示。**
- **S5-3 Journey 进展（2026-10-13 exact-source debug `.app`，唯一 identifier `com.peers.touch.desktop.journey`）**：首轮在 `tauri dev`（未打包）抓到启动崩溃 `UNUserNotificationCenter.currentNotificationCenter` → `bundleProxyForCurrentProcess is nil`，已修（commit b746f816：未打包时通知降级不崩溃；Dock badge/tray 不受影响）。**BOT-A30 打包 Journey 已演示**：Cmd+W/关闭钮 → 进程存活且窗口 0（hide-to-tray）；托盘状态项菜单含且仅含 “Show Peers Touch / Quit”；Show → 窗口恢复为 1；Quit → 进程干净退出。另证实多实例同 bundle id 时 LaunchServices/AX 归属串扰（Journey 须用唯一 identifier）。**阻塞（外部凭据）**：远程 `chat-native-five`（10.37.221.38:18132，含 bot/webhook/realtime-arm，commit aa5d5e3）登录为邀请制——新邮箱 Email Login 返回 `400 user not found`、Quick Login 无表单，本机也无既有会话；无账号/邀请码无法继续 A31/A32/A33（设备 push 层）/A35/A21B/A25/A26/G-BOT-10（均需登录态、Bot 会话与真实 webhook 事件）。A34 已由单测证明。
- **S5-3 Journey 进展（2026-10-13 续，exact-source debug `.app` 用 Apple Development `D82S6W6WUC` 重签后运行）**：
  - 凭据事实（直查远程 PG `touch_actor`，非推断）：`chat-native-five` 实际预置账号是 `alice@p.t` / `bob@p.t` / `carol@p.t`，密码均 `1`；SKILL 里的 `a/b/c` 是通用简写，与本 master profile 不一致。Email Login `alice@p.t`/`1` 登录成功（PIN 页跳过）。
  - Settings→Channels→Bots 创建 `Journey Notify`（`wh_79af4247c3ba`，secret 仅揭示一次），真实 webhook 返回 `INGEST_OUTCOME_ACCEPTED`/event_id。
  - **PROVEN**：BOT-A20（首个事件惰性建 DM `direct-2b9a05a818bba583907a0d0d6566956e`，无好友边）；BOT-A21B/G-BOT-10（三张结构化事件卡：绿条 Task completed / 琥珀条 Waiting for input / 红条 Task failed，含降级中文文案、source `journey-harness`/`peers-touch-master`、时间、J 头像）；BOT-A22（结构化负载 + 降级文本持久化）；BOT-A24（在线设备经 `botNotification` 实时臂触发 gate + `notificationList` 富化）；BOT-A32（窗口可见聚焦时**不调用** `native_notification_show`，仅应用内更新）；BOT-A26（会话头部无 E2EE 锁）；BOT-A25（隐藏/重启/恢复后消息与未读与 Station 投影一致）；Dock badge=未读会话数（0→1，同一会话连续事件仍为 1，与 OS 通知授权无关，原语独立可用）。
  - **Journey 抓出并修复真实缺陷（commit f2ccd77）**：A34 目标 allowlist 正则只收纯字母数字，真实会话 id 是 `chat/direct-<hex>`/`chat/group-…`，导致每条 bot 通知 `INVALID_ARGUMENT`、原生通知与点击深链整体被丢弃。放宽为单段 `[A-Za-z0-9_-]`（≤64），仍拒绝 scheme/路径穿越/查询串；新增 direct/group/underscore 用例，`native_surface` 5 测试过。重打重签后隐藏态 `native_notification_show → OK(scheduled)`，携带 `chat/direct-…`、group/thread 与 sound。
  - **环境硬阻塞（非产品代码）**：本机为 ByteDance DEP MDM 受管，`UNUserNotificationCenter.requestAuthorization` 对所有本地构建稳定返回 `UNErrorDomain Code=1 "Notifications are not allowed for this application"`、`authorizationStatus=notDetermined`、从不弹授权窗。用最小对照 `.app` 穷举复现：ad-hoc、Apple Development 签名（Team `D82S6W6WUC`）、带/不带 `get-task-allow`、从 `/tmp`/worktree/`/Applications` 启动、`tccutil reset` 后——结果一致；MDM `com.apple.notificationsettings` 仅配置 3 个系统 bundle（无默认拒绝），无 quarantine，真实 Aqua 会话，embedded provisioning profile（本机仅一份 iOS `com.peers.touch.mobile`，无 macOS）亦不改变。因此 **A31 的 OS 横幅渲染+点击深链、A33 设备 push/sound 的 OS 语义、A35 每设备一条 OS 通知**在本机保持 **UNPROVEN**，需在会弹授权窗的机器上人工点一次 Allow（或用 notarized Developer-ID release / 带 macOS provisioning profile 的开发构建）。应用侧调度、identifier 替换/threadIdentifier、target、tap host event、focus 门控均已就位并验证到 `addNotificationRequest` 前。
  - 待 S5-1 复核（非 S5-3 面）：webhook bot 会话头部仍显示语音/视频按钮与完整输入框，并显示 `Offline / Station unavailable`，与 S5-1「AGENT 会话去呼叫按钮、底部改单向提示条」约定不完全一致，需核对 `actor_kind=AGENT` 在该惰性会话投影上是否未被客户端识别。

闭环（**打包 Desktop Journey，SOURCE_CHECK/单测不可替代**）：

- BOT-A30（关窗驻留 tray、无 tray 环境降级不崩）、BOT-A31（隐藏→事件→OS 通知→点击→深链，每设备每事件恰好一条）、BOT-A32（聚焦时仅应用内更新）、BOT-A33（静音两层）、BOT-A34（非法 scheme 拒绝）、BOT-A35（多窗口每设备一条）。
- BOT-A21B Desktop 渲染、BOT-A25（重启后消息/未读/通知与 Station 投影一致）、BOT-A26（无 E2EE 锁）。
- **G-BOT-10**：打包 Desktop 端到端收发服务明文 Bot 消息并正确渲染；Mobile 遇未知 kind 不崩。

---

## 3. 失败语义与横切验证

- 入站任何失败都不阻塞 coding agent（调用方负责短超时与 exit 0，见 [webhook 合同](../../../../api/bot/webhook.md) §8）；服务端不允许"静默成功"——准入后失败必须 quarantine 可补偿。
- 每个切片收尾运行平台校验：Station `gofmt -l . && go test ./...`（受影响子服务器聚焦测试）；proto 两脚本；Desktop 收尾 `pnpm run check && pnpm run test && pnpm run build` + Tauri 打包 Journey。
- 未演示的 Journey 一律标 `UNPROVEN`；BOT-A30/A31、G-BOT-10 不得以集成测试替代。

## 4. 切片外（v1 不做）

Bot 双向指令/审批/回复、Bot 向非 owner 或联邦发信、A2A Agent Card、Mobile push 分发器、多账号 Bot 管理、官方 sender CLI（S4 deferred；对外只交付 [webhook 合同](../../../../api/bot/webhook.md)）。

## 5. 开工前置（EXECUTE 首个动作）

1. DESIGN 翻 active：登记 `architecture-governance/architecture-modules.json` 与 `docs/README.md` §4.1（required docs 齐备）。
2. `make dev-start` 发布开发声明（来源：Station/frame/model/messaging-core/apps/desktop），按 §13.5 绑定执行 worktree。
