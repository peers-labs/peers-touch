# 联邦-Station IM Foundation Phase F 证据报告

**项目：** Peers Touch 联邦-Station IM
**日期：** 2026-07-05
**范围：** Foundation pressure and security evidence
**状态：** Phase F live evidence completed；live deployed federation prerequisite、dual Desktop gateway binding、单条 cross-Station Desktop/browser decrypt、3x5 repeated browser runtime decrypt、removed-member live browser negative、late-join live browser negative、1000-message live browser pressure、bounded multi-follower deployed browser runtime pressure、multiple distinct follower Stations deployed browser pressure 已通过

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
| `chat-federated-browser-prereq` | live deployed federation browser/runtime prerequisite | PASS | `CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 python3 tooling/acceptance/gates/chat/federated_browser_prereq.py` |
| `chat-federated-desktop-dom-group-decrypt` | live deployed cross-Station group projection + SKDM relay delivery + follower Desktop browser decrypt | PASS | single: `/tmp/peers-touch-chat-federated-dom-home/chat-federated-desktop-dom-group-decrypt.txt`; repeated 3x5: `/tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt-report.json` |
| `chat-federated-desktop-dom-removed-member-negative` | live deployed removed-member browser negative: post-remove plaintext must not render in follower DOM | PASS | `/tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative-report.json` |
| `chat-federated-desktop-dom-late-join-negative` | live deployed late-join browser negative: post-add follower must not decrypt pre-join plaintext, then must decrypt post-join plaintext | PASS | `/tmp/peers-touch-chat-federated-dom-late-join-negative/chat-federated-desktop-dom-late-join-negative-report.json` |
| `chat-federated-desktop-dom-group-pressure` | live deployed 1000-message cross-Station Desktop/browser pressure | PASS | `/tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure-report.json` |
| `chat-federated-desktop-dom-multi-follower-pressure` | live deployed bounded multi-follower Desktop/browser pressure: one authority runtime sends to two follower actors/runtimes on the home follower Station | PASS | `/tmp/peers-touch-chat-federated-dom-multi-follower-pressure/chat-federated-desktop-dom-multi-follower-pressure-report.json` |
| Federated key bundle lookup | cross-Station SKDM sealing prerequisite | PASS (code-level) | `cd apps/station/app && GOWORK=off go test ./subserver/key_exchange ./subserver/group_chat -count=1`; `pnpm --filter @peers-touch/app-desktop run check`; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` |

## 3. Home Station 群聊压力与安全

命令：

```bash
CHAT_GROUP_PRESSURE_STATION_URL=http://10.0.0.50:18080 \
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
| Station | `http://10.0.0.50:18080` |
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
CHAT_PRIVATE_PRESSURE_STATION_URL=http://10.0.0.50:18080 \
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
| Station | `http://10.0.0.50:18080` |
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
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
python3 tooling/acceptance/gates/chat/federated_browser_prereq.py
```

结果：PASS。

关键输出：

```text
[OK] authority Station peer id: discovered from http://10.0.0.50:18080/actor/federation/health
[OK] follower Station peer id: discovered from http://10.0.0.50:18082/actor/federation/health
[OK] authority Station: http://10.0.0.50:18080/sub-oss/healthz
[OK] follower Station: http://10.0.0.50:18082/sub-oss/healthz
[OK] Relay: http://10.0.0.50:18081/sub-oss/healthz
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
- Authority Station: `http://10.0.0.50:18080`
- Follower Station: `http://10.0.0.50:18082`
- Relay: `http://10.0.0.50:18081`
- Desktop gateways: `3131` -> authority, `3132` -> follower

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
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

- 这是单条业务路径 gate，不是 1000-message live browser pressure；1000-message live browser pressure 由第 11 节 gate 覆盖；
- removed-member live browser 负例由第 9 节 gate 覆盖；late-join live browser 负例由第 10 节 gate 覆盖。

## 8. Live Cross-Station Browser Runtime Repeat

为了覆盖 repeated live browser/runtime path，`chat-federated-desktop-dom-group-decrypt` 已参数化：

- `CHAT_FEDERATION_DOM_GROUPS`
- `CHAT_FEDERATION_DOM_MESSAGES_PER_GROUP`

同时 gate 在建群前等待 follower SSE stream ready，避免 SKDM event 在订阅建立前发布导致 false negative；失败诊断会打印 group、content、注入 frame 数、queue size、last sync 与 DOM body snippet。

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
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

- 这是 3x5 browser-runtime repeat，不是 1000-message browser pressure；1000-message live browser pressure 由第 11 节 gate 覆盖；
- removed-member 的 deployed browser 负例见第 9 节；late join 的 deployed browser 负例见第 10 节。

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
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
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
- 该 gate 不证明 late-join negative；late-join negative 由第 10 节 gate 覆盖；
- 该 gate 不证明 1000-message live browser pressure；1000-message live browser pressure 由第 11 节 gate 覆盖。

