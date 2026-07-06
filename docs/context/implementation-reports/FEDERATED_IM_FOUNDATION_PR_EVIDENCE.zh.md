# 联邦-Station IM Foundation PR 证据交接

**日期：** 2026-07-05
**范围：** 联邦-Station IM Foundation 本地变更进入 PR/release review 前的 evidence packaging
**结论：** 可进入代码审查；已证明 single-message、3x5 repeated live cross-Station Desktop/browser decrypt、removed-member live browser negative、late-join live browser negative、1000-message live browser pressure、bounded multi-follower deployed browser runtime pressure，以及 multiple distinct follower Stations browser pressure

## 1. Plan Source

- `docs/architecture/federated-im/design.md`
- `docs/architecture/federated-im/data-model.md`
- `docs/architecture/federated-im/decisions.md`
- `docs/architecture/federated-im/execution-plans/20260704-foundation-federated-im.md`
- `docs/context/implementation-reports/FEDERATED_IM_FOUNDATION_PHASE_F_EVIDENCE.zh.md`

## 2. Review Target

标准质量证据命令：

```bash
make quality-evidence REVIEW_RANGE=origin/master...HEAD
```

结果：

- `tooling/acceptance/reports/latest-quality-evidence.md`
- `tooling/acceptance/reports/latest-quality-evidence.json`
- quality tool output: `Ready for pt-github-review: yes` for the committed range only

边界：

- 该质量证据覆盖 committed range：`origin/master...HEAD`。
- 当前 committed range 已包含 Phase F pressure gates、federated pressure harness、Phase F evidence bundle，以及 live browser decrypt evidence handoff。
- PR 更新前应在提交本次 late-join negative gate delta 后再次运行 `make quality-evidence REVIEW_RANGE=<base>...<head>`。

## 3. Review Profiles

质量证据匹配 profiles：

- `acceptance`
- `desktop`
- `docs`
- `proto`
- `station`

匹配 knowledge：

- `docs/knowledge/invariants/actor-presence-ownership.md`
- `docs/knowledge/invariants/chat-message-boundaries.md`
- `docs/knowledge/invariants/client-ui-identity-before-edit.md`
- `docs/knowledge/invariants/desktop-chat-layout-boundaries.md`
- `docs/knowledge/playbooks/desktop-debug-runtime.md`
- `docs/knowledge/playbooks/documenting-large-requirements.md`

本次 Phase F 没有新增 chat-owned presence；presence scan 仍命中既有 generated/mobile online 债务。

## 4. Gates Run

| Gate / Command | Result | Scope |
| --- | --- | --- |
| `make quality-evidence REVIEW_RANGE=origin/master...HEAD` | PASS | Standard committed-range quality evidence |
| `python3 tooling/scripts/acceptance-plan.py --root tooling/acceptance --self-check` | PASS | Acceptance framework self-check |
| `./model/build.sh` | PASS | Proto generation; retained only IM/realtime generated outputs relevant to this change |
| `cd apps/desktop && pnpm run check` | PASS | Desktop social wire/runtime boundary and TS type check |
| `cd apps/station && go test ./app/subserver/friend_chat/...` | PASS | Friend-chat Station package contracts |
| `cd apps/station/app && GOWORK=off go test ./subserver/group_chat/...` | PASS | Group-chat Station and federation contracts |
| `python3 -m py_compile tooling/acceptance/gates/chat/*.py` selected IM gates | PASS | Python gate syntax |
| `python3 -m json.tool tooling/acceptance/gates.yaml` | PASS | Gate catalog JSON |
| `git diff --check` | PASS | Patch whitespace |

## 5. Phase F Environment Evidence

### 5.1 Home Station Group Pressure

Command:

```bash
CHAT_GROUP_PRESSURE_STATION_URL=http://192.168.31.119:18080 \
CHAT_GROUP_PRESSURE_ACTORS=100 \
CHAT_GROUP_PRESSURE_SENDERS=10 \
CHAT_GROUP_PRESSURE_MESSAGES=1000 \
CHAT_GROUP_PRESSURE_OUT_DIR=/tmp/peers-touch-chat-group-pressure-full \
python3 tooling/acceptance/gates/chat/group_pressure_security.py
```

Result: PASS.

