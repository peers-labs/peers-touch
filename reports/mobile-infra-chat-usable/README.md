# Mobile Infra/Chat Usability Evidence

## Verdict

The bounded Mobile Infra/Chat continuation scope is usable on the exact tested
source. Formal Acceptance proves same-Station iOS Direct and Group messaging,
macOS Desktop/iOS convergence, multi-device Session-class behavior, and Mobile
Station lifecycle behavior.

This is not a general Mobile release claim. The non-claims below remain
explicit.

## Source Identity

| Identity | Value |
|---|---|
| Plan | `mobile-infra-chat-usability-20261006-v35` |
| Plan checkpoint | `cf8be18a2e568539096817154f166fa7dd538f0d` |
| Evidence commit | `f9dd38b6ceddca825945212a717583d274361955` |
| Contract repair commit | `36e70f0f9b50b85d3e0e0d3048a1cb682446da16` |
| Evidence workspace digest | `clean` |
| Workspace ID | `293b40f94701d443` |
| Branch | `feat/mobile-infra-chat-usable` |
| Worktree | `/Users/bytedance/Documents/Projects/peers-touch/peers-touch-mobile-usable` |
| Runtime evidence work item | `MICU-03-V33-20261007` |
| Final review work item | `MICU-04-V35-20261007` |

