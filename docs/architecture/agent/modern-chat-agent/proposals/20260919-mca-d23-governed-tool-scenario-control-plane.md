# MCA-D23 Capability Operation Scenario Control Plane

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `apps/station/app/subserver/agent/`,
> `apps/desktop/src-tauri/`, `apps/desktop/src/`, `apps/mobile/`,
> `tooling/acceptance/`

---

## 1. Scope

This amendment defines the missing deterministic runtime boundary required to
execute the 164 reviewed governed ToolCall, MCP lifecycle, and Connector
invocation tuples truthfully.

It extends the single MCA-D22 capability scenario control plane to:

- coordinate governed ToolCall setup, barriers, lifecycle interruption, and
  cleanup across Station and the selected executor;
- coordinate local MCP business/cleanup leases, process lifecycle, timeout,
  reconnect, and leak checks;
- coordinate Connector OAuth/resource revision, dispatch, disconnect, provider
  revocation, and cleanup;
- expose exact commit barriers for `CR-00` through `CR-06`;
- execute both orderings of `R-01` through `R-07` where assigned to J03-J05;
- produce the real product states required by `ERR-O01` through `ERR-O08` and
  `REPLAY-O07I`, plus `ERR-CON01` through `ERR-CON04`;
- support both Desktop local execution and Browser Station execution without
  representing the Station executor as a Browser client lease;
- preserve Browser/Mobile unavailable-runtime truth for local MCP;
- preserve Mobile contract-only evidence for `AS-15-V2-T04`,
  `AS-15-V2-O01`, `AS-15-V2-M01`, and `AS-15-V2-C01`.

It does not:

- create a second scenario-control service or product authority;
- add a general production failpoint, clock-control, crash, or fixture API;
- permit the Harness or fixture controller to write ToolCall, receipt, result,
  continuation, or verdict records;
- weaken the reviewed 86 J03, 41 J04, or 37 J05 tuples;
- promote any output beyond `CANDIDATE`; MCA-A08 remains the only owner of
  formal `PROVEN` promotion.

## 2. Verified Trigger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| J03 expands to 42 `client_capability_turn`, 42 `station_capability_turn`, and two `contract_only` tuples | `verified_fact` | `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml` | high | Full exact-source run |
| J04 expands to 34 Desktop local-MCP, four Browser-unavailable, and three Mobile-unavailable/contract tuples | `verified_fact` | Runtime matrix and expander | high | Full exact-source run |
| J05 expands to 18 Desktop, 18 Browser, and one Mobile-contract tuple | `verified_fact` | Runtime matrix and expander | high | Full exact-source run |
| MCA-D21 requires one fresh `scenarioExecutionId` and one real execution per tuple | `accepted_decision` | MCA-D21 sections 4, 8, and 13 | high | J03 candidate |
| The current J03 runner executes one composite Native success flow and has no `--formal-candidate` producer | `verified_fact` | `tooling/acceptance/gates/agent/governed_tool_development.py`; `apps/desktop/src/acceptance/agent/harness.ts#runFoundationF04Scenario` | high | None |
| The J04 and J05 runners execute one Native composite each and expose no `--formal-candidate` producer or tuple results | `verified_fact` | `mcp_lifecycle_development.py`; `connector_invocation_development.py` | high | None |
| The current composite covers automatic/manual approval, denial, expiry, loop settlement, and replay, but it does not expose the reviewed crash barriers or both race orderings | `verified_fact` | `runFoundationF04Scenario`; repository search for J03 cell identifiers | high | None |
| `CR-00` through `CR-06` require deterministic pauses at Station commit boundaries and executor receipt/effect boundaries | `accepted_decision` | `design.md` section 24.1; V2 execution contract section 7 | high | Runtime implementation |
| `ERR-O06`, `ERR-O07`, and `REPLAY-O07I` require cleanup-lease expiry, confirmed external effect ambiguity, and externally idempotent replay controls that the current runner cannot cause | `verified_fact` | Current J03 runner and ToolDispatch/executor source audit | high | None |
| The accepted MCA-D22 controller is explicitly restricted to the reviewed J02 matrix and only intercepts capability binding mutation | `verified_fact` | `CapabilityAcceptanceScenarioService`; `acceptance.j02.*` keys | high | None |
| Architecture currently forbids general Acceptance-only endpoints and instrumentation; MCA-D22 is the narrow accepted J02 exception | `accepted_decision` | `design.md` sections 22 and 24.3; MCA-D22 | high | J03 amendment verdict |
| MCA-A04's declared write set excludes Model, Station, and Desktop Rust, although J03 needs contracts and hooks in those owners | `verified_fact` | `tasks/MCA-A04.md` | high | Accepted plan amendment |
| MCA-A05 and MCA-A06 also declare Harness/tooling-only writes despite reviewed MCP and Connector barriers crossing Desktop Rust, Station, and Model owners | `verified_fact` | `tasks/MCA-A05.md`; `tasks/MCA-A06.md` | high | Accepted plan amendment |

