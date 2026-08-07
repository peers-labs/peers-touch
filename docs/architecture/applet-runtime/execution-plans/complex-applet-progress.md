# Complex Applet Progress

## Current Readiness

Level: L3 candidate with live-gate evidence. C0/S1/G2/D3/T4/A5 repository gates now include contract validation, complex SDK surfaces, Desktop Host package reader, explicit Rust applet session creation before Host mount, Lynx bridge envelopes/session propagation/destruction, real Desktop Lynx Web runtime proof, product Host frontend-chain proof through `AppletManager` + `<lynx-host>`, Host-driven lifecycle `ready/show/pause/resume/hide/destroy` event proof in browser/product Host gates, Gateway-authorized Host-owned `navigation.*` and `ui.*` commands, product Host real-Gateway proof through `pnpm applet:desktop-product-host-real-gateway-gate`, normal Desktop product shell route proof through `pnpm applet:desktop-product-shell-real-gateway-gate`, packaged Desktop `frontendDist` applet asset proof through `pnpm applet:desktop-packaged-assets-gate`, Tauri `.app`/`.dmg` freshness proof through `pnpm applet:desktop-tauri-bundle-gate`, packaged product-window proof through `pnpm applet:desktop-product-window-gate` using a bounded product-window certification session, isolated Desktop storage profile, product-shell Station fixture, and normal `App` / `ReadyView` / `PageHost` shell instead of `AppletReadinessProbeView`, non-generic manifest-id certification using `external-certification-applet`, strict repo-external package certification through `pnpm applet:external-producer-certification-gate /tmp/peers-touch-external-l3-cert`, browser Web Host runtime proof through `pnpm applet:web-host-runtime-gate`, production Web Host shell proof through `pnpm applet:production-web-host-gate`, Android/iOS canonical manifest field parity, executable iOS Swift manifest/session validation against the real Lynx `BridgeDispatcher`, iOS Xcode workspace build evidence, iOS Lynx runtime E2E evidence through `pnpm applet:ios-lynx-runtime-e2e`, Android JVM `AppletBridgeSessionContractTest` execution through `pnpm applet:mobile-native-manifest-gate`, Android Lynx runtime E2E evidence through `pnpm applet:android-lynx-runtime-e2e`, restored `pnpm mobile:check`, Desktop `applets` page projection owned by `appletsRuntime`, dynamic `applet:<id>` runtime pages owned by the kernel `PageDescriptor` path, Desktop HTTP Gateway dispatch proof for `applets_create_session` / `applets_invoke`, Desktop Gateway manifest-permission/session/service-binding enforcement with per-session trusted manifest snapshots, dev service override, service/path network proxy routing, Gateway-owned event subscription/topic policy, Gateway event outbox plus Desktop Host `events.poll` delivery for background task completion, governed `skills.invoke` network/agent executors plus `taskType: "network"` and `taskType: "agent"` executors, release-mode rejection for skill/task fallback execution through `PEERS_APPLET_REQUIRE_PRODUCT_EXECUTORS` / `productExecutorsOnly`, network skill service-policy deny/error-stream coverage, agent skill/task Station `/agent/turn/execute` coverage with explicit `skill-agent` and `task-agent` upstream evidence, skills register/list/invoke with policy deny and subscribed stream events, task/agent ordered stream events, provider/Station-backed AI/agent paths, Desktop frontend build, Rust `cargo check`, Tauri app bundling, canonical producer source manifests for built-in sample applets, strengthened Desktop package source scanning, `pnpm applet:desktop-runtime-gate`, `pnpm applet:desktop-product-host-gate`, `pnpm applet:desktop-product-host-real-gateway-gate`, `pnpm applet:desktop-product-shell-real-gateway-gate`, `pnpm applet:desktop-packaged-assets-gate`, `pnpm applet:desktop-tauri-bundle-gate`, `pnpm applet:desktop-product-window-gate`, `pnpm applet:web-host-runtime-gate`, `pnpm applet:production-web-host-gate`, `pnpm applet:desktop-http-gateway-gate`, `pnpm applet:desktop-e2e`, `pnpm applet:product-capability-service-gate`, and `pnpm applet:l3-candidate-audit` live-gate evidence. `pnpm applet:l3-release-audit` is intentionally failing until release-only evidence exists, and now also requires canonical UTC ISO timestamp ordering across certification, attestation, and manual acceptance, so candidate evidence can no longer be mistaken for terminal L3. The latest local Android JVM and Android Lynx runtime E2E runs are PASS with the local SDK at `/opt/homebrew/share/android-commandlinetools`. Release L3 still requires certification against a real independently authored third-party package and manual normal-user product acceptance.
Last updated: 2026-06-10
Updated by: AI implementation session

## Current Session Scope

- Implemented scope: complex contract, Gateway-compatible SDK surface, Desktop Host/Gateway handlers, explicit Rust-backed applet session creation before Lynx mount, session-aware bridge invocation, manifest permission authorization, service/path network proxy routing, governed network and agent skill executors, governed network and agent task executors, background-updated task lifecycle state with cancellation cleanup, Gateway event outbox polling into Lynx Host events, provider/Station-backed agent and AI handler paths, validation/smoke tooling, generic complex package fixture with a built `main.lynx.bundle`, Desktop build/check, and Tauri bundle closure.
- Evidence scope: executable contract tests, SDK typecheck, Desktop package validation, strengthened Desktop smoke evidence bundle with Rust Gateway unit tests, forbidden producer scan with required config, Desktop frontend build, Desktop applet unit test, Desktop app check, Desktop Tauri `cargo check`, full `tauri build` producing `.app` and `.dmg` artifacts, and repo-external applet package certification.
- Remaining release blocker: certify a real independently authored third-party package, then run manual normal-user product acceptance. The repo fixture path now has real Lynx Web runtime evidence, product Host frontend-chain evidence, product Host to real Rust Gateway evidence, normal `ReadyView` + `PageHost` product shell route evidence, packaged `frontendDist` applet asset evidence, packaged `.app` product-window evidence through the normal product shell, Host event callback evidence for `lifecycle.show`, `lifecycle.pause`, `lifecycle.resume`, `lifecycle.hide`, and completed `task.event` delivery, and controlled local upstream evidence for Station/provider/service/stream result validation. The generated `external-certification-applet` fixture has passed the Desktop runtime, product Host, product Host real-Gateway, packaged product-window, and Desktop live E2E gates with a non-generic manifest id. A generated package staged outside the repository at `/tmp/peers-touch-external-l3-cert` has also passed `pnpm applet:external-producer-certification-gate`, including the normal product shell real-Gateway route, proving the certification pipeline no longer relies on repository-local package paths or the readiness-probe view for browser-hosted shell acceptance. This is stronger than repo-local fixture evidence, but it is still synthetic tooling-authored evidence rather than a real third-party producer package.

## Terminal Gap Audit

Audit date: 2026-06-09

Current state is a strong Desktop L3 candidate foundation, not terminal L3. The repository and repo-external synthetic package gates prove the canonical contract, SDK adapter path, real Desktop Lynx Web rendering plus NativeModules bridge calls, Desktop Host bridge unit path, normal Desktop product shell dynamic applet route, Rust Gateway security checks, controlled upstream provider/Station calls, packaged Tauri Desktop product-window loading through a bounded product-window certification session and the normal product shell, browser Web Host runtime behavior, Production Web Host shell behavior, Mobile/Web source parity, executable iOS native manifest parsing plus bridge/session dispatch semantics against the real Lynx dispatcher, iOS Xcode workspace compilation, iOS Lynx runtime execution through the SDK/native bridge marker gate, and mobile check closure. Android now has a JVM `AppletBridgeSessionContractTest` wired into the mobile native gate, and the latest local run executed it with the local Android SDK. Android runtime E2E is now wired and passing as a real emulator/device marker script. The evidence set does not yet prove real third-party producer certification or manual normal-user product acceptance.

