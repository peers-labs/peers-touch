# Station 统一接入生命周期 - 数据模型

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-27 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. Endpoint Discovery

```text
AccessEndpointRequest
  challenge: bytes[32]
  connection_grant: bytes?
  client_protocol_version: uint32

AccessEndpointResponse
  endpoint_role: DIRECT_STATION | RELAY
  endpoint_statement_bytes: bytes
  endpoint_public_key: bytes
  endpoint_signature: bytes
  station_routes: StationRouteAttestation[]
```

`endpoint_statement_bytes` 是 deterministic protobuf。签名 domain 分离为
`peers-touch/access-endpoint/v1\0`，包含 challenge、role、endpoint identity、
protocol versions、issued/expires。redirect 响应不得参与 endpoint role 判定。

## 2. Station Identity

现有 `StationIdentityResponse` 保持 Station 最终身份真源：

```text
StationIdentityStatement
  challenge
  station_peer_id
  canonical_origin
  capabilities[]
  issued_at_unix_ms
  expires_at_unix_ms

StationIdentityResponse
  statement_bytes
  host_public_key
  signature
```

`canonical_origin` 只描述 Station 自己的 direct route。通过 Relay 验证时，不再要求
用户输入的 Relay origin 等于 `canonical_origin`；客户端改为验证 route attestation
和 tunnel 内 Station identity 都绑定同一 `station_peer_id`。

## 3. Relay Identity

```text
RelayIdentityStatement
  challenge
  relay_peer_id
  canonical_origin
  protocol_versions[]
  capabilities[]
  issued_at_unix_ms
  expires_at_unix_ms

RelayIdentityResponse
  statement_bytes
  relay_public_key
  signature
```

Relay identity 用于防止 endpoint role 和 route binding 被替换，不授予任何 Station
或 Federation 业务权限。生产环境同时要求 Web PKI TLS；Relay identity key rotation
必须由已固定旧 key、operator recovery policy 或显式用户确认授权。

## 4. Station Route Attestation

```text
StationRouteAttestation
  station_peer_id
  relay_peer_id
  route_id
  route_generation
  inner_tls_spki_sha256
  capabilities_digest
  visibility: PUBLIC | GRANT_ONLY
  issued_at_unix_ms
  expires_at_unix_ms
  host_public_key
  signature
```

签名 domain 为 `peers-touch/station-route/v1\0`。`route_id` 是不可反推出
Station identity 的随机标识；`route_generation` 必须等于 Relay 当前 active mount
generation。attestation 过期或 generation 不一致时不得建立新 tunnel。

## 5. Client Station Binding

```text
StationBinding
  station_peer_id
  display_name
  pinned_host_public_key
  routes: RouteCandidate[]
  active_route_id
  route_revision
  lifecycle_generation
  created_at
  updated_at

RouteCandidate
  route_id
  route_type: DIRECT | RELAY
  transport: DIRECT_HTTPS | RELAY_WSS_V1
  endpoint_origin
  relay_peer_id?
  attestation_digest?
  attestation_expires_at?
  last_verified_at
  last_success_at?
  health: AVAILABLE | DEGRADED | UNAVAILABLE | REVOKED
```

约束：

- 主键为 `station_peer_id`，不能用 URL 建立第二条 Station 记录。
- `active_route_id` 必须引用一个已验证、未过期且 identity 相同的 route。
- route 切换增加 `route_revision`；Station/Actor/Device scope 切换增加
  `lifecycle_generation`。
- DIRECT/RELAY 跨模式切换默认需要用户确认；自动重试不改变 route type。
- 旧 URL-keyed 持久化只允许单次迁移，不保留双读或 alias owner。

## 6. Access Scope

```text
AccessScope
  station_peer_id
  actor_ptid
  device_id
  lifecycle_generation
```

```text
TransportScope
  station_peer_id
  active_route_id
  route_revision
```

Session、Messaging、Federation context、缓存和 projection 使用 `AccessScope`。
仅网络请求与连接池使用 `TransportScope`。transport failure 不能修改 ActorRef 或
从 request host 重新生成 federated handle。

## 7. Access Attempt

现有 canonical Access Gate request/response 保持不变。`station_url` 字段在客户端
adapter 中投影为当前 verified route endpoint，不参与 Station identity 或 scope
判定：

```text
access_start -> access_submit | access_cancel -> access_decision
```

所有 attempt 继续绑定 `station_peer_id + device_id + lifecycle_generation`。

