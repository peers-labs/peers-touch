# MCA-D22 Capability Scenario Control Plane

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-18 | **Updated**: 2026-09-18
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `apps/station/app/subserver/agent/`,
> `apps/desktop/`, `tooling/acceptance/`

---

## 1. Scope

This amendment defines the missing runtime boundary required to execute every
reviewed `agent-v2-capability-binding-e2e` tuple truthfully.

It defines:

- typed catalog and binding failure ownership;
- a Station-owned, acceptance-only scenario control plane for deterministic
  preconditions and barriers;
- the boundary between scenario setup and product observation;
- actor/device isolation, readiness taxonomy, and catalog/binding error
  evidence;
- cleanup and production-disable semantics.

It does not:

- expose arbitrary manifest registration as a production user capability;
- restore the rejected Custom HTTP Plugin;
- move capability authority out of Station;
- change the reviewed 69-tuple matrix;
- permit fixture output, labels, or static files to substitute for product
  observations.

## 2. Verified Trigger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| The J02 matrix requires 60 `station_control_plane`, eight `contract_only`, and one `orchestration_guard` executions | `verified_fact` | `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml` | high | Full exact-source run |
| MCA-D21 requires one fresh execution identity and one real scenario per tuple | `accepted_decision` | MCA-D21 sections 4, 8, and 13 | high | J02 candidate |
| The current J02 runner executes one composite Native flow and no Browser, Mobile, or guard adapter | `verified_fact` | `tooling/acceptance/gates/agent/capability_binding_development.py` | high | None |
| Catalog and binding error enums exist in Model but no Station implementation consumes them | `verified_fact` | `model/domain/agent/capability.proto`; repository search outside generated files returns no consumers | high | None |
| Station exposes list/retire manifest and list/upsert/delete binding APIs, but no manifest-registration product endpoint | `verified_fact` | `handler/capability_authority_handler.go`; `agent.go` route registry | high | None |
| Binding mutation currently maps missing manifest, stale revision, unavailable capability, and invalid policy to generic `AgentNotFound`, `AgentVersionConflict`, or `AgentInvalidRequest` errors | `verified_fact` | `service/capability_authority_service.go` | high | None |
| `ERR-CAT03` cannot be caused through a current Desktop or Browser product action because source owners call `RegisterManifest` internally | `verified_fact` | Capability handler routes and Desktop capability API | high | None |
| The current binding provisioner authenticates Native and Browser as the same actor, while AS-10 requires cross-actor and cross-device attempts | `verified_fact` | `HomeStationProvisioner._agent_v2_binding_manifest`; provisioner tests | high | A two-actor J02 run |
| Static tests or relabelled composite captures would violate MCA-D21 | `accepted_decision` | MCA-D21 sections 8 and 13 | high | None |

The current source can produce useful J02 Development evidence, but it cannot
produce the reviewed formal candidate without inventing product behavior.

## 3. Decision

### MCA-D22: Station-Owned Capability Scenario Control Plane

Add a protobuf-defined capability scenario control plane that exists only in
an explicitly enabled Acceptance environment. It prepares deterministic
preconditions and barriers, while all claimed behavior is still observed
through canonical capability APIs and rendered product surfaces.

The control plane is not an alternate capability authority. It may arrange
inputs, pause an operation at a named barrier, and clean those inputs. It may
not return a pass verdict, fabricate role evidence, write candidate artifacts,
or bypass the canonical capability services.

## 4. Ownership

| Concern | Owner |
|---|---|
| Manifest, binding, readiness, revision, and typed failure truth | Station capability services |
| Cross-platform contracts, enums, safe error details, and fixture commands | Model protobuf |
| Native/Browser action and receiver observation | Desktop Harness through canonical Desktop APIs |
| Mobile compatibility assertions | Mobile generated-protobuf contract tests |
| Scenario preconditions, deterministic barriers, and fixture cleanup | Station acceptance scenario control |
| Tuple expansion and role applicability | Reviewed runtime matrix |
| Evidence assembly | Shared Agent V2 candidate producer |
| `CANDIDATE` validation and later `PROVEN` promotion | Separate Acceptance validator |

## 5. Runtime Topology

