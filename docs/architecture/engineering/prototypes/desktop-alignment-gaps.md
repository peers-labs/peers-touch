# Desktop Prototype ↔ Platform Alignment Gap Register

> **Status**: active gap register. Owner: Architecture.
> **Created**: 2026-10-13.
> **Purpose**: the work list for a new project that aligns the new desktop
> prototypes with the Station/Desktop platform as actually shipped. Every
> prototype surface is classified against real capabilities so design work
> stops presenting mock interactions as live product.
>
> **Scope**: desktop prototypes under `packages/prototypes/desktop/`
> (shell Settings/chrome, social-chat, agent/modern-chat-agent,
> applet-workspace/applet-lifecycle, login) vs `apps/desktop`,
> `apps/desktop/src-tauri`, `apps/station`, `packages/{applets,applet-kernel,applet-contract,locales}`,
> and `model/domain`.
>
> Network-specific detail used to live in a federation-domain file; it is
> folded in here as **N1–N12** and that file now points here.

---

## 0. How to read this register

**Status**
- **LIVE** — Station/backend and a desktop path exist; the prototype only
  needs to bind to it (prototype is mock today).
- **CLIENT-GAP** — backend/API exists but there is no usable desktop surface
  (or the surface is narrower); needs Desktop/Tauri/UI work only.
- **BACKEND-GAP** — designed in docs/prototype but no Station/proto/backend;
  needs backend work first.
- **FICTION** — no capability anywhere and no accepted design; decide whether
  to build or cut before the prototype can be treated as a target.
- **CUT** — the real product deliberately removed it; the prototype must drop
  the control.

**Marker rule (enforced by the geometry gate):** any designed-but-unshipped
affordance in a prototype renders a visible **Pending backend** marker and is
read-only/disabled; fabricated operational numbers are forbidden without a
real endpoint. Evidence citations are file paths in this repository.

**Legend for owner**: USR = ordinary user Settings/surface; OPS = Station
Dashboard/operator; CLIENT = desktop client team; STATION = station backend
team.

---

## 1. Executive summary

The new prototypes are high-fidelity but **mock-only by construction**
(social-chat uses local `useChatState` with zero network calls; Settings and
applet/agent pages use component state or localStorage). The platform is,
however, unusually complete: an event-sourced MLS/E2E conversation backend,
social relationship services, ~400 Tauri commands, a real Lynx applet runtime,
a large Station agent subserver, and shipped AI provider/memory/skill/MCP/cron
configuration.

Consequently the dominant work is **binding prototypes to existing commands**,
not inventing backends. The genuinely missing backend is a short, named list:
per-federation visibility (N2), inbound request policy (N3), cross-station
catalog fan-out + serve switch (N4/N5), chat person @mentions (S11),
notification *preference editing* UI is a client gap while the API exists,
multi-instance applet tabs (A6), and a handful of fabricated settings
(statistics, dark mode, auto-lock, presence/receipt toggles, email/matrix
bridges, whole-data export).

Highest-leverage corrections:
1. Treat prototype `state.ts`/localStorage as throwaway adapters over real
   commands; bind send/receipts/friend-groups first.
2. Delete or mark CUT items that the product intentionally removed
   (statistics backend, email/matrix bridges, dark theme).
3. Do not prototype richer behavior than shipping clients without an explicit
   decision (global message search, multi-instance applets, 9-role council UI).
4. Fix two correctness defects discovered during audit (N7 non-sequencer
   leave; logout not calling `/actor/logout`).

---

## 2. Shell chrome, identity, login

