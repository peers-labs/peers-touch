# Cross-Station Private Social - Native Desktop Execution Plan

> **Status**: prepared
> **Version**: v2.0
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation
> **Branch**: `feat/social-cross-station-plan`
> **Workspace ID**: `afaaeaca0845c551`
> **Initial HEAD**: `87fff7ae10c0274bbfc4139801c0488461c726cc`

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","status":"prepared","binding":{"branch":"feat/social-cross-station-plan","workspaceId":"afaaeaca0845c551","initialHead":"87fff7ae10c0274bbfc4139801c0488461c726cc"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/cross-station-social/design.md","docs/architecture/cross-station-social/decisions.md","docs/architecture/cross-station-social/data-model.md","docs/architecture/cross-station-social/integration.md","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/api-ownership/decisions.md","docs/architecture/federation/README.md"],"decisions":["CSS-D01..CSS-D08","SC-D05..SC-D09","SC-D13","SC-D17..SC-D20","SC-D29","AO-D05"]},"scope":{"sourceClaims":[{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"model/domain/social","mode":"exclusive-write"},{"pathPrefix":"model/domain/federation/delivery.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/key_exchange/key_exchange.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/secure_content","mode":"shared-read"},{"pathPrefix":"tooling/scripts/proto-gen-secure-content.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/proto-gen-secure-content.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/development/secure_content","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/privatecontent","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/key_exchange","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/social","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/social","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/secure_content","mode":"shared-read"},{"pathPrefix":"apps/mobile/src/gen/proto","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/cross-station-social","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/social","mode":"exclusive-write"},{"pathPrefix":"docs/architecture","mode":"shared-read"}],"nonGoals":["Mobile Native Social implementation or readiness","Browser Social support","public cross-Station feed or discovery","cross-Federation private sharing","CUSTOM_DENY with PUBLIC base","DRM or recipient-copy deletion","a second Social transport or Federation Ledger business data","production release or history rewrite"]},"tasks":[{"id":"CSS-01-acceptance-contract","workstreamId":"CSS-W01","path":"tasks/CSS-01-acceptance-contract.md","dependsOn":[],"status":"pending","blocker":null},{"id":"CSS-02-wire-contracts","workstreamId":"CSS-W02","path":"tasks/CSS-02-wire-contracts.md","dependsOn":["CSS-01-acceptance-contract"],"status":"pending","blocker":null},{"id":"CSS-03-remote-prekeys","workstreamId":"CSS-W02","path":"tasks/CSS-03-remote-prekeys.md","dependsOn":["CSS-02-wire-contracts"],"status":"pending","blocker":null},{"id":"CSS-04-private-delivery","workstreamId":"CSS-W03","path":"tasks/CSS-04-private-delivery.md","dependsOn":["CSS-03-remote-prekeys"],"status":"pending","blocker":null},{"id":"CSS-05-remote-interactions","workstreamId":"CSS-W04","path":"tasks/CSS-05-remote-interactions.md","dependsOn":["CSS-04-private-delivery"],"status":"pending","blocker":null},{"id":"CSS-06-revocation-recovery","workstreamId":"CSS-W05","path":"tasks/CSS-06-revocation-recovery.md","dependsOn":["CSS-05-remote-interactions"],"status":"pending","blocker":null},{"id":"CSS-07-desktop-native","workstreamId":"CSS-W06","path":"tasks/CSS-07-desktop-native.md","dependsOn":["CSS-06-revocation-recovery"],"status":"pending","blocker":null},{"id":"CSS-08-formal-proof","workstreamId":"CSS-W07","path":"tasks/CSS-08-formal-proof.md","dependsOn":["CSS-07-desktop-native"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"cross-station-acceptance-contract":["acceptance-plan-self","acceptance-infra-validation","acceptance-workflow-contract"],"cross-station-wire-contracts":[],"cross-station-prekeys":["station-api-ownership","social-cross-station-contract","social-cross-station-prekey"],"cross-station-private-delivery":["social-cross-station-delivery"],"cross-station-interactions":["social-cross-station-interaction"],"cross-station-revocation-recovery":["social-cross-station-revocation-recovery"],"cross-station-desktop":["social-cross-station-desktop-functional","browser-social-zero-registration"],"cross-station-final-proof":["station-api-ownership","social-cross-station-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]},"completion":["station-api-ownership","social-cross-station-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"],"full":["station-api-ownership","social-cross-station-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]}
```

## 1. Goal And Claim

Deliver private Social between Alice on Station A and Bob on Station B in one
active Federation:

- private Post, image/video, Comment, and Reaction converge;
- both Stations retain ciphertext only;
- Bob reads from his Home Station without Alice being online;
- retry, restart, recovery, delete, friendship loss, and block converge;
- same-Station behavior remains proven;
- Browser has no Social registration and Mobile remains deferred.

## 2. Bound Scope

Primary scope is `SOC-SEC-C09`, `J10..J12`, and `AS17..AS24`. Required
regressions are same-Station `AS01..AS10`, `AS13`, `AS15`, `AS16`, plus Browser
prohibition `AS11`. Historical `AS12` remains pre-cutover evidence only. Public
cross-Station feed/discovery/ranking and Mobile product work are not authorized.

## 3. Current-State Inventory

| Surface | Existing foundation | Gap |
|---|---|---|
| Social private authority | same-Station prepare/submit/read, proofs, objects, recovery | remote recipients are rejected |
| Identity | Home Station and signed endpoint manifest resolution | no gap; regression only |
| Key Exchange | local Content PreKey claim; remote Direct/MLS routes | no remote Content PreKey claim |
| Federation | signed durable outbox/inbox, retry, dedup, typed registry | no private Social payload kinds |
| Social relationship | cross-Station Friend Request and relationship projection | used as prerequisite |
| Objects | source Social ciphertext authority; bounded object contracts | no Social peer ciphertext stream |
| Desktop Native | local encrypt/decrypt, SQLCipher projection, reconcile | no remote pending/source/revoke projection |
| Browser | Moments page and runtime are unconditionally registered | violates platform contract |
| Acceptance | same-Station Desktop suite; negative remote boundary | no positive two-Station Gate |

## 4. Traceability

| Requirement | Product | Architecture | Required evidence |
|---|---|---|---|
| Private publish/read | `C09`, `J10`, `AS17..AS19` | `CSS-D02..D05` | sender/receiver UI, source/receiver ciphertext readback, unauthorized denial |
| Remote interaction | `J11`, `AS20` | `CSS-D02`, `CSS-D06` | prepare/submit/reaction exact replay and two-client convergence |
| Retry/restart | `J10`, `J12`, `AS21`, `AS24` | `CSS-D03`, `CSS-D04` | durable outbox/inbox, duplicate, conflict, restart |
| Revoke/recover | `J11`, `J12`, `AS22`, `AS23` | `CSS-D07` | monotonic tombstone and replacement-device recovery |
| Native-only platform | `C08`, `AS11` | `CSS-D08` | Tauri proof, browser zero registration, Mobile unproven |
| Shared transport | `C09` | `AO-D05`, `CSS-D03` | no second transport or ledger path |

## 5. Workstreams

| Workstream | Responsibility | Task | Parallelism |
|---|---|---|---|
| `CSS-W01` | Acceptance contracts and fail-closed Gate registration | `CSS-01` | first |
| `CSS-W02` | Canonical wire and remote Content PreKey authority | `CSS-02`, `CSS-03` | after W01 |
| `CSS-W03` | Source commit, delivery, receiver projection, object read | `CSS-04` | after W02 |
| `CSS-W04` | Remote Comment/Reaction | `CSS-05` | after W03 |
| `CSS-W05` | Revocation, reconcile, recovery | `CSS-06` | after W04 |
| `CSS-W06` | Native Desktop states and Browser hard cut | `CSS-07` | after W05 |
| `CSS-W07` | Exact-source two-Station proof | `CSS-08` | final |

## 6. Dependency DAG

```text
CSS-01 acceptance contract
  -> CSS-02 wire contracts
      -> CSS-03 remote Content PreKeys
          -> CSS-04 private delivery/object read
              -> CSS-05 interactions
                  -> CSS-06 revoke/recovery
                      -> CSS-07 Native Desktop
                          -> CSS-08 formal proof
```

No implementation workstreams run in parallel: W03-W05 share Social authority
files, and W06 consumes all of their contracts.

## 7. End-To-End Lifecycle Mapping

| Lifecycle step | Owner | Task |
|---|---|---|
| Register product assertions and Gate IDs | Acceptance Social domain | CSS-01 |
| Freeze wire and generated consumers | Proto owners | CSS-02 |
| Resolve locality and claim remote keys | Social + Key Exchange | CSS-03 |
| Encrypt on sender device | Desktop Rust | existing regression, CSS-07 |
| Commit source resource and remote frames | source Social UOW | CSS-04 |
| Verify/dedup and materialize viewer projection | Federation + receiver Social UOW | CSS-04 |
| Read payload and object from Home Station | receiver Social + Desktop | CSS-04, CSS-07 |
| Prepare/submit Comment and mutate Reaction | source Social | CSS-05 |
| Delete/block/friend-loss invalidation | source/receiver Social | CSS-06 |
| Restart/reconcile/recover replacement device | receiver Social + Desktop | CSS-06, CSS-07 |
| Prove full user journey and release resources | Acceptance | CSS-08 |

## 8. Atomic Cutover Matrix

| Concern | New truth | Cutover condition | Old path changed | Zero-reference proof |
|---|---|---|---|---|
| Remote audience | verified locality + remote key claim | CSS-03/04 pass | unconditional remote-recipient rejection | old error reachable only for unsupported scope |
| Delivery | per-actor durable frame | source/receiver UOW failpoints pass | local-only remote intent | no unconsumed remote delivery path |
| Object read | source-authorized peer ciphertext stream | binding negatives pass | direct remote/public fallback absent | route/call scan |
| Interaction | source command/result | exact replay and revoke pass | receiver-local authority absent | call graph and row ownership scan |
| Revocation | source revision + receiver tombstone | stale replay cannot resurrect | event/TTL-only cleanup absent | state transition corpus |
| Browser | native host registration policy | zero-registration Gate passes | unconditional registration | page/runtime/module/action scan |
| Acceptance | positive two-Station feature | `AS17..AS24` proven | negative-only target claim removed | domain validation |

No compatibility shim, dual authority, dual write, or permanent feature flag may
remain.

## 9. Acceptance Scenarios

### AS-17: Remote private publish and read
- **Precondition**: Alice/Bob are friends on two Stations in one Federation.
- **Action**: Alice publishes `FRIENDS` text + image; Bob opens HOME/detail.
- **Expected**: Bob sees exact content; Stations store ciphertext; pending is durable.
- **Failure variant**: identity/key/timeout/cancel before admission preserves the draft; post-admission cancel is refused.
- **Evidence**: client UI, action trace, DB/log scan, frame/proof digests.
- **Status**: pending

### AS-18: Mixed audience completeness
- **Precondition**: local/remote follower, Circle, Group, allow, and deny sets exist.
- **Action**: Alice publishes each supported private audience.
- **Expected**: every selected actor receives exactly once with no extra actor.
- **Failure variant**: unsupported, unresolved, oversized, or conflicting input fails before commit.
- **Evidence**: audience digest, claim receipts, outbox/inbox, zero partial rows.
- **Status**: pending

### AS-19: Unauthorized remote read
- **Precondition**: Eve knows valid Post and object IDs.
- **Action**: Eve requests feed, detail, Comment, object, and recovery.
- **Expected**: uniform denial without payload or recipient metadata.
- **Failure variant**: invalid auth stays typed and never downgrades.
- **Evidence**: wire responses and redacted persistence scan.
- **Status**: pending

### AS-20: Remote Comment and Reaction
- **Precondition**: Bob can read Alice's private Post.
- **Action**: Bob comments/reacts while duplicate and timeout faults are injected.
- **Expected**: source commits once; clients converge; unknown outcome keeps the draft.
- **Failure variant**: delete/revoke/invalid/rate-limit/pre-admission cancel writes nothing.
- **Evidence**: command/result records, source rows, receiver projection, UI.
- **Status**: pending

### AS-21: Outage, retry, and restart
- **Precondition**: Station B becomes unavailable after source commit.
- **Action**: restart dispatcher/Station B, then reconnect both clients.
- **Expected**: one frame materializes one resource; pending becomes accepted.
- **Failure variant**: terminal reject/expiry is visible and creates no duplicate.
- **Evidence**: outbox lease history, inbox receipt, projection count, UI state.
- **Status**: pending

### AS-22: Delete and relationship revocation
- **Precondition**: Bob has read the resource.
- **Action**: Alice deletes, friendship is removed, or either actor blocks.
- **Expected**: Station B converges to a higher tombstone; later access is denied.
- **Failure variant**: stale/reordered delivery remains revoked.
- **Evidence**: ordered frame history, tombstone, denial, cache purge.
- **Status**: pending

### AS-23: Remote device recovery
- **Precondition**: Bob never opened the resource; Bob2 replaces the device.
- **Action**: Bob2 completes trusted recovery after Station B restart.
- **Expected**: Bob2 verifies retained proof and reads authorized content.
- **Failure variant**: wrong phrase/revoked device/expired membership/invalid proof is denied.
- **Evidence**: recovery envelope, proof-key attestation, receiver-visible result.
- **Status**: pending

### AS-24: Integrity and replay corpus
- **Precondition**: valid and mutated frames/commands are available.
- **Action**: deliver duplicate/reordered/expired/conflicted/wrong-target inputs; crash before commit.
- **Expected**: valid transitions commit once; invalid input leaves no partial row.
- **Failure variant**: restart replays the original identity and converges.
- **Evidence**: failpoints, dispositions, row counts, state history.
- **Status**: pending

### AS-11: Browser Social prohibition
- **Precondition**: Browser build and boot registries are available.
- **Action**: inspect and attempt legacy Social navigation/actions.
- **Expected**: no Social page, runtime, module, navigation, or action is registered.
- **Failure variant**: any reachable Social surface fails the Gate.
- **Evidence**: source/build graph and route test.
- **Status**: pending

Together AS-17..AS24 cover every remote readiness, delivery, interaction,
media, integrity, revocation, recovery, and restart transition in the accepted
product state model; AS-11 proves Browser never enters that state machine.

Shared proto generation may update only tracked Mobile generated bindings and
required `build.rs` input registration. Mobile feature/runtime/UI/acceptance
changes and readiness claims are forbidden.

## 10. Verification Matrix

| Layer | Required check |
|---|---|
| Acceptance contract | Social domain validation without `--require-proven`; Gate runner tests |
| Proto | scoped generator apply/check, generator tests, generated diff allowlist |
| Federation | focused Go race tests and payload corpus |
| Key Exchange | focused Go race tests and two-Station exact replay Gate |
| Social | focused Go race tests and source/receiver UOW failpoints |
| Desktop Rust | focused Social tests plus `cargo check` |
| Desktop React | `pnpm --dir apps/desktop run check` and focused Moments tests |
| Mobile generated compatibility | `pnpm --dir apps/mobile run check:web`; no Mobile product diff |
| Browser prohibition | `browser-social-zero-registration` |
| Product proof | exact-source two-Station Native `AS17..AS24` |
| Regression | existing `social-private-desktop-e2e` |

## 11. Risk And Stop Conditions

- Stop with `DESIGN_AMENDMENT_REQUIRED` if remote claim cannot provide exact
  source-plan replay.
- Stop if source resource and all remote outbox frames cannot share one
  transaction boundary.
- Stop if a receiver needs co-recipient identities or envelopes.
- Stop if object read requires a public URL or direct client-to-remote access.
- Stop if recipient Social would become canonical interaction authority.
- Stop with `PRODUCT_AMENDMENT_REQUIRED` if implementation needs Mobile product
  work or a Browser Social surface.
- Stop if any Gate ID is invoked before `CSS-01` registers and tests it.

## 12. Completion

Completion requires:

- all eight tasks are `done`;
- `AS17..AS24` and Browser `AS11` are `PROVEN`;
- existing same-Station Desktop Social remains `PROVEN`;
- Mobile remains explicitly deferred and unproven;
- all old supported-path remote rejection, browser registration, temporary
  clients, processes, fixtures, declarations, and leases are gone;
- plan and acceptance reports bind the exact source checkpoint.

Plan state after document validation: `PLAN_READY_FOR_EXECUTION`. Runtime and
product readiness remain unproven until `CSS-08` completes.
