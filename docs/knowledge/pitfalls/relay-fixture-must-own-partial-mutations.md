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
  - tooling/acceptance/fixtures/social_relay_capture.py
  - tooling/acceptance/fixtures/social_relay_capture_worker.py
  - tooling/acceptance/fixtures/social_relay_packet.py
  - tooling/acceptance/gates/social/public_feed_native.py
  - tooling/acceptance/gates/social/test_public_feed_native.py
  - tooling/acceptance/tests/test_relay_attachment.py
  - tooling/acceptance/tests/test_station_access_relay_role.py
  - tooling/acceptance/tests/test_mobile_simulator_provisioner.py
  - tooling/acceptance/tests/test_social_relay.py
  - tooling/acceptance/tests/test_social_relay_capture.py
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

Reverse cleanup alone does not protect dependencies when one callback fails:
a Native Public run removed its Relay CA after attachment retirement timed out,
so the next Controller retry failed TLS verification. The shared fixture now
tracks attempted imports until its original detach callback confirms absence.
That Station's CA cleanup refuses while retirement is pending. The original
Social parent retains the fixture before equipment or attachment can fail, and
notification-runtime restoration refuses to recreate its container until owned
attachments are retired. Unrelated Station cleanup and reused operator
attachments acquire no such dependency. Run the actual callback regressions in
`test_relay_attachment` and `test_private_social_native_provisioner`: an unknown
import plus failed retirement preserves trust, successful retry permits removal,
and partial preparation cannot discard the cleanup owner.

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
Public and private cross-Station Native Social compose `SocialRelayFixture`
at the original Suite parent. A private run that prepared schema and DHT
locators but reused ambient Relay state timed out resolving the remote Actor:
the local Relay was active while the remote Station had no verified route
there. Both suites must prepare the declared shared Relay before resolving
actors; private schema verification stays before attachment and is unchanged.
Only Public Social prepares the opaque-capture observer and capability.
Its optional Relay service cannot become a third Station or alter private
Social schema ownership. Equipment must reject a foreign health origin or
stable target before deployment; the original canonical deployment process
receives no inherited parent lease or Station runtime-control fields.
Under retained leases, the exact Relay source and executable plus both Station
containers, peer identities and joined route generations must be read back.
Run `python3 -m unittest tooling.acceptance.tests.test_social_relay` to check
that order and the original parent's evidence/cleanup ownership.
Run `python3 -m unittest
tooling.acceptance.tests.test_private_social_native_provisioner` to require
Relay equipment before retained leases, unchanged physical schema evidence,
both Station attachments, no private capture, and failed attachment refusal
without a ready transport inventory.
Focused checks do not establish deployed Social or Circuit product proof.

Capture has a separate source-bound, one-shot ephemeral capability. Register
its unique root before the first remote write; quarantine stops only recorded
PID/start-time identities and removes only owned private files. The capture
worker must use immediate kernel packet delivery as well as unbuffered file
output: `tcpdump -U` alone can stop with a valid header and no packets despite
completed socket traffic. Require complete dpkt framing, exact authenticated
four-tuples, positive bytes in both directions on both legs and zero kernel
drops. Pcap and lifecycle checks never substitute for original receiver paint.

The capture namespace uses the container's TCP listener, not the published
host port. A real Relay exposed host port 4112 while its authenticated
connections used container port 4001; comparing those different namespaces
rejected both correct legs before capture began. Resolve the reviewed published
port through the same source/PID-verified container's Docker TCP bindings,
require one container listener, then bind the complete authenticated Node
connection sets on that listener. IPv4/IPv6 publications of the same listener are
one binding; missing, UDP-only, ambiguous or wrong-listener bindings fail.
The worker still receives only the original PID/start-time identity, and
before/after checks retain exact routes, connections and four-tuples.
Run `python3 -m unittest tooling.acceptance.tests.test_social_relay_capture`
to replay the emitted Docker observer and actual snapshot selection.

An arm failure must retain the original owner's bounded stage observation:
namespace, signed-route source/verification, operator token, authenticated
metadata, unique TCP legs, or worker startup. The privileged worker projects
only fixed failure categories; its owned startup-failure descriptor remains
in the same cleanup inventory. Raw stdout, stderr, command input and packet
bytes never become diagnostics. The parent validates that closed projection
before attaching it to the existing `ResourceDiagnostic`; unknown output is
discarded without hiding the stage or remote exit code. The same focused
test command checks phase attribution, hostile output rejection and owned
partial-startup cleanup. A diagnostic category does not prove a product fix.
For a missing or over-bound authenticated TCP set, retain the original failing Node
and candidate sample rather than trying to reconstruct it after cleanup. The
original handler records Station/Node identity hashes, candidate count, at most
four connection/address hashes and numeric ports, and a truncation flag.
The focused tests require this projection to remain bounded and detached from
later metadata mutation, with no arbitrary identity/address text. Zero or
more than four candidates per Node still refuse capture before the worker starts. Multiple
connections alone do not prove duplicate processes: the pinned libp2p
simultaneous-dial test permits up to two connections for one pair of Hosts.
The original unique-connection assumption rejected that valid state. The
handler now captures every authenticated tuple in the bounded sets, preserving
all connection IDs, routes and tuples at finish. The worker's BPF covers each
tuple in both directions. Packet observation scans all bytes and requires at
least one actual bidirectional payload-bearing leg per Station; idle siblings
cannot hide plaintext, and opposite one-way siblings cannot manufacture that
condition. The original snapshot, emitted BPF and pcap finish regression covers
parallel stream placement, idle siblings, split plaintext and connection churn.

The original Public Relay scenario captured Bob and Alice with the same label
after bilateral comment confirmation. The second screenshot had different
bytes and the immutable store correctly rejected it before capture finish.
Each actor's screenshot and DOM must receive a distinct scenario/actor label
at this existing caller. Keep the store's overwrite rejection and all original
paint, route, packet and cleanup conditions. Run `python3 -m unittest
tooling.acceptance.gates.social.test_public_feed_native` to execute the actual
scenario and screenshot/DOM owner against a real temporary immutable store:
both actor captures survive independently, finish precedes clear, and reuse
of a shared label with different bytes still fails.

The capture handler executes in the Suite parent, where the Gate child's
`PT_ACCEPTANCE_*` run context is not ambient. A real finish flushed its pcap,
then failed with `EvidenceRootInvalid` when the handler called the current
artifact writer without that context. The original provisioner must pass its
bound evidence run's explicit environment through the fixture to this handler.
Snapshot it and supply it to every pcap/observation write and ref resolution;
keep provisioning identity distinct and leave process-global variables alone.
The existing close owner clears that snapshot, including redaction values.
If quarantine fails, both `closed` and `secrets_zeroized` remain false; the
retained context is cleared only after the original cleanup retry succeeds.
The focused capture tests use a real temporary store with no ambient context,
checking original bytes, matching run refs, unchanged packet assertions and
owned cleanup. Stubbed artifact writers alone cannot detect this failure.