Evidence:

- `/tmp/peers-touch-chat-group-pressure-full/group_pressure_security_report.json`
- `messages_seen=1000`
- `pages=10`
- `p95=35.30ms`
- plaintext send rejected `400`
- stale epoch rejected `409`
- direct join rejected `400`
- removed-member send rejected `403`

### 5.2 Home Station Private Pressure

Command:

```bash
CHAT_PRIVATE_PRESSURE_STATION_URL=http://192.168.31.119:18080 \
CHAT_PRIVATE_PRESSURE_ACTORS=100 \
CHAT_PRIVATE_PRESSURE_MESSAGES=1000 \
CHAT_PRIVATE_PRESSURE_WORKERS=16 \
CHAT_PRIVATE_PRESSURE_OUT_DIR=/tmp/peers-touch-chat-private-pressure-full \
python3 tooling/acceptance/gates/chat/private_pressure_security.py
```

Result: PASS.

Evidence:

- `/tmp/peers-touch-chat-private-pressure-full/private_pressure_security_report.json`
- `session_count=50`
- `messages_seen=1000`
- `read_acknowledgements=500`
- `p95=35.22ms`
- non-participant send rejected `403`
- invalid receiver rejected `403`
- blocked send rejected `403`

### 5.3 Relay-Mediated 3-Station Federation Pressure

Command:

```bash
cd apps/station/app
GOWORK=off go test ./subserver/group_chat -run TestRelayMediatedThreeStationProposalPressureAcceptance -count=1 -v
```

Result: PASS.

Evidence:

- `actors=100`
- `active_senders=10`
- `proposals=1000`
- `fanout_deliveries=2000`
- latest observed run: `proposal_dispatch_ms=481`, `fanout_ms=460`

Boundary:

- Proves relay-mediated Foundation federation proposal/event protocol path.
- Does not prove live deployed Relay, independent Station processes, or Desktop browser decrypt.

## 6. Gates Not Run / Unproven Scope

| Scope | Status | Reason / Next Evidence |
| --- | --- | --- |
| live deployed 3-Station browser/runtime pressure | PASS | deployed prereq passes for home authority Station, home follower Station A, home follower Station B, home Relay, and Desktop gateways bound to distinct Stations; single-message and 3x5 repeated projection sync, SKDM relay delivery, follower Desktop install, and browser decrypt passed; removed-member live browser negative passed; late-join live browser negative passed; 1000-message one-authority/one-follower browser pressure passed; bounded two-follower same-follower-Station browser runtime pressure passed; multiple distinct follower Stations browser pressure passed |
| `chat-desktop-dom-message-visible` from standard acceptance plan | NOT RUN in this packaging pass | Requires local Desktop web/gateway runtime; earlier same-home group Sender Key DOM gate evidence exists separately |
| `chat-desktop-gateway-e2e` from standard acceptance plan | NOT RUN in this packaging pass | Requires Desktop HTTP gateway runtime |
| `chat-live-realtime-e2e` from standard acceptance plan | NOT RUN in this packaging pass | Requires fedp5/live realtime environment |
| final PR range quality evidence | PASS | `make review-submit REVIEW_BASE=origin/master` passed after the final distinct-follower delta. CI-selected gates passed: `proto-build`, `station-chat-unit`, `desktop-check`, and `acceptance-plan-self`. Evidence artifacts: `tooling/acceptance/reports/latest-quality-evidence.md` and `tooling/acceptance/reports/latest-report.md` |

