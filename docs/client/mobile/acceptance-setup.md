# Mobile Acceptance Setup

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-03 | **Updated**: 2026-09-20
> **Owner**: Mobile Team
> **Module**: `apps/mobile/`

---

## 1. Purpose

Step-by-step procedures for setting up and running mobile acceptance gates.
For the architectural contract and environment definitions, see
`docs/architecture/platform/client/mobile/mobile-acceptance-environment.md`.

## 2. Prerequisites

### 2.1 Common

- Node.js and pnpm (project-pinned versions).
- Python 3.11+ with the project virtual environment activated.
- Appium 2.19.0 installed globally: `npm install -g appium@2.19.0`.
- Repository cloned with proto generation complete: `./model/build.sh` and
  `./tooling/scripts/proto-gen-mobile.sh`.

### 2.2 iOS

- Xcode (latest stable) with iOS Simulator runtimes.
- Two pinned iOS Simulator devices for independent-session and two-actor Gates.
- Command-line tools: `xcode-select --install`.
- Appium XCUITest driver 9.10.5: `appium driver install xcuitest@9.10.5`.
- WebDriverAgent builds automatically with the XCUITest driver. If WDA build
  fails, see Troubleshooting below.

### 2.3 Android

- Android SDK with platform tools and build tools.
- Android Emulator tooling is optional diagnostic setup only.
- Appium UiAutomator2 driver 4.2.9: `appium driver install uiautomator2@4.2.9`.
- Compatible Chromedriver for WebView context switching (see
  `mobile-simulator.yaml` `appium.chromedriver.artifacts` for the pinned
  version).

### 2.4 Verify Appium Installation

```bash
appium --version
# Expected: 2.19.0

appium driver list --installed
# Expected: xcuitest@9.10.5, uiautomator2@4.2.9
```

## 3. iOS Simulator Setup

### 3.1 Boot a Simulator

```bash
# List available simulators
xcrun simctl list devices available

# Boot the preferred device (matches mobile-simulator.yaml selector)
xcrun simctl boot "iPhone 17"
```

W9-B layout and accessibility evidence uses the dedicated
`mobile-ios-layout-simulator` environment. It requires one iOS 26.5
`iPhone 17`; its Provisioner owns boot, install, the Appium session, uninstall,
shutdown, and storage cleanup.

### 3.2 Build for Simulator

The acceptance build requires the Harness flag:

```bash
export VITE_ACCEPTANCE_HARNESS=1
export MOBILE_TAURI_STATIC_BUNDLE_BUILD=1

# Build the web layer
pnpm --dir apps/mobile run build

# Build the iOS app for simulator
xcodebuild \
  -project apps/mobile/src-tauri/gen/apple/peers-touch-mobile.xcodeproj \
  -scheme peers-touch-mobile_iOS \
  -configuration debug \
  -sdk iphonesimulator \
  -destination "id=$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=json.load(sys.stdin); print([u for r in d["devices"].values() for u in r if u["state"]=="Booted"][0]["udid"])')" \
  -derivedDataPath build/ios-derived \
  build
```

### 3.3 Install on Simulator

```bash
# Find the built .app
APP_PATH=$(find build/ios-derived/Build/Products/debug-iphonesimulator -name "*.app" -maxdepth 1)

# Install
xcrun simctl install booted "$APP_PATH"

# Launch
xcrun simctl launch booted com.peers.touch.mobile
```

## 4. Optional Android Emulator Diagnostics

### 4.1 Create and Boot an AVD

```bash
# Create an AVD matching the mobile-simulator.yaml selector
avdmanager create avd \
  -n peers_touch_applet_l3_e2e \
  -k "system-images;android-34;google_apis;arm64-v8a" \
  --device "pixel_7"

# Boot the emulator
emulator -avd peers_touch_applet_l3_e2e -no-snapshot-load &
```

### 4.2 Build and Install APK

```bash
export VITE_ACCEPTANCE_HARNESS=1

# Build via Tauri CLI
pnpm --dir apps/mobile exec tauri android build \
  --ci --debug --target aarch64 --split-per-abi --apk \
  --config '{"build":{"devUrl":null}}'

# Find and install the APK
APK_PATH=$(find apps/mobile/src-tauri/gen/android/app/build/outputs/apk/arm64/debug -name "*.apk")
adb install "$APK_PATH"
```

### 4.3 Chromedriver for WebView

The Android WebView context requires a Chromedriver matching the WebView/Chrome
version on the emulator. The pinned version is declared in
`tooling/acceptance/environments/mobile-simulator.yaml` under
`appium.chromedriver.artifacts`.

