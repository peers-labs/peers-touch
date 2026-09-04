# Native Desktop Runtime Cells — Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-24 | **Updated**: 2026-09-03
> **Owner**: Acceptance Infrastructure + Desktop Platform + Chat Domain
> **Branch**: `refactor/chat-acceptance-cutover`
> **Parent Design**: [../design.md](../design.md)
> **Approved Decisions**: D-13, D-14, D-15, D-16, D-17, D-18

---

## 1. Goal And Claims

Deliver one source-bound Native Desktop Acceptance system that:

- Executes the same product Gate against explicit macOS, Linux, and Windows
  runtime cells.
- Keeps platform window/input mechanics outside business Gate code.
- Uses incremental Git object transfer and remote build caches instead of
  copying a full worktree for every run.
- Runs Linux Tauri/WebKitGTK in a digest-pinned supported container userland on
  the existing Ubuntu 20.04 host.
- Keeps remote embedded WebDriver endpoints on loopback and accesses them only
  through run-scoped SSH tunnels.
- Preserves immutable local Evidence Store ownership and reverse-order cleanup.
- Continues MP-W13 product proof on Linux without changing its Chat assertions.
- Extends the completed Linux Native closure with explicit client-to-Station
  bindings required by the remaining multi-Station Chat proof claims.

This plan does not claim cross-platform completion until every required runtime
cell has source-matched Native evidence.

## 2. Architecture Baseline

- `docs/architecture/acceptance-framework/design.md` §1.3, §2.1, §3.10,
  §4.12, §8
- `docs/architecture/acceptance-framework/decisions.md` D-13 through D-16
- `docs/architecture/acceptance-framework/data-model.md` §15 through §18
- `docs/architecture/acceptance-framework/integration.md` §1.5 and §1.6
- `docs/architecture/acceptance-framework/decisions.md` D-17 and D-18
- `docs/architecture/acceptance-framework/data-model.md` D-18 client binding
  and binding-proof contracts
- `docs/architecture/acceptance-framework/module-layout.md`
- `docs/architecture/messaging-platform/execution-plans/20260808-messaging-platform.md`
  MP-W13

Accepted invariants:

- A platform cell cannot satisfy another platform's proof requirement.
- Embedded WebDriver remains loopback-only.
- Final proof uses a clean, Git-addressable commit.
- Business Gate assertions do not own host, display, transport, or native input.
- Runtime Infra does not define Chat actors, selectors, journeys, or success.
- Linux Native proof uses a real Xorg session and XTest/EWMH, not Xvfb.
- Host and container userland identity are separately attested.
- Failure and cancellation execute the same bounded reverse cleanup.

## 3. Scope And Non-Scope

### In Scope

- Runtime Cell contract, manifest, lease, matrix aggregation, validation, and
  typed failures.
- Role-neutral incremental Git source synchronization extracted from current
  remote deployment behavior.
- SSH host verification, bounded remote commands, port forwarding, cancellation,
  and teardown.
- Launcher-neutral `TauriDriver`.
- Platform-neutral `NativeDesktopAdapter` and macOS/Linux/Windows implementations.
- Linux container image, persistent caches, Xorg desktop, observer, and cleanup.
- Desktop platform environment/provisioner injection for all three OS cells.
- Chat Native runner migration to the adapter contract.
- Linux execution of `chat-native-product-closure-e2e`.
- D-18 Core client binding contract, Native Runtime Binding cutover, and Linux
  multi-Station proof for the remaining Chat enhancements.

### Non-Scope

- Changing MP-W13 product semantics, selectors, actors, timeout budget, or
  first-failed-boundary discipline.
- Replacing Station, Profile Three, Chat Fixture, or Evidence Store ownership.
- Treating container smoke, DOM-only click, or screenshot-only evidence as
  Native product proof.
- Upgrading the Ubuntu 20.04 host.
- Exposing WebDriver, VNC, or secrets on a public interface.
- Claiming Windows `PROVEN` before a Windows runtime host is supplied and run.
- Reworking the inbound webhook lifecycle in `tooling/docker/deploy-branch.sh`;
  it already fetches Git source and does not serve Profile-based deployment.
- Mobile and Federation D-18 business injection; those Domains remain separate
  `BUSINESS_INJECTION_REQUIRED` follow-up work and do not block this Linux Chat
  extension.

## 4. Current-State Inventory

| Area | Current state | Required target |
|---|---|---|
| Gate environment | One `native-tauri-embedded-webdriver` environment with implicit local macOS | Environment plus explicit required runtime cells |
| Tauri driver | Starts a local process and connects local loopback | W3C client separated from local/remote launcher |
| Native input | AppKit/CoreGraphics/Quartz embedded in Chat runner | Platform adapters behind one interface |
| Remote source | Station/Relay `deploy.sh` embeds Git push/fetch with role lifecycle | Shared role-neutral source-sync primitive |
| Linux host | Ubuntu 20.04, Docker 28.1.1, QXL output, no project checkout/toolchain | Digest-pinned supported userland and cached remote checkout |
| Linux display | GDM Wayland greeter only | Isolated Xorg desktop session owned by the cell |
| Linux WebView | Host has WebKitGTK 4.0 runtime | Container has WebKitGTK 4.1 dev/runtime |
| Evidence | Local Evidence Store, no cell identity | Local Evidence Store keyed by Gate, cell, and source |
| Cleanup | Local process/port/storage cleanup | Local tunnel plus remote process/port/storage/session/source lease audit |
| Chat runner | Product assertions plus macOS mechanics | Product assertions only; consumes injected DOM/native interfaces |

Current implementation references:

- `tooling/acceptance/core/{provisioning.py,provisioner.py,lease.py}`
- `tooling/acceptance/drivers/tauri.py`
- `tooling/acceptance/environments/native-tauri-embedded-webdriver.yaml`
- `tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py`
- `tooling/scripts/deploy/deploy.sh`
- `tooling/scripts/acceptance-run.py`
- `tooling/acceptance/gates/chat/native_product_closure_runner.py`
- `apps/desktop/src-tauri/src/main.rs`

## 5. Responsibility Ownership

| Work | Owner | Must not contain |
|---|---|---|
| Cell schema, registry, leases, matrix validator | Acceptance Infra | Product assertions or concrete credentials |
| SSH transport and source-sync primitive | Acceptance Infra / Deployment | Station restart semantics or Chat behavior |
| macOS/Linux/Windows cell contracts and provisioners | Desktop platform injection | Chat selectors or success criteria |
| Native platform adapters | Desktop platform injection | Actor journeys or Fixture state |
| Chat runner adapter consumption | Chat business | SSH, Docker, Xorg, AppKit, X11, Win32 |
| MP-W13 Linux execution and evidence | Chat business | Infra readiness claims |
| D-18 binding parser, resolver, proof closure | Acceptance Infra | Concrete Chat clients, Stations, or product assertions |
| D-18 Native binding and multi-Station proof | Desktop platform + Chat Domain | Mobile or Federation business injection |

Any missing platform injection emits `BUSINESS_INJECTION_REQUIRED` for the
Desktop platform cell and remains non-blocking to generic Infra readiness.

## 6. Dependency Graph

```text
NDR-W1 Cell contracts and matrix core
   ├──> NDR-W2 SSH transport and incremental source sync
   ├──> NDR-W3 Tauri launcher/connection separation
   └──> NDR-W4 NativeDesktopAdapter contract
             │
NDR-W2 ──────┼──> NDR-W5 Linux Desktop cell
NDR-W3 ──────┤
NDR-W4 ──────┘
   │             │
   ├─────────────┼──> C1 adapter ownership cutover
   │             │       └──> NDR-W6 Chat runner migration
   │             │                 └──> NDR-W7 Linux MP-W13 proof
   │             │                           └──> NDR-W10 D-18 Linux multi-service extension
   │             │
   ├──> NDR-W8 macOS regression
   └──> NDR-W9 Windows cell implementation/proof

NDR-W7 + NDR-W10
   └──> Expanded Linux Chat readiness

NDR-W7 + NDR-W8 + NDR-W9
   └──> Final cross-platform matrix readiness
```

NDR-W2, NDR-W3, and NDR-W4 may be implemented in parallel after NDR-W1.
NDR-W8 and NDR-W9 may proceed independently after C1.

## 7. Execution Closures

### NDR-W1: Runtime Cell Core

Deliver:

- Runtime Cell contract, parser, manifest, lifecycle and typed errors.
- Gate `requiredRuntimeCells` parsing and Gate × cell result identity.
- Matrix aggregation that fails closed on missing, stale, or substituted cells.
- Synthetic contracts and self-tests independent of Chat.

Targets:

- `tooling/acceptance/core/runtime_cell.py`
- `tooling/acceptance/core/provisioning.py`
- `tooling/scripts/acceptance-run.py`
- `tooling/scripts/acceptance-validate.py`
- `tooling/acceptance/tests/`

Evidence:

- Invalid cell contracts fail before provisioning.
- Matrix identity and no-substitution tests pass.
- `make acceptance-infra-validate` remains PASS.

### NDR-W2: SSH Transport And Incremental Source Sync

Deliver:

- Strict host-key verified SSH command and local-forward lifecycle.
- Role-neutral source-sync extracted from `deploy.sh`.
- Testable source-sync core used by the stable shell entrypoint.
- Bare repository initialization, missing-object transfer, exact clean checkout,
  source lease, remote digest and bounded cache ownership.
- Station/Relay deployment migrates to the shared primitive in the same cut;
  duplicate push/fetch logic is deleted.
- Delete unused `tooling/docker/push-deploy.sh`, whose tar-over-SSH source path
  violates D-16 and has no repository callers.

Targets:

- `tooling/acceptance/transports/ssh.py`
- `tooling/acceptance/core/source_sync.py`
- `tooling/scripts/deploy/source-sync.sh`
- `tooling/scripts/deploy/deploy.sh`
- Delete `tooling/docker/push-deploy.sh`
- transport/source lease tests

Evidence:

- First sync transfers a clean commit.
- Second sync transfers only missing Git objects.
- Dirty/unreachable commit and host-key mismatch fail before build.
- Existing Station deploy static and runtime checks remain valid.

### NDR-W3: Launcher-Neutral Tauri Driver

Deliver:

- Separate WebDriver endpoint client from app process launcher.
- Local launcher preserves existing macOS behavior.
- Remote launcher consumes provisioned endpoint/tunnel/process metadata.
- Driver stop delegates resource ownership correctly without double cleanup.

Targets:

- `tooling/acceptance/drivers/tauri.py`
- `tooling/acceptance/core/drivers/`
- driver unit and smoke tests

Atomic cutover:

- Migrate every `TauriDriver` caller.
- Delete implicit local-launch assumptions from the W3C client.
- Do not retain a compatibility driver or second endpoint resolver.

### NDR-W4: Native Desktop Adapter Cutover

Deliver:

- `NativeDesktopAdapter` contract for activation, pointer/key input, focused
  control, window stack, point ownership, screenshot and stuck-button recovery.
- macOS implementation extracted unchanged in behavior from the Chat runner.
- Linux X11 and Windows Win32 conformance tests and injection slots.
- Adapter diagnostics use stable typed evidence fields.

Targets:

- `tooling/acceptance/drivers/native/`
- adapter contract/failure tests

Atomic cutover C1:

- All business runners consume the adapter.
- Remove AppKit, Quartz, CoreGraphics, `osascript`, X11 and Win32 implementations
  from business Gate files.
- Tree-wide search proves no platform API remains in Chat Gate code.

### NDR-W5: Linux Desktop Runtime Cell

Deliver:

- Digest-pinned supported Linux image with WebKitGTK 4.1, Rust, Node/pnpm,
  Python, Xorg dummy, Window Manager, DBus/keyring, XTest/EWMH and observer.
- Remote Desktop cell contract and provisioner.
- `make acceptance-cell-{ready,status,logs,stop}` entrypoints.
- Persistent Git/build caches with bounded retention.
- Remote process supervisor and TTL reaper.

Targets:

- `tooling/acceptance/images/desktop-linux/`
- `tooling/acceptance/runtime-cells/desktop-linux-native.yaml`
- `tooling/acceptance/provisioners/native_desktop_linux.py`
- `tooling/make/acceptance.mk`

Evidence:

- Host remains Ubuntu 20.04.
- Container image digest, userland, Xorg display, WebKitGTK version, source
  commit/digest and binary hash appear in the cell manifest.
- Native focus/input/window ownership/screenshot probe passes.
- VNC/SPICE observation reaches the same display.
- Stop and forced-disconnect paths leave no process, port, storage or lease.

### NDR-W6: Chat Business Adapter Migration

Deliver:

- `native_product_closure_runner.py` consumes `TauriDriver` and
  `NativeDesktopAdapter` only.
- Exact-range receiver proof `native_two_client_runner.py` consumes the same
  `NativeDesktopRuntimeBinding`; it must not retain a local-binary launcher
  path when selected for a remote runtime cell.
- The remaining Chat Native runners (`interactions`, contact-message
  resilience, typing, multi-device, recovery, and Group MLS) consume the same
  binding, immutable runtime manifest, actor manifest, source identity, and
  reverse cleanup contract.
- Gate Catalog, individual Make targets, W8, and W11 all carry the explicit
  runtime-cell selection; no standard entrypoint may silently fall back to a
  local launcher.
- Multi-device identity preparation is owned by the runtime binding. Remote
  cells clone only the declared actor-storage subtree inside the leased cell;
  the business Gate never accesses a remote filesystem path directly.
- Existing MP-W13 actors, product actions, selectors, assertions and
  first-failed-boundary behavior remain unchanged.
- Existing Composer exact-value precondition is preserved and independently
  committed before final remote source sync.

Evidence:

- Chat native static suite locks the adapter boundary.
- Tree scan confirms no platform API or transport lifecycle in Chat runner.
- Product Gate contract and timeout remain unchanged.

### NDR-W7: Linux MP-W13 Product Proof

Deliver:

- Provision Linux cell from the approved Profile and exact clean commit.
- Align Profile Three Station, remote source, binary and runtime identities.
- Execute `chat-native-product-closure-e2e` in the Linux cell.
- Stop at and report only the first failed product boundary.
- Repair product defects exposed by the unchanged Gate at their owning layer.
  In particular, active reaction mutation and recovery controls must suppress
  the generic message action overlay so retry remains directly actionable.
- Keep native file-chooser navigation platform-owned: macOS uses the Finder
  location shortcut, while Linux uses the GTK/Zenity location shortcut.
- Stabilize hover-sensitive native clicks by positioning the native pointer,
  rebinding selector-driven actions to the current semantic target at the
  fixed physical point, and only then sending one atomic down/up sequence with
  point-bound DOM acknowledgement.
- Place acceptance actor windows from their actual outer width so every slot
  remains within the selected monitor even when the product minimum width is
  wider than the nominal equal-width tile.
- Keep runtime-cell retention bounded by skipping recursive cache inspection
  when the cache unit itself is within the retention window.
- Preserve screenshots, DOM, native diagnostics, attachment byte/count ledger,
  restart evidence and cleanup audit.

Targets:

- `apps/desktop/src/components/chat/message/ChatMessageRow.tsx`
- `apps/desktop/src/components/chat/message/ChatMessageTimeline.tsx`
- `apps/desktop/src/components/chat/message/messageReactionState.ts`
- `apps/desktop/src/components/chat/message/messageReactionState.test.ts`
- `apps/desktop/src-tauri/src/main.rs`
- `tooling/acceptance/features/chat-product-closure.yaml`
- `tooling/acceptance/registry.yaml`
- `tooling/acceptance/drivers/native/base.py`
- `tooling/acceptance/drivers/native/macos.py`
- `tooling/acceptance/drivers/native/linux_x11.py`
- `tooling/acceptance/drivers/native/runtime.py`
- `tooling/acceptance/gates/chat/native_product_closure_runner.py`
- `tooling/acceptance/gates/chat/native_two_client_entry.py`
- `tooling/acceptance/gates/chat/native_two_client_runner.py`
- `tooling/acceptance/gates/chat/native_two_client_e2e.py`
- `tooling/acceptance/images/desktop-linux/remote_control.py`
- `tooling/acceptance/tests/test_native_desktop_linux.py`

Evidence:

- A passed Linux run proves only `desktop-linux-native`.
- A failed run records exact first boundary and remains `UNPROVEN`.
- Local macOS GUI is not activated or used during the Linux run.

### NDR-W8: macOS Cell Regression

Deliver:

- Explicit `desktop-macos-native` contract and local provisioner.
- Extracted adapter preserves AppKit/Spaces/CoreGraphics evidence.
- Existing macOS Gate commands route through the cell contract.

Evidence:

- macOS driver smoke and focused native tests pass.
- Existing activation diagnostics remain source-bound.
- No Linux/Windows result is used as macOS proof.

### NDR-W9: Windows Cell Implementation And Proof