```text
HomeStationProvisioner
  -> enables acceptance scenario control for one run
  -> allocates actor/device fixtures
  -> returns opaque scenario authority

Desktop Harness
  -> prepares one tuple precondition
  -> performs the canonical UI/API action
  -> observes DOM + Station readback + zero-execution counters
  -> releases any deterministic barrier
  -> cleans the tuple fixture

Station capability services
  -> remain the sole manifest/binding/readiness authority
  -> emit typed failure contracts

J02 candidate adapter
  -> maps one capture to one reviewed tuple
  -> assembles immutable role artifacts
  -> emits CANDIDATE only
```

## 6. Scenario Control Contract

The Model layer defines four acceptance-only commands:

```proto
message PrepareCapabilityAcceptanceScenarioRequest {
  string run_id = 1;
  string scenario_execution_id = 2;
  string cell = 3;
  string platform = 4;
  string locale = 5;
  string ordering = 6;
  string sample_id = 7;
}

message PrepareCapabilityAcceptanceScenarioResponse {
  string scenario_handle = 1;
  repeated string opaque_resource_ids = 2;
  string source_inventory_hash = 3;
}

message ReleaseCapabilityAcceptanceBarrierRequest {
  string scenario_handle = 1;
  string barrier = 2;
}

message CleanupCapabilityAcceptanceScenarioRequest {
  string scenario_handle = 1;
}
```

The response contains setup identity only. It contains no assertion booleans,
expected result, evidence role, candidate path, or pass status.

The route family is absent unless all of these conditions hold:

1. the Station process is running in the declared Acceptance environment;
2. scenario control is explicitly enabled for that deployment;
3. the request is authenticated as the tuple actor;
4. `run_id` matches the active provisioner run;
5. the tuple is part of the reviewed J02 matrix.

Unknown cells, duplicate live handles, actor mismatch, stale run identity, and
cleanup failure reject without mutating product state.

## 7. Product Error Contract

The existing capability catalog and binding enums become active typed
semantics instead of unused declarations.

| Cell | Canonical operation | Typed result | Required safe details |
|---|---|---|---|
| `ERR-CAT01` | bind a missing manifest identity | `CAPABILITY_MANIFEST_NOT_FOUND` | `capability_id`, `capability_version` |
| `ERR-CAT02` | bind a superseded manifest version | `CAPABILITY_MANIFEST_VERSION_STALE` | `capability_id`, `expected_version`, `actual_version` |
| `ERR-CAT03` | source owner registers an invalid manifest | `CAPABILITY_MANIFEST_SCHEMA_INVALID` | `capability_id`, `schema_field`, `reason_code` |
| `ERR-B01` | update with stale binding revision | `CAPABILITY_BINDING_VERSION_CONFLICT` | `binding_id`, `expected_revision`, `actual_revision` |
| `ERR-B02` | bind a capability unavailable on the selected target | `CAPABILITY_UNAVAILABLE` | `capability_id`, `target_device_id`, `reason_code` |
| `ERR-B03` | submit an invalid approval policy | `CAPABILITY_POLICY_INVALID` | `binding_id`, `policy_kind`, `reason_code` |

Station emits the shared error payload with exact code, locale key,
retryability, terminality, and bounded details. Desktop translates the locale
key and renders the accepted contextual recovery action. Rejected mutations
leave the latest manifest/binding revision unchanged and create no execution
side effect.

`ERR-CAT03` remains source-owner behavior. The scenario control invokes the
canonical source-registration service and then Desktop observes the resulting
catalog issue through the normal capability inventory projection. No generic
production manifest-registration route is added.

## 8. Readiness Taxonomy Contract

Each taxonomy tuple must execute an independent state transition:

| Cell | Scenario precondition/action | Station truth |
|---|---|---|
| `TAX-01` | fresh manifest, binding, runtime, and client-session facts | `known` plus ready capability state |
| `TAX-02` | binding mutation paused before Station acknowledgement | `pending`; no terminal inference or dispatch |
| `TAX-03` | degraded manifest/runtime with an accepted reduced path | `degraded` with reason and reduced outcome |
| `TAX-04` | required local capability absent on selected target | `unavailable`; zero dispatch |
| `TAX-05` | every authoritative fact source absent or stale | `unknown`; unsupported commitment blocked |
| `TAX-06` | explicit deny policy or blocked manifest | `blocked`; zero bypass |

