# Bot 能力 — 设计决策

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-12（BOT-D10 superseded）
> **Owner**: Architecture Team

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| BOT-D01 | Bot 是新 actor kind `ACTOR_KIND_AGENT`，不建平行身份 | proposed |
| BOT-D02 | 单一 webhook 原语，不引入独立 API token 体系 | proposed |
| BOT-D03 | 事件同时落会话消息与通知，不建 Bot 私有通道 | proposed |
| BOT-D04 | v1 投递范围 owner-only、仅本地，联邦只留缝 | proposed |
| BOT-D05 | 新增 `direct_service_plaintext` 投递类型，Bot 会话非 E2EE | proposed |
| BOT-D06 | Bot 会话经显式系统授予绕过社交好友门 | proposed |
| BOT-D07 | 通信协议不得从 ActorKind 推断 | proposed |
| BOT-D08 | Produce 补实时扇出为通用修补，新增 StreamEvent 通知臂 | proposed |
| BOT-D09 | Desktop 使用 Tauri 2 内置 tray + 官方 notification 插件 | proposed |
| BOT-D10 | ~~`peersbot` 为零依赖二进制，fire-and-forget~~ v1 不维护 sender CLI，对外只交付 HTTP API + curl/hook 接法 | superseded |
| BOT-D11 | 端点可达性是部署者责任，不建模公网边缘状态 | proposed |
| BOT-D12 | 摄入单事务跨 bot/会话/通知，通知增加幂等键 | proposed |
| BOT-D13 | 托盘角标计未读会话数；notification 臂只驱动横幅 | proposed |

---

## BOT-D01: Bot 是新 actor kind `ACTOR_KIND_AGENT`，不建平行身份

**Status**: proposed
**Date**: 2026-10-11

### Context

能力需要稳定发送方身份（PTID、资料、密钥槽位、未来联邦寻址）。actor 体系已端到端
打通：proto enum、PTID account letter（p/g/o/s/a）、DB shorthand、signup profile
（已核实）。候选：复用 APPLICATION、独立 bot 表、新增 kind。

### Decision

新增 `ACTOR_KIND_AGENT = 7`，PTID account letter `b`，语义为传统 IM bot：可对话的
非人类 actor。Bot 是普通 actor 行；bot registry 只存能力状态。

### Rationale

身份分类与通信协议是正交两轴：A2A 只是 agent 之间可选的通信协议，对端并不需要
知道对方是不是"agent"。本 IM Bot 不挂 Agent Card，决策与 A2A 工作无依赖。产品语义
上它与人和无交互能力的 application/service 都需要明确区分（UI、护栏、未来联邦策略）。

### Alternatives Considered

- 复用 `ACTOR_KIND_APPLICATION`：语义是惰性外部应用；未来需要回溯重分类，护栏无显式目标。
- 独立 bot 身份表：重复身份机制，产生第二发送方真源。
- SERVICE：表示基础设施服务，不是用户安装的会话机器人。

### Consequences

新增 PTID 字母与枚举值，必须执行 data-model §1 列出的传播集，并对所有 ActorKind
分支点做显式审计（无编译器穷尽性保证）。若 Bot 最终不获得会话语义，在联邦暴露前折叠回 APPLICATION。

---

## BOT-D02: 单一 webhook 原语，不引入独立 API token 体系

**Status**: proposed
**Date**: 2026-10-11

### Context

入站事件必须归因到非自身发送方（`Produce` 在 recipient==actor 时自丢弃，已核实），
且不能占用人类 JWT 设备会话（`CreateWithKick` 会踢掉同设备类型旧会话）。

### Decision

每个 Bot 一个摄入原语：webhook id + secret，端点 `POST /bot/webhook/:webhook_id`。
本机调用方（curl / agent hook）与外部 SaaS 共用同一端点、同一摄入管道。secret 仅存 SHA-256，可独立轮换而 URL 不变。v1 不提供官方 sender CLI（见 BOT-D10 superseded）。

### Rationale

URL 同时表达路由与 Bot 归因；scoped PAT 还要回答"token 代表哪个 bot"，平增一套凭证
生命周期。Slack/飞书 incoming-webhook 是被验证的心智模型。

### Alternatives Considered

- scoped PAT：对单写能力没有额外收益，多一个概念。
- hook 用账号密码登录换 JWT：会踢掉 Desktop 会话。
- 仅签名鉴权（GitHub 式 HMAC）：本机 agent 无共享密钥 UX；字段预留，后续做来源验真。

