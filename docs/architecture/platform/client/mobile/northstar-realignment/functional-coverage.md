# Functional-Point Coverage Contract

> Maps every functional point shown by the mobile prototype to its **real**
> owner in `apps/mobile`, a disposition, and its primary acceptance evidence.
> Source for the prototype inventory: `packages/prototypes/mobile/chat`
> (screens/state/model/accessGate/CallScreen). Source for real owners:
> `apps/mobile/src/**` + `src-tauri`. Dispositions:
> **REAL-RESTYLE** · **CONFIRMED-DESIGN-ALIGN** · **CONFLICT-REAL-WINS** · **REAL-GAP-PRESENT** ·
> **PROTOTYPE-FAKE-REMOVE** · **NOT-THIS-PASS**.
>
> This is a surface-level ledger; Slice task files carry point-level gates.
> CONFIRMED-DESIGN-ALIGN preserves real capability while changing presentation
> to the user-confirmed design. CONFLICT-REAL-WINS applies to runtime capability,
> not the shell tab count (ADR-4, corrected 2026-11-13).

> **Real owner (verified)** column: rows marked with an explicit file/command
> are source-confirmed. Rows whose owner still needs source confirmation are
> marked **OPEN** in the disposition and are never counted as "verified"; they
> are resolved in their slice before the surface can close.

## Legend of real owners (evidence)

