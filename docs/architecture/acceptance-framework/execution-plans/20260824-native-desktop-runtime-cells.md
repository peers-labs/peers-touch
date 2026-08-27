# Native Desktop Runtime Cells — Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-24 | **Updated**: 2026-08-27
> **Owner**: Acceptance Infrastructure + Desktop Platform + Chat Domain
> **Branch**: `refactor/chat-acceptance-cutover`
> **Parent Design**: [../design.md](../design.md)
> **Approved Decisions**: D-13, D-14, D-15, D-16

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

This plan does not claim cross-platform completion until every required runtime
cell has source-matched Native evidence.

## 2. Architecture Baseline

- `docs/architecture/acceptance-framework/design.md` §1.3, §2.1, §3.10,
  §4.12, §8
- `docs/architecture/acceptance-framework/decisions.md` D-13 through D-16
- `docs/architecture/acceptance-framework/data-model.md` §15 through §18
- `docs/architecture/acceptance-framework/integration.md` §1.5 and §1.6
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
   │             │
   ├──> NDR-W8 macOS regression
   └──> NDR-W9 Windows cell implementation/proof

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

Deliver:

- Explicit `desktop-windows-native` contract and remote/local provisioner.
- WebView2 embedded WebDriver build and Win32 Native adapter.
- Source sync, process supervision, evidence and cleanup equivalent to Linux.

Evidence:

- Static contract and adapter tests may land without a host.
- Runtime proof remains `UNPROVEN` until a Windows host executes the Gate.
- Final three-platform capability cannot be `PROVEN` before Windows evidence.

## 8. Atomic Cutover And Deletion Matrix

| Concern | New owner | Cutover condition | Delete |
|---|---|---|---|
| Profile-based remote Git source acquisition | `core/source_sync.py` + `source-sync.sh` | Station deploy and Native cell tests pass | duplicated push/fetch functions in `deploy.sh`; unused tar-based `push-deploy.sh` |
| WebDriver endpoint lifecycle | launcher + `TauriDriver` client | all callers migrated | implicit process ownership in W3C client |
| Native input/window mechanics | `drivers/native/*` | macOS regression and Linux probes pass | platform APIs from Chat runners |
| Native platform result identity | runtime cell matrix | validator and report consumers migrated | platform-implicit Native proof |
| Linux userland | digest-pinned image | build/smoke and cleanup pass | host package-mixing path |

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

- **Precondition**: A source-matched Windows host is available.
- **Action**: Run the same Gate through WebView2 and the Win32 adapter.
- **Expected**: Native input, focus, window ownership, screenshot and product
  assertions pass.
- **Failure variant**: Without a host, status remains `UNPROVEN`.
- **Evidence**: immutable Windows cell run and cleanup audit.
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
| NDR-W1 Runtime Cell Core | done | Contract, manifest, matrix aggregation and Gate × cell execution are wired through `gates.yaml` and `acceptance-run.py`; runtime-cell selection fails closed and records explicit cell identity |
| NDR-W2 SSH + source sync | done | source-sync 16/16 PASS; source-sync/lease/runtime-cell suite 60/60 PASS; Acceptance Core tests 159/159 PASS; strict host-key negative PASS; isolated direct sync transferred one new object on the second commit; isolated central/local sync PASS with cleanup; `make station` held the remote source lease through build/restart/health and passed at exact HEAD `33063a7e15be`; remote checkout/residue clean and leases released |
| NDR-W3 Tauri driver separation | done | pure loopback-only `TauriDriver`; `LocalTauriLauncher` and `ProvisionedTauriLauncher`; composed `TauriSession`; all business callers migrated; Core tests 167/167 PASS; MP-W13 static 34/34 PASS; local Native driver smoke PASS; process/ports/storage/log cleanup PASS; infra validation, plan self-check, coverage report, and skill-check PASS |
| NDR-W4 Native adapter cutover | done | platform-neutral `NativeDesktopAdapter` with typed control/window diagnostics; macOS AppKit/CoreGraphics/Accessibility/clipboard/screenshot implementation extracted; Linux/Windows injection slots fail closed; adapter + MP-W13 static 50/50 PASS; Core tests 183/183 PASS; Chat and Infra structural validation PASS; Desktop check and Station messaging packages PASS; tree-wide Chat platform-API scan PASS |
| NDR-W5 Linux cell | done | Actor-scoped Alice/Bob/Alice2 launch, WebDriver/Gateway tunnels, profiles, storage and reverse cleanup are implemented; source-bound Linux run `20260824T152615956669Z-5052adc5b3ba152e` reached `LEASED` at commit `d9509fd7348e4eadb82cfc80c511e44ada712474`; Xorg/input/focus/point/screenshot probes and final cleanup passed |
| NDR-W6 Chat migration | done | Chat runner receives `NativeDesktopRuntimeBinding`, `TauriSession` and `NativeDesktopAdapter`; local launcher/platform factory dependencies are deleted; required assertions, journey order and 3600-second timeout remain locked; Acceptance Core 230/230, Chat static 38/38 and runner 20/20 PASS |
| NDR-W7 Linux MP-W13 proof | done | Unchanged exact-source run `20260826T212504506606Z-466161eb5815892a433ae5948cbb7fd0` at `e5b3fd74943cdba46e16c72c415a2031051448b7` passed all 25 product, runtime identity, and cleanup assertions on `desktop-linux-native`. Station live commit matched, the Linux binary SHA-256 was `fd1d4877c5d2279b4ee5515e3ea687f7074ddbcbc72216b4452022dfb3c09d6b`, and Alice2 DOM settings matched authoritative Station state. Gate cleanup released actors, endpoints, ports, processes, and storage. Independent final cell stop returned `CLEANED`; remote container/checkout and allocated local forwards were absent. |
| NDR-W8 macOS regression | pending | prior evidence predates cutover |
| NDR-W9 Windows cell | pending | host unavailable |

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
local forward was released. This closes NDR-W7 for Linux only; NDR-W8 macOS and
NDR-W9 Windows remain separate platform proofs.

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

## 13. Final Readiness Gate

`PLAN_READY_FOR_EXECUTION` requires independent review and owner approval.

Implementation readiness requires:

- NDR-W1 through NDR-W6 complete with all static/failure-path gates passing.
- Linux AS-NDR-01 through AS-NDR-06 pass on the candidate host.
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
