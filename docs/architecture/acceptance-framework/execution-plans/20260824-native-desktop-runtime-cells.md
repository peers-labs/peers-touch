# Native Desktop Runtime Cells — Execution Plan

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-24 | **Updated**: 2026-09-13
> **Owner**: Acceptance Infrastructure + Desktop Platform + Chat Domain
> **Branch**: `fix/deploy-env-host-guard`
> **Parent Design**: [../design.md](../design.md)
> **Approved Decisions**: D-13, D-14, D-15, D-16, D-17, D-18

---

## 1. Goal And Claims

### Completed Windows Sixwin Scope (2026-09-10 to 2026-09-11)

The Owner's 2026-09-10 single-host instruction governed the completed Windows
sixwin Goal only. It did not supersede the later NDR-W8 and CA-W6
multi-Station work, which uses the canonical `four` and `fiveArm` profiles.
Historical Windows Gate and provisioner definitions remain host-neutral.

NDR-W1-W7 remain closed Linux history. Single-Station Windows proof must not be
represented as cross-Station or cross-platform proof. Historical evidence and
amendments below remain traceable, not instructions to redeploy historical
hosts.

Current Goal: `6aa2282c0ad37e7b2b10927d`. The Windows sixwin closure is
`DONE/PROVEN` at product source
`283832a7392e071f0d2018cfb3fd85a874744172`; the Goal may be marked complete
after this closure record is committed and its documentation checks pass.

| Remaining Closure | Status / Dependency |
|---|---|
| NDR-W9-D Product Closure | Done: final sixwin run `20260911T171023157955Z-dec53283a4ae9dbb4124c94a00ba6a24` is `PASS/DONE/PROVEN`. |
| Four local Chat Gates | Done: aggregate `20260911T192936233860Z-1619e4066c3880aefc3c47944b0341ad` passed 4/4. |
| Seven other Windows Native Chat Gates | Done: all eight Native Gates, including Product Closure, passed in aggregate `20260911T171022643174Z-8601dca380d9a904041d72fa46bafad6`. |
| PostgreSQL contention/recovery | Done: sixwin-local PostgreSQL 17.11 run `20260911T1915491502940Z-f3a7eb606a6e401980e62336ea6d6524` passed contention, immediate-stop recovery, exact durable readback, post-recovery rerun, and cleanup. |
| Gap Detector | Done: local run `20260911T193242532950Z-bd8db662292312f8b77d200ed7899865` and Native run `20260911T193256473649Z-419aa292e04928879de4fd65050a1c4a` are `PROVEN` with zero gaps. |
| Completion audit | Done: Windows audit `20260911T193908424196Z-daccebe8f7c6c434bcc1e07c767562b9` is `PASS/DONE/PROVEN`. |

All 12 final matrix Gate results and the three closing activities are complete
for the Owner-approved Windows sixwin scope. This does not reopen or extend the
scope to macOS, historical Linux work, or historical distinct-Station claims.

Concurrency Decision: hybrid. The integrator owns all source/plan writes,
commits, builds, profiles, Fixture mutation, GUI, and final Gate execution.
A read-only lane may inventory PostgreSQL and final-audit commands while the
integrator fixes broker restart preservation. No concurrent Gate or deployment
may consume sixwin's exclusive runtime. Reconcile findings before execution.

Prior authoritative run:
`20260910T225056619096Z-1e934531b5fb953335efbe6e212d2366`,
source `6ab9c369506b14162de7fbac1f0d587e5f874292`. It proves attachment
count conservation, image rendering, and exact sender/receiver byte hashes.
It fails Bob restart with `auth_restore_session: session_missing`; cleanup
passes. Inspection finds `stop_actor(preserveState=True)` still deletes the
actor control root containing storage. Repair lifecycle preservation and
relaunch ownership in the Windows broker, not authentication or Gate assertions.

2026-09-11 corrective checkpoint:

- Broker launch files now live under `actors/<run>/<client>/control`;
  preserving a client removes only that control subtree. Final stop/lease
  cleanup still removes the actor root. Failed relaunch retains existing
  storage for retry or lease cleanup.
- Broker/provisioner/Win32 tests: 52 passed. Runtime binding and Chat static
  cohort: 115 passed. Infra boundary: 8 passed. Planner self-check passed.
- Local four-Gate aggregate
  `20260911T042824149640Z-e65f3ce62f4af192526c3e8af679a64e`: all passed
  on the corrective dirty source. This is not final clean-source matrix proof.
- PostgreSQL read-only inventory: local test DSNs are unset and PostgreSQL
  executables were not found in checked locations. Existing Postgres tests
  cover attachment quota contention, canonical indexes, competing dispatchers,
  and concurrent inbox exactly-once behavior. Independent PostgreSQL restart
  recovery proof is still missing; client recovery/SQLite cannot substitute.
- Ready: commit the verified correction and rerun Product Closure only.
  Parked by dependency: seven other Native Gates, final frozen-source matrix,
  local PostgreSQL evidence, Gap Detector and completion audit. No push.

Latest authoritative run:
`20260911T045324047847Z-6ca265061291ef49f14f993fb0501c0a`,
source `75b0fb9ea03a658ef43ee89dbfcd6715972485e9`. Attachments,
`offline_recovery_exact`, `restart_exact` and `settings_restart_recovery`
pass. First failure is restoring the clear-history cursor to zero. Station's
member-settings service rejects this existing restore action as a backwards
cursor; its error also causes the failed unhandled-rejection log audit.
Processes, ports and storage cleanup pass.

The focused persistent composition regression reproduces the same rejection,
then passes after allowing the explicit zero restore while retaining negative
and non-zero backwards-cursor rejection and active-member authorization.
Conversation's full race suite and all four local Chat Gates pass.
The reviewed Agent runtime matrix uses CRLF after Windows checkout; enforcing
the repository's existing `eol=lf` convention restores its original reviewed
SHA-256 without changing the contract. Infra validation
`20260911T055916897553Z-97305cd3ce920c2d552ea6781f9d43dd` is
`STRUCTURALLY_VALID`.

Two preceding runs stopped in display preflight when SPICE auto-resized QXL
away from the required 1920x1080. The successful preflight used a bounded local
operator wrapper to pause SPICE VDAgent for the Gate and restore its prior
service/display state in `finally`; service restoration was verified.
This is runtime setup only, not a relaxed Gate geometry requirement.
Next: commit the cursor/line-ending correction, rerun Product Closure with
fixed display setup, then advance to the seven queued Native Gates.

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

- During implementation, run the four source-relevant local Chat Gates once
  after each code revision, then run only the Windows Native Gate that owns the
  current product boundary.
- On the final source, run the approved 12-Gate Windows IM Chat matrix:
  `station-messaging-unit`, `messaging-platform-contract`, `desktop-check`,
  `chat-native-visible-static`, and all eight Windows Native Chat Gates.
- Keep Proto, Desktop gateway, Acceptance Infra, runtime-provisioning,
  dev-runtime-isolation, and planner self-validation Gates conditional on
  their owned source paths. They are not repeated Windows product proof.
- Keep the historical MP-W11 closure audits attached to the Linux 22-Gate
  record. Windows closure uses the approved matrix result plus Gap Detector
  instead of reusing MP-W11's hard-coded 22-Gate audit.
- Exclude standalone Federation, Applet, Agent, and Mobile Gates. Cross-Station
  transport remains in scope only where a Chat Gate directly exercises it.
- Alice and Bob on sixwin bind explicitly to the single runtime-selected
  `station-primary` through the D-18 manifest contract.
- Product assertions use platform-neutral DOM/WebDriver paths; only the
  adapter and runtime binding are Windows-specific.
- Capture immutable evidence: screenshots, DOM snapshots, native window
  diagnostics, attachment counts, cleanup audit.
- Collect W10-D Windows binding evidence: manifest, Station
  attestations, binding-proof tuple closure, live identity verification.

Evidence:

- Source-matched final run with all four local Chat Gates and all eight Windows
  Native Chat Gates reaching `DONE/PROVEN`.
- Win32 adapter native diagnostics (window stack, focus, screenshot) captured.
- Complete per-client/per-generation Station binding proof for this topology.
- Cleanup audit shows all remote processes terminated and storage wiped.
- Gap Detector reports zero gaps for the approved Windows matrix.

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
  both binding to the runtime-selected local `station-primary`.
- Same binding-proof tuple closure and live identity verification as Linux.
- Distinct-Station and cross-Station claims are outside the Owner's current
  single-Station execution scope and remain unproven by these runs.

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
- **Status**: partial — current single-Station Windows run passes through
  `client.restart.ui`; Product Closure stops at `clear.cursor.restart.ui`.
  See the current Windows execution scope and corrective checkpoint above.

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
| Windows Product Closure fails after runtime readiness | Preserve the first product failure independently from cleanup/readiness failures; keep Windows `PARTIAL/UNPROVEN` until the complete source-bound Gate passes |

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
| NDR-W8 macOS regression | done for selected `four` / `fiveArm` scope | W8A, W8B, and W8C are `PASS/DONE/PROVEN` on exact source. W8C run `20260914T122113394691Z-416c2c7dc23f80a5595eb90f8f9e06c2` at `13d867e8fb17d7dd3c3c83d411be25a158af73ee` proves the complete three-client Group/MLS journey and cleanup. |
| NDR-W8A submitted-command reconciliation | done | MP-D31 contract, generated bindings, authenticated `/conversation/command/results`, canonical receipt/outbox/exact Device Inbox resolver, transactional hard-cut migration from historical payload-hash result IDs, deterministic endpoint/command result identity, and Device Engine startup reconciliation are implemented. Exact-source macOS Native Gate `20260913T164933497898Z-87194509f71e18677704f12aea7e5805` is `PASS/DONE/PROVEN` at `638679c0e54a2c657fa208cff390210d6fa47322`: generated command `01M2DTWRTS6JBMBSN4WTKSHX5Q` / message `01M2DTWRQ7FVRJ24EZRQB3V7X9` retained exact identity and bytes, converged to committed/delivered authority truth, rendered on Bob, and released both clients and all six ports. |
| NDR-W8B federated ephemeral typing | done | Exact-source run `20260914T000309707403Z-c776902fe848cc9d8c9236b9ec1f437a` at `08e13a19e4c2e91e5c97411a3c866a8e25d98af4` is `PASS/DONE/PROVEN` across Direct/Group typing lifecycle, removed-member and revoked-device rejection, zero durable typing writes, three Native clients, two Stations, and cleanup. |
| NDR-W8C federated contact identity and Group genesis reliability | done | Exact-source run `20260914T122113394691Z-416c2c7dc23f80a5595eb90f8f9e06c2` at `13d867e8fb17d7dd3c3c83d411be25a158af73ee` is `PASS/DONE/PROVEN`: identity/avatar/contact parity, visible Group creation, encrypted delivery, Bob restart recovery, Charlie removal, retained-recipient convergence, and reverse cleanup all pass. |
| NDR-W9 Windows cell | done for Windows sixwin scope | Product Closure run `20260911T171023157955Z-dec53283a4ae9dbb4124c94a00ba6a24` is `PASS/DONE/PROVEN` at clean source `283832a7`; runtime identity, 1920x1080 Win32 evidence, Station binding, and cleanup are proven. |
| NDR-W10 D-18 binding infrastructure | done for current Windows single-Station scope | Eight-Gate Native aggregate `20260911T171022643174Z-8601dca380d9a904041d72fa46bafad6`, PostgreSQL run `20260911T1915491502940Z-f3a7eb606a6e401980e62336ea6d6524`, two zero-gap reports, and audit `20260911T193908424196Z-daccebe8f7c6c434bcc1e07c767562b9` close the Owner-approved sixwin scope. Historical distinct-Station claims remain outside this closure. |

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
- W9-D: product gate execution and proof (approved 12-Gate Windows IM Chat
  matrix).

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
approved Windows IM Chat matrix, and W10-D Windows multi-Station product
evidence were not executed. W9-D and the Windows portion of W10-D therefore
remain `UNPROVEN`.

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

The Gap Detector correctly remained `UNPROVEN`: the post-fix Windows product
Gate and the then-required 22-Gate matrix had not run. The
2026-09-05 matrix amendment below supersedes that Windows scheduling rule
without changing this historical evidence result.

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
   remaining approved Windows Native Chat Gates, Gap Detector, and cleanup
   audit.

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

Commit `68525d60edd1fe854207c6d83a65d23cf9db98c2` deployed the first repair to
both Stations and the Windows cell. Both Stations reported that commit, one
connected DHT seed, ten connected routing peers, and distinct peer identities
after their dedicated environments were restored.

Windows resilience run
`20260904T124259635040Z-3530889547fb3cbcce5b918a935e35ec` reached
`FIXTURE_READY` with Alice bound to station-four and Bob bound to station-five,
then failed before the cell reached `LEASED`. The exact Windows binary had
SHA-256
`84b61d10227399c1b47ec8a89f804ab98791fc783e71752d59326d72013a02f0`.
The probe process remained live, and its startup log proved:

- WebDriver listened on `127.0.0.1:4645`;
- the Desktop HTTP Gateway listened on `127.0.0.1:3230`;
- the frontend reached its account gate; and
- the prior `1936 > 1920` geometry panic did not recur.

The generic SSH loopback probe nevertheless reported both ports closed. A
same-binary diagnostic measured the cause: the Windows encoded-PowerShell plus
Python probe exceeded its inherited two-second default and returned false at
approximately `2.01s`; the identical probe succeeded in approximately `3.11s`
with a five-second budget. The transport now selects a five-second default for
Windows and retains the two-second POSIX default while preserving every
explicit caller timeout.

Focused evidence after the transport correction:

- SSH transport, Windows broker, Windows provisioner, and fixture-binding
  tests: 32 PASS;
- Acceptance Infra boundary, validator, and Quality Evidence tests:
  8 + 20 + 14 PASS;
- live exact-binary Windows probe: WebDriver and Gateway both reachable with
  the five-second budget;
- probe cleanup: process, task, ports, and storage all released.

The Gate remains `PARTIAL/UNPROVEN`; the next exact-source Windows rerun must
cross cell `LEASED` and execute the peer-bound failure assertion.

Commit `6a2b95ed27568f29107c7d228955da68134f77ce` then passed the Windows
runtime-cell boundary. Run
`20260904T142201550359Z-560ba6d3b78abb99c5baed8b46eead6c` produced:

- cell state `LEASED`;
- binary SHA-256
  `16641815f71799155b1b3a22871658d32321a2e9fa076368f2b878b1ee53ed0f`;
- Windows 10/WebView2/Win32 input and screenshot readiness;
- source-bound Alice generation-1 binding proof to station-four; and
- complete process, task, tunnel, port, storage, source, and lease cleanup.

The Gate then failed at its first product-runner check because Windows WebView2
reported the native Tauri URL as `http://tauri.localhost/`, while seven Native
Chat runners accepted only the macOS/Linux form `tauri://localhost`. This was a
Gate portability defect, not a product failure. A shared strict predicate now
accepts only those two platform-owned Tauri origins and rejects browser,
credential-bearing, alternate-scheme, and explicit-port URLs. All affected
Native Chat runners consume that predicate.

Focused native runner and static tests: 74 PASS. The strengthened peer-bound
Direct-open assertion remains `UNPROVEN` until the corrected Gate reaches that
assertion on an exact-source Windows run.

### 2026-09-04 Windows Contact Proof And Group Genesis Diagnosis

Exact-source Windows contact resilience run
`20260904T145100838344Z-f1e1da7b20a68224fb59b14216e58c21` reached
`PASS/DONE/PROVEN`. It proves that selecting Bob's Message action immediately
opens Bob's peer-bound intent pane and keeps Direct creation failure inline and
retryable. A generic empty pane, Chat-tab-only switch, or toast-only failure no
longer satisfies the Gate.

Windows Product Closure run
`20260904T151711681542Z-3568aa0eeacb4485ce4fdfd042393ed1`
at source `07290b4bfd55d74922f215329632fab0ba4ef178` and binary SHA-256
`f3fc60bf8a81234adcf7e4fb2919f9b7d7fe9b73d8b5cc86ccfdfbaab064c4b2`
proved:

- Windows 10, WebView2, Win32 input, and 1920x1080 runtime identity;
- Alice generation 1 bound to station-four and Bob generation 1 bound to
  station-five;
- exact cross-Station Direct creation and repeat reopen of
  `d-f4d4aaa25c831bb05fdd53cd1cdd6120`; and
- process, port, storage, endpoint, tunnel, and lease cleanup.

The run remains `PARTIAL/UNPROVEN` for two independent reasons:

1. The primary product failure is `group.create.ui`: Alice never projected a
   ready MLS group, so transcript and pane-owned overlay assertions were not
   reached.
2. Runtime-log cleanliness failed because Bob's Home Station returned
   `active conversation membership required` for legacy member-settings reads.
   This is the proposed MP-D29 follower-membership gap and is not implemented
   by this execution slice.

The canonical report incorrectly replaced the primary group timeout with the
later runtime-log cleanup failure. The Chat business Gate now records
`firstFailedStep`, persists its step ledger, and uses the shared
primary-failure-preserving cleanup helper so both failures remain visible.

Group diagnosis found an accepted-architecture implementation defect rather
than an MP-D29 dependency. Group prepare resolved Bob's signed remote endpoint
manifest and claimed his remote KeyPackage, but commit revalidation rebuilt the
participant set from station-four's local `actor_devices`. Shared delivery-set
construction then applied the same local-only filter. The local correction:

- resolves current signed manifests before the authority transaction;
- compares them with the exact plan snapshots;
- derives remote participant endpoints from those manifests;
- retains local `actor_devices` as the immediate revocation authority only for
  actors whose signed manifest identifies the current Station as Home Station;
  and
- proves a manifest-only remote Bob can commit group genesis sequence 1/2 and
  produce two remote federation outbox rows while the stale-local-device
  rejection remains intact.

Local verification passes:

- Station Messaging subserver packages;
- Station Messaging application and infrastructure race tests;
- 174 Native identity/runtime/product static tests;
- two Desktop Rust `group_creation_` tests;
- Desktop TypeScript check;
- Acceptance plan self-check, planner tests, validator tests, Infra boundary
  tests, Gap Detector tests, and Quality Evidence tests; and
- Go style, Python compilation, and `git diff --check`.

Known unchanged baseline failures remain explicit:

- Chat and Infra validation reject the latest evidence because its source no
  longer matches the dirty working tree;
- Acceptance runner tests retain stale Core API expectations;
- runtime-provisioning self-tests retain stale Agent provisioner contracts and
  launch-context timing failures; and
- coverage-report tests reject non-current evidence.

Commit `1f8a0a3625e3dbbcd791b2e3389727a8ea2ffd6f` contains the correction
and was deployed by exact Git-object sync to station-four and station-five.
Windows run
`20260904T170550632438Z-86c08bfd4c710aac4cd6efce33ada3e6`
then synchronized and built the same source on sixwin, producing binary
SHA-256
`6675bdf135fc7f06d75052f40345588a561cbfddcbb73e0ae04cc632231154d3`.
It proved the Windows cell, both client bindings, the Bob-bound inline failure
pane, first-failure attribution, runtime-log cleanliness, and complete cleanup.

The run failed at `conversation.search.ui` before group creation. Preserved
debug evidence records `create-direct-start` followed by Station 500.
station-four logged the matching authenticated
`POST /messaging/conversation/direct`, while its bootstrap state reported
`seeds=0`, an empty DHT routing table, and Relay disabled. The product failure
therefore came from a deployment-topology regression: `make station` recreated
both disposable containers with the shared `station.env` instead of the saved
`chat-native-four.env` and `chat-native-five.env`.

The saved environments were reapplied to both exact-source containers. Each
Station then reported Relay enabled, one configured and connected seed, ten
connected routing peers, and its original distinct peer identity. A first
comparison attempt
`20260904T174414332612Z-eb639f2a778332815b31a4d9da96ea94`
correctly stopped before Windows source sync because the mandatory tracked
debug record made the local worktree dirty; Provisioner cleanup passed.

The next comparison run must use a clean commit containing this checkpoint and
the open debug record. MP-D29 remains proposed and out of scope until Owner
acceptance.

### 2026-09-04 Windows Group Genesis Proof And Focus Sequencing

After exact deployment of checkpoint commit
`491ed6b2b4e248baa58cc26951d5176c4bbf0887` and restoration of the
dedicated Relay/DHT environments, Windows run
`20260904T174913706510Z-285038c7784e15b141f511170e839a0e`
passed `conversation.search.ui` and `group.create.ui`. Station evidence records:

- `POST /messaging/group/genesis/prepare` returning 200;
- `POST /messaging/command/submit` returning 200; and
- remote device-queue acknowledgements after the committed genesis.

This is source-bound proof that the manifest-only remote-member correction
crosses the previous `StaleAuthorityPlan` boundary. The run then failed at
`transcript.thread.ui` before the composer click because
`focus_actor_window()` timed out. Runtime-log cleanliness independently failed
on the known MP-D29 membership marker; process, port, storage, endpoint,
tunnel, source, and lease cleanup passed.

Unchanged-source run
`20260904T182736117079Z-d7f0149e23b90392e96db7ce6ff69ed3`
reproduced the same focus timeout earlier at `conversation.search.ui`.
Diagnostics from both runs show the WebView focused immediately after native
activation, followed by foreground focus moving to unrelated Windows
processes while diagnostic and point-ownership probes ran before the later
focus check. This classifies the failure as a Windows Gate activation-ordering
defect rather than a Chat product regression.

The Gate correction verifies point ownership before activation, checks WebView
focus without an intervening native probe, returns immediately on successful
activation, and retains the title-bar click plus terminal diagnostic only as a
fallback. Focused Native Product Closure and Runtime Cell tests pass
58 + 45. Exact-source Windows verification of this Gate correction remains
pending.

### 2026-09-04 Windows Focus Proof And MP-D29 Runtime Boundary

Exact-source Windows Product Closure run
`20260904T190332370979Z-f9793309fcd5ad79ac955d4bad864acd`
executed commit `9e7faa577bc8a7ffd3e710f365442a51140625c2` and binary
SHA-256
`f3bb7159ba06983561f269cccc710e4ad64cbc811ec645585bcaaa3861653122`.
The runtime remained Windows 10 x64 with WebView2 `152.0.4191.62`, Win32
`SendInput`, a connected `1920x1080` output, and distinct source-attested
bindings from Alice to station-four and Bob to station-five.

The run passed:

- `alice.launch`;
- `bob.launch`;
- `conversation.search.ui`, including exact Direct creation and repeat reopen;
- `group.create.ui`, including group genesis and remote queue acknowledgement;
  and
- Alice's first group transcript send and Bob's visible receipt.

This crosses both former focus timeout locations and source-binds the Windows
focus-ordering correction. The first failed step remained
`transcript.thread.ui`, but the new failure occurred after Bob received Alice's
message: Bob's outbound group send returned
`messaging_send_outcome:not_queued:draft`, and the Gate timed out waiting for
Bob's own visible message.

Read-only Station evidence for group
`2ef5bd8d-492b-46fe-b342-d74498d3bd04` establishes the boundary:

- station-four contains two active members, three authority events, three
  delivered federation outbox frames, and three acknowledged local queue
  items;
- station-five received the three federation frames and Bob acknowledged all
  three queue items;
- station-five contains zero authority events and zero conversation membership
  rows for the group; and
- Bob's client repeatedly receives `active conversation membership required`
  and projects `group:0`.

This confirms the proposed MP-D29 authority-signed follower-membership gap.
Device delivery is healthy enough for Bob to receive Alice's message, but
station-five cannot authorize Bob as a sender without a verified follower
membership projection. A UI retry, local client cache, or Gate relaxation
would bypass Station ownership and is forbidden.

The canonical report is `FAIL/PARTIAL/UNPROVEN`, with
`firstFailedStep=transcript.thread.ui`. Runtime-log cleanliness independently
fails on the same membership marker. Process, port, storage, endpoint, tunnel,
source-workspace, and GUI-lease cleanup all passed.

NDR-W9-D and Windows NDR-W10-D remain blocked at the MP-D29 implementation
boundary. Owner accepted MP-D29 on 2026-09-05; its protocol, persistence,
projection, authorization cutover, and proof remain pending. The remaining
Product Closure assertions and dependent Windows matrix proof cannot be claimed
from this partial run.

### 2026-09-05 Focused Windows Closure Audit

The focused change range
`07290b4bfd55d74922f215329632fab0ba4ef178...e75171754a7cec83e9125a74a296beb2275a2e8d`
produced Acceptance plan
`20260904T195300472275Z-721af034a9428a621b99e6b29884a5a6`.
Its local CI aggregate
`20260904T195308139055Z-41b97b7fbdbb200b8650bee260e337df`
passed five of seven dependency-ready Gates:

- `station-messaging-unit`;
- `messaging-platform-contract`;
- `desktop-check`;
- `chat-native-visible-static`; and
- `acceptance-plan-self`.

Two existing framework-wide checks remain failed and unproven:

- `acceptance-infra-validation` rejected the previously published Acceptance
  run because its source did not match the current documentation checkpoint;
- `acceptance-runtime-provisioning-self` retained five errors and four failures
  in stale Agent provisioner contracts and launch-context timeout tests. None
  of those failures touch the six-file Chat correction range.

The focused Gap Detector therefore returns `UNPROVEN`. In addition to those two
framework baselines, `chat-native-interactions-e2e` has no Windows evidence for
this source, and `chat-native-product-closure-e2e` remains
`FAIL/PARTIAL/UNPROVEN` in the separate exact-source run above.

Completion audit result: the focus-ordering and group-genesis corrections are
ready for review with source-bound Windows evidence, but NDR-W9-D and Windows
NDR-W10-D are not complete. Owner accepted MP-D29 on 2026-09-05; its separate
implementation closure and a fresh exact-source Windows product matrix remain.
Repeating destructive fixture resets before the implementation lands would
only reproduce the same known authority boundary.

### 2026-09-05 Approved Windows IM Chat Acceptance Matrix

The Owner approved replacing repeated Windows execution of the historical
MP-W11 22-Gate bundle with a Chat-scoped, change-aware matrix. This amendment
changes execution cost and Gate scheduling only; it does not weaken any Chat
product assertion or reuse evidence across runtime cells.

#### Iteration Matrix

After a source revision, run these four local Gates once:

1. `station-messaging-unit`;
2. `messaging-platform-contract`;
3. `desktop-check`; and
4. `chat-native-visible-static`.

During diagnosis, run only the Windows Native Gate that owns the first current
product failure. Stop at that boundary, diagnose it, and do not repeatedly run
unaffected Native journeys.

#### Final Windows Matrix

On the final exact source, the four local Gates above and these eight Windows
Native Chat Gates must reach `DONE/PROVEN`:

