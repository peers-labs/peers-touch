# Acceptance Framework

`tooling/acceptance/` is the product acceptance layer for agent-driven delivery. It
defines how a product capability proves that it is complete, which gates must
run for a changed path, and which artifacts should be produced for human review.

## Responsibilities

- `registry.yaml` maps changed paths to required gates and impacted features.
- `capabilities/` defines project-wide and domain-specific product capabilities, evidence, and unproven scope.
- `domains/` defines validation profiles for product domains such as Federation.
- `domains/index.yaml` lists project domains, onboarding status, coverage state, and next candidates.
- `templates/` contains domain, capability, and feature templates for new product domains.
- `gates.yaml` defines gate commands, timeouts, environments, tiers, and artifact expectations.
- `features/` contains product feature contracts.
- `gates/` contains stable cross-system acceptance implementations.
- [`gates/mobile/README.md`](./gates/mobile/README.md) records the Mobile
  native E2E driver selection, Desktop comparison, hybrid context model, and
  simulator-versus-physical proof boundary.
- `playbooks/` explains how agents should run, diagnose, and preserve acceptance flows.
- Runtime manifests use typed `services[service-id]` as the only service
  topology. Every required service must carry an ID/kind-matched source-bound
  attestation; the removed top-level `station` field is invalid.
- `desktop-performance-cohort.json` is the canonical P0c-3 profile, account,
  dataset, window, warmup, build, runtime, and scenario manifest.
- `reports/` stores local or CI acceptance artifacts and is ignored by git.

## Federation Bootstrap Loop

Federation is the first validation domain for this framework because it crosses
Station, Dashboard, Desktop gateway, projections, and isolated testnet services.
This creates a two-way proof:

- Acceptance proves Federation capability by running stable gates against the live `fedp5` environment.
- Federation proves Acceptance feasibility because the gates exercise real product surfaces instead of mocks.
- `make acceptance-federation-report` runs the Federation gates and writes `tooling/acceptance/reports/federation-acceptance-report.md`.
- `make acceptance-validate DOMAIN=federation` checks the Federation domain profile against the project-wide capability graph, feature contracts, registry planning, gate definitions, run results, and reports.
- `make acceptance-federation-mutual-validation` remains a Federation alias, not the acceptance core entry.

## Project Coverage

- `make acceptance-validate` validates every active domain structure in `tooling/acceptance/domains/index.yaml`.
- `make acceptance-validate DOMAIN=chat` validates the Chat managed-domain profile structure.
- `make acceptance-validate DOMAIN=federation` validates one domain profile structure.
- `make acceptance-validate DOMAIN=station-dashboard` validates the Station Dashboard managed-domain profile structure.
- `python3 tooling/scripts/acceptance-validate.py --domain federation --require-proven` additionally requires latest gate evidence; this is what the Federation mutual-validation gate uses.
- `make acceptance-chat-domain-validation` runs the Messaging Platform contract,
  Station messaging packages, native selector contract, and Desktop gateway E2E
  gates before requiring latest evidence for the managed domain profile.
- `make acceptance-chat-desktop-gateway` requires a running Desktop HTTP gateway
  and proves the client-owned E2EE create, send, hydrate, and decrypt flow.
- `make acceptance-station-dashboard-domain-validation` runs the Station Dashboard gates and then requires latest evidence for the managed domain profile.
- `make acceptance-coverage-report` writes `tooling/acceptance/reports/project-coverage-report.md` and summarizes active, candidate, planned, and not-onboarded domains.

## Agent Workflow

1. Update or add a feature contract when a new product capability is introduced.
2. Run `make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>` after code changes.
3. Run `make acceptance PLAN=<plan-path>` when a workstream needs an explicit gate bundle; the profile/runtime environment must already be active before this command.
4. Run `make quality-evidence REVIEW_RANGE=<base>...<head>` when the change is entering review.
5. Run `make acceptance-run-ci` for selected `ci-*` gates, or `make acceptance-run-env-evidence` only when the required environment is available.
6. Run `make acceptance-report` and include proven / unproven scope in the handoff.
7. Move useful probes into `tooling/acceptance/gates/` and reference them from `gates.yaml`.
8. For a product capability loop, prefer explicit plans over adding phase-specific Make targets.
9. For a new product domain, follow `docs/architecture/acceptance-framework/domain-onboarding.md` and start from `tooling/acceptance/templates/`.
10. For native Chat journeys, follow
    `tooling/acceptance/playbooks/chat-native-visible-clients.md`; visible
    observers, source matching, isolated profiles, bounded steps, and composer
    cleanup are mandatory.

### W8 Native Chat Operations

`make acceptance-chat-native-static` runs unit and selector contracts without
launching a live journey. Live targets are
`acceptance-chat-native-two-client`, `acceptance-chat-native-multi-device`,
`acceptance-chat-native-recovery`, and `acceptance-chat-native-group-mls`;
`acceptance-chat-native-w8` runs all four.

### W11 Closure

`make acceptance-chat-w11` runs the fixed W11 closure plan
(`tooling/acceptance/plans/chat-w11-closure.json`) — 10 gates in sequence:
forbidden-path scan, duplicate-implementation scan, visible-static checks, all
six native E2E journeys (two-client, interactions, typing, multi-device,
recovery, group-MLS), and a mechanical completion-audit that verifies every
report exists with PASS status before emitting `chat-w11-closure-verdict.json`.
The gate list is fixed in the plan JSON — there is no AI-driven gate selection.
Required environment: `CHAT_ACCEPTANCE_RESET=1`, `CHAT_ACCEPTANCE_PASSWORD=1`,
`CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1`, and a Station whose build commit
matches the client HEAD.