## 10. Live Late-Join Browser Negative

该 gate 证明 remote follower 在 encrypted history 已存在后才被添加进群时，不会获得 pre-join Sender Key 解密资格；同时证明 post-join message 仍可正常通过 federation projection、SKDM/realtime 和 follower Desktop browser runtime 解密：

1. authority Desktop/browser 创建仅包含 owner 的 authority-only group；
2. authority 发送 pre-join Sender-Key encrypted group message；
3. authority 通过受 owner/admin 权限保护的 `/group-chat/member/federated-add` 添加 follower `FederatedActorRef`；
4. follower Desktop/browser 同步 group projection/history；
5. gate 断言 pre-join plaintext 不在 follower DOM 渲染，且 follower history window 中该消息保持 `[Waiting for sender key...]`；
6. authority 发送 post-join Sender-Key encrypted group message；
7. gate 断言 follower DOM 渲染 post-join plaintext。

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
CHAT_FEDERATION_AUTHORITY_WEB_URL=http://localhost:3311/#/chat \
CHAT_FEDERATION_FOLLOWER_WEB_URL=http://localhost:3312/#/chat \
CHAT_FEDERATION_AUTHORITY_PEER_ID=12D3KooWBsTpWe6x5Kyueq1fLVewkU6B1dsgMPQYHuseWhERXe5D \
CHAT_FEDERATION_FOLLOWER_PEER_ID=12D3KooWPMCXa3uQJf47nmcyZ9sJYs2PJ3u9gY6dgLpPF4paRPp6 \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-late-join-negative \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_late_join_negative.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Group | `gcg-1783258525714171800` |
| Pre-join forbidden content | `federated-pre-join-1783258525701` |
| Post-join content | `federated-post-join-1783258525701` |
| Federated add success | `true` |
| Member count after add | `2` |
| Negative window | `60s` |
| Pre-join sync attempts | `2` |
| Pre-join synced messages | `1` |
| Pre-join DOM state | `[Waiting for sender key...]`; forbidden plaintext absent |
| Post-join injected frames | `2` |
| Evidence report | `/tmp/peers-touch-chat-federated-dom-late-join-negative/chat-federated-desktop-dom-late-join-negative-report.json` |
| Screenshot | `/tmp/peers-touch-chat-federated-dom-late-join-negative/chat-federated-desktop-dom-late-join-negative.png` |
| Text evidence | `/tmp/peers-touch-chat-federated-dom-late-join-negative/chat-federated-desktop-dom-late-join-negative.txt` |

边界：

- 该 gate 证明 one authority Station + one follower Station 的 late-join Sender Key entitlement boundary；
- 该 gate 不证明 multi-follower deployed browser runtime pressure；
- 该 gate 不证明 1000-message live browser pressure；1000-message live browser pressure 由第 11 节 gate 覆盖。

## 11. Live 1000-Message Cross-Station Browser Pressure

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
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
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
- 该 gate 不证明 multi-follower deployed browser runtime pressure；bounded multi-follower runtime pressure 由第 12 节 gate 覆盖；
- 该 gate 不证明 late-join live browser negative；late-join live browser negative 由第 10 节 gate 覆盖。

## 12. Live Bounded Multi-Follower Browser Pressure

该 gate 证明在 home deployed topology 下，一个 authority Desktop/browser runtime 向同一个 federated group 中的两个 follower actors 发送 Sender-Key encrypted pressure window 时，两个 follower Desktop/browser runtimes 都能独立通过各自 gateway/session/device realtime SSE 同步、安装 Sender Key、分页解码并渲染最后一条明文。

运行环境：

