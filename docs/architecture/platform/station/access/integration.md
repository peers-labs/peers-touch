# Station 统一接入生命周期 - 集成与映射

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. 当前实现证据

| Concern | Station owner | Desktop consumer | Mobile consumer |
|---|---|---|---|
| Station identity | bootstrap identity | identity kernel | station connection runtime |
| Access attempt | Access Gate | session store + Rust adapter | auth session + Host adapter |
| Session scope | Actor session | runtime coordinator | mobile runtime coordinator |
| Federation context | Federation | context store | social runtime |
| Relay diagnosis | Station operations | read-only status | read-only status |

| 事实 | 当前源码 | 判断 |
|---|---|---|
| Desktop Station registry 以 URL 去重并选择 active URL | `apps/desktop/src-tauri/src/infrastructure/station_registry.rs` | 无法把同一 Station 的 direct/relay route 合并 |
| Desktop probe 使用 `/sub-oss/healthz` 与 `/sub-bootstrap/info` | `apps/desktop/src-tauri/src/infrastructure/station_client.rs` | 可达性/metadata 未形成完整签名接入链 |
| Mobile registry 以 `stationPeerId` 为主键 | `apps/mobile/src/features/station/stationRegistry.ts` | 可扩展为 route candidates |
| Mobile 验证签名 Station identity | `apps/mobile/src/features/station/stationConnection.ts`、`src-tauri/src/commands/station.rs` | 已有可信 identity 基础 |
| Mobile 要求请求 origin 等于 `canonical_origin` | `apps/mobile/src-tauri/src/commands/station.rs` | Relay origin 当前必然失败 |
| 客户端广泛持有 `stationUrl` | Desktop/Mobile service、runtime 与 storage | 需区分 identity scope 与 transport scope |
| 无客户端调用 `/api/v1/relay/client-token` | 全树 consumer inventory | 现有 endpoint 不是可用产品路径 |

## 2. Relay 当前能力

现有实现位于：

- `apps/station/frame/core/plugin/native/subserver/relay/`
- `apps/station/frame/core/plugin/native/subserver/relay-client/`
- `apps/station/frame/core/plugin/native/federation/`

已具备 invite/register、短期 relay token、Station TCP stream、请求/响应 framing、
单 topic broadcast、heartbeat、并发 semaphore 与基础 metrics。聚焦 race suite
在审计基线通过：

```bash
cd apps/station
go test -race -count=1 \
  ./frame/core/plugin/native/subserver/relay/... \
  ./frame/core/plugin/native/subserver/relay-client/...
```

这些能力证明原型可传输 Station-to-Station 流量，但不能证明客户端安全接入。

## 3. 阻断性差距

### 3.1 身份与 credential

- 空定向 invite 可从 `X-Station-Peer-ID` 取得身份，没有 host-key
  proof-of-possession。
- invite token 明文存储并由 list API 返回。
- Relay token 使用全局 Station JWT secret，缺少独立 issuer、audience、jti、
  scope 与 generation。
- admin guard 只排除 Relay subject，其他有效 app JWT 均可能进入 admin API。
- client-token TTL 输入无上界；该 endpoint 没有真实客户端 consumer。

### 3.2 撤销与恢复

- 删除 mount 不撤销已有 token；stream handshake 可重新创建被删除 mount。
- relay-client 只要缓存文件非空即信任，过期后不能自动进入新的 enrollment。
- relay-client 的启动状态可早于实际 mount 成功。
- stale cleanup 使用 stream `mountedAt`，可能在另一个 stale DB mount 出现时清理
  长期健康连接。

### 3.3 数据面

- `/relay/forward/{station}/{path}` 接受 ANY method 和任意 path。
- Relay 复制 header/body；Station dispatcher 把目标授权头恢复为
  `Authorization`，Relay 可见 credential 和业务明文。
- request `LimitReader` 到上限后继续处理，不能检测并拒绝超限 body。
- response 无硬上限；没有全局/per-client 字节与速率配额或 cancel frame。
- invite 的 `MaxClients/BandwidthLimit` 未成为运行时强制条件。

### 3.4 部署面

- Relay compose 使用相同 Station image 和默认配置，没有显式最小 role allowlist。
- stream TLS 配置可为空，Station relay-client 默认 `use-tls: false`。
- `apps/station/frame/core/federation/transport.go` 与
  `apps/station/app/subserver/events/bus.go` 含硬编码
  `http://192.0.2.12:7784/event` debug egress，安全基线前必须删除。

## 4. Target Owner Mapping

| Concern | Owner | Consumer |
|---|---|---|
| Endpoint discovery contract | Station Access | Desktop/Mobile endpoint resolver |
| Station identity / Access Gate | Station Identity / Access Gate | 一个 route-aware Station binding |
| Route attestation | Station host identity | Relay directory、Desktop/Mobile |
| Relay identity / mount credential | Relay transport | Station relay-client |
| Opaque tunnel lifecycle | Relay transport | Desktop/Mobile transport、Station ingress |
| Business authorization | Station domain owners | 现有客户端业务 runtime |
| Federation transport capability manifest | Federation | Station transport adapter |

本模块编排接入，不接管 Relay transport 实现或 Federation governance。

## 5. 集成切换

### 5.1 Contract first

1. 在 `model/domain/peer` 定义 endpoint discovery、route attestation 与 client
   binding wire。
2. 在 Relay/Federation contract root 定义 enrollment credential 与 opaque
   tunnel frame。
3. 在 API registry 登记唯一 route 和 owner，再创建 consumer。

### 5.2 Relay security first

客户端接入前先完成：

- 最小 Relay role 和生产 TLS fail-closed；
- debug egress 清除；
- Station host-key PoP enrollment；
- invite hash、dedicated credentials、generation revoke；
- bounded tunnel 与 typed federation forwarding。

不得在安全基础未通过时让 Desktop/Mobile 使用 Relay route。

### 5.3 Client hard cut

- Desktop registry 从 URL-keyed 单 route 硬切为 station-keyed binding。
- Mobile 保留 station-keyed owner，增加 route list 与 revision。
- 所有请求从 active `TransportScope` 取 endpoint，但缓存/Session/业务持久化继续
  使用 `AccessScope`。
- 不保留 Relay registry、旧 URL alias owner 或透明 forward fallback。

## 6. 验收集成

Acceptance 需要新增一个可复用环境，提供两台隔离 Station、一个 Relay、Desktop、
iOS Simulator、攻击客户端和可审计 Relay observer。环境必须：

- 固定 exact source digest；
- 独立分配端口、数据库、证书和 signing key；
- 支持 invite/enroll/rotate/revoke/restart/overload；
- 捕获日志与网络 metadata，并对 secret 自动脱敏；
- 在每个 Gate 后清理 client、Station、Relay 和 simulator 资源。

现有 `station-access-*` 与 cross-Station Chat/Social Gate 继续作为回归证据，不另建
第二套业务 fixture。

## 7. 删除清单

迁移完成的同一 closure 删除：

- `/api/v1/relay/client-token`；
- `/relay/forward/{station}/{path}` 任意 HTTP 入口；
- Relay 对目标 `Authorization` 的读取/转发；
- plaintext invite list/storage；
- URL-keyed Desktop Station identity owner；
- 仅检查非空缓存 token 的恢复路径；
- 两处硬编码 debug HTTP egress。

同时保留以下当前接口验证：

- Station route、Proto 和 owner 由 `station-api-ownership` 验证。
- 双端 capability consumer 由 Station Access current-interface contract 验证。
- 首次接入、恢复、切换和 Federation context 由原生 Acceptance 验证。
- active 文档与模块声明由 architecture module governance 验证。