| Domain | Current proof | Remaining gap to terminal target |
|--------|---------------|----------------------------------|
| Frontend runtime | `pnpm applet:desktop-runtime-gate` launches headless Chrome, imports real `@lynx-js/web-core`, loads the generated Rspeedy `main.lynx.bundle`, verifies `<lynx-view>` renders a `part="page"` tree with `pass`, captures background worker exceptions, proves SDK calls leave ReactLynx lifecycle code through NativeModules bridge, and requires applet-side `sdk.lifecycle.onShow` plus completed `sdk.events.on('task.event')` callback delivery. `pnpm applet:desktop-product-host-gate` uses real Desktop `AppletManager` + `<lynx-host>` to discover the package, create a session, route SDK calls to `applets_invoke`, dispatch Gateway `__events`, poll the Gateway event outbox via `events.poll`, deliver background completed `task.event` through `sendGlobalEvent`, dispatch Host-driven lifecycle `show/pause/resume/hide`, execute authorized `__hostCommands`, and destroy the session on unmount; its default mode stubs Tauri invoke for frontend-chain isolation. `pnpm applet:desktop-product-host-real-gateway-gate` runs the same product Host browser harness against a Rust HTTP Gateway test server and controlled upstream, proving applet SDK calls reach the real Gateway and requiring controlled upstream to receive `network`, `skills.invoke` network executor, `skills.invoke` agent executor, `taskType: "network"` executor, `taskType: "agent"` executor, `agent`, and OpenAI-compatible provider endpoints, including explicit `skill-network`, `skill-agent`, `task-network`, and `task-agent` POST body evidence. `pnpm applet:desktop-product-shell-real-gateway-gate` renders the normal `ReadyView` + `PageHost` product shell at `applet:<id>`, verifies the dynamic `applet:*` descriptor route, uses a non-readiness-probe session state, executes SDK calls through the real Gateway, and proves Gateway-authorized Host UI/device commands are consumed by the product shell. `pnpm applet:desktop-packaged-assets-gate` proves Desktop build output includes `/applets-dist/index.json`, manifests, Desktop Lynx bundles, and integrity-covered files inside Tauri `frontendDist`. `pnpm applet:desktop-tauri-bundle-gate` proves a fresh Tauri `.app`/`.dmg` was built after the current applet assets were packaged, preventing stale app-shell evidence. `pnpm applet:desktop-product-window-gate [package-dir]` stages either the default generated generic package or the supplied external-style package into packaged assets, launches the real `.app` executable, binds a bounded product-window certification session, isolates `PEERS_STORAGE_ROOT`/`PT_PROFILE` from user data, serves normal product-shell Station startup calls with minimal protobuf/JSON/SSE fixtures, routes through the normal `App` / `ReadyView` / `PageHost` shell to `applet:<id>`, rejects `AppletReadinessProbeView` dependency, verifies Gateway product-shell telemetry evidence matches the staged manifest id, and requires controlled upstream `network`, `agent`, and provider requests. The gate set has now passed with `generic-complex-applet`, repository-local `external-certification-applet`, and repo-external `/tmp/peers-touch-external-l3-cert` package inputs. `pnpm applet:production-web-host-gate` now proves a browser product shell with catalog/sidebar, `applet:<id>` route, Host session root, `WebHostBridgeAdapter`, Host-injected context, canonical permission denial, audit/telemetry, and controlled upstream `network`/`agent`/provider/task/skill evidence. `pnpm applet:external-producer-certification-gate <external-package-dir>` now orchestrates the Desktop runtime/product-host/real-Gateway/product-shell/product-window/live-E2E certification sequence, refuses repository-local packages unless explicitly run as a dry-run, and has passed against `/tmp/peers-touch-external-l3-cert`. `pnpm applet:desktop-http-gateway-gate` proves the dev HTTP Gateway dispatch can route applet create/invoke commands to the real Rust Gateway when authenticated. | Current packaged product-window proof still uses a bounded certification session rather than a human account login, and the successful repo-external package is still generated by Peers-Touch tooling. Release L3 still needs a real independently authored third-party package run and manual normal-user product acceptance. |
| Developer SDK | SDK exposes the main contract-backed bridge API and generated fixture uses high-level SDK calls, including the v1 `network.upload/download`, `device`, `clipboard`, and sandbox `file` surface; `pnpm applet:developer-flow-gate` now runs the generated package build script and rejects raw-source placeholder bundles; `pnpm applet:sdk-adapter-test` verifies app/lifecycle/system/config/storage/network/device/clipboard/file/navigation/UI/events/skills/tasks/agent/AI/telemetry method mapping, typed declaration output, event filtering, stream subscription bracketing, cancellation, and canonical error preservation through a fake BridgeAdapter. | Remaining release gap is real third-party producer certification; future polish can add negative per-capability SDK fixtures against real Host gates. |
| Desktop Gateway | Security, permission, explicit session creation, session trusted-manifest snapshots, unknown-session rejection, quota, payload, controlled network, provider, agent, low-risk device, Gateway-authorized Host-owned navigation/UI, Gateway-owned event subscription/topic policy, Gateway event outbox drain via `events.poll`, Host document/window visibility mapped to `pause/resume`, native clipboard integration behind user activation with test-only fallback, sandbox file gates, governed network skill executor success plus service-policy deny/error stream, governed agent skill executor with `agent.stream` permission and Station `/agent/turn/execute` dispatch, governed network and agent task executors, product-executor-only mode that rejects fallback skill/task execution, HTTP Gateway applet command dispatch, normal product shell route dispatch, and packaged product-window certification dispatch pass. | Generic timer-backed task fallback and registry-local skill echo remain available for candidate/dev evidence, but release/product mode can now disable them. True push/subscription progress transport beyond Host polling and manual normal-user product acceptance remain hardening. |
| Applet package/product samples | Built-in applet source manifests now use canonical `targets`/`entries`/platform `load`/`peers-touch.applet.bridge` and full capability-method permissions. Built packages build and source scans prevent legacy bridge regressions. | Built-in applets remain local/sample-like for several operations and are not yet external producer certification. They also need product UX/i18n hardening before being evidence for real developer adoption. |
| Web Host | `pnpm applet:web-host-runtime-gate` generates a `web-host-certification-applet` with `desktop,web` targets, validates manifest and SHA-256 integrity, starts a controlled upstream, launches headless Chrome, installs a manifest-validated `__PEERS_TOUCH_APPLET_HOST__`, creates a Web Host session, runs the developer readiness flow through `WebHostBridgeAdapter`, enforces full-method permission, destroyed-session, raw-URL, and service/path policy, records audit/telemetry evidence, and requires controlled upstream `network`, `agent`, and provider requests. `pnpm applet:production-web-host-gate` now adds a product-shell-shaped browser gate with catalog/sidebar, route transition to `applet:<id>`, `data-web-host-session`, `data-applet-root`, Host-injected context, SDK execution, canonical permission denial, audit/telemetry, and controlled upstream `task-network` / `task-agent` / `skill-network` / `skill-agent` request evidence. | This is production-shell evidence, but not yet a deployed Web Host app operated by a real user account. |
| Android/iOS | Bridge response envelope, canonical errors, full-method permission checks, and canonical manifest fields are source-gated. Android and iOS manifest models now carry `targets`, `entries`, platform `load`, `services`, `skills`, and `integrity`; Android manager filters on `manifest.targets`, and iOS validation checks canonical target/load/service/integrity rules. `pnpm applet:mobile-native-manifest-gate` now generates an `android,ios` canonical package, validates `lynx-native` load/service/skill/integrity, compiles/runs the iOS Swift `AppletManifest`, `AppletBridgeSession`, and real Lynx `BridgeDispatcher` against that package manifest, checks the iOS Xcode target includes the Applet/Lynx runtime files with stale placeholder/parser references removed, records a passing iOS simulator workspace build when CocoaPods is installed, and executes an Android JVM `AppletBridgeSessionContractTest` covering manifest parse, service declaration enforcement, full-method permission, canonical errors, and unloaded-session rejection with the local Android SDK. `pnpm applet:ios-lynx-runtime-e2e` now builds a native Lynx applet bundle, stages it into the iOS app sandbox, launches the simulator app into `AppletContainerView`, and only writes evidence after `storage.set/get` SDK calls cross `AppletBridgeNativeModule` and produce canonical marker envelopes. Android has the matching `pnpm applet:android-lynx-runtime-e2e` script, direct runtime launch path, sandbox staging, marker writer, and passing emulator evidence. `pnpm mobile:check` builds the mobile Web dist before Rust check, so the Tauri `frontendDist` precondition is satisfied and the command passes locally. | Add native XCTest/instrumented bridge tests as hardening. |
| Evidence | Repository fixture and controlled upstream gates pass; developer-flow, desktop-runtime-gate, desktop-product-host-gate, desktop-product-host-real-gateway-gate, desktop-product-shell-real-gateway-gate, desktop-product-window-gate, desktop-packaged-assets-gate, desktop-smoke, desktop-e2e, web-host-runtime, production-web-host, Android/iOS Lynx runtime E2E, and product-capability-service-gate now reject raw SDK TypeScript source masquerading as a Lynx bundle, prove real Lynx/Web/native bridge execution through harness, product Host frontend paths, normal product shell dynamic route, real Rust Gateway, packaged Tauri product window through the normal shell, browser Web Host product shell, Android/iOS native runtime marker execution, controlled upstream, `task-network` / `task-agent` / `skill-network` / `skill-agent` POST body evidence, and product-mode rejection of fallback task/skill executors. External certification now has a strict orchestration gate that refuses repository-local packages by default and has passed against `/tmp/peers-touch-external-l3-cert`. `pnpm applet:l3-candidate-audit` verifies the current candidate evidence set, while `pnpm applet:l3-release-audit` fails until real third-party authorship and manual acceptance are attached. | Run the certification gate against a real independently authored conforming package, add manual normal-user product acceptance, and decide which evidence artifacts are committed versus generated CI artifacts. |

## Re-Audit Notes

Audit date: 2026-06-09