Host: `sixwin` — `10.36.3.187`, Windows 10 Build 19045, x64, 16 GB RAM,
2× Xeon 8336C. SSH: `administrator@10.36.3.187`.

This workstream contains four dependency-ordered closures:

#### NDR-W9-A: Windows Host Bootstrap

Deliver:

- Install development toolchain on sixwin: Node.js LTS, pnpm, Rust stable,
  Visual Studio Build Tools (C++ workload for native compilation), WebView2
  Runtime.
- Clone the repository and verify `pnpm install` and `cargo check` succeed.
- Validate Tauri desktop build: `pnpm run tauri:build` produces a `.exe`.
- Verify SSH-based remote command execution from orchestrator (macOS) to sixwin
  works for process launch, file transfer, and cleanup.

Evidence:

- `node --version`, `pnpm --version`, `rustc --version`, `cargo --version`
  output captured.
- Successful `pnpm run tauri:build` log with `.exe` artifact path.
- Round-trip SSH command latency and file copy probe pass.

#### NDR-W9-B: Win32 Native Desktop Adapter

Deliver:

- `tooling/acceptance/drivers/native/windows.py` implementing
  `NativeDesktopAdapter` abstract contract from `base.py`.
- Win32 API integration via `pywin32` or `ctypes` for: window enumeration,
  focus/activate, screenshot (GDI), mouse click/move, keyboard input,
  clipboard read, process-owned window ownership query.
- `reveal_file_chooser_location` mapped to Win32 Shell execute or
  SendInput-based path entry in Explorer dialog.
- Static adapter tests runnable without a Windows host (mock-free structure
  tests and key/modifier mapping coverage).

Evidence:

- Static adapter tests pass on Linux/macOS CI.
- Win32 adapter smoke test passes on sixwin.

#### NDR-W9-C: Windows Runtime Cell Contract And Provisioner

Deliver:

- `desktop-windows-native` runtime-cell contract in
  `tooling/acceptance/runtime-cells/`; the shared
  `native-tauri-embedded-webdriver` environment remains platform-neutral.
- `WindowsNativeDesktopRuntimeBinding` in `runtime.py` implementing
  `NativeDesktopRuntimeBinding` with:
  - Remote source sync via SSH + git on sixwin.
  - Remote process launch/supervision via SSH (`tauri dev` or built `.exe`).
  - WebView2 embedded WebDriver endpoint tunneled back to orchestrator.
  - Actor-scoped storage, log, and profile isolation (Windows user dirs).
  - Cleanup: process termination, storage wipe, tunnel release.
- Process supervision equivalent to Linux: health probe, crash detection,
  structured log capture.

Evidence:

- Contract loads and validates via `load_environment_contract`.
- Provisioner can launch/stop a Tauri process on sixwin via SSH.
- WebDriver endpoint is reachable from orchestrator through SSH tunnel.

#### NDR-W9-D: Windows Product Gate And Proof

Deliver:

- Run the same 22-Gate Chat product suite through the Windows cell.
- Alice and Bob on sixwin bind to distinct Stations via the same multi-Station
  manifest contract used by the Linux cell (W10 infrastructure).
- Product assertions use platform-neutral DOM/WebDriver paths; only the
  adapter and runtime binding are Windows-specific.
- Capture immutable evidence: screenshots, DOM snapshots, native window
  diagnostics, attachment counts, cleanup audit.
- Collect W10-D Windows multi-Station binding evidence: manifest, Station
  attestations, binding-proof tuple closure, live identity verification.

Evidence:

- Source-matched Windows run with all 22 Gates reaching `DONE/PROVEN`.
- Win32 adapter native diagnostics (window stack, focus, screenshot) captured.
- Multi-Station binding proof (distinct Station identities per client).
- Cleanup audit shows all remote processes terminated and storage wiped.
- Gap Detector reports zero gaps for the Windows cell run.

Parallel execution note:

- NDR-W9-A and NDR-W9-B have no dependency on each other and may execute
  concurrently.
- NDR-W9-C depends on both NDR-W9-A (host ready) and NDR-W9-B (adapter ready).
- NDR-W9-D depends on NDR-W9-C.
- NDR-W9 and NDR-W10-D (Linux multi-Station evidence) may execute in parallel.

### NDR-W10: D-18 Multi-Station Binding Infrastructure

Purpose:

- Implement the accepted D-18 client-to-service binding contract as
  platform-neutral infrastructure consumed by all runtime cells
  (Linux, Windows, macOS).
- Enable distinct Native Desktop clients in any runtime cell to bind to
  distinct Station service IDs without Gate-owned URLs or default Station
  inference.
- Provide the topology prerequisite for cross-Station product claims on every
  platform: MLS group receipts, multi-device delivery aggregation, PostgreSQL
  multi-node recovery, and injected-network replay.

This workstream contains four dependency-ordered closures:

#### NDR-W10-A: Core Binding Contract

Deliver:

- Add mandatory Environment client declarations with stable `id`,
  `required_service_roles`, and `service_bindings`.
- Project the same binding into `ClientRuntime` without changing D-13
  allocation ownership.
- Add one generic resolver and typed validation for duplicate ID, missing/extra
  role, dangling service, kind mismatch, and topology copies.
- Add focused positive and fail-closed tests.

Targets:

- `tooling/acceptance/core/provisioning.py`
- `tooling/acceptance/core/__init__.py`
- `tooling/acceptance/tests/test_provisioning_model.py`
- affected Home Station Provisioner tests

#### NDR-W10-B: Native Bound-Session Proof

Deliver:

- Replace Native `create_session(role, spec, environment)` with
  `create_bound_session(client_id, typed_options)`.
- Runtime Binding owns endpoint resolution, monotonic launch generation, live
  Station identity readback, D-13 runtime-instance identity, and proof refs.
- Core derives expected identity from ServiceAttestation and requires one
  verified proof for every
  `(clientId, launchGeneration, requiredRole)` tuple.
- Define a closed Native launch-options allowlist; arbitrary environment maps
  and topology-bearing fields fail closed.
- Core harness includes the Runtime Binding proof collection in Gate evidence.

Targets:

- `tooling/acceptance/drivers/native/runtime.py`
- `tooling/acceptance/drivers/native/__init__.py`
- `tooling/acceptance/core/{provisioning.py,harness.py}`
- `tooling/scripts/acceptance-run.py`
- Native Runtime Binding and runner tests

#### NDR-W10-C: Native Chat Atomic Cutover

Deliver:

- Add multi-Station services and explicit bindings to the Native Chat
  Environment Contract/Provisioner.
- Migrate all Native Chat runners to bound sessions.
- Delete normal-launch `PEERS_STATION_URL`, `CHAT_NATIVE_STATION_URL`,
  `DEFAULT_STATION`, per-runner Station selection, and service-order fallback.
- Preserve existing fault replay through a Runtime Binding-owned opaque
  `TransportOverrideHandle`; Gate code cannot extract or forward its routable
  URL.
- Keep product assertions, actors, selectors, retry semantics, and cleanup
  unchanged.

Consumer inventory:

- `native_product_closure_runner.py`
- `native_interactions_runner.py`
- `native_two_client_runner.py`
- `native_multi_device_runner.py`
- `native_recovery_runner.py`
- `native_group_mls_runner.py`
- `native_typing_runner.py`
- `contact_message_resilience_runner.py`
- `native_support.py` and matching entry/test files

Deletion evidence:

```bash
rg -n 'runtime_binding\.create_session\(|PEERS_STATION_URL|CHAT_NATIVE_STATION_URL|DEFAULT_STATION|reaction_endpoint_url|RuntimeEndpoint.*\.url' \
  tooling/acceptance/gates/chat tooling/acceptance/drivers/native
```

Any remaining match must be reviewed as a non-client control-plane operation;
no match may select normal client topology or expose a fault-proxy route.

#### NDR-W10-D: Multi-Station Product Evidence (per-platform)

The multi-Station binding infrastructure is platform-neutral. Each runtime
cell consumes it independently. Evidence is collected per-platform:

**Linux evidence** (immediate — infrastructure ready):

- Alice and Bob run in one isolated Linux cell while binding to distinct
  source-attested Stations (station-four + station-five).
- Restarted clients receive a new launch generation and fresh per-role proof.
- Existing fault-replay paths use opaque transport override handles.

**Windows evidence** (after W9-C):

- Alice and Bob run on sixwin via the Windows runtime cell and Win32 adapter,
  each binding to a distinct Station through the same manifest contract.
- Same binding-proof tuple closure and live identity verification as Linux.

**macOS evidence** (after W8):

- Alice and Bob run locally via the macOS cell, each binding to a distinct
  Station through the same manifest contract.

Per-platform product evidence covers:

- MLS group receipts;
- multi-device delivered aggregation;
- PostgreSQL multi-node persistence/recovery;
- injected-network backoff and missed-event replay.

Preserve reverse cleanup for processes, ports, storage, sessions, tunnels,
and transport handles on every platform.

Required evidence (per platform):

- One immutable multi-service Runtime Manifest.
- Distinct Station attestations and live identities.
- Complete binding-proof tuple closure.
- Product Gate reports for all four claims.
- Cleanup result and exact-source aggregate/Gap Detector outputs.

Explicit non-scope:

- Mobile D-18 migration.
- Federation D-18 migration.
- Station restart without separate Owner authorization.

## 8. Atomic Cutover And Deletion Matrix

| Concern | New owner | Cutover condition | Delete |
|---|---|---|---|
| Profile-based remote Git source acquisition | `core/source_sync.py` + `source-sync.sh` | Station deploy and Native cell tests pass | duplicated push/fetch functions in `deploy.sh`; unused tar-based `push-deploy.sh` |
| WebDriver endpoint lifecycle | launcher + `TauriDriver` client | all callers migrated | implicit process ownership in W3C client |
| Native input/window mechanics | `drivers/native/*` | macOS regression and Linux probes pass | platform APIs from Chat runners |
| Native platform result identity | runtime cell matrix | validator and report consumers migrated | platform-implicit Native proof |
| Linux userland | digest-pinned image | build/smoke and cleanup pass | host package-mixing path |
| Native client service selection | D-18 Environment Contract + Runtime Manifest binding | W10-C consumers and W10-D evidence pass | Gate URL/default/private client-service maps |
| Native launch proof | Runtime Binding + Core verifier | exact per-generation/per-role closure passes | Gate-authored or configuration-echo identity |
| Fault transport routing | opaque Runtime Binding handle | existing replay assertions and cleanup pass | Gate-visible proxy route and direct `configure_station(proxy_url)` |

No compatibility alias, dual resolver, fallback to browser shell, or duplicate
business Gate is permitted.

## 9. Acceptance Scenarios

### AS-NDR-01: Incremental exact-source deployment

- **Precondition**: Remote bare repository and source lease exist.
- **Action**: Developer runs Linux cell ready twice for two clean commits.
- **Expected**: Remote checkout equals requested commit; second run transfers
  only missing Git objects and reuses bounded build caches.
- **Failure variant**: Dirty or unreachable source stops before build.
- **Evidence**: source-sync log, local/remote commit, source digest, cache identity.
- **Status**: pending

### AS-NDR-02: Secure remote WebDriver

- **Precondition**: Linux app runs with embedded WebDriver.
- **Action**: Orchestrator opens a run-scoped SSH forward and connects.
- **Expected**: DOM and screenshot are available through local loopback; the
  remote port is not reachable through the host network interface.
- **Failure variant**: Host-key mismatch or tunnel loss blocks the Gate and
  triggers cleanup.
- **Evidence**: socket binding, tunnel metadata, blocked artifact, cleanup audit.
- **Status**: pending

### AS-NDR-03: Real Linux Native interaction

- **Precondition**: Two Tauri windows run in the isolated Xorg cell.
- **Action**: Gate activates each window and performs pointer and keyboard input.
- **Expected**: Document focus, active window, point ownership and visible
  screenshot identify the same actor process after each action.
- **Failure variant**: Missing XTest/EWMH capability stops before product assertion.
- **Evidence**: native activation diagnostics and desktop screenshots.
- **Status**: pending

### AS-NDR-04: Remote interruption cleanup

- **Precondition**: Cell lease, app processes, tunnels, ports and storage exist.
- **Action**: Gate is cancelled or the SSH control connection is terminated.
- **Expected**: Remote TTL reaper releases all run-owned resources.
- **Failure variant**: Any residue produces `ACCEPTANCE_CLEANUP_FAILED`.
- **Evidence**: process, port, storage, container and lease audit.
- **Status**: pending

### AS-NDR-05: Linux MP-W13 journey

- **Precondition**: Profile Three and Linux cell source/build/runtime identities match.
- **Action**: Alice and Bob execute the existing MP-W13 Native Chat journey.
- **Expected**: Existing transcript, interaction, identity, settings, attachment,
  restart and cleanup assertions pass unchanged.
- **Failure variant**: Stop at the first product boundary; do not weaken or skip it.
- **Evidence**: `chat-native-product-closure-e2e` immutable Linux cell run.
- **Status**: pending

### AS-NDR-06: Platform evidence isolation

- **Precondition**: At least one required platform cell has no current evidence.
- **Action**: Generate the cross-platform capability report.
- **Expected**: Passed cells are listed independently; aggregate remains
  `PARTIAL/UNPROVEN`.
- **Failure variant**: Reusing another platform's evidence fails validation.
- **Evidence**: matrix validator and report tests.
- **Status**: pending

### AS-NDR-07: macOS behavior preservation

- **Precondition**: Adapter cutover completed.
- **Action**: Run existing macOS native smoke and activation scenarios.
- **Expected**: WKWebView/AppKit/Spaces/CoreGraphics behavior and diagnostics are
  unchanged.
- **Failure variant**: Any regression blocks C1 completion.
- **Evidence**: macOS static and Native run artifacts.
- **Status**: pending

### AS-NDR-08: Windows runtime cell

- **Precondition**: sixwin (10.36.3.187) bootstrapped with toolchain; Win32
  adapter and `desktop-windows-native` contract landed.
- **Action**: Run the same Gate through WebView2 and the Win32 adapter on sixwin.
- **Expected**: Native input, focus, window ownership, screenshot and product
  assertions pass.
- **Failure variant**: Toolchain or adapter failure blocks at W9-A/W9-B; runtime
  cell failure blocks at W9-C. Status remains `UNPROVEN` at the failed stage.
- **Evidence**: immutable Windows cell run, Win32 native diagnostics, and
  cleanup audit.
- **Status**: pending — host available, bootstrap not started

### AS-NDR-09: Linux multi-Station binding

- **Precondition**: Two source-attested Stations and two isolated clients exist.
- **Action**: Alice and Bob launch in one Linux cell with distinct typed
  Station bindings.
- **Expected**: Each session returns only after live identity matches its
  declared Station; restart produces a fresh generation and proof.
- **Failure variant**: Missing, mismatched, copied, or config-echo identity
  blocks the session before product assertions.
- **Evidence**: multi-service Runtime Manifest, Station attestations, complete
  binding-proof tuple closure, cleanup report.
- **Status**: pending

### AS-NDR-10: Cross-Station MLS group receipts

- **Precondition**: Group members are bound to distinct Stations.
- **Action**: Sender and receivers exchange a Group MLS message and receipts.
- **Expected**: Sender observes receiver-visible receipt state from all required
  members without collapsing Station or device identity.
- **Failure variant**: Missing receiver proof keeps the claim `UNPROVEN`.
- **Evidence**: Group MLS Gate evidence, Station readback, binding proofs.
- **Status**: pending

### AS-NDR-11: Multi-device delivery and PostgreSQL recovery

- **Precondition**: One actor has multiple isolated devices and Station state is
  persisted in PostgreSQL.
- **Action**: Deliver messages, restart the owning runtime without Station
  restart, and recover projections.
- **Expected**: Delivery aggregates by required devices and durable state
  converges after recovery.
- **Failure variant**: Single-device substitution or in-memory-only recovery
  fails the claim.
- **Evidence**: multi-device and recovery Gate reports, PostgreSQL-backed
  readback, fresh binding proofs.
- **Status**: pending

### AS-NDR-12: Injected-network replay

- **Precondition**: A verified Station binding and Domain-owned fault proxy
  exist.
- **Action**: Apply an opaque transport override, inject connection loss, and
  allow the client to retry/replay.
- **Expected**: Canonical service identity remains unchanged; bounded backoff,
  exact replay, missed-event convergence, and cleanup pass.
- **Failure variant**: Routable proxy URL exposure, cross-run handle reuse, or
  duplicate command effect blocks the claim.
- **Evidence**: transport-handle validation, proxy transcript, product Gate
  evidence, cleanup report.
- **Status**: pending

## 10. Verification Commands

Framework:

```bash
python3 tooling/scripts/acceptance-infra-boundary-test.py
python3 tooling/scripts/quality-evidence-test.py
python3 tooling/scripts/acceptance-validate-test.py
make acceptance-infra-validate
python3 tooling/scripts/acceptance-plan.py --self-check
```