| ID | Capability | Prototype today | Status | Gap / evidence |
|---|---|---|---|---|
| C1 | Profile display name / bio edit | local state, no save | LIVE | Bind debounced `profileUpdate` with revision conflict; real `AccountTab.tsx`, Station `POST /actor/profile`, fields `actors.name/summary`. |
| C2 | Avatar upload | static initials tile (no control) | LIVE | Native pick → OSS `/sub-oss/upload` → profile `icon` (`profile_upload_avatar_oss`). Prototype must add the control; storage is OSS, not localStorage. |
| C3 | Cover/banner upload + history | FileReader → localStorage only | CLIENT-GAP | Real cover uses OSS (`profile_upload_header_oss`, `actors.image`); a recent-backgrounds *history menu* has no backend — either cut the history or store server-side. |
| C4 | Region/timezone | closed 4-option selects, local | LIVE | Real free-text region + IANA timezone autocomplete; replace fabricated option lists. |
| C5 | Profile tags / links | absent | LIVE (omitted) | Add tag multi-select + label/URL links (`actor.proto` fields, `AccountTab.tsx`). |
| C6 | PTID / federated handle / home station | hardcoded constants, duplicated in Account + Your Station | LIVE | Read from `/actor/profile` (`network_id`, `federated_handle`, `home_station_domain/peer_id`); show handle in one canonical place, do not duplicate `home_station_peer_id`. |
| C7 | Notification **list/center** (search, pagination, inline accept/decline) | richer than shipped bell | CLIENT-GAP | Station serves notifications + unread counts; desktop `NotificationBell` is a simple popover. The prototype's search/paginated viewer is the target; bind to real list/mark-read/decision endpoints, add missing category mapping. |
| C8 | Notification **preferences** | 5 fine-grained toggles + master/sound, local-only | CLIENT-GAP | Station `GET/POST /notification/preferences` exists (revision-based, per **category** enabled/push/sound; table `notification_preferences`) and desktop API is wired but has **no UI**. Map rows to the real category model (Social/Chat/System/Task); the in-app master toggle has no backend (FICTION — cut or add). Also wire push device register/list. |
| C9 | Unread badge | derived from 10 mock items | LIVE | Bind `notification_unread_counts` (`total`+`byCategory`, 15s poll). |
| C10 | Privacy: PIN set/change/remove, lockout | toggles/no-op; Welcome PIN accepts anything | LIVE | Real 6-digit PIN, Argon2id/AES-GCM at-rest, 5-attempt/300s lockout, launch unlock; bind `accountSetPin/Unlock/RemovePin`. |
| C11 | Auto-lock after inactivity | select no-op | FICTION | No idle lock in TS/Rust. Decide build vs cut; mark Pending meanwhile. |
| C12 | Biometric unlock | absent | FICTION | No TouchID/biometric API exists. |
| C13 | Online status visible toggle | local toggle | FICTION | Presence is a runtime service with no user setting; cut the toggle. |
| C14 | Read receipts visible toggle | local toggle | FICTION | Receipts are unconditional; an opt-out needs backend product decision. |
| C15 | Blocked users list + unblock | 3 fake names, no-op | CLIENT-GAP | Block/unblock are real (`social_block_actor`, GET `/relationships/blocked`) and enforced as a messaging gate, but desktop has **no list fetch/UI**. Add surface. |
| C16 | Authorized devices in Your Station | mock This Mac/iPhone | CLIENT-GAP | Real `/device/enroll|list|revoke` + Tauri `device_list/revoke` exist (used by im-service); Settings should bind them. (Distinct from login sessions — see C18.) |
| C17 | Switch station = sign out | confirm closes itself | CLIENT-GAP | Binding machine + station registry exist; add one explicit action that calls `/actor/logout` (currently never called by desktop), unbinds/removes active station, and returns to station+account picker, keeping local messages. Correctness item. |
| C18 | Multi-account / active sessions | hardcoded account rows | LIVE (omitted) | Real local multi-identity registry (`accountList/GetActive/switch/list_restorable`), single-active Station session with takeover; present the interactive account picker, not a devices list. |
| C19 | Theme System/Light/Dark + message density | local, never applied | CUT/FICTION | Desktop ships a single light theme (no dark algorithm). Either schedule a theming project or remove the controls; density has no backend. |
| C20 | Language | offers en/zh/ja locally | LIVE (partial) | i18next runtime packs exist; only **en + zh-CN** ship. Remove 日本語 until a pack exists; bind `peers-touch-lang`. |
| C21 | OAuth login (GitHub/Google/WeChat) | 3 hardcoded buttons + spinner | LIVE | Real loopback OAuth (`oauth2StartLoopback`, cancel/poll), server-driven provider list, broker in `apps/oauth2-client` + station bridge; render providers from `oauth2ListProviders`. |
| C22 | Email/password login | prefilled fake creds | LIVE | Real `accessStart` + `accessSubmitLogin` gate flow; remove fake prefill. |
| C23 | Access gate (invite/device-trust/terms/blocked/maintenance) | entirely absent | LIVE (omitted) | Typed gate decisions + schema forms exist (`accessGate.ts`, Station `frame/touch/accessgate`); prototype login must show gate states. |
| C24 | Station picker | static status pill | LIVE (omitted) | Add/select/remove endpoints with live probe and active events (`StationPicker`, `station_*`). |
| C25 | PIN recovery + encrypted-message recovery | absent | LIVE (omitted) | Forgot-PIN re-auth/reset; 24-word chat backup/restore (`RecoverySettings`). Consider placement in prototype Privacy/Advanced. |

