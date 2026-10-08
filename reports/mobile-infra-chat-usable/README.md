# Mobile Infra/Chat Architecture Closure

## Verdict

| Field | Value |
|---|---|
| Architecture source closure | `PASS` |
| Product/runtime readiness | `PROVEN` for the MICU-03 / SAL-J06 scope |
| GitHub review readiness | `true` |
| Delivery mode | `tracked local delivery; push and PR denied by Plan` |
| Formal proof source | `b0e6911a0af0a815867659cf00671be5d3bda370` |
| Remediation base | `cf77c9376c111cf1e06e49a812e66b0dc12fc8b1` |

The architecture hard cut and current-source MICU-03 Session-class Suite are
complete. Historical Gate artifacts remain immutable evidence for their exact
source only.

## Architecture Closure

The current source:

- makes Session takeover validation, binding transfer, revocation, and
  replacement activation one actor-locked transaction;
- removes the unused generic Session creation path and the pre-read takeover
  helper;
- separates duplicate-key command conflict from retryable PostgreSQL
  serialization and deadlock failures;
- hard-cuts Mobile OAuth Station responses to `application/protobuf`;
- requires context-enabled Python Gates to run in an isolated virtual
  environment with system packages disabled;
- replaces reset environment flags with an exact live `station.reset` lease
  verified through the Local Dev control plane;
- removes retired Friend Chat and Group Chat proto contracts, generated
  clients, Desktop local-store and application owners, Mobile Group store and
  gateway owners, stale tests, and stale Acceptance declarations;
- makes Conversation and Envelope the only live Chat contract;
- makes Messaging the only Mobile owner of conversation, message, settings,
  and Group command-outcome projection state;
- limits Social ingress to Social, Moments, Notification, and Profile events;
- retains Group command pending, uncertain, and failed UI states without
  restoring a parallel Group store;
- updates the governing Desktop, Mobile, Social runtime, Chat lifecycle, and
  component-tree documents to the hard-cut architecture; and
- makes the Chat zero-reference Gate scan the canonical inventory plus active
  Acceptance feature, Gate, and registry declarations.

No compatibility shim, fallback owner, dual write, or zero-reference exemption
was introduced.

## Verification

| Evidence | Result |
|---|---|
| Mobile full Vitest suite | `PASS` - 96 files, 712 tests |
| Mobile final focused suite | `PASS` - 6 files, 36 tests |
| Mobile TypeScript | `PASS` |
| Mobile Vite build | `PASS` |
| Mobile Rust offline check | `PASS` |
| Mobile iOS project check | `PASS` |
| Desktop Vitest suite | `PASS` - 1074 tests |
| Desktop check and build | `PASS` |
| Station Go and package checks | `PASS` |
| Standard proto regeneration | `PASS` - generated hash unchanged |
| Chat zero-reference Gate | `PASS` - 9 inventories, 8587 scanned references |
| Zero-reference unit tests | `PASS` - 9 tests |
| Frontend runtime registry | `PASS` |
| Targeted Acceptance validation: infra/chat/mobile | `PASS` |
| Acceptance coverage report generation | `PASS` |
| Standalone Acceptance plan self-check | `PASS` |
| Hard rules | `PASS` |
| Skill checks | `PASS` |
| Code structure review | `PASS` - no findings |
| MICU-03 Gap Detector | `PROVEN` - no gaps |
| Development Session-class Suite | `PASS` - 4/4 Scenarios |
| Formal Session-class Suite Acceptance | `PASS / DONE / PROVEN` |
| Suite Runtime audit | `PASS` - 1 provision, 5 launches, 0.75 warm reuse |
| Runtime cleanup | `PASS` - clients, Appium, ports, storage, Fixture and leases released |
| `git diff --check` | `PASS` |

The stale global Federation `fedp5` Acceptance injection has been removed after
its owning worktree was deleted. Repository-wide structural Acceptance
validation now passes; multi-Station Federation runtime behavior remains
explicitly `UNPROVEN`.

The current work uses tracked Plan
`mobile-infra-chat-suite-closure-20261007`; its closure selects only
`station-access-session-class-suite-e2e`.

## Runtime Suite Closure

The current MICU-03 Suite runs four ordered Scenarios in one runtime:

1. `same-station-chat`
2. `cross-class-coexistence`
3. `desktop-takeover`
4. `mobile-takeover`

The Suite Runtime contract and audit both pass:

- Suite Runtime ID: `17f44ad041297fe3`
- Fixture Epoch: `20261007T151740934218Z-37748a6c3065788f4a6f8afe3d095d6d`
- Provisioning runs: `1`
- Client launches: `5`
- Completed Scenarios: `4`
- Warm reuse rate: `0.75`
- Final lifecycle event: `cleanup-complete`

