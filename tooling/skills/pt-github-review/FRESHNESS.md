# GitHub Review Skill Freshness

status: active
owner: architecture
last_verified_at: 2026-10-03
covered_docs_hash: 418edd87d9787ca37bc22b973ccb0b8282ad5af8ce08883a345823da4c6f9205

covered_docs:
  - AGENTS.md
  - docs/README.md
  - docs/global/code-review-framework.md
  - docs/architecture/quality-framework
  - docs/architecture/acceptance-framework
  - docs/architecture/development-workflow
  - docs/architecture/local-dev-control-plane
  - docs/global/local-dev-environment.md
  - docs/global/architecture.md
  - docs/client/desktop/base.md
  - docs/client/desktop/runtime-projections.md
  - docs/client/mobile/base.md
  - docs/station/base.md
  - docs/global/coding-guide/common
  - docs/global/coding-guide/desktop
  - docs/global/coding-guide/mobile
  - docs/global/coding-guide/station
  - docs/knowledge/README.md

## Freshness Contract

`tooling/scripts/review/skill-check.sh` recomputes `covered_docs_hash` from the paths above. If any upstream rule changes, the hash changes and the check fails until this skill is reviewed.

Updating this file is a review act, not bookkeeping. Execution Plan files are excluded because mutable Task lifecycle is not an upstream review rule. The PR must explain whether the upstream change required a `SKILL.md` update, new fixture, or knowledge entry.

## 2026-10-04 Review

Agent integration replacement now treats Development declarations as durable
intent rather than in-flight hook activity. Live child assignments, workflow
actions, and Action Store locks remain blocking. When declarations are live,
legacy conversation/action history remains inert and cleanup is deferred to a
later declaration-free installation. Existing review rules already reject
parallel workflow authority and unguarded hook replacement; the installer
regression covers concurrent declaration preservation, so no `SKILL.md` or
generic review fixture change is required.

## 2026-10-03 Review

`AGENTS.md` registers the governed OAuth2 Client Vercel publishing Skill.
Existing review rules already cover secrets, architecture ownership, runtime
evidence, and canonical Skill sources. The Skill's deterministic tests cover
frontmatter, registration, provider drift, stdin-only secret sync, and
deployment verification, so no `pt-github-review` behavior or fixture change
is required.

## 2026-10-02 Review

The Agent architecture is now registered as an active module with an explicit
minimum-usable chat capability and current root documentation. Existing review
rules already cover architecture ownership, source containment, exact-source
evidence, and generated contracts, so no `SKILL.md` or fixture change is
required.

## 2026-10-01 Review

Owner-rooted workflow binding review now additionally requires atomic OWNER
publication, exact current Development Session validation before child
assignment, one atomic execution-session claim per assignment,
latest-per-action Completion Review selection, persisted PreCompact/PostCompact
lineage continuity in one receipt per binding, and a one-time installer grant
tied to the exact live OWNER `skills` action. Installer lifecycle state must be
published before destructive reset, fallible preflight must precede grant
consumption, and reset failure must remain observable as `BLOCKED`. `SKILL.md`
and the owner-rooted invariant now carry these checks; dedicated workflow and
installer regressions cover each failure mode. Completion Review schema v2 also
uses a new canonical namespace, so pre-hard-cut requests are preserved but
never loaded or migrated.

Owner-rooted workflow binding replaced peer conversation bindings. Review now
requires canonical OWNER/WORKER/REVIEWER lineage, exact current Action Receipt
selection, live assigned reviewers, and no worktree-wide identity fallback.
TRAE multi-root review also requires one descriptor-selected bootstrap,
target-derived owner selection, active-editor mismatch rejection, global-idle
hard-cut admission, and deletion limited to the old conversation and Action
Receipt stores. `SKILL.md`, workflow regression fixtures, and the owner-rooted
invariant cover the new omission, stale-child, and bootstrap-authority risks.