```bash
# Check the WebView version on the emulator
adb shell dumpsys webviewupdate | grep "Current WebView package"

# Download the matching Chromedriver from the URL in mobile-simulator.yaml
# Place it at the path referenced by the environment config
```

## 5. Station Provisioning

### 5.1 Verify Station Reachability

The Station must expose the endpoints listed in
`docs/architecture/platform/client/mobile/mobile-acceptance-environment.md` Section 5.

```bash
# From the host machine (iOS simulator shares host network)
curl -s http://<station-host>:<port>/sub-bootstrap/station-identity | head -c 200

# From Android emulator (use 10.0.2.2 for host-local Station)
adb shell curl -s http://10.0.2.2:<port>/sub-bootstrap/station-identity | head -c 200
```

A 404 or connection refused on `/sub-bootstrap/station-identity` means the
Station does not have the identity endpoint deployed. This blocks MS-AG02 and
all subsequent gates that require Station interaction.

### 5.2 Station Actor Provisioning

For two-actor gates, the Station must have two isolated PTID accounts. The
fixture script handles this:

```bash
python3 -m tooling.acceptance.fixtures.mobile_native_reset --prepare
```

## 6. Dev Server Versus Embedded Build

| Mode | When to use | How |
|---|---|---|
| Dev server | Iterating on web UI; hot reload needed | `pnpm --dir apps/mobile run dev` + Tauri dev mode |
| Embedded build | Acceptance evidence collection; CI | Build with `MOBILE_TAURI_STATIC_BUNDLE_BUILD=1`; install artifact |

Acceptance evidence must come from embedded builds. Dev server runs are valid
for development iteration but do not produce acceptance-grade artifacts.

## 7. Running Acceptance Gates

### 7.1 Static Gates (MS-AG01)

```bash
pnpm mobile:check
pnpm --dir apps/mobile run check:mobile-shell-contracts
./tooling/scripts/proto-gen-mobile.sh
```

### 7.2 Simulator E2E Gates

```bash
# Run the callback and restart simulator suite
python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-access-e2e

# Run W9-B on the current iPhone 17 Simulator cell
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-ios-simulator-layout-accessibility-e2e

# Run the W3 runtime-graph lifecycle cell on two isolated iOS Simulators
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-simulator-runtime-lifecycle-e2e

# Run the W3 Station/session lifecycle cell after explicit disposable reset approval
MOBILE_ACCEPTANCE_RESET=1 \
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-simulator-station-lifecycle-e2e

# Run required two-actor same-Station product evidence
MOBILE_ACCEPTANCE_RESET=1 \
python3 tooling/scripts/acceptance-run.py \
  --station-profile station=chat-native-disposable \
  --gate mobile-simulator-social-convergence-e2e
MOBILE_ACCEPTANCE_RESET=1 \
python3 tooling/scripts/acceptance-run.py \
  --station-profile station=chat-native-disposable \
  --gate mobile-simulator-chat-contacts-e2e
MOBILE_ACCEPTANCE_RESET=1 \
python3 tooling/scripts/acceptance-run.py \
  --station-profile station=chat-native-disposable \
  --gate mobile-simulator-recovery-e2e \
  --gate mobile-simulator-recovery-ui-e2e \
  --gate mobile-simulator-moments-e2e
MOBILE_ACCEPTANCE_RESET=1 \
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-simulator-settings-e2e

# Run required iOS Simulator permission/network/accessibility evidence
python3 tooling/scripts/acceptance-run.py \
  --gate mobile-simulator-platform-e2e
```

The runner reads `tooling/acceptance/environments/mobile-simulator.yaml`,
provisions Appium, builds and installs the app, runs the gate scenarios from
`tooling/acceptance/gates/mobile/simulator_e2e.py`, and collects evidence.
The W9-B Gate reads
`tooling/acceptance/environments/mobile-ios-layout-simulator.yaml`, reuses the
base iOS build/Appium contract, and records source-bound screenshots, native
accessibility trees, WebView DOM audits, keyboard avoidance, English/Chinese
locale state, portrait/landscape bounds, and deterministic cleanup for the
declared iPhone 17 cell. It does not prove older iPhone generations, alternate
viewport sizes, Android, physical displays, VoiceOver/TalkBack, authenticated
Shell surfaces, or physical performance.
The W3 lifecycle Gate uses the shared `mobile-simulator` environment and drives
the production lifecycle kernel through typed Harness actions on isolated iOS
Simulator clients. It proves runtime-graph start, suspend, resume, restart, monotonic
generation, visible-app survival, and deterministic session cleanup. It does
not prove Station session revalidation, Station or actor switching, revocation,
physical background/foreground delivery, or secure-storage failure behavior.
The Station-bound W3 Gate uses
`mobile-station-lifecycle-simulator`, two source-attested disposable Stations,
and the same actor on both iOS Simulator clients. It requires explicit reset
authorization and proves only the AS-04/AS-10 simulator cell; Relay, provider
credentials, physical background/foreground, and secure-delete failure remain
outside that Gate. `mobile-simulator-settings-e2e` reuses this environment and
its parent-owned Runtime Binding for same-account Profile/Notification
readback and device-local settings isolation.
The two-actor Social, Chat/Contacts, Recovery, and Moments Gates use
`mobile-direct-simulator` and bind both isolated iOS clients to one approved
disposable Station. They do not acquire Relay and prove only same-Station
behavior. `mobile-social-simulator` retains the two-Station plus Relay topology
for a future Desktop/Mobile cross-Station plan and remains unproven here.