1. `chat-native-product-closure-e2e`;
2. `chat-native-two-client-e2e`;
3. `chat-native-interactions-e2e`;
4. `chat-contact-message-resilience-e2e`;
5. `chat-native-typing-e2e`;
6. `chat-native-multi-device-e2e`;
7. `chat-native-recovery-e2e`; and
8. `chat-native-group-mls-e2e`.

The final matrix also requires exact source/build/runtime identity, explicit
Alice and Bob Station bindings, reverse-order cleanup, and a zero-gap Gap
Detector result.

#### Conditional Gates

The following Gates run only when their owned source changes:

- `proto-build`: Chat Proto changes;
- `chat-desktop-gateway-e2e`: login, Desktop gateway, or Rust messaging gateway
  changes;
- `acceptance-plan-self`: Registry, Gate Catalog, or planner changes;
- `acceptance-infra-validation`: generic Acceptance Infra changes;
- `acceptance-runtime-provisioning-self`: generic provisioning or
  launch-context changes; and
- `desktop-dev-runtime-isolation-static`: Desktop runtime isolation changes.

Their failure cannot block W9-D or W10-D when the relevant owned source is
outside the focused Chat change range.

`federation-desktop-gateway-smoke` is removed from the W9-D/W10-D matrix.
Standalone Federation, Applet, Agent, and Mobile proof remains out of scope.
The historical Linux MP-W11 22/22 aggregate and its
`chat-w11-completion-audit` remain immutable evidence for that completed
closure; they are not a template for repeated Windows execution.

### 2026-09-05 MP-D29 Owner Acceptance And MP-W14 Handoff

The Owner continued from the explicit MP-D29 design gate, accepting the
authority-signed Home Station follower membership architecture. The canonical
decision is `MP-D29` in
`docs/architecture/messaging-platform/decisions.md`; implementation is tracked
as `MP-W14` in
`docs/architecture/messaging-platform/execution-plans/20260808-messaging-platform.md`.

NDR-W9-D and Windows NDR-W10-D now depend on `MP-W14-E`. They remain
`PARTIAL/UNPROVEN` until the locally verified MP-W14 A-D source is committed,
deployed, and the approved Windows matrix passes at that exact source. No
additional destructive Windows rerun is useful before that deployment.

### 2026-09-05 MP-W14 A-D Local Verification

MP-W14 A-D now implement the accepted authority-signed follower-membership
boundary across Proto, Station, Desktop Rust, Desktop Web, and direct Mobile
generated Chat contracts. The final local Chat aggregate
`20260905T045308233830Z-d8262898db418a6fcfd179ce939fe8f8` passed all four
approved iteration Gates plus the source-owned conditional `proto-build` Gate.

Focused tests additionally pass for follower pagination/restart, final-removal
ACK ordering, live/replay head races, device-first trust isolation, exact-next
atomic device ingest, routed conversation creation, Engine thread counts,
typed member settings, group genesis, membership transition, and Messaging
Core. Legacy Conversation thread/settings contracts and runtime paths have
zero live references; endpoint-private payload remains opaque in production
Station follower code.

This local implementation was committed as
`f04e0dfd68513ab8d249a5cfe0ed93645d189536`. `MP-W14-E`, NDR-W9-D, and the
Windows portion of NDR-W10-D remain `PARTIAL/UNPROVEN`; current runtime evidence
is recorded below.

### 2026-09-05 MP-W14-E Windows Runtime Checkpoint

The first exact-source Product Closure run
`20260905T105928664207Z-cf73c7b7f1b9d3e05a34ce9b305e248c` used binary
SHA-256
`b3904e78de213428e1efe2fdd964eba5f1c80940e8593fa648cafc42405046df`
but failed at `conversation.search.ui`. Deployment had recreated both
disposable Stations through the shared `station.env`, disabling the Relay
client and removing DHT bootstrap configuration. Dedicated per-Station
environments and fresh Relay invites restored both Stations to `ready=true`,
one connected seed, twelve routing peers, and stable Relay streams.

The unchanged-source comparison run
`20260905T114725741869Z-8894cc822a6bd05b8f187403b0c557e3` used binary
SHA-256
`6b104889e266dda2f4b8f714b8214befb935ff4ad381cbfc9f0b39afb1150108`.
It proved:

- Windows WebView2/Win32 runtime identity and distinct Alice/Bob Station
  bindings at exact source `f04e0dfd68513ab8d249a5cfe0ed93645d189536`;
- Direct create and repeat reopen for
  `d-f4d4aaa25c831bb05fdd53cd1cdd6120`;
- station-five follower group
  `ffebb1c2-e3e0-4ec8-b181-7ebee91ca088` `ACTIVE` at sequence 3, with Alice
  and Bob active, three applied receipts, and no pending gap;
- Bob's typed member-settings reads and group typing authorization; and
- complete process, port, storage, endpoint, tunnel, source-workspace, and GUI
  lease cleanup.

The first failed step remains `transcript.thread.ui`: Bob's reply stayed as a
durable draft because station-five's authenticated
`POST /messaging/command/prepare` was forwarded to station-four, where
`POST /messaging/federation/command/prepare` returned
`messaging: record not found`. Runtime and source inspection identify the
remaining implementation defect: the federated authority prepare handler and
authority send preparation still validate Bob's remote endpoint through
station-four's local device directory. MP-D19 already requires cross-Station
prepare to consume the verified signed endpoint manifest, which station-four
has for Bob.

The approved correction scope is limited to replacing those remote-sender
local-device assumptions with verified manifest endpoint/Home Station
validation, retaining local-device authorization for local requests, and
adding focused handler/service regressions. The four local Chat Gates must pass
before another exact-source deployment and targeted Product Closure rerun.
The remaining seven Windows Native Chat Gates stay dependency-blocked.

The approved local correction now passes focused handler and repository-backed
manifest-only sender regressions plus the complete reduced local cohort:

- `station-messaging-unit`:
  `20260905T125516955785Z-e8f094e0ace831b5792a8ff08d1541d9`;
- `messaging-platform-contract`:
  `20260905T125521976036Z-c0638e8eee6bb7f5f07e1fba09694e61`;
- `desktop-check`:
  `20260905T125523518414Z-39d1d3533889126902b9de8b3add3ece`;
- `chat-native-visible-static`:
  `20260905T125533060955Z-e1f590673dc9b35dad98b5dcbd96f11e`;
- aggregate:
  `20260905T125516816692Z-a1fe8cb980506bd4e86592a5e451136e`.

The correction is committed in this checkpoint but not yet deployed. Windows
Product Closure and the remaining seven Windows Native Chat Gates remain
`UNPROVEN`.

### 2026-09-07 Conversation Authority Blocking Subplan

NDR-W9-D and the Windows portion of NDR-W10-D remain the main delivery target.
Their next exact-source runtime run is dependency-blocked by CA-W5 in
`docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md`.
CA-W5 is a blocking implementation subplan, not a replacement for this plan.

The Owner accepted AO-D07 on 2026-09-07. It defines caller-owned creation
identity, Station-derived authority scope, plan-bound group genesis,
local-versus-remote command submission, one committed `ConversationEvent`, and
exact-response replay for destructive Key Exchange reads. The accepted amendment is
`docs/architecture/api-ownership/proposals/20260907-ca-w5-canonical-wire-contract-amendment.md`.

CA-W5 reached a locally verified source checkpoint on 2026-09-07. The AO-D07
protobuf cut, production owner composition, Desktop/Mobile/Messaging Core
consumer migration, remote KeyPackage and attachment paths, and retired
Messaging/Envelope/engine deletion are present in the checkpoint. Source-bound runs
`20260907T095814186121Z-b39852f3e6f655416a20f3194dc3699d` (`proto-build`),
`20260907T095552389681Z-9035a2fbed82ec5a54b98f5b260fe383`
(`station-api-ownership`), `20260907T095534375916Z-3761b27ef989ec4449bf94b82a4a2523`
(`station-messaging-unit`), `20260907T095650555959Z-0f85322adf5c78105d9ca8f15a4a351b`
(`messaging-platform-contract`), and
`20260907T095738644264Z-aa04882b997b2eeb5f7e9b2001600a10`
(`desktop-check`), and
`20260907T100757881125Z-070fde35dba471e1da0351dc8d030cb0`
(`chat-native-visible-static`) pass.

The next dependency-ready step is a local CA-W5 checkpoint commit followed by
CA-W6 exact-source deployment to `station-four`, `station-five`, and `sixwin`.
The Acceptance Gap Detector keeps the delivery claim `UNPROVEN` until those
native receiver/runtime cells execute. Windows Product Closure, Windows
multi-Station Chat proof, and PostgreSQL contention remain `UNPROVEN`; macOS
W8 remains deferred.

### 2026-09-07 MP-D19 Direct Creation Repair

The first exact-source CA-W6 Product Closure run
`20260907T133530851900Z-830bccbed36ac0ab6ef14c7edc0fce4e` at
`13c4db5fbceeb4a3b8aa16b7b6322eac8120f8f3` proved both Actor Device
enrollments, Bob's exact contact result, the peer-bound Direct intent pane, and
complete Windows cleanup. It failed before the first Conversation commit
because station-four attempted to resolve Bob through its local
`actor_devices` table. Both Stations therefore retained zero Conversation
rows, events, and receipts.

The local correction restores MP-D19 semantics without restoring a Messaging
facade or remote-device shadow truth:

- Actor Identity exposes the authoritative Home Station projection and owns
  manifest shape, lifetime, and monotonic directory-version validation.
- Conversation resolves local and remote signed manifests before entering the
  authority transaction and derives one canonical endpoint-route snapshot.
- Direct creation receives that verified snapshot, revalidates only the local
  creator inside the serialized UOW, verifies every Home Station against the
  explicit Federation, and atomically derives participants, devices, local
  Device Inbox effects, remote Federation outbox effects, and receipts.
- Exact committed replay remains independent of a current manifest. Existing
  authority or follower Direct projections reopen without fabricating a new
  committed event, including Social-effect retries after device churn.
  Authority genesis and follower genesis share one per-conversation
  serialization key so an unlocked pre-read cannot create dual ownership.
- Focused regression coverage includes a remote peer absent from the authority
  Station's `actor_devices`, inactive local creator, inactive Federation
  membership, missing remote routes, wrong Home Station, expiry, invalid
  Station signature, empty active endpoints, and signed directory-version
  rollback.

The final source-bound local runs pass:

- `station-messaging-unit`:
  `20260907T152620155080Z-e1634ee32f057ea713a47779f742ebdf`;
- `messaging-platform-contract`:
  `20260907T152641658782Z-820c1b228f33055db17571169aa36bbb`;
- `desktop-check`:
  `20260907T152705410838Z-6c9da0c7b111757b193dcf19ec65c60f`;
- `chat-native-visible-static`:
  `20260907T152750424893Z-55874925b41558664add686c43f7fe21`;
- `station-api-ownership`:
  `20260907T152813555922Z-528ab70b741c0ba752dd5265971439fa`;
- focused Actor Identity, Conversation, and shared Federation race suites,
  focused `go vet`, Mobile full check, Go style, and `git diff --check`.

The repair was committed as
`a008a1c3282c3cbdc5c2bb36dc7c3286f92b452a` and deployed exactly to the two
disposable Stations and sixwin. Windows Product Closure run
`20260907T153750428899Z-90da421fea631aa9b0f51ae3b958df1f`, with binary
SHA-256
`3925e2d5bb831937f8668261fd9a6bb5255a2b6747686e54fbf690aab635d54f`,
proved that Direct creation now commits through the signed endpoint-manifest
path. Both clients later projected one Direct conversation. The run still
failed at `conversation.search.ui` because the Desktop Device Messaging Engine
applied the Group-only owner-role invariant to the canonical Direct creation
event: Direct members are both `MEMBER`, while the local inbox validator
required one `OWNER`. The synchronous drain therefore returned an error after
the authority commit and left the UI intent in its failed state. Runtime and
provisioner cleanup reached `DONE/PROVEN`.

The local correction makes Direct and Group projection admission explicit:
Direct requires exactly two sorted `MEMBER` participants and deterministic
owner metadata; Group retains exactly one matching `OWNER`. Station bootstrap
uses the same kind-specific role projection instead of inventing Direct
ownership. The approved local matrix passes at the corrected working tree:

- `station-messaging-unit`:
  `20260907T162201940480Z-ef80f18031688cbc36e95116b914a62e`;
- `messaging-platform-contract`:
  `20260907T162220659277Z-75ade6a5e23284b518a19e8793f7a97e`;
- `desktop-check`:
  `20260907T162250297926Z-b0986d285384583575acedb4b90a8302`;
- `chat-native-visible-static`:
  `20260907T162311315463Z-728ed72316862d015983e93b23cd90aa`.

Desktop native `cargo check --features acceptance-webdriver` and
`git diff --check` also pass. The focused Desktop binary unit-test target is
blocked by unrelated pre-existing Auth test-only import/type errors. Windows
Product Closure, the remaining seven Windows Native Chat Gates, Windows
multi-Station closure, and PostgreSQL contention remain `UNPROVEN` pending a
new exact-source checkpoint and rerun.

### 2026-09-07 Group Create Gate Synchronization

The Direct projection-role correction was committed as
`b7c310b6f29c53a9e50278f417a1bed13cce3b7b` and deployed exactly to
station-four, station-five, and sixwin. Windows Product Closure run
`20260907T162910781782Z-6bab8cef6910f9f82faeae965d0eb0fc`, with binary
SHA-256
`6d3dc23d65372963e5c7601bdb24556ed6c109a7e81ff239749f9e3921e06070`,
proved the first Direct open, deterministic repeated reopen, one active pane,
distinct client-to-Station bindings, and complete cleanup.

The first subsequent failure was `group.create.ui`: Alice never reached an
active MLS Group. Station and Desktop evidence isolate this as a Gate
synchronization defect rather than a product failure:

- station-four contains only the proven Direct and station-five contains no
  Conversation row;
- no `/conversation/group/prepare` request reached Station;
- no frontend `createGroup failed` signal or validation feedback was emitted;
- the Gate clicked the contact and immediately clicked submit without waiting
  for React to commit `aria-pressed="true"` and enable the submit control.

The Gate now waits for both committed UI states before the native submit click.
It preserves the existing Group product assertions and captures bounded DOM,
screenshot, modal, pane, and submit diagnostics on timeout. The focused
synchronization test passes, and the approved local matrix passes in fresh
Evidence Store runs:

- `station-messaging-unit`:
  `20260907T171455773732Z-45ff86e160d98743abc4293f4bab99fd`;
- `messaging-platform-contract`:
  `20260907T171455773750Z-ac295bc48df5b5c147413cd6c3a6d9d9`;
- `desktop-check`:
  `20260907T171455773766Z-7a236d1a2c3514b2da8b0e80290de1cd`;
- `chat-native-visible-static`:
  `20260907T171455773563Z-97c990c064491a98b727cfe253fbcdcf`.

The Gate correction is committed in the current source checkpoint. The next
dependency-ready action is exact-source deployment and a Product Closure-only
Windows rerun. The remaining seven Windows Native Chat Gates, Windows
NDR-W10-D closure, and PostgreSQL contention stay `UNPROVEN` until Product
Closure passes.

That rerun completed as
`20260907T172733115184Z-0c931661f30e78bb940a7a75796c0cd1` at exact source
`8c26787fbf024a2bf948827295f94e847417df36`, binary SHA-256
`54c28b1f3566124f4cd650ca8558c2273c0c2ee01e0c792a30d691e1d3fd2df2`.
It proves the synchronization correction: Bob remained selected,
`aria-pressed="true"`, the submit control was enabled, and native mouse down,
up, and click were acknowledged. Product Closure still failed at
`group.create.ui`, now at the next owner boundary:

- Station-four's canonical Direct row retains Federation
  `fed_chat_7341c15a026c42dd6d56`.
- Desktop's local `messaging_conversations` projection, Rust
  `ConversationProjection`, JSON bridge, and TypeScript
  `MessagingConversationProjection` omitted `federation_id`.
- `CreateGroupModal` therefore retained Bob visually but rejected the selection
  in its fail-closed Federation guard before
  `/conversation/group/prepare`.
- The modal stayed open, no Group row was committed, and cleanup remained
  `DONE/PROVEN`.

The local owner-layer correction carries `federation_id` from
`ConversationCreatedFact.post_state` and Station bootstrap through shared
SQLite migration/persistence, MLS and recovery projections, the Desktop JSON
bridge, `socialChat`, Mobile Rust/TypeScript projections, and Mobile lifecycle
repair from canonical `/conversation/list` protobuf readback. Legacy recovery
archives without the field remain decodable; empty legacy values are repaired
from Station instead of becoming fabricated local truth. Messaging Core `106+2`,
Mobile Rust `69`, full Mobile check, Desktop tests `540` with one explicit skip,
Desktop production build, and Desktop Rust acceptance build pass. The Desktop
binary unit target remains blocked by unrelated pre-existing Auth test-only
imports. The four approved local Chat Gates also pass:

- `station-messaging-unit`:
  `20260908T012913836503Z-0950132dc5eb697bbbbfa3b9024bacc5`;
- `messaging-platform-contract`:
  `20260908T012928729229Z-3fbe961ea4cc6aa0a2ccdc6b78643a99`;
- `desktop-check`:
  `20260908T012952353971Z-4fde3c43ff57faf818e946e6a790f4c1`;
- `chat-native-visible-static`:
  `20260908T013008012282Z-5044574d070da418cd2e02a6f843fdbc`.

The conditional Mobile source Gate also passes as
`20260908T013026599038Z-b494469b036bebe0b789cb7439da32d2`. Exact-range
Acceptance plan `20260908T012843005103Z-45abc8ed54b2023fc66b1ad9c7155ab0`
covers all 34 changed paths. Gap Detector remains `UNPROVEN` because native
Windows/Mobile receiver Gates are not yet source-bound to this dirty checkpoint.
The projection correction is committed in the current source checkpoint. The next
action is exact-source deployment, then a Product Closure-only rerun.

The exact-source rerun
`20260908T013805491929Z-5d8f7a0c6d64aec300b72900a1ecd09c`
used commit `4ff3f78fb4c6a437aa6b1ed645dabab57ca9b57e` and Windows
binary SHA-256
`b144db724cc552c9c1c3fb7676670524e605a83629f737ae42c50c32ef3d0b54`.
It proved both Station bindings, Direct create/reopen, and that Group submission
now reaches `POST /conversation/group/prepare`. Station returned HTTP 400
because Group preparation and KeyPackage reservation re-read remote Bob from
the local-only Actor Device table instead of consuming the already verified
MP-D19 signed endpoint routes. Cleanup is `DONE/PROVEN`.

The owner-layer correction now resolves one signed endpoint-manifest snapshot
before Group preparation, passes canonical server-derived routes into the
application service, binds KeyPackage reservation to those routes, returns the
same manifests to the client, and revalidates fresh signed routes before Group
commit. The persisted authority plan binds both the complete signed manifest
set and a stable directory-state hash that excludes only issuance and expiry
timestamps. Exact command-receipt replay runs before plan loading or remote
manifest resolution. `CreateGroupRequest` no longer accepts duplicate name or
member inputs; Group identity, name, membership, routes, and reservations are
derived from the persisted plan. The client still submits no trusted routing
data.

The final local checkpoint passes full Conversation and Key Exchange tests,
their race-enabled suites, focused `go vet`, Go style, formatting, and diff
checks. The source-bound local aggregate
`20260908T032102443647Z-880042c6a33915570b610c7a94d90718`
records these approved Chat Gates as passed:

- `station-messaging-unit`:
  `20260908T032102660098Z-e50d904fe0d9cf71f21637d628504b76`;
- `messaging-platform-contract`:
  `20260908T032105462748Z-fe0e66b26c2c04814cfbff0d47eeb9a1`;
- `desktop-check`:
  `20260908T032108283088Z-58efca7e594a079767761275bff4ee83`;
- `chat-native-visible-static`:
  `20260908T032117217481Z-8905e613c33b030e18e8075e6daf24ca`.

Conditional `station-api-ownership` run
`20260908T031556440970Z-1defc692da62374b13b9c5e23f453da2`,
`acceptance-plan-self`
`20260908T032126813248Z-e4ca70534fb193ca3afbb2552967daed`,
and `acceptance-infra-validation`
`20260908T032127507729Z-f8965fbf9a4804f9f0b4af91fd50a29a`
also pass. Independent final seam review found no P0/P1 issue.

Exact-range plan
`20260908T031725199224Z-b69de6f2a0fd623271448cdfd5f91dd2`
and Gap Detector
`20260908T032208866291Z-5c6df6dd6c62ef049d94c8a0f8ef78ac`
keep product proof `UNPROVEN`: Product Closure and the dependent Windows Gates
have not run against this source. The unrelated
`acceptance-runtime-provisioning-self` baseline also remains failed on
Agent-specific stale expectations and launch-context/port-4445 failures. The
next action remains checkpoint commit, exact-source deployment, and a
Product Closure-only rerun.

### 2026-09-08 Group Genesis Command Route Correction

Windows Product Closure run
`20260908T033256775430Z-34b2f520c4d47ab9351c6a41bb592255`
used exact source `018491a013277a1bea1d5ba50d7fd3a3aaa75203` and
Windows binary SHA-256
`9db85704bdbdec5432df9798e056c9c1fdd27d89fc2c1aa8426e28a82a2f4092`.
It proves the signed endpoint-route correction: Group preparation returns 200
for Alice on station-four and remote Bob on station-five. The next request is
incorrectly `POST /conversation/command`, which returns an HTTP 200 typed
rejection. PostgreSQL retains the authority plan in `prepared` state and has no
Group Conversation row or Group command receipt. The Gate therefore times out
at `group.create.ui`; cleanup is `DONE/PROVEN`.

The root cause is Desktop Rust `StationCommandTransport`: its generic outbox
transport posted every decoded `ChatCommand` to the ordinary command route even
when the command was the prepared epoch-zero Group genesis defined by AO-D07.
The local correction:

- routes only an epoch-zero membership transition carrying an authority plan to
  canonical `POST /conversation/group`;
- leaves ordinary commands and established membership transitions on
  `POST /conversation/command`;
- wraps the unchanged canonical `ChatCommand` in
  `CreateGroupConversationRequest`;
- rejects non-canonical durable command bytes before submission;
- requires the Group creation response Conversation and event to bind back to
  the submitted command.

Current-source local evidence:

- Desktop Rust `cargo check --features acceptance-webdriver`: pass;
- route selection, ordinary-command preservation, exact command bytes, and
  response binding have focused Rust regression tests; the binary unit-test
  target remains blocked before execution by the pre-existing Auth test-only
  missing symbols and type inference error;
- `station-messaging-unit`:
  `20260908T042714357902Z-41049387fc52c3b2069a50a526823961`;
- `messaging-platform-contract`:
  `20260908T042729704170Z-b4257c7aa7feab8cbe4756c06fb40bba`;
- `desktop-check`:
  `20260908T042825752431Z-c33f841bdfa01c864ae452a23e9380a2`;
- `chat-native-visible-static`:
  `20260908T043359375556Z-e0344ecc986d45b8d6e14ad93e08a96b`;
- `station-api-ownership`:
  `20260908T043433761115Z-7a2529c303868bb510bbd7875d883735`.

The first native-visible attempt
`20260908T042838999690Z-c610b5ce7580bca0a52df8744a8b2aa3`
timed out in an orphaned Vitest process before assertions; the clean rerun above
passes. NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN`. The next
dependency-ready action is a local checkpoint commit, exact-source deployment
to station-four, station-five, and sixwin, then a Product Closure-only rerun.

### 2026-09-08 Group Genesis Sender Delivery Correction

The first exact-source run after the Desktop route correction is
`20260908T044521277951Z-0fc6d8073736d98fc571117a45f01feb`.
It used commit `1824138a83d25dba08a2e2a823c1778b3cf34a90` and Windows
binary SHA-256
`82d73b98ffe9b67b4bdad9534f67f27271d98fe6ae258a83d690f26df119f19b`.
The runtime trace proves both canonical Group requests:

- `POST /conversation/group/prepare` returns 200;
- `POST /conversation/group` is reached and returns 400.

The Group remains absent and the Gate times out at `group.create.ui`; cleanup is
`DONE/PROVEN`. The 400 is reproduced locally by a focused mapper regression:
Group genesis records every post-genesis endpoint as added, while the
membership delivery mapper checked `AddedEndpoints` before `endpoint ==
sender`. It therefore required an MLS Welcome for Alice even though the creator
must receive the public event marker and only other newly added endpoints
receive Welcomes.

The local correction preserves removed-sender retirement precedence, then
handles the sender public marker before the added-endpoint Welcome branch.
Established membership additions and removals retain their existing delivery
semantics. Verification passes:

- focused pre-fix regression failed with `welcome_payloads: does not cover every
  added endpoint`, then passed after the ordering correction;
- `go test -race -count=1
  ./app/subserver/conversation/interface/http`: pass;
- `station-messaging-unit`:
  `20260908T052618517119Z-b203407dfe9b05dddad0cfdbb2064d79`;
- `messaging-platform-contract`:
  `20260908T052623369202Z-85f4abb691348b450fca24be6175af29`;
- `desktop-check`:
  `20260908T052632311323Z-5db7cb388d6e8b8a1337e3192a2edd97`;
- `chat-native-visible-static`:
  `20260908T052640959588Z-3cec8093c01a13cdcf05b27cfd062b57`;
- `station-api-ownership`:
  `20260908T052652251946Z-cadf5f3daa35394f3e41015d0fd4b10e`.

NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN`. The next
dependency-ready action is a local checkpoint commit, exact-source Station and
sixwin deployment, and another Product Closure-only rerun.

### 2026-09-08 Group Genesis Public-Event Projection Boundary

Exact-source Windows Product Closure run
`20260908T053425400659Z-254d5079f8451a6c7bf7e9b08c3daab7`
used commit `0261490b07a8c278fbc8fdfa3f4c3775ddfaebd5` and Windows
binary SHA-256
`8c9ff3cca2cc02eff7a869cc06b9deb92e4ba4a2db173ccd046943afac32179b`.
The runtime crossed the previous Station mapper boundary:

- `POST /conversation/group/prepare` returned 200;
- `POST /conversation/group` returned 200 and committed the authority Group;
- Alice remained at one Direct and zero locally projected Group conversations;
- the first failed step remained `group.create.ui`, with
  `timed out waiting for Alice active MLS group`;
- cleanup reached `DONE/PROVEN`.