Desktop and Chat:

```bash
python3 -m unittest tooling.acceptance.gates.chat.native_product_closure_static_test
cd apps/desktop && pnpm run check && pnpm run test && pnpm run build
```

Linux cell:

```bash
make acceptance-cell-ready \
  CELL=desktop-linux-native \
  CELL_GATE=chat-native-product-closure-e2e
make acceptance-cell-status CELL=desktop-linux-native
CHAT_ACCEPTANCE_RESET=1 \
CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 \
make acceptance-chat-native-product-closure \
  RUNTIME_CELL=desktop-linux-native
make acceptance-cell-stop CELL=desktop-linux-native
```

Final cleanup:

```bash
make acceptance-cell-status CELL=desktop-linux-native
ssh <profile-resolved-target> \
  'docker ps --filter label=peers-touch.acceptance-cell --format "{{.ID}}"'
lsof -nP -iTCP:<allocated-local-forward> -sTCP:LISTEN
```

Literal targets and allocated ports come from the runtime manifest; they are not
committed to this plan.

## 11. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Container GUI is mistaken for headless DOM proof | Require Xorg/WM, XTest/EWMH, focus, point ownership and desktop screenshot evidence |
| SSH disconnect leaks resources | Remote TTL lease/reaper independent of controlling connection |
| Source sync disrupts Station deployment | Extract role-neutral primitive; migrate Station caller atomically with regression tests |
| Build cache contaminates source identity | Cache excluded from source digest; exact checkout and binary hash required |
| WebDriver exposed on LAN | Loopback bind plus run-scoped SSH local forward only |
| Platform-specific code returns to Chat runner | Static dependency scan and C1 deletion gate |
| Linux proof is used as universal Desktop proof | Gate × cell validator and aggregate fail-closed result |
| Windows host unavailable | Keep Windows cell runtime proof explicitly `UNPROVEN`; no readiness claim |

## 12. Implementation Status

| Workstream | Status | Evidence |
|---|---|---|
| NDR-W1 Runtime Cell Core | done | Contract, manifest, matrix identity, lifecycle ledger, and fail-closed evidence finalization are exercised by the exact-source 22-Gate aggregate at `ef89b11fed8afd2ecdc037f856ed0f28ee96f8be`. |
| NDR-W2 SSH + source sync | done | source-sync 16/16 PASS; source-sync/lease/runtime-cell suite 60/60 PASS; Acceptance Core tests 159/159 PASS; strict host-key negative PASS; isolated direct sync transferred one new object on the second commit; isolated central/local sync PASS with cleanup; `make station` held the remote source lease through build/restart/health and passed at exact HEAD `33063a7e15be`; remote checkout/residue clean and leases released |
| NDR-W3 Tauri driver separation | done | pure loopback-only `TauriDriver`; `LocalTauriLauncher` and `ProvisionedTauriLauncher`; composed `TauriSession`; all business callers migrated; Core tests 167/167 PASS; MP-W13 static 34/34 PASS; local Native driver smoke PASS; process/ports/storage/log cleanup PASS; infra validation, plan self-check, coverage report, and skill-check PASS |
| NDR-W4 Native adapter cutover | done | platform-neutral `NativeDesktopAdapter` with typed control/window diagnostics; macOS AppKit/CoreGraphics/Accessibility/clipboard/screenshot implementation extracted; Linux/Windows injection slots fail closed; adapter + MP-W13 static 50/50 PASS; Core tests 183/183 PASS; Chat and Infra structural validation PASS; Desktop check and Station messaging packages PASS; tree-wide Chat platform-API scan PASS |
| NDR-W5 Linux cell | done | Actor-scoped Alice/Bob/Alice2 launch, WebDriver/Gateway tunnels, profiles, storage and reverse cleanup are implemented; source-bound Linux run `20260824T152615956669Z-5052adc5b3ba152e` reached `LEASED` at commit `d9509fd7348e4eadb82cfc80c511e44ada712474`; Xorg/input/focus/point/screenshot probes and final cleanup passed |
| NDR-W6 Chat migration | done | Product and receiver runners consume `NativeDesktopRuntimeBinding`; all required Native runners use `NativeClientLifecycleLedger`; PR #103 exact-source 22-Gate evidence validates the integrated migration. |
| NDR-W7 Linux MP-W13 proof | done — Linux only | Aggregate `20260901T095008761974Z-3b99fa79d3d1d9d637010b6253d070e0` passed 22/22 `DONE/PROVEN` at `ef89b11`; W11 `20260901T110101534000Z-2095f54d374d51f23bcfd6feeb343aeb`, 9/9 Chat required-proven validation, Gap Detector zero gaps, and runtime-cell cleanup `CLEANED` passed. PR #103 retains this evidence. |
| NDR-W8 macOS regression | pending | prior evidence predates cutover |
| NDR-W9 Windows cell | W9-A/B/C done; W9-D proves cross-Station Direct open; later product closure remains partial | Exact-source run `20260904T074120233666Z-fdb77bd29b2e510be6a9964332a9e4d5` at `6517324cdb5aa46cf6fcca8eac2e6ed1858c6721` and binary SHA-256 `c0d00168bbbb7161789cd8ac8810dbea9447b73f8abc6a0240bac27beef8c17e` proved Windows 10 x64, WebView2 `152.0.4191.62`, interactive `1920x1080`, Win32 `SendInput`, exact Station/source binding, first Direct creation, and repeat selection of the same conversation. The Gate then failed in `transcript.thread.ui`; the pane-owned overlay is now semantically restored and locally verified. Runtime-log cleanliness still requires proposed MP-D29 follower membership. W9-D remains `PARTIAL/UNPROVEN`. |
| NDR-W10 D-18 multi-Station binding infrastructure | W10-A/B/C done; W10-D proves Windows binding and the first cross-Station Direct product path; MP-D29 is ready for review | Run `20260904T074120233666Z-fdb77bd29b2e510be6a9964332a9e4d5` proved Alice generation 1 bound to station-four and Bob generation 1 bound to station-five with distinct source-attested Station identities at `6517324cdb5aa46cf6fcca8eac2e6ed1858c6721`. The actor-directory/TOFU/live-Relay correction created Direct conversation `d-f4d4aaa25c831bb05fdd53cd1cdd6120` and reopened it by exact search. The overlay regression is locally repaired. MP-D29 now proposes an authority-signed, Station-addressed follower projection independent of device delivery; implementation is blocked on architecture acceptance. Linux multi-Station and macOS-after-W8 evidence also remain open. |

### 2026-08-24 Execution Reconciliation

Static and source audits before NDR-W6 found two implementation gaps that the
earlier status table did not represent:

- NDR-W1 implemented the runtime-cell contracts and matrix aggregation, but the
  Gate Catalog and `acceptance-run.py` do not yet expand or select
  `requiredRuntimeCells`.
- NDR-W5 proved one source-bound Linux Desktop process, while MP-W13 requires
  three isolated clients in the same leased Xorg cell. The cell must provide
  actor-scoped process, endpoint, profile, storage and cleanup ownership before
  NDR-W7 can execute.

These are implementation inventory corrections under accepted D-13 through
D-16. They do not change product assertions or architecture ownership. Execute
them in dependency order before the Chat runner cutover:

1. Complete Gate × cell selection and fail-closed result identity.
2. Extend the Linux cell with actor-scoped client launch and reverse cleanup.
3. Inject the resulting Tauri session factory and Native adapter into the Chat
   runner, deleting its local launcher and platform factory dependencies.

### 2026-08-24 NDR-W7 First-Boundary Result

The first source-matched Linux product run passed runtime provisioning and
launched Alice, but stopped before any product assertion. The Chat-owned
reaction failure Fixture listened on the orchestrator loopback while the Linux
actor received that URL as cell loopback. The runtime therefore could not reach
the Fixture.

The remediation keeps ownership explicit:

- Chat requests exposure of the exact orchestrator endpoint; it does not choose
  SSH or rewrite transport addresses.
- The Linux runtime binding owns a run-scoped SSH reverse-forward lease and
  returns the cell-reachable endpoint.
- The Linux provisioner verifies remote end-to-end TCP readiness, records
  tunnel identity, and releases endpoint leases after actor sessions and before
  the local Fixture stops.
- No implicit `PEERS_STATION_URL` inspection or fallback is allowed.

Evidence before the exact-source rerun:

- Acceptance Core: 230/230 PASS.
- Chat Native product static suite: 38/38 PASS.
- Acceptance runner tests: 20/20 PASS.
- Real SSH reverse-forward read and release probe: PASS.

The next unchanged Gate run reached both Alice and Bob Native clients, proving
the endpoint route, then stopped at `group.create.ui` before its product
assertion. The formal adapter command did not inherit the run-owned
`DBUS_SESSION_BUS_ADDRESS`, even though the successful cell preflight probe
explicitly loaded the same address. The remediation reuses `dbus.state` for
every adapter operation and fails closed when that state is absent.

After that remediation, the next run reached the same first UI action with a
working AT-SPI snapshot, then attempted the macOS-only
`acceptance_yield_activation` Tauri command on Linux. Cooperative activation is
therefore dispatched through `NativeDesktopRuntimeBinding`: macOS preserves the
existing command sequence, while Linux uses its X11 adapter activation path.
The Chat runner remains platform-neutral. The following exact-source cell
preflight also exposed a transient actor-directory cleanup race after process
termination; cleanup now retries bounded `EBUSY`/`ENOTEMPTY` failures and still
fails closed when the directory remains.

Exact-source run
`20260824T210747163196Z-405dfb06c0469c5edd11879266059514`
proved that the reaction recovery overlay repair advanced the Gate to
`transcript_thread`, where a transient native click was not acknowledged.
Diagnostic rerun
`20260824T211742109650Z-6e9c3a6eb67c5eff955ed9ce6d22c8cc`
proved the Reply path and all product assertions through Station attribution,
then reached the native Settings image chooser. The chooser was detected, but
the Gate timed out waiting for a location text field after sending the
macOS-only `Primary+Shift+G` shortcut. The adapter contract now owns the semantic
`reveal_file_chooser_location` operation: macOS preserves
`Primary+Shift+G`, while Linux and Remote Linux use GTK/Zenity `Primary+L`.
The Chat Gate remains platform-neutral and its chooser assertions are unchanged.

Exact-source run
`20260826T192954307015Z-43a00b13dbb20de1595f79c1162acfc5`
at `ad815464d` proved the final three-slot placement on real Xorg and advanced
through transcript, thread, toolbar, reaction, identity, settings, background,
attachments, offline recovery, restart, clear-cursor restore, recovery backup,
Alice2 launch, and native opening of Alice2 Details. It then timed out waiting
for the compound Alice2 settings projection. Station and the original Alice
had already proved `muted=true`, `pinned=true`, `background=paper`, the uploaded
background reference, and `clearedAt=0`; the failed wait did not preserve which
Alice2 field diverged. The next exact-source run therefore adds evidence-only
DOM-versus-Station snapshots without changing the existing predicate, actors,
selectors, ordering, or timeout.

### 2026-08-27 NDR-W7 Final Linux Proof

The owning Desktop projection repair preserves the current same-actor Station
projection during profile refresh and hydrates actor-scoped persisted state
before authoritative session reconciliation. Unchanged source-bound run
`20260826T212504506606Z-466161eb5815892a433ae5948cbb7fd0`
passed all 25 assertions on `desktop-linux-native`.

The proof binds:

- source and Station commit
  `e5b3fd74943cdba46e16c72c415a2031051448b7`;
- runtime cell run
  `20260826T212010860319Z-94cab5dfe099f313`;
- Linux binary SHA-256
  `fd1d4877c5d2279b4ee5515e3ea687f7074ddbcbc72216b4452022dfb3c09d6b`;
- Alice2 DOM and Station settings with matching mute, pin, background,
  background image, and clear cursor;
- successful actor, endpoint, port, process, log, and storage cleanup.

The required independent final stop returned `CLEANED`. Remote inspection found
no acceptance cell container or retained run checkout, and every allocated
local forward was released. This historical run closed NDR-W7 for its recorded
Linux source only; later identity and evidence changes reopened current-source
proof. NDR-W8 macOS and NDR-W9 Windows remain separate platform proofs.

The later MP-W13-F rerun at source commit `708266d4bb61` exposed a runtime
isolation defect when a persistent Desktop on the Linux host already owned the
business runner's logical WebDriver port. The failed actor connected to that
unrelated process and cleanup then treated the persistent listener as leaked
cell state. Runtime-cell actor WebDriver and gateway ports must therefore be
allocated from the cell profile range, while local forwards preserve the
business runner's logical ports. Remote actor launch must fail before process
creation when an allocated port is already owned and must verify actor-process
liveness before accepting port readiness. This is an NDR-W5 lifecycle
correction under D-14; it does not change MP-W13 actors, product assertions, or
timeout budgets. Client logical ports must derive from the already resolved
worktree profile slot; reading the parent process environment again can silently
fall back to slot zero and collide with unrelated local tunnels.

### 2026-08-28 Final Review Corrections

Independent review of the MP-W13-F Linux candidate found two Acceptance
infrastructure defects that must close before final evidence:

- destructive Fixture SSH calls bypassed the shared strict-host-verification
  transport;
- blocked or provisioning-failure results for a selected runtime cell omitted
  `runtimeCell`, causing latest-pointer publication to fail instead of
  preserving `BLOCKED/UNPROVEN`.

The correction reuses `SshTransport` for all destructive remote commands and
standardizes `runtimeCell` before every result is finalized. Synthetic
failure-path and transport tests cover both contracts. The earlier NDR-W7 Linux
proof remains historical source-scoped evidence; current-source NDR-W7 and
MP-W13-F require a new exact-source run after these corrections.

The subsequent product-side re-review found that an old actor's in-flight
Social refresh could still publish after an account switch. That defect is
owned by the Desktop projection layer, not Acceptance Infra. The Desktop
correction adds actor fences at runtime stage boundaries and before every
Social/notification store operation used by the refresh or notification
mutation flows publishes asynchronous results. Actor transitions also clear
the actor-scoped Social, notification, and navigation-badge stores before the
new session is hydrated, and the final refresh stage checks actor identity
before reconciling badges. Acceptance Infra scope is unchanged; the prior
NDR-W7 result remains historical rather than current-source proof.

The exact-source MP-W13-F run
`20260828T065037835411Z-693543461e6173b5dc81246bdf3d2d13` then exposed a
Chat business-Fixture entrypoint mismatch: the reset module was invoked by file
path even though it imports the shared Acceptance package. The Chat runner now
uses `python -m tooling.acceptance.fixtures.chat_native_reset`; this is a
business injection correction and does not alter runtime-cell lifecycle.

Independent review of the exact-range receiver migration then found four
mechanical NDR-W6 gaps. The Gate still wrote reports under the repository,
validated evidence by path existence, omitted the full cell manifest from its
source identity, lost structured cleanup on failed journeys, and the W8
aggregate target did not pass the selected runtime cell. The correction uses
the canonical Evidence Store and same-run `ArtifactRef` validation, exposes the
immutable runtime-cell manifest through `NativeDesktopRuntimeBinding`, records
the environment/Station/cell/binary identity chain, updates steps and cleanup
from `finally`, and passes `RUNTIME_CELL` through both Make entrypoints. These
changes preserve the Chat assertions and only complete the accepted D-11,
D-13, D-14, and D-16 evidence contracts. The exact-range run also removed the
obsolete repo-local output from `make acceptance-plan`; its default path now
publishes and reloads the immutable latest plan through the Evidence Store.
The first live receiver run also aligned actor startup with the existing
canonical identity contract by hydrating the active actor after authentication;
cleanup now owns every started session and only logs out sessions that reached
authenticated state.
The following receiver run removed the last legacy conversation sync from the
Chat harness: both actors now project the same deterministic Direct through the
current messaging command before receiver-visible delivery begins.
Run `20260828T091038659436Z-471b23e7332f1b14a61711e635c9b47c` on
`e601b35abf92` then passed every receiver assertion and reverse cleanup step,
but the post-run validator correctly kept the aggregate result
`PARTIAL/UNPROVEN`. It incorrectly required the Provisioner runtime-manifest
run ID to equal the independent Evidence Store run ID, and the remote app logs
were exported only during actor stop after the runner's evidence collection
point. The correction validates the embedded manifest against the digest-bound
same-run environment-manifest `ArtifactRef` and persists each actor log after
remote stop but before runtime binding cleanup deletes temporary logs.
Exact-source run
`20260828T092318799925Z-63e2e7ecda28238b1087044d363a730a` on
`957eeda37608` then produced a passing product report, passing validation,
both app-log artifacts, and complete cleanup. The generic Acceptance runner
still downgraded its aggregate because artifact enumeration selected the
validation artifact before the canonical Gate report. The Infra correction
now selects the matching `acceptance-gate-evidence-report` as primary evidence
and independently sources Phase/BOM/Spec/Gate traceability from a validation
artifact. The run remains `PARTIAL/UNPROVEN`; a new exact-source aggregate run
is required.

