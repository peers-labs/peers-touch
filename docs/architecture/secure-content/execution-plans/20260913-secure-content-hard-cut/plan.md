# Secure Content Hard Cut

> **Status**: active
> **Branch**: feat/federation
> **Workspace ID**: 9eb2cb904c9ae460
> **Initial HEAD**: 2d54851f95994d717928105aca6470c30adf3657

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"SECURE-CONTENT-HARD-CUT-20260913","status":"active","binding":{"branch":"feat/federation","workspaceId":"9eb2cb904c9ae460","initialHead":"2d54851f95994d717928105aca6470c30adf3657"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/secure-content/design.md","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/secure-content/integration.md","docs/architecture/secure-content/operations.md","docs/architecture/acceptance-framework/design.md","docs/architecture/acceptance-framework/decisions.md"],"decisions":["SC-D01","SC-D02","SC-D03","SC-D04","SC-D05","SC-D06","SC-D07","SC-D08","SC-D09","SC-D10","SC-D11","SC-D12","SC-D13","SC-D14","SC-D15","SC-D16","SC-D17","SC-D18","SC-D19","SC-D20","SC-D21","SC-D22","SC-D23","SC-D24","SC-D25","SC-D26","SC-D27","SC-D28","SC-D29","D-21"]},"scope":{"sourceClaims":[{"pathPrefix":".gitignore","mode":"exclusive-write"},{"pathPrefix":"AGENTS.md","mode":"exclusive-write"},{"pathPrefix":"Makefile","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/dev","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"apps/station","mode":"exclusive-write"},{"pathPrefix":"docs/architecture","mode":"exclusive-write"},{"pathPrefix":"docs/global","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"model","mode":"exclusive-write"},{"pathPrefix":"packages","mode":"exclusive-write"},{"pathPrefix":"tooling","mode":"exclusive-write"}],"nonGoals":["Mobile private Social product delivery","Browser private Social product delivery","Chat or Conversation product implementation and runtime verification","production release, FINAL_CUT, push, pull request, or history rewrite"]},"tasks":[{"id":"W0","workstreamId":"W0","path":"tasks/W0.md","dependsOn":[],"status":"done","blocker":null},{"id":"W0R","workstreamId":"W0R","path":"tasks/W0R.md","dependsOn":["W0"],"status":"done","blocker":null},{"id":"W14","workstreamId":"FOUNDATION","path":"tasks/W14.md","dependsOn":["W0"],"status":"done","blocker":null},{"id":"W1","workstreamId":"FOUNDATION","path":"tasks/W1.md","dependsOn":["W14"],"status":"done","blocker":null},{"id":"W3","workstreamId":"W3","path":"tasks/W3.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W4","workstreamId":"W4","path":"tasks/W4.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W5","workstreamId":"W5","path":"tasks/W5.md","dependsOn":["W3"],"status":"done","blocker":null},{"id":"W6","workstreamId":"W6","path":"tasks/W6.md","dependsOn":["W4","W5"],"status":"done","blocker":null},{"id":"W7A","workstreamId":"W7A","path":"tasks/W7A.md","dependsOn":["W3","W5"],"status":"done","blocker":null},{"id":"W7S","workstreamId":"W7","path":"tasks/W7S.md","dependsOn":["W6","W7A"],"status":"done","blocker":null},{"id":"W7R","workstreamId":"W7","path":"tasks/W7R.md","dependsOn":["W0R","W7S"],"status":"done","blocker":null},{"id":"W12E","workstreamId":"W12E","path":"tasks/W12E.md","dependsOn":["W7R"],"status":"done","blocker":null},{"id":"W12S","workstreamId":"W12S","path":"tasks/W12S.md","dependsOn":["W12E"],"status":"done","blocker":null},{"id":"W12A","workstreamId":"W12A","path":"tasks/W12A.md","dependsOn":["W12S"],"status":"done","blocker":null},{"id":"W12C","workstreamId":"W12C","path":"tasks/W12C.md","dependsOn":["W12A"],"status":"in_progress","blocker":null},{"id":"W12D","workstreamId":"W12D","path":"tasks/W12D.md","dependsOn":["W12C"],"status":"pending","blocker":null},{"id":"W7","workstreamId":"W7","path":"tasks/W7.md","dependsOn":["W7S","W7R","W12D"],"status":"pending","blocker":null},{"id":"W8","workstreamId":"W8","path":"tasks/W8.md","dependsOn":["W7"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":["station-four-social-private","station-five-arm-social-private"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"w0-governance":[],"w0r-runtime-control":[],"w14-generator":[],"w1-contracts":[],"w3-prekeys":[],"w4-auth":[],"w5-recovery":[],"w6-social-minimum":[],"w7a-prekey-client":[],"w7s-desktop-source":[],"w7r-runtime-owner":[],"w12e-acceptance-suite-infra":[],"w12s-secure-content-suite-injection":[],"w12a-mobile-foundation":[],"w12c-runtime-owners":[],"w12d-schema-activation":[],"w7-functional":[],"w8-closure":[]},"completion":[],"full":[]}
```

## Goal

Deliver a development-usable E2EE private Social experience on Desktop Native.
The milestone covers exact-source Desktop runtime behavior against the approved
`four` and `fiveArm` Stations while Social retains its own route, transaction,
table, grant, and object authority.

## Desktop Usability Scope

In scope:

- Desktop Native private Social publish, receive, restart, recovery, Comment,
  subtype, object, audience, delete/block, and bounds behavior;
- the shared Secure Content source and runtime-owner checks required by those
  Desktop Journeys;
- canonical private schema activation on `four` and `fiveArm`;
- receiver-visible WebDriver evidence from the Desktop product surface.

Explicit non-goals for the remaining milestone:

- Browser private Social delivery;
- iOS or Android product delivery;
- Chat or Conversation product implementation and runtime verification;
- `FINAL_CUT`, formal release Acceptance, push, pull request, merge, or history
  rewrite.

The terminal claim is `DESKTOP_DEVELOPMENT_USABLE`. It is not a production
release or cross-platform `PROVEN` claim.

## Current Snapshot

- W8 exposed that child PASS results were published before receiver-visible UI
  proof and final Suite cleanup.
- Source invalidation proof `cdc3a66a...` reopened the source owner without
  rewriting prior evidence.
- Checkpoint `8250f13ac` stages W8 child results outside aggregate-visible paths
  and publishes the complete generation only after UI proof and cleanup.
- W12A replay passed and closed at Plan checkpoint `c465561c1`.
- The Owner narrowed the remaining milestone to Desktop Native Social. The
  active graph now contains `18` Tasks, `14` done and `4` remaining.

## Workflow Dependency

The Development Workflow control plane remains authoritative for Git,
declarations, Sessions, Plan lifecycle, active-work, runtime manifests, and
resource cleanup. Formal cross-platform Acceptance is outside this milestone.

## Dependency And Cutover

```text
W12A complete
  -> W12C: Desktop runtime owner and transactional result publication
  -> W12D: source freeze + serial SCHEMA_ACTIVATION on four/fiveArm
  -> W7: Desktop Native restart and continuity
  -> W8: Desktop Native Social expansion
  -> DESKTOP_DEVELOPMENT_USABLE