### Consequences

URL 泄露即暴露写权限：以独立轮换、吊销、限流、日志脱敏缓解。未来 token 可作为同管道的另一边缘适配器加入。

---

## BOT-D03: 事件同时落会话消息与通知，不建 Bot 私有通道

**Status**: proposed
**Date**: 2026-10-11

### Context

Bot 触达同时需要可回看的对话历史与即时提醒。现有会话图提供历史/未读/回执，
notification 子域提供提醒与偏好，但两者是独立存储，且通知在偏好关闭时不落行。

### Decision

每个准入事件经会话应用层端口产生一条 Bot↔owner 直聊消息（持久、可回看），并经
notification 事务内端口产生一条通知。会话消息是 durable 真源，始终创建；通知是
提醒层，遵循现有 TASK category 偏好（关闭则无通知行）。

### Rationale

Bot 从第一天就是"有进有出"的 actor；进入既有会话图即继承历史、回执、未读、多端与
未来联邦。Bot 私有 feed 表会分叉存储与 UI。

### Alternatives Considered

Bot 私有通知表（无会话语义）；直接发 SSE 临时事件（无历史）；仅社交 DM 无通知记录（离线丢失）；
即使偏好关闭也强制落通知行（绕过用户既有静音语义，被否）。

### Consequences

需要会话聚合根支持服务明文投递（BOT-D05）与系统发送方端口（BOT-D06），由
G-BOT-03 在执行早期验证；禁止绕过会话应用端口直写其存储。静音时会话未读仍在、
通知中心不计数，两层语义在 data-model §4.4 固定。

---

## BOT-D04: v1 投递范围 owner-only、仅本地，联邦只留缝

**Status**: proposed
**Date**: 2026-10-11

### Context

webhook 请求在身份边界之外，body 一旦能指定收件人即构成 confused deputy；
团队共享 Bot 还需要授予 UX 与滥用控制，超出首个闭环。

### Decision

Bot 只能给安装者本人、在其 home Station 投递。registry scope 枚举固定
`OWNER_ONLY`；非 owner 目标在准入前失败 `BOT_SCOPE_NOT_ENABLED(403)`。Bot actor 以
`ACTOR_VISIBILITY_HIDDEN` 创建，v1 不发布 DHT。

### Rationale

最小真实产品闭环；群/他人投递需要授予 UX 与滥用面控制。

### Alternatives Considered

一次做到联邦投递；允许请求体指定收件人（confused deputy）。

### Consequences

schema 预留 `LOCAL_ACTORS`/`FEDERATED` 枚举位与本地/联邦路由缝，但不写半成品实现；
团队共享 Bot 是明确产品需求时再连同授予 UX 一起激活。

---

## BOT-D05: 新增 `direct_service_plaintext` 投递类型，Bot 会话非 E2EE

**Status**: proposed
**Date**: 2026-10-11

### Context

直聊聚合根强制非自身消息必须为 `direct_ciphertext`，否则 `DeliverySetMismatch`
（已核实：aggregate conversation.go:1219-1241；投递类型共 7 种，无服务明文位）。
密文由客户端生产，Station Go 侧没有 X3DH/双棘轮发送方实现，`messaging-core` 加密栈是
Rust 且仅客户端链接（已核实）。即 Station 持有的 Bot 密钥无法用现有机制产出合法密文。

业界事实：Telegram bot 明确不能进入 Secret Chat，bot 会话是服务器可读 cloud chat；
Slack/Discord/飞书 webhook bot 均平台明文；Signal 不开放 bot；Matrix 生态中
homeserver 不做加密，需要加密的 bot 由独立持密代理 Pantalaimon 以常驻客户端身份
代为加解密。

### Decision

在会话域新增投递类型 `direct_service_plaintext`（工作名，执行时由会话域 owner 定名）：
仅允许 Station 内部系统发送方（首租户为 Bot）在直聊中投递明文服务消息；消息携带
结构化 `peers-touch.bot-event.v1` 负载。线协议同步扩展：PreparedEndpointPayloadKind=8、
`ConversationMember.actor_kind` 投影、落库消息投递安全标记；`packages/messaging-core`
新增明文 processor，旧客户端对该类型 skip+ack。客户端依据消息安全标记与成员
ActorKind=AGENT 不渲染 E2EE 锁。v1 在系统发送方端口拒绝任何联邦/非 owner 目标。

