# 联邦-Station IM Foundation Phase F 证据报告

**项目：** Peers Touch 联邦-Station IM
**日期：** 2026-07-05
**范围：** Foundation pressure and security evidence
**状态：** 部分完成；live deployed federation prerequisite、dual Desktop gateway binding、单条 cross-Station Desktop/browser decrypt、3x5 repeated browser runtime decrypt、removed-member live browser negative、1000-message live browser pressure 已通过，late-join live browser 负例仍未运行

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
| `chat-federated-browser-prereq` | live deployed federation browser/runtime prerequisite | PASS | `CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 python3 tooling/acceptance/gates/chat/federated_browser_prereq.py` |
| `chat-federated-desktop-dom-group-decrypt` | live deployed cross-Station group projection + SKDM relay delivery + follower Desktop browser decrypt | PASS | single: `/tmp/peers-touch-chat-federated-dom-home/chat-federated-desktop-dom-group-decrypt.txt`; repeated 3x5: `/tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt-report.json` |
| `chat-federated-desktop-dom-removed-member-negative` | live deployed removed-member browser negative: post-remove plaintext must not render in follower DOM | PASS | `/tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative-report.json` |
| `chat-federated-desktop-dom-group-pressure` | live deployed 1000-message cross-Station Desktop/browser pressure | PASS | `/tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure-report.json` |
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
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
python3 tooling/acceptance/gates/chat/federated_browser_prereq.py
```

结果：PASS。

关键输出：

```text
[OK] authority Station peer id: discovered from http://192.168.31.119:18080/actor/federation/health
[OK] follower Station peer id: discovered from http://192.168.31.119:18082/actor/federation/health
[OK] authority Station: http://192.168.31.119:18080/sub-oss/healthz
[OK] follower Station: http://192.168.31.119:18082/sub-oss/healthz
[OK] Relay: http://192.168.31.119:18081/sub-oss/healthz
[OK] authority gateway: http://127.0.0.1:3131
[OK] follower gateway: http://127.0.0.1:3132
```

结论：

- deployed federation runtime prerequisite 已证明：home authority Station、one follower Station、home Relay 均健康，且 Station peer IDs 可从 live endpoints 发现；
- dual Desktop gateway/browser runtime prerequisite 已证明：authority gateway 绑定 home Station，follower gateway 绑定 home follower Station；browser agent 也确认 `3311/#/chat` 与 `3312/#/chat` 均可加载 Peers Touch Desktop 页面且无 fatal console error；
- cross-Station SKDM sealing prerequisite 已有代码级证据：Desktop 会从 group membership routing metadata 读取 remote member 的 `home_station_peer_id`，通过 `FetchKeyBundleRequest.home_station_peer_id` 请求 authority Station；authority Station 通过 home Relay 转发到 remote `/key-exchange/keys/bundle/federated-fetch`，并使用 `key-exchange-bundle-fetch` peer-JWT scope 绑定 actor DID 与可选 device id；
- 单条 live cross-Station group decrypt 已证明：authority Desktop 创建含 remote follower 的群，follower projection sync 获取 group/member/message，SKDM 通过 home Relay 到达 follower Station，并进入 follower Desktop 后完成浏览器 DOM 解密；
- 该证据仍不证明 1000-message browser pressure 或 live browser 负例；1000-message live browser pressure 由第 10 节 gate 覆盖。

## 7. Live Cross-Station Desktop DOM Decrypt

修复与部署：

