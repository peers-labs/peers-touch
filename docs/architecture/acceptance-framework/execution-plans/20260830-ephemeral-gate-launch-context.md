# Ephemeral Gate Launch Context — Execution Plan

> **Status**: complete
> **Version**: v1.0
> **Created**: 2026-08-30 | **Updated**: 2026-08-30
> **Owner**: Acceptance Infrastructure
> **Branch**: `merge-desktop-prototype`
> **Parent Design**: [../design.md](../design.md)
> **Approved Decisions**: D-07, D-11, D-12, D-18
> **Approval**: approved for execution on 2026-08-30

---

## 1. Goal And Claims

Implement the accepted D-18 `EphemeralGateLaunchContext` as a generic
Acceptance Infra capability:

- Provisioners can retain process-local secrets and raw resource handles while
  an independently launched Gate invokes allowlisted operations.
- Runtime Manifest and Evidence Store remain the only durable runtime truth and
  never contain ephemeral authority.
- Context-enabled Gates launch through exact argv, `shell=False`, and an exact
  inherited-descriptor allowlist.
- Success, spawn failure, Gate failure, timeout, cancellation, protocol failure,
  and cleanup failure all have deterministic fail-closed behavior.
- Existing Gates without ephemeral capabilities preserve their current launch
  behavior.

This plan closes only the generic Infra prerequisite. It does not claim Mobile
E2-5 or E2-6 product proof.

## 2. Architecture Baseline

- `docs/architecture/acceptance-framework/design.md` §1.4, §2.2, §3.11,
  §4.13, §9
- `docs/architecture/acceptance-framework/decisions.md` D-07, D-11, D-12,
  D-18
- `docs/architecture/acceptance-framework/data-model.md` §19
- `docs/architecture/acceptance-framework/integration.md` §1.7 and D-18
  compatibility boundary
- `docs/architecture/acceptance-framework/module-layout.md`
- `docs/architecture/mobile/execution-plans/20260829-mobile-native-oauth-proof.md`
  E2-5 blocker and handoff

Accepted invariants:

- Parent Provisioner remains the only owner of raw handles and secret values.
- The child receives one run-scoped anonymous capability channel, not the
  underlying authority.
- Context identity binds workspace, Gate, Evidence Store run, and provisioning
  run independently.
- Context transport never falls back to Runtime Manifest, environment secret,
  filesystem, named socket, network service, or Gate-side reacquisition.
- Context transport is generic; business capability IDs, operations, payloads,
  and handlers remain injected by the owning Domain.
- POSIX is the first implementation backend. Unsupported hosts block before
  Gate launch.

## 3. Scope And Non-Scope

### In Scope

- Domain-neutral launch-context state machine and typed errors.
- POSIX `socket.socketpair()` transport and exact `pass_fds` child binding.
- Typed Gate launch specification using argv.
- Gate Catalog, planner, validator, and runner support for
  `ephemeralCapabilities`.
- Parent broker framing, handshake, bounded admission, deduplication, timeout,
  cancellation, quiesce, and close.
- Child client bootstrap and typed request/response handling.
- Synthetic framework tests and Acceptance Infra self-validation.
- Documentation and review-system updates required by the generic contract.

### Non-Scope

- Mobile device, provider, Station Fixture, actor, or OAuth business handlers.
- Changes to Mobile product assertions, 16-variant semantics, or evidence roles.
- E2-6 physical builds, devices, accounts, providers, or live OAuth execution.
- A Windows inherited-handle backend.
- Runtime Manifest or ArtifactRef schema changes.
- Proto, package, dependency, or protocol version changes.
- Compatibility readers, dual launch paths for one Gate, or fallback transport.

## 4. Initial-State Inventory — Before D-18 Landing

This table records the pre-implementation baseline. Current closure state is
owned by §13.

| Area | Initial state | Required target |
|---|---|---|
| Environment Provisioner | `provision()` returns only `RuntimeManifest` | Optional context factory with exact required-capability closure |
| Gate Catalog | Required string `command` | Exactly one of `command` or `argv`; context requires `argv` |
| Planner | Copies `command` from Gate definition | Preserves the selected canonical launch form and capability IDs |
| Validator | Requires `command` | Validates exclusive launch form and context constraints |
| Runner | `subprocess.run(..., shell=True, env=...)` | Context Gates use explicit `Popen` with exact descriptor inheritance |
| Gate process | Receives manifest paths and string environment | Optional Core child client consumes a non-secret descriptor locator |
| Lifecycle | Gate then runtime-cell and Provisioner cleanup | Context quiesce before resource cleanup; final close afterward |
| Errors | Generic provisioning/runtime failures | Typed context bind, handshake, protocol, timeout, unsupported, cleanup errors |
| Self-validation | No cross-process ephemeral capability fixture | Synthetic parent/child Gate with canary and leak checks |

