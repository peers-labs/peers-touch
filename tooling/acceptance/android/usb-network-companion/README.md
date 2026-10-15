# Android USB Network Companion

This source-built Acceptance helper gives a leased physical Android device a
route to one manifest-bound Station origin through the host's USB connection.
It is installed only for the Suite Runtime that owns the device and is removed
during cleanup when it was not already present.

The client data plane is derived from Genymobile gnirehtet `v2.5.1`
(`67e1fafcc2cb8bbe0f04606ddb2b108dee9bebb6`) under Apache-2.0. The Peers-Touch
module owns its package name, exported start/stop control Activity, VPN consent,
source build, APK attestation, and package baseline restoration. The host relay
remains the reviewed gnirehtet 2.5.1 executable.

The companion never changes a Station URL. Android continues to request the
Station's signed canonical origin while the VPN route carries packets for only
that origin's IPv4 `/32`.

Build with the repository's pinned Android Gradle wrapper:

```bash
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/peers-usb-network.XXXXXX")"
apps/mobile/src-tauri/gen/android/gradlew \
  -p tooling/acceptance/android/usb-network-companion \
  --project-cache-dir "$BUILD_ROOT/project-cache" \
  -PpeersTouchBuildDir="$BUILD_ROOT/apk-build" \
  --no-daemon --console=plain assembleDebug
```

The Mobile Native Provisioner is the only runtime owner. Do not install,
launch, authorize, or retain this package from a business Gate or Scenario.
It also owns removal of `BUILD_ROOT`.