The contract repair changes only this report and stale Chat contract
assertions. Product Gap artifacts remain bound to the exact runtime-evidence
commit. Final source structure, quality, Completion Review, and close audits
bind the report commit through the machine-local pointers under
[Final Audit Pointers](#final-audit-pointers).

## Runtime Identity

### Station

| Role | Deployment | Endpoint | Peer ID | Source |
|---|---|---|---|---|
| Primary | `chat-native-disposable-station` | `http://10.37.94.156:18132` | `12D3KooWNAp9A8wX5GHCCjhQT8msV25tUewehyr4cFktpwqHnYjA` | `f9dd38b6` / clean |
| Secondary | `chat-native-four` | `http://10.37.245.247:18132` | `12D3KooWGbjzdMwmdtq5YieHxHdA7j5LpepGYmjGcLVWGrWcWKKW` | `f9dd38b6` / clean |

Both Station attestations use protocol digest
`4ecf2427dd1ccffb4cbd10e410cb44f50b7decddb077bae9cb96dda505d27789`.

### Mobile And Appium

| Client | Device | UDID | Runtime | Actor |
|---|---|---|---|---|
| `sim-ios` | iPhone 17 | `BE69F890-2530-4888-9E3C-670308C99EB5` | iOS 26.5 | Alice |
| `sim-ios-peer` | iPhone 17 Pro Max | `1D01FBB4-23A9-4450-8AF9-DBA30C551411` | iOS 26.5 | Bob |

- Bundle: `com.peers.touch.mobile`
- Dual-iOS app SHA-256:
  `c056aeaa87f66363e17cf206cb003f3fc9852a5662e97194a97446de7f4e74d3`
- Mixed-client app SHA-256:
  `819563597bf5bf76311600b68bd61bd184b1663f08289087cb2f76e3620acd58`
- Appium: `2.19.0`
- Driver: `appium-xcuitest-driver` / XCUITest `9.10.5`

### Desktop

The mixed-client Gates used source-bound native macOS Tauri clients
`desktop-alice` and `desktop-bob` with the shared Native Desktop WebDriver.
Their ephemeral profiles, ports, storage roots, Station bindings, and cleanup
are recorded in the mixed-client runtime manifests linked by the Gate matrix.

### Accounts

| Actor | Canonical PTID |
|---|---|
| Alice | `ptid:v1:actor:peers:p:alice:12203e0f255f835ecd0abd93aa0ea6f11bcd7580bcb1e7fcc0977567f44493fb62f7` |
| Bob | `ptid:v1:actor:peers:p:bob:1220d013164db46550eee1cdbcee6e1db216904d76ebaa15a3cf4a5e1e16e675ff8d` |

The formal actor manifests are authoritative for all additional mixed-client
actors and client-to-Station bindings.

## Journey And Gate Matrix

| Journey | Gate | Result | Duration | Run |
|---|---|---|---:|---|
| MICU-J02 | `mobile-simulator-chat-contacts-e2e` | PASS / PROVEN / DONE | 156.652 s | `20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8` |
| MICU-J02 | `chat-lifecycle-mixed-client-same-station-e2e` | PASS / PROVEN / DONE | 401.636 s | `20261006T193714061619Z-abced611e03ab54df4cfcb9690c805ea` |
| MICU-J03 | `chat-native-multi-device-e2e` | PASS / PROVEN / DONE | 140.900 s | `20261006T190039051530Z-610afe0b04e6a67eb02d6a7bc4bae9c3` |
| MICU-J03 | `chat-lifecycle-mixed-client-multi-device-e2e` | PASS / PROVEN / DONE | 157.126 s | `20261006T190300091353Z-91fc36beaff8563271ac7da49ab2fbfc` |
| MICU-J03 | `mobile-simulator-station-lifecycle-e2e` | PASS / PROVEN / DONE | 91.647 s | `20261006T190537444070Z-8c121ce871d2fe3f43aabf791d6391ca` |
| MICU-J03 | `station-access-session-class-e2e` | PASS / PROVEN / DONE | 0.541 s | `20261006T190709169995Z-2c6c722a6e4622124a6f76c28c0b2a36` |
| MICU-J04 | Final report structural checks | PASS | 4/4 | Source-only |

- [MICU-02 formal aggregate](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/acceptance-run/20261006T193437111354Z-e4c616161ad377e92ee70abf0be48292/manifest.json):
  2/2 passed, no blocked, failed, incomplete, or unproven Gate.
- [MICU-03 formal aggregate](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/acceptance-run/20261006T190038910609Z-a32cc677473d8c30e70d795ca078d6ec/manifest.json):
  4/4 passed, no blocked, failed, incomplete, or unproven Gate.
MICU-J04 contract-repair focused checks:

- `mobile-contract-static`: PASS, run
  `20261006T200954577044Z-a672b94cc7390ae9e48e98dbf8009d77`.
- `station-messaging-unit`: PASS, run
  `20261006T201126748453Z-b41915d63aaa7403e5afb96a154594c0`.
- `messaging-platform-contract`: PASS, run
  `20261006T201136611088Z-b125f36782282051f71286d4c1d5b4a1`.
- `architecture-module-governance`: PASS.

The final report-only successor reruns the same four checks after its report
wording is committed. Those source-bound results are consumed by the final
Session and Completion Review rather than copied back into this self-referential
report.

## Dual-iOS Visible And Appium Evidence

Both screenshots visibly show an authenticated Chat list with Direct and Group
rows. Authentication identity is also bound independently by the actor
manifest and Gate result; no Desktop screenshot substitutes for Mobile proof.

| Evidence | `sim-ios` | `sim-ios-peer` |
|---|---|---|
| Authenticated Chat screenshot | [PNG](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator-social/chat-contacts/sim-ios/screenshot.png) | [PNG](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator-social/chat-contacts/sim-ios-peer/screenshot.png) |
| Visible Web DOM | [HTML](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator-social/chat-contacts/sim-ios/web-dom.html) | [HTML](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator-social/chat-contacts/sim-ios-peer/web-dom.html) |
| Native accessibility source | [XML](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator/sim-ios/preflight/native-ax.xml) | [XML](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator/sim-ios-peer/preflight/native-ax.xml) |
| Appium WebView source | [HTML](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator/sim-ios/preflight/webview-source.html) | [HTML](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator/sim-ios-peer/preflight/webview-source.html) |
| Preflight status | [JSON](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator/sim-ios/preflight/status.json) | [JSON](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator/sim-ios-peer/preflight/status.json) |

The [dual-iOS result](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator-social/chat-contacts/result.json)
records:

- Direct conversation `direct-7a5f916860af94c5447c4aca905ff72b`,
  message `01M49BE9H5T5RBT929PTYBQFT3`, delivered in 1169 ms.
- Group `mobile-group-d02a835304b8`, message
  `01M49BEGG3XBZPWZZP80T91SF1`, delivered in 1516 ms.
- Interaction, receipt, restart, and search readback all passed for both paths.

## Cleanup And Retention

- Both iOS product harnesses and both Appium sessions passed Gate cleanup.
- Simulator app installations, ports, storage, actor fixtures, profile leases,
  and deployment leases passed provisioner cleanup.
- Native Desktop processes, ports, storage, and WebDriver resources passed
  mixed-client Gate cleanup.
- Both iOS Simulators are shut down and the Gate-owned Appium port is released.
- Source-attested Stations remain deployed intentionally under the Local Dev
  owner for reuse; they are not leaked Gate-owned resources.
- [Dual-iOS cleanup](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/mobile-simulator/cleanup.json)
- [Provisioner cleanup](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/mobile-simulator-chat-contacts-e2e/20261006T193437275611Z-e180990a7ac3ecf850a4d02a835304b8/reports/provisioner-cleanup.json)

## Final Audit Pointers

Product Gap reports remain attached to the exact source that executed the
native Journeys:

- [MICU-02 Gap report](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/acceptance-gap-detect/20261006T194650298649Z-536c8bc996feaee62e0df1d0ebba44a9/reports/gap-report.json)
- [MICU-03 Gap report](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/acceptance-gap-detect/20261006T190847209438Z-3e715b98bd35f6a2e93386ca03bf8230/reports/gap-report.json)

These stable pointers are updated by the final source-only close sequence:

- [Quality evidence latest](file:///Users/bytedance/Library/Application%20Support/PeersTouch/acceptance/293b40f94701d443/quality-evidence/latest.json)
- Completion Review and close-ready Completion Audit are owned by the
  Development Workflow receipt for `MICU-04-V35-20261007`.

## Repository-Wide Residual Evidence

The final review also ran the deterministic Acceptance profile selected by the
two-file contract-repair range. Three failures are outside that range and do
not invalidate the bounded Mobile runtime claim:

- `chat-lifecycle-tree-zero-reference-e2e`: the scanner still reads
  `docs/architecture/chat-lifecycle/legacy-inventory.json`; the current
  inventory lives under `docs/architecture/domains/chat/lifecycle/`.
- `acceptance-runtime-provisioning-self`: its coverage-report digest test uses
  `docs/architecture/acceptance-framework/coverage-report.md`, while the
  attestation ignore list still names the retired
  `docs/architecture/engineering/acceptance/coverage-report.md`.
- `acceptance-workflow-contract`: 218 of 219 Node tests passed; one fixture
  cleanup returned `ENOTEMPTY` for its temporary Plan repository.

The source-bound MICU-04 checks and architecture governance pass. These
repository-wide observations are not relabeled as product failures, and this
report does not claim they are fixed.

## Explicit Non-Claims

This report does not claim:

- Agent or Moments readiness.
- Cross-Station or Relay-backed Mobile Chat readiness.
- Android behavior.
- Physical iOS or Android device behavior.
- Live third-party or physical-browser OAuth behavior.
- Physical Keychain or AndroidKeyStore characteristics.
- VoiceOver or TalkBack traversal.
- OEM scheduler, picker, or pinned-hardware performance.
- Linux or Windows Desktop behavior.
- Group live-call behavior.