Repository-backed references:

- `tooling/scripts/acceptance-run.py`
- `tooling/scripts/acceptance-plan.py`
- `tooling/scripts/acceptance-validate.py`
- `tooling/acceptance/core/provisioner.py`
- `tooling/acceptance/core/provisioning.py`
- `tooling/acceptance/core/evidence_store.py`
- `tooling/acceptance/fixtures/mobile_resource_lease.py`
- `tooling/acceptance/fixtures/mobile_oauth_station.py`

## 5. Requirement Traceability

| Requirement | Architecture source | Decision | Required evidence |
|---|---|---|---|
| Non-persisted authority handoff | design §2.2, §3.11 | D-18 | synthetic child invocation and artifact leak scan |
| Exact child identity | data-model §19 | D-18 | wrong workspace/Gate/two-run tests |
| Exact descriptor inheritance | design §3.11 | D-18 | inherited-FD and unrelated-FD closure tests |
| No shell for context Gate | design §3.11 | D-18 | catalog validation and mocked spawn assertion |
| Single resource owner | design §4.13 | D-12, D-18 | handler remains parent-side; child receives no raw handle |
| Bounded request handling | design §3.11 | D-18 | frame, concurrency, timeout, and replay tests |
| Context-first cleanup | design §4.13 | D-07, D-18 | ordered success/failure/cancel cleanup tests |
| No durable secret channel | D-11 and data-model §19 | D-11, D-18 | manifest/env/argv/output/artifact canary scan |
| Business separation | design §4.11, §4.13 | D-12 | synthetic-only Infra self-validation |

## 6. Responsibility Workstreams

### EGLC-W1: Core Contract And POSIX Channel

Deliver:

- `EphemeralGateLaunchContext`, `GateLaunchBinding`,
  `EphemeralCapabilityHandler`, `EphemeralGateClient`, state enum, framing, and
  typed errors.
- POSIX socket-pair backend with non-inheritable defaults and exact child
  descriptor projection.
- Isolated Python bootstrap that restores close-on-exec before loading Gate
  code.
- Handler-owned response projection plus Core sensitive-value scanning before
  any response frame crosses the process boundary.
- One in-flight request, bounded frame and response cache, request digest
  replay semantics, and identity handshake.
- Idempotent quiesce/close and explicit cleanup result.

Targets:

- Add `tooling/acceptance/core/launch_context.py`
- Add `tooling/acceptance/core/_gate_bootstrap.py`
- Modify `tooling/acceptance/core/errors.py`
- Modify `tooling/acceptance/core/__init__.py`
- Add `tooling/acceptance/tests/test_launch_context.py`

Dependencies: accepted D-18.

Deletion obligations: none; this establishes the new Core owner.

### EGLC-W2: Catalog, Planner, And Validator Contract

Deliver:

- Gate definitions accept exactly one of `command` or non-empty `argv`.
- `ephemeralCapabilities` is a unique, non-empty string list and requires
  `argv`.
- Plans preserve canonical argv and capability IDs without synthesizing a
  command string.
- Invalid mixed/missing launch forms fail before provisioning.

Targets:

- Modify `tooling/scripts/acceptance-plan.py`
- Modify `tooling/scripts/acceptance-plan-test.py`
- Modify `tooling/scripts/acceptance-validate.py`
- Modify `tooling/scripts/acceptance-validate-test.py`

Dependencies: EGLC-W1 contract names.

Deletion obligations: no dual `command` and `argv` entry may survive for a
context-enabled Gate.

### EGLC-W3: Runner And Provisioner Lifecycle

Deliver:

- `EnvironmentProvisioner.create_gate_launch_context(...)` optional extension.
- Exact comparison between required and registered capability sets.
- Context seal and activation before spawn.
- Explicit `Popen(..., shell=False, close_fds=True, pass_fds=...)` path for
  context-enabled Gates.
- Parent child-endpoint closure immediately after successful spawn.
- Bounded communicate/timeout/cancellation and process termination.
- POSIX process cleanup treats the process group, not direct-child exit, as
  the termination boundary: after graceful termination and direct-child reap,
  the runner force-signals the group so `SIGTERM`-resistant descendants cannot
  survive.
- Ordered `context.quiesce -> runtime-cell cleanup -> provisioner cleanup ->
  context.close` on every exit path.
- Cleanup failures remain distinct from precondition `BLOCKED` results and
  preserve structured quarantine/zeroization evidence.
- Quiesce failure fences affected handlers/resources and prevents reuse.
- Existing non-context Gate path remains unchanged.

Targets:

- Modify `tooling/acceptance/core/provisioner.py`
- Modify `tooling/scripts/acceptance-run.py`
- Modify `tooling/scripts/acceptance-run-test.py`