### 2026-08-28 NDR-W7 Closure Hardening

The source-bound Linux Product run
`20260828T142622748616Z-bbff7c7eb9e2c2de7bc43b0ef990e94e`
and receiver run
`20260828T150121373022Z-051e7bcc11587cb9ccd6d1fc36dc6217`
both reached `DONE/PROVEN` on candidate `f72f7d95091d`. The Product run bound
the clean source, disposable Station `18132`, Linux binary, native UI journey,
and actor cleanup. The receiver run independently proved bidirectional visible
delivery.

The final independent review identified five runtime/evidence hardening gaps:

- destructive Chat reset must require port `18132` and reject protected ports
  `18080` and `4445`;
- Station attestation must use the shared strict known-host SSH transport;
- a supplied Gap Detector plan must not omit Gates selected by the canonical
  exact-range planner;
- outer Provisioner cleanup must be an immutable, traceable artifact;
- Product proof must validate the complete runtime-cell identity, including
  cell run, host key, host identity, image, clean remote checkout, source
  digest, and binary digest equality.

These corrections preserve the NDR ownership boundary and do not alter the Chat
journey, selectors, ordering, or timeouts. The final candidate must regenerate
Product, receiver, exact-range, Gap Detector, cleanup, and review evidence after
this plan update. NDR-W8 macOS and NDR-W9 Windows remain explicitly separate
and unproven by the Linux result.

### 2026-08-28 NDR-W6 Exact-Range Expansion

The canonical MP-W13-F range selects six additional Chat Native Gates that
still used the local `home-station` launcher path. NDR-W6 is mechanically
expanded to migrate those existing journeys without changing their actors,
selectors, assertions, ordering, or timeout budgets:

- `chat-native-interactions-e2e`
- `chat-contact-message-resilience-e2e`
- `chat-native-typing-e2e`
- `chat-native-multi-device-e2e`
- `chat-native-recovery-e2e`
- `chat-native-group-mls-e2e`

All six now publish their canonical report in the current external Evidence
Store run and use a shared Chat runtime identity validator. Their Gate Catalog
entries and Make targets require an explicit runtime cell. Multi-device
identity cloning is implemented by the runtime storage owner, and Station
readback uses the strict shared SSH transport. The unrelated
`chat-desktop-gateway-e2e` provisioning blocker is repaired at the concrete
Provisioner boundary: diagnostics retain the run-relative artifact identity,
and only actual port parsing failures are classified as
`profile:desktop-port`.

This expansion remains `UNPROVEN` until all seven environment Gates run on one
clean candidate and the canonical exact-range Gap Detector, Completion Audit,
and independent review pass.

Pre-commit rereview found and closed four lifecycle defects without changing
the product journeys: cleanup now preserves the first product failure while
recording later cleanup errors; Linux and local actor-storage clones publish
only through atomic rename and remove temporary state on failure; migrated
Gate reports cannot override the current Evidence Store run; and explicit
`acceptance-run --gate` selection resolves the current Gate Catalog instead of
stale plan commands. Failure-injection and resolved-command tests cover these
contracts. Runtime proof remains `UNPROVEN` until regenerated from the clean
candidate.

### 2026-08-29 NDR-W1 Aggregate Lifecycle Correction

The canonical exact-range aggregate exposed that `--runtime-cell` previously
validated and labeled a selected cell but did not acquire its Gate-bound
lifecycle. Environment provisioning therefore ran, but each Native Gate
constructed its runtime binding before the Linux cell had reached `LEASED`.
Those constructor failures correctly produced no product report; the runner
then incorrectly promoted the passing Provisioner cleanup report to primary
Gate evidence.

The generic Acceptance Infra correction:

- resolves runtime-cell lifecycles through one registry shared by
  `acceptance-cell.py` and `acceptance-run.py`;
- executes environment provisioning, cell `ready(gateId)`, the unchanged
  business Gate, cell `stop()`, and environment cleanup in that order;
- persists the immutable cell manifest in the current Gate run;
- preserves `BLOCKED/UNPROVEN`, timeout, product failure, and cleanup failure
  semantics without allowing cleanup evidence to replace a missing canonical
  Gate report;
- keeps unsupported cell implementations fail closed; and
- verifies the lifecycle, current-run manifest ownership, reverse cleanup, and
  canonical-report selection with synthetic Infra tests.

This corrects the accepted D-13/D-14 implementation inventory. It does not
change Chat actors, journeys, selectors, assertions, ordering, or timeout
budgets. NDR-W1 and MP-W13-F remain `UNPROVEN` until a clean exact-source Linux
aggregate passes and the downstream validator, Gap Detector, Completion Audit,
and independent review consume that aggregate.

The first post-correction aggregate
`20260828T214352092653Z-cab4c1bf2f925400c710755190f4ed30`
then failed before cell acquisition because `proto-build` created two untracked
Agent-domain generated files. The environment attestation scanned those
worktree-only derivatives into `protoDigest`, so the same Git commit produced a
different digest locally and on the deployed Station. Source attestation now
hashes only Git-tracked proto sources and generated bindings, while repository
ignore rules classify new generated bindings as derived outputs. Tracked
generated changes remain visible to the workspace dirty check. This preserves
exact-commit identity without allowing a code-generation Gate to invalidate
later source-bound Gates in the same aggregate.

The clean aggregate
`20260828T215129732499Z-90c1e42259dc905e86b4f1798cab1750`
then exercised all selected Gates and proved the corrected per-Gate cell
lifecycle. Six of seven environment Gates passed; every cell and Provisioner
cleanup passed. `chat-native-interactions-e2e` remained `PARTIAL/UNPROVEN`
because a newly committed sender message could be receiver-visible before the
sender Engine consumed its own authority event. The interaction command path
validated the target projection before its bounded preflight drain, so edit
could fail with `messaging edit target projection is unavailable`. The Engine
now drains before target validation for edit and metadata interactions. Focused
Linux run `20260828T235312023024Z-7035474534fefd51fcffa339de3a1432`
passed all Direct and Group interaction assertions with complete cleanup. Final
NDR-W1 and MP-W13-F proof still requires a same-source full aggregate after this
plan update.

### 2026-08-29 Environment Evidence Traceability Correction

The subsequent same-source aggregate
`20260829T000748292834Z-3cdc5c9684fc2b2719e4a9f0595a52f9`
executed all 17 selected Gates successfully on commit `d84076b40412`, but final
Quality Evidence exposed a generic contract mismatch. Eight environment Gate
reports omitted independent `phase` / `bom` / `spec` metadata. The aggregate
incorrectly classified those complete product results as traceability
`not-required`, while Quality Evidence correctly refused to consume them as
review proof.

The Infra correction now requires complete Phase/BOM/Spec/Gate traceability
before any environment result can become `DONE/PROVEN`; missing metadata forces
the result and aggregate to `PARTIAL/UNPROVEN`. `EvidenceReport` exposes generic
traceability fields, while each Chat Gate supplies its own existing plan and
specification IDs. Quality Evidence reports product and environment gaps to
`pt-github-review` without treating reviewer-owned judgments as evidence-pipeline
failures. The immutable aggregate above remains historical execution evidence,
not final review proof. NDR-W1 and NDR-W6 remain in progress until a new clean
candidate reproduces the full aggregate with complete traceability.

### 2026-08-29 Restored Session Identity Checkpoint

Focused Linux run
`20260829T073113740621Z-8e6bf85237eb3db7b715aa5523a759da`
passed the unchanged `chat-native-interactions-e2e` Gate after the Desktop auth
owner began committing account, actor, and rotated token as one restored
session identity. All 34 assertions passed, including timeout retry,
`station_restart_convergence`, Station and Engine readback, and resource
release. Replacement documents for Alice, Bob, and Charlie each completed
`auth_restore_session`, remained authenticated, and produced no post-restore
`kicked` response.

The immutable runtime evidence binds source, Station `18132`, the clean Linux
checkout, and binary SHA-256
`068ef890a7442e29aca59c8a4a094f2530460133e0b91a7554f4e0053eaecbb3`
to commit `0d4ab0cf774441814b27ba281a3fa65ca70f9a3d`. Gate cleanup
released all actor processes, ports, endpoint leases, logs, and storage; outer
Provisioner cleanup reached `CLEANED`. This closes the focused restart defect
only. The temporary debugger instrumentation and artifacts were subsequently
removed, and focused Desktop, Rust, and static checks passed. NDR-W1 and NDR-W6
remain in progress until the resulting clean commit passes a new exact-range
aggregate.

### 2026-08-29 Final Review Closure Slice

Independent review of clean candidate
`f00bfdde35675a206fb80490180149a9c28fd464` rejected the final readiness claim
before the 20-Gate aggregate completed. The interrupted Product Closure cell
was stopped through its registered lifecycle and reached `CLEANED`; its partial
run is diagnostic evidence only.

The accepted architecture remains unchanged. Four implementation gaps must
close before another final aggregate:

- retain the Linux remote Git source lease through Gate execution and release
  it last during cell teardown, because Gate-time native adapter imports still
  consume the mounted checkout;
- redact runtime artifacts before their first Evidence Store write and make the
  post-run secret scan read-only; registered artifacts and role metadata must
  never be rewritten;
- make the W11 audit consume current-source, runtime-cell-scoped immutable
  evidence and emit its verdict through the Evidence Store; and
- serialize Desktop account selection and session restoration so a rotated
  token cannot be committed or bound under a concurrently selected account.

This is a mechanical execution-plan amendment for already accepted D-11,
D-13/D-14, Desktop identity, and MP-W11/MP-W13 contracts. It does not add a new
product journey or architecture boundary. Linux remains the only runtime claim
in this closure; macOS and Windows remain explicitly `UNPROVEN`.

The closure implementation at candidate
`63655081df751593f8724a5f345a9f8efebae0e2` now:

- holds the remote Git source lock in a TTL-bounded remote lease process, stores
  its owner in both `PREPARING` and final `LEASED` state, and lets a later
  `stop` process release that exact owner;
- applies resolved-credential redaction before every artifact and final
  manifest write, scans role metadata read-only, and discards any run that
  bypasses the canonical writer;
- binds every W11 native report to the runner-owned runtime-cell manifest plus
  the current source, binary digest, Linux host/image attestation, Gate, run,
  workspace, and claimed runtime cell; and
- serializes the Tauri account switch, PIN unlock, restore, session commit,
  window binding, and Messaging Engine activation through one identity
  transition.

Focused verification passes: Acceptance tests `309/309`, runner tests `47/47`,
closure-generator tests `2/2`, Desktop tests `364/364` with one unrelated
environment test skipped, Desktop check/build, and Rust auth tests `7/7`.
Subsequent final review found three remaining P1 identity gaps, so this
candidate remains `PARTIAL/UNPROVEN`:

- HTTP Gateway `account_switch` updates the durable active account without
  atomically restoring and committing the matching JWT, legacy mirror, and
  Messaging Engine profile;
- HTTP Gateway PIN unlock derives the actor from the local account identifier
  instead of the Station JWT subject; and
- legacy encrypted PIN sessions without a persisted actor binding are accepted
  instead of failing closed and requiring login.

The closure must route HTTP Gateway switch and unlock through the same prepared
identity tuple and fail-closed commit semantics as the Tauri path. Acceptance
must cover concurrent multi-account switch, an OAuth
`provider_user_id != actor_id` fixture, a missing persisted actor binding, and
rollback that preserves the prior active account/JWT/runtime tuple. A new clean
exact-range Linux aggregate may start only after those checks and independent
blocker review pass; focused checks do not replace that product proof.

The working-tree closure after `63655081df751593f8724a5f345a9f8efebae0e2`
now:

- commits the account, JWT actor, legacy mirror, durable identity selection,
  window binding, and Messaging Engine profile from one prepared tuple;
- prepares the Engine before identity commit, starts its worker only after the
  identity projections commit, and rolls both layers back on activation
  failure;
- invalidates revoked actor windows, mirrors, durable sessions, raw sessions,
  event streams, and workers immediately after Station takeover;
- derives OAuth PIN identity from the rotated JWT subject and rejects legacy
  encrypted sessions without a persisted actor binding;
- proves deterministic lock contention, token-fingerprint equality,
  provider-user/actor divergence, commit-scoped durable-write rollback across
  different accounts, and run-scoped fixture cleanup in
  `chat-desktop-gateway-e2e`;
- replaces terminated Messaging lifecycle workers before activation can
  succeed and excludes inactive workers from identity readback; and
- preserves structured `secretScan` evidence metadata through canonical
  schema validation while continuing to redact credential values and rejecting
  malformed scan metadata.

Focused verification passes: Desktop check, `364/364` tests with one unrelated
environment test skipped, Desktop production build, Rust auth service `8/8`,
Tauri auth `4/4`, auth identity `1/1`, lifecycle `1/1`, HTTP Gateway `4/4`
with one environment test ignored, Chat Native static Gate, Chat structural
validation, Acceptance runner `48/48`, planner `9/9`, validator `8/8`, Infra
boundary `8/8`, Gap Detector `18/18`, coverage report `15/15`, and combined
Provisioner/Evidence Store tests `117/117`. The worker-liveness regression
passes `2/2` profile-worker tests, and the Acceptance WebDriver feature build
passes.

Independent final blocker review found no remaining P1 source defect and keeps
the result on hold only because the working tree has no source-bound runtime
artifact. NDR-W7 therefore remains `PARTIAL/UNPROVEN` until these changes are
committed and that exact commit passes the Linux aggregate and required-proven
validation.

The first exact-source aggregate attempt after commit `14e04370851f48847daf1dacfa53395286227ebf`
failed closed before product execution. The process environment did not export
the required destructive-reset authorization, and the selected
`federation-desktop-gateway-smoke` Gate declared the
`local-desktop-gateway` environment without its matching Provisioner. The
runtime cell reached `CLEANED`; no blocked Native Gate produced product proof.
The rerun must explicitly bind the worktree-local `three` profile to disposable
Station `18132`, export `CHAT_ACCEPTANCE_RESET=1`, and provision the Federation
Gateway smoke through `local-desktop-gateway`. These are execution wiring
corrections under D-07 and do not alter product assertions.

The next aggregate attempt at `7e1d321fc149e436feab6772e0f894bd0c8b6835`
confirmed Station source identity at `18132`, but still produced no product
proof. Native preflight found three orphaned run-scoped SSH forwards occupying
the slot-2 client ports and failed closed; those parentless processes were
identified by worktree cwd and released without touching protected ports.
The Desktop Gateway reached `FIXTURE_READY`, then the Evidence Store rejected
`logs/provision-desktop.log` because the Provisioner had streamed raw process
output directly into the immutable run directory. The correction now stages
that process log in a private temporary file and persists it exactly once
through `write_current_artifact`, so credential redaction occurs before the
first durable Evidence Store write. NDR-W7 remains `PARTIAL/UNPROVEN` pending a
clean candidate and full rerun.

The first aggregate attempt after that writer correction, at
`682af3e96fc5a926e018ccbcb2d629df404ac8cd`, was blocked by the disposable
Station host root filesystem reaching 100% usage. Whole-disk inspection
attributed 82 GB of 85 GB under `/var` to Docker, including 41.4 GB of fully
reclaimable build cache. Only that build cache was pruned; running containers,
images, volumes, and database data were preserved, and root usage returned to
57%. The same run also proved that the Federation Gateway smoke must derive its
Gateway, renderer, and Station endpoints from the Provisioner-owned Runtime
Manifest instead of caller-supplied defaults. No product proof is claimed from
this blocked run.

### 2026-08-29 Current-Source Aggregate Result

Exact-source Linux aggregate
`20260829T172402956898Z-bb3291653179b1ac01157ce6c8666670` ran at clean commit
`7dcdc71a22e8bf30b114b910a708c1d0cb6b2be0` on
`desktop-linux-native`. Source, Station, remote checkout, Desktop binary,
Ubuntu 24.04, Xorg, WebKitGTK, and workspace `a534541b87e49abf` were bound
successfully. All Gate and runtime-cell cleanup completed without using
protected WebDriver port `4445`.

The aggregate result is 6 PASS and 4 FAIL across 10 Gates, with canonical
status `PARTIAL/UNPROVEN`:

- `chat-native-product-closure-e2e` failed because a second process restart
  reached `session_missing`. Station takeover rotated and persisted the raw
  token, but revoked-session invalidation cleared the durable active-account
  state and the prepared restore tuple did not recommit it.
- `chat-native-interactions-e2e` and `chat-native-typing-e2e` timed out because
  their restart helpers explicitly logged out and then performed a fresh
  password login. A process-restart proof must preserve storage and wait for
  restored actor/device identity instead.