- authority Station：`http://10.0.0.50:18080`
- follower Station：`http://10.0.0.50:18082`
- Relay：`http://10.0.0.50:18081`
- authority Desktop runtime：`3131/3311`
- follower Desktop runtime A：`3132/3312`
- follower Desktop runtime B：`3133/3313`
- 每个 Desktop runtime 使用独立 `PEERS_STORAGE_ROOT`，避免 dev runtime auth storage 互相覆盖。

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://10.0.0.50:18082 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URLS=http://127.0.0.1:3132,http://127.0.0.1:3133 \
CHAT_FEDERATION_AUTHORITY_WEB_URL=http://localhost:3311/#/chat \
CHAT_FEDERATION_FOLLOWER_WEB_URLS=http://localhost:3312/#/chat,http://localhost:3313/#/chat \
CHAT_FEDERATION_AUTHORITY_PEER_ID=12D3KooWBsTpWe6x5Kyueq1fLVewkU6B1dsgMPQYHuseWhERXe5D \
CHAT_FEDERATION_FOLLOWER_PEER_ID=12D3KooWPMCXa3uQJf47nmcyZ9sJYs2PJ3u9gY6dgLpPF4paRPp6 \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-multi-follower-pressure \
CHAT_FEDERATION_MULTI_FOLLOWER_COUNT=2 \
CHAT_FEDERATION_MULTI_FOLLOWER_MESSAGES=100 \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_multi_follower_pressure.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Group | `gcg-1783259958240421048` |
| Follower runtimes | `2` |
| Pressure messages | `100` |
| Warmup content | `federated-multi-follower-1783259958228-warmup` |
| First pressure content | `federated-multi-follower-1783259958228-0001` |
| Last pressure content | `federated-multi-follower-1783259958228-0100` |
| Send duration | `3657ms` |
| Follower 1 | actor `344642852002725894`; device `01KWS96YB5C152Z0WK0KE4E7GF`; decoded `101`; waiting `0`; failed `0`; first/last `true`; frames `62` |
| Follower 2 | actor `344642852992581638`; device `01KWS971WGXMDN1M19TAAENHS2`; decoded `101`; waiting `0`; failed `0`; first/last `true`; frames `102` |
| Duration | `33642ms` |
| Evidence report | `/tmp/peers-touch-chat-federated-dom-multi-follower-pressure/chat-federated-desktop-dom-multi-follower-pressure-report.json` |
| Follower 1 evidence | `/tmp/peers-touch-chat-federated-dom-multi-follower-pressure/chat-federated-desktop-dom-multi-follower-pressure-follower-1.txt` |
| Follower 2 evidence | `/tmp/peers-touch-chat-federated-dom-multi-follower-pressure/chat-federated-desktop-dom-multi-follower-pressure-follower-2.txt` |

边界：

- 该 gate 证明 one authority Station + one follower Station 上的 multiple follower actors/devices/Desktop browser runtimes；
- multiple distinct follower Stations 由第 13 节 gate 另行证明；
- 该 gate 的 pressure window 是 bounded 100 messages，不替代第 11 节 one-follower 1000-message pressure gate。

## 13. Live Distinct Follower Stations Browser Pressure

该 gate 证明在 home deployed topology 下，一个 authority Desktop/browser runtime 同时向两个不同 follower Stations 上的 federated actors 发送 Sender-Key encrypted pressure window 时，两个 follower Stations 都能经 Relay/follower projection sync/materialization、各自 gateway/session/device realtime SSE 和 Desktop browser runtime 独立解码并渲染最后一条明文。

运行环境：

- authority Station：`http://10.0.0.50:18080`
- follower Station A：`http://10.0.0.50:18082`，PeerID `12D3KooWPMCXa3uQJf47nmcyZ9sJYs2PJ3u9gY6dgLpPF4paRPp6`
- follower Station B：`http://10.0.0.50:18083`，PeerID `12D3KooWH7pDSUuERrU3gARjRCbGgRa3t3yh1o1xTESbkPi3p9b1`
- Relay：`http://10.0.0.50:18081`
- authority Desktop runtime：`3131/3311`
- follower Desktop runtime A：`3132/3312`
- follower Desktop runtime B：`3133/3313`
- 每个 Desktop runtime 使用独立 `PEERS_STORAGE_ROOT`。