Dependencies: EGLC-W1 and EGLC-W2.

Deletion obligations:

- Context-enabled execution must not call `subprocess.run(..., shell=True)`.
- No context authority may be projected into Runtime Manifest or durable
  evidence.

### EGLC-W4: Infra Self-Validation And Documentation Closure

Deliver:

- Synthetic Provisioner and child Gate exercise the real process boundary.
- Leak scans cover manifest, environment values, argv, captured output, reports,
  and Evidence Store artifacts.
- Failure matrix covers identity mismatch, malformed/oversized frame, unknown
  capability, conflicting replay, timeout, spawn failure, cancellation,
  quiesce failure, and unsupported backend.
- Process-tree regression covers a descendant that ignores `SIGTERM` and
  closes inherited stdout/stderr, so direct-child `communicate()` completion
  cannot conceal surviving authority.
- Concurrent contexts prove run isolation.
- Gap Detector accepts the same explicit `--changed-file` projection as the
  planner, allowing one exact D-18 plan/run/detector scope in a dirty shared
  worktree without absorbing unrelated user changes.
- Architecture docs, module layout, and operational docs match implementation.

Targets:

- Modify `tooling/acceptance/capabilities/core.yaml`
- Modify `tooling/acceptance/features/acceptance-framework.yaml`
- Modify `tooling/acceptance/registry.yaml`
- Modify `tooling/acceptance/gates.yaml`
- Modify `tooling/acceptance/README.md`
- Modify `tooling/scripts/acceptance-gap-detect.py`
- Modify `tooling/scripts/acceptance-gap-detect-test.py`
- Modify `docs/architecture/acceptance-framework/`

Dependencies: EGLC-W1 through EGLC-W3.

Deletion obligations: synthetic tests must not import Mobile fixtures or claim
Mobile product proof.

## 7. Dependency Graph

```text
accepted D-18
      |
      v
EGLC-W1 Core contract
      |
      +-----------> EGLC-W2 Catalog/planner/validator
      |                         |
      +-------------------------+
                                v
                       EGLC-W3 Runner lifecycle
                                |
                                v
                       EGLC-W4 Infra self-proof
                                |
                                v
                    Acceptance Infra review gate
                                |
                                v
          handoff to original Mobile W2-E2-D / E2-5
```

W1 test scaffolding and W2 schema analysis may proceed in parallel. W3 cannot
start until both contracts are stable. W4 validates the integrated closure.

## 8. End-To-End Lifecycle Mapping

| Lifecycle step | Owner | Deliverable |
|---|---|---|
| Resolve Gate definition | Planner/validator | canonical launch form and required capability IDs |
| Provision durable resources | Environment Provisioner | immutable Runtime Manifest |
| Build ephemeral authority | Environment Provisioner | parent-owned handlers |
| Bind identities | Launch Context | workspace/Gate/evidence-run/provisioning-run seal |
| Prepare channel | Launch Context | active parent broker and child binding |
| Spawn Gate | Runner | exact argv and exact inherited descriptor |
| Execute operation | Parent handler | allowlisted action over bounded envelope |
| Return evidence reference | Parent handler | redacted result or ArtifactRef |
| Finish/abort Gate | Runner | captured exit, timeout, or cancellation |
| Stop authority use | Launch Context | quiesced channel and joined broker |
| Release resources | Existing owners | runtime-cell then Provisioner reverse cleanup |
| Finalize context | Launch Context | buffers cleared and owner zeroization verified |
| Judge result | Runner | product result separated from Infra/cleanup failure |

Every lifecycle step maps to W1-W4; no implementation step may redefine it.

## 9. Atomic Cutover Matrix

| Concern | New owner | Cutover condition | Old path removed/forbidden | Proof |
|---|---|---|---|---|
| Context Gate launch | `GateProcessLauncher` | argv schema and Popen path pass | `shell=True` for context Gate | spawn assertion |
| Capability declaration | Gate Catalog | exact required/registered set | implicit constructor injection | validator tests |
| Cross-process authority | Launch Context channel | bound handshake succeeds | env/file/network secret transport | canary scan |
| Raw resource operation | Parent handler | child uses opaque operation result | raw identifier response | protocol tests |
| Cleanup ordering | Runner | all exits use one ordering | ad hoc context cleanup | event-order tests |

Rollback is source-control rollback of the atomic Infra change. No dual
transport or compatibility reader is allowed.

## 10. Acceptance Scenarios

### AS-EGLC-01: Successful Child Capability Invocation
- **Precondition**: Synthetic Provisioner registers one capability and returns a ready manifest.
- **Action**: Operator runs the synthetic Gate through `acceptance-run.py`.
- **Expected**: Child handshake succeeds, one operation returns the expected redacted result, and Gate exits successfully.
- **Failure variant**: Missing handler blocks before spawn.
- **Evidence**: Process-boundary test and canonical Gate report.
- **Status**: passed