Alice's runtime log records the first owner-layer failure:
`queue drain: messaging public-event payload type is unsupported`. The committed
Group creation sender delivery reaches the Device Messaging Engine as a
`PUBLIC_EVENT`, but the current public-event processor does not accept or
delegate the Group-created Conversation fact into the canonical Conversation
state projection. This is now the first Product Closure boundary. A secondary
station-five error rejects Bob's consumption receipt because the follower
Station has no authority-local delivery commitment; that boundary remains
unresolved but does not supersede the earlier Alice projection failure.

NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN`. The next
dependency-ready action is to correct the Desktop/Messaging Core public-event
projection at its owning layer, run the approved local Chat checks, commit
locally without push, redeploy exact source, and rerun Product Closure only.

### 2026-09-08 Group Genesis Client Consumption Correction

The client-side root cause spans both endpoint-private deliveries of the same
sequence-1 `ConversationCreatedFact`:

- Alice's `PUBLIC_EVENT` was routed to the ordinary message/interaction
  processor and failed as unsupported;
- Bob's `MLS_WELCOME` reached the MLS transition processor, which required a
  post-genesis `MembershipTransitionCommittedFact` and failed before installing
  the Welcome.

The local correction keeps the accepted wire contract unchanged. Portable
Messaging Core now classifies Group creation as MLS sender work, validates the
complete creation snapshot, checks the accepted pending OpenMLS state against
the exact authority endpoint set, and carries an optional genesis projection
through the sender receive commit. Recipient Welcome processing accepts only a
sequence-1 Group creation whose epochs, actor, owner, members, endpoints,
payload commitment, and exact OpenMLS leaves match. Desktop and Mobile stores
persist the Group projection, member roles, MLS session, authority head, lane
cursor, consumption marker, receipt, command state, and pending-transition
removal in one transaction.

Current local evidence:

- Messaging Core: `107/107` unit tests pass;
- Mobile messaging adapter: `23/23` focused tests pass;
- Desktop Rust production check with `acceptance-webdriver`: pass;
- `pnpm mobile:check`: pass;
- `station-messaging-unit`:
  `20260908T072215775592Z-46a8b065433b8339394218452ac84b25`;
- `messaging-platform-contract`:
  `20260908T072227303408Z-2aab2223b11cc5235715ea91cca5f39e`;
- `desktop-check`:
  `20260908T072300032308Z-bc2185c1bb191c6c9d5026d6da99278e`;
- `chat-native-visible-static`:
  `20260908T072343200814Z-8b5f20ed55b295c11643f1a16ff05e2a`;
- `mobile-contract-static`:
  `20260908T071348358555Z-938144a9c225a336cf59fcab73a40a19`;
- `station-api-ownership`:
  `20260908T071331641490Z-5b73d412392c16df2b7a0e9b3abbedb5`.

The Desktop binary unit-test target remains blocked before test execution by
the unrelated pre-existing Auth test-only missing symbols and type-inference
error; production compilation passes. NDR-W9-D and Windows NDR-W10-D remain
`PARTIAL/UNPROVEN` until this checkpoint is committed, deployed exactly to
station-four, station-five, and sixwin, and Product Closure is rerun.

### 2026-09-08 Group Genesis Runtime Proof And Ordinary Command Route Boundary

The committed Group-genesis client correction at
`d84b1abcfa7bbe7ca0d990344c43f9e4a26f13f9` was deployed exactly to
station-four, station-five, and sixwin. An initial provisioner run
`20260908T073834625118Z-6b723d782d499ca465c5fe6234c86d18`
timed out while copying the 132 MiB Git bundle to sixwin before the Product
Gate launched. The transferred bundle was complete, and a guarded 15 KiB
incremental bundle advanced sixwin from
`0261490b07a8c278fbc8fdfa3f4c3775ddfaebd5` to the exact target under the
remote source lease. The first run is therefore an environment
`PARTIAL/UNPROVEN`, with cleanup `DONE/PROVEN`.

The authoritative Product Closure rerun is
`20260908T074818880888Z-3d7030abcb60e950e59e442cf9d38d7b`,
with aggregate
`20260908T074818777617Z-26a15dea2864b482b8b953c6dc1480f5`
and Windows cell
`20260908t074856709879z-2bbd5496ad908ba4`. It used exact source
`d84b1abcfa7bbe7ca0d990344c43f9e4a26f13f9` and binary SHA-256
`a1b26bc35ab9a867c4804f49beec15cbc4574f919ccb92e22bc12dc271f4057a`.
Windows 10 Enterprise build 19045, x86_64, WebView2 `152.0.4191.66`,
1920x1080 rendering, native input/focus/point ownership, screenshots, distinct
Alice-to-station-four and Bob-to-station-five bindings, Direct create/reopen,
and `group.create.ui` all pass. This proves both Alice's sender
`PUBLIC_EVENT` and Bob's `MLS_WELCOME` Group-genesis consumption.

The first Product Closure failure advances to `transcript.thread.ui`: Alice
times out waiting for visible message `w13-root-60670`, while Desktop records
`messaging_send_outcome:not_queued:draft`. station-four returns HTTP 400 during
ordinary command preparation. The locked Conversation aggregate is healthy
and contains active Alice and Bob members with their correct Home Stations,
but `PrepareCommand` discards that cross-Station route truth and resolves every
member again through station-four's local-only `actor_devices`, where Bob does
not exist. Ordinary command submission repeats the same local-only route
resolution.

The dependency-ready correction remains inside the Station Conversation owner:
resolve fresh MP-D19 signed endpoint manifests before preparation/submission,
pass canonical `VerifiedRoutes` into the application service, revalidate the
exact active actor set against the locked aggregate, retain Actor Identity
`IsActive` authorization for a local sender, and bind a federated sender to its
authenticated Home Station. The client and protobuf contracts remain
unchanged; no remote Actor shadow row, fallback read, or Messaging facade is
permitted. station-five's authority-local delivery-receipt rejection remains a
secondary later boundary.

NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN`. The next action is
the focused Conversation correction, Station tests and the four approved local
Chat Gates, a local checkpoint commit without push, exact-source deployment,
and another Product Closure-only rerun.

### 2026-09-08 Ordinary Command Signed-Route Correction

The Conversation owner now resolves the current authority actor set before
ordinary command preparation/submission, fetches fresh MP-D19 signed endpoint
manifests outside the command UOW where the caller permits it, and passes the
canonical server-derived routes into the application service. Under the locked
aggregate, the application service rejects missing, duplicate, extra, or
Home-Station-drifted route snapshots before mutation. The exact same verified
snapshot drives required endpoints, delivery binding, submission validation,
and typed stale-plan response construction.

Local senders still require an active Actor Identity device at the local
Station. Federated prepare and durable submit bind the sender endpoint to the
authenticated source Home Station and active Federation membership without
requiring an authority-local remote Actor device row. The protobuf and client
contracts, membership plan path, Group genesis path, and Conversation ownership
remain unchanged.

Focused regression proves Alice can prepare and commit with Bob present in the
Conversation and signed route set but absent from authority-local
`actor_devices`. It also proves a valid remote sender route, wrong authenticated
Home Station rejection, local inactive-device rejection, and fail-closed
missing/duplicate/extra/Home-Station-drifted snapshots. The Conversation
package, focused Federation receiver checks, complete race suite, focused
`go vet`, Go style, formatting, and diff checks pass. Independent seam review
reported no P0/P1 issue.

The approved local Chat Gates pass:

- `station-messaging-unit`:
  `20260908T091503099805Z-e1d8eee5933fb55f354fc918f1e20720`;
- `messaging-platform-contract`:
  `20260908T091503099800Z-d4e451d77a221db6d4fa71bf34b08550`;
- `desktop-check`:
  `20260908T091503099826Z-0bd166c2e358268379cac7a134cbb282`;
- `chat-native-visible-static`:
  `20260908T091503099784Z-c43a202d98b5367637c3a4dee447480f`.

Conditional `station-api-ownership`
`20260908T091547372258Z-8496e2900a1a6143827ccd0c3b451d23`
also passes. NDR-W9-D and Windows NDR-W10-D remain
`PARTIAL/UNPROVEN` pending a local checkpoint commit, exact-source deployment
to station-four, station-five, and sixwin, and a Product Closure-only rerun.
Exact-range Acceptance plan
`20260908T091939464338Z-58716024fc475e2b749e6389ed882355`
matches all 12 changed paths. Local aggregate
`20260908T092006472536Z-e2486e313e0f415be0402be559347726`
passes the four approved Chat Gates plus `station-api-ownership`. Gap Detector
remains `UNPROVEN` for the intentionally deferred native/runtime and
Acceptance-self gates; no local evidence is promoted to Windows Product
Closure proof.

### 2026-09-08 Signed-Route Runtime Proof And Follower Receipt Boundary

The signed-route correction was committed as
`fbb4fb6b03a3bd65937f775414e4e4420b147df2` and deployed exactly to both
disposable Stations and sixwin. The first Product Closure attempt,
`20260908T092747381663Z-34e5e66987ef08a0bd50559172594046`,
stopped before product execution because the active profile was
`chat-native-five` while the primary target was station-four. That run is an
environment `PARTIAL/UNPROVEN`; cleanup is `DONE/PROVEN`.

The authoritative unchanged-source rerun is
`20260908T095837802631Z-15c4c028e3e73cdfb50b88abc1af3ce6`,
with aggregate
`20260908T095837681852Z-2d30fd9817f778dab0df62adbefd12f4`
and Windows cell
`20260908t095915889424z-7c0e3ce0ff8427d2`. It used binary SHA-256
`e02c47fe5299cbdb13a28a2823c2659179e145d2726501b159284a274eab9647`.
Native readiness, distinct Alice/Bob Station bindings, Direct create/reopen,
canonical Group creation, and Alice's first Group message all pass. The
authority commits Alice's message at sequence 2 and Bob consumes the matching
station-four device delivery.

The first failure remains `transcript.thread.ui`, now with Alice timing out on
Bob's visible reply `w13-bob-60680`. station-four has no Bob command receipt or
event, and station-five has no outgoing Conversation authority-command frame.
station-five repeatedly rejects Bob's consumption receipt with
`delivery_receipt_recorder.record: consumer: does not identify an expected
authority delivery endpoint`.

The first owner-layer boundary is therefore the missing durable return of a
remote device consumption receipt from the follower Home Station to the
Conversation authority. The accepted contract already requires the public
client route to remain `/conversation/delivery/receipt`, Conversation Delivery
to own the receipt, and shared Federation to own authenticated cross-Station
transport. The correction must preserve the exact receipt bytes and receipt ID,
bind `SourceStation` from the authenticated frame source, reject source/route
drift and conflicting replay, and let the authority emit the existing
`DEVICE_RECEIPT` aggregate to the originator. No client-supplied authority
route, `/messaging/*` surface, fallback, or second receipt store is permitted.

NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN`. The next action is the
focused Conversation/Federation receipt-forwarding correction, focused
tests/race/vet/style, the four approved local Chat Gates, a local checkpoint
without push, exact-source deployment, and another Product Closure-only rerun.

### 2026-09-08 Follower Delivery Receipt Correction

The Conversation owner now routes a follower-local
`DeviceConsumptionReceipt` through one new typed shared-Federation payload.
The public client contract remains `/conversation/delivery/receipt`; the
follower first validates and records the exact consumed local Device Inbox
tuple, then returns success only after the exact signed frame is durably
persisted in the shared Federation outbox. Bounded receipt-sharded locks plus a
PostgreSQL advisory lock serialize concurrent exact retries. The authority
derives `SourceStation` from the authenticated frame, pins it to the active
member Home Station and follower authority, and applies the existing exact
authority commitment validation.

Authority receipt persistence and sender-facing `DEVICE_RECEIPT` intents now
share one SQL transaction. Originator routes come from the immutable authority
delivery commitments, so both local and remote sender devices are covered
without authority-local remote Actor rows. Local targets receive canonical
Device Inbox rows; remote targets receive typed Conversation device-delivery
frames. Per-receipt ordering keys avoid same-event multi-device collisions,
Station admission time owns frame lifetime, exact replay repairs any missing
durable sender fan-out and reuses existing frame identity, and changed bytes
fail with an idempotency conflict. The superseded realtime-only delivery
projection path is deleted.

Focused verification passes:

- complete Conversation and shared Federation delivery tests;
- complete Conversation and shared Federation race tests;
- focused `go vet`, Go style, formatting, and diff checks;
- `station-messaging-unit`
  `20260908T124713721070Z-65f916e2629235b618c68e2e1fd07924`;
- `messaging-platform-contract`
  `20260908T124715420604Z-81cdd08f0706d0790976054635f868fb`;
- `desktop-check`
  `20260908T124718816437Z-4de6baab4564797f79c012e33e87dbdd`;
- `chat-native-visible-static`
  `20260908T124727118333Z-4d2478a4a10d89394a2eea53eb7eac8d`;
- `station-api-ownership`
  `20260908T124736735820Z-6ae274996b6f782767b0b95552f65f81`;
- aggregate
  `20260908T124713594514Z-380dca42bae140052b4e9df2105b3f13`.

Proto generation Gate
`20260908T124426267804Z-08f5d29945d1c0d894e4f59bd776835f`,
Station Federation unit Gate
`20260908T124447521645Z-87f6d63dcdb06ab204e578b67566a73c`,
and Acceptance plan self-check
`20260908T124449054645Z-a649f4c0115eab709f5d861af52e9404`
also pass. Direct Acceptance infrastructure validation
`20260908T124519979558Z-cf7fc09e4da9c8973c7f95f0cba34ff2`
passes after the combined run's transient failure. The broader provisioning
self-suite still fails in unrelated Agent V2 and launch-context tests; native
Chat and three-node Federation Gates remain intentionally `UNPROVEN`.

The final independent seam review reports no remaining P0/P1 finding.

Desktop lifecycle inspection proves outgoing receipt failure does not
mechanically starve commands: draft preparation and command dispatch run before
receipt dispatch on every cycle, and step failures are accumulated rather than
short-circuiting the cycle. Bob's missing authority command therefore remains a
separate runtime assertion to inspect in the next Product Closure rerun.

NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN` pending a local
checkpoint commit, exact-source deployment to station-four, station-five, and
sixwin, and a Product Closure-only rerun.

### 2026-09-08 D-17 Remote Ordinary Command Restoration

Exact-source Product Closure run
`20260908T141700178703Z-805b1dd1bba78e3a4ba40f54c7004c6f`
at `af5bb3b5699f7c5dce2b7aabd992dc97e8101f29`, aggregate
`20260908T141700065759Z-30dc11b8077b16c4cfcb0303887969b7`,
Windows cell `20260908t141743996690z-c977333e1f36eb29`, and binary SHA-256
`df1ecb7445d4a7e05e9ab14bdd8b84010788596cea764d7df0b71ed8398de5d9`
prove the follower receipt correction. The run reaches Bob's reply in Group
`c1fff411-8a86-4460-9bb8-c7a26aa1e1ab`; cleanup is `DONE/PROVEN`.

The first failure is `transcript.thread.ui` while Alice waits for
`w13-bob-9393`. Bob's Desktop successfully prepares and submits the command to
station-five, but the Device Messaging transport sends the raw `ChatCommand`
to the remote Home Station. station-five returns a typed HTTP 200 rejection,
persists no payload-kind 2 authority-command frame, and station-four therefore
has no Bob command receipt or sequence-3 event. The Conversation hard cut
deleted the earlier D-17 Desktop proposal path without reconnecting equivalent
actor-device signing to the current command outbox.

The local correction restores the accepted D-17 path without adding a public
route or second truth:

- local-authority commands remain raw canonical `ChatCommand` submissions;
- remote-authority commands read the canonical follower public head, bind the
  enrolled device signing key, and submit a deterministic
  `ConversationCommandProposal` through `/conversation/command`;
- ambiguous network, response-decode, and session-revocation outcomes remain
  retryable so they cannot discard a command that the Home Station may already
  have accepted;
- the Home Station resolves exact existing proposal bytes before allocating a
  new Federation ordering sequence, rejects command-ID byte conflicts and
  terminal/expired outbox replays, and validates every new proposal against its
  active durable follower projection;
- Desktop consumes `COMMAND_RESULT` items atomically with the local command
  transition, consumption marker, lane cursor, and claimed-item state;
- accepted authority results repair local command/outbox/attempt state and the
  pending message status without replacing the separately delivered authority
  event projection;
- terminal membership results remove both durable and in-memory pending MLS
  transitions.

Focused verification passes:

- exact-range Acceptance plan
  `20260908T160405061458Z-a503a8596e5f48536b8710f501f64023`;
- Desktop Rust production
  `cargo check --features acceptance-webdriver`;
- complete Conversation race suite
  `go test -race ./app/subserver/conversation/...`;
- focused Home replay/follower-head tests;
- `station-messaging-unit`
  `20260908T162840250134Z-0b8134cddb77b02332de643862176c0f`;
- `messaging-platform-contract`
  `20260908T162845450220Z-4886636fb5e731a8c4ac30b87ed95ae6`;
- `desktop-check`
  `20260908T162848449697Z-a31545a74910c6f0c85245f809d637a1`;
- `chat-native-visible-static`
  `20260908T162856861553Z-3f6a7a76b4899857f54726d2b8049e6d`;
- `station-api-ownership`
  `20260908T160923016126Z-d046644b9523c60d94920de7a1834330`;
- local aggregate
  `20260908T162840127741Z-61da456f1bdd0c6896f197a978a846e7`.

The focused Desktop binary test target remains blocked before execution by
pre-existing Auth test-only unresolved imports and type inference errors;
production Rust compilation passes. NDR-W9-D and Windows NDR-W10-D remain
`PARTIAL/UNPROVEN` pending a local checkpoint commit, exact-source deployment,
and Product Closure-only rerun.

### 2026-09-09 Verified Remote Actor Identity-Key Persistence Boundary

The committed D-17 correction at
`24a795726d8371ea06d1f53dfbaec3543c7578cd` was deployed exactly to
station-four, station-five, and sixwin. Product Closure run
`20260908T163630929783Z-0d1461f4675bba5041949ca8934c5510`,
aggregate `20260908T163630823708Z-9e1bf206bf014bdce567f569d6048951`,
Windows cell `20260908t163713792019z-31b44cbadca0a230`, and binary SHA-256
`b48586fd55b0a0a8ff2eda4272f45965a21a966cfbfa3c8259fe2f2f36ff9f61`
prove that the D-17 proposal now leaves Bob's Desktop and is durably enqueued
by station-five.

The first failure remains `transcript.thread.ui`: Alice times out waiting for
Bob's visible reply `w13-bob-27180`. PostgreSQL establishes the exact boundary:

- station-five created payload-kind `2` authority-command frame
  `conversation-frame:d5628d7f17067462b0cb77b912b95c0839de2a9030e311d1b4bd1f05195362a1`
  for command `01M2108FGAE1R8DS2VXFKRJ1G3`;
- the frame reached station-four ten times but received a retryable domain
  rejection on every attempt, then expired at its signed five-minute limit;
- station-four committed no matching Federation inbox row, command receipt, or
  sequence-3 Conversation event;
- station-four fetched Bob's signed remote Actor profile and endpoint manifest,
  and the proposal signing key exactly matches Bob's verified profile key;
- the accepted endpoint manifest persisted Bob's routing fence but not the
  manifest's verified Actor identity public key, leaving
  `actor_identity_keys` empty for Bob;
- Conversation therefore cannot seal Bob-authored device deliveries and
  returns `CONVERSATION_ACTOR_KEY_UNAVAILABLE`, which correctly keeps the
  Federation frame retryable but cannot converge without the missing
  Actor Identity projection.

The owner-layer correction belongs to Actor Identity:
`AcceptVerifiedEndpointManifest` must atomically establish or advance the
verified remote Actor identity continuity key together with its monotonic
directory fence. Exact replay with the same key is allowed; stale profile
versions and any key conflict fail closed. Conversation must continue reading
the key through its narrow identity interface and must not persist a second
copy or accept proposal-supplied key material.

The Product Closure run is `PARTIAL/UNPROVEN`; cleanup is `DONE/PROVEN`.
The remaining seven Windows Native Chat Gates, Windows NDR-W10-D closure,
PostgreSQL contention, Gap Detector, and completion audit remain deferred.

The Actor Identity correction now persists the verified manifest's Ed25519
Actor identity public key, derived fingerprint, and monotonic profile version
in the same transaction as the endpoint-directory fence. Exact manifest replay
is idempotent. A stale profile version, changed identity key, or conflicting
directory snapshot rejects the complete transaction without leaving a partial
identity projection. Conversation continues to read the key through
`IdentityDirectory.ActorIdentityPublicKey`; a focused production-adapter seam
test proves the accepted remote manifest supplies the sender key used to seal
`DeviceEventDelivery`.

Focused verification passes:

- Actor Identity and Conversation `go test -race`;
- focused Actor Identity/Conversation `go vet`;
- Go style, formatting, and diff checks;
- `station-messaging-unit`
  `20260908T174540828944Z-9f957d22406b76afebd98e1b1c363246`;
- `messaging-platform-contract`
  `20260908T174543625672Z-352dbd2adeb54a073207af097b0ef1da`;
- `desktop-check`
  `20260908T174549720557Z-8bb7112e7a3e88a8a6c2d25cfa42483a`;
- `chat-native-visible-static`
  `20260908T174558257150Z-6030d7c0dd280c600416de1e6e8ebecf`;
- local aggregate
  `20260908T174540700796Z-0955f1301c2d2776f14dff2f6afb00cf`.

An earlier aggregate was invalidated by intentional source changes during its
execution and is excluded from evidence. NDR-W9-D and Windows NDR-W10-D remain
`PARTIAL/UNPROVEN` pending a local checkpoint commit, exact-source deployment,
and another Product Closure-only rerun.

The final exact-range aggregate
`20260908T175007415039Z-47f0bb3265dbf33d04c30b46f648f209`
passes `station-messaging-unit`, `messaging-platform-contract`,
`desktop-check`, `acceptance-plan-self`, and
`acceptance-infra-validation`. Its
`acceptance-runtime-provisioning-self` Gate remains `PARTIAL/UNPROVEN` only on
the pre-existing Agent V2 missing-helper failures and launch-context timeouts.
Gap Detector therefore keeps the overall claim `UNPROVEN`; no static or unit
result is promoted to Windows Product Closure proof.

### 2026-09-09 Canonical Read-Cursor Device-Inbox Projection Boundary

The Actor Identity correction at
`2ae0254691d97f16c3c08ef3e8639bdd91a91eac` was deployed exactly to
station-four, station-five, and sixwin. Product Closure run
`20260908T175709393177Z-55f53c9d9f4a50ca95c53e79a3bde0bc`,
aggregate `20260908T175709295124Z-a391b650f3a35af8f68fe2410fa19642`,
Windows cell `20260908t175752889322z-745bcb62304f4a9d`, and binary SHA-256
`518bf35b8c40b9e56bc01cebc0902b5b1fcf3523cc54cc90901606a7b1c519f0`
advance the first failure to `reaction.ui`; cleanup is `DONE/PROVEN`.

The run proves:

- Alice and Bob launch with distinct Station bindings;
- Direct search/open, canonical Group creation, transcript/thread projection,
  and toolbar geometry pass;
- station-four commits Bob's reply as sequence 3, Alice's thread reply as
  sequence 4, and the reaction as sequence 5;
- Alice consumes the reaction; Bob does not because his Device Inbox lane is
  blocked before the reaction item.

Bob's lane 7 item is payload type 5 with canonical deterministic
`ActorReadCursor` bytes and `event_id = hex(SHA-256(payload))`, exactly as
Conversation produces and the Federation receiver validates. Desktop and
portable Messaging Core still selected read cursors through the retired
synthetic `read:` prefix. They therefore decoded the cursor as
`MessageReceipt`, rejected it, and prevented lane 8 from reaching the reaction
consumer.

The local correction makes portable Messaging Core the single decoder for both
Desktop and Core adapters. It validates queue type, recipient, payload hash,
canonical protobuf bytes, and the producer-defined event identity before
atomically committing either the actor read cursor or delivery receipt. The
retired `read:` identity is rejected; no compatibility path is retained.

Focused verification passes:

- Messaging Core focused receipt tests: 3 passed;
- Messaging Core full suite: 110 unit tests and 2 integration tests passed;
- Desktop Rust production
  `cargo check --features acceptance-webdriver`;
- `station-messaging-unit`
  `20260909T075246659397Z-a2ce8766dbbda0812246bc28a8b86f98`;
- `messaging-platform-contract`
  `20260909T075249708681Z-2be8fedb39ddd38ac04966cd10b5cf39`;
- `desktop-check`
  `20260909T075253153263Z-758fd57ab269986bef619603abba1cb1`;
- `chat-native-visible-static`
  `20260909T075302469923Z-1fb80ee42d9801d41fa530118404339c`;
- `acceptance-plan-self`
  `20260909T075312371083Z-2caf1c3a320fddf0f03ab9ff90ee4574`;
- `acceptance-infra-validation`
  `20260909T075313033208Z-9e43a12aeeb6bf96dc1ee0b925ce92fc`.

Exact-range aggregate
`20260909T075246544755Z-757a3a7473c595fc41013d034f28d7a9`
passes those six Gates. `acceptance-runtime-provisioning-self`
`20260909T075314187326Z-0e361fd222d9560245f3aad313b5696a`
remains `PARTIAL/UNPROVEN` on the pre-existing Agent V2 helper/import defects
and launch-context ephemeral-capability timeouts. These failures do not prove
or disprove the Chat correction and remain outside the reduced Windows IM Chat
iteration matrix.

NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN`. The next
dependency-ready action is a local checkpoint commit without push, exact-source
deployment to station-four, station-five, and sixwin, and a Product
Closure-only rerun. The remaining seven Windows Native Chat Gates and
PostgreSQL contention remain deferred until Product Closure passes.

### 2026-09-09 Win32 Same-Worker Chooser Observation Checkpoint

The open `cross-station-direct-open` debug session confirmed that the Windows
file chooser exposes its location field as the focused Win32 `Edit` control
immediately after `Ctrl+L`. A separately scheduled observation worker instead
became the foreground `ConsoleWindowClass` and returned no focused HWND.
Product Closure discarded the targeted reveal worker's immediate control
snapshot and polled through those focus-stealing workers.

The Acceptance Infra correction keeps process activation, `Ctrl+L`, bounded
focus observation, and control-snapshot return in one Win32 broker worker.
`NativeDesktopRuntimeAdapter` now returns the optional targeted reveal
snapshot, the remote Windows adapter decodes the broker result, and Product
Closure retains its historical polling path only for platforms whose targeted
reveal returns no snapshot. Product assertions, chooser behavior, and Chat
business injection remain unchanged.

Final-source local verification:

- focused Win32 driver, broker, runtime-binding, and Product Closure static
  cohort: 93 tests passed, 1 skipped;
- targeted Python compilation and `git diff --check`: PASS;
- local aggregate
  `20260909T122735116615Z-704ca9769a2059f981e1d733f5bb94b4`
  passes `station-messaging-unit`, `messaging-platform-contract`,
  `desktop-check`, `chat-native-visible-static`, and
  `acceptance-plan-self`;
- direct `acceptance-infra-validation`
  `20260909T122835479164Z-2ac13abe523be95f71db4a8618a37596`
  is `STRUCTURALLY_VALID`;
- `acceptance-run-test`, `acceptance-plan-test`,
  `acceptance-validate-test`, `acceptance-infra-boundary-test`,
  `acceptance-gap-detect-test`, `acceptance-coverage-report-test`, and
  `quality-evidence-test` pass 66, 20, 20, 8, 22, 18, and 14 tests;
- wrapped `acceptance-infra-validation`
  `20260909T122810392932Z-b8882fcc1ab4ba4f41909d5d390446ff`
  reproduces the known active-aggregate ordering failure while the direct
  validator passes;
- `acceptance-runtime-provisioning-self`
  `20260909T122905945107Z-a51989fdd8e5f26194e38fd4880c8867`
  remains `PARTIAL/UNPROVEN` on the pre-existing Agent V2 missing helpers,
  missing `StationAttestation` test import, blocker-order expectations, and
  launch-context ephemeral-capability timeouts. Its transient local port
  collision is excluded after the isolated port-conflict regression passed.

NDR-W9-D and Windows NDR-W10-D remain `PARTIAL/UNPROVEN`. The next
dependency-ready action is the authorized local checkpoint commit without
push, exact-source deployment to station-four, station-five, and sixwin, and a
Product Closure-only post-fix run. The remaining seven Windows Native Chat
Gates and PostgreSQL contention remain deferred until Product Closure passes.

### 2026-09-09 Product Closure Cold-Login Budget Boundary

The exact same-worker chooser checkpoint was deployed to station-four,
station-five, and sixwin. Product Closure run
`20260909T124044141301Z-b80a2a22db8ae6bb1580976c5bac1c53`,
aggregate `20260909T124044019679Z-35f92433bfb3fac6db920c66440ef731`,
Windows cell `20260909t124133022679z-f79c01038e91f6f2`, and binary
SHA-256
`1669d684208597040c5826dc9d8e82c01eb1881e3afb89e3dc75dc4d968089c2`
prove exact source, both Station bindings, Windows 10/WebView2/Win32 runtime
identity, and 1920x1080 display readiness.

The run did not reach the file chooser. Its first failure is `alice.launch`:
Selenium canceled `chat.loginWithPassword` at the runner's 30-second
async-script limit. Native logs reject an authentication or process failure:

- `auth_login` passed in 2572 ms;
- repeated token validation, profile sync, and the authenticated identity edge
  passed;
- `runtime:critical:end`, `runtime:idle:end`, and
  `deferred projections installed` completed;
- the final Chat hydration was still progressing near the 30-second boundary;
- the native process and WebDriver stayed alive until cleanup.

The owner-layer correction retains every accepted login, identity, runtime,
and Chat hydration assertion and gives the cold-login harness a named bounded
60-second budget. It does not alter Desktop product behavior or weaken a
product assertion.

Final-source local verification passes:

- focused Win32 driver, broker, runtime-binding, and Product Closure static
  cohort: 93 tests passed, 1 skipped;
- targeted Python compilation and `git diff --check`;
- `station-messaging-unit`
  `20260909T131654815475Z-dadc8692b5695c3b05087d58779eabd5`;
- `messaging-platform-contract`
  `20260909T131659139056Z-0275f51e9ff068fb75380be18eda579a`;
- `desktop-check`
  `20260909T131702008944Z-61e42f65348139f89c35d198bd1d515c`;
- `chat-native-visible-static`
  `20260909T131711937607Z-6f096b450b2df1ab7a991e30587181e9`;
- `acceptance-plan-self`
  `20260909T131723215569Z-01e8e1749857f957273fa309891134ee`;
- direct `acceptance-infra-validation`
  `20260909T131748002214Z-921bfa0951f126275eef56f0de7fb5a5`
  is `STRUCTURALLY_VALID`.

The Product Closure run remains `PARTIAL/UNPROVEN`; cleanup is `DONE/PROVEN`.
No chooser post-fix event exists because the run stopped at `alice.launch`.
The next dependency-ready action is a local checkpoint commit without push,
exact-source deployment, and another Product Closure-only run. The remaining
seven Windows Native Chat Gates and PostgreSQL contention remain deferred.

### 2026-09-09 Exact Chooser HWND Activation Boundary

The cold-login budget checkpoint was deployed exactly to station-four,
station-five, and sixwin. Product Closure run
`20260909T134440112983Z-0e5b64bed281266f6ab66e5dff2bfb51`,
aggregate `20260909T134440013984Z-a9c35a5bf0b33d15341528334584f7b9`,
Windows cell `20260909t134532834443z-7d55104d739751d7`, and binary
SHA-256
`442f291821e9db905466b152cfa3773a764901abd0597741c7ac0ad6c0e301f3`
prove the 60-second cold-login correction. Alice and Bob launch, and Direct,
Group, bidirectional transcript/thread, toolbar geometry, reaction, identity,
and Station attribution all pass.

The first failure remains `settings.background.ui`, but the post-fix collector
now records the exact Tauri common-dialog topology:

- requested actor PID 9824 owns a visible top-level `#32770` chooser;
- that chooser has `owner=0`, so the previous owner-handle heuristic incorrectly
  returned `dialogCount=0`;
- process activation selected the Tauri main window instead of the chooser;
- focused control remained the WebView `Chrome_WidgetWin_1`, and `Ctrl+L`
  therefore never reached the native common dialog.

The owner-layer correction identifies the file chooser by its canonical
top-level `#32770` class, activates that exact HWND in the same interactive
worker, sends `Ctrl+L`, and observes the focused control before returning.
Dialog counting now uses the same class-based truth. No polling workaround,
product-assertion change, or Chat business change is introduced.

Focused Win32 driver, broker, runtime-binding, and Product Closure static
verification passes 94 tests with one intentional skip. Targeted Python
compilation and `git diff --check` also pass. Final dirty-range verification
passes:

- `station-messaging-unit`
  `20260909T145654651668Z-294a583277a49bec8bbd4a43d0a1b58a`;
- `messaging-platform-contract`
  `20260909T145700907906Z-66fec68f269cadcc593c3b4311109404`;
- `desktop-check`
  `20260909T145705231044Z-570790e55df806f6ba73b7a08b119ec7`;
- `chat-native-visible-static`
  `20260909T145716957339Z-46c43abf05c0e10b5e63e6e729b700cd`;
- `acceptance-plan-self`
  `20260909T145733339117Z-f31bf3711e2b0352255fdac3afa60a1a`;
- direct `acceptance-infra-validation`
  `20260909T145755730617Z-be4504f326fdf37aeda73d28e030c631`
  is `STRUCTURALLY_VALID`.

The run remains `PARTIAL/UNPROVEN`; cleanup is `DONE/PROVEN`. The next
dependency-ready action is a checkpoint commit without push, exact-source
deployment, and another Product Closure-only run. The remaining seven Windows
Native Chat Gates and PostgreSQL contention stay deferred until Product
Closure passes.

### 2026-09-10 Windows Operator Profile Injection

Work resumed from the ordinary repo on master HEAD
`79ae008706ca29f4bb5f1da29d9b6651a59b2f7c` (clean, single worktree, workspace
`1f485431c64ce139`), which matches the handoff HEAD exactly. No Gate ran in
this checkpoint; all Windows Gate claims remain `PARTIAL/UNPROVEN`.

The scope is the Windows branch only: NDR-W9-D Product Closure first, then the
seven remaining NDR-W10-D Windows Native Chat Gates, then PostgreSQL
contention/recovery, Gap Detector, and completion audit. NDR-W1–W7 are closed
Linux evidence and are not reopened; NDR-W8 macOS stays out of scope.

Operator environment findings on sixwin:

- Git for Windows 2.55 provides bash at `C:/Program Files/Git/bin/bash.exe`;
  `C:/Program Files/Git/cmd` is in the system PATH but newly opened operator
  shells must be restarted to inherit it.
- No GNU `make` ships with Git for Windows. Strawberry Perl provides
  `gmake.exe` only; local-dev make recipes hard-code `/bin/bash`, so profile
  operations run through Git Bash directly, and Acceptance make targets map
  1:1 to `python tooling/scripts/acceptance-run.py ...`.
- The operator Python is 3.12.1 as `python` (there is no `python3` shim);
  cargo, node, pnpm, an `id_ed25519` SSH key, protoc at
  `C:/Tools/protobuf-36.0/bin/protoc.exe`, VsDevCmd under `C:/BuildTools`, and
  Strawberry Perl are present.
- The local-dev env tool is bash + per-worktree symlink based. Git Bash's
  default `ln -s` creates a plain copy (so env.sh's `-L` active-pointer check
  fails), while `MSYS=winsymlinks:nativestrict ln` creates a real symlink but
  returns exit 1 and its `-sfn` replacement leaves stray temporary links.
  Therefore `profile.sh activate` cannot perform its final symlink step on
  Windows without a cross-platform owner-layer fix.

Profile resolution (two layers, both verified):

- Canonical deployable profile added in the sibling env repository as
  `env/peers-touch/sixwin/profile.env.example`: `PT_DEV_PROFILE=sixwin`,
  slot 6, `PT_STATION_MODE=remote`, default Station station-four
  `10.37.245.247:18080` with its standalone relay, local Desktop ports
  3160/3610 and web 3161/3611, mobile 5276, and the same actor/reset variables
  as the four/fiveArm profiles (`CHAT_NATIVE_DEMO_PASSWORD=1`,
  `CHAT_ACCEPTANCE_RESET=1`, station restart kept at 0 and exported
  explicitly only when a Gate is authorized). station-five remains bound by
  the Chat Acceptance multi-Station manifest for two-client Gates. The env
  inventory moved `discovered` to `provisioned`.
- On sixwin the import cache was bootstrapped at
  `.local/dev/profiles/sixwin.env` and the active pointer
  `.local/dev/active/peers-touch.env` was created as a native file symlink to
  that cache (Windows `mklink` equivalent), bypassing the broken `ln` step.

Injection verification passed three ways: Git Bash `config.sh` resolves the
canonical env-repository file and redacts the password; Python
`Path.is_symlink()`/`resolve(strict=True)` (the same mechanism as
`BaseProvisioner._resolve_active_profile`) resolves the cache and matches
`PT_DEV_PROFILE` to the `sixwin.env` stem; `profile.sh list` runs. No
peers-touch tracked file other than this checkpoint changed, and `.local/`
remains ignored, so exact-source proof is not diluted.

Outstanding before the first Product Closure run (fail-closed inputs the
Windows provisioner reads independently of the dev profile):
`.local/acceptance/runtime-cells/acceptance-windows.env`
(`PT_ACCEPTANCE_CELL_DEPLOY_ENV`, `PT_ACCEPTANCE_CELL_DESKTOP_USER`,
`PT_ACCEPTANCE_CELL_PROTOC=C:/Tools/protobuf-36.0/bin/protoc.exe`, build
ports) and `.local/deploy/envs/acceptance-windows.env` (loopback SSH deploy
target for the local cell) do not yet exist. A cross-platform
`profile.sh activate` symlink fix is an owner-layer enhancement to be made on
a fresh branch with the local/static cohorts rerun; it is not a Gate blocker
because the active pointer is already provisioned.

The next dependency-ready action remains the handoff sequence: sixwin sshd /
interactive-desktop / stale-process preflight, ff-only master sync with the
actual HEAD recorded, static cohorts and the four local Gates, exact-source
identity for station-four, station-five, and sixwin, then the Product
Closure-only run with `RUNTIME_CELL=desktop-windows-native`.

### 2026-09-10 Windows Host Preflight And Import Portability

The Windows execution branch is `fix/windows-native-chat-closure`, created
from exact master `79ae008706ca29f4bb5f1da29d9b6651a59b2f7c`. The sixwin
host preflight now proves:

- TRAE and Explorer are both in active interactive Session 1;
- a connected primary display is available;
- OpenSSH for Windows 9.5p1 is listening on port 22 through the automatic
  `OpenSSH-Server` service;
- localhost public-key command execution succeeds through the strict
  administrators key file;
- stale file-dialog debug tasks were removed, while repository `.dbg`
  resources remain untouched;
- no PeersTouch, WebDriver, Cargo, or Acceptance runtime process remains.

The legacy `sshd` service entry is disabled and deletion-pending after the
working `OpenSSH-Server` registration. It is not restarted or repaired in
place because the active service already owns port 22 and passes command
execution; no host reboot is required.

The ignored Windows Runtime Cell inputs now exist:

- `.local/acceptance/runtime-cells/acceptance-windows.env` binds the
  Administrator interactive user, runtime root, Python, VsDevCmd, Strawberry
  Perl, protoc, WebDriver port 4645, and Gateway port 3230;
- `.local/deploy/envs/acceptance-windows.env` binds direct exact-source sync
  to sixwin over localhost SSH;
- `.local/acceptance/known_hosts` pins the sixwin host keys.

Fresh Windows Python initially could not import the Provisioner registry
because `mobile_resource_lease.py` resolved POSIX `/var/tmp` with
`strict=True` at module import. The Mobile ledger already enforces POSIX
no-follow dirfd support when `ResourceLeaseLedger` is constructed, so the
owner-layer correction removes only the import-time filesystem existence
requirement. It does not weaken Mobile lease storage or business evidence.
The source-sync portability test now sets both `HOME` and `USERPROFILE` for
its isolated child checkout.

Verification on the dirty correction range:

- focused Win32 driver, broker, runtime-binding, and Product Closure static
  cohort: 104/104 PASS;
- SSH transport, Windows source-sync, and Windows lease cohort: 14/14 PASS;
- Acceptance Infra ownership boundary: 8/8 PASS;
- fresh `chat_native_reset` import, Python compilation, and
  `git diff --check`: PASS.

Product Closure and all remaining Windows product Gates remain
`PARTIAL/UNPROVEN`. The next action is to commit this correction without push,
run the four source-bound local Chat Gates, verify three-host source identity,
and execute Product Closure only.

### 2026-09-11 Windows Sixwin Completion

The Owner-approved Windows scope closed on clean product source
`283832a7392e071f0d2018cfb3fd85a874744172`, branch
`fix/windows-native-chat-closure`, workspace `b7faf6d3489b3797`. Runtime
selection was injected only at execution with
`--station-profile station-primary=sixwin`. Every Native manifest resolved
that profile to the single local Station at `http://127.0.0.1:18080`; no
station-four or station-five service participated.

Final exact-source evidence:

- Local four-Gate aggregate
  `20260911T192936233860Z-1619e4066c3880aefc3c47944b0341ad`
  passed `station-messaging-unit`, `messaging-platform-contract`,
  `chat-native-visible-static`, and `desktop-check`.
- Native eight-Gate aggregate
  `20260911T171022643174Z-8601dca380d9a904041d72fa46bafad6`
  passed Product Closure, two-client, interactions, contact-message
  resilience, typing, multi-device, recovery, and Group MLS. Every result is
  `DONE/PROVEN`, carries a `desktop-windows-native` Runtime Manifest at
  1920x1080, records clean local and remote source identity, and has
  `DONE/PROVEN` cleanup.
- The Product Closure run is
  `20260911T171023157955Z-dec53283a4ae9dbb4124c94a00ba6a24`.
  The final Group MLS run is
  `20260911T190313940160Z-dd5c87297319e6801498c150785b5eee`.
- Sixwin-local PostgreSQL 17.11 contention/recovery run
  `20260911T1915491502940Z-f3a7eb606a6e401980e62336ea6d6524`
  passed the attachment quota lock, canonical index, competing dispatcher,
  and concurrent inbox exactly-once tests under `-race -count=1` before and
  after restart. An immediate stop triggered WAL automatic recovery; the
  source-bound durable marker read back exactly. Port 55432 and all disposable
  PostgreSQL processes were released.
- Gap Detector runs
  `20260911T193242532950Z-bd8db662292312f8b77d200ed7899865`
  and `20260911T193256473649Z-419aa292e04928879de4fd65050a1c4a`
  report `PROVEN` with zero gaps for the local and Native matrix partitions.
- Mechanical completion audit
  `20260911T193908424196Z-daccebe8f7c6c434bcc1e07c767562b9`
  is `PASS/DONE/PROVEN`. It verifies immutable artifact hashes, exact source,
  all 12 Gate results, Native runtime and Station identity, 1920x1080 display
  evidence, cleanup, PostgreSQL recovery evidence, zero-gap reports, and
  host-neutral Gate/environment/provisioner source.

`vdservice` was restored to `Running` with automatic startup after the fixed
display aggregate. The Git worktree was clean throughout product, PostgreSQL,
Gap Detector, and completion-audit execution. No push was performed.

This completion is intentionally narrow: it closes NDR-W9-D and the current
Owner-approved Windows single-sixwin NDR-W10-D scope. It does not claim macOS
W8, reopen Linux W1-W7, or claim the superseded historical distinct-Station
topology.

### 2026-09-11 NDR-W8 Development Runtime Repair

The user-selected runtime is native `make desktop` on the installed canonical
env-repo profile `four`. This does not authorize a packaged-app substitution,
the retired local `chat-native-four/five` profiles, Station reset, or global
process cleanup. Historical Windows/Linux proof does not prove this macOS run.

Binding verified after resume:

- integrator: `peers-group-chat`, `fix/deploy-env-host-guard`,
  workspace `a534541b87e49abf`, slice baseline HEAD
  `8f0d34d1549046a5f8fcdac0b15a4d7d8ed96668`;
- user-requested synchronization target: `peers-chat-high-chat`,
  `high-chat-dogfood`, workspace `95620934d3348d95`, synchronization baseline
  `67efeb70354351ed2afa838849f3b5c1d0b6d5c3`, first synchronization merge
  `f20e4e4c12485b6002bb78579dc0a3b39a9d63a7`;
- shared worktree-set digest:
  `4b41b36f2a0a6704e9779efc97495b76bbe1cd0b1427a1d564baf306025281c4`.

Run `20260911T010001453367Z-fd133cd4e8ee5f82e4a1480f0aa8a26b`
failed building Bob's binary with E0609: the HTTP adapter's identity-transition
lock dependency was not synchronized. A 600-second port wait concealed that
failure. The auth/wire investigation also refutes missing account creation:
both login adapters invoke the same application service. A drain request is an
active queue operation, not a passive readiness probe.

Concurrency Decision: hybrid. The completed auth/wire lane was read-only.
The startup lane exclusively owns `_ensure-desktop-rust.sh`,
`_ensure-desktop-vite.sh`, `dev-desktop-app.sh`, `local-dev/desktop-dev.sh`,
and focused launch regression tests. The integrator owns Rust changes,
Native Driver/Provisioner integration, Chat injection, tracking, and all live
resources. High-chat synchronization is integrator-only after source review.
No lane deploys, resets a Fixture, or stops unrelated processes.

| Ready unit | Owner | Proof required | State |
|---|---|---|---|
| Restore complete identity-lock dependency in high-chat | integrator | binary compilation, not library-only check | done |
| Fail closed on native startup failure and preserve instance isolation | startup lane | child exit, timeout, foreign port, per-instance input regressions | done |
| Connect current-profile Make runtime to the native Driver | integrator | bound process, embedded WebDriver, storage and Station identity | done |
| Recover missing Direct device child projection from verified authority genesis | integrator | positive recovery, tampered-genesis rejection, current-device fan-out/receipt/typing/attachment regressions | source complete |
| Direct, offline recovery, three-actor group, friendship and thread | Chat injection | native receiver DOM and immutable evidence | ready after exact-source Station deployment |

Infra scope is generic launcher lifecycle and resource isolation. Business
injection scope is the existing Chat journey/actor/proof contract. The current
gap matrix keeps every macOS receiver journey UNPROVEN until executed; no
Gateway-only result or unavailable third client may produce a silent pass.

Post-fix source and runtime evidence:

- startup and instance isolation regressions: 18/18 PASS;
- Native Driver, launcher, and direct-runner regressions: 35/35 PASS in both
  `peers-group-chat` and `peers-chat-high-chat`;
- Desktop checks: PASS in both worktrees;
- `acceptance-webdriver` Desktop binary checks: PASS in both worktrees;
- `chat-native-visible-static`:
  `20260911T034838944867Z-660d10f0ef5e37d16412a7fdfd981bc4`
  PASS in the integrator and
  `20260911T034716287495Z-eb54e8d1e438ca625f3cfec7e459693f`
  PASS in high-chat;
- two Native clients launched through `make desktop`, exposed independent
  process/Gateway/renderer/WebDriver/profile/storage identities, selected
  Station `four`, authenticated Alice/Bob, hydrated distinct canonical PTIDs,
  and resolved the same Federation.

The first product failure is now source-backed and external to the launched
clients. Read-only Station inspection found deterministic Direct conversation
`direct-8933203d465fd79ac34b9b33953757a2` with two active members and zero
`conversation_member_devices`. Its signed genesis event still proves the
original two endpoints, while the current actor-device directory contains
later device IDs. `aggregate.Rehydrate` correctly rejects this split state, so
both `/conversation/list` and `/conversation/direct` return
`CONVERSATION_INVALID_ARGUMENT` before any message can be submitted.

The first blocker classification was too strong. Accepted MP-D17 semantics and
`TestConversationDDDDirectFanoutUsesCurrentActiveActorDevices` prove that Direct
commands resolve the current Actor Directory endpoint set at prepare/submit;
the genesis device set is the immutable authority baseline, not the current
delivery fan-out. The signed sequence-one event contains the complete Direct
post-state and is verified by the existing event sealer.

The Station persistence owner now reconstructs a missing Direct device child
projection in memory only from that verified genesis post-state. It rejects a
missing, malformed, tampered, or scope-mismatched genesis and does not apply the
rule to Group projections. The next successful authority mutation persists the
reconstructed baseline through the existing aggregate save transaction, while
message delivery continues to target only current active Actor Directory
devices. Direct typing, receipt, and attachment authorization now use the same
actor-level Direct / device-level Group rule and still require the current
Actor Identity device check.

Focused regressions and the full Conversation package pass. No Station database
mutation or Fixture reset occurred. The next dependency-ready action is to
run `chat-native-current-profile-two-client-e2e`. That Gate uses the installed
active profile, clones existing Desktop identity state into two isolated
run-scoped storage roots, launches both clients through `make desktop`, and
performs the unchanged bidirectional plaintext/message-ID/receipt assertions
without resetting the protected Station. The cross-platform
`chat-native-two-client-e2e` keeps its disposable two-Station Fixture contract
and is not weakened or replaced. After the current-profile Gate passes, resume
the remaining Direct/offline/Group/interaction matrix.

The first current-profile run
`20260911T051620333813Z-4640f78c3a8eddb332a6239a39482afb` proved both
Native clients and exact Station/source binding, then failed inside
`conversation.open`. Station request evidence shows `/conversation/direct`
returned 200; the Desktop command subsequently converted an unauthorized
`/device/inbox/claim` into the apparent create failure. Runtime instrumentation
confirmed the failing Alice Engine endpoint was not enrolled.

The ownership defect is in the current-profile Chat Provisioner. It cloned one
worktree's Desktop seed for both actors and launched it under `PT_PROFILE=four`,
while canonical developer storage is under `four-app`. The local profile state
currently binds Alice's canonical Actor Identity in `peers-chat-high-chat` and
Bob's in `peers-group-chat`. The remediation therefore:

- accepts one explicit non-destructive storage seed per actor through
  `PT_CHAT_NATIVE_STORAGE_SEEDS`;
- copies each seed into its own run-scoped storage root;
- launches both clients under the canonical `<profile>-app` Desktop namespace;
- requires the Engine endpoint to appear as ACTIVE in Station `/device/list`
  before `client.authenticated` passes;
- decodes the Station protobuf JSON device response at the Desktop service
  boundary instead of exposing snake-case wire data as generated TypeScript.

Focused Python and Desktop service/type checks pass. A one-client post-fix
Native diagnostic reused Alice's canonical device
`01M276A60YVV4Q9MWN9NPHD3RE`, observed it as ACTIVE, reopened
`direct-8933203d465fd79ac34b9b33953757a2`, and completed the post-create queue
drain. This remains diagnostic evidence only; the source-bound two-client Gate
and its receiver DOM assertions remain `UNPROVEN` until the clean candidate is
deployed and executed.

#### Direct Prekey Publication Reconciliation

Exact-source run
`20260911T070854885624Z-687f80aa16cac8e456300e5eaba74922`
advanced both native clients through actor isolation and `conversation.open`,
then failed at `message.submitted`. Cleanup passed for both processes, all six
ports, logs, and run-scoped storage.

The failure is a recoverable implementation defect inside NDR-W8. Both
Desktop stores contained a locally `published` Direct prekey bundle, so the
portable publisher returned success without contacting Station. Station had no
active Direct bundle for either endpoint, and the sender therefore retained a
durable `draft` instead of queuing a command. The strict `draft != queued`
assertion remains correct and must not be weakened.

The dependency-ready remediation is:

1. preserve the current device SPK and all old OPK private material;
2. persist a new, monotonically identified OPK replenishment batch before
   network publication;
3. use Station `/key-exchange/keys/count` and
   `/key-exchange/keys/replenish` for normal inventory repair;
4. when Station reports that the complete bundle is absent, upload the current
   identity/SPK with only the new OPK batch;
5. keep retry bytes stable, never republish or reactivate consumed OPKs, and
   allow a newly published pending OPK to decrypt a delayed inbound init;
6. retain receiver native-DOM plaintext, identical message ID, and receipt
   assertions as the product proof.

The retained-client safety boundary is explicit:

- loss of a replenish or full-bundle publication response retries the exact
  persisted OPK IDs and public bytes;
- replay at Station accepts identical material without changing a consumed OPK
  back to available;
- complete Station bundle loss is repaired with the existing identity/SPK and
  only a newly persisted, monotonically higher OPK batch;
- loss or partial deletion of the client's local OPK history is not recoverable
  from account backup, because MP-D05 excludes SPK/OPK live state. The client
  fails closed before allocating a reused OPK ID; a fresh device lifecycle is
  required instead. Databases created before the independent high-water mark
  existed migrate that mark to an explicit untrusted sentinel rather than
  deriving trust from the possibly incomplete OPK rows.

