# iOS Host Behavior

> **Status**: source-complete, runtime-unproven
> **Updated**: 2026-10-17

iOS refines the shared Mobile product with native system behavior:

- APNs registration, failure, receipt, tap, and background wakeups enter the
  Rust-owned reconciliation path;
- app settings, external links, and sharing use the same typed action outcomes
  as Android;
- permissions and capability facts preserve denied, restricted, unavailable,
  unsupported, and unknown states;
- BGTask wakeups do not mutate product stores or duplicate retry policy;
- picker and camera results stay behind Rust-owned opaque media handles.

Swift does not expose UIKit objects, APNs tokens, native paths, or provider
payloads to the Web layer. Source and simulator checks are supporting evidence
only; APNs and background support require a signed physical-device Suite with
provider callbacks and cleanup evidence.

`BGTaskSchedulerErrorDomain/unavailable` is an observed capability limit,
including on Simulator or when Background App Refresh is disabled. The native
adapter returns `registered=false`; Rust preserves push activation and exposes
`scheduledReconcileRegistered=false`. Foreground reconciliation remains usable.
Other scheduler failures and an unexpected work identifier remain errors.

Station Runtime renews the signed route before its expiry and restores it on
bootstrap and foreground resume. The shared native route owner renews within
60 seconds of expiry, matching the Station runtime timer, and serializes
renewal so concurrent callers reuse the newly verified proof. Discovery runs
outside selection locks; commit rechecks both the active selection and cached
candidate. A failed discovery does not extend the old signed lifetime.
Native restore and renewal return one result
containing the verified route and its binding revision; the registry persists
both before dependent runtimes use them. A same-process lifecycle restart must
not decrease that revision. Renewal retains the Station, root key, node, route,
source and endpoint with non-decreasing authorization epoch and route generation;
restore rejects a different stored generation. A late discovery result cannot
replace a concurrently selected or removed route. Renewal prepares a request
before submission and never replays a submitted mutation. Renewal timers stop
with the Station runtime.

The native route-source namespace stores a typed installation-private record.
After initial current-time material validation and signed discovery, public
sources retain the unchanged material and its actual admission time. Restore
and renewal recheck those pins at admission time, then verify a fresh challenge,
current Node authorization and signed route at the current time. Transfer TTL
does not extend or expire an admitted direct discovery pin. Custom endpoint
TLS trust remains in force. External Schema inputs cannot import these records;
generic secure-storage commands cannot access their namespace. Old records
without admission facts fail closed and require fresh connection admission.
Circuit connection-grant expiry remains enforced by its existing owner.

The existing Mobile logger exposes only fixed proxy stages and the standard
transport's error kind and submission phase under `station-route`. It does not
log route identities, URLs, queries, request bodies or transport error messages.