- Frontend work now has browser/product Host proof, normal product shell dynamic-route proof, a packaged Tauri product-window gate through the normal `App` / `ReadyView` / `PageHost` shell, and a repo-external synthetic package certification run. The Desktop gate set has passed with the default generated package, a second generated package using a different repository-local manifest id, and `/tmp/peers-touch-external-l3-cert`, proving the runtime/product-host/product-shell/product-window paths are not coupled to `generic-complex-applet` or repository-local package paths. This is still a candidate path because the packaged-window gate uses a bounded product-window certification session instead of a human account login and the repo-external package is tooling-generated; it is not yet real third-party package certification or manual normal-user onboarding acceptance.
- Desktop product shell projection now reflects canonical applet manifests more directly: the applet list is backed by `appletsRuntime` / `useAppletsStore`, records session-local open state instead of showing a static last-used placeholder, and groups full capability-method permissions such as `network.request`, `tasks.start`, `agent.stream`, and `ui.showToast` into localized permission chips with the raw granted methods visible in the chip tooltip. This keeps the product shell aligned with the full-method permission model enforced by the Gateway rather than the older module-level sample permission labels.
- Release audit now rejects weak terminal evidence: third-party attestation must point to an existing outside-repository package whose manifest id matches the attested applet id and the passing external-producer certification output for the same package; manual acceptance must reference that attestation, be explicitly non-synthetic/non-harness, and include supporting artifacts with product-shell, normal-user, and applet-id evidence.
- Developer SDK is usable through `AppletSDK` and the generated package build flow; typed navigation/UI/network/device/file/agent/AI/telemetry models are now exported from `@peers-touch/applet-contract` or SDK capability declarations and proven through generated SDK declarations. The SDK adapter gate now covers the full public capability surface through canonical BridgeAdapter method mapping; real third-party producer certification is still incomplete.
- Desktop Gateway now authorizes `navigation.*` and `ui.*` and emits Host-owned commands rather than letting applets mutate product chrome directly. `ui.showToast`, `ui.showLoading`, `ui.hideLoading`, `ui.setNavigationBar`, `ui.showModal`, and `ui.showActionSheet` now execute in the Desktop Host path. Desktop Host now emits `ready/show` after `lifecycle.reportReady`, maps document/window visibility to `pause/resume`, emits `hide/destroy` before unmount, and polls Gateway `events.poll` for subscribed background events; gates prove `sdk.lifecycle.onShow` callback delivery, and Gateway-generated task/skill/agent stream events are delivered only after per-session topic subscription. Task state now has governed network and agent executors, timer-backed Gateway fallback worker, event outbox delivery for completed background task events, persisted completion, and terminal cancellation for running tasks. Skill invocation now has governed network and agent executors: network skills reuse service policy, while agent skills require `agent.stream` and dispatch to Station `/agent/turn/execute`; controlled upstream evidence includes `task-network`, `task-agent`, `skill-network`, and `skill-agent` request bodies. Release/product mode now has a hard gate: `PEERS_APPLET_REQUIRE_PRODUCT_EXECUTORS` or per-call `productExecutorsOnly` rejects registry-local skill echo and timer-backed task fallback instead of treating them as product execution. True push transport remains non-final.
- Web Host parity now has both a browser runtime gate and a production-shell-shaped Web Host gate, not only an adapter unwrap check. Android/iOS parity now includes canonical manifest field modeling, executable iOS Swift manifest decode/validation plus bridge/session dispatch assertions against the real Lynx dispatcher, Xcode target membership checks, a passing local iOS workspace build when CocoaPods is installed, a real iOS Lynx runtime E2E marker run, an Android JVM `AppletBridgeSessionContractTest` run with the local Android SDK, and `pnpm mobile:check`. Android native Lynx runtime execution now has a passing emulator marker run.

## Current Implementation Inventory