命令：

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://10.0.0.50:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URLS=http://10.0.0.50:18082,http://10.0.0.50:18083 \
CHAT_FEDERATION_RELAY_URL=http://10.0.0.50:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URLS=http://127.0.0.1:3132,http://127.0.0.1:3133 \
CHAT_FEDERATION_AUTHORITY_WEB_URL=http://localhost:3311/#/chat \
CHAT_FEDERATION_FOLLOWER_WEB_URLS=http://localhost:3312/#/chat,http://localhost:3313/#/chat \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-distinct-followers \
CHAT_FEDERATION_MULTI_FOLLOWER_COUNT=2 \
CHAT_FEDERATION_MULTI_FOLLOWER_MESSAGES=100 \
CHAT_FEDERATION_MULTI_FOLLOWER_TIMEOUT_SECONDS=1200 \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_multi_follower_pressure.py
```

结果：PASS。

关键指标：

| 指标 | 值 |
| --- | --- |
| Group | `gcg-1783262599893774724` |
| Follower Stations | `2` distinct Stations |
| Pressure messages | `100` |
| Warmup content | `federated-multi-follower-1783262595918-warmup` |
| First pressure content | `federated-multi-follower-1783262595918-0001` |
| Last pressure content | `federated-multi-follower-1783262595918-0100` |
| Send duration | `4344ms` |
| Follower 1 | Station `18082`; actor `344647284492861446`; device `01KWSBQF0A45WBNB1P67YS1R90`; decoded `101`; waiting `0`; failed `0`; first/last `true`; frames `62` |
| Follower 2 | Station `18083`; actor `344647285499494407`; device `01KWSBQHXC1DPQ4C98T5NS80ET`; decoded `101`; waiting `0`; failed `0`; first/last `true`; frames `72` |
| Duration | `28454ms` |
| Evidence report | `/tmp/peers-touch-chat-federated-dom-distinct-followers/chat-federated-desktop-dom-multi-follower-pressure-report.json` |
| Follower 1 evidence | `/tmp/peers-touch-chat-federated-dom-distinct-followers/chat-federated-desktop-dom-multi-follower-pressure-follower-1.txt` |
| Follower 2 evidence | `/tmp/peers-touch-chat-federated-dom-distinct-followers/chat-federated-desktop-dom-multi-follower-pressure-follower-2.txt` |

Root-cause hardening included before this PASS:

- follower event/projection sync token minting now refreshes stale `local` issuer to the runtime federation audience before minting peer JWTs;
- regression `TestDispatchFollowerEventSyncRefreshesStaleLocalIssuer` seeds authority TOFU with a conflicting `local` key and proves follower sync succeeds only when the dynamic issuer is used;
- live home deployment was rebuilt to image `peers-touch-station:local` `9092d8e2d33e`, and Relay `relay_mount` showed all three Stations online before the gate.

边界：

- 该 gate 证明 one authority Station + two distinct follower Stations 的 live home Relay/Desktop browser bounded pressure；
- 该 gate 的 pressure window 是 bounded 100 messages，不替代第 11 节 one-follower 1000-message pressure gate；
- 该 gate 不证明 production packaged Desktop app，证据范围是 deployed Station/Relay + dev Desktop Web/browser runtime。

## 14. Gate Catalog

已登记 gate：

- `chat-group-pressure-security`
- `chat-private-pressure-security`
- `chat-federated-group-pressure`
- `chat-federated-browser-prereq`
- `chat-federated-desktop-dom-group-decrypt`
- `chat-federated-desktop-dom-removed-member-negative`
- `chat-federated-desktop-dom-late-join-negative`
- `chat-federated-desktop-dom-group-pressure`
- `chat-federated-desktop-dom-multi-follower-pressure`

校验：

```bash
python3 -m json.tool tooling/acceptance/gates.yaml
git diff --check
```

结果：PASS。

## 14. 剩余事项

未完成：

- PR/release 阶段需要把本报告和对应 gate 输出纳入最终 reviewer evidence；
- presence invariant scan 仍命中既有 generated/mobile online 债务，本次 Phase F 没有新增 chat-owned presence。

需要的环境输入：

- `CHAT_FEDERATION_AUTHORITY_STATION_URL`
- `CHAT_FEDERATION_FOLLOWER_STATION_URL`
- `CHAT_FEDERATION_RELAY_URL`
- optional `CHAT_FEDERATION_FOLLOWER_STATION_URLS` for multiple distinct follower Stations live browser runtime pressure gate

## 15. 结论

当前 Foundation Phase F 已证明：

- home Station 100 人群聊压力与安全负例；
- home Station 100 actor 私聊并发与安全负例；
- relay-mediated 3-Station federation proposal/event protocol pressure；
- live deployed federation prerequisite plus dual Desktop gateway binding。
- authority-side projection sync、follower materializer、federated key bundle lookup 的代码级前置能力。
- live deployed 单条 cross-Station group projection、SKDM relay delivery、follower Desktop browser decrypt。
- live deployed 3x5 repeated cross-Station browser runtime decrypt。
- live deployed removed-member post-remove plaintext non-rendering in follower browser DOM。
- live deployed late-join pre-join plaintext non-rendering plus post-join plaintext decrypt in follower browser DOM。
- live deployed 1000-message cross-Station Desktop/browser pressure with no waiting/decrypt placeholders。
- live deployed bounded multi-follower Desktop/browser pressure with two follower actors/devices/runtimes and no waiting/decrypt placeholders。
- live deployed distinct follower Stations Desktop/browser pressure with two follower Stations and no waiting/decrypt placeholders。

当前未证明：

- production packaged Desktop app pressure；
- PostgreSQL-backed multi-node disaster recovery；
- mobile/applet chat parity；
- recall/edit/delete user-visible workflow under pressure。

因此 Phase F 可以作为 Foundation protocol、home-station pressure、single-message live cross-Station browser decrypt、3x5 repeated live browser runtime evidence、removed-member live browser negative evidence、late-join live browser negative evidence、1000-message live browser pressure evidence、bounded multi-follower browser runtime pressure evidence、distinct follower Stations browser pressure evidence 进入 PR/release review。