- Commit: `c0a77579 fix(station): mint SKDM tokens from sender home`
- Authority Station: `http://192.168.31.119:18080`
- Follower Station: `http://192.168.31.119:18082`
- Relay: `http://192.168.31.119:18081`
- Desktop gateways: `3131` -> authority, `3132` -> follower

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
CHAT_FEDERATION_AUTHORITY_WEB_URL=http://localhost:3311/#/chat \
CHAT_FEDERATION_FOLLOWER_WEB_URL=http://localhost:3312/#/chat \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-home \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_group_decrypt.py
```

结果：PASS。

关键输出：

```text
[OK] group: gcg-1783248081167879439
[OK] content: federated-group-skdm-1783248081123
[OK] injected_realtime_frames: 1
[OK] screenshot: /tmp/peers-touch-chat-federated-dom-home/chat-federated-desktop-dom-group-decrypt.png
[OK] evidence: /tmp/peers-touch-chat-federated-dom-home/chat-federated-desktop-dom-group-decrypt.txt
```

文本证据中 follower DOM 含：

```text
344622930031...: federated-group-skdm-1783248081123
```

本 gate 证明的范围：

- live deployed authority Station -> follower Station projection sync；
- live home Relay-mediated SKDM delivery；
- target follower Station device-scoped realtime delivery；
- follower Desktop local SKDM install；
- follower browser DOM 渲染解密后的 post-join group message。

边界：

- 这是单条业务路径 gate，不是 1000-message live browser pressure；1000-message live browser pressure 由第 10 节 gate 覆盖；
- late join live browser 负例仍由 code-level harness 覆盖，尚未做 deployed browser 负例；removed-member live browser 负例由第 9 节 gate 覆盖。

## 8. Live Cross-Station Browser Runtime Repeat

为了覆盖 repeated live browser/runtime path，`chat-federated-desktop-dom-group-decrypt` 已参数化：

- `CHAT_FEDERATION_DOM_GROUPS`
- `CHAT_FEDERATION_DOM_MESSAGES_PER_GROUP`

同时 gate 在建群前等待 follower SSE stream ready，避免 SKDM event 在订阅建立前发布导致 false negative；失败诊断会打印 group、content、注入 frame 数、queue size、last sync 与 DOM body snippet。

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
CHAT_FEDERATION_AUTHORITY_WEB_URL=http://localhost:3311/#/chat \
CHAT_FEDERATION_FOLLOWER_WEB_URL=http://localhost:3312/#/chat \
CHAT_FEDERATION_DOM_GROUPS=3 \
CHAT_FEDERATION_DOM_MESSAGES_PER_GROUP=5 \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-home-repeat \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_group_decrypt.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Groups | `3` |
| Messages per group | `5` |
| Total messages | `15` |
| Injected realtime frames | `24` |
| Duration | `130842ms` |
| Evidence report | `/tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt-report.json` |
| Screenshot | `/tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt.png` |
| Text evidence | `/tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt.txt` |

Groups:

- `gcg-1783249210727940863`
- `gcg-1783249256885532409`
- `gcg-1783249303165093892`

本 gate 证明的新增范围：

- repeated live group creation with remote `FederatedActorRef`；
- repeated SKDM/realtime handling across multiple cross-Station groups；
- same live follower Desktop browser runtime decrypting 15 post-join encrypted messages。

边界：

- 这是 3x5 browser-runtime repeat，不是 1000-message browser pressure；1000-message live browser pressure 由第 10 节 gate 覆盖；
- late join 的 deployed browser 负例仍未运行；removed-member 的 deployed browser 负例见第 9 节。

## 9. Live Removed-Member Browser Negative

该 gate 证明 removed remote follower 不会继续解密/渲染移除后的 authority group message 明文：

1. authority Desktop/browser 创建包含 follower `FederatedActorRef` 的跨 Station 群；
2. authority 发送 pre-remove group message；
3. follower Desktop/browser 通过 projection sync、SKDM relay delivery 和 local Sender Key install 解密 pre-remove message；
4. authority 通过 browser-callable Desktop group lifecycle path 移除 follower；
5. authority 发送 post-remove group message；
6. gate 在 follower DOM 观察窗口内注入 realtime frames、触发 projection sync，并断言 post-remove plaintext 不出现。

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
CHAT_FEDERATION_AUTHORITY_WEB_URL=http://localhost:3311/#/chat \
CHAT_FEDERATION_FOLLOWER_WEB_URL=http://localhost:3312/#/chat \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-removed-negative \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_removed_member_negative.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Group | `gcg-1783250569288640322` |
| Pre-remove content | `federated-pre-remove-1783250569265` |
| Post-remove forbidden content | `federated-post-remove-1783250569265` |
| Removal success | `true` |
| Remaining member count | `1` |
| Pre-remove injected frames | `1` |
| Post-remove injected frames | `3` |
| Negative window | `45s` |
| Sync attempts | `21` |
| Evidence report | `/tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative-report.json` |
| Screenshot | `/tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative.png` |
| Text evidence | `/tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative.txt` |

边界：

- 该 gate 证明 removed-member post-remove plaintext 不会在 follower browser DOM 渲染；
- 该 gate 不证明 late-join negative，因为当前 Desktop 产品合约未暴露 post-create federated invite/join routing metadata；
- 该 gate 不证明 1000-message live browser pressure；1000-message live browser pressure 由第 10 节 gate 覆盖。

## 10. Live 1000-Message Cross-Station Browser Pressure

该 gate 证明 live home authority Station、home follower Station、home Relay、双 Desktop gateway 和 follower browser runtime 在 1000 条 Sender-Key 加密群消息压力下可以完成投影同步、SKDM 解密和 DOM 渲染：

1. authority Desktop/browser 创建包含 follower `FederatedActorRef` 的跨 Station 群；
2. warmup message 先证明 SKDM relay delivery、follower local Sender Key install 和 DOM 解密；
3. authority Desktop runtime 分块发送 1000 条 Sender-Key 加密群消息；
4. follower browser runtime 注入 realtime frames、触发 projection/history sync；
5. follower browser runtime 按 Sender Key 时间线顺序分块解密 1001-message window；
6. gate 断言 first/last plaintext 都存在，且无 `[Waiting for sender key...]` / `[Decrypt failed]`；
7. gate 最后断言 follower DOM 渲染第 1000 条明文。

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
CHAT_FEDERATION_AUTHORITY_PEER_ID=12D3KooWBsTpWe6x5Kyueq1fLVewkU6B1dsgMPQYHuseWhERXe5D \
CHAT_FEDERATION_FOLLOWER_PEER_ID=12D3KooWPMCXa3uQJf47nmcyZ9sJYs2PJ3u9gY6dgLpPF4paRPp6 \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3 \
CHAT_FEDERATION_PRESSURE_MESSAGES=1000 \
CHAT_FEDERATION_PRESSURE_PAGE_LIMIT=100 \
CHAT_FEDERATION_PRESSURE_MAX_PAGES=12 \
CHAT_FEDERATION_PRESSURE_TIMEOUT_SECONDS=1800 \
CHAT_FEDERATION_PRESSURE_SEND_CHUNK_SIZE=50 \
CHAT_FEDERATION_PRESSURE_DECODE_CHUNK_SIZE=100 \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_group_pressure.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Group | `gcg-1783256420684132473` |
| Sent messages | `1000` |
| Send duration | `47192ms` |
| Synced count | `1000` |
| Decoded window | `1001` including warmup |
| Pages fetched | `11` |
| Injected realtime frames | `1007` |
| Waiting placeholders | `0` |
| Decrypt failures | `0` |
| First pressure plaintext found | `true` |
| Last pressure plaintext found | `true` |
| Total duration | `106547ms` |
| Evidence report | `/tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure-report.json` |
| Screenshot | `/tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure.png` |
| Text evidence | `/tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure.txt` |

本 gate 暴露并驱动修复三类 live runtime 根因：

- follower browser runtime 不应对 1000 个 `GroupFederationEvent` 启动 1000 个并发 projection refresh；`socialRealtime` 现在按 group 合并 in-flight/pending refresh；
- Sender Key decrypt 是 per-group/per-sender ratcheting chain；acceptance decode 现在先收集窗口，再按时间线分块解密；
- Station 普通消息分页返回当前页升序窗口；acceptance cursor 必须使用当前页 oldest ULID 才能真正向历史回扫。

边界：

- 该 gate 证明 one authority Station + one follower Station 的 live home Relay/Desktop browser 1000-message pressure；
- 该 gate 不证明 multi-follower deployed browser runtime pressure；
- 该 gate 不证明 late-join live browser negative。

## 11. Gate Catalog

已登记 gate：

- `chat-group-pressure-security`
- `chat-private-pressure-security`
- `chat-federated-group-pressure`
- `chat-federated-browser-prereq`
- `chat-federated-desktop-dom-group-decrypt`
- `chat-federated-desktop-dom-removed-member-negative`
- `chat-federated-desktop-dom-group-pressure`

校验：

```bash
python3 -m json.tool tooling/acceptance/gates.yaml
git diff --check
```

结果：PASS。

## 12. 剩余事项

未完成：

- PR/release 阶段需要把本报告和对应 gate 输出纳入最终 reviewer evidence；
- presence invariant scan 仍命中既有 generated/mobile online 债务，本次 Phase F 没有新增 chat-owned presence。
- late join live browser negative gate。

需要的环境输入：

- `CHAT_FEDERATION_AUTHORITY_STATION_URL`
- `CHAT_FEDERATION_FOLLOWER_STATION_URL`
- `CHAT_FEDERATION_RELAY_URL`
- optional higher-load live cross-Station browser runtime pressure gate

## 13. 结论

当前 Foundation Phase F 已证明：

- home Station 100 人群聊压力与安全负例；
- home Station 100 actor 私聊并发与安全负例；
- relay-mediated 3-Station federation proposal/event protocol pressure；
- live deployed federation prerequisite plus dual Desktop gateway binding。
- authority-side projection sync、follower materializer、federated key bundle lookup 的代码级前置能力。
- live deployed 单条 cross-Station group projection、SKDM relay delivery、follower Desktop browser decrypt。
- live deployed 3x5 repeated cross-Station browser runtime decrypt。
- live deployed removed-member post-remove plaintext non-rendering in follower browser DOM。
- live deployed 1000-message cross-Station Desktop/browser pressure with no waiting/decrypt placeholders。

当前未证明：

- late join live browser 负例。

因此 Phase F 可以作为 Foundation protocol、home-station pressure、single-message live cross-Station browser decrypt、3x5 repeated live browser runtime evidence、removed-member live browser negative evidence、1000-message live browser pressure evidence 进入 PR/release review，但不能声明 late-join live browser 负例完成。