| Area | Current State | Key Evidence | Gap To L3 |
|------|---------------|--------------|-----------|
| Contract | Complex manifest, bridge, index, capability registry, complex task/skill/agent/AI/telemetry types, JSON Schema export, and validation tests exist. | `packages/applet-contract/src/manifest.ts`, `packages/applet-contract/src/capability.ts`, `packages/applet-contract/src/complex.ts`, `packages/applet-contract/src/schema.ts`, `pnpm applet:contract-test`, `pnpm applet:contract-schema` | Remaining hardening is consumer convergence on the schema artifact; Desktop/tooling still primarily use executable TypeScript validation. |
| SDK | BridgeAdapter-based base and full complex surfaces exist, including Web Host adapter, typed navigation/UI option/result models, service/path network request/upload/download API, device, clipboard, sandbox file, skills register/list/invoke/onStream, tasks, agent startSession/send/stream, AI generate/chat, and telemetry. `pnpm applet:sdk-adapter-test` now covers canonical method mapping for the full public surface plus generated declaration checks for typed navigation/UI/network/device/file/agent/AI/telemetry models. | `packages/applet-contract/src/complex.ts`, `packages/applet-sdk/src/index.ts`, `packages/applet-sdk/src/capabilities/core.ts`, `packages/applet-sdk/src/capabilities/device.ts`, `packages/applet-sdk/src/capabilities/file.ts`, `packages/applet-sdk/src/adapters/web-host.ts`, `tooling/scripts/applet-sdk-adapter-test.mjs`, `.artifacts/applet-readiness/sdk/adapter-test-output.txt`, `pnpm --filter @peers-touch/applet-sdk run check`, `pnpm applet:sdk-adapter-test`, `pnpm applet:external-producer-certification-gate /tmp/peers-touch-external-l3-cert` | Real third-party producer certification remains release follow-up; deeper negative capability fixtures can be added after external producer feedback. |
| Web Host | Browser Web Host runtime gate exists and proves manifest validation, session creation, bridge injection, policy/audit, SDK execution, and controlled upstream calls. Production Web Host shell gate now proves catalog/sidebar, `applet:<id>` routing, Host session root, applet root, Host-injected `WebHostBridgeAdapter`, developer readiness flow execution, canonical permission denial, audit/telemetry, and controlled upstream task/skill/agent/provider requests. | `tooling/scripts/applet-web-host-runtime-gate.mjs`, `tooling/scripts/applet-production-web-host-gate.mjs`, `tooling/fixtures/applets/packages/web-host-certification-applet/manifest.json`, `.artifacts/applet-readiness/web/production-web-host-runtime-output.txt`, `pnpm applet:web-host-runtime-gate`, `pnpm applet:production-web-host-gate` | Remaining release hardening is a deployed Web Host app run under a normal product account, if Web Host release scope requires it. |
| Mobile Native | Android/iOS native bridge source parity now includes canonical response envelopes, canonical error codes, full capability permission checks, and canonical manifest fields. iOS native code now has an executable Swift gate against a generated `android,ios` canonical package covering manifest decode/validation, `AppletBridgeSession` permission denial, real Lynx `BridgeDispatcher` canonical errors, unloaded-session rejection, and response envelopes. The mobile native gate also checks that the iOS Xcode target includes the Applet/Lynx runtime files, removes stale placeholder/parser references, requires `LynxViewFactory` to register `AppletBridgeNativeModule` with a per-session `LynxConfig`, verifies the module exposes `NativeModules.bridge.invoke` and canonical envelopes, and records a passing local iOS workspace build when CocoaPods is installed. `pnpm applet:ios-lynx-runtime-e2e` now proves native bundle execution in Simulator and SDK `storage.set/get` calls through the iOS native bridge. Android now has `AppletBridgeSessionContractTest` wired into `applet-mobile-native-manifest-gate`; it runs as `:app:testDebugUnitTest`, and the latest local evidence records PASS with the SDK at `/opt/homebrew/share/android-commandlinetools`. Android also has a passing runtime E2E script and marker path. | `apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletManifestParser.kt`, `apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletRuntimeE2E.kt`, `apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/ui/AppletContainerView.kt`, `apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/lynx/bridge/AppletBridgeNativeModule.kt`, `apps/mobile/android/app/src/test/java/com/peerstouch/mobile/core/applet/AppletBridgeSessionContractTest.kt`, `apps/mobile/ios/PeersTouch/Core/Applet/AppletManifest.swift`, `apps/mobile/ios/PeersTouch/Core/Applet/AppletBridgeSession.swift`, `apps/mobile/ios/PeersTouch/Core/Lynx/Bridge/AppletBridgeNativeModule.swift`, `apps/mobile/ios/PeersTouch/Core/Lynx/Bridge/BridgeDispatcher.swift`, `apps/mobile/ios/PeersTouch/Core/Lynx/LynxViewFactory.swift`, `apps/mobile/ios/PeersTouch/Core/Applet/UI/AppletLynxViewRepresentable.swift`, `.artifacts/applet-readiness/mobile/ios-xcode-build-output.txt`, `.artifacts/applet-readiness/mobile/ios-lynx-runtime-e2e-output.txt`, `tooling/scripts/applet-parity-gate.mjs`, `tooling/scripts/applet-mobile-native-manifest-gate.mjs`, `tooling/scripts/applet-ios-lynx-runtime-e2e.mjs`, `tooling/scripts/applet-android-lynx-runtime-e2e.mjs`, `pnpm applet:parity-gate`, `pnpm applet:mobile-native-manifest-gate`, `pnpm applet:ios-lynx-runtime-e2e`, `pnpm mobile:check` | Native XCTest/instrumented bridge coverage remains hardening beyond the current marker E2E gates. |
| Desktop Host | Desktop package reader consumes contract validation, Lynx host returns bridge response/event envelopes, request IDs are preserved, session IDs and manifest capabilities are passed to Rust Gateway, destroy notifies Gateway, Host events use the SDK `applet.event` topic envelope, primitive Gateway results are preserved without event-envelope assumptions, applet list projection is owned by `appletsRuntime` instead of page mount effects, dynamic `applet:<id>` runtime pages are owned by a kernel `PageDescriptor`, Host polls `events.poll` when the manifest grants it, the React `<LynxHost>` wrapper binds navigation/UI/device handlers before the `url` attribute can trigger bundle execution, the production build ships Lynx Web `client_prod` runtime assets instead of relying on Vite-rechunked Lynx internals, packaged product-window certification now uses the normal `App` / `ReadyView` / `PageHost` shell instead of `AppletReadinessProbeView`, and runtime/product-host/product-shell/product-window gates prove real Lynx Web SDK calls plus Host event callback delivery for `lifecycle.show`, `lifecycle.pause`, `lifecycle.resume`, `lifecycle.hide`, completed `task.event`, and controlled upstream `network`/`agent`/AI calls. | `apps/desktop/src/App.tsx`, `apps/desktop/src/hooks/useAppLifecycle.ts`, `apps/desktop/src/applet/schema.ts`, `apps/desktop/src/applet/AppletManager.ts`, `apps/desktop/src/applet/AppletManager.test.ts`, `apps/desktop/src/applet/LynxHost.tsx`, `apps/desktop/src/applet/lynx-host-element.ts`, `apps/desktop/src/applet/lynx-web-runtime.ts`, `apps/desktop/vite.config.ts`, `apps/desktop/src/pages/AppletRuntimePage.descriptor.tsx`, `apps/desktop/src/runtimes/appletsRuntime.ts`, `apps/desktop/src/store/applets.ts`, `tooling/scripts/applet-desktop-runtime-gate.mjs`, `tooling/scripts/applet-desktop-product-host-gate.mjs`, `tooling/scripts/applet-desktop-product-window-gate.mjs`, `pnpm --filter @peers-touch/app-desktop run test:applet`, `pnpm applet:desktop-runtime-gate ...`, `pnpm applet:desktop-product-host-gate ...`, `pnpm applet:desktop-product-host-real-gateway-gate ...`, `pnpm applet:desktop-product-shell-real-gateway-gate ...`, `pnpm applet:desktop-product-window-gate ...` | Remaining Desktop frontend hardening is now real third-party external-package certification, manual normal-user product acceptance, and UX/i18n polish rather than legacy router ownership or missing product shell proof. |
| Gateway | Desktop Tauri Gateway creates applet sessions explicitly, authorizes invoke by session + trusted manifest snapshot, rejects unknown sessions, rejects manifest drift after session registration, enforces service binding allowed paths/methods, rejects raw network URL, supports host-only dev service override, proxies station-resolved services through Station client, supports network upload/download through governed service/path, supports low-risk device, native clipboard integration behind user activation, sandbox file operations with quota, per-session event subscription/topic policy, event outbox drain via `events.poll`, skill registry/invoke, network/task/agent/AI contract-shaped payloads, ordered subscribed task/skill/agent events, governed network skill executor success plus service-policy deny/error-stream coverage, governed agent skill executor with `agent.stream` permission and Station dispatch coverage, governed network and agent task executors, product-executor-only fallback rejection, timer-backed task lifecycle worker with terminal cancellation and persisted completion for candidate/dev flows, Rust check, and executable Gateway/live tests. | `apps/desktop/src-tauri/src/application/applets/mod.rs`, `apps/desktop/src-tauri/src/domain/applets/mod.rs`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`, `pnpm applet:desktop-e2e .artifacts/applet-readiness/packages/generic-complex-applet`, `pnpm applet:product-capability-service-gate`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | True push/subscription progress transport, persistent stores, and richer production quota/timeout policy remain hardening. |
| Tooling | Readiness scripts, strengthened smoke checks, live Desktop E2E gate, external-producer certification orchestration, Production Web Host shell gate, and evidence writer exist and pass. | `package.json`, `tooling/scripts/applet-validate.mjs`, `tooling/scripts/applet-contract-test.mjs`, `tooling/scripts/applet-desktop-smoke.mjs`, `tooling/scripts/applet-desktop-e2e.mjs`, `tooling/scripts/applet-forbidden-producer-scan.mjs`, `tooling/scripts/applet-external-producer-certification-gate.mjs`, `tooling/scripts/applet-production-web-host-gate.mjs`, `.artifacts/applet-readiness/external-producer/certification-output.txt`, `.artifacts/applet-readiness/web/production-web-host-runtime-output.txt` | Real third-party producer package run remains release follow-up. |
| Package Samples | Generic conforming producer-independent complex fixture exists under evidence with a built `main.lynx.bundle`, the fixture generator can produce custom manifest/package identities and Desktop/Web/Android/iOS/Harmony target matrices for certification runs, and built-in sample applets now avoid legacy `applets_action` / `search_query` SDK invokes plus legacy source manifest fields. Desktop package gate scans full sample `src/**` trees, validates package integrity, verifies canonical manifests, and Desktop build copies `apps/desktop/applets-dist` into packaged `frontendDist`. | `packages/applets/*/applet.json`, `tooling/fixtures/applets/packages/generic-complex-applet/manifest.json`, `tooling/fixtures/applets/packages/external-certification-applet/manifest.json`, `tooling/fixtures/applets/packages/mobile-native-certification-applet/manifest.json`, `/tmp/peers-touch-external-l3-cert/manifest.json`, `pnpm applet:developer-flow-gate`, `pnpm applet:validate .artifacts/applet-readiness/packages/generic-complex-applet`, `pnpm applet:desktop-smoke .artifacts/applet-readiness/packages/generic-complex-applet`, `pnpm applet:desktop-package-gate`, `pnpm applet:desktop-packaged-assets-gate`, `pnpm applet:mobile-native-manifest-gate`, `pnpm applet:external-producer-certification-gate /tmp/peers-touch-external-l3-cert` | Real third-party producer package certification remains release follow-up; built-in sample UX/i18n still needs product hardening. |

## Key Findings

- C0/S1/G2/D3/T4/A5 repository gates are executable and passing for the repo fixture path, including live Desktop E2E gate.
- The generic developer fixture now uses Rspeedy/ReactLynx to produce a real `SDRAWROF` Lynx `main.lynx.bundle`; the developer-flow gate runs the fixture's own build script, validates integrity after rebuild, and asserts that the bundle is not raw TypeScript source and does not directly import `@peers-touch/applet-sdk`.
- `pnpm applet:desktop-runtime-gate` now proves the generated package in a real Lynx Web runtime: the page renders `pass`, the background worker has no uncaught exceptions, SDK calls for app/lifecycle/ui/device/clipboard/file/storage/network/skills/tasks/agent/AI/telemetry cross NativeModules bridge from inside ReactLynx lifecycle code, including `ui.showToast`, and applet-side event listeners receive `lifecycle.show` and completed `task.event`.
- `pnpm applet:desktop-product-host-gate` now proves the same built package through the real Desktop frontend Host modules: `AppletManager` discovers `/applets-dist/index.json`, creates an applet session, `<lynx-host>` mounts `<lynx-view>`, SDK calls route through `api.appletInvoke`, Gateway `__events` and background outbox events are delivered via `sendGlobalEvent('applet.event')`, Host-driven `ready/show/pause/resume/hide/destroy` lifecycle events are emitted, Gateway-authorized Host UI commands are executed by the product Host, primitive capability results such as `clipboard.getText` remain valid, and unmount triggers `lifecycle.destroy`. `pnpm applet:desktop-product-host-real-gateway-gate` runs that product Host path against the real Rust HTTP Gateway and controlled upstream; its evidence includes `network`, `skills.invoke` network executor, `skills.invoke` agent executor with `skill-agent` body, `taskType: "network"` executor, `taskType: "agent"` executor with `task-agent` body, `agent`, `/chat/completions` provider requests, Host lifecycle events, completed `task.event` delivery through `events.poll`, and Host execution of Gateway-returned UI commands. `pnpm applet:desktop-product-shell-real-gateway-gate` renders the normal Desktop `ReadyView` product shell at `#/applet:<id>`, proves `PageHost` owns the dynamic `applet:*` route, uses non-readiness-probe session state, and caught/fixed the React `<LynxHost>` handler binding order so Gateway-authorized Host UI/device commands cannot race initial bundle execution.
- `pnpm applet:desktop-product-window-gate [package-dir]` now proves the packaged Tauri `.app` product window can load a conforming complex applet through the real Desktop route and is no longer hardcoded to the generic manifest id. With an explicit package directory it stages that package into packaged assets, builds the app with copied Lynx Web `client_prod` runtime assets, starts a controlled local upstream, launches the packaged executable with a bounded product-window certification session, isolates Desktop storage through `PEERS_STORAGE_ROOT` and `PT_PROFILE`, serves normal product-shell Station startup calls with minimal protobuf/JSON/SSE fixtures, rejects `AppletReadinessProbeView` dependency, enters the normal `App` / `ReadyView` / `PageHost` shell, and requires Gateway-written product-shell telemetry evidence whose applet id matches the staged package plus controlled upstream `network`, `agent`, and provider requests. The gate has passed for both `generic-complex-applet` and a generated `external-certification-applet` identity.
- Desktop Vite build now copies `apps/desktop/applets-dist` into `apps/desktop/dist/applets-dist`, and `pnpm applet:desktop-packaged-assets-gate` verifies the packaged `frontendDist` applet index, manifests, Lynx bundles, source parity, and SHA-256 integrity.
- SDK adapter behavior now has an executable fake-adapter gate covering the full public SDK capability surface, typed declaration output for the complex API set, storage/config unwrap behavior, stream event subscription bracketing, event filtering/unsubscribe, and canonical `AppletError` code/details/requestId preservation.
- Built-in sample applet source now goes through high-level SDK capabilities instead of legacy `applets_action` / `search_query` invokes, and `applet:desktop-package-gate` scans the complete `src/**` trees to prevent regression.
- Desktop applet frontend tests now include `<lynx-host>` bridge integration with fake `lynx-view`: NativeModules bridge calls route to `api.appletInvoke`, Gateway `__events` and polled outbox events dispatch through `sendGlobalEvent('applet.event')`, and Gateway applet error codes remain canonical in response envelopes.
- G2/D3 now have Desktop binary-level and real Gateway evidence: `pnpm --filter @peers-touch/app-desktop run build`, `pnpm --filter @peers-touch/app-desktop run check`, `pnpm --filter @peers-touch/app-desktop run test:applet`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `CI=false pnpm --filter @peers-touch/app-desktop run tauri:build` pass.
- Network contract is now service/path-oriented for applets; raw URL requests and disallowed service paths are rejected by executable Gateway tests; station-resolved paths route through Station client instead of echo responses.
- Desktop Gateway now creates sessions through `applets_create_session`, stores a manifest permission/service/skill snapshot in the Rust session registry, rejects unknown-session invokes, and rejects later manifest drift in the same session, including executable unknown-session and permission-escalation regression tests.
- Evidence bundle includes executable service binding, dev override, allow/deny, session destroy, skills registry/invoke/stream declaration, task lifecycle/stream, agent/AI Gateway handler, live controlled Station/provider upstream, host-load, bundle artifact checks, contract, SDK, package, Desktop package-reader test, and producer-independence outputs.
- Tauri icon bundling blocker was fixed by using generated platform icon assets in `apps/desktop/src-tauri/tauri.conf.json`; full `.app` and `.dmg` outputs are now produced.

## Latest Verification

