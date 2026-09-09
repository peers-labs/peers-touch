# GitHub Review Skill Freshness

status: active
owner: architecture
last_verified_at: 2026-09-09
covered_docs_hash: 7302856467be4229ff52e129db97fd2d63def579bf3cf3d2f2bd1b466a6a6a5d

covered_docs:
  - AGENTS.md
  - docs/README.md
  - docs/global/code-review-framework.md
  - docs/architecture/quality-framework
  - docs/architecture/acceptance-framework
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

Updating this file is a review act, not bookkeeping. The PR must explain whether the upstream change required a `SKILL.md` update, new fixture, or knowledge entry.

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
