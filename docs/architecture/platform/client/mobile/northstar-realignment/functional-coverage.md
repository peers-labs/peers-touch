# Functional-Point Coverage Contract

> Maps every functional point shown by the mobile prototype to its **real**
> owner in `apps/mobile`, a disposition, and its primary acceptance evidence.
> Source for the prototype inventory: `packages/prototypes/mobile/chat`
> (screens/state/model/accessGate/CallScreen). Source for real owners:
> `apps/mobile/src/**` + `src-tauri`. Dispositions:
> **REAL-RESTYLE** · **CONFLICT-REAL-WINS** · **REAL-GAP-PRESENT** ·
> **PROTOTYPE-FAKE-REMOVE** · **NOT-THIS-PASS**.
>
> This is a surface-level ledger; Slice task files carry point-level gates.

> **Real owner (verified)** column: rows marked with an explicit file/command
> are source-confirmed. Rows whose owner still needs source confirmation are
> marked **OPEN** in the disposition and are never counted as "verified"; they
> are resolved in their slice before the surface can close.

## Legend of real owners (evidence)

- Runtime graph: `runtimes/runtimeRegistry.ts` (17 descriptors).
- Messaging: `features/chat/*`, `services/mobileCommands.ts`, Rust
  `messaging/{engine,transport,commands}.rs` (`messaging_*`).
- Social/Moments: `features/social/*`, `services/gateways/*`, Rust
  `social/adapter.rs`, `secure_content/*`.
- Access/OAuth/device link: `features/auth/*`, `features/station/*`, Rust
  `runtime/oauth`, `device_link`.
- Acceptance: `acceptance/{actions,contracts}.ts` action ids; gate ids in
  `tooling/acceptance/gates.yaml`.

## Coverage matrix