The J03-J05 candidates cannot be produced from current source without
relabeling composite flows, inventing receipt/race evidence, or adding
unreviewed runtime instrumentation.

## 3. Decision

### MCA-D23: Extend The Single Capability Scenario Control Plane For J03-J05

Extend the MCA-D22 `CapabilityAcceptanceScenarioService` and its protobuf
contract to support the reviewed J03, J04, and J05 families. The existing
Station service remains the sole scenario lifecycle coordinator. It delegates
a run-scoped, cell-allowlisted hook to exactly one selected executor or
provider fixture when a barrier belongs to executor-local or provider-local
state.

The controller may:

- prepare cell-specific preconditions through canonical owners;
- arm an allowlisted barrier before a named production commit boundary;
- wait until that barrier is reached;
- release the barrier or terminate the owning worker generation as prescribed
  by the reviewed cell;
- advance a run-scoped deterministic clock only where a reviewed deadline or
  expiry cell requires it;
- clean fixture resources and verify that every armed hook was disarmed.

The controller may not:

- accept an arbitrary method, table, failpoint, delay, timestamp, or state
  mutation from the caller;
- write a ToolCall decision, claim, outbox item, receipt, result, continuation,
  side-effect count, product error, or replay result directly;
- return an assertion, evidence role, expected value, candidate artifact, or
  pass/fail verdict;
- synthesize a client capability session for the Station executor;
- bypass device command proof, lease/fence validation, recovery proof, or
  canonical cleanup.

## 4. Ownership

| Concern | Owner |
|---|---|
| Scenario handle, tuple allowlist, actor/run scope, barrier plan, and cleanup lifecycle | Existing Station `CapabilityAcceptanceScenarioService` |
| ToolCall decision, claim, outbox, result, continuation, replay, and typed error truth | Station ToolDispatch and Turn services |
| Client lease, fence, receipt, recovery proof, and command verification | Station capability execution services |
| Local PREPARED/APPLIED receipt and side-effect execution | Desktop Rust capability executor |
| Station-executor PREPARED/APPLIED receipt and side-effect execution | Station capability executor |
| Run-scoped local barrier arm/wait/release/worker interruption | Desktop Rust scenario hook subordinate to the Station scenario handle |
| Local MCP process, port, secret, and cleanup execution | Desktop Rust MCP manager |
| Connector connection/resource revision and provider-revoke truth | Station Connector services |
| Provider rejection/timeout behavior | Run-scoped provider fixture subordinate to the Station scenario handle |
| Receiver action and DOM observation | Desktop Harness through canonical Desktop APIs |
| Mobile compatibility | Mobile generated-protobuf contract tests |
| Tuple expansion and role applicability | Reviewed runtime matrix |
| Candidate assembly | Shared Agent V2 candidate producer |
| Candidate validation and later formal promotion | Separate validator; MCA-A08 owns `PROVEN` |