Resource-plan selection no longer treats healthy reusable inventory as
Runtime Owner readiness, and incompatible non-null digest expectations cannot
be merged onto one physical resource. Planner-owned lease admission now also
requires complete allocation fences and one matching `READY` result, rejecting
pending or quarantined resources. Existing runtime ownership, exact-source
identity, and fail-closed resource conflict rules already cover this behavior.
Dedicated resource-plan and lease-admission regressions prove these boundaries;
no `SKILL.md`, generic review fixture, or additional knowledge entry is
required.

## 2026-09-30 Review

Development Workflow and Local Dev Control Plane are now registered in the
central architecture module registry. Their existing accepted decisions were
normalized to the ADR-lite document contract without changing behavior; this
adds fail-closed ownership discovery and requires no GitHub Review rule change.

Completion Review now derives a deterministic fixed-point blocked candidate
when a successful Task has no ready successor but other Plan branches remain
blocked. The Plan lifecycle owner still performs the atomic transition and
verifies the exact candidate digest.

Independent completion review found that per-target greedy allocation could
park a constrained target despite a feasible wave-level assignment. Mandatory
demand now uses deterministic global matching with constrained-target priority;
the pinned-versus-flexible regression is part of the resource-plan suite.

The superseded skill-rollout implementation was removed after all live setup,
audit, and host projection ownership moved to agent-integration. Historical
Plan references remain documentation only and are excluded from live routing.

`DWF-D32` adds one Dev Workflow-owned cross-module resource-plan contract.
Module Skills emit declarative impact, the existing machine declaration ledger
holds concrete intent, and Local Dev or Acceptance Suite Runtime retains
physical lifecycle ownership. Review must reject module-owned provisioning,
partial target reservations, optional-demand starvation, stale fencing results,
missing-receipt provenance adoption, bare-ID result joins, and business Gate
lifecycle actions. The new resource-plan and Agent-impact tests cover those boundaries;
no GitHub Review severity or fixture schema change is required.

`pt-agent-development` adds an Agent-domain policy for deterministic impact
classification, proof reuse, minimal deployment, ownership splitting, and
failure attribution inside the existing Development Workflow. It does not
change GitHub Review severity or ownership. The co-located policy tests and
18-commit MCA-P04 replay fixture provide the required regression coverage; no
generic review fixture or `pt-github-review/SKILL.md` change is required.

## 2026-09-29 Review

Authored source changes now route through `pt-code-structure-review`. The
specialist uses stable `STRUCT-01` through `STRUCT-09` rule IDs, explicit
blocking conditions and exceptions, schema-validated positive, blocking, and
false-positive anchors, and advisory-only structural signals. Its decision is
bound to source and rubric identity before quality evidence and GitHub Review
consume it. Fixture schema validation is not presented as cross-model proof.
The review interface now accepts one range, path/depth, or PR selector and
derives file classification, advisory signals, source identity, rubric hash,
verdict fields, and per-file coverage. Reviewers submit semantic findings only;
the source-bound and fail-closed requirements are unchanged.

## 2026-09-29 Suite Runtime Review

Acceptance Framework D-21 adds a closed, domain-neutral Suite Runtime contract
for multi-scenario lifecycle reuse. Review must reject Scenario-owned build,
deploy, account, client/device launch, storage, or login; Harness-only product
proof; missing receiver assertions; unbounded launch counts; and incomplete
cleanup. The new `pt-acceptance-pipeline-auditor`, Plan schema regressions,
Suite Runtime unit tests, and operational invariant provide deterministic
coverage. Existing GitHub Review severity and evidence rules remain valid, so
no `pt-github-review/SKILL.md` or golden fixture change is required.

## 2026-09-28 Review

Local Dev Control Plane schema v1 excludes mutable Git HEAD from machine
registration authority without a development-stage version bump or compatibility
reader. Review rejects persisted HEAD and command-specific reconciliation while
preserving declaration/Session source fencing, exact runtime build readback, and
fail-closed root/branch identity.

