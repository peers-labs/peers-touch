# Federation Architecture - 集成与映射

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-05-31 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 1. Station app/frame

| 层 | 责任 | 不允许 |
|---|---|---|
| Station app | Federation lifecycle、membership、policy、role、ledger、业务权限 | 管理 Relay socket/read loop |
| Station frame federation | typed peer capability、locator、resolver、signing adapter | 读取 app policy 表 |
| Relay subserver | enrollment、route、opaque tunnel、quota、audit | Actor/Chat/Social/Agent 业务 |
| Relay-client subserver | Station mount、credential、inner TLS ingress | Federation governance |

app 可以依赖 frame primitive；frame 不得依赖 app 或复制业务真源。

## 2. Station Access

[Station Access](../../platform/station/access/README.md) 是客户端接入 owner：

- 定义统一 endpoint discovery 和 Station route binding；
- 验证 Relay 返回的 Station route attestation；
- 经 opaque tunnel 到达同一个 Station Access Gate；
- 以 `station_peer_id` 而不是 Relay/Station URL 管理 scope。

`docs/architecture/domains/identity/federation-catalog.md` 解决“如何发现用户”。Federation 文档解决“谁属于哪个 Federation、谁有权治理、治理事实如何持久和验证”。

本模块只提供 Relay transport protocol。它不创建客户端 registry、Session 或第二套
Access API。

## 3. Catalog / Resolver

```text
Federation membership/policy
  -> active member Station set
  -> federation-scoped Catalog
  -> ActorRef profile resolution
```

Relay directory 与 Federation Catalog 不同：

- Relay directory 回答“哪些 opt-in Station route 当前可达”；
- Federation Catalog 回答“在指定 Federation 中哪些 Actor 可发现”；
- Relay mount 不意味着 Federation membership；
- route URL/Host 不得生成 `ActorRef.acct`。

## 4. Typed Federation Transport

Station-to-Station 调用必须从正向 capability manifest 解析：

```text
Federation caller
  -> resolve target station_peer_id
  -> select verified direct/relay route
  -> establish authenticated peer tunnel
  -> invoke typed capability
  -> receiver verifies caller identity + federation_id + policy
```

Relay 不接收任意 method/path/header，不查看目标 Authorization。broadcast topic
保持 allowlist，并由 receiver 执行 origin、membership、replay 和 relevance 校验。

## 5. Runtime Role 与部署

当前 compose 的 Relay 与 Station 使用相同 image，这是保留项；需要把隐式配置改为
显式 role：

```text
PEERS_NODE_ROLE=station
  -> Station subserver allowlist
  -> optional relay-client

PEERS_NODE_ROLE=relay
  -> Relay subserver allowlist
  -> no Station business subservers
```

普通客户端与 operator surface 都消费 Federation projection，但职责不同：

- Desktop/Mobile 只缓存 Federation context、scoped Catalog/Resolver 结果与连接状态。
- 普通客户端不保存 ledger head、membership、policy，也不暴露治理命令。
- Dashboard/CLI 可以消费治理 projection 并提交 operator intent；最终权限裁决始终在 Station。
- Desktop/Mobile 使用同一显式 `federation_id` 语义，不改变 Station 作为共享业务真源的边界。

entrypoint 只生成 role 允许的 overlay。生产 `relay` role 必须注入 TLS certificate、
Relay signing key、operator trust policy 和 quota；缺失即启动失败。

当前安全基线使用以下运行时配置：

- `RELAY_TLS_CERT_FILE` 与 `RELAY_TLS_KEY_FILE`：公网 Relay 必填，监听器最低
  TLS 1.3；
- `RELAY_SIGNING_KEY_FILE`：Relay identity/attestation 专用 key，不能与 TLS 或
  operator key 共用；
- `RELAY_OPERATOR_KEY_FILE`、`RELAY_OPERATOR_ISSUER`、
  `RELAY_OPERATOR_AUDIENCE`、`RELAY_OPERATOR_SCOPE`：独立 operator JWT policy；
- `RELAY_ALLOW_INSECURE_LOOPBACK=true`：唯一明文例外，仅接受显式 loopback
  listener，不能用于正式证据。

Relay readiness 使用 `/healthz`；`/metrics` 与 admin routes 共同要求 operator
credential。Station role 不装配 Relay subserver，Relay role 不装配 Touch、app
business subserver 或其他 native plugins。

## 6. Credential 集成

- Station host key：证明 Station identity，签 route attestation/enrollment proof。
- Relay signing key：证明 Relay endpoint，签 mount/operator credential。
- Station Session：只在 inner TLS 中到达 Station。
- Federation peer authorization：由 caller Station identity 与 Federation policy
  在 target Station 验证。

四类 credential 不共用 issuer、audience 或 secret。普通客户端不接触 mount 或
operator credential。

## 7. 迁移策略

1. 先删除硬编码 debug egress，建立 Relay role、TLS 和 auth 基线。
2. 引入 PoP enrollment、hash-only invite、mount generation 与 revoke/rotate。
3. 发布 endpoint/route Proto 与 signed discovery。
4. 原子落地 bounded opaque tunnel 和 typed Federation transport，并删除
   transparent forward、relay-client-token 和 header passthrough。
5. Desktop/Mobile 迁移到 station-keyed route binding。
6. 完成 exact-source native Acceptance。

不得双写旧/新 mount credential，不得保留旧 forward 作为 fallback。

## 8. ActivityPub

ActivityPub 仍只作为未来互操作层。任何外部 activity 若要影响 Federation
governance，必须转换为合法 proposal 并通过 ledger policy；不能借 Relay route
直接修改 membership 或 policy。

## 9. 观测

Relay metrics 只使用低基数标签：

- role/version/readiness；
- active mounts/tunnels、queue depth、bytes、latency；
- enrollment/rotation/revoke outcome；
- typed failure class。

禁止记录 invite/grant/credential、Authorization、业务 path/body、Actor PII 或
高基数 route/peer 原文。安全审计可以记录不可逆 digest 和明确 operator action。
