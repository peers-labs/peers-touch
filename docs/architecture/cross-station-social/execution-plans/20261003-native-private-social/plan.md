# Cross-Station Private Social - Agent Delivery Plan

> **Status**: active
> **Version**: v4.0
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation
> **Branch**: feat/social-cross-station-plan
> **Workspace ID**: afaaeaca0845c551
> **Initial HEAD**: 87fff7ae10c0274bbfc4139801c0488461c726cc

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","status":"active","binding":{"branch":"feat/social-cross-station-plan","workspaceId":"afaaeaca0845c551","initialHead":"87fff7ae10c0274bbfc4139801c0488461c726cc"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social/design.md","docs/architecture/cross-station-social/decisions.md","docs/architecture/cross-station-social/data-model.md","docs/architecture/cross-station-social/integration.md","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/api-ownership/decisions.md","docs/architecture/federation/README.md","docs/client/desktop/runtime-projections.md"],"decisions":["CSS-D01..CSS-D11","SC-D05..SC-D09","SC-D13","SC-D17..SC-D20","SC-D24","SC-D29","AO-D05"]},"scope":{"sourceClaims":[{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/skills/pt-github-review","mode":"exclusive-write"},{"pathPrefix":"model/domain/social","mode":"exclusive-write"},{"pathPrefix":"model/domain/federation/delivery.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/key_exchange/key_exchange.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/secure_content","mode":"shared-read"},{"pathPrefix":"tooling/scripts/proto-gen-secure-content.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/proto-gen-secure-content.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-social-cross-station-operability.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-social-cross-station-operability.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-social-private-media-source.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-social-private-media-source.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev","mode":"shared-read"},{"pathPrefix":"tooling/scripts/plan","mode":"shared-read"},{"pathPrefix":"tooling/development/secure_content","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/auth/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/plugin/native/subserver/relay-client","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/plugin/native/subserver/relay","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/metrics","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/key_exchange","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/events","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/oss","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/social","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/gen/proto","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/secure_content/private_comment.rs","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/api-ownership/station-api-capabilities.yaml","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/cross-station-social","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/social","mode":"exclusive-write"},{"pathPrefix":"docs/architecture","mode":"shared-read"},{"pathPrefix":"docs/client/common/ui-identity","mode":"exclusive-write"},{"pathPrefix":"docs/client/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model","mode":"exclusive-write"}],"nonGoals":["Mobile Native Social implementation or readiness","Browser Social support","public cross-Station feed or discovery","cross-Federation private sharing","CUSTOM_DENY with PUBLIC base","DRM or recipient-copy deletion","a second Social transport or Federation Ledger business data","production release or history rewrite"]},"tasks":[{"id":"CSS-00-runtime-foundation","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-00-runtime-foundation.md","dependsOn":[],"status":"done","blocker":null},{"id":"CSS-01-native-baseline","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-01-native-baseline.md","dependsOn":["CSS-00-runtime-foundation"],"status":"done","blocker":null},{"id":"CSS-02A-remote-admission","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-02A-remote-admission.md","dependsOn":["CSS-01-native-baseline"],"status":"done","blocker":null},{"id":"CSS-02B-private-text","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-02B-private-text.md","dependsOn":["CSS-02A-remote-admission"],"status":"done","blocker":null},{"id":"CSS-02C-group-snapshot","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-02C-group-snapshot.md","dependsOn":["CSS-02B-private-text"],"status":"done","blocker":null},{"id":"CSS-02D-audience-matrix","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-02D-audience-matrix.md","dependsOn":["CSS-02C-group-snapshot"],"status":"done","blocker":null},{"id":"CSS-03-private-media","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-03-private-media.md","dependsOn":["CSS-02D-audience-matrix"],"status":"done","blocker":null},{"id":"CSS-04-private-comments","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-04-private-comments.md","dependsOn":["CSS-03-private-media"],"status":"done","blocker":null},{"id":"CSS-05-private-reactions","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-05-private-reactions.md","dependsOn":["CSS-04-private-comments"],"status":"done","blocker":null},{"id":"CSS-06-private-revocation","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-06-private-revocation.md","dependsOn":["CSS-05-private-reactions"],"status":"done","blocker":null},{"id":"CSS-07-delivery-resilience","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-07-delivery-resilience.md","dependsOn":["CSS-06-private-revocation"],"status":"in_progress","blocker":null},{"id":"CSS-08-recovery","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-08-recovery.md","dependsOn":["CSS-07-delivery-resilience"],"status":"pending","blocker":null},{"id":"CSS-08A-schema-activation","workstreamId":"CSS-W-ACTIVATION","path":"tasks/CSS-08A-schema-activation.md","dependsOn":["CSS-08-recovery"],"status":"pending","blocker":null},{"id":"CSS-09-final-proof","workstreamId":"CSS-W-SOURCE","path":"tasks/CSS-09-final-proof.md","dependsOn":["CSS-00-runtime-foundation","CSS-01-native-baseline","CSS-02A-remote-admission","CSS-02B-private-text","CSS-02C-group-snapshot","CSS-02D-audience-matrix","CSS-03-private-media","CSS-04-private-comments","CSS-05-private-reactions","CSS-06-private-revocation","CSS-07-delivery-resilience","CSS-08-recovery","CSS-08A-schema-activation"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"allowed","pullRequest":"allowed"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":["station-four-social-private","station-five-arm-social-private"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"slice-runtime-foundation":[],"slice-native-baseline":[],"slice-remote-admission":[],"slice-private-text":[],"slice-group-snapshot":[],"slice-audience-matrix":[],"slice-private-media":[],"slice-private-comments":[],"slice-private-reactions":[],"slice-private-revocation":[],"slice-delivery-resilience":[],"slice-recovery":[],"slice-schema-activation":[],"slice-final-proof":["station-api-ownership","social-cross-station-contract","social-cross-station-eventbus-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]},"completion":["station-api-ownership","social-cross-station-contract","social-cross-station-eventbus-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"],"full":["station-api-ownership","social-cross-station-contract","social-cross-station-eventbus-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]}
```

## 1. Delivery Contract

Each unit maps to a Task/Goal Slice and commit. CSS-00..08 are source
closures; CSS-08A freezes and activates that exact source; CSS-09 alone runs
Native Journeys and formal Gates. Push, rolling-PR update, and the two exact
activation reset scopes are authorized; history rewrite is denied.

## 2. Scope

Target: `SOC-SEC-C09`, `J10..J12`, `AS17..AS24`, plus Browser prohibition
`AS11`. Same-Station private/public Social remains a regression. Public
cross-Station feed/discovery and Mobile product work are excluded.

## 3. Agent Units And Estimate

| Unit | Timebox | Closure delivered | Commit |
|---|---:|---|---|
| `CSS-00` | 3h | Plan-aware activation owner, Suite bindings, Gate registry, and operability checker | `feat(tooling): add cross-station social runtime foundation` |
| `CSS-01` | 2h | Native-only registration and one fenced Moments projection owner | `feat(social): enforce native-only social baseline` |
| `CSS-02A` | 2h | Alice selects one remote friend and receives exact remote PreKey readiness or a typed no-commit failure | `feat(social): prepare remote private recipients` |
| `CSS-02B` | 3h | Alice sends one private text Post to one remote friend; Bob reads it from Station B | `feat(social): deliver cross-station private text posts` |
| `CSS-02C` | 2h | Conversation/Social freeze Federation-bound Group membership with one unchanged submit fence | `feat(social): bind group snapshots to federation` |
| `CSS-02D` | 3h | Mixed local/remote FRIENDS, FOLLOWERS, CIRCLE, GROUP, and CUSTOM audiences use one exact snapshot | `feat(social): support federated private audiences` |
| `CSS-03` | 3h | Cross-Station private image/video opens through authorized ciphertext ranges | `feat(social): stream cross-station private media` |
| `CSS-04` | 3h | Bob creates one encrypted Comment through source-authority prepare/submit | `feat(social): support cross-station private comments` |
| `CSS-05` | 2h | Bob reacts/unreacts once; both clients converge without duplicate state | `feat(social): support cross-station private reactions` |
| `CSS-06` | 3h | Delete, friendship loss, and block suppress remote content without resurrection | `feat(social): revoke cross-station private resources` |
| `CSS-07` | 4h | Outage, retry, restart, pending status, and reconcile work without duplicates | `feat(social): recover cross-station delivery after outages` |
| `CSS-08` | 3h | Replacement-device recovery reads authorized never-opened history | `feat(social): recover cross-station private history` |
| `CSS-08A` | 3h | Final source receives serial canonical schema activation on `four` and `fiveArm` | `chore(social): activate cross-station private schema` |
| `CSS-09` | 4h | Exact-source Social release candidate with focused acceptance evidence | `test(social): certify cross-station private social` |

## 4. Current-State Inventory

`integration.md` inventories repository-backed assets and gaps; each Task binds
its write set, checks, cutover, and non-claims.

## 5. Dependency And Release Sequence

```text
CSS-00 runtime/activation foundation
  -> CSS-01 Native baseline
    -> CSS-02A remote admission
      -> CSS-02B remote private text
        -> CSS-02C Federation-bound Group snapshot
          -> CSS-02D mixed/Group audience
            -> CSS-03 remote private media
              -> CSS-04 remote private Comment
                -> CSS-05 remote Reaction
                  -> CSS-06 revocation
                    -> CSS-07 outage/restart
                      -> CSS-08 replacement recovery
                        -> CSS-08A schema activation
                          -> CSS-09 focused Social proof
```

Shared generated contracts, Social authority, Desktop projections, and runtime
resources require serial units.

All source Tasks use `workstreamId=CSS-W-SOURCE`; each has the single direct
functional successor CSS-09. CSS-08A is the independent activation owner.

## 7. Architecture Traceability

| Capability | Decisions | Unit |
|---|---|---|
| Runtime/Gates, Native boundary, EventBus owner | AAR-C02/C03/C05/C09/C10, `CSS-D08` | CSS-00..01 |
| Remote admission, text, Group and mixed audience | `CSS-D02..D04`, `CSS-D09`, `SC-D29`, `AO-D05` | CSS-02A..D |
| Object and source-owned interactions | `CSS-D05..D06`, `CSS-D11`, `SC-D17..D18` | CSS-03..05 |
| Revocation, retry/reconcile, recovery | `CSS-D03..D04`, `CSS-D07`, `SC-D09`, `SC-D19` | CSS-06..08 |
| Exact-source schema admission | `SC-D23..D24` | CSS-08A |
| Native readiness evidence | `CSS-D08`, AAR-C10 | CSS-09 |

## 8. Atomic Cutovers

| Unit | Cutover |
|---|---|
| CSS-01 | browser-gateway no longer registers Social; Tauri registration remains |
| CSS-02A | remote identity/Federation/PreKey readiness is available without a Social commit |
| CSS-02B | single remote FRIENDS text path replaces its old locality rejection |
| CSS-02C | Group snapshot binds Federation identity without changing Conversation ownership |
| CSS-02D | accepted mixed and Group audiences replace the remaining same-Federation locality rejection |
| CSS-03 | remote media uses source-authorized peer stream; no public/direct fallback |
| CSS-04 | remote Comment prepare/submit returns to source authority |
| CSS-05 | remote Reaction authority returns to source and replay is exact |
| CSS-06 | receiver tombstone wins over stale delivery |
| CSS-07 | durable delivery identity owns retry/restart; no duplicate Post |
| CSS-08 | trusted recovery reads authorized history; revoked devices remain denied |
| CSS-08A | final exact source replaces stale private schema attestations serially on both approved scopes |
| CSS-09 | final claim uses current exact-source Social evidence |

## 9. Per-Unit Verification Policy

Source Tasks run focused checks and make no runtime claim. CSS-08A owns source
freeze/activation; CSS-09 reuses one Suite for all Native Journeys.

## 10. User Scenarios

| Scenario | Source-ready unit | Observable result proven by CSS-09 |
|---|---|---|
| `AS11` Browser prohibition | CSS-01 | Browser has no Social route/runtime/action |
| `AS17` private admission | CSS-02A | remote identity and one-time PreKeys are verified before commit |
| `AS17` private text publish/read | CSS-02B | Bob reads Alice's text from Station B |
| `AS18` audience matrix | CSS-02D | mixed local/remote and Group recipients are exact |
| `AS17` private media read | CSS-03 | Bob opens verified image/video ciphertext |
| `AS20` private Comment | CSS-04 | Alice and Bob see one source-committed Comment |
| `AS20` Reaction | CSS-05 | react/unreact converges exactly once |
| `AS22` delete/block/friend loss | CSS-06 | Bob loses all future access; stale frames stay revoked |
| `AS21`, `AS24` retry/restart/integrity | CSS-07 | outage recovers once; invalid frames write nothing |
| `AS23` replacement recovery | CSS-08 | Bob2 recovers never-opened authorized history |
| `AS19` unauthorized matrix | CSS-09 | Eve receives no resource, object, identity, or envelope data |

### 10.1 Auditable Failure And Evidence Matrix

| Scenario | Injected condition / boundary | Binary oracle | Required evidence |
|---|---|---|---|
| `AS11` | Browser boot and direct route/action attempts | zero Social page, runtime, module, navigation, or action registration | source Gate plus browser route result |
| `AS17` | remote identity/manifest/PreKey unavailable; source or receiver unavailable around commit; wrong object range | pre-admission failure commits nothing; post-commit outage retains one delivery; valid text/media decrypts only for Bob | source/receiver rows, hashes, typed UI state, and Native receiver assertion |
| `AS18` | mixed local/remote FRIENDS/FOLLOWERS/CIRCLE/GROUP/CUSTOM; stale Group snapshot; unresolved/cross-Federation/oversized audience | every eligible actor appears exactly once; every invalid set fails before Post/object/outbox commit | Conversation snapshot/Federation bindings, claim ledger, and zero-partial-row readback |
| `AS19` | Eve uses real Post, Comment, and Object IDs with wrong actor/device/grant | uniform deny/not-found and zero body, bytes, PTIDs, device IDs, or envelopes | response corpus, database readback, and log privacy scan |
| `AS20` | Comment prepare then parent revoke before submit; duplicate/unknown result/hash conflict; Reaction replay | prepare and submit both revalidate source parent; exact replay returns one result; hash conflict is terminal; abandoned one-time PreKeys are never reused | command/result hashes, PreKey receipts, canonical row count, and hidden-page event effect |
| `AS21` | Station B outage after source commit, dispatcher retry, Station restart | one durable identity survives and yields one receiver projection | outbox/inbox dispositions, retry metrics, pending/retrying UI, and final receiver assertion |
| `AS22` | delete, friendship loss, and either-direction block with stale frame replay | all future read/interaction/recovery paths deny; tombstone prevents resurrection | source revision, receiver tombstone, cache purge, and reconnect result |
| `AS23` | Bob never opens, Station B restarts, Bob2 replaces device; wrong phrase/revoked device/invalid proof | valid Bob2 recovers exact history; every invalid case gets no new envelope or plaintext | replacement lifecycle, retained-key attestation, recovery receipt, and receiver UI |
| `AS24` | duplicate, reorder, expiry, hash conflict, untrusted signature, wrong actor/Station, receiver crash | exactly one valid transition; invalid frames are typed terminal/retryable and create no partial Social rows | immutable frame corpus, receiver transaction failpoints, dispositions, and row counts |

Pre-admission cancellation writes nothing; missing receiver evidence remains
`UNPROVEN`.

## 11. Stop Conditions

- Stop a unit at four hours if it cannot leave the declared usable version.
- Do not commit a partial vertical path or move unfinished work into a hidden
  fallback.
- Return to DESIGN if exact remote PreKey replay or atomic source/outbox commit
  cannot be preserved.
- Return to PRODUCT if a unit requires Mobile behavior, Browser Social, or
  public cross-Station feed.
- Keep the current unit uncommitted and `UNPROVEN` when its focused journey
  cannot run; later units do not start.

## 12. Completion

Completion requires 14 commits, CSS-09 exact-source Native/two-Station and
EventBus proof, no Mobile claim, and no temporary resources.