---

## 3. Social chat (DM, groups, contacts, calls)

Source prototype `features/social-chat` is 100% local state. Backend is an
event-sourced MLS/E2E system (`apps/station/app/subserver/{conversation,social,groupcall}`)
with a Tauri/Rust + TS client.

| ID | Capability | Prototype today | Status | Gap / evidence |
|---|---|---|---|---|
| S1 | Send/receive text (DM+group) | local append, always `sent` | LIVE | Bind submit + SSE projection (`messaging_send_message`, hash-chained facts, `listMessages/syncFromStation`). |
| S2 | Delivery/read receipts + retry | timer-flip statuses | LIVE | Read cursors, device-consumed receipts, outbox pending/failed + `messaging_retry_message`; order SENT<DELIVERED<READ. |
| S3 | Reactions | local map, resets on unmount | LIVE | Fact `reaction_committed`; submit metadata interaction kind=reaction; per-actor read model (`messageReactionState.ts`). |
| S4 | Reply/quote | banner shown but `replyTo` dropped on send | LIVE | Persist `reply_to_message_id` (target validated). |
| S5 | Threads | local thread panel | LIVE | `messaging_list_thread_messages/thread_counts`, thread root fact; bind. |
| S6 | Pinned messages | local Set + chip | LIVE | Pin fact + `pinnedMessages` projection; add pinned banner/list. |
| S7 | Edit | local mutation | LIVE | Author-only `messaging_submit_edit` (keep real time window). |
| S8 | Delete-for-me / retract | local sets + tombstone | LIVE | Distinct `hideForActor` (local) vs author `retract` (everyone). |
| S9 | Forward | picker shows toast, sends nothing | CLIENT-GAP | Backend `message_forwarded` fact exists but shipping client re-sends plaintext; decide forward-fact vs re-send and implement — prototype is currently weaker than client. |
| S10 | Typing indicator | fake 1.8s timer | LIVE | `messaging_submit_typing` pulses + federated fan-out; SSE `typingPeers` with stale sweep. |
| S11 | Person @mentions in chat | none | BACKEND-GAP | No mention field on conversation command (opaque MLS). Only private Moments have mention routing. Needs a new model if wanted. |
| S12 | Voice messages | mock chip, mic is a toast | LIVE | `voice_note` content + duration; real recorder/upload (`useChatVoiceRecorder`). |
| S13 | Attachments/files/images | blob URL only | LIVE | Chunked encrypted object upload, grants, availability states, native capture. |
| S14 | Friend request send/accept/decline | local status flips; FindPeople "Add" orphaned | LIVE | `/social/friend-request/*`, `socialFriendRequest*`; accept creates DM; bind and reload sessions. |
| S15 | Find people by handle vs directory | filters local contacts | LIVE (richer) | Real modal resolves `@user@host` (`federationResolve`) and searches directory (`federationCatalogSearch`) + `/social/users/search`. |
| S16 | Federated friend requests | mock booleans | LIVE | Cross-station delivery with receiver policy; carry home-station peer + federation id. |
| S17 | Block/unblock UI | absent in social UI | CLIENT-GAP | Backend + gate enforcement exist; add contextual block in detail/contacts (mirrors C15). |
| S18 | Create group + invitees | local; federated contacts hard-blocked | LIVE | Two-phase prepare/create with MLS welcome/key packages. |
| S19 | Member roles / authority | local role mutation | LIVE | Roles, `CanManageMembership`, authority facts, transfer owner; bind permission helper. |
| S20 | Invite/add/leave intents | local array ops | LIVE | Membership intent flow with federation fan-out. |
| S21 | Group settings/leave/dissolve | local | LIVE | Settings patch fact, `updateConversation`, leave/dissolve, member nickname/mute/pin/background. |
| S22 | Group-invite decision inbox | decision component exists, friend-only rendering | CLIENT-GAP | Membership proposals exist backend-side; add an invite-accept list (also surfaces in notifications). |
| S23 | Session list unread/pin/mute/last message | static mock | LIVE | Derive from read cursors + `groupUnreadCounts` + persisted member settings. |
| S24 | Hide/delete/clear + retention | local filter/clear | LIVE | Hide projection; `chat_storage_clear_conversation`, retention policy, batch clear. |
| S25 | Search messages | in-memory global search over mock | CLIENT-GAP | Real per-conversation SQLite FTS (`messaging_search_messages`); a **global** cross-conversation search has no API — scope down or build. |
| S26 | Peer profile + federation markers + identity rows | network-details toggle | LIVE | `PublicProfileCard`, `ChatActorIdentityRow`, federated handle, `peerProfileGet`, identity directory. |
| S27 | Safety number / key verification | local boolean | LIVE | MLS identity/X3DH verification UI exists (`SafetyVerificationPanel`). |
| S28 | Profile/post stats | fake counts | LIVE/DECIDE | `/social/me/stats` exists; per-peer counts via follow graph — wire real or remove. |
| S29 | 1:1 voice/video calls | labeled "simulator" | LIVE | P2P WebRTC + SSE-sealed signaling, real `CallSurface`/`callRuntime`; replace simulation. |
| S30 | Multi-party group calls | not represented | LIVE (omitted) | LiveKit SFU group calls (`/group-call/join`, capability gate, `GroupCallSurface`); prototype should add group-call surface. |
| S31 | Moderation / follow graph / circles | absent | LIVE (omitted) | `message_moderated`, station moderation policies, follow/circles exist; decide prototype coverage. |

