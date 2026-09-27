# Secure Content Hard Cut

> **Status**: active
> **Branch**: feat/federation
> **Workspace ID**: 9eb2cb904c9ae460
> **Initial HEAD**: 2d54851f95994d717928105aca6470c30adf3657

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"SECURE-CONTENT-HARD-CUT-20260913","status":"active","binding":{"branch":"feat/federation","workspaceId":"9eb2cb904c9ae460","initialHead":"2d54851f95994d717928105aca6470c30adf3657"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/secure-content/design.md","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/data-model.md","docs/architecture/secure-content/integration.md","docs/architecture/secure-content/operations.md","docs/architecture/messaging-platform/product-definition.md","docs/architecture/messaging-platform/experience-contract.md","docs/architecture/messaging-platform/acceptance-matrix.md"],"decisions":["SC-D01","SC-D02","SC-D03","SC-D04","SC-D05","SC-D06","SC-D07","SC-D08","SC-D09","SC-D10","SC-D11","SC-D12","SC-D13","SC-D14","SC-D15","SC-D16","SC-D17","SC-D18","SC-D19","SC-D20","SC-D21","SC-D22","SC-D23","SC-D24","SC-D25","SC-D26","SC-D27","SC-D28"]},"scope":{"sourceClaims":[{"pathPrefix":".gitignore","mode":"exclusive-write"},{"pathPrefix":"AGENTS.md","mode":"exclusive-write"},{"pathPrefix":"Makefile","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/dev","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"apps/station","mode":"exclusive-write"},{"pathPrefix":"docs/architecture","mode":"exclusive-write"},{"pathPrefix":"docs/global","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"model","mode":"exclusive-write"},{"pathPrefix":"packages","mode":"exclusive-write"},{"pathPrefix":"tooling","mode":"exclusive-write"}],"nonGoals":["private Social federation","Conversation authority redesign","production data migration","synthetic runtime or Acceptance evidence","push, pull request, or history rewrite before Owner authorization"]},"tasks":[{"id":"W0","workstreamId":"W0","path":"tasks/W0.md","dependsOn":[],"status":"done","blocker":null},{"id":"W0R","workstreamId":"W0R","path":"tasks/W0R.md","dependsOn":["W0"],"status":"done","blocker":null},{"id":"W14","workstreamId":"FOUNDATION","path":"tasks/W14.md","dependsOn":["W0"],"status":"done","blocker":null},{"id":"W1","workstreamId":"FOUNDATION","path":"tasks/W1.md","dependsOn":["W14"],"status":"done","blocker":null},{"id":"W2A","workstreamId":"W2","path":"tasks/W2A.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W3","workstreamId":"W3","path":"tasks/W3.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W4","workstreamId":"W4","path":"tasks/W4.md","dependsOn":["W1"],"status":"done","blocker":null},{"id":"W5","workstreamId":"W5","path":"tasks/W5.md","dependsOn":["W3"],"status":"done","blocker":null},{"id":"W6","workstreamId":"W6","path":"tasks/W6.md","dependsOn":["W4","W5"],"status":"done","blocker":null},{"id":"W7A","workstreamId":"W7A","path":"tasks/W7A.md","dependsOn":["W3","W5"],"status":"done","blocker":null},{"id":"W7S","workstreamId":"W7","path":"tasks/W7S.md","dependsOn":["W6","W7A"],"status":"done","blocker":null},{"id":"W7R","workstreamId":"W7","path":"tasks/W7R.md","dependsOn":["W0R","W7S"],"status":"done","blocker":null},{"id":"W11-SOURCE","workstreamId":"W11","path":"tasks/W11-SOURCE.md","dependsOn":["W7R"],"status":"done","blocker":null},{"id":"W12A","workstreamId":"W12A","path":"tasks/W12A.md","dependsOn":["W7R","W11-SOURCE"],"status":"done","blocker":null},{"id":"W7","workstreamId":"W7","path":"tasks/W7.md","dependsOn":["W7S","W7R","W12A"],"status":"in_progress","blocker":null},{"id":"W8","workstreamId":"W8","path":"tasks/W8.md","dependsOn":["W7"],"status":"pending","blocker":null},{"id":"W9","workstreamId":"W9","path":"tasks/W9.md","dependsOn":["W8"],"status":"pending","blocker":null},{"id":"W2","workstreamId":"W2","path":"tasks/W2.md","dependsOn":["W2A","W9"],"status":"pending","blocker":null},{"id":"W10","workstreamId":"W10","path":"tasks/W10.md","dependsOn":["W2","W9"],"status":"pending","blocker":null},{"id":"W11","workstreamId":"W11","path":"tasks/W11.md","dependsOn":["W8","W9","W10","W11-SOURCE"],"status":"pending","blocker":null},{"id":"W12","workstreamId":"W12","path":"tasks/W12.md","dependsOn":["W11","W12A"],"status":"pending","blocker":null},{"id":"W13","workstreamId":"W13","path":"tasks/W13.md","dependsOn":["W12"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":["station-four-social-private","station-five-arm-social-private"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "w0-governance": [],
    "w0r-runtime-control": [],
    "w14-generator": [],
    "w1-contracts": [],
    "w2a-kernel": [],
    "w3-prekeys": [],
    "w4-auth": [],
    "w5-recovery": [],
    "w6-social-minimum": [],
    "w7a-prekey-client": [],
    "w7s-desktop-source": [],
    "w7r-runtime-owner": [],
    "w11-source-hardcut": [],
    "w12a-schema-activation": [],
    "w7-functional": [],
    "w8-closure": [],
    "w9-closure": [],
    "w2-closure": [],
    "w10-chat": [],
    "w11-functional": [],
    "w12-final": [],
    "w13-acceptance": ["SC-AS01", "SC-AS02", "SC-AS03", "SC-AS04", "SC-AS05", "SC-AS06", "SC-AS07", "SC-AS08", "SC-AS09", "SC-AS10", "SC-AS11", "SC-AS12", "SC-AS13", "SC-AS14", "SC-AS15", "SC-AS16"]
  },
  "completion": ["SC-AS01", "SC-AS02", "SC-AS03", "SC-AS04", "SC-AS05", "SC-AS06", "SC-AS07", "SC-AS08", "SC-AS09", "SC-AS10", "SC-AS11", "SC-AS12", "SC-AS13", "SC-AS14", "SC-AS15", "SC-AS16"],
  "full": ["SC-AS01", "SC-AS02", "SC-AS03", "SC-AS04", "SC-AS05", "SC-AS06", "SC-AS07", "SC-AS08", "SC-AS09", "SC-AS10", "SC-AS11", "SC-AS12", "SC-AS13", "SC-AS14", "SC-AS15", "SC-AS16"]
}
```

## Goal

Deliver E2EE private Social content through one portable crypto implementation
while Social and Conversation retain independent route, transaction, table,
grant, and object authorities.

## Current Snapshot

- The accepted SC-D24 amendment preserves `13` completed closures while adding
  one explicit schema-activation closure, for a current `13/22` baseline.
- W7 runtime-owner source and the real owner-produced Fixture Manifest are
  complete. The focused W7 suite passes `146` tests with `1` skipped.
- W7 exact-source execution now reaches the canonical private Post insert after
  prepare, Content PreKey claim validation, envelope verification, and commit
  proof construction.
- W12A is the current plan frontier and the only remaining source-mutation
  owner before final cut. It completes and freezes all W7-W11 source, implements
  the one SC-D23 reset owner, non-public Station maintenance CLI, schema
  attestation, and runtime admission, then runs serial `SCHEMA_ACTIVATION`
  through independent `W12A-FOUR` and `W12A-FIVEARM` declarations.
- W7 product execution remains `UNPROVEN` and dependency-parked until W12A
  completes. No compatibility writer, nullable/default legacy field, alternate
  table, direct SQL path, or activation-as-final-cut evidence is permitted.
- W8 Private Comment source is complete, but all W8 functional execution remains
  behind W7 `FUNCTIONAL_PASS`.
- W9, W2 remaining Native proof, W10, W11 functional proof, W12, and W13 remain
  dependency-parked.

## Workflow Dependency

`DWF-D18` and its versioned source-control model are superseded. The canonical
workflow source is the accepted, unversioned `DWF-D23` implementation in the
`peers-dev-workflow` worktree. Git, the Development declaration, the
Development Session checkpoint, and the workspace-owned active-work record
retain distinct ownership of source identity.

W12A cannot publish its source freeze or begin destructive activation until
that committed control plane is semantically integrated into this worktree.
The rollout must:

1. preserve the immutable Secure Content Plan binding and its `13/22` baseline;
2. remove internal workflow version fields and legacy host-specific scheduler
   references without changing external protocol versioning;
3. create the workspace-owned active-work record from the bound Plan,
   declaration, Session, and current Git checkpoint;
4. replace the obsolete external source-checkpoint command with the canonical
   Development Session checkpoint owner; and
5. pass the host-neutral rollout audit before W12A-FOUR is declared.

The attempted semantic merge of canonical commit `0187334d5` exposed
cross-branch product, persistence, and workflow conflicts, so it was aborted
rather than resolved by bulk `ours`/`theirs` selection. This remains an
external owner integration boundary, not permission to recreate DWF-D18 or a
Secure Content-specific workflow implementation.

## SC-D24 Impact Inventory

- Existing reusable control-plane assets:
  `tooling/scripts/local-dev/machine-dev.mjs` already owns the generic
  `station.reset` lease process, and
  `tooling/development/secure_content/work_item.py` already enforces exact
  Plan-task destructive scopes.
- Existing runtime assets:
  `tooling/development/secure_content/runtime_manifest.py` and
  `runtime_owner.py` already bind Station service attestations, but have no
  canonical-private-schema attestation field or admission check.
- Remaining source assets:
  W8 expansion, W9 Mobile matrix, W2/W10 Chat drivers and aggregate runners,
  and W11 cross-runtime aggregation must be completed under W12A before
  activation. The source-drift reopen transition must be expressed through the
  current DWF-D23 Plan, declaration, Session, and workspace-owned active-work
  owners during semantic integration. W7-W11 are functional-only after the
  freeze.
- Missing implementation assets:
  there is no Secure Content reset owner, reset manifest/journal model,
  non-public Station maintenance CLI, Social reset service, OSS reset adapter,
  schema attestation producer, or schema-attestation runtime admission.
- Existing owner services remain authoritative:
  Social owns database mutation, OSS owns legacy object deletion, Local Dev
  owns declarations and leases, and the Development owner owns reset
  orchestration and durable evidence.

## SC-D24 Dependency And Cutover

```text
W7R + W11-SOURCE
  -> W12A: shared reset owner + SCHEMA_ACTIVATION
  -> W7 -> W8 -> W9 -> W2/W10 -> W11
  -> W12: fresh FINAL_CUT + complete product matrix
  -> W13: formal Acceptance