Desktop development startup now treats Vite and Tauri as one managed runtime:
only a complete source-matched pair is reusable, partial pairs are reconciled
before port checks, and required generated bindings are prepared through the
canonical model generator. The machine control-plane Gate owns the regression;
no GitHub Review `SKILL.md` rule change is required.

Desktop navigation ownership now removes the standalone Notes host page and
makes Settings the sole owner of My Files, Cron Jobs, Channels, and Command
Palette access. The dedicated browser Gate has an exact-source Runtime Manifest
and cleanup contract, while the official Note applet remains unchanged.
Existing Desktop, locale, source-of-truth, and Acceptance evidence rules already
cover this change, so no `SKILL.md` or review fixture update is required.

## 2026-10-01 Review

The documentation index now registers the OAuth Login Broker architecture.
Existing review rules already cover architecture ownership, encrypted
credential storage, exact-source Acceptance, and evidence freshness, so no
`SKILL.md`, review fixture, or knowledge entry is required.

## 2026-09-28 Review

Desktop navigation ownership now removes the standalone Notes host page and
makes Settings the sole owner of My Files, Cron Jobs, Channels, and Command
Palette access. The dedicated browser Gate has an exact-source Runtime Manifest
and cleanup contract, while the official Note applet remains unchanged.
Existing Desktop, locale, source-of-truth, and Acceptance evidence rules already
cover this change, so no `SKILL.md` or review fixture update is required.

## 2026-09-27 Review

LDCP-D15 remains the governing profile reset-policy contract. The control
plane, Peers Dev projection, local environment skill, and fixtures now derive
reset protection from the canonical Profile ID and no longer read the
superseded control-mode field. The existing review rule already enforces this
contract, so no GitHub Review `SKILL.md` or fixture change is required.

Architecture Module Governance adds a positive module registry and shared
changed-path validation to review. `pt-github-review/SKILL.md` now treats
unregistered, incomplete, overlapping, or capability-inconsistent active
modules as blocking architecture findings. Parser, Hook, Plan, Review and
integration-audit regressions provide executable coverage; no generic golden
review fixture is needed.

The `peers-touch-git` integration adds the reviewed Worktree Governance product,
state, experience, Acceptance and execution contracts under the existing Local
Dev Control Plane. Existing review rules already cover owner-state isolation,
worktree identity, destructive-operation authorization and evidence freshness,
so no `SKILL.md`, fixture or knowledge change is required.

## 2026-09-26 Review

The current upstream source set retains the existing review behavior for
runtime identity, profile authorization, Development Session evidence, and
continuous Plan execution. No `SKILL.md`, fixture, or knowledge change is
required; this refresh records the post-history-migration source bytes and the
Station Access coverage projection after its completion proof.

The 2026-08-29 refresh covers execution-status and evidence updates under the
Acceptance framework. It does not change review behavior, so no `SKILL.md`
change or additional review fixture is required.
## 2026-08-29 Review

`AGENTS.md` added the fail-closed Execution Worktree Binding contract. Local
review target establishment now verifies that persisted binding and stops on
identity drift. No fixture or knowledge entry is required because the
executable verifier and its dedicated contract tests own deterministic
coverage.

The Mobile agent-entry link cleanup removes developer-home absolute paths
without changing review behavior.

## 2026-09-01 Review

D-18 now requires explicit evidence-run ownership, bounded process-group
extinction, parent-only Mobile Harness actions, and closed nested response
schemas. These strengthen existing security and lifecycle checks without
changing the review workflow or requiring another fixture.

The Checkpoint 2 review additionally applies bounded process-group extinction
to Mobile build commands and requires freeze-review receipts to conform to the
governing closed v1 schemas and digest domains. These strengthen existing
lifecycle and review-integrity checks without changing the review workflow.

The final Checkpoint 2 transport review requires monotonic end-to-end receive
deadlines and mandatory byte ceilings for every Appium response, including
page source and HTTP error bodies. This strengthens the existing bounded-I/O
review rule without changing the review workflow.

The transport closure further requires incremental body reads so trickle
traffic cannot extend a total deadline, plus unconditional response closure on
HTTP error paths. No review workflow change or additional fixture is required.