- PASS `pnpm --filter @peers-touch/app-desktop run icon:build`
- PASS `pnpm --filter @peers-touch/app-desktop run build`
- PASS `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- PASS targeted Gateway product executor fallback tests — `rejects_placeholder_skill_when_product_executors_required` and `rejects_placeholder_task_when_product_executors_required`
- PASS `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture` — 36 applet tests, including event subscription/topic policy, session manifest permission-escalation rejection, Gateway outbox `events.poll` drain, governed network skill executor success and service-policy deny/error-stream paths, governed agent skill executor permission denial, governed network/agent task executor success/deny paths, and product-mode fallback rejection
- PASS `pnpm applet:contract-test`
- PASS `pnpm applet:validate .artifacts/applet-readiness/packages/generic-complex-applet`
- PASS `pnpm applet:desktop-smoke .artifacts/applet-readiness/packages/generic-complex-applet`
- PASS `pnpm applet:desktop-runtime-gate .artifacts/applet-readiness/packages/generic-complex-applet` — real Lynx Web render + ReactLynx lifecycle SDK NativeModules bridge calls, including applet-side `lifecycle.show` callback delivery
- PASS `pnpm applet:desktop-product-host-gate .artifacts/applet-readiness/packages/generic-complex-applet` — real Desktop frontend `AppletManager` + `<lynx-host>` chain, Host `ready/show/pause/resume/hide/destroy` lifecycle/event bridge callback, Host UI command execution, and session destroy
- PASS `pnpm applet:desktop-product-host-real-gateway-gate .artifacts/applet-readiness/packages/generic-complex-applet` — real Desktop frontend `AppletManager` + `<lynx-host>` chain through Rust HTTP Gateway, with controlled upstream `network`, `skills.invoke` network executor, `skills.invoke` agent executor, `taskType: "network"` executor, `taskType: "agent"` executor, `agent`, OpenAI-compatible provider requests, explicit `skill-network`, `skill-agent`, `task-network`, and `task-agent` POST body assertions, Host lifecycle events, and `events.poll` background task delivery
- PASS `pnpm applet:desktop-product-window-gate` — packaged Tauri `.app` product window loads the generic complex applet, writes Gateway telemetry evidence, and hits controlled upstream `network`, `agent`, and OpenAI-compatible provider endpoints
- PASS `node tooling/scripts/applet-desktop-product-window-gate.mjs .artifacts/applet-readiness/packages/generic-complex-applet` — explicit package-dir mode certifies the generated generic package without relying on default fixture generation
- PASS `node tooling/scripts/create-generic-complex-applet.mjs .artifacts/applet-readiness/packages/external-certification-applet --id external-certification-applet --name "External Certification Applet" --package-name "@external/certification-applet" --description "External-style certification fixture for Desktop product-window applet readiness evidence." --author "External Producer"`
- PASS `pnpm applet:validate .artifacts/applet-readiness/packages/external-certification-applet`
- PASS `pnpm applet:desktop-runtime-gate .artifacts/applet-readiness/packages/external-certification-applet`
- PASS `pnpm applet:desktop-product-host-gate .artifacts/applet-readiness/packages/external-certification-applet`
- PASS `pnpm applet:desktop-product-host-real-gateway-gate .artifacts/applet-readiness/packages/external-certification-applet`
- PASS `node tooling/scripts/applet-desktop-product-window-gate.mjs .artifacts/applet-readiness/packages/external-certification-applet` — packaged Tauri `.app` product window loads a non-generic manifest id, Gateway telemetry reports `appletId: "external-certification-applet"`, and controlled upstream receives network/agent/provider requests
- PASS `pnpm applet:desktop-e2e .artifacts/applet-readiness/packages/external-certification-applet`
- PASS `pnpm applet:desktop-product-shell-real-gateway-gate /tmp/peers-touch-external-l3-cert` — normal `ReadyView` + `PageHost` product shell route loads `external-l3-cert-applet`, uses non-readiness-probe session state, sends SDK calls through the real Rust Gateway, and executes Gateway-authorized Host UI/device commands in the product shell
- PASS `pnpm applet:desktop-product-window-gate /tmp/peers-touch-external-l3-cert` — packaged Tauri `.app` loads `external-l3-cert-applet` through the normal `App` / `ReadyView` / `PageHost` shell with a bounded product-window certification session; Gateway evidence reports `launchMode: "product-window-certification"` and `productShell: true`, and controlled upstream receives applet network/agent/provider requests
- PASS `pnpm applet:external-producer-certification-gate /tmp/peers-touch-external-l3-cert` — certifies a generated repo-external package with manifest id `external-l3-cert-applet`; the gate enforces an outside-repository package path and chains validate, Desktop runtime, product Host, real Gateway, normal product shell route, packaged product-window, and Desktop live E2E
- PASS `pnpm applet:l3-candidate-audit` — verifies the current candidate evidence set, including canonical contract/schema/test evidence, platform check evidence plus current source freshness, package validation, Desktop package distribution, packaged `frontendDist` assets, current filesystem freshness for packaged assets and Tauri bundle output, HTTP Gateway applet command dispatch, developer SDK package flow evidence, producer independence scans, Host package-input smoke evidence, repo-external synthetic certification current package checks, Android/iOS Lynx runtime E2E, and Production Web Host shell evidence, and writes `.artifacts/applet-readiness/release/l3-readiness-audit-output.txt`
- PASS `pnpm applet:product-capability-service-gate` — proves network/agent skill/task executors and product-mode rejection of skill/task fallback paths
- EXPECTED FAIL `pnpm applet:l3-release-audit` — blocks terminal L3 claims until real third-party producer attestation and manual normal-user product acceptance exist
- PASS `pnpm applet:web-host-runtime-gate` — headless Chrome Web Host runtime validates the `web-host-certification-applet`, injects canonical `__PEERS_TOUCH_APPLET_HOST__`, runs the SDK readiness flow, records audit/telemetry, rejects ungranted capability/raw URL/destroyed session, and hits controlled `network`, `agent`, and provider upstream endpoints
- PASS `pnpm applet:production-web-host-gate` — headless Chrome product Web Host shell validates the `production-web-host-certification-applet`, proves catalog/sidebar, `applet:<id>` route, Host session/root markers, `WebHostBridgeAdapter`, Host-injected context, SDK readiness flow, canonical `PERMISSION_DENIED`, audit/telemetry, and controlled upstream `task-network`, `task-agent`, `skill-network`, and `skill-agent` request evidence
- PASS `pnpm applet:mobile-native-manifest-gate` — generates an `android,ios` canonical package, validates `lynx-native` load/service/skill/integrity, compiles/runs the iOS Swift `AppletManifest` / `AppletBridgeSession` / real Lynx `BridgeDispatcher` assertions against that manifest, checks iOS Xcode target membership, records local iOS workspace build PASS, and executes Android JVM `AppletBridgeSessionContractTest` with the local SDK
- PASS `pnpm applet:ios-lynx-runtime-e2e` — builds a native Lynx applet bundle, installs the iOS app on Simulator, stages the applet package into the app sandbox, launches the runtime E2E applet route, and observes SDK `storage.set/get` calls through `AppletBridgeNativeModule` canonical marker envelopes
- PASS `pnpm applet:android-lynx-runtime-e2e` — builds a native Lynx applet bundle, installs the Android debug APK on emulator, stages the applet package into the app sandbox, launches the runtime E2E applet route, and observes SDK `storage.set/get` calls through `AppletBridgeNativeModule` canonical marker envelopes
- PASS `pnpm mobile:check` — Mobile web typecheck, Mobile web build, Tauri mobile Rust check, and iOS project listing all pass after adding the mobile `dist` build precondition
- PASS `pnpm applet:desktop-packaged-assets-gate` — Desktop build output includes `/applets-dist/index.json`, canonical applet manifests, Desktop Lynx bundle assets, and integrity-covered files inside Tauri `frontendDist`
- PASS `pnpm applet:desktop-tauri-bundle-gate` — fresh Tauri `.app` / `.dmg` exists and the `.app` executable is newer than the current packaged applet assets
- PASS `pnpm applet:desktop-http-gateway-gate` — HTTP Gateway dispatch routes authenticated applet create/invoke commands into the real Rust Gateway and rejects unauthenticated applet context
- PASS final freshness recovery sequence — `pnpm applet:developer-flow-gate && pnpm applet:desktop-runtime-gate && pnpm applet:desktop-product-host-real-gateway-gate && pnpm applet:desktop-product-shell-real-gateway-gate && pnpm applet:desktop-e2e && pnpm applet:product-capability-service-gate && pnpm applet:desktop-packaged-assets-gate && pnpm applet:desktop-tauri-bundle-gate && pnpm applet:desktop-product-window-gate && pnpm applet:l3-candidate-audit`; candidate audit is now PASS, release audit remains expected FAIL only for missing real third-party producer attestation and manual normal-user product acceptance
- PASS `pnpm applet:forbidden-producer-scan`
- PASS `pnpm --filter @peers-touch/applet-sdk run check`
- PASS `pnpm applet:sdk-adapter-test` — covers full public SDK capability method mapping, typed declaration checks, stream subscription bracketing, event filtering, and canonical error preservation
- PASS `pnpm --filter @peers-touch/app-desktop run check`
- PASS `pnpm --filter @peers-touch/app-desktop run test:applet` — frontend applet tests include Host-driven `ready/show/pause/resume/hide/destroy` and Gateway outbox polling
- PASS `pnpm applet:desktop-package-gate`
- PASS `pnpm applets:build` — built-in applet source manifests are canonical source manifests and output canonical package manifests with generated SHA-256 integrity
- PASS `pnpm applet:developer-flow-gate` — includes built-bundle regression check for `main.lynx.bundle`
- PASS `pnpm applet:parity-gate`
- PASS `pnpm --dir packages/applets/agent-pilot run build`
- PASS `pnpm --dir packages/applets/remote-cli run build`
- PASS `pnpm --dir packages/applets/web-search run build`
- PASS `CI=false pnpm --filter @peers-touch/app-desktop run tauri:build`

## Ticket Status

| Ticket | Status | Owner | Evidence | Notes |
|--------|--------|-------|----------|-------|
| C0.1 | completed | AI | `pnpm applet:contract-test` | Complex contract types and method registry added in `packages/applet-contract`. |
| C0.2 | completed | AI | `pnpm applet:contract-test`; `pnpm --filter @peers-touch/app-desktop run test:applet` | Contract-owned validation is consumed by Desktop schema before Desktop-specific normalization. Generated JSON Schema remains future hardening. |
| C0.3 | completed | AI | `pnpm applet:contract-test` | Positive/negative manifest and invalid-session envelope checks are executable. |
| S1.1 | completed | AI | `pnpm --filter @peers-touch/applet-sdk run check` | SDK base surface aligned with app/lifecycle/navigation/ui/events/invoke. |
| S1.2 | completed | AI | `pnpm --filter @peers-touch/applet-sdk run check` | SDK complex surface includes skills/tasks/agent/AI/telemetry methods required by the plan. |
| S1.3 | completed | AI | `pnpm applet:contract-test`; `pnpm applet:forbidden-producer-scan`; `pnpm --filter @peers-touch/applet-sdk run check`; `pnpm applet:sdk-adapter-test` | SDK is typechecked, producer-independence scan passes, and dedicated fake-adapter tests cover full method mapping, stream bracketing, event filtering, and canonical error preservation. |
| G2.1 | completed | AI | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | Gateway authorizes by session + manifest permission and emits audit; Desktop binary check passes. |
| G2.2 | completed | AI | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`; `pnpm applet:desktop-smoke ...` | Raw URL and disallowed service paths are rejected; station-resolved service/path requests route through Station client instead of echo responses. |
| G2.3 | completed | AI | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`; `pnpm applet:desktop-e2e .artifacts/applet-readiness/packages/generic-complex-applet` | Skill list is manifest-backed; runtime skill register/invoke supports typed success/failure, policy deny, stream event hooks, a governed network executor that reuses service/path/method policy with success plus service-policy deny/error-stream coverage, and a governed agent executor that requires `agent.stream` and calls Station `/agent/turn/execute` with controlled `skill-agent` evidence. Broader product skill executor/policy service integration remains hardening. |
| G2.4 | completed | AI | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`; `pnpm applet:desktop-e2e .artifacts/applet-readiness/packages/generic-complex-applet`; `pnpm applet:product-capability-service-gate` | Task start/get/cancel uses Gateway task state, governed network and agent executors, timer-backed background completion for candidate/dev flows, product-mode fallback rejection, outbox delivery via `events.poll`, terminal cancellation, persisted completion reload, and contract-shaped requestId/updatedAt fields; true push progress transport remains hardening. |
| G2.5 | completed | AI | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`; `pnpm applet:desktop-e2e ...`; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | Agent startSession/send/stream and AI generate/chat handlers are contract-shaped, manifest-gated, and covered by controlled local upstream E2E. |
| D3.1 | completed | AI | `pnpm applet:desktop-smoke ...`; `pnpm --filter @peers-touch/app-desktop run test:applet` | Desktop package reader accepts complex fields; integrity hashes are validated by tooling and package-reader path is covered by tests. |
| D3.2 | completed | AI | `pnpm applet:desktop-smoke ...`; `pnpm --filter @peers-touch/app-desktop run check` | Lynx bridge response/event envelopes include protocol/session/request fields; sessionId and manifest are passed to Rust Gateway and destroy is propagated. |
| D3.3 | completed | AI | evidence files under `tooling/acceptance/evidence/applets/desktop/`; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture`; `CI=false pnpm --filter @peers-touch/app-desktop run tauri:build` | Smoke evidence includes executable Gateway allow/deny/session/task/service tests and full Desktop bundle succeeds. |
| D3.4 | completed | AI | `pnpm applet:desktop-smoke ...` | Station-resolved service binding is represented in package fixture and enforced by Gateway tests; dev override execution remains future hardening. |
| T4.1 | completed | AI | `pnpm applet:validate .artifacts/applet-readiness/packages/generic-complex-applet` | Package validation CLI added. |
| T4.2 | completed | AI | `pnpm applet:contract-test` | Contract test CLI added. |
| T4.3 | completed | AI | `pnpm applet:desktop-smoke .artifacts/applet-readiness/packages/generic-complex-applet` | Desktop smoke command and evidence bundle writer added. |
| T4.4 | completed | AI | `pnpm applet:forbidden-producer-scan` | Producer independence scan command added. |
| A5.1 | completed | AI | `pnpm applet:create-generic-package .artifacts/applet-readiness/packages/generic-complex-applet` | Generic conforming producer-independent package fixture generator added and regenerated. |
| A5.2 | completed | AI | `pnpm applet:desktop-smoke ...`; Desktop build/check/cargo check; `CI=false pnpm --filter @peers-touch/app-desktop run tauri:build` | Desktop acceptance scenarios, binary checks, package-reader tests, and bundle build produce evidence. |
| A5.3 | completed | AI | This progress file; `tooling/acceptance/evidence/applets/summary.md`; `.artifacts/applet-readiness/desktop/live-e2e-output.txt`; `.artifacts/applet-readiness/external-producer/certification-output.txt` | Repository fixture path and repo-external generated package path have live-gate evidence; real third-party producer run remains release certification follow-up. |

