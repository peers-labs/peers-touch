# MCA-D24 Evaluation Scenario Control Plane

> **Status**: accepted
> **Version**: v1.1
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `apps/station/app/subserver/agent/`,
> `apps/desktop/src/`, `apps/mobile/`, `tooling/acceptance/`

---

## 1. Scope

This amendment defines the missing deterministic runtime boundary required to
execute all 57 reviewed `agent-v2-evaluation-lab-e2e` tuples truthfully.

It extends the single MCA-D22 acceptance scenario authority to:

- prepare Evaluation-specific fixtures and typed failure preconditions;
- pause Evaluation scheduler, cancellation, completion, retry, and metrics
  transactions at the reviewed commit boundaries;
- execute both orderings of `R-08`, `R-09`, and `R-10`;
- drive cancellation-ack timeout through a run-scoped deterministic clock;
- coordinate actual Desktop and Station restart for `AS-14`;
- preserve one independent Evaluation execution lineage per Desktop, Browser,
  or Mobile-contract tuple.

It does not:

- create a separate Evaluation fixture authority;
- expose general production failpoints, database writes, or clock controls;
- permit the scenario controller to create Evaluation results, metrics,
  terminal states, verdicts, or evidence;
- weaken the reviewed 57-tuple matrix;
- promote any output beyond `CANDIDATE`; MCA-A08 remains the only owner of
  formal `PROVEN` promotion.

## 2. Verified Trigger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| J06 expands to 28 Desktop, 28 Browser, and one Mobile `contract_only` tuple | `verified_fact` | `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml`; matrix expander | high | Full exact-source run |
| `ERR-E01`, `ERR-E02`, and `ERR-E05` require zero Evaluation Turn creation, so a `station_turn` attestation and mandatory TurnTrace/metrics roles would fabricate evidence | `verified_fact` | J06 error semantics below; `runtime-attestation-set.schema.json`; `acceptance-validate.py` | high | None |
| MCA-D21 requires one fresh `scenarioExecutionId` and one real execution per tuple | `accepted_decision` | MCA-D21 sections 4, 8, and 13 | high | J06 candidate |
| The current J06 runner invokes one composite two-Native-client Journey and initializes `cell-results` as empty | `verified_fact` | `tooling/acceptance/gates/agent/evaluation_development.py` | high | None |
| Current tests construct 57 synthetic passing cell records instead of executing reviewed cells | `verified_fact` | `evaluation_development_test.py#valid_capture` | high | None |
| The current structural suite fails because the candidate writer omits the mixed-row `contract-evidence` role | `verified_fact` | `python3 -m unittest tooling.acceptance.gates.agent.evaluation_development_test` on `47aea1d03` | high | Source fix after design |
| The composite Journey proves create/start/result, cancel, retry, restart projection, isolation, and cleanup, but it does not execute `R-08` through `R-10` at deterministic commit barriers | `verified_fact` | `harness.ts#prepareEvaluationDevelopmentJourney`; Evaluation service audit | high | None |
| Evaluation service has no Acceptance scenario controller, runtime barrier registry, or failpoint hook | `verified_fact` | repository search under `apps/station/app/subserver/agent/service` | high | None |
| The accepted architecture requires deterministic scheduler, cancel/completion, and retry/metrics race orderings | `accepted_decision` | `design.md` section 24.1; V2 execution contract section 8.2 | high | Runtime implementation |
| MCA-A07's write set excludes Model and Station, where the missing contracts and commit barriers belong | `verified_fact` | `tasks/MCA-A07.md` | high | Accepted plan amendment |

The 57-tuple candidate cannot be produced from current source without
relabeling one composite flow, fabricating `cell-results`, or introducing
unreviewed Station instrumentation.

## 3. Decision

### MCA-D24: Extend The Single MCA-D22 Controller For J06

Extend the MCA-D22 `CapabilityAcceptanceScenarioService` into the single Agent
Acceptance scenario coordinator for J02, the MCA-D23 J03-J05 families, and
J06.

This is one service instance and one run/actor/tuple lifecycle. The
implementation may generalize the internal service name and move the shared
messages to an Agent acceptance contract, but it must hard-cut all callers in
the same change. A legacy J02 controller and a new Evaluation controller may
not coexist.

For J06, the controller injects an allowlisted barrier observer and run-scoped
clock into canonical Evaluation services. It coordinates ordering and
lifecycle interruption only. Evaluation repositories and workers remain the
sole writers of run, case, attempt, result, event, cancellation, retry, and
metrics truth.

The controller may:

- create actor-scoped source fixtures through canonical Evaluation APIs;
- set an allowlisted evaluator-availability precondition;
- arm, wait for, and release one reviewed Evaluation barrier;
- deliver the reviewed duplicate scheduler/retry command;
- suppress one cancellation acknowledgement and advance only the scenario
  clock to its accepted deadline;
