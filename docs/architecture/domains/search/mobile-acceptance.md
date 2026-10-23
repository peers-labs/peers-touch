# Mobile device Search Acceptance

Mode: COMPLETE / UPGRADE. Owner: Chat business injection. Stage: EXECUTE under
the approved Mobile Search completion request.

The accepted Search and Mobile contracts already define device-only retrieval,
original Messaging authority, scoped queries, full-screen Search, canonical
message/thread anchors, Settings navigation, private lifecycle fencing, and
bounded reads. This document connects those assertions to native proof.

Current source/prototype checks are STRUCTURAL_ONLY / UX_REVIEW. Every native
assertion below is UNPROVEN until its current-source Gate succeeds on both iOS
Simulator and Android Emulator.

- Real received Chinese messages, thread replies and long attachment filenames:
  Search input, submit and result rows on each receiver.
- Historical open, thread open, return, reopen, repeat and backspace:
  canonical Chat anchor and unchanged original-source read counters.
- Pagination, conversation scope, explicit refresh, empty/error recovery:
  visible controls, real results and bounded native reads.
- Real edits and retracts, forged authority and stale references:
  receiver invalidation and typed native denial.
- Background/resume and same-process account change:
  private projection removal, new authenticated scope and old-cursor denial.
- Settings, locale, touch targets and safe layout:
  real target, readable copy and captured native geometry.
- Persisted light/dark preferences and native software-keyboard typing:
  real Settings save, distinct painted themes, input/submit/content clearance
  against the visual viewport, and keyboard dismissal on both platforms.

The Feature `chat-mobile-device-search` belongs to the existing Capability
`chat-device-search`. `chat-mobile-device-search-native-e2e` uses
`chat-mobile-search-simulator`, a business-owned composition of the existing
Mobile Direct actor/reset owner and selected native-client provisioner.

All changed Feature, Capability, Registry, Gate, concrete environment,
provisioner, Journey and Mobile diagnostics files are business injection.
Acceptance Core, runner, Evidence Store and generic schemas remain unchanged.

One Suite provisions, authenticates and binds iOS Alice and Android Bob once.
Both actors then receive messages from the other existing client. Scenarios
attach to the same source commit and Fixture epoch. They use production
Messaging actions for setup and real Search UI for query/open. Diagnostics
support cost and denial assertions; they do not replace UI evidence.
Fixture preparation waits for the original Social/Messaging write-admission
projection and each receiver's exact committed message before issuing the next
send. Recovery remains bounded by the existing Journey timeout; no denied write
is retried, and all 105 historical messages require real receiver commitment.
Failed runs preserve native screenshots, DOM and measured geometry before
classifying layout failure. Mutation failures also record the existing public
Recovery projection's typed write-admission reason and the fixture send ordinal;
they must not be hidden by retries or admission bypasses.

Post-login WebView restart must restore the exact persisted Station route before
Search can activate. Both route restore and refresh return the native
`StationRouteRefreshProjection` containing `binding` and the verified `route`
from the same discovery. Station runtime retains its authority, generation,
revision, pinned root and node checks. A bare binding cannot satisfy bootstrap;
the bilateral authentication step must reject that return-contract regression.

Resources: active reviewed `three` Profile, disposable same-Station fixture,
fresh iOS Simulator, isolated Android Emulator, dynamic Appium/client ports,
source-attested native builds and namespaced runtime storage. The existing
owners acquire leases, verify reset authority, and release owned sessions,
applications, devices, ports, storage and leases in reverse order.

Physical hardware, OEM scheduling, assistive-technology traversal, Applet
contributors, Station Search, Ask and cross-Station transport are outside this
proof. Shared Search changes additionally require the current-source Desktop
device Search regression.
