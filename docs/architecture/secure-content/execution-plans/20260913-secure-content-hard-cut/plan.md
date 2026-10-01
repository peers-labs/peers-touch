# Secure Content Hard Cut

> **Status**: active
> **Branch**: feat/federation
> **Workspace ID**: 9eb2cb904c9ae460
> **Initial HEAD**: 2d54851f95994d717928105aca6470c30adf3657

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"SECURE-CONTENT-HARD-CUT-20260913","status":"active","binding":{"branch":"feat/federation","workspaceId":"9eb2cb904c9ae460","initialHead":"2d54851f95994d717928105aca6470c30adf3657"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/secure-content/design.md","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/secure-content/integration.md","docs/architecture/secure-content/operations.md","docs/architecture/messaging-platform/product-definition.md","docs/architecture/messaging-platform/experience-contract.md","docs/architecture/messaging-platform/acceptance-matrix.md","docs/architecture/acceptance-framework/design.md","docs/architecture/acceptance-framework/decisions.md"],"decisions":["SC-D01","SC-D02","SC-D03","SC-D04","SC-D05","SC-D06","SC-D07","SC-D08","SC-D09","SC-D10","SC-D11","SC-D12","SC-D13","SC-D14","SC-D15","SC-D16","SC-D17","SC-D18","SC-D19","SC-D20","SC-D21","SC-D22","SC-D23","SC-D24","SC-D25","SC-D26","SC-D27","SC-D28","SC-D29","D-21"]},"scope":{"sourceClaims":[{"pathPrefix":".gitignore","mode":"exclusive-write"},{"pathPrefix":"AGENTS.md","mode":"exclusive-write"},{"pathPrefix":"Makefile","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/dev","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"apps/station","mode":"exclusive-write"},{"pathPrefix":"docs/architecture","mode":"exclusive-write"},{"pathPrefix":"docs/global","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"model","mode":"exclusive-write"},{"pathPrefix":"packages","mode":"exclusive-write"},{"pathPrefix":"tooling","mode":"exclusive-write"}],"nonGoals":["private Social federation","Conversation authority redesign","production data migration","synthetic runtime or Acceptance evidence","push, pull request, or history rewrite before Owner authorization"]},"tasks":[{"id":"W0","workstreamId":"W0","path":"tasks/W0.md","dependsOn":[],"status":"done","blocker":null},{"id":"W0R","workstreamId":"W0R","path":"tasks/W0R.md","dependsOn":["W0"],"status":"done","blocker":null},{"id":"W14","workstreamId":"FOUNDATION","path":"tasks/W14.md","dependsOn":["W0"],"status":"done","blocker":null},{"id":"W1","workstreamId":"FOUNDATION","path":"tasks/W1.md","dependsOn":["W14"],"status":"done","blocker":null},{"id":"W2A","workstreamId":"W2","path":"tasks/W2A.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W3","workstreamId":"W3","path":"tasks/W3.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W4","workstreamId":"W4","path":"tasks/W4.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W5","workstreamId":"W5","path":"tasks/W5.md","dependsOn":["W3"],"status":"done","blocker":null},{"id":"W6","workstreamId":"W6","path":"tasks/W6.md","dependsOn":["W4","W5"],"status":"done","blocker":null},{"id":"W7A","workstreamId":"W7A","path":"tasks/W7A.md","dependsOn":["W3","W5"],"status":"done","blocker":null},{"id":"W7S","workstreamId":"W7","path":"tasks/W7S.md","dependsOn":["W6","W7A"],"status":"done","blocker":null},{"id":"W7R","workstreamId":"W7","path":"tasks/W7R.md","dependsOn":["W0R","W7S"],"status":"done","blocker":null},{"id":"W11-SOURCE","workstreamId":"W11","path":"tasks/W11-SOURCE.md","dependsOn":["W7R"],"status":"done","blocker":null},{"id":"W12E","workstreamId":"W12E","path":"tasks/W12E.md","dependsOn":["W7R","W11-SOURCE"],"status":"done","blocker":null},{"id":"W12S","workstreamId":"W12S","path":"tasks/W12S.md","dependsOn":["W12E"],"status":"done","blocker":null},{"id":"W12A","workstreamId":"W12A","path":"tasks/W12A.md","dependsOn":["W12S"],"status":"done","blocker":null},{"id":"W12B","workstreamId":"W12B","path":"tasks/W12B.md","dependsOn":["W12A"],"status":"done","blocker":null},{"id":"W12C","workstreamId":"W12C","path":"tasks/W12C.md","dependsOn":["W12B"],"status":"done","blocker":null},{"id":"W12D","workstreamId":"W12D","path":"tasks/W12D.md","dependsOn":["W12C"],"status":"done","blocker":null},{"id":"W7","workstreamId":"W7","path":"tasks/W7.md","dependsOn":["W7S","W7R","W12D"],"status":"in_progress","blocker":null},{"id":"W8","workstreamId":"W8","path":"tasks/W8.md","dependsOn":["W7"],"status":"pending","blocker":null},{"id":"W9","workstreamId":"W9","path":"tasks/W9.md","dependsOn":["W8"],"status":"pending","blocker":null},{"id":"W2","workstreamId":"W2","path":"tasks/W2.md","dependsOn":["W2A","W9"],"status":"pending","blocker":null},{"id":"W10","workstreamId":"W10","path":"tasks/W10.md","dependsOn":["W2","W9"],"status":"pending","blocker":null},{"id":"W11","workstreamId":"W11","path":"tasks/W11.md","dependsOn":["W8","W9","W10","W11-SOURCE"],"status":"pending","blocker":null},{"id":"W12","workstreamId":"W12","path":"tasks/W12.md","dependsOn":["W11","W12D"],"status":"pending","blocker":null},{"id":"W13","workstreamId":"W13","path":"tasks/W13.md","dependsOn":["W12"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":["station-four-social-private","station-five-arm-social-private"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"w0-governance":[],"w0r-runtime-control":[],"w14-generator":[],"w1-contracts":[],"w2a-kernel":[],"w3-prekeys":[],"w4-auth":[],"w5-recovery":[],"w6-social-minimum":[],"w7a-prekey-client":[],"w7s-desktop-source":[],"w7r-runtime-owner":[],"w11-source-hardcut":[],"w12e-acceptance-suite-infra":[],"w12s-secure-content-suite-injection":[],"w12a-mobile-foundation":[],"w12b-mobile-parity":[],"w12c-runtime-owners":[],"w12d-schema-activation":[],"w7-functional":[],"w8-closure":[],"w9-closure":[],"w2-closure":[],"w10-chat":[],"w11-functional":[],"w12-final":[],"w13-acceptance":["SC-AS01","SC-AS02","SC-AS03","SC-AS04","SC-AS05","SC-AS06","SC-AS07","SC-AS08","SC-AS09","SC-AS10","SC-AS11","SC-AS12","SC-AS13","SC-AS14","SC-AS15","SC-AS16"]},"completion":["SC-AS01","SC-AS02","SC-AS03","SC-AS04","SC-AS05","SC-AS06","SC-AS07","SC-AS08","SC-AS09","SC-AS10","SC-AS11","SC-AS12","SC-AS13","SC-AS14","SC-AS15","SC-AS16"],"full":["SC-AS01","SC-AS02","SC-AS03","SC-AS04","SC-AS05","SC-AS06","SC-AS07","SC-AS08","SC-AS09","SC-AS10","SC-AS11","SC-AS12","SC-AS13","SC-AS14","SC-AS15","SC-AS16"]}
```

## Goal

Deliver E2EE private Social content through one portable crypto implementation
while Social and Conversation retain independent route, transaction, table,
grant, and object authorities.

## Current Snapshot

- W8 exposed a cross-Plan Acceptance lifecycle defect: custom runners can
  provision accounts and clients per scenario while Harness-only evidence
  remains weaker than the receiver-visible claim.
- W12E owns the domain-neutral Suite Runtime contract, Plan schema, validator,
  audit Skill, and operational invariant. W12S owns only the Secure Content
  injection and W8/W9 migration onto that contract.
- Source invalidation proof `5ad20b35...` returned W7-W13 to pending and
  reopened the source frontier without rewriting prior evidence.
- The accepted scope is now a `25`-Task model with `13` completed closures:
  W12A Mobile foundation -> W12B complete Mobile parity -> W12C platform
  runtime owners -> W12D source freeze and serial schema activation.
- W7-W13 remain `UNPROVEN` and dependency-parked behind W12D. No source,
  activation, API-only, Browser, or single-platform result can substitute.
- The 2026-10-01 runtime reuse audit found that W7 lacked a declared Suite
  contract, W9's Suite owner was still blocked, and W2/W10/W11/W12 repeated
  platform provisioning. `review-runtime-reuse-amendment.md` owns the accepted
  repair contract.
- The amendment preserves Task ownership: immutable build/deploy identity is
  generation-scoped, while accounts, clients, storage, login, and Fixture
  state are shared only by Scenarios inside one Task-owned Suite Runtime.

## Workflow Dependency

The unversioned Development Workflow control plane is already integrated.
Git, declaration, Session, Plan lifecycle, active-work, runtime manifests, and
formal Acceptance retain separate source/evidence ownership.

## SC-D24 Impact Inventory

- Mobile Native currently implements only the private text foundation; accepted
  Comment, media, subtype, lifecycle, bounds, and full visible-state parity are
  incomplete.
- The generic runner is attach-only, but W9/W2/W10/W11/W12 lack owner commands
  that provision their required Desktop/iOS/Android manifests and Fixtures.
- The SC-D23 reset owner, schema attestation, and prior activation evidence are
  reusable source, but a fresh activation is required after source completion.
- Social, Conversation, Actor Identity, Key Exchange, OSS, and Local Dev remain
  the only authorities for their existing resources.

## SC-D24 Dependency And Cutover

```text
W7R + W11-SOURCE
  -> W12E: reusable Acceptance Suite Runtime and audit contract
  -> W12S: Secure Content Suite injection
  -> W12A: Mobile private Social foundation
  -> W12B: Comment/media/subtype/lifecycle parity
  -> W12C: Desktop/iOS/Android runtime owners and Fixtures
  -> W12D: source freeze + serial SCHEMA_ACTIVATION
  -> W7 -> W8 -> W9 -> W2/W10 -> W11
  -> W12: fresh FINAL_CUT + complete product matrix
  -> W13: formal Acceptance