No subordinate executor hook may outlive or broaden its Station scenario
handle.

## 5. Runtime Topology

```text
HomeStationProvisioner
  -> enables the existing capability scenario controller for one run
  -> launches an Acceptance-capable Desktop Rust executor when required
  -> supplies one primary actor and distinct Native/Browser device identities

Desktop Harness
  -> prepares one reviewed J03/J04/J05 tuple through Station
  -> arms the returned executor hook when the selected barrier is local
  -> performs the canonical approval/cancel/delete/revoke action
  -> waits for the named barrier and applies the reviewed ordering
  -> observes DOM + Station readback + executor receipts + side-effect counter
  -> replays canonical readback
  -> cleans the scenario

Existing Station scenario controller
  -> validates run/actor/tuple/profile identity
  -> coordinates Station and selected-executor barriers
  -> never emits a product verdict

Canonical ToolDispatch / executor / Turn services
  -> remain the only writers of product truth
```

For `station_capability_turn`, the Station executor is a Station runtime unit.
Its receipt and execution facts are Station-owned and no Browser
`ClientCapabilitySession`, lease, or device executor identity is fabricated.

## 6. Control Contract

The existing prepare/release/cleanup messages gain a typed scenario family and
profile. Executor-local control uses the same handle:

```proto
enum CapabilityAcceptanceScenarioFamily {
  CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_UNSPECIFIED = 0;
  CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02 = 1;
  CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03 = 2;
  CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_MCP_J04 = 3;
  CAPABILITY_ACCEPTANCE_SCENARIO_FAMILY_CONNECTOR_J05 = 4;
}

message PrepareCapabilityAcceptanceScenarioRequest {
  string run_id = 1;
  string scenario_execution_id = 2;
  string cell = 3;
  string platform = 4;
  string locale = 5;
  string ordering = 6;
  string sample_id = 7;
  CapabilityAcceptanceScenarioFamily family = 8;
  RuntimeAttestationProfile runtime_attestation_profile = 9;
}

message PrepareCapabilityAcceptanceScenarioResponse {
  string scenario_handle = 1;
  repeated string opaque_resource_ids = 2;
  string source_inventory_hash = 3;
  string executor_hook_ticket = 4;
}

message ArmCapabilityAcceptanceExecutorHookRequest {
  string scenario_handle = 1;
  string executor_hook_ticket = 2;
}

message WaitCapabilityAcceptanceBarrierRequest {
  string scenario_handle = 1;
  string barrier = 2;
}

message InterruptCapabilityAcceptanceWorkerRequest {
  string scenario_handle = 1;
  string barrier = 2;
}
```

Exact field numbers and shared enum placement are implementation details, but
the contract must preserve these semantics:

1. `family + cell + platform + locale + ordering + sample_id` must match one
   reviewed tuple.
2. `runtime_attestation_profile` must match the matrix row.
3. A handle is bound to one run, actor, tuple, selected executor, and source
   inventory hash.
4. The hook ticket is opaque, single-use, short-lived, and valid only for the
   executor selected by that tuple.
5. Barrier names and lifecycle actions come from the server-side cell
   allowlist; callers cannot supply arbitrary hooks.
6. Wait/release/interruption responses contain setup state only, never product
   state or assertions.

## 7. Barrier Registry

### 7.1 Crash-Recovery Cells