## Detailed Ticket Breakdown

### C0.1 — Contract complex type registry

- id: C0.1
- title: Contract complex type registry
- depends_on: none
- write_scope: `packages/applet-contract/src/**`, package-owned schema generation source only
- read_first: `data-model.md`, `module-layout.md`, `complex-applet-acceptance.md`, complex implementation plan §4
- deliverables: canonical `AppletManifest`, entries/targets, services, service binding, skills, permissions, capability methods, bridge request/response/event, task, skill, agent stream, telemetry, and error types
- commands: package-level typecheck/build if available; otherwise record top-level `pnpm applet:contract-test` as NOT_IMPLEMENTED until T4
- pass_criteria: complex types exist in one package; no duplicate capability enum semantics; required methods from C0 plan are represented; errors include `INVALID_SESSION`
- fail_criteria: consumers keep conflicting schema meanings; applet-facing contract omits service/skill/task/agent/AI/telemetry; protocol fields differ across types
- forbidden: producer-specific path/name/business domain; raw backend URL/token/provider key/tool registry/system log/audit writer in applet contract

### C0.2 — Contract schema generation and consumer alignment

- id: C0.2
- title: Contract schema generation and consumer alignment
- depends_on: C0.1
- write_scope: `packages/applet-contract/**`, consumer imports/adapters in `apps/desktop/src/applet/**` and tooling only as needed to consume contract
- read_first: `module-layout.md`, `integration.md`, implementation plan §4
- deliverables: generated schemas owned by contract; Desktop/tooling consume contract schema or generated artifacts; duplicate schema semantics removed or converted
- commands: contract build/schema generation command if present; otherwise NOT_IMPLEMENTED plus lower-level typecheck
- pass_criteria: valid manifest accepted consistently; invalid target/load/permission rejected consistently; no parallel incompatible manifest schema remains in applet-facing paths
- fail_criteria: one consumer accepts a manifest another rejects; bridge protocol string drifts; `targets`/`targetPlatforms` semantics conflict
- forbidden: updating applet samples as producer-specific implementation coupling; allowing standalone to prove integrated runtime

### C0.3 — Contract validation test cases

- id: C0.3
- title: Contract validation tests for complex package and bridge envelope
- depends_on: C0.1, C0.2
- write_scope: `packages/applet-contract/**`, package-owned fixtures/tests, future `applet:contract-test` hooks if required
- read_first: `development-runtime-readiness-report.md` Gate B/E, implementation plan §4
- deliverables: positive/negative manifest validation, unknown permission failure, invalid service/skill schema failure, bridge response/request requestId preservation, invalid-session envelope fixture
- commands: `pnpm applet:contract-test` once T4 exists; package test fallback before then
- pass_criteria: C0 pass/fail cases are executable or explicitly marked NOT_IMPLEMENTED with lower-level evidence
- fail_criteria: validation only documents behavior but cannot run; invalid complex package passes
- forbidden: permissive unknown capability acceptance

### S1.1 — SDK base surface alignment

- id: S1.1
- title: SDK base surface alignment
- depends_on: C0.1
- write_scope: `packages/applet-sdk/src/**`, SDK tests
- read_first: `sdk-architecture.md`, implementation plan §5
- deliverables: `app`, `lifecycle`, `navigation`, `network`, `storage`, `config`, `system`, `ui`, `events`, `invoke`, typed error normalization aligned with contract
- commands: SDK package check/build/test if available; fallback typecheck
- pass_criteria: each public method emits correct `CapabilityMethod`; no Host private object exposed; response shapes align with Gateway contract
- fail_criteria: SDK exposes adapter internals as primary public capability path; SDK assumes DOM/iframe/postMessage for integrated runtime
- forbidden: applet access to Desktop/Tauri/native private APIs, tokens, base URLs, audit writer

### S1.2 — SDK complex surface

- id: S1.2
- title: SDK skills/tasks/agent/AI/telemetry surface
- depends_on: C0.1, S1.1
- write_scope: `packages/applet-sdk/src/**`, SDK tests
- read_first: `complex-applet-acceptance.md` §4, `sdk-architecture.md` §4.9-4.12, implementation plan §5
- deliverables: `skills.register/list/invoke/onStream`, `tasks.start/get/cancel/onEvent`, `agent.startSession/send/stream`, `ai.generate/chat`, `telemetry.track/reportError/mark`
- commands: SDK package check/build/test; later `pnpm applet:contract-test`
- pass_criteria: streaming handlers preserve request/task ids; cancellation maps to contract; typed errors normalize denial/error cases
- fail_criteria: complex methods are TypeScript-only facades with no Gateway-compatible method mapping; stream events are unordered/unidentifiable
- forbidden: provider keys, raw tool registry, agent runtime internals, system logs, audit write API