| Prototype surface / point | Real owner (verified) | Disposition | Primary gate (set) |
|---|---|---|---|
| **Shell**: 3 tabs, badge, pushed-page chrome | `components/MobileShell.tsx`, `app/navigation/*` — real 4 tabs chat/moments/contacts/settings, detail stack, native back | CONFLICT-REAL-WINS (prototype→4 tabs) | layout-a11y, whole-product `shell` |
| **Launch / station select / discover / identity verify / offline** | `features/station/*`, `runtimes/stationRuntime`, Rust `station_*` | REAL-RESTYLE | access-e2e, station-lifecycle |
| **Add station single URL / private link / validation** | `StationSelector.tsx`, `stationRegistry`, real discover/verify | REAL-RESTYLE (keep real validation, drop prototype fake "always online") | access-e2e, station-lifecycle |
| **Scan-to-link** | `services/deviceLink.ts`, `deviceLinkRuntime`, native QR plugin | REAL-RESTYLE | access/device-link journey |
| **Access gate** email+password | `features/auth/AccessGateHost`, `authRuntime/session`, Rust `access_*` | REAL-RESTYLE | access-e2e |
| Access gate OAuth + phase recovery | Rust `OAuthCoordinator`, `runtime/oauth`, native broker | REAL-RESTYLE (replace prototype timer with real phase events) | access-e2e |
| Access gate invite / terms / schema / device-trust / blocked/failed/pending / session-expired | proto-driven gate renderer + `access_*` decision | REAL-RESTYLE | access-e2e + entry fixtures |
| Remembered email | `authStore`/secure storage backed | REAL-RESTYLE | access-e2e |
| **Chat rail**: list, unread, pin, mute, presence, inline search morph | messaging projection + socialStore badge; `searchRuntime` for search | REAL-RESTYLE | chat-contacts, whole-product `chat` |
| Rail segmented contacts pane | real contacts tab/surface (4-tab product) | CONFLICT-REAL-WINS (use real contacts tab) | contacts surfaces |
| "+" new contact / new group | social friend-request + MLS group creation commands | REAL-RESTYLE | chat-contacts |
| **Thread**: send text, history, sender names, system msgs | messaging engine + projection, read cursor | REAL-RESTYLE | chat-contacts |
| Framed composer (emoji/file/voice/expand/send) | `ChatPageContent`, `chatCommands`, `useMobileChatVoiceRecorder`, `media_pick` | REAL-RESTYLE to the one-frame anatomy; **premise**: that anatomy is a current prototype revision still pending its owner acceptance gate, so it is an input to confirm (or adapt to the real owner) in Slice 1, not pre-frozen | chat-contacts |
| Attachments images / multi / camera | native media picker + encrypted attachment upload (`transport.rs`) | REAL-RESTYLE (prototype FileReader-only; real upload wins) | chat-contacts |
| Voice record/preview/discard/send + bubble playback | `useMobileChatVoiceRecorder`, `messaging_*` voice path | REAL-RESTYLE; verify real recording on simulator | chat-contacts |
| Emoji palette + recent | composer emoji (shared palette); verify persistence seam | REAL-RESTYLE | chat fixtures/functional |
| Reply / quote | messaging reply commands + projection | REAL-RESTYLE | chat-contacts |
| Edit / recall (mutation window) | message command state + Rust command ledger | REAL-RESTYLE | chat-contacts |
| Forward (single/multi) | forward command | REAL-RESTYLE | chat-contacts |
| Multiselect bulk actions | message multi-select state | REAL-RESTYLE | chat-contacts |
| Pin message + pin banner | pin command + projection | REAL-RESTYLE | chat-contacts |
| Mark-later (local bookmark) | OPEN: confirm a local-flag owner exists | OPEN → REAL-RESTYLE or PROTOTYPE-FAKE-REMOVE | chat fixtures |
| Copy | clipboard (native/web) | REAL-RESTYLE | chat functional |
| Report | OPEN: confirm a moderation/report command owner | OPEN → REAL-RESTYLE, else PROTOTYPE-FAKE-REMOVE (no fake toast) | chat-contracts |
| Hide for me | OPEN: confirm a real hide/visibility command owner | OPEN → REAL-RESTYLE or PROTOTYPE-FAKE-REMOVE | chat-contracts |
| Reactions (quick 8 / all 16 grid) | `components/reactions/*` + private/public reaction channels | REAL-RESTYLE (align 8×2 grid grammar) | moments/chat reaction convergence |
| Long-press sheet + vibration | touch action sheet; haptics via platform if available | REAL-RESTYLE; OPEN: haptics REAL-GAP if no bridge | chat functional |
| Typing indicator | `typingDispatch` + real typing events | REAL-RESTYLE (replace prototype always-on bubble with real signal) | chat-contracts |
| Thread/topic replies | OPEN: confirm thread command owner; prototype local-only version is fake | OPEN → REAL-RESTYLE or PROTOTYPE-FAKE-REMOVE | chat-contracts |
| @mentions | **prototype has none**; real mobile mention support OPEN to confirm | OPEN → NOT-THIS-PASS unless real owner present | — |
| **Calls**: outgoing, auto-connect, mute, camera, hang-up, timer, E2EE | `features/call/callState` (WebRTC + signalling), `MobileCallSurface` | REAL-RESTYLE; signalling real, media on-device | platform/call journey (media NOT-THIS-PASS matrix) |
| Incoming call (accept/decline) | `MobileCallSurface.tsx:42-110` already renders incoming/ringing accept/decline; real `call-signal` over SSE; mounted in `MobileShell.tsx:453` (prototype is outgoing-only) | REAL-RESTYLE | call journey |
| **Contacts**: detail, add, note/role | social contacts gateway + friend-request reliable channel | REAL-RESTYLE | chat-contacts, contacts surfaces |
| Friend requests (incoming/outgoing/accept/decline/federated) | `ContactsPage.tsx:118-185` inbound/outbound sections + decision fence; `social_friend_request_*` + reliability | REAL-RESTYLE (already built; prototype omitted) | social-convergence |
| Block contact | `ContactsPage.tsx:392-407` block/unblock confirm; Rust block commands | REAL-RESTYLE (prototype button was dead; real UI exists) | social/settings |
| Per-contact notify / read-receipt switches | real per-conversation settings if present, else remove fake | OPEN → confirm owner then REAL-RESTYLE or PROTOTYPE-FAKE-REMOVE | contacts contracts |
| **Groups**: create, detail, members | MLS group commands (genesis, membership transition) | REAL-RESTYLE | chat-contacts |
| Group admin (rename/remove/leave/dissolve/transfer/add members) | `ChatOverlayHost.tsx:749-900` real authority-gated UI over MLS membership commands | REAL-RESTYLE (already built; prototype dead controls removed) | chat-contacts |
| **Moments**: feed, 8 audiences, publish, image 9-grid | `momentsFeedStore`, moments gateway, composer | REAL-RESTYLE; real network wins | moments-e2e |
| Moments reactions (multi) | public + private reaction channels | REAL-RESTYLE | moments/social convergence |
| Inline comments / drafts / collapse | comments secure/public channels, `useMomentsDraft` | REAL-RESTYLE | moments-e2e |
| Circles create/manage/delete/members | circles commands + pages | REAL-RESTYLE; real route-based nav wins (CONFLICT on nav form) | moments-e2e |
| Federated / remote moments ("来自 xx 站") | social federation projection | REAL-RESTYLE | social-convergence |
| Private (E2EE) moments | `privateMomentsRuntime`, Rust `secure_content`, `social_private_*` | REAL-RESTYLE (prototype public-only; real private is additive) | moments-e2e |
| Sort latest/hot; back-to-top; inline search | feed projection + search | REAL-RESTYLE | moments surfaces |
| Author profile page | `SocialProfilePage` exists and is routed | REAL-RESTYLE; wire feed author entry to the real route if unreachable (OPEN: confirm feed entry point) | moments/contacts |
| Delete own moment | crud command | REAL-RESTYLE | moments-e2e |
| **Me/profile**: cover/avatar change | `profileGateway` + avatar asset runtime | REAL-RESTYLE (real upload wins over prototype dataURL) | settings/social |
| Credentials / PTID detail | OPEN: confirm identity/credential owner; build a real detail only over that owner | OPEN → REAL-GAP-PRESENT (thin placeholder today) | settings-e2e |
| Safety number / chat background | intentionally unavailable this release; no owner (`SettingsPage.tsx:489-496`, parent design §12.7) | NOT-THIS-PASS (keep unavailable; do not fabricate) | — |
| Preferences (notify/sound/read-receipt/auto-lock) | `deviceSettingsRuntime`, notification prefs, storage retention | REAL-RESTYLE; OPEN: auto-lock stays fake-removed unless a real lock owner exists | settings-e2e |
| Language | `languageRuntime` (en/zh-CN) | REAL-RESTYLE | layout-a11y bilingual |
| About / version | real app metadata | REAL-RESTYLE | settings surfaces |
| Sign out | lifecycle `transitionScope` fence/teardown | REAL-RESTYLE | lifecycle-e2e |
| **Settings/station**: station list/switch/add | station registry + transport | REAL-RESTYLE | settings/station-lifecycle (2 stations) |
| **Global notifications center** | gateway/store/push real; `MobileNotificationCenter` exists but is unmounted | REAL-GAP-PRESENT (mount over real owner) | social/notifications journey |
| Push / deep-link / foreground-background | `mobileNativeEventBridge`, Rust push/deep-link | REAL-RESTYLE/verify | platform-e2e |
| Recovery overlays (13) + draft restore | recovery projection + reliability ledger | REAL-RESTYLE (out of Slice 1) | recovery(-ui)-e2e |
| Pseudo status bar 9:41 / scenario harness | prototype-only test chrome | PROTOTYPE-FAKE-REMOVE from product (real OS draws status bar) | — |

## Acceptance gate mapping (iOS Simulator)

- Station-free: `mobile-native-build`, `mobile-simulator-access-e2e`,
  `mobile-simulator-runtime-lifecycle-e2e`, `mobile-simulator-platform-e2e`,
  `mobile-ios-simulator-layout-accessibility-e2e`.
- One Station (`mobile-direct-simulator`): `chat-contacts`, `social-convergence`,
  `moments`, `recovery`, `recovery-ui`, `whole-product-usability`.
- Two Stations: `station-lifecycle`, `settings`.
- Surface fixture/static: vitest `acceptance/registry.test.ts`,
  and `tooling/acceptance/gates/mobile/whole_product_surface_inventory.json`
  sets `entry/shell/recovery/chat/contacts/moments/settings`.

Every confirmed `REAL-GAP-PRESENT` item gets a concrete acceptance action +
fixture surface + a functional gate in its slice; no gap is closed by static
markup. `OPEN` items are resolved to a disposition by source evidence before
their surface closes and are not counted as verified meanwhile.
