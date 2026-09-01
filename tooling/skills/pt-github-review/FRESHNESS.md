# GitHub Review Skill Freshness

status: active
owner: architecture
last_verified_at: 2026-09-01
covered_docs_hash: 10057c38905bf7ed85ade653738b98f1e2e1848fa754687c1b75bb7b93e4140f

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