### Rationale

与 Telegram bot cloud chat 同构，诚实反映 Station 信任边界；单节点自托管场景
Station 运营者即用户本人，信任成本最低。服务端棘轮加密不增加对 Station 运营者的
保密性（bot 密钥本就 Station 持有），只增加巨额复杂度，业界无此做法。

### Alternatives Considered

- Station Go 内实现/FFI X3DH+双棘轮发送方：不防 Station 运营者，只防网络观察者（已有 TLS），并引入 bot×设备棘轮状态与入站更新处理，性价比极低，被否。
- Matrix Pantalaimon 式常驻持密客户端（Desktop 持 Bot 身份加密）：真 E2EE，但消息可达性依赖 Desktop 在线，作为未来需要加密 Bot 时的升级路径记录，不进 v1。
- 通知-only 不进会话图：违背 actor 定位，未来双向/联邦需重做。

### Consequences

线协议、Station kind 分支（聚合根、CommitmentCode、sealer/mapper、回执
deliveryKindFromProto）与共享 Rust crate 都要识别新类型；Desktop 完整渲染，
Mobile v1 对该类型 skip+ack 且不毒化 inbox。未来升级路径明确：常驻客户端持密后
可在同一会话中并行投递密文类型，无需迁移 registry。

---

## BOT-D06: Bot 会话经显式系统授予绕过社交好友门

**Status**: proposed
**Date**: 2026-10-11

### Context

直聊创建受 `create_direct` 关系门约束（好友接受后开放），而 Bot 是非人类 actor，
社交护栏对非 PERSON 拒绝好友动作；需要一个不污染人类社交图的直聊建立依据。

### Decision

社交 `create_direct` 好友门不适用。安装 Bot 时写入显式系统能力绑定
`{bot, owner, bot-direct-conversation}`，由会话端口适配器校验；该绑定不派生任何
其他社交能力。

### Rationale

好友是人类图关系；伪造好友行或自关注会污染图不变量。已存在进程内先例
`EnsureAcceptedRelationshipDirectConversation`（其 Creator 硬编码 PERSON，执行时
适配 AGENT），证明授予位置真实存在。

### Alternatives Considered

让 Bot 走好友请求流程（非人类 actor 被社交护栏拒绝）；在 webhook 层伪造关系。

### Consequences

会话应用层新增一个系统发送方/授予分支；CreateDirect 还要求 FederationID、
AuthorityEpoch 与已验证端点路由（即使在 home station），执行时必须明确 Station
内部调用方如何取得这些值（G-BOT-03 内容之一）。

---

## BOT-D07: 通信协议不得从 ActorKind 推断

**Status**: proposed
**Date**: 2026-10-11

### Context

身份分类（"是什么主体"）与交互能力（"能怎么通信"）是两个正交轴；A2A 只是 agent
之间可选的协议，对端并不需要知道对方是不是 agent。从 kind 推断协议会制造隐式耦合。

### Decision

不变量：任何模块不得仅凭 `ActorKind` 选择线协议、能力或信任级别；能力由会话/密钥
交换机制与显式授予建立。`ACTOR_KIND_AGENT` 不隐含 A2A、MLS 成员资格或联邦参与。

### Rationale

保持身份分类与交互能力正交，防止未来 `if kind==AGENT` 式耦合。

### Alternatives Considered

把"AGENT 即走 A2A/即加密"写进身份枚举：与 A2A 实际的 Agent Card 能力发现模型冲突，
且强迫所有 bot 具备加密实现；按授予/端点能力路由（采纳）。

### Consequences

G-BOT-02 的审计把"默认分支隐式当 PERSON"作为缺陷类处理；已知 PERSON 默认点恰有
两处：`db/actor_kind.go` 的 KindFromProto 默认与 `signup_kind.go` 默认 profile。

---

## BOT-D08: Produce 补实时扇出为通用修补，新增 StreamEvent 通知臂

**Status**: proposed
**Date**: 2026-10-11

### Context

`notification.Service.Produce` 目前只落库；bridge 已存在但全仓库零生产调用方，且其
全局单例、自持事务、未注册静默 nil 的形态无法加入跨域事务。`StreamEvent`
（realtime/event.proto）当前没有通知 oneof 臂；bus 也没有"订阅者"扩展点，生产方
直接 `GetBus().Publish`。

### Decision