### S1.3 — SDK contract tests and forbidden access checks

- id: S1.3
- title: SDK tests and forbidden access checks
- depends_on: S1.1, S1.2
- write_scope: `packages/applet-sdk/**`, `tooling/config/**` only if needed for scan command later
- read_first: `development-runtime-readiness-report.md` Gate C, implementation plan §5/§8
- deliverables: fake adapter tests for success/denial/error, stream order, cancellation, forbidden API scan evidence hook
- commands: SDK tests; later `pnpm applet:forbidden-producer-scan`
- pass_criteria: SDK can be tested without Desktop Host; forbidden scan has no unexplained business-layer violations
- fail_criteria: direct fetch/localStorage is used in integrated adapter path; applet-facing API imports Host private modules
- forbidden: scanning rules that encode concrete producer names in architecture docs

### G2.1 — Gateway registry, permission, session, audit core

- id: G2.1
- title: Desktop Gateway core registry and audit
- depends_on: C0.1
- write_scope: `apps/desktop/src-tauri/src/application/applets/**`, `apps/desktop/src-tauri/src/domain/applets/**`, command contract adapters if required
- read_first: `service-architecture.md`, `runtime-architecture.md`, Desktop agent docs before editing Desktop code
- deliverables: method registry, permission guard, lifecycle/session validation, typed response/error, audit fields (`requestId`, `appletId`, `sessionId`, `method`, `status`, `denialReason`, `durationMs`)
- commands: Desktop Rust checks/tests where available; lower-level unit tests if top-level smoke missing
- pass_criteria: missing permission denied; invalid session denied; allowed/denied both audited; applet cannot write audit
- fail_criteria: frontend-only permission enforcement; audit missing denied calls; session destroy not enforced
- forbidden: exposing audit writer/system log/token to applet

### G2.2 — Service binding and network allow/deny

- id: G2.2
- title: Gateway service binding and governed network
- depends_on: G2.1
- write_scope: Desktop Gateway/application/domain/infrastructure applet modules and package reader policy adapters
- read_first: `service-architecture.md` §7, implementation plan §6 Service Binding Resolver
- deliverables: service declaration lookup, dev/service override input, allowedMethods/allowedPaths checks, sanitized request/response, network audit
- commands: Gateway unit tests; later `pnpm applet:desktop-smoke <package-dir>`
- pass_criteria: applet sends service/path not raw base URL; unknown service fails; disallowed path fails; allowed service request succeeds and audits
- fail_criteria: applet receives raw backend base URL or token; raw URL is accepted as integrated package contract
- forbidden: hardcoded backend endpoint or producer-specific service name

### G2.3 — Skill registry and invocation

- id: G2.3
- title: Gateway skill registry/list/invoke
- depends_on: G2.1, S1.2
- write_scope: Desktop Gateway applet modules and Host-facing event/output adapters
- read_first: `complex-applet-acceptance.md` Scenario C, `service-architecture.md`, implementation plan §6
- deliverables: declared/runtime skill convergence, policy-filtered list, typed invoke success/failure, stream registration hook, audit
- commands: Gateway tests; later desktop smoke skills output
- pass_criteria: missing permission fails; policy denial fails; allowed invoke returns typed result; allowed/denied audited
- fail_criteria: skill registry bypasses Gateway; applet can access raw internal skill registry/tool executor
- forbidden: business skill names or domain-specific registry coupling

### G2.4 — Tasks and stream dispatcher

- id: G2.4
- title: Gateway task lifecycle and stream dispatcher
- depends_on: G2.1, S1.2
- write_scope: Desktop Gateway applet modules and event dispatcher adapters
- read_first: `complex-applet-acceptance.md` Scenarios D/E, `runtime-architecture.md`, implementation plan §6
- deliverables: task start/get/cancel, queued/running/progress/completed/failed/cancelled events, ordered stream events, cancellation cleanup
- commands: Gateway/task unit tests; later desktop smoke tasks-streaming output
- pass_criteria: task cancellation stops further progress except final cancelled event; session destroy rejects/cancels session-bound work
- fail_criteria: long-running work modeled only as blocking request; stream events lack requestId/taskId
- forbidden: delivering progress after cancel as if active

### G2.5 — Agent/AI and telemetry governance

- id: G2.5
- title: Gateway agent/AI policy hooks and telemetry diagnostics
- depends_on: G2.1, S1.2
- write_scope: Desktop Gateway applet modules, telemetry/audit adapters
- read_first: `complex-applet-acceptance.md` §4.3-4.4, `service-architecture.md` §11, design validation §3.12-3.13
- deliverables: governed agent/AI stubs or handlers, quota/policy denial, sanitized stream events, telemetry schema/redaction, audit separation
- commands: Gateway tests; later desktop smoke agent-ai and audit outputs
- pass_criteria: applet receives sanitized results/events only; provider credentials/tool executor/system logs/audit writer never cross to applet
- fail_criteria: direct model endpoint/provider key exposed; telemetry can forge audit
- forbidden: raw provider/tool/system/audit internals

### D3.1 — Desktop package reader and integrity

- id: D3.1
- title: Desktop package reader and integrity validation
- depends_on: C0.2, C0.3
- write_scope: `apps/desktop/src/applet/**`, Desktop Tauri applet package reader if required
- read_first: `runtime-architecture.md`, `integration.md`, Desktop agent docs before editing Desktop code
- deliverables: package directory reader, manifest validation via contract, target/load match, integrity verification, diagnostics
- commands: Desktop frontend check/tests; later `pnpm applet:validate` and desktop smoke
- pass_criteria: missing manifest/entry/integrity fail; unsupported target fails; Host reads package contract only
- fail_criteria: Host reads producer source layout; standalone package path proves integrated acceptance
- forbidden: iframe, postMessage bridge main chain, producer-specific package name/path

### D3.2 — Desktop session lifecycle and bridge dispatcher

- id: D3.2
- title: Desktop governed session and bridge dispatcher
- depends_on: D3.1, G2.1
- write_scope: `apps/desktop/src/applet/**`, Desktop Tauri applet command/application/domain adapters
- read_first: `runtime-architecture.md` §10-12, implementation plan §7
- deliverables: session creation, runtime context injection, reportReady, show/hide/destroy, request/response envelope, invalid session rejection
- commands: Desktop tests; later `pnpm applet:desktop-smoke`
- pass_criteria: destroyed session returns `INVALID_SESSION`; requestId preserved; SDK receives typed response
- fail_criteria: applet generates session id; bridge protocol differs from contract
- forbidden: browser DOM/iframe as integrated runtime assumption

### D3.3 — Desktop Host stream UI delivery

- id: D3.3
- title: Desktop Host UI receives skills/tasks/agent stream events
- depends_on: D3.2, G2.3, G2.4, G2.5
- write_scope: `apps/desktop/src/applet/**`, Host UI event adapter surface only
- read_first: `complex-applet-acceptance.md` Scenarios C-E, `runtime-architecture.md`
- deliverables: Host-visible event delivery path for skill/task/agent stream events and final/error events
- commands: Desktop tests; later desktop smoke output files for skills/tasks/agent
- pass_criteria: Host UI receives ordered events per request/task id; final result closes stream
- fail_criteria: events only visible inside applet with no Host evidence
- forbidden: leaking raw internal tool execution details

### D3.4 — Desktop service override/dev attach

- id: D3.4
- title: Desktop service override/dev attach for smoke
- depends_on: G2.2, D3.2
- write_scope: Desktop smoke/runtime adapter and Gateway service override input
- read_first: `integration.md` §5, implementation plan §7 Dev Attach
- deliverables: CLI/runtime input shape for `--service <service-id>=<url>` equivalent passed to Host/Gateway, not baked into applet source
- commands: later `pnpm applet:desktop-smoke <package-dir> --service ...`
- pass_criteria: service override controls Gateway binding; applet still uses `service + path`; raw base URL is not exposed unless explicitly allowed by contract/policy
- fail_criteria: applet package hardcodes endpoint for acceptance
- forbidden: concrete producer service names or business endpoint assumptions

### T4.1 — Package validation CLI

- id: T4.1
- title: `pnpm applet:validate <package-dir>`
- depends_on: C0.2, C0.3
- write_scope: root/package scripts, tooling scripts/modules, contract validation utilities
- read_first: `development-runtime-readiness-report.md` Gate D, implementation plan §8
- deliverables: package validation command for manifest, entries, integrity, targets, permissions, services, skills
- commands: `pnpm applet:validate <valid-complex-package>`, invalid package cases
- pass_criteria: valid package passes; missing manifest/entry/integrity, hash mismatch, unsupported platform, unknown permission, invalid service/skill fail
- fail_criteria: command missing or only validates hello package
- forbidden: reading producer source layout

### T4.2 — Contract test CLI

- id: T4.2
- title: `pnpm applet:contract-test`
- depends_on: C0.3, S1.3
- write_scope: root/package scripts, contract/SDK test wiring
- read_first: `development-runtime-readiness-report.md` Gate E, implementation plan §8
- deliverables: executable bridge envelope, error, requestId, stream/task/session destroy contract tests
- commands: `pnpm applet:contract-test`
- pass_criteria: request/response envelope fields and invalid-session cases tested; cancellation response stable
- fail_criteria: top-level command missing with no lower-level evidence
- forbidden: platform-specific alternate envelope semantics