---

## 4. AI (providers, agents, skills, MCP, memory)

Most AI configuration is **already implemented and richer than the
prototype**; agent collaboration core is built; only specific visualizations
and knobs are fiction.

| ID | Capability | Prototype today | Status | Gap / evidence |
|---|---|---|---|---|
| AI1 | Provider list/keys/base URL/model toggles + test | 3 mock providers, fake 700ms test | LIVE | Real `ProviderLayout/ProviderDetail`, secret withheld, remote model fetch, CRUD; bind `provider_*`. Provider name/logo edit TODO in product. |
| AI2 | Cross-provider model catalog (Models tab) | filterable read-only list | CLIENT-GAP | Product uses per-**scenario** routing (`ModelServiceTab`, `model_config_*`); either adopt scenario routing or build a catalog view. |
| AI3 | Long-term memory config | 2 fixed embeddings, fake DSN test | LIVE | Dynamic embedding list, real Postgres/pgvector test, weights, tuning badges; plus memory CRUD/persona/stats/import/export. |
| AI4 | Skills / custom packages | mock import/scan | LIVE | URL/GitHub/ZIP import, signed market, verify/revoke/stale, versions/rollback, resource tree (`skills_*`, `skill.proto`). |
| AI5 | MCP servers | fake per-server ping | LIVE | stdio/http/sse records, JSON import, capability-operation dispatch/reconnect/takeover (`mcp_*`); "test" is a reconcile, not latency. |
| AI6 | Agent roster / create / duplicate / delete | static seed, header + | LIVE | Station-backed roster + CRUD (`/sub-agent/agent/*`, `store/agent.ts`). |
| AI7 | Agent profile (title/desc/SOUL/AGENTS.md) | localStorage textareas | LIVE | Real `soulMd` + `agentsMd` + separate `systemPrompt`, optimistic version-conflict autosave. |
| AI8 | Provider/model/effort binding | hardcoded selects | LIVE | `ModelSelect` from Station `listAvailableModels`; drop fake options. |
| AI9 | Agent temperature knob | fixed 0.4 field | FICTION | No `temperature` in desktop; real knobs are effort/thinkingMode/chatConfig — remove. |
| AI10 | Tools/skills/MCP/connector/knowledge config | static mock rows | LIVE (richer) | Capability bindings with approval policy, revisions, readiness, 5 source kinds (`agentCapabilities.ts`, authority service); add knowledge descriptors. |
| AI11 | AI Builder quick completion | no-op sidebar | LIVE | `agent_quick_completion` → `/agent/quick-completion`; wire suggestions. |
| AI12 | Turn runtime / streaming / tool calls / approvals | dead composer buttons | LIVE | `agent_turn_*`, Station turn service (provider stream, MCP, admission, recovery), AgentChat/Tasks. |
| AI13 | Activity (tasks/approvals/tool calls), diagnostics | mock lists | LIVE | Turn/approval/delegation events; `agent_turn_trace_*` + diagnostics export. |
| AI14 | Multi-agent negotiation council (9 roles/consensus blocks) | centerpiece Atelier mock | CLIENT-GAP | Collaboration engines exist (EXPERT_MESH, parallel, judge/synthesizer, budgets, orchestration commands) but **no role-by-role council transcript UI**; needs product decision + a view over orchestration events. |
| AI15 | Workspace isolation | path string | LIVE | `workspaceMode/allowedRoots/isolation*` fields + OSS workspace service; present real controls. |
| AI16 | Evaluation console | mock benchmark | LIVE | EvaluationPage + Station eval services/runs + store. |
| AI17 | Agent portability (export/import) | absent | LIVE (omitted) | Agent package service + commands exist. |
| AI18 | Home projection (pinned agents, topics/tasks) | mock selectors/work rows | LIVE | HomePage + `home_projection_service.go`, `store/home.ts`. |