Focused regressions for this boundary are
`missing_bundle_retry_after_lost_upload_ack_reuses_the_fresh_opk_batch`,
`missing_bundle_retry_reuploads_identical_bytes_when_upload_did_not_commit`,
`prekey_replenishment_fails_closed_when_local_opk_history_has_a_gap`, and
`TestCanonicalDirectReplenishmentReplayDoesNotReactivateConsumedKey`; the
legacy migration sentinel is covered by
`messaging_schema_marks_legacy_prekey_history_untrusted`.
The 2026-09-15 owner closure makes the local OPK history continuity check
executable and all listed regressions pass. This closes the source contract that
Mobile needs before implementing its `PreKeyInventoryRepository` and
`PreKeyInventoryTransport` adapters; it does not by itself prove Mobile runtime
delivery or recovery.

Concurrency Decision: hybrid. Three completed read-only analysis lanes audited
the portable store, Station Key Exchange contract, and Chat Acceptance mapping.
All source edits, generated-artifact decisions, deployment, profile/runtime
resources, and final Gates remain integrator-only and serial because they share
the same prekey contract, profile `four`, Station deployment, actor stores, and
native port set.

#### Current-Profile Cross-Worktree Correction

The prior current-profile topology launched both native clients from
`peers-group-chat`. That proves process, port, profile, storage, and device
isolation, but it cannot prove that the synchronized `peers-group-chat` and
`peers-chat-high-chat` development worktrees both run the same Chat behavior.
That run is diagnostic only and is invalid as final cross-worktree product
proof.

The user-confirmed current-profile topology is:

1. synchronize `peers-chat-high-chat` from the `peers-group-chat` source line;
2. require the two worktrees to have distinct canonical roots and equal Git
   trees before client acquisition;
3. launch one native Desktop through `make desktop` in each worktree;
4. preserve each worktree's existing actor/device storage instead of switching
   identities between clients;
5. use the `peers-group-chat` client as the first Direct sender and
   `peers-chat-high-chat` as the first receiver;
6. retain the reverse direction, exact receiver plaintext, identical message
   ID, and delivered receipt assertions before accepting the Gate.

Source synchronization is complete. The `peers-chat-high-chat` merge commit
`f20e4e4c12485b6002bb78579dc0a3b39a9d63a7` has parents
`67efeb70354351ed2afa838849f3b5c1d0b6d5c3` and
`8f0d34d1549046a5f8fcdac0b15a4d7d8ed96668`; both worktrees resolve tree
`2ac48a00acb5eaab5b63e5d578575b89a2663eba`.

The dependency-ready correction is owned by the Chat current-profile
Provisioner and Gate:

- accept an explicit client-ID to worktree mapping;
- reject missing, duplicate, non-worktree, dirty, or unequal-tree roots before
  allocating ports or run-scoped storage;
- publish the distinct roots in `RuntimeManifest.clients`;
- bind the initial journey direction to the client launched from
  `peers-group-chat`, regardless of whether its existing actor is Alice or Bob;
- add focused regressions that reject a same-worktree pair and verify the
  cross-worktree initiator order.

Concurrency Decision: serial. The Provisioner contract is consumed directly by
the Gate direction logic, and both clients share profile `four`, one Station,
one port allocation set, and one cleanup ledger. The integrator exclusively
owns the Provisioner, Chat Gate, focused tests, plan, deployment, and final
runtime proof.

Source implementation is complete and runtime proof remains `UNPROVEN`:

- the Provisioner discovers or accepts an exact Alice/Bob worktree map and
  rejects same-root, wrong-name, dirty, unrelated-repository, or unequal-tree
  inputs before allocating run resources;
- Alice keeps the `peers-chat-high-chat` identity seed, Bob keeps the
  `peers-group-chat` identity seed, and the current-profile Gate launches and
  sends in Bob/group-chat then Alice/high-chat order;
- the Gate report records both workspace IDs, one repository ID, both heads,
  the equal tree, launch order, and direction order; the validator rejects
  same-worktree or reversed-initiator evidence;
- Chat Static passed 6 Vitest and 182 Python tests; focused Provisioning and
  Native two-client regressions passed 35/35; full Provisioning passed 164/164;
  planner, boundary, validator, gap-detector, coverage, and quality self-tests
  passed; Desktop check, 20 messaging contract tests, and Station
  Conversation/Federation/Key Exchange tests passed;
- the Gap Detector correctly keeps the product claim `UNPROVEN` until a fresh
  source-bound `chat-native-current-profile-two-client-e2e` run produces
  receiver DOM, message-ID, receipt, and cleanup evidence.

The first exclusive cross-worktree diagnostic reached Bob/group-chat's initial
submit and exposed `messaging endpoint key bundle binding mismatch`.
Instrumentation proved that the requested Conversation endpoint and returned
Key Exchange endpoint had the same canonical Actor PTID and device ID. The
adapter incorrectly compared the complete generated `ActorDeviceRef`, including
non-identity Actor metadata reconstructed differently by the two owners. The
root correction compares only `(actor PTID, device ID)`, retains rejection for
missing or changed canonical identity, and maps the adapter path into the Direct
delivered-receipt Feature and Registry.

Exact-source run
`20260911T101655225502Z-88c4b954448acee5d24cdbe670011a9d`
proved the distinct clean worktrees, equal source trees, group-chat-first
direction, Station/client source identity, both authenticated Native clients,
and complete cleanup. The endpoint-binding failure no longer occurs. The run
then failed at Bob's first `message.submitted`: the new message remained a
durable draft because the local authority head did not match the Station send
plan after the bounded inbox drain.

The next dependency-ready action is to record the plan/local authority
sequence and hash plus each drain result, reproduce the exact cross-worktree
Gate, and repair the authority reconciliation owner without weakening the
strict head equality check. After that fix, deploy the exact source through
profile `four` and `make station`, then rerun with group-chat as initiator and
high-chat as receiver.

Exact-source run
`20260911T104702215012Z-4d96be6ca0a6f759c9eef0db233ba72e`
confirmed the missing-history case: Bob's local authority head remained
sequence zero with an empty hash, the Station plan remained sequence one with
hash
`5da69d0e93893f14a323d5500d81aa01bb26d6fceaf367a5a1d012d9fa5bb3e0`,
and every bounded drain reported cursor zero, lane head zero, and zero
processed items. The run again proved distinct worktrees, equal source trees,
group-chat-first direction, both authenticated Native clients, and complete
cleanup.

The source repair is complete in the integrator worktree and retains strict
authority equality:

- portable Core verifies the complete Direct sequence-one genesis event,
  canonical event hash, members, endpoints, and endpoint routes;
- the Engine fetches exactly the first authenticated public event only when
  the local head is empty and the Station send plan is sequence one, then binds
  event conversation, authority Station, hash, membership epoch, MLS epoch,
  and local actor membership to that plan;
- the SQLCipher Store atomically installs only the matching authority head
  after proving the existing Direct projection/member rows match and no
  message, marker, command, or Direct session has already committed;
- sequence greater than one, malformed or tampered genesis, projection drift,
  a conflicting head, and non-empty committed state all fail closed;
- the checkpoint creates no queue item, cursor, consumption marker, receipt,
  message projection, or Direct session.

Focused and broad source evidence passes: Messaging Core 117 unit tests plus
two integration tests, and Desktop Messaging 103 tests with one
environment-gated test ignored. The next action remains integrator-owned and
serial: commit `peers-group-chat`, merge that exact source into
`peers-chat-high-chat`, verify clean equal Git trees, deploy through profile
`four` plus `make station`, clear only this debug session's log content, and
rerun the unchanged cross-worktree Native Gate.

Post-fix run
`20260911T114640876965Z-a4973bc5a5d2d31f8c348abde7649c40`
again proved the required two-worktree topology and complete cleanup, then
failed before checkpoint persistence because the first verifier compared
`active_endpoints` and `active_endpoint_routes` by array position. The Station
domain sorts the endpoint list by `(actor, device)` but sorts member-device
routes by the canonical length-prefixed endpoint key, so both arrays can encode
the same valid set in different orders. The Core correction now compares routes
as a canonical endpoint-keyed set, still requiring exactly one route and the
exact member Home Station for every endpoint. Focused Core and Desktop
regressions pass. The exact-source deploy and unchanged Native Gate rerun remain
the next serial action.

Exact-source run
`20260911T120248159958Z-2b7850dfbbdc8fe6edcf8a27ea3842cd`
then proved the Direct genesis checkpoint, Bob/group-chat submission, distinct
clean worktrees, equal Git trees, and complete run-resource cleanup. Alice's
native receiver did not render the plaintext because its Device Engine failed
the queued session init with `messaging one-time prekey is unavailable`.

The failure exposes a second current-profile Provisioner ownership defect.
The prior contract copied an existing device's complete SQLCipher state into a
run-scoped directory, allowed Station to durably publish and consume public
OPKs against that clone, and then deleted the only matching private state.
Reusing the unchanged source seed on the next run rolls the same device
backward and violates MP-A05, MP-A07, and MP-D17. The Messaging receiver must
continue to reject the missing private key; omitting the OPK, regenerating its
private half, or reactivating a consumed key is forbidden.

The mechanical NDR-W8 plan correction is:

1. retain the existing Alice and Bob actor identities from their respective
   worktrees, but initialize one dedicated current-profile Acceptance device
   state per actor without copying the source seed's live `chat.main.db`;
2. store those two device states outside the run directory and reuse them
   across Gate runs, so device identity, OPKs, ratchets, inbox cursor,
   authority heads, and projections advance together as one Device Engine
   state;
3. mark the storage lifecycle explicitly in the Runtime Manifest so the local
   runtime binding deletes only run-scoped storage and verifies that declared
   persistent state remains present after process shutdown;
4. retain the profile/source lease through both clients and fail closed on a
   missing, malformed, symlinked, swapped, or duplicate persistent state root;
5. keep Bob in `peers-group-chat` as the first sender and Alice in
   `peers-chat-high-chat` as the first receiver, with the reverse direction and
   all existing native DOM/message-ID/receipt assertions unchanged; and
6. add a repeated-run regression proving the second run reuses the first run's
   durable device state rather than cloning or rolling back live crypto.

This is a lifecycle correction under the accepted Device Engine ownership and
fresh-device rules. It does not change Station authority, Direct cryptography,
or product assertions. The old worktree development stores remain read-only
bootstrap inputs; the dedicated Acceptance state becomes the sole mutable
device owner for this Gate.

Runs `20260911T132948166064Z-ed936c0d333c9acc6c9625b7b67bec18`,
`20260911T133705719955Z-cde09239c3839bc01c996e0112e601de`, and
`20260911T134419176858Z-46e935d2751d2a8a9e79049d86abfd6d`
prove the persistent-state lifecycle and complete cleanup but expose a fresh
Direct endpoint checkpoint gap. Both current devices publish their prekey
bundles successfully. Bob's local authority head is empty because his endpoint
was activated after the existing Direct conversation reached sequence 2; the
send plan carries sequence 2 and its exact hash. The existing bootstrap accepts
only a sequence-1 plan and therefore leaves the message in `draft`.

The next NDR-W8 correction implements the already accepted fresh-device rule:

1. fetch the authenticated public event log from sequence 1 through the exact
   send-plan head using bounded pages;
2. verify every event hash, previous-hash edge, conversation/authority binding,
   contiguous sequence, and final plan sequence/hash/epoch binding;
3. derive the Direct actor projection only from the verified genesis snapshot;
4. atomically persist that projection and the verified final authority head
   into an otherwise empty Device Engine state;
5. do not create historical message projections, sessions, cursors,
   consumption markers, or receipts; prior plaintext remains Recovery-only;
6. keep the existing strict send-preparation equality check after checkpoint
   installation.

This allows future events to start from the fresh endpoint's activation head
without inventing ownership of historical endpoint-private delivery.

#### Fresh Direct Receiver Pre-Consume Checkpoint

Exact-source run
`20260911T140324819274Z-6ce74ecee89fe31d068dd1f82efbe3c0`
proved that the sender-side checkpoint is complete: Bob/group-chat reconciled
its empty local authority head to Station sequence 2 and submitted the next
message in 735 ms. Alice/high-chat claimed that sequence-3 private delivery but
failed before decryption with
`messaging authority event chain is not contiguous`; her fresh Device Engine
still had no authority head.

The receiver correction stays inside the Device Engine ordered-consume
boundary:

1. a pre-consume hook runs after the Station claim and lane-contiguity check,
   but before the local receive transaction and Station ACK;
2. only a fully verified `DIRECT_CIPHERTEXT` delivery with an empty local
   authority head and event sequence greater than one can request a checkpoint;
3. the Engine fetches and verifies the authenticated public event log only
   through the current item's predecessor, requiring the final sequence/hash,
   authority Station, and epochs to equal the current event's
   `sequence - 1` / `previous_hash` boundary;
4. the existing atomic Direct checkpoint installs the genesis-derived actor
   projection and predecessor authority head without creating historical
   messages, sessions, receipts, consumption markers, or a lane cursor;
5. the current private item then enters the unchanged decrypt/commit consumer,
   and any checkpoint or consume failure prevents ACK.

The shared sender/receiver checkpoint target retains the explicit Direct-kind
binding. Existing non-empty authority heads are never rewritten by the
pre-consume path; normal strict contiguous-chain validation remains the owner.

Source verification on the uncommitted correction:

- Desktop Messaging: 106 passed, one live-environment test ignored;
- Desktop TypeScript/social checks: PASS;
- Desktop Rust `acceptance-webdriver` check: PASS;
- `git diff --check`: PASS.

The correction was committed in `peers-group-chat` at
`a6daa9102161724b5a615b35f2ec1c96bd9f36e5`, merged into
`peers-chat-high-chat` at
`fdd80f6ed3d23989a74c047c25cbaa5c7097470c`, and both worktrees resolve Git
tree `f2d588d26cbaee713a7b1070da20c7d452132720`. Exact Station deployment
through profile `four` and `make station` completed at the group-chat commit.

The first post-fix Native run
`20260911T143857629638Z-f9c984dccd20ac3bac35b419b8db6084` stopped before
product execution because another worktree acquired renderer port `3410`
after preflight. The Gate did not terminate the unrelated process and proved
complete cleanup of its own processes, six ports, logs, and retained
persistent storage. The second run
`20260911T145212236066Z-b0a891ef9f0427c57b86834eeb8226c4` selected isolated
ports and proved:

- Bob launched from `peers-group-chat` and initiated first;
- Alice launched independently from `peers-chat-high-chat`;
- both clean worktrees had the same Git tree and exact Station source;
- Bob submitted message `01M28FDJ5609MJ2D1BFHCTJ9KV`;
- Alice rendered the exact native-DOM plaintext under the same message ID;
- Alice decrypted and committed sequence 3 after installing the verified
  sequence-2 predecessor checkpoint; and
- process, port, log, and persistent-storage cleanup completed.

The receiver checkpoint defect is therefore fixed. The run remains
`PARTIAL/UNPROVEN` because Bob timed out waiting for the delivered receipt.
Both clients repeatedly observed HTTP 500 from
`POST /conversation/delivery/receipt`.

#### Current-Profile Delivery Receipt Follow-up

The current recoverable NDR-W8 boundary is the durable delivery-receipt path:

1. Alice's Device Engine has already committed the private delivery and
   generated its durable consumption receipt;
2. Desktop dispatch selects the oldest pending `device-consumed:*` receipt;
3. Station rejects that submission, but the production HTTP mapper collapses
   typed `interaction.Error` values into a generic HTTP 500;
4. the failed oldest receipt remains pending and may starve the new sequence-3
   receipt; and
5. Bob's sender projection therefore never advances to delivered.

The exact rejected receipt tuple and Station interaction error remain to be
proved before changing business behavior. The strict post-consume receipt
creation, durable retry, and sender-side delivered assertion must not be
weakened.

Concurrency Decision: hybrid. Remote Station log inspection, read-only local
persistent-store inspection, and error-contract analysis may proceed in
parallel because they have disjoint read sets. One integrator owns the shared
receipt contract, all instrumentation and source edits, Acceptance mappings,
commits, high-chat synchronization, profile-four deployment, and final Native
Gates. Runtime execution remains serial because both clients share the
protected profile, Station, persistent device states, and native port pool.

The dependency-ready actions are:

1. instrument the selected Desktop receipt tuple and Station typed failure
   without changing behavior;
2. reproduce once against the exact deployed source;
3. fix the confirmed owning layer, including typed production error mapping
   when applicable;
4. add regression coverage proving a permanently rejected historical receipt
   cannot silently starve a valid current receipt without weakening exact
   retry/idempotency semantics; and
5. rerun both Direct directions with exact native receiver plaintext,
   identical message IDs, delivered/read receipts, and cleanup.

Pre-fix exact-source run
`20260911T151151365999Z-53d60950ba3bc86e25a02511739515d4`
confirmed the boundary. Both persistent clients repeatedly selected their same
oldest sequence-3 receipt while the current send plan had reached sequence 7.
Station accepted the authenticated endpoint and exact receipt/commitment tuple,
then rejected aggregate derivation with
`CONVERSATION_INTERACTION_INTEGRITY_FAILED` because the current Direct
endpoints were absent from `conversation_member_devices`. The production HTTP
mapper returned that typed failure as an empty-body 500.

The source correction keeps the existing durable Desktop outbox unchanged:

- receipt persistence loads the canonical Conversation kind;
- Direct aggregates count exact authority-committed receipts without consulting
  the Group/MLS device-leaf projection;
- a missing Direct receipt remains outstanding rather than being inferred as
  revoked;
- Group aggregates retain strict member-device presence and revoke accounting;
- Direct originator receipt routes come from immutable authority delivery
  commitments, while Group routes retain committed active-leaf filtering; and
- production HTTP maps all typed Conversation interaction errors to explicit
  status, stable code, and safe operation/field/reason headers.

Focused Station receipt and HTTP mapping tests, the complete Conversation
package suite, focused race tests, `go vet`, and diff hygiene pass. The source
remains `PARTIAL/UNPROVEN` until the two worktrees are synchronized, exact
source is deployed, and the same Native Gate proves that historical receipts
drain and the current bidirectional receipts become visible.

Exact-source run
`20260911T155536232655Z-6384c3db6f68e2704460e37c1d8c7e84`
proved the owner-layer receipt correction at runtime. Bob's persistent Device
Engine submitted every durable historical receipt from sequence 3 through
sequence 9 successfully, removing the oldest-pending head-of-line block. The
Gate then stopped before product assertions because the Chat Acceptance
Harness waited only for `accountGate`, while the persistent current-profile
client had restored an authenticated, ready identity lifecycle. Immediate
retry
`20260911T155859425134Z-2695df23c4f222cb9c9c87defd79afa1`
failed at the same `client.authenticated / Bob` boundary and again completed
reverse-order process, port, log, and persistent-storage cleanup.

This is a recoverable NDR-W8 business-injection defect in
`apps/desktop/src/acceptance/chat/harness.ts`. The production identity runtime
already owns restored-session state and controlled logout. The Chat Harness
must:

1. admit either a fresh `accountGate + dataReady` state or an authenticated
   `ready` restored session as the explicit-login precondition;
2. always perform controlled identity logout when a session is already
   authenticated, then wait for `accountGate + dataReady`;
3. execute the requested password login and verify the resulting authenticated
   actor rather than silently reusing the restored actor; and
4. preserve the existing fresh account-gate path unchanged.

Concurrency Decision: serial. The Harness implementation, focused regression,
cross-worktree synchronization, profile-four Station deployment, and final
Native Gate consume the same Chat source tree, persistent actor states, Station,
and native port pool. The integrator owns all writes, commits, deployment, and
runtime evidence. The first source change is instrumentation-only under the
open `conversation-open-500` debug session; after one pre-fix reproduction
confirms the restored lifecycle tuple, the owner-layer Harness correction and
its regression may land.

Instrumentation-only exact-source run
`20260911T161035318786Z-63582c44fb9232e7d3fca37313e18b25`
confirmed the lifecycle tuple on Bob from Harness entry through timeout:
`phase=authenticated`, `lifecycle=ready`, `dataReady=true`, and
`authenticated=true`. Station, Bob/group-chat, and Alice/high-chat were bound
to source `b8a6ec63e4bb97f585eccb391b09adb48f3f1151`; the runtime manifest reached
`FIXTURE_READY`, and cleanup finished `DONE/PROVEN`.

The next serial action is now evidence-authorized: implement the deterministic
Chat Harness transition from either accepted precondition into a fresh explicit
password login, add focused lifecycle regressions for fresh, restored,
wrong-actor, and logout-failure paths, synchronize the exact source into
high-chat, redeploy profile four, and rerun the unchanged Native Gate.

The owner-layer Harness correction and stable regression are source-complete:

- `passwordLogin.ts` models the explicit-login lifecycle independently of the
  restored actor;
- every authenticated-ready precondition performs controlled logout before
  credential login;
- fresh account-gate login retains the existing path;
- incomplete boot, unauthenticated-ready, and logout-failure paths fail closed;
- Chat lifecycle Vitest passed 10/10, Native runtime-cell regressions passed
  45/45, Desktop TypeScript passed, and `chat-native-visible-static` run
  `20260911T161556674513Z-c14ca03d3b11d1278cf96675e7622043`
  passed.

Exact-source commit, high-chat synchronization, profile-four deployment, and
post-fix Native proof remain the next serial actions.

Exact-source run
`20260911T162203820700Z-990108707f29bb6f3188821f9ba9623a`
then passed both clients' explicit authentication, source/runtime identity,
cross-worktree topology, Bob-to-Alice and Alice-to-Bob native plaintext,
identical message IDs, and delivered receipts. The only failure occurred after
those assertions: the Chat runner wrote the still-growing Bob app log before
cleanup and again after client shutdown under the same immutable Evidence Store
path, which correctly raised `EvidenceConflict`.

This is a mechanical Chat business-evidence lifecycle correction, not an
Acceptance Infra change. Native Chat runners that collect a pre-cleanup
screenshot/DOM and later export final logs must write each app log exactly once
after stopping the client. Evidence Store immutability remains unchanged. After
focused runner coverage, synchronize the exact source, redeploy profile four,
and rerun the same Gate twice to prove both journey completion and persistent
state continuity.

The correction is source-complete across Direct, multi-device, recovery, Group
MLS, and typing runners. Their pre-cleanup phase now captures screenshot and DOM
only; each cleanup owner exports the final app log once. The Chat native static
Python suite passes 184/184, including a Direct regression for this exact
immutable-artifact conflict. Exact-source synchronization, deployment, and two
consecutive Native runs remain pending.

Those runtime gates now pass twice on exact source
`c980b22d68741b80c92caf6c43563fb3fd9057f5`:

- `20260911T163312619650Z-613ec264b1dd42ea7883f22a88f6cf8b`;
- `20260911T163540508599Z-03cb6eafb1b62530f8fed69b89ac831a`.

Both are `PASS / DONE / PROVEN` and prove:

- distinct clean group-chat/high-chat worktrees with equal Git trees;
- exact Station and client source identity;
- Bob/group-chat as first sender and Alice/high-chat as first receiver;
- reverse Alice-to-Bob delivery;
- exact native receiver plaintext and identical message IDs in both
  directions;
- sender-visible delivered receipts in both directions;
- complete client binding proof;
- final app-log evidence without immutable-path conflict; and
- complete process, port, log, and persistent-storage lifecycle cleanup.

The repeated pass proves the dedicated current-profile Device Engine state
continues across runs without crypto rollback. The current-profile Direct
journey is closed. Remaining NDR-W8 work proceeds to the independently required
offline, friendship, interaction, typing, multi-device, recovery, and
three-client Group/MLS Gates under their declared environment and authorization
contracts.

Post-proof structural validation exposed one independent Registry closure gap:
the Chat service Feature required `station-api-ownership`, but its proto and
Station implementation rules did not select that Gate. Both rules now select
the existing ownership Gate, and focused planner regressions prove Chat proto
and Station Conversation changes cannot omit it. The planner suite passes
23/23. The generated coverage report is refreshed from current contracts.

On 2026-09-12 the Owner confirmed the native Direct correction and explicitly
authorized `CHAT_ACCEPTANCE_RESET=1` for profile `four`. The
`conversation-open-500` debug session is closed: all session-specific network
instrumentation, its tracked debug record, local NDJSON/env artifacts, and the
Debug Server listener were removed. Focused cleanup verification passes 108
Desktop Messaging tests with one live-only test ignored, the complete Station
Conversation suite, Desktop TypeScript/social checks, and 10 Chat identity
lifecycle tests.

The remaining NDR-W8 Gate queue is now authorized to execute serially against
the canonical remote `four` profile:

1. `chat-friend-request-gateway-e2e`;
2. `chat-native-interactions-e2e`, including Direct offline/restart behavior;
3. `chat-native-typing-e2e`;
4. `chat-native-multi-device-e2e`;
5. `chat-native-recovery-e2e`; and
6. `chat-native-group-mls-e2e`.

Each Gate must independently preflight the disposable target, produce
source-bound native evidence, and complete reverse-order cleanup. A failed Gate
enters root-cause diagnosis before any dependent Gate is treated as proven.

The first authorized `chat-friend-request-gateway-e2e` attempt exposed an
Acceptance Infra finalization defect before product execution. A blocked
resource string containing `fixture-authorization:` was recursively redacted
correctly as structured data, then the complete serialized manifest was passed
through line-oriented text redaction. That redundant pass consumed the JSON
string terminator and caused `JSONDecodeError` before a structured
`BLOCKED/UNPROVEN` result could be published. The source-backed Infra repair is
to retain recursive key/value redaction, remove only post-serialization text
redaction, and add a focused finalizer regression for sensitive assignment
labels embedded inside JSON string values. Chat Fixture and product assertions
remain outside this Infra correction.

The Evidence Store correction is source-verified. Its focused suites pass
40 Evidence Store and 27 redaction tests; current-source
`acceptance-infra-validation` run
`20260912T004839902168Z-bd12b5b8291206d0ebc74ccc3e4dd0fc`
passes, and direct Infra validation is structurally valid. Blocked
friend-request run
`20260912T005402176248Z-cf49351e69ba3ca0617cf31fe9c73ddd`
publishes a valid `BLOCKED/UNPROVEN` manifest instead of raising
`JSONDecodeError`. The retained post-fix debug probe emitted no parse-failure
event.

The friend-request follow-up exposed three previously untracked but
source-defined closure gaps:

1. profile `four` reset authorization was not target-scoped and the Fixture
   rejected every port `18080` target before verifying the active profile,
   deployment environment, Docker Compose project, containers, and Postgres
   volume;
2. the existing Friend Request Feature/Gate was not connected to a Chat
   Capability or Registry rule; and
3. the Gate used stale Desktop Gateway fields and did not provision an initial
   non-friend pair while preserving the required Alice/Bob/Carol default
   friendship baseline after cleanup.

