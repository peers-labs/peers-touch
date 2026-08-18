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
- `environments/` defines machine-readable contracts for provisioned Gate environments.
- `provisioners/` resolves profiles, source identity, Fixtures, credentials, and client isolation before Gate execution.
- `behavior-rules/` maps receiver-visible source owners to receiver-proof Gates.
- `features/` contains product feature contracts.
- `gates/` contains stable cross-system acceptance implementations.
- `playbooks/` explains how agents should run, diagnose, and preserve acceptance flows.
- `desktop-performance-cohort.json` is the canonical P0c-3 profile, account,
  dataset, window, warmup, build, runtime, and scenario manifest.
- Runtime artifacts are owned by the external Acceptance Evidence Store.
  `tooling/acceptance/` retains only code, contracts, schemas, templates, and
  intentional test fixtures.

Inspect artifacts through the canonical operator interface:

```bash
python3 tooling/scripts/acceptance-artifact.py root
python3 tooling/scripts/acceptance-artifact.py cat \
  --gate <gate-id> --role <role>
```

`PT_ACCEPTANCE_ARTIFACT_ROOT` is an optional local override and mandatory in
CI. Writers never fall back to the repository.

## Federation Bootstrap Loop

Federation is the first validation domain for this framework because it crosses
Station, Dashboard, Desktop gateway, projections, and isolated testnet services.
This creates a two-way proof:

- Acceptance proves Federation capability by running stable gates against the live `fedp5` environment.
- Federation proves Acceptance feasibility because the gates exercise real product surfaces instead of mocks.
- `make acceptance-federation-report` runs the Federation gates and publishes
  the report under Gate `acceptance-capability-report`, role
  `capability-report`.
- `make acceptance-validate DOMAIN=federation` checks the Federation domain profile against the project-wide capability graph, feature contracts, registry planning, gate definitions, run results, and reports.
- `make acceptance-federation-mutual-validation` remains a Federation alias, not the acceptance core entry.

## Project Coverage

- `make acceptance-infra-validate` validates only Acceptance Infra
  self-consistency and never consumes business Domain injection as a framework
  completion condition.
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
- `make acceptance-coverage-report` publishes the project coverage report to
  the external Evidence Store and summarizes active, candidate, planned, and
  not-onboarded domains.
- `acceptance-runtime-provisioning-self` is the stable CI Gate for Provisioning
  models, owners, runner semantics, behavior planning, redaction, freshness,
  and Gap Detector regressions.

## Agent Workflow

1. Update or add a feature contract when a new product capability is introduced.
2. Run `make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>` after code changes.
3. Activate the intended worktree profile, then run `make acceptance PLAN=<plan-path>`. Gates with a declared `provisioner` receive an immutable Runtime Manifest before their command runs.
4. Run `make quality-evidence REVIEW_RANGE=<base>...<head>` when the change is entering review.
5. Run `make acceptance-run-ci` for selected `ci-*` gates, or `make acceptance-run-env-evidence` only when the required environment is available.
6. Run `python3 tooling/scripts/acceptance-gap-detect.py --range <range>` before any completion, commit, or PR-readiness claim.
7. Run `make acceptance-report` and include proven / blocked / failed / unproven scope in the handoff.
8. Move useful probes into `tooling/acceptance/gates/` and reference them from `gates.yaml`.
9. For a product capability loop, prefer explicit plans over adding phase-specific Make targets.
10. For a new product domain, follow `docs/architecture/acceptance-framework/domain-onboarding.md` and start from `tooling/acceptance/templates/`.
11. For native Chat journeys, follow
    `tooling/acceptance/playbooks/chat-native-visible-clients.md`; visible
    observers, source matching, isolated profiles, bounded steps, and composer
    cleanup are mandatory.

### W8 Native Chat Operations

`make acceptance-chat-native-static` runs unit and selector contracts without
launching a live journey. Live targets are
`acceptance-chat-native-two-client`, `acceptance-chat-native-multi-device`,
`acceptance-chat-native-recovery`, and `acceptance-chat-native-group-mls`;
`acceptance-chat-native-w8` runs all four.

Live runs require an active worktree profile, `CHAT_NATIVE_DEMO_PASSWORD`, and
explicit destructive-reset authorization:

```bash
make profile PROFILE=<approved-disposable-profile>
CHAT_ACCEPTANCE_RESET=1 \
CHAT_NATIVE_DEMO_PASSWORD="$CHAT_NATIVE_DEMO_PASSWORD" \
make acceptance-chat-native-two-client
```

`acceptance-run.py` resolves `home-station`, verifies the deployment
attestation against `/app-meta/version`, runs the Actor Fixture, allocates
isolated clients, and passes only `PT_ACCEPTANCE_RUNTIME_MANIFEST` to the Gate.
Station URL, attestation path, canonical PTIDs, ports, profiles, storage roots,
and per-client WebDriver ports must come from that manifest. Missing or mismatched inputs
produce `BLOCKED/UNPROVEN` with exit code `2`; they never fall back to raw
`CHAT_NATIVE_*` identity variables.

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