notification 应用层新增可绑定外部事务的生产端口（幂等键）；Bot 在准入共享事务内
调用该端口，事务提交后 post-commit Publish 一个 notification 事件（新增 StreamEvent
oneof 通知臂），复用 events 子服务器现有 SSE 扇出；端口错误/未注册对准入显式失败并
补偿，不允许静默成功。全局 bridge 保留给社交等 fire-and-forget 生产方。Desktop
改为 SSE 优先、15 秒轮询仅作断线补偿。

### Rationale

隐藏到托盘时需要秒级触达；缺口影响所有通知生产方，修补保持通用，不做 Bot 专线。

### Alternatives Considered

Bot 私有推送路径（分叉提醒机制）；新建订阅框架（现有直 Publish 模式足够）。

### Consequences

需改 realtime proto 并重新生成三端；扇出失败不回滚已持久化通知，靠 SSE resume/轮询收敛。

---

## BOT-D09: Desktop 使用 Tauri 2 内置 tray + 官方 notification 插件

**Status**: proposed
**Date**: 2026-10-11

### Context

Desktop 当前无托盘、无 OS 通知能力，关窗即退出，无法承担"agent 完成时用户在看
别的应用"的触达；host_events 已预留 tray/notification-tap 事件但无调用方。

### Decision

启用 tauri 的 `tray-icon` feature，用核心 `TrayIconBuilder`（tray 能力在核心库，
非第三方 crate；Cargo.lock 已含 tray-icon）与 `tauri-plugin-notification`；默认
关窗隐藏到菜单栏（可设置为直接退出）；点击经现有 `peers-touch://` deep-link 与
已预留的 `desktop:notification-tap`/`desktop:tray-open` 事件路由。

### Rationale

不自写 objc2/Win32 通知；与既有 deep-link、host event 预留一致。

### Alternatives Considered

自写各平台原生通知（维护成本高）；仅 Web Notification 不做 tray（窗口关闭后
不可靠）；强制常驻 Dock（不符合菜单栏驻留产品形态）。

### Consequences

新增一个官方插件依赖与一个 Cargo feature；Linux 无 tray 环境需优雅降级为窗口模式。

---

## BOT-D10: ~~`peersbot` 为零依赖二进制，fire-and-forget~~

**Status**: superseded（2026-10-12，v1 不实现该二进制）
**Date**: 2026-10-11（原 proposed）

### 原决策（保留备查）

coding agent 的 hook 在用户关键路径上同步执行；任何慢、挂起或非零退出都会直接伤害
agent 使用体验。原方案是提供仅用 Go 标准库的独立小模块
`tooling/cli/peersbot`（自有 go.mod）：stdin 读取 hook 原生 JSON，映射为 canonical
event，本地截断/脱敏，固定 5 秒预算 POST，失败写入有界 spool（1 MiB / 24 h），始终 exit 0。

### 取代决策

v1 **不新增、不发布** sender CLI，也不在 `tooling/` 下建该 module。对外只交付一个稳定的
HTTP webhook 端点与一份调用方合同：[webhook-api.md](./webhook-api.md)。调用方用任意 HTTP
工具（`curl`、CI、SaaS、agent hook 脚本）直接接入；“不阻塞 agent”由调用方按文档用短超时 +
失败不致命（`curl --max-time 5 … || true`）保证，断网补偿由调用方按需处理，因为
`request_id` 已在服务端提供 24h 幂等。

### 取代理由

- 关键价值（不阻塞、幂等重试）已由 `--max-time` + `|| true` + 服务端 `request_id` 幂等覆盖，
  零依赖二进制的增量价值只是 hook JSON 映射与本地 spool，属未经验证的痛点。
- 维护一个独立二进制要额外承担发版、与 webhook schema 同步、分发安装成本；`tooling/` 是开发
  工具层，不是面向用户的产品面。
- 若未来确需官方受维护的发送端（如 Desktop 内置投递助手或独立 agent 集成程序），它应作为
  `apps/` 下的一等公民、有独立生命周期与发布，而不是埋在 `tooling/` 里的构建附属品。

### Consequences

- 取消原执行计划 S4（标记 deferred / not-for-v1）；其 hook 映射与失败语义作为**调用方约定**
  写进 webhook-api.md 第 8、9 节，不再有对应代码与 BOT-A40…A44 验收门。
- 不改变 BOT-D02：webhook 仍是唯一摄入原语，本机调用方与外部 SaaS 共用同一端点。
- 将来在 `apps/` 启动受维护客户端时，重开一条决策并恢复相应验收矩阵。