The mechanical correction adds exact
`CHAT_ACCEPTANCE_RESET_PROFILE=four` authorization, validates the canonical
profile/deployment/runtime identity before reset, makes the default six-edge
friendship seed idempotent, adds a Gate-scoped Alice/Bob non-friend Fixture
with reset-backed teardown, connects the Feature through the Chat Capability
Graph and Registry, and aligns the Gateway Harness with current auth,
protobuf-command, Station-peer, and relationship-readback contracts.

Run `20260912T013926156053Z-b4332decbfb55cc809e93c7893b1a27f`
then proved send, pending-list, and accept through the real Desktop Gateway,
but final relationship readback remained false in both directions. The
accepted Social contract requires friend-request acceptance to create mutual
follow edges; the canonical acceptance transaction persisted only
`social_relationship_projections`, while `/api/v1/social/relationships`
reads `follows`. The Station transaction now projects each accepted
relationship into `follows` atomically with its accepted-event provenance.
Cross-Station and same-Station repository tests cover those projections. A
clean commit and exact-source `make station` deployment are required before
the profile-four Gate can prove this final product correction.

The Friend Request contract closure now also maps the exact Station persistence
owner
`apps/station/app/subserver/social/infrastructure/federated_friend_request_store.go`
through the existing Feature, Capability, and Registry rule. Its planner
regression proves that a change at this owner selects
`chat-friend-request-gateway-e2e`; the independently owned Mobile Social rule
continues to select `mobile-native-social-convergence-e2e` for the same shared
source path. `chat-native-visible-static` now owns the focused Friend Request
Gateway regression rather than leaving it as an unregistered test.

Working-tree verification passes the seven source-relevant local Gates:
`station-messaging-unit`, `messaging-platform-contract`, `desktop-check`,
`chat-native-visible-static`, `station-api-ownership`,
`acceptance-plan-self`, and `acceptance-infra-validation`. The focused
Evidence Store, redaction, Provisioner model, reset, and Friend Request suites
pass 140 tests; Station Social packages and Chat structural validation pass.
The Owner selected debugger outcome `A`, so the verified
`evidence-finalize-control-char` session is closed and its server,
instrumentation, record, env file, and NDJSON are removed. These dirty-tree
results prove source consistency only. They do not replace the required clean
commit, exact-source profile-four deployment, or live Friend Request product
proof.

The canonical `HEAD` working-tree Acceptance plan now covers 18 changed paths.
All eight selected local Gates pass, including
`acceptance-runtime-provisioning-self` run
`20260912T020400224162Z-40f7db21111c416a859b44e396410837`.
Profile `four` is active and healthy at
`http://10.37.245.247:18080`, but its deployed Station still reports
`c58ba844ba657760d91f429a7fe317c1e6de9e90`. Both development worktrees retain
the same committed pre-fix tree
`b2de3f8537afda2727da37b2013ec57e1254f2a8`; high-chat is clean, while the
group-chat working tree contains the uncommitted Friend Request correction.

At that checkpoint the Ready queue was exhausted at one hard source-identity
boundary: explicit authorization was required to commit the group-chat
checkpoint. The Owner subsequently authorized the agent to make the necessary
checkpoint, synchronization, and deployment decisions without another
confirmation. Generic Native interaction, typing, multi-device, recovery, and
Group/MLS Gates remain parked behind their station-five Fixture authorization
and, for interactions, explicit Station restart authorization. Mobile Social
convergence remains owned by the Mobile execution line and is not executed
from this Chat worktree.

Commit `57afd77c982d16df2c821735a82e58c10413952f` was merged into high-chat as
`ff8aa9264fbef49b930294467e4f2e0a6e28360a`; both clean worktrees resolve tree
`4542a2f76a95852bc6d495e4955d93d3ee46c7d1`. Profile-four deployment completed
at the exact group-chat commit. Friend Request run
`20260912T023944438968Z-8594475790e707cdb2e073429d2a25d7` is
`PASS/DONE/PROVEN`: Station configuration, Alice/Bob login, Federation
identity, send, pending-list, accept, mutual relationship readback, local
session cleanup, source attestations, secret scan, and reset-backed default
friendship restoration all pass.

The immediately following `chat-desktop-gateway-e2e` run
`20260912T024653815054Z-bcb9535d7dc97f223aeeae9442f7ac78` passed its first
eight identity assertions and cleanup, then failed before the legacy-PIN
negative assertion with `selected account must have one identity state file`.
The Runtime Manifest already publishes the resolved `.../peers-touch` storage
root, while the Gate appended a second `peers-touch` segment. The Gate now
resolves `desktop/data/account/*/identities.json` directly below the manifest
root. A focused manifest-shape regression and the 46-test Native runtime
contract suite pass; `chat-native-visible-static` and all three selected
Acceptance Infra Gates also pass. Exact-source rerun remains required.

Exact-source Gateway rerun
`20260912T025725462350Z-d7265de082b528a02f0f3be48f1eaa82`
then reached `PASS/DONE/PROVEN`. The next current-profile Native Direct run
`20260912T025909198497Z-0d46ecaede03013faf81226e4d07aba2`
failed before product messaging at Bob's active-device precondition, while all
owned processes, ports, logs, and persistent storage completed cleanup.

The authorized profile-four reset had removed the Station device directory,
while Bob's persistent Acceptance Device Engine retained its pre-reset local
enrollment. Runtime evidence showed repeated Key Exchange `404` and Device
Inbox `500` responses, so the existing stale-enrollment recovery could not
observe the authoritative missing endpoint. The owner correction keeps
Station as active-device truth:

- Key Exchange converts a missing authenticated local endpoint into its typed
  `UNAUTHORIZED` error, which maps to HTTP 403 without changing material
  `NOT_FOUND` semantics.
- Conversation production HTTP maps every typed Device Inbox error to its
  stable HTTP class and `X-Peers-Error-*` context instead of collapsing it to
  500.
- The existing Device Engine recognizes the explicit 403 stale-endpoint signal,
  resets only its enrollment status to pending, and re-enrolls the same durable
  cross-signed device identity on the next lifecycle cycle.

Focused Key Exchange and complete Conversation package suites pass. Native
Chat static verification also passes, and targeted tests preserve the typed
error context. Exact-source deployment and current-profile Native rerun remain
required.

Exact-source rerun
`20260912T031128172843Z-11631fb034b8b5add3296ae0ac6f0681`
proved the stale-endpoint classification and Device Engine transition back to
pending enrollment. A clean profile-four reset immediately before the next run
allowed both devices to re-enroll, but run
`20260912T031727584709Z-6ad8e8045d5693193dd4d0526d3c3e32`
then correctly rejected Bob's pre-reset local inbox cursor against the
reset Station lane with `DEVICE_INBOX_ITEM_NOT_HEAD`.

The current-profile Provisioner now supports one explicit
`PT_CHAT_NATIVE_RESET_PERSISTENT_STATE=1` operation gated by both
`CHAT_ACCEPTANCE_RESET=1` and an exact
`CHAT_ACCEPTANCE_RESET_PROFILE=<active-profile>` match. Before deleting either
dedicated Acceptance state, it verifies the existing actor/worktree/profile
marker and rejects symlinked state. It then reconstructs each persistent state
from its read-only identity seed while excluding the old Device Engine
database and device binding. Normal runs keep the flag unset and continue to
preserve crypto, cursor, authority, and projection continuity. Focused
Provisioner tests cover reuse, reset, marker validation, and authorization.

Commit `ea23c32ff103748454881da4d38896ad3b384176` is synchronized to high-chat
as `86ce853a5590d3297b9303e54e5b67d0abbeeaaa`; both worktrees resolve tree
`0a683c3d95b23447624fe9ecc1378e76222983b0`. On that exact source, profile
`four` has current `PASS/DONE/PROVEN` evidence for:

- Friend Request run
  `20260912T033259732218Z-83448b324aa37935261e9ac66ffcfc27`;
- Desktop Gateway run
  `20260912T033419573708Z-0adc2fad958a0e37212a783f7dea46a8`;
- coupled Station/persistent-state reset Native Direct run
  `20260912T033638787114Z-fcc60adb49eb604ec051e3588a45144d`;
  and
- immediate no-reset continuity run
  `20260912T033834891235Z-3d0d26f40ad583cd4f7b8d91123a96df`.

The dedicated disposable `chat-native-four` and `chat-native-five` Stations
were then deployed to the same source. Two-Station Native run
`20260912T034546153079Z-af7aa0120e4125f73865c875a0c111cd`
attested both services and completed reverse cleanup, but blocked before
Fixture execution because the standalone driver smoke used fixed WebDriver
port `4445`, already owned by another worktree.

The driver smoke now treats port `0` as collision-free loopback allocation;
the Make target uses that mode unless an explicit
`PT_ACCEPTANCE_WEBDRIVER_PORT` is supplied. Focused resolver tests pass, and a
live smoke run passed on dynamically allocated WebDriver and Gateway ports
without touching the existing `4445/4446` listeners. Exact-source
two-Station Native rerun remains required.

The next two-Station run
`20260912T040052696673Z-d528407bc41bee9fecf2d3013351aa09`
reached `FIXTURE_READY` and dynamic driver smoke, then failed closed because
`desktop-macos-native` had no registered Runtime Cell lifecycle. The accepted
NDR-W8 contract already requires the explicit local macOS contract,
Provisioner, AppKit/CoreGraphics adapter evidence, clean source identity,
binary hash, GUI-session lease, and reverse cleanup. This is a mechanical
implementation gap under D-13, not a new product or architecture decision.

The first live lifecycle probe exposed two platform-observation defects before
any Chat journey:

1. exact-PID AppKit activation may race another native Desktop process, so the
   lifecycle must require bounded focus convergence instead of accepting one
   activation attempt; and
2. Quartz lists a transparent full-screen Dock compositor surface above the
   target window. Raw bounds and global alpha therefore do not establish the
   top visible owner at a point. The macOS adapter must sample each candidate
   window at the probe point and ignore only fully transparent samples before
   evaluating point ownership.

The same correction must read back the CoreGraphics pointer location after
posting the move event; successful API return alone is not input proof.
Focused tests must cover transparent-surface filtering, byte-order-aware alpha
decoding, focus retry/failure, lifecycle lease cleanup, and contract
registration. A repeated live host probe, the owning Infra Gate cohort, a
clean checkpoint, high-chat tree synchronization, exact-source Station
deployment, and the unchanged two-Station Native Gate remain required.

The corrected dirty-source host probe now passes on macOS 26.6.2 arm64 with a
1728x1117 connected display. It proves the dedicated Tauri process reached
exact-PID AppKit focus, the CoreGraphics pointer reached the requested point,
the first non-transparent Quartz window sample belongs to that process, and
the desktop screenshot is nonempty. Probe process, dynamic WebDriver port,
temporary screenshot, log, storage, and lease state were released.

Focused runtime-cell, binding, alpha-sample, focus-convergence, and lifecycle
tests pass 39/39. The owning Infra Gates pass:

- `acceptance-runtime-provisioning-self`
  `20260912T041726128138Z-4c2c81d24afa614dbcba790c20a46508`;
- `acceptance-plan-self`
  `20260912T041754300476Z-4da6850454a305a3d3fdd7860f09e74c`;
- `acceptance-infra-validation`
  `20260912T041802024558Z-9cee68e7d7ca9e93872e5f2feecc52e2`;
  and
- adapter-consumer `chat-native-visible-static`
  `20260912T041847932814Z-cdea8c6ff21011a8483ffa7dc2d34a17`.

Direct Infra validation is structurally valid, Quality Evidence and
responsibility-boundary tests pass, and diff hygiene passes. The documented
`make acceptance-plan-self` convenience target is absent, while the canonical
Gate above passes. Repository `skill-check` also retains the previously
recorded unrelated upstream review-rule hash drift. Neither issue changes the
macOS lifecycle result. Clean-source lifecycle evidence, high-chat
synchronization, exact-source deployment, and the product Gate queue remain
open.

At the Owner's direction, Gate execution was then paused in favor of direct
functional validation. Independent `make desktop` processes from group-chat
and high-chat exposed two environment/product boundaries:

1. the paired `chat-native-four` and `chat-native-five` profiles existed only
   as one worktree's `.local` cache, so high-chat could not select the matching
   Station through the env-repository authority; and
2. after both profiles were defined canonically in the env repository, Alice
   and Bob authenticated against the paired disposable Stations, shared active
   Federation `fed_chat_7341c15a026c42dd6d56`, remained reciprocal friends,
   enrolled their exact devices, and published prekeys, but Bob's first Direct
   message remained `draft`.

Runtime evidence isolates the product defect. Conversation created
`direct-060c1c0291de8a853548f6b289895557` and prepared the correct Alice/Bob
endpoint set. Key Exchange then rejected Alice's exact remote device with
`key_exchange.device_directory.resolve: device: is not an active verified
actor device` because the source Station queried its local-only
`actor_devices` table before federation. MP-D19 explicitly forbids a remote
Actor shadow row.

The focused correction stays in Key Exchange:

- Actor Identity remains the owner of the Actor-to-Home-Station route;
- an exact remote Direct target is routed to that Home Station without adding
  a local `actor_devices` row;
- the target Home Station still performs the authoritative active-device check
  before consuming a prekey; and
- local actors continue to require the existing local active-device lookup.

The regression removes the remote target from the source Station's test device
directory while retaining only its Actor Identity Home Station projection, and
proves the typed Federation Direct-bundle fetch still succeeds. Uncached Key
Exchange tests, Key Exchange race tests, focused Actor Identity tests,
`go vet`, formatting, and diff hygiene pass. Exact-source deployment and the
same direct functional send subsequently completed as recorded below; Gate
execution stays paused.

### 2026-09-12 Direct Functional Validation

Both disposable Stations were deployed from exact source
`f83639c695aa1e53f69302658dcb1d6eeb0f38e9` without reset. Independent Native
Desktop processes used:

- group-chat / Bob -> `chat-native-five`,
  `http://10.37.221.38:18132`, gateway `127.0.0.1:3220`; and
- high-chat / Alice -> `chat-native-four`,
  `http://10.37.245.247:18132`, gateway `127.0.0.1:3176`.

The two client source trees were equal at tree
`e9e84275451157529c83892261f075661377c517`. Direct functional verification
proved:

- the previously blocked message `01M2A078E6X4TCNPTANEYZKG5A` advanced from
  `draft` to Bob-side `delivered` and Alice-side `consumed`, with exact
  plaintext `functional-bob-to-alice-20260912-1307`;
- Alice-to-Bob message `01M2A23Z0MPTJSCVHG3PFG77AD` reached sender-side
  `delivered` and receiver-side `consumed` with matching plaintext;
- a message entered and sent through the Bob Native UI became authority event
  `afe09d31b3ccc380ece11f100f45c601`, message
  `01M2A3FYAVG7Z5XRVBKCEGCPBC`, and rendered live in the Alice Native UI;
- reply `01M2A3RA6NPV2YY7S0WBBVH6SS` and thread reply
  `01M2A3S1SZ9Z3Z32XXJGSACH4C` were consumed by Bob, while the thread root
  reported `replyCount=1` and `unreadCount=1`;
- the Native UI rendered the reply quote and thread preview, applied a thumbs-up
  reaction, replaced a message body with an `(edited)` marker, and projected a
  recalled message as `A message was recalled` on the receiver; and
- while the Alice/high-chat process and gateway were absent, Bob submitted
  `offline-bob-to-alice-20260912T071728Z` from the Native composer and initially
  saw one check. After high-chat restarted from the canonical
  `chat-native-four` profile, Alice's Native conversation recovered the exact
  plaintext and Bob's Native row advanced to two checks.

These are direct functional observations, not Gate evidence. Formal Gate
execution remains paused by Owner direction. Three-client Group/MLS functional
validation is not complete because only group-chat and high-chat currently
contain the exact source tree; the other existing worktrees differ in Desktop
source, and no third worktree was created or synchronized without explicit
authorization. Local-only screenshots for the completed functional paths are
under `.local/acceptance/runtime/chat-functional-20260912/`; they are diagnostic
artifacts and are not promoted to Acceptance Evidence Store proof.

### 2026-09-12 Friendship Projection And Third-Client Continuation

Formal Gate execution remains paused. The dependency-ready direct-functional
frontier is:

| Unit | State | Owner / boundary |
|---|---|---|
| Project Station mutual-follow truth into Desktop Contacts, Find People, and Create Group | functional pass | `socialRealtime` owns bootstrap, event refresh, and periodic reconciliation; both exact-source Stations now hydrate Actor associations and both Native clients project `data-chat-friendship-state="ready"` |
| Re-run Alice/Bob/Carol seeded-friend visibility and group-member selection in Native UI | functional pass | both Native clients show three mutual-friend contacts, Find People disables duplicate requests with `Friends`, and Create Group selects the active remote peer and enables `Finish`; retained fixtures still contain additional same-name local preset Actors |
| Route Contacts `Message` to the selected peer instead of the stale active Direct | Native functional pass | Chat consumes the runtime-owned Federation list, accepts a default only when exactly one Federation exists, clears the stale active session before Direct creation, and high-chat opens Carol as `direct-8a347c66c96357574bbf4a9e5ba795f6` with the exact selected Carol PTID |
| Recover Carol's established Actor identity or reset its disposable Station identity | parked | requires a source-defined recovery path or fresh explicit destructive authorization |
| Three-client Group/MLS functional validation | parked | depends on Carol enrollment and the corrected friend projection |
| Federation Catalog `INTERNAL_ERROR` correction | functional pass | both Stations run their exact committed worktree source and the rebuilt Native client returns typed success with current empty Catalog data instead of a decode `INTERNAL_ERROR` |
| Advance Direct READ for a message arriving while its conversation remains visible | receipt behavior pass; overall visual acceptance rejected | `messagingProjection` and `socialRealtime` now invoke the store-owned actor read-cursor action only for a visible Direct conversation, but Owner review found the newly sent row occluded by the composer and rejected overall acceptance |
| Keep the newest virtualized message above the composer | Native first-frame functional pass | the virtual timeline and bottom sentinel are non-shrinking, and layout-phase immediate tail positioning keeps the optimistic row above the composer before receipt projection; both profile-bound Native clients show zero first-observed overlap |
| Keep unresolved local drafts at their chronological position | Native functional pass | the Rust projection owner merges pending/failed rows by creation time without changing committed authority order; the Desktop projection preserves that canonical order for main and thread surfaces |
| Replace legacy remote and circular demo avatars with bundled rounded-square presets | Native functional pass | Desktop renders inline sources without cache/network access; exact-source profile four/five Station deployment migrated local demo values only; remote peers refresh from signed Home-Station profiles; Alice and Bob source hashes match across both Native clients; Actor Identity remains the sole verified device-key writer |

Concurrency Decision: serial for the friendship projection because the shared
store contract is consumed by the runtime and all three Chat surfaces. The
integrator owns the plan, shared projection, runtime wiring, UI consumers,
focused tests, source-tree reconciliation, and Native runtime verification.
Carol's retained Windows state and both Station deployments are read-only until
the recovery boundary is resolved; no reset is authorized by this continuation.

The Federation correction is also serial. The integrator exclusively owns the
Desktop Rust transport call site, its focused Federation regression, the
existing `desktop-federation` Registry rule, plan evidence, and source-tree
reconciliation. The authorized exact-source Station deployment and Native avatar
parity check are complete; formal Gate execution remains paused.

Direct Native diagnosis used the two profile-bound `make desktop` clients
without invoking a formal Gate. Alice (`profile four`) and Bob (`profile five`)
authenticated with distinct actor PTIDs. Both Station Social endpoints reported
three relationship rows while returning empty item arrays. The root cause was
`followRepository.GetFollowers` / `GetFollowing` loading `db.Follow` rows
without their `Follower` / `Following` Actor associations; the application
service then correctly skipped every nil association. The repository now
preloads those associations, and
`TestRelationshipListsHydrateActorProjections` reproduces the old
`total=1, len=0` failure and passes with the correction. Native UI proof remains
unproven until the exact changed source is deployed through the profile and
Make workflow.

The independent Federation Catalog diagnosis reproduced the failure through
the running Native Tauri bridge and correlated it with Station request
`8d4679ac-d46e-43b0-85dd-a880e8c10ef1`. Station authenticated the request,
queried both Federation members, and returned HTTP 200. Its
`server.NewTypedHandler` serializes `FederationCatalogSearchResponse` directly,
but Desktop `application/federation::catalog_search` selected
`request_peers_proto`, which attempted to decode those bytes as
`PeersResponse -> Any -> payload` and surfaced the resulting decode error as
generic `INTERNAL_ERROR`. The correction must select `request_proto` at that
application-owned protocol boundary and leave legacy Touch endpoints
unchanged. The source correction, focused old/new transport regression, Gate
traceability, Rust formatting and compile check, Registry path selection,
cross-worktree byte comparison, and diff hygiene pass in both group-chat and high-chat. Growth
decision: `acceptance_gate`,
`federation-desktop-gateway-smoke` in Domain `federation`. Full Federation
Domain validation remains blocked by the pre-existing missing `fedp5`
environment and Provisioner contracts; the environment-backed Gate and Native
authenticated Catalog Gate were not executed. A direct functional rerun through
the rebuilt profile-four Native client and embedded WebDriver returned
`{"ok":true,"data":[],"error":null}` for the same Federation and `carol`
prefix that previously returned `INTERNAL_ERROR`; the empty result is current
Catalog data state, not a transport decode failure.

Two-client Native Direct verification then proved exact plaintext and identical
message IDs in both directions, with send outcome `pending` (the Desktop
queued-success state) and device delivery reaching `delivered`. Runtime
instrumentation isolated a missing actor read-cursor transition: Bob projected
message `01M2AYD8BRZBSNBC3E12RMP1XQ` at authority sequence `19` while the
conversation remained visible, but Alice stayed at `delivered`; re-selecting
the same conversation submitted the existing cursor and immediately produced
`read`. The owner-layer correction factors Direct cursor advancement into
`socialChat.markFriendRead` and calls it from both visible projection consumers.
Post-fix Native evidence used message `01M2AYVVAD98SA3CDMGCQZJZT6`, authority
sequence `20`: Bob received the exact plaintext without re-selecting the
conversation and Alice automatically converged to `read`. Focused runtime
regressions pass `9/9` and Desktop TypeScript checks pass in both worktrees.
Formal Gate execution remains paused, and temporary instrumentation remains
open pending user confirmation under `debug-direct-read-receipt.md`.

Owner visual review rejected the overall Direct result after the receipt proof:
the newly sent row could remain behind the composer, and the demo avatars showed
the external generator's pending placeholder. These are
`RECOVERABLE_IMPLEMENTATION` items, not proof exceptions. Runtime geometry
recorded a `174.0625px` message/composer overlap for three seconds because the
virtual timeline shrank to `520.9375px` while its absolute content remained
`1272px`; its bottom sentinel therefore preceded the final row. Avatar evidence
showed retained `copilot-cn.bytedance.net` URLs even though current
`actor.yml` defines bundled inline SVG presets. The existing seed migration
preserves every non-empty avatar, and Desktop does not classify inline image
sources separately from downloadable remote media.

Concurrency Decision: serial. The layout correction owns
`ChatMessageTimeline` and Native geometry evidence; the avatar correction owns
Station preset migration plus the shared Desktop avatar primitive. Their source
write sets are disjoint, but both require the same two Native clients and
Station deployment sequence for final proof, and the bounded edits are smaller
than parallel coordination overhead. The integrator owns both worktrees,
focused tests, deployment, Native evidence, and final reconciliation.

The layout correction is now functionally proven in both profile-bound Native
clients. Alice sent `01M2B15ZD1Z27ES4ZC5RS4A9DS` and Bob sent
`01M2B281RXYFSNSEM7J0V910NM`; each newest row ended at `610px`, the composer
began at `630.9375px`, and the `20.9375px` clearance remained stable.
An additional first-frame audit rejected the remaining smooth-scroll interval:
high-chat initially exposed `35.0625px` of the optimistic row behind the
composer before settling. Tail positioning now runs in layout phase with
immediate end alignment. After rebuilding both Native clients, group-chat
message `01M2B43C1GY84D2MK8E8093RJ9` was first observed with `28.9375px`
clearance, and high-chat message `01M2B43C1WNPRK9JHACMFZ4DA4` was first
observed with `26.9375px` clearance; both had zero overlap. Screenshots confirm
the full row, timestamp, receipt, and avatar stay above the composer.
Alice and Bob also render their configured `128x128` inline SVG
presets directly in WKWebView with no external source. The opposite
participant still reads a legacy URL from its Station's remote-cached Actor
row. That row must not be rewritten by a foreign Station's preset seed.
Desktop now refreshes canonical remote handles through Federation Resolve;
the resolver caches the signed Home-Station profile without writing device
keys through the retired duplicate store. Remote runtime proof cannot start
until the dirty source is committed and deployed through `make station`; no
commit is authorized yet.

Owner review then rejected the circular appearance of those inline presets.
The login surface already used `UserSquareAvatar` with a six-pixel radius, but
the SVG payload itself contained `<rect rx="64">`, baking in a circle and
bypassing the shared rounded-square component contract. The preset source now
uses a full-bleed square rectangle, and `legacy_avatars` records the exact
retired circular values so startup upgrades existing local demo rows without
replacing custom avatars. Remote-cached rows remain Home-Station-owned.
Source and migration tests pass;
the current Bob and Alice profiles were updated through the Native
`profile_update` product path. Native Chat now renders their full-bleed
`36x36` images with an `8px` or `9px` component-owned radius, and the reproduced
Bob login surface renders its `28x28` avatar with a `6px` radius. Migration
proof for remote cached rows remains pending the same exact-source Station
deployment.

The Owner's follow-up screenshot correctly exposed two distinct residual
failures. First, Desktop Rust returned Alice's unresolved local draft
`01M2B43C1WNPRK9JHACMFZ4DA4` before committed authority sequences 31, 32, and
33, but `projectDesktopIMMessages` re-sorted every `groupSeq=0` item to the end.
The web projection no longer creates a second ordering authority; the shared
Rust merge now governs the main timeline, thread timeline, and thread latest
reply. Rebuilt Native DOM evidence records the Alice-client order as local
draft, sequence 31, sequence 32, then sequence 33, while the committed message
IDs and sender PTIDs remain identical across both clients. Focused Rust
projection tests pass 28/28, focused Desktop projection/avatar tests pass 22/22
in both worktrees, Desktop checks pass in both worktrees, and the Acceptance
static suites pass 25/25 in both worktrees.