---

## 5. Applets

Real platform: Lynx-web bundles, 7-state kernel FSM, per-session permissions,
SHA-256 integrity, Station catalog, LRU(4) memory policy. The prototype
over-invents windowing and under-shows governance.

| ID | Capability | Prototype today | Status | Gap / evidence |
|---|---|---|---|---|
| AP1 | Launcher grid/search/badges | hardcoded grid | LIVE | `AppletManager` index + Station catalog merge, real `AppletsPage`; bind installed list. |
| AP2 | Install from local | `.bundle` one-click toast | CLIENT-GAP | Real import is **directory-based** via Tauri picker; align the prototype gesture (no `.bundle` flow exists). |
| AP3 | Install from store/catalog | absent | LIVE (omitted) | Station catalog/install + audit (`/api/v1/applets/*`, `applets_store`); add store surface. |
| AP4 | Launch/render real Lynx surface | mock skeleton | LIVE | Materialize → gateway session → kernel show → `LynxContainer`; only `lynx-web` bundles load in desktop (standalone SPAs excluded). |
| AP5 | Lifecycle (7-state keep-alive/reclaim) | binary running dot | LIVE (omitted) | cold/materializing/visible/hidden/paused/suspended/destroyed + LRU/TTL/memory sweep; show meaningful states. |
| AP6 | Multi-instance tabs/contexts of one applet | core concept | BACKEND-GAP | Kernel/lease keyed to one page + one gateway session per applet id; multi-instance needs kernel/registry data-model change. |
| AP7 | Detach | in-shell placeholder card | CLIENT-GAP | Real detach opens an OS `WebviewWindow` (`appletStandalone=1`); align to separate-window semantics. |
| AP8 | Pin | "pin to system" toggle | CLIENT-GAP | Real pin is sidebar pin (`appletPins`); no OS-level pinning. |
| AP9 | Uninstall | claimed in manifest, no control | CLIENT-GAP | Endpoint + proxy + `appletStoreUninstall` exist with **zero UI call sites**; add uninstall. |
| AP10 | Permissions/approval/audit/quotas | static trust label | LIVE (omitted) | Per-session capability enforcement, registry, quotas, payload limits in Rust + manifest schema. |
| AP11 | Integrity/status (revoked/update/offline) | none | LIVE (omitted) | Per-file SHA-256 verification, available/installed/active/revoked/disabled/update-available; surface revoked/update states. |
| AP12 | Notification badges on icons | bell dots | FICTION | `events` capability exists gateway-side but no launcher badge UI; needs product/backend work. |
| AP13 | Applet identity list | fictional Calendar/Todo/Whiteboard/Code/RSS | CUT/REPLACE | Real entries: `peers.note`, `peers.atelier`, and standalone agent-pilot/remote-cli/web-search; replace fabricated cards. |
| AP14 | Legacy stub | — | CUT | `apps/desktop/src/applets/registry.ts` returns null/false everywhere (dead); do not target it. |

---

## 6. Advanced settings

