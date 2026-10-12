# Bot 能力 — 模块目录结构

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

---

目标模块树（master DDD 布局，参照 `subserver/conversation`、`notification`）。

## 1. model（proto-first）

```text
model/domain/bot/
├── bot.proto          # registry 与管理 API、枚举
└── webhook.proto      # IngestWebhookEvent*、source、severity
```

修改：

```text
model/domain/actor/actor.proto                 # ACTOR_KIND_AGENT = 7
model/domain/notification/notification.proto   # NOTIFICATION_TYPE_BOT_EVENT = 410；Produce 幂等键
model/domain/realtime/event.proto              # StreamEvent oneof 新通知臂
model/domain/chat/command.proto                # PreparedEndpointPayloadKind = 8
model/domain/chat/conversation.proto           # ConversationMember.actor_kind；消息安全标记
```

## 2. Station：新 `bot` 子服务器（DDD）

```text
app/subserver/bot/
├── doc.go
├── subserver.go                    # 组合根；经 server.WithSubServer 注册
├── domain/
│   ├── bot.go                      # Bot 聚合：身份引用、状态、scope、授予
│   ├── inbound_event.go            # 事件实体、准入状态、折叠
│   ├── principal.go                # {bot_ptid, owner_ptid, scope} 内部主体
│   ├── errors.go                   # BOT_* 类型化错误
│   └── secret.go                   # secret 生成与 SHA-256
├── application/
│   ├── registry/
│   │   └── registry_service.go     # create/rotate/enable/disable/revoke（含 actor mint）
│   ├── ingest/
│   │   ├── contracts.go            # 端口接口
│   │   ├── normalizer.go           # proto-JSON → 领域事件、长度上限
│   │   ├── redaction.go            # 类密钥值过滤
│   │   ├── folder.go               # dedupe/group 折叠
│   │   ├── limiter.go              # per-Bot + per-IP 令牌桶
│   │   └── service.go              # 准入编排、幂等、事务边界
│   └── delivery/
│       └── bot_message_service.go  # 会话系统发送端口 + 通知事务编排
├── infrastructure/
│   └── persistence/
│       ├── models.go               # bot_registration、bot_inbound_event
│       ├── migrations/
│       ├── registry_repository.go
│       └── inbound_repository.go
└── interface/http/
    ├── webhook_handler.go          # POST /bot/webhook/:webhook_id（流式 32KiB）
    ├── management_handler.go       # JWT owner 作用域 /bot/*
    └── mapper.go
```

依赖方向：

```text
interface/http → application → domain
application/delivery → conversation 应用端口（接口）、notification 事务内生产端口（ProduceInTx）
infrastructure → domain
```

禁止：bot 子服务器 import conversation/social/events 的 infrastructure 或 repository。

## 3. Station 修改面

```text
frame/touch/activitypub/identity/ptid.go                         # TypeAgent "b"、白名单、解析
frame/touch/model/db/actor_kind.go                               # b 映射（显式分支）
frame/touch/actor/signup_kind.go                                # 防御性 AGENT case
app/subserver/actor_identity/application/endpoint_manifest.go   # manifest kind 白名单
app/subserver/actor_identity/infrastructure/persistence/repository.go  # kind 迁移映射

app/subserver/conversation/domain/valueobject/value_objects.go  # direct_service_plaintext
app/subserver/conversation/domain/aggregate/conversation.go     # 系统发送方校验分支
app/subserver/conversation/application/command|delivery/...     # 系统发送端口、授予校验、
                                                                 #   FederationID 内部来源、事务绑定
app/subserver/conversation/interface/http/mapper.go、event_sealer.go、projection...  # 新类型透传
app/subserver/conversation/infrastructure/delivery/receipt_recorder.go  # deliveryKindFromProto 放行

packages/messaging-core/src/inbox/                              # service-plaintext processor；
                                                                 #   未知类型 skip+ack 语义

app/subserver/notification/application/service.go               # ProduceInTx 事务端口、幂等键
app/subserver/notification/domain|infrastructure/...            # idempotency_key 列与唯一索引
app/subserver/events/...                                        # StreamEvent 通知臂扇出
app/cmd/.../main.go                                            # server.WithSubServer(bot)
```

## 4. 调用方（v1 无仓库内 CLI）

v1 **不创建** `tooling/cli/peersbot`（BOT-D10 superseded、S4 deferred）。外部 agent / CI /
SaaS 直接对 HTTP 端点负责，接入合同与 curl/jq hook 片段见
[对外 Webhook 合同](../../../api/bot/webhook.md)，不占本仓库目录。

未来若提供官方受维护的发送端，它作为 `apps/` 一等公民立项（独立 module、独立生命周期与
发布），不放在 `tooling/` 开发工具层；届时再在本节登记目录树。

## 5. Desktop

```text
apps/desktop/src-tauri/
├── Cargo.toml                                  # tauri 启用 tray-icon feature；+ tauri-plugin-notification
├── tauri.conf.json
└── src/
    ├── application/tray/mod.rs                 # NEW：TrayIconBuilder、菜单、未读投影
    ├── application/os_notification/mod.rs     # NEW：发起策略、scheme 允许列表
    └── interface/tauri_commands/…              # 复用 host_events，不新增旁路

apps/desktop/src/
├── pages/settings/…                            # 全局层 Bots 管理
├── components/chat/…                           # Bot 事件卡片（peers-touch.bot-event.v1）
├── services/eventStream.ts                     # 通知臂消费
└── store/notification.ts                       # SSE 优先、轮询补偿
```

## 6. 迁移与登记

- 一组 Station 迁移建立 `bot_registration`、`bot_inbound_event`、notification
  幂等键列；actor 表不新增列（kind shorthand 已为字符串列）。
- DESIGN 评审通过翻 active 时登记
  `docs/architecture/engineering/architecture-governance/architecture-modules.json`
  （required documents：README/design/decisions/data-model/module-layout/integration）
  与 `docs/README.md` §4.1。

## 7. 测试布局

- domain：状态机、折叠、幂等、secret 哈希。
- ingest：归一化、脱敏、限流、32KiB 流式截断、补偿隔离。
- http：未知 id/错 secret 不可区分、状态码、滥用计数、公开路由无 JWT 依赖。
- 集成：manifest 白名单、系统发送端口、授予校验、服务明文端到端、通知事务一致性。
- 对外合同：以真实 HTTP Journey 验证 curl 接入（鉴权不可区分、状态码、限流、幂等）；v1 无 CLI 单测/spool 测试（S4 deferred）。
- Desktop：运行时投影单测 + 打包 Journey（G-BOT-06/10）。
