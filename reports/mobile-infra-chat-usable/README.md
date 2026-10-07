# Mobile Infra/Chat Architecture Closure

## Verdict

| Field | Value |
|---|---|
| Architecture source closure | `PASS` |
| Product/runtime readiness | `UNPROVEN` |
| GitHub review readiness | `false` |
| Delivery mode | `standalone` |
| Historical evidence source | `f9dd38b6ceddca825945212a717583d274361955` |
| Remediation base | `cf77c9376c111cf1e06e49a812e66b0dc12fc8b1` |

The current source completes the architecture hard cut. It does not claim
current-source runtime Acceptance. Historical Gate artifacts remain immutable
evidence for their exact source only.

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
| Skill checks | `FAIL` - upstream review-rules hash drift (`e51c...` expected, `702d...` current) |
| `git diff --check` | `PASS` |

The stale global Federation `fedp5` Acceptance injection has been removed after
its owning worktree was deleted. Repository-wide structural Acceptance
validation now passes; multi-Station Federation runtime behavior remains
explicitly `UNPROVEN`.

The normal Acceptance plan command reports `PLAN_MOUNT_REQUIRED`, which is
expected for this standalone declaration. The standalone plan self-check
passes.

## Runtime Proof Gap

MICU-03 contains four runtime Scenarios that share expensive services, actors,
clients, devices, storage, or login state:

1. `chat-native-multi-device-e2e`
2. `chat-lifecycle-mixed-client-multi-device-e2e`
3. `mobile-simulator-station-lifecycle-e2e`
4. `station-access-session-class-e2e`

The immutable MICU-03 Task Slice has no `runtimeReuse` declaration. No
`acceptance-suite-runtime-report` binds one Suite Runtime ID, one Fixture
Epoch, lifecycle budgets, attach-only Scenario execution, receiver-visible
proof, and terminal cleanup. Under Acceptance Framework D-21, MICU-03 Task
lifecycle proof is `UNPROVEN`.

The current remediation source did not rerun the complete two-device runtime
Acceptance. Static checks, unit tests, builds, targeted validation, and
historical child Gate results do not substitute for that proof.

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

Current classification: `UNPROVEN` at Task lifecycle level because the
required Suite Runtime contract and current-source report are absent.

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

- current-source product or runtime Acceptance readiness;
- valid MICU-03 Suite Runtime reuse;
- cross-Station or Relay-backed Mobile Chat;
- Android or physical-device behavior;
- live third-party OAuth behavior;
- Agent or Moments readiness; or
- merge, push, or pull-request readiness.
