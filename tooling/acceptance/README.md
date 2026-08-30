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
- `drivers/native/` defines the platform-neutral Native Desktop interaction
  contract and OS-specific adapters; business Gates inject this boundary and
  contain no AppKit, Quartz, CoreGraphics, X11, or Win32 implementation.
- `runtime-cells/` contains non-sensitive platform capability contracts.
- `images/desktop-linux/` owns the digest-pinned Linux userland, persistent
  Xorg session, Window Manager, observer, and in-container process supervisor.
- `provisioners/native_desktop_linux.py` resolves the local
  `profile:acceptance-linux` reference, performs exact Git object sync, builds
  and attests the Desktop binary, and coordinates source-bound remote cleanup.
- `provisioners/local_tunnel_supervisor.py` owns run-scoped local SSH forwards,
  applies the cell TTL independently of the lifecycle command, and verifies
  reverse-order tunnel teardown.
- `playbooks/` explains how agents should run, diagnose, and preserve acceptance flows.
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
  and consumes the Provisioner-owned disposable Alice/Bob actor manifest. It
  proves atomic account/JWT/Messaging Engine transitions, JWT-bound OAuth PIN
  unlock, legacy PIN actor-binding rejection, and the client-owned E2EE create,
  send, hydrate, and decrypt flow.
- `make acceptance-station-dashboard-domain-validation` runs the Station Dashboard gates and then requires latest evidence for the managed domain profile.
- `make acceptance-coverage-report` writes
  `docs/architecture/acceptance-framework/coverage-report.md` from canonical
  durable latest manifests. Proof requires successful redaction, intact
  artifact identity/digests, and a complete same-source runtime-cell matrix
  when the Gate declares multiple required cells.

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

## Native Desktop Runtime Cells

The Linux cell is managed through:

```bash
make acceptance-cell-ready CELL=desktop-linux-native
make acceptance-cell-status CELL=desktop-linux-native
make acceptance-cell-logs CELL=desktop-linux-native
make acceptance-cell-stop CELL=desktop-linux-native
```

`profile:acceptance-linux` resolves locally from
`.local/acceptance/runtime-cells/acceptance-linux.env`. The profile names a
separate deploy environment under `.local/deploy/envs/`; neither file is
committed. The runtime contract contains no host, username, credential, or
remote absolute path. `ready` requires a clean Git worktree and synchronizes
only Git objects before the remote image and Desktop build.
Profiles may select HTTPS mirrors for the base image, Node distribution,
rustup, and the Cargo registry; immutable image/toolchain pins remain enforced.
Aggregate execution retains the remote source lease from synchronization
through Gate execution and releases it last during cell teardown, so
Gate-time native adapter imports cannot drift from the attested binary.

The remote controller is copied into the run directory before its detached
reaper starts. Cleanup retains ownership metadata and reports
`CLEANUP_FAILED` when any container, port, source, or storage resource remains.
The running container is launched by immutable image ID, and readiness requires
an observed XTest input effect in addition to focus, point ownership, and
desktop screenshot probes.

### W8 Native Chat Operations

`make acceptance-chat-native-static` runs unit and selector contracts without
launching a live journey. Every Native Chat target accepts
`RUNTIME_CELL=<cell-id>` and routes through `NativeDesktopRuntimeBinding`.
`acceptance-chat-native-w8` runs the two-client, interactions, typing,
multi-device, recovery, and Group MLS journeys on the selected cell. Contact
message resilience has its own runtime-cell-aware target.

### W11 Closure

`make acceptance-chat-w11` runs the fixed W11 closure plan
(`tooling/acceptance/plans/chat-w11-closure.json`) — 11 gates in sequence:
forbidden-path scan, duplicate-implementation scan, visible-static checks, the
Product Closure journey, all six W8 native E2E journeys (two-client,
interactions, typing, multi-device, recovery, group-MLS), and a mechanical
completion-audit. The audit requires current-source `DONE/PROVEN` evidence for
the declared `desktop-linux-native` claim and emits the closure verdict through
the external Evidence Store under role `closure-verdict`.
The gate list is fixed in the plan JSON — there is no AI-driven gate selection.
This closure intentionally proves Linux only; macOS and Windows remain
separate, explicit claims. Required environment:
`CHAT_ACCEPTANCE_RESET=1`, `CHAT_ACCEPTANCE_PASSWORD=1`,
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

All Native Chat runners consume the Provisioner-owned immutable runtime and
actor manifests. A selected runtime cell fails closed when the manifest,
source/Station/cell/binary identity chain, actor allocation, or cleanup
contract is incomplete. Canonical reports and diagnostic files are written to
the current external Evidence Store run. Multi-device same-actor identity
preparation is delegated to the runtime storage owner rather than accessing a
remote filesystem from the business Gate.

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
