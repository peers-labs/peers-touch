# 联邦-Station IM Foundation PR 证据交接

**日期：** 2026-07-05
**范围：** 联邦-Station IM Foundation 本地变更进入 PR/release review 前的 evidence packaging
**结论：** 可进入代码审查；已证明 single-message 与 3x5 repeated live cross-Station Desktop/browser decrypt，以及 removed-member live browser negative；不能声明 1000-message live browser pressure 或 late-join live browser negative 完成

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
- PR 更新前应在提交本次 repeated browser-runtime 和 removed-member negative gate delta 后再次运行 `make quality-evidence REVIEW_RANGE=<base>...<head>`。

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
| live deployed 3-Station browser/runtime pressure | PARTIAL | deployed prereq passes for home authority Station, one home follower Station, home Relay, and dual Desktop gateways bound to distinct Stations; single-message and 3x5 repeated projection sync, SKDM relay delivery, follower Desktop install, and browser decrypt passed; removed-member live browser negative passed; 1000-message browser pressure and late-join live browser negative remain unproven |
| `chat-desktop-dom-message-visible` from standard acceptance plan | NOT RUN in this packaging pass | Requires local Desktop web/gateway runtime; earlier same-home group Sender Key DOM gate evidence exists separately |
| `chat-desktop-gateway-e2e` from standard acceptance plan | NOT RUN in this packaging pass | Requires Desktop HTTP gateway runtime |
| `chat-live-realtime-e2e` from standard acceptance plan | NOT RUN in this packaging pass | Requires fedp5/live realtime environment |
| final PR range quality evidence | PASS | `make review-submit REVIEW_BASE=origin/master` passed after the Phase F delta; PR #39 checks for `pr-title`, `pr-description`, `commitlint`, `review-framework`, and `pr-build` passed on the latest PR head at publication time |

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
- Desktop compile/type surface accepts the current group SKDM/realtime contracts.

## 8. Product Unproven Scope

Evidence does not prove:

- 1000-message live deployed browser/runtime pressure;
- late join live browser negative case;
- multi-follower deployed browser runtime pressure beyond one authority and one follower Station;
- PostgreSQL-backed multi-node recovery;
- mobile/applet chat parity;
- recall/edit/delete user-visible workflow under pressure.

## 9. Review Handoff

Ready for `pt-github-review`: **yes for the proven Foundation scope**. The remaining merge caveat is not quality evidence; the deployed prerequisite now proves home authority Station, one follower Station, home Relay, and dual Desktop gateway binding. The single-message and 3x5 repeated live cross-Station group message/decrypt browser paths are proven, and the removed-member live browser negative path is proven. The unproven scope is 1000-message live browser pressure and late-join live browser negative.

Ready for PR/release evidence packaging: **yes**.

Reviewer should use:

- `tooling/acceptance/reports/latest-quality-evidence.md`
- `docs/context/implementation-reports/FEDERATED_IM_FOUNDATION_PHASE_F_EVIDENCE.zh.md`
- this handoff document
- the two `/tmp/peers-touch-chat-*-pressure-full/*.json` metrics reports

The strongest accurate claim is:

> Foundation IM has evidence for home Station group/private pressure, relay-mediated 3-Station federation protocol pressure, single-message live cross-Station Desktop/browser decrypt, 3x5 repeated live browser runtime decrypt, and removed-member live browser negative behavior. It is not yet proven for 1000-message live browser pressure or late-join live browser negative behavior.