- request an actual Station or client restart through the provisioner;
- clean the run-scoped fixture and verify no active work remains.

The controller may not:

- accept arbitrary SQL, repository methods, function names, durations,
  timestamps, statuses, metrics, or result payloads;
- directly update Evaluation tables or append run events;
- decide a race winner, fabricate a cancellation acknowledgement, freeze
  metrics, or create a retry child;
- return expected values, assertions, evidence roles, candidate artifacts, or
  pass/fail verdicts.

## 4. Ownership

| Concern | Owner |
|---|---|
| Scenario handle, reviewed tuple allowlist, actor/run scope, barrier plan, and fixture cleanup | Single MCA-D22 Agent Acceptance scenario coordinator |
| Benchmark, dataset, case, run, attempt, result, event, cancellation, retry, and metrics truth | Station Evaluation Service and repository |
| Scheduler claim, canonical Turn creation, cancellation propagation, and acknowledgement | Station Evaluation worker and Turn Service |
| Product action and receiver projection | Desktop or Browser through canonical Evaluation APIs |
| Station/client restart | Acceptance provisioner using declared runtime resources |
| Mobile compatibility | Mobile generated-protobuf contract tests |
| Tuple expansion and role applicability | Reviewed runtime matrix |
| Candidate assembly | Shared Agent V2 candidate producer |
| Candidate validation and later formal promotion | Separate validator; MCA-A08 owns `PROVEN` |

## 5. Runtime Topology

```text
HomeStationProvisioner
  -> enables one Agent Acceptance scenario controller for the active run
  -> allocates primary and isolation actors
  -> launches the selected Desktop App or Browser receiver

Desktop/Browser tuple adapter
  -> prepares one reviewed J06 scenario
  -> performs the canonical Evaluation action
  -> waits/releases only the server-selected barrier
  -> observes receiver + Station readback + events + TurnTrace + metrics
  -> requests real restart when required
  -> replays canonical reads
  -> cleans the tuple

Single Station scenario coordinator
  -> validates run/actor/tuple/profile identity
  -> delegates allowlisted callbacks to Evaluation Service/worker
  -> never writes Evaluation truth or emits a verdict

Evaluation Service / worker / repository
  -> execute normal CAS, idempotency, cancellation, retry, and metrics logic
  -> remain the only source of product evidence
```

Desktop and Browser use `station_turn` for cells with a canonical Evaluation
Turn lineage. `ERR-E01`, `ERR-E02`, and `ERR-E05` use
`station_control_plane`: they must prove the canonical rejection and zero Turn
creation without inventing a `turnAttempt`, TurnTrace, runtime event, or frozen
metrics artifact. Both profiles use the actual receiver surface and a fresh
scenario execution. Every turn-backed row uses a fresh Evaluation
run/attempt/result lineage.

## 6. Shared Control Contract

The existing MCA-D22 prepare/release/cleanup contract gains a typed scenario
family and runtime profile. The shared service also exposes barrier readiness
and run-scoped clock advancement:

```proto
enum AgentAcceptanceScenarioFamily {
  AGENT_ACCEPTANCE_SCENARIO_FAMILY_UNSPECIFIED = 0;
  AGENT_ACCEPTANCE_SCENARIO_FAMILY_BINDING_J02 = 1;
  AGENT_ACCEPTANCE_SCENARIO_FAMILY_GOVERNED_TOOL_J03 = 2;
  AGENT_ACCEPTANCE_SCENARIO_FAMILY_EVALUATION_J06 = 3;
}

message PrepareAgentAcceptanceScenarioRequest {
  string run_id = 1;
  string scenario_execution_id = 2;
  AgentAcceptanceScenarioFamily family = 3;
  string cell = 4;
  string platform = 5;
  string locale = 6;
  string ordering = 7;
  string sample_id = 8;
  string runtime_attestation_profile = 9;
}

message WaitAgentAcceptanceBarrierRequest {
  string scenario_handle = 1;
  string barrier = 2;
}

message ReleaseAgentAcceptanceBarrierRequest {
  string scenario_handle = 1;
  string barrier = 2;
}

message AdvanceAgentAcceptanceScenarioClockRequest {
  string scenario_handle = 1;
  string milestone = 2;
}
```

Exact field numbers and file placement are implementation details. The
following semantics are mandatory:

1. tuple identity must match one reviewed matrix row;
2. the server derives allowed barriers, lifecycle actions, and clock
   milestones from `family + cell + ordering`;
3. a handle is bound to one run, actor, source inventory, and tuple;
4. the request cannot provide a raw duration or timestamp;
5. one live handle cannot control another actor or tuple;
6. restart invalidates stale handles unless the reviewed cell explicitly
   requires handle restoration;