| Cell | Barrier owner and exact boundary | Lifecycle action | Canonical oracle |
|---|---|---|---|
| `CR-00` | Station, before approval decision commit | interrupt request worker before commit, then redeliver identical decision | one decision, claim, effect, result, continuation |
| `CR-01` | Station, decision durable before atomic claim+outbox | interrupt dispatch worker, then recover | one durable decision and one claim/outbox |
| `CR-02` | Station, claim+outbox durable before delivery | interrupt delivery worker, then redeliver outbox | one claim, one executor delivery, one effect |
| `CR-03` | selected executor, PREPARED durable before effect | terminate executor worker generation, then recover under replay policy | one effect and one terminal receipt |
| `CR-04N` | selected executor, confirmed non-idempotent effect before APPLIED | terminate executor worker generation | `UNKNOWN_SIDE_EFFECT`; no result or continuation |
| `CR-04I` | selected executor, confirmed externally idempotent effect before APPLIED | terminate and recover with the same external idempotency key | one effect, APPLIED, result, continuation |
| `CR-05` | selected executor, APPLIED durable before result report | terminate executor worker generation, then submit the durable terminal receipt | one APPLIED and one Station result |
| `CR-06` | Station, result durable before continuation creation/claim | interrupt continuation worker, then recover | one result and one continuation |

Worker interruption must exercise the real durable recovery path. Throwing an
Acceptance-only error inside product logic or directly writing the expected
terminal row is forbidden.

### 7.2 Race Cells

Each ordering starts from a clean fixture and reaches the same named barrier.

| Cell | Order A | Order B | Required oracle |
|---|---|---|---|
| `R-03` | cancel fence commits before terminal result CAS | terminal result CAS commits before cancel fence | committed fence wins; cleanup settles once; late fact is audit-only |
| `R-05` | device/session revoke commits before outbox dispatch | dispatch commits before revoke, then pause around PREPARED/APPLIED | revoke-first has zero effect; dispatch-first ends APPLIED, cancelled, or UNKNOWN only; recovery proof remains scoped |
| `R-07` | manifest/binding delete commits before dispatch | dispatch commits before delete | no post-delete admission; prior claim settles or cancels; historical snapshots remain immutable; effect count <=1 |

The controller may coordinate ordering but cannot decide the winner or write
the winning product state.

### 7.3 Error And Replay Cells

| Cell | Deterministic precondition/action |
|---|---|
| `ERR-O01` | Remove the selected executor before dispatch. |
| `ERR-O02` | Expire the business lease, then submit an old-lease terminal event. |
| `ERR-O03` | Commit the cancel fence first and complete canonical cleanup. |
| `ERR-O04` | Advance the run-scoped clock past the execution deadline before terminal settlement. |
| `ERR-O05` | Disconnect the selected executor after operation creation without creating a replacement operation. |
| `ERR-O06` | J03: persist PREPARED, expire the ToolCall receipt-recovery credential, and reject the late old-credential terminal attempt. J04: pause in `settling_cleanup`, expire the CapabilityOperation cleanup lease, reject old-fence cleanup, and advance to the cleanup deadline. |
| `ERR-O07` | Persist PREPARED, confirm one non-idempotent external effect, then interrupt before APPLIED. |
| `ERR-O08` | Advance the active fence, then submit an event signed for the prior fence. |
| `REPLAY-O07I` | Persist PREPARED, confirm one externally idempotent effect, interrupt before APPLIED, then recover with the same ToolCall external idempotency key. |

Every error is emitted by the canonical owner with the accepted code, locale
key, retryability, terminality, safe details, recovery action, and
forbidden-side-effect oracle. Scenario-control output is not error evidence.

## 8. Success And Contract Cells

- `AS-05A` executes manual approve, deny, and approval-expiry branches through
  canonical decision APIs. Each branch has independent ToolCall identity.
- `AS-05` executes an independent crash-fencing aggregate from a fresh
  scenario fixture. It may compare its result with the `CR-00` through
  `CR-06` contract, but it cannot reuse any CR tuple's runtime entity or
  evidence.
- Desktop local tuples use the real Desktop Rust executor and durable receipt
  ledger.
- Browser tuples use the Station executor and do not create a Browser client
  lease.