```

| Concern | W12D activation closure | W12 final closure |
|---|---|---|
| Source identity | Complete all remaining W7-W11 source and publish one immutable source-freeze generation | Reuse the final W11 exact source; no source mutation |
| Reset implementation | Implement and prove the one shared SC-D23 owner and non-public CLI | Reuse without a second mutator or journal |
| Destructive identity | `W12A-FOUR` and `W12A-FIVEARM` each own one fresh `SCHEMA_ACTIVATION` declaration, scope, reset, manifest, journal, invocation set and lease | `W12F-FOUR` and `W12F-FIVEARM` repeat the one-scope rule with fresh `FINAL_CUT` identities |
| Runtime admission | Publish and require current schema attestations before private Social client launch | Publish final-cut attestations for the final matrix |
| Legal claim | Canonical schema is active for W7-W11; no product pass | Final reset plus complete product matrix only |
| Forbidden substitution | Cannot satisfy W7, W12, or formal Acceptance | Cannot reuse or relabel activation evidence |

## Source-Drift Reactivation

W7-W11 own functional evidence only. If one exposes an actionable source
defect, no code edit is legal under that functional declaration.

## Source Invalidation Policy

```json
{"kind":"peers-touch-source-invalidation-policy","sourceOwnerTaskId":"W12A","rootTaskIds":["W12B"]}
```

This Plan declares W12A as `source-owner` and W12B as its single
`invalidation-root`; W12B transitively reaches W12D and every product Task. The executable transition is:

```bash
node tooling/scripts/plan/planctl.mjs invalidate-source \
  --plan docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md \
  --task <failed-task> \
  --first-failure-ref <failure-ref>