### AS-EGLC-02: Identity Mismatch
- **Precondition**: Child supplies a wrong workspace, Gate, Evidence run, or provisioning run identity.
- **Action**: Child attempts the handshake.
- **Expected**: Parent closes the channel and runner records typed `BLOCKED/UNPROVEN`.
- **Failure variant**: No identity field may be inferred or defaulted.
- **Evidence**: Parameterized handshake tests.
- **Status**: passed

### AS-EGLC-03: Protocol And Replay Rejection
- **Precondition**: Context is active.
- **Action**: Child sends malformed, oversized, unknown, or conflicting replay requests.
- **Expected**: Request fails closed without invoking an unauthorized handler.
- **Failure variant**: Same request ID and digest returns the bounded cached response.
- **Evidence**: Framing, allowlist, and replay tests.
- **Status**: passed

### AS-EGLC-04: Timeout, Cancellation, And Spawn Failure
- **Precondition**: Synthetic handlers can block cooperatively.
- **Action**: Gate times out, is cancelled, or fails to spawn.
- **Expected**: Runner terminates the child where present and executes the same bounded cleanup sequence.
- **Failure variant**: Unresponsive handler causes quarantine and cleanup failure, never resource reuse.
- **Evidence**: Ordered lifecycle tests with real child processes.
- **Status**: passed

### AS-EGLC-05: Secret And Descriptor Containment
- **Precondition**: Parent handler owns a unique secret canary and unrelated descriptors are open.
- **Action**: Child invokes the capability and exits.
- **Expected**: Child cannot read unrelated descriptors or secret values; no durable/captured artifact contains the canary.
- **Failure variant**: Any leak fails Infra readiness.
- **Evidence**: Descriptor probe and tree-wide artifact/output scan.
- **Status**: passed

### AS-EGLC-06: Concurrent Run Isolation
- **Precondition**: Two contexts use different run identities and handlers.
- **Action**: Two child Gates invoke the same capability name concurrently.
- **Expected**: Each child reaches only its own handler and response namespace.
- **Failure variant**: Cross-run request or response is rejected.
- **Evidence**: Concurrent process test.
- **Status**: passed

### AS-EGLC-07: Existing Gate Regression
- **Precondition**: Gate has `command` and no `ephemeralCapabilities`.
- **Action**: Operator runs the Gate through the existing runner.
- **Expected**: Existing launch and result semantics remain unchanged.
- **Failure variant**: Empty or implicit context creation fails the test.
- **Evidence**: Existing runner suite plus explicit no-context regression.
- **Status**: passed

### AS-EGLC-08: Unsupported Backend
- **Precondition**: Context-enabled Gate is selected on a host without a supported backend.
- **Action**: Runner prepares launch.
- **Expected**: Gate does not spawn and result is typed `BLOCKED/UNPROVEN`.
- **Failure variant**: No environment, file, named socket, network, or reacquisition fallback occurs.
- **Evidence**: Backend capability test.
- **Status**: passed

## 11. Verification

Per-workstream commands:

```bash
python3 -m unittest tooling.acceptance.tests.test_launch_context
python3 tooling/scripts/acceptance-plan-test.py
python3 tooling/scripts/acceptance-validate-test.py
python3 tooling/scripts/acceptance-run-test.py
python3 tooling/scripts/acceptance-infra-boundary-test.py
python3 tooling/scripts/quality-evidence-test.py
make acceptance-infra-validate
python3 tooling/scripts/acceptance-run.py --gate acceptance-plan-self
git diff --check -- \
  docs/architecture/acceptance-framework \
  tooling/acceptance \
  tooling/scripts
```

Final evidence must include:

- exact command and test counts;
- parent/child process identities;
- exact inherited descriptor set;
- cleanup event order for every exit path;
- canary scan scope and zero findings;
- explicit `UNPROVEN` result for unsupported backend;
- `BUSINESS_INJECTION_REQUIRED` handoff for Mobile E2-5 without treating it as
  an Infra failure.

## 12. Risks And Escalation

| Risk | Mitigation | Escalation |
|---|---|---|
| Handler blocks beyond deadline | cooperative cancellation + bounded join | quarantine affected resources and fail cleanup |
| Descriptor leaks to grandchild | isolated bootstrap marks descriptor non-inheritable before loading Gate code | any leak blocks Infra readiness |
| Command parsing changes existing Gate | argv applies only to context-enabled Gate | existing Gate regression failure blocks cutover |
| Response contains raw authority | injected response policy plus mandatory canary scan before frame emission | reject response and keep proof unproven |
| Windows lacks POSIX `pass_fds` | typed unsupported backend | separate architecture amendment for safe handle backend |
| Business logic enters Core | synthetic fixtures only in Infra self-test | return `BUSINESS_INJECTION_REQUIRED` |