| ID | Capability | Prototype today | Status | Gap / evidence |
|---|---|---|---|---|
| AD1 | Data & Storage measured usage + retention | 4 invented byte buckets/percentages | LIVE (partial) | Real measured message/media/cache/system bytes + retention and journaled cache cleanup (`ChatStorageSettings`, `chat_storage_*`). The "AI memory index"/"applets & skills" byte buckets are invented — measure or remove. |
| AD2 | My files | "2 files" static | LIVE | Real OSS file management: soft-delete/restore/TTL/visibility (`MyFilesSettings`, `oss_*`). |
| AD3 | Export local data (all messages+settings) | no-op button | FICTION | No such API. Only memory export/import and encrypted chat recovery-phrase backup exist — relabel to those or build whole-data export. |
| AD4 | Reset onboarding | no-op | LIVE | Real `onboarding_reset` lives in Help danger zone; relocate consistently. |
| AD5 | Channels (outbound integrations) | DM/Group/Relay rows + Email/Matrix bridges | MIXED/CUT | Real channels are bot/webhook integrations: **Lark live**, Telegram/Slack/Discord/Webhook disabled `comingSoon`. Email Bridge and Matrix Bridge are FICTION (remove). DM/group/relay are core messaging, not channel settings. |
| AD6 | Applets settings | 6 mock cards + enable toggles | CLIENT-GAP | Runtime exists; settings page only lists local scans with no toggles and a stub registry; build settings against install/enable/disable state. |
| AD7 | Statistics (sessions/messages/heatmap/ranks) | entirely hardcoded | CUT | Product removed the API (`legacy_statistics_removed`), `StatisticsTab` has no importers. Decide to rebuild a stats backend or delete the section; do not ship fake charts. |
| AD8 | Diagnostics & logs | 9 fixed rows | LIVE | Live `logs_tail` cursor, 6 levels, filter/follow, current-view `.log` export; a full diagnostic *bundle* export is absent (possible addition). |
| AD9 | Scheduled tasks / cron | 2 static rows | LIVE (richer) | Interval/cron/once, 5-field builder, agent+channel+model targets, run-now/history (`cron_*`). "Weekly backup" target is fiction. |
| AD10 | Command palette | button opens palette | LIVE | Real items hook (pages/agents/settings/actions) + settings entry. |
| AD11 | About version/build/platform/runtime | hardcoded v0.9.2-beta | CLIENT-GAP | Surface real package/build metadata (actual package 0.1.0); static feature tour should derive from help catalog (`help_get`). |

---

## 7. Network (federation, discovery, station) — N1–N12

Ownership split and full per-item backend mapping are consolidated here.
User-owned choices live in Desktop Settings → Network (Your Station /
Discovery / Federation); operator capabilities live in the Station Dashboard.

| ID | Capability | Status | Owner | Gap |
|---|---|---|---|---|
| N1 | Single account discoverability HIDDEN/BY_HANDLE/INDEXED | LIVE (INDEXED behaves like BY_HANDLE until N4) | USR | Persisted via `UpdateProfile.discoverability`; bind; do not promise enumeration until catalog ships. |
| N2 | Per-federation visibility + master hide/restore | BACKEND-GAP | USR/STATION | Today one `visibility int16` per actor. Need proto map + migration + per-federation locator publish + catalog filter; prototype already remembers intent locally and is Pending. |
| N3 | Inbound request policy anyone/my-federations/nobody | BACKEND-GAP | USR/STATION | Only block-list + existing-friend gate exists; `message_permission` is stored but not enforced. Add enum + membership-intersection enforcement. |
| N4 | Cross-station directory fan-out (INDEXED enumeration) | BACKEND-GAP | OPS/STATION | Catalog handler is local-SQL-only (`origin=local, visibility>=3`); implement relay `fed.catalog.search.v1`, trie index, partial-result aggregation per federation-catalog.md. |
| N5 | Catalog serve kill-switch + rate limits + fan-out timeout | BACKEND-GAP | OPS/STATION | `peers.federation.catalog.serve`, `403 catalog_disabled`, token buckets (origin peer + IP), metrics — docs-only today; Dashboard switch; client shows read-only notice when off. |
| N6 | Desktop join/leave/roster/role/counts | CLIENT-GAP | USR/CLIENT | Station subserver implements join/leave/create/list/roster/ledger; desktop Tauri ships read-only commands. Add write/list-summary shims; expose `member_station_count`, `my_role`, `capability`. |
| N7 | Non-sequencer leave correctness | BACKEND-GAP (defect) | STATION | Join posts a sequencer proposal; leave appends locally with no remote proposal. Fix + cross-station acceptance before advertising Leave. |
| N8 | Authorized devices in Your Station | CLIENT-GAP | USR/CLIENT | Bind existing `/device/list|revoke` (see C16). |
| N9 | Switch station = logout + unbind + reselect | CLIENT-GAP (defect) | CLIENT | Call `/actor/logout`, unbind active station, return to onboarding, keep local data (see C17). |
| N10 | Rich federation/relay health (degraded/lagging/fork) | CLIENT-GAP/partial | OPS | Relay mounts binary online/offline; `SyncStatus` enum unused; cursor only healthy/fork_detected, unread. Project to roster + Dashboard relay stats; do not show badges in user Settings until real. |
| N11 | Population/exposure of counts | CLIENT-GAP | OPS/CLIENT | `visible_actor_count` never populated; contexts omit `member_station_count`; bootstrap emits no label/peers_count. Choose one endpoint and populate; hide unsupported numbers. |
| N12 | Bound station + federation health in Your Station | LIVE/CLIENT-GAP | USR | Render binding projection + `/actor/federation/health`; remove fabricated peer/seed/relay tiles (already removed from prototype). |

