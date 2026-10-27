# Native Device Link

`mod.rs` owns the one persisted attempt, authentication fences, route restoration
and status driver. `intake.rs` admits native scan payloads and replays the exact
claim. `delivery.rs` verifies signed HPKE material, proves enrollment and commits
through the existing OAuth Session owner. `actions.rs` handles Access submission
and cancellation. `protocol.rs` fixes every RPC to the original verified route;
`projection.rs` publishes only displayable state.

Route transition intent is saved before activation. Credentials are staged only
after verified route persistence and acknowledged only after secure readback.
An expired attempt without delivery clears locally before network restoration.
Committed state resolves the current Session owner rather than replaying a saved
Session projection after rotation or logout.
Committed renderer admission revalidates the canonical Session through Station
Access. Cleanup-only claim replay retains the original installation and request
generation after logout; it cannot authorize enrollment or Session installation.
Every post-intake route transition uses owned reconnect admission.

Contract: [Mobile Scan Login](../../../../../../docs/architecture/domains/identity/mobile-scan-login/README.md).
