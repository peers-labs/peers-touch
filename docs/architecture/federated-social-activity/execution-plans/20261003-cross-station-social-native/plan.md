# Cross-Station Social Native Desktop

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation
> **Branch**: `feat/social-cross-station-plan`
> **Workspace ID**: `afaaeaca0845c551`
> **Initial HEAD**: `4eccc1ff6637fdda5954f5b9ab776d91c3170728`

## Plan Package
```json
{"kind":"peers-touch-plan-package","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","status":"draft","binding":{"branch":"feat/social-cross-station-plan","workspaceId":"afaaeaca0845c551","initialHead":"4eccc1ff6637fdda5954f5b9ab776d91c3170728"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/federated-social-activity/design.md","docs/architecture/federated-social-activity/decisions.md","docs/architecture/federated-social-activity/data-model.md","docs/architecture/federated-social-activity/integration.md","docs/architecture/secure-content/README.md","docs/architecture/federation/README.md","docs/architecture/api-ownership/README.md"],"decisions":["FHSA-D08","FHSA-D09","FHSA-D10","FHSA-D11","FHSA-D12","FHSA-D13","FHSA-D14","FHSA-D15","SC-D29","D-07","AO-D05"]},"scope":{"sourceClaims":[{"pathPrefix":"model/domain/social","mode":"exclusive-write"},{"pathPrefix":"model/domain/federation/delivery.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/key_exchange/key_exchange.proto","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/key_exchange","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/social","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/social","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/services/privateMomentsNative.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/store/privateMoments.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/runtimes/momentsRuntime.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/pages/moments","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/pages/registry.ts","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/development/secure_content","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/social","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/federated-social-activity","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/secure-content","mode":"shared-read"},{"pathPrefix":"docs/architecture/federation","mode":"shared-read"},{"pathPrefix":"apps/mobile","mode":"shared-read"}],"nonGoals":["Mobile Native Social implementation or readiness","Browser Social page/runtime/action support","cross-Federation private sharing","CUSTOM_DENY(PUBLIC)","ActivityPub private payload transport","Agent/A2A/Applet social","DRM or deletion of malicious recipient copies","production release, push, pull request, or history rewrite"]},"tasks":[{"id":"CSN-01-contracts","workstreamId":"CSN-W01","path":"tasks/CSN-01-contracts.md","dependsOn":[],"status":"pending","blocker":null},{"id":"CSN-02-remote-prekeys","workstreamId":"CSN-W01","path":"tasks/CSN-02-remote-prekeys.md","dependsOn":["CSN-01-contracts"],"status":"pending","blocker":null},{"id":"CSN-03-private-delivery","workstreamId":"CSN-W03","path":"tasks/CSN-03-private-delivery.md","dependsOn":["CSN-01-contracts","CSN-02-remote-prekeys"],"status":"pending","blocker":null},{"id":"CSN-04-remote-interactions","workstreamId":"CSN-W04","path":"tasks/CSN-04-remote-interactions.md","dependsOn":["CSN-03-private-delivery"],"status":"pending","blocker":null},{"id":"CSN-05-revocation-recovery","workstreamId":"CSN-W05","path":"tasks/CSN-05-revocation-recovery.md","dependsOn":["CSN-03-private-delivery"],"status":"pending","blocker":null},{"id":"CSN-06-desktop-native","workstreamId":"CSN-W06","path":"tasks/CSN-06-desktop-native.md","dependsOn":["CSN-04-remote-interactions","CSN-05-revocation-recovery"],"status":"pending","blocker":null},{"id":"CSN-07-formal-proof","workstreamId":"CSN-W07","path":"tasks/CSN-07-formal-proof.md","dependsOn":["CSN-06-desktop-native"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution
```json
{"closures":{"cross-station-contracts":[],"cross-station-prekeys":[],"cross-station-private-delivery":[],"cross-station-interactions":[],"cross-station-revocation-recovery":[],"cross-station-desktop":[],"cross-station-final-proof":["proto-build","station-api-ownership","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]},"completion":["proto-build","station-api-ownership","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"],"full":["proto-build","station-api-ownership","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]}
```

## 1. Goal
Deliver product-usable Human Social across two real Stations on Native Desktop:

- public and private Moments arrive through one coherent HOME/Federated
  projection;
- private Post, Comment, Reaction and Attachment remain end-to-end encrypted;
- source Social remains the single business authority;
- recipient Home Station provides durable offline projection and recovery;
- outage, duplicate, restart, delete and block converge without duplicate or
  resurrected content;
- Browser Social is absent and Mobile remains explicitly deferred.

The completion claim is `SOCIAL_CROSS_STATION_DESKTOP_PROVEN`.

## 2. Plan Source
Accepted product source:

- `docs/architecture/social/product-definition.md` v1.2
- `docs/architecture/social/experience-contract.md` v1.2
- `docs/architecture/social/product-state-model.md` v1.2
- `docs/architecture/social/acceptance-matrix.md` v1.2

Architecture proposed for owner review:

- `docs/architecture/federated-social-activity/design.md` v0.3
- `docs/architecture/federated-social-activity/decisions.md`
  `FHSA-D08..FHSA-D15`
- `docs/architecture/federated-social-activity/data-model.md` v0.3
- `docs/architecture/federated-social-activity/integration.md` v0.3

Implementation must not start until the architecture decisions and this plan
are approved. Approval changes both statuses to `active`.

## 3. Current-State Inventory
| Surface | Existing foundation | Gap |
|---|---|---|
| Social private authority | Same-Station prepare/submit/read, grants, envelopes, object and recovery UOW | explicit remote-recipient rejection |
| Actor Identity | Home Station resolution and signed remote endpoint manifests | none for locality; use as-is |
| Key Exchange | local Content PreKey publish/inventory/claim; remote Direct/MLS peer routes | no remote Content PreKey inventory/claim |
| Federation transport | shared signed durable outbox/inbox, retry, dedup and receiver registry | no private Social payload kinds |
| Social federation | cross-Station Friend Request and relationship events | no private resource/interaction receiver |
| Object transfer | source Social encrypted object authority; Conversation peer-stream pattern | no Social private object peer stream |
| Desktop Native | private encryption/decryption, SQLCipher projection, runtime reconcile | no remote pending/source identity/invalidation projection |
| Browser | Moments page/runtime currently registered in desktop-web | must be removed or compile-time denied |
| Acceptance | same-Station Desktop 14/14 proven; old remote rejection proven | no positive two-Station private Social Gate |

## 4. Traceability

| Requirement | Product | Architecture | Evidence |
|---|---|---|---|
| Cross-Station private publish/read | `C09`, `J10`, `SOC-SEC-AS17`, `SOC-SEC-AS18`, `SOC-SEC-AS19` | `FHSA-D09..D12` | two-Station receiver plaintext plus source/receiver ciphertext readback |
| Remote interaction | `J11`, `SOC-SEC-AS20` | `FHSA-D13` | source-authority command/result and two-client projection |
| Retry and restart | `J10`, `J12`, `SOC-SEC-AS21`, `SOC-SEC-AS24` | `FHSA-D10`, `FHSA-D11` | outbox/inbox lease, duplicate, reorder and restart evidence |
| Revocation and recovery | `J11`, `J12`, `SOC-SEC-AS22`, `SOC-SEC-AS23` | `FHSA-D14` | source revision, receiver tombstone and Bob2 recovery |
| Native-only platform boundary | `C08`, `AS11`, `AS14` | `FHSA-D08`, `FHSA-D15` | Desktop Native Gate, Mobile unproven, Browser zero registration |

## 5. Workstreams

| Workstream | Responsibility | Tasks | Parallelism |
|---|---|---|---|
| `CSN-W01` | Canonical contracts and remote Content PreKey authority | `CSN-01`, `CSN-02` | first, then functional successor |
| `CSN-W03` | Source commit, Federation delivery, receiver projection and object stream | `CSN-03` | after W01/W02 |
| `CSN-W04` | Remote Comment/Reaction commands and results | `CSN-04` | parallel with W05 after W03 |
| `CSN-W05` | Delete/block/friend-loss invalidation and recovery | `CSN-05` | parallel with W04 after W03 |
| `CSN-W06` | Desktop Native projection and Browser hard cut | `CSN-06` | after W04/W05 |
| `CSN-W07` | Exact-source two-Station Acceptance | `CSN-07` | final |

## 6. Dependency DAG

```text
CSN-01 contracts
  -> CSN-02 remote Content PreKeys
      -> CSN-03 private resource delivery
          -> CSN-04 remote interactions ─┐
          -> CSN-05 revoke/recovery ─────┤
                                        -> CSN-06 Desktop Native + Browser hard cut
                                            -> CSN-07 formal proof
                                                -> SOCIAL_CROSS_STATION_DESKTOP_PROVEN
```

## 7. End-To-End Lifecycle Mapping

| Lifecycle step | Owner | Task |
|---|---|---|
| Select mixed local/remote audience | Social product + Desktop | CSN-01, CSN-06 |
| Freeze relationship/Circle/Group snapshot and localities | source Social | CSN-03 |
| Fetch signed endpoint manifests | Actor Identity through Federation | existing, regression in CSN-02 |
| Claim endpoint/recovery PreKeys by Home Station | Key Exchange | CSN-02 |
| Encrypt on sender device | Desktop Rust + secure-content-core | existing, regression in CSN-06 |
| Commit source resource and remote frames | source Social UOW | CSN-03 |
| Retry/dedup/verify frame | shared Federation delivery | CSN-03 |
| Materialize viewer projection | recipient Social UOW | CSN-03 |
| Render/decrypt HOME/detail | Desktop momentsRuntime | CSN-06 |
| Fetch encrypted object range | recipient Social -> Federation -> source Social | CSN-03, CSN-06 |
| Comment/reaction | recipient Social command -> source Social authority | CSN-04 |
| Delete/block/friend loss | source revision + invalidation; local suppression | CSN-05 |
| Restart/reconcile/recovery | recipient Social + Desktop Native | CSN-05, CSN-06 |

## 8. Atomic Cutovers

| Concern | New truth | Cutover condition | Old path deleted/changed | Zero-reference proof |
|---|---|---|---|---|
| Remote audience admission | verified locality + remote PreKey coordinator | CSN-02/03 source and receiver tests pass | unconditional remote-recipient rejection | search for v1 locality error text and old negative-only branch |
| Remote delivery | recipient-scoped Federation frame | source UOW + receiver UOW failpoints pass | Social delivery intents that never leave source Station | no unconsumed remote delivery intent path |
| Remote object read | Social peer ciphertext stream | actor/device/object/range negatives pass | direct remote URL or public ciphertext fallback | route/call scan |
| Remote interactions | source-authority command/result | exact replay and parent revalidation pass | receiver-local authoritative interaction write | repository call graph scan |
| Revocation | monotonic invalidation projection | delete/block/outage/restart scenarios pass | TTL-only or event-only cleanup | stale-revision resurrection test |
| Browser | no Social registration | Browser zero-registration Gate passes | Browser Moments page/runtime/action registration | build graph and route scan |
| Acceptance | positive `SOC-SEC-AS17..AS24` | exact-source two-Station Gate PROVEN | `SOC-SEC-AS12` as active unsupported claim | old evidence retained as historical only |

No compatibility shim, permanent feature flag, dual authority or dual write may
remain after a cutover.

## 9. Acceptance Scenarios

### AS-17: Remote private publish and read
- **Precondition**: Alice on Station A and Bob on Station B are accepted friends in one active Federation.
- **Action**: Alice publishes FRIENDS text plus image from Native Desktop; Bob opens HOME and detail.
- **Expected**: Bob sees exact plaintext/media; both Stations contain ciphertext only; metadata is viewer-scoped.
- **Failure variant**: unavailable identity/PreKey rejects the whole publish and preserves Alice's draft.
- **Evidence**: Desktop action trace, receiver DOM/screenshot, source/receiver DB scan, Federation frame digest.
- **Status**: pending
### AS-18: Mixed audience completeness
- **Precondition**: local and remote followers, Circle members, Group members and custom recipients exist.
- **Action**: Alice publishes each supported private audience.
- **Expected**: every selected recipient receives exactly once; no omitted or extra recipient.
- **Failure variant**: cross-Federation, unresolved recipient and `CUSTOM_DENY(PUBLIC)` fail before Post commit.
- **Evidence**: frozen audience digest, per-actor outbox/inbox rows, zero partial rows on failure.
- **Status**: pending
### AS-19: Remote unauthorized access
- **Precondition**: Eve knows real resource/object IDs on Station B.
- **Action**: Eve requests feed, detail, comment, object and recovery.
- **Expected**: uniform denial with no payload/envelope/co-recipient metadata.
- **Failure variant**: wrong target Station, actor, device or object binding.
- **Evidence**: HTTP/proto responses and redacted persistence scan.
- **Status**: pending
### AS-20: Remote comment and reaction
- **Precondition**: Bob can read Alice's private Moment.
- **Action**: Bob comments and reacts while duplicate requests are injected.
- **Expected**: Alice source authority commits one result; both clients converge.
- **Failure variant**: parent deleted, grant revoked, rate limited, hash conflict.
- **Evidence**: command/result records, source rows, receiver projection and UI.
- **Status**: pending
### AS-21: Outage, retry and restart
- **Precondition**: Station B becomes unavailable after Station A source commit.
- **Action**: restart dispatcher/Station B and reconnect both Desktop clients.
- **Expected**: one durable frame eventually materializes one resource; Alice transitions from pending to confirmed.
- **Failure variant**: frame expires or receiver reports terminal rejection.
- **Evidence**: outbox lease history, inbox receipt, projection count and visible state.
- **Status**: pending
### AS-22: Delete and relationship revocation
- **Precondition**: Bob has read the resource.
- **Action**: Alice deletes, friendship is removed, or either actor blocks.
- **Expected**: Station B suppresses immediately where locally known and converges to a higher source revision; no future read/media/comment/recovery.
- **Failure variant**: stale delivery arrives after invalidation.
- **Evidence**: ordered frame history, tombstone, source denial and cache purge.
- **Status**: pending
### AS-23: Remote device recovery
- **Precondition**: Bob never opened the resource; Bob2 replaces the original device.
- **Action**: restart Station B and complete trusted recovery on Bob2.
- **Expected**: Bob2 verifies the historical Station A proof and reads exact content.
- **Failure variant**: wrong phrase, revoked device or expired membership remains denied.
- **Evidence**: recovery envelope, retained proof-key attestation and receiver-visible result.
- **Status**: pending
### AS-24: Federation integrity corpus
- **Precondition**: valid and mutated delivery/interaction frames are available.
- **Action**: deliver duplicate, reordered, expired, hash-conflicted, wrong-target and untrusted-signature frames.
- **Expected**: only valid monotonic transitions commit; invalid frames leave no partial Social rows.
- **Failure variant**: receiver crash between domain mutation and inbox receipt.
- **Evidence**: transaction failpoints, replay result and zero partial-row scan.
- **Status**: pending
### AS-11: Browser Social prohibition
- **Precondition**: Browser build and route registry are generated.
- **Action**: inspect navigation, page/runtime registration and attempt legacy Social route access.
- **Expected**: no Browser Social surface or action is reachable.
- **Failure variant**: any public/private Social UI or runtime is registered.
- **Evidence**: source/build graph scan and Browser route test.
- **Status**: pending

## 10. Verification Matrix

| Layer | Required command/evidence |
|---|---|
| Proto | scoped generation plus zero generated drift |
| Federation core | `go test -race ./frame/core/federation/...` |
| Key Exchange | `go test -race ./app/subserver/key_exchange/...` |
| Social | `go test -race ./app/subserver/social/...` |
| Desktop Rust | targeted Social tests plus full `cargo check` |
| Desktop Web | `pnpm --dir apps/desktop run check` and focused Moments tests |
| Browser prohibition | dedicated source/build registration Gate |
| Acceptance structure | plan/domain validation and gap detector |
| Product proof | exact-source two-Station Native Desktop `SOC-SEC-AS17..AS24` |
| Regression | completed same-Station Desktop Social suite |

## 11. Risk And Stop Conditions

- If remote Content PreKey exact replay cannot be made source-plan-bound, stop
  with `DESIGN_AMENDMENT_REQUIRED`.
- If a private object requires public visibility or direct client-to-remote
  Station access, stop.
- If source commit cannot atomically persist every remote outbox frame, stop.
- If receiver projection needs co-recipient envelopes, stop.
- If a remote interaction requires recipient Station to become authority, stop.
- If implementation requires Browser Social or Mobile product work, return to
  PRODUCT; do not expand scope.
- If the target branch lacks the Federation delivery or same-Station Secure
  Content baseline, integration is blocked rather than backfilled ad hoc.

## 12. Completion

Completion requires:

- all seven Tasks are `done`;
- `SOC-SEC-AS17`, `SOC-SEC-AS18`, `SOC-SEC-AS19`, `SOC-SEC-AS20`,
  `SOC-SEC-AS21`, `SOC-SEC-AS22`, `SOC-SEC-AS23`, `SOC-SEC-AS24`, and
  Browser `SOC-SEC-AS11` are `PROVEN`;
- same-Station Desktop Social remains `PROVEN`;
- Mobile remains explicitly `UNPROVEN/deferred`;
- no Browser Social registration remains;
- no old remote-recipient rejection remains on supported same-Federation paths;
- all declarations, clients, processes and leases are released.

Current status: `PLAN_BLOCKED_BY_DESIGN` until `FHSA-D08..FHSA-D15` and this
plan receive independent review and Owner approval.