### 7.3 Optional Native E2E Diagnostics (Physical Devices)

```bash
# Requires physical devices connected and environment variables set
python3 tooling/scripts/acceptance-run.py --gate mobile-native-access-e2e
```

These Gates do not participate in required Mobile completion. The runner reads
`tooling/acceptance/environments/mobile-native.yaml` and requires:
- Physical devices connected (`xcrun xctrace list devices` / `adb devices -l`).
- Environment variables for provider accounts and device configuration.
- Station services running and healthy.

### 7.4 Full Acceptance Run

```bash
make acceptance PLAN=tooling/acceptance/plans/mobile-shell.json
make acceptance-report
make acceptance-coverage-report
```

## 8. Troubleshooting

### 8.1 ATS Blocking HTTP (iOS)

**Symptom**: iOS app cannot connect to HTTP Station; connection refused or
timeout.

**Cause**: App Transport Security blocks cleartext HTTP by default.

**Fix**: Verify the debug build's `Info.plist` contains:
```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```

This must only be present in debug/acceptance configurations.

### 8.2 Android Emulator Cannot Reach Host Station

**Symptom**: Emulator app cannot connect to Station running on localhost.

**Cause**: Emulator's `localhost` is the emulator itself, not the host.

**Fix**: Configure the Station address as `10.0.2.2:<port>` in the app's
Station configuration when targeting the Android emulator.

### 8.3 Station Identity 404

**Symptom**: `/sub-bootstrap/station-identity` returns 404.

**Cause**: Station does not have the identity endpoint deployed or the
subserver is not registered.

**Fix**: Verify Station deployment includes the identity subserver. Check
Station logs for registration errors. This blocks W9-C and all subsequent
acceptance phases.

### 8.4 WebDriverAgent Build Failures (iOS)

**Symptom**: Appium XCUITest session fails to start; WDA build error.

**Cause**: Xcode signing, provisioning profile, or WDA project configuration
issue.

**Fix**:
1. Open `~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent/WebDriverAgent.xcodeproj` in Xcode.
2. Select the `WebDriverAgentRunner` target.
3. Set a valid signing team under Signing & Capabilities.
4. Build once manually to verify.
5. For simulators, automatic signing with a personal team is sufficient.

### 8.5 Chromedriver Version Mismatch (Android)

**Symptom**: Cannot switch to `WEBVIEW_*` context; Chromedriver error.

**Cause**: Installed Chromedriver does not match the WebView/Chrome version on
the emulator or device.

**Fix**: Check the WebView version (`adb shell dumpsys webviewupdate`) and
download the matching Chromedriver from the artifacts list in
`mobile-simulator.yaml`. The major versions must match.

### 8.6 Appium Session Timeout

**Symptom**: Appium server starts but session creation times out.

**Cause**: Device not booted, app not installed, or capability mismatch.

**Fix**:
1. Verify device is booted: `xcrun simctl list devices booted` or `adb devices`.
2. Verify app is installed: `xcrun simctl get_app_container booted com.peers.touch.mobile` or `adb shell pm list packages | grep peers`.
3. Check Appium server logs for capability negotiation errors.

## 9. References

- Environment contract: `docs/architecture/platform/client/mobile/mobile-acceptance-environment.md`
- Gate runner details: `tooling/acceptance/gates/mobile/README.md`
- Acceptance matrix: `docs/architecture/platform/client/mobile/acceptance-matrix.md`
- Simulator environment config: `tooling/acceptance/environments/mobile-simulator.yaml`
- Physical environment config: `tooling/acceptance/environments/mobile-native.yaml`