- `chat-desktop-gateway-e2e` failed its durable-write rollback assertion
  because the Provisioner-built Desktop runtime omitted the
  `acceptance-webdriver` feature, so the commit-failure injection path was not
  compiled into the tested binary.

`chat-native-two-client-e2e`, `chat-contact-message-resilience-e2e`,
`chat-native-multi-device-e2e`, `chat-native-recovery-e2e`, and
`chat-native-group-mls-e2e` are `DONE/PROVEN` for this source-bound run.
`federation-desktop-gateway-smoke` executed successfully but remains
`PARTIAL/UNPROVEN` in aggregate judgment. Required-proven validation,
Gap Detector, Completion Audit, and `review-submit` remain blocked until the
four failed Gates pass in a new full exact-source aggregate.

The working-tree Gateway diagnostic
`20260829T191005525236Z-4057c7f1e1106c911f843de1647f6a62` subsequently passed
with `DONE/PROVEN` Gate and cleanup evidence against disposable Station
`18132`. Its manifest records a dirty workspace digest, so it is diagnostic
evidence only. The Provisioner now compiles the required Acceptance feature,
binds its otherwise unused WebDriver listener to an OS-assigned ephemeral port,
and fails closed when the selected worktree/profile already owns a live
Desktop Rust or Vite process. Focused Provisioner tests pass. Protected ports
`18080` and `4445` are not cleanup targets.

### 2026-08-29 Exact-Source Traceability Result

Exact-source Linux aggregate
`20260829T203439484372Z-7c6fba9d9db5ce018b758a5e207fe73a` ran against clean
commit `d5b76eaf953504e0b599682a68472ccff04601f0`, disposable Station `18132`,
and runtime cell `desktop-linux-native`. All 10 selected Gates passed and all
Provisioner cleanup artifacts passed. The aggregate nevertheless remained
`PARTIAL/UNPROVEN` because `federation-desktop-gateway-smoke` did not emit
Phase/BOM/Spec traceability.

The Gate now binds its existing Federation Phase 1 `WS-6` client-integration
workstream, `desktop-federation-context-surface` capability, and
`desktop-federation-surfaces` Feature to the canonical evidence report. This
is a business evidence-injection correction; aggregate proof semantics remain
unchanged. NDR-W7 still requires a new clean commit, full exact-source
aggregate, required-proven validation, Gap Detector, Completion Audit, and
`review-submit`.

The subsequent exact-source aggregate
`20260829T220529357373Z-d9f2e09e9d76a4c60263e77bb47376bb` at
`3eb76b57745a31f5ad7b7b444922e8e74ff9579a` proved the Federation traceability
correction: that Gate and eight others reached `DONE/PROVEN` with successful
cleanup. `chat-native-product-closure-e2e` failed while opening the first
direct conversation from search. The Station projection contained the new
conversation, but the UI handler could observe a superseded `loadSessions`
request as complete before the winning reconciliation published its state,
then return without selecting the canonical conversation ID. The aggregate is
therefore 9 PASS / 1 FAIL and remains `PARTIAL/UNPROVEN`.

The candidate repair uses the canonical conversation ID returned by
`messaging_create_direct` to clear search state, select the conversation, and
restore any hidden local state before scheduling `loadSessions` as background
reconciliation. This preserves the component/runtime ownership boundary and
removes the superseded-load race without weakening the product Gate. Focused
selection tests, Product Closure static tests, Desktop check, Desktop tests,
and the production web build pass. Runtime proof remains pending a clean
commit and exact-source rerun.

Clean commit `c69ed69bb6d8d6e7cf2275f0ce2c76a39f35049b` closed that
pending Linux proof. Unified aggregate
`20260830T052209499498Z-ff6c99fc6e262b23e876f2c2e191a067` contains all 18
selected `ci-structure`, `ci-cheap`, and `env-evidence` Gates in one immutable
run: 18 passed, zero failed, blocked, partial, incomplete, or unproven, with
aggregate `completionStatus=DONE` and `proofStatus=PROVEN`. Every Linux Native
Gate binds source, Station `18132`, and `desktop-linux-native` cell commit to
that exact commit; every provisioned Gate records successful cleanup, and each
Linux runtime cell reached `CLEANED`.

Chat required-proven validation artifact
`chat-domain-validation/20260830T064910746621Z-3c12efb2bf7bcc2a8d86918770b4bd61`
marks all nine Chat capabilities `PROVEN`. Gap Detector accepted the exact
NDR-W7 / MP-W13-F Linux claim with all 18 selected Gates present and no gaps.
This closes NDR-W7 for Linux only. NDR-W8 macOS and NDR-W9 Windows remain
independent `UNPROVEN` platform workstreams.

### 2026-08-30 Current-Master Semantic Overlay

The current delivery candidate combines the canonical `peerPtid` migration
from `origin/master` with the previously proven search-created Direct
selection ordering. The merge changes the source identity used by every Native
runtime-cell attestation, so the historical `c69ed69bb` aggregate cannot prove
the integrated candidate. NDR-W7 must rerun the same 18-Gate exact-source
aggregate, required-proven validation, Gap Detector, Completion Audit, and
submit-time review. NDR-W8 macOS and NDR-W9 Windows remain independent
`UNPROVEN` workstreams.

The first exact-source rerun on `da45c293cdff4635116c4f3c8c28bc5a4dabbcff`
produced aggregate
`20260830T113117121389Z-78a35291fa86c1feb0642f2814c16183` and failed before
Linux product execution. The current canonical range selected 11 Gates; the
formal closure still requires those Gates plus the seven retained Linux
closure obligations from the historical 18-Gate set. Preflight exposed three
mechanical integration defects: stale `peerDid` / `actor_did` static
assertions after the PTID migration, a native environment contract omitted
from the required-service-kind cutover, and `proto-build` newline churn that
made later source attestations dirty. The correction updates the business
assertions to canonical PTID names, classifies Station as the environment's
only endpoint-backed required service, and restores generated output before
rerunning one 18-Gate aggregate. No product assertion, runtime-cell ownership,
or platform scope changes.

Aggregate `20260830T114602576010Z-63749f7758dd30288b3fa9e3c4349697`
then passed all local structural Gates but remained `BLOCKED/UNPROVEN` before
Native product execution. The PTID migration also left the disposable Chat
Fixture writing removed `sender_did` / `receiver_did` columns, and the
Federation gateway smoke still consumed the removed singular
`RuntimeManifest.station` field. The dependency-ready correction is to seed
friend requests with canonical actor PTIDs and migrate all affected Gate
consumers to the accepted `services.station` manifest contract, with focused
failure-path tests. This remains an atomic compatibility completion under
NDR-W7; it does not alter the runtime-cell or product contract.

Candidate `fde961da4bbe787d0053e778467005d60af9e8f2` commits that
compatibility correction. The Fixture now rejects missing or malformed preset
actor PTIDs before mutation, and the Native two-client and Product Closure
Gates require lowercase 64-hex Station protocol digests. Chat Native static,
Chat and Acceptance Infra structural validation, Desktop check/test/build,
Station messaging package tests, runtime provisioning self-validation, and a
real reset against disposable Station `18132` pass. The candidate remains
`PARTIAL/UNPROVEN` until the new exact-source 18-Gate aggregate and downstream
required-proven, Gap Detector, Completion Audit, and submit checks pass.

Exact-source aggregate
`20260830T122322895251Z-c5b825341dd29386af4f8c9755a3e8b5` at
`4786996440b62d67901ce16af225856718d1f1a1` reached the Linux Product Closure
Gate with valid source, Station, runtime-cell, and binary identity, then failed
at the shared pre-login `auth_logout` call because a freshly isolated client
correctly had no committed session. The aggregate was cancelled before
repeating that shared failure across the remaining Native Gates, and the Linux
cell was verified `CLEANED`. The dependency-ready correction is to remove only
the obsolete pre-login logout calls; authenticated cleanup logout remains
required. NDR-W7 remains `PARTIAL/UNPROVEN`.

The runner correction now removes that pre-login call from every shared and
Gate-specific Native initial-authentication path without weakening the product
`auth_logout` contract or changing Fixture accounts. Structural regression
tests prove that initial login and restart paths do not log out, while existing
authenticated cleanup paths still do. Focused Python tests pass 77/77; the
`chat-native-visible-static` Gate passes at
`20260830T131620861219Z-09126c6790ced771c627df7f8cc9d8a9`; Acceptance Infra
validation is `STRUCTURALLY_VALID` at
`20260830T131648607384Z-78a7f76a9d21c2a33cdb69d5721d24dc`; Station messaging,
conversation, and envelope package tests pass; Desktop check, 365/365 executed
tests, and build pass. A broad Chat validation run passed its six local Gates
and stopped only because `local-desktop-gateway` was not provisioned. NDR-W7
remains `PARTIAL/UNPROVEN` pending a clean commit, deployment, and the full
exact-source 18-Gate Linux aggregate.

Committed candidate `b851d221d261cd121a7077675da6dd112ecaab54` was deployed
to disposable Station `18132`. Exact-source aggregate
`20260830T132324598993Z-79e0e453e8aef5eac9ee376f8cf2003a` passed the local
Gates and proved that Product Closure crossed the obsolete logout boundary,
then failed during Alice login because the active Station registry entry had no
`peer_id`. Product Gate
`20260830T132344829627Z-f0a80cc7b04fd137c080ac6e7541ae75` retained valid
source, Station, runtime-cell, and binary identity and completed cleanup
without errors; the aggregate was cancelled before repeating the shared
failure, and the Linux cell was verified `CLEANED`. The root cause is
`StationRegistry::add`: a fresh environment-seeded entry already owns the URL,
so the probed metadata from `station_add` is discarded as a duplicate. The
dependency-ready correction is to merge and persist probed metadata when
adding an existing normalized Station URL, with registry and command-path
regression tests. NDR-W7 remains `PARTIAL/UNPROVEN`.

The Station registry correction now atomically replaces an existing normalized
URL entry with the latest probed metadata while preserving the active URL.
Regression coverage starts from an environment-seeded entry, refreshes its
`peer_id`, reloads the persisted registry, and verifies that the selected
Station retains that identity. Normal and `acceptance-webdriver` Rust test
targets pass 6/6 in both library and application binaries; `cargo fmt --check`,
Chat Native static, Desktop check, 365/365 executed frontend tests, and Desktop
build pass. NDR-W7 remains `PARTIAL/UNPROVEN` pending a clean commit,
exact-source deployment, and the full 18-Gate Linux aggregate.

Exact-source aggregate
`20260830T145021738008Z-029197c13bff9a48a385efdb07150cb6` ran against clean
commit `7c5751f7ad0ca2cefd498d8eeeabd7b0a8f3fd09`, disposable Station `18132`,
and `desktop-linux-native`. The registry correction crossed the former missing
Station identity boundary, but the aggregate finished 9 PASS / 9 FAIL and
remains `PARTIAL/UNPROVEN`. All eight Native Chat Gates failed at initial
authentication after `auth_login` succeeded: the identity pipeline immediately
called `auth_restore_session`, whose local token validation required JWT `sub`
while Station's canonical JWT contract emits `subject_ptid`. The Desktop
Gateway Gate independently rejected the canonical `actor_ptid` response because
its assertion still required `ptid`. Every runtime-cell and Provisioner cleanup
completed successfully, and `proto-build` passed last. The next correction must
align Desktop token decoding and the Gateway assertion with the canonical PTID
contracts before rerunning the same 18-Gate aggregate.

The canonical PTID correction is implemented in the current delivery
candidate. Desktop local JWT validation now consumes only Station's
`subject_ptid` claim and rejects legacy `sub`-only identity. The Desktop
Gateway Gate now consumes `actor_ptid`, captures the local `account_id` from
the committed current-session tuple, supplies `actor_ptid` when creating the
OAuth PIN fixture, and removes the persisted `actor_ptid` for the legacy
negative case. Focused normal and `acceptance-webdriver` Rust auth tests,
40 Chat Python contract tests, `cargo fmt --check`, Desktop check, 365/365
executed frontend tests, Desktop build, Chat Native static, and Chat structural
validation pass. NDR-W7 remains `PARTIAL/UNPROVEN` until this candidate is
committed and the retained exact-source 18-Gate Linux aggregate passes.

Exact-source aggregate
`20260830T164444086098Z-99846680116645e083efe5ff478ec07d` ran against clean
commit `2e0a2d52d95d86f009a86f41571e14a1c409b690`, disposable Station `18132`,
and `desktop-linux-native`. Source, Station, remote checkout, Desktop binary,
Linux host/image, and cleanup identities were bound correctly. The aggregate
finished 9 PASS / 8 FAIL / 1 BLOCKED with canonical
`completionStatus=BLOCKED` and `proofStatus=UNPROVEN`.

The run exposed two remaining Acceptance business-injection boundaries:

- the Chat harness emits canonical `actorPtid`, but nine Native Gate modules
  still read legacy `actorId`, producing empty post-login actor identity;
- the Desktop Gateway scenario PIN-protects an OAuth account for Bob, which
  correctly purges Bob's actor-scoped raw session, then incorrectly expects
  Bob's password account to remain restorable; the rollback assertion must use
  Alice's independent prior tuple instead.

Both corrections remain within the existing NDR-W7 / MP-W13-F scope and do not
change product semantics. No readiness claim advances until they pass focused
checks and a new full exact-source aggregate.

The Acceptance correction now consumes `actorPtid` consistently across all
nine Native Chat Gate modules and keeps the OAuth PIN failure-path baseline on
Alice's independent account after Bob's actor-scoped raw session is purged.
Regression coverage enforces a zero-hit legacy `actorId` scan and the
independent-account fixture. Focused verification passes 162/162 Chat Python
tests, 6/6 frontend Acceptance identity tests, Python compilation,
`git diff --check`, and structural validation for all nine Chat capabilities.
NDR-W7 remains `PARTIAL/UNPROVEN` pending a clean commit, exact-source
deployment, and the retained 18-Gate Linux aggregate.

Exact-source aggregate
`20260831T010051680324Z-9acc18252a3930520d39240dba1120f1` ran against clean
commit `6811189717933a5b68380dd6a2b9d07674c6eeb3`, disposable Station `18132`,
and `desktop-linux-native`. Source, Station, remote checkout, Linux
host/image, and per-Gate binary identities were bound correctly. Provisioner
cleanup passed for every environment-backed Gate and `proto-build` passed
last. The aggregate finished 11 PASS / 7 FAIL with canonical
`completionStatus=PARTIAL` and `proofStatus=UNPROVEN`.

The run exposed four independent implementation boundaries plus one shared
Native Gate cleanup defect:

- Product Closure still selects the legacy
  `data-chat-search-result-peer-did` attribute while the production result
  exposes canonical `data-chat-search-result-peer-ptid`.
- Interactions authenticates a Tauri window but reads engine evidence through
  the unrelated `http-gateway` session namespace, so the snapshot fails
  `UNAUTHORIZED`.
- Station typing delivery publishes under a numeric actor ID while the SSE
  receiver subscribes under canonical PTID. The typing Gate also short-circuits
  its first receiver wait on the truthy submit response.
- Group creation callers still send `memberDids` and removal sends
  `memberDid` after the harness contract moved to `memberPtids` and
  `memberPtid`.
- Five Native runners attempt HTTP Gateway logout for Tauri-window sessions.
  The resulting `session_missing` errors are correct for that namespace; the
  runners must use the owning window session and distinguish an already
  unauthenticated or revoked client from an authenticated-session loss.

These findings remain within the accepted NDR-W7 / MP-W13-F product and
runtime-cell contracts. NDR-W7 remains `PARTIAL/UNPROVEN`; required-proven
validation, Gap Detector, Completion Audit, and review submission remain
blocked until focused corrections pass and a new clean exact-source 18-Gate
aggregate reaches 18/18 `DONE/PROVEN`.

The owner approved this correction cycle on 2026-08-31 with Linux as the only
compatibility and runtime-proof target. NDR-W8 macOS and NDR-W9 Windows remain
explicitly `UNPROVEN`; this cycle neither executes their cells nor makes
cross-platform readiness claims.

### 2026-08-31 Remote Profile Resolution Blocker

The integrated correction is committed at
`a8fe6560adfe173dd447a857a7e525d38f04a71f` and pushed to
`origin/refactor/chat-acceptance-cutover`. Local focused verification remains
green, but no current-source Linux runtime claim has advanced.

Remote preflight exposed a same-name collision before deployment. `make config`
read a local cache that had repurposed profile `three` for disposable Station
`http://10.37.94.156:18132`, while the execution path correctly sourced the
sibling environment repository's canonical `three` profile at
`http://10.37.94.156:18080`. The command was interrupted after exact source
synchronization on deployment node `10.37.94.156` and during build, before
restart. No Gate was run and no new runtime evidence was emitted.