The Desktop takeover Scenario includes one bounded Mobile runtime-graph
recovery only when the Session is valid, write admission is open, and the
visible route reports a pure `deferred-capability` failure. Persistent or mixed
recovery states still fail closed. The Mobile takeover Scenario follows the
accepted SAL-J06 boundary: it proves predecessor Mobile revocation and
receiver-visible continuity on the surviving Desktop, without inventing a
requirement that a fresh Mobile installation already owns historical local
Conversation projection.

### Current Formal Evidence

```json
{
  "artifactKind": "acceptance-artifact-ref",
  "gateId": "acceptance-run",
  "runId": "20261007T151740787164Z-f6fa440ad7d7b3dbb74ea8dccf1c357f",
  "path": "reports/run.json",
  "sha256": "f5418341e847db501593c69522a8c4a0ab33d77918714a89de3765dc45b367e9",
  "workspaceId": "293b40f94701d443"
}
```

Child Gate report:

```json
{
  "gateId": "station-access-session-class-suite-e2e",
  "runId": "20261007T151740934218Z-37748a6c3065788f4a6f8afe3d095d6d",
  "path": "reports/station-access-session-class-suite-e2e.json",
  "sha256": "2c6f7d36a48cb3e0f8a03851f95a79aa7897d9b5fa3a91eb6029e35cef721bcc"
}
```

Suite Runtime report:

```json
{
  "gateId": "station-access-session-class-suite-e2e",
  "runId": "20261007T151740934218Z-37748a6c3065788f4a6f8afe3d095d6d",
  "path": "evidence/station-access-session-class-suite-e2e-suite-runtime.json",
  "sha256": "6b4726973c04819ebade337bba2966df202b4fc92120faf68c89381dd201edb5"
}
```

## Immutable Historical Evidence

### MICU-02 Aggregate

```json
{
  "artifactKind": "acceptance-artifact-ref",
  "gateId": "acceptance-run",
  "runId": "20261006T193437111354Z-e4c616161ad377e92ee70abf0be48292",
  "path": "reports/run.json",
  "sha256": "3b91fac72c346cab41ac97a25b10ed8869d6e767c1f21ec88ae54d98ca680bd5",
  "workspaceId": "293b40f94701d443"
}
```

### MICU-03 Aggregate

Historical manifest status: `passed / PROVEN / DONE`.

Current classification: historical regression evidence only. The current
authoritative proof is the Suite run recorded above.

```json
{
  "artifactKind": "acceptance-artifact-ref",
  "gateId": "acceptance-run",
  "runId": "20261006T190038910609Z-a32cc677473d8c30e70d795ca078d6ec",
  "path": "reports/run.json",
  "sha256": "f8652d6ddc0d33988ff3396e3de4e7c28adac028819b317f6ab80b85016c4ab6",
  "workspaceId": "293b40f94701d443"
}
```

### Child Gate ArtifactRefs

| Gate | Run | Path | SHA-256 |
|---|---|---|---|
| `mobile-simulator-chat-contacts-e2e` | `20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8` | `mobile-simulator-social/chat-contacts/result.json` | `b8e38c9bb7d3e36ca1c7d1f6416ae6b378c7c99d54e6c1ece3f06b22b99ff282` |
| `chat-lifecycle-mixed-client-same-station-e2e` | `20261006T193714061619Z-abced611e03ab54df4cfcb9690c805ea` | `reports/chat-lifecycle-mixed-client-same-station-e2e.json` | `c9deb57ab5fdba73b27f0ad9be10aa1832370a23454c53857325f42b37acf137` |
| `chat-native-multi-device-e2e` | `20261006T190039051530Z-610afe0b04e6a67eb02d6a7bc4bae9c3` | `reports/chat-native-multi-device-e2e.json` | `1e7f8cf2d6d96d904b04b45433bf051364e96e2e2b38feeecb64a537b6d12520` |
| `chat-lifecycle-mixed-client-multi-device-e2e` | `20261006T190300091353Z-91fc36beaff8563271ac7da49ab2fbfc` | `reports/chat-lifecycle-mixed-client-multi-device-e2e.json` | `62428075a8d34ee879d2bf012be259aa98d6a8e4dc06f6e091b0c5c511d76fc4` |
| `mobile-simulator-station-lifecycle-e2e` | `20261006T190537444070Z-8c121ce871d2fe3f43aabf791d6391ca` | `mobile-station-lifecycle/result.json` | `2881f537760be37fcca8ac5774690e729cf642fe97b05ca6723e5b4c269f2099` |
| `station-access-session-class-e2e` | `20261006T190709169995Z-2c6c722a6e4622124a6f76c28c0b2a36` | `logs/station-access-session-class-e2e.log` | `72d697e3da7657bd7720d38c967699b2ea1dd4631de4f745878fe0a743cee5c2` |

## Non-Claims

This report does not claim:

- cross-Station or Relay-backed Mobile Chat;
- Android or physical-device behavior;
- live third-party OAuth behavior;
- Agent or Moments readiness; or
- Linux or Windows Desktop behavior.

No push or pull request was performed.