Return `DESIGN_AMENDMENT_REQUIRED` if implementation requires a named endpoint,
durable secret, unbounded broker, shared context across runs, or different
cleanup ownership.

## 13. Status

| Workstream | Status | Evidence |
|---|---|---|
| EGLC-W1 Core contract | remediated; replacement review pending | 54 launch-context tests PASS, including absolute wire-deadline preservation, typed handler timeout, post-eviction replay rejection, bounded request-ID admission, expired-on-arrival encoding, normal/non-zero descendant extinction, aggregate secret scanning, and fenced-failure handler closure |
| EGLC-W2 Catalog/planner/validator | done | 14 planner + 12 validator tests PASS |
| EGLC-W3 Runner lifecycle | remediated; replacement review pending | 56 runner tests PASS; quarantined quiesce failure still closes remaining handlers after resource teardown |
| EGLC-W4 Infra self-validation | done | historical closure-time aggregate Infra run PASS and exact-scope Gap Detector PROVEN |
| Mobile W2-E2-D handoff | blocked downstream | D-18 prerequisite is closed and W2-E2B is complete; Mobile main plan now blocks E2-5 on proposed D-19 architecture/Infra landing and remaining Mobile remediation |

### 13.1 Review Reopen — 2026-08-30

Two independent implementation reviewers found the following blocking gaps:

| Finding | Severity | Owning workstream | Required closure |
|---|---|---|---|
| Handler result and blocked metadata can cross into the child without response-policy validation or secret scanning | P0/P1 | EGLC-W1 | validate the complete response before frame encoding; adversarial canary tests |
| `pass_fds` leaves the descriptor inheritable until Gate client construction | P1 | EGLC-W1 | isolated Python bootstrap clears inheritance before loading Gate code; pre-bootstrap grandchild probe |
| Cleanup failures collapse into `BLOCKED` and structured cleanup evidence is lost | P1 | EGLC-W3 | distinct cleanup failure result with preserved structured details |
| Prepare failure closes handlers before runtime-cell and Provisioner cleanup | P1 | EGLC-W3 | runner retains context ownership and performs the canonical cleanup order |
| Timeout/cancellation reaps only the direct child and can leave descendants alive | P1 | EGLC-W1 | isolated process group plus real descendant-residue regression |
| Raw parent-side blocked metadata can bypass child projection into durable runner evidence | P1 | EGLC-W1/W3 | retain only projected blocked metadata for runner reporting |
| Failed quarantine is followed by resource release | P1 | EGLC-W3 | defer runtime-cell and Provisioner release unless authority is quiesced or fenced |
| Direct-child reap can return before a `SIGTERM`-resistant descendant exits when that descendant closes inherited stdio | P1 | EGLC-W3/W4 | force-signal the POSIX process group after graceful direct-child reap and prove extinction with a detached-stdio resistant-descendant regression |

These findings invalidate prior W1/W3 completion and all W4 evidence produced
before their correction. They do not change D-18 ownership or transport
boundaries.

### 13.2 Historical Closure Evidence — 2026-08-30

- Closure reviewer A: PASS with no remaining P0/P1.
- Post-fix closure reviewer B: PASS.
- The latest exact-scope `acceptance-run` Evidence Store artifact records
  `acceptance-plan-self`, `acceptance-infra-validation`, and
  `acceptance-runtime-provisioning-self` as PASS.
- Exact-scope Gap Detector:
  `D-18 EphemeralGateLaunchContext Acceptance Infra closure` is `PROVEN` with
  no gaps.
- The D-18 handoff removes only its generic Infra prerequisite. W2-E2B /
  E2-1 + E2-3 is closed; the Mobile execution plan remains authoritative and
  blocks E2-5 on proposed D-19 architecture/Infra landing plus its current
  Mobile open set.

These statements record the evidence at D-18 closure time. They do not claim
that unrelated later working-tree changes satisfy current review-freshness
digests; current consumers must rerun the applicable source tests and review
gates for their own change range.

### 13.3 Checkpoint Review Reopen — 2026-09-01

The first `G0-MOBILE-BASELINE` source checkpoint commit was invalidated by two
independent commit reviews. They identified three current-scope P1 defects:

| Finding | Owner | Closure in this revision |
|---|---|---|
| A normally or non-zero exiting Gate could leave a descendant alive | EGLC-W1 | kill the isolated POSIX process group after every completed direct-child wait; cover both exit classes with real processes |
| Mobile Appium exposed arbitrary scripts and raw DOM/runtime responses to the child | Mobile business injection | replace the wire surface with fixed Harness operations and parent-persisted captures that return only `ArtifactRef` values; keep replay handles parent-side |
| A successfully quarantined quiesce failure skipped context close and left other handlers unclosed | EGLC-W3 | allow bounded close after a fenced failure, preserve the original cleanup failure, and verify remaining handler closure and secret zeroization |

