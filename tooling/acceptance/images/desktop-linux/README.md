# Linux Native Desktop Cell Image

This image provides the supported userland for `desktop-linux-native`:

- Ubuntu 24.04 base pinned by OCI digest.
- WebKitGTK 4.1 and the Tauri Linux build dependencies.
- Node, pnpm, Rust, Cargo, Python, and protobuf build tools.
- A persistent Xorg dummy output at `1920x1080`.
- Openbox, DBus, GNOME Keyring, XTest/EWMH tools, screenshots, and x11vnc.

`entrypoint.sh` is the in-container process supervisor. It starts Xorg, DBus,
keyring, Openbox, the loopback-only observer, and the Desktop binary, then
terminates them in reverse order.

`remote_control.py` is copied from the exact Git checkout into the run directory
before it starts the detached TTL reaper. The run-bound copy owns the lease,
stale-run cleanup, and bounded run-directory retention even after the shared
checkout changes. Cleanup fails closed and retains lease metadata if a
container, port, source checkout, or run directory cannot be released.
Persistent Git and build caches are outside run directories and are never
mounted into source identity checks.

The image may be pulled through a profile-selected registry mirror, but the
base reference must preserve the canonical digest declared by `Containerfile`.