The final deadline closure requires finite launch timeout inputs, bounded
post-handshake request-frame reads, and propagation of one capability deadline
through nested parent-side Appium operations. It also closes Appium status
`HTTPError` responses. These refine the existing lifecycle review criteria
without changing the review workflow.

The r20 closure additionally requires an authenticated absolute wire deadline,
typed timeout preservation, cancellation-aware HTTP and lease waits, bounded
resource-lock acquisition, and retained cleanup ownership for partially
created Appium sessions. These strengthen existing lifecycle and authority
review criteria without changing the review workflow or requiring a new
fixture.

The r23 closure adds bounded channel-lifetime request-ID replay protection and
requires child-side polling facades to derive every nested operation timeout
from one absolute deadline. These refine existing replay and deadline review
criteria without changing the review workflow.

The r25 closure requires a stable authenticated persistent-ledger key, one
absolute deadline across parent cleanup, rejection of handler completion
observed after its deadline, and path-key ordering for source manifests. These
strengthen existing authority, lifecycle, and review-integrity checks without
changing the review workflow or requiring a new fixture.

The r28 closure requires an explicit non-sensitive environment allowlist for
context-enabled Gate children and carries the parent cleanup deadline and
cancellation signal through Station reset verification and its process group.
Dedicated regressions now cover secret exclusion and cancelled reset cleanup.

The r29 closure applies the same fail-closed environment and process-tree
requirements to direct context launches and deployment-owned Station Fixture
commands. It also requires complete, idempotent closure evidence for Mobile
resource-lease broker, ledger, descriptor, and authentication-key owners, and
requires governing-source manifests to be regenerated from current pack-local
bytes before review input is sealed.

## 2026-09-02 Review

D-19 introduces canonical result algebra, protected evidence-finalizer
registration, and finalization-aware proof admission. Review must verify strict
JSON decoding for every authority-bearing input, exact executable source
identity without module/package shadowing, and rejection of required-finalizer
`PROVEN` manifests whose finalization record, identity digests, finalizer ID, or
published tuple does not match the protected binding. Dedicated planner,
validator, registry, and coverage regressions own these checks.

## 2026-09-09 Review

Runtime Provisioning WS2/WS3 and Ephemeral Launch Context EGLC-W1/W3/W4 were
reopened for current-source self-validation repair. Strict SSH host
verification, git-tracked source identity, generated-report exclusion, and
cross-process monotonic deadline translation strengthen existing review
requirements without changing review workflow or requiring a new review
fixture. Final aggregate closure also requires source identity in the run report
and allows only an exact current-source result envelope to supersede stale
historical evidence; stale latest evidence still fails closed without that
envelope.

The C08 fresh-process correction makes the existing dependency direction
explicit: Core attestation validates an injected remote source identity, while
concrete Provisioners own strict-known-host SSH acquisition. A dedicated
fresh-process regression and operational pitfall now guard the boundary. This
strengthens structural review without changing the review workflow or requiring
a new golden review fixture.

The native Driver follow-up makes caller-owned run storage explicit for
runtime logs. Review must verify that business Gates consume `TauriDriver`
through bounded `argv` launch, retain the catalog timeout, and remove the old
Gate-owned `make desktop` process path rather than adding a fallback. Existing
Driver and launch-context regressions cover the generic lifecycle contract; no
new review workflow or golden fixture is required.

Execution governance now requires an explicit concurrency decision for every
implementation slice. Review must reject parallelism without dependency,
write-set, generated-output, shared-resource, verification, and integration
analysis; it must also reject unexplained serialization, stale-agent metadata
promoted to a blanket spawn ban, overlapping write sets, or missing integrator
reconciliation. Context Anchors now expose completed delta, ready queue,
execution mode and lanes, conflict controls, critical path, and an
evidence-backed ETA or `unknown`; resume synchronization must not interrupt
already-authorized execution. These changes update review behavior directly,
so `pt-github-review/SKILL.md` was updated; no new golden fixture is required
because `review/skill-check.sh` enforces the canonical Skill, Goal template,
Goal rubric, and Anchor markers directly.