- Runtime graph: `runtimes/runtimeRegistry.ts`, including session-dependent contact preferences.
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
| **Shell**: 3 bottom destinations (messages/moments/me), badge, pushed-page chrome | `components/MobileShell.tsx`, `app/navigation/*` — three bottom tabs, Chats/Contacts top scopes, detail stack, native back | CONFIRMED-DESIGN-ALIGN implemented; native current-source navigation proof pending | layout-a11y, whole-product `shell` |
| **Launch / station select / discover / identity verify / offline** | `features/station/*`, `runtimes/stationRuntime`, Rust `station_*` | REAL-RESTYLE | access-e2e, station-lifecycle |
| **Add station single URL / private link / validation** | `StationSelector.tsx`, `stationRegistry`, real discover/verify | REAL-RESTYLE (keep real validation, drop prototype fake "always online") | access-e2e, station-lifecycle |
| **Scan-to-link** | `services/deviceLink.ts`, `deviceLinkRuntime`, native QR plugin | REAL-RESTYLE | access/device-link journey |
| **Access gate** email+password | `features/auth/AccessGateHost`, `authRuntime/session`, Rust `access_*` | REAL-RESTYLE | access-e2e |
| Access gate OAuth + phase recovery | Rust `OAuthCoordinator`, `runtime/oauth`, native broker | REAL-RESTYLE (replace prototype timer with real phase events) | access-e2e |
| Access gate invite / terms / schema / device-trust / blocked/failed/pending / session-expired | proto-driven gate renderer + `access_*` decision | REAL-RESTYLE | access-e2e + entry fixtures |
| Remembered email | `authStore`/secure storage backed | REAL-RESTYLE | access-e2e |
| **Chat rail**: list, unread, pin, mute, presence, inline search morph | messaging projection + socialStore badge; `searchRuntime` for search | REAL-RESTYLE | chat-contacts, whole-product `chat` |
| Messages top subtabs: chats / contacts | real chat and contacts surfaces and their runtime owners | CONFIRMED-DESIGN-ALIGN: host both under messages, retain scope on detail return and tab changes; preserve requests/groups/search/badges | contacts surfaces, whole-product `shell` |
| "+" new contact / new group | social friend-request + MLS group creation commands | REAL-RESTYLE | chat-contacts |
| **Thread**: send text, history, sender names, system msgs | messaging engine + projection, read cursor | REAL-RESTYLE | chat-contacts |
| Framed composer (emoji/file/voice/expand/send) | `ChatPage` + render-only `chat/MobileChatComposer`, peers-ui `FieldFrame appearance=composer` + auto-growing embedded TextArea | CONFIRMED-DESIGN-ALIGN implementation batch; single frame, comfortable tools, 1–4 / 4–10 rows, existing command/draft owners; current-source verification pending | chat-contacts |
| Attachments images / multi / camera | native media picker + encrypted attachment upload (`transport.rs`) | REAL-RESTYLE (prototype FileReader-only; real upload wins) | chat-contacts |
| Voice record/preview/discard/send + bubble playback | `useMobileChatVoiceRecorder`, `messaging_*` voice path | REAL-RESTYLE; verify real recording on simulator | chat-contacts |
| Emoji palette + recent | peers-ui EmojiPicker palette + ChatPage Station/actor secure-storage preference | REAL-RESTYLE implementation batch; persistence and account-boundary proof pending | chat fixtures/functional |
| Reply / quote | messaging reply commands + projection | REAL-RESTYLE | chat-contacts |
| Edit / recall (mutation window) | message command state + Rust command ledger | REAL-RESTYLE | chat-contacts |
| Forward (single/multi) | forward command | REAL-RESTYLE | chat-contacts |
| Multiselect bulk actions | ChatPage selection + dispatchForwardMessage/dispatchHideMessageForMe | REAL-RESTYLE implementation batch; sequential per-message acknowledgement, failed remainder retained; receiver/readback proof pending | chat-contacts |
| Pin message + pin banner | pin command + projection | REAL-RESTYLE | chat-contacts |
| Mark-later (local bookmark) | No chat-message bookmark owner (verified: `mobileCommands.ts` defines no bookmark kind; `is_bookmarked` exists only on social posts in `post_pb.ts`) | PROTOTYPE-FAKE-REMOVE: prototype `message/markLater` local state and bookmark chip deleted | chat fixtures |
| Copy | clipboard (native/web) | REAL-RESTYLE | chat functional |
| Report | No member-facing report command (verified: only the on-device flag in `messageFlagState` and the role-gated `dispatchModerateMessage`; neither is a user report) | PROTOTYPE-FAKE-REMOVE: report sheet and reason list deleted; the local flag remains the real on-device surface | chat-contracts |
| Hide for me | `chatCommands.ts:86 dispatchHideMessageForMe` (`hideForActor`), wired in `MessageActionSheet` as delete-for-me behind a destructive confirm | REAL-RESTYLE (shipped) | chat-contracts |
| Reactions (quick 8 / all 16 grid) | `components/reactions/*` + private/public reaction channels | REAL-RESTYLE (align 8×2 grid grammar) | moments/chat reaction convergence |
| Long-press sheet + vibration | Touch action sheet is real; no haptics bridge exists (verified: no haptic/vibrate symbol in `apps/mobile`) | REAL-RESTYLE for the sheet; vibration REAL-GAP-PRESENT only when a native bridge lands | chat functional |
| Unsent media draft restoration after route teardown/restart | Messaging SQLCipher `AttachmentSourceStageRecord` with conversation ownership, verified native preview grants, and exact-scope ChatDraftPayload | REAL-GAP-PRESENT implementation batch: native completed sources survive restart; list closes completion→envelope crash gap, transfer refs recover adoption→envelope crash gap; receiver/restart native proof pending | chat-contacts + draft-restart |
| Typing indicator | `typingDispatch` + real typing events | REAL-RESTYLE (replace prototype always-on bubble with real signal) | chat-contracts |
| Thread/topic replies | `ChatPage.tsx openMessageThread` and the thread action in `MessageActionSheet` over the real route-based thread surface | REAL-RESTYLE (shipped); prototype local-only thread state deleted | chat-contracts |
| @mentions | No chat mention owner (verified: `mentions` appears only in private-moment payloads in `mobileCommands.ts`, never in chat commands) | NOT-THIS-PASS: no chat mention surface this release | — |
| **Calls**: outgoing, mute, camera, hang-up, timer, trust state | `features/call/callState` (WebRTC + signalling), `MobileCallSurface`, shared media reservation | REAL-RESTYLE implementation; real bilateral media and current-source native proof required | platform/call journey |
| **Group calls**: invitation, audio/video, native controls, leave, restart, permission withdrawal | Station `groupcall`, original Session/Actor Device/Conversation fences, shared `client-chat-core/group-call`, Mobile `groupCallRuntime` and `MobileGroupCallSurface` | REAL-GAP-PRESENT implementation batch; grant/SID/replay regression and source checks exist; SFU deployment, real native RTP and remaining reconnect/restart negatives are unproven | original `chat-lifecycle-group-live-e2e`, mixed-native |
| Incoming call (accept/decline) | `MobileCallSurface.tsx:42-110` already renders incoming/ringing accept/decline; real `call-signal` over SSE; mounted in `MobileShell.tsx:453` (prototype is outgoing-only) | REAL-RESTYLE | call journey |
| **Contacts**: detail, add, note/role | social contacts gateway + friend-request reliable channel | REAL-RESTYLE | chat-contacts, contacts surfaces |
| Contact local nickname/note | `contactPreferencesRuntime` through `mobilePersonalizationScope` and actor `config.preference`; shared `ContactRemarkForm` | REAL-GAP-PRESENT implementation batch: scoped persistence/readback, Chat/Contacts names and local search; current-source native proof pending | contacts.remark + actor boundary |
| Friend requests (incoming/outgoing/accept/decline/federated) | `ContactsPage.tsx:118-185` inbound/outbound sections + decision fence; `social_friend_request_*` + reliability | REAL-RESTYLE (already built; prototype omitted) | social-convergence |
| Block contact | `ContactsPage.tsx:392-407` block/unblock confirm; Rust block commands | REAL-RESTYLE (prototype button was dead; real UI exists) | social/settings |
| Per-contact notify / mute / read-receipt switches | Social Gateway conversation-member settings (`isMuted`, `alertEnabled`); Contacts detail submits existing L1 partial updates with account-fenced readback | notify/mute REAL-RESTYLE implementation batch; persistence/native proof pending. No read-receipt switch owner exists | contacts contracts |
| **Groups**: create, detail, members | MLS group commands (genesis, membership transition) | REAL-RESTYLE | chat-contacts |
| Group admin (rename/remove/leave/dissolve/transfer/add members) | `ChatOverlayHost.tsx:749-900` real authority-gated UI over MLS membership commands | REAL-RESTYLE (already built; prototype dead controls removed) | chat-contacts |
| **Moments**: feed, 8 audiences, publish, image 9-grid | `momentsFeedStore`, moments gateway, composer | REAL-RESTYLE; real network wins | moments-e2e |
| Moments reactions (multi) | public + private reaction channels | REAL-RESTYLE | moments/social convergence |
| Inline comments / drafts / collapse | comments secure/public channels, `useMomentsDraft` | REAL-RESTYLE | moments-e2e |
| Circles create/manage/delete/members | circles commands + pages | REAL-RESTYLE; real route-based nav wins (CONFLICT on nav form) | moments-e2e |
| Federated / remote moments ("来自 xx 站") | social federation projection | REAL-RESTYLE | social-convergence |
| Private (E2EE) moments | `privateMomentsRuntime`, Rust `secure_content`, `social_private_*` | REAL-RESTYLE (prototype public-only; real private is additive) | moments-e2e |
| Sort latest/hot; back-to-top; inline search | feed projection + search | REAL-RESTYLE | moments surfaces |
| Author profile page | `SocialProfilePage` routed at `detail:social-profile` (navigationDescriptors.ts:117); feed author entry is wired end-to-end: `MomentFeedItem` author button (`data-acceptance-id="social-moment-author"`) → `MomentsPage.onOpenProfile` → `MobileShell.tsx:177` opens the detail route | REAL-RESTYLE (shipped) | moments/contacts |
| Delete own moment | crud command | REAL-RESTYLE | moments-e2e |
| **Me/profile**: cover/avatar change | `profileGateway` + avatar asset runtime | REAL-RESTYLE (real upload wins over prototype dataURL) | settings/social |
| Credentials / PTID detail | `AccountCredentialsSection` receives real username, Actor PTID and Station name; existing clipboard owner handles copying | REAL-RESTYLE implementation batch; current-source native copy and return proof pending | settings-e2e |
| Safety number / chat background | intentionally unavailable this release; no owner (`SettingsPage.tsx:489-496`, parent design §12.7) | NOT-THIS-PASS (keep unavailable; do not fabricate) | — |
| Preferences (notify/sound/auto-lock) | `deviceSettingsRuntime`, profile notification preference gateway, storage retention; no auto-lock owner (verified: no auto-lock symbol in `apps/mobile/src`) | REAL-RESTYLE for the real preferences; auto-lock PROTOTYPE-FAKE-REMOVE (no owner) | settings-e2e |
| Language | `languageRuntime` (en/zh-CN) | REAL-RESTYLE | layout-a11y bilingual |
| About / version | real app metadata | REAL-RESTYLE | settings surfaces |
| Sign out | lifecycle `transitionScope` fence/teardown | REAL-RESTYLE | lifecycle-e2e |
| **Settings/station**: station list/switch/add | station registry + transport | REAL-RESTYLE | settings/station-lifecycle (2 stations) |
| **Global notifications center** | `MobileShell` mounts `MobileNotificationCenter` at `overlay:notifications`; existing gateway/store/push remain owners | REAL-GAP-PRESENT implementation batch; real read/delete/navigation and current-source native proof pending | social/notifications journey |
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