The remediation passes 370 focused Mobile/D-18 tests, 56 runner tests, 15
planner tests, 14 validator tests, 8 Infra-boundary tests, 17 worktree-binding
tests, `pnpm mobile:check`, Python compilation, and owned-path diff checks.
This source revision remains pending a fresh freeze-pack review and two
independent replacement-commit reviews. It makes no Mobile runtime proof claim.

The first replacement freeze review then returned `0 P0 / 5 unique P1`.
The current revision closes those findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| Parent Appium artifact writes depended on ambient run environment after provisioning | EGLC-W1 / Mobile Provisioner | runner binds its actual `RunHandle` to the Provisioner before preparation; all parent evidence writes retain that handle after environment restoration |
| Replay-only Harness actions were absent from the child allowlist they incorrectly reused | Mobile Provisioner | define a disjoint exact parent-only Harness action set and route every negative callback through one parent-owned operation |
| Harness action values remained recursively untyped | Mobile Provisioner | validate every child action and negative callback against closed nested response schemas before projection |
| Process-group cleanup did not prove extinction before returning | EGLC-W1 | bounded `killpg(..., 0)` extinction verification now fails closed when any group member survives |
| The freeze pack embedded an obsolete r2 authority declaration | Checkpoint governance | replace it with an acyclic `inventory -> index -> complete -> authority` r5 chain whose review manifest explicitly supersedes r2 |

The replacement also corrects the Checkpoint 2 architecture index range from
`D-01 ~ D-17` to `D-01 ~ D-18`.

The r8 freeze review then returned `0 P0 / 2 unique P1`. The current revision
closes both findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| Mobile build commands sent `SIGKILL` without proving process-group extinction | Mobile build Provisioner | use the same bounded extinction contract for success, non-zero exit, timeout, and cancellation; add real-process regressions plus a surviving-group fail-closed test |
| Freeze review input and launch receipts used undeclared v2 schemas and digest domains | Checkpoint governance | emit the frozen closed v1 fields and `review-input.v1` / `review-launch.v1` domains; retain pack-specific identities only in `supplementalInputDigests` |

The authoritative r13 freeze review returned `0 P0 / 0 P1 / 0 P2` from both
independent reviewers. The first r13 replacement-commit review then found one
P1 and one P2:

| Finding | Owner | Closure in this revision |
|---|---|---|
| Mobile Provisioner cleanup closed the runner-owned evidence `RunHandle` before the runner persisted cleanup, logs, results, and its final manifest | Mobile Provisioner / runner lifecycle | keep the borrowed handle active through Provisioner cleanup; add a real `RunHandle` regression that writes runner-finalization evidence after cleanup |
| Parent-side screenshots above 32 KiB were rejected even though normal physical-device PNGs commonly exceed that size; the first correction enforced its larger limit only after an unbounded HTTP read and Base64 decode | Mobile Appium evidence capture | enforce the documented 64 MiB decoded-image bound at the HTTP read, encoded Base64, and decoded-byte boundaries; cover accepted and rejected transport limits plus acceptance above 32 KiB |

The r15 freeze review then returned `0 P0 / 2 unique P1 / 1 P2`. The current
revision closes those findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| Launch Context receive loops treated every socket timeout as a retry, so a silent peer or partial frame could hold handshake, invoke, or close indefinitely | EGLC-W1 | carry one monotonic operation deadline through prefix and body reads, shrink each socket wait to the remaining budget, close a timed-out client channel, and cover silent-handshake plus partial invoke/close frames |
| Parent and simulator Appium transports bounded only explicitly opted-in responses; ordinary JSON, page source, status, and HTTP error bodies remained unbounded | EGLC-W1 / Mobile Appium transport | route every urllib body through one deadline-aware bounded reader, make the ordinary response ceiling mandatory, apply explicit page-source and screenshot ceilings, and bound HTTP error diagnostics |
| Screenshot tests bypassed the real session/transport path | Mobile Appium evidence capture | exercise the real parent session through the bounded transport and Base64 decoder, then retain the decoded-byte rejection before Evidence Store persistence |

The r16 freeze review then returned `0 P0 / 2 P1 / 1 P2`. The current
revision closes both blocking findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| `HTTPResponse.read(64 KiB)` could remain active while a peer trickled bytes, preventing the monotonic deadline loop from regaining control | EGLC-W1 / Mobile Appium transport | require incremental `read1()` body acquisition, reset the socket timeout to the remaining total budget before every incremental read, normalize expiry to a typed deadline error, and prove it with a real urllib trickle server |
| Aborted HTTP error-body reads left the `HTTPError` response and its connection open | Mobile Appium transport | close every parent and simulator `HTTPError` in `finally`, including oversized, timed-out, malformed, and diagnostic fallback paths; assert closure in both transport suites |

