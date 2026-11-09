---
kind: pitfall
title: Relay preparation owns partial mutations without replacing operator intent
status: active
owns:
  - tooling/acceptance/provisioners/relay_attachment.py
  - tooling/acceptance/provisioners/station_access_relay_role.py
  - tooling/acceptance/provisioners/mobile_simulator.py
  - tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py
  - tooling/acceptance/provisioners/social_relay.py
  - tooling/acceptance/tests/test_relay_attachment.py
  - tooling/acceptance/tests/test_station_access_relay_role.py
  - tooling/acceptance/tests/test_mobile_simulator_provisioner.py
  - tooling/acceptance/tests/test_social_relay.py
related:
  - ../../architecture/platform/runtime/node-connectivity/relay-attachment/integration.md
referenced-by: []
detected: 2026-11-09
---

# Relay preparation owns every attempted mutation

The original Relay fixture overwrote a fixed CA path, registered cleanup only
after restart and attachment convergence, and replaced an existing recovering
attachment. Unknown write/import outcomes could leave trust or enrollment
authority behind, and cleanup could delete operator-owned state.

The shared `RelayAttachmentFixture` registers each cleanup before its mutation.
CA files use unique absent paths, exclusive partial writes and atomic no-clobber
publication. Cleanup verifies the original Compose container, file type/mode/
owner and final digest; it admits empty partial files without waiting for an
unhealthy process before removal, then retires cached trust by restarting the
same container. A replacement container or changed final file is not owned.

Reuse an existing active attachment only at its exact origin, without acquiring
its cleanup. Preserve nonactive live intent. The original ListAttachments omits
fully retired logical tombstones; the original Controller intentionally permits
re-importing that retired identity. No new include-disabled API is required.
New imports use a unique invitation label and retain Station/Relay/origin
identity. Detach uses the original Controller and its cleanup-pending retry.
Unused invitations are deleted and read back through the original Relay API;
consumed one-use invitations have no remaining token authority.

## How to detect a recurrence

Run `python3 -m unittest tooling.acceptance.tests.test_relay_attachment
tooling.acceptance.tests.test_station_access_relay_role` and the
`mobile_relay` tests in `test_mobile_simulator_provisioner`.
The actual emitted scripts must reject replacement, changed final bytes,
symlinks and directories while admitting empty/partial owned writes. Unknown
API outcomes must already have cleanup, and operator attachments must receive
no replacement or deletion call.

All consumers compose the shared owner through their own cleanup registration.
Do not instantiate another concrete provisioner to borrow private methods.
Equipment precedes retained leases; preparation and cleanup consume them.
Public Social composes `SocialRelayFixture` at the original Suite parent.
Its optional Relay service cannot become a third Station or alter private
Social schema ownership. Equipment must reject a foreign health origin or
stable target before deployment; the original canonical deployment process
receives no inherited parent lease or Station runtime-control fields.
Under retained leases, the exact Relay source and executable plus both Station
containers, peer identities and joined route generations must be read back.
Run `python3 -m unittest tooling.acceptance.tests.test_social_relay` to check
that order and the original parent's evidence/cleanup ownership.
Focused checks do not establish deployed Social or Circuit product proof.