The two-client Direct journey uses the Core embedded-WebDriver runner. It
requires `CHAT_NATIVE_STATION_URL` and `CHAT_ACCEPTANCE_RESET=1`. It uses the
committed disposable dev-account fixture from `apps/station/app/conf/actor.yml`
(`alice@p.t`, `bob@p.t`, `carol@p.t`, password `1`); these Acceptance-only
credentials are not part of the production Desktop package. The reset Fixture
preserves the pre-created actors, while the login result supplies their canonical
PTIDs. The runner rejects a live Station whose `/app-meta/version` commit does
not match the tested client commit.

The remaining multi-device, recovery, and group-MLS runners still require
`CHAT_NATIVE_STATION_ATTESTATION`, canonical actor PTIDs, pre-created accounts,
and `CHAT_NATIVE_DEMO_PASSWORD`. Their attestation JSON contains `commit`,
`"workspaceDigest": "clean"`, and `protoDigest`. The digest covers source
protos plus Desktop TypeScript and Station Go generated bindings.
`CHAT_NATIVE_CLIENT_WORKTREES` accepts one worktree path per client, separated
by commas; one path may be reused for local process-isolation checks.

### Agent R6 Stream Resilience

`agent-stream-resilience-e2e` is the stable native Gate for R6. It requires the
active `one` profile and runs only through `acceptance-run.py`, so the
Home Station Provisioner supplies source attestation, the actor Fixture,
credential references, isolated ports, and storage before the Gate starts.

The Gate inserts a run-local TCP proxy between Desktop and Station, cuts the
active stream, verifies the visible `reconciling` state, restores the transport,
and compares the replayed Desktop projection with Station readback. It then
starts a second turn, logs out through the production identity pipeline, proves
that the auth gate has no Agent operation tray, re-authenticates, and verifies
the prior actor projection remains cleared. Reports, DOM observations, Station
readback, logs, and cleanup evidence are written only to the external Evidence
Store.

### Agent V2 Foundation Runtime

`agent-v2-kernel-foundation-e2e` consumes the provisioned profile selected by
`PT_ACCEPTANCE_APPROVED_PROFILE`, with exactly one Native Tauri client and one
isolated Browser client.
`foundation_runtime_client.py` owns their launch, Harness connection, reverse
shutdown, port checks, and storage cleanup. `foundation_group_one_probe.py`
expands the reviewed matrix and dispatches the 32 Group 1 tuples by platform,
locale, and scenario before `foundation_direct_adapter.py` applies its
fail-closed oracle. Runtime controllers and Harnesses only capture production
facts; they cannot synthesize assertion outcomes or promote proof status.

## Desktop Performance Acceptance Logic

Desktop performance acceptance is organized as a source-bound evidence funnel,
not as point-to-point spot checks. The funnel answers one question per layer:

1. Contract: can acceptance preserve stable targets, source artifacts, and
   `PARTIAL` / `UNPROVEN` metadata before runtime samples are trusted?
2. Telemetry: can Desktop events flow through Gateway into Station, then return
   through raw query, rollup query, and Dev/CI mirror artifacts?
3. Runtime: can each runtime cell report an explicit state without one cell
   impersonating another?
4. Red-line: can matrix and report gates make a source-bound pass/fail judgment
   without hiding missing evidence?

The runtime layer admits no samples until
`desktop-performance-cohort-gate.py` proves that browser, dev native, and
packaged native observations match `desktop-performance-cohort.json`, including
the actual authenticated actor rather than only the requested profile name.

The original Phase 0 bundle remains available as the pilot construction bundle:

```bash
make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json
```

Long-lived Desktop performance gates are split by logical layer:

```bash
make acceptance PLAN=tooling/acceptance/plans/desktop-performance-contract.json
make acceptance PLAN=tooling/acceptance/plans/desktop-performance-telemetry.json
make acceptance PLAN=tooling/acceptance/plans/desktop-performance-runtime.json
make acceptance PLAN=tooling/acceptance/plans/desktop-performance-redline.json
```

The profile/runtime environment must be selected before running these plans, for
example with `make profile PROFILE=<profile>`. Gate scripts must only check their
own concern; they must not encode a specific environment such as `one`.

Use the layers as follows:

| Layer | Plan | Long-term role | Failure meaning |
|---|---|---|---|
| Contract | `desktop-performance-contract.json` | Static and source-bound contract gate for stable anchors, runner semantics, templates, and traceability | Acceptance cannot trust runtime samples |
| Telemetry | `desktop-performance-telemetry.json` | Product telemetry sink gate for Desktop Gateway, Station ingest/query/rollup, local buffer diagnostics, and Station sampler mirror | Metrics are local-only or not queryable from Station |
| Runtime | `desktop-performance-runtime.json` | Runtime matrix gate for preflight, DOM anchors, runtime-cell observations, and matrix state | Runtime evidence is missing, blocked, or conflated |
| Red-line | `desktop-performance-redline.json` | Merge/readiness judgment gate for sampler evidence, matrix, report, and traceability | Performance conclusion must stay `PARTIAL` / `UNPROVEN` |

Phase-specific scaffolding such as template artifacts may remain inside the
Phase 0 bundle until real collectors replace them. Once a layer is fully backed
by live evidence, promote the corresponding long-lived plan rather than adding a
new phase-specific Make target.

## Boundary

Acceptance is not a replacement for unit tests inside `apps/*`. Language-native
tests stay close to their code. Acceptance gates prove product behavior across
Station, Desktop, Dashboard, testnet, and projections.