This is an Acceptance/development-environment infrastructure blocker. The
environment repository must define a distinctly named disposable profile, and
preflight plus runtime must derive the worktree selection from one active
pointer before resolving that canonical source. NDR-W7 remains
`PARTIAL/UNPROVEN`.

The infrastructure correction now defines canonical environment profile
`chat-native-disposable` for deployment node `10.37.94.156` and disposable
Station `18132`. Runtime and `make config` both derive the profile name from
the worktree-specific active pointer, then resolve the sibling environment
repository as authority. The shared selector no longer participates in
runtime resolution. Three isolated profile-resolution regression tests,
shell syntax validation, Skill validation, and `git diff --check` pass.
NDR-W7 is unblocked for exact-source deployment but remains
`PARTIAL/UNPROVEN` until the retained Linux aggregate passes.

### 2026-08-31 NDR-W7 Focused Runtime Result

Exact source `d20a8f91a771fe36a9595ac5e9b9ecbd7b31c4c5` was deployed to
disposable Station `http://10.37.94.156:18132` on deployment node
`10.37.94.156`. Focused Linux aggregate
`20260831T060844651620Z-05ad6436b8ef2710f1319c3c90b4c63d` completed with
5 PASS / 2 FAIL. Interactions, typing, Group MLS, two-client, and recovery
passed with source-bound Linux evidence. Product Closure and Multi-Device
remained `PARTIAL/UNPROVEN`. Provisioner cleanup passed for every Gate,
including release of runtime-cell resources on Linux host `10.37.246.80`.

The two remaining failures are Chat business Gate lifecycle defects:

- Product Closure authenticates each Tauri window but still performs eight
  readbacks through the unrelated HTTP Gateway session namespace. The first
  such readback failed at Alice reaction Engine evidence with
  `UNAUTHORIZED`. All bounded readbacks must use the authenticated window
  Harness and preserve actor identity checks.
- Multi-Device proved all five product assertions, including Bob2 enrollment
  and session handoff, but its lifecycle ledger still classified the
  authoritatively kicked Bob1 window as authenticated. Cleanup therefore
  attempted logout after the window session had already been removed. The
  Gate must prove Bob1's revoked identity state before recording the explicit
  revoked lifecycle transition; generic logout must continue to fail on
  unexpected session loss.

These corrections are a mechanical extension of the approved NDR-W7 /
MP-W13-F window-session ownership contract. They do not change product
semantics, runtime-cell architecture, or platform scope. The two failed Gates
must pass focused reruns before the retained 18-Gate aggregate is executed.
NDR-W8 macOS and NDR-W9 Windows remain `UNPROVEN`.

Focused reruns at clean source
`468e1702d3948a0664d4e383a95516f8f8d4808e` then proved both corrected
boundaries: Product Closure run
`20260831T072850367906Z-48299bae1ba2d8e516ff92e97faa24f8` and Multi-Device
run `20260831T075347334163Z-3a9f81176291b81e572ff92dc0437d93` each reached
`PASS/DONE/PROVEN` with successful cleanup.

Retained aggregate
`20260831T075903155838Z-beb051cfed538a276e78ad01ade81cad` subsequently
completed 18 PASS / 0 FAIL at the same exact source, with aggregate
`completionStatus=DONE`, `proofStatus=PROVEN`, zero missing traceability, and
successful cleanup for every provisioned Gate. The Station evidence is
attributed to deployment node `10.37.94.156` and endpoint `18132`; Linux Native
runtime-cell evidence is attributed to host `10.37.246.80`.

Chat required-proven validation artifact
`chat-domain-validation/20260831T091909749786Z-2b1ccc9dd33b1a95af3c393e655d2fae`
marks all nine Chat capabilities `PROVEN`. Final closure then exposed a stale
static Gate contract: `desktop-dev-runtime-isolation-static` still required
the retired shared `.local/dev/profile` selector even though the accepted
environment-source contract uses the worktree-specific active symlink and
resolves its profile name against the sibling `env` repository. The Gate also
was not present in the retained aggregate despite being selected by the
canonical `origin/master...HEAD` plan. Its assertions are being aligned to the
accepted worktree-specific selector contract; NDR-W7 remains
`PARTIAL/UNPROVEN` until that correction is committed and the union of the
retained Linux closure obligations and canonical range Gates passes at one
exact source. NDR-W8 macOS and NDR-W9 Windows remain `UNPROVEN`.

### 2026-08-31 NDR-W7 Final Aggregate And Audit Blocker

Exact-source aggregate
`20260831T142010116108Z-14a6f4f74f887bfb8a34230afa060fef` at commit
`162d36a32d8bd5cb62d04f9f3c7caf83e3833b51` completed 19 PASS / 0 FAIL
with `completionStatus=DONE`, `proofStatus=PROVEN`, zero missing
traceability, and successful cleanup for every provisioned Gate. Station
evidence belongs to deployment node `10.37.94.156` and endpoint `18132`;
Linux Native runtime-cell evidence belongs to host `10.37.246.80`.

Fresh W11 forbidden-owner and duplicate-owner scans plus Chat
required-proven validation passed at the same source. Gap Detector reports
the Linux-only NDR-W7 / MP-W13-F claim as `PROVEN` with no gaps while macOS,
Windows, and Mobile remain `UNPROVEN`.

W11 Completion Audit run
`20260831T153920368737Z-db1df6c1d9a07632118f5c542bdb8ff8` exposed an
audit identity-shape defect introduced by commit `63655081d`: immutable Gate
manifests use canonical source identity
`{commit, workspaceDigest, canonicalWorktreeHash}`, while Native evidence
reports retain `{commit, workspaceDigest, worktree}`. The audit compares
these semantically equivalent identities as exact dictionaries and therefore
rejects all seven valid Linux Native reports. The correction must preserve
commit, clean-workspace, and canonical-worktree binding while comparing the
two representations. NDR-W7 remains `PARTIAL/UNPROVEN` until that audit
correction, exact-source revalidation, Completion Audit, and submit review
pass.

The approved correction is implemented in the W11 audit owner. It normalizes
the report representation by hashing its recorded worktree and requires that
hash, commit, and clean-workspace digest to equal the canonical Evidence Store
identity. Evidence from another worktree still fails closed. The focused W11
Completion Audit unit suite passes 12/12. Exact-source runtime revalidation
remains pending at the resulting commit.

### 2026-08-31 NDR-W7 Linux Closure

Exact-source aggregate
`20260831T160909127606Z-afde2602bffb80909249fd0f7a8d3f6e` at commit
`9848935196a23250142708355d604a11f437fc54` completed 19 PASS / 0 FAIL
with `completionStatus=DONE`, `proofStatus=PROVEN`, zero missing result
traceability, and successful cleanup for every provisioned Gate. Station
evidence belongs to deployment node `10.37.94.156` and endpoint `18132`;
Linux Native runtime-cell evidence belongs to host `10.37.246.80`.

Fresh W11 forbidden-owner scan
`20260831T172746381758Z-cbbe7f358aca6234b74d8073af1017d7`,
duplicate-owner scan
`20260831T172746735850Z-eced1e91337156f31eab3d0e121616a0`,
and Chat required-proven validation
`20260831T172747490857Z-deed260304989f36515661e94e35bf61`
passed at the same clean source. Gap Detector reports the Linux-only NDR-W7 /
MP-W13-F claim as `PROVEN` with all 19 Gates selected and zero gaps.

W11 Completion Audit
`20260831T173142863566Z-400178f823a88832fef47415314c0168`
passed with `DONE/PROVEN`, five mechanically verified deletion/ownership
deliverables, nine accepted Gate runs, and no errors.

`make review-submit REVIEW_BASE=origin/master` passed quality evidence, hard
rules, knowledge matching, skill freshness, and review routing, then stopped
at global Acceptance validation because the unfinished Federation `fedp5`
domain has three Gates without a provisioner or environment contract. The
Owner previously approved merging this Chat work while Federation remains
unfinished. This is an explicit delivery waiver for that unrelated global
validation failure; it is not a passed Gate and does not prove Federation.
NDR-W8 macOS, NDR-W9 Windows, and Mobile remain `UNPROVEN`.

Independent review then found three P1 root-cause groups:

- Product Closure, Interactions, and Contact Resilience stop authenticated
  Native windows without registering them in `NativeClientLifecycleLedger`.
  Their cleanup evidence proves process, port, storage, and log release but
  does not prove fail-closed authenticated-session logout. The underlying
  logout path also discards persisted-session deletion errors and only warns
  on Messaging Engine deactivation failure before returning `logged_out`.
- the Typing Gate revokes Bob's device but does not attempt a rejected typing
  submission or verify receiver isolation; it sets
  `typing_revoked_device_rejected` to `true` unconditionally.
- W11 independently validates orchestrator, runtime-cell, and binary identity,
  but does not independently compare the report's Station attestation/live
  identity, and its closure contract does not bind the full canonical 19-Gate
  union or Gap Detector result.

The immutable 19-Gate aggregate remains valid evidence for the behavior it
actually exercised, but NDR-W7 remains `PARTIAL/UNPROVEN` and blocked before
delivery until these review findings are corrected, covered by negative
regressions, and revalidated at one clean exact source.

### 2026-09-01 NDR-W7 Independent-Review Corrections

The approved correction resolves the three review groups without changing
product or architecture semantics:

- Desktop logout now returns typed `logout_cleanup_failed` and retains the
  committed window session unless both durable-session clearing and Messaging
  Engine deactivation succeed.
- Product Closure, Interactions, and Contact Resilience now register Native
  windows in `NativeClientLifecycleLedger`, transfer preserved sessions across
  restarts, and fail cleanup when authenticated logout cannot be proven.
- the Typing Gate now submits from Bob's revoked device, requires the Station
  active-device rejection, and proves Alice observes no typing pulse.
- W11 now consumes immutable parent-aggregate run manifests, independently
  validates Station attestation plus live build identity, and requires the
  canonical 18-Gate range union plus retained `proto-build`.

Focused Rust tests pass 8/8 in normal and `acceptance-webdriver` modes. The
combined Chat/Acceptance suites pass 180 tests; Desktop passes 371 tests with
one existing environment test skipped, and Desktop check/build, Station
messaging packages, Chat/Infra validation, closure generation, Gap Detector,
and skill-check pass. NDR-W7 remains `PARTIAL/UNPROVEN` until these changes are
committed, deployed to Station node `10.37.94.156:18132`, and the complete
Linux closure plan runs on runtime node `10.37.246.80`.

### 2026-09-01 NDR-W7 Exact-Source Revalidation Findings

Aggregate `20260901T013544036203Z-2d66b83a59468e07bab1b580583a673c`
passed 20 of 22 Gates at commit
`fdc74df1ff3cff393adb1742944b051c9ec472d1`. The run exposed two
implementation defects within the approved NDR-W7 closure:

- the revoked-device Typing proof targeted the legacy install device ID while
  `messaging_submit_typing` authenticated with the active Messaging Engine
  endpoint ID, so the requested row was not revoked;
- `proto-build` changed three tracked generated TypeScript files before W11,
  and W11 re-read the late dirty workspace identity instead of using the
  aggregate-start identity, producing 21 misleading stale-identity errors.

The correction must expose the active Messaging Engine endpoint to the
Acceptance harness, make a zero-row Station revoke fail closed, preserve
generator-idempotent output, and bind W11 validation to the immutable
aggregate-start identity while reporting any live workspace drift separately.
NDR-W7 remains `PARTIAL/UNPROVEN` pending a fresh clean exact-source run.

### 2026-09-01 NDR-W7 Revoked-Endpoint Rejection Classification

Exact-source aggregate
`20260901T035623385274Z-f39e906c60248bfed2b5626d4ef311ad` at
`325c4341ae560b8b5670d98ee563c175ec401595` passed 19 of 22 Gates.
All runtime provisioner cleanup passed, and `proto-build` preserved the clean
aggregate source. The only primary failures were the Interactions and Typing
Gates; W11 Completion Audit then failed as their dependent closure.

Both failures were in Chat Gate rejection classification. Typing received the
required Station `403` but did not recognize the Harness text
`station returned 403`. Interactions swallowed Bob's revoked-endpoint
rejection and then incorrectly required Alice to submit into a Direct
conversation with no remaining active recipient endpoint. The correction
requires an explicit authorization rejection in both Gates, verifies no new
Authority event for the denied metadata command, and removes that invalid
post-revocation send requirement. Focused Chat Acceptance regression tests
pass 73/73. NDR-W7 remains `PARTIAL/UNPROVEN` pending a new clean exact-source
run.

### 2026-09-01 NDR-W7 W11 Live-Identity Revalidation

Exact-source aggregate
`20260901T055104027980Z-97ff871417bbf2cc212a77c4ba844cf7` at
`ef0b9006a82a5673ab432c8e355f4b2713bba8fa` passed 21 of 22 Gates. Every
Linux Chat product/runtime Gate passed, including Product Closure,
Interactions, Typing, Gateway, Federation smoke, and idempotent `proto-build`;
all provisioner cleanup passed. Only the dependent W11 Completion Audit
failed.

The remaining failure is evidence identity representation, not product
behavior. Station `/app-meta/version` reports the deployed commit as a
12-character Git abbreviation while the immutable aggregate and deployment
attestation retain the canonical 40-character commit. W11 incorrectly required
raw string equality. Product Closure also omitted the `stationLive` object that
it must bind into its own source identity.

The correction keeps the immutable attestation bound exactly to the canonical
40-character source, accepts only valid 7-to-40-character hexadecimal
prefix-equivalent live commit representations, rejects malformed or divergent
identities, and makes Product Closure capture and validate live Station
metadata. Focused Chat Acceptance verification passes 120 tests. NDR-W7
remains `PARTIAL/UNPROVEN` pending a new clean commit, deployment to the
approved remote Station, and a complete 22-Gate exact-source rerun.

### 2026-09-01 NDR-W7 Exact-Source 22-Gate Closure

PR #103 records the final Linux-only closure at
`ef89b11fed8afd2ecdc037f856ed0f28ee96f8be`:

- aggregate `20260901T095008761974Z-3b99fa79d3d1d9d637010b6253d070e0`
  passed 22/22 with `DONE/PROVEN`;
- W11 audit `20260901T110101534000Z-2095f54d374d51f23bcfd6feeb343aeb`
  passed with immutable aggregate, Station, runtime-cell, and binary identity;
- Chat required-proven validation reported 9/9 capabilities proven;
- Gap Detector
  `20260901T110219296710Z-c9fdc226d6982c096f792323d725caa8`
  reported `PROVEN` with zero gaps;
- `desktop-linux-native` cleanup reached `CLEANED`.

This closes NDR-W1, NDR-W6, and NDR-W7 for the existing Linux Chat claim.
macOS, Windows, Mobile, MLS group receipts, multi-device delivered
aggregation, PostgreSQL multi-node recovery, injected-network backoff/replay,
and Federation DOM surfaces remain explicitly unproven.

### 2026-09-02 D-18 Plan Amendment

The Owner accepted D-18 client-to-service binding architecture. D-18 is not a
new top-level plan; it extends this plan as NDR-W10 because its immediate
delivery purpose is the remaining Linux Native Chat multi-Station proof.

The amendment:

- keeps NDR-W7's completed 22-Gate evidence unchanged;
- adds Core binding, Native bound-session proof, Native Chat atomic cutover,
  and AS-NDR-09 through AS-NDR-12;
- keeps Mobile and Federation business injection outside this plan;
- preserves existing network-fault behavior through opaque Runtime
  Binding-owned transport handles instead of Gate-visible proxy URLs.

## 13. Final Readiness Gate

`PLAN_READY_FOR_EXECUTION` requires independent review and owner approval.

Implementation readiness requires:

- NDR-W1 through NDR-W6 complete with all static/failure-path gates passing.
- Linux AS-NDR-01 through AS-NDR-06 pass on the candidate host.
- Expanded Linux multi-service readiness additionally requires NDR-W10 and
  AS-NDR-09 through AS-NDR-12.
- macOS AS-NDR-07 passes without business assertion changes.
- Windows implementation is structurally complete; cross-platform product
  readiness remains `UNPROVEN` until AS-NDR-08 runs on a real Windows cell.
- Tree-wide scans show one Profile-based source-sync owner, one WebDriver
  endpoint resolver, and no platform APIs in business Gate code.
- All local and remote resources are released and verified.

## 14. Non-Claims

- Linux proof does not prove macOS or Windows behavior.
- Container image build success does not prove Native UI behavior.
- Embedded WebDriver smoke does not prove MP-W13.
- Static Windows adapter tests do not prove Windows Native runtime behavior.
- This plan does not close MP-W13 until the existing product Gate passes.
- NDR-W10 does not prove Mobile or Federation D-18 business injection.

### 2026-09-02 Windows Cell And Topology Amendment

Windows host `sixwin` (10.36.3.187, Win10 x64, 2× Xeon 8336C, 16 GB) is now
available via SSH. NDR-W9 is expanded from a stub into four dependency-ordered
closures (W9-A through W9-D) mirroring the Linux cell pattern:

- W9-A: host bootstrap (toolchain installation and build verification).
- W9-B: Win32 Native Desktop Adapter (window/focus/keyboard/screenshot via
  Win32 API).
- W9-C: runtime cell contract and remote provisioner (SSH-based source sync,
  process supervision, WebView2 WebDriver tunnel).
- W9-D: product gate execution and proof (22-Gate suite on Windows).

Parallel execution: W9 (Windows) and W10-D Linux evidence may proceed
concurrently. W10-D Windows evidence follows W9-C completion.

ARM64 fiveArm Station (10.37.221.38) is now deployed and healthy, unblocking
W10-D Linux multi-Station evidence. W10 is platform-neutral infrastructure;
each platform cell (Linux, Windows, macOS) consumes the same binding contract
and collects its own W10-D evidence independently.

Current Desktop Acceptance physical topology:

```
Orchestrator (macOS local)
├── Linux Cell ──────────────────────────────────────────────────
│   ├── station-four  10.37.245.247:18080  (x86_64, healthy)
│   ├── station-five  10.37.221.38:18080   (aarch64, healthy)
│   ├── relay         10.37.245.247:18081  (x86_64, shared)
│   └── Xorg cell     10.37.94.156 or 10.37.245.247  (shuxian)
│       ├── Alice → bound to station-four
│       └── Bob   → bound to station-five
│
├── Windows Cell ────────────────────────────────────────────────
│   └── sixwin        10.36.3.187          (Win10 x64, SSH)
│       ├── Alice → WebView2 + Win32 adapter
│       └── Bob   → WebView2 + Win32 adapter
│       └── Station: connects to station-four or station-five
│
└── macOS Cell (W8, not started) ────────────────────────────────
    └── local macOS   (orchestrator host)
        ├── Alice → AppKit + CoreGraphics adapter
        └── Bob   → AppKit + CoreGraphics adapter
        └── Station: connects to station-four

Station Fleet:
  10.37.246.80:18080     one    (x86_64)
  10.37.118.48:18080     two    (x86_64, co-located with relay)
  10.37.94.156:18080     three  (x86_64)
  10.37.245.247:18080    four   (x86_64, + relay :18081)
  10.37.221.38:18080     five   (aarch64, + relay :18081)
  192.168.31.119:18080   home   (x86_64, LAN edge)

Client Hosts:
  10.37.94.156           Linux Xorg cell host (shuxian)
  10.37.245.247          Linux Xorg cell host alt (shuxian)
  10.36.3.187            Windows sixwin (administrator)
  local macOS            orchestrator (macOS W8)
```

macOS (W8) remains pending and is not amended in this update.

### 2026-09-03 Windows Bootstrap And Source Reconciliation

The `refactor/chat-acceptance-cutover` worktree is the execution owner for this
plan. Its verified binding is branch `refactor/chat-acceptance-cutover`,
workspace `a534541b87e49abf`, and source commit
`8aa5fe687253381757041af2d7238824e7714a3c`.

Source reconciliation found that D-18 merge commit `51fca9493` deleted the
shared Native adapter and launcher files while later Windows work restored only
`native/{__init__,runtime,windows}.py`. The missing W3/W4 sources were restored
from their last canonical Git objects without replacing current D-18 Core
contracts:

- `tooling/acceptance/core/drivers/launcher.py`
- `tooling/acceptance/core/{_paths,source_sync}.py`
- `tooling/acceptance/drivers/tauri.py`
- `tooling/acceptance/drivers/native/{base,macos,linux_x11}.py`
- `tooling/acceptance/transports/{__init__,ssh}.py`
- `tooling/acceptance/provisioners/{local_tunnel_supervisor,native_desktop_linux,native_tauri_embedded_webdriver}.py`
- `tooling/acceptance/runtime-cells/desktop-linux-native.yaml`

The restored Linux lifecycle resolves through the runtime-cell registry, and
the runtime-cell plus Win32 static contract suite passes 19 tests with the
Windows-only smoke skipped locally. A real import and screenshot attempt on
`sixwin` reached the Win32 GDI call but `BitBlt` failed because an SSH service
session has no interactive desktop; this is environment evidence for
`BLOCKED/UNPROVEN`, not a Windows Native proof. W9-B smoke must run inside the
interactive Desktop session used by W9-C.

`sixwin` now has Python 3.12.1, Node 24.19.0, pnpm 11.25.0, Rust/Cargo 1.98.0,
Git 2.55.0, and VS 2022 C++ Build Tools. `cl.exe` and `msbuild.exe` resolve
after loading `C:\BuildTools\Common7\Tools\VsDevCmd.bat`. WebView2/driver
verification and a clean Windows Tauri compile remain before W9-A can close.

The shared SSH transport now has an explicit Windows platform mode. It renders
argv through encoded PowerShell, validates drive-absolute Windows copy targets,
uses the Windows Python launcher for remote probes, and verifies the remote
loopback endpoint before opening a local-forward tunnel. Focused transport,
runtime-cell, and Win32 adapter tests pass 23 assertions with the interactive
Windows smoke skipped locally; live `sixwin` execution of the encoded transport
returned Node `v24.19.0` and Python `os.name=nt`.

### 2026-09-03 Windows Source Closure And Dependency Preflight

W1-W6 source reconciliation was completed without replacing the current D-19
Core contracts. The runtime-cell composition entries, two-client runner and
evidence validator, platform-cell Make targets, generated W11 plan, typed Gate
metadata, fault-proxy contracts, and Desktop Native acceptance bridge are again
single-source and runtime-cell aware. The Windows contract remains at
`tooling/acceptance/runtime-cells/desktop-windows-native.yaml`.

The Windows transport and source path now additionally:

- force UTF-8 for encoded PowerShell and broker subprocess output;
- use `msvcrt` byte-range locks with owner metadata outside the locked byte;
- preserve the Linux persistent lease API and strict host-key verification;
- hold a Windows source lease through runtime-cell preparation;
- enable repository-local `core.longpaths=true` before checkout and cleanup;
- derive display geometry from the interactive Win32 screenshot instead of the
  SSH service session; and
- reject a manifest whose observed geometry differs from the contract.

Live `sixwin` dependency evidence:

- Host: Windows 10 Build 19045, interactive Explorer session `1`.
- Toolchain: Node `v24.19.0`, pnpm `11.25.0`, Python `3.12.1`, Rust/Cargo
  `1.98.0`, Git `2.55.0.windows.5`, VS 2022 `VsDevCmd.bat`, Strawberry Perl
  `v5.42.2`, and protobuf compiler `libprotoc 36.0`.
- WebView2 Runtime: `152.0.4191.62`.
- Source: expected and remote commit
  `8aa5fe687253381757041af2d7238824e7714a3c`, clean remote checkout, tree
  digest `sha256:48e07e44c186fa411353661e532f9e8988bea55e3ef518b88d99b118167afb62`.
- Build snapshot: workspace digest
  `7b54afb0fcacf60e9b9ac17719be866fd40c8e10d99e69a37f793b38efd8d7d3`;
  AppleDouble-free source archive SHA-256
  `2081c599dd0e9c7884c31e6294a787712db9a834bb4c69783147641513bf0343`.
- Source lease: competing owner rejected with the active owner identity;
  release and reacquire passed.
- Broker: acquire/status/audit/TTL-task registration/cleanup passed through
  Task Scheduler's PowerShell `Interactive` logon type, which maps to the
  interactive-token scheduler contract.
- Adapter: the QXL output accepted `1920x1080@64Hz`; the interactive GDI
  screenshot produced a valid 8,294,454-byte BMP at `1920x1080`, SHA-256
  `cb609e51a82ae8fd0ba71e1a240248d1494fac94d92916e5d3561123dbc54cb8`;
  mouse-state probe passed.
- Tunnel: broker-launched actor PID and task were live, remote loopback `4645`
  returned HTTP 200 through the local SSH forward, and process/task/ports/storage
  cleanup all passed.
- Build: the Windows frontend and applet build passed, then
  `cargo build --locked --features acceptance-webdriver` produced
  `peers-touch-desktop.exe`, SHA-256
  `be1ed49e980d3fa466d991133be2d7a450562f5cb8718c2a370998908b50ea76`.
  Host preflight executes the required Perl module and `protoc --version`
  instead of accepting path existence alone. The source snapshot disabled
  macOS AppleDouble emission and was scanned for zero `._*` entries before
  transfer.
- Residue: no Acceptance scheduled tasks, no listeners on `3230` or `4645`,
  no runtime-root entries, no temporary source archive, and the remote source
  remained at the expected commit with zero residue.

Verification:

- Windows runtime-cell/source/lease/transport/provisioner/broker/binding suite:
  63 PASS, 1 non-Windows-host smoke skipped.
- NDR Chat contract suite: 115 PASS.
- Native bridge Vitest: 6 PASS.
- Desktop TypeScript check, 538 Vitest tests (1 environment-backed test
  skipped), frontend production build, and Rust
  `cargo check --features acceptance-webdriver`: PASS.
- Applet contract TypeScript build, `packages/applets/build.js` syntax, Python
  compile, and `git diff --check`: PASS.
- Acceptance Gap Detector: `UNPROVEN` for W9-D/W10-D as expected. Current
  product Gate evidence remains source-stale and the dirty source-closure range
  is broader than the canonical product-plan mapping; no product proof is
  inferred from the successful build.

The former D-19 API/proto and display-geometry blockers are closed for this
source snapshot. The successful executable build is dependency and source
closure evidence only: the provisioner-backed Windows product launch, the
22-Gate Windows product run, and W10-D Windows multi-Station product evidence
were not executed. W9-D and the Windows portion of W10-D therefore remain
`UNPROVEN`.

### 2026-09-03 NDR-W10 Test Reconciliation

The stale pre-D-18 Native Chat test fixtures and static assertions now use the
accepted typed client contract (`id`, `required_service_roles`, and
`service_bindings`) with distinct `station-four` and `station-five` services.
Fault-path assertions now require Runtime Binding-owned opaque transport
override creation, application, and cleanup, and reject the removed
Gate-visible endpoint API. Lifecycle assertions now reflect that
`create_bound_session` owns launch and readiness while preserving the existing
MP-W13 product assertions and UI sources.

Focused verification passes 185 tests:

- `test_provisioning_model.py`: 45 PASS.
- `test_native_runtime_binding.py`: 6 PASS.
- `native_two_client_e2e_test.py`: 9 PASS.
- `native_interactions_static_test.py`: 29 PASS.
- `native_runtime_cell_runner_test.py`: 42 PASS.
- `native_product_closure_static_test.py`: 54 PASS.
- `git diff --check`: PASS.

No implementation defect remained after the stale test contracts were
reconciled. No live Gate, destructive reset, commit, or push was run. NDR-W10-D
Linux and Windows multi-Station product evidence remains `UNPROVEN`.

### 2026-09-03 Windows Product Gate Preflight

The platform-neutral D-18 source closure now includes:

- a Native environment with source-attested `station-four` and `station-five`
  service IDs and explicit bindings for Alice, Alice2, Bob, Bob1, Bob2, and
  Charlie;
- contract-to-manifest client projection with no endpoint copies;
- Runtime Binding-owned launch generation, live Station identity observation,
  binding-proof persistence, and exact tuple-closure validation;
- opaque run/client/role/service-scoped transport override handles; and
- Native Chat runners migrated away from normal-launch Station URL injection
  and Gate-visible fault endpoint routing.

Verification:

- Core/runtime/Chat D-18 focused set: 185 PASS.
- Recovery and MLS typed-fixture additions: 11 PASS.
- Stable `chat-native-visible-static` Gate: `DONE/PROVEN`, 6 Vitest and 161
  Python assertions PASS, run
  `20260903T075747981683Z-7f94a03e46b08e7a73c2ca21e7886058`.
- Desktop TypeScript check, 538 Vitest tests with one environment-backed skip,
  Desktop production build, and three Rust Acceptance window tests: PASS.
- Acceptance plan self-check, Station messaging, messaging platform contract,
  redaction/Evidence Store, and profile-resolution tests: PASS.

The first non-destructive Windows environment attempt used
`desktop-windows-native` and produced immutable run
`20260903T074452984662Z-a9ab5cce3180cc34471c5ed4957d41ca`.
It stopped during service attestation because station-four runs commit
`ef89b11fed8afd2ecdc037f856ed0f28ee96f8be`, while the client source is
`8aa5fe687253381757041af2d7238824e7714a3c`. The result is
`completionStatus=BLOCKED`, `proofStatus=UNPROVEN`, with
`blockedResource=source-identity:station-four:commit`. The blocker occurred
before actor manifest creation, Fixture setup, or Windows runtime-cell
provisioning. No destructive Fixture reset or Station restart was performed.

Final `sixwin` audit shows zero Acceptance scheduled tasks, zero listeners on
`3230` and `4645`, zero runtime-root entries, a clean remote source checkout,
and expected HEAD `8aa5fe687253381757041af2d7238824e7714a3c`.

W9-D and Windows W10-D remain `BLOCKED/UNPROVEN`. Their next dependency is a
clean committed source deployed with source/runtime identity to both
station-four and station-five, followed by separate explicit authorization for
the destructive Fixture target(s). Build, static, or preflight evidence does
not substitute for the unrun Windows product Gates.

### 2026-09-03 Station Source Closure Reconciliation

Pre-commit verification exposed merge omissions in the Station Agent V2 source
that were not covered by the earlier Desktop and Acceptance-focused suites.
The source closure now also includes:

- canonical CLI normalization and prompt-routing behavior;
- Conversation runtime-authority persistence and migrations using the current
  `ActorPTID` / `actor_ptid` storage contract;
- actor-owned conversation checks consistently querying `actor_ptid`;
- bounded actor-owned OSS attachment reads and SHA-256 persistence required by
  Agent attachment admission; and
- the remaining Agent V2 domain, handler, persistence, and service code from
  the accepted source, reconciled without replacing current identity naming.

Verification after reconciliation:

- `go test ./apps/station/app/subserver/agent/...`: PASS.
- `go test ./apps/station/app/subserver/oss/service`: PASS.
- W10/Windows focused Python suite: 224 PASS.
- Desktop TypeScript check: PASS.
- Desktop Vitest suite: 538 PASS, 1 environment-backed test skipped.
- Desktop production build, including applet builds: PASS.
- Rust `cargo check --features acceptance-webdriver`: PASS with existing
  warnings.
- Rust Acceptance window tests: 3 PASS.
- Python compile, `packages/applets/build.js` syntax, `git diff --check`, and
  added-line secret/debug/home-path scan: PASS.

Broader checks remain accurately bounded:

- `go test ./apps/station/app/...` reaches the pre-existing live
  `apps/station/app/tests` package and fails because no Station is listening on
  `127.0.0.1:18080`; all preceding application packages, including Agent,
  messaging, and OSS, pass.
- The Station frame workspace still has unrelated mDNS/bootstrap/transport and
  backup-package failures outside this NDR source-closure range.
- `make acceptance-validate` still fails on the unrelated Federation `fedp5`
  Environment/Provisioner registration gap.
- Gap Detector remains `UNPROVEN`: required runtime Gates are unrun and the
  accumulated dirty range is broader than its canonical Acceptance plan.

At this source-reconciliation checkpoint, no commit, push, Station deployment,
runtime restart, actor Fixture creation, or destructive reset had been
performed. W9-D and Windows W10-D therefore remained `BLOCKED/UNPROVEN`; the
next dependency was an explicitly authorized commit and exact-source deployment
to station-four and station-five.

### 2026-09-03 Exact-Source Deployment Attempt

Source closure commit
`d466f0e52286f76220790bd329ea7bf8f64fb887` was created without pushing to
GitHub. The immutable worktree binding was refreshed and verified against that
full commit.

Deployment remained fail-closed:

- station-five (`10.37.221.38:18080`) is healthy on `ef89b11fed8a`.
  `make station` under the canonical `fiveArm` remote profile stopped during
  source sync with `BLOCKED:dirty-remote-worktree`; build and restart did not
  run.
- station-four (`10.37.245.247:18080`) is healthy on `ef89b11fed8a`.
  Deployment was not attempted because canonical profile `four` declares that
  URL but resolves `PT_STATION_DEPLOY_ENV=station`, whose cached deployment host
  is station-five. The profile/deploy target mismatch is unsafe.

No remote cleanup, reset, checkout override, Station restart, Fixture creation,
or product Gate ran. The minimum closure is:

1. reconcile and preserve the remote station-five working-tree changes before
   retrying exact-source sync;
2. correct the canonical station-four profile/deploy mapping in the environment
   repository; and
3. deploy one clean exact commit to both Stations and verify their runtime build
   identities before requesting target-specific destructive Fixture
   authorization.

### 2026-09-03 station-four Exact Deployment