The r17 freeze review then returned `0 P0 / 3 P1 / 1 P2`. The current
revision closes all findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| A child could send a valid request length prefix and then stall the parent broker with a partial body | EGLC-W1 | apply one finite monotonic deadline to every post-handshake request frame and report expiry as `EphemeralLaunchTimeout`; cover a raw partial-request peer |
| Parent Appium calls replaced the capability deadline with a fresh transport timeout | EGLC-W1 / Mobile Appium transport | pass the same absolute capability deadline through every handler, session, nested fresh-install, Harness, build-identity, and provider-authorization request; the transport uses the earlier of that deadline and its local ceiling |
| `NaN` and `Infinity` passed positive-only launch timeout validation | EGLC-W1 | require every public and wire launch timeout to be numeric, positive, and finite; cover spec, launcher, context, and client request boundaries |
| Appium status `HTTPError` responses were not explicitly closed | Mobile Appium preflight | close the response in `finally` and assert closure in the preflight transport suite |

The r20 freeze review then returned `0 P0 / 6 unique P1`. The current
revision closes all blocking findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| The parent reconstructed a fresh capability deadline after frame receipt, extending the child budget | EGLC-W1 | transmit the child's absolute monotonic deadline, authenticate it in the request digest, clamp without extension in the parent, and preserve the first deadline for explicit request-ID replay |
| A handler `TimeoutError` became a generic protocol error and an already-expired request produced an unencoded response | EGLC-W1 | map handler timeout to `EphemeralLaunchTimeout`, clear synchronous worker bookkeeping before the next request, and route expired-on-arrival responses through the normal encode/cache path |
| Parent Appium session creation and nested operations did not propagate cancellation through transport and lease acquisition | Mobile Appium parent authority | carry one cancellation event through every session, fresh-install, Harness, capture, build-identity, HTTP body-read, and physical-device lease operation |
| Physical-device and provider-account serialization could wait beyond the capability deadline | Mobile resource lease owner | make process locks, cross-process `flock`, ledger transactions, and callback admission deadline/cancellation aware; prove callback non-entry under physical and provider contention |
| Connect/header timeout failures were classified as ordinary driver failures | Mobile Appium transport | normalize direct `TimeoutError`, `socket.timeout`, and timeout-backed `URLError` into the typed capability deadline error while retaining non-timeout transport failures |
| Failed Appium startup could lose cleanup ownership, and public polling accepted non-finite timeouts | Mobile Appium parent authority | retain sessions with a surviving server session ID for bounded handler cleanup; reject non-finite Appium and simulator polling timeouts |

The affected Mobile/D-18 aggregate now reports 425 PASS, including the new
wire-deadline, typed-timeout, cancellation, lock-contention, failed-session
cleanup, and finite-polling regressions. Physical Mobile execution remains
`UNPROVEN / NOT STARTED`.

The r23 freeze review then returned two unique valid P1 findings and one
rejected finding:

| Finding | Owner | Closure in this revision |
|---|---|---|
| Evicted request IDs could execute a non-idempotent handler again | EGLC-W1 | retain a bounded channel-lifetime request-ID digest set independently of the bounded response cache; reject same- or conflicting-digest reuse after response eviction and cap total unique request IDs |
| Child Appium WebView polling gave each nested RPC a fresh 60-second timeout | Mobile Appium child facade | derive every nested `contexts`, `switch_context`, and Harness timeout from one absolute polling deadline; cap sleeps and reject success after deadline |
| Launch receipt had no independently verifiable pack edge | Review governance | rejected: the receipt binds `review-input.json` by `inputPackageDigest`; that persisted closed object binds authority/index/complete plus every patch and manifest in `supplementalInputDigests`, exactly as required by the governing Review Closure contract |

The affected Mobile/D-18 aggregate now reports 425 PASS after the r23
remediation. The replacement freeze must use fresh independent review sessions;
the r23 reports cannot authorize a later candidate.