7. responses contain setup state only and no product assertion or verdict.

MCA-D23 and J06 share this contract and coordinator. Neither decision may
create a sibling control service.

## 7. J06 Scenario Registry

### 7.1 Success And Lifecycle Cells

| Cell | Independent execution |
|---|---|
| `AS-07` | Create a fresh benchmark/dataset/case set and run through canonical UI/API; wait for terminal attempts/results and atomically frozen metrics. |
| `AS-08` | Create a fresh running Evaluation; cancel through canonical UI/API; then create one child retry from selected failed/incomplete cases with immutable parent metrics. |
| `AS-14` | Create running and terminal parent/child fixtures, restart the actual receiver and Station, restore canonical state, then execute accepted deletion/retention behavior. |

`AS-14` cannot be satisfied by restarting only a Web view or rereading
in-memory state. The Station process identity and post-restart source commit
must match the tuple's runtime attestation.

### 7.2 Deterministic Race Cells

Each ordering starts from a clean fixture with a unique run and attempt set.

| Cell | Order A | Order B | Required oracle |
|---|---|---|---|
| `R-08` | duplicate scheduler delivery arrives after scheduler claim but before canonical Turn creation | duplicate arrives after Turn creation but before attempt binding/result completion | one attempt, one Turn, one result; duplicate returns existing identities |
| `R-09` | cancel-intent CAS commits before case-completion CAS | case-completion CAS commits before cancel intent | cancel-first blocks completion; completion-first freezes metrics; a separately reviewed missing-ACK branch reaches bounded `CANCEL_ACK_TIMEOUT` |
| `R-10` | duplicate retry arrives after parent terminal transaction but before child creation | duplicate arrives after child creation but before response/metrics reread | parent status/metrics/revision unchanged; one child with exact source attempt/result lineage |

The barrier observer may pause before or after the named CAS. It cannot write
the CAS result or select the winning state.

### 7.3 Typed Error Cells

| Cell | Canonical setup/action | Required Station result |
|---|---|---|
| `ERR-E01` | mutate the dataset revision, then start with the stale reviewed revision | `EVALUATION_DATASET_REVISION_CONFLICT`; zero scheduler claim/Turn |
| `ERR-E02` | invalidate or supersede the target Agent/readiness snapshot, then create/start the run | `EVALUATION_TARGET_SNAPSHOT_INVALID`; zero scheduler claim/Turn |
| `ERR-E03` | cancel a terminal run through the canonical command | `EVALUATION_RUN_NOT_CANCELLABLE`; terminal hash unchanged |
| `ERR-E04` | replay one retry idempotency key with a different case set | `EVALUATION_CASE_RETRY_CONFLICT`; parent and existing child unchanged |
| `ERR-E05` | make the selected evaluator unavailable before case scheduling | `EVALUATION_EVALUATOR_UNAVAILABLE`; failed run with zero case Turn |

Each error uses the accepted code, locale key, retryability, terminality, safe
details, receiver action, and zero-forbidden-side-effect oracle. The
controller's setup response is never error evidence.

### 7.4 Mobile Contract Cell

`AS-15-V2-E01` runs one source-bound generated-contract test for
dataset/run/attempt/result/metrics/cancel/retry projections. It emits
`contract_only` evidence and no receiver DOM, Station Turn, or Evaluation
runtime entity.

## 8. Per-Tuple Execution And Observation

For every Desktop or Browser tuple:

1. allocate `scenarioExecutionId` before setup;
2. validate the tuple against the reviewed matrix;
3. create a fresh actor-scoped fixture and fresh Evaluation identities;
4. arm only that tuple's allowlisted barrier;
5. perform the canonical product action from the declared receiver;
6. capture receiver DOM, Station run/attempt/result/event readback, TurnTrace,
   metrics lineage, side-effect counts, and barrier timestamps;
7. replay canonical reads and compare immutable identities/hashes;
8. clean all run-scoped resources and verify no active worker/claim remains;
9. emit only the roles allowed by the row's attestation profile.

No tuple may reuse another tuple's benchmark, dataset, run, attempt, result,
Turn, scheduler claim, retry child, scenario handle, or primary execution
identity.

`cell-results` is derived from these executions. A loop that writes reviewed
tuple keys with `observed=true` and `passed=true` without invoking the
corresponding scenario is forbidden.

## 9. Failure And Cleanup Semantics

- Unknown cells, profiles, barriers, orderings, actors, or run IDs reject
  before fixture mutation.
- First execution failure is retained; an in-place retry cannot replace it.
- A dropped cancellation ACK is scoped to the reviewed attempt and does not
  disable the canonical Turn cancel request.
- Scenario clock advancement is monotonic and isolated from production clocks
  and unrelated actors.