## 8. Connection Grant

```text
StationConnectionEnvelope
  protocol_version
  relay_origin
  route_attestation
  connection_grant

StationConnectionGrant
  grant_id
  station_peer_id
  relay_peer_id
  route_id
  route_generation
  max_uses
  issued_at_unix_ms
  expires_at_unix_ms
  station_signature

RelayGrantRecord
  grant_id
  grant_digest
  route_id
  route_generation
  remaining_uses
  expires_at
```

客户端获得的是 Station 签名材料，不是 Relay admin credential。Relay 只存 grant
digest 并原子扣减使用次数。私有 route 不出现在无 grant 的 discovery 响应。

`StationConnectionEnvelope` 使用 deterministic protobuf 后进行无 padding
base64url 编码，呈现为 `ptc1:<payload>` 或
`peers-touch://connect#<payload>`。fragment 不发送给 HTTP server；输入、错误、
analytics 和日志必须统一脱敏。Station 通过已认证 mount 在发放连接材料前向 Relay
登记 grant digest，注册失败时不得向用户返回不可用材料。

## 9. Relay Mount Credential

```text
RelayEnrollmentChallenge
  challenge_id
  invite_id
  relay_peer_id
  nonce
  issued_at
  expires_at

StationEnrollmentProof
  challenge_bytes
  station_host_public_key
  station_signature
  requested_route_visibility
  requested_limits

RelayMountCredential
  issuer
  audience
  scopes[]
  jti
  station_peer_id
  mount_id
  generation
  issued_at
  expires_at
  relay_signature
```

invite 表只存 `secret_hash`，不得存或 list 明文。mount 持久化
`generation/revoked_at/credential_jti`。注册事务必须原子完成 invite consume、
Station identity binding 和 generation 创建。

## 10. Opaque Tunnel Frame

Relay 可见 frame 只包含：

```text
TunnelOpen
  route_id
  route_generation
  client_nonce
  grant_proof?

TunnelData
  tunnel_id
  sequence
  ciphertext

TunnelCancel | TunnelClose
  tunnel_id
  typed_reason
```

`RELAY_WSS_V1` 使用
`wss://<relay>/.well-known/peers-touch/tunnel`，只接受 binary frame 且关闭
WebSocket compression。inner TLS record 可跨多个 frame，但必须按 sequence 在有界
buffer 中重组。

HTTP method、path、header、cookie、Station session 和业务 payload 全部位于 inner
TLS。每个 frame 和 tunnel 受版本、大小、速率、时长与累计字节限制。

## 11. Federation Context

```text
FederationContext
  federation_id
  display_name
  state
  station_peer_id
  revision
```

Federation context 与 route 完全正交。依赖 Federation 的操作继续携带明确
`federation_id`，Relay 不提供或推导默认 context。

## 12. Capability References

Station Access 模块使用：

- `access.endpoint.resolve`
- `station.identity.verify`
- `access.gate.start`
- `access.gate.submit`
- `access.gate.decision`
- `access.gate.cancel`
- `relay.tunnel.open`

method、path、Proto 和 owner 由当前 capability registry 声明；本文档不复制第二份
route registry。

## 13. Client-Class Session Slot

```text
ClientClass
  desktop
  mobile
  web

ActorSessionClassSlot
  actor_id          // Station-internal storage identity
  client_class
  active_session_id
  device_id
  lifecycle_generation
  revoked
  revoked_reason
```

`SessionRecord.device_type` 是当前持久化字段名，但其业务含义是
`ClientClass`，只允许 canonical enum。`device_id` 是安装实例身份，不是
Session 并发类别。

不变量：

- `(actor_id, client_class)` 最多存在一个 `revoked=false` 的 Session；
- `actor_sessions` 以 partial unique index
  `(user_id, device_type) WHERE revoked = false` 执行该不变量；
- 新同类 Session 激活与旧同类 Session 的 `kicked` 撤销在一个事务中完成；
- 不同 `client_class` 的 Session 不参与该事务的撤销集合；
- password、OAuth 和 takeover 入口产生相同 class-slot 结果；
- 非 canonical 类别不得写入；历史 alias 只允许在一次性 schema migration
  中归一。

Migration 顺序固定为：归一类别、按 `created_at DESC, id DESC` 选择每个
`(user_id, device_type)` winner、撤销其余 active 行、创建 partial unique
index。任何一步失败都阻止 Station 启动，不以无约束模式继续服务。
