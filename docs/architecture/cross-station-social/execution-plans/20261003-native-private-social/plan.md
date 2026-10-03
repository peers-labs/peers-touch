# Cross-Station Private Social - Agent Delivery Plan

> **Status**: prepared
> **Version**: v3.0
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation
> **Branch**: `feat/social-cross-station-plan`
> **Workspace ID**: `afaaeaca0845c551`
> **Initial HEAD**: `87fff7ae10c0274bbfc4139801c0488461c726cc`

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","status":"prepared","binding":{"branch":"feat/social-cross-station-plan","workspaceId":"afaaeaca0845c551","initialHead":"87fff7ae10c0274bbfc4139801c0488461c726cc"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/cross-station-social/design.md","docs/architecture/cross-station-social/decisions.md","docs/architecture/cross-station-social/data-model.md","docs/architecture/cross-station-social/integration.md","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/api-ownership/decisions.md","docs/architecture/federation/README.md"],"decisions":["CSS-D01..CSS-D08","SC-D05..SC-D09","SC-D13","SC-D17..SC-D20","SC-D29","AO-D05"]},"scope":{"sourceClaims":[{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"model/domain/social","mode":"exclusive-write"},{"pathPrefix":"model/domain/federation/delivery.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/key_exchange/key_exchange.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/secure_content","mode":"shared-read"},{"pathPrefix":"tooling/scripts/proto-gen-secure-content.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/proto-gen-secure-content.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/development/secure_content","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/privatecontent","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/key_exchange","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/social","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/social","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/secure_content","mode":"shared-read"},{"pathPrefix":"apps/mobile/src/gen/proto","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/cross-station-social","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/social","mode":"exclusive-write"},{"pathPrefix":"docs/architecture","mode":"shared-read"}],"nonGoals":["Mobile Native Social implementation or readiness","Browser Social support","public cross-Station feed or discovery","cross-Federation private sharing","CUSTOM_DENY with PUBLIC base","DRM or recipient-copy deletion","a second Social transport or Federation Ledger business data","production release or history rewrite"]},"tasks":[{"id":"CSS-01-native-baseline","workstreamId":"CSS-W01","path":"tasks/CSS-01-native-baseline.md","dependsOn":[],"status":"pending","blocker":null},{"id":"CSS-02-private-text","workstreamId":"CSS-W02","path":"tasks/CSS-02-private-text.md","dependsOn":["CSS-01-native-baseline"],"status":"pending","blocker":null},{"id":"CSS-03-private-media","workstreamId":"CSS-W03","path":"tasks/CSS-03-private-media.md","dependsOn":["CSS-02-private-text"],"status":"pending","blocker":null},{"id":"CSS-04-private-comments","workstreamId":"CSS-W04","path":"tasks/CSS-04-private-comments.md","dependsOn":["CSS-03-private-media"],"status":"pending","blocker":null},{"id":"CSS-05-private-reactions","workstreamId":"CSS-W05","path":"tasks/CSS-05-private-reactions.md","dependsOn":["CSS-04-private-comments"],"status":"pending","blocker":null},{"id":"CSS-06-private-revocation","workstreamId":"CSS-W06","path":"tasks/CSS-06-private-revocation.md","dependsOn":["CSS-05-private-reactions"],"status":"pending","blocker":null},{"id":"CSS-07-delivery-resilience","workstreamId":"CSS-W07","path":"tasks/CSS-07-delivery-resilience.md","dependsOn":["CSS-06-private-revocation"],"status":"pending","blocker":null},{"id":"CSS-08-recovery","workstreamId":"CSS-W08","path":"tasks/CSS-08-recovery.md","dependsOn":["CSS-07-delivery-resilience"],"status":"pending","blocker":null},{"id":"CSS-09-final-proof","workstreamId":"CSS-W09","path":"tasks/CSS-09-final-proof.md","dependsOn":["CSS-08-recovery"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"slice-native-baseline":[],"slice-private-text":[],"slice-private-media":[],"slice-private-comments":[],"slice-private-reactions":[],"slice-private-revocation":[],"slice-delivery-resilience":[],"slice-recovery":[],"slice-final-proof":["station-api-ownership","social-cross-station-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]},"completion":["station-api-ownership","social-cross-station-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"],"full":["station-api-ownership","social-cross-station-contract","social-cross-station-prekey","social-cross-station-delivery","social-cross-station-interaction","social-cross-station-revocation-recovery","social-cross-station-desktop-functional","social-private-desktop-e2e","social-cross-station-native-e2e","browser-social-zero-registration","social-domain-validation"]}
```

## 1. Delivery Contract

This plan is executed by an Agent, not estimated in human engineering days.

- One unit is 2-4 hours of Agent wall-clock work, including focused verification.
- One unit maps to one Task Slice, one TRAE Goal Slice, and one commit.
- Every unit ends in a buildable, runnable, user-meaningful version.
- Every completed unit creates exactly one Conventional Commit.
- A unit never commits a half-working path; blockers are parked before commit.
- Intermediate units run only their focused checks and one bounded user journey.
- Project-wide full Gates are not run. The last unit runs only the Social,
  API-ownership, and Browser-boundary Gates listed above.
- Push and PR creation remain outside current authorization. The commits can
  update one rolling MR after separate approval; eight dependent PRs are avoided.

## 2. Scope

Target: `SOC-SEC-C09`, `J10..J12`, `AS17..AS24`, plus Browser prohibition
`AS11`. Same-Station private/public Social remains a regression. Public
cross-Station feed/discovery and Mobile product work are excluded.

## 3. Agent Units And Estimate

| Unit | Timebox | Usable version delivered | Commit |
|---|---:|---|---|
| `CSS-01` | 2h | Native-only same-Station Social; Browser registration removed; slice runner ready | `feat(social): enforce native-only social baseline` |
| `CSS-02` | 4h | Alice sends one private text Post to one remote friend; Bob reads it from Station B | `feat(social): deliver cross-station private text posts` |
| `CSS-03` | 3h | Cross-Station private image/video opens through authorized ciphertext ranges | `feat(social): stream cross-station private media` |
| `CSS-04` | 3h | Bob creates one encrypted Comment through source-authority prepare/submit | `feat(social): support cross-station private comments` |
| `CSS-05` | 2h | Bob reacts/unreacts once; both clients converge without duplicate state | `feat(social): support cross-station private reactions` |
| `CSS-06` | 3h | Delete, friendship loss, and block suppress remote content without resurrection | `feat(social): revoke cross-station private resources` |
| `CSS-07` | 4h | Outage, retry, restart, pending status, and reconcile work without duplicates | `feat(social): recover cross-station delivery after outages` |
| `CSS-08` | 3h | Replacement-device recovery reads authorized never-opened history | `feat(social): recover cross-station private history` |
| `CSS-09` | 4h | Exact-source Social release candidate with focused acceptance evidence | `test(social): certify cross-station private social` |

Expected active Agent time: **28 hours**. Planning range: **25-33 hours**.
Environment provisioning, dependency download, or remote Station unavailability
can increase elapsed time, but cannot weaken a unit's completion criteria.

## 4. Current-State Inventory

| Surface | Existing foundation | First slice that closes the gap |
|---|---|---|
| Same-Station private Social | proven Native Desktop path | CSS-01 preserves it |
| Browser boundary | Moments page/runtime registered | CSS-01 |
| Remote keys and delivery | local Content PreKeys; shared Federation transport | CSS-02 |
| Encrypted objects | source Social object authority | CSS-03 |
| Private Comment | same-Station prepare/submit | CSS-04 |
| Reaction | same-Station source authority | CSS-05 |
| Revoke/tombstone | same-Station delete/block/recovery | CSS-06 |
| Retry/restart | durable Federation mechanics | CSS-07 |
| Replacement recovery | same-Station recovery envelope | CSS-08 |
| Product evidence | same-Station suite and negative remote boundary | CSS-09 |

## 5. Dependency And Release Sequence

```text
CSS-01 Native baseline
  -> CSS-02 remote private text
      -> CSS-03 remote private media
          -> CSS-04 remote private Comment
              -> CSS-05 remote Reaction
                  -> CSS-06 revocation
                      -> CSS-07 outage/restart
                          -> CSS-08 replacement recovery
                              -> CSS-09 focused Social proof
```

The units are serial because they share generated contracts, Social authority,
Desktop projection files, and the same two-Station runtime. Parallel execution
would increase reconciliation cost beyond a 2-4 hour unit.

## 6. Incremental Product Contract

Every intermediate commit is honest about its supported surface:

| After unit | Supported | Explicitly unavailable |
|---|---|---|
| CSS-01 | same-Station Native Social | all cross-Station private content |
| CSS-02 | one remote friend, private text Post | media, remote Comment/Reaction, recovery |
| CSS-03 | text + image/video | remote Comment/Reaction, recovery |
| CSS-04 | text/media + Comment | remote Reaction, revocation convergence, recovery |
| CSS-05 | text/media + Comment/Reaction | revocation convergence, recovery |
| CSS-06 | normal delivery + delete/block/friend-loss | outage/restart and replacement recovery |
| CSS-07 | durable outage/restart/reconcile | replacement-device recovery |
| CSS-08 | full planned Native Desktop behavior | formal Social proof |
| CSS-09 | exact-source Social release candidate | Mobile and public cross-Station feed |

Unavailable paths return typed errors or remain hidden; no unit silently drops
recipients, falls back to plaintext, or exposes a partially implemented action.

## 7. Architecture Traceability

| Capability | Decisions | Unit |
|---|---|---|
| Native-only surface | `CSS-D08` | CSS-01 |
| Remote text and viewer projection | `CSS-D02..D04`, `AO-D05` | CSS-02 |
| Object ciphertext stream | `CSS-D05`, `SC-D18` | CSS-03 |
| Comment prepare/submit | `CSS-D06`, `SC-D17` | CSS-04 |
| Reaction exact replay | `CSS-D06` | CSS-05 |
| Monotonic invalidation | `CSS-D07` | CSS-06 |
| Durable retry/reconcile | `CSS-D03`, `CSS-D04` | CSS-07 |
| Trusted recovery/readiness | `CSS-D04`, `CSS-D07`, `SC-D09`, `SC-D19` | CSS-08 |
| Focused readiness evidence | `CSS-D08` | CSS-09 |

## 8. Atomic Cutovers

| Unit | Cutover |
|---|---|
| CSS-01 | browser-gateway no longer registers Social; Tauri registration remains |
| CSS-02 | single remote FRIENDS text path replaces its old locality rejection |
| CSS-03 | remote media uses source-authorized peer stream; no public/direct fallback |
| CSS-04 | remote Comment prepare/submit returns to source authority |
| CSS-05 | remote Reaction authority returns to source and replay is exact |
| CSS-06 | receiver tombstone wins over stale delivery |
| CSS-07 | durable delivery identity owns retry/restart; no duplicate Post |
| CSS-08 | trusted recovery reads authorized history; revoked devices remain denied |
| CSS-09 | final claim uses current exact-source Social evidence |

Each cutover is complete inside its commit. Unsupported later capabilities keep
their existing typed rejection until their own unit lands.

## 9. Per-Unit Verification Policy

Each unit runs:

1. changed-package compile/type checks;
2. focused unit/integration tests for its authority boundary;
3. one development-policy user journey proving the new usable version;
4. previous unit's journey as a regression;
5. `git diff --check` and source-bound cleanup;
6. one commit only after all five pass.

The unit does not run repository-wide or unrelated domain Gates. CSS-09 alone
runs the accumulated Social-specific Gate set from `Acceptance Execution`.

## 10. User Scenarios

| Scenario | First usable unit | Observable result |
|---|---|---|
| `AS11` Browser prohibition | CSS-01 | Browser has no Social route/runtime/action |
| `AS17` private text publish/read | CSS-02 | Bob reads Alice's text from Station B |
| `AS17` private media read | CSS-03 | Bob opens verified image/video ciphertext |
| `AS20` private Comment | CSS-04 | Alice and Bob see one source-committed Comment |
| `AS20` Reaction | CSS-05 | react/unreact converges exactly once |
| `AS22` delete/block/friend loss | CSS-06 | Bob loses all future access; stale frames stay revoked |
| `AS21`, `AS24` retry/restart/integrity | CSS-07 | outage recovers once; invalid frames write nothing |
| `AS23` replacement recovery | CSS-08 | Bob2 recovers never-opened authorized history |
| `AS18`, `AS19` audience/unauthorized matrix | CSS-09 | exact recipients succeed; Eve and invalid scopes fail |

Every scenario covers its success path plus network error, timeout, invalid
input, and cancellation where the action is cancellable. Cancellation after
durable admission is rejected rather than simulated.

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

Completion requires nine usable commits, `AS11` and `AS17..AS24` proven on the
declared Native Desktop/two-Station cells, same-Station Social still proven,
Mobile unproven, and no temporary processes, fixtures, declarations, or leases.

Plan state after document validation: `PLAN_READY_FOR_EXECUTION`. Product
readiness remains unproven until CSS-09.
