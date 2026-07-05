# 联邦-Station IM Foundation Phase F 证据报告

**项目：** Peers Touch 联邦-Station IM
**日期：** 2026-07-05
**范围：** Foundation pressure and security evidence
**状态：** 部分完成；live deployed federation prerequisite 与 dual Desktop gateway binding 已通过，完整 cross-Station Desktop/browser message pressure 仍未运行

## 1. 计划来源

- `docs/architecture/federated-im/design.md`
- `docs/architecture/federated-im/execution-plans/20260704-foundation-federated-im.md`
- Phase F: Foundation Pressure And Security Harness

Phase F 要求：

- 100 人本地/家庭 Station 群聊压力；
- 3-Station 联邦群聊压力；
- 私聊并发压力；
- metrics output and threshold report；
- 安全负例；
- report attached to PR/release evidence。

## 2. 证据总览

| Gate | 范围 | 结果 | 证据 |
| --- | --- | --- | --- |
| `chat-group-pressure-security` | home Station 群聊 100 actors / 10 senders / 1000 messages | PASS | `/tmp/peers-touch-chat-group-pressure-full/group_pressure_security_report.json` |
| `chat-private-pressure-security` | home Station 私聊 100 actors / 50 sessions / 1000 messages | PASS | `/tmp/peers-touch-chat-private-pressure-full/private_pressure_security_report.json` |
| `chat-federated-group-pressure` | relay-mediated 3-Station federation proposal/event path | PASS | `GOWORK=off go test ./subserver/group_chat -run TestRelayMediatedThreeStationProposalPressureAcceptance -count=1 -v` |
| `chat-federated-browser-prereq` | live deployed federation browser/runtime prerequisite | PASS | `CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.37.246.80:18080 CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 python3 tooling/acceptance/gates/chat/federated_browser_prereq.py` |
| Federated key bundle lookup | cross-Station SKDM sealing prerequisite | PASS (code-level) | `cd apps/station/app && GOWORK=off go test ./subserver/key_exchange ./subserver/group_chat -count=1`; `pnpm --filter @peers-touch/app-desktop run check`; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` |

## 3. Home Station 群聊压力与安全

命令：

```bash
CHAT_GROUP_PRESSURE_STATION_URL=http://192.168.31.119:18080 \
CHAT_GROUP_PRESSURE_ACTORS=100 \
CHAT_GROUP_PRESSURE_SENDERS=10 \
CHAT_GROUP_PRESSURE_MESSAGES=1000 \
CHAT_GROUP_PRESSURE_OUT_DIR=/tmp/peers-touch-chat-group-pressure-full \
python3 tooling/acceptance/gates/chat/group_pressure_security.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Station | `http://192.168.31.119:18080` |
| Group | `gcg-1783199717561813891` |
| Actors | `100` |
| Senders | `10` |
| Messages | `1000` |
| Inactive recovery | `1000/1000` |
| Recovery pages | `10` |
| Recovery duration | `210.21ms` |
| Send p50 | `30.20ms` |
| Send p95 | `35.30ms` |
| Send max | `97.92ms` |

安全负例：

| 检查 | 结果 |
| --- | --- |
| Plaintext group send | rejected `400` |
| Stale membership epoch | rejected `409` |
| Direct join without invitation | rejected `400` |
| Removed member send | rejected `403` |
| Plaintext leakage | API `content` empty and `encrypted_payload` present |

本 gate 曾暴露并驱动修复两类根因：

- `gcm-*` 使用 raw `UnixNano` 在高吞吐下可能碰撞；
- `/group-chat/messages` 的 `before_ulid` cursor 与 DB order key 不一致。

修复后，回归测试：

```bash
cd apps/station/app
GOWORK=off go test ./subserver/group_chat -run 'TestHandleGetMessagesNextCursorDoesNotRepeatPage' -count=1
GOWORK=off go test ./subserver/events ./subserver/group_chat/...
```

结果：PASS。

## 4. Home Station 私聊并发与安全

命令：

```bash
CHAT_PRIVATE_PRESSURE_STATION_URL=http://192.168.31.119:18080 \
CHAT_PRIVATE_PRESSURE_ACTORS=100 \
CHAT_PRIVATE_PRESSURE_MESSAGES=1000 \
CHAT_PRIVATE_PRESSURE_WORKERS=16 \
CHAT_PRIVATE_PRESSURE_OUT_DIR=/tmp/peers-touch-chat-private-pressure-full \
python3 tooling/acceptance/gates/chat/private_pressure_security.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Station | `http://192.168.31.119:18080` |
| Actors | `100` |
| Sessions | `50` |
| Messages | `1000` |
| Workers | `16` |
| Recovery | `1000/1000` |
| Recovery pages | `50` |
| Recovery duration | `844.06ms` |
| Read acknowledgements | `500` |
| Send p50 | `23.02ms` |
| Send p95 | `35.22ms` |
| Send max | `48.02ms` |

安全负例：

| 检查 | 结果 |
| --- | --- |
| Non-participant send | rejected `403` |
| Invalid receiver | rejected `403` |
| Blocked-user send | rejected `403` |
| Plaintext leakage | API content does not contain gate plaintext and `encrypted_payload` present |

## 5. Relay-Mediated 3-Station Federation Pressure