---

## BOT-D11: 端点可达性是部署者责任，不建模公网边缘状态

**Status**: proposed
**Date**: 2026-10-11

### Context

libp2p/节点连接性正在演进，纯 libp2p Station 对 GitHub 这类外部 SaaS 不可寻址；
但可达性本质是部署问题，不应在 bot 域发明边缘状态机。

### Decision

端点是 Station 上无状态 HTTP 路由。可达 URL（本机或公网域名）是唯一网络前提；
不可达时由**调用方**做有限重试/本地缓冲（v1 无官方 CLI，见 BOT-D10）。不新增"公网边缘"
状态，不建 relay 网关组件。

### Rationale

与节点连接性演进解耦；公网暴露是部署决策。

### Alternatives Considered

建模 delivered/no_public_edge 状态（把部署问题写进领域模型）；在 relay 建专用
webhook 网关（v1 无需求，推迟）。

### Consequences

纯 libp2p 站点无法接收外部 SaaS 回调，由部署者自行暴露 HTTP；文档明示而非代码拦截。
事件总线为进程内设施，跨进程扇出在集群场景由轮询补偿，v1 部署基线为单节点。

---

## BOT-D12: 摄入单事务跨 bot/会话/通知，通知增加幂等键

**Status**: proposed
**Date**: 2026-10-11

### Context

评审证实会话与通知是两个独立存储：会话 UoW 可绑定外部 `*gorm.DB`（有
`BindUnitOfWork` 先例），但通知 repo 自持事务、bridge 静默且无法入事务，通知 ID
为时间戳、无幂等键。不补齐则部分失败产生半截状态，重试必然重复通知。

### Decision

准入是事务边界：`bot_inbound_event` 落库、会话命令提交（绑定同一 `*gorm.DB`）、
通知经新增的 `ProduceInTx` 事务端口创建（幂等键由 request_id 派生，recipient 维度
唯一），三者同一 RDS 事务；实时 Publish 仅在提交后执行。任一失败整体回滚并把
inbound 补偿为 `quarantined`，客户端以同一 request_id 重试。

### Rationale

评审证实当前两子服务器没有跨域事务端口，且通知 ID 为时间戳、无幂等键；不补齐则
重试必然产生重复通知，违背 exactly-one 承诺。

### Alternatives Considered

先做消息、尽力发通知（出现部分成功稳态）；引入 outbox 模式（v1 过重，保留为未来高吞吐演进）。

### Consequences

notification repo 需要幂等键列与唯一索引、service 需要事务内端口；bot 应用层持有
跨子服务器的事务编排职责，会话/通知子服务器只暴露应用端口，不暴露 repository。

**不变量补充（bot 设备托管）。** bot 的 actor device 由 Station 托管：创建时登记
一台服务端设备并进入 endpoint manifest；该设备不出现在人类"我的设备"管理 UI，
不可被常规吊销流程吊销；轮换走 Station 内部流程（保证 genesis 所需的 active
endpoint 不中断）。prekey/X3DH 设施不被服务明文路径消费，无需为 bot 发布。

---

## BOT-D13: 托盘角标计未读会话数；notification 臂只驱动横幅

**Status**: proposed
**Date**: 2026-10-11

### Context

Bot 事件同时产生会话消息（MessageEnvelope arm）与通知行（新增 notification arm）。
托盘角标若计未读通知数，会与 Dock/应用内会话角标产生两个真源，且纯系统通知（无
对应会话）也会推高角标造成"有未读对话"的错觉。

### Decision

菜单栏/Dock 角标统一显示**未读会话总数**（消息通道真源，与应用内一致）；v1 的
notification 臂只负责 OS 横幅与通知中心，不贡献托盘计数。message 与 notification
两类总线事件的横幅发起共用同一套 Desktop 本地策略（焦点/可见性/静音），tray 运行
时对消息源类型无感知，Bot 与人类私聊、群@、系统通知走同一判定。

### Rationale

单一计数真源；tray 是来源无关的 Desktop 通用驻留能力，Bot 只是消息源之一。

### Alternatives Considered

角标计未读通知数（两套计数语义，被否）；两类事件各写一套横幅策略（分叉判定，被否）。

### Consequences

纯通知类事件（未来无会话的系统提醒）弹横幅但不增加角标；通知中心未读与会话未读
保持两个独立但各自唯一的计数。