`pending` is a client-visible command state and is not added to
`CapabilityReadinessState`. All other states are Station readiness facts. The
Harness records both dimensions without translating one into the other.

## 9. Actor And Device Isolation

The J02 provisioner allocates:

- one primary actor used for the candidate-wide actor identity;
- one secondary actor used only as a cross-scope target;
- distinct Native and Browser device/session identities.

AS-10 performs canonical cross-actor binding/read attempts and cross-device
session attempts. Evidence records only hashes and typed rejection details.
The secondary actor never becomes the candidate actor identity.

## 10. Per-Tuple Observation

For every Desktop or Browser tuple:

1. allocate `scenarioExecutionId` before setup;
2. set the requested locale;
3. prepare only the named cell's preconditions;
4. execute the named product action;
5. observe receiver DOM and canonical Station readback;
6. compare before/after runtime activity for zero-execution;
7. replay the authoritative read and compare hashes;
8. clean all fixture state;
9. emit exactly the roles allowed by that row.

Mobile runs one real Vitest invocation per tuple marker. The Custom Plugin
retirement tuple runs the scoped old-path inventory, Desktop retired-storage
test, Station audit/purge migration test, and a credential/log redaction scan.
It emits no product-runtime entity.

## 11. Security And Failure Semantics

- Scenario control is fail-closed and unavailable in production.
- Fixture identifiers are opaque and actor/run scoped.
- Fixture setup never accepts or returns credentials.
- Error details use allowlisted non-secret fields only.
- Candidate artifacts contain hashes, revisions, counts, and opaque IDs.
- A process restart invalidates all live scenario handles.
- Cleanup is idempotent and mandatory; failed cleanup fails the tuple.
- A candidate stops at the first failed tuple and remains `UNPROVEN`.
- No retry may hide or replace a failed tuple execution.

## 12. Alternatives Considered

### Relabel the current composite Development Journey

Rejected. It does not execute all reviewed states and violates MCA-D21.

### Treat missing cells as static or unit-test evidence

Rejected. The reviewed rows require Desktop/Browser receiver and Station
control-plane observations.

### Add a production generic manifest-registration endpoint

Rejected. Manifest mutation belongs to accepted source owners, not end users or
the Desktop capability inventory.

### Remove or downgrade the unsupported tuples

Rejected. That weakens the accepted product and matrix scope.

### Let the Harness seed browser-local objects

Rejected. It would create a second authority and could not prove Station
revisions, actor isolation, or cleanup.

## 13. Consequences

Positive:

- Every J02 tuple becomes executable without fabricated runtime entities.
- Typed catalog/binding failures become real product semantics.
- Deterministic barriers make pending, stale, actor, and device races
  reproducible.
- The control plane remains setup-only; product observations remain canonical.

Negative:

- Model, Station, Desktop, provisioner, and candidate adapter all change.
- The remote Acceptance deployment must explicitly enable scenario control.
- J02 formal execution remains materially longer because all 69 tuples run
  independently.

## 14. Architecture Gates

The amendment is complete only when:

1. production Station omits or rejects every scenario-control route;
2. acceptance setup returns no pass/fail or product observation;
3. all six catalog/binding error cells emit exact typed product errors;
4. all six taxonomy cells expose their distinct state and zero-side-effect
   oracle;
5. AS-10 proves both actor and device isolation;
6. every Desktop/Browser tuple has a unique readiness snapshot;
7. Mobile markers are individually invoked and source-bound;
8. AS-16 emits zero violations, zero execution, clean migration/storage
   cleanup, and no secret-bearing evidence;
9. the full semantic validator accepts exactly 69 unique tuple and primary
   execution identities on one exact source.

## 15. Review Condition

Accept only if the control plane cannot become a second product authority, the
typed failures are visible through canonical product surfaces, production
cannot enable scenario controls accidentally, and the reviewed tuple scope is
unchanged.

Required Owner verdict:

```text
APPROVE MCA-D22
```

or:

```text
REQUEST CHANGES MCA-D22: <blocking findings>
```

Owner verdict:

```text
APPROVE MCA-D22
```

The Owner accepted MCA-D22 on 2026-09-18.