Goal execution now uses an adaptive Ready/Parked queue and requires fixed-point
exhaustion before a tracked Goal can be marked blocked. This changes execution
orchestration, not PR review severity or evidence semantics, so the existing
review skill and fixtures remain sufficient.

The Mobile Acceptance coverage update adds lifecycle and native-platform
surfaces while preserving the existing rule that unrun physical or destructive
Gates remain explicitly `UNPROVEN`.

## 2026-09-10 Review

The Conversation Authority and native Desktop runtime-cell consolidation
strengthens existing ownership, exact-source, platform identity, and cleanup
requirements. The review skill already covers those checks, so no workflow or
fixture change is required.

## 2026-09-13 Review

Development Workflow now separates public resource intent, exact-source
functional Journeys, formal Acceptance proof and delivery review. This changes
execution and completion discipline, while PR review continues to consume
formal Acceptance and quality evidence rather than machine-local Development
records. `pt-dev-workflow`, its specialist Skills and `pt-completion-auditor`
were updated; `pt-github-review/SKILL.md` needs no behavior change. The canonical
skill check now enforces declaration, functional-fence, first-failure and
release markers directly.

Machine Dev Control Plane and Acceptance Evidence Store changes make
repository-root debug artifacts, Station profile bypasses, and unauthorized
environment creation explicit violations. `pt-github-review/SKILL.md` now
treats all three as blocking hard rules, and `review/skill-check.sh` pins their
markers. Local Dev architecture and the global environment specification are
now covered freshness sources.

No new golden fixture is required for unauthorized environment creation because
the decisive approval is a human-created exact-tuple machine grant rather than
diff content. Focused Local Dev tests prove non-interactive grant rejection,
single-use consumption, untracked env rejection, and profile-digest binding.
Remote deployment and Foundation restart now resolve only unique,
Git-tracked-clean env-repository definitions; arbitrary profile-file overrides
are confined to declared Acceptance runtime roots. Existing repository hygiene
checks and profile-only startup invariants own the other two rules.

## 2026-09-14 Review

DWF-D13 corrects source-claim isolation: overlapping writes in independent
worktrees on different branches emit a coordination warning instead of
blocking development. Same-workspace overlap, same-branch writes, and exclusive
runtime resources remain fail-closed. This changes development coordination,
not PR review severity or evidence semantics, so no review fixture or
`pt-github-review/SKILL.md` behavior change is required.

## 2026-09-15 Review

The covered-document drift records source-bound Native Desktop Runtime evidence,
scope boundaries, and navigation to the already-reviewed cross-platform
`devctl` architecture. It does not change PR review severity, ownership, or
evidence semantics. Existing Acceptance review rules and the
`station-profile-bypass` and `unauthorized-environment-creation` hard rules
already cover these changes, so no `pt-github-review/SKILL.md` update or new
review fixture is required.

## 2026-09-16 Review

PR #112 reconciliation combines the reviewed Native Desktop and Mobile
reliability contracts with the Secure Content hard cut and Machine Dev Control
Plane. The merged sources preserve existing review severity, exact-source
evidence, environment authorization, source-of-truth ownership, and old-path
deletion rules. No `pt-github-review/SKILL.md` behavior or fixture change is
required.

The Development Skill responsibility refinement makes `pt-god-view` a thin
router, `pt-dev-workflow` the sole Development Run application service,
`pt-goal-orchestrator` the host-neutral scheduler,
`pt-execution-plan-guardian` a read-only policy guard, and
`pt-context-anchor` a read-only projection. Host-specific worker and UI tools
are isolated behind `pt-*-host-adapter` Skills. PLAN is split between vertical
dependency modeling and repository persistence.
Review severity is unchanged, but review must reject any change that lets the
router, scheduler, policy guard, or projection mutate durable workflow state,
or that restores a generic five-variant Acceptance requirement.