```

The caller cannot supply the source owner, root, task set, Session, cleanup
proof, declaration, lease, or evidence identities. The current Development
Workflow owner must mechanically select the unique Plan policy, snapshot the
current Session/runtime/declaration/lease owners, and atomically:

1. drives the failed Session to its required quiescent terminal state, cleans
   runtime resources, releases every owned lease and the declaration, and
   verifies the closed owner records and empty resource inventories;
2. derives W12A and W12B from the immutable Plan policy and publishes the
   immutable invalidation proof;
3. makes W12A the only `in_progress` task, returns W12B plus every transitive
   successor to `pending`, and appends canonical evidence-identity
   invalidations without rewriting evidence;
4. commits the lifecycle projection, transition chain, and `active_work` CAS,
   then terminalizes the transaction fence.

Only after that transition reaches `COMPLETE` may the Development Workflow
start a W12A `SOURCE_MUTATION` declaration, apply the root fix, record a clean
Development Session checkpoint, synchronize workspace-owned active-work, and
complete W12B/W12C and both W12D profile activations before W7 restarts.

If the source defect is discovered by W12D activation after its Station journal
has reached only `PREPARED`, accepted SC-D25 allows the first invocation for
the fresh source generation to atomically supersede that old journal while
creating the new `PREPARED` journal. The old manifest, invocation, object
targets, transition, and failure remain durable and non-successful. Accepted
SC-D26 and SC-D27 allow only the closed recovery matrix defined by the Secure
Content architecture. The corrected source's fresh manifest binds the
predecessor manifest and pre-transition journal digest; fresh invocation
admission atomically writes an append-only replacement receipt, terminalizes
the predecessor as `RECOVERY_REPLACED`, and creates the fresh `PREPARED`
journal. The successor post-audit must also verify every predecessor object
target across the bounded, cycle-free predecessor chain through its original
owner. A bounded owner-controlled migration must materialize receipts for the
already-created W12A chain and be removed before the final source freeze.
Every other post-commit journal remains non-replaceable and must resume from
its original manifest.

The reopen operation validates the Plan before atomic replacement and again
after replacement. It retains the immutable Plan initial HEAD. It is a
mechanical lifecycle repair derived from SC-D24 source invalidation, not a
compatibility path or evidence rewrite.

## Evidence Closure

- W12A source: `development/secure-content/W12A/source/<generation>/result.json`.
- W12A activation children:
  `development/secure-content/W12A/activation/<generation>/<profile>/<reset-id>/`.
- W12A aggregate:
  `development/secure-content/W12A/activation/<generation>/aggregate/result.json`.
- W12 final-cut children:
  `development/secure-content/W12/final-cut/<generation>/<profile>/<reset-id>/`.
- W12 product children:
  `development/secure-content/W12/product/<generation>/<variant>/<run-id>/result.json`
  for Desktop, Browser, iOS, Android, Chat Desktop, Chat iOS, and Chat Android.
- W12 aggregate:
  `development/secure-content/W12/aggregate/<generation>/result.json`.

Every child path is immutable with one final writer. Aggregates bind child
digests and never overwrite children. Reset retries preserve the reset ID and
add a fresh invocation artifact; product retries use a fresh run ID. The live
Station reset journal is mutable truth in the Station database, while the
Development reset owner exports `completed-reset-journal.json` exactly once
after `COMPLETE`.

## Declaration Projection

Every generated Development declaration carries the immutable Plan path and
the parent Schema V2 task locator:

| Work-item projection | Bound Plan task | Runtime authority |
|---|---|---|
| `W12A` / `W12B` / `W12C` | same-named task | bounded source/runtime-owner implementation; no product proof |
| `W12D` | `W12D` | source freeze and aggregate; no direct reset claim |
| `W12A-FOUR` | `W12D` | `four` plus `station-four-social-private` only |
| `W12A-FIVEARM` | `W12D` | `fiveArm` plus `station-five-arm-social-private` only |
| `W7` / `W8` / `W9` / `W10` / `W11` | same-named task | functional runtime only; source is read-only |
| `W2` | `W2` | one Desktop/iOS/Android Suite Runtime |
| `W12F-FOUR` | `W12` | `four` plus `station-four-social-private` only |
| `W12F-FIVEARM` | `W12` | `fiveArm` plus `station-five-arm-social-private` only |
| `W12` | `W12` | product children and aggregate; no reset claims |

W12A-W12C source implementation extends the work-item projection with this explicit
parent task identity and makes `execute_projection` pass `--plan` and `--task`
to the machine-wide declaration owner. Prefix inference is forbidden.

Each W12A-W12C source declaration is created directly through the existing
Plan-aware `make dev-start ... PLAN=<path> TASK=<current-task>` path. That source step
implements and verifies the work-item parent-task field before any profile
projection or destructive command may start. It also implements dedicated W12
final adapters whose work-item identity and evidence root are W12-owned; the
final matrix does not reuse W7/W9 child ownership.

## Execution Order

1. Complete W12E generic Acceptance Suite Runtime, validation, audit Skill, and knowledge.
2. Complete W12S Secure Content Suite injection and W8/W9 plan migration.
3. Complete W12A Mobile private publish/read/recovery source.
4. Complete W12B private Comment, media, subtype, lifecycle, and bounds source.
5. Complete W12C owner-produced Desktop/iOS/Android manifests and Fixtures for
   every W7-W12 Suite Runtime.
6. Run W12D full source matrix once, publish one immutable build/source
   generation, and activate/deploy `four` then `fiveArm` serially exactly once
   for that generation.
7. Replay W7, W8, W9, W2, W10, and W11 on that exact generation. Each Task
   uses one Suite Runtime and never rebuilds or redeploys an already-attested
   generation.
8. Run W12 fresh `FINAL_CUT` serially for `four` then `fiveArm`, then execute
   one post-cut Suite Runtime for the complete product matrix.
9. Promote the same final source through W13 formal Acceptance. Read-only Gate
   crosswalk and evidence-integrity preparation may run in parallel with W12,
   but no W13 Gate starts before W12 reaches `FUNCTIONAL_PASS`.

## Runtime Reuse Model

- W12D owns one immutable build/source generation and the only pre-final
  deployment per Profile; W7-W11 only attest and attach.
- W7-W12 each own one Suite Runtime. Build/install, accounts, clients, storage,
  login, attestations, and one Fixture Epoch are created once before its first
  attach-only Scenario.
- Scenarios are attach-only. Any required cleanup occurs after receiver
  evidence and affects only the Scenario's owner-controlled namespace.
  Product restarts are recorded client replacements, not Suite reprovisioning.
- Task handoff releases all mutable runtime resources. Only content-addressed
  artifacts and the exact deployment generation cross Task boundaries.
- Both W12 FINAL_CUT children precede a new post-cut Suite. Product children
  bind their reset IDs, result/schema digests, service identities, and Fixture
  Epoch. W13 creates independent formal Gate runs; it cannot relabel W12 proof.

## Concurrency Decision

- W12E and W12S are serial because the business injection consumes the
  generic contract. W12E may not import or encode Secure Content semantics.
- W12A-W12C source completion may use parallel agents only for disjoint code paths;
  the integrator owns shared contracts, generated outputs, Plan files, and the
  source-freeze checkpoint.
- W12D schema activation is serial across `four` and `fiveArm`; each profile
  uses an independent work item and declaration with one scope authorization,
  reset ID, manifest, journal, invocation sequence, and `station.reset` lease.
- Runtime execution is serial for shared Profile, Station, Fixture, client
  storage, slot, Suite, FINAL_CUT, Actor, Appium, or port ownership.
- Source-only work and W13 read-only Acceptance preparation may run in parallel
  only when their declared write sets are disjoint and every runtime successor
  remains dependency-parked.

## Completion

- Every remaining Task, including W12D activation and the independent W12 final
  cut, reaches `done`.
- W7-W12 required product Journeys have current exact-source
  `FUNCTIONAL_CHECK/PASS`.
- W13 records current formal `ACCEPTANCE_PROOF` for `SC-AS01..SC-AS16`.
- No legacy Secure Content route, schema, generated source, duplicate plan, or
  synthetic evidence remains.