The r25 freeze review then returned `0 P0 / 4 unique P1 / 1 P2`. The current
revision closes all blocking findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| The persistent Mobile resource-lease ledger used a new random authentication key for every provisioning run, so a later process could not authenticate the existing ledger | Mobile resource lease owner | require one explicit environment-backed 32-byte authentication key, consume and zeroize the preflight copy after constructing the parent broker, and prove stable authentication across preflight runs |
| Parent cleanup reset independent timeouts across Appium stop, lease restoration/quarantine, and Station fixture cleanup | Mobile Provisioner and fixture owners | create one absolute cleanup deadline and cancellation signal, propagate them through nested locks, callbacks, Appium sessions, lease operations, and Station subprocess calls, and prove callback non-entry under expired or cancelled cleanup |
| A handler result observed after its absolute capability deadline could still return success when the worker exited immediately before the liveness check | EGLC-W1 | recheck the absolute deadline after the bounded join and return typed `EphemeralLaunchTimeout`; cover deterministic late completion |
| Freeze source manifests were sorted by the leading SHA-256 instead of by repository-relative path | Checkpoint governance | generate every source manifest by sorting path keys first, then format canonical `<sha256><TAB><path><LF>` records |

The r25 P2 finding remains a documented residual risk: heartbeat history and
generation anchors currently have no compaction policy. It does not invalidate
the bounded runtime semantics or the zero-P0/P1 checkpoint gate, and this
checkpoint does not expand scope to design ledger-history retention.

Focused source verification after the r25 remediation reports 132 PASS for
Launch Context plus Mobile preflight, and 106 PASS for Mobile resource leases
plus the Station fixture. Python compilation and owned-path diff checks pass.
The affected aggregate, exact-candidate checks, immutable refreeze, and two
fresh independent reviews remain pending. r25 is historical NO-GO evidence and
cannot authorize a commit.

The r28 dual review then returned `0 P0 / 2 unique P1 / 1 P2` from both
independent reviewers. The current revision closes both blocking findings:

| Finding | Owner | Closure in this revision |
|---|---|---|
| Context-enabled Gates inherited the complete parent environment, including provider credentials, the Mobile lease-ledger authentication key, and raw redaction values | EGLC-W3 runner lifecycle | construct the context child environment from an explicit non-sensitive process-variable allowlist, add only Evidence Store/runtime locators, and keep raw redaction values parent-side; direct and runner-path regressions assert that credential variables and values are absent |
| Station actor reset started an independent 120-second subprocess after only checking the parent cleanup deadline | Mobile Fixture and Provisioner | propagate the same absolute deadline and cancellation signal through reset-target verification and reset execution; bound remote verification calls by remaining time and run reset in an isolated process group with cancellation polling, termination, reaping, and extinction checks |

The repeated P2 ledger-compaction finding remains the same documented
non-blocking residual risk. r28 is historical NO-GO evidence and cannot
authorize a later candidate or commit.

The r29 dual review then returned `0 P0 / 5 unique P1 / 1 P2`. The current
revision closes every blocking finding at its owning layer:

| Finding | Owner | Closure in this revision |
|---|---|---|
| The governing-source manifest retained the prior checkpoint-manifest digest | Checkpoint governance | regenerate the governing manifest from the current pack-local source bytes, sorted by repository-relative path, before constructing review input |
| A direct context launch could omit its child environment and inherit the parent process environment | EGLC-W1 launcher | require an explicit child environment for every context-bound launch, reject parent redaction payloads before spawn, and prove ambient credential canaries do not reach a real child |
| Station Fixture commands inherited ambient provider and lease credentials | Mobile Station Fixture | derive every child environment from an explicit non-sensitive allowlist and add only the intentional anonymous HMAC descriptor locator |
| Station Fixture subprocesses could outlive cancellation or leave descendants | Mobile Station Fixture | use one absolute deadline and cancellation signal with bounded nonblocking I/O, isolated process groups, TERM/KILL/reap, and verified process-group extinction |
| Mobile resource-lease cleanup retained broker or ledger key owners, including pre-authority failure paths | Mobile resource lease owner and Provisioner | add idempotent full broker/ledger closure evidence, close every descriptor, zeroize every retained key copy, close constructor failures, retain the preflight key until cleanup ownership exists, and run final secret closure independently of the cleanup deadline |

Focused reconciliation reports 439 PASS across the required D-18 and Mobile
modules. Worktree binding, runner, planner, validator, Infra boundary, Python
compilation, and owned-path diff checks also pass. A fresh immutable candidate,
exact archive verification, and two new independent reviews remain required;
r29 cannot authorize a commit.

The repeated P2 ledger-compaction finding remains a documented non-blocking
residual risk. Physical Mobile proof and D-19 remain unproven.

These corrections require a new immutable freeze pack and two fresh independent
replacement-commit reviews. They do not change the source-checkpoint non-claims.

## 14. Final Readiness And Non-Claims

`PLAN_READY_FOR_EXECUTION` requires:

- D-18 remains accepted and unchanged.
- W1-W4 have complete ownership, dependency, deletion, failure, and evidence
  coverage.
- The review has no unresolved P0/P1 findings.
- The owner explicitly approves this plan.

This plan does not prove Mobile OAuth, physical devices, provider accounts,
E2-5, E2-6, MS-AG03, or W2 readiness.