Second, the avatar failure remains visible and is not accepted as fixed. Bob's
Home-Station client renders inline SVG
`sha256:212729014d91d3fc4b0b71d93d063592acd303437766be2529655af0e2a21d1d`
with a `9px` component-owned radius, while Alice's client still receives the
retired remote source
`sha256:c560f976b66155602b68ff31922349b9849bebf262e3778604ad219adf2160ad`
and renders initials. Both running Stations still expose commits
`944ca467db43` and `95ca267c4a68`; their old Federation resolver fails before
returning the signed profile because it writes through the retired
`DeviceStore` and violates `actor_devices.actor_acct NOT NULL`. The source fix
is verified locally, but Native cross-Station avatar parity remains
`BLOCKED/UNPROVEN` until the Owner authorizes commits and exact-source
`make station` deployment for profiles four and five. No reset is required or
authorized.

The pre-deployment source audit found that preset lookup and avatar migration
still lacked an explicit `origin='local'` fence. The Station seed owner now
selects only local Actors, and the avatar backfill helper independently refuses
`remote_cached` rows. A colliding remote-cache regression preserves its
Home-Station-owned avatar. The Federation resolver package documentation now
matches its verified-profile write-through behavior while retaining Actor
Identity as the sole device-key persistence owner.

After the authorized checkpoint commits and non-destructive `make station`
deployments, profile four reports `7d5137c77177` and profile five reports
`eecb3e6288b5`. Live Native evidence records Alice's coral source as
`sha256:4fa6e9e666c16fd453868d1fb6a21d18ee8e86ee83d9757bddc27015075c5010`
on Alice's self surface and Bob's remote surface, and Bob's teal source as
`sha256:212729014d91d3fc4b0b71d93d063592acd303437766be2529655af0e2a21d1d`
on Bob's self surface and Alice's remote surface. Every image is complete,
non-empty, and rendered as a `36x36` rounded square with the owning component's
`8px` self or `9px` message radius. Cross-Station avatar parity is therefore a
Native functional pass; the formal Gate remains paused by Owner instruction.
Evidence is under
`.local/acceptance/runtime/chat-functional-20260913-post-deploy/`.

The Owner then correctly rejected the broader message-correctness claim. Native
engine readback proves Alice's earlier command
`01M2B43C65M3QRQVK529SZTMSS` and message
`01M2B43C1WNPRK9JHACMFZ4DA4` remain only on Alice as `submitted`, with no
authority event or sequence, while Bob has no corresponding message. A fresh
Alice-to-Bob send through the running Native composer succeeded on both clients
with message `01M2BBD09646PDAD3MPQ3VWGD6`, event
`95b9340dda85c79195a06b229c0913c8`, and authority sequence `34`. This proves
the current send path is live; it does not resolve the stale submitted-command
recovery defect. Chronological projection is therefore a verified sub-fix, but
Direct transcript convergence remains `PARTIAL/UNPROVEN` until submitted
commands obtain authoritative result readback and exact-command recovery.

The submitted-command recovery and cross-Station typing branches are no longer
design-blocked. The Owner accepted MP-D31 and MP-D32 on 2026-09-13 by directing
implementation of the reviewed package. Their authoritative contracts now live
in the Messaging Platform `design.md`, `decisions.md`, `data-model.md`, and
`integration.md`; the temporary proposal was removed to preserve one source of
truth.

### NDR-W8A: Submitted-Command Canonical Reconciliation

Deliver:

- Proto-first bounded result request/response for at most 64 exact command refs.
- Conversation-owned resolver backed only by authority receipt, Federation
  authority-command outbox, and canonical Device Inbox command-result state.
- Device Engine lifecycle reconciliation on startup, reconnect, and explicit wake.
- `HOME_PENDING` retention, accepted/rejected local settlement, and exact-byte
  `NOT_FOUND` retry under the same command ID.
- No synthetic Inbox item, lane cursor, authority-head mutation, or restored
  proposal result route/store.

Evidence:

- Local accepted-response loss, remote pending restart, accepted/rejected result
  loss, exact replay, hash/endpoint conflict, and later Inbox idempotency tests.
- Native convergence of command `01M2B43C65M3QRQVK529SZTMSS` without hiding or
  replacing message `01M2B43C1WNPRK9JHACMFZ4DA4`.

### NDR-W8B: Authority-Mediated Federated Typing

Deliver:

- Proto-first `CONVERSATION_TYPING` payload and typed admission/fan-out signal.
- Shared Federation receiver registry fixes this payload to bounded in-memory,
  no-outbox, no-inbox, no-retry execution.
- Sender Home routes admission to Conversation Authority; Authority selects active
  recipients and groups them by verified Home Station.
- Recipient Home validates source, target, authority, recipient, generation, and
  expiry before local Event Bus publication.

Evidence:

- Direct start/stop/lost-stop TTL/session-switch/disconnect across profiles four and
  five.
- Group fan-out across at least two Stations, deny paths, partial failure, overload,
  and zero durable typing-row proof.

### NDR-W8C: Federated Contact Identity And Group Genesis Reliability

Deliver:

- Station Federation Actor resolution updates an existing remote-cached Actor by
  canonical PTID instead of failing on the `idx_touch_actor_ptid` uniqueness
  boundary; signed Home-Station profile fields, including avatar, handle, domain,
  and Station peer ID, remain authoritative.
- Proto-first relationship projections expose the Home Station peer ID already
  owned by Actor identity, with generated Go, Desktop, and Mobile bindings updated
  in one atomic contract cut.
- Desktop `socialRealtime` and `friendshipProjection` own one PTID-keyed Chat Actor
  identity projection. Contacts, Create Group, session rows, search, and contact
  detail consume the same display-name, avatar, federated-handle, Home Station, and
  Federation fields without display-name deduplication or component-local avatar
  precedence.
- Contacts and Create Group render the actor name first and quiet Federation /
  Home-Station identity metadata second, with separate readable labels that do
  not ellipsize away the distinguishing Station value, so distinct same-name
  actors remain visibly distinguishable.
- Create Group keeps the dialog, name, and selected PTIDs alive until the command
  is accepted. Typed preparation or MLS-readiness failure remains inline, identifies
  the affected actor or Station when the server provides it, and offers retry
  without replacing the conversation or member identities.
- A committed Group may remain `establishing` while the creator Device Inbox
  projects sequence 1. The Desktop must reconcile through the existing messaging
  lifecycle and must not convert temporary `conversation_members_unavailable`
  projection lag into a false creation failure.
- The Social Chat prototype mirrors the same identity hierarchy and recoverable
  Group-creation states; mock behavior remains clearly non-authoritative.

Evidence:

- Station tests prove remote Actor refresh updates the existing PTID row and does
  not create, merge, or overwrite another same-name Actor.
- Relationship wire tests prove `home_station_peer_id` for local and remote mutual
  friends, and generated bindings are clean.
- Desktop projection tests prove one PTID produces one avatar source on every Chat
  surface while two same-name PTIDs remain distinct and expose their exact
  federated handle, Home Station, and Federation.
- Create Group component tests prove pending state, preserved input/selection,
  typed inline failure, retry, and accepted `establishing` transition.
- `chat-native-group-mls-e2e` launches three source-bound Native clients through
  `NativeDesktopRuntimeBinding`, selects members through the visible Create Group
  dialog, proves same-name identity metadata and avatar parity, creates the MLS
  Group, sends/decrypts across all members, removes one member, restarts, recovers,
  and completes reverse cleanup.
- The Gate must fail before product proof when any client, actor, Station binding,
  endpoint manifest, KeyPackage, or source identity is absent. Harness-only
  `createGroup` calls do not prove the visible Group-creation journey.

Concurrency Decision: serial implementation with parallel read-only audits. Shared
relationship proto and generated artifacts are frozen first; Station remote-cache
upsert and Desktop projection/UI then consume that contract in dependency order.
The integrator exclusively owns the plan, proto/generated artifacts, shared
projection, Acceptance contracts, final reconciliation, deployment, and Native
proof. Existing `audit_contact_identity`, `audit_group_create_500`, and
`audit_group_acceptance` agents remain read-only evidence lanes and must not edit
the shared write set.

NDR-W8C source closure on 2026-09-13:

- Station remote Actor cache reconciliation searches by canonical handle, legacy
  handle, or exact PTID and refreshes the existing `remote_cached` row by stable
  database ID. It rejects local ownership takeover, stale locator sequence, and
  split handle/PTID identity instead of swallowing the unique-index failure.
- `home_station_peer_id` is carried proto-first through Station relationship
  projections and generated Go, Desktop, and Mobile bindings.
- `socialRealtime` refreshes every mutual-friend profile, and
  `friendshipProjection` is the single PTID-keyed source for Contacts, Create
  Group, search, session, and detail identity. Display name never acts as an
  identity key.
- Contacts and Create Group render Federation and Home Station as separate,
  readable metadata lines. The Gate records both visible labels and fails if
  either clips; the same PTID retains one authoritative avatar source.
- Create Group keeps the same draft conversation ID and selected PTIDs through
  typed inline failure, exposes Retry, treats an accepted pending command as
  `establishing`, and reconciles Device Inbox projection in the background.
- The Native Group/MLS Gate launches three bound clients, selects members through
  the visible dialog, verifies same-name metadata/avatar parity, waits on real
  MLS readiness, proves send/decrypt/restart/removal, exercises typed unavailable
  member recovery, and performs reverse cleanup. Harness `createGroup` is not a
  product action.
- Canonical Prototype Portal L2/L3 verification at desktop and narrow desktop
  widths proves distinct Bob rows with full `aspen.social` / `harbor.social`
  Station labels, full-row selection, preserved selection after inline failure,
  enabled Retry, and mock-success transition. Prototype evidence remains
  non-authoritative for Native product proof.
- Focused Desktop tests, Desktop contract/type checks, prototype build, 147
  Chat runner/static tests, Chat structural validation, exact-path Acceptance
  planning, local Acceptance framework Gates, proto generation, Station package
  tests, and `git diff --check` pass. The immutable Evidence Store latest runs
  remain the source of truth for exact-tree static evidence.
- Acceptance Gap Detector keeps the overall product claim `UNPROVEN` because
  exact-source environment Gates, especially `chat-native-group-mls-e2e`, have
  not run against this uncommitted source.

Source verification on 2026-09-13:

- `go test ./subserver/conversation/...` from `apps/station/app`: PASS.
- `go test ./core/federation/...` from `apps/station/frame`: PASS.
- Desktop
  `submitted_command_reconciliation_is_bounded_exact_and_cursor_neutral`: PASS.
- Desktop `reconciliation_integrity_failure_rolls_back_the_whole_batch`: PASS.
- Messaging Platform MP-D31/MP-D32 static contract tests: 2/2 PASS.
- Historical command-result item identity migration regression: PASS, including
  lane/state/receipt preservation and idempotent restart.
- `station-api-ownership`: PASS with 64 declared capabilities, 64 governed
  routes, and zero diagnostics after moving protobuf decoding out of the
  Conversation application layer and registering `chat.command.results`.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop`:
  PASS with existing warnings.
- `pnpm --dir apps/desktop run check`: PASS after proto generation completed.
- Source-bound Acceptance runs PASS for `proto-build`,
  `station-messaging-unit`, `messaging-platform-contract`, `desktop-check`,
  `chat-native-visible-static`, `station-federation-unit`,
  `acceptance-plan-self`, `acceptance-infra-validation`, and
  `acceptance-runtime-provisioning-self`.
- `git diff --check`: PASS.

These checks prove current-source composition and deterministic behavior only.
They do not prove the historical stale command or cross-Station Native typing
journeys until exact source is deployed to the authorized profiles.

Runtime preflight on 2026-09-13:

- `chat-native-four` resolves to remote Station
  `http://10.37.245.247:18132`, deploy env `chat-native-four`, and is healthy,
  but still runs old source `7d5137c7`.
- `chat-native-five` resolves to remote Station
  `http://10.37.221.38:18132`, deploy env `chat-native-five`, and is healthy,
  but still runs old source `eecb3e62`.
- The canonical source-sync path deploys `git rev-parse HEAD` only. W8A/W8B
  remain uncommitted at HEAD `98943699e45a42f6e1fd7a9bd203c69f0442f501`;
  running `make station` now would deploy the old tree and cannot produce
  source-equal evidence.
- No Station deploy, restart, reset, commit, push, or retained-data mutation
  occurred during this preflight.
- Acceptance Gap Detector correctly remains `UNPROVEN`: exact-source Native
  receiver evidence has not run. Hard Rules pass. Existing debugger probes and
  their two local notes remain outside the W8A/W8B commit scope.
- Current-source Native run
  `20260913T044313706662Z-7989d692b28abfa2f4bac52c5ce92758`
  proved both client launches, authentication, source/tree/Station identity,
  persistent storage isolation, conversation opening, peer bundled-avatar
  rendering, and complete cleanup. It stopped before message delivery because
  the Gate treated the intentionally absent self participant avatar as a
  failure. The business Gate now requires every seeded actor to render
  correctly on at least one remote client and preserves cross-client source
  equality whenever multiple renderings exist; the focused 20-test suite
  passes. Product delivery remains `UNPROVEN` until the corrected Gate reruns.
- Corrected current-source run
  `20260913T045407959841Z-0fda933ef3fa02ade261538a57bf4769`
  is `PASS/DONE/PROVEN`: both synchronized worktrees authenticated persistent
  Alice/Bob devices, rendered bundled peer avatars, sent and decrypted exact
  plaintext in both directions, observed `read` receipts, preserved message
  geometry, and released all six ports and both client processes without
  resetting persistent storage.
- Retained profile `four` run
  `20260913T050317260685Z-605561cd95e5adb8e69d53f5b749911c`
  proved both historical client identities and conversation opening, then
  exposed a Gate classification gap: retained custom Home-Station avatars
  render from the local `asset://localhost` cache and must not be treated as
  seeded inline fixtures. The corrected assertion preserves the strict bundled
  requirement for seeded sources and accepts retained custom sources only from
  the bound Station when the rendered image is a completed local asset.
- W8A retained proof now accepts an explicit
  actor/conversation/message/command tuple and requires the original command
  identity, committed ledger/outbox/intent, positive authority event sequence,
  preserved message identity, and peer projection before it can emit
  `submitted_command_converged`.
- `station-four` is healthy on the exact source. `station-five-arm` built the
  exact source but remains parked because its retained database still contains
  the forbidden pre-CA-W5 `conversations.current_seq` column; startup fails
  closed and no reset or data rewrite was performed.
- Exact-source current-profile runs
  `20260913T052304409661Z-4c3bbe7d7133732d356f082ec55230ad` and
  `20260913T053306894661Z-748dbecc1ed1c9055cb0ed9d1dad3836`
  correctly failed `command.reconciliation` and completed cleanup. The supplied
  tuple belonged to the separate `chat-native-four` retained client, while the
  selected `four` Acceptance storage had been initialized under its own actor,
  Station, and Device Engine identity and contained no matching command or
  message row. This is a proof-binding defect, not evidence that the W8A worker
  failed.
- Read-only SQLCipher inspection of the original `chat-native-four` retained
  store proves command `01M2B43C65M3QRQVK529SZTMSS` retained byte-identical
  local/outbox payloads and the original message
  `01M2B43C1WNPRK9JHACMFZ4DA4`. The command is no longer `submitted`: exact
  replay reached typed `STALE_DELIVERY_PLAN`, the original attempt became
  `superseded`, and the logical message remained for the MP-D17 fresh-plan
  attempt. This is terminal convergence, not accepted delivery, and must not be
  reported as receiver-visible success.
- NDR-W8A Native proof is mechanically amended to create or bind a
  run-controlled retained submitted state before launch and to assert one of
  the architecture-defined terminal outcomes. `NOT_FOUND` must retry the exact
  command ID and bytes; only a later typed `STALE_DELIVERY_PLAN` may supersede
  that attempt and prepare a new command while preserving the message ID.
  Missing target state must fail during preflight instead of polling for two
  minutes. Accepted convergence additionally requires the same message ID on
  the peer; terminal convergence requires explicit failure/supersession
  evidence and no false receiver projection.
- Exact-source run
  `20260913T062223002207Z-a96048bde6d1f4b0111d21d7f82be44d`
  proved the retained W8A branch on Native clients: source/build/Station
  identity matched commit `89fda643d8a25b71bbebafc50444067a1cb27a12`,
  isolated retained Alice SQLCipher state loaded the exact original
  command/message/hash, terminal `superseded/stale_delivery_plan` matched the
  accepted state machine, Bob had no false projection, and cleanup released
  all six ports and both client processes while retaining isolated storage.
  The composite current-profile Gate later failed its unrelated fresh
  Bob-to-Alice smoke because retained Alice and fresh Bob were not one prepared
  crypto pair. W8A therefore receives the dedicated
  `chat-native-submitted-command-recovery-e2e` Gate; the existing
  `chat-native-current-profile-two-client-e2e` remains the independent fresh
  bidirectional Direct proof and is not weakened by a recovery-only mode.

Concurrency Decision: hybrid. The integrator serially owns authoritative docs,
shared proto, generated artifacts, composition/registry files, final reconciliation,
commit, deployment, and Native proof. After proto generation freezes the contract,
NDR-W8A Station/Desktop implementation and NDR-W8B Federation/Conversation
implementation may proceed in parallel only with disjoint write sets and focused
checks. Deployment and shared runtime evidence remain serial.

Carol three-client Group/MLS remains parked because creating another worktree is a
separate Git topology operation. No reset, commit, push, deployment, branch switch,
or worktree creation is implied by MP-D31/MP-D32 acceptance.

### 2026-09-13 W8A/W8B continuation checkpoint

- PR `#111` merged as `2d54851f95994d717928105aca6470c30adf3657`
  with the Development Workflow control plane, W8A/W8B Acceptance repairs, the
  exact submitted-command fixture, and synchronized Native client history.
  The post-merge function-first checkpoint is
  `eb0c803afde939ca678f9bafccf0efdc7d4efe32`.
- `peers-group-chat` is clean at `eb0c803af`; `peers-chat-high-chat` remains
  clean at `7c7575001`. Before the next Native launch, reconcile high-chat to
  the exact current checkpoint without reset, force update, or a new worktree.
- `chat-native-four` and `chat-native-five` were non-destructively deployed and
  attest build commit `1db3461b354a`. They do not yet attest the later
  `2ff2cd9ca` source checkpoint.
- The exact retained identity is:
  - actor: `alice`;
  - conversation: `direct-060c1c0291de8a853548f6b289895557`;
  - message: `01M2B43C1WNPRK9JHACMFZ4DA4`;
  - command: `01M2B43C65M3QRQVK529SZTMSS`;
  - expected outcome: `terminal_superseded`;
  - retained command SHA-256:
    `e73be505f57465f67a6835e0d7768481f713f1f7c796645ff974258f6fda3a75`.
- Run `20260913T133705385798Z-f3272b11978049b29f232b5c4566fdee`
  is `FAIL/PARTIAL/UNPROVEN`: an interrupted predecessor left the Native cell
  occupied. Cleanup subsequently removed the stale processes and released the
  six declared ports.
- Run `20260913T134222022937Z-8e861a0e0457040fdd46c394f4125914`
  is `FAIL/PARTIAL/UNPROVEN`: source/build identity, cross-worktree topology,
  two Native clients, actor/device isolation, and cleanup passed, but the stale
  `direct-8933203d465fd79ac34b9b33953757a2` summary identity did not bind the
  retained command.
- Run `20260913T134640973568Z-3bb4d59d7b053fe256345c39086ae6a5`
  is `FAIL/PARTIAL/UNPROVEN`: the corrected conversation bound the exact command,
  and exposed the retained logical pending row as `failed` after its replacement
  command also failed. The fixture now accepts that terminal shape only under
  the existing no-projection/no-active-replacement fences; its focused Rust
  regression passes.
- The continuation follows Development Workflow function-first ordering. After
  exact-source deployment, run only
  `tooling.acceptance.gates.chat.native_submitted_command_recovery_entry` as
  the bounded W8A Native functional journey. Run its formal validator and
  catalog Gate only after that journey reaches `FUNCTIONAL_PASS`. Apply the
  same split to W8B: run `tooling.acceptance.gates.chat.native_typing_runner`
  as the bounded Direct/Group functional journey first, and invoke the formal
  `chat-native-typing-e2e` Gate only after the product journey passes. Any
  first actionable failure returns to owner-layer implementation and focused
  checks; it does not trigger a broad Acceptance matrix.
- Current-source focused preflight found and corrected one stale static
  assertion that rejected the production-safe
  `cfg(any(test, feature = "acceptance-webdriver"))` boundary. The focused
  assertion and the 97-test Native Chat contract suite pass; this is
  `SOURCE_CHECK`, not runtime proof.
- The same checkpoint passes the exact Rust submitted-command fixture
  regression, 24 W8A runner tests, focused W8A/W8B Conversation and Federation
  Go packages, 29 W8C Desktop projection/group tests, 56 W8C/W9/W10 Native
  runtime-binding tests, and 16 Local Development profile/deploy-resolution
  tests. These results establish source readiness only; they do not replace a
  Native functional journey or formal Acceptance proof.
- Final exact-source redeployment is currently blocked by the Local Development
  Control Plane: the external `env` repository contains
  `peers-touch/chat-native-four` and `peers-touch/chat-native-five`, but those
  environment definitions are untracked. The new governance rule correctly
  rejects `make profile` and `make station` until the Environment Owner
  Git-tracks/reviews those existing profiles. Do not bypass this guard by
  invoking `deploy.sh` directly or by creating an authorization file.
- After the Environment Owner resolves that tracked-profile gap, deploy the
  current MR HEAD to both Stations, verify `/app-meta/version`, and rerun
  `chat-native-submitted-command-recovery-e2e` with
  `PT_CHAT_NATIVE_PREPARE_SUBMITTED_COMMAND=1`,
  `PT_CHAT_NATIVE_RETAINED_ENGINE_STATE_ROLES=alice`, the two existing W8A
  persistent storage roots, and the exact tuple above.
- NDR-W8B remains source-complete but runtime-unproven. Direct start/stop,
  lost-stop TTL, disconnect, and session-switch plus Group cross-Station fan-out,
  deny, partial failure, overload, and zero durable typing-row evidence remain
  required after W8A.

### 2026-09-13 Goal Fixed-Point Exhaustion

- The current checkpoint is
  `8b236f43367cff0368a39f44d597adaaadfc608e`. Its focused W8A/W8B/W8C and
  W9/W10 source checks pass, and the worktree is clean.
- Three consecutive Goal intervals confirmed that
  `peers-touch/chat-native-four` and `peers-touch/chat-native-five` remain
  untracked in the external `env` repository. `make config` fails closed with
  `Profile 'chat-native-four' is not Git-tracked in the env repository`.
- No dependency-ready runtime action remains in the bound `peers-group-chat`
  worktree. High-chat synchronization, both Station deployments, W8A, W8B,
  W8C, W9-D, and W10-D all depend on the Environment Owner committing the two
  exact profiles first.
- Additional hard resource boundaries remain explicit: W8C needs authorized
  third-client topology, PostgreSQL proof needs `MESSAGING_TEST_POSTGRES_DSN`,
  and required Mobile physical proof has no online iPhone or Android device.
- The Goal is therefore blocked without weakening runtime identity, bypassing
  the profile resolver, crossing the selected worktree ownership boundary, or
  substituting static/simulator evidence for required Native proof.

### 2026-09-13 Canonical Four/Five Resume

- The Owner selected the existing canonical `four` and `fiveArm` profiles in
  place of `chat-native-four` and `chat-native-five`.
- Environment commit `55b4985` promotes the pre-existing
  `station-four` and `station-five-arm` deploy definitions into the reviewed
  env repository without staging unrelated env changes.
- `peers-group-chat` and `peers-chat-high-chat` are synchronized to
  `2c95f8d14f15bcda51b05f0335937ed275c91d59`; group-chat selects `four` and
  high-chat selects `fiveArm`.
- Canonical `four` deployed successfully and `/app-meta/version` reports
  `2c95f8d14f15`.
- Canonical `fiveArm` source sync and image build completed at the same commit,
  but startup fails closed because its retained `conversations` table still
  contains the forbidden pre-CA-W5 `current_seq` column. Read-only inspection
  shows both `current_seq` and canonical `current_sequence` and zero rows.
- No database reset or DDL was performed. The accepted hard-cut plan forbids
  resetting shared `:18080` Stations, so fiveArm recovery requires an explicit
  owner-approved data operation or a different accepted topology before W8A
  functional execution can begin.
- The Owner subsequently authorized the exact canonical `four`/`fiveArm`
  execution path. For `fiveArm` only, the approved recovery is an empty-schema
  clean-slate operation: stop the Station, prove every `conversation*` table has
  zero rows, save a schema-only backup, transactionally drop only that empty
  Conversation table family, then restart exact source and require the
  canonical schema guard plus health check to pass. Abort before mutation if
  any Conversation row exists. This does not authorize a database-volume reset,
  non-Conversation mutation, or reset of canonical `four`.
- After the scoped reset exposed stale device ownership on canonical `four`,
  the Owner explicitly authorized a full reset of both `four` and `fiveArm`
  development environments with no data preservation. The approved operation
  removes only each `pt-station` Compose project's `pg_data` and `peers_data`
  volumes, redeploys exact source, and rebuilds Native client state from clean
  development identities. The historical W8A command tuple is retired after
  this reset; the next W8A proof must create and bind a new exact tuple before
  exercising submitted-command recovery.

### 2026-09-13 W8A Functional Pass And Validator Correction

- Canonical `four` and `fiveArm` both report exact build
  `b5f42f721d0c`; both Native client worktrees are clean at full commit
  `b5f42f721d0c6635eba74e4d4df55c62429287e2`.
- The bounded W8A product entrypoint in run
  `20260913T163733726022Z-1a649100132ca245d99b69a50f0f30cc`
  reached `FUNCTIONAL_PASS`. It generated and staged command
  `01M2DT76RX52W4J6G9T8GS1BN3` for message
  `01M2DT76MBCG8W64K2TX0A5FJX` in
  `direct-173e0baa1fc7de528ef29e279c86f51a`, restored the exact bytes and
  identifiers, committed the authority result, produced the delivered sender
  projection, rendered the plaintext on Bob, and released both clients and all
  six ports.
- The formal catalog result is still `PARTIAL/UNPROVEN`: after the product
  report passed, the shared validator rejected the valid
  `submitted-command-recovery` journey because it hard-coded
  `direct-delivered-receipt`; its next profile check also treated only one
  current-profile Gate ID as sharing a client profile.
- The Acceptance-only correction derives the journey and profile-topology rule
  from the Gate variant. Its 25 focused tests and Python compilation pass.