Live 3-Station prerequisite command:

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
python3 tooling/acceptance/gates/chat/federated_browser_prereq.py
```

Observed result:

```text
[OK] authority Station peer id: discovered from http://192.168.31.119:18080/actor/federation/health
[OK] follower Station peer id: discovered from http://192.168.31.119:18082/actor/federation/health
[OK] authority Station: http://192.168.31.119:18080/sub-oss/healthz
[OK] follower Station: http://192.168.31.119:18082/sub-oss/healthz
[OK] Relay: http://192.168.31.119:18081/sub-oss/healthz
[OK] authority gateway: http://127.0.0.1:3131
[OK] follower gateway: http://127.0.0.1:3132
```

Live cross-Station Desktop/browser decrypt command:

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

Observed result:

```text
[OK] group: gcg-1783248081167879439
[OK] content: federated-group-skdm-1783248081123
[OK] injected_realtime_frames: 1
[OK] screenshot: /tmp/peers-touch-chat-federated-dom-home/chat-federated-desktop-dom-group-decrypt.png
[OK] evidence: /tmp/peers-touch-chat-federated-dom-home/chat-federated-desktop-dom-group-decrypt.txt
```

Live repeated cross-Station Desktop/browser decrypt command:

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

Observed result:

```text
[OK] groups: 3
[OK] messages_per_group: 5
[OK] total_messages: 15
[OK] injected_realtime_frames: 24
[OK] duration_ms: 130842
[OK] screenshot: /tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt.png
[OK] evidence: /tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt.txt
[OK] report: /tmp/peers-touch-chat-federated-dom-home-repeat/chat-federated-desktop-dom-group-decrypt-report.json
```

Live removed-member cross-Station Desktop/browser negative command:

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

Observed result:

```text
[OK] group: gcg-1783250569288640322
[OK] pre_remove_content: federated-pre-remove-1783250569265
[OK] post_remove_forbidden_content: federated-post-remove-1783250569265
[OK] pre_remove_injected_frames: 1
[OK] post_remove_injected_frames: 3
[OK] observed_not_member: False
[OK] screenshot: /tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative.png
[OK] evidence: /tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative.txt
[OK] report: /tmp/peers-touch-chat-federated-dom-removed-negative/chat-federated-desktop-dom-removed-member-negative-report.json
```

Report evidence:

- removal returned `success=true` and `memberCount=1`;
- follower decrypted pre-remove content;
- follower DOM did not render post-remove forbidden content during the `45s` negative observation window;
- final body excerpt showed pre-remove plaintext and `[Waiting for sender key...]` placeholder for the post-remove row, not the post-remove plaintext.

Live late-join cross-Station Desktop/browser negative command:

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
CHAT_FEDERATION_AUTHORITY_GATEWAY_URL=http://127.0.0.1:3131 \
CHAT_FEDERATION_FOLLOWER_GATEWAY_URL=http://127.0.0.1:3132 \
CHAT_FEDERATION_AUTHORITY_WEB_URL=http://localhost:3311/#/chat \
CHAT_FEDERATION_FOLLOWER_WEB_URL=http://localhost:3312/#/chat \
CHAT_FEDERATION_AUTHORITY_PEER_ID=12D3KooWBsTpWe6x5Kyueq1fLVewkU6B1dsgMPQYHuseWhERXe5D \
CHAT_FEDERATION_FOLLOWER_PEER_ID=12D3KooWPMCXa3uQJf47nmcyZ9sJYs2PJ3u9gY6dgLpPF4paRPp6 \
CHAT_FEDERATION_DOM_OUT_DIR=/tmp/peers-touch-chat-federated-dom-late-join-negative \
python3 tooling/acceptance/gates/chat/federated_desktop_dom_late_join_negative.py
```

Observed result:

```text
[OK] group: gcg-1783258525714171800
[OK] pre_join_forbidden_content: federated-pre-join-1783258525701
[OK] post_join_content: federated-post-join-1783258525701
[OK] pre_join_negative_frames: 0
[OK] post_join_injected_frames: 2
[OK] screenshot: /tmp/peers-touch-chat-federated-dom-late-join-negative/chat-federated-desktop-dom-late-join-negative.png
[OK] evidence: /tmp/peers-touch-chat-federated-dom-late-join-negative/chat-federated-desktop-dom-late-join-negative.txt
[OK] report: /tmp/peers-touch-chat-federated-dom-late-join-negative/chat-federated-desktop-dom-late-join-negative-report.json
```

Report evidence:

- federated add returned `success=true` and `memberCount=2`;
- follower materialized the pre-join history window with `messageCount=1` and `syncedCount=1`;
- follower DOM did not render the pre-join forbidden plaintext during the `60s` negative observation window;
- pre-join row remained `[Waiting for sender key...]`;
- follower decrypted/rendered the post-join plaintext after `2` realtime frames.

Live 1000-message cross-Station Desktop/browser pressure command:

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

Observed result:

```text
[OK] group: gcg-1783256420684132473
[OK] message_count: 1000
[OK] sent_count: 1000
[OK] decoded_count: 1001
[OK] waiting_count: 0
[OK] failed_count: 0
[OK] first_found: True
[OK] last_found: True
[OK] injected_realtime_frames: 1007
[OK] duration_ms: 106547
[OK] screenshot: /tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure.png
[OK] evidence: /tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure.txt
[OK] report: /tmp/peers-touch-chat-federated-dom-pressure-1000-rerun3/chat-federated-desktop-dom-group-pressure-report.json
```

Report evidence:

- authority Desktop sent `1000` Sender-Key encrypted group messages in `47192ms`;
- follower projection sync reported `syncedCount=1000` and `pagesFetched=11`;
- follower browser runtime decoded a `1001` message window including warmup;
- no `[Waiting for sender key...]` and no `[Decrypt failed]` were observed in the decoded pressure window;
- follower DOM rendered the last pressure plaintext.

Live bounded multi-follower Desktop/browser pressure command:

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URL=http://192.168.31.119:18082 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
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

Observed result:

```text
[OK] group: gcg-1783259958240421048
[OK] follower_count: 2
[OK] message_count: 100
[OK] sent_count: 100
[OK] follower_1: actor=344642852002725894 decoded=101 waiting=0 failed=0 first=True last=True frames=62
[OK] follower_2: actor=344642852992581638 decoded=101 waiting=0 failed=0 first=True last=True frames=102
[OK] duration_ms: 33642
[OK] report: /tmp/peers-touch-chat-federated-dom-multi-follower-pressure/chat-federated-desktop-dom-multi-follower-pressure-report.json
```

Report evidence:

- one authority Desktop runtime and two follower Desktop runtimes used independent gateways and isolated `PEERS_STORAGE_ROOT` values;
- both follower actors were members of the same federated group on the home follower Station;
- both follower runtimes decrypted the warmup Sender-Key message;
- authority Desktop sent `100` Sender-Key encrypted pressure messages;
- follower 1 decoded `101` messages including warmup with `waitingCount=0`, `failedCount=0`, `firstFound=true`, `lastFound=true`;
- follower 2 decoded `101` messages including warmup with `waitingCount=0`, `failedCount=0`, `firstFound=true`, `lastFound=true`;
- both follower DOMs rendered the last pressure plaintext.

Live distinct follower Stations Desktop/browser pressure command:

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
CHAT_FEDERATION_FOLLOWER_STATION_URLS=http://192.168.31.119:18082,http://192.168.31.119:18083 \
CHAT_FEDERATION_RELAY_URL=http://192.168.31.119:18081 \
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

Observed result:

```text
[OK] authority_peer_id: 12D3KooWBsTpWe6x5Kyueq1fLVewkU6B1dsgMPQYHuseWhERXe5D
[OK] follower_station_1: http://192.168.31.119:18082 peer=12D3KooWPMCXa3uQJf47nmcyZ9sJYs2PJ3u9gY6dgLpPF4paRPp6 gateway=http://127.0.0.1:3132
[OK] follower_station_2: http://192.168.31.119:18083 peer=12D3KooWH7pDSUuERrU3gARjRCbGgRa3t3yh1o1xTESbkPi3p9b1 gateway=http://127.0.0.1:3133
[OK] group: gcg-1783262599893774724
[OK] follower_count: 2
[OK] message_count: 100
[OK] sent_count: 100
[OK] follower_1: actor=344647284492861446 decoded=101 waiting=0 failed=0 first=True last=True frames=62
[OK] follower_2: actor=344647285499494407 decoded=101 waiting=0 failed=0 first=True last=True frames=72
[OK] duration_ms: 28454
[OK] report: /tmp/peers-touch-chat-federated-dom-distinct-followers/chat-federated-desktop-dom-multi-follower-pressure-report.json
```

Report evidence:

