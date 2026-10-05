# MCA-D26 Connector Execution Evidence Amendment

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-21 | **Updated**: 2026-09-21
> **Owner**: Peers-Touch Agent Team
> **Module**: `tooling/acceptance/`, `apps/station/app/subserver/agent/`,
> `apps/desktop/`, `apps/mobile/`

---

## 1. Scope

This amendment resolves two contradictions in the V2-J05 formal evidence
contract while preserving all 37 reviewed Connector tuples:

- Connector resource effects execute at the credential-owning client
  capability bridge, while Station owns manifest, binding, ToolCall, decision,
  result, and replay truth.
- Connector outcomes rejected before dispatch cannot emit an executor receipt
  and therefore require explicit zero-execution evidence.

It does not move OAuth credentials into Station, add a second Connector
execution path, remove a reviewed cell, or change MCA-A08 ownership of
`PROVEN` promotion.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| OAuth tokens and resource execution remain in the OAuth owner | `verified_fact` | `apps/desktop/src-tauri/src/application/oauth2/mod.rs`; MCA-D17 | high | Exact-source tuple |
| Connector manifests currently declare `CLIENT_CAPABILITY` execution | `verified_fact` | `ConnectorManifestService.buildConnectorProjection` | high | None |
| Browser runtime advertises only Connector client capabilities | `verified_fact` | `desktop_executor_worker/supervisor.rs` tests | high | Exact-source Browser tuple |
| `ERR-CON01` through `ERR-CON04` reject before dispatch | `accepted_decision` | V2 execution contract error matrix | high | Exact-source tuples |
| `R-06/A` and `R-07/A` commit disconnect/delete before dispatch | `accepted_decision` | MCA-D23 race contract | high | Exact-source tuples |
| The current J05 matrix requires Station-executor attestation for every runtime tuple and has no `zero-execution` role | `verified_fact` | Agent V2 runtime matrix and proof contract | high | None |

## 3. Decision

### MCA-D26: Connector Evidence Follows OAuth-Owner Execution

Executed Desktop and Browser Connector tuples use
`client_capability_turn`. Their attestation binds the actual capability
session, device, lease, ToolCall, fence, and terminal receipt emitted by the
OAuth-owning client executor.

The following tuples terminate before executor dispatch and use
`station_turn` plus `zero-execution`:

- `ERR-CON01` through `ERR-CON04`;
- `R-06` ordering `A`;
- `R-07` ordering `A`.

`AS-06`, `R-06/B`, and `R-07/B` remain executed Connector tuples.

Browser initiation does not create a Station executor or copy OAuth secrets.
It uses the Browser runtime's credential-owning capability session. If that
session is unavailable, readiness fails closed.

Provider revocation remains a separate terminal fact. The provider adapter's
observed `unconfirmed` result is represented by the formal
`revocation_unconfirmed` state without changing the observed provider value.

## 4. Ownership And Invariants

| Concern | Owner |
|---|---|
| OAuth credentials and resource effect | OAuth-owning client capability executor |
| Resource manifest, binding, readiness, ToolCall, decision, result, and replay | Station |
| Reviewed Connector failure-state setup | Station scenario controller through canonical Connector services |
| Provider revoke result | OAuth subsystem/provider adapter |
| Receiver observation | Desktop Harness |
| Mobile compatibility | Mobile generated-protobuf contract test |
| Tuple applicability and assembly | Reviewed matrix and shared Agent V2 candidate producer |

Invariants:

1. Station never receives or persists OAuth credentials.
2. A client executor is never represented as a Station executor.
3. A pre-dispatch outcome never receives a fabricated receipt.
4. Every tuple has a fresh scenario execution ID and primary Turn identity.
5. Provider `unconfirmed` remains visible while the formal terminal status is
   `revocation_unconfirmed`.
6. Matrix tuple count remains exactly 37.

## 5. Alternatives

- Move OAuth credentials into Station: rejected because it changes the
  accepted secret boundary and duplicates the OAuth owner.
- Label the existing client executor as Station: rejected as false evidence.
- Fabricate receipts for rejected-before-dispatch outcomes: rejected because
  no executor ran.
- Remove failure or race tuples: rejected because it weakens accepted scope.

## 6. Architecture Gates

1. The matrix expands to exactly 37 unique J05 tuples.
2. Executed rows require `client_capability_turn`; pre-dispatch rows require
   `station_turn` and `zero-execution`.
3. Desktop and Browser evidence binds a real OAuth-owner capability session.
4. `ERR-CON01` through `ERR-CON04`, `R-06/A`, and `R-07/A` prove zero dispatch.
5. Every role set exactly matches its row policy.
6. Candidate assembly and semantic validation pass on one exact source.

The Owner delegated approval authority and accepted MCA-D26 on 2026-09-21.