- `AS-15-V2-T04` and `AS-15-V2-O01` each run one source-bound Mobile generated
  contract test invocation. They emit no Desktop/Browser runtime entities.

### 8.1 MCP Lifecycle Cells

- `AS-04` runs install, test, connect, invoke, cancel, reconnect, uninstall,
  and process/port/secret cleanup on the Desktop Rust MCP owner.
- `R-01` pauses the old executor after PREPARED and orders old-result
  settlement against business-lease takeover.
- `R-02` pauses `settling_cleanup` and orders cleanup settlement against
  cleanup-lease takeover and deadline.
- `R-03` reuses the canonical cancel/result fence contract.
- `R-04` orders timeout fencing against reconnect CAS.
- `ERR-O01` through `ERR-O08` use the same canonical operation semantics as
  J03, while process, port, and secret evidence remains Desktop Rust-owned.
- Browser `AS-04-UNAVAILABLE`/`TAX-04` and Mobile
  `AS-04-UNAVAILABLE`/`TAX-04`/`AS-15-V2-M01` create no local process,
  operation claim, ToolCall, or client-executor receipt.

### 8.2 Connector Invocation Cells

- `AS-06` runs OAuth resource discovery, manifest/binding, approval, Station
  execution, result, and provider revocation through canonical owners.
- `R-06` orders OAuth disconnect against connection-revision/outbox commit and
  injects reviewed provider revoke rejection/timeout behavior.
- `R-07` reuses the canonical manifest/binding delete versus dispatch barrier.
- `ERR-CON01` through `ERR-CON04` are emitted by Connector/Capability owners
  from expired connection, denied scope, removed resource, and stale manifest
  states.
- `AS-15-V2-C01` runs one source-bound Mobile contract invocation and emits no
  Station Turn or client capability lease.

## 9. Per-Tuple Observation

For each Desktop or Browser tuple across J03-J05:

1. allocate `scenarioExecutionId` before setup;
2. validate the tuple against the reviewed matrix;
3. prepare only that tuple's actor-scoped resources;
4. arm only its allowlisted barriers;
5. perform the canonical product action;
6. capture receiver DOM, Station readback, executor receipts, side-effect
   count, and timing/barrier facts from their real owners;
7. replay canonical Station state and compare immutable hashes;
8. clean the fixture and verify every hook, worker generation, lease, outbox
   item, and temporary resource has settled or been removed;
9. emit only the roles allowed by the row's runtime attestation profile.

One tuple may not reuse another tuple's ToolCall, operation, decision, claim,
receipt, continuation, scenario handle, or primary execution identity.

## 10. Security And Production Disablement

- Station scenario routes remain absent or reject unless the declared
  Acceptance environment and exact active `run_id` are enabled.
- Desktop Rust executor hooks require both an Acceptance-capable build
  attestation and a boot-scoped run binding; release builds do not register the
  commands.
- The Station-issued hook ticket is actor/device/executor/run/tuple scoped,
  single-use, short-lived, and never written to evidence.
- Scenario requests cannot contain credentials, arbitrary payloads, paths,
  SQL, method names, durations, timestamps, or unreviewed barrier names.
- Provider fixture control accepts only reviewed response classes
  (`success`, `reject`, `timeout`) selected by the server-side cell registry;
  it never accepts or returns OAuth credentials.
- Deterministic time advances only the run-scoped fixture clock. Production
  clocks and unrelated actors are unaffected.
- Process or worker restart invalidates unrecoverable handles and fails the
  tuple closed.
- Cleanup is idempotent and mandatory. Cleanup failure fails the tuple and
  keeps the Gate `UNPROVEN`.
- A failed tuple is never retried in place to hide its first execution.

## 11. Alternatives Considered

### Relabel The Current Native Composite

Rejected. It does not execute the reviewed crash, error, replay, Browser
Station-executor, Mobile-contract, or race states and violates MCA-D21.

### Add J03 Logic To The Harness Only

