# Station 统一接入生命周期 - 产品状态模型

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. Endpoint Resolution

```text
unselected
  -> endpoint_resolving
  -> direct_station | relay_directory | private_route
relay_directory
  -> single_candidate | station_selection_required | no_candidate
single_candidate | station_selection_required | private_route
  -> route_attestation_verifying
  -> station_identity_verifying
```

| 状态 | 用户含义 | 允许动作 | 禁止动作 |
|---|---|---|---|
| `endpoint_resolving` | 正在识别接入地址 | 取消、重试 | 提交凭据 |
| `direct_station` | 地址直达 Station | 验证 Station | 仅凭 role 建立信任 |
| `relay_directory` | 地址是 Relay | 读取已签名候选 | 读取私有 mount inventory |
| `station_selection_required` | Relay 有多个候选 | 选择 Station | 按顺序静默选择 |
| `private_route` | 已解析私有连接材料 | 验证 grant/attestation | 回退公共目录 |
| `route_attestation_verifying` | 验证 Station 对 route 的授权 | 取消、重试 | 建立 tunnel |
| `station_identity_verifying` | 验证最终 Station identity | 取消、重试 | 登录 |

## 2. Access 与 Runtime

```text
station_identity_verifying
  -> identity_confirm_required
  -> transport_establishing
  -> access_gating
  -> runtime_bootstrapping
  -> ready
```

- `transport_establishing` 对直连建立普通 TLS，对 Relay 建立 outer TLS 与
  client-to-Station inner TLS。
- `access_gating` 只调用 canonical Access Gate；route 不拥有 gate。
- 签名、PeerID、certificate binding、scope 或 gate 不一致进入
  `blocked_typed`。

## 3. Station Binding 与 Route

```text
StationBinding(station_peer_id)
  routes:
    direct: verified | stale | unavailable
    relay: verified | stale | revoked | unavailable
  active_route: route_id
  route_revision: monotonically increasing
```

同一 `station_peer_id`：

```text
ready(route A)
  -> transport_quiescing
  -> route_switching
  -> transport_verifying(route B)
  -> ready(route B)
```

只增加 `route_revision`，不改变 Actor/Device scope。异步 transport 结果必须同时
匹配 `station_peer_id + route_revision`。

不同 `station_peer_id`：

```text
ready(previous Station)
  -> scope_quiescing
  -> projections_cleared
  -> identity_confirm_required
  -> access_gating_new
  -> ready(new Station)
```

必须增加 `lifecycle_generation` 并清除前一 scope。

## 4. Relay Mount

```text
unregistered
  -> invite_presented
  -> challenge_issued
  -> station_proof_verified
  -> active(generation=N)
  -> rotating
  -> active(generation=N+1)

active -> suspended | revoked | expired
suspended -> active(generation=N+1)
revoked -> invite_presented
```

- invite 消费、mount 创建和 generation 建立是一个原子事务。
- `revoked` 立即关闭当前流，旧 credential 不能重建 mount。
- 非空缓存不代表 credential 有效；失败后可进入显式重新 enrollment。

## 5. Federation Context

```text
loading -> single_selected | selection_required | unavailable
selection_required -> selected
selected -> stale -> refreshing -> selected
```

Federation context 与 Relay route 正交。Relay route 变化不得创建或猜测
`federation_id`。

## 6. 禁止状态

- `ready` 但没有已验证的 `station_peer_id` 或 active verified route。
- Relay route 的 Station identity 只来自 Relay 声明。
- 同一 Station 的直连与 Relay 各自拥有 Session、registry 或业务缓存。
- 被撤销 generation 仍有 active stream 或可刷新 credential。
- Relay 持有可解密的 Station session credential 或业务 payload。
- Session 与 Messaging 使用不同 `device_id`。
- Federation action 没有明确 `federation_id`。
- Relay topology 成为普通客户端可编辑状态。

## 7. 客户端类别会话

```text
empty(class)
  -> active(class, session_a)
  -> replacing(class, session_b)
  -> active(class, session_b)

active(desktop) + active(mobile) -> allowed
active(class, session_a) + active(class, session_b) -> forbidden
```

- canonical 类别为 `desktop`、`mobile` 和明确声明的 `web`。
- 新同类别 Session 激活与旧同类别 Session 的 `kicked` 撤销属于一个 Station
  authority 事务；不同类别 Session 不参与该撤销。
- `device_id` 仍绑定具体安装实例、Messaging identity 和 credential scope，但
  不创建额外并发槽。
- 被接管端进入 `revoked(kicked)`，停止旧 generation 的写入与长生命周期
  runtime，并返回 Access Gate。