Operator-only (Station Dashboard, not user Settings): create/archive
federation, join approvals/governance proposals, ledger browser, member roster
management, relay mounts/invites/stats, directory config (N5), access gates.

---

## 8. Suggested sequencing for the alignment project

1. **Correctness & trust** — N7 leave proposal, N9/C17 logout+unbind, C10 PIN
   and C21–C24 real login/access-gate/station picker. Removes fake auth.
2. **Bind the conversation core** — S1/S2 send+receipts over SSE, S14–S16
   friend/federated requests + S15 find-people, S13/S12 attachments/voice,
   S18–S21 groups. Biggest product surface, backend already exists.
3. **Settings to live commands (client-only)** — C1/C4/C5 profile incl. OSS
   avatar/cover, C8 notification preferences (real categories), C15/C16 block
   list + devices, N6/N11 federation roster/counts, AI1/AI3/AI4/AI5/AI6–AI13,
   AD5/AD8/AD9/AD10. Delete CUT controls (AD7 statistics, AD5 email/matrix,
   C19 dark theme decision, AP13 fake applet names, AI9 temperature,
   C13/C14 fake privacy toggles, AD3 fake export).
4. **Applet runtime parity** — AP9 uninstall UI, AP3 catalog, AP7/AP8 real
   detach/pin, AP10/AP11 permissions/integrity/status; decide AP6
   multi-instance (backend) and AP12 badges.
5. **Backend-built features** — N2 per-federation visibility, N3 inbound
   policy, N4+N5 catalog fan-out + serve switch/limits, S11 mentions, S25
   global search (or scope down), S22 group invite inbox, S30 group call UI,
   AI14 council transcript, AP6 multi-instance.
6. **Prototype hygiene gate** — every remaining mock interaction either binds
   to a command or carries Pending backend/CUT; geometry gate asserts marker
   honesty, no fabricated numbers, and role-gated affordances.

Each backend item lands with its own acceptance gate (cross-station where
noted); when shipped, the corresponding prototype Pending marker is removed
and the geometry gate updated.

---

## 9. Evidence index

- Social/conversation backend: `apps/station/app/subserver/{conversation,social,groupcall}`; client `apps/desktop/src/services/im-service.ts`, `desktop_api.ts`, `store/socialChat.ts`, `src-tauri/src/interface/tauri_commands/{messaging,social}.rs`; real UI `apps/desktop/src/components/chat`.
- Identity/access/notification: `apps/station/frame/touch/actor`, `frame/touch/accessgate`, `app/subserver/notification`, `app/subserver/social`, `model/domain/actor/actor.proto`; desktop `store/{session,federation,notification,accountIdentity}.ts`, `components/settings/{AccountTab,FederationTab}.tsx`, `components/NotificationBell.tsx`.
- Federation: `docs/architecture/domains/federation/` (design/data-model/wire/integration), `docs/architecture/domains/identity/federation-catalog.md`, `apps/station/app/subserver/federation/`, `frame/core/plugin/native/subserver/relay/`.
- Agent/applet: `apps/station/app/subserver/agent/`, `apps/desktop/src/{store/agent*.ts,pages/AgentProfilePage.tsx,applet,runtimes/appletsRuntime.ts}`, `packages/{applets,applet-kernel,applet-contract,applet-sdk}`, `apps/desktop/src-tauri/src/application/{applets,agents,capability_authority}.rs`, `apps/station/app/subserver/applet_store/`.
- Prototype contract and Network ownership: `docs/client/common/ui-identity/components.md §10`; prototype README `docs/architecture/engineering/prototypes/desktop-shell/README.md`.