Rejected. The Harness cannot deterministically pause Station commits or
Desktop Rust receipt/effect boundaries and would become a second product-state
authority.

### Create A Separate Governed-Tool Fixture Service

Rejected. It would duplicate the MCA-D22 scenario lifecycle, run binding,
actor scope, production-disable contract, and cleanup ownership.

### Add General Production Failpoints

Rejected. The required surface is finite and matrix-bound; a general failpoint
API broadens the production attack and maintenance surface.

### Downgrade Missing Cells To Static Or Unit Evidence

Rejected. The reviewed rows require receiver, Station, executor, side-effect,
cleanup, and replay evidence from real executions.

## 12. Consequences

Positive:

- All 164 J03-J05 tuples become executable without fabricated identities,
  Station-as-Browser lease claims, or unavailable-runtime execution.
- One scenario-control authority serves J02 and J03 with shared run, actor,
  production-disable, and cleanup semantics.
- Crash and race evidence becomes reproducible at the accepted commit
  boundaries.
- Canonical ToolDispatch, executor, receipt, recovery, and continuation owners
  remain unchanged.

Negative:

- Model, Station, Desktop Rust, Desktop Harness, Mobile contract tests,
  provisioning, and candidate production must change together.
- Acceptance-capable Desktop builds require explicit source/build attestation.
- The 164 independent executions will be materially slower than the existing
  composite Development Journeys.
- MCA-A04, MCA-A05, and MCA-A06 need plan/write-set amendments after this
  design is accepted.

## 13. Architecture Gates

The amendment is complete only when:

1. production Station and release Desktop builds expose no usable scenario
   control;
2. J02 behavior remains unchanged under the same service;
3. arbitrary cells, barriers, lifecycle actions, clocks, actors, runs, and
   executor identities reject before mutation;
4. every `CR-00` through `CR-06` barrier is reached at its named production
   commit boundary and satisfies the exact count oracle;
5. both orderings of `R-03`, `R-05`, and `R-07` execute from clean fixtures;
6. `ERR-O01` through `ERR-O08` are emitted by canonical product owners;
7. `ERR-O07` never redispatches and `REPLAY-O07I` produces one externally
   idempotent effect, one result, and one continuation;
8. Desktop local evidence comes from Desktop Rust, while Browser evidence
   comes from the Station executor without a Browser lease;
9. each Mobile contract marker runs independently and remains contract-only;
10. setup/barrier/cleanup responses contain no verdict or evidence role;
11. cleanup removes all run-scoped hooks and resources;
12. J04 proves both orderings of `R-01` through `R-04`, all eight operation
    errors, unsupported Browser/Mobile zero execution, and process/port/secret
    cleanup;
13. J05 proves both orderings of `R-06` and `R-07`, all four Connector errors,
    provider-revoke outcomes, and credential-free evidence;
14. the semantic validator accepts exactly 86 J03, 41 J04, and 37 J05 unique
    tuple and primary execution identities as `CANDIDATE` on one exact source.
15. J03 pre-execution outcomes require zero-execution evidence and do not
    fabricate executor receipts; J03 and J04 `ERR-O06` bind their distinct
    receipt-recovery and cleanup-lease authorities.

## 14. Review Condition

Accept only if this remains one extension of MCA-D22, every barrier is
allowlisted and tied to a real production commit boundary, Desktop Rust hooks
are impossible to activate in release builds, Station-executor evidence does
not fabricate a Browser lease, unsupported MCP paths execute nothing,
Connector fixture control cannot expose credentials, and scenario control
cannot create product truth or verdicts.

Required Owner verdict:

```text
APPROVE MCA-D23
```

or:

```text
REQUEST CHANGES MCA-D23: <blocking findings>
```

Owner verdict:

```text
APPROVE MCA-D23
```

The Owner delegated full approval and execution authority on 2026-09-19. The
review criteria were checked against current source before this verdict was
recorded.