命令：

```bash
cd apps/station/app
GOWORK=off go test ./subserver/group_chat -run TestRelayMediatedThreeStationProposalPressureAcceptance -count=1 -v
```

结果：PASS。

该 harness 使用 in-process Relay forwarder，但走真实 federation contracts：

- Station B/C proposal outbox；
- Relay forward；
- Authority Station A `/group-chat/proposal/accept`；
- Authority event log；
- Authority federation outbox；
- Station B/C `/group-chat/event/apply`；
- follower projection cursor/hash 更新；
- peer-JWT wrapper 与 relay authorization header 分离。

关键指标：

| 指标 | 值 |
| --- | --- |
| Stations | `station-a`, `station-b`, `station-c` |
| Remote actors | `100` |
| Active senders | `10` |
| Message proposals | `1000` |
| Fanout deliveries | `2000` |
| Enqueue | `1-2ms` |
| Proposal dispatch | `474-481ms` |
| Federation fanout | `410-460ms` |

边界：

- 该证据证明 Foundation federation proposal/event path 的压力能力；
- 不证明真实部署态 Relay、三台独立 Station 进程、Desktop browser decrypt；
- 不替代 Phase E 的 browser decrypt acceptance。

## 6. Live Deployed Federation Runtime 前置

命令：

```bash
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.37.246.80:18080 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
python3 tooling/acceptance/gates/chat/federated_browser_prereq.py
```

结果：PASS。

关键输出：

```text
[OK] authority Station peer id: discovered from http://192.168.31.119:18080/actor/federation/health
[OK] follower Station peer id: discovered from http://10.37.246.80:18080/actor/federation/health
[OK] authority Station: http://192.168.31.119:18080/sub-oss/healthz
[OK] follower Station: http://10.37.246.80:18080/sub-oss/healthz
[OK] Relay: http://192.168.31.119:18081/sub-oss/healthz
[OK] authority gateway: http://127.0.0.1:3131
[OK] follower gateway: http://127.0.0.1:3132
```

结论：

- deployed federation runtime prerequisite 已证明：home authority Station、one follower Station、home Relay 均健康，且 Station peer IDs 可从 live endpoints 发现；
- dual Desktop gateway/browser runtime prerequisite 已证明：authority gateway 绑定 home Station，follower gateway 绑定 one Station；browser agent 也确认 `3311/#/chat` 与 `3312/#/chat` 均可加载 Peers Touch Desktop 页面且无 fatal console error；
- cross-Station SKDM sealing prerequisite 已有代码级证据：Desktop 会从 group membership routing metadata 读取 remote member 的 `home_station_peer_id`，通过 `FetchKeyBundleRequest.home_station_peer_id` 请求 authority Station；authority Station 通过 home Relay 转发到 remote `/key-exchange/keys/bundle/federated-fetch`，并使用 `key-exchange-bundle-fetch` peer-JWT scope 绑定 actor DID 与可选 device id；
- 该证据仍不证明 cross-Station group message decrypt 或 runtime pressure；
- 下一步需要运行 cross-Station SKDM relay delivery 与 browser decrypt/pressure gate；authority projection sync、follower-side group/member/message materializer、federated key bundle lookup 已有代码级回归，但仍未替代真实 Desktop browser runtime 验证。

## 7. Gate Catalog

已登记 gate：

- `chat-group-pressure-security`
- `chat-private-pressure-security`
- `chat-federated-group-pressure`
- `chat-federated-browser-prereq`

校验：

```bash
python3 -m json.tool tooling/acceptance/gates.yaml
git diff --check
```

结果：PASS。

## 8. 剩余事项

未完成：

- live deployed 3-Station browser/runtime group message pressure run；
- PR/release 阶段需要把本报告和对应 gate 输出纳入最终 reviewer evidence；
- presence invariant scan 仍命中既有 generated/mobile online 债务，本次 Phase F 没有新增 chat-owned presence。
- live browser gate 还需要证明 remote follower Desktop 收到投影、接收 federated SKDM delivery，并在 DOM 中解密 post-join group message；当前 key bundle lookup 只证明 authority Desktop 具备为 remote follower 取 public bundle 并封装 SKDM 的前置能力。

需要的环境输入：

- `CHAT_FEDERATION_AUTHORITY_STATION_URL`
- `CHAT_FEDERATION_FOLLOWER_STATION_URL`
- `CHAT_FEDERATION_RELAY_URL`
- live cross-Station group business-flow gate using the projection materialization path
- SKDM relay delivery into follower Desktop
- browser runtime group decrypt pressure gate

## 9. 结论

当前 Foundation Phase F 已证明：

- home Station 100 人群聊压力与安全负例；
- home Station 100 actor 私聊并发与安全负例；
- relay-mediated 3-Station federation proposal/event protocol pressure；
- live deployed federation prerequisite plus dual Desktop gateway binding。
- authority-side projection sync、follower materializer、federated key bundle lookup 的代码级前置能力。

当前未证明：

- 真实部署态 3-Station group message pressure、SKDM relay delivery into follower Desktop、跨 Station browser decrypt 体验。

因此 Phase F 可以作为 Foundation protocol and home-station pressure evidence 进入 PR/release review，但不能声明 live deployed 3-Station runtime 完成。