The follow-up review makes every non-trivial stage dispatch through
`pt-dev-workflow` and requires `acceptance-aggregate` work to reference current
functional proof for every product Journey it aggregates. These changes close
workflow bypasses without changing PR review severity or adding a new review
fixture.

The W2 Home slice registers `homeRuntime` as the owner of the Station-backed
Home projection while retaining the existing `eager + forever` page lifetime.
This changes projection ownership, not review severity; runtime, store, and
page-descriptor checks cover the boundary without a new review fixture.

## 2026-09-17 Review

Progress-bearing continuation makes Task closure the user-facing progress unit,
derives the exact next completion effect through `planctl status`, and prevents
Context Anchor from returning successful zero-delta administrative actions.
Profile Agent control and the read-only Development Control Plane dashboard
refine Local Dev operation policy without weakening declaration, capability,
lease, reset-scope, source-identity, or evidence rules. The dashboard now uses
one worktree-first projection for requirements, Journeys and runtime resources,
with profile occupancy retained as a secondary capacity view. PR review
severity and fixtures remain unchanged; `review/skill-check.sh`, Plan tests,
Local Dev tests, and dashboard tests own the executable contract.

Peers Dev now owns that projection as a first-class `apps/dev` application with
one fixed machine endpoint and a fail-closed server identity contract. Concurrent
read-only lease observers use shared locks so they do not impersonate live
exclusive holders. These changes preserve existing review severity and require
no new review fixture.

Plan-aware observability adds an explicit declaration-to-Plan locator, a
read-only Development Session bridge for mixed-version rollout, typed legacy
and stale states, and separate work versus environment projections. Review must
reject inferred percentages, hidden stale work, environment failures presented
as Task failure, absolute Plan path exposure, or server identities that omit
dirty source state. Existing Local Dev, Plan, Peers Dev, redaction, and visual
regressions cover these rules; no new generic review fixture is required.

DWF-D17 removes repository-wide sibling worktree inventory from immutable
execution identity. Review still fails closed on canonical root, branch,
workspace and expected-HEAD drift, while unrelated worktree add/remove/prune
operations no longer invalidate another task. The verifier integration test,
Plan/Session/migration suites, and contract checks cover the hard cut; review
severity and golden fixtures remain unchanged.

## 2026-09-18 Review

DWF-D18 makes workspace-to-Plan ownership a machine-local create-once binding.
Review must reject branch/repository Plan scans, synchronized foreign Plan
selection, locator-less declarations after binding, and any unbind/rebind path.
`pt-github-review/SKILL.md` now requires an explicit PR `Execution Plans` list;
CI validates every listed path instead of scanning the branch. Dedicated Node,
Python, PR-input and Development declaration regressions cover the contract, so
no new golden review fixture is required.

DWF-D19 removes advancing `expectedHead` from tracked Plan Packages. Review
must reject workflow version labels and any attempt to move current source identity
back into `plan.md`; declarations, Sessions and `active_work` retain their
separate source-identity duties. The review Skill now states this hard cut, and
the Plan, migration, Session and dashboard regressions provide executable
coverage without a new golden fixture. A declaration may retain only its exact
blocked/done Task locator while the corresponding Plan is blocked/completed so
cleanup and delivery can finish; this terminal allowance must not select a new
Task or reopen execution.

## 2026-09-19 Review

DWF-D20 makes one user-authorized Plan Run continuous across Task closures,
Goal Slices, internal stage reviews, Context Anchors, and context compaction.
Review verifies the Plan Run mandate, autonomous horizon, stop conditions,
successor continuation, and agent-led remediation loop.

DWF-D21 makes host-neutral ownership, complete current-closure Development
evidence, bounded host cleanup quarantine, and worktree-scoped Agent integration
review requirements. Review rejects caller-authored functional PASS files,
partial Gate promotion, direct Runtime-Handoff-to-adapter invocation,
repository-native fallback inside an adapter, live-session Skill replacement,
escaped Skill projections, and integration receipts not bound to a distinct host
session.