- Final exact-source Gate
  `20260913T164933497898Z-87194509f71e18677704f12aea7e5805`
  is `PASS/DONE/PROVEN` at
  `638679c0e54a2c657fa208cff390210d6fa47322`. It generated command
  `01M2DTWRTS6JBMBSN4WTKSHX5Q` / message
  `01M2DTWRQ7FVRJ24EZRQB3V7X9`, preserved command SHA-256
  `ff08c0830a46ccbe7344870484acc17db1f4c693c2b7576946feaa6aede40acb`,
  reached authority event sequence 6, rendered the exact plaintext on Bob, and
  passed immutable validation and cleanup.
- NDR-W8A is complete for the required macOS current-profile cell. The next
  dependency-ready closure is NDR-W8B's cross-Station Direct/Group typing
  journey on canonical `four` and `fiveArm`.
- W8B preflight found its Chat-specific
  `native-tauri-embedded-webdriver` Provisioner still referenced retired,
  untracked `chat-native-four` / `chat-native-five` profile and deployment
  names. The source correction keeps stable Runtime Manifest service IDs while
  mapping them to canonical `four` / `station-four` and
  `fiveArm` / `station-five-arm`. The 58-test provisioning model suite and
  Python compilation pass. This is a mechanical environment-injection repair;
  it does not change MP-D32 or product behavior.
- The same preflight found that protected-port reset authorization could name
  only the active profile, while W8B binds actors to two approved Stations in
  one Runtime Manifest. The reset owner now accepts an explicit, comma-delimited
  `CHAT_ACCEPTANCE_RESET_ENVIRONMENTS` allowlist that is mutually exclusive
  with the single-profile authorization. Every listed deployment is still
  checked against its exact URL origin, host, Compose project, Station and
  PostgreSQL containers, and PostgreSQL volume before any reset. The Owner's
  existing authorization covers exactly `station-four,station-five-arm`; it
  does not extend to another environment.
- Initial W8B run
  `20260913T170741743805Z-9709474e3fb32082d62e4187644731d2`
  is `BLOCKED/UNPROVEN` before Fixture mutation: the reset child receives the
  reviewed deployment name but no redundant Station URL argument. The
  authorization owner now derives the exact Station origin from that
  deployment's reviewed health URL and revalidates scheme, host, port, path,
  Compose project, containers, and volume. The focused reset suite passes
  20/20.
- Exact-source W8B run
  `20260913T171324341841Z-e084a3bc6581dc49f375c28c34f86113`
  reached all three isolated Native clients after resetting both approved
  Stations, then stopped at its first product action because the runner omitted
  the now-required `federationId` from `createDirectConversation`; cleanup
  released all clients, ports, storage, and sessions. Native Chat runners now
  resolve one Federation shared by their participating clients and supply that
  stable ID to every programmatic Direct or Group creation. The 161-test
  focused Native suite passes. No product API fallback or inferred default
  Federation is added.

### 2026-09-13 W8B Canonical Federation Runtime Boundary

- Exact-source W8B run
  `20260913T172916171669Z-08cced18a98560673115310c4a9e1725`
  reached three authenticated Native clients, resolved shared Federation
  `fed_chat_fc4d197a2cca84c9a142`, and then failed its first Direct creation.
  Station `four` request
  `799bbec1-632a-4c22-a7ea-1328f9264c51` returned HTTP 500 with the typed
  owner error `transport_unavailable: no direct or relay route is available`.
  Reverse cleanup passed for all three clients, nine ports, sessions, logs, and
  ephemeral storage roots.
- Both canonical `:18080` Stations attest exact source
  `6e2de9065ce531bfa458e4f766a248782951e77d`, but their live Federation health
  is not ready: `peers=0/1 connected=0 seeds=0/0`. Their containers run with an
  empty `PEERS_BOOTSTRAP_NODES` and `RELAY_CLIENT_ENABLED=false`.
- The previously functioning disposable pair proves the intended existing
  topology: both Stations use the shared relay/bootstrap service at
  `10.37.118.48`, whose DHT seed is healthy. The canonical runtime repair is to
  mount `four` and `fiveArm` to that same Federation-owned relay, retain their
  distinct Station identities, and require `ready=true`, one connected seed,
  and a live relay mount before another W8B product run.
- This is a runtime-composition correction under the accepted Federation and
  service-coordination contracts. Conversation must not add a default
  Federation, direct-URL fallback, synthetic peer route, local remote-Actor
  device row, or relaxed product assertion.
- After both Stations reached ready DHT and live relay mounts, run
  `20260913T174952713386Z-87e46bac15e72bb351f1e60c14365984`
  stopped before product execution because an unrelated macOS notification
  window covered the runtime probe's single hard-coded center point. The target
  Tauri PID was frontmost with a main window, the pointer reached the requested
  coordinate, the screenshot was nonempty, and reverse cleanup passed. The
  runtime-cell repair keeps exact-PID point ownership mandatory while selecting
  from a bounded set of interior points; a fully occluded target still fails
  closed.
- Exact-source run
  `20260913T175848391418Z-3b5935130122198e6f2c2136d44e63ee`
  then reached `LEASED`, authenticated all three Native clients, created Direct
  Conversation `direct-6358c09fed2e2b37704e656c4a11029b`, and accepted
  Alice's typing submission, but timed out waiting for Bob's active typing
  projection. Live Station and PostgreSQL inspection found the first missing
  owner edge: the Authority snapshot held Bob's verified active member device
  and Home Station while its local Actor Identity device table correctly held
  only Alice. `productionTypingRouteDirectory` incorrectly queried that
  local-only table, selected no remote recipient, and therefore emitted no
  `HOME_FANOUT` frame.
- The owner-layer correction resolves current typing routes through the existing
  signed Actor endpoint-manifest capability, then converts those verified
  routes for Authority fan-out. It does not create remote Actor device rows,
  change Conversation membership ownership, persist typing, or add a transport
  fallback. The focused Conversation typing and manifest-route tests pass;
  exact-source W8B functional and formal proof remain pending.
- Corrected-source macOS run
  `20260913T182125546615Z-35457b8cb2e21fce52d06f9a497d196e`
  remained `BLOCKED/UNPROVEN` before product execution because another
  declared Goal's Native Desktop process retained the global foreground.
  Exact-source service attestation and reverse cleanup passed; the W8B product
  fix was not classified by this run.
- The independent Linux cell run
  `20260913T182722850347Z-3ee750b6db838f8fde0a74a3af71df57`
  then exposed source drift in NDR-W5: the active tree retained the Linux
  provisioner and runtime-cell contract but omitted the five declared
  `tooling/acceptance/images/desktop-linux/` image/control files. Those files
  are restored byte-for-byte from their last reviewed source. The 88 focused
  runtime/provisioning tests and the 8-test Acceptance Infra ownership boundary
  pass; the Linux W8B retry remains pending on a clean checkpoint.
- Linux retries then exposed three independent pre-product infrastructure
  defects. `pnpm install --frozen-lockfile` rejected a missing
  `@lobehub/ui@5.25.0` peer snapshot, the runtime host exhausted `/data00`
  while copying the Desktop bundle, and structured evidence redacted the
  required public `hostKeySha256` attestation digest. The lockfile was repaired
  with `pnpm@9.12.0 --fix-lockfile`, 140.9 GB of reclaimable Docker build cache
  was removed without touching active containers or volumes, and the redaction
  allowlist now preserves that exact public-key digest. Frozen install, the
  Desktop production build, 27 redaction tests, 48 Native runner tests, and the
  8-test Acceptance Infra ownership boundary pass.
- Exact-source Linux run
  `20260913T191930463781Z-d79f99f73123baed02b21b7a1b4f70c8`
  reached a fully attested `LEASED` runtime cell and three authenticated Native
  clients at `d0e71cfc5579f50fc903b1d26457d9d4624e8ff4`. Its first Direct
  typing request was rejected with
  `CONVERSATION_INTERACTION_INVALID_ARGUMENT` before Authority admission.
  Runtime clocks proved the Linux client host approximately 25 seconds ahead
  of both Stations: its five-second expiry therefore appeared approximately
  30 seconds in the future. Conversation policy already declares a one-minute
  `MaximumFutureClockSkew`, but typing submission and federated-frame
  validation compared expiry only with `MaximumTypingTTL`. The owner-layer
  correction now applies the accepted future-skew bound to both validation
  hops while retaining the existing expiry/TTL fields and zero-durable-write
  design. The focused interaction regression, race-enabled interaction suite,
  complete Conversation suite, and Go style check pass; the next action is the
  corrected exact-source W8B journey.
- Exact-source Linux run
  `20260913T193744123578Z-eab0d94c15b1d61ed948a3977deba835`
  proved the clock-skew correction: Direct typing start and explicit stop both
  reached Bob in 51 ms. The next immediate start was accepted by the HTTP API
  but not dispatched because `MemoryTypingPulseLedger` throttled every
  `is_typing=true` pulse within the minimum interval, including the legitimate
  `false -> true` state transition. The owner-layer correction now throttles
  only repeated active heartbeats while preserving stop priority and
  generation fencing. Focused, race-enabled, complete Conversation, and Go
  style checks pass; the next action is the corrected exact-source W8B journey.
- Exact-source Linux run
  `20260913T195024793204Z-4a1b87d2b764219f6f23c903a2876abf`
  then passed Direct start/stop, send-clear, and blur-clear. It stopped when
  the typing Gate tried to create an Alice-Charlie Direct solely as a
  session-switch target; production correctly returned 403 because the
  authorized reset fixture establishes only the Alice-Bob friendship.
  The Gate correction creates its already-required three-member Group before
  Direct lifecycle checks and uses that authorized Conversation as the switch
  target. It does not add friendship state, weaken `create_direct` policy, or
  change product behavior.
- Exact-source Linux run
  `20260913T200454558427Z-b3ff47afc56c7e699932520f250be3ce`
  reached all three authenticated Native clients at
  `47fa9efe15df5f39b4d53f4cbfcbb38258c614d9`, then failed before Direct
  lifecycle proof when the required three-member Group was prepared. Station
  `four` request `0f682ff7-4185-4c32-a221-9379af09d746` failed with
  `actor_identity.resolve_actor_home_station: home_station_peer_id: is not
  available from Actor Identity`. Readback proves the Fixture materialized
  Alice locally and Bob as a remote cache entry on `four`, but omitted
  Charlie's actual `fiveArm` PTID; `fiveArm` held Bob and Charlie locally and
  Alice remotely. The nearby Direct bundle 403 belongs to independent
  background Direct-session loading and is not the Group failure.
- This is a Fixture ownership gap against the already accepted
  Alice/Bob/Charlie contact baseline, not a Conversation routing defect. The
  correction expands the bound-actor Fixture to every declared cross-Station
  actor pair and makes repeated remote-cache seeding preserve the existing
  Actor row and relationships. Conversation continues to require Actor
  Identity-owned Home Station routing and signed endpoint manifests; no
  fallback route, remote Actor device row, or Social policy weakening is
  permitted. The combined Fixture owner, reset, Native runtime contract, and
  interaction-static regression cohort passes 118 tests; W8B remains
  `UNPROVEN` pending the clean exact-source Native rerun.
- Exact-source Linux run
  `20260913T202839608169Z-ba24c341d2887a86c03ffdf9dc1b96a6`
  proved the Fixture correction: Group preparation and creation advanced with
  all three bound actors present. The first recipient `syncGroup` then observed
  the already specified temporary `conversation_members_unavailable` projection
  state and the W8B runner treated it as terminal. The runner must use the
  existing bounded Group projection reconciliation pattern, require the exact
  Alice/Bob/Charlie member set before proceeding, and continue to fail closed
  on timeout or a permanent product error. Cleanup and exact-source Linux
  attestation passed; W8B remains `UNPROVEN`.
- Exact-source Linux run
  `20260913T203959427403Z-c037f553f13e623df00b8f40cde9c419`
  proved the bounded Group projection reconciliation and resumed Direct typing,
  including start and stop. It then failed in the Gate's zero-write readback
  before further product assertions because the diagnostic SQL queried removed
  `conversation_read_cursors.reader_ptid`; the canonical schema stores `ptid`.
  The evidence helper must read and order by `ptid`, retaining the external
  JSON field `readerPtid`. Runtime attestation and cleanup passed; W8B remains
  `UNPROVEN`.
- Exact-source Linux run
  `20260913T205014307722Z-e8e9ca6e38c5ba98f4aec6166d5cc96a`
  passed all Direct and Group typing lifecycle assertions through disconnect,
  then failed at `removeGroupMember`. Station `four` returned
  `CONVERSATION_INVALID_ARGUMENT` from membership preparation because that path
  still enumerated the authority-local `actor_devices` table. The committed
  Group contained Alice, Bob, and Charlie, but the local device table correctly
  contained only Alice.
- Accepted MP-D19 requires send, genesis, and membership preparation to consume
  signed Home Station endpoint manifests. The owner-layer correction passes
  server-resolved verified routes into membership prepare and submit, binds
  manifest set and stable-state hashes into the Authority Plan, and removes
  authority-local remote-device lookup from this path. It adds no remote Actor
  device row and no routing fallback. Cleanup and exact-source attestation
  passed; W8B remains `UNPROVEN`.
- Concurrency decision for this MP-D19 correction is serial. The membership
  request contract, production HTTP/Federation adapters, DDD fixtures, commit,
  deployment, and W8B rerun share one Go package and one exact-source boundary;
  no independent write lane can avoid overlapping those contracts. Read-only
  inspection remains parallel-safe.
- The source correction now binds both manifest hashes during prepare, refreshes
  one shared signed-manifest route snapshot for local and forwarded submit,
  rejects changed stable directory state before mutation, and filters that full
  snapshot only when validating the locked pre-transition actor set. Focused
  manifest-only remote removal and stale-state tests, the complete Conversation
  suite, the complete Conversation race suite, `go vet`, Go style, and
  `git diff --check` pass. This is source readiness only; W8B still requires the
  checkpoint deployment and bounded Native functional rerun.
- Exact-source Linux run
  `20260913T212936487149Z-ed835cb01d6862ff711e0845bd9588a1`
  proves the MP-D19 correction in the real journey: every Direct and Group
  typing lifecycle assertion, removed-member rejection, zero durable writes,
  source identity, and cleanup passed. The final revoked-device assertion
  failed because Desktop `/device/revoke` omitted the current window-scoped
  `X-Device-ID` and Station correctly returned `401`. That Desktop owner path
  is parked behind the active MCA write claim; W8B remains `PARTIAL/UNPROVEN`.
- Independent W8C run
  `20260913T214114429384Z-d22427d1bb8cdca1049d82a01a1d32ee`
  reached all three exact-source Native clients and failed before Group
  creation because Bob's same-Station Charlie contact had no complete
  Federation identity projection. Readback showed pair-specific fixture
  Federations and no accepted projection for the local pair. The Fixture now
  creates one deterministic Federation for the complete bound actor set and
  seeds every directed relationship, while local peers reuse local Actor rows
  and remote peers retain identity-stable cache upserts. The 120-test combined
  Fixture and Native contract cohort passes; W8C runtime proof remains pending.
- W8C retry
  `20260913T220152092562Z-1854af5aca651bec0ef38d27e710f70f`
  failed closed during Fixture provisioning because the membership verifier
  still filtered by the current pair instead of the full bound Station set.
  The verifier now derives both its Station IDs and expected count from the
  shared Federation members; focused one-Station and two-Station tests pass.
- Exact-source W8C run
  `20260913T220857646292Z-22e49e67e2f67982b2c5c03b8ae2a433`
  at `1f30fb6522e0821579fb08c422df43c5b3fa7c1c` proves the corrected complete
  Federation fixture, all three Native client launches, and the default
  friendship projection. It then fails at the first identity-parity assertion:
  Alice receives Bob's cross-Station handle as `bob@host`, while Charlie
  receives the same PTID's local handle as `@bob@host`. The Social relationship
  projection currently returns the cache's routing-normalized handle unchanged
  even though its wire contract requires canonical `@user@host`. Cleanup is
  `DONE/PROVEN`; W8C remains `PARTIAL/UNPROVEN` pending an owner-layer Social
  projection correction, focused regression, checkpoint, deployment, and
  bounded rerun.
- The Social relationship projection correction now preserves empty legacy
  values, rejects malformed local-only values, and adds the missing leading
  `@` only when projecting a routing-normalized `user@host` value onto the
  canonical wire contract. The focused application race suite, complete Social
  race suite, `go vet`, Go style, 52-test W8C Fixture/runner cohort, and
  `git diff --check` pass. The existing W8C `friendship.identity_parity`
  assertion remains the product regression Gate; runtime proof still requires
  checkpoint deployment and the bounded exact-source rerun.
- Exact-source W8C run
  `20260913T222630465438Z-dafc69d1f5d7c5fae174abfa28bab614`
  at `8126b05ab63353664cb3faba14857064279256bc` proves the canonical
  relationship-handle correction: identity metadata and avatar parity, selected
  contact routing, and existing-friend search all pass across three Native
  clients. It then times out at `mls.readiness` because Desktop
  `keypackage_count` omits the current window-scoped `X-Device-ID`; Station
  correctly returns `401 authenticated Key Exchange device required`.
  Runtime and Provisioner cleanup are `DONE/PROVEN`. This Desktop-owned
  correction is parked behind the same active MCA Desktop write claim as the
  W8B revoke fix; W8C remains `PARTIAL/UNPROVEN`.
- The owner audit confirms that `keypackage_count` must resolve the current
  window's Messaging engine, verify that its endpoint PTID matches the
  authenticated session actor, send canonical
  `CountMlsKeyPackagesRequest.device`, and bind the same endpoint device ID as
  `X-Device-ID`. Adding only a header or using process-global device state
  would remain invalid. The legacy Desktop KeyPackage upload/fetch adapters
  require the same canonical endpoint review, while the production
  `StationMlsKeyPackageTransport` already sends a canonical request and matching
  device header. Declaration expansion failed closed with
  `RESOURCE_DECLARATION_CONFLICT` on MCA workspace `65e7b6da4dc9be85`;
  neither Desktop path may be edited until that owner releases or hands off the
  claim.
- PR #111's archived head was already an ancestor of the current branch. The
  published post-merge Agent continuation
  `7b548118441b1b3909baa54aca027a109a86e555` was integrated by merge commit
  `09f073e0c11ec2dce8e3f9e2f6e1b0f40554044f` without history rewrite.
  Semantic reconciliation preserved the complete shared-Federation fixture,
  canonical `four`/`fiveArm` service bindings, typing restart/clock-skew
  behavior, monotonic member-history cursors, and all later W8 evidence while
  admitting the Agent recovery, device-revoke, peer-key readiness, devctl, and
  completed Windows W9/W10 evidence.
- Checkpoint `579ca4924c3cfeb74d553ff0c652989a4682ba18` removes the stale MLS
  KeyPackage commands from the Conversation adapter and routes upload, fetch,
  and count through the Key Exchange adapter. Tauri and HTTP Gateway now
  resolve the authenticated window/account Messaging endpoint, verify its PTID,
  send the canonical protobuf endpoint identity, and bind the matching
  `X-Device-ID`. Device revoke now rejects a caller device that differs from
  the active Messaging endpoint. Desktop tests, Rust compilation, the focused
  Chat/provisioning cohort, Conversation/Agent race suites, and devctl ledger
  tests pass. W8B/W8C still require exact-source deployment and Native reruns.
- Exact-source W8B run
  `20260913T232407335289Z-09e7de4d91b4f783b9c1bdf1e3ce86ca`
  at `309f421133295ae49e3e2690853124462cfa54fe` passed two-Station
  provisioning, three Native client authentication, and shared-Federation
  selection. It then failed at the newly integrated Direct peer-key readiness
  probe because the probe omitted Bob's attested Home Station ID and Alice's
  Station correctly returned `404`. Cleanup is `DONE/PROVEN`.
- The peer-key readiness correction now carries the peer client's
  runtime-attested Station identity through the Chat Harness into the canonical
  Key Exchange fetch. It retains the readiness fence and does not infer routes
  from display fields or introduce a fallback. Focused Chat/provisioning tests,
  Desktop tests, Rust compilation, and Python compilation pass; W8B remains
  `PARTIAL/UNPROVEN` pending checkpoint deployment and rerun.
- Exact-source W8B run
  `20260913T234025297971Z-4865bcb672111d68a4314cbfdb93d33b`
  at `74a0135b8a9e3ff26dac3576a81fbfd7737a5579` proves both Station
  attestations, three Native client authentications, and the complete shared
  Federation fixture, then fails at Direct peer-key readiness. Alice now sends
  Bob's attested Home Station ID correctly, but Key Exchange
  `resolveActorRoutes` still asks Alice's local Actor Device directory to
  enumerate Bob when `target_device_id` is empty. The local Station has no
  remote shadow-device rows by design, so it returns `404` before entering the
  authenticated Federation query. Cleanup is `DONE/PROVEN`.
- Mechanical W8B remediation is admitted under the existing Key Exchange and
  Federation contracts: after Actor Identity resolves a remote Home Station,
  an all-active-device Direct or MLS fetch delegates enumeration to that Home
  Station. The source Station must not create or require remote Actor Device
  rows; it validates the authenticated federated result by requested actor and
  optional target device. Focused Key Exchange service/Federation regressions,
  checkpoint deployment, and the bounded W8B rerun are required before any
  functional claim.
- The owner-layer correction is implemented in canonical Key Exchange route
  resolution. Remote all-active-device Direct and MLS reads no longer consult
  the source Station's Actor Device directory; the authenticated target Home
  Station selects active endpoints, while the source validates actor identity,
  any explicit device constraint, canonical key material, duplicate endpoints,
  and irreversible MLS consumption. The Key Exchange race suite, focused
  `go vet`, Go style, and `git diff --check` pass. This is source evidence only;
  checkpoint deployment and the exact-source W8B rerun remain next.
- Exact-source W8B run
  `20260914T000309707403Z-c776902fe848cc9d8c9236b9ec1f437a`
  at `08e13a19e4c2e91e5c97411a3c866a8e25d98af4` is
  `PASS/DONE/PROVEN`. Both Stations attest the exact checkpoint; all three
  Native clients authenticate; Direct and Group start/stop, send, blur,
  conversation switch, disconnect/TTL, removed-member denial, revoked-device
  denial, and zero durable typing writes pass; runtime and Provisioner cleanup
  are complete. NDR-W8B is done. The serial runtime frontier advances to
  NDR-W8C.
- Exact-source W8C run
  `20260914T001708329983Z-f3bc5aff5c7a5eef6ec66deedfad4aea`
  at `3ec14ada443728f440ea88b565df44c787c41144` proves identity/avatar
  parity, MLS readiness, visible three-member Group creation, encrypted
  delivery to both remote members, and restart recovery. The authority then
  commits Charlie's removal at sequence three, but Alice and Bob retain the
  stale three-member projection until the Gate times out. Cleanup is
  `DONE/PROVEN`; W8C remains `PARTIAL/UNPROVEN`.
- Runtime readback identifies two owner-layer defects behind that stale
  projection. The Station federation decoder reconstructs a committed
  membership event without its `mls_commit_sha256`, so canonical re-sealing
  rejects the event and remote delivery retries after target HTTP `500`.
  Independently, portable MLS inbound processing returns no authority snapshot
  projection for an ordinary sender/recipient membership commit, so Desktop
  updates epochs but not `messaging_conversation_members`.
- Mechanical W8C remediation is admitted under the existing authority
  post-state contract: Station must preserve every event-hash field during
  membership wire round-trip, portable Messaging Core must derive the complete
  authoritative member projection for retained endpoints and the sender, and
  Desktop must replace conversation metadata/members atomically with the MLS
  transition commit. The removed endpoint keeps the existing retirement path.
  Focused Station, Messaging Core, and Desktop regressions, checkpoint
  deployment, and the bounded W8C rerun are required.
- The owner-layer remediation passes source verification: the complete
  Conversation package race suite, all 119 portable Messaging Core tests, the
  two Desktop sender/recipient atomic-member-replacement regressions, Desktop
  binary compilation, both Rust formatting checks, Go formatting, `go vet`,
  and `git diff --check` pass. The repository-wide Go style script remains red
  on its existing missing-doc-comment backlog; the new exported regression has
  the required comment. This is `SOURCE_CHECK` only. Exact-source deployment to
  `four` and `fiveArm` and the bounded W8C Native rerun remain required for
  `FUNCTIONAL_PASS`.
- Checkpoint `23002bf18d6d316901b9ede4f19bb3bd21124890` was deployed to
  `four` and `fiveArm`. Stable exact-source run
  `20260914T114014299344Z-aa87d8f750cbbe4100c3ebff501b0889`
  passes identity/avatar/contact parity, visible three-member Group creation,
  encrypted delivery, Bob restart recovery, and Alice's sender-side Charlie
  removal. It times out only while waiting for Bob's retained-recipient
  projection. Cleanup is complete.
- Durable readback proves authority sequence three and Alice's queue item are
  committed and acknowledged, while `fiveArm` remains at follower sequence two
  with no sequence-three event or queue item. Both sequence-three remote frames
  remain in the `four` Federation outbox as `retry_wait /
  transport_unavailable`. Target logs show every corresponding
  `/federation/delivery` request reaches `fiveArm` and returns HTTP `500`.
- The remaining owner-layer defect is lifecycle reconstruction in the
  Conversation follower projection. `ConversationAuthoritySnapshot`
  intentionally carries the complete active public state but no historical
  join sequence. The production decoder therefore used the transition
  sequence for every active endpoint, while the follower validator compared
  those synthesized values with retained sequence-one endpoint history and
  rejected the valid removal. The correction validates actor, role, endpoint,
  Home Station, active-state, scope, epoch, and hash-chain truth as
  duplicate-safe sets, then preserves retained lifecycle metadata and derives
  added lifecycle metadata from the committed transition.
- Focused remove/add lifecycle regressions, including rejection of forged Home
  Station state, pass. The complete Conversation race suite, focused `go vet`,
  Go formatting, and `git diff --check` pass. The repository-wide Go style
  script remains red only on the recorded missing-doc-comment backlog. This is
  `SOURCE_CHECK`; checkpoint, exact-source deployment, and the bounded W8C
  Native rerun remain required.
- Follower lifecycle checkpoint
  `13d867e8fb17d7dd3c3c83d411be25a158af73ee` was deployed to `four`
  and `fiveArm`; both live Stations attested that exact source. Native run
  `20260914T122113394691Z-416c2c7dc23f80a5595eb90f8f9e06c2`
  then passed the complete W8C three-client Group/MLS journey, including Bob's
  retained-recipient Charlie-removal projection and deterministic cleanup.
  Runtime-cell run `20260914T122244856541Z-9962e22c0179720b`
  attests the clean source-bound binary, and final cell state is `CLEANED`.
  NDR-W8C and the selected `four` / `fiveArm` NDR-W8 scope are
  `PASS/DONE/PROVEN`.