- the gate discovered and asserted three distinct Station PeerIDs for authority, follower Station 1, and follower Station 2;
- Relay `relay_mount` had all three Stations online before the run;
- both follower Desktop runtimes decrypted the warmup Sender-Key message from their own follower Station;
- authority Desktop sent `100` Sender-Key encrypted pressure messages;
- follower Station 1 decoded `101` messages including warmup with `waitingCount=0`, `failedCount=0`, `firstFound=true`, `lastFound=true`;
- follower Station 2 decoded `101` messages including warmup with `waitingCount=0`, `failedCount=0`, `firstFound=true`, `lastFound=true`;
- both follower DOMs rendered the last pressure plaintext.

## 7. Product Proven Scope

Evidence supports these claims:

- Station group-chat rejects plaintext sends and stale membership epoch sends.
- Removed group member cannot send after membership epoch advances.
- Group message pagination recovers 1000/1000 encrypted messages for inactive actor backlog.
- Station private-chat recovers 1000/1000 encrypted messages across 50 sessions.
- Private-chat rejects non-participant, invalid receiver, and blocked-user sends.
- Federation proposal/event path handles 1000 message proposals across 3 logical Stations and 2000 follower event deliveries.
- Authority-side `/group-chat/projection/sync` returns cursor-bound group/member/message read projection for follower materialization without exposing plaintext message content.
- Follower-side projection sync now materializes group/member/message rows with upsert-only semantics and no event/outbox side effects.
- Federated key bundle lookup lets the authority Desktop resolve remote follower device bundles via Relay + peer-JWT before sealing SKDM envelopes.
- Live home authority/follower Desktop browser gate proves post-join cross-Station group message decrypt through projection sync, SKDM relay delivery, device-scoped realtime, and local Sender Key install.
- Live home authority/follower repeated Desktop browser gate proves 3 groups and 15 cross-Station encrypted group messages decrypt in the same follower browser runtime.
- Live home authority/follower removed-member negative gate proves post-remove plaintext does not render in the removed follower browser DOM after authority-side removal.
- Live home authority/follower late-join negative gate proves a follower added after encrypted group history exists cannot decrypt/render pre-join plaintext, while post-join plaintext still decrypts.
- Live home authority/follower 1000-message pressure gate proves one authority Station and one follower Station can sync/decrypt/render a 1000-message cross-Station group pressure window through home Relay and Desktop browser runtime without waiting/decrypt placeholders.
- Live bounded multi-follower gate proves one authority Station and one follower Station can serve two follower actors/devices/Desktop browser runtimes in the same federated group pressure window without waiting/decrypt placeholders.
- Live distinct follower Stations gate proves one authority Station can serve two follower actors on two different follower Stations through home Relay and three Desktop browser runtimes without waiting/decrypt placeholders.
- Desktop compile/type surface accepts the current group SKDM/realtime contracts.

## 8. Product Unproven Scope

Evidence does not prove:

- production packaged Desktop app pressure;
- PostgreSQL-backed multi-node recovery;
- mobile/applet chat parity;
- recall/edit/delete user-visible workflow under pressure.

## 9. Review Handoff

Ready for `pt-github-review`: **yes for the proven Foundation scope**. The deployed prerequisite now proves home authority Station, two distinct follower Stations, home Relay, and Desktop gateway binding. The single-message and 3x5 repeated live cross-Station group message/decrypt browser paths are proven, the removed-member live browser negative path is proven, the late-join live browser negative path is proven, the 1000-message live browser pressure path is proven for one authority Station plus one follower Station, bounded two-follower browser runtime pressure is proven on the home follower Station, and distinct follower Stations browser pressure is proven across `18082` and `18083`.

Ready for PR/release evidence packaging: **yes**.

Reviewer should use:

- `tooling/acceptance/reports/latest-quality-evidence.md`
- `docs/context/implementation-reports/FEDERATED_IM_FOUNDATION_PHASE_F_EVIDENCE.zh.md`
- this handoff document
- the two `/tmp/peers-touch-chat-*-pressure-full/*.json` metrics reports

The strongest accurate claim is:

> Foundation IM has evidence for home Station group/private pressure, relay-mediated 3-Station federation protocol pressure, single-message live cross-Station Desktop/browser decrypt, 3x5 repeated live browser runtime decrypt, removed-member live browser negative behavior, late-join live browser negative behavior, 1000-message live browser pressure for one authority Station plus one follower Station, bounded two-follower browser runtime pressure on the home follower Station, and bounded distinct follower Stations browser pressure across `18082` and `18083`.