```

| Concern | W12A activation closure | W12 final closure |
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
{"kind":"peers-touch-source-invalidation-policy","sourceOwnerTaskId":"W12A","rootTaskIds":["W7"]}
```

This Plan declares W12A as `source-owner` and W7 as its single
`invalidation-root`. The executable transition is:

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
2. derives W12A and W7 from the immutable Plan policy and publishes the
   immutable invalidation proof;
3. makes W12A the only `in_progress` task, returns W7 plus every transitive
   successor to `pending`, and appends canonical evidence-identity
   invalidations without rewriting evidence;
4. commits the lifecycle projection, transition chain, and `active_work` CAS,
   then terminalizes the transaction fence.

Only after that transition reaches `COMPLETE` may the Development Workflow
start a W12A `SOURCE_MUTATION` declaration, apply the root fix, record a clean
Development Session checkpoint, synchronize workspace-owned active-work, and
complete both independent profile activations before W7 restarts.

If the source defect is discovered by W12A activation after its Station journal
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
| `W12A` | `W12A` | source only; no runtime/reset claims |
| `W12A-FOUR` | `W12A` | `four` plus `station-four-social-private` only |
| `W12A-FIVEARM` | `W12A` | `fiveArm` plus `station-five-arm-social-private` only |
| `W7` / `W8` / `W9` / `W10` / `W11` | same-named task | functional runtime only; source is read-only |
| `W2B-DESKTOP` / `W2B-MOBILE` | `W2` | platform-specific functional runtime only |
| `W12F-FOUR` | `W12` | `four` plus `station-four-social-private` only |
| `W12F-FIVEARM` | `W12` | `fiveArm` plus `station-five-arm-social-private` only |
| `W12` | `W12` | product children and aggregate; no reset claims |