### T4.3 — Desktop smoke and evidence bundle

- id: T4.3
- title: `pnpm applet:desktop-smoke <package-dir>` and evidence bundle
- depends_on: G2.2, G2.3, G2.4, G2.5, D3.1, D3.2, D3.3, D3.4
- write_scope: tooling smoke runner, evidence writer, Desktop smoke adapter only
- read_first: `development-runtime-readiness-report.md` Gate F, implementation plan §8
- deliverables: desktop smoke command and non-empty `tooling/acceptance/evidence/applets/` files for host load, service binding, skills, tasks streaming, agent AI, gateway allow/deny, audit
- commands: `pnpm applet:desktop-smoke <package-dir>`
- pass_criteria: required evidence files are generated and non-empty; unimplemented gates say NOT_IMPLEMENTED until implemented
- fail_criteria: oral claim without logs/evidence; evidence omits denied cases
- forbidden: standalone acceptance as Desktop integrated proof

### T4.4 — Producer independence scan

- id: T4.4
- title: `pnpm applet:forbidden-producer-scan`
- depends_on: C0.2
- write_scope: tooling scan command/config/evidence output
- read_first: `development-runtime-readiness-report.md` Gate G, implementation plan §8
- deliverables: forbidden producer scan command and `producer-independence/` evidence
- commands: `pnpm applet:forbidden-producer-scan`
- pass_criteria: docs/scripts/Host code contain no concrete producer path/name/business domain; Host only reads package directory
- fail_criteria: scan missing; docs/scripts mention concrete producer coupling
- forbidden: listing concrete forbidden producer terms in architecture docs

### A5.1 — Generic conforming complex package input

- id: A5.1
- title: Generic conforming complex package input
- depends_on: C0, S1, G2, D3, T4.1, T4.2, T4.4
- write_scope: test fixture/package location if owned by Peers-Touch tooling; otherwise external package path only at runtime
- read_first: `complex-applet-acceptance.md`, implementation plan §9
- deliverables: package directory with manifest, Lynx bundle, integrity, service declarations, skill declarations, schemas, and SDK-only Host capability usage
- commands: `pnpm applet:validate <package-dir>`
- pass_criteria: package validates without Host reading producer source layout
- fail_criteria: package depends on Peers-Touch internal source layout or direct Host private APIs
- forbidden: concrete producer names/paths/business domains in Peers-Touch docs/code/scripts

### A5.2 — External complex Desktop acceptance run

- id: A5.2
- title: External complex Desktop acceptance run
- depends_on: A5.1, T4.3
- write_scope: evidence bundle only unless smoke fixes are required in scoped tickets
- read_first: `complex-applet-acceptance.md` §6, implementation plan §9
- deliverables: completed smoke run covering package validation, Desktop load, service binding, allow/deny network, skills, agent/AI stream, task cancellation, telemetry, audit, session destroy
- commands: `pnpm applet:desktop-smoke <package-dir> --service <service-id>=<dev-service-url>` equivalent
- pass_criteria: every A5 scenario passes with evidence
- fail_criteria: any A5 scenario missing, failed, or only standalone-proven
- forbidden: exposing raw service base URL/token/provider/tool/audit internals to applet

### A5.3 — Readiness declaration gate

- id: A5.3
- title: L3 readiness declaration gate
- depends_on: A5.2
- write_scope: progress file and evidence summary only
- read_first: `development-runtime-readiness-report.md` §8.12, implementation plan §9 Final L3 Claim
- deliverables: final readiness verdict table and evidence summary
- commands: review evidence bundle and smoke outputs
- pass_criteria: all A5 scenarios pass and evidence bundle attached; only then declare `L3 COMPLEX_DESKTOP_READY`
- fail_criteria: declaring L3 with missing/failed/NOT_IMPLEMENTED evidence
- forbidden: oral readiness claim without evidence

## Dependency And Parallelization

Strict serial backbone:

```text
C0 → S1 → G2 → D3 → T4 finalization → A5
```

Parallelizable after prerequisites:

- C0.1 must start first. C0.2 and C0.3 follow serially because they depend on canonical types.
- S1.1 can start after C0.1; S1.2 follows S1.1; S1.3 follows S1.2.
- G2.1 can start after C0.1 and may overlap with S1.1/S1.2, but G2.3-G2.5 require S1.2 method mapping.
- D3.1 waits for C0.2/C0.3; D3.2 waits for D3.1/G2.1; D3.3 waits for stream/skill/agent Gateway slices.
- T4.1 can start after C0.2/C0.3. T4.4 can start after C0.2. T4.2 waits for C0.3/S1.3. T4.3 waits for D3/G2 closure.
- A5 tickets must remain last and serial.

Must remain serial:

- C0.1 before all downstream implementation.
- A5.1 → A5.2 → A5.3.
- L3 declaration after evidence, not before.

## Completed This Session

- Read required progress and architecture sources before implementation.
- Implemented complex applet contract slice in `packages/applet-contract`: manifest, services, skills, integrity, full capability method registry, bridge envelope, invalid-session response, task/skill/agent/telemetry types.
- Implemented SDK complex surface in `packages/applet-sdk`: app, lifecycle, navigation, UI, events, skills, tasks, agent, AI, telemetry, Web Host adapter, service/path network request shape, storage/config response normalization.
- Implemented minimal Desktop Gateway/Desktop runtime slice: complex capability allowlist, app/lifecycle/system/ui/events/skills/tasks/agent/AI/telemetry handlers, raw URL rejection for network, service/path gateway result, Desktop parser alignment, integrity declaration checks, bridge request/session envelope.
- Implemented tooling: `applet:validate`, `applet:contract-test`, `applet:desktop-smoke`, `applet:forbidden-producer-scan`, generic complex package generator, and evidence bundle output.
- Generated `tooling/acceptance/evidence/applets/` with contract, sdk, package, desktop, and producer-independence evidence.

## Evidence

- Evidence bundle path: `tooling/acceptance/evidence/applets/`.
- New evidence files include:
  - `tooling/acceptance/evidence/applets/summary.md`
  - `.artifacts/applet-readiness/contract/schema-source.txt`
  - `.artifacts/applet-readiness/contract/schema-consumers.txt`
  - `.artifacts/applet-readiness/contract/validation-output.txt`
  - `.artifacts/applet-readiness/sdk/exported-api.txt`
  - `.artifacts/applet-readiness/sdk/forbidden-api-scan.txt`
  - `.artifacts/applet-readiness/sdk/complex-surface-output.txt`
  - `.artifacts/applet-readiness/sdk/contract-test-output.txt`
  - `.artifacts/applet-readiness/sdk/adapter-test-output.txt`
  - `tooling/fixtures/applets/packages/generic-complex-applet/`
  - `.artifacts/applet-readiness/package/manifest-validation-output.txt`
  - `.artifacts/applet-readiness/package/integrity-validation-output.txt`
  - `.artifacts/applet-readiness/package/bundle-artifact-output.txt`
  - `.artifacts/applet-readiness/desktop/host-load-output.txt`
  - `.artifacts/applet-readiness/desktop/service-binding-output.txt`
  - `.artifacts/applet-readiness/desktop/skills-output.txt`
  - `.artifacts/applet-readiness/desktop/tasks-streaming-output.txt`
  - `.artifacts/applet-readiness/desktop/agent-ai-output.txt`
  - `.artifacts/applet-readiness/desktop/gateway-allow-deny-output.txt`
  - `.artifacts/applet-readiness/desktop/audit-output.txt`
  - `.artifacts/applet-readiness/producer-independence/forbidden-producer-scan-output.txt`
  - `.artifacts/applet-readiness/producer-independence/host-package-input-output.txt`
- Commands run:
  - `pnpm install`
  - `pnpm --filter @peers-touch/applet-contract run build`
  - `pnpm --filter @peers-touch/applet-sdk run check`
  - `pnpm applet:contract-test`
  - `pnpm applet:create-generic-package`
  - `pnpm applet:validate .artifacts/applet-readiness/packages/generic-complex-applet`
  - `pnpm applet:desktop-smoke .artifacts/applet-readiness/packages/generic-complex-applet`
  - `pnpm applet:forbidden-producer-scan`
  - `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` reached existing Tauri `frontendDist` missing path blocker after library checks.

## Blockers

- Release L3 cannot be honestly declared for third-party producer certification until `pnpm applet:external-producer-certification-gate <external-package-dir>` is run against a real independently authored conforming package and its evidence is attached. The gate has passed against `/tmp/peers-touch-external-l3-cert`, which proves outside-repository package input but remains tooling-generated evidence.
- Desktop Rust `cargo check` and full Tauri bundle now pass, but these are build gates rather than live complex applet E2E proof.
- C0 generated JSON Schema output remains future hardening; canonical TypeScript contract and executable validation are in place.
- G2/D3 include minimal governed handlers and evidence but still need product-grade persistent session/task/stream registries and real upstream service proxy integration.

## Next Step

Ticket: packaged-product-acceptance-and-third-party-certification
Reason: The repository now has a strict external-producer certification gate that chains validate, Desktop runtime, product Host, real Gateway, normal product shell route, packaged product-window through the normal shell, and live Desktop E2E gates while rejecting repository-local packages by default, and it has passed against a generated package outside the repository. The remaining release steps are manual normal-user product acceptance and running the same certification gate against a real independently authored third-party package while capturing Host UI/service/stream/audit logs.
Read first: `docs/architecture/applet-runtime/README.md`, `docs/architecture/applet-runtime/complex-applet-acceptance.md`, `docs/architecture/applet-runtime/development-runtime-readiness-report.md`, `docs/architecture/applet-runtime/execution-plans/2026-06-06-complex-applet-implementation-plan.md`, this progress file, `runtime-architecture.md`, `service-architecture.md`, and Desktop agent docs.