```

| Concern | Required closure |
|---|---|
| Source identity | W12C checks pass and W12D publishes one immutable source generation |
| Schema | `four` and `fiveArm` complete fresh serial `SCHEMA_ACTIVATION` runs |
| Desktop continuity | W7 proves native publish/read, restart, recovery, and receiver-visible state |
| Social semantics | W8 proves audience, Comment, subtype, object, delete/block, and bounds |
| Explicit non-claim | Browser, Mobile, Chat, FINAL_CUT, and formal release Acceptance remain unproven |

## Source-Drift Reactivation

W7 and W8 own functional evidence only. If either exposes an actionable source
defect, no code edit is legal under that functional declaration.

## Source Invalidation Policy

```json
{"kind":"peers-touch-source-invalidation-policy","sourceOwnerTaskId":"W12C","rootTaskIds":["W12D"]}
```

The owner must quiesce the failed Session and runtime resources, release its
declaration, invoke `planctl invalidate-source`, and replay W12C/W12D/W7/W8 on
a fresh exact-source generation before claiming Desktop usability.

## Evidence Closure

- W12D source freeze: `development/secure-content/W12A/source/<generation>/result.json`.
- W12D activation children:
  `development/secure-content/W12A/activation/<generation>/<profile>/<reset-id>/`.
- W12D activation aggregate:
  `development/secure-content/W12A/activation/<generation>/aggregate/result.json`.
- W7 Desktop result:
  `development/secure-content/W7/<generation>/desktop/<run-id>/result.json`.
- W8 Desktop Social results:
  `development/secure-content/W8/<generation>/<variant>/<suite-id>/result.json`.

W8 child results remain owner-private until all six receiver-visible assertions,
final cleanup, and Suite report validation succeed. The complete generation is
then published atomically. Failed retries never create aggregate-visible partial
or duplicate child sets.

## Declaration Projection

| Work-item projection | Bound Plan task | Runtime authority |
|---|---|---|
| `W12C` | `W12C` | Desktop runtime-owner implementation and source checks only |
| `W12D` | `W12D` | source freeze and activation aggregate |
| `W12A-FOUR` | `W12D` | `four` plus `station-four-social-private` only |
| `W12A-FIVEARM` | `W12D` | `fiveArm` plus `station-five-arm-social-private` only |
| `W7` | `W7` | Desktop Native continuity runtime only |
| `W8` | `W8` | Desktop Native Social expansion runtime only |

## Execution Order

1. Complete W12C Desktop runtime-owner checks and add the Desktop-only W7 Suite
   entry.
2. Run W12D Desktop Social source matrix once, freeze one generation, then
   activate `four` and `fiveArm` serially.
3. Run W7 Desktop Native continuity on that exact generation.
4. Run W8's six Desktop Native Social scenarios on the same generation.
5. Record `DESKTOP_DEVELOPMENT_USABLE`, release all resources, and close the
   Plan. No Browser, Mobile, Chat, FINAL_CUT, or formal Acceptance work follows.

## Runtime Reuse Model

- W12D owns the immutable source generation and only Station deployment per
  profile; W7 and W8 attest and attach.
- W7 and W8 each own one Suite Runtime. Accounts, Desktop clients, storage,
  login, service attestations, and one Fixture Epoch are provisioned once.
- Scenarios are attach-only. Cleanup occurs after receiver-visible evidence.
- Only immutable artifacts and the exact deployment generation cross Task
  boundaries.

## Concurrency Decision

- W12C, W12D, W7, and W8 execute serially because they share source generation,
  Station profiles, Desktop storage, Fixture state, and Plan lifecycle.
- W12D activation is serial across `four` and `fiveArm` with independent reset
  declarations and leases.
- No Browser, Mobile, or Chat runtime lane may be scheduled.

## Completion

- W12C, W12D, W7, and W8 reach `done`.
- W7 and W8 record current exact-source `FUNCTIONAL_CHECK/PASS` from Desktop
  Native receiver-visible Journeys.
- Both Station activations and every runtime cleanup complete with no retained
  lease or process.
- The Plan records `DESKTOP_DEVELOPMENT_USABLE` and explicitly does not claim
  Browser, Mobile, Chat, production release, or formal Acceptance readiness.
