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
bootstrap and foreground resume. Native restore and renewal return one result
containing the verified route and its binding revision; the registry persists
both before dependent runtimes use them. A same-process lifecycle restart must
not decrease that revision. A changed Station, route generation, root key, node,
or authorization epoch is rejected, and a late discovery result cannot replace
a concurrently selected route. Renewal timers stop with the Station runtime.