W12A source implementation extends the work-item projection with this explicit
parent task identity and makes `execute_projection` pass `--plan` and `--task`
to the machine-wide declaration owner. Prefix inference is forbidden.

The initial W12A source declaration is created directly through the existing
Plan-aware `make dev-start ... PLAN=<path> TASK=W12A` path. That source step
implements and verifies the work-item parent-task field before any profile
projection or destructive command may start. It also implements dedicated W12
final adapters whose work-item identity and evidence root are W12-owned; the
final matrix does not reuse W7/W9 child ownership.

## Execution Order

1. Semantically integrate the separately owned unversioned DWF-D23 control
   plane, migrate this Plan and its Task Slices to the one current shape, and
   synchronize the workspace-owned active-work record without changing the
   22-task denominator or 13 completed closures.
2. Complete and freeze all remaining W7-W11 source under W12A.
3. Complete W12A reset-owner source, schema-attestation admission, and serial
   `SCHEMA_ACTIVATION` through `W12A-FOUR` then `W12A-FIVEARM`.
4. Resume W7 with the real Fixture Manifest and prove Desktop restart plus
   Browser continuity against current schema attestations.
5. Complete W8 receiver-visible Desktop Journeys.
6. Complete W9 Mobile parity, then the remaining W2 and W10 Chat proof.
7. Run W11 full hard-cut regression, W12 fresh `FINAL_CUT` plus complete product
   matrix, and W13 formal Acceptance.

## Concurrency Decision

- W12A source completion may use parallel agents only for disjoint code paths;
  the integrator owns shared contracts, generated outputs, Plan files, and the
  source-freeze checkpoint.
- W12A schema activation is serial across `four` and `fiveArm`; each profile
  uses an independent work item and declaration with one scope authorization,
  reset ID, manifest, journal, invocation sequence, and `station.reset` lease.
- Runtime execution remains serial for every shared Profile, Station, Fixture,
  client storage, and local slot.
- Source-only work may run in parallel only when its declared write sets are
  disjoint and its functional successor remains dependency-parked.
- The integrator owns this Plan Package, shared manifests, checkpoints, and
  final reconciliation.

## Completion

- Every remaining Task, including W12A activation and the independent W12 final
  cut, reaches `done`.
- W7-W12 required product Journeys have current exact-source
  `FUNCTIONAL_CHECK/PASS`.
- W13 records current formal `ACCEPTANCE_PROOF` for `SC-AS01..SC-AS16`.
- No legacy Secure Content route, schema, generated source, duplicate plan, or
  synthetic evidence remains.