DWF-D22 separates the distributed implementation from consuming-worktree
runtime state. Review rejects any source or projection that turns
`peers-dev-workflow`, project memory, or chat into a mutable cross-workspace
progress owner.

DWF-D23 removes synthetic workflow releases and exposed Plan/Task/integration
schema numbers. Review rejects `vN`, `schemaVersion`, `_v2`, `_v3`, and
`next-gen` labels in current Development Workflow contracts while preserving
independently governed external protocol, package, Acceptance evidence, and
live machine-record integrity formats.

The DWF-D20 authorization refinement makes exact user grants and explicit
accepted Plan authorization reusable across Task, Goal, retry, context, and
host boundaries. Review must reject workflow rules that ask again solely
because an operation is sensitive, while preserving fail-closed denial for
out-of-envelope actions and typed handling of actual external permission
failures. Existing-profile deploy/reset behavior now consumes exact Plan
`deployProfiles` / `destructiveResetScopes` grants without weakening
environment-creation, declaration, capability, scope, or lease guards.
`pt-dev-workflow`, `pt-execution-plan-guardian`, `pt-local-dev-env`, the
continuous-Plan invariant, and `review/skill-check.sh` own direct enforcement;
no new generic review fixture or `pt-github-review/SKILL.md` behavior is
required.

The progress projection refinement makes `planctl` the sole calculator of the
post-Next completed count and percentage. Review now rejects Anchor or
dashboard consumers that add rounded percentages locally or count unlocked
pending Tasks as completed. `pt-github-review/SKILL.md`,
`pt-context-anchor/SKILL.md`, PlanCTL boundary tests, Peers Dev tests, and the
canonical Skill marker check cover the behavior; no generic review fixture is
required.

## 2026-09-21 Review

Host diagnostics now run only through an adapter-owned isolated sidecar. A
confirmation-retained diagnostic is a bounded, non-blocking host observation;
the deterministic project result, Session transition, Task closure, and
successor activation happen before host cleanup follow-up. This tightens the
existing DWF-D20/DWF-D21 review boundary without changing review severity or
requiring a new fixture. `review/skill-check.sh` rejects direct host-debugger
coupling in the parent workflow owners and pins the transient return contract.

DWF-D25 separates user interaction policy from canonical project Skills.
Review must reject personal behavior embedded in `pt-ew`, mutable-source
Overlay loading, symlinked packages, modified installed copies, user Overlay
projection through `make skills`, or Overlay instructions that change project
execution semantics. The dedicated control-plane tests and
`user-skill-overlays-are-interaction-only` invariant provide deterministic
coverage; no generic review fixture is required.

## 2026-09-22 Review

DWF-D26 adds a conversation-bound IDE integration boundary. Review must reject
global hook mutation, mutable execution-root pointers, treating tool `cwd` as
conversation identity, copied Skill corpora, project owner-state mutation
inside `workflow-kernel.mjs`, direct runtime-owner execution, regex-only shell
admission, or cross-worktree writes. Codex, Cursor and TRAE projection tests,
payload normalization tests, immutable binding races, subject-root isolation,
Anchor release, and typed denial tests provide deterministic coverage.

Acceptance D-20 now projects package `sourceClaims` through `planctl` and limits
registry impact to the bound Plan's exclusive-write closure. Review must reject
full-branch impact scans that reattach synchronized foreign work to this Plan,
while preserving undeclared-Gate drift checks inside owned paths.

## 2026-09-23 Review

LDCP-D15 adds workspace-local diagnostic observations and bounded Git worktree
reconciliation to Peers Dev. Review must reject promoting either source into
registration, runtime activity, authorization, workflow progression, or
Acceptance evidence, and must reject stale Owner branch/HEAD values overriding
current Git identity. Existing source-of-truth and runtime-projection review
rules already cover these judgments. The new worktree-observation invariant
and dedicated discovery, projection, hook, and Journey tests provide
deterministic regression coverage, so no Review Skill or fixture change is
required.
