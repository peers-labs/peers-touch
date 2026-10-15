# Mobile Android USB Network

Use this playbook for a physical Android Acceptance cell that must reach a
Station through the developer Mac while preserving the Station's canonical
origin.

## Owner

`MobileAndroidPhysicalProvisioner` owns the complete reverse-tether lifecycle.
The product Station registry, identity verifier, Auth runtime, and Social
transport continue to use the signed canonical Station origin.

## Required Transport

- Host relay: `gnirehtet` 2.5.1 from the reviewed Darwin arm64 Homebrew
  package. Executable SHA-256:
  `5332243035c8b8a1094b575e653e80a14cf9efeecd96eaa7e8d6aeaeeb45b3c0`.
- Android client:
  `tooling/acceptance/android/usb-network-companion`, built from the current
  source with the repository Android Gradle wrapper.
- Companion package:
  `com.peers.touch.acceptance.usbnetwork`.
- One USB-authorized physical Android device.
- One numeric IPv4 Station HTTP(S) origin.

Any relay identity, source build, device-side APK hash, endpoint shape, or
device identity mismatch is `BLOCKED/UNPROVEN`.

## Lifecycle

1. Resolve and attest the exact host relay.
2. Build the companion from current repository source and record both its
   source-tree digest and APK SHA-256.
3. Allocate one run-scoped relay port.
4. Record the companion package baseline. A mismatched pre-existing package
   blocks without replacement.
5. Install the source-built APK when absent. On OPPO, automation may accept
   only the package-detail confirmation whose exact app label is
   `Peers USB Network`.
6. Start the reviewed relay, map `localabstract:gnirehtet` to the run-scoped
   relay TCP port, and start the companion route for `<station-ip>/32`. On
   first use, automation may accept only the system VPN consent dialog.
7. Require the exact ADB reverse mapping, a live `tun*` route for the Station
   IPv4 address, and a device-side health request to the original canonical
   Station origin.
8. Launch Mobile and call `station.add` with the original canonical origin.
9. Require Station identity proof to return that same canonical origin.
10. Record relay hash, companion source/APK hashes, route, port, and package
    baseline in the Runtime Manifest.
11. During reverse cleanup: stop and force-stop the companion, remove the ADB
    mapping, terminate and reap the relay, then uninstall the companion only
    when this run installed it.
12. Verify no client process, VPN route, or reverse mapping remains and the
    package baseline is restored.

## Forbidden

- Rewriting the Station URL to `127.0.0.1`.
- Weakening or bypassing `canonicalOriginMismatch`.
- Passing a routable transport endpoint into the Gate or product registry.
- Installing a patched Peers APK or embedding an Acceptance-only proxy in the
  product.
- Using a patched third-party helper APK.
- Mutating `ACTIVATE_VPN`, disabling permission monitoring, or changing another
  device-wide security control.
- Leaving the VPN, relay, ADB reverse, UI dump, or companion package outside
  its pre-run baseline.

## Verification

```bash
python3 -m unittest \
  tooling.acceptance.tests.test_mobile_native_preflight.AndroidUsbNetworkTransportTests

rg -n \
  '_AndroidUsbStationTransport|_LoopbackTcpRelay|rewrite_station_url|usb-station-transports|ACTIVATE_VPN|appops' \
  tooling/acceptance apps/mobile
```

The unit test must pass and the search must return no live implementation
references. Final product proof still requires the exact-source physical
Android Journey and its declared Gate.