- A Station restart must reconstruct Evaluation state from durable truth.
- Cleanup is idempotent and mandatory.
- Cleanup failure, live scheduler work, leaked fixture state, or an
  unacknowledged worker after the cleanup deadline fails the tuple.
- Any missing tuple or required role keeps the Gate `UNPROVEN`.

## 10. Security And Production Disablement

- Scenario routes are absent or reject unless both the declared Acceptance
  environment and exact active `run_id` are enabled.
- Scenario control accepts no credentials, arbitrary provider payloads, SQL,
  filesystem paths, function names, raw times, or expected result values.
- Handles are opaque, actor/run/tuple scoped, short-lived, and omitted from
  evidence.
- Fixture data is namespaced by actor and scenario execution.
- Production Station cannot enable scenario control through a user request or
  stored configuration.
- Candidate artifacts retain hashes, revisions, counts, stable typed errors,
  and opaque product IDs only.

## 11. Alternatives Considered

### Populate `cell-results` From The Composite Journey

Rejected. The composite does not execute 57 tuple-specific states and would
violate MCA-D21.

### Use Existing Unit Tests As Race Evidence

Rejected. Unit tests prove source behavior but not Desktop/Browser receiver,
Station runtime, restart, cleanup, and one-execution-per-tuple evidence.

### Race Live Workers Without Barriers

Rejected. Timing-dependent execution cannot prove both commit orderings and
would be flaky rather than deterministic.

### Add An Evaluation-Only Scenario Service

Rejected. It would duplicate the MCA-D22 run, actor, production-disable, and
cleanup authority.

### Let The Harness Seed Evaluation Tables

Rejected. It would bypass canonical services and create a second source of
product truth.

## 12. Consequences

Positive:

- All 57 J06 tuples become executable without synthetic cell records.
- Evaluation race winners remain products of canonical CAS and idempotency
  logic.
- Desktop and Browser prove separate receiver paths over Station-owned
  Evaluation truth.
- J02, J03 when accepted, and J06 share one scenario-control lifecycle.

Negative:

- Model, Station, Desktop/Browser adapters, Mobile contract tests,
  provisioning, and candidate production change together.
- Exact J06 execution requires repeated fresh fixtures and real Station
  restarts, increasing runtime.
- The existing J06 role mismatch must be fixed after architecture acceptance,
  but that source fix alone cannot close the Task.
- MCA-A07 needs a plan/write-set amendment before implementation.

## 13. Architecture Gates

The amendment is complete only when:

1. production Station exposes no usable scenario control;
2. J02 behavior remains unchanged under the generalized single service;
3. arbitrary cells, barriers, clocks, actors, runs, and state values reject
   before mutation;
4. `AS-07`, `AS-08`, and `AS-14` execute independently per platform/locale;
5. `AS-14` includes actual Station restart and durable readback;
6. both orderings of `R-08`, `R-09`, and `R-10` execute from clean fixtures;
7. the missing-ACK path reaches bounded `CANCEL_ACK_TIMEOUT` without hanging;
8. `ERR-E01` through `ERR-E05` originate from canonical Evaluation services;
9. every Desktop and Browser tuple has a unique run/attempt/result/Turn
   lineage;
10. the Mobile marker runs independently and remains contract-only;
11. setup/barrier/clock/cleanup responses contain no verdict or evidence role;
12. cleanup leaves no active Evaluation fixture work;
13. the semantic validator accepts exactly 57 unique tuple and primary
    execution identities as `CANDIDATE` on one exact source.

For architecture Gate 13, the primary execution identity is the canonical Turn
for turn-backed cells and the fresh readiness snapshot for the three
pre-scheduling rejection cells. This distinction is encoded by the reviewed
runtime-matrix row rather than inferred by the candidate producer.

## 14. Review Condition

Accept only if J06 uses the same MCA-D22 scenario authority, every barrier is
allowlisted and tied to a real Evaluation commit boundary, the controller
cannot write product truth or choose race winners, real Station restart is
required where claimed, and synthetic `cell-results` remain forbidden.

Required Owner verdict:

```text
APPROVE MCA-D24
```

or:

```text
REQUEST CHANGES MCA-D24: <blocking findings>
```

Owner verdict:

```text
APPROVE MCA-D24
```

The Owner delegated full approval and execution authority on 2026-09-19. The
review criteria were checked against current source before this verdict was
recorded.

### v1.1 Evidence-Profile Correction

The delegated Owner authority accepted the fail-closed correction on
2026-09-21: `ERR-E01`, `ERR-E02`, and `ERR-E05` are control-plane rejection
rows because their required oracle forbids an Evaluation Turn. All other
Desktop and Browser J06 cells remain `station_turn`. The tuple set and total
remain unchanged at 57.