The supported `PT_DEV_PROFILE_FILE` override supplied a temporary,
worktree-local remote profile whose Station URL and dedicated
`station-four` deployment environment both resolve to
`10.37.245.247:18080`. `make station` then completed exact source sync, build,
restart, and health verification for commit
`0b8e4bb983efdc56668d3c246dd88825c513878d`.

Live `/app-meta/version` metadata reports build commit `0b8e4bb983ef`, build
label `refactor/chat-acceptance-cutover`, and Go `1.24.6`; the remote checkout
is clean. The non-destructive Windows preflight run
`20260903T092631845257Z-042991cd1071da409b3936c9767263dd` emitted a valid
station-four deployment attestation, then stopped at
`service-identity:station-five` because station-five does not expose the
current stable build commit. No client, actor Fixture, or Windows runtime cell
was provisioned. Provisioner cleanup completed with `DONE/PROVEN`.

station-five remains healthy on `ef89b11fed8a`; exact-source sync is blocked by
an uncommitted `tooling/docker/station.Dockerfile` change that replaces the
committed domestic mirrors with Docker Hub images. That remote change has been
inspected but not modified, reset, stashed, or overwritten.

### 2026-09-04 Windows Direct-Open Debug Checkpoint

The Windows product Gate now reaches the first cross-Station Direct journey
with complete source, runtime, and client-binding identity:

- Gate run:
  `20260904T053556542665Z-6aa174fec173c38d9b9c98594ba9e011`.
- Exact source:
  `63e830f6b50dafa02ad8c0a2b5f66491cf100059`.
- Runtime cell:
  Windows 10 x64, WebView2 `152.0.4191.62`, interactive `1920x1080`,
  Win32 `SendInput`.
- Client bindings:
  Alice generation 1 -> station-four; Bob generation 1 -> station-five.
- Product result:
  `PARTIAL/UNPROVEN`, timed out waiting for Alice's first Direct
  conversation.
- Cleanup:
  runtime-cell and Provisioner cleanup `DONE/PROVEN`.

The pre-fix debug trace proves that the exact Bob result received the native
click, but no conversation pane or session projection appeared. Client logs
also prove a separate owner-layer defect: `auth_login` starts the messaging
worker with the newly issued token, then the identity pipeline invokes
takeover-style `auth_restore_session`, which revokes that token as `kicked`
before returning another token.

The correction keeps persisted-session takeover for cold launch and renderer
reload, but changes post-login identity reconciliation to validate the token
already bound to the current window through `auth_validate_token`. Temporary
handler-entry and create-direct instrumentation remains active for the
post-fix comparison. Local verification passed:

- Desktop check: PASS.
- Desktop tests: 539 PASS, one environment-backed test skipped.
- Desktop production build: PASS.
- Chat Native product-closure static tests: 56 PASS.
- Provisioning owner plus Chat static tests: 73 PASS.

The Gap Detector correctly remains `UNPROVEN`: the post-fix Windows product
Gate and the remaining 22-Gate matrix have not run.

The first post-fix Windows run
`20260904T061940213867Z-e8f335fd65350800b1b198472c68e6f6`
used exact source `1ee7da584aaae737fa0c4270eb35cb2152c37203` and binary
SHA-256
`2fbb00352224de469e6a1b2e00d169db5206bd919c84ef382a93ed1e0c88afc2`.
It proved the session-takeover correction: neither client emitted a
`session_revoked` failure. Direct-open instrumentation then proved:

- the native click reached the exact station-five Bob result;
- `ChatSessionList.handleSearchSelect` executed;
- no existing conversation ID was selected;
- `messaging_create_direct` started;
- Station authenticated `POST /messaging/conversation/direct` and returned an
  application-level 404 before a conversation was created.

Database readback isolated the second root cause. The remote actor and
`home_station_peer_id` existed in `touch_actor`, but no remote
`actor_devices`, `auth_peer_keys`, or `federation_station_membership` row
existed. Messaging therefore required remote endpoint state before it could
discover the actor's Home Station, and its production composition had no
live Relay access for the subsequent fetch.

The local correction now:

- reads actor Home Station ownership from `touch_actor`;
- establishes missing Station TOFU through a fresh signed DHT locator and
  profile resolution before accepting an endpoint manifest;
- reads the Relay client dynamically per request instead of capturing an
  unavailable Init-time handle;
- uses protobuf for the inter-Station profile, endpoint-manifest, authority
  prepare, MLS KeyPackage claim, and durable federation-frame control paths.

Focused Messaging/resolver tests, race tests, Chat Acceptance contract tests,
Go style, formatting, and diff checks pass. Full Station App tests reach only
the pre-existing environment-backed suite that requires a service at
`127.0.0.1:18080`; full Frame tests retain unrelated baseline failures in
legacy config/CLI/logrus/ActivityPub packages. The next action is an authorized
commit and exact-source Windows rerun; the checkpoint below records that
subsequent result.

### 2026-09-04 Windows Endpoint Bootstrap Proof Checkpoint

Commit `6517324cdb5aa46cf6fcca8eac2e6ed1858c6721` deployed through exact
Git-object source sync to station-four and station-five. Both deployments
reported clean workspaces, the same protocol digest, distinct Station peer
identities, one connected DHT seed, and ready federation health after their
dedicated Relay/DHT environments were reapplied.

Windows Gate run
`20260904T074120233666Z-fdb77bd29b2e510be6a9964332a9e4d5`
proved:

- clean Windows source at the exact commit;
- binary SHA-256
  `c0d00168bbbb7161789cd8ac8810dbea9447b73f8abc6a0240bac27beef8c17e`;
- Windows 10 x64, WebView2 `152.0.4191.62`, connected `1920x1080` output,
  Win32 `SendInput`, and process-bound native windows;
- Alice bound to station-four and Bob bound to station-five;
- first exact Bob search created Direct conversation
  `d-f4d4aaa25c831bb05fdd53cd1cdd6120`;
- the second exact Bob search selected the same conversation;
- process, port, storage, endpoint, tunnel, and lease cleanup completed.

The overall Gate remains `PARTIAL/UNPROVEN`. The first later product failure
was `transcript.thread.ui`: Alice rendered Bob's group message, but the Gate
could not observe the pane-owned message action overlay within 15 seconds.
Source history proves commit `13a3d5bb1` removed the accepted
`ChatMessageActionOverlay` wiring and restored the row-local absolute toolbar
for MP-W13's PTID reconciliation. This conflicts with the accepted MP-W13-B
deliverable and atomic deletion matrix.

Runtime-log cleanliness also failed independently. station-four stores both
actors as active members in `messaging_conversation_members`; station-five has
no authority, legacy, or follower membership projection for the remote Direct
or group. Bob's Home Station therefore rejects legacy
`/conversation/member/settings` and Alice's legacy
`/conversation/thread/counts` calls with
`active conversation membership required`. The next implementation slice must:

1. semantically restore the pane-owned, collision-aware message overlay while
   retaining the PTID model and later fixes;
2. resolve `DESIGN_AMENDMENT_REQUIRED` for remote Home Station authorization:
   current Messaging federation frames deliver opaque device queue payloads
   but do not materialize an authority-signed post-transition membership
   projection on station-five; receipt history cannot safely substitute for
   active membership after removal;
3. after that design is accepted, route thread/settings reads through the
   canonical Messaging authority/follower projection instead of weakening
   authorization;
4. add focused regression tests, rerun the exact Windows Gate, then run the
   remaining 22-Gate matrix, Gap Detector, and completion audit.

### 2026-09-04 MP-W13-B Reconciliation And MP-D29 Design Gate

The MP-W13-B semantic conflict is resolved locally without overwrite-style
file replacement:

- the PTID model and current group-member loading remain;
- `ChatMessageTimeline` again owns one `ChatMessageActionOverlay`;
- `ChatMessageRow` only emits hover/focus anchors and no longer owns an
  absolute toolbar inside transformed virtual rows;
- collision, keyboard focus, selected-emoji reaction, pending/error/rollback,
  authority-sequence, attachment-count and thread-reply-ID evidence are
  restored;
- a structural regression test forbids the row-local `HoverActions` owner.

Local evidence:

- `pnpm run check`: PASS;
- `pnpm run test`: 539 PASS, 1 explicitly skipped three-Station E2E;
- `pnpm run build`: PASS with pre-existing chunk-size/dynamic-import warnings;
- Chat product/static contracts: 71 PASS;
- focused overlay/reaction/thread tests: 18 PASS.
- exact 13-file change-surface planning selected the existing Chat Gates without
  adding a new Feature or Capability;
- `station-messaging-unit`, `messaging-platform-contract`, `desktop-check`,
  `chat-native-visible-static`, and `acceptance-plan-self`: PASS
  (`chat-native-visible-static` includes 6 Vitest and 166 Python tests);
- `acceptance-infra-validation`: unrelated infrastructure failure because the
  aggregate Acceptance run omits the `source` field required by the validator;
- `acceptance-runtime-provisioning-self`: unrelated baseline failures in the
  Agent provisioner tests, launch-context timing tests, and occupied port 4445.

This proves implementation and static closure only. MP-W13-B remains
`IMPLEMENTED_UNPROVEN` until a source-bound native Gate observes the overlay,
geometry and interaction results.

Remote member-settings authorization is now captured as proposed `MP-D29` in:

- `docs/architecture/messaging-platform/design.md`;
- `docs/architecture/messaging-platform/decisions.md`;
- `docs/architecture/messaging-platform/data-model.md`;
- `docs/architecture/messaging-platform/integration.md`.

`MP-D29` reuses the authority-signed public `ConversationEvent` already carried
inside `DeviceEventDelivery`, keeps endpoint payload bytes opaque, and requires
one target transaction for follower head/membership, federation inbox and local
device queues. It defines duplicate/gap/fork/fresh-join/snapshot semantics,
canonical authority-versus-follower membership reads, and hard deletion of
legacy JSON thread/settings reads. Status is `DESIGN_READY_FOR_REVIEW`; no
Model, Station or Desktop membership implementation may begin before Owner
acceptance.

### 2026-09-04 Overlay Exact-Source Rerun Blocker

Commit `4a13e269aca19a2eaefd4fdb20af7e53bf8ae973` contains the pane-owned
overlay repair and the proposed MP-D29 documents. Both Station deployments and
the Windows binary attested this exact source.

Windows runs
`20260904T092247675913Z-f95b1761b3142fd0081bd5e071185a77` and
`20260904T095919484188Z-5258359310246689b3288cd4289543c4` stopped before the
overlay assertion because Direct creation returned Station 500. Both runs
proved Windows 10/WebView2/Win32 input, exact source and service bindings, and
complete process/port/storage cleanup.

The first run exposed that `make station` had recreated both containers with
the shared environment: DHT seeds were empty and the Relay client was disabled.
The saved per-Station environments were reapplied. Both Stations then reported
one DHT seed, a connected Relay client, and a non-empty routing table.

The second run isolated a separate owner-layer defect:

- station-five returned Bob's endpoint manifest with HTTP 200;
- station-four persisted the verified Bob manifest;
- station-four correctly had no Bob row in its local `actor_devices`;
- `ConversationService.CreateDirect` discarded the resolved manifest snapshots
  and rebuilt all participant endpoints only from local `actor_devices`.

Approved correction:

1. retain the creator local-device authorization check;
2. derive the participant endpoint set from the already-verified manifest
   snapshots through the existing canonical helper;
3. add a regression test with a local creator and a remote peer present only in
   a signed endpoint manifest;
4. run focused Station/Chat checks, commit, redeploy both Stations, reapply the
   dedicated topology, and rerun the Windows Gate.

This does not change MP-D29. The overlay remains `IMPLEMENTED_UNPROVEN`, and
follower membership implementation remains blocked on separate Owner
acceptance.

The user then reproduced the same failure from the Contacts profile in a
separately merged worktree: `Message` switched to Chat, but the right pane
remained the generic no-selection state and displayed only a global
conversation-action toast. Audit of the dedicated
`chat-contact-message-resilience-e2e` Gate found that its historical Linux
proof accepted either an active Chat subpage or a generic Chat area. It did not
require a peer-bound conversation surface, its owning
`desktop-chat-surface` Feature/Capability did not require the Gate, and no
Windows run existed. That historical proof is therefore insufficient for the
reported product behavior.

The current correction strengthens both ownership layers:

1. Station `CreateDirect` derives participant endpoints from the verified
   manifest snapshots already fetched for the actor set; only the creator's
   authorization remains a local-device lookup.
2. Desktop owns a transient, request-generation-fenced Direct-open intent.
   Contacts and search results navigate immediately to a peer-bound pane.
3. The intent pane shows creating, inline failed, and retry states without
   inventing Station conversation truth; successful creation replaces it with
   the authoritative conversation ID.
4. The resilience Gate requires the exact peer PTID, intent state, inline
   error, enabled retry, and pass screenshot. A Chat-tab switch, generic empty
   pane, or toast-only response fails.
5. `desktop-chat-surface` and its Capability now require the resilience Gate
   on every claimed native runtime cell.

Local evidence:

- all Station Messaging package tests: PASS;
- remote-manifest Direct genesis regression: PASS;
- Desktop check: PASS;
- Desktop tests: 540 PASS, 1 skipped;
- Desktop production build: PASS with existing bundle warnings;
- Chat static/contract suite: 169 PASS.

The current slice remains `IMPLEMENTED_UNPROVEN` until exact-source Windows
`chat-contact-message-resilience-e2e` proves the failure path and Windows
`chat-native-product-closure-e2e` proves successful cross-Station Direct open.

Windows resilience run
`20260904T113004716796Z-40317bad53a2b6608f02e4df47fa57f9` at exact source
`61f1cb759687899735a2a6069913c4a95f7ecf8c` was
`BLOCKED/UNPROVEN` before client launch. Both Station attestations and
provisioner cleanup passed, but fixture construction could not bind Bob
because the one-client Gate intentionally launches only Alice and the
provisioner incorrectly derived fixture actor bindings only from launched
runtime clients.

The Chat-specific native provisioner now resolves fixture actors from the full
declared environment client bindings and keeps runtime allocation limited to
the Gate's client subset. A regression test proves non-launched Bob binds to
station-five while Alice binds to station-four. Fresh exact-source Windows
evidence is still required.

### 2026-09-04 Windows One-Client Runtime-Cell Infra Repair

Windows resilience run
`20260904T121508428720Z-62049f534df05230e5fa28f0daa3f5a0` reached the
exact-source Windows runtime cell at commit
`f8688325219bedda029fd58cbd46afeb074a9738`. The built Desktop binary had
SHA-256
`c7994f756e16e7b08acb28e52c7cdbd61acf262dfa2158e6939e2fe06694763a`.
The product journey did not start because the one-client window requested the
full `1920` logical client width; Win32 decorations increased its observed
outer width to `1936`, and the existing containment guard correctly rejected
that geometry.

Cleanup then exposed an independent broker defect. The Desktop process and
ports were already absent, but Windows PowerShell emitted progress-only CLIXML
while process and scheduled-task cleanup commands inherited a nonzero status.
The broker treated those diagnostics as resource residue even though the
authoritative postconditions were already satisfied.

The generic runtime-cell correction now:

- derives the client width from the monitor width minus the observed native
  outer-frame width, preserving the product minimum while ensuring the actual
  outer window fits;
- polls process absence as the process-cleanup authority and retains
  fail-closed behavior when the PID remains alive;
- parses PowerShell CLIXML for real error records instead of reporting progress
  records as failures; and
- gives idempotent scheduled-task stop/unregister scripts an explicit successful
  no-op exit while retaining terminating cmdlet failures.

Local evidence:

- Rust Acceptance window tests: 6 PASS;
- focused Windows broker, provisioner, and non-launched fixture-binding tests:
  27 PASS;
- Acceptance Infra boundary tests: 8 PASS;
- Quality Evidence tests: 14 PASS;
- Acceptance validator tests: 20 PASS;
- `acceptance-plan-self`: PASS and selects
  `acceptance-runtime-provisioning-self`;
- `git diff --check` and `cargo fmt --check`: PASS.

The complete `acceptance-runtime-provisioning-self` command retains its known
unrelated baseline failures in stale Agent provisioner contracts, occupied
port `4445`, and launch-context timing tests.
`acceptance-infra-validation` remains blocked by the known latest-run source
mismatch, and `skill-check` remains blocked by the pre-existing review-rules
digest drift.

The failed Windows lease was cleaned by exact run identity. Post-cleanup audit
shows zero Acceptance scheduled tasks, zero Desktop processes, zero listeners
on `3230` and `4645`, no runtime root, and no local runtime-cell state.

NDR-W9-D and Windows NDR-W10-D remain `IMPLEMENTED_UNPROVEN` until the repair
is committed, deployed as exact source, and both
`chat-contact-message-resilience-e2e` and
`chat-native-product-closure-e2e` complete with source-bound evidence.
