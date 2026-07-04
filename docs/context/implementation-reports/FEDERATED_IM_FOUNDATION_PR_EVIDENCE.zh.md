# 联邦-Station IM Foundation PR 证据交接

**日期：** 2026-07-05
**范围：** 联邦-Station IM Foundation 本地变更进入 PR/release review 前的 evidence packaging
**结论：** 可进入代码审查；不能声明 live deployed 3-Station runtime 完成

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
- 当前 worktree 仍包含未提交 Phase F delta，包括 pressure gates、federated pressure harness、Phase F evidence bundle。
- 最终 PR 创建前，应在提交所有 Phase F delta 后再次运行 `make quality-evidence REVIEW_RANGE=<base>...<head>`。

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
| live deployed 3-Station browser/runtime pressure | BLOCKED | `home` profile lacks follower Station and Relay config |
| `chat-desktop-dom-message-visible` from standard acceptance plan | NOT RUN in this packaging pass | Requires local Desktop web/gateway runtime; earlier same-home group Sender Key DOM gate evidence exists separately |
| `chat-desktop-gateway-e2e` from standard acceptance plan | NOT RUN in this packaging pass | Requires Desktop HTTP gateway runtime |
| `chat-live-realtime-e2e` from standard acceptance plan | NOT RUN in this packaging pass | Requires fedp5/live realtime environment |
| final PR range quality evidence | PASS | `make review-submit REVIEW_BASE=origin/master` passed after the Phase F delta; PR #39 checks for `pr-title`, `pr-description`, `commitlint`, `review-framework`, and `pr-build` passed on the latest PR head at publication time |

Live 3-Station prerequisite command:

```bash
CHAT_FEDERATION_AUTHORITY_STATION_URL=http://192.168.31.119:18080 \
python3 tooling/acceptance/gates/chat/federated_browser_prereq.py
```

Observed result:

```text
federated browser prereq failed: CHAT_FEDERATION_FOLLOWER_STATION_URL is required
```

## 7. Product Proven Scope

Evidence supports these claims:

- Station group-chat rejects plaintext sends and stale membership epoch sends.
- Removed group member cannot send after membership epoch advances.
- Group message pagination recovers 1000/1000 encrypted messages for inactive actor backlog.
- Station private-chat recovers 1000/1000 encrypted messages across 50 sessions.
- Private-chat rejects non-participant, invalid receiver, and blocked-user sends.
- Federation proposal/event path handles 1000 message proposals across 3 logical Stations and 2000 follower event deliveries.
- Desktop compile/type surface accepts the current group SKDM/realtime contracts.

## 8. Product Unproven Scope

Evidence does not prove:

- live deployed 3-Station Relay runtime;
- live deployed 3-Station browser decrypt experience;
- multi-Station Desktop DOM pressure;
- PostgreSQL-backed multi-node recovery;
- mobile/applet chat parity;
- recall/edit/delete user-visible workflow under pressure.

## 9. Review Handoff

Ready for `pt-github-review`: **yes for the proven Foundation scope**. The remaining merge caveat is not quality evidence; it is the unproven live deployed 3-Station Relay/Desktop/browser runtime because the `home` profile lacks follower Station and Relay configuration.

Ready for PR/release evidence packaging: **yes**.

Reviewer should use:

- `tooling/acceptance/reports/latest-quality-evidence.md`
- `docs/context/implementation-reports/FEDERATED_IM_FOUNDATION_PHASE_F_EVIDENCE.zh.md`
- this handoff document
- the two `/tmp/peers-touch-chat-*-pressure-full/*.json` metrics reports

The strongest accurate claim is:

> Foundation IM has evidence for home Station group/private pressure and relay-mediated 3-Station federation protocol pressure. It is not yet proven for live deployed 3-Station Relay/Desktop/browser runtime.
